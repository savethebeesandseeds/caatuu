import assert from "node:assert/strict";
import test from "node:test";
import { activeGenerationModels, defaultGenerationModelKey } from "../static/source/generation-model-policy.mjs";

test("model defaults follow the selected course catalog without a language allowlist", () => {
  const models = [{ key: "spanish-small", model_file: "spanish.gguf" }, { key: "arabic-small", modelFile: "arabic.gguf" }];
  assert.equal(defaultGenerationModelKey({ models, default_model: "arabic-small" }), "arabic-small");
  assert.equal(defaultGenerationModelKey({ models, default_model: "missing" }), "spanish-small");
  assert.equal(defaultGenerationModelKey({ models: [] }), "");
});

test("unsupported, deprecated and non-generation artifacts cannot become defaults", () => {
  const models = [{ key: "old", model_file: "old.gguf", deprecated: true },
    { key: "dictionary", model_file: "words.db", format: "sqlite" },
    { key: "vectors", model_file: "vectors.bin", artifact_kind: "embedding-vector-db" },
    { key: "future", model_file: "future.gguf", status: "planned" },
    { key: "ready", model_file: "ready.gguf", status: "active" }];
  assert.deepEqual(activeGenerationModels(models).map(model => model.key), ["ready"]);
  assert.equal(defaultGenerationModelKey({ models, default_model: "old" }), "ready");
});
