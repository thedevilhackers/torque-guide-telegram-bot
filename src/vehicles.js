import { brandById, brands } from "./catalog.js";
import { db } from "./db.js";

// Vehicle entries live in the database (seeded from seed-data.js) and are edited in the admin panel.
export const vehicleEntries = () => db().vehicles;

// Stage 1 gain limits (as a fraction of stock) used to sanity-check AI estimates.
export const STAGE1_GAINS = {
  "petrol:turbo": { hp: [0.1, 0.4], nm: [0.1, 0.4], typical: [0.22, 0.2] },
  "diesel:turbo": { hp: [0.1, 0.35], nm: [0.1, 0.35], typical: [0.18, 0.18] },
  "petrol:supercharged": { hp: [0.05, 0.2], nm: [0.05, 0.2], typical: [0.1, 0.1] },
  "petrol:naturally_aspirated": { hp: [0.03, 0.1], nm: [0.03, 0.1], typical: [0.05, 0.05] }
};

export function gainPolicy(fuel, aspiration) {
  if (fuel === "diesel") return STAGE1_GAINS["diesel:turbo"];
  return STAGE1_GAINS[`petrol:${aspiration}`] ?? STAGE1_GAINS["petrol:naturally_aspirated"];
}

export function yearsLabel([from, to] = []) {
  if (!from) return "";
  return to ? `${from}–${to}` : `${from}+`;
}

function toVehicle(entry) {
  const { stock, stage1, years, keywords, brand, ...rest } = entry;
  return {
    ...rest,
    source: "catalog",
    brandId: brand,
    brand: brandById(brand)?.title ?? brand,
    years: yearsLabel(years),
    yearRange: years,
    stock: { hp: stock[0], nm: stock[1] },
    stage1: { hp: stage1[0], nm: stage1[1] },
    tunable: true
  };
}

export function getVehicle(id) {
  const entry = vehicleEntries().find((vehicle) => vehicle.id === id);
  return entry ? toVehicle(entry) : undefined;
}

export function vehiclesForBrand(brandId) {
  return vehicleEntries().filter((vehicle) => vehicle.brand === brandId).map(toVehicle);
}

export function brandsWithVehicles() {
  return brands().filter((brand) => vehicleEntries().some((vehicle) => vehicle.brand === brand.id));
}

export function vehicleName(vehicle) {
  return [vehicle.brand, vehicle.model, vehicle.generation].filter(Boolean).join(" ");
}

export function vehicleButtonLabel(vehicle) {
  const years = vehicle.years ? ` (${vehicle.years})` : "";
  return `${vehicle.model} ${vehicle.generation} · ${vehicle.engine.replace(/\s*\(.*\)$/, "")}${years}`;
}

export function stage1Gain(vehicle) {
  const hp = vehicle.stage1.hp - vehicle.stock.hp;
  const nm = vehicle.stage1.nm - vehicle.stock.nm;
  return { hp, nm, hpPercent: Math.round((hp / vehicle.stock.hp) * 100), nmPercent: Math.round((nm / vehicle.stock.nm) * 100) };
}

export function normalizeSearch(value) {
  return String(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/(?<!\d)\.|\.(?!\d)/g, " ")
    .replace(/[^a-z0-9.]+/g, " ")
    .trim();
}

function searchText(entry) {
  const brand = brandById(entry.brand);
  return normalizeSearch([brand?.title, ...(brand?.aliases ?? []), entry.model, entry.generation, entry.engine, entry.keywords].join(" "));
}

// Every non-year word must match the start of a word (or appear inside the text for 3+ characters).
// A model year acts as a ranking hint rather than a filter.
export function searchVehicles(query, limit = 8) {
  const tokens = normalizeSearch(query).split(" ").filter(Boolean);
  if (!tokens.length) return [];
  const yearTokens = tokens.filter((token) => /^(19|20)\d\d$/.test(token)).map(Number);
  const wordTokens = tokens.filter((token) => !/^(19|20)\d\d$/.test(token));
  if (!wordTokens.length) return [];
  const results = [];
  vehicleEntries().forEach((entry, index) => {
    const text = searchText(entry);
    const words = text.split(" ");
    const compact = text.replace(/ /g, "");
    let score = 0;
    for (const token of wordTokens) {
      if (words.includes(token)) score += 3;
      else if (words.some((word) => word.startsWith(token))) score += 2;
      else if (token.length >= 3 && compact.includes(token)) score += 1;
      else return;
    }
    for (const year of yearTokens) {
      const [from, to = 9999] = entry.years;
      score += year >= from && year <= to ? 2 : -2;
    }
    results.push({ entry, score, index });
  });
  return results
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map(({ entry }) => toVehicle(entry));
}
