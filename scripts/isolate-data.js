// Preloaded by `npm test`: every test process gets its own empty data directory, so tests never
// read or change a real database.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "unity-test-"));
