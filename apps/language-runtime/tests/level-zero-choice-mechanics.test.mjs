import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { createBrowserHarness } from "./helpers/fake-browser.mjs";
import * as verbs from "../static/source/games/verb-nebula/verb-nebula-core.mjs";
import { SOUND_QUASAR_ROUND_COUNT, validateSoundQuasarCatalog, buildSoundQuasarRound,
  createSoundQuasarSession, evaluateSoundQuasarChoice } from "../static/source/games/sound-quasar/sound-quasar-core.mjs";
import { MEMORY_MOON_ROUND_COUNT, selectMemoryMoonChallenges, createMoonSession,
  answerMoonChallenge, advanceMoonChallenge } from "../static/source/games/memory-moon/memory-moon-core.mjs";
import { buildRounds, buildQuestions } from "../../languages/czech/static/source/games/case-cosmos/case-cosmos-content.mjs";

const directories = ["czech", "mandarin-simplified", "spanish", "english-from-spanish",
  "norwegian-bokmal", "arabic-standard", "latin-scientific", "georgian", "russian", "hebrew"];
const json = async path => JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
const workspace = await readFile(new URL("../static/source/caatuu-workspace.js", import.meta.url), "utf8");
function between(start, end) {
  const first = workspace.indexOf(start), last = workspace.indexOf(end, first);
  assert.ok(first >= 0 && last > first);
  return workspace.slice(first, last);
}
function random(seed = 19) {
  return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
}

for (const directory of directories) {
  const course = await json(`../../languages/${directory}/course.json`);
  test(`${course.id} Memory Moon preserves every authored alternative and full sessions at every band`, async () => {
    const pack = await json(`../../languages/${directory}/static/data/games/memory-moon/content.json`);
    const authored = new Map(pack.challenges.map(item => [item.id, item]));
    for (const difficulty of [0, 1, 2, 3]) {
      const { items } = selectMemoryMoonChallenges(pack, { difficulty, random: random() });
      assert.equal(items.length, MEMORY_MOON_ROUND_COUNT);
      for (const item of items) {
        assert.equal(item.difficulty, difficulty);
        assert.deepEqual(new Set(item.choices.map(choice => choice.id)),
          new Set(authored.get(item.id).choices.map(choice => choice.id)));
      }
      let session = createMoonSession(items);
      for (const item of items) {
        session = answerMoonChallenge(session, item.correctChoiceId);
        if (session.phase !== "complete") session = advanceMoonChallenge(session);
      }
      assert.equal(session.phase, "complete");
      assert.equal(session.correctCount, MEMORY_MOON_ROUND_COUNT);
    }
  });

  test(`${course.id} Verb Nebula keeps normal pair settings and solvable zero boards`, async () => {
    const rows = await json(`../../languages/${directory}/static/data/games/verb-nebula/content.json`);
    const pairs = verbs.filterVerbPairsForDifficulty(verbs.validateVerbNebulaCatalog(rows, {
      learnerBaseLanguage: course.sourceLanguage.locale
    }), 0);
    for (const count of verbs.VERB_NEBULA_PAIR_COUNTS) {
      const { round } = verbs.dealVerbRound(pairs, pairs.map(pair => pair.id), count, random());
      assert.equal(round.length, count);
      const matched = new Set();
      for (const pair of round) {
        assert.equal(pair.difficulty, 0);
        assert.equal(verbs.verbPairMatches(pair, pair), true);
        matched.add(pair.id);
      }
      assert.equal(verbs.isVerbRoundComplete(round, matched), true);
    }
  });

  if (["latin-scientific", "georgian", "russian", "hebrew"].includes(directory)) continue;
  test(`${course.id} listening honors four and six alternatives in both zero modes`, async () => {
    const pack = validateSoundQuasarCatalog(await json(`../../languages/${directory}/static/data/games/sound-quasar/content.json`));
    for (const mode of ["words", "sentences"]) for (const choiceCount of [4, 6]) {
      const round = buildSoundQuasarRound(pack, { mode, choiceCount, difficulty: 0, random: random() });
      assert.equal(round.choices.length, choiceCount);
      const rounds = createSoundQuasarSession(pack, { mode, choiceCount, difficulty: 0, random: random() });
      assert.equal(rounds.length, SOUND_QUASAR_ROUND_COUNT);
      for (const item of rounds) {
        assert.equal(item.choices.length, choiceCount);
        assert.equal(evaluateSoundQuasarChoice(item, item.answerId), true);
        assert.ok(item.choices.filter(choice => choice.id !== item.answerId)
          .every(choice => evaluateSoundQuasarChoice(item, choice.id) === false));
      }
    }
  });
}

