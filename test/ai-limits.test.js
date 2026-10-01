import test from "node:test";
import assert from "node:assert/strict";

// A stand-in for the OpenAI API that counts calls.
process.env.OPENAI_API_KEY = "test-key";
process.env.AI_DAILY_LIMIT = "25";
let calls = 0;
globalThis.fetch = async () => {
  calls++;
  const text = JSON.stringify({ summary: "AI notes.", prepare: ["Fresh oil"], checks: ["Scan for faults"] });
  return new Response(JSON.stringify({ output: [{ type: "message", content: [{ type: "output_text", text }] }] }), { headers: { "content-type": "application/json" } });
};

const { requestText } = await import("../src/openai.js");
const { makeStage1Report } = await import("../src/tuning-service.js");
const { getVehicle } = await import("../src/vehicles.js");
const ask = (userId) => requestText(userId, { system: "Answer briefly.", user: "Is Stage 1 safe?" });

test("each customer gets 20 AI requests an hour; others are unaffected", async () => {
  for (let i = 0; i < 20; i++) await ask("chat-a");
  await assert.rejects(ask("chat-a"), { status: 429, message: /AI limit for now/ });
  await ask("chat-b");
  assert.equal(calls, 21, "the refused request never reached OpenAI");
});

test("a car's Stage 1 report is reused instead of asking the AI again", async () => {
  const before = calls;
  const golf = getVehicle("vw_golf7_gti");
  const first = await makeStage1Report("chat-c", golf);
  const second = await makeStage1Report("chat-d", golf);
  assert.equal(first.summary, "AI notes.");
  assert.deepEqual(second, first);
  assert.equal(calls - before, 1);
});

test("the daily limit covers all customers together", async () => {
  // 22 calls so far today; the limit is 25.
  for (const user of ["e", "f", "g"]) await ask(`chat-${user}`);
  await assert.rejects(ask("chat-h"), { status: 429, message: /busy right now/ });
  const fallback = await makeStage1Report("chat-i", getVehicle("toyota_hilux_28b"));
  assert.notEqual(fallback.summary, "AI notes.", "past the limit, the built-in report is used");
  assert.equal(calls, 25);
});
