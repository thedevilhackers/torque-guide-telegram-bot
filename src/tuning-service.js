import { ecus } from "./catalog.js";
import { settings } from "./db.js";
import { aiEnabled, requestJson, requestText } from "./openai.js";
import { labelFromAi } from "./ecu-label.js";
import { escapeHtml } from "./telegram.js";
import { gainPolicy, stage1Gain, vehicleName } from "./vehicles.js";

export { aiEnabled };

// The workshop has no dynamometer; tunes are checked with scans and data-logged road tests.
const WORKSHOP_FACTS =
  "The workshop uses Autotuner and KESS3 to read and write ECUs, and VCDS plus factory tools for diagnostics. It has no dynamometer: never mention dyno runs or dyno testing; tunes are checked with a diagnostic scan and a data-logged road test.";

const SAFETY_RULES =
  "Never advise deleting, bypassing or disabling emissions equipment (DPF, EGR, catalytic converter, AdBlue/SCR), diagnostics, immobilisers, brakes, airbags or other safety systems; if asked, politely decline and say the workshop keeps them fully operational.";

const clip = (value, length) => String(value ?? "").trim().slice(0, length);

// Like clip, but cuts at a word boundary so names aren't chopped mid-word.
function clipWords(value, length) {
  const text = String(value ?? "").trim().replace(/\s+/g, " ");
  if (text.length <= length) return text;
  const cut = text.slice(0, length + 1);
  const space = cut.lastIndexOf(" ");
  return (space > 0 ? cut.slice(0, space) : cut.slice(0, length)).trim();
}

function vehicleFacts(vehicle) {
  return {
    vehicle: vehicleName(vehicle),
    engine: vehicle.engine,
    years: vehicle.years,
    fuel: vehicle.fuel,
    aspiration: vehicle.aspiration,
    ...(vehicle.tunable && { stock_hp: vehicle.stock.hp, stock_nm: vehicle.stock.nm, stage1_hp: vehicle.stage1.hp, stage1_nm: vehicle.stage1.nm }),
    figures: vehicle.source === "ai" ? "AI estimate" : "workshop database"
  };
}

const reportSchema = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "prepare", "checks"],
  properties: {
    summary: { type: "string" },
    prepare: { type: "array", items: { type: "string" }, maxItems: 4 },
    checks: { type: "array", items: { type: "string" }, maxItems: 4 }
  }
};

export function fallbackStage1Report(vehicle) {
  const gain = stage1Gain(vehicle);
  const diesel = vehicle.fuel === "diesel";
  const naturallyAspirated = vehicle.aspiration === "naturally_aspirated";
  const summary = naturallyAspirated
    ? `Stage 1 on the naturally aspirated ${vehicle.engine} is a refinement tune: sharper throttle response, smoother delivery and a modest gain of about ${gain.hp} hp, calibrated for your fuel.`
    : diesel
      ? `Stage 1 is a software-only calibration for the ${vehicle.engine}. Expect noticeably stronger mid-range pull for overtaking and towing (about +${gain.nm} Nm), with emissions systems kept fully operational.`
      : `Stage 1 is a software-only calibration for the ${vehicle.engine} on standard hardware, targeting about ${vehicle.stage1.hp} hp and ${vehicle.stage1.nm} Nm with a stronger mid-range and sharper response.`;
  const prepare = diesel
    ? ["Recent service: oil, fuel and air filters", "Healthy injectors and no boost or intake leaks", "Clutch in good condition (manual gearbox)"]
    : ["Recent service: oil, air filter and spark plugs", "Good-quality fuel (RON 95 or higher)", ...(naturallyAspirated ? [] : ["Healthy ignition coils and no boost leaks"])];
  return {
    summary,
    prepare,
    checks: ["Diagnostic scan with no stored fault codes", "Data-logged road test before and after the tune", "Cooling system, tyres and brakes in good condition", "Emissions and safety systems stay fully operational"]
  };
}

// The same car gets the same notes, so a report is reused for a week instead of asking the AI on
// every view.
const REPORT_TTL_MS = 7 * 86_400_000;
const REPORT_CACHE_SIZE = 300;
const reportCache = new Map();

