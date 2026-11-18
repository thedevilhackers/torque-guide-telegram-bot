import { all, nextCounter, one, run, tx } from "./db.js";
import { approveWithPin, can, requireOrOverride } from "./auth.js";
import { getProduct } from "./catalog.js";
import { availability, decreaseStock, increaseStock, notifyLowStock, stockLevel } from "./inventory.js";
import { assertBranchOpen, audit, getBranch } from "./org.js";
import { activePromotions } from "./promotions.js";
import { getSettings } from "./settings.js";
import { currentShift } from "./shifts.js";
import { emit } from "./webhooks.js";
import { pointsEarned, priceCart, settle } from "../shared/pricing.js";
import { HttpError, badRequest, bool, forbidden, int, list, localHour, notFound, nowIso, num, optionalId, roundQty, str } from "./util.js";

const FRACTIONAL_UNITS = new Set(["kg", "g", "l", "ml"]);

/** Turns client cart lines into priced lines with product data, merging repeat scans of the same item. */
function buildLines(db, branchId, today, rawLines) {
  rawLines = list(rawLines);
  if (!rawLines.length) throw badRequest("The cart is empty", "EMPTY_CART");
  if (rawLines.length > 500) throw badRequest("Too many lines in one sale", "VALIDATION");
  const merged = [];
  rawLines.forEach((raw, i) => {
    const productId = int(raw.product_id, `lines[${i}].product_id`, { required: true, min: 1 });
    const product = getProduct(db, productId, { branchId, today });
    if (!product.active || !product.branch_active) throw badRequest(`${product.name} is not for sale`, "PRODUCT_INACTIVE");
    const qty = roundQty(num(raw.qty, `lines[${i}].qty`, { required: true, min: 0.001, max: 100000 }));
    if (!product.sold_by_weight && !FRACTIONAL_UNITS.has(product.unit) && !Number.isInteger(qty)) {
      throw badRequest(`${product.name} must be sold in whole units`, "VALIDATION");
    }
    const override = raw.price === undefined || raw.price === null || raw.price === "" ? null : int(raw.price, `lines[${i}].price`, { min: 0 });
    const unitPrice = override ?? product.effective_price;
    const manual = int(raw.discount, `lines[${i}].discount`, { min: 0 });
    const mergeable = !product.sold_by_weight && override === null;
    const existing = mergeable && merged.find((l) => l.product_id === productId && l.mergeable);
    if (existing) {
      existing.qty = roundQty(existing.qty + qty);
      existing.manual_discount += manual;
      return;
    }
    merged.push({
      product_id: productId,
      category_id: product.category_id,
      name: product.name,
      sku: product.sku,
      qty,
      unit_price: unitPrice,
      list_price: product.effective_price,
      price_overridden: override !== null && override !== product.effective_price,
      tax_rate: product.tax_rate,
      manual_discount: manual,
      sold_by_weight: product.sold_by_weight,
      min_age: product.min_age,
      cost: product.cost,
      track_stock: product.track_stock,
      mergeable
    });
  });
  return merged;
}

function billDiscountFrom(raw) {
  if (!raw || !raw.value) return null;
  const type = raw.type === "amount" ? "amount" : "percent";
  return { type, value: type === "percent" ? num(raw.value, "bill_discount.value", { min: 0, max: 100 }) : int(raw.value, "bill_discount.value", { min: 0 }) };
}

/** Prices a cart without saving anything. */
export function quote(db, { branchId, today, lines, bill_discount }) {
  const settings = getSettings(db);
  const built = buildLines(db, branchId, today, lines);
  return priceCart(built, activePromotions(db, branchId, today), { taxInclusive: settings.prices_include_tax, billDiscount: billDiscountFrom(bill_discount) });
}

function approvalError(reasons) {
  return new HttpError(403, `Manager approval required: ${reasons.join("; ")}`, "APPROVAL_REQUIRED", { reasons });
}

