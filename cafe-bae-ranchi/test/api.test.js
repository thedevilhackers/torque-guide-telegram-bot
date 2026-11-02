import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { createApp } from "../src/app.js";

const TOKEN = "test-token-123";
const RELAXED = { order: [1000, 60_000], reservation: [1000, 60_000], review: [1000, 60_000], enquiry: [1000, 60_000], subscribe: [1000, 60_000] };

// Monday 2 Nov 2026, 12:00 IST — the cafe is open (10:00–22:00).
const NOON_IST = new Date("2026-11-02T06:30:00Z");

async function startApp({ now = NOON_IST, ...options } = {}) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cafe-bae-test-"));
  const clock = { now };
  const app = await createApp({ dataDir, adminToken: TOKEN, rateLimits: RELAXED, ...options, now: () => clock.now });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;

  const request = async (method, url, body, { token, headers = {} } = {}) => {
    const res = await fetch(base + url, {
      method,
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* not JSON */
    }
    return { status: res.status, json, text, headers: res.headers };
  };

  return {
    app,
    base,
    clock,
    request,
    admin: (method, url, body) => request(method, url, body, { token: TOKEN }),
    async stop() {
      await app.close();
      await rm(dataDir, { recursive: true, force: true });
    }
  };
}

const guest = { name: "Riya Sharma", phone: "98765 43210" };

describe("public pages", () => {
  let t;
  before(async () => (t = await startApp()));
  after(() => t.stop());

  test("home page is server-rendered with SEO data and boot JSON", async () => {
    const res = await t.request("GET", "/");
    assert.equal(res.status, 200);
    assert.match(res.text, /<title>Cafe BAE Ranchi \| /);
    assert.match(res.text, /"@type":"CafeOrCoffeeShop"/);
    assert.match(res.text, /<script type="application\/json" id="boot">\{"site"/);
    assert.match(res.text, /Open now · until 10:00 PM/);
    assert.doesNotMatch(res.text, /\{\{\w+\}\}/, "every template token is replaced");
    assert.match(res.headers.get("content-security-policy"), /script-src 'self'/);
  });

  test("static files are served and path traversal is blocked", async () => {
    assert.equal((await t.request("GET", "/css/styles.css")).status, 200);
    const status = await new Promise((resolve, reject) => {
      http
        .get(`${t.base}/..%2f..%2fpackage.json`, (res) => {
          res.resume();
          resolve(res.statusCode);
        })
        .on("error", reject);
    });
    assert.equal(status, 404);
    const raw = await new Promise((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port: new URL(t.base).port, path: "/../src/app.js" }, (res) => {
        res.resume();
        resolve(res.statusCode);
      });
      req.on("error", reject);
      req.end();
    });
    assert.equal(raw, 404);
    assert.equal((await t.request("GET", "/nope")).status, 404);
  });

  test("robots.txt keeps the admin out of search engines", async () => {
    const res = await t.request("GET", "/robots.txt");
    assert.match(res.text, /Disallow: \/admin/);
  });
});

