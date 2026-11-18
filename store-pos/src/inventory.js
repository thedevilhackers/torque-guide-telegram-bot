import { all, one, run, tx, value } from "./db.js";
import { getBranch } from "./org.js";
import { emit } from "./webhooks.js";
import { badRequest, int, list, notFound, nowIso, num, optionalDate, optionalId, roundQty, str } from "./util.js";

export const ADJUST_REASONS = ["damaged", "expired", "theft", "lost", "found", "correction", "sample", "internal_use", "returned_to_supplier", "other"];

// ---- low-level stock primitives ------------------------------------------------
// Invariant: SUM(batches.qty_remaining) == MAX(stock.qty, 0) per branch+product.
// When stock is oversold (negative) the shortfall has no batch; the next increase fills it first.

export function stockLevel(db, branchId, productId) {
  return value(db, "SELECT qty FROM stock WHERE branch_id = ? AND product_id = ?", branchId, productId) ?? 0;
}

function changeStock(db, branchId, productId, delta) {
  run(
    db,
    `INSERT INTO stock(branch_id, product_id, qty, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(branch_id, product_id) DO UPDATE SET qty = round(qty + excluded.qty, 3), updated_at = excluded.updated_at`,
    branchId,
    productId,
    roundQty(delta),
    nowIso()
  );
}

function movement(db, m) {
  run(
    db,
    `INSERT INTO stock_movements(branch_id, product_id, batch_id, type, qty, unit_cost, reason, ref_type, ref_id, user_id, business_date, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    m.branchId,
    m.productId,
    m.batchId ?? null,
    m.type,
    roundQty(m.qty),
    Math.round(m.unitCost ?? 0),
    m.reason ?? "",
    m.refType ?? null,
    m.refId ?? null,
    m.userId ?? null,
    m.today,
    nowIso()
  );
}

/**
 * Adds stock. Creates a new batch unless `batchId` is given (used when a refund puts goods back into their original batch).
 * Returns the batch id.
 */
export function increaseStock(db, { branchId, productId, qty, unitCost = 0, batchNo = "", expiryDate = null, batchId = null, source, sourceId = null, type, reason = "", refType = null, refId = null, userId = null, today }) {
  qty = roundQty(qty);
  if (!(qty > 0)) throw badRequest("Quantity must be greater than zero", "VALIDATION");
  const backlog = Math.max(-stockLevel(db, branchId, productId), 0);
  const intoBatch = roundQty(Math.max(qty - backlog, 0));
  let id = batchId;
  if (id) {
    run(db, "UPDATE batches SET qty_remaining = round(qty_remaining + ?, 3) WHERE id = ?", intoBatch, id);
  } else {
    id = run(
      db,
      `INSERT INTO batches(branch_id, product_id, batch_no, expiry_date, qty_received, qty_remaining, cost, source, source_id, received_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      branchId,
      productId,
      batchNo,
      expiryDate,
      qty,
      intoBatch,
      Math.round(unitCost),
      source,
      sourceId,
      nowIso()
    ).id;
  }
  changeStock(db, branchId, productId, qty);
  movement(db, { branchId, productId, batchId: id, type, qty, unitCost, reason, refType, refId, userId, today });
  return id;
}

/**
 * Removes stock using FEFO. order "sell": unexpired batches first (earliest expiry first), then expired ones.
 * order "oldest": strictly by expiry date, expired first (used for counts/shrinkage).
 * Any quantity not covered by batches becomes negative stock (oversold) costed at `fallbackCost`.
 */
