import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  browserEntrypointsFromLanguageRegistry,
  validatePublicBaselineDescriptor,
  verifyPublicPagesRelease,
  verifyPublicPagesReleaseOnce,
} from "../verify-public-pages-release.mjs";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const jsonBytes = (value) => Buffer.from(`${JSON.stringify(value)}\n`);
const prettyJsonBytes = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const anchoredDescriptor = JSON.parse(await readFile(new URL("../pages-current-release.json", import.meta.url), "utf8"));

function browserCourse(id, status = "development") {
  return {
    id,
    status,
    routePrefix: `/${id}`,
    entryPath: `/${id}/index.html`,
    storage: { learningPerformance: `caatuu-${id}.learning.performance.v1` },
    sourceLanguage: { id: "en" },
    targetLanguage: { id },
  };
}

function refreshLanguageProjection(data) {
  const raw = jsonBytes(data.languageRegistry);
  const entrypoints = browserEntrypointsFromLanguageRegistry(data.languageRegistry);
  data.bundle.entrypoints = [...entrypoints];
  const record = { path: "languages.json", bytes: raw.length, sha256: sha256(raw) };
  const index = data.bundle.files.findIndex(({ path }) => path === record.path);
  if (index >= 0) data.bundle.files[index] = record;
  else data.bundle.files.push(record);
  return entrypoints;
}

