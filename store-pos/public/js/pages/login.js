import { get, post, session } from "../api.js";
import { $, html, icon, initials, modal, mount, on, readForm, showError, toast } from "../ui.js";

const CURRENCIES = ["USD", "INR", "EUR", "GBP", "AED", "SAR", "SGD", "MYR", "THB", "PHP", "IDR", "PKR", "BDT", "LKR", "NPR", "AUD", "CAD", "NZD", "JPY", "ZAR", "NGN", "KES"];

function recentUsers() {
  try {
    return JSON.parse(localStorage.getItem("pos.recentUsers") || "[]");
  } catch {
    return [];
  }
}
function rememberUser(user) {
  try {
    const list = recentUsers().filter((u) => u.username !== user.username);
    list.unshift({ username: user.username, name: user.name });
    localStorage.setItem("pos.recentUsers", JSON.stringify(list.slice(0, 6)));
  } catch {
    /* ignore */
  }
}

export async function renderAuth(root, { onSignedIn }) {
  let needsSetup = false;
  let demo = null;
  try {
    ({ needs_setup: needsSetup, demo = null } = await get("/api/setup"));
  } catch (err) {
    mount(root, html`<div class="auth"><div class="card auth-card"><h2>Cannot reach the store server</h2><p class="muted">${err.message}</p></div></div>`);
    return;
  }
  if (needsSetup) return renderSetup(root, { onSignedIn });
  renderLogin(root, { onSignedIn, demo });
}

function renderLogin(root, { onSignedIn, demo = null }) {
  let mode = "pin";
  const draw = () => {
    const recent = recentUsers();
    mount(
      root,
      html`<div class="auth">
        <div class="card auth-card">
          <div class="brand"><img src="/icon.svg" alt="" /><div><strong>Store POS</strong><span>Sign in to start</span></div></div>
          <div class="seg" role="tablist" style="margin-bottom:16px">
            <button type="button" class="${mode === "pin" ? "active" : ""}" data-mode="pin">${icon("key", 15)} PIN</button>
            <button type="button" class="${mode === "password" ? "active" : ""}" data-mode="password">${icon("lock", 15)} Password</button>
          </div>
          ${mode === "pin" && recent.length
            ? html`<div class="stack" style="margin-bottom:14px"><span class="small muted">Recent on this device</span><div class="recent-users">${recent.map(
                (u) => html`<button type="button" data-user="${u.username}"><span class="avatar">${initials(u.name)}</span>${u.name}</button>`
              )}</div></div>`
            : ""}
          <form class="stack" data-login>
            <label class="field"><span>Username</span><input class="input" name="username" autocomplete="username" required autocapitalize="off" /></label>
            ${mode === "pin"
              ? html`<label class="field"><span>PIN</span><input class="input" name="pin" type="password" inputmode="numeric" pattern="[0-9]{4,8}" autocomplete="off" required /></label>`
              : html`<label class="field"><span>Password</span><input class="input" name="password" type="password" autocomplete="current-password" required /></label>`}
            <button class="btn primary lg" type="submit">Sign in</button>
          </form>
          <p class="small faint" style="margin-top:14px">Cashiers usually sign in with a PIN. Owners and managers can use a password.</p>
          ${demo
            ? html`<div class="stack" style="margin-top:16px;padding:12px 14px;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface-2);gap:8px" data-demo-logins>
                <div><strong>Public demo</strong><div class="small muted">A sample store with made-up data. Anything you change is wiped when the demo restarts.</div></div>
                <ul class="list-plain">${demo.logins.map(
                  (l, i) => html`<li><div><div style="font-weight:600">${l.who}</div><div class="small muted mono"><span class="nowrap">${l.username}</span> · <span class="nowrap">PIN ${l.pin}</span>${l.password ? html` · <span class="nowrap">password ${l.password}</span>` : ""}</div></div><button type="button" class="btn sm" data-demo-login="${i}">Sign in</button></li>`
                )}</ul>
              </div>`
            : ""}
        </div>
      </div>`
    );
    $("[name=username]", root).focus();
  };
  draw();
  on(root, "click", "[data-mode]", (e, btn) => {
    mode = btn.dataset.mode;
    draw();
  });
  on(root, "click", "[data-demo-login]", (e, btn) => {
    const login = demo.logins[Number(btn.dataset.demoLogin)];
    mode = "pin";
    draw();
    $("[name=username]", root).value = login.username;
    $("[name=pin]", root).value = login.pin;
    $("[data-login]", root).requestSubmit();
  });
  on(root, "click", "[data-user]", (e, btn) => {
    $("[name=username]", root).value = btn.dataset.user;
    $("[name=pin]", root)?.focus();
  });
  on(root, "submit", "[data-login]", async (e, form) => {
    e.preventDefault();
    const btn = form.querySelector("button[type=submit]");
    btn.disabled = true;
    try {
      const data = readForm(form);
      const res = await post("/api/auth/login", data);
      session.token = res.token;
      rememberUser(res.user);
      onSignedIn();
    } catch (err) {
      showError(err);
      btn.disabled = false;
    }
  });
}

