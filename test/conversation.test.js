import test from "node:test";
import assert from "node:assert/strict";

process.env.WHATSAPP_NUMBER = "94770000000";
process.env.BUSINESS_NAME = "Unity Performance";

const { createConversation } = await import("../src/conversation.js");
const tuning = await import("../src/tuning-service.js");

function fakeBot({ aiEnabled = true, identified = null, label = null } = {}) {
  const sent = [];
  const labelCalls = [];
  const telegram = {
    sendText: async (chatId, text, options = {}) => sent.push({ kind: "text", chatId, text, ...options }),
    sendPhoto: async (chatId, png, options = {}) => sent.push({ kind: "photo", chatId, png, ...options }),
    sendVenue: async (chatId, venue) => sent.push({ kind: "venue", chatId, ...venue }),
    sendChatAction: async () => {},
    // A tiny JPEG: only its first bytes matter.
    downloadFile: async () => Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16])
  };
  const ai = {
    aiEnabled: () => aiEnabled,
    makeStage1Report: async (_, vehicle) => tuning.fallbackStage1Report(vehicle),
    formatStage1Report: tuning.formatStage1Report,
    identifyVehicle: async () => identified,
    askAssistant: async (_, question) => `Answer to: ${question}`,
    readEcuLabel: async (_, image, note) => {
      labelCalls.push({ image, note });
      return label;
    }
  };
  const handle = createConversation({ telegram, ai, renderChart: () => Buffer.from("png") });
  return { handle, sent, labelCalls, last: () => sent.at(-1) };
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

