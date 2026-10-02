import { ECU_STATUS, ecuById } from "./catalog.js";
import { settings } from "./db.js";
import { labelLines } from "./ecu-label.js";
import { stageFigures, stageGain, vehicleName } from "./vehicles.js";

// Customers send enquiries themselves: a wa.me link opens WhatsApp with the message already
// typed to the business number, so no WhatsApp Business API account is needed.
export function whatsappLink(text, number = settings().whatsappNumber) {
  const digits = String(number ?? "").replace(/\D/g, "");
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

export function locationText(location) {
  if (!location || location.skipped) return "Not shared";
  if (Number.isFinite(location.latitude) && Number.isFinite(location.longitude)) {
    return `https://maps.google.com/?q=${location.latitude.toFixed(5)},${location.longitude.toFixed(5)}`;
  }
  return String(location.text ?? "").slice(0, 120);
}

export function enquiryText({ vehicle, stage = 1, location, ecu, ecuLabel, customer, message } = {}, businessName = settings().businessName) {
  const chosen = vehicle?.tunable && vehicle[`stage${stage}`] ? stage : 1;
  const lines = [`Hello ${businessName}, I'd like a Stage ${chosen} tune. My details:`, ""];
  if (customer?.name) lines.push(`Name: ${customer.name.slice(0, 60)}`);
  if (customer?.username) lines.push(`Telegram: @${customer.username}`);
  if (vehicle) {
    lines.push(`Vehicle: ${vehicleName(vehicle)}${vehicle.years ? ` (${vehicle.years})` : ""}`);
    lines.push(`Engine: ${vehicle.engine}, ${vehicle.fuel}`);
    if (vehicle.tunable) {
      const gain = stageGain(vehicle, chosen);
      const target = stageFigures(vehicle, chosen);
      lines.push(`Stock: ${vehicle.stock.hp} hp / ${vehicle.stock.nm} Nm`);
      lines.push(`Stage ${chosen} estimate: ${target.hp} hp / ${target.nm} Nm (+${gain.hp} hp / +${gain.nm} Nm)`);
    }
    if (vehicle.source === "ai") lines.push("Figures: AI estimate, to be verified");
  }
  const ecuInfo = ecuById(ecu);
  if (ecuInfo) lines.push(`ECU: ${ecuInfo.id === "unknown" ? "Not sure, please help identify" : `${ecuInfo.title} (${ECU_STATUS[ecuInfo.status].label})`}`);
  if (ecuLabel?.readable) lines.push(`ECU label (from my photo): ${labelLines(ecuLabel).map((line) => line.replace(/^ECU: /, "")).join(", ")}`);
  if (location) lines.push(`Location: ${locationText(location)}`);
  if (message) lines.push(`Message: ${message}`);
  return lines.join("\n");
}
