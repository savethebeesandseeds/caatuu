import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  assertCourseBundleContract,
  requiredAssetPaths,
  requiredNativeClassNames,
} from "../validate-product-package.mjs";

const repoRoot = new URL("../../../../", import.meta.url);
const [builder, validator, compiler, productBuild, settings, appAssetCatalog] = await Promise.all([
  readFile(new URL("apps/android/tooling/build-release-aab.sh", repoRoot), "utf8"),
  readFile(new URL("apps/android/tooling/validate-product-package.mjs", repoRoot), "utf8"),
  readFile(new URL("apps/android/tooling/build-product-assets.mjs", repoRoot), "utf8"),
  readFile(new URL("apps/android/product/build.gradle.kts", repoRoot), "utf8"),
  readFile(new URL("apps/android/settings.gradle.kts", repoRoot), "utf8"),
  readFile(new URL("apps/language-runtime/app-assets.json", repoRoot), "utf8").then(JSON.parse),
]);

function productCapabilities(overrides = {}) {
  return {
    chat: false,
    conjugationComet: false,
    dictionary: false,
    embeddings: true,
    generation: false,
    godot: false,
    imageLookup: true,
    llm: false,
    memory: true,
    offlineModels: false,
    pronunciationGuides: false,
    semanticSearch: true,
    speech: true,
    stats: true,
    verbs: false,
    wordWorld: true,
    wordWorldStandardOnly: true,
    ...overrides,
  };
}

function productBundleFixture() {
  const czechCapabilities = productCapabilities({
    conjugationComet: true,
    dictionary: true,
    verbs: true,
  });
  const czechProviders = {
    schemaVersion: 1,
    providers: {
      embeddings: {
        implementation: "vector-database-catalog-v1",
        catalogAsset: "courses/cz/data/embeddings/models.json",
      },
      dictionary: {
        implementation: "sqlite-dictionary-catalog-v1",
        catalogAsset: "courses/cz/data/dictionaries/catalog.json",
      },
      speech: {
        implementation: "android-text-to-speech-v1",
        locale: "cs-CZ",
      },
    },
  };
  const mandarinCapabilities = productCapabilities();
  const bundle = {
    $schema: "https://caatuu.org/schemas/android-course-bundle-runtime.v1.schema.json",
    schemaVersion: 1,
    defaultCourseId: "cz",
    courses: [
      {
        id: "cz",
        routePrefix: "/cz",
        entryPath: "/cz/index.html",
        assetPrefix: "courses/cz",
        sourceLanguage: { id: "en", label: "English", locale: "en" },
        targetLanguage: {
          id: "cs",
          label: "Czech",
          nativeLabel: "Čeština",
          locale: "cs-CZ",
          script: "Latn",
          speechLocale: "cs-CZ",
        },
        capabilities: czechCapabilities,
        nativeProviders: czechProviders,
      },
      {
        id: "zh",
        routePrefix: "/zh",
        entryPath: "/zh/index.html",
        assetPrefix: "courses/zh",
        sourceLanguage: { id: "en", label: "English", locale: "en" },
        targetLanguage: {
          id: "zh",
          label: "Mandarin",
          nativeLabel: "中文",
          locale: "zh-Hans",
          script: "Hans",
          speechLocale: "zh-CN",
        },
        capabilities: mandarinCapabilities,
        nativeProviders: {
          schemaVersion: 1,
          providers: {
            embeddings: {
              implementation: "webview-english-minilm-v1",
              catalogAsset: "courses/zh/data/embeddings/catalog.json",
            },
            speech: {
              implementation: "android-text-to-speech-v1",
              locale: "zh-CN",
            },
          },
        },
      },
    ],
  };
  const profile = {
    schemaVersion: 2,
    profile: "product",
    course: {
      id: "cz",
      routePrefix: "/cz",
      sourceLanguage: { id: "en", locale: "en" },
      targetLanguage: { id: "cs", locale: "cs-CZ", script: "Latn", speechLocale: "cs-CZ" },
    },
    capabilities: czechCapabilities,
    nativeProviders: czechProviders,
    privacy: { bugReportsLocalOnly: true, dictionaryGapReportsLocalOnly: true },
    assets: [
      "caatuu-course-bundle.json",
      "index.html",
      "courses/cz/setup-assets.json",
      "courses/cz/data/embeddings/models.json",
      "courses/cz/data/dictionaries/catalog.json",
      "courses/zh/setup-assets.json",
      "courses/zh/data/embeddings/catalog.json",
    ],
  };
  return { bundle, profile };
}

