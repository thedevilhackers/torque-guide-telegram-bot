import { randomInt } from "node:crypto";
import { ecuById } from "./catalog.js";
import { db, settings, transact } from "./db.js";
import { events } from "./events.js";
import { FUELS, READ_METHODS, TIME_FRAMES, TOOL_MODES, TOOLS, creditText } from "./file-service.js";
import { FRANCHISE_BACKGROUNDS } from "./franchise.js";
import { MECHANIC_SKILLS } from "./mechanics.js";
import { escapeHtml as h, sendText } from "./telegram.js";

// Instant Telegram alerts for new orders and enquiries. The owner links a chat from the admin
// panel: it shows a one-time code, and sending "/start alerts_CODE" to the bot links that chat.

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_TTL_MS = 15 * 60_000;
const codes = new Map();

export function createLinkCode() {
  const now = Date.now();
  for (const [code, expires] of codes) if (expires < now) codes.delete(code);
  const code = Array.from({ length: 8 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
  codes.set(code, now + CODE_TTL_MS);
  return { code, expiresAt: new Date(now + CODE_TTL_MS).toISOString() };
}

// Codes work once and expire after 15 minutes.
export function linkChat(chatId, from = {}, code = "") {
  const key = String(code).trim().toUpperCase();
  const expires = codes.get(key);
  codes.delete(key);
  if (!expires || expires < Date.now()) return false;
  const chat = { chatId: String(chatId), name: [from.first_name, from.last_name].filter(Boolean).join(" ").slice(0, 60), username: from.username ?? "", linkedAt: new Date().toISOString() };
  transact((data) => {
    data.alertChats = [...data.alertChats.filter((existing) => existing.chatId !== chat.chatId), chat];
  });
  return true;
}

export function unlinkChat(chatId) {
  if (!alertChats().some((chat) => chat.chatId === String(chatId))) return false;
  transact((data) => {
    data.alertChats = data.alertChats.filter((chat) => chat.chatId !== String(chatId));
  });
  return true;
}

export const alertChats = () => db().alertChats ?? [];

// Telegram only accepts public https links on buttons.
function adminLink(path) {
  const base = settings().siteUrl || process.env.RENDER_EXTERNAL_URL || process.env.PUBLIC_URL || "";
  return /^https:\/\/[^\s]+$/.test(base) ? `${base.replace(/\/+$/, "")}/admin#${path}` : null;
}

const digits = (value) => String(value ?? "").replace(/\D/g, "");
const money = (amount, currency) => `${currency} ${Number(amount).toFixed(2)}`;
const firstName = (name) => String(name ?? "").split(" ")[0] || "customer";

function contactButtons(customer, adminPath) {
  const row = [];
  if (digits(customer.phone).length >= 6) row.push({ text: `💬 WhatsApp ${firstName(customer.name)}`, url: `https://wa.me/${digits(customer.phone)}` });
  if (customer.username) row.push({ text: `✉️ @${customer.username}`, url: `https://t.me/${customer.username}` });
  const admin = adminLink(adminPath);
  if (admin) row.push({ text: "🗂 Open in admin", url: admin });
  return row.length ? [row] : undefined;
}

// Telegram messages stop at 4,096 characters, so long orders list their first items and a count.
const MAX_ALERT_ITEMS = 12;
const MAX_ALERT_LENGTH = 3500;
const fit = (text) => (text.length > MAX_ALERT_LENGTH ? `${text.slice(0, MAX_ALERT_LENGTH).replace(/&[^;]*$/, "")}…` : text);

export function orderAlert(order) {
  const extra = order.items.length - MAX_ALERT_ITEMS;
  const lines = [
    `🛒 <b>New order ${h(order.number)}</b> · ${h(money(order.total, order.currency))}`,
    ...order.items.slice(0, MAX_ALERT_ITEMS).map((item) => `${item.qty} × ${h(item.name)}`),
    extra > 0 ? `…and ${extra} more item${extra === 1 ? "" : "s"}` : null,
    "",
    `👤 ${h(order.customer.name)} · ${h(order.customer.phone)}`,
    order.fulfilment === "delivery" ? `🚚 Delivery to ${h(order.address)}` : "🏁 Collection from the workshop",
    order.note ? `📝 ${h(order.note)}` : null
  ];
  return { text: fit(lines.filter((line) => line !== null).join("\n")), buttons: contactButtons(order.customer, `orders/${order.id}`) };
}

export function enquiryAlert(enquiry) {
  const { vehicle, customer } = enquiry;
  const ecu = ecuById(enquiry.ecu);
  const who = customer.name || (customer.username ? `@${customer.username}` : "Telegram customer");
  const lines = [
    `🏁 <b>New Stage ${vehicle?.stage ?? 1} enquiry</b> · ${enquiry.source === "telegram" ? "Telegram bot" : "website"}`,
    vehicle ? `🚗 ${h(vehicle.name)}${vehicle.years ? ` (${h(vehicle.years)})` : ""}${vehicle.source === "ai" ? " · AI estimate" : ""}` : null,
    vehicle?.target ? `⚡ ${vehicle.stock.hp} → ${vehicle.target.hp} hp · ${vehicle.stock.nm} → ${vehicle.target.nm} Nm` : null,
    ecu ? `🧾 ECU: ${h(ecu.id === "unknown" ? "Not sure" : ecu.title)}` : null,
    "",
    `👤 ${h(who)}${customer.phone ? ` · ${h(customer.phone)}` : ""}`,
    enquiry.location ? `📍 ${h(enquiry.location)}` : null,
    enquiry.message ? `📝 ${h(enquiry.message)}` : null,
    enquiry.referralCode ? `🎟 Referral code ${h(enquiry.referralCode)}` : null
  ];
  return { text: fit(lines.filter((line) => line !== null).join("\n")), buttons: contactButtons(customer, `enquiries/${enquiry.id}`) };
}

export function fileOrderAlert(order) {
  const customer = db().customers.find((entry) => entry.id === order.customerId) ?? { name: "Customer", phone: "" };
  const { vehicle } = order;
  const lines = [
    `📁 <b>New tuning file ${h(order.number)}</b> · ${creditText(order.credits)}`,
    `🚗 ${h([vehicle.make, vehicle.model, vehicle.generation, vehicle.engine].filter(Boolean).join(" "))}${[vehicle.year, FUELS[vehicle.fuel]].filter(Boolean).length ? ` (${[vehicle.year, FUELS[vehicle.fuel]].filter(Boolean).join(", ")})` : ""}`,
    `🧾 ${order.ecu ? `${h(order.ecu)} · ` : ""}${TOOLS[order.tool] ?? h(order.tool)} ${TOOL_MODES[order.toolMode] ?? ""} · ${READ_METHODS[order.readMethod] ?? ""} read`,
    `⚙️ ${order.options.map((option) => h(option.name)).join(", ")}`,
    order.timeFrame ? `⏱ ${TIME_FRAMES[order.timeFrame] ?? h(order.timeFrame)}${order.modifiedParts === "yes" ? " · modified parts" : ""}` : null,
    "",
    `👤 ${h(customer.name)}${customer.company ? ` · ${h(customer.company)}` : ""}${customer.phone ? ` · ${h(customer.phone)}` : ""}`,
    order.notes ? `📝 ${h(order.notes)}` : null
  ];
  return { text: fit(lines.filter((line) => line !== null).join("\n")), buttons: contactButtons(customer, `files/${order.id}`) };
}

export function paymentAlert(purchase) {
  const customer = db().customers.find((entry) => entry.id === purchase.customerId) ?? { name: "Customer", phone: "" };
  const lines = [
    `💳 <b>UPI payment to check ${h(purchase.number)}</b> · ${h(money(purchase.amount, purchase.currency))}`,
    `${h(purchase.packName)}: ${purchase.credits} credits`,
    `🔎 UTR ${h(purchase.utr)}`,
    "",
    `👤 ${h(customer.name)}${customer.phone ? ` · ${h(customer.phone)}` : ""}`,
    "Check it arrived in your bank or UPI app, then confirm it in the admin panel to add the credits."
  ];
  return { text: fit(lines.join("\n")), buttons: contactButtons(customer, `payments/${purchase.id}`) };
}

// Sends to every linked chat. One failing chat (e.g. the bot was blocked) doesn't stop the others.
export function franchiseAlert(lead) {
  const lines = [
    "🤝 <b>New franchise application</b> · website",
    `📍 ${h(lead.city)}`,
    lead.package ? `📦 ${h(lead.package.name)} · ₹${lead.package.price.toLocaleString("en-IN")}` : "📦 Package: not sure yet",
    lead.background ? `🔧 ${h(FRANCHISE_BACKGROUNDS[lead.background] ?? lead.background)}` : null,
    "",
    `👤 ${h(lead.name)} · ${h(lead.phone)}${lead.email ? ` · ${h(lead.email)}` : ""}`,
    lead.message ? `📝 ${h(lead.message)}` : null
  ];
  return { text: fit(lines.filter((line) => line !== null).join("\n")), buttons: contactButtons({ name: lead.name, phone: lead.phone }, `franchise/${lead.id}`) };
}

export function referrerAlert(referrer) {
  const lines = [
    "🎟 <b>New Refer &amp; earn sign-up</b>",
    `Code <b>${h(referrer.code)}</b>`,
    "",
    `👤 ${h(referrer.name)} · ${h(referrer.phone)}`,
    `📍 ${h(referrer.city)}`,
    referrer.upiId ? `💸 UPI ${h(referrer.upiId)}` : null
  ];
  return { text: fit(lines.filter((line) => line !== null).join("\n")), buttons: contactButtons({ name: referrer.name, phone: referrer.phone }, `referrers/${referrer.id}`) };
}

export function mechanicAlert(mechanic) {
  const lines = [
    "🔧 <b>New mechanic sign-up</b> · waiting for approval",
    `📍 ${h(mechanic.area)}, ${h(mechanic.city)}`,
    `🛠 ${h(mechanic.skills.map((skill) => MECHANIC_SKILLS[skill] ?? skill).join(", "))}`,
    `💰 ₹${mechanic.rate.toLocaleString("en-IN")} per session${mechanic.experience !== null ? ` · ${mechanic.experience} years` : ""}`,
    "",
    `👤 ${h(mechanic.name)} · ${h(mechanic.phone)}`,
    mechanic.message ? `📝 ${h(mechanic.message)}` : null
  ];
  return { text: fit(lines.filter((line) => line !== null).join("\n")), buttons: contactButtons({ name: mechanic.name, phone: mechanic.phone }, `mechanics/${mechanic.id}`) };
}

export async function broadcast({ text, buttons }, send = sendText) {
  let sent = 0;
  for (const chat of alertChats()) {
    try {
      await send(chat.chatId, text, buttons ? { buttons } : undefined);
      sent++;
    } catch (error) {
      console.error(`Alert to chat ${chat.chatId} failed:`, error.message);
    }
  }
  return sent;
}

// Runs an alert without letting a failure reach the customer: by now the order or enquiry is saved,
// and an error here would show them a failure page and invite a duplicate.
function safely(enabled, build, send) {
  return (record) => {
    try {
      if (enabled()) broadcast(build(record), send).catch((error) => console.error("Alert failed:", error.message));
    } catch (error) {
      console.error("Alert failed:", error.message);
    }
  };
}

// Subscribes to new orders, enquiries, file orders and UPI payments. Returns a function that stops the alerts.
export function startAlerts({ send = sendText } = {}) {
  const onOrder = safely(() => settings().alertOrders, orderAlert, send);
  const onEnquiry = safely(() => settings().alertEnquiries, enquiryAlert, send);
  const onFranchise = safely(() => settings().alertEnquiries, franchiseAlert, send);
  const onReferrer = safely(() => settings().alertEnquiries, referrerAlert, send);
  const onMechanic = safely(() => settings().alertEnquiries, mechanicAlert, send);
  const onFileOrder = safely(() => settings().alertFiles, fileOrderAlert, send);
  const onPayment = safely(() => settings().alertFiles, paymentAlert, send);
  events.on("order", onOrder);
  events.on("enquiry", onEnquiry);
  events.on("franchise", onFranchise);
  events.on("referrer", onReferrer);
  events.on("mechanic", onMechanic);
  events.on("fileOrder", onFileOrder);
  events.on("creditPayment", onPayment);
  return () => {
    events.off("order", onOrder);
    events.off("enquiry", onEnquiry);
    events.off("franchise", onFranchise);
    events.off("referrer", onReferrer);
    events.off("mechanic", onMechanic);
    events.off("fileOrder", onFileOrder);
    events.off("creditPayment", onPayment);
  };
}
