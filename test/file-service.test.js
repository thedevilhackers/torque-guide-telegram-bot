import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";

process.env.ADMIN_PASSWORD = "correct-horse-battery";
process.env.RAZORPAY_KEY_ID = "rzp_test_key";
process.env.RAZORPAY_KEY_SECRET = "test-secret";
process.env.MAX_ECU_FILE_MB = "1";

const { createApp } = await import("../src/web/app.js");
const { db } = await import("../src/db.js");
const { cleanEcuFiles, ecuFilePath } = await import("../src/file-service.js");
const { fileOrderAlert, paymentAlert } = await import("../src/alerts.js");

let ipCounter = 0;

// A fake Razorpay API: links are created unpaid; markPaid makes a link read as paid.
function fakeRazorpay() {
  const links = new Map();
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, ...options });
    const body = options.body ? JSON.parse(options.body) : null;
    if (options.method === "POST") {
      const link = { id: `plink_${links.size + 1}`, short_url: `https://rzp.io/l/${links.size + 1}`, status: "created", amount: body.amount, amount_paid: 0, reference_id: body.reference_id, payments: [] };
      links.set(link.id, link);
      return new Response(JSON.stringify(link), { status: 200 });
    }
    const link = links.get(url.split("/").pop());
    return new Response(JSON.stringify(link ?? { error: { description: "not found" } }), { status: link ? 200 : 404 });
  };
  const markPaid = (id) => Object.assign(links.get(id), { status: "paid", amount_paid: links.get(id).amount, payments: [{ payment_id: "pay_123", status: "captured" }] });
  return { fetchImpl, calls, links, markPaid };
}

// A browser for one person: its own cookie and address. portal() adds the file page's header.
async function startApp(options = {}) {
  const server = createServer(createApp(options));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = () => {
    const ip = `10.1.0.${++ipCounter}`;
    let cookie = "";
    const request = async (path, { method = "GET", body, raw, headers = {}, as = null } = {}) => {
      const response = await fetch(base + path, {
        method,
        redirect: "manual",
        headers: {
          "x-forwarded-for": ip,
          ...(body !== undefined && { "content-type": "application/json" }),
          ...(raw !== undefined && { "content-type": "application/octet-stream" }),
          ...(as && { "x-requested-with": as }),
          ...(cookie && { cookie }),
          ...headers
        },
        body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined)
      });
      const setCookie = response.headers.get("set-cookie");
      if (setCookie) cookie = setCookie.split(";")[0];
      const type = response.headers.get("content-type") ?? "";
      return { status: response.status, headers: response.headers, data: type.includes("json") ? await response.json() : Buffer.from(await response.arrayBuffer()) };
    };
    return {
      request,
      portal: (path, options = {}) => request(path, { ...options, as: "unity-portal" }),
      admin: (path, options = {}) => request(path, { ...options, as: "unity-admin" })
    };
  };
  const admin = browser();
  await admin.admin("/api/admin/login", { method: "POST", body: { username: "admin", password: "correct-horse-battery" } });
  return { browser, admin, base, close: () => server.close() };
}

let emailCounter = 0;
async function signUp(person, extra = {}) {
  const email = `tuner${++emailCounter}@example.com`;
  const response = await person.portal("/api/portal/register", { method: "POST", body: { name: "Ravi Tuner", email, phone: "+91 98765 43210", company: "Ravi Motors", password: "long-password-1", ...extra } });
  assert.equal(response.status, 200, JSON.stringify(response.data));
  return { email, id: response.data.customer.id };
}

const ORDER = { make: "Volkswagen", model: "Polo", engine: "1.0 TSI 110 hp", year: 2019, fuel: "petrol", gearbox: "manual", ecu: "Bosch MED17.5.25", tool: "autotuner", toolMode: "slave", readMethod: "obd", tuneId: "stage-1", addonIds: ["pops-bangs"], notes: "E20 pump fuel" };

async function upload(person, bytes = Buffer.from("ORIGINAL-ECU-READ"), name = "polo original.bin") {
  return person.portal("/api/portal/uploads", { method: "POST", raw: bytes, headers: { "x-file-name": encodeURIComponent(name) } });
}

