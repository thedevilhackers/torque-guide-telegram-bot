import test from "node:test";
import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";
import { buildDynoCurves, renderStageChart } from "../src/dyno-chart.js";
import { dashSegments } from "../src/raster.js";
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

test("AI-estimated vehicles render too", () => {
  const vehicle = { ...getVehicle("nissan_navara_d23"), id: "ai", source: "ai", redline: undefined };
  assert.ok(renderStageChart(vehicle).length > 1000);
});

test("dashed lines alternate between drawn and skipped lengths", () => {
  const segments = dashSegments([[0, 0], [30, 0]], [10, 5]);
  assert.deepEqual(segments.map((segment) => [segment[0][0], segment.at(-1)[0]]), [[0, 10], [15, 25]]);
});
