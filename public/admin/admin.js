// Admin panel: full access to orders, enquiries, the tuning file service (file orders, customers,
// payments, tune options and credit packs), products, vehicles, ECUs, brands, services, photos,
// settings and backups. All text is inserted with textContent (see h()), never as HTML.
import { h, money } from "/js/common.js";
import { productArt } from "/js/icons.js";

const app = document.getElementById("app");
const toasts = document.querySelector("[data-toasts]");
const state = { businessName: "Unity Performance", currency: "USD", badges: {} };

const SECTIONS = [
  ["dashboard", "Dashboard"],
  ["orders", "Orders"],
  ["enquiries", "Enquiries"],
  ["franchise", "Franchise"],
  ["files", "File orders"],
  ["payments", "Payments"],
  ["customers", "Customers"],
  ["tuneOptions", "Tune options"],
  ["creditPacks", "Credit packs"],
  ["franchisePackages", "Franchise packages"],
  ["products", "Products"],
  ["vehicles", "Vehicles"],
  ["ecus", "ECUs"],
  ["brands", "Brands"],
  ["services", "Services"],
  ["photos", "Photos"],
  ["settings", "Settings"],
  ["backup", "Backup"]
];
const ORDER_LABELS = { new: "New", confirmed: "Confirmed", ready: "Ready", completed: "Completed", cancelled: "Cancelled" };
const ENQUIRY_LABELS = { new: "New", contacted: "Contacted", booked: "Booked", closed: "Closed" };
const FRANCHISE_LABELS = { new: "New", contacted: "Contacted", meeting: "Meeting set", signed: "Signed", closed: "Closed" };
// ₹9,99,000 → "₹9.99 lakh", as the franchise page shows it.
const lakh = (amount) => (amount >= 100000 ? `₹${Number((amount / 100000).toFixed(2))} lakh` : `₹${Number(amount).toLocaleString("en-IN")}`);
const ECU_LABELS = { supported: "Supported", on_request: "On request", not_supported: "Not supported" };
const FUEL_LABELS = { petrol: "Petrol", diesel: "Diesel" };
const READ_LABELS = { obd: "OBD (diagnostic port)", bench: "Bench", boot: "Boot mode" };
const readMethods = (methods = []) => methods.map((method) => READ_LABELS[method].split(" ")[0]).join(", ") || "—";
const ASPIRATION_LABELS = { turbo: "Turbo", supercharged: "Supercharged", naturally_aspirated: "Naturally aspirated" };
const ICONS = { bolt: "Lightning", gauge: "Gauge", wave: "Power curve", scan: "Diagnostics", chip: "Chip", wrench: "Wrench", shield: "Shield", sparkle: "Sparkle" };

// ---------- Helpers ----------

class SignedOut extends Error {}

async function api(path, { method = "GET", body = method === "GET" || method === "DELETE" ? undefined : {} } = {}) {
  const response = await fetch(path, {
    method,
    headers: { "X-Requested-With": "unity-admin", ...(body !== undefined && { "Content-Type": "application/json" }) },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401 && path !== "/api/admin/login") {
    showLogin(data.error);
    throw new SignedOut(data.error);
  }
  if (!response.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}

function toast(message, type = "") {
  const item = h("div", { class: `toast ${type}`, text: message });
  toasts.append(item);
  setTimeout(() => item.remove(), type === "error" ? 6000 : 3000);
}

function reportError(error) {
  if (!(error instanceof SignedOut)) toast(error.message, "error");
}

const dateTime = (iso) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
const cash = (amount) => money(amount, state.currency);
const pill = (key, label) => h("span", { class: `pill pill-${key}`, text: label });
const digits = (value) => String(value ?? "").replace(/\D/g, "");

function pageHead(title, subtitle, ...actions) {
  return h("header", { class: "page-head" }, h("div", {}, h("h1", { text: title }), subtitle ? h("p", { text: subtitle }) : null), h("div", { class: "toolbar" }, ...actions));
}

function dataTable(columns, rows, { onRowClick, empty = "Nothing here yet." } = {}) {
  if (!rows.length) return h("div", { class: "table-wrap" }, h("p", { class: "empty", text: empty }));
  return h(
    "div",
    { class: "table-wrap" },
    h(
      "table",
      { class: "data" },
      h("thead", {}, h("tr", {}, ...columns.map((column) => h("th", { scope: "col", class: column.class, text: column.label })))),
      h(
        "tbody",
        {},
        ...rows.map((row) => {
          const tr = h("tr", { class: onRowClick ? "clickable" : undefined }, ...columns.map((column) => h("td", { class: column.class }, column.cell(row))));
          if (onRowClick) {
            tr.tabIndex = 0;
            tr.addEventListener("click", () => onRowClick(row));
            tr.addEventListener("keydown", (event) => event.key === "Enter" && onRowClick(row));
          }
          return tr;
        })
      )
    )
  );
}

// Stops clicks on controls inside a clickable row from opening the row.
const isolate = (element) => {
  element.addEventListener("click", (event) => event.stopPropagation());
  element.addEventListener("keydown", (event) => event.stopPropagation());
  return element;
};

function modal({ title, body, footer = [], wide = false }) {
  const close = h("button", { class: "btn btn-small", type: "button", text: "Close" });
  const dialog = h("dialog", { class: `modal${wide ? " wide" : ""}`, "aria-label": title },
    h("div", { class: "modal-head" }, h("h2", { text: title }), close),
    h("div", { class: "modal-body" }, body),
    footer.length ? h("div", { class: "modal-foot" }, ...footer) : null
  );
  close.addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
  return dialog;
}

function confirmDialog(message, { confirmLabel = "Delete", danger = true } = {}) {
  return new Promise((resolve) => {
    let answer = false;
    const yes = h("button", { class: `btn ${danger ? "btn-danger" : "btn-primary"}`, type: "button", text: confirmLabel });
    const no = h("button", { class: "btn", type: "button", text: "Cancel" });
    const dialog = modal({ title: "Are you sure?", body: h("p", { text: message }), footer: [no, yes] });
    yes.addEventListener("click", () => {
      answer = true;
      dialog.close();
    });
    no.addEventListener("click", () => dialog.close());
    dialog.addEventListener("close", () => resolve(answer));
    no.focus();
  });
}

function readFile(file, as = "dataURL") {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Couldn't read that file."));
    if (as === "text") reader.readAsText(file);
    else reader.readAsDataURL(file);
  });
}

// ---------- Forms ----------

// Field types: text (default), textarea, number, email, tel, select, checkbox, checkboxes, lines, image.
function buildField(field, value) {
  const wrap = (control, extra = []) =>
    h("label", { class: `field${field.full ? " full" : ""}` }, h("span", { text: field.label }), control, ...extra, field.help ? h("span", { class: "help", text: field.help }) : null);

  if (field.type === "checkbox") {
    const input = h("input", { type: "checkbox", name: field.name, checked: Boolean(value) });
    return { element: h("label", { class: `check${field.full ? " full" : ""}` }, input, field.label), read: () => input.checked };
  }
  if (field.type === "checkboxes") {
    const inputs = field.options.map(([optionValue, label]) => [optionValue, h("input", { type: "checkbox", value: optionValue, checked: (value ?? []).includes(optionValue) }), label]);
    const element = h("fieldset", { class: `field${field.full ? " full" : ""}`, style: { border: "0", padding: "0", margin: "0" } },
      h("legend", { class: "field", style: { padding: "0" } }, h("span", { text: field.label })),
      h("div", { class: "checks" }, ...inputs.map(([, input, label]) => h("label", { class: "check" }, input, label))),
      field.help ? h("span", { class: "help", text: field.help }) : null
    );
    return { element, read: () => inputs.filter(([, input]) => input.checked).map(([optionValue]) => optionValue) };
  }
  // A price per tuning type: tick the types an option goes with and set its price for each.
  if (field.type === "prices") {
    const rows = field.tunes.map(([id, label]) => {
      const offered = h("input", { type: "checkbox", checked: Object.hasOwn(value ?? {}, id) });
      const price = h("input", { type: "number", step: "0.01", min: "0", "aria-label": `Price with ${label}` });
      price.value = value?.[id] ?? "";
      price.disabled = !offered.checked;
      offered.addEventListener("change", () => {
        price.disabled = !offered.checked;
        if (offered.checked && price.value === "") price.value = "0.5";
      });
      return { id, offered, price, element: h("label", { class: "price-row" }, offered, h("span", { text: label }), price) };
    });
    const element = h("div", { class: `field${field.full ? " full" : ""}` }, h("span", { text: field.label }), h("div", { class: "price-rows" }, ...rows.map((row) => row.element)), field.help ? h("span", { class: "help", text: field.help }) : null);
    return { element, read: () => Object.fromEntries(rows.filter((row) => row.offered.checked).map((row) => [row.id, row.price.value])) };
  }
  if (field.type === "select") {
    const select = h("select", { name: field.name }, ...field.options.map(([optionValue, label]) => h("option", { value: optionValue, text: label, selected: String(value) === String(optionValue) })));
    return { element: wrap(select), read: () => select.value };
  }
  if (field.type === "image") {
    let current = value ?? "";
    const preview = h("div", { class: "upload" });
    const input = h("input", { type: "file", accept: "image/png,image/jpeg,image/webp", class: "visually-hidden" });
    const choose = h("button", { class: "btn btn-small", type: "button", text: "Upload image" });
    const remove = h("button", { class: "btn btn-small btn-link", type: "button", text: "Remove" });
    const draw = () => {
      preview.replaceChildren(current ? h("img", { src: current, alt: "" }) : h("div", { class: "placeholder" }), h("div", {}, choose, " ", current ? remove : null, input));
    };
    choose.addEventListener("click", () => input.click());
    remove.addEventListener("click", () => {
      current = "";
      draw();
    });
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      choose.disabled = true;
      choose.textContent = "Uploading…";
      try {
        const { url } = await api("/api/admin/uploads", { method: "POST", body: { data: await readFile(file) } });
        current = url;
        draw();
      } catch (error) {
        reportError(error);
      } finally {
        choose.disabled = false;
        choose.textContent = "Upload image";
      }
    });
    draw();
    const element = h("div", { class: `field${field.full ? " full" : ""}` }, h("span", { text: field.label }), preview, field.help ? h("span", { class: "help", text: field.help }) : null);
    return { element, read: () => current };
  }
  if (field.type === "textarea" || field.type === "lines") {
    const textarea = h("textarea", { name: field.name, rows: field.rows ?? 3 });
    textarea.value = field.type === "lines" ? (value ?? []).join("\n") : (value ?? "");
    return { element: wrap(textarea), read: () => (field.type === "lines" ? textarea.value.split("\n").map((line) => line.trim()).filter(Boolean) : textarea.value) };
  }
  const input = h("input", { name: field.name, type: field.type ?? "text", step: field.step, min: field.min, placeholder: field.placeholder, list: field.list ? `${field.name}-options` : undefined, autocomplete: "off" });
  input.value = value ?? "";
  const datalist = field.list ? h("datalist", { id: `${field.name}-options` }, ...field.list.map((option) => h("option", { value: option }))) : null;
  return { element: wrap(input, [datalist]), read: () => input.value };
}

