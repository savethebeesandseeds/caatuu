import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const compose = await readFile(
  new URL("../../../../compose.yaml", import.meta.url),
  "utf8"
);
const runtimeImage = await readFile(
  new URL("../Dockerfile", import.meta.url),
  "utf8",
);

test("the shared tunnel uses the canonical fail-closed game release gate", () => {
  assert.match(compose, /\.\/apps\/games:\/workspace\/apps\/games:ro/);
  assert.match(runtimeImage, /\n\s+nodejs \\/);
  assert.match(
    compose,
    /release_gate\(\) \{[\s\S]*node \/workspace\/apps\/games\/tooling\/check-release-readiness\.mjs[\s\S]*--repo-root \/workspace[\s\S]*--surface public-tunnel[\s\S]*--require-game memory-moon[\s\S]*\}/,
  );
  assert.match(compose, /\n\s+\}\s+release_gate\s+socat TCP-LISTEN:9172/);
  assert.doesNotMatch(compose, /\.games\[\]\.manifest/);
  assert.doesNotMatch(compose, /\.dependencies\[\] \| select/);
});

test("the shared tunnel can switch transports and reports real edge readiness", () => {
  assert.match(compose, /cloudflared tunnel --protocol auto\b/);
  assert.match(compose, /--metrics 127\.0\.0\.1:20241\b/);
  assert.match(compose, /healthcheck:[\s\S]*127\.0\.0\.1:20241\/ready/);
  assert.doesNotMatch(compose, /cloudflared tunnel --protocol http2\b/);
});

test("the shared tunnel restarts after a sustained loss of every edge connection", () => {
  assert.match(compose, /while kill -0[^\n]+tunnel_pid[\s\S]*if ! release_gate >\/dev\/null/);
  assert.match(compose, /release readiness changed; stopping the connector/);
  assert.match(compose, /failure_count=\$\$\(\(failure_count \+ 1\)\)/);
  assert.match(compose, /failure_count\}" -ge 6/);
  assert.match(compose, /no ready edge connection for 60 seconds/);
  assert.match(compose, /wait -n[^\n]*watchdog_pid/);
  assert.match(compose, /restart: unless-stopped/);
});
