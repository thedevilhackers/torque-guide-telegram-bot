import { get, post } from "../api.js";
import { askAfterDelivery, openDateLabels } from "../date-labels.js";
import { editProduct, lookups } from "../product-form.js";
import { onScan, openCamera, scanField } from "../scanner.js";
import { $, addDays, beep, confirmDialog, dateTime, dayLabel, html, icon, modal, money, mount, on, options, qty, showError, toMajor, toMinor, toast } from "../ui.js";

export default async function receivePage(el, app) {
  const draftKey = `pos.receive.${app.branchId}`;
  let draft = load();
  let seq = draft.lines.reduce((m, l) => Math.max(m, l.key), 0);
  const { suppliers } = await lookups();

  function load() {
    try {
      const d = JSON.parse(localStorage.getItem(draftKey) || "null");
      if (d?.lines) return d;
    } catch {
      /* ignore */
    }
    return { supplier_id: "", invoice_no: "", note: "", lines: [] };
  }
  function save() {
    try {
      localStorage.setItem(draftKey, JSON.stringify(draft));
    } catch {
      /* ignore */
    }
  }

  mount(
    el,
    html`
      <div class="page-head">
        <div><h1>Receive stock</h1><p>Scan each item from the delivery, enter its expiry date and quantity, then post the receipt. Items with a GS1 2D code (DataMatrix/QR) or GS1-128 label fill in their expiry and batch by themselves.</p></div>
        <div class="row"><button class="btn" data-act="history">${icon("receipt", 16)} Recent receipts</button></div>
      </div>
      <div class="grid" style="grid-template-columns:minmax(0,1fr) 320px;align-items:start" data-layout>
        <div class="stack">
          <div class="card scanbar">${scanField({ placeholder: "Scan item barcode or type code / name", id: "rcv-scan" })}</div>
          <div class="card">
            <div class="card-head"><h2>Items</h2><span class="badge" data-count></span></div>
            <div class="table-wrap" data-lines></div>
          </div>
        </div>
        <div class="card card-pad stack" style="position:sticky;top:16px">
          <h3>Delivery details</h3>
          <label class="field"><span>Supplier</span><select class="input" data-field="supplier_id">${options(suppliers.filter((s) => s.active), draft.supplier_id, { empty: "— None —" })}</select></label>
          <label class="field"><span>Supplier invoice no.</span><input class="input" data-field="invoice_no" value="${draft.invoice_no}" /></label>
          <label class="field"><span>Note</span><input class="input" data-field="note" value="${draft.note}" /></label>
          <div class="totals" style="padding:0" data-summary></div>
          <button class="btn primary lg" data-act="post">${icon("check", 18)} Post receipt</button>
          <button class="btn ghost sm" data-act="clear">Clear list</button>
        </div>
      </div>`
  );
  if (window.matchMedia("(max-width: 920px)").matches) $("[data-layout]", el).style.gridTemplateColumns = "1fr";
  const input = $("#rcv-scan", el);

  function render(focusKey) {
    save();
    const linesEl = $("[data-lines]", el);
    $("[data-count]", el).textContent = `${draft.lines.length} line${draft.lines.length === 1 ? "" : "s"}`;
    if (!draft.lines.length) {
      mount(linesEl, html`<div class="empty">${icon("truck", 40)}<div>Scan the first item of the delivery.</div></div>`);
    } else {
      mount(
        linesEl,
        html`<table class="table">
          <thead><tr><th>Product</th><th class="num" style="width:90px">Qty</th><th style="width:168px">Expiry</th><th style="width:110px">Batch / lot</th><th class="num" style="width:100px">Unit cost</th><th class="num" style="width:100px">Sell price</th><th></th></tr></thead>
          <tbody>${draft.lines.map(
            (l) => html`<tr data-key="${l.key}">
              <td><div style="font-weight:600">${l.name}</div><div class="sub">${l.barcode ?? l.sku} · in stock ${qty(l.stock_qty, l.unit)}</div>
                ${l.track_expiry && !l.expiry_date ? html`<span class="badge warn">${icon("calendar", 12)} Add expiry</span>` : ""}</td>
              <td><input class="input sm num" data-f="qty" type="number" min="0.001" step="any" value="${l.qty}" /></td>
              <td><input class="input sm" data-f="expiry_date" type="date" min="${app.today}" value="${l.expiry_date ?? ""}" ${l.track_expiry ? "" : "disabled"} title="${l.track_expiry ? "" : "Expiry not tracked for this product"}" />
                ${l.track_expiry && l.expiry_from_code && l.expiry_date
                  ? html`<div style="margin-top:4px"><span class="badge good" title="Read from the item's barcode">${icon("barcode", 12)} From barcode</span></div>`
                  : l.track_expiry
                    ? html`<div class="row" style="margin-top:4px;gap:2px;flex-wrap:nowrap">${[7, 30, 90, 180].map((d) => html`<button class="btn ghost sm" style="min-height:22px;padding:0 5px;font-size:11.5px" data-plus="${d}" title="Expires in ${d} days">+${d < 30 ? `${d}d` : `${d / 30}m`}</button>`)}</div>`
                    : ""}</td>
              <td><input class="input sm" data-f="batch_no" value="${l.batch_no ?? ""}" /></td>
              <td><input class="input sm num" data-f="cost" inputmode="decimal" value="${toMajor(l.cost)}" /></td>
              <td><input class="input sm num" data-f="sell_price" inputmode="decimal" value="${toMajor(l.sell_price ?? l.price)}" title="Change to update the selling price" /></td>
              <td><button class="btn ghost icon sm" data-act="remove" aria-label="Remove">${icon("x", 16)}</button></td>
            </tr>`
          )}</tbody></table>`
      );
      if (focusKey) {
        const row = linesEl.querySelector(`[data-key="${focusKey}"]`);
        row?.scrollIntoView({ block: "nearest" });
        const target = row?.querySelector('[data-f="expiry_date"]:not([disabled])') ?? row?.querySelector('[data-f="qty"]');
        if (target && !target.value) target.focus();
      }
    }
    const units = draft.lines.reduce((s, l) => s + Number(l.qty || 0), 0);
    const cost = draft.lines.reduce((s, l) => s + Math.round((l.cost || 0) * Number(l.qty || 0)), 0);
    const missing = draft.lines.filter((l) => l.track_expiry && !l.expiry_date).length;
    mount(
      $("[data-summary]", el),
      html`<div class="line"><span>Lines</span><span>${draft.lines.length}</span></div>
        <div class="line"><span>Units</span><span>${qty(units)}</span></div>
        <div class="grand"><span style="font-weight:650">Cost value</span><strong style="font-size:24px">${money(cost)}</strong></div>
        ${missing ? html`<div class="badge warn" style="justify-self:start">${icon("calendar", 12)} ${missing} without expiry date</div>` : ""}`
    );
  }

  /** pack: what the item's GS1 code says about it ({ pack_expiry, batch, serial }), if anything. */
  function addLine(product, addQty = 1, pack = null) {
    const expiry = product.track_expiry && pack?.pack_expiry ? pack.pack_expiry : null;
    const batch = pack?.batch ?? "";
    if (expiry && expiry < app.today) {
      beep(false);
      toast(`${product.name}: this pack expired on ${dayLabel(expiry)}. Don't accept it from the supplier.`, "error", 6000);
      return;
    }
    if (pack?.serial && draft.lines.some((l) => l.product_id === product.id && l.serials?.includes(pack.serial))) {
      beep(false);
      toast(`Already scanned: ${product.name}, serial ${pack.serial}`, "warn");
      return;
    }
    // Same product from the same batch/expiry goes on one line; a different batch gets its own line.
    const existing = draft.lines.find((l) => l.product_id === product.id && (l.expiry_date ?? null) === expiry && (l.batch_no ?? "") === batch);
    if (existing) {
      existing.qty = Math.round((Number(existing.qty) + addQty) * 1000) / 1000;
      if (pack?.serial) (existing.serials ??= []).push(pack.serial);
      beep(true);
      render(existing.key);
      return;
    }
    const line = {
      key: ++seq,
      product_id: product.id,
      name: product.name,
      sku: product.sku,
      barcode: product.barcode,
      unit: product.unit,
      stock_qty: product.stock_qty,
      track_expiry: product.track_expiry,
      qty: addQty,
      cost: product.cost,
      price: product.effective_price,
      sell_price: null,
      expiry_date: expiry,
      expiry_from_code: Boolean(expiry),
      batch_no: batch,
      serials: pack?.serial ? [pack.serial] : []
    };
    draft.lines.push(line);
    beep(true);
    render(line.key);
  }

  async function handleCode(code) {
    try {
      const hit = await get(`/api/lookup?code=${encodeURIComponent(code)}`);
      // Case codes, carton labels and weight labels say how much they hold; other scans count one.
      addLine(hit.product, ["barcode", "plu", "sku"].includes(hit.source) ? 1 : hit.qty, hit.gs1);
      if (hit.source === "case") toast(`Case barcode: added ${hit.qty} × ${hit.product.name}`, "success");
    } catch (err) {
      if (err.code !== "UNKNOWN_BARCODE") return showError(err);
      const pack = err.details?.gs1 ?? null;
      if (!pack && !/^\d{6,}$/.test(code)) {
        const { items } = await get(`/api/products?search=${encodeURIComponent(code)}&limit=8&status=all`);
        if (items.length === 1) return addLine(items[0]);
        if (items.length) return choose(items);
      }
      beep(false);
      if (pack && !err.details.code) return toast("This is a shipping label with no product number. Scan the barcode on the item itself.", "error", 6000);
      const barcode = err.details?.code ?? code;
      if (!app.can("catalog.edit")) return toast(`Barcode ${barcode} is not in the catalogue. Ask a manager to add it.`, "error", 5000);
      const saved = await editProduct(app, null, { barcode: /^[A-Za-z0-9._\-/]+$/.test(barcode) ? barcode : "" });
      if (saved) addLine(saved, pack?.count ?? 1, pack);
    }
  }

  async function choose(items) {
    const { result } = modal({
      title: "Choose product",
      body: html`<ul class="list-plain">${items.map((p, i) => html`<li><div><strong>${p.name}</strong><div class="small muted">${p.barcode ?? p.sku}</div></div><button class="btn sm primary" data-pick="${i}">Add</button></li>`)}</ul>`,
      actions: [{ label: "Cancel" }],
      onMount(dialog, close) {
        dialog.addEventListener("click", (e) => {
          const b = e.target.closest("[data-pick]");
          if (b) close(items[Number(b.dataset.pick)]);
        });
      }
    });
    const p = await result;
    if (p) addLine(p);
  }

  input.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const v = input.value.trim();
    input.value = "";
    if (v) handleCode(v);
  });
  const stop = onScan(handleCode);

  on(el, "change", "[data-field]", (e, f) => {
    draft[f.dataset.field] = f.value;
    save();
  });
  on(el, "change", "[data-f]", (e, f) => {
    const line = draft.lines.find((l) => l.key === Number(f.closest("[data-key]").dataset.key));
    const key = f.dataset.f;
    if (key === "cost" || key === "sell_price") {
      const v = toMinor(f.value);
      line[key] = Number.isFinite(v) ? v : key === "cost" ? 0 : null;
    } else line[key] = key === "qty" ? Number(f.value) : f.value || null;
    if (key === "expiry_date") line.expiry_from_code = false;
    render();
  });
  on(el, "click", "[data-plus]", (e, b) => {
    const line = draft.lines.find((l) => l.key === Number(b.closest("[data-key]").dataset.key));
    line.expiry_date = addDays(app.today, Number(b.dataset.plus));
    render();
  });
  on(el, "click", "[data-camera]", () => openCamera({ continuous: true, title: "Scan delivery items" }));
  on(el, "click", "[data-act]", async (e, b) => {
    const act = b.dataset.act;
    if (act === "remove") {
      const key = Number(b.closest("[data-key]").dataset.key);
      draft.lines = draft.lines.filter((l) => l.key !== key);
      render();
    }
    if (act === "clear" && draft.lines.length && (await confirmDialog("Remove all items from this delivery?", { ok: "Clear", danger: true }))) {
      draft.lines = [];
      render();
    }
    if (act === "post") postReceipt();
    if (act === "history") history();
  });

  async function postReceipt() {
    if (!draft.lines.length) return toast("Scan items first");
    const missing = draft.lines.filter((l) => l.track_expiry && !l.expiry_date);
    if (missing.length && !(await confirmDialog(`${missing.length} item(s) have no expiry date. Expiry alerts won't work for them. Post anyway?`, { title: "Missing expiry dates", ok: "Post anyway" }))) return;
    try {
      const receipt = await post("/api/stock/receive", {
        supplier_id: draft.supplier_id || null,
        invoice_no: draft.invoice_no,
        note: draft.note,
        items: draft.lines.map((l) => ({
          product_id: l.product_id,
          qty: Number(l.qty),
          cost: l.cost,
          expiry_date: l.expiry_date || null,
          batch_no: l.batch_no || "",
          sell_price: l.sell_price !== null && l.sell_price !== l.price ? l.sell_price : undefined
        }))
      });
      const posted = draft.lines.map((l) => ({ product_id: l.product_id, expiry_date: l.expiry_date, batch_no: l.batch_no, qty: l.qty, from_code: l.expiry_from_code }));
      draft = { supplier_id: draft.supplier_id, invoice_no: "", note: "", lines: [] };
      $("[data-field=invoice_no]", el).value = "";
      $("[data-field=note]", el).value = "";
      render();
      toast(`Receipt #${receipt.id} posted: ${receipt.items.length} lines, ${money(receipt.total_cost)}`, "success", 5000);
      // Offer expiry-date labels for dated items whose own barcode doesn't carry the date.
      if (askAfterDelivery() && posted.some((l) => l.expiry_date && !l.from_code)) {
        await openDateLabels(app, posted, { title: `Receipt #${receipt.id} posted. Print date labels?`, afterDelivery: true });
        input.focus();
      }
    } catch (err) {
      showError(err);
    }
  }

  async function history() {
    const receipts = await get("/api/stock/receipts?limit=30");
    const { el: dialog } = modal({
      title: "Recent receipts",
      size: "lg",
      body: receipts.length
        ? html`<table class="table"><thead><tr><th>#</th><th>Date</th><th>Supplier</th><th>Invoice</th><th class="num">Lines</th><th class="num">Cost</th><th>By</th></tr></thead><tbody>${receipts.map(
            (r) => html`<tr class="clickable" data-receipt="${r.id}"><td>${r.id}</td><td>${dateTime(r.created_at)}</td><td>${r.supplier_name ?? "—"}</td><td>${r.invoice_no}</td><td class="num">${r.line_count}</td><td class="num">${money(r.total_cost)}</td><td>${r.user_name ?? ""}</td></tr>`
          )}</tbody></table>`
        : html`<div class="empty">No receipts yet.</div>`,
      actions: [{ label: "Close" }]
    });
    dialog.addEventListener("click", async (e) => {
      const row = e.target.closest("[data-receipt]");
      if (!row) return;
      const r = await get(`/api/stock/receipts/${row.dataset.receipt}`);
      modal({
        title: `Receipt #${r.id}`,
        size: "lg",
        body: html`<p class="muted">${dateTime(r.created_at)} · ${r.supplier_name ?? "No supplier"} ${r.invoice_no ? `· invoice ${r.invoice_no}` : ""} · ${r.user_name ?? ""}</p>
          <table class="table" style="margin-top:10px"><thead><tr><th>Product</th><th class="num">Qty</th><th>Expiry</th><th>Batch</th><th class="num">Cost</th></tr></thead><tbody>${r.items.map(
            (i) => html`<tr><td>${i.name}</td><td class="num">${qty(i.qty, i.unit)}</td><td>${i.expiry_date ?? "—"}</td><td>${i.batch_no}</td><td class="num">${money(i.cost)}</td></tr>`
          )}</tbody></table>`,
        actions: [
          ...(r.items.some((i) => i.expiry_date)
            ? [{ label: "Print date labels", icon: "printer", onClick: () => openDateLabels(app, r.items, { title: `Date labels · receipt #${r.id}` }).catch(showError) }]
            : []),
          { label: "Close", kind: "primary" }
        ]
      });
    });
  }

  render();
  input.focus();
  return stop;
}