export async function checkout(db, principal, input) {
  const { branchId, today } = input;
  const branch = assertBranchOpen(db, branchId);
  const settings = getSettings(db);
  const clientRef = str(input.client_ref, "client_ref", { max: 64 }) || null;
  if (clientRef) {
    const existing = one(db, "SELECT id FROM sales WHERE branch_id = ? AND client_ref = ?", branchId, clientRef);
    if (existing) return { ...getSale(db, existing.id), duplicate: true };
  }

  const shift = principal.userId ? currentShift(db, branchId, principal.userId) : null;
  if (principal.userId && settings.require_shift && !shift) throw badRequest("Open a shift before selling", "NO_SHIFT");

  const lines = buildLines(db, branchId, today, input.lines);
  const billDiscount = billDiscountFrom(input.bill_discount);

  // Age-restricted items (alcohol, tobacco, ...) need the cashier to confirm an ID check.
  const minAge = Math.max(0, ...lines.map((l) => l.min_age));
  if (minAge > 0 && !bool(input.age_verified)) throw new HttpError(400, `Check ID: customer must be ${minAge}+`, "AGE_CHECK_REQUIRED", { min_age: minAge });

  // Collect everything a cashier needs a manager PIN for.
  const needs = new Map();
  for (const l of lines) {
    if (l.price_overridden) needs.set("pos.price_override", `price change on ${l.name}`);
    const gross = l.unit_price * l.qty;
    if (gross > 0 && (l.manual_discount / gross) * 100 > settings.max_cashier_discount_pct) needs.set("pos.discount_unlimited", `discount over ${settings.max_cashier_discount_pct}%`);
    if (!l.track_stock) continue;
    const stock = availability(db, branchId, l.product_id, today);
    if (l.qty > stock.sellable && stock.expired > 0 && settings.block_expired_sales) needs.set("pos.sell_expired", `${l.name} only has expired stock left`);
    if (!settings.allow_negative_stock && l.qty > stock.on_hand) throw badRequest(`${l.name}: only ${stock.on_hand} in stock`, "INSUFFICIENT_STOCK");
  }
  if (billDiscount?.type === "percent" && billDiscount.value > settings.max_cashier_discount_pct) needs.set("pos.discount_unlimited", `bill discount over ${settings.max_cashier_discount_pct}%`);

  let approver = null;
  const missing = [...needs.entries()].filter(([perm]) => !can(principal, perm));
  if (missing.length) {
    if (!input.override_pin) throw approvalError(missing.map(([, why]) => why));
    for (const [perm] of missing) approver = await approveWithPin(db, { branchId, pin: input.override_pin, permission: perm });
  }

  const priced = priceCart(lines, activePromotions(db, branchId, today), { taxInclusive: settings.prices_include_tax, billDiscount });

  // Customer & loyalty redemption.
  const customerId = optionalId(input.customer_id, "customer_id");
  const customer = customerId ? one(db, "SELECT * FROM customers WHERE id = ?", customerId) : null;
  if (customerId && !customer) throw badRequest("Customer not found", "VALIDATION");
  let redeemPoints = int(input.redeem_points, "redeem_points", { min: 0 });
  let pointsValue = 0;
  if (redeemPoints > 0) {
    if (!customer) throw badRequest("Attach a customer to redeem points", "VALIDATION");
    if (!settings.loyalty.enabled || !settings.loyalty.point_value) throw badRequest("Loyalty redemption is turned off", "VALIDATION");
    if (redeemPoints > customer.points) throw badRequest(`Customer only has ${customer.points} points`, "VALIDATION");
    if (redeemPoints < settings.loyalty.min_redeem) throw badRequest(`Redeem at least ${settings.loyalty.min_redeem} points`, "VALIDATION");
    redeemPoints = Math.min(redeemPoints, Math.ceil(priced.total / settings.loyalty.point_value));
    pointsValue = Math.min(priced.total, redeemPoints * settings.loyalty.point_value);
  }

  // Payments.
  const allowed = new Set(settings.payment_methods.map((m) => m.id));
  const payments = list(input.payments).map((p, i) => {
    const method = str(p.method, `payments[${i}].method`, { required: true, max: 20 });
    if (!allowed.has(method)) throw badRequest(`Payment method "${method}" is not enabled`, "VALIDATION");
    return { method, amount: int(p.amount, `payments[${i}].amount`, { required: true, min: 0 }), reference: str(p.reference, "reference", { max: 80 }) };
  }).filter((p) => p.amount > 0);
  if (pointsValue > 0) payments.push({ method: "points", amount: pointsValue, reference: `${redeemPoints} pts` });
  const settlement = settle(priced.total, payments);
  if (settlement.overpaidNonCash) throw badRequest("Card/UPI/points cannot be more than the amount due", "OVERPAYMENT");
  if (settlement.due > 0) throw badRequest(`Payment is short by ${settlement.due}`, "INSUFFICIENT_PAYMENT", { due: settlement.due });

  const earned = customer ? pointsEarned(priced.total, pointsValue, settings.loyalty) : 0;

  const saleId = tx(db, () => {
    const seq = nextCounter(db, `receipt:${branchId}`);
    const receiptNo = `${branch.code}-${String(seq).padStart(6, "0")}`;
    const id = run(
      db,
      `INSERT INTO sales(branch_id, receipt_no, type, client_ref, shift_id, user_id, customer_id, subtotal, discount_total, tax_total, total,
                         items_count, tendered, change_due, points_earned, points_redeemed, age_verified, approved_by, note, business_date, hour, created_at)
       VALUES (?, ?, 'sale', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      branchId,
      receiptNo,
      clientRef,
      shift?.id ?? null,
      principal.userId,
      customer?.id ?? null,
      priced.subtotal,
      priced.discount_total,
      priced.tax_total,
      priced.total,
      roundQty(priced.items_count),
      settlement.paid,
      settlement.change,
      earned,
      redeemPoints,
      minAge > 0 ? 1 : 0,
      approver?.id ?? null,
      str(input.note, "note", { max: 300 }),
      today,
      localHour(branch.timezone),
      nowIso()
    ).id;

    const before = new Map();
    let costTotal = 0;
    for (const l of priced.lines) {
      if (l.track_stock && !before.has(l.product_id)) before.set(l.product_id, stockLevel(db, branchId, l.product_id));
      const itemId = run(
        db,
        `INSERT INTO sale_items(sale_id, product_id, name, sku, category_id, qty, unit_price, gross, discount, promo_id, promo_name, tax_rate, tax, total)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        l.product_id,
        l.name,
        l.sku,
        l.category_id,
        l.qty,
        l.unit_price,
        l.gross,
        l.discount,
        l.promo_id,
        l.promo_name,
        l.tax_rate,
        l.tax,
        l.total
      ).id;
      const allocations = l.track_stock
        ? decreaseStock(db, { branchId, productId: l.product_id, qty: l.qty, type: "sale", refType: "sale", refId: id, userId: principal.userId, today, fallbackCost: l.cost })
        : [{ batch_id: null, qty: l.qty, unit_cost: l.cost }];
      let lineCost = 0;
      for (const a of allocations) {
        run(db, "INSERT INTO sale_item_batches(sale_item_id, batch_id, qty, unit_cost) VALUES (?, ?, ?, ?)", itemId, a.batch_id, a.qty, a.unit_cost);
        lineCost += Math.round(a.qty * a.unit_cost);
      }
      run(db, "UPDATE sale_items SET cost = ? WHERE id = ?", lineCost, itemId);
      costTotal += lineCost;
    }

    // Cash is stored net of change so the drawer reconciles exactly.
    const cashApplied = settlement.cashApplied;
    if (cashApplied > 0) run(db, "INSERT INTO sale_payments(sale_id, method, amount, reference) VALUES (?, 'cash', ?, '')", id, cashApplied);
    for (const p of payments.filter((p) => p.method !== "cash")) run(db, "INSERT INTO sale_payments(sale_id, method, amount, reference) VALUES (?, ?, ?, ?)", id, p.method, p.amount, p.reference);

    run(db, "UPDATE sales SET cost_total = ? WHERE id = ?", costTotal, id);
    if (customer) {
      run(
        db,
        "UPDATE customers SET points = points + ? - ?, total_spent = total_spent + ?, visits = visits + 1, last_visit_at = ? WHERE id = ?",
        earned,
        redeemPoints,
        priced.total,
        nowIso(),
        customer.id
      );
    }
    if (approver) audit(db, principal, "sale.approved", { entity: "sale", entityId: id, branchId, details: { approved_by: approver.name, reasons: [...needs.values()] } });
    notifyLowStock(db, branchId, before);
    emit(db, "sale.completed", getSale(db, id), branchId);
    return id;
  });
  return getSale(db, saleId);
}

