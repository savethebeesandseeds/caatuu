import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const repoRoot = new URL("../../../../", import.meta.url);

async function read(path) {
  return readFile(new URL(path, repoRoot), "utf8");
}

const [configSource, staticCatalogSource, androidBuild, modelManager, bridge, setupAssetsSource] = await Promise.all([
  read("tools/on-device-models/model-configs.json"),
  read("apps/languages/czech/static/data/models/phone-bench/models.json"),
  read("apps/android/app/build.gradle.kts"),
  read("apps/android/app/src/main/java/com/caatuu/android/ModelManager.kt"),
  read("apps/android/app/src/main/java/com/caatuu/android/CaatuuBridge.kt"),
  read("apps/languages/czech/static/setup-assets.json")
]);

const config = JSON.parse(configSource);
const staticCatalog = JSON.parse(staticCatalogSource);
const setupAssets = JSON.parse(setupAssetsSource);
const activeModels = Object.entries(config.models)
  .filter(([, model]) => model.status === "active" && !model.deprecated)
  .map(([key, model]) => ({ key, ...model }));

test("active generation models and the shipped catalog are explicit on-demand artifacts", () => {
  assert.equal(activeModels.length, 2);
  assert.deepEqual(
    activeModels.map((model) => model.install_policy),
    ["on_demand", "on_demand"]
  );
  assert.ok(activeModels.every((model) => model.intended_use.startsWith("Optional Generative mode:")));
  assert.ok(activeModels.every((model) => model.notes.some((note) => note.startsWith("On-demand only:"))));
  assert.deepEqual(
    staticCatalog.models.map((model) => model.key).sort(),
    activeModels.map((model) => model.key).sort()
  );
  assert.ok(staticCatalog.models.every((model) => model.install_policy === "on_demand"));
  assert.match(androidBuild, /val verifyStaticModelCatalog by tasks\.registering\(Exec::class\)/);
  assert.match(androidBuild, /if \(courseOfflineModelsEnabled\) dependsOn\(verifyStaticModelCatalog\)/);
});

test("legacy Android setup filters on-demand models while retaining required static assets", () => {
  assert.match(modelManager, /val installPolicy: String = "setup_required"/);
  assert.match(modelManager, /optString\("install_policy", INSTALL_POLICY_SETUP_REQUIRED\)/);
  assert.match(modelManager, /SUPPORTED_INSTALL_POLICIES/);
  assert.match(
    modelManager,
    /fun requiredModelSpecs\(\): List<LocalModelSpec> =\s*availableModelSpecs\(\)\.filter \{ spec -> spec\.installPolicy == INSTALL_POLICY_SETUP_REQUIRED \}/
  );
  assert.match(bridge, /val requiredModels = modelManager\.requiredModelSpecs\(\)/);
  assert.match(bridge, /vectorDatabaseManager\.ensureDatabase/);
  assert.match(bridge, /dictionaryManager\.ensureDatabase/);

  const embeddingRuntime = setupAssets.artifacts.filter(
    (artifact) => artifact.artifact_kind === "embedding-runtime"
  );
  assert.ok(embeddingRuntime.length > 0);
  assert.ok(embeddingRuntime.every((artifact) => artifact.native_required === true));
  assert.match(
    bridge,
    /private suspend fun runPrompt[\s\S]*modelManager\.ensureModel\(spec\.key\)/
  );
});
