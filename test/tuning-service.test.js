import test from "node:test";
import assert from "node:assert/strict";
import { outputText } from "../src/openai.js";
import { fallbackStage1Report, formatStage1Report, vehicleFromAi } from "../src/tuning-service.js";
import { getVehicle } from "../src/vehicles.js";

const aiResult = {
  recognized: true,
  brand: "Nissan",
  model: "Patrol",
  generation: "Y61",
  years: "2004-2016",
  engine: "3.0 Di",
  fuel: "diesel",
  aspiration: "turbo",
  stock_hp: 160,
  stock_nm: 380,
  stage1_hp: 190,
  stage1_nm: 440,
  likely_ecus: ["bosch_edc17"],
  confidence: "medium",
  notes: "Check the engine code."
};

test("reads text from a raw Responses API payload", () => {
  const payload = { output: [{ type: "reasoning", summary: [] }, { type: "message", content: [{ type: "output_text", text: '{"a":' }, { type: "output_text", text: "1}" }] }] };
  assert.equal(outputText(payload), '{"a":1}');
  assert.equal(outputText({ output: [] }), "");
});

test("fallback report suits the engine type", () => {
  const diesel = fallbackStage1Report(getVehicle("toyota_hilux_28b"));
  assert.match(diesel.summary, /\+80 Nm/);
  assert.ok(diesel.prepare.some((item) => /injectors/.test(item)));
  const naturallyAspirated = fallbackStage1Report(getVehicle("honda_city_15"));
  assert.match(naturallyAspirated.summary, /naturally aspirated/);
  assert.ok(naturallyAspirated.checks.some((item) => /Emissions/.test(item)));
});

test("formatted report escapes HTML from AI text", () => {
  const output = formatStage1Report(getVehicle("bmw_330i_g20"), { summary: "Uses <b>more</b> boost & timing", prepare: ["A < B"], checks: ["ok"] });
  assert.match(output, /Uses &lt;b&gt;more&lt;\/b&gt; boost &amp; timing/);
  assert.match(output, /• A &lt; B/);
});

test("AI vehicles keep plausible figures and ECU hints", () => {
  const vehicle = vehicleFromAi(aiResult);
  assert.equal(vehicle.source, "ai");
  assert.deepEqual(vehicle.stock, { hp: 160, nm: 380 });
  assert.deepEqual(vehicle.stage1, { hp: 190, nm: 440 });
  assert.deepEqual(vehicle.ecus, ["bosch_edc17"]);
  assert.equal(vehicle.tunable, true);
});

test("AI Stage 1 figures are clamped to the workshop's limits", () => {
  const greedy = vehicleFromAi({ ...aiResult, stage1_hp: 400, stage1_nm: 0 });
  assert.equal(greedy.stage1.hp, Math.round(160 * 1.35));
  assert.equal(greedy.stage1.nm, Math.round(380 * 1.18));
  const naturallyAspirated = vehicleFromAi({ ...aiResult, fuel: "petrol", aspiration: "naturally_aspirated", stage1_hp: 200 });
  assert.equal(naturallyAspirated.stage1.hp, 176);
});

test("unrecognised, implausible and electrified AI results are handled safely", () => {
  assert.equal(vehicleFromAi({ ...aiResult, recognized: false }), null);
  assert.equal(vehicleFromAi({ ...aiResult, stock_hp: 0 }), null);
  assert.equal(vehicleFromAi({ ...aiResult, stock_hp: 100, stock_nm: 900 }), null);
  const hybrid = vehicleFromAi({ ...aiResult, fuel: "hybrid" });
  assert.equal(hybrid.tunable, false);
  assert.equal(hybrid.stock, undefined);
});
