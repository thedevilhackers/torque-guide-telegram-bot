import { ECU_STATUS, ecuById } from "./catalog.js";
import { config } from "./config.js";
import { stage1Gain, vehicleName } from "./vehicles.js";

// Customers send enquiries themselves: a wa.me link opens WhatsApp with the message already
// typed to the business number, so no WhatsApp Business API account is needed.
export function whatsappLink(text, number = config.whatsappNumber) {
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

export function enquiryText({ vehicle, location, ecu, customer } = {}, businessName = config.businessName) {
  const lines = [`Hello ${businessName}, I'd like a Stage 1 tune. My details:`, ""];
  if (customer?.name) lines.push(`Name: ${customer.name.slice(0, 60)}`);
  if (customer?.username) lines.push(`Telegram: @${customer.username}`);
  if (vehicle) {
    lines.push(`Vehicle: ${vehicleName(vehicle)}${vehicle.years ? ` (${vehicle.years})` : ""}`);
    lines.push(`Engine: ${vehicle.engine}, ${vehicle.fuel}`);
    if (vehicle.tunable) {
      const gain = stage1Gain(vehicle);
      lines.push(`Stock: ${vehicle.stock.hp} hp / ${vehicle.stock.nm} Nm`);
      lines.push(`Stage 1 estimate: ${vehicle.stage1.hp} hp / ${vehicle.stage1.nm} Nm (+${gain.hp} hp / +${gain.nm} Nm)`);
    }
    if (vehicle.source === "ai") lines.push("Figures: AI estimate, to be verified");
  }
  const ecuInfo = ecuById(ecu);
  if (ecuInfo) lines.push(`ECU: ${ecuInfo.id === "unknown" ? "Not sure, please help identify" : `${ecuInfo.title} (${ECU_STATUS[ecuInfo.status].label})`}`);
  if (location) lines.push(`Location: ${locationText(location)}`);
  return lines.join("\n");
}