test("customers sign up, sign in and out; the account API needs the page and a session", async (t) => {
  const { browser, close } = await startApp();
  t.after(close);
  const person = browser();
  assert.equal((await person.request("/api/portal/me")).status, 401);
  assert.deepEqual((await person.request("/api/portal/session")).data, { customer: null });
  // Without the page's header (e.g. a form on another site) nothing changes.
  assert.equal((await person.request("/api/portal/register", { method: "POST", body: { name: "X", email: "x@example.com", phone: "123456", password: "long-password-1" } })).status, 403);
  assert.equal((await person.portal("/api/portal/register", { method: "POST", body: { name: "Ravi", email: "ravi@example.com", phone: "12345678", password: "short" } })).status, 400);

  const { email } = await signUp(person);
  const me = await person.request("/api/portal/me");
  assert.equal(me.data.customer.credits, 0);
  assert.equal((await person.request("/api/portal/session")).data.customer.email, email);
  assert.equal(me.data.customer.password, undefined);
  assert.match(me.headers.get("cache-control"), /no-store/);
  const stored = db().customers.find((customer) => customer.email === email);
  assert.notEqual(stored.password.hash, "long-password-1");

  assert.equal((await browser().portal("/api/portal/register", { method: "POST", body: { name: "Other", email: email.toUpperCase(), phone: "12345678", password: "long-password-2" } })).status, 400, "emails are unique, ignoring case");

  assert.equal((await person.portal("/api/portal/logout", { method: "POST" })).status, 200);
  assert.equal((await person.request("/api/portal/me")).status, 401);
  assert.equal((await person.portal("/api/portal/login", { method: "POST", body: { email, password: "wrong-password" } })).status, 401);
  assert.equal((await person.portal("/api/portal/login", { method: "POST", body: { email: ` ${email.toUpperCase()} `, password: "long-password-1" } })).status, 200);
  assert.equal((await person.request("/api/portal/me")).status, 200);

  // Repeated wrong passwords for one account are stopped, from any address.
  for (let i = 0; i < 8; i++) await browser().portal("/api/portal/login", { method: "POST", body: { email, password: `guess-${i}` } });
  assert.equal((await browser().portal("/api/portal/login", { method: "POST", body: { email, password: "long-password-1" } })).status, 429);
});

test("an order needs an upload and enough credits, is priced on the server and takes the credits", async (t) => {
  const { browser, admin, close } = await startApp();
  t.after(close);
  const person = browser();
  const { id } = await signUp(person);

  assert.equal((await person.portal("/api/portal/orders", { method: "POST", body: ORDER })).status, 400, "no upload yet");
  assert.equal((await person.request("/api/portal/uploads", { method: "POST", raw: Buffer.from("x") })).status, 403, "uploads need the page's header");
  assert.equal((await upload(person, Buffer.alloc(0))).status, 400, "empty file");
  assert.equal((await upload(person, Buffer.alloc(1_048_577))).status, 413, "over MAX_ECU_FILE_MB");
  const uploaded = await upload(person);
  assert.equal(uploaded.status, 200);
  assert.equal(uploaded.data.upload.name, "polo original.bin");
  assert.equal(uploaded.data.upload.size, 17);

  const short = await person.portal("/api/portal/orders", { method: "POST", body: { ...ORDER, uploadId: uploaded.data.upload.id } });
  assert.equal(short.status, 400);
  assert.match(short.data.error, /needs 2 credits and you have 0/);

  // The admin adds credits (e.g. paid at the workshop); a note is required.
  assert.equal((await admin.admin(`/api/admin/customers/${id}/credits`, { method: "POST", body: { change: 5 } })).status, 400);
  assert.equal((await admin.admin(`/api/admin/customers/${id}/credits`, { method: "POST", body: { change: 5, note: "Paid cash" } })).data.item.credits, 5);
  assert.equal((await admin.admin(`/api/admin/customers/${id}/credits`, { method: "POST", body: { change: -9, note: "Oops" } })).status, 400, "never below zero");

  // Credits sent from the browser are ignored; unknown add-ons are refused.
  assert.equal((await person.portal("/api/portal/orders", { method: "POST", body: { ...ORDER, uploadId: uploaded.data.upload.id, addonIds: ["dpf-off"] } })).status, 400);
  const placed = await person.portal("/api/portal/orders", { method: "POST", body: { ...ORDER, uploadId: uploaded.data.upload.id, credits: 0 } });
  assert.equal(placed.status, 200, JSON.stringify(placed.data));
  assert.equal(placed.data.order.credits, 2);
  assert.match(placed.data.order.number, /^TF-\d+$/);
  assert.deepEqual(placed.data.order.options.map((option) => option.id), ["stage-1", "pops-bangs"]);
  assert.equal(placed.data.customer.credits, 3);
  assert.equal(placed.data.order.tuned, null);
  assert.equal(placed.data.order.adminNotes, undefined, "private notes stay private");
  // An upload is used once.
  assert.equal((await person.portal("/api/portal/orders", { method: "POST", body: { ...ORDER, uploadId: uploaded.data.upload.id } })).status, 400);

  const overview = (await person.request("/api/portal/overview")).data;
  assert.equal(overview.orders.length, 1);
  assert.deepEqual(overview.ledger.map((entry) => [entry.reason, entry.change, entry.balance]), [["order", -2, 3], ["admin", 5, 5]]);

  // Someone else can't see, download or cancel it.
  const stranger = browser();
  await signUp(stranger);
  assert.equal((await stranger.request(`/api/portal/orders/${placed.data.order.id}/download?file=original`)).status, 404);
  assert.equal((await stranger.portal(`/api/portal/orders/${placed.data.order.id}/cancel`, { method: "POST" })).status, 404);
  assert.equal((await stranger.request("/api/portal/overview")).data.orders.length, 0);

  const original = await person.request(`/api/portal/orders/${placed.data.order.id}/download?file=original`);
  assert.equal(original.data.toString(), "ORIGINAL-ECU-READ");
  assert.match(original.headers.get("content-disposition"), /attachment; filename="polo original\.bin"/);
  assert.equal((await person.request(`/api/portal/orders/${placed.data.order.id}/download`)).status, 404, "no tuned file yet");

  // The customer can cancel while it's waiting; the credits come back.
  const cancelled = await person.portal(`/api/portal/orders/${placed.data.order.id}/cancel`, { method: "POST" });
  assert.equal(cancelled.data.order.status, "cancelled");
  assert.equal(cancelled.data.customer.credits, 5);
  assert.equal((await person.portal(`/api/portal/orders/${placed.data.order.id}/cancel`, { method: "POST" })).status, 400);
});

