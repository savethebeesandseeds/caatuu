import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { createBrowserHarness } from "./helpers/fake-browser.mjs";
import { wordWorldEvidenceBank } from "../static/source/word-world-progression.mjs";
import { buildWordReconstructionChallenge, isWordReconstructionCorrect } from "../static/source/word-net-core.mjs";

const controller = await readFile(new URL("../static/source/product-word-world.mjs", import.meta.url), "utf8");
const profile = await readFile(new URL("../static/source/learning-profile.js", import.meta.url), "utf8");
const functions = ["beginWordWorldEncounter", "completeWordWorldExposure", "restartStandardWordWorldAfterReset",
  "showStandardPhrase", "showPreviousSentence", "currentReconstructionKey", "ensureReconstructionChallenge",
  "shouldBlockReconstructionAdvance", "submitReconstructionChallenge", "retryReconstructionChallenge", "activateNextSentence",
  "awardTimedRevealXp", "currentGuidedPhraseToken", "applyTranslationMode",
  "markGuidedDictionaryHint", "syncWordTranslation", "renderWordMetadata"];
const bodies = functions.map(name => {
  const body = controller.match(new RegExp(`(?:^|\\n)((?:async )?function ${name}\\([\\s\\S]*?\\n\\})(?=\\r?\\n|$)`, "u"))?.[1];
  assert.ok(body, `${name} must have an executable controller boundary`);
  return body;
}).join("\n");

function browser(storage) {
  const harness = createBrowserHarness({ course: { id: "exposure-test", storage: { namespace: "caatuu-exposure-test" } } });
  if (storage) harness.window.localStorage = storage;
  harness.window.navigator.locks = { request: async (_key, action) => action() };
  vm.runInContext(profile, harness.context);
  return harness;
}

let sequence = 0;
function game(storage) {
  const harness = browser(storage);
  const learning = harness.window.CaatuuLearning;
  const state = { busy: false, contentMode: "standard", currentContentMode: "standard", phraseRequestId: 0,
    translationMode: "reconstruct", guidedMode: false, guidedRequested: false, reconstruction: null,
    history: [], historyCursor: 0, generationMode: "random", wordSelectionRequested: false,
    branchQueue: { markUsed() {} } };
  state.standardProvider = { corpusVersion: "test", primaryWord: () => "target", markUsed() {}, records: [] };
  const generated = [];
  const timers = [];
  harness.window.setTimeout = callback => { timers.push(callback); return timers.length; };
  const context = vm.createContext({ state, window: harness.window, document: harness.document,
    performance: { now: () => 0 }, $: () => null, interfaceText: () => "", sourceLanguageLabel: "Base",
    targetLocale: "en", providerContext: {}, wordWorldReadingGuide: null, preparedTokenForWord: () => null,
    replaceTargetText() {}, syncTranslationMenu() {}, syncSpeechControl() {},
    sourcePrimaryLanguage: "en", newContentEncounterId: () => `visit-${++sequence}`, wordWorldEvidenceBank,
    learningDifficulty: () => 1, normalizeWord: value => String(value || ""), sentenceFingerprint: value => value,
    setBusy: value => { state.busy = value; }, setTranslation: value => { state.currentTranslation = value; },
    selectWord() {}, abortWordLookup() {}, syncCzechSentenceSelection() {}, renderCzechSentence() {},
    renderWordGuidedStatus() {}, renderWordWorldLearning() {}, renderReconstruction() {},
    setStatus() {}, setProgress() {}, cancelBackgroundWork() {}, hideSceneAsset() {},
    resetSentenceFeedback() {}, saveStandardUsage() {}, rememberStep() {}, recordStandardSemanticExposure() {},
    rememberSeenSentence() {}, savePreparedQueue() {}, holdSentenceTransition: async () => {},
    updateSceneAsset: async () => {}, lookupSelectedWord: async () => {}, playInstruction: () => "",
    localTranslation: () => "base", resolvedChallengePromptSide: () => "source",
    buildTargetReconstructionChallenge: () => ({ answerTokens: ["target"], options: [
      { id: "correct", text: "target" }, { id: "wrong", text: "wrong" }] }),
    guidedWordInteractionLocked: () => false,
    reconstructionSelectedOptions: round => round.challenge.options.filter(option => round.selectedIds.includes(option.id)),
    reconstructionSelectedText: () => "answer", isWordReconstructionCorrect: selected => selected[0] === "target",
    claimSentenceReward: () => true, cancelCzechSpeech() {}, stabilizeReconstructionResultViewport() {}, announceCampaignRoundSuccess() {},
    generateFromConfiguredMode: (...args) => generated.push(args),
    generateStandardFromConfiguredMode: (...args) => generated.push(args),
    generateGuidedStandardPhrase: async (...args) => generated.push(args),
    clearTranslationTimer: () => { state.translationTimerId = 0; }, syncTranslationToggle() {},
    hasTranslationMode: () => true, isTimedTranslationMode: mode => mode === "timed",
    translationModes: { timed: { delayMs: 1 }, reconstruct: {}, visible: {} }
  });
  vm.runInContext(bodies, context);
  const run = command => vm.runInContext(command, context);
  const present = async (id = "item-a") => {
    context.selection = { record: { id, cs: "target", en: "base", difficulty: 1 } };
    await run("showStandardPhrase(selection)");
  };
  return { ...harness, context, state, learning, run, present, generated, timers,
    history: () => learning.contentHistory("word-world", "sentences") };
}

