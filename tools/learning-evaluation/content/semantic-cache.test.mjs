import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  canonicalEnglishInput, semanticCacheKey, createSemanticCache, validateSemanticVector,
} from "../shared/semantic-cache.mjs";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const signature = Object.freeze({ inputLanguage: "en", dimension: 3, modelId: "correctness-fixture-only",
  modelSha256: "fixture-model", tokenizerSha256: "fixture-tokenizer", recipe: "fixture-v1" });
const document = (id, englishText) => ({ id, englishText });
async function directory() {
  const parent = path.join(root, "artifacts/learning-evaluation/content/test-cache");
  await mkdir(parent, { recursive: true });
  return mkdtemp(path.join(parent, "case-"));
}
function fixtureModel(overrides = {}) {
  const batches = [];
  return { signature: { ...signature, ...overrides }, batches,
    async encode(texts) { batches.push(texts); return texts.map(() => [1, 0, 0]); } };
}
const entryPath = (cache, key) => path.join(cache.directory, key.slice(0, 2), `${key}.json`);

test("canonical input follows the English runtime guard without conflating case or internal whitespace", () => {
  assert.equal(canonicalEnglishInput("  Ｃat  "), "Cat");
  assert.equal(canonicalEnglishInput("the  cat"), "the  cat");
  assert.notEqual(semanticCacheKey("Cat", signature), semanticCacheKey("cat", signature));
  assert.notEqual(semanticCacheKey("the cat", signature), semanticCacheKey("the  cat", signature));
  assert.equal(semanticCacheKey(" cat ", signature), semanticCacheKey("cat", signature));
  for (const value of [undefined, "", "  ", "123", "kočka", "猫"]) {
    assert.throws(() => canonicalEnglishInput(value));
  }
});

test("model, tokenizer, recipe and normalization signatures invalidate exact-text cache keys", () => {
  const original = semanticCacheKey("the cat", signature);
  for (const field of ["modelSha256", "tokenizerSha256", "recipe", "normalizationVersion"]) {
    assert.notEqual(semanticCacheKey("the cat", { ...signature, [field]: "changed" }), original);
  }
  assert.equal(semanticCacheKey("the cat", Object.fromEntries(Object.entries(signature).reverse())), original);
});

test("one semantic input shares a vector while learner IDs remain distinct and inputs are not mutated", async () => {
  const model = fixtureModel();
  const cache = await createSemanticCache({ root, directory: await directory(), model });
  const documents = [document("cz/verbs/a", "cat"), document("es/verbs/a", " cat "), document("cz/verbs/b", "dog")];
  const before = structuredClone(documents);
  const result = await cache.embed(documents);
  assert.deepEqual(documents, before);
  assert.deepEqual(model.batches, [["cat", "dog"]]);
  assert.deepEqual(result.rows.map((row) => row.id), documents.map((row) => row.id));
  assert.equal(result.rows[0].key, result.rows[1].key);
  assert.equal(result.stats.embeddedVectors, 2);
  assert.equal(result.stats.duplicateDocuments, 1);
  result.rows[0].vector[0] = 999;
  const next = await cache.embed([document("new-evidence-id", "cat")]);
  assert.deepEqual(next.rows[0].vector, [1, 0, 0]);
  assert.equal(next.stats.memoryReusedVectors, 1);
  assert.equal(model.batches.length, 1);
});

test("compatible disk entries avoid encoder loading and changed signatures recompute", async () => {
  const cacheDirectory = await directory();
  const first = await createSemanticCache({ root, directory: cacheDirectory, model: fixtureModel() });
  await first.embed([document("first", "cat")]);
  const second = await createSemanticCache({ root, directory: cacheDirectory,
    model: { signature, encode() { throw new Error("A compatible hit must not load the encoder"); } } });
  const reused = await second.embed([document("second", "cat")]);
  assert.equal(reused.rows[0].cache, "reused");
  assert.equal(reused.stats.diskReusedVectors, 1);
  const changedModel = fixtureModel({ tokenizerSha256: "changed" });
  const third = await createSemanticCache({ root, directory: cacheDirectory, model: changedModel });
  assert.equal((await third.embed([document("third", "cat")])).stats.embeddedVectors, 1);
});

