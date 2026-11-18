import { get, post, qs } from "../api.js";
import { printReceipt } from "../print.js";
import { onScan } from "../scanner.js";
import { $, addDays, askPin, dateTime, debounce, html, icon, modal, money, mount, on, qty, showError, toast } from "../ui.js";

export default async function salesPage(el, app) {
  const state = { search: "", from: addDays(app.today, -6), to: app.today, type: "" };
  const methods = app.settings.payment_methods;
  const methodLabel = (id) => (id === "points" ? "Points" : methods.find((m) => m.id === id)?.label ?? id);

  mount(
    el,
    html`<div class="page-head">
        <div><h1>Sales & refunds</h1><p>Find a receipt (or scan the barcode on it) to reprint or refund.</p></div>
      </div>
      <div class="card">
        <div class="card-head">
          <div class="row grow">
            <div class="search grow" style="max-width:320px">${icon("search")}<input class="input" data-search placeholder="Receipt no., phone or name" /></div>
            <input class="input" style="width:auto" type="date" data-from value="${state.from}" aria-label="From" />
            <input class="input" style="width:auto" type="date" data-to value="${state.to}" aria-label="To" />
            <select class="input" style="width:auto" data-type><option value="">Sales & refunds</option><option value="sale">Sales only</option><option value="refund">Refunds only</option></select>
          </div>
        </div>
        <div class="table-wrap" data-table></div>
      </div>`
  );

  async function load() {
    try {
      const rows = await get(`/api/sales${qs({ search: state.search, from: state.from, to: state.to, type: state.type, limit: 300 })}`);
      mount(
        $("[data-table]", el),
        rows.length
          ? html`<table class="table"><thead><tr><th>Receipt</th><th>Time</th><th>Cashier</th><th>Customer</th><th>Paid by</th><th class="num">Items</th><th class="num">Total</th></tr></thead><tbody>${rows.map(
              (s) => html`<tr class="clickable" data-id="${s.id}"><td><span class="mono">${s.receipt_no}</span> ${s.type === "refund" ? html`<span class="badge bad">Refund</span>` : s.status !== "completed" ? html`<span class="badge warn">${s.status.replace("_", " ")}</span>` : ""}</td>
                <td class="small nowrap">${dateTime(s.created_at)}</td><td>${s.cashier_name ?? "—"}</td><td>${s.customer_name || s.customer_phone || html`<span class="faint">—</span>`}</td>
                <td class="small">${(s.methods ?? "").split(",").filter(Boolean).map(methodLabel).join(", ")}</td><td class="num">${qty(Math.abs(s.items_count))}</td><td class="num" style="font-weight:600">${money(s.total)}</td></tr>`
            )}</tbody></table>`
          : html`<div class="empty">${icon("receipt", 40)}<div>No sales in this period.</div></div>`
      );
    } catch (err) {
      showError(err);
    }
  }

  const reload = debounce(load, 250);
  $("[data-search]", el).addEventListener("input", (e) => {
    state.search = e.target.value.trim();
    reload();
  });
  for (const key of ["from", "to", "type"]) {
    $(`[data-${key}]`, el).addEventListener("change", (e) => {
      state[key] = e.target.value;
      load();
    });
  }
  on(el, "click", "tr[data-id]", (e, row) => openSale(app, row.dataset.id, load));
  const stop = onScan(async (code) => {
    try {
      const sale = await get(`/api/sales/${encodeURIComponent(code)}`);
      openSale(app, sale.id, load);
    } catch {
      toast(`No receipt ${code} at this branch`, "error");
    }
  });
  await load();
  return stop;
}

