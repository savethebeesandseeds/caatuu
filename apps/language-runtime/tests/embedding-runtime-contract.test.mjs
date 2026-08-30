import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  selectEmbeddingRuntime,
  validateEmbeddingRuntimeCatalog
} from "../static/source/embedding-runtime-contract.mjs";
import {
  verifyEmbeddingRuntimeAssets
} from "../tooling/verify-embedding-runtime.mjs";

const runtimeRoot = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const catalogPath = path.join(runtimeRoot, "embedding-runtimes.json");
const catalog = JSON.parse(await readFile(catalogPath, "utf8"));

test("the shared English MiniLM catalog owns only reviewed language-runtime artifacts", () => {
  assert.equal(validateEmbeddingRuntimeCatalog(catalog), catalog);
  const runtime = selectEmbeddingRuntime(catalog, "all-minilm-l6-v2-qint8-v0.1");
  assert.equal(runtime.inputLanguage, "en");
  assert.equal(runtime.source.revision, "1110a243fdf4706b3f48f1d95db1a4f5529b4d41");
  assert.equal(runtime.embedding.dimension, 384);
  assert.ok(runtime.artifacts.every(({ path: artifactPath, url }) => {
    assert.doesNotMatch(artifactPath, /(?:^|\/)languages\/czech(?:\/|$)/u);
    assert.equal(url, `/language-runtime/${artifactPath}`);
    return true;
  }));
});

test("every shared runtime artifact matches its committed size and SHA-256 readiness contract", async () => {
  assert.deepEqual(await verifyEmbeddingRuntimeAssets(), {
    schemaVersion: 1,
    runtimeCount: 1,
    artifactCount: 12,
    totalBytes: 37273824
  });
});

test("deployment verification rejects a structurally valid but false artifact hash", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "caatuu-embedding-runtime-"));
  try {
    const tamperedCatalog = structuredClone(catalog);
    tamperedCatalog.runtimes[0].artifacts[0].sha256 = "0".repeat(64);
    const temporaryCatalog = path.join(temporaryRoot, "embedding-runtimes.json");
    await writeFile(temporaryCatalog, `${JSON.stringify(tamperedCatalog)}\n`, "utf8");
    await assert.rejects(
      verifyEmbeddingRuntimeAssets({ root: runtimeRoot, catalogPath: temporaryCatalog }),
      /SHA-256 mismatch/u
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("the shared catalog rejects course-owned paths and missing model artifacts", () => {
  const courseOwned = structuredClone(catalog);
  courseOwned.runtimes[0].artifacts[0].path = "languages/czech/static/vendor/transformers/transformers.min.js";
  courseOwned.runtimes[0].artifacts[0].url = "/language-runtime/languages/czech/static/vendor/transformers/transformers.min.js";
  assert.throws(() => validateEmbeddingRuntimeCatalog(courseOwned), /outside this runtime's reviewed shared roots/u);

  const missingModel = structuredClone(catalog);
  missingModel.runtimes[0].artifacts = missingModel.runtimes[0].artifacts.filter(
    ({ path: artifactPath }) => !artifactPath.endsWith("model_qint8_arm64.onnx")
  );
  assert.throws(() => validateEmbeddingRuntimeCatalog(missingModel), /missing required runtime URL/u);
});
