import { createHash } from "node:crypto";
import { config } from "./config.js";
import { titleFor, FUELS, ECU_OPTIONS, STAGES, BRANDS, modelFor } from "./catalog.js";

const recommendationSchema = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "power", "parts", "checks", "disclaimer"],
  properties: {
    summary: { type: "string" },
    power: {
      type: "object",
      additionalProperties: false,
      required: ["stock", "estimated_stage", "torque", "confidence"],
      properties: {
        stock: { type: "string" },
        estimated_stage: { type: "string" },
        torque: { type: "string" },
        confidence: { type: "string", enum: ["low", "medium", "high"] }
      }
    },
    parts: { type: "array", items: { type: "string" }, maxItems: 7 },
    checks: { type: "array", items: { type: "string" }, maxItems: 5 },
    disclaimer: { type: "string" }
  }
};

function vehicleDetails(selection) {
  return {
    brand: BRANDS[selection.brand]?.title ?? selection.brand,
    model: modelFor(selection.brand, selection.model),
    fuel: titleFor(FUELS, selection.fuel),
    year: selection.year,
    ecu: titleFor(ECU_OPTIONS, selection.ecu),
    requestedStage: titleFor(STAGES, selection.stage)
  };
}

export function fallbackRecommendation(selection) {
  const vehicle = vehicleDetails(selection);
  const multiplier = { stage_1: "roughly 10–20%", stage_2: "roughly 15–30%", stage_3: "vehicle-specific; no safe generic figure" }[selection.stage] ?? "not applicable";
  return {
    summary: `${vehicle.requestedStage} enquiry for a ${vehicle.year} ${vehicle.brand} ${vehicle.model} (${vehicle.fuel}). Exact engine code and a baseline dyno run are required before quoting a reliable figure.`,
    power: {
      stock: "Not verified — engine variant required",
      estimated_stage: selection.stage.startsWith("stage_") ? `${multiplier} over verified stock output, only after health checks` : "No performance increase quoted",
      torque: "Not quoted without exact engine and gearbox data",
      confidence: "low"
    },
    parts: ["Baseline diagnostic scan and service inspection", "Fresh correct-grade fluids and filters", "Custom ECU calibration from a reputable tuner", "Dyno validation and data logs"],
    checks: ["Confirm exact engine code, ECU software and gearbox", "Check brakes, tyres, cooling and clutch/gearbox capacity", "Keep emissions and safety systems fully operational"],
    disclaimer: "This is a planning estimate, not a tune file or a guarantee. Use a qualified tuner, comply with local laws and insurance requirements, and stop if diagnostics show faults."
  };
}

export async function makeRecommendation(phone, selection) {
  if (!config.openaiApiKey) return fallbackRecommendation(selection);
  const vehicle = vehicleDetails(selection);
  const system = `You are a cautious vehicle-tuning intake assistant. Return only the requested JSON. The user needs an initial, conservative tuning estimate and parts list. Do not invent exact factory power, engine code, ECU compatibility, or fitment. If those are not supplied, explicitly say they need verification and use a broad range or percentage rather than a precise claim. Never advise deleting, bypassing, or disabling emissions, diagnostics, brakes, airbags, or other safety systems. For hybrid or electric vehicles, state that a specialist must assess the high-voltage system and do not propose performance modifications. Keep parts manufacturer-neutral. This is not a tuning file.`;
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${config.openaiApiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.openaiModel,
      reasoning: { effort: "low" },
      text: { format: { type: "json_schema", name: "tuning_recommendation", strict: true, schema: recommendationSchema }, verbosity: "low" },
      safety_identifier: createHash("sha256").update(phone).digest("hex").slice(0, 32),
      input: [
        { role: "system", content: [{ type: "input_text", text: system }] },
        { role: "user", content: [{ type: "input_text", text: `Vehicle selection: ${JSON.stringify(vehicle)}. Give a cautious result for this selection.` }] }
      ]
    })
  });
  if (!response.ok) throw new Error(`OpenAI API ${response.status}: ${await response.text()}`);
  const data = await response.json();
  return JSON.parse(data.output_text);
}

export function formatRecommendation(result) {
  const parts = result.parts.map((item, index) => `${index + 1}. ${item}`).join("\n");
  const checks = result.checks.map((item) => `- ${item}`).join("\n");
  return `Your tuning plan\n\n${result.summary}\n\nPower figures\nStock: ${result.power.stock}\nRequested-stage estimate: ${result.power.estimated_stage}\nTorque: ${result.power.torque}\nConfidence: ${result.power.confidence}\n\nParts / work list\n${parts}\n\nBefore tuning\n${checks}\n\n${result.disclaimer}\n\nSend /start to check another vehicle.`;
}
