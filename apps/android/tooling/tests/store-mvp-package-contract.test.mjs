import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const repoRoot = new URL("../../../../", import.meta.url);
const [builder, validator, compiler, storeBuild, settings] = await Promise.all([
  readFile(new URL("apps/android/tooling/build-release-aab.sh", repoRoot), "utf8"),
  readFile(new URL("apps/android/tooling/validate-store-mvp-package.mjs", repoRoot), "utf8"),
  readFile(new URL("apps/android/tooling/build-store-mvp-assets.mjs", repoRoot), "utf8"),
  readFile(new URL("apps/android/storeMvp/build.gradle.kts", repoRoot), "utf8"),
  readFile(new URL("apps/android/settings.gradle.kts", repoRoot), "utf8"),
]);

test("the canonical Play builder constructs only the storeMvp release profile", () => {
  for (const contract of [
    "-PcaatuuDistributionProfile=storeMvp",
    ":storeMvp:generateStoreMvpAssets",
    ":storeMvp:lintRelease",
    ":storeMvp:assembleRelease",
    ":storeMvp:bundleRelease",
  ]) {
    assert.ok(builder.includes(contract), `missing canonical builder contract: ${contract}`);
  }
  assert.doesNotMatch(builder, /prepare-llama-vendor|:app:|:llamaLib:/);
  assert.match(settings, /"storeMvp" -> include\(":storeMvp"\)/);
  assert.match(storeBuild, /commandLine\(\s*"node",\s*assetCompiler\.asFile\.absolutePath,/s);
  assert.match(storeBuild, /assets\.srcDir\(generatedAssetsDir\)/);

  const dependencies = /dependencies\s*\{([\s\S]*?)\}/u.exec(storeBuild)?.[1] ?? "";
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
  assert.match(builder, /artifact_stem="caatuu-store-mvp-unsigned"/);
  assert.match(builder, /storeMvp-release-unsigned\.apk/);
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
    "validate-store-mvp-package.mjs",
    "--apkanalyzer",
    "--unzip",
  ]) {
    assert.ok(builder.includes(contract), `missing package audit step: ${contract}`);
  }
  assert.match(builder, /output_universal_apk.*authoritative package audit input/s);
  assert.match(validator, /assertAssetBoundary\([^;]+"aab", "storeMvp AAB"\)/s);
  assert.match(validator, /assertAssetBoundary\([^;]+"apk", "AAB-derived universal APK"\)/s);
  assert.match(validator, /verifyAabDerivedApkAssets/);
  assert.match(validator, /archiveBuffer\([^;]+\)\.equals\(archiveBuffer\(/s);
});

test("the package validator requires the retained local embedding stack", () => {
  for (const asset of [
    "setup-assets.json",
    "data/embeddings/models.json",
    "all-minilm-l6-v2-qint8-v0.1/manifest.json",
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
  for (const confinement of [
    "env\\.allowRemoteModels\\s*=\\s*false",
    "env\\.allowLocalModels\\s*=\\s*true",
    "feature-extraction",
    "local_files_only\\s*:\\s*true",
  ]) {
    assert.ok(validator.includes(confinement), `missing embedding confinement: ${confinement}`);
  }
  assert.match(validator, /EXPECTED_MINILM_REVISION/);
  assert.match(validator, /embeddingArtifacts\.length === 10/);
  assert.match(validator, /default_dictionary === "kaikki-cs-en-2026-07-09"/);
  assert.match(validator, /active\?\.status === "active"/);
  assert.match(validator, /active\?\.bytes.*active\.bytes > 0/s);
  assert.match(validator, /active\?\.sha256/);
  assert.match(validator, /active\?\.download_url/);
});

test("the validator distinguishes embedding vendor code from first-party capability code", () => {
  assert.match(validator, /assetPath\.startsWith\("vendor\/"\)/);
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
  assert.match(compiler, /writeText\(join\(resolvedOutput, "store-mvp-profile\.json"\)/);
  for (const capability of ["chat", "llm", "generation", "godot"]) {
    assert.match(validator, new RegExp(`"${capability}"`));
  }
  for (const capability of [
    "embeddings",
    "imageLookup",
    "stats",
    "dictionary",
    "wordWorldStandardOnly",
  ]) {
    assert.match(validator, new RegExp(capability));
  }
  assert.match(validator, /bugReportsLocalOnly/);
  assert.match(validator, /dictionaryGapReportsLocalOnly/);
  assert.match(validator, /com\.waajacu\.caatuu/);
  assert.match(validator, /EXPECTED_MIN_SDK = 30/);
  assert.match(validator, /MINIMUM_TARGET_SDK = 36/);
  assert.match(validator, /manifest", "debuggable"/);
  assert.match(validator, /REQUEST_INSTALL_PACKAGES/);
  assert.match(validator, /usesCleartextTraffic="false"/);
});

test("the DEX contract requires safe native classes and excludes retired bridges", () => {
  for (const className of [
    "StoreMvpActivity",
    "StoreMvpBridge",
    "CaatuuAssetClient",
    "VectorDatabaseManager",
    "DictionaryManager",
    "StaticAssetManager",
  ]) {
    assert.ok(validator.includes(className), `missing required native class: ${className}`);
  }
  for (const className of [
    "ModelManager",
    "NativeCzechModel",
    "AppUpdateManager",
    "com\\.arm\\.aichat",
    "org\\.godotengine",
  ]) {
    assert.ok(validator.includes(className), `missing forbidden native class: ${className}`);
  }
  assert.match(validator, /dex", "packages", "--defined-only"/);
  assert.match(validator, /dex",\s*"code",\s*"--class"/s);
});
