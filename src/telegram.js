import { config } from "./config.js";

const apiUrl = (method) => `https://api.telegram.org/bot${config.telegramBotToken}/${method}`;

export async function callTelegram(method, payload = {}) {
  if (!config.telegramBotToken) throw new Error("TELEGRAM_BOT_TOKEN is missing. Fill in .env before starting the bot.");
  const isForm = payload instanceof FormData;
  const response = await fetch(apiUrl(method), {
    method: "POST",
    headers: isForm ? undefined : { "Content-Type": "application/json" },
    body: isForm ? payload : JSON.stringify(payload),
    signal: AbortSignal.timeout(method === "getUpdates" ? 60_000 : 30_000)
  });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(`Telegram ${method} failed: ${data.description ?? response.status}`);
  return data.result;
}

// Downloads a file a customer sent, such as a photo, refusing anything over maxBytes.
export async function downloadFile(fileId, maxBytes = 8_000_000) {
  const file = await callTelegram("getFile", { file_id: fileId });
  if (!file.file_path) throw new Error("Telegram didn't return the file.");
  if (file.file_size > maxBytes) throw new Error("The file is too large.");
  const response = await fetch(`https://api.telegram.org/file/bot${config.telegramBotToken}/${file.file_path}`, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Telegram file download failed: ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > maxBytes) throw new Error("The file is too large.");
  return bytes;
}

export function escapeHtml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// buttons: rows of { text, data } (callback) or { text, url } (link) shown under the message.
// keyboard: rows of reply-keyboard buttons, e.g. { text, request_location: true }.
function replyMarkup({ buttons, keyboard, placeholder, removeKeyboard } = {}) {
  if (buttons) return { inline_keyboard: buttons.map((row) => row.map(({ text, data, url }) => (url ? { text, url } : { text, callback_data: data }))) };
  if (keyboard) return { keyboard, resize_keyboard: true, one_time_keyboard: true, input_field_placeholder: placeholder };
  if (removeKeyboard) return { remove_keyboard: true };
  return undefined;
}

export const sendText = (chatId, html, options) =>
  callTelegram("sendMessage", { chat_id: chatId, text: html, parse_mode: "HTML", link_preview_options: { is_disabled: true }, reply_markup: replyMarkup(options) });

export function sendPhoto(chatId, png, { caption, filename = "stage1-graph.png", ...options } = {}) {
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append("photo", new Blob([png], { type: "image/png" }), filename);
  if (caption) {
    form.append("caption", caption);
    form.append("parse_mode", "HTML");
  }
  const markup = replyMarkup(options);
  if (markup) form.append("reply_markup", JSON.stringify(markup));
  return callTelegram("sendPhoto", form);
}

export const sendVenue = (chatId, { latitude, longitude, title, address, ...options }) =>
  callTelegram("sendVenue", { chat_id: chatId, latitude, longitude, title, address, reply_markup: replyMarkup(options) });

// Typing/upload indicators are cosmetic, so failures are ignored.
export const sendChatAction = (chatId, action) => callTelegram("sendChatAction", { chat_id: chatId, action }).catch(() => {});