test("a miss reveals correction and Next completes only the original encounter", async () => {
  const a = game(); await a.present();
  assert.deepEqual(Object.keys(a.history()), [], "presentation alone is not a completed encounter");
  const round = a.run("ensureReconstructionChallenge()"); round.selectedIds = ["wrong"];
  await a.run("submitReconstructionChallenge()");
  assert.equal(round.submitted, true); assert.equal(round.correct, false);
  await a.run("activateNextSentence()");
  a.run("awardTimedRevealXp()");
  const item = a.history()["item-a"];
  assert.equal(item.exposures, 1); assert.equal(item.mistakes, 1); assert.equal(item.successes, 0);
});

test("retrying a revealed regular answer retains the original first-response evidence", async () => {
  const a = game(); await a.present();
  const round = a.run("ensureReconstructionChallenge()"); round.selectedIds = ["wrong"];
  await a.run("submitReconstructionChallenge()");
  const encounter = a.state.contentEncounterId;
  const performance = structuredClone(a.learning.performance());
  const exposure = structuredClone(a.history());
  const recall = structuredClone(a.learning.contentHistory("word-world", "reconstruct-target"));
  let rewards = 0, campaignSuccesses = 0;
  a.context.claimSentenceReward = () => { rewards += 1; return true; };
  a.context.announceCampaignRoundSuccess = () => { campaignSuccesses += 1; };
  await a.run("retryReconstructionChallenge()");
  assert.equal(a.state.reconstruction, round);
  assert.equal(a.state.contentEncounterId, encounter);
  assert.deepEqual(Array.from(round.selectedIds), ["wrong"]);
  assert.equal(round.submitted, false);
  assert.equal(round.isRetry, true);
  round.selectedIds = ["correct"];
  await a.run("submitReconstructionChallenge()");
  assert.equal(round.correct, true);
  assert.equal(round.awardedXp, 0);
  assert.equal(rewards, 0);
  assert.equal(campaignSuccesses, 0);
  assert.deepEqual(structuredClone(a.learning.performance()), performance);
  assert.deepEqual(structuredClone(a.history()), exposure);
  assert.deepEqual(structuredClone(a.learning.contentHistory("word-world", "reconstruct-target")), recall);
});

test("Guided retry retires the failed immutable task without rewriting its first response", async () => {
  const a = game(); await a.present();
  let recorded = false, revealed = false, aborted = 0;
  const responses = [];
  const lifecycle = {
    state: () => ({ taskFingerprint: "immutable-failed-task", firstResponseRecorded: recorded,
      solutionRevealed: revealed, hintsUsed: false }),
    markSolutionRevealed() { revealed = true; },
    async recordFirstResponse(response) {
      responses.push(response); recorded = true;
      return { result: { qualifiesForIndependentAssessment: false } };
    },
    async abort() { aborted += 1; }
  };
  Object.assign(a.state, { guidedRequested: true, guidedMode: true, guidedLifecycle: lifecycle });
  const round = a.run("ensureReconstructionChallenge()"); round.selectedIds = ["wrong"];
  await a.run("submitReconstructionChallenge()");
  assert.equal(responses.length, 1);
  assert.equal(responses[0].score, 0);
  assert.equal(round.guidedIndependentQualified, false);
  const performance = structuredClone(a.learning.performance());
  const recall = structuredClone(a.learning.contentHistory("word-world", "reconstruct-target"));
  await a.run("retryReconstructionChallenge()");
  await Promise.resolve(); await Promise.resolve();
  assert.equal(responses.length, 1, "retry must not replace the original score with revealed-answer practice");
  assert.equal(aborted, 1);
  assert.equal(a.state.reconstruction, null);
  assert.equal(a.state.guidedLifecycle, null);
  assert.equal(a.generated.length, 1, "the existing Guided advance starts a fresh task");
  assert.deepEqual(structuredClone(a.learning.performance()), performance);
  assert.deepEqual(structuredClone(a.learning.contentHistory("word-world", "reconstruct-target")), recall);
});

