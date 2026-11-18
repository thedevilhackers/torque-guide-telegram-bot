// Single-series column chart (SVG) drawn at the container's real width, with hover/focus tooltips.
// Marks follow the house spec: <=24px bars, 4px rounded data-end, square baseline, 2px gaps, hairline grid.
import { esc } from "./ui.js";

function niceMax(v) {
  if (v <= 0) return 1;
  const exp = 10 ** Math.floor(Math.log10(v));
  const f = v / exp;
  const step = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return step * exp;
}

function barPath(x, y, w, h, r) {
  if (h <= 0.5) return "";
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

function render(container, data, { height, format, axisFormat, ariaLabel }) {
  const W = Math.max(container.clientWidth, 260);
  const padL = 58;
  const padR = 6;
  const padT = 12;
  const padB = 24;
  const innerW = W - padL - padR;
  const innerH = height - padT - padB;
  const max = niceMax(Math.max(0, ...data.map((d) => d.value)));
  const slot = innerW / Math.max(data.length, 1);
  const barW = Math.max(2, Math.min(24, slot - 2));
  const labelEvery = Math.max(1, Math.ceil(46 / slot));
  let svg = "";
  for (let i = 0; i <= 4; i += 1) {
    const v = (max / 4) * i;
    const y = Math.round(padT + innerH - (v / max) * innerH) + 0.5;
    svg += `<line class="grid-line" x1="${padL}" x2="${W - padR}" y1="${y}" y2="${y}"/>`;
    svg += `<text class="axis-label" x="${padL - 8}" y="${y + 4}" text-anchor="end">${esc(axisFormat(v))}</text>`;
  }
  data.forEach((d, i) => {
    const cx = padL + slot * i + slot / 2;
    const h = (Math.max(d.value, 0) / max) * innerH;
    svg += `<g class="col" tabindex="0" data-i="${i}" role="img" aria-label="${esc(d.tip ?? d.label)}: ${esc(format(d.value))}">
      <rect class="hit" x="${padL + slot * i}" y="${padT}" width="${slot}" height="${innerH}"/>
      <path class="bar" d="${barPath(cx - barW / 2, padT + innerH - h, barW, h, 4)}"/>
    </g>`;
    if (i % labelEvery === 0) svg += `<text class="axis-label" x="${cx}" y="${height - 6}" text-anchor="middle">${esc(d.label)}</text>`;
  });
  container.innerHTML = `<svg width="${W}" height="${height}" viewBox="0 0 ${W} ${height}" role="group" aria-label="${esc(ariaLabel)}">${svg}</svg><div class="chart-tip hidden"></div>`;
}

/**
 * Draws a column chart into `container` and keeps it sized to the container.
 * data: [{ label, value, tip? }]
 */
export function drawColumnChart(container, data, { height = 200, format = String, axisFormat = format, ariaLabel = "Chart" } = {}) {
  container.classList.add("chart");
  const opts = { height, format, axisFormat, ariaLabel };
  render(container, data, opts);
  let lastWidth = container.clientWidth;
  const ro = new ResizeObserver(() => {
    if (Math.abs(container.clientWidth - lastWidth) < 4) return;
    lastWidth = container.clientWidth;
    render(container, data, opts);
  });
  ro.observe(container);

  const show = (g) => {
    const tip = container.querySelector(".chart-tip");
    const i = Number(g.dataset.i);
    container.querySelectorAll(".bar.hover").forEach((b) => b.classList.remove("hover"));
    const bar = g.querySelector(".bar");
    bar.classList.add("hover");
    const hit = g.querySelector(".hit").getBoundingClientRect();
    const barBox = bar.getBoundingClientRect();
    const host = container.getBoundingClientRect();
    tip.innerHTML = `<span class="muted">${esc(data[i].tip ?? data[i].label)}</span><strong>${esc(format(data[i].value))}</strong>`;
    const left = Math.min(Math.max(hit.left - host.left + hit.width / 2, 70), host.width - 70);
    tip.style.left = `${left}px`;
    tip.style.top = `${Math.max((barBox.height ? barBox.top : hit.bottom) - host.top, 40)}px`;
    tip.classList.remove("hidden");
  };
  const hide = () => {
    container.querySelector(".chart-tip")?.classList.add("hidden");
    container.querySelectorAll(".bar.hover").forEach((b) => b.classList.remove("hover"));
  };
  container.addEventListener("pointerover", (e) => {
    const g = e.target.closest?.(".col");
    if (g) show(g);
  });
  container.addEventListener("pointerleave", hide);
  container.addEventListener("focusin", (e) => {
    const g = e.target.closest?.(".col");
    if (g) show(g);
  });
  container.addEventListener("focusout", hide);
  return () => ro.disconnect();
}
