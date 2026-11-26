// Technical illustrations for the Tuning Book, drawn as SVG when the page loads.
// Every part is built from a few primitives (round parts along an axis, upright round parts,
// boxes drawn at an angle) so the exploded views share one look.
const K = 0.34;   // how flat a round face looks when seen at an angle
const KV = 0.3;   // the same for faces seen from above
const INK = "#1d1d22";
const GUIDE = "#a39e97";
const RED = "#d81b16";
const BLUE = "#3f78c0";
const GREEN = "#2c9a6a";

const n = (v) => Math.round(v * 100) / 100;
const st = (w = 1.1) => `stroke="${INK}" stroke-width="${w}" stroke-linejoin="round"`;
const ell = (cx, cy, rx, ry, a = "") => `<ellipse cx="${n(cx)}" cy="${n(cy)}" rx="${n(rx)}" ry="${n(ry)}" ${a}/>`;

// ---------- Shared definitions (one hidden SVG for the whole booklet) ----------
const DEFS = `
<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
  <linearGradient id="gm" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fdfcfa"/><stop offset=".42" stop-color="#e2ded8"/><stop offset=".78" stop-color="#bdb7af"/><stop offset="1" stop-color="#9d978f"/></linearGradient>
  <linearGradient id="gmh" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#a7a199"/><stop offset=".3" stop-color="#f5f3f0"/><stop offset=".62" stop-color="#d6d1ca"/><stop offset="1" stop-color="#99938b"/></linearGradient>
  <linearGradient id="gd" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6b6b73"/><stop offset=".45" stop-color="#3a3a41"/><stop offset="1" stop-color="#1b1b20"/></linearGradient>
  <linearGradient id="gdh" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#232328"/><stop offset=".35" stop-color="#5d5d66"/><stop offset="1" stop-color="#1e1e23"/></linearGradient>
  <linearGradient id="gr" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff6a60"/><stop offset=".5" stop-color="#e0231c"/><stop offset="1" stop-color="#a50f0b"/></linearGradient>
  <linearGradient id="grh" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#a50f0b"/><stop offset=".35" stop-color="#ff6a60"/><stop offset="1" stop-color="#b3120d"/></linearGradient>
  <linearGradient id="gb" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8fb6e6"/><stop offset=".5" stop-color="#4a82c8"/><stop offset="1" stop-color="#2a5a96"/></linearGradient>
  <linearGradient id="ghot" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7a6a66"/><stop offset=".5" stop-color="#4a3633"/><stop offset="1" stop-color="#241615"/></linearGradient>
  <radialGradient id="gface" cx=".38" cy=".32" r=".85"><stop offset="0" stop-color="#ffffff"/><stop offset=".6" stop-color="#e4e0da"/><stop offset="1" stop-color="#c3bdb5"/></radialGradient>
  <radialGradient id="gfaced" cx=".38" cy=".32" r=".85"><stop offset="0" stop-color="#6a6a72"/><stop offset="1" stop-color="#26262b"/></radialGradient>
  <radialGradient id="gfacer" cx=".38" cy=".32" r=".85"><stop offset="0" stop-color="#ff8a82"/><stop offset="1" stop-color="#c3150f"/></radialGradient>
  <radialGradient id="gfaceh" cx=".38" cy=".32" r=".85"><stop offset="0" stop-color="#8a6c66"/><stop offset="1" stop-color="#2a1a18"/></radialGradient>
  <radialGradient id="gshadow" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#000" stop-opacity=".22"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
  <radialGradient id="gglow" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#ff2d26" stop-opacity=".55"/><stop offset="1" stop-color="#ff2d26" stop-opacity="0"/></radialGradient>
  <radialGradient id="gspray" cx=".5" cy="0" r="1"><stop offset="0" stop-color="#3f78c0" stop-opacity=".55"/><stop offset="1" stop-color="#3f78c0" stop-opacity="0"/></radialGradient>
  <pattern id="pCore" width="5" height="14" patternUnits="userSpaceOnUse"><rect width="5" height="14" fill="#8e8982"/><line x1="2.5" y1="0" x2="2.5" y2="14" stroke="#e6e2dc" stroke-width="1.1"/><rect y="0" width="5" height="4.5" fill="#efece7"/><line x1="0" y1="4.5" x2="5" y2="4.5" stroke="#6f6a63" stroke-width=".6"/></pattern>
  <pattern id="pCellsFine" width="5" height="5" patternUnits="userSpaceOnUse"><rect width="5" height="5" fill="#3a3a41"/><rect x=".8" y=".8" width="3.4" height="3.4" fill="#cfcac3"/></pattern>
  <pattern id="pCellsWide" width="10" height="10" patternUnits="userSpaceOnUse"><rect width="10" height="10" fill="#3a3a41"/><rect x="1" y="1" width="8" height="8" fill="#cfcac3"/></pattern>
  <pattern id="pPleat" width="8" height="10" patternUnits="userSpaceOnUse"><path d="M0 10 L4 0 L8 10" fill="none" stroke="#7d120e" stroke-width="1"/></pattern>
  <marker id="aR" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="${RED}"/></marker>
  <marker id="aB" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="${BLUE}"/></marker>
  <marker id="aK" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="${INK}"/></marker>
  <marker id="aL" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="#e0605a"/></marker>
</defs></svg>`;

// ---------- Primitives ----------

// A round part lying along the x-axis, its left face toward the viewer.
function cylX(x0, x1, cy, r, o = {}) {
  const rx = r * K;
  let s = `<path d="M${n(x0)} ${n(cy - r)} L${n(x1)} ${n(cy - r)} A${n(rx)} ${n(r)} 0 0 1 ${n(x1)} ${n(cy + r)} L${n(x0)} ${n(cy + r)} Z" fill="${o.fill || "url(#gm)"}" ${st(o.w)}/>`;
  if (!o.noFace) s += ell(x0, cy, rx, r, `fill="${o.face || "url(#gface)"}" ${st(o.w)}`);
  return s;
}

// A tapered round part: radius r0 at x0 (the visible face), r1 at x1.
function coneX(x0, x1, cy, r0, r1, o = {}) {
  let s = `<path d="M${n(x0)} ${n(cy - r0)} L${n(x1)} ${n(cy - r1)} A${n(r1 * K)} ${n(r1)} 0 0 1 ${n(x1)} ${n(cy + r1)} L${n(x0)} ${n(cy + r0)} Z" fill="${o.fill || "url(#gm)"}" ${st(o.w)}/>`;
  if (!o.noFace) s += ell(x0, cy, r0 * K, r0, `fill="${o.face || "url(#gface)"}" ${st(o.w)}`);
  return s;
}

// An upright round part, its top face toward the viewer.
function cylY(cx, y0, y1, r, o = {}) {
  const ry = r * KV;
  let s = `<path d="M${n(cx - r)} ${n(y0)} L${n(cx - r)} ${n(y1)} A${n(r)} ${n(ry)} 0 0 0 ${n(cx + r)} ${n(y1)} L${n(cx + r)} ${n(y0)} Z" fill="${o.fill || "url(#gmh)"}" ${st(o.w)}/>`;
  if (!o.noFace) s += ell(cx, y0, r, ry, `fill="${o.face || "url(#gface)"}" ${st(o.w)}`);
  return s;
}

// A point on a face seen along the x-axis.
const onFace = (cx, cy, r, a) => [cx + K * r * Math.cos(a), cy + r * Math.sin(a)];

// Holes or bolts around a face.
function bolts(cx, cy, r, count, size, fill = "#3a3a41", start = 0) {
  let s = "";
  for (let i = 0; i < count; i++) {
    const [x, y] = onFace(cx, cy, r, start + (i / count) * Math.PI * 2);
    s += ell(x, y, size * K * 1.4, size, `fill="${fill}" stroke="${INK}" stroke-width=".6"`);
  }
  return s;
}

// Curved blades on a face (compressor or turbine wheel seen end-on).
function faceBlades(cx, cy, rHub, rTip, count, sweep, stroke = INK) {
  let s = "";
  for (let i = 0; i < count; i++) {
    const a0 = (i / count) * Math.PI * 2;
    const pts = [];
    for (let k = 0; k <= 8; k++) {
      const r = rHub + ((rTip - rHub) * k) / 8;
      pts.push(onFace(cx, cy, r, a0 + sweep * (k / 8)));
    }
    s += `<path d="M${pts.map((p) => p.map(n).join(" ")).join(" L")}" fill="none" stroke="${stroke}" stroke-width=".9"/>`;
  }
  return s;
}

