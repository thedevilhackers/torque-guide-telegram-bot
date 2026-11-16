import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "../db.js";
import { customerById } from "../file-service.js";
import { parseCookies } from "./auth.js";
import { isHttps } from "./http.js";

// Sign-ins for the tuning file service. Sessions last 30 days and are kept in DATA_DIR, so a server
// restart doesn't sign customers out. Only a hash of each token is stored.

const COOKIE = "up_customer";
const SESSION_MS = 30 * 24 * 60 * 60_000;
const FILE = join(DATA_DIR, "portal-sessions.json");
const hash = (token) => createHash("sha256").update(String(token)).digest("hex");

function load() {
  try {
    const stored = JSON.parse(readFileSync(FILE, "utf8"));
    return new Map(Object.entries(stored).filter(([, session]) => session?.expires > Date.now()));
  } catch {
    return new Map();
  }
}

const sessions = load();

function save() {
  for (const [key, session] of sessions) if (session.expires < Date.now()) sessions.delete(key);
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(`${FILE}.tmp`, JSON.stringify(Object.fromEntries(sessions)));
  renameSync(`${FILE}.tmp`, FILE);
}

// Lax, so the cookie comes along when a payment page sends the customer back here.
const cookie = (req, value, maxAgeSeconds) =>
  `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${isHttps(req) ? "; Secure" : ""}`;

export function startCustomerSession(req, res, customerId) {
  const token = randomBytes(32).toString("base64url");
  sessions.set(hash(token), { customerId, expires: Date.now() + SESSION_MS });
  save();
  res.setHeader("Set-Cookie", cookie(req, token, SESSION_MS / 1000));
}

export function endCustomerSession(req, res) {
  if (sessions.delete(hash(parseCookies(req.headers.cookie)[COOKIE]))) save();
  res.setHeader("Set-Cookie", cookie(req, "", 0));
}

// Signs a customer out everywhere except, optionally, the request they're using now.
export function endOtherSessions(customerId, req = null) {
  const keep = req ? hash(parseCookies(req.headers.cookie)[COOKIE]) : null;
  for (const [key, session] of sessions) if (session.customerId === customerId && key !== keep) sessions.delete(key);
  save();
}

// The signed-in customer, or null. A disabled account counts as signed out.
export function currentCustomer(req) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  const session = token && sessions.get(hash(token));
  if (!session || session.expires < Date.now()) return null;
  const customer = customerById(session.customerId);
  return customer?.active ? customer : null;
}