test("the admin works an order: notes the outside order, uploads the tuned file, and a rejection refunds once", async (t) => {
  const { browser, admin, close } = await startApp();
  t.after(close);
  const person = browser();
  const { id } = await signUp(person);
  await admin.admin(`/api/admin/customers/${id}/credits`, { method: "POST", body: { change: 10, note: "Starter" } });
  const place = async () => person.portal("/api/portal/orders", { method: "POST", body: { ...ORDER, uploadId: (await upload(person)).data.upload.id } });
  const order = (await place()).data.order;

  const listed = (await admin.request("/api/admin/file-orders")).data.items.find((item) => item.id === order.id);
  assert.equal(listed.customer.company, "Ravi Motors");
  assert.equal((await admin.request(`/api/admin/file-orders/${order.id}/download`)).data.toString(), "ORIGINAL-ECU-READ");
  assert.equal((await admin.admin(`/api/admin/file-orders/${order.id}`, { method: "PATCH", body: { status: "completed" } })).status, 400, "ready needs a tuned file");

  const sent = await admin.admin(`/api/admin/file-orders/${order.id}`, { method: "PATCH", body: { providerReference: "FCF-77812", adminNotes: "sent by hand" } });
  assert.equal(sent.data.item.status, "in_progress");
  assert.equal(sent.data.item.provider.reference, "FCF-77812");

  assert.equal((await admin.request(`/api/admin/file-orders/${order.id}/tuned`, { method: "POST", raw: Buffer.from("TUNED") })).status, 403, "uploads need the admin header");
  const tuned = await admin.admin(`/api/admin/file-orders/${order.id}/tuned`, { method: "POST", raw: Buffer.from("TUNED-FILE"), headers: { "x-file-name": encodeURIComponent("polo stage1.bin") } });
  assert.equal(tuned.status, 200);
  assert.equal(tuned.data.item.status, "completed");
  const firstTuned = tuned.data.item.tuned.file;
  // A corrected file replaces the first one, which is deleted.
  const again = await admin.admin(`/api/admin/file-orders/${order.id}/tuned`, { method: "POST", raw: Buffer.from("TUNED-FILE-V2"), headers: { "x-file-name": "polo stage1 v2.bin" } });
  assert.equal(existsSync(ecuFilePath(firstTuned)), false);
  assert.equal(existsSync(ecuFilePath(again.data.item.tuned.file)), true);

  const mine = (await person.request("/api/portal/overview")).data.orders.find((item) => item.id === order.id);
  assert.deepEqual(mine.tuned, { name: "polo stage1 v2.bin", size: 13 });
  assert.equal((await person.request(`/api/portal/orders/${order.id}/download`)).data.toString(), "TUNED-FILE-V2");
  assert.equal((await person.portal(`/api/portal/orders/${order.id}/cancel`, { method: "POST" })).status, 400, "too late to cancel");

  // Rejecting refunds the credits once; a closed order can't be reopened.
  const second = (await place()).data.order;
  assert.equal((await person.request("/api/portal/me")).data.customer.credits, 6);
  const rejected = await admin.admin(`/api/admin/file-orders/${second.id}`, { method: "PATCH", body: { status: "rejected", message: "This ECU needs a bench read." } });
  assert.equal(rejected.data.item.status, "rejected");
  assert.equal((await person.request("/api/portal/me")).data.customer.credits, 8);
  assert.equal((await admin.admin(`/api/admin/file-orders/${second.id}`, { method: "PATCH", body: { status: "submitted" } })).status, 400);
  assert.equal((await admin.admin(`/api/admin/file-orders/${second.id}`, { method: "PATCH", body: { status: "cancelled" } })).status, 400);
  assert.equal((await person.request("/api/portal/me")).data.customer.credits, 8);
  assert.equal((await person.request("/api/portal/overview")).data.orders.find((item) => item.id === second.id).message, "This ECU needs a bench read.");
});

