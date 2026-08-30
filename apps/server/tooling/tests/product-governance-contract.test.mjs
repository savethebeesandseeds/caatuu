import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const repoRoot = new URL("../../../../", import.meta.url);

async function read(path) {
  return readFile(new URL(path, repoRoot), "utf8");
}

const [
  privacy,
  security,
  support,
  readiness,
  chrome,
  runtime,
  setup,
  runtimeConfig,
  routes,
  compose,
  dictionaryGapReport,
  dictionaryGapRoute,
  androidBridge,
  androidGradle
] = await Promise.all([
  read("docs/PRIVACY.md"),
  read(".github/SECURITY.md"),
  read(".github/SUPPORT.md"),
  read("docs/PRODUCT_READINESS.md"),
  read("apps/language-runtime/static/source/caatuu-chrome.js"),
  read("apps/languages/czech/static/source/shared/runtime.js"),
  read("apps/languages/czech/static/source/features/setup/setup.js"),
  read("apps/server/src/config.rs"),
  read("apps/server/src/routes/mod.rs"),
  read("compose.yaml"),
  read("apps/languages/czech/static/source/features/dictionary/dictionary-gap-report.mjs"),
  read("apps/server/src/routes/dictionary_gaps.rs"),
  read("apps/android/app/src/main/java/com/caatuu/android/CaatuuBridge.kt"),
  read("apps/android/app/build.gradle.kts")
]);