test("selecting the same record again creates a fresh unanswered reconstruction", async () => {
  const a = game(); await a.present();
  const oldId = a.state.contentEncounterId;
  const first = a.run("ensureReconstructionChallenge()"); first.selectedIds = ["correct"];
  await a.run("submitReconstructionChallenge()");
  await a.present();
  assert.notEqual(a.state.contentEncounterId, oldId);
  const repeated = a.run("ensureReconstructionChallenge()");
  assert.notEqual(repeated, first); assert.equal(repeated.submitted, false);
  await a.run("activateNextSentence()");
  assert.equal(a.generated.length, 0, "Next must wait for this visit's answer");
  assert.equal(a.history()["item-a"].exposures, 1);
  repeated.selectedIds = ["correct"]; await a.run("submitReconstructionChallenge()");
  assert.equal(a.history()["item-a"].exposures, 2);
});

test("standard history restored after a generative start has its own countable encounter", async () => {
  const a = game();
  a.state.currentContentMode = "generative"; a.state.translationMode = "visible";
  a.state.history = [{ sentence: "generated", contentMode: "generative" },
    { id: "item-a", word: "target", sentence: "target", en: "base", contentMode: "standard" }];
  await a.run("showPreviousSentence()");
  assert.ok(a.state.contentEncounterId);
  a.run("completeWordWorldExposure(true)");
  assert.equal(a.history()["item-a"].exposures, 1);
});

test("a completed old round cannot be counted again after another tab resets", async () => {
  const a = game(); await a.present();
  a.run("completeWordWorldExposure(true)");
  const other = browser(a.window.localStorage); other.window.CaatuuLearning.resetProgress();
  a.state.translationMode = "visible";
  await a.run("activateNextSentence()");
  assert.deepEqual(Object.keys(a.history()), []);
});

test("Previous completes a visible current encounter before starting the history visit", async () => {
  const a = game(); await a.present(); a.state.translationMode = "visible";
  const currentId = a.state.contentEncounterId;
  a.state.history = [{ id: "item-a", sentence: "target", contentMode: "standard" },
    { id: "item-b", word: "other", sentence: "other", en: "base", contentMode: "standard" }];
  await a.run("showPreviousSentence()");
  assert.notEqual(a.state.contentEncounterId, currentId);
  assert.equal(a.history()["item-a"].exposures, 1);
  assert.equal(a.history()["item-b"], undefined);
  a.run("completeWordWorldExposure(true)");
  assert.equal(a.history()["item-b"].exposures, 1);
});

test("an unfinished pre-reset round is fenced before any storage notification arrives", async () => {
  const a = game(); await a.present();
  const other = browser(a.window.localStorage); other.window.CaatuuLearning.resetProgress();
  assert.equal(a.run("completeWordWorldExposure(false)"), false);
  assert.deepEqual(Object.keys(a.history()), []);
  await a.present(); a.run("completeWordWorldExposure(true)");
  await a.learning.retryPendingSaves();
  assert.equal(browser(a.window.localStorage).window.CaatuuLearning.contentHistory("word-world", "sentences")["item-a"].exposures, 1);
});

test("in-memory storage retries retain one accepted encounter without replaying the controller", async () => {
  const a = game(); await a.present();
  const write = a.window.localStorage.setItem.bind(a.window.localStorage);
  a.window.localStorage.setItem = () => { throw new Error("storage full"); };
  assert.equal(a.run("completeWordWorldExposure(false)"), true);
  assert.equal(a.state.contentEncounterCompleted, true);
  assert.equal(a.run("completeWordWorldExposure(null)"), false);
  assert.equal(a.history()["item-a"].exposures, 1);
  a.window.localStorage.setItem = write;
  await a.learning.retryPendingSaves();
  assert.equal(browser(a.window.localStorage).window.CaatuuLearning.contentHistory("word-world", "sentences")["item-a"].exposures, 1);
});

