import assert from "node:assert/strict";
import test from "node:test";

import { createNounVisual } from "../static/source/games/grammar-gravity/noun-visual.mjs";
import { createEnglishImageSearch } from "../static/source/english-image-search.mjs";
import { createBrowserHarness } from "./helpers/fake-browser.mjs";

const ORIGIN = "https://caatuu.test";
const DOG = "/assets/miscellaneous/dog.png";
const HOUSE = "/assets/miscellaneous/house.png";
const turn = () => new Promise((resolve) => setImmediate(resolve));
const noun = (english = "dog", id = `noun.${english}`) => ({
  id, revision: 1, english, targetText: "Hund", learnerBaseText: "perro"
});
const result = (path = DOG, fields = {}) => ({ results: [{ sourceKind: "image_asset", sourceId: path, ...fields }] });

test("readiness covers retrieval and image decode, and a timed-out image cannot appear late", async () => {
  const browser = createBrowserHarness();
  const image = browser.document.createElement("img");
  let finishSearch;
  let finishDecode;
  let timeout;
  const states = [];
  image.decode = () => new Promise((resolve) => { finishDecode = resolve; });
  const helper = createNounVisual({ image, course: { capabilities: { embeddings: true, semanticSearch: true } },
    shell: { location: { origin: ORIGIN } }, onLoadingChange: (value) => states.push(value),
    scope: { setTimeout: (callback) => { timeout = callback; return 1; }, clearTimeout() {} },
    searchImages: () => new Promise((resolve) => { finishSearch = resolve; }) });
  helper.update(noun());
  await turn();
  assert.equal(helper.loading, true);
  finishSearch(result());
  await turn();
  assert.equal(helper.loading, true);
  image.dispatchEvent({ type: "load" });
  assert.equal(helper.loading, true);
  finishDecode();
  await turn();
  assert.equal(helper.loading, false);
  assert.equal(image.hidden, false);
  helper.update(noun("house"));
  await turn();
  timeout();
  assert.equal(helper.loading, false);
  finishSearch(result(HOUSE));
  await turn();
  assert.equal(image.hidden, true);
  assert.equal(image.hasAttribute("src"), false);
  assert.deepEqual(states, [true, false, true, false]);
  helper.destroy();
});
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function fixture(search = async () => result(), { capabilities = { embeddings: true, semanticSearch: true } } = {}) {
  const browser = createBrowserHarness();
  const image = browser.document.createElement("img");
  const captured = { load: [], error: [] };
  const originalAddEventListener = image.addEventListener.bind(image);
  image.addEventListener = (name, listener) => {
    captured[name]?.push(listener);
    originalAddEventListener(name, listener);
  };
  const calls = [];
  const vector = { search(query, options) { calls.push({ query, options, receiver: this }); return search(query, options); } };
  const shell = { location: { origin: ORIGIN }, CaatuuRuntime: { vector } };
  const helper = createNounVisual({ shell, course: { capabilities }, image });
  return {
    helper, image, calls, vector, shell, captured,
    load() {
      image.currentSrc = image.src;
      image.complete = true;
      image.naturalWidth = 100;
      image.dispatchEvent({ type: "load" });
    },
    fail() {
      image.currentSrc = image.src;
      image.dispatchEvent({ type: "error" });
    }
  };
}

test("noun visuals send only independent English to the existing source-filtered retrieval API", async () => {
  const browser = fixture();
  const item = noun();
  for (let index = 0; index < 20; index += 1) browser.helper.update(item);
  await turn();
  assert.equal(browser.calls.length, 1);
  assert.equal(browser.calls[0].query, "dog");
  assert.deepEqual(browser.calls[0].options, { limit: 5, sourceKinds: ["image_asset"] });
  assert.equal(browser.calls[0].receiver, browser.vector);
  assert.equal(browser.image.src, DOG);
  assert.equal(browser.image.hidden, true, "the decorative image stays hidden until loaded");
  browser.load();
  assert.equal(browser.image.hidden, false);
  assert.equal(browser.image.alt, "");
  assert.equal(browser.image.getAttribute("aria-hidden"), "true");
  assert.equal(browser.image.draggable, false);
  assert.equal(browser.image.textContent, "", "retrieval must not produce learner-facing prose");
});

