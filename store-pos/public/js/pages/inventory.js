import { download, get, post, put, qs } from "../api.js";
import { barcodeSvg } from "../barcode.js";
import { editProduct, lookups } from "../product-form.js";
import { printLabels } from "../print.js";
import { onScan } from "../scanner.js";
import {
  $,
  $$,
  confirmDialog,
  dateTime,
  debounce,
  expiryBadge,
  html,
  icon,
  modal,
  money,
  mount,
  on,
  options,
  qty,
  raw,
  readForm,
  showError,
  stockBadge,
  toMajor,
  toMinor,
  toast
} from "../ui.js";

const FILTERS = [
  ["", "All"],
  ["low", "Low stock"],
  ["out", "Out of stock"],
  ["expiring", "Expiring soon"],
  ["expired", "Expired"],
  ["quick", "Quick keys"],
  ["inactive", "Inactive"]
];

const MOVEMENT_LABELS = {
  receive: "Received",
  sale: "Sold",
  refund: "Refund return",
  adjust: "Adjustment",
  write_off: "Write-off",
  count: "Stock count",
  transfer_out: "Transfer out",
  transfer_in: "Transfer in",
  transfer_cancel: "Transfer cancelled"
};

export default async function inventoryPage(el, app) {
  const { categories } = await lookups(true);
  const state = { search: "", category: "", filter: new URLSearchParams(location.hash.split("?")[1] ?? "").get("filter") ?? "", items: [], total: 0, selected: new Set() };

  mount(
    el,
    html`
      <div class="page-head">
        <div><h1>Inventory</h1><p>Stock on hand at ${app.branch?.name}, with batches and expiry dates.</p></div>
        <div class="row">
          ${app.can("reports.view") ? html`<button class="btn" data-act="export">${icon("download", 16)} Export CSV</button>` : ""}
          <button class="btn" data-act="labels">${icon("printer", 16)} Print labels <span class="badge" data-sel-count></span></button>
          ${app.can("catalog.edit") ? html`<button class="btn primary" data-act="new">${icon("plus", 16)} New product</button>` : ""}
        </div>
      </div>
      <div class="card">
        <div class="card-head" style="gap:10px">
          <div class="row grow">
            <div class="search grow" style="max-width:360px">${icon("search")}<input class="input" data-search placeholder="Search name, SKU or scan barcode" /></div>
            <select class="input" style="width:auto" data-category>${options(categories, "", { empty: "All categories" })}</select>
          </div>
          <div class="chips" data-chips>${FILTERS.map(([v, l]) => html`<button class="chip ${v === state.filter ? "active" : ""}" data-filter="${v}">${l}</button>`)}</div>
        </div>
        <div data-bulk></div>
        <div class="table-wrap" data-table></div>
        <div class="card-body row between" data-foot></div>
      </div>`
  );

  async function load(append = false) {
    const params = {
      search: state.search,
      category_id: state.category,
      filter: state.filter === "inactive" ? "" : state.filter,
      status: state.filter === "inactive" ? "inactive" : "active",
      limit: 100,
      offset: append ? state.items.length : 0
    };
    try {
      const res = await get(`/api/products${qs(params)}`);
      state.items = append ? [...state.items, ...res.items] : res.items;
      state.total = res.total;
      render();
    } catch (err) {
      showError(err);
    }
  }

  function render() {
    const rows = state.items;
    mount(
      $("[data-bulk]", el),
      state.filter === "expired" && rows.length && app.can("stock.adjust")
        ? html`<div class="banner danger" style="margin:0 16px 10px">${icon("alert")}<div class="grow"><strong>${rows.length} product(s) have expired stock on the shelf.</strong> Remove them from the shelf, then write them off so they stop counting as sellable.</div><button class="btn solid-danger sm" data-act="writeoff-all">Write off all expired</button></div>`
        : ""
    );
    mount(
      $("[data-table]", el),
      rows.length
        ? html`<table class="table">
            <thead><tr><th style="width:36px"><input type="checkbox" data-select-all aria-label="Select all" /></th><th>Product</th><th>Category</th><th class="num">Stock</th><th>Next expiry</th><th class="num">Price</th><th class="num">Cost</th><th class="num">Margin</th></tr></thead>
            <tbody>${rows.map((p) => {
              const net = app.settings.prices_include_tax ? p.effective_price / (1 + p.tax_rate / 100) : p.effective_price;
              const margin = net > 0 ? Math.round(((net - p.cost) / net) * 100) : null;
              return html`<tr class="clickable" data-id="${p.id}">
                <td data-stop><input type="checkbox" data-select="${p.id}" ${state.selected.has(p.id) ? "checked" : ""} aria-label="Select ${p.name}" /></td>
                <td><div style="font-weight:600">${p.name} ${p.min_age ? html`<span class="badge warn">${p.min_age}+</span>` : ""} ${p.quick_key ? html`<span class="badge">Quick key</span>` : ""}</div><div class="sub mono">${p.barcode ?? p.sku}${p.plu ? ` · PLU ${Number(p.plu)}` : ""}</div></td>
                <td>${p.category_name ?? html`<span class="faint">—</span>`}</td>
                <td class="num">${stockBadge(p)}${p.expired_qty > 0 ? html`<div class="sub" style="color:var(--danger)">${qty(p.expired_qty, p.unit)} expired</div>` : ""}</td>
                <td>${p.track_expiry ? expiryBadge(p.next_expiry, app.today) : html`<span class="faint small">Not tracked</span>`}</td>
                <td class="num">${money(p.effective_price)}${p.branch_price !== null && p.branch_price !== undefined ? html`<div class="sub">branch price</div>` : ""}</td>
                <td class="num">${money(p.cost)}</td>
                <td class="num">${margin === null ? "—" : `${margin}%`}</td>
              </tr>`;
            })}</tbody></table>`
        : html`<div class="empty">${icon("box", 40)}<div>${state.search || state.filter || state.category ? "No products match these filters." : "No products yet. Add one or receive a delivery."}</div></div>`
    );
    mount(
      $("[data-foot]", el),
      html`<span class="muted small">Showing ${rows.length} of ${state.total}</span>${rows.length < state.total ? html`<button class="btn sm" data-act="more">Load more</button>` : ""}`
    );
    $("[data-sel-count]", el).textContent = state.selected.size || "";
  }

  const searchNow = debounce(() => load(), 250);
  $("[data-search]", el).addEventListener("input", (e) => {
    state.search = e.target.value.trim();
    searchNow();
  });
  $("[data-category]", el).addEventListener("change", (e) => {
    state.category = e.target.value;
    load();
  });
  on(el, "click", "[data-filter]", (e, b) => {
    state.filter = b.dataset.filter;
    $$("[data-filter]", el).forEach((c) => c.classList.toggle("active", c === b));
    load();
  });
  on(el, "change", "[data-select]", (e, cb) => {
    const id = Number(cb.dataset.select);
    if (cb.checked) state.selected.add(id);
    else state.selected.delete(id);
    $("[data-sel-count]", el).textContent = state.selected.size || "";
  });
  on(el, "change", "[data-select-all]", (e, cb) => {
    for (const p of state.items) cb.checked ? state.selected.add(p.id) : state.selected.delete(p.id);
    render();
  });
  on(el, "click", "tr[data-id]", (e, row) => {
    if (e.target.closest("[data-stop]")) return;
    openProduct(app, Number(row.dataset.id), () => load());
  });
  on(el, "click", "[data-act]", async (e, b) => {
    const act = b.dataset.act;
    if (act === "more") load(true);
    if (act === "new") {
      const saved = await editProduct(app);
      if (saved) {
        load();
        openProduct(app, saved.id, () => load());
      }
    }
    if (act === "export") download(`/api/reports/export/stock.csv`, `stock_${app.branch.code}_${app.today}.csv`).catch(showError);
    if (act === "labels") labelsDialog(app, state.items.filter((p) => state.selected.has(p.id)));
    if (act === "writeoff-all") {
      if (!(await confirmDialog("Write off every expired batch at this branch? Stock and value are removed and logged as expired.", { title: "Write off expired stock", ok: "Write off", danger: true }))) return;
      const res = await post("/api/stock/write-off-expired", {});
      toast(`Wrote off ${qty(res.qty)} units from ${res.batches} batches (${money(res.value)})`, "success", 5000);
      load();
    }
  });

  // Scanning on this page opens that product.
  const stop = onScan(async (code) => {
    try {
      const hit = await get(`/api/lookup?code=${encodeURIComponent(code)}`);
      openProduct(app, hit.product.id, () => load());
    } catch (err) {
      if (err.code === "UNKNOWN_BARCODE" && app.can("catalog.edit") && (await confirmDialog(`Barcode ${code} is not in the catalogue. Create a product for it?`, { title: "Unknown barcode", ok: "Create product" }))) {
        const saved = await editProduct(app, null, { barcode: code });
        if (saved) load();
      } else showError(err);
    }
  });

  load();
  return stop;
}

