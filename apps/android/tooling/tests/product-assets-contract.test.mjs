import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { runInNewContext } from "node:vm";

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
  transformChromeJs,
  transformCourseProfile,
  transformDeveloperBrowserModelService,
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

function readPackagedCourseProfile(profilePath) {
  const context = { window: {} };
  runInNewContext(readFileSync(profilePath, "utf8"), context, { filename: profilePath });
  assert.ok(context.window.CaatuuCourse, `${profilePath} must define window.CaatuuCourse`);
  return context.window.CaatuuCourse;
}

test("global developer tools remain available when product packaging removes model settings", () => {
  const source = readFileSync(join(workspaceRoot, "apps/language-runtime/static/source/caatuu-chrome.js"), "utf8");
  const transformed = transformChromeJs(source);
  const start = source.indexOf('          <section class="settings-card side-card developer-tools-card"');
  const end = source.indexOf('          <section class="settings-card side-card maintenance-card"', start);
  assert.ok(start >= 0 && end > start, "The canonical developer tools card has its own Settings boundary");
  assert.ok(transformed.includes(source.slice(start, end)), "Product packaging must preserve the entire global developer card");
  assert.match(transformed, /mountDeveloperTools\(\{\s*root,\s*screenRoot,\s*host:\s*window,\s*course\b/u);
  assert.doesNotMatch(transformed, /<section class="settings-card side-card ai-settings-card"/u);
  assert.doesNotMatch(transformed, /href: routes\.(?:audioLab|embeddingImages|verbDifficulty)/u);
});

test("the product developer model adapter reports unavailability without downloaded engine or network-loader bytes", async () => {
  const source = readFileSync(join(workspaceRoot, "apps/language-runtime/static/source/developer-tools/browser-model-service.mjs"), "utf8");
  const transformed = transformDeveloperBrowserModelService(source);
  assert.doesNotMatch(transformed, /webllm|web-llm|qwen|cstinyllama|gguf|esm\.run|huggingface|CreateMLCEngine|fetch\s*\(|import\s*\(/iu);
  const adapter = await import(`data:text/javascript;base64,${Buffer.from(transformed).toString("base64")}`);
  assert.equal(adapter.BROWSER_CHAT_SUPPORTED, false);
  const service = await adapter.createBrowserModelService({
    importModule() { assert.fail("A product diagnostic must never load a browser model engine"); }
  });
  assert.deepEqual(service, { available: false, reason: "product" });
});

test("global developer resources and declared course inspection data survive the compiled product bundle", async (t) => {
  const parent = mkdtempSync(join(tmpdir(), "caatuu-developer-product-test-"));
  const outputDir = join(parent, "product");
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const configuration = loadAndroidCourseBundleConfiguration({ workspaceRoot, courseBundlePath, launcherStaticDir });
  const result = compileProductAssetBundle({ workspaceRoot, courseBundlePath, launcherStaticDir, outputDir });
  const files = new Set(result.files);
  const sharedTools = [
    "language-runtime/static/source/developer-tools/developer-tools.mjs",
    "language-runtime/static/source/developer-tools/audio-lab.mjs",
    "language-runtime/static/source/developer-tools/catalog-inspectors.mjs",
    "language-runtime/static/source/developer-tools/model-tools.mjs",
    "language-runtime/static/source/developer-tools/browser-model-service.mjs",
    "language-runtime/static/styles/caatuu-developer-tools.css"
  ];
  for (const path of sharedTools) {
    assert.ok(files.has(path), `The global developer surface must package ${path}`);
    assert.ok(readFileSync(join(outputDir, path)).length > 0, `${path} must contain its implementation`);
  }
  const adapterPath = sharedTools.find((path) => path.endsWith("browser-model-service.mjs"));
  const packagedAdapter = readFileSync(join(outputDir, adapterPath), "utf8");
  assert.doesNotMatch(packagedAdapter, /webllm|web-llm|qwen|esm\.run|CreateMLCEngine/iu);
  const adapter = await import(pathToFileURL(join(outputDir, adapterPath)).href);
  assert.equal(adapter.BROWSER_CHAT_SUPPORTED, false);
  assert.deepEqual(await adapter.createBrowserModelService(), { available: false, reason: "product" });
  const chrome = readFileSync(join(outputDir, "language-runtime/static/source/caatuu-chrome.js"), "utf8");
  assert.match(chrome, /class="settings-card side-card developer-tools-card"/u);

  for (const { course, languageFileSources } of configuration.configurations) {
    const original = readPackagedCourseProfile(languageFileSources["source/shared/course-profile.js"]);
    const packaged = readPackagedCourseProfile(join(outputDir, `courses/${course.id}/source/shared/course-profile.js`));
    assert.deepEqual(JSON.parse(JSON.stringify(packaged.gameContent)), JSON.parse(JSON.stringify(original.gameContent)));
    assert.equal(packaged.capabilities.chat, false);
    for (const { course: selected } of configuration.configurations) {
      const before = original.courseSelector.courses.find((record) => record.id === selected.id);
      const after = packaged.courseSelector.courses.find((record) => record.id === selected.id);
      assert.ok(before?.developerContext, `${course.id} must declare the ${selected.id} inspection context`);
      assert.deepEqual(JSON.parse(JSON.stringify(after?.developerContext)), JSON.parse(JSON.stringify(before.developerContext)),
        `${course.id} product transformation must preserve ${selected.id} resource declarations`);
      assert.equal(after.targetLanguage.speechLocale, before.targetLanguage.speechLocale);
      const paths = [after.developerContext.gameContent?.["verb-lab"]?.verbNebulaCatalog];
      for (const key of ["catalog", "coreEntries", "scriptLines", "referenceDocument"]) {
        const path = after.developerContext.dictionaryContent?.[key];
        if (path) paths.push(path);
      }
      assert.ok(paths[0], `${selected.id} declares its playable Verb Nebula catalog for inspection`);
      for (const value of paths) {
        const path = String(value).split(/[?#]/u, 1)[0];
        assert.ok(files.has(`courses/${selected.id}/${path}`), `${course.id} developer tools would otherwise request missing ${selected.id} data: ${value}`);
      }
    }
  }
});

test("Grammar Gravity lane imagery and paper texture share one exact offline asset mapping", () => {
  const catalog = JSON.parse(readFileSync(join(workspaceRoot, "apps/language-runtime/app-assets.json"), "utf8"));
  const paths = [
    "assets/micelaneous/male_gender.png",
    "assets/micelaneous/female_gender.png",
    "assets/micelaneous/neutral_gender.png",
    "assets/micelaneous/parashute.png",
    "language-runtime/static/styles/games/gravity-paper.svg",
    "assets/icons/clock_icon.png",
    "language-runtime/static/source/games/grammar-gravity/noun-visual.mjs"
  ];
  for (const path of paths) {
    const mappings = catalog.assets.filter(({ output }) => output === path);
    assert.equal(mappings.length, 1, `${path} has one shared source`);
    assert.ok(readFileSync(join(workspaceRoot, mappings[0].source)).length > 0);
  }
  for (const directory of ["czech", "spanish", "mandarin-simplified"]) {
    const setup = JSON.parse(readFileSync(join(workspaceRoot, `apps/languages/${directory}/static/setup-assets.json`), "utf8"));
    for (const path of paths) {
      assert.equal(setup.offline.assets.filter((url) => url.split("?")[0] === `/${path}`).length, 1,
        `${directory} retains one offline copy of ${path}`);
    }
  }
  for (const directory of ["czech", "spanish"]) {
    const pack = JSON.parse(readFileSync(join(workspaceRoot, `apps/languages/${directory}/static/data/games/grammar-gravity/nouns.json`), "utf8"));
    assert.equal(pack.schemaVersion, "caatuu-grammar-gravity-nouns-v2");
    assert.equal(pack.contentRevision, 3);
    assert.ok(pack.items.every((item) => !Object.hasOwn(item, "explanation")));
    for (const lane of pack.lanes) {
      assert.ok(paths.includes(lane.image.slice(1)), `${directory}.${lane.id} selects registered shared imagery`);
    }
  }
});

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
  for (const configuration of [czech, fixture]) {
    assert.equal(
      configuration.interfaceContent.sourcePath,
      "apps/language-runtime/static/data/interface/en.v1.json",
    );
    assert.equal(
      configuration.interfaceContent.output,
      "language-runtime/static/data/interface/en.v1.json",
    );
    assert.equal(configuration.interfaceContent.revision, "interface-en-27");
    assert.equal(configuration.interfaceContent.locale, "en");
    assert.equal(configuration.interfaceContent.direction, "ltr");
  }

  const sharedOutputs = new Set(czech.appAssets.map(({ output }) => output));
  for (const path of [
    "language-runtime/static/source/app-bootstrap.mjs",
    "language-runtime/static/source/browser-shell.mjs",
    "language-runtime/static/source/caatuu-workspace.js",
    "language-runtime/static/source/interface-content.mjs",
    "language-runtime/static/source/legacy-page-bootstrap.mjs",
    "language-runtime/static/source/product-word-world.mjs",
    "language-runtime/static/source/word-net-core.mjs",
    "language-runtime/static/source/word-net-queue.mjs",
    "language-runtime/static/source/word-world-host.mjs",
    "language-runtime/static/source/word-world-provider.mjs",
    "language-runtime/static/styles/caatuu-word-world.css",
    "language-runtime/static/data/interface/en.v1.json",
    "assets/micelaneous/male_gender.png",
    "assets/micelaneous/female_gender.png",
    "assets/micelaneous/neutral_gender.png",
    "language-runtime/static/styles/games/gravity-paper.svg",
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
    "/language-runtime/static/source/interface-content.mjs",
    "/language-runtime/static/source/legacy-page-bootstrap.mjs",
    "/language-runtime/static/source/word-world-host.mjs",
    "/language-runtime/static/source/word-world-provider.mjs",
    "/language-runtime/static/source/product-word-world.mjs",
    "/language-runtime/static/source/word-net-core.mjs",
    "/language-runtime/static/source/word-net-queue.mjs",
    "/language-runtime/static/data/interface/en.v1.json",
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

test("Android configuration pins each interface catalog to its exact shared app mapping", (t) => {
  const parent = mkdtempSync(join(tmpdir(), "caatuu-interface-boundary-"));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const canonicalCatalog = JSON.parse(readFileSync(join(
    workspaceRoot,
    "apps/language-runtime/static/data/interface/en.v1.json",
  ), "utf8"));

  function writeFixture(root, { catalogDirection = "ltr", catalogOutput }) {
    const manifestPath = join(root, "apps/android/tooling/tests/fixtures/interface-course/course.json");
    const catalogPath = join(root, "apps/language-runtime/static/data/interface/en.v1.json");
    mkdirSync(join(root, "apps/language-runtime/static/app"), { recursive: true });
    mkdirSync(join(root, "apps/language-runtime/static/data/interface"), { recursive: true });
    mkdirSync(join(root, "apps/android/tooling/tests/fixtures/interface-course/static"), { recursive: true });
    writeFileSync(join(root, CANONICAL_APP_ENTRY_PATH), "<!doctype html>\n", "utf8");
    writeFileSync(catalogPath, `${JSON.stringify({
      ...canonicalCatalog,
      direction: catalogDirection,
    }, null, 2)}\n`, "utf8");
    writeFileSync(join(root, "apps/language-runtime/app-assets.json"), `${JSON.stringify({
      schemaVersion: 1,
      appEntry: CANONICAL_APP_ENTRY_PATH,
      assets: [{
        source: "apps/language-runtime/static/data/interface/en.v1.json",
        output: catalogOutput,
      }],
    }, null, 2)}\n`, "utf8");
    mkdirSync(join(root, "apps/android/tooling/tests/fixtures/interface-course"), { recursive: true });
    writeFileSync(manifestPath, `${JSON.stringify({
      schemaVersion: 1,
      id: "fixture-interface",
      directoryName: "fixture-interface",
      routePrefix: "/fixture-interface",
      entryPath: "/fixture-interface/index.html",
      sourceLanguage: { id: "en", label: "English", locale: "en", direction: "ltr" },
      platforms: { android: { enabled: true, channels: [] } },
      resources: {
        appEntry: { kind: "file", path: CANONICAL_APP_ENTRY_PATH, state: "present" },
        interfaceCatalog: {
          kind: "file",
          path: "apps/language-runtime/static/data/interface/en.v1.json",
          scope: "shared",
          state: "present",
          revision: "interface-en-25",
        },
        staticRoot: {
          kind: "directory",
          path: "apps/android/tooling/tests/fixtures/interface-course/static",
          state: "present",
        },
      },
    }, null, 2)}\n`, "utf8");
    return manifestPath;
  }

  const wrongMappingRoot = join(parent, "wrong-mapping");
  const wrongMappingManifest = writeFixture(wrongMappingRoot, {
    catalogOutput: "language-runtime/static/data/interface/wrong.json",
  });
  assert.throws(
    () => loadAndroidCourseConfiguration({
      workspaceRoot: wrongMappingRoot,
      courseManifestPath: wrongMappingManifest,
    }),
    /interfaceCatalog app-assets output must be language-runtime\/static\/data\/interface\/en\.v1\.json/u,
  );

  const invalidCatalogRoot = join(parent, "invalid-catalog");
  const invalidCatalogManifest = writeFixture(invalidCatalogRoot, {
    catalogDirection: "rtl",
    catalogOutput: "language-runtime/static/data/interface/en.v1.json",
  });
  assert.throws(
    () => loadAndroidCourseConfiguration({
      workspaceRoot: invalidCatalogRoot,
      courseManifestPath: invalidCatalogManifest,
    }),
    /interface catalog is invalid:[\s\S]*direction rtl does not match ltr/iu,
  );
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
  // Keep a bounded package after the shared store/home, developer inspectors,
  // Sounds Quasar's 12 music macaws (5.43 MB), and shared grammar-game assets.
  assert.ok(result.totalBytes < 44_000_000, `The shared app package must remain below 44 MB; got ${result.totalBytes} bytes. MiniLM stays in setup delivery.`);
  assert.ok(result.files.includes("language-runtime/static/source/target-text-tones.mjs"));
  for (let musicIndex = 1; musicIndex <= 12; musicIndex += 1) {
    assert.ok(result.files.includes(`assets/macaw/music/music (${musicIndex}).png`));
  }
  assert.deepEqual(result.files.filter((path) => /(?:^|\/)index\.html$/u.test(path)), ["index.html"]);
  assert.ok(result.files.includes("courses/cz/source/shared/course-profile.js"));
  assert.ok(result.files.includes("courses/zh/source/shared/course-profile.js"));
  assert.ok(result.files.includes("language-runtime/static/source/interface-content.mjs"));
  assert.ok(result.files.includes("language-runtime/static/source/legacy-page-bootstrap.mjs"));
  assert.ok(result.files.includes("language-runtime/static/data/interface/en.v1.json"));
  assert.ok(result.files.includes("courses/cz/data/games/word-world/standard-v0.1/records.json"));
  assert.ok(result.files.includes("courses/zh/data/games/word-world/starter-v1.realizations.json"));
  assert.ok(!result.files.includes("source/shared/course-profile.js"));
  assert.ok(!result.files.includes("language-runtime/models/all-minilm-l6-v2-qint8-v0.1/runtime/onnx/model_qint8_arm64.onnx"));
  assert.ok(!result.files.includes("language-runtime/vendor/transformers/transformers.min.js"));
  assert.ok(
    !result.files.some((path) => /^courses\/[^/]+\/vendor\/transformers\//u.test(path)),
    "course trees must reuse the single shared Transformers.js runtime",
  );
  for (const courseId of ["cz", "zh"]) {
    const courseProfile = readPackagedCourseProfile(join(
      outputDir,
      `courses/${courseId}/source/shared/course-profile.js`,
    ));
    assert.equal(courseProfile.languageRoles.interfaceLanguage, courseProfile.sourceLanguage.locale);
    assert.equal(courseProfile.languageRoles.learnerBaseLanguage, courseProfile.sourceLanguage.locale);
    assert.equal(courseProfile.languageRoles.auditLanguage, "en");
    assert.equal(courseProfile.languageRoles.retrievalLanguage, "en");
    assert.equal(courseProfile.interfaceContent.locale, courseProfile.sourceLanguage.locale);
    assert.equal(courseProfile.interfaceContent.direction, courseProfile.sourceLanguage.direction);
    assert.equal(courseProfile.interfaceContent.revision, "interface-en-25");
    assert.equal(courseProfile.interfaceContent.catalog, "/language-runtime/static/data/interface/en.v1.json");
    assert.ok(
      result.files.includes(courseProfile.interfaceContent.catalog.replace(/^\/+/, "")),
      `${courseId} selected interface catalog must be packaged in the shared app tree`,
    );
  }

  const embeddingRuntimeCatalog = JSON.parse(readFileSync(
    join(outputDir, "language-runtime/embedding-runtimes.json"),
    "utf8",
  ));
  const sharedRuntime = embeddingRuntimeCatalog.runtimes[0];
  for (const artifact of sharedRuntime.artifacts) {
    assert.ok(!result.files.includes(`language-runtime/${artifact.path}`));
  }
  const czechSetup = JSON.parse(readFileSync(join(outputDir, "courses/cz/setup-assets.json"), "utf8"));
  const grammarGravity = czechSetup.artifacts.filter(
    (artifact) => artifact.key === "planet-agreement-aurora",
  );
  assert.equal(grammarGravity.length, 1);
  assert.equal(
    grammarGravity[0].url,
    "/assets/planets/releases/5fe5c25467d51dbe/agreement-aurora.png",
    "the Android setup contract must not reuse release 162's immutable public artwork URL",
  );
  assert.equal(
    grammarGravity[0].asset_path,
    "assets/planets/grammar-gravity.png",
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
  assert.ok(result.files.includes("language-runtime/static/source/interface-content.mjs"));
  assert.ok(result.files.includes("language-runtime/static/source/learning-profile.js"));
  assert.ok(result.files.includes("language-runtime/static/source/legacy-page-bootstrap.mjs"));
  assert.ok(result.files.includes("language-runtime/static/source/product-word-world.mjs"));
  assert.ok(result.files.includes("language-runtime/static/source/word-net-core.mjs"));
  assert.ok(result.files.includes("language-runtime/static/source/word-net-queue.mjs"));
  assert.ok(result.files.includes("language-runtime/static/source/word-world-host.mjs"));
  assert.ok(result.files.includes("language-runtime/static/source/word-world-provider.mjs"));
  assert.ok(result.files.includes("language-runtime/static/data/interface/en.v1.json"));
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
    "grammar-gravity.html",
    "triangular-thermosphere.html",
    "agreement-aurora.html",
    "source/games/conjugation-comet/conjugation-comet.css",
    "source/games/conjugation-comet/conjugation-comet.js",
    "source/games/grammar-gravity/grammar-gravity.css",
    "source/games/grammar-gravity/grammar-gravity.js",
    "source/games/grammar-gravity/launcher.css",
    "source/games/case-cosmos/launcher.css",
  ]) {
    assert.ok(!result.files.includes(path), `product package must exclude ${path}`);
  }
  const application = loadAndroidCourseConfiguration({ workspaceRoot });
  for (const path of [
    "language-runtime/static/source/app-bootstrap.mjs",
    "language-runtime/static/source/browser-shell.mjs",
    "language-runtime/static/source/caatuu-workspace.js",
    "language-runtime/static/source/interface-content.mjs",
    "language-runtime/static/source/learning-profile.js",
    "language-runtime/static/source/legacy-page-bootstrap.mjs",
    "language-runtime/static/source/product-word-world.mjs",
    "language-runtime/static/source/word-net-core.mjs",
    "language-runtime/static/source/word-net-queue.mjs",
    "language-runtime/static/source/word-world-host.mjs",
    "language-runtime/static/source/word-world-provider.mjs",
    "language-runtime/static/data/interface/en.v1.json",
    "language-runtime/static/games/grammar-gravity.html",
    "language-runtime/static/games/triangular-thermosphere.html",
    "language-runtime/static/games/agreement-aurora.html",
    "language-runtime/static/games/conjugation-comet.html",
    "language-runtime/static/source/games/embedded-game-controls.mjs",
    "language-runtime/static/styles/games/embedded-game-controls.css",
    "language-runtime/static/source/games/course-game-content.mjs",
    "language-runtime/static/source/games/grammar-gravity/grammar-gravity-core.mjs",
    "language-runtime/static/source/games/grammar-gravity/grammar-gravity-host.mjs",
    "language-runtime/static/source/games/grammar-gravity/noun-landing-core.mjs",
    "language-runtime/static/source/games/grammar-gravity/noun-landing-host.mjs",
    "language-runtime/static/source/games/conjugation-comet/conjugation-comet-core.mjs",
    "language-runtime/static/source/games/conjugation-comet/conjugation-comet-host.mjs",
    "language-runtime/static/styles/games/grammar-gravity.css",
    "language-runtime/static/styles/games/conjugation-comet.css",
    "language-runtime/static/styles/caatuu-word-world.css",
    "language-runtime/static/styles/caatuu-theme.css",
    "language-runtime/static/styles/caatuu-workspace.css",
    "assets/micelaneous/male_gender.png",
    "assets/micelaneous/female_gender.png",
    "assets/micelaneous/neutral_gender.png",
    "language-runtime/static/styles/games/gravity-paper.svg",
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
    "data/games/grammar-gravity/challenges.json",
    "data/games/grammar-gravity/nouns.json"
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

  const indexSource = readFileSync(join(workspaceRoot, CANONICAL_APP_ENTRY_PATH), "utf8");
  const productIndex = transformIndex(indexSource);
  assert.match(
    productIndex,
    /aria-label="Next sentence options" data-i18n-aria-label="wordworld\.generation\.nextoptions"/u,
  );
  assert.match(productIndex, /data-i18n="wordworld\.diagnostics\.content">content<\/dt>/u);
  assert.match(
    productIndex,
    /data-i18n="wordworld\.diagnostics\.model\.curated">none · curated corpus<\/dd>/u,
  );
  assert.doesNotMatch(productIndex, /data-i18n-aria-label="wordworld\.generation\.menu"/u);
  assert.throws(
    () => transformIndex(indexSource.replace(
      'aria-label="Sentence generation" data-i18n-aria-label="wordworld.generation.menu"',
      'aria-label="Sentence generation" data-i18n-aria-label="wordworld.generation.changed"',
    )),
    /shared app Word World options message: expected 1 exact source anchor/u,
  );

  const chromeSource = readFileSync(
    join(workspaceRoot, "apps/language-runtime/static/source/caatuu-chrome.js"),
    "utf8",
  );
  const productChrome = transformChromeJs(chromeSource);
  assert.doesNotMatch(productChrome, /href: routes\.chat, label: "debug-chat"/u);
  assert.doesNotMatch(productChrome, /<section class="settings-card side-card ai-settings-card"/u);
  assert.doesNotMatch(productChrome, /id="modelLicenseList"/u);
  assert.match(productChrome, /interfaceHtml\("settings\.product\.summary"\)/u);
  assert.match(productChrome, /interfaceHtml\("settings\.product\.legal\.contentterms"\)/u);
  assert.match(productChrome, /interfaceHtml\("settings\.product\.legal\.embeddingstitle"\)/u);
  assert.match(productChrome, /interfaceHtml\("settings\.product\.legal\.embeddingsterms"\)/u);
  assert.doesNotMatch(productChrome, /Storage and app controls|Caatuu Curriculum and Asset Embeddings/u);
  assert.throws(
    () => transformChromeJs(chromeSource.replace(
      'interfaceHtml("settings.advanced.summary")',
      'interfaceHtml("settings.advanced.changed")',
    )),
    /chrome advanced summary: expected 1 exact source anchor/u,
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
