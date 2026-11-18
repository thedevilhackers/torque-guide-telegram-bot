import { get, post } from "../api.js";
import { onScan, openCamera, scanField } from "../scanner.js";
import { $, beep, confirmDialog, dateTime, html, icon, modal, money, mount, on, qty, showError, toast } from "../ui.js";

export default async function countPage(el, app) {
  const key = `pos.count.${app.branchId}`;
  let lines = [];
  try {
    lines = JSON.parse(localStorage.getItem(key) || "[]");
  } catch {
    lines = [];
  }
  const save = () => {
    try {
      localStorage.setItem(key, JSON.stringify(lines));
    } catch {
      /* ignore */
    }
  };

  mount(
    el,
    html`<div class="page-head">
        <div><h1>Stock count</h1><p>Scan every item on the shelf (each scan adds one), or type the counted quantity. Products you don't scan are left unchanged.</p></div>
        <div class="row"><button class="btn" data-act="history">${icon("clipboard", 16)} Past counts</button></div>
      </div>
      <div class="stack">
        <div class="card scanbar">${scanField({ placeholder: "Scan item to count it", id: "count-scan" })}</div>
        <div class="card"><div class="card-head"><h2>Counted items</h2><div class="row"><button class="btn ghost sm" data-act="clear">Clear</button><button class="btn primary" data-act="apply">${icon("check", 16)} Apply count</button></div></div><div class="table-wrap" data-lines></div></div>
      </div>`
  );
  const input = $("#count-scan", el);

  function render(flashId) {
    save();
    mount(
      $("[data-lines]", el),
      lines.length
        ? html`<table class="table"><thead><tr><th>Product</th><th class="num">System</th><th class="num" style="width:130px">Counted</th><th class="num">Difference</th><th></th></tr></thead><tbody>${lines.map((l) => {
            const diff = Math.round((l.counted - l.system) * 1000) / 1000;
            return html`<tr data-id="${l.product_id}" style="${l.product_id === flashId ? "background:var(--primary-soft)" : ""}"><td><strong>${l.name}</strong><div class="sub">${l.barcode ?? l.sku}</div></td><td class="num">${qty(l.system, l.unit)}</td>
              <td><input class="input sm num" type="number" min="0" step="any" data-counted value="${l.counted}" /></td>
              <td class="num"><span class="badge ${diff === 0 ? "good" : diff < 0 ? "bad" : "warn"}">${diff > 0 ? "+" : ""}${qty(diff, l.unit)}</span><div class="sub">${money(Math.round(diff * l.cost))}</div></td>
              <td><button class="btn ghost icon sm" data-remove aria-label="Remove">${icon("x", 16)}</button></td></tr>`;
          })}</tbody></table>`
        : html`<div class="empty">${icon("clipboard", 40)}<div>Scan the first item.</div></div>`
    );
  }

  async function handle(code) {
    try {
      const hit = await get(`/api/lookup?code=${encodeURIComponent(code)}`);
      const p = hit.product;
      if (!p.track_stock) return toast(`${p.name} does not track stock`, "warn");
      let line = lines.find((l) => l.product_id === p.id);
      if (!line) {
        line = { product_id: p.id, name: p.name, sku: p.sku, barcode: p.barcode, unit: p.unit, system: p.stock_qty, cost: p.cost, counted: 0 };
        lines.unshift(line);
      }
      line.counted = Math.round((line.counted + hit.qty) * 1000) / 1000;
      beep(true);
      render(p.id);
    } catch (err) {
      beep(false);
      showError(err);
    }
  }

  input.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const v = input.value.trim();
    input.value = "";
    if (v) handle(v);
  });
  const stop = onScan(handle);
  on(el, "click", "[data-camera]", () => openCamera({ continuous: true, title: "Count items" }));
  on(el, "change", "[data-counted]", (e, i) => {
    const line = lines.find((l) => l.product_id === Number(i.closest("[data-id]").dataset.id));
    line.counted = Math.max(0, Number(i.value) || 0);
    render();
  });
  on(el, "click", "[data-remove]", (e, b) => {
    lines = lines.filter((l) => l.product_id !== Number(b.closest("[data-id]").dataset.id));
    render();
  });
  on(el, "click", "[data-act]", async (e, b) => {
    const act = b.dataset.act;
    if (act === "clear" && lines.length && (await confirmDialog("Discard this count?", { ok: "Discard", danger: true }))) {
      lines = [];
      render();
    }
    if (act === "apply") {
      if (!lines.length) return toast("Scan items first");
      const changed = lines.filter((l) => l.counted !== l.system).length;
      if (!(await confirmDialog(`Set stock for ${lines.length} product(s) to the counted quantities? ${changed} will change.`, { title: "Apply stock count", ok: "Apply" }))) return;
      try {
        const res = await post("/api/stock/count", { items: lines.map((l) => ({ product_id: l.product_id, counted: l.counted })) });
        lines = [];
        render();
        toast(`Count applied. Variance ${qty(res.variance_qty)} units (${money(res.variance_value)})`, "success", 6000);
      } catch (err) {
        showError(err);
      }
    }
    if (act === "history") {
      const counts = await get("/api/stock/counts");
      modal({
        title: "Past stock counts",
        size: "lg",
        body: counts.length
          ? html`<table class="table"><thead><tr><th>Date</th><th>By</th><th class="num">Items</th><th class="num">Variance</th><th class="num">Value</th></tr></thead><tbody>${counts.map(
              (c) => html`<tr><td>${dateTime(c.created_at)}</td><td>${c.user_name ?? ""}</td><td class="num">${c.items_counted}</td><td class="num">${qty(c.variance_qty)}</td><td class="num">${money(c.variance_value)}</td></tr>`
            )}</tbody></table>`
          : html`<div class="empty">No counts yet.</div>`,
        actions: [{ label: "Close" }]
      });
    }
  });

  render();
  input.focus();
  return stop;
}
