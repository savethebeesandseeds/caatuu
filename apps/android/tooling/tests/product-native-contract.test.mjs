import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const repoRoot = new URL("../../../../", import.meta.url);
const [
  settings,
  build,
  manifest,
  bridge,
  activity,
  updateManager,
  proguard,
  productIcon,
  providerConfiguration,
  vectorManager,
  dictionaryManager,
] = await Promise.all([
  readFile(new URL("apps/android/settings.gradle.kts", repoRoot), "utf8"),
  readFile(new URL("apps/android/product/build.gradle.kts", repoRoot), "utf8"),
  readFile(new URL("apps/android/product/src/main/AndroidManifest.xml", repoRoot), "utf8"),
  readFile(
    new URL(
      "apps/android/product/src/main/java/com/caatuu/android/ProductBridge.kt",
      repoRoot,
    ),
    "utf8",
  ),
  readFile(
    new URL(
      "apps/android/product/src/main/java/com/caatuu/android/CaatuuActivity.kt",
      repoRoot,
    ),
    "utf8",
  ),
  readFile(
    new URL("apps/android/app/src/main/java/com/caatuu/android/AppUpdateManager.kt", repoRoot),
    "utf8",
  ),
  readFile(new URL("apps/android/product/proguard-rules.pro", repoRoot), "utf8"),
  readFile(new URL("apps/languages/czech/static/icons/caatuu-czech-512.png", repoRoot)),
  readFile(
    new URL(
      "apps/android/product/src/main/java/com/caatuu/android/NativeProviderConfiguration.kt",
      repoRoot,
    ),
    "utf8",
  ),
  readFile(
    new URL("apps/android/app/src/main/java/com/caatuu/android/VectorDatabaseManager.kt", repoRoot),
    "utf8",
  ),
  readFile(
    new URL("apps/android/app/src/main/java/com/caatuu/android/DictionaryManager.kt", repoRoot),
    "utf8",
  ),
]);

