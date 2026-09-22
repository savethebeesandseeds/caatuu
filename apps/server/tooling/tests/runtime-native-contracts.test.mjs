import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { validateMaintenanceUpdateVisibility, validateNativeDictionaryRouting } from "../runtime-native-contracts.mjs";

const read = relative => readFile(new URL(`../../../../${relative}`, import.meta.url), "utf8");
const [activitySource, courseRuntimeSource, bridgeSource, maintenanceSource] = await Promise.all([
  read("apps/android/product/src/main/java/com/caatuu/android/CaatuuActivity.kt"),
  read("apps/android/product/src/main/java/com/caatuu/android/ProductCourseRuntime.kt"),
  read("apps/android/product/src/main/java/com/caatuu/android/ProductBridge.kt"),
  read("apps/language-runtime/static/source/maintenance-ui.js")
]);
const native = { activitySource, courseRuntimeSource, bridgeSource };

test("native dictionary wiring follows the declared provider and trusted selected course", () => {
  assert.deepEqual(validateNativeDictionaryRouting(native), []);
  assert.deepEqual(validateNativeDictionaryRouting({
    activitySource: activitySource.replaceAll("provider ->", "declared ->").replaceAll("provider.", "declared."),
    courseRuntimeSource: courseRuntimeSource.replaceAll("dictionaryService", "lazyLexicon"),
    bridgeSource: bridgeSource.replaceAll("currentCourseRuntime", "resolveSelectedRuntime").replaceAll("runtime", "selected")
  }), [], "local variable and helper names do not define the architecture");
});

test("dictionary validation rejects missing capability, catalog, lazy and trusted-routing boundaries", () => {
  for (const [key, before, after] of [
    ["activitySource", "providers.dictionary?.let", "providers.dictionary.let"],
    ["activitySource", "DictionaryManager(applicationContext, catalogAssetPath = provider.catalogAsset)", 'DictionaryManager(applicationContext, catalogAssetPath = "hard-coded-czech.json")'],
    ["activitySource", "courseRuntimes = courseRuntimes,", ""],
    ["courseRuntimeSource", "dictionaryService = lazy", "dictionaryService = eager"],
    ["courseRuntimeSource", "(providers.dictionary != null) == (it != null)", "true"],
    ["courseRuntimeSource", "get() = dictionaryService.value", "get() = null"],
    ["bridgeSource", "courseForTrustedUrl(webView.url)", "courseForUntrustedInput(requestedUrl)"],
    ["bridgeSource", '"dictionary_search" -> searchDictionary(id, request, runtime)', '"dictionary_search" -> searchDictionary(id, request, defaultRuntime)'],
    ["bridgeSource", 'runtime.dictionaryManager ?: throw IllegalArgumentException("Unknown native request type.")', "globalDictionaryManager"]
  ]) {
    assert.ok(native[key].includes(before), `mutation exists: ${before}`);
    assert.ok(validateNativeDictionaryRouting({ ...native, [key]: native[key].replace(before, after) }).length > 0, before);
  }
});

test("update visibility is available-only for native APKs and browser refreshes", () => {
  assert.deepEqual(validateMaintenanceUpdateVisibility(maintenanceSource), []);
  assert.deepEqual(validateMaintenanceUpdateVisibility(maintenanceSource.replaceAll("const visible = available;", "const showAction = available;")
    .replaceAll("!visible", "!showAction").replaceAll("copy && visible", "copy && showAction")), [],
  "private visibility variable names are irrelevant");
});

test("update validation catches always-visible controls, lost browser refresh and store-managed APK exposure", () => {
  for (const [before, after] of [
    ["const visible = available;", "const visible = true;"],
    ['native ? hasNativeAppUpdate(status) : status?.updateAvailable === true', "native && hasNativeAppUpdate(status)"],
    ["if (status?.selfUpdateEnabled === false) return false;", ""],
    ['button.disabled = busy || !visible || downloadState === "active";', "button.disabled = false;"]
  ]) {
    assert.ok(maintenanceSource.includes(before), `mutation exists: ${before}`);
    assert.ok(validateMaintenanceUpdateVisibility(maintenanceSource.replace(before, after)).length > 0, before);
  }
});
