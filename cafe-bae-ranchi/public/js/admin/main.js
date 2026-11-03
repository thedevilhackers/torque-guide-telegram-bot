import { $, $$, call, can, h, icon, onSubmit, openDialog, field, input, setHooks, showErrors, state, toast } from "./core.js";
import { api } from "../lib.js";
import { renderOverview } from "./overview.js";
import { renderOrders } from "./orders.js";
import { renderBookings } from "./bookings.js";
import { renderInbox, refreshInbox } from "./inbox.js";
import { renderMenu } from "./menu.js";
import { renderEnquiries, renderReviews, renderSubscribers } from "./lists.js";
import { renderReports } from "./reports.js";
import { renderStaff } from "./staff.js";
import { renderSettings } from "./settings.js";

const TOKEN_KEY = "bae.admin.session";
const POLL_MS = 8000;

/** Every dashboard section, the permission it needs and how to draw it. */
const VIEWS = {
  overview: { title: "Overview", sub: "Today at a glance", icon: "sparkle", render: renderOverview },
  orders: { title: "Orders", sub: "Live kitchen board. New orders chime automatically.", icon: "receipt", permission: "orders", render: renderOrders },
  bookings: { title: "Bookings", sub: "Confirm tables and keep guests in the loop.", icon: "calendar", permission: "bookings", render: renderBookings },
  whatsapp: { title: "WhatsApp", sub: "Customer chats, auto-replies and every message sent.", icon: "whatsapp", permission: "whatsapp", render: renderInbox },
  menu: { title: "Menu", sub: "Prices, sold-out items and categories update on the website instantly.", icon: "shake", permission: "menu", render: renderMenu },
  reviews: { title: "Reviews", sub: "Approve reviews before they appear on the website.", icon: "star", permission: "reviews", render: renderReviews },
  enquiries: { title: "Parties & events", sub: "Enquiries from the website's party form.", icon: "gift", permission: "enquiries", render: renderEnquiries },
  subscribers: { title: "Subscribers", sub: "People who signed up for news and new drops.", icon: "mail", permission: "subscribers", render: renderSubscribers },
  reports: { title: "Reports", sub: "Sales, best sellers and payment methods.", icon: "chart", permission: "reports", render: renderReports },
  staff: { title: "Staff & activity", sub: "Who can sign in, what they can do, and everything they changed.", icon: "users", permission: "staff", render: renderStaff },
  settings: { title: "Settings", sub: "Master control of the website, rules, hours and WhatsApp.", icon: "settings", permission: "settings", render: renderSettings }
};

const runtime = { timer: null, audio: null, seenOrders: null, unseen: 0, lastLiveJson: "" };

// ---------------------------------------------------------------- session storage

const storage = {
  read() {
    try {
      return sessionStorage.getItem(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  write(token, remember) {
    try {
      sessionStorage.setItem(TOKEN_KEY, token);
      if (remember) localStorage.setItem(TOKEN_KEY, token);
    } catch {
      /* ignore */
    }
  },
  clear() {
    try {
      sessionStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
  }
};

// ---------------------------------------------------------------- sound

function unlockAudio() {
  try {
    runtime.audio ??= new AudioContext();
    if (runtime.audio.state === "suspended") runtime.audio.resume();
  } catch {
    /* no audio */
  }
}

function chime() {
  const ctx = runtime.audio;
  if (!ctx) return;
  [880, 1320].forEach((frequency, index) => {
    const start = ctx.currentTime + index * 0.18;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.25, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.45);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + 0.5);
  });
}

// ---------------------------------------------------------------- sign in / setup

function showScreen(id) {
  for (const screen of ["#setup", "#login", "#app"]) $(screen).hidden = screen !== id;
}

async function start() {
  onSubmit($("#loginForm"), async (values, form) => {
    unlockAudio();
    const result = await api("/api/admin/login", { method: "POST", body: { username: values.username, password: values.password, remember: Boolean(values.remember) } });
    storage.write(result.token, Boolean(values.remember));
    form.reset();
    await enter(result.token);
  });
  onSubmit($("#setupForm"), async (values, form) => {
    unlockAudio();
    const result = await api("/api/admin/setup", { method: "POST", body: values });
    storage.write(result.token, false);
    form.reset();
    toast(`Welcome, ${result.user.name}! Your master account is ready.`);
    await enter(result.token);
  });

  const saved = storage.read();
  if (saved) {
    try {
      return await enter(saved);
    } catch {
      storage.clear();
    }
  }
  await showSignIn();
}

async function showSignIn(message) {
  let needsSetup = false;
  try {
    needsSetup = (await api("/api/admin/setup")).needsSetup;
  } catch {
    /* offline: show the normal login */
  }
  showScreen(needsSetup ? "#setup" : "#login");
  const form = needsSetup ? $("#setupForm") : $("#loginForm");
  if (message) showErrors(form, { message, fields: {} });
  form.querySelector("input")?.focus();
}

function signOut(message) {
  clearInterval(runtime.timer);
  if (state.token) call("/api/admin/logout", { method: "POST", body: {} }).catch(() => {});
  state.token = null;
  state.me = null;
  storage.clear();
  showSignIn(message);
}

async function enter(token) {
  state.token = token;
  const me = await call("/api/admin/me");
  state.me = me.user;
  state.roles = me.roles;
  state.permissionCatalog = me.permissions;
  showScreen("#app");
  buildShell();
  const fromHash = location.hash.slice(1);
  switchTab(VIEWS[fromHash] && allowed(fromHash) ? fromHash : "overview");
  clearInterval(runtime.timer);
  runtime.timer = setInterval(poll, POLL_MS);
  runtime.seenOrders = null;
  poll();
}

// ---------------------------------------------------------------- shell

const allowed = (tab) => !VIEWS[tab].permission || can(VIEWS[tab].permission);

function buildShell() {
  const nav = $("#tabs");
  nav.replaceChildren(
    ...Object.entries(VIEWS)
      .filter(([key]) => allowed(key))
      .map(([key, view]) =>
        h("button", { type: "button", dataset: { tab: key }, onclick: () => switchTab(key) }, icon(view.icon), h("span", { text: view.title }), h("span", { class: "count", dataset: { count: key } }))
      )
  );
  const me = state.me;
  $("#meCard").replaceChildren(
    h("span", { class: "avatar", text: me.name.charAt(0).toUpperCase(), "aria-hidden": "true" }),
    h("span", { class: "me-text" }, h("strong", { text: me.name }), h("small", { text: me.roleLabel })),
    h("button", { type: "button", class: "me-btn", "aria-label": "Change password", title: "Change password", onclick: changePassword, hidden: !me.username }, icon("key")),
    h("button", { type: "button", class: "me-btn", "aria-label": "Sign out", title: "Sign out", onclick: () => signOut() }, icon("logout"))
  );
  $("#pauseToggle").hidden = !can("orders");
  $("#pauseOrders").onchange = async (event) => {
    const paused = event.target.checked;
    try {
      await call("/api/admin/orders/pause", { method: "POST", body: { paused } });
      toast(paused ? "Online orders paused. The website asks guests to order at the counter." : "Online orders are open again.");
      poll();
    } catch (error) {
      event.target.checked = !paused;
      toast(error.message, { type: "error" });
    }
  };
  $("#refreshBtn").onclick = () => {
    poll();
    renderView();
  };
  document.addEventListener("click", unlockAudio, { once: true });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      runtime.unseen = 0;
      updateTitle();
    }
  });
}

