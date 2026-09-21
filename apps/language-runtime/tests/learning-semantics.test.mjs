import assert from "node:assert/strict";
import test from "node:test";
import { createLearningSemantics } from "../static/source/learning-semantics.mjs";
import { createEnglishImageSearch, embedSharedEnglishTexts, peekSharedEnglishVector } from "../static/source/english-image-search.mjs";
import { ENGLISH_MINILM_RUNTIME } from "../static/source/english-minilm-ranker.mjs";
import { IMAGE_EMBEDDING_INDEX_URL, IMAGE_INDEX_SCHEMA } from "../static/source/image-embedding-index.mjs";

const unit = (axis, magnitude = 1) => Float32Array.from({ length: 384 }, (_, index) => index === axis ? magnitude : 0);
const candidate = (id, englishText = id) => ({ id, englishText });
const input = { candidates: [candidate("dog"), candidate("house")], goalText: "animal", recentIds: ["house"] };
const encoder = async texts => texts.map(text => unit(text === "house" ? 1 : 0, 2));

test("feature reads never load a model and expose unknown similarities as null", () => {
  const owner = {};
  const semantics = createLearningSemantics({ owner, encoder: () => assert.fail("feature read ran inference") });
  const result = semantics.features(input);
  assert.equal(result.status, "empty");
  assert.deepEqual(result.byItem.dog, { goalSimilarity: null, recentSimilarity: null });
  assert.equal(Reflect.ownKeys(owner).length, 0);
});

test("warm normalizes 384-dimensional English vectors and preserves independent meaning features", async () => {
  const semantics = createLearningSemantics({ owner: {}, encoder });
  const result = await semantics.warm(input);
  assert.equal(result.status, "ready");
  assert.deepEqual(result.byItem.dog, { goalSimilarity: 1, recentSimilarity: 0 });
  assert.deepEqual(result.byItem.house, { goalSimilarity: 0, recentSimilarity: 1 });
  assert.equal(Object.hasOwn(result.byItem.dog, "mastery"), false);
  const later = semantics.features({ candidates: [candidate("dog")], recentIds: ["house"] });
  assert.equal(later.byItem.dog.recentSimilarity, 0, "recent text can be resolved from the bounded local item mapping");
});

test("concurrent callers deduplicate exact normalized English text and serialize distinct work", async () => {
  const owner = {}, calls = [];
  let active = 0, peak = 0;
  const embed = async texts => {
    calls.push(texts); active++; peak = Math.max(peak, active);
    await new Promise(resolve => setImmediate(resolve));
    active--; return texts.map(() => unit(0));
  };
  const first = createLearningSemantics({ owner, encoder: embed });
  const second = createLearningSemantics({ owner, encoder: embed });
  await Promise.all([
    first.warm({ candidates: [candidate("one", " dog ")] }),
    second.warm({ candidates: [candidate("two", "dog"), candidate("three", "house")] })
  ]);
  assert.equal(peak, 1);
  assert.deepEqual(calls, [["dog"], ["house"]]);
  await first.warm({ candidates: [candidate("different-id", "dog")] });
  assert.equal(calls.length, 2);
});

test("warming caps scanned records and candidate misses while prioritizing goal and recent items", async () => {
  const calls = [];
  const semantics = createLearningSemantics({ owner: {}, maxScan: 5, maxCandidateMisses: 2,
    encoder: async texts => { calls.push(texts); return texts.map(() => unit(0)); } });
  const result = await semantics.warm({ candidates: [
    candidate("chosen", "first selected item"), candidate("next", "second selected item"),
    candidate("other", "other item"), candidate("recent", "recent item"), candidate("last", "last item"),
    { id: "outside-scan", englishText: "你好" }
  ], goalText: "travel", recentIds: ["recent"] });
  assert.deepEqual(calls, [["travel", "recent item", "first selected item", "second selected item"]]);
  assert.equal(result.inspectedCandidates, 5);
  assert.equal(result.scanMode, "bounded-warmup");
  assert.equal(result.candidateScanLimit, 5);
  assert.equal(result.candidateMissLimit, 2);
  assert.equal(result.truncated, true);
  assert.equal(result.status, "partial");
  assert.equal(result.byItem.other.goalSimilarity, null);
});

test("cached feature reads score warmed catalog-tail items beyond the warmup scan without inference", async () => {
  let calls = 0;
  const semantics = createLearningSemantics({ owner: {}, encoder: async texts => { calls++; return encoder(texts); } });
  const candidates = Array.from({ length: 300 }, (_, index) => candidate(`item-${index}`, `item ${index}`));
  candidates[299] = candidate("tail-dog", "dog");
  await semantics.warm({ candidates: [candidates[299]], goalText: "animal" });
  assert.equal(calls, 1);
  const result = semantics.features({ candidates, goalText: "animal", recentIds: ["tail-dog"] });
  assert.deepEqual(result.byItem["tail-dog"], { goalSimilarity: 1, recentSimilarity: 1 });
  assert.equal(result.byItem["item-0"].goalSimilarity, null);
  assert.equal(result.inspectedCandidates, 300);
  assert.equal(result.cachedCandidates, 1);
  assert.equal(result.truncated, false);
  assert.equal(result.scanMode, "all-cached-candidates");
  assert.equal(result.candidateScanLimit, null);
  assert.equal(calls, 1, "reading the full eligible corpus never starts inference");
});