export function decreaseStock(db, { branchId, productId, qty, type, reason = "", refType = null, refId = null, userId = null, today, batchId = null, order = "sell", fallbackCost = 0 }) {
  qty = roundQty(qty);
  if (!(qty > 0)) throw badRequest("Quantity must be greater than zero", "VALIDATION");
  let batches;
  if (batchId) {
    batches = all(db, "SELECT * FROM batches WHERE id = ? AND branch_id = ? AND product_id = ?", batchId, branchId, productId);
    if (!batches.length) throw notFound("Batch");
  } else {
    const orderBy =
      order === "oldest"
        ? "expiry_date IS NULL, expiry_date, id"
        : "(expiry_date IS NOT NULL AND expiry_date < :today), expiry_date IS NULL, expiry_date, id";
    batches = all(db, `SELECT * FROM batches WHERE branch_id = :branch AND product_id = :product AND qty_remaining > 0 ORDER BY ${orderBy}`, {
      branch: branchId,
      product: productId,
      today
    });
  }
  const allocations = [];
  let remaining = qty;
  for (const batch of batches) {
    if (remaining <= 0) break;
    const take = roundQty(Math.min(batch.qty_remaining, remaining));
    if (take <= 0) continue;
    run(db, "UPDATE batches SET qty_remaining = round(qty_remaining - ?, 3) WHERE id = ?", take, batch.id);
    allocations.push({ batch_id: batch.id, qty: take, unit_cost: batch.cost, expiry_date: batch.expiry_date, batch_no: batch.batch_no });
    remaining = roundQty(remaining - take);
  }
  if (remaining > 0) {
    if (batchId) throw badRequest("That batch does not have enough quantity left", "VALIDATION");
    allocations.push({ batch_id: null, qty: remaining, unit_cost: fallbackCost, expiry_date: null, batch_no: "" });
  }
  changeStock(db, branchId, productId, -qty);
  for (const a of allocations) {
    movement(db, { branchId, productId, batchId: a.batch_id, type, qty: -a.qty, unitCost: a.unit_cost, reason, refType, refId, userId, today });
  }
  return allocations;
}

/** How much can be sold right now: unexpired batch stock vs. expired stock still on the shelf. */
export function availability(db, branchId, productId, today) {
  const onHand = stockLevel(db, branchId, productId);
  const expired = value(db, "SELECT COALESCE(SUM(qty_remaining), 0) FROM batches WHERE branch_id = ? AND product_id = ? AND qty_remaining > 0 AND expiry_date < ?", branchId, productId, today);
  return { on_hand: roundQty(onHand), expired: roundQty(expired), sellable: roundQty(Math.max(onHand, 0) - expired) };
}

/** Emits stock.low for products that just crossed their reorder level. */
export function notifyLowStock(db, branchId, before) {
  for (const [productId, prev] of before) {
    const row = one(
      db,
      `SELECT p.id, p.sku, p.name, COALESCE(bp.reorder_level, p.reorder_level) AS reorder_level
         FROM products p LEFT JOIN branch_products bp ON bp.product_id = p.id AND bp.branch_id = ? WHERE p.id = ?`,
      branchId,
      productId
    );
    if (!row || !(row.reorder_level > 0)) continue;
    const now = stockLevel(db, branchId, productId);
    if (prev > row.reorder_level && now <= row.reorder_level) {
      emit(db, "stock.low", { product_id: row.id, sku: row.sku, name: row.name, qty: roundQty(now), reorder_level: row.reorder_level }, branchId);
    }
  }
}

function productOrThrow(db, id) {
  const product = one(db, "SELECT * FROM products WHERE id = ?", id);
  if (!product) throw badRequest(`Product ${id} does not exist`, "VALIDATION");
  return product;
}

// ---- receiving (goods receipt / stock entry) -----------------------------------------

