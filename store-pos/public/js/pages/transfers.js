import { get, post } from "../api.js";
import { onScan, scanField } from "../scanner.js";
import { $, beep, confirmDialog, dateTime, html, icon, modal, mount, on, options, qty, showError, toast } from "../ui.js";

const STATUS = { in_transit: ["warn", "In transit"], received: ["good", "Received"], cancelled: ["", "Cancelled"] };

export default async function transfersPage(el, app) {
  async function load() {
    const list = await get("/api/transfers");
    const incoming = list.filter((t) => t.to_branch_id === app.branchId && t.status === "in_transit");
    mount(
      el,
      html`<div class="page-head">
          <div><h1>Transfers</h1><p>Move stock between branches. Expiry dates and costs travel with the stock.</p></div>
          ${app.can("stock.transfer") && app.me.branches.filter((b) => b.active).length > 1 ? html`<button class="btn primary" data-act="new">${icon("plus", 16)} New transfer</button>` : ""}
        </div>
        ${incoming.length ? html`<div class="banner info">${icon("truck")}<div><strong>${incoming.length} transfer(s) on the way to this branch.</strong> Receive them when the goods arrive.</div></div>` : ""}
        <div class="card"><div class="table-wrap">${list.length
          ? html`<table class="table"><thead><tr><th>#</th><th>From → To</th><th class="num">Products</th><th class="num">Units</th><th>Status</th><th>Sent</th><th></th></tr></thead><tbody>${list.map((t) => {
              const [kind, label] = STATUS[t.status];
              const canReceive = t.status === "in_transit" && t.to_branch_id === app.branchId && app.can("stock.receive");
              const canCancel = t.status === "in_transit" && (t.from_branch_id === app.branchId || app.me.user.role === "owner") && app.can("stock.transfer");
              return html`<tr class="clickable" data-id="${t.id}"><td>${t.id}</td><td>${t.from_branch_name} → ${t.to_branch_name}</td><td class="num">${t.product_count}</td><td class="num">${qty(t.total_qty)}</td><td><span class="badge ${kind}">${label}</span></td><td class="small">${dateTime(t.created_at)}</td>
                <td class="nowrap" data-stop>${canReceive ? html`<button class="btn sm primary" data-receive="${t.id}">Receive</button>` : ""} ${canCancel ? html`<button class="btn sm" data-cancel="${t.id}">Cancel</button>` : ""}</td></tr>`;
            })}</tbody></table>`
          : html`<div class="empty">${icon("transfer", 40)}<div>No transfers yet.</div></div>`}</div></div>`
    );
  }

  on(el, "click", "[data-act=new]", () => newTransfer());
  on(el, "click", "[data-receive]", async (e, b) => {
    try {
      await post(`/api/transfers/${b.dataset.receive}/receive`);
      toast("Transfer received into stock", "success");
      load();
    } catch (err) {
      showError(err);
    }
  });
  on(el, "click", "[data-cancel]", async (e, b) => {
    if (!(await confirmDialog("Cancel this transfer? The stock goes back to the sending branch.", { ok: "Cancel transfer", danger: true }))) return;
    try {
      await post(`/api/transfers/${b.dataset.cancel}/cancel`);
      toast("Transfer cancelled", "success");
      load();
    } catch (err) {
      showError(err);
    }
  });
  on(el, "click", "tr[data-id]", async (e, row) => {
    if (e.target.closest("[data-stop]")) return;
    const t = await get(`/api/transfers/${row.dataset.id}`);
    modal({
      title: `Transfer #${t.id}: ${t.from_branch_code} → ${t.to_branch_code}`,
      size: "lg",
      body: html`<p class="muted">Sent ${dateTime(t.created_at)} by ${t.created_by_name ?? "—"}${t.received_at ? ` · ${t.status} ${dateTime(t.received_at)} by ${t.received_by_name ?? "—"}` : ""}</p>
        ${t.note ? html`<p>${t.note}</p>` : ""}
        <table class="table" style="margin-top:10px"><thead><tr><th>Product</th><th class="num">Qty</th><th>Expiry</th><th>Batch</th></tr></thead><tbody>${t.items.map(
          (i) => html`<tr><td>${i.name}</td><td class="num">${qty(i.qty, i.unit)}</td><td>${i.expiry_date ?? "—"}</td><td>${i.batch_no || "—"}</td></tr>`
        )}</tbody></table>`,
      actions: [{ label: "Close" }]
    });
  });

  async function newTransfer() {
    let items = [];
    let stopScan = null;
    const branches = app.me.branches.filter((b) => b.active && b.id !== app.branchId);
    const { el: dialog, result } = modal({
      title: `Send stock from ${app.branch.name}`,
      size: "lg",
      body: html`<div class="stack">
        <div class="form-grid"><label class="field"><span>To branch</span><select class="input" data-to>${options(branches)}</select></label><label class="field"><span>Note</span><input class="input" data-note /></label></div>
        <div class="row">${scanField({ placeholder: "Scan item to add", id: "tr-scan" })}</div>
        <div data-items></div></div>`,
      actions: [{ label: "Cancel" }, { label: "Send transfer", kind: "primary", icon: "truck", onClick: () => send() }]
    });
    const draw = () =>
      mount(
        $("[data-items]", dialog),
        items.length
          ? html`<table class="table"><thead><tr><th>Product</th><th class="num">Available</th><th class="num" style="width:120px">Send</th><th></th></tr></thead><tbody>${items.map(
              (i, idx) => html`<tr><td>${i.name}</td><td class="num">${qty(i.available, i.unit)}</td><td><input class="input sm num" type="number" min="0.001" step="any" data-q="${idx}" value="${i.qty}" /></td><td><button class="btn ghost icon sm" data-rm="${idx}" aria-label="Remove">${icon("x", 14)}</button></td></tr>`
            )}</tbody></table>`
          : html`<p class="faint">Scan items to send. Unexpired stock that expires soonest is sent first.</p>`
      );
    const add = async (code) => {
      try {
        const hit = await get(`/api/lookup?code=${encodeURIComponent(code)}`);
        const p = hit.product;
        const existing = items.find((i) => i.product_id === p.id);
        if (existing) existing.qty += hit.qty;
        else items.push({ product_id: p.id, name: p.name, unit: p.unit, available: Math.max(0, p.stock_qty - p.expired_qty), qty: hit.qty });
        beep(true);
        draw();
      } catch (err) {
        beep(false);
        showError(err);
      }
    };
    const input = $("#tr-scan", dialog);
    input.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      if (input.value.trim()) add(input.value.trim());
      input.value = "";
    });
    dialog.addEventListener("change", (e) => {
      const q = e.target.closest("[data-q]");
      if (q) items[Number(q.dataset.q)].qty = Number(q.value);
    });
    dialog.addEventListener("click", (e) => {
      const rm = e.target.closest("[data-rm]");
      if (rm) {
        items.splice(Number(rm.dataset.rm), 1);
        draw();
      }
    });
    stopScan = onScan(add);
    async function send() {
      if (!items.length) {
        toast("Add items first");
        return false;
      }
      try {
        await post("/api/transfers", { to_branch_id: Number($("[data-to]", dialog).value), note: $("[data-note]", dialog).value, items: items.map((i) => ({ product_id: i.product_id, qty: i.qty })) });
        toast("Transfer sent", "success");
        return true;
      } catch (err) {
        showError(err);
        return false;
      }
    }
    draw();
    input.focus();
    const sent = await result;
    stopScan?.();
    if (sent) load();
  }

  await load();
}
