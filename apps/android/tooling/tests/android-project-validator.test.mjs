import assert from "node:assert/strict";
import test from "node:test";

import {
  ANDROID_PROJECT_ISSUE_CODES,
  loadAndroidProjectSources,
  validateAndroidProject,
  validateAndroidProjectSources,
} from "../validate-android-project.mjs";

test("the canonical Android project satisfies its architectural and release boundaries", async () => {
  const report = await validateAndroidProject();
  assert.equal(report.valid, true, JSON.stringify(report.issues, null, 2));
});

test("the validator rejects bridge expansion and unsafe product dependencies", async () => {
  const { sources } = await loadAndroidProjectSources();
  const mutated = {
    ...sources,
    productBridge: sources.productBridge.replace(
      '"update_app" -> updateApp(id)',
      '"delete_model" -> updateApp(id)',
    ),
    productBuild: `${sources.productBuild}\ndependencies { implementation(project(":llamaLib")) }\n`,
  };
  const report = validateAndroidProjectSources(mutated);
  assert.equal(report.valid, false);
  assert.ok(report.issues.some(({ code }) => code === ANDROID_PROJECT_ISSUE_CODES.PRODUCT_BRIDGE_OPERATIONS));
  assert.ok(report.issues.some(({ code }) => code === ANDROID_PROJECT_ISSUE_CODES.FORBIDDEN_CONTRACT_PRESENT));
});

test("the validator rejects an update pipeline that installs before re-verification", async () => {
  const { sources } = await loadAndroidProjectSources();
  const mutated = {
    ...sources,
    updateManager: sources.updateManager.replace(
      "verifyTargetFile(updateApk, snapshot.target)",
      "verifyTargetFileAfterInstallerLaunch(updateApk, snapshot.target)",
    ).replace("sha256 == other.sha256", "sha256 != other.sha256"),
  };
  const report = validateAndroidProjectSources(mutated);
  assert.equal(report.valid, false);
  assert.ok(report.issues.some(({ code }) => code === ANDROID_PROJECT_ISSUE_CODES.UPDATE_ORDER));
  assert.ok(report.issues.some(({ code }) => code === ANDROID_PROJECT_ISSUE_CODES.REQUIRED_CONTRACT_MISSING));
});
