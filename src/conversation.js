import { ECUS, ECU_STATUS, ecuById } from "./catalog.js";
import { config } from "./config.js";
import { renderStage1Chart } from "./dyno-chart.js";
import { getSession, resetSession, setSession } from "./store.js";
import * as telegramApi from "./telegram.js";
import { escapeHtml as h } from "./telegram.js";
import * as tuningService from "./tuning-service.js";
import { brandsWithVehicles, getVehicle, searchVehicles, stage1Gain, vehicleButtonLabel, vehicleName, vehiclesForBrand } from "./vehicles.js";
import { enquiryText, locationText, whatsappLink } from "./whatsapp.js";

const MAX_QUERY_LENGTH = 80;
const RESET = /^(\/start(\s.*)?|\/menu|start|menu|restart|hi|hello|hey)$/i;

const btn = (text, data) => ({ text, data });
const link = (text, url) => ({ text, url });
const menuRow = () => [btn("🏠 Menu", "menu")];
const chunk = (items, size) => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));

function customerFrom(from) {
  return { name: [from.first_name, from.last_name].filter(Boolean).join(" ").slice(0, 60), username: from.username };
}

function hasWorkshop() {
  const { address, latitude, longitude } = config.workshop;
  return Boolean(address) || (Number.isFinite(latitude) && Number.isFinite(longitude));
}

export function performanceCaption(vehicle) {
  const gain = stage1Gain(vehicle);
  const lines = [
    `<b>Stage 1 · ${h(vehicleName(vehicle))}</b>`,
    h([vehicle.engine, vehicle.years].filter(Boolean).join(" · ")),
    "",
    `⚡ Power: ${vehicle.stock.hp} → <b>${vehicle.stage1.hp} hp</b> (+${gain.hp} hp, +${gain.hpPercent}%)`,
    `🔧 Torque: ${vehicle.stock.nm} → <b>${vehicle.stage1.nm} Nm</b> (+${gain.nm} Nm, +${gain.nmPercent}%)`
  ];
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
  return `${status.icon} <b>${h(ecu.title)}</b>\n${h(status.detail)}${ecu.method ? `\nMethod: ${h(ecu.method)}` : ""}`;
}

