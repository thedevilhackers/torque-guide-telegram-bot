import { db } from "./db.js";

export const ECU_STATUS = {
  supported: { icon: "✅", label: "Supported", detail: "Supported — we tune this ECU." },
  on_request: { icon: "⚠️", label: "On request", detail: "Available on request — we confirm your exact software version first." },
  not_supported: { icon: "❌", label: "Not supported", detail: "Not currently supported — contact us for alternatives." },
  unknown: { icon: "❓", label: "To be identified", detail: "We'll identify it from your vehicle." }
};

// The tools the workshop reads ECUs with, and how: through the diagnostic port, on the bench, or in boot mode.
export const TOOLS = { autotuner: "Autotuner", kess3: "KESS3" };
export const READ_METHODS = { obd: "OBD", bench: "Bench", boot: "Boot" };

// One line per tool, e.g. "Autotuner: OBD · Bench".
export function toolSupportLines(ecu) {
  return Object.entries(TOOLS).map(([id, name]) => {
    const methods = ecu.tools?.[id] ?? [];
    return `${name}: ${methods.length ? methods.map((method) => READ_METHODS[method]).join(" · ") : "not listed"}`;
  });
}

// The "Not sure" choice is built in rather than stored, so it can't be deleted in the admin panel.
export const UNKNOWN_ECU = { id: "unknown", title: "Not sure", fuels: ["petrol", "diesel"], status: "unknown", method: "" };

export const brands = () => db().brands;
export const brandById = (id) => brands().find((brand) => brand.id === id);
export const ecus = () => db().ecus;

export function ecuById(id) {
  return id === UNKNOWN_ECU.id ? UNKNOWN_ECU : ecus().find((ecu) => ecu.id === id);
}
