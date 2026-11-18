// Tiny UI toolkit: escaped templates, formatting, dialogs, toasts and icons.

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ESC[c]);

class Safe {
  constructor(s) {
    this.s = s;
  }
  toString() {
    return this.s;
  }
}
export const raw = (s) => new Safe(String(s));

function renderValue(v) {
  if (v instanceof Safe) return v.s;
  if (Array.isArray(v)) return v.map(renderValue).join("");
  if (v === false || v === null || v === undefined) return "";
  return esc(v);
}

/** Tagged template that escapes every interpolation unless wrapped in raw()/html``. */
export function html(strings, ...values) {
  let out = "";
  strings.forEach((s, i) => {
    out += s;
    if (i < values.length) out += renderValue(values[i]);
  });
  return new Safe(out);
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function mount(el, content) {
  el.innerHTML = String(content);
  return el;
}

/** Delegated event listener: on(root, "click", "[data-act=save]", (e, target) => ...) */
export function on(root, type, selector, handler) {
  const listener = (event) => {
    const target = event.target.closest(selector);
    if (target && root.contains(target)) handler(event, target);
  };
  root.addEventListener(type, listener);
  return () => root.removeEventListener(type, listener);
}

// ---- formatting ----------------------------------------------------------------

const fmt = { money: null, decimals: 2, locale: "en-US", currency: "USD", timezone: "UTC", number: null };

export function configureFormats({ currency = "USD", locale = "en-US", timezone = "UTC" } = {}) {
  fmt.currency = currency;
  fmt.locale = locale;
  fmt.timezone = timezone;
  try {
    fmt.money = new Intl.NumberFormat(locale, { style: "currency", currency });
  } catch {
    fmt.money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
  }
  fmt.decimals = fmt.money.resolvedOptions().maximumFractionDigits;
  fmt.number = new Intl.NumberFormat(locale, { maximumFractionDigits: 3 });
  fmt.compact = new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 });
}
configureFormats();

export const currencyDecimals = () => fmt.decimals;
export const money = (minor) => fmt.money.format((Number(minor) || 0) / 10 ** fmt.decimals);
/** Short money for chart axes: ₹7.5K, $1.2M. */
export function moneyCompact(minor) {
  const major = (Number(minor) || 0) / 10 ** fmt.decimals;
  try {
    return new Intl.NumberFormat(fmt.locale, { style: "currency", currency: fmt.currency, notation: "compact", maximumFractionDigits: 1 }).format(major);
  } catch {
    return money(minor);
  }
}
export function currencySymbol() {
  return fmt.money.formatToParts(0).find((p) => p.type === "currency")?.value ?? "";
}
/** "12.50" → 1250 (minor units). Returns NaN for blank/invalid. */
export function toMinor(value) {
  if (value === null || value === undefined || String(value).trim() === "") return NaN;
  const n = Number(String(value).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 10 ** fmt.decimals) : NaN;
}
export const toMajor = (minor) => ((Number(minor) || 0) / 10 ** fmt.decimals).toFixed(fmt.decimals);
export const number = (n) => fmt.number.format(Number(n) || 0);
export function qty(n, unit = "pcs") {
  const v = fmt.number.format(Number(n) || 0);
  return ["pcs", "pack", "box", "dozen"].includes(unit) ? v : `${v} ${unit}`;
}

const dtCache = new Map();
function dtf(opts) {
  const key = JSON.stringify(opts) + fmt.timezone + fmt.locale;
  if (!dtCache.has(key)) dtCache.set(key, new Intl.DateTimeFormat(fmt.locale, { timeZone: fmt.timezone, ...opts }));
  return dtCache.get(key);
}
export const dateTime = (iso) => (iso ? dtf({ dateStyle: "medium", timeStyle: "short" }).format(new Date(iso)) : "");
export const timeOnly = (iso) => (iso ? dtf({ timeStyle: "short" }).format(new Date(iso)) : "");
/** Formats a YYYY-MM-DD business date without timezone shifting. */
export function dayLabel(ymd, opts = { day: "numeric", month: "short", year: "numeric" }) {
  if (!ymd) return "";
  return new Intl.DateTimeFormat(fmt.locale, { timeZone: "UTC", ...opts }).format(new Date(`${ymd}T00:00:00Z`));
}
export function addDays(ymd, days) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function daysBetween(fromYmd, toYmd) {
  return Math.round((Date.parse(`${toYmd}T00:00:00Z`) - Date.parse(`${fromYmd}T00:00:00Z`)) / 86400000);
}

