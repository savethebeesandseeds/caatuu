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
import { afterInteractionPaint } from "../static/source/games/practice-pacing.mjs";

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

async function game(t, { czech = false, saved = {}, difficulty = 1, records = recordsFixture(czech), dictionaryReporting = false, generationEnabled = false } = {}) {
  const course = courseFixture(czech);
  course.capabilities.generation = generationEnabled;
  course.capabilities.llm = generationEnabled;
  if (dictionaryReporting) {
    course.capabilities.dictionary = true;
    course.dictionaryContent = { providerId: "fixture-dictionary-v1", gapReporting: {
      providerId: "fixture-dictionary-v1", dictionaryKey: "fixture-zh-en-v1", dictionaryDirection: "zh-en"
    } };
  }
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
    tokenizeLegacySentence: core.tokenizeCzechSentence, WordNetBranchQueue, renderTargetText, createTargetReadingGuide, afterInteractionPaint,
    performance: { now: () => 0 }, queueMicrotask,
    bindHorizontalGesture: () => ({ cancel() {}, destroy() {} }),
    localAiAvailability: () => ({ supported: generationEnabled, enabled: generationEnabled }),
    createEnglishImageSearch: () => async () => ({ results: [] }),
    mountRobotLoadingScreen: () => ({ setActive() {}, show() {}, hide() {}, destroy() {}, minimumVisible: async () => {} }),
    CaatuuI18n: { t: (id, parameters = {}) => `${id} ${Object.values(parameters).join(" ")}`.trim(),
      languageName: language => language.label }
  });
  vm.runInContext(profile, browser.context);
  const learning = browser.window.CaatuuLearning;
  learning.setDifficulty(difficulty);
  vm.runInContext(executable, browser.context, { filename: "product-word-world.mjs" });
  const context = preparedContext(course, adapter, records);
  if (generationEnabled) context.generationStrategy = { id: 'fixture-word-world-v1' };
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

test("level-zero single words are real two-option recognition with an exact-band contrast", async t => {
  const records = [
    ['book', 'kniha', 'Book'], ['water', 'voda', 'Water'], ['advanced', 'neznámý', 'Unfamiliar']
  ].map(([id, target, englishText], index) => ({
    conceptId: `ww.test.${id}`, englishText, sceneQuery: englishText,
    difficulty: index === 2 ? 1 : 0, topic: 'objects',
    target: { text: target, tokens: [{ surface: target, gloss: englishText, playable: true }] }
  }));
  const g = await game(t, { czech: true, difficulty: 0, records, saved: {
    'caatuu-cz.wordNet.challengePromptMode.v1': 'target'
  } });
  await g.settle();
  const round = g.run('ensureReconstructionChallenge()');
  assert.equal(g.state.currentDifficulty, 0);
  assert.equal(round.promptSide, 'source', 'a familiar-language prompt introduces target recognition');
  assert.equal(round.challenge.answerTokens.length, 1);
  assert.equal(round.challenge.options.length, 2);
  assert.deepEqual(new Set(round.challenge.options.map(option => option.text)), new Set(['kniha', 'voda']));
  assert.equal(round.submitted, false, 'a one-word answer still requires the learner to choose and submit');
  await g.submitCorrect();
  assert.equal(g.state.reconstruction.correct, true);
  assert.equal(g.learning.difficulty(), 0);
});

test("zero Word World confines a saved generative preference to the authored bank without erasing it", async t => {
  const records = [
    ['book', 'kniha', 'Book', 0], ['water', 'voda', 'Water', 0], ['cat', 'kočka', 'Cat', 1]
  ].map(([id, target, englishText, difficulty]) => ({
    conceptId: `ww.test.${id}`, englishText, sceneQuery: englishText, difficulty, topic: 'objects',
    target: { text: target, tokens: [{ surface: target, gloss: englishText, playable: true }] }
  }));
  const key = 'caatuu-cz.wordNet.contentMode.v1';
  const g = await game(t, { czech: true, records, difficulty: 0, generationEnabled: true,
    saved: { [key]: 'generative' } });
  await g.settle();
  assert.equal(g.state.contentMode, 'standard');
  assert.equal(g.state.currentDifficulty, 0);
  assert.equal(g.run('supportsContentMode("generative")'), false);
  await g.run('setContentMode("generative")');
  assert.equal(g.state.contentMode, 'standard');
  assert.equal(g.localStorage.getItem(key), 'generative');
  g.setDifficulty(1);
  await g.settle();
  assert.equal(g.run('supportsContentMode("generative")'), true);
  assert.equal(g.localStorage.getItem(key), 'generative');
});