export function getSale(db, idOrReceipt) {
  const sale = /^\d+$/.test(String(idOrReceipt))
    ? one(db, "SELECT * FROM sales WHERE id = ?", Number(idOrReceipt))
    : one(db, "SELECT * FROM sales WHERE receipt_no = ?", String(idOrReceipt).trim().toUpperCase());
  if (!sale) throw notFound("Sale");
  const branch = getBranch(db, sale.branch_id);
  return {
    ...sale,
    branch: { id: branch.id, code: branch.code, name: branch.name, address: branch.address, phone: branch.phone, tax_id: branch.tax_id, receipt_footer: branch.receipt_footer, timezone: branch.timezone },
    cashier: one(db, "SELECT id, name FROM users WHERE id = ?", sale.user_id) ?? null,
    approver: sale.approved_by ? one(db, "SELECT id, name FROM users WHERE id = ?", sale.approved_by) : null,
    customer: sale.customer_id ? one(db, "SELECT id, name, phone, points FROM customers WHERE id = ?", sale.customer_id) : null,
    items: all(db, "SELECT * FROM sale_items WHERE sale_id = ? ORDER BY id", sale.id),
    payments: all(db, "SELECT method, amount, reference FROM sale_payments WHERE sale_id = ? ORDER BY id", sale.id),
    refunds: all(db, "SELECT id, receipt_no, total, created_at FROM sales WHERE refund_of = ? ORDER BY id", sale.id),
    refund_of_receipt: sale.refund_of ? one(db, "SELECT receipt_no FROM sales WHERE id = ?", sale.refund_of)?.receipt_no : null
  };
}

