import { createHmac, randomBytes } from "node:crypto";
import { all, one, run } from "./db.js";
import { badRequest, bool, notFound, nowIso, optionalId, str } from "./util.js";

export const EVENTS = [
  "sale.completed",
  "sale.refunded",
  "stock.received",
  "stock.adjusted",
  "stock.low",
  "stock.expiring",
  "stock.transfer",
  "shift.opened",
  "shift.closed",
  "daily.summary",
  "product.updated",
  "branch.updated"
];

const RETRY_MINUTES = [1, 5, 15, 60, 240, 720];
let kick = null;

/** Lets the server start delivery right after something is emitted. */
export function onEmit(fn) {
  kick = fn;
}

/** Queues an event for every matching webhook. Safe to call inside a transaction. */
export function emit(db, event, data, branchId = null) {
  const hooks = all(db, "SELECT * FROM webhooks WHERE active = 1 AND (branch_id IS NULL OR branch_id IS ?)", branchId);
  let queued = 0;
  for (const hook of hooks) {
    const events = hook.events.split(",").map((e) => e.trim());
    if (!events.includes("*") && !events.includes(event)) continue;
    const payload = {
      id: `evt_${randomBytes(12).toString("hex")}`,
      event,
      created_at: nowIso(),
      branch_id: branchId,
      data
    };
    run(
      db,
      "INSERT INTO webhook_deliveries(webhook_id, event, payload, next_attempt_at, created_at) VALUES (?, ?, ?, ?, ?)",
      hook.id,
      event,
      JSON.stringify(payload),
      nowIso(),
      nowIso()
    );
    queued += 1;
  }
  if (queued && kick) setImmediate(kick);
  return queued;
}

