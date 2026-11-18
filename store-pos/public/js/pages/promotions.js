import { del, get, patch, post } from "../api.js";
import { lookups } from "../product-form.js";
import { promoLabel } from "/shared/pricing.js";
import { confirmDialog, dayLabel, debounce, html, icon, modal, money, mount, on, options, readForm, showError, toMajor, toMinor, toast } from "../ui.js";

const TYPE_HELP = {
  percent: "Percentage off the price (leave product and category empty for a store-wide sale).",
  amount: "A fixed amount off each unit.",
  multibuy: "Buy N, get M free — e.g. buy 2 get 1 free.",
  bundle: "N for a fixed price — e.g. 2 for 5.00."
};

export default async function promotionsPage(el, app) {
  const { categories } = await lookups(true);
  const isOwner = app.me.user.role === "owner";

  async function load() {
    const promos = await get("/api/promotions");
    mount(
      el,
      html`<div class="page-head"><div><h1>Promotions</h1><p>Deals apply automatically at the till. The best deal per item wins.</p></div><button class="btn primary" data-act="new">${icon("plus", 16)} New promotion</button></div>
        <div class="card"><div class="table-wrap">${promos.length
          ? html`<table class="table"><thead><tr><th>Name</th><th>Deal</th><th>Applies to</th><th>Dates</th><th>Branch</th><th>Status</th><th></th></tr></thead><tbody>${promos.map((p) => {
              const status = !p.active ? ["", "Off"] : p.ends_on && p.ends_on < app.today ? ["", "Ended"] : p.starts_on && p.starts_on > app.today ? ["info", "Scheduled"] : ["good", "Active"];
              const editable = isOwner || p.branch_id === app.branchId;
              return html`<tr><td><strong>${p.name}</strong></td><td>${promoLabel(p, money)}</td><td>${p.product_name ?? (p.category_name ? `Category: ${p.category_name}` : "Everything")}</td>
                <td class="small">${p.starts_on ? dayLabel(p.starts_on) : "Now"} → ${p.ends_on ? dayLabel(p.ends_on) : "no end"}</td><td>${p.branch_name ?? "All branches"}</td><td><span class="badge ${status[0]}">${status[1]}</span></td>
                <td class="nowrap">${editable ? html`<button class="btn sm" data-edit="${p.id}">${icon("edit", 14)}</button> <button class="btn sm danger" data-del="${p.id}" aria-label="Delete">${icon("trash", 14)}</button>` : html`<span class="faint small">Head office</span>`}</td></tr>`;
            })}</tbody></table>`
          : html`<div class="empty">${icon("tag", 40)}<div>No promotions yet.</div></div>`}</div></div>`
    );
    return promos;
  }

  async function edit(promo = null) {
    let productId = promo?.product_id ?? null;
    let productName = promo?.product_name ?? "";
    const { result } = modal({
      title: promo ? "Edit promotion" : "New promotion",
      body: html`<form class="form-grid">
        <label class="field full"><span>Name (shown on receipts)</span><input class="input" name="name" required value="${promo?.name ?? ""}" /></label>
        <label class="field"><span>Type</span><select class="input" name="type">${app.me.promo_types.map((t) => html`<option value="${t}" ${t === (promo?.type ?? "percent") ? "selected" : ""}>${{ percent: "Percent off", amount: "Amount off", multibuy: "Buy N get M free", bundle: "N for fixed price" }[t]}</option>`)}</select></label>
        <div class="field"><span data-help class="small muted" style="font-weight:400"></span></div>
        <label class="field" data-show="percent amount bundle"><span data-value-label>Value</span><input class="input num" name="value" inputmode="decimal" value="${promo ? (promo.type === "percent" ? promo.value : toMajor(promo.value)) : ""}" /></label>
        <label class="field" data-show="multibuy bundle"><span>Buy quantity (N)</span><input class="input num" name="buy_qty" type="number" min="1" value="${promo?.buy_qty || 2}" /></label>
        <label class="field" data-show="multibuy"><span>Free quantity (M)</span><input class="input num" name="free_qty" type="number" min="1" value="${promo?.free_qty || 1}" /></label>
        <div class="field full"><span>Product</span><div class="row"><div class="search grow">${icon("search")}<input class="input" data-product-search placeholder="Search product (or leave empty and pick a category)" value="${productName}" /></div><button type="button" class="btn sm" data-clear-product>Clear</button></div><div data-product-results></div></div>
        <label class="field"><span>…or category</span><select class="input" name="category_id">${options(categories, promo?.category_id, { empty: "—" })}</select></label>
        ${isOwner ? html`<label class="field"><span>Branch</span><select class="input" name="branch_id">${options(app.me.branches, promo?.branch_id, { empty: "All branches" })}</select></label>` : html`<div class="field"><span>Branch</span><div>${app.branch.name}</div></div>`}
        <label class="field"><span>Starts</span><input class="input" type="date" name="starts_on" value="${promo?.starts_on ?? ""}" /></label>
        <label class="field"><span>Ends</span><input class="input" type="date" name="ends_on" value="${promo?.ends_on ?? ""}" /></label>
        <label class="check full"><input type="checkbox" name="active" ${promo?.active === 0 ? "" : "checked"} /> Active</label>
      </form>`,
      actions: [{ label: "Cancel" }, { label: "Save", kind: "primary", submit: true }],
      onMount(dialog) {
        const sync = () => {
          const type = dialog.querySelector("[name=type]").value;
          dialog.querySelectorAll("[data-show]").forEach((f) => f.classList.toggle("hidden", !f.dataset.show.split(" ").includes(type)));
          dialog.querySelector("[data-help]").textContent = TYPE_HELP[type];
          dialog.querySelector("[data-value-label]").textContent = type === "percent" ? "Percent off" : type === "bundle" ? "Bundle price" : "Amount off each";
        };
        dialog.querySelector("[name=type]").addEventListener("change", sync);
        sync();
        const results = dialog.querySelector("[data-product-results]");
        const search = debounce(async (term) => {
          if (term.length < 2) return (results.innerHTML = "");
          const { items } = await get(`/api/products?search=${encodeURIComponent(term)}&limit=6`);
          mount(results, html`<div class="stack" style="gap:4px;margin-top:6px">${items.map((p) => html`<button type="button" class="btn sm" style="justify-content:space-between" data-pick="${p.id}" data-name="${p.name}"><span>${p.name}</span><span class="faint">${money(p.effective_price)}</span></button>`)}</div>`);
        }, 220);
        dialog.querySelector("[data-product-search]").addEventListener("input", (e) => {
          productId = null;
          search(e.target.value.trim());
        });
        dialog.addEventListener("click", (e) => {
          const pick = e.target.closest("[data-pick]");
          if (pick) {
            productId = Number(pick.dataset.pick);
            dialog.querySelector("[data-product-search]").value = pick.dataset.name;
            results.innerHTML = "";
            dialog.querySelector("[name=category_id]").value = "";
          }
          if (e.target.closest("[data-clear-product]")) {
            productId = null;
            dialog.querySelector("[data-product-search]").value = "";
          }
        });
      },
      async onSubmit(form) {
        const d = readForm(form);
        const payload = {
          name: d.name,
          type: d.type,
          value: d.type === "percent" ? Number(d.value) : toMinor(d.value),
          buy_qty: Number(d.buy_qty) || 0,
          free_qty: Number(d.free_qty) || 0,
          product_id: productId,
          category_id: productId ? null : d.category_id || null,
          branch_id: isOwner ? d.branch_id || null : app.branchId,
          starts_on: d.starts_on || null,
          ends_on: d.ends_on || null,
          active: d.active
        };
        return promo ? patch(`/api/promotions/${promo.id}`, payload) : post("/api/promotions", payload);
      }
    });
    return result;
  }

  let promos = await load();
  on(el, "click", "[data-act=new]", async () => {
    if (await edit()) {
      toast("Promotion saved", "success");
      promos = await load();
    }
  });
  on(el, "click", "[data-edit]", async (e, b) => {
    if (await edit(promos.find((p) => p.id === Number(b.dataset.edit)))) {
      toast("Promotion saved", "success");
      promos = await load();
    }
  });
  on(el, "click", "[data-del]", async (e, b) => {
    if (!(await confirmDialog("Delete this promotion?", { ok: "Delete", danger: true }))) return;
    try {
      await del(`/api/promotions/${b.dataset.del}`);
      promos = await load();
    } catch (err) {
      showError(err);
    }
  });
}
