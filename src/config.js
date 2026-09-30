import { readFileSync } from "node:fs";

function loadDotEnv() {
  try {
    const text = readFileSync(".env", "utf8");
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (!match || process.env[match[1]]) continue;
      process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

loadDotEnv();

const number = (value) => (value === undefined || value === "" ? NaN : Number(value));

export const config = {
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN ?? "",
  openaiApiKey: process.env.OPENAI_API_KEY ?? "",
  openaiModel: process.env.OPENAI_MODEL || "gpt-5.6-terra",
  businessName: process.env.BUSINESS_NAME || "Unity Performance",
  // International format, digits only, e.g. 94771234567. Customers' WhatsApp enquiries go here.
  whatsappNumber: (process.env.WHATSAPP_NUMBER ?? "").replace(/\D/g, ""),
  workshop: {
    address: process.env.WORKSHOP_ADDRESS ?? "",
    latitude: number(process.env.WORKSHOP_LATITUDE),
    longitude: number(process.env.WORKSHOP_LONGITUDE)
  }
};

export function missingRuntimeSettings() {
  return [["TELEGRAM_BOT_TOKEN", config.telegramBotToken]].filter(([, value]) => !value).map(([name]) => name);
}

export function optionalSettingWarnings() {
  const warnings = [];
  if (!config.openaiApiKey) warnings.push("OPENAI_API_KEY is not set: AI search, AI reports and Ask AI are disabled; built-in reports are used.");
  if (!config.whatsappNumber) warnings.push("WHATSAPP_NUMBER is not set: the WhatsApp button lets customers pick a contact instead of messaging you directly.");
  return warnings;
}
