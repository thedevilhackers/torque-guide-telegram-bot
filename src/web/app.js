import { fileURLToPath } from "node:url";
import { UPLOAD_DIR, registerAdminRoutes } from "./admin-api.js";
import { HttpError, applySecurityHeaders, clientIp, sendBuffer, sendJson, serveFile } from "./http.js";
import { registerPublicRoutes } from "./public-api.js";

const PUBLIC_DIR = fileURLToPath(new URL("../../public/", import.meta.url));
const PAGES = { "/": "index.html", "/shop": "shop.html", "/admin": "admin/index.html" };
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

// Handlers return a value to send it as JSON, or write to res themselves.
export function createApp({ botUsername = () => "", sendAlert = null } = {}) {
  const routes = [];
  const route = (method, path, handler) => routes.push({ method, handler, ...compile(path) });
  registerPublicRoutes(route, { botUsername });
  registerAdminRoutes(route, { botUsername, sendAlert });

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
        if (page && serveFile(req, res, PUBLIC_DIR, page)) return;
        const upload = UPLOAD_FILE.exec(pathname);
        if (upload && serveFile(req, res, UPLOAD_DIR, upload[1], { cacheControl: "public, max-age=31536000, immutable" })) return;
        if (!pathname.startsWith("/api/") && serveFile(req, res, PUBLIC_DIR, pathname.slice(1))) return;
      }
      throw new HttpError(404, "Not found.");
    } catch (error) {
      const status = error.status ?? 500;
      if (status >= 500) console.error(`Request failed: ${req.method} ${url.pathname}`, error);
      if (res.headersSent) {
        res.destroy();
        return;
      }
      const message = status >= 500 ? "Something went wrong. Please try again." : error.message;
      if (pathname?.startsWith("/api/") || String(req.headers.accept).includes("application/json")) sendJson(res, status, { error: message });
      else sendBuffer(res, status, status === 404 ? notFoundPage : Buffer.from(message), status === 404 ? "text/html; charset=utf-8" : "text/plain; charset=utf-8");
    }
  };
}