test("buying credits by UPI: the customer gives the reference and the admin confirms once", async (t) => {
  const { browser, admin, close } = await startApp();
  t.after(close);
  const person = browser();
  const { id } = await signUp(person);
  const pack = await admin.admin("/api/admin/creditPacks", { method: "POST", body: { name: "Tuner 5", credits: 5, price: 9999, active: true } });
  assert.equal(pack.status, 200, JSON.stringify(pack.data));
  const packId = pack.data.item.id;

  const settings = (await admin.request("/api/admin/settings")).data.settings;
  assert.equal((await person.portal("/api/portal/purchases", { method: "POST", body: { packId, method: "upi" } })).status, 400, "UPI isn't set up yet");
  assert.equal((await admin.admin("/api/admin/settings", { method: "PUT", body: { ...settings, currency: "INR", upiId: "not a upi id" } })).status, 400);
  assert.equal((await admin.admin("/api/admin/settings", { method: "PUT", body: { ...settings, currency: "INR", upiId: "unityperformance@okaxis", upiName: "Unity Performance" } })).status, 200);

  const catalog = (await person.request("/api/portal/catalog")).data;
  assert.deepEqual(catalog.packs.map((item) => [item.name, item.credits, item.price]), [["Tuner 5", 5, 9999]]);
  assert.deepEqual(catalog.payments, { upi: true, online: true });

  const created = await person.portal("/api/portal/purchases", { method: "POST", body: { packId, method: "upi" } });
  const purchase = created.data.purchase;
  assert.equal(purchase.status, "awaiting_payment");
  assert.match(purchase.upi.url, /^upi:\/\/pay\?pa=unityperformance%40okaxis&pn=Unity%20Performance&am=9999\.00&cu=INR&tn=/);

  assert.equal((await person.portal(`/api/portal/purchases/${purchase.id}/reference`, { method: "POST", body: { reference: "12" } })).status, 400);
  const submitted = await person.portal(`/api/portal/purchases/${purchase.id}/reference`, { method: "POST", body: { reference: "4123 5678 9012" } });
  assert.equal(submitted.data.purchase.status, "submitted");
  assert.equal(submitted.data.purchase.utr, "412356789012");
  assert.equal((await admin.request("/api/admin/dashboard")).data.paymentsToCheck >= 1, true);

  const stranger = browser();
  await signUp(stranger);
  assert.equal((await stranger.portal(`/api/portal/purchases/${purchase.id}/cancel`, { method: "POST" })).status, 404);

  assert.equal((await admin.admin(`/api/admin/purchases/${purchase.id}/confirm`, { method: "POST" })).data.item.status, "paid");
  await admin.admin(`/api/admin/purchases/${purchase.id}/confirm`, { method: "POST" });
  assert.equal((await person.request("/api/portal/me")).data.customer.credits, 5, "confirming twice adds credits once");
  assert.equal((await admin.admin(`/api/admin/purchases/${purchase.id}/cancel`, { method: "POST" })).status, 400, "a paid payment can't be cancelled");
  const ledger = (await admin.request(`/api/admin/customers/${id}`)).data.ledger;
  assert.deepEqual(ledger.map((entry) => [entry.reason, entry.change, entry.ref]), [["purchase", 5, purchase.number]]);
});

