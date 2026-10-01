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

const number = (value) => (value === undefined || value === "" ? undefined : Number(value));

export const config = {
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN ?? "",
  openaiApiKey: process.env.OPENAI_API_KEY ?? "",
  openaiModel: process.env.OPENAI_MODEL || "gpt-5.6-terra",
  port: Number(process.env.PORT) || 3000,
  // Behind a reverse proxy on the same server (a VPS with Caddy), set HOST=127.0.0.1 so visitors can
  // only reach the app through the proxy and can't fake the address the rate limits rely on.
  host: process.env.HOST || undefined,
  adminUsername: process.env.ADMIN_USERNAME || "admin",
  adminPassword: process.env.ADMIN_PASSWORD ?? "",
  // Most AI requests a day across all customers, so a flood of messages can't run up the OpenAI bill.
  aiDailyLimit: Number(process.env.AI_DAILY_LIMIT) || 400
};

export const MIN_ADMIN_PASSWORD_LENGTH = 10;

// Business details from the environment. They seed the database and fill any setting left
// empty in the admin panel.
export function envSettings() {
  const values = {
    businessName: process.env.BUSINESS_NAME,
    whatsappNumber: process.env.WHATSAPP_NUMBER?.replace(/\D/g, ""),
    address: process.env.WORKSHOP_ADDRESS,
    latitude: number(process.env.WORKSHOP_LATITUDE),
    longitude: number(process.env.WORKSHOP_LONGITUDE)
  };
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined && value !== "" && !Number.isNaN(value)));
}

export function optionalSettingWarnings() {
  const warnings = [];
  if (!config.telegramBotToken) warnings.push("TELEGRAM_BOT_TOKEN is not set: the website runs, but the Telegram bot is off.");
  if (!config.openaiApiKey) warnings.push("OPENAI_API_KEY is not set: AI search, AI reports and Ask AI are disabled; built-in reports are used.");
  if (config.adminPassword.length < MIN_ADMIN_PASSWORD_LENGTH) {
    warnings.push(`ADMIN_PASSWORD is not set or shorter than ${MIN_ADMIN_PASSWORD_LENGTH} characters: the admin panel is locked.`);
  }
  return warnings;
}