function formModal({ title, fields, values = {}, submitLabel = "Save", onSubmit, onDelete, before, wide = true }) {
  const built = fields.map((field) => [field.name, buildField(field, values[field.name])]);
  const error = h("p", { class: "error", role: "alert", hidden: true });
  const save = h("button", { class: "btn btn-primary", type: "submit", text: submitLabel });
  const form = h("form", { class: "form-grid", novalidate: true }, before ?? null, ...built.map(([, item]) => item.element), h("div", { class: "full" }, error));
  // Fields shown only for one value of another field (showIf: [name, value]).
  for (const field of fields.filter((entry) => entry.showIf)) {
    const [name, wanted] = field.showIf;
    const control = built.find(([key]) => key === name)?.[1].element.querySelector("select, input");
    const item = built.find(([key]) => key === field.name)?.[1];
    if (!control || !item) continue;
    const update = () => (item.element.hidden = control.value !== wanted);
    control.addEventListener("change", update);
    update();
  }
  const footer = [];
  if (onDelete) {
    const remove = h("button", { class: "btn btn-danger spacer", type: "button", text: "Delete" });
    remove.addEventListener("click", async () => {
      if (!(await confirmDialog(`Delete “${title.replace(/^Edit /, "")}”? This can't be undone.`))) return;
      try {
        await onDelete();
        dialog.close();
      } catch (failure) {
        reportError(failure);
      }
    });
    footer.push(remove);
  }
  const cancel = h("button", { class: "btn", type: "button", text: "Cancel" });
  footer.push(cancel, save);
  save.setAttribute("form", "modal-form");
  form.id = "modal-form";
  const dialog = modal({ title, body: form, footer, wide });
  cancel.addEventListener("click", () => dialog.close());
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    error.hidden = true;
    save.disabled = true;
    try {
      await onSubmit(Object.fromEntries(built.map(([name, item]) => [name, item.read()])));
      dialog.close();
    } catch (failure) {
      if (failure instanceof SignedOut) return;
      error.textContent = failure.message;
      error.hidden = false;
      error.scrollIntoView({ block: "nearest" });
    } finally {
      save.disabled = false;
    }
  });
  form.querySelector("input, select, textarea")?.focus();
  return dialog;
}

// ---------- Charts ----------

// Single-series bar chart: no legend (the card title names it), per-bar hover/focus tooltip,
// 4px rounded data ends square at the baseline, and a table view.
function barChart(days) {
  const root = h("div", { class: "bars" });
  const tooltip = h("div", { class: "bar-tooltip", hidden: true });
  const label = (date) => new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });

  function render() {
    const width = Math.max(300, root.clientWidth);
    const height = 200;
    const margin = { left: 56, right: 8, top: 10, bottom: 26 };
    const inner = { width: width - margin.left - margin.right, height: height - margin.top - margin.bottom };
    const max = Math.max(1, ...days.map((day) => day.revenue));
    const raw = (max * 1.1) / 4;
    const magnitude = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((candidate) => candidate >= raw);
    const top = step * 4;
    const y = (value) => margin.top + inner.height - (value / top) * inner.height;
    const band = inner.width / days.length;
    const barWidth = Math.max(4, Math.min(24, band - 6));
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("height", height);
    const add = (tag, attributes, text) => {
      const element = document.createElementNS("http://www.w3.org/2000/svg", tag);
      for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
      if (text !== undefined) element.textContent = text;
      svg.append(element);
      return element;
    };
    for (let i = 0; i <= 4; i++) {
      add("line", { class: "grid-line", x1: margin.left, x2: width - margin.right, y1: y(i * step), y2: y(i * step) });
      add("text", { class: "tick", x: margin.left - 8, y: y(i * step) + 4, "text-anchor": "end" }, Math.round(i * step).toLocaleString());
    }
    days.forEach((day, i) => {
      const x = margin.left + band * i + (band - barWidth) / 2;
      const base = y(0);
      const barTop = y(day.revenue);
      const r = Math.min(4, (base - barTop) / 2, barWidth / 2);
      const bar = add("path", {
        class: "bar",
        d: day.revenue > 0 ? `M${x},${base}V${barTop + r}Q${x},${barTop} ${x + r},${barTop}H${x + barWidth - r}Q${x + barWidth},${barTop} ${x + barWidth},${barTop + r}V${base}Z` : `M${x},${base}H${x + barWidth}`
      });
      if (i % 2 === (days.length - 1) % 2) add("text", { class: "tick", x: x + barWidth / 2, y: height - 6, "text-anchor": "middle" }, label(day.date));
      const hit = add("rect", { class: "hit", x: margin.left + band * i, y: margin.top, width: band, height: inner.height, tabindex: 0, role: "img", "aria-label": `${label(day.date)}: ${cash(day.revenue)}, ${day.orders} orders` });
      const show = () => {
        root.classList.add("is-hovering");
        for (const other of svg.querySelectorAll(".bar")) other.classList.toggle("is-active", other === bar);
        tooltip.replaceChildren(h("strong", { text: cash(day.revenue) }), h("span", { text: `${label(day.date)} · ${day.orders} order${day.orders === 1 ? "" : "s"}` }));
        tooltip.hidden = false;
        const left = Math.min(width - 160, Math.max(0, x + barWidth / 2 - 70));
        tooltip.style.left = `${left}px`;
        tooltip.style.top = `${Math.max(0, barTop - 58)}px`;
      };
      const hide = () => {
        root.classList.remove("is-hovering");
        tooltip.hidden = true;
      };
      hit.addEventListener("pointerenter", show);
      hit.addEventListener("focus", show);
      hit.addEventListener("pointerleave", hide);
      hit.addEventListener("blur", hide);
    });
    root.querySelector("svg")?.remove();
    root.prepend(svg);
  }

  root.append(
    tooltip,
    h("details", { class: "table-view" }, h("summary", { text: "View as table" }),
      h("table", { class: "data" },
        h("thead", {}, h("tr", {}, h("th", { text: "Day" }), h("th", { class: "num", text: "Orders" }), h("th", { class: "num", text: "Revenue" }))),
        h("tbody", {}, ...days.map((day) => h("tr", {}, h("td", { text: label(day.date) }), h("td", { class: "num", text: String(day.orders) }), h("td", { class: "num", text: cash(day.revenue) }))))
      )
    )
  );
  let frame;
  new ResizeObserver(() => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(render);
  }).observe(root);
  return root;
}

// ---------- Views ----------

async function viewDashboard(main) {
  const data = await api("/api/admin/dashboard");
  const change = data.revenuePrevious30 ? Math.round(((data.revenue30 - data.revenuePrevious30) / data.revenuePrevious30) * 100) : null;
  const tile = (label, value, delta, direction = "") => h("div", { class: "card tile" }, h("p", { class: "label", text: label }), h("p", { class: "value", text: value }), delta ? h("p", { class: `delta ${direction}`, text: delta }) : null);
  const recentOrders = dataTable(
    [
      { label: "Order", cell: (order) => [order.number, h("span", { class: "sub", text: dateTime(order.createdAt) })] },
      { label: "Customer", cell: (order) => order.customer.name },
      { label: "Total", class: "num", cell: (order) => cash(order.total) },
      { label: "Status", cell: (order) => pill(order.status, ORDER_LABELS[order.status]) }
    ],
    data.recentOrders,
    { onRowClick: (order) => (location.hash = `#orders/${order.id}`), empty: "No orders yet." }
  );
  const recentEnquiries = dataTable(
    [
      { label: "Customer", cell: (enquiry) => [enquiry.customer.name || (enquiry.customer.username ? `@${enquiry.customer.username}` : "Telegram user"), h("span", { class: "sub", text: `${enquiry.source === "telegram" ? "Telegram" : "Website"} · ${dateTime(enquiry.createdAt)}` })] },
      { label: "Vehicle", cell: (enquiry) => enquiry.vehicle?.name ?? "—" },
      { label: "Status", cell: (enquiry) => pill(enquiry.status, ENQUIRY_LABELS[enquiry.status]) }
    ],
    data.recentEnquiries,
    { onRowClick: (enquiry) => (location.hash = `#enquiries/${enquiry.id}`), empty: "No enquiries yet." }
  );
  main.replaceChildren(
    pageHead("Dashboard", `Welcome back. Here's how ${state.businessName} is doing.`),
    h("div", { class: "grid grid-4" },
      tile("Revenue, last 30 days", cash(data.revenue30), change === null ? "No sales in the 30 days before" : `${change >= 0 ? "+" : ""}${change}% vs previous 30 days`, change === null ? "" : change >= 0 ? "up" : "down"),
      tile("Orders, last 30 days", String(data.orders30), `${data.openOrders} open`),
      tile("New enquiries", String(data.newEnquiries), `${data.enquiries30} in the last 30 days`),
      tile("Catalogue", `${data.counts.vehicles} vehicles`, `${data.counts.products} products · ${data.counts.ecus} ECUs`)
    ),
    h("div", { class: "grid grid-4", style: { marginTop: "16px" } },
      tile("New file orders", String(data.newFileOrders), "Waiting to be started"),
      tile("Payments to check", String(data.paymentsToCheck), "UPI references sent by customers"),
      tile("Franchise applications", String(data.newFranchiseLeads), "New, from the franchise page")
    ),
    h("div", { class: "grid grid-main", style: { marginTop: "16px" } },
      h("section", { class: "card" }, h("div", { class: "card-head" }, h("h2", { text: "Revenue, last 14 days" }), h("p", { text: `${state.currency}, excluding cancelled orders` })), barChart(data.daily)),
      h("section", { class: "card" }, h("div", { class: "card-head" }, h("h2", { text: "Low stock" }), h("a", { href: "#products", text: "Products" })),
        data.lowStock.length
          ? h("ul", { class: "list" }, ...data.lowStock.map((product) => h("li", {}, h("a", { href: `#products/${product.id}`, text: product.name }), pill(product.stock ? "low" : "out", product.stock ? `${product.stock} left` : "Sold out"))))
          : h("p", { class: "empty", text: "Everything is well stocked." })
      )
    ),
    h("div", { class: "grid grid-2", style: { marginTop: "16px" } },
      h("section", { class: "card" }, h("div", { class: "card-head" }, h("h2", { text: "Recent orders" }), h("a", { href: "#orders", text: "All orders" })), recentOrders),
      h("section", { class: "card" }, h("div", { class: "card-head" }, h("h2", { text: "Recent enquiries" }), h("a", { href: "#enquiries", text: "All enquiries" })), recentEnquiries)
    )
  );
}

function statusFilter(labels, items, onChange) {
  let active = "all";
  const chips = h("div", { class: "chips" });
  const draw = () =>
    chips.replaceChildren(
      ...[["all", "All", items.length], ...Object.entries(labels).map(([key, label]) => [key, label, items.filter((item) => item.status === key).length])].map(([key, label, count]) =>
        h("button", { class: "chip", type: "button", "aria-pressed": String(active === key), text: `${label} ${count}`, onclick: () => ((active = key), draw(), onChange(key)) })
      )
    );
  draw();
  return chips;
}

function statusSelect(labels, value, onChange) {
  const select = h("select", { class: "inline-select", "aria-label": "Status" }, ...Object.entries(labels).map(([key, label]) => h("option", { value: key, text: label, selected: key === value })));
  select.addEventListener("change", () => onChange(select.value, select));
  return isolate(select);
}

function listView({ main, title, subtitle, items, labels, columns, search, detail, empty }) {
  let status = "all";
  const input = h("input", { type: "search", placeholder: "Search", "aria-label": `Search ${title.toLowerCase()}` });
  const holder = h("div");
  const draw = () => {
    const query = input.value.trim().toLowerCase();
    const rows = items.filter((item) => (status === "all" || item.status === status) && (!query || search(item).toLowerCase().includes(query)));
    holder.replaceChildren(dataTable(columns, rows, { onRowClick: detail, empty }));
  };
  input.addEventListener("input", draw);
  main.replaceChildren(pageHead(title, subtitle), h("div", { class: "toolbar" }, input, statusFilter(labels, items, (key) => ((status = key), draw()))), holder);
  draw();
}