test("buying credits online: Razorpay's signed return adds credits, a forged one doesn't", async (t) => {
  const razorpay = fakeRazorpay();
  const { browser, admin, close } = await startApp({ fetchImpl: razorpay.fetchImpl });
  t.after(close);
  const person = browser();
  await signUp(person);
  const settings = (await admin.request("/api/admin/settings")).data.settings;
  await admin.admin("/api/admin/settings", { method: "PUT", body: { ...settings, currency: "INR" } });
  const packId = (await admin.admin("/api/admin/creditPacks", { method: "POST", body: { name: "Online 2", credits: 2, price: 4500.5, active: true } })).data.item.id;

  const created = await person.portal("/api/portal/purchases", { method: "POST", body: { packId, method: "online" } });
  assert.equal(created.status, 200, JSON.stringify(created.data));
  assert.equal(created.data.purchase.payUrl, "https://rzp.io/l/1");
  const sentToRazorpay = JSON.parse(razorpay.calls[0].body);
  assert.equal(sentToRazorpay.amount, 450050);
  assert.match(sentToRazorpay.callback_url, /\/api\/portal\/razorpay\/return$/);
  assert.match(razorpay.calls[0].headers.Authorization, /^Basic /);
  const number = sentToRazorpay.reference_id;

  const sign = (fields) => createHmac("sha256", "test-secret").update(fields.join("|")).digest("hex");
  const query = (status, signature) => `razorpay_payment_id=pay_123&razorpay_payment_link_id=plink_1&razorpay_payment_link_reference_id=${number}&razorpay_payment_link_status=${status}&razorpay_signature=${signature}`;

  const forged = await person.request(`/api/portal/razorpay/return?${query("paid", sign(["plink_1", number, "paid", "pay_999"]))}`);
  assert.equal(forged.status, 303);
  assert.equal(forged.headers.get("location"), "/files?payment=failed#credits");
  assert.equal((await person.request("/api/portal/me")).data.customer.credits, 0);

  const genuine = await person.request(`/api/portal/razorpay/return?${query("paid", sign(["plink_1", number, "paid", "pay_123"]))}`);
  assert.equal(genuine.headers.get("location"), "/files?payment=paid#credits");
  await person.request(`/api/portal/razorpay/return?${query("paid", sign(["plink_1", number, "paid", "pay_123"]))}`);
  assert.equal((await person.request("/api/portal/me")).data.customer.credits, 2, "a repeated return adds nothing");

  // A customer who closed the page before returning can ask us to check with Razorpay.
  const second = (await person.portal("/api/portal/purchases", { method: "POST", body: { packId, method: "online" } })).data.purchase;
  assert.equal((await person.portal(`/api/portal/purchases/${second.id}/check`, { method: "POST" })).data.purchase.status, "awaiting_payment");
  razorpay.markPaid("plink_2");
  const checked = await person.portal(`/api/portal/purchases/${second.id}/check`, { method: "POST" });
  assert.equal(checked.data.purchase.status, "paid");
  assert.equal(checked.data.customer.credits, 4);
});