/** Badge describing how close an expiry date is. */
export function expiryBadge(expiry, today) {
  if (!expiry) return html`<span class="faint">—</span>`;
  const days = daysBetween(today, expiry);
  if (days < 0) return html`<span class="badge bad">${icon("alert", 12)} Expired ${dayLabel(expiry, { day: "numeric", month: "short" })}</span>`;
  if (days === 0) return html`<span class="badge bad">${icon("alert", 12)} Expires today</span>`;
  if (days <= 7) return html`<span class="badge warn">${icon("clock", 12)} ${days}d · ${dayLabel(expiry, { day: "numeric", month: "short" })}</span>`;
  return html`<span class="badge">${dayLabel(expiry)}</span>`;
}

export function stockBadge(p) {
  if (p.track_stock === false) return html`<span class="badge">Not tracked</span>`;
  const level = p.effective_reorder_level ?? p.reorder_level ?? 0;
  const label = qty(p.stock_qty, p.unit);
  if (p.stock_qty <= 0) return html`<span class="badge bad">${label}</span>`;
  if (level > 0 && p.stock_qty <= level) return html`<span class="badge warn">${label}</span>`;
  return html`<span class="badge good">${label}</span>`;
}

// ---- toasts --------------------------------------------------------------------

export function toast(message, type = "info", ms = 3200) {
  const box = document.getElementById("toasts");
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.setAttribute("role", type === "error" ? "alert" : "status");
  el.innerHTML = String(html`${icon(type === "error" ? "alert" : type === "success" ? "check" : "info", 18)}<div>${message}</div>`);
  box.append(el);
  setTimeout(() => el.remove(), ms);
}

// ---- dialogs -------------------------------------------------------------------

/**
 * Opens a modal dialog. Returns { el, close(value), result: Promise }.
 * actions: [{ label, kind: "primary"|"danger"|"", value, submit: true }]
 * A primary action with submit: true submits the first <form> in the body and calls onSubmit(form).
 */
export function modal({ title, body = "", size = "", drawer = false, actions = [], onMount, onSubmit, dismissible = true, head = "" }) {
  const dialog = document.createElement("dialog");
  dialog.className = `modal ${size} ${drawer ? "drawer" : ""}`;
  dialog.innerHTML = String(html`
    <div class="modal-inner">
      <div class="modal-head">
        <h2>${title}</h2>
        <div class="row">${raw(String(head))}${dismissible ? html`<button class="btn ghost icon sm" data-close aria-label="Close">${icon("x", 18)}</button>` : ""}</div>
      </div>
      <div class="modal-body">${raw(String(body))}</div>
      ${actions.length
        ? html`<div class="modal-foot">${actions.map(
            (a, i) => html`<button class="btn ${a.kind ?? ""}" data-action="${i}" ${a.submit ? raw('type="submit"') : raw('type="button"')}>${a.icon ? icon(a.icon, 16) : ""}${a.label}</button>`
          )}</div>`
        : ""}
    </div>`);
  document.body.append(dialog);
  let resolve;
  const result = new Promise((r) => (resolve = r));
  let closed = false;
  const close = (value) => {
    if (closed) return;
    closed = true;
    dialog.close();
    dialog.remove();
    resolve(value);
  };
  dialog.addEventListener("cancel", (e) => {
    e.preventDefault();
    if (dismissible) close(undefined);
  });
  dialog.addEventListener("click", async (e) => {
    if (e.target === dialog && dismissible && !drawer) return close(undefined);
    if (e.target === dialog && drawer) return close(undefined);
    if (e.target.closest("[data-close]")) return close(undefined);
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const action = actions[Number(btn.dataset.action)];
    if (action.submit) {
      const form = dialog.querySelector("form");
      if (form && !form.reportValidity()) return;
      if (onSubmit) {
        btn.disabled = true;
        try {
          const value = await onSubmit(form, action);
          if (value !== false) close(value ?? true);
        } catch (err) {
          showError(err);
        } finally {
          btn.disabled = false;
        }
        return;
      }
    }
    if (action.onClick) {
      const value = await action.onClick(dialog);
      if (value !== false) close(value ?? action.value);
      return;
    }
    close(action.value);
  });
  dialog.addEventListener("submit", (e) => {
    e.preventDefault();
    const submitIndex = actions.findIndex((a) => a.submit);
    if (submitIndex >= 0) dialog.querySelector(`[data-action="${submitIndex}"]`).click();
  });
  dialog.showModal();
  onMount?.(dialog, close);
  const first = dialog.querySelector("[autofocus], .modal-body input:not([type=hidden]):not([type=checkbox]), .modal-body select");
  first?.focus();
  return { el: dialog, close, result };
}

