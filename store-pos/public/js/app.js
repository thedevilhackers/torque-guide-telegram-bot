import { ApiError, get, post, session } from "./api.js";
import { clearScanHandler } from "./scanner.js";
import { $, configureFormats, html, icon, initials, mount, on, showError, toast } from "./ui.js";

const ROUTES = {
  dashboard: { title: "Dashboard", icon: "home", section: "Store", load: () => import("./pages/dashboard.js") },
  pos: { title: "Sell", icon: "cart", section: "Store", perm: "pos.sell", full: true, load: () => import("./pages/pos.js") },
  sales: { title: "Sales & refunds", icon: "receipt", section: "Store", perm: "sales.view", load: () => import("./pages/sales.js") },
  shift: { title: "Shift & cash", icon: "clock", section: "Store", perm: "shifts.use", load: () => import("./pages/shift.js") },
  customers: { title: "Customers", icon: "users", section: "Store", perm: "customers.edit", load: () => import("./pages/customers.js") },
  receive: { title: "Receive stock", icon: "truck", section: "Stock", perm: "stock.receive", load: () => import("./pages/receive.js") },
  inventory: { title: "Inventory", icon: "box", section: "Stock", perm: "stock.view", load: () => import("./pages/inventory.js") },
  count: { title: "Stock count", icon: "clipboard", section: "Stock", perm: "stock.count", load: () => import("./pages/count.js") },
  transfers: { title: "Transfers", icon: "transfer", section: "Stock", perm: "stock.view", load: () => import("./pages/transfers.js") },
  reports: { title: "Reports", icon: "chart", section: "Manage", perm: "reports.view", load: () => import("./pages/reports.js") },
  promotions: { title: "Promotions", icon: "tag", section: "Manage", perm: "promotions.edit", load: () => import("./pages/promotions.js") },
  admin: { title: "Admin", icon: "settings", section: "Manage", perm: "users.manage", load: () => import("./pages/admin.js") }
};

const root = document.getElementById("app");
let cleanup = null;

/** Each full re-render gets a new container so delegated listeners never pile up. */
function freshContainer() {
  const el = document.createElement("div");
  root.replaceChildren(el);
  return el;
}
let renderSeq = 0;

export const app = {
  me: null,
  settings: null,
  branch: null,
  get branchId() {
    return session.branchId;
  },
  get today() {
    return this.me?.today;
  },
  can(perm) {
    return Boolean(this.me?.permissions.includes(perm));
  },
  navigate(route) {
    if (location.hash === `#/${route}`) renderRoute();
    else location.hash = `#/${route}`;
  },
  async refresh() {
    await loadMe();
    renderShell();
    renderRoute();
  },
  /** Re-fetches session info (shift, settings) without re-rendering the page. */
  async reloadMe() {
    await loadMe();
    updateShellStatus();
  },
  logout
};

// ---- theme -----------------------------------------------------------------------------
function applyTheme(theme) {
  if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
}
function currentTheme() {
  try {
    return localStorage.getItem("pos.theme") || "system";
  } catch {
    return "system";
  }
}
applyTheme(currentTheme());

// ---- session ----------------------------------------------------------------------------
async function loadMe() {
  let me;
  try {
    me = await get("/api/me");
  } catch (err) {
    if (err instanceof ApiError && (err.code === "VALIDATION" || err.code === "BRANCH_SCOPE")) {
      session.branchId = null;
      me = await get("/api/me");
    } else throw err;
  }
  // Pick a branch: staff are fixed to theirs; owners keep their last choice.
  const usable = me.branches.filter((b) => b.active);
  const wanted = me.user.branch_id ?? (usable.some((b) => b.id === session.branchId) ? session.branchId : usable[0]?.id ?? null);
  if (wanted !== me.branch_id) {
    session.branchId = wanted;
    me = await get("/api/me");
  } else session.branchId = wanted;
  app.me = me;
  app.settings = me.settings;
  app.branch = me.branches.find((b) => b.id === me.branch_id) ?? null;
  configureFormats({ currency: me.settings.currency, locale: me.settings.locale, timezone: app.branch?.timezone ?? "UTC" });
  document.title = `${me.settings.store_name} · Store POS`;
}

async function logout() {
  try {
    await post("/api/auth/logout");
  } catch {
    /* already signed out */
  }
  session.token = null;
  app.me = null;
  location.hash = "";
  boot();
}

session.onUnauthorized(() => {
  session.token = null;
  toast("Your session ended. Please sign in again.", "warn");
  boot();
});

// ---- shell -------------------------------------------------------------------------------
function visibleRoutes() {
  return Object.entries(ROUTES).filter(([, r]) => !r.perm || app.can(r.perm));
}

