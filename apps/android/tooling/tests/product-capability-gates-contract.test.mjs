import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const repoRoot = new URL("../../../../", import.meta.url);
const [
  appBuild,
  productBuild,
  capabilities,
  registry,
  activity,
  bridge,
  courseRuntime,
  assetClient,
  speechManager,
] = await Promise.all([
  readFile(new URL("apps/android/app/build.gradle.kts", repoRoot), "utf8"),
  readFile(new URL("apps/android/product/build.gradle.kts", repoRoot), "utf8"),
  readFile(
    new URL("apps/android/app/src/main/java/com/caatuu/android/CourseCapabilities.kt", repoRoot),
    "utf8",
  ),
  readFile(
    new URL("apps/android/app/src/main/java/com/caatuu/android/BundledCourseRegistry.kt", repoRoot),
    "utf8",
  ),
  readFile(
    new URL("apps/android/product/src/main/java/com/caatuu/android/CaatuuActivity.kt", repoRoot),
    "utf8",
  ),
  readFile(
    new URL("apps/android/product/src/main/java/com/caatuu/android/ProductBridge.kt", repoRoot),
    "utf8",
  ),
  readFile(
    new URL("apps/android/product/src/main/java/com/caatuu/android/ProductCourseRuntime.kt", repoRoot),
    "utf8",
  ),
  readFile(
    new URL("apps/android/app/src/main/java/com/caatuu/android/CaatuuAssetClient.kt", repoRoot),
    "utf8",
  ),
  readFile(
    new URL("apps/android/app/src/main/java/com/caatuu/android/AndroidSpeechManager.kt", repoRoot),
    "utf8",
  ),
]);

test("both Android distributions derive learner language fields from the course manifest", () => {
  for (const build of [appBuild, productBuild]) {
    for (const field of [
      "CAATUU_SOURCE_LANGUAGE_LABEL",
      "CAATUU_TARGET_LANGUAGE_LABEL",
      "CAATUU_TARGET_LANGUAGE_LOCALE",
      "CAATUU_SPEECH_LOCALE",
    ]) {
      assert.match(build, new RegExp(`buildConfigField\\(\"String\", \"${field}\"`));
    }
    assert.match(build, /courseTargetLanguage\["speechLocale"\]/);
    assert.match(build, /normalized BCP 47 language tag/);
  }
});

test("runtime capability parsing and optional manager construction fail closed", () => {
  assert.match(capabilities, /FlatBooleanJsonParser\(rawJson\)\.parse\(\) \?: emptyMap\(\)/);
  assert.match(capabilities, /values\[name\] == true/);
  assert.match(capabilities, /if \(isEnabled\(name\)\) factory\(\) else null/);

  assert.match(activity, /BundledCourseRegistry\.load\(/);
  assert.match(activity, /BuildConfig\.CAATUU_COURSE_BUNDLE_ASSET/);
  assert.match(activity, /NativeProviderConfiguration\.fromBundled\(course\.nativeProviders\)/);
  assert.match(activity, /courseRegistry\.courses\.associate/);
  assert.doesNotMatch(activity, /= VectorDatabaseManager\(applicationContext\),/);
  assert.doesNotMatch(activity, /= DictionaryManager\(applicationContext\),/);
  assert.doesNotMatch(activity, /= AndroidSpeechManager\(applicationContext\),/);
});

test("disabled embeddings, dictionary, and speech cannot cross the product bridge", () => {
  assert.match(courseRuntime, /val vectorDatabaseManager: VectorDatabaseManager\?/);
  assert.match(courseRuntime, /val dictionaryManager: DictionaryManager\?/);
  assert.match(courseRuntime, /val speechManager: AndroidSpeechManager\?/);
  assert.match(courseRuntime, /providers\.embeddings != null.*vectorDatabaseManager != null/s);
  assert.match(courseRuntime, /providers\.dictionary != null.*dictionaryManager != null/s);
  assert.match(courseRuntime, /providers\.speech != null.*speechManager != null/s);
  assert.match(bridge, /currentCourseRuntime\(\)/);
  assert.match(bridge, /requireVectorDatabaseManager\(runtime: ProductCourseRuntime\)/);
  assert.match(bridge, /requireDictionaryManager\(runtime: ProductCourseRuntime\)/);
  assert.match(bridge, /requireSpeechManager\(runtime: ProductCourseRuntime\)/);

  assert.match(assetClient, /private val vectorDatabaseManagers: Map<String, VectorDatabaseManager>/);
  assert.match(assetClient, /resolution\.course\?\.id\?\.let\(vectorDatabaseManagers::get\)/);
  assert.match(assetClient, /data\/embeddings\/.*capabilities\?\.isEnabled\("embeddings"\)/s);
  assert.match(assetClient, /data\/dictionaries\/.*capabilities\?\.isEnabled\("dictionary"\)/s);
  assert.match(registry, /courseForTrustedUrl/);
  assert.match(registry, /coursesById\.containsKey/);
});

test("the generic product speech surface uses manifest language metadata", () => {
  assert.match(activity, /configuredLocaleTag = provider\.locale/);
  assert.match(activity, /targetLanguageLabel = course\.targetLanguage\.label/);
  assert.match(bridge, /ifBlank \{ runtime\.course\.targetLanguage\.speechLocale \}/);
  assert.match(speechManager, /BuildConfig\.CAATUU_SPEECH_LOCALE/);
  assert.match(speechManager, /BuildConfig\.CAATUU_TARGET_LANGUAGE_LABEL/);
  assert.doesNotMatch(bridge, /Czech|cs-CZ/);
  assert.doesNotMatch(speechManager, /Czech|cs-CZ|CZECH_LANGUAGE/);
});

test("the legacy full native shell refuses manifests that disable its Czech-only native stack", () => {
  assert.match(appBuild, /bundledLanguageId == "cz"/);
  assert.match(appBuild, /bundledLanguageRoutePrefix == "\/cz"/);
  assert.match(appBuild, /courseTargetLanguage\["id"\] == "cs"/);
  assert.match(appBuild, /supports only the canonical Czech course identity/);
  assert.match(appBuild, /disabledFullNativeCapabilities/);
  for (const capability of ["llm", "offlineModels", "embeddings", "dictionary", "speech"]) {
    assert.match(appBuild, new RegExp(`\"${capability}\" to course`));
  }
  assert.match(appBuild, /use the capability-gated :product distribution/);
});
