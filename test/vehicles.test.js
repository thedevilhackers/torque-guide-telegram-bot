import test from "node:test";
import assert from "node:assert/strict";
import { brandById, ecuById } from "../src/catalog.js";
import { getVehicle, searchVehicles, stage1Gain, vehicleEntries } from "../src/vehicles.js";

test("vehicle database entries are complete and consistent", () => {
  const ids = new Set();
  for (const entry of vehicleEntries()) {
    assert.ok(!ids.has(entry.id), `duplicate id ${entry.id}`);
    ids.add(entry.id);
    assert.ok(Buffer.byteLength(`veh:${entry.id}`) <= 64, `${entry.id} is too long for Telegram callback data`);
    assert.ok(brandById(entry.brand), `${entry.id} has unknown brand ${entry.brand}`);
    assert.ok(["petrol", "diesel"].includes(entry.fuel), `${entry.id} fuel`);
    for (const ecu of entry.ecus) assert.ok(ecuById(ecu), `${entry.id} has unknown ECU ${ecu}`);
    const [stockHp, stockNm] = entry.stock;
    const [stageHp, stageNm] = entry.stage1;
    assert.ok(stageHp >= stockHp * 1.03 && stageNm >= stockNm * 1.03, `${entry.id} Stage 1 must beat stock by at least 3%`);
    assert.ok(stageHp <= stockHp * 1.45 && stageNm <= stockNm * 1.45, `${entry.id} Stage 1 gain looks unrealistic`);
  }
});

test("search matches model names, aliases and engine sizes", () => {
  assert.deepEqual(searchVehicles("golf gti").map((vehicle) => vehicle.id), ["vw_golf7_gti", "vw_golf8_gti"]);
  assert.ok(searchVehicles("VW polo").some((vehicle) => vehicle.id === "vw_polo_gti"));
  assert.ok(searchVehicles("merc c63").some((vehicle) => vehicle.id === "mb_c63s_w205"));
  assert.ok(searchVehicles("hilux 2.8").every((vehicle) => vehicle.model.includes("Hilux")));
  assert.ok(searchVehicles("D-Max").some((vehicle) => vehicle.id === "isuzu_dmax_30"));
});

test("a model year ranks the matching generation first", () => {
  assert.equal(searchVehicles("golf gti 2022")[0].id, "vw_golf8_gti");
  assert.equal(searchVehicles("golf gti 2016")[0].id, "vw_golf7_gti");
});

test("search ignores nonsense and year-only queries", () => {
  assert.deepEqual(searchVehicles("zzzz"), []);
  assert.deepEqual(searchVehicles("2019"), []);
  assert.deepEqual(searchVehicles("   "), []);
});

test("stage 1 gains are calculated from the database figures", () => {
  assert.deepEqual(stage1Gain(getVehicle("vw_golf7_gti")), { hp: 70, nm: 70, hpPercent: 32, nmPercent: 20 });
});
