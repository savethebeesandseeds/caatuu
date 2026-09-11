import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import * as verbNebulaCore from "../static/source/games/verb-nebula/verb-nebula-core.mjs";
import * as verbExerciseFamilyCore from "../static/source/games/verb-nebula/verb-exercise-family-core.mjs";
import { createInterfaceContent } from "../static/source/interface-content.mjs";
import { createBrowserHarness } from "./helpers/fake-browser.mjs";

const workspace = await readFile(new URL("../static/source/caatuu-workspace.js", import.meta.url), "utf8");
const json = async (relative) => JSON.parse(await readFile(new URL(relative, import.meta.url), "utf8"));
const course = await json("../../languages/english-from-spanish/course.json");
const rows = await json("../../languages/english-from-spanish/static/data/games/verb-nebula/content.json");
const i18n = createInterfaceContent(await json("../static/data/interface/es.v1.json"));
const pairs = verbNebulaCore.validateVerbNebulaCatalog(rows, { learnerBaseLanguage: course.sourceLanguage.locale });
const between = (startMarker, endMarker) => {
  const start = workspace.indexOf(startMarker);
  const end = workspace.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, startMarker);
  return workspace.slice(start, end);
};

function harness() {
  const browser = createBrowserHarness({ course });
  const attempts = [], searches = [], feedback = [], speech = [];
  const state = {
    verbRound: pairs.slice(0, 4), verbEnglishRound: pairs.slice(0, 4),
    verbMatchedIds: new Set(), verbWrongIds: new Set(), verbHintById: new Map(),
    verbStats: { attempts: 0, matches: 0, rounds: 0 }, verbPairCount: 4,
    verbHintsEnabled: false, verbSolutionRevealed: false,
    verbSelectedCzechId: "", verbSelectedEnglishId: ""
  };
  Object.assign(browser.context, {
    state, verbNebulaCore, sourceLanguage: course.sourceLanguage, targetLanguage: course.targetLanguage,
    verbTargetAuditLabel: "English", verbSourceAuditLabel: "Spanish",
    verbTargetLabel: "Inglés", verbSourceLabel: "Español", verbTargetNativeLabel: "English",
    interfaceText: (id, parameters) => i18n.t(id, parameters),
    verbGuidedInteractionLocked: () => false, verbGuidedTargetPending: () => false,
    renderVerbHintSlot: () => browser.document.createElement("span"),
    renderVerbNebula() {}, saveVerbMemory() {},
    resetVerbSelections() { state.verbSelectedCzechId = ""; state.verbSelectedEnglishId = ""; },
    verbRoundComplete: () => verbNebulaCore.isVerbRoundComplete(state.verbRound, state.verbMatchedIds),
    setVerbMatchFeedback: (message, kind) => feedback.push({ message, kind }),
    loadVerbImageSearch: async () => async (query) => { searches.push(query); return { mode: "embedding", rows: [] }; }
  });
  browser.window.CaatuuSemanticLearning = { recordAttempt: async (attempt) => { attempts.push(attempt); } };
  browser.window.CaatuuChrome = { speakText: async (text) => { speech.push(text); } };
  browser.window.setTimeout = () => 1;
  vm.runInContext([
    between("function verbMatchInstruction()", "// This controller"),
    between("function createVerbMatchCard(pair, side)", "function verbMatchCardForId"),
    between("function recordVerbSemanticAttempt(pair", "async function settleVerbMatch"),
    between("async function settleVerbMatch()", "function chooseVerbMatchCard"),
    between("async function vectorVerbHintCandidates(pair)", "async function loadVerbHintKeymap"),
    between("function speakVerbCzechOnTap(verbId)", "function renderVerbMatchStats")
  ].join("\n"), browser.context);
  return { ...browser, state, attempts, searches, feedback, speech };
}

