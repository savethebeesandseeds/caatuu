import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { verifyEmbeddingRuntimeArtifactSource } from "../../../android/tooling/build-product-assets.mjs";
import {
  compilePagesSite,
  deriveMandarinPagesCacheName,
  enablePagesDurableBypassInCourseWorker,
  enableStableAndroidCourseProfile,
  retainPagesManagedMandarinOfflineAssets,
  validatePagesSite,
} from "../build-pages-site.mjs";

const testDir = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(testDir, "../build-pages-site.mjs"), "utf8");

test("the Pages builder exposes compilation and validation without running on import", () => {
  assert.equal(typeof compilePagesSite, "function");
  assert.equal(typeof validatePagesSite, "function");
  assert.match(source, /process\.argv\[1\].*resolve\(scriptPath\)/u);
});

test("the Pages builder accepts one frozen baseline plus one pinned current release", () => {
  assert.match(source, /Exactly one of baselineDir or baselineArchive is required/u);
  assert.match(source, /extractPagesBaselineArchive/u);
  assert.match(source, /--baseline-archive/u);
  assert.match(source, /loadPagesCurrentRelease/u);
  assert.match(source, /overlayCurrentAndroidRelease/u);
  assert.match(source, /currentReleaseDescriptorPath/u);
  assert.match(source, /compileProductAssetBundle/u);
  assert.match(source, /overlayMandarinWebProduct/u);
  assert.match(source, /allowMissingSetupDeliveredRuntimeFiles: true/u);
  assert.match(source, /prepared\?\.cleanup\(\)/u);
});