test("retrieval order is authoritative without new scoring, thresholds, or unrelated source kinds", async () => {
  const browser = fixture(async () => ({ results: [
    { sourceKind: "macaw_action_asset", sourceId: "/assets/miscellaneous/macaw.png", score: 1 },
    { sourceKind: "image_asset", sourceId: DOG, score: -0.1 },
    { sourceKind: "image_asset", sourceId: HOUSE, score: 0.99 }
  ] }));
  browser.helper.update(noun());
  await turn();
  assert.equal(browser.image.src, DOG);
});

test("the existing document metadata, chunk metadata, and source ID path shapes are supported", async () => {
  for (const fields of [
    { documentMetadata: { asset_path: DOG }, chunkMetadata: { asset_path: HOUSE }, sourceId: HOUSE },
    { chunkMetadata: { asset_path: DOG }, sourceId: HOUSE },
    { sourceId: DOG }
  ]) {
    const browser = fixture(async () => result(HOUSE, fields));
    browser.helper.update(noun());
    await turn();
    assert.equal(browser.image.src, DOG);
    browser.helper.destroy();
  }
});

test("vocabulary paths normalize to same-origin public aliases, including existing encoded filenames", async () => {
  for (const [input, expected] of [
    [DOG, DOG],
    ["assets/miscellaneous/dog.png", DOG],
    [`${ORIGIN}${DOG}`, DOG],
    ["/assets/miscellaneous/miscellaneous%20(1).png", "/assets/miscellaneous/miscellaneous%20(1).png"],
    ["/assets/miscellaneous/miscellaneous (1).png", "/assets/miscellaneous/miscellaneous%20(1).png"]
  ]) {
    const browser = fixture(async () => result(input));
    browser.helper.update(noun());
    await turn();
    assert.equal(browser.image.src, expected);
    browser.helper.destroy();
  }
});

test("malformed, escaping, external, archival, and non-image paths never reach the image element", async () => {
  for (const path of [
    "https://outside.test/assets/miscellaneous/dog.png",
    "//outside.test/assets/miscellaneous/dog.png",
    "http://caatuu.test/assets/miscellaneous/dog.png",
    "https://user:pass@caatuu.test/assets/miscellaneous/dog.png",
    "data:image/png;base64,abcd", "javascript:alert(1)",
    "/assets/micelaneous/male_gender.png", "/assets/robots/robot.png",
    "/assets/miscellaneous/../robots/robot.png",
    "/assets/miscellaneous/%2e%2e/robots/robot.png",
    "/assets/miscellaneous/%252e%252e.png",
    "/assets/miscellaneous/originals/source.png",
    "/assets/miscellaneous/sub%2fsource.png",
    "/assets/miscellaneous/sub%5csource.png",
    "/assets/miscellaneous/bad%00.png", "/assets/miscellaneous/bad%.png",
    "/assets/miscellaneous/dog.png?fetch=other", "/assets/miscellaneous/dog.png#other",
    "/assets/miscellaneous/not-image.svg", "/assets/miscellaneous/script.js", ""
  ]) {
    const browser = fixture(async () => result(path));
    browser.helper.update(noun());
    await turn();
    assert.equal(browser.image.hasAttribute("src"), false, path);
    assert.equal(browser.image.hidden, true, path);
    browser.helper.destroy();
  }
});

test("a malformed highest result is skipped in favor of the next safe existing retrieval result", async () => {
  const browser = fixture(async () => ({ results: [
    ...result("https://outside.test/dog.png").results,
    ...result(DOG).results
  ] }));
  browser.helper.update(noun());
  await turn();
  assert.equal(browser.image.src, DOG);
});