async function viewOrders(main, id) {
  const { items } = await api("/api/admin/orders");
  const update = async (order, changes) => {
    const { item } = await api(`/api/admin/orders/${order.id}`, { method: "PATCH", body: changes });
    Object.assign(order, item);
    toast(`Order ${order.number} updated`);
    refreshBadges();
  };
  const detail = (order) => {
    const notes = h("textarea", { rows: 3, "aria-label": "Private notes" });
    notes.value = order.adminNotes ?? "";
    const status = statusSelect(ORDER_LABELS, order.status, () => {});
    const phone = digits(order.customer.phone);
    const body = h("div", {},
      h("dl", { class: "detail-grid" },
        h("dt", { text: "Placed" }), h("dd", { text: dateTime(order.createdAt) }),
        h("dt", { text: "Customer" }), h("dd", { text: order.customer.name }),
        h("dt", { text: "Phone" }), h("dd", {}, h("a", { href: `tel:${phone}`, text: order.customer.phone }), " · ", h("a", { href: `https://wa.me/${phone}`, target: "_blank", rel: "noopener", text: "WhatsApp" })),
        order.customer.email ? [h("dt", { text: "Email" }), h("dd", {}, h("a", { href: `mailto:${order.customer.email}`, text: order.customer.email }))] : null,
        h("dt", { text: "Fulfilment" }), h("dd", { text: order.fulfilment === "delivery" ? `Delivery to ${order.address}` : "Collection" }),
        order.note ? [h("dt", { text: "Customer note" }), h("dd", { text: order.note })] : null,
        h("dt", { text: "Status" }), h("dd", {}, status)
      ),
      h("div", { class: "table-wrap", style: { marginTop: "18px" } },
        h("table", { class: "data" },
          h("thead", {}, h("tr", {}, h("th", { text: "Item" }), h("th", { class: "num", text: "Qty" }), h("th", { class: "num", text: "Price" }), h("th", { class: "num", text: "Total" }))),
          h("tbody", {},
            ...order.items.map((item) => h("tr", {}, h("td", { text: item.name }), h("td", { class: "num", text: String(item.qty) }), h("td", { class: "num", text: money(item.price, order.currency) }), h("td", { class: "num", text: money(item.lineTotal, order.currency) }))),
            order.deliveryFee ? h("tr", {}, h("td", { text: "Delivery" }), h("td"), h("td"), h("td", { class: "num", text: money(order.deliveryFee, order.currency) })) : null,
            h("tr", {}, h("th", { text: "Total" }), h("td"), h("td"), h("th", { class: "num", text: money(order.total, order.currency) }))
          )
        )
      ),
      h("label", { class: "field", style: { marginTop: "18px" } }, h("span", { text: "Private notes (only admins see these)" }), notes),
      h("p", { class: "help", style: { marginTop: "8px", color: "var(--muted)", fontSize: "12px" }, text: "Cancelling an order returns its items to stock." })
    );
    const remove = h("button", { class: "btn btn-danger spacer", type: "button", text: "Delete" });
    const save = h("button", { class: "btn btn-primary", type: "button", text: "Save" });
    const dialog = modal({ title: `Order ${order.number}`, body, footer: [remove, save], wide: true });
    save.addEventListener("click", async () => {
      try {
        await update(order, { status: status.value, adminNotes: notes.value });
        dialog.close();
        viewOrders(main);
      } catch (error) {
        reportError(error);
      }
    });
    remove.addEventListener("click", async () => {
      if (!(await confirmDialog(`Delete order ${order.number}? Stock isn't changed; cancel the order first to return items to stock.`))) return;
      try {
        await api(`/api/admin/orders/${order.id}`, { method: "DELETE" });
        dialog.close();
        toast(`Order ${order.number} deleted`);
        viewOrders(main);
      } catch (error) {
        reportError(error);
      }
    });
  };
  listView({
    main,
    title: "Orders",
    subtitle: "Orders placed in the website shop.",
    items,
    labels: ORDER_LABELS,
    empty: "No orders yet.",
    search: (order) => `${order.number} ${order.customer.name} ${order.customer.phone} ${order.items.map((item) => item.name).join(" ")}`,
    detail,
    columns: [
      { label: "Order", cell: (order) => [order.number, h("span", { class: "sub", text: dateTime(order.createdAt) })] },
      { label: "Customer", cell: (order) => [order.customer.name, h("span", { class: "sub", text: order.customer.phone })] },
      { label: "Items", cell: (order) => `${order.items.reduce((sum, item) => sum + item.qty, 0)} × ${order.items[0]?.name ?? ""}${order.items.length > 1 ? " …" : ""}` },
      { label: "Fulfilment", cell: (order) => (order.fulfilment === "delivery" ? "Delivery" : "Collection") },
      { label: "Total", class: "num", cell: (order) => money(order.total, order.currency) },
      { label: "Status", cell: (order) => statusSelect(ORDER_LABELS, order.status, (value, select) => update(order, { status: value }).catch((error) => ((select.value = order.status), reportError(error)))) }
    ]
  });
  const open = items.find((order) => order.id === id);
  if (open) detail(open);
}

async function viewEnquiries(main, id) {
  const [{ items }, { items: ecus }] = await Promise.all([api("/api/admin/enquiries"), api("/api/admin/ecus")]);
  const ecuName = (ecuId) => (ecuId === "unknown" ? "Not sure" : ecus.find((ecu) => ecu.id === ecuId)?.title ?? (ecuId || "—"));
  const who = (enquiry) => enquiry.customer.name || (enquiry.customer.username ? `@${enquiry.customer.username}` : "Telegram user");
  const update = async (enquiry, changes) => {
    const { item } = await api(`/api/admin/enquiries/${enquiry.id}`, { method: "PATCH", body: changes });
    Object.assign(enquiry, item);
    toast("Enquiry updated");
    refreshBadges();
  };
  const detail = (enquiry) => {
    const notes = h("textarea", { rows: 3, "aria-label": "Private notes" });
    notes.value = enquiry.notes ?? "";
    const status = statusSelect(ENQUIRY_LABELS, enquiry.status, () => {});
    const phone = digits(enquiry.customer.phone);
    const contact = [];
    if (phone) contact.push(h("a", { href: `tel:${phone}`, text: enquiry.customer.phone }), " · ", h("a", { href: `https://wa.me/${phone}`, target: "_blank", rel: "noopener", text: "WhatsApp" }));
    if (enquiry.customer.username) contact.push(phone ? " · " : "", h("a", { href: `https://t.me/${enquiry.customer.username}`, target: "_blank", rel: "noopener", text: `@${enquiry.customer.username} on Telegram` }));
    const vehicle = enquiry.vehicle;
    const locationLink = /^https:\/\/maps\.google\.com\/\?q=[-\d.,]+$/.test(enquiry.location) ? h("a", { href: enquiry.location, target: "_blank", rel: "noopener", text: "Open map" }) : enquiry.location || "—";
    const body = h("div", {},
      h("dl", { class: "detail-grid" },
        h("dt", { text: "Received" }), h("dd", { text: `${dateTime(enquiry.createdAt)} via ${enquiry.source === "telegram" ? "Telegram bot" : "website"}` }),
        h("dt", { text: "Customer" }), h("dd", { text: who(enquiry) }),
        h("dt", { text: "Contact" }), h("dd", {}, ...(contact.length ? contact : ["—"])),
        h("dt", { text: "Vehicle" }), h("dd", { text: vehicle ? `${vehicle.name}${vehicle.years ? ` (${vehicle.years})` : ""}${vehicle.source === "ai" ? " · AI estimate" : ""}` : "—" }),
        vehicle?.stage1 ? [h("dt", { text: `Stage ${vehicle.stage ?? 1}` }), h("dd", { text: `${vehicle.stock.hp} → ${(vehicle.target ?? vehicle.stage1).hp} hp · ${vehicle.stock.nm} → ${(vehicle.target ?? vehicle.stage1).nm} Nm` })] : null,
        h("dt", { text: "ECU" }), h("dd", { text: ecuName(enquiry.ecu) }),
        h("dt", { text: "Location" }), h("dd", {}, locationLink),
        enquiry.message ? [h("dt", { text: "Message" }), h("dd", { text: enquiry.message })] : null,
        h("dt", { text: "Status" }), h("dd", {}, status)
      ),
      h("label", { class: "field", style: { marginTop: "18px" } }, h("span", { text: "Private notes" }), notes)
    );
    const remove = h("button", { class: "btn btn-danger spacer", type: "button", text: "Delete" });
    const save = h("button", { class: "btn btn-primary", type: "button", text: "Save" });
    const dialog = modal({ title: `Enquiry from ${who(enquiry)}`, body, footer: [remove, save], wide: true });
    save.addEventListener("click", async () => {
      try {
        await update(enquiry, { status: status.value, notes: notes.value });
        dialog.close();
        viewEnquiries(main);
      } catch (error) {
        reportError(error);
      }
    });
    remove.addEventListener("click", async () => {
      if (!(await confirmDialog("Delete this enquiry?"))) return;
      try {
        await api(`/api/admin/enquiries/${enquiry.id}`, { method: "DELETE" });
        dialog.close();
        toast("Enquiry deleted");
        viewEnquiries(main);
      } catch (error) {
        reportError(error);
      }
    });
  };
  listView({
    main,
    title: "Enquiries",
    subtitle: "Stage 1 enquiries from the website and the Telegram bot.",
    items,
    labels: ENQUIRY_LABELS,
    empty: "No enquiries yet.",
    search: (enquiry) => `${who(enquiry)} ${enquiry.customer.phone ?? ""} ${enquiry.vehicle?.name ?? ""} ${enquiry.location}`,
    detail,
    columns: [
      { label: "Received", cell: (enquiry) => [dateTime(enquiry.createdAt), h("span", { class: "sub", text: enquiry.source === "telegram" ? "Telegram bot" : "Website" })] },
      { label: "Customer", cell: (enquiry) => [who(enquiry), h("span", { class: "sub", text: enquiry.customer.phone || (enquiry.customer.username ? "Telegram" : "") })] },
      { label: "Vehicle", cell: (enquiry) => [enquiry.vehicle?.name ?? "—", enquiry.vehicle?.stage1 ? h("span", { class: "sub", text: `Stage ${enquiry.vehicle.stage ?? 1}: ${enquiry.vehicle.stock.hp} → ${(enquiry.vehicle.target ?? enquiry.vehicle.stage1).hp} hp` }) : null] },
      { label: "ECU", cell: (enquiry) => ecuName(enquiry.ecu) },
      { label: "Status", cell: (enquiry) => statusSelect(ENQUIRY_LABELS, enquiry.status, (value, select) => update(enquiry, { status: value }).catch((error) => ((select.value = enquiry.status), reportError(error)))) }
    ]
  });
  const open = items.find((enquiry) => enquiry.id === id);
  if (open) detail(open);
}

// Franchise applications from /franchise.
async function viewFranchise(main, id) {
  const { items } = await api("/api/admin/franchise");
  const { backgrounds } = await api("/api/franchise");
  const update = async (lead, changes) => {
    const { item } = await api(`/api/admin/franchise/${lead.id}`, { method: "PATCH", body: changes });
    Object.assign(lead, item);
    toast("Application updated");
    refreshBadges();
  };
  const packageText = (lead) => (lead.package ? `${lead.package.name} · ${lakh(lead.package.price)}` : "Not sure yet");
  const detail = (lead) => {
    const notes = h("textarea", { rows: 4, "aria-label": "Private notes" });
    notes.value = lead.notes ?? "";
    const status = statusSelect(FRANCHISE_LABELS, lead.status, () => {});
    const phone = digits(lead.phone);
    const body = h("div", {},
      h("dl", { class: "detail-grid" },
        h("dt", { text: "Received" }), h("dd", { text: dateTime(lead.createdAt) }),
        h("dt", { text: "Name" }), h("dd", { text: lead.name }),
        h("dt", { text: "Contact" }), h("dd", {},
          h("a", { href: `tel:${phone}`, text: lead.phone }), " · ", h("a", { href: `https://wa.me/${phone}`, target: "_blank", rel: "noopener", text: "WhatsApp" }),
          ...(lead.email ? [" · ", h("a", { href: `mailto:${lead.email}`, text: lead.email })] : [])
        ),
        h("dt", { text: "City" }), h("dd", { text: lead.city }),
        h("dt", { text: "Package" }), h("dd", { text: packageText(lead) }),
        h("dt", { text: "Today" }), h("dd", { text: backgrounds[lead.background] ?? "—" }),
        lead.message ? [h("dt", { text: "Message" }), h("dd", { text: lead.message })] : null,
        h("dt", { text: "Status" }), h("dd", {}, status)
      ),
      h("label", { class: "field", style: { marginTop: "18px" } }, h("span", { text: "Private notes" }), notes)
    );
    const remove = h("button", { class: "btn btn-danger spacer", type: "button", text: "Delete" });
    const save = h("button", { class: "btn btn-primary", type: "button", text: "Save" });
    const dialog = modal({ title: `Franchise application from ${lead.name}`, body, footer: [remove, save], wide: true });
    save.addEventListener("click", async () => {
      try {
        await update(lead, { status: status.value, notes: notes.value });
        dialog.close();
        viewFranchise(main);
      } catch (error) {
        reportError(error);
      }
    });
    remove.addEventListener("click", async () => {
      if (!(await confirmDialog("Delete this application?"))) return;
      try {
        await api(`/api/admin/franchise/${lead.id}`, { method: "DELETE" });
        dialog.close();
        toast("Application deleted");
        viewFranchise(main);
      } catch (error) {
        reportError(error);
      }
    });
  };
  listView({
    main,
    title: "Franchise",
    subtitle: "Applications from the franchise page. Packages and the \u201cgood to know\u201d list are in Franchise packages and Settings.",
    items,
    labels: FRANCHISE_LABELS,
    empty: "No franchise applications yet.",
    search: (lead) => `${lead.name} ${lead.phone} ${lead.email} ${lead.city} ${lead.package?.name ?? ""}`,
    detail,
    columns: [
      { label: "Received", cell: (lead) => dateTime(lead.createdAt) },
      { label: "Applicant", cell: (lead) => [lead.name, h("span", { class: "sub", text: lead.phone })] },
      { label: "City", cell: (lead) => lead.city },
      { label: "Package", cell: (lead) => packageText(lead) },
      { label: "Status", cell: (lead) => statusSelect(FRANCHISE_LABELS, lead.status, (value, select) => update(lead, { status: value }).catch((error) => ((select.value = lead.status), reportError(error)))) }
    ]
  });
  const open = items.find((lead) => lead.id === id);
  if (open) detail(open);
}

