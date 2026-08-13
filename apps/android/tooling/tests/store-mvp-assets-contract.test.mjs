import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  STORE_LANGUAGE_FILES,
  STORE_MVP_PROFILE,
  compileStoreMvpAssets,
  transformCourseProfile,
  transformIndex,
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
  assert.equal(result.fileCount, 81);
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

  const excludedConjugationFiles = [
    "conjugation-comet.html",
    "source/games/conjugation-comet/conjugation-comet.css",
    "source/games/conjugation-comet/conjugation-comet.js",
    "data/games/conjugation-comet/verbs.json"
  ];
  for (const path of excludedConjugationFiles) {
    assert.ok(!STORE_LANGUAGE_FILES.includes(path), `store allowlist must exclude ${path}`);
    assert.ok(!result.files.includes(path), `compiled store surface must exclude ${path}`);
  }
  for (const path of [
    "index.html",
    "setup-assets.json",
    "source/games/verb-nebula/app.css",
    "source/games/verb-nebula/app.js",
    "source/shared/chrome.js",
    "source/shared/course-profile.js",
    "sw.js"
  ]) {
    assert.doesNotMatch(
      readFileSync(join(outputDir, path), "utf8"),
      /conjugation(?:[- ]?comet)|train-world-comet/i,
      `${path} must not retain Conjugation Comet presentation or navigation`
    );
  }
});

test("storeMvp transforms fail closed when an expected development anchor drifts", () => {
  const source = readFileSync(join(languageStaticDir, "source/shared/course-profile.js"), "utf8");
  assert.throws(
    () => transformCourseProfile(source.replace("      chat: true,", "      chat: maybe,")),
    /course chat capability: expected 1 exact source anchor/
  );

  const index = readFileSync(join(languageStaticDir, "index.html"), "utf8");
  assert.throws(
    () => transformIndex(index.replace("train-world train-world-comet", "train-world train-world-drifted")),
    /home Conjugation Comet launcher: expected one start anchor/
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
