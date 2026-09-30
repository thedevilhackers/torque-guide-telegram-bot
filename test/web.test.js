import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";

process.env.ADMIN_PASSWORD = "correct-horse-battery";
process.env.WHATSAPP_NUMBER = "94770000000";

const { createApp } = await import("../src/web/app.js");
const { validateVehicle, vehicleFormValues } = await import("../src/validation.js");
const { vehicleEntries } = await import("../src/vehicles.js");
const { db } = await import("../src/db.js");

let ipCounter = 0;

// Each call gets its own app (fresh rate limiters) and a unique client IP.
async function startApp() {
  const server = createServer(createApp());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const ip = `10.0.0.${++ipCounter}`;
  let cookie = "";
  const request = async (path, { method = "GET", body, headers = {}, admin = false } = {}) => {
    const response = await fetch(base + path, {
      method,
      headers: {
        "x-forwarded-for": ip,
        ...(body !== undefined && { "content-type": "application/json" }),
        ...(admin && { "x-requested-with": "unity-admin" }),
        ...(cookie && { cookie }),
        ...headers
      },
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";")[0];
    const type = response.headers.get("content-type") ?? "";
    return { status: response.status, headers: response.headers, data: type.includes("json") ? await response.json() : Buffer.from(await response.arrayBuffer()) };
  };
  const login = () => request("/api/admin/login", { method: "POST", admin: true, body: { username: "admin", password: "correct-horse-battery" } });
  return { request, login, close: () => server.close() };
}

const order = (items, extra = {}) => ({ customer: { name: "Sam Perera", phone: "+94 77 123 4567" }, fulfilment: "pickup", items, ...extra });

test("every seed vehicle passes the admin validation", () => {
  const context = { brandIds: db().brands.map((brand) => brand.id), ecuIds: db().ecus.map((ecu) => ecu.id) };
  for (const entry of vehicleEntries()) assert.doesNotThrow(() => validateVehicle(vehicleFormValues(entry), context), entry.id);
});

test("public pages and APIs", async (t) => {
  const { request, close } = await startApp();
  t.after(close);

  const home = await request("/");
  assert.equal(home.status, 200);
  assert.match(home.headers.get("content-security-policy"), /script-src 'self'/);
  assert.match(home.data.toString(), /<title>Unity Performance/);
  assert.equal((await request("/shop")).status, 200);
  assert.equal((await request("/admin")).status, 200);
  assert.equal((await request("/..%2Fpackage.json")).status, 404);
  assert.equal((await request("/uploads/../../package.json")).status, 404);

  const site = await request("/api/site");
  assert.equal(site.data.settings.businessName, "Unity Performance");
  assert.equal(site.data.settings.whatsappNumber, "94770000000");
  assert.ok(site.data.brands.some((brand) => brand.id === "toyota"));
  assert.equal(site.data.vehicleCount, vehicleEntries().length);

  const search = await request("/api/vehicles?q=golf%20gti%202022");
  assert.equal(search.data.vehicles[0].id, "vw_golf8_gti");
  const vehicle = await request("/api/vehicles/vw_golf7_gti");
  assert.deepEqual(vehicle.data.vehicle.gain, { hp: 70, nm: 70, hpPercent: 32, nmPercent: 20 });
  assert.equal(Math.max(...vehicle.data.curves.stage1.power), 290);
  assert.ok(vehicle.data.curves.stock.rpm.every((rpm) => rpm % 100 === 0));
  const graph = await request("/api/vehicles/vw_golf7_gti/graph.png");
  assert.equal(graph.headers.get("content-type"), "image/png");
  assert.equal((await request("/api/vehicles/nope")).status, 404);
  assert.equal((await request("/api/vehicles/identify?q=nissan+patrol")).status, 404, "AI search is off without an API key");
});

test("orders use server prices, reduce stock and reject bad input", async (t) => {
  const { request, close } = await startApp();
  t.after(close);
  const before = db().products.find((product) => product.id === "uprated-intercooler").stock;

  const placed = await request("/api/orders", { method: "POST", body: order([{ id: "uprated-intercooler", qty: 1, price: 1 }, { id: "stage1-voucher", qty: 2 }]) });
  assert.equal(placed.status, 200);
  assert.equal(placed.data.order.total, 890 + 700);
  assert.match(placed.data.order.number, /^UP-\d+$/);
  assert.ok(placed.data.whatsappUrl.startsWith("https://wa.me/94770000000?text="));
  assert.match(decodeURIComponent(placed.data.whatsappUrl), /1 × Uprated Intercooler/);
  assert.equal(db().products.find((product) => product.id === "uprated-intercooler").stock, before - 1);

  const tooMany = await request("/api/orders", { method: "POST", body: order([{ id: "uprated-intercooler", qty: 5 }]) });
  assert.equal(tooMany.status, 400);
  assert.match(tooMany.data.error, /Only 1 left/);
  assert.equal((await request("/api/orders", { method: "POST", body: order([{ id: "cap", qty: 1 }], { customer: { name: "Sam", phone: "abc" } }) })).status, 400);
  assert.equal((await request("/api/orders", { method: "POST", body: order([{ id: "cap", qty: 1 }], { fulfilment: "delivery" }) })).data.error, "A delivery address is required.");
  assert.equal((await request("/api/orders", { method: "POST", body: order([{ id: "missing", qty: 1 }]) })).status, 400);
  assert.equal((await request("/api/orders", { method: "POST", body: order([]) })).status, 400);

  const crossSite = await request("/api/orders", { method: "POST", body: order([{ id: "cap", qty: 1 }]), headers: { origin: "https://evil.example" } });
  assert.equal(crossSite.status, 403);
  const form = await request("/api/orders", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "x" });
  assert.equal(form.status, 415);
});