test("only the Pages product overlay may defer an absent setup-delivered runtime file", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "caatuu-pages-runtime-source-test-"));
  const runtimePath = join(temporaryDirectory, "runtime.bin");
  const artifact = {
    bytes: 0,
    sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  };
  const options = { source: runtimePath, artifact, artifactPath: "models/fixture/runtime.bin" };
  try {
    assert.throws(
      () => verifyEmbeddingRuntimeArtifactSource(options),
      /embedding runtime artifact is missing/u,
    );
    assert.equal(
      verifyEmbeddingRuntimeArtifactSource({
        ...options,
        allowMissingSetupDeliveredRuntimeFiles: true,
      }),
      false,
    );
    writeFileSync(runtimePath, "not empty");
    assert.throws(
      () => verifyEmbeddingRuntimeArtifactSource({
        ...options,
        allowMissingSetupDeliveredRuntimeFiles: true,
      }),
      /byte count drifted/u,
    );
    writeFileSync(runtimePath, "");
    assert.equal(verifyEmbeddingRuntimeArtifactSource(options), true);
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("the Pages builder keeps every Android release exact and outside service-worker handling", () => {
  assert.match(source, /retainedAndroidChannels/u);
  assert.match(source, /"\/android\/"/u);
  assert.match(source, /isDurableReleasePath\(url\.pathname\)/u);
  assert.match(source, /isDurableReleasePublicPath/u);
  assert.match(source, /androidPublicPaths/u);
  assert.match(source, /headers\\\.has/u);
  assert.match(source, /releaseSetupPaths/u);
  assert.match(source, /validateCurrentAndroidSetupClosure/u);
  assert.match(source, /validateFinalWebSetup/u);
  assert.match(source, /Pages bundle and service worker disagree about the cache name/u);
});

test("the Pages launcher offers only the signed stable Android channel", () => {
  const channels = source.slice(
    source.indexOf("function androidChannels()"),
    source.indexOf("function enableStableAndroidCourseProfile"),
  );
  assert.match(channels, /kind: "release"/u);
  assert.match(channels, /manifest: "\/android\/caatuu\.json"/u);
  assert.doesNotMatch(channels, /kind: "preview"/u);
  assert.doesNotMatch(channels, /android\/caatuu-preview/u);
  assert.match(source, /Mandarin course profile/u);
});

test("the Pages profile rewrite removes the preview channel from the real Mandarin profile", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "caatuu-pages-profile-test-"));
  const profilePath = join(temporaryDirectory, "course-profile.js");
  try {
    writeFileSync(
      profilePath,
      readFileSync(
        join(testDir, "../../../languages/mandarin-simplified/static/source/shared/course-profile.js"),
        "utf8",
      ),
    );
    enableStableAndroidCourseProfile(profilePath, "Mandarin test profile");
    const profile = readFileSync(profilePath, "utf8");
    assert.match(profile, /"kind": "release"[\s\S]*"manifest": "\/android\/caatuu\.json"/u);
    assert.doesNotMatch(profile, /"kind": "preview"|caatuu-preview/u);
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("the Pages builder requires Mandarin and rewrites its final published setup", () => {
  assert.match(source, /legacy-agreement-aurora/u);
  assert.match(source, /currentAgreement\.versionedPath/u);
  assert.match(source, /courseId: "cz"/u);
  assert.match(source, /courseId: mandarinCourseId/u);
  assert.match(source, /rewriteFinalMandarinSetup/u);
  assert.match(source, /browserRequiredArtifact/u);
  assert.match(source, /setup\.artifacts\.filter\(browserRequiredArtifact\)/u);
  assert.match(source, /Mandarin product bundle is missing a non-durable browser artifact/u);
  assert.match(source, /Mandarin product bundle is missing a non-durable offline asset/u);
  assert.match(source, /"\/zh\/", "\/zh\/index\.html"/u);
  assert.match(source, /finalMandarinSetup\.manifest\.offline\.assets/u);
  assert.doesNotMatch(source, /existsSync\(join\(siteDir, "zh\/setup-assets\.json"\)\)/u);
});

test("the Mandarin cache revision covers offline-only bytes and excludes durable assets", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "caatuu-pages-mandarin-cache-test-"));
  const siteDir = join(temporaryDirectory, "site");
  const workerSource = '"use strict";\n\n// Offline catalog revision: caatuu-zh-hans-pwa-v1\n';
  const manifest = {
    schemaVersion: "fixture-v1",
    courseId: "zh",
    application: { entryPath: "/zh/index.html" },
    offline: {
      cacheName: "caatuu-zh-hans-pwa-v1",
      cachePrefix: "caatuu-zh-hans-pwa-",
      assets: ["offline-only.txt?v=1", "/language-runtime/vendor/transformers/transformers.min.js"],
    },
    artifacts: [
      {
        key: "course-service-worker",
        url: "/zh/sw.js",
        browserRequired: true,
        bytes: 1,
        sha256: "0".repeat(64),
      },
    ],
  };
  try {
    for (const directory of [
      join(siteDir, "zh"),
      join(siteDir, "language-runtime/static/source"),
    ]) mkdirSync(directory, { recursive: true });
    writeFileSync(join(siteDir, "zh/index.html"), "<main>Mandarin</main>\n");
    writeFileSync(join(siteDir, "zh/offline-only.txt"), "first\n");
    writeFileSync(join(siteDir, "zh/sw.js"), workerSource);
    writeFileSync(join(siteDir, "language-runtime/static/source/course-service-worker.js"), "shared worker\n");

    const filtered = retainPagesManagedMandarinOfflineAssets(manifest, "https://caatuu.waajacu.com");
    assert.deepEqual(filtered, { retainedCount: 1, removedDurableCount: 1 });
    assert.deepEqual(manifest.offline.assets, ["offline-only.txt?v=1"]);
    const options = {
      siteDir,
      canonicalOrigin: "https://caatuu.waajacu.com",
      manifest,
      localWorkerSource: workerSource,
    };
    const first = deriveMandarinPagesCacheName(options);
    assert.equal(deriveMandarinPagesCacheName(options), first);
    writeFileSync(join(siteDir, "zh/offline-only.txt"), "second\n");
    const changedBytes = deriveMandarinPagesCacheName(options);
    assert.notEqual(changedBytes, first);
    manifest.schemaVersion = "fixture-v2";
    assert.notEqual(deriveMandarinPagesCacheName(options), changedBytes);
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("the published course worker bypasses durable release paths idempotently", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "caatuu-pages-course-worker-test-"));
  const workerPath = join(temporaryDirectory, "course-service-worker.js");
  try {
    writeFileSync(
      workerPath,
      readFileSync(join(testDir, "../../../language-runtime/static/source/course-service-worker.js"), "utf8"),
    );
    enablePagesDurableBypassInCourseWorker(workerPath);
    const first = readFileSync(workerPath, "utf8");
    assert.match(first, /const CAATUU_DURABLE_RELEASE_PREFIXES/u);
    assert.match(first, /if \(isDurableReleasePath\(url\.pathname\)\) return fetch\(request\);/u);
    assert.match(first, /Durable release assets cannot be precached/u);
    enablePagesDurableBypassInCourseWorker(workerPath);
    assert.equal(readFileSync(workerPath, "utf8"), first);
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("the Pages bundle keeps Czech reporting scoped and excludes the standalone preview game", () => {
  assert.match(source, /course\.id === "cz"[\s\S]*public site will retry later/u);
  assert.match(source, /standaloneGamePrefix/u);
  assert.match(source, /local-preview-only standalone Caatuu Game/u);
  assert.match(source, /assert\.doesNotMatch\(rootIndex/u);
});

test("the Pages builder stages and validates before replacing generated output", () => {
  const compileStart = source.indexOf("export function compilePagesSite({");
  const mandarinPreflight = source.indexOf("overlayMandarinWebProduct({", compileStart);
  const baselinePreparation = source.indexOf("prepared = prepareBaseline({", compileStart);
  const validation = source.indexOf("const staged = validatePreparedPagesSite({", compileStart);
  const replacement = source.indexOf("replaceGeneratedOutput(stagingDir, output, workspace);", compileStart);
  assert.ok(compileStart >= 0);
  assert.ok(mandarinPreflight > compileStart);
  assert.ok(baselinePreparation > mandarinPreflight);
  assert.ok(validation >= 0);
  assert.ok(replacement > validation);
  assert.match(source, /Pages staging output already exists/u);
  assert.match(source, /Refusing to replace output without the Pages sentinel/u);
});
