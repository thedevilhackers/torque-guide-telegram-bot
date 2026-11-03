const SVG_NS = "http://www.w3.org/2000/svg";
const SPRITE = "/assets/icons.svg";

/** Tiny DOM builder. Text is always set via textContent, so user content can't inject HTML. */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "class") el.className = value;
    else if (key === "text") el.textContent = value;
    else if (key === "dataset") Object.assign(el.dataset, value);
    else if (key.startsWith("on") && typeof value === "function") el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (value === true) el.setAttribute(key, "");
    else el.setAttribute(key, String(value));
  }
  appendChildren(el, children);
  return el;
}

export function appendChildren(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
  return el;
}

export function icon(name, className = "icon") {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", className);
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS(SVG_NS, "use");
  use.setAttribute("href", `${SPRITE}#i-${name}`);
  svg.append(use);
  return svg;
}

const inr = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });
export const rupees = (value) => `₹${inr.format(value)}`;
export const paise = (value) => {
  const amount = value / 100;
  return `₹${new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2
  }).format(amount)}`;
};

export async function api(path, { method = "GET", body, token, signal } = {}) {
  const headers = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  let response;
  try {
    response = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal });
  } catch (error) {
    if (error.name === "AbortError") throw error;
    throw Object.assign(new Error("You seem to be offline. Check your connection and try again."), { status: 0, fields: {} });
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw Object.assign(new Error(data.error || "Something went wrong. Please try again."), {
      status: response.status,
      fields: data.fields || {}
    });
  }
  return data;
}

export const storage = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* private mode or storage full: the site still works without it */
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }
};

export function toast(message, { type = "info", timeout = 4200 } = {}) {
  const host = document.getElementById("toasts");
  if (!host) return;
  const el = h("div", { class: `toast ${type}` }, icon(type === "error" ? "bell" : "check"), h("span", { text: message }));
  host.append(el);
  while (host.children.length > 3) host.firstElementChild.remove();
  setTimeout(() => {
    el.classList.add("out");
    el.addEventListener("animationend", () => el.remove(), { once: true });
  }, timeout);
}

export const formValues = (form) => Object.fromEntries(new FormData(form).entries());

export function clearErrors(form) {
  form.querySelectorAll(".has-error").forEach((el) => el.classList.remove("has-error"));
  form.querySelectorAll(".field-error, .form-error").forEach((el) => el.remove());
}

export function showErrors(form, error) {
  clearErrors(form);
  const unplaced = [];
  let first = null;
  for (const [key, message] of Object.entries(error.fields || {})) {
    const holder = form.querySelector(`[data-field="${key}"]`) || form.querySelector(`[name="${key}"]`)?.closest(".field");
    if (!holder) {
      unplaced.push(message);
      continue;
    }
    holder.classList.add("has-error");
    holder.append(h("small", { class: "field-error", text: message }));
    first ??= holder.querySelector("input:not([type=radio]), select, textarea, button, input");
  }
  if (unplaced.length || !Object.keys(error.fields || {}).length) {
    form.prepend(h("p", { class: "form-error", role: "alert", text: unplaced[0] || error.message }));
  }
  if (first) first.focus();
  else form.querySelector(".form-error")?.scrollIntoView({ behavior: "smooth", block: "center" });
}

/** Removes a field's error as soon as the visitor starts fixing it. */
export function clearErrorsOnInput(form) {
  const handler = (event) => {
    const holder = event.target.closest(".has-error");
    if (!holder) return;
    holder.classList.remove("has-error");
    holder.querySelector(".field-error")?.remove();
  };
  form.addEventListener("input", handler);
  form.addEventListener("change", handler);
}

export function setLoading(button, loading) {
  if (!button) return;
  button.classList.toggle("is-loading", loading);
  button.disabled = loading;
  button.setAttribute("aria-busy", String(loading));
}

const relative = new Intl.RelativeTimeFormat("en-IN", { numeric: "auto" });
export function timeAgo(iso) {
  const seconds = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
  const units = [
    ["year", 31_536_000],
    ["month", 2_592_000],
    ["week", 604_800],
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60]
  ];
  for (const [unit, size] of units) if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit);
  return "just now";
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const isoToDate = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
export const addDays = (iso, days) => {
  const date = isoToDate(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};
export const dayParts = (iso) => {
  const date = isoToDate(iso);
  return { weekday: WEEKDAYS[date.getUTCDay()], day: date.getUTCDate(), month: MONTHS[date.getUTCMonth()] };
};
export const formatDay = (iso) => {
  const { weekday, day, month } = dayParts(iso);
  return `${weekday}, ${day} ${month}`;
};
