// Line icons for services, and generated artwork for products without a photo.
// All markup here is static; no data is ever inserted into it.

const SVG_NS = "http://www.w3.org/2000/svg";

const PATHS = {
  bolt: ["M13 2 4 14h7l-1 8 9-12h-7l1-8Z"],
  gauge: ["M4 15a8 8 0 1 1 16 0", "M12 15l4-5", "M6.5 19h11"],
  wave: ["M3 17c3 0 4-9 7-9s3 6 5 6 3-4 6-4", "M3 21h18"],
  scan: ["M4 8V5a1 1 0 0 1 1-1h3", "M16 4h3a1 1 0 0 1 1 1v3", "M20 16v3a1 1 0 0 1-1 1h-3", "M8 20H5a1 1 0 0 1-1-1v-3", "M4 12h3l2-3 3 6 2-3h6"],
  chip: ["M7 7h10v10H7z", "M10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4"],
  wrench: ["M14.7 6.3a4 4 0 0 0-5.4 5.2L3 17.8V21h3.2l6.3-6.3a4 4 0 0 0 5.2-5.4l-2.6 2.6-2.4-.6-.6-2.4 2.6-2.6Z"],
  filter: ["M4 7h16M4 12h16M4 17h16", "M7 4v16M17 4v16"],
  tools: ["M4 20l7-7", "M14 4a4 4 0 0 0 5 5l-4 4-5-5 4-4Z", "M3 5l3-2 3 3-2 3-3-1-1-3Z"],
  shirt: ["M8 4 4 7l2 4 2-1v10h8V10l2 1 2-4-4-3a4 4 0 0 1-8 0Z"],
  drop: ["M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11Z"],
  ticket: ["M4 7h16v3a2 2 0 0 0 0 4v3H4v-3a2 2 0 0 0 0-4V7Z", "M14 7v10"]
};

export function icon(name) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  for (const d of PATHS[name] ?? PATHS.bolt) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}

// Category → icon and tint. Unknown categories get a neutral tile.
const ART = [
  [/tun|remap|voucher|dyno/i, "ticket", ["#ffd6d3", "#fff4f3", "#b3261e"]],
  [/part|intake|exhaust|filter|intercooler/i, "filter", ["#d6e6ff", "#f3f7ff", "#1d4f9c"]],
  [/maint|oil|plug|service/i, "drop", ["#fff0c7", "#fffaf0", "#8a5a00"]],
  [/tool|logger|obd/i, "tools", ["#d9f5e3", "#f3fbf6", "#17663a"]],
  [/merch|apparel|cloth|hoodie|cap/i, "shirt", ["#e8e0ff", "#f7f4ff", "#4a3aa7"]]
];

export function productArt(category = "") {
  const [, name, [a, b, ink]] = ART.find(([pattern]) => pattern.test(category)) ?? [null, "bolt", ["#e8e8ed", "#f5f5f7", "#1d1d1f"]];
  const tile = document.createElement("div");
  tile.className = "product-art";
  tile.style.setProperty("--art-a", a);
  tile.style.setProperty("--art-b", b);
  tile.style.setProperty("--art-ink", ink);
  tile.append(icon(name));
  return tile;
}