export function listSales(db, { branchId, from = null, to = null, search = "", type = null, userId = null, limit = 100, offset = 0 }) {
  const term = String(search ?? "").trim();
  return all(
    db,
    `SELECT s.id, s.branch_id, b.code AS branch_code, s.receipt_no, s.type, s.status, s.total, s.discount_total, s.tax_total, s.items_count,
            s.created_at, s.business_date, u.name AS cashier_name, c.name AS customer_name, c.phone AS customer_phone,
            (SELECT GROUP_CONCAT(DISTINCT method) FROM sale_payments WHERE sale_id = s.id) AS methods
       FROM sales s JOIN branches b ON b.id = s.branch_id LEFT JOIN users u ON u.id = s.user_id LEFT JOIN customers c ON c.id = s.customer_id
      WHERE (:branch IS NULL OR s.branch_id = :branch) AND (:from IS NULL OR s.business_date >= :from) AND (:to IS NULL OR s.business_date <= :to)
        AND (:type IS NULL OR s.type = :type) AND (:user IS NULL OR s.user_id = :user)
        AND (:term = '' OR s.receipt_no LIKE :like OR c.phone LIKE :like OR c.name LIKE :like)
      ORDER BY s.id DESC LIMIT :limit OFFSET :offset`,
    { branch: branchId, from, to, type, user: userId, term, like: `%${term}%`, limit: Math.min(limit, 1000), offset }
  );
}

/**
 * Refunds some or all items of a sale. Restocked items go back into the batches they were sold from,
 * so expiry dates stay accurate.
 */
