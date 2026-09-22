import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { sharedPracticeAxes, projectPracticeCompass, createPracticeCompass } from "../static/source/practice-compass.mjs";
import { createBrowserHarness } from "./helpers/fake-browser.mjs";
import { loadCourseCatalog, generateCourseProfileObject } from "../../../tools/language-packs/lib/course-contract.mjs";
import { extractCoreVerbPairs } from "../static/source/games/verb-nebula/verb-nebula-core.mjs";
import { validateConjugationCometCatalog } from "../static/source/games/conjugation-comet/conjugation-comet-core.mjs";
import { buildGrammarGravityRounds } from "../static/source/games/grammar-gravity/grammar-gravity-core.mjs";
import { buildRounds, buildQuestions } from "../../languages/czech/static/source/games/case-cosmos/case-cosmos-content.mjs";

const root = new URL("../../../", import.meta.url);
const json = async path => JSON.parse(await readFile(new URL(path, root), "utf8"));
const loaded = await loadCourseCatalog({ repoRoot: root });
const profileSource = await readFile(new URL("../static/source/learning-profile.js", import.meta.url), "utf8");
const iso = "2026-09-20T12:00:00.000Z";
const history = changes => ({ exposures: 1, successes: 0, mistakes: 0, firstSeenAt: iso, lastSeenAt: iso,
  lastCorrect: null, lastEvidence: "exposure", ...changes });
const independent = history({ independentSuccesses: 1, successes: 1, lastCorrect: true, lastEvidence: "independent", lastAttemptAt: iso });
const unit = () => Float32Array.from({ length: 384 }, (_, index) => index === 0 ? 1 : 0);
const axisVectors = Object.fromEntries(sharedPracticeAxes.map(axis => [axis.id, [1, 0]]));
const item = (itemId, progress = independent, changes = {}) => ({
  identity: { courseId: "fixture", gameId: "sound-quasar", bankId: "words", itemId }, history: progress, vector: [1, 0], ...changes
});

test("shared axes have one fixed order and neutral English probes for every course", () => {
  assert.deepEqual(sharedPracticeAxes.map(axis => axis.id), ["people", "home-school", "food-shopping", "places-travel",
    "actions-abilities", "time-plans", "world-description"]);
  assert.ok(Object.isFrozen(sharedPracticeAxes));
  for (const axis of sharedPracticeAxes) {
    assert.equal(axis.probe.locale, "en");
    assert.doesNotMatch(axis.probe.text, /Czech|Mandarin|Spanish|Norwegian|English|mastery|recall/iu);
    assert.ok(Object.isFrozen(axis) && Object.isFrozen(axis.probe));
  }
});

test("the two polygons use saturated evidence mass with no score or repetition inflation", () => {
  const inputs = [item("assessed"), item("help", history({ lastEvidence: "assisted", lastAssistedAt: iso }))];
  const result = projectPracticeCompass({ courseId: "fixture", items: inputs, axisVectors });
  assert.equal(result.status, "ready");
  assert.deepEqual(result.counts, { encounteredItems: 2, independentItems: 1, mappedItems: 2, mappedIndependentItems: 1, unmappedItems: 0 });
  for (const axis of result.axes) {
    assert.equal(axis.practice, 1 - Math.exp(-1));
    assert.equal(axis.independent, 1 - Math.exp(-0.5));
    assert.equal(axis.practiceWeight, 2);
    assert.equal(axis.independentWeight, 1);
    assert.equal(axis.mappedItems, 2);
    assert.equal(axis.independentItems, 1);
    assert.equal(Object.hasOwn(axis, "mastery"), false);
  }
  assert.deepEqual(projectPracticeCompass({ courseId: "fixture", items: [...inputs, inputs[0]], axisVectors }), result);
  assert.deepEqual(projectPracticeCompass({ courseId: "fixture", items: [item("assessed", { ...independent,
    exposures: 1000, successes: 1000, independentSuccesses: 1000 }), inputs[1]], axisVectors }), result);
  assert.deepEqual(projectPracticeCompass({ courseId: "fixture", items: inputs, axisVectors, goal: { id: "review" } }), result);
});

