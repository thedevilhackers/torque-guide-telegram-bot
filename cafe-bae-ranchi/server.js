import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { createApp } from "./src/app.js";

// Load a local .env file if present (no dependency needed).
try {
  for (const line of readFileSync(new URL("./.env", import.meta.url), "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

const port = Number(process.env.PORT) || 3000;
let adminToken = process.env.ADMIN_TOKEN;
if (!adminToken) {
  adminToken = crypto.randomBytes(18).toString("base64url");
  console.warn(`ADMIN_TOKEN is not set. Temporary admin token for this run: ${adminToken}`);
  console.warn("Set ADMIN_TOKEN in your environment before going live.");
}

const app = await createApp({
  dataDir: process.env.DATA_DIR,
  adminToken,
  trustProxy: process.env.TRUST_PROXY === "1"
});

app.server.listen(port, () => {
  console.log(`Cafe BAE website running at http://localhost:${port}`);
  console.log(`Admin dashboard: http://localhost:${port}/admin`);
});

const shutdown = async (signal) => {
  console.log(`${signal} received, shutting down.`);
  await app.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
