export class HttpError extends Error {
  constructor(status, message, code = undefined, details = undefined) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message, code, details) => new HttpError(400, message, code, details);
export const notFound = (what = "Resource") => new HttpError(404, `${what} not found`, "NOT_FOUND");
export const forbidden = (message = "You do not have permission to do that", code = "FORBIDDEN") => new HttpError(403, message, code);
export const conflict = (message, code = "CONFLICT", details) => new HttpError(409, message, code, details);

export const nowIso = () => new Date().toISOString();

const dateFormatters = new Map();
function partsFor(timezone, date) {
  let fmt = dateFormatters.get(timezone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    });
    dateFormatters.set(timezone, fmt);
  }
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  return parts;
}

/** YYYY-MM-DD in the branch's own timezone. */
export function businessDate(timezone = "UTC", date = new Date()) {
  const p = partsFor(timezone, date);
  return `${p.year}-${p.month}-${p.day}`;
}

export function localHour(timezone = "UTC", date = new Date()) {
  return Number(partsFor(timezone, date).hour) % 24;
}

export function localMinutes(timezone = "UTC", date = new Date()) {
  const p = partsFor(timezone, date);
  return (Number(p.hour) % 24) * 60 + Number(p.minute);
}

export function isValidTimezone(tz) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function isIsoDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

/** Round a quantity to 3 decimals to avoid floating point dust (e.g. 0.30000000004 kg). */
export const roundQty = (n) => Math.round(Number(n) * 1000) / 1000;

// ---- input validation -------------------------------------------------------

export function str(value, field, { required = false, max = 500, fallback = "" } = {}) {
  if (value === undefined || value === null || value === "") {
    if (required) throw badRequest(`${field} is required`, "VALIDATION", { field });
    return fallback;
  }
  const s = String(value).trim();
  if (required && !s) throw badRequest(`${field} is required`, "VALIDATION", { field });
  if (s.length > max) throw badRequest(`${field} is too long (max ${max})`, "VALIDATION", { field });
  return s;
}

export function int(value, field, { required = false, min = -Infinity, max = Infinity, fallback = 0 } = {}) {
  if (value === undefined || value === null || value === "") {
    if (required) throw badRequest(`${field} is required`, "VALIDATION", { field });
    return fallback;
  }
  const n = Number(value);
  if (!Number.isInteger(n)) throw badRequest(`${field} must be a whole number`, "VALIDATION", { field });
  if (n < min || n > max) throw badRequest(`${field} must be between ${min} and ${max}`, "VALIDATION", { field });
  return n;
}

export function num(value, field, { required = false, min = -Infinity, max = Infinity, fallback = 0 } = {}) {
  if (value === undefined || value === null || value === "") {
    if (required) throw badRequest(`${field} is required`, "VALIDATION", { field });
    return fallback;
  }
  const n = Number(value);
  if (!Number.isFinite(n)) throw badRequest(`${field} must be a number`, "VALIDATION", { field });
  if (n < min || n > max) throw badRequest(`${field} must be between ${min} and ${max}`, "VALIDATION", { field });
  return n;
}

export function bool(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

export function optionalDate(value, field) {
  if (value === undefined || value === null || value === "") return null;
  if (!isIsoDate(value)) throw badRequest(`${field} must be a date in YYYY-MM-DD format`, "VALIDATION", { field });
  return value;
}

export function optionalId(value, field) {
  if (value === undefined || value === null || value === "") return null;
  return int(value, field, { min: 1 });
}

export function list(value) {
  return Array.isArray(value) ? value : [];
}

// ---- barcodes ---------------------------------------------------------------

/** GS1 check digit for EAN-8/UPC-A/EAN-13/GTIN-14 bodies (digits without the check digit). */
export function gs1CheckDigit(body) {
  let sum = 0;
  const digits = body.split("").reverse();
  digits.forEach((d, i) => {
    sum += Number(d) * (i % 2 === 0 ? 3 : 1);
  });
  return String((10 - (sum % 10)) % 10);
}

export function isValidGs1(code) {
  if (!/^\d{8}$|^\d{12,14}$/.test(code)) return false;
  return gs1CheckDigit(code.slice(0, -1)) === code.slice(-1);
}

// ---- CSV --------------------------------------------------------------------

export function toCsv(rows, columns) {
  const escape = (v) => {
    if (v === null || v === undefined) return "";
    let s = String(v);
    // Neutralise spreadsheet formula injection.
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = columns.map((c) => escape(c.label ?? c.key)).join(",");
  const body = rows.map((row) => columns.map((c) => escape(typeof c.value === "function" ? c.value(row) : row[c.key])).join(","));
  return [header, ...body].join("\r\n") + "\r\n";
}

export function parseJson(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}
