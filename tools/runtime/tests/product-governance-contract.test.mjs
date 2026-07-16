import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const repoRoot = new URL("../../../", import.meta.url);

async function read(path) {
  return readFile(new URL(path, repoRoot), "utf8");
}

const [privacy, security, support, readiness, chrome, runtime, setup, routes] =
  await Promise.all([
    read("PRIVACY.md"),
    read("SECURITY.md"),
    read("SUPPORT.md"),
    read("PRODUCT_READINESS.md"),
    read("apps/caatuu-czech/static/chrome.js"),
    read("apps/caatuu-czech/static/runtime.js"),
    read("apps/caatuu-czech/static/setup.js"),
    read("apps/caatuu-runtime/src/routes/mod.rs")
  ]);

test("remote diagnostics are fail-closed in the published source", () => {
  assert.match(routes, /post\(bug_reports_unavailable\)/);
  assert.match(routes, /Remote diagnostic reporting is disabled on this server/);
  assert.doesNotMatch(chrome, /id="settingsReportBug"/);
  assert.match(setup, /report\.hidden = true/);
  assert.match(runtime, /Remote diagnostic reporting is disabled/);
  assert.match(privacy, /Remote diagnostic reporting is disabled by default/);
});

test("development-preview disclosures are linked and avoid a false beta claim", () => {
  assert.match(chrome, /You are interacting with an AI system/);
  assert.match(chrome, /A governed public beta has not been declared/);
  for (const documentName of ["PRIVACY.md", "SECURITY.md", "SUPPORT.md", "PRODUCT_READINESS.md"]) {
    assert.match(chrome, new RegExp(documentName.replace(".", "\\.")));
  }
  assert.match(privacy, /development preview, not a governed public beta/);
  assert.match(security, /No version is currently declared a\s+supported public beta/);
  assert.match(support, /best-effort basis/);
  assert.match(readiness, /Exact deployed source/);
});