test("forgotten passwords: the admin's one-time link sets a new one and signs out other sessions", async (t) => {
  const { browser, admin, close } = await startApp();
  t.after(close);
  const person = browser();
  const { email, id } = await signUp(person);
  const link = (await admin.admin(`/api/admin/customers/${id}/reset-link`, { method: "POST" })).data;
  const token = link.url.split("#reset=")[1];
  assert.match(link.url, /\/files#reset=[A-Za-z0-9_-]{43}$/);

  const phone = browser();
  assert.equal((await phone.portal("/api/portal/reset", { method: "POST", body: { token: "x".repeat(43), password: "new-password-2" } })).status, 400);
  assert.equal((await phone.portal("/api/portal/reset", { method: "POST", body: { token, password: "new-password-2" } })).status, 200);
  assert.equal((await phone.request("/api/portal/me")).status, 200, "signed in on the device that reset it");
  assert.equal((await person.request("/api/portal/me")).status, 401, "other sessions end");
  assert.equal((await phone.portal("/api/portal/reset", { method: "POST", body: { token, password: "another-pass-3" } })).status, 400, "links work once");
  assert.equal((await browser().portal("/api/portal/login", { method: "POST", body: { email, password: "new-password-2" } })).status, 200);

  // A switched-off account is signed out and can't sign in.
  await admin.admin(`/api/admin/customers/${id}`, { method: "PATCH", body: { active: false } });
  assert.equal((await phone.request("/api/portal/me")).status, 401);
  assert.equal((await browser().portal("/api/portal/login", { method: "POST", body: { email, password: "new-password-2" } })).status, 403);
});

test("backups keep accounts, credits and file orders; older backups restore without them", async (t) => {
  const { browser, admin, close } = await startApp();
  t.after(close);
  const person = browser();
  const { id } = await signUp(person);
  await admin.admin(`/api/admin/customers/${id}/credits`, { method: "POST", body: { change: 3, note: "Gift" } });
  await person.portal("/api/portal/orders", { method: "POST", body: { ...ORDER, addonIds: [], uploadId: (await upload(person)).data.upload.id } });

  const backup = (await admin.request("/api/admin/export")).data;
  assert.ok(backup.customers.some((customer) => customer.id === id));
  assert.equal((await admin.admin("/api/admin/import", { method: "POST", body: backup })).status, 200);
  assert.equal(db().customers.find((customer) => customer.id === id).credits, 2);
  assert.ok(db().nextFileOrderNumber > Math.max(...db().fileOrders.map((order) => Number(order.number.slice(3)))));

  const damaged = structuredClone(backup);
  damaged.fileOrders[0].customerId = "c0000";
  assert.equal((await admin.admin("/api/admin/import", { method: "POST", body: damaged })).status, 400);

  const older = structuredClone(backup);
  for (const name of ["customers", "creditLedger", "creditPurchases", "fileOrders", "tuneOptions", "creditPacks"]) delete older[name];
  assert.equal((await admin.admin("/api/admin/import", { method: "POST", body: older })).status, 200);
  assert.equal(db().customers.length, 0);
  assert.ok(db().tuneOptions.some((option) => option.id === "stage-1"), "starting options come back");
  assert.equal((await person.request("/api/portal/me")).status, 401, "a deleted account is signed out");
});

test("unused uploads are cleaned up; options never include emissions or immobiliser removal", async () => {
  assert.equal(typeof cleanEcuFiles(), "number");
  const names = db().tuneOptions.map((option) => `${option.id} ${option.name} ${option.description}`).join(" ");
  assert.doesNotMatch(names, /\b(dpf|egr|adblue|scr|lambda|o2|decat|cat off|immo)\b/i);
  // The only mention is the notice that they aren't offered.
  for (const file of ["public/js/files.js", "public/index.html"]) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8").replace(/We don't remove emissions equipment \([^)]*\)/g, "");
    assert.doesNotMatch(source, /\b(dpf|egr|adblue|immo off)\b/i, file);
  }
});

test("file order and payment alerts read clearly", () => {
  const customer = { id: "c1", name: "Ravi", phone: "+91 98765 43210", company: "Ravi Motors" };
  const order = { id: "f1", number: "TF-1001", customerId: "c1", credits: 2, vehicle: { make: "VW", model: "Polo", engine: "1.0 TSI", year: 2019, fuel: "petrol" }, ecu: "MED17", tool: "autotuner", toolMode: "slave", readMethod: "obd", options: [{ name: "Stage 1" }, { name: "Pops & bangs" }], notes: "" };
  const { text } = fileOrderAlert(order);
  assert.match(text, /New tuning file TF-1001<\/b> · 2 credits/);
  assert.match(text, /Autotuner Slave · OBD read/);
  assert.match(text, /Stage 1, Pops &amp; bangs/);
  assert.match(paymentAlert({ number: "CR-1001", customerId: customer.id, amount: 9999, currency: "INR", packName: "Tuner 5", credits: 5, utr: "412356789012" }).text, /UTR 412356789012/);
});
