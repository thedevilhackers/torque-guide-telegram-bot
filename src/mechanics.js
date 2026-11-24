import { randomUUID } from "node:crypto";
import { db, settings, transact } from "./db.js";
import { events } from "./events.js";
import { InputError } from "./records.js";

// Mechanic network (/mechanics): mechanics sign up with their area, skills and price per session;
// once approved in Admin → Mechanics they're listed on the page, and customers book them through the
// workshop on WhatsApp (their numbers aren't shown publicly).

export const MECHANIC_STATUSES = ["pending", "approved", "hidden"];

export const MECHANIC_SKILLS = {
  service: "General service",
  electrical: "Electrical & scanning",
  ac: "AC repair",
  body: "Denting & painting",
  detailing: "Washing & detailing",
  tyres: "Tyres & wheels",
  roadside: "Breakdown & roadside help",
  tuning: "Tuning & ECU fitting"
};

export const MECHANIC_AVAILABILITY = { full: "Full time", part: "Part time", weekends: "Weekends only" };

const clean = (value, max) => String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
const digitsOf = (value) => String(value ?? "").replace(/\D/g, "");

export function registerMechanic(input) {
  if (!settings().mechanicsOpen) throw new InputError("We're not adding mechanics right now. Please message us on WhatsApp.");
  const name = clean(input?.name, 80);
  if (name.length < 2) throw new InputError("Your name is required.");
  const phone = clean(input?.phone, 30);
  if (!/^\+?[\d\s().-]+$/.test(phone) || digitsOf(phone).length < 6) throw new InputError("Please enter a valid phone number.");
  const city = clean(input?.city, 60);
  if (city.length < 2) throw new InputError("Your city is required.");
  const area = clean(input?.area, 80);
  if (area.length < 2) throw new InputError("Your area is required.");
  const skills = [...new Set((Array.isArray(input?.skills) ? input.skills : [input?.skills]).map(String))].filter((skill) => Object.hasOwn(MECHANIC_SKILLS, skill));
  if (!skills.length) throw new InputError("Choose at least one kind of work.");
  const rate = String(input?.rate ?? "").trim() === "" ? NaN : Number(input.rate);
  if (!Number.isFinite(rate) || rate < 0 || rate > 100000) throw new InputError("Enter your price per session in rupees.");
  const experience = input?.experience === "" || input?.experience === undefined ? null : Number(input.experience);
  if (experience !== null && (!Number.isInteger(experience) || experience < 0 || experience > 60)) throw new InputError("Years of experience must be a whole number.");
  const availability = Object.hasOwn(MECHANIC_AVAILABILITY, String(input?.availability)) ? String(input.availability) : "full";
  const now = new Date().toISOString();
  const mechanic = transact((data) => {
    if (data.mechanics.some((entry) => digitsOf(entry.phone).slice(-10) === digitsOf(phone).slice(-10))) throw new InputError("This number is already registered. Message us on WhatsApp to change your details.");
    const entry = { id: randomUUID(), name, phone, city, area, skills, rate: Math.round(rate), experience, availability, message: clean(input?.message, 600), status: "pending", notes: "", createdAt: now, updatedAt: now };
    data.mechanics.unshift(entry);
    return entry;
  });
  events.emit("mechanic", mechanic);
  return mechanic;
}

// "Ravi Kumar Singh" → "Ravi S.": enough to choose by, without publishing the full name.
const shortName = (name) => {
  const [first, ...rest] = name.split(" ");
  return rest.length ? `${first} ${rest.at(-1)[0].toUpperCase()}.` : first;
};

export function publicMechanics() {
  return db()
    .mechanics.filter((entry) => entry.status === "approved")
    .map(({ id, name, city, area, skills, rate, experience, availability }) => ({ id, name: shortName(name), city, area, skills, rate, experience, availability }));
}
