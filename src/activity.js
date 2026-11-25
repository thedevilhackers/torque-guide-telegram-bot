import { randomUUID } from "node:crypto";
import { transact } from "./db.js";

// The admin panel's activity log: who did what, and when. Newest first, the last 3,000 entries.
const MAX_ENTRIES = 3000;

export function logActivity(user, action, { link = "", ip = "" } = {}) {
  const entry = { id: randomUUID(), at: new Date().toISOString(), user: user?.name ?? "", username: user?.username ?? "", role: user?.role ?? "", action: String(action).slice(0, 300), link, ip };
  transact((data) => {
    data.activity.unshift(entry);
    if (data.activity.length > MAX_ENTRIES) data.activity.length = MAX_ENTRIES;
  });
  return entry;
}