test("kernel attenuation, independent errors, and assistance provenance stay conservative", () => {
  const error = history({ mistakes: 1, lastCorrect: false, lastAttemptAt: iso, lastEvidence: "independent" });
  const laterSupport = { ...error, lastEvidence: "assisted", lastAssistedAt: iso };
  const result = projectPracticeCompass({ courseId: "fixture", axisVectors, items: [
    item("error", error, { vector: [0.8, 0.6] }), item("later-help", laterSupport), item("legacy", history({ successes: 100, mistakes: 20 }))
  ] });
  const weight = ((0.8 - 0.3) / 0.7) ** 2;
  assert.equal(result.counts.independentItems, 1);
  assert.ok(Math.abs(result.axes[0].practiceWeight - (2 + weight)) < 1e-12);
  assert.ok(Math.abs(result.axes[0].independentWeight - weight) < 1e-12);
  const differentBanks = projectPracticeCompass({ courseId: "fixture", axisVectors, items: [item("same"),
    item("same", error, { identity: { courseId: "fixture", gameId: "sound-quasar", bankId: "sentences", itemId: "same" } })] });
  assert.equal(differentBanks.counts.encounteredItems, 2);
  assert.throws(() => projectPracticeCompass({ courseId: "another", axisVectors, items: [item("same")] }), /current course/);
});

test("missing history, missing vectors and unmapped topics remain explicit", () => {
  const result = projectPracticeCompass({ courseId: "fixture", axisVectors, items: [item("mapped"),
    item("missing", independent, { vector: null }), item("unknown", null), item("unrelated", independent, { vector: [0, 1] })] });
  assert.equal(result.status, "partial");
  assert.equal(result.counts.mappedItems, 1);
  assert.equal(result.counts.unmappedItems, 3);
  assert.deepEqual(result.unmapped.map(row => row.reason), ["vector-unavailable", "history-unavailable", "outside-shared-topics"]);
  const unavailable = projectPracticeCompass({ courseId: "fixture", items: [item("unknown")], axisVectors: {} });
  assert.equal(unavailable.status, "unavailable");
  assert.ok(unavailable.axes.every(axis => axis.practice === null && axis.independent === null));
  const empty = projectPracticeCompass({ courseId: "fixture" });
  assert.equal(empty.status, "empty");
  assert.ok(empty.axes.every(axis => axis.practice === 0 && axis.independent === 0));
  assert.equal(projectPracticeCompass({ courseId: "fixture", partial: true }).status, "unavailable");
});

function fixtureLearning(entries, id = "fixture") {
  const banks = new Map();
  for (const entry of entries) {
    const key = JSON.stringify([entry.identity.gameId, entry.identity.bankId]);
    if (!banks.has(key)) banks.set(key, {});
    banks.get(key)[entry.identity.itemId] = entry.history;
  }
  return {
    contentGeneration: () => "generation",
    practiceSummary: () => ({ courseId: id, status: "ready", totals: { encounteredItems: entries.length },
      games: [...new Set(entries.map(entry => entry.identity.gameId))].map(gameId => ({ gameId,
        banks: [...banks.keys()].map(key => JSON.parse(key)).filter(([game]) => game === gameId).map(([, bankId]) => ({ bankId })) })) }),
    contentHistory: (gameId, bankId) => banks.get(JSON.stringify([gameId, bankId])) || {}
  };
}

async function courseSamples(manifest) {
  const rows = [];
  const add = (gameId, bankId, id, text) => rows.push({ gameId, bankId, id, text });
  const resource = async name => manifest.resources[name] ? json(manifest.resources[name].path) : null;
  const verbs = extractCoreVerbPairs(await resource("verbNebulaCatalog"), { learnerBaseLanguage: manifest.sourceLanguage.locale });
  add("verb-nebula", "default", verbs[0].id, verbs[0].englishAuditText);
  const wordManifest = await resource("wordWorldManifest");
  let word;
  if (wordManifest.runtimeFile) {
    const pack = await json(`apps/languages/${manifest.directoryName}/static/data/games/word-world/${wordManifest.runtimeFile.split("?")[0]}`);
    word = { id: pack.records[0].id, text: pack.records[0].en };
  } else {
    const pack = await json(`apps${wordManifest.sourceConceptCatalog}`);
    word = { id: pack.concepts[0].id, text: pack.concepts[0].englishText };
  }
  for (const bankId of ["sentences", "reconstruct-target", "reconstruct-source"]) add("word-world", bankId, word.id, word.text);
  const cometRaw = await resource("conjugationCometCatalog");
  if (cometRaw) {
    const comet = validateConjugationCometCatalog(cometRaw, { expectedCourseId: manifest.id, expectedTargetLanguageId: manifest.targetLanguage.id,
      expectedLearnerBaseLanguageId: manifest.sourceLanguage.id, expectedTargetLocale: manifest.targetLanguage.locale });
    const verb = comet.verbs[0], form = verb.forms[0];
    add("conjugation-comet", "default", verb.id, verb.englishAuditText);
    add("conjugation-comet", "forms", `${verb.id}.${form.id}`, form.englishAuditText);
  }
  const gravity = await resource("grammarGravityCatalog");
  if (gravity) {
    for (const difficulty of [1, 2, 3]) {
      const round = buildGrammarGravityRounds(gravity, difficulty, () => 0.5)[0];
      assert.equal(round.difficulty, difficulty);
      for (const mode of ["sequence", "forms", "meaning", "nouns"]) add("grammar-gravity", `phrases-${mode}`, round.id, round.englishAuditText);
    }
    const noun = (await resource("grammarGravityNouns")).items[0];
    add("grammar-gravity", "nouns", noun.id, noun.english);
  }
  const sound = await resource("soundQuasarCatalog");
  for (const [bankId, values] of [["words", sound.items], ["sentences", sound.sentences]]) {
    if (values?.length) add("sound-quasar", bankId, values[0].id, values[0].englishAuditText);
  }
  const cases = await resource("caseCosmosCatalog");
  if (cases) {
    const legacyRound = buildRounds(cases, 3).find(round => !round.contextItem);
    const question = buildQuestions(legacyRound, () => 0.5)[0];
    const id = `legacy-${Array.from(legacyRound.noun).map(character => character.codePointAt(0).toString(16)).join("-")}-${question.case.toLowerCase()}`;
    add("case-cosmos", "default", id, question.english);
    add("case-cosmos", "default", cases.contexts[0].id, cases.contexts[0].english);
  }
  const nucleus = await resource("naturalizationNucleusCatalog");
  if (nucleus) for (const bankId of ["default", "recognize-hanzi-pinyin", "recognize-pinyin-hanzi"]) {
    add("naturalization-nucleus", bankId, nucleus.challenges[0].id, nucleus.challenges[0].translation);
  }
  return rows;
}