function fixture() {
  const currentApk = Buffer.from("current-signed-apk\n");
  const baselineApk = Buffer.from("baseline-apk\n");
  const compatibilityApk = Buffer.from("compatibility-apk\n");
  const sourceRevision = "a".repeat(40);
  const currentManifestBytes = jsonBytes({
    schema_version: 1,
    profile: "product",
    channel: "stable",
    signing_lineage: "direct-release-v1",
    package_name: "com.waajacu.caatuu",
    version_code: 164,
    version_name: "0.1.12",
    build_type: "release",
    debuggable: false,
    apk_url: "https://caatuu.waajacu.com/android/releases/164/caatuu.apk",
    bytes: currentApk.length,
    sha256: sha256(currentApk),
    signer_certificate_sha256: "c".repeat(64),
    source_revision: sourceRevision,
    source_url: `https://github.com/savethebeesandseeds/caatuu/tree/${sourceRevision}`,
  });
  const anchoredManifestBytes = prettyJsonBytes({
    schema_version: 1,
    profile: "product",
    channel: "stable",
    signing_lineage: "direct-release-v1",
    package_name: "com.waajacu.caatuu",
    version_code: 163,
    version_name: "0.1.11",
    build_type: "release",
    debuggable: false,
    apk_url: "https://caatuu.waajacu.com/android/releases/163/caatuu.apk",
    sha256: "fd1d4bd283c558174eacd68e08c01a93235fae0b28970e6993e1e84a2d142545",
    bytes: 26553893,
    signer_certificate_sha256: "c663bdec81ef8876f261ebbc3ab95d96789972eb8bc1b22e8e17acf44469af55",
    source_revision: "91ba021979275160ca30cacabe8a954aa1bf2341",
    source_url: "https://github.com/savethebeesandseeds/caatuu/tree/91ba021979275160ca30cacabe8a954aa1bf2341",
    native_abis: [],
    universal: true,
    capabilities: { llm: false, godot: false, embeddings: true },
    audit: {
      bundletool: "passed",
      product_package: "passed",
      candidate_receipt_sha256: "2e7f3a25961184fa516e1704ec538802c24f2e4db205336abb29def87757d71f",
    },
    device_smoke: "not-run",
  });
  assert.equal(anchoredManifestBytes.length, anchoredDescriptor.releases[0].manifest.bytes);
  assert.equal(sha256(anchoredManifestBytes), anchoredDescriptor.releases[0].manifest.sha256);
  const baselineManifestBytes = jsonBytes({
    schema_version: 1,
    profile: "product",
    channel: "stable",
    signing_lineage: "direct-release-v1",
    package_name: "com.waajacu.caatuu",
    version_code: 162,
    version_name: "0.1.10",
    build_type: "release",
    debuggable: false,
    apk_url: "https://caatuu.waajacu.com/android/releases/162/caatuu.apk",
    bytes: baselineApk.length,
    sha256: sha256(baselineApk),
    signer_certificate_sha256: "c".repeat(64),
    source_revision: sourceRevision,
    source_url: `https://github.com/savethebeesandseeds/caatuu/tree/${sourceRevision}`,
  });
  const compatibilityManifestBytes = jsonBytes({
    schema_version: 1,
    profile: "product-transition",
    channel: "legacy-update-bridge",
    signing_lineage: "direct-release-v1",
    package_name: "com.waajacu.caatuu",
    version_code: 161,
    version_name: "0.1.10-transition.1",
    build_type: "debug",
    debuggable: true,
    apk_url: "https://caatuu.waajacu.com/android/debug-releases/product-transition/161/caatuu-transition.apk",
    bytes: compatibilityApk.length,
    sha256: sha256(compatibilityApk),
    signer_certificate_sha256: "c".repeat(64),
    source_revision: sourceRevision,
    source_url: `https://github.com/savethebeesandseeds/caatuu/tree/${sourceRevision}`,
    stable_manifest_url: "https://caatuu.waajacu.com/android/caatuu.json",
  });

  function baselineFile(path, bytes, aliases = []) {
    return {
      sourcePath: `unused/${path}`,
      archivePath: `site/${path}`,
      publicPaths: [path, ...aliases],
      bytes: bytes.length,
      sha256: sha256(bytes),
    };
  }

  const baselineDescriptor = {
    schemaName: "caatuu-pages-baseline",
    schemaVersion: 1,
    channel: "existing-release-baseline",
    canonicalOrigin: "https://caatuu.waajacu.com",
    repository: "savethebeesandseeds/caatuu",
    releaseArchive: {},
    stable: {
      versionCode: 162,
      versionName: "0.1.10",
      sourceRevision,
      manifest: baselineFile("android/releases/162/caatuu.json", baselineManifestBytes, ["android/caatuu.json"]),
      apk: baselineFile("android/releases/162/caatuu.apk", baselineApk, ["android/caatuu.apk"]),
    },
    compatibility: {
      versionCode: 161,
      versionName: "0.1.10-transition.1",
      sourceRevision,
      manifest: baselineFile(
        "android/debug-releases/product-transition/161/caatuu-transition.json",
        compatibilityManifestBytes,
        ["android/caatuu-debug.json"],
      ),
      apk: baselineFile(
        "android/debug-releases/product-transition/161/caatuu-transition.apk",
        compatibilityApk,
        ["android/caatuu-debug.apk"],
      ),
    },
    nativeSetup: {},
    sourceOverrides: [],
    retainedFiles: [],
    retiredPublicRoutes: [],
  };
  const descriptor = {
    ...structuredClone(anchoredDescriptor),
    releases: [structuredClone(anchoredDescriptor.releases[0])],
  };
  descriptor.releases.push({
      versionCode: 164,
      versionName: "0.1.12",
      sourceRevision,
      manifest: { bytes: currentManifestBytes.length, sha256: sha256(currentManifestBytes) },
      apk: { bytes: currentApk.length, sha256: sha256(currentApk) },
      receipt: { bytes: 10, sha256: "b".repeat(64) },
    });
  const records = [
    ["android/releases/162/caatuu.json", baselineDescriptor.stable.manifest],
    ["android/releases/162/caatuu.apk", baselineDescriptor.stable.apk],
    ["android/debug-releases/product-transition/161/caatuu-transition.json", baselineDescriptor.compatibility.manifest],
    ["android/debug-releases/product-transition/161/caatuu-transition.apk", baselineDescriptor.compatibility.apk],
    ["android/caatuu-debug.json", baselineDescriptor.compatibility.manifest],
    ["android/caatuu-debug.apk", baselineDescriptor.compatibility.apk],
    ["android/releases/163/caatuu.json", descriptor.releases[0].manifest],
    ["android/releases/163/caatuu.apk", descriptor.releases[0].apk],
    ["android/releases/164/caatuu.json", descriptor.releases[1].manifest],
    ["android/releases/164/caatuu.apk", descriptor.releases[1].apk],
    ["android/caatuu.json", descriptor.releases[1].manifest],
    ["android/caatuu.apk", descriptor.releases[1].apk],
  ];
  const languageRegistry = {
    schemaVersion: 1,
    defaultLanguage: "cz",
    browserSetup: {
      schemaVersion: 1,
      entryPath: "/cz/index.html",
      courses: [browserCourse("cz", "active"), browserCourse("zh")],
    },
    languages: [{ id: "cz" }],
  };
  const bundle = {
    schema_name: "caatuu-web-bundle",
    schema_version: 1,
    canonicalOrigin: descriptor.canonicalOrigin,
    currentAndroidRelease: { tag: "caatuu-android-v164" },
    entrypoints: ["/", "/cz/", "/cz/index.html", "/zh/", "/zh/index.html"],
    android: {
      stableVersionCode: 164,
      stableVersionName: "0.1.12",
      previousStableVersionCode: 163,
      compatibilityVersionCode: 161,
    },
    files: records.map(([path, record]) => ({ path, bytes: record.bytes, sha256: record.sha256 })),
  };
  const languageRegistryBytes = jsonBytes(languageRegistry);
  bundle.files.push({ path: "languages.json", bytes: languageRegistryBytes.length, sha256: sha256(languageRegistryBytes) });
  const bodies = new Map([
    ["/android/releases/162/caatuu.json", baselineManifestBytes],
    ["/android/debug-releases/product-transition/161/caatuu-transition.json", compatibilityManifestBytes],
    ["/android/caatuu-debug.json", compatibilityManifestBytes],
    ["/android/releases/163/caatuu.json", anchoredManifestBytes],
    ["/android/releases/164/caatuu.json", currentManifestBytes],
    ["/android/caatuu.json", currentManifestBytes],
    ["/android/releases/164/caatuu.apk", currentApk],
    ["/android/caatuu.apk", currentApk],
  ]);
  const rangedSizes = new Map([
    ["/android/releases/162/caatuu.apk", baselineApk.length],
    ["/android/debug-releases/product-transition/161/caatuu-transition.apk", compatibilityApk.length],
    ["/android/caatuu-debug.apk", compatibilityApk.length],
    ["/android/releases/163/caatuu.apk", descriptor.releases[0].apk.bytes],
  ]);
  return { descriptor, baselineDescriptor, bundle, languageRegistry, bodies, rangedSizes };
}

