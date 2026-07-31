import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const DATA_DIR = "data";
const STORE_FILE = `${DATA_DIR}/sessions.json`;
const MAX_PROCESSED_IDS = 500;

function emptyStore() {
  return { sessions: {}, processedMessageIds: [] };
}

function readStore() {
  try {
    return JSON.parse(readFileSync(STORE_FILE, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return emptyStore();
    throw error;
  }
}

let store = readStore();

function save() {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(STORE_FILE, JSON.stringify(store, null, 2));
}

export function getSession(phone) {
  return store.sessions[phone] ?? {};
}

export function setSession(phone, next) {
  store.sessions[phone] = { ...getSession(phone), ...next, updatedAt: new Date().toISOString() };
  save();
  return store.sessions[phone];
}

export function resetSession(phone) {
  store.sessions[phone] = { startedAt: new Date().toISOString() };
  save();
  return store.sessions[phone];
}

export function seenMessage(id) {
  return store.processedMessageIds.includes(id);
}

export function rememberMessage(id) {
  store.processedMessageIds = [...store.processedMessageIds, id].slice(-MAX_PROCESSED_IDS);
  save();
}
