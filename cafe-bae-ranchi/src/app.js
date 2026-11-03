import crypto from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import { registerAdminApi } from "./admin-api.js";
import { createAuth } from "./auth.js";
import { FEATURE_KEYS, OCCASIONS, RELEASED_RESERVATION_STATUSES } from "./constants.js";
import { HttpError, applySecurityHeaders, clientIp, createRateLimiter, parseJsonObject, readJson, readRaw, sendJson } from "./http.js";
import { Store } from "./store.js";
import { DAY_KEYS, DAY_NAMES, dayWindow, daysBetween, formatClock, formatDayLabel, hoursTable, istParts, openStatus, parseIsoDate, reservationSlots } from "./time.js";
import { ValidationError, cleanText, createChecker } from "./validate.js";
import { createWhatsApp } from "./whatsapp.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");


// [max requests, window in ms] per visitor IP
const RATE_LIMITS = {
  order: [8, 10 * 60_000],
  reservation: [6, 10 * 60_000],
  review: [3, 60 * 60_000],
  enquiry: [5, 60 * 60_000],
  subscribe: [5, 60 * 60_000]
};
const ADMIN_FAILURE_LIMIT = 10;
const ADMIN_FAILURE_WINDOW = 15 * 60_000;
const MAX_ORDER_STREAMS = 500;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2"
};
const COMPRESSIBLE = /^(text\/|application\/(json|manifest\+json|xml)|image\/svg\+xml)/;

const newId = () => crypto.randomBytes(12).toString("base64url");
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 32 chars: no 0/O or 1/I mix-ups
const bookingCode = () => [...crypto.randomBytes(6)].map((byte) => CODE_ALPHABET[byte % 32]).join("");

const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const safeJson = (value) =>
  JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
const isBot = (body) => typeof body.company === "string" && body.company.trim() !== "";

