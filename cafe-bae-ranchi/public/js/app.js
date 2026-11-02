import {
  addDays,
  api,
  clearErrors,
  clearErrorsOnInput,
  dayParts,
  formValues,
  formatDay,
  h,
  icon,
  paise,
  rupees,
  setLoading,
  showErrors,
  storage,
  timeAgo,
  toast
} from "./lib.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const KEYS = {
  cart: "bae.cart.v1",
  guest: "bae.guest.v1",
  order: "bae.order.v1",
  announcement: "bae.announcement.dismissed"
};
const MAX_QTY = 20;
const ORDER_TTL_MS = 12 * 60 * 60 * 1000;
const ACTIVE_ORDER = new Set(["received", "preparing", "ready"]);
const TRACK_STEPS = [
  { status: "received", label: "Received", icon: "receipt" },
  { status: "preparing", label: "Preparing", icon: "chef" },
  { status: "ready", label: "Ready", icon: "bell" },
  { status: "completed", label: "Enjoy", icon: "heart" }
];

function readBoot() {
  try {
    return JSON.parse($("#boot")?.textContent || "{}");
  } catch {
    return {};
  }
}

const boot = readBoot();
const state = {
  site: boot.site ?? null,
  menu: boot.menu ?? { categories: [], items: [] },
  cart: new Map(Object.entries(storage.get(KEYS.cart, {})).filter(([, qty]) => Number.isInteger(qty) && qty > 0)),
  search: "",
  vegOnly: false,
  orderType: "pickup",
  table: "",
  drawerView: "cart",
  order: null,
  booking: { date: null, time: null, guests: 2, slots: [], message: "" }
};
let itemsById = new Map();
let categoriesById = new Map();
let orderStream = null;
let lastFocus = null;

// ---------------------------------------------------------------------------
// Startup (init() is called at the bottom, after every module-level binding exists)
// ---------------------------------------------------------------------------

async function init() {
  if (!state.site || !state.menu.items.length) {
    try {
      [state.site, state.menu] = await Promise.all([api("/api/site"), api("/api/menu")]);
    } catch (error) {
      toast(error.message, { type: "error" });
      return;
    }
  }
  indexMenu();
  detectTable();
  renderSite();
  renderFavourites();
  renderCategoryNav();
  renderMenu();
  updateCartUi();
  setupMenuControls();
  setupRail();
  setupHeader();
  setupDrawer();
  setupBooking();
  setupReviews();
  setupEnquiry();
  setupNewsletter();
  setupReveal();
  resumeOrderTracking();
  startLiveRefresh();
}

function indexMenu() {
  itemsById = new Map(state.menu.items.map((item) => [item.id, item]));
  categoriesById = new Map(state.menu.categories.map((category) => [category.id, category]));
  let removed = 0;
  for (const id of [...state.cart.keys()]) {
    if (!itemsById.get(id)?.available) {
      state.cart.delete(id);
      removed += 1;
    }
  }
  if (removed) {
    saveCart();
    toast(removed === 1 ? "An item in your order just sold out and was removed." : `${removed} items in your order sold out and were removed.`);
  }
}

function detectTable() {
  const fromUrl = new URLSearchParams(location.search).get("table");
  let table = "";
  try {
    table = fromUrl ?? sessionStorage.getItem("bae.table") ?? "";
    if (fromUrl) sessionStorage.setItem("bae.table", fromUrl);
  } catch {
    table = fromUrl ?? "";
  }
  if (!/^[A-Za-z0-9-]{1,8}$/.test(table)) return;
  state.table = table;
  state.orderType = "dine-in";
  $("#tableBannerText").textContent = `You're at table ${table}. Order right from your phone and we'll bring it over.`;
  $("#tableBanner").hidden = false;
}

// ---------------------------------------------------------------------------
// Site details (status, announcement, hours, spaces)
// ---------------------------------------------------------------------------

function statusClass(status) {
  if (!status.open) return "is-closed";
  return status.closingSoon ? "is-soon" : "is-open";
}

function renderSite() {
  const site = state.site;
  for (const pill of [$("#statusPill"), $("#footerStatus")]) {
    if (!pill) continue;
    pill.className = `status-pill ${statusClass(site.status)}`;
    pill.querySelector("span").textContent = site.status.label;
  }

  const announce = $("#announce");
  const dismissed = storage.get(KEYS.announcement, "");
  if (site.announcement && dismissed !== site.announcement) {
    $("#announceText").textContent = site.announcement;
    announce.hidden = false;
  } else {
    announce.hidden = true;
  }

  $("#priceForTwo").textContent = new Intl.NumberFormat("en-IN").format(site.priceForTwo || 500);
  $("#maxGuests").textContent = site.reservations.maxGuests;
  if (site.whatsapp) {
    $("#whatsappLink").href = `https://wa.me/${site.whatsapp}?text=${encodeURIComponent("Hi Cafe BAE! ")}`;
  } else {
    $("#whatsappLink").hidden = true;
  }

  const tbody = $("#hoursTable tbody");
  tbody.replaceChildren(
    ...site.hours.map((row) => h("tr", { class: row.today ? "today" : null }, h("td", { text: row.day }), h("td", { text: row.label })))
  );
  const labels = new Set(site.hours.map((row) => row.label));
  $("#footerHours").textContent = labels.size === 1 ? `Every day · ${site.hours[0].label}` : "See opening hours above";

  renderSpaces();
}