for (const savedGeneration of ["before-reset", undefined]) {
  test(`restored Nebula rounds preserve their saved generation (${savedGeneration ?? "legacy unknown"})`, () => {
    const game = harness();
    const round = pairs.filter(pair => pair.difficulty === 1).slice(0, 4);
    const memory = { difficulty: 1, pairCount: 4, roundIds: round.map(pair => pair.id),
      englishRoundIds: round.map(pair => pair.id), matchedIds: [], contentEncounterId: "saved-encounter",
      contentGeneration: savedGeneration };
    const exposures = [];
    const persisted = [];
    let generation = "after-reset";
    game.window.CaatuuLearning = { difficulty: () => 1, contentGeneration: () => generation,
      recordExposure: (id, event) => exposures.push({ id, ...event }) };
    Object.assign(game.context, {
      countryDictionary: rows, readVerbMemory: () => memory, readVerbMemoryEnvelope: () => null,
      clearVerbSolutionAdvance() {}, persistVerbMemory: value => persisted.push(value),
      verbExerciseFamilyCore: { ...verbExerciseFamilyCore,
        migrateVerbMemoryToV3: value => verbExerciseFamilyCore.migrateVerbMemoryToV3(value ? JSON.parse(JSON.stringify(value)) : null) }
    });
    vm.runInContext([
      between("function emptyVerbStats()", "async function initializeVerbGuidedMode"),
      between("function saveVerbMemory()", "function setVerbMatchFeedback"),
      between("function applyVerbRound(plan", "async function startVerbRound")
    ].join("\n"), game.context);
    game.context.loadVerbMemory();
    assert.equal(game.state.verbContentEncounterId, "saved-encounter");
    assert.equal(game.state.verbContentGeneration, savedGeneration ?? null);
    game.context.recordVerbContentExposure(round[0], true);
    assert.equal(exposures[0].generation, savedGeneration ?? null);
    game.context.saveVerbMemory();
    assert.equal(persisted.at(-1).families.meaning.contentGeneration, savedGeneration ?? null);
    game.context.applyVerbRound({ round, englishRound: round, queueIds: [] });
    assert.notEqual(game.state.verbContentEncounterId, "saved-encounter");
    assert.equal(game.state.verbContentGeneration, generation);
    generation = "another-reset";
    game.context.recordVerbContentExposure(round[0], true);
    assert.equal(exposures[1].generation, "after-reset");
    assert.equal(persisted.at(-1).families.meaning.contentGeneration, "after-reset");
  });
}

test("Nebula remembers a revealed picture and earlier wrong response when classifying practice", () => {
  const game = harness();
  const events = [];
  game.window.CaatuuLearning = { recordExposure: (id, event) => events.push(event) };
  game.context.recordVerbContentExposure(pairs[0], false);
  game.context.recordVerbContentExposure(pairs[0], true);
  assert.equal(events[0].evidence, "independent");
  assert.equal(events[1].evidence, "assisted");
  vm.runInContext(between("function renderVerbHintSlot(pair)", "function createVerbMatchCard(pair"), game.context);
  game.state.verbHintsEnabled = true;
  game.state.verbHintById.set(pairs[1].id, { status: "ready", assetPath: "/fixture.png" });
  game.context.renderVerbHintSlot(pairs[1]);
  game.state.verbHintsEnabled = false;
  game.context.recordVerbContentExposure(pairs[1], true);
  assert.equal(events[2].evidence, "assisted", "hiding a shown picture cannot restore independence");
  game.state.verbSolutionRevealed = true;
  game.context.recordVerbContentExposure(pairs[2], true);
  assert.equal(events[3].evidence, "exposure");
  assert.equal(events[3].correct, null);
});

test("Spanish-base Verb Nebula renders target/base cards and localized reveal labels", () => {
  const { context, state } = harness();
  const pair = pairs.find((item) => item.target === "speak");
  const target = context.createVerbMatchCard(pair, "cz").children[1].children[0];
  const meaning = context.createVerbMatchCard(pair, "en").children[0];
  assert.equal(target.textContent, "speak"); assert.equal(target.lang, "en-US");
  assert.equal(meaning.textContent, "hablar"); assert.equal(meaning.lang, "es-ES");
  assert.equal(context.verbMatchInstruction(), i18n.t("verbnebula.instructions"));
  state.verbSolutionRevealed = true;
  const revealed = context.createVerbMatchCard(pair, "en");
  assert.equal(revealed.getAttribute("aria-label"), "speak significa hablar.");
  assert.equal(revealed.disabled, true);
});

