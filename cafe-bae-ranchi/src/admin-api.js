import crypto from "node:crypto";
import { GRANTABLE, PERMISSIONS, ROLES, hashPassword, publicUser, verifyPassword } from "./auth.js";
import {
  ACTIVE_ORDER_STATUSES,
  CATEGORY_ICONS,
  ENQUIRY_STATUSES,
  FEATURE_KEYS,
  ORDER_STATUSES,
  PAYMENT_METHODS,
  RELEASED_RESERVATION_STATUSES,
  RESERVATION_STATUSES,
  REVIEW_STATUSES,
  TONES
} from "./constants.js";
import { HttpError, readJson } from "./http.js";
import { DAY_KEYS, addDays, formatDayLabel, openStatus, toMinutes } from "./time.js";
import { ValidationError, cleanText, createChecker } from "./validate.js";
import { WA_EVENTS, defaultWhatsAppSettings, waNumber } from "./whatsapp.js";

const newId = () => crypto.randomBytes(12).toString("base64url");
const slugify = (value, fallback = "item") =>
  cleanText(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || fallback;
const pad = (n) => String(n).padStart(3, "0");
const USERNAME = /^[a-z0-9._-]{3,32}$/;
const lower = (value) => (typeof value === "string" ? value.trim().toLowerCase() : value);
const ID = "([\\w-]{1,64})";

/** Runs several checkers over nested objects and reports errors as "section.field". */
function sectionChecks() {
  const errors = {};
  return {
    section(prefix, input) {
      const check = createChecker(input && typeof input === "object" && !Array.isArray(input) ? input : {});
      return new Proxy(check, {
        get(target, prop) {
          if (prop === "done") return () => Object.entries(target.errors).forEach(([key, message]) => (errors[`${prefix}.${key}`] ??= message));
          return target[prop];
        }
      });
    },
    fail(key, message) {
      errors[key] ??= message;
    },
    done() {
      if (Object.keys(errors).length) throw new ValidationError(errors);
    }
  };
}

export function registerAdminApi(core) {
  const { route, store, now, today, site, menu, features, auth, whatsapp, audit, publicOrder, bookingView, onOrderStatus, onReservationStatus, failedAuth, authLocked } = core;
  const R = (path) => new RegExp(`^/api/admin${path}$`);

  // ---------------------------------------------------------------- accounts

  function sessionPayload(token, user) {
    return { token, user: publicUser(user) };
  }

  route("GET", R("/setup"), () => ({ needsSetup: auth.needsSetup(), setupKeyConfigured: auth.hasMasterKey }));

  route("POST", R("/setup"), async (ctx) => {
    if (authLocked(ctx)) throw new HttpError(429, "Too many failed attempts. Try again in 15 minutes.");
    if (!auth.needsSetup()) throw new HttpError(409, "The master account already exists. Please sign in.");
    const body = await readJson(ctx.req);
    if (!auth.isMasterKey(String(body.setupKey || ""))) {
      failedAuth(ctx);
      throw new ValidationError({ setupKey: "That setup key isn't right. It is the ADMIN_TOKEN value from your server settings." });
    }
    const check = createChecker({ ...body, username: lower(body.username) });
    const name = check.text("name", { label: "Your name", max: 60 });
    const username = check.text("username", { label: "Username", max: 32, pattern: USERNAME, patternMessage: "Use 3–32 letters, numbers, dots or dashes." });
    const password = check.text("password", { label: "Password", min: 8, max: 200 });
    check.done();
    const user = { id: newId(), name, username, role: "master", permissions: null, active: true, passwordHash: await hashPassword(password), createdAt: now().toISOString() };
    store.get("users").push(user);
    await store.save("users");
    const token = await auth.startSession(user, false);
    await audit(user, "Created master account", username);
    ctx.json(201, sessionPayload(token, user));
  });

  route("POST", R("/login"), async (ctx) => {
    if (authLocked(ctx)) throw new HttpError(429, "Too many failed sign-in attempts. Try again in 15 minutes.");
    const body = await readJson(ctx.req);
    const user = await auth.login(body.username, body.password);
    if (!user) {
      failedAuth(ctx);
      throw new HttpError(401, "Wrong username or password.");
    }
    const token = await auth.startSession(user, body.remember === true);
    await audit(user, "Signed in");
    return sessionPayload(token, user);
  });

  route("POST", R("/logout"), async (ctx) => {
    await auth.endSession(ctx.actor.sessionId);
    return { ok: true };
  }, "any");

  route("GET", R("/me"), (ctx) => ({
    user: { ...ctx.actor, roleLabel: ROLES[ctx.actor.role]?.label ?? ctx.actor.role },
    roles: Object.fromEntries(Object.entries(ROLES).map(([key, role]) => [key, { label: role.label, permissions: role.permissions }])),
    permissions: PERMISSIONS
  }), "any");

  route("POST", R("/me/password"), async (ctx) => {
    if (!ctx.actor.sessionId) throw new HttpError(400, "Sign in with your own account to change your password.");
    const body = await readJson(ctx.req);
    const user = store.get("users").find((u) => u.id === ctx.actor.id);
    const check = createChecker(body);
    const next = check.text("newPassword", { label: "New password", min: 8, max: 200 });
    if (!(await verifyPassword(body.currentPassword ?? "", user.passwordHash))) check.fail("currentPassword", "Your current password isn't right.");
    check.done();
    user.passwordHash = await hashPassword(next);
    await store.save("users");
    await auth.revokeUserSessions(user.id, ctx.actor.sessionId);
    await audit(ctx.actor, "Changed own password");
    return { ok: true };
  }, "any");

  // ---------------------------------------------------------------- overview

  route("GET", R("/summary"), (ctx) => {
    const day = today();
    const orders = store.get("orders");
    const todaysOrders = orders.filter((o) => o.day === day && o.status !== "cancelled");
    const reservations = store.get("reservations");
    const todaysBookings = reservations.filter((r) => r.date === day && !RELEASED_RESERVATION_STATUSES.has(r.status));
    const can = (permission) => ctx.actor.permissions.includes(permission);
    return {
      today: day,
      status: openStatus(site().hours, now()),
      ordersPaused: Boolean(site().orders?.paused),
      features: features(),
      orders: {
        today: todaysOrders.length,
        revenueToday: can("reports") || can("orders") ? todaysOrders.reduce((sum, o) => sum + o.amounts.total, 0) : null,
        active: orders.filter((o) => ACTIVE_ORDER_STATUSES.has(o.status)).length
      },
      reservations: {
        today: todaysBookings.length,
        guestsToday: todaysBookings.reduce((sum, r) => sum + r.guests, 0),
        pending: reservations.filter((r) => r.status === "pending" && r.date >= day).length
      },
      reviews: { pending: store.get("reviews").filter((r) => r.status === "pending").length },
      enquiries: { open: store.get("enquiries").filter((e) => e.status === "new").length },
      subscribers: store.get("subscribers").length,
      whatsapp: { ...whatsapp.status(), unread: can("whatsapp") ? whatsapp.unreadCount() : 0 }
    };
  }, "any");

  // ---------------------------------------------------------------- orders

  function latestMessages(type) {
    const latest = new Map();
    for (const message of store.get("messages")) {
      if (message.ref?.type === type) latest.set(message.ref.id, { status: message.status, event: message.event, error: message.error || "" });
    }
    return latest;
  }

  function adminOrder(order, latest) {
    return { ...order, readyByLabel: publicOrder(order).readyByLabel, whatsapp: latest.get(order.id) ?? null };
  }

  route("GET", R("/orders"), (ctx) => {
    const scope = ctx.url.searchParams.get("scope") || "active";
    const orders = store.get("orders");
    const latest = latestMessages("order");
    let list;
    if (scope === "active") list = orders.filter((o) => ACTIVE_ORDER_STATUSES.has(o.status));
    else list = (scope === "today" ? orders.filter((o) => o.day === today()) : orders).slice(-300).reverse();
    return { orders: list.map((order) => adminOrder(order, latest)) };
  }, "orders");

  route("PATCH", R(`/orders/${ID}`), async (ctx, id) => {
    const body = await readJson(ctx.req);
    const check = createChecker(body);
    const status = check.oneOf("status", ORDER_STATUSES, { label: "Status" });
    const etaMinutes = check.int("etaMinutes", { label: "Ready in", min: 1, max: 180, optional: true });
    const payment = check.oneOf("payment", PAYMENT_METHODS, { label: "Payment method", optional: true });
    check.done();
    const order = store.get("orders").find((o) => o.id === id);
    if (!order) throw new HttpError(404, "That order doesn't exist.");
    const previous = order.status;
    const at = now();
    order.status = status;
    order.updatedAt = at.toISOString();
    if (status === "preparing") {
      order.etaMinutes = etaMinutes ?? order.etaMinutes ?? 15;
      order.readyBy = new Date(at.getTime() + order.etaMinutes * 60_000).toISOString();
    }
    if (payment) order.payment = payment;
    if (status !== previous) order.history.push({ status, at: at.toISOString(), by: ctx.actor.name });
    await store.save("orders");
    onOrderStatus(order, previous);
    const extra = status === "preparing" ? ` (ready in ${order.etaMinutes} min)` : payment ? ` (paid by ${payment.toUpperCase()})` : "";
    await audit(ctx.actor, "Order status", `#${pad(order.number)} ${previous} → ${status}${extra}`);
    return { order: adminOrder(order, latestMessages("order")) };
  }, "orders");

  route("POST", R("/orders/pause"), async (ctx) => {
    const body = await readJson(ctx.req);
    const check = createChecker(body);
    const paused = check.bool("paused", { optional: false });
    check.done();
    site().orders = { ...site().orders, paused };
    await store.save("site");
    await audit(ctx.actor, paused ? "Paused online orders" : "Resumed online orders");
    return { paused };
  }, "orders");

  // ---------------------------------------------------------------- bookings

  route("GET", R("/reservations"), (ctx) => {
    const scope = ctx.url.searchParams.get("scope") || "upcoming";
    const day = today();
    const all = store.get("reservations");
    const latest = latestMessages("reservation");
    const byTime = (a, b) => (a.date + a.time).localeCompare(b.date + b.time);
    let list;
    if (scope === "today") list = all.filter((r) => r.date === day).sort(byTime);
    else if (scope === "past") list = all.filter((r) => r.date < day).sort(byTime).reverse().slice(0, 300);
    else list = all.filter((r) => r.date >= day).sort(byTime).slice(0, 300);
    return { reservations: list.map((r) => ({ ...bookingView(r), whatsapp: latest.get(r.id) ?? null })) };
  }, "bookings");

  route("PATCH", R(`/reservations/${ID}`), async (ctx, id) => {
    const body = await readJson(ctx.req);
    const check = createChecker(body);
    const status = check.oneOf("status", RESERVATION_STATUSES, { label: "Status" });
    check.done();
    const reservation = store.get("reservations").find((r) => r.id === id);
    if (!reservation) throw new HttpError(404, "That booking doesn't exist.");
    const previous = reservation.status;
    reservation.status = status;
    reservation.updatedAt = now().toISOString();
    await store.save("reservations");
    onReservationStatus(reservation, previous);
    await audit(ctx.actor, "Booking status", `${reservation.code} (${reservation.name}) ${previous} → ${status}`);
    return { reservation: bookingView(reservation) };
  }, "bookings");

  // ---------------------------------------------------------------- simple status lists

  async function setStatus(ctx, collection, id, allowed, label, describe) {
    const body = await readJson(ctx.req);
    const check = createChecker(body);
    const status = check.oneOf("status", allowed, { label: "Status" });
    check.done();
    const record = store.get(collection).find((entry) => entry.id === id);
    if (!record) throw new HttpError(404, "Not found.");
    record.status = status;
    record.updatedAt = now().toISOString();
    await store.save(collection);
    await audit(ctx.actor, label, `${describe(record)} → ${status}`);
    return record;
  }

  route("GET", R("/reviews"), () => ({ reviews: store.get("reviews").slice(-300).reverse() }), "reviews");
  route("PATCH", R(`/reviews/${ID}`), async (ctx, id) => ({ review: await setStatus(ctx, "reviews", id, REVIEW_STATUSES, "Review", (r) => `${r.rating}★ from ${r.name}`) }), "reviews");
  route("GET", R("/enquiries"), () => ({ enquiries: store.get("enquiries").slice(-300).reverse() }), "enquiries");
  route("PATCH", R(`/enquiries/${ID}`), async (ctx, id) => ({ enquiry: await setStatus(ctx, "enquiries", id, ENQUIRY_STATUSES, "Party enquiry", (e) => e.name) }), "enquiries");
  route("GET", R("/subscribers"), () => ({ subscribers: store.get("subscribers").slice().reverse() }), "subscribers");

  // ---------------------------------------------------------------- menu

  function readMenuItem(body, partial) {
    const check = createChecker(body);
    const has = (key) => body[key] !== undefined;
    const fields = {};
    if (!partial || has("name")) fields.name = check.text("name", { label: "Name", max: 60 });
    if (!partial || has("description")) fields.description = check.text("description", { label: "Description", optional: true, max: 200 });
    if (!partial || has("price")) fields.price = check.int("price", { label: "Price", min: 0, max: 100_000 });
    if (!partial || has("category")) fields.category = check.oneOf("category", menu().categories.map((c) => c.id), { label: "Category" });
    for (const key of ["veg", "bestseller", "spicy", "available"]) if (has(key)) fields[key] = check.bool(key);
    if (has("image")) {
      fields.image = check.text("image", {
        label: "Image link",
        optional: true,
        max: 500,
        pattern: /^(\/[^\s"'<>]*|https:\/\/[^\s"'<>]+)$/,
        patternMessage: "Use a link that starts with https:// or /images/."
      });
    }
    check.done();
    return fields;
  }

  route("GET", R("/menu"), () => menu(), "menu");

  route("POST", R("/menu/items"), async (ctx) => {
    const fields = readMenuItem(await readJson(ctx.req), false);
    const items = menu().items;
    const base = slugify(fields.name);
    let id = base;
    for (let n = 2; items.some((item) => item.id === id); n += 1) id = `${base}-${n}`;
    const item = { id, veg: true, bestseller: false, spicy: false, available: true, ...fields };
    items.push(item);
    await store.save("menu");
    await audit(ctx.actor, "Added menu item", `${item.name} (₹${item.price})`);
    ctx.json(201, { item });
  }, "menu");

  route("PATCH", R(`/menu/items/${ID}`), async (ctx, id) => {
    const item = menu().items.find((candidate) => candidate.id === id);
    if (!item) throw new HttpError(404, "That menu item doesn't exist.");
    const fields = readMenuItem(await readJson(ctx.req), true);
    const changes = Object.entries(fields)
      .filter(([key, value]) => item[key] !== value)
      .map(([key, value]) => (key === "price" ? `price ₹${item.price} → ₹${value}` : key === "available" ? (value ? "back in stock" : "sold out") : `${key}: ${value}`));
    Object.assign(item, fields);
    await store.save("menu");
    if (changes.length) await audit(ctx.actor, "Edited menu item", `${item.name}: ${changes.join(", ")}`);
    return { item };
  }, "menu");

  route("DELETE", R(`/menu/items/${ID}`), async (ctx, id) => {
    const items = menu().items;
    const index = items.findIndex((item) => item.id === id);
    if (index === -1) throw new HttpError(404, "That menu item doesn't exist.");
    const [removed] = items.splice(index, 1);
    await store.save("menu");
    await audit(ctx.actor, "Deleted menu item", removed.name);
    return { ok: true };
  }, "menu");

  function readCategory(body, partial) {
    const check = createChecker(body);
    const has = (key) => body[key] !== undefined;
    const fields = {};
    if (!partial || has("name")) fields.name = check.text("name", { label: "Name", max: 40 });
    if (!partial || has("blurb")) fields.blurb = check.text("blurb", { label: "Description", optional: true, max: 120 });
    if (!partial || has("icon")) fields.icon = check.oneOf("icon", CATEGORY_ICONS, { label: "Icon", optional: true, fallback: "coffee" });
    if (!partial || has("tone")) fields.tone = check.oneOf("tone", TONES, { label: "Colour", optional: true, fallback: "latte" });
    check.done();
    return fields;
  }

  route("POST", R("/menu/categories"), async (ctx) => {
    const fields = readCategory(await readJson(ctx.req), false);
    const categories = menu().categories;
    const base = slugify(fields.name, "category");
    let id = base;
    for (let n = 2; categories.some((c) => c.id === id); n += 1) id = `${base}-${n}`;
    const category = { id, ...fields };
    categories.push(category);
    await store.save("menu");
    await audit(ctx.actor, "Added menu category", category.name);
    ctx.json(201, { category });
  }, "menu");

  route("PATCH", R(`/menu/categories/${ID}`), async (ctx, id) => {
    const category = menu().categories.find((c) => c.id === id);
    if (!category) throw new HttpError(404, "That category doesn't exist.");
    const body = await readJson(ctx.req);
    const categories = menu().categories;
    if (body.move === "up" || body.move === "down") {
      const index = categories.indexOf(category);
      const target = body.move === "up" ? index - 1 : index + 1;
      if (target >= 0 && target < categories.length) [categories[index], categories[target]] = [categories[target], categories[index]];
    } else {
      Object.assign(category, readCategory(body, true));
    }
    await store.save("menu");
    await audit(ctx.actor, "Edited menu category", category.name);
    return { categories };
  }, "menu");

  route("DELETE", R(`/menu/categories/${ID}`), async (ctx, id) => {
    const categories = menu().categories;
    const index = categories.findIndex((c) => c.id === id);
    if (index === -1) throw new HttpError(404, "That category doesn't exist.");
    const count = menu().items.filter((item) => item.category === id).length;
    if (count) throw new HttpError(409, `Move or delete the ${count} item${count === 1 ? "" : "s"} in this category first.`);
    const [removed] = categories.splice(index, 1);
    await store.save("menu");
    await audit(ctx.actor, "Deleted menu category", removed.name);
    return { ok: true };
  }, "menu");

  // ---------------------------------------------------------------- business settings (master control)

  function settingsView() {
    const s = site();
    return {
      business: {
        name: s.name,
        city: s.city,
        tagline: s.tagline,
        description: s.description,
        phone: s.phone,
        whatsapp: s.whatsapp,
        email: s.email,
        instagram: s.instagram,
        website: s.website,
        priceForTwo: s.priceForTwo,
        mapsQuery: s.mapsQuery,
        address: { ...s.address }
      },
      announcement: s.announcement ?? "",
      ordersPaused: Boolean(s.orders?.paused),
      features: features(),
      orders: { gstPercent: s.orders?.gstPercent ?? 5, acceptWhenClosed: Boolean(s.orders?.acceptWhenClosed) },
      reservations: { ...s.reservations },
      hours: Object.fromEntries(DAY_KEYS.map((key) => [key, s.hours?.[key] ?? null])),
      outlets: s.outlets ?? [],
      options: { tones: TONES }
    };
  }

  route("GET", R("/settings"), () => settingsView(), "settings");

  route("PATCH", R("/settings"), async (ctx) => {
    const body = await readJson(ctx.req, 64 * 1024);
    const checks = sectionChecks();
    const s = site();
    const updates = {};
    const changed = [];

    if (body.announcement !== undefined) {
      const c = checks.section("announcement", { value: body.announcement });
      updates.announcement = c.text("value", { label: "Announcement", optional: true, max: 160 });
      c.done();
    }
    if (body.ordersPaused !== undefined) {
      if (typeof body.ordersPaused !== "boolean") checks.fail("ordersPaused", "Must be true or false.");
      else updates.ordersPaused = body.ordersPaused;
    }
    if (body.business !== undefined) {
      const c = checks.section("business", body.business);
      const b = body.business ?? {};
      const next = {};
      if (b.name !== undefined) next.name = c.text("name", { label: "Cafe name", max: 60 });
      if (b.city !== undefined) next.city = c.text("city", { label: "City", max: 40 });
      if (b.tagline !== undefined) next.tagline = c.text("tagline", { label: "Tagline", max: 120 });
      if (b.description !== undefined) next.description = c.text("description", { label: "Description", max: 300 });
      if (b.phone !== undefined) next.phone = c.text("phone", { label: "Phone", max: 20, pattern: /^\+?[\d\s-]{8,18}$/, patternMessage: "Enter a phone number like +91 90312 78991." });
      if (b.whatsapp !== undefined) {
        const raw = c.text("whatsapp", { label: "WhatsApp number", optional: true, max: 20, pattern: /^\+?[\d\s-]{10,18}$/, patternMessage: "Enter the WhatsApp number with country code." });
        next.whatsapp = raw ? waNumber(raw) : "";
      }
      if (b.email !== undefined) next.email = c.email("email", { optional: true });
      if (b.instagram !== undefined) {
        const handle = cleanText(b.instagram).replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/^@/, "").replace(/\/$/, "");
        if (handle && !/^[A-Za-z0-9._]{1,30}$/.test(handle)) c.fail("instagram", "Enter an Instagram handle like cafebae.ranchi.");
        next.instagram = handle;
      }
      if (b.website !== undefined) next.website = c.text("website", { label: "Website", optional: true, max: 200, pattern: /^https:\/\/[^\s"'<>]+$/, patternMessage: "Use a full link starting with https://" })?.replace(/\/$/, "");
      if (b.priceForTwo !== undefined) next.priceForTwo = c.int("priceForTwo", { label: "Price for two", min: 0, max: 100_000 });
      if (b.mapsQuery !== undefined) next.mapsQuery = c.text("mapsQuery", { label: "Map search text", max: 200 });
      if (b.address !== undefined) {
        const a = checks.section("business.address", b.address);
        next.address = { ...s.address };
        for (const [key, label, max] of [["street", "Street", 160], ["locality", "Area", 60], ["city", "City", 40], ["region", "State", 40], ["postalCode", "PIN code", 10]]) {
          if (b.address?.[key] !== undefined) next.address[key] = a.text(key, { label, max });
        }
        a.done();
      }
      c.done();
      updates.business = next;
    }
    if (body.features !== undefined) {
      const c = checks.section("features", body.features);
      updates.features = {};
      for (const key of FEATURE_KEYS) {
        const value = c.bool(key);
        if (value !== undefined) updates.features[key] = value;
      }
      c.done();
    }
    if (body.orders !== undefined) {
      const c = checks.section("orders", body.orders);
      updates.orders = {};
      if (body.orders?.gstPercent !== undefined) updates.orders.gstPercent = c.int("gstPercent", { label: "GST %", min: 0, max: 28 });
      const acceptWhenClosed = c.bool("acceptWhenClosed");
      if (acceptWhenClosed !== undefined) updates.orders.acceptWhenClosed = acceptWhenClosed;
      c.done();
    }
    if (body.reservations !== undefined) {
      const c = checks.section("reservations", body.reservations);
      const r = body.reservations ?? {};
      updates.reservations = {};
      if (r.slotMinutes !== undefined) updates.reservations.slotMinutes = c.oneOf("slotMinutes", [15, 30, 60], { label: "Slot length" });
      if (r.seatsPerSlot !== undefined) updates.reservations.seatsPerSlot = c.int("seatsPerSlot", { label: "Seats per slot", min: 1, max: 1000 });
      if (r.maxGuests !== undefined) updates.reservations.maxGuests = c.int("maxGuests", { label: "Largest online group", min: 1, max: 100 });
      if (r.daysAhead !== undefined) updates.reservations.daysAhead = c.int("daysAhead", { label: "Days ahead", min: 1, max: 180 });
      if (r.lastSeatingBeforeCloseMinutes !== undefined) {
        updates.reservations.lastSeatingBeforeCloseMinutes = c.int("lastSeatingBeforeCloseMinutes", { label: "Last seating", min: 0, max: 240 });
      }
      c.done();
    }
    if (body.hours !== undefined) {
      if (!body.hours || typeof body.hours !== "object" || Array.isArray(body.hours)) checks.fail("hours", "Hours must be an object.");
      else {
        updates.hours = {};
        for (const key of DAY_KEYS) {
          const value = body.hours[key];
          if (value === null || value === undefined) continue;
          if (!Array.isArray(value) || value.length !== 2 || value.some((t) => toMinutes(t) === null) || value[0] === value[1]) {
            checks.fail("hours", `Use HH:MM opening and closing times for ${key}.`);
          } else updates.hours[key] = value;
        }
      }
    }
    if (body.outlets !== undefined) {
      if (!Array.isArray(body.outlets) || body.outlets.length > 12) checks.fail("outlets", "Add up to 12 outlets.");
      else {
        updates.outlets = body.outlets.map((outlet, index) => {
          const c = checks.section(`outlets.${index}`, outlet);
          const result = {
            id: slugify(outlet?.id || outlet?.name, `outlet-${index + 1}`),
            name: c.text("name", { label: "Name", max: 60 }),
            area: c.text("area", { label: "Area", optional: true, max: 40 }),
            kind: c.text("kind", { label: "Label", optional: true, max: 30 }),
            tone: c.oneOf("tone", TONES, { label: "Colour", optional: true, fallback: "latte" }),
            blurb: c.text("blurb", { label: "Description", optional: true, max: 240 }),
            address: c.text("address", { label: "Address", max: 200 }),
            hours: c.text("hours", { label: "Hours", optional: true, max: 80 }),
            mapsQuery: c.text("mapsQuery", { label: "Map search text", optional: true, max: 200 })
          };
          c.done();
          return result;
        });
      }
    }
    checks.done();

    if (updates.announcement !== undefined) (s.announcement = updates.announcement), changed.push("announcement");
    if (updates.ordersPaused !== undefined) (s.orders = { ...s.orders, paused: updates.ordersPaused }), changed.push(updates.ordersPaused ? "paused orders" : "resumed orders");
    if (updates.business) {
      const { address, ...rest } = updates.business;
      Object.assign(s, rest);
      if (address) s.address = address;
      changed.push("business details");
    }
    if (updates.features) (s.features = { ...features(), ...updates.features }), changed.push(`features (${Object.entries(updates.features).map(([k, v]) => `${k} ${v ? "on" : "off"}`).join(", ")})`);
    if (updates.orders) (s.orders = { ...s.orders, ...updates.orders }), changed.push("order rules");
    if (updates.reservations) (s.reservations = { ...s.reservations, ...updates.reservations }), changed.push("booking rules");
    if (updates.hours) (s.hours = updates.hours), changed.push("opening hours");
    if (updates.outlets) (s.outlets = updates.outlets), changed.push("outlets");
    await store.save("site");
    if (changed.length) await audit(ctx.actor, "Changed settings", changed.join("; "));
    return settingsView();
  }, "settings");

  // ---------------------------------------------------------------- WhatsApp

  function whatsappView() {
    const settings = whatsapp.settings();
    return {
      status: whatsapp.status(),
      settings: { ...settings, events: { ...defaultWhatsAppSettings().events, ...settings.events } },
      events: WA_EVENTS,
      unread: whatsapp.unreadCount()
    };
  }

  route("GET", R("/whatsapp"), (ctx) => {
    if (!["whatsapp", "settings"].some((p) => ctx.actor.permissions.includes(p))) throw new HttpError(403, "Your account doesn't have access to WhatsApp.");
    return whatsappView();
  }, "any");

  route("PATCH", R("/whatsapp/settings"), async (ctx) => {
    const body = await readJson(ctx.req, 64 * 1024);
    const checks = sectionChecks();
    const c = checks.section("whatsapp", body);
    const next = { ...whatsapp.settings() };
    for (const key of ["enabled", "autoReply"]) {
      const value = c.bool(key);
      if (value !== undefined) next[key] = value;
    }
    if (body.language !== undefined) next.language = c.text("language", { label: "Template language", max: 10, pattern: /^[a-z]{2,3}(_[A-Z]{2})?$/, patternMessage: "Use a code like en or en_US." });
    if (body.staffNumbers !== undefined) {
      if (!Array.isArray(body.staffNumbers) || body.staffNumbers.length > 10) checks.fail("whatsapp.staffNumbers", "Add up to 10 staff numbers.");
      else {
        const numbers = body.staffNumbers.map((n) => waNumber(n)).filter(Boolean);
        if (numbers.some((n) => !/^\d{10,15}$/.test(n))) checks.fail("whatsapp.staffNumbers", "Enter numbers with country code, e.g. 91 90312 78991.");
        next.staffNumbers = [...new Set(numbers)];
      }
    }
    if (body.events !== undefined) {
      next.events = { ...defaultWhatsAppSettings().events, ...next.events };
      for (const [key, value] of Object.entries(body.events ?? {})) {
        if (!WA_EVENTS[key]) continue;
        const e = checks.section(`whatsapp.events.${key}`, value);
        const enabled = e.bool("enabled");
        const template = value?.template !== undefined ? e.text("template", { label: "Template name", optional: true, max: 512, pattern: /^[a-z0-9_]+$/, patternMessage: "Template names use lowercase letters, numbers and underscores." }) : undefined;
        e.done();
        next.events[key] = { ...next.events[key], ...(enabled !== undefined ? { enabled } : {}), ...(template !== undefined ? { template } : {}) };
      }
    }
    c.done();
    checks.done();
    site().whatsappApi = next;
    await store.save("site");
    await audit(ctx.actor, "Changed WhatsApp settings", `${next.enabled ? "on" : "off"}, ${next.staffNumbers.length} staff number(s), auto-reply ${next.autoReply ? "on" : "off"}`);
    return whatsappView();
  }, "settings");

  route("POST", R("/whatsapp/test"), async (ctx) => {
    if (!whatsapp.configured) throw new HttpError(409, "WhatsApp isn't connected yet. Add your WhatsApp Cloud API details to the server first.");
    const body = await readJson(ctx.req);
    const check = createChecker(body);
    const phone = check.text("phone", { label: "Phone", max: 20, pattern: /^\+?[\d\s-]{10,18}$/, patternMessage: "Enter a number with country code." });
    check.done();
    // hello_world is Meta's pre-approved sample template, available on every account.
    const entry = await whatsapp.sendTemplate(phone, "hello_world", [], { language: "en_US", event: "test", by: ctx.actor.name, body: "Test message (hello_world template)" });
    await audit(ctx.actor, "Sent WhatsApp test", waNumber(phone));
    return { message: entry };
  }, "settings");

  route("GET", R("/whatsapp/conversations"), () => ({ conversations: whatsapp.conversations(), status: whatsapp.status() }), "whatsapp");

  route("GET", R("/whatsapp/conversations/(\\d{8,15})"), async (ctx, phone) => whatsapp.conversation(phone), "whatsapp");

  route("POST", R("/whatsapp/conversations/(\\d{8,15})/messages"), async (ctx, phone) => {
    if (!whatsapp.configured) throw new HttpError(409, "WhatsApp isn't connected yet, so replies can't be sent from here. Use the WhatsApp button instead.");
    if (!whatsapp.canReply(phone)) {
      throw new HttpError(409, "It's been more than 24 hours since this customer last messaged, so WhatsApp only allows approved templates. Use the WhatsApp button to message them from your phone.");
    }
    const body = await readJson(ctx.req);
    const check = createChecker(body);
    const text = check.text("text", { label: "Message", max: 4000 });
    check.done();
    const entry = await whatsapp.sendText(phone, text, { by: ctx.actor.name });
    await audit(ctx.actor, "Replied on WhatsApp", `+${phone}`);
    if (entry.status === "failed") throw new HttpError(502, `WhatsApp didn't accept the message: ${entry.error}`);
    return { message: entry };
  }, "whatsapp");

  route("GET", R("/whatsapp/log"), () => ({ messages: store.get("messages").filter((m) => m.direction === "out").slice(-200).reverse() }), "whatsapp");

  // ---------------------------------------------------------------- reports

  route("GET", R("/reports"), (ctx) => {
    const days = [1, 7, 30, 90].includes(Number(ctx.url.searchParams.get("days"))) ? Number(ctx.url.searchParams.get("days")) : 7;
    const end = today();
    const start = addDays(end, -(days - 1));
    const inRange = (day) => day >= start && day <= end;
    const orders = store.get("orders").filter((o) => inRange(o.day));
    const valid = orders.filter((o) => o.status !== "cancelled");
    const revenue = valid.reduce((sum, o) => sum + o.amounts.total, 0);

    const byDay = Array.from({ length: days }, (_, i) => {
      const date = addDays(start, i);
      const list = valid.filter((o) => o.day === date);
      return { date, label: formatDayLabel(date), orders: list.length, revenue: list.reduce((sum, o) => sum + o.amounts.total, 0) };
    });
    const items = new Map();
    for (const order of valid) {
      for (const line of order.items) {
        const entry = items.get(line.name) ?? { name: line.name, qty: 0, revenue: 0 };
        entry.qty += line.qty;
        entry.revenue += line.price * 100 * line.qty;
        items.set(line.name, entry);
      }
    }
    const split = (key) => {
      const result = {};
      for (const order of valid) {
        const bucket = key(order);
        result[bucket] ??= { orders: 0, revenue: 0 };
        result[bucket].orders += 1;
        result[bucket].revenue += order.amounts.total;
      }
      return result;
    };
    const bookings = store.get("reservations").filter((r) => inRange(r.date));
    return {
      days,
      from: start,
      to: end,
      totals: {
        orders: valid.length,
        cancelled: orders.length - valid.length,
        revenue,
        gst: valid.reduce((sum, o) => sum + o.amounts.gst, 0),
        averageOrder: valid.length ? Math.round(revenue / valid.length) : 0
      },
      byDay,
      topItems: [...items.values()].sort((a, b) => b.qty - a.qty || b.revenue - a.revenue).slice(0, 10),
      byType: split((o) => (o.type === "dine-in" ? "Table" : "Pickup")),
      byPayment: split((o) => (o.payment ? o.payment.toUpperCase() : "Not recorded")),
      bookings: {
        total: bookings.filter((r) => !RELEASED_RESERVATION_STATUSES.has(r.status)).length,
        guests: bookings.filter((r) => !RELEASED_RESERVATION_STATUSES.has(r.status)).reduce((sum, r) => sum + r.guests, 0),
        noShows: bookings.filter((r) => r.status === "no-show").length,
        cancelled: bookings.filter((r) => r.status === "cancelled").length
      }
    };
  }, "reports");

  // ---------------------------------------------------------------- staff (master only)

  const users = () => store.get("users");
  const findUser = (id) => {
    const user = users().find((u) => u.id === id);
    if (!user) throw new HttpError(404, "That staff account doesn't exist.");
    return user;
  };
  const isLastMaster = (user) => user.role === "master" && user.active !== false && auth.activeMasters().length === 1;

  function readPermissions(check, value) {
    if (value === undefined || value === null) return undefined;
    if (!Array.isArray(value) || value.some((p) => !GRANTABLE.includes(p))) return check.fail("permissions", "Pick permissions from the list.");
    return [...new Set(value)];
  }

  route("GET", R("/staff"), () => ({
    users: users().map(publicUser),
    roles: Object.fromEntries(Object.entries(ROLES).map(([key, role]) => [key, { label: role.label, permissions: role.permissions }])),
    permissions: PERMISSIONS
  }), "staff");

  route("POST", R("/staff"), async (ctx) => {
    const body = await readJson(ctx.req);
    const check = createChecker({ ...body, username: lower(body.username) });
    const name = check.text("name", { label: "Name", max: 60 });
    const username = check.text("username", { label: "Username", max: 32, pattern: USERNAME, patternMessage: "Use 3–32 letters, numbers, dots or dashes." });
    const role = check.oneOf("role", Object.keys(ROLES), { label: "Role" });
    const password = check.text("password", { label: "Password", min: 8, max: 200 });
    const permissions = readPermissions(check, body.permissions);
    if (username && auth.findByUsername(username)) check.fail("username", "That username is already taken.");
    check.done();
    const user = {
      id: newId(),
      name,
      username,
      role,
      permissions: role === "master" ? null : permissions ?? [...ROLES[role].permissions],
      active: true,
      passwordHash: await hashPassword(password),
      createdAt: now().toISOString()
    };
    users().push(user);
    await store.save("users");
    await audit(ctx.actor, "Added staff account", `${name} (@${username}, ${ROLES[role].label})`);
    ctx.json(201, { user: publicUser(user) });
  }, "staff");

  route("PATCH", R(`/staff/${ID}`), async (ctx, id) => {
    const user = findUser(id);
    const body = await readJson(ctx.req);
    const check = createChecker(body);
    const changes = [];
    const name = body.name !== undefined ? check.text("name", { label: "Name", max: 60 }) : undefined;
    const role = body.role !== undefined ? check.oneOf("role", Object.keys(ROLES), { label: "Role" }) : undefined;
    const permissions = readPermissions(check, body.permissions);
    const active = check.bool("active");
    const password = body.password !== undefined ? check.text("password", { label: "New password", min: 8, max: 200 }) : undefined;
    if (isLastMaster(user) && ((role && role !== "master") || active === false)) {
      check.fail(role && role !== "master" ? "role" : "active", "This is the only active master account. Make someone else a master first.");
    }
    check.done();

    let revoke = false;
    if (name !== undefined && name !== user.name) (user.name = name), changes.push(`name → ${name}`);
    if (role !== undefined && role !== user.role) {
      changes.push(`role ${ROLES[user.role]?.label} → ${ROLES[role].label}`);
      user.role = role;
      user.permissions = role === "master" ? null : permissions ?? [...ROLES[role].permissions];
      revoke = true;
    } else if (permissions !== undefined && user.role !== "master") {
      user.permissions = permissions;
      changes.push(`permissions: ${permissions.join(", ") || "none"}`);
    }
    if (active !== undefined && active !== (user.active !== false)) {
      user.active = active;
      changes.push(active ? "re-activated" : "deactivated");
      revoke ||= !active;
    }
    if (password !== undefined) {
      user.passwordHash = await hashPassword(password);
      changes.push("password reset");
      revoke = true;
    }
    await store.save("users");
    if (revoke) await auth.revokeUserSessions(user.id, user.id === ctx.actor.id ? ctx.actor.sessionId : null);
    if (changes.length) await audit(ctx.actor, "Edited staff account", `${user.name}: ${changes.join("; ")}`);
    return { user: publicUser(user) };
  }, "staff");

  route("DELETE", R(`/staff/${ID}`), async (ctx, id) => {
    const user = findUser(id);
    if (user.id === ctx.actor.id) throw new HttpError(409, "You can't delete your own account.");
    if (isLastMaster(user)) throw new HttpError(409, "This is the only active master account. Make someone else a master first.");
    store.data.users = users().filter((u) => u.id !== id);
    await store.save("users");
    await auth.revokeUserSessions(id);
    await audit(ctx.actor, "Deleted staff account", `${user.name} (@${user.username})`);
    return { ok: true };
  }, "staff");

  route("GET", R("/audit"), (ctx) => {
    const who = ctx.url.searchParams.get("user");
    const list = store.get("audit").filter((entry) => !who || entry.actorId === who);
    return { entries: list.slice(-300).reverse() };
  }, "staff");
}