export function receiveStock(db, principal, { branchId, today, supplier_id, invoice_no, note, items }) {
  items = list(items);
  if (!items.length) throw badRequest("Add at least one item to receive", "VALIDATION");
  const supplierId = optionalId(supplier_id, "supplier_id");
  if (supplierId && !one(db, "SELECT id FROM suppliers WHERE id = ?", supplierId)) throw badRequest("Supplier does not exist", "VALIDATION");
  return tx(db, () => {
    const receiptId = run(
      db,
      "INSERT INTO goods_receipts(branch_id, supplier_id, invoice_no, note, user_id, business_date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      branchId,
      supplierId,
      str(invoice_no, "invoice_no", { max: 60 }),
      str(note, "note", { max: 500 }),
      principal.userId,
      today,
      nowIso()
    ).id;
    let totalCost = 0;
    items.forEach((item, i) => {
      const product = productOrThrow(db, int(item.product_id, `items[${i}].product_id`, { required: true, min: 1 }));
      const qty = num(item.qty, `items[${i}].qty`, { required: true, min: 0.001 });
      const unitCost = item.cost === undefined || item.cost === null || item.cost === "" ? product.cost : int(item.cost, `items[${i}].cost`, { min: 0 });
      const expiry = optionalDate(item.expiry_date, `items[${i}].expiry_date`);
      if (expiry && expiry < today) throw badRequest(`${product.name}: expiry date ${expiry} is already in the past`, "VALIDATION");
      increaseStock(db, {
        branchId,
        productId: product.id,
        qty,
        unitCost,
        batchNo: str(item.batch_no, "batch_no", { max: 60 }),
        expiryDate: expiry,
        source: "receive",
        sourceId: receiptId,
        type: "receive",
        refType: "receipt",
        refId: receiptId,
        userId: principal.userId,
        today
      });
      totalCost += Math.round(unitCost * qty);
      if (unitCost !== product.cost) run(db, "UPDATE products SET cost = ?, updated_at = ? WHERE id = ?", unitCost, nowIso(), product.id);
      if (item.sell_price !== undefined && item.sell_price !== null && item.sell_price !== "") {
        const price = int(item.sell_price, `items[${i}].sell_price`, { min: 0 });
        if (principal.role === "owner") run(db, "UPDATE products SET price = ?, updated_at = ? WHERE id = ?", price, nowIso(), product.id);
        else
          run(
            db,
            `INSERT INTO branch_products(branch_id, product_id, price) VALUES (?, ?, ?)
             ON CONFLICT(branch_id, product_id) DO UPDATE SET price = excluded.price`,
            branchId,
            product.id,
            price
          );
      }
    });
    run(db, "UPDATE goods_receipts SET total_cost = ?, line_count = ? WHERE id = ?", totalCost, items.length, receiptId);
    const receipt = getReceipt(db, receiptId);
    emit(db, "stock.received", receipt, branchId);
    return receipt;
  });
}

export function getReceipt(db, id) {
  const receipt = one(
    db,
    `SELECT r.*, s.name AS supplier_name, u.name AS user_name, b.name AS branch_name
       FROM goods_receipts r LEFT JOIN suppliers s ON s.id = r.supplier_id LEFT JOIN users u ON u.id = r.user_id
       JOIN branches b ON b.id = r.branch_id WHERE r.id = ?`,
    id
  );
  if (!receipt) throw notFound("Receipt");
  receipt.items = all(
    db,
    `SELECT bt.id AS batch_id, bt.product_id, p.name, p.sku, p.unit, bt.qty_received AS qty, bt.cost, bt.batch_no, bt.expiry_date
       FROM batches bt JOIN products p ON p.id = bt.product_id WHERE bt.source = 'receive' AND bt.source_id = ? ORDER BY bt.id`,
    id
  );
  return receipt;
}

export function listReceipts(db, { branchId, limit = 50 }) {
  return all(
    db,
    `SELECT r.*, s.name AS supplier_name, u.name AS user_name FROM goods_receipts r
       LEFT JOIN suppliers s ON s.id = r.supplier_id LEFT JOIN users u ON u.id = r.user_id
      WHERE (? IS NULL OR r.branch_id = ?) ORDER BY r.id DESC LIMIT ?`,
    branchId,
    branchId,
    Math.min(limit, 500)
  );
}

// ---- adjustments, write-offs, counts ---------------------------------------------------

