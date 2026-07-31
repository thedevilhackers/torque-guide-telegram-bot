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

export const config = {
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN ?? "",
  openaiApiKey: process.env.OPENAI_API_KEY ?? "",
  openaiModel: process.env.OPENAI_MODEL ?? "gpt-5.6-terra"
};

export function missingRuntimeSettings() {
  return [
    ["TELEGRAM_BOT_TOKEN", config.telegramBotToken],
    ["OPENAI_API_KEY", config.openaiApiKey]
  ].filter(([, value]) => !value).map(([name]) => name);
}
