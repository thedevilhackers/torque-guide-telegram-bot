// Builds landing/dist/unity-performance.html: the site's home page (public/index.html with its CSS,
// script, fonts and pictures) as one self-contained file that opens anywhere. The libraries load from
// public CDNs at the same versions as public/vendor, and links to other pages point at the live site.
//
//   node landing/build.mjs                    writes landing/dist/unity-performance.html
//   node landing/build.mjs --fragment <file>  also writes the page without its document wrapper
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pub = resolve(here, "..", "public");
const SITE = "https://unityperformance.co";
const TYPES = { ".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
// Each library, the text that proves public/vendor holds that version, and where the same version lives on a CDN.
const LIBRARIES = {
  "/vendor/gsap.min.js": ["GSAP 3.12.5", "https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js"],
  "/vendor/ScrollTrigger.min.js": ["ScrollTrigger 3.12.5", "https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/ScrollTrigger.min.js"],
  "/vendor/lenis.min.js": ["1.1.13", "https://cdn.jsdelivr.net/npm/lenis@1.1.13/dist/lenis.min.js"],
  "/vendor/three.module.min.js": ['const t="169"', "https://cdn.jsdelivr.net/npm/three@0.169.0/build/three.module.min.js"]
};

const read = (path) => readFile(resolve(pub, `.${path}`));
const dataUri = async (path) => {
  const type = TYPES[extname(path).toLowerCase()];
  if (!type) throw new Error(`No data type for ${path}`);
  return `data:${type};base64,${(await read(path)).toString("base64")}`;
};
async function replaceEach(text, pattern, replace) {
  let out = text;
  for (const match of new Set([...text.matchAll(pattern)].map((m) => m[0]))) out = out.replaceAll(match, await replace(match.match(new RegExp(pattern.source))));
  return out;
}
function swap(text, from, to) {
  if (!text.includes(from)) throw new Error(`Expected to find: ${from}`);
  return text.replace(from, () => to);
}

let html = (await read("/index.html")).toString();
let css = (await read("/css/landing.css")).toString();
const js = (await read("/js/landing.js")).toString();
if (js.includes("</script")) throw new Error("landing.js can't be inlined: it contains </script");

for (const [path, [marker]] of Object.entries(LIBRARIES)) {
  if (!(await read(path)).toString().includes(marker)) throw new Error(`${path} isn't the version the build links to (${marker}); update LIBRARIES`);
}

css = await replaceEach(css, /url\("(\/fonts\/[^"]+)"\)/g, async ([, path]) => `url("${await dataUri(path)}")`);

// Site-only lines: the live-site switch, link-preview and address-dependent tags, icons and the font preload.
html = swap(html, ' data-site="live"', "");
html = html.split("\n").filter((line) => !/%ORIGIN%|<!--structured-data-->|property="og:|name="twitter:|rel="icon"|rel="apple-touch-icon"|rel="preload"/.test(line)).join("\n");
html = swap(html, '<link rel="stylesheet" href="/css/landing.css">', `<style>\n${css}</style>`);
for (const [path, [, cdn]] of Object.entries(LIBRARIES)) html = html.replaceAll(`"${path}"`, `"${cdn}"`);
html = swap(html, '<script type="module" src="/js/landing.js"></script>', `<script type="module">\n${js}</script>`);
html = await replaceEach(html, /src="(\/(?:gallery|brand)\/[^"]+)"/g, async ([, path]) => `src="${await dataUri(path)}"`);
html = html.replace(/href="\/(?!\/)/g, `href="${SITE}/`);

const out = resolve(here, "dist", "unity-performance.html");
await mkdir(dirname(out), { recursive: true });
await writeFile(out, html);
console.log(`Wrote ${out} (${Math.round(html.length / 1024)} KB)`);

const fragmentAt = process.argv.indexOf("--fragment");
if (fragmentAt !== -1) {
  // The head (minus charset and viewport) followed by the body, as a page host that adds its own wrapper expects.
  const head = html.match(/<head>([\s\S]*)<\/head>/)[1].split("\n").filter((line) => !/<meta (charset|name="viewport")/.test(line)).join("\n");
  const body = html.match(/<body>([\s\S]*)<\/body>/)[1];
  const fragmentOut = resolve(process.argv[fragmentAt + 1]);
  await writeFile(fragmentOut, `${head.trim()}\n${body.trim()}\n`);
  console.log(`Wrote ${fragmentOut}`);
}
