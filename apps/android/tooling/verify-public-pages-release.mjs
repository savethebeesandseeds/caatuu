#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { validatePagesCurrentReleaseDescriptor } from "./pages-current-release.mjs";

const modulePath = fileURLToPath(import.meta.url);
const moduleDirectory = dirname(modulePath);
const defaultDescriptorPath = resolve(moduleDirectory, "pages-current-release.json");
const defaultBaselinePath = resolve(moduleDirectory, "pages-baseline.json");
const sha256Pattern = /^[a-f0-9]{64}$/u;
const sourceRevisionPattern = /^[a-f0-9]{40}$/u;

function exactKeys(value, keys, label) {
  assert.ok(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort(), `${label} fields changed`);
}

function validatedPublicFile(value, expectedPath, expectedAliases, label) {
  exactKeys(value, ["sourcePath", "archivePath", "publicPaths", "bytes", "sha256"], label);
  assert.deepEqual(value.publicPaths, [expectedPath, ...expectedAliases], `${label} public paths changed`);
  assert.ok(Number.isSafeInteger(value.bytes) && value.bytes > 0, `${label} byte count is invalid`);
  assert.match(String(value.sha256 || ""), sha256Pattern, `${label} SHA-256 is invalid`);
  return {
    path: `/${expectedPath}`,
    aliases: expectedAliases.map((path) => `/${path}`),
    bytes: value.bytes,
    sha256: value.sha256,
  };
}

export function validatePublicBaselineDescriptor(value, currentDescriptor) {
  exactKeys(value, [
    "schemaName", "schemaVersion", "channel", "canonicalOrigin", "repository", "releaseArchive",
    "stable", "compatibility", "nativeSetup", "sourceOverrides", "retainedFiles", "retiredPublicRoutes",
  ], "Pages baseline descriptor");
  assert.equal(value.schemaName, "caatuu-pages-baseline");
  assert.equal(value.schemaVersion, 1);
  assert.equal(value.canonicalOrigin, currentDescriptor.canonicalOrigin);
  assert.equal(value.repository, currentDescriptor.repository);
  assert.equal(value.stable?.versionCode, currentDescriptor.baselineStableVersionCode);
  assert.equal(value.compatibility?.versionCode, currentDescriptor.compatibilityVersionCode);
  assert.match(String(value.stable?.versionName || ""), /^[0-9A-Za-z][0-9A-Za-z._+-]{0,63}$/u);
  assert.match(String(value.compatibility?.versionName || ""), /^[0-9A-Za-z][0-9A-Za-z._+-]{0,63}$/u);
  assert.match(String(value.stable?.sourceRevision || ""), sourceRevisionPattern);
  assert.match(String(value.compatibility?.sourceRevision || ""), sourceRevisionPattern);
  const stablePrefix = `android/releases/${value.stable.versionCode}`;
  const compatibilityPrefix = `android/debug-releases/product-transition/${value.compatibility.versionCode}`;
  return {
    stable: {
      versionCode: value.stable.versionCode,
      versionName: value.stable.versionName,
      sourceRevision: value.stable.sourceRevision,
      manifest: validatedPublicFile(value.stable.manifest, `${stablePrefix}/caatuu.json`, ["android/caatuu.json"], "baseline stable manifest"),
      apk: validatedPublicFile(value.stable.apk, `${stablePrefix}/caatuu.apk`, ["android/caatuu.apk"], "baseline stable APK"),
    },
    compatibility: {
      versionCode: value.compatibility.versionCode,
      versionName: value.compatibility.versionName,
      sourceRevision: value.compatibility.sourceRevision,
      compatibility: true,
      manifest: validatedPublicFile(
        value.compatibility.manifest,
        `${compatibilityPrefix}/caatuu-transition.json`,
        ["android/caatuu-debug.json"],
        "baseline compatibility manifest",
      ),
      apk: validatedPublicFile(
        value.compatibility.apk,
        `${compatibilityPrefix}/caatuu-transition.apk`,
        ["android/caatuu-debug.apk"],
        "baseline compatibility APK",
      ),
    },
  };
}

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function requestHeaders(extra = {}) {
  return {
    accept: "*/*",
    "cache-control": "no-cache, no-store",
    pragma: "no-cache",
    ...extra,
  };
}

