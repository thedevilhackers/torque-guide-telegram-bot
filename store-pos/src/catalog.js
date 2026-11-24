import { all, nextCounter, one, run, tx, value } from "./db.js";
import { gtinVariants, parseGs1, retailBarcode, stripSymbology } from "./gs1.js";
import { getSettings } from "./settings.js";
import { badRequest, bool, conflict, gs1CheckDigit, int, notFound, nowIso, num, optionalId, roundQty, str } from "./util.js";

export const UNITS = ["pcs", "kg", "g", "l", "ml", "pack", "box", "dozen"];

// ---- categories & suppliers ------------------------------------------------

export function listCategories(db) {
  return all(
    db,
    `SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id AND p.active = 1) AS product_count
       FROM categories c ORDER BY c.name`
  );
}

export function saveCategory(db, id, data) {
  const name = str(data.name, "name", { required: true, max: 60 });
  const color = str(data.color, "color", { max: 20 });
  const dupe = one(db, "SELECT id FROM categories WHERE name = ? AND id IS NOT ?", name, id ?? null);
  if (dupe) throw conflict("A category with that name already exists");
  if (id) {
    if (!run(db, "UPDATE categories SET name = ?, color = ? WHERE id = ?", name, color, id).changes) throw notFound("Category");
    return one(db, "SELECT * FROM categories WHERE id = ?", id);
  }
  const { id: newId } = run(db, "INSERT INTO categories(name, color) VALUES (?, ?)", name, color);
  return one(db, "SELECT * FROM categories WHERE id = ?", newId);
}

export function deleteCategory(db, id) {
  if (!run(db, "DELETE FROM categories WHERE id = ?", id).changes) throw notFound("Category");
}

function categoryIdFrom(db, data) {
  if (data.category_id !== undefined && data.category_id !== null && data.category_id !== "") {
    const id = int(data.category_id, "category_id", { min: 1 });
    if (!one(db, "SELECT id FROM categories WHERE id = ?", id)) throw badRequest("category_id does not exist", "VALIDATION");
    return id;
  }
  if (data.category) {
    const name = str(data.category, "category", { max: 60 });
    const existing = one(db, "SELECT id FROM categories WHERE name = ?", name);
    return existing ? existing.id : run(db, "INSERT INTO categories(name) VALUES (?)", name).id;
  }
  return undefined;
}

export function listSuppliers(db) {
  return all(db, "SELECT * FROM suppliers ORDER BY active DESC, name");
}

export function saveSupplier(db, id, data) {
  const fields = [
    str(data.name, "name", { required: true, max: 120 }),
    str(data.phone, "phone", { max: 40 }),
    str(data.email, "email", { max: 120 }),
    int(data.lead_days, "lead_days", { min: 0, max: 120, fallback: 7 }),
    bool(data.active, true) ? 1 : 0
  ];
  if (id) {
    if (!run(db, "UPDATE suppliers SET name=?, phone=?, email=?, lead_days=?, active=? WHERE id=?", ...fields, id).changes) throw notFound("Supplier");
    return one(db, "SELECT * FROM suppliers WHERE id = ?", id);
  }
  const { id: newId } = run(db, "INSERT INTO suppliers(name, phone, email, lead_days, active, created_at) VALUES (?, ?, ?, ?, ?, ?)", ...fields, nowIso());
  return one(db, "SELECT * FROM suppliers WHERE id = ?", newId);
}

// ---- product queries -------------------------------------------------------------

