import test from "node:test";
import assert from "node:assert/strict";
import { deflateSync, inflateSync } from "node:zlib";
import { buildDynoCurves, renderStageChart } from "../src/dyno-chart.js";
import { dashSegments, decodePng } from "../src/raster.js";
import { availableStages, getVehicle, stageFigures, vehicleEntries } from "../src/vehicles.js";

test("curves peak at exactly the stock and stage figures for every vehicle and stage", () => {
  for (const { id } of vehicleEntries()) {
    const vehicle = getVehicle(id);
    for (const stage of availableStages(vehicle)) {
      const { stock, tuned } = buildDynoCurves(vehicle, stage);
      const target = stageFigures(vehicle, stage);
      assert.ok(Math.abs(Math.max(...stock.power) - vehicle.stock.hp) < 0.5, `${id} stock power`);
      assert.ok(Math.abs(Math.max(...stock.torque) - vehicle.stock.nm) < 0.5, `${id} stock torque`);
      assert.ok(Math.abs(Math.max(...tuned.power) - target.hp) < 0.5, `${id} Stage ${stage} power`);
      assert.ok(Math.abs(Math.max(...tuned.torque) - target.nm) < 0.5, `${id} Stage ${stage} torque`);
      tuned.torque.forEach((nm, i) => {
        if (stock.torque[i]) assert.ok(nm >= stock.torque[i], `${id} Stage ${stage} torque dips below stock at ${tuned.rpm[i]} rpm`);
      });
    }
  }
});

test("Stage 3 builds peak torque later than Stage 1, like a bigger turbo", () => {
  const vehicle = getVehicle("vw_golf7_gti");
  const peakRpm = (curve) => curve.rpm[curve.torque.indexOf(Math.max(...curve.torque))];
  assert.ok(peakRpm(buildDynoCurves(vehicle, 3).tuned) > peakRpm(buildDynoCurves(vehicle, 1).tuned));
});

test("curves still match their peaks at the edges of the accepted AI torque/power ratios", () => {
  for (const [fuel, aspiration, hp, nm] of [["petrol", "naturally_aspirated", 300, 240], ["diesel", "turbo", 150, 525], ["petrol", "turbo", 300, 240]]) {
    const vehicle = { fuel, aspiration, stock: { hp, nm }, stage1: { hp: Math.round(hp * 1.1), nm: Math.round(nm * 1.1) } };
    const { stock, tuned } = buildDynoCurves(vehicle);
    assert.ok(Math.abs(Math.max(...stock.power) - hp) < 0.5 && Math.abs(Math.max(...stock.torque) - nm) < 0.5, `${fuel} ${hp}/${nm} stock`);
    assert.ok(Math.abs(Math.max(...tuned.power) - vehicle.stage1.hp) < 0.5, `${fuel} ${hp}/${nm} Stage 1`);
  }
});

test("chart renders as a valid 1200x800 PNG", () => {
  const png = renderStageChart(getVehicle("toyota_hilux_28b"), { businessName: "Unity Performance", stage: 2 });
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(png.toString("ascii", 12, 16), "IHDR");
  assert.equal(png.readUInt32BE(16), 1200);
  assert.equal(png.readUInt32BE(20), 800);
  const idatLength = png.readUInt32BE(33);
  assert.equal(png.toString("ascii", 37, 41), "IDAT");
  assert.equal(inflateSync(png.subarray(41, 41 + idatLength)).length, (1200 * 3 + 1) * 800);
});

test("the sheet carries the logo at the top left", () => {
  const sheet = decodePng(renderStageChart(getVehicle("vw_golf7_gti"), { stage: 1 }));
  let red = 0;
  let chrome = 0;
  for (let y = 20; y < 74; y++) {
    for (let x = 44; x < 226; x++) {
      const i = (y * sheet.width + x) * 4;
      const [r, g, b] = sheet.rgba.subarray(i, i + 3);
      if (r > 150 && r > 2 * g && r > 2 * b) red++;
      if (r > 170 && g > 170 && b > 170) chrome++;
    }
  }
  assert.ok(red > 60, `red logo pixels: ${red}`);
  assert.ok(chrome > 300, `chrome logo pixels: ${chrome}`);
});

// Builds an RGBA PNG whose rows cycle through all five PNG filter types.
function filteredPng(width, height, pixel) {
  const stride = width * 4;
  const rows = Array.from({ length: height }, (_, y) => Buffer.from(Array.from({ length: width }, (_, x) => pixel(x, y)).flat()));
  const raw = [];
  rows.forEach((row, y) => {
    const filter = y % 5;
    const up = y ? rows[y - 1] : Buffer.alloc(stride);
    raw.push(filter);
    for (let i = 0; i < stride; i++) {
      const left = i >= 4 ? row[i - 4] : 0;
      const upLeft = i >= 4 ? up[i - 4] : 0;
      const p = left + up[i] - upLeft;
      const paeth = Math.abs(p - left) <= Math.abs(p - up[i]) && Math.abs(p - left) <= Math.abs(p - upLeft) ? left : Math.abs(p - up[i]) <= Math.abs(p - upLeft) ? up[i] : upLeft;
      const predictor = [0, left, up[i], (left + up[i]) >> 1, paeth][filter];
      raw.push((row[i] - predictor) & 0xff);
    }
  });
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    return Buffer.concat([length, Buffer.from(type, "ascii"), data, Buffer.alloc(4)]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(Buffer.from(raw))), chunk("IEND", Buffer.alloc(0))]);
}

test("PNG decoding undoes every filter type", () => {
  const pixel = (x, y) => [(x * 37 + y * 11) & 0xff, (x * x + y * 7) & 0xff, (200 - x * 3 + y * y) & 0xff, (x * 13 + y * 29) & 0xff];
  const image = decodePng(filteredPng(9, 10, pixel));
  assert.equal(image.width, 9);
  assert.equal(image.height, 10);
  for (let y = 0; y < 10; y++) {
    for (let x = 0; x < 9; x++) assert.deepEqual([...image.rgba.subarray((y * 9 + x) * 4, (y * 9 + x) * 4 + 4)], pixel(x, y), `pixel ${x},${y}`);
  }
});

test("AI-estimated vehicles render too", () => {
  const vehicle = { ...getVehicle("nissan_navara_d23"), id: "ai", source: "ai", redline: undefined };
  assert.ok(renderStageChart(vehicle).length > 1000);
});

test("dashed lines alternate between drawn and skipped lengths", () => {
  const segments = dashSegments([[0, 0], [30, 0]], [10, 5]);
  assert.deepEqual(segments.map((segment) => [segment[0][0], segment.at(-1)[0]]), [[0, 10], [15, 25]]);
});
