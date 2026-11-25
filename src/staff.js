import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { config } from "./config.js";
import { db, transact } from "./db.js";
import { InputError } from "./records.js";

// Staff logins for the admin panel. The owner signs in with ADMIN_USERNAME / ADMIN_PASSWORD from the
// server and can do everything; staff accounts are added by the owner in Admin → Staff:
//   manager: everything except staff, settings and backups;
//   staff:   sees everything except those, and updates orders, enquiries, franchise applications
//            and file orders (status, notes, tuned files); can't delete or edit the catalogue.

export const STAFF_ROLES = ["manager", "staff"];
export const ROLE_RANK = { staff: 1, manager: 2, owner: 3 };
export const MIN_STAFF_PASSWORD = 10;

const USERNAME = /^[a-z0-9][a-z0-9._-]{2,29}$/;
const clean = (value, max) => String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);

export function hashPassword(password) {
  const salt = randomBytes(16);
  return { salt: salt.toString("hex"), hash: scryptSync(String(password), salt, 32).toString("hex") };
}

function matches(stored, password) {
  const expected = Buffer.from(stored.hash, "hex");
  const actual = scryptSync(String(password ?? ""), Buffer.from(stored.salt, "hex"), 32);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

// A dummy check when no account matches, so a wrong username takes as long as a wrong password.
const DUMMY = hashPassword(randomBytes(12).toString("hex"));

export const staffView = ({ password, ...member }) => member;
export const isRole = (user, minimum) => (ROLE_RANK[user?.role] ?? 0) >= ROLE_RANK[minimum];

function checkPassword(password) {
  const value = String(password ?? "");
  if (value.length < MIN_STAFF_PASSWORD) throw new InputError(`The password must be at least ${MIN_STAFF_PASSWORD} characters.`);
  if (value.length > 200) throw new InputError("That password is too long.");
  return value;
}

export function findStaffLogin(username, password) {
  const member = db().staff.find((entry) => entry.username === String(username ?? "").trim().toLowerCase() && entry.active);
  if (!member) {
    matches(DUMMY, password);
    return null;
  }
  return matches(member.password, password) ? member : null;
}

export function createStaff(input) {
  const username = String(input?.username ?? "").trim().toLowerCase();
  if (!USERNAME.test(username)) throw new InputError("Username: 3 to 30 lowercase letters, numbers, dots, dashes or underscores.");
  if (username === config.adminUsername.toLowerCase()) throw new InputError("That username is the owner's. Choose another.");
  const name = clean(input?.name, 60);
  if (name.length < 2) throw new InputError("Enter the person's name.");
  const role = STAFF_ROLES.includes(input?.role) ? input.role : "staff";
  const password = hashPassword(checkPassword(input?.password));
  return transact((data) => {
    if (data.staff.some((entry) => entry.username === username)) throw new InputError("That username is taken.");
    const now = new Date().toISOString();
    const member = { id: randomUUID(), username, name, role, active: true, password, lastSignIn: null, createdAt: now, updatedAt: now };
    data.staff.push(member);
    return staffView(member);
  });
}

export function updateStaff(id, input) {
  return transact((data) => {
    const member = data.staff.find((entry) => entry.id === id);
    if (!member) throw new InputError("Staff member not found.");
    if (input?.name !== undefined) {
      const name = clean(input.name, 60);
      if (name.length < 2) throw new InputError("Enter the person's name.");
      member.name = name;
    }
    if (input?.role !== undefined) {
      if (!STAFF_ROLES.includes(input.role)) throw new InputError("Unknown role.");
      member.role = input.role;
    }
    if (input?.active !== undefined) member.active = input.active === true || input.active === "true";
    if (input?.password) member.password = hashPassword(checkPassword(input.password));
    member.updatedAt = new Date().toISOString();
    return staffView(member);
  });
}

export function removeStaff(id) {
  return transact((data) => {
    const index = data.staff.findIndex((entry) => entry.id === id);
    if (index < 0) throw new InputError("Staff member not found.");
    const [member] = data.staff.splice(index, 1);
    return staffView(member);
  });
}

export function changeOwnPassword(id, current, next) {
  return transact((data) => {
    const member = data.staff.find((entry) => entry.id === id);
    if (!member) throw new InputError("Only staff accounts can change their password here.");
    if (!matches(member.password, current)) throw new InputError("Your current password is wrong.");
    member.password = hashPassword(checkPassword(next));
    member.updatedAt = new Date().toISOString();
    return staffView(member);
  });
}

export function noteSignIn(id) {
  transact((data) => {
    const member = data.staff.find((entry) => entry.id === id);
    if (member) member.lastSignIn = new Date().toISOString();
  });
}