test("malformed and incompatible disk vectors are reported and replaced", async () => {
  for (const corrupt of [
    (raw) => ({ ...raw, vector: [1, 0] }),
    (raw) => ({ ...raw, vector: [0, 0, 0] }),
    (raw) => ({ ...raw, englishText: "a different input" }),
    (raw) => ({ ...raw, signature: { ...raw.signature, tokenizerSha256: "wrong" } }),
  ]) {
    const cacheDirectory = await directory();
    const first = await createSemanticCache({ root, directory: cacheDirectory, model: fixtureModel() });
    const original = await first.embed([document("id", "cat")]);
    const file = entryPath(first, original.rows[0].key);
    await writeFile(file, JSON.stringify(corrupt(JSON.parse(await readFile(file, "utf8")))));
    const second = await createSemanticCache({ root, directory: cacheDirectory, model: fixtureModel() });
    const repaired = await second.embed([document("id", "cat")]);
    assert.equal(repaired.stats.invalidCacheEntries, 1);
    assert.equal(repaired.stats.embeddedVectors, 1);
    assert.deepEqual(JSON.parse(await readFile(file, "utf8")).vector, [1, 0, 0]);
  }
});

test("invalid English and IDs produce explicit skip reasons without encoder calls", async () => {
  const model = fixtureModel();
  const cache = await createSemanticCache({ root, directory: await directory(), model });
  const result = await cache.embed([document("empty", ""), document("target", "猫"), document(null, "cat")]);
  assert.equal(result.rows.length, 0);
  assert.equal(result.skipped.length, 3);
  assert.equal(result.stats.skipReasons["invalid-or-missing-English-input"], 2);
  assert.equal(result.stats.skipReasons["invalid-document-id"], 1);
  assert.equal(model.batches.length, 0);
});

test("vector shape, numeric type, norm and batch count are enforced before writes", async () => {
  for (const vector of [[1, 0], [0, 0, 0], [NaN, 0, 0], [Infinity, 0, 0], ["1", 0, 0], [2, 0, 0]]) {
    assert.throws(() => validateSemanticVector(vector, 3));
  }
  for (const vectors of [[], [[0, 0, 0]]]) {
    const cacheDirectory = await directory();
    const cache = await createSemanticCache({ root, directory: cacheDirectory, model: { signature, encode: async () => vectors } });
    await assert.rejects(cache.embed([document("id", "cat")]));
    assert.deepEqual(await readdir(cacheDirectory), []);
  }
});

test("concurrent instances produce complete independent entries without a shared mutable index", async () => {
  const cacheDirectory = await directory();
  let arrivals = 0, release;
  const gate = new Promise((resolve) => { release = resolve; });
  const model = { signature, async encode(texts) {
    arrivals += 1;
    if (arrivals === 2) release();
    await gate;
    return texts.map(() => [1, 0, 0]);
  } };
  const first = await createSemanticCache({ root, directory: cacheDirectory, model });
  const second = await createSemanticCache({ root, directory: cacheDirectory, model });
  await Promise.all([
    first.embed([document("first", "cat"), document("first-only", "dog")]),
    second.embed([document("second", "cat"), document("second-only", "bird")]),
  ]);
  const reader = await createSemanticCache({ root, directory: cacheDirectory,
    model: { signature, encode() { throw new Error("All three inputs must be cached"); } } });
  const result = await reader.embed([document("a", "cat"), document("b", "dog"), document("c", "bird")]);
  assert.equal(result.stats.diskReusedVectors, 3);
  for (const prefix of await readdir(cacheDirectory)) {
    assert.ok((await readdir(path.join(cacheDirectory, prefix))).every((file) => file.endsWith(".json")));
  }
});

test("cache output confinement and explicit batch limits are validated", async () => {
  await assert.rejects(createSemanticCache({ root, directory: root, model: fixtureModel() }));
  await assert.rejects(createSemanticCache({ root, directory: await directory(), model: fixtureModel(), batchSize: 0 }));
});

test("symlinked cache directories and late linked key folders cannot redirect writes", async () => {
  const parent = await directory();
  const target = path.join(parent, "target");
  await mkdir(target);
  const linked = path.join(parent, "linked-cache");
  await symlink(target, linked, "dir");
  await assert.rejects(createSemanticCache({ root, directory: linked, model: fixtureModel() }), /symlink/);
  assert.deepEqual(await readdir(target), []);

  const cacheDirectory = path.join(parent, "cache");
  const model = fixtureModel();
  const cache = await createSemanticCache({ root, directory: cacheDirectory, model });
  await mkdir(cacheDirectory);
  const key = semanticCacheKey("cat", signature);
  await symlink(target, path.join(cacheDirectory, key.slice(0, 2)), "dir");
  await assert.rejects(cache.embed([document("id", "cat")]), /symlink/);
  assert.equal(model.batches.length, 0);
  assert.deepEqual(await readdir(target), []);
});