function mockPublicFetch(data, { staleBundleOnce = false, corruptAlias = false } = {}) {
  const calls = [];
  let bundleRequests = 0;
  const fetchImpl = async (input, options) => {
    const url = new URL(input);
    const path = url.pathname;
    calls.push({ path, options });
    if (data.bundle.entrypoints.includes(path)) {
      return new Response("<!doctype html><html><title>Caatuu</title></html>", {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    if (path === "/languages.json") {
      return new Response(jsonBytes(data.languageRegistry), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (path === "/caatuu-web-bundle.json") {
      bundleRequests += 1;
      const value = staleBundleOnce && bundleRequests === 1
        ? { ...data.bundle, currentAndroidRelease: { tag: "caatuu-android-v163" } }
        : data.bundle;
      return new Response(jsonBytes(value), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (path === "/api/reporting/health") {
      return new Response(jsonBytes({ ok: true, ready: true, version: "2026-09-03.v5" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (data.rangedSizes.has(path)) {
      assert.equal(options.headers.range, "bytes=0-0");
      return new Response(Buffer.from([0]), {
        status: 206,
        headers: {
          "accept-ranges": "bytes",
          "content-length": "1",
          "content-range": `bytes 0-0/${data.rangedSizes.get(path)}`,
        },
      });
    }
    if (data.bodies.has(path)) {
      const body = corruptAlias && path === "/android/caatuu.apk" ? Buffer.from("wrong\n") : data.bodies.get(path);
      return new Response(body, {
        status: 200,
        headers: { "content-length": String(body.length), "content-type": "application/octet-stream" },
      });
    }
    return new Response("not found", { status: 404 });
  };
  return { calls, fetchImpl };
}

test("public verifier checks Pages, all retained Android routes, aliases, and data-free health", async () => {
  const data = fixture();
  const mock = mockPublicFetch(data);
  const result = await verifyPublicPagesReleaseOnce({
    descriptor: data.descriptor,
    baselineDescriptor: data.baselineDescriptor,
    fetchImpl: mock.fetchImpl,
  });
  assert.equal(result.ok, true);
  assert.equal(result.versionCode, 164);
  assert.deepEqual(result.browserEntrypoints, ["/", "/cz/", "/cz/index.html", "/zh/", "/zh/index.html"]);
  assert.deepEqual(result.retainedAndroidVersions, [162, 161, 163, 164]);
  assert.equal(result.reportingVersion, "2026-09-03.v5");
  assert.ok(mock.calls.some((call) => call.path === "/android/caatuu.apk"));
  assert.ok(mock.calls.some((call) => call.path === "/android/caatuu-debug.apk"));
  assert.ok(mock.calls.some((call) => call.path === "/android/releases/162/caatuu.apk" && call.options.headers.range));
  assert.ok(mock.calls.every((call) => call.options.method === "GET" && call.options.body === undefined));
  assert.ok(!mock.calls.some((call) => ["/cz/api/dictionary/gaps", "/api/sentence-reports"].includes(call.path)));
});

test("public verifier discovers every entrypoint for a synthetic third browser course", async () => {
  const data = fixture();
  data.languageRegistry.browserSetup.courses.push(browserCourse("es"));
  const entrypoints = refreshLanguageProjection(data);
  const mock = mockPublicFetch(data);
  const result = await verifyPublicPagesReleaseOnce({
    descriptor: data.descriptor,
    baselineDescriptor: data.baselineDescriptor,
    fetchImpl: mock.fetchImpl,
  });
  assert.deepEqual(result.browserEntrypoints, entrypoints);
  assert.ok(mock.calls.some(({ path }) => path === "/es/"));
  assert.ok(mock.calls.some(({ path }) => path === "/es/index.html"));
});

test("browser entrypoint discovery rejects duplicates, escaping paths, and bundle order drift", async () => {
  const duplicate = fixture().languageRegistry;
  duplicate.browserSetup.courses.push(browserCourse("zh"));
  assert.throws(() => browserEntrypointsFromLanguageRegistry(duplicate), /course IDs must not contain duplicates/u);

  const escaping = fixture().languageRegistry;
  escaping.browserSetup.courses.push({ ...browserCourse("es"), entryPath: "/es/../index.html" });
  assert.throws(() => browserEntrypointsFromLanguageRegistry(escaping), /confined file/u);

  const data = fixture();
  data.bundle.entrypoints = ["/", "/zh/", "/zh/index.html", "/cz/", "/cz/index.html"];
  const mock = mockPublicFetch(data);
  await assert.rejects(
    verifyPublicPagesReleaseOnce({
      descriptor: data.descriptor,
      baselineDescriptor: data.baselineDescriptor,
      fetchImpl: mock.fetchImpl,
    }),
    /entrypoint order differs/u,
  );
});

test("public verifier retries a stale Pages bundle before downloading the current APK", async () => {
  const data = fixture();
  const mock = mockPublicFetch(data, { staleBundleOnce: true });
  let sleeps = 0;
  let failures = 0;
  const result = await verifyPublicPagesRelease({
    descriptor: data.descriptor,
    baselineDescriptor: data.baselineDescriptor,
    fetchImpl: mock.fetchImpl,
    attempts: 2,
    retryDelayMs: 1,
    sleepImpl: async () => { sleeps += 1; },
    onAttemptFailure: () => { failures += 1; },
  });
  assert.equal(result.versionCode, 164);
  assert.equal(sleeps, 1);
  assert.equal(failures, 1);
  assert.equal(mock.calls.filter((call) => call.path === "/android/caatuu.apk").length, 1);
});

test("public verifier aborts and retries when a response body stalls after its headers", async () => {
  const data = fixture();
  let requests = 0;
  let failures = 0;
  let sleeps = 0;
  const stalledFetch = async (input, options) => {
    requests += 1;
    assert.ok(options.signal, "request timeout signal was not provided");
    return {
      status: 200,
      ok: true,
      url: String(input),
      headers: new Headers({ "content-type": "text/html" }),
      arrayBuffer: () => new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
      }),
    };
  };

  await assert.rejects(
    verifyPublicPagesRelease({
      descriptor: data.descriptor,
      baselineDescriptor: data.baselineDescriptor,
      fetchImpl: stalledFetch,
      attempts: 2,
      retryDelayMs: 0,
      requestTimeoutMs: 5,
      sleepImpl: async () => { sleeps += 1; },
      onAttemptFailure: () => { failures += 1; },
    }),
    /request timed out after 5ms/u,
  );
  assert.equal(requests, 2);
  assert.equal(failures, 2);
  assert.equal(sleeps, 1);
});

test("public verifier rejects bytes that differ at the stable APK alias", async () => {
  const data = fixture();
  const mock = mockPublicFetch(data, { corruptAlias: true });
  await assert.rejects(
    verifyPublicPagesReleaseOnce({ descriptor: data.descriptor, baselineDescriptor: data.baselineDescriptor, fetchImpl: mock.fetchImpl }),
    /stable Android APK alias byte count changed/u,
  );
});

test("baseline route injection is rejected before any request", () => {
  const data = fixture();
  data.baselineDescriptor.stable.apk.publicPaths[0] = "../outside.apk";
  assert.throws(
    () => validatePublicBaselineDescriptor(data.baselineDescriptor, {
      canonicalOrigin: data.descriptor.canonicalOrigin,
      repository: data.descriptor.repository,
      baselineStableVersionCode: 162,
      compatibilityVersionCode: 161,
    }),
    /public paths changed/u,
  );
});

test("a manifest cannot move its APK to another origin", async () => {
  const data = fixture();
  const value = JSON.parse(data.bodies.get("/android/releases/164/caatuu.json").toString("utf8"));
  value.apk_url = "https://downloads.example.invalid/android/releases/164/caatuu.apk";
  const changed = jsonBytes(value);
  data.bodies.set("/android/releases/164/caatuu.json", changed);
  data.bodies.set("/android/caatuu.json", changed);
  data.descriptor.releases[1].manifest = { bytes: changed.length, sha256: sha256(changed) };
  for (const entry of data.bundle.files.filter((file) => [
    "android/releases/164/caatuu.json",
    "android/caatuu.json",
  ].includes(file.path))) {
    entry.bytes = changed.length;
    entry.sha256 = sha256(changed);
  }
  const mock = mockPublicFetch(data);
  await assert.rejects(
    verifyPublicPagesReleaseOnce({ descriptor: data.descriptor, baselineDescriptor: data.baselineDescriptor, fetchImpl: mock.fetchImpl }),
    /APK origin changed/u,
  );
});

test("the compatibility manifest keeps its exact transition semantics", async () => {
  const data = fixture();
  const path = "/android/debug-releases/product-transition/161/caatuu-transition.json";
  const value = JSON.parse(data.bodies.get(path).toString("utf8"));
  value.stable_manifest_url = "https://downloads.example.invalid/android/caatuu.json";
  const changed = jsonBytes(value);
  data.bodies.set(path, changed);
  data.bodies.set("/android/caatuu-debug.json", changed);
  data.baselineDescriptor.compatibility.manifest.bytes = changed.length;
  data.baselineDescriptor.compatibility.manifest.sha256 = sha256(changed);
  for (const inventory of data.bundle.files.filter((file) => [path.slice(1), "android/caatuu-debug.json"].includes(file.path))) {
    inventory.bytes = changed.length;
    inventory.sha256 = sha256(changed);
  }
  const mock = mockPublicFetch(data);
  await assert.rejects(
    verifyPublicPagesReleaseOnce({ descriptor: data.descriptor, baselineDescriptor: data.baselineDescriptor, fetchImpl: mock.fetchImpl }),
    /stable manifest URL changed/u,
  );
});

test("default retry waits cover the documented ten-minute cache delay", async () => {
  const verifier = await readFile(new URL("../verify-public-pages-release.mjs", import.meta.url), "utf8");
  assert.match(verifier, /attempts\s*=\s*31/u);
  assert.match(verifier, /retryDelayMs\s*=\s*20_000/u);
  assert.match(verifier, /requestTimeoutMs\s*=\s*30_000/u);
});
