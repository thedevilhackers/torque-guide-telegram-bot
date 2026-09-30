import { Canvas, hex } from "./raster.js";
import { stage1Gain, vehicleName } from "./vehicles.js";

// Builds estimated stock and Stage 1 power/torque curves from peak figures, then draws a
// dyno-style PNG. Curves are shaped so their peaks match the vehicle's hp/Nm figures exactly.

const KW_PER_HP = 0.73549875; // metric horsepower (PS)
const RPM_STEP = 50;
const PLATEAU_DROOP = 0.03;

// Typical torque-curve shapes. Vehicles can override redline and torqueFrom.
const PROFILES = {
  "petrol:turbo": { start: 1000, torqueFrom: 1800, torqueTo: 4500, redline: 6500, startRatio: 0.5, falloff: 1.4, stage1Shift: -150 },
  "diesel:turbo": { start: 1000, torqueFrom: 1750, torqueTo: 2750, redline: 4500, startRatio: 0.45, falloff: 1.4, stage1Shift: -100 },
  "petrol:supercharged": { start: 1000, torqueFrom: 2500, torqueTo: 4500, redline: 6500, startRatio: 0.65, falloff: 1.6, stage1Shift: 0 },
  "petrol:naturally_aspirated": { start: 1000, torqueFrom: 4300, torqueTo: 4700, redline: 6800, startRatio: 0.72, falloff: 2.4, stage1Shift: 0 }
};

export const powerHp = (nm, rpm) => (nm * rpm) / 9549.3 / KW_PER_HP;

export function curveProfile(vehicle) {
  const key = vehicle.fuel === "diesel" ? "diesel:turbo" : `petrol:${vehicle.aspiration}`;
  const profile = { ...(PROFILES[key] ?? PROFILES["petrol:turbo"]) };
  if (vehicle.redline) profile.redline = vehicle.redline;
  if (vehicle.torqueFrom) profile.torqueFrom = vehicle.torqueFrom;
  profile.torqueTo = Math.max(profile.torqueTo, profile.torqueFrom + 400);
  return profile;
}

const smoothstep = (t) => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};

function torqueAt(rpm, shape, peak, endRatio) {
  const { start, torqueFrom, torqueTo, redline, startRatio, falloff } = shape;
  if (rpm <= torqueFrom) return peak * (startRatio + (1 - startRatio) * smoothstep((rpm - start) / (torqueFrom - start)));
  if (rpm <= torqueTo) return peak * (1 - (PLATEAU_DROOP * (rpm - torqueFrom)) / (torqueTo - torqueFrom));
  const plateauEnd = 1 - PLATEAU_DROOP;
  return peak * (plateauEnd - (plateauEnd - endRatio) * ((rpm - torqueTo) / (redline - torqueTo)) ** falloff);
}

function interpolate(xs, ys, x) {
  if (x < xs[0] || x > xs.at(-1)) return 0;
  const i = Math.min(xs.length - 2, Math.floor((x - xs[0]) / RPM_STEP));
  const t = (x - xs[i]) / (xs[i + 1] - xs[i]);
  return ys[i] + (ys[i + 1] - ys[i]) * t;
}

const snap = (rpm) => Math.round(rpm / RPM_STEP) * RPM_STEP;

// Finds how far torque must fall after the plateau so peak power equals target.hp.
export function solveCurve(target, profile, floor = () => 0) {
  let redline = profile.redline;
  let plateauScale = 0.93;
  for (let attempt = 0; ; attempt++) {
    // Keep the plateau short enough that it cannot overshoot the target power.
    const capRpm = (target.hp * KW_PER_HP * 9549.3) / ((1 - PLATEAU_DROOP) * target.nm);
    const torqueTo = snap(Math.max(profile.start + 600, Math.min(profile.torqueTo, capRpm * plateauScale, redline - 500)));
    const torqueFrom = snap(Math.max(profile.start + 300, Math.min(profile.torqueFrom, torqueTo - 300)));
    const shape = { ...profile, torqueFrom, torqueTo, redline };
    const rpm = [];
    for (let value = profile.start; value <= redline; value += RPM_STEP) rpm.push(value);
    const build = (endRatio) => rpm.map((value) => Math.max(torqueAt(value, shape, target.nm, endRatio), floor(value)));
    const peakPower = (torque) => Math.max(...torque.map((nm, i) => powerHp(nm, rpm[i])));
    let low = 0.05;
    let high = 1 - PLATEAU_DROOP;
    if (attempt < 24) {
      // The target needs more revs than this profile allows: extend the rev range.
      if (peakPower(build(high)) < target.hp) {
        redline += 250;
        continue;
      }
      // Even the steepest fall-off overshoots: end the torque plateau earlier.
      if (peakPower(build(low)) > target.hp) {
        plateauScale *= 0.94;
        continue;
      }
    }
    for (let i = 0; i < 40; i++) {
      const mid = (low + high) / 2;
      if (peakPower(build(mid)) > target.hp) high = mid;
      else low = mid;
    }
    const torque = build((low + high) / 2);
    return { rpm, torque, power: torque.map((nm, i) => powerHp(nm, rpm[i])) };
  }
}