test("a missing API does not latch a completion that was never accepted", async () => {
  const a = game(); await a.present();
  a.window.CaatuuLearning = {};
  assert.equal(a.run("completeWordWorldExposure(true)"), false);
  assert.equal(a.state.contentEncounterCompleted, false);
  a.window.CaatuuLearning = a.learning;
  assert.equal(a.run("completeWordWorldExposure(true)"), true);
});

test("reload displays another visit without fabricating a completed encounter", async () => {
  const a = game(); await a.present(); a.run("completeWordWorldExposure(true)");
  await a.learning.retryPendingSaves();
  const reloaded = game(a.window.localStorage); await reloaded.present();
  assert.equal(reloaded.history()["item-a"].exposures, 1);
  reloaded.run("completeWordWorldExposure(false)");
  assert.equal(reloaded.history()["item-a"].exposures, 2);
});

test("a queued reveal from a retired sentence cannot complete its replacement", async () => {
  const a = game(); await a.present();
  a.state.translationMode = "timed";
  a.run("applyTranslationMode({ restartTimer: true })");
  const oldReveal = a.timers[0];
  await a.present("item-b"); a.run("applyTranslationMode({ restartTimer: true })");
  const timerId = a.state.translationTimerId;
  oldReveal();
  assert.equal(a.state.translationVisible, false);
  assert.equal(a.state.translationTimerId, timerId, "the new reveal timer must remain cancellable");
  assert.deepEqual(Object.keys(a.history()), []);
  a.timers[1]();
  assert.equal(a.history()["item-b"].exposures, 1);
});

test("same-tab and cross-tab reset handlers retire the active encounter and pending turn", async () => {
  const registration = controller.slice(controller.indexOf('  window.addEventListener("caatuu:learning-change"'),
    controller.indexOf("\n}\n\nasync function init()"));
  for (const crossTab of [false, true]) {
    const a = game(); await a.present();
    const listeners = {};
    a.window.addEventListener = (type, handler) => { listeners[type] = handler; };
    vm.runInContext(registration, a.context);
    const requestId = a.state.phraseRequestId;
    if (crossTab) listeners.storage({ key: `${a.learning.storage.performanceStorageKey}.reset`, oldValue: "a", newValue: "b" });
    else listeners["caatuu:learning-change"]({ detail: { reason: "progress-reset" } });
    assert.equal(a.state.contentEncounterId, ""); assert.equal(a.state.reconstruction, null);
    assert.ok(a.state.phraseRequestId > requestId);
    assert.equal(a.generated.length, 1);
    assert.equal(a.run("completeWordWorldExposure(true)"), false);
  }
});

test("a cancelled reveal cannot count the same sentence after its timer is replaced", async () => {
  const a = game(); await a.present(); a.state.translationMode = "timed";
  a.run("applyTranslationMode({ restartTimer: true })");
  a.run("applyTranslationMode({ restartTimer: true })");
  a.timers[0]();
  assert.deepEqual(Object.keys(a.history()), []);
  assert.equal(a.state.translationVisible, false);
  a.timers[1]();
  assert.equal(a.history()["item-a"].exposures, 1);
});

test("first unsupported reconstruction is independent only in its actual direction", async () => {
  for (const promptSide of ["source", "target"]) {
    const a = game(); a.state.contentNextPromptSide = promptSide;
    a.context.buildSourceReconstructionChallenge = a.context.buildTargetReconstructionChallenge;
    await a.present();
    const round = a.run("ensureReconstructionChallenge()"); round.selectedIds = ["correct"];
    await a.run("submitReconstructionChallenge()");
    const bank = wordWorldEvidenceBank(promptSide);
    assert.equal(a.learning.contentHistory("word-world", bank)["item-a"].independentSuccesses, 1);
    assert.equal(a.history()["item-a"].independentSuccesses, 0, "shared presentation history has no directional credit");
    assert.deepEqual(Object.keys(a.learning.contentHistory("word-world", wordWorldEvidenceBank(promptSide === "source" ? "target" : "source"))), []);
    await a.run("activateNextSentence()");
    assert.equal(a.learning.contentHistory("word-world", bank)["item-a"].exposures, 1);
  }
});