// ---- product drawer ----------------------------------------------------------------------

export async function openProduct(app, id, onChange = () => {}) {
  let product = await get(`/api/products/${id}`);
  let tab = "batches";
  let movements = null;
  const { el: dialog, close } = modal({ title: product.name, drawer: true, body: "<div data-drawer></div>" });
  const box = $("[data-drawer]", dialog);

  async function refresh() {
    product = await get(`/api/products/${id}`);
    movements = null;
    draw();
    onChange();
  }

  async function draw() {
    const p = product;
    $(".modal-head h2", dialog).textContent = p.name;
    const net = app.settings.prices_include_tax ? p.effective_price / (1 + p.tax_rate / 100) : p.effective_price;
    if (tab === "movements" && !movements) movements = await get(`/api/stock/movements?product_id=${id}&limit=60`);
    mount(
      box,
      html`<div class="stack lg">
        <div class="row">
          ${p.active && p.branch_active ? html`<span class="badge good">For sale</span>` : html`<span class="badge bad">Not for sale</span>`}
          ${p.category_name ? html`<span class="badge">${p.category_name}</span>` : ""}
          ${p.min_age ? html`<span class="badge warn">${p.min_age}+ ID check</span>` : ""}
          ${p.promotions.map((pr) => html`<span class="badge brand">${icon("tag", 12)} ${pr.name}</span>`)}
        </div>
        <div class="grid cols-3">
          <div class="card kpi"><div class="label">Selling price</div><div class="value">${money(p.effective_price)}</div><div class="sub">${p.branch_price !== null && p.branch_price !== undefined ? `Branch price · chain ${money(p.price)}` : `Tax ${p.tax_rate}%`}</div></div>
          <div class="card kpi"><div class="label">In stock here</div><div class="value">${p.track_stock ? qty(p.stock_qty, p.unit) : "—"}</div><div class="sub">${p.track_stock ? `Reorder at ${qty(p.effective_reorder_level, p.unit)}` : "Stock not tracked"}</div></div>
          <div class="card kpi"><div class="label">Cost · margin</div><div class="value">${money(p.cost)}</div><div class="sub">${net > 0 ? `${Math.round(((net - p.cost) / net) * 100)}% margin` : ""}</div></div>
        </div>
        <div class="row">
          ${app.can("catalog.edit") ? html`<button class="btn" data-d="edit">${icon("edit", 16)} Edit</button>` : ""}
          ${app.can("stock.adjust") && p.track_stock ? html`<button class="btn" data-d="adjust">${icon("box", 16)} Adjust stock</button>` : ""}
          ${app.can("stock.adjust") && p.expired_qty > 0 ? html`<button class="btn danger" data-d="writeoff">${icon("trash", 16)} Write off expired (${qty(p.expired_qty, p.unit)})</button>` : ""}
          <button class="btn" data-d="label">${icon("printer", 16)} Label</button>
          ${!p.barcode && app.can("catalog.edit") ? html`<button class="btn" data-d="gen">${icon("barcode", 16)} Generate barcode</button>` : ""}
          ${app.can("catalog.edit") && app.me.user.role === "owner" ? html`<button class="btn" data-d="branch-price">${icon("store", 16)} Branch price</button>` : ""}
        </div>
        ${p.barcodes.length
          ? html`<div class="row" style="gap:16px">${p.barcodes.map((b) => html`<div style="background:#fff;padding:6px 8px;border-radius:6px;border:1px solid var(--border)">${raw(barcodeSvg(b.code, { height: 34, module: 1.4 }))}${b.pack_qty !== 1 ? html`<div class="small" style="color:#333;text-align:center">case of ${b.pack_qty}</div>` : ""}</div>`)}</div>`
          : ""}
        <dl class="kv">
          <dt>SKU</dt><dd class="mono">${p.sku}</dd>
          ${p.plu ? html`<dt>PLU</dt><dd class="mono">${Number(p.plu)}</dd>` : ""}
          <dt>Supplier</dt><dd>${p.supplier_name ?? "—"}</dd>
          <dt>Unit</dt><dd>${p.unit}${p.sold_by_weight ? " · sold by weight" : ""}</dd>
          <dt>Expiry</dt><dd>${p.track_expiry ? `Tracked · warn ${p.expiry_warn_days} days before` : "Not tracked"}</dd>
          ${p.external_id ? html`<dt>External ID</dt><dd class="mono">${p.external_id}</dd>` : ""}
        </dl>
        <div>
          <div class="tabs">${[["batches", "Batches & expiry"], ["movements", "Stock history"], ["branches", "All branches"]].map(([k, l]) => html`<button class="${tab === k ? "active" : ""}" data-tab="${k}">${l}</button>`)}</div>
          ${tab === "batches" ? batchesTable(p, app) : ""}
          ${tab === "movements" ? movementsTable(movements, p) : ""}
          ${tab === "branches" ? branchesTable(p) : ""}
        </div>
      </div>`
    );
  }

  dialog.addEventListener("click", async (e) => {
    const t = e.target.closest("[data-tab]");
    if (t) {
      tab = t.dataset.tab;
      draw();
      return;
    }
    const d = e.target.closest("[data-d]")?.dataset.d;
    if (!d) return;
    try {
      if (d === "edit") {
        const saved = await editProduct(app, product);
        if (saved) refresh();
      }
      if (d === "adjust" && (await adjustDialog(app, product))) refresh();
      if (d === "writeoff") {
        if (!(await confirmDialog(`Write off ${qty(product.expired_qty, product.unit)} of expired ${product.name}?`, { title: "Write off expired", ok: "Write off", danger: true }))) return;
        const res = await post("/api/stock/write-off-expired", { product_id: product.id });
        toast(`Wrote off ${qty(res.qty, product.unit)} (${money(res.value)})`, "success");
        refresh();
      }
      if (d === "label") labelsDialog(app, [product]);
      if (d === "gen") {
        const res = await post(`/api/products/${product.id}/barcode`);
        toast(`Barcode ${res.code} assigned`, "success");
        refresh();
      }
      if (d === "branch-price" && (await branchPriceDialog(app, product))) refresh();
    } catch (err) {
      showError(err);
    }
  });
  draw();
  return close;
}

