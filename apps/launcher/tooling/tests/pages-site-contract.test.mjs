import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { compilePagesSite, validatePagesSite } from "../build-pages-site.mjs";

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
  assert.match(source, /prepared\.cleanup\(\)/u);
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
  assert.match(source, /kind: "release"/u);
  assert.match(source, /manifest: "\/android\/caatuu\.json"/u);
  assert.doesNotMatch(source, /kind: "preview"/u);
  assert.doesNotMatch(source, /android\/caatuu-preview/u);
});

test("the Pages builder preserves both Agreement artworks and rewrites any published Mandarin setup", () => {
  assert.match(source, /legacy-agreement-aurora/u);
  assert.match(source, /currentAgreement\.versionedPath/u);
  assert.match(source, /courseId: "cz"/u);
  assert.match(source, /courseId: "zh"/u);
  assert.match(source, /finalMandarinSetup\.manifest\.offline\.assets/u);
});

test("the Pages builder stages and validates before replacing generated output", () => {
  const compileStart = source.indexOf("export function compilePagesSite({");
  const validation = source.indexOf("const staged = validatePreparedPagesSite({", compileStart);
  const replacement = source.indexOf("replaceGeneratedOutput(stagingDir, output, workspace);", compileStart);
  assert.ok(compileStart >= 0);
  assert.ok(validation >= 0);
  assert.ok(replacement > validation);
  assert.match(source, /Pages staging output already exists/u);
  assert.match(source, /Refusing to replace output without the Pages sentinel/u);
});