// Products, vehicles, ECUs, brands, services and photos share one list-and-form screen.
async function collectionView(main, id, config) {
  const { items } = await api(`/api/admin/${config.name}`);
  const context = config.load ? await config.load() : {};
  const fields = config.fields(context, items);
  const edit = (item, defaults = config.defaults, title = `New ${config.singular}`) =>
    formModal({
      title: item ? `Edit ${config.label(item)}` : title,
      fields,
      values: item ? config.toForm?.(item) ?? item : defaults ?? {},
      before: item && config.before ? config.before(item) : null,
      onSubmit: async (values) => {
        await api(item ? `/api/admin/${config.name}/${item.id}` : `/api/admin/${config.name}`, { method: item ? "PUT" : "POST", body: values });
        toast(item ? "Saved" : `${config.singular[0].toUpperCase()}${config.singular.slice(1)} added`);
        collectionView(main, null, config);
      },
      onDelete: item
        ? async () => {
            await api(`/api/admin/${config.name}/${item.id}`, { method: "DELETE" });
            toast("Deleted");
            collectionView(main, null, config);
          }
        : null
    });
  const input = h("input", { type: "search", placeholder: "Search", "aria-label": `Search ${config.title.toLowerCase()}` });
  const holder = h("div");
  const draw = () => {
    const query = input.value.trim().toLowerCase();
    const rows = items.filter((item) => !query || config.search(item, context).toLowerCase().includes(query));
    holder.replaceChildren(dataTable(config.columns(context, items), rows, { onRowClick: (item) => edit(item), empty: `No ${config.title.toLowerCase()} yet.` }));
  };
  input.addEventListener("input", draw);
  main.replaceChildren(
    pageHead(
      config.title,
      config.subtitle,
      ...(config.newButtons ?? [[`New ${config.singular}`, config.defaults]]).map(([label, defaults], index) =>
        h("button", { class: `btn${index === 0 ? " btn-primary" : ""}`, type: "button", text: label, onclick: () => edit(null, defaults, label) })
      )
    ),
    h("div", { class: "toolbar" }, input),
    holder
  );
  draw();
  const open = items.find((item) => item.id === id);
  if (open) edit(open);
}

