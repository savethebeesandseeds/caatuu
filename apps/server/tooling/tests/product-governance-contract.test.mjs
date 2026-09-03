import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const repoRoot = new URL("../../../../", import.meta.url);

async function read(relativePath) {
  return readFile(new URL(relativePath, repoRoot), "utf8");
}

test("public-product governance remains local-first, bounded, and explicitly preview-only", async () => {
  const [privacy, readiness, chrome, runtime, config, routes, compose, dictionaryGap, androidBridge] = await Promise.all([
    read("docs/PRIVACY.md"),
    read("docs/PRODUCT_READINESS.md"),
    read("apps/language-runtime/static/source/caatuu-chrome.js"),
    read("apps/languages/czech/static/source/shared/runtime.js"),
    read("apps/server/src/config.rs"),
    read("apps/server/src/routes/mod.rs"),
    read("compose.yaml"),
    read("apps/languages/czech/static/source/features/dictionary/dictionary-gap-report.mjs"),
    read("apps/android/app/src/main/java/com/caatuu/android/CaatuuBridge.kt"),
  ]);

  assert.match(config, /bug_reports: env_flag\("ENABLE_BUG_REPORTS"\)/u);
  assert.match(compose, /ENABLE_BUG_REPORTS: \$\{CAATUU_ENABLE_BUG_REPORTS:-0\}/u);
  assert.match(routes, /Remote diagnostic reporting is disabled on this server/u);
  assert.match(runtime, /send: rejectRemoteFeedbackDelivery/u);
  assert.match(runtime, /localOnly: true/u);
  assert.doesNotMatch(runtime, /nativeCall\("report_bug"\)/u);

  for (const field of [
    "targetWord",
    "normalizedWord",
    "dictionaryKey",
    "dictionaryDirection",
    "lookupOutcome",
    "lookupReturned",
  ]) {
    assert.match(dictionaryGap, new RegExp(`\\b${field}\\b`, "u"));
  }
  assert.match(androidBridge, /keys == DICTIONARY_GAP_REPORT_FIELDS/u);
  assert.match(androidBridge, /MAX_DICTIONARY_GAP_REPORT_BYTES = 2 \* 1024/u);
  assert.match(privacy, /Public web dictionary-gap sharing is off by default/iu);
  assert.match(privacy, /choice applies only to new\s+observations made afterward/iu);
  assert.match(privacy, /Previously saved records remain on the device and\s+are not uploaded/iu);
  assert.match(privacy, /There is no public\s+GET or\s+in-app export/iu);

  assert.match(chrome, /You are interacting with an AI system/u);
  assert.match(chrome, /A governed public beta has not been declared/u);
  assert.match(readiness, /BOUNDED EDGE CHANNEL READY/u);
  assert.match(readiness, /future-only opted-in\s+dictionary gaps/u);
  assert.match(readiness, /Exact deployed source/u);
});