describe("ordering", () => {
  let t;
  before(async () => (t = await startApp()));
  after(() => t.stop());

  test("prices and GST are calculated on the server, never trusted from the browser", async () => {
    const res = await t.request("POST", "/api/orders", {
      ...guest,
      type: "pickup",
      items: [
        { id: "oreo-thick-shake", qty: 2, price: 1 },
        { id: "peri-peri-fries", qty: 1 }
      ]
    });
    assert.equal(res.status, 201);
    assert.equal(res.json.number, 1);
    assert.deepEqual(res.json.amounts, { subtotal: 54700, gst: 2735, total: 57435, gstPercent: 5 });
    assert.equal(res.json.phone, undefined, "public order view hides the phone number");
    const second = await t.request("POST", "/api/orders", { ...guest, type: "dine-in", table: "7", items: [{ id: "masala-chai", qty: 1 }] });
    assert.equal(second.json.number, 2);
    assert.equal(second.json.table, "7");
  });

  test("invalid orders return field errors", async () => {
    const res = await t.request("POST", "/api/orders", { name: "", phone: "123", type: "dine-in", items: [] });
    assert.equal(res.status, 422);
    assert.ok(res.json.fields.name);
    assert.ok(res.json.fields.phone);
    assert.ok(res.json.fields.table);
    assert.ok(res.json.fields.items);
    const unknown = await t.request("POST", "/api/orders", { ...guest, type: "pickup", items: [{ id: "unicorn-latte", qty: 1 }] });
    assert.equal(unknown.status, 422);
    const tooMany = await t.request("POST", "/api/orders", { ...guest, type: "pickup", items: [{ id: "masala-chai", qty: 21 }] });
    assert.equal(tooMany.status, 422);
  });

  test("sold-out items can't be ordered", async () => {
    await t.admin("PATCH", "/api/admin/menu/items/cappuccino", { available: false });
    const res = await t.request("POST", "/api/orders", { ...guest, type: "pickup", items: [{ id: "cappuccino", qty: 1 }] });
    assert.equal(res.status, 422);
    assert.match(res.json.fields.items, /sold out/);
    await t.admin("PATCH", "/api/admin/menu/items/cappuccino", { available: true });
  });

  test("orders are refused when the cafe is closed or orders are paused", async () => {
    t.clock.now = new Date("2026-11-02T18:00:00Z"); // 23:30 IST
    const closed = await t.request("POST", "/api/orders", { ...guest, type: "pickup", items: [{ id: "masala-chai", qty: 1 }] });
    assert.equal(closed.status, 409);
    t.clock.now = NOON_IST;

    await t.admin("PATCH", "/api/admin/settings", { ordersPaused: true });
    const paused = await t.request("POST", "/api/orders", { ...guest, type: "pickup", items: [{ id: "masala-chai", qty: 1 }] });
    assert.equal(paused.status, 409);
    assert.equal((await t.request("GET", "/api/site")).json.orders.accepting, false);
    await t.admin("PATCH", "/api/admin/settings", { ordersPaused: false });
  });

  test("the live order stream pushes status changes from the kitchen", async () => {
    const order = (await t.request("POST", "/api/orders", { ...guest, type: "pickup", items: [{ id: "virgin-mojito", qty: 1 }] })).json;
    const res = await fetch(`${t.base}/api/orders/${order.id}/events`);
    assert.equal(res.headers.get("content-type"), "text/event-stream; charset=utf-8");
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const events = [];
    let buffer = "";
    const nextEvent = async () => {
      while (true) {
        const match = buffer.match(/data: (.+)\n\n/);
        if (match) {
          buffer = buffer.slice(match.index + match[0].length);
          return JSON.parse(match[1]);
        }
        const { value, done } = await reader.read();
        if (done) throw new Error("stream ended");
        buffer += decoder.decode(value, { stream: true });
      }
    };
    events.push(await nextEvent());
    const patched = await t.admin("PATCH", `/api/admin/orders/${order.id}`, { status: "preparing" });
    assert.equal(patched.status, 200);
    events.push(await nextEvent());
    await reader.cancel();
    assert.deepEqual(events.map((e) => e.status), ["received", "preparing"]);
    assert.equal((await t.request("GET", `/api/orders/${order.id}`)).json.status, "preparing");
  });

  test("bots filling the hidden field are ignored", async () => {
    const before = (await t.admin("GET", "/api/admin/orders?scope=all")).json.orders.length;
    const res = await t.request("POST", "/api/orders", { ...guest, company: "spam inc", type: "pickup", items: [{ id: "masala-chai", qty: 1 }] });
    assert.equal(res.status, 201);
    const afterCount = (await t.admin("GET", "/api/admin/orders?scope=all")).json.orders.length;
    assert.equal(afterCount, before);
  });
});

describe("reservations", () => {
  let t;
  before(async () => (t = await startApp()));
  after(() => t.stop());

  test("availability lists future slots and drops ones that have passed today", async () => {
    const today = (await t.request("GET", "/api/availability?date=2026-11-02")).json;
    assert.equal(today.slots[0].time, "12:30", "slots start 30 minutes from now");
    assert.equal(today.slots.at(-1).time, "21:00", "last seating is an hour before close");
    const tomorrow = (await t.request("GET", "/api/availability?date=2026-11-03")).json;
    assert.equal(tomorrow.slots[0].time, "10:00");
    assert.equal(tomorrow.slots[0].seatsLeft, 40);
    const past = (await t.request("GET", "/api/availability?date=2026-11-01")).json;
    assert.deepEqual(past.slots, []);
  });

  test("bookings respect capacity, duplicates and date limits", async () => {
    const book = (overrides) => t.request("POST", "/api/reservations", { ...guest, date: "2026-11-03", time: "19:00", guests: 20, ...overrides });
    const first = await book({});
    assert.equal(first.status, 201);
    assert.match(first.json.code, /^[A-Z2-9]{6}$/);
    assert.equal(first.json.time, "7:00 PM");
    assert.equal((await book({})).status, 409, "same phone, same slot");
    assert.equal((await book({ phone: "9123456780" })).status, 201);
    const full = await book({ phone: "9000000000", guests: 1 });
    assert.equal(full.status, 409);
    assert.ok(full.json.fields.time);
    assert.equal((await t.request("GET", "/api/availability?date=2026-11-03")).json.slots.find((s) => s.time === "19:00").seatsLeft, 0);

    assert.equal((await book({ date: "2026-11-02", time: "11:00", phone: "9000000001" })).status, 422, "slot already passed today");
    assert.equal((await book({ date: "2027-01-30", phone: "9000000002" })).status, 422, "too far ahead");
    assert.equal((await book({ time: "19:15", phone: "9000000003" })).status, 422, "not a real slot");
  });

  test("cancelling a booking frees its seats", async () => {
    const { json } = await t.admin("GET", "/api/admin/reservations?scope=upcoming");
    const booking = json.reservations.find((r) => r.time === "19:00");
    await t.admin("PATCH", `/api/admin/reservations/${booking.id}`, { status: "cancelled" });
    const slot = (await t.request("GET", "/api/availability?date=2026-11-03")).json.slots.find((s) => s.time === "19:00");
    assert.equal(slot.seatsLeft, 20);
  });
});