export function adjustStock(db, principal, { branchId, today, product_id, qty, reason, batch_id, expiry_date, batch_no, cost, note }) {
  const product = productOrThrow(db, int(product_id, "product_id", { required: true, min: 1 }));
  const delta = num(qty, "qty", { required: true });
  if (delta === 0) throw badRequest("Quantity change cannot be zero", "VALIDATION");
  const why = str(reason, "reason", { required: true });
  if (!ADJUST_REASONS.includes(why)) throw badRequest(`reason must be one of ${ADJUST_REASONS.join(", ")}`, "VALIDATION");
  const fullReason = note ? `${why}: ${str(note, "note", { max: 200 })}` : why;
  return tx(db, () => {
    const before = new Map([[product.id, stockLevel(db, branchId, product.id)]]);
    if (delta > 0) {
      increaseStock(db, {
        branchId,
        productId: product.id,
        qty: delta,
        unitCost: cost === undefined || cost === "" || cost === null ? product.cost : int(cost, "cost", { min: 0 }),
        batchNo: str(batch_no, "batch_no", { max: 60 }),
        expiryDate: optionalDate(expiry_date, "expiry_date"),
        source: "adjust",
        type: "adjust",
        reason: fullReason,
        userId: principal.userId,
        today
      });
    } else {
      decreaseStock(db, {
        branchId,
        productId: product.id,
        qty: -delta,
        type: "adjust",
        reason: fullReason,
        userId: principal.userId,
        today,
        batchId: optionalId(batch_id, "batch_id"),
        order: why === "expired" ? "oldest" : "sell",
        fallbackCost: product.cost
      });
    }
    notifyLowStock(db, branchId, before);
    const result = { product_id: product.id, name: product.name, qty: delta, reason: fullReason, stock_qty: roundQty(stockLevel(db, branchId, product.id)) };
    emit(db, "stock.adjusted", result, branchId);
    return result;
  });
}

/** Removes every expired batch (optionally just for one product) from sellable stock. */
export function writeOffExpired(db, principal, { branchId, today, product_id }) {
  const productId = optionalId(product_id, "product_id");
  return tx(db, () => {
    const expired = all(
      db,
      `SELECT b.*, p.name FROM batches b JOIN products p ON p.id = b.product_id
        WHERE b.branch_id = ? AND b.qty_remaining > 0 AND b.expiry_date < ? AND (? IS NULL OR b.product_id = ?)`,
      branchId,
      today,
      productId,
      productId
    );
    let qty = 0;
    let valueLost = 0;
    const before = new Map(expired.map((b) => [b.product_id, stockLevel(db, branchId, b.product_id)]));
    for (const batch of expired) {
      decreaseStock(db, {
        branchId,
        productId: batch.product_id,
        qty: batch.qty_remaining,
        type: "write_off",
        reason: `expired ${batch.expiry_date}`,
        userId: principal.userId,
        today,
        batchId: batch.id
      });
      qty += batch.qty_remaining;
      valueLost += Math.round(batch.qty_remaining * batch.cost);
    }
    notifyLowStock(db, branchId, before);
    const result = { batches: expired.length, qty: roundQty(qty), value: valueLost, items: expired.map((b) => ({ product_id: b.product_id, name: b.name, qty: b.qty_remaining, expiry_date: b.expiry_date })) };
    if (expired.length) emit(db, "stock.adjusted", { reason: "expired_write_off", ...result }, branchId);
    return result;
  });
}

