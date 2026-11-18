import { all, one, run, value } from "./db.js";
import { ROLES, hashSecret } from "./auth.js";
import { badRequest, bool, businessDate, conflict, forbidden, isValidTimezone, notFound, nowIso, optionalId, str } from "./util.js";

// ---- audit -----------------------------------------------------------------

export function audit(db, principal, action, { entity = "", entityId = null, branchId = null, details = {} } = {}) {
  run(
    db,
    "INSERT INTO audit_log(branch_id, user_id, api_key_id, action, entity, entity_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    branchId,
    principal?.userId ?? null,
    principal?.apiKeyId ?? null,
    action,
    entity,
    entityId,
    JSON.stringify(details),
    nowIso()
  );
}

export function listAudit(db, { branchId = null, limit = 200 } = {}) {
  return all(
    db,
    `SELECT a.*, u.name AS user_name, k.name AS api_key_name
       FROM audit_log a
       LEFT JOIN users u ON u.id = a.user_id
       LEFT JOIN api_keys k ON k.id = a.api_key_id
      WHERE (? IS NULL OR a.branch_id = ? OR a.branch_id IS NULL)
      ORDER BY a.id DESC LIMIT ?`,
    branchId,
    branchId,
    Math.min(limit, 1000)
  ).map((row) => ({ ...row, details: JSON.parse(row.details || "{}") }));
}

// ---- branches ----------------------------------------------------------------

export function getBranch(db, id) {
  const branch = one(db, "SELECT * FROM branches WHERE id = ?", id);
  if (!branch) throw notFound("Branch");
  return branch;
}

export function branchToday(db, branchId) {
  const tz = value(db, "SELECT timezone FROM branches WHERE id = ?", branchId) ?? "UTC";
  return businessDate(tz);
}

export function listBranches(db, principal, { includeInactive = true } = {}) {
  const rows = all(db, "SELECT * FROM branches ORDER BY active DESC, name");
  return rows.filter((b) => (principal?.branchId ? b.id === principal.branchId : true) && (includeInactive || b.active));
}

function branchFields(data, existing = {}) {
  const timezone = str(data.timezone ?? existing.timezone, "timezone", { fallback: "UTC", max: 64 });
  if (!isValidTimezone(timezone)) throw badRequest("timezone must be an IANA name such as Asia/Kolkata", "VALIDATION");
  const code = str(data.code ?? existing.code, "code", { required: true, max: 12 }).toUpperCase();
  if (!/^[A-Z0-9-]+$/.test(code)) throw badRequest("Branch code may only use letters, digits and dashes", "VALIDATION");
  return {
    code,
    name: str(data.name ?? existing.name, "name", { required: true, max: 120 }),
    address: str(data.address ?? existing.address, "address", { max: 300 }),
    phone: str(data.phone ?? existing.phone, "phone", { max: 40 }),
    timezone,
    tax_id: str(data.tax_id ?? existing.tax_id, "tax_id", { max: 60 }),
    receipt_footer: str(data.receipt_footer ?? existing.receipt_footer, "receipt_footer", { max: 500 }),
    external_id: data.external_id === undefined ? existing.external_id ?? null : str(data.external_id, "external_id", { max: 100 }) || null
  };
}

