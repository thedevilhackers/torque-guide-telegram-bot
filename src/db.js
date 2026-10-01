import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { envSettings } from "./config.js";
import { CATALOG_UPDATES, CATALOG_VERSION, DEFAULT_SETTINGS, SEED_BRANDS, seedData } from "./seed-data.js";

// A small JSON document store shared by the website, the admin panel and the Telegram bot.
// Everything lives in DATA_DIR/db.json; writes go to a temporary file first, then replace it.

export const DATA_DIR = process.env.DATA_DIR || "data";
const DB_FILE = join(DATA_DIR, "db.json");

// Adds catalogue cars released after this database was created. Each update is applied once:
// cars already present (by id) are left alone, and a car the owner later deletes stays deleted.
function applyCatalogUpdate(data, update) {
  const ecuIds = new Set(data.ecus.map((ecu) => ecu.id));
  for (const vehicle of update.vehicles) {
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