/** Applies a physical stock count: each counted quantity replaces the system quantity. */
export function applyStockCount(db, principal, { branchId, today, items, note }) {
  items = list(items);
  if (!items.length) throw badRequest("Count at least one product", "VALIDATION");
  return tx(db, () => {
    const countId = run(db, "INSERT INTO stock_counts(branch_id, user_id, note, business_date, created_at) VALUES (?, ?, ?, ?, ?)", branchId, principal.userId, str(note, "note", { max: 300 }), today, nowIso()).id;
    let varianceQty = 0;
    let varianceValue = 0;
    const lines = [];
    const before = new Map();
    items.forEach((item, i) => {
      const product = productOrThrow(db, int(item.product_id, `items[${i}].product_id`, { required: true, min: 1 }));
      const counted = num(item.counted, `items[${i}].counted`, { required: true, min: 0 });
      const current = stockLevel(db, branchId, product.id);
      before.set(product.id, current);
      const diff = roundQty(counted - current);
      if (diff > 0) {
        increaseStock(db, { branchId, productId: product.id, qty: diff, unitCost: product.cost, source: "count", sourceId: countId, type: "count", reason: "stock count", refType: "count", refId: countId, userId: principal.userId, today, expiryDate: optionalDate(item.expiry_date, "expiry_date") });
      } else if (diff < 0) {
        decreaseStock(db, { branchId, productId: product.id, qty: -diff, type: "count", reason: "stock count", refType: "count", refId: countId, userId: principal.userId, today, order: "oldest", fallbackCost: product.cost });
      }
      varianceQty += diff;
      varianceValue += Math.round(diff * product.cost);
      lines.push({ product_id: product.id, name: product.name, system_qty: roundQty(current), counted, variance: diff, variance_value: Math.round(diff * product.cost) });
    });
    run(db, "UPDATE stock_counts SET items_counted = ?, variance_qty = ?, variance_value = ? WHERE id = ?", lines.length, roundQty(varianceQty), varianceValue, countId);
    notifyLowStock(db, branchId, before);
    return { id: countId, items_counted: lines.length, variance_qty: roundQty(varianceQty), variance_value: varianceValue, lines };
  });
}

export function listCounts(db, { branchId, limit = 30 }) {
  return all(db, "SELECT c.*, u.name AS user_name FROM stock_counts c LEFT JOIN users u ON u.id = c.user_id WHERE c.branch_id = ? ORDER BY c.id DESC LIMIT ?", branchId, limit);
}

// ---- transfers between branches -------------------------------------------------------

export function createTransfer(db, principal, { branchId, today, to_branch_id, items, note }) {
  const toBranchId = int(to_branch_id, "to_branch_id", { required: true, min: 1 });
  if (toBranchId === branchId) throw badRequest("Choose a different destination branch", "VALIDATION");
  const destination = getBranch(db, toBranchId);
  if (!destination.active) throw badRequest("Destination branch is inactive", "VALIDATION");
  items = list(items);
  if (!items.length) throw badRequest("Add at least one item to transfer", "VALIDATION");
  return tx(db, () => {
    const transferId = run(
      db,
      "INSERT INTO transfers(from_branch_id, to_branch_id, status, note, created_by, created_at) VALUES (?, ?, 'in_transit', ?, ?, ?)",
      branchId,
      toBranchId,
      str(note, "note", { max: 300 }),
      principal.userId,
      nowIso()
    ).id;
    const before = new Map();
    items.forEach((item, i) => {
      const product = productOrThrow(db, int(item.product_id, `items[${i}].product_id`, { required: true, min: 1 }));
      const qty = num(item.qty, `items[${i}].qty`, { required: true, min: 0.001 });
      const available = availability(db, branchId, product.id, today);
      if (qty > available.sellable) throw badRequest(`${product.name}: only ${available.sellable} unexpired in stock`, "INSUFFICIENT_STOCK");
      before.set(product.id, stockLevel(db, branchId, product.id));
      const allocations = decreaseStock(db, { branchId, productId: product.id, qty, type: "transfer_out", reason: `to ${destination.code}`, refType: "transfer", refId: transferId, userId: principal.userId, today, fallbackCost: product.cost });
      for (const a of allocations) {
        run(db, "INSERT INTO transfer_items(transfer_id, product_id, qty, batch_no, expiry_date, cost) VALUES (?, ?, ?, ?, ?, ?)", transferId, product.id, a.qty, a.batch_no, a.expiry_date, a.unit_cost);
      }
    });
    notifyLowStock(db, branchId, before);
    const transfer = getTransfer(db, transferId);
    emit(db, "stock.transfer", transfer, branchId);
    emit(db, "stock.transfer", transfer, toBranchId);
    return transfer;
  });
}