// Blades seen along the tapered body of a wheel (only the half facing us).
function bodyBlades(x0, x1, cy, r0, r1, count, twist, stroke = INK) {
  let s = "";
  for (let i = 0; i < count; i++) {
    const t0 = (i / count) * Math.PI * 2;
    let d = "";
    let pen = false;
    for (let k = 0; k <= 16; k++) {
      const u = k / 16;
      const x = x0 + (x1 - x0) * u;
      const r = r0 + (r1 - r0) * u;
      const t = t0 + twist * u;
      const visible = Math.cos(t) >= 0;
      const px = x + K * r * Math.cos(t);
      const py = cy + r * Math.sin(t);
      if (visible) { d += `${pen ? "L" : "M"}${n(px)} ${n(py)} `; pen = true; } else pen = false;
    }
    if (d) s += `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="1"/>`;
  }
  return s;
}

// A box drawn at an angle: front face at (x, y, w, h), going back by depth d.
const DX = 0.5, DY = -0.38;
function box(x, y, w, h, d, o = {}) {
  const dx = d * DX, dy = d * DY;
  const top = `M${n(x)} ${n(y)} L${n(x + dx)} ${n(y + dy)} L${n(x + w + dx)} ${n(y + dy)} L${n(x + w)} ${n(y)} Z`;
  const side = `M${n(x + w)} ${n(y)} L${n(x + w + dx)} ${n(y + dy)} L${n(x + w + dx)} ${n(y + h + dy)} L${n(x + w)} ${n(y + h)} Z`;
  return `<path d="${top}" fill="${o.top || "#f3f1ed"}" ${st(o.w)}/><path d="${side}" fill="${o.side || "#aca69e"}" ${st(o.w)}/><rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" fill="${o.front || "url(#gm)"}" ${st(o.w)}/>`;
}
// Draw things on the top face of a box: (u, v) runs across and back.
const topFace = (x, y) => `matrix(1 0 ${DX} ${DY} ${n(x)} ${n(y)})`;

// A soft shadow on the floor.
const shadow = (cx, cy, rx, ry = 9) => ell(cx, cy, rx, ry, `fill="url(#gshadow)"`);

// A numbered callout with a leader line from the part.
function callout(num, px, py, tx, ty, dark = false) {
  return `<line x1="${n(px)}" y1="${n(py)}" x2="${n(tx)}" y2="${n(ty)}" stroke="${dark ? "#cfcac3" : INK}" stroke-width=".8"/>` +
    `<circle cx="${n(px)}" cy="${n(py)}" r="2.4" fill="${dark ? "#fff" : INK}"/>` +
    `<circle cx="${n(tx)}" cy="${n(ty)}" r="13" fill="${RED}"/>` +
    `<text x="${n(tx)}" y="${n(ty + 5.3)}" text-anchor="middle" font-family="Barlow Condensed" font-weight="700" font-size="15.5" fill="#fff">${num}</text>`;
}

// Labels can be translated: another edition sets window.TR = { "English label": "translation" }.
const tr = (t) => {
  if (typeof t !== "string" || !window.TR) return t;
  if (window.TR[t] !== undefined) return window.TR[t];
  const m = t.match(/^Cylinder (\d+)$/);
  return m && window.TR.Cylinder ? `${window.TR.Cylinder} ${m[1]}` : t;
};
const label = (x, y, text, o = {}) =>
  `<text x="${n(x)}" y="${n(y)}" text-anchor="${o.anchor || "start"}" font-family="${o.family || "Barlow Condensed"}" font-weight="${o.weight || 600}" font-size="${o.size || 15.5}" fill="${o.fill || INK}" letter-spacing="${window.TR ? 0 : o.ls || 0}">${tr(text)}</text>`;

const svg = (w, h, body, a = "") => `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" ${a}>${body}</svg>`;
const axis = (x0, x1, y) => `<line x1="${x0}" y1="${y}" x2="${x1}" y2="${y}" stroke="${GUIDE}" stroke-width="1" stroke-dasharray="7 5"/>`;

// ---------- The figures ----------
const FIG = {};

// Turbocharger, exploded along its shaft.
FIG.turbo = (dark = false) => {
  const cy = 200;
  let s = axis(8, 752, cy);
  if (dark) s = `<ellipse cx="380" cy="200" rx="360" ry="150" fill="url(#gglow)"/>` + s;
  // Turbine housing (far right): outlet, inlet flange, scroll.
  s += shadow(690, 330, 90);
  s += cylX(712, 752, cy + 6, 50, { fill: "url(#ghot)", noFace: true });
  s += `<rect x="658" y="262" width="66" height="44" rx="4" fill="url(#ghot)" ${st()}/>` + bolts(691, 302, 0, 1, 0) +
    ell(668, 296, 4, 4, `fill="#1b1b20"`) + ell(714, 296, 4, 4, `fill="#1b1b20"`);
  s += cylX(650, 716, cy, 96, { fill: "url(#ghot)", face: "url(#gfaceh)" });
  s += ell(650, cy, 52 * K, 52, `fill="#120c0b" ${st()}`);
  s += bolts(650, cy, 80, 8, 4, "#1b1b20", 0.2);
  // Wastegate actuator and its rod.
  s += `<line x1="702" y1="74" x2="702" y2="112" stroke="${INK}" stroke-width="3"/>` + `<rect x="694" y="108" width="20" height="10" rx="2" fill="url(#gd)" ${st()}/>`;
  s += cylY(702, 38, 70, 32, { fill: "url(#grh)", face: "url(#gfacer)" });
  // Turbine wheel and shaft.
  s += shadow(560, 300, 70, 7);
  s += coneX(566, 622, cy, 60, 24, { fill: "url(#ghot)", noFace: true }) + bodyBlades(566, 622, cy, 60, 24, 11, 0.9, "#c9b7b2");
  s += cylX(556, 566, cy, 60, { fill: "url(#ghot)", face: "url(#gfaceh)" });
  s += cylX(470, 556, cy, 7, { fill: "url(#gm)" });
  // Bearing housing (CHRA) with oil feed and drain.
  s += shadow(400, 300, 80, 8);
  s += `<rect x="384" y="246" width="32" height="18" rx="2" fill="url(#gd)" ${st()}/>`;
  s += cylX(440, 452, cy, 60, { noFace: true });
  s += cylX(352, 440, cy, 48);
  s += cylX(342, 352, cy, 62);
  s += ell(342, cy, 14 * K, 14, `fill="#2a2a30" ${st()}`);
  s += cylY(398, 128, 154, 12, { fill: "url(#grh)", face: "url(#gfacer)" });
  s += bolts(342, cy, 48, 6, 3.4, "#3a3a41", 0.5);
  // Backplate.
  s += cylX(298, 306, cy, 92);
  s += ell(298, cy, 20 * K, 20, `fill="#2a2a30" ${st()}`);
  s += bolts(298, cy, 80, 10, 3.2, "#8c867e");
  // Compressor wheel and nut.
  s += shadow(240, 292, 55, 7);
  s += cylX(262, 270, cy, 62, { noFace: true });
  s += coneX(206, 264, cy, 22, 62, { noFace: true }) + bodyBlades(206, 264, cy, 22, 62, 12, -1.1);
  s += ell(206, cy, 22 * K, 22, `fill="url(#gface)" ${st()}`) + faceBlades(206, cy, 7, 22, 6, 0.9);
  s += cylX(196, 206, cy, 8, { fill: "url(#gd)", face: "url(#gfaced)" });
  // Compressor housing: outlet, scroll, inlet.
  s += shadow(100, 330, 85);
  s += cylY(130, 60, 140, 26);
  s += cylX(78, 150, cy, 98);
  s += bolts(78, cy, 86, 8, 3.6, "#8c867e", 0.3);
  s += cylX(28, 80, cy, 48);
  s += ell(28, cy, 36 * K, 36, `fill="#1d1d22" ${st()}`);
  s += faceBlades(28, cy, 6, 30, 6, 0.9, "#6a6a72");
  // Callouts.
  if (!dark) s += callout(1, 52, 156, 52, 60, dark) + callout(2, 238, 150, 238, 60, dark) + callout(3, 302, 120, 330, 60, dark) +
    callout(4, 398, 132, 430, 60, dark) + callout(5, 512, 196, 512, 110, dark) + callout(6, 668, 270, 600, 350, dark) + callout(7, 720, 56, 745, 120, dark) +
    callout(8, 400, 260, 400, 350, dark);
  return svg(772, 370, `<g transform="translate(-10 0)">${s}</g>`);
};

