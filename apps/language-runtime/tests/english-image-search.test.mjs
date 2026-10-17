import assert from "node:assert/strict";
import test from "node:test";
import { createEnglishImageSearch, normalizeImageCatalog, IMAGE_SOURCES } from "../static/source/english-image-search.mjs";
import { ENGLISH_MINILM_RUNTIME } from "../static/source/english-minilm-ranker.mjs";
import { IMAGE_EMBEDDING_INDEX_URL, IMAGE_INDEX_SCHEMA } from "../static/source/image-embedding-index.mjs";

const VOCABULARY = "/assets/miscellaneous/keymap.json";
const ACTIONS = "/assets/macaw/actions/keymaps.json";
const vocabulary = {
  "/assets/miscellaneous/dog.png": { description: "A dog plays in the garden." },
  "/assets/miscellaneous/house.png": { description: "A house with a garden." }
};
const ranker = async ({ candidates }) => candidates.map(({ conceptId }, index) => ({ conceptId, score: 1 - index / 100 }));

test("updated image consumers retain older parsed indexes while sharing their model and inference queue", async t => {
  const vector = axis => Float32Array.from({ length: 384 }, (_, index) => Number(index === axis));
  const indexedRows = Object.entries(vocabulary).map(([path, metadata], index) => ({
    path, sourceKind: "image_asset", embeddingText: metadata.description, vector: vector(index)
  }));
  const oldIndex = new Map(indexedRows.map(row => [
    `${row.sourceKind}\u0000${row.path}`, { embeddingText: row.embeddingText, vector: row.vector }
  ]));
  const oldIndexPromise = Promise.resolve(oldIndex);
  let active = 1, peak = 1, calls = 0, released = false, releaseLegacy;
  const oldInference = new Promise(resolve => { releaseLegacy = () => {
    if (released) return;
    released = true; active--; resolve();
  }; });
  t.after(() => releaseLegacy());
  const engine = { async embedBatch(texts) {
    calls++; active++; peak = Math.max(peak, active);
    try {
      await new Promise(resolve => setImmediate(resolve));
      return texts.map(text => vector(text === "house" ? 1 : 0));
    } finally { active--; }
  } };
  const oldRanking = { engine, tail: oldInference, indexPromise: oldIndexPromise, queries: new Map() };
  const owner = { [Symbol.for("caatuu.sharedImageRanking.v2")]: oldRanking };
  let indexLoads = 0;
  const search = createEnglishImageSearch({ owner, loadJson: async path => {
    if (path === VOCABULARY) return vocabulary;
    assert.equal(path, IMAGE_EMBEDDING_INDEX_URL);
    indexLoads++;
    return { schema: IMAGE_INDEX_SCHEMA, inputLanguage: "en", modelId: ENGLISH_MINILM_RUNTIME.modelId,
      modelFileName: ENGLISH_MINILM_RUNTIME.modelFileName, dimension: 384, encoding: "float32le-base64",
      rows: indexedRows.map(row => {
        const bytes = Buffer.alloc(384 * 4);
        row.vector.forEach((value, index) => bytes.writeFloatLE(value, index * 4));
        return { ...row, vector: bytes.toString("base64") };
      }) };
  } });
  const first = search("dog", { sourceKind: "image_asset" });
  const second = search("house", { sourceKind: "image_asset" });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 0, "new inference must wait for the older consumer's active operation");
  releaseLegacy();
  const results = await Promise.all([first, second]);
  assert.deepEqual(results.map(result => result.mode), ["embedding", "embedding"]);
  assert.deepEqual(results.map(result => result.rows[0].path), Object.keys(vocabulary));
  assert.equal(indexLoads, 1, "current consumers reuse their revision's parsed index");
  assert.equal(calls, 2);
  assert.equal(peak, 1, "old and new consumers never infer concurrently");
  assert.equal(oldRanking.engine, engine);
  assert.equal(owner[Symbol.for("caatuu.sharedImageRanking.v1")], oldRanking);
  assert.equal(oldRanking.indexPromise, oldIndexPromise, "an older consumer retains its own parser result");
  assert.equal(await oldRanking.indexPromise, oldIndex);
  for (const row of indexedRows) {
    assert.deepEqual((await oldRanking.indexPromise).get(`${row.sourceKind}\u0000${row.path}`).vector, row.vector);
  }
});

test("a stalled embedder falls back to catalog matches without launching duplicate model work", async () => {
  let calls = 0;
  const search = createEnglishImageSearch({ loadJson: async () => vocabulary, timeoutMs: 5,
    ranker: () => { calls += 1; return new Promise(() => {}); } });
  for (let index = 0; index < 2; index += 1) {
    const result = await search("dog", { sourceKind: "image_asset" });
    assert.equal(result.mode, "lexical");
    assert.equal(result.rows[0].path, "/assets/miscellaneous/dog.png");
  }
  assert.equal(calls, 1);
});

