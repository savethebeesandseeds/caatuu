import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { checkImageEmbeddingIndex, imageIndexInputs } from "../tooling/build-image-embedding-index.mjs";
import { createEnglishImageSearch } from "../static/source/english-image-search.mjs";
import { IMAGE_EMBEDDING_INDEX_URL, IMAGE_EMBEDDING_INDEX_PATH, IMAGE_INDEX_SCHEMA,
  readImageEmbeddingIndex, imageEmbeddingReference, imageVectorKey } from "../static/source/image-embedding-index.mjs";
import { isChildFacingMacawActionAssetAllowed } from "../static/source/child-facing-assets.mjs";
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
  const { rows } = await imageIndexInputs();
  assert.deepEqual([...new Set(rows.map(row => row.sourceKind))], ["image_asset", "macaw_action_asset", "robot_asset", "ship_asset"]);
  for (const row of rows) {
    const reference = imageEmbeddingReference(row);
    assert.deepEqual(Object.keys(reference).sort(), ["asset_path", "index", "model_id", "source_kind"]);
    assert.equal(reference.index, IMAGE_EMBEDDING_INDEX_PATH);
    assert.equal(reference.asset_path, row.path);
    assert.equal(reference.source_kind, row.sourceKind);
    assert.doesNotMatch(JSON.stringify(reference), /\/cz\/|database|document_id|chunk_id|\u0000/);
  }
});

test("excluded Macaw artwork has neither a shared index row nor a dangling embedding reference", async () => {
  const raw = JSON.parse(await readFile(new URL("../../launcher/static/assets/macaw/actions/keymaps.json", import.meta.url), "utf8"));
  const { rows } = await imageIndexInputs();
  let excluded = 0;
  for (const [assetPath, metadata] of Object.entries(raw)) {
    if (isChildFacingMacawActionAssetAllowed(assetPath, metadata.action)) continue;
    excluded += 1;
    assert.equal(metadata.embedding, undefined);
    assert.equal(rows.some(row => row.sourceKind === "macaw_action_asset" && row.path === assetPath), false);
  }
  assert.ok(excluded > 0, "the policy fixture includes excluded artwork");
});

test("source kind and asset path identify vectors without an opaque serialized separator", () => {
  const row = { sourceKind: "ship_asset", path: "/assets/ships/ship%20(1).png" };
  assert.deepEqual(JSON.parse(imageVectorKey(row)), [row.sourceKind, row.path]);
  assert.notEqual(imageVectorKey(row), imageVectorKey({ ...row, sourceKind: "robot_asset" }));
});

test("a new index revision coexists with a live older consumer while retaining its model and queue", async () => {
  const loads = [];
  let calls = 0, release;
  const engine = { embedBatch: async () => { calls += 1; return [unit(0)]; } };
  const legacyIndex = Promise.resolve(new Map([[`image_asset\u0000${DOG}`, { embeddingText: "A dog outdoors.", vector: unit(0) }]]));
  const state = { engine, queries: new Map(), indexPromise: legacyIndex,
    tail: new Promise(resolve => { release = resolve; }) };
  const owner = { [Symbol.for("caatuu.sharedImageRanking.v2")]: state };
  const search = createEnglishImageSearch({ owner, loadJson: async path => {
    loads.push(path);
    return path === IMAGE_EMBEDDING_INDEX_URL ? fixtureIndex() : { [DOG]: { description: "A dog outdoors." } };
  } });
  const pending = search("canine", { sourceKind: "image_asset" });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 0, "the old consumer's inference must finish first");
  release();
  const result = await pending;
  assert.equal(result.mode, "embedding");
  assert.equal(result.rows[0].path, DOG);
  assert.equal(state.engine, engine);
  assert.equal(state.indexPromise, legacyIndex, "the older parser keeps its own index");
  assert.equal(owner[Symbol.for("caatuu.sharedImageRanking.v2")], state);
  await search("canine", { sourceKind: "image_asset" });
  assert.equal(calls, 1);
  assert.equal(loads.filter(path => path === IMAGE_EMBEDDING_INDEX_URL).length, 1);
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
    index => { index.rows[0].path = "/assets/ships/ship.png"; },
    index => { index.rows[0].path = "/assets/miscellaneous/%2e%2e%2fship.png"; },
    index => { const vector = unit(0); vector[1] = NaN; index.rows[0].vector = encoded(vector); }
  ]) {
    const index = fixtureIndex(); mutation(index);
    assert.throws(() => readImageEmbeddingIndex(index));
  }
});

test("ship vectors retain a finite image-plane heading separately from their semantic description", () => {
  const raw = fixtureIndex();
  raw.rows = [{ path: "/assets/ships/ship%20(1).png", sourceKind: "ship_asset", category: "ship",
    embeddingText: "A pointed spaceship.", orientation: { heading_degrees: 155 }, vector: encoded(unit(0)) }];
  const row = readImageEmbeddingIndex(raw).get(imageVectorKey(raw.rows[0]));
  assert.deepEqual(row.orientation, { heading_degrees: 155 });
  assert.equal(row.embeddingText, "A pointed spaceship.");
  for (const heading of [-1, 360, NaN, Infinity, undefined]) {
    raw.rows[0].orientation.heading_degrees = heading;
    assert.throws(() => readImageEmbeddingIndex(raw), /heading/);
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