test("the canonical builder constructs only the product release profile", () => {
  for (const contract of [
    "-PcaatuuDistributionProfile=product",
    ":product:generateProductAssets",
    ":product:lintRelease",
    ":product:assembleRelease",
    ":product:bundleRelease",
  ]) {
    assert.ok(builder.includes(contract), `missing canonical builder contract: ${contract}`);
  }
  assert.doesNotMatch(builder, /prepare-llama-vendor|:app:|:llamaLib:/);
  assert.match(settings, /"product" -> include\(":product"\)/);
  assert.match(productBuild, /commandLine\(\s*"node",\s*assetCompiler\.asFile\.absolutePath,/s);
  assert.match(productBuild, /assets\.srcDir\(generatedAssetsDir\)/);

  const dependencies = /dependencies\s*\{([\s\S]*?)\}/u.exec(productBuild)?.[1] ?? "";
  assert.doesNotMatch(dependencies, /llama|ggml|godot|com\.arm\.aichat/i);
});

test("the builder handles signing atomically and labels milestone artifacts honestly", () => {
  for (const variable of [
    "CAATUU_ANDROID_KEYSTORE",
    "CAATUU_ANDROID_KEYSTORE_PASSWORD",
    "CAATUU_ANDROID_KEY_ALIAS",
    "CAATUU_ANDROID_KEY_PASSWORD",
  ]) {
    assert.ok(builder.includes(variable), `missing signing input: ${variable}`);
  }
  assert.match(builder, /signing_values" -ne 0 && "\$signing_values" -ne/);
  assert.match(builder, /artifact_stem="caatuu-unsigned"/);
  assert.match(builder, /product-release-unsigned\.apk/);
  assert.match(builder, /inspection-debug-signed-universal\.apk/);
  assert.match(builder, /keytool -genkeypair/);
  assert.match(builder, /apksigner_path verify --print-certs/);
  assert.match(builder, /ephemerally debug-signed package audit input; do not publish/);
});

test("the AAB-derived universal APK is the authoritative delivery-boundary audit", () => {
  for (const contract of [
    "com.android.tools.build.bundletool.BundleToolMain",
    "validate --bundle=",
    "build-apks",
    "--mode=universal",
    "--aapt2=",
    "universal.apk",
    "validate-product-package.mjs",
    "--apkanalyzer",
    "--unzip",
  ]) {
    assert.ok(builder.includes(contract), `missing package audit step: ${contract}`);
  }
  assert.match(builder, /output_universal_apk.*authoritative package audit input/s);
  assert.match(validator, /assertAssetBoundary\([^;]+"aab", "Caatuu AAB"\)/s);
  assert.match(validator, /assertAssetBoundary\([^;]+"apk", "AAB-derived universal APK"\)/s);
  assert.match(validator, /verifyAabDerivedApkAssets/);
  assert.match(validator, /archiveBuffer\([^;]+\)\.equals\(archiveBuffer\(/s);
});

test("the package validator requires the retained local embedding stack", () => {
  for (const asset of [
    "caatuu-course-bundle.json",
    "setup-assets.json",
    "data/embeddings/models.json",
    "all-minilm-l6-v2-qint8-v0.1/manifest.json",
    "language-runtime/embedding-runtimes.json",
    "language-runtime/models/",
    "language-runtime/vendor/",
    "source/shared/vector-db.js",
    "source/shared/semantic-learning.js",
    "source/shared/semantic-learning-core.mjs",
    "data/dictionaries/catalog.json",
    "data/dictionaries/kaikki-cs-en-2026-07-09/manifest.json",
    "vendor/transformers/transformers.min.js",
    "vendor/sql.js/sql-wasm.js",
    "vendor/sql.js/sql-wasm.wasm",
  ]) {
    assert.ok(validator.includes(asset), `missing retained package asset contract: ${asset}`);
  }
  assert.match(validator, /courseAssetPath\(course, "setup-assets\.json"\)/);
  for (const confinement of [
    "env\\.allowRemoteModels\\s*=\\s*false",
    "env\\.allowLocalModels\\s*=\\s*true",
    "feature-extraction",
    "local_files_only\\s*:\\s*true",
  ]) {
    assert.ok(validator.includes(confinement), `missing embedding confinement: ${confinement}`);
  }
  assert.match(validator, /EXPECTED_MINILM_REVISION/);
  assert.match(validator, /webview-english-minilm-v1/);
  assert.match(validator, /runtime\.artifacts\.length === 12/);
  assert.match(validator, /createHash\("sha256"\)/);
  assert.match(validator, /byte count does not match the catalog/);
  assert.match(validator, /SHA-256 does not match the catalog/);
  assert.match(validator, /embeddingArtifacts\.length === 10/);
  assert.match(validator, /default_dictionary === "kaikki-cs-en-2026-07-09"/);
  assert.match(validator, /active\?\.status === "active"/);
  assert.match(validator, /active\?\.bytes.*active\.bytes > 0/s);
  assert.match(validator, /active\?\.sha256/);
  assert.match(validator, /active\?\.download_url/);
});

test("package requirements follow declared embeddings and dictionary capabilities", () => {
  const { bundle, profile } = productBundleFixture();
  assert.equal(assertCourseBundleContract(bundle, profile), bundle);
  const embeddingAssets = requiredAssetPaths(bundle);
  assert.ok(embeddingAssets.includes("caatuu-course-bundle.json"));
  assert.ok(embeddingAssets.includes("courses/cz/data/embeddings/models.json"));
  assert.ok(embeddingAssets.includes("courses/zh/data/embeddings/catalog.json"));
  assert.ok(embeddingAssets.includes("language-runtime/embedding-runtimes.json"));
  assert.ok(embeddingAssets.includes("courses/cz/data/dictionaries/catalog.json"));
  assert.ok(embeddingAssets.includes("courses/cz/data/dictionaries/kaikki-cs-en-2026-07-09/manifest.json"));
  assert.ok(!embeddingAssets.includes("setup-assets.json"));
  assert.ok(!embeddingAssets.includes("data/embeddings/models.json"));
  assert.ok(embeddingAssets.includes("language-runtime/contract.mjs"));
  assert.ok(!embeddingAssets.some((path) => path.startsWith("data/models/")));
  for (const { output } of appAssetCatalog.assets) {
    assert.ok(embeddingAssets.includes(output), `package requirements must include shared app asset ${output}`);
  }

  const embeddingClasses = requiredNativeClassNames(bundle);
  assert.ok(embeddingClasses.includes("com.caatuu.android.VectorDatabaseManager"));
  assert.ok(embeddingClasses.includes("com.caatuu.android.DictionaryManager"));
  assert.ok(embeddingClasses.includes("com.caatuu.android.AndroidSpeechManager"));

  const unsafeBundle = structuredClone(bundle);
  unsafeBundle.courses[1].nativeProviders.providers.embeddings.catalogAsset = "data/embeddings/catalog.json";
  assert.throws(
    () => assertCourseBundleContract(unsafeBundle, profile),
    /provider catalog asset must be namespaced under courses\/zh/,
  );

  const duplicateVendorProfile = structuredClone(profile);
  duplicateVendorProfile.assets.push("courses/cz/vendor/transformers/transformers.min.js");
  assert.throws(
    () => assertCourseBundleContract(bundle, duplicateVendorProfile),
    /must not duplicate shared Transformers\.js artifacts/,
  );
});

test("the package validator binds every Android artifact to the canonical app document", () => {
  assert.match(validator, /apps\/language-runtime\/static\/app\/index\.html/);
  assert.match(validator, /index\.html must equal the reviewed product transform/);
  assert.match(validator, /CAPABILITY_GATED_SHARED_APP_PATHS/);
  assert.match(validator, /capability-gated shared asset/);
  assert.match(validator, /BUNDLETOOL_DERIVED_APK_ASSET_PATHS/);
  assert.match(validator, /SHARED_APP_REQUIRED_ASSET_PATHS/);
  assert.match(validator, /must use the single canonical root index\.html/);
});

test("the validator distinguishes embedding vendor code from first-party capability code", () => {
  assert.match(validator, /assetPath\.startsWith\("language-runtime\/vendor\/"\)/);
  assert.match(validator, /assetPath\.startsWith\("language-runtime\/models\/"\)/);
  assert.doesNotMatch(validator, /\/\\bgenerative\\b\/i/);
  assert.doesNotMatch(validator, /\/\(\?:\^\|\\\/\)games\(\?:\\\/\|\$\)\/i/);
  for (const boundary of [
    "chat\\.html",
    "source\\/features\\/chat",
    "data\\/models",
    "wordNetGenerativeDialog",
    "loadModelCatalog",
    "start_download",
    "reset_conversation",
    "delete_model",
    "\\.gguf",
    "lib(?:ai-chat|llama|ggml|kleidiai|godot)",
  ]) {
    assert.ok(validator.includes(boundary), `missing forbidden capability contract: ${boundary}`);
  }
});

test("the profile marker and Android package identity are fail-closed", () => {
  assert.match(compiler, /writeText\([\s\S]*?join\(resolvedOutput, "caatuu-profile\.json"\)/);
  for (const capability of ["chat", "llm", "generation", "godot", "offlineModels"]) {
    assert.match(validator, new RegExp(`"${capability}"`));
  }
  for (const capability of [
    "embeddings",
    "imageLookup",
    "stats",
    "dictionary",
    "memory",
    "semanticSearch",
    "speech",
    "wordWorldStandardOnly",
  ]) {
    assert.match(validator, new RegExp(capability));
  }
  assert.match(validator, /bugReportsLocalOnly/);
  assert.match(validator, /dictionaryGapReportsLocalOnly/);
  assert.match(validator, /native providers must exactly match enabled capabilities/);
  assert.match(validator, /vector-database-catalog-v1/);
  assert.match(validator, /webview-english-minilm-v1/);
  assert.match(validator, /sqlite-dictionary-catalog-v1/);
  assert.match(validator, /packaged assets must exactly match the manifest-derived product profile/);
  assert.match(validator, /bundle\.defaultCourseId === "cz"/);
  assert.match(validator, /must contain exactly the ordered cz and zh courses/);
  assert.match(validator, /compatibility profile capabilities must match the bundle default/);
  assert.match(validator, /provider catalog asset must be namespaced/);
  assert.match(validator, /com\.waajacu\.caatuu/);
  assert.match(validator, /EXPECTED_MIN_SDK = 30/);
  assert.match(validator, /MINIMUM_TARGET_SDK = 36/);
  assert.match(validator, /manifest", "debuggable"/);
  assert.match(validator, /REQUEST_INSTALL_PACKAGES/);
  assert.match(validator, /usesCleartextTraffic="false"/);
  assert.match(validator, /--allow-transition-debug/);
  assert.match(validator, /allowTransitionDebug \? "true" : "false"/);
});

test("the DEX contract requires safe native classes and excludes retired bridges", () => {
  for (const className of [
    "CaatuuActivity",
    "ProductBridge",
    "AppUpdateManager",
    "CaatuuAssetClient",
    "VectorDatabaseManager",
    "DictionaryManager",
    "AndroidSpeechManager",
    "StaticAssetManager",
  ]) {
    assert.ok(validator.includes(className), `missing required native class: ${className}`);
  }
  for (const className of [
    "ModelManager",
    "NativeCzechModel",
    "com\\.arm\\.aichat",
    "org\\.godotengine",
  ]) {
    assert.ok(validator.includes(className), `missing forbidden native class: ${className}`);
  }
  assert.match(validator, /dex", "packages", "--defined-only"/);
  assert.match(validator, /dex",\s*"code",\s*"--class"/s);
});
