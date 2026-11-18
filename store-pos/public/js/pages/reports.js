import { download, get, qs } from "../api.js";
import { drawColumnChart } from "../charts.js";
import { printReport } from "../print.js";
import { $, dateTime, dayLabel, html, icon, money, moneyCompact, mount, on, qty, showError } from "../ui.js";

export default async function reportsPage(el, app) {
  const isOwner = app.me.user.role === "owner";
  const state = { tab: "daily", date: app.today, branch: isOwner && app.me.branches.length > 1 ? "all" : String(app.branchId) };

  mount(
    el,
    html`<div class="page-head">
        <div><h1>Reports</h1><p>End-of-day summary, what to reorder, and what your stock is worth.</p></div>
      </div>
      <div class="tabs" data-tabs>${[["daily", "Daily summary"], ["reorder", "Reorder suggestions"], ["valuation", "Stock value"]].map(([k, l]) => html`<button data-tab="${k}" class="${k === state.tab ? "active" : ""}">${l}</button>`)}</div>
      <div data-body></div>`
  );
  const body = $("[data-body]", el);

  const branchSelect = () =>
    isOwner
      ? html`<select class="input" style="width:auto" data-branch>${app.me.branches.length > 1 ? html`<option value="all" ${state.branch === "all" ? "selected" : ""}>All branches</option>` : ""}${app.me.branches.map((b) => html`<option value="${b.id}" ${String(b.id) === state.branch ? "selected" : ""}>${b.name}</option>`)}</select>`
      : "";

  async function daily() {
    mount(body, html`<div class="empty">Loading…</div>`);
    let s;
    try {
      s = await get(`/api/reports/daily${qs({ date: state.date, branch_id: state.branch })}`, { branch: state.branch === "all" ? null : state.branch });
    } catch (err) {
      return showError(err);
    }
    const t = s.totals;
    const maxPay = Math.max(1, ...s.payments.map((p) => Math.abs(p.amount)));
    const maxCat = Math.max(1, ...s.categories.map((c) => Math.abs(c.total)));
    const scopeName = state.branch === "all" ? "All branches" : app.me.branches.find((b) => String(b.id) === state.branch)?.name;
    mount(
      body,
      html`<div class="row between no-print" style="margin-bottom:14px">
          <div class="row"><input class="input" style="width:auto" type="date" data-date value="${state.date}" max="${app.today}" />${branchSelect()}</div>
          <div class="row">
            <button class="btn" data-act="print">${icon("printer", 16)} Print Z report</button>
            <button class="btn" data-act="sales-csv">${icon("download", 16)} Sales CSV</button>
            <button class="btn" data-act="stock-csv">${icon("download", 16)} Stock CSV</button>
          </div>
        </div>
        <div data-report class="stack lg">
          <p class="muted">${scopeName} · ${dayLabel(state.date, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</p>
          <div class="grid cols-4">
            <div class="card kpi" style="grid-column:span 2"><div class="label">Net sales (after refunds, incl. tax)</div><div class="value hero">${money(t.net_sales)}</div><div class="sub">${money(t.net_sales_ex_tax)} before tax</div></div>
            <div class="card kpi"><div class="label">Gross profit</div><div class="value">${money(t.gross_profit)}</div><div class="sub">${t.margin_pct}% margin · cost ${money(t.cost)}</div></div>
            <div class="card kpi"><div class="label">Transactions</div><div class="value">${t.transactions}</div><div class="sub">Avg basket ${money(t.avg_basket)} · ${qty(t.items_sold)} items</div></div>
            <div class="card kpi"><div class="label">Discounts given</div><div class="value">${money(t.discounts)}</div><div class="sub">Gross sales ${money(t.gross_sales)}</div></div>
            <div class="card kpi"><div class="label">Refunds</div><div class="value">${money(t.refunds_total)}</div><div class="sub">${t.refunds_count} refund${t.refunds_count === 1 ? "" : "s"}</div></div>
            <div class="card kpi"><div class="label">Tax collected</div><div class="value">${money(t.tax)}</div><div class="sub">${app.settings.prices_include_tax ? "Included in prices" : "Added to prices"}</div></div>
            <div class="card kpi"><div class="label">Loyalty</div><div class="value">${t.points_earned} pts</div><div class="sub">${t.loyalty_customers} members · ${t.points_redeemed} redeemed</div></div>
          </div>
          <div class="card"><div class="card-head"><h2>Sales by hour</h2><p>Local time</p></div><div class="card-body"><div data-hourly></div></div></div>
          <div class="grid cols-2" style="align-items:start">
            <div class="card"><div class="card-head"><h2>Payments</h2><p>Net of refunds; cash is net of change</p></div><div class="table-wrap">${s.payments.length
              ? html`<table class="table"><thead><tr><th>Method</th><th class="num">Sales</th><th class="num">Amount</th><th style="width:30%"></th></tr></thead><tbody>${s.payments.map(
                  (p) => html`<tr><td>${p.method === "points" ? "Loyalty points" : app.settings.payment_methods.find((m) => m.id === p.method)?.label ?? p.method}</td><td class="num">${p.count}</td><td class="num">${money(p.amount)}</td><td><div class="inline-bar" style="width:${(Math.abs(p.amount) / maxPay) * 100}%"></div></td></tr>`
                )}</tbody></table>`
              : html`<div class="empty small">No payments.</div>`}</div></div>
            <div class="card"><div class="card-head"><h2>Categories</h2></div><div class="table-wrap">${s.categories.length
              ? html`<table class="table"><thead><tr><th>Category</th><th class="num">Qty</th><th class="num">Sales</th><th class="num">Profit</th><th style="width:22%"></th></tr></thead><tbody>${s.categories.map(
                  (c) => html`<tr><td>${c.name}</td><td class="num">${qty(c.qty)}</td><td class="num">${money(c.total)}</td><td class="num">${money(c.profit)}</td><td><div class="inline-bar" style="width:${(Math.abs(c.total) / maxCat) * 100}%"></div></td></tr>`
                )}</tbody></table>`
              : html`<div class="empty small">No sales.</div>`}</div></div>
            <div class="card"><div class="card-head"><h2>Top products</h2></div><div class="table-wrap">${s.top_products.length
              ? html`<table class="table"><thead><tr><th>Product</th><th class="num">Qty</th><th class="num">Sales</th><th class="num">Profit</th></tr></thead><tbody>${s.top_products.map(
                  (p) => html`<tr><td>${p.name}</td><td class="num">${qty(p.qty)}</td><td class="num">${money(p.total)}</td><td class="num">${money(p.profit)}</td></tr>`
                )}</tbody></table>`
              : html`<div class="empty small">No sales.</div>`}</div></div>
            <div class="card"><div class="card-head"><h2>Cashiers</h2></div><div class="table-wrap">${s.cashiers.length
              ? html`<table class="table"><thead><tr><th>Name</th><th class="num">Transactions</th><th class="num">Net</th></tr></thead><tbody>${s.cashiers.map(
                  (c) => html`<tr><td>${c.name}</td><td class="num">${c.transactions}</td><td class="num">${money(c.total)}</td></tr>`
                )}</tbody></table>`
              : html`<div class="empty small">No sales.</div>`}</div></div>
            <div class="card"><div class="card-head"><h2>Stock movement</h2></div><div class="card-body"><ul class="list-plain">
              <li><span>Deliveries received</span><span>${s.stock.receipts} · ${qty(s.stock.received_qty)} units · <strong>${money(s.stock.received_value)}</strong></span></li>
              <li><span>Expired written off</span><span>${qty(s.stock.write_off_qty)} units · <strong style="color:${s.stock.write_off_value ? "var(--danger)" : "inherit"}">${money(s.stock.write_off_value)}</strong></span></li>
              <li><span>Adjustments (damage, theft, found…)</span><strong>${money(s.stock.adjustments_value)}</strong></li>
              <li><span>Stock count variance</span><strong>${money(s.stock.count_variance_value)}</strong></li>
              <li><span>Transfers in / out</span><span>${qty(s.stock.transfers_in_qty)} / ${qty(s.stock.transfers_out_qty)} units</span></li>
            </ul></div></div>
            <div class="card"><div class="card-head"><h2>Stock alerts now</h2></div><div class="card-body"><ul class="list-plain">
              <li><span>Expired batches on hand</span><span class="badge ${s.alerts.expired ? "bad" : "good"}">${s.alerts.expired} · ${money(s.alerts.expired_value)}</span></li>
              <li><span>Expiring soon</span><span class="badge ${s.alerts.expiring ? "warn" : "good"}">${s.alerts.expiring} · ${money(s.alerts.expiring_value)}</span></li>
              <li><span>At or below reorder level</span><span class="badge ${s.alerts.low_stock ? "warn" : "good"}">${s.alerts.low_stock}</span></li>
              <li><span>Out of stock</span><span class="badge ${s.alerts.out_of_stock ? "bad" : "good"}">${s.alerts.out_of_stock}</span></li>
            </ul></div></div>
          </div>
          ${s.shifts.length
            ? html`<div class="card"><div class="card-head"><h2>Shifts & cash</h2></div><div class="table-wrap"><table class="table"><thead><tr><th>Cashier</th><th>Register</th><th>Opened</th><th>Closed</th><th class="num">Expected cash</th><th class="num">Counted</th><th class="num">Over / short</th></tr></thead><tbody>${s.shifts.map(
                (sh) => html`<tr><td>${sh.user_name}</td><td>${sh.register}</td><td class="small">${dateTime(sh.opened_at)}</td><td class="small">${sh.closed_at ? dateTime(sh.closed_at) : html`<span class="badge good">Open</span>`}</td><td class="num">${sh.expected_cash === null ? "—" : money(sh.expected_cash)}</td><td class="num">${sh.counted_cash === null ? "—" : money(sh.counted_cash)}</td><td class="num">${sh.variance === null ? "—" : html`<span class="badge ${sh.variance === 0 ? "good" : sh.variance < 0 ? "bad" : "warn"}">${sh.variance > 0 ? "+" : ""}${money(sh.variance)}</span>`}</td></tr>`
              )}</tbody></table></div></div>`
            : ""}
          ${s.branches
            ? html`<div class="card"><div class="card-head"><h2>By branch</h2></div><div class="table-wrap"><table class="table"><thead><tr><th>Branch</th><th class="num">Transactions</th><th class="num">Net sales</th><th class="num">Gross profit</th></tr></thead><tbody>${s.branches.map(
                (b) => html`<tr><td>${b.name} <span class="faint small">${b.code}</span></td><td class="num">${b.transactions}</td><td class="num">${money(b.net_sales)}</td><td class="num">${money(b.gross_profit)}</td></tr>`
              )}</tbody></table></div></div>`
            : ""}
        </div>`
    );
    const firstHour = s.hourly.findIndex((h) => h.total !== 0);
    const lastHour = 23 - [...s.hourly].reverse().findIndex((h) => h.total !== 0);
    const hours = firstHour === -1 ? s.hourly.slice(8, 22) : s.hourly.slice(Math.min(firstHour, 8), Math.max(lastHour + 1, 21));
    drawColumnChart($("[data-hourly]", body), hours.map((h) => ({ label: `${String(h.hour).padStart(2, "0")}h`, tip: `${String(h.hour).padStart(2, "0")}:00–${String(h.hour + 1).padStart(2, "0")}:00 · ${h.transactions} sales`, value: Math.max(h.total, 0) })), {
      height: 190,
      format: money,
      axisFormat: moneyCompact,
      ariaLabel: "Net sales by hour"
    });
  }

  async function reorder() {
    mount(body, html`<div class="empty">Loading…</div>`);
    const rows = await get("/api/reports/reorder");
    mount(
      body,
      html`<div class="card"><div class="card-head"><div><h2>Suggested order for ${app.branch.name}</h2><p>Based on the last 14 days of sales, supplier lead time and your reorder levels.</p></div><button class="btn" data-act="print-reorder">${icon("printer", 16)} Print</button></div>
        <div class="table-wrap" data-reorder>${rows.length
          ? html`<table class="table"><thead><tr><th>Product</th><th>Supplier</th><th class="num">In stock</th><th class="num">Sold / day</th><th class="num">Days left</th><th class="num">Order</th><th class="num">Est. cost</th></tr></thead><tbody>${rows.map(
              (r) => html`<tr><td><strong>${r.name}</strong><div class="sub">${r.sku}</div></td><td>${r.supplier_name ?? "—"}<div class="sub">${r.lead_days} day lead time</div></td><td class="num">${qty(r.stock, r.unit)}</td><td class="num">${r.avg_daily}</td>
                <td class="num">${r.days_of_cover === null ? "—" : html`<span class="badge ${r.days_of_cover <= 2 ? "bad" : "warn"}">${r.days_of_cover}</span>`}</td><td class="num"><strong>${qty(r.suggested_qty, r.unit)}</strong></td><td class="num">${money(r.estimated_cost)}</td></tr>`
            )}</tbody><tfoot><tr><td colspan="6">Total</td><td class="num">${money(rows.reduce((s, r) => s + r.estimated_cost, 0))}</td></tr></tfoot></table>`
          : html`<div class="empty">${icon("check", 32)}<div>Nothing needs reordering right now.</div></div>`}</div></div>`
    );
  }

  async function valuation() {
    mount(body, html`<div class="empty">Loading…</div>`);
    const v = await get(`/api/reports/valuation${qs({ branch_id: state.branch })}`, { branch: state.branch === "all" ? null : state.branch });
    mount(
      body,
      html`<div class="row no-print" style="margin-bottom:14px">${branchSelect()}</div>
        <div class="grid cols-3" style="margin-bottom:16px">
          <div class="card kpi"><div class="label">Stock at cost</div><div class="value">${money(v.cost_value)}</div><div class="sub">What you paid (by batch)</div></div>
          <div class="card kpi"><div class="label">Stock at selling price</div><div class="value">${money(v.retail_value)}</div><div class="sub">If everything sold</div></div>
          <div class="card kpi"><div class="label">Potential gross profit</div><div class="value">${money(v.retail_value - v.cost_value)}</div><div class="sub">Before tax</div></div>
        </div>
        <div class="card"><div class="table-wrap"><table class="table"><thead><tr><th>Category</th><th class="num">Units</th><th class="num">At cost</th><th class="num">At selling price</th></tr></thead><tbody>${v.categories.map(
          (c) => html`<tr><td>${c.category}</td><td class="num">${qty(c.qty)}</td><td class="num">${money(c.cost_value)}</td><td class="num">${money(c.retail_value)}</td></tr>`
        )}</tbody></table></div></div>`
    );
  }

  const views = { daily, reorder, valuation };
  on(el, "click", "[data-tab]", (e, b) => {
    state.tab = b.dataset.tab;
    el.querySelectorAll("[data-tab]").forEach((x) => x.classList.toggle("active", x === b));
    views[state.tab]().catch(showError);
  });
  on(el, "change", "[data-date]", (e, i) => {
    state.date = i.value || app.today;
    daily();
  });
  on(el, "change", "[data-branch]", (e, s) => {
    state.branch = s.value;
    views[state.tab]().catch(showError);
  });
  on(el, "click", "[data-act]", (e, b) => {
    const act = b.dataset.act;
    const branchQ = state.branch === "all" ? "all" : state.branch;
    if (act === "print") printReport(`Z report — ${dayLabel(state.date)}`, $("[data-report]", body).innerHTML);
    if (act === "sales-csv") downloadWithBranch(`/api/reports/export/sales.csv${qs({ from: state.date, to: state.date, branch_id: branchQ })}`, `sales_${state.date}.csv`);
    if (act === "stock-csv") downloadWithBranch(`/api/reports/export/stock.csv${qs({ branch_id: branchQ })}`, `stock_${state.date}.csv`);
    if (act === "print-reorder") printReport(`Reorder list — ${app.branch.name}`, $("[data-reorder]", body).innerHTML);
  });
  const downloadWithBranch = (path, name) => download(path, name, { branch: state.branch === "all" ? null : state.branch }).catch(showError);

  await daily();
}
