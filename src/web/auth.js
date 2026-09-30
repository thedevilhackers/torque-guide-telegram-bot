import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { MIN_ADMIN_PASSWORD_LENGTH, config } from "../config.js";
import { isHttps } from "./http.js";

// Single admin account from ADMIN_USERNAME / ADMIN_PASSWORD with full access. Sessions live in
// memory, so a restart signs the admin out.

const COOKIE = "up_admin";
const SESSION_MS = 12 * 60 * 60 * 1000;
const salt = randomBytes(16);
const hash = (value) => scryptSync(String(value ?? ""), salt, 32);

const expected =
  config.adminPassword.length >= MIN_ADMIN_PASSWORD_LENGTH ? { username: hash(config.adminUsername), password: hash(config.adminPassword) } : null;
const sessions = new Map();

export const adminEnabled = () => Boolean(expected);

// Both values are always hashed and compared, so timing doesn't reveal which one was wrong.
export function checkCredentials(username, password) {
  if (!expected) return false;
  const usernameMatches = timingSafeEqual(hash(username), expected.username);
  const passwordMatches = timingSafeEqual(hash(password), expected.password);
  return usernameMatches && passwordMatches;
}

function parseCookies(header = "") {
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

export function startSession(req, res) {
  const token = randomBytes(32).toString("base64url");
  sessions.set(token, { username: config.adminUsername, expires: Date.now() + SESSION_MS });
  res.setHeader("Set-Cookie", cookie(req, token, SESSION_MS / 1000));
}

export function endSession(req, res) {
  sessions.delete(parseCookies(req.headers.cookie)[COOKIE]);
  res.setHeader("Set-Cookie", cookie(req, "", 0));
}

// Returns the signed-in admin, extending the session, or null.
export function currentAdmin(req) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  const session = token && sessions.get(token);
  if (!session) return null;
  if (session.expires < Date.now()) {
    sessions.delete(token);
    return null;
  }
  session.expires = Date.now() + SESSION_MS;
  return { username: session.username };
}
