// GS1 barcodes: GS1-128, GS1 DataMatrix, GS1 QR Code and GS1 Digital Link URLs.
// They carry "Application Identifiers" (AIs) such as (01) product number, (17) expiry date,
// (10) batch/lot and (21) serial number. Ordinary EAN-13/UPC codes carry the product number only.

const GS = "\x1d"; // FNC1 / group separator between variable-length fields

// AIM symbology identifiers that scanners can be set to send in front of the data.
const GS1_SYMBOLOGIES = new Set(["]C1", "]d2", "]Q3", "]e0", "]J1"]);
const AIM_PREFIX = /^\][A-Za-z][0-9A-Za-z]/;

/** Removes an AIM symbology identifier (e.g. "]E0" in front of an EAN-13) if the scanner sends one. */
export function stripSymbology(code) {
  return AIM_PREFIX.test(code) ? code.slice(3) : code;
}

// Digits in the AI itself, by its first two digits (GS1 General Specifications, AI table).
const AI3 = new Set(["23", "24", "25", "40", "41", "42", "71"]);
const AI4 = new Set(["31", "32", "33", "34", "35", "36", "39", "43", "70", "72", "80", "81", "82"]);
const AI2 = new Set(["00", "01", "02", "03", "04", "10", "11", "12", "13", "15", "16", "17", "20", "21", "22", "30", "37", ...Array.from({ length: 10 }, (_, i) => `9${i}`)]);

function aiAt(s, i) {
  const two = s.slice(i, i + 2);
  if (!/^\d\d$/.test(two)) return null;
  const len = AI3.has(two) ? 3 : AI4.has(two) ? 4 : AI2.has(two) ? 2 : 0;
  if (!len) return null;
  const ai = s.slice(i, i + len);
  return /^\d+$/.test(ai) && ai.length === len ? ai : null;
}

const FIXED = { "00": 18, "01": 14, "02": 14, "03": 14, "11": 6, "12": 6, "13": 6, "15": 6, "16": 6, "17": 6, "20": 2 };

function fixedLength(ai) {
  if (ai in FIXED) return FIXED[ai];
  if (/^3[1-6]\d\d$/.test(ai)) return 6; // weights and measures
  if (/^41\d$/.test(ai)) return 13; // GLN
  if (ai === "7003") return 10; // expiry date and time
  if (/^42[246]$/.test(ai)) return 3; // country codes
  return null;
}

/** GS1 mod-10 check digit for the digits before it. */
export function gs1CheckDigitOf(body) {
  let sum = 0;
  for (let i = 0; i < body.length; i += 1) sum += Number(body[body.length - 1 - i]) * (i % 2 ? 1 : 3);
  return String((10 - (sum % 10)) % 10);
}

export function validGtin(gtin) {
  return /^\d{14}$/.test(gtin) && gs1CheckDigitOf(gtin.slice(0, 13)) === gtin[13];
}

/** The forms a 14-digit GTIN may be stored in the catalogue as: GTIN-14, EAN-13, UPC-A, EAN-8. */
export function gtinVariants(gtin) {
  const out = [gtin];
  if (gtin.startsWith("0")) out.push(gtin.slice(1));
  if (gtin.startsWith("00")) out.push(gtin.slice(2));
  if (gtin.startsWith("000000")) out.push(gtin.slice(6));
  return out;
}

/** The barcode to save on a new product for this GTIN: EAN-13 (or EAN-8) for retail items, GTIN-14 for cases. */
export function retailBarcode(gtin) {
  if (gtin.startsWith("000000")) return gtin.slice(6);
  return gtin.startsWith("0") ? gtin.slice(1) : gtin;
}

const pad = (n) => String(n).padStart(2, "0");

/** YYMMDD → YYYY-MM-DD using the GS1 century rule. Day 00 means the last day of the month. */
export function gs1Date(value, now = new Date()) {
  if (!/^\d{6}$/.test(value)) return null;
  const yy = Number(value.slice(0, 2));
  const mm = Number(value.slice(2, 4));
  const dd = Number(value.slice(4, 6));
  if (mm < 1 || mm > 12) return null;
  const current = now.getUTCFullYear();
  let year = current - (current % 100) + yy;
  const diff = yy - (current % 100);
  if (diff >= 51) year -= 100;
  else if (diff <= -50) year += 100;
  const lastDay = new Date(Date.UTC(year, mm, 0)).getUTCDate();
  const day = dd === 0 ? lastDay : dd;
  if (day > lastDay) return null;
  return `${year}-${pad(mm)}-${pad(day)}`;
}