export async function createApp(options = {}) {
  const dataDir = path.resolve(options.dataDir ?? path.join(ROOT, "storage"));
  const seedDir = path.resolve(options.seedDir ?? path.join(ROOT, "data"));
  const publicDir = path.resolve(options.publicDir ?? path.join(ROOT, "public"));
  const now = options.now ?? (() => new Date());
  const trustProxy = Boolean(options.trustProxy);
  const rateLimits = { ...RATE_LIMITS, ...options.rateLimits };

  const store = new Store({ dataDir, seedDir });
  await store.init();
  const limiter = createRateLimiter();
  const auth = createAuth({ store, now, masterKey: options.adminToken });
  const whatsapp = createWhatsApp({ store, now, config: options.whatsapp, fetchImpl: options.fetch, logger: options.logger });
  const fileCache = new Map();
  const orderStreams = new Map();
  let streamCount = 0;

  const heartbeat = setInterval(() => {
    for (const listeners of orderStreams.values()) for (const res of listeners) res.write(": ping\n\n");
  }, 25_000);
  heartbeat.unref();

  const site = () => store.get("site");
  const menu = () => store.get("menu");
  const today = () => istParts(now()).iso;
  const features = () => ({ ...Object.fromEntries(FEATURE_KEYS.map((key) => [key, true])), ...site().features });

  function requireFeature(key, message) {
    if (!features()[key]) throw new HttpError(403, message);
  }

  // ---------- public views ----------

  function orderAvailability() {
    const settings = site();
    const on = features();
    if (!on.ordering || (!on.pickup && !on.dineIn)) {
      return { accepting: false, reason: "Online ordering is switched off right now. Please order at the counter." };
    }
    if (settings.orders?.paused) {
      return { accepting: false, reason: "Online ordering is paused for a little while. Please order at the counter." };
    }
    if (!settings.orders?.acceptWhenClosed && !openStatus(settings.hours, now()).open) {
      return { accepting: false, reason: "We're closed right now. Online ordering opens with the cafe." };
    }
    return { accepting: true, reason: "" };
  }

  function publicSite() {
    const settings = site();
    const current = now();
    return {
      name: settings.name,
      city: settings.city,
      tagline: settings.tagline,
      description: settings.description,
      website: settings.website,
      phone: settings.phone,
      whatsapp: settings.whatsapp,
      email: settings.email,
      instagram: settings.instagram,
      address: settings.address,
      mapsQuery: settings.mapsQuery,
      priceForTwo: settings.priceForTwo,
      cuisines: settings.cuisines,
      announcement: settings.announcement,
      outlets: settings.outlets ?? [],
      hours: hoursTable(settings.hours, current),
      status: openStatus(settings.hours, current),
      today: istParts(current).iso,
      features: features(),
      orders: {
        gstPercent: settings.orders?.gstPercent ?? 5,
        types: { pickup: features().pickup, dineIn: features().dineIn },
        whatsappUpdates: whatsapp.offersCustomerUpdates("order"),
        ...orderAvailability()
      },
      reservations: {
        maxGuests: settings.reservations?.maxGuests ?? 20,
        daysAhead: settings.reservations?.daysAhead ?? 30,
        whatsappUpdates: whatsapp.offersCustomerUpdates("booking")
      }
    };
  }

  const publicItem = (item) => ({
    id: item.id,
    category: item.category,
    name: item.name,
    description: item.description ?? "",
    price: item.price,
    veg: item.veg !== false,
    bestseller: Boolean(item.bestseller),
    spicy: Boolean(item.spicy),
    available: item.available !== false,
    image: item.image || ""
  });

  const publicMenu = () => ({ categories: menu().categories, items: menu().items.map(publicItem) });

  const publicOrder = (order) => ({
    id: order.id,
    number: order.number,
    status: order.status,
    type: order.type,
    table: order.table,
    name: order.name,
    items: order.items.map(({ name, qty, price }) => ({ name, qty, price })),
    amounts: order.amounts,
    etaMinutes: order.etaMinutes ?? null,
    readyBy: order.readyBy ?? null,
    readyByLabel: order.readyBy ? formatClock(new Date(order.readyBy)) : null,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt
  });

  function rateLimit(ctx, bucket) {
    const [limit, windowMs] = rateLimits[bucket];
    if (!limiter.hit(`${ctx.ip}:${bucket}`, limit, windowMs)) {
      throw new HttpError(429, "You're doing that a lot. Please wait a few minutes and try again.");
    }
  }

  function seatsLeft(date, time) {
    const capacity = site().reservations?.seatsPerSlot ?? 40;
    const booked = store
      .get("reservations")
      .filter((r) => r.date === date && r.time === time && !RELEASED_RESERVATION_STATUSES.has(r.status))
      .reduce((sum, r) => sum + r.guests, 0);
    return Math.max(0, capacity - booked);
  }

  // ---------- public API ----------

  async function createOrder(ctx) {
    const body = await readJson(ctx.req);
    rateLimit(ctx, "order");
    if (isBot(body)) return ctx.json(201, { id: newId(), number: 0, status: "received" });

    const check = createChecker(body);
    const name = check.text("name", { label: "Name", max: 60 });
    const phone = check.phone("phone");
    const type = check.oneOf("type", ["pickup", "dine-in"], { label: "Order type" });
    const table =
      type === "dine-in"
        ? check.text("table", {
            label: "Table number",
            max: 8,
            pattern: /^[A-Za-z0-9-]+$/,
            patternMessage: "Use the table number shown on your table."
          })
        : "";
    const notes = check.text("notes", { label: "Notes", optional: true, max: 300 });
    if (type === "pickup" && !features().pickup) check.fail("type", "Pickup orders are switched off right now.");
    if (type === "dine-in" && !features().dineIn) check.fail("type", "Ordering from the table is switched off right now.");
    const lines = orderLines(body.items, check);
    check.done();

    const availability = orderAvailability();
    if (!availability.accepting) throw new HttpError(409, availability.reason);

    const gstPercent = site().orders?.gstPercent ?? 5;
    const subtotal = lines.reduce((sum, line) => sum + line.price * 100 * line.qty, 0);
    const gst = Math.round((subtotal * gstPercent) / 100);
    const current = now();
    const day = istParts(current).iso;
    const orders = store.get("orders");
    const order = {
      id: newId(),
      number: orders.filter((o) => o.day === day).length + 1,
      day,
      status: "received",
      type,
      table,
      name,
      phone,
      notes,
      whatsappOptIn: body.whatsappUpdates === true,
      items: lines,
      amounts: { subtotal, gst, total: subtotal + gst, gstPercent },
      createdAt: current.toISOString(),
      updatedAt: current.toISOString(),
      history: [{ status: "received", at: current.toISOString() }]
    };
    orders.push(order);
    await store.save("orders");
    const ref = { type: "order", id: order.id };
    whatsapp.notify("order_staff_alert", order, ref);
    whatsapp.notify("order_received", order, ref);
    ctx.json(201, publicOrder(order));
  }

  function orderLines(rawItems, check) {
    if (!Array.isArray(rawItems) || rawItems.length === 0) return check.fail("items", "Your order is empty."), [];
    if (rawItems.length > 40) return check.fail("items", "For very large orders please speak to our team."), [];
    const quantities = new Map();
    for (const entry of rawItems) {
      const id = typeof entry?.id === "string" ? entry.id : "";
      if (!Number.isInteger(entry?.qty) || entry.qty < 1 || entry.qty > 20) {
        return check.fail("items", "Each item quantity must be between 1 and 20."), [];
      }
      quantities.set(id, (quantities.get(id) ?? 0) + entry.qty);
    }
    const lines = [];
    for (const [id, qty] of quantities) {
      const item = menu().items.find((candidate) => candidate.id === id);
      if (!item) return check.fail("items", "An item in your order is no longer on the menu. Please refresh."), [];
      if (item.available === false) return check.fail("items", `${item.name} has just sold out. Please remove it to continue.`), [];
      if (qty > 20) return check.fail("items", `You can order up to 20 × ${item.name} online.`), [];
      lines.push({ id, name: item.name, price: item.price, qty, veg: item.veg !== false });
    }
    return lines;
  }

  function getOrder(ctx, id) {
    const order = store.get("orders").find((o) => o.id === id);
    if (!order) throw new HttpError(404, "We couldn't find that order.");
    return publicOrder(order);
  }

  function streamOrder(ctx, id) {
    const order = store.get("orders").find((o) => o.id === id);
    if (!order) throw new HttpError(404, "We couldn't find that order.");
    const listeners = orderStreams.get(id) ?? new Set();
    if (streamCount >= MAX_ORDER_STREAMS || listeners.size >= 5) {
      throw new HttpError(503, "Live updates are busy right now. Refresh to check your order.");
    }
    ctx.res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    });
    ctx.res.write(`retry: 5000\n\ndata: ${JSON.stringify(publicOrder(order))}\n\n`);
    listeners.add(ctx.res);
    orderStreams.set(id, listeners);
    streamCount += 1;
    ctx.req.on("close", () => {
      if (!listeners.delete(ctx.res)) return;
      streamCount -= 1;
      if (listeners.size === 0) orderStreams.delete(id);
    });
  }

  function notifyOrder(order) {
    const listeners = orderStreams.get(order.id);
    if (!listeners) return;
    const message = `data: ${JSON.stringify(publicOrder(order))}\n\n`;
    for (const res of listeners) res.write(message);
  }

  function getAvailability(ctx) {
    const settings = site();
    const date = ctx.url.searchParams.get("date") || today();
    if (!parseIsoDate(date)) throw new HttpError(400, "Use a date like 2026-01-31.");
    const ahead = daysBetween(today(), date);
    const daysAhead = settings.reservations?.daysAhead ?? 30;
    if (ahead < 0) return { date, slots: [], message: "That date has passed." };
    if (ahead > daysAhead) return { date, slots: [], message: `We take bookings up to ${daysAhead} days ahead.` };
    const slots = reservationSlots(settings.hours, date, settings.reservations, now()).map((slot) => ({
      time: slot.time,
      label: slot.label,
      seatsLeft: seatsLeft(date, slot.time)
    }));
    let message = "";
    if (!dayWindow(settings.hours, parseIsoDate(date).getUTCDay())) message = "We're closed on this day.";
    else if (slots.length === 0) message = "No more tables today. Try tomorrow?";
    return { date, slots, message };
  }

  async function createReservation(ctx) {
    const body = await readJson(ctx.req);
    rateLimit(ctx, "reservation");
    requireFeature("bookings", "Online table booking is switched off right now. Please call us to book.");
    if (isBot(body)) return ctx.json(201, { code: bookingCode(), status: "pending" });

    const settings = site();
    const rules = settings.reservations ?? {};
    const daysAhead = rules.daysAhead ?? 30;
    const check = createChecker(body);
    const name = check.text("name", { label: "Name", max: 60 });
    const phone = check.phone("phone");
    const email = check.email("email", { optional: true });
    const guests = check.int("guests", { label: "Guests", min: 1, max: rules.maxGuests ?? 20 });
    const occasion = check.oneOf("occasion", OCCASIONS, { label: "Occasion", optional: true });
    const notes = check.text("notes", { label: "Notes", optional: true, max: 300 });

    const date = cleanText(body.date);
    const time = cleanText(body.time);
    if (!parseIsoDate(date)) check.fail("date", "Pick a date.");
    else if (daysBetween(today(), date) < 0) check.fail("date", "That date has passed.");
    else if (daysBetween(today(), date) > daysAhead) check.fail("date", `We take bookings up to ${daysAhead} days ahead.`);
    const slot = check.errors.date ? null : reservationSlots(settings.hours, date, rules, now()).find((s) => s.time === time);
    if (!check.errors.date && !slot) check.fail("time", "Pick one of the available times.");
    check.done();

    const reservations = store.get("reservations");
    const duplicate = reservations.some(
      (r) => r.phone === phone && r.date === date && r.time === time && !RELEASED_RESERVATION_STATUSES.has(r.status)
    );
    if (duplicate) throw new HttpError(409, "You already have a booking at this time. We'll see you then!");
    const left = seatsLeft(date, time);
    if (guests > left) {
      const message = left > 0 ? `Only ${left} seats left at ${slot.label}. Try fewer guests or another time.` : "That time just filled up. Please pick another slot.";
      throw new HttpError(409, message, { fields: { time: message } });
    }

    const createdAt = now().toISOString();
    const reservation = {
      id: newId(),
      code: bookingCode(),
      status: "pending",
      name,
      phone,
      email,
      date,
      time,
      timeLabel: slot.label,
      guests,
      occasion,
      notes,
      whatsappOptIn: body.whatsappUpdates === true,
      createdAt,
      updatedAt: createdAt
    };
    reservations.push(reservation);
    await store.save("reservations");
    whatsapp.notify("booking_staff_alert", bookingView(reservation), { type: "reservation", id: reservation.id });
    ctx.json(201, { code: reservation.code, status: reservation.status, name, date, time: slot.label, guests });
  }

  function listReviews() {
    const approved = store.get("reviews").filter((r) => r.status === "approved");
    const average = approved.length ? approved.reduce((sum, r) => sum + r.rating, 0) / approved.length : 0;
    return {
      stats: { count: approved.length, average: Math.round(average * 10) / 10 },
      reviews: approved
        .slice()
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 24)
        .map(({ id, name, rating, text, createdAt }) => ({ id, name, rating, text, createdAt }))
    };
  }

  async function createReview(ctx) {
    const body = await readJson(ctx.req);
    rateLimit(ctx, "review");
    requireFeature("reviews", "Reviews are switched off right now.");
    if (isBot(body)) return ctx.json(201, { status: "pending" });
    const check = createChecker(body);
    const name = check.text("name", { label: "Name", max: 40 });
    const rating = check.int("rating", { label: "Rating", min: 1, max: 5 });
    const text = check.text("text", { label: "Your review", min: 10, max: 600 });
    check.done();
    store.get("reviews").push({ id: newId(), status: "pending", name, rating, text, createdAt: now().toISOString() });
    await store.save("reviews");
    ctx.json(201, { status: "pending" });
  }

  async function createEnquiry(ctx) {
    const body = await readJson(ctx.req);
    rateLimit(ctx, "enquiry");
    requireFeature("enquiries", "Party enquiries are switched off right now. Please call us.");
    if (isBot(body)) return ctx.json(201, { status: "received" });
    const check = createChecker(body);
    const name = check.text("name", { label: "Name", max: 60 });
    const phone = check.phone("phone");
    const email = check.email("email", { optional: true });
    const type = check.oneOf("type", ["event", "general"], { label: "Enquiry type", optional: true, fallback: "general" });
    const guests = check.int("guests", { label: "Guests", min: 1, max: 500, optional: true });
    const message = check.text("message", { label: "Message", min: 5, max: 1000 });
    const date = cleanText(body.date);
    if (date && (!parseIsoDate(date) || daysBetween(today(), date) < 0)) check.fail("date", "Pick a date from today onwards.");
    check.done();
    const createdAt = now().toISOString();
    const enquiry = { id: newId(), status: "new", type, name, phone, email, date, guests, message, createdAt };
    store.get("enquiries").push(enquiry);
    await store.save("enquiries");
    whatsapp.notify("enquiry_staff_alert", { ...enquiry, dateLabel: date ? formatDayLabel(date) : "" }, { type: "enquiry", id: enquiry.id });
    ctx.json(201, { status: "received" });
  }

  async function subscribe(ctx) {
    const body = await readJson(ctx.req);
    rateLimit(ctx, "subscribe");
    requireFeature("newsletter", "Newsletter sign-ups are switched off right now.");
    if (isBot(body)) return ctx.json(201, { ok: true });
    const check = createChecker(body);
    const email = check.email("email");
    check.done();
    const subscribers = store.get("subscribers");
    // Same response either way so the form can't be used to check who is subscribed.
    if (!subscribers.some((s) => s.email === email)) {
      subscribers.push({ email, createdAt: now().toISOString() });
      await store.save("subscribers");
    }
    ctx.json(201, { ok: true });
  }

  // ---------- shared staff-side helpers ----------

  const bookingView = (reservation) => ({ ...reservation, dateLabel: formatDayLabel(reservation.date), timeLabel: reservation.timeLabel });

  async function audit(actor, action, details = "") {
    store.get("audit").push({ id: newId(), at: now().toISOString(), actorId: actor?.id ?? "system", actorName: actor?.name ?? "System", action, details });
    await store.save("audit");
  }

  /** Called after staff change an order's status: updates live trackers and sends WhatsApp updates. */
  function onOrderStatus(order, previous) {
    notifyOrder(order);
    if (order.status === previous) return;
    const ref = { type: "order", id: order.id };
    if (order.status === "preparing") whatsapp.notify("order_preparing", order, ref);
    if (order.status === "ready") whatsapp.notify("order_ready", order, ref);
  }

  function onReservationStatus(reservation, previous) {
    if (reservation.status === previous) return;
    const ref = { type: "reservation", id: reservation.id };
    if (reservation.status === "confirmed") whatsapp.notify("booking_confirmed", bookingView(reservation), ref);
    if (reservation.status === "cancelled" && ["pending", "confirmed"].includes(previous)) whatsapp.notify("booking_cancelled", bookingView(reservation), ref);
  }

  // ---------- routing ----------

  const routes = [];
  // access: undefined = public, "any" = any signed-in staff member, otherwise a permission name
  const route = (method, pattern, handler, access) => routes.push({ method, pattern, handler, access });

  route("GET", /^\/api\/site$/, () => publicSite());
  route("GET", /^\/api\/menu$/, () => publicMenu());
  route("GET", /^\/api\/availability$/, getAvailability);
  route("POST", /^\/api\/reservations$/, createReservation);
  route("POST", /^\/api\/orders$/, createOrder);
  route("GET", /^\/api\/orders\/([\w-]{8,40})$/, getOrder);
  route("GET", /^\/api\/orders\/([\w-]{8,40})\/events$/, streamOrder);
  route("GET", /^\/api\/reviews$/, listReviews);
  route("POST", /^\/api\/reviews$/, createReview);
  route("POST", /^\/api\/enquiries$/, createEnquiry);
  route("POST", /^\/api\/subscribe$/, subscribe);

  // Meta calls these: GET once to verify the webhook, then POST for every message and delivery update.
  route("GET", /^\/api\/whatsapp\/webhook$/, (ctx) => {
    const challenge = whatsapp.verifySubscription(ctx.url.searchParams);
    if (challenge === null) throw new HttpError(403, "Webhook verification failed.");
    ctx.res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    ctx.res.end(challenge);
  });
  route("POST", /^\/api\/whatsapp\/webhook$/, async (ctx) => {
    const raw = await readRaw(ctx.req, 512 * 1024);
    const result = await whatsapp.handleWebhook(raw, ctx.req.headers["x-hub-signature-256"], parseJsonObject(raw));
    if (!result.ok) throw new HttpError(401, "Invalid signature.");
    return { ok: true };
  });

  registerAdminApi({
    route,
    store,
    now,
    today,
    site,
    menu,
    features,
    auth,
    whatsapp,
    limiter,
    audit,
    publicOrder,
    bookingView,
    onOrderStatus,
    onReservationStatus,
    failedAuth,
    authLocked
  });

  function authLocked(ctx) {
    return limiter.count(`${ctx.ip}:admin-fail`) >= ADMIN_FAILURE_LIMIT;
  }

  function failedAuth(ctx) {
    limiter.hit(`${ctx.ip}:admin-fail`, ADMIN_FAILURE_LIMIT, ADMIN_FAILURE_WINDOW);
  }

  function authorise(ctx, access) {
    if (authLocked(ctx)) throw new HttpError(429, "Too many failed sign-in attempts. Try again in 15 minutes.");
    const actor = auth.authenticate(ctx.req);
    if (!actor) {
      if (ctx.req.headers.authorization) failedAuth(ctx);
      throw new HttpError(401, "Please sign in again.");
    }
    if (access !== "any" && !actor.permissions.includes(access)) {
      throw new HttpError(403, "Your account doesn't have access to this. Ask the owner to change your permissions.");
    }
    ctx.actor = actor;
  }

  async function handleApi(ctx) {
    const { method } = ctx.req;
    let pathMatched = false;
    for (const entry of routes) {
      const match = ctx.url.pathname.match(entry.pattern);
      if (!match) continue;
      pathMatched = true;
      if (entry.method !== method && !(entry.method === "GET" && method === "HEAD")) continue;
      if (entry.access) authorise(ctx, entry.access);
      const result = await entry.handler(ctx, ...match.slice(1));
      if (!ctx.res.headersSent && result !== undefined) sendJson(ctx.res, 200, result);
      return;
    }
    throw new HttpError(pathMatched ? 405 : 404, pathMatched ? "Method not allowed." : "Not found.");
  }

  // ---------- pages & static files ----------

  async function loadFile(filePath) {
    const info = await stat(filePath).catch(() => null);
    if (!info?.isFile()) return null;
    const cached = fileCache.get(filePath);
    if (cached && cached.mtimeMs === info.mtimeMs && cached.size === info.size) return cached;
    const body = await readFile(filePath);
    const type = MIME_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream";
    const entry = {
      body,
      type,
      mtimeMs: info.mtimeMs,
      size: info.size,
      etag: `W/"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`,
      gzip: COMPRESSIBLE.test(type) && body.length > 1024 ? zlib.gzipSync(body) : null
    };
    fileCache.set(filePath, entry);
    return entry;
  }

  function sendFile(ctx, status, { body, type, etag, gzip, cache, extraHeaders = {} }) {
    const headers = { "Content-Type": type, "Cache-Control": cache, Vary: "Accept-Encoding", ...extraHeaders };
    if (etag) {
      headers.ETag = etag;
      if (status === 200 && ctx.req.headers["if-none-match"] === etag) {
        ctx.res.writeHead(304, headers);
        return ctx.res.end();
      }
    }
    const useGzip = Boolean(gzip) && /\bgzip\b/.test(String(ctx.req.headers["accept-encoding"] || ""));
    const payload = useGzip ? gzip : body;
    if (useGzip) headers["Content-Encoding"] = "gzip";
    headers["Content-Length"] = payload.length;
    ctx.res.writeHead(status, headers);
    ctx.res.end(ctx.req.method === "HEAD" ? undefined : payload);
  }

  function sendGenerated(ctx, type, text, cache = "no-cache") {
    const body = Buffer.from(text);
    sendFile(ctx, 200, {
      body,
      type,
      cache,
      etag: `W/"${crypto.createHash("sha1").update(body).digest("base64url")}"`,
      gzip: body.length > 1024 ? zlib.gzipSync(body) : null
    });
  }

  function formatAddress(address = {}) {
    return [address.street, address.locality, `${address.city ?? ""} ${address.postalCode ?? ""}`.trim()].filter(Boolean).join(", ");
  }

  function structuredData() {
    const settings = site();
    const { categories, items } = menu();
    return {
      "@context": "https://schema.org",
      "@type": "CafeOrCoffeeShop",
      name: `${settings.name} ${settings.city}`,
      description: settings.description,
      url: settings.website || undefined,
      telephone: settings.phone,
      priceRange: "₹₹",
      servesCuisine: settings.cuisines,
      acceptsReservations: true,
      address: {
        "@type": "PostalAddress",
        streetAddress: settings.address?.street,
        addressLocality: settings.address?.city,
        addressRegion: settings.address?.region,
        postalCode: settings.address?.postalCode,
        addressCountry: settings.address?.country
      },
      openingHoursSpecification: DAY_KEYS.map((key, index) => {
        const entry = settings.hours?.[key];
        return entry ? { "@type": "OpeningHoursSpecification", dayOfWeek: `https://schema.org/${DAY_NAMES[index]}`, opens: entry[0], closes: entry[1] } : null;
      }).filter(Boolean),
      hasMenu: {
        "@type": "Menu",
        hasMenuSection: categories.map((category) => ({
          "@type": "MenuSection",
          name: category.name,
          hasMenuItem: items
            .filter((item) => item.category === category.id)
            .map((item) => ({
              "@type": "MenuItem",
              name: item.name,
              description: item.description,
              offers: { "@type": "Offer", price: item.price, priceCurrency: "INR" },
              ...(item.veg !== false ? { suitableForDiet: "https://schema.org/VegetarianDiet" } : {})
            }))
        }))
      }
    };
  }

  async function renderPage(ctx, fileName, extraHeaders = {}) {
    const template = await loadFile(path.join(publicDir, fileName));
    if (!template) throw new HttpError(500, `Missing ${fileName}.`);
    const settings = site();
    const status = openStatus(settings.hours, now());
    const values = {
      title: settings.seoTitle || `${settings.name} ${settings.city} | ${settings.tagline}`,
      description: settings.description,
      name: settings.name,
      city: settings.city,
      phone: settings.phone,
      phoneHref: `tel:${String(settings.phone || "").replace(/[^\d+]/g, "")}`,
      address: formatAddress(settings.address),
      statusLabel: status.label,
      statusClass: status.open ? (status.closingSoon ? "is-soon" : "is-open") : "is-closed",
      ogImage: `${(settings.website || "").replace(/\/$/, "")}/assets/og-image.png`,
      mapsEmbed: `https://www.google.com/maps?q=${encodeURIComponent(settings.mapsQuery || "")}&output=embed`,
      mapsLink: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(settings.mapsQuery || "")}`,
      year: istParts(now()).iso.slice(0, 4),
      bodyClass: FEATURE_KEYS.filter((key) => !features()[key]).map((key) => `no-${key}`).join(" ")
    };
    const raw = {
      canonicalTag: settings.website ? `<link rel="canonical" href="${escapeHtml(settings.website)}">` : "",
      jsonLd: safeJson(structuredData()),
      boot: safeJson({ site: publicSite(), menu: publicMenu() })
    };
    const html = template.body
      .toString("utf8")
      .replace(/\{\{(\w+)\}\}/g, (token, key) => (key in raw ? raw[key] : key in values ? escapeHtml(values[key]) : token));
    sendGenerated(ctx, "text/html; charset=utf-8", html);
  }

  async function notFound(ctx) {
    const page = await loadFile(path.join(publicDir, "404.html"));
    if (!page) return sendJson(ctx.res, 404, { error: "Not found." });
    sendFile(ctx, 404, { ...page, etag: null, cache: "no-cache" });
  }

  async function serveStatic(ctx) {
    let pathname;
    try {
      pathname = decodeURIComponent(ctx.url.pathname);
    } catch {
      return notFound(ctx);
    }
    if (pathname === "/" || pathname === "/index.html") return renderPage(ctx, "index.html");
    if (pathname === "/robots.txt") {
      const sitemap = site().website ? `\nSitemap: ${site().website.replace(/\/$/, "")}/sitemap.xml` : "";
      return sendGenerated(ctx, "text/plain; charset=utf-8", `User-agent: *\nDisallow: /admin\nDisallow: /api/\n${sitemap}\n`);
    }
    if (pathname === "/sitemap.xml" && site().website) {
      const base = escapeHtml(site().website.replace(/\/$/, ""));
      return sendGenerated(
        ctx,
        "application/xml; charset=utf-8",
        `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${base}/</loc><changefreq>daily</changefreq></url></urlset>\n`
      );
    }
    if (pathname === "/admin" || pathname === "/admin/") pathname = "/admin.html";
    if (pathname.includes("\0")) return notFound(ctx);

    const filePath = path.resolve(publicDir, `.${pathname}`);
    if (!filePath.startsWith(publicDir + path.sep)) return notFound(ctx);
    const file = await loadFile(filePath);
    if (!file) return notFound(ctx);
    const longCache = /^image\/|^font\//.test(file.type);
    const extraHeaders = pathname === "/admin.html" ? { "X-Robots-Tag": "noindex, nofollow" } : {};
    sendFile(ctx, 200, { ...file, cache: longCache ? "public, max-age=604800" : "no-cache", extraHeaders });
  }

  function handleError(res, error) {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    if (error instanceof ValidationError) return sendJson(res, 422, { error: error.message, fields: error.fields });
    if (error instanceof HttpError) return sendJson(res, error.status, { error: error.message, ...error.extra });
    console.error(error);
    sendJson(res, 500, { error: "Something went wrong on our side. Please try again." });
  }

  const server = http.createServer(async (req, res) => {
    try {
      applySecurityHeaders(req, res, trustProxy);
      const url = new URL(req.url, "http://localhost");
      const ctx = { req, res, url, ip: clientIp(req, trustProxy), json: (status, body) => sendJson(res, status, body) };
      if (url.pathname.startsWith("/api/")) await handleApi(ctx);
      else if (req.method === "GET" || req.method === "HEAD") await serveStatic(ctx);
      else throw new HttpError(405, "Method not allowed.");
    } catch (error) {
      handleError(res, error);
    }
  });

  async function close() {
    clearInterval(heartbeat);
    limiter.stop();
    for (const listeners of orderStreams.values()) for (const res of listeners) res.end();
    await new Promise((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections?.();
    });
    await whatsapp.flush();
    await store.flush();
  }

  return { server, store, whatsapp, close };
}