function productSelect(branchId) {
  const stockExpr = branchId
    ? "COALESCE((SELECT qty FROM stock s WHERE s.product_id = p.id AND s.branch_id = :branch), 0)"
    : "COALESCE((SELECT SUM(qty) FROM stock s WHERE s.product_id = p.id), 0)";
  const batchScope = branchId ? "b.branch_id = :branch AND" : "";
  return `
    SELECT p.*, c.name AS category_name, sup.name AS supplier_name,
           bp.price AS branch_price,
           COALESCE(bp.price, p.price) AS effective_price,
           COALESCE(bp.reorder_level, p.reorder_level) AS effective_reorder_level,
           COALESCE(bp.active, 1) AS branch_active,
           ${stockExpr} AS stock_qty,
           (SELECT MIN(b.expiry_date) FROM batches b
             WHERE ${batchScope} b.product_id = p.id AND b.qty_remaining > 0 AND b.expiry_date IS NOT NULL) AS next_expiry,
           COALESCE((SELECT SUM(b.qty_remaining) FROM batches b
             WHERE ${batchScope} b.product_id = p.id AND b.qty_remaining > 0 AND b.expiry_date < :today), 0) AS expired_qty,
           (SELECT code FROM barcodes WHERE product_id = p.id ORDER BY (pack_qty = 1) DESC, rowid LIMIT 1) AS barcode
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      LEFT JOIN suppliers sup ON sup.id = p.supplier_id
      LEFT JOIN branch_products bp ON bp.product_id = p.id AND bp.branch_id = :branch`;
}

function shapeProduct(row) {
  if (!row) return row;
  return {
    ...row,
    sold_by_weight: Boolean(row.sold_by_weight),
    track_expiry: Boolean(row.track_expiry),
    track_stock: Boolean(row.track_stock),
    quick_key: Boolean(row.quick_key),
    active: Boolean(row.active),
    branch_active: Boolean(row.branch_active),
    stock_qty: roundQty(row.stock_qty),
    expired_qty: roundQty(row.expired_qty)
  };
}

export function listProducts(db, { branchId = null, today, search = "", categoryId = null, filter = "", status = "active", limit = 100, offset = 0, updatedSince = null } = {}) {
  const where = [];
  const params = { branch: branchId, today: today ?? new Date().toISOString().slice(0, 10) };
  if (status === "active") where.push("active = 1 AND branch_active = 1");
  else if (status === "inactive") where.push("(active = 0 OR branch_active = 0)");
  if (search) {
    params.search = `%${search.replace(/[%_]/g, "\\$&")}%`;
    params.exact = search;
    where.push(`(name LIKE :search ESCAPE '\\' OR sku = :exact OR plu = :exact
               OR id IN (SELECT product_id FROM barcodes WHERE code = :exact))`);
  }
  if (categoryId) {
    params.category = categoryId;
    where.push("category_id = :category");
  }
  if (updatedSince) {
    params.updated = updatedSince;
    where.push("updated_at > :updated");
  }
  switch (filter) {
    case "low":
      where.push("track_stock = 1 AND effective_reorder_level > 0 AND stock_qty <= effective_reorder_level");
      break;
    case "out":
      where.push("track_stock = 1 AND stock_qty <= 0");
      break;
    case "expiring":
      where.push("next_expiry IS NOT NULL AND next_expiry >= :today AND next_expiry <= date(:today, '+' || expiry_warn_days || ' days')");
      break;
    case "expired":
      where.push("expired_qty > 0");
      break;
    case "quick":
      where.push("quick_key = 1");
      break;
    default:
      break;
  }
  const base = `SELECT * FROM (${productSelect(branchId)}) ${where.length ? `WHERE ${where.join(" AND ")}` : ""}`;
  const total = value(db, `SELECT COUNT(*) FROM (${base})`, params);
  const items = all(db, `${base} ORDER BY name LIMIT :limit OFFSET :offset`, {
    ...params,
    limit: Math.min(Math.max(Number(limit) || 100, 1), 1000),
    offset: Math.max(Number(offset) || 0, 0)
  }).map(shapeProduct);
  return { items, total };
}

export function getProduct(db, id, { branchId = null, today } = {}) {
  const row = one(db, `${productSelect(branchId)} WHERE p.id = :id`, {
    branch: branchId,
    today: today ?? new Date().toISOString().slice(0, 10),
    id
  });
  if (!row) throw notFound("Product");
  const product = shapeProduct(row);
  product.barcodes = all(db, "SELECT code, pack_qty FROM barcodes WHERE product_id = ? ORDER BY (pack_qty = 1) DESC, rowid", id);
  return product;
}

