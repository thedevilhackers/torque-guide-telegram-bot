// Sample data for trying the system out. Never run this against a live store database.
import { all, one, run, tx } from "./db.js";
import { hashSecret } from "./auth.js";
import { createProduct, saveCategory, saveSupplier } from "./catalog.js";
import { saveCustomer } from "./customers.js";
import { increaseStock, receiveStock } from "./inventory.js";
import { createBranch, getBranch } from "./org.js";
import { savePromotion } from "./promotions.js";
import { checkout, quote } from "./sales.js";
import { getSettings } from "./settings.js";
import { closeShift, openShift, shiftReport } from "./shifts.js";
import { addDays, businessDate, gs1CheckDigit, localMinutes, nowIso } from "./util.js";

// Rough price scale per currency so sample prices look sensible (base prices are in US cents).
const SCALE = { INR: [25, 500], PKR: [80, 1000], LKR: [90, 1000], BDT: [30, 500], NPR: [40, 500], AED: [3.7, 25], SAR: [3.7, 25], PHP: [55, 100], JPY: [1.5, 10], THB: [35, 100], MYR: [4.5, 10], EUR: [0.95, 5], GBP: [0.8, 5] };

const ean = (body12) => body12 + gs1CheckDigit(body12);

const PRODUCTS = [
  // name, category, price (US cents), cost, tax %, extra
  ["Sparkling Water 500ml", "Beverages", 120, 55, 5, { barcode: ean("500000000011"), reorder_level: 24, reorder_qty: 48, expiry: 180 }],
  ["Cola 330ml Can", "Beverages", 150, 70, 12, { barcodes: [{ code: ean("500000000028"), pack_qty: 1 }, { code: ean("150000000020"), pack_qty: 24 }], reorder_level: 48, reorder_qty: 96, expiry: 240 }],
  ["Orange Juice 1L", "Beverages", 380, 210, 5, { barcode: ean("500000000035"), reorder_level: 10, reorder_qty: 24, expiry: 20 }],
  ["Iced Tea Lemon 500ml", "Beverages", 180, 80, 12, { barcode: ean("500000000042"), reorder_level: 12, reorder_qty: 36, expiry: 150 }],
  ["Energy Drink 250ml", "Beverages", 250, 120, 12, { barcode: ean("500000000059"), reorder_level: 12, reorder_qty: 48, expiry: 300 }],
  ["Potato Chips Salted 150g", "Snacks", 299, 140, 12, { barcode: ean("500000000066"), reorder_level: 15, reorder_qty: 40, expiry: 120 }],
  ["Milk Chocolate Bar 50g", "Snacks", 175, 80, 12, { barcode: ean("500000000073"), reorder_level: 20, reorder_qty: 60, expiry: 270 }],
  ["Salted Peanuts 200g", "Snacks", 250, 110, 5, { barcode: ean("500000000080"), reorder_level: 10, reorder_qty: 30, expiry: 200 }],
  ["Instant Noodles Chicken", "Snacks", 90, 40, 5, { barcode: ean("500000000097"), reorder_level: 30, reorder_qty: 100, expiry: 240 }],
  ["Whole Milk 1L", "Dairy", 165, 110, 0, { barcode: ean("500000000103"), reorder_level: 12, reorder_qty: 30, expiry: 6 }],
  ["Greek Yogurt 400g", "Dairy", 320, 190, 0, { barcode: ean("500000000110"), reorder_level: 8, reorder_qty: 20, expiry: 12 }],
  ["Cheddar Cheese 200g", "Dairy", 450, 280, 5, { barcode: ean("500000000127"), reorder_level: 6, reorder_qty: 15, expiry: 40 }],
  ["Free Range Eggs x12", "Dairy", 420, 260, 0, { barcode: ean("500000000134"), reorder_level: 8, reorder_qty: 20, expiry: 21 }],
  ["White Sandwich Loaf", "Bakery", 230, 120, 0, { barcode: ean("500000000141"), reorder_level: 8, reorder_qty: 20, expiry: 4 }],
  ["Butter Croissant", "Bakery", 140, 50, 5, { barcode: ean("500000000158"), reorder_level: 10, reorder_qty: 30, expiry: 3, quick_key: true }],
  ["Blueberry Muffin", "Bakery", 210, 80, 5, { barcode: ean("500000000165"), reorder_level: 8, reorder_qty: 24, expiry: 4 }],
  ["Bananas (per kg)", "Fresh Produce", 199, 100, 0, { plu: "4011", sold_by_weight: true, unit: "kg", reorder_level: 5, reorder_qty: 20, expiry: 6 }],
  ["Red Apples (per kg)", "Fresh Produce", 349, 180, 0, { plu: "4131", sold_by_weight: true, unit: "kg", reorder_level: 5, reorder_qty: 15, expiry: 14 }],
  ["Hot Coffee Regular", "Hot Food & Drinks", 199, 45, 5, { plu: "101", quick_key: true, track_expiry: false, track_stock: false }],
  ["Hot Dog", "Hot Food & Drinks", 299, 95, 5, { plu: "102", quick_key: true, track_expiry: false, track_stock: false }],
  ["Chicken Sandwich", "Hot Food & Drinks", 449, 190, 5, { barcode: ean("500000000172"), quick_key: true, expiry: 2, reorder_level: 5, reorder_qty: 12 }],
  ["Dish Soap 500ml", "Household", 275, 130, 18, { barcode: ean("500000000189"), reorder_level: 5, reorder_qty: 12, track_expiry: false }],
  ["Paper Towels 2 Rolls", "Household", 399, 210, 18, { barcode: ean("500000000196"), reorder_level: 5, reorder_qty: 12, track_expiry: false }],
  ["Toothpaste Mint 100g", "Personal Care", 325, 150, 18, { barcode: ean("500000000202"), reorder_level: 6, reorder_qty: 18, expiry: 500 }],
  ["Hand Sanitiser 100ml", "Personal Care", 220, 90, 18, { barcode: ean("500000000219"), reorder_level: 6, reorder_qty: 18, expiry: 400 }],
  ["Lager Beer 330ml", "Alcohol", 260, 140, 18, { barcode: ean("500000000226"), min_age: 18, reorder_level: 24, reorder_qty: 48, expiry: 180 }],
  ["Red Wine 750ml", "Alcohol", 1299, 700, 18, { barcode: ean("500000000233"), min_age: 18, reorder_level: 4, reorder_qty: 12, track_expiry: false }]
];