test("late search responses cannot paint an old noun and model work remains single-flight", async () => {
  const dog = deferred();
  const house = deferred();
  const browser = fixture((query) => query === "dog" ? dog.promise : house.promise);
  browser.helper.update(noun());
  await turn();
  browser.helper.update(noun("house"));
  await turn();
  assert.deepEqual(browser.calls.map(({ query }) => query), ["dog"]);
  dog.resolve(result(DOG));
  await turn();
  assert.equal(browser.image.hasAttribute("src"), false);
  assert.deepEqual(browser.calls.map(({ query }) => query), ["dog", "house"]);
  house.resolve(result(HOUSE));
  await turn();
  browser.load();
  assert.equal(browser.image.src, HOUSE);
  assert.equal(browser.image.hidden, false);
});

test("inactive and visually hidden games neither start searches nor display late results", async () => {
  for (const method of ["setActive", "setVisible"]) {
    const work = deferred();
    const browser = fixture(() => work.promise);
    browser.helper[method](false);
    browser.helper.update(noun());
    await turn();
    assert.equal(browser.calls.length, 0);
    browser.helper[method](true);
    await turn();
    assert.equal(browser.calls.length, 1);
    browser.helper[method](false);
    work.resolve(result());
    await turn();
    assert.equal(browser.image.hasAttribute("src"), false);
    assert.equal(browser.image.hidden, true);
    browser.helper[method](true);
    await turn();
    browser.load();
    assert.equal(browser.image.hidden, false);
    assert.equal(browser.calls.length, 1, "reactivation may reuse the bounded English cache");
    browser.helper[method](false);
    assert.equal(browser.image.hidden, true);
    assert.equal(browser.image.hasAttribute("src"), false);
  }
});

test("hiding before the queued request starts prevents any retrieval work", async () => {
  const browser = fixture();
  browser.helper.update(noun());
  browser.helper.setVisible(false);
  await turn();
  assert.equal(browser.calls.length, 0);
  browser.helper.update(noun("house"));
  browser.helper.setVisible(true);
  await turn();
  assert.deepEqual(browser.calls.map(({ query }) => query), ["house"]);
});

test("old image load and error callbacks cannot reveal or erase the next noun's image", async () => {
  const browser = fixture(async (query) => result(query === "dog" ? DOG : HOUSE));
  browser.helper.update(noun());
  await turn();
  const oldLoaded = browser.captured.load.at(-1);
  const oldFailed = browser.captured.error.at(-1);
  browser.helper.update(noun("house"));
  await turn();
  oldLoaded();
  assert.equal(browser.image.hidden, true);
  browser.load();
  oldFailed();
  assert.equal(browser.image.src, HOUSE);
  assert.equal(browser.image.hidden, false);
});

test("missing matches, thrown searches, and failed image loads disappear without repeated render requests", async () => {
  for (const search of [async () => ({ results: [] }), async () => { throw new Error("unavailable"); }, () => { throw new Error("unavailable"); }]) {
    const browser = fixture(search);
    browser.helper.update(noun());
    await turn();
    browser.helper.update(noun());
    browser.helper.setActive(false);
    browser.helper.setActive(true);
    await turn();
    assert.equal(browser.image.hasAttribute("src"), false);
    assert.equal(browser.image.hidden, true);
    assert.equal(browser.calls.length, 1);
  }
  const browser = fixture();
  browser.helper.update(noun());
  await turn();
  browser.fail();
  assert.equal(browser.image.hidden, true);
  assert.equal(browser.image.hasAttribute("src"), false);
  browser.helper.setVisible(false);
  browser.helper.setVisible(true);
  assert.equal(browser.image.hasAttribute("src"), false, "broken images are cached as misses");
  assert.equal(browser.calls.length, 1);
});