test("remote diagnostics stay fail-closed while feedback remains device-local", () => {
  assert.match(runtimeConfig, /bug_reports: env_flag\("ENABLE_BUG_REPORTS"\)/);
  assert.match(compose, /ENABLE_BUG_REPORTS: \$\{CAATUU_ENABLE_BUG_REPORTS:-0\}/);
  assert.doesNotMatch(compose, /artifacts\/bug-reports:\/workspace\/artifacts\/bug-reports/);
  assert.match(routes, /bug_report_router\(features\.bug_reports\)/);
  assert.match(routes, /Remote diagnostic reporting is disabled on this server/);
  assert.doesNotMatch(chrome, /id="settingsReportBug"/);
  assert.match(setup, /report\.hidden = true/);
  assert.match(runtime, /Remote diagnostic reporting is disabled/);
  assert.doesNotMatch(runtime, /clearDisabledFeedbackQueue/);
  assert.doesNotMatch(runtime, /bugReportPath|reportBrowserBug|nativeCall\("report_bug"/);
  assert.doesNotMatch(runtime, /window\.addEventListener\("online", \(\) => scheduleFeedbackFlush/);
});

test("general feedback stays local while dictionary gaps use a separate narrow server ledger", () => {
  assert.match(runtime, /send: rejectRemoteFeedbackDelivery/);
  assert.match(runtime, /online: \(\) => false/);
  assert.match(runtime, /maxItems: 128/);
  assert.match(
    runtime,
    /enqueueReport\(payload = \{\}, options = \{\}\) \{\s*return enqueueReport\(payload, options\);\s*\}/
  );
  assert.match(runtime, /async reportBug\(payload = \{\}\) \{\s*const result = await enqueueReport\(payload\)/);
  assert.match(runtime, /flushReports\(\) \{\s*return flushQueuedReports\(\);\s*\}/);
  assert.match(runtime, /localOnly: true/);
  assert.match(runtime, /send: rejectRemoteFeedbackDelivery/);
  assert.match(runtime, /online: \(\) => false/);
  assert.match(runtime, /storageKey: "caatuu\.dictionaryGapOutbox\.v1"/);
  assert.match(runtime, /send: sendDictionaryGapReport/);
  assert.match(runtime, /fetch\("\/cz\/api\/dictionary\/gaps"/);
  assert.match(runtime, /nativeCall\("report_dictionary_gap"/);
  assert.match(runtime, /result\?\.ok !== true \|\| result\?\.stored !== true/);
  assert.match(runtime, /dictionaryGapMigrationKey = "caatuu\.dictionaryGapMigration\.v1"/);
  assert.match(runtime, /storage\?\.setItem\(dictionaryGapMigrationKey, "complete"\)/);
  assert.match(runtime, /window\.addEventListener\("online", \(\) => scheduleDictionaryGapFlush\(0\)\)/);
  assert.doesNotMatch(runtime, /exportDictionaryGaps|Copy missing-word batch/);
  assert.match(dictionaryGapReport, /DICTIONARY_GAP_REPORT_SCHEMA = "caatuu\.dictionary-gap-report\.v1"/);
  for (const field of [
    "targetWord",
    "normalizedWord",
    "dictionaryKey",
    "dictionaryDirection",
    "lookupOutcome",
    "lookupReturned"
  ]) {
    assert.match(dictionaryGapReport, new RegExp(`\\b${field}\\b`));
  }
  for (const forbidden of ["clientReportId", "reportedAt", "sentence", "translation", "comment", "device", "url"]) {
    assert.doesNotMatch(dictionaryGapReport, new RegExp(`\\b${forbidden}\\b`));
  }
  assert.match(routes, /"\/api\/dictionary\/gaps"[\s\S]*?post\(dictionary_gaps::submit\)[\s\S]*?DefaultBodyLimit::max\(2 \* 1024\)/);
  assert.match(dictionaryGapRoute, /deny_unknown_fields/);
  assert.match(dictionaryGapRoute, /MAX_GAPS: usize = 4096/);
  assert.match(dictionaryGapRoute, /first_seen_at_unix_ms[\s\S]*?last_seen_at_unix_ms/);
  assert.match(dictionaryGapRoute, /temporary_file\.sync_all\(\)[\s\S]*?fs::rename/);
  assert.match(compose, /DICTIONARY_GAP_STORE_PATH: \/var\/lib\/caatuu\/dictionary-gaps\/czech-missing-words\.v1\.json/);
  assert.match(compose, /\.\/artifacts\/dictionary-gaps:\/var\/lib\/caatuu\/dictionary-gaps/);
  assert.match(androidGradle, /CAATUU_ANDROID_DICTIONARY_GAP_URL/);
  assert.match(androidGradle, /https:\/\/caatuu\.waajacu\.com\$bundledLanguageRoutePrefix\/api\/dictionary\/gaps/);
  assert.match(androidBridge, /"report_dictionary_gap" -> reportDictionaryGap\(id, request\)/);
  assert.match(androidBridge, /keys == DICTIONARY_GAP_REPORT_FIELDS/);
  assert.match(androidBridge, /MAX_DICTIONARY_GAP_REPORT_BYTES = 2 \* 1024/);
  assert.match(androidBridge, /responseJson\.optBoolean\("ok", false\) && responseJson\.optBoolean\("stored", false\)/);
  assert.doesNotMatch(androidBridge, /reportDictionaryGap[\s\S]{0,1800}deviceSnapshot|reportDictionaryGap[\s\S]{0,1800}appSnapshot/);
  assert.match(privacy, /dictionary-gap observations use a separate,\s+narrowly scoped maintenance\s+channel/i);
  assert.match(privacy, /exactly these six observation fields/i);
  assert.match(privacy, /There is no public\s+GET or in-app export/i);
  assert.match(readiness, /General sentence and diagnostic reports remain device-local/);
  assert.match(readiness, /private server ledger/);
});

test("development-preview disclosures are linked and avoid a false beta claim", () => {
  assert.match(chrome, /You are interacting with an AI system/);
  assert.match(chrome, /A governed public beta has not been declared/);
  for (const documentPath of [
    "docs/PRIVACY.md",
    ".github/SECURITY.md",
    ".github/SUPPORT.md",
    "docs/PRODUCT_READINESS.md"
  ]) {
    assert.match(chrome, new RegExp(documentPath.replaceAll(".", "\\.")));
  }
  assert.match(privacy, /general feedback sender remains forced offline/);
  assert.match(privacy, /development preview, not a governed public beta/);
  assert.match(security, /No version is currently declared a\s+supported public beta/);
  assert.match(support, /best-effort basis/);
  assert.match(readiness, /Exact deployed source/);
  assert.match(readiness, /The live development checkout contains unpublished changes/);
});
