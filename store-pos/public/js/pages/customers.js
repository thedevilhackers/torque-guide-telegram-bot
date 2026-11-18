import { get, patch, post } from "../api.js";
import { $, dateTime, debounce, html, icon, modal, money, mount, on, readForm, showError, toast } from "../ui.js";

export default async function customersPage(el, app) {
  let term = "";
  mount(
    el,
    html`<div class="page-head"><div><h1>Customers & loyalty</h1><p>Members earn ${app.settings.loyalty.enabled ? `1 point per ${money(app.settings.loyalty.earn_per_amount)} spent; each point is worth ${money(app.settings.loyalty.point_value)}` : "no points (loyalty is off)"}. Points work at every branch.</p></div>
        <button class="btn primary" data-act="new">${icon("plus", 16)} New customer</button></div>
      <div class="card"><div class="card-head"><div class="search grow" style="max-width:360px">${icon("search")}<input class="input" data-search placeholder="Phone or name" /></div></div><div class="table-wrap" data-table></div></div>`
  );

  async function load() {
    try {
      const rows = await get(`/api/customers?search=${encodeURIComponent(term)}&limit=200`);
      mount(
        $("[data-table]", el),
        rows.length
          ? html`<table class="table"><thead><tr><th>Name</th><th>Phone</th><th class="num">Points</th><th class="num">Visits</th><th class="num">Total spent</th><th>Last visit</th></tr></thead><tbody>${rows.map(
              (c) => html`<tr class="clickable" data-id="${c.id}"><td><strong>${c.name || "—"}</strong></td><td class="mono">${c.phone ?? ""}</td><td class="num">${c.points}</td><td class="num">${c.visits}</td><td class="num">${money(c.total_spent)}</td><td class="small">${c.last_visit_at ? dateTime(c.last_visit_at) : "—"}</td></tr>`
            )}</tbody></table>`
          : html`<div class="empty">${icon("users", 40)}<div>${term ? "No customers match." : "No customers yet. Attach one at the till to start earning points."}</div></div>`
      );
    } catch (err) {
      showError(err);
    }
  }

  function edit(customer = null) {
    const { result } = modal({
      title: customer ? "Edit customer" : "New customer",
      size: "sm",
      body: html`<form class="stack">
        <label class="field"><span>Phone</span><input class="input" name="phone" inputmode="tel" value="${customer?.phone ?? ""}" /></label>
        <label class="field"><span>Name</span><input class="input" name="name" value="${customer?.name ?? ""}" /></label>
        <label class="field"><span>Email</span><input class="input" name="email" type="email" value="${customer?.email ?? ""}" /></label></form>`,
      actions: [{ label: "Cancel" }, { label: "Save", kind: "primary", submit: true }],
      onSubmit: (form) => (customer ? patch(`/api/customers/${customer.id}`, readForm(form)) : post("/api/customers", readForm(form)))
    });
    return result;
  }

  async function open(id) {
    const c = await get(`/api/customers/${id}`);
    const { close } = modal({
      title: c.name || c.phone,
      drawer: true,
      body: html`<div class="stack lg">
        <div class="grid cols-3">
          <div class="card kpi"><div class="label">Points</div><div class="value">${c.points}</div><div class="sub">worth ${money(c.points * app.settings.loyalty.point_value)}</div></div>
          <div class="card kpi"><div class="label">Visits</div><div class="value">${c.visits}</div></div>
          <div class="card kpi"><div class="label">Spent</div><div class="value">${money(c.total_spent)}</div></div>
        </div>
        <dl class="kv"><dt>Phone</dt><dd class="mono">${c.phone ?? "—"}</dd><dt>Email</dt><dd>${c.email || "—"}</dd><dt>Member since</dt><dd>${dateTime(c.created_at)}</dd></dl>
        <div><h3 style="margin-bottom:8px">Recent purchases</h3>${c.recent_sales.length
          ? html`<table class="table"><thead><tr><th>Receipt</th><th>Branch</th><th>When</th><th class="num">Points</th><th class="num">Total</th></tr></thead><tbody>${c.recent_sales.map(
              (s) => html`<tr><td class="mono">${s.receipt_no}</td><td>${s.branch_name}</td><td class="small">${dateTime(s.created_at)}</td><td class="num">${s.points_earned ? `+${s.points_earned}` : ""}${s.points_redeemed ? ` -${s.points_redeemed}` : ""}</td><td class="num">${money(s.total)}</td></tr>`
            )}</tbody></table>`
          : html`<p class="faint">No purchases yet.</p>`}</div></div>`,
      actions: [{ label: "Edit", icon: "edit", value: "edit" }, { label: "Close", kind: "primary" }]
    }).result.then(async (v) => {
      if (v === "edit" && (await edit(c))) {
        toast("Customer saved", "success");
        load();
      }
    });
    void close;
  }

  const search = debounce(() => load(), 250);
  $("[data-search]", el).addEventListener("input", (e) => {
    term = e.target.value.trim();
    search();
  });
  on(el, "click", "[data-act=new]", async () => {
    if (await edit()) {
      toast("Customer added", "success");
      load();
    }
  });
  on(el, "click", "tr[data-id]", (e, row) => open(row.dataset.id).catch(showError));
  await load();
}
