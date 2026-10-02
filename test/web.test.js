import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";

process.env.ADMIN_PASSWORD = "correct-horse-battery";
process.env.WHATSAPP_NUMBER = "94770000000";

const { createApp } = await import("../src/web/app.js");
const { validateBrand, validateEcu, validatePhoto, validateProduct, validateService, validateVehicle, vehicleFormValues } = await import("../src/validation.js");
const { vehicleEntries } = await import("../src/vehicles.js");
const { db } = await import("../src/db.js");

let ipCounter = 0;

// Each call gets its own app (fresh rate limiters) and a unique client IP.
async function startApp(options = {}) {
  const server = createServer(createApp(options));
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

test("every seed brand, ECU, service, product and photo passes the admin validation", () => {
  for (const [name, validate] of [["brands", validateBrand], ["ecus", validateEcu], ["services", validateService], ["products", validateProduct], ["photos", validatePhoto]]) {
    for (const item of db()[name]) assert.doesNotThrow(() => validate(item), `${name}: ${item.id}`);
  }
});

test("orders can't get past the per-item limit by repeating a product", async (t) => {
  const { request, close } = await startApp();
  t.after(close);
  const repeated = await request("/api/orders", { method: "POST", body: order(Array.from({ length: 3 }, () => ({ id: "stage1-voucher", qty: 20 }))) });
  assert.equal(repeated.status, 400);
  assert.match(repeated.data.error, /up to 20 of each item/);
  const tooManyLines = await request("/api/orders", { method: "POST", body: order(Array.from({ length: 31 }, () => ({ id: "cap", qty: 1 }))) });
  assert.equal(tooManyLines.status, 400);
  assert.equal((await request("/api/orders", { method: "POST", body: order([{ id: "stage1-voucher", qty: 15 }, { id: "stage1-voucher", qty: 5 }]) })).status, 200);
});

test("one address can place five orders an hour; rejected orders don't count", async (t) => {
  const { request, close } = await startApp();
  t.after(close);
  for (let i = 0; i < 3; i++) assert.equal((await request("/api/orders", { method: "POST", body: order([{ id: "missing", qty: 1 }]) })).status, 400);
  for (let i = 0; i < 5; i++) assert.equal((await request("/api/orders", { method: "POST", body: order([{ id: "cap", qty: 1 }]) })).status, 200, `order ${i + 1}`);
  const sixth = await request("/api/orders", { method: "POST", body: order([{ id: "cap", qty: 1 }]) });
  assert.equal(sixth.status, 429);
});

test("orders sent at the same moment can't get past the limit", async (t) => {
  const { request, close } = await startApp();
  t.after(close);
  const results = await Promise.all(Array.from({ length: 12 }, () => request("/api/orders", { method: "POST", body: order([{ id: "cap", qty: 1 }]) })));
  assert.equal(results.filter((result) => result.status === 200).length, 5);
  assert.equal(results.filter((result) => result.status === 429).length, 7);
});

test("graphs are drawn once and requests are limited per address", async (t) => {
  const { request, close } = await startApp();
  t.after(close);
  let started = performance.now();
  assert.equal((await request("/api/vehicles/ford_ranger_32/graph.png?stage=2")).status, 200);
  const first = performance.now() - started;
  started = performance.now();
  const again = await request("/api/vehicles/ford_ranger_32/graph.png?stage=2");
  assert.equal(again.status, 200);
  assert.ok(performance.now() - started < Math.max(40, first / 3), "the second request is served from the cache");
  let limited = 0;
  for (let i = 0; i < 60; i++) if ((await request("/api/vehicles/ford_ranger_32/graph.png?stage=1")).status === 429) limited++;
  assert.ok(limited > 0, "a burst of graph requests is limited");
});

test("the home page's figures come from the database, and it fetches only the cards it shows", async (t) => {
  const { request, close } = await startApp();
  t.after(close);
  const { stats } = (await request("/api/site")).data;
  assert.equal(stats.vehicles, vehicleEntries().length);
  assert.equal(stats.ecus, db().ecus.filter((ecu) => ecu.status !== "not_supported").length);
  assert.ok(stats.stage1Best >= 25 && stats.stage1Best <= 45, `best Stage 1 gain ${stats.stage1Best}%`);
  assert.ok(stats.stage3Best > stats.stage1Best);
  assert.equal((await request("/api/vehicles?limit=6")).data.vehicles.length, 6);
});

test("pages carry link previews, structured data and the site's own address", async (t) => {
  const { request, close } = await startApp();
  t.after(close);
  const home = await request("/");
  const html = home.data.toString();
  const origin = html.match(/<link rel="canonical" href="(http:\/\/127\.0\.0\.1:\d+)\/">/)?.[1];
  assert.ok(origin, "canonical link with the request's address");
  assert.ok(html.includes(`<meta property="og:image" content="${origin}/brand/share.jpg">`));
  assert.ok(!html.includes("%ORIGIN%"));
  const data = JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/)[1]);
  assert.equal(data["@type"], "AutoRepair");
  assert.ok(data.sameAs.includes("https://www.instagram.com/unitytuners/"));
  assert.equal((await request("/", { headers: { "if-none-match": home.headers.get("etag") } })).status, 304);
  assert.match((await request("/shop")).data.toString(), /<meta property="og:url" content="http:\/\/127\.0\.0\.1:\d+\/shop">/);

  const robots = (await request("/robots.txt")).data.toString();
  assert.match(robots, /Disallow: \/admin/);
  assert.match(robots, new RegExp(`Sitemap: ${origin}/sitemap.xml`));
  assert.match((await request("/sitemap.xml")).data.toString(), new RegExp(`<loc>${origin}/shop</loc>`));
  assert.equal((await request("/brand/share.jpg")).headers.get("cache-control"), "public, max-age=86400");
});

