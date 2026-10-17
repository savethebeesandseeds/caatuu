import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { createBrowserHarness } from "./helpers/fake-browser.mjs";
import { importBrowserLanguageAdapter } from "./browser-module-loader.mjs";
import { segmentLanguageText } from "../contract.mjs";
import * as core from "../static/source/word-net-core.mjs";
import * as teaching from "../static/source/word-world-teaching.mjs";
import * as progression from "../static/source/word-world-progression.mjs";
import * as contentProgression from "../static/source/games/content-progression.mjs";
import { WordNetBranchQueue } from "../static/source/word-net-queue.mjs";
import { renderTargetText } from "../static/source/target-text.mjs";
import { createTargetReadingGuide } from "../static/source/target-reading-guide.mjs";

const [controllerSource, markup, profile, mandarinAdapter, czechAdapter] = await Promise.all([
  readFile(new URL("../static/source/product-word-world.mjs", import.meta.url), "utf8"),
  readFile(new URL("../static/app/index.html", import.meta.url), "utf8"),
  readFile(new URL("../static/source/learning-profile.js", import.meta.url), "utf8"),
  importBrowserLanguageAdapter("../../languages/mandarin-simplified/static/source/language/adapter.mjs"),
  importBrowserLanguageAdapter("../../languages/czech/static/source/language/adapter.mjs")
]);
// Run the complete maintained controller in the browser harness. Only external
// image/speech/model/loading services are replaced; UI handlers and grading run.
const executable = controllerSource
  .replace(/^import[\s\S]*?from\s+["'][^"']+["'];?\r?\n/gmu, "")
  .replace(/\bexport (?=(?:async )?function)/gu, "")
  .replace(/^export default .*;\r?$/gmu, "");

function courseFixture(czech = false) {
  const id = czech ? "cz" : "annotated-test";
  return { id, routePrefix: `/${id}`,
    sourceLanguage: { id: "en", label: "English", locale: "en", direction: "ltr" },
    targetLanguage: czech
      ? { id: "cs", label: "Czech", locale: "cs-CZ", speechLocale: "cs-CZ", direction: "ltr" }
      : { id: "zh", label: "Mandarin", locale: "zh-Hans", speechLocale: "zh-CN", direction: "ltr" },
    capabilities: { generation: false, speech: false, embeddings: false },
    storage: { namespace: `caatuu-${id}`, wordWorldTranslationMode: `caatuu-${id}.translation`,
      wordWorldRecentSentences: `caatuu-${id}.recent`, wordWorldTranslationCache: `caatuu-${id}.cache` }
  };
}

function recordsFixture(czech = false) {
  if (czech) return [{ conceptId: "ww.test.czech", englishText: "I have a book.", sceneQuery: "A book",
    difficulty: 1, topic: "objects", learning: {
      objective: "Build a present-tense sentence.", grammarSignals: ["present-tense", "possession"]
    }, target: { text: "Mám knihu.", tokens: [
      { surface: "Mám", gloss: "have", playable: true }, { surface: "knihu", gloss: "book", playable: true }
    ] } }];
  const rows = [
    ["identity-first", 1, "identity", 1, ["我", "是", "学生"], "I am a student."],
    ["identity-second", 1, "identity", 2, ["她", "是", "老师"], "She is a teacher."],
    ["question-first", 1, "questions", 3, ["你", "是", "老师", "吗"], "Are you a teacher?"],
    ["question-second", 1, "questions", 4, ["她", "是", "学生", "吗"], "Is she a student?"],
    ["advanced-first", 2, "advanced", 5, ["我", "昨天", "没", "去"], "I did not go yesterday."],
    ["unannotated", 1, null, 0, ["猫", "睡觉"], "The cat sleeps."]
  ];
  return rows.map(([id, difficulty, unit, order, surfaces, englishText]) => ({
    conceptId: `ww.test.${id}`, englishText, sceneQuery: englishText, difficulty, topic: "daily-life",
    target: { text: `${surfaces.join("")}。`, tokens: surfaces.map(surface => ({ surface, gloss: "meaning", playable: true })),
      ...(unit ? { learning: { unitId: `foundation.${unit}`, order, title: `Unit ${unit}`,
        explanation: `Teaching explanation for ${id}.`, focus: [unit] } } : {}) }
  }));
}

