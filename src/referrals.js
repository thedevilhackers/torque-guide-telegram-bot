import { randomInt, randomUUID } from "node:crypto";
import { db, settings, transact } from "./db.js";
import { events } from "./events.js";
import { InputError } from "./records.js";

// Refer & earn: anyone can sign up for a code (/refer). A customer who books with the code gets the
// discount, and the code's owner earns the reward once the owner confirms the tune was done (Admin →
// Referrals). Rewards are paid by hand (UPI), then marked paid. Each referral keeps the amounts that
// applied when it was made, so changing the rates later doesn't rewrite what's owed.

export const REFERRAL_STATUSES = ["pending", "confirmed", "paid", "rejected"];
export const REFERRER_STATUSES = ["active", "paused"];

const clean = (value, max) => String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
const digitsOf = (value) => String(value ?? "").replace(/\D/g, "");
// The last 10 digits, so "+91 98765 43210" and "9876543210" are the same number.
const phoneKey = (value) => digitsOf(value).slice(-10);

export const normaliseCode = (value) => String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);

function phoneNumber(value) {
  const phone = clean(value, 30);
  if (!/^\+?[\d\s().-]+$/.test(phone) || digitsOf(phone).length < 6) throw new InputError("Please enter a valid phone number.");
  return phone;
}

// RAVI482: up to six letters of the name and three digits.
function newCode(name, taken) {
  const letters = name.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 6) || "UNITY";
  for (let attempt = 0; ; attempt++) {
    const code = `${letters}${randomInt(attempt < 50 ? 100 : 1000, attempt < 50 ? 1000 : 10000)}`;
    if (!taken.has(code)) return code;
  }
}

export function registerReferrer(input) {
  if (!settings().referralOpen) throw new InputError("Refer & earn is paused right now. Please message us on WhatsApp.");
  const name = clean(input?.name, 80);
  if (name.length < 2) throw new InputError("Your name is required.");
  const phone = phoneNumber(input?.phone);
  const city = clean(input?.city, 80);
  if (city.length < 2) throw new InputError("Your city is required.");
  const upiId = clean(input?.upiId, 60);
  if (upiId && !/^[\w.-]{2,}@[A-Za-z]{2,}$/.test(upiId)) throw new InputError("That UPI ID doesn't look right. It's like name@okaxis.");
  let existing = false;
  const referrer = transact((data) => {
    const same = data.referrers.find((entry) => phoneKey(entry.phone) === phoneKey(phone));
    if (same) {
      existing = true;
      return same;
    }
    const now = new Date().toISOString();
    const entry = { id: randomUUID(), code: newCode(name, new Set(data.referrers.map((item) => item.code))), name, phone, city, upiId, status: "active", notes: "", createdAt: now, updatedAt: now };
    data.referrers.unshift(entry);
    return entry;
  });
  if (!existing) events.emit("referrer", referrer);
  return { referrer, existing };
}

export const findReferrer = (code) => db().referrers.find((entry) => entry.code === normaliseCode(code) && entry.status === "active");

// Totals for one code owner: owed (confirmed, not yet paid) and paid, in rupees.
export function referrerSummary(referrer, referrals = db().referrals) {
  const mine = referrals.filter((entry) => entry.referrerId === referrer.id);
  const total = (status) => mine.filter((entry) => entry.status === status).reduce((sum, entry) => sum + entry.reward, 0);
  return {
    referred: mine.length,
    pending: mine.filter((entry) => entry.status === "pending").length,
    confirmed: mine.filter((entry) => entry.status === "confirmed").length,
    owed: total("confirmed"),
    paid: total("paid")
  };
}

// The code owner checks their earnings with their code and phone number.
export function referrerStatus(input) {
  const referrer = db().referrers.find((entry) => entry.code === normaliseCode(input?.code));
  if (!referrer || phoneKey(referrer.phone) !== phoneKey(input?.phone) || digitsOf(input?.phone).length < 6) throw new InputError("We couldn't find that code with that phone number.");
  return { name: referrer.name, code: referrer.code, active: referrer.status === "active", ...referrerSummary(referrer) };
}

// Called by createEnquiry before saving: the referral for that code, or null without one. A code
// owner can't use their own code.
export function referralFor(code, customer) {
  if (!normaliseCode(code)) return null;
  const referrer = findReferrer(code);
  if (!referrer) throw new InputError("That referral code isn't valid. Check it, or leave it empty.");
  if (phoneKey(referrer.phone) === phoneKey(customer.phone)) throw new InputError("You can't use your own referral code.");
  const { referralReward, referralDiscount } = settings();
  const now = new Date().toISOString();
  return { id: randomUUID(), code: referrer.code, referrerId: referrer.id, referrerName: referrer.name, customer: { name: customer.name, phone: customer.phone }, vehicle: "", enquiryId: "", status: "pending", reward: referralReward, discount: referralDiscount, notes: "", createdAt: now, updatedAt: now };
}
