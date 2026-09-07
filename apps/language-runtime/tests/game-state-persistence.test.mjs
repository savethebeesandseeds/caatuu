import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { createBrowserHarness } from "./helpers/fake-browser.mjs";

const [workspace, wordWorld, learning, verbFamily] = await Promise.all([
  "caatuu-workspace.js", "product-word-world.mjs", "learning-profile.js", "games/verb-nebula/verb-exercise-family-core.mjs"
].map((name) => readFile(new URL(`../static/source/${name}`, import.meta.url), "utf8")));

function between(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `Missing gameplay boundary: ${startMarker}`);
  return source.slice(start, end);
}

function harness({ reliable = true } = {}) {
  const browser = createBrowserHarness({ course: { id: "cz", storage: { namespace: "caatuu-czech" } } });
  if (reliable) vm.runInContext(learning, browser.context);
  return browser;
}

function installWordWorldStorage(browser) {
  const state = {
    history: [{ word: "dům", sentence: "To je dům.", contentMode: "standard" }],
    recentSentences: ["To je dům."],
    standardProvider: { usage: { snapshot: () => ({ seen: { home: 3 } }) } }
  };
  Object.assign(browser.context, {
    state, targetLocale: "cs", HISTORY_STORAGE_KEY: "caatuu-czech.wordNet.history.v2",
    LEGACY_HISTORY_STORAGE_KEY: "caatuu-czech.wordNet.history.v1", HISTORY_LIMIT: 256,
    STANDARD_USAGE_STORAGE_KEY: "caatuu-czech.wordNet.standardUsage.v1",
    RECENT_SENTENCES_STORAGE_KEY: "caatuu-czech.wordNet.recentSentences", RECENT_SENTENCE_LIMIT: 24
  });
  vm.runInContext([
    between(wordWorld, "function normalizeWordWorldHistoryEntry", "function normalizedSelectionKey"),
    between(wordWorld, "function readStoredArray", "function loadWordCardPreferences"),
    between(wordWorld, "function loadHistory", "function loadPreparedQueue"),
    between(wordWorld, "function loadRecentSentences", "function loadTranslationCache")
  ].join("\n"), browser.context);
  return state;
}

test("Word World keeps unsaved history and usage available, then commits them on retry", async () => {
  const browser = harness();
  const state = installWordWorldStorage(browser);
  const statuses = [];
  browser.window.addEventListener("caatuu:progress-save-status", (event) => statuses.push(event.detail.status));
  const write = browser.localStorage.setItem.bind(browser.localStorage);
  browser.localStorage.setItem = () => { throw new Error("Storage is full"); };
  browser.context.saveHistory();
  browser.context.saveStandardUsage();
  browser.context.saveRecentSentences();
  assert.equal(browser.window.CaatuuLearning.saveStatus().status, "error");
  assert.equal(browser.context.loadHistory()[0].sentence, state.history[0].sentence);
  assert.equal(browser.context.loadStandardUsage().seen.home, 3);
  assert.equal(browser.context.loadRecentSentences()[0], state.recentSentences[0]);
  browser.localStorage.setItem = write;
  await browser.window.CaatuuLearning.retryPendingSaves();
  assert.equal(browser.window.CaatuuLearning.saveStatus().status, "saved");
  assert.deepEqual(statuses, ["error", "saved"]);
  for (const key of ["HISTORY_STORAGE_KEY", "STANDARD_USAGE_STORAGE_KEY", "RECENT_SENTENCES_STORAGE_KEY"]) {
    const primary = browser.localStorage.getItem(browser.context[key]);
    assert.ok(primary);
    assert.equal(browser.localStorage.getItem(`${browser.context[key]}.backup`), primary);
  }
});

