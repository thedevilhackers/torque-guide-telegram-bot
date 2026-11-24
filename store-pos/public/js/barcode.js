// Barcode rendering as SVG: EAN-13 (retail), Code 128-B (receipts, SKUs) and GS1-128 (date labels).

const L = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"];
const G = ["0100111", "0110011", "0011011", "0100001", "0011101", "0111001", "0000101", "0010001", "0001001", "0010111"];
const R = ["1110010", "1100110", "1101100", "1000010", "1011100", "1001110", "1010000", "1000100", "1001000", "1110100"];
const PARITY = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"];

export function ean13Check(body12) {
  let sum = 0;
  for (let i = 0; i < 12; i += 1) sum += Number(body12[i]) * (i % 2 ? 3 : 1);
  return String((10 - (sum % 10)) % 10);
}

export function isEan13(code) {
  return /^\d{13}$/.test(code) && ean13Check(code.slice(0, 12)) === code[12];
}

function ean13Bits(code) {
  const parity = PARITY[Number(code[0])];
  let bits = "101";
  for (let i = 1; i <= 6; i += 1) bits += (parity[i - 1] === "L" ? L : G)[Number(code[i])];
  bits += "01010";
  for (let i = 7; i <= 12; i += 1) bits += R[Number(code[i])];
  return bits + "101";
}

// Code 128 patterns (values 0-106), as bar/space widths.
const C128 = "212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 123122 123221 223211 221132 221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 232121 111323 131123 131321 112313 132113 132311 211313 231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 114131 311141 411131 211412 211214 211232 2331112".split(" ");

function code128Bits(text) {
  const values = [104]; // Start B
  for (const ch of text) {
    const c = ch.charCodeAt(0);
    if (c < 32 || c > 126) throw new Error("Code 128-B supports printable ASCII only");
    values.push(c - 32);
  }
  return valuesToBits(values);
}

function valuesToBits(values) {
  values = [...values];
  let check = values[0];
  for (let i = 1; i < values.length; i += 1) check += values[i] * i;
  values.push(check % 103, 106);
  let bits = "";
  for (const v of values) {
    const widths = C128[v];
    for (let i = 0; i < widths.length; i += 1) bits += (i % 2 ? "0" : "1").repeat(Number(widths[i]));
  }
  return bits;
}

// ---- GS1-128 -------------------------------------------------------------------------

const FNC1 = 102;
const GS = "\x1d";
// AIs with a fixed length need no separator after them.
const FIXED_AIS = new Set(["00", "01", "02", "11", "12", "13", "15", "16", "17", "20"]);
const isDigit = (c) => c >= "0" && c <= "9";

/** Code 128 values for GS1 data: FNC1 after the start, code set C for digit pairs, B for the rest. */
function gs1Values(data) {
  const run = (i) => {
    let n = 0;
    while (i + n < data.length && isDigit(data[i + n])) n += 1;
    return n;
  };
  let set = run(0) >= 2 ? "C" : "B";
  const values = [set === "C" ? 105 : 104, FNC1];
  let i = 0;
  while (i < data.length) {
    if (data[i] === GS) {
      values.push(FNC1);
      i += 1;
      continue;
    }
    const digits = run(i);
    if (set === "C") {
      if (digits >= 2) {
        values.push(Number(data.slice(i, i + 2)));
        i += 2;
      } else {
        values.push(100); // switch to code set B
        set = "B";
      }
      continue;
    }
    if (digits >= 4) {
      if (digits % 2) {
        values.push(data.charCodeAt(i) - 32);
        i += 1;
      }
      values.push(99); // switch to code set C
      set = "C";
      continue;
    }
    const c = data.charCodeAt(i);
    if (c < 32 || c > 126) throw new Error("GS1-128 supports printable ASCII only");
    values.push(c - 32);
    i += 1;
  }
  return values;
}

/** Joins [[ai, value], ...] into GS1 data, with a separator after variable-length fields. */
export function gs1Data(fields) {
  return fields.map(([ai, value], i) => `${ai}${value}${!FIXED_AIS.has(ai) && i < fields.length - 1 ? GS : ""}`).join("");
}

/** "(01)05000000000289(17)270123" — the human-readable line printed under a GS1-128 barcode. */
export function gs1Text(fields) {
  return fields.map(([ai, value]) => `(${ai})${value}`).join("");
}

/** The 14-digit GTIN for a retail barcode (EAN-13, UPC-A, EAN-8, GTIN-14), or null if it isn't one. */
export function toGtin14(code) {
  const text = String(code ?? "");
  if (!/^(\d{8}|\d{12,14})$/.test(text)) return null;
  const gtin = text.padStart(14, "0");
  let sum = 0;
  for (let i = 0; i < 13; i += 1) sum += Number(gtin[12 - i]) * (i % 2 ? 1 : 3);
  return String((10 - (sum % 10)) % 10) === gtin[13] ? gtin : null;
}

/**
 * GS1-128 barcode SVG for [[ai, value], ...]. With stretch, the bars fill whatever box CSS gives
 * the SVG (for labels), and the text line is left to the page.
 */
export function gs1Svg(fields, { height = 48, module = 2, stretch = false, color = "#000" } = {}) {
  const bits = valuesToBits(gs1Values(gs1Data(fields)));
  return svgFromBits(bits, { text: gs1Text(fields), height, module, showText: !stretch, color, stretch });
}

/** Returns an SVG string for the code (EAN-13 when valid, otherwise Code 128). */
export function barcodeSvg(code, { height = 48, module = 2, showText = true, color = "#000" } = {}) {
  const text = String(code);
  if (isEan13(text)) return svgFromBits(ean13Bits(text), { text, height, module, showText, color, guards: new Set([0, 1, 2, 45, 46, 47, 48, 49, 92, 93, 94]) });
  return svgFromBits(code128Bits(text), { text, height, module, showText, color });
}

function svgFromBits(bits, { text, height, module, showText, color, guards = null, stretch = false }) {
  const quiet = 10 * module;
  const width = bits.length * module + quiet * 2;
  const textH = showText ? 14 : 0;
  let rects = "";
  // One rectangle per run of dark modules (EAN guard bars are drawn longer).
  for (let i = 0; i < bits.length; ) {
    if (bits[i] !== "1") {
      i += 1;
      continue;
    }
    const guard = Boolean(guards?.has(i));
    let n = 1;
    while (i + n < bits.length && bits[i + n] === "1" && Boolean(guards?.has(i + n)) === guard) n += 1;
    rects += `<rect x="${quiet + i * module}" y="0" width="${n * module}" height="${guard ? height + 5 : height}"/>`;
    i += n;
  }
  const label = showText
    ? `<text x="${width / 2}" y="${height + textH}" text-anchor="middle" font-family="monospace" font-size="${Math.max(10, module * 6)}">${text.replace(/[<&]/g, "")}</text>`
    : "";
  const size = stretch ? `preserveAspectRatio="none"` : `width="${width}" height="${height + textH + 2}"`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height + textH + 2}" ${size} fill="${color}" role="img" aria-label="Barcode ${text.replace(/["<&]/g, "")}">${rects}${label}</svg>`;
}
