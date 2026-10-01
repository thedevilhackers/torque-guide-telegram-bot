// Shared by the home and shop pages: API access, settings, navigation, reveal-on-scroll and the bag.
import { productArt } from "./icons.js";

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
export const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

// Links that would run code instead of opening a page.
const UNSAFE_URL = /^\s*(javascript|vbscript|data):/i;

// Builds elements without innerHTML: strings become text nodes, so data can never inject markup,
// and href/src values that would run script are dropped.
export function h(tag, props = {}, ...children) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") element.className = value;
    else if (key === "text") element.textContent = value;
    else if (key === "style") {
      // Custom properties (--delay) need setProperty; plain assignment ignores them.
      for (const [name, styleValue] of Object.entries(value)) {
        if (name.startsWith("--")) element.style.setProperty(name, styleValue);
        else element.style[name] = styleValue;
      }
    }
    else if (key.startsWith("on")) element.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === "dataset") Object.assign(element.dataset, value);
    else if ((key === "href" || key === "src") && UNSAFE_URL.test(String(value)) && !/^data:image\//i.test(String(value))) continue;
    else element.setAttribute(key, value === true ? "" : value);
  }
  element.append(...children.flat().filter((child) => child !== null && child !== undefined && child !== false));
  return element;
}

export async function api(path, { method = "GET", body } = {}) {
  const response = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Something went wrong. Please try again.");
  return data;
}

let sitePromise;
export const loadSite = () => (sitePromise ??= api("/api/site"));

export function money(amount, currency) {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount);
  } catch {
    return `${currency} ${Number(amount).toFixed(2)}`;
  }
}

export function whatsappUrl(number, text) {
  return `https://wa.me/${String(number ?? "").replace(/\D/g, "")}?text=${encodeURIComponent(text)}`;
}

function storage(action, key, value) {
  try {
    if (action === "get") return JSON.parse(localStorage.getItem(key) ?? "null");
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    return null;
  }
  return null;
}

// ---------- Page chrome ----------

