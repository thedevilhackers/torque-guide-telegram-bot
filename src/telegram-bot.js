import { config, missingRuntimeSettings } from "./config.js";
import { handleConversation } from "./conversation.js";
import { callTelegram } from "./telegram.js";

const POLL_TIMEOUT_SECONDS = 25;
const RETRY_DELAY_MS = 2_000;

const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function processUpdate(update) {
  if (update.callback_query) {
    const query = update.callback_query;
    await callTelegram("answerCallbackQuery", { callback_query_id: query.id });
    const chatId = query.message?.chat?.id;
    if (chatId && query.data) await handleConversation(String(chatId), query.data);
    return;
  }
  const message = update.message;
  if (message?.chat?.id && message.text) await handleConversation(String(message.chat.id), message.text);
}

async function pollForever() {
  let offset;
  while (true) {
    try {
      const updates = await callTelegram("getUpdates", {
        offset,
        timeout: POLL_TIMEOUT_SECONDS,
        allowed_updates: ["message", "callback_query"]
      });
      for (const update of updates) {
        offset = update.update_id + 1;
        try {
          await processUpdate(update);
        } catch (error) {
          console.error(`Could not process Telegram update ${update.update_id}:`, error.message);
        }
      }
    } catch (error) {
      console.error("Telegram polling error:", error.message);
      await pause(RETRY_DELAY_MS);
    }
  }
}

const missing = missingRuntimeSettings();
if (missing.length) {
  console.error(`Setup needed: ${missing.join(", ")}`);
  process.exitCode = 1;
} else {
  try {
    const bot = await callTelegram("getMe");
    console.log(`Torque Guide Telegram bot is running as @${bot.username}. Send it /start to begin.`);
    await pollForever();
  } catch (error) {
    console.error("Telegram bot could not start:", error.message);
    process.exitCode = 1;
  }
}