test("English-query cache deduplicates meanings across IDs and evicts beyond 32 entries", async () => {
  const browser = fixture();
  browser.helper.update(noun("dog", "noun.first"));
  await turn();
  browser.helper.update(noun("dog", "noun.second"));
  await turn();
  assert.equal(browser.calls.length, 1);
  for (let index = 0; index < 32; index += 1) {
    browser.helper.update(noun(`item ${index}`, `noun.item-${index}`));
    await turn();
  }
  assert.equal(browser.calls.length, 33);
  browser.helper.update(noun("dog", "noun.first"));
  await turn();
  assert.equal(browser.calls.length, 34, "the least-recent English entry must be evicted");
  browser.helper.update(noun("item 31", "noun.item-31"));
  await turn();
  assert.equal(browser.calls.length, 34);
});

test("changing an item's English audit field invalidates the old noun request independently of its ID", async () => {
  const browser = fixture();
  browser.helper.update(noun("dog", "noun.same"));
  await turn();
  browser.helper.update(noun("house", "noun.same"));
  await turn();
  assert.deepEqual(browser.calls.map(({ query }) => query), ["dog", "house"]);
});

test("capability-off courses and missing English never create a substitute query", async () => {
  for (const capabilities of [{}, { embeddings: true }, { semanticSearch: true }, { embeddings: false, semanticSearch: true }]) {
    const browser = fixture(undefined, { capabilities });
    browser.helper.update(noun());
    await turn();
    assert.equal(browser.calls.length, 0);
  }
  const browser = fixture();
  browser.helper.update({ id: "noun.missing", targetText: "Hund", learnerBaseText: "perro" });
  await turn();
  assert.equal(browser.calls.length, 0);
  assert.doesNotThrow(() => createNounVisual().update(noun()));
});

test("a Spanish-base English course gets shared artwork without a Czech runtime provider", async () => {
  const browser = createBrowserHarness();
  const image = browser.document.createElement("img");
  const calls = [];
  const searches = [];
  const searchImages = createEnglishImageSearch({
    loadJson: async (path) => {
      calls.push(path);
      return { [DOG]: "A dog stands in the grass.", [HOUSE]: "A small house in the countryside." };
    },
    ranker: async (payload) => {
      searches.push(payload);
      return payload.candidates.map(({ conceptId, embeddingText }) => ({conceptId, score: embeddingText.includes("dog") ? 1 : 0}));
    }
  });
  const helper = createNounVisual({ shell: { location: { origin: ORIGIN } }, image, searchImages,
    course: { id: "es-en", sourceLanguage: {locale: "es-ES"}, targetLanguage: {locale: "en-US"},
      capabilities: {embeddings: true, semanticSearch: true} } });
  helper.update({id: "es-en.dog", english: "dog", learnerBaseText: "perro", targetText: "The dog"});
  await turn();
  assert.deepEqual(calls, ["/assets/miscellaneous/keymap.json"]);
  assert.equal(searches[0].inputLanguage, "en");
  assert.equal(searches[0].query.embeddingText, "dog");
  assert.equal(image.src, DOG);
  image.currentSrc=image.src; image.naturalWidth=100; image.dispatchEvent({type:"load"});
  assert.equal(image.hidden,false);
  helper.setVisible(false);
  assert.equal(image.hidden,true);
  helper.destroy();
});

test("destroy clears artwork and ignores outstanding retrieval and image work permanently", async () => {
  const work = deferred();
  const browser = fixture(() => work.promise);
  browser.helper.update(noun());
  await turn();
  browser.helper.destroy();
  work.resolve(result());
  await turn();
  browser.helper.update(noun("house"));
  browser.helper.setActive(true);
  browser.helper.setVisible(true);
  await turn();
  assert.equal(browser.image.hidden, true);
  assert.equal(browser.image.hasAttribute("src"), false);
  assert.equal(browser.calls.length, 1);
});
