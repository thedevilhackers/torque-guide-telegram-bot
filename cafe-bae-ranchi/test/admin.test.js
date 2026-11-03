import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { createApp } from "../src/app.js";

const MASTER_KEY = "master-key-for-tests";
const NOON_IST = new Date("2026-11-02T06:30:00Z"); // Monday 12:00 IST, cafe open
const RELAXED = { order: [1000, 60_000], reservation: [1000, 60_000], review: [1000, 60_000], enquiry: [1000, 60_000], subscribe: [1000, 60_000] };
const quiet = { warn() {}, log() {} };

/** A stand-in for graph.facebook.com that records every message request. */
async function startFakeMeta() {
  const requests = [];
  let failNext = false;
  let counter = 0;
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
    requests.push({ url: req.url, auth: req.headers.authorization, body });
    res.setHeader("Content-Type", "application/json");
    if (failNext) {
      failNext = false;
      res.statusCode = 400;
      return res.end(JSON.stringify({ error: { message: "Template name does not exist in the translation", code: 132001 } }));
    }
    counter += 1;
    res.end(JSON.stringify({ messages: [{ id: `wamid.${counter}` }] }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    requests,
    failOnce: () => (failNext = true),
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

async function startApp({ whatsapp } = {}) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cafe-bae-admin-"));
  const clock = { now: NOON_IST };
  const app = await createApp({ dataDir, adminToken: MASTER_KEY, now: () => clock.now, rateLimits: RELAXED, whatsapp, logger: quiet });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const request = async (method, url, body, token, headers = {}) => {
    const res = await fetch(base + url, {
      method,
      headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body)
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* not JSON */
    }
    return { status: res.status, json, text };
  };
  return {
    app,
    clock,
    request,
    master: (method, url, body) => request(method, url, body, MASTER_KEY),
    async stop() {
      await app.close();
      await rm(dataDir, { recursive: true, force: true });
    }
  };
}

const guest = { name: "Riya Sharma", phone: "98765 43210" };

describe("owner setup, sign-in and staff roles", () => {
  let t;
  let ownerToken;
  before(async () => (t = await startApp()));
  after(() => t.stop());

  test("first run asks for the setup key and creates the master account", async () => {
    assert.equal((await t.request("GET", "/api/admin/setup")).json.needsSetup, true);
    const wrong = await t.request("POST", "/api/admin/setup", { setupKey: "nope", name: "Ayush", username: "ayush", password: "supersecret1" });
    assert.equal(wrong.status, 422);
    assert.ok(wrong.json.fields.setupKey);
    const created = await t.request("POST", "/api/admin/setup", { setupKey: MASTER_KEY, name: "Ayush", username: "Ayush", password: "supersecret1" });
    assert.equal(created.status, 201);
    assert.equal(created.json.user.role, "master");
    assert.equal(created.json.user.username, "ayush");
    ownerToken = created.json.token;
    assert.equal((await t.request("GET", "/api/admin/setup")).json.needsSetup, false);
    assert.equal((await t.request("POST", "/api/admin/setup", { setupKey: MASTER_KEY, name: "X", username: "xyz", password: "supersecret1" })).status, 409);
  });

  test("sign in, see your own permissions, sign out", async () => {
    assert.equal((await t.request("POST", "/api/admin/login", { username: "ayush", password: "wrong-password" })).status, 401);
    const login = await t.request("POST", "/api/admin/login", { username: "AYUSH", password: "supersecret1" });
    assert.equal(login.status, 200);
    const me = await t.request("GET", "/api/admin/me", undefined, login.json.token);
    assert.equal(me.json.user.name, "Ayush");
    assert.ok(me.json.user.permissions.includes("staff"));
    assert.equal((await t.request("POST", "/api/admin/logout", {}, login.json.token)).status, 200);
    assert.equal((await t.request("GET", "/api/admin/me", undefined, login.json.token)).status, 401);
  });

  test("roles limit what each staff member can do", async () => {
    const kitchen = await t.request("POST", "/api/admin/staff", { name: "Raju", username: "raju", role: "kitchen", password: "kitchen123" }, ownerToken);
    assert.equal(kitchen.status, 201);
    assert.deepEqual(kitchen.json.user.permissions, ["orders"]);
    const dup = await t.request("POST", "/api/admin/staff", { name: "Raju 2", username: "raju", role: "kitchen", password: "kitchen123" }, ownerToken);
    assert.equal(dup.status, 422);

    const token = (await t.request("POST", "/api/admin/login", { username: "raju", password: "kitchen123" })).json.token;
    assert.equal((await t.request("GET", "/api/admin/orders", undefined, token)).status, 200);
    assert.equal((await t.request("PATCH", "/api/admin/menu/items/masala-chai", { price: 1 }, token)).status, 403);
    assert.equal((await t.request("GET", "/api/admin/staff", undefined, token)).status, 403);
    assert.equal((await t.request("GET", "/api/admin/settings", undefined, token)).status, 403);
    assert.equal((await t.request("GET", "/api/admin/summary", undefined, token)).json.orders.revenueToday !== undefined, true);

    // The owner grants menu access: it applies immediately.
    await t.request("PATCH", `/api/admin/staff/${kitchen.json.user.id}`, { permissions: ["orders", "menu"] }, ownerToken);
    assert.equal((await t.request("PATCH", "/api/admin/menu/items/masala-chai", { price: 89 }, token)).status, 200);
    // "staff" can never be granted to non-masters.
    assert.equal((await t.request("PATCH", `/api/admin/staff/${kitchen.json.user.id}`, { permissions: ["staff"] }, ownerToken)).status, 422);

    // Deactivating signs them out everywhere.
    await t.request("PATCH", `/api/admin/staff/${kitchen.json.user.id}`, { active: false }, ownerToken);
    assert.equal((await t.request("GET", "/api/admin/orders", undefined, token)).status, 401);
    assert.equal((await t.request("POST", "/api/admin/login", { username: "raju", password: "kitchen123" })).status, 401);
  });

  test("the last master can't be removed or demoted", async () => {
    const users = (await t.request("GET", "/api/admin/staff", undefined, ownerToken)).json.users;
    const owner = users.find((u) => u.username === "ayush");
    assert.equal((await t.request("PATCH", `/api/admin/staff/${owner.id}`, { role: "manager" }, ownerToken)).status, 422);
    assert.equal((await t.request("PATCH", `/api/admin/staff/${owner.id}`, { active: false }, ownerToken)).status, 422);
    assert.equal((await t.request("DELETE", `/api/admin/staff/${owner.id}`, undefined, ownerToken)).status, 409);
  });

  test("changing your password signs out your other devices", async () => {
    const other = (await t.request("POST", "/api/admin/login", { username: "ayush", password: "supersecret1" })).json.token;
    assert.equal((await t.request("POST", "/api/admin/me/password", { currentPassword: "bad", newPassword: "newsecret22" }, ownerToken)).status, 422);
    assert.equal((await t.request("POST", "/api/admin/me/password", { currentPassword: "supersecret1", newPassword: "newsecret22" }, ownerToken)).status, 200);
    assert.equal((await t.request("GET", "/api/admin/me", undefined, other)).status, 401);
    assert.equal((await t.request("GET", "/api/admin/me", undefined, ownerToken)).status, 200);
  });

  test("every change lands in the activity log with who did it", async () => {
    const entries = (await t.request("GET", "/api/admin/audit", undefined, ownerToken)).json.entries;
    const actions = entries.map((e) => `${e.actorName}: ${e.action}`);
    assert.ok(actions.includes("Ayush: Created master account"));
    assert.ok(actions.includes("Ayush: Added staff account"));
    assert.ok(actions.includes("Raju: Edited menu item"));
    assert.ok(entries.find((e) => e.action === "Edited menu item").details.includes("₹79 → ₹89"));
  });
});

describe("master control of the website", () => {
  let t;
  before(async () => (t = await startApp()));
  after(() => t.stop());

  test("feature switches hide sections and block the matching forms", async () => {
    await t.master("PATCH", "/api/admin/settings", { features: { bookings: false, pickup: false } });
    const site = (await t.request("GET", "/api/site")).json;
    assert.equal(site.features.bookings, false);
    assert.deepEqual(site.orders.types, { pickup: false, dineIn: true });
    assert.match((await t.request("GET", "/")).text, /<body class="[^"]*no-bookings[^"]*no-pickup|<body class="[^"]*no-pickup[^"]*no-bookings/);
    const booking = await t.request("POST", "/api/reservations", { ...guest, date: "2026-11-03", time: "19:00", guests: 2 });
    assert.equal(booking.status, 403);
    const pickup = await t.request("POST", "/api/orders", { ...guest, type: "pickup", items: [{ id: "masala-chai", qty: 1 }] });
    assert.equal(pickup.status, 422);
    assert.ok(pickup.json.fields.type);
    assert.equal((await t.request("POST", "/api/orders", { ...guest, type: "dine-in", table: "4", items: [{ id: "masala-chai", qty: 1 }] })).status, 201);
    await t.master("PATCH", "/api/admin/settings", { features: { ordering: false } });
    assert.equal((await t.request("GET", "/api/site")).json.orders.accepting, false);
  });

  test("business details, rules and outlets are editable with validation", async () => {
    const bad = await t.master("PATCH", "/api/admin/settings", { business: { website: "http://insecure.example" }, reservations: { slotMinutes: 20 } });
    assert.equal(bad.status, 422);
    assert.ok(bad.json.fields["business.website"]);
    assert.ok(bad.json.fields["reservations.slotMinutes"]);
    const ok = await t.master("PATCH", "/api/admin/settings", {
      business: { tagline: "Ranchi's shake headquarters", instagram: "https://instagram.com/cafebae.ranchi/", whatsapp: "90312 78991", address: { street: "84 Hazaribagh Road" } },
      orders: { gstPercent: 5 },
      reservations: { seatsPerSlot: 24, slotMinutes: 60 },
      outlets: [{ name: "Cafe BAE Lalpur", address: "84 Hazaribagh Road", tone: "blush" }]
    });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.business.instagram, "cafebae.ranchi");
    assert.equal(ok.json.business.whatsapp, "919031278991");
    assert.equal(ok.json.business.address.street, "84 Hazaribagh Road");
    assert.equal(ok.json.business.address.city, "Ranchi");
    const site = (await t.request("GET", "/api/site")).json;
    assert.equal(site.tagline, "Ranchi's shake headquarters");
    assert.equal(site.outlets.length, 1);
    const slots = (await t.request("GET", "/api/availability?date=2026-11-03")).json.slots;
    assert.deepEqual(slots.slice(0, 2).map((s) => s.time), ["10:00", "11:00"]);
    assert.equal(slots[0].seatsLeft, 24);
  });

  test("menu categories can be added, reordered and only deleted when empty", async () => {
    const created = await t.master("POST", "/api/admin/menu/categories", { name: "Seasonal Specials", icon: "shake", tone: "berry" });
    assert.equal(created.status, 201);
    const id = created.json.category.id;
    const moved = await t.master("PATCH", `/api/admin/menu/categories/${id}`, { move: "up" });
    const order = moved.json.categories.map((c) => c.id);
    assert.equal(order.at(-2), id);
    await t.master("POST", "/api/admin/menu/items", { name: "Mango Mastani", category: id, price: 219 });
    assert.equal((await t.master("DELETE", `/api/admin/menu/categories/${id}`)).status, 409);
    await t.master("DELETE", "/api/admin/menu/items/mango-mastani");
    assert.equal((await t.master("DELETE", `/api/admin/menu/categories/${id}`)).status, 200);
  });
});

describe("order workflow and reports", () => {
  let t;
  before(async () => (t = await startApp()));
  after(() => t.stop());

  test("accept with a ready time, then record how the guest paid", async () => {
    const order = (await t.request("POST", "/api/orders", { ...guest, type: "pickup", items: [{ id: "oreo-thick-shake", qty: 2 }] })).json;
    const preparing = await t.master("PATCH", `/api/admin/orders/${order.id}`, { status: "preparing", etaMinutes: 20 });
    assert.equal(preparing.json.order.etaMinutes, 20);
    const tracked = (await t.request("GET", `/api/orders/${order.id}`)).json;
    assert.equal(tracked.etaMinutes, 20);
    assert.equal(tracked.readyByLabel, "12:20 PM");
    const done = await t.master("PATCH", `/api/admin/orders/${order.id}`, { status: "completed", payment: "upi" });
    assert.equal(done.json.order.payment, "upi");
    assert.equal((await t.master("PATCH", `/api/admin/orders/${order.id}`, { status: "completed", payment: "bitcoin" })).status, 422);
  });

  test("reports add up sales, items, order types and payment methods", async () => {
    const second = (await t.request("POST", "/api/orders", { ...guest, type: "dine-in", table: "3", items: [{ id: "masala-chai", qty: 3 }] })).json;
    await t.master("PATCH", `/api/admin/orders/${second.id}`, { status: "completed", payment: "cash" });
    const cancelled = (await t.request("POST", "/api/orders", { ...guest, type: "pickup", items: [{ id: "masala-chai", qty: 1 }] })).json;
    await t.master("PATCH", `/api/admin/orders/${cancelled.id}`, { status: "cancelled" });
    const report = (await t.master("GET", "/api/admin/reports?days=7")).json;
    // 2 × 199 = 398 + 5% = 417.90; 3 × 79 = 237 + 5% = 248.85
    assert.equal(report.totals.orders, 2);
    assert.equal(report.totals.cancelled, 1);
    assert.equal(report.totals.revenue, 41790 + 24885);
    assert.equal(report.byDay.length, 7);
    assert.equal(report.byDay.at(-1).orders, 2);
    assert.deepEqual(report.topItems[0], { name: "Masala Chai", qty: 3, revenue: 23700 });
    assert.equal(report.byPayment.UPI.revenue, 41790);
    assert.equal(report.byPayment.CASH.orders, 1);
    assert.equal(report.byType.Table.orders, 1);
  });

  test("the pause switch is available to anyone who handles orders", async () => {
    await t.master("POST", "/api/admin/staff", { name: "Desk", username: "desk", role: "frontdesk", password: "frontdesk1" });
    const token = (await t.request("POST", "/api/admin/login", { username: "desk", password: "frontdesk1" })).json.token;
    assert.equal((await t.request("POST", "/api/admin/orders/pause", { paused: true }, token)).status, 200);
    assert.equal((await t.request("GET", "/api/site")).json.orders.accepting, false);
    await t.request("POST", "/api/admin/orders/pause", { paused: false }, token);
  });
});

describe("WhatsApp Cloud API integration", () => {
  let t;
  let meta;
  const secret = "app-secret";
  const sign = (body) => `sha256=${crypto.createHmac("sha256", secret).update(body).digest("hex")}`;
  const webhook = (payload, signature) => {
    const body = JSON.stringify(payload);
    return t.request("POST", "/api/whatsapp/webhook", body, null, { "X-Hub-Signature-256": signature ?? sign(body) });
  };
  const incoming = (from, text, id) => ({
    object: "whatsapp_business_account",
    entry: [{ changes: [{ field: "messages", value: { contacts: [{ wa_id: from, profile: { name: "Riya Sharma" } }], messages: [{ from, id, type: "text", text: { body: text }, timestamp: "1" }] } }] }]
  });

  before(async () => {
    meta = await startFakeMeta();
    t = await startApp({ whatsapp: { accessToken: "EAAtest", phoneNumberId: "1234567890", appSecret: secret, verifyToken: "verify-me", apiBase: meta.url } });
  });
  after(async () => {
    await t.stop();
    await meta.close();
  });

  test("nothing is sent until the owner switches WhatsApp on", async () => {
    await t.request("POST", "/api/orders", { ...guest, type: "pickup", whatsappUpdates: true, items: [{ id: "masala-chai", qty: 1 }] });
    await t.app.whatsapp.flush();
    assert.equal(meta.requests.length, 0);
    assert.equal((await t.request("GET", "/api/site")).json.orders.whatsappUpdates, false);
    const status = (await t.master("GET", "/api/admin/whatsapp")).json.status;
    assert.deepEqual([status.configured, status.enabled, status.webhookReady], [true, false, true]);
  });

  test("new orders alert staff, and opted-in guests get template updates", async () => {
    const saved = await t.master("PATCH", "/api/admin/whatsapp/settings", { enabled: true, staffNumbers: ["+91 90312 78991", "9031278991"] });
    assert.deepEqual(saved.json.settings.staffNumbers, ["919031278991"]);
    assert.equal((await t.request("GET", "/api/site")).json.orders.whatsappUpdates, true);

    const order = (await t.request("POST", "/api/orders", { ...guest, type: "dine-in", table: "7", whatsappUpdates: true, items: [{ id: "oreo-thick-shake", qty: 2 }] })).json;
    await t.app.whatsapp.flush();
    assert.equal(meta.requests.length, 2);
    const [staff, customer] = meta.requests;
    assert.equal(staff.url, "/v23.0/1234567890/messages");
    assert.equal(staff.auth, "Bearer EAAtest");
    assert.equal(staff.body.to, "919031278991");
    assert.equal(staff.body.template.name, "bae_new_order");
    assert.deepEqual(staff.body.template.components[0].parameters.map((p) => p.text), [`#${String(order.number).padStart(3, "0")}`, "Table 7", "2x Oreo Thick Shake", "₹417.9", "Riya Sharma", "+919876543210"]);
    assert.equal(customer.body.to, "919876543210");
    assert.equal(customer.body.template.name, "bae_order_received");

    await t.master("PATCH", `/api/admin/orders/${order.id}`, { status: "preparing", etaMinutes: 12 });
    await t.master("PATCH", `/api/admin/orders/${order.id}`, { status: "ready" });
    await t.app.whatsapp.flush();
    const names = meta.requests.slice(2).map((r) => r.body.template.name);
    assert.deepEqual(names, ["bae_order_preparing", "bae_order_ready"]);
    assert.equal(meta.requests[2].body.template.components[0].parameters[2].text, "12");
    const listed = (await t.master("GET", "/api/admin/orders?scope=active")).json.orders.find((o) => o.id === order.id);
    assert.equal(listed.whatsapp.status, "sent");
  });

  test("guests who didn't opt in only trigger the staff alert", async () => {
    const before = meta.requests.length;
    await t.request("POST", "/api/orders", { ...guest, phone: "9123456780", type: "pickup", items: [{ id: "masala-chai", qty: 1 }] });
    await t.app.whatsapp.flush();
    assert.deepEqual(meta.requests.slice(before).map((r) => r.body.to), ["919031278991"]);
  });

  test("bookings: staff alert on request, guest message on confirm", async () => {
    const before = meta.requests.length;
    await t.request("POST", "/api/reservations", { ...guest, phone: "9988776655", date: "2026-11-03", time: "19:00", guests: 4, whatsappUpdates: true });
    const booking = (await t.master("GET", "/api/admin/reservations")).json.reservations[0];
    await t.master("PATCH", `/api/admin/reservations/${booking.id}`, { status: "confirmed" });
    await t.app.whatsapp.flush();
    const sent = meta.requests.slice(before).map((r) => [r.body.to, r.body.template.name]);
    assert.deepEqual(sent, [["919031278991", "bae_new_booking"], ["919988776655", "bae_booking_confirmed"]]);
    assert.deepEqual(meta.requests.at(-1).body.template.components[0].parameters.map((p) => p.text), ["Riya", "Tue, 3 Nov", "7:00 PM", "4 guests", booking.code]);
  });

  test("a failed send is logged but never blocks the guest", async () => {
    meta.failOnce();
    const res = await t.request("POST", "/api/orders", { ...guest, phone: "9000011111", type: "pickup", items: [{ id: "masala-chai", qty: 1 }] });
    assert.equal(res.status, 201);
    await t.app.whatsapp.flush();
    const log = (await t.master("GET", "/api/admin/whatsapp/log")).json.messages;
    const failed = log.find((m) => m.status === "failed");
    assert.match(failed.error, /Template name does not exist/);
  });

  test("webhook verification and signatures are enforced", async () => {
    assert.equal((await t.request("GET", "/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=42")).status, 403);
    const ok = await t.request("GET", "/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=42");
    assert.equal(ok.text, "42");
    assert.equal((await webhook(incoming("919876543210", "hi", "wamid.in0"), "sha256=forged")).status, 401);
  });

  test("incoming messages get helpful auto-replies and land in the inbox", async () => {
    const before = meta.requests.length;
    assert.equal((await webhook(incoming("919876543210", "Hi", "wamid.in1"))).status, 200);
    assert.equal((await webhook(incoming("919876543210", "what is my order status?", "wamid.in2"))).status, 200);
    await webhook(incoming("919876543210", "what is my order status?", "wamid.in2")); // duplicate delivery is ignored
    await t.app.whatsapp.flush();
    const replies = meta.requests.slice(before).map((r) => r.body);
    assert.equal(replies.length, 2);
    assert.equal(replies[0].type, "text");
    assert.match(replies[0].text.body, /Hi Riya! Welcome to Cafe BAE Ranchi.*#menu/s);
    assert.match(replies[1].text.body, /Your order #\d{3} is ready\..*\/\?order=/);

    const convos = (await t.master("GET", "/api/admin/whatsapp/conversations")).json.conversations;
    const convo = convos.find((c) => c.phone === "919876543210");
    assert.equal(convo.name, "Riya Sharma");
    assert.equal(convo.unread, 2);
    assert.equal(convo.canReply, true);
    const thread = (await t.master("GET", "/api/admin/whatsapp/conversations/919876543210")).json;
    assert.ok(thread.messages.some((m) => m.direction === "in" && m.body === "Hi"));
    assert.equal((await t.master("GET", "/api/admin/summary")).json.whatsapp.unread, 0);
  });

  test("staff can reply inside WhatsApp's 24-hour window only", async () => {
    const reply = await t.master("POST", "/api/admin/whatsapp/conversations/919876543210/messages", { text: "Your shake is on the way!" });
    assert.equal(reply.status, 200);
    await t.app.whatsapp.flush();
    assert.equal(meta.requests.at(-1).body.text.body, "Your shake is on the way!");
    const closed = await t.master("POST", "/api/admin/whatsapp/conversations/919123456780/messages", { text: "Hello" });
    assert.equal(closed.status, 409);
    t.clock.now = new Date(NOON_IST.getTime() + 25 * 3_600_000);
    assert.equal((await t.master("POST", "/api/admin/whatsapp/conversations/919876543210/messages", { text: "Hi again" })).status, 409);
    t.clock.now = NOON_IST;
  });

  test("delivery receipts update the message log", async () => {
    const sent = (await t.master("GET", "/api/admin/whatsapp/log")).json.messages.find((m) => m.waId);
    await webhook({ object: "whatsapp_business_account", entry: [{ changes: [{ value: { statuses: [{ id: sent.waId, status: "read" }] } }] }] });
    const updated = (await t.master("GET", "/api/admin/whatsapp/log")).json.messages.find((m) => m.id === sent.id);
    assert.equal(updated.status, "read");
  });

  test("owners can send Meta's hello_world test message", async () => {
    const res = await t.master("POST", "/api/admin/whatsapp/test", { phone: "+91 90312 78991" });
    assert.equal(res.status, 200);
    assert.equal(meta.requests.at(-1).body.template.name, "hello_world");
    assert.equal(meta.requests.at(-1).body.template.language.code, "en_US");
  });
});
