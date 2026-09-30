// Interactive dyno chart: power and torque as two panels sharing one rpm axis (no dual y-axes),
// stock dashed blue vs Stage 1 solid red, crosshair tooltip, keyboard support and a table view.
import { h, reducedMotion } from "./common.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const MARGIN = { left: 48, right: 16, top: 16 };

function svg(tag, attributes = {}, text) {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  if (text !== undefined) element.textContent = text;
  return element;
}

function niceScale(max, ticks = 4) {
  const raw = (max * 1.08) / ticks;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map((m) => m * magnitude).find((candidate) => candidate >= raw);
  return { step, max: step * ticks, ticks };
}

const format = (value) => Math.round(value).toLocaleString();

export function dynoChart({ stock, stage1 }) {
  const rpms = stage1.rpm;
  const minRpm = Math.min(stock.rpm[0], rpms[0]);
  const maxRpm = Math.max(stock.rpm.at(-1), rpms.at(-1));
  const stockAt = (key, rpm) => {
    const index = stock.rpm.indexOf(rpm);
    return index >= 0 ? stock[key][index] : null;
  };
  const metrics = [
    { key: "power", title: "Power", unit: "hp" },
    { key: "torque", title: "Torque", unit: "Nm" }
  ];

  const root = h("figure", { class: "dyno", tabindex: "0", "aria-label": "Power and torque curves, stock and Stage 1. Use the left and right arrow keys to read values." });
  const legend = h(
    "ul",
    { class: "dyno-legend" },
    h("li", {}, h("span", { class: "line-key", "aria-hidden": "true" }), "Stage 1"),
    h("li", {}, h("span", { class: "line-key stock", "aria-hidden": "true" }), "Stock")
  );
  const tooltip = h("div", { class: "dyno-tooltip", "aria-hidden": "true" });
  const panelHosts = metrics.map((metric) => h("div", { class: "dyno-panel" }, h("p", { class: "dyno-title", text: `${metric.title} (${metric.unit})` })));
  const live = h("p", { class: "visually-hidden", "aria-live": "polite" });
  root.append(legend, ...panelHosts, tooltip, live, tableView());

  let layout = null;
  let activeIndex = null;
  let drawn = false;

  function render() {
    const width = Math.max(280, root.clientWidth);
    const compact = width < 560;
    const plotHeight = compact ? 130 : 180;
    const innerWidth = width - MARGIN.left - MARGIN.right;
    const x = (rpm) => MARGIN.left + ((rpm - minRpm) / (maxRpm - minRpm)) * innerWidth;
    const panels = metrics.map((metric, panelIndex) => {
      const isLast = panelIndex === metrics.length - 1;
      const height = MARGIN.top + plotHeight + (isLast ? 28 : 8);
      const scale = niceScale(Math.max(...stage1[metric.key], ...stock[metric.key]));
      const y = (value) => MARGIN.top + plotHeight - (value / scale.max) * plotHeight;
      const chart = svg("svg", { viewBox: `0 0 ${width} ${height}`, height, role: "presentation" });

      for (let i = 0; i <= scale.ticks; i++) {
        const value = i * scale.step;
        chart.append(svg("line", { class: "grid-line", x1: MARGIN.left, x2: width - MARGIN.right, y1: y(value), y2: y(value) }));
        chart.append(svg("text", { class: "tick", x: MARGIN.left - 10, y: y(value) + 4, "text-anchor": "end" }, format(value)));
      }
      if (isLast) {
        const step = compact ? 2000 : 1000;
        for (let rpm = Math.ceil(minRpm / step) * step; rpm <= maxRpm; rpm += step) {
          chart.append(svg("text", { class: "tick", x: x(rpm), y: MARGIN.top + plotHeight + 20, "text-anchor": "middle" }, rpm.toLocaleString()));
        }
        chart.append(svg("text", { class: "tick", x: width - MARGIN.right, y: MARGIN.top + plotHeight + 20, "text-anchor": "end" }, "rpm"));
      }

      const points = (curve) => curve.rpm.map((rpm, i) => [x(rpm), y(curve[metric.key][i])]);
      const line = (list) => `M${list.map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`).join("L")}`;
      const stage1Points = points(stage1);
      const stockPoints = points(stock);
      chart.append(svg("path", { class: "gain-area", d: `${line(stage1Points)}L${line([...stockPoints].reverse()).slice(1)}Z` }));
      chart.append(svg("path", { class: "series series-stock", d: line(stockPoints) }));
      const stage1Path = svg("path", { class: "series series-stage1", d: line(stage1Points) });
      chart.append(stage1Path);

      // Label only the Stage 1 peak; the tooltip and table carry every other value.
      const peakIndex = stage1[metric.key].indexOf(Math.max(...stage1[metric.key]));
      const [peakX, peakY] = stage1Points[peakIndex];
      chart.append(svg("circle", { class: "peak", cx: peakX, cy: peakY, r: 5 }));
      const labelX = Math.min(width - MARGIN.right - 40, Math.max(MARGIN.left + 40, peakX));
      chart.append(svg("text", { class: "peak-label", x: labelX, y: Math.max(12, peakY - 12), "text-anchor": "middle" }, `${format(stage1[metric.key][peakIndex])} ${metric.unit}`));

      const crosshair = svg("line", { class: "crosshair", y1: MARGIN.top, y2: MARGIN.top + plotHeight });
      const stockDot = svg("circle", { class: "hover-dot", r: 4, fill: "var(--stock)" });
      const stage1Dot = svg("circle", { class: "hover-dot", r: 4, fill: "var(--stage1)" });
      chart.append(crosshair, stockDot, stage1Dot);
      panelHosts[panelIndex].querySelector("svg")?.remove();
      panelHosts[panelIndex].append(chart);
      return { metric, chart, y, crosshair, stockDot, stage1Dot, stage1Path };
    });
    layout = { x, panels, innerWidth };
    if (activeIndex !== null) showIndex(activeIndex);
    if (drawn) for (const panel of panels) panel.stage1Path.style.removeProperty("--length");
  }

  function showIndex(index) {
    activeIndex = Math.max(0, Math.min(rpms.length - 1, index));
    const rpm = rpms[activeIndex];
    const px = layout.x(rpm);
    root.classList.add("is-hovering");
    const groups = [];
    for (const panel of layout.panels) {
      const { key, title, unit } = panel.metric;
      const stageValue = stage1[key][activeIndex];
      const stockValue = stockAt(key, rpm);
      panel.crosshair.setAttribute("x1", px);
      panel.crosshair.setAttribute("x2", px);
      panel.stage1Dot.setAttribute("cx", px);
      panel.stage1Dot.setAttribute("cy", panel.y(stageValue));
      panel.stockDot.style.display = stockValue === null ? "none" : "";
      if (stockValue !== null) {
        panel.stockDot.setAttribute("cx", px);
        panel.stockDot.setAttribute("cy", panel.y(stockValue));
      }
      groups.push(
        h("p", { class: "group", text: title }),
        h("div", { class: "row" }, h("span", { class: "line-key" }), h("strong", { text: `${format(stageValue)} ${unit}` }), h("span", { text: "Stage 1" })),
        h("div", { class: "row" }, h("span", { class: "line-key stock" }), h("strong", { text: stockValue === null ? "—" : `${format(stockValue)} ${unit}` }), h("span", { text: "Stock" }))
      );
    }
    tooltip.replaceChildren(h("p", { class: "rpm", text: `${rpm.toLocaleString()} rpm` }), ...groups);
    const tooltipWidth = tooltip.offsetWidth || 190;
    const left = px + 16 + tooltipWidth > root.clientWidth ? px - 16 - tooltipWidth : px + 16;
    tooltip.style.left = `${Math.max(0, left)}px`;
    live.textContent = `${rpm} rpm: power ${format(stage1.power[activeIndex])} horsepower Stage 1, torque ${format(stage1.torque[activeIndex])} newton metres Stage 1.`;
  }

  function hide() {
    activeIndex = null;
    root.classList.remove("is-hovering");
  }

  function indexFromPointer(event) {
    const bounds = root.getBoundingClientRect();
    const px = event.clientX - bounds.left;
    const rpm = minRpm + ((px - MARGIN.left) / layout.innerWidth) * (maxRpm - minRpm);
    let best = 0;
    for (let i = 1; i < rpms.length; i++) if (Math.abs(rpms[i] - rpm) < Math.abs(rpms[best] - rpm)) best = i;
    return best;
  }

  root.addEventListener("pointermove", (event) => layout && showIndex(indexFromPointer(event)));
  root.addEventListener("pointerleave", hide);
  root.addEventListener("focus", () => layout && showIndex(activeIndex ?? Math.floor(rpms.length / 2)));
  root.addEventListener("blur", hide);
  root.addEventListener("keydown", (event) => {
    const moves = { ArrowLeft: -1, ArrowRight: 1, PageDown: -10, PageUp: 10 };
    if (event.key in moves) {
      event.preventDefault();
      showIndex((activeIndex ?? 0) + moves[event.key]);
    } else if (event.key === "Home") showIndex(0);
    else if (event.key === "End") showIndex(rpms.length - 1);
    else if (event.key === "Escape") hide();
  });

  function tableView() {
    const rows = rpms.map((rpm, i) => ({ rpm, i })).filter(({ rpm }) => rpm % 500 === 0);
    return h(
      "details",
      { class: "dyno-table" },
      h("summary", { text: "View as table" }),
      h(
        "table",
        {},
        h("thead", {}, h("tr", {}, ...["rpm", "Stock hp", "Stage 1 hp", "Stock Nm", "Stage 1 Nm"].map((label) => h("th", { scope: "col", text: label })))),
        h(
          "tbody",
          {},
          ...rows.map(({ rpm, i }) =>
            h("tr", {}, ...[rpm.toLocaleString(), stockAt("power", rpm), stage1.power[i], stockAt("torque", rpm), stage1.torque[i]].map((value, column) => h(column ? "td" : "th", { text: value === null ? "—" : typeof value === "number" ? format(value) : value })))
          )
        )
      )
    );
  }

  // Draw the Stage 1 line the first time the chart scrolls into view.
  function animateIn() {
    if (drawn || reducedMotion()) {
      drawn = true;
      return;
    }
    drawn = true;
    for (const panel of layout.panels) panel.stage1Path.style.setProperty("--length", panel.stage1Path.getTotalLength());
    root.classList.add("will-draw");
    requestAnimationFrame(() => requestAnimationFrame(() => root.classList.add("is-drawn")));
    setTimeout(() => root.classList.remove("will-draw", "is-drawn"), 1800);
  }

  let frame;
  const resizeObserver = new ResizeObserver(() => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(render);
  });
  const visibility = new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting) && layout) {
      animateIn();
      visibility.disconnect();
    }
  }, { threshold: 0.3 });

  queueMicrotask(() => {
    render();
    resizeObserver.observe(root);
    visibility.observe(root);
  });
  return root;
}
