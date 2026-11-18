import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { all, one, run } from "./db.js";
import { HttpError, forbidden, nowIso } from "./util.js";

const scrypt = promisify(scryptCb);
const SESSION_HOURS = 24;

export const ROLES = ["owner", "manager", "cashier"];

/** Permission → roles allowed. Branch scoping is enforced separately. */
export const PERMISSIONS = {
  "pos.sell": ["owner", "manager", "cashier"],
  "pos.discount_unlimited": ["owner", "manager"],
  "pos.price_override": ["owner", "manager"],
  "pos.sell_expired": ["owner", "manager"],
  "sales.view": ["owner", "manager", "cashier"],
  "sales.refund": ["owner", "manager"],
  "stock.view": ["owner", "manager", "cashier"],
  "stock.receive": ["owner", "manager", "cashier"],
  "stock.adjust": ["owner", "manager"],
  "stock.count": ["owner", "manager"],
  "stock.transfer": ["owner", "manager"],
  "catalog.edit": ["owner", "manager"],
  "customers.edit": ["owner", "manager", "cashier"],
  "promotions.edit": ["owner", "manager"],
  "shifts.use": ["owner", "manager", "cashier"],
  "shifts.manage": ["owner", "manager"],
  "reports.view": ["owner", "manager"],
  "users.manage": ["owner", "manager"],
  "branches.manage": ["owner"],
  "settings.manage": ["owner"],
  "integrations.manage": ["owner"]
};

export function can(principal, permission) {
  return Boolean(principal && PERMISSIONS[permission]?.includes(principal.role));
}

export function permissionsFor(role) {
  return Object.keys(PERMISSIONS).filter((p) => PERMISSIONS[p].includes(role));
}

export function requirePermission(principal, permission) {
  if (!can(principal, permission)) throw forbidden();
}

// ---- secrets ---------------------------------------------------------------

export async function hashSecret(secret) {
  const salt = randomBytes(16);
  const hash = await scrypt(String(secret), salt, 32);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function verifySecret(secret, stored) {
  if (!stored || typeof stored !== "string") return false;
  const [scheme, saltB64, hashB64] = stored.split("$");
  if (scheme !== "scrypt" || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64");
  const actual = await scrypt(String(secret), Buffer.from(saltB64, "base64"), expected.length);
  return timingSafeEqual(expected, actual);
}

const sha256 = (text) => createHash("sha256").update(text).digest("hex");

// ---- login throttling ---------------------------------------------------------

const failures = new Map();
const MAX_FAILURES = 5;
const LOCK_MS = 60_000;

export function assertNotThrottled(key) {
  const entry = failures.get(key);
  if (entry && entry.count >= MAX_FAILURES && Date.now() - entry.at < LOCK_MS) {
    throw new HttpError(429, "Too many failed attempts. Wait a minute and try again.", "THROTTLED");
  }
}

export function recordFailure(key) {
  const entry = failures.get(key);
  if (entry && Date.now() - entry.at > LOCK_MS) failures.delete(key);
  const next = failures.get(key) ?? { count: 0, at: Date.now() };
  next.count += 1;
  next.at = Date.now();
  failures.set(key, next);
}

export function clearFailures(key) {
  failures.delete(key);
}

// ---- sessions ---------------------------------------------------------------

export function createSession(db, userId) {
  const token = `st_${randomBytes(32).toString("base64url")}`;
  const expires = new Date(Date.now() + SESSION_HOURS * 3600_000).toISOString();
  run(db, "INSERT INTO sessions(token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)", sha256(token), userId, nowIso(), expires);
  return { token, expires_at: expires };
}

export function destroySession(db, token) {
  run(db, "DELETE FROM sessions WHERE token_hash = ?", sha256(token));
}

export function purgeExpiredSessions(db) {
  run(db, "DELETE FROM sessions WHERE expires_at < ?", nowIso());
}

export function createApiKey(db, { name, branchId = null }) {
  const key = `sk_${randomBytes(30).toString("base64url")}`;
  const prefix = key.slice(0, 10);
  const { id } = run(
    db,
    "INSERT INTO api_keys(name, prefix, key_hash, branch_id, created_at) VALUES (?, ?, ?, ?, ?)",
    name,
    prefix,
    sha256(key),
    branchId,
    nowIso()
  );
  return { id, key, prefix };
}

/** Resolves a bearer token (session or API key) to a principal, or null. */
export function resolveToken(db, token) {
  if (!token) return null;
  if (token.startsWith("st_")) {
    const row = one(
      db,
      `SELECT u.id, u.name, u.username, u.role, u.branch_id, u.active, s.expires_at
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ?`,
      sha256(token)
    );
    if (!row || !row.active || row.expires_at < nowIso()) return null;
    return {
      kind: "user",
      userId: row.id,
      name: row.name,
      username: row.username,
      role: row.role,
      branchId: row.role === "owner" ? null : row.branch_id
    };
  }
  if (token.startsWith("sk_")) {
    const row = one(db, "SELECT id, name, branch_id, active, last_used_at FROM api_keys WHERE key_hash = ?", sha256(token));
    if (!row || !row.active) return null;
    // Avoid a write on every request: refresh last_used_at at most once per minute.
    if (!row.last_used_at || Date.now() - Date.parse(row.last_used_at) > 60_000) {
      run(db, "UPDATE api_keys SET last_used_at = ? WHERE id = ?", nowIso(), row.id);
    }
    return {
      kind: "api",
      apiKeyId: row.id,
      userId: null,
      name: `API: ${row.name}`,
      role: row.branch_id ? "manager" : "owner",
      branchId: row.branch_id ?? null
    };
  }
  return null;
}

/**
 * Verifies a manager/owner PIN typed at the till to approve a restricted action
 * (refund, large discount, price override, selling expired stock).
 */
export async function approveWithPin(db, { branchId, pin, permission }) {
  if (!pin) return null;
  const throttleKey = `override:${branchId}`;
  assertNotThrottled(throttleKey);
  const roles = PERMISSIONS[permission] ?? [];
  const candidates = all(
    db,
    `SELECT id, name, role, pin_hash FROM users
      WHERE active = 1 AND pin_hash IS NOT NULL AND (role = 'owner' OR branch_id = ?)`,
    branchId
  ).filter((u) => roles.includes(u.role));
  for (const user of candidates) {
    if (await verifySecret(pin, user.pin_hash)) {
      clearFailures(throttleKey);
      return { id: user.id, name: user.name, role: user.role };
    }
  }
  recordFailure(throttleKey);
  throw forbidden("Manager PIN not accepted", "OVERRIDE_REJECTED");
}

/**
 * Passes when the principal holds the permission, or when a valid manager PIN is supplied.
 * Returns the approving user (or null when the principal itself is allowed).
 */
export async function requireOrOverride(db, principal, permission, { branchId, pin, message }) {
  if (can(principal, permission)) return null;
  if (!pin) throw forbidden(message ?? "Manager approval required", "APPROVAL_REQUIRED");
  return approveWithPin(db, { branchId, pin, permission });
}