const COLLECTION_VIEWS = {
  products: {
    name: "products",
    title: "Products",
    singular: "product",
    subtitle: "Everything in the website shop.",
    label: (product) => product.name,
    defaults: { active: true, featured: false },
    search: (product) => `${product.name} ${product.category}`,
    fields: (_, items) => [
      { name: "name", label: "Name", full: true },
      { name: "category", label: "Category", list: [...new Set(items.map((item) => item.category))] },
      { name: "price", label: `Price (${state.currency})`, type: "number", step: "0.01", min: "0" },
      { name: "compareAtPrice", label: "Compare-at price", type: "number", step: "0.01", min: "0", help: "Optional. Shows the price crossed out as an offer." },
      { name: "stock", label: "Stock", type: "number", step: "1", min: "0", help: "Leave empty for unlimited (services, vouchers)." },
      { name: "description", label: "Description", type: "textarea", full: true, rows: 4 },
      { name: "features", label: "Features", type: "lines", full: true, help: "One per line." },
      { name: "image", label: "Photo", type: "image", full: true, help: "PNG, JPEG or WebP, up to 5 MB. Without a photo the shop shows an illustration." },
      { name: "featured", label: "Feature on the home page", type: "checkbox" },
      { name: "active", label: "Show in the shop", type: "checkbox" }
    ],
    columns: () => [
      { label: "", cell: (product) => (product.image ? h("img", { class: "thumb", src: product.image, alt: "" }) : productArt(product.category)) },
      { label: "Product", cell: (product) => [product.name, h("span", { class: "sub", text: product.category })] },
      { label: "Price", class: "num", cell: (product) => [cash(product.price), product.compareAtPrice ? h("span", { class: "sub", text: `was ${cash(product.compareAtPrice)}` }) : null] },
      { label: "Stock", cell: (product) => (product.stock === null ? "Unlimited" : product.stock === 0 ? pill("out", "Sold out") : product.stock <= 3 ? pill("low", `${product.stock} left`) : String(product.stock)) },
      { label: "Visibility", cell: (product) => [pill(product.active ? "active" : "hidden", product.active ? "In shop" : "Hidden"), product.featured ? h("span", { class: "sub", text: "Featured" }) : null] }
    ]
  },
  vehicles: {
    name: "vehicles",
    title: "Vehicles",
    singular: "vehicle",
    subtitle: "The Stage 1 database behind the website finder, the Telegram bot and the graphs.",
    label: (vehicle) => `${vehicle.model} ${vehicle.generation}`.trim(),
    defaults: { fuel: "petrol", aspiration: "turbo", ecus: [] },
    load: async () => {
      const [{ items: brands }, { items: ecus }] = await Promise.all([api("/api/admin/brands"), api("/api/admin/ecus")]);
      return { brands, ecus };
    },
    search: (vehicle, { brands }) => `${brands.find((brand) => brand.id === vehicle.brand)?.title ?? ""} ${vehicle.model} ${vehicle.generation} ${vehicle.engine} ${vehicle.keywords}`,
    // Preview of the saved graphs, with a switch for each stage the vehicle has.
    before: (vehicle) => {
      const stages = [1, 2, 3].filter((stage) => stage === 1 || vehicle[`stage${stage}Hp`] !== "");
      const src = (stage) => `/api/vehicles/${encodeURIComponent(vehicle.id)}/graph.png?stage=${stage}&v=${encodeURIComponent(vehicle.updatedAt ?? "")}`;
      const image = h("img", { class: "graph-preview", src: src(1), alt: `Current Stage 1 graph for ${vehicle.model}` });
      const tabs = h("div", { class: "chips" });
      if (stages.length > 1) {
        tabs.append(
          ...stages.map((stage) =>
            h("button", {
              class: "chip",
              type: "button",
              "aria-pressed": String(stage === 1),
              text: `Stage ${stage}`,
              onclick: (event) => {
                image.src = src(stage);
                image.alt = `Current Stage ${stage} graph for ${vehicle.model}`;
                for (const chip of tabs.children) chip.setAttribute("aria-pressed", String(chip === event.currentTarget));
              }
            })
          )
        );
      }
      return h("div", { class: "full" }, tabs, image);
    },
    fields: ({ brands, ecus }) => [
      { name: "brand", label: "Brand", type: "select", options: brands.map((brand) => [brand.id, brand.title]) },
      { name: "model", label: "Model", placeholder: "Golf GTI" },
      { name: "generation", label: "Generation", placeholder: "Mk7" },
      { name: "engine", label: "Engine", placeholder: "2.0 TSI (EA888 Gen3)" },
      { name: "fuel", label: "Fuel", type: "select", options: Object.entries(FUEL_LABELS) },
      { name: "aspiration", label: "Aspiration", type: "select", options: Object.entries(ASPIRATION_LABELS), help: "Diesels are always treated as turbo." },
      { name: "yearFrom", label: "Year from", type: "number", step: "1" },
      { name: "yearTo", label: "Year to", type: "number", step: "1", help: "Leave empty if still in production." },
      { name: "stockHp", label: "Stock power (hp)", type: "number", step: "1" },
      { name: "stockNm", label: "Stock torque (Nm)", type: "number", step: "1" },
      { name: "stage1Hp", label: "Stage 1 power (hp)", type: "number", step: "1" },
      { name: "stage1Nm", label: "Stage 1 torque (Nm)", type: "number", step: "1" },
      { name: "stage2Hp", label: "Stage 2 power (hp)", type: "number", step: "1", help: "Optional. Leave Stage 2 and 3 empty if you don't offer them." },
      { name: "stage2Nm", label: "Stage 2 torque (Nm)", type: "number", step: "1" },
      { name: "stage3Hp", label: "Stage 3 power (hp)", type: "number", step: "1", help: "Optional. Needs Stage 2 figures." },
      { name: "stage3Nm", label: "Stage 3 torque (Nm)", type: "number", step: "1" },
      { name: "ecus", label: "ECUs commonly fitted", type: "checkboxes", full: true, options: ecus.map((ecu) => [ecu.id, ecu.title]), help: "Starred for customers in the ECU check." },
      { name: "keywords", label: "Extra search words", full: true, placeholder: "golf7 mk7 gti", help: "Other names customers might type." },
      { name: "redline", label: "Redline (rpm)", type: "number", step: "100", help: "Optional. Shapes the graph for high-revving engines." },
      { name: "torqueFrom", label: "Peak torque from (rpm)", type: "number", step: "50", help: "Optional." }
    ],
    columns: ({ brands }) => [
      { label: "Vehicle", cell: (vehicle) => [`${brands.find((brand) => brand.id === vehicle.brand)?.title ?? vehicle.brand} ${vehicle.model} ${vehicle.generation}`, h("span", { class: "sub", text: vehicle.engine })] },
      { label: "Years", cell: (vehicle) => (vehicle.yearTo ? `${vehicle.yearFrom}–${vehicle.yearTo}` : `${vehicle.yearFrom}+`) },
      { label: "Fuel", cell: (vehicle) => FUEL_LABELS[vehicle.fuel] },
      { label: "Stock", class: "num", cell: (vehicle) => [`${vehicle.stockHp} hp`, h("span", { class: "sub", text: `${vehicle.stockNm} Nm` })] },
      { label: "Stage 1", class: "num", cell: (vehicle) => [`${vehicle.stage1Hp} hp`, h("span", { class: "sub", text: `+${Math.round((vehicle.stage1Hp / vehicle.stockHp - 1) * 100)}% · ${vehicle.stage1Nm} Nm` })] },
      { label: "Stages", cell: (vehicle) => [1, 2, 3].filter((stage) => stage === 1 || vehicle[`stage${stage}Hp`] !== "").join(" · ") }
    ]
  },
  ecus: {
    name: "ecus",
    title: "ECUs",
    singular: "ECU",
    subtitle: "The ECU check in the bot, the website's ECU list and the Tool support page use this list.",
    label: (ecu) => ecu.title,
    defaults: { fuels: ["petrol"], status: "supported", autotuner: [], kess3: [] },
    toForm: (ecu) => ({ ...ecu, autotuner: ecu.tools?.autotuner ?? [], kess3: ecu.tools?.kess3 ?? [] }),
    search: (ecu) => `${ecu.title} ${ecu.method}`,
    fields: () => [
      { name: "title", label: "Name", full: true, placeholder: "Bosch MG1" },
      { name: "fuels", label: "Fuels", type: "checkboxes", full: true, options: Object.entries(FUEL_LABELS) },
      { name: "status", label: "Support", type: "select", options: Object.entries(ECU_LABELS) },
      { name: "method", label: "Method", placeholder: "OBD flash, no ECU removal" },
      { name: "autotuner", label: "Autotuner reads it by", type: "checkboxes", full: true, options: Object.entries(READ_LABELS), help: "Shown on the Tool support page and in the bot. Leave all unticked if Autotuner doesn't read it." },
      { name: "kess3", label: "KESS3 reads it by", type: "checkboxes", full: true, options: Object.entries(READ_LABELS) }
    ],
    columns: () => [
      { label: "ECU", cell: (ecu) => ecu.title },
      { label: "Fuels", cell: (ecu) => ecu.fuels.map((fuel) => FUEL_LABELS[fuel]).join(", ") },
      { label: "Support", cell: (ecu) => pill(ecu.status, ECU_LABELS[ecu.status]) },
      { label: "Autotuner", cell: (ecu) => readMethods(ecu.tools?.autotuner) },
      { label: "KESS3", cell: (ecu) => readMethods(ecu.tools?.kess3) }
    ]
  },
  brands: {
    name: "brands",
    title: "Brands",
    singular: "brand",
    subtitle: "Brands for Browse by brand. Aliases help search match what customers type.",
    label: (brand) => brand.title,
    toForm: (brand) => ({ ...brand, aliases: brand.aliases.join(", ") }),
    search: (brand) => `${brand.title} ${brand.aliases.join(" ")}`,
    fields: () => [
      { name: "title", label: "Name", full: true },
      { name: "aliases", label: "Search aliases", full: true, placeholder: "vw, volks", help: "Comma separated." }
    ],
    columns: () => [
      { label: "Brand", cell: (brand) => brand.title },
      { label: "Aliases", cell: (brand) => brand.aliases.join(", ") || "—" }
    ]
  },
  services: {
    name: "services",
    title: "Services",
    singular: "service",
    subtitle: "Cards in the Services section of the home page.",
    label: (service) => service.title,
    defaults: { icon: "bolt", active: true },
    search: (service) => `${service.title} ${service.summary}`,
    fields: () => [
      { name: "title", label: "Title", full: true },
      { name: "summary", label: "Summary", type: "textarea", full: true },
      { name: "priceLabel", label: "Price label", placeholder: "From 350", help: "Leave empty to show “Ask for a quote”." },
      { name: "icon", label: "Icon", type: "select", options: Object.entries(ICONS) },
      { name: "active", label: "Show on the website", type: "checkbox" }
    ],
    columns: () => [
      { label: "Service", cell: (service) => [service.title, h("span", { class: "sub", text: service.summary })] },
      { label: "Price", cell: (service) => service.priceLabel || "Quote" },
      { label: "Visibility", cell: (service) => pill(service.active ? "active" : "hidden", service.active ? "Shown" : "Hidden") }
    ]
  },
  tuneOptions: {
    name: "tuneOptions",
    title: "Tune options",
    singular: "tune option",
    subtitle: "What a file order can include on the file service. Customers choose one tuning type, then press “+ Add options” to add options for that type, each at its price for that type.",
    label: (option) => option.name,
    defaults: { kind: "tune", credits: 1, active: true },
    newButtons: [
      ["New tuning type", { kind: "tune", credits: 1, active: true }],
      ["Add option", { kind: "addon", credits: 0.5, active: true, prices: {} }]
    ],
    search: (option) => `${option.name} ${option.description}`,
    fields: (_, items) => [
      { name: "name", label: "Name", full: true, placeholder: "Car tuning (Stage 1) or Launch control" },
      { name: "kind", label: "Type", type: "select", options: [["tune", "Tuning type (customers choose one)"], ["addon", "Option (added to a tuning type)"]] },
      { name: "credits", label: "Credits", type: "number", step: "0.01", min: "0", help: "Up to two decimals, e.g. 1.20. For an option, the price with any tuning type not set below." },
      { name: "description", label: "Description", type: "textarea", full: true, help: "One short line shown under the name." },
      {
        name: "prices",
        label: "Offered with, and its price for each",
        type: "prices",
        full: true,
        showIf: ["kind", "addon"],
        tunes: items.filter((item) => item.kind === "tune").map((item) => [item.id, item.name]),
        help: "Tick each tuning type this option goes with and set its price there. Leave all unticked to offer it with every tuning type at the credits above."
      },
      { name: "active", label: "Offer on the file service", type: "checkbox" }
    ],
    columns: (_, items) => {
      const tuneName = (id) => items?.find((item) => item.id === id)?.name ?? id;
      const prices = (option) => Object.values(option.prices ?? {});
      return [
        { label: "Option", cell: (option) => [option.name, h("span", { class: "sub", text: option.description })] },
        { label: "Type", cell: (option) => (option.kind === "tune" ? "Tuning type" : "Option") },
        {
          label: "Credits",
          class: "num",
          cell: (option) => {
            const list = prices(option);
            if (option.kind !== "addon" || !list.length) return creditNumber(option.credits);
            const [low, high] = [Math.min(...list), Math.max(...list)];
            return low === high ? creditNumber(low) : `${creditNumber(low)}–${creditNumber(high)}`;
          }
        },
        { label: "Offered with", cell: (option) => (option.kind !== "addon" ? "—" : Object.keys(option.prices ?? {}).length ? Object.keys(option.prices).map(tuneName).join(", ") : "All tuning types") },
        { label: "Visibility", cell: (option) => pill(option.active ? "active" : "hidden", option.active ? "Offered" : "Hidden") }
      ];
    }
  },
  creditPacks: {
    name: "creditPacks",
    title: "Credit packs",
    singular: "credit pack",
    subtitle: "What customers pay for credits on the file service. Until you add a pack, they're asked to buy credits on WhatsApp.",
    label: (pack) => pack.name,
    defaults: { credits: 5, active: true },
    search: (pack) => `${pack.name} ${pack.note}`,
    fields: () => [
      { name: "name", label: "Name", full: true, placeholder: "Tuner" },
      { name: "credits", label: "Credits", type: "number", step: "1", min: "1" },
      { name: "price", label: `Price (${state.currency})`, type: "number", step: "0.01", min: "1" },
      { name: "note", label: "Note", full: true, placeholder: "Best value for busy workshops", help: "Optional, shown under the price." },
      { name: "active", label: "Sell on the file service", type: "checkbox" }
    ],
    columns: () => [
      { label: "Pack", cell: (pack) => [pack.name, pack.note ? h("span", { class: "sub", text: pack.note }) : null] },
      { label: "Credits", class: "num", cell: (pack) => String(pack.credits) },
      { label: "Price", class: "num", cell: (pack) => [cash(pack.price), pack.credits > 1 ? h("span", { class: "sub", text: `${cash(Math.round((pack.price / pack.credits) * 100) / 100)} each` }) : null] },
      { label: "Visibility", cell: (pack) => pill(pack.active ? "active" : "hidden", pack.active ? "On sale" : "Hidden") }
    ]
  },
  franchisePackages: {
    name: "franchisePackages",
    title: "Franchise packages",
    singular: "franchise package",
    subtitle: "The packages on the franchise page (/franchise). Applications arrive under Franchise.",
    label: (entry) => entry.name,
    defaults: { active: true, featured: false, items: [] },
    search: (entry) => `${entry.name} ${entry.items.join(" ")}`,
    fields: () => [
      { name: "name", label: "Name", placeholder: "Standard" },
      { name: "price", label: "Price (₹)", type: "number", step: "1", min: "1", help: "In rupees, e.g. 999000 for ₹9.99 lakh." },
      { name: "items", label: "What's included", type: "lines", rows: 8, full: true, help: "One per line, e.g. 1 tuning tool." },
      { name: "note", label: "Note", full: true, help: "Optional, shown under the price." },
      { name: "featured", label: "Highlight this package", type: "checkbox" },
      { name: "active", label: "Show on the franchise page", type: "checkbox" }
    ],
    columns: () => [
      { label: "Package", cell: (entry) => [entry.name, entry.note ? h("span", { class: "sub", text: entry.note }) : null] },
      { label: "Price", class: "num", cell: (entry) => [lakh(entry.price), h("span", { class: "sub", text: `₹${entry.price.toLocaleString("en-IN")}` })] },
      { label: "Includes", cell: (entry) => `${entry.items.length} item${entry.items.length === 1 ? "" : "s"}` },
      { label: "Visibility", cell: (entry) => pill(entry.active ? "active" : "hidden", entry.active ? "Shown" : "Hidden") }
    ]
  },
  photos: {
    name: "photos",
    title: "Photos",
    singular: "photo",
    subtitle: "The Our work gallery on the home page, newest first. Add your best builds, for example the pictures you post on Instagram.",
    label: (photo) => photo.caption || "photo",
    defaults: { active: true },
    search: (photo) => `${photo.caption} ${photo.link}`,
    fields: () => [
      { name: "image", label: "Photo", type: "image", full: true, help: "PNG, JPEG or WebP, up to 5 MB. Portrait photos (3:4 or 4:5) fill the card best." },
      { name: "caption", label: "Caption", full: true, placeholder: "Polo GT TSI · Stage 1" },
      { name: "link", label: "Link", full: true, placeholder: "https://www.instagram.com/p/…", help: "Optional, e.g. the Instagram post. Without one, the photo opens your Instagram page." },
      { name: "active", label: "Show on the website", type: "checkbox" }
    ],
    columns: () => [
      { label: "", cell: (photo) => h("img", { class: "thumb", src: photo.image, alt: "" }) },
      { label: "Photo", cell: (photo) => [photo.caption || "No caption", photo.link ? h("span", { class: "sub", text: photo.link }) : null] },
      { label: "Visibility", cell: (photo) => pill(photo.active ? "active" : "hidden", photo.active ? "Shown" : "Hidden") }
    ]
  }
};

const SETTINGS_SECTIONS = [
  ["Business", [
    { name: "businessName", label: "Business name" },
    { name: "tagline", label: "Tagline" },
    { name: "ownerName", label: "Owner / founder name", help: "Shown in the About section on the home page and given to Google as the founder." },
    { name: "ownerTitle", label: "Owner's title", placeholder: "Founder", help: "For example Founder, Founder & lead tuner, or Owner." }
  ]],
  ["Home page", [
    { name: "heroTitle", label: "Headline" },
    { name: "announcement", label: "Announcement bar", help: "Optional message shown under the menu on every page." },
    { name: "heroSubtitle", label: "Sub-headline", type: "textarea", full: true },
    { name: "heroImage", label: "Hero photo", type: "image", full: true, help: "Optional. A wide photo of a car or your workshop works best." }
  ]],
  ["Contact & location", [
    { name: "whatsappNumber", label: "WhatsApp number", help: "International format, digits only, e.g. 94771234567." },
    { name: "telegramBot", label: "Telegram bot username", help: "Filled in automatically when the bot is running." },
    { name: "phone", label: "Phone", type: "tel" },
    { name: "email", label: "Email", type: "email" },
    { name: "address", label: "Address", full: true },
    { name: "latitude", label: "Latitude", type: "number", step: "any" },
    { name: "longitude", label: "Longitude", type: "number", step: "any" },
    { name: "hours", label: "Opening hours", full: true }
  ]],
  ["Shop", [
    { name: "currency", label: "Currency", help: "3-letter code, e.g. USD, EUR, LKR, AED." },
    { name: "deliveryFee", label: "Delivery fee", type: "number", step: "0.01", min: "0" },
    { name: "shopNote", label: "Payment note", type: "textarea", full: true }
  ]],
  ["File service", [
    { name: "fileServiceOpen", label: "Take new file orders", type: "checkbox", full: true },
    { name: "fileServiceNote", label: "Note on the customer's file list", type: "textarea", full: true, help: "For example your usual turnaround, or that you're away." },
    { name: "upiId", label: "UPI ID for credit payments", placeholder: "yourname@okaxis", help: "Customers pay this ID and send you the reference; you confirm in Payments. Needs the currency set to INR." },
    { name: "upiName", label: "UPI payee name", placeholder: "Unity Performance" },
    { name: "alertFiles", label: "Alert me about new file orders and UPI payments", type: "checkbox", full: true }
  ]],
  ["Franchise", [
    { name: "franchiseOpen", label: "Take franchise applications", type: "checkbox", full: true },
    { name: "franchiseTerms", label: "Good to know", type: "lines", rows: 6, full: true, help: "One per line, shown under the packages on the franchise page: training, agreement term and so on." }
  ]],
  ["Stage 2 & 3 descriptions", [
    { name: "stage2Note", label: "Stage 2: what's included", type: "textarea", full: true, help: "Shown with Stage 2 graphs on the website and in the bot." },
    { name: "stage3Note", label: "Stage 3: what's included", type: "textarea", full: true }
  ]],
  ["Alert settings", [
    { name: "alertOrders", label: "Alert me about new orders", type: "checkbox" },
    { name: "alertEnquiries", label: "Alert me about new enquiries", type: "checkbox" },
    { name: "siteUrl", label: "Website address", full: true, placeholder: "https://…", help: "Adds an “Open in admin” button to alerts. Filled in automatically on Render." }
  ]],
  ["Social links", [
    { name: "instagram", label: "Instagram", placeholder: "https://instagram.com/…" },
    { name: "facebook", label: "Facebook", placeholder: "https://facebook.com/…" },
    { name: "tiktok", label: "TikTok", placeholder: "https://tiktok.com/@…" },
    { name: "youtube", label: "YouTube", placeholder: "https://youtube.com/@…" }
  ]]
];