function renderSpaces() {
  const grid = $("#spacesGrid");
  const mapsLink = (query) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
  grid.replaceChildren(
    ...state.site.outlets.map((outlet) =>
      h(
        "article",
        { class: `space-card tone-${outlet.tone || "latte"} reveal` },
        h("span", { class: "space-kind", text: outlet.kind }),
        h("h3", { text: outlet.name }),
        h("p", { class: "space-area", text: outlet.area }),
        h("p", { class: "blurb", text: outlet.blurb }),
        h(
          "div",
          { class: "space-meta" },
          h("span", {}, icon("pin"), outlet.address),
          h("span", {}, icon("clock"), outlet.hours)
        ),
        h(
          "a",
          { class: "space-link", href: mapsLink(outlet.mapsQuery || outlet.address), target: "_blank", rel: "noopener" },
          "Get directions",
          icon("arrow")
        )
      )
    )
  );
  observeReveal(grid);
}

// ---------------------------------------------------------------------------
// Menu
// ---------------------------------------------------------------------------

const dietMark = (veg) => h("i", { class: `diet ${veg ? "veg" : "nonveg"}`, role: "img", "aria-label": veg ? "Vegetarian" : "Non-vegetarian" });

function itemArt(item, className) {
  const category = categoriesById.get(item.category) ?? { tone: "latte", icon: "coffee" };
  const art = h("div", { class: `${className} tone-${category.tone}` });
  if (item.image) {
    const img = h("img", { src: item.image, alt: "", loading: "lazy", decoding: "async" });
    img.addEventListener("error", () => img.replaceWith(icon(category.icon)), { once: true });
    art.append(img);
  } else {
    art.append(icon(category.icon));
  }
  return art;
}

function itemTags(item) {
  return [
    item.bestseller ? h("span", { class: "tag" }, icon("heart"), "Bestseller") : null,
    item.spicy ? h("span", { class: "tag tag-spicy" }, icon("chili"), "Spicy") : null
  ];
}

function renderFavourites() {
  const rail = $("#favRail");
  const favourites = state.menu.items.filter((item) => item.bestseller && item.available).slice(0, 8);
  $("#favourites").hidden = favourites.length === 0;
  rail.replaceChildren(
    ...favourites.map((item) => {
      const art = itemArt(item, "fav-art");
      art.prepend(h("span", { class: "badge" }, icon("heart"), "Bestseller"));
      return h(
        "article",
        { class: "fav-card" },
        art,
        h(
          "div",
          { class: "fav-body" },
          h("h3", {}, dietMark(item.veg), item.name),
          h("p", { text: item.description }),
          h("div", { class: "fav-foot" }, h("span", { class: "price", text: rupees(item.price) }), controlFor(item.id))
        )
      );
    })
  );

  updateRailButtons();

  const hero = state.menu.items.find((item) => item.bestseller && item.available && item.category === "shakes") ?? favourites[0];
  if (hero) {
    $("#heroTagName").textContent = hero.name;
    $("#heroTagPrice").textContent = rupees(hero.price);
    $("#heroTag").hidden = false;
  } else {
    $("#heroTag").hidden = true;
  }
}

function updateRailButtons() {
  const rail = $("#favRail");
  const max = rail.scrollWidth - rail.clientWidth - 4;
  $("#favPrev").disabled = rail.scrollLeft <= 4;
  $("#favNext").disabled = rail.scrollLeft >= max;
  $(".rail-nav").hidden = max <= 0;
}

function setupRail() {
  const rail = $("#favRail");
  const step = () => Math.max(260, rail.clientWidth * 0.8);
  $("#favPrev").addEventListener("click", () => rail.scrollBy({ left: -step(), behavior: "smooth" }));
  $("#favNext").addEventListener("click", () => rail.scrollBy({ left: step(), behavior: "smooth" }));
  rail.addEventListener("scroll", updateRailButtons, { passive: true });
  window.addEventListener("resize", updateRailButtons, { passive: true });
}