export function getTransfer(db, id) {
  const transfer = one(
    db,
    `SELECT t.*, fb.name AS from_branch_name, fb.code AS from_branch_code, tb.name AS to_branch_name, tb.code AS to_branch_code,
            cu.name AS created_by_name, ru.name AS received_by_name
       FROM transfers t JOIN branches fb ON fb.id = t.from_branch_id JOIN branches tb ON tb.id = t.to_branch_id
       LEFT JOIN users cu ON cu.id = t.created_by LEFT JOIN users ru ON ru.id = t.received_by WHERE t.id = ?`,
    id
  );
  if (!transfer) throw notFound("Transfer");
  transfer.items = all(db, "SELECT ti.*, p.name, p.sku, p.unit FROM transfer_items ti JOIN products p ON p.id = ti.product_id WHERE ti.transfer_id = ? ORDER BY ti.id", id);
  return transfer;
}

export function listTransfers(db, { branchId, limit = 50 }) {
  return all(
    db,
    `SELECT t.*, fb.name AS from_branch_name, tb.name AS to_branch_name,
            (SELECT COUNT(DISTINCT product_id) FROM transfer_items WHERE transfer_id = t.id) AS product_count,
            (SELECT SUM(qty) FROM transfer_items WHERE transfer_id = t.id) AS total_qty
       FROM transfers t JOIN branches fb ON fb.id = t.from_branch_id JOIN branches tb ON tb.id = t.to_branch_id
      WHERE (? IS NULL OR t.from_branch_id = ? OR t.to_branch_id = ?) ORDER BY t.id DESC LIMIT ?`,
    branchId,
    branchId,
    branchId,
    limit
  );
}

function landTransfer(db, principal, transfer, branchId, today, type) {
  for (const item of transfer.items) {
    increaseStock(db, {
      branchId,
      productId: item.product_id,
      qty: item.qty,
      unitCost: item.cost,
      batchNo: item.batch_no,
      expiryDate: item.expiry_date,
      source: "transfer",
      sourceId: transfer.id,
      type,
      reason: type === "transfer_in" ? `from ${transfer.from_branch_code}` : "transfer cancelled",
      refType: "transfer",
      refId: transfer.id,
      userId: principal.userId,
      today
    });
  }
}

export function receiveTransfer(db, principal, { branchId, today, id }) {
  return tx(db, () => {
    const transfer = getTransfer(db, id);
    if (transfer.to_branch_id !== branchId) throw badRequest("This transfer is addressed to another branch", "VALIDATION");
    if (transfer.status !== "in_transit") throw badRequest(`Transfer is already ${transfer.status}`, "VALIDATION");
    landTransfer(db, principal, transfer, branchId, today, "transfer_in");
    run(db, "UPDATE transfers SET status = 'received', received_by = ?, received_at = ? WHERE id = ?", principal.userId, nowIso(), id);
    const result = getTransfer(db, id);
    emit(db, "stock.transfer", result, transfer.from_branch_id);
    emit(db, "stock.transfer", result, branchId);
    return result;
  });
}

export function cancelTransfer(db, principal, { branchId, today, id }) {
  return tx(db, () => {
    const transfer = getTransfer(db, id);
    if (transfer.from_branch_id !== branchId && principal.role !== "owner") throw badRequest("Only the sending branch can cancel a transfer", "VALIDATION");
    if (transfer.status !== "in_transit") throw badRequest(`Transfer is already ${transfer.status}`, "VALIDATION");
    landTransfer(db, principal, transfer, transfer.from_branch_id, today, "transfer_cancel");
    run(db, "UPDATE transfers SET status = 'cancelled', received_by = ?, received_at = ? WHERE id = ?", principal.userId, nowIso(), id);
    return getTransfer(db, id);
  });
}

// ---- queries ---------------------------------------------------------------------------