// Intercooler: end tanks pulled away from the core.
FIG.intercooler = () => {
  let s = "";
  const y = 120, h = 150, d = 46;
  s += shadow(420, 312, 300, 10);
  // Outlet pipe (far side), right tank.
  s += cylX(668, 735, 205, 22, { fill: "url(#gb)", noFace: true });
  s += tank(618, y + 4, 52, h - 8, d, false);
  // Core.
  s += box(190, y, 380, h, d, { front: "url(#pCore)", top: "#d8d4ce", side: "#8e8982" });
  s += `<rect x="190" y="${y}" width="380" height="${h}" fill="none" ${st(1.4)}/>`;
  // Left tank and inlet pipe.
  s += tank(98, y + 4, 52, h - 8, d, true);
  s += cylX(32, 100, 205, 22, { fill: "url(#gr)", face: "url(#gfacer)" });
  s += ell(32, 205, 14 * K, 14, `fill="#4a0805"`);
  // Exploded guides.
  for (const yy of [y + 14, y + h - 14]) s += `<line x1="152" y1="${yy}" x2="188" y2="${yy}" stroke="${GUIDE}" stroke-dasharray="5 4"/><line x1="572" y1="${yy}" x2="616" y2="${yy}" stroke="${GUIDE}" stroke-dasharray="5 4"/>`;
  // Air through the fins.
  for (const x of [260, 380, 500]) s += `<path d="M${x - 20} 340 Q ${x} 320 ${x - 6} 286" fill="none" stroke="${BLUE}" stroke-width="2.4" marker-end="url(#aB)"/>`;
  s += label(380, 356, "Outside air flows through the fins", { anchor: "middle", fill: BLUE, size: 15.6 });
  s += `<path d="M6 160 L52 160 L52 182" fill="none" stroke="${RED}" stroke-width="2.4" marker-end="url(#aR)"/>` + label(6, 150, "Hot air from turbo", { fill: RED, size: 15.6 });
  s += `<path d="M700 236 L700 262 L752 262" fill="none" stroke="${BLUE}" stroke-width="2.4" marker-end="url(#aB)"/>` + label(752, 282, "Cool air to engine", { anchor: "end", fill: BLUE, size: 15.6 });
  s += callout(1, 124, 112, 124, 40) + callout(2, 300, 150, 300, 40) + callout(3, 470, 190, 470, 40) + callout(4, 646, 112, 646, 40) + callout(5, 82, 226, 82, 300);
  return svg(760, 365, s);

  function tank(x, y0, w, hh, dd, left) {
    // A tapered end tank: narrow where the pipe joins, full height at the core.
    const dx = dd * DX, dy = dd * DY;
    const a = left ? [x, y0 + 26] : [x, y0], b = left ? [x + w, y0] : [x + w, y0 + 26];
    const c = left ? [x + w, y0 + hh] : [x + w, y0 + hh - 26], e = left ? [x, y0 + hh - 26] : [x, y0 + hh];
    const front = `M${a} L${b} L${c} L${e} Z`;
    const top = `M${a} L${a[0] + dx},${a[1] + dy} L${b[0] + dx},${b[1] + dy} L${b} Z`;
    const side = `M${b} L${b[0] + dx},${b[1] + dy} L${c[0] + dx},${c[1] + dy} L${c} Z`;
    return `<path d="${top}" fill="#f1eee9" ${st()}/><path d="${side}" fill="#a39d95" ${st()}/><path d="${front}" fill="url(#gm)" ${st()}/>`;
  }
};

// ECU: cover, circuit board and base pulled apart.
FIG.ecu = () => {
  let s = shadow(330, 352, 210, 10);
  // Base with connector.
  s += box(110, 290, 300, 36, 180, { front: "url(#gd)", top: "#4a4a52", side: "#25252a" });
  s += `<rect x="150" y="296" width="150" height="24" rx="3" fill="#111114" stroke="#000" stroke-width="1"/>`;
  for (let i = 0; i < 22; i++) s += `<rect x="${156 + i * 6.5}" y="302" width="3.5" height="12" fill="#b9b4ad"/>`;
  // Circuit board with chips.
  s += box(122, 196, 276, 6, 160, { front: "#17302a", top: "#1f4a3d", side: "#123026" });
  let b = "";
  b += `<rect x="70" y="52" width="58" height="56" fill="#16161a" stroke="${RED}" stroke-width="3"/>`;
  b += `<rect x="150" y="70" width="34" height="22" fill="#16161a"/><rect x="200" y="74" width="20" height="14" fill="#16161a"/>`;
  b += `<rect x="18" y="120" width="44" height="26" fill="#16161a"/><rect x="214" y="118" width="40" height="28" fill="#2b2b31"/>`;
  for (let i = 0; i < 9; i++) b += `<rect x="${20 + i * 26}" y="16" width="10" height="8" fill="#d8b04a"/>`;
  for (let i = 0; i < 6; i++) b += `<circle cx="${150 + i * 14}" cy="128" r="5" fill="#8a8a92"/>`;
  for (let i = 0; i < 14; i++) b += `<line x1="${132 + i * 3}" y1="60" x2="${132 + i * 3}" y2="108" stroke="#2f6b57" stroke-width="1"/>`;
  s += `<g transform="${topFace(122, 196)}">${b}</g>`;
  // Cover with cooling ribs.
  s += box(110, 92, 300, 16, 180, { top: "#e9e6e1", side: "#9c968e" });
  let r = "";
  for (let i = 0; i < 12; i++) r += `<line x1="${24 + i * 22}" y1="20" x2="${24 + i * 22}" y2="160" stroke="#b8b2aa" stroke-width="4"/>`;
  s += `<g transform="${topFace(110, 92)}">${r}</g>`;
  // Guides.
  for (const x of [112, 408]) s += `<line x1="${x}" y1="110" x2="${x}" y2="196" stroke="${GUIDE}" stroke-dasharray="5 4"/><line x1="${x}" y1="204" x2="${x}" y2="290" stroke="${GUIDE}" stroke-dasharray="5 4"/>`;
  s += callout(1, 300, 60, 470, 40) + callout(2, 360, 170, 480, 150) + callout(3, 186, 168, 60, 150) + callout(4, 230, 308, 60, 300) + callout(5, 380, 270, 500, 270);
  return svg(560, 370, s);
};

