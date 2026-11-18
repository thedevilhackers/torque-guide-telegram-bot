import { all, one } from "./db.js";
import { stockAlerts } from "./inventory.js";
import { businessDate, addDays, roundQty, toCsv } from "./util.js";

/**
 * End-of-day report (Z report) for one branch, or consolidated for every branch when branchId is null.
 * Sales figures include tax; refunds are netted off on the day they happen.
 */
export function dailySummary(db, { branchId = null, date }) {
  const p = { branch: branchId, date };
  const scope = "(:branch IS NULL OR s.branch_id = :branch) AND s.business_date = :date";
  const t = one(
    db,
    `SELECT COUNT(CASE WHEN type = 'sale' THEN 1 END) AS transactions,
            COALESCE(SUM(CASE WHEN type = 'sale' THEN subtotal END), 0) AS gross_sales,
            COALESCE(SUM(CASE WHEN type = 'sale' THEN discount_total END), 0) AS discounts,
            COALESCE(SUM(CASE WHEN type = 'sale' THEN total END), 0) AS sales_total,
            COUNT(CASE WHEN type = 'refund' THEN 1 END) AS refunds_count,
            COALESCE(SUM(CASE WHEN type = 'refund' THEN -total END), 0) AS refunds_total,
            COALESCE(SUM(total), 0) AS net_sales,
            COALESCE(SUM(tax_total), 0) AS tax,
            COALESCE(SUM(cost_total), 0) AS cost,
            COALESCE(SUM(CASE WHEN type = 'sale' THEN items_count END), 0) AS items_sold,
            COUNT(DISTINCT customer_id) AS loyalty_customers,
            COALESCE(SUM(points_earned), 0) AS points_earned,
            COALESCE(SUM(points_redeemed), 0) AS points_redeemed
       FROM sales s WHERE ${scope}`,
    p
  );
  const netExTax = t.net_sales - t.tax;
  const grossProfit = netExTax - t.cost;
  const totals = {
    ...t,
    items_sold: roundQty(t.items_sold),
    net_sales_ex_tax: netExTax,
    gross_profit: grossProfit,
    margin_pct: netExTax ? Math.round((grossProfit / netExTax) * 1000) / 10 : 0,
    avg_basket: t.transactions ? Math.round(t.sales_total / t.transactions) : 0
  };

  const payments = all(
    db,
    `SELECT pay.method, SUM(pay.amount) AS amount, COUNT(DISTINCT pay.sale_id) AS count
       FROM sale_payments pay JOIN sales s ON s.id = pay.sale_id WHERE ${scope} GROUP BY pay.method ORDER BY amount DESC`,
    p
  );
  const categories = all(
    db,
    `SELECT COALESCE(c.name, 'Uncategorised') AS name, SUM(si.qty) AS qty, SUM(si.total) AS total, SUM(si.total - si.tax - si.cost) AS profit
       FROM sale_items si JOIN sales s ON s.id = si.sale_id LEFT JOIN categories c ON c.id = si.category_id
      WHERE ${scope} GROUP BY COALESCE(c.name, 'Uncategorised') ORDER BY total DESC`,
    p
  ).map((r) => ({ ...r, qty: roundQty(r.qty) }));
  const topProducts = all(
    db,
    `SELECT si.product_id, si.name, si.sku, SUM(si.qty) AS qty, SUM(si.total) AS total, SUM(si.total - si.tax - si.cost) AS profit
       FROM sale_items si JOIN sales s ON s.id = si.sale_id WHERE ${scope}
      GROUP BY si.product_id ORDER BY total DESC LIMIT 10`,
    p
  ).map((r) => ({ ...r, qty: roundQty(r.qty) }));
  const hourlyRows = all(
    db,
    `SELECT hour, COUNT(CASE WHEN type = 'sale' THEN 1 END) AS transactions, SUM(total) AS total FROM sales s WHERE ${scope} GROUP BY hour`,
    p
  );
  const hourly = Array.from({ length: 24 }, (_, hour) => {
    const row = hourlyRows.find((r) => r.hour === hour);
    return { hour, transactions: row?.transactions ?? 0, total: row?.total ?? 0 };
  });
  const cashiers = all(
    db,
    `SELECT u.id, COALESCE(u.name, 'API') AS name, COUNT(CASE WHEN s.type = 'sale' THEN 1 END) AS transactions, SUM(s.total) AS total
       FROM sales s LEFT JOIN users u ON u.id = s.user_id WHERE ${scope} GROUP BY s.user_id ORDER BY total DESC`,
    p
  );
  const movementRows = all(
    db,
    `SELECT type, SUM(qty) AS qty, SUM(qty * unit_cost) AS value FROM stock_movements m
      WHERE (:branch IS NULL OR m.branch_id = :branch) AND m.business_date = :date GROUP BY type`,
    p
  );
  const mv = (type) => movementRows.find((r) => r.type === type) ?? { qty: 0, value: 0 };
  const receipts = one(
    db,
    "SELECT COUNT(*) AS count, COALESCE(SUM(total_cost), 0) AS value FROM goods_receipts r WHERE (:branch IS NULL OR r.branch_id = :branch) AND r.business_date = :date",
    p
  );
  const stock = {
    receipts: receipts.count,
    received_value: receipts.value,
    received_qty: roundQty(mv("receive").qty),
    write_off_qty: roundQty(-mv("write_off").qty),
    write_off_value: Math.round(-mv("write_off").value),
    adjustments_value: Math.round(mv("adjust").value),
    count_variance_value: Math.round(mv("count").value),
    transfers_in_qty: roundQty(mv("transfer_in").qty),
    transfers_out_qty: roundQty(-mv("transfer_out").qty)
  };
  const shifts = all(
    db,
    `SELECT sh.id, u.name AS user_name, sh.register, sh.status, sh.opened_at, sh.closed_at, sh.opening_float, sh.expected_cash, sh.counted_cash, sh.variance
       FROM shifts sh JOIN users u ON u.id = sh.user_id
      WHERE sh.id IN (SELECT DISTINCT shift_id FROM sales s WHERE ${scope} AND shift_id IS NOT NULL) ORDER BY sh.id`,
    p
  );
  const alerts = stockAlerts(db, { branchId, today: date }).counts;

  const result = { date, branch_id: branchId, totals, payments, categories, top_products: topProducts, hourly, cashiers, stock, shifts, alerts };
  if (!branchId) {
    result.branches = all(
      db,
      `SELECT b.id, b.code, b.name,
              COUNT(CASE WHEN s.type = 'sale' THEN 1 END) AS transactions,
              COALESCE(SUM(s.total), 0) AS net_sales,
              COALESCE(SUM(s.total - s.tax_total - s.cost_total), 0) AS gross_profit
         FROM branches b LEFT JOIN sales s ON s.branch_id = b.id AND s.business_date = :date
        WHERE b.active = 1 GROUP BY b.id ORDER BY net_sales DESC`,
      { date }
    );
  }
  return result;
}