// Linked chats, a one-time link to connect another, and a test message.
async function alertsCard() {
  const card = h("section", { class: "card form-section" }, h("h2", { text: "Telegram alerts" }));
  const body = h("div");
  card.append(body);
  const run = (action) => async () => {
    try {
      await action();
    } catch (error) {
      reportError(error);
    }
  };
  async function draw() {
    const { chats, botUsername, botRunning } = await api("/api/admin/alerts");
    const linkArea = h("div");
    const list = chats.length
      ? h("ul", { class: "list" },
          ...chats.map((chat) =>
            h("li", {},
              h("span", {}, chat.name || "Telegram chat", h("span", { class: "sub", text: `${chat.username ? `@${chat.username} · ` : ""}linked ${dateTime(chat.linkedAt)}` })),
              h("button", {
                class: "btn btn-small btn-danger",
                type: "button",
                text: "Remove",
                onclick: run(async () => {
                  if (!(await confirmDialog(`Stop sending alerts to ${chat.name || "this chat"}?`, { confirmLabel: "Remove" }))) return;
                  await api(`/api/admin/alerts/${encodeURIComponent(chat.chatId)}`, { method: "DELETE" });
                  toast("Chat removed");
                  await draw();
                })
              })
            )
          ))
      : h("p", { class: "note", text: "No chats linked yet." });
    const connect = h("button", {
      class: "btn btn-primary",
      type: "button",
      text: "Connect a Telegram chat",
      disabled: !botRunning,
      onclick: run(async () => {
        const { code, url } = await api("/api/admin/alerts/link", { method: "POST" });
        linkArea.replaceChildren(
          h("p", { class: "note", text: "On the phone that should get alerts, open this link and press Start. It works once and expires in 15 minutes." }),
          h("div", { class: "toolbar" },
            h("a", { class: "btn", href: url, target: "_blank", rel: "noopener", text: `Open @${botUsername}` }),
            h("button", { class: "btn btn-link", type: "button", text: "Done: refresh the list", onclick: run(draw) })
          ),
          h("p", { class: "note", text: `Or send this message to @${botUsername}: /alerts ${code}` })
        );
      })
    });
    const test = h("button", {
      class: "btn",
      type: "button",
      text: "Send test alert",
      disabled: !botRunning || !chats.length,
      onclick: run(async () => {
        const { sent } = await api("/api/admin/alerts/test", { method: "POST" });
        toast(`Test alert sent to ${sent} chat${sent === 1 ? "" : "s"}`);
      })
    });
    body.replaceChildren(
      h("p", { class: "note", text: botRunning ? `Get a message from @${botUsername} the moment an order or enquiry arrives.` : "Alerts need the Telegram bot: set TELEGRAM_BOT_TOKEN on the server and restart it." }),
      list,
      h("div", { class: "toolbar", style: { marginTop: "14px", marginBottom: "0" } }, connect, test),
      linkArea
    );
  }
  await draw();
  return card;
}

async function viewSettings(main) {
  const { settings, effective } = await api("/api/admin/settings");
  const alerts = await alertsCard();
  const built = [];
  const sections = SETTINGS_SECTIONS.map(([title, fields]) =>
    h("section", { class: "card form-section" }, h("h2", { text: title }),
      h("div", { class: "form-grid" }, ...fields.map((field) => {
        const fromEnvironment = (settings[field.name] === "" || settings[field.name] === null) && effective[field.name] !== "" && effective[field.name] !== null;
        const item = buildField(fromEnvironment ? { ...field, placeholder: String(effective[field.name]), help: "Currently set on the server. Enter a value here to override it." } : field, settings[field.name]);
        built.push([field.name, item]);
        return item.element;
      }))
    )
  );
  const error = h("p", { class: "error", role: "alert", hidden: true });
  const save = h("button", { class: "btn btn-primary", type: "submit", text: "Save settings" });
  const form = h("form", { novalidate: true }, ...sections, error, h("div", { class: "toolbar" }, save));
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    error.hidden = true;
    save.disabled = true;
    try {
      const { settings: saved } = await api("/api/admin/settings", { method: "PUT", body: Object.fromEntries(built.map(([name, item]) => [name, item.read()])) });
      state.businessName = saved.businessName;
      state.currency = saved.currency;
      toast("Settings saved");
      renderShell();
    } catch (failure) {
      if (failure instanceof SignedOut) return;
      error.textContent = failure.message;
      error.hidden = false;
    } finally {
      save.disabled = false;
    }
  });
  main.replaceChildren(pageHead("Settings", "Business details, home page, contact, shop, file service, alerts and social links."), alerts, form);
}

function viewBackup(main) {
  const file = h("input", { type: "file", accept: "application/json,.json", class: "visually-hidden" });
  const restore = h("button", { class: "btn", type: "button", text: "Restore from backup…", onclick: () => file.click() });
  file.addEventListener("change", async () => {
    const chosen = file.files?.[0];
    file.value = "";
    if (!chosen) return;
    try {
      const backup = JSON.parse(await readFile(chosen, "text"));
      if (!(await confirmDialog(`Replace ALL current data with “${chosen.name}”? Orders, enquiries, products, vehicles and settings will be overwritten.`, { confirmLabel: "Replace everything" }))) return;
      await api("/api/admin/import", { method: "POST", body: backup });
      toast("Backup restored");
      await loadState();
      renderShell();
    } catch (error) {
      reportError(error instanceof SyntaxError ? new Error("That file isn't valid JSON.") : error);
    }
  });
  main.replaceChildren(
    pageHead("Backup", "Download everything, or restore a previous download."),
    h("div", { class: "grid grid-2" },
      h("section", { class: "card" }, h("h2", { text: "Download a backup" }), h("p", { style: { margin: "8px 0 16px", color: "var(--muted)" }, text: "Saves orders, enquiries, file service accounts (with their password hashes, so keep it private), credits, payments, file orders, products, vehicles, ECUs, brands, services, the photo list and settings as one JSON file. Uploaded images and ECU files themselves are not included." }), h("a", { class: "btn btn-primary", href: "/api/admin/export", download: "", text: "Download backup" })),
      h("section", { class: "card" }, h("h2", { text: "Restore" }), h("p", { style: { margin: "8px 0 16px", color: "var(--muted)" }, text: "Replaces all current data with a backup file from this panel. Download a fresh backup first." }), restore, file)
    )
  );
}

// ---------- Tuning file service ----------

const FILE_LABELS = { submitted: "New", in_progress: "In progress", completed: "Ready", rejected: "Rejected", cancelled: "Cancelled" };
const PAYMENT_LABELS = { awaiting_payment: "Awaiting payment", submitted: "To check", paid: "Paid", cancelled: "Cancelled" };
const LEDGER_LABELS = { purchase: "Credits bought", order: "File order", refund: "Refund", admin: "Adjustment" };
const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
// Credits can have two decimals: "1 credit", "1.20 credits".
const creditNumber = (amount) => (Number.isInteger(amount) ? String(amount) : amount.toFixed(2));
const creditText = (amount) => `${creditNumber(amount)} credit${amount === 1 ? "" : "s"}`;
const fileSize = (bytes) => (bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
const vehicleLine = (vehicle) => [vehicle.make, vehicle.model, vehicle.generation, vehicle.engine].filter(Boolean).join(" ");
const customerName = (record) => record.customer?.name ?? "Deleted customer";

// Files go up as the raw request body with their name in a header.
async function uploadFile(path, file) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "X-Requested-With": "unity-admin", "Content-Type": "application/octet-stream", "X-File-Name": encodeURIComponent(file.name) },
    body: file
  });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) {
    showLogin(data.error);
    throw new SignedOut(data.error);
  }
  if (!response.ok) throw new Error(data.error || "The upload didn't finish.");
  return data;
}

function whatsappCustomer(customer, text) {
  const phone = digits(customer?.phone);
  return phone.length >= 6 ? h("a", { href: `https://wa.me/${phone}?text=${encodeURIComponent(text)}`, target: "_blank", rel: "noopener", text: "WhatsApp" }) : null;
}