// The path air and exhaust take through a turbo engine, with the ECU and its sensors.
FIG.airpath = () => {
  let s = "";
  const pipe = (d, color, w = 11, marker = "") => `<path d="${d}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" ${marker}/>`;
  // Pipes.
  s += pipe("M96 92 L196 92", BLUE);
  s += pipe("M268 92 L372 92", "#e0605a");
  s += pipe("M486 92 L566 92 L566 150", BLUE);
  s += pipe("M640 330 L640 400 L272 400", RED);
  s += pipe("M196 400 L118 400", RED);
  s += pipe("M62 400 L18 400", RED);
  // Flow arrows.
  for (const [x, y, c, m] of [[140, 92, BLUE, "aB"], [320, 92, "#e0605a", "aL"], [520, 92, BLUE, "aB"], [450, 400, RED, "aR"], [160, 400, RED, "aR"]]) {
    const dir = y === 400 ? -1 : 1;
    s += `<path d="M${x - 10 * dir} ${y} L${x + 10 * dir} ${y}" stroke="#fff" stroke-width="2.4" marker-end="url(#${m})"/>`;
  }
  // Nodes.
  const node = (x, y, w, h, title, sub, o = {}) =>
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="${o.fill || "#fff"}" stroke="${o.stroke || INK}" stroke-width="1.4"/>` +
    label(x + w / 2, y + h / 2 - (sub ? 2 : -5), title, { anchor: "middle", size: 16.8, weight: 700, fill: o.text || INK, ls: 0.5 }) +
    (sub ? label(x + w / 2, y + h / 2 + 14, sub, { anchor: "middle", size: 13.8, weight: 500, fill: o.sub || "#5b5b63" }) : "");
  s += node(14, 66, 82, 52, "AIR FILTER", "clean air in");
  s += node(196, 62, 72, 60, "TURBO", "compressor", { stroke: RED });
  s += node(372, 62, 114, 60, "INTERCOOLER", "cools the air");
  s += node(522, 150, 88, 40, "THROTTLE", "");
  s += node(196, 370, 76, 60, "TURBO", "turbine", { stroke: RED });
  s += node(62, 376, 56, 48, "CAT", "", {});
  // The turbo's two halves share one shaft.
  s += `<line x1="232" y1="122" x2="232" y2="370" stroke="${RED}" stroke-width="3" stroke-dasharray="8 5"/>`;
  s += label(240, 250, "same shaft", { size: 14.4, fill: RED, weight: 600 });
  // Engine block.
  s += `<rect x="500" y="200" width="200" height="130" rx="12" fill="url(#gd)" stroke="${INK}" stroke-width="1.4"/>`;
  for (let i = 0; i < 4; i++) s += `<circle cx="${538 + i * 42}" cy="252" r="16" fill="#111114" stroke="#8a8a92" stroke-width="2"/><circle cx="${538 + i * 42}" cy="252" r="5" fill="${RED}"/>`;
  s += label(600, 310, "ENGINE", { anchor: "middle", fill: "#fff", size: 18, weight: 700, ls: 1 });
  // ECU and its wiring.
  s += `<rect x="318" y="200" width="120" height="78" rx="10" fill="#111114"/>`;
  s += label(378, 236, "ECU", { anchor: "middle", fill: "#fff", size: 24, weight: 700, ls: 1 }) + label(378, 256, "the car's computer", { anchor: "middle", fill: "#cfcac3", size: 13.8, weight: 500 });
  const wire = (d, out) => `<path d="${d}" fill="none" stroke="${out ? RED : "#6b6b73"}" stroke-width="1.5" ${out ? "" : 'stroke-dasharray="4 3"'}/>`;
  const sensor = (x, y, t, a = "middle", dy = -12) => `<circle cx="${x}" cy="${y}" r="5" fill="#fff" stroke="${INK}" stroke-width="1.5"/>` + label(x, y + dy, t, { anchor: a, size: 13.8, weight: 600, fill: "#3a3a41" });
  s += wire("M150 98 L150 160 L318 220") + sensor(150, 92, "AIR MASS", "middle", -12);
  s += wire("M528 98 L528 128 L470 128 L438 212") + sensor(528, 92, "BOOST / TEMP", "middle", -12);
  s += wire("M157 400 L157 330 L330 270") + sensor(157, 400, "LAMBDA", "middle", 30);
  s += wire("M680 200 L680 172 L462 172 L438 200") + sensor(680, 200, "KNOCK", "start", -14).replace('x="680" y="186" text-anchor="start"', 'x="690" y="166" text-anchor="start"');
  s += wire("M438 260 L500 260", true) + label(470, 252, "fuel + spark", { anchor: "middle", size: 13.2, fill: RED });
  s += wire("M330 278 L262 360", true) + label(300, 350, "wastegate", { anchor: "start", size: 13.2, fill: RED });
  s += wire("M438 228 L522 176", true);
  // Legend.
  const ly = 456;
  s += `<line x1="14" y1="${ly}" x2="44" y2="${ly}" stroke="${BLUE}" stroke-width="8" stroke-linecap="round"/>` + label(52, ly + 4, "Cool intake air", { size: 14.4, weight: 500 });
  s += `<line x1="170" y1="${ly}" x2="200" y2="${ly}" stroke="#e0605a" stroke-width="8" stroke-linecap="round"/>` + label(208, ly + 4, "Hot compressed air", { size: 14.4, weight: 500 });
  s += `<line x1="350" y1="${ly}" x2="380" y2="${ly}" stroke="${RED}" stroke-width="8" stroke-linecap="round"/>` + label(388, ly + 4, "Exhaust gas", { size: 14.4, weight: 500 });
  s += `<line x1="490" y1="${ly}" x2="520" y2="${ly}" stroke="#6b6b73" stroke-width="1.5" stroke-dasharray="4 3"/>` + label(528, ly + 4, "Sensor reading", { size: 14.4, weight: 500 });
  s += `<line x1="630" y1="${ly}" x2="660" y2="${ly}" stroke="${RED}" stroke-width="1.5"/>` + label(668, ly + 4, "ECU command", { size: 14.4, weight: 500 });
  return svg(760, 470, s);
};

// Two boost maps, stock and Stage 1, on the same colour scale.
FIG.maps = () => {
  const rpm = [1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000, 5500, 6000];
  const load = [100, 90, 80, 70, 60, 50, 40];
  const stock = (i, j) => { const l = load[j] / 100; const r = rpm[i]; const spool = Math.min(1, (r - 1100) / 1300); return Math.max(0, (1.2 * spool * (r > 5000 ? 1 - (r - 5000) / 6000 : 1)) * Math.pow(l, 1.6)); };
  const tuned = (i, j) => { const l = load[j] / 100; const r = rpm[i]; const spool = Math.min(1, (r - 1050) / 1250); return Math.max(0, (1.55 * spool * (r > 5000 ? 1 - (r - 5000) / 5200 : 1)) * Math.pow(l, 1.6)); };
  const ramp = ["#fdf0ee", "#f9d5d1", "#f3aca5", "#ea7c73", "#db4b40", "#bf2219", "#8f120d", "#5e0a07"];
  const color = (v) => { const p = Math.min(0.9999, v / 1.6) * (ramp.length - 1); const i = Math.floor(p); return mix(ramp[i], ramp[i + 1], p - i); };
  let s = "";
  const cw = 31, ch = 25;
  for (const [gx, title, fn] of [[62, "STOCK", stock], [432, "STAGE 1", tuned]]) {
    s += label(gx, 22, title, { size: 18, weight: 700, ls: 1, fill: title === "STOCK" ? INK : RED });
    for (let i = 0; i < rpm.length; i++) for (let j = 0; j < load.length; j++)
      s += `<rect x="${gx + i * cw}" y="${34 + j * ch}" width="${cw - 2}" height="${ch - 2}" rx="2" fill="${color(fn(i, j))}"/>`;
    for (let i = 0; i < rpm.length; i += 2) s += label(gx + i * cw + cw / 2, 34 + load.length * ch + 15, rpm[i], { anchor: "middle", size: 13.2, weight: 500, fill: "#5b5b63" });
    s += label(gx + (rpm.length * cw) / 2, 34 + load.length * ch + 32, "Engine speed (rpm)", { anchor: "middle", size: 13.8, weight: 600, fill: "#3a3a41" });
    for (let j = 0; j < load.length; j += 2) s += label(gx - 6, 34 + j * ch + 16, `${load[j]}%`, { anchor: "end", size: 13.2, weight: 500, fill: "#5b5b63" });
  }
  s += label(14, 120, "Pedal / load", { size: 13.8, weight: 600, fill: "#3a3a41" }).replace("<text", `<text transform="rotate(-90 14 120)"`).replace(`x="14" y="120"`, `x="14" y="128" `);
  // Colour scale.
  const ly = 290;
  for (let k = 0; k < 64; k++) s += `<rect x="${250 + k * 4}" y="${ly}" width="4.4" height="10" fill="${color((k / 63) * 1.6)}"/>`;
  for (const v of [0, 0.4, 0.8, 1.2, 1.6]) s += label(250 + (v / 1.6) * 256, ly + 24, `${v.toFixed(1)}`, { anchor: "middle", size: 13.2, weight: 500, fill: "#5b5b63" });
  s += label(242, ly + 9, "Boost target (bar)", { anchor: "end", size: 13.8, weight: 600, fill: "#3a3a41" });
  return svg(760, 322, s);

  function mix(a, b, t) {
    const pa = [1, 3, 5].map((k) => parseInt(a.slice(k, k + 2), 16)), pb = [1, 3, 5].map((k) => parseInt(b.slice(k, k + 2), 16));
    return `rgb(${pa.map((v, k) => Math.round(v + (pb[k] - v) * t)).join(",")})`;
  }
};

