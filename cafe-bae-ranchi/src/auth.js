import crypto from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(crypto.scrypt);

/** Permissions a master can grant to other staff. "staff" (managing accounts) is master-only. */
export const PERMISSIONS = [
  ["orders", "Orders & kitchen board"],
  ["bookings", "Table bookings"],
  ["menu", "Menu & categories"],
  ["whatsapp", "WhatsApp inbox"],
  ["reviews", "Reviews"],
  ["enquiries", "Party enquiries"],
  ["subscribers", "Newsletter subscribers"],
  ["reports", "Sales reports"],
  ["settings", "Business settings"]
];
export const GRANTABLE = PERMISSIONS.map(([key]) => key);
export const ALL_PERMISSIONS = [...GRANTABLE, "staff"];

export const ROLES = {
  master: { label: "Master (owner)", permissions: ALL_PERMISSIONS },
  manager: { label: "Manager", permissions: ["orders", "bookings", "menu", "whatsapp", "reviews", "enquiries", "subscribers", "reports"] },
  frontdesk: { label: "Front desk", permissions: ["orders", "bookings", "whatsapp", "enquiries"] },
  kitchen: { label: "Kitchen", permissions: ["orders"] }
};

const SESSION_HOURS = 12;
const REMEMBER_DAYS = 30;

const sha256 = (value) => crypto.createHash("sha256").update(String(value)).digest();
const sha256Hex = (value) => sha256(value).toString("hex");
const newId = () => crypto.randomBytes(12).toString("base64url");

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(String(password), salt, 64);
  return `scrypt$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export async function verifyPassword(password, stored) {
  const [scheme, salt, key] = String(stored || "").split("$");
  if (scheme !== "scrypt" || !salt || !key) return false;
  const expected = Buffer.from(key, "base64url");
  const actual = await scrypt(String(password), Buffer.from(salt, "base64url"), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

export function effectivePermissions(user) {
  if (user.role === "master") return [...ALL_PERMISSIONS];
  const chosen = Array.isArray(user.permissions) ? user.permissions : ROLES[user.role]?.permissions ?? [];
  return chosen.filter((permission) => GRANTABLE.includes(permission));
}

export function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    role: user.role,
    roleLabel: ROLES[user.role]?.label ?? user.role,
    permissions: effectivePermissions(user),
    active: user.active !== false,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt ?? null
  };
}

/**
 * Staff accounts and login sessions. Session tokens are random and only their
 * SHA-256 hash is stored, so a leaked sessions file can't be used to log in.
 * The ADMIN_TOKEN ("master key") also works as a bearer token with full rights,
 * for first-time setup, scripts and account recovery.
 */
export function createAuth({ store, now, masterKey }) {
  const masterDigest = masterKey ? sha256(masterKey) : null;
  const users = () => store.get("users");
  const sessions = () => store.get("sessions");

  const isMasterKey = (token) => Boolean(masterDigest && token) && crypto.timingSafeEqual(sha256(token), masterDigest);

  function bearer(req) {
    const header = String(req.headers.authorization || "");
    return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  }

  function authenticate(req) {
    const token = bearer(req);
    if (!token) return null;
    if (isMasterKey(token)) {
      return { id: "master-key", name: "Master key", username: "", role: "master", permissions: [...ALL_PERMISSIONS], sessionId: null };
    }
    const tokenHash = sha256Hex(token);
    const session = sessions().find((entry) => entry.tokenHash === tokenHash);
    if (!session || new Date(session.expiresAt) <= now()) return null;
    const user = users().find((candidate) => candidate.id === session.userId && candidate.active !== false);
    if (!user) return null;
    return { id: user.id, name: user.name, username: user.username, role: user.role, permissions: effectivePermissions(user), sessionId: session.id };
  }

  async function startSession(user, remember) {
    const token = crypto.randomBytes(32).toString("base64url");
    const at = now();
    const lifetime = remember ? REMEMBER_DAYS * 86_400_000 : SESSION_HOURS * 3_600_000;
    const live = sessions().filter((entry) => new Date(entry.expiresAt) > at);
    live.push({ id: newId(), userId: user.id, tokenHash: sha256Hex(token), createdAt: at.toISOString(), expiresAt: new Date(at.getTime() + lifetime).toISOString() });
    store.data.sessions = live;
    user.lastLoginAt = at.toISOString();
    await Promise.all([store.save("sessions"), store.save("users")]);
    return token;
  }

  async function endSession(sessionId) {
    if (!sessionId) return;
    store.data.sessions = sessions().filter((entry) => entry.id !== sessionId);
    await store.save("sessions");
  }

  async function revokeUserSessions(userId, keepSessionId = null) {
    store.data.sessions = sessions().filter((entry) => entry.userId !== userId || entry.id === keepSessionId);
    await store.save("sessions");
  }

  const findByUsername = (username) => users().find((user) => user.username === String(username || "").trim().toLowerCase());

  async function login(username, password) {
    const user = findByUsername(username);
    // Always run the hash so response time doesn't reveal whether the username exists.
    const ok = await verifyPassword(password, user?.passwordHash ?? "scrypt$AAAAAAAAAAAAAAAAAAAAAA$AAAA");
    if (!user || !ok || user.active === false) return null;
    return user;
  }

  const activeMasters = () => users().filter((user) => user.role === "master" && user.active !== false);

  return {
    authenticate,
    isMasterKey,
    startSession,
    endSession,
    revokeUserSessions,
    login,
    findByUsername,
    activeMasters,
    needsSetup: () => users().length === 0,
    hasMasterKey: Boolean(masterDigest)
  };
}