test("all five actual course catalogs map every supported bank and recorded Grammar difficulty using authored English", async t => {
  for (const { course: manifest } of loaded.courses) await t.test(manifest.id, async () => {
    const course = generateCourseProfileObject(manifest, loaded.courses);
    const samples = await courseSamples(manifest);
    const app = createBrowserHarness({ course });
    app.window.navigator.locks = { request: async (_name, action) => action() };
    vm.runInContext(profileSource, app.context);
    const learning = app.window.CaatuuLearning;
    for (const [index, row] of samples.entries()) learning.recordExposure(row.gameId, {
      bankId: row.bankId, itemId: row.id, encounterId: `fixture-${index}`, correct: false, evidence: "independent"
    });
    await learning.retryPendingSaves();
    const calls = [], fetched = [], progress = [];
    const facade = createPracticeCompass({ course, learning, runtimeHref: `https://caatuu.test${course.routePrefix}/index.html`, owner: {},
      encoder: async texts => { calls.push(...texts); return texts.map(unit); },
      fetchImpl: async url => {
        const parsed = new URL(url); assert.equal(parsed.origin, "https://caatuu.test");
        let path;
        if (parsed.pathname.startsWith(`${course.routePrefix}/`)) path = `apps/languages/${manifest.directoryName}/static/${parsed.pathname.slice(course.routePrefix.length + 1)}`;
        else { assert.ok(parsed.pathname.startsWith("/language-runtime/static/data/english-concepts/")); path = `apps${parsed.pathname}`; }
        fetched.push(url);
        return { ok: true, json: () => json(path) };
      } });
    const before = app.localStorage.snapshot();
    const result = await facade.project({ onProgress: value => progress.push(value) });
    assert.equal(result.status, "ready", JSON.stringify(result.unmapped));
    assert.equal(result.counts.encounteredItems, samples.length);
    assert.equal(result.counts.mappedItems, samples.length);
    assert.equal(result.counts.mappedIndependentItems, samples.length, "unaided errors count as assessment evidence");
    assert.equal(result.counts.unmappedItems, 0);
    assert.deepEqual(new Set(calls), new Set([...sharedPracticeAxes.map(axis => axis.probe.text), ...samples.map(row => row.text.normalize("NFC").trim())]));
    assert.ok(progress.some(value => value.phase === "catalogs") && progress.some(value => value.phase === "embedding"));
    assert.deepEqual(app.localStorage.snapshot(), before, "mapping does not migrate or rewrite learning history");
    const callCount = calls.length, fetchCount = fetched.length;
    learning.setGoal("review");
    assert.deepEqual(await facade.project(), result, "goals do not mutate recorded polygons");
    assert.equal(calls.length, callCount);
    assert.equal(fetched.length, fetchCount);
  });
});

