import { del, get, patch, post, put } from "../api.js";
import { invalidateLookups } from "../product-form.js";
import { $, confirmDialog, dateTime, html, icon, modal, mount, on, options, readForm, showError, toMajor, toMinor, toast } from "../ui.js";

export default async function adminPage(el, app) {
  const isOwner = app.me.user.role === "owner";
  const tabs = [
    isOwner && ["branches", "Branches"],
    ["staff", "Staff"],
    isOwner && ["settings", "Settings"],
    app.can("catalog.edit") && ["catalogue", "Categories & suppliers"],
    isOwner && ["integrations", "Admin panel / API"],
    ["audit", "Activity log"]
  ].filter(Boolean);
  let tab = new URLSearchParams(location.hash.split("?")[1] ?? "").get("tab") ?? tabs[0][0];
  if (!tabs.some(([k]) => k === tab)) tab = tabs[0][0];

  mount(
    el,
    html`<div class="page-head"><div><h1>Admin</h1><p>${isOwner ? "Head office settings for every branch." : `Staff for ${app.branch.name}.`}</p></div></div>
      <div class="tabs">${tabs.map(([k, l]) => html`<button data-tab="${k}" class="${k === tab ? "active" : ""}">${l}</button>`)}</div>
      <div data-body></div>`
  );
  const views = { branches, staff, settings, catalogue, integrations, audit };

  /** Each view render gets a fresh container so its delegated listeners don't stack up. */
  function fresh() {
    const node = document.createElement("div");
    node.dataset.body = "";
    $("[data-body]", el).replaceWith(node);
    return node;
  }

  async function show() {
    mount(fresh(), html`<div class="empty">Loading…</div>`);
    try {
      await views[tab]();
    } catch (err) {
      showError(err);
    }
  }
  on(el, "click", "[data-tab]", (e, b) => {
    tab = b.dataset.tab;
    el.querySelectorAll("[data-tab]").forEach((x) => x.classList.toggle("active", x === b));
    history.replaceState(null, "", `#/admin?tab=${tab}`);
    show();
  });

  // ---- branches ----------------------------------------------------------------------
  async function branches() {
    const list = await get("/api/branches");
    const body = fresh();
    mount(
      body,
      html`<div class="card"><div class="card-head"><h2>Branches</h2><button class="btn primary" data-b="new">${icon("plus", 16)} Add branch</button></div><div class="table-wrap"><table class="table">
        <thead><tr><th>Branch</th><th>Code</th><th>Time zone</th><th>External ID</th><th>Status</th><th></th></tr></thead>
        <tbody>${list.map(
          (b) => html`<tr><td><strong>${b.name}</strong><div class="sub">${b.address}</div></td><td class="mono">${b.code}</td><td>${b.timezone}</td><td class="mono small">${b.external_id ?? "—"}</td>
            <td>${!b.active ? html`<span class="badge">Inactive</span>` : b.locked ? html`<span class="badge bad">${icon("lock", 12)} Locked</span>` : html`<span class="badge good">Open</span>`}</td>
            <td class="nowrap"><button class="btn sm" data-b="edit" data-id="${b.id}">${icon("edit", 14)} Edit</button> <button class="btn sm ${b.locked ? "" : "danger"}" data-b="${b.locked ? "unlock" : "lock"}" data-id="${b.id}">${icon(b.locked ? "unlock" : "lock", 14)} ${b.locked ? "Unlock" : "Lock"}</button></td></tr>`
        )}</tbody></table></div></div>`
    );
    on(body, "click", "[data-b]", async (e, btn) => {
      const action = btn.dataset.b;
      const branch = list.find((b) => b.id === Number(btn.dataset.id));
      if (action === "lock") {
        const { result } = modal({
          title: `Lock ${branch.name}`,
          size: "sm",
          body: html`<form class="stack"><p class="muted">Selling stops at this branch until you unlock it. Staff see the reason.</p><label class="field"><span>Reason</span><input class="input" name="reason" placeholder="e.g. stock audit" /></label></form>`,
          actions: [{ label: "Cancel" }, { label: "Lock branch", kind: "solid-danger", submit: true }],
          onSubmit: (form) => post(`/api/branches/${branch.id}/lock`, { reason: form.reason.value })
        });
        if (await result) return app.refresh();
      }
      if (action === "unlock") {
        await post(`/api/branches/${branch.id}/unlock`);
        return app.refresh();
      }
      if (action === "new" || action === "edit") {
        const { result } = modal({
          title: branch ? `Edit ${branch.name}` : "Add branch",
          body: html`<form class="form-grid">
            <label class="field"><span>Name</span><input class="input" name="name" required value="${branch?.name ?? ""}" /></label>
            <label class="field"><span>Code (receipts)</span><input class="input" name="code" required maxlength="12" value="${branch?.code ?? ""}" style="text-transform:uppercase" /></label>
            <label class="field"><span>Time zone</span><input class="input" name="timezone" required value="${branch?.timezone ?? app.branch?.timezone ?? "UTC"}" /></label>
            <label class="field"><span>Phone</span><input class="input" name="phone" value="${branch?.phone ?? ""}" /></label>
            <label class="field full"><span>Address</span><input class="input" name="address" value="${branch?.address ?? ""}" /></label>
            <label class="field"><span>Tax ID (on receipts)</span><input class="input" name="tax_id" value="${branch?.tax_id ?? ""}" /></label>
            <label class="field"><span>External ID <small>(restaurant / outlet id in your admin panel)</small></span><input class="input mono" name="external_id" value="${branch?.external_id ?? ""}" /></label>
            <label class="field full"><span>Receipt footer</span><input class="input" name="receipt_footer" value="${branch?.receipt_footer ?? ""}" placeholder="Thank you! Returns within 7 days with receipt." /></label>
            ${branch ? html`<label class="check full"><input type="checkbox" name="active" ${branch.active ? "checked" : ""} /> Active</label>` : ""}
          </form>`,
          actions: [{ label: "Cancel" }, { label: "Save", kind: "primary", submit: true }],
          onSubmit: (form) => (branch ? patch(`/api/branches/${branch.id}`, readForm(form)) : post("/api/branches", readForm(form)))
        });
        if (await result) {
          toast("Branch saved", "success");
          app.refresh();
        }
      }
    });
  }

  // ---- staff ---------------------------------------------------------------------------
  async function staff() {
    const users = await get("/api/users");
    const branchesList = app.me.branches;
    const body = fresh();
    mount(
      body,
      html`<div class="card"><div class="card-head"><div><h2>Staff accounts</h2><p>Cashiers sign in with a PIN. Managers' PINs approve refunds, big discounts and expired-stock sales.</p></div><button class="btn primary" data-u="new">${icon("plus", 16)} Add staff</button></div>
        <div class="table-wrap"><table class="table"><thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Branch</th><th>Sign-in</th><th>Status</th><th></th></tr></thead><tbody>${users.map(
          (u) => html`<tr><td><strong>${u.name}</strong></td><td class="mono">${u.username}</td><td>${{ owner: "Owner", manager: "Manager", cashier: "Cashier" }[u.role]}</td><td>${u.branch_name ?? "All branches"}</td>
            <td class="small">${[u.has_password && "password", u.has_pin && "PIN"].filter(Boolean).join(" + ")}</td><td>${u.active ? html`<span class="badge good">Active</span>` : html`<span class="badge">Disabled</span>`}</td>
            <td><button class="btn sm" data-u="edit" data-id="${u.id}">${icon("edit", 14)} Edit</button></td></tr>`
        )}</tbody></table></div></div>`
    );
    on(body, "click", "[data-u]", async (e, btn) => {
      const user = users.find((u) => u.id === Number(btn.dataset.id));
      const roles = isOwner ? ["cashier", "manager", "owner"] : ["cashier"];
      const { result } = modal({
        title: user ? `Edit ${user.name}` : "Add staff",
        body: html`<form class="form-grid">
          <label class="field"><span>Name</span><input class="input" name="name" required value="${user?.name ?? ""}" /></label>
          <label class="field"><span>Username</span><input class="input" name="username" required value="${user?.username ?? ""}" ${user ? "disabled" : ""} autocapitalize="off" /></label>
          <label class="field"><span>Role</span><select class="input" name="role">${roles.map((r) => html`<option value="${r}" ${r === (user?.role ?? "cashier") ? "selected" : ""}>${r[0].toUpperCase() + r.slice(1)}</option>`)}</select></label>
          <label class="field"><span>Branch</span><select class="input" name="branch_id" data-type="int" ${isOwner ? "" : "disabled"}>${options(branchesList, user?.branch_id ?? app.branchId)}</select></label>
          <label class="field"><span>${user ? "New PIN (leave blank to keep)" : "PIN (4–8 digits)"}</span><input class="input" name="pin" inputmode="numeric" pattern="[0-9]{4,8}" autocomplete="off" /></label>
          <label class="field"><span>${user ? "New password (optional)" : "Password (optional, 8+)"}</span><input class="input" name="password" type="password" minlength="8" autocomplete="new-password" /></label>
          ${user ? html`<label class="check full"><input type="checkbox" name="active" ${user.active ? "checked" : ""} /> Active (untick to block sign-in immediately)</label>` : ""}
        </form>`,
        actions: [{ label: "Cancel" }, { label: "Save", kind: "primary", submit: true }],
        onSubmit(form) {
          const d = readForm(form);
          if (!d.pin) delete d.pin;
          if (!d.password) delete d.password;
          if (!isOwner) d.branch_id = app.branchId;
          return user ? patch(`/api/users/${user.id}`, d) : post("/api/users", d);
        }
      });
      if (await result) {
        toast("Saved", "success");
        staff();
      }
    });
  }

  // ---- settings -------------------------------------------------------------------------
  async function settings() {
    const s = await get("/api/settings");
    const body = fresh();
    mount(
      body,
      html`<form class="stack lg" data-settings style="max-width:860px">
        <div class="card card-pad stack"><h2>Store</h2><div class="form-grid">
          <label class="field"><span>Store / chain name</span><input class="input" name="store_name" value="${s.store_name}" required /></label>
          <label class="field"><span>Currency (ISO code)</span><input class="input" name="currency" value="${s.currency}" maxlength="3" required style="text-transform:uppercase" /></label>
          <label class="field"><span>Number format (locale)</span><input class="input" name="locale" value="${s.locale}" /></label>
          <label class="field"><span>Receipt header line</span><input class="input" name="receipt_header" value="${s.receipt_header}" placeholder="e.g. GSTIN / VAT no." /></label>
          <label class="check full"><input type="checkbox" name="prices_include_tax" ${s.prices_include_tax ? "checked" : ""} /> Prices include tax</label>
        </div></div>
        <div class="card card-pad stack"><h2>Till rules</h2><div class="form-grid">
          <label class="field"><span>Max discount a cashier can give without a manager PIN (%)</span><input class="input num" name="max_cashier_discount_pct" type="number" min="0" max="100" value="${s.max_cashier_discount_pct}" /></label>
          <label class="field"><span>Default "warn before expiry" days for new products</span><input class="input num" name="default_expiry_warn_days" type="number" min="0" max="365" value="${s.default_expiry_warn_days}" /></label>
          <label class="check full"><input type="checkbox" name="block_expired_sales" ${s.block_expired_sales ? "checked" : ""} /> Block selling items whose only stock is expired (manager PIN overrides)</label>
          <label class="check full"><input type="checkbox" name="allow_negative_stock" ${s.allow_negative_stock ? "checked" : ""} /> Allow selling more than the system stock (recommended: shelves are often ahead of the books)</label>
          <label class="check full"><input type="checkbox" name="require_shift" ${s.require_shift ? "checked" : ""} /> Cashiers must open a shift (cash drawer) before selling</label>
        </div></div>
        <div class="card card-pad stack"><h2>Payment methods</h2><p class="muted small">One per line as <code>id: Label</code>. Cash is always available.</p>
          <textarea class="input mono" name="payment_methods" rows="5">${s.payment_methods.map((m) => `${m.id}: ${m.label}`).join("\n")}</textarea></div>
        <div class="card card-pad stack"><h2>Loyalty points</h2><div class="form-grid">
          <label class="check full"><input type="checkbox" name="loyalty_enabled" ${s.loyalty.enabled ? "checked" : ""} /> Enabled</label>
          <label class="field"><span>Spend this much to earn 1 point</span><input class="input num" name="earn_per_amount" inputmode="decimal" value="${toMajor(s.loyalty.earn_per_amount)}" /></label>
          <label class="field"><span>Value of 1 point when redeemed</span><input class="input num" name="point_value" inputmode="decimal" value="${toMajor(s.loyalty.point_value)}" /></label>
          <label class="field"><span>Minimum points to redeem</span><input class="input num" name="min_redeem" type="number" min="0" value="${s.loyalty.min_redeem}" /></label>
        </div></div>
        <div class="card card-pad stack"><h2>Scale barcodes</h2><p class="muted small">Weighing scales print EAN-13 labels like <code>PP IIIII VVVVV C</code>: prefix, the product's PLU, then weight in grams or price. One rule per line, e.g. <code>21: weight</code>, <code>22: price</code>.</p>
          <textarea class="input mono" name="embedded_barcodes" rows="3">${s.embedded_barcodes.map((r) => `${r.prefix}: ${r.type}`).join("\n")}</textarea></div>
        <div><button class="btn primary lg" type="submit">Save settings</button></div>
      </form>`
    );
    on(body, "submit", "[data-settings]", async (e, form) => {
      e.preventDefault();
      const d = readForm(form);
      try {
        const parseLines = (text) =>
          text
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean)
            .map((l) => l.split(":").map((x) => x.trim()));
        await put("/api/settings", {
          store_name: d.store_name,
          currency: d.currency.toUpperCase(),
          locale: d.locale,
          receipt_header: d.receipt_header,
          prices_include_tax: d.prices_include_tax,
          max_cashier_discount_pct: Number(d.max_cashier_discount_pct),
          default_expiry_warn_days: Number(d.default_expiry_warn_days),
          block_expired_sales: d.block_expired_sales,
          allow_negative_stock: d.allow_negative_stock,
          require_shift: d.require_shift,
          payment_methods: parseLines(d.payment_methods).map(([id, label]) => ({ id, label: label || id })),
          loyalty: { enabled: d.loyalty_enabled, earn_per_amount: toMinor(d.earn_per_amount), point_value: toMinor(d.point_value), min_redeem: Number(d.min_redeem) || 0 },
          embedded_barcodes: parseLines(d.embedded_barcodes).map(([prefix, type]) => ({ prefix, type }))
        });
        toast("Settings saved", "success");
        app.refresh();
      } catch (err) {
        showError(err);
      }
    });
  }

  // ---- categories & suppliers ------------------------------------------------------------
  async function catalogue() {
    const [cats, sups] = await Promise.all([get("/api/categories"), get("/api/suppliers")]);
    const body = fresh();
    mount(
      body,
      html`<div class="grid cols-2" style="align-items:start">
        <div class="card"><div class="card-head"><h2>Categories</h2><button class="btn sm primary" data-c="new">${icon("plus", 14)} Add</button></div><div class="table-wrap"><table class="table"><tbody>${cats.map(
          (c) => html`<tr><td>${c.name}</td><td class="num faint">${c.product_count} products</td><td class="nowrap"><button class="btn sm" data-c="edit" data-id="${c.id}">${icon("edit", 14)}</button> <button class="btn sm danger" data-c="del" data-id="${c.id}" aria-label="Delete">${icon("trash", 14)}</button></td></tr>`
        )}</tbody></table></div></div>
        <div class="card"><div class="card-head"><h2>Suppliers</h2><button class="btn sm primary" data-s="new">${icon("plus", 14)} Add</button></div><div class="table-wrap"><table class="table"><tbody>${sups.map(
          (s) => html`<tr><td><strong>${s.name}</strong><div class="sub">${[s.phone, s.email].filter(Boolean).join(" · ")}</div></td><td class="small">${s.lead_days} day lead</td><td>${s.active ? "" : html`<span class="badge">Inactive</span>`}</td><td><button class="btn sm" data-s="edit" data-id="${s.id}">${icon("edit", 14)}</button></td></tr>`
        )}</tbody></table></div></div></div>`
    );
    on(body, "click", "[data-c]", async (e, b) => {
      const cat = cats.find((c) => c.id === Number(b.dataset.id));
      if (b.dataset.c === "del") {
        if (!(await confirmDialog(`Delete category "${cat.name}"? Products keep existing but become uncategorised.`, { ok: "Delete", danger: true }))) return;
        await del(`/api/categories/${cat.id}`);
      } else {
        const { result } = modal({
          title: cat ? "Edit category" : "New category",
          size: "sm",
          body: html`<form><label class="field"><span>Name</span><input class="input" name="name" required value="${cat?.name ?? ""}" /></label></form>`,
          actions: [{ label: "Cancel" }, { label: "Save", kind: "primary", submit: true }],
          onSubmit: (form) => (cat ? patch(`/api/categories/${cat.id}`, readForm(form)) : post("/api/categories", readForm(form)))
        });
        if (!(await result)) return;
      }
      invalidateLookups();
      catalogue();
    });
    on(body, "click", "[data-s]", async (e, b) => {
      const sup = sups.find((s) => s.id === Number(b.dataset.id));
      const { result } = modal({
        title: sup ? "Edit supplier" : "New supplier",
        body: html`<form class="form-grid">
          <label class="field full"><span>Name</span><input class="input" name="name" required value="${sup?.name ?? ""}" /></label>
          <label class="field"><span>Phone</span><input class="input" name="phone" value="${sup?.phone ?? ""}" /></label>
          <label class="field"><span>Email</span><input class="input" name="email" value="${sup?.email ?? ""}" /></label>
          <label class="field"><span>Delivery lead time (days)</span><input class="input num" name="lead_days" type="number" min="0" value="${sup?.lead_days ?? 7}" /></label>
          <label class="check"><input type="checkbox" name="active" ${sup?.active === 0 ? "" : "checked"} /> Active</label></form>`,
        actions: [{ label: "Cancel" }, { label: "Save", kind: "primary", submit: true }],
        onSubmit: (form) => (sup ? patch(`/api/suppliers/${sup.id}`, readForm(form)) : post("/api/suppliers", readForm(form)))
      });
      if (await result) {
        invalidateLookups();
        catalogue();
      }
    });
  }

  // ---- integrations ------------------------------------------------------------------------
  async function integrations() {
    const [keys, hooks, deliveries] = await Promise.all([get("/api/api-keys"), get("/api/webhooks"), get("/api/webhooks/deliveries?limit=30")]);
    const baseUrl = location.origin;
    const body = fresh();
    mount(
      body,
      html`<div class="stack lg">
        <div class="card card-pad stack">
          <h2>Connect your restaurant admin panel</h2>
          <p class="muted">Your admin panel controls the stores through this REST API: sync products and prices, lock/unlock branches, pull live sales and daily summaries. Webhooks push events (sales, low stock, expiry, daily summary) to it as they happen.</p>
          <pre class="code">curl ${baseUrl}/api/hq/overview \\
  -H "Authorization: Bearer sk_your_key"

curl ${baseUrl}/api/reports/daily?branch_id=all&date=${app.today} \\
  -H "Authorization: Bearer sk_your_key"</pre>
          <p class="small muted">Full endpoint list: <code>docs/API.md</code> in the project. Amounts are integers in the smallest currency unit (e.g. paise/cents).</p>
        </div>
        <div class="card"><div class="card-head"><div><h2>API keys</h2><p>A key without a branch has full head-office access. A branch key can only touch that branch.</p></div><button class="btn primary" data-k="new">${icon("key", 16)} New API key</button></div>
          <div class="table-wrap">${keys.length
            ? html`<table class="table"><thead><tr><th>Name</th><th>Key</th><th>Scope</th><th>Last used</th><th>Status</th><th></th></tr></thead><tbody>${keys.map(
                (k) => html`<tr><td><strong>${k.name}</strong><div class="sub">created ${dateTime(k.created_at)}</div></td><td class="mono">${k.prefix}…</td><td>${k.branch_name ?? "All branches (HQ)"}</td><td class="small">${k.last_used_at ? dateTime(k.last_used_at) : "never"}</td>
                  <td>${k.active ? html`<span class="badge good">Active</span>` : html`<span class="badge">Revoked</span>`}</td><td>${k.active ? html`<button class="btn sm danger" data-k="revoke" data-id="${k.id}">Revoke</button>` : ""}</td></tr>`
              )}</tbody></table>`
            : html`<div class="empty small">No API keys yet.</div>`}</div></div>
        <div class="card"><div class="card-head"><div><h2>Webhooks</h2><p>Signed with HMAC-SHA256: header <code>X-Store-Signature</code> = sha256 of <code>timestamp + "." + body</code>.</p></div><button class="btn primary" data-w="new">${icon("link", 16)} Add webhook</button></div>
          <div class="table-wrap">${hooks.webhooks.length
            ? html`<table class="table"><thead><tr><th>URL</th><th>Events</th><th>Branch</th><th>Failures</th><th>Status</th><th></th></tr></thead><tbody>${hooks.webhooks.map(
                (w) => html`<tr><td class="mono small" style="word-break:break-all">${w.url}<div class="sub">${w.description}</div></td><td class="small">${w.events === "*" ? "All events" : w.events.split(",").join(", ")}</td><td>${app.me.branches.find((b) => b.id === w.branch_id)?.name ?? "All"}</td>
                  <td>${w.failed_count ? html`<span class="badge bad">${w.failed_count}</span>` : html`<span class="faint">0</span>`}</td><td>${w.active ? html`<span class="badge good">On</span>` : html`<span class="badge">Off</span>`}</td>
                  <td class="nowrap"><button class="btn sm" data-w="test" data-id="${w.id}">Send test</button> <button class="btn sm" data-w="toggle" data-id="${w.id}">${w.active ? "Pause" : "Resume"}</button> <button class="btn sm danger" data-w="del" data-id="${w.id}" aria-label="Delete">${icon("trash", 14)}</button></td></tr>`
              )}</tbody></table>`
            : html`<div class="empty small">No webhooks yet.</div>`}</div></div>
        <div class="card"><div class="card-head"><h2>Recent deliveries</h2><button class="btn sm" data-w="reload">${icon("refresh", 14)} Refresh</button></div><div class="table-wrap">${deliveries.length
          ? html`<table class="table"><thead><tr><th>Event</th><th>When</th><th>Status</th><th>Attempts</th><th>Last result</th><th></th></tr></thead><tbody>${deliveries.map(
              (d) => html`<tr><td class="mono small">${d.event}</td><td class="small">${dateTime(d.created_at)}</td><td><span class="badge ${d.status === "delivered" ? "good" : d.status === "failed" ? "bad" : "warn"}">${d.status}</span></td><td class="num">${d.attempts}</td><td class="small">${d.last_status_code ?? ""} ${d.last_error}</td>
                <td>${d.status !== "delivered" ? html`<button class="btn sm" data-w="retry" data-id="${d.id}">Retry</button>` : ""}</td></tr>`
            )}</tbody></table>`
          : html`<div class="empty small">Nothing sent yet.</div>`}</div></div>
      </div>`
    );
    on(body, "click", "[data-k]", async (e, b) => {
      if (b.dataset.k === "revoke") {
        if (!(await confirmDialog("Revoke this key? Anything using it stops working immediately.", { ok: "Revoke", danger: true }))) return;
        await del(`/api/api-keys/${b.dataset.id}`);
        return integrations();
      }
      const { result } = modal({
        title: "New API key",
        size: "sm",
        body: html`<form class="stack"><label class="field"><span>Name</span><input class="input" name="name" required placeholder="e.g. Restaurant admin panel" /></label>
          <label class="field"><span>Scope</span><select class="input" name="branch_id">${options(app.me.branches, "", { empty: "All branches (head office)" })}</select></label></form>`,
        actions: [{ label: "Cancel" }, { label: "Create key", kind: "primary", submit: true }],
        onSubmit: (form) => post("/api/api-keys", { name: form.name.value, branch_id: form.branch_id.value || null })
      });
      const key = await result;
      if (!key) return;
      await modal({
        title: "Copy your API key now",
        body: html`<div class="stack"><div class="banner">${icon("alert")} This is the only time the full key is shown. Store it in your admin panel's secret settings.</div><div class="secret">${key.key}</div><button class="btn" data-copy>${icon("copy", 16)} Copy</button></div>`,
        actions: [{ label: "Done", kind: "primary" }],
        onMount(d) {
          d.querySelector("[data-copy]").addEventListener("click", () => navigator.clipboard?.writeText(key.key).then(() => toast("Copied", "success")));
        }
      }).result;
      integrations();
    });
    on(body, "click", "[data-w]", async (e, b) => {
      const act = b.dataset.w;
      const id = b.dataset.id;
      try {
        if (act === "reload") return integrations();
        if (act === "test") {
          await post(`/api/webhooks/${id}/test`);
          toast("Test event queued — refresh deliveries in a few seconds", "success");
          return;
        }
        if (act === "retry") {
          await post(`/api/webhooks/deliveries/${id}/retry`);
          setTimeout(integrations, 1500);
          return;
        }
        if (act === "toggle") {
          const hook = hooks.webhooks.find((w) => w.id === Number(id));
          await patch(`/api/webhooks/${id}`, { active: !hook.active });
          return integrations();
        }
        if (act === "del") {
          if (!(await confirmDialog("Delete this webhook?", { ok: "Delete", danger: true }))) return;
          await del(`/api/webhooks/${id}`);
          return integrations();
        }
        if (act === "new") {
          const { result } = modal({
            title: "Add webhook",
            body: html`<form class="stack">
              <label class="field"><span>URL (your admin panel endpoint)</span><input class="input mono" name="url" type="url" required placeholder="https://admin.example.com/webhooks/store" /></label>
              <label class="field"><span>Description</span><input class="input" name="description" /></label>
              <label class="field"><span>Branch</span><select class="input" name="branch_id">${options(app.me.branches, "", { empty: "All branches" })}</select></label>
              <div class="field"><span>Events</span><label class="check"><input type="checkbox" name="all" checked /> All events</label>
                <div class="form-grid" data-events>${hooks.events.map((ev) => html`<label class="check small"><input type="checkbox" value="${ev}" data-ev /> <code>${ev}</code></label>`)}</div></div></form>`,
            actions: [{ label: "Cancel" }, { label: "Add webhook", kind: "primary", submit: true }],
            onSubmit(form) {
              const events = form.all.checked ? ["*"] : [...form.querySelectorAll("[data-ev]:checked")].map((c) => c.value);
              return post("/api/webhooks", { url: form.url.value, description: form.description.value, branch_id: form.branch_id.value || null, events });
            }
          });
          const hook = await result;
          if (!hook) return;
          await modal({
            title: "Webhook signing secret",
            body: html`<div class="stack"><p>Use this secret in your admin panel to verify the <code>X-Store-Signature</code> header. It is shown only once.</p><div class="secret">${hook.secret}</div></div>`,
            actions: [{ label: "Done", kind: "primary" }]
          }).result;
          integrations();
        }
      } catch (err) {
        showError(err);
      }
    });
  }

  // ---- audit -------------------------------------------------------------------------------
  async function audit() {
    const rows = await get("/api/audit?limit=200");
    const body = fresh();
    mount(
      body,
      html`<div class="card"><div class="card-head"><div><h2>Activity log</h2><p>Sign-ins, approvals, refunds, price and settings changes.</p></div></div><div class="table-wrap">${rows.length
        ? html`<table class="table"><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Details</th></tr></thead><tbody>${rows.map(
            (r) => html`<tr><td class="small nowrap">${dateTime(r.created_at)}</td><td>${r.user_name ?? (r.api_key_name ? `API: ${r.api_key_name}` : "—")}</td><td class="mono small">${r.action}</td><td class="small muted" style="max-width:420px;word-break:break-word">${summarise(r.details)}</td></tr>`
          )}</tbody></table>`
        : html`<div class="empty">Nothing logged yet.</div>`}</div></div>`
    );
  }
  const summarise = (d) =>
    Object.entries(d ?? {})
      .filter(([, v]) => v !== undefined && v !== null && v !== "")
      .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`)
      .join(" · ")
      .slice(0, 300);

  await show();
}