// Intake: airbox, panel filter and silicone hose.
FIG.intake = () => {
  let s = shadow(200, 352, 170, 9);
  // Airbox base and snorkel.
  s += box(70, 270, 230, 54, 120, { front: "url(#gd)", top: "#4a4a52", side: "#232328" });
  s += cylX(16, 72, 300, 22, { fill: "url(#gd)", face: "url(#gfaced)" }) + ell(16, 300, 14 * K, 14, `fill="#0c0c0e"`);
  // Panel filter.
  s += box(82, 178, 206, 16, 104, { front: "url(#gr)", top: "#f1d9d6", side: "#9b100c" });
  s += `<g transform="${topFace(82, 178)}"><rect x="8" y="8" width="190" height="88" fill="url(#pPleat)"/><rect x="8" y="8" width="190" height="88" fill="none" stroke="#7d120e" stroke-width="1.4"/></g>`;
  // Lid.
  s += box(70, 92, 230, 30, 120, { front: "url(#gd)", top: "#55555d", side: "#25252a" });
  s += cylX(300 + 60 * DX * 0, 330, 106, 18, { fill: "url(#gd)", noFace: true });
  for (const x of [72, 298]) s += `<line x1="${x}" y1="124" x2="${x}" y2="176" stroke="${GUIDE}" stroke-dasharray="5 4"/><line x1="${x}" y1="196" x2="${x}" y2="268" stroke="${GUIDE}" stroke-dasharray="5 4"/>`;
  // Silicone hose with clamps, toward the turbo.
  s += shadow(560, 300, 160, 8);
  s += cylX(690, 712, 200, 36, { fill: "url(#gmh)", noFace: true });
  s += cylX(420, 700, 200, 32, { fill: "url(#gr)", face: "url(#gfacer)" });
  s += ell(420, 200, 22 * K, 22, `fill="#4a0805"`);
  for (const x of [440, 670]) s += cylX(x, x + 12, 200, 34.5, { fill: "url(#gm)", noFace: true }) + `<rect x="${x + 2}" y="160" width="8" height="10" fill="url(#gm)" ${st(0.8)}/>`;
  s += label(706, 150, "to turbo", { anchor: "middle", size: 15.6, weight: 600, fill: "#3a3a41" });
  s += `<path d="M330 106 C 380 106, 380 200, 412 200" fill="none" stroke="${BLUE}" stroke-width="2.4" stroke-dasharray="6 4" marker-end="url(#aB)"/>`;
  s += callout(1, 200, 96, 200, 30) + callout(2, 150, 172, 30, 172) + callout(3, 40, 296, 40, 240) + callout(4, 560, 170, 560, 110) + callout(5, 676, 236, 676, 290);
  return svg(760, 370, s);
};

// Downpipe with a high-flow catalyst, plus the two catalyst faces compared.
FIG.downpipe = () => {
  let s = shadow(400, 268, 340, 8);
  const tube = (d) => `<path d="${d}" fill="none" stroke="${INK}" stroke-width="50" stroke-linecap="butt"/><path d="${d}" fill="none" stroke="#a7a199" stroke-width="47"/><path d="${d}" fill="none" stroke="#d9d5cf" stroke-width="36"/><path d="${d}" fill="none" stroke="#f7f5f2" stroke-width="10" transform="translate(0 -11)"/>`;
  // Outgoing pipe (far right), catalyst, incoming bend.
  s += tube("M520 200 L700 200");
  s += ell(700, 200, 25 * K, 25, `fill="url(#gface)" ${st()}`) + ell(700, 200, 18 * K, 18, `fill="#2a2a30"`);
  s += cylX(352, 520, 200, 50, { face: "url(#gface)" });
  s += `<rect x="372" y="152" width="128" height="96" fill="none" stroke="#b8b2aa" stroke-width="1" stroke-dasharray="3 3"/>`;
  s += label(436, 205, "HIGH-FLOW CAT", { anchor: "middle", size: 15.6, weight: 700, fill: "#3a3a41", ls: 0.5 });
  s += tube("M70 64 C 190 64, 236 96, 268 156 S 320 200, 354 200");
  s += ell(60, 64, 12, 34, `fill="url(#gface)" ${st()}`) + ell(60, 64, 7, 22, `fill="#2a2a30"`);
  s += bolts(60, 64, 28, 4, 3.2, "#8c867e", 0.78);
  // Lambda sensor bosses before and after the catalyst.
  for (const x of [318, 560]) s += cylY(x, 140, 172, 9, { fill: "url(#gdh)", face: "url(#gfaced)" }) + cylY(x, 128, 142, 6, { fill: "url(#gdh)", face: "url(#gfaced)" });
  s += callout(1, 60, 96, 60, 150) + callout(2, 230, 108, 230, 34) + callout(3, 440, 154, 440, 100) + callout(4, 700, 172, 700, 120) + callout(5, 318, 128, 318, 90) + callout(5, 560, 128, 560, 90);
  // Catalyst faces compared.
  const face = (cx, pat, t1, t2) => `<clipPath id="c${pat}"><circle cx="${cx}" cy="330" r="44"/></clipPath><circle cx="${cx}" cy="330" r="48" fill="url(#gm)" ${st()}/><rect x="${cx - 44}" y="286" width="88" height="88" fill="url(#${pat})" clip-path="url(#c${pat})"/><circle cx="${cx}" cy="330" r="44" fill="none" ${st()}/>` +
    label(cx + 62, 322, t1, { size: 16.8, weight: 700 }) + label(cx + 62, 340, t2, { size: 14.4, weight: 500, fill: "#5b5b63" });
  s += face(110, "pCellsFine", "FACTORY CATALYST", "Dense cells: more restriction");
  s += face(470, "pCellsWide", "HIGH-FLOW CATALYST", "Bigger cells: freer flow, still cleans");
  return svg(760, 385, s);
};

// Spark plugs: standard heat range and one step colder, cut away.
FIG.plugs = () => {
  let s = "";
  const plug = (cx, nose, title, sub) => {
    let p = "";
    p += `<rect x="${cx - 7}" y="14" width="14" height="22" rx="3" fill="url(#gdh)" ${st()}/>`;
    // Ribbed insulator.
    let d = `M${cx - 15} 150 L${cx - 15} 40`;
    for (let k = 0; k < 5; k++) d += ` L${cx - 15} ${44 + k * 18} Q ${cx - 21} ${53 + k * 18} ${cx - 15} ${62 + k * 18}`;
    p += `<path d="M${cx - 15} 40 ${Array.from({ length: 5 }, (_, k) => `L${cx - 15} ${44 + k * 18} Q${cx - 21} ${53 + k * 18} ${cx - 15} ${62 + k * 18}`).join(" ")} L${cx - 15} 150 L${cx + 15} 150 ${Array.from({ length: 5 }, (_, k) => `L${cx + 15} ${62 + (4 - k) * 18} Q${cx + 21} ${53 + (4 - k) * 18} ${cx + 15} ${44 + (4 - k) * 18}`).join(" ")} L${cx + 15} 40 Z" fill="#faf9f7" ${st()}/>`;
    // Hex.
    p += `<rect x="${cx - 30}" y="150" width="60" height="38" fill="url(#gmh)" ${st()}/><line x1="${cx - 12}" y1="150" x2="${cx - 12}" y2="188" stroke="${INK}" stroke-width=".8"/><line x1="${cx + 12}" y1="150" x2="${cx + 12}" y2="188" stroke="${INK}" stroke-width=".8"/>`;
    // Threaded shell, cut away on the left half.
    p += `<rect x="${cx}" y="188" width="22" height="108" fill="url(#gmh)" ${st()}/>`;
    for (let y = 192; y < 294; y += 8) p += `<path d="M${cx} ${y} L${cx + 26} ${y + 4} L${cx} ${y + 8}" fill="none" stroke="${INK}" stroke-width=".8"/>`;
    p += `<rect x="${cx - 22}" y="188" width="22" height="108" fill="#e9e6e1" ${st()}/>`;
    p += `<rect x="${cx - 22}" y="188" width="6" height="108" fill="url(#gmh)" ${st(0.8)}/>`;
    // Insulator nose inside the shell.
    p += `<path d="M${cx - 12} 188 L${cx - 12} ${188 + nose * 0.25} Q ${cx - 10} ${188 + nose} ${cx - 3} ${188 + nose} L${cx} ${188 + nose} L${cx} 188 Z" fill="#faf9f7" ${st()}/>`;
    // Electrodes.
    p += `<line x1="${cx}" y1="188" x2="${cx}" y2="310" stroke="${INK}" stroke-width="3"/>`;
    p += `<path d="M${cx + 18} 296 L${cx + 18} 324 Q ${cx + 18} 330 ${cx + 10} 330 L${cx - 6} 330" fill="none" stroke="${INK}" stroke-width="4"/>`;
    // Heat path.
    p += `<path d="M${cx - 5} ${180 + nose} C ${cx - 10} ${150 + nose * 0.6}, ${cx - 18} 210, ${cx - 30} 200" fill="none" stroke="${RED}" stroke-width="2.6" marker-end="url(#aR)"/>`;
    p += label(cx, 362, title, { anchor: "middle", size: 18, weight: 700 }) + label(cx, 380, sub, { anchor: "middle", size: 14.4, weight: 500, fill: "#5b5b63" });
    return p;
  };
  const wide = (cx, body) => `<g transform="translate(${cx} 0) scale(1.7 1) translate(${-cx} 0)">${body}</g>`;
  const both = [[110, 92, "STANDARD", "Long nose: holds heat"], [330, 52, "ONE STEP COLDER", "Short nose: sheds heat"]];
  for (const [cx, nose, title, sub] of both) {
    const body = plug(cx, nose, "", "");
    s += wide(cx, body.replace(/<text[^>]*>[^<]*<\/text>/g, ""));
    s += label(cx, 364, title, { anchor: "middle", size: 25, weight: 700 }) + label(cx, 388, sub, { anchor: "middle", size: 20, weight: 500, fill: "#5b5b63" });
  }
  s += `<path d="M196 250 L240 250" stroke="${RED}" stroke-width="4" marker-end="url(#aR)"/>`;
  return svg(440, 398, s);
};

