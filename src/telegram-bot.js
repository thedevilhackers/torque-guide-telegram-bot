import { config, missingRuntimeSettings, optionalSettingWarnings } from "./config.js";
import { handleConversation } from "./conversation.js";
import { callTelegram, sendText } from "./telegram.js";

const POLL_TIMEOUT_SECONDS = 25;
const RETRY_DELAY_MS = 2_000;
const COMMANDS = [
  { command: "start", description: "Main menu" },
  { command: "search", description: "Find your vehicle and its Stage 1 graph" },
  { command: "ask", description: "Ask the AI tuning assistant" },
  { command: "ecus", description: "ECUs we support" }
];

const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

// Updates for one chat run in order; different chats run in parallel, so one customer's
// AI request doesn't hold up everyone else.
const chatQueues = new Map();

function enqueue(chatId, task) {
  const next = (chatQueues.get(chatId) ?? Promise.resolve()).then(task).catch(async (error) => {
    console.error(`Could not handle chat ${chatId}:`, error.message);
    await sendText(chatId, "Sorry, something went wrong. Send /start to try again.").catch(() => {});
  });
  chatQueues.set(chatId, next);
  next.finally(() => {
    if (chatQueues.get(chatId) === next) chatQueues.delete(chatId);
  });
}

function processUpdate(update) {
  const query = update.callback_query;
  if (query) {
    callTelegram("answerCallbackQuery", { callback_query_id: query.id }).catch((error) => console.error("answerCallbackQuery failed:", error.message));
    const chatId = query.message?.chat?.id;
    if (chatId && query.data) enqueue(String(chatId), () => handleConversation(String(chatId), { data: query.data, from: query.from }));
    return;
  }
  const message = update.message;
  const chatId = message?.chat?.id;
  if (!chatId) return;
  if (message.location) enqueue(String(chatId), () => handleConversation(String(chatId), { location: message.location, from: message.from }));
  else if (message.text) enqueue(String(chatId), () => handleConversation(String(chatId), { text: message.text, from: message.from }));
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
          processUpdate(update);
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
    for (const warning of optionalSettingWarnings()) console.warn(`Note: ${warning}`);
    await callTelegram("setMyCommands", { commands: COMMANDS }).catch((error) => console.error("setMyCommands failed:", error.message));
    console.log(`${config.businessName} Telegram bot is running as @${bot.username}. Send it /start to begin.`);
    await pollForever();
  } catch (error) {
    console.error("Telegram bot could not start:", error.message);
    process.exitCode = 1;
  }
}