describe("reviews, enquiries and newsletter", () => {
  let t;
  before(async () => (t = await startApp()));
  after(() => t.stop());

  test("reviews only appear after approval", async () => {
    const created = await t.request("POST", "/api/reviews", { name: "Sneha", rating: 5, text: "Best cold coffee in Ranchi, hands down!" });
    assert.equal(created.status, 201);
    assert.equal((await t.request("GET", "/api/reviews")).json.stats.count, 0);
    const pending = (await t.admin("GET", "/api/admin/reviews")).json.reviews[0];
    await t.admin("PATCH", `/api/admin/reviews/${pending.id}`, { status: "approved" });
    const listed = (await t.request("GET", "/api/reviews")).json;
    assert.equal(listed.stats.count, 1);
    assert.equal(listed.stats.average, 5);
    assert.equal(listed.reviews[0].text, "Best cold coffee in Ranchi, hands down!");
    assert.equal((await t.request("POST", "/api/reviews", { name: "X", rating: 9, text: "short" })).status, 422);
  });

  test("party enquiries and newsletter sign-ups are stored once", async () => {
    const enquiry = await t.request("POST", "/api/enquiries", { ...guest, type: "event", guests: 25, date: "2026-11-20", message: "Birthday on the rooftop" });
    assert.equal(enquiry.status, 201);
    assert.equal((await t.admin("GET", "/api/admin/enquiries")).json.enquiries.length, 1);
    await t.request("POST", "/api/subscribe", { email: "Fan@Example.com" });
    await t.request("POST", "/api/subscribe", { email: "fan@example.com" });
    const subs = (await t.admin("GET", "/api/admin/subscribers")).json.subscribers;
    assert.deepEqual(subs.map((s) => s.email), ["fan@example.com"]);
    assert.equal((await t.request("POST", "/api/subscribe", { email: "not-an-email" })).status, 422);
  });
});

describe("admin", () => {
  let t;
  before(async () => (t = await startApp()));
  after(() => t.stop());

  test("admin routes need the token", async () => {
    assert.equal((await t.request("GET", "/api/admin/summary")).status, 401);
    assert.equal((await t.request("GET", "/api/admin/summary", undefined, { token: "wrong" })).status, 401);
    assert.equal((await t.admin("GET", "/api/admin/summary")).status, 200);
  });

  test("menu items can be added, edited and removed", async () => {
    const created = await t.admin("POST", "/api/admin/menu/items", { name: "Rose Falooda Shake", category: "shakes", price: 229, description: "Rose syrup, falooda and ice cream." });
    assert.equal(created.status, 201);
    assert.equal(created.json.item.id, "rose-falooda-shake");
    assert.equal((await t.admin("PATCH", "/api/admin/menu/items/rose-falooda-shake", { price: 239, bestseller: true })).json.item.price, 239);
    assert.equal((await t.admin("PATCH", "/api/admin/menu/items/rose-falooda-shake", { image: "javascript:alert(1)" })).status, 422);
    assert.equal((await t.admin("PATCH", "/api/admin/menu/items/rose-falooda-shake", { category: "nope" })).status, 422);
    const publicItem = (await t.request("GET", "/api/menu")).json.items.find((i) => i.id === "rose-falooda-shake");
    assert.equal(publicItem.price, 239);
    assert.equal((await t.admin("DELETE", "/api/admin/menu/items/rose-falooda-shake")).status, 200);
    assert.equal((await t.request("GET", "/api/menu")).json.items.some((i) => i.id === "rose-falooda-shake"), false);
  });

  test("settings update the live site and validate opening hours", async () => {
    await t.admin("PATCH", "/api/admin/settings", { announcement: "New: Rose Falooda Shake!" });
    assert.equal((await t.request("GET", "/api/site")).json.announcement, "New: Rose Falooda Shake!");
    assert.equal((await t.admin("PATCH", "/api/admin/settings", { hours: { mon: ["25:00", "22:00"] } })).status, 422);
    const ok = await t.admin("PATCH", "/api/admin/settings", { hours: { mon: ["08:00", "23:00"], tue: null } });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.hours.tue, null);
    const site = (await t.request("GET", "/api/site")).json;
    assert.equal(site.hours.find((d) => d.day === "Tuesday").label, "Closed");
  });

  test("repeated wrong tokens are locked out", async () => {
    const locked = await startApp();
    try {
      for (let i = 0; i < 10; i += 1) await locked.request("GET", "/api/admin/summary", undefined, { token: `guess-${i}` });
      assert.equal((await locked.admin("GET", "/api/admin/summary")).status, 429);
    } finally {
      await locked.stop();
    }
  });
});

describe("rate limiting", () => {
  test("public forms are throttled per visitor", async () => {
    const t = await startApp({ rateLimits: { review: [2, 60_000] } });
    try {
      const post = () => t.request("POST", "/api/reviews", { name: "A", rating: 4, text: "Lovely place, great shakes." });
      assert.equal((await post()).status, 201);
      assert.equal((await post()).status, 201);
      assert.equal((await post()).status, 429);
    } finally {
      await t.stop();
    }
  });
});
