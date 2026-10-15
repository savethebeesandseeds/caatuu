import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

import { segmentLanguageText } from "../contract.mjs";
import { joinConceptCatalogs, validateTargetRealizationCatalog } from "../static/source/catalog-runtime.mjs";
import { buildTokenReconstructionChallenge, isWordReconstructionCorrect } from "../static/source/word-net-core.mjs";
import { importBrowserLanguageAdapter } from "./browser-module-loader.mjs";
import { buildWordWorldRuntimeProjections, WORD_WORLD_PATHS } from "../../../tools/language-content/project-word-world-runtime.mjs";
import { validateLanguageContent } from "../../../tools/language-content/lib/content-contract.mjs";
import { validateTargetRealizationRuntimeProjection } from "../../../tools/language-content/lib/runtime-projection-contract.mjs";
import { modernCatalogs, validateWordWorldContent } from "../../../tools/language-content/lib/word-world-course-content.mjs";

const repo = new URL("../../../", import.meta.url);
const json = async (relative) => JSON.parse(await readFile(new URL(relative, repo), "utf8"));
const [concepts, realizations, manifest, adapter, rendererSource] = await Promise.all([
  json(WORD_WORLD_PATHS.conceptsSource), json(WORD_WORLD_PATHS.realizationsSource), json(WORD_WORLD_PATHS.manifest),
  importBrowserLanguageAdapter("../../languages/mandarin-simplified/static/source/language/adapter.mjs"),
  readFile(new URL("../static/source/product-word-world.mjs", import.meta.url), "utf8")
]);
const alternate = ["今天", "博物馆", "开放"];
const museumId = "ww.culture.museum-open";

function authorFixture() {
  const targets = structuredClone(realizations);
  const target = targets.realizations.find(({ conceptId }) => conceptId === museumId);
  target.acceptedTokenOrders = [alternate.slice()];
  target.learning = {
    unitId: "foundation.time", order: 1, title: "Talking about today",
    explanation: "Place 今天 before or after the subject.", focus: ["time-position"]
  };
  return targets;
}