test("Spanish-base matching feedback uses Spanish while English alone feeds image search and audit signals", async () => {
  const { context, state, attempts, searches, feedback, speech } = harness();
  const pair = pairs[0];
  state.verbHintsEnabled = true;
  state.verbHintById.set(pair.id, { status: "unavailable" });
  await context.vectorVerbHintCandidates(pair);
  assert.deepEqual(searches, [pair.englishAuditText]);
  state.verbSpeakOnTap = true;
  context.speakVerbCzechOnTap(pair.id);
  assert.deepEqual(speech, [pair.target]);
  state.verbSelectedCzechId = pair.id; state.verbSelectedEnglishId = pairs[1].id;
  await context.settleVerbMatch();
  assert.equal(state.verbStats.matches, 0);
  assert.equal(feedback.at(-1).message, i18n.t("verbnebula.match.retry"));
  state.verbWrongTimer = null;
  state.verbSelectedCzechId = pair.id; state.verbSelectedEnglishId = pair.id;
  await context.settleVerbMatch();
  assert.equal(state.verbStats.matches, 1);
  assert.equal(feedback.at(-1).message, i18n.t("verbnebula.match.meaning", { target: pair.target, meaning: pair.source }));
  assert.equal(attempts.length, 2);
  for (const attempt of attempts) {
    assert.equal(attempt.item.source, pair.source);
    assert.equal(attempt.item.englishAuditText, pair.englishAuditText);
    assert.equal(attempt.context.expectedSource, pair.source);
    assert.equal(attempt.context.hintShown, false);
    for (const signal of attempt.signals) {
      assert.equal(signal.locale, "en");
      assert.ok(signal.text.includes(`“${pair.englishAuditText}”`));
      assert.ok(!signal.text.includes(pair.source));
    }
  }
});

test("unsupported verb clues stay empty instead of showing unrelated actions or incidental description matches", async () => {
  const { context, state } = harness();
  const keymap = await json("../../launcher/static/assets/macaw/actions/keymaps.json");
  const keymapRows = Object.entries(keymap).map(([assetPath, row]) => ({
    assetPath, action: row.action.replaceAll("_", " "), description: row.description
  }));
  state.verbHintCache = new Map();
  state.verbHintsEnabled = true;
  Object.assign(context, {
    loadVerbHintKeymap: async () => keymapRows,
    verbHintLookupTimeoutMillis: 1,
    loadableVerbHint: async ([candidate]) => ({ status: "ready", ...candidate }),
    preloadVerbHintAsset: async () => {}
  });
  vm.runInContext([
    between("const verbHintExactAssets =", "const campaignContractGameIds"),
    between("const verbHintStopwords =", "function verbSolutionRevealDuration"),
    between("function verbHintTokens(value)", "function normalizeVerbHintPath"),
    between("async function fallbackVerbHintCandidates(pair)", "function loadableVerbHint"),
    between("function cachedVerbHintCandidates(pair)", "async function loadVerbHintsForRound"),
    between("async function preloadVerbHintsForRound(round)", "async function prepareVerbRound"),
    between("function renderVerbHintSlot(pair)", "function createVerbMatchCard")
  ].join("\n"), context);
  for (const meaning of ["go", "do"]) {
    const pair = pairs.find((item) => item.englishAuditText === meaning);
    assert.equal((await context.cachedVerbHintCandidates(pair)).length, 0, meaning);
    const hints = await context.preloadVerbHintsForRound([pair]);
    assert.equal(hints.get(pair.id).status, "unavailable");
    state.verbHintById = hints;
    const slot = context.renderVerbHintSlot(pair);
    assert.equal(slot.hidden, true);
    assert.equal(slot.querySelector("img"), null);
  }
  const listen = pairs.find((item) => item.englishAuditText === "listen");
  const candidates = await context.cachedVerbHintCandidates(listen);
  assert.ok(candidates.some((item) => item.assetPath.endsWith("180-hear_listen.png")));
  state.verbHintById = await context.preloadVerbHintsForRound([listen]);
  const slot = context.renderVerbHintSlot(listen);
  assert.equal(slot.hidden, false);
  assert.ok(keymap[slot.querySelector("img").src].action.split("_").includes("listen"));
});
