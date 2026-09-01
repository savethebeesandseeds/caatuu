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

function composeServiceBlock(source, serviceName) {
  const lines = source.replaceAll("\r\n", "\n").split("\n");
  const servicesStart = lines.indexOf("services:");
  assert.notEqual(servicesStart, -1, "Compose must define services");
  const servicesEnd = lines.findIndex(
    (line, index) => index > servicesStart && line.length > 0 && !line.startsWith(" "),
  );
  const serviceStart = lines.indexOf(`  ${serviceName}:`, servicesStart + 1);
  assert.ok(
    serviceStart > servicesStart && (servicesEnd === -1 || serviceStart < servicesEnd),
    `${serviceName} service must exist under Compose services`,
  );
  let serviceEnd = serviceStart + 1;
  while (
    serviceEnd < lines.length
    && (lines[serviceEnd].length === 0 || lines[serviceEnd].startsWith("    "))
  ) {
    serviceEnd += 1;
  }
  return lines.slice(serviceStart, serviceEnd).join("\n");
}

const tunnelService = composeServiceBlock(compose, "caatuu-tunnel");

test("the shared tunnel isolates app release from the optional game preview", () => {
  assert.match(tunnelService, /\.\/apps\/games:\/workspace\/apps\/games:ro/);
  assert.match(runtimeImage, /\n\s+nodejs \\/);
  assert.match(
    tunnelService,
    /release_gate\(\) \{[\s\S]*CAATUU_ENABLE_CAATUU_GAME_PREVIEW[\s\S]*node \/workspace\/apps\/games\/tooling\/check-release-readiness\.mjs[\s\S]*--repo-root \/workspace[\s\S]*--surface public-tunnel[\s\S]*--require-game caatuu-game[\s\S]*http:\/\/caatuu:9172\/games\/caatuu-game\/[\s\S]*404[\s\S]*\}/,
  );
  assert.match(tunnelService, /\n\s+\}\s+release_gate\s+socat TCP-LISTEN:9172/);
  assert.doesNotMatch(tunnelService, /\.games\[\]\.manifest/);
  assert.doesNotMatch(tunnelService, /\.dependencies\[\] \| select/);
});

test("the shared tunnel pins stable edge transport and DNS resolution", () => {
  assert.match(tunnelService, /cloudflared tunnel --protocol http2\b/);
  assert.match(
    tunnelService,
    /run --dns-resolver-addrs 1\.1\.1\.1:53 --dns-resolver-addrs 1\.0\.0\.1:53 --token-file/,
  );
  assert.match(tunnelService, /--metrics 127\.0\.0\.1:20241\b/);
  assert.match(tunnelService, /healthcheck:[\s\S]*127\.0\.0\.1:20241\/ready/);
  assert.doesNotMatch(
    tunnelService,
    /cloudflared tunnel --protocol (?:auto|quic)\b/,
  );
});

test("the Caatuu tunnel does not expose the retired Minerals admin origin", () => {
  assert.doesNotMatch(tunnelService, /TCP-LISTEN:7979/);
  assert.doesNotMatch(tunnelService, /shared_forward_pid/);
  assert.doesNotMatch(tunnelService, /host\.docker\.internal:host-gateway/);
});

test("the shared tunnel restarts after a sustained loss of every edge connection", () => {
  assert.match(tunnelService, /while kill -0[^\n]+tunnel_pid[\s\S]*if ! release_gate >\/dev\/null/);
  assert.match(tunnelService, /release readiness changed; stopping the connector/);
  assert.match(tunnelService, /failure_count=\$\$\(\(failure_count \+ 1\)\)/);
  assert.match(tunnelService, /failure_count\}" -ge 6/);
  assert.match(tunnelService, /no ready edge connection for 60 seconds/);
  assert.match(tunnelService, /wait -n[^\n]*watchdog_pid/);
  assert.match(tunnelService, /restart: unless-stopped/);
});
