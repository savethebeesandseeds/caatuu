import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import {
  CANONICAL_APP_ENTRY_PATH,
  STORE_LANGUAGE_FILES,
  PRODUCT_PROFILE,
  PRODUCT_COURSE_BUNDLE_ASSET,
  assertAndroidBundleSharedStorage,
  compileProductAssetBundle,
  compileProductAssets,
  exactWorkspaceSource,
  loadAndroidCourseBundleConfiguration,
  loadAndroidCourseConfiguration,
  transformCourseProfile,
  transformIndex,
  transformWordWorldManifest,
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
const generativeFixtureRoot = join(
  workspaceRoot,
  "apps/android/tooling/tests/fixtures/generative-course",
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
    "assets/icons/homebase_icon.png",
    "assets/icons/social_icon.png",
    "assets/icons/store_icon.png",
    ...Array.from({ length: 16 }, (_value, index) => `assets/stores/stores (${index + 1}).png`),
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
    const offlinePaths = new Set([...offlineAssets].map((value) => value.split(/[?#]/u, 1)[0]));
    for (const path of requiredSharedOfflinePaths) {
      assert.ok(offlinePaths.has(path), `${course} offline export must include ${path}`);
    }
    assert.ok(
      !offlinePaths.has("/language-runtime/static/source/product-shell.mjs"),
      `${course} offline export must exclude the retired parallel product shell`,
    );
    assert.ok(
      offlinePaths.has("/language-runtime/static/source/shell-policy.js"),
      `${course} offline export must include the module dependency shell-policy.js by pathname`,
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

test("Android course bundles allow one shared storage owner only for an identical artifact", () => {
  const bundle = loadAndroidCourseBundleConfiguration({
    workspaceRoot,
    courseBundlePath,
    launcherStaticDir,
  });
  const mandarin = bundle.configurations.find(({ course }) => course.id === "zh");
  assert.ok(mandarin, "the fixture must include the Mandarin course");
  const secondCourse = {
    ...mandarin,
    course: {
      ...mandarin.course,
      id: "zh-second-course",
    },
  };
  assert.doesNotThrow(() => assertAndroidBundleSharedStorage(
    [mandarin, secondCourse],
    bundle.embeddingRuntime,
  ));
});

test("Android packaging rejects leaf and intermediate physical-source aliases", (t) => {
  const root = mkdtempSync(join(tmpdir(), "caatuu-android-source-pin-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const canonical = join(root, "canonical");
  const alternate = join(root, "alternate");
  mkdirSync(join(canonical, "nested"), { recursive: true });
  mkdirSync(alternate, { recursive: true });
  writeFileSync(join(canonical, "asset.js"), "canonical\n");
  writeFileSync(join(alternate, "asset.js"), "alternate\n");
  assert.equal(
    exactWorkspaceSource(root, "canonical/asset.js", "course file", { kind: "file" }),
    join(canonical, "asset.js"),
  );

  symlinkSync(join(alternate, "asset.js"), join(canonical, "alias.js"));
  assert.throws(
    () => exactWorkspaceSource(root, "canonical/alias.js", "shared app file", { kind: "file" }),
    /must not be a symbolic-link alias|exact declared physical source/u,
  );

  symlinkSync(alternate, join(canonical, "nested", "alias-root"), "dir");
  assert.throws(
    () => exactWorkspaceSource(root, "canonical/nested/alias-root/asset.js", "course file", { kind: "file" }),
    /exact declared physical source/u,
  );
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
  // Guardrail with roughly 5% headroom after the intentional shared store/home,
  // Sounds Quasar, and shared grammar-game assets.
  assert.ok(result.totalBytes < 36_500_000, "the media-rich package must remain bounded while MiniLM stays in setup delivery");
  assert.deepEqual(result.files.filter((path) => /(?:^|\/)index\.html$/u.test(path)), ["index.html"]);
  assert.ok(result.files.includes("courses/cz/source/shared/course-profile.js"));
  assert.ok(result.files.includes("courses/zh/source/shared/course-profile.js"));
  assert.ok(result.files.includes("courses/cz/data/games/word-world/standard-v0.1/records.json"));
  assert.ok(result.files.includes("courses/zh/data/games/word-world/starter-v1.realizations.json"));
  assert.ok(!result.files.includes("source/shared/course-profile.js"));
  assert.ok(!result.files.includes("language-runtime/models/all-minilm-l6-v2-qint8-v0.1/runtime/onnx/model_qint8_arm64.onnx"));
  assert.ok(!result.files.includes("language-runtime/vendor/transformers/transformers.min.js"));
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
    assert.ok(!result.files.includes(`language-runtime/${artifact.path}`));
  }
  const czechSetup = JSON.parse(readFileSync(join(outputDir, "courses/cz/setup-assets.json"), "utf8"));
  const agreementAurora = czechSetup.artifacts.filter(
    (artifact) => artifact.key === "planet-agreement-aurora",
  );
  assert.equal(agreementAurora.length, 1);
  assert.equal(
    agreementAurora[0].url,
    "/assets/planets/releases/5fe5c25467d51dbe/agreement-aurora.png",
    "the Android setup contract must not reuse release 162's immutable public artwork URL",
  );
  assert.equal(
    agreementAurora[0].asset_path,
    "assets/planets/agreement-aurora.png",
    "the Android package must retain its canonical local artwork path",
  );
  const czechRuntimeArtifacts = czechSetup.artifacts.filter(
    (artifact) => artifact.artifact_kind === "embedding-runtime",
  );
  const mandarinSetup = JSON.parse(readFileSync(join(outputDir, "courses/zh/setup-assets.json"), "utf8"));
  const mandarinRuntimeArtifacts = mandarinSetup.artifacts.filter(
    (artifact) => artifact.artifact_kind === "embedding-runtime",
  );
  assert.equal(czechRuntimeArtifacts.length, sharedRuntime.artifacts.length);
  assert.equal(mandarinRuntimeArtifacts.length, sharedRuntime.artifacts.length);
  assert.deepEqual(
    czechRuntimeArtifacts.map(({ asset_path }) => asset_path),
    mandarinRuntimeArtifacts.map(({ asset_path }) => asset_path),
  );
  assert.ok(czechRuntimeArtifacts.every((artifact) => artifact.url.startsWith("/language-runtime/")));
  assert.ok(czechRuntimeArtifacts.every((artifact) => artifact.asset_path.startsWith("language-runtime/")));
  assert.ok(czechRuntimeArtifacts.every((artifact) => artifact.native_required === true));
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
  assert.equal(packagedEmbeddingCatalog.runtime.modelDelivery, "android-setup-download");
  assert.equal(packagedEmbeddingCatalog.runtime.modelPrecached, false);
  assert.equal(packagedEmbeddingCatalog.runtime.androidPackaged, false);

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
    "conjugation-comet.html",
    "agreement-aurora.html",
    "source/games/conjugation-comet/conjugation-comet.css",
    "source/games/conjugation-comet/conjugation-comet.js",
    "source/games/agreement-aurora/agreement-aurora.css",
    "source/games/agreement-aurora/agreement-aurora.js",
    "source/games/agreement-aurora/launcher.css",
    "source/games/case-cosmos/launcher.css",
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
    "language-runtime/static/games/agreement-aurora.html",
    "language-runtime/static/games/conjugation-comet.html",
    "language-runtime/static/source/games/course-game-content.mjs",
    "language-runtime/static/source/games/agreement-aurora/agreement-aurora-core.mjs",
    "language-runtime/static/source/games/agreement-aurora/agreement-aurora-host.mjs",
    "language-runtime/static/source/games/conjugation-comet/conjugation-comet-core.mjs",
    "language-runtime/static/source/games/conjugation-comet/conjugation-comet-host.mjs",
    "language-runtime/static/styles/games/agreement-aurora.css",
    "language-runtime/static/styles/games/conjugation-comet.css",
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

  const includedCourseGameContent = [
    "data/games/conjugation-comet/verbs.json",
    "data/games/agreement-aurora/challenges.json"
  ];
  assert.ok(STORE_LANGUAGE_FILES.includes("source/shared/child-facing-assets.mjs"));
  assert.ok(result.files.includes("source/shared/child-facing-assets.mjs"));
  assert.ok(STORE_LANGUAGE_FILES.includes("source/features/campaign/campaign.css"));
  assert.ok(result.files.includes("source/features/campaign/campaign.css"));
  for (const path of includedCourseGameContent) {
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

test("Android Word World packaging removes generation strategy without changing its runtime authority", () => {
  const source = JSON.stringify({
    corpusVersion: "standard-v0.1",
    sessionProvider: {
      kind: "standard-corpus",
      module: "source/games/word-world/word-net-standard.mjs?v=word-net-standard-5",
    },
    generationStrategy: {
      id: "course-local-generation-v1",
    },
  });
  const transformed = JSON.parse(transformWordWorldManifest(source));

  assert.equal(transformed.generationStrategy, undefined);
  assert.equal(transformed.corpusVersion, "standard-v0.1");
  assert.deepEqual(transformed.sessionProvider, {
    kind: "standard-corpus",
    module: "source/games/word-world/word-net-standard.mjs?v=word-net-standard-5",
  });
});

test("a non-Czech generative browser course compiles into the shared Standard-only Android contract", (t) => {
  const parent = mkdtempSync(join(tmpdir(), "caatuu-generative-course-product-test-"));
  const outputDir = join(parent, "product");
  t.after(() => rmSync(parent, { recursive: true, force: true }));

  const options = {
    workspaceRoot,
    courseBundlePath: join(generativeFixtureRoot, "course-bundle.json"),
    languageCatalogPath: join(generativeFixtureRoot, "language-catalog.json"),
    launcherStaticDir,
    outputDir,
  };
  const result = compileProductAssetBundle(options);
  assert.deepEqual(validateProductAssetBundle(options), result);

  const runtimeCatalog = JSON.parse(readFileSync(join(outputDir, PRODUCT_COURSE_BUNDLE_ASSET), "utf8"));
  const course = runtimeCatalog.courses[0];
  assert.equal(course.id, "fixture-gen");
  for (const name of ["llm", "generation", "chat", "offlineModels"]) {
    assert.equal(course.capabilities[name], false, `Android runtime catalog must disable ${name}`);
  }

  const courseRoot = join(outputDir, "courses/fixture-gen");
  const profile = readFileSync(join(courseRoot, "source/shared/course-profile.js"), "utf8");
  assert.doesNotMatch(profile, /(?:llm|generation|chat|offlineModels): true/u);
  assert.doesNotMatch(profile, /chat\.html|audio-lab\.html|embedding-images\.html|chatSettings/u);
  assert.match(profile, /wordWorld: "index\.html\?game=word-net"/u);
  assert.match(profile, /android:\s*\{\s*enabled: true,\s*channels: \[\]/u);

  const wordWorld = JSON.parse(readFileSync(join(courseRoot, "data/games/word-world/manifest.json"), "utf8"));
  assert.equal(wordWorld.generationStrategy, undefined);
  assert.equal(wordWorld.sessionProvider.module, "source/games/word-world/standard-provider.mjs?v=fixture-standard-1");
  for (const name of ["llm", "generation", "chat", "offlineModels"]) {
    assert.equal(wordWorld.capabilities[name], false, `Word World manifest must disable ${name}`);
  }

  const setup = JSON.parse(readFileSync(join(courseRoot, "setup-assets.json"), "utf8"));
  assert.deepEqual(setup.artifacts.map(({ key }) => key), ["fixture-standard-content"]);
  assert.ok(setup.offline.assets.every((asset) => !/chat|data\/models|gguf/iu.test(asset)));
  const webManifest = JSON.parse(readFileSync(join(courseRoot, "manifest.webmanifest"), "utf8"));
  assert.ok(webManifest.shortcuts.every((shortcut) => !/chat/iu.test(JSON.stringify(shortcut))));
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

test("pending native review remains advisory for Android publication", () => {
  const configuration = loadAndroidCourseBundleConfiguration({
    workspaceRoot,
    courseBundlePath,
    launcherStaticDir,
  });
  const mandarin = configuration.configurations.find(({ course }) => course.id === "zh");
  const realizations = JSON.parse(readFileSync(join(
    workspaceRoot,
    "apps/languages/mandarin-simplified/content/word-world/starter-v1.realizations.json",
  ), "utf8"));

  assert.equal(mandarin.course.status, "development");
  assert.equal(mandarin.course.platforms.android.enabled, true);
  assert.ok(mandarin.course.platforms.android.channels.some(({ kind }) => kind === "release"));
  assert.equal(realizations.review.status, "native-review-required");
  assert.match(
    releasePublisher,
    /node\s+"?\$repo_root\/tools\/language-content\/validate\.mjs"?\s+--release/u,
    "the APK publisher must enforce the licensing-only language-content release gate",
  );
  assert.doesNotMatch(
    releasePublisher,
    /(?:--require-native-review|activation\.native-review|release\.native-review)/u,
    "the APK publisher must not invoke the active-course native-review gate",
  );
});
