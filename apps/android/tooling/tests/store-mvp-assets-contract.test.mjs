import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  STORE_MVP_PROFILE,
  compileStoreMvpAssets,
  transformCourseProfile,
  validateStoreMvpAssets
} from "../build-store-mvp-assets.mjs";

const workspaceRoot = new URL("../../../..", import.meta.url).pathname;
const languageStaticDir = join(workspaceRoot, "apps/languages/czech/static");
const launcherStaticDir = join(workspaceRoot, "apps/launcher/static");

test("storeMvp assets compile from an exact capability-safe allowlist", (t) => {
  const parent = mkdtempSync(join(tmpdir(), "caatuu-store-mvp-test-"));
  const outputDir = join(parent, "store-mvp");
  t.after(() => rmSync(parent, { recursive: true, force: true }));

  const result = compileStoreMvpAssets({
    workspaceRoot,
    languageStaticDir,
    launcherStaticDir,
    outputDir
  });
  assert.ok(result.fileCount >= 80);
  assert.ok(result.totalBytes > 1_000_000);
  assert.deepEqual(
    validateStoreMvpAssets({ outputDir, languageStaticDir }),
    result
  );

  const profile = JSON.parse(readFileSync(join(outputDir, "store-mvp-profile.json"), "utf8"));
  assert.deepEqual(profile, STORE_MVP_PROFILE);
  assert.equal(profile.capabilities.embeddings, true);
  assert.equal(profile.capabilities.wordWorldStandardOnly, true);
  assert.equal(profile.capabilities.llm, false);
  assert.equal(profile.capabilities.godot, false);
  assert.equal(profile.privacy.dictionaryGapReportsLocalOnly, true);
});

test("storeMvp transforms fail closed when an expected development anchor drifts", () => {
  const source = readFileSync(join(languageStaticDir, "source/shared/course-profile.js"), "utf8");
  assert.throws(
    () => transformCourseProfile(source.replace("      chat: true,", "      chat: maybe,")),
    /course chat capability: expected 1 exact source anchor/
  );
});

test("storeMvp compiler refuses an arbitrary in-workspace output directory", () => {
  assert.throws(
    () => compileStoreMvpAssets({
      workspaceRoot,
      languageStaticDir,
      launcherStaticDir,
      outputDir: join(workspaceRoot, "artifacts/store-mvp")
    }),
    /In-workspace store output must be inside/
  );
});