test("settings make the development and product modules mutually exclusive", () => {
  assert.match(settings, /"product" -> include\(":product"\)/);
  assert.match(settings, /"full" -> \{/);
  assert.match(settings, /include\(":app"\)/);
  assert.match(settings, /include\(":llamaLib"\)/);
  assert.match(settings, /Unsupported caatuuDistributionProfile/);
});

test("the product module reuses only safe application sources", () => {
  for (const source of [
    "CaatuuBridge.kt",
    "MainActivity.kt",
    "ModelManager.kt",
    "NativeCzechModel.kt",
  ]) {
    assert.match(build, new RegExp(`com/caatuu/android/${source.replace(".", "\\.")}`));
  }
  assert.doesNotMatch(build, /project\(":llamaLib"\)/);
  assert.match(build, /CAATUU_DISTRIBUTION_PROFILE/);
  assert.match(build, /CAATUU_GENERATIVE_ENABLED", "false"/);
  assert.match(build, /CAATUU_EMBEDDINGS_ENABLED", courseEmbeddingsEnabled\.toString\(\)/);
  assert.match(build, /CAATUU_DICTIONARY_ENABLED", courseDictionaryEnabled\.toString\(\)/);
  assert.match(build, /Android native provider contract schemaVersion must be 1/);
  assert.match(build, /CAATUU_EMBEDDING_CATALOG_ASSET/);
  assert.match(build, /CAATUU_DICTIONARY_CATALOG_ASSET/);
  assert.match(build, /CAATUU_SPEECH_PROVIDER_LOCALE/);
  assert.match(build, /caatuuCourseManifest/);
  assert.doesNotMatch(build, /caatuuLanguage(?:Id|AppDir|RoutePrefix|EntryPath)/);
  assert.match(build, /CAATUU_GODOT_ENABLED", "false"/);
  assert.match(build, /CAATUU_SELF_UPDATE_ENABLED", "true"/);
  assert.match(build, /CAATUU_ACCEPT_RELEASE_MIGRATION", "false"/);
  assert.match(build, /debug \{[\s\S]*?CAATUU_ACCEPT_RELEASE_MIGRATION", "true"/);
  assert.match(build, /caatuuVersionCode.*orElse\(159\)/);
  assert.match(build, /caatuuVersionName.*orElse\("0\.1\.7"\)/);
  assert.match(build, /CAATUU_UPDATE_MANIFEST_NAME/);
  assert.match(build, /hasPartialReleaseSigning/);
});

test("native manager construction follows the versioned provider declaration", () => {
  assert.match(activity, /NativeProviderConfiguration\.fromGenerated/);
  assert.match(activity, /catalogAssetPath = provider\.catalogAsset/);
  assert.match(activity, /check\(provider\.locale == BuildConfig\.CAATUU_SPEECH_LOCALE\)/);
  assert.match(activity, /configuredLocaleTag = BuildConfig\.CAATUU_SPEECH_LOCALE/);
  assert.match(providerConfiguration, /SCHEMA_VERSION = 1/);
  assert.match(providerConfiguration, /vector-database-catalog-v1/);
  assert.match(providerConfiguration, /sqlite-dictionary-catalog-v1/);
  assert.match(providerConfiguration, /android-text-to-speech-v1/);
  assert.match(providerConfiguration, /native provider schemaVersion/);
  assert.match(vectorManager, /catalogAssetPath: String/);
  assert.match(dictionaryManager, /catalogAssetPath: String/);
  assert.doesNotMatch(vectorManager, /EMBEDDING_CATALOG_ASSET/);
  assert.doesNotMatch(dictionaryManager, /CATALOG_ASSET/);
});

test("the one-time transition accepts only a signed release-shaped migration", () => {
  assert.match(updateManager, /BuildConfig\.CAATUU_ACCEPT_RELEASE_MIGRATION/);
  assert.match(updateManager, /BuildConfig\.DEBUG/);
  assert.match(updateManager, /buildType == "release"/);
  assert.match(updateManager, /!debuggable/);
  assert.match(updateManager, /archiveDebuggable == BuildConfig\.DEBUG \|\| \(releaseMigration && !archiveDebuggable\)/);
  assert.match(updateManager, /archiveLineage\.containsAll\(installedSigners\)/);
});

test("the product manifest exposes the Caatuu launcher and verified self-update support", () => {
  assert.match(manifest, /android\.permission\.INTERNET/);
  assert.match(manifest, /REQUEST_INSTALL_PACKAGES/);
  assert.match(manifest, /android:name="\.CaatuuActivity"/);
  assert.match(manifest, /androidx\.core\.content\.FileProvider/);
  assert.match(manifest, /android:exported="true"/);
  assert.match(manifest, /android:usesCleartextTraffic="false"/);
  assert.match(manifest, /android:icon="@drawable\/caatuu_app_icon"/);
  assert.match(manifest, /android:roundIcon="@drawable\/caatuu_app_icon"/);
  assert.doesNotMatch(manifest, /ic_launcher/);
  assert.match(build, /Android asset catalog must contain exactly one icons\/\*-512\.png product icon/);
  assert.match(build, /rename \{ "caatuu_app_icon\.png" \}/);
  assert.match(build, /dependsOn\(generateProductAssets, generateProductIconResources\)/);
  assert.equal(
    createHash("sha256").update(productIcon).digest("hex"),
    "89e2f6ef381cfb1c934ce0da8b02d1c46030cc2bab308af0cf909b8164329a1d",
  );
  assert.match(activity, /webView\.addJavascriptInterface\(bridge, "CaatuuAndroid"\)/);
  for (const className of [
    "ProductBridge",
    "AppUpdateManager",
    "CaatuuAssetClient",
    "VectorDatabaseManager",
    "DictionaryManager",
    "StaticAssetManager",
  ]) {
    assert.match(proguard, new RegExp(`-keep class com\\.caatuu\\.android\\.${className}`));
  }
});

test("the product bridge exposes the safe native operation allowlist", () => {
  const allowedOperations = [
    "cancel_request",
    "setup_status",
    "storage_preflight",
    "setup_download",
    "setup_abort",
    "vector_status",
    "vector_download",
    "vector_search",
    "dictionary_status",
    "dictionary_download",
    "dictionary_search",
    "speech_status",
    "speech_speak",
    "speech_stop",
    "speech_install_data",
    "delete_local_pack",
    "clear_cache",
    "update_app_status",
    "update_app",
  ];
  for (const operation of allowedOperations) {
    assert.match(bridge, new RegExp(`"${operation}"`));
  }
  assert.match(bridge, /appUpdateManager\.statusJson\(\)/);
  assert.match(bridge, /appUpdateManager\.downloadLatest/);
  assert.match(bridge, /appUpdateManager\.openInstaller\(\)/);
  assert.match(bridge, /fun isDeveloperPreview\(\): Boolean = false/);

  for (const forbidden of [
    "start_download",
    "cancel_download",
    "reset_conversation",
    "benchmark",
    "report_bug",
    "report_dictionary_gap",
    "delete_model",
  ]) {
    assert.doesNotMatch(bridge, new RegExp(`"${forbidden}"`));
  }
  assert.doesNotMatch(bridge, /ModelManager|NativeCzechModel|com\.arm\.aichat/);
});