test("zero Verb Nebula restores saved settings and keeps every pair-count control active", () => {
  for (const count of [null, 2, 4, 6, 8]) {
    const browser = createBrowserHarness({ course: { id: "test" } });
    const state = { verbDifficulty: 0, verbGuidedRequested: false };
    Object.assign(browser.context, { state, verbNebulaCore: verbs,
      countryDictionary: Array.from({ length: 12 }, (_, index) => ({ id: `zero-${index}`,
        kind: "word", target: `target${index}`, source: `source${index}`, englishAuditText: `source${index}`, difficulty: 0 })),
      sourceLanguage: { id: "en", locale: "en" },
      readVerbMemory: () => count === null ? null : { difficulty: 0, pairCount: count },
      safeVerbStat: value => Number(value) || 0,
      setText() {}, saveVerbMemory() {}, setVerbMatchFeedback() {}, renderVerbNebula() {},
      interfaceText: () => "changed"
    });
    browser.window.CaatuuLearning = { difficulty: () => 0, gameSetting: () => count ?? 2 };
    for (const value of verbs.VERB_NEBULA_PAIR_COUNTS) {
      const button = browser.document.createElement("button");
      button.setAttribute("data-verb-pair-count", String(value));
      browser.document.body.append(button);
    }
    vm.runInContext(between("function validVerbIds(ids, pairById)", "function setVerbMatchFeedback(")
      + between("function renderVerbPairCountControls()", "function loadVerbSpeakOnTap()")
      + between("function changeVerbPairCount(event)", "function verbHintTokens(value)"), browser.context);
    browser.context.loadVerbMemory();
    assert.equal(state.verbPairCount, count ?? 2);
    browser.context.renderVerbPairCountControls();
    for (const button of browser.document.querySelectorAll("[data-verb-pair-count]")) {
      assert.equal(button.disabled, false);
      browser.context.changeVerbPairCount({ target: button });
      assert.equal(state.verbPairCount, Number(button.dataset.verbPairCount));
    }
  }
});

test("zero Case Cosmos retains normal randomized contrast counts with one correct solution", async () => {
  const catalog = await json("../../languages/czech/static/data/games/case-cosmos/content.json");
  const counts = new Set();
  for (const round of buildRounds(catalog, 0)) for (const sample of [0, 0.5, 0.999]) {
    const [question] = buildQuestions(round, () => sample);
    counts.add(question.candidates.length);
    assert.equal(question.candidates.filter(choice => choice.matches).length, 1);
    assert.ok(question.candidates.length >= 2 && question.candidates.length <= 4);
    assert.deepEqual(buildQuestions(round, () => sample), buildQuestions({ ...round, difficulty: 1 }, () => sample),
      "the badge never changes the distractor algorithm");
    if (sample === 0.999) assert.equal(question.candidates.length, Math.min(4, round.formPool.length));
  }
  assert.deepEqual([...counts].sort(), [2, 3, 4]);
});

