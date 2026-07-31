import test from "node:test";
import assert from "node:assert/strict";
import { fallbackRecommendation, formatRecommendation } from "../src/tuning-service.js";

test("fallback tuning output never claims an unverified stock figure", () => {
  const result = fallbackRecommendation({ brand: "bmw", model: "3_series", fuel: "petrol", year: "2021", ecu: "bosch_med17", stage: "stage_1" });
  assert.match(result.power.stock, /Not verified/);
  assert.match(result.power.estimated_stage, /10–20%/);
  assert.ok(result.parts.length >= 4);
});

test("formatted recommendation includes safety context and parts", () => {
  const output = formatRecommendation(fallbackRecommendation({ brand: "audi", model: "a3", fuel: "diesel", year: "2020", ecu: "bosch_edc17", stage: "stage_2" }));
  assert.match(output, /Parts \/ work list/);
  assert.match(output, /qualified tuner/);
});