// ---- product writes ----------------------------------------------------------------

function normaliseBarcodes(data) {
  let raw = [];
  if (Array.isArray(data.barcodes)) raw = data.barcodes;
  else if (data.barcode) raw = [data.barcode];
  else return undefined;
  const seen = new Set();
  return raw
    .map((b) => (typeof b === "string" || typeof b === "number" ? { code: String(b), pack_qty: 1 } : b))
    .map((b) => ({
      code: str(b.code, "barcode", { required: true, max: 64 }),
      pack_qty: num(b.pack_qty, "pack_qty", { min: 0.001, fallback: 1 })
    }))
    .filter((b) => {
      if (!/^[A-Za-z0-9._\-/]+$/.test(b.code)) throw badRequest(`Barcode "${b.code}" has invalid characters`, "VALIDATION");
      if (seen.has(b.code)) return false;
      seen.add(b.code);
      return true;
    });
}

function productFields(db, data, existing) {
  const pick = (key) => (data[key] === undefined ? existing?.[key] : data[key]);
  const unit = str(pick("unit"), "unit", { fallback: "pcs", max: 10 });
  if (!UNITS.includes(unit)) throw badRequest(`unit must be one of ${UNITS.join(", ")}`, "VALIDATION");
  let plu = pick("plu");
  plu = plu === null || plu === undefined || plu === "" ? null : String(plu).trim();
  if (plu !== null && !/^\d{1,5}$/.test(plu)) throw badRequest("PLU must be 1 to 5 digits", "VALIDATION");
  if (plu !== null) plu = plu.padStart(5, "0");
  const categoryId = categoryIdFrom(db, data);
  const supplierId = data.supplier_id === undefined ? existing?.supplier_id ?? null : optionalId(data.supplier_id, "supplier_id");
  if (supplierId && !one(db, "SELECT id FROM suppliers WHERE id = ?", supplierId)) throw badRequest("supplier_id does not exist", "VALIDATION");
  const settings = getSettings(db);
  return {
    name: str(pick("name"), "name", { required: true, max: 160 }),
    category_id: categoryId === undefined ? existing?.category_id ?? null : categoryId,
    supplier_id: supplierId,
    unit,
    sold_by_weight: bool(pick("sold_by_weight")) ? 1 : 0,
    plu,
    price: int(pick("price"), "price", { min: 0, required: !existing }),
    cost: int(pick("cost"), "cost", { min: 0 }),
    tax_rate: num(pick("tax_rate"), "tax_rate", { min: 0, max: 100 }),
    reorder_level: num(pick("reorder_level"), "reorder_level", { min: 0 }),
    reorder_qty: num(pick("reorder_qty"), "reorder_qty", { min: 0 }),
    track_stock: bool(pick("track_stock"), true) ? 1 : 0,
    track_expiry: bool(pick("track_expiry"), true) ? 1 : 0,
    expiry_warn_days: int(pick("expiry_warn_days"), "expiry_warn_days", { min: 0, max: 365, fallback: settings.default_expiry_warn_days }),
    min_age: int(pick("min_age"), "min_age", { min: 0, max: 99 }),
    quick_key: bool(pick("quick_key")) ? 1 : 0,
    external_id: pick("external_id") === undefined || pick("external_id") === "" ? null : str(pick("external_id"), "external_id", { max: 100 }) || null,
    active: bool(pick("active"), true) ? 1 : 0
  };
}

function assertBarcodesFree(db, barcodes, productId = null) {
  for (const b of barcodes ?? []) {
    const owner = one(db, "SELECT p.id, p.name FROM barcodes b JOIN products p ON p.id = b.product_id WHERE b.code = ?", b.code);
    if (owner && owner.id !== productId) throw conflict(`Barcode ${b.code} already belongs to "${owner.name}"`, "BARCODE_TAKEN", { product_id: owner.id });
  }
}