function changePassword() {
  const form = h(
    "form",
    { novalidate: true },
    field("Current password", input("currentPassword", "", { type: "password", autocomplete: "current-password", required: true })),
    field("New password", input("newPassword", "", { type: "password", autocomplete: "new-password", minlength: "8", required: true }), { hint: "(at least 8 characters)" }),
    h("button", { type: "submit", class: "btn btn-primary btn-block" }, "Change password")
  );
  const dialog = openDialog("Change your password", form);
  onSubmit(form, async (values) => {
    await call("/api/admin/me/password", { method: "POST", body: values });
    dialog.close();
    toast("Password changed. Other devices have been signed out.");
  });
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
  runtime.lastLiveJson = "";
  $("#view").replaceChildren();
  renderView();
}

async function renderView() {
  const view = $("#view");
  const tab = state.tab;
  if (!view.childElementCount) view.replaceChildren(h("div", { class: "loading" }, "Loading…"));
  try {
    const content = await VIEWS[tab].render();
    if (state.tab === tab && content) {
      const scroll = window.scrollY;
      view.replaceChildren(content);
      window.scrollTo({ top: scroll });
    }
  } catch (error) {
    if (state.tab === tab && error.status !== 401) view.replaceChildren(h("div", { class: "empty" }, h("strong", { text: "Couldn't load this section" }), h("p", { text: error.message })));
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
    whatsapp: summary.whatsapp.unread,
    reviews: summary.reviews.pending,
    enquiries: summary.enquiries.open
  };
  for (const [key, value] of Object.entries(counts)) {
    const badge = $(`[data-count="${key}"]`);
    if (badge) badge.textContent = value ? String(value) : "";
  }
}

function updateTitle() {
  document.title = runtime.unseen ? `(${runtime.unseen}) New order · Cafe BAE` : "Cafe BAE · Staff dashboard";
}

async function poll() {
  if (!state.token) return;
  try {
    const requests = [call("/api/admin/summary")];
    if (can("orders")) requests.push(call("/api/admin/orders?scope=active"));
    const [summary, active] = await Promise.all(requests);
    state.summary = summary;
    renderChrome();
    if (active) {
      const fresh = active.orders.filter((order) => order.status === "received" && runtime.seenOrders && !runtime.seenOrders.has(order.id));
      runtime.seenOrders = new Set([...(runtime.seenOrders ?? []), ...active.orders.map((order) => order.id)]);
      if (fresh.length) {
        chime();
        toast(fresh.length === 1 ? `New order #${String(fresh[0].number).padStart(3, "0")} from ${fresh[0].name}` : `${fresh.length} new orders`);
        if (document.visibilityState !== "visible") {
          runtime.unseen += fresh.length;
          updateTitle();
        }
      }
      const json = JSON.stringify(active.orders);
      if (json !== runtime.lastLiveJson && (state.tab === "overview" || state.tab === "orders")) {
        runtime.lastLiveJson = json;
        renderView();
      }
    }
    if (state.tab === "whatsapp") refreshInbox();
  } catch {
    /* transient network error: next tick will retry */
  }
}

setHooks({
  unauthorized: (message) => signOut(message),
  rerender: () => renderView(),
  poll: () => poll()
});

start();
