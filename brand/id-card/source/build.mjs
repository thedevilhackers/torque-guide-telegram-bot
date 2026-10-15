// Builds brand/id-card/unity-id-card.html from card.html: the fonts, logo and QR code it points to
// are packed into the file, so it opens and prints in any browser, even offline.
//
//   node brand/id-card/source/build.mjs
import { readFile, writeFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const TYPES = { ".woff2": "font/woff2", ".webp": "image/webp", ".png": "image/png", ".svg": "image/svg+xml" };

async function dataUri(path) {
  const type = TYPES[extname(path).toLowerCase()];
  if (!type) throw new Error(`No data type for ${path}`);
  return `data:${type};base64,${(await readFile(resolve(here, path))).toString("base64")}`;
}

let html = await readFile(resolve(here, "card.html"), "utf8");
const references = new Set([...html.matchAll(/(?:url\("|src=")(?!data:|https?:)([^"]+\.(?:woff2|webp|png|svg))"/g)].map((match) => match[1]));
for (const path of references) {
  const uri = await dataUri(path);
  html = html.replaceAll(`url("${path}")`, `url("${uri}")`).replaceAll(`src="${path}"`, `src="${uri}"`);
}
const left = html.match(/(?:url\("|src=")(?!data:)[^"]*\.(?:woff2|webp|png|svg)"/);
if (left) throw new Error(`Not packed into the page: ${left[0]}`);

const out = resolve(here, "..", "unity-id-card.html");
await writeFile(out, html);
console.log(`Wrote ${out} (${Math.round(html.length / 1024)} KB, ${references.size} files packed in)`);