export function createConversation({ telegram = telegramApi, ai = tuningService, renderChart = renderStage1Chart } = {}) {
  async function showMenu(chatId) {
    setSession(chatId, { awaiting: undefined });
    const rows = [
      [btn("🔎 Search my vehicle", "search")],
      [btn("🚗 Browse by brand", "browse"), ...(ai.aiEnabled() ? [btn("🤖 Ask AI", "ask")] : [])],
      [btn("🧾 ECUs we support", "ecus"), ...(hasWorkshop() ? [btn("📍 Our workshop", "workshop")] : [])]
    ];
    if (config.whatsappNumber) rows.push([link("💬 Chat with us on WhatsApp", whatsappLink(`Hello ${config.businessName}, I have a question about tuning.`))]);
    const text = [
      `<b>🏁 ${h(config.businessName)}</b>`,
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

  async function showBrands(chatId) {
    const brands = brandsWithVehicles().map(([id, brand]) => btn(brand.title, `brand:${id}`));
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
      console.error("AI vehicle search failed:", error.message);
    }
    if (!vehicle) {
      return telegram.sendText(chatId, "Sorry, I couldn't identify that vehicle. Please include the make, model, engine size and year, or browse by brand.", { buttons: retry });
    }
    return showPerformance(chatId, vehicle);
  }

  async function showPerformance(chatId, vehicle) {
    const session = setSession(chatId, { vehicle, awaiting: undefined, ecu: undefined });
    if (!vehicle.tunable) {
      return telegram.sendText(
        chatId,
        `<b>${h(vehicleName(vehicle))}</b>\nThis is a ${h(vehicle.fuel)} vehicle. We don't offer Stage 1 software for hybrid or electric drivetrains, but our team can advise on other options.`,
        { buttons: [[link("💬 Ask us on WhatsApp", whatsappLink(enquiryText(session)))], [btn("🔎 Another vehicle", "search")], menuRow()] }
      );
    }
    await telegram.sendChatAction(chatId, "upload_photo");
    try {
      await telegram.sendPhoto(chatId, renderChart(vehicle, { businessName: config.businessName }), { caption: performanceCaption(vehicle) });
    } catch (error) {
      console.error("Stage 1 graph failed:", error.message);
      await telegram.sendText(chatId, performanceCaption(vehicle));
    }
    await telegram.sendChatAction(chatId, "typing");
    const report = await ai.makeStage1Report(chatId, vehicle);
    const next = session.location ? btn("➡️ Continue to ECU check", "next") : btn("📍 Add my location", "next");
    return telegram.sendText(
      chatId,
      `${ai.formatStage1Report(vehicle, report)}\n\n<i>Figures are estimates for a healthy, standard vehicle. Final results are confirmed on our dyno.</i>\n\n<b>Next:</b> ${session.location ? "check your ECU" : "add your location"}.`,
      { buttons: [[next], [btn("🔎 Another vehicle", "search"), btn("🏠 Menu", "menu")]] }
    );
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
    const others = ECUS.filter((ecu) => ecu.id !== "unknown" && !common.includes(ecu) && (!vehicle?.fuel || ecu.fuels.includes(vehicle.fuel)));
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
    const ecu = ecuById(session.ecu);
    const lines = ["<b>📄 Your Stage 1 enquiry</b>", "", `<b>Vehicle:</b> ${h(vehicleName(vehicle))}${vehicle.years ? ` (${h(vehicle.years)})` : ""}`, `<b>Engine:</b> ${h(vehicle.engine)}, ${h(vehicle.fuel)}`];
    if (vehicle.tunable) {
      const gain = stage1Gain(vehicle);
      lines.push(`<b>Stock:</b> ${vehicle.stock.hp} hp / ${vehicle.stock.nm} Nm`, `<b>Stage 1:</b> ${vehicle.stage1.hp} hp / ${vehicle.stage1.nm} Nm (+${gain.hp} hp / +${gain.nm} Nm)`);
    }
    if (ecu) {
      const status = ECU_STATUS[ecu.status];
      lines.push(`<b>ECU:</b> ${ecu.id === "unknown" ? "Not sure, we'll identify it" : `${h(ecu.title)}, ${status.icon} ${h(status.label)}`}`);
    }
    lines.push(`<b>Location:</b> ${h(locationText(location))}`, "", `Tap <b>Send full details on WhatsApp</b>. The message to ${h(config.businessName)} is already written; just press send.`);
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
      .map(([status, info]) => [info, ECUS.filter((ecu) => ecu.status === status && ecu.id !== "unknown")])
      .filter(([, ecus]) => ecus.length)
      .map(([info, ecus]) => `<b>${info.icon} ${h(info.label)}</b>\n${ecus.map((ecu) => `• ${h(ecu.title)}: ${h(ecu.method)}`).join("\n")}`);
    const text = [`<b>🧾 ECUs ${h(config.businessName)} tunes</b>`, ...groups, "Not sure which ECU you have? Search your vehicle and we'll help you check."].join("\n\n");
    return telegram.sendText(chatId, text, { buttons: [[btn("🔎 Search my vehicle", "search")], menuRow()] });
  }

  async function showWorkshop(chatId) {
    const { address, latitude, longitude } = config.workshop;
    if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
      return telegram.sendVenue(chatId, { latitude, longitude, title: config.businessName, address: address || "Our workshop", buttons: [menuRow()] });
    }
    if (address) {
      return telegram.sendText(chatId, `<b>📍 ${h(config.businessName)}</b>\n${h(address)}`, {
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
      console.error("AI assistant failed:", error.message);
      answer = "Sorry, I can't answer right now. Please try again shortly or message our team on WhatsApp.";
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
    const resetting = !input.data && !input.location && (!text || RESET.test(text));
    const previous = getSession(chatId);
    if (resetting) resetSession(chatId);
    if (input.from) setSession(chatId, { customer: customerFrom(input.from) });
    // Leaving the location step another way: take the "Share my location" keyboard away.
    if (previous.awaiting === "location" && !input.location && (resetting || (input.data && input.data !== "loc"))) {
      await telegram.sendText(chatId, "OK, location step closed.", { removeKeyboard: true });
    }

    if (input.location) return saveLocation(chatId, { latitude: input.location.latitude, longitude: input.location.longitude });
    if (input.data) return handleButton(chatId, input.data);
    if (resetting) return showMenu(chatId);
    if (/^\/search\b/i.test(text)) return promptSearch(chatId);
    if (/^\/ask\b/i.test(text)) return startAsk(chatId);
    if (/^\/ecus?\b/i.test(text)) return showEcuList(chatId);
    if (previous.awaiting === "location") return saveLocation(chatId, /^skip$/i.test(text) ? { skipped: true } : { text: text.slice(0, 120) });
    if (previous.awaiting === "question") return answerQuestion(chatId, text);
    return search(chatId, text.replace(/^\/\w+\s*/, ""));
  };
}

export const handleConversation = createConversation();
