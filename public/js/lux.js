// Shared by the home page and the tuning file service: the menu, reveal-on-scroll, and the
// business details from the admin panel's settings.

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
export const digits = (value) => String(value ?? "").replace(/\D/g, "");
export const whatsappUrl = (number, text) => `https://wa.me/${digits(number)}${text ? `?text=${encodeURIComponent(text)}` : ""}`;

// Links that would run code instead of opening a page.
const UNSAFE_URL = /^\s*(javascript|vbscript|data):/i;

// Builds elements without innerHTML: strings become text nodes, so data can never inject markup.
export function h(tag, props = {}, ...children) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") element.className = value;
    else if (key === "text") element.textContent = value;
    else if (key === "dataset") Object.assign(element.dataset, value);
    else if (key.startsWith("on")) element.addEventListener(key.slice(2).toLowerCase(), value);
    else if ((key === "href" || key === "src") && UNSAFE_URL.test(String(value))) continue;
    else element.setAttribute(key, value === true ? "" : value);
  }
  element.append(...children.flat(Infinity).filter((child) => child !== null && child !== undefined && child !== false));
  return element;
}

export function toast(message, kind = "") {
  const holder = $("[data-toasts]");
  if (!holder) return;
  const item = h("div", { class: `toast${kind ? ` toast--${kind}` : ""}`, text: message });
  holder.append(item);
  setTimeout(() => item.remove(), kind === "error" ? 7000 : 4000);
}

document.documentElement.classList.add("js");
for (const year of $$("[data-year]")) year.textContent = String(new Date().getFullYear());

export function setupNav() {
  const nav = $("[data-nav]");
  if (!nav) return;
  const toggle = $("[data-nav-toggle]", nav);
  const setOpen = (open) => {
    nav.classList.toggle("is-open", open);
    toggle?.setAttribute("aria-expanded", String(open));
    toggle?.setAttribute("aria-label", open ? "Close menu" : "Open menu");
  };
  toggle?.addEventListener("click", () => setOpen(!nav.classList.contains("is-open")));
  for (const link of $$(".nav__links a", nav)) link.addEventListener("click", () => setOpen(false));
  addEventListener("keydown", (event) => event.key === "Escape" && setOpen(false));
  const onScroll = () => nav.classList.toggle("is-scrolled", scrollY > 12);
  addEventListener("scroll", onScroll, { passive: true });
  onScroll();
}

export function observeReveals(root = document) {
  const targets = $$(".reveal:not(.is-in)", root);
  if (matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) {
    for (const target of targets) target.classList.add("is-in");
    return;
  }
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("is-in");
        observer.unobserve(entry.target);
      }
    },
    { rootMargin: "0px 0px -6% 0px", threshold: 0.08 }
  );
  for (const target of targets) observer.observe(target);
}

let sitePromise;
export const loadSite = () => (sitePromise ??= fetch("/api/site").then((response) => (response.ok ? response.json() : Promise.reject(new Error("Site details unavailable")))));

// Fills [data-setting] text and the WhatsApp, phone, map and Instagram links from the settings.
export async function applySettings() {
  let settings;
  try {
    ({ settings } = await loadSite());
  } catch {
    return null;
  }
  for (const element of $$("[data-setting]")) {
    const value = settings[element.dataset.setting];
    if (value) element.textContent = value;
  }
  if (settings.whatsappNumber) for (const link of $$("[data-whatsapp-link]")) link.href = whatsappUrl(settings.whatsappNumber);
  if (settings.phone) for (const link of $$("[data-phone-link]")) link.href = `tel:+${digits(settings.phone)}`;
  if (settings.instagram) for (const link of $$("[data-instagram-link]")) link.href = settings.instagram;
  if (settings.address) {
    const place = Number.isFinite(settings.latitude) && Number.isFinite(settings.longitude) ? `${settings.latitude},${settings.longitude}` : settings.address;
    for (const link of $$("[data-map-link]")) link.href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place)}`;
  }
  return settings;
}
