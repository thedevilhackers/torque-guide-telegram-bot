import { readFileSync } from "node:fs";

// Autotuner's compatibility list: which ECUs Autotuner reads, and how (OBD, bench or boot). Taken from
// the PDF the workshop exported from autotuner.com; the methods were shown there as icons. Replace
// src/data/autotuner-compatibility.json with a newer export to update it.
const list = JSON.parse(readFileSync(new URL("./data/autotuner-compatibility.json", import.meta.url), "utf8"));

export const AUTOTUNER_SOURCE = { name: list.source, exported: list.exported, url: list.url, size: list.entries.length };

// Words customers use for brands that the list names differently.
const ALIASES = { maruti: "suzuki", vw: "volkswagen", merc: "mercedes", benz: "mercedes", chevy: "chevrolet", landrover: "land rover" };
const CATEGORY_ORDER = { car: 0, truck: 1, moto: 2, atv: 3, agri: 4, jetski: 5 };

const plain = (value) => String(value ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const squash = (value) => plain(value).replace(/[^a-z0-9]/g, "");

const index = list.entries.map((entry) => ({
  entry,
  words: plain(`${entry.brand} ${entry.ecuBrand} ${entry.ecu} ${entry.mcu}`),
  squashed: squash(`${entry.brand} ${entry.ecuBrand} ${entry.ecu} ${entry.mcu}`),
  ecu: squash(entry.ecu)
}));

// Every word must match the brand, ECU maker, ECU or chip; ECU names match with or without spaces and
// dots ("EDC17C57", "edc 17 c57"). Exact ECU matches come first, then cars before other vehicles.
export function searchAutotuner(query, { limit = 40 } = {}) {
  const text = plain(query).slice(0, 60);
  const words = text.split(/[^a-z0-9.+-]+/).filter(Boolean).map((word) => ALIASES[word] ?? word);
  if (!words.length) return { total: 0, results: [] };
  const whole = squash(text);
  const matches = index.filter(({ words: haystack, squashed }) => words.every((word) => haystack.includes(word) || squashed.includes(squash(word))));
  const rank = ({ entry, ecu }) => (ecu === whole ? 0 : ecu.startsWith(whole) ? 1 : 2) * 10 + (CATEGORY_ORDER[entry.category] ?? 9);
  // Rows whose brand logo couldn't be read have no brand, so they go after named brands.
  matches.sort((a, b) => rank(a) - rank(b) || (a.entry.brand || "~").localeCompare(b.entry.brand || "~") || a.entry.ecu.localeCompare(b.entry.ecu));
  return { total: matches.length, results: matches.slice(0, limit).map(({ entry }) => entry) };
}
