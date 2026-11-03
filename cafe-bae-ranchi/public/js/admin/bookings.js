import { call, emptyState, formatDay, h, icon, rerender, segmented, send, telLink, timeAgo, waBadge, waLink } from "./core.js";

const view = { scope: "upcoming" };
const OCCASIONS = { birthday: "Birthday", date: "Date night", anniversary: "Anniversary", friends: "Friends", family: "Family", work: "Work", other: "Other" };
const STATUSES = ["pending", "confirmed", "seated", "cancelled", "no-show"];

function messageFor(r) {
  const first = r.name.split(" ")[0];
  const when = `${formatDay(r.date)} at ${r.timeLabel}`;
  if (r.status === "cancelled") return `Hi ${first}, your Cafe BAE booking for ${when} has been cancelled. Reply here if you'd like a new time.`;
  return `Hi ${first}, your table for ${r.guests} at Cafe BAE on ${when} is confirmed. Booking code: ${r.code}. See you soon!`;
}

export async function renderBookings() {
  const { reservations } = await call(`/api/admin/reservations?scope=${view.scope}`);
  const toolbar = h(
    "div",
    { class: "toolbar" },
    segmented(
      [
        ["upcoming", "Upcoming"],
        ["today", "Today"],
        ["past", "Past"]
      ],
      view.scope,
      (value) => {
        view.scope = value;
        rerender();
      }
    )
  );
  if (!reservations.length) return h("div", {}, toolbar, emptyState("No bookings here", "Bookings made on the website will appear here."));
  return h(
    "div",
    {},
    toolbar,
    h(
      "div",
      { class: "list" },
      reservations.map((r) => {
        const status = h("select", { "aria-label": `Status for ${r.name}` }, STATUSES.map((value) => h("option", { value, selected: value === r.status }, value)));
        status.addEventListener("change", async () => {
          try {
            await send("PATCH", `/api/admin/reservations/${r.id}`, { status: status.value }, `Booking ${r.code} → ${status.value}`);
            rerender();
          } catch {
            status.value = r.status;
          }
        });
        return h(
          "article",
          { class: `row-card st-${r.status}` },
          h("div", { class: "row-when" }, h("strong", { text: r.timeLabel }), h("span", { text: formatDay(r.date) })),
          h(
            "div",
            { class: "row-main" },
            h(
              "p",
              { class: "row-title" },
              h("strong", { text: r.name }),
              ` · ${r.guests} guest${r.guests === 1 ? "" : "s"}`,
              r.occasion ? h("span", { class: "chip", text: OCCASIONS[r.occasion] }) : null,
              r.whatsappOptIn ? h("span", { class: "chip chip-ok", text: "WA updates" }) : null,
              waBadge(r.whatsapp)
            ),
            h("p", { class: "row-meta" }, telLink(r.phone), r.email ? ` · ${r.email}` : "", ` · Code ${r.code} · booked ${timeAgo(r.createdAt)}`),
            r.notes ? h("p", { class: "oc-notes" }, icon("chef"), h("span", { text: r.notes })) : null
          ),
          h(
            "div",
            { class: "row-actions" },
            r.status === "pending"
              ? h(
                  "button",
                  {
                    type: "button",
                    class: "btn btn-sm btn-primary",
                    onclick: async () => {
                      await send("PATCH", `/api/admin/reservations/${r.id}`, { status: "confirmed" }, `Booking ${r.code} confirmed`);
                      rerender();
                    }
                  },
                  icon("check"),
                  "Confirm"
                )
              : null,
            ["pending", "confirmed", "cancelled"].includes(r.status) ? waLink(r.phone, messageFor({ ...r, status: r.status === "pending" ? "confirmed" : r.status }), "Message") : null,
            status
          )
        );
      })
    )
  );
}
