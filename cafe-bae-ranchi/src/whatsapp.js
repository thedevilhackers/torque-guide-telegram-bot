import crypto from "node:crypto";
import { hoursTable, openStatus } from "./time.js";

/**
 * Message events the cafe can switch on. Business-initiated WhatsApp messages
 * must use templates approved in WhatsApp Manager, so each event names a
 * template and lists its {{1}}, {{2}}… parameters in order. `sample` is the
 * suggested template text shown in the dashboard and README.
 */
export const WA_EVENTS = {
  order_staff_alert: {
    audience: "staff",
    label: "New order → staff",
    template: "bae_new_order",
    params: ["Order number", "Pickup or table", "Items", "Total", "Customer name", "Customer phone"],
    sample: "New order {{1}} ({{2}}): {{3}}. Total {{4}}. Customer: {{5}}, {{6}}. Please check the kitchen board."
  },
  booking_staff_alert: {
    audience: "staff",
    label: "New table booking → staff",
    template: "bae_new_booking",
    params: ["Guest name", "Date", "Time", "Guests", "Guest phone", "Booking code"],
    sample: "New table request from {{1}} for {{2}} at {{3}}, {{4}} guests. Phone {{5}}, code {{6}}. Please confirm it in the dashboard."
  },
  enquiry_staff_alert: {
    audience: "staff",
    label: "New party enquiry → staff",
    template: "bae_new_enquiry",
    params: ["Name", "Phone", "Date", "Guests", "Message"],
    sample: "Party enquiry from {{1}} ({{2}}) for {{3}}, about {{4}} guests: {{5}}. Please call them back."
  },
  order_received: {
    audience: "customer",
    label: "Order received → customer",
    template: "bae_order_received",
    params: ["Customer name", "Order number", "Total"],
    sample: "Hi {{1}}, we've received your Cafe BAE order {{2}} (total {{3}}). We'll message you when it's ready."
  },
  order_preparing: {
    audience: "customer",
    label: "Order being prepared → customer",
    template: "bae_order_preparing",
    params: ["Customer name", "Order number", "Minutes until ready"],
    sample: "Hi {{1}}, your order {{2}} is being prepared and should be ready in about {{3}} minutes."
  },
  order_ready: {
    audience: "customer",
    label: "Order ready → customer",
    template: "bae_order_ready",
    params: ["Customer name", "Order number", "Where to collect"],
    sample: "Good news {{1}}! Your order {{2}} is ready {{3}}. Enjoy!"
  },
  booking_confirmed: {
    audience: "customer",
    label: "Booking confirmed → customer",
    template: "bae_booking_confirmed",
    params: ["Guest name", "Date", "Time", "Guests", "Booking code"],
    sample: "Hi {{1}}, your table at Cafe BAE on {{2}} at {{3}} for {{4}} is confirmed. Booking code {{5}}. See you soon!"
  },
  booking_cancelled: {
    audience: "customer",
    label: "Booking cancelled → customer",
    template: "bae_booking_cancelled",
    params: ["Guest name", "Date", "Time"],
    sample: "Hi {{1}}, your Cafe BAE booking for {{2}} at {{3}} has been cancelled. Reply here if you'd like a new time."
  }
};

const SESSION_WINDOW_MS = 24 * 3_600_000;
const FALLBACK_REPLY_GAP_MS = 6 * 3_600_000;
const newId = () => crypto.randomBytes(12).toString("base64url");

/** WhatsApp wants international numbers as digits only, e.g. 919876543210. */
export function waNumber(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (/^[6-9]\d{9}$/.test(digits)) return `91${digits}`;
  return digits;
}

