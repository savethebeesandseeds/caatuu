import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { checkImageEmbeddingIndex } from "../tooling/build-image-embedding-index.mjs";
import { createEnglishImageSearch } from "../static/source/english-image-search.mjs";
import { IMAGE_EMBEDDING_INDEX_URL, IMAGE_INDEX_SCHEMA, readImageEmbeddingIndex } from "../static/source/image-embedding-index.mjs";
import { ENGLISH_MINILM_RUNTIME } from "../static/source/english-minilm-ranker.mjs";
import vm from "node:vm";

const DOG = "/assets/miscellaneous/dog.png", HOUSE = "/assets/miscellaneous/house.png";
const unit = axis => Float32Array.from({ length: 384 }, (_, index) => index === axis ? 1 : 0);
function encoded(vector) {
  const bytes = Buffer.alloc(vector.length * 4);
  vector.forEach((value, index) => bytes.writeFloatLE(value, index * 4));
  return bytes.toString("base64");
}
function fixtureIndex() {
  return { schema: IMAGE_INDEX_SCHEMA, inputLanguage: "en", modelId: ENGLISH_MINILM_RUNTIME.modelId,
    modelFileName: ENGLISH_MINILM_RUNTIME.modelFileName, dimension: 384, encoding: "float32le-base64",
    rows: [
      { path: DOG, sourceKind: "image_asset", embeddingText: "A dog outdoors.", vector: encoded(unit(0)) },
      { path: HOUSE, sourceKind: "image_asset", embeddingText: "A house indoors.", vector: encoded(unit(1)) }
    ] };
}

test("the generated shared index covers the current safe catalogs and pinned model exactly", async () => {
  const result = await checkImageEmbeddingIndex();
  assert.ok(result.images > 0);
  assert.equal(result.images, result.sources.reduce((sum, source) => sum + source.count, 0));
});

test("shared indexed retrieval embeds only the query and queues concurrent queries without lexical downgrades", async () => {
  const index = fixtureIndex(), queries = [], loads = [];
  let active = 0, peak = 0;
  const search = createEnglishImageSearch({
    loadJson: async path => {
      loads.push(path);
      return path === IMAGE_EMBEDDING_INDEX_URL ? index
        : { [DOG]: { description: "A dog outdoors." }, [HOUSE]: { description: "A house indoors." } };
    },
    embedQuery: async query => {
      queries.push(query); active += 1; peak = Math.max(peak, active);
      await new Promise(resolve => setImmediate(resolve));
      active -= 1;
      return unit(query === "canine" ? 0 : 1);
    }
  });
  const [dog, house] = await Promise.all([search("canine", { sourceKind: "image_asset" }), search("building", { sourceKind: "image_asset" })]);
  assert.equal(dog.mode, "embedding"); assert.equal(house.mode, "embedding");
  assert.equal(dog.rows[0].path, DOG); assert.equal(house.rows[0].path, HOUSE);
  assert.equal(peak, 1);
  assert.deepEqual(queries, ["canine", "building"]);
  await search("canine", { sourceKind: "image_asset" });
  assert.equal(queries.length, 2, "query vectors are reused");
  assert.equal(loads.filter(path => path === IMAGE_EMBEDDING_INDEX_URL).length, 1);
});

test("a stale description produces an explicit fallback rather than using its old vector", async () => {
  const search = createEnglishImageSearch({
    loadJson: async path => path === IMAGE_EMBEDDING_INDEX_URL ? fixtureIndex()
      : { [DOG]: { description: "A dog runs." } }, embedQuery: async () => unit(0)
  });
  const result = await search("dog", { sourceKind: "image_asset" });
  assert.equal(result.mode, "lexical");
  assert.match(result.reason, /needs rebuilding/);
});

test("corrupted or incompatible image vectors fail validation", () => {
  for (const mutation of [
    index => { index.modelId = "different-model"; },
    index => { index.rows[0].vector = "AAAA"; },
    index => { index.rows[0].vector = encoded(new Float32Array(384)); },
    index => { index.rows.push(index.rows[0]); },
    index => { const vector = unit(0); vector[1] = NaN; index.rows[0].vector = encoded(vector); }
  ]) {
    const index = fixtureIndex(); mutation(index);
    assert.throws(() => readImageEmbeddingIndex(index));
  }
});

test("Word World image candidates come from shared retrieval and preserve the requested English query", async () => {
  const source = await readFile(new URL("../static/source/product-word-world.mjs", import.meta.url), "utf8");
  const begin = source.indexOf("async function rankedSceneCandidates(");
  const end = source.indexOf("function syncImageControl()", begin);
  const calls = [];
  const scope = vm.createContext({ SCENE_ASSET_LIMIT: 5, isMiscellaneousAssetPath: path => path.startsWith("/assets/miscellaneous/"),
    searchSceneImages: async (query, options) => {
      calls.push({ query, options });
      return { mode: "embedding", rows: [{ path: HOUSE, description: "A house indoors.", sourceKind: "image_asset", score: .8 }] };
    }
  });
  vm.runInContext(source.slice(begin, end), scope);
  const rows = await scope.rankedSceneCandidates("a house");
  assert.equal(calls.length, 1); assert.equal(calls[0].query, "a house");
  assert.equal(calls[0].options.sourceKind, "image_asset");
  assert.equal(rows[0].assetPath, HOUSE); assert.equal(rows[0].semanticScore, .8);
  assert.doesNotMatch(source, /stableSceneOffset|runtimeAdapter\(\)\?\.vector\?\.search/);
});
