import { BRANDS, ECU_OPTIONS, FUELS, STAGES, slug } from "./catalog.js";
import { getSession, resetSession, setSession } from "./store.js";
import { formatRecommendation, makeRecommendation } from "./tuning-service.js";
import { sendList, sendText } from "./telegram.js";

const row = (id, title, description) => ({ id, title: title.slice(0, 24), description: description?.slice(0, 72) });

async function askBrand(chatId) {
  return sendList(chatId, {
    body: "Welcome to Torque Guide. I’ll collect your vehicle details, then send a cautious estimate and parts/work list. Choose the brand.",
    button: "Choose brand",
    rows: Object.entries(BRANDS).map(([id, brand]) => row(`brand:${id}`, brand.title, "Choose vehicle brand"))
  });
}

async function askModel(chatId, brand) {
  return sendList(chatId, {
    body: `Brand: ${BRANDS[brand].title}. Choose the model.`,
    button: "Choose model",
    rows: BRANDS[brand].models.map((model) => row(`model:${slug(model)}`, model, "Choose vehicle model"))
  });
}

async function askFuel(chatId) {
  return sendList(chatId, { body: "Choose the fuel / propulsion type.", button: "Choose fuel", rows: FUELS.map(([id, title, description]) => row(`fuel:${id}`, title, description)) });
}

async function askYear(chatId, finalYear = 2026) {
  const years = Array.from({ length: 9 }, (_, index) => finalYear - index);
  return sendList(chatId, {
    body: "Choose the model year. Use Older models to see earlier years.",
    button: "Choose year",
    rows: [...years.map((year) => row(`year:${year}`, String(year), "Model year")), row(`year_page:${finalYear - 9}`, `${finalYear - 9} or older`, "Show older model years")]
  });
}

async function askEcu(chatId) {
  return sendList(chatId, { body: "Choose the ECU family from its physical label or diagnostic tool. If unsure, select Other / not sure.", button: "Choose ECU", rows: ECU_OPTIONS.map(([id, title, description]) => row(`ecu:${id}`, title, description)) });
}

async function askStage(chatId) {
  return sendList(chatId, { body: "What level of tuning are you considering?", button: "Choose stage", rows: STAGES.map(([id, title, description]) => row(`stage:${id}`, title, description)) });
}

export async function handleConversation(chatId, incoming) {
  const command = incoming.trim();
  if (!command || /^(hi|hello|\/start|start|menu|restart)$/i.test(command)) {
    resetSession(chatId);
    return askBrand(chatId);
  }
  const [action, value] = command.split(":", 2);
  const session = getSession(chatId);
  if (action === "brand" && BRANDS[value]) {
    setSession(chatId, { brand: value });
    return askModel(chatId, value);
  }
  if (action === "model" && session.brand) {
    setSession(chatId, { model: value });
    return askFuel(chatId);
  }
  if (action === "fuel" && FUELS.some(([id]) => id === value)) {
    setSession(chatId, { fuel: value });
    return askYear(chatId);
  }
  if (action === "year_page" && /^\d{4}$/.test(value)) return askYear(chatId, Number(value));
  if (action === "year" && /^\d{4}$/.test(value)) {
    setSession(chatId, { year: value });
    return askEcu(chatId);
  }
  if (action === "ecu" && ECU_OPTIONS.some(([id]) => id === value)) {
    setSession(chatId, { ecu: value });
    return askStage(chatId);
  }
  if (action === "stage" && STAGES.some(([id]) => id === value)) {
    const selection = setSession(chatId, { stage: value });
    await sendText(chatId, "Thanks — I’m preparing your cautious tuning estimate. Please note: it is not a tune file or a substitute for a professional inspection.");
    try {
      const result = await makeRecommendation(chatId, selection);
      return sendText(chatId, formatRecommendation(result));
    } catch (error) {
      console.error("Recommendation error", error.message);
      return sendText(chatId, "I could not produce the estimate right now. Please send /start and try again shortly.");
    }
  }
  return sendText(chatId, "Send /start to begin, then choose each option from the menus.");
}