test("Word World restores history from its recovery copy and preserves legacy helper-free callers", () => {
  for (const reliable of [true, false]) {
    const browser = harness({ reliable });
    const state = installWordWorldStorage(browser);
    browser.context.saveHistory();
    if (reliable) browser.localStorage.setItem(browser.context.HISTORY_STORAGE_KEY, "{broken");
    assert.equal(browser.context.loadHistory()[0].word, state.history[0].word);
    if (reliable) assert.equal(browser.window.CaatuuLearning.saveStatus().status, "error");
  }
});

test("Word World preserves malformed history and usage, recovering only from valid copies", () => {
  for (const withBackup of [false, true]) {
    const browser = harness();
    const state = installWordWorldStorage(browser);
    const cases = [
      [browser.context.HISTORY_STORAGE_KEY, "{}", browser.context.saveHistory, browser.context.loadHistory,
        (value) => assert.equal(value[0].sentence, state.history[0].sentence)],
      [browser.context.STANDARD_USAGE_STORAGE_KEY, "[]", browser.context.saveStandardUsage, browser.context.loadStandardUsage,
        (value) => assert.equal(value.seen.home, 3)]
    ];
    for (const [key, malformed, save, load, check] of cases) {
      if (withBackup) save();
      browser.localStorage.setItem(key, malformed);
      const restored = load();
      assert.equal(browser.window.CaatuuLearning.saveStatus().status, "error");
      if (withBackup) check(restored);
      save();
      assert.equal(browser.localStorage.getItem(withBackup ? `${key}.damaged` : key), malformed);
      if (withBackup) check(JSON.parse(browser.localStorage.getItem(key)));
    }
  }
});

function installVerbStorage(browser) {
  const state = {
    verbMemoryLoaded: true, verbGuidedRequested: false, verbDifficulty: 1,
    verbPairs: [{ id: "be" }], verbPairCount: 4, verbQueueIds: [],
    verbRound: [{ id: "be" }], verbEnglishRound: [{ id: "be" }],
    verbMatchedIds: new Set(["be"]), verbHintsEnabled: true, verbRoundNumber: 2,
    verbStats: vm.runInContext("({ attempts: 4, matches: 4, rounds: 1 })", browser.context)
  };
  Object.assign(browser.context, {
    state, verbMemorySchemaVersion: 3,
    verbStorageKey: "caatuu-czech.verb-memory.v3", verbLegacyStorageKey: "caatuu-czech.verb-memory.v2"
  });
  // Run the family core in the same realm as gameplay, as in the real app.
  vm.runInContext(`const verbExerciseFamilyCore = (() => {\n${verbFamily.replace(/^export /gmu, "")}\n`
    + "return { migrateVerbMemoryToV3, withVerbFamilyState, VERB_EXERCISE_FAMILIES }; })();", browser.context);
  vm.runInContext(between(workspace, "function parseStoredVerbMemory", "function validVerbIds"), browser.context);
  return state;
}

test("Verb Nebula preserves its round in a recovery copy and retries failed match saves", async () => {
  const browser = harness();
  const state = installVerbStorage(browser);
  browser.context.saveVerbMemory();
  const key = browser.context.verbStorageKey;
  const committed = browser.localStorage.getItem(key);
  assert.ok(committed);
  assert.equal(browser.localStorage.getItem(`${key}.backup`), committed);
  const write = browser.localStorage.setItem.bind(browser.localStorage);
  browser.localStorage.setItem = () => { throw new Error("Storage is full"); };
  Object.assign(state.verbStats, { attempts: 5, matches: 5, rounds: 2 });
  browser.context.saveVerbMemory();
  assert.equal(browser.window.CaatuuLearning.saveStatus().status, "error");
  assert.equal(browser.context.readVerbMemory().stats.matches, 5);
  browser.localStorage.setItem = write;
  await browser.window.CaatuuLearning.retryPendingSaves();
  assert.equal(browser.window.CaatuuLearning.saveStatus().status, "saved");
  browser.localStorage.setItem(key, "{broken");
  assert.equal(browser.context.readVerbMemory().stats.matches, 5);
});

