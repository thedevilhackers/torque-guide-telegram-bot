import { call, emptyState, h, icon, paise, rerender, segmented } from "./core.js";

const view = { days: 7 };
const rupeesOf = (p) => p / 100;

/** Axis labels: full numbers under ₹10,000, compact (₹12K) on axes that reach it. */
function axisFormatter(max) {
  const compact = max >= 10_000;
  return (value) => (compact ? `₹${value >= 1000 ? `${+(value / 1000).toFixed(1)}K` : value}` : `₹${value.toLocaleString("en-IN")}`);
}

function niceTicks(max) {
  if (max <= 0) return [0, 100];
  const rough = max / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rough);
  const top = Math.ceil(max / step) * step;
  return Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
}

function tooltipHost() {
  const tip = h("div", { class: "chart-tip", role: "tooltip", hidden: true });
  const show = (target, value, label) => {
    tip.replaceChildren(h("strong", { text: value }), h("span", { text: label }));
    tip.hidden = false;
    const box = target.getBoundingClientRect();
    const host = tip.parentElement.getBoundingClientRect();
    tip.style.left = `${box.left - host.left + box.width / 2}px`;
    tip.style.top = `${box.top - host.top}px`;
  };
  const hide = () => (tip.hidden = true);
  return { tip, show, hide };
}

/** Single-series column chart of sales per day. */
function salesChart(byDay) {
  const values = byDay.map((d) => rupeesOf(d.revenue));
  const ticks = niceTicks(Math.max(...values));
  const top = ticks.at(-1);
  const format = axisFormatter(top);
  const best = values.indexOf(Math.max(...values));
  const { tip, show, hide } = tooltipHost();
  const many = byDay.length > 14;
  const columns = byDay.map((day, index) => {
    const value = values[index];
    const height = top ? (value / top) * 100 : 0;
    const label = `${day.label}: ${paise(day.revenue)} from ${day.orders} order${day.orders === 1 ? "" : "s"}`;
    const bar = h("button", { type: "button", class: "col-bar", "aria-label": label });
    bar.style.height = `${Math.max(height, value > 0 ? 1 : 0)}%`;
    const reveal = () => show(bar, paise(day.revenue), `${day.label} · ${day.orders} order${day.orders === 1 ? "" : "s"}`);
    bar.addEventListener("pointerenter", reveal);
    bar.addEventListener("focus", reveal);
    bar.addEventListener("pointerleave", hide);
    bar.addEventListener("blur", hide);
    const showLabel = !many || index % 7 === byDay.length % 7 || index === byDay.length - 1;
    return h(
      "div",
      { class: "col-slot" },
      h("div", { class: "col-track" }, index === best && value > 0 ? h("span", { class: "col-value", text: paise(day.revenue) }) : null, bar),
      h("span", { class: "col-label", text: showLabel ? (many ? day.label.split(", ")[1] : day.label.split(",")[0]) : "" })
    );
  });
  const grid = h(
    "div",
    { class: "chart-grid", "aria-hidden": "true" },
    ticks.map((tick) => {
      const line = h("div", { class: "grid-line" }, h("span", { text: format(tick) }));
      line.style.bottom = `${(tick / top) * 100}%`;
      return line;
    })
  );
  return h("div", { class: "column-chart" }, grid, h("div", { class: `chart-cols${many ? " dense" : ""}` }, columns), tip);
}

/** Labelled horizontal bars: value at the bar's tip, text in ink colours. */
function barList(rows, { value, label, detail }) {
  if (!rows.length) return h("p", { class: "muted", text: "No data in this period." });
  const max = Math.max(...rows.map(value), 1);
  return h(
    "ul",
    { class: "bar-list" },
    rows.map((row) => {
      const bar = h("span", { class: "bar-fill" });
      bar.style.setProperty("--share", String(value(row) / max));
      return h(
        "li",
        { title: `${label(row)}: ${detail(row)}` },
        h("span", { class: "bar-name", text: label(row) }),
        h("span", { class: "bar-track" }, bar, h("span", { class: "bar-value", text: detail(row) }))
      );
    })
  );
}

export async function renderReports() {
  const report = await call(`/api/admin/reports?days=${view.days}`);
  const filters = h(
    "div",
    { class: "toolbar" },
    segmented(
      [
        [1, "Today"],
        [7, "7 days"],
        [30, "30 days"],
        [90, "90 days"]
      ],
      view.days,
      (value) => {
        view.days = value;
        rerender();
      }
    ),
    h("span", { class: "muted", text: `${report.byDay[0].label} – ${report.byDay.at(-1).label}` })
  );
  const t = report.totals;
  const tiles = [
    ["Sales", paise(t.revenue), "sparkle", "butter", "incl. GST"],
    ["Orders", t.orders, "receipt", "blush", t.cancelled ? `${t.cancelled} cancelled` : "none cancelled"],
    ["Average order", paise(t.averageOrder), "bag", "peach", ""],
    ["GST collected", paise(t.gst), "chart", "latte", "to report in your GST return"],
    ["Table bookings", report.bookings.total, "calendar", "sage", `${report.bookings.guests} guests · ${report.bookings.noShows} no-show${report.bookings.noShows === 1 ? "" : "s"}`]
  ];
  if (!t.orders && !report.bookings.total) {
    return h("div", {}, filters, emptyState("No sales in this period yet", "Reports fill in as orders are completed on the website and the dashboard."));
  }
  const split = (object) => Object.entries(object).map(([name, data]) => ({ name, ...data })).sort((a, b) => b.revenue - a.revenue);
  return h(
    "div",
    { class: "reports" },
    filters,
    h(
      "div",
      { class: "kpi-grid" },
      tiles.map(([label, value, iconName, tone, note]) =>
        h("div", { class: "kpi" }, h("span", { class: `kpi-icon tone-${tone}` }, icon(iconName)), h("strong", { text: String(value) }), h("span", { text: label }), note ? h("small", { text: note }) : null)
      )
    ),
    report.days > 1
      ? h(
          "section",
          { class: "panel" },
          h("h2", { text: "Sales by day" }),
          salesChart(report.byDay),
          h(
            "details",
            { class: "table-toggle" },
            h("summary", { text: "Show as a table" }),
            h(
              "table",
              { class: "menu-table" },
              h("thead", {}, h("tr", {}, h("th", { text: "Day" }), h("th", { text: "Orders" }), h("th", { text: "Sales" }))),
              h("tbody", {}, report.byDay.slice().reverse().map((d) => h("tr", {}, h("td", { text: d.label }), h("td", { text: String(d.orders) }), h("td", { text: paise(d.revenue) }))))
            )
          )
        )
      : null,
    h(
      "div",
      { class: "panels" },
      h(
        "section",
        { class: "panel" },
        h("h2", { text: "Best sellers" }),
        barList(report.topItems, { value: (r) => r.qty, label: (r) => r.name, detail: (r) => `${r.qty} sold · ${paise(r.revenue)}` })
      ),
      h(
        "section",
        { class: "panel" },
        h("h2", { text: "How guests paid" }),
        barList(split(report.byPayment), { value: (r) => r.revenue, label: (r) => r.name, detail: (r) => `${paise(r.revenue)} · ${r.orders} order${r.orders === 1 ? "" : "s"}` }),
        h("h2", { class: "panel-sub", text: "Table vs pickup" }),
        barList(split(report.byType), { value: (r) => r.revenue, label: (r) => r.name, detail: (r) => `${paise(r.revenue)} · ${r.orders} order${r.orders === 1 ? "" : "s"}` })
      )
    )
  );
}
