// Printing via a hidden iframe: thermal receipts (58/80mm), barcode labels, reports.
import { barcodeSvg, gs1Svg, gs1Text } from "./barcode.js";
import { dayLabel, esc, money, qty } from "./ui.js";

function printDocument(bodyHtml, css) {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  document.body.append(frame);
  const doc = frame.contentDocument;
  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>Print</title><style>${css}</style></head><body>${bodyHtml}</body></html>`);
  doc.close();
  const returnFocus = document.activeElement;
  const go = () => {
    frame.contentWindow.focus();
    frame.contentWindow.print();
    // print() returns when the print dialog closes. Give the keyboard back to the page, or
    // keystrokes (and USB barcode scanners) would keep going into the hidden print frame.
    window.focus();
    if (returnFocus instanceof HTMLElement && returnFocus.isConnected) returnFocus.focus();
    else document.activeElement?.blur?.();
    setTimeout(() => frame.remove(), 60_000);
  };
  if (doc.readyState === "complete") setTimeout(go, 50);
  else frame.onload = go;
}

const RECEIPT_CSS = (width) => `
  @page { size: ${width} auto; margin: 3mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 12px/1.35 ui-monospace, Menlo, Consolas, monospace; color: #000; width: calc(${width} - 6mm); }
  .c { text-align: center; } .r { text-align: right; } .b { font-weight: 700; }
  h1 { font-size: 16px; margin: 0 0 2px; }
  hr { border: 0; border-top: 1px dashed #000; margin: 6px 0; }
  table { width: 100%; border-collapse: collapse; }
  td { vertical-align: top; padding: 1px 0; }
  .big td { font-size: 15px; font-weight: 700; padding-top: 3px; }
  .small { font-size: 10.5px; }
  svg { max-width: 100%; height: auto; }
`;

const paperWidth = () => {
  try {
    return localStorage.getItem("pos.paper") || "80mm";
  } catch {
    return "80mm";
  }
};

/** Receipt HTML for a sale or refund (as returned by GET /api/sales/:id). */
export function receiptHtml(sale, { storeName, header = "", methods = [], locale, timezone } = {}) {
  const methodLabel = (id) => (id === "points" ? "Points" : methods.find((m) => m.id === id)?.label ?? id);
  const when = new Intl.DateTimeFormat(locale, { timeZone: timezone ?? sale.branch?.timezone, dateStyle: "medium", timeStyle: "short" }).format(new Date(sale.created_at));
  const isRefund = sale.type === "refund";
  const taxes = new Map();
  for (const item of sale.items) {
    if (!item.tax_rate) continue;
    const t = taxes.get(item.tax_rate) ?? { taxable: 0, tax: 0 };
    t.taxable += item.total - item.tax;
    t.tax += item.tax;
    taxes.set(item.tax_rate, t);
  }
  const items = sale.items
    .map((i) => {
      const lineQty = Math.abs(i.qty);
      const unitLine = lineQty !== 1 ? `<div class="small">&nbsp; ${esc(qty(lineQty))} x ${esc(money(i.unit_price))}</div>` : "";
      const disc = i.discount ? `<div class="small">&nbsp; ${esc(i.promo_name || "Discount")} -${esc(money(Math.abs(i.discount)))}</div>` : "";
      return `<tr><td>${esc(i.name)}${unitLine}${disc}</td><td class="r">${esc(money(i.total))}</td></tr>`;
    })
    .join("");
  const pays = sale.payments.map((p) => `<tr><td>${esc(methodLabel(p.method))}${p.reference && p.method !== "points" && !isRefund ? ` <span class="small">${esc(p.reference)}</span>` : ""}</td><td class="r">${esc(money(p.amount + (p.method === "cash" ? sale.change_due : 0)))}</td></tr>`).join("");
  const taxRows = [...taxes.entries()].map(([rate, t]) => `<tr class="small"><td>Tax ${rate}% on ${esc(money(t.taxable))}</td><td class="r">${esc(money(t.tax))}</td></tr>`).join("");
  return `
    <div class="c">
      <h1>${esc(storeName)}</h1>
      <div>${esc(sale.branch.name)}</div>
      ${sale.branch.address ? `<div class="small">${esc(sale.branch.address)}</div>` : ""}
      ${sale.branch.phone ? `<div class="small">Tel ${esc(sale.branch.phone)}</div>` : ""}
      ${sale.branch.tax_id ? `<div class="small">Tax ID ${esc(sale.branch.tax_id)}</div>` : ""}
      ${header ? `<div class="small">${esc(header)}</div>` : ""}
    </div>
    <hr>
    ${isRefund ? `<div class="c b">REFUND of ${esc(sale.refund_of_receipt ?? "")}</div>` : ""}
    <table class="small">
      <tr><td>Receipt</td><td class="r b">${esc(sale.receipt_no)}</td></tr>
      <tr><td>Date</td><td class="r">${esc(when)}</td></tr>
      <tr><td>Cashier</td><td class="r">${esc(sale.cashier?.name ?? "—")}</td></tr>
      ${sale.customer ? `<tr><td>Customer</td><td class="r">${esc(sale.customer.name || sale.customer.phone)}</td></tr>` : ""}
    </table>
    <hr>
    <table>${items}</table>
    <hr>
    <table>
      <tr><td>Subtotal</td><td class="r">${esc(money(sale.subtotal))}</td></tr>
      ${sale.discount_total ? `<tr><td>You saved</td><td class="r">-${esc(money(Math.abs(sale.discount_total)))}</td></tr>` : ""}
      ${taxRows}
      <tr class="big"><td>${isRefund ? "REFUND" : "TOTAL"}</td><td class="r">${esc(money(sale.total))}</td></tr>
      ${pays}
      ${sale.change_due ? `<tr><td>Change</td><td class="r">${esc(money(sale.change_due))}</td></tr>` : ""}
    </table>
    ${sale.customer && !isRefund ? `<hr><div class="small">Points earned ${sale.points_earned}${sale.points_redeemed ? ` · redeemed ${sale.points_redeemed}` : ""} · balance ${sale.customer.points}</div>` : ""}
    <hr>
    <div class="c small">Items: ${esc(qty(Math.abs(sale.items_count)))}</div>
    ${sale.branch.receipt_footer ? `<div class="c small" style="margin-top:4px">${esc(sale.branch.receipt_footer)}</div>` : ""}
    <div class="c" style="margin-top:8px">${barcodeSvg(sale.receipt_no, { height: 36, module: 1.4 })}</div>
  `;
}

export function printReceipt(sale, opts) {
  const width = paperWidth();
  printDocument(receiptHtml(sale, opts), RECEIPT_CSS(width));
}

/** Prints shelf/product labels. layout: "a4" (3-column sheet) or "roll" (one label per page, 50x30mm). */
export function printLabels(products, { layout = "a4", copies = 1, storeName = "" } = {}) {
  const labels = [];
  for (const p of products) {
    for (let i = 0; i < copies; i += 1) {
      labels.push(`<div class="label"><div class="name">${esc(p.name)}</div><div class="price">${esc(money(p.effective_price ?? p.price))}${p.sold_by_weight ? ` <small>/ ${esc(p.unit)}</small>` : ""}</div>${p.barcode ? barcodeSvg(p.barcode, { height: 34, module: 1.5 }) : `<div class="sku">SKU ${esc(p.sku)}</div>`}<div class="store">${esc(storeName)}</div></div>`);
    }
  }
  const css =
    layout === "roll"
      ? `@page { size: 50mm 30mm; margin: 1.5mm; } body { margin:0; font-family: system-ui, sans-serif; }
         .label { width: 47mm; height: 27mm; page-break-after: always; display:flex; flex-direction:column; align-items:center; justify-content:space-between; overflow:hidden; }
         .name { font-size: 9px; font-weight: 600; text-align:center; max-height: 2.4em; overflow:hidden; }
         .price { font-size: 14px; font-weight: 800; } .price small { font-size: 9px; font-weight: 500; } .store { display:none; } .sku { font: 10px monospace; }
         svg { height: 13mm; width: auto; max-width: 46mm; }`
      : `@page { size: A4; margin: 10mm; } body { margin:0; font-family: system-ui, sans-serif; }
         .sheet { display:grid; grid-template-columns: repeat(3, 1fr); gap: 4mm; }
         .label { border: 1px dashed #999; border-radius: 2mm; padding: 3mm; height: 36mm; display:flex; flex-direction:column; align-items:center; justify-content:space-between; break-inside: avoid; overflow:hidden; }
         .name { font-size: 11px; font-weight: 600; text-align:center; max-height: 2.6em; overflow:hidden; }
         .price { font-size: 18px; font-weight: 800; } .price small { font-size: 10px; font-weight: 500; } .store { font-size: 8px; color:#555; } .sku { font: 11px monospace; }
         svg { height: 15mm; width: auto; max-width: 100%; }`;
  printDocument(layout === "roll" ? labels.join("") : `<div class="sheet">${labels.join("")}</div>`, css);
}

/**
 * Prints expiry-date labels to stick over an item's own barcode. Each label's GS1-128 barcode holds
 * the product number (01) and expiry date (17), so the till scans it like the product barcode and
 * knows the date. labels: [{ name, gtin, expiry_date: "YYYY-MM-DD", batch_no, count }].
 */
export function dateLabelsHtml(labels) {
  const out = [];
  for (const l of labels) {
    const fields = [["01", l.gtin], ["17", l.expiry_date.slice(2).replaceAll("-", "")]];
    const one = `<div class="label"><div class="name">${esc(l.name)}</div>
      <div class="exp">EXP <b>${esc(dayLabel(l.expiry_date))}</b>${l.batch_no ? `<span class="lot">LOT ${esc(l.batch_no)}</span>` : ""}</div>
      ${gs1Svg(fields, { stretch: true, module: 1, height: 40 })}
      <div class="hri">${esc(gs1Text(fields))}</div></div>`;
    for (let i = 0; i < l.count; i += 1) out.push(one);
  }
  return out;
}

export const DATE_LABEL_CSS = {
  roll: `@page { size: 50mm 30mm; margin: 1.5mm; } body { margin:0; font-family: system-ui, sans-serif; color:#000; }
    .label { width: 47mm; height: 27mm; page-break-after: always; display:flex; flex-direction:column; align-items:center; justify-content:space-between; overflow:hidden; }
    .name { font-size: 8.5px; font-weight: 600; max-width: 46mm; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .exp { font-size: 9px; display:flex; align-items:baseline; gap: 3px; } .exp b { font-size: 13px; } .lot { font-size: 8px; margin-left: 4px; }
    svg { width: 46mm; height: 11.5mm; display:block; } .hri { font: 6.5px/1 ui-monospace, monospace; }`,
  a4: `@page { size: A4; margin: 10mm; } body { margin:0; font-family: system-ui, sans-serif; color:#000; }
    .sheet { display:grid; grid-template-columns: repeat(3, 1fr); gap: 4mm; }
    .label { border: 1px dashed #999; border-radius: 2mm; padding: 2.5mm 3mm; height: 34mm; display:flex; flex-direction:column; align-items:center; justify-content:space-between; break-inside: avoid; overflow:hidden; }
    .name { font-size: 10px; font-weight: 600; max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .exp { font-size: 10px; display:flex; align-items:baseline; gap: 3px; } .exp b { font-size: 15px; } .lot { font-size: 9px; margin-left: 5px; }
    svg { width: 52mm; height: 14mm; display:block; } .hri { font: 7.5px/1 ui-monospace, monospace; }`
};

export function printDateLabels(labels, { layout = "roll" } = {}) {
  const items = dateLabelsHtml(labels);
  printDocument(layout === "roll" ? items.join("") : `<div class="sheet">${items.join("")}</div>`, DATE_LABEL_CSS[layout] ?? DATE_LABEL_CSS.roll);
  return items.length;
}

/** Prints an element's HTML as an A4 report using the app stylesheet. */
export function printReport(title, innerHtml) {
  const css = `@page { size: A4; margin: 12mm; } body { font: 12px/1.4 system-ui, sans-serif; color: #000; }
    h1 { font-size: 18px; margin: 0 0 4px; } h2 { font-size: 14px; margin: 14px 0 6px; } table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
    th, td { text-align: left; padding: 4px 6px; border-bottom: 1px solid #ddd; } th { font-size: 10.5px; text-transform: uppercase; color: #555; }
    .num { text-align: right; font-variant-numeric: tabular-nums; } .grid { display:grid; grid-template-columns: repeat(4,1fr); gap: 8px; }
    .kpi { border: 1px solid #ddd; border-radius: 6px; padding: 6px 8px; } .kpi .label { font-size: 10.5px; color:#555 } .kpi .value { font-size: 15px; font-weight: 700 }
    .no-print, svg, .chart { display: none !important; } .card { border: 0; } .card-head p, .sub { color:#555; font-size: 11px }`;
  printDocument(`<h1>${esc(title)}</h1>${innerHtml}`, css);
}