function renderSetup(root, { onSignedIn }) {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const locale = navigator.language || "en-US";
  const guessCurrency = locale.endsWith("IN") ? "INR" : locale.endsWith("GB") ? "GBP" : locale.endsWith("AE") ? "AED" : "USD";
  mount(
    root,
    html`<div class="auth">
      <form class="card auth-card wide stack lg" data-setup>
        <div class="brand"><img src="/icon.svg" alt="" /><div><strong>Welcome — let's set up your store</strong><span>This takes a minute. You can change everything later.</span></div></div>
        <section class="stack">
          <h3>Store</h3>
          <div class="form-grid">
            <label class="field full"><span>Store / chain name</span><input class="input" name="store_name" required placeholder="e.g. QuickMart" /></label>
            <label class="field"><span>Currency</span><select class="input" name="currency">${CURRENCIES.map((c) => html`<option ${c === guessCurrency ? "selected" : ""}>${c}</option>`)}</select></label>
            <label class="field"><span>Number format (locale)</span><input class="input" name="locale" value="${locale}" /></label>
            <label class="check full"><input type="checkbox" name="prices_include_tax" checked /> Shelf prices already include tax (GST/VAT)</label>
          </div>
        </section>
        <section class="stack">
          <h3>First branch</h3>
          <div class="form-grid">
            <label class="field"><span>Branch name</span><input class="input" name="branch_name" required placeholder="e.g. Main Street" /></label>
            <label class="field"><span>Short code <small>(on receipts)</small></span><input class="input" name="branch_code" required maxlength="12" placeholder="MAIN" style="text-transform:uppercase" /></label>
            <label class="field"><span>Time zone</span><input class="input" name="timezone" value="${tz}" required /></label>
            <label class="field"><span>Phone</span><input class="input" name="phone" /></label>
            <label class="field full"><span>Address</span><input class="input" name="address" /></label>
          </div>
        </section>
        <section class="stack">
          <h3>Owner account</h3>
          <div class="form-grid">
            <label class="field"><span>Your name</span><input class="input" name="owner_name" required autocomplete="name" /></label>
            <label class="field"><span>Username</span><input class="input" name="username" required autocapitalize="off" autocomplete="username" /></label>
            <label class="field"><span>Password <small>(8+ characters)</small></span><input class="input" name="password" type="password" minlength="8" required autocomplete="new-password" /></label>
            <label class="field"><span>PIN <small>(4–8 digits, for approvals at the till)</small></span><input class="input" name="pin" inputmode="numeric" pattern="[0-9]{4,8}" required autocomplete="off" /></label>
          </div>
        </section>
        <label class="check"><input type="checkbox" name="demo" /> Load demo data — sample products, a second branch, demo staff and two weeks of sales (for trying it out)</label>
        <button class="btn primary lg" type="submit">Create store</button>
      </form>
    </div>`
  );
  on(root, "submit", "[data-setup]", async (e, form) => {
    e.preventDefault();
    const d = readForm(form);
    const btn = form.querySelector("button[type=submit]");
    btn.disabled = true;
    btn.textContent = d.demo ? "Creating store and demo data…" : "Creating store…";
    try {
      const res = await post("/api/setup", {
        store_name: d.store_name,
        currency: d.currency,
        locale: d.locale,
        prices_include_tax: d.prices_include_tax,
        demo: d.demo,
        branch: { name: d.branch_name, code: d.branch_code, timezone: d.timezone, phone: d.phone, address: d.address },
        owner: { name: d.owner_name, username: d.username, password: d.password, pin: d.pin }
      });
      session.token = res.token;
      session.branchId = res.branch.id;
      rememberUser({ username: d.username.toLowerCase(), name: d.owner_name });
      if (res.demo) {
        const { result } = modal({
          title: "Demo data loaded",
          body: html`<p>Sample products, two branches and two weeks of sales were created. Demo staff accounts (sign in with PIN):</p>
            <table class="table" style="margin-top:10px"><thead><tr><th>Name</th><th>Username</th><th>PIN</th></tr></thead><tbody>
            ${res.demo.staff.map((s) => html`<tr><td>${s.name}</td><td class="mono">${s.username}</td><td class="mono">${s.pin}</td></tr>`)}</tbody></table>
            <p class="small muted" style="margin-top:10px">Remove or change these accounts before using the system for real (Admin → Staff).</p>`,
          actions: [{ label: "Start", kind: "primary", value: true }]
        });
        await result;
      } else toast("Store created", "success");
      onSignedIn();
    } catch (err) {
      showError(err);
      btn.disabled = false;
      btn.textContent = "Create store";
    }
  });
}
