import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { DATA_DIR } from "./db.js";

// Telegram conversation state, kept apart from the main database because it changes on every message.
// Losing it only means a customer starts the conversation again, so a damaged file is set aside
// rather than stopping the server.
const STORE_FILE = `${DATA_DIR}/sessions.json`;
const SESSION_MAX_AGE_MS = 30 * 86_400_000;

function readStore() {
  try {
    const stored = JSON.parse(readFileSync(STORE_FILE, "utf8"));
    if (stored && typeof stored.sessions === "object" && stored.sessions) return { sessions: stored.sessions };
    throw new Error("unexpected contents");
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.error(`Telegram sessions file was unreadable (${error.message}); starting with fresh sessions.`);
      try {
        renameSync(STORE_FILE, `${STORE_FILE}.damaged`);
      } catch {
        // Nothing to keep.
      }
    }
    return { sessions: {} };
  }
}

let store = readStore();

// Written to a temporary file first, then swapped in, so a crash mid-write can't leave a half-written file.
function save() {
  const cutoff = Date.now() - SESSION_MAX_AGE_MS;
  for (const [chatId, session] of Object.entries(store.sessions)) {
    if (Date.parse(session.updatedAt ?? session.startedAt ?? 0) < cutoff) delete store.sessions[chatId];
  }
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(`${STORE_FILE}.tmp`, JSON.stringify(store));
  renameSync(`${STORE_FILE}.tmp`, STORE_FILE);
}

export function getSession(chatId) {
  return store.sessions[chatId] ?? {};
}

export function setSession(chatId, next) {
  store.sessions[chatId] = { ...getSession(chatId), ...next, updatedAt: new Date().toISOString() };
  save();
  return store.sessions[chatId];
}

export function resetSession(chatId) {
  store.sessions[chatId] = { startedAt: new Date().toISOString() };
  save();
  return store.sessions[chatId];
}
