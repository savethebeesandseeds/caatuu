import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import * as verbNebulaCore from "../static/source/games/verb-nebula/verb-nebula-core.mjs";
import * as verbExerciseFamilyCore from "../static/source/games/verb-nebula/verb-exercise-family-core.mjs";
import * as childFacingAssets from "../static/source/child-facing-assets.mjs";
import { filterPackagedImageKeymap } from "../../android/tooling/developer-image-catalog.mjs";
import { createBrowserHarness } from "./helpers/fake-browser.mjs";
import { createEnglishImageSearch } from "../static/source/english-image-search.mjs";

const root = new URL("../../../", import.meta.url);
const workspace = await readFile(new URL("../static/source/caatuu-workspace.js", import.meta.url), "utf8");
const json = async path => JSON.parse(await readFile(new URL(path, root), "utf8"));
const keymap = await json("apps/launcher/static/assets/macaw/actions/keymaps.json");
const course = await json("apps/languages/english-from-spanish/course.json");
const raw = await json("apps/languages/english-from-spanish/static/data/games/verb-nebula/content.json");
const pairs = verbNebulaCore.validateVerbNebulaCatalog(raw, { learnerBaseLanguage: "es-ES" });
function between(start, end) {
  const first = workspace.indexOf(start), last = workspace.indexOf(end, first);
  assert.ok(first >= 0 && last > first, start);
  return workspace.slice(first, last);
}
function harness({ catalog = keymap, search } = {}) {
  const browser = createBrowserHarness({ course });
  const state = { verbHintCache: new Map(), verbHintKeymapPromise: null, verbHintById: new Map(),
    verbHintsEnabled: true, verbMatchedIds: new Set(), verbWrongIds: new Set(), verbRound: pairs,
    verbMemoryLoaded: true, verbDifficulty: 1, verbPairs: pairs, verbPairCount: 4, verbQueueIds: [],
    verbEnglishRound: pairs, verbRoundNumber: 1, verbStats: { attempts: 0, matches: 0, rounds: 0 },
    verbContentEncounterId: "image-test-encounter", verbContentGeneration: "image-test-generation" };
  const queries = [];
  let active = 0, peakActive = 0;
  const safePaths = Object.keys(catalog).filter(path => childFacingAssets.isChildFacingMacawActionAssetAllowed(path));
  const defaultSearch = createEnglishImageSearch({
    loadJson: async path => { assert.equal(path, "/assets/macaw/actions/keymaps.json"); return catalog; },
    ranker: async ({ inputLanguage, query, candidates }) => {
      assert.equal(inputLanguage, "en");
      const index = pairs.findIndex(pair => pair.englishAuditText === query.embeddingText);
      const chosen = catalog[safePaths[Math.max(0, index) % safePaths.length]].description;
      return candidates.map(candidate => ({ conceptId: candidate.conceptId, score: candidate.embeddingText === chosen ? 1 : 0 }));
    }
  });
  class Image {
    set src(value) {
      const path = decodeURIComponent(value.split("?")[0]).replace(/^\//u, "");
      readFile(new URL(`apps/launcher/static/${path}`, root)).then(bytes => {
        // A broken path or non-image response must not pass a fake onload.
        assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
        this.onload?.();
      }).catch(() => this.onerror?.());
    }
  }
  Object.assign(browser.context, { state, verbNebulaCore, childFacingAssets, Image, course,
    // The pure serializers require plain objects in their own realm.
    verbExerciseFamilyCore: { ...verbExerciseFamilyCore,
      migrateVerbMemoryToV3: value => verbExerciseFamilyCore.migrateVerbMemoryToV3(structuredClone(value)),
      withVerbFamilyState: (memory, family, value) => verbExerciseFamilyCore.withVerbFamilyState(
        structuredClone(memory), family, structuredClone(value)) },
    sourceLanguage: course.sourceLanguage, targetLanguage: course.targetLanguage,
    interfaceText: id => id, renderVerbNebula() {},
    verbGuidedInteractionLocked: () => false, verbGuidedTargetPending: () => false,
    runtimeAdapter: () => { throw new Error("Course vector database must not be used for shared images"); },
    fetch: async () => ({ ok: true, json: async () => catalog }),
  });
  browser.window.setTimeout = (callback, delay) => setTimeout(callback, delay === 6000 ? 25 : delay);
  vm.runInContext([
    between('const verbStorageKey =', 'const verbHintKeymapUrl ='),
    between('function parseStoredVerbMemory(', 'function validVerbIds('),
    between('const verbHintKeymapUrl =', 'const campaignContractGameIds ='),
    between('const verbHintLookupTimeoutMillis =', 'function verbSolutionRevealDuration'),
    between('function verbHintTokens(', 'function loadVerbImageSearch()'),
    between('async function vectorVerbHintCandidates(', 'async function loadVerbHintsForRound()'),
    between('async function preloadVerbHintsForRound(', 'async function prepareVerbRound('),
    between('function preloadVerbHintAsset(', 'async function transitionToNextVerbRound('),
    between('function renderVerbHintSlot(', 'function verbMatchCardForId('),
  ].join('\n'), browser.context);
  browser.context.loadVerbImageSearch = async () => async (query, options) => {
    queries.push(query);
    assert.equal(options.sourceKind, "macaw_action_asset");
    active += 1; peakActive = Math.max(peakActive, active);
    try { return await (search || defaultSearch)(query, options); }
    finally { active -= 1; }
  };
  return { ...browser, state, queries, get peakActive() { return peakActive; } };
}

test("every English verb reaches shared semantic ranking and its selected image loads without a course database", async () => {
  const game = harness();
  for (const pair of pairs) {
    const hints = await game.context.preloadVerbHintsForRound([pair]);
    assert.equal(hints.get(pair.id).status, "ready", pair.englishAuditText);
    // The pre-existing see/hear artwork pins remain unchanged.
    if (!["see", "hear"].includes(pair.englishAuditText)) assert.ok(game.queries.includes(pair.englishAuditText));
  }
});

test("the reported saved board renders four images before and after matching without changing labels", async () => {
  const game = harness();
  const board = ["listen", "work", "speak", "remember"].map(target => pairs.find(pair => pair.target === target));
  game.state.verbHintById = await game.context.preloadVerbHintsForRound(board);
  assert.deepEqual(game.queries, board.map(pair => pair.englishAuditText));
  assert.equal(game.peakActive, 1, "parallel cards must not contend for the shared model");
  assert.equal(new Set([...game.state.verbHintById.values()].map(hint => hint.assetPath)).size, board.length);
  for (const pair of board) {
    for (const matched of [false, true]) {
      if (matched) game.state.verbMatchedIds.add(pair.id);
      const row = game.context.createVerbMatchCard(pair, "cz");
      assert.equal(row.querySelectorAll("img").length, 1, `${pair.target}, matched=${matched}`);
      assert.equal(row.querySelector("button").disabled, matched);
      assert.ok(row.textContent.includes(pair.target));
      assert.ok(!row.textContent.includes("learning.context"));
    }
  }
  const memory = JSON.parse(game.localStorage.getItem(course.storage.verbMemory
    || `${course.storage.namespace}.verb-memory.v3`)).families.meaning;
  assert.deepEqual(memory.contentAssistedIds.sort(), board.map(pair => pair.id).sort());
  assert.equal(memory.contentEncounterId, game.state.verbContentEncounterId);
  assert.equal(memory.contentGeneration, game.state.verbContentGeneration);
  game.state.verbHintsEnabled = false;
  assert.equal(game.context.renderVerbHintSlot(board[0]).hidden, true);
  game.context.saveVerbMemory();
  assert.deepEqual(Array.from(game.context.readVerbMemory().contentAssistedIds).sort(), board.map(pair => pair.id).sort(),
    "hiding a shown image and saving the board cannot erase assistance");
});

test("a stalled semantic lookup retains an available lexical picture at its deadline", async () => {
  const plain = { "/assets/macaw/actions/macaw%20(21).png": keymap["/assets/macaw/actions/macaw%20(21).png"] };
  const game = harness({ catalog: plain, search: () => new Promise(() => {}) });
  const choices = await game.context.cachedVerbHintCandidates({ englishAuditText: "run" });
  assert.equal(choices.length, 1);
  assert.equal(choices[0].assetPath, Object.keys(plain)[0]);
  assert.equal(game.queries.length, 1);
  assert.equal(game.state.verbHintCache.has("run"), false, "temporary failure must remain retryable");
});

test("Android image filtering supplies the same shared catalog to semantic retrieval", async () => {
  const outputs = new Set(Object.keys(keymap).map(path => decodeURIComponent(path.slice(1))));
  const packaged = filterPackagedImageKeymap(keymap, outputs);
  const game = harness({ catalog: packaged });
  for (const pair of pairs) {
    const hint = (await game.context.preloadVerbHintsForRound([pair])).get(pair.id);
    assert.equal(hint.status, "ready", pair.englishAuditText);
    assert.ok(childFacingAssets.isChildFacingMacawActionAssetAllowed(hint.assetPath));
  }
});
