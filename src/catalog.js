// Brands shown in "Browse by brand". aliases help the vehicle search match what customers type.
export const BRANDS = {
  audi: { title: "Audi", aliases: [] },
  bmw: { title: "BMW", aliases: [] },
  ford: { title: "Ford", aliases: [] },
  honda: { title: "Honda", aliases: [] },
  isuzu: { title: "Isuzu", aliases: [] },
  mercedes: { title: "Mercedes-Benz", aliases: ["mercedes", "merc", "benz", "mb", "amg"] },
  mitsubishi: { title: "Mitsubishi", aliases: [] },
  nissan: { title: "Nissan", aliases: [] },
  toyota: { title: "Toyota", aliases: [] },
  volkswagen: { title: "Volkswagen", aliases: ["vw"] }
};

// Unity Performance's ECU support list, used by the "ECU check" step.
// status: "supported" | "on_request" | "not_supported". Edit this to match your tools and licences.
export const ECUS = [
  { id: "bosch_med17", title: "Bosch MED17 / MEVD17", fuels: ["petrol"], status: "supported", method: "OBD flash — no ECU removal" },
  { id: "bosch_mg1", title: "Bosch MG1", fuels: ["petrol"], status: "supported", method: "One-time bench unlock, then OBD flash" },
  { id: "simos18", title: "Continental Simos 18", fuels: ["petrol"], status: "supported", method: "OBD flash — no ECU removal" },
  { id: "bosch_edc17", title: "Bosch EDC17", fuels: ["diesel"], status: "supported", method: "OBD flash — no ECU removal" },
  { id: "bosch_md1", title: "Bosch MD1", fuels: ["diesel"], status: "supported", method: "One-time bench unlock, then OBD flash" },
  { id: "continental_sid", title: "Continental / Siemens SID", fuels: ["diesel"], status: "supported", method: "OBD or bench, depending on version" },
  { id: "denso", title: "Denso", fuels: ["petrol", "diesel"], status: "supported", method: "OBD or bench, depending on model" },
  { id: "delphi", title: "Delphi DCM", fuels: ["diesel"], status: "on_request", method: "Bench read — confirmed per vehicle" },
  { id: "transtron", title: "Transtron (Isuzu)", fuels: ["diesel"], status: "on_request", method: "Bench read — confirmed per vehicle" },
  { id: "continental_sim2k", title: "Continental SIM2K", fuels: ["petrol"], status: "on_request", method: "Bench read — confirmed per vehicle" },
  { id: "keihin", title: "Keihin (Honda)", fuels: ["petrol"], status: "on_request", method: "Confirmed per vehicle" },
  { id: "marelli", title: "Magneti Marelli", fuels: ["petrol", "diesel"], status: "on_request", method: "Confirmed per vehicle" },
  { id: "unknown", title: "Not sure", fuels: ["petrol", "diesel"], status: "unknown", method: "" }
];

export const ECU_STATUS = {
  supported: { icon: "✅", label: "Supported", detail: "Supported — we tune this ECU." },
  on_request: { icon: "⚠️", label: "On request", detail: "Available on request — we confirm your exact software version first." },
  not_supported: { icon: "❌", label: "Not supported", detail: "Not currently supported — contact us for alternatives." },
  unknown: { icon: "❓", label: "To be identified", detail: "We'll identify it from your vehicle." }
};

export function ecuById(id) {
  return ECUS.find((ecu) => ecu.id === id);
}