function batchesTable(p, app) {
  if (!p.batches.length) return html`<div class="empty small">No batches in stock${p.track_stock && p.stock_qty < 0 ? ` (oversold by ${qty(-p.stock_qty, p.unit)} — receive stock to fix)` : ""}.</div>`;
  return html`<table class="table"><thead><tr><th>Expiry</th><th>Batch</th><th class="num">Left</th><th class="num">Received</th><th class="num">Cost</th><th>Received on</th></tr></thead><tbody>${p.batches.map(
    (b) => html`<tr><td>${expiryBadge(b.expiry_date, app.today)}</td><td class="mono small">${b.batch_no || "—"}</td><td class="num">${qty(b.qty_remaining, p.unit)}</td><td class="num faint">${qty(b.qty_received, p.unit)}</td><td class="num">${money(b.cost)}</td><td class="small">${dateTime(b.received_at)}<div class="sub">${b.source}</div></td></tr>`
  )}</tbody></table><p class="small faint" style="margin-top:8px">Sales use the batch that expires first (FEFO), so older stock leaves the shelf first.</p>`;
}

function movementsTable(rows, p) {
  if (!rows?.length) return html`<div class="empty small">No stock movements yet.</div>`;
  return html`<table class="table"><thead><tr><th>When</th><th>What</th><th class="num">Qty</th><th>By</th></tr></thead><tbody>${rows.map(
    (m) => html`<tr><td class="small nowrap">${dateTime(m.created_at)}</td><td>${MOVEMENT_LABELS[m.type] ?? m.type}${m.reason ? html`<div class="sub">${m.reason}</div>` : ""}${m.expiry_date ? html`<div class="sub">batch exp ${m.expiry_date}</div>` : ""}</td><td class="num" style="color:${m.qty < 0 ? "var(--danger)" : "var(--success)"}">${m.qty > 0 ? "+" : ""}${qty(m.qty, p.unit)}</td><td class="small">${m.user_name ?? ""}</td></tr>`
  )}</tbody></table>`;
}

