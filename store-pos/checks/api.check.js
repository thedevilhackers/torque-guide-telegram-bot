import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createApp } from "../src/server.js";
import { processDeliveries, signPayload } from "../src/webhooks.js";
import { runDailyJobs } from "../src/scheduler.js";
import { addDays, businessDate, gs1CheckDigit } from "../src/util.js";

const quiet = { log() {}, error() {} };
let app;
let base;
let today;

function client(token, branchId) {
  return async (method, path, body, extraHeaders = {}) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(branchId ? { "x-branch-id": String(branchId) } : {}),
        ...extraHeaders
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    return { status: res.status, data };
  };
}

const ean = (body) => body + gs1CheckDigit(body);
const ok = (res, status = 200) => {
  assert.equal(res.status, status, JSON.stringify(res.data));
  return res.data;
};

before(async () => {
  app = createApp({ dbPath: ":memory:", logger: quiet });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${app.server.address().port}`;
  today = businessDate("Asia/Kolkata");
});

after(() => {
  app.server.closeAllConnections();
  app.server.close();
  app.db.close();
});

describe("store POS API", () => {
  const ctx = {};

  test("first-run setup creates the owner and first branch", async () => {
    const api = client();
    assert.equal(ok(await api("GET", "/api/setup")).needs_setup, true);
    const setup = ok(
      await api("POST", "/api/setup", {
        store_name: "Corner Mart",
        currency: "INR",
        locale: "en-IN",
        branch: { code: "MAIN", name: "Main Street", timezone: "Asia/Kolkata" },
        owner: { name: "Owner", username: "owner", password: "correct horse", pin: "9999" }
      })
    );
    assert.ok(setup.token.startsWith("st_"));
    ctx.branch = setup.branch.id;
    assert.equal(ok(await api("GET", "/api/setup")).needs_setup, false);
    assert.equal((await api("POST", "/api/setup", { owner: { name: "x", username: "y", password: "zzzzzzzz" } })).status, 403);
  });

  test("login with password; wrong password rejected", async () => {
    const api = client();
    assert.equal((await api("POST", "/api/auth/login", { username: "owner", password: "nope" })).status, 401);
    const login = ok(await api("POST", "/api/auth/login", { username: "OWNER", password: "correct horse" }));
    ctx.owner = client(login.token, ctx.branch);
    const me = ok(await ctx.owner("GET", "/api/me"));
    assert.equal(me.user.role, "owner");
    assert.equal(me.settings.currency, "INR");
    assert.equal(me.today, today);
  });

  test("unauthenticated API calls are refused", async () => {
    assert.equal((await client()("GET", "/api/products")).status, 401);
    assert.equal((await client("st_bogus")("GET", "/api/products")).status, 401);
  });

  test("catalogue: products with barcodes, case packs and scale PLUs", async () => {
    const o = ctx.owner;
    ctx.milkCode = ean("890100000001");
    const milk = ok(await o("POST", "/api/products", { name: "Milk 1L", category: "Dairy", price: 6000, cost: 4500, tax_rate: 5, reorder_level: 5, barcodes: [{ code: ctx.milkCode }, { code: "CASE-MILK-12", pack_qty: 12 }] }));
    ctx.milk = milk.id;
    assert.equal(milk.category_name, "Dairy");
    assert.equal(milk.barcode, ctx.milkCode);
    ctx.chips = ok(await o("POST", "/api/products", { name: "Chips", price: 2000, cost: 1000, barcode: ean("890100000002"), track_expiry: false })).id;
    ctx.banana = ok(await o("POST", "/api/products", { name: "Banana", price: 8000, sold_by_weight: true, unit: "kg", plu: "4011" })).id;
    ctx.beer = ok(await o("POST", "/api/products", { name: "Beer", price: 15000, min_age: 21, barcode: ean("890100000003") })).id;
    ctx.coffee = ok(await o("POST", "/api/products", { name: "Coffee", price: 5000, cost: 1000, track_stock: false, quick_key: true })).id;

    const dupe = await o("POST", "/api/products", { name: "Dupe", price: 1, barcode: ctx.milkCode });
    assert.equal(dupe.status, 409);
    assert.equal(dupe.data.error.code, "BARCODE_TAKEN");

    const scan = ok(await o("GET", `/api/lookup?code=${ctx.milkCode}`));
    assert.equal(scan.product.id, ctx.milk);
    assert.equal(scan.qty, 1);
    const caseScan = ok(await o("GET", "/api/lookup?code=CASE-MILK-12"));
    assert.equal(caseScan.qty, 12);
    const scale = ok(await o("GET", `/api/lookup?code=${ean("210401101250")}`));
    assert.equal(scale.product.id, ctx.banana);
    assert.equal(scale.qty, 1.25);
    const unknown = await o("GET", "/api/lookup?code=000000");
    assert.equal(unknown.status, 404);
    assert.equal(unknown.data.error.code, "UNKNOWN_BARCODE");

    const generated = ok(await o("POST", `/api/products/${ctx.coffee}/barcode`));
    assert.match(generated.code, /^20\d{11}$/);
  });

  test("receiving stock creates expiry batches", async () => {
    const o = ctx.owner;
    const receipt = ok(
      await o("POST", "/api/stock/receive", {
        invoice_no: "INV-1",
        items: [
          { product_id: ctx.milk, qty: 10, cost: 4400, expiry_date: addDays(today, 30), batch_no: "LATE" },
          { product_id: ctx.milk, qty: 5, expiry_date: addDays(today, 3), batch_no: "SOON" },
          { product_id: ctx.chips, qty: 20 },
          { product_id: ctx.beer, qty: 12, expiry_date: addDays(today, 100) },
          { product_id: ctx.banana, qty: 20, expiry_date: addDays(today, 5) }
        ]
      })
    );
    assert.equal(receipt.items.length, 5);
    assert.equal(receipt.total_cost, 10 * 4400 + 5 * 4400 + 20 * 1000 + 0 + 0);
    const past = await o("POST", "/api/stock/receive", { items: [{ product_id: ctx.milk, qty: 1, expiry_date: addDays(today, -1) }] });
    assert.equal(past.status, 400);
    const milk = ok(await o("GET", `/api/products/${ctx.milk}`));
    assert.equal(milk.stock_qty, 15);
    assert.equal(milk.next_expiry, addDays(today, 3));
    assert.equal(milk.batches.length, 2);
  });

  test("selling requires an open shift", async () => {
    const res = await ctx.owner("POST", "/api/pos/checkout", { lines: [{ product_id: ctx.chips, qty: 1 }], payments: [{ method: "cash", amount: 2000 }] });
    assert.equal(res.status, 400);
    assert.equal(res.data.error.code, "NO_SHIFT");
    ctx.shift = ok(await ctx.owner("POST", "/api/shifts/open", { opening_float: 100000 })).shift.id;
  });

  test("checkout deducts stock first-expiry-first-out and calculates tax", async () => {
    const sale = ok(
      await ctx.owner("POST", "/api/pos/checkout", {
        lines: [{ product_id: ctx.milk, qty: 4 }, { product_id: ctx.milk, qty: 2 }],
        payments: [{ method: "cash", amount: 40000 }],
        client_ref: "till1-0001"
      }),
      201
    );
    assert.match(sale.receipt_no, /^MAIN-000001$/);
    assert.equal(sale.items.length, 1, "repeat scans merge into one line");
    assert.equal(sale.total, 36000);
    assert.equal(sale.tax_total, 36000 - Math.round(36000 / 1.05));
    assert.equal(sale.change_due, 4000);
    assert.deepEqual(sale.payments, [{ method: "cash", amount: 36000, reference: "" }]);
    const batches = ok(await ctx.owner("GET", `/api/stock/batches?product_id=${ctx.milk}`));
    assert.equal(batches.length, 1, "the soon-to-expire batch was used up first");
    assert.equal(batches[0].batch_no, "LATE");
    assert.equal(batches[0].qty_remaining, 9);
    assert.equal(sale.cost_total, 6 * 4400);
    ctx.sale = sale;

    const again = ok(await ctx.owner("POST", "/api/pos/checkout", { lines: [{ product_id: ctx.milk, qty: 6 }], payments: [{ method: "cash", amount: 40000 }], client_ref: "till1-0001" }));
    assert.equal(again.id, sale.id, "same client_ref is not charged twice");
  });

  test("payments must cover the total; card cannot overpay", async () => {
    const short = await ctx.owner("POST", "/api/pos/checkout", { lines: [{ product_id: ctx.chips, qty: 1 }], payments: [{ method: "cash", amount: 100 }] });
    assert.equal(short.data.error.code, "INSUFFICIENT_PAYMENT");
    const over = await ctx.owner("POST", "/api/pos/checkout", { lines: [{ product_id: ctx.chips, qty: 1 }], payments: [{ method: "card", amount: 9999 }] });
    assert.equal(over.data.error.code, "OVERPAYMENT");
  });

  test("promotions apply automatically (buy 2 get 1 free)", async () => {
    ok(await ctx.owner("POST", "/api/promotions", { name: "Chips B2G1", type: "multibuy", product_id: ctx.chips, buy_qty: 2, free_qty: 1 }));
    const q = ok(await ctx.owner("POST", "/api/pos/quote", { lines: [{ product_id: ctx.chips, qty: 3 }] }));
    assert.equal(q.total, 4000);
    assert.equal(q.lines[0].promo_name, "Chips B2G1");
  });

  test("weighed items, made-to-order items and age-restricted items", async () => {
    const o = ctx.owner;
    const weighed = ok(await o("POST", "/api/pos/checkout", { lines: [{ product_id: ctx.banana, qty: 1.25 }, { product_id: ctx.coffee, qty: 2 }], payments: [{ method: "upi", amount: 20000 }] }), 201);
    assert.equal(weighed.total, 10000 + 10000);
    const coffee = ok(await o("GET", `/api/products/${ctx.coffee}`));
    assert.equal(coffee.stock_qty, 0, "untracked items do not go negative");
    const age = await o("POST", "/api/pos/checkout", { lines: [{ product_id: ctx.beer, qty: 1 }], payments: [{ method: "cash", amount: 15000 }] });
    assert.equal(age.data.error.code, "AGE_CHECK_REQUIRED");
    assert.equal(age.data.error.details.min_age, 21);
    ok(await o("POST", "/api/pos/checkout", { lines: [{ product_id: ctx.beer, qty: 1 }], payments: [{ method: "cash", amount: 15000 }], age_verified: true }), 201);
    const fractional = await o("POST", "/api/pos/checkout", { lines: [{ product_id: ctx.chips, qty: 1.5 }], payments: [{ method: "cash", amount: 9000 }] });
    assert.equal(fractional.status, 400);
  });

  test("cashier needs a manager PIN for refunds and expired stock", async () => {
    const o = ctx.owner;
    ok(await o("POST", "/api/users", { name: "Manager", username: "mgr", pin: "2468", role: "manager", branch_id: ctx.branch }));
    ok(await o("POST", "/api/users", { name: "Cashier", username: "cash1", pin: "1357", role: "cashier", branch_id: ctx.branch }));
    const login = ok(await client()("POST", "/api/auth/login", { username: "cash1", pin: "1357" }));
    const c = client(login.token, ctx.branch);
    ctx.cashier = c;
    ok(await c("POST", "/api/shifts/open", { opening_float: 50000 }));

    const denied = await c("POST", `/api/sales/${ctx.sale.id}/refund`, { reason: "Customer changed mind", items: [{ sale_item_id: ctx.sale.items[0].id, qty: 2 }] });
    assert.equal(denied.data.error.code, "APPROVAL_REQUIRED");
    const badPin = await c("POST", `/api/sales/${ctx.sale.id}/refund`, { reason: "x", override_pin: "0000", items: [{ sale_item_id: ctx.sale.items[0].id, qty: 2 }] });
    assert.equal(badPin.data.error.code, "OVERRIDE_REJECTED");
    const refund = ok(await c("POST", `/api/sales/${ctx.sale.id}/refund`, { reason: "Customer changed mind", override_pin: "2468", items: [{ sale_item_id: ctx.sale.items[0].id, qty: 2 }] }));
    assert.equal(refund.type, "refund");
    assert.equal(refund.total, -12000);
    assert.equal(refund.approver.name, "Manager");
    const original = ok(await o("GET", `/api/sales/${ctx.sale.receipt_no}`));
    assert.equal(original.status, "partially_refunded");
    const batches = ok(await o("GET", `/api/stock/batches?product_id=${ctx.milk}`));
    // The sale took 5 from SOON then 1 from LATE; returns go back newest allocation first.
    assert.equal(batches.find((b) => b.batch_no === "LATE").qty_remaining, 10, "refunded stock went back into its original batches");
    assert.equal(batches.find((b) => b.batch_no === "SOON").qty_remaining, 1);

    // Expired stock: put 3 expired units on the books, then try to sell more than the good stock.
    ok(await o("POST", "/api/stock/adjust", { product_id: ctx.chips, qty: -19, reason: "correction" }));
    ok(await o("POST", "/api/stock/adjust", { product_id: ctx.chips, qty: 3, reason: "found", expiry_date: addDays(today, -2) }));
    const blocked = await c("POST", "/api/pos/checkout", { lines: [{ product_id: ctx.chips, qty: 2 }], payments: [{ method: "cash", amount: 4000 }] });
    assert.equal(blocked.data.error.code, "APPROVAL_REQUIRED");
    assert.match(blocked.data.error.details.reasons[0], /expired/);
    const writeOff = ok(await o("POST", "/api/stock/write-off-expired", {}));
    assert.equal(writeOff.qty, 3);
    const alerts = ok(await o("GET", "/api/stock/alerts"));
    assert.equal(alerts.counts.expired, 0);
    assert.ok(alerts.expiring.some((b) => b.product_id === ctx.milk && b.batch_no === "SOON"));
  });

  test("cashiers cannot do manager things or reach other branches", async () => {
    assert.equal((await ctx.cashier("POST", "/api/stock/adjust", { product_id: ctx.milk, qty: 1, reason: "found" })).status, 403);
    assert.equal((await ctx.cashier("GET", "/api/reports/daily")).status, 403);
    const b2 = ok(await ctx.owner("POST", "/api/branches", { code: "B2", name: "Second", timezone: "Asia/Kolkata" }));
    ctx.branch2 = b2.id;
    assert.equal((await client(null)("GET", "/api/me")).status, 401);
    const other = await fetch(`${base}/api/products`, { headers: { authorization: (await loginToken("cash1", "1357")), "x-branch-id": String(b2.id) } });
    assert.equal(other.status, 403);
  });

  test("transfers move stock between branches with expiry dates intact", async () => {
    const transfer = ok(await ctx.owner("POST", "/api/transfers", { to_branch_id: ctx.branch2, items: [{ product_id: ctx.milk, qty: 3 }] }));
    assert.equal(transfer.status, "in_transit");
    const b2 = client(ctx.ownerToken ?? (await loginToken("owner", null, "correct horse")).slice(7), ctx.branch2);
    const received = ok(await b2("POST", `/api/transfers/${transfer.id}/receive`));
    assert.equal(received.status, "received");
    const batches = ok(await b2("GET", `/api/stock/batches?product_id=${ctx.milk}`));
    assert.equal(batches.reduce((s, b) => s + b.qty_remaining, 0), 3);
    assert.equal(batches[0].expiry_date, addDays(today, 3), "soonest-expiring stock was sent first");
  });

  test("stock count applies variance", async () => {
    const result = ok(await ctx.owner("POST", "/api/stock/count", { items: [{ product_id: ctx.milk, counted: 6 }] }));
    assert.equal(result.lines[0].system_qty, 8);
    assert.equal(result.lines[0].variance, -2);
    assert.equal(result.variance_value, -2 * 4400);
    assert.equal(ok(await ctx.owner("GET", `/api/products/${ctx.milk}`)).stock_qty, 6);
  });

  test("daily summary and shift close reconcile cash", async () => {
    const summary = ok(await ctx.owner("GET", `/api/reports/daily?date=${today}`));
    assert.equal(summary.totals.transactions, 3);
    assert.equal(summary.totals.refunds_total, 12000);
    assert.equal(summary.totals.net_sales, 36000 + 20000 + 15000 - 12000);
    assert.ok(summary.payments.some((p) => p.method === "upi" && p.amount === 20000));
    assert.equal(summary.stock.write_off_qty, 3);
    const all = ok(await ctx.owner("GET", `/api/reports/daily?date=${today}&branch_id=all`));
    assert.equal(all.branches.length, 2);

    const report = ok(await ctx.owner("GET", `/api/shifts/${ctx.shift}`));
    assert.equal(report.expected_cash, 100000 + 36000 + 15000);
    const closed = ok(await ctx.owner("POST", `/api/shifts/${ctx.shift}/close`, { counted_cash: 150500 }));
    assert.equal(closed.shift.variance, -500);
    assert.equal(ok(await ctx.owner("GET", "/api/shifts/current")), null, "no open shift is reported as null");
  });

  test("API keys let the admin panel control branches and sync products", async () => {
    const key = ok(await ctx.owner("POST", "/api/api-keys", { name: "Restaurant admin panel" }));
    assert.ok(key.key.startsWith("sk_"));
    const hq = client(null);
    const overview = ok(await hq("GET", "/api/hq/overview", undefined, { "x-api-key": key.key }));
    assert.equal(overview.branches.length, 2);
    const sync = ok(
      await hq("PUT", "/api/products/bulk", [{ external_id: "ERP-1", sku: "ERP-1", name: "Synced Juice", price: 9900, barcode: ean("890100000099") }, { sku: "BAD" }], { "x-api-key": key.key })
    );
    assert.equal(sync.created, 1);
    assert.equal(sync.errors.length, 1);
    const resync = ok(await hq("PUT", "/api/products/bulk", { products: [{ external_id: "ERP-1", name: "Synced Juice 1L", price: 9500 }] }, { "x-api-key": key.key }));
    assert.equal(resync.updated, 1);

    ok(await hq("POST", `/api/branches/${ctx.branch2}/lock`, { reason: "Stock audit" }, { "x-api-key": key.key }));
    const b2 = client((await loginToken("owner", null, "correct horse")).slice(7), ctx.branch2);
    ok(await b2("POST", "/api/shifts/open", { opening_float: 0 }));
    ok(await b2("POST", "/api/stock/receive", { items: [{ product_id: ctx.chips, qty: 5 }] }));
    const locked = await b2("POST", "/api/pos/checkout", { lines: [{ product_id: ctx.chips, qty: 1 }], payments: [{ method: "cash", amount: 5000 }] });
    assert.equal(locked.data.error.code, "BRANCH_LOCKED");
    ok(await hq("POST", `/api/branches/${ctx.branch2}/unlock`, {}, { "x-api-key": key.key }));

    const scoped = ok(await ctx.owner("POST", "/api/api-keys", { name: "Branch 2 only", branch_id: ctx.branch2 }));
    const denied = await hq("GET", "/api/products", undefined, { "x-api-key": scoped.key, "x-branch-id": String(ctx.branch) });
    assert.equal(denied.status, 403);
    ok(await hq("GET", "/api/products", undefined, { "x-api-key": scoped.key }));
    assert.equal((await hq("GET", "/api/hq/overview", undefined, { "x-api-key": scoped.key })).status, 403);

    ok(await ctx.owner("DELETE", `/api/api-keys/${key.id}`));
    assert.equal((await hq("GET", "/api/hq/overview", undefined, { "x-api-key": key.key })).status, 401);
  });

  test("webhooks are signed and delivered", async () => {
    const received = [];
    const receiver = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        received.push({ headers: req.headers, body });
        res.end("ok");
      });
    });
    await new Promise((resolve) => receiver.listen(0, "127.0.0.1", resolve));
    let hook;
    try {
      hook = ok(await ctx.owner("POST", "/api/webhooks", { url: `http://127.0.0.1:${receiver.address().port}/hook`, events: ["sale.completed", "daily.summary", "stock.low"] }));
      ok(await ctx.owner("POST", "/api/shifts/open", { opening_float: 0 }));
      ok(await ctx.owner("POST", "/api/pos/checkout", { lines: [{ product_id: ctx.milk, qty: 1 }], payments: [{ method: "card", amount: 6000 }] }), 201);
      await processDeliveries(app.db);
    } finally {
      receiver.closeAllConnections();
      receiver.close();
    }
    const events = received.map((r) => JSON.parse(r.body).event);
    assert.ok(events.includes("sale.completed"));
    assert.ok(events.includes("stock.low"), "milk dropped to its reorder level");
    const first = received[0];
    assert.equal(first.headers["x-store-signature"], signPayload(hook.secret, first.headers["x-store-timestamp"], first.body));
    const deliveries = ok(await ctx.owner("GET", "/api/webhooks/deliveries"));
    assert.ok(deliveries.every((d) => d.status === "delivered"));
  });

  test("nightly job emits the previous day's summary once", async () => {
    app.db.prepare("UPDATE branches SET created_at = ?").run(new Date(Date.now() - 3 * 86400_000).toISOString());
    const first = runDailyJobs(app.db);
    assert.ok(first >= 1);
    assert.equal(runDailyJobs(app.db), 0);
  });

  test("CSV exports neutralise spreadsheet formulas", async () => {
    ok(await ctx.owner("POST", "/api/products", { name: "=HYPERLINK(\"x\")", price: 100 }));
    const res = await fetch(`${base}/api/reports/export/stock.csv?branch_id=all`, { headers: { authorization: await loginToken("owner", null, "correct horse") } });
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type"), /text\/csv/);
    const text = await res.text();
    assert.match(text, /^branch,sku,barcode/);
  });

  test("GS1 codes on the pack give expiry, batch, carton count and weight", async () => {
    const o = ctx.owner;
    const GS = "\x1d";
    const q = (code) => `/api/lookup?code=${encodeURIComponent(code)}`;
    const yymmdd = (iso) => iso.slice(2).replaceAll("-", "");
    const yogurtCode = ean("890100000010");
    const yogurt = ok(await o("POST", "/api/products", { name: "Yogurt", price: 3000, cost: 2000, barcode: yogurtCode })).id;
    const cheese = ok(await o("POST", "/api/products", { name: "Cheese loose", price: 80000, sold_by_weight: true, unit: "kg", barcode: ean("890100000011") })).id;
    const gtin = `0${yogurtCode}`;
    const exp = addDays(today, 40);

    // GS1 DataMatrix as a 2D scanner sends it: symbology id, separators, expiry, batch, serial.
    const hit = ok(await o("GET", q(`]d201${gtin}17${yymmdd(exp)}10LOT42${GS}21S1`)));
    assert.equal(hit.product.id, yogurt);
    assert.equal(hit.qty, 1);
    assert.deepEqual([hit.gs1.pack_expiry, hit.gs1.batch, hit.gs1.serial], [exp, "LOT42", "S1"]);

    // Supplier carton label: (02) contents + (37) count.
    const carton = ok(await o("GET", q(`]C102${gtin}3712${GS}17${yymmdd(exp)}10LOT42`)));
    assert.deepEqual([carton.qty, carton.source, carton.gs1.batch], [12, "case", "LOT42"]);

    // Net weight (310n) on a weighed product.
    const weighed = ok(await o("GET", q(`01${"0" + ean("890100000011")}3103001250`)));
    assert.deepEqual([weighed.product.id, weighed.qty, weighed.source], [cheese, 1.25, "scale_weight"]);

    // A scanner set to send symbology ids in front of plain EAN-13 codes still works.
    assert.equal(ok(await o("GET", q(`]E0${yogurtCode}`))).product.id, yogurt);

    // Unknown product: the error gives the EAN-13 to save and the pack data.
    const unknown = await o("GET", q(`01${"0" + ean("890100000098")}17${yymmdd(exp)}10NEW1`));
    assert.equal(unknown.data.error.code, "UNKNOWN_BARCODE");
    assert.equal(unknown.data.error.details.code, ean("890100000098"));
    assert.deepEqual([unknown.data.error.details.gs1.pack_expiry, unknown.data.error.details.gs1.batch], [exp, "NEW1"]);

    // Stock on record is fresh, but this pack's own date has passed: a cashier needs a manager PIN.
    ok(await o("POST", "/api/stock/receive", { items: [{ product_id: yogurt, qty: 5, expiry_date: exp }] }));
    const expired = ok(await ctx.cashier("GET", q(`01${gtin}17${yymmdd(addDays(today, -3))}`)));
    assert.equal(expired.gs1.pack_expiry, addDays(today, -3));
    const line = { product_id: yogurt, qty: 1, pack_expiry: expired.gs1.pack_expiry };
    const blocked = await ctx.cashier("POST", "/api/pos/checkout", { lines: [line], payments: [{ method: "cash", amount: 3000 }] });
    assert.equal(blocked.data.error.code, "APPROVAL_REQUIRED");
    assert.match(blocked.data.error.details.reasons.join(" "), /Yogurt expired on/);
    ok(await ctx.cashier("POST", "/api/pos/checkout", { lines: [line], payments: [{ method: "cash", amount: 3000 }], override_pin: "2468" }), 201);
    ok(await ctx.cashier("POST", "/api/pos/checkout", { lines: [{ ...line, pack_expiry: exp }], payments: [{ method: "cash", amount: 3000 }] }), 201);
    const bad = await ctx.cashier("POST", "/api/pos/checkout", { lines: [{ ...line, pack_expiry: "31/12/2027" }], payments: [{ method: "cash", amount: 3000 }] });
    assert.equal(bad.status, 400);
  });

  test("serves the web app and shared pricing module", async () => {
    const page = await fetch(`${base}/pos`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /<title>/);
    const shared = await fetch(`${base}/shared/pricing.js`);
    assert.equal(shared.status, 200);
    assert.equal((await fetch(`${base}/shared/../src/db.js`)).status, 404);
  });
});

async function loginToken(username, pin, password) {
  const res = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(pin ? { username, pin } : { username, password }) });
  const data = await res.json();
  return `Bearer ${data.token}`;
}