export function buildDynoCurves(vehicle) {
  const profile = curveProfile(vehicle);
  const stock = solveCurve(vehicle.stock, profile);
  // Stage 1 never drops below the stock curve.
  const stage1 = solveCurve(vehicle.stage1, { ...profile, torqueFrom: profile.torqueFrom + profile.stage1Shift }, (rpm) => interpolate(stock.rpm, stock.torque, rpm) * 1.02);
  return { stock, stage1 };
}

const WIDTH = 1200;
const HEIGHT = 800;
const PLOT = { left: 100, right: 1100, top: 196, bottom: 664 };
const DIVISIONS = 6;
const THEME = {
  background: hex("#0b0e14"),
  panel: hex("#121722"),
  grid: hex("#232a38"),
  text: hex("#f3f5f9"),
  muted: hex("#8b94a7"),
  power: hex("#ff3b3b"),
  powerStock: hex("#b06a6a"),
  powerGain: hex("#ff3b3b", 0.16),
  torque: hex("#39a0ff"),
  torqueStock: hex("#6b8fb8"),
  warning: hex("#ffb020")
};
const DASH = [10, 7];

function niceStep(raw) {
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  return [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map((m) => m * magnitude).find((step) => step >= raw);
}

function fitText(canvas, text, maxWidth, sizes) {
  for (const size of sizes) if (canvas.measureText(text, size) <= maxWidth) return { text, size };
  const size = sizes.at(-1);
  let shortened = text;
  while (shortened.length > 1 && canvas.measureText(`${shortened}...`, size) > maxWidth) shortened = shortened.slice(0, -1);
  return { text: `${shortened.trimEnd()}...`, size };
}

function statCard(canvas, x, y, { label, percent, gain, detail, color }) {
  canvas.fillRect(x, y, 196, 124, THEME.panel);
  canvas.fillRect(x, y, 4, 124, color);
  canvas.text(label, x + 18, y + 16, 2, THEME.muted);
  canvas.text(`+${percent}%`, x + 182, y + 16, 2, color, "right");
  canvas.text(gain, x + 18, y + 42, 4, color);
  canvas.text(detail, x + 18, y + 90, 2, THEME.text);
}

function legendItem(canvas, x, y, label, color, dashed) {
  canvas.polyline([[x, y + 7], [x + 36, y + 7]], 4, color, dashed ? [8, 6] : undefined);
  canvas.text(label, x + 48, y, 2, THEME.text);
}

function peakMarker(canvas, points, values, color, label) {
  const index = values.indexOf(Math.max(...values));
  const [x, y] = points[index];
  canvas.fillCircle(x, y, 8, color);
  canvas.fillCircle(x, y, 4, THEME.panel);
  const width = canvas.measureText(label, 2) + 16;
  const left = Math.min(PLOT.right - width - 4, Math.max(PLOT.left + 4, x - width / 2));
  const top = Math.max(PLOT.top + 6, y - 44);
  canvas.fillRect(left, top, width, 26, color);
  canvas.text(label, left + 8, top + 6, 2, THEME.background);
}

export function renderStage1Chart(vehicle, { businessName = "Unity Performance", curves = buildDynoCurves(vehicle) } = {}) {
  const { stock, stage1 } = curves;
  const gain = stage1Gain(vehicle);
  const canvas = new Canvas(WIDTH, HEIGHT, THEME.background);

  // Header and headline gains.
  canvas.text(businessName, 48, 34, 4, THEME.text);
  canvas.text("STAGE 1 PERFORMANCE GRAPH", 48, 76, 2, THEME.power);
  const title = fitText(canvas, vehicleName(vehicle), 672, [3, 2]);
  canvas.text(title.text, 48, 104, title.size, THEME.text);
  const aspiration = { turbo: "TURBO", supercharged: "SUPERCHARGED", naturally_aspirated: "NA" }[vehicle.aspiration] ?? "";
  // Shorten the engine name rather than losing the fuel type or years.
  const suffix = ["", [vehicle.fuel, aspiration].join(" ").trim(), vehicle.years].filter((part, i) => i === 0 || part).join(" - ");
  const engine = fitText(canvas, vehicle.engine, 672 - canvas.measureText(suffix, 2), [2]);
  canvas.text(`${engine.text}${suffix}`, 48, 140, 2, THEME.muted);
  statCard(canvas, 744, 32, { label: "POWER", percent: gain.hpPercent, gain: `+${gain.hp} HP`, detail: `${vehicle.stock.hp} > ${vehicle.stage1.hp} HP`, color: THEME.power });
  statCard(canvas, 956, 32, { label: "TORQUE", percent: gain.nmPercent, gain: `+${gain.nm} NM`, detail: `${vehicle.stock.nm} > ${vehicle.stage1.nm} NM`, color: THEME.torque });

  // Axes: power on the left, torque on the right, sharing the same gridlines.
  const powerStep = niceStep((Math.max(...stage1.power) * 1.15) / DIVISIONS);
  const torqueStep = niceStep((Math.max(...stage1.torque) * 1.15) / DIVISIONS);
  const minRpm = stock.rpm[0];
  const maxRpm = Math.ceil(Math.max(stock.rpm.at(-1), stage1.rpm.at(-1)) / 500) * 500;
  const plotHeight = PLOT.bottom - PLOT.top;
  const x = (rpm) => PLOT.left + ((rpm - minRpm) / (maxRpm - minRpm)) * (PLOT.right - PLOT.left);
  const yPower = (hp) => PLOT.bottom - (hp / (powerStep * DIVISIONS)) * plotHeight;
  const yTorque = (nm) => PLOT.bottom - (nm / (torqueStep * DIVISIONS)) * plotHeight;

  canvas.fillRect(PLOT.left, PLOT.top, PLOT.right - PLOT.left, plotHeight, THEME.panel);
  for (let i = 0; i <= DIVISIONS; i++) {
    const y = PLOT.bottom - (i * plotHeight) / DIVISIONS;
    canvas.fillRect(PLOT.left, y - 0.5, PLOT.right - PLOT.left, 1, THEME.grid);
    canvas.text(String(Math.round(i * powerStep)), PLOT.left - 12, y - 7, 2, THEME.powerStock, "right");
    canvas.text(String(Math.round(i * torqueStep)), PLOT.right + 12, y - 7, 2, THEME.torqueStock);
  }
  for (let rpm = Math.ceil(minRpm / 1000) * 1000; rpm <= maxRpm; rpm += 1000) {
    canvas.fillRect(x(rpm) - 0.5, PLOT.top, 1, plotHeight, THEME.grid);
    canvas.text(String(rpm), x(rpm), PLOT.bottom + 12, 2, THEME.muted, "center");
  }
  canvas.text("POWER (HP)", PLOT.left - 52, PLOT.top - 28, 2, THEME.power);
  canvas.text("TORQUE (NM)", PLOT.right + 52, PLOT.top - 28, 2, THEME.torque, "right");
  canvas.text("ENGINE SPEED (RPM)", (PLOT.left + PLOT.right) / 2, PLOT.bottom + 36, 2, THEME.muted, "center");

  // Curves, with the Stage 1 power gain shaded.
  const powerPoints = (curve) => curve.rpm.map((rpm, i) => [x(rpm), yPower(curve.power[i])]);
  const torquePoints = (curve) => curve.rpm.map((rpm, i) => [x(rpm), yTorque(curve.torque[i])]);
  canvas.fillPolygon([...powerPoints(stage1), ...powerPoints(stock).reverse()], THEME.powerGain);
  canvas.polyline(torquePoints(stock), 3, THEME.torqueStock, DASH);
  canvas.polyline(powerPoints(stock), 3, THEME.powerStock, DASH);
  canvas.polyline(torquePoints(stage1), 4, THEME.torque);
  canvas.polyline(powerPoints(stage1), 5, THEME.power);
  peakMarker(canvas, torquePoints(stage1), stage1.torque, THEME.torque, `${vehicle.stage1.nm} NM`);
  peakMarker(canvas, powerPoints(stage1), stage1.power, THEME.power, `${vehicle.stage1.hp} HP`);

  // Legend and footer.
  const legendY = 724;
  legendItem(canvas, PLOT.left, legendY, "STAGE 1 POWER", THEME.power, false);
  legendItem(canvas, PLOT.left + 250, legendY, "STOCK POWER", THEME.powerStock, true);
  legendItem(canvas, PLOT.left + 500, legendY, "STAGE 1 TORQUE", THEME.torque, false);
  legendItem(canvas, PLOT.left + 750, legendY, "STOCK TORQUE", THEME.torqueStock, true);
  canvas.fillRect(48, 756, WIDTH - 96, 1, THEME.grid);
  canvas.text("ESTIMATED CURVES - FINAL FIGURES CONFIRMED ON THE DYNO", 48, 770, 2, THEME.muted);
  if (vehicle.source === "ai") canvas.text("AI ESTIMATE - TO BE VERIFIED", WIDTH - 48, 770, 2, THEME.warning, "right");
  return canvas.toPng();
}
