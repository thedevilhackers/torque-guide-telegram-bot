import { linkChat, unlinkChat } from "./alerts.js";
import { ECU_STATUS, READ_METHODS, ecuById, ecus, toolSupportLines } from "./catalog.js";
import { settings } from "./db.js";
import { renderStageChart } from "./dyno-chart.js";
import { autotunerLine, familyLines, imageDataUrl, labelLines, labelMatches, vehicleQuery } from "./ecu-label.js";
import { recordTelegramEnquiry } from "./records.js";
import { getSession, resetSession, setSession } from "./store.js";
import { AUTOTUNER_SOURCE, searchAutotuner } from "./tool-lists.js";
import * as telegramApi from "./telegram.js";
import { escapeHtml as h } from "./telegram.js";
import * as tuningService from "./tuning-service.js";
import { availableStages, brandsWithVehicles, getVehicle, searchVehicles, stageFigures, stageGain, vehicleButtonLabel, vehicleName, vehiclesForBrand } from "./vehicles.js";
import { enquiryText, locationText, whatsappLink } from "./whatsapp.js";

const MAX_QUERY_LENGTH = 80;
const RESET = /^(\/start(\s.*)?|\/menu|start|menu|restart|hi|hello|hey)$/i;
// "/start alerts_CODE" (the admin panel's link) or "/alerts CODE" links a chat for owner alerts.
const LINK_ALERTS = /^\/(?:start\s+alerts_|alerts\s+)([A-Za-z0-9]{8})$/i;

const btn = (text, data) => ({ text, data });
const link = (text, url) => ({ text, url });
const menuRow = () => [btn("🏠 Menu", "menu")];
const chunk = (items, size) => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));

function customerFrom(from) {
  return { name: [from.first_name, from.last_name].filter(Boolean).join(" ").slice(0, 60), username: from.username };
}

const businessName = () => settings().businessName;

function hasWorkshop() {
  const { address, latitude, longitude } = settings();
  return Boolean(address) || (Number.isFinite(latitude) && Number.isFinite(longitude));
}

const stageNote = (stage) => (stage === 2 ? settings().stage2Note : stage === 3 ? settings().stage3Note : "");

// The stage the customer is looking at, if this vehicle has figures for it; otherwise Stage 1.
const chosenStage = (vehicle, stage) => (availableStages(vehicle).includes(stage) ? stage : 1);

export function performanceCaption(vehicle, stage = 1) {
  const gain = stageGain(vehicle, stage);
  const target = stageFigures(vehicle, stage);
  const lines = [
    `<b>Stage ${stage} · ${h(vehicleName(vehicle))}</b>`,
    h([vehicle.engine, vehicle.years].filter(Boolean).join(" · ")),
    "",
    `⚡ Power: ${vehicle.stock.hp} → <b>${target.hp} hp</b> (+${gain.hp} hp, +${gain.hpPercent}%)`,
    `🔧 Torque: ${vehicle.stock.nm} → <b>${target.nm} Nm</b> (+${gain.nm} Nm, +${gain.nmPercent}%)`
  ];
  if (stageNote(stage)) lines.push("", `🛠 ${h(stageNote(stage))}`);
  if (vehicle.source === "ai") {
    lines.push("", `🤖 AI estimate, ${h(vehicle.confidence ?? "low")} confidence. We verify your exact engine before quoting.${vehicle.notes ? `\n${h(vehicle.notes)}` : ""}`);
  }
  return lines.join("\n");
}

function ecuCheckText(ecu, vehicle) {
  const status = ECU_STATUS[ecu.status];
  if (ecu.id === "unknown") {
    const common = (vehicle?.ecus ?? []).map(ecuById).filter(Boolean).map((item) => item.title);
    const hint = common.length ? `\nCommonly fitted to this vehicle: ${h(common.join(", "))}.` : "";
    return `${status.icon} <b>ECU to be identified</b>\nNo problem. We'll confirm it from your vehicle with a photo of the ECU label or a quick diagnostic scan.${hint}`;
  }
  return `${status.icon} <b>${h(ecu.title)}</b>\n${h(status.detail)}${ecu.method ? `\nMethod: ${h(ecu.method)}` : ""}\n${toolSupportLines(ecu).map(h).join("\n")}`;
}

