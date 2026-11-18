import { get, patch, post } from "./api.js";
import { openCamera } from "./scanner.js";
import { $, $$, html, icon, modal, options, readForm, toMajor, toast } from "./ui.js";

let cache = { categories: null, suppliers: null };
export async function lookups(force = false) {
  if (force || !cache.categories) {
    const [categories, suppliers] = await Promise.all([get("/api/categories"), get("/api/suppliers")]);
    cache = { categories, suppliers };
  }
  return cache;
}
export const invalidateLookups = () => (cache = { categories: null, suppliers: null });

function barcodeRow(b = { code: "", pack_qty: 1 }) {
  return html`<div class="row" data-barcode-row>
    <input class="input grow mono" data-code value="${b.code}" placeholder="Barcode" autocomplete="off" />
    <label class="row tight small muted" title="Units per scan, e.g. 24 for a case barcode">×<input class="input sm num" style="width:70px" data-pack type="number" min="0.001" step="any" value="${b.pack_qty}" /></label>
    <button type="button" class="btn ghost icon sm" data-remove-barcode aria-label="Remove barcode">${icon("x", 16)}</button>
  </div>`;
}

/**
 * Opens the product editor. Resolves to the saved product, or undefined if cancelled.
 * prefill: { barcode } for a new product created from an unknown scan.
 */