// High-pressure fuel pump (exploded) and an injector with its spray.
FIG.fuel = () => {
  let s = "";
  const cx = 170;
  s += `<line x1="${cx}" y1="20" x2="${cx}" y2="400" stroke="${GUIDE}" stroke-dasharray="7 5"/>`;
  // Camshaft with the pump lobe.
  s += cylX(40, 330, 380, 15, { fill: "url(#gmh)" });
  s += `<path d="M${cx - 30} 380 C ${cx - 30} 350, ${cx - 12} 338, ${cx} 338 C ${cx + 12} 338, ${cx + 30} 350, ${cx + 30} 380 Z" fill="url(#gd)" ${st()}/>`;
  // Follower, piston, pump body with fittings.
  s += cylY(cx, 300, 322, 24, { fill: "url(#gdh)", face: "url(#gfaced)" });
  s += cylY(cx, 212, 276, 9);
  s += cylX(cx + 40, cx + 78, 108, 9, { noFace: true }) + cylX(cx - 80, cx - 40, 120, 9);
  s += cylY(cx, 50, 178, 46);
  s += `<rect x="${cx - 54}" y="160" width="108" height="16" rx="4" fill="url(#gmh)" ${st()}/>`;
  s += cylY(cx, 30, 52, 14, { fill: "url(#grh)", face: "url(#gfacer)" });
  s += callout(1, cx + 46, 100, 300, 70) + callout(2, cx + 9, 240, 300, 240) + callout(3, cx + 24, 312, 300, 300) + callout(4, cx + 26, 360, 300, 360) + callout(5, cx, 34, 80, 34);
  // Injector.
  const ix = 560;
  s += `<path d="M${ix - 56} 410 L${ix} 314 L${ix + 56} 410 Z" fill="url(#gspray)"/>`;
  for (let k = 0; k < 40; k++) { const t = (k * 37) % 100 / 100, u = (k * 61) % 100 / 100; const y = 322 + t * 84; const w = (y - 314) * 0.55; s += `<circle cx="${n(ix - w + u * 2 * w)}" cy="${n(y)}" r="1.6" fill="${BLUE}" opacity=".7"/>`; }
  s += `<rect x="${ix - 30}" y="30" width="60" height="44" rx="6" fill="url(#gd)" ${st()}/><rect x="${ix - 18}" y="40" width="36" height="20" rx="3" fill="#111114"/>`;
  s += cylY(ix, 74, 250, 19);
  s += `<rect x="${ix - 20}" y="104" width="40" height="8" rx="3" fill="${RED}" ${st(0.8)}/><rect x="${ix - 20}" y="232" width="40" height="8" rx="3" fill="${RED}" ${st(0.8)}/>`;
  s += cylY(ix, 250, 304, 9, { noFace: true });
  s += `<path d="M${ix - 9} 304 L${ix - 4} 314 L${ix + 4} 314 L${ix + 9} 304 Z" fill="url(#gd)" ${st()}/>`;
  s += callout(6, ix + 30, 50, 690, 50) + callout(7, ix + 20, 108, 690, 108) + callout(8, ix + 19, 180, 690, 180) + callout(9, ix + 6, 310, 690, 300) + callout(10, ix + 30, 370, 690, 370);
  return svg(760, 420, s);
};

// Clutch: release bearing, pressure plate, friction disc and flywheel.
FIG.clutch = () => {
  const cy = 190;
  let s = axis(8, 752, cy);
  // Flywheel.
  s += shadow(470, 330, 100, 9);
  s += cylX(440, 478, cy, 120, { fill: "url(#gd)", face: "url(#gfaced)" });
  s += ell(440, cy, 120 * K, 120, `fill="none" stroke="#8a8a92" stroke-width="5" stroke-dasharray="2.2 2.2"`);
  s += ell(440, cy, 104 * K, 104, `fill="url(#gface)" ${st()}`);
  s += ell(440, cy, 40 * K, 40, `fill="url(#gfaced)" ${st()}`) + bolts(440, cy, 28, 6, 3.4, "#d6d1ca");
  // Friction disc on its splined hub.
  s += shadow(330, 314, 80, 8);
  s += cylX(320, 336, cy, 26, { fill: "url(#gdh)", noFace: true });
  s += cylX(308, 314, cy, 94, { fill: "url(#gm)" });
  s += ell(308, cy, 94 * K, 94, `fill="#3a3a41" ${st()}`);
  s += ell(308, cy, 62 * K, 62, `fill="url(#gface)" ${st()}`);
  for (let i = 0; i < 16; i++) { const [x, y] = onFace(308, cy, 78, (i / 16) * Math.PI * 2); s += ell(x, y, 1.6, 2.6, `fill="#b9b4ad"`); }
  for (let i = 0; i < 6; i++) { const [x, y] = onFace(308, cy, 44, (i / 6) * Math.PI * 2 + 0.3); s += `<rect x="${n(x - 3.5)}" y="${n(y - 8)}" width="7" height="16" rx="3" fill="url(#gr)" ${st(0.7)}/>`; }
  s += ell(308, cy, 22 * K, 22, `fill="url(#gfaced)" ${st()}`) + ell(308, cy, 10 * K, 10, `fill="#111114"`);
  s += cylX(292, 308, cy, 22, { fill: "url(#gdh)", face: "url(#gfaced)" });
  // Pressure plate with diaphragm fingers.
  s += shadow(190, 330, 96, 9);
  s += cylX(170, 208, cy, 110);
  s += bolts(170, cy, 100, 9, 3.4, "#8c867e", 0.15);
  s += ell(170, cy, 86 * K, 86, `fill="url(#gfacer)" ${st()}`);
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    const p1 = onFace(170, cy, 30, a - 0.05), p2 = onFace(170, cy, 30, a + 0.05), p3 = onFace(170, cy, 84, a + 0.12), p4 = onFace(170, cy, 84, a - 0.12);
    s += `<path d="M${p1.map(n)} L${p2.map(n)} L${p3.map(n)} L${p4.map(n)} Z" fill="#ffd6d2" stroke="#8f120d" stroke-width=".6"/>`;
  }
  s += ell(170, cy, 28 * K, 28, `fill="#2a2a30" ${st()}`);
  // Release bearing.
  s += shadow(70, 290, 34, 6);
  s += cylX(60, 92, cy, 28, { fill: "url(#gdh)", face: "url(#gfaced)" });
  s += ell(60, cy, 15 * K, 15, `fill="url(#gface)" ${st()}`) + ell(60, cy, 9 * K, 9, `fill="#111114"`);
  s += callout(1, 64, 166, 64, 70) + callout(2, 182, 100, 182, 40) + callout(3, 312, 112, 312, 40) + callout(4, 452, 80, 452, 34);
  s += label(70, 356, "Gearbox side", { anchor: "middle", size: 14.4, weight: 600, fill: "#5b5b63" }) + label(480, 356, "Engine side", { anchor: "middle", size: 14.4, weight: 600, fill: "#5b5b63" });
  return svg(560, 368, s);
};

