import { ECU_STATUS, READ_METHODS, ecuById, toolSupportLines } from "./catalog.js";
import { searchAutotuner } from "./tool-lists.js";
import { searchVehicles } from "./vehicles.js";

// What the AI read from a photo of an ECU label, and what the workshop's lists say about it.

const clip = (value, length) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, length);

// Cleans the AI's answer: short strings only, the family must be one of the workshop's ECUs.
export function labelFromAi(result, ecuIds) {
  if (!result?.readable) return { readable: false, question: clip(result?.question, 200) };
  const label = {
    readable: true,
    maker: clip(result.ecu_maker, 30),
    type: clip(result.ecu_type, 40),
    hardware: clip(result.hardware_number, 40),
    software: clip(result.software_number, 40),
    partNumber: clip(result.oem_part_number, 40),
    family: ecuIds.includes(result.family) ? result.family : "",
    vehicle: {
      brand: clip(result.vehicle_brand, 30),
      model: clip(result.vehicle_model, 40),
      engine: clip(result.engine, 40),
      years: clip(result.years, 20),
      fuel: ["petrol", "diesel"].includes(result.fuel) ? result.fuel : ""
    },
    confidence: ["low", "medium", "high"].includes(result.confidence) ? result.confidence : "low",
    question: clip(result.question, 200),
    notes: clip(result.notes, 200)
  };
  // A low-confidence car guess isn't shown as an answer; the customer is asked instead.
  if (label.confidence === "low" || !label.vehicle.brand) label.vehicle = { brand: "", model: "", engine: "", years: "", fuel: label.vehicle.fuel };
  return label;
}

export const vehicleQuery = (label) => [label.vehicle?.brand, label.vehicle?.model, label.vehicle?.engine].filter(Boolean).join(" ");

// The label's ECU in the workshop's ECU list and Autotuner's list, and the cars it fits.
export function labelMatches(label) {
  const family = label.family ? ecuById(label.family) : null;
  const autotuner = label.type ? searchAutotuner(`${label.maker} ${label.type}`.trim(), { limit: 5 }) : { total: 0, results: [] };
  const query = vehicleQuery(label);
  const vehicles = query ? searchVehicles(query, 3) : [];
  return { family, autotuner, vehicles };
}

// One line per detail, for the bot, WhatsApp and the enquiry record.
export function labelLines(label) {
  return [
    label.maker || label.type ? `ECU: ${[label.maker, label.type].filter(Boolean).join(" ")}` : "",
    label.hardware ? `Hardware no.: ${label.hardware}` : "",
    label.software ? `Software no.: ${label.software}` : "",
    label.partNumber ? `Part no.: ${label.partNumber}` : ""
  ].filter(Boolean);
}

export function autotunerLine({ total, results }) {
  if (!total) return "";
  const methods = [...new Set(results.flatMap((entry) => entry.methods))];
  return methods.length ? `Autotuner: ${methods.map((method) => READ_METHODS[method]).join(" · ")}` : "Autotuner: listed, method to be confirmed";
}

export function familyLines(family) {
  if (!family) return [];
  const status = ECU_STATUS[family.status];
  return [`${status.icon} ${family.title}: ${status.label}`, ...toolSupportLines(family).filter((line) => line.startsWith("KESS3"))];
}

// A data URL for a JPEG, PNG or WebP photo, judged by its bytes rather than its name; null otherwise.
export function imageDataUrl(bytes) {
  const type =
    bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff ? "image/jpeg"
      : bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ? "image/png"
        : bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP" ? "image/webp"
          : null;
  return type ? `data:${type};base64,${bytes.toString("base64")}` : null;
}