export async function makeStage1Report(userId, vehicle) {
  const fallback = fallbackStage1Report(vehicle);
  if (!aiEnabled()) return fallback;
  const key = JSON.stringify([settings().businessName, vehicleFacts(vehicle)]);
  const cached = reportCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.report;
  try {
    const report = await requestJson(userId, {
      name: "stage1_report",
      schema: reportSchema,
      system: `You write short Stage 1 tuning notes for customers of ${settings().businessName}, a vehicle performance tuning workshop. Return only the requested JSON. Use the vehicle data exactly as given and never state different power or torque figures. summary: 2-3 plain sentences on what Stage 1 changes for this specific engine and how it will feel to drive. prepare: short items the owner should have in order before the tune (servicing, fuel, widely documented weak points of this engine). checks: short items the workshop verifies on the day. Keep each item under 90 characters, manufacturer-neutral, and never quote prices. ${WORKSHOP_FACTS} ${SAFETY_RULES}`,
      user: `Vehicle: ${JSON.stringify(vehicleFacts(vehicle))}`
    });
    const items = (list, fallbackList) => (Array.isArray(list) && list.length ? list.slice(0, 4).map((item) => clip(item, 140)) : fallbackList);
    const result = { summary: clip(report.summary, 700) || fallback.summary, prepare: items(report.prepare, fallback.prepare), checks: items(report.checks, fallback.checks) };
    reportCache.delete(key);
    reportCache.set(key, { report: result, expires: Date.now() + REPORT_TTL_MS });
    if (reportCache.size > REPORT_CACHE_SIZE) reportCache.delete(reportCache.keys().next().value);
    return result;
  } catch (error) {
    console.error("Stage 1 report AI error:", error.message);
    return fallback;
  }
}

export function formatStage1Report(vehicle, report) {
  const bullets = (items) => items.map((item) => `• ${escapeHtml(item)}`).join("\n");
  return [
    `<b>What Stage 1 means for your ${escapeHtml(vehicleName(vehicle))}</b>`,
    escapeHtml(report.summary),
    "",
    "<b>Before tuning</b>",
    bullets(report.prepare),
    "",
    "<b>We check on the day</b>",
    bullets(report.checks)
  ].join("\n");
}

const ecuIds = () => ecus().map((ecu) => ecu.id);

// Built per request because the ECU list can change in the admin panel.
const identifySchema = () => ({
  type: "object",
  additionalProperties: false,
  required: ["recognized", "brand", "model", "generation", "years", "engine", "fuel", "aspiration", "stock_hp", "stock_nm", "stage1_hp", "stage1_nm", "likely_ecus", "confidence", "notes"],
  properties: {
    recognized: { type: "boolean" },
    brand: { type: "string" },
    model: { type: "string" },
    generation: { type: "string" },
    years: { type: "string" },
    engine: { type: "string" },
    fuel: { type: "string", enum: ["petrol", "diesel", "hybrid", "electric", "unknown"] },
    aspiration: { type: "string", enum: ["turbo", "supercharged", "naturally_aspirated", "electric", "unknown"] },
    stock_hp: { type: "integer" },
    stock_nm: { type: "integer" },
    stage1_hp: { type: "integer" },
    stage1_nm: { type: "integer" },
    likely_ecus: { type: "array", items: { type: "string", enum: ecuIds() }, maxItems: 3 },
    confidence: { type: "string", enum: ["low", "medium", "high"] },
    notes: { type: "string" }
  }
});

function clampGain(value, stock, [min, max], typical) {
  const ratio = value > 0 ? value / stock - 1 : typical;
  return Math.round(stock * (1 + Math.min(max, Math.max(min, ratio))));
}

// Turns the AI's answer into a vehicle, keeping Stage 1 gains inside the workshop's limits.
export function vehicleFromAi(result) {
  if (!result?.recognized || !result.brand || !result.model) return null;
  const vehicle = {
    id: "ai",
    source: "ai",
    brand: clipWords(result.brand, 30),
    model: clipWords(result.model, 40),
    generation: clipWords(result.generation, 30),
    years: clip(result.years, 20),
    engine: clipWords(result.engine, 50),
    fuel: result.fuel,
    ecus: (result.likely_ecus ?? []).filter((id) => ecuIds().includes(id)),
    confidence: result.confidence,
    notes: clip(result.notes, 200)
  };
  if (!["petrol", "diesel"].includes(result.fuel)) return { ...vehicle, aspiration: result.aspiration, tunable: false };
  const { stock_hp: hp, stock_nm: nm } = result;
  // Outside these ratios no realistic rev range produces both peaks, so the graph would be wrong.
  if (!(hp >= 40 && hp <= 1500 && nm >= 50 && nm <= 2500 && nm / hp >= 0.8 && nm / hp <= 3.5)) return null;
  const aspiration = result.fuel === "diesel" ? "turbo" : ["turbo", "supercharged"].includes(result.aspiration) ? result.aspiration : "naturally_aspirated";
  const policy = gainPolicy(result.fuel, aspiration);
  return {
    ...vehicle,
    aspiration,
    stock: { hp, nm },
    stage1: { hp: clampGain(result.stage1_hp, hp, policy.hp, policy.typical[0]), nm: clampGain(result.stage1_nm, nm, policy.nm, policy.typical[1]) },
    tunable: true
  };
}