async function viewFileOrders(main, id) {
  const [{ items }, service] = await Promise.all([api("/api/admin/file-orders"), api("/api/admin/file-service")]);
  const label = (map, key) => map[key] ?? key;
  const detail = (order) => {
    const { vehicle, customer } = order;
    const closed = ["rejected", "cancelled"].includes(order.status);
    const status = h("select", { "aria-label": "Status", disabled: closed }, ...Object.entries(FILE_LABELS).map(([key, text]) => h("option", { value: key, text, selected: key === order.status })));
    const reference = h("input", { type: "text", maxlength: 60, placeholder: "e.g. 123456", "aria-label": "Their order number" });
    reference.value = order.provider?.reference ?? "";
    const message = h("textarea", { rows: 2, maxlength: 500, "aria-label": "Message to the customer" });
    message.value = order.message ?? "";
    const notes = h("textarea", { rows: 2, maxlength: 1000, "aria-label": "Private notes" });
    notes.value = order.adminNotes ?? "";
    const tunedInput = h("input", { type: "file", class: "visually-hidden" });
    const tunedButton = h("button", { class: "btn btn-primary btn-small", type: "button", text: order.tuned ? "Replace tuned file…" : "Upload tuned file…", disabled: closed });
    tunedButton.addEventListener("click", () => tunedInput.click());
    tunedInput.addEventListener("change", async () => {
      const file = tunedInput.files?.[0];
      tunedInput.value = "";
      if (!file) return;
      tunedButton.disabled = true;
      tunedButton.textContent = "Uploading…";
      try {
        await uploadFile(`/api/admin/file-orders/${order.id}/tuned`, file);
        toast(`${order.number} is ready for the customer`);
        dialog.close();
        viewFileOrders(main, order.id);
        refreshBadges();
      } catch (error) {
        reportError(error);
        tunedButton.disabled = false;
        tunedButton.textContent = "Upload tuned file…";
      }
    });
    const readyText = `Hi ${customer?.name?.split(" ")[0] ?? ""}, your tuned file ${order.number} (${vehicleLine(vehicle)}) is ready to download: ${location.origin}/files`;
    const body = h("div", {},
      h("dl", { class: "detail-grid" },
        h("dt", { text: "Placed" }), h("dd", { text: dateTime(order.createdAt) }),
        h("dt", { text: "Customer" }), h("dd", {}, customer ? h("a", { href: `#customers/${customer.id}`, text: customer.name }) : "Deleted customer", customer?.company ? ` · ${customer.company}` : ""),
        customer ? [h("dt", { text: "Contact" }), h("dd", {}, h("a", { href: `mailto:${customer.email}`, text: customer.email }), " · ", h("a", { href: `tel:${digits(customer.phone)}`, text: customer.phone }), " · ", whatsappCustomer(customer, `Hi ${customer.name.split(" ")[0]}, about your file ${order.number}: `))] : null,
        h("dt", { text: "Vehicle" }), h("dd", { text: [vehicleLine(vehicle), vehicle.type && vehicle.type !== "car" ? label(service.vehicleTypes, vehicle.type) : "", vehicle.year, vehicle.fuel ? label(service.fuels, vehicle.fuel) : "", vehicle.octane ? label(service.octanes, vehicle.octane) : "", vehicle.gearbox ? label(service.gearboxes, vehicle.gearbox) : "", vehicle.powerHp ? `${vehicle.powerHp} hp` : ""].filter(Boolean).join(" · ") }),
        vehicle.vin || vehicle.plate ? [h("dt", { text: "VIN / plate" }), h("dd", { text: [vehicle.vin, vehicle.plate].filter(Boolean).join(" · ") })] : null,
        vehicle.catalogId ? [h("dt", { text: "From our list" }), h("dd", {}, h("a", { href: `#vehicles/${vehicle.catalogId}`, text: vehicle.catalogId }))] : null,
        h("dt", { text: "ECU" }), h("dd", { text: [order.ecu || "Not given", order.hardwareNumber ? `HW ${order.hardwareNumber}` : "", order.softwareNumber ? `SW ${order.softwareNumber}` : "", order.ecuNumbers].filter(Boolean).join(" · ") }),
        h("dt", { text: "Read with" }), h("dd", { text: `${label(service.tools, order.tool)} (${label(service.toolModes, order.toolMode)}) · ${label(service.readMethods, order.readMethod)}` }),
        order.timeFrame ? [h("dt", { text: "Time frame" }), h("dd", {}, h("b", { text: label(service.timeFrames, order.timeFrame) }))] : null,
        order.modifiedParts ? [h("dt", { text: "Modified parts" }), h("dd", { text: label(service.modifiedParts, order.modifiedParts) })] : null,
        h("dt", { text: "Tune" }), h("dd", { text: `${order.options.map((option) => `${option.name} (${creditNumber(option.credits)})`).join(" + ")} = ${creditText(order.credits)}${order.refunded ? " · refunded" : ""}` }),
        order.notes ? [h("dt", { text: "Customer info" }), h("dd", { text: order.notes })] : null,
        h("dt", { text: "Original" }), h("dd", {}, h("a", { href: `/api/admin/file-orders/${order.id}/download`, download: "", text: `${order.original.name}` }), ` · ${fileSize(order.original.size)} · SHA-256 ${order.original.sha256.slice(0, 12)}…`),
        order.extras?.length ? [h("dt", { text: "Extra files" }), h("dd", {}, ...order.extras.flatMap((extra, index) => [index ? " · " : "", h("a", { href: `/api/admin/file-orders/${order.id}/download?file=extra&index=${index}`, download: "", text: extra.name })]))] : null,
        h("dt", { text: "Tuned file" }), h("dd", {}, order.tuned ? [h("a", { href: `/api/admin/file-orders/${order.id}/download?file=tuned`, download: "", text: order.tuned.name }), ` · ${fileSize(order.tuned.size)} · uploaded ${dateTime(order.tuned.uploadedAt)} `] : "Not yet ", tunedButton, tunedInput)
      ),
      h("section", { class: "card", style: { marginTop: "18px", background: "var(--surface-2)" } },
        h("h3", { style: { margin: "0 0 6px", fontSize: "15px" }, text: `Send to ${service.provider.name}` }),
        h("p", { class: "help", style: { margin: "0 0 10px", color: "var(--muted)", fontSize: "13px" }, text: service.provider.note }),
        h("ol", { style: { margin: "0 0 12px", paddingLeft: "18px", fontSize: "13px", lineHeight: "1.7" } },
          h("li", {}, "Download the original above."),
          h("li", {}, "Upload it on ", h("a", { href: service.provider.site, target: "_blank", rel: "noopener", text: service.provider.name }), " with the same vehicle and tune."),
          h("li", {}, "Enter their order number below and save: the order shows as In progress."),
          h("li", {}, "When their file comes back, upload it here with “Upload tuned file”. The customer can then download it.")
        ),
        h("label", { class: "field" }, h("span", { text: "Their order number" }), reference)
      ),
      h("div", { class: "form-grid", style: { marginTop: "18px" } },
        h("label", { class: "field" }, h("span", { text: "Status" }), status, h("span", { class: "help", text: closed ? "Closed: the credits went back to the customer." : "Rejecting or cancelling returns the credits to the customer." })),
        h("label", { class: "field full" }, h("span", { text: "Message to the customer (shown with the order)" }), message),
        h("label", { class: "field full" }, h("span", { text: "Private notes (only admins see these)" }), notes)
      )
    );
    const tell = order.status === "completed" ? whatsappCustomer(customer, readyText) : null;
    if (tell) {
      tell.className = "btn spacer";
      tell.textContent = "Tell the customer on WhatsApp";
    }
    const save = h("button", { class: "btn btn-primary", type: "button", text: "Save" });
    const dialog = modal({ title: `File ${order.number}`, body, footer: [tell, save].filter(Boolean), wide: true });
    save.addEventListener("click", async () => {
      const changes = { message: message.value, adminNotes: notes.value, providerReference: reference.value };
      if (!closed && status.value !== order.status) {
        if (["rejected", "cancelled"].includes(status.value) && !(await confirmDialog(`${FILE_LABELS[status.value]} ${order.number}? ${creditText(order.credits)} go back to ${customerName(order)}, and the order can't be reopened.`, { confirmLabel: FILE_LABELS[status.value] }))) return;
        changes.status = status.value;
      }
      try {
        await api(`/api/admin/file-orders/${order.id}`, { method: "PATCH", body: changes });
        toast(`${order.number} saved`);
        dialog.close();
        viewFileOrders(main);
        refreshBadges();
      } catch (error) {
        reportError(error);
      }
    });
  };
  listView({
    main,
    title: "File orders",
    subtitle: "Tuning files ordered with credits on the file service (/files).",
    items,
    labels: FILE_LABELS,
    empty: "No file orders yet.",
    search: (order) => `${order.number} ${customerName(order)} ${order.customer?.company ?? ""} ${vehicleLine(order.vehicle)} ${order.ecu} ${order.provider?.reference ?? ""}`,
    detail,
    columns: [
      { label: "File", cell: (order) => [order.number, h("span", { class: "sub", text: [dateTime(order.createdAt), order.timeFrame ? label(service.timeFrames, order.timeFrame) : ""].filter(Boolean).join(" · ") })] },
      { label: "Customer", cell: (order) => [customerName(order), h("span", { class: "sub", text: order.customer?.company || order.customer?.phone || "" })] },
      { label: "Vehicle", cell: (order) => [vehicleLine(order.vehicle), h("span", { class: "sub", text: `${order.vehicle.year} · ${order.ecu}` })] },
      { label: "Tune", cell: (order) => [order.options.map((option) => option.name).join(" + "), h("span", { class: "sub", text: creditText(order.credits) })] },
      { label: "Status", cell: (order) => [pill(order.status, FILE_LABELS[order.status]), order.provider ? h("span", { class: "sub", text: `Sent · ${order.provider.reference}` }) : null] }
    ]
  });
  const open = items.find((order) => order.id === id);
  if (open) detail(open);
}

async function viewCustomers(main, id) {
  const { items } = await api("/api/admin/customers");
  const detail = async (summary) => {
    let data;
    try {
      data = await api(`/api/admin/customers/${summary.id}`);
    } catch (error) {
      reportError(error);
      return;
    }
    const customer = data.item;
    const name = h("input", { maxlength: 80 });
    name.value = customer.name;
    const phone = h("input", { type: "tel", maxlength: 30 });
    phone.value = customer.phone;
    const company = h("input", { maxlength: 80 });
    company.value = customer.company;
    const active = h("input", { type: "checkbox", checked: customer.active });
    const change = h("input", { type: "number", step: "0.01", placeholder: "e.g. 5 or -1.20", "aria-label": "Credits to add or take away" });
    const reason = h("input", { maxlength: 200, placeholder: "e.g. Paid cash at the workshop", "aria-label": "Reason" });
    const apply = h("button", { class: "btn btn-small", type: "button", text: "Apply" });
    apply.addEventListener("click", async () => {
      try {
        const { item } = await api(`/api/admin/customers/${customer.id}/credits`, { method: "POST", body: { change: Number(change.value), note: reason.value } });
        toast(`${item.name} now has ${creditText(item.credits)}`);
        dialog.close();
        viewCustomers(main, customer.id);
      } catch (error) {
        reportError(error);
      }
    });
    const resetOut = h("div", { class: "help", style: { marginTop: "8px", wordBreak: "break-all" } });
    const reset = h("button", { class: "btn btn-small", type: "button", text: "Make a password reset link" });
    reset.addEventListener("click", async () => {
      try {
        const { url, expiresAt } = await api(`/api/admin/customers/${customer.id}/reset-link`, { method: "POST" });
        const send = whatsappCustomer(customer, `Hi ${customer.name.split(" ")[0]}, here's your link to set a new password for the file service (it works once, until ${dateTime(expiresAt)}): ${url}`);
        resetOut.replaceChildren(h("code", { text: url }), h("br"), `Works once, until ${dateTime(expiresAt)}. `, ...(send ? [send, " it to them."] : ["Send it to them."]));
      } catch (error) {
        reportError(error);
      }
    });
    const ledgerTable = dataTable(
      [
        { label: "Date", cell: (entry) => dateTime(entry.createdAt) },
        { label: "What", cell: (entry) => [LEDGER_LABELS[entry.reason] ?? entry.reason, h("span", { class: "sub", text: [entry.ref, entry.note].filter(Boolean).join(" · ") })] },
        { label: "Change", class: "num", cell: (entry) => (entry.change > 0 ? `+${creditNumber(entry.change)}` : creditNumber(entry.change)) },
        { label: "Balance", class: "num", cell: (entry) => creditNumber(entry.balance) }
      ],
      data.ledger,
      { empty: "No credit changes yet." }
    );
    const body = h("div", {},
      h("dl", { class: "detail-grid" },
        h("dt", { text: "Email" }), h("dd", {}, h("a", { href: `mailto:${customer.email}`, text: customer.email })),
        h("dt", { text: "Joined" }), h("dd", { text: dateTime(customer.createdAt) }),
        h("dt", { text: "Credits" }), h("dd", {}, h("b", { text: creditNumber(customer.credits) })),
        h("dt", { text: "Files" }), h("dd", {}, ...(data.orders.length ? data.orders.slice(0, 8).flatMap((order, index) => [index ? " · " : "", h("a", { href: `#files/${order.id}`, text: `${order.number} (${FILE_LABELS[order.status]})` })]) : ["None yet"]))
      ),
      h("div", { class: "form-grid", style: { marginTop: "18px" } },
        h("label", { class: "field" }, h("span", { text: "Name" }), name),
        h("label", { class: "field" }, h("span", { text: "Workshop" }), company),
        h("label", { class: "field" }, h("span", { text: "WhatsApp number" }), phone),
        h("label", { class: "check" }, active, "Account switched on (off signs them out and stops sign-ins)")
      ),
      h("section", { class: "card", style: { marginTop: "18px", background: "var(--surface-2)" } },
        h("h3", { style: { margin: "0 0 10px", fontSize: "15px" }, text: "Add or take away credits" }),
        h("div", { class: "toolbar" }, change, reason, apply),
        h("p", { class: "help", style: { margin: "8px 0 0", color: "var(--muted)", fontSize: "12px" }, text: "For payments made outside the website, goodwill, or corrections. The reason is kept in the credit history below; the customer sees the change as an adjustment." })
      ),
      h("section", { class: "card", style: { marginTop: "12px", background: "var(--surface-2)" } },
        h("h3", { style: { margin: "0 0 10px", fontSize: "15px" }, text: "Forgot their password?" }),
        reset,
        resetOut
      ),
      h("h3", { style: { margin: "22px 0 8px", fontSize: "15px" }, text: "Credit history" }),
      ledgerTable
    );
    const save = h("button", { class: "btn btn-primary", type: "button", text: "Save" });
    const dialog = modal({ title: customer.name, body, footer: [save], wide: true });
    save.addEventListener("click", async () => {
      try {
        await api(`/api/admin/customers/${customer.id}`, { method: "PATCH", body: { name: name.value, phone: phone.value, company: company.value, active: active.checked } });
        toast("Customer saved");
        dialog.close();
        viewCustomers(main);
      } catch (error) {
        reportError(error);
      }
    });
  };
  const input = h("input", { type: "search", placeholder: "Search", "aria-label": "Search customers" });
  const holder = h("div");
  const draw = () => {
    const query = input.value.trim().toLowerCase();
    const rows = items.filter((customer) => !query || `${customer.name} ${customer.email} ${customer.phone} ${customer.company}`.toLowerCase().includes(query));
    holder.replaceChildren(
      dataTable(
        [
          { label: "Customer", cell: (customer) => [customer.name, h("span", { class: "sub", text: customer.company || customer.email })] },
          { label: "Contact", cell: (customer) => [customer.email, h("span", { class: "sub", text: customer.phone })] },
          { label: "Credits", class: "num", cell: (customer) => creditNumber(customer.credits) },
          { label: "Files", class: "num", cell: (customer) => String(customer.orders) },
          { label: "Account", cell: (customer) => pill(customer.active ? "active" : "cancelled", customer.active ? "On" : "Off") }
        ],
        rows,
        { onRowClick: detail, empty: "No customers yet. Tuners create accounts on /files." }
      )
    );
  };
  input.addEventListener("input", draw);
  main.replaceChildren(pageHead("Customers", "File service accounts, their credits and history."), h("div", { class: "toolbar" }, input), holder);
  draw();
  const open = items.find((customer) => customer.id === id);
  if (open) detail(open);
}