// Template parameters can't contain newlines, tabs or long runs of spaces.
const cleanParam = (value) => String(value ?? "").replace(/[\r\n\t]+/g, " · ").replace(/ {4,}/g, "   ").trim().slice(0, 900) || "-";
const fill = (sample, params) => sample.replace(/\{\{(\d+)\}\}/g, (_, n) => params[Number(n) - 1] ?? "");
const rupees = (paise) => `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

export function defaultWhatsAppSettings() {
  return {
    enabled: false,
    autoReply: true,
    language: "en",
    staffNumbers: [],
    events: Object.fromEntries(Object.entries(WA_EVENTS).map(([key, event]) => [key, { enabled: true, template: event.template }]))
  };
}

export function createWhatsApp({ store, now, config = {}, fetchImpl = globalThis.fetch, logger = console }) {
  const credentials = {
    token: config.accessToken || "",
    phoneNumberId: config.phoneNumberId || "",
    appSecret: config.appSecret || "",
    verifyToken: config.verifyToken || "",
    base: (config.apiBase || "https://graph.facebook.com").replace(/\/$/, ""),
    version: config.apiVersion || "v23.0"
  };
  const configured = Boolean(credentials.token && credentials.phoneNumberId);
  const pending = new Set();

  const site = () => store.get("site");
  const settings = () => ({ ...defaultWhatsAppSettings(), ...site().whatsappApi });
  const messages = () => store.get("messages");
  const active = () => configured && settings().enabled;
  const siteUrl = () => String(site().website || "").replace(/\/$/, "");

  function status() {
    return {
      configured,
      enabled: Boolean(settings().enabled),
      active: active(),
      webhookReady: Boolean(credentials.appSecret && credentials.verifyToken),
      phoneNumberId: credentials.phoneNumberId ? `…${credentials.phoneNumberId.slice(-4)}` : "",
      apiVersion: credentials.version
    };
  }

  /** True when customers should be offered the "send me updates on WhatsApp" checkbox. */
  function offersCustomerUpdates(kind) {
    if (!active()) return false;
    const events = settings().events;
    const keys = kind === "booking" ? ["booking_confirmed", "booking_cancelled"] : ["order_received", "order_preparing", "order_ready"];
    return keys.some((key) => events[key]?.enabled && events[key]?.template);
  }

  function record(entry) {
    const at = now().toISOString();
    const saved = { id: newId(), createdAt: at, updatedAt: at, ...entry };
    messages().push(saved);
    store.save("messages");
    return saved;
  }

  async function post(payload) {
    const url = `${credentials.base}/${credentials.version}/${credentials.phoneNumberId}/messages`;
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${credentials.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", ...payload })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error?.message || `WhatsApp API error ${res.status}`);
    return data?.messages?.[0]?.id ?? "";
  }

  async function deliver(entry, payload) {
    try {
      entry.waId = await post(payload);
      entry.status = "sent";
    } catch (error) {
      entry.status = "failed";
      entry.error = error.message;
      logger.warn?.(`WhatsApp message to ${entry.phone} failed: ${error.message}`);
    }
    entry.updatedAt = now().toISOString();
    await store.save("messages");
    return entry;
  }

  function sendTemplate(phone, template, params, meta = {}) {
    const to = waNumber(phone);
    const language = meta.language || settings().language || "en";
    const entry = record({ direction: "out", kind: "template", phone: to, template, body: meta.body || `[${template}] ${params.join(" | ")}`, event: meta.event || "", ref: meta.ref || null, status: "queued", by: meta.by || "" });
    const components = params.length ? [{ type: "body", parameters: params.map((text) => ({ type: "text", text: cleanParam(text) })) }] : [];
    return deliver(entry, { to, type: "template", template: { name: template, language: { code: language }, components } });
  }

  function sendText(phone, text, meta = {}) {
    const to = waNumber(phone);
    const entry = record({ direction: "out", kind: "text", phone: to, body: text, event: meta.event || "reply", ref: meta.ref || null, status: "queued", by: meta.by || "" });
    return deliver(entry, { to, type: "text", text: { body: text, preview_url: true } });
  }

  function track(promise) {
    pending.add(promise);
    promise.finally(() => pending.delete(promise));
    return promise;
  }

  function eventParams(event, data) {
    switch (event) {
      case "order_staff_alert":
        return [
          `#${String(data.number).padStart(3, "0")}`,
          data.type === "dine-in" ? `Table ${data.table}` : "Pickup",
          data.items.map((line) => `${line.qty}x ${line.name}`).join(", "),
          rupees(data.amounts.total),
          data.name,
          data.phone
        ];
      case "booking_staff_alert":
        return [data.name, data.dateLabel, data.timeLabel, String(data.guests), data.phone, data.code];
      case "enquiry_staff_alert":
        return [data.name, data.phone, data.dateLabel || "date not fixed", data.guests ? String(data.guests) : "not sure", data.message];
      case "order_received":
        return [data.name.split(" ")[0], `#${String(data.number).padStart(3, "0")}`, rupees(data.amounts.total)];
      case "order_preparing":
        return [data.name.split(" ")[0], `#${String(data.number).padStart(3, "0")}`, String(data.etaMinutes || 15)];
      case "order_ready":
        return [data.name.split(" ")[0], `#${String(data.number).padStart(3, "0")}`, data.type === "dine-in" ? `and on its way to table ${data.table}` : "at the counter"];
      case "booking_confirmed":
        return [data.name.split(" ")[0], data.dateLabel, data.timeLabel, `${data.guests} guest${data.guests === 1 ? "" : "s"}`, data.code];
      case "booking_cancelled":
        return [data.name.split(" ")[0], data.dateLabel, data.timeLabel];
      default:
        return [];
    }
  }

  /**
   * Sends the messages for a business event. Never throws and never delays the
   * guest: delivery happens in the background and is recorded in the message log.
   */
  function notify(event, data, ref = null) {
    const definition = WA_EVENTS[event];
    const choice = settings().events?.[event];
    if (!definition || !active() || !choice?.enabled || !choice.template) return;
    let recipients = [];
    if (definition.audience === "staff") recipients = settings().staffNumbers ?? [];
    else if (data.whatsappOptIn && data.phone) recipients = [data.phone];
    const params = eventParams(event, data);
    for (const phone of recipients) {
      track(sendTemplate(phone, choice.template, params, { event, ref, body: fill(definition.sample, params) }));
    }
  }

  // ----- incoming webhook -----

  function verifySubscription(query) {
    const ok = query.get("hub.mode") === "subscribe" && credentials.verifyToken && query.get("hub.verify_token") === credentials.verifyToken;
    return ok ? query.get("hub.challenge") ?? "" : null;
  }

  function validSignature(rawBody, header) {
    if (!credentials.appSecret) return false;
    const expected = Buffer.from(`sha256=${crypto.createHmac("sha256", credentials.appSecret).update(rawBody).digest("hex")}`);
    const given = Buffer.from(String(header || ""));
    return given.length === expected.length && crypto.timingSafeEqual(given, expected);
  }

  const lastIncoming = (phone) => messages().findLast((m) => m.direction === "in" && m.phone === phone);
  const canReply = (phone) => {
    const last = lastIncoming(phone);
    return Boolean(last) && now().getTime() - new Date(last.createdAt).getTime() < SESSION_WINDOW_MS;
  };

  function incomingText(message) {
    switch (message.type) {
      case "text":
        return message.text?.body ?? "";
      case "button":
        return message.button?.text ?? "";
      case "interactive":
        return message.interactive?.button_reply?.title ?? message.interactive?.list_reply?.title ?? "";
      default:
        return `[${message.type || "message"}]`;
    }
  }

  function autoReplyFor(phone, text, contactName) {
    const s = site();
    const url = siteUrl();
    const lower = text.toLowerCase();
    const first = (contactName || "").split(" ")[0];
    const options = "Reply MENU, STATUS, BOOK, HOURS or LOCATION anytime.";
    if (/\b(status|track|where is my order|my order)\b/.test(lower)) {
      const order = store
        .get("orders")
        .filter((o) => waNumber(o.phone) === phone)
        .findLast(() => true);
      if (!order || now().getTime() - new Date(order.createdAt).getTime() > SESSION_WINDOW_MS) {
        return `We couldn't find an order from this number today. You can order online here: ${url}/#menu`;
      }
      const label = { received: "received", preparing: "being prepared", ready: "ready", completed: "completed", cancelled: "cancelled" }[order.status];
      const eta = order.status === "preparing" && order.etaMinutes ? ` It should be ready in about ${order.etaMinutes} minutes.` : "";
      return `Your order #${String(order.number).padStart(3, "0")} is ${label}.${eta} Live tracking: ${url}/?order=${order.id}`;
    }
    if (/\b(book|booking|table|reserv\w*)\b/.test(lower)) {
      return `You can book a table in under a minute and see which times are free: ${url}/#reserve`;
    }
    if (/\b(hours?|timings?|time|open|close|closing)\b/.test(lower)) {
      const today = hoursTable(s.hours, now()).find((row) => row.today);
      return `${openStatus(s.hours, now()).label}. Today's hours: ${today?.label ?? "closed"}. Full timings: ${url}/#visit`;
    }
    if (/\b(address|location|where|directions?|map)\b/.test(lower)) {
      const a = s.address ?? {};
      const query = encodeURIComponent(s.mapsQuery || "");
      return `${s.name}, ${[a.street, a.locality, a.city].filter(Boolean).join(", ")}. Directions: https://www.google.com/maps/search/?api=1&query=${query}`;
    }
    if (/^(hi+|hello|hey|hlo|namaste|menu|order|start|helo)\b/.test(lower) || /\bmenu\b/.test(lower)) {
      return `Hi${first ? ` ${first}` : ""}! Welcome to ${s.name} ${s.city}. See the menu and order here: ${url}/#menu\nBook a table: ${url}/#reserve\n${options}`;
    }
    const recentFallback = messages().findLast((m) => m.phone === phone && m.event === "auto_reply_fallback");
    if (recentFallback && now().getTime() - new Date(recentFallback.createdAt).getTime() < FALLBACK_REPLY_GAP_MS) return null;
    return { fallback: true, text: `Thanks for messaging ${s.name}! Our team will reply shortly. ${options}` };
  }

  async function handleWebhook(rawBody, signature, payload) {
    if (!validSignature(rawBody, signature)) return { ok: false };
    const replies = [];
    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value ?? {};
        for (const update of value.statuses ?? []) {
          const sent = messages().findLast((m) => m.waId && m.waId === update.id);
          if (!sent) continue;
          const rank = { queued: 0, sent: 1, delivered: 2, read: 3, failed: 4 };
          if ((rank[update.status] ?? 0) >= (rank[sent.status] ?? 0)) sent.status = update.status;
          if (update.errors?.length) sent.error = update.errors.map((e) => e.title || e.message).join("; ");
          sent.updatedAt = now().toISOString();
        }
        const names = new Map((value.contacts ?? []).map((c) => [c.wa_id, c.profile?.name ?? ""]));
        for (const message of value.messages ?? []) {
          if (messages().some((m) => m.waId === message.id)) continue; // Meta can deliver the same webhook twice
          const phone = waNumber(message.from);
          const text = incomingText(message);
          record({ direction: "in", kind: message.type || "text", phone, name: names.get(message.from) || "", body: text, waId: message.id, status: "received", read: false });
          if (active() && settings().autoReply && message.type !== "reaction") replies.push([phone, text, names.get(message.from)]);
        }
      }
    }
    await store.save("messages");
    for (const [phone, text, name] of replies) {
      const reply = autoReplyFor(phone, text, name);
      if (!reply) continue;
      const body = typeof reply === "string" ? reply : reply.text;
      track(sendText(phone, body, { event: typeof reply === "string" ? "auto_reply" : "auto_reply_fallback", by: "Auto-reply" }));
    }
    return { ok: true };
  }

  // ----- inbox -----

  function conversations() {
    const byPhone = new Map();
    for (const message of messages()) {
      const convo = byPhone.get(message.phone) ?? { phone: message.phone, name: "", unread: 0, last: null, lastIncomingAt: null };
      if (message.direction === "in") {
        if (message.name) convo.name = message.name;
        if (!message.read) convo.unread += 1;
        convo.lastIncomingAt = message.createdAt;
      }
      convo.last = { body: message.body, direction: message.direction, at: message.createdAt, status: message.status };
      byPhone.set(message.phone, convo);
    }
    return [...byPhone.values()]
      .filter((convo) => convo.lastIncomingAt)
      .map((convo) => ({ ...convo, canReply: Boolean(convo.lastIncomingAt) && now().getTime() - new Date(convo.lastIncomingAt).getTime() < SESSION_WINDOW_MS }))
      .sort((a, b) => b.last.at.localeCompare(a.last.at));
  }

  async function conversation(phone) {
    const list = messages().filter((m) => m.phone === phone);
    let changed = false;
    for (const message of list) {
      if (message.direction === "in" && !message.read) {
        message.read = true;
        changed = true;
      }
    }
    if (changed) await store.save("messages");
    return { phone, name: list.findLast((m) => m.name)?.name ?? "", canReply: canReply(phone), messages: list.slice(-200) };
  }

  return {
    status,
    configured,
    active,
    settings,
    offersCustomerUpdates,
    notify,
    sendTemplate,
    sendText,
    canReply,
    verifySubscription,
    handleWebhook,
    conversations,
    conversation,
    unreadCount: () => messages().filter((m) => m.direction === "in" && !m.read).length,
    flush: () => Promise.allSettled([...pending])
  };
}
