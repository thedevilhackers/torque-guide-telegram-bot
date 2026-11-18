import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS branches (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  timezone TEXT NOT NULL DEFAULT 'UTC',
  tax_id TEXT NOT NULL DEFAULT '',
  receipt_footer TEXT NOT NULL DEFAULT '',
  external_id TEXT UNIQUE,
  active INTEGER NOT NULL DEFAULT 1,
  locked INTEGER NOT NULL DEFAULT 0,
  lock_reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT,
  pin_hash TEXT,
  role TEXT NOT NULL CHECK (role IN ('owner','manager','cashier')),
  branch_id INTEGER REFERENCES branches(id),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS api_keys (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  branch_id INTEGER REFERENCES branches(id),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  last_used_at TEXT
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  color TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  lead_days INTEGER NOT NULL DEFAULT 7,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY,
  sku TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  unit TEXT NOT NULL DEFAULT 'pcs',
  sold_by_weight INTEGER NOT NULL DEFAULT 0,
  plu TEXT UNIQUE,
  price INTEGER NOT NULL DEFAULT 0,
  cost INTEGER NOT NULL DEFAULT 0,
  tax_rate REAL NOT NULL DEFAULT 0,
  reorder_level REAL NOT NULL DEFAULT 0,
  reorder_qty REAL NOT NULL DEFAULT 0,
  track_stock INTEGER NOT NULL DEFAULT 1,
  track_expiry INTEGER NOT NULL DEFAULT 1,
  expiry_warn_days INTEGER NOT NULL DEFAULT 7,
  min_age INTEGER NOT NULL DEFAULT 0,
  quick_key INTEGER NOT NULL DEFAULT 0,
  external_id TEXT UNIQUE,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS products_name ON products(name);
CREATE INDEX IF NOT EXISTS products_updated ON products(updated_at);

CREATE TABLE IF NOT EXISTS barcodes (
  code TEXT PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  pack_qty REAL NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS barcodes_product ON barcodes(product_id);

CREATE TABLE IF NOT EXISTS branch_products (
  branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  price INTEGER,
  reorder_level REAL,
  active INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (branch_id, product_id)
);

CREATE TABLE IF NOT EXISTS stock (
  branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  qty REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (branch_id, product_id)
);

CREATE TABLE IF NOT EXISTS batches (
  id INTEGER PRIMARY KEY,
  branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  batch_no TEXT NOT NULL DEFAULT '',
  expiry_date TEXT,
  qty_received REAL NOT NULL,
  qty_remaining REAL NOT NULL,
  cost INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL,
  source_id INTEGER,
  received_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS batches_lookup ON batches(branch_id, product_id, qty_remaining);
CREATE INDEX IF NOT EXISTS batches_expiry ON batches(branch_id, expiry_date);

CREATE TABLE IF NOT EXISTS stock_movements (
  id INTEGER PRIMARY KEY,
  branch_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  batch_id INTEGER,
  type TEXT NOT NULL,
  qty REAL NOT NULL,
  unit_cost INTEGER NOT NULL DEFAULT 0,
  reason TEXT NOT NULL DEFAULT '',
  ref_type TEXT,
  ref_id INTEGER,
  user_id INTEGER,
  business_date TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS movements_day ON stock_movements(branch_id, business_date);
CREATE INDEX IF NOT EXISTS movements_product ON stock_movements(branch_id, product_id, id);

CREATE TABLE IF NOT EXISTS goods_receipts (
  id INTEGER PRIMARY KEY,
  branch_id INTEGER NOT NULL REFERENCES branches(id),
  supplier_id INTEGER REFERENCES suppliers(id),
  invoice_no TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  total_cost INTEGER NOT NULL DEFAULT 0,
  line_count INTEGER NOT NULL DEFAULT 0,
  user_id INTEGER,
  business_date TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stock_counts (
  id INTEGER PRIMARY KEY,
  branch_id INTEGER NOT NULL REFERENCES branches(id),
  user_id INTEGER,
  note TEXT NOT NULL DEFAULT '',
  items_counted INTEGER NOT NULL DEFAULT 0,
  variance_qty REAL NOT NULL DEFAULT 0,
  variance_value INTEGER NOT NULL DEFAULT 0,
  business_date TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS transfers (
  id INTEGER PRIMARY KEY,
  from_branch_id INTEGER NOT NULL REFERENCES branches(id),
  to_branch_id INTEGER NOT NULL REFERENCES branches(id),
  status TEXT NOT NULL CHECK (status IN ('in_transit','received','cancelled')),
  note TEXT NOT NULL DEFAULT '',
  created_by INTEGER,
  created_at TEXT NOT NULL,
  received_by INTEGER,
  received_at TEXT
);
CREATE TABLE IF NOT EXISTS transfer_items (
  id INTEGER PRIMARY KEY,
  transfer_id INTEGER NOT NULL REFERENCES transfers(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  qty REAL NOT NULL,
  batch_no TEXT NOT NULL DEFAULT '',
  expiry_date TEXT,
  cost INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY,
  phone TEXT UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  points INTEGER NOT NULL DEFAULT 0,
  total_spent INTEGER NOT NULL DEFAULT 0,
  visits INTEGER NOT NULL DEFAULT 0,
  branch_id INTEGER REFERENCES branches(id),
  created_at TEXT NOT NULL,
  last_visit_at TEXT
);

CREATE TABLE IF NOT EXISTS promotions (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('percent','amount','multibuy','bundle')),
  product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
  category_id INTEGER REFERENCES categories(id) ON DELETE CASCADE,
  value REAL NOT NULL DEFAULT 0,
  buy_qty INTEGER NOT NULL DEFAULT 0,
  free_qty INTEGER NOT NULL DEFAULT 0,
  starts_on TEXT,
  ends_on TEXT,
  branch_id INTEGER REFERENCES branches(id) ON DELETE CASCADE,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS shifts (
  id INTEGER PRIMARY KEY,
  branch_id INTEGER NOT NULL REFERENCES branches(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  register TEXT NOT NULL DEFAULT 'POS-1',
  status TEXT NOT NULL CHECK (status IN ('open','closed')),
  opening_float INTEGER NOT NULL DEFAULT 0,
  opened_at TEXT NOT NULL,
  closed_at TEXT,
  closed_by INTEGER,
  counted_cash INTEGER,
  expected_cash INTEGER,
  variance INTEGER,
  note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS shifts_open ON shifts(branch_id, user_id, status);

CREATE TABLE IF NOT EXISTS cash_movements (
  id INTEGER PRIMARY KEY,
  shift_id INTEGER NOT NULL REFERENCES shifts(id),
  type TEXT NOT NULL CHECK (type IN ('pay_in','pay_out')),
  amount INTEGER NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  user_id INTEGER,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sales (
  id INTEGER PRIMARY KEY,
  branch_id INTEGER NOT NULL REFERENCES branches(id),
  receipt_no TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL CHECK (type IN ('sale','refund')),
  refund_of INTEGER REFERENCES sales(id),
  client_ref TEXT,
  shift_id INTEGER REFERENCES shifts(id),
  user_id INTEGER REFERENCES users(id),
  customer_id INTEGER REFERENCES customers(id),
  status TEXT NOT NULL DEFAULT 'completed',
  subtotal INTEGER NOT NULL DEFAULT 0,
  discount_total INTEGER NOT NULL DEFAULT 0,
  tax_total INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  cost_total INTEGER NOT NULL DEFAULT 0,
  items_count REAL NOT NULL DEFAULT 0,
  tendered INTEGER NOT NULL DEFAULT 0,
  change_due INTEGER NOT NULL DEFAULT 0,
  points_earned INTEGER NOT NULL DEFAULT 0,
  points_redeemed INTEGER NOT NULL DEFAULT 0,
  age_verified INTEGER NOT NULL DEFAULT 0,
  approved_by INTEGER,
  note TEXT NOT NULL DEFAULT '',
  business_date TEXT NOT NULL,
  hour INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sales_day ON sales(branch_id, business_date);
CREATE UNIQUE INDEX IF NOT EXISTS sales_client_ref ON sales(branch_id, client_ref) WHERE client_ref IS NOT NULL;

CREATE TABLE IF NOT EXISTS sale_items (
  id INTEGER PRIMARY KEY,
  sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id),
  name TEXT NOT NULL,
  sku TEXT NOT NULL DEFAULT '',
  category_id INTEGER,
  qty REAL NOT NULL,
  unit_price INTEGER NOT NULL,
  gross INTEGER NOT NULL,
  discount INTEGER NOT NULL DEFAULT 0,
  promo_id INTEGER,
  promo_name TEXT NOT NULL DEFAULT '',
  tax_rate REAL NOT NULL DEFAULT 0,
  tax INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL,
  cost INTEGER NOT NULL DEFAULT 0,
  refunded_qty REAL NOT NULL DEFAULT 0,
  refund_of_item INTEGER
);
CREATE INDEX IF NOT EXISTS sale_items_sale ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS sale_items_product ON sale_items(product_id);

CREATE TABLE IF NOT EXISTS sale_item_batches (
  sale_item_id INTEGER NOT NULL REFERENCES sale_items(id) ON DELETE CASCADE,
  batch_id INTEGER,
  qty REAL NOT NULL,
  unit_cost INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS sib_item ON sale_item_batches(sale_item_id);

CREATE TABLE IF NOT EXISTS sale_payments (
  id INTEGER PRIMARY KEY,
  sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  method TEXT NOT NULL,
  amount INTEGER NOT NULL,
  reference TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS sale_payments_sale ON sale_payments(sale_id);

CREATE TABLE IF NOT EXISTS held_carts (
  id INTEGER PRIMARY KEY,
  branch_id INTEGER NOT NULL REFERENCES branches(id),
  user_id INTEGER,
  label TEXT NOT NULL DEFAULT '',
  data TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS counters (
  key TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS webhooks (
  id INTEGER PRIMARY KEY,
  url TEXT NOT NULL,
  secret TEXT NOT NULL,
  events TEXT NOT NULL DEFAULT '*',
  branch_id INTEGER REFERENCES branches(id) ON DELETE CASCADE,
  active INTEGER NOT NULL DEFAULT 1,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id INTEGER PRIMARY KEY,
  webhook_id INTEGER NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
  event TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  last_status_code INTEGER,
  last_error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  delivered_at TEXT
);
CREATE INDEX IF NOT EXISTS deliveries_pending ON webhook_deliveries(status, next_attempt_at);

CREATE TABLE IF NOT EXISTS scheduled_runs (
  key TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY,
  branch_id INTEGER,
  user_id INTEGER,
  api_key_id INTEGER,
  action TEXT NOT NULL,
  entity TEXT NOT NULL DEFAULT '',
  entity_id INTEGER,
  details TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_created ON audit_log(created_at);
`;

const statementCache = new WeakMap();

export function openDatabase(path = "data/store.db") {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys = ON;");
  if (path !== ":memory:") db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;");
  db.exec(SCHEMA);
  return db;
}

function stmt(db, sql) {
  let cache = statementCache.get(db);
  if (!cache) {
    cache = new Map();
    statementCache.set(db, cache);
  }
  let prepared = cache.get(sql);
  if (!prepared) {
    prepared = db.prepare(sql);
    // Lets one params object serve queries that only use some of its keys.
    prepared.setAllowUnknownNamedParameters?.(true);
    cache.set(sql, prepared);
  }
  return prepared;
}

/** Returns the first row or undefined. */
export function one(db, sql, ...params) {
  return stmt(db, sql).get(...params);
}

export function all(db, sql, ...params) {
  return stmt(db, sql).all(...params);
}

export function run(db, sql, ...params) {
  const result = stmt(db, sql).run(...params);
  return { changes: Number(result.changes), id: Number(result.lastInsertRowid) };
}

/** Single scalar value of the first column of the first row. */
export function value(db, sql, ...params) {
  const row = one(db, sql, ...params);
  return row ? Object.values(row)[0] : undefined;
}

const txDepth = new WeakMap();

/** Runs fn inside a transaction (nested calls use savepoints). */
export function tx(db, fn) {
  const depth = txDepth.get(db) ?? 0;
  const savepoint = `sp_${depth}`;
  db.exec(depth === 0 ? "BEGIN IMMEDIATE" : `SAVEPOINT ${savepoint}`);
  txDepth.set(db, depth + 1);
  try {
    const result = fn();
    db.exec(depth === 0 ? "COMMIT" : `RELEASE ${savepoint}`);
    return result;
  } catch (error) {
    db.exec(depth === 0 ? "ROLLBACK" : `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`);
    throw error;
  } finally {
    txDepth.set(db, depth);
  }
}

/** Atomically increments and returns a named counter. */
export function nextCounter(db, key) {
  run(db, "INSERT INTO counters(key, value) VALUES (?, 1) ON CONFLICT(key) DO UPDATE SET value = value + 1", key);
  return value(db, "SELECT value FROM counters WHERE key = ?", key);
}