function withRequestTimeout(fetchImpl, requestTimeoutMs) {
  return async (origin, path, extra, consume) => {
    const controller = new AbortController();
    const timeoutError = new Error(`${path} request timed out after ${requestTimeoutMs}ms`);
    let timedOut = false;
    let timer;
    const timeout = new Promise((_resolve, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(timeoutError);
      }, requestTimeoutMs);
    });
    const operation = (async () => {
      const response = await fetchImpl(new URL(path, origin), {
        method: "GET",
        redirect: "follow",
        cache: "no-store",
        headers: requestHeaders(extra.headers),
        signal: controller.signal,
      });
      assert.ok(response && typeof response.status === "number", `${path} returned no HTTP response`);
      if (response.url) {
        assert.equal(new URL(response.url).origin, new URL(origin).origin, `${path} redirected away from the canonical origin`);
      }
      return await consume(response);
    })();
    try {
      return await Promise.race([operation, timeout]);
    } catch (error) {
      if (timedOut) throw timeoutError;
      throw error;
    } finally {
      clearTimeout(timer);
    }
  };
}

async function responseBytes(response, path) {
  assert.ok(response.ok, `${path} returned HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function exactBytes(request, origin, record, label) {
  return request(origin, record.path, { headers: { accept: "application/octet-stream" } }, async (response) => {
    const bytes = await responseBytes(response, record.path);
    assert.equal(bytes.length, record.bytes, `${label} byte count changed`);
    assert.equal(digest(bytes), record.sha256, `${label} SHA-256 changed`);
    return bytes;
  });
}

async function exactJson(request, origin, record, label) {
  const bytes = await exactBytes(request, origin, record, label);
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new Error(`${label} is not valid JSON`, { cause: error });
  }
  return { bytes, value };
}

function validateAndroidManifest(value, channel, label, currentDescriptor) {
  assert.equal(value.schema_version, 1, `${label} schema changed`);
  assert.equal(value.package_name, "com.waajacu.caatuu", `${label} package changed`);
  assert.equal(value.version_code, channel.versionCode, `${label} versionCode changed`);
  assert.equal(value.version_name, channel.versionName, `${label} versionName changed`);
  assert.equal(value.source_revision, channel.sourceRevision, `${label} source revision changed`);
  assert.equal(value.bytes, channel.apk.bytes, `${label} APK byte count changed`);
  assert.equal(value.sha256, channel.apk.sha256, `${label} APK SHA-256 changed`);
  assert.match(String(value.signer_certificate_sha256 || ""), sha256Pattern, `${label} signer digest changed`);
  const apkUrl = new URL(value.apk_url);
  assert.equal(apkUrl.origin, currentDescriptor.canonicalOrigin, `${label} APK origin changed`);
  assert.equal(apkUrl.pathname, channel.apk.path, `${label} APK URL changed`);
  assert.equal(apkUrl.search, "", `${label} APK URL gained a query`);
  assert.equal(apkUrl.hash, "", `${label} APK URL gained a fragment`);
  assert.equal(apkUrl.href, new URL(channel.apk.path, currentDescriptor.canonicalOrigin).href, `${label} APK URL is not canonical`);
  assert.equal(
    value.source_url,
    `https://github.com/${currentDescriptor.repository}/tree/${channel.sourceRevision}`,
    `${label} source URL changed`,
  );
  if (channel.compatibility) {
    assert.equal(value.profile, "product-transition", `${label} profile changed`);
    assert.equal(value.channel, "legacy-update-bridge", `${label} channel changed`);
    assert.equal(value.build_type, "debug", `${label} build type changed`);
    assert.equal(value.debuggable, true, `${label} debug state changed`);
    assert.equal(
      value.stable_manifest_url,
      `${currentDescriptor.canonicalOrigin}/android/caatuu.json`,
      `${label} stable manifest URL changed`,
    );
  } else {
    assert.equal(value.profile, "product", `${label} profile changed`);
    assert.equal(value.channel, "stable", `${label} channel changed`);
    assert.equal(value.build_type, "release", `${label} build type changed`);
    assert.equal(value.debuggable, false, `${label} became debuggable`);
  }
}

