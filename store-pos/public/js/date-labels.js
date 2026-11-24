// "Print date labels" dialog: expiry-date labels for items whose own barcode has no date.
import { get } from "./api.js";
import { toGtin14 } from "./barcode.js";
import { printDateLabels } from "./print.js";
import { dayLabel, html, modal, toast } from "./ui.js";

const LAYOUT_KEY = "pos.dateLabelLayout";
const ASK_KEY = "pos.askDateLabels";
const MAX_PER_LINE = 500;

const read = (key, fallback) => {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
};
const write = (key, value) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode: just don't remember */
  }
};

/** Whether to offer date labels right after a delivery is posted (the user can turn this off). */
export function askAfterDelivery() {
  return read(ASK_KEY, "1") !== "0";
}

/**
 * items: [{ product_id, expiry_date, batch_no, qty, from_code }]. from_code: the pack's own barcode
 * already carries its date (no label needed by default).
 */
export async function openDateLabels(app, items, { title = "Print date labels", afterDelivery = false } = {}) {
  const dated = items.filter((i) => i.expiry_date);
  if (!dated.length) {
    toast("Nothing to label: none of these items has an expiry date");
    return false;
  }
  const ids = [...new Set(dated.map((i) => i.product_id))];
  const products = new Map((await Promise.all(ids.map((id) => get(`/api/products/${id}`)))).map((p) => [p.id, p]));
  const rows = dated.map((item) => {
    const p = products.get(item.product_id);
    // Only a single-unit barcode can go on a unit's label (a case code would add the whole case).
    const unitCode = p.barcodes.find((b) => b.pack_qty === 1 && toGtin14(b.code))?.code;
    const gtin = unitCode ? toGtin14(unitCode) : null;
    const count = !gtin || item.from_code ? 0 : p.sold_by_weight ? 1 : Math.min(MAX_PER_LINE, Math.max(1, Math.ceil(Number(item.qty) || 1)));
    return { ...item, name: p.name, gtin, count };
  });

  const { result } = modal({
    title,
    size: "lg",
    body: html`<form class="stack" data-date-labels>
      <p class="muted">Labels for items whose barcode has no expiry date. Stick each label <strong>over the item's own barcode</strong>: the label's barcode holds the product and its expiry date, so the till scans it like the normal barcode and warns when the item has expired.</p>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>Product</th><th>Expiry</th><th>Batch</th><th class="num" style="width:100px">Labels</th></tr></thead>
        <tbody>${rows.map(
          (r, i) => html`<tr>
            <td><div style="font-weight:600">${r.name}</div>${!r.gtin ? html`<div class="sub">No product barcode. Add or generate one in Inventory first.</div>` : r.from_code ? html`<div class="sub">Its own barcode already has the date.</div>` : ""}</td>
            <td class="nowrap">${dayLabel(r.expiry_date)}</td>
            <td class="mono small">${r.batch_no || "—"}</td>
            <td><input class="input sm num" type="number" min="0" max="${MAX_PER_LINE}" step="1" name="n${i}" value="${r.count}" ${r.gtin ? "" : "disabled"} aria-label="Labels for ${r.name}" /></td>
          </tr>`
        )}</tbody>
      </table></div>
      <label class="field"><span>Print on</span><select class="input" name="layout">
        <option value="roll" ${read(LAYOUT_KEY, "roll") === "roll" ? "selected" : ""}>Label printer roll (50 × 30 mm)</option>
        <option value="a4" ${read(LAYOUT_KEY, "roll") === "a4" ? "selected" : ""}>A4 sheet (3 across)</option>
      </select></label>
      ${afterDelivery ? html`<label class="row tight small"><input type="checkbox" name="ask" ${askAfterDelivery() ? "checked" : ""} /> Ask after every delivery</label>` : ""}
    </form>`,
    actions: [
      {
        label: afterDelivery ? "Skip" : "Cancel",
        onClick(dialog) {
          const ask = dialog.querySelector("[name=ask]");
          if (ask) write(ASK_KEY, ask.checked ? "1" : "0");
        }
      },
      { label: "Print labels", kind: "primary", icon: "printer", submit: true }
    ],
    onSubmit(form) {
      const labels = rows
        .map((r, i) => ({ name: r.name, gtin: r.gtin, expiry_date: r.expiry_date, batch_no: r.batch_no, count: Math.min(MAX_PER_LINE, Math.max(0, Math.floor(Number(form[`n${i}`].value) || 0))) }))
        .filter((l) => l.gtin && l.count > 0);
      if (form.ask) write(ASK_KEY, form.ask.checked ? "1" : "0");
      if (!labels.length) {
        toast("Enter how many labels to print", "warn");
        return false;
      }
      write(LAYOUT_KEY, form.layout.value);
      const printed = printDateLabels(labels, { layout: form.layout.value });
      toast(`Printing ${printed} date label${printed === 1 ? "" : "s"}`, "success");
      return true;
    }
  });
  return result;
}
