import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("overlapping report writes preserve SQLite uniqueness and the capacity limit", () => {
  // Node 22 requires this flag for its built-in SQLite module; no external
  // database or production binding is used by this schema-level regression.
  const result = spawnSync(process.execPath, [
    "--experimental-sqlite",
    fileURLToPath(new URL("./fixtures/sqlite-storage.mjs", import.meta.url))
  ], { encoding: "utf8", timeout: 30_000 });
  assert.equal(result.status, 0, result.error?.message || result.stderr || result.stdout);
});
