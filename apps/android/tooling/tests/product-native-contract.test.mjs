import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const repoRoot = new URL("../../../../", import.meta.url);
const [settings, build, manifest, bridge, activity, proguard] = await Promise.all([
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
  readFile(new URL("apps/android/product/proguard-rules.pro", repoRoot), "utf8"),
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
  assert.match(build, /CAATUU_EMBEDDINGS_ENABLED", "true"/);
  assert.match(build, /CAATUU_GODOT_ENABLED", "false"/);
  assert.match(build, /CAATUU_SELF_UPDATE_ENABLED", "true"/);
  assert.match(build, /CAATUU_UPDATE_MANIFEST_NAME/);
  assert.match(build, /hasPartialReleaseSigning/);
});

test("the product manifest exposes the Caatuu launcher and verified self-update support", () => {
  assert.match(manifest, /android\.permission\.INTERNET/);
  assert.match(manifest, /REQUEST_INSTALL_PACKAGES/);
  assert.match(manifest, /android:name="\.CaatuuActivity"/);
  assert.match(manifest, /androidx\.core\.content\.FileProvider/);
  assert.match(manifest, /android:exported="true"/);
  assert.match(manifest, /android:usesCleartextTraffic="false"/);
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