// Diesel variable-geometry turbo: vanes nearly closed and open.
FIG.vgt = () => {
  let s = "";
  const wheel = (cx, cy, open, title, sub) => {
    let p = `<circle cx="${cx}" cy="${cy}" r="104" fill="url(#gface)" ${st()}/><circle cx="${cx}" cy="${cy}" r="96" fill="#2a2a30"/>`;
    for (let i = 0; i < 11; i++) {
      const a = (i / 11) * Math.PI * 2, x = cx + 78 * Math.cos(a), y = cy + 78 * Math.sin(a);
      const deg = (a * 180) / Math.PI + 90 + (open ? 55 : 12);
      p += `<rect x="${n(x - 16)}" y="${n(y - 4)}" width="32" height="8" rx="4" fill="url(#gr)" stroke="#5e0a07" stroke-width=".8" transform="rotate(${n(deg)} ${n(x)} ${n(y)})"/>`;
    }
    p += `<circle cx="${cx}" cy="${cy}" r="50" fill="url(#gm)" ${st()}/>`;
    for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2; p += `<path d="M${n(cx + 14 * Math.cos(a))} ${n(cy + 14 * Math.sin(a))} Q ${n(cx + 36 * Math.cos(a + 0.35))} ${n(cy + 36 * Math.sin(a + 0.35))} ${n(cx + 49 * Math.cos(a + 0.7))} ${n(cy + 49 * Math.sin(a + 0.7))}" fill="none" stroke="${INK}" stroke-width="1.4"/>`; }
    p += `<circle cx="${cx}" cy="${cy}" r="12" fill="url(#gfaced)" ${st()}/>`;
    p += `<path d="M${cx + 120} ${cy - 92} A 130 130 0 0 1 ${cx + 128} ${cy + 20}" fill="none" stroke="${RED}" stroke-width="${open ? 5 : 2.5}" marker-end="url(#aR)"/>`;
    p += label(cx, cy + 142, title, { anchor: "middle", size: 18, weight: 700 }) + label(cx, cy + 160, sub, { anchor: "middle", size: 14.4, weight: 500, fill: "#5b5b63" });
    return p;
  };
  s += wheel(190, 122, false, "LOW RPM: VANES NEARLY CLOSED", "Gas squeezed through a small gap: quick boost");
  s += wheel(570, 122, true, "HIGH RPM: VANES OPEN", "Wide gap: more flow, less back-pressure");
  return svg(760, 296, s);
};

// Radiator, oil cooler and a brake disc with caliper.
FIG.cooling = () => {
  let s = shadow(170, 290, 150, 8);
  s += box(40, 70, 240, 190, 30, { front: "url(#pCore)", top: "#d8d4ce", side: "#8e8982" });
  s += `<rect x="40" y="70" width="240" height="190" fill="none" ${st(1.4)}/><rect x="28" y="62" width="14" height="206" rx="3" fill="url(#gd)" ${st()}/><rect x="278" y="62" width="14" height="206" rx="3" fill="url(#gd)" ${st()}/>`;
  s += label(160, 300, "RADIATOR / OIL COOLER", { anchor: "middle", size: 16.8, weight: 700 });
  // Brake disc and caliper.
  const cx = 560, cy = 160;
  s += `<circle cx="${cx}" cy="${cy}" r="118" fill="url(#gface)" ${st()}/><circle cx="${cx}" cy="${cy}" r="62" fill="url(#gm)" ${st()}/><circle cx="${cx}" cy="${cy}" r="30" fill="#2a2a30"/>`;
  for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; s += `<circle cx="${n(cx + 46 * Math.cos(a))}" cy="${n(cy + 46 * Math.sin(a))}" r="6" fill="#2a2a30"/>`; }
  for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; s += `<path d="M${n(cx + 72 * Math.cos(a))} ${n(cy + 72 * Math.sin(a))} Q ${n(cx + 92 * Math.cos(a + 0.12))} ${n(cy + 92 * Math.sin(a + 0.12))} ${n(cx + 110 * Math.cos(a + 0.3))} ${n(cy + 110 * Math.sin(a + 0.3))}" fill="none" stroke="#8c867e" stroke-width="3" stroke-linecap="round"/>`; }
  s += `<path d="M${cx + 40} ${cy - 128} A 140 140 0 0 1 ${cx + 136} ${cy - 30} L ${cx + 100} ${cy - 18} A 100 100 0 0 0 ${cx + 30} ${cy - 92} Z" fill="url(#gr)" ${st()}/>`;
  s += label(cx, 300, "BRAKE DISC + CALIPER", { anchor: "middle", size: 16.8, weight: 700 });
  return svg(760, 312, s);
};

// ---------- Charts ----------

// Power by stage for two cars, as small multiples (same scale).
FIG.stagebars = () => {
  const cars = [
    { name: "TOYOTA FORTUNER 2.8 DIESEL", hp: [204, 235, 255, 285], nm: [500, 580, 620, 680] },
    { name: "CRETA / SELTOS 1.5 TURBO PETROL", hp: [160, 190, 205, 240], nm: [253, 305, 325, 340] },
  ];
  const stages = ["Stock", "Stage 1", "Stage 2", "Stage 3"];
  let s = "";
  const base = 236, scale = 180 / 300;
  cars.forEach((c, k) => {
    const gx = 30 + k * 380;
    s += label(gx, 18, c.name, { size: 16.2, weight: 700, ls: 0.3 });
    for (const v of [100, 200, 300]) s += `<line x1="${gx}" y1="${base - v * scale}" x2="${gx + 330}" y2="${base - v * scale}" stroke="#e3dfd9" stroke-width="1"/>` + (k === 0 ? label(gx - 6, base - v * scale + 4, v, { anchor: "end", size: 12.6, weight: 500, fill: "#7a7a82" }) : "");
    c.hp.forEach((hp, i) => {
      const x = gx + 14 + i * 80, h = hp * scale;
      s += `<path d="M${x} ${base} L${x} ${base - h + 4} Q${x} ${base - h} ${x + 4} ${base - h} L${x + 48} ${base - h} Q${x + 52} ${base - h} ${x + 52} ${base - h + 4} L${x + 52} ${base} Z" fill="${i === 0 ? "#b9b4ad" : RED}"/>`;
      s += label(x + 26, base - h - 20, `${hp} hp`, { anchor: "middle", size: 15.6, weight: 700 });
      s += label(x + 26, base - h - 6, `${c.nm[i]} Nm`, { anchor: "middle", size: 13.2, weight: 500, fill: "#5b5b63" });
      s += label(x + 26, base + 17, stages[i], { anchor: "middle", size: 14.4, weight: 600, fill: "#3a3a41" });
    });
    s += `<line x1="${gx}" y1="${base}" x2="${gx + 330}" y2="${base}" stroke="#8a8a92" stroke-width="1.2"/>`;
  });
  return svg(760, 262, s);
};

// Power curve shapes for three turbo sizes (an illustration, not a measurement).
// A smooth rise as the turbo spools, then a gentle fall once it runs out of breath.
const curve = (r, peak, mid, width, fallFrom, fall) =>
  (14 + (peak - 14) / (1 + Math.exp(-(r - mid) / width))) * (r > fallFrom ? 1 - fall * ((r - fallFrom) / 1200) : 1) * (0.55 + 0.45 * Math.min(1, r / 4200));
FIG.turbocurves = () => {
  const X = (r) => 60 + ((r - 1500) / 5000) * 600, Y = (p) => 250 - p * 1.45;
  const curves = [
    { name: "Factory turbo", color: BLUE, f: (r) => curve(r, 100, 2350, 330, 5300, 0.09) },
    { name: "Hybrid turbo", color: RED, f: (r) => curve(r, 126, 2750, 360, 5900, 0.05) },
    { name: "Bigger turbo", color: GREEN, f: (r) => curve(r, 152, 3700, 430, 6600, 0) },
  ];
  let s = "";
  for (const r of [2000, 3000, 4000, 5000, 6000]) s += `<line x1="${X(r)}" y1="30" x2="${X(r)}" y2="250" stroke="#ece8e3"/>` + label(X(r), 270, r, { anchor: "middle", size: 13.8, weight: 500, fill: "#5b5b63" });
  s += `<line x1="60" y1="250" x2="660" y2="250" stroke="#8a8a92" stroke-width="1.2"/>` + label(360, 292, "Engine speed (rpm)", { anchor: "middle", size: 14.4, weight: 600, fill: "#3a3a41" });
  s += label(52, 40, "More power", { anchor: "end", size: 14.4, weight: 600, fill: "#3a3a41" }).replace("<text", `<text transform="rotate(-90 40 140)"`).replace(`x="52" y="40"`, `x="40" y="140"`);
  for (const c of curves) {
    let d = "";
    for (let r = 1500; r <= 6500; r += 50) d += `${d ? "L" : "M"}${n(X(r))} ${n(Y(c.f(r)))} `;
    s += `<path d="${d}" fill="none" stroke="${c.color}" stroke-width="2.6" stroke-linejoin="round"/>`;
    s += `<circle cx="${X(6500)}" cy="${n(Y(c.f(6500)))}" r="4.5" fill="${c.color}" stroke="#f7f5f2" stroke-width="2"/>` + label(X(6500) + 10, Y(c.f(6500)) + 4, c.name, { size: 15, weight: 700 });
  }
  return svg(760, 300, s);
};

