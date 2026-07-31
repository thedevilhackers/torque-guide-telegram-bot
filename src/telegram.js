import { config } from "./config.js";

const apiUrl = (method) => `https://api.telegram.org/bot${config.telegramBotToken}/${method}`;

export async function callTelegram(method, payload = {}) {
  if (!config.telegramBotToken) throw new Error("TELEGRAM_BOT_TOKEN is missing. Fill in .env before starting the bot.");
  const response = await fetch(apiUrl(method), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(`Telegram ${method} failed: ${data.description ?? response.status}`);
  return data.result;
}

export const sendText = (chatId, text) => callTelegram("sendMessage", { chat_id: chatId, text });

export function sendList(chatId, { body, rows, header = "Torque Guide" }) {
  return callTelegram("sendMessage", {
    chat_id: chatId,
    text: `${header}\n\n${body}`,
    reply_markup: {
      inline_keyboard: rows.map(({ id, title }) => [{ text: title, callback_data: id }])
    }
  });
}