test("annotated courses default to full-course practice while keeping focused modes available", async t => {
  const fresh = await game(t);
  assert.equal(fresh.state.generationMode, "random");
  assert.equal(fresh.generation("foundation").hidden, false);
  assert.equal(fresh.generation("patterns").hidden, false);
  assert.equal(fresh.node("wordNetLearningNote").open, false);
});

test("default play continues beyond a small foundation subset at the selected difficulty", async t => {
  // Reproduce a course with only a handful of annotated intermediate phrases.
  // Derive identities and text from a fixture so live catalog counts may change.
  const records = Array.from({ length: 36 }, (_, index) => {
    const record = structuredClone(recordsFixture()[4]);
    record.conceptId = `ww.test.intermediate-${index}`;
    record.englishText = `This is sentence ${index}.`;
    record.target.text = `这是第${index}句。`;
    record.target.tokens = [{ surface: record.target.text, gloss: record.englishText, playable: true }];
    if (index < 7) record.target.learning.order = index + 1;
    else delete record.target.learning;
    return record;
  });
  records.push(recordsFixture()[0]);
  const g = await game(t, { difficulty: 2, records });
  g.run('setTranslationMode("visible")');
  const visited = new Set();
  for (let turn = 0; turn < 40; turn += 1) {
    visited.add(g.state.currentEntryId);
    assert.equal(g.state.currentDifficulty, 2);
    await g.controller.next(); await g.settle();
  }
  assert.ok(visited.size > 12, `continued practice reached only ${visited.size} phrases`);
  assert.ok(records.some(record => visited.has(record.conceptId) && !record.target.learning));
  assert.equal(g.localStorage.getItem("caatuu-annotated-test.wordNet.generationMode"), null,
    "ordinary play does not save a focused-mode preference");
});

test("saved practice and prompt settings remain explicit choices", async t => {
  const saved = await game(t, { saved: {
    "caatuu-annotated-test.wordNet.generationMode": "random",
    "caatuu-annotated-test.wordNet.challengePromptMode.v1": "target"
  } });
  assert.equal(saved.state.generationMode, "random");
  assert.equal(saved.state.challengePromptMode, "target");
  assert.equal(saved.run("ensureReconstructionChallenge().answerSide"), "source");
  const foundation = await game(t, { saved: {
    "caatuu-annotated-test.wordNet.generationMode": "foundation"
  } });
  assert.equal(foundation.state.generationMode, "foundation");
  assert.equal(foundation.state.currentEntryId, "ww.test.identity-first");
  assert.equal(foundation.node("wordNetLearningExplanation").textContent, "Teaching explanation for identity-first.");
});

test("controller record IDs retain a valid scheduled English semantic match", async t => {
  const g = await game(t, { saved: { "caatuu-annotated-test.wordNet.generationMode": "foundation" } });
  const provider = g.state.standardProvider;
  assert.equal(provider.getRecordById("ww.test.identity-first").id, "ww.test.identity-first");
  assert.equal(provider.getRecordById({ conceptId: "ww.test.identity-first" }).id, "ww.test.identity-first");
  for (const id of [null, undefined, [], 1, "missing"]) assert.equal(provider.getRecordById(id), null);
  const selection = await g.run(`selectStandardTurn(state.standardProvider, {
    generationMode: "selected", selectedWord: state.selectedWord, difficulty: 1,
    englishQuery: "student", searchKey: providerContext.normalization.searchKey,
    searchEnglish: async () => ({ mode: "embedding", records: [{ conceptId: state.currentEntryId }] })
  })`);
  assert.equal(selection.record.id, "ww.test.identity-first");
  assert.equal(selection.semanticMode, "embedding");
});