test("nothing tells customers the workshop has a dyno", async (t) => {
  const { request, close } = await startApp();
  t.after(close);
  const claim = /on (our|the) dyno|dyno (run|sheet|power run)|confirmed on the dyno|verified on our dyno/i;
  for (const path of ["/", "/shop", "/api/site", "/api/products"]) assert.doesNotMatch((await request(path)).data.toString(), claim, path);
  for (const file of ["public/js/home.js", "public/js/common.js", "public/admin/admin.js", "src/conversation.js", "src/dyno-chart.js"]) {
    assert.doesNotMatch(readFileSync(new URL(`../${file}`, import.meta.url), "utf8").replace(/dyno-chart|dynoChart|dyno-\w+/g, ""), claim, file);
  }
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
  assert.equal(Math.max(...vehicle.data.curves.stages[1].power), 290);
  assert.equal(Math.max(...vehicle.data.curves.stages[3].power), 375);
  assert.deepEqual(vehicle.data.vehicle.stages.map(({ stage, hp }) => [stage, hp]), [[1, 290], [2, 320], [3, 375]]);
  assert.ok(vehicle.data.curves.stock.rpm.every((rpm) => rpm % 100 === 0));
  const graph = await request("/api/vehicles/vw_golf7_gti/graph.png");
  assert.equal(graph.headers.get("content-type"), "image/png");
  assert.equal((await request("/api/vehicles/vw_golf7_gti/graph.png?stage=3")).status, 200);
  assert.equal((await request("/api/vehicles/honda_city_15/graph.png?stage=2")).status, 404, "naturally aspirated cars are Stage 1 only");
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

  const stage2 = await request("/api/enquiries", { method: "POST", body: { name: "Kasun", phone: "0771234567", vehicleId: "vw_golf7_gti", stage: 2 } });
  assert.match(decodeURIComponent(stage2.data.whatsappUrl), /Stage 2 estimate: 320 hp \/ 450 Nm/);
  const saved = db().enquiries.find((enquiry) => enquiry.id === stage2.data.id).vehicle;
  assert.deepEqual([saved.stage, saved.target], [2, { hp: 320, nm: 450 }]);
  const unavailable = await request("/api/enquiries", { method: "POST", body: { name: "Kasun", phone: "0771234567", vehicleId: "honda_city_15", stage: 3 } });
  assert.match(unavailable.data.error, /Stage 3 isn't available/);
});

test("admin can add Stage 2 and 3 figures, which are validated", async (t) => {
  const { request, login, close } = await startApp();
  t.after(close);
  await login();
  const base = { brand: "toyota", model: "Test", generation: "X1", engine: "2.0T", fuel: "petrol", aspiration: "turbo", yearFrom: 2020, stockHp: 200, stockNm: 300, stage1Hp: 240, stage1Nm: 360 };
  const error = async (extra) => (await request("/api/admin/vehicles", { method: "POST", admin: true, body: { ...base, ...extra } })).data.error;
  assert.match(await error({ stage2Hp: 230, stage2Nm: 400 }), /at least 2% above Stage 1/);
  assert.match(await error({ stage2Hp: 270 }), /Enter both Stage 2 power and torque/);
  assert.match(await error({ stage3Hp: 300, stage3Nm: 420 }), /Add Stage 2 figures before Stage 3/);
  const added = await request("/api/admin/vehicles", { method: "POST", admin: true, body: { ...base, stage2Hp: 270, stage2Nm: 390, stage3Hp: 320, stage3Nm: 430 } });
  assert.equal(added.status, 200);
  assert.equal(added.data.item.stage3Hp, 320);
  assert.equal((await request(`/api/vehicles/${added.data.item.id}/graph.png?stage=3`)).status, 200);
  assert.deepEqual((await request(`/api/vehicles/${added.data.item.id}`)).data.vehicle.stages.map(({ stage }) => stage), [1, 2, 3]);
});

test("admin connects and tests Telegram alert chats", async (t) => {
  const offline = await startApp();
  t.after(offline.close);
  await offline.login();
  assert.equal((await offline.request("/api/admin/alerts")).data.botRunning, false);
  assert.match((await offline.request("/api/admin/alerts/link", { method: "POST", admin: true, body: {} })).data.error, /TELEGRAM_BOT_TOKEN/);

  const delivered = [];
  const { request, login, close } = await startApp({ botUsername: () => "UnityPerformanceBot", sendAlert: async (chatId, text) => delivered.push({ chatId, text }) });
  t.after(close);
  await login();
  const link = await request("/api/admin/alerts/link", { method: "POST", admin: true, body: {} });
  assert.match(link.data.url, /^https:\/\/t\.me\/UnityPerformanceBot\?start=alerts_[A-Z2-9]{8}$/);
  assert.match((await request("/api/admin/alerts/test", { method: "POST", admin: true })).data.error, /Link a Telegram chat first/, "a POST with no body works");
  const { linkChat } = await import("../src/alerts.js");
  assert.equal(linkChat("555", { first_name: "Owner" }, link.data.code), true);
  assert.equal((await request("/api/admin/alerts")).data.chats[0].chatId, "555");
  assert.equal((await request("/api/admin/alerts/test", { method: "POST", admin: true, body: {} })).data.sent, 1);
  assert.match(delivered[0].text, /Test alert/);
  assert.equal((await request("/api/admin/alerts/555", { method: "DELETE", admin: true })).status, 200);
  assert.equal((await request("/api/admin/alerts")).data.chats.length, 0);
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
  const nissanCount = vehicleEntries().filter((entry) => entry.brand === "nissan").length;
  assert.match(brandInUse.data.error, new RegExp(`used by ${nissanCount} vehicles`));

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

test("the Tool support page, its data and the admin's Autotuner and KESS3 fields", async (t) => {
  const { request, login, close } = await startApp();
  t.after(close);
  const page = await request("/tools");
  assert.equal(page.status, 200);
  assert.match(page.data.toString(), /Can we read<br>your car\?/);
  assert.match((await request("/sitemap.xml")).data.toString(), /\/tools<\/loc>/);
  for (const path of ["/", "/shop", "/tools"]) assert.match((await request(path)).data.toString(), /href="\/tools"/, `${path} links to Tool support`);
  const { ecus } = (await request("/api/site")).data;
  assert.ok(ecus.every((ecu) => Array.isArray(ecu.tools.autotuner) && Array.isArray(ecu.tools.kess3)));

  await login();
  const keihin = db().ecus.find((ecu) => ecu.id === "keihin");
  const saved = await request("/api/admin/ecus/keihin", { method: "PUT", admin: true, body: { ...keihin, autotuner: ["boot", "obd", "laser"], kess3: [] } });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.data.item.tools, { autotuner: ["obd", "boot"], kess3: [] }, "methods are kept in order and unknown ones dropped");
  await request("/api/admin/ecus/keihin", { method: "PUT", admin: true, body: { ...keihin, ...keihin.tools } });
  assert.deepEqual(db().ecus.find((ecu) => ecu.id === "keihin").tools, keihin.tools);

  // A backup made before tool support existed gets it when restored.
  const exported = (await request("/api/admin/export")).data;
  const older = structuredClone(exported);
  older.catalogVersion = 6;
  for (const ecu of older.ecus) delete ecu.tools;
  assert.equal((await request("/api/admin/import", { method: "POST", admin: true, body: older })).status, 200);
  assert.deepEqual(db().ecus.find((ecu) => ecu.id === "bosch_md1").tools, { autotuner: ["obd", "bench"], kess3: ["obd", "bench"] });
  assert.equal((await request("/api/admin/import", { method: "POST", admin: true, body: exported })).status, 200);
});

test("admin adds photos to the Our work gallery, newest first", async (t) => {
  const { request, login, close } = await startApp();
  t.after(close);
  const starters = db().photos.map((photo) => photo.id);
  assert.ok(starters.length >= 4, "the gallery starts with the workshop's own photos");
  const first = (await request("/api/site")).data.photos[0];
  assert.match(first.image, /^\/gallery\/[a-z0-9-]+\.webp$/);
  assert.equal((await request(first.image)).status, 200, "the starting photos are served");
  await login();
  const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4530000000049454e44ae426082", "hex");
  const upload = async () => (await request("/api/admin/uploads", { method: "POST", admin: true, body: { data: `data:image/png;base64,${png.toString("base64")}` } })).data.url;

  const polo = await request("/api/admin/photos", { method: "POST", admin: true, body: { image: await upload(), caption: "Polo GT TSI · Stage 1", link: "https://www.instagram.com/p/abc123/", active: true } });
  assert.equal(polo.status, 200);
  assert.equal(polo.data.item.id, "polo-gt-tsi-stage-1");
  const plain = await request("/api/admin/photos", { method: "POST", admin: true, body: { image: await upload(), caption: "", active: true } });
  assert.equal(plain.data.item.id, "photo");
  let photos = (await request("/api/site")).data.photos;
  assert.deepEqual(photos.map((photo) => photo.id), ["photo", "polo-gt-tsi-stage-1", ...starters]);
  assert.deepEqual(Object.keys(photos[1]).sort(), ["caption", "id", "image", "link"]);

  await request("/api/admin/photos/photo", { method: "PUT", admin: true, body: { ...plain.data.item, active: false } });
  photos = (await request("/api/site")).data.photos;
  assert.deepEqual(photos.map((photo) => photo.id), ["polo-gt-tsi-stage-1", ...starters], "hidden photos stay off the website");
  const starter = db().photos.find((photo) => photo.id === starters[0]);
  assert.equal((await request(`/api/admin/photos/${starter.id}`, { method: "PUT", admin: true, body: { ...starter, caption: "Edited caption" } })).status, 200, "a starting photo can be edited");

  for (const [body, error] of [
    [{ caption: "No picture", active: true }, /Upload a photo/],
    [{ image: "/brand/logo.webp", active: true }, /upload the image with the Upload button/],
    [{ image: "/gallery/../brand/logo.webp", active: true }, /upload the image with the Upload button/],
    [{ image: ["/gallery/polo-1-0-tsi-ethanol.webp", "x"], active: true }, /upload the image with the Upload button/],
    [{ image: polo.data.item.image, link: "javascript:alert(1)", active: true }, /Link must be a link starting with https/]
  ]) {
    const response = await request("/api/admin/photos", { method: "POST", admin: true, body });
    assert.equal(response.status, 400);
    assert.match(response.data.error, error);
  }

  // A backup made before the gallery existed still restores, and gets the starting photos.
  const exported = (await request("/api/admin/export")).data;
  assert.equal(exported.photos.length, starters.length + 2);
  const older = { ...exported, catalogVersion: 5 };
  delete older.photos;
  assert.equal((await request("/api/admin/import", { method: "POST", admin: true, body: older })).status, 200);
  assert.deepEqual(db().photos.map((photo) => photo.id), starters);
  assert.equal((await request("/api/admin/import", { method: "POST", admin: true, body: exported })).status, 200);
  assert.deepEqual(db().photos.map((photo) => photo.id), ["photo", "polo-gt-tsi-stage-1", ...starters]);
  assert.equal(db().photos.find((photo) => photo.id === starters[0]).caption, "Edited caption");

  for (const id of ["photo", "polo-gt-tsi-stage-1"]) assert.equal((await request(`/api/admin/photos/${id}`, { method: "DELETE", admin: true })).status, 200);
  assert.deepEqual(db().photos.map((photo) => photo.id), starters);
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

  // A damaged or hand-edited backup is refused with the reason, and the site keeps working.
  const damaged = structuredClone(exported);
  damaged.brands[0].title = "";
  const brandError = await request("/api/admin/import", { method: "POST", admin: true, body: damaged });
  assert.equal(brandError.status, 400);
  assert.equal(brandError.data.error, 'Brand "audi" in the backup: Name is required.');
  const badLink = await request("/api/admin/import", { method: "POST", admin: true, body: { ...exported, settings: { ...exported.settings, instagram: "javascript:alert(1)" } } });
  assert.match(badLink.data.error, /Settings in the backup: Instagram must be a link starting with https/);
  const badOrder = structuredClone(exported);
  badOrder.orders = [{ ...badOrder.orders[0], createdAt: 7 }];
  assert.equal((await request("/api/admin/import", { method: "POST", admin: true, body: badOrder })).status, 400);
  assert.equal((await request("/api/admin/dashboard")).status, 200);

  // The order counter is moved past the highest order number so numbers are never reused.
  const behind = await request("/api/admin/import", { method: "POST", admin: true, body: { ...exported, nextOrderNumber: 1 } });
  assert.equal(behind.status, 200);
  const highest = Math.max(1000, ...exported.orders.map((item) => Number(item.number.slice(3))));
  assert.equal(db().nextOrderNumber, highest + 1);
});
