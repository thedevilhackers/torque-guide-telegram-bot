import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { MIN_ADMIN_PASSWORD_LENGTH, config } from "../config.js";
import { db } from "../db.js";
import { findStaffLogin } from "../staff.js";
import { isHttps } from "./http.js";

// The owner account from ADMIN_USERNAME / ADMIN_PASSWORD has full access; staff accounts (Admin →
// Staff) have a role. Sessions live in memory, so a restart signs everyone out. A staff member's role
// and active flag are read on every request, so changes apply at once.

const COOKIE = "up_admin";
const SESSION_MS = 12 * 60 * 60 * 1000;
const salt = randomBytes(16);
const hash = (value) => scryptSync(String(value ?? ""), salt, 32);

const expected =
  config.adminPassword.length >= MIN_ADMIN_PASSWORD_LENGTH ? { username: hash(config.adminUsername), password: hash(config.adminPassword) } : null;
const sessions = new Map();

export const adminEnabled = () => Boolean(expected);

const OWNER = () => ({ id: "owner", username: config.adminUsername, name: "Owner", role: "owner" });

// The signed-in user for these credentials, or null. The owner's values are always hashed and
// compared, so timing doesn't reveal which one was wrong; staff accounts are checked after.
export function checkCredentials(username, password) {
  if (!expected) return null;
  const usernameMatches = timingSafeEqual(hash(username), expected.username);
  const passwordMatches = timingSafeEqual(hash(password), expected.password);
  if (usernameMatches && passwordMatches) return OWNER();
  const member = findStaffLogin(username, password);
  return member ? { id: member.id, username: member.username, name: member.name, role: member.role } : null;
}

export function parseCookies(header = "") {
  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim().split("="))
      .filter(([name, value]) => name && value)
      .map(([name, value]) => {
        try {
          return [name, decodeURIComponent(value)];
        } catch {
          return [name, ""];
        }
      })
  );
}

const cookie = (req, value, maxAgeSeconds) =>
  `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}${isHttps(req) ? "; Secure" : ""}`;

export function startSession(req, res, user = OWNER()) {
  const now = Date.now();
  for (const [token, session] of sessions) if (session.expires < now) sessions.delete(token);
  const token = randomBytes(32).toString("base64url");
  sessions.set(token, { userId: user.id, expires: Date.now() + SESSION_MS });
  res.setHeader("Set-Cookie", cookie(req, token, SESSION_MS / 1000));
}

export function endSession(req, res) {
  sessions.delete(parseCookies(req.headers.cookie)[COOKIE]);
  res.setHeader("Set-Cookie", cookie(req, "", 0));
}

// Signs a staff member out everywhere (after a password reset, or when they're removed).
export function endSessionsFor(userId) {
  for (const [token, session] of sessions) if (session.userId === userId) sessions.delete(token);
}

// Returns the signed-in user ({ id, username, name, role }), extending the session, or null.
export function currentAdmin(req) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  const session = token && sessions.get(token);
  if (!session) return null;
  if (session.expires < Date.now()) {
    sessions.delete(token);
    return null;
  }
  let user = OWNER();
  if (session.userId !== "owner") {
    const member = db().staff.find((entry) => entry.id === session.userId);
    if (!member?.active) {
      sessions.delete(token);
      return null;
    }
    user = { id: member.id, username: member.username, name: member.name, role: member.role };
  }
  session.expires = Date.now() + SESSION_MS;
  return user;
}