export async function refundSale(db, principal, { branchId, today, saleId, items, restock = true, reason, method, override_pin }) {
  const original = getSale(db, saleId);
  if (original.type !== "sale") throw badRequest("Only sales can be refunded", "VALIDATION");
  if (principal.branchId && original.branch_id !== principal.branchId) throw forbidden("This sale belongs to another branch");
  const saleBranch = assertBranchOpen(db, original.branch_id);
  const approver = await requireOrOverride(db, principal, "sales.refund", { branchId: original.branch_id, pin: override_pin, message: "Refunds need a manager PIN" });
  const settings = getSettings(db);
  const why = str(reason, "reason", { required: true, max: 200 });

  // What is being returned.
  let requested = list(items);
  if (!requested.length) requested = original.items.map((i) => ({ sale_item_id: i.id, qty: roundQty(i.qty - i.refunded_qty) })).filter((i) => i.qty > 0);
  if (!requested.length) throw badRequest("Everything on this receipt has already been refunded", "VALIDATION");
  const lines = requested.map((r, idx) => {
    const item = original.items.find((i) => i.id === int(r.sale_item_id, `items[${idx}].sale_item_id`, { required: true }));
    if (!item) throw badRequest("Item is not on this receipt", "VALIDATION");
    const qty = roundQty(num(r.qty, `items[${idx}].qty`, { required: true, min: 0.001 }));
    const left = roundQty(item.qty - item.refunded_qty);
    if (qty > left) throw badRequest(`${item.name}: only ${left} left to refund`, "VALIDATION");
    const prior = one(db, "SELECT COALESCE(SUM(-total),0) AS total, COALESCE(SUM(-tax),0) AS tax, COALESCE(SUM(-gross),0) AS gross, COALESCE(SUM(-discount),0) AS discount FROM sale_items WHERE refund_of_item = ?", item.id);
    const isLast = qty === left;
    const share = (field) => (isLast ? item[field] - prior[field] : Math.round((item[field] * qty) / item.qty));
    return { item, qty, total: share("total"), tax: share("tax"), gross: share("gross"), discount: share("discount") };
  });
  const refundTotal = lines.reduce((s, l) => s + l.total, 0);

  const refundMethod = method ? str(method, "method", { max: 20 }) : original.payments.find((p) => p.method !== "points")?.method ?? "cash";
  if (!settings.payment_methods.some((m) => m.id === refundMethod)) throw badRequest(`Refund method "${refundMethod}" is not enabled`, "VALIDATION");
  const shift = principal.userId ? currentShift(db, original.branch_id, principal.userId) : null;
  if (refundMethod === "cash" && principal.userId && settings.require_shift && !shift) throw badRequest("Open a shift to give a cash refund", "NO_SHIFT");

  const refundId = tx(db, () => {
    const seq = nextCounter(db, `refund:${original.branch_id}`);
    const pointsBack = original.points_earned && original.total ? Math.round((original.points_earned * refundTotal) / original.total) : 0;
    const id = run(
      db,
      `INSERT INTO sales(branch_id, receipt_no, type, refund_of, shift_id, user_id, customer_id, subtotal, discount_total, tax_total, total,
                         items_count, tendered, change_due, points_earned, approved_by, note, business_date, hour, created_at)
       VALUES (?, ?, 'refund', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`,
      original.branch_id,
      `${saleBranch.code}-R${String(seq).padStart(6, "0")}`,
      original.id,
      shift?.id ?? null,
      principal.userId,
      original.customer_id,
      -lines.reduce((s, l) => s + l.gross, 0),
      -lines.reduce((s, l) => s + l.discount, 0),
      -lines.reduce((s, l) => s + l.tax, 0),
      -refundTotal,
      -lines.reduce((s, l) => s + l.qty, 0),
      -refundTotal,
      -pointsBack,
      approver?.id ?? null,
      why,
      today,
      localHour(saleBranch.timezone),
      nowIso()
    ).id;

    let costTotal = 0;
    for (const l of lines) {
      let lineCost = 0;
      const tracked = one(db, "SELECT track_stock FROM products WHERE id = ?", l.item.product_id)?.track_stock;
      if (restock && tracked) {
        // Return stock to the batches it originally came from, newest allocation first.
        let left = l.qty;
        const allocations = all(db, "SELECT rowid, * FROM sale_item_batches WHERE sale_item_id = ? ORDER BY rowid DESC", l.item.id);
        for (const a of allocations) {
          if (left <= 0) break;
          const back = roundQty(Math.min(a.qty, left));
          const batchExists = a.batch_id && one(db, "SELECT id FROM batches WHERE id = ?", a.batch_id);
          increaseStock(db, {
            branchId: original.branch_id,
            productId: l.item.product_id,
            qty: back,
            unitCost: a.unit_cost,
            batchId: batchExists ? a.batch_id : null,
            source: "refund",
            sourceId: id,
            type: "refund",
            reason: why,
            refType: "sale",
            refId: id,
            userId: principal.userId,
            today
          });
          lineCost += Math.round(back * a.unit_cost);
          left = roundQty(left - back);
        }
      }
      run(
        db,
        `INSERT INTO sale_items(sale_id, product_id, name, sku, category_id, qty, unit_price, gross, discount, promo_id, promo_name, tax_rate, tax, total, cost, refund_of_item)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        l.item.product_id,
        l.item.name,
        l.item.sku,
        l.item.category_id,
        -l.qty,
        l.item.unit_price,
        -l.gross,
        -l.discount,
        l.item.promo_id,
        l.item.promo_name,
        l.item.tax_rate,
        -l.tax,
        -l.total,
        -lineCost,
        l.item.id
      );
      run(db, "UPDATE sale_items SET refunded_qty = round(refunded_qty + ?, 3) WHERE id = ?", l.qty, l.item.id);
      costTotal += lineCost;
    }
    run(db, "UPDATE sales SET cost_total = ? WHERE id = ?", -costTotal, id);
    run(db, "INSERT INTO sale_payments(sale_id, method, amount, reference) VALUES (?, ?, ?, ?)", id, refundMethod, -refundTotal, `refund of ${original.receipt_no}`);
    const remaining = one(db, "SELECT SUM(qty - refunded_qty) AS left FROM sale_items WHERE sale_id = ?", original.id).left;
    run(db, "UPDATE sales SET status = ? WHERE id = ?", remaining > 0.0005 ? "partially_refunded" : "refunded", original.id);
    if (original.customer_id) {
      run(db, "UPDATE customers SET points = MAX(points - ?, 0), total_spent = total_spent - ? WHERE id = ?", pointsBack, refundTotal, original.customer_id);
    }
    audit(db, principal, "sale.refunded", { entity: "sale", entityId: original.id, branchId: original.branch_id, details: { refund_id: id, total: refundTotal, reason: why, approved_by: approver?.name ?? null, restock: Boolean(restock) } });
    emit(db, "sale.refunded", getSale(db, id), original.branch_id);
    return id;
  });
  return getSale(db, refundId);
}

// ---- held (parked) carts ------------------------------------------------------------

export function holdCart(db, principal, { branchId, label, data }) {
  if (!data || typeof data !== "object") throw badRequest("Nothing to hold", "VALIDATION");
  const json = JSON.stringify(data);
  if (json.length > 200_000) throw badRequest("Cart is too large to hold", "VALIDATION");
  const { id } = run(db, "INSERT INTO held_carts(branch_id, user_id, label, data, created_at) VALUES (?, ?, ?, ?, ?)", branchId, principal.userId, str(label, "label", { max: 60 }), json, nowIso());
  return { id };
}

export function listHeldCarts(db, branchId) {
  return all(db, "SELECT h.id, h.label, h.created_at, h.data, u.name AS user_name FROM held_carts h LEFT JOIN users u ON u.id = h.user_id WHERE h.branch_id = ? ORDER BY h.id DESC", branchId).map((h) => ({
    ...h,
    data: JSON.parse(h.data)
  }));
}

/** Removes a held cart and returns its contents (recall). */
export function takeHeldCart(db, branchId, id) {
  const row = one(db, "SELECT * FROM held_carts WHERE id = ? AND branch_id = ?", id, branchId);
  if (!row) throw notFound("Held cart");
  run(db, "DELETE FROM held_carts WHERE id = ?", id);
  return { ...row, data: JSON.parse(row.data) };
}
