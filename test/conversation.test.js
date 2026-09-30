import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "unity-bot-"));
process.env.WHATSAPP_NUMBER = "94770000000";
process.env.BUSINESS_NAME = "Unity Performance";

const { createConversation } = await import("../src/conversation.js");
const tuning = await import("../src/tuning-service.js");

function fakeBot({ aiEnabled = true, identified = null } = {}) {
  const sent = [];
  const telegram = {
    sendText: async (chatId, text, options = {}) => sent.push({ kind: "text", chatId, text, ...options }),
    sendPhoto: async (chatId, png, options = {}) => sent.push({ kind: "photo", chatId, png, ...options }),
    sendVenue: async (chatId, venue) => sent.push({ kind: "venue", chatId, ...venue }),
    sendChatAction: async () => {}
  };
  const ai = {
    aiEnabled: () => aiEnabled,
    makeStage1Report: async (_, vehicle) => tuning.fallbackStage1Report(vehicle),
    formatStage1Report: tuning.formatStage1Report,
    identifyVehicle: async () => identified,
    askAssistant: async (_, question) => `Answer to: ${question}`
  };
  const handle = createConversation({ telegram, ai, renderChart: () => Buffer.from("png") });
  return { handle, sent, last: () => sent.at(-1) };
}

const buttonData = (message) => message.buttons.flat().map((button) => button.data ?? button.url);

test("full journey: search, Stage 1 graph, location, ECU check and WhatsApp details", async () => {
  const { handle, sent, last } = fakeBot();
  const chat = "chat-journey";

  await handle(chat, { text: "/start", from: { first_name: "Sam", last_name: "Perera", username: "samp" } });
  assert.match(last().text, /Unity Performance/);
  assert.ok(buttonData(last()).includes("search"));

  await handle(chat, { text: "golf gti 2019" });
  assert.equal(last().buttons[0][0].data, "veh:vw_golf7_gti");

  sent.length = 0;
  await handle(chat, { data: "veh:vw_golf7_gti" });
  const photo = sent.find((message) => message.kind === "photo");
  assert.ok(photo, "Stage 1 graph is sent as a photo");
  assert.match(photo.caption, /220 → <b>290 hp<\/b> \(\+70 hp, \+32%\)/);
  assert.match(last().text, /What Stage 1 means/);
  assert.deepEqual(last().buttons[0][0], { text: "📍 Add my location", data: "next" });

  await handle(chat, { data: "next" });
  assert.equal(last().keyboard[0][0].request_location, true);

  sent.length = 0;
  await handle(chat, { text: "Colombo" });
  assert.match(sent[0].text, /Location saved: Colombo/);
  assert.equal(sent[0].removeKeyboard, true);
  assert.equal(last().buttons[0][0].text, "⭐ Continental Simos 18");
  assert.ok(!buttonData(last()).includes("ecu:bosch_edc17"), "diesel ECUs are not offered for a petrol car");

  sent.length = 0;
  await handle(chat, { data: "ecu:simos18" });
  assert.match(sent[0].text, /✅ <b>Continental Simos 18<\/b>/);
  const summary = last();
  assert.match(summary.text, /Your Stage 1 enquiry/);
  const whatsapp = summary.buttons[0][0];
  assert.ok(whatsapp.url.startsWith("https://wa.me/94770000000?text="));
  const message = decodeURIComponent(whatsapp.url.split("?text=")[1]);
  for (const expected of ["Name: Sam Perera", "Volkswagen Golf GTI Mk7", "Stage 1 estimate: 290 hp / 420 Nm", "ECU: Continental Simos 18 (Supported)", "Location: Colombo"]) {
    assert.ok(message.includes(expected), `WhatsApp message is missing "${expected}"`);
  }
});

test("unknown vehicles are identified by AI and labelled as estimates", async () => {
  const identified = tuning.vehicleFromAi({
    recognized: true, brand: "Nissan", model: "Patrol", generation: "Y61", years: "2004-2016", engine: "3.0 Di", fuel: "diesel", aspiration: "turbo",
    stock_hp: 160, stock_nm: 380, stage1_hp: 190, stage1_nm: 440, likely_ecus: [], confidence: "medium", notes: "Check the engine code."
  });
  const { handle, sent } = fakeBot({ identified });
  await handle("chat-ai", { text: "nissan patrol 3.0 2010" });
  const photo = sent.find((message) => message.kind === "photo");
  assert.match(photo.caption, /AI estimate, medium confidence/);
});

test("shared GPS location becomes a map link in the summary", async () => {
  const { handle, last } = fakeBot();
  await handle("chat-gps", { data: "veh:toyota_hilux_28b" });
  await handle("chat-gps", { location: { latitude: 7.2906, longitude: 80.6337 } });
  await handle("chat-gps", { data: "ecu:unknown" });
  assert.match(last().text, /maps\.google\.com\/\?q=7\.29060,80\.63370/);
  assert.match(decodeURIComponent(last().buttons[0][0].url), /ECU: Not sure, please help identify/);
});

test("without AI the bot still works and explains when a vehicle isn't listed", async () => {
  const { handle, last } = fakeBot({ aiEnabled: false });
  await handle("chat-no-ai", { text: "/start" });
  assert.ok(!buttonData(last()).includes("ask"));
  await handle("chat-no-ai", { text: "tesla model 3" });
  assert.match(last().text, /couldn't find “tesla model 3”/);
});

test("Ask AI mode answers free-text questions until the customer leaves it", async () => {
  const { handle, last } = fakeBot();
  await handle("chat-ask", { data: "ask" });
  await handle("chat-ask", { text: "Is Stage 1 <safe>?" });
  assert.match(last().text, /Answer to: Is Stage 1 &lt;safe&gt;\?/);
  await handle("chat-ask", { data: "menu" });
  await handle("chat-ask", { text: "ranger" });
  assert.ok(buttonData(last()).includes("veh:ford_ranger_32"));
});
