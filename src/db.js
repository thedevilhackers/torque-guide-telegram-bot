import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { envSettings } from "./config.js";
import { DEFAULT_SETTINGS, seedData } from "./seed-data.js";

// A small JSON document store shared by the website, the admin panel and the Telegram bot.
// Everything lives in DATA_DIR/db.json; writes go to a temporary file first, then replace it.

export const DATA_DIR = process.env.DATA_DIR || "data";
const DB_FILE = join(DATA_DIR, "db.json");

// Adds collections and settings introduced after the database was first created.
function migrate(stored) {
  return { ...seedData(), ...stored, settings: { ...DEFAULT_SETTINGS, ...stored.settings } };
}

function load() {
  try {
    return migrate(JSON.parse(readFileSync(DB_FILE, "utf8")));
  } catch (error) {
    if (error.code === "ENOENT") return seedData(envSettings());
    throw error;
  }
}

let data = load();

function persist() {
  mkdirSync(DATA_DIR, { recursive: true });
  const temp = `${DB_FILE}.tmp`;
  writeFileSync(temp, JSON.stringify(data, null, 2));
  renameSync(temp, DB_FILE);
}

// Read-only view of the current data. Change it only through transact().
export function db() {
  return data;
}

// Applies a change to a copy of the data, then swaps it in and saves. If the change throws,
// nothing is modified.
export function transact(change) {
  const draft = structuredClone(data);
  const result = change(draft);
  data = draft;
  persist();
  return result;
}

export function replaceData(next) {
  data = migrate(next);
  persist();
}

const isEmpty = (value) => value === "" || value === null || value === undefined;

// Settings saved in the admin panel win; empty ones fall back to environment variables.
export function settings() {
  const env = envSettings();
  const stored = data.settings;
  return Object.fromEntries(
    Object.keys({ ...DEFAULT_SETTINGS, ...stored }).map((key) => [key, isEmpty(stored[key]) && !isEmpty(env[key]) ? env[key] : (stored[key] ?? DEFAULT_SETTINGS[key])])
  );
}
