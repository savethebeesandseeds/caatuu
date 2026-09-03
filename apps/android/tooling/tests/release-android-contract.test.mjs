import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../release-android.ps1", import.meta.url), "utf8");
const productBuild = await readFile(new URL("../../product/build.gradle.kts", import.meta.url), "utf8");

test("the routine Android release is one command with guarded build and receipt-only deployment", () => {
  assert.match(source, /C:\\Work\\caatuu/u);
  assert.match(source, /\$FinalizedReleaseDirectory = Join-Path \$RepositoryRoot "artifacts\\android\\releases\\\$VersionCode"/u);
  assert.equal(source.match(/publish-release\.sh --build-once/gu)?.length, 1);
  assert.equal(source.match(/deploy-pages-release\.ps1/gu)?.length, 1);
  assert.match(source, /\$FinalizedReleaseComplete/u);
  assert.match(source, /Test-Path -LiteralPath \$FinalizedApk -PathType Leaf/u);
  assert.match(source, /Test-Path -LiteralPath \$FinalizedManifest -PathType Leaf/u);
  assert.match(source, /Test-Path -LiteralPath \$FinalizedReceipt -PathType Leaf/u);
  assert.match(source, /if \(\$FinalizedReleaseComplete\)/u);
  assert.match(source, /skipping the build stage/u);
  assert.match(source, /-CandidateReceipt \$FinalizedReceipt/u);
  assert.match(productBuild, /caatuuVersionCode[\s\S]*?orElse\([1-9][0-9]*\)/u);
});

test("the wrapper cannot build directly or publish around the guarded entrypoints", () => {
  assert.doesNotMatch(source, /^\s*(?:gradle|gradlew)(?:\.bat)?\b/imu);
  assert.doesNotMatch(source, /assembleRelease|bundleRelease/iu);
  assert.doesNotMatch(source, /\bgh\b|git push|workflow run|release upload/iu);
  assert.doesNotMatch(source, /for\s*\(|foreach\s*\(|while\s*\(/iu);
});
