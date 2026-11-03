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
  console.warn(`ADMIN_TOKEN is not set. Temporary setup/master key for this run: ${adminToken}`);
  console.warn("Set ADMIN_TOKEN in your environment before going live.");
}

const env = process.env;
const app = await createApp({
  dataDir: env.DATA_DIR,
  adminToken,
  trustProxy: env.TRUST_PROXY === "1",
  whatsapp: {
    accessToken: env.WHATSAPP_ACCESS_TOKEN,
    phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
    appSecret: env.WHATSAPP_APP_SECRET,
    verifyToken: env.WHATSAPP_VERIFY_TOKEN,
    apiVersion: env.WHATSAPP_API_VERSION
  }
});
const wa = app.whatsapp.status();
console.log(wa.configured ? `WhatsApp Cloud API connected (number …${wa.phoneNumberId.slice(-4)}).` : "WhatsApp Cloud API not configured: click-to-chat buttons only.");

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
