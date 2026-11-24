import { randomUUID } from "node:crypto";
import { db, settings, transact } from "./db.js";
import { events } from "./events.js";
import { InputError } from "./records.js";

// Franchise: the packages shown on /franchise (edited in Admin → Franchise packages) and the
// applications people send from it (Admin → Franchise). An application is saved, alerted on
// Telegram like an enquiry, and handed to WhatsApp with the details written out.

export const FRANCHISE_STATUSES = ["new", "contacted", "meeting", "signed", "closed"];

// What the applicant does today, so the first call can start in the right place.
export const FRANCHISE_BACKGROUNDS = {
  workshop: "I run a car workshop or garage",
  detailing: "I run a detailing or coating studio",
  tuner: "I already do tuning",
  new: "I'm new to the trade",
  other: "Something else"
};

const clean = (value, max) => String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);

export const activePackages = () => db().franchisePackages.filter((entry) => entry.active);

// ₹9,99,000 → "₹9.99 lakh"; smaller amounts in full, Indian style.
export function rupees(amount) {
  if (amount >= 100_000) return `₹${Number((amount / 100_000).toFixed(2))} lakh`;
  return `₹${Number(amount).toLocaleString("en-IN")}`;
}

export function createFranchiseLead(input) {
  if (!settings().franchiseOpen) throw new InputError("We're not taking franchise applications right now. Please message us on WhatsApp.");
  const name = clean(input?.name, 80);
  if (name.length < 2) throw new InputError("Your name is required.");
  const phone = clean(input?.phone, 30);
  if (!/^\+?[\d\s().-]+$/.test(phone) || phone.replace(/\D/g, "").length < 6) throw new InputError("Please enter a valid phone number.");
  const email = clean(input?.email, 120);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new InputError("Please enter a valid email address.");
  const city = clean(input?.city, 80);
  if (city.length < 2) throw new InputError("Your city is required.");
  const background = clean(input?.background, 20);
  if (background && !FRANCHISE_BACKGROUNDS[background]) throw new InputError("Please choose what you do today again.");
  const packageId = clean(input?.packageId, 60);
  const chosen = packageId ? activePackages().find((entry) => entry.id === packageId) : null;
  if (packageId && !chosen) throw new InputError("That package isn't offered any more. Please choose again.");
  const now = new Date().toISOString();
  const lead = {
    id: randomUUID(),
    createdAt: now,
    updatedAt: now,
    status: "new",
    name,
    phone,
    email,
    city,
    background,
    // The package as it was when they applied, so later price changes don't rewrite the application.
    package: chosen ? { id: chosen.id, name: chosen.name, price: chosen.price } : null,
    message: clean(input?.message, 1000),
    notes: ""
  };
  transact((data) => data.franchiseLeads.unshift(lead));
  events.emit("franchise", lead);
  return lead;
}

export function franchiseText(lead, businessName) {
  return [
    `Hello ${businessName}, I'd like to open a Unity Performance franchise.`,
    "",
    `Name: ${lead.name}`,
    `Phone: ${lead.phone}`,
    lead.email ? `Email: ${lead.email}` : null,
    `City: ${lead.city}`,
    lead.package ? `Package: ${lead.package.name} (${rupees(lead.package.price)})` : "Package: not sure yet",
    lead.background ? `Today: ${FRANCHISE_BACKGROUNDS[lead.background]}` : null,
    lead.message ? `Message: ${lead.message}` : null
  ]
    .filter((line) => line !== null)
    .join("\n");
}