function renderShell() {
  const me = app.me;
  const sections = {};
  for (const [key, r] of visibleRoutes()) (sections[r.section] ??= []).push([key, r]);
  const themeIcon = currentTheme() === "dark" ? "moon" : currentTheme() === "light" ? "sun" : "settings";
  const container = freshContainer();
  mount(
    container,
    html`
      <div class="shell">
        <aside class="sidebar" aria-label="Main menu">
          <div class="brand">
            <img src="/icon.svg" alt="" />
            <div><strong>${me.settings.store_name}</strong><span>${roleLabel(me.user.role)}</span></div>
          </div>
          ${me.branches.length > 1 && !me.user.branch_id
            ? html`<label class="branch-picker"><span class="sr-only">Branch</span>
                <select class="input" data-branch>${me.branches.filter((b) => b.active).map((b) => html`<option value="${b.id}" ${b.id === app.branchId ? "selected" : ""}>${b.name}</option>`)}</select></label>`
            : html`<div class="badge brand" style="justify-self:start;margin-left:8px">${icon("store", 12)} ${app.branch?.name ?? "No branch"}</div>`}
          <nav class="nav">
            ${Object.entries(sections).map(
              ([name, items]) => html`<div class="nav-section">${name}</div>${items.map(
                ([key, r]) => html`<a href="#/${key}" data-route="${key}">${icon(r.icon)}<span>${r.title}</span>${key === "shift" ? html`<span class="badge" data-shift-badge></span>` : ""}</a>`
              )}`
            )}
          </nav>
          <div class="sidebar-foot">
            <div class="user-chip"><div class="avatar">${initials(me.user.name)}</div><div class="grow"><div class="ellipsis" style="font-weight:600">${me.user.name}</div><div class="faint small">${me.user.username ?? ""}</div></div></div>
            <div class="row tight">
              <button class="btn ghost sm grow" data-theme-toggle title="Theme: ${currentTheme()}">${icon(themeIcon, 16)} Theme</button>
              <button class="btn ghost sm grow" data-logout>${icon("logout", 16)} Sign out</button>
            </div>
          </div>
        </aside>
        <div class="main">
          <div class="topbar">
            <button class="btn ghost icon" data-nav-toggle aria-label="Open menu">${icon("menu", 22)}</button>
            <strong class="grow ellipsis" data-topbar-title></strong>
            <span class="badge brand">${app.branch?.code ?? ""}</span>
          </div>
          <div id="page" class="page"></div>
        </div>
      </div>`
  );
  const shell = $(".shell", container);
  on(container, "change", "[data-branch]", async (e) => {
    session.branchId = Number(e.target.value);
    await app.refresh();
    toast(`Switched to ${app.branch.name}`, "success");
  });
  on(container, "click", "[data-logout]", () => logout());
  on(container, "click", "[data-theme-toggle]", () => {
    const next = { system: "light", light: "dark", dark: "system" }[currentTheme()];
    try {
      localStorage.setItem("pos.theme", next);
    } catch {
      /* ignore */
    }
    applyTheme(next);
    renderShell();
    renderRoute();
    toast(`Theme: ${next}`);
  });
  on(container, "click", "[data-nav-toggle]", () => shell.classList.toggle("nav-open"));
  on(container, "click", ".nav a", () => shell.classList.remove("nav-open"));
  shell.addEventListener("click", (e) => {
    if (shell.classList.contains("nav-open") && e.target === shell) shell.classList.remove("nav-open");
  });
  updateShellStatus();
}

function updateShellStatus() {
  const badge = $("[data-shift-badge]", root);
  if (badge) {
    badge.textContent = app.me?.shift ? "Open" : "";
    badge.className = app.me?.shift ? "badge good" : "hidden";
  }
}

const roleLabel = (role) => ({ owner: "Owner · head office", manager: "Branch manager", cashier: "Cashier" })[role] ?? role;

// ---- routing ----------------------------------------------------------------------------
function defaultRoute() {
  return app.me.user.role === "cashier" ? "pos" : "dashboard";
}

async function renderRoute() {
  if (!app.me) return;
  const seq = ++renderSeq;
  let key = location.hash.replace(/^#\/?/, "").split("?")[0] || defaultRoute();
  const route = ROUTES[key];
  if (!route || (route.perm && !app.can(route.perm))) {
    key = defaultRoute();
    history.replaceState(null, "", `#/${key}`);
  }
  const r = ROUTES[key];
  cleanup?.();
  cleanup = null;
  clearScanHandler();
  root.querySelectorAll(".nav a").forEach((a) => a.classList.toggle("active", a.dataset.route === key));
  const title = $("[data-topbar-title]", root);
  if (title) title.textContent = r.title;
  // A fresh element per route so a page's delegated listeners die with it.
  const page = document.createElement("div");
  page.id = "page";
  page.className = r.full ? "page full" : "page";
  page.innerHTML = '<div class="empty">Loading…</div>';
  $("#page", root).replaceWith(page);
  try {
    const mod = await r.load();
    if (seq !== renderSeq) return;
    page.innerHTML = "";
    const result = await mod.default(page, app);
    if (seq !== renderSeq) {
      result?.();
      return;
    }
    cleanup = typeof result === "function" ? result : null;
  } catch (err) {
    if (seq !== renderSeq) return;
    page.innerHTML = String(html`<div class="banner danger">${icon("alert")} <div><strong>Could not load this page.</strong> ${err.message}</div></div>`);
    console.error(err);
  }
}

window.addEventListener("hashchange", renderRoute);

// ---- boot --------------------------------------------------------------------------------
async function boot() {
  cleanup?.();
  cleanup = null;
  clearScanHandler();
  if (!session.token) {
    const { renderAuth } = await import("./pages/login.js");
    root.classList.remove("boot");
    return renderAuth(freshContainer(), { onSignedIn: boot });
  }
  try {
    await loadMe();
  } catch (err) {
    if (err.status === 401) {
      session.token = null;
      return boot();
    }
    mount(freshContainer(), html`<div class="auth"><div class="card auth-card stack"><h2>Cannot reach the store server</h2><p class="muted">${err.message}</p><button class="btn primary" onclick="location.reload()">Try again</button></div></div>`);
    return;
  }
  root.classList.remove("boot");
  renderShell();
  renderRoute();
}

window.addEventListener("unhandledrejection", (e) => {
  if (e.reason instanceof ApiError) {
    showError(e.reason);
    e.preventDefault();
  }
});

boot();