export function listBatches(db, { branchId, productId, includeEmpty = false }) {
  return all(
    db,
    `SELECT b.*, br.code AS branch_code FROM batches b JOIN branches br ON br.id = b.branch_id
      WHERE (? IS NULL OR b.branch_id = ?) AND b.product_id = ? AND (? = 1 OR b.qty_remaining > 0)
      ORDER BY b.expiry_date IS NULL, b.expiry_date, b.id`,
    branchId,
    branchId,
    productId,
    includeEmpty ? 1 : 0
  );
}

export function listMovements(db, { branchId, productId = null, type = null, from = null, to = null, limit = 200 }) {
  return all(
    db,
    `SELECT m.*, p.name AS product_name, p.sku, p.unit, u.name AS user_name, b.expiry_date, b.batch_no
       FROM stock_movements m JOIN products p ON p.id = m.product_id
       LEFT JOIN users u ON u.id = m.user_id LEFT JOIN batches b ON b.id = m.batch_id
      WHERE (:branch IS NULL OR m.branch_id = :branch) AND (:product IS NULL OR m.product_id = :product)
        AND (:type IS NULL OR m.type = :type) AND (:from IS NULL OR m.business_date >= :from) AND (:to IS NULL OR m.business_date <= :to)
      ORDER BY m.id DESC LIMIT :limit`,
    { branch: branchId, product: productId, type, from, to, limit: Math.min(limit, 2000) }
  );
}

/** Expired stock, stock about to expire and products at/below reorder level. */
export function stockAlerts(db, { branchId = null, today }) {
  const batchRows = all(
    db,
    `SELECT b.id AS batch_id, b.branch_id, br.name AS branch_name, b.product_id, p.name, p.sku, p.unit, b.batch_no, b.expiry_date,
            b.qty_remaining AS qty, b.cost, CAST(julianday(b.expiry_date) - julianday(:today) AS INTEGER) AS days_left, p.expiry_warn_days
       FROM batches b JOIN products p ON p.id = b.product_id JOIN branches br ON br.id = b.branch_id
      WHERE (:branch IS NULL OR b.branch_id = :branch) AND b.qty_remaining > 0 AND b.expiry_date IS NOT NULL
        AND b.expiry_date <= date(:today, '+' || p.expiry_warn_days || ' days') AND br.active = 1
      ORDER BY b.expiry_date, p.name`,
    { branch: branchId, today }
  ).map((r) => ({ ...r, value: Math.round(r.qty * r.cost) }));
  const lowStock = all(
    db,
    `SELECT s.branch_id, br.name AS branch_name, p.id AS product_id, p.name, p.sku, p.unit, s.qty,
            COALESCE(bp.reorder_level, p.reorder_level) AS reorder_level, p.reorder_qty
       FROM stock s JOIN products p ON p.id = s.product_id JOIN branches br ON br.id = s.branch_id
       LEFT JOIN branch_products bp ON bp.product_id = p.id AND bp.branch_id = s.branch_id
      WHERE (:branch IS NULL OR s.branch_id = :branch) AND p.active = 1 AND p.track_stock = 1 AND COALESCE(bp.active, 1) = 1 AND br.active = 1
        AND COALESCE(bp.reorder_level, p.reorder_level) > 0 AND s.qty <= COALESCE(bp.reorder_level, p.reorder_level)
      ORDER BY s.qty - COALESCE(bp.reorder_level, p.reorder_level), p.name`,
    { branch: branchId }
  );
  const expired = batchRows.filter((r) => r.expiry_date < today);
  const expiring = batchRows.filter((r) => r.expiry_date >= today);
  return {
    expired,
    expiring,
    low_stock: lowStock.map((r) => ({ ...r, qty: roundQty(r.qty) })),
    counts: {
      expired: expired.length,
      expired_value: expired.reduce((s, r) => s + r.value, 0),
      expiring: expiring.length,
      expiring_value: expiring.reduce((s, r) => s + r.value, 0),
      low_stock: lowStock.length,
      out_of_stock: lowStock.filter((r) => r.qty <= 0).length
    }
  };
}