test("customers can view Stage 2 and 3 graphs and enquire about the stage they chose", async () => {
  const { sent, last } = fakeBot();
  const chat = "chat-stages";
  const charts = [];
  const bot = createConversation({
    telegram: { sendText: async (chatId, text, options = {}) => sent.push({ kind: "text", text, ...options }), sendPhoto: async (chatId, png, options = {}) => sent.push({ kind: "photo", ...options }), sendChatAction: async () => {} },
    ai: { aiEnabled: () => false, makeStage1Report: async (_, vehicle) => tuning.fallbackStage1Report(vehicle), formatStage1Report: tuning.formatStage1Report },
    renderChart: (vehicle, options) => (charts.push(options.stage), Buffer.from("png"))
  });
  await bot(chat, { data: "veh:vw_golf7_gti", from: { first_name: "Ann" } });
  assert.ok(buttonData(last()).includes("stage:2") && buttonData(last()).includes("stage:3"), "Stage 2 and 3 buttons are offered");

  await bot(chat, { data: "stage:3" });
  const photo = last();
  assert.equal(photo.kind, "photo");
  assert.deepEqual(charts, [1, 3]);
  assert.match(photo.caption, /Stage 3 · Volkswagen Golf GTI Mk7/);
  assert.match(photo.caption, /220 → <b>375 hp<\/b>/);
  assert.match(photo.caption, /upgraded turbocharger/);
  assert.equal(photo.buttons[0][0].data, "next");

  await bot(chat, { data: "next" });
  await bot(chat, { text: "Kandy" });
  await bot(chat, { data: "ecu:simos18" });
  assert.match(last().text, /Your Stage 3 enquiry/);
  assert.match(decodeURIComponent(last().buttons[0][0].url), /I'd like a Stage 3 tune[\s\S]*Stage 3 estimate: 375 hp \/ 485 Nm/);

  await bot(chat, { data: "stage:3" });
  await bot("chat-city", { data: "veh:honda_city_15" });
  await bot("chat-city", { data: "stage:2" });
  assert.match(last().text, /don't have Stage 2 figures/);
});

test("the owner links and unlinks alert chats from Telegram", async () => {
  const { createLinkCode, alertChats } = await import("../src/alerts.js");
  const { handle, last } = fakeBot();
  const { code } = createLinkCode();
  await handle("owner-chat", { text: `/start alerts_${code}`, from: { first_name: "Owner" } });
  assert.match(last().text, /Alerts are on/);
  assert.ok(alertChats().some((chat) => chat.chatId === "owner-chat"));
  await handle("other-chat", { text: `/alerts ${code}` });
  assert.match(last().text, /expired or was already used/);
  await handle("owner-chat", { text: "/stopalerts" });
  assert.match(last().text, /Alerts are off/);
  assert.ok(!alertChats().some((chat) => chat.chatId === "owner-chat"));
});

test("the menu links to the Instagram page when one is set", async () => {
  const { settings, transact } = await import("../src/db.js");
  const { handle, last } = fakeBot();
  const instagramButton = () => last().buttons.flat().find((button) => /Instagram/.test(button.text));
  await handle("chat-instagram", { text: "/start" });
  assert.equal(instagramButton()?.url, settings().instagram);
  assert.match(instagramButton().url, /^https:\/\/www\.instagram\.com\//);
  const saved = settings().instagram;
  transact((data) => {
    data.settings.instagram = "";
  });
  try {
    await handle("chat-instagram", { text: "/start" });
    assert.equal(instagramButton(), undefined);
  } finally {
    transact((data) => {
      data.settings.instagram = saved;
    });
  }
});

test("Can you read my car? shows the usual ECU and how Autotuner and KESS3 read it", async () => {
  const { handle, last } = fakeBot();
  await handle("chat-read", { text: "/start" });
  assert.ok(buttonData(last()).includes("readcheck"));
  await handle("chat-read", { data: "readcheck" });
  assert.match(last().text, /Can we read your car/);
  await handle("chat-read", { text: "creta diesel" });
  assert.ok(buttonData(last()).includes("read:hyundai_creta_crdi"), "results open the read check, not the Stage 1 flow");
  await handle("chat-read", { data: "read:hyundai_creta_crdi" });
  const text = last().text;
  for (const expected of ["Bosch EDC17", "Autotuner: OBD · Bench · Boot", "KESS3: OBD · Bench · Boot", "confirm it with the tool"]) assert.ok(text.includes(expected), `missing "${expected}"`);
  assert.ok(buttonData(last()).includes("veh:hyundai_creta_crdi"));
  assert.ok(buttonData(last()).includes("https://www.alientech-tools.com/en/vehicles"), "links to Alientech's full KESS3 list");

  await handle("chat-read", { data: "read:maruti_swift_k12" });
  assert.match(last().text, /ECU on this model varies/);

  await handle("chat-read", { data: "readcheck" });
  await handle("chat-read", { text: "EDC17C57" });
  assert.match(last().text, /Autotuner's list: “EDC17C57”/);
  assert.match(last().text, /Hyundai · Bosch EDC17C57 \(\w+\): OBD · Bench · Boot/);

  await handle("chat-read", { data: "readcheck" });
  await handle("chat-read", { text: "zzz unknown car" });
  assert.match(last().text, /couldn't find/);
  assert.ok(last().buttons.flat().some((button) => button.url?.startsWith("https://wa.me/")), "offers WhatsApp for the ECU label");
});

test("an ECU label photo is read, matched to the lists, and leads to the car's gains", async () => {
  const { labelFromAi } = await import("../src/ecu-label.js");
  const { db } = await import("../src/db.js");
  const ecuIds = db().ecus.map((ecu) => ecu.id);
  const read = (fields) =>
    labelFromAi({ readable: true, ecu_maker: "Bosch", ecu_type: "EDC17C57", hardware_number: "0 281 031 234", software_number: "1037541234", oem_part_number: "39101-2A930", family: "bosch_edc17", vehicle_brand: "Hyundai", vehicle_model: "Creta", engine: "1.5 CRDi", years: "2021", fuel: "diesel", confidence: "high", question: "", notes: "", ...fields }, ecuIds);

  const { handle, last, labelCalls } = fakeBot({ label: read({}) });
  await handle("chat-label", { text: "/start" });
  assert.ok(buttonData(last()).includes("ecuphoto"));
  await handle("chat-label", { photo: { fileId: "f1" }, caption: "my creta" });
  assert.match(labelCalls[0].image, /^data:image\/jpeg;base64,/);
  assert.equal(labelCalls[0].note, "my creta");
  const text = last().text;
  for (const expected of ["ECU: Bosch EDC17C57", "Hardware no.: 0 281 031 234", "Autotuner: OBD · Bench · Boot", "Bosch EDC17: Supported", "KESS3:", "Usually fitted to: <b>Hyundai Creta 1.5 CRDi 2021</b>"]) {
    assert.ok(text.includes(expected), `missing "${expected}"`);
  }
  assert.ok(buttonData(last()).includes("veh:hyundai_creta_crdi"), "offers the matching car's gains");

  // Choosing the car shows its gains; the ECU from the label is kept, so the ECU step is skipped.
  await handle("chat-label", { data: "veh:hyundai_creta_crdi" });
  await handle("chat-label", { data: "next" });
  await handle("chat-label", { text: "Ranchi" });
  const summary = last();
  assert.match(summary.text, /Your Stage 1 enquiry/);
  assert.match(summary.text, /ECU:<\/b> Bosch EDC17/);
  const message = decodeURIComponent(summary.buttons[0][0].url.split("?text=")[1]);
  assert.ok(message.includes("ECU label (from my photo): Bosch EDC17C57, Hardware no.: 0 281 031 234"), message);

  // No car on the label: the bot asks, and the answer goes to the vehicle search.
  const unsure = fakeBot({ label: read({ vehicle_brand: "", vehicle_model: "", engine: "", confidence: "low", question: "Which car is it from?" }) });
  await unsure.handle("chat-label-2", { photo: { fileId: "f2" } });
  assert.match(unsure.last().text, /Which car is it from\?/);
  await unsure.handle("chat-label-2", { text: "creta diesel" });
  assert.ok(buttonData(unsure.last()).includes("veh:hyundai_creta_crdi"));

  // An unreadable photo asks for a better one; without AI the photo goes to WhatsApp.
  const blurry = fakeBot({ label: labelFromAi({ readable: false, question: "Please send a closer photo." }, ecuIds) });
  await blurry.handle("chat-label-3", { photo: { fileId: "f3" } });
  assert.match(blurry.last().text, /couldn't read an ECU label.*closer photo/);
  const offline = fakeBot({ aiEnabled: false });
  await offline.handle("chat-label-4", { photo: { fileId: "f4" } });
  assert.match(offline.last().text, /send it to our team on WhatsApp/);
  assert.equal(offline.labelCalls.length, 0);
});
