import { all, run } from "./db.js";
import { badRequest, bool, int, parseJson, str } from "./util.js";

export const DEFAULT_SETTINGS = {
  store_name: "My Store",
  currency: "USD",
  locale: "en-US",
  prices_include_tax: true,
  payment_methods: [
    { id: "cash", label: "Cash" },
    { id: "card", label: "Card" },
    { id: "upi", label: "UPI / QR" },
    { id: "wallet", label: "E-wallet" }
  ],
  loyalty: { enabled: true, earn_per_amount: 100, point_value: 1, min_redeem: 100 },
  // Scale / price-embedded EAN-13 barcodes: PP IIIII VVVVV C
  // PP = prefix, IIIII = product PLU, VVVVV = weight in grams or price in minor units.
  embedded_barcodes: [
    { prefix: "21", type: "weight" },
    { prefix: "22", type: "price" }
  ],
  max_cashier_discount_pct: 10,
  block_expired_sales: true,
  allow_negative_stock: true,
  require_shift: true,
  receipt_header: "",
  default_expiry_warn_days: 7
};

const cache = new WeakMap();

export function getSettings(db) {
  let settings = cache.get(db);
  if (settings) return settings;
  settings = structuredClone(DEFAULT_SETTINGS);
  for (const row of all(db, "SELECT key, value FROM settings")) {
    if (row.key in DEFAULT_SETTINGS) settings[row.key] = parseJson(row.value, settings[row.key]);
  }
  cache.set(db, settings);
  return settings;
}

function currencyIsValid(code) {
  try {
    new Intl.NumberFormat("en", { style: "currency", currency: code });
    return /^[A-Z]{3}$/.test(code);
  } catch {
    return false;
  }
}

export function currencyDecimals(code) {
  return new Intl.NumberFormat("en", { style: "currency", currency: code }).resolvedOptions().maximumFractionDigits;
}

function normalise(key, value) {
  switch (key) {
    case "store_name":
      return str(value, "store_name", { required: true, max: 120 });
    case "receipt_header":
      return str(value, "receipt_header", { max: 500 });
    case "currency": {
      const code = str(value, "currency", { required: true, max: 3 }).toUpperCase();
      if (!currencyIsValid(code)) throw badRequest("currency must be an ISO 4217 code such as USD, INR, EUR", "VALIDATION");
      return code;
    }
    case "locale": {
      const locale = str(value, "locale", { required: true, max: 20 });
      try {
        new Intl.NumberFormat(locale);
      } catch {
        throw badRequest("locale is not valid", "VALIDATION");
      }
      return locale;
    }
    case "prices_include_tax":
    case "block_expired_sales":
    case "allow_negative_stock":
    case "require_shift":
      return bool(value);
    case "max_cashier_discount_pct":
      return int(value, key, { min: 0, max: 100 });
    case "default_expiry_warn_days":
      return int(value, key, { min: 0, max: 365 });
    case "payment_methods": {
      if (!Array.isArray(value) || value.length === 0) throw badRequest("payment_methods must be a non-empty list", "VALIDATION");
      const methods = value.map((m) => ({
        id: str(m.id, "payment method id", { required: true, max: 20 }).toLowerCase().replace(/[^a-z0-9_]/g, "_"),
        label: str(m.label, "payment method label", { required: true, max: 40 })
      }));
      if (!methods.some((m) => m.id === "cash")) methods.unshift({ id: "cash", label: "Cash" });
      if (methods.some((m) => m.id === "points")) throw badRequest("'points' is reserved for loyalty redemption", "VALIDATION");
      return methods;
    }
    case "loyalty":
      return {
        enabled: bool(value?.enabled, true),
        earn_per_amount: int(value?.earn_per_amount, "loyalty.earn_per_amount", { min: 1, fallback: 100 }),
        point_value: int(value?.point_value, "loyalty.point_value", { min: 0, fallback: 1 }),
        min_redeem: int(value?.min_redeem, "loyalty.min_redeem", { min: 0, fallback: 0 })
      };
    case "embedded_barcodes":
      if (!Array.isArray(value)) throw badRequest("embedded_barcodes must be a list", "VALIDATION");
      return value.map((rule) => {
        const prefix = str(rule.prefix, "prefix", { required: true, max: 2 });
        if (!/^2\d$/.test(prefix)) throw badRequest("Embedded barcode prefixes must be 20-29", "VALIDATION");
        if (prefix === "20") throw badRequest("Prefix 20 is reserved for store-generated product barcodes", "VALIDATION");
        if (!["weight", "price"].includes(rule.type)) throw badRequest("Embedded barcode type must be weight or price", "VALIDATION");
        return { prefix, type: rule.type };
      });
    default:
      throw badRequest(`Unknown setting: ${key}`, "VALIDATION");
  }
}

export function updateSettings(db, patch) {
  const next = { ...getSettings(db) };
  for (const [key, raw] of Object.entries(patch ?? {})) {
    next[key] = normalise(key, raw);
  }
  for (const key of Object.keys(patch ?? {})) {
    run(db, "INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", key, JSON.stringify(next[key]));
  }
  cache.delete(db);
  return getSettings(db);
}