test("a course without a vector database can search shared images without loading the unrelated action catalog", async () => {
  const loaded = [];
  const search = createEnglishImageSearch({
    loadJson: async (path) => {
      loaded.push(path);
      assert.equal(path, VOCABULARY, "a vocabulary background must not depend on macaw artwork");
      return vocabulary;
    },
    ranker
  });
  const result = await search("dog", { sourceKind: "image_asset" });
  assert.equal(result.mode, "embedding");
  assert.equal(result.rows[0].path, "/assets/miscellaneous/dog.png");
  assert.ok(result.rows.every((row) => row.sourceKind === "image_asset"));
  await search("house", { sourceKind: "image_asset" });
  assert.deepEqual(loaded, [VOCABULARY], "catalog data is reused across meanings");
});

test("a failed action catalog does not invalidate or block an already loaded vocabulary catalog", async () => {
  const loaded = [];
  let actionsAvailable = false;
  const search = createEnglishImageSearch({
    loadJson: async (path) => {
      loaded.push(path);
      if (path === VOCABULARY) return vocabulary;
      if (!actionsAvailable) throw new Error("action catalog unavailable");
      return { "/assets/macaw/actions/wave.png": { description: "A macaw waves hello.", action: "wave_hello" } };
    },
    ranker
  });
  await search("dog", { sourceKind: "image_asset" });
  await assert.rejects(search("macaw", { sourceKind: "macaw_action_asset" }), /action catalog unavailable/u);
  assert.equal((await search("house", { sourceKind: "image_asset" })).rows.length, 2);
  actionsAvailable = true;
  const result = await search("macaw", { sourceKind: "macaw_action_asset" });
  assert.equal(result.rows.length, 1);
  assert.deepEqual(loaded, [VOCABULARY, ACTIONS, ACTIONS]);
});

test("all artwork groups use complete English descriptions independently of course data and headings", () => {
  assert.deepEqual(IMAGE_SOURCES.map(source => source.kind), ["image_asset", "macaw_action_asset", "robot_asset", "ship_asset"]);
  const ship = "/assets/ships/ship%20(1).png";
  const raw = { [ship]: { description: "A pointed spaceship with a blue canopy.", category: "ship",
    orientation: { heading_degrees: 155 } } };
  const [first] = normalizeImageCatalog(raw, "ship_asset");
  raw[ship].orientation.heading_degrees = 45;
  const [rotated] = normalizeImageCatalog(raw, "ship_asset");
  assert.equal(first.embeddingText, raw[ship].description);
  assert.equal(rotated.embeddingText, first.embeddingText, "orientation never enters semantic input");
  assert.deepEqual(first.orientation, { heading_degrees: 155 });
  assert.deepEqual(rotated.orientation, { heading_degrees: 45 });
  assert.equal(first.category, "ship");
  const [robot] = normalizeImageCatalog({ "/assets/robots/robot%20(1).png": { description: "A friendly garden robot.", category: "robot" } }, "robot_asset");
  assert.equal(robot.sourceKind, "robot_asset");
  assert.equal(robot.category, "robot");
  for (const heading of [-1, 360, NaN, Infinity, undefined]) {
    raw[ship].orientation.heading_degrees = heading;
    assert.throws(() => normalizeImageCatalog(raw, "ship_asset"), /heading/);
  }
  assert.throws(() => normalizeImageCatalog({ "/assets/robots/robot.png": { description: "A".repeat(1025) } }, "robot_asset"), /1024/);
  assert.throws(() => normalizeImageCatalog({ "/assets/robots/robot.png": { description: "机器人" } }, "robot_asset"), /English-only/);
});

test("the shared search retains bounded MiniLM batches and ranks the full selected catalog", async () => {
  const raw = Object.fromEntries(Array.from({ length: 70 }, (_, index) => [
    `/assets/miscellaneous/scene-${index}.png`, { description: `A dog in scene ${index}.` }
  ]));
  const batches = [];
  const search = createEnglishImageSearch({
    loadJson: async () => raw,
    ranker: async ({ inputLanguage, query, candidates }) => {
      assert.equal(inputLanguage, "en");
      assert.equal(query.embeddingText, "dog");
      batches.push(candidates.length);
      return candidates.map(({ conceptId }) => ({ conceptId, score: Number(conceptId.split("-").at(-1)) }));
    }
  });
  const result = await search("dog", { sourceKind: "image_asset" });
  assert.deepEqual(batches, [32, 32, 6]);
  assert.equal(result.rows.length, 12);
  assert.equal(result.rows[0].path, "/assets/miscellaneous/scene-69.png");
  assert.equal(result.rows.at(-1).path, "/assets/miscellaneous/scene-58.png");
});

test("a cancelled background query does not fetch metadata or initialize ranking", async () => {
  const controller = new AbortController();
  controller.abort();
  const search = createEnglishImageSearch({
    loadJson: async () => assert.fail("cancelled query fetched metadata"),
    ranker: async () => assert.fail("cancelled query initialized ranking")
  });
  await assert.rejects(search("dog", { sourceKind: "image_asset", signal: controller.signal }), { name: "AbortError" });
});