export async function identifyVehicle(userId, query) {
  const result = await requestJson(userId, {
    name: "vehicle_identification",
    schema: identifySchema(),
    system: `You identify vehicles for a Stage 1 tuning enquiry at ${settings().businessName}. The customer typed a free-text description of their vehicle. Choose the single most likely real variant; if the text is ambiguous, choose the most common variant and say so in notes. stock_hp (metric hp/PS) and stock_nm must be the manufacturer-published figures for that variant. stage1_hp and stage1_nm are a conservative, typical software-only Stage 1 result on healthy standard hardware. If the text is not a real vehicle, set recognized to false and all numbers to 0. For hybrid or electric vehicles, give stock figures and set stage1 numbers to 0. likely_ecus: only ECU families you are confident are commonly fitted to this variant, otherwise an empty list. notes: one short sentence on what the owner should verify. ${SAFETY_RULES}`,
    user: `Customer's vehicle description: ${clip(query, 120)}`
  });
  return vehicleFromAi(result);
}

export async function askAssistant(userId, question, vehicle) {
  const context = vehicle ? ` The customer is currently looking at this vehicle: ${JSON.stringify(vehicleFacts(vehicle))}.` : "";
  const answer = await requestText(userId, {
    system: `You are the AI tuning assistant for ${settings().businessName}, a vehicle performance tuning workshop. Answer the customer's question in plain language, in their language, in at most 120 words. Be accurate and cautious: say when the answer depends on the exact vehicle, fuel quality or condition. Don't quote prices or booking times; suggest sending the details to the team on WhatsApp for a quote. ${WORKSHOP_FACTS} ${SAFETY_RULES}${context}`,
    user: clip(question, 800)
  });
  return clip(answer, 3000);
}

// Built per request because the ECU list can change in the admin panel.
const ecuLabelSchema = () => ({
  type: "object",
  additionalProperties: false,
  required: ["readable", "ecu_maker", "ecu_type", "hardware_number", "software_number", "oem_part_number", "family", "vehicle_brand", "vehicle_model", "engine", "years", "fuel", "confidence", "question", "notes"],
  properties: {
    readable: { type: "boolean" },
    ecu_maker: { type: "string" },
    ecu_type: { type: "string" },
    hardware_number: { type: "string" },
    software_number: { type: "string" },
    oem_part_number: { type: "string" },
    family: { type: "string", enum: [...ecuIds(), "unknown"] },
    vehicle_brand: { type: "string" },
    vehicle_model: { type: "string" },
    engine: { type: "string" },
    years: { type: "string" },
    fuel: { type: "string", enum: ["petrol", "diesel", "unknown"] },
    confidence: { type: "string", enum: ["low", "medium", "high"] },
    question: { type: "string" },
    notes: { type: "string" }
  }
});

// Reads a photo of an ECU label: the ECU and its numbers, and the car it most likely comes from.
// note is anything the customer has said about the car.
export async function readEcuLabel(userId, imageDataUrl, note = "") {
  const families = ecus().map((ecu) => `${ecu.id} = ${ecu.title}`).join("; ");
  const result = await requestJson(userId, {
    name: "ecu_label",
    schema: ecuLabelSchema(),
    images: [imageDataUrl],
    system: `You read photos of engine control unit (ECU) labels for ${settings().businessName}, a vehicle tuning workshop. Copy numbers exactly as printed and never invent or complete a number you can't read; leave a field empty instead. ecu_maker: the ECU manufacturer (e.g. Bosch, Continental, Siemens, Delphi, Denso, Marelli, Kefico, Transtron). ecu_type: the ECU model if printed or clear from the numbers, e.g. EDC17C57, MD1CS004, MED17.9.7, SIMOS18.1. hardware_number: the ECU maker's number (Bosch: 0 281 ... or 0 261 ...). software_number: e.g. Bosch 1037... . oem_part_number: the car maker's part number (e.g. 39101-2A930, 03L 906 018). family: the workshop's ECU family that matches, from this list, or "unknown": ${families}. vehicle_brand, vehicle_model, engine, years, fuel: the car this ECU most likely comes from, using the part numbers and anything the customer said; leave them empty unless you are reasonably sure. confidence: how sure you are of the car. question: if the car isn't clear, one short question asking the customer for the car's make, model, engine and year; if the label is unreadable, ask for a sharper, closer photo in good light; otherwise empty. readable: false if this isn't an ECU label or nothing useful can be read. notes: one short sentence for the workshop. ${SAFETY_RULES}`,
    user: note ? `The customer says: ${clip(note, 200)}` : "No other details from the customer."
  });
  return labelFromAi(result, ecuIds());
}
