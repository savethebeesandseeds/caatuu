import assert from "node:assert/strict";
import test from "node:test";
import { createEnglishImageSearch } from "../static/source/english-image-search.mjs";

const VOCABULARY = "/assets/miscellaneous/keymap.json";
const ACTIONS = "/assets/macaw/actions/keymaps.json";
const vocabulary = {
  "/assets/miscellaneous/dog.png": { description: "A dog plays in the garden." },
  "/assets/miscellaneous/house.png": { description: "A house with a garden." }
};
const ranker = async ({ candidates }) => candidates.map(({ conceptId }, index) => ({ conceptId, score: 1 - index / 100 }));

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
  await assert.rejects(search("macaw"), /action catalog unavailable/u);
  assert.equal((await search("house", { sourceKind: "image_asset" })).rows.length, 2);
  actionsAvailable = true;
  const result = await search("macaw");
  assert.equal(result.rows.length, 3);
  assert.deepEqual(loaded, [VOCABULARY, ACTIONS, ACTIONS]);
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
