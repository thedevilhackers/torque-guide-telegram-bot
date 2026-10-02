import assert from "node:assert/strict";
import test from "node:test";
import { AUTOTUNER_SOURCE, searchAutotuner } from "../src/tool-lists.js";

test("Autotuner's list is searchable by ECU, brand and chip", () => {
  assert.ok(AUTOTUNER_SOURCE.size > 2000);
  assert.match(AUTOTUNER_SOURCE.url, /^https:\/\/www\.autotuner\.com\//);

  const exact = searchAutotuner("EDC17C57");
  assert.ok(exact.total > 0);
  assert.ok(exact.results.every((entry) => entry.ecu.startsWith("EDC17C57")), "an exact ECU name finds that ECU");
  assert.ok(exact.results.some((entry) => entry.brand === "Hyundai" && entry.methods.includes("obd")));
  assert.deepEqual(searchAutotuner("edc 17 c57").total, exact.total, "spaces in the ECU name don't matter");

  assert.ok(searchAutotuner("maruti").results.every((entry) => entry.brand === "Suzuki"), "Maruti finds Suzuki");
  assert.ok(searchAutotuner("citroen").total > 0, "accents don't matter");
  assert.ok(searchAutotuner("hyundai edc17").results.every((entry) => entry.brand.startsWith("Hyundai") && entry.ecu.startsWith("EDC17")), "every word must match");
  assert.deepEqual(searchAutotuner(""), { total: 0, results: [] });
  assert.equal(searchAutotuner("zzzz").total, 0);
  assert.equal(searchAutotuner("bosch", { limit: 5 }).results.length, 5);
});

test("every entry has known methods in a fixed order", () => {
  const { results } = searchAutotuner("bosch", { limit: 5000 });
  const order = ["obd", "bench", "boot"];
  for (const entry of results) {
    assert.ok(entry.methods.every((method) => order.includes(method)), `${entry.ecu}: ${entry.methods}`);
    assert.deepEqual(entry.methods, [...entry.methods].sort((a, b) => order.indexOf(a) - order.indexOf(b)));
    for (const method of entry.beta ?? []) assert.ok(entry.methods.includes(method), `${entry.ecu}: beta ${method} is one of its methods`);
  }
});
