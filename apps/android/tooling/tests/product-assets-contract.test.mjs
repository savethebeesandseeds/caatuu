import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import {
  STORE_LANGUAGE_FILES,
  PRODUCT_PROFILE,
  compileProductAssets,
  transformCourseProfile,
  transformWordNetJs,
  validateProductAssets
} from "../build-product-assets.mjs";

const workspaceRoot = new URL("../../../..", import.meta.url).pathname;
const languageStaticDir = join(workspaceRoot, "apps/languages/czech/static");
const launcherStaticDir = join(workspaceRoot, "apps/launcher/static");
const releasePublisher = readFileSync(join(workspaceRoot, "apps/android/tooling/publish-release.sh"), "utf8");

test("product assets compile from an exact capability-safe allowlist", async (t) => {
  const parent = mkdtempSync(join(tmpdir(), "caatuu-product-test-"));
  const outputDir = join(parent, "product");
  t.after(() => rmSync(parent, { recursive: true, force: true }));

  const result = compileProductAssets({
    workspaceRoot,
    languageStaticDir,
    launcherStaticDir,
    outputDir
  });
  assert.equal(result.fileCount, 86);
  assert.ok(result.totalBytes > 1_000_000);
  assert.deepEqual(
    validateProductAssets({ outputDir, languageStaticDir }),
    result
  );

  const profile = JSON.parse(readFileSync(join(outputDir, "caatuu-profile.json"), "utf8"));
  assert.deepEqual(profile, PRODUCT_PROFILE);
  assert.equal(profile.capabilities.embeddings, true);
  assert.equal(profile.capabilities.wordWorldStandardOnly, true);
  assert.equal(profile.capabilities.llm, false);
  assert.equal(profile.capabilities.godot, false);
  assert.equal(profile.privacy.dictionaryGapReportsLocalOnly, true);

  const includedConjugationFiles = [
    "conjugation-comet.html",
    "source/games/conjugation-comet/conjugation-comet.css",
    "source/games/conjugation-comet/conjugation-comet.js",
    "data/games/conjugation-comet/verbs.json"
  ];
  assert.ok(STORE_LANGUAGE_FILES.includes("source/shared/child-facing-assets.mjs"));
  assert.ok(result.files.includes("source/shared/child-facing-assets.mjs"));
  for (const path of includedConjugationFiles) {
    assert.ok(STORE_LANGUAGE_FILES.includes(path), `product allowlist must include ${path}`);
    assert.ok(result.files.includes(path), `compiled product surface must include ${path}`);
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
    assert.match(
      readFileSync(join(outputDir, path), "utf8"),
      /conjugation(?:[- ]?comet)|train-world-comet/i,
      `${path} must retain Conjugation Comet presentation or navigation`
    );
  }

  const standardRuntimeUrl = pathToFileURL(join(
    outputDir,
    "source/games/word-world/word-net-standard.mjs",
  ));
  standardRuntimeUrl.searchParams.set("contract", String(Date.now()));
  const { loadStandardWordWorldCorpus } = await import(standardRuntimeUrl.href);
  const provider = await loadStandardWordWorldCorpus({
    manifestUrl: "https://caatuu.test/data/games/word-world/manifest.json",
    fetchImpl: async (request) => {
      const url = new URL(request);
      const file = join(outputDir, decodeURIComponent(url.pathname).replace(/^\/+/, ""));
      return new Response(readFileSync(file), { status: 200 });
    },
  });
  assert.equal(provider.size, 792, "the generated Standard-only runtime must load all curated records");
  assert.ok(provider.nextRandom({ difficulty: 1 })?.record, "the generated runtime must select a playable first turn");
});

test("product transforms fail closed when an expected development anchor drifts", () => {
  const source = readFileSync(join(languageStaticDir, "source/shared/course-profile.js"), "utf8");
  assert.throws(
    () => transformCourseProfile(source.replace("      chat: true,", "      chat: maybe,")),
    /course chat capability: expected 1 exact source anchor/
  );

  const wordWorld = readFileSync(join(languageStaticDir, "source/games/word-world/word-net.js"), "utf8");
  assert.throws(
    () => transformWordNetJs(wordWorld.replace("const PREPARED_QUEUE_CAPACITY = 512;", "const PREPARED_QUEUE_CAPACITY = 513;")),
    /Word World prepared queue constants: expected 1 exact source anchor/
  );
});

test("product validation rejects unsafe learner text after compilation", (t) => {
  const parent = mkdtempSync(join(tmpdir(), "caatuu-product-safety-test-"));
  const outputDir = join(parent, "product");
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  compileProductAssets({ workspaceRoot, languageStaticDir, launcherStaticDir, outputDir });

  const runtimeFile = join(outputDir, "data/games/word-world/standard-v0.1/records.json");
  const runtime = JSON.parse(readFileSync(runtimeFile, "utf8"));
  runtime.records[0].en = "I have two balls.";
  runtime.records[0].sceneQuery = "I have two balls";
  writeFileSync(runtimeFile, `${JSON.stringify(runtime)}\n`, "utf8");

  assert.throws(
    () => validateProductAssets({ outputDir, languageStaticDir }),
    /unresolved deterministic safety findings[\s\S]*ambiguous-first-person-balls/i
  );
});

test("product compiler refuses an arbitrary in-workspace output directory", () => {
  assert.throws(
    () => compileProductAssets({
      workspaceRoot,
      languageStaticDir,
      launcherStaticDir,
      outputDir: join(workspaceRoot, "artifacts/product")
    }),
    /In-workspace store output must be inside/
  );
});

test("publication treats every packaged Czech application file as release input", () => {
  const unrelatedDirtyBlock = releasePublisher.match(/allowed_unrelated_dirty_paths=\(([\s\S]*?)\n\)/)?.[1] || "";
  assert.doesNotMatch(unrelatedDirtyBlock, /apps\/languages\/czech\/static/);
});