function renderCategoryNav() {
  const nav = $("#catNav");
  nav.replaceChildren(
    ...state.menu.categories.map((category) =>
      h(
        "button",
        {
          type: "button",
          class: "cat-chip",
          dataset: { cat: category.id },
          onclick: () => document.getElementById(`cat-${category.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" })
        },
        h("span", { class: `chip-icon tone-${category.tone}` }, icon(category.icon)),
        category.name
      )
    )
  );
}

const normalise = (value) => value.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

function visibleItems() {
  const terms = normalise(state.search).split(/\s+/).filter(Boolean);
  return state.menu.items.filter((item) => {
    if (state.vegOnly && !item.veg) return false;
    if (!terms.length) return true;
    const haystack = normalise(`${item.name} ${item.description} ${categoriesById.get(item.category)?.name ?? ""}`);
    return terms.every((term) => haystack.includes(term));
  });
}

let groupObserver = null;

function renderMenu() {
  const list = $("#menuList");
  const items = visibleItems();
  groupObserver?.disconnect();

  if (!items.length) {
    list.replaceChildren(
      h(
        "div",
        { class: "menu-empty" },
        h("strong", { text: "Nothing matches that." }),
        h("p", { text: "Try another search, or turn off Veg only." }),
        h(
          "button",
          {
            type: "button",
            class: "btn btn-ghost",
            onclick: () => {
              state.search = "";
              state.vegOnly = false;
              $("#menuSearch").value = "";
              $("#vegOnly").checked = false;
              renderMenu();
            }
          },
          "Show the full menu"
        )
      )
    );
    $$(".cat-chip").forEach((chip) => (chip.hidden = true));
    return;
  }

  const groups = state.menu.categories
    .map((category) => ({ category, items: items.filter((item) => item.category === category.id) }))
    .filter((group) => group.items.length);

  list.replaceChildren(
    ...groups.map(({ category, items: groupItems }) =>
      h(
        "section",
        { class: "menu-group", id: `cat-${category.id}`, "aria-labelledby": `cat-title-${category.id}` },
        h(
          "header",
          { class: "menu-group-head" },
          h("span", { class: `menu-group-icon tone-${category.tone}` }, icon(category.icon)),
          h("div", {}, h("h3", { id: `cat-title-${category.id}`, text: category.name }), h("p", { text: category.blurb || "" }))
        ),
        h("div", { class: "dish-grid" }, groupItems.map(dishCard))
      )
    )
  );

  const shown = new Set(groups.map((group) => group.category.id));
  $$(".cat-chip").forEach((chip) => (chip.hidden = !shown.has(chip.dataset.cat)));

  const headerHeight = $("#header").offsetHeight;
  groupObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) if (entry.isIntersecting) setActiveChip(entry.target.id.slice(4));
    },
    { rootMargin: `-${headerHeight + 70}px 0px -65% 0px` }
  );
  $$(".menu-group", list).forEach((group) => groupObserver.observe(group));
}

function setActiveChip(categoryId) {
  const nav = $("#catNav");
  for (const chip of $$(".cat-chip", nav)) {
    const active = chip.dataset.cat === categoryId;
    chip.classList.toggle("active", active);
    if (active) nav.scrollTo({ left: chip.offsetLeft - nav.clientWidth / 2 + chip.clientWidth / 2, behavior: "smooth" });
  }
}

function dishCard(item) {
  return h(
    "article",
    { class: `dish${item.available ? "" : " is-soldout"}` },
    itemArt(item, "dish-art"),
    h(
      "div",
      { class: "dish-info" },
      h("div", { class: "dish-top" }, dietMark(item.veg), h("h4", { text: item.name }), itemTags(item)),
      item.description ? h("p", { text: item.description }) : null,
      h("div", { class: "dish-foot" }, h("span", { class: "price", text: rupees(item.price) }), controlFor(item.id))
    )
  );
}

function setupMenuControls() {
  let timer;
  $("#menuSearch").addEventListener("input", (event) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      state.search = event.target.value;
      renderMenu();
    }, 120);
  });
  $("#vegOnly").addEventListener("change", (event) => {
    state.vegOnly = event.target.checked;
    renderMenu();
  });
}

// ---------------------------------------------------------------------------
// Add-to-order controls & cart
// ---------------------------------------------------------------------------

function controlFor(id) {
  const el = h("div", { class: "dish-control", dataset: { control: id } });
  fillControl(el);
  return el;
}

function stepper(id, qty, name) {
  return h(
    "div",
    { class: "stepper", role: "group", "aria-label": `${name} quantity` },
    h("button", { type: "button", "aria-label": `Remove one ${name}`, onclick: () => changeQty(id, -1) }, icon("minus")),
    h("span", { class: "qty", text: String(qty) }),
    h("button", { type: "button", "aria-label": `Add one more ${name}`, onclick: () => changeQty(id, 1) }, icon("plus"))
  );
}

function fillControl(el) {
  const id = el.dataset.control;
  const item = itemsById.get(id);
  const qty = state.cart.get(id) ?? 0;
  if (!item?.available) el.replaceChildren(h("span", { class: "sold-out", text: "Sold out" }));
  else if (!qty) {
    el.replaceChildren(
      h("button", { type: "button", class: "add-btn", "aria-label": `Add ${item.name} to your order`, onclick: () => changeQty(id, 1) }, icon("plus"), "Add")
    );
  } else el.replaceChildren(stepper(id, qty, item.name));
}

/** Re-renders controls while keeping keyboard focus on the equivalent button in the same card. */
function keepFocus(render) {
  const active = document.activeElement;
  const label = active?.getAttribute?.("aria-label");
  const scope = active?.closest?.("[data-control]") ?? null;
  const inCart = Boolean(active?.closest?.("#cartItems"));
  render();
  if (!label || (active.isConnected && document.activeElement === active)) return;
  const root = scope?.isConnected ? scope : inCart ? $("#cartItems") : null;
  if (!root) return;
  const name = label.replace(/^(Add one more |Remove one |Add )/, "").replace(/ to your order$/, "");
  for (const candidate of [label, `Add one more ${name}`, `Add ${name} to your order`]) {
    const match = root.querySelector(`[aria-label="${CSS.escape(candidate)}"]`);
    if (match) {
      match.focus({ preventScroll: true });
      return;
    }
  }
}

function refreshControls(id) {
  keepFocus(() => {
    const selector = id ? `[data-control="${CSS.escape(id)}"]` : "[data-control]";
    $$(selector).forEach(fillControl);
  });
}

function changeQty(id, delta) {
  const item = itemsById.get(id);
  if (!item?.available) return;
  const current = state.cart.get(id) ?? 0;
  const next = Math.max(0, Math.min(MAX_QTY, current + delta));
  if (delta > 0 && current >= MAX_QTY) {
    toast(`You can order up to ${MAX_QTY} of each item online.`);
    return;
  }
  if (next === 0) state.cart.delete(id);
  else state.cart.set(id, next);
  saveCart();
  refreshControls(id);
  updateCartUi(delta > 0);
  updateCartView();
}

function saveCart() {
  storage.set(KEYS.cart, Object.fromEntries(state.cart));
}

function cartLines() {
  return [...state.cart.entries()].map(([id, qty]) => ({ item: itemsById.get(id), qty })).filter((line) => line.item);
}

function cartTotals(lines = cartLines()) {
  const subtotal = lines.reduce((sum, line) => sum + line.item.price * 100 * line.qty, 0);
  const gstPercent = state.site.orders.gstPercent;
  const gst = Math.round((subtotal * gstPercent) / 100);
  return { subtotal, gst, total: subtotal + gst, gstPercent, count: lines.reduce((sum, line) => sum + line.qty, 0) };
}

function updateCartUi(bump = false) {
  const { count, subtotal } = cartTotals();
  const badge = $("#cartCount");
  badge.textContent = String(count);
  badge.hidden = count === 0;
  $("#cartBtn").setAttribute("aria-label", count ? `Open your order, ${count} item${count === 1 ? "" : "s"}` : "Open your order");
  if (bump) {
    const btn = $("#cartBtn");
    btn.classList.remove("bump");
    void btn.offsetWidth;
    btn.classList.add("bump");
  }
  const bar = $("#cartBar");
  bar.hidden = count === 0 || $("#drawer").classList.contains("open");
  $("#cartBarCount").textContent = `${count} item${count === 1 ? "" : "s"}`;
  $("#cartBarTotal").textContent = paise(subtotal);
}

// ---------------------------------------------------------------------------
// Drawer: cart, checkout and live order tracking
// ---------------------------------------------------------------------------

function setupDrawer() {
  $("#cartBtn").addEventListener("click", () => openDrawer("cart"));
  $("#cartBar").addEventListener("click", () => openDrawer("cart"));
  $("#trackChip").addEventListener("click", () => openDrawer("tracker"));
  $("#drawerClose").addEventListener("click", closeDrawer);
  $("#scrim").addEventListener("click", closeDrawer);
  document.addEventListener("keydown", (event) => {
    const drawer = $("#drawer");
    if (!drawer.classList.contains("open")) return;
    if (event.key === "Escape") closeDrawer();
    if (event.key === "Tab") {
      const focusable = $$('button:not([disabled]), a[href], input:not(.hp), select, textarea', drawer).filter((el) => el.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  });
}

function openDrawer(view) {
  state.drawerView = view === "tracker" && state.order ? "tracker" : "cart";
  lastFocus = document.activeElement;
  renderDrawer();
  const drawer = $("#drawer");
  const scrim = $("#scrim");
  scrim.hidden = false;
  requestAnimationFrame(() => scrim.classList.add("show"));
  drawer.inert = false;
  drawer.classList.add("open");
  document.body.style.overflow = "hidden";
  $("#cartBar").hidden = true;
  setTimeout(() => $("#drawerClose").focus(), 60);
}

function closeDrawer() {
  const drawer = $("#drawer");
  const scrim = $("#scrim");
  drawer.classList.remove("open");
  drawer.inert = true;
  scrim.classList.remove("show");
  setTimeout(() => (scrim.hidden = true), 300);
  document.body.style.overflow = "";
  updateCartUi();
  if (lastFocus?.isConnected) lastFocus.focus();
}

function renderDrawer() {
  const body = $("#drawerBody");
  const title = $("#drawerTitle");
  if (state.drawerView === "tracker" && state.order) {
    title.textContent = "Order status";
    body.replaceChildren(trackerView());
    return;
  }
  title.textContent = "Your order";
  const lines = cartLines();
  body.replaceChildren(lines.length ? checkoutView() : emptyCartView());
}

function emptyCartView() {
  return h(
    "div",
    { class: "cart-empty" },
    h("div", { class: "art" }, icon("shake")),
    h("h3", { text: "Your tray is empty" }),
    h("p", { text: "Add a shake, a snack or three. We won't judge." }),
    h(
      "a",
      {
        class: "btn btn-primary",
        href: "#menu",
        onclick: () => closeDrawer()
      },
      "Browse the menu",
      icon("arrow")
    ),
    state.order && ACTIVE_ORDER.has(state.order.status)
      ? h("p", { class: "drawer-note" }, h(
            "a",
            {
              href: "#",
              onclick: (event) => {
                event.preventDefault();
                state.drawerView = "tracker";
                renderDrawer();
              }
            },
            `Track order #${state.order.number}`
          ))
      : null
  );
}

function cartItemsList() {
  return h(
    "ul",
    { class: "cart-items", id: "cartItems" },
    cartLines().map(({ item, qty }) =>
      h(
        "li",
        { class: "cart-line" },
        h(
          "div",
          {},
          h("div", { class: "cart-line-name" }, dietMark(item.veg), h("span", { text: item.name })),
          h("div", { class: "cart-line-price", text: `${rupees(item.price)} each` })
        ),
        h("div", { class: "cart-line-total", text: rupees(item.price * qty) }),
        stepper(item.id, qty, item.name)
      )
    )
  );
}

function summaryBox() {
  const totals = cartTotals();
  return h(
    "div",
    { class: "summary", id: "cartSummary" },
    h("div", {}, h("span", { text: `Subtotal (${totals.count} item${totals.count === 1 ? "" : "s"})` }), h("span", { text: paise(totals.subtotal) })),
    h("div", {}, h("span", { text: `GST (${totals.gstPercent}%)` }), h("span", { text: paise(totals.gst) })),
    h("div", { class: "total" }, h("span", { text: "Total" }), h("span", { text: paise(totals.total) }))
  );
}

function whatsappOrderLink() {
  const lines = cartLines().map(({ item, qty }) => `${qty} × ${item.name}`);
  const where = state.orderType === "dine-in" && state.table ? `Table ${state.table}` : "Pickup";
  const text = `Hi Cafe BAE! I'd like to order (${where}):\n${lines.join("\n")}\nSubtotal: ${paise(cartTotals().subtotal)}`;
  return `https://wa.me/${state.site.whatsapp}?text=${encodeURIComponent(text)}`;
}

function checkoutView() {
  const guest = storage.get(KEYS.guest, {});
  const availability = state.site.orders;
  const tableField = h(
    "label",
    { class: "field", "data-field": "table" },
    h("span", { text: "Table number" }),
    h("input", { name: "table", inputmode: "numeric", maxlength: "8", value: state.table, placeholder: "On the card on your table", required: true })
  );
  tableField.hidden = state.orderType !== "dine-in";

  const typeButton = (type, label, iconName) =>
    h(
      "button",
      {
        type: "button",
        "aria-pressed": String(state.orderType === type),
        onclick: (event) => {
          state.orderType = type;
          $$(".segmented button", event.currentTarget.parentElement).forEach((btn) => btn.setAttribute("aria-pressed", String(btn === event.currentTarget)));
          tableField.hidden = type !== "dine-in";
          const wa = $("#waOrder");
          if (wa) wa.href = whatsappOrderLink();
        }
      },
      icon(iconName),
      label
    );

  const form = h(
    "form",
    { class: "checkout", novalidate: true, onsubmit: placeOrder },
    cartItemsList(),
    h("div", { class: "segmented", role: "group", "aria-label": "How would you like it?" }, typeButton("dine-in", "At my table", "qr"), typeButton("pickup", "Pickup", "bag")),
    tableField,
    h(
      "div",
      { class: "field-row" },
      h("label", { class: "field", "data-field": "name" }, h("span", { text: "Your name" }), h("input", { name: "name", autocomplete: "name", maxlength: "60", value: guest.name || "", required: true })),
      h(
        "label",
        { class: "field", "data-field": "phone" },
        h("span", { text: "Mobile number" }),
        h("input", { name: "phone", type: "tel", inputmode: "tel", autocomplete: "tel", maxlength: "16", value: guest.phone || "", placeholder: "98765 43210", required: true })
      )
    ),
    h(
      "label",
      { class: "field", "data-field": "notes" },
      h("span", {}, "Cooking notes ", h("i", { text: "(optional)" })),
      h("textarea", { name: "notes", rows: "2", maxlength: "300", placeholder: "Less spicy, no onion, extra ice…" })
    ),
    h("input", { class: "hp", name: "company", tabindex: "-1", autocomplete: "off", "aria-hidden": "true" }),
    summaryBox(),
    availability.accepting ? null : h("div", { class: "drawer-alert", role: "status" }, icon("clock"), h("span", { text: availability.reason })),
    h("button", { class: "btn btn-accent btn-block", type: "submit", disabled: !availability.accepting }, "Place order", icon("arrow")),
    state.site.whatsapp
      ? h("a", { class: "btn btn-block wa-btn", id: "waOrder", href: whatsappOrderLink(), target: "_blank", rel: "noopener" }, icon("whatsapp"), "Or send this order on WhatsApp")
      : null,
    h("p", { class: "drawer-note", text: "Pay at the counter or at your table. Prices include GST at checkout." })
  );
  clearErrorsOnInput(form);
  return form;
}

/** Updates the open checkout in place so typed details aren't lost. */
function updateCartView() {
  if (!$("#drawer").classList.contains("open") || state.drawerView !== "cart") return;
  const list = $("#cartItems");
  if (!list || !cartLines().length) {
    renderDrawer();
    return;
  }
  keepFocus(() => {
    list.replaceWith(cartItemsList());
    $("#cartSummary").replaceWith(summaryBox());
  });
  const wa = $("#waOrder");
  if (wa) wa.href = whatsappOrderLink();
}

async function placeOrder(event) {
  event.preventDefault();
  const form = event.currentTarget;
  clearErrors(form);
  const values = formValues(form);
  const button = form.querySelector("[type=submit]");
  storage.set(KEYS.guest, { name: values.name, phone: values.phone });
  if (state.orderType === "dine-in") state.table = values.table;
  setLoading(button, true);
  try {
    const order = await api("/api/orders", {
      method: "POST",
      body: {
        type: state.orderType,
        table: values.table,
        name: values.name,
        phone: values.phone,
        notes: values.notes,
        company: values.company,
        items: cartLines().map(({ item, qty }) => ({ id: item.id, qty }))
      }
    });
    state.cart.clear();
    saveCart();
    refreshControls();
    updateCartUi();
    storage.set(KEYS.order, { id: order.id, at: Date.now() });
    startOrderTracking(order);
    state.drawerView = "tracker";
    renderDrawer();
    toast(`Order #${order.number} sent to the kitchen!`);
  } catch (error) {
    setLoading(button, false);
    showErrors(form, error);
    if (error.status === 409 || error.status === 422) refreshSiteAndMenu();
  }
}

function trackerMessage(order) {
  const where = order.type === "dine-in" ? `to table ${order.table}` : "at the counter";
  switch (order.status) {
    case "received":
      return `Thanks ${order.name.split(" ")[0]}! We've got your order and the kitchen will start on it shortly.`;
    case "preparing":
      return "Our team is making your order right now.";
    case "ready":
      return order.type === "dine-in" ? `It's ready and on its way ${where}.` : `It's ready! Collect it ${where} and show your order number.`;
    case "completed":
      return "Enjoy! Thanks for choosing Cafe BAE. See you again soon.";
    case "cancelled":
      return "This order was cancelled. Please speak to our team at the counter if this is unexpected.";
    default:
      return "";
  }
}

function trackerView() {
  const order = state.order;
  const index = TRACK_STEPS.findIndex((step) => step.status === order.status);
  const progress = Math.max(0, index) / (TRACK_STEPS.length - 1);
  const bar = h("span", { class: "tracker-bar" });
  bar.style.width = `${progress * 75}%`;
  return h(
    "div",
    { class: `tracker${order.status === "cancelled" ? " cancelled" : ""}`, "aria-live": "polite" },
    h("p", { class: "tracker-number", text: order.type === "dine-in" ? `Table ${order.table} · Order` : "Pickup · Order" }),
    h("p", { class: "tracker-big", text: `#${String(order.number).padStart(3, "0")}` }),
    h("p", { class: "tracker-msg", text: trackerMessage(order) }),
    order.status === "cancelled"
      ? null
      : h(
          "ol",
          { class: "tracker-steps" },
          bar,
          TRACK_STEPS.map((step, stepIndex) =>
            h(
              "li",
              { class: `tracker-step${stepIndex < index ? " done" : ""}${stepIndex === index ? " current" : ""}${stepIndex === index && order.status === "completed" ? " done" : ""}` },
              h("span", { class: "dot" }, icon(stepIndex < index ? "check" : step.icon)),
              step.label
            )
          )
        ),
    h(
      "ul",
      { class: "tracker-items" },
      order.items.map((line) => h("li", {}, h("span", { text: `${line.qty} × ${line.name}` }), h("span", { text: rupees(line.price * line.qty) }))),
      h("li", { class: "total" }, h("span", { text: `Total incl. ${order.amounts.gstPercent ?? 5}% GST` }), h("span", { text: paise(order.amounts.total) }))
    ),
    h(
      "button",
      {
        type: "button",
        class: "btn btn-ghost btn-block",
        onclick: () => {
          state.drawerView = "cart";
          renderDrawer();
        }
      },
      ACTIVE_ORDER.has(order.status) ? "Add something else" : "Start a new order"
    ),
    h("p", { class: "drawer-note", text: "This page updates live. You can close it and check back any time from the top bar." })
  );
}

function startOrderTracking(order) {
  orderStream?.close();
  applyOrderUpdate(order);
  if (!ACTIVE_ORDER.has(order.status) || !("EventSource" in window)) return;
  orderStream = new EventSource(`/api/orders/${encodeURIComponent(order.id)}/events`);
  orderStream.onmessage = (event) => {
    try {
      applyOrderUpdate(JSON.parse(event.data));
    } catch {
      /* ignore malformed update */
    }
  };
}

function applyOrderUpdate(order) {
  const previous = state.order?.id === order.id ? state.order.status : null;
  state.order = order;
  const active = ACTIVE_ORDER.has(order.status);
  const chip = $("#trackChip");
  chip.hidden = !active;
  $("#trackChipText").textContent = `#${order.number} · ${TRACK_STEPS.find((step) => step.status === order.status)?.label ?? ""}`;
  chip.setAttribute("aria-label", `Track order ${order.number}, ${order.status}`);

  if (previous && previous !== order.status) {
    if (order.status === "ready") {
      toast(order.type === "dine-in" ? `Order #${order.number} is ready and on its way!` : `Order #${order.number} is ready to collect!`, { timeout: 8000 });
      navigator.vibrate?.([120, 60, 120]);
    } else if (order.status === "preparing") toast(`Order #${order.number} is being prepared.`);
  }
  if (!active) {
    orderStream?.close();
    orderStream = null;
    if (order.status === "completed" || order.status === "cancelled") storage.remove(KEYS.order);
  }
  if ($("#drawer").classList.contains("open") && state.drawerView === "tracker") renderDrawer();
}

async function resumeOrderTracking() {
  const saved = storage.get(KEYS.order, null);
  if (!saved?.id || Date.now() - saved.at > ORDER_TTL_MS) {
    storage.remove(KEYS.order);
    return;
  }
  try {
    const order = await api(`/api/orders/${encodeURIComponent(saved.id)}`);
    if (ACTIVE_ORDER.has(order.status)) startOrderTracking(order);
    else storage.remove(KEYS.order);
  } catch (error) {
    if (error.status === 404) storage.remove(KEYS.order);
  }
}

// ---------------------------------------------------------------------------
// Reservations
// ---------------------------------------------------------------------------

let slotRequest = null;

function setupBooking() {
  const booking = state.booking;
  booking.date = state.site.today;
  renderDateStrip();
  loadSlots();

  const setGuests = (value) => {
    booking.guests = Math.max(1, Math.min(state.site.reservations.maxGuests, value));
    $("#guestsOut").textContent = String(booking.guests);
    $("#guestsMinus").disabled = booking.guests <= 1;
    $("#guestsPlus").disabled = booking.guests >= state.site.reservations.maxGuests;
    renderSlots();
  };
  $("#guestsMinus").addEventListener("click", () => setGuests(booking.guests - 1));
  $("#guestsPlus").addEventListener("click", () => setGuests(booking.guests + 1));
  setGuests(booking.guests);

  const form = $("#bookForm");
  const guest = storage.get(KEYS.guest, {});
  if (guest.name) form.elements.name.value = guest.name;
  if (guest.phone) form.elements.phone.value = guest.phone;
  clearErrorsOnInput(form);
  form.addEventListener("submit", submitBooking);
}

function renderDateStrip() {
  const strip = $("#dateStrip");
  const days = Math.min(13, state.site.reservations.daysAhead);
  strip.replaceChildren(
    ...Array.from({ length: days + 1 }, (_, offset) => {
      const iso = addDays(state.site.today, offset);
      const { weekday, day, month } = dayParts(iso);
      return h(
        "button",
        {
          type: "button",
          class: "date-chip",
          role: "radio",
          "aria-checked": String(iso === state.booking.date),
          "aria-label": formatDay(iso),
          dataset: { date: iso },
          onclick: () => {
            state.booking.date = iso;
            state.booking.time = null;
            $$(".date-chip", strip).forEach((chip) => chip.setAttribute("aria-checked", String(chip.dataset.date === iso)));
            loadSlots();
          }
        },
        h("small", { text: offset === 0 ? "Today" : offset === 1 ? "Tmrw" : weekday }),
        h("strong", { text: String(day) }),
        h("span", { text: month })
      );
    })
  );
}

async function loadSlots() {
  slotRequest?.abort();
  slotRequest = new AbortController();
  const grid = $("#slotGrid");
  grid.replaceChildren(...Array.from({ length: 8 }, () => h("span", { class: "slot-skeleton", "aria-hidden": "true" })));
  $("#slotMsg").textContent = "";
  try {
    const data = await api(`/api/availability?date=${state.booking.date}`, { signal: slotRequest.signal });
    state.booking.slots = data.slots;
    state.booking.message = data.message;
    renderSlots();
  } catch (error) {
    if (error.name === "AbortError") return;
    grid.replaceChildren();
    $("#slotMsg").textContent = error.message;
  }
}

function renderSlots() {
  const { slots, guests, message } = state.booking;
  const grid = $("#slotGrid");
  if (!slots) return;
  if (state.booking.time && !slots.some((slot) => slot.time === state.booking.time && slot.seatsLeft >= guests)) state.booking.time = null;
  grid.replaceChildren(
    ...slots.map((slot) => {
      const full = slot.seatsLeft < guests;
      return h(
        "button",
        {
          type: "button",
          class: "slot",
          role: "radio",
          "aria-checked": String(slot.time === state.booking.time),
          "aria-label": full ? `${slot.label}, not available for ${guests}` : `${slot.label}, ${slot.seatsLeft} seats left`,
          disabled: full,
          onclick: (event) => {
            state.booking.time = slot.time;
            $$(".slot", grid).forEach((btn) => btn.setAttribute("aria-checked", String(btn === event.currentTarget)));
            const holder = $('[data-field="time"]');
            holder.classList.remove("has-error");
            holder.querySelector(".field-error")?.remove();
          }
        },
        slot.label,
        !full && slot.seatsLeft <= 10 ? h("span", { class: "left", text: `${slot.seatsLeft} left` }) : null
      );
    })
  );
  const available = slots.filter((slot) => slot.seatsLeft >= guests).length;
  $("#slotMsg").textContent =
    message || (slots.length && !available ? `No tables for ${guests} on this day. Try fewer guests, another day, or give us a call.` : "");
}

async function submitBooking(event) {
  event.preventDefault();
  const form = event.currentTarget;
  clearErrors(form);
  if (!state.booking.time) {
    showErrors(form, { fields: { time: "Pick a time that works for you." } });
    $("#slotGrid").scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  const values = formValues(form);
  storage.set(KEYS.guest, { ...storage.get(KEYS.guest, {}), name: values.name, phone: values.phone });
  const button = $("#bookSubmit");
  setLoading(button, true);
  try {
    const booking = await api("/api/reservations", {
      method: "POST",
      body: { ...values, date: state.booking.date, time: state.booking.time, guests: state.booking.guests }
    });
    showBookingDone(booking, values.phone);
  } catch (error) {
    showErrors(form, error);
    if (error.status === 409) loadSlots();
  } finally {
    setLoading(button, false);
  }
}

function showBookingDone(booking, phone) {
  const form = $("#bookForm");
  const done = $("#bookDone");
  done.replaceChildren(
    h("div", { class: "success-icon" }, icon("check")),
    h("h3", { text: "Request received!" }),
    h("p", { text: `Thanks ${booking.name.split(" ")[0]}. We'll call or WhatsApp you on ${phone} to confirm your table.` }),
    h("div", { class: "booking-code", "aria-label": `Booking code ${booking.code}`, text: booking.code }),
    h(
      "div",
      { class: "booking-summary" },
      h("span", {}, icon("calendar"), formatDay(booking.date)),
      h("span", {}, icon("clock"), booking.time),
      h("span", {}, icon("users"), `${booking.guests} guest${booking.guests === 1 ? "" : "s"}`)
    ),
    h(
      "button",
      {
        type: "button",
        class: "btn btn-ghost",
        onclick: () => {
          done.hidden = true;
          form.hidden = false;
          form.elements.notes.value = "";
          state.booking.time = null;
          loadSlots();
        }
      },
      "Make another booking"
    )
  );
  form.hidden = true;
  done.hidden = false;
  $("#bookCard").scrollIntoView({ behavior: "smooth", block: "center" });
}

// ---------------------------------------------------------------------------
// Reviews, enquiries & newsletter
// ---------------------------------------------------------------------------

function starRow(rating) {
  return h(
    "span",
    { class: "stars", role: "img", "aria-label": `${rating} out of 5 stars` },
    [1, 2, 3, 4, 5].map((n) => icon("star", n <= Math.round(rating) ? "icon" : "icon off"))
  );
}

async function setupReviews() {
  const form = $("#reviewForm");
  clearErrorsOnInput(form);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = formValues(form);
    const button = form.querySelector("[type=submit]");
    setLoading(button, true);
    try {
      await api("/api/reviews", { method: "POST", body: { ...values, rating: values.rating ? Number(values.rating) : undefined } });
      showFormSuccess(form, "Thank you!", "Your review will appear here once our team has had a quick look.");
    } catch (error) {
      showErrors(form, error);
    } finally {
      setLoading(button, false);
    }
  });

  try {
    renderReviews(await api("/api/reviews"));
  } catch {
    renderReviews({ stats: { count: 0 }, reviews: [] });
  }
}

function renderReviews({ stats, reviews }) {
  const statsEl = $("#reviewStats");
  statsEl.replaceChildren(
    ...(stats.count
      ? [
          h("span", { class: "big", text: stats.average.toFixed(1) }),
          h("div", {}, starRow(stats.average), h("p", { class: "meta", text: `from ${stats.count} guest review${stats.count === 1 ? "" : "s"}` }))
        ]
      : [])
  );
  const list = $("#reviewList");
  if (!reviews.length) {
    list.replaceChildren(
      h(
        "div",
        { class: "review-empty" },
        icon("heart"),
        h("strong", { text: "Be the first love note" }),
        h("p", { text: "Tell us about your favourite shake, your go-to corner or your last celebration with us." })
      )
    );
    return;
  }
  list.replaceChildren(
    ...reviews.map((review) =>
      h(
        "article",
        { class: "review-card" },
        starRow(review.rating),
        h("blockquote", { text: `“${review.text}”` }),
        h(
          "footer",
          {},
          h("span", { class: "avatar", "aria-hidden": "true", text: review.name.trim().charAt(0).toUpperCase() }),
          h("div", {}, h("strong", { text: review.name }), " ", h("span", { text: `· ${timeAgo(review.createdAt)}` }))
        )
      )
    )
  );
}

function showFormSuccess(form, title, message) {
  const original = [...form.children];
  const again = h(
    "button",
    {
      type: "button",
      class: "btn btn-ghost",
      onclick: () => {
        form.reset();
        clearErrors(form);
        form.replaceChildren(...original);
        form.querySelector("input:not(.hp), textarea")?.focus();
      }
    },
    "Send another"
  );
  form.replaceChildren(h("div", { class: "success-card", role: "status" }, h("div", { class: "success-icon" }, icon("check")), h("h3", { text: title }), h("p", { text: message }), h("br"), again));
}

function setupEnquiry() {
  const form = $("#enquiryForm");
  $("#enquiryDate").min = state.site.today;
  const guest = storage.get(KEYS.guest, {});
  if (guest.name) form.elements.name.value = guest.name;
  if (guest.phone) form.elements.phone.value = guest.phone;
  clearErrorsOnInput(form);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = formValues(form);
    const button = form.querySelector("[type=submit]");
    setLoading(button, true);
    try {
      await api("/api/enquiries", {
        method: "POST",
        body: { ...values, type: "event", guests: values.guests ? Number(values.guests) : undefined }
      });
      showFormSuccess(form, "We're on it!", "Thanks for reaching out. Our team will call you within a day to plan the details.");
    } catch (error) {
      showErrors(form, error);
    } finally {
      setLoading(button, false);
    }
  });
}

