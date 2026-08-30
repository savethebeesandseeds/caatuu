import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import {
  CANONICAL_APP_ENTRY_PATH,
  STORE_LANGUAGE_FILES,
  PRODUCT_PROFILE,
  PRODUCT_COURSE_BUNDLE_ASSET,
  compileProductAssetBundle,
  compileProductAssets,
  loadAndroidCourseBundleConfiguration,
  loadAndroidCourseConfiguration,
  transformCourseProfile,
  transformIndex,
  validateProductAssetBundle,
  validateProductAssets
} from "../build-product-assets.mjs";

const workspaceRoot = new URL("../../../..", import.meta.url).pathname;
const languageStaticDir = join(workspaceRoot, "apps/languages/czech/static");
const launcherStaticDir = join(workspaceRoot, "apps/launcher/static");
const czechAssetCatalog = join(workspaceRoot, "apps/languages/czech/android-assets.json");
const mandarinAssetCatalog = join(workspaceRoot, "apps/languages/mandarin-simplified/android-assets.json");
const courseBundlePath = join(workspaceRoot, "apps/android/course-bundle.json");
const fixtureCourseManifest = join(
  workspaceRoot,
  "apps/android/tooling/tests/fixtures/no-llm-course/course.json",
);
const releasePublisher = readFileSync(join(workspaceRoot, "apps/android/tooling/publish-release.sh"), "utf8");

test("courses share one Android app document and bundle while retaining course-owned assets", () => {
  const czech = loadAndroidCourseConfiguration({ workspaceRoot });
  const fixture = loadAndroidCourseConfiguration({
    workspaceRoot,
    courseManifestPath: fixtureCourseManifest,
  });
  assert.equal(czech.appEntryPath, fixture.appEntryPath);
  assert.deepEqual(
    czech.appAssets.map(({ output }) => output),
    fixture.appAssets.map(({ output }) => output),
  );
  assert.notDeepEqual(czech.languageFiles, fixture.languageFiles);
  assert.equal(czech.productProfile.capabilities.dictionary, true);
  assert.equal(fixture.productProfile.capabilities.dictionary, false);

  const sharedOutputs = new Set(czech.appAssets.map(({ output }) => output));
  for (const path of [
    "language-runtime/static/source/app-bootstrap.mjs",
    "language-runtime/static/source/browser-shell.mjs",
    "language-runtime/static/source/caatuu-workspace.js",
    "language-runtime/static/source/product-word-world.mjs",
    "language-runtime/static/source/word-net-core.mjs",
    "language-runtime/static/source/word-net-queue.mjs",
    "language-runtime/static/source/word-world-host.mjs",
    "language-runtime/static/source/word-world-provider.mjs",
    "language-runtime/static/styles/caatuu-word-world.css",
    "assets/icons/china_flag.png",
    "assets/icons/czech_flag_ui.png",
    "assets/icons/english_flag.png",
  ]) {
    assert.ok(sharedOutputs.has(path), `shared Android app catalog must include ${path}`);
  }
  assert.ok(
    !sharedOutputs.has("language-runtime/static/source/product-shell.mjs"),
    "shared Android app catalog must not publish the retired parallel product shell",
  );

  const requiredSharedOfflinePaths = [
    "/language-runtime/static/source/app-bootstrap.mjs",
    "/language-runtime/static/source/caatuu-workspace.js",
    "/language-runtime/static/source/word-world-host.mjs",
    "/language-runtime/static/source/word-world-provider.mjs",
    "/language-runtime/static/source/product-word-world.mjs",
    "/language-runtime/static/source/word-net-core.mjs",
    "/language-runtime/static/source/word-net-queue.mjs",
  ];
  for (const [course, setupPath] of [
    ["Czech", join(workspaceRoot, "apps/languages/czech/static/setup-assets.json")],
    ["Mandarin", join(workspaceRoot, "apps/languages/mandarin-simplified/static/setup-assets.json")],
  ]) {
    const setup = JSON.parse(readFileSync(setupPath, "utf8"));
    const offlineAssets = new Set(setup.offline.assets.map(String));
    const offlinePaths = new Set([...offlineAssets].map((value) => value.split("?", 1)[0]));
    for (const path of requiredSharedOfflinePaths) {
      assert.ok(offlinePaths.has(path), `${course} offline export must include ${path}`);
    }
    assert.ok(
      !offlinePaths.has("/language-runtime/static/source/product-shell.mjs"),
      `${course} offline export must exclude the retired parallel product shell`,
    );
    assert.ok(
      offlineAssets.has("/language-runtime/static/source/shell-policy.js"),
      `${course} offline export must include the exact module dependency shell-policy.js`,
    );
  }

  const czechFiles = JSON.parse(readFileSync(czechAssetCatalog, "utf8")).files;
  const mandarinFiles = JSON.parse(readFileSync(mandarinAssetCatalog, "utf8")).files;
  const legacyCourseAsset = /(?:^|\/)(?:word-net(?:-queue)?\.(?:html|js|css|mjs)|source\/app\.mjs)$/i;
  for (const [course, files] of [["Czech", czechFiles], ["Mandarin", mandarinFiles]]) {
    assert.ok(files.every((path) => !legacyCourseAsset.test(path)), `${course} Android assets must not package a legacy Word World entry or controller`);
    assert.ok(files.includes("source/language/adapter.mjs"), `${course} Android assets must retain its language adapter`);
    assert.ok(files.includes("data/games/word-world/manifest.json"), `${course} Android assets must retain its Word World content manifest`);
  }
  assert.ok(czechFiles.includes("source/games/word-world/word-net-standard.mjs"));
  assert.ok(!czechFiles.includes("source/games/word-world/word-net-core.mjs"));
  assert.ok(czechFiles.includes("data/games/word-world/standard-v0.1/records.json"));
  assert.ok(mandarinFiles.includes("data/games/word-world/starter-v1.realizations.json"));
});