/** Daily net sales for the last N days ending at endDate. */
export function salesTrend(db, { branchId = null, endDate, days = 14 }) {
  const start = addDays(endDate, -(days - 1));
  const rows = all(
    db,
    `SELECT business_date AS date, COUNT(CASE WHEN type = 'sale' THEN 1 END) AS transactions, SUM(total) AS net_sales,
            SUM(total - tax_total - cost_total) AS gross_profit
       FROM sales WHERE (:branch IS NULL OR branch_id = :branch) AND business_date BETWEEN :start AND :end GROUP BY business_date`,
    { branch: branchId, start, end: endDate }
  );
  return Array.from({ length: days }, (_, i) => {
    const date = addDays(start, i);
    const row = rows.find((r) => r.date === date);
    return { date, transactions: row?.transactions ?? 0, net_sales: row?.net_sales ?? 0, gross_profit: row?.gross_profit ?? 0 };
  });
}

/** What to order, based on the last 14 days of sales, supplier lead time and reorder levels. */
export function reorderSuggestions(db, { branchId, today, days = 14 }) {
  const rows = all(
    db,
    `SELECT p.id AS product_id, p.name, p.sku, p.unit, p.reorder_qty, p.cost, sup.name AS supplier_name, COALESCE(sup.lead_days, 7) AS lead_days,
            COALESCE(s.qty, 0) AS stock, COALESCE(bp.reorder_level, p.reorder_level) AS reorder_level,
            COALESCE((SELECT SUM(si.qty) FROM sale_items si JOIN sales sa ON sa.id = si.sale_id
                       WHERE sa.branch_id = :branch AND si.product_id = p.id AND sa.business_date > date(:today, '-' || :days || ' days')), 0) AS sold
       FROM products p
       LEFT JOIN stock s ON s.product_id = p.id AND s.branch_id = :branch
       LEFT JOIN branch_products bp ON bp.product_id = p.id AND bp.branch_id = :branch
       LEFT JOIN suppliers sup ON sup.id = p.supplier_id
      WHERE p.active = 1 AND p.track_stock = 1 AND COALESCE(bp.active, 1) = 1`,
    { branch: branchId, today, days }
  );
  return rows
    .map((r) => {
      const avg = r.sold / days;
      const cover = avg > 0 ? r.stock / avg : null;
      const target = avg * (r.lead_days + 7) + r.reorder_level;
      const belowLevel = r.reorder_level > 0 && r.stock <= r.reorder_level;
      const runningOut = avg > 0 && cover < r.lead_days + 2;
      let suggested = Math.ceil(target - r.stock);
      if (belowLevel) suggested = Math.max(suggested, r.reorder_qty || 1);
      return {
        ...r,
        stock: roundQty(r.stock),
        sold: roundQty(r.sold),
        avg_daily: Math.round(avg * 100) / 100,
        days_of_cover: cover === null ? null : Math.round(cover * 10) / 10,
        suggested_qty: Math.max(suggested, 0),
        estimated_cost: Math.max(suggested, 0) * r.cost,
        include: (belowLevel || runningOut) && suggested > 0
      };
    })
    .filter((r) => r.include)
    .map(({ include, ...r }) => r)
    .sort((a, b) => (a.days_of_cover ?? -1) - (b.days_of_cover ?? -1));
}