test("Verb Nebula follows live badge defaults while preserving manual counts until the next change", async () => {
  const course = await json("../../languages/czech/course.json");
  const browser = createBrowserHarness({ course });
  const profile = await readFile(new URL("../static/source/learning-profile.js", import.meta.url), "utf8");
  vm.runInContext(profile, browser.context);
  const state = { verbGuidedRequested: false, verbHintById: new Map(), verbHintCache: new Map() };
  let memory = { difficulty: 0, pairCount: 8 };
  let deals = 0;
  Object.assign(browser.context, { state, verbNebulaCore: verbs,
    countryDictionary: [0, 1, 2, 3].flatMap(difficulty => Array.from({ length: 12 }, (_, index) => ({
      id: `band${difficulty}-${index}`, kind: "verb", target: `target${difficulty}item${index}`,
      source: `source${difficulty}item${index}`, englishAuditText: `source${difficulty}item${index}`, difficulty
    }))),
    sourceLanguage: { id: "en", locale: "en" }, readVerbMemory: () => memory,
    safeVerbStat: value => Number(value) || 0, setText() {}, setVerbMatchFeedback() {},
    interfaceText: () => "changed", cancelVerbRoundTransition() {}, resetVerbSelections() {},
    saveVerbMemory() { memory = { difficulty: state.verbDifficulty, pairCount: state.verbPairCount }; },
    renderVerbNebula() { browser.context.renderVerbPairCountControls(); },
    startVerbRound() {
      deals += 1;
      state.verbRound = verbs.dealVerbRound(state.verbPairs, state.verbPairs.map(pair => pair.id), state.verbPairCount, random()).round;
    }
  });
  for (const count of verbs.VERB_NEBULA_PAIR_COUNTS) {
    const button = browser.document.createElement("button");
    button.setAttribute("data-verb-pair-count", String(count));
    browser.document.body.append(button);
  }
  vm.runInContext(between("function validVerbIds(ids, pairById)", "function setVerbMatchFeedback(")
    + between("function renderVerbPairCountControls()", "function loadVerbSpeakOnTap()")
    + between("function changeVerbPairCount(event)", "function verbHintTokens(value)")
    + between("function rebaseVerbDifficulty(", "function resetVerbProgress()"), browser.context);
  browser.window.addEventListener("caatuu:learning-change", event => {
    if (event.detail?.reason === "difficulty") browser.context.rebaseVerbDifficulty({ resetSettings: event.detail.settingsReset === true });
  });
  browser.context.loadVerbMemory();
  browser.context.startVerbRound();
  for (const difficulty of [0, 3, 1, 2, 0]) {
    browser.window.CaatuuLearning.setDifficulty(difficulty);
    assert.equal(state.verbPairCount, [2, 4, 6, 8][difficulty]);
    assert.equal(state.verbRound.length, state.verbPairCount);
    assert.ok(state.verbRound.every(pair => pair.difficulty === difficulty));
    const override = difficulty === 3 ? 2 : 8;
    const button = browser.document.querySelector(`[data-verb-pair-count="${override}"]`);
    browser.context.changeVerbPairCount({ target: button });
    assert.equal(browser.window.CaatuuLearning.gameSetting("verbPairs"), override);
    browser.window.CaatuuLearning.setDifficulty(difficulty);
    assert.equal(state.verbPairCount, override);
    state.verbMemoryLoaded = false;
    browser.context.loadVerbMemory();
    browser.context.startVerbRound();
    assert.equal(state.verbRound.length, override);
    const before = deals;
    browser.context.rebaseVerbDifficulty();
    assert.equal(deals, before, "a repeated badge notification preserves the current round");
  }
  const { gameSettingsStorageKey, preferenceStorageKey } = browser.window.CaatuuLearning.storage;
  const external = JSON.parse(browser.localStorage.getItem(gameSettingsStorageKey));
  external.selectionRevision += 2;
  external.values.verbPairs = 2;
  browser.localStorage.setItem(gameSettingsStorageKey, JSON.stringify(external));
  browser.window.dispatchEvent({ type: "storage", key: preferenceStorageKey });
  assert.equal(state.verbPairCount, 2, "an external away/back change resets the mounted same-level board");
  assert.equal(state.verbRound.length, 2);
});
