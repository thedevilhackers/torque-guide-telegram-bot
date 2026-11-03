import { call, emptyState, formatDay, h, icon, rerender, segmented, send, telLink, timeAgo, waLink } from "./core.js";

const view = { reviewFilter: "pending" };

export async function renderReviews() {
  const { reviews } = await call("/api/admin/reviews");
  const shown = view.reviewFilter === "all" ? reviews : reviews.filter((r) => r.status === view.reviewFilter);
  const toolbar = h(
    "div",
    { class: "toolbar" },
    segmented(
      [
        ["pending", "To check"],
        ["approved", "Live"],
        ["rejected", "Hidden"],
        ["all", "All"]
      ],
      view.reviewFilter,
      (value) => {
        view.reviewFilter = value;
        rerender();
      }
    )
  );
  if (!shown.length) return h("div", {}, toolbar, emptyState("Nothing here", view.reviewFilter === "pending" ? "You're all caught up." : "No reviews in this list yet."));
  const moderate = (review, status, message) => async () => {
    await send("PATCH", `/api/admin/reviews/${review.id}`, { status }, message);
    rerender();
  };
  return h(
    "div",
    {},
    toolbar,
    h(
      "div",
      { class: "card-grid" },
      shown.map((review) =>
        h(
          "article",
          { class: "review-admin" },
          h("div", { class: "stars", role: "img", "aria-label": `${review.rating} stars` }, [1, 2, 3, 4, 5].map((n) => icon("star", n <= review.rating ? "icon" : "icon off"))),
          h("p", { class: "review-text", text: review.text }),
          h("p", { class: "row-meta", text: `${review.name} · ${timeAgo(review.createdAt)}` }),
          h(
            "div",
            { class: "oc-actions" },
            review.status !== "approved" ? h("button", { type: "button", class: "btn btn-sm btn-primary", onclick: moderate(review, "approved", "Review is now live on the website") }, icon("check"), "Approve") : null,
            review.status !== "rejected" ? h("button", { type: "button", class: "btn btn-sm btn-quiet", onclick: moderate(review, "rejected", "Review hidden") }, "Hide") : null
          )
        )
      )
    )
  );
}

export async function renderEnquiries() {
  const { enquiries } = await call("/api/admin/enquiries");
  if (!enquiries.length) return emptyState("No enquiries yet", "Party and event enquiries from the website will appear here.");
  return h(
    "div",
    { class: "list" },
    enquiries.map((e) =>
      h(
        "article",
        { class: `row-card st-${e.status}` },
        h("div", { class: "row-when" }, h("strong", { text: e.date ? formatDay(e.date) : "Date TBC" }), h("span", { text: e.guests ? `${e.guests} guests` : "Guests TBC" })),
        h(
          "div",
          { class: "row-main" },
          h("p", { class: "row-title" }, h("strong", { text: e.name }), h("span", { class: `status-badge st-${e.status}`, text: e.status === "new" ? "new" : "handled" })),
          h("p", { class: "review-text", text: e.message }),
          h("p", { class: "row-meta" }, telLink(e.phone), e.email ? ` · ${e.email}` : "", ` · ${timeAgo(e.createdAt)}`)
        ),
        h(
          "div",
          { class: "row-actions" },
          waLink(e.phone, `Hi ${e.name.split(" ")[0]}, thanks for your party enquiry with Cafe BAE! `, "Reply"),
          h(
            "button",
            {
              type: "button",
              class: "btn btn-sm btn-primary",
              onclick: async () => {
                await send("PATCH", `/api/admin/enquiries/${e.id}`, { status: e.status === "new" ? "handled" : "new" }, e.status === "new" ? "Marked as handled" : "Reopened");
                rerender();
              }
            },
            e.status === "new" ? "Mark handled" : "Reopen"
          )
        )
      )
    )
  );
}

export async function renderSubscribers() {
  const { subscribers } = await call("/api/admin/subscribers");
  const exportCsv = () => {
    const rows = [["email", "subscribed_at"], ...subscribers.map((s) => [s.email, s.createdAt])];
    const csv = rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
    const link = h("a", { href: URL.createObjectURL(new Blob([csv], { type: "text/csv" })), download: "cafe-bae-subscribers.csv" });
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  };
  return h(
    "div",
    {},
    h(
      "div",
      { class: "toolbar" },
      h("p", { class: "muted", text: `${subscribers.length} subscriber${subscribers.length === 1 ? "" : "s"}` }),
      h("button", { type: "button", class: "btn btn-sm btn-primary toolbar-end", disabled: !subscribers.length, onclick: exportCsv }, "Export CSV")
    ),
    subscribers.length
      ? h(
          "div",
          { class: "table-wrap" },
          h(
            "table",
            { class: "menu-table" },
            h("thead", {}, h("tr", {}, h("th", { text: "Email" }), h("th", { text: "Signed up" }))),
            h("tbody", {}, subscribers.map((s) => h("tr", {}, h("td", { text: s.email }), h("td", { text: new Date(s.createdAt).toLocaleString("en-IN") }))))
          )
        )
      : emptyState("No subscribers yet", "Sign-ups from the website's newsletter box will appear here.")
  );
}
