import { db } from "./db.js";

export const ECU_STATUS = {
  supported: { icon: "✅", label: "Supported", detail: "Supported — we tune this ECU." },
  on_request: { icon: "⚠️", label: "On request", detail: "Available on request — we confirm your exact software version first." },
  not_supported: { icon: "❌", label: "Not supported", detail: "Not currently supported — contact us for alternatives." },
  unknown: { icon: "❓", label: "To be identified", detail: "We'll identify it from your vehicle." }
};

// The "Not sure" choice is built in rather than stored, so it can't be deleted in the admin panel.
export const UNKNOWN_ECU = { id: "unknown", title: "Not sure", fuels: ["petrol", "diesel"], status: "unknown", method: "" };

export const brands = () => db().brands;
export const brandById = (id) => brands().find((brand) => brand.id === id);
export const ecus = () => db().ecus;

export function ecuById(id) {
  return id === UNKNOWN_ECU.id ? UNKNOWN_ECU : ecus().find((ecu) => ecu.id === id);
}