export function createBranch(db, data) {
  const f = branchFields(data);
  if (one(db, "SELECT id FROM branches WHERE code = ?", f.code)) throw conflict(`Branch code ${f.code} already exists`);
  const { id } = run(
    db,
    `INSERT INTO branches(code, name, address, phone, timezone, tax_id, receipt_footer, external_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    f.code,
    f.name,
    f.address,
    f.phone,
    f.timezone,
    f.tax_id,
    f.receipt_footer,
    f.external_id,
    nowIso()
  );
  return getBranch(db, id);
}

export function updateBranch(db, id, data) {
  const existing = getBranch(db, id);
  const f = branchFields(data, existing);
  const dupe = one(db, "SELECT id FROM branches WHERE code = ? AND id != ?", f.code, id);
  if (dupe) throw conflict(`Branch code ${f.code} already exists`);
  const active = data.active === undefined ? existing.active : bool(data.active) ? 1 : 0;
  const locked = data.locked === undefined ? existing.locked : bool(data.locked) ? 1 : 0;
  const lockReason = locked ? str(data.lock_reason ?? existing.lock_reason, "lock_reason", { max: 200 }) : "";
  run(
    db,
    `UPDATE branches SET code=?, name=?, address=?, phone=?, timezone=?, tax_id=?, receipt_footer=?, external_id=?,
            active=?, locked=?, lock_reason=? WHERE id=?`,
    f.code,
    f.name,
    f.address,
    f.phone,
    f.timezone,
    f.tax_id,
    f.receipt_footer,
    f.external_id,
    active,
    locked,
    lockReason,
    id
  );
  return getBranch(db, id);
}

/** Throws when HQ has locked the branch or it is deactivated. */
export function assertBranchOpen(db, branchId) {
  const branch = getBranch(db, branchId);
  if (!branch.active) throw forbidden("This branch is deactivated", "BRANCH_INACTIVE");
  if (branch.locked) throw forbidden(`This branch is locked by head office${branch.lock_reason ? `: ${branch.lock_reason}` : ""}`, "BRANCH_LOCKED");
  return branch;
}

// ---- users -------------------------------------------------------------------

const publicUser = (u) =>
  u && {
    id: u.id,
    name: u.name,
    username: u.username,
    role: u.role,
    branch_id: u.branch_id,
    branch_name: u.branch_name ?? undefined,
    active: u.active,
    has_password: Boolean(u.password_hash),
    has_pin: Boolean(u.pin_hash),
    created_at: u.created_at
  };

export function getUser(db, id) {
  const user = one(db, "SELECT u.*, b.name AS branch_name FROM users u LEFT JOIN branches b ON b.id = u.branch_id WHERE u.id = ?", id);
  if (!user) throw notFound("User");
  return publicUser(user);
}

export function listUsers(db, principal) {
  return all(db, "SELECT u.*, b.name AS branch_name FROM users u LEFT JOIN branches b ON b.id = u.branch_id ORDER BY u.active DESC, u.name")
    .filter((u) => !principal.branchId || u.branch_id === principal.branchId)
    .map(publicUser);
}

function validatePin(pin) {
  const p = String(pin);
  if (!/^\d{4,8}$/.test(p)) throw badRequest("PIN must be 4 to 8 digits", "VALIDATION");
  return p;
}

function validatePassword(password) {
  const p = String(password);
  if (p.length < 8) throw badRequest("Password must be at least 8 characters", "VALIDATION");
  return p;
}

function assertCanManage(principal, role, branchId) {
  if (principal.role === "owner") return;
  if (principal.role === "manager" && role === "cashier" && branchId === principal.branchId) return;
  throw forbidden("Managers can only manage cashiers in their own branch");
}

export async function createUser(db, principal, data) {
  const role = str(data.role, "role", { required: true });
  if (!ROLES.includes(role)) throw badRequest("role must be owner, manager or cashier", "VALIDATION");
  let branchId = optionalId(data.branch_id, "branch_id");
  if (role !== "owner" && !branchId) throw badRequest("branch_id is required for managers and cashiers", "VALIDATION");
  if (role === "owner") branchId = null;
  if (branchId) getBranch(db, branchId);
  assertCanManage(principal, role, branchId);
  const username = str(data.username, "username", { required: true, max: 40 }).toLowerCase();
  if (!/^[a-z0-9._-]+$/.test(username)) throw badRequest("username may only use letters, digits, dots, dashes and underscores", "VALIDATION");
  if (one(db, "SELECT id FROM users WHERE username = ?", username)) throw conflict("That username is taken");
  if (!data.password && !data.pin) throw badRequest("Set a password, a PIN, or both", "VALIDATION");
  const passwordHash = data.password ? await hashSecret(validatePassword(data.password)) : null;
  const pinHash = data.pin ? await hashSecret(validatePin(data.pin)) : null;
  const { id } = run(
    db,
    "INSERT INTO users(name, username, password_hash, pin_hash, role, branch_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    str(data.name, "name", { required: true, max: 80 }),
    username,
    passwordHash,
    pinHash,
    role,
    branchId,
    nowIso()
  );
  return getUser(db, id);
}

export async function updateUser(db, principal, id, data) {
  const existing = one(db, "SELECT * FROM users WHERE id = ?", id);
  if (!existing) throw notFound("User");
  assertCanManage(principal, existing.role, existing.branch_id);
  const role = data.role ?? existing.role;
  if (!ROLES.includes(role)) throw badRequest("role must be owner, manager or cashier", "VALIDATION");
  let branchId = data.branch_id === undefined ? existing.branch_id : optionalId(data.branch_id, "branch_id");
  if (role === "owner") branchId = null;
  if (role !== "owner" && !branchId) throw badRequest("branch_id is required for managers and cashiers", "VALIDATION");
  assertCanManage(principal, role, branchId);
  const active = data.active === undefined ? existing.active : bool(data.active) ? 1 : 0;
  if (existing.role === "owner" && (role !== "owner" || !active)) {
    const owners = value(db, "SELECT COUNT(*) FROM users WHERE role = 'owner' AND active = 1 AND id != ?", id);
    if (!owners) throw badRequest("At least one active owner account is required", "VALIDATION");
  }
  const passwordHash = data.password ? await hashSecret(validatePassword(data.password)) : existing.password_hash;
  const pinHash = data.pin ? await hashSecret(validatePin(data.pin)) : existing.pin_hash;
  run(
    db,
    "UPDATE users SET name=?, role=?, branch_id=?, active=?, password_hash=?, pin_hash=? WHERE id=?",
    str(data.name ?? existing.name, "name", { required: true, max: 80 }),
    role,
    branchId,
    active,
    passwordHash,
    pinHash,
    id
  );
  if (!active) run(db, "DELETE FROM sessions WHERE user_id = ?", id);
  return getUser(db, id);
}

export async function changeOwnSecret(db, userId, { password, pin }) {
  if (password) run(db, "UPDATE users SET password_hash = ? WHERE id = ?", await hashSecret(validatePassword(password)), userId);
  if (pin) run(db, "UPDATE users SET pin_hash = ? WHERE id = ?", await hashSecret(validatePin(pin)), userId);
}

export function userRecordForLogin(db, username) {
  return one(db, "SELECT * FROM users WHERE username = ? AND active = 1", String(username ?? "").trim().toLowerCase());
}