test("the Android product bundles Czech and Mandarin behind one shared app document", (t) => {
  const parent = mkdtempSync(join(tmpdir(), "caatuu-multicourse-product-test-"));
  const outputDir = join(parent, "product");
  t.after(() => rmSync(parent, { recursive: true, force: true }));

  const configuration = loadAndroidCourseBundleConfiguration({
    workspaceRoot,
    courseBundlePath,
    launcherStaticDir,
  });
  assert.equal(configuration.declaration.defaultCourseId, "cz");
  assert.deepEqual(configuration.configurations.map(({ course }) => course.id), ["cz", "zh"]);
  assert.equal(
    configuration.configurations[0].appEntryPath,
    configuration.configurations[1].appEntryPath,
    "both courses must instantiate the same canonical app entry",
  );

  const result = compileProductAssetBundle({
    workspaceRoot,
    courseBundlePath,
    launcherStaticDir,
    outputDir,
  });
  assert.ok(result.totalBytes > 60_000_000, "the package must contain the reviewed local MiniLM runtime bytes");
  assert.deepEqual(result.files.filter((path) => /(?:^|\/)index\.html$/u.test(path)), ["index.html"]);
  assert.ok(result.files.includes("courses/cz/source/shared/course-profile.js"));
  assert.ok(result.files.includes("courses/zh/source/shared/course-profile.js"));
  assert.ok(result.files.includes("courses/cz/data/games/word-world/standard-v0.1/records.json"));
  assert.ok(result.files.includes("courses/zh/data/games/word-world/starter-v1.realizations.json"));
  assert.ok(!result.files.includes("source/shared/course-profile.js"));
  assert.ok(result.files.includes("language-runtime/models/all-minilm-l6-v2-qint8-v0.1/runtime/onnx/model_qint8_arm64.onnx"));
  assert.ok(result.files.includes("language-runtime/vendor/transformers/transformers.min.js"));
  assert.ok(
    !result.files.some((path) => /^courses\/[^/]+\/vendor\/transformers\//u.test(path)),
    "course trees must reuse the single shared Transformers.js runtime",
  );

  const embeddingRuntimeCatalog = JSON.parse(readFileSync(
    join(outputDir, "language-runtime/embedding-runtimes.json"),
    "utf8",
  ));
  const sharedRuntime = embeddingRuntimeCatalog.runtimes[0];
  for (const artifact of sharedRuntime.artifacts) {
    assert.ok(result.files.includes(`language-runtime/${artifact.path}`));
  }
  const czechSetup = JSON.parse(readFileSync(join(outputDir, "courses/cz/setup-assets.json"), "utf8"));
  const czechRuntimeArtifacts = czechSetup.artifacts.filter(
    (artifact) => artifact.artifact_kind === "embedding-runtime",
  );
  assert.ok(czechRuntimeArtifacts.length > 0);
  assert.ok(czechRuntimeArtifacts.every((artifact) => artifact.url.startsWith("/language-runtime/models/")));
  assert.ok(czechRuntimeArtifacts.every((artifact) => artifact.asset_path.startsWith("language-runtime/models/")));
  assert.ok(czechSetup.offline.assets.includes("/language-runtime/vendor/transformers/transformers.min.js"));
  assert.ok(!czechSetup.offline.assets.includes("./vendor/transformers/transformers.min.js"));
  const czechVectorDb = readFileSync(join(outputDir, "courses/cz/source/shared/vector-db.js"), "utf8");
  assert.match(czechVectorDb, /defaultTransformersModuleUrl = "\/language-runtime\/vendor\/transformers\/transformers\.min\.js"/u);
  assert.match(czechVectorDb, /defaultSemanticModelPath = "\/language-runtime\/models\/"/u);
  assert.match(czechVectorDb, /defaultOrtWasmModuleUrl = "\/language-runtime\/models\//u);

  const catalog = JSON.parse(readFileSync(join(outputDir, PRODUCT_COURSE_BUNDLE_ASSET), "utf8"));
  assert.deepEqual(catalog, configuration.courseCatalog);
  assert.equal(catalog.defaultCourseId, "cz");
  const czech = catalog.courses.find(({ id }) => id === "cz");
  const mandarin = catalog.courses.find(({ id }) => id === "zh");
  assert.equal(czech.entryPath, "/cz/index.html");
  assert.equal(czech.assetPrefix, "courses/cz");
  assert.equal(czech.nativeProviders.providers.embeddings.catalogAsset, "courses/cz/data/embeddings/models.json");
  assert.equal(mandarin.entryPath, "/zh/index.html");
  assert.equal(mandarin.assetPrefix, "courses/zh");
  assert.equal(mandarin.targetLanguage.speechLocale, "zh-CN");
  assert.deepEqual(mandarin.nativeProviders.providers, {
    embeddings: {
      implementation: "webview-english-minilm-v1",
      catalogAsset: "courses/zh/data/embeddings/catalog.json",
    },
    speech: {
      implementation: "android-text-to-speech-v1",
      locale: "zh-CN",
    },
  });
  assert.equal(mandarin.capabilities.dictionary, false);
  assert.equal(mandarin.capabilities.speech, true);

  const browserEmbeddingCatalog = JSON.parse(readFileSync(
    join(workspaceRoot, "apps/languages/mandarin-simplified/static/data/embeddings/catalog.json"),
    "utf8",
  ));
  const packagedEmbeddingCatalog = JSON.parse(readFileSync(
    join(outputDir, "courses/zh/data/embeddings/catalog.json"),
    "utf8",
  ));
  assert.equal(browserEmbeddingCatalog.runtime.modelDelivery, "browser-on-demand");
  assert.equal(browserEmbeddingCatalog.runtime.androidPackaged, false);
  assert.equal(packagedEmbeddingCatalog.runtime.modelDelivery, "android-bundled");
  assert.equal(packagedEmbeddingCatalog.runtime.modelPrecached, true);
  assert.equal(packagedEmbeddingCatalog.runtime.androidPackaged, true);

  const profile = JSON.parse(readFileSync(join(outputDir, "caatuu-profile.json"), "utf8"));
  assert.equal(profile.course.id, "cz");
  assert.deepEqual(profile.assets, result.files.filter((path) => path !== "caatuu-profile.json").sort());
  assert.deepEqual(
    validateProductAssetBundle({
      outputDir,
      workspaceRoot,
      courseBundlePath,
      launcherStaticDir,
    }),
    result,
  );
});

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
  assert.equal(result.fileCount, result.files.length);
  assert.ok(result.fileCount >= 81);
  assert.ok(result.totalBytes > 1_000_000);
  assert.ok(result.files.includes("assets/icons/china_flag.png"));
  assert.ok(result.files.includes("assets/icons/czech_flag_ui.png"));
  assert.ok(result.files.includes("assets/icons/english_flag.png"));
  assert.deepEqual(
    validateProductAssets({ outputDir, languageStaticDir }),
    result
  );

  const profile = JSON.parse(readFileSync(join(outputDir, "caatuu-profile.json"), "utf8"));
  assert.deepEqual(profile, PRODUCT_PROFILE);
  assert.equal(profile.capabilities.embeddings, true);
  assert.equal(profile.capabilities.wordWorldStandardOnly, true);
  assert.equal(profile.capabilities.llm, false);
  assert.equal(profile.capabilities.generation, false);
  assert.equal(profile.capabilities.chat, false);
  assert.equal(profile.capabilities.godot, false);
  assert.equal(profile.course.id, "cz");
  assert.equal(profile.schemaVersion, 2);
  assert.equal(profile.course.targetLanguage.locale, "cs-CZ");
  assert.deepEqual(profile.nativeProviders, {
    schemaVersion: 1,
    providers: {
      embeddings: {
        implementation: "vector-database-catalog-v1",
        catalogAsset: "data/embeddings/models.json",
      },
      dictionary: {
        implementation: "sqlite-dictionary-catalog-v1",
        catalogAsset: "data/dictionaries/catalog.json",
      },
      speech: {
        implementation: "android-text-to-speech-v1",
        locale: "cs-CZ",
      },
    },
  });
  assert.deepEqual(profile.assets, result.files.filter((path) => path !== "caatuu-profile.json").sort());
  assert.equal(profile.privacy.dictionaryGapReportsLocalOnly, true);
  assert.ok(!STORE_LANGUAGE_FILES.includes("index.html"));
  const canonicalAppEntry = readFileSync(join(workspaceRoot, CANONICAL_APP_ENTRY_PATH), "utf8");
  const productAppEntry = readFileSync(join(outputDir, "index.html"), "utf8");
  assert.equal(
    productAppEntry,
    transformIndex(canonicalAppEntry),
    "the product package must use the reviewed transform of the canonical app document",
  );
  assert.match(canonicalAppEntry, /wordNetGenerativeDialog/u);
  assert.doesNotMatch(productAppEntry, /wordNetGenerativeDialog|data-content-mode=["']generative["']|Generative mode/iu);
  assert.ok(result.files.includes("language-runtime/contract.mjs"));
  assert.ok(result.files.includes("language-runtime/static/source/app-bootstrap.mjs"));
  assert.ok(result.files.includes("language-runtime/static/source/browser-shell.mjs"));
  assert.ok(result.files.includes("language-runtime/static/source/course-service-worker.js"));
  assert.ok(result.files.includes("language-runtime/static/source/caatuu-chrome.js"));
  assert.ok(result.files.includes("language-runtime/static/source/caatuu-workspace.js"));
  assert.ok(result.files.includes("language-runtime/static/source/learning-profile.js"));
  assert.ok(result.files.includes("language-runtime/static/source/product-word-world.mjs"));
  assert.ok(result.files.includes("language-runtime/static/source/word-net-core.mjs"));
  assert.ok(result.files.includes("language-runtime/static/source/word-net-queue.mjs"));
  assert.ok(result.files.includes("language-runtime/static/source/word-world-host.mjs"));
  assert.ok(result.files.includes("language-runtime/static/source/word-world-provider.mjs"));
  assert.ok(result.files.includes("language-runtime/static/styles/caatuu-chrome.css"));
  assert.ok(result.files.includes("language-runtime/static/styles/caatuu-home.css"));
  assert.ok(result.files.includes("language-runtime/static/styles/caatuu-theme.css"));
  assert.ok(result.files.includes("language-runtime/static/styles/caatuu-word-world.css"));
  assert.ok(result.files.includes("language-runtime/static/styles/caatuu-workspace.css"));
  for (const path of [
    "word-net.html",
    "source/games/word-world/word-net.css",
    "source/games/word-world/word-net-core.mjs",
    "source/games/word-world/word-net.js",
    "source/games/word-world/word-net-queue.mjs",
    "language-runtime/static/source/product-shell.mjs",
    "source/features/home/home.css",
    "source/games/verb-nebula/app.css",
    "source/games/verb-nebula/app.js",
    "source/shared/chrome.css",
    "source/shared/chrome.js",
    "source/shared/learning-profile.js",
    "source/shared/theme.css",
    "language-runtime/static/styles/course-shell.css",
  ]) {
    assert.ok(!result.files.includes(path), `product package must exclude ${path}`);
  }
  const application = loadAndroidCourseConfiguration({ workspaceRoot });
  for (const path of [
    "language-runtime/static/source/app-bootstrap.mjs",
    "language-runtime/static/source/browser-shell.mjs",
    "language-runtime/static/source/caatuu-workspace.js",
    "language-runtime/static/source/learning-profile.js",
    "language-runtime/static/source/product-word-world.mjs",
    "language-runtime/static/source/word-net-core.mjs",
    "language-runtime/static/source/word-net-queue.mjs",
    "language-runtime/static/source/word-world-host.mjs",
    "language-runtime/static/source/word-world-provider.mjs",
    "language-runtime/static/styles/caatuu-word-world.css",
    "language-runtime/static/styles/caatuu-theme.css",
    "language-runtime/static/styles/caatuu-workspace.css",
  ]) {
    const source = application.appAssets.find(({ output }) => output === path)?.source;
    assert.ok(source, `shared app catalog must resolve ${path}`);
    assert.deepEqual(
      readFileSync(join(outputDir, path)),
      readFileSync(source),
      `product package must retain canonical shared app asset byte-for-byte: ${path}`,
    );
  }

  const includedConjugationFiles = [
    "conjugation-comet.html",
    "source/games/conjugation-comet/conjugation-comet.css",
    "source/games/conjugation-comet/conjugation-comet.js",
    "data/games/conjugation-comet/verbs.json"
  ];
  assert.ok(STORE_LANGUAGE_FILES.includes("source/shared/child-facing-assets.mjs"));
  assert.ok(result.files.includes("source/shared/child-facing-assets.mjs"));
  assert.ok(STORE_LANGUAGE_FILES.includes("source/features/campaign/campaign.css"));
  assert.ok(result.files.includes("source/features/campaign/campaign.css"));
  for (const path of includedConjugationFiles) {
    assert.ok(STORE_LANGUAGE_FILES.includes(path), `product allowlist must include ${path}`);
    assert.ok(result.files.includes(path), `compiled product surface must include ${path}`);
  }
  for (const path of [
    "index.html",
    "setup-assets.json",
    "language-runtime/static/styles/caatuu-workspace.css",
    "language-runtime/static/source/caatuu-workspace.js",
    "language-runtime/static/source/caatuu-chrome.js",
    "source/shared/course-profile.js"
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

test("a no-LLM embedding course compiles from its manifest without Czech dictionary or model assumptions", (t) => {
  const parent = mkdtempSync(join(tmpdir(), "caatuu-product-fixture-test-"));
  const outputDir = join(parent, "product");
  const czechOutputDir = join(parent, "czech-product");
  t.after(() => rmSync(parent, { recursive: true, force: true }));

  const configuration = loadAndroidCourseConfiguration({
    workspaceRoot,
    courseManifestPath: fixtureCourseManifest,
  });
  assert.equal(configuration.course.id, "fixture-no-llm");
  assert.equal(configuration.productProfile.capabilities.llm, false);
  assert.equal(configuration.productProfile.capabilities.embeddings, true);
  assert.equal(configuration.productProfile.capabilities.dictionary, false);
  assert.equal(configuration.productProfile.course.id, "fixture-no-llm");
  assert.equal(configuration.productProfile.course.sourceLanguage.id, "en");
  assert.equal(configuration.appEntryPath, join(workspaceRoot, CANONICAL_APP_ENTRY_PATH));
  assert.ok(!configuration.languageFiles.includes("index.html"));
  assert.deepEqual(configuration.nativeProviders, {
    schemaVersion: 1,
    providers: {
      embeddings: {
        implementation: "vector-database-catalog-v1",
        catalogAsset: "native/semantic/catalog.json",
      },
    },
  });

  const result = compileProductAssets({
    workspaceRoot,
    courseManifestPath: fixtureCourseManifest,
    launcherStaticDir,
    outputDir,
  });
  assert.ok(result.files.includes("native/semantic/catalog.json"));
  assert.ok(result.files.includes("native/semantic/english-minilm/manifest.json"));
  assert.ok(!result.files.includes("data/embeddings/models.json"));
  assert.ok(result.files.includes("language-runtime/contract.mjs"));
  assert.ok(result.files.includes("language-runtime/static/source/catalog-runtime.mjs"));
  assert.equal(
    readFileSync(join(outputDir, "index.html"), "utf8"),
    transformIndex(readFileSync(join(workspaceRoot, CANONICAL_APP_ENTRY_PATH), "utf8")),
  );
  compileProductAssets({
    workspaceRoot,
    launcherStaticDir,
    outputDir: czechOutputDir,
  });
  for (const path of ["index.html", ...configuration.appAssets.map(({ output }) => output)]) {
    assert.deepEqual(
      readFileSync(join(outputDir, path)),
      readFileSync(join(czechOutputDir, path)),
      `shared Android app asset must be course-independent: ${path}`,
    );
  }
  assert.ok(result.files.every((path) => !path.startsWith("data/dictionaries/")));
  assert.ok(result.files.every((path) => !path.startsWith("data/models/")));
  assert.deepEqual(
    validateProductAssets({
      outputDir,
      workspaceRoot,
      courseManifestPath: fixtureCourseManifest,
    }),
    result,
  );
});

test("product transforms fail closed when an expected development anchor drifts", () => {
  const source = readFileSync(join(languageStaticDir, "source/shared/course-profile.js"), "utf8");
  const transformed = transformCourseProfile(source);
  assert.match(transformed, /llm: false/);
  assert.match(transformed, /generation: false/);
  assert.match(transformed, /chat: false/);
  assert.match(transformed, /offlineModels: false/);
  assert.throws(
    () => transformCourseProfile(source.replace("      chat: true,", "      chat: maybe,")),
    /course chat capability: expected 1 exact source anchor/
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
