import { $, call, dietMark, emptyState, h, icon, paise, pad, rerender, segmented, select, send, setLoading, telLink, timeAgo, waBadge, waLink } from "./core.js";

const view = { scope: "active" };
const ETA_OPTIONS = [5, 10, 15, 20, 30, 45].map((n) => [n, `${n} min`]);
const PAYMENT_OPTIONS = [["cash", "Cash"], ["upi", "UPI"], ["card", "Card"], ["other", "Other"]];
const WHERE = (order) => (order.type === "dine-in" ? `Table ${order.table}` : "Pickup");

/** Ready-written WhatsApp text staff can send from their own phone. */
function customerMessage(order) {
  const first = order.name.split(" ")[0];
  const number = `#${pad(order.number)}`;
  switch (order.status) {
    case "received":
      return `Hi ${first}, thanks for ordering at Cafe BAE! We've received your order ${number}.`;
    case "preparing":
      return `Hi ${first}, your order ${number} is being prepared${order.etaMinutes ? ` and will be ready in about ${order.etaMinutes} minutes` : ""}.`;
    case "ready":
      return order.type === "dine-in" ? `Hi ${first}, your order ${number} is ready and on its way to table ${order.table}!` : `Hi ${first}, your order ${number} is ready! Please collect it at the counter.`;
    default:
      return `Hi ${first}, thank you for visiting Cafe BAE! We hope you enjoyed order ${number}.`;
  }
}

/** Prints a kitchen order ticket sized for 80 mm thermal printers. */
export function printKot(order) {
  const area = $("#printArea");
  const created = new Date(order.createdAt);
  area.replaceChildren(
    h(
      "div",
      { class: "kot" },
      h("p", { class: "kot-brand", text: "CAFE BAE · KOT" }),
      h("p", { class: "kot-number", text: `#${pad(order.number)}` }),
      h("p", { class: "kot-where", text: WHERE(order) }),
      h("p", { class: "kot-meta", text: `${created.toLocaleDateString("en-IN")} ${created.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })} · ${order.name}` }),
      h("hr"),
      h("table", {}, h("tbody", {}, order.items.map((line) => h("tr", {}, h("td", { class: "kot-qty", text: `${line.qty} ×` }), h("td", { text: `${line.name}${line.veg ? "" : " (NV)"}` }))))),
      order.notes ? h("p", { class: "kot-notes", text: `NOTE: ${order.notes}` }) : null,
      h("hr"),
      h("p", { class: "kot-meta", text: `Items: ${order.items.reduce((sum, line) => sum + line.qty, 0)} · Total ${paise(order.amounts.total)}` })
    )
  );
  window.print();
}

function actionsFor(order) {
  const patch = async (button, body, message) => {
    setLoading(button, true);
    try {
      await send("PATCH", `/api/admin/orders/${order.id}`, body, message);
      rerender();
    } catch {
      setLoading(button, false);
    }
  };
  if (order.status === "received") {
    const eta = select("eta", ETA_OPTIONS, 15, { class: "mini-select", "aria-label": "Ready in" });
    return [
      eta,
      h("button", { type: "button", class: "btn btn-sm btn-primary", onclick: (e) => patch(e.currentTarget, { status: "preparing", etaMinutes: Number(eta.value) }, `Order #${pad(order.number)} accepted · ready in ${eta.value} min`) }, "Accept"),
      h(
        "button",
        {
          type: "button",
          class: "btn btn-sm btn-quiet",
          onclick: (e) => confirm(`Cancel order #${pad(order.number)}?`) && patch(e.currentTarget, { status: "cancelled" }, `Order #${pad(order.number)} cancelled`)
        },
        "Cancel"
      )
    ];
  }
  if (order.status === "preparing") {
    return [h("button", { type: "button", class: "btn btn-sm btn-accent", onclick: (e) => patch(e.currentTarget, { status: "ready" }, `Order #${pad(order.number)} is ready`) }, "Mark ready")];
  }
  if (order.status === "ready") {
    const payment = select("payment", [["", "Paid by…"], ...PAYMENT_OPTIONS], "", { class: "mini-select", "aria-label": "Payment method" });
    return [
      payment,
      h(
        "button",
        {
          type: "button",
          class: "btn btn-sm btn-primary",
          onclick: (e) => patch(e.currentTarget, { status: "completed", ...(payment.value ? { payment: payment.value } : {}) }, `Order #${pad(order.number)} completed`)
        },
        "Complete"
      )
    ];
  }
  return [h("span", { class: `status-badge st-${order.status}`, text: order.payment ? `${order.status} · ${order.payment.toUpperCase()}` : order.status })];
}