test("dictionary support remains assisted when its card is subsequently hidden", async () => {
  const a = game(); await a.present();
  const node = a.registry.element("wordNetWordTranslation");
  a.context.$ = selector => a.registry.element(selector.slice(1));
  Object.assign(a.state, { selectedWord: "target", wordSelectionRequested: true,
    wordCardPreferences: { showCard: true }, selectedWordMeaning: "base" });
  a.state.translationMode = "visible";
  a.run("syncWordTranslation()");
  assert.equal(node.hidden, false, "the support was actually displayed in ordinary reading mode");
  a.state.translationMode = "reconstruct";
  a.state.wordCardPreferences.showCard = false; a.run("syncWordTranslation()");
  a.context.$ = () => null;
  const round = a.run("ensureReconstructionChallenge()"); round.selectedIds = ["correct"];
  await a.run("submitReconstructionChallenge()");
  const progress = a.learning.contentHistory("word-world", "reconstruct-target")["item-a"];
  assert.equal(progress.assistedSuccesses, 1); assert.equal(progress.independentSuccesses, 0);
  assert.equal(progress.spacedSuccesses, 0);
});

test("switching from a revealed sentence to reconstruction records supported practice once", async () => {
  const a = game(); await a.present(); a.state.translationMode = "timed";
  a.run("applyTranslationMode({ restartTimer: true })"); a.timers[0]();
  a.state.translationMode = "reconstruct"; a.run("applyTranslationMode()");
  const round = a.run("ensureReconstructionChallenge()"); round.selectedIds = ["correct"];
  await a.run("submitReconstructionChallenge()");
  const progress = a.learning.contentHistory("word-world", "reconstruct-target")["item-a"];
  assert.equal(progress.assistedSuccesses, 1); assert.equal(progress.independentSuccesses, 0);
  assert.equal(a.history()["item-a"].exposures, 1);
});

test("actual full-sentence reconstruction assessment survives a durable directional save", async () => {
  for (const reverse of [false, true]) {
    const a = game(); await a.present();
    const challenge = buildWordReconstructionChallenge("We need clean water.", ["They have warm food."], { distractorCount: 2 });
    a.context.buildTargetReconstructionChallenge = () => challenge;
    a.context.isWordReconstructionCorrect = isWordReconstructionCorrect;
    const round = a.run("ensureReconstructionChallenge()");
    const available = [...challenge.options];
    round.selectedIds = challenge.answerTokens.map(token => {
      const index = available.findIndex(option => option.text.toLowerCase() === token.toLowerCase());
      assert.ok(index >= 0); return available.splice(index, 1)[0].id;
    });
    if (reverse) round.selectedIds.reverse();
    a.context.reconstructionSelectedOptions = value => value.selectedIds.map(id => value.challenge.options.find(option => option.id === id));
    await a.run("submitReconstructionChallenge()"); await a.learning.retryPendingSaves();
    const restored = browser(a.window.localStorage).window.CaatuuLearning.contentHistory("word-world", "reconstruct-target")["item-a"];
    assert.equal(round.correct, !reverse);
    assert.equal(restored.independentSuccesses, reverse ? 0 : 1);
    assert.equal(restored.mistakes, reverse ? 1 : 0);
    assert.equal(restored.exposures, 1);
  }
});
test("directional assessment carries the previous shared presentation time before recording this encounter", async () => {
  const a = game(); await a.present();
  const calls = []; const prior = '2026-01-19T12:00:00.000Z'; let sharedTime = prior;
  a.window.CaatuuLearning = { contentHistory: (_game, bank) => bank === 'sentences' ? { 'item-a': { lastSeenAt: sharedTime } } : {},
    recordExposure: (_game, event) => { calls.push(event); if (event.bankId === 'sentences') sharedTime = '2026-01-20T12:00:00.000Z'; return true; } };
  const round = a.run('ensureReconstructionChallenge()');
  a.context.assessedRound = round;
  a.run('completeWordWorldExposure(true, { round: assessedRound })');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].bankId, 'sentences');
  assert.equal(calls[1].bankId, 'reconstruct-target');
  assert.equal(calls[1].previousExposureAt, prior);
  assert.equal(calls[1].evidence, 'independent', 'recent exposure constrains spacing, not the first-response support classification');
});