// An example log: boost and lambda, target against actual, and timing pulled per cylinder.
FIG.logs = () => {
  const rpms = []; for (let r = 1500; r <= 6000; r += 100) rpms.push(r);
  const boostT = (r) => r < 2400 ? 0.4 + 1.1 * ((r - 1500) / 900) : r < 4600 ? 1.5 : 1.5 - 0.25 * ((r - 4600) / 1400);
  const boostA = (r) => r < 2600 ? 0.3 + 1.2 * Math.pow((r - 1500) / 1100, 1.25) : boostT(r) + 0.03 * Math.sin(r / 180);
  const lamT = (r) => r < 2500 ? 0.95 : r < 4500 ? 0.95 - 0.1 * ((r - 2500) / 2000) : 0.85;
  const lamA = (r) => lamT(r) + 0.005 * Math.sin(r / 260);
  let s = "";
  const panel = (gx, title, unit, lo, hi, ticks, tf, af) => {
    const W = 290, H = 150, top = 30;
    const X = (r) => gx + ((r - 1500) / 4500) * W, Y = (v) => top + H - ((v - lo) / (hi - lo)) * H;
    let p = label(gx, 16, title, { size: 16.2, weight: 700, ls: 0.3 });
    for (const t of ticks) p += `<line x1="${gx}" y1="${n(Y(t))}" x2="${gx + W}" y2="${n(Y(t))}" stroke="#ece8e3"/>` + label(gx - 6, Y(t) + 4, t.toFixed(unit === "bar" ? 1 : 2), { anchor: "end", size: 12.6, weight: 500, fill: "#7a7a82" });
    for (const r of [2000, 3000, 4000, 5000, 6000]) p += label(X(r), top + H + 16, r, { anchor: "middle", size: 12.6, weight: 500, fill: "#7a7a82" });
    p += `<line x1="${gx}" y1="${top + H}" x2="${gx + W}" y2="${top + H}" stroke="#8a8a92" stroke-width="1.2"/>`;
    const line = (f, c, dash) => `<path d="${rpms.map((r, i) => `${i ? "L" : "M"}${n(X(r))} ${n(Y(f(r)))}`).join(" ")}" fill="none" stroke="${c}" stroke-width="2.2" ${dash ? 'stroke-dasharray="6 4"' : ""}/>`;
    p += line(tf, BLUE, true) + line(af, RED, false);
    p += label(gx + W + 6, Y(tf(6000)) - 6, "Target", { size: 13.8, weight: 700, fill: "#3a3a41" }) + label(gx + W + 6, Y(af(6000)) + 12, "Actual", { size: 13.8, weight: 700, fill: "#3a3a41" });
    p += label(gx + W / 2, top + H + 34, "Engine speed (rpm)", { anchor: "middle", size: 13.2, weight: 600, fill: "#5b5b63" });
    return p;
  };
  s += panel(40, "BOOST (bar)", "bar", 0, 1.8, [0, 0.6, 1.2, 1.8], boostT, boostA);
  s += panel(450, "LAMBDA (air-fuel ratio)", "lambda", 0.8, 1.0, [0.8, 0.85, 0.9, 0.95, 1.0], lamT, lamA);
  // Legend.
  s += `<line x1="40" y1="240" x2="70" y2="240" stroke="${BLUE}" stroke-width="2.2" stroke-dasharray="6 4"/>` + label(78, 244, "What the tune asks for (target)", { size: 14.4, weight: 500 });
  s += `<line x1="300" y1="240" x2="330" y2="240" stroke="${RED}" stroke-width="2.2"/>` + label(338, 244, "What the engine actually did", { size: 14.4, weight: 500 });
  return svg(790, 254, s);
};

FIG.knock = () => {
  const vals = [-0.4, -0.0, -0.8, -0.3];
  let s = label(30, 18, "TIMING PULLED BY KNOCK CONTROL (degrees)", { size: 16.2, weight: 700, ls: 0.3 });
  const Y = (v) => 36 + (-v / 3) * 120;
  for (const t of [0, -1, -2, -3]) s += `<line x1="70" y1="${Y(t)}" x2="560" y2="${Y(t)}" stroke="#ece8e3"/>` + label(62, Y(t) + 4, t, { anchor: "end", size: 12.6, weight: 500, fill: "#7a7a82" });
  s += `<line x1="70" y1="${Y(-2)}" x2="560" y2="${Y(-2)}" stroke="${INK}" stroke-width="1.4" stroke-dasharray="6 4"/>` + label(566, Y(-2) + 4, "Our limit", { size: 14.4, weight: 700 });
  vals.forEach((v, i) => {
    const x = 110 + i * 116, h = Y(v) - Y(0);
    if (h > 0.5) s += `<path d="M${x} ${Y(0)} L${x + 60} ${Y(0)} L${x + 60} ${n(Y(v) - 4)} Q${x + 60} ${n(Y(v))} ${x + 56} ${n(Y(v))} L${x + 4} ${n(Y(v))} Q${x} ${n(Y(v))} ${x} ${n(Y(v) - 4)} Z" fill="${RED}"/>`;
    s += label(x + 30, Y(v) + 18, v === 0 ? "0.0" : v.toFixed(1), { anchor: "middle", size: 14.4, weight: 700 });
    s += label(x + 30, 186, `Cylinder ${i + 1}`, { anchor: "middle", size: 14.4, weight: 600, fill: "#3a3a41" });
  });
  s += `<line x1="70" y1="${Y(0)}" x2="560" y2="${Y(0)}" stroke="#8a8a92" stroke-width="1.2"/>`;
  return svg(660, 196, s);
};

// Small line icons for the benefits page.
const ICON = {
  overtake: `<path d="M6 34 L30 34 M22 26 L30 34 L22 42" /><path d="M14 14 L38 14 M30 6 L38 14 L30 22" />`,
  hill: `<path d="M4 40 L18 18 L26 28 L32 20 L44 40 Z"/><circle cx="36" cy="10" r="4"/>`,
  ac: `<path d="M24 4 V44 M6.7 14 L41.3 34 M6.7 34 L41.3 14"/><path d="M19 8 L24 13 L29 8 M19 40 L24 35 L29 40"/>`,
  load: `<circle cx="14" cy="12" r="5"/><circle cx="34" cy="12" r="5"/><path d="M6 32 C6 22, 22 22, 22 32 M26 32 C26 22, 42 22, 42 32"/><path d="M4 40 H44"/>`,
  pedal: `<path d="M8 40 A 18 18 0 1 1 40 40"/><path d="M24 34 L34 18"/><circle cx="24" cy="34" r="3"/>`,
  smooth: `<path d="M4 30 C 12 30, 12 16, 20 16 S 28 30, 36 30 S 44 20, 46 20"/><path d="M4 40 H44"/>`,
  fuel: `<path d="M24 6 C 24 6, 10 22, 10 30 A 14 14 0 0 0 38 30 C 38 22, 24 6, 24 6 Z"/><path d="M18 32 A 6 6 0 0 0 24 38"/>`,
  undo: `<path d="M14 18 H32 A 10 10 0 0 1 32 38 H16"/><path d="M20 10 L12 18 L20 26"/>`,
};
const icon = (name) => `<svg viewBox="0 0 48 48" fill="none" stroke="${RED}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">${ICON[name]}</svg>`;

// ---------- Put everything on the page (after install.js has added its figures) ----------
window.addEventListener("DOMContentLoaded", () => {
  document.body.insertAdjacentHTML("afterbegin", DEFS);
  for (const el of document.querySelectorAll("[data-fig]")) el.innerHTML = FIG[el.dataset.fig](el.dataset.dark === "1");
  for (const el of document.querySelectorAll("[data-icon]")) el.innerHTML = icon(el.dataset.icon);
});
