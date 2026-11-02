export class ValidationError extends Error {
  constructor(fields) {
    super("Please check the highlighted details and try again.");
    this.fields = fields;
  }
}

// Strip control characters (keeping newlines/tabs) so stored text is safe to show and export.
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function cleanText(value) {
  return typeof value === "string" ? value.replace(CONTROL_CHARS, "").trim() : "";
}

/** Collects every field error so a form can highlight them all at once. */
export function createChecker(input = {}) {
  const errors = {};
  const fail = (key, message) => {
    if (!errors[key]) errors[key] = message;
    return undefined;
  };

  return {
    errors,
    fail,

    text(key, { label = "This field", min = 1, max = 200, optional = false, pattern, patternMessage } = {}) {
      const raw = input[key];
      if (raw !== undefined && raw !== null && typeof raw !== "string") return fail(key, `${label} must be text.`);
      const value = cleanText(raw);
      if (!value) return optional ? "" : fail(key, `${label} is required.`);
      if (value.length < min) return fail(key, `${label} must be at least ${min} characters.`);
      if (value.length > max) return fail(key, `${label} must be ${max} characters or fewer.`);
      if (pattern && !pattern.test(value)) return fail(key, patternMessage || `${label} is not valid.`);
      return value;
    },

    phone(key, { optional = false } = {}) {
      const raw = cleanText(input[key]);
      if (!raw) return optional ? "" : fail(key, "Phone number is required.");
      const digits = raw.replace(/[\s\-().]/g, "");
      const indian = digits.match(/^(?:\+?91|0)?([6-9]\d{9})$/);
      if (indian) return `+91${indian[1]}`;
      if (/^\+\d{8,15}$/.test(digits)) return digits;
      return fail(key, "Enter a valid 10-digit mobile number.");
    },

    email(key, { optional = false } = {}) {
      const value = cleanText(input[key]).toLowerCase();
      if (!value) return optional ? "" : fail(key, "Email is required.");
      if (value.length > 254 || !EMAIL.test(value)) return fail(key, "Enter a valid email address.");
      return value;
    },

    int(key, { label = "This value", min, max, optional = false } = {}) {
      const raw = input[key];
      if (raw === undefined || raw === null || raw === "") return optional ? null : fail(key, `${label} is required.`);
      const value = typeof raw === "string" && /^\d+$/.test(raw.trim()) ? Number(raw) : raw;
      if (!Number.isInteger(value)) return fail(key, `${label} must be a whole number.`);
      if (min !== undefined && value < min) return fail(key, `${label} must be at least ${min}.`);
      if (max !== undefined && value > max) return fail(key, `${label} must be ${max} or less.`);
      return value;
    },

    oneOf(key, allowed, { label = "This option", optional = false, fallback } = {}) {
      const value = input[key];
      if ((value === undefined || value === null || value === "") && optional) return fallback ?? "";
      if (!allowed.includes(value)) return fail(key, `${label} is not valid.`);
      return value;
    },

    bool(key, { optional = true } = {}) {
      const value = input[key];
      if (value === undefined && optional) return undefined;
      if (typeof value !== "boolean") return fail(key, "Must be true or false.");
      return value;
    },

    done() {
      if (Object.keys(errors).length) throw new ValidationError(errors);
    }
  };
}
