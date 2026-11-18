import { all, one, run } from "./db.js";
import { badRequest, conflict, notFound, nowIso, str } from "./util.js";

function normalisePhone(phone) {
  const cleaned = String(phone ?? "").replace(/[^\d+]/g, "");
  if (!cleaned) return null;
  if (cleaned.replace(/\D/g, "").length < 6) throw badRequest("Phone number looks too short", "VALIDATION");
  return cleaned;
}

export function searchCustomers(db, { search = "", limit = 50 } = {}) {
  const term = String(search).trim();
  if (!term) return all(db, "SELECT * FROM customers ORDER BY last_visit_at DESC NULLS LAST, id DESC LIMIT ?", limit);
  const digits = term.replace(/[^\d]/g, "");
  return all(
    db,
    `SELECT * FROM customers WHERE name LIKE ? OR email LIKE ? ${digits.length >= 3 ? "OR REPLACE(phone, '+', '') LIKE ?" : ""}
      ORDER BY last_visit_at DESC NULLS LAST LIMIT ?`,
    ...[`%${term}%`, `%${term}%`, ...(digits.length >= 3 ? [`%${digits}%`] : []), limit]
  );
}

export function getCustomer(db, id) {
  const customer = one(db, "SELECT * FROM customers WHERE id = ?", id);
  if (!customer) throw notFound("Customer");
  customer.recent_sales = all(
    db,
    `SELECT s.id, s.receipt_no, s.type, s.total, s.points_earned, s.points_redeemed, s.created_at, b.name AS branch_name
       FROM sales s JOIN branches b ON b.id = s.branch_id WHERE s.customer_id = ? ORDER BY s.id DESC LIMIT 20`,
    id
  );
  return customer;
}

export function saveCustomer(db, id, data, branchId = null) {
  const phone = normalisePhone(data.phone);
  const name = str(data.name, "name", { max: 80 });
  const email = str(data.email, "email", { max: 120 });
  if (!phone && !name) throw badRequest("Enter a phone number or name", "VALIDATION");
  if (phone) {
    const dupe = one(db, "SELECT id, name FROM customers WHERE phone = ? AND id IS NOT ?", phone, id ?? null);
    if (dupe) throw conflict(`Phone number already belongs to ${dupe.name || "another customer"}`, "PHONE_TAKEN", { customer_id: dupe.id });
  }
  if (id) {
    if (!run(db, "UPDATE customers SET phone = ?, name = ?, email = ? WHERE id = ?", phone, name, email, id).changes) throw notFound("Customer");
    return getCustomer(db, id);
  }
  const { id: newId } = run(db, "INSERT INTO customers(phone, name, email, branch_id, created_at) VALUES (?, ?, ?, ?, ?)", phone, name, email, branchId, nowIso());
  return getCustomer(db, newId);
}
