import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// A sessions file cut off mid-write, as after a crash or a full disk.
const file = join(process.env.DATA_DIR, "sessions.json");
mkdirSync(process.env.DATA_DIR, { recursive: true });
writeFileSync(file, '{"sessions": {"1": {"vehicle"');
const { getSession, setSession } = await import("../src/store.js");

test("a damaged sessions file is set aside instead of stopping the server", () => {
  assert.deepEqual(getSession("1"), {});
  assert.ok(existsSync(`${file}.damaged`));
  setSession("2", { stage: 2 });
  assert.equal(JSON.parse(readFileSync(file, "utf8")).sessions["2"].stage, 2);
  assert.ok(!existsSync(`${file}.tmp`), "saves go through a temporary file");
});
