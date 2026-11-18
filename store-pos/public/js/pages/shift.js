import { get, post } from "../api.js";
import { printReport } from "../print.js";
import { $, dateTime, html, icon, modal, money, mount, on, showError, toMinor, toast } from "../ui.js";

export default async function shiftPage(el, app) {
  const methodLabel = (id) => (id === "points" ? "Loyalty points" : app.settings.payment_methods.find((m) => m.id === id)?.label ?? id);

  function reportHtml(r) {
    const s = r.shift;
    return html`<div class="stack">
      <dl class="kv"><dt>Cashier</dt><dd>${s.user_name}</dd><dt>Register</dt><dd>${s.register}</dd><dt>Opened</dt><dd>${dateTime(s.opened_at)}</dd>${s.closed_at ? html`<dt>Closed</dt><dd>${dateTime(s.closed_at)} by ${s.closed_by_name ?? ""}</dd>` : ""}</dl>
      <div class="grid cols-4">
        <div class="card kpi"><div class="label">Sales</div><div class="value">${r.sales_count}</div><div class="sub">${money(r.sales_total)}</div></div>
        <div class="card kpi"><div class="label">Refunds</div><div class="value">${r.refunds_count}</div><div class="sub">${money(r.refunds_total)}</div></div>
        <div class="card kpi"><div class="label">Net total</div><div class="value">${money(r.net_total)}</div><div class="sub">Tax ${money(r.tax_total)}</div></div>
        <div class="card kpi"><div class="label">Expected cash in drawer</div><div class="value">${money(r.expected_cash)}</div><div class="sub">Float ${money(s.opening_float)}</div></div>
      </div>
      <table class="table"><thead><tr><th>Payment method</th><th class="num">Count</th><th class="num">Amount</th></tr></thead><tbody>${r.by_method.length ? r.by_method.map((m) => html`<tr><td>${methodLabel(m.method)}</td><td class="num">${m.count}</td><td class="num">${money(m.amount)}</td></tr>`) : html`<tr><td colspan="3" class="faint">No payments yet</td></tr>`}</tbody></table>
      ${r.cash_movements.length ? html`<table class="table"><thead><tr><th>Cash in / out</th><th>Reason</th><th>By</th><th class="num">Amount</th></tr></thead><tbody>${r.cash_movements.map((m) => html`<tr><td>${m.type === "pay_in" ? "Paid in" : "Paid out"}</td><td>${m.reason}</td><td>${m.user_name ?? ""}</td><td class="num">${m.type === "pay_out" ? "-" : ""}${money(m.amount)}</td></tr>`)}</tbody></table>` : ""}
      ${s.status === "closed" ? html`<div class="banner ${s.variance === 0 ? "info" : s.variance < 0 ? "danger" : ""}">${icon("cash")}<div>Counted <strong>${money(s.counted_cash)}</strong> vs expected ${money(s.expected_cash)} → <strong>${s.variance === 0 ? "exact" : `${s.variance > 0 ? "over" : "short"} by ${money(Math.abs(s.variance))}`}</strong>${s.note ? ` — ${s.note}` : ""}</div></div>` : ""}
    </div>`;
  }

  async function render() {
    const [current, recent] = await Promise.all([get("/api/shifts/current"), get("/api/shifts?limit=20")]);
    mount(
      el,
      html`<div class="page-head"><div><h1>Shift & cash drawer</h1><p>Open a shift with your starting cash, record cash paid in/out, and count the drawer when you close.</p></div></div>
        ${current
          ? html`<div class="card card-pad stack lg">
              <div class="row between"><h2>Your open shift <span class="badge good">Open</span></h2>
                <div class="row">
                  <button class="btn" data-act="pay_in">${icon("plus", 16)} Cash in</button>
                  <button class="btn" data-act="pay_out">${icon("minus", 16)} Cash out</button>
                  <button class="btn" data-act="print">${icon("printer", 16)} X report</button>
                  <button class="btn primary" data-act="close">${icon("lock", 16)} Close shift</button>
                </div></div>
              <div data-report>${reportHtml(current)}</div>
            </div>`
          : html`<div class="card card-pad" style="max-width:520px">
              <form class="stack" data-open>
                <h2>Open a shift</h2>
                <label class="field"><span>Starting cash in the drawer (float)</span><input class="input num" name="float" inputmode="decimal" placeholder="0.00" autofocus /></label>
                <label class="field"><span>Register / till name</span><input class="input" name="register" value="POS-1" /></label>
                <button class="btn primary lg" type="submit">${icon("play", 18)} Open shift</button>
              </form></div>`}
        <div class="card" style="margin-top:16px"><div class="card-head"><h2>Recent shifts</h2></div><div class="table-wrap">${recent.length
          ? html`<table class="table"><thead><tr><th>Cashier</th><th>Register</th><th>Opened</th><th>Status</th><th class="num">Sales</th><th class="num">Net</th><th class="num">Over / short</th></tr></thead><tbody>${recent.map(
              (s) => html`<tr class="clickable" data-shift="${s.id}"><td>${s.user_name}</td><td>${s.register}</td><td class="small">${dateTime(s.opened_at)}</td><td>${s.status === "open" ? html`<span class="badge good">Open</span>` : html`<span class="badge">Closed</span>`}</td><td class="num">${s.sales_count}</td><td class="num">${money(s.net_total)}</td><td class="num">${s.variance === null ? "—" : html`<span class="badge ${s.variance === 0 ? "good" : s.variance < 0 ? "bad" : "warn"}">${s.variance > 0 ? "+" : ""}${money(s.variance)}</span>`}</td></tr>`
            )}</tbody></table>`
          : html`<div class="empty">No shifts yet.</div>`}</div></div>`
    );

  }

  on(el, "submit", "[data-open]", async (e, form) => {
    e.preventDefault();
    try {
      const amount = toMinor(form.float.value);
      await post("/api/shifts/open", { opening_float: Number.isFinite(amount) ? amount : 0, register: form.register.value });
      toast("Shift opened", "success");
      await app.reloadMe();
      render();
    } catch (err) {
      showError(err);
    }
  });
  on(el, "click", "[data-act]", async (e, b) => {
    const act = b.dataset.act;
    const current = await get("/api/shifts/current");
    if (!current) return render();
    if (act === "pay_in" || act === "pay_out") {
      const { result } = modal({
        title: act === "pay_in" ? "Cash paid into drawer" : "Cash paid out of drawer",
        size: "sm",
        body: html`<form class="stack"><label class="field"><span>Amount</span><input class="input num" name="amount" inputmode="decimal" required autofocus /></label><label class="field"><span>Reason</span><input class="input" name="reason" required placeholder="${act === "pay_in" ? "e.g. change top-up" : "e.g. supplier paid in cash, safe drop"}" /></label></form>`,
        actions: [{ label: "Cancel" }, { label: "Save", kind: "primary", submit: true }],
        onSubmit: (form) => post(`/api/shifts/${current.shift.id}/cash`, { type: act, amount: toMinor(form.amount.value), reason: form.reason.value })
      });
      if (await result) {
        toast("Recorded", "success");
        render();
      }
    }
    if (act === "print") printReport(`Shift report (X) — ${current.shift.user_name}`, $("[data-report]", el).innerHTML);
    if (act === "close") {
      const { result } = modal({
        title: "Close shift",
        size: "sm",
        body: html`<form class="stack"><p class="muted">Count all cash in the drawer, including the float.</p>
          <label class="field"><span>Counted cash</span><input class="input num" name="counted" inputmode="decimal" required autofocus style="font-size:22px" /></label>
          <label class="field"><span>Note</span><input class="input" name="note" placeholder="Optional" /></label></form>`,
        actions: [{ label: "Cancel" }, { label: "Close shift", kind: "primary", submit: true }],
        onSubmit: (form) => post(`/api/shifts/${current.shift.id}/close`, { counted_cash: toMinor(form.counted.value), note: form.note.value })
      });
      const closed = await result;
      if (!closed) return;
      await app.reloadMe();
      const v = closed.shift.variance;
      modal({
        title: "Shift closed",
        body: html`<div data-z>${reportHtml(closed)}</div>`,
        size: "lg",
        actions: [{ label: "Print Z report", icon: "printer", onClick: (d) => (printReport(`Shift report (Z) — ${closed.shift.user_name}`, $("[data-z]", d).innerHTML), false) }, { label: "Done", kind: "primary" }]
      });
      toast(v === 0 ? "Drawer balanced exactly" : `Drawer ${v > 0 ? "over" : "short"} by ${money(Math.abs(v))}`, v === 0 ? "success" : "warn", 6000);
      render();
    }
  });
  on(el, "click", "[data-shift]", async (e, row) => {
    try {
      const r = await get(`/api/shifts/${row.dataset.shift}`);
      modal({ title: `Shift #${r.shift.id}`, size: "lg", body: html`<div data-z>${reportHtml(r)}</div>`, actions: [{ label: "Print", icon: "printer", onClick: (d) => (printReport(`Shift report — ${r.shift.user_name}`, $("[data-z]", d).innerHTML), false) }, { label: "Close", kind: "primary" }] });
    } catch (err) {
      showError(err);
    }
  });

  await render();
}
