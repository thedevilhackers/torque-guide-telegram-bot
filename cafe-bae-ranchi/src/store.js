import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

// Each collection lives in its own JSON file. "object" collections are seeded
// from data/<name>.json the first time the site runs.
export const COLLECTIONS = {
  site: "object",
  menu: "object",
  orders: "array",
  reservations: "array",
  reviews: "array",
  enquiries: "array",
  subscribers: "array",
  users: "array",
  sessions: "array",
  audit: "array",
  messages: "array"
};

// Logs are trimmed to their newest entries so the JSON files stay small.
const CAPS = { audit: 5000, messages: 3000, sessions: 2000 };

async function readJsonFile(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

/**
 * Small file-backed store. Everything is held in memory and written to disk
 * atomically (temp file + rename), one write at a time per collection.
 * Intended for a single server instance; move to a database before scaling out.
 */
export class Store {
  constructor({ dataDir, seedDir }) {
    this.dataDir = dataDir;
    this.seedDir = seedDir;
    this.data = {};
    this.writes = {};
  }

  async init() {
    await mkdir(this.dataDir, { recursive: true });
    for (const [name, kind] of Object.entries(COLLECTIONS)) {
      const file = this.fileFor(name);
      const seed = await this.readSeed(name, kind);
      try {
        const stored = await readJsonFile(file);
        // New settings added to data/site.json later still reach existing installs.
        this.data[name] = name === "site" ? mergeDefaults(seed, stored) : stored;
      } catch (error) {
        if (error.code !== "ENOENT") throw new Error(`Could not read ${file}: ${error.message}`);
        this.data[name] = seed;
        await this.save(name);
      }
    }
  }

  async readSeed(name, kind) {
    try {
      return await readJsonFile(path.join(this.seedDir, `${name}.json`));
    } catch (error) {
      if (error.code === "ENOENT") return kind === "array" ? [] : {};
      throw new Error(`Could not read seed data for ${name}: ${error.message}`);
    }
  }

  fileFor(name) {
    return path.join(this.dataDir, `${name}.json`);
  }

  get(name) {
    return this.data[name];
  }

  save(name) {
    const cap = CAPS[name];
    if (cap && this.data[name].length > cap) this.data[name].splice(0, this.data[name].length - cap);
    const file = this.fileFor(name);
    const temp = `${file}.${process.pid}.tmp`;
    const write = async () => {
      await writeFile(temp, JSON.stringify(this.data[name], null, 2));
      await rename(temp, file);
    };
    const previous = this.writes[name] ?? Promise.resolve();
    this.writes[name] = previous.then(write, write);
    return this.writes[name];
  }

  async flush() {
    await Promise.allSettled(Object.values(this.writes));
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function mergeDefaults(defaults, stored) {
  if (!isPlainObject(defaults) || !isPlainObject(stored)) return stored ?? defaults;
  const result = { ...defaults };
  for (const [key, value] of Object.entries(stored)) {
    result[key] = isPlainObject(value) && isPlainObject(defaults[key]) ? mergeDefaults(defaults[key], value) : value;
  }
  return result;
}