export async function confirmDialog(message, { title = "Are you sure?", ok = "Confirm", danger = false } = {}) {
  const { result } = modal({
    title,
    size: "sm",
    body: html`<p>${message}</p>`,
    actions: [
      { label: "Cancel", value: false },
      { label: ok, kind: danger ? "solid-danger" : "primary", value: true }
    ]
  });
  return Boolean(await result);
}

/** Asks for a manager PIN with an on-screen keypad. Resolves to the PIN or null. */
export function askPin({ title = "Manager approval", reasons = [], label = "Ask a manager to enter their PIN" } = {}) {
  let pin = "";
  const { result } = modal({
    title,
    size: "sm",
    body: html`
      ${reasons.length ? html`<div class="banner">${icon("lock", 18)}<div>${reasons.map((r) => html`<div>${r}</div>`)}</div></div>` : ""}
      <p class="muted" style="text-align:center">${label}</p>
      <div class="pin-dots" aria-live="polite"></div>
      <input class="sr-only" type="password" inputmode="numeric" autocomplete="off" data-pin-input aria-label="PIN" />
      <div class="pinpad">
        ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => html`<button type="button" class="btn" data-key="${n}">${n}</button>`)}
        <button type="button" class="btn" data-key="clear">C</button>
        <button type="button" class="btn" data-key="0">0</button>
        <button type="button" class="btn" data-key="back" aria-label="Delete">${icon("delete", 18)}</button>
      </div>`,
    actions: [
      { label: "Cancel", value: null },
      { label: "Approve", kind: "primary", onClick: () => (pin.length >= 4 ? pin : false) }
    ],
    onMount(dialog, close) {
      const dots = dialog.querySelector(".pin-dots");
      const input = dialog.querySelector("[data-pin-input]");
      const draw = () => (dots.innerHTML = "<i></i>".repeat(pin.length));
      dialog.addEventListener("click", (e) => {
        const key = e.target.closest("[data-key]")?.dataset.key;
        if (!key) return;
        if (key === "clear") pin = "";
        else if (key === "back") pin = pin.slice(0, -1);
        else if (pin.length < 8) pin += key;
        draw();
        input.focus();
      });
      input.addEventListener("keydown", (e) => {
        if (/^\d$/.test(e.key) && pin.length < 8) pin += e.key;
        else if (e.key === "Backspace") pin = pin.slice(0, -1);
        else if (e.key === "Enter" && pin.length >= 4) close(pin);
        else return;
        e.preventDefault();
        draw();
      });
      setTimeout(() => input.focus(), 30);
    }
  });
  return result;
}

export function showError(err) {
  toast(err?.message ?? String(err), "error", 5000);
}

// ---- forms -----------------------------------------------------------------------

