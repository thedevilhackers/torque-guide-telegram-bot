import { all, one, run } from "./db.js";
import { badRequest, bool, int, notFound, nowIso, num, optionalDate, optionalId, str } from "./util.js";

export const PROMO_TYPES = ["percent", "amount", "multibuy", "bundle"];

export function activePromotions(db, branchId, today) {
  return all(
    db,
    `SELECT id, name, type, product_id, category_id, value, buy_qty, free_qty FROM promotions
      WHERE active = 1 AND (branch_id IS NULL OR branch_id = ?)
        AND (starts_on IS NULL OR starts_on <= ?) AND (ends_on IS NULL OR ends_on >= ?)`,
    branchId,
    today,
    today
  );
}

export function listPromotions(db, { branchId = null } = {}) {
  return all(
    db,
    `SELECT pr.*, p.name AS product_name, c.name AS category_name, b.name AS branch_name
       FROM promotions pr LEFT JOIN products p ON p.id = pr.product_id LEFT JOIN categories c ON c.id = pr.category_id
       LEFT JOIN branches b ON b.id = pr.branch_id
      WHERE (? IS NULL OR pr.branch_id IS NULL OR pr.branch_id = ?)
      ORDER BY pr.active DESC, pr.ends_on IS NULL, pr.ends_on, pr.name`,
    branchId,
    branchId
  );
}

function promoFields(db, principal, data, existing = {}) {
  const pick = (k) => (data[k] === undefined ? existing[k] : data[k]);
  const type = str(pick("type"), "type", { required: true });
  if (!PROMO_TYPES.includes(type)) throw badRequest(`type must be one of ${PROMO_TYPES.join(", ")}`, "VALIDATION");
  const productId = optionalId(pick("product_id"), "product_id");
  const categoryId = productId ? null : optionalId(pick("category_id"), "category_id");
  if (productId && !one(db, "SELECT id FROM products WHERE id = ?", productId)) throw badRequest("product_id does not exist", "VALIDATION");
  if (categoryId && !one(db, "SELECT id FROM categories WHERE id = ?", categoryId)) throw badRequest("category_id does not exist", "VALIDATION");
  if (!productId && !categoryId && type !== "percent") throw badRequest("Choose a product or category for this promotion", "VALIDATION");
  const f = {
    name: str(pick("name"), "name", { required: true, max: 80 }),
    type,
    product_id: productId,
    category_id: categoryId,
    value: 0,
    buy_qty: 0,
    free_qty: 0,
    starts_on: optionalDate(pick("starts_on"), "starts_on"),
    ends_on: optionalDate(pick("ends_on"), "ends_on"),
    branch_id: optionalId(pick("branch_id"), "branch_id"),
    active: bool(pick("active"), true) ? 1 : 0
  };
  if (f.starts_on && f.ends_on && f.ends_on < f.starts_on) throw badRequest("End date is before start date", "VALIDATION");
  if (type === "percent") f.value = num(pick("value"), "value", { required: true, min: 0.01, max: 100 });
  if (type === "amount") f.value = int(pick("value"), "value", { required: true, min: 1 });
  if (type === "multibuy") {
    f.buy_qty = int(pick("buy_qty"), "buy_qty", { required: true, min: 1, max: 100 });
    f.free_qty = int(pick("free_qty"), "free_qty", { required: true, min: 1, max: 100 });
  }
  if (type === "bundle") {
    f.buy_qty = int(pick("buy_qty"), "buy_qty", { required: true, min: 2, max: 100 });
    f.value = int(pick("value"), "value", { required: true, min: 1 });
  }
  // Branch managers can only run promotions in their own branch.
  if (principal.branchId) f.branch_id = principal.branchId;
  return f;
}

export function savePromotion(db, principal, id, data) {
  if (id) {
    const existing = one(db, "SELECT * FROM promotions WHERE id = ?", id);
    if (!existing) throw notFound("Promotion");
    if (principal.branchId && existing.branch_id !== principal.branchId) throw badRequest("This promotion is managed by head office", "VALIDATION");
    const f = promoFields(db, principal, data, existing);
    run(
      db,
      "UPDATE promotions SET name=?, type=?, product_id=?, category_id=?, value=?, buy_qty=?, free_qty=?, starts_on=?, ends_on=?, branch_id=?, active=? WHERE id=?",
      ...Object.values(f),
      id
    );
    return one(db, "SELECT * FROM promotions WHERE id = ?", id);
  }
  const f = promoFields(db, principal, data);
  const { id: newId } = run(
    db,
    "INSERT INTO promotions(name, type, product_id, category_id, value, buy_qty, free_qty, starts_on, ends_on, branch_id, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ...Object.values(f),
    nowIso()
  );
  return one(db, "SELECT * FROM promotions WHERE id = ?", newId);
}

export function deletePromotion(db, principal, id) {
  const existing = one(db, "SELECT * FROM promotions WHERE id = ?", id);
  if (!existing) throw notFound("Promotion");
  if (principal.branchId && existing.branch_id !== principal.branchId) throw badRequest("This promotion is managed by head office", "VALIDATION");
  run(db, "DELETE FROM promotions WHERE id = ?", id);
}
