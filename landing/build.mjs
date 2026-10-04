// Builds the self-contained landing page from landing.html: the photos and logo it points to in
// ../public are inlined as data URIs, and the page is wrapped in a full HTML document.
//
//   node landing/build.mjs                    writes landing/dist/unity-performance.html
//   node landing/build.mjs --fragment <file>  also writes the page body without the document wrapper
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const TYPES = { ".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml" };
const HEAD_END = "<!-- /head -->";

const source = await readFile(resolve(here, "landing.html"), "utf8");
const paths = [...new Set([...source.matchAll(/src="(\.\.\/public\/[^"]+)"/g)].map((match) => match[1]))];
let page = source;
for (const path of paths) {
  const type = TYPES[extname(path).toLowerCase()];
  if (!type) throw new Error(`Unknown image type: ${path}`);
  const data = await readFile(resolve(here, path));
  page = page.replaceAll(`src="${path}"`, `src="data:${type};base64,${data.toString("base64")}"`);
}

if (!page.includes(HEAD_END)) throw new Error(`landing.html needs a ${HEAD_END} marker after the <style> block`);
const [head, body] = page.split(HEAD_END);
const html = [
  "<!doctype html>",
  '<html lang="en">',
  "<head>",
  '<meta charset="utf-8">',
  '<meta name="viewport" content="width=device-width, initial-scale=1">',
  head.trim(),
  "</head>",
  "<body>",
  body.trim(),
  "</body>",
  "</html>",
  ""
].join("\n");

const out = resolve(here, "dist", "unity-performance.html");
await mkdir(dirname(out), { recursive: true });
await writeFile(out, html);
console.log(`Wrote ${out} (${Math.round(html.length / 1024)} KB, ${paths.length} images inlined)`);

const fragmentAt = process.argv.indexOf("--fragment");
if (fragmentAt !== -1) {
  const fragmentOut = resolve(process.argv[fragmentAt + 1]);
  await writeFile(fragmentOut, `${head.trim()}\n${body.trim()}\n`);
  console.log(`Wrote ${fragmentOut}`);
}