function writeBarcodes(db, productId, barcodes) {
  if (!barcodes) return;
  assertBarcodesFree(db, barcodes, productId);
  run(db, "DELETE FROM barcodes WHERE product_id = ?", productId);
  for (const b of barcodes) run(db, "INSERT INTO barcodes(code, product_id, pack_qty) VALUES (?, ?, ?)", b.code, productId, b.pack_qty);
}

function assertUnique(db, f, id) {
  if (f.plu && one(db, "SELECT id FROM products WHERE plu = ? AND id IS NOT ?", f.plu, id ?? null)) throw conflict(`PLU ${f.plu} is already used`, "PLU_TAKEN");
  if (f.external_id && one(db, "SELECT id FROM products WHERE external_id = ? AND id IS NOT ?", f.external_id, id ?? null)) {
    throw conflict(`external_id ${f.external_id} is already used`, "EXTERNAL_ID_TAKEN");
  }
}

export function createProduct(db, data) {
  return tx(db, () => {
    const f = productFields(db, data);
    const barcodes = normaliseBarcodes(data) ?? [];
    assertBarcodesFree(db, barcodes);
    let sku = str(data.sku, "sku", { max: 60 });
    if (!sku) {
      // Default the SKU to the barcode, or a generated code when that is taken.
      sku = barcodes[0]?.code;
      while (!sku || one(db, "SELECT id FROM products WHERE sku = ?", sku)) sku = `SKU-${String(nextCounter(db, "sku")).padStart(6, "0")}`;
    }
    if (one(db, "SELECT id FROM products WHERE sku = ?", sku)) throw conflict(`SKU ${sku} already exists`, "SKU_TAKEN");
    assertUnique(db, f);
    const now = nowIso();
    const { id } = run(
      db,
      `INSERT INTO products(sku, name, category_id, supplier_id, unit, sold_by_weight, plu, price, cost, tax_rate, reorder_level, reorder_qty,
                            track_stock, track_expiry, expiry_warn_days, min_age, quick_key, external_id, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      sku,
      f.name,
      f.category_id,
      f.supplier_id,
      f.unit,
      f.sold_by_weight,
      f.plu,
      f.price,
      f.cost,
      f.tax_rate,
      f.reorder_level,
      f.reorder_qty,
      f.track_stock,
      f.track_expiry,
      f.expiry_warn_days,
      f.min_age,
      f.quick_key,
      f.external_id,
      f.active,
      now,
      now
    );
    writeBarcodes(db, id, barcodes);
    return id;
  });
}

export function updateProduct(db, id, data) {
  return tx(db, () => {
    const existing = one(db, "SELECT * FROM products WHERE id = ?", id);
    if (!existing) throw notFound("Product");
    const f = productFields(db, data, existing);
    const sku = data.sku === undefined ? existing.sku : str(data.sku, "sku", { required: true, max: 60 });
    if (one(db, "SELECT id FROM products WHERE sku = ? AND id != ?", sku, id)) throw conflict(`SKU ${sku} already exists`, "SKU_TAKEN");
    assertUnique(db, f, id);
    run(
      db,
      `UPDATE products SET sku=?, name=?, category_id=?, supplier_id=?, unit=?, sold_by_weight=?, plu=?, price=?, cost=?, tax_rate=?,
              reorder_level=?, reorder_qty=?, track_stock=?, track_expiry=?, expiry_warn_days=?, min_age=?, quick_key=?, external_id=?, active=?, updated_at=?
        WHERE id=?`,
      sku,
      f.name,
      f.category_id,
      f.supplier_id,
      f.unit,
      f.sold_by_weight,
      f.plu,
      f.price,
      f.cost,
      f.tax_rate,
      f.reorder_level,
      f.reorder_qty,
      f.track_stock,
      f.track_expiry,
      f.expiry_warn_days,
      f.min_age,
      f.quick_key,
      f.external_id,
      f.active,
      nowIso(),
      id
    );
    writeBarcodes(db, id, normaliseBarcodes(data));
    return id;
  });
}

/**
 * Create-or-update many products in one call (used by the admin panel to sync the catalogue).
 * Matches existing products by external_id, then sku, then any barcode.
 */
export function bulkUpsertProducts(db, items) {
  if (!Array.isArray(items) || items.length === 0) throw badRequest("Send a non-empty list of products", "VALIDATION");
  if (items.length > 5000) throw badRequest("At most 5000 products per request", "VALIDATION");
  const result = { created: 0, updated: 0, errors: [], ids: [] };
  items.forEach((item, index) => {
    try {
      const match =
        (item.external_id && one(db, "SELECT id FROM products WHERE external_id = ?", String(item.external_id))) ||
        (item.sku && one(db, "SELECT id FROM products WHERE sku = ?", String(item.sku))) ||
        (normaliseBarcodes(item) ?? []).map((b) => one(db, "SELECT product_id AS id FROM barcodes WHERE code = ?", b.code)).find(Boolean);
      if (match) {
        updateProduct(db, match.id, item);
        result.updated += 1;
        result.ids.push(match.id);
      } else {
        result.ids.push(createProduct(db, item));
        result.created += 1;
      }
    } catch (error) {
      result.errors.push({ index, sku: item?.sku, error: error.message });
      result.ids.push(null);
    }
  });
  return result;
}

export function setBranchProduct(db, branchId, productId, data) {
  if (!one(db, "SELECT id FROM products WHERE id = ?", productId)) throw notFound("Product");
  const existing = one(db, "SELECT * FROM branch_products WHERE branch_id = ? AND product_id = ?", branchId, productId) ?? {};
  const price = data.price === undefined ? existing.price ?? null : data.price === null || data.price === "" ? null : int(data.price, "price", { min: 0 });
  const reorder = data.reorder_level === undefined ? existing.reorder_level ?? null : data.reorder_level === null || data.reorder_level === "" ? null : num(data.reorder_level, "reorder_level", { min: 0 });
  const active = data.active === undefined ? existing.active ?? 1 : bool(data.active) ? 1 : 0;
  run(
    db,
    `INSERT INTO branch_products(branch_id, product_id, price, reorder_level, active) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(branch_id, product_id) DO UPDATE SET price = excluded.price, reorder_level = excluded.reorder_level, active = excluded.active`,
    branchId,
    productId,
    price,
    reorder,
    active
  );
  run(db, "UPDATE products SET updated_at = ? WHERE id = ?", nowIso(), productId);
}

/** Assigns an in-store EAN-13 (prefix 20) to a product that has no manufacturer barcode. */
export function generateBarcode(db, productId) {
  if (!one(db, "SELECT id FROM products WHERE id = ?", productId)) throw notFound("Product");
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const body = `20${String(nextCounter(db, "internal_barcode")).padStart(10, "0")}`;
    const code = body + gs1CheckDigit(body);
    if (!one(db, "SELECT code FROM barcodes WHERE code = ?", code)) {
      run(db, "INSERT INTO barcodes(code, product_id, pack_qty) VALUES (?, ?, 1)", code, productId);
      run(db, "UPDATE products SET updated_at = ? WHERE id = ?", nowIso(), productId);
      return code;
    }
  }
  throw conflict("Could not allocate a unique barcode");
}

// ---- scanning ----------------------------------------------------------------

function barcodeVariants(code) {
  const variants = [code];
  if (/^\d{12}$/.test(code)) variants.push(`0${code}`); // UPC-A read as EAN-13
  if (/^0\d{12}$/.test(code)) variants.push(code.slice(1));
  if (/^\d{14}$/.test(code) && code.startsWith("0")) variants.push(code.slice(1));
  return variants;
}

function unknownBarcode(details) {
  const err = notFound("Product for this barcode");
  err.code = "UNKNOWN_BARCODE";
  err.details = details;
  return err;
}

/**
 * GS1 2D codes and GS1-128 labels: find the product by its GTIN and return what the code says
 * about this pack (expiry, batch, serial, carton count, weight) as `gs1`.
 */
function lookupGs1(db, gs1, load) {
  const info = {
    gtin: gs1.gtin,
    expiry_date: gs1.expiry_date,
    best_before: gs1.best_before,
    // The date to use for stock: expiry (17), else best before (15).
    pack_expiry: gs1.expiry_date ?? gs1.best_before,
    batch: gs1.batch,
    serial: gs1.serial,
    count: gs1.count,
    net_weight_kg: gs1.net_weight_kg,
    sscc: gs1.sscc,
    ais: gs1.ais
  };
  if (gs1.gtin) {
    const candidates = [...new Set(gtinVariants(gs1.gtin).flatMap(barcodeVariants))];
    for (const variant of candidates) {
      const hit = one(db, "SELECT product_id, pack_qty FROM barcodes WHERE code = ?", variant);
      if (!hit) continue;
      const product = load(hit.product_id);
      let qty = hit.pack_qty;
      let source = hit.pack_qty === 1 ? "barcode" : "case";
      if (gs1.count) {
        qty = roundQty(gs1.count * hit.pack_qty);
        source = "case";
      } else if (gs1.net_weight_kg && product.sold_by_weight && (product.unit === "kg" || product.unit === "g")) {
        qty = roundQty(product.unit === "g" ? gs1.net_weight_kg * 1000 : gs1.net_weight_kg);
        source = "scale_weight";
      }
      return { product, qty, source, gs1: info };
    }
  }
  // details.code is the plain barcode to save on a new product (EAN-13 for retail packs).
  throw unknownBarcode({ code: gs1.gtin ? retailBarcode(gs1.gtin) : null, gs1: info });
}

/**
 * Resolves whatever the scanner (or cashier) typed into a product and quantity.
 * Order: GS1 data (2D codes, GS1-128) → exact barcode (incl. case packs) → scale/price-embedded EAN-13 → PLU → SKU.
 */
export function lookupCode(db, rawCode, { branchId, today }) {
  let code = String(rawCode ?? "").trim();
  if (!code) throw badRequest("Scan or type a barcode", "VALIDATION");
  const load = (id) => getProduct(db, id, { branchId, today });

  const gs1 = parseGs1(code);
  if (gs1) return lookupGs1(db, gs1, load);
  code = stripSymbology(code);

  for (const variant of barcodeVariants(code)) {
    const hit = one(db, "SELECT product_id, pack_qty FROM barcodes WHERE code = ?", variant);
    if (hit) return { product: load(hit.product_id), qty: hit.pack_qty, source: hit.pack_qty === 1 ? "barcode" : "case" };
  }

  if (/^\d{13}$/.test(code)) {
    const rule = getSettings(db).embedded_barcodes.find((r) => code.startsWith(r.prefix));
    if (rule) {
      const plu = code.slice(2, 7);
      const embedded = Number(code.slice(7, 12));
      const productId = value(db, "SELECT id FROM products WHERE plu = ?", plu);
      if (productId) {
        const product = load(productId);
        const qty =
          rule.type === "weight"
            ? roundQty(embedded / 1000)
            : product.effective_price > 0
              ? roundQty(embedded / product.effective_price)
              : 1;
        return { product, qty, source: rule.type === "weight" ? "scale_weight" : "scale_price", embedded_value: embedded, line_total: rule.type === "price" ? embedded : undefined };
      }
    }
  }

  if (/^\d{1,5}$/.test(code)) {
    const productId = value(db, "SELECT id FROM products WHERE plu = ?", code.padStart(5, "0"));
    if (productId) return { product: load(productId), qty: 1, source: "plu" };
  }

  const bySku = value(db, "SELECT id FROM products WHERE sku = ?", code);
  if (bySku) return { product: load(bySku), qty: 1, source: "sku" };

  throw unknownBarcode({ code });
}
