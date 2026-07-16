import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const repoRoot = new URL("../../../", import.meta.url);

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
  compose
] = await Promise.all([
  read("docs/PRIVACY.md"),
  read(".github/SECURITY.md"),
  read(".github/SUPPORT.md"),
  read("docs/PRODUCT_READINESS.md"),
  read("apps/caatuu-czech/static/chrome.js"),
  read("apps/caatuu-czech/static/runtime.js"),
  read("apps/caatuu-czech/static/setup.js"),
  read("apps/caatuu-runtime/src/config.rs"),
  read("apps/caatuu-runtime/src/routes/mod.rs"),
  read("compose.yaml")
]);

test("remote diagnostics are fail-closed throughout the public product", () => {
  assert.match(runtimeConfig, /bug_reports: env_flag\("ENABLE_BUG_REPORTS"\)/);
  assert.match(compose, /ENABLE_BUG_REPORTS: \$\{CAATUU_ENABLE_BUG_REPORTS:-0\}/);
  assert.doesNotMatch(compose, /artifacts\/bug-reports:\/workspace\/artifacts\/bug-reports/);
  assert.match(routes, /bug_report_router\(features\.bug_reports\)/);
  assert.match(routes, /Remote diagnostic reporting is disabled on this server/);
  assert.doesNotMatch(chrome, /id="settingsReportBug"/);
  assert.match(setup, /report\.hidden = true/);
  assert.match(runtime, /clearDisabledFeedbackQueue\(\)/);
  assert.match(runtime, /Remote diagnostic reporting is disabled/);
  assert.doesNotMatch(runtime, /window\.addEventListener\("online", \(\) => scheduleFeedbackFlush/);
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
  assert.match(privacy, /Remote diagnostic reporting is disabled by default/);
  assert.match(privacy, /development preview, not a governed public beta/);
  assert.match(security, /No version is currently declared a\s+supported public beta/);
  assert.match(support, /best-effort basis/);
  assert.match(readiness, /Exact deployed source/);
  assert.match(readiness, /The live development checkout contains unpublished changes/);
});