test("English validation rejects invalid boundary inputs before creating shared state", async () => {
  const owner = {}, semantics = createLearningSemantics({ owner, encoder: () => assert.fail("invalid input embedded") });
  for (const text of ["你好", "čeština", "", "123", "a".repeat(1025)]) {
    assert.throws(() => semantics.features({ candidates: [candidate("item", text)] }));
    await assert.rejects(semantics.warm({ candidates: [candidate("item")], goalText: text }));
  }
  assert.throws(() => semantics.features({ candidates: [candidate("same"), candidate("same")] }), /Duplicate/);
  await assert.rejects(embedSharedEnglishTexts(Array(33).fill("dog"), { owner }), /1 to 32/);
  assert.equal(Reflect.ownKeys(owner).length, 0);
});

test("malformed and nonfinite vectors become unavailable features rather than invented scores", async () => {
  const invalid = [new Float32Array(383), new Float32Array(384), Float32Array.from({ length: 384 }, () => NaN)];
  for (const vector of invalid) {
    const semantics = createLearningSemantics({ owner: {}, encoder: async () => [vector] });
    const result = await semantics.warm({ candidates: [candidate("dog")] });
    assert.equal(result.status, "unavailable");
    assert.equal(result.cachedCandidates, 0);
    assert.equal(result.byItem.dog.goalSimilarity, null);
  }
});

test("model failures back off, recover on a later explicit warm, and never block reads", async () => {
  let timestamp = 1000, calls = 0;
  const semantics = createLearningSemantics({ owner: {}, now: () => timestamp, retryMs: 100,
    encoder: async texts => { if (++calls === 1) throw new Error("model unavailable"); return encoder(texts); } });
  const failed = await semantics.warm(input);
  assert.equal(failed.status, "unavailable"); assert.equal(failed.retryAt, 1100);
  assert.equal(semantics.features(input).status, "unavailable");
  await semantics.warm(input); assert.equal(calls, 1);
  timestamp = 1100;
  assert.equal((await semantics.warm(input)).status, "ready");
  assert.equal(calls, 2);
});

test("a stalled model times out without duplicate inference on subsequent requests", async () => {
  let calls = 0, timestamp = 100;
  const semantics = createLearningSemantics({ owner: {}, timeoutMs: 5, retryMs: 1, now: () => timestamp,
    encoder: () => { calls++; return new Promise(() => {}); } });
  const result = await semantics.warm(input);
  assert.equal(result.status, "unavailable"); assert.match(result.reason, /timed out/);
  timestamp = 1000;
  assert.equal((await semantics.warm(input)).status, "unavailable");
  assert.equal(calls, 1);
});

test("shared vectors use a bounded LRU and are shared with image queries", async () => {
  const owner = {};
  for (let batch = 0; batch < 8; batch++) {
    await embedSharedEnglishTexts(Array.from({ length: 32 }, (_, index) => `item ${batch * 32 + index}`), { owner, encoder });
  }
  assert.ok(peekSharedEnglishVector("item 0", { owner }));
  await embedSharedEnglishTexts(["dog"], { owner, encoder });
  assert.equal(peekSharedEnglishVector("item 1", { owner }), null);
  assert.ok(peekSharedEnglishVector("item 0", { owner }), "access refreshed the least recently used entry");
  const bytes = Buffer.alloc(384 * 4); bytes.writeFloatLE(1, 0);
  const imagePath = "/assets/miscellaneous/dog.png";
  const search = createEnglishImageSearch({ owner, loadJson: async path => path === IMAGE_EMBEDDING_INDEX_URL
    ? { schema: IMAGE_INDEX_SCHEMA, inputLanguage: "en", modelId: ENGLISH_MINILM_RUNTIME.modelId,
      modelFileName: ENGLISH_MINILM_RUNTIME.modelFileName, dimension: 384, encoding: "float32le-base64",
      rows: [{ path: imagePath, sourceKind: "image_asset", embeddingText: "A dog.", vector: bytes.toString("base64") }] }
    : { [imagePath]: { description: "A dog." } } });
  const result = await search(" dog ", { sourceKind: "image_asset" });
  assert.equal(result.mode, "embedding", "image lookup reuses the vector without trying to load a model");
  assert.equal(result.rows[0].path, imagePath);
});
