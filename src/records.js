import { randomUUID } from "node:crypto";
import { ecuById } from "./catalog.js";
import { transact } from "./db.js";
import { getVehicle, vehicleName } from "./vehicles.js";
import { locationText } from "./whatsapp.js";

// Orders from the shop and Stage 1 enquiries from the website and the Telegram bot.

export class InputError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

export const ORDER_STATUSES = ["new", "confirmed", "ready", "completed", "cancelled"];
export const ENQUIRY_STATUSES = ["new", "contacted", "booked", "closed"];

const clean = (value, max) => String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
const money = (value) => Math.round(value * 100) / 100;

function required(value, label, { min = 1, max = 120 } = {}) {
  const text = clean(value, max);
  if (text.length < min) throw new InputError(`${label} is required.`);
  return text;
}

function phoneNumber(value) {
  const phone = clean(value, 30);
  if (!/^\+?[\d\s().-]+$/.test(phone) || phone.replace(/\D/g, "").length < 6) throw new InputError("Please enter a valid phone number.");
  return phone;
}

function emailAddress(value) {
  const email = clean(value, 120);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new InputError("Please enter a valid email address.");
  return email;
}

export function vehicleSnapshot(vehicle) {
  if (!vehicle) return null;
  return {
    id: vehicle.id,
    source: vehicle.source,
    name: vehicleName(vehicle),
    years: vehicle.years ?? "",
    engine: vehicle.engine ?? "",
    fuel: vehicle.fuel ?? "",
    ...(vehicle.tunable && { stock: vehicle.stock, stage1: vehicle.stage1 })
  };
}

// Prices and stock always come from the database, never from the customer's browser.
export function createOrder(input) {
  const customer = { name: required(input?.customer?.name, "Your name", { min: 2, max: 80 }), phone: phoneNumber(input?.customer?.phone), email: emailAddress(input?.customer?.email) };
  const fulfilment = input?.fulfilment === "delivery" ? "delivery" : "pickup";
  const address = fulfilment === "delivery" ? required(input?.address, "A delivery address", { min: 5, max: 240 }) : "";
  const note = clean(input?.note, 500);
  const requested = new Map();
  for (const item of Array.isArray(input?.items) ? input.items : []) {
    const qty = Number(item?.qty);
    if (typeof item?.id !== "string" || !Number.isInteger(qty) || qty < 1 || qty > 20) throw new InputError("Your bag has an invalid item.");
    requested.set(item.id, (requested.get(item.id) ?? 0) + qty);
  }
  if (!requested.size) throw new InputError("Your bag is empty.");
  if (requested.size > 30) throw new InputError("Your bag has too many different items.");

  return transact((data) => {
    const items = [...requested].map(([id, qty]) => {
      const product = data.products.find((candidate) => candidate.id === id && candidate.active);
      if (!product) throw new InputError("An item in your bag is no longer available. Please remove it and try again.");
      if (product.stock !== null && product.stock < qty) {
        throw new InputError(product.stock > 0 ? `Only ${product.stock} left of ${product.name}.` : `${product.name} is sold out.`);
      }
      if (product.stock !== null) product.stock -= qty;
      return { productId: id, name: product.name, price: product.price, qty, lineTotal: money(product.price * qty) };
    });
    const subtotal = money(items.reduce((sum, item) => sum + item.lineTotal, 0));
    const deliveryFee = fulfilment === "delivery" ? money(Number(data.settings.deliveryFee) || 0) : 0;
    const now = new Date().toISOString();
    const order = {
      id: randomUUID(),
      number: `UP-${data.nextOrderNumber++}`,
      createdAt: now,
      updatedAt: now,
      status: "new",
      customer,
      fulfilment,
      address,
      note,
      items,
      subtotal,
      deliveryFee,
      total: money(subtotal + deliveryFee),
      currency: data.settings.currency || "USD",
      adminNotes: ""
    };
    data.orders.unshift(order);
    return order;
  });
}

export function formatMoney(amount, currency) {
  return `${currency} ${Number(amount).toFixed(2)}`;
}

export function orderText(order, businessName) {
  const lines = [`Hello ${businessName}, I've placed order ${order.number}:`, ""];
  for (const item of order.items) lines.push(`${item.qty} × ${item.name}: ${formatMoney(item.lineTotal, order.currency)}`);
  if (order.deliveryFee) lines.push(`Delivery: ${formatMoney(order.deliveryFee, order.currency)}`);
  lines.push(`Total: ${formatMoney(order.total, order.currency)}`, "", `Name: ${order.customer.name}`, `Phone: ${order.customer.phone}`);
  lines.push(order.fulfilment === "delivery" ? `Delivery to: ${order.address}` : "Collection from the workshop");
  if (order.note) lines.push(`Note: ${order.note}`);
  return lines.join("\n");
}

export function createEnquiry(input) {
  const name = required(input?.name, "Your name", { min: 2, max: 80 });
  const phone = phoneNumber(input?.phone);
  const vehicle = input?.vehicleId ? getVehicle(String(input.vehicleId)) : null;
  if (input?.vehicleId && !vehicle) throw new InputError("Please choose your vehicle again.");
  const ecu = input?.ecu ? ecuById(String(input.ecu)) : null;
  if (input?.ecu && !ecu) throw new InputError("Please choose your ECU again.");
  // Vehicles found by AI search aren't in the database, so the website sends their name instead.
  const vehicleText = clean(input?.vehicleText, 120);
  const now = new Date().toISOString();
  const enquiry = {
    id: randomUUID(),
    createdAt: now,
    updatedAt: now,
    status: "new",
    source: "website",
    customer: { name, phone },
    vehicle: vehicle ? vehicleSnapshot(vehicle) : vehicleText ? { id: "", source: "ai", name: vehicleText } : null,
    ecu: ecu?.id ?? "",
    location: clean(input?.location, 120),
    message: clean(input?.message, 600),
    notes: ""
  };
  transact((data) => data.enquiries.unshift(enquiry));
  return { enquiry, vehicle };
}

// Called when a Telegram customer reaches the summary. Revisiting it within a day updates the
// same enquiry instead of creating duplicates.
export function recordTelegramEnquiry(chatId, session) {
  const customer = { name: session.customer?.name ?? "", username: session.customer?.username ?? "", chatId: String(chatId) };
  const vehicle = vehicleSnapshot(session.vehicle);
  const location = session.location ? locationText(session.location) : "";
  const now = new Date().toISOString();
  return transact((data) => {
    const dayAgo = Date.now() - 86_400_000;
    const existing = data.enquiries.find(
      (enquiry) => enquiry.source === "telegram" && enquiry.customer?.chatId === customer.chatId && enquiry.vehicle?.name === vehicle?.name && Date.parse(enquiry.createdAt) > dayAgo
    );
    if (existing) {
      Object.assign(existing, { customer, ecu: session.ecu ?? "", location, updatedAt: now });
      return existing;
    }
    const enquiry = { id: randomUUID(), createdAt: now, updatedAt: now, status: "new", source: "telegram", customer, vehicle, ecu: session.ecu ?? "", location, message: "", notes: "" };
    data.enquiries.unshift(enquiry);
    return enquiry;
  });
}