// Alientech's own KESS3 vehicle list: complete and always current.
const KESS3_LIST = "https://www.alientech-tools.com/en/vehicles";
const SUPPORT_NOTE = "<i>Support depends on the exact ECU hardware and software number. We confirm it with the tool before we start, and your original file is always backed up.</i>";

export function createConversation({ telegram = telegramApi, ai = tuningService, renderChart = renderStageChart } = {}) {
  async function showMenu(chatId) {
    setSession(chatId, { awaiting: undefined });
    const rows = [
      [btn("🔎 Search my vehicle", "search")],
      [btn("🛠 Can you read my car?", "readcheck"), ...(ai.aiEnabled() ? [btn("📷 ECU label photo", "ecuphoto")] : [])],
      [btn("🚗 Browse by brand", "browse"), ...(ai.aiEnabled() ? [btn("🤖 Ask AI", "ask")] : [])],
      [btn("🧾 ECUs we support", "ecus"), ...(hasWorkshop() ? [btn("📍 Our workshop", "workshop")] : [])]
    ];
    if (settings().whatsappNumber) rows.push([link("💬 Chat with us on WhatsApp", whatsappLink(`Hello ${businessName()}, I have a question about tuning.`))]);
    const { instagram } = settings();
    if (/^https:\/\//.test(instagram ?? "")) rows.push([link("📸 See our work on Instagram", instagram)]);
    const text = [
      `<b>🏁 ${h(businessName())}</b>`,
      "See what Stage 1 does for your vehicle in three quick steps:",
      "1️⃣ Find your vehicle and get its Stage 1 power graph",
      "2️⃣ Add your location",
      "3️⃣ Check your ECU, then send us the full details on WhatsApp",
      "",
      "Tip: just type your vehicle, e.g. <i>Golf GTI 2018</i> or <i>Hilux 2.8</i>."
    ].join("\n");
    return telegram.sendText(chatId, text, { buttons: rows });
  }

  async function promptSearch(chatId) {
    setSession(chatId, { awaiting: "search" });
    return telegram.sendText(chatId, "<b>🔎 Search your vehicle</b>\nType the make, model and engine, for example <i>BMW 330i</i>, <i>Ranger 3.2</i> or <i>Civic Type R</i>.", {
      buttons: [[btn("🚗 Browse by brand", "browse")], menuRow()]
    });
  }

  // "Can you read my car?": the car's usual ECU and how Autotuner and KESS3 read it.
  async function promptReadCheck(chatId) {
    setSession(chatId, { awaiting: "readcheck" });
    return telegram.sendText(
      chatId,
      "<b>🛠 Can we read your car?</b>\nType your car and engine, for example <i>Creta diesel</i>, <i>Polo 1.5 TDI</i> or <i>Fortuner 2.8</i>. We'll show its ECU and how Autotuner and KESS3 read it.\n\nKnow your ECU? Type it, for example <i>EDC17C57</i>, to check Autotuner's list.",
      { buttons: [menuRow()] }
    );
  }

  async function readSearch(chatId, query) {
    const text = query.slice(0, MAX_QUERY_LENGTH);
    setSession(chatId, { awaiting: "readcheck" });
    const results = searchVehicles(text);
    if (results.length) {
      return telegram.sendText(chatId, `<b>Results for “${h(text)}”</b>\nChoose your car:`, {
        buttons: [...results.map((vehicle) => [btn(`${vehicle.brand} ${vehicleButtonLabel(vehicle)}`, `read:${vehicle.id}`)]), [btn("🏠 Menu", "menu")]]
      });
    }
    const rows = [];
    if (settings().whatsappNumber) {
      rows.push([link("📷 Send us your ECU label on WhatsApp", whatsappLink(`Hello ${businessName()}, can you read my ${text} with Autotuner or KESS3? I'll send a photo of the ECU label.`))]);
    }
    // Not a car we list: it may be an ECU name, so try Autotuner's list.
    const { total, results: ecus } = searchAutotuner(text, { limit: 8 });
    if (total) {
      const lines = [`<b>🔎 Autotuner's list: “${h(text)}”</b>`, ""];
      for (const entry of ecus) {
        const named = entry.methods.map((method) => `${READ_METHODS[method]}${entry.beta?.includes(method) ? " (beta)" : ""}`);
        if (entry.unlock) named.push("unlock");
        if (entry.other) named.push("other method");
        lines.push(`• ${h([entry.brand, `${entry.ecuBrand} ${entry.ecu}`].filter(Boolean).join(" · "))}${entry.mcu ? ` (${h(entry.mcu)})` : ""}: ${h(named.join(" · ") || "listed, no method yet")}`);
      }
      if (total > ecus.length) lines.push(`…and ${total - ecus.length} more. Type more of the ECU name to narrow it down.`);
      lines.push("", `<i>From Autotuner's compatibility list (${h(AUTOTUNER_SOURCE.exported)}). We confirm your exact ECU before we start.</i>`);
      rows.push([btn("🔎 Search again", "readcheck"), btn("🏠 Menu", "menu")]);
      return telegram.sendText(chatId, lines.join("\n"), { buttons: rows });
    }
    rows.push([link("📋 Full KESS3 vehicle list (Alientech)", KESS3_LIST)], [btn("🔎 Try again", "readcheck"), btn("🏠 Menu", "menu")]);
    return telegram.sendText(chatId, `I couldn't find “${h(text)}” in our list. Send us a photo of the ECU label and we'll check it against the Autotuner and KESS3 lists.`, { buttons: rows });
  }

  async function showReadSupport(chatId, vehicle) {
    setSession(chatId, { awaiting: undefined });
    const fitted = (vehicle.ecus ?? []).map(ecuById).filter(Boolean);
    const lines = [`<b>🛠 ${h(vehicleName(vehicle))}</b>`, h([vehicle.engine, vehicle.years].filter(Boolean).join(" · "))];
    if (fitted.length) {
      lines.push("", fitted.length > 1 ? "One of these ECUs is usually fitted:" : "Usually fitted ECU:");
      for (const ecu of fitted) {
        const status = ECU_STATUS[ecu.status];
        lines.push("", `${status.icon} <b>${h(ecu.title)}</b> (${h(status.label)})`, ...toolSupportLines(ecu).map((line) => `• ${h(line)}`));
        if (ecu.method) lines.push(`• How we do it: ${h(ecu.method)}`);
      }
      lines.push("", SUPPORT_NOTE);
    } else {
      lines.push("", "The ECU on this model varies. Send us a photo of the ECU label, or come in for a quick scan, and we'll check it against the Autotuner and KESS3 lists.");
    }
    const rows = [[btn("📈 See the Stage 1 gains", `veh:${vehicle.id}`)]];
    if (settings().whatsappNumber) rows.push([link("💬 Ask us on WhatsApp", whatsappLink(`Hello ${businessName()}, can you read my ${vehicleName(vehicle)} (${vehicle.engine})?`))]);
    rows.push([link("📋 Full KESS3 vehicle list (Alientech)", KESS3_LIST)], [btn("🛠 Check another car", "readcheck"), btn("🏠 Menu", "menu")]);
    return telegram.sendText(chatId, lines.join("\n"), { buttons: rows });
  }

  // ---------- ECU label photo ----------

  async function promptEcuPhoto(chatId) {
    setSession(chatId, { awaiting: "ecuphoto" });
    return telegram.sendText(
      chatId,
      "<b>📷 Check my ECU label</b>\nSend a clear photo of the sticker on your ECU (the engine computer). Get close, in good light, so the numbers are sharp. If you know the car, write it in the caption.\n\nWe'll tell you which ECU and car it is, how we read it, and your Stage 1 gains.",
      { buttons: [menuRow()] }
    );
  }

  const labelWhatsapp = (label) => (settings().whatsappNumber ? [[link("💬 Send it to us on WhatsApp", whatsappLink(`Hello ${businessName()}, can you check my ECU label?${label?.readable ? `\n${labelLines(label).join("\n")}` : " I'll send the photo."}`))]] : []);

  async function readLabelPhoto(chatId, photo, caption) {
    if (!ai.aiEnabled()) {
      return telegram.sendText(chatId, "Thanks for the photo. Please send it to our team on WhatsApp and we'll check the ECU for you.", { buttons: [...labelWhatsapp(), menuRow()] });
    }
    await telegram.sendText(chatId, "📷 Got it. Reading your ECU label…");
    await telegram.sendChatAction(chatId, "typing");
    let label;
    try {
      const image = imageDataUrl(await telegram.downloadFile(photo.fileId));
      if (!image) return telegram.sendText(chatId, "Please send the label as a photo (JPEG or PNG).", { buttons: [[btn("📷 Try again", "ecuphoto")], menuRow()] });
      const { vehicle } = getSession(chatId);
      const note = [caption, vehicle && `Looking at: ${vehicleName(vehicle)}, ${vehicle.engine}`].filter(Boolean).join(". ");
      label = await ai.readEcuLabel(chatId, image, note);
    } catch (error) {
      if (error.status === 429) return telegram.sendText(chatId, h(error.message), { buttons: [...labelWhatsapp(), menuRow()] });
      console.error("ECU label read failed:", error.message);
      return telegram.sendText(chatId, "Sorry, I couldn't read that photo. Try a sharper, closer photo, or send it to us on WhatsApp.", {
        buttons: [[btn("📷 Try again", "ecuphoto")], ...labelWhatsapp(), menuRow()]
      });
    }
    return showLabel(chatId, label);
  }

  async function showLabel(chatId, label) {
    if (!label.readable) {
      setSession(chatId, { awaiting: "ecuphoto" });
      return telegram.sendText(chatId, `I couldn't read an ECU label in that photo. ${h(label.question || "Please send a sharper, closer photo of the sticker in good light.")}`, {
        buttons: [...labelWhatsapp(), menuRow()]
      });
    }
    const { family, autotuner, vehicles } = labelMatches(label);
    setSession(chatId, { ecuLabel: label, ecu: family?.id, awaiting: undefined });
    const lines = ["<b>📷 Your ECU label</b>", ...labelLines(label).map(h), ""];
    const reads = autotunerLine(autotuner);
    lines.push(reads ? h(reads) : "Autotuner: not in its list under this name; we'll check the exact version.", ...familyLines(family).map(h));
    const car = [label.vehicle.brand, label.vehicle.model, label.vehicle.engine, label.vehicle.years].filter(Boolean).join(" ");
    const rows = [];
    if (car) lines.push("", `🚗 Usually fitted to: <b>${h(car)}</b>`);
    if (vehicles.length) {
      lines.push("", "Tap your car to see the Stage 1 gains:");
      rows.push(...vehicles.map((vehicle) => [btn(`📈 ${vehicle.brand} ${vehicleButtonLabel(vehicle)}`, `veh:${vehicle.id}`)]));
    } else if (car && ai.aiEnabled()) {
      setSession(chatId, { lastQuery: vehicleQuery(label) });
      rows.push([btn("📈 Stage 1 gains for this car", "aisearch")]);
    }
    if (car) {
      rows.push([btn("✍️ It's a different car", "ecucar")]);
    } else {
      // The label didn't say which car: ask, and the answer goes to the vehicle search.
      setSession(chatId, { awaiting: "ecucar" });
      lines.push("", `❓ ${h(label.question || "Which car is this ECU from? Type the make, model, engine and year.")}`);
    }
    lines.push("", "<i>We confirm the exact ECU with the tool before we start.</i>");
    rows.push(...labelWhatsapp(label), [btn("📷 Another photo", "ecuphoto"), btn("🏠 Menu", "menu")]);
    return telegram.sendText(chatId, lines.join("\n"), { buttons: rows });
  }

  async function askLabelCar(chatId) {
    setSession(chatId, { awaiting: "ecucar" });
    return telegram.sendText(chatId, "🚗 Which car is this ECU from? Type the make, model, engine and year, for example <i>Creta 1.5 diesel 2021</i>.", { buttons: [menuRow()] });
  }

  async function showBrands(chatId) {
    const brands = brandsWithVehicles().map((brand) => btn(brand.title, `brand:${brand.id}`));
    return telegram.sendText(chatId, "<b>🚗 Choose a brand</b>", { buttons: [...chunk(brands, 2), [btn("✍️ Not listed? Type it", "search")], menuRow()] });
  }

  async function showBrand(chatId, brandId) {
    const vehicles = vehiclesForBrand(brandId);
    if (!vehicles.length) return showBrands(chatId);
    return telegram.sendText(chatId, `<b>${h(vehicles[0].brand)}</b>: choose your vehicle`, {
      buttons: [...vehicles.map((vehicle) => [btn(vehicleButtonLabel(vehicle), `veh:${vehicle.id}`)]), [btn("✍️ Not listed? Type it", "search"), btn("⬅️ Brands", "browse")]]
    });
  }

  async function search(chatId, query) {
    const text = query.slice(0, MAX_QUERY_LENGTH);
    setSession(chatId, { awaiting: "search", lastQuery: text });
    const results = searchVehicles(text);
    if (!results.length) return aiSearch(chatId, text);
    const rows = results.map((vehicle) => [btn(`${vehicle.brand} ${vehicleButtonLabel(vehicle)}`, `veh:${vehicle.id}`)]);
    if (ai.aiEnabled()) rows.push([btn("🤖 Not in the list? Let AI find it", "aisearch")]);
    rows.push([btn("🚗 Browse by brand", "browse"), btn("🏠 Menu", "menu")]);
    return telegram.sendText(chatId, `<b>Results for “${h(text)}”</b>\nChoose your vehicle:`, { buttons: rows });
  }

  async function aiSearch(chatId, query) {
    if (!query) return promptSearch(chatId);
    const retry = [[btn("🔎 Try again", "search"), btn("🚗 Browse by brand", "browse")], menuRow()];
    if (!ai.aiEnabled()) {
      return telegram.sendText(chatId, `I couldn't find “${h(query)}” in our vehicle list. Try the make and model (e.g. <i>Hilux 2.8</i>) or browse by brand.`, { buttons: retry });
    }
    await telegram.sendText(chatId, `🤖 “${h(query)}” isn't in our list yet. Asking our AI to identify it…`);
    await telegram.sendChatAction(chatId, "typing");
    let vehicle = null;
    try {
      vehicle = await ai.identifyVehicle(chatId, query);
    } catch (error) {
      if (error.status === 429) return telegram.sendText(chatId, h(error.message), { buttons: retry });
      console.error("AI vehicle search failed:", error.message);
    }
    if (!vehicle) {
      return telegram.sendText(chatId, "Sorry, I couldn't identify that vehicle. Please include the make, model, engine size and year, or browse by brand.", { buttons: retry });
    }
    return showPerformance(chatId, vehicle);
  }

  async function showPerformance(chatId, vehicle) {
    // An ECU read from the customer's label photo stays chosen; otherwise the ECU step asks again.
    const session = setSession(chatId, { vehicle, stage: 1, awaiting: undefined, ecu: getSession(chatId).ecuLabel?.family || undefined });
    if (!vehicle.tunable) {
      return telegram.sendText(
        chatId,
        `<b>${h(vehicleName(vehicle))}</b>\nThis is a ${h(vehicle.fuel)} vehicle. We don't offer Stage 1 software for hybrid or electric drivetrains, but our team can advise on other options.`,
        { buttons: [[link("💬 Ask us on WhatsApp", whatsappLink(enquiryText(session)))], [btn("🔎 Another vehicle", "search")], menuRow()] }
      );
    }
    await telegram.sendChatAction(chatId, "upload_photo");
    try {
      await telegram.sendPhoto(chatId, renderChart(vehicle, { businessName: businessName(), stage: 1 }), { caption: performanceCaption(vehicle) });
    } catch (error) {
      console.error("Stage 1 graph failed:", error.message);
      await telegram.sendText(chatId, performanceCaption(vehicle));
    }
    await telegram.sendChatAction(chatId, "typing");
    const report = await ai.makeStage1Report(chatId, vehicle);
    const next = session.location ? btn("➡️ Continue to ECU check", "next") : btn("📍 Add my location", "next");
    const moreStages = availableStages(vehicle).filter((stage) => stage > 1);
    return telegram.sendText(
      chatId,
      `${ai.formatStage1Report(vehicle, report)}\n\n<i>Figures are estimates for a healthy, standard vehicle; real results depend on its condition and fuel. We check every tune with a data-logged road test.</i>\n\n<b>Next:</b> ${session.location ? "check your ECU" : "add your location"}${moreStages.length ? ", or see what Stage 2 and 3 builds make" : ""}.`,
      { buttons: [[next], ...(moreStages.length ? [moreStages.map((stage) => btn(`📈 Stage ${stage} graph`, `stage:${stage}`))] : []), [btn("🔎 Another vehicle", "search"), btn("🏠 Menu", "menu")]] }
    );
  }

  // Shows another stage's graph. The stage last viewed is the one the enquiry is for.
  async function showStage(chatId, stage) {
    const { vehicle, location } = getSession(chatId);
    if (!vehicle) return promptSearch(chatId);
    if (!availableStages(vehicle).includes(stage)) return telegram.sendText(chatId, `We don't have Stage ${stage} figures for this vehicle yet. Ask us on WhatsApp for a quote.`, { buttons: [menuRow()] });
    setSession(chatId, { stage, awaiting: undefined });
    const others = availableStages(vehicle).filter((other) => other !== stage);
    const buttons = [
      [btn(`${location ? "➡️" : "📍"} Continue with Stage ${stage}`, "next")],
      others.map((other) => btn(`📈 Stage ${other}`, `stage:${other}`)),
      [btn("🔎 Another vehicle", "search"), btn("🏠 Menu", "menu")]
    ];
    await telegram.sendChatAction(chatId, "upload_photo");
    try {
      return await telegram.sendPhoto(chatId, renderChart(vehicle, { businessName: businessName(), stage }), { caption: performanceCaption(vehicle, stage), buttons });
    } catch (error) {
      console.error(`Stage ${stage} graph failed:`, error.message);
      return telegram.sendText(chatId, performanceCaption(vehicle, stage), { buttons });
    }
  }

  async function nextStep(chatId) {
    const session = getSession(chatId);
    if (!session.vehicle) return promptSearch(chatId);
    if (!session.location) return askLocation(chatId);
    if (!session.ecu) return askEcu(chatId);
    return showSummary(chatId);
  }

  async function askLocation(chatId) {
    setSession(chatId, { awaiting: "location" });
    return telegram.sendText(chatId, "<b>📍 Step 2 of 3: your location</b>\nTap <b>Share my location</b> below, or type your city or area.", {
      keyboard: [[{ text: "📍 Share my location", request_location: true }], [{ text: "Skip" }]],
      placeholder: "Type your city or area"
    });
  }

  async function saveLocation(chatId, location) {
    setSession(chatId, { location, awaiting: undefined });
    await telegram.sendText(chatId, location.skipped ? "OK, location skipped." : `✅ Location saved: ${h(locationText(location))}`, { removeKeyboard: true });
    return nextStep(chatId);
  }

  async function askEcu(chatId) {
    const { vehicle } = setSession(chatId, { awaiting: undefined });
    const common = (vehicle?.ecus ?? []).map(ecuById).filter(Boolean);
    const others = ecus().filter((ecu) => !common.includes(ecu) && (!vehicle?.fuel || ecu.fuels.includes(vehicle.fuel)));
    const lines = ["<b>🧾 Step 3 of 3: ECU check</b>", "Which ECU is fitted? It's printed on the ECU label, and a diagnostic scan also shows it."];
    if (common.length) lines.push(`⭐ = commonly fitted to the ${h(vehicleName(vehicle))}`);
    return telegram.sendText(chatId, lines.join("\n"), {
      buttons: [...common.map((ecu) => [btn(`⭐ ${ecu.title}`, `ecu:${ecu.id}`)]), ...others.map((ecu) => [btn(ecu.title, `ecu:${ecu.id}`)]), [btn("❓ Not sure: check for me", "ecu:unknown")]]
    });
  }

  async function checkEcu(chatId, ecuId) {
    const ecu = ecuById(ecuId);
    if (!ecu) return askEcu(chatId);
    const { vehicle } = setSession(chatId, { ecu: ecu.id, awaiting: undefined });
    await telegram.sendText(chatId, ecuCheckText(ecu, vehicle));
    return nextStep(chatId);
  }

  async function showSummary(chatId) {
    const session = getSession(chatId);
    const { vehicle, location } = session;
    if (!vehicle) return promptSearch(chatId);
    try {
      recordTelegramEnquiry(chatId, session);
    } catch (error) {
      console.error("Could not record enquiry:", error.message);
    }
    const ecu = ecuById(session.ecu);
    const stage = chosenStage(vehicle, session.stage);
    const lines = [`<b>📄 Your Stage ${stage} enquiry</b>`, "", `<b>Vehicle:</b> ${h(vehicleName(vehicle))}${vehicle.years ? ` (${h(vehicle.years)})` : ""}`, `<b>Engine:</b> ${h(vehicle.engine)}, ${h(vehicle.fuel)}`];
    if (vehicle.tunable) {
      const gain = stageGain(vehicle, stage);
      const target = stageFigures(vehicle, stage);
      lines.push(`<b>Stock:</b> ${vehicle.stock.hp} hp / ${vehicle.stock.nm} Nm`, `<b>Stage ${stage}:</b> ${target.hp} hp / ${target.nm} Nm (+${gain.hp} hp / +${gain.nm} Nm)`);
    }
    if (ecu) {
      const status = ECU_STATUS[ecu.status];
      lines.push(`<b>ECU:</b> ${ecu.id === "unknown" ? "Not sure, we'll identify it" : `${h(ecu.title)}, ${status.icon} ${h(status.label)}`}`);
    }
    lines.push(`<b>Location:</b> ${h(locationText(location))}`, "", `Tap <b>Send full details on WhatsApp</b>. The message to ${h(businessName())} is already written; just press send.`);
    return telegram.sendText(chatId, lines.join("\n"), {
      buttons: [
        [link("📲 Send full details on WhatsApp", whatsappLink(enquiryText(session)))],
        [btn("📍 Change location", "loc"), btn("🧾 Change ECU", "ecu_menu")],
        [btn("🔎 Another vehicle", "search"), btn("🏠 Menu", "menu")]
      ]
    });
  }

  async function showEcuList(chatId) {
    const groups = Object.entries(ECU_STATUS)
      .map(([status, info]) => [info, ecus().filter((ecu) => ecu.status === status)])
      .filter(([, ecus]) => ecus.length)
      .map(([info, ecus]) => `<b>${info.icon} ${h(info.label)}</b>\n${ecus.map((ecu) => `• <b>${h(ecu.title)}</b>: ${h(ecu.method)}\n   ${h(toolSupportLines(ecu).join(" | "))}`).join("\n")}`);
    const text = [`<b>🧾 ECUs ${h(businessName())} tunes</b>`, ...groups, "Not sure which ECU you have? Check your car and we'll show its usual ECU."].join("\n\n");
    return telegram.sendText(chatId, text, { buttons: [[btn("🛠 Can you read my car?", "readcheck")], menuRow()] });
  }

  async function showWorkshop(chatId) {
    const { address, latitude, longitude } = settings();
    if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
      return telegram.sendVenue(chatId, { latitude, longitude, title: businessName(), address: address || "Our workshop", buttons: [menuRow()] });
    }
    if (address) {
      return telegram.sendText(chatId, `<b>📍 ${h(businessName())}</b>\n${h(address)}`, {
        buttons: [[link("🗺️ Open in Google Maps", `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`)], menuRow()]
      });
    }
    return showMenu(chatId);
  }

  async function startAsk(chatId) {
    if (!ai.aiEnabled()) return showMenu(chatId);
    setSession(chatId, { awaiting: "question" });
    return telegram.sendText(chatId, "<b>🤖 Ask our AI tuning assistant</b>\nType your question, for example <i>Is Stage 1 safe for a daily driver?</i> or <i>What fuel do I need after tuning?</i>", {
      buttons: [menuRow()]
    });
  }

  async function answerQuestion(chatId, question) {
    const { vehicle } = getSession(chatId);
    await telegram.sendChatAction(chatId, "typing");
    let answer;
    try {
      answer = await ai.askAssistant(chatId, question, vehicle);
    } catch (error) {
      if (error.status !== 429) console.error("AI assistant failed:", error.message);
      answer = error.status === 429 ? error.message : "Sorry, I can't answer right now. Please try again shortly or message our team on WhatsApp.";
    }
    return telegram.sendText(chatId, `🤖 ${h(answer)}\n\n<i>Type another question, or use the buttons below.</i>`, { buttons: [[btn("🔎 Search my vehicle", "search"), btn("🏠 Menu", "menu")]] });
  }

  async function handleButton(chatId, data) {
    const [action, value = ""] = data.split(":", 2);
    switch (action) {
      case "search":
        return promptSearch(chatId);
      case "browse":
        return showBrands(chatId);
      case "brand":
        return showBrand(chatId, value);
      case "veh": {
        const vehicle = getVehicle(value);
        return vehicle ? showPerformance(chatId, vehicle) : promptSearch(chatId);
      }
      case "stage":
        return showStage(chatId, Number(value));
      case "aisearch":
        return aiSearch(chatId, getSession(chatId).lastQuery ?? "");
      case "next":
        return nextStep(chatId);
      case "loc":
        return askLocation(chatId);
      case "ecu_menu":
        return askEcu(chatId);
      case "ecu":
        return checkEcu(chatId, value);
      case "ecus":
        return showEcuList(chatId);
      case "readcheck":
        return promptReadCheck(chatId);
      case "ecuphoto":
        return promptEcuPhoto(chatId);
      case "ecucar":
        return askLabelCar(chatId);
      case "read": {
        const vehicle = getVehicle(value);
        return vehicle ? showReadSupport(chatId, vehicle) : promptReadCheck(chatId);
      }
      case "ask":
        return startAsk(chatId);
      case "workshop":
        return showWorkshop(chatId);
      default:
        return showMenu(chatId);
    }
  }

  // input: { text } | { data } (button press) | { location: { latitude, longitude } }, plus the Telegram `from` user.
  return async function handleConversation(chatId, input = {}) {
    const text = (input.text ?? "").trim();
    const alertCode = LINK_ALERTS.exec(text)?.[1];
    if (alertCode) {
      const linked = linkChat(chatId, input.from, alertCode);
      return telegram.sendText(
        chatId,
        linked
          ? `✅ <b>Alerts are on.</b> This chat will get a message for every new ${h(businessName())} order and enquiry. Send /stopalerts to turn them off.`
          : "That alert code has expired or was already used. Create a new one in Admin → Settings → Telegram alerts."
      );
    }
    if (/^\/stopalerts$/i.test(text)) {
      return telegram.sendText(chatId, unlinkChat(chatId) ? "🔕 Alerts are off for this chat." : "This chat wasn't receiving alerts.");
    }
    const resetting = !input.data && !input.location && (!text || RESET.test(text));
    const previous = getSession(chatId);
    if (resetting) resetSession(chatId);
    if (input.from) setSession(chatId, { customer: customerFrom(input.from) });
    // Leaving the location step another way: take the "Share my location" keyboard away.
    if (previous.awaiting === "location" && !input.location && (resetting || (input.data && input.data !== "loc"))) {
      await telegram.sendText(chatId, "OK, location step closed.", { removeKeyboard: true });
    }

    if (input.location) return saveLocation(chatId, { latitude: input.location.latitude, longitude: input.location.longitude });
    if (input.photo) return readLabelPhoto(chatId, input.photo, String(input.caption ?? "").slice(0, 200));
    if (input.data) return handleButton(chatId, input.data);
    if (resetting) return showMenu(chatId);
    if (/^\/search\b/i.test(text)) return promptSearch(chatId);
    if (/^\/ask\b/i.test(text)) return startAsk(chatId);
    if (/^\/ecus?\b/i.test(text)) return showEcuList(chatId);
    if (/^\/(read|tools?)\b/i.test(text)) return promptReadCheck(chatId);
    if (/^\/(label|photo)\b/i.test(text)) return promptEcuPhoto(chatId);
    if (previous.awaiting === "location") return saveLocation(chatId, /^skip$/i.test(text) ? { skipped: true } : { text: text.slice(0, 120) });
    if (previous.awaiting === "question") return answerQuestion(chatId, text);
    if (previous.awaiting === "readcheck") return readSearch(chatId, text);
    if (previous.awaiting === "ecuphoto") return telegram.sendText(chatId, "Please send a <b>photo</b> of the ECU label (tap the 📎 paperclip, then Camera or Gallery).", { buttons: [menuRow()] });
    return search(chatId, text.replace(/^\/\w+\s*/, ""));
  };
}

export const handleConversation = createConversation();