async function viewPayments(main, id) {
  const [{ items }, service] = await Promise.all([api("/api/admin/purchases"), api("/api/admin/file-service")]);
  const act = (purchase, action, done) => async () => {
    try {
      const { item } = await api(`/api/admin/purchases/${purchase.id}/${action}`, { method: "POST" });
      toast(done(item));
      viewPayments(main);
      refreshBadges();
    } catch (error) {
      reportError(error);
    }
  };
  const detail = (purchase) => {
    const open = ["awaiting_payment", "submitted"].includes(purchase.status);
    const footer = [];
    if (open) {
      const cancel = h("button", { class: "btn btn-danger spacer", type: "button", text: "Cancel payment" });
      cancel.addEventListener("click", async () => {
        if (await confirmDialog(`Cancel ${purchase.number}? No credits are added.`, { confirmLabel: "Cancel payment" })) act(purchase, "cancel", () => `${purchase.number} cancelled`)().then(() => dialog.close());
      });
      footer.push(cancel);
      if (purchase.method === "razorpay") {
        const check = h("button", { class: "btn", type: "button", text: "Check with Razorpay" });
        check.addEventListener("click", () => act(purchase, "check", (item) => (item.status === "paid" ? `Paid: ${plural(item.credits, "credit")} added` : "Razorpay hasn't received it yet"))().then(() => dialog.close()));
        footer.push(check);
      }
      const confirm = h("button", { class: "btn btn-primary", type: "button", text: `Payment received · add ${plural(purchase.credits, "credit")}` });
      confirm.addEventListener("click", async () => {
        if (await confirmDialog(`Only confirm once ${cash(purchase.amount)} has arrived${purchase.utr ? ` with reference ${purchase.utr}` : ""}. Add ${plural(purchase.credits, "credit")} to ${customerName(purchase)}?`, { confirmLabel: "Add credits", danger: false }))
          act(purchase, "confirm", (item) => `${plural(item.credits, "credit")} added for ${customerName(item)}`)().then(() => dialog.close());
      });
      footer.push(confirm);
    }
    const dialog = modal({
      title: `Payment ${purchase.number}`,
      wide: true,
      footer,
      body: h("dl", { class: "detail-grid" },
        h("dt", { text: "Started" }), h("dd", { text: dateTime(purchase.createdAt) }),
        h("dt", { text: "Customer" }), h("dd", {}, purchase.customer ? h("a", { href: `#customers/${purchase.customer.id}`, text: purchase.customer.name }) : "Deleted customer", purchase.customer ? [" · ", whatsappCustomer(purchase.customer, `Hi ${purchase.customer.name.split(" ")[0]}, about your payment ${purchase.number}: `)] : null),
        h("dt", { text: "Pack" }), h("dd", { text: `${purchase.packName} · ${plural(purchase.credits, "credit")}` }),
        h("dt", { text: "Amount" }), h("dd", { text: money(purchase.amount, purchase.currency) }),
        h("dt", { text: "Method" }), h("dd", { text: purchase.method === "razorpay" ? `Razorpay${purchase.gateway?.paymentId ? ` · ${purchase.gateway.paymentId}` : ""}` : `UPI${purchase.utr ? ` · reference ${purchase.utr}` : " · no reference yet"}` }),
        h("dt", { text: "Status" }), h("dd", {}, pill(purchase.status, PAYMENT_LABELS[purchase.status]), purchase.paidAt ? ` ${dateTime(purchase.paidAt)}${purchase.confirmedBy === "admin" ? " · confirmed by you" : " · confirmed by Razorpay"}` : "")
      )
    });
  };
  listView({
    main,
    title: "Payments",
    subtitle: service.upi || service.razorpay
      ? `Credit pack purchases. UPI payments need you to check the money arrived, then confirm.${service.razorpay ? " Razorpay payments confirm themselves." : ""}`
      : "Credit pack purchases. Set a UPI ID in Settings (with the currency set to INR) so customers can buy credits.",
    items,
    labels: PAYMENT_LABELS,
    empty: "No payments yet.",
    search: (purchase) => `${purchase.number} ${customerName(purchase)} ${purchase.utr} ${purchase.packName}`,
    detail,
    columns: [
      { label: "Payment", cell: (purchase) => [purchase.number, h("span", { class: "sub", text: dateTime(purchase.createdAt) })] },
      { label: "Customer", cell: (purchase) => [customerName(purchase), h("span", { class: "sub", text: purchase.customer?.phone ?? "" })] },
      { label: "Pack", cell: (purchase) => [purchase.packName, h("span", { class: "sub", text: plural(purchase.credits, "credit") })] },
      { label: "Amount", class: "num", cell: (purchase) => money(purchase.amount, purchase.currency) },
      { label: "Method", cell: (purchase) => [purchase.method === "razorpay" ? "Razorpay" : "UPI", purchase.utr ? h("span", { class: "sub", text: `Ref ${purchase.utr}` }) : null] },
      { label: "Status", cell: (purchase) => pill(purchase.status, PAYMENT_LABELS[purchase.status]) }
    ]
  });
  const open = items.find((purchase) => purchase.id === id);
  if (open) detail(open);
}

// ---------- Shell, routing and sign-in ----------

// Sections whose menu entry shows how many new items wait.
const BADGES = ["orders", "enquiries", "franchise", "files", "payments"];

async function refreshBadges() {
  try {
    const data = await api("/api/admin/dashboard");
    state.badges = { orders: data.newOrders, enquiries: data.newEnquiries, franchise: data.newFranchiseLeads, files: data.newFileOrders, payments: data.paymentsToCheck };
    for (const [section, count] of Object.entries(state.badges)) {
      const badge = document.querySelector(`[data-badge="${section}"]`);
      if (badge) {
        badge.textContent = String(count);
        badge.hidden = !count;
      }
    }
  } catch (error) {
    reportError(error);
  }
}

async function loadState() {
  const { businessName } = await api("/api/admin/me");
  const { settings } = await api("/api/admin/settings");
  state.businessName = businessName;
  state.currency = settings.currency;
}

function renderShell() {
  document.title = `Admin · ${state.businessName}`;
  const signOut = h("button", { class: "btn-link", type: "button", text: "Sign out", style: { border: "0", background: "none", color: "var(--link)", cursor: "pointer", padding: "0", textAlign: "left" } });
  signOut.addEventListener("click", async () => {
    await api("/api/admin/logout", { method: "POST" }).catch(() => {});
    showLogin();
  });
  const main = h("main", { class: "main", id: "main", tabindex: "-1" });
  app.replaceChildren(
    h("div", { class: "shell" },
      h("aside", { class: "sidebar" },
        h("div", { class: "brand", text: state.businessName }),
        h("nav", { class: "side-nav", "aria-label": "Admin sections" },
          ...SECTIONS.map(([id, label]) => h("a", { href: `#${id}`, dataset: { section: id } }, label, BADGES.includes(id) ? h("span", { class: "count", dataset: { badge: id }, hidden: true }) : null))
        ),
        h("div", { class: "sidebar-foot" }, h("a", { href: "/", target: "_blank", rel: "noopener", text: "View website ↗" }), signOut)
      ),
      main
    )
  );
  route();
  refreshBadges();
}

async function route() {
  const main = document.getElementById("main");
  if (!main) return;
  // Navigating (e.g. with the Back button) closes any open editor instead of leaving it on top.
  for (const open of document.querySelectorAll("dialog[open]")) open.close();
  const [section = "dashboard", id] = location.hash.slice(1).split("/");
  const known = SECTIONS.some(([key]) => key === section) ? section : "dashboard";
  for (const link of document.querySelectorAll("[data-section]")) {
    if (link.dataset.section === known) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  main.replaceChildren(h("p", { class: "boot", text: "Loading…" }));
  try {
    if (known === "dashboard") await viewDashboard(main);
    else if (known === "orders") await viewOrders(main, id);
    else if (known === "enquiries") await viewEnquiries(main, id);
    else if (known === "franchise") await viewFranchise(main, id);
    else if (known === "files") await viewFileOrders(main, id);
    else if (known === "customers") await viewCustomers(main, id);
    else if (known === "payments") await viewPayments(main, id);
    else if (known === "settings") await viewSettings(main);
    else if (known === "backup") viewBackup(main);
    else await collectionView(main, id, COLLECTION_VIEWS[known]);
  } catch (error) {
    if (error instanceof SignedOut) return;
    main.replaceChildren(h("p", { class: "error", text: error.message }));
  }
}

function showLogin(message) {
  const error = h("p", { class: "error", role: "alert", hidden: !message, text: message ?? "" });
  const submit = h("button", { class: "btn btn-primary", type: "submit", text: "Sign in", style: { width: "100%" } });
  const form = h("form", { class: "form-grid", style: { gridTemplateColumns: "1fr", marginTop: "20px" } },
    h("label", { class: "field" }, h("span", { text: "Username" }), h("input", { name: "username", autocomplete: "username", required: true })),
    h("label", { class: "field" }, h("span", { text: "Password" }), h("input", { name: "password", type: "password", autocomplete: "current-password", required: true })),
    error,
    submit
  );
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    submit.disabled = true;
    error.hidden = true;
    try {
      await api("/api/admin/login", { method: "POST", body: { username: form.elements.username.value, password: form.elements.password.value } });
      await loadState();
      renderShell();
    } catch (failure) {
      error.textContent = failure.message;
      error.hidden = false;
      submit.disabled = false;
    }
  });
  app.replaceChildren(
    h("div", { class: "login" },
      h("div", { class: "login-card" }, h("div", { class: "logo", "aria-hidden": "true" }), h("h1", { text: "Admin" }), h("p", { text: `Sign in to manage ${state.businessName}.` }), form)
    )
  );
  form.elements.username.focus();
}

addEventListener("hashchange", route);

try {
  await loadState();
  renderShell();
} catch (error) {
  if (!(error instanceof SignedOut)) app.replaceChildren(h("p", { class: "boot", text: error.message }));
}
