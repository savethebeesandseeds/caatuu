import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const repoRoot = new URL("../../../../", import.meta.url);

async function read(path) {
  return readFile(new URL(path, repoRoot), "utf8");
}

const [
  configSource,
  staticCatalogSource,
  catalogWriter,
  catalogChecker,
  androidBuild,
  rootGitignore,
  modelManager,
  bridge,
  setupAssetsSource,
  androidReadme
] = await Promise.all([
  read("tools/on-device-models/model-configs.json"),
  read("apps/languages/czech/static/data/models/phone-bench/models.json"),
  read("tools/on-device-models/scripts/write-static-model-catalog.py"),
  read("apps/runtime/tooling/check-static-model-catalog.mjs"),
  read("apps/android/app/build.gradle.kts"),
  read(".gitignore"),
  read("apps/android/app/src/main/java/com/caatuu/android/ModelManager.kt"),
  read("apps/android/app/src/main/java/com/caatuu/android/CaatuuBridge.kt"),
  read("apps/languages/czech/static/setup-assets.json"),
  read("apps/android/tooling/README.md")
]);

const config = JSON.parse(configSource);
const staticCatalog = JSON.parse(staticCatalogSource);
const setupAssets = JSON.parse(setupAssetsSource);
const activeModels = Object.entries(config.models)
  .filter(([, model]) => model.status === "active" && !model.deprecated)
  .map(([key, model]) => ({ key, ...model }));

test("active generation models are explicit on-demand artifacts", () => {
  assert.equal(activeModels.length, 2);
  assert.deepEqual(
    activeModels.map((model) => model.install_policy),
    ["on_demand", "on_demand"]
  );
  assert.ok(activeModels.every((model) => model.intended_use.startsWith("Optional Generative mode:")));
  assert.ok(activeModels.every((model) => model.notes.some((note) => note.startsWith("On-demand only:"))));
  assert.match(catalogWriter, /"install_policy": model\.get\("install_policy", "setup_required"\)/);
  assert.match(androidReadme, /Generation models are optional,\s+on-demand artifacts/);
});

test("the release build validates a tracked static catalog against model policy", () => {
  assert.deepEqual(
    staticCatalog.models.map((model) => model.key).sort(),
    activeModels.map((model) => model.key).sort()
  );
  assert.ok(staticCatalog.models.every((model) => model.install_policy === "on_demand"));
  assert.match(catalogChecker, /Static catalog model keys are stale/);
  assert.match(catalogChecker, /entry\.install_policy === model\.install_policy/);
  assert.match(androidBuild, /val verifyStaticModelCatalog by tasks\.registering\(Exec::class\)/);
  assert.match(androidBuild, /dependsOn\(refreshSetupAssetManifest, verifyStaticModelCatalog\)/);
  assert.match(rootGitignore, /!apps\/languages\/czech\/static\/data\/models\/phone-bench\/models\.json/);
});

test("Android keeps legacy catalogs setup-required but filters explicit on-demand models", () => {
  assert.match(modelManager, /val installPolicy: String = "setup_required"/);
  assert.match(modelManager, /optString\("install_policy", INSTALL_POLICY_SETUP_REQUIRED\)/);
  assert.match(modelManager, /SUPPORTED_INSTALL_POLICIES/);
  assert.match(
    modelManager,
    /fun requiredModelSpecs\(\): List<LocalModelSpec> =\s*availableModelSpecs\(\)\.filter \{ spec -> spec\.installPolicy == INSTALL_POLICY_SETUP_REQUIRED \}/
  );
  assert.match(modelManager, /fun availableModelSpecs\(\): List<LocalModelSpec>/);
  assert.match(modelManager, /availableModelSpecs\(\)\.forEach \{ spec ->/);
  assert.match(modelManager, /\.put\("install_policy", spec\.installPolicy\)/);
});

test("initial setup still requires embeddings, dictionary, and static assets", () => {
  assert.match(bridge, /val requiredModels = modelManager\.requiredModelSpecs\(\)/);
  assert.match(bridge, /vectorDatabaseManager\.ensureDatabase/);
  assert.match(bridge, /dictionaryManager\.ensureDatabase/);
  assert.match(bridge, /val artifactCount = requiredModels\.size \+ 2 \+ requiredAssets\.size/);

  const embeddingRuntime = setupAssets.artifacts.filter(
    (artifact) => artifact.artifact_kind === "embedding-runtime"
  );
  assert.ok(embeddingRuntime.length > 0);
  assert.ok(embeddingRuntime.every((artifact) => artifact.native_required === true));
});

test("a generative request can still acquire an optional model on demand", () => {
  assert.match(
    bridge,
    /private suspend fun runPrompt[\s\S]*modelManager\.ensureModel\(spec\.key\)/
  );
  assert.match(
    bridge,
    /private suspend fun loadModel[\s\S]*modelManager\.ensureModel\(modelKey\)/
  );
  assert.match(modelManager, /fun modelSpec\(modelKey: String\?\): LocalModelSpec = resolveModel\(modelKey\)/);
});
