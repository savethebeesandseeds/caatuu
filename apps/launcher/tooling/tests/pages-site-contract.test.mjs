import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  compilePagesSite,
  validatePagesSite
} from "../build-pages-site.mjs";

const testDir = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(testDir, "../build-pages-site.mjs"), "utf8");

test("the Pages builder exposes compilation and validation without running on import", () => {
  assert.equal(typeof compilePagesSite, "function");
  assert.equal(typeof validatePagesSite, "function");
  assert.match(source, /process\.argv\[1\].*resolve\(scriptPath\)/u);
});

test("the Pages builder accepts only one verified baseline input", () => {
  assert.match(source, /Exactly one of baselineDir or baselineArchive is required/u);
  assert.match(source, /extractPagesBaselineArchive/u);
  assert.match(source, /--baseline-archive/u);
  assert.match(source, /prepared\.cleanup\(\)/u);
});

test("the Pages builder keeps Android exact and outside service-worker handling", () => {
  assert.ok(source.includes(
    "assert.equal(manifest.apk_url, `${descriptor.canonicalOrigin}/${channel.apk.publicPaths[0]}`);"
  ));
  assert.match(source, /"\/android\/"/u);
  assert.match(source, /isDurableReleasePath\(url\.pathname\)/u);
  assert.match(source, /isDurableReleasePublicPath/u);
  assert.match(source, /androidPublicPaths/u);
  assert.match(source, /assert\.match\(worker, \/request/u);
  assert.match(source, /headers\\\.has/u);
  assert.match(source, /releaseSetupPaths/u);
  assert.match(source, /completeDownloadBytes/u);
  assert.match(source, /validateFinalWebSetup/u);
  assert.match(source, /Pages bundle and service worker disagree about the cache name/u);
});

test("the Pages launcher offers only the signed stable Android channel", () => {
  assert.match(source, /kind: "release"/u);
  assert.match(source, /manifest: "\/android\/caatuu\.json"/u);
  assert.doesNotMatch(source, /kind: "preview"/u);
  assert.doesNotMatch(source, /android\/caatuu-preview/u);
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