function functionSource(name) {
  let start = rendererSource.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} exists`);
  if (rendererSource.slice(start - 6, start) === "async ") start -= 6;
  return rendererSource.slice(start, rendererSource.indexOf("\n}", start) + 2);
}

function renderFixture(record, { guided = false } = {}) {
  const events = [];
  const evidence = [];
  const lifecycle = guided ? {
    state: () => ({ taskFingerprint: "immutable-museum", firstResponseRecorded: false }),
    markSolutionRevealed() { evidence.push({ revealed: true }); },
    async recordFirstResponse(event) {
      evidence.push(event);
      return { result: { qualifiesForIndependentAssessment: event.score === 1 } };
    }
  } : null;
  const state = {
    currentEntryId: record.conceptId, currentSentence: record.target.text,
    currentTranslation: record.englishText, phraseRequestId: 42, guidedLifecycle: lifecycle
  };
  let round;
  const context = vm.createContext({
    state, targetLocale: "zh-CN", RECONSTRUCTION_DISTRACTOR_COUNT: 2,
    providerContext: { segment: (value, options) => segmentLanguageText(adapter, value, options),
      normalization: adapter.normalization },
    preparedTargetRecord: () => record, targetReconstructionCandidateParts: () => [],
    buildTokenReconstructionChallenge, isWordReconstructionCorrect,
    ensureReconstructionChallenge: () => round, guidedWordInteractionLocked: () => false,
    $: () => null, interfaceText: (key) => key, renderReconstruction() {},
    stabilizeReconstructionResultViewport() {}, renderWordGuidedStatus() {},
    claimSentenceReward: () => true, announceCampaignRoundSuccess() {},
    completeWordWorldExposure: (correct) => events.push({ exposure: correct }),
    failGuidedWordWorld(error) { throw error; },
    window: { CaatuuLearning: { record: (_game, event) => events.push(event) }, requestAnimationFrame() {} }
  });
  vm.runInContext([
    "targetReconstructionParts", "reconstructionLayout", "inferReconstructionSeparator",
    "buildTargetReconstructionChallenge", "reconstructionSelectedOptions", "reconstructionSelectedText",
    "submitReconstructionChallenge"
  ].map(functionSource).join("\n"), context);
  round = {
    key: museumId, challenge: context.buildTargetReconstructionChallenge(), answerSide: "target",
    selectedIds: [], guidedLifecycle: lifecycle, guidedTaskFingerprint: "immutable-museum", phraseRequestId: 42
  };
  function select(tokens) {
    const remaining = round.challenge.options.slice();
    round.selectedIds = tokens.map((text) => {
      const index = remaining.findIndex((option) => option.text === text);
      assert.ok(index >= 0, `${text} is in the authored bank`);
      return remaining.splice(index, 1)[0].id;
    });
  }
  return { round, context, select, state, events, evidence };
}

test("authored alternate orders and teaching metadata survive validation, projection and the runtime join", () => {
  const targets = authorFixture();
  validateLanguageContent(structuredClone(concepts), targets);
  const projected = buildWordWorldRuntimeProjections(structuredClone(concepts), targets, structuredClone(manifest));
  validateTargetRealizationRuntimeProjection(projected.targetProjection, { source: targets });
  const record = joinConceptCatalogs(projected.englishProjection, projected.targetProjection)
    .find(({ conceptId }) => conceptId === museumId);
  assert.deepEqual(record.target.acceptedTokenOrders, [alternate]);
  assert.deepEqual(record.target.learning, targets.realizations.find(({ conceptId }) => conceptId === museumId).learning);
  assert.equal(Object.isFrozen(record.target.acceptedTokenOrders[0]), true);
  assert.equal(Object.isFrozen(record.target.learning.focus), true);
  const tampered = structuredClone(projected.targetProjection);
  tampered.realizations.find(({ conceptId }) => conceptId === museumId).learning.explanation = "Changed authority";
  assert.throws(() => validateTargetRealizationRuntimeProjection(tampered, { source: targets }), /learning differs from authoring/u);
});

test("the complete course authoring source validates and emits teaching fields through the production builder", async () => {
  const [document, course] = await Promise.all([
    json("apps/languages/mandarin-simplified/content/word-world/content.json"),
    json("apps/languages/mandarin-simplified/course.json")
  ]);
  const source = document.records.find(({ id }) => id === museumId);
  source.annotations = {
    acceptedTokenOrders: [alternate.slice()],
    learning: authorFixture().realizations.find(({ conceptId }) => conceptId === museumId).learning
  };
  validateWordWorldContent(document, course);
  const split = modernCatalogs(document, course);
  const projected = buildWordWorldRuntimeProjections(split.concepts, split.realizations, structuredClone(manifest));
  const record = joinConceptCatalogs(projected.englishProjection, projected.targetProjection)
    .find(({ conceptId }) => conceptId === museumId);
  assert.deepEqual(record.target.learning, source.annotations.learning);
  assert.deepEqual(record.target.acceptedTokenOrders, source.annotations.acceptedTokenOrders);
  assert.equal(isWordReconstructionCorrect(alternate, record.target.tokens.map(token => token.surface), record.target), true);
  for (const annotations of [
    { ...source.annotations, unsupported: true },
    { ...source.annotations, acceptedTokenOrders: [["今天", "博物馆", "<script>"]] },
    { ...source.annotations, learning: { ...source.annotations.learning, explanation: "<script>" } }
  ]) {
    const bad = structuredClone(document);
    bad.records.find(({ id }) => id === museumId).annotations = annotations;
    assert.throws(() => validateWordWorldContent(bad, course), /unsupported|acceptedTokenOrders|plain text/u);
  }
});

test("real Mandarin alternate time placement earns credit and preserves submitted text and ordinary scoring", async () => {
  const projected = buildWordWorldRuntimeProjections(structuredClone(concepts), authorFixture(), structuredClone(manifest));
  const record = joinConceptCatalogs(projected.englishProjection, projected.targetProjection)
    .find(({ conceptId }) => conceptId === museumId);
  const game = renderFixture(record);
  game.select(alternate);
  await game.context.submitReconstructionChallenge();
  assert.equal(game.round.correct, true);
  assert.equal(game.round.awardedXp, 3);
  assert.equal(game.round.submittedText, "今天博物馆开放。");
  assert.equal(game.events.find((event) => event.rounds).successes, 1);
  assert.deepEqual(Array.from(game.round.challenge.answerTokens), ["博物馆", "今天", "开放"]);
  const wrong = renderFixture(record);
  wrong.select(["开放", "今天", "博物馆"]);
  await wrong.context.submitReconstructionChallenge();
  assert.equal(wrong.round.correct, false);
  assert.equal(wrong.round.awardedXp, 0);
});

test("guided alternate orders preserve the immutable task and first-response evidence", async () => {
  const projected = buildWordWorldRuntimeProjections(structuredClone(concepts), authorFixture(), structuredClone(manifest));
  const record = joinConceptCatalogs(projected.englishProjection, projected.targetProjection)
    .find(({ conceptId }) => conceptId === museumId);
  const game = renderFixture(record, { guided: true });
  game.select(alternate);
  await game.context.submitReconstructionChallenge();
  assert.equal(game.round.correct, true);
  assert.equal(game.round.awardedXp, 0);
  assert.equal(game.evidence.length, 1);
  assert.equal(game.evidence[0].score, 1);
  assert.equal(game.state.guidedStatus, "complete");
});

test("unannotated target and source challenges retain exact order grading", async () => {
  const record = { conceptId: museumId, englishText: "The museum is open today.", target: {
    text: "博物馆今天开放。", tokens: authorFixture().realizations.find(({ conceptId }) => conceptId === museumId).tokens
  } };
  const game = renderFixture(record);
  game.select(alternate);
  await game.context.submitReconstructionChallenge();
  assert.equal(game.round.correct, false);
  assert.equal(isWordReconstructionCorrect(["today", "open", "museum"], ["museum", "open", "today"]), false);
  assert.equal(isWordReconstructionCorrect(["Museum", "open", "today"], ["museum", "open", "today"]), true);
});

test("authoring and browser catalogs reject malformed alternatives and teaching metadata", () => {
  for (const orders of [[], null, [["今天", "开放"]], [["今天", "博物馆", "<script>"]],
    [["博物馆", "今天", "开放"]], [alternate, alternate], [["今天 ", "博物馆", "开放"]],
    [[{ surface: "今天" }, "博物馆", "开放"]]]) {
    const targets = authorFixture();
    targets.realizations.find(({ conceptId }) => conceptId === museumId).acceptedTokenOrders = orders;
    assert.throws(() => validateLanguageContent(structuredClone(concepts), targets), /acceptedTokenOrders/u);
    assert.throws(() => validateTargetRealizationCatalog(targets), /acceptedTokenOrders/u);
  }
  for (const mutate of [
    (value) => { value.learning.order = 0; }, (value) => { value.learning.focus = ["same", "same"]; },
    (value) => { value.learning.explanation = " "; }, (value) => { value.learning.unknown = true; }
  ]) {
    const targets = authorFixture();
    mutate(targets.realizations.find(({ conceptId }) => conceptId === museumId));
    assert.throws(() => validateLanguageContent(structuredClone(concepts), targets), /learning/u);
    assert.throws(() => validateTargetRealizationCatalog(targets), /learning/u);
  }
});

test("alternate orders preserve repeated-token counts and cannot admit injected answer material", () => {
  const challenge = buildTokenReconstructionChallenge(["我", "也", "我"], [], { acceptedTokenOrders: [["我", "我", "也"]] });
  assert.equal(isWordReconstructionCorrect(["我", "我", "也"], challenge.answerTokens, challenge), true);
  assert.throws(() => buildTokenReconstructionChallenge(["我", "也", "我"], [], {
    acceptedTokenOrders: [["我", "也", "也"]]
  }), /occurrence counts/u);
  assert.equal(isWordReconstructionCorrect(["<script>"], ["我"], { acceptedTokenOrders: [["<script>"]] }), false);
});
