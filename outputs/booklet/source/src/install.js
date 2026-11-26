// Installation diagrams for the Tuning Book: where each part sits, and how each one is fitted.
// Uses the primitives from illus.js. Black numbered markers are installation steps; red ones name parts.

const HOT = "#e0605a";
const OIL = "#8a5a12";

const stepMark = (num, x, y) =>
  `<circle cx="${x}" cy="${y}" r="14" fill="${INK}" stroke="#fff" stroke-width="2.4"/>` +
  `<text x="${x}" y="${y + 5.6}" text-anchor="middle" font-family="Barlow Condensed" font-weight="700" font-size="17" fill="#fff">${num}</text>`;

// A pipe drawn as a tube: dark edge, colour, and a soft highlight.
const tube = (d, color, w = 16) =>
  `<path d="${d}" fill="none" stroke="${INK}" stroke-width="${w + 3}" stroke-linecap="round" stroke-linejoin="round"/>` +
  `<path d="${d}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>` +
  `<path d="${d}" fill="none" stroke="#fff" stroke-opacity=".38" stroke-width="${n(w * 0.26)}" stroke-linecap="round" stroke-linejoin="round" transform="translate(0 ${n(-w * 0.2)})"/>`;

// A part being taken out or put in.
const move = (d) => `<path d="${d}" fill="none" stroke="${BLUE}" stroke-width="3" stroke-dasharray="7 5" marker-end="url(#aB)"/>`;
const ghost = (inner) => `<g opacity=".4" stroke-dasharray="5 4">${inner}</g>`;
const band = (x, y, w, h) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2" fill="url(#gm)" stroke="${INK}" stroke-width="1.1"/>`;
const note = (x, y, t, o = {}) => label(x, y, t, Object.assign({ size: 15, weight: 600, fill: "#3a3a41" }, o));

// A laptop: the calibration and log check that finishes every installation.
const laptop = (x, y) =>
  `<rect x="${x}" y="${y}" width="62" height="40" rx="4" fill="#16161a" stroke="${INK}"/>` +
  `<polyline points="${x + 8},${y + 30} ${x + 20},${y + 18} ${x + 30},${y + 24} ${x + 44},${y + 10} ${x + 54},${y + 14}" fill="none" stroke="${RED}" stroke-width="2.4"/>` +
  `<path d="M${x - 8} ${y + 40} L${x + 70} ${y + 40} L${x + 64} ${y + 48} L${x - 2} ${y + 48} Z" fill="url(#gm)" stroke="${INK}"/>`;

// ---------- Where every part sits ----------
FIG.location = () => {
  let s = "";
  s += `<ellipse cx="380" cy="304" rx="360" ry="10" fill="url(#gshadow)"/>`;
  // Exhaust and fuel line run under the floor.
  s += tube("M84 222 C 84 252, 120 256, 160 256 L 640 256", "#8c867e", 9);
  s += cylX(244, 312, 256, 13, { fill: "url(#gm)" });
  s += `<rect x="626" y="244" width="74" height="24" rx="10" fill="url(#gm)" stroke="${INK}" stroke-width="1.1"/>` + tube("M700 256 L728 256", "#8c867e", 8);
  // Body, windows and the cut-away engine bay.
  const body = "M36 238 L34 186 Q34 160 62 150 L250 122 Q268 118 284 106 L352 66 Q362 60 378 60 L640 58 Q676 58 690 80 L716 146 Q722 158 722 172 L722 238 Z";
  s += `<path d="${body}" fill="#ffffff" fill-opacity=".75" stroke="#a7a199" stroke-width="2.2"/>`;
  s += `<path d="M298 116 L356 76 Q362 72 372 72 L470 72 L470 116 Z" fill="#dde4ec" stroke="#a7a199" stroke-width="1.5"/>`;
  s += `<path d="M484 72 L630 70 Q660 70 670 88 L684 116 L484 116 Z" fill="#dde4ec" stroke="#a7a199" stroke-width="1.5"/>`;
  // Wheels with brakes (drawn before the engine bay, which is shown cut away in front of them).
  for (const cx of [170, 600]) {
    s += `<path d="M${cx - 58} 238 A58 58 0 0 1 ${cx + 58} 238" fill="#f7f5f2" stroke="#a7a199" stroke-width="2.2"/>`;
    s += `<circle cx="${cx}" cy="250" r="48" fill="#1d1d22"/><circle cx="${cx}" cy="250" r="30" fill="url(#gface)" stroke="${INK}"/><circle cx="${cx}" cy="250" r="8" fill="#3a3a41"/>`;
    s += `<path d="M${cx + 10} 222 A28 28 0 0 1 ${cx + 28} 240" fill="none" stroke="${RED}" stroke-width="9" stroke-linecap="round"/>`;
  }
  s += `<path d="M40 142 L300 142 L300 232 L40 232 Z" fill="#f7f5f2" fill-opacity=".82" stroke="#b9b4ad" stroke-width="1.2" stroke-dasharray="5 4"/>`;
  // Fuel tank with its in-tank pump, and the fuel line to the engine.
  s += `<path d="M470 234 L300 234 M300 234 L180 234 L160 168" fill="none" stroke="${OIL}" stroke-width="2.4" stroke-dasharray="6 4"/>`;
  s += `<rect x="440" y="206" width="96" height="28" rx="6" fill="#efece7" stroke="${INK}" stroke-width="1.1"/><circle cx="474" cy="220" r="7" fill="${BLUE}"/>`;
  // Radiator and intercooler at the front.
  s += `<rect x="58" y="158" width="12" height="66" fill="url(#pCore)" stroke="${INK}"/>`;
  s += `<rect x="42" y="164" width="12" height="58" fill="url(#gr)" stroke="${INK}"/>`;
  // Engine with coils and intake manifold.
  s += `<rect x="100" y="162" width="106" height="64" rx="8" fill="url(#gd)" stroke="${INK}"/>`;
  for (let i = 0; i < 4; i++) s += `<rect x="${110 + i * 22}" y="152" width="13" height="12" rx="2" fill="url(#gr)" stroke="${INK}" stroke-width=".8"/>`;
  s += `<rect x="194" y="150" width="22" height="16" rx="3" fill="url(#gm)" stroke="${INK}"/>`;
  // Turbo between the radiator and the engine, with the intercooler pipes.
  s += `<path d="M84 194 C 70 182, 56 182, 54 188" fill="none" stroke="${HOT}" stroke-width="4"/><path d="M54 210 C 80 146, 160 136, 204 152" fill="none" stroke="${BLUE}" stroke-width="4"/>`;
  s += `<circle cx="86" cy="210" r="13" fill="url(#gfaceh)" stroke="${INK}"/><circle cx="90" cy="194" r="9" fill="url(#gface)" stroke="${INK}"/>`;
  // Air filter box and ECU near the firewall; clutch and gearbox behind the engine.
  s += `<rect x="226" y="150" width="54" height="24" rx="4" fill="url(#gd)" stroke="${INK}"/>`;
  s += `<rect x="252" y="184" width="32" height="20" rx="3" fill="#111114" stroke="${RED}" stroke-width="1.6"/>`;
  s += `<path d="M208 190 L244 194 L244 226 L208 228 Z" fill="url(#gm)" stroke="${INK}"/><ellipse cx="210" cy="208" rx="4" ry="18" fill="${RED}" stroke="${INK}"/>`;
  // Callouts: engine-bay parts in a row above the bonnet.
  const c = [[3, 48, 166, 30, 34], [13, 64, 160, 76, 34], [2, 86, 206, 122, 34], [5, 150, 200, 168, 34], [6, 160, 152, 214, 34], [4, 205, 150, 260, 34], [1, 253, 150, 306, 34],
    [8, 268, 194, 330, 186], [9, 228, 212, 330, 220], [7, 474, 220, 474, 166], [12, 380, 234, 400, 296], [10, 278, 250, 300, 296], [11, 664, 246, 664, 296], [14, 618, 228, 696, 196]];
  for (const [num, px, py, tx, ty] of c) s += callout(num, px, py, tx, ty);
  return svg(760, 316, s);
};

// ---------- Intercooler, seen from the front with the bumper off ----------
FIG.instIntercooler = () => {
  let s = "";
  // Car front outline.
  s += `<path d="M120 284 L120 96 Q120 52 168 46 L592 46 Q640 52 640 96 L640 284" fill="none" stroke="#c9c4bd" stroke-width="2"/>`;
  s += `<path d="M132 70 L222 70 L232 98 L140 102 Z" fill="#efece7" stroke="#c9c4bd" stroke-width="1.5"/><path d="M628 70 L538 70 L528 98 L620 102 Z" fill="#efece7" stroke="#c9c4bd" stroke-width="1.5"/>`;
  s += `<rect x="120" y="226" width="56" height="70" rx="10" fill="#2a2a30"/><rect x="584" y="226" width="56" height="70" rx="10" fill="#2a2a30"/>`;
  // Radiator behind.
  s += `<rect x="232" y="88" width="296" height="104" fill="url(#pCore)" opacity=".5" stroke="#9a958e"/>` + note(380, 82, "radiator", { anchor: "middle", size: 14, fill: "#8a8a92" });
  // Crash bar and brackets.
  s += `<rect x="150" y="234" width="460" height="12" rx="3" fill="url(#gm)" stroke="${INK}"/>`;
  s += `<rect x="186" y="214" width="12" height="22" fill="url(#gd)" stroke="${INK}"/><rect x="562" y="214" width="12" height="22" fill="url(#gd)" stroke="${INK}"/>`;
  // Pipes: hot from the turbo, cool to the throttle.
  s += tube("M66 30 L66 120 Q66 160 106 160 L170 160", HOT, 15);
  s += tube("M590 160 L654 160 Q694 160 694 120 L694 30", BLUE, 15);
  s += band(132, 150, 10, 21) + band(616, 150, 10, 21);
  // The new intercooler: tanks and core, outlined in red.
  s += `<path d="M168 132 L196 122 L196 214 L168 204 Z" fill="url(#gm)" stroke="${INK}"/><path d="M592 132 L564 122 L564 214 L592 204 Z" fill="url(#gm)" stroke="${INK}"/>`;
  s += `<rect x="196" y="122" width="368" height="92" fill="url(#pCore)" stroke="${INK}"/>`;
  s += `<rect x="164" y="118" width="432" height="100" rx="6" fill="none" stroke="${RED}" stroke-width="3"/>`;
  // Bumper removed (ghost) and the old core coming out.
  s += ghost(`<rect x="130" y="262" width="500" height="44" rx="18" fill="none" stroke="${INK}" stroke-width="2"/>`);
  s += move("M380 248 L380 300");
  s += note(66, 22, "from turbo (hot)", { size: 14, fill: "#a5120d" }) + note(694, 22, "to throttle (cool)", { anchor: "end", size: 14, fill: "#2a5a96" });
  s += stepMark(1, 404, 282) + stepMark(2, 380, 168) + stepMark(3, 192, 256) + stepMark(4, 137, 128) + stepMark(5, 621, 128);
  return svg(760, 312, s);
};

// ---------- Intake: airbox, filter and hose ----------
FIG.instIntake = () => {
  let s = "";
  // Engine and turbo.
  s += `<rect x="470" y="96" width="270" height="180" rx="14" fill="url(#gd)" stroke="${INK}"/>` + note(605, 262, "ENGINE", { anchor: "middle", fill: "#fff", size: 15, weight: 700, ls: 1 });
  s += `<circle cx="466" cy="150" r="40" fill="url(#gface)" stroke="${INK}" stroke-width="1.4"/><circle cx="466" cy="150" r="20" fill="#2a2a30"/>` + note(440, 102, "turbo", { anchor: "end", size: 14 });
  // Airbox base, filter coming in, lid lifted off.
  s += box(40, 168, 190, 70, 70, { front: "url(#gd)", top: "#4a4a52", side: "#232328" });
  s += ghost(box(40, 66, 190, 26, 70, { front: "#55555d", top: "#6b6b73", side: "#3a3a41" }));
  s += move("M120 150 L120 106");
  s += box(52, 124, 166, 10, 60, { front: "url(#gr)", top: "#f1d9d6", side: "#9b100c" });
  s += `<g transform="${topFace(52, 124)}"><rect x="6" y="6" width="154" height="48" fill="url(#pPleat)"/></g>`;
  s += move("M250 112 L210 140");
  // Silicone hose with clamps, and the sensor plug.
  s += tube("M262 196 C 330 196, 360 150, 420 150", "#e0231c", 26);
  s += band(266, 180, 12, 32) + band(404, 134, 12, 32);
  s += `<rect x="286" y="160" width="22" height="16" rx="3" fill="#111114"/><path d="M297 160 C 297 130, 330 120, 360 116" fill="none" stroke="#111114" stroke-width="2"/>`;
  s += laptop(640, 20);
  s += stepMark(1, 260, 70) + stepMark(2, 40, 128) + stepMark(3, 340, 214) + stepMark(4, 410, 112) + stepMark(5, 618, 40);
  return svg(760, 290, s);
};

// ---------- Turbocharger fitted to the engine ----------
FIG.instTurbo = () => {
  let s = "";
  // Engine block with head and sump.
  s += `<rect x="30" y="70" width="250" height="300" rx="16" fill="url(#gd)" stroke="${INK}"/>`;
  s += `<rect x="30" y="70" width="250" height="56" rx="16" fill="#4a4a52" stroke="${INK}"/><rect x="40" y="326" width="230" height="44" rx="10" fill="#3a3a41" stroke="${INK}"/>`;
  s += note(155, 230, "ENGINE", { anchor: "middle", fill: "#fff", size: 17, weight: 700, ls: 1.5 });
  // Exhaust manifold into the turbine housing.
  for (const y of [150, 182, 214, 246]) s += `<path d="M280 ${y} C 312 ${y}, 320 ${214}, 342 214" fill="none" stroke="#5a4642" stroke-width="15" stroke-linecap="round"/>`;
  s += `<rect x="336" y="186" width="14" height="58" rx="2" fill="url(#gm)" stroke="${INK}"/>`;
  // Oil feed (top) and drain (bottom), coolant lines.
  s += `<path d="M250 96 C 330 96, 470 90, 490 150" fill="none" stroke="${OIL}" stroke-width="4"/>`;
  s += `<path d="M490 262 L490 340 L280 346" fill="none" stroke="${INK}" stroke-width="12" stroke-linejoin="round"/><path d="M490 262 L490 340 L280 346" fill="none" stroke="${OIL}" stroke-width="8" stroke-linejoin="round"/>`;
  s += `<path d="M280 120 C 360 120, 440 130, 466 166" fill="none" stroke="${BLUE}" stroke-width="3"/><path d="M280 300 C 380 300, 440 290, 514 250" fill="none" stroke="${BLUE}" stroke-width="3"/>`;
  // Downpipe from the turbine outlet.
  s += tube("M410 276 L410 340 Q410 380 450 384 L740 384", "#8c867e", 22);
  // Turbine housing, bearing housing, compressor housing.
  s += `<circle cx="410" cy="214" r="66" fill="url(#gfaceh)" stroke="${INK}" stroke-width="1.4"/><path d="M410 168 A46 46 0 1 1 366 222" fill="none" stroke="#9c7f79" stroke-width="2"/><circle cx="410" cy="214" r="22" fill="#120c0b"/>`;
  s += `<rect x="468" y="150" width="46" height="112" rx="8" fill="url(#gmh)" stroke="${INK}" stroke-width="1.4"/>`;
  s += `<circle cx="590" cy="206" r="72" fill="url(#gface)" stroke="${INK}" stroke-width="1.4"/><path d="M590 156 A50 50 0 1 1 540 210" fill="none" stroke="#a7a199" stroke-width="2"/><circle cx="590" cy="206" r="28" fill="#2a2a30"/>`;
  // Wastegate actuator.
  s += `<line x1="372" y1="122" x2="380" y2="160" stroke="${INK}" stroke-width="3"/>` + cylY(370, 92, 120, 22, { fill: "url(#grh)", face: "url(#gfacer)" });
  // Pipes to the intercooler and from the air filter.
  s += tube("M640 150 C 660 110, 690 92, 740 92", HOT, 18) + note(744, 76, "to intercooler", { anchor: "end", size: 14, fill: "#a5120d" });
  s += tube("M740 250 C 700 250, 676 240, 662 226", BLUE, 18) + note(744, 280, "from air filter", { anchor: "end", size: 14, fill: "#2a5a96" });
  s += note(560, 330, "oil drain", { size: 14, fill: OIL }) + note(330, 88, "oil feed", { size: 14, fill: OIL }) + note(300, 290, "coolant", { size: 14, fill: "#2a5a96" });
  s += laptop(40, 6);
  // Steps.
  s += stepMark(1, 70, 160) + stepMark(2, 640, 300) + stepMark(3, 343, 260) + stepMark(4, 490, 150) + stepMark(5, 512, 330) +
    stepMark(6, 410, 410) + stepMark(7, 230, 160) + stepMark(8, 120, 26);
  return svg(760, 426, s);
};

// ---------- Spark plugs: coils out, plugs torqued ----------
FIG.instPlugs = () => {
  let s = "";
  // Cam cover, seen from above.
  s += `<rect x="30" y="118" width="460" height="120" rx="18" fill="url(#gm)" stroke="${INK}" stroke-width="1.4"/>`;
  const xs = [100, 200, 300, 400];
  xs.forEach((x, i) => {
    s += `<circle cx="${x}" cy="178" r="20" fill="#1d1d22" stroke="${INK}"/>`;
    if (i === 0 || i === 3) s += `<rect x="${x - 24}" y="140" width="48" height="76" rx="8" fill="url(#gr)" stroke="${INK}"/><rect x="${x - 12}" y="146" width="24" height="16" rx="3" fill="#111114"/>`;
  });
  // Coil 2 lifted out.
  s += ghost(`<rect x="176" y="140" width="48" height="76" rx="8" fill="none" stroke="${INK}" stroke-width="2"/>`);
  s += `<rect x="176" y="20" width="48" height="76" rx="8" fill="url(#gr)" stroke="${INK}"/><rect x="188" y="26" width="24" height="16" rx="3" fill="#111114"/>` + move("M200 136 L200 104");
  // Air gun at well 3.
  s += `<path d="M300 150 L330 96" stroke="#3a3a41" stroke-width="6" stroke-linecap="round"/><rect x="322" y="60" width="44" height="40" rx="6" fill="url(#gdh)" stroke="${INK}"/>`;
  for (const d of ["M300 160 L282 140", "M300 160 L276 158", "M300 160 L286 176"]) s += `<path d="${d}" stroke="${BLUE}" stroke-width="2"/>`;
  // Cut-through of a plug well with the socket and torque wrench.
  s += `<rect x="560" y="150" width="180" height="140" fill="#d6d1ca" stroke="${INK}"/><rect x="630" y="150" width="40" height="110" fill="#f7f5f2" stroke="${INK}"/>`;
  s += `<rect x="636" y="214" width="28" height="20" fill="url(#gmh)" stroke="${INK}"/>`;
  for (let y = 236; y < 262; y += 6) s += `<path d="M640 ${y} L660 ${y + 3} L640 ${y + 6}" fill="none" stroke="${INK}" stroke-width=".9"/>`;
  s += `<line x1="650" y1="262" x2="650" y2="276" stroke="${INK}" stroke-width="2.6"/>`;
  s += `<rect x="640" y="96" width="20" height="120" rx="3" fill="url(#gdh)" stroke="${INK}"/>`;
  s += `<rect x="560" y="80" width="190" height="16" rx="6" fill="url(#gd)" stroke="${INK}"/><rect x="700" y="78" width="54" height="20" rx="6" fill="url(#gr)" stroke="${INK}"/>`;
  s += `<path d="M600 60 A70 70 0 0 1 700 60" fill="none" stroke="${RED}" stroke-width="3" marker-end="url(#aR)"/>`;
  s += note(650, 312, "torque to spec", { anchor: "middle", size: 14 });
  // Gap check.
  s += `<circle cx="500" cy="56" r="34" fill="#fff" stroke="${INK}"/><line x1="500" y1="26" x2="500" y2="56" stroke="${INK}" stroke-width="5"/><path d="M520 82 L520 66 L496 66" fill="none" stroke="${INK}" stroke-width="5"/><line x1="476" y1="61" x2="530" y2="61" stroke="${RED}" stroke-width="2.4"/>`;
  s += stepMark(1, 248, 58) + stepMark(2, 344, 128) + stepMark(3, 400, 266) + stepMark(4, 456, 30) + stepMark(5, 590, 120) + stepMark(6, 100, 266);
  return svg(760, 320, s);
};

// ---------- Downpipe: under the car ----------
FIG.instDownpipe = () => {
  let s = "";
  s += `<rect x="0" y="20" width="760" height="20" fill="#e6e2dc"/>` + note(750, 34, "underbody", { anchor: "end", size: 13, fill: "#8a8a92" });
  // Turbo outlet.
  s += `<path d="M30 44 A40 40 0 0 1 110 44 L110 70 L30 70 Z" fill="url(#ghot)" stroke="${INK}"/>`;
  // Hanger.
  s += `<line x1="520" y1="40" x2="520" y2="150" stroke="#3a3a41" stroke-width="4"/><circle cx="520" cy="150" r="10" fill="none" stroke="#111114" stroke-width="6"/>`;
  // Mid-pipe (factory, stays).
  s += tube("M640 170 L760 170", "#bdb7af", 30);
  // New downpipe and catalyst.
  s += tube("M70 74 C 70 150, 120 170, 200 170 L 300 170", "#d9d5cf", 30);
  s += cylX(300, 440, 170, 36);
  s += tube("M440 170 L630 170", "#d9d5cf", 30);
  s += `<rect x="44" y="66" width="52" height="12" rx="2" fill="url(#gm)" stroke="${INK}"/>` + band(624, 150, 14, 40);
  s += `<rect x="290" y="128" width="170" height="84" rx="14" fill="none" stroke="${RED}" stroke-width="3"/>` + note(375, 232, "high-flow catalyst", { anchor: "middle", size: 14, fill: RED });
  // Lambda sensors and wires.
  for (const x of [250, 490]) s += `<path d="M${x} 124 C ${x} 90, ${x + 30} 60, ${x + 40} 40" fill="none" stroke="#111114" stroke-width="2"/>` + cylY(x, 124, 156, 10, { fill: "url(#gdh)", face: "url(#gfaced)" });
  s += move("M210 120 L210 80") + move("M680 230 L730 230");
  s += note(118, 62, "turbo flange", { size: 14 }) + note(631, 226, "joint", { anchor: "middle", size: 14 });
  s += stepMark(1, 160, 66) + stepMark(2, 250, 98) + stepMark(3, 120, 30 + 98) + stepMark(4, 375, 106) + stepMark(5, 490, 98) + stepMark(6, 700, 112);
  return svg(760, 250, s);
};

// ---------- Fuel pump and injectors ----------
FIG.instFuel = () => {
  let s = "";
  s += `<rect x="30" y="70" width="520" height="130" rx="18" fill="url(#gm)" stroke="${INK}" stroke-width="1.4"/>` + note(290, 140, "cylinder head", { anchor: "middle", size: 15, fill: "#8a8a92" });
  // Injectors into the head, and the rail.
  for (const x of [110, 220, 330, 440]) s += `<rect x="${x - 9}" y="198" width="18" height="40" rx="4" fill="url(#gmh)" stroke="${INK}"/><rect x="${x - 11}" y="204" width="22" height="5" rx="2" fill="${RED}"/>`;
  s += `<rect x="70" y="236" width="420" height="20" rx="10" fill="url(#gd)" stroke="${INK}"/>`;
  // High-pressure pump on the end of the head, its lines.
  s += tube("M600 160 C 610 220, 560 246, 494 246", RED, 10);
  s += tube("M760 130 C 700 130, 660 120, 636 132", BLUE, 8) + note(756, 116, "from tank", { anchor: "end", size: 14, fill: "#2a5a96" });
  s += `<circle cx="600" cy="130" r="40" fill="url(#gface)" stroke="${INK}" stroke-width="1.4"/><circle cx="600" cy="130" r="14" fill="url(#gfacer)" stroke="${INK}"/>`;
  s += note(600, 70, "high-pressure pump", { anchor: "middle", size: 14 }) + note(280, 284, "fuel rail and injectors", { anchor: "middle", size: 14 });
  s += laptop(640, 220);
  s += stepMark(1, 700, 154) + stepMark(2, 586, 214) + stepMark(3, 646, 96) + stepMark(4, 220, 172) + stepMark(5, 494, 278) + stepMark(6, 720, 218);
  return svg(760, 296, s);
};

// ---------- Clutch: gearbox off, disc aligned, bolts in a star pattern ----------
FIG.instClutch = () => {
  let s = "";
  s += `<rect x="20" y="40" width="220" height="200" rx="14" fill="url(#gd)" stroke="${INK}"/>` + note(130, 146, "ENGINE", { anchor: "middle", fill: "#fff", size: 16, weight: 700, ls: 1.5 });
  // Flywheel, disc and pressure plate on the crank.
  s += `<ellipse cx="256" cy="140" rx="16" ry="96" fill="url(#gd)" stroke="${INK}"/><ellipse cx="252" cy="140" rx="10" ry="84" fill="url(#gface)" stroke="${INK}"/>`;
  s += `<ellipse cx="284" cy="140" rx="10" ry="78" fill="#3a3a41" stroke="${INK}"/>`;
  s += `<ellipse cx="312" cy="140" rx="16" ry="88" fill="url(#gfacer)" stroke="${INK}"/>`;
  // Alignment tool.
  s += `<rect x="250" y="134" width="130" height="12" rx="4" fill="url(#gm)" stroke="${INK}"/><rect x="372" y="126" width="26" height="28" rx="4" fill="url(#gd)" stroke="${INK}"/>`;
  // Gearbox slid back.
  s += `<path d="M450 60 L700 80 L700 200 L450 222 Z" fill="url(#gm)" stroke="${INK}" stroke-width="1.4"/>` + note(590, 146, "GEARBOX", { anchor: "middle", size: 16, weight: 700, ls: 1.5, fill: "#5b5b63" });
  s += `<rect x="440" y="134" width="40" height="12" rx="3" fill="url(#gmh)" stroke="${INK}"/>`;
  s += move("M470 40 L560 40");
  // Bolt tightening order.
  const cx = 660, cy = 268, order = [1, 4, 2, 5, 3, 6];
  s += `<circle cx="${cx}" cy="${cy}" r="40" fill="#fff" stroke="${INK}"/>`;
  order.forEach((num, i) => {
    const a = -Math.PI / 2 + i * (Math.PI / 3);
    s += `<circle cx="${n(cx + 28 * Math.cos(a))}" cy="${n(cy + 28 * Math.sin(a))}" r="9" fill="${RED}"/>` + `<text x="${n(cx + 28 * Math.cos(a))}" y="${n(cy + 28 * Math.sin(a) + 4.5)}" text-anchor="middle" font-family="Barlow Condensed" font-weight="700" font-size="13" fill="#fff">${num}</text>`;
  });
  s += note(cx - 52, cy + 6, "bolt order", { anchor: "end", size: 14 });
  s += stepMark(1, 520, 40) + stepMark(2, 312, 30) + stepMark(3, 252, 262) + stepMark(4, 398, 104) + stepMark(5, 700, 60) + stepMark(6, 160, 262);
  return svg(760, 316, s);
};