test("website enquiries are stored with a vehicle snapshot", async (t) => {
  const { request, close } = await startApp();
  t.after(close);
  const result = await request("/api/enquiries", { method: "POST", body: { name: "Kasun", phone: "0771234567", vehicleId: "toyota_hilux_28b", ecu: "denso", location: "Galle" } });
  assert.equal(result.status, 200);
  assert.match(decodeURIComponent(result.data.whatsappUrl), /Stage 1 estimate: 235 hp \/ 580 Nm/);
  const stored = db().enquiries.find((enquiry) => enquiry.id === result.data.id);
  assert.equal(stored.source, "website");
  assert.deepEqual(stored.vehicle.stage1, { hp: 235, nm: 580 });
  assert.equal((await request("/api/enquiries", { method: "POST", body: { name: "K", phone: "0771234567" } })).status, 400);
});

test("admin sign-in, protection and brute-force limit", async (t) => {
  const { request, login, close } = await startApp();
  t.after(close);
  assert.equal((await request("/api/admin/dashboard")).status, 401);
  assert.equal((await request("/api/admin/login", { method: "POST", body: { username: "admin", password: "correct-horse-battery" } })).status, 403, "login needs the admin header");
  for (let i = 0; i < 5; i++) assert.equal((await request("/api/admin/login", { method: "POST", admin: true, body: { username: "admin", password: "wrong" } })).status, 401);
  const blocked = await login();
  assert.equal(blocked.status, 429, "a blocked address can't sign in even with the right password");

  const other = await startApp();
  t.after(other.close);
  const ok = await other.login();
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get("set-cookie"), /HttpOnly; SameSite=Strict/);
  assert.equal((await other.request("/api/admin/dashboard")).status, 200);
  assert.equal((await other.request("/api/admin/products", { method: "POST", body: { name: "x" } })).status, 403, "changes need the admin header");
  await other.request("/api/admin/logout", { method: "POST", admin: true });
  assert.equal((await other.request("/api/admin/dashboard")).status, 401);
});

test("admin manages products, vehicles, brands and ECUs", async (t) => {
  const { request, login, close } = await startApp();
  t.after(close);
  await login();

  const created = await request("/api/admin/products", { method: "POST", admin: true, body: { name: "Carbon Intake", category: "Performance parts", price: "249.5", stock: "", features: "Carbon fibre\nHeat shield", active: true } });
  assert.equal(created.status, 200);
  assert.equal(created.data.item.id, "carbon-intake");
  assert.equal(created.data.item.stock, null);
  assert.deepEqual(created.data.item.features, ["Carbon fibre", "Heat shield"]);
  assert.ok((await request("/api/products")).data.products.some((product) => product.id === "carbon-intake"));
  const hidden = await request("/api/admin/products/carbon-intake", { method: "PUT", admin: true, body: { ...created.data.item, active: false } });
  assert.equal(hidden.data.item.active, false);
  assert.ok(!(await request("/api/products")).data.products.some((product) => product.id === "carbon-intake"));
  assert.equal((await request("/api/admin/products", { method: "POST", admin: true, body: { name: "Bad", category: "X", price: 10, compareAtPrice: 5 } })).status, 400);
  assert.equal((await request("/api/admin/products/carbon-intake", { method: "DELETE", admin: true })).status, 200);

  const vehicle = { brand: "nissan", model: "Patrol", generation: "Y62", engine: "5.6 V8", fuel: "petrol", aspiration: "naturally_aspirated", yearFrom: 2010, stockHp: 405, stockNm: 560, stage1Hp: 425, stage1Nm: 585, ecus: [] };
  const added = await request("/api/admin/vehicles", { method: "POST", admin: true, body: vehicle });
  assert.equal(added.status, 200);
  assert.equal(added.data.item.id, "nissan_patrol_y62");
  assert.equal((await request("/api/vehicles?q=patrol")).data.vehicles[0].id, "nissan_patrol_y62");
  assert.equal((await request("/api/vehicles/nissan_patrol_y62/graph.png")).status, 200);
  const unrealistic = await request("/api/admin/vehicles", { method: "POST", admin: true, body: { ...vehicle, stockNm: 2000, stage1Nm: 2100 } });
  assert.match(unrealistic.data.error, /0\.8× and 3\.5×/);
  assert.match((await request("/api/admin/vehicles", { method: "POST", admin: true, body: { ...vehicle, stage1Hp: 406 } })).data.error, /at least 3%/);

  const brandInUse = await request("/api/admin/brands/nissan", { method: "DELETE", admin: true });
  assert.equal(brandInUse.status, 400);
  assert.match(brandInUse.data.error, /used by 2 vehicles/);

  assert.ok(vehicleEntries().some((entry) => entry.ecus.includes("denso")));
  assert.equal((await request("/api/admin/ecus/denso", { method: "DELETE", admin: true })).status, 200);
  assert.ok(!vehicleEntries().some((entry) => entry.ecus.includes("denso")), "deleting an ECU removes it from vehicles");
});