function setupNewsletter() {
  const form = $("#newsletterForm");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = form.querySelector("[type=submit]");
    setLoading(button, true);
    try {
      await api("/api/subscribe", { method: "POST", body: formValues(form) });
      form.reset();
      toast("You're on the list. Watch your inbox for new drops!");
    } catch (error) {
      toast(error.fields?.email || error.message, { type: "error" });
      form.elements.email.focus();
    } finally {
      setLoading(button, false);
    }
  });
}

// ---------------------------------------------------------------------------
// Header, navigation and motion
// ---------------------------------------------------------------------------

function setupHeader() {
  const header = $("#header");
  const onScroll = () => header.classList.toggle("scrolled", window.scrollY > 8);
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  $("#announceClose").addEventListener("click", () => {
    storage.set(KEYS.announcement, state.site.announcement);
    $("#announce").hidden = true;
  });

  const nav = $("#nav");
  const toggle = $("#menuToggle");
  const setOpen = (open) => {
    nav.classList.toggle("open", open);
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", open ? "Close navigation" : "Open navigation");
  };
  toggle.addEventListener("click", () => setOpen(!nav.classList.contains("open")));
  nav.addEventListener("click", (event) => {
    if (event.target.closest("a")) setOpen(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && nav.classList.contains("open")) {
      setOpen(false);
      toggle.focus();
    }
  });

  const links = new Map($$("a[href^='#']", nav).map((link) => [link.getAttribute("href").slice(1), link]));
  const spy = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        links.forEach((link, id) => link.classList.toggle("active", id === entry.target.id));
      }
    },
    { rootMargin: "-45% 0px -50% 0px" }
  );
  links.forEach((_, id) => {
    const section = document.getElementById(id);
    if (section) spy.observe(section);
  });
}

