import { api, clearErrorsOnInput, formValues, formatDay, h, icon, paise, rupees, setLoading, showErrors, timeAgo, toast } from "./lib.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const TOKEN_KEY = "bae.admin.token";
const POLL_MS = 8000;
const DAYS = [
  ["mon", "Monday"],
  ["tue", "Tuesday"],
  ["wed", "Wednesday"],
  ["thu", "Thursday"],
  ["fri", "Friday"],
  ["sat", "Saturday"],
  ["sun", "Sunday"]
];
const OCCASION_LABELS = {
  birthday: "Birthday",
  date: "Date night",
  anniversary: "Anniversary",
  friends: "Friends",
  family: "Family",
  work: "Work",
  other: "Other"
};
const ORDER_FLOW = {
  received: [["preparing", "Start preparing", "btn-primary"], ["cancelled", "Cancel", "btn-quiet"]],
  preparing: [["ready", "Mark ready", "btn-accent"]],
  ready: [["completed", "Complete", "btn-primary"]]
};

const state = {
  token: null,
  tab: "overview",
  summary: null,
  orderScope: "active",
  bookingScope: "upcoming",
  reviewFilter: "pending",
  menuFilter: { q: "", category: "all" },
  seenOrders: null,
  unseen: 0,
  lastActiveJson: "",
  audio: null,
  timer: null
};

const VIEWS = {
  overview: { title: "Overview", sub: "Today at a glance", render: renderOverview },
  orders: { title: "Orders", sub: "Live kitchen queue. New orders chime automatically.", render: renderOrders },
  bookings: { title: "Bookings", sub: "Confirm tables and keep guests in the loop.", render: renderBookings },
  menu: { title: "Menu", sub: "Prices, sold-out items and bestsellers update on the website instantly.", render: renderMenu },
  reviews: { title: "Reviews", sub: "Approve reviews before they appear on the website.", render: renderReviews },
  enquiries: { title: "Parties & events", sub: "Enquiries from the website's party form.", render: renderEnquiries },
  subscribers: { title: "Subscribers", sub: "People who signed up for news and new drops.", render: renderSubscribers },
  settings: { title: "Settings", sub: "Announcement bar, opening hours and table QR links.", render: renderSettings }
};

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

function readToken() {
  try {
    return sessionStorage.getItem(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function storeToken(token, remember) {
  try {
    sessionStorage.setItem(TOKEN_KEY, token);
    if (remember) localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* ignore */
  }
}

function forgetToken() {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

async function call(path, options = {}) {
  try {
    return await api(path, { ...options, token: state.token });
  } catch (error) {
    if (error.status === 401) signOut("Please sign in again.");
    throw error;
  }
}

function showLogin(message) {
  $("#app").hidden = true;
  $("#login").hidden = false;
  const form = $("#loginForm");
  if (message) showErrors(form, { fields: { token: message } });
  form.elements.token.focus();
}

function signOut(message) {
  clearInterval(state.timer);
  state.token = null;
  forgetToken();
  showLogin(message);
}

function unlockAudio() {
  try {
    state.audio ??= new AudioContext();
    if (state.audio.state === "suspended") state.audio.resume();
  } catch {
    /* audio unavailable */
  }
}

function chime() {
  if (!state.audio) return;
  const ctx = state.audio;
  [880, 1320].forEach((frequency, index) => {
    const start = ctx.currentTime + index * 0.18;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.25, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.45);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + 0.5);
  });
}

// ---------------------------------------------------------------------------
// App shell
// ---------------------------------------------------------------------------

async function start() {
  const form = $("#loginForm");
  clearErrorsOnInput(form);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    unlockAudio();
    const values = formValues(form);
    const button = form.querySelector("[type=submit]");
    setLoading(button, true);
    try {
      state.token = values.token.trim();
      state.summary = await api("/api/admin/summary", { token: state.token });
      storeToken(state.token, Boolean(values.remember));
      form.reset();
      showApp();
    } catch (error) {
      state.token = null;
      showErrors(form, { fields: { token: error.message } });
    } finally {
      setLoading(button, false);
    }
  });

  state.token = readToken();
  if (!state.token) return showLogin();
  try {
    state.summary = await call("/api/admin/summary");
    showApp();
  } catch {
    if (!state.token) return;
    showLogin("Couldn't reach the server. Try again.");
  }
}