export function signPayload(secret, timestamp, body) {
  return `sha256=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
}

let processing = false;

/** Sends due deliveries. Retries with back-off; gives up after the last retry. */
export async function processDeliveries(db, { fetchImpl = globalThis.fetch, limit = 25 } = {}) {
  if (processing) return 0;
  processing = true;
  let sent = 0;
  try {
    const due = all(
      db,
      `SELECT d.*, w.url, w.secret FROM webhook_deliveries d JOIN webhooks w ON w.id = d.webhook_id
        WHERE d.status = 'pending' AND d.next_attempt_at <= ? AND w.active = 1
        ORDER BY d.id LIMIT ?`,
      nowIso(),
      limit
    );
    for (const delivery of due) {
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const body = delivery.payload;
      let statusCode = null;
      let error = "";
      try {
        const response = await fetchImpl(delivery.url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "user-agent": "StorePOS-Webhooks/1.0",
            "x-store-event": delivery.event,
            "x-store-delivery": String(delivery.id),
            "x-store-timestamp": timestamp,
            "x-store-signature": signPayload(delivery.secret, timestamp, body)
          },
          body,
          signal: AbortSignal.timeout(10_000)
        });
        statusCode = response.status;
        if (!response.ok) error = `HTTP ${response.status}`;
      } catch (err) {
        error = err.name === "TimeoutError" ? "Timed out after 10s" : err.message;
      }
      const attempts = delivery.attempts + 1;
      if (!error) {
        run(db, "UPDATE webhook_deliveries SET status='delivered', attempts=?, last_status_code=?, last_error='', delivered_at=? WHERE id=?", attempts, statusCode, nowIso(), delivery.id);
        sent += 1;
      } else if (attempts > RETRY_MINUTES.length) {
        run(db, "UPDATE webhook_deliveries SET status='failed', attempts=?, last_status_code=?, last_error=? WHERE id=?", attempts, statusCode, error.slice(0, 300), delivery.id);
      } else {
        const next = new Date(Date.now() + RETRY_MINUTES[attempts - 1] * 60_000).toISOString();
        run(db, "UPDATE webhook_deliveries SET attempts=?, last_status_code=?, last_error=?, next_attempt_at=? WHERE id=?", attempts, statusCode, error.slice(0, 300), next, delivery.id);
      }
    }
  } finally {
    processing = false;
  }
  return sent;
}

// ---- management --------------------------------------------------------------------

function hookFields(data, existing = {}) {
  const url = str(data.url ?? existing.url, "url", { required: true, max: 500 });
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw badRequest("url must be a full http(s) URL", "VALIDATION");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) throw badRequest("url must start with http:// or https://", "VALIDATION");
  let events = data.events ?? existing.events ?? "*";
  if (Array.isArray(events)) events = events.join(",");
  events = String(events)
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);
  if (!events.length) events = ["*"];
  for (const e of events) if (e !== "*" && !EVENTS.includes(e)) throw badRequest(`Unknown event: ${e}`, "VALIDATION");
  return {
    url,
    events: events.join(","),
    branch_id: data.branch_id === undefined ? existing.branch_id ?? null : optionalId(data.branch_id, "branch_id"),
    active: data.active === undefined ? existing.active ?? 1 : bool(data.active) ? 1 : 0,
    description: str(data.description ?? existing.description, "description", { max: 200 })
  };
}

export function listWebhooks(db) {
  return all(
    db,
    `SELECT w.id, w.url, w.events, w.branch_id, w.active, w.description, w.created_at,
            (SELECT COUNT(*) FROM webhook_deliveries d WHERE d.webhook_id = w.id AND d.status = 'failed') AS failed_count,
            (SELECT MAX(delivered_at) FROM webhook_deliveries d WHERE d.webhook_id = w.id) AS last_delivered_at
       FROM webhooks w ORDER BY w.id`
  );
}

export function createWebhook(db, data) {
  const f = hookFields(data);
  const secret = `whsec_${randomBytes(24).toString("base64url")}`;
  const { id } = run(
    db,
    "INSERT INTO webhooks(url, secret, events, branch_id, active, description, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    f.url,
    secret,
    f.events,
    f.branch_id,
    f.active,
    f.description,
    nowIso()
  );
  return { ...one(db, "SELECT id, url, events, branch_id, active, description, created_at FROM webhooks WHERE id = ?", id), secret };
}

export function updateWebhook(db, id, data) {
  const existing = one(db, "SELECT * FROM webhooks WHERE id = ?", id);
  if (!existing) throw notFound("Webhook");
  const f = hookFields(data, existing);
  run(db, "UPDATE webhooks SET url=?, events=?, branch_id=?, active=?, description=? WHERE id=?", f.url, f.events, f.branch_id, f.active, f.description, id);
  return one(db, "SELECT id, url, events, branch_id, active, description, created_at FROM webhooks WHERE id = ?", id);
}

export function deleteWebhook(db, id) {
  if (!run(db, "DELETE FROM webhooks WHERE id = ?", id).changes) throw notFound("Webhook");
}

export function listDeliveries(db, { webhookId = null, limit = 100 } = {}) {
  return all(
    db,
    `SELECT id, webhook_id, event, status, attempts, last_status_code, last_error, created_at, delivered_at, next_attempt_at
       FROM webhook_deliveries WHERE (? IS NULL OR webhook_id = ?) ORDER BY id DESC LIMIT ?`,
    webhookId,
    webhookId,
    Math.min(limit, 500)
  );
}

export function retryDelivery(db, id) {
  if (!run(db, "UPDATE webhook_deliveries SET status='pending', next_attempt_at=? WHERE id=?", nowIso(), id).changes) throw notFound("Delivery");
  if (kick) setImmediate(kick);
}

export function sendTestEvent(db, id) {
  const hook = one(db, "SELECT * FROM webhooks WHERE id = ?", id);
  if (!hook) throw notFound("Webhook");
  const payload = { id: `evt_${randomBytes(12).toString("hex")}`, event: "webhook.test", created_at: nowIso(), branch_id: hook.branch_id, data: { message: "Test event from your store system" } };
  run(
    db,
    "INSERT INTO webhook_deliveries(webhook_id, event, payload, next_attempt_at, created_at) VALUES (?, 'webhook.test', ?, ?, ?)",
    id,
    JSON.stringify(payload),
    nowIso(),
    nowIso()
  );
  if (kick) setImmediate(kick);
}