let revealObserver = null;

function setupReveal() {
  if (!("IntersectionObserver" in window)) {
    $$(".reveal").forEach((el) => el.classList.add("in"));
    return;
  }
  revealObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("in");
        revealObserver.unobserve(entry.target);
      }
    },
    { rootMargin: "0px 0px -8% 0px", threshold: 0.08 }
  );
  observeReveal(document);
}

function observeReveal(root) {
  if (!revealObserver) return;
  $$(".reveal:not(.in)", root).forEach((el, index) => {
    el.style.transitionDelay = `${Math.min(index % 4, 3) * 70}ms`;
    revealObserver.observe(el);
  });
}

// ---------------------------------------------------------------------------
// Live refresh: opening status, sold-out items and announcements stay current
// ---------------------------------------------------------------------------

async function refreshSiteAndMenu() {
  try {
    const [site, menu] = await Promise.all([api("/api/site"), api("/api/menu")]);
    const acceptingChanged = site.orders.accepting !== state.site.orders.accepting;
    state.site = site;
    renderSite();
    if (JSON.stringify(menu) !== JSON.stringify(state.menu)) {
      state.menu = menu;
      indexMenu();
      renderFavourites();
      renderCategoryNav();
      renderMenu();
      updateCartUi();
      updateCartView();
    }
    if (acceptingChanged && $("#drawer").classList.contains("open") && state.drawerView === "cart" && !$("#drawer input:focus, #drawer textarea:focus")) {
      renderDrawer();
    }
  } catch {
    /* offline: keep showing what we have */
  }
}

function startLiveRefresh() {
  setInterval(() => {
    if (document.visibilityState === "visible") refreshSiteAndMenu();
  }, 60_000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      refreshSiteAndMenu();
      if (state.order && ACTIVE_ORDER.has(state.order.status) && !orderStream) startOrderTracking(state.order);
    }
  });
}

init();
