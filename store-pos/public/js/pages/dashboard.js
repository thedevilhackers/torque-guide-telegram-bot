import { get, post } from "../api.js";
import { drawColumnChart } from "../charts.js";
import { $, confirmDialog, dayLabel, expiryBadge, html, icon, money, moneyCompact, mount, on, qty, showError, timeOnly, toast } from "../ui.js";

export default async function dashboardPage(el, app) {
  const canReports = app.can("reports.view");
  const isOwner = app.me.user.role === "owner";
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  const [summary, trend, alerts, hq] = await Promise.all([
    canReports ? get(`/api/reports/daily?date=${app.today}`) : null,
    canReports ? get(`/api/reports/trend?days=14`) : null,
    app.can("stock.view") ? get("/api/stock/alerts") : null,
    isOwner ? get("/api/hq/overview") : null
  ]);

  const t = summary?.totals;
  mount(
    el,
    html`
      <div class="page-head">
        <div><h1>${greeting}, ${app.me.user.name.split(" ")[0]}</h1><p>${app.branch?.name} · ${dayLabel(app.today, { weekday: "long", day: "numeric", month: "long" })}</p></div>
        <div class="row">
          ${app.can("pos.sell") ? html`<a class="btn primary" href="#/pos">${icon("cart", 16)} Open till</a>` : ""}
          ${app.can("stock.receive") ? html`<a class="btn" href="#/receive">${icon("truck", 16)} Receive stock</a>` : ""}
        </div>
      </div>
      ${app.settings.require_shift && app.can("pos.sell") && !app.me.shift ? html`<div class="banner info">${icon("clock")}<div class="grow">You don't have an open shift at this branch.</div><a class="btn sm" href="#/shift">Open shift</a></div>` : ""}
      ${t
        ? html`<div class="grid cols-4" style="margin-bottom:16px">
            <div class="card kpi" style="grid-column:span 2"><div class="label">Net sales today</div><div class="value hero">${money(t.net_sales)}</div><div class="sub">${t.refunds_count ? `${money(t.refunds_total)} refunded · ` : ""}tax ${money(t.tax)}</div></div>
            <div class="card kpi"><div class="label">Transactions</div><div class="value">${t.transactions}</div><div class="sub">Avg basket ${money(t.avg_basket)}</div></div>
            <div class="card kpi"><div class="label">Gross profit</div><div class="value">${money(t.gross_profit)}</div><div class="sub">${t.margin_pct}% margin</div></div>
          </div>`
        : ""}
      <div class="dash">
        <div class="stack lg">
          ${trend
            ? html`<div class="card">
                <div class="card-head"><div><h2>Net sales, last 14 days</h2><p>${app.branch?.name}</p></div><a class="btn sm ghost" href="#/reports">Full report</a></div>
                <div class="card-body"><div data-trend></div>
                  <details style="margin-top:8px"><summary class="small muted" style="cursor:pointer">Show as table</summary>
                    <table class="table"><thead><tr><th>Date</th><th class="num">Transactions</th><th class="num">Net sales</th><th class="num">Gross profit</th></tr></thead><tbody>${trend.map(
                      (d) => html`<tr><td>${dayLabel(d.date, { weekday: "short", day: "numeric", month: "short" })}</td><td class="num">${d.transactions}</td><td class="num">${money(d.net_sales)}</td><td class="num">${money(d.gross_profit)}</td></tr>`
                    )}</tbody></table></details>
                </div></div>`
            : ""}
          ${summary
            ? html`<div class="grid cols-2" style="align-items:start">
                <div class="card">
                  <div class="card-head"><h2>Top sellers today</h2></div>
                  <div class="card-body">${summary.top_products.length
                    ? html`<ul class="list-plain">${summary.top_products.slice(0, 6).map((p) => html`<li><span class="ellipsis">${p.name} <span class="faint small">× ${qty(p.qty)}</span></span><strong class="num">${money(p.total)}</strong></li>`)}</ul>`
                    : html`<p class="faint">No sales yet today.</p>`}</div></div>
                <div class="card">
                  <div class="card-head"><h2>Payments today</h2></div>
                  <div class="card-body">${summary.payments.length
                    ? html`<ul class="list-plain">${summary.payments.map((p) => html`<li><span>${methodLabel(app, p.method)} <span class="faint small">${p.count} sales</span></span><strong class="num">${money(p.amount)}</strong></li>`)}</ul>`
                    : html`<p class="faint">No payments yet.</p>`}</div></div>
              </div>`
            : ""}
        </div>
        ${alerts ? alertsCard(alerts, app) : html`<div></div>`}
      </div>
      ${hq ? hqCard(hq, app) : ""}`
  );

  if (trend) {
    drawColumnChart($("[data-trend]", el), trend.map((d) => ({ label: dayLabel(d.date, { day: "numeric", month: "short" }), tip: dayLabel(d.date, { weekday: "short", day: "numeric", month: "short" }), value: d.net_sales })), {
      height: 220,
      format: money,
      axisFormat: moneyCompact,
      ariaLabel: "Net sales per day for the last 14 days"
    });
  }

  on(el, "click", "[data-lock]", async (e, b) => {
    const id = Number(b.dataset.lock);
    const locking = b.dataset.state === "unlocked";
    let reason = "";
    if (locking) {
      if (!(await confirmDialog("Locking stops all selling at this branch until you unlock it.", { title: "Lock branch", ok: "Lock branch", danger: true }))) return;
      reason = "Locked from head office";
    }
    try {
      await post(`/api/branches/${id}/${locking ? "lock" : "unlock"}`, { reason });
      toast(locking ? "Branch locked" : "Branch unlocked", "success");
      app.refresh();
    } catch (err) {
      showError(err);
    }
  });
}

const methodLabel = (app, id) => (id === "points" ? "Loyalty points" : app.settings.payment_methods.find((m) => m.id === id)?.label ?? id);

function alertsCard(a, app) {
  const c = a.counts;
  const nothing = !c.expired && !c.expiring && !c.low_stock;
  return html`<div class="card">
    <div class="card-head"><h2>Stock alerts</h2><a class="btn sm ghost" href="#/inventory">Inventory</a></div>
    <div class="card-body stack">
      ${nothing ? html`<p class="faint">${icon("check", 16)} Nothing needs attention.</p>` : ""}
      ${c.expired
        ? html`<a class="banner danger" style="text-decoration:none;margin:0" href="#/inventory?filter=expired">${icon("alert")}<div><strong>${c.expired} expired batch${c.expired === 1 ? "" : "es"}</strong> still in stock (${money(c.expired_value)}). Pull from shelf and write off.</div></a>`
        : ""}
      ${a.expiring.length
        ? html`<div><div class="row between"><strong>Expiring soon</strong><a class="small" href="#/inventory?filter=expiring">See all</a></div>
            <ul class="list-plain">${a.expiring.slice(0, 5).map((b) => html`<li><span class="ellipsis">${b.name} <span class="faint small">× ${qty(b.qty, b.unit)}</span></span>${expiryBadge(b.expiry_date, app.today)}</li>`)}</ul></div>`
        : ""}
      ${a.low_stock.length
        ? html`<div><div class="row between"><strong>Low stock</strong><a class="small" href="#/inventory?filter=low">See all</a></div>
            <ul class="list-plain">${a.low_stock.slice(0, 5).map((p) => html`<li><span class="ellipsis">${p.name}</span><span class="badge ${p.qty <= 0 ? "bad" : "warn"}">${qty(p.qty, p.unit)} / ${qty(p.reorder_level, p.unit)}</span></li>`)}</ul></div>`
        : ""}
    </div></div>`;
}

function hqCard(hq, app) {
  return html`<div class="card" style="margin-top:16px">
    <div class="card-head"><div><h2>All branches — live</h2><p>Each branch uses its own local date. Locking a branch stops selling there immediately.</p></div><a class="btn sm ghost" href="#/reports">Consolidated report</a></div>
    <div class="table-wrap"><table class="table">
      <thead><tr><th>Branch</th><th class="num">Net sales today</th><th class="num">Transactions</th><th class="num">Gross profit</th><th>Last sale</th><th>Open shifts</th><th>Alerts</th><th></th></tr></thead>
      <tbody>${hq.branches.filter((b) => b.active).map(
        (b) => html`<tr>
          <td><strong>${b.name}</strong> <span class="faint small">${b.code}</span>${b.locked ? html` <span class="badge bad">${icon("lock", 12)} Locked</span>` : ""}</td>
          <td class="num"><strong>${money(b.net_sales)}</strong></td>
          <td class="num">${b.transactions}</td>
          <td class="num">${money(b.gross_profit)}</td>
          <td class="small">${b.last_sale_at ? timeOnly(b.last_sale_at) : "—"}</td>
          <td>${b.open_shifts ? html`<span class="badge good">${b.open_shifts} open</span>` : html`<span class="faint small">none</span>`}</td>
          <td><div class="row tight">${b.alerts.expired ? html`<span class="badge bad">${b.alerts.expired} expired</span>` : ""}${b.alerts.expiring ? html`<span class="badge warn">${b.alerts.expiring} expiring</span>` : ""}${b.alerts.low_stock ? html`<span class="badge warn">${b.alerts.low_stock} low</span>` : ""}${!b.alerts.expired && !b.alerts.expiring && !b.alerts.low_stock ? html`<span class="badge good">OK</span>` : ""}</div></td>
          <td><button class="btn sm ${b.locked ? "" : "danger"}" data-lock="${b.id}" data-state="${b.locked ? "locked" : "unlocked"}">${icon(b.locked ? "unlock" : "lock", 14)} ${b.locked ? "Unlock" : "Lock"}</button></td>
        </tr>`
      )}</tbody></table></div></div>`;
}
