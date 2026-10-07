import { createReadStream, statSync } from "node:fs";
import { extname, resolve, sep } from "node:path";

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".glb": "model/gltf-binary",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json"
};

const SECURITY_HEADERS = {
  "Content-Security-Policy":
    "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(), microphone=(), payment=(), geolocation=(self)",
  "Cross-Origin-Opener-Policy": "same-origin"
};

export const isHttps = (req) => req.headers["x-forwarded-proto"] === "https" || Boolean(req.socket.encrypted);

export function applySecurityHeaders(req, res) {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);
  if (isHttps(req)) res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
}

// The right-most X-Forwarded-For entry is the one added by the hosting proxy, so it can't be spoofed.
export function clientIp(req) {
  const forwarded = String(req.headers["x-forwarded-for"] ?? "").split(",").map((part) => part.trim()).filter(Boolean);
  return forwarded.at(-1) || req.socket.remoteAddress || "unknown";
}

export function sendJson(res, status, body, headers = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": CONTENT_TYPES[".json"], "Cache-Control": "no-store", "Content-Length": Buffer.byteLength(payload), ...headers });
  res.end(payload);
}

export function sendBuffer(res, status, buffer, contentType, headers = {}) {
  res.writeHead(status, { "Content-Type": contentType, "Content-Length": buffer.length, ...headers });
  res.end(buffer);
}

// Requiring a JSON content type means cross-site forms can't post here, and cross-site scripts
// would need a CORS preflight, which this server never grants.
// A request with no body at all (e.g. a button that just triggers an action) reads as {}.
export async function readJson(req, limit = 1_000_000) {
  if (req.headers["content-length"] === "0" || (!req.headers["content-length"] && !req.headers["transfer-encoding"])) return {};
  if (!String(req.headers["content-type"] ?? "").startsWith("application/json")) throw new HttpError(415, "Send JSON.");
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, "That upload is too large.");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw new HttpError(400, "The request wasn't valid JSON.");
  }
}

export function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

// Serves a file from root, refusing any path that escapes it. Returns false if there is no such file.
export function serveFile(req, res, root, relativePath, { cacheControl = "no-cache", contentType } = {}) {
  const base = resolve(root);
  const filePath = resolve(base, `.${sep}${relativePath}`);
  if (!filePath.startsWith(base + sep)) return false;
  let stats;
  try {
    stats = statSync(filePath);
  } catch {
    return false;
  }
  if (!stats.isFile()) return false;
  const type = contentType ?? CONTENT_TYPES[extname(filePath).toLowerCase()];
  if (!type) return false;
  const etag = `"${stats.size.toString(16)}-${Math.floor(stats.mtimeMs).toString(16)}"`;
  const headers = { "Content-Type": type, "Cache-Control": cacheControl, ETag: etag, "Last-Modified": stats.mtime.toUTCString() };
  if (req.headers["if-none-match"] === etag) {
    res.writeHead(304, headers);
    res.end();
    return true;
  }
  res.writeHead(200, { ...headers, "Content-Length": stats.size });
  if (req.method === "HEAD") res.end();
  // A file removed between the check above and the read would otherwise crash the server.
  else createReadStream(filePath).on("error", () => res.destroy()).pipe(res);
  return true;
}

// Sliding-window limiter. hit(key) records a request and returns false once key has used max
// requests in windowMs; blocked(key) checks without recording.
export function rateLimiter({ windowMs, max }) {
  const hits = new Map();
  const recent = (key, now) => (hits.get(key) ?? []).filter((time) => now - time < windowMs);
  return {
    blocked: (key) => recent(key, Date.now()).length >= max,
    hit(key) {
      const now = Date.now();
      if (hits.size > 10_000) {
        for (const [entry, times] of hits) if (now - times.at(-1) > windowMs) hits.delete(entry);
      }
      const times = recent(key, now);
      const allowed = times.length < max;
      if (allowed) times.push(now);
      hits.set(key, times);
      return allowed;
    }
  };
}
