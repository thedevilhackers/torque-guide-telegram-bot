import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { settings } from "../db.js";
import { isHttps } from "./http.js";
import { CITY_PAGES, faqHtml, founderHtml, structuredData } from "./seo.js";

// The website's pages, sent with the site's full address filled in (link previews and search
// engines need absolute links) and the business details as structured data for search engines.

const pageCache = new Map();

// The address the site is reached on: the one set in the admin panel or by the installer, else the
// address this request came in on.
export function siteOrigin(req) {
  const configured = settings().siteUrl || process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || "";
  if (/^https?:\/\/[^\s/]+$/.test(configured.replace(/\/+$/, ""))) return configured.replace(/\/+$/, "");
  const host = String(req.headers.host ?? "");
  return `${isHttps(req) ? "https" : "http"}://${/^[A-Za-z0-9.-]+(:\d+)?$/.test(host) ? host : "localhost"}`;
}

export function renderPage(req, root, page) {
  const file = join(root, page);
  const { mtimeMs } = statSync(file);
  let cached = pageCache.get(file);
  if (!cached || cached.mtimeMs !== mtimeMs) {
    cached = { mtimeMs, html: readFileSync(file, "utf8") };
    pageCache.set(file, cached);
  }
  const origin = siteOrigin(req);
  return cached.html
    .replaceAll("%ORIGIN%", origin)
    .replace("<!--structured-data-->", () => structuredData(origin, page))
    .replace("<!--faq-->", () => faqHtml(page))
    .replace("<!--founder-->", () => founderHtml());
}

export function robotsTxt(req) {
  return ["User-agent: *", "Disallow: /admin", "Disallow: /api/", `Sitemap: ${siteOrigin(req)}/sitemap.xml`, ""].join("\n");
}

export function sitemapXml(req) {
  const origin = siteOrigin(req).replace(/&/g, "&amp;");
  const paths = ["/", ...Object.values(CITY_PAGES).map((city) => city.path), "/offers", "/mechanics", "/refer", "/franchise", "/files", "/tools", "/shop"];
  const urls = paths.map((path) => `  <url><loc>${origin}${path}</loc></url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}