export function orderCard(order, { compact = false } = {}) {
  const isNew = order.status === "received" && Date.now() - new Date(order.createdAt).getTime() < 90_000;
  return h(
    "article",
    { class: `order-card st-${order.status}${isNew ? " is-new" : ""}` },
    h(
      "div",
      { class: "oc-head" },
      h("strong", { class: "oc-num", text: `#${pad(order.number)}` }),
      h("span", { class: `chip${order.type === "dine-in" ? " chip-table" : ""}`, text: WHERE(order) }),
      h("span", { class: "oc-time", title: new Date(order.createdAt).toLocaleString("en-IN"), text: timeAgo(order.createdAt) })
    ),
    h("ul", { class: "oc-items" }, order.items.map((line) => h("li", {}, h("b", { text: `${line.qty}×` }), dietMark(line.veg), h("span", { text: line.name })))),
    order.notes ? h("p", { class: "oc-notes" }, icon("chef"), h("span", { text: order.notes })) : null,
    order.status === "preparing" && order.readyByLabel ? h("p", { class: "oc-eta" }, icon("clock"), `Promised by ${order.readyByLabel}`) : null,
    compact
      ? null
      : h(
          "div",
          { class: "oc-cust" },
          h("span", { text: order.name }),
          "·",
          telLink(order.phone),
          order.whatsappOptIn ? h("span", { class: "chip chip-ok", title: "Guest asked for WhatsApp updates" }, "WA updates") : null,
          waBadge(order.whatsapp)
        ),
    h(
      "div",
      { class: "oc-foot" },
      h("span", { class: "oc-total", text: paise(order.amounts.total) }),
      h(
        "div",
        { class: "oc-tools" },
        h("button", { type: "button", class: "icon-btn icon-btn-sm", "aria-label": `Print KOT for order ${order.number}`, title: "Print kitchen ticket (KOT)", onclick: () => printKot(order) }, icon("print")),
        compact ? null : waLink(order.phone, customerMessage(order), "", "btn-icon")
      ),
      h("div", { class: "oc-actions" }, actionsFor(order))
    )
  );
}

export async function renderOrders() {
  const { orders } = await call(`/api/admin/orders?scope=${view.scope}`);
  const toolbar = h(
    "div",
    { class: "toolbar" },
    segmented(
      [
        ["active", "Live board"],
        ["today", "Today"],
        ["all", "All orders"]
      ],
      view.scope,
      (value) => {
        view.scope = value;
        rerender();
      }
    )
  );
  if (view.scope === "active") {
    const columns = [
      ["received", "New"],
      ["preparing", "Preparing"],
      ["ready", "Ready"]
    ];
    return h(
      "div",
      {},
      toolbar,
      h(
        "div",
        { class: "board" },
        columns.map(([status, label]) => {
          const list = orders.filter((order) => order.status === status);
          return h(
            "section",
            { class: `col col-${status}` },
            h("header", { class: "col-head" }, h("span", { text: label }), h("span", { class: "n", text: String(list.length) })),
            list.length ? list.map((order) => orderCard(order)) : h("p", { class: "col-empty", text: "Nothing here" })
          );
        })
      )
    );
  }
  return h("div", {}, toolbar, orders.length ? h("div", { class: "card-grid" }, orders.map((order) => orderCard(order))) : emptyState("No orders yet", "Orders placed on the website will appear here."));
}
