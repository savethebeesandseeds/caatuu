import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const compose = await readFile(
  new URL("../../../../compose.yaml", import.meta.url),
  "utf8"
);

test("the shared tunnel can switch transports and reports real edge readiness", () => {
  assert.match(compose, /cloudflared tunnel --protocol auto\b/);
  assert.match(compose, /--metrics 127\.0\.0\.1:20241\b/);
  assert.match(compose, /healthcheck:[\s\S]*127\.0\.0\.1:20241\/ready/);
  assert.doesNotMatch(compose, /cloudflared tunnel --protocol http2\b/);
});

test("the shared tunnel restarts after a sustained loss of every edge connection", () => {
  assert.match(compose, /failure_count=\$\$\(\(failure_count \+ 1\)\)/);
  assert.match(compose, /failure_count\}" -ge 6/);
  assert.match(compose, /no ready edge connection for 60 seconds/);
  assert.match(compose, /wait -n[^\n]*watchdog_pid/);
  assert.match(compose, /restart: unless-stopped/);
});