test("cancelling an order returns stock and reopening takes it again", async (t) => {
  const { request, login, close } = await startApp();
  t.after(close);
  const stock = () => db().products.find((product) => product.id === "cap").stock;
  const start = stock();
  const placed = await request("/api/orders", { method: "POST", body: order([{ id: "cap", qty: 3 }]) });
  assert.equal(stock(), start - 3);
  await login();
  const id = db().orders.find((item) => item.number === placed.data.order.number).id;
  await request(`/api/admin/orders/${id}`, { method: "PATCH", admin: true, body: { status: "cancelled", adminNotes: "Customer changed mind" } });
  assert.equal(stock(), start);
  await request(`/api/admin/orders/${id}`, { method: "PATCH", admin: true, body: { status: "confirmed" } });
  assert.equal(stock(), start - 3);
  assert.equal((await request(`/api/admin/orders/${id}`, { method: "PATCH", admin: true, body: { status: "lost" } })).status, 400);
  const dashboard = await request("/api/admin/dashboard");
  assert.ok(dashboard.data.revenue30 >= 75);
  assert.equal(dashboard.data.daily.length, 14);
});

test("settings, uploads and backups", async (t) => {
  const { request, login, close } = await startApp();
  t.after(close);
  await login();
  const { data } = await request("/api/admin/settings");
  const saved = await request("/api/admin/settings", { method: "PUT", admin: true, body: { ...data.settings, businessName: "Unity Performance Colombo", currency: "lkr", whatsappNumber: "+94 77 999 8888", latitude: "6.9", longitude: "79.86" } });
  assert.equal(saved.status, 200);
  assert.equal(saved.data.settings.currency, "LKR");
  const site = await request("/api/site");
  assert.equal(site.data.settings.businessName, "Unity Performance Colombo");
  assert.equal(site.data.settings.whatsappNumber, "94779998888");
  assert.equal((await request("/api/admin/settings", { method: "PUT", admin: true, body: { ...data.settings, latitude: "6.9" } })).status, 400);

  const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4530000000049454e44ae426082", "hex");
  const upload = await request("/api/admin/uploads", { method: "POST", admin: true, body: { data: `data:image/png;base64,${png.toString("base64")}` } });
  assert.match(upload.data.url, /^\/uploads\/[a-f0-9]{32}\.png$/);
  const served = await request(upload.data.url);
  assert.equal(served.headers.get("content-type"), "image/png");
  const fake = await request("/api/admin/uploads", { method: "POST", admin: true, body: { data: `data:image/png;base64,${Buffer.from("<svg onload=alert(1)>").toString("base64")}` } });
  assert.equal(fake.status, 400);

  const backup = await request("/api/admin/export");
  assert.match(backup.headers.get("content-disposition"), /attachment; filename="unity-performance-backup-/);
  const exported = backup.data;
  await request("/api/admin/settings", { method: "PUT", admin: true, body: { ...exported.settings, businessName: "Changed" } });
  assert.equal((await request("/api/admin/import", { method: "POST", admin: true, body: { ...exported, vehicles: [{ id: "x" }] } })).status, 400);
  assert.equal((await request("/api/admin/import", { method: "POST", admin: true, body: exported })).status, 200);
  assert.equal((await request("/api/site")).data.settings.businessName, "Unity Performance Colombo");
});
