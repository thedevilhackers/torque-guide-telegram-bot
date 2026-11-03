import { api, clearErrorsOnInput, formValues, formatDay, h, icon, paise, rupees, setLoading, showErrors, timeAgo, toast } from "../lib.js";

export { clearErrorsOnInput, formValues, formatDay, h, icon, paise, rupees, setLoading, showErrors, timeAgo, toast };

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

/** Shared dashboard state. `me` is the signed-in staff member. */
export const state = {
  token: null,
  me: null,
  roles: {},
  permissionCatalog: [],
  summary: null,
  tab: "overview"
};

const hooks = { unauthorized: () => {}, rerender: () => {}, poll: () => {} };
export const setHooks = (next) => Object.assign(hooks, next);
export const rerender = () => hooks.rerender();
export const pollNow = () => hooks.poll();

export const can = (permission) => Boolean(state.me?.permissions?.includes(permission));

export async function call(path, options = {}) {
  try {
    return await api(path, { ...options, token: state.token });
  } catch (error) {
    if (error.status === 401 && state.token) hooks.unauthorized("Your session has ended. Please sign in again.");
    throw error;
  }
}

/** PATCH/POST helper that shows a toast on success or failure. */
export async function send(method, path, body, successMessage) {
  try {
    const result = await call(path, { method, body });
    if (successMessage) toast(successMessage);
    pollNow();
    return result;
  } catch (error) {
    const fieldMessage = error.fields ? Object.values(error.fields)[0] : "";
    toast(fieldMessage || error.message, { type: "error" });
    throw error;
  }
}

export const pad = (n) => String(n).padStart(3, "0");
export const dietMark = (veg) => h("i", { class: `diet ${veg ? "veg" : "nonveg"}`, role: "img", "aria-label": veg ? "Veg" : "Non-veg" });
export const emptyState = (title, text, ...extra) => h("div", { class: "empty" }, h("strong", { text: title }), h("p", { text }), ...extra);
export const telLink = (phone) => h("a", { href: `tel:${phone}`, text: phone });
export const waDigits = (phone) => {
  const digits = String(phone || "").replace(/\D/g, "");
  return /^[6-9]\d{9}$/.test(digits) ? `91${digits}` : digits;
};
export const waLink = (phone, text, label = "WhatsApp", extraClass = "") =>
  h(
    "a",
    { class: `btn btn-sm btn-wa ${extraClass}`, href: `https://wa.me/${waDigits(phone)}?text=${encodeURIComponent(text)}`, target: "_blank", rel: "noopener", title: "Opens WhatsApp with this message ready to send" },
    icon("whatsapp"),
    label
  );

const WA_STATUS_LABELS = { queued: "sending", sent: "sent", delivered: "delivered", read: "read", failed: "failed" };
/** Small badge showing the last automatic WhatsApp message for an order or booking. */
export function waBadge(info) {
  if (!info) return null;
  return h("span", { class: `wa-badge wa-${info.status}`, title: info.error || `Automatic WhatsApp ${info.event?.replace(/_/g, " ")}` }, icon("whatsapp"), WA_STATUS_LABELS[info.status] ?? info.status);
}

export function segmented(options, current, onChange) {
  return h(
    "div",
    { class: "seg", role: "group" },
    options.map(([value, label]) => h("button", { type: "button", "aria-pressed": String(value === current), onclick: () => onChange(value) }, label))
  );
}

export function switchControl(checked, label, onChange, { showLabel = false } = {}) {
  const input = h("input", { type: "checkbox", "aria-label": label });
  input.checked = checked;
  input.addEventListener("change", () => onChange(input.checked, input));
  return h("label", { class: `mini-switch${showLabel ? " with-label" : ""}` }, input, h("span", { class: "switch", "aria-hidden": "true" }), showLabel ? h("span", { text: label }) : null);
}

/** A labelled form field. `control` is an input/select/textarea element. */
export function field(label, control, { name = control.name, hint, className = "" } = {}) {
  return h(
    "label",
    { class: `field ${className}`.trim(), "data-field": name },
    h("span", {}, label, hint ? h("i", { text: ` ${hint}` }) : null),
    control
  );
}

export const input = (name, value = "", attrs = {}) => {
  const el = h("input", { name, ...attrs });
  if (value !== null && value !== undefined) el.value = String(value);
  return el;
};

export const textarea = (name, value = "", attrs = {}) => {
  const el = h("textarea", { name, rows: "3", ...attrs });
  el.value = value ?? "";
  return el;
};

export const select = (name, options, value, attrs = {}) =>
  h("select", { name, ...attrs }, options.map(([optionValue, label]) => h("option", { value: optionValue, selected: String(optionValue) === String(value) }, label)));

/** Native <dialog> modal. Returns { el, close }. */
export function openDialog(title, body, { wide = false } = {}) {
  const dialog = h(
    "dialog",
    { class: `modal${wide ? " modal-wide" : ""}`, "aria-label": title },
    h(
      "div",
      { class: "modal-head" },
      h("h2", { text: title }),
      h("button", { type: "button", class: "icon-btn", "aria-label": "Close", onclick: () => close() }, icon("close"))
    ),
    h("div", { class: "modal-body" }, body)
  );
  const close = () => {
    dialog.close();
    dialog.remove();
  };
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    close();
  });
  document.body.append(dialog);
  dialog.showModal();
  dialog.querySelector("input:not([type=hidden]):not([disabled]), select, textarea")?.focus();
  return { el: dialog, close };
}

/** Wires a form to an async submit that shows field errors. */
export function onSubmit(form, handler) {
  clearErrorsOnInput(form);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = form.querySelector("[type=submit]");
    setLoading(button, true);
    try {
      await handler(formValues(form), form);
    } catch (error) {
      showErrors(form, error);
    } finally {
      if (button.isConnected) setLoading(button, false);
    }
  });
  return form;
}