export function stockValuation(db, { branchId = null }) {
  const rows = all(
    db,
    `SELECT COALESCE(c.name, 'Uncategorised') AS category,
            SUM(s.qty) AS qty,
            SUM((SELECT COALESCE(SUM(b.qty_remaining * b.cost), 0) FROM batches b WHERE b.branch_id = s.branch_id AND b.product_id = s.product_id)) AS cost_value,
            SUM(CASE WHEN s.qty > 0 THEN s.qty * COALESCE(bp.price, p.price) ELSE 0 END) AS retail_value
       FROM stock s JOIN products p ON p.id = s.product_id LEFT JOIN categories c ON c.id = p.category_id
       LEFT JOIN branch_products bp ON bp.product_id = s.product_id AND bp.branch_id = s.branch_id
      WHERE (:branch IS NULL OR s.branch_id = :branch) GROUP BY COALESCE(c.name, 'Uncategorised') ORDER BY cost_value DESC`,
    { branch: branchId }
  ).map((r) => ({ ...r, qty: roundQty(r.qty), cost_value: Math.round(r.cost_value), retail_value: Math.round(r.retail_value) }));
  return {
    categories: rows,
    cost_value: rows.reduce((s, r) => s + r.cost_value, 0),
    retail_value: rows.reduce((s, r) => s + r.retail_value, 0)
  };
}

