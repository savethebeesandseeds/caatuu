import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const repoRoot = new URL("../../../../", import.meta.url);
const [
  appBuild,
  productBuild,
  capabilities,
  activity,
  bridge,
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
    new URL("apps/android/product/src/main/java/com/caatuu/android/CaatuuActivity.kt", repoRoot),
    "utf8",
  ),
  readFile(
    new URL("apps/android/product/src/main/java/com/caatuu/android/ProductBridge.kt", repoRoot),
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

  assert.match(activity, /CourseCapabilities\.fromJson\(BuildConfig\.CAATUU_COURSE_CAPABILITIES_JSON\)/);
  for (const capability of ["embeddings", "dictionary", "speech"]) {
    assert.match(activity, new RegExp(`createIfEnabled\\(\"${capability}\"\\)`));
  }
  assert.doesNotMatch(activity, /= VectorDatabaseManager\(applicationContext\),/);
  assert.doesNotMatch(activity, /= DictionaryManager\(applicationContext\),/);
  assert.doesNotMatch(activity, /= AndroidSpeechManager\(applicationContext\),/);
});

test("disabled embeddings, dictionary, and speech cannot cross the product bridge", () => {
  assert.match(bridge, /private val vectorDatabaseManager: VectorDatabaseManager\?/);
  assert.match(bridge, /private val dictionaryManager: DictionaryManager\?/);
  assert.match(bridge, /private val speechManager: AndroidSpeechManager\?/);
  assert.match(bridge, /requireVectorDatabaseManager\(\)/);
  assert.match(bridge, /requireDictionaryManager\(\)/);
  assert.match(bridge, /requireSpeechManager\(\)/);
  assert.match(bridge, /courseCapabilities\.isEnabled\("embeddings"\) == \(vectorDatabaseManager != null\)/);
  assert.match(bridge, /courseCapabilities\.isEnabled\("dictionary"\) == \(dictionaryManager != null\)/);
  assert.match(bridge, /courseCapabilities\.isEnabled\("speech"\) == \(speechManager != null\)/);

  assert.match(assetClient, /private val vectorDatabaseManager: VectorDatabaseManager\?/);
  assert.match(assetClient, /if \(!courseCapabilities\.isEnabled\("embeddings"\)\) return null/);
  assert.match(assetClient, /val manager = vectorDatabaseManager \?: return null/);
  assert.match(assetClient, /data\/dictionaries\/.*!courseCapabilities\.isEnabled\("dictionary"\)/s);
});

test("the generic product speech surface uses manifest language metadata", () => {
  assert.match(activity, /configuredLocaleTag = BuildConfig\.CAATUU_SPEECH_LOCALE/);
  assert.match(activity, /targetLanguageLabel = BuildConfig\.CAATUU_TARGET_LANGUAGE_LABEL/);
  assert.match(bridge, /ifBlank \{ speechLocaleTag \}/);
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
