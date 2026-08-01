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
  dictionaryGapExport
] = await Promise.all([
  read("docs/PRIVACY.md"),
  read(".github/SECURITY.md"),
  read(".github/SUPPORT.md"),
  read("docs/PRODUCT_READINESS.md"),
  read("apps/languages/czech/static/chrome.js"),
  read("apps/languages/czech/static/runtime.js"),
  read("apps/languages/czech/static/setup.js"),
  read("apps/runtime/src/config.rs"),
  read("apps/runtime/src/routes/mod.rs"),
  read("compose.yaml"),
  read("apps/languages/czech/static/dictionary-gap-export.mjs")
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

test("the feedback outbox is durable, bounded, and unable to transmit", () => {
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
  assert.match(runtime, /exportDictionaryGaps\(options = \{\}\)/);
  assert.match(dictionaryGapExport, /payload\?\.kind !== TARGET_PAYLOAD_KIND/);
  assert.match(dictionaryGapExport, /feedback\?\.kind !== TARGET_FEEDBACK_KIND/);
  for (const field of [
    "targetWord",
    "normalizedWord",
    "dictionaryKey",
    "dictionaryDirection",
    "lookupOutcome",
    "lookupReturned"
  ]) {
    assert.match(dictionaryGapExport, new RegExp(`${field}[:,]`));
  }
  for (const forbidden of ["clientReportId", "reportedAt", "sentence", "translation", "comment", "device", "url"]) {
    assert.doesNotMatch(dictionaryGapExport, new RegExp(`feedback\\.${forbidden}`));
  }
  for (const field of [
    "normalizedWord",
    "dictionaryKey",
    "dictionaryDirection",
    "lookupOutcome",
    "lookupReturned"
  ]) {
    assert.match(runtime, new RegExp(`payload\\.feedback\\.${field}`));
  }
  assert.match(privacy, /device-local outbox/);
  assert.match(privacy, /not transmitted to or collected by the maintainer/);
  assert.match(readiness, /device-local outbox/);
  assert.match(readiness, /delivery adapter remains forced offline/);
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
  assert.match(privacy, /Remote diagnostic reporting remains disabled/);
  assert.match(privacy, /development preview, not a governed public beta/);
  assert.match(security, /No version is currently declared a\s+supported public beta/);
  assert.match(support, /best-effort basis/);
  assert.match(readiness, /Exact deployed source/);
  assert.match(readiness, /The live development checkout contains unpublished changes/);
});