test("English-base contextual meanings stay scoped to their phrase and clear resolved dictionary notices", async t => {
  const records = recordsFixture().slice(0, 2);
  for (const [index, record] of records.entries()) {
    record.target.tokens[0].surface = "在";
    record.target.tokens[0].gloss = index ? "be located" : "ongoing action marker";
    record.target.text = `${record.target.tokens.map(token => token.surface).join("")}。`;
  }
  const g = await game(t, { records, dictionaryReporting: true, saved: {
    "caatuu-annotated-test.wordNet.generationMode": "foundation"
  } });
  g.prepared.lookupMeaning = async ({ token }) => ({ meaning: token.gloss });
  g.state.wordMeaningCache.clear();
  g.run('setTranslationMode("visible")');
  await g.run("lookupSelectedWord(state.selectedWord)");
  assert.equal(g.state.selectedWordMeaning, "ongoing action marker");
  g.run('rememberDictionaryGap("在")');
  await g.controller.next(); await g.settle();
  await g.run("lookupSelectedWord(state.selectedWord)");
  assert.equal(g.state.selectedWordMeaning, "be located");
  assert.equal(g.state.dictionaryGapKeys.includes("在"), false);
  assert.equal(g.state.selectedWordGapNotice, "");
  g.run('rememberDictionaryGap("在")');
  await g.run("showPreviousSentence()"); await g.settle();
  assert.equal(g.state.selectedWordMeaning, "ongoing action marker");
  assert.equal(g.state.dictionaryGapKeys.includes("在"), false, "cached valid meanings also resolve the word-level notice");
});

test("repeated surfaces keep their authored meaning at each token position", async t => {
  const records = recordsFixture().slice(0, 1);
  records[0].target.text = "在在。";
  records[0].target.tokens = ["first usage", "second usage"].map(gloss => ({ surface: "在", gloss, playable: true }));
  const g = await game(t, { records, saved: { "caatuu-annotated-test.wordNet.generationMode": "foundation" } });
  g.prepared.lookupMeaning = async ({ token }) => ({ meaning: token.gloss });
  g.state.wordMeaningCache.clear();
  g.run('setTranslationMode("visible")');
  for (const [tokenIndex, expected] of [[0, "first usage"], [1, "second usage"], [0, "first usage"]]) {
    g.context.__tokenIndex = tokenIndex;
    g.run('selectWord("在", { tokenIndex: __tokenIndex, lookup: false })');
    await g.run('lookupSelectedWord("在")');
    assert.equal(g.state.selectedWordMeaning, expected);
  }
});