function branchesTable(p) {
  return html`<table class="table"><thead><tr><th>Branch</th><th class="num">Stock</th><th class="num">Price</th><th>Status</th></tr></thead><tbody>${p.branch_stock.map(
    (b) => html`<tr><td>${b.name} <span class="faint small">${b.code}</span></td><td class="num">${qty(b.qty, p.unit)}</td><td class="num">${money(b.branch_price ?? p.price)}${b.branch_price !== null && b.branch_price !== undefined ? html`<div class="sub">override</div>` : ""}</td><td>${b.active ? html`<span class="badge good">Selling</span>` : html`<span class="badge bad">Disabled</span>`}</td></tr>`
  )}</tbody></table>`;
}

async function adjustDialog(app, p) {
  const reasons = app.me.adjust_reasons;
  const { result } = modal({
    title: `Adjust stock: ${p.name}`,
    body: html`<form class="form-grid">
      <div class="field full"><span>Change</span><div class="seg"><label class="check" style="padding:8px 12px"><input type="radio" name="dir" value="remove" checked /> Remove stock</label><label class="check" style="padding:8px 12px"><input type="radio" name="dir" value="add" /> Add stock</label></div></div>
      <label class="field"><span>Quantity (${p.unit})</span><input class="input num" name="qty" type="number" min="0.001" step="any" required autofocus /></label>
      <label class="field"><span>Reason</span><select class="input" name="reason">${reasons.map((r) => html`<option value="${r}">${r.replace(/_/g, " ")}</option>`)}</select></label>
      <label class="field" data-remove-only><span>From batch <small>(optional)</small></span><select class="input" name="batch_id"><option value="">Oldest first</option>${p.batches.map((b) => html`<option value="${b.id}">${b.expiry_date ?? "no expiry"} · ${b.batch_no || "—"} · ${qty(b.qty_remaining, p.unit)}</option>`)}</select></label>
      <label class="field hidden" data-add-only><span>Expiry date</span><input class="input" name="expiry_date" type="date" /></label>
      <label class="field full"><span>Note</span><input class="input" name="note" placeholder="What happened?" /></label>
      <p class="full small muted">Current stock: ${qty(p.stock_qty, p.unit)}. Every adjustment is logged with your name.</p>
    </form>`,
    actions: [{ label: "Cancel" }, { label: "Save adjustment", kind: "primary", submit: true }],
    onMount(dialog) {
      dialog.addEventListener("change", (e) => {
        if (e.target.name !== "dir") return;
        const add = e.target.value === "add";
        $("[data-add-only]", dialog).classList.toggle("hidden", !add);
        $("[data-remove-only]", dialog).classList.toggle("hidden", add);
        dialog.querySelector("[name=reason]").value = add ? "found" : "damaged";
      });
      dialog.querySelector("[name=reason]").value = "damaged";
    },
    async onSubmit(form) {
      const d = readForm(form);
      const amount = Number(d.qty);
      const res = await post("/api/stock/adjust", {
        product_id: p.id,
        qty: d.dir === "add" ? amount : -amount,
        reason: d.reason,
        note: d.note,
        batch_id: d.dir === "remove" && d.batch_id ? Number(d.batch_id) : undefined,
        expiry_date: d.dir === "add" && d.expiry_date ? d.expiry_date : undefined
      });
      toast(`Stock is now ${qty(res.stock_qty, p.unit)}`, "success");
      return res;
    }
  });
  return result;
}