// Reads AIs from an element string. Returns { ais, separators } or null when it isn't GS1 data.
function parseElementString(s) {
  const ais = {};
  let i = 0;
  while (i < s.length) {
    if (s[i] === GS) {
      i += 1;
      continue;
    }
    const ai = aiAt(s, i);
    if (!ai) break;
    i += ai.length;
    const fixed = fixedLength(ai);
    let value;
    if (fixed) {
      value = s.slice(i, i + fixed);
      if (value.length !== fixed) break;
      i += fixed;
    } else {
      const end = s.indexOf(GS, i);
      value = s.slice(i, end === -1 ? s.length : end);
      i = end === -1 ? s.length : end;
    }
    if (!value) break;
    ais[ai] = value;
  }
  return { ais, complete: i >= s.length };
}

// Digital Link short names (GS1 Digital Link 1.1) for the identifiers we use.
const DL_ALIASES = { gtin: "01", lot: "10", ser: "21", exp: "17", bbd: "15" };

function parseDigitalLink(text) {
  let url;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  const parts = url.pathname.split("/").filter(Boolean).map((p) => decodeURIComponent(p));
  const start = parts.findIndex((p) => p === "01" || p === "gtin");
  if (start === -1) return null;
  const ais = {};
  for (let i = start; i + 1 < parts.length; i += 2) {
    const ai = DL_ALIASES[parts[i]] ?? parts[i];
    if (/^\d{2,4}$/.test(ai)) ais[ai] = parts[i + 1];
  }
  for (const [key, value] of url.searchParams) {
    const ai = DL_ALIASES[key] ?? key;
    if (/^\d{2,4}$/.test(ai) && value) ais[ai] = value;
  }
  return ais;
}

// Without separators, a batch number that comes before the expiry swallows it ("10ABC17271231").
// When the code has no separators and no expiry was found, take a trailing (17)/(15) date back out.
function recoverTrailingDate(ais) {
  if (ais["17"] || ais["15"]) return;
  for (const key of ["10", "21", "22", "90"]) {
    const m = ais[key]?.match(/^(.+)(17|15)(\d{6})$/);
    if (m && gs1Date(m[3])) {
      ais[key] = m[1];
      ais[m[2]] = m[3];
      return;
    }
  }
}

/**
 * Parses a scanned code. Returns null for ordinary barcodes, otherwise
 * { gtin, expiry_date, best_before, batch, serial, count, net_weight_kg, sscc, ais }.
 */
export function parseGs1(raw, { now = new Date() } = {}) {
  let text = String(raw ?? "").trim();
  if (!text) return null;
  let ais = null;

  if (/^https?:\/\//i.test(text)) {
    ais = parseDigitalLink(text);
  } else if (/^\(\d{2,4}\)/.test(text)) {
    // Human-readable form, e.g. "(01)09506000134352(17)271231(10)ABC123" typed from the label.
    ais = {};
    for (const m of text.matchAll(/\((\d{2,4})\)([^(]*)/g)) if (m[2].trim()) ais[m[1]] = m[2].trim();
  } else {
    const symbology = AIM_PREFIX.test(text) ? text.slice(0, 3) : null;
    if (symbology) {
      if (!GS1_SYMBOLOGIES.has(symbology)) return null;
      text = text.slice(3);
    }
    const leadingFnc1 = text.startsWith(GS);
    while (text.startsWith(GS)) text = text.slice(1);
    const hasSeparators = text.includes(GS);
    // A plain string of digits/letters is only treated as GS1 when it clearly is: it starts with
    // (00)/(01)/(02), is at least as long as "01" + a GTIN-14 and parses to the end.
    const explicit = Boolean(symbology) || hasSeparators || leadingFnc1;
    if (!explicit && (!/^0[012]/.test(text) || text.length < 16)) return null;
    const parsed = parseElementString(text);
    if (!explicit && !parsed.complete) return null;
    ais = parsed.ais;
    if (!hasSeparators) recoverTrailingDate(ais);
  }

  if (!ais) return null;
  for (const key of ["01", "02"]) if (/^\d{8,13}$/.test(ais[key] ?? "")) ais[key] = ais[key].padStart(14, "0");
  if (!(ais["01"] || ais["02"] || ais["00"])) return null;
  const gtin = ais["01"] ?? ais["02"] ?? null;
  if (gtin && !validGtin(gtin)) return null;

  const weightAi = Object.keys(ais).find((k) => /^310\d$/.test(k));
  const countRaw = ais["37"] ?? ais["30"];
  const count = countRaw && /^\d{1,8}$/.test(countRaw) ? Number(countRaw) : null;
  return {
    gtin,
    contents: Boolean(!ais["01"] && ais["02"]), // (02): the GTIN of the items inside a carton
    expiry_date: gs1Date(ais["17"] ?? "", now) ?? (ais["7003"] ? gs1Date(ais["7003"].slice(0, 6), now) : null),
    best_before: gs1Date(ais["15"] ?? "", now),
    batch: ais["10"] ?? null,
    serial: ais["21"] ?? null,
    count: count && count > 0 ? count : null,
    net_weight_kg: weightAi && /^\d{6}$/.test(ais[weightAi]) ? Number(ais[weightAi]) / 10 ** Number(weightAi[3]) : null,
    sscc: ais["00"] ?? null,
    ais
  };
}