test("Verb Nebula migrates legacy rounds through reliable storage and keeps its fallback", () => {
  for (const reliable of [true, false]) {
    const browser = harness({ reliable });
    installVerbStorage(browser);
    browser.localStorage.setItem(browser.context.verbLegacyStorageKey, JSON.stringify({
      schemaVersion: 2, difficulty: 1, roundIds: ["be"], englishRoundIds: ["be"],
      matchedIds: ["be"], hintsEnabled: true, stats: { attempts: 9, matches: 8, rounds: 2 }
    }));
    assert.equal(browser.context.readVerbMemory().stats.matches, 8);
    const migrated = browser.localStorage.getItem(browser.context.verbStorageKey);
    assert.equal(JSON.parse(migrated).schemaVersion, 3);
    if (reliable) assert.equal(browser.localStorage.getItem(`${browser.context.verbStorageKey}.backup`), migrated);
  }
});

test("Verb Nebula never replaces a round saved by a newer app version", () => {
  const browser = harness();
  installVerbStorage(browser);
  const key = browser.context.verbStorageKey;
  const future = JSON.stringify({ schemaVersion: 4, rounds: 12, savedBy: "newer-app" });
  browser.localStorage.setItem(key, future);
  assert.equal(browser.context.readVerbMemory(), null);
  browser.context.saveVerbMemory();
  assert.equal(browser.localStorage.getItem(key), future);
  assert.equal(browser.window.CaatuuLearning.saveStatus().status, "error");
});

test("Verb Nebula preserves malformed envelopes and recovers only from a valid round copy", () => {
  for (const withBackup of [false, true]) {
    const browser = harness();
    installVerbStorage(browser);
    if (withBackup) browser.context.saveVerbMemory();
    const key = browser.context.verbStorageKey;
    const malformed = JSON.stringify({ schemaVersion: 3, families: "unreadable" });
    browser.localStorage.setItem(key, malformed);
    const restored = browser.context.readVerbMemory();
    if (withBackup) assert.equal(restored.stats.matches, 4);
    else assert.equal(restored, null);
    assert.equal(browser.window.CaatuuLearning.saveStatus().status, "error");
    browser.context.saveVerbMemory();
    assert.equal(browser.localStorage.getItem(withBackup ? `${key}.damaged` : key), malformed);
  }
});

test("Verb reset removes recovery copies and stops the reset if storage refuses removal", () => {
  for (const blocked of [false, true]) {
    const browser = harness();
    const state = installVerbStorage(browser);
    state.verbHintById = new Map();
    state.verbHintCache = new Map();
    const messages = [];
    let cleared = false;
    Object.assign(browser.context, {
      $: () => null, setText: (_selector, text) => messages.push(text), interfaceText: (id) => id,
      cancelVerbRoundTransition: () => { cleared = true; }, emptyVerbStats: () => ({}),
      resetVerbSelections() {}, loadVerbMemory() {}, startVerbRound() {},
      console: { ...console, warn() {} }
    });
    vm.runInContext(between(workspace, "function clearVerbMemory", "function bindVerbNebulaControls"), browser.context);
    const keys = [browser.context.verbStorageKey, browser.context.verbLegacyStorageKey];
    for (const key of keys) browser.window.CaatuuLearning.writeGameState(key, { schemaVersion: 2, rounds: 4 });
    if (blocked) browser.localStorage.removeItem = () => { throw new Error("Storage is unavailable"); };
    browser.context.clearVerbMemory({ confirmed: true });
    assert.equal(cleared, !blocked);
    if (blocked) {
      assert.equal(state.verbMemoryLoaded, true);
      assert.equal(messages.at(-1), "progress.restart.failed");
      assert.equal(browser.window.CaatuuLearning.saveStatus().status, "error");
    } else {
      for (const key of keys) {
        assert.equal(browser.window.CaatuuLearning.readGameState(key), null);
        assert.equal(browser.localStorage.getItem(`${key}.backup`), null);
      }
    }
  }
});
