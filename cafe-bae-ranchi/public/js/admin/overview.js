import { call, can, emptyState, h, icon, paise, state } from "./core.js";
import { orderCard } from "./orders.js";

const OCCASIONS = { birthday: "Birthday", date: "Date night", anniversary: "Anniversary", friends: "Friends", family: "Family", work: "Work", other: "Other" };

const go = (tab) => document.querySelector(`#tabs [data-tab="${tab}"]`)?.click();

export async function renderOverview() {
  const [summary, active, today] = await Promise.all([
    call("/api/admin/summary"),
    can("orders") ? call("/api/admin/orders?scope=active") : null,
    can("bookings") ? call("/api/admin/reservations?scope=today") : null
  ]);
  state.summary = summary;

  const tiles = [
    can("orders") && ["Orders today", summary.orders.today, "receipt", "blush"],
    can("orders") && summary.orders.revenueToday !== null && ["Sales today", paise(summary.orders.revenueToday), "sparkle", "butter", "incl. GST, excl. cancelled"],
    can("orders") && ["In the kitchen", summary.orders.active, "chef", "peach"],
    can("bookings") && ["Bookings today", summary.reservations.today, "calendar", "sage", `${summary.reservations.guestsToday} guests expected`],
    can("bookings") && ["To confirm", summary.reservations.pending, "bell", "latte", "upcoming bookings", "bookings"],
    can("whatsapp") && ["Unread WhatsApp", summary.whatsapp.unread, "whatsapp", "sage", summary.whatsapp.active ? "Cloud API connected" : "click-to-chat mode", "whatsapp"],
    can("reviews") && ["Reviews to check", summary.reviews.pending, "star", "berry", "", "reviews"],
    can("enquiries") && ["Party enquiries", summary.enquiries.open, "gift", "honey", "waiting for a call back", "enquiries"]
  ].filter(Boolean);

  const panels = [];
  if (active) {
    panels.push(
      h(
        "section",
        { class: "panel" },
        h("h2", {}, "Kitchen queue", h("button", { type: "button", class: "link-btn", onclick: () => go("orders") }, "Open board →")),
        active.orders.length ? active.orders.map((order) => orderCard(order, { compact: true })) : emptyState("All caught up", "New orders will appear here with a chime.")
      )
    );
  }
  if (today) {
    const bookings = today.reservations.filter((r) => !["cancelled", "no-show"].includes(r.status));
    panels.push(
      h(
        "section",
        { class: "panel" },
        h("h2", {}, "Today's bookings", h("button", { type: "button", class: "link-btn", onclick: () => go("bookings") }, "All bookings →")),
        bookings.length
          ? h(
              "ul",
              { class: "mini-list" },
              bookings.map((r) =>
                h(
                  "li",
                  {},
                  h("strong", { text: r.timeLabel }),
                  h("span", { text: `${r.name} · ${r.guests} guest${r.guests === 1 ? "" : "s"}${r.occasion ? ` · ${OCCASIONS[r.occasion]}` : ""}` }),
                  h("span", { class: `status-badge st-${r.status}`, text: r.status })
                )
              )
            )
          : emptyState("No bookings today", "Online bookings will show up here.")
      )
    );
  }

  return h(
    "div",
    {},
    h(
      "div",
      { class: "kpi-grid" },
      tiles.map(([label, value, iconName, tone, note, tab]) =>
        h(
          tab ? "button" : "div",
          { class: `kpi${tab ? " kpi-link" : ""}`, type: tab ? "button" : null, onclick: tab ? () => go(tab) : null },
          h("span", { class: `kpi-icon tone-${tone}` }, icon(iconName)),
          h("strong", { text: String(value) }),
          h("span", { text: label }),
          note ? h("small", { text: note }) : null
        )
      )
    ),
    panels.length ? h("div", { class: "panels" }, panels) : emptyState(`Welcome, ${state.me.name}`, "Pick a section from the menu to get started.")
  );
}