function rng(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

// Public demo (DEMO_MODE=1): the store it creates on an empty database, and the logins it shows.
export const DEMO_STORE = {
  store_name: "QuickMart",
  currency: "INR",
  locale: "en-IN",
  demo: true,
  branch: { code: "MGR", name: "MG Road", timezone: "Asia/Kolkata", address: "45 MG Road" },
  owner: { name: "Demo Owner", username: "owner", password: "demo-owner-123", pin: "9999" }
};

export const DEMO_LOGINS = [
  { who: "Owner (all branches)", username: "owner", password: "demo-owner-123", pin: "9999" },
  { who: "Manager, MG Road", username: "manager1", pin: "2222" },
  { who: "Cashier, MG Road", username: "cashier1", pin: "1111" },
  { who: "Cashier, Station Road", username: "cashier2", pin: "3333" }
];

export async function seedDemo(db, { branchId, principal }) {
  const settings = getSettings(db);
  const [factor, step] = SCALE[settings.currency] ?? [1, 1];
  const money = (cents) => Math.max(step, Math.round((cents * factor) / step) * step);
  const random = rng(42);
  const pick = (arr) => arr[Math.floor(random() * arr.length)];
  const branch = getBranch(db, branchId);
  const today = businessDate(branch.timezone);
  const start = addDays(today, -13);

  // Catalogue.
  const supplier = saveSupplier(db, null, { name: "Metro Wholesale (demo)", phone: "+1 555 0100", lead_days: 3 });
  const fresh = saveSupplier(db, null, { name: "Daily Fresh Farms (demo)", phone: "+1 555 0110", lead_days: 1 });
  const categories = {};
  for (const name of new Set(PRODUCTS.map((p) => p[1]))) categories[name] = saveCategory(db, null, { name }).id;
  const ids = {};
  for (const [name, category, price, cost, tax, extra] of PRODUCTS) {
    const { expiry, ...rest } = extra;
    ids[name] = createProduct(db, {
      name,
      category_id: categories[category],
      supplier_id: ["Dairy", "Bakery", "Fresh Produce"].includes(category) ? fresh.id : supplier.id,
      price: money(price),
      cost: money(cost),
      tax_rate: tax,
      ...rest
    });
  }

  // Second branch and demo staff.
  let second = one(db, "SELECT * FROM branches WHERE id != ? ORDER BY id LIMIT 1", branchId);
  if (!second) second = createBranch(db, { code: `${branch.code.slice(0, 8)}2`, name: `${branch.name} - Station Road`, timezone: branch.timezone, address: "12 Station Road" });
  const staff = [
    ["Maya (demo manager)", "manager1", "2222", "manager", branchId],
    ["Leo (demo cashier)", "cashier1", "1111", "cashier", branchId],
    ["Ava (demo cashier)", "cashier2", "3333", "cashier", second.id]
  ];
  for (const [name, username, pin, role, bid] of staff) {
    if (one(db, "SELECT id FROM users WHERE username = ?", username)) continue;
    run(db, "INSERT INTO users(name, username, pin_hash, password_hash, role, branch_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", name, username, await hashSecret(pin), await hashSecret(`demo-${pin}-pass`), role, bid, nowIso());
  }

  // Opening stock 14 days ago for both branches.
  for (const [bid, mult] of [[branchId, 1], [second.id, 0.5]]) {
    receiveStock(db, principal, {
      branchId: bid,
      today: start,
      supplier_id: supplier.id,
      invoice_no: "DEMO-OPENING",
      note: "Demo opening stock",
      items: PRODUCTS.filter(([, , , , , e]) => e.track_stock !== false).map(([name, , , , , e]) => ({
        product_id: ids[name],
        qty: Math.round((e.sold_by_weight ? 45 : (e.reorder_qty || 20) * 1.5 + 35 + random() * 30) * mult),
        expiry_date: e.expiry && e.track_expiry !== false ? addDays(start, Math.max(e.expiry, 14) + Math.floor(random() * 10)) : null,
        batch_no: `L${Math.floor(100000 + random() * 899999)}`
      }))
    });
  }

  // Promotions.
  savePromotion(db, principal, null, { name: "Chips: buy 2 get 1 free", type: "multibuy", product_id: ids["Potato Chips Salted 150g"], buy_qty: 2, free_qty: 1 });
  savePromotion(db, principal, null, { name: "Energy drinks 2 for deal", type: "bundle", product_id: ids["Energy Drink 250ml"], buy_qty: 2, value: money(400) });
  savePromotion(db, principal, null, { name: "Bakery 10% off", type: "percent", category_id: categories.Bakery, value: 10, starts_on: start, ends_on: addDays(today, 30) });

  // Customers.
  const customers = [
    saveCustomer(db, null, { name: "Priya Shah", phone: "+15550101001" }, branchId),
    saveCustomer(db, null, { name: "Tom Becker", phone: "+15550101002" }, branchId),
    saveCustomer(db, null, { name: "Grace Lim", phone: "+15550101003" }, branchId)
  ];

  // Two weeks of sales history.
  const sellable = Object.keys(ids).filter((n) => !["Red Wine 750ml"].includes(n));
  const methods = settings.payment_methods.map((m) => m.id);
  for (const bid of [branchId, second.id]) {
    const shift = openShift(db, principal, { branchId: bid, opening_float: money(10000), register: "POS-1" });
    for (let d = 0; d < 14; d += 1) {
      const date = addDays(start, d);
      if (d === 7 || d === 11) {
        // Mid-period delivery for anything running low, like a real weekly order.
        const low = all(
          db,
          `SELECT p.id, p.reorder_qty, p.reorder_level, p.track_expiry FROM products p LEFT JOIN stock s ON s.product_id = p.id AND s.branch_id = ?
            WHERE p.track_stock = 1 AND COALESCE(s.qty, 0) < p.reorder_level * 2.5`,
          bid
        );
        if (low.length) {
          receiveStock(db, principal, {
            branchId: bid,
            today: date,
            supplier_id: supplier.id,
            invoice_no: `DEMO-${d}`,
            items: low.map((p) => ({ product_id: p.id, qty: Math.max(p.reorder_qty, 20) * 2, expiry_date: p.track_expiry ? addDays(date, 25 + Math.floor(random() * 30)) : null }))
          });
        }
      }
      const count = Math.round((bid === branchId ? 18 : 9) + random() * 12 + (d % 7 >= 5 ? 8 : 0));
      for (let i = 0; i < count; i += 1) {
        const lines = [];
        const n = 1 + Math.floor(random() * 4);
        for (let k = 0; k < n; k += 1) {
          const name = pick(sellable);
          const weighed = PRODUCTS.find((p) => p[0] === name)[5].sold_by_weight;
          lines.push({ product_id: ids[name], qty: weighed ? Math.round((0.3 + random() * 1.2) * 1000) / 1000 : 1 + Math.floor(random() * 2) });
        }
        const customer = random() < 0.25 ? pick(customers) : null;
        const method = random() < 0.45 ? "cash" : pick(methods);
        try {
          const quoteTotal = quote(db, { branchId: bid, today: date, lines }).total;
          const amount = method === "cash" ? Math.ceil(quoteTotal / (step * 100)) * step * 100 || quoteTotal : quoteTotal;
          const sale = await checkout(db, principal, { branchId: bid, today: date, lines, payments: [{ method, amount }], customer_id: customer?.id, age_verified: true });
          // Spread sales over opening hours (07:00-22:00 local); today's stop at the current time.
          const latest = date === today ? Math.max(localMinutes(branch.timezone) - 5, 0) : 22 * 60;
          const minuteOfDay = Math.min(7 * 60 + Math.floor(random() * 15 * 60), latest);
          const hour = Math.floor(minuteOfDay / 60);
          const createdAt = localToUtc(date, minuteOfDay, branch.timezone);
          run(db, "UPDATE sales SET hour = ?, created_at = ? WHERE id = ?", hour, createdAt, sale.id);
          run(db, "UPDATE stock_movements SET business_date = ? WHERE ref_type = 'sale' AND ref_id = ?", date, sale.id);
        } catch {
          // Skip carts that cannot be sold (e.g. out of stock with negative stock disabled).
        }
      }
    }
    const expected = shiftReport(db, shift.shift.id).expected_cash;
    closeShift(db, principal, shift.shift.id, { counted_cash: expected - money(200), note: "Demo shift (short by a little to show variance)" });
  }

  // Leave some stock that is expired / about to expire so the alerts have something to show.
  tx(db, () => {
    increaseStock(db, { branchId, productId: ids["Greek Yogurt 400g"], qty: 4, unitCost: money(190), expiryDate: addDays(today, -1), batchNo: "L-EXPIRED", source: "receive", type: "receive", reason: "demo", today });
    increaseStock(db, { branchId, productId: ids["Whole Milk 1L"], qty: 6, unitCost: money(110), expiryDate: addDays(today, 2), batchNo: "L-SOON", source: "receive", type: "receive", reason: "demo", today });
    increaseStock(db, { branchId, productId: ids["White Sandwich Loaf"], qty: 5, unitCost: money(120), expiryDate: addDays(today, 1), batchNo: "L-SOON", source: "receive", type: "receive", reason: "demo", today });
  });

  return {
    products: Object.keys(ids).length,
    branches: all(db, "SELECT id, code, name FROM branches"),
    staff: staff.map(([name, username, pin, role]) => ({ name, username, pin, role }))
  };
}

/** Converts a branch-local date + minute of day to a UTC ISO timestamp. */
function localToUtc(date, minuteOfDay, timezone) {
  const guess = Date.parse(`${date}T00:00:00Z`) + minuteOfDay * 60_000;
  let offset = localMinutes(timezone, new Date(guess)) - minuteOfDay;
  if (offset > 720) offset -= 1440;
  if (offset < -720) offset += 1440;
  return new Date(guess - offset * 60_000).toISOString();
}