function preparedContext(course, adapter, records) {
  const byId = new Map(records.map(record => [record.conceptId, record]));
  const selectionRecords = records.map(record => ({ id: record.conceptId, difficulty: record.difficulty,
    sourceText: record.englishText, targetText: record.target.text,
    ...(record.learning ? { learning: record.learning } : {}) }));
  const primaryWord = record => byId.get(record.id).target.tokens[0].surface;
  return { session: { course, records }, sessionRecord: id => byId.get(id),
    segment: (text, context) => segmentLanguageText(adapter, text, context), normalization: adapter.normalization,
    lookupMeaning: async () => null, targetTextGuide: null, generationStrategy: null,
    selectionProvider: { records: selectionRecords, corpusVersion: "teaching-test",
      nextRandom: () => ({ record: selectionRecords[0] }), nextForWord: () => ({ record: selectionRecords[0] }),
      primaryWord, markUsed() {}, difficultyCounts: () => ({ 1: 5, 2: 1, 3: 0 }) }
  };
}

async function game(t, { czech = false, saved = {}, difficulty = 1 } = {}) {
  const course = courseFixture(czech);
  const adapter = czech ? czechAdapter : mandarinAdapter;
  const browser = createBrowserHarness({ course, localStorageValues: {
    [`${course.storage.namespace}.wordNet.wordCardPreferences.v1`]: JSON.stringify({ showCard: false, showMeta: false }), ...saved
  } });
  browser.registry.seed(markup);
  const root = browser.registry.element("wordNetGame");
  root.flatQueryScope = true;
  browser.document.body.append(root);
  const menu = browser.registry.element("wordNetGenerationMenu");
  const units = browser.registry.element("wordNetLearningUnitOptions");
  units.flatQueryScope = false;
  menu.flatQueryScope = false;
  root.append(menu, browser.registry.element("wordNetLearning"));
  menu.append(units);
  const note = browser.registry.element("wordNetLearningNote");
  note.flatQueryScope = false;
  const summary = browser.document.createElement("summary");
  note.append(summary);
  browser.registry.element("wordNetLearning").append(note);
  const reconstruction = browser.registry.element("wordNetReconstruction");
  root.append(reconstruction);
  for (const id of ["wordNetReconstructionBank", "wordNetReconstructionAnswer", "wordNetReconstructionSubmit"]) {
    const node = browser.registry.element(id); node.flatQueryScope = false; reconstruction.append(node);
  }
  for (const attributes of markup.matchAll(/<button\b([^>]*\bdata-(?:generation-mode|challenge-prompt-mode)="[^"]+"[^>]*)>/gu)) {
    const button = browser.document.createElement("button");
    for (const attribute of attributes[1].matchAll(/([:\w-]+)(?:="([^"]*)")?/gu)) {
      button.setAttribute(attribute[1], attribute[2] ?? "");
    }
    menu.append(button);
  }
  browser.document.createDocumentFragment = () => browser.registry.create("fragment");
  browser.document.createTextNode = text => {
    const node = browser.registry.create("text"); node.nodeType = 3; node.textContent = text; return node;
  };
  let timer = 0;
  const timers = new Map();
  const schedule = callback => { const id = ++timer; timers.set(id, callback);
    queueMicrotask(() => { if (timers.delete(id)) callback(); }); return id; };
  browser.window.setTimeout = schedule;
  browser.window.clearTimeout = id => timers.delete(id);
  browser.window.parent = browser.window;
  browser.window.scrollTo = () => {};
  browser.window.navigator.locks = { request: async (_name, callback) => callback() };
  Object.assign(browser.context, core, teaching, progression, contentProgression, {
    tokenizeLegacySentence: core.tokenizeCzechSentence, WordNetBranchQueue, renderTargetText, createTargetReadingGuide,
    performance: { now: () => 0 }, queueMicrotask,
    bindHorizontalGesture: () => ({ cancel() {}, destroy() {} }),
    localAiAvailability: () => ({ enabled: false }),
    createEnglishImageSearch: () => async () => ({ results: [] }),
    mountRobotLoadingScreen: () => ({ setActive() {}, show() {}, hide() {}, destroy() {}, minimumVisible: async () => {} }),
    CaatuuI18n: { t: (id, parameters = {}) => `${id} ${Object.values(parameters).join(" ")}`.trim(),
      languageName: language => language.label }
  });
  vm.runInContext(profile, browser.context);
  const learning = browser.window.CaatuuLearning;
  learning.setDifficulty(difficulty);
  vm.runInContext(executable, browser.context, { filename: "product-word-world.mjs" });
  const context = preparedContext(course, adapter, recordsFixture(czech));
  browser.context.__prepared = context;
  browser.context.__root = root;
  const controller = await vm.runInContext("mountProductWordWorld(__root, __prepared)", browser.context);
  const run = expression => vm.runInContext(expression, browser.context);
  const state = run("state");
  const node = id => browser.registry.element(id);
  const generation = mode => browser.document.querySelector(`[data-generation-mode="${mode}"]`);
  async function settle() {
    for (let attempts = 0; attempts < 80; attempts += 1) {
      await Promise.resolve();
      if (!state.busy) return;
    }
    assert.fail("the actual renderer did not settle");
  }
  async function submitCorrect() {
    const round = run("ensureReconstructionChallenge()");
    for (const token of round.challenge.answerTokens) {
      const button = node("wordNetReconstructionBank").querySelectorAll("[data-reconstruction-option-id]")
        .find(button => button.textContent === token && !button.disabled);
      assert.ok(button, `${token} is selectable`); button.click();
      for (let attempts = 0; attempts < 12; attempts += 1) {
        await Promise.resolve();
        if (!node("wordNetReconstruction").classList.contains("is-transferring")) break;
      }
    }
    node("wordNetReconstructionSubmit").click();
    await settle();
    assert.equal(round.correct, true, `Selected ${JSON.stringify(round.selectedIds)} for ${JSON.stringify(round.challenge.answerTokens)}`);
    return round;
  }
  t.after(() => { controller.pause(); timers.clear(); });
  return { ...browser, course, prepared: context, controller, learning, state, node, run, generation, settle, submitCorrect,
    setDifficulty(value) { learning.setDifficulty(value); } };
}

function assertDictionaryHidden(g) {
  const card = g.node("wordNetWordTranslation");
  assert.equal(card.hidden, true);
  assert.equal(card.getAttribute("aria-hidden"), "true");
  for (const id of ["wordNetSelectedWord", "wordNetSelectedMeaning", "wordNetSelectedPos", "wordNetSelectedMeta"]) {
    assert.equal(g.node(id).textContent, "", `${id} must not disclose a hidden answer`);
  }
}

for (const czech of [false, true]) {
  const namespace = `caatuu-${czech ? "cz" : "annotated-test"}`;
  const cardKey = `${namespace}.wordNet.wordCardPreferences.v1`;
  const promptKey = `${namespace}.wordNet.challengePromptMode.v1`;

  test(`${czech ? "Czech" : "Mandarin"} learner-base prompts keep dictionary answers hidden through lookup, preference changes, and submission`, async t => {
    const g = await game(t, { czech, saved: {
      [cardKey]: JSON.stringify({ showCard: true, showMeta: true }), [promptKey]: "source"
    } });
    await g.settle();
    assert.equal(g.state.reconstruction.promptSide, "source");
    assertDictionaryHidden(g);
    assert.equal(g.state.contentEncounterSupported, false, "a hidden dictionary must not mark recall as assisted");

    let finishLookup;
    g.state.wordMeaningCache.clear();
    g.prepared.lookupMeaning = () => new Promise(resolve => { finishLookup = resolve; });
    const lookup = g.run("lookupSelectedWord(state.selectedWord)");
    assert.equal(g.state.wordMeaningLoading, true);
    assertDictionaryHidden(g);
    finishLookup({ meaning: "the selected target word", partOfSpeech: "pronoun", languageTag: "en" });
    await lookup;
    assert.equal(g.state.selectedWordMeaning, "the selected target word");
    assertDictionaryHidden(g);

    g.run('toggleWordCardPreference("showCard")');
    g.run('toggleWordCardPreference("showCard")');
    assert.equal(g.state.wordCardPreferences.showCard, true);
    assert.equal(JSON.parse(g.localStorage.getItem(cardKey)).showCard, true);
    assertDictionaryHidden(g);
    await g.submitCorrect();
    assert.equal(g.state.reconstruction.submitted, true);
    assertDictionaryHidden(g);
  });

  test(`${czech ? "Czech" : "Mandarin"} dictionary visibility follows the displayed prompt while preserving the learner preference`, async t => {
    const g = await game(t, { czech, saved: {
      [cardKey]: JSON.stringify({ showCard: true, showMeta: false }), [promptKey]: "target"
    } });
    await g.settle();
    await g.run("lookupSelectedWord(state.selectedWord)");
    assert.equal(g.state.reconstruction.promptSide, "target");
    assert.equal(g.node("wordNetWordTranslation").hidden, false);
    assert.equal(g.node("wordNetWordTranslation").getAttribute("aria-hidden"), "false");
    assert.ok(g.node("wordNetSelectedWord").textContent.includes(g.state.selectedWord));
    assert.ok(g.node("wordNetSelectedMeaning").textContent);

    await g.submitCorrect();
    g.run('setChallengePromptMode("source")');
    await g.controller.next(); await g.settle();
    assert.equal(g.state.reconstruction.promptSide, "source");
    assertDictionaryHidden(g);

    g.run('setTranslationMode("visible")');
    assert.equal(g.node("wordNetWordTranslation").hidden, false, "ordinary reading mode retains dictionary support");
    assert.ok(g.node("wordNetSelectedWord").textContent.includes(g.state.selectedWord));
    g.run('setTranslationMode("reconstruct")');
    assertDictionaryHidden(g);

    await g.submitCorrect();
    g.run('setChallengePromptMode("target")');
    await g.controller.next(); await g.settle();
    assert.equal(g.state.reconstruction.promptSide, "target");
    assert.equal(g.node("wordNetWordTranslation").hidden, false);
    assert.equal(g.state.wordCardPreferences.showCard, true);
    assert.equal(JSON.parse(g.localStorage.getItem(cardKey)).showCard, true);
  });
}

test("annotated courses offer a foundation default while preserving saved practice and prompt settings", async t => {
  const fresh = await game(t);
  assert.equal(fresh.state.generationMode, "foundation");
  assert.equal(fresh.state.currentEntryId, "ww.test.identity-first");
  assert.equal(fresh.generation("foundation").hidden, false);
  assert.equal(fresh.generation("patterns").hidden, false);
  assert.equal(fresh.node("wordNetLearningNote").open, false);
  assert.equal(fresh.node("wordNetLearningExplanation").textContent, "Teaching explanation for identity-first.");
  const saved = await game(t, { saved: {
    "caatuu-annotated-test.wordNet.generationMode": "random",
    "caatuu-annotated-test.wordNet.challengePromptMode.v1": "target"
  } });
  assert.equal(saved.state.generationMode, "random");
  assert.equal(saved.state.challengePromptMode, "target");
  assert.equal(saved.run("ensureReconstructionChallenge().answerSide"), "source");
});

test("foundation advances in authored order and respects the selected difficulty", async t => {
  const g = await game(t);
  await g.submitCorrect();
  await g.controller.next(); await g.settle();
  assert.equal(g.state.currentEntryId, "ww.test.identity-second");
  g.setDifficulty(2);
  await g.settle();
  assert.equal(g.state.currentEntryId, "ww.test.advanced-first");
  assert.equal(g.state.currentDifficulty, 2);
  assert.deepEqual(g.node("wordNetLearningUnitOptions").querySelectorAll("[data-learning-unit]")
    .map(button => button.dataset.learningUnit), ["foundation.advanced"]);
});

test("unit menu selection starts pattern practice and retains its unit without crossing difficulty", async t => {
  const g = await game(t);
  await g.submitCorrect();
  const question = g.node("wordNetLearningUnitOptions").querySelector('[data-learning-unit="foundation.questions"]');
  assert.ok(question); question.click(); await g.settle();
  assert.equal(g.state.generationMode, "patterns");
  assert.match(g.state.currentEntryId, /question-/u);
  assert.equal(g.localStorage.getItem("caatuu-annotated-test.wordNet.learningUnit.v1"), "foundation.questions");
  await g.submitCorrect();
  await g.controller.next(); await g.settle();
  assert.match(g.state.currentEntryId, /question-/u);
  assert.equal(g.state.currentDifficulty, 1);
});

test("pattern-note clicks mark support before deferred toggle and preserve assisted recall after collapse", async t => {
  const g = await game(t, { saved: { "caatuu-annotated-test.wordNet.challengePromptMode.v1": "source" } });
  const note = g.node("wordNetLearningNote");
  assert.equal(g.state.contentEncounterSupported, false);
  note.querySelector("summary").click();
  assert.equal(note.open, false, "the browser toggle event has not arrived yet");
  assert.equal(g.state.contentEncounterSupported, true, "support is marked synchronously before an answer can be submitted");
  note.open = true; note.dispatchEvent({ type: "toggle" });
  assert.equal(g.state.contentEncounterSupported, true);
  note.open = false; note.dispatchEvent({ type: "toggle" });
  await g.submitCorrect();
  const result = g.learning.contentHistory("word-world", "reconstruct-target")["ww.test.identity-first"];
  assert.equal(result.assistedSuccesses, 1);
  assert.equal(result.independentSuccesses, 0);
  assert.equal(result.spacedSuccesses, 0);
});

test("viewing a pattern note after submission does not rewrite the scored recall evidence", async t => {
  const g = await game(t, { saved: { "caatuu-annotated-test.wordNet.challengePromptMode.v1": "source" } });
  await g.submitCorrect();
  const before = g.learning.contentHistory("word-world", "reconstruct-target")["ww.test.identity-first"];
  assert.equal(before.independentSuccesses, 1);
  const note = g.node("wordNetLearningNote");
  note.querySelector("summary").click();
  note.open = true; note.dispatchEvent({ type: "toggle" });
  assert.equal(g.state.contentEncounterSupported, false);
  assert.deepEqual(g.learning.contentHistory("word-world", "reconstruct-target")["ww.test.identity-first"], before);
});

test("legacy Czech learning metadata is preserved without activating authored teaching controls", async t => {
  const g = await game(t, { czech: true });
  assert.equal(g.state.generationMode, "random");
  assert.equal(g.generation("foundation").hidden, true);
  assert.equal(g.generation("patterns").hidden, true);
  assert.equal(g.node("wordNetLearningUnits").hidden, true);
  assert.equal(g.node("wordNetLearning").hidden, true);
  assert.equal(g.node("wordNetLearningUnitOptions").children.length, 0);
  assert.equal(g.state.currentSentence, "Mám knihu.");
  assert.deepEqual(g.state.currentStandardRecord.learning, recordsFixture(true)[0].learning);
  assert.equal(g.state.currentStandardRecord.teaching ?? null, null);
  await g.submitCorrect();
});