function applySettings({ settings }) {
  for (const element of $$("[data-business-name]")) element.textContent = settings.businessName;
  for (const element of $$("[data-setting]")) {
    const value = settings[element.dataset.setting];
    if (value) element.textContent = value;
  }
  for (const element of $$("[data-year]")) element.textContent = new Date().getFullYear();
  if (settings.announcement) {
    for (const ribbon of $$("[data-announcement]")) {
      ribbon.textContent = settings.announcement;
      ribbon.hidden = false;
    }
  }
  const socials = [["Instagram", settings.instagram], ["Facebook", settings.facebook], ["TikTok", settings.tiktok], ["YouTube", settings.youtube]].filter(([, url]) => /^https:\/\//.test(url ?? ""));
  for (const slot of $$("[data-socials]")) slot.replaceChildren(...socials.map(([label, url]) => h("a", { href: url, rel: "noopener", target: "_blank", text: label })));
  if (document.title.includes("Unity Performance")) document.title = document.title.replace("Unity Performance", settings.businessName);
}

function setupNav() {
  const nav = $("[data-nav]");
  if (!nav) return;
  const toggle = $("[data-menu-toggle]", nav);
  const setOpen = (open) => {
    nav.classList.toggle("menu-open", open);
    toggle?.setAttribute("aria-expanded", String(open));
    document.body.style.overflow = open ? "hidden" : "";
  };
  toggle?.addEventListener("click", () => setOpen(!nav.classList.contains("menu-open")));
  for (const link of $$("[data-nav-links] a", nav)) link.addEventListener("click", () => setOpen(false));
  const onScroll = () => nav.classList.toggle("is-scrolled", scrollY > 8);
  addEventListener("scroll", onScroll, { passive: true });
  onScroll();
}

export function observeReveals(root = document) {
  const targets = $$(".reveal:not(.is-in)", root);
  if (reducedMotion() || !("IntersectionObserver" in window)) {
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
    { rootMargin: "0px 0px -8% 0px", threshold: 0.12 }
  );
  for (const target of targets) observer.observe(target);
}

// ---------- Products ----------

export function productMedia(product, { flag = true } = {}) {
  const media = h("div", { class: "product-media" });
  media.append(product.image ? h("img", { src: product.image, alt: "", loading: "lazy" }) : productArt(product.category));
  if (flag && product.stock === 0) media.append(h("span", { class: "product-flag", text: "Sold out" }));
  else if (flag && product.compareAtPrice) media.append(h("span", { class: "product-flag", text: "Offer" }));
  return media;
}

export function priceTag(product, currency) {
  return h("span", { class: "price" }, money(product.price, currency), product.compareAtPrice ? h("s", { text: money(product.compareAtPrice, currency) }) : null);
}

export function stockNote(product) {
  if (product.stock === null) return null;
  if (product.stock === 0) return h("p", { class: "stock-note", text: "Sold out" });
  if (product.stock <= 3) return h("p", { class: "stock-note low", text: `Only ${product.stock} left` });
  return h("p", { class: "stock-note", text: "In stock" });
}

// Card used on the home page and in the shop. onOpen shows the product's details.
export function productCard(product, currency, onOpen, delay = 0) {
  const soldOut = product.stock === 0;
  const add = h("button", { class: "btn btn-dark btn-small", type: "button", disabled: soldOut, text: soldOut ? "Sold out" : "Add" });
  add.addEventListener("click", () => {
    bag.add(product.id);
    add.textContent = "Added ✓";
    setTimeout(() => (add.textContent = "Add"), 1400);
  });
  return h(
    "article",
    { class: "product-card", style: { "--delay": `${delay}s` } },
    h("button", { class: "product-open", type: "button", "aria-label": `View ${product.name}`, onclick: onOpen }, productMedia(product)),
    h(
      "div",
      { class: "product-body" },
      h("p", { class: "product-category", text: product.category }),
      h("h3", { class: "product-name" }, h("button", { class: "product-open", type: "button", text: product.name, onclick: onOpen })),
      stockNote(product),
      h("div", { class: "product-foot" }, priceTag(product, currency), add)
    )
  );
}

// ---------- Bag ----------

const BAG_KEY = "unity-bag";
// The most of one item a single order can hold (the server checks the same limit).
const MAX_QTY = 20;
const listeners = new Set();
let bagItems = (storage("get", BAG_KEY) ?? [])
  .filter((item) => typeof item?.id === "string" && Number.isInteger(item.qty) && item.qty > 0)
  .map((item) => ({ id: item.id, qty: Math.min(MAX_QTY, item.qty) }));

export const bag = {
  items: () => bagItems,
  count: () => bagItems.reduce((sum, item) => sum + item.qty, 0),
  subscribe(listener) {
    listeners.add(listener);
  },
  set(id, qty) {
    bagItems = qty > 0 ? (bagItems.some((item) => item.id === id) ? bagItems.map((item) => (item.id === id ? { id, qty } : item)) : [...bagItems, { id, qty }]) : bagItems.filter((item) => item.id !== id);
    storage("set", BAG_KEY, bagItems);
    for (const listener of listeners) listener();
  },
  add(id, qty = 1) {
    const current = bagItems.find((item) => item.id === id)?.qty ?? 0;
    this.set(id, Math.min(MAX_QTY, current + qty));
  },
  clear() {
    bagItems = [];
    storage("set", BAG_KEY, bagItems);
    for (const listener of listeners) listener();
  }
};

let productsPromise;
export const loadProducts = () => (productsPromise ??= api("/api/products").then((data) => data.products));

function stepper(value, onChange, max = MAX_QTY) {
  const output = h("output", { text: String(value) });
  return h(
    "div",
    { class: "stepper" },
    h("button", { type: "button", "aria-label": "Decrease quantity", text: "−", onclick: () => onChange(value - 1) }),
    output,
    h("button", { type: "button", "aria-label": "Increase quantity", text: "+", disabled: value >= max, onclick: () => onChange(Math.min(max, value + 1)) })
  );
}

function setupBag(site) {
  const currency = site.settings.currency;
  const scrim = h("div", { class: "bag-scrim" });
  const title = h("h2", { id: "bag-title", text: "Bag" });
  const body = h("div", { class: "bag-body" });
  const foot = h("div", { class: "bag-foot" });
  const close = h("button", { class: "icon-button", type: "button", "aria-label": "Close bag" });
  close.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
  const drawer = h("aside", { class: "bag", role: "dialog", "aria-modal": "true", "aria-labelledby": "bag-title" }, h("div", { class: "bag-head" }, title, close), body, foot);
  document.body.append(scrim, drawer);
  let view = "bag";
  let lastFocus;

  const open = () => {
    lastFocus = document.activeElement;
    view = "bag";
    render();
    drawer.classList.add("is-open");
    scrim.classList.add("is-open");
    document.body.style.overflow = "hidden";
    close.focus();
  };
  const hide = () => {
    drawer.classList.remove("is-open");
    scrim.classList.remove("is-open");
    document.body.style.overflow = "";
    lastFocus?.focus?.();
  };
  close.addEventListener("click", hide);
  scrim.addEventListener("click", hide);
  drawer.addEventListener("keydown", (event) => {
    if (event.key === "Escape") hide();
  });
  for (const button of $$("[data-bag-open]")) button.addEventListener("click", open);

  const updateCount = () => {
    for (const badge of $$("[data-bag-count]")) {
      badge.textContent = String(bag.count());
      badge.hidden = bag.count() === 0;
    }
  };

  async function render() {
    const products = await loadProducts().catch(() => []);
    const lines = bag
      .items()
      .map((item) => ({ ...item, product: products.find((product) => product.id === item.id) }))
      .filter((line) => line.product);
    const subtotal = lines.reduce((sum, line) => sum + line.product.price * line.qty, 0);
    if (view === "bag") renderBag(lines, subtotal);
    else if (view === "checkout") renderCheckout(lines, subtotal);
  }

  function renderBag(lines, subtotal) {
    title.textContent = "Bag";
    if (!lines.length) {
      body.replaceChildren(h("p", { class: "bag-empty", text: "Your bag is empty." }));
      foot.replaceChildren(h("a", { class: "btn btn-dark btn-block", href: "/shop", text: "Browse the shop" }));
      return;
    }
    body.replaceChildren(
      ...lines.map(({ product, qty }) =>
        h(
          "div",
          { class: "bag-line" },
          h("div", { class: "bag-thumb" }, product.image ? h("img", { src: product.image, alt: "" }) : productArt(product.category)),
          h(
            "div",
            {},
            h("strong", { text: product.name }),
            h("span", { class: "price", text: money(product.price * qty, currency) }),
            h("div", {}, h("button", { class: "remove", type: "button", text: "Remove", onclick: () => bag.set(product.id, 0) }))
          ),
          stepper(qty, (next) => bag.set(product.id, next), Math.min(MAX_QTY, product.stock ?? MAX_QTY))
        )
      )
    );
    foot.replaceChildren(
      h("div", { class: "totals" }, h("div", { class: "grand" }, h("span", { text: "Subtotal" }), h("span", { text: money(subtotal, currency) }))),
      h("button", { class: "btn btn-primary btn-block", type: "button", text: "Check out", onclick: () => ((view = "checkout"), render()) })
    );
  }

  function renderCheckout(lines, subtotal) {
    title.textContent = "Checkout";
    const deliveryFee = Number(site.settings.deliveryFee) || 0;
    const error = h("p", { class: "form-error", role: "alert", hidden: true });
    const address = h("label", { class: "field", hidden: true }, h("span", { text: "Delivery address" }), h("textarea", { name: "address", rows: 2, autocomplete: "street-address" }));
    const deliveryLine = h("div", { hidden: true }, h("span", { text: "Delivery" }), h("span", { text: money(deliveryFee, currency) }));
    const total = h("span", { text: money(subtotal, currency) });
    const form = h(
      "form",
      { class: "form", novalidate: true },
      h("div", { class: "field-row" },
        h("label", { class: "field" }, h("span", { text: "Name" }), h("input", { name: "name", required: true, autocomplete: "name" })),
        h("label", { class: "field" }, h("span", { text: "Phone (WhatsApp)" }), h("input", { name: "phone", type: "tel", required: true, autocomplete: "tel" }))
      ),
      h("label", { class: "field" }, h("span", { text: "Email (optional)" }), h("input", { name: "email", type: "email", autocomplete: "email" })),
      h("div", { class: "segmented", role: "radiogroup", "aria-label": "Collection or delivery" },
        h("label", {}, h("input", { type: "radio", name: "fulfilment", value: "pickup", checked: true }), h("span", { text: "Collect" })),
        h("label", {}, h("input", { type: "radio", name: "fulfilment", value: "delivery" }), h("span", { text: "Delivery" }))
      ),
      address,
      h("label", { class: "field" }, h("span", { text: "Note (optional)" }), h("textarea", { name: "note", rows: 2, placeholder: "Sizes, vehicle details for fitment…" })),
      error
    );
    form.addEventListener("change", () => {
      const delivery = form.elements.fulfilment.value === "delivery";
      address.hidden = !delivery;
      deliveryLine.hidden = !delivery || !deliveryFee;
      total.textContent = money(subtotal + (delivery ? deliveryFee : 0), currency);
    });
    const submit = h("button", { class: "btn btn-primary btn-block", type: "submit", text: "Place order" });
    submit.setAttribute("form", "checkout-form");
    form.id = "checkout-form";
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      error.hidden = true;
      submit.disabled = true;
      submit.textContent = "Placing order…";
      try {
        const fields = form.elements;
        const result = await api("/api/orders", {
          method: "POST",
          body: {
            customer: { name: fields.name.value, phone: fields.phone.value, email: fields.email.value },
            fulfilment: fields.fulfilment.value,
            address: fields.address.value,
            note: fields.note.value,
            items: lines.map(({ product, qty }) => ({ id: product.id, qty }))
          }
        });
        bag.clear();
        productsPromise = undefined;
        renderSuccess(result);
      } catch (failure) {
        error.textContent = failure.message;
        error.hidden = false;
        submit.disabled = false;
        submit.textContent = "Place order";
      }
    });
    body.replaceChildren(
      h("button", { class: "inline-button", type: "button", text: "‹ Back to bag", onclick: () => ((view = "bag"), render()) }),
      form
    );
    foot.replaceChildren(
      h("div", { class: "totals" },
        h("div", {}, h("span", { text: `${lines.reduce((sum, line) => sum + line.qty, 0)} items` }), h("span", { text: money(subtotal, currency) })),
        deliveryLine,
        h("div", { class: "grand" }, h("span", { text: "Total" }), total)
      ),
      h("p", { class: "fineprint", text: site.settings.shopNote }),
      submit
    );
  }

  function renderSuccess({ order, whatsappUrl: link }) {
    view = "done";
    title.textContent = "Thank you";
    body.replaceChildren(
      h("div", { class: "success" },
        h("div", { class: "success-icon", text: "✓", "aria-hidden": "true" }),
        h("h3", { text: `Order ${order.number} placed` }),
        h("p", { text: `Total ${money(order.total, order.currency)}. Send the order to us on WhatsApp so we can confirm it with you.` }),
        h("a", { class: "btn btn-whatsapp btn-block", href: link, target: "_blank", rel: "noopener", text: "Send order on WhatsApp" })
      )
    );
    foot.replaceChildren(h("button", { class: "btn btn-block", type: "button", text: "Continue shopping", onclick: hide }));
  }

  bag.subscribe(() => {
    updateCount();
    if (drawer.classList.contains("is-open") && view === "bag") render();
  });
  updateCount();
  return { open };
}

// A chat button that stays in the corner, since WhatsApp is how customers reach the workshop.
function addWhatsappButton(settings) {
  if (!settings.whatsappNumber) return;
  const svgNs = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNs, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(svgNs, "path");
  path.setAttribute("d", "M12 3.5a8.5 8.5 0 0 0-7.4 12.7L3.5 20.5l4.4-1.1A8.5 8.5 0 1 0 12 3.5Z");
  svg.append(path);
  const link = h("a", { class: "whatsapp-fab", href: whatsappUrl(settings.whatsappNumber, `Hello ${settings.businessName}, I have a question.`), target: "_blank", rel: "noopener", "aria-label": "Chat with us on WhatsApp" }, svg);
  document.body.append(link);
}

// ---------- Boot ----------

export async function bootPage() {
  document.documentElement.classList.remove("no-js");
  setupNav();
  observeReveals();
  const site = await loadSite();
  applySettings(site);
  addWhatsappButton(site.settings);
  const bagUi = setupBag(site);
  return { site, openBag: bagUi.open };
}
