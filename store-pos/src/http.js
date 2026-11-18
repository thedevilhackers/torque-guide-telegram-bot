import { createReadStream, statSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import { resolveToken } from "./auth.js";
import { branchToday } from "./org.js";
import { HttpError, badRequest, businessDate, forbidden } from "./util.js";

const MAX_BODY = 6 * 1024 * 1024;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json"
};

export function createRouter() {
  const routes = [];
  const add = (method) => (path, handler, opts = {}) => {
    const keys = [];
    const pattern = path.replace(/:(\w+)/g, (_, key) => {
      keys.push(key);
      return "([^/]+)";
    });
    routes.push({ method, re: new RegExp(`^${pattern}/?$`), keys, handler, opts });
  };
  return {
    get: add("GET"),
    post: add("POST"),
    put: add("PUT"),
    patch: add("PATCH"),
    delete: add("DELETE"),
    match(method, pathname) {
      let pathMatched = false;
      for (const route of routes) {
        const m = route.re.exec(pathname);
        if (!m) continue;
        pathMatched = true;
        if (route.method !== method) continue;
        const params = Object.fromEntries(route.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
        return { route, params };
      }
      return pathMatched ? "METHOD" : null;
    }
  };
}

async function readJson(req) {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return {};
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new HttpError(413, "Request body is too large", "TOO_LARGE");
    chunks.push(chunk);
  }
  if (!size) return {};
  const text = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(text);
  } catch {
    throw badRequest("Request body must be valid JSON", "BAD_JSON");
  }
}

function send(res, status, body, headers = {}) {
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers });
  res.end(payload);
}

function bearer(req) {
  const header = req.headers.authorization ?? "";
  if (header.toLowerCase().startsWith("bearer ")) return header.slice(7).trim();
  return (req.headers["x-api-key"] ?? "").toString().trim() || null;
}

/** Works out which branch a request acts on, enforcing branch-scoped accounts and keys. */
function resolveBranch(db, principal, req, query, body) {
  const requested = req.headers["x-branch-id"] ?? query.branch_id ?? body?.branch_id;
  if (principal.branchId) {
    if (requested && requested !== "all" && Number(requested) !== principal.branchId) throw forbidden("You can only work in your own branch", "BRANCH_SCOPE");
    return principal.branchId;
  }
  if (!requested || requested === "all") return null;
  const id = Number(requested);
  if (!Number.isInteger(id) || id < 1) throw badRequest("branch_id is not valid", "VALIDATION");
  if (!db.prepare("SELECT id FROM branches WHERE id = ?").get(id)) throw badRequest("Branch does not exist", "VALIDATION");
  return id;
}

export function createHandler({ db, router, publicDir, sharedDir, corsOrigins = [], frameAncestors = "'self'", logger = console }) {
  const roots = [
    { prefix: "/shared/", dir: resolve(sharedDir) },
    { prefix: "/", dir: resolve(publicDir) }
  ];
  const securityHeaders = {
    "x-content-type-options": "nosniff",
    "referrer-policy": "same-origin",
    "content-security-policy": `frame-ancestors ${frameAncestors}`,
    "permissions-policy": "camera=(self)"
  };

  function serveStatic(req, res, pathname) {
    for (const { prefix, dir } of roots) {
      if (!pathname.startsWith(prefix)) continue;
      const rel = normalize(decodeURIComponent(pathname.slice(prefix.length)) || "index.html");
      const file = join(dir, rel);
      if (!file.startsWith(dir + sep) && file !== dir) break;
      let stat;
      try {
        stat = statSync(file);
      } catch {
        stat = null;
      }
      if (stat?.isFile()) {
        const ext = extname(file);
        res.writeHead(200, {
          ...securityHeaders,
          "content-type": MIME[ext] ?? "application/octet-stream",
          "content-length": stat.size,
          "cache-control": ext === ".html" ? "no-cache" : "public, max-age=300"
        });
        if (req.method === "HEAD") return res.end();
        return createReadStream(file).pipe(res);
      }
      if (prefix === "/shared/") break;
    }
    // Single-page app: unknown non-file paths get the app shell.
    if (!extname(pathname)) {
      const index = join(roots[1].dir, "index.html");
      res.writeHead(200, { ...securityHeaders, "content-type": MIME[".html"], "cache-control": "no-cache" });
      return createReadStream(index).pipe(res);
    }
    send(res, 404, { error: { message: "Not found", code: "NOT_FOUND" } });
  }

  return async function handle(req, res) {
    const url = new URL(req.url, "http://localhost");
    const origin = req.headers.origin;
    const corsHeaders = {};
    if (origin && (corsOrigins.includes("*") || corsOrigins.includes(origin))) {
      corsHeaders["access-control-allow-origin"] = origin;
      corsHeaders.vary = "Origin";
      corsHeaders["access-control-allow-headers"] = "authorization, content-type, x-api-key, x-branch-id";
      corsHeaders["access-control-allow-methods"] = "GET, POST, PUT, PATCH, DELETE, OPTIONS";
      corsHeaders["access-control-max-age"] = "600";
    }
    if (!url.pathname.startsWith("/api/")) {
      if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, { error: { message: "Method not allowed" } });
      return serveStatic(req, res, url.pathname);
    }
    if (req.method === "OPTIONS") {
      res.writeHead(204, corsHeaders);
      return res.end();
    }
    const started = Date.now();
    try {
      const match = router.match(req.method, url.pathname);
      if (match === "METHOD") throw new HttpError(405, "Method not allowed", "METHOD_NOT_ALLOWED");
      if (!match) throw new HttpError(404, "Unknown API endpoint", "NOT_FOUND");
      const { route, params } = match;
      const query = Object.fromEntries(url.searchParams);
      const body = await readJson(req);
      const ctx = { req, res, url, query, params, body, db, ip: req.socket.remoteAddress };
      if (route.opts.auth !== false) {
        const principal = resolveToken(db, bearer(req));
        if (!principal) throw new HttpError(401, "Sign in again (session expired or invalid API key)", "UNAUTHENTICATED");
        ctx.principal = principal;
        ctx.branchId = resolveBranch(db, principal, req, query, body);
        ctx.today = ctx.branchId ? branchToday(db, ctx.branchId) : businessDate("UTC");
      }
      const result = await route.handler(ctx);
      if (result && result.__raw) {
        res.writeHead(200, {
          ...corsHeaders,
          "content-type": result.type,
          "cache-control": "no-store",
          ...(result.filename ? { "content-disposition": `attachment; filename="${result.filename}"` } : {})
        });
        return res.end(result.body);
      }
      send(res, ctx.status ?? 200, result === undefined ? { ok: true } : result, corsHeaders);
    } catch (error) {
      let status = error instanceof HttpError ? error.status : 500;
      let message = error.message;
      let code = error.code;
      if (!(error instanceof HttpError)) {
        if (String(error.message).includes("constraint failed")) {
          status = 409;
          message = "That conflicts with existing data";
          code = "CONSTRAINT";
        } else {
          logger.error(`[api] ${req.method} ${url.pathname} failed:`, error);
          message = "Something went wrong on the server";
          code = "SERVER_ERROR";
        }
      }
      send(res, status, { error: { message, code, details: error.details } }, corsHeaders);
    } finally {
      if (process.env.LOG_REQUESTS === "1") logger.log(`${req.method} ${url.pathname} ${res.statusCode} ${Date.now() - started}ms`);
    }
  };
}
