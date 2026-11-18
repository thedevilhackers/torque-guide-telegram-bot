import { all, one, run, tx } from "./db.js";
import { purgeExpiredSessions } from "./auth.js";
import { stockAlerts } from "./inventory.js";
import { dailySummary } from "./reports.js";
import { emit, onEmit, processDeliveries } from "./webhooks.js";
import { addDays, businessDate, nowIso } from "./util.js";

/**
 * Once per branch per day (after local midnight): sends the previous day's `daily.summary`
 * and a `stock.expiring` digest for the new day.
 */
export function runDailyJobs(db, now = new Date()) {
  let emitted = 0;
  for (const branch of all(db, "SELECT * FROM branches WHERE active = 1")) {
    const today = businessDate(branch.timezone, now);
    const yesterday = addDays(today, -1);
    if (businessDate(branch.timezone, new Date(branch.created_at)) > yesterday) continue;
    const key = `daily:${branch.id}:${yesterday}`;
    if (one(db, "SELECT key FROM scheduled_runs WHERE key = ?", key)) continue;
    tx(db, () => {
      run(db, "INSERT INTO scheduled_runs(key, created_at) VALUES (?, ?)", key, nowIso());
      emitted += emit(db, "daily.summary", { branch: { id: branch.id, code: branch.code, name: branch.name, external_id: branch.external_id }, ...dailySummary(db, { branchId: branch.id, date: yesterday }) }, branch.id);
      const alerts = stockAlerts(db, { branchId: branch.id, today });
      if (alerts.expired.length || alerts.expiring.length) {
        emitted += emit(db, "stock.expiring", { date: today, counts: alerts.counts, expired: alerts.expired, expiring: alerts.expiring }, branch.id);
      }
    });
  }
  return emitted;
}

export function startScheduler(db, { intervalMs = 60_000, logger = console } = {}) {
  let lastPurge = 0;
  const deliver = () => processDeliveries(db).catch((error) => logger.error("[webhooks]", error));
  onEmit(deliver);
  const tick = async () => {
    try {
      if (Date.now() - lastPurge > 3600_000) {
        purgeExpiredSessions(db);
        lastPurge = Date.now();
      }
      runDailyJobs(db);
      await deliver();
    } catch (error) {
      logger.error("[scheduler]", error);
    }
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  setTimeout(tick, 1500).unref();
  return () => {
    clearInterval(timer);
    onEmit(null);
  };
}
