import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR, db } from "./db.js";

// Automatic backups on the server: one a day (and one before any restore), kept for the last 14,
// in DATA_DIR/backups. The owner can download or restore them from Admin → Backup.

export const BACKUP_DIR = join(DATA_DIR, "backups");
const KEEP = 14;
const NAME = /^unity-backup-\d{4}-\d{2}-\d{2}-\d{4}(-[a-z]+)?\.json$/;

export const isBackupName = (name) => NAME.test(String(name ?? ""));

export function listBackups() {
  let names = [];
  try {
    names = readdirSync(BACKUP_DIR).filter(isBackupName);
  } catch {
    return [];
  }
  return names
    .map((name) => {
      const { size, mtime } = statSync(join(BACKUP_DIR, name));
      return { name, size, createdAt: mtime.toISOString(), kind: /-([a-z]+)\.json$/.exec(name)?.[1] ?? "daily" };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.name.localeCompare(a.name));
}

// kind: "" for the daily backup, or a word such as "manual" or "restore".
export function writeBackup(kind = "") {
  mkdirSync(BACKUP_DIR, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
  const name = `unity-backup-${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}-${stamp.slice(8, 12)}${kind ? `-${kind}` : ""}.json`;
  writeFileSync(join(BACKUP_DIR, name), JSON.stringify(db()), { mode: 0o600 });
  // Old backups beyond the newest 14 are removed.
  for (const old of listBackups().slice(KEEP)) rmSync(join(BACKUP_DIR, old.name), { force: true });
  return name;
}

export function readBackup(name) {
  if (!isBackupName(name)) throw new Error("Unknown backup.");
  return readFileSync(join(BACKUP_DIR, name));
}

export function startAutoBackups() {
  const today = () => new Date().toISOString().slice(0, 10);
  const run = () => {
    try {
      if (!listBackups().some((backup) => backup.kind === "daily" && backup.createdAt.slice(0, 10) === today())) writeBackup();
    } catch (error) {
      console.error("Automatic backup failed:", error.message);
    }
  };
  run();
  setInterval(run, 60 * 60_000).unref();
}