export async function editProduct(app, product = null, prefill = {}) {
  const { categories, suppliers } = await lookups();
  const p = product ?? {
    name: "",
    unit: "pcs",
    tax_rate: 0,
    track_stock: true,
    track_expiry: true,
    expiry_warn_days: app.settings.default_expiry_warn_days,
    active: true,
    barcodes: prefill.barcode ? [{ code: prefill.barcode, pack_qty: 1 }] : []
  };
  const isBranchManager = Boolean(app.me.user.branch_id);
  const priceValue = product ? (isBranchManager ? product.effective_price : product.price) : null;
  const body = html`
    <form class="stack lg" data-product-form>
      <div class="form-grid">
        <label class="field full"><span>Product name</span><input class="input" name="name" required value="${p.name}" maxlength="160" /></label>
        <label class="field"><span>Selling price${isBranchManager ? " (this branch)" : ""}</span><input class="input num" name="price" data-type="money" inputmode="decimal" required value="${priceValue === null || priceValue === undefined ? "" : toMajor(priceValue)}" /></label>
        <label class="field"><span>Cost price</span><input class="input num" name="cost" data-type="money" inputmode="decimal" value="${p.cost === undefined ? "" : toMajor(p.cost)}" /></label>
        <label class="field"><span>Category</span>
          <input class="input" name="category" list="category-list" value="${p.category_name ?? ""}" placeholder="Type or choose" />
          <datalist id="category-list">${categories.map((c) => html`<option value="${c.name}"></option>`)}</datalist>
        </label>
        <label class="field"><span>Tax rate %</span><input class="input num" name="tax_rate" data-type="num" type="number" min="0" max="100" step="0.01" value="${p.tax_rate ?? 0}" /></label>
      </div>
      <div class="stack">
        <div class="row between"><span class="field"><span>Barcodes</span></span>
          <div class="row tight">
            <button type="button" class="btn sm" data-add-barcode>${icon("plus", 15)} Add</button>
            <button type="button" class="btn sm" data-scan-barcode>${icon("camera", 15)} Scan</button>
          </div>
        </div>
        <div class="stack" data-barcodes style="gap:6px">${(p.barcodes?.length ? p.barcodes : [{ code: "", pack_qty: 1 }]).map((b) => barcodeRow(b))}</div>
        <small class="faint">Add the case/carton barcode too with its pack size (×24) so scanning a case adds 24 units. No barcode? Leave empty and use "Generate barcode" after saving.</small>
      </div>
      <details ${product ? "" : "open"}>
        <summary style="cursor:pointer;font-weight:600">Stock, expiry & selling rules</summary>
        <div class="form-grid" style="margin-top:12px">
          <label class="field"><span>Unit</span><select class="input" name="unit">${app.me.units.map((u) => html`<option ${u === p.unit ? "selected" : ""}>${u}</option>`)}</select></label>
          <label class="field"><span>PLU <small>(scale / quick code)</small></span><input class="input" name="plu" inputmode="numeric" maxlength="5" pattern="[0-9]{1,5}" value="${p.plu ? String(Number(p.plu)) : ""}" data-blank="null" /></label>
          <label class="field"><span>Reorder at</span><input class="input num" name="reorder_level" data-type="num" type="number" min="0" step="any" value="${p.reorder_level ?? 0}" /></label>
          <label class="field"><span>Reorder quantity</span><input class="input num" name="reorder_qty" data-type="num" type="number" min="0" step="any" value="${p.reorder_qty ?? 0}" /></label>
          <label class="field"><span>Warn days before expiry</span><input class="input num" name="expiry_warn_days" data-type="int" type="number" min="0" max="365" value="${p.expiry_warn_days ?? 7}" /></label>
          <label class="field"><span>Age restriction</span><select class="input" name="min_age" data-type="int">${[0, 16, 18, 19, 21, 25].map((a) => html`<option value="${a}" ${a === (p.min_age ?? 0) ? "selected" : ""}>${a ? `${a}+ (ID check)` : "None"}</option>`)}</select></label>
          <label class="field"><span>Supplier</span><select class="input" name="supplier_id" data-type="int">${options(suppliers, p.supplier_id, { empty: "—" })}</select></label>
          <label class="field"><span>SKU</span><input class="input mono" name="sku" value="${p.sku ?? ""}" placeholder="Auto" /></label>
          <label class="check"><input type="checkbox" name="track_stock" ${p.track_stock !== false ? "checked" : ""} /> Track stock</label>
          <label class="check"><input type="checkbox" name="track_expiry" ${p.track_expiry !== false ? "checked" : ""} /> Track expiry dates</label>
          <label class="check"><input type="checkbox" name="sold_by_weight" ${p.sold_by_weight ? "checked" : ""} /> Sold by weight (scale)</label>
          <label class="check"><input type="checkbox" name="quick_key" ${p.quick_key ? "checked" : ""} /> Quick key on till</label>
          <label class="check"><input type="checkbox" name="active" ${p.active !== false ? "checked" : ""} /> Active (for sale)</label>
          <label class="field full"><span>External ID <small>(id in your admin panel, for syncing)</small></span><input class="input mono" name="external_id" value="${p.external_id ?? ""}" /></label>
        </div>
      </details>
    </form>`;

  const { result } = modal({
    title: product ? `Edit ${product.name}` : "New product",
    body,
    size: "lg",
    actions: [
      { label: "Cancel", value: undefined },
      { label: product ? "Save changes" : "Create product", kind: "primary", submit: true }
    ],
    onMount(dialog) {
      const list = $("[data-barcodes]", dialog);
      dialog.addEventListener("click", (e) => {
        if (e.target.closest("[data-add-barcode]")) {
          list.insertAdjacentHTML("beforeend", String(barcodeRow()));
          $$("[data-code]", list).at(-1).focus();
        }
        if (e.target.closest("[data-remove-barcode]")) e.target.closest("[data-barcode-row]").remove();
        if (e.target.closest("[data-scan-barcode]")) {
          openCamera({
            continuous: false,
            title: "Scan product barcode",
            onCode(code) {
              const empty = $$("[data-code]", list).find((i) => !i.value);
              if (empty) empty.value = code;
              else list.insertAdjacentHTML("beforeend", String(barcodeRow({ code, pack_qty: 1 })));
            }
          });
        }
      });
      // A scanner gun typing into the barcode box ends with Enter: don't submit the form.
      dialog.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && e.target.matches("[data-code]")) e.preventDefault();
      });
    },
    async onSubmit(form) {
      const d = readForm(form);
      if (!Number.isFinite(d.price)) throw new Error("Enter a valid selling price");
      const barcodes = $$("[data-barcode-row]", form)
        .map((row) => ({ code: $("[data-code]", row).value.trim(), pack_qty: Number($("[data-pack]", row).value) || 1 }))
        .filter((b) => b.code);
      const payload = {
        ...d,
        cost: Number.isFinite(d.cost) ? d.cost : 0,
        barcodes,
        supplier_id: d.supplier_id || null,
        plu: d.plu || null,
        sku: d.sku || undefined,
        external_id: d.external_id || null,
        category: d.category || undefined,
        category_id: d.category ? undefined : null
      };
      const saved = product ? await patch(`/api/products/${product.id}`, payload) : await post("/api/products", payload);
      invalidateLookups();
      toast(product ? "Product saved" : `${saved.name} created`, "success");
      return saved;
    }
  });
  return result;
}

