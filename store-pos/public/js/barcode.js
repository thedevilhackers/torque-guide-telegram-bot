// Barcode rendering as SVG: EAN-13 (retail) and Code 128-B (receipts, SKUs).

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

/** Returns an SVG string for the code (EAN-13 when valid, otherwise Code 128). */
export function barcodeSvg(code, { height = 48, module = 2, showText = true, color = "#000" } = {}) {
  const text = String(code);
  let bits;
  let guards = null;
  if (isEan13(text)) {
    bits = ean13Bits(text);
    guards = new Set([0, 1, 2, 45, 46, 47, 48, 49, 92, 93, 94]);
  } else {
    bits = code128Bits(text);
  }
  const quiet = 10 * module;
  const width = bits.length * module + quiet * 2;
  const textH = showText ? 14 : 0;
  let rects = "";
  for (let i = 0; i < bits.length; i += 1) {
    if (bits[i] !== "1") continue;
    const h = guards && guards.has(i) ? height + 5 : height;
    rects += `<rect x="${quiet + i * module}" y="0" width="${module}" height="${h}"/>`;
  }
  const label = showText
    ? `<text x="${width / 2}" y="${height + textH}" text-anchor="middle" font-family="monospace" font-size="${Math.max(10, module * 6)}">${text.replace(/[<&]/g, "")}</text>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height + textH + 2}" width="${width}" height="${height + textH + 2}" fill="${color}" role="img" aria-label="Barcode ${text.replace(/["<&]/g, "")}">${rects}${label}</svg>`;
}