test("foundation advances in authored order and respects the selected difficulty", async t => {
  const g = await game(t, { saved: { "caatuu-annotated-test.wordNet.generationMode": "foundation" } });
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

test("Previous restores the matching teaching note without carrying open support into a new visit", async t => {
  const g = await game(t, { saved: {
    "caatuu-annotated-test.wordNet.generationMode": "foundation",
    "caatuu-annotated-test.wordNet.challengePromptMode.v1": "source"
  } });
  await g.submitCorrect();
  await g.controller.next(); await g.settle();
  await g.submitCorrect();
  const note = g.node("wordNetLearningNote");
  note.open = true;
  await g.run("showPreviousSentence()"); await g.settle();
  assert.equal(g.state.currentEntryId, "ww.test.identity-first");
  assert.equal(g.node("wordNetLearningExplanation").textContent, "Teaching explanation for identity-first.");
  assert.equal(note.open, false);
  assert.equal(g.state.contentEncounterSupported, false);
  note.querySelector("summary").click();
  assert.equal(g.state.contentEncounterSupported, true);
  await g.submitCorrect();
  const progress = g.learning.contentHistory("word-world", "reconstruct-target")["ww.test.identity-first"];
  assert.equal(progress.assistedSuccesses, 1);
  assert.equal(progress.independentSuccesses, 1);
});

test("Previous shows or hides teaching notes for the restored record", async t => {
  const g = await game(t, { saved: { "caatuu-annotated-test.wordNet.generationMode": "foundation" } });
  g.run('setTranslationMode("visible")');
  for (const id of ["ww.test.unannotated", "ww.test.identity-second"]) {
    g.context.__selection = { record: g.state.standardProvider.getRecordById(id) };
    await g.run("showStandardPhrase(__selection)"); await g.settle();
  }
  assert.equal(g.node("wordNetLearning").hidden, false);
  await g.run("showPreviousSentence()"); await g.settle();
  assert.equal(g.state.currentEntryId, "ww.test.unannotated");
  assert.equal(g.node("wordNetLearning").hidden, true);
  await g.run("showPreviousSentence()"); await g.settle();
  assert.equal(g.state.currentEntryId, "ww.test.identity-first");
  assert.equal(g.node("wordNetLearning").hidden, false);
  assert.equal(g.node("wordNetLearningExplanation").textContent, "Teaching explanation for identity-first.");
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
  const g = await game(t, { saved: {
    "caatuu-annotated-test.wordNet.generationMode": "foundation",
    "caatuu-annotated-test.wordNet.challengePromptMode.v1": "source"
  } });
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
  const g = await game(t, { saved: {
    "caatuu-annotated-test.wordNet.generationMode": "foundation",
    "caatuu-annotated-test.wordNet.challengePromptMode.v1": "source"
  } });
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

test("rapid Word World selections and submission never wait for card flight animations", async t => {
  const g = await game(t, { czech: true, saved: {
    'caatuu-cz.wordNet.challengePromptMode.v1': 'source'
  } });
  await g.settle();
  const animations = [];
  const createElement = g.document.createElement.bind(g.document);
  g.document.createElement = tag => {
    const node = createElement(tag);
    node.getBoundingClientRect = () => ({ left: 30, top: 60, width: 90, height: 44 });
    node.animate = () => {
      const animation = { finished: new Promise(() => {}), cancel() {} };
      animations.push(animation);
      return animation;
    };
    return node;
  };
  const round = g.state.reconstruction;
  for (const token of round.challenge.answerTokens) {
    const button = g.node('wordNetReconstructionBank').querySelectorAll('[data-reconstruction-option-id]')
      .find(node => node.textContent === token && !node.disabled);
    button.getBoundingClientRect = () => ({ left: 10, top: 180, width: 90, height: 44 });
    button.click();
  }
  assert.equal(round.selectedIds.length, round.challenge.answerTokens.length);
  assert.equal(animations.length, round.selectedIds.length, 'every flight remains unfinished');
  const removed = g.node('wordNetReconstructionAnswer').querySelector('[data-reconstruction-option-id]');
  const removedId = removed.dataset.reconstructionOptionId;
  removed.click();
  assert.equal(round.selectedIds.includes(removedId), false, 'an animating card can be removed immediately');
  g.run(`selectReconstructionOption(${JSON.stringify(removedId)})`);
  // Re-adding the first word places it last; grade the resulting attempt without
  // waiting for any decorative animation, regardless of whether it is correct.
  g.node('wordNetReconstructionSubmit').click();
  await g.settle();
  assert.equal(round.submitted, true);
});

function connectedPrompt(g) {
  const host = g.node("wordNetSentence");
  host.flatQueryScope = false;
  g.document.body.append(host);
  return host;
}

test("rapid dictionary word taps retain connected prompt controls and contextual meanings while lookup is pending", async t => {
  const records = recordsFixture().slice(0, 1);
  records[0].target.text = "在在。";
  records[0].target.tokens = ["first usage", "second usage"].map(gloss => ({ surface: "在", gloss, playable: true }));
  const g = await game(t, { records, saved: { "caatuu-annotated-test.wordNet.generationMode": "foundation" } });
  g.run('setTranslationMode("visible")');
  const host = connectedPrompt(g);
  const buttons = host.querySelectorAll(".cz-word-token");
  assert.equal(buttons.length, 2);
  g.state.wordMeaningCache.clear();
  const lookups = [];
  g.prepared.lookupMeaning = ({ token }) => new Promise(resolve => lookups.push({ token, resolve }));
  for (const tokenIndex of [1, 0, 1]) {
    buttons[tokenIndex].click();
    assert.equal(g.state.selectedTokenIndex, tokenIndex);
    assert.equal(g.state.wordMeaningLoading, true);
    assert.deepEqual(host.querySelectorAll(".cz-word-token"), buttons, "word selection never rebuilds the prompt");
    for (const [index, button] of buttons.entries()) {
      assert.equal(button.isConnected, true);
      assert.equal(button.classList.contains("is-selected"), index === tokenIndex);
      assert.equal(button.getAttribute("aria-pressed"), String(index === tokenIndex));
    }
  }
  lookups.at(-1).resolve({ meaning: lookups.at(-1).token.gloss });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(g.state.selectedWordMeaning, "second usage");
  for (const lookup of lookups.slice(0, -1)) lookup.resolve({ meaning: lookup.token.gloss });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(g.state.selectedWordMeaning, "second usage", "late lookups never overwrite the latest token's meaning");
});

test("dictionary selection preserves rendered reading guides and settings still rebuild their presentation", async t => {
  const g = await game(t, { saved: { "caatuu-annotated-test.wordNet.generationMode": "foundation" } });
  g.run('setTranslationMode("visible")');
  g.prepared.targetTextGuide = { languageTag: "zh-Latn-pinyin",
    labels: { section: "Reading", showGuide: "Show pinyin", colorTones: "Color tones" } };
  g.prepared.targetTextUnits = ({ token }) => [{ surface: token.surface, notation: "wǒ", tone: 3 }];
  g.run("renderCzechSentence(state.currentSentence, state.selectedWord)");
  const host = connectedPrompt(g);
  const original = host.querySelectorAll(".cz-word-token");
  const guide = original[0].querySelector("rt");
  assert.ok(guide);
  original[0].click();
  assert.equal(host.querySelectorAll(".cz-word-token")[0], original[0]);
  assert.equal(original[0].querySelector("rt"), guide, "a tap retains the rendered pinyin");
  g.run('toggleTargetTextPreference("showGuide")');
  const updated = host.querySelectorAll(".cz-word-token");
  assert.notEqual(updated[0], original[0], "presentation settings still regenerate the words");
  assert.equal(updated[0].querySelector("rt"), null);
  updated[1].click();
  assert.equal(host.querySelectorAll(".cz-word-token")[1], updated[1]);
  assert.equal(updated[1].getAttribute("aria-pressed"), "true");
});

function installInteractionSpeechClock(g) {
  const frames = new Map(), tasks = new Map(), calls = [], stops = [];
  let id = 0;
  g.window.requestAnimationFrame = callback => { frames.set(++id, callback); return id; };
  g.window.cancelAnimationFrame = key => frames.delete(key);
  g.window.setTimeout = callback => { tasks.set(++id, callback); return id; };
  g.window.clearTimeout = key => tasks.delete(key);
  g.course.capabilities.speech = true;
  g.state.audioAutoplay = false;
  g.window.speechSynthesis = { speak() { assert.fail("shared speech should be used"); }, cancel() {} };
  g.window.SpeechSynthesisUtterance = function () {};
  g.window.CaatuuChrome = {
    getSpeechMuted: () => false,
    speakText(text) { calls.push(text); return new Promise(() => {}); },
    stopSpeech() { stops.push(true); return new Promise(() => {}); }
  };
  const flush = queue => { const pending = [...queue.values()]; queue.clear(); pending.forEach(callback => callback()); };
  return { calls, stops, paint: () => flush(frames), audio: () => flush(tasks),
    flush() { flush(frames); flush(tasks); } };
}

test("dictionary tap highlights paint before optional speech and remain responsive to a stuck speech service", async t => {
  const g = await game(t, { czech: true });
  g.run('setTranslationMode("visible")');
  const host = connectedPrompt(g);
  const buttons = host.querySelectorAll(".cz-word-token");
  const clock = installInteractionSpeechClock(g);
  buttons[0].click(); buttons[1].click();
  assert.equal(buttons[1].getAttribute("aria-pressed"), "true");
  assert.deepEqual(clock.calls, []);
  clock.paint();
  assert.deepEqual(clock.calls, [], "audio does not run inside the animation frame");
  clock.audio();
  assert.deepEqual(clock.calls, [buttons[1].dataset.word], "only the latest pre-paint tap is pronounced");
  buttons[0].click();
  assert.equal(buttons[0].getAttribute("aria-pressed"), "true");
  assert.equal(clock.stops.length, 1);
  assert.equal(clock.calls.length, 1);
  clock.flush();
  assert.deepEqual(clock.calls, [buttons[1].dataset.word, buttons[0].dataset.word]);
  assert.deepEqual(host.querySelectorAll(".cz-word-token"), buttons);
});

for (const retired of ["pause-and-resume", "new-phrase", "programmatic-selection", "disabled-pronunciation", "translation-off"]) {
  test(`queued dictionary pronunciation is discarded after ${retired}`, async t => {
    const g = await game(t, { czech: true });
    g.run('setTranslationMode("visible")');
    const host = connectedPrompt(g);
    const clock = installInteractionSpeechClock(g);
    host.querySelectorAll(".cz-word-token")[1].click();
    if (retired === "pause-and-resume") { g.controller.pause(); g.controller.resume(); }
    if (retired === "new-phrase") g.state.phraseRequestId += 1;
    if (retired === "programmatic-selection") g.run('selectWord("Mám", { lookup: false })');
    if (retired === "disabled-pronunciation") g.state.wordCardPreferences.autoPronounce = false;
    if (retired === "translation-off") g.run('setTranslationMode("off")');
    clock.flush();
    assert.deepEqual(clock.calls, []);
  });
}