async function rangedFile(request, origin, record, label) {
  return request(origin, record.path, {
    headers: { accept: "application/octet-stream", "accept-encoding": "identity", range: "bytes=0-0" },
  }, async (response) => {
    const encoding = response.headers.get("content-encoding");
    assert.ok(!encoding || encoding.toLowerCase() === "identity", `${label} was transformed in transit`);
    if (response.status === 206) {
      assert.equal(response.headers.get("content-range"), `bytes 0-0/${record.bytes}`, `${label} range size changed`);
      const bytes = Buffer.from(await response.arrayBuffer());
      assert.equal(bytes.length, 1, `${label} did not return the requested byte`);
      return;
    }
    assert.equal(response.status, 200, `${label} range check returned HTTP ${response.status}`);
    const contentLength = response.headers.get("content-length");
    if (contentLength !== null) {
      assert.equal(Number(contentLength), record.bytes, `${label} full-response size changed`);
      await response.body?.cancel();
      return;
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(bytes.length, record.bytes, `${label} fallback byte count changed`);
    assert.equal(digest(bytes), record.sha256, `${label} fallback SHA-256 changed`);
  });
}

function inventoryRecord(bundle, path, record, label) {
  const matches = bundle.files.filter((file) => file.path === path.replace(/^\//u, ""));
  assert.equal(matches.length, 1, `${label} is missing from the web bundle inventory`);
  assert.equal(matches[0].bytes, record.bytes, `${label} inventory byte count changed`);
  assert.equal(matches[0].sha256, record.sha256, `${label} inventory SHA-256 changed`);
}

function overlayChannel(release) {
  return {
    versionCode: release.versionCode,
    versionName: release.versionName,
    sourceRevision: release.sourceRevision,
    manifest: { path: `/${release.manifest.publicPaths[0]}`, bytes: release.manifest.bytes, sha256: release.manifest.sha256 },
    apk: { path: `/${release.apk.publicPaths[0]}`, bytes: release.apk.bytes, sha256: release.apk.sha256 },
  };
}

async function htmlEntrypoint(request, origin, path) {
  return request(origin, path, { headers: { accept: "text/html" } }, async (response) => {
    const bytes = await responseBytes(response, path);
    const contentType = response.headers.get("content-type") || "";
    assert.match(contentType, /^text\/html\b/iu, `${path} is not HTML`);
    assert.match(bytes.toString("utf8"), /<!doctype html|<html\b/iu, `${path} returned no HTML document`);
  });
}

async function publicBundle(request, origin, current, baseline) {
  return request(origin, "/caatuu-web-bundle.json", { headers: { accept: "application/json" } }, async (response) => {
    const raw = await responseBytes(response, "/caatuu-web-bundle.json");
    const bundle = JSON.parse(raw.toString("utf8"));
    assert.equal(bundle.schema_name, "caatuu-web-bundle");
    assert.equal(bundle.schema_version, 1);
    assert.equal(bundle.canonicalOrigin, current.canonicalOrigin);
    assert.equal(bundle.currentAndroidRelease?.tag, current.githubRelease.tag);
    assert.equal(bundle.android?.stableVersionCode, current.stable.versionCode);
    assert.equal(bundle.android?.stableVersionName, current.stable.versionName);
    assert.equal(bundle.android?.previousStableVersionCode, current.previousStableVersionCode);
    assert.equal(bundle.android?.compatibilityVersionCode, current.compatibilityVersionCode);
    assert.ok(Array.isArray(bundle.files), "The web bundle has no file inventory");

    for (const channel of [baseline.stable, baseline.compatibility, ...current.releases.map(overlayChannel)]) {
      inventoryRecord(bundle, channel.manifest.path, channel.manifest, `Android ${channel.versionCode} manifest`);
      inventoryRecord(bundle, channel.apk.path, channel.apk, `Android ${channel.versionCode} APK`);
    }
    for (const alias of baseline.compatibility.manifest.aliases) {
      inventoryRecord(bundle, alias, baseline.compatibility.manifest, "compatibility Android manifest alias");
    }
    for (const alias of baseline.compatibility.apk.aliases) {
      inventoryRecord(bundle, alias, baseline.compatibility.apk, "compatibility Android APK alias");
    }
    const stable = overlayChannel(current.stable);
    inventoryRecord(bundle, "/android/caatuu.json", stable.manifest, "stable Android manifest alias");
    inventoryRecord(bundle, "/android/caatuu.apk", stable.apk, "stable Android APK alias");
    return bundle;
  });
}

async function reportingHealth(request, origin) {
  return request(origin, "/api/reporting/health", { headers: { accept: "application/json" } }, async (response) => {
    const bytes = await responseBytes(response, "/api/reporting/health");
    const value = JSON.parse(bytes.toString("utf8"));
    exactKeys(value, ["ok", "ready", "version"], "Reporting health response");
    assert.equal(value.ok, true);
    assert.equal(value.ready, true);
    assert.match(String(value.version || ""), /^20\d{2}-\d{2}-\d{2}\.v[1-9][0-9]*$/u);
    return value;
  });
}

export async function verifyPublicPagesReleaseOnce({
  descriptor,
  baselineDescriptor,
  fetchImpl = globalThis.fetch,
  requestTimeoutMs = 30_000,
}) {
  assert.equal(typeof fetchImpl, "function", "A fetch implementation is required");
  assert.ok(
    Number.isSafeInteger(requestTimeoutMs) && requestTimeoutMs >= 1 && requestTimeoutMs <= 120_000,
    "requestTimeoutMs is invalid",
  );
  const current = validatePagesCurrentReleaseDescriptor(descriptor);
  const baseline = validatePublicBaselineDescriptor(baselineDescriptor, current);
  const origin = current.canonicalOrigin;
  const timedFetch = withRequestTimeout(fetchImpl, requestTimeoutMs);

  // Keep stale-cache checks cheap. Full current APK verification happens only
  // after the Pages metadata, immutable manifests, old routes, and Worker agree.
  for (const path of ["/", "/cz/", "/zh/"]) await htmlEntrypoint(timedFetch, origin, path);
  await publicBundle(timedFetch, origin, current, baseline);

  const channels = [baseline.stable, baseline.compatibility, ...current.releases.map(overlayChannel)];
  for (const channel of channels) {
    const label = `Android ${channel.versionCode}`;
    const manifest = await exactJson(timedFetch, origin, channel.manifest, `${label} immutable manifest`);
    validateAndroidManifest(manifest.value, channel, `${label} immutable manifest`, current);
  }

  for (const alias of baseline.compatibility.manifest.aliases) {
    const manifest = await exactJson(
      timedFetch,
      origin,
      { ...baseline.compatibility.manifest, path: alias },
      "compatibility Android manifest alias",
    );
    validateAndroidManifest(manifest.value, baseline.compatibility, "compatibility Android manifest alias", current);
  }

  const stable = overlayChannel(current.stable);
  const stableManifest = await exactJson(
    timedFetch,
    origin,
    { ...stable.manifest, path: "/android/caatuu.json" },
    "stable Android manifest alias",
  );
  validateAndroidManifest(stableManifest.value, stable, "stable Android manifest alias", current);

  for (const channel of channels.filter((channel) => channel.versionCode !== current.stable.versionCode)) {
    await rangedFile(timedFetch, origin, channel.apk, `Android ${channel.versionCode} immutable APK`);
  }
  for (const alias of baseline.compatibility.apk.aliases) {
    await rangedFile(
      timedFetch,
      origin,
      { ...baseline.compatibility.apk, path: alias },
      "compatibility Android APK alias",
    );
  }
  const health = await reportingHealth(timedFetch, origin);

  await exactBytes(timedFetch, origin, stable.apk, `Android ${stable.versionCode} immutable APK`);
  await exactBytes(
    timedFetch,
    origin,
    { ...stable.apk, path: "/android/caatuu.apk" },
    "stable Android APK alias",
  );

  return {
    ok: true,
    origin,
    versionCode: current.stable.versionCode,
    versionName: current.stable.versionName,
    tag: current.githubRelease.tag,
    retainedAndroidVersions: channels.map((channel) => channel.versionCode),
    reportingVersion: health.version,
  };
}

function sleep(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

export async function verifyPublicPagesRelease({
  descriptor,
  baselineDescriptor,
  fetchImpl = globalThis.fetch,
  attempts = 31,
  retryDelayMs = 20_000,
  requestTimeoutMs = 30_000,
  sleepImpl = sleep,
  onAttemptFailure = () => {},
}) {
  // Thirty 20-second waits give Pages edge caches roughly ten minutes to
  // converge. Request time is separate and individually bounded.
  assert.ok(Number.isSafeInteger(attempts) && attempts >= 1 && attempts <= 60, "attempts must be between 1 and 60");
  assert.ok(Number.isSafeInteger(retryDelayMs) && retryDelayMs >= 0 && retryDelayMs <= 60_000, "retryDelayMs is invalid");
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await verifyPublicPagesReleaseOnce({ descriptor, baselineDescriptor, fetchImpl, requestTimeoutMs });
    } catch (error) {
      lastError = error;
      await onAttemptFailure({ attempt, attempts, error });
      if (attempt < attempts) await sleepImpl(retryDelayMs);
    }
  }
  throw new Error(`Public Pages verification failed after ${attempts} attempt(s): ${lastError?.message || lastError}`, {
    cause: lastError,
  });
}

function parseArguments(argv) {
  const options = { descriptor: defaultDescriptorPath, attempts: 31, retryDelayMs: 20_000 };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    assert.ok(["--descriptor", "--attempts", "--retry-delay-ms"].includes(argument), `Unknown argument: ${argument}`);
    const value = argv[index + 1];
    assert.ok(value && !value.startsWith("--"), `${argument} requires a value`);
    if (argument === "--descriptor") options.descriptor = resolve(value);
    if (argument === "--attempts") options.attempts = Number(value);
    if (argument === "--retry-delay-ms") options.retryDelayMs = Number(value);
    index += 1;
  }
  return options;
}

async function main(argv) {
  const options = parseArguments(argv);
  const descriptor = JSON.parse(readFileSync(options.descriptor, "utf8"));
  const baselineDescriptor = JSON.parse(readFileSync(defaultBaselinePath, "utf8"));
  const result = await verifyPublicPagesRelease({
    descriptor,
    baselineDescriptor,
    attempts: options.attempts,
    retryDelayMs: options.retryDelayMs,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(modulePath)) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error?.message || error}\n`);
    process.exitCode = 1;
  });
}
