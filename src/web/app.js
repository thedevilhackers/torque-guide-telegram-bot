import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { settings } from "../db.js";
import { UPLOAD_DIR, registerAdminRoutes } from "./admin-api.js";
import { currentAdmin } from "./auth.js";
import { CONTENT_TYPES, HttpError, applySecurityHeaders, clientIp, sendBuffer, sendJson, serveFile } from "./http.js";
import { renderPage, robotsTxt, sitemapXml } from "./pages.js";
import { CITY_PAGES } from "./seo.js";
import { registerPortalRoutes } from "./portal-api.js";
import { registerPublicRoutes } from "./public-api.js";

const PUBLIC_DIR = fileURLToPath(new URL("../../public/", import.meta.url));
const PAGES = {
  "/": "index.html",
  ...Object.fromEntries(Object.entries(CITY_PAGES).map(([file, city]) => [city.path, file])),
  "/files": "files.html",
  "/shop": "shop.html",
  "/franchise": "franchise.html",
  "/offers": "offers.html",
  "/refer": "refer.html",
  "/mechanics": "mechanics.html",
  "/tools": "tools.html",
  "/admin": "admin/index.html"
};
const UPLOAD_FILE = /^\/uploads\/([a-f0-9]{32}\.(png|jpg|webp))$/;

function compile(path) {
  const keys = [];
  const pattern = path.replace(/:(\w+)/g, (_, key) => {
    keys.push(key);
    return "([^/]+)";
  });
  return { regex: new RegExp(`^${pattern}$`), keys };
}

const notFoundPage = Buffer.from(
  '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Not found</title>' +
    '<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#000;color:#f5f5f7;font:17px -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;text-align:center">' +
    '<div><h1 style="font-size:48px;margin:0 0 12px">Page not found.</h1><a href="/" style="color:#2997ff">Go to the home page ›</a></div></body></html>'
);

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

// Maintenance mode: public pages show a short notice (503, so search engines come back later);
// signed-in admins still see the site, and the admin panel always works.
function sendMaintenance(res) {
  const { businessName, maintenanceMessage, whatsappNumber } = settings();
  const whatsapp = whatsappNumber ? `<p><a href="https://wa.me/${escapeHtml(whatsappNumber.replace(/\D/g, ""))}" style="color:#25d366">Message us on WhatsApp ›</a></p>` : "";
  const html =
    '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">' +
    `<title>${escapeHtml(businessName)}</title>` +
    '<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#000;color:#f5f5f7;font:17px -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;text-align:center;padding:24px">' +
    `<div style="max-width:520px"><h1 style="font-size:40px;margin:0 0 16px">${escapeHtml(businessName)}</h1><p style="color:#a1a1a6;line-height:1.5">${escapeHtml(maintenanceMessage || "We're updating the website. Please check back soon.")}</p>${whatsapp}</div></body></html>`;
  sendBuffer(res, 503, Buffer.from(html), CONTENT_TYPES[".html"], { "Cache-Control": "no-store", "Retry-After": "3600" });
}

// Pages carry the site's address, so they're filled in per request; the ETag lets browsers reuse them.
function sendPage(req, res, page) {
  if (page !== "admin/index.html" && settings().maintenanceMode && !currentAdmin(req)) return sendMaintenance(res);
  const html = Buffer.from(renderPage(req, PUBLIC_DIR, page));
  const etag = `"${createHash("sha1").update(html).digest("base64url").slice(0, 16)}"`;
  if (req.headers["if-none-match"] === etag) {
    res.writeHead(304, { ETag: etag, "Cache-Control": "no-cache" });
    res.end();
    return;
  }
  sendBuffer(res, 200, html, CONTENT_TYPES[".html"], { ETag: etag, "Cache-Control": "no-cache" });
}

// Handlers return a value to send it as JSON, or write to res themselves.
// ai and fetchImpl (Razorpay's API) are replaced in tests.
export function createApp({ botUsername = () => "", sendAlert = null, ai, fetchImpl } = {}) {
  const routes = [];
  const route = (method, path, handler) => routes.push({ method, handler, ...compile(path) });
  registerPublicRoutes(route, { botUsername, ...(ai && { ai }) });
  registerPortalRoutes(route, { fetchImpl });
  registerAdminRoutes(route, { botUsername, sendAlert, fetchImpl });
  // The car finder was briefly at /finder; it's the home page again. Browsers keep the #car=… part.
  route("GET", "/finder", ({ res }) => {
    res.writeHead(301, { Location: "/", "Cache-Control": "public, max-age=3600" });
    res.end();
  });
  route("GET", "/robots.txt", ({ req, res }) => sendBuffer(res, 200, Buffer.from(robotsTxt(req)), "text/plain; charset=utf-8", { "Cache-Control": "public, max-age=3600" }));
  route("GET", "/sitemap.xml", ({ req, res }) => sendBuffer(res, 200, Buffer.from(sitemapXml(req)), "application/xml; charset=utf-8", { "Cache-Control": "public, max-age=3600" }));

  return async function app(req, res) {
    applySecurityHeaders(req, res);
    const url = new URL(req.url ?? "/", "http://localhost");
    let pathname = null;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      // Malformed escapes are rejected below.
    }
    try {
      if (pathname === null || pathname.includes("\0")) throw new HttpError(400, "Bad request.");
      const method = req.method === "HEAD" ? "GET" : req.method;
      let pathExists = false;
      for (const candidate of routes) {
        const match = candidate.regex.exec(pathname);
        if (!match) continue;
        pathExists = true;
        if (candidate.method !== method) continue;
        const params = Object.fromEntries(candidate.keys.map((key, i) => [key, match[i + 1]]));
        const result = await candidate.handler({ req, res, url, params, ip: clientIp(req) });
        if (!res.headersSent && result !== undefined) sendJson(res, 200, result);
        return;
      }
      if (pathExists) throw new HttpError(405, "Method not allowed.");
      if (method === "GET") {
        const page = PAGES[pathname.replace(/\/+$/, "") || "/"];
        if (page) return sendPage(req, res, page);
        const upload = UPLOAD_FILE.exec(pathname);
        if (upload && serveFile(req, res, UPLOAD_DIR, upload[1], { cacheControl: "public, max-age=31536000, immutable" })) return;
        // Images and fonts rarely change, so browsers may keep them for a day; CSS and JS are checked each visit.
        const cacheControl = /\.(png|jpe?g|webp|svg|ico|woff2)$/i.test(pathname) ? "public, max-age=86400" : "no-cache";
        if (!pathname.startsWith("/api/") && serveFile(req, res, PUBLIC_DIR, pathname.slice(1), { cacheControl })) return;
      }
      throw new HttpError(404, "Not found.");
    } catch (error) {
      const status = error.status ?? 500;
      if (status >= 500) console.error(`Request failed: ${req.method} ${url.pathname}`, error);
      if (res.headersSent) {
        res.destroy();
        return;
      }
      // Messages written for customers (HttpError) are shown as they are; unexpected errors stay generic.
      const message = status >= 500 && !(error instanceof HttpError) ? "Something went wrong. Please try again." : error.message;
      if (pathname?.startsWith("/api/") || String(req.headers.accept).includes("application/json")) sendJson(res, status, { error: message });
      else sendBuffer(res, status, status === 404 ? notFoundPage : Buffer.from(message), status === 404 ? "text/html; charset=utf-8" : "text/plain; charset=utf-8");
    }
  };
}
