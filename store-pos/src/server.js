import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { openDatabase } from "./db.js";
import { createHandler, createRouter } from "./http.js";
import { registerRoutes } from "./api.js";
import { startScheduler } from "./scheduler.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

function loadDotEnv() {
  try {
    for (const line of readFileSync(join(root, ".env"), "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

export function createApp({ dbPath = ":memory:", corsOrigins = [], frameAncestors = "'self'", logger = console } = {}) {
  const db = openDatabase(dbPath);
  const router = createRouter();
  registerRoutes(router, { version });
  const handler = createHandler({ db, router, publicDir: join(root, "public"), sharedDir: join(root, "shared"), corsOrigins, frameAncestors, logger });
  const server = createServer(handler);
  return { db, server, handler };
}

/** Starts the web server using the settings in .env / environment variables. */
export function main() {
  loadDotEnv();
  const port = Number(process.env.PORT) || 3000;
  const host = process.env.HOST || "0.0.0.0";
  const dbPath = process.env.DATABASE_PATH || join(root, "data", "store.db");
  const { db, server } = createApp({
    dbPath,
    corsOrigins: (process.env.CORS_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    frameAncestors: process.env.FRAME_ANCESTORS || "'self'"
  });
  const stopScheduler = startScheduler(db);
  server.on("error", (error) => {
    if (error.code === "EADDRINUSE") {
      console.error(`\nPort ${port} is already in use (Store POS may already be running in another window).`);
      console.error(`Close the other program, or use another port: put the line PORT=3001 in a file named .env in the store-pos folder.\n`);
    } else if (error.code === "EACCES") {
      console.error(`\nThis computer does not allow port ${port}. Use another port: put the line PORT=3001 in a file named .env in the store-pos folder.\n`);
    } else {
      console.error(error);
    }
    stopScheduler();
    db.close();
    process.exit(1);
  });
  server.listen(port, host, () => {
    console.log(`Store POS v${version} is running. Open http://localhost:${port} in your browser.`);
    console.log(`Database: ${dbPath}. Press Ctrl+C to stop.`);
  });
  const shutdown = () => {
    console.log("Shutting down...");
    stopScheduler();
    server.close(() => {
      db.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