/** Live status of every branch for head office (each branch uses its own local date). */
export function hqOverview(db) {
  const branches = all(db, "SELECT * FROM branches ORDER BY active DESC, name");
  return branches.map((b) => {
    const today = businessDate(b.timezone);
    const sales = one(
      db,
      `SELECT COUNT(CASE WHEN type = 'sale' THEN 1 END) AS transactions, COALESCE(SUM(total), 0) AS net_sales,
              COALESCE(SUM(total - tax_total - cost_total), 0) AS gross_profit, MAX(created_at) AS last_sale_at
         FROM sales WHERE branch_id = ? AND business_date = ?`,
      b.id,
      today
    );
    const openShifts = one(db, "SELECT COUNT(*) AS n FROM shifts WHERE branch_id = ? AND status = 'open'", b.id).n;
    const alerts = stockAlerts(db, { branchId: b.id, today }).counts;
    return {
      id: b.id,
      code: b.code,
      name: b.name,
      external_id: b.external_id,
      active: Boolean(b.active),
      locked: Boolean(b.locked),
      lock_reason: b.lock_reason,
      timezone: b.timezone,
      local_date: today,
      ...sales,
      open_shifts: openShifts,
      alerts
    };
  });
}

export function salesCsv(db, { branchId = null, from, to }) {
  const rows = all(
    db,
    `SELECT s.business_date, s.created_at, b.code AS branch, s.receipt_no, s.type, u.name AS cashier, c.phone AS customer,
            si.sku, si.name, si.qty, si.unit_price, si.discount, si.promo_name, si.tax_rate, si.tax, si.total, si.cost
       FROM sale_items si JOIN sales s ON s.id = si.sale_id JOIN branches b ON b.id = s.branch_id
       LEFT JOIN users u ON u.id = s.user_id LEFT JOIN customers c ON c.id = s.customer_id
      WHERE (:branch IS NULL OR s.branch_id = :branch) AND s.business_date BETWEEN :from AND :to ORDER BY s.id, si.id`,
    { branch: branchId, from, to }
  );
  return toCsv(rows, [
    { key: "business_date", label: "date" },
    { key: "created_at", label: "timestamp_utc" },
    { key: "branch" },
    { key: "receipt_no" },
    { key: "type" },
    { key: "cashier" },
    { key: "customer" },
    { key: "sku" },
    { key: "name" },
    { key: "qty" },
    { key: "unit_price" },
    { key: "discount" },
    { key: "promo_name", label: "promotion" },
    { key: "tax_rate" },
    { key: "tax" },
    { key: "total" },
    { key: "cost" }
  ]);
}

export function stockCsv(db, { branchId = null, today }) {
  const rows = all(
    db,
    `SELECT b.code AS branch, p.sku, p.name, COALESCE(c.name, '') AS category, p.unit, s.qty,
            COALESCE(bp.reorder_level, p.reorder_level) AS reorder_level, COALESCE(bp.price, p.price) AS price, p.cost,
            (SELECT MIN(expiry_date) FROM batches bt WHERE bt.branch_id = s.branch_id AND bt.product_id = s.product_id AND bt.qty_remaining > 0) AS next_expiry,
            (SELECT COALESCE(SUM(qty_remaining), 0) FROM batches bt WHERE bt.branch_id = s.branch_id AND bt.product_id = s.product_id AND bt.qty_remaining > 0 AND bt.expiry_date < :today) AS expired_qty,
            (SELECT code FROM barcodes WHERE product_id = p.id ORDER BY (pack_qty = 1) DESC LIMIT 1) AS barcode
       FROM stock s JOIN products p ON p.id = s.product_id JOIN branches b ON b.id = s.branch_id
       LEFT JOIN categories c ON c.id = p.category_id LEFT JOIN branch_products bp ON bp.product_id = p.id AND bp.branch_id = s.branch_id
      WHERE (:branch IS NULL OR s.branch_id = :branch) ORDER BY b.code, p.name`,
    { branch: branchId, today }
  );
  return toCsv(rows, [
    { key: "branch" },
    { key: "sku" },
    { key: "barcode" },
    { key: "name" },
    { key: "category" },
    { key: "unit" },
    { key: "qty" },
    { key: "reorder_level" },
    { key: "price" },
    { key: "cost" },
    { key: "next_expiry" },
    { key: "expired_qty" }
  ]);
}