function showApp() {
  $("#login").hidden = true;
  $("#app").hidden = false;
  document.addEventListener("click", unlockAudio, { once: true });

  $$("#tabs button").forEach((button) => button.addEventListener("click", () => switchTab(button.dataset.tab)));
  $("#signOut").onclick = () => signOut();
  $("#refreshBtn").onclick = () => {
    poll();
    renderView();
  };
  $("#pauseOrders").onchange = async (event) => {
    const paused = event.target.checked;
    try {
      await call("/api/admin/settings", { method: "PATCH", body: { ordersPaused: paused } });
      toast(paused ? "Online orders paused. The website now asks guests to order at the counter." : "Online orders are open again.");
      poll();
    } catch (error) {
      event.target.checked = !paused;
      toast(error.message, { type: "error" });
    }
  };
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      state.unseen = 0;
      updateTitle();
    }
  });

  const fromHash = location.hash.slice(1);
  switchTab(VIEWS[fromHash] ? fromHash : "overview");
  renderChrome();
  clearInterval(state.timer);
  state.timer = setInterval(poll, POLL_MS);
  poll();
}

function switchTab(tab) {
  state.tab = tab;
  history.replaceState(null, "", `#${tab}`);
  $$("#tabs button").forEach((button) => {
    if (button.dataset.tab === tab) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  $("#viewTitle").textContent = VIEWS[tab].title;
  $("#viewSub").textContent = VIEWS[tab].sub;
  state.lastActiveJson = "";
  renderView();
}

async function renderView() {
  const view = $("#view");
  const tab = state.tab;
  if (!view.childElementCount) view.replaceChildren(h("div", { class: "loading" }, "Loading…"));
  try {
    const content = await VIEWS[tab].render();
    if (state.tab === tab && content) view.replaceChildren(content);
  } catch (error) {
    if (state.tab === tab) view.replaceChildren(emptyState("Couldn't load this section", error.message));
  }
}

function renderChrome() {
  const summary = state.summary;
  if (!summary) return;
  const pill = $("#adminStatus");
  pill.className = `status-pill ${summary.status.open ? (summary.status.closingSoon ? "is-soon" : "is-open") : "is-closed"}`;
  pill.querySelector("span").textContent = summary.status.label;
  $("#pauseOrders").checked = summary.ordersPaused;
  const counts = {
    orders: summary.orders.active,
    bookings: summary.reservations.pending,
    reviews: summary.reviews.pending,
    enquiries: summary.enquiries.open
  };
  for (const [key, value] of Object.entries(counts)) $(`[data-count="${key}"]`).textContent = value ? String(value) : "";
}

function updateTitle() {
  document.title = state.unseen ? `(${state.unseen}) New order · Cafe BAE` : "Cafe BAE · Staff dashboard";
}

async function poll() {
  if (!state.token) return;
  try {
    const [summary, active] = await Promise.all([call("/api/admin/summary"), call("/api/admin/orders?scope=active")]);
    state.summary = summary;
    renderChrome();
    const fresh = active.orders.filter((order) => order.status === "received" && state.seenOrders && !state.seenOrders.has(order.id));
    state.seenOrders = new Set([...(state.seenOrders ?? []), ...active.orders.map((order) => order.id)]);
    if (fresh.length) {
      chime();
      toast(fresh.length === 1 ? `New order #${fresh[0].number} from ${fresh[0].name}` : `${fresh.length} new orders`);
      if (document.visibilityState !== "visible") {
        state.unseen += fresh.length;
        updateTitle();
      }
    }
    const json = JSON.stringify(active.orders);
    if (json !== state.lastActiveJson && (state.tab === "overview" || (state.tab === "orders" && state.orderScope === "active"))) {
      state.lastActiveJson = json;
      renderView();
    }
  } catch {
    /* transient network error: try again next tick */
  }
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

const pad = (n) => String(n).padStart(3, "0");
const dietMark = (veg) => h("i", { class: `diet ${veg ? "veg" : "nonveg"}`, role: "img", "aria-label": veg ? "Veg" : "Non-veg" });
const emptyState = (title, text) => h("div", { class: "empty" }, h("strong", { text: title }), h("p", { text }));
const telLink = (phone) => h("a", { href: `tel:${phone}`, text: phone });
const waLink = (phone, text, label = "WhatsApp") =>
  h("a", { class: "btn btn-sm btn-quiet", href: `https://wa.me/${phone.replace(/\D/g, "")}?text=${encodeURIComponent(text)}`, target: "_blank", rel: "noopener" }, icon("whatsapp"), label);

function segmented(options, current, onChange) {
  return h(
    "div",
    { class: "seg", role: "group" },
    options.map(([value, label]) =>
      h("button", { type: "button", "aria-pressed": String(value === current), onclick: () => onChange(value) }, label)
    )
  );
}

function switchControl(checked, label, onChange) {
  const input = h("input", { type: "checkbox", "aria-label": label });
  input.checked = checked;
  input.addEventListener("change", () => onChange(input.checked, input));
  return h("label", { class: "mini-switch" }, input, h("span", { class: "switch", "aria-hidden": "true" }));
}

async function patch(path, body, successMessage) {
  try {
    const result = await call(path, { method: "PATCH", body });
    if (successMessage) toast(successMessage);
    poll();
    return result;
  } catch (error) {
    toast(error.fields ? Object.values(error.fields)[0] || error.message : error.message, { type: "error" });
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

async function renderOverview() {
  const [summary, active, today] = await Promise.all([
    call("/api/admin/summary"),
    call("/api/admin/orders?scope=active"),
    call("/api/admin/reservations?scope=today")
  ]);
  state.summary = summary;
  renderChrome();
  const tiles = [
    ["Orders today", summary.orders.today, "receipt", "blush"],
    ["Revenue today", paise(summary.orders.revenueToday), "sparkle", "butter", "incl. GST, excl. cancelled"],
    ["In the kitchen", summary.orders.active, "chef", "peach"],
    ["Bookings today", summary.reservations.today, "calendar", "sage", `${summary.reservations.guestsToday} guests expected`],
    ["To confirm", summary.reservations.pending, "bell", "latte", "upcoming bookings"],
    ["Reviews to check", summary.reviews.pending, "star", "berry"]
  ];
  const bookings = today.reservations.filter((r) => !["cancelled", "no-show"].includes(r.status));
  return h(
    "div",
    {},
    h(
      "div",
      { class: "kpi-grid" },
      tiles.map(([label, value, iconName, tone, note]) =>
        h("div", { class: "kpi" }, h("span", { class: `kpi-icon tone-${tone}` }, icon(iconName)), h("strong", { text: String(value) }), h("span", { text: label }), note ? h("small", { text: note }) : null)
      )
    ),
    h(
      "div",
      { class: "panels" },
      h(
        "section",
        { class: "panel" },
        h("h2", {}, "Kitchen queue", h("button", { type: "button", class: "link-btn", onclick: () => switchTab("orders") }, "Open orders →")),
        active.orders.length ? active.orders.map((order) => orderCard(order, true)) : emptyState("All caught up", "New orders will appear here with a chime.")
      ),
      h(
        "section",
        { class: "panel" },
        h("h2", {}, "Today's bookings", h("button", { type: "button", class: "link-btn", onclick: () => switchTab("bookings") }, "All bookings →")),
        bookings.length
          ? h(
              "ul",
              { class: "mini-list" },
              bookings.map((r) =>
                h(
                  "li",
                  {},
                  h("strong", { text: r.timeLabel }),
                  h("span", { text: `${r.name} · ${r.guests} guest${r.guests === 1 ? "" : "s"}${r.occasion ? ` · ${OCCASION_LABELS[r.occasion]}` : ""}` }),
                  h("span", { class: `status-badge st-${r.status}`, text: r.status })
                )
              )
            )
          : emptyState("No bookings today", "Online bookings will show up here.")
      )
    )
  );
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

function orderCard(order, compact = false) {
  const actions = ORDER_FLOW[order.status] ?? [];
  const isNew = order.status === "received" && Date.now() - new Date(order.createdAt).getTime() < 90_000;
  return h(
    "article",
    { class: `order-card st-${order.status}${isNew ? " is-new" : ""}` },
    h(
      "div",
      { class: "oc-head" },
      h("strong", { class: "oc-num", text: `#${pad(order.number)}` }),
      h("span", { class: `chip${order.type === "dine-in" ? " chip-table" : ""}`, text: order.type === "dine-in" ? `Table ${order.table}` : "Pickup" }),
      h("span", { class: "oc-time", title: new Date(order.createdAt).toLocaleString("en-IN"), text: timeAgo(order.createdAt) })
    ),
    h(
      "ul",
      { class: "oc-items" },
      order.items.map((line) => h("li", {}, h("b", { text: `${line.qty}×` }), dietMark(line.veg), h("span", { text: line.name })))
    ),
    order.notes ? h("p", { class: "oc-notes" }, icon("chef"), h("span", { text: order.notes })) : null,
    compact ? null : h("p", { class: "oc-cust" }, h("span", { text: order.name }), "·", telLink(order.phone)),
    h(
      "div",
      { class: "oc-foot" },
      h("span", { class: "oc-total", text: paise(order.amounts.total) }),
      actions.length
        ? h(
            "div",
            { class: "oc-actions" },
            actions.map(([status, label, style]) =>
              h(
                "button",
                {
                  type: "button",
                  class: `btn btn-sm ${style}`,
                  onclick: async (event) => {
                    if (status === "cancelled" && !confirm(`Cancel order #${pad(order.number)}?`)) return;
                    setLoading(event.currentTarget, true);
                    try {
                      await patch(`/api/admin/orders/${order.id}`, { status }, `Order #${pad(order.number)} → ${status}`);
                      state.lastActiveJson = "";
                      renderView();
                    } catch {
                      setLoading(event.currentTarget, false);
                    }
                  }
                },
                label
              )
            )
          )
        : h("span", { class: `status-badge st-${order.status}`, text: order.status })
    )
  );
}

async function renderOrders() {
  const scope = state.orderScope;
  const { orders } = await call(`/api/admin/orders?scope=${scope}`);
  const toolbar = h(
    "div",
    { class: "toolbar" },
    segmented(
      [
        ["active", "Live board"],
        ["today", "Today"],
        ["all", "All orders"]
      ],
      scope,
      (value) => {
        state.orderScope = value;
        state.lastActiveJson = "";
        renderView();
      }
    )
  );
  if (scope === "active") {
    const columns = [
      ["received", "New"],
      ["preparing", "Preparing"],
      ["ready", "Ready"]
    ];
    return h(
      "div",
      {},
      toolbar,
      h(
        "div",
        { class: "board" },
        columns.map(([status, label]) => {
          const list = orders.filter((order) => order.status === status);
          return h(
            "section",
            { class: `col col-${status}` },
            h("header", { class: "col-head" }, h("span", { text: label }), h("span", { class: "n", text: String(list.length) })),
            list.length ? list.map((order) => orderCard(order)) : h("p", { class: "col-empty", text: "Nothing here" })
          );
        })
      )
    );
  }
  return h("div", {}, toolbar, orders.length ? h("div", { class: "card-grid" }, orders.map((order) => orderCard(order))) : emptyState("No orders yet", "Orders placed on the website will appear here."));
}

// ---------------------------------------------------------------------------
// Bookings
// ---------------------------------------------------------------------------

async function renderBookings() {
  const scope = state.bookingScope;
  const { reservations } = await call(`/api/admin/reservations?scope=${scope}`);
  const toolbar = h(
    "div",
    { class: "toolbar" },
    segmented(
      [
        ["upcoming", "Upcoming"],
        ["today", "Today"],
        ["past", "Past"]
      ],
      scope,
      (value) => {
        state.bookingScope = value;
        renderView();
      }
    )
  );
  if (!reservations.length) return h("div", {}, toolbar, emptyState("No bookings here", "Bookings made on the website will appear here."));
  return h(
    "div",
    {},
    toolbar,
    h(
      "div",
      { class: "list" },
      reservations.map((r) => {
        const select = h(
          "select",
          { "aria-label": `Status for ${r.name}` },
          ["pending", "confirmed", "seated", "cancelled", "no-show"].map((status) => h("option", { value: status, selected: status === r.status }, status))
        );
        select.addEventListener("change", async () => {
          try {
            await patch(`/api/admin/reservations/${r.id}`, { status: select.value }, `Booking ${r.code} → ${select.value}`);
            renderView();
          } catch {
            select.value = r.status;
          }
        });
        const confirmText = `Hi ${r.name.split(" ")[0]}, your table for ${r.guests} at Cafe BAE on ${formatDay(r.date)} at ${r.timeLabel} is confirmed. Booking code: ${r.code}. See you soon!`;
        return h(
          "article",
          { class: `row-card st-${r.status}` },
          h("div", { class: "row-when" }, h("strong", { text: r.timeLabel }), h("span", { text: formatDay(r.date) })),
          h(
            "div",
            { class: "row-main" },
            h("p", { class: "row-title" }, h("strong", { text: r.name }), ` · ${r.guests} guest${r.guests === 1 ? "" : "s"}`, r.occasion ? h("span", { class: "chip", text: OCCASION_LABELS[r.occasion] }) : null),
            h("p", { class: "row-meta" }, telLink(r.phone), r.email ? ` · ${r.email}` : "", ` · Code ${r.code} · booked ${timeAgo(r.createdAt)}`),
            r.notes ? h("p", { class: "oc-notes" }, icon("chef"), h("span", { text: r.notes })) : null
          ),
          h("div", { class: "row-actions" }, r.status === "pending" ? waLink(r.phone, confirmText, "Confirm on WhatsApp") : null, select)
        );
      })
    )
  );
}

// ---------------------------------------------------------------------------
// Menu
// ---------------------------------------------------------------------------

async function renderMenu() {
  const menu = await call("/api/admin/menu");
  const categories = new Map(menu.categories.map((c) => [c.id, c]));
  const tbody = h("tbody");

  const drawRows = () => {
    const q = state.menuFilter.q.toLowerCase();
    const items = menu.items.filter(
      (item) => (state.menuFilter.category === "all" || item.category === state.menuFilter.category) && (!q || `${item.name} ${item.description}`.toLowerCase().includes(q))
    );
    tbody.replaceChildren(
      ...items.map((item) => {
        const price = h("input", { class: "price-input", type: "number", min: "0", max: "100000", step: "1", value: String(item.price), "aria-label": `Price for ${item.name}` });
        price.addEventListener("change", async () => {
          const value = Number(price.value);
          try {
            await patch(`/api/admin/menu/items/${item.id}`, { price: value }, `${item.name}: ${rupees(value)}`);
            item.price = value;
          } catch {
            price.value = String(item.price);
          }
        });
        const toggle = (key, label) =>
          switchControl(key === "bestseller" ? Boolean(item.bestseller) : item[key] !== false, `${label}: ${item.name}`, async (checked, input) => {
            try {
              const messages = {
                available: checked ? `${item.name} is back in stock` : `${item.name} marked sold out`,
                bestseller: checked ? `${item.name} added to bestsellers` : `${item.name} removed from bestsellers`,
                veg: `${item.name} marked ${checked ? "veg" : "non-veg"}`
              };
              await patch(`/api/admin/menu/items/${item.id}`, { [key]: checked }, messages[key]);
              item[key] = checked;
              if (key === "veg" || key === "available") drawRows();
            } catch {
              input.checked = !checked;
            }
          });
        return h(
          "tr",
          { class: item.available === false ? "is-off" : null },
          h("td", {}, h("div", { class: "name" }, dietMark(item.veg !== false), h("span", { text: item.name })), item.description ? h("div", { class: "desc", text: item.description }) : null),
          h("td", { text: categories.get(item.category)?.name ?? item.category }),
          h("td", {}, h("div", { class: "price-cell" }, "₹", price)),
          h("td", {}, toggle("available", "In stock")),
          h("td", {}, toggle("bestseller", "Bestseller")),
          h("td", {}, toggle("veg", "Veg")),
          h(
            "td",
            {},
            h(
              "button",
              {
                type: "button",
                class: "icon-btn",
                "aria-label": `Delete ${item.name}`,
                onclick: async () => {
                  if (!confirm(`Delete "${item.name}" from the menu? This can't be undone.`)) return;
                  try {
                    await call(`/api/admin/menu/items/${item.id}`, { method: "DELETE" });
                    menu.items.splice(menu.items.indexOf(item), 1);
                    toast(`${item.name} deleted`);
                    drawRows();
                  } catch (error) {
                    toast(error.message, { type: "error" });
                  }
                }
              },
              icon("trash")
            )
          )
        );
      })
    );
    if (!items.length) tbody.replaceChildren(h("tr", {}, h("td", { colspan: "7", class: "muted", text: "No items match." })));
  };

  const search = h("input", { class: "admin-search", type: "search", placeholder: "Search menu…", value: state.menuFilter.q, "aria-label": "Search menu" });
  search.addEventListener("input", () => {
    state.menuFilter.q = search.value;
    drawRows();
  });
  const catSelect = h(
    "select",
    { class: "admin-select", "aria-label": "Category" },
    h("option", { value: "all" }, "All categories"),
    menu.categories.map((c) => h("option", { value: c.id, selected: c.id === state.menuFilter.category }, c.name))
  );
  catSelect.addEventListener("change", () => {
    state.menuFilter.category = catSelect.value;
    drawRows();
  });

  const addForm = h(
    "form",
    { class: "add-form", novalidate: true, hidden: true },
    h("h2", { class: "span-4", text: "Add a menu item" }),
    h("label", { class: "field span-2", "data-field": "name" }, h("span", { text: "Name" }), h("input", { name: "name", maxlength: "60", required: true })),
    h(
      "label",
      { class: "field", "data-field": "category" },
      h("span", { text: "Category" }),
      h("select", { name: "category" }, menu.categories.map((c) => h("option", { value: c.id }, c.name)))
    ),
    h("label", { class: "field", "data-field": "price" }, h("span", { text: "Price (₹)" }), h("input", { name: "price", type: "number", min: "0", step: "1", required: true })),
    h("label", { class: "field span-4", "data-field": "description" }, h("span", { text: "Description" }), h("input", { name: "description", maxlength: "200" })),
    h("label", { class: "field span-2", "data-field": "image" }, h("span", {}, "Photo link ", h("i", { text: "(optional, https:// or /images/…)" })), h("input", { name: "image", maxlength: "500" })),
    h(
      "div",
      { class: "add-checks span-2" },
      h("label", { class: "check" }, h("input", { type: "checkbox", name: "veg", checked: true }), "Vegetarian"),
      h("label", { class: "check" }, h("input", { type: "checkbox", name: "bestseller" }), "Bestseller"),
      h("label", { class: "check" }, h("input", { type: "checkbox", name: "spicy" }), "Spicy")
    ),
    h("div", { class: "span-4 add-actions" }, h("button", { type: "submit", class: "btn btn-primary" }, icon("plus"), "Add to menu"))
  );
  clearErrorsOnInput(addForm);
  addForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = formValues(addForm);
    const button = addForm.querySelector("[type=submit]");
    setLoading(button, true);
    try {
      const { item } = await call("/api/admin/menu/items", {
        method: "POST",
        body: {
          name: values.name,
          category: values.category,
          price: values.price === "" ? undefined : Number(values.price),
          description: values.description,
          image: values.image || undefined,
          veg: Boolean(values.veg),
          bestseller: Boolean(values.bestseller),
          spicy: Boolean(values.spicy)
        }
      });
      menu.items.push(item);
      toast(`${item.name} added to the menu`);
      addForm.reset();
      addForm.hidden = true;
      drawRows();
    } catch (error) {
      showErrors(addForm, error);
    } finally {
      setLoading(button, false);
    }
  });

  drawRows();
  return h(
    "div",
    {},
    h(
      "div",
      { class: "toolbar" },
      search,
      catSelect,
      h(
        "button",
        {
          type: "button",
          class: "btn btn-sm btn-primary toolbar-end",
          onclick: () => {
            addForm.hidden = !addForm.hidden;
            if (!addForm.hidden) addForm.elements.name.focus();
          }
        },
        icon("plus"),
        "Add item"
      )
    ),
    addForm,
    h(
      "div",
      { class: "table-wrap" },
      h(
        "table",
        { class: "menu-table" },
        h("thead", {}, h("tr", {}, ["Item", "Category", "Price", "In stock", "Bestseller", "Veg", ""].map((label) => h("th", { text: label })))),
        tbody
      )
    )
  );
}

// ---------------------------------------------------------------------------
// Reviews, enquiries, subscribers
// ---------------------------------------------------------------------------

async function renderReviews() {
  const { reviews } = await call("/api/admin/reviews");
  const filter = state.reviewFilter;
  const shown = filter === "all" ? reviews : reviews.filter((r) => r.status === filter);
  const toolbar = h(
    "div",
    { class: "toolbar" },
    segmented(
      [
        ["pending", "To check"],
        ["approved", "Live"],
        ["rejected", "Hidden"],
        ["all", "All"]
      ],
      filter,
      (value) => {
        state.reviewFilter = value;
        renderView();
      }
    )
  );
  if (!shown.length) return h("div", {}, toolbar, emptyState("Nothing here", filter === "pending" ? "You're all caught up." : "No reviews in this list yet."));
  return h(
    "div",
    {},
    toolbar,
    h(
      "div",
      { class: "card-grid" },
      shown.map((review) =>
        h(
          "article",
          { class: "review-admin" },
          h("div", { class: "stars", role: "img", "aria-label": `${review.rating} stars` }, [1, 2, 3, 4, 5].map((n) => icon("star", n <= review.rating ? "icon" : "icon off"))),
          h("p", { class: "review-text", text: review.text }),
          h("p", { class: "row-meta", text: `${review.name} · ${timeAgo(review.createdAt)}` }),
          h(
            "div",
            { class: "oc-actions" },
            review.status !== "approved"
              ? h("button", { type: "button", class: "btn btn-sm btn-primary", onclick: async () => { await patch(`/api/admin/reviews/${review.id}`, { status: "approved" }, "Review is now live on the website"); renderView(); } }, icon("check"), "Approve")
              : null,
            review.status !== "rejected"
              ? h("button", { type: "button", class: "btn btn-sm btn-quiet", onclick: async () => { await patch(`/api/admin/reviews/${review.id}`, { status: "rejected" }, "Review hidden"); renderView(); } }, "Hide")
              : null
          )
        )
      )
    )
  );
}

async function renderEnquiries() {
  const { enquiries } = await call("/api/admin/enquiries");
  if (!enquiries.length) return emptyState("No enquiries yet", "Party and event enquiries from the website will appear here.");
  return h(
    "div",
    { class: "list" },
    enquiries.map((e) =>
      h(
        "article",
        { class: `row-card st-${e.status}` },
        h("div", { class: "row-when" }, h("strong", { text: e.date ? formatDay(e.date) : "Date TBC" }), h("span", { text: e.guests ? `${e.guests} guests` : "Guests TBC" })),
        h(
          "div",
          { class: "row-main" },
          h("p", { class: "row-title" }, h("strong", { text: e.name }), h("span", { class: `status-badge st-${e.status}`, text: e.status === "new" ? "new" : "handled" })),
          h("p", { class: "review-text", text: e.message }),
          h("p", { class: "row-meta" }, telLink(e.phone), e.email ? ` · ${e.email}` : "", ` · ${timeAgo(e.createdAt)}`)
        ),
        h(
          "div",
          { class: "row-actions" },
          waLink(e.phone, `Hi ${e.name.split(" ")[0]}, thanks for your enquiry with Cafe BAE! `),
          h(
            "button",
            {
              type: "button",
              class: "btn btn-sm btn-primary",
              onclick: async () => {
                await patch(`/api/admin/enquiries/${e.id}`, { status: e.status === "new" ? "handled" : "new" }, e.status === "new" ? "Marked as handled" : "Reopened");
                renderView();
              }
            },
            e.status === "new" ? "Mark handled" : "Reopen"
          )
        )
      )
    )
  );
}

async function renderSubscribers() {
  const { subscribers } = await call("/api/admin/subscribers");
  const exportCsv = () => {
    const rows = [["email", "subscribed_at"], ...subscribers.map((s) => [s.email, s.createdAt])];
    const csv = rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
    const link = h("a", { href: URL.createObjectURL(new Blob([csv], { type: "text/csv" })), download: "cafe-bae-subscribers.csv" });
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  };
  return h(
    "div",
    {},
    h(
      "div",
      { class: "toolbar" },
      h("p", { class: "muted", text: `${subscribers.length} subscriber${subscribers.length === 1 ? "" : "s"}` }),
      h("button", { type: "button", class: "btn btn-sm btn-primary toolbar-end", disabled: !subscribers.length, onclick: exportCsv }, "Export CSV")
    ),
    subscribers.length
      ? h(
          "div",
          { class: "table-wrap" },
          h(
            "table",
            { class: "menu-table" },
            h("thead", {}, h("tr", {}, h("th", { text: "Email" }), h("th", { text: "Signed up" }))),
            h("tbody", {}, subscribers.map((s) => h("tr", {}, h("td", { text: s.email }), h("td", { text: new Date(s.createdAt).toLocaleString("en-IN") }))))
          )
        )
      : emptyState("No subscribers yet", "Sign-ups from the website's newsletter box will appear here.")
  );
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

async function renderSettings() {
  const settings = await call("/api/admin/settings");

  const announceForm = h(
    "form",
    { class: "panel", novalidate: true },
    h("h2", { text: "Announcement bar" }),
    h("p", { class: "muted", text: "Shown at the top of the website. Leave empty to hide it." }),
    h("label", { class: "field", "data-field": "announcement" }, h("span", { class: "sr-only", text: "Announcement" }), h("textarea", { name: "announcement", rows: "3", maxlength: "160" }, settings.announcement)),
    h("button", { type: "submit", class: "btn btn-primary" }, "Save announcement")
  );
  announceForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = announceForm.querySelector("[type=submit]");
    setLoading(button, true);
    try {
      await call("/api/admin/settings", { method: "PATCH", body: { announcement: announceForm.elements.announcement.value } });
      toast("Announcement updated on the website");
    } catch (error) {
      showErrors(announceForm, error);
    } finally {
      setLoading(button, false);
    }
  });

  const hoursForm = h(
    "form",
    { class: "panel", novalidate: true },
    h("h2", { text: "Opening hours" }),
    h("p", { class: "muted", text: "Controls the open/closed badge, online ordering and booking times. Times are IST." }),
    h(
      "div",
      { class: "hours-editor", "data-field": "hours" },
      DAYS.map(([key, label]) => {
        const entry = settings.hours[key];
        const open = h("input", { type: "time", name: `${key}-open`, value: entry?.[0] ?? "10:00", "aria-label": `${label} opening time` });
        const close = h("input", { type: "time", name: `${key}-close`, value: entry?.[1] ?? "22:00", "aria-label": `${label} closing time` });
        const isOpen = h("input", { type: "checkbox", name: `${key}-on`, checked: Boolean(entry) });
        const sync = () => {
          open.disabled = close.disabled = !isOpen.checked;
        };
        isOpen.addEventListener("change", sync);
        sync();
        return h("div", { class: "hours-row" }, h("strong", { text: label }), h("label", { class: "check" }, isOpen, "Open"), open, close);
      })
    ),
    h("button", { type: "submit", class: "btn btn-primary" }, "Save hours")
  );
  hoursForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const els = hoursForm.elements;
    const hours = Object.fromEntries(DAYS.map(([key]) => [key, els[`${key}-on`].checked ? [els[`${key}-open`].value, els[`${key}-close`].value] : null]));
    const button = hoursForm.querySelector("[type=submit]");
    setLoading(button, true);
    try {
      await call("/api/admin/settings", { method: "PATCH", body: { hours } });
      toast("Opening hours saved");
      poll();
    } catch (error) {
      showErrors(hoursForm, error);
    } finally {
      setLoading(button, false);
    }
  });

  const origin = location.origin;
  const tables = Array.from({ length: 12 }, (_, i) => `${origin}/?table=${i + 1}`);
  const qrPanel = h(
    "section",
    { class: "panel" },
    h("h2", { text: "Table QR codes" }),
    h(
      "p",
      { class: "muted", text: "Print a QR code on each table that opens one of these links. Guests who scan it can order straight to their table, and the order shows the table number here." }
    ),
    h("ul", { class: "qr-list" }, tables.map((link) => h("li", { text: link }))),
    h(
      "button",
      {
        type: "button",
        class: "btn btn-sm btn-quiet",
        onclick: async () => {
          try {
            await navigator.clipboard.writeText(tables.join("\n"));
            toast("Links copied");
          } catch {
            toast("Couldn't copy. Select the links and copy them manually.", { type: "error" });
          }
        }
      },
      "Copy all links"
    )
  );

  return h("div", { class: "settings-grid" }, h("div", { class: "stack" }, announceForm, qrPanel), hoursForm);
}

start();
