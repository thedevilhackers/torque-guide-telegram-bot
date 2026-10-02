import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { envSettings } from "./config.js";
import { CATALOG_UPDATES, CATALOG_VERSION, DEFAULT_SETTINGS, SEED_BRANDS, seedData } from "./seed-data.js";

// A small JSON document store shared by the website, the admin panel and the Telegram bot.
// Everything lives in DATA_DIR/db.json; writes go to a temporary file first, then replace it.

export const DATA_DIR = process.env.DATA_DIR || "data";
const DB_FILE = join(DATA_DIR, "db.json");

const sameRecords = (a, b) => {
  const canonical = (list) => JSON.stringify(list.map((item) => Object.fromEntries(Object.entries(item).sort(([x], [y]) => x.localeCompare(y)))));
  return canonical(a) === canonical(b);
};

// Applies a change released after this database was created (see CATALOG_UPDATES). Each runs once:
// cars already present (by id) are left alone, a car the owner later deletes stays deleted, and settings
// or services the owner has edited are kept.
const withoutDates = ({ createdAt, updatedAt, ...rest }) => rest;

function applyCatalogUpdate(data, update) {
  for (const [key, [previous, next]] of Object.entries(update.settings ?? {})) {
    if (data.settings[key] === previous) data.settings[key] = next;
  }
  if (update.services && sameRecords(data.services, update.services.from)) data.services = structuredClone(update.services.to);
  // New records (e.g. ECU families) are added unless one with the same id exists.
  for (const [name, items] of Object.entries(update.add ?? {})) {
    for (const item of items) if (!data[name].some((entry) => entry.id === item.id)) data[name].push(structuredClone(item));
  }
  // New fields for existing records (e.g. an ECU's tool support) are set only where a record has none.
  for (const [name, items] of Object.entries(update.fill ?? {})) {
    for (const item of items) {
      const entry = data[name].find((candidate) => candidate.id === item.id);
      if (!entry) continue;
      for (const [key, value] of Object.entries(item)) if (key !== "id" && entry[key] === undefined) entry[key] = structuredClone(value);
    }
  }
  // A record is replaced only while it still matches the old default exactly (dates aside).
  for (const [name, pairs] of Object.entries(update.replace ?? {})) {
    for (const { from, to } of pairs) {
      const index = data[name].findIndex((entry) => entry.id === from.id && sameRecords([withoutDates(entry)], [from]));
      if (index < 0 || data[name].some((entry, i) => i !== index && entry.id === to.id)) continue;
      const { createdAt } = data[name][index];
      const record = { ...structuredClone(to), ...(createdAt && { createdAt }) };
      // A car only refers to ECU families this database still has.
      if (name === "vehicles") record.ecus = record.ecus.filter((id) => data.ecus.some((ecu) => ecu.id === id));
      data[name][index] = record;
    }
  }
  const ecuIds = new Set(data.ecus.map((ecu) => ecu.id));
  for (const vehicle of update.vehicles ?? []) {
    if (data.vehicles.some((entry) => entry.id === vehicle.id)) continue;
    if (!data.brands.some((brand) => brand.id === vehicle.brand)) {
      const brand = SEED_BRANDS.find((item) => item.id === vehicle.brand);
      if (!brand) continue;
      data.brands.push(structuredClone(brand));
    }
    data.vehicles.push({ ...structuredClone(vehicle), ecus: vehicle.ecus.filter((id) => ecuIds.has(id)) });
  }
}

// Adds collections, settings and catalogue cars introduced after the database was first created.
function migrate(stored) {
  const data = { ...seedData(), ...structuredClone(stored), settings: { ...DEFAULT_SETTINGS, ...stored.settings } };
  const from = stored.catalogVersion ?? 1;
  for (const update of CATALOG_UPDATES) if (update.version > from) applyCatalogUpdate(data, update);
  data.catalogVersion = Math.max(from, CATALOG_VERSION);
  return data;
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

function persist(value) {
  mkdirSync(DATA_DIR, { recursive: true });
  const temp = `${DB_FILE}.tmp`;
  writeFileSync(temp, JSON.stringify(value, null, 2));
  renameSync(temp, DB_FILE);
}

// Read-only view of the current data. Change it only through transact().
export function db() {
  return data;
}

// Applies a change to a copy of the data, saves it, then swaps it in. If the change or the save
// fails, nothing is modified, so the site never shows a change that wasn't stored.
export function transact(change) {
  const draft = structuredClone(data);
  const result = change(draft);
  persist(draft);
  data = draft;
  return result;
}

export function replaceData(next) {
  const migrated = migrate(next);
  persist(migrated);
  data = migrated;
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
