import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const repoRoot = new URL("../../../../", import.meta.url);
const [settings, build, manifest, bridge, activity, proguard] = await Promise.all([
  readFile(new URL("apps/android/settings.gradle.kts", repoRoot), "utf8"),
  readFile(new URL("apps/android/storeMvp/build.gradle.kts", repoRoot), "utf8"),
  readFile(new URL("apps/android/storeMvp/src/main/AndroidManifest.xml", repoRoot), "utf8"),
  readFile(
    new URL(
      "apps/android/storeMvp/src/main/java/com/caatuu/android/StoreMvpBridge.kt",
      repoRoot,
    ),
    "utf8",
  ),
  readFile(
    new URL(
      "apps/android/storeMvp/src/main/java/com/caatuu/android/StoreMvpActivity.kt",
      repoRoot,
    ),
    "utf8",
  ),
  readFile(new URL("apps/android/storeMvp/proguard-rules.pro", repoRoot), "utf8"),
]);

test("settings make the full and store modules mutually exclusive", () => {
  assert.match(settings, /"storeMvp" -> include\(":storeMvp"\)/);
  assert.match(settings, /"full" -> \{/);
  assert.match(settings, /include\(":app"\)/);
  assert.match(settings, /include\(":llamaLib"\)/);
  assert.match(settings, /Unsupported caatuuDistributionProfile/);
});

test("the store module reuses only safe application sources", () => {
  for (const source of [
    "AppUpdateManager.kt",
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
  assert.match(build, /CAATUU_SELF_UPDATE_ENABLED", "false"/);
  assert.match(build, /hasPartialReleaseSigning/);
});

test("the store manifest exposes only the Store MVP launcher with safe permissions", () => {
  assert.match(manifest, /android\.permission\.INTERNET/);
  assert.doesNotMatch(manifest, /REQUEST_INSTALL_PACKAGES/);
  assert.match(manifest, /android:name="\.StoreMvpActivity"/);
  assert.match(manifest, /android:exported="true"/);
  assert.match(manifest, /android:usesCleartextTraffic="false"/);
  assert.match(activity, /webView\.addJavascriptInterface\(bridge, "CaatuuAndroid"\)/);
  for (const className of [
    "StoreMvpBridge",
    "CaatuuAssetClient",
    "VectorDatabaseManager",
    "DictionaryManager",
    "StaticAssetManager",
  ]) {
    assert.match(proguard, new RegExp(`-keep class com\\.caatuu\\.android\\.${className}`));
  }
});

test("the Store MVP bridge exposes the safe native operation allowlist", () => {
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
  assert.match(bridge, /\.put\("storeManaged", true\)/);
  assert.match(bridge, /\.put\("selfUpdateEnabled", false\)/);
  assert.match(bridge, /\.put\("updateAvailable", false\)/);

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
  assert.doesNotMatch(bridge, /ModelManager|NativeCzechModel|AppUpdateManager|com\.arm\.aichat/);
});