function wordFixture(count, options = {}) {
  const course = { id: "fixture", routePrefix: "/fixture", sourceLanguage: { id: "en" },
    gameContent: { "word-net": { wordWorldManifest: "data/games/word-world/manifest.json" } } };
  const entries = Array.from({ length: count }, (_, index) => item(`word-${index}`, independent,
    { identity: { courseId: "fixture", gameId: "word-world", bankId: "sentences", itemId: `word-${index}` } }));
  const pack = { schemaVersion: "caatuu-word-world-runtime-v1", records: entries.map((entry, index) => ({ id: entry.identity.itemId, en: `People visit home number ${index}.` })) };
  const learning = fixtureLearning(entries);
  const facade = createPracticeCompass({ course, learning, runtimeHref: "https://caatuu.test/fixture/index.html", owner: {},
    fetchImpl: async url => ({ ok: true, json: async () => url.includes("manifest.json")
      ? { schemaVersion: "caatuu-word-world-runtime-manifest-v1", runtimeFile: "content.json" } : pack }),
    encoder: async texts => texts.map(unit), ...options });
  return { facade, course, learning, pack };
}

test("bounded warmup is resumable and never embeds unseen catalog rows", async () => {
  const calls = [];
  const { facade, pack } = wordFixture(12, { maxNewTexts: 8, encoder: async texts => { calls.push(texts); return texts.map(unit); } });
  pack.records.push({ id: "unseen", en: "This unencountered sentence must never be embedded." });
  const first = await facade.project();
  assert.equal(first.status, "partial");
  assert.equal(first.counts.mappedItems, 1);
  assert.equal(first.pendingTexts, 11);
  assert.equal((await facade.project()).status, "partial");
  const complete = await facade.project();
  assert.equal(complete.status, "ready");
  assert.equal(complete.counts.mappedItems, 12);
  assert.ok(calls.every(batch => batch.length <= 8));
  assert.equal(calls.flat().length, 19);
  assert.ok(!calls.flat().some(text => text.includes("unencountered")));
});

test("missing catalogs, missing English and inference failures stay explicitly unmapped", async () => {
  const blocked = wordFixture(1, { fetchImpl: async () => { throw new Error("offline"); },
    encoder: () => assert.fail("unavailable catalogs cannot justify inference") });
  assert.equal((await blocked.facade.project()).unmapped[0].reason, "catalog-unavailable");
  const invalid = wordFixture(1);
  invalid.pack.records[0].en = "我喜欢中文";
  assert.equal((await invalid.facade.project()).unmapped[0].reason, "english-text-unavailable");
  const failed = wordFixture(1, { encoder: async () => { throw new Error("unavailable"); } });
  const result = await failed.facade.project();
  assert.equal(result.status, "unavailable");
  assert.ok(result.axes.every(axis => axis.practice === null && axis.independent === null));
  assert.deepEqual(result.issues, ["embedding-unavailable"]);
});

test("failed bank reads preserve known summary counts as unmapped", async () => {
  const { facade, learning } = wordFixture(1, { encoder: () => assert.fail("unreadable history started inference") });
  const summary = learning.practiceSummary();
  summary.totals.independentItems = 1;
  learning.practiceSummary = () => summary;
  learning.contentHistory = () => { throw new Error("unreadable"); };
  const result = await facade.project();
  assert.equal(result.status, "unavailable");
  assert.deepEqual(result.counts, { encounteredItems: 1, independentItems: 1, mappedItems: 0, mappedIndependentItems: 0, unmappedItems: 1 });
  assert.ok(result.axes.every(axis => axis.practice === null && axis.independent === null));
  assert.deepEqual(result.issues, ["history-unavailable", "history-incomplete"]);
});

test("safe resource resolution forbids another course, empty history is quiet, and cancellation is immediate", async () => {
  const quiet = wordFixture(0, { encoder: () => assert.fail("empty history started inference"), fetchImpl: () => assert.fail("empty history fetched a catalog") });
  assert.equal((await quiet.facade.project()).status, "empty");
  const { course, learning } = wordFixture(1);
  const unsafe = createPracticeCompass({ course: { ...course, gameContent: {
    "word-net": { wordWorldManifest: "../another/data/games/word-world/manifest.json" }
  } }, learning, runtimeHref: "https://caatuu.test/fixture/index.html", owner: {},
  fetchImpl: () => assert.fail("unsafe resource was fetched"), encoder: async texts => texts.map(unit) });
  assert.equal((await unsafe.project()).unmapped[0].reason, "catalog-unavailable");
  const controller = new AbortController();
  let resolveInference, entered, firstInference = true;
  const started = new Promise(resolve => { entered = resolve; });
  const pending = wordFixture(1, { encoder: texts => {
    if (!firstInference) return Promise.resolve(texts.map(unit));
    firstInference = false;
    return new Promise(resolve => {
    resolveInference = () => resolve(texts.map(unit)); entered();
  }); } });
  const result = pending.facade.project({ signal: controller.signal });
  await started;
  controller.abort();
  await assert.rejects(result, { name: "AbortError" });
  resolveInference();
  assert.equal((await pending.facade.project()).status, "ready");
});