export async function openSale(app, id, onChange = () => {}) {
  const sale = await get(`/api/sales/${id}`);
  const methods = app.settings.payment_methods;
  const methodLabel = (m) => (m === "points" ? "Points" : methods.find((x) => x.id === m)?.label ?? m);
  const refundable = sale.type === "sale" && sale.items.some((i) => i.qty - i.refunded_qty > 0.0005);
  const { el: dialog, close } = modal({
    title: `${sale.type === "refund" ? "Refund" : "Receipt"} ${sale.receipt_no}`,
    size: "lg",
    body: html`<div class="stack">
      <p class="muted">${dateTime(sale.created_at)} · ${sale.branch.name} · cashier ${sale.cashier?.name ?? "—"}${sale.approver ? ` · approved by ${sale.approver.name}` : ""}${sale.customer ? ` · ${sale.customer.name || sale.customer.phone}` : ""}</p>
      ${sale.refund_of_receipt ? html`<div class="banner info">Refund of ${sale.refund_of_receipt}${sale.note ? ` — ${sale.note}` : ""}</div>` : ""}
      ${sale.refunds.length ? html`<div class="banner">${icon("refresh", 18)} Refunds: ${sale.refunds.map((r) => `${r.receipt_no} (${money(r.total)})`).join(", ")}</div>` : ""}
      <table class="table"><thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Price</th><th class="num">Discount</th><th class="num">Total</th></tr></thead><tbody>${sale.items.map(
        (i) => html`<tr><td>${i.name}${i.promo_name ? html`<div class="sub">${i.promo_name}</div>` : ""}${i.refunded_qty ? html`<div class="sub" style="color:var(--danger)">${qty(i.refunded_qty)} refunded</div>` : ""}</td><td class="num">${qty(i.qty)}</td><td class="num">${money(i.unit_price)}</td><td class="num">${i.discount ? money(i.discount) : ""}</td><td class="num">${money(i.total)}</td></tr>`
      )}</tbody>
      <tfoot><tr><td colspan="4">Total${sale.tax_total ? html` <span class="faint small">(tax ${money(sale.tax_total)})</span>` : ""}</td><td class="num">${money(sale.total)}</td></tr></tfoot></table>
      <div class="row">${sale.payments.map((p) => html`<span class="badge">${methodLabel(p.method)} ${money(p.amount)}</span>`)}${sale.change_due ? html`<span class="badge">Change ${money(sale.change_due)}</span>` : ""}</div>
    </div>`,
    actions: [
      { label: "Close" },
      { label: "Reprint", icon: "printer", onClick: () => (printReceipt(sale, { storeName: app.settings.store_name, header: app.settings.receipt_header, methods, locale: app.settings.locale }), false) },
      ...(refundable ? [{ label: "Refund…", kind: "danger", icon: "refresh", onClick: () => (refund(app, sale, () => (close(), onChange())), false) }] : [])
    ]
  });
  return dialog;
}

async function refund(app, sale, done) {
  const methods = app.settings.payment_methods;
  const items = sale.items.map((i) => ({ ...i, left: Math.round((i.qty - i.refunded_qty) * 1000) / 1000 })).filter((i) => i.left > 0);
  const original = sale.payments.find((p) => p.method !== "points")?.method ?? "cash";
  const { result } = modal({
    title: `Refund ${sale.receipt_no}`,
    size: "lg",
    body: html`<form class="stack">
      <table class="table"><thead><tr><th>Item</th><th class="num">Bought</th><th class="num" style="width:120px">Return</th></tr></thead><tbody>${items.map(
        (i) => html`<tr><td>${i.name}</td><td class="num">${qty(i.left)}</td><td><input class="input sm num" type="number" min="0" max="${i.left}" step="any" data-item="${i.id}" value="${i.left}" /></td></tr>`
      )}</tbody></table>
      <div class="form-grid">
        <label class="field"><span>Refund to</span><select class="input" name="method">${methods.map((m) => html`<option value="${m.id}" ${m.id === original ? "selected" : ""}>${m.label}</option>`)}</select></label>
        <label class="field"><span>Reason</span><input class="input" name="reason" required placeholder="e.g. damaged, wrong item" /></label>
        <label class="check full"><input type="checkbox" name="restock" checked /> Put items back on the shelf (restock into their original batches)</label>
      </div>
      ${app.can("sales.refund") ? "" : html`<p class="small muted">${icon("lock", 14)} A manager PIN is needed to complete the refund.</p>`}
    </form>`,
    actions: [{ label: "Cancel" }, { label: "Refund", kind: "solid-danger", submit: true }],
    async onSubmit(form) {
      const lines = [...form.querySelectorAll("[data-item]")].map((i) => ({ sale_item_id: Number(i.dataset.item), qty: Number(i.value) })).filter((l) => l.qty > 0);
      if (!lines.length) throw new Error("Choose at least one item to return");
      const body = { items: lines, method: form.method.value, reason: form.reason.value, restock: form.restock.checked };
      const attempt = async (pin) => {
        try {
          return await post(`/api/sales/${sale.id}/refund`, { ...body, override_pin: pin });
        } catch (err) {
          if (err.code === "APPROVAL_REQUIRED") {
            const entered = await askPin({ reasons: ["Refund needs manager approval"] });
            if (!entered) return false;
            return attempt(entered);
          }
          throw err;
        }
      };
      const res = await attempt();
      if (!res) return false;
      toast(`Refunded ${money(Math.abs(res.total))} — ${res.receipt_no}`, "success", 5000);
      printReceipt(res, { storeName: app.settings.store_name, header: app.settings.receipt_header, methods, locale: app.settings.locale });
      return res;
    }
  });
  if (await result) done();
}
