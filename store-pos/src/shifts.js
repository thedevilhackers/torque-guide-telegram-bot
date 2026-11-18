import { all, one, run, tx } from "./db.js";
import { can } from "./auth.js";
import { emit } from "./webhooks.js";
import { badRequest, conflict, forbidden, int, notFound, nowIso, str } from "./util.js";

export function currentShift(db, branchId, userId) {
  if (!userId) return null;
  return one(db, "SELECT * FROM shifts WHERE branch_id = ? AND user_id = ? AND status = 'open' ORDER BY id DESC LIMIT 1", branchId, userId) ?? null;
}

export function openShift(db, principal, { branchId, opening_float, register }) {
  if (!principal.userId) throw badRequest("Shifts belong to staff accounts, not API keys", "VALIDATION");
  if (currentShift(db, branchId, principal.userId)) throw conflict("You already have an open shift at this branch", "SHIFT_OPEN");
  const { id } = run(
    db,
    "INSERT INTO shifts(branch_id, user_id, register, status, opening_float, opened_at) VALUES (?, ?, ?, 'open', ?, ?)",
    branchId,
    principal.userId,
    str(register, "register", { fallback: "POS-1", max: 30 }),
    int(opening_float, "opening_float", { min: 0 }),
    nowIso()
  );
  const shift = shiftReport(db, id);
  emit(db, "shift.opened", { id, user: principal.name, register: shift.shift.register, opening_float: shift.shift.opening_float }, branchId);
  return shift;
}

export function shiftReport(db, id) {
  const shift = one(db, "SELECT s.*, u.name AS user_name, c.name AS closed_by_name FROM shifts s JOIN users u ON u.id = s.user_id LEFT JOIN users c ON c.id = s.closed_by WHERE s.id = ?", id);
  if (!shift) throw notFound("Shift");
  const totals = one(
    db,
    `SELECT COALESCE(SUM(CASE WHEN type = 'sale' THEN 1 END), 0) AS sales_count,
            COALESCE(SUM(CASE WHEN type = 'refund' THEN 1 END), 0) AS refunds_count,
            COALESCE(SUM(CASE WHEN type = 'sale' THEN total END), 0) AS sales_total,
            COALESCE(SUM(CASE WHEN type = 'refund' THEN total END), 0) AS refunds_total,
            COALESCE(SUM(discount_total), 0) AS discount_total,
            COALESCE(SUM(tax_total), 0) AS tax_total
       FROM sales WHERE shift_id = ?`,
    id
  );
  const byMethod = all(
    db,
    "SELECT p.method, SUM(p.amount) AS amount, COUNT(*) AS count FROM sale_payments p JOIN sales s ON s.id = p.sale_id WHERE s.shift_id = ? GROUP BY p.method ORDER BY amount DESC",
    id
  );
  const movements = all(db, "SELECT m.*, u.name AS user_name FROM cash_movements m LEFT JOIN users u ON u.id = m.user_id WHERE m.shift_id = ? ORDER BY m.id", id);
  const cashNet = byMethod.find((m) => m.method === "cash")?.amount ?? 0;
  const payIn = movements.filter((m) => m.type === "pay_in").reduce((s, m) => s + m.amount, 0);
  const payOut = movements.filter((m) => m.type === "pay_out").reduce((s, m) => s + m.amount, 0);
  const expected = shift.opening_float + cashNet + payIn - payOut;
  return {
    shift,
    ...totals,
    net_total: totals.sales_total + totals.refunds_total,
    by_method: byMethod,
    cash_movements: movements,
    pay_in: payIn,
    pay_out: payOut,
    expected_cash: shift.status === "closed" ? shift.expected_cash : expected
  };
}

function assertOwnOrManager(principal, shift) {
  if (shift.user_id === principal.userId) return;
  if (can(principal, "shifts.manage") && (!principal.branchId || principal.branchId === shift.branch_id)) return;
  throw forbidden("Only the cashier or a manager can do that for this shift");
}

export function addCashMovement(db, principal, id, { type, amount, reason }) {
  const shift = one(db, "SELECT * FROM shifts WHERE id = ?", id);
  if (!shift) throw notFound("Shift");
  if (shift.status !== "open") throw badRequest("Shift is closed", "VALIDATION");
  assertOwnOrManager(principal, shift);
  if (!["pay_in", "pay_out"].includes(type)) throw badRequest("type must be pay_in or pay_out", "VALIDATION");
  run(
    db,
    "INSERT INTO cash_movements(shift_id, type, amount, reason, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    id,
    type,
    int(amount, "amount", { required: true, min: 1 }),
    str(reason, "reason", { required: true, max: 200 }),
    principal.userId,
    nowIso()
  );
  return shiftReport(db, id);
}

export function closeShift(db, principal, id, { counted_cash, note }) {
  return tx(db, () => {
    const shift = one(db, "SELECT * FROM shifts WHERE id = ?", id);
    if (!shift) throw notFound("Shift");
    if (shift.status !== "open") throw badRequest("Shift is already closed", "VALIDATION");
    assertOwnOrManager(principal, shift);
    const counted = int(counted_cash, "counted_cash", { required: true, min: 0 });
    const report = shiftReport(db, id);
    run(
      db,
      "UPDATE shifts SET status='closed', closed_at=?, closed_by=?, counted_cash=?, expected_cash=?, variance=?, note=? WHERE id=?",
      nowIso(),
      principal.userId,
      counted,
      report.expected_cash,
      counted - report.expected_cash,
      str(note, "note", { max: 300 }),
      id
    );
    const closed = shiftReport(db, id);
    emit(
      db,
      "shift.closed",
      {
        id,
        user: closed.shift.user_name,
        register: closed.shift.register,
        opened_at: closed.shift.opened_at,
        closed_at: closed.shift.closed_at,
        sales_count: closed.sales_count,
        net_total: closed.net_total,
        expected_cash: closed.shift.expected_cash,
        counted_cash: closed.shift.counted_cash,
        variance: closed.shift.variance,
        by_method: closed.by_method
      },
      shift.branch_id
    );
    return closed;
  });
}

export function listShifts(db, { branchId, status = null, limit = 50 }) {
  return all(
    db,
    `SELECT s.*, u.name AS user_name,
            (SELECT COALESCE(SUM(total), 0) FROM sales WHERE shift_id = s.id) AS net_total,
            (SELECT COUNT(*) FROM sales WHERE shift_id = s.id AND type = 'sale') AS sales_count
       FROM shifts s JOIN users u ON u.id = s.user_id
      WHERE (? IS NULL OR s.branch_id = ?) AND (? IS NULL OR s.status = ?)
      ORDER BY s.id DESC LIMIT ?`,
    branchId,
    branchId,
    status,
    status,
    limit
  );
}