async function branchPriceDialog(app, p) {
  const { result } = modal({
    title: `Branch prices: ${p.name}`,
    body: html`<form class="stack"><p class="muted">Chain price is ${money(p.price)}. Leave a branch empty to use the chain price.</p>
      <table class="table"><thead><tr><th>Branch</th><th class="num">Price override</th><th>Selling</th></tr></thead><tbody>${p.branch_stock.map(
        (b) => html`<tr><td>${b.name}</td><td><input class="input sm num" data-branch-price="${b.branch_id}" inputmode="decimal" value="${b.branch_price === null || b.branch_price === undefined ? "" : toMajor(b.branch_price)}" placeholder="${toMajor(p.price)}" /></td><td><input type="checkbox" data-branch-active="${b.branch_id}" ${b.active ? "checked" : ""} aria-label="Sell at ${b.name}" /></td></tr>`
      )}</tbody></table></form>`,
    actions: [{ label: "Cancel" }, { label: "Save", kind: "primary", submit: true }],
    async onSubmit(form) {
      for (const b of p.branch_stock) {
        const input = form.querySelector(`[data-branch-price="${b.branch_id}"]`);
        const price = input.value.trim() === "" ? null : toMinor(input.value);
        const active = form.querySelector(`[data-branch-active="${b.branch_id}"]`).checked;
        await put(`/api/products/${p.id}/branch`, { branch_id: b.branch_id, price, active });
      }
      toast("Branch prices saved", "success");
      return true;
    }
  });
  return result;
}

export function labelsDialog(app, products) {
  if (!products.length) return toast("Select products first (tick the boxes)");
  modal({
    title: `Print labels (${products.length} product${products.length === 1 ? "" : "s"})`,
    size: "sm",
    body: html`<form class="stack">
      <label class="field"><span>Layout</span><select class="input" name="layout"><option value="a4">A4 sheet (3 across)</option><option value="roll">Label printer roll (50 × 30 mm)</option></select></label>
      <label class="field"><span>Copies of each</span><input class="input num" name="copies" type="number" min="1" max="100" value="1" /></label>
      <p class="small muted">Products without a barcode print their SKU. Use "Generate barcode" on a product to give it a scannable in-store code.</p></form>`,
    actions: [{ label: "Cancel" }, { label: "Print", kind: "primary", icon: "printer", submit: true }],
    onSubmit(form) {
      printLabels(products, { layout: form.layout.value, copies: Math.max(1, Number(form.copies.value) || 1), storeName: app.settings.store_name });
      return true;
    }
  });
}
