import { randomInt } from "node:crypto";
import { ecuById } from "./catalog.js";
import { db, settings, transact } from "./db.js";
import { events } from "./events.js";
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

export function orderAlert(order) {
  const lines = [
    `🛒 <b>New order ${h(order.number)}</b> · ${h(money(order.total, order.currency))}`,
    ...order.items.map((item) => `${item.qty} × ${h(item.name)}`),
    "",
    `👤 ${h(order.customer.name)} · ${h(order.customer.phone)}`,
    order.fulfilment === "delivery" ? `🚚 Delivery to ${h(order.address)}` : "🏁 Collection from the workshop",
    order.note ? `📝 ${h(order.note)}` : null
  ];
  return { text: lines.filter((line) => line !== null).join("\n"), buttons: contactButtons(order.customer, `orders/${order.id}`) };
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
    enquiry.message ? `📝 ${h(enquiry.message)}` : null
  ];
  return { text: lines.filter((line) => line !== null).join("\n"), buttons: contactButtons(customer, `enquiries/${enquiry.id}`) };
}

// Sends to every linked chat. One failing chat (e.g. the bot was blocked) doesn't stop the others.
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

// Subscribes to new orders and enquiries. Returns a function that stops the alerts.
export function startAlerts({ send = sendText } = {}) {
  const onOrder = (order) => settings().alertOrders && broadcast(orderAlert(order), send);
  const onEnquiry = (enquiry) => settings().alertEnquiries && broadcast(enquiryAlert(enquiry), send);
  events.on("order", onOrder);
  events.on("enquiry", onEnquiry);
  return () => {
    events.off("order", onOrder);
    events.off("enquiry", onEnquiry);
  };
}
