import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  loadPagesBaseline
} from "../pages-baseline.mjs";

const testDir = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(testDir, "../../../..");
const { descriptor } = loadPagesBaseline({ workspaceRoot });
const baselineSource = readFileSync(join(testDir, "../pages-baseline.mjs"), "utf8");
const packageSource = readFileSync(join(testDir, "../package-pages-baseline.mjs"), "utf8");

test("the Pages baseline freezes the existing Android 162 and transition 161 bytes", () => {
  assert.deepEqual(descriptor.releaseArchive, {
    tag: "caatuu-pages-v162",
    assetName: "caatuu-pages-v162.tar",
    downloadUrl: "https://github.com/savethebeesandseeds/caatuu/releases/download/caatuu-pages-v162/caatuu-pages-v162.tar",
    bytes: 535674368,
    sha256: "9564bf5dc318ab642468787dd6ef23e4e70923887ca622620d045255734cc6c5"
  });
  assert.equal(descriptor.stable.versionCode, 162);
  assert.equal(descriptor.stable.apk.sha256, "21389c646480624c1998f16504f3606aeb93cb28e2bbaf42328f28cf12ee442d");
  assert.equal(descriptor.compatibility.versionCode, 161);
  assert.equal(descriptor.compatibility.apk.sha256, "b89b7e904380eb06dc98d79177c5b5d5b5c47fd28c5cc9d5d8881e7d51de2981");
  assert.equal(descriptor.stable.sourceRevision, descriptor.compatibility.sourceRevision);
});

test("the Pages baseline keeps every required same-origin Android alias", () => {
  assert.deepEqual(descriptor.stable.manifest.publicPaths, [
    "android/releases/162/caatuu.json",
    "android/caatuu.json"
  ]);
  assert.deepEqual(descriptor.stable.apk.publicPaths, [
    "android/releases/162/caatuu.apk",
    "android/caatuu.apk"
  ]);
  assert.deepEqual(descriptor.compatibility.manifest.publicPaths, [
    "android/debug-releases/product-transition/161/caatuu-transition.json",
    "android/caatuu-debug.json"
  ]);
  assert.deepEqual(descriptor.compatibility.apk.publicPaths, [
    "android/debug-releases/product-transition/161/caatuu-transition.apk",
    "android/caatuu-debug.apk"
  ]);
  assert.ok(!descriptor.compatibility.manifest.publicPaths.includes("android/caatuu-preview.json"));
  assert.ok(!descriptor.compatibility.apk.publicPaths.includes("android/caatuu-preview.apk"));
});

test("the durable setup closure includes the original release keymaps, databases, and legacy art", () => {
  assert.equal(descriptor.nativeSetup.sha256, "3539dda1951171e399915f939b784efe4fc8d5c891d3d8236e8b6fe2b0b28b09");
  assert.equal(descriptor.nativeSetup.nativeArtifactCount, 662);
  const retainedDatabases = descriptor.retainedFiles
    .filter((file) => ["dictionary-sqlite", "embedding-sqlite"].includes(file.key))
    .reduce((sum, file) => sum + file.bytes, 0);
  assert.equal(
    descriptor.nativeSetup.nativeArtifactBytes + retainedDatabases,
    descriptor.nativeSetup.completeDownloadBytes
  );
  assert.equal(
    descriptor.sourceOverrides.find((file) => file.key === "legacy-czech-macaw")?.sha256,
    "b557320fd7b26ff2ae8d613a22b2ac6ebdc9d81b322642dbd7f57daf28a72e40"
  );
  assert.equal(
    descriptor.sourceOverrides.find((file) => file.key === "legacy-agreement-aurora")?.sha256,
    "abfc3a443f60e1a1c2f4c16fbb2cda0e20f46b4daeb75bdc35d3b99718cc79a6"
  );
});

test("the baseline explicitly records dynamic routes that Pages retires", () => {
  assert.deepEqual(descriptor.retiredPublicRoutes, [
    "/android/caatuu-preview.json",
    "/android/caatuu-preview.apk",
    "/android/releases/status",
    "/android/debug-releases/status",
    "/android/termux-install-debug.sh",
    "/cz/api/dictionary/status",
    "/cz/api/dictionary/search",
    "/cz/api/dictionary/gaps",
    "/api/bug-report",
    "/api/v1",
    "/ws"
  ]);
});

test("archive verification is pinned, path-safe, and packaging has no import side effect", () => {
  assert.match(baselineSource, /Baseline archive byte count does not match the pinned descriptor/u);
  assert.match(baselineSource, /Baseline archive SHA-256 does not match the pinned descriptor/u);
  assert.match(baselineSource, /Baseline tar entry escapes extraction/u);
  assert.match(baselineSource, /Baseline tar contains a non-file entry/u);
  assert.match(baselineSource, /Baseline extraction contains an unexpected file set/u);
  assert.match(baselineSource, /hash changed while packaging/u);
  assert.match(baselineSource, /Generated archive SHA-256 changed from the frozen descriptor/u);
  assert.match(packageSource, /process\.argv\[1\].*resolve\(scriptPath\)/u);
  assert.doesNotMatch(descriptor.releaseArchive.downloadUrl, /latest/iu);
});