/** Reads a form into an object. data-type: money | int | num | bool | date | text. */
export function readForm(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name || el.disabled) continue;
    const type = el.dataset.type;
    if (el.type === "checkbox") {
      out[el.name] = el.checked;
      continue;
    }
    if (el.type === "radio") {
      if (el.checked) out[el.name] = el.value;
      continue;
    }
    const v = el.value.trim();
    if (type === "money") out[el.name] = v === "" ? (el.dataset.blank === "null" ? null : undefined) : toMinor(v);
    else if (type === "int") out[el.name] = v === "" ? null : parseInt(v, 10);
    else if (type === "num") out[el.name] = v === "" ? null : Number(v);
    else out[el.name] = v === "" && el.dataset.blank === "null" ? null : v;
  }
  return out;
}

export function options(list, selected, { valueKey = "id", labelKey = "name", empty } = {}) {
  return html`${empty !== undefined ? html`<option value="">${empty}</option>` : ""}${list.map(
    (item) => html`<option value="${item[valueKey]}" ${String(item[valueKey]) === String(selected ?? "") ? raw("selected") : ""}>${item[labelKey]}</option>`
  )}`;
}

export function debounce(fn, ms = 250) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export const initials = (name = "") =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");

/** Short beep for scan feedback (no audio files needed). */
let audioCtx;
export function beep(ok = true) {
  try {
    audioCtx ??= new AudioContext();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.frequency.value = ok ? 1250 : 320;
    g.gain.value = 0.06;
    o.connect(g).connect(audioCtx.destination);
    o.start();
    o.stop(audioCtx.currentTime + (ok ? 0.07 : 0.22));
  } catch {
    /* audio not available */
  }
}

export function downloadText(filename, text, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---- icons (24px stroke icons) ---------------------------------------------------------

const PATHS = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/>',
  scan: '<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M7 8v8M10 8v8M13 8v8M17 8v8"/>',
  cart: '<circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2.5 3h2.6l2.3 11.2a1.5 1.5 0 0 0 1.5 1.2h9a1.5 1.5 0 0 0 1.5-1.1L21.5 7H6"/>',
  box: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/>',
  truck: '<path d="M2 6h12v10H2zM14 9h4l3 3v4h-7"/><circle cx="6" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>',
  clipboard: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1M9 11h6M9 15h4"/>',
  transfer: '<path d="M4 8h14l-4-4M20 16H6l4 4"/>',
  receipt: '<path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  tag: '<path d="M3 12V3h9l9 9-9 9z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  camera: '<path d="M3 8a2 2 0 0 1 2-2h2l2-2h6l2 2h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><circle cx="12" cy="13" r="3.5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  printer: '<path d="M7 9V3h10v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M7 14h10v7H7z"/>',
  pause: '<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>',
  play: '<path d="M7 4v16l13-8z"/>',
  alert: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17.5v.5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
  check: '<path d="m4 12 5 5L20 6"/>',
  barcode: '<path d="M4 5v14M7 5v14M11 5v14M14 5v14M17 5v14M20 5v14"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M4 21h16"/>',
  lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  unlock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 7.5-2"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  key: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="m11 12 9-9M16 7l3 3"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m14 6 4 4"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
  store: '<path d="M3 9 5 4h14l2 5"/><path d="M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0"/><path d="M5 12v9h14v-9M10 21v-5h4v5"/>',
  percent: '<path d="M19 5 5 19"/><circle cx="7" cy="7" r="2.5"/><circle cx="17" cy="17" r="2.5"/>',
  delete: '<path d="M21 5H9l-6 7 6 7h12z"/><path d="m17 9-6 6M11 9l6 6"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  wallet: '<path d="M3 7a2 2 0 0 1 2-2h13v4"/><path d="M3 7v11a2 2 0 0 0 2 2h15V9H5a2 2 0 0 1-2-2z"/><circle cx="16" cy="14.5" r="1.3"/>',
  cash: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 9v.01M18 15v.01"/>',
  copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
  shield: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/>'
};

export function icon(name, size = 18) {
  return raw(
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name] ?? ""}</svg>`
  );
}
