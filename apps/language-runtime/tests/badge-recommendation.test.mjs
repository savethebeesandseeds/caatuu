import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { BADGE_RECOMMENDATION_POLICY, evaluateBadgeRecommendation, createBadgeRecommendation } from "../static/source/badge-recommendation.mjs";
import { loadCourseCatalog, generateCourseProfileObject } from "../../../tools/language-packs/lib/course-contract.mjs";
import { extractCoreVerbPairs } from "../static/source/games/verb-nebula/verb-nebula-core.mjs";
import { validateConjugationCometCatalog } from "../static/source/games/conjugation-comet/conjugation-comet-core.mjs";
import { buildGrammarGravityRounds } from "../static/source/games/grammar-gravity/grammar-gravity-core.mjs";

const now = Date.parse("2026-10-14T09:00:00.000Z");
const recent = "2026-10-13T09:00:00.000Z";
const history = (spaced = true, changes = {}) => ({ exposures: 2, successes: 2, mistakes: 0,
  independentSuccesses: 2, independentDays: 2, spacedSuccesses: Number(spaced),
  assistedSuccesses: 0, lapses: 0, intervalMs: 86400000,
  firstSeenAt: "2026-10-10T09:00:00.000Z", lastSeenAt: recent, lastAttemptAt: recent,
  lastIndependentAt: recent, lastCorrect: true, lastEvidence: "independent", ...changes });
const item = (index, changes = {}) => ({ identity: { courseId: "fixture", gameId: "word-world",
  bankId: "reconstruct-target", itemId: `word-${index}` }, difficulty: 1,
  history: history(index < 6), ...changes });
const rows = () => Array.from({ length: 12 }, (_, index) => item(index));
const input = changes => ({ courseId: "fixture", difficulty: 1, stageComplete: true, now, items: rows(),
  nextPlayable: [{ gameId: "word-world", bankId: "reconstruct-target", playable: true }], ...changes });

test("practice and recent spaced independent breadth support a voluntary invitation, not a mastery estimate", () => {
  const args = input();
  const before = JSON.stringify(args);
  const result = evaluateBadgeRecommendation(args);
  assert.equal(result.status, "ready");
  assert.equal(result.recommended, true);
  assert.equal(result.suggestedDifficulty, 2);
  assert.deepEqual(result.counts, { resolvedItems: 12, independentItems: 12, spacedItems: 6, unresolvedItems: 0 });
  assert.equal(result.calibrated, false);
  assert.equal(result.heuristicVersion, BADGE_RECOMMENDATION_POLICY.version);
  assert.equal(Object.hasOwn(result, "mastery"), false);
  assert.equal(JSON.stringify(args), before);
  assert.equal(evaluateBadgeRecommendation(input({ difficulty: 2,
    items: rows().map(row => ({ ...row, difficulty: 2 })) })).suggestedDifficulty, 3);
});

test("cycles alone, same-session repetitions, errors, assistance, and legacy success cannot recommend a badge", () => {
  assert.equal(evaluateBadgeRecommendation(input({ stageComplete: false })).status, "practice-needed");
  for (const changes of [
    { independentSuccesses: 0, independentDays: 0, spacedSuccesses: 0 },
    { independentDays: 1, spacedSuccesses: 0 },
    { lastCorrect: false }, { lastEvidence: "assisted" }, { lastEvidence: "exposure" }
  ]) {
    const result = evaluateBadgeRecommendation(input({ items: rows().map(row => ({ ...row, history: history(true, changes) })) }));
    assert.equal(result.status, "evidence-needed", JSON.stringify(changes));
    assert.equal(result.recommended, false);
  }
  assert.equal(evaluateBadgeRecommendation(input({ items: rows().slice(0, 11) })).recommended, false);
  assert.equal(evaluateBadgeRecommendation(input({ items: rows().map((row, index) => ({ ...row, history: history(index < 5) })) })).recommended, false);
});

test("recency boundary is exact and future timestamps or invalid counts remain unknown", () => {
  const boundary = new Date(now - 30 * 86400000).toISOString();
  const atBoundary = rows().map(row => ({ ...row, history: history(true, {
    firstSeenAt: boundary, lastSeenAt: boundary, lastAttemptAt: boundary, lastIndependentAt: boundary }) }));
  assert.equal(evaluateBadgeRecommendation(input({ items: atBoundary })).recommended, true);
  atBoundary[0].history.lastAttemptAt = new Date(Date.parse(boundary) - 1).toISOString();
  assert.equal(evaluateBadgeRecommendation(input({ items: atBoundary })).recommended, false);
  for (const changes of [{ lastAttemptAt: "2026-10-15T09:00:00.000Z" },
    { lastIndependentAt: "2026-10-15T09:00:00.000Z" }, { lastSeenAt: "invalid" },
    { independentDays: -1 }, { spacedSuccesses: 1.5 }]) {
    const result = evaluateBadgeRecommendation(input({ items: [item(0, { history: history(true, changes) }), ...rows().slice(1)] }));
    assert.equal(result.status, "unknown", JSON.stringify(changes));
    assert.equal(result.recommended, false);
  }
});

test("course/difficulty isolation and parent grouping prevent breadth inflation across forms and directions", () => {
  const repeated = Array.from({ length: 48 }, (_, index) => item(index, { groupId: "one-sentence",
    identity: { courseId: "fixture", gameId: "word-world", bankId: index % 2 ? "reconstruct-target" : "reconstruct-source", itemId: `form-${index}` } }));
  const result = evaluateBadgeRecommendation(input({ items: repeated }));
  assert.equal(result.counts.independentItems, 1);
  assert.equal(result.recommended, false);
  assert.equal(evaluateBadgeRecommendation(input({ items: rows().map(row => ({ ...row, difficulty: 2 })) })).counts.independentItems, 0);
  assert.equal(evaluateBadgeRecommendation(input({ items: [item(0, { identity: { ...item(0).identity, courseId: "another" } }), ...rows().slice(1)] })).status, "unknown");
  assert.equal(evaluateBadgeRecommendation(input({ items: [...rows(), ...rows()] })).counts.independentItems, 12);
});

test("next difficulty must be playable on a qualifying practiced path; partial data is never a recommendation", () => {
  for (const nextPlayable of [[], [{ gameId: "word-world", bankId: "reconstruct-target", playable: false }],
    [{ gameId: "sound-quasar", bankId: "words", playable: true }]]) {
    const result = evaluateBadgeRecommendation(input({ nextPlayable }));
    assert.equal(result.recommended, false);
    assert.ok(result.reasons.includes("next-band-not-playable-on-practiced-path"));
  }
  assert.equal(evaluateBadgeRecommendation(input({ partial: true })).status, "unknown");
  assert.equal(evaluateBadgeRecommendation(input({ issues: ["unsupported-bank"] })).status, "unknown");
  assert.equal(evaluateBadgeRecommendation(input({ difficulty: 3 })).status, "max-level");
});

function fixture({ fetchImpl, bankId = "reconstruct-target" } = {}) {
  let generation = "one", difficulty = 1;
  const course = { id: "fixture", routePrefix: "/fixture", games: ["word-net"],
    capabilities: { wordWorld: true }, routes: { wordWorld: "index.html?game=word-net" },
    sourceLanguage: { id: "en", locale: "en" }, targetLanguage: { id: "fixture", locale: "en" },
    gameContent: { "word-net": { wordWorldManifest: "data/games/word-world/manifest.json" } } };
  const pack = { schemaVersion: "caatuu-word-world-runtime-v1", records: [...rows().map(row => ({
    id: row.identity.itemId, difficulty: 1, cs: `Target sentence ${row.identity.itemId}.`, en: "Source sentence." })),
    { id: "next", difficulty: 2, cs: "Next target.", en: "Next source." }] };
  const entries = Object.fromEntries(rows().map(row => [row.identity.itemId, row.history]));
  const learning = { difficulty: () => difficulty, contentGeneration: () => generation,
    contentHistory: () => entries,
    practiceSummary: () => ({ courseId: "fixture", status: "ready", totals: { encounteredItems: 12 },
      games: [{ gameId: "word-world", banks: [{ bankId }] }] }) };
  const fetches = [];
  const facade = createBadgeRecommendation({ course, learning, runtimeHref: "https://caatuu.test/fixture/index.html",
    fetchImpl: async (url, options) => {
      fetches.push(url);
      if (fetchImpl) return fetchImpl(url, options, pack);
      return { ok: true, json: async () => url.includes("manifest.json")
        ? { schemaVersion: "caatuu-word-world-runtime-manifest-v1", runtimeFile: "content.json" } : pack };
    } });
  return { facade, pack, fetches, learning, course, setGeneration: value => { generation = value; }, setDifficulty: value => { difficulty = value; } };
}

test("shared loader resolves declared course IDs and caches catalogs without writing learner data", async () => {
  const f = fixture();
  const before = JSON.stringify(f.learning.contentHistory());
  assert.equal((await f.facade.evaluate({ stageComplete: true, now })).recommended, true);
  assert.equal(f.fetches.length, 2);
  assert.equal((await f.facade.evaluate({ stageComplete: true, now })).recommended, true);
  assert.equal(f.fetches.length, 2);
  assert.equal(JSON.stringify(f.learning.contentHistory()), before);
  const quiet = fixture({ fetchImpl: () => assert.fail("incomplete practice should not fetch catalogs") });
  assert.equal((await quiet.facade.evaluate({ stageComplete: false, now })).status, "practice-needed");
});

test("unsupported/missing catalog banks stay unknown, safe fetches can recover, and stale evaluations are fenced", async () => {
  assert.equal((await fixture({ bankId: "unsupported" }).facade.evaluate({ stageComplete: true, now })).status, "unknown");
  let offline = true;
  const recovering = fixture({ fetchImpl: async (url, _options, pack) => {
    if (offline) throw new Error("offline");
    return { ok: true, json: async () => url.includes("manifest.json")
      ? { schemaVersion: "caatuu-word-world-runtime-manifest-v1", runtimeFile: "content.json" } : pack };
  } });
  assert.equal((await recovering.facade.evaluate({ stageComplete: true, now })).status, "unknown");
  offline = false;
  assert.equal((await recovering.facade.evaluate({ stageComplete: true, now })).recommended, true);
  let stale;
  stale = fixture({ fetchImpl: async (url, _options, pack) => {
    stale.setGeneration("reset");
    return { ok: true, json: async () => url.includes("manifest.json")
      ? { schemaVersion: "caatuu-word-world-runtime-manifest-v1", runtimeFile: "content.json" } : pack };
  } });
  const changed = await stale.facade.evaluate({ stageComplete: true, now });
  assert.equal(changed.status, "unknown");
  assert.ok(changed.issues.includes("profile-changed-during-evaluation"));
  const controller = new AbortController(); controller.abort();
  await assert.rejects(recovering.facade.evaluate({ stageComplete: true, now, signal: controller.signal }), { name: "AbortError" });
});

const json = async path => JSON.parse(await readFile(new URL(`../../../${path}`, import.meta.url), "utf8"));
test("one catalog resolver supports Word World v1/v2 in every registered course without course-specific code", async t => {
  const loaded = await loadCourseCatalog();
  for (const { course: manifest } of loaded.courses) await t.test(manifest.id, async () => {
    const course = generateCourseProfileObject(manifest, loaded.courses);
    const word = await json(manifest.resources.wordWorldManifest.path);
    const base = `apps/languages/${manifest.directoryName}/static/data/games/word-world/`;
    let records;
    if (word.runtimeFile) records = (await json(`${base}${word.runtimeFile.split("?")[0]}`)).records;
    else {
      const concepts = await json(word.sourceConceptCatalog.startsWith("/language-runtime/")
        ? `apps${word.sourceConceptCatalog.split("?")[0]}` : word.sourceConceptCatalog);
      records = concepts.concepts.map(row => ({ id: row.id, difficulty: row.difficulty }));
    }
    const current = records.filter(row => (row.difficulty ?? 1) === 1).slice(0, 12);
    const entries = Object.fromEntries(current.map((row, index) => [row.id, history(index < 6)]));
    const learning = { difficulty: () => 1, contentGeneration: () => "one", contentHistory: () => entries,
      practiceSummary: () => ({ courseId: course.id, status: "ready", totals: { encounteredItems: current.length },
        games: [{ gameId: "word-world", banks: [{ bankId: "reconstruct-target" }] }] }) };
    const facade = createBadgeRecommendation({ course, learning, runtimeHref: `https://caatuu.test${course.routePrefix}/index.html`,
      fetchImpl: async url => {
        const parsed = new URL(url); assert.equal(parsed.origin, "https://caatuu.test");
        const path = parsed.pathname.startsWith(`${course.routePrefix}/`)
          ? `apps/languages/${manifest.directoryName}/static/${parsed.pathname.slice(course.routePrefix.length + 1)}` : `apps${parsed.pathname}`;
        return { ok: true, json: () => json(path) };
      } });
    const result = await facade.evaluate({ stageComplete: true, now });
    assert.notEqual(result.status, "unknown", JSON.stringify(result));
    assert.equal(result.recommended, current.length >= 12 && records.some(row => row.difficulty === 2), JSON.stringify(result));
  });
});

test("every supported actual course bank resolves difficulty and next-task feasibility, including cases and both domino directions", async t => {
  const loaded = await loadCourseCatalog();
  for (const { course: manifest } of loaded.courses) await t.test(manifest.id, async () => {
    const course = generateCourseProfileObject(manifest, loaded.courses);
    const resource = async name => manifest.resources[name] ? json(manifest.resources[name].path) : null;
    const samples = [];
    const add = (gameId, bankId, itemId) => samples.push({ gameId, bankId, itemId });
    const verbs = extractCoreVerbPairs(await resource("verbNebulaCatalog"), { learnerBaseLanguage: manifest.sourceLanguage.locale });
    add("verb-nebula", "default", verbs[0].id);
    const cometRaw = await resource("conjugationCometCatalog");
    if (cometRaw) {
      const comet = validateConjugationCometCatalog(cometRaw, { expectedCourseId: manifest.id,
        expectedTargetLanguageId: manifest.targetLanguage.id, expectedLearnerBaseLanguageId: manifest.sourceLanguage.id,
        expectedTargetLocale: manifest.targetLanguage.locale });
      add("conjugation-comet", "default", comet.verbs[0].id);
      for (const form of comet.verbs[0].forms) add("conjugation-comet", "forms", `${comet.verbs[0].id}.${form.id}`);
    }
    const grammar = await resource("grammarGravityCatalog");
    if (grammar) {
      for (const difficulty of [1, 2, 3]) {
        const first = buildGrammarGravityRounds(grammar, difficulty, () => .5)[0];
        for (const mode of ["sequence", "forms", "meaning", "nouns"]) add("grammar-gravity", `phrases-${mode}`, first.id);
      }
      add("grammar-gravity", "nouns", (await resource("grammarGravityNouns")).items[0].id);
    }
    const sound = await resource("soundQuasarCatalog");
    if (sound) for (const bankId of ["words", "sentences"]) add("sound-quasar", bankId, sound[bankId === "words" ? "items" : "sentences"][0].id);
    const moon = await resource("memoryMoonCatalog");
    if (moon) for (const level of [1, 2, 3]) {
      const question = moon.challenges.find(row => row.difficulty === level);
      assert.ok(question, `${manifest.id}: Memory Moon badge ${level}`);
      add("memory-moon", "translations", question.id);
    }
    const cases = await resource("caseCosmosCatalog");
    if (cases) {
      const noun = cases.legacyNouns[0], name = Object.keys(noun.cases)[0];
      add("case-cosmos", "default", `legacy-${Array.from(noun.noun).map(character => character.codePointAt(0).toString(16)).join("-")}-${name.toLowerCase()}`);
      add("case-cosmos", "default", cases.contexts[0].id);
    }
    const nucleus = await resource("naturalizationNucleusCatalog");
    if (nucleus) for (const bankId of nucleus.schemaVersion === 2
      ? ["default", "recognize-target-reading", "recognize-reading-target"]
      : ["default", "recognize-hanzi-pinyin", "recognize-pinyin-hanzi"]) add("naturalization-nucleus", bankId, nucleus.challenges[0].id);
    const banks = new Map();
    for (const row of samples) {
      const key = JSON.stringify([row.gameId, row.bankId]);
      if (!banks.has(key)) banks.set(key, {});
      banks.get(key)[row.itemId] = history();
    }
    const gameIds = [...new Set(samples.map(row => row.gameId))];
    const learning = { difficulty: () => 1, contentGeneration: () => "one",
      contentHistory: (gameId, bankId) => banks.get(JSON.stringify([gameId, bankId])) || {},
      practiceSummary: () => ({ courseId: course.id, status: "ready", totals: { encounteredItems: samples.length },
        games: gameIds.map(gameId => ({ gameId, banks: [...banks.keys()].map(key => JSON.parse(key))
          .filter(([game]) => game === gameId).map(([, bankId]) => ({ bankId })) })) }) };
    const facade = createBadgeRecommendation({ course, learning, runtimeHref: `https://caatuu.test${course.routePrefix}/index.html`,
      fetchImpl: async url => {
        const parsed = new URL(url);
        const path = parsed.pathname.startsWith(`${course.routePrefix}/`)
          ? `apps/languages/${manifest.directoryName}/static/${parsed.pathname.slice(course.routePrefix.length + 1)}` : `apps${parsed.pathname}`;
        return { ok: true, json: () => json(path) };
      } });
    const result = await facade.evaluate({ stageComplete: true, now });
    assert.notEqual(result.status, "unknown", JSON.stringify(result));
    assert.equal(result.counts.unresolvedItems, 0);
    assert.ok(result.counts.resolvedItems > 0);
  });
});

test("an authored next-level listening row cannot recommend a badge when no valid choice round can be built", async () => {
  const loaded = await loadCourseCatalog();
  const manifest = loaded.courses.find(entry => entry.course.id === "cz").course;
  const course = generateCourseProfileObject(manifest, loaded.courses);
  const raw = await json(manifest.resources.soundQuasarCatalog.path);
  const current = raw.items.filter(row => (row.difficulty ?? 1) === 1).slice(0, 12);
  const entries = Object.fromEntries(current.map(row => [row.id, history()]));
  const learning = { difficulty: () => 1, contentGeneration: () => "one", contentHistory: () => entries,
    practiceSummary: () => ({ courseId: course.id, status: "ready", totals: { encounteredItems: current.length },
      games: [{ gameId: "sound-quasar", banks: [{ bankId: "words" }] }] }) };
  const evaluate = pack => createBadgeRecommendation({ course, learning, runtimeHref: "https://caatuu.test/cz/index.html",
    fetchImpl: async () => ({ ok: true, json: async () => pack }) }).evaluate({ stageComplete: true, now });
  assert.equal((await evaluate(raw)).recommended, true);
  const sparse = structuredClone(raw);
  const next = sparse.items.find(row => row.difficulty === 2);
  sparse.items = sparse.items.filter(row => row.difficulty !== 2 || row.id === next.id);
  const result = await evaluate(sparse);
  assert.ok(["evidence-needed", "unknown"].includes(result.status), JSON.stringify(result));
  assert.equal(result.recommended, false);
  assert.ok(result.reasons.includes("next-band-not-playable-on-practiced-path")
    || result.issues.includes("catalog-or-history-unavailable"));
});

test("a new independent failure recorded during catalog loading replaces stale success before evaluation", async () => {
  let f;
  f = fixture({ fetchImpl: async (url, _options, pack) => {
    f.learning.contentHistory()["word-0"].lastCorrect = false;
    return { ok: true, json: async () => url.includes("manifest.json")
      ? { schemaVersion: "caatuu-word-world-runtime-manifest-v1", runtimeFile: "content.json" } : pack };
  } });
  const result = await f.facade.evaluate({ stageComplete: true, now });
  assert.equal(result.status, "evidence-needed");
  assert.equal(result.counts.independentItems, 11);
  assert.equal(result.recommended, false);
});

test("legacy task feasibility rejects accepted-only case alternatives and homophone-only domino boards", async () => {
  const loaded = await loadCourseCatalog();
  for (const { courseId, gameId, resourceName, bankId, mutate } of [
    { courseId: "cz", gameId: "case-cosmos", resourceName: "caseCosmosCatalog", bankId: "default",
      mutate(pack) { const context = pack.contexts[0], paradigm = pack.paradigms.find(row => row.id === context.paradigmId);
        context.acceptedForms = paradigm.forms.filter(form => form !== context.form); } },
    { courseId: "zh", gameId: "naturalization-nucleus", resourceName: "naturalizationNucleusCatalog", bankId: "recognize-hanzi-pinyin",
      mutate(pack) { const first = pack.challenges.find(row => row.difficulty === 2);
        for (const row of pack.challenges.filter(row => row.difficulty === 2)) { row.pinyin = first.pinyin; row.tone = first.tone; } } }
  ]) {
    const manifest = loaded.courses.find(entry => entry.course.id === courseId).course;
    const course = generateCourseProfileObject(manifest, loaded.courses);
    const raw = await json(manifest.resources[resourceName].path);
    const eligible = (gameId === "case-cosmos" ? raw.contexts : raw.challenges).filter(row => row.difficulty === 1).slice(0, 12);
    const entries = Object.fromEntries(eligible.map(row => [row.id, history()]));
    const learning = { difficulty: () => 1, contentGeneration: () => "one", contentHistory: () => entries,
      practiceSummary: () => ({ courseId: course.id, status: "ready", totals: { encounteredItems: eligible.length },
        games: [{ gameId, banks: [{ bankId }] }] }) };
    const evaluate = pack => createBadgeRecommendation({ course, learning,
      runtimeHref: `https://caatuu.test${course.routePrefix}/index.html`,
      fetchImpl: async () => ({ ok: true, json: async () => pack }) }).evaluate({ stageComplete: true, now });
    assert.notEqual((await evaluate(raw)).status, "unknown", gameId);
    const broken = structuredClone(raw); mutate(broken);
    const result = await evaluate(broken);
    assert.equal(result.status, "unknown", gameId);
    assert.equal(result.recommended, false);
  }
});

test("canonical shell availability excludes retained listening proof without speech, case proof without its feature, and routes that are unavailable", async () => {
  const loaded = await loadCourseCatalog();
  const manifest = loaded.courses.find(entry => entry.course.id === "cz").course;
  for (const { gameId, bankId, resourceName, collection, change } of [
    { gameId: "sound-quasar", bankId: "words", resourceName: "soundQuasarCatalog", collection: "items",
      change(course) { course.capabilities.speech = false; } },
    { gameId: "case-cosmos", bankId: "default", resourceName: "caseCosmosCatalog", collection: "contexts",
      change(course) { course.linguisticFeatures = course.linguisticFeatures.filter(value => value !== "grammatical-case"); } },
    { gameId: "sound-quasar", bankId: "words", resourceName: "soundQuasarCatalog", collection: "items",
      change(course) { delete course.routes.soundQuasar; } }
  ]) {
    const course = structuredClone(generateCourseProfileObject(manifest, loaded.courses));
    const raw = await json(manifest.resources[resourceName].path);
    const eligible = raw[collection].filter(row => (row.difficulty ?? 1) === 1).slice(0, 12);
    const entries = Object.fromEntries(eligible.map(row => [row.id, history()]));
    const learning = { difficulty: () => 1, contentGeneration: () => "one", contentHistory: () => entries,
      practiceSummary: () => ({ courseId: course.id, status: "ready", totals: { encounteredItems: eligible.length },
        games: [{ gameId, banks: [{ bankId }] }] }) };
    change(course);
    const facade = createBadgeRecommendation({ course, learning, runtimeHref: "https://caatuu.test/cz/index.html",
      fetchImpl: () => assert.fail("a disabled game path must not load readiness catalogs") });
    const result = await facade.evaluate({ stageComplete: true, now });
    assert.equal(result.status, "unknown", gameId);
    assert.equal(result.recommended, false);
    assert.ok(result.issues.includes("unsupported-game"));
  }
  const f = fixture();
  delete f.course.routes.wordWorld;
  const result = await f.facade.evaluate({ stageComplete: true, now });
  assert.equal(result.status, "unknown");
  assert.equal(f.fetches.length, 0);
});

test("unavailable reset generations never create a readiness recommendation or start catalog work", async () => {
  for (const generation of [null, undefined, "", "unknown"]) {
    const f = fixture({ fetchImpl: () => assert.fail("unknown generation must not fetch catalogs") });
    f.setGeneration(generation);
    const result = await f.facade.evaluate({ stageComplete: true, now });
    assert.equal(result.status, "unknown");
    assert.equal(result.recommended, false);
    assert.ok(result.issues.includes("content-generation-unavailable"));
    assert.equal((await f.facade.evaluate({ stageComplete: false, now })).status, "unknown");
    assert.equal((await f.facade.evaluate({ difficulty: 3, stageComplete: true, now })).status, "unknown");
  }
});

test("availability lost while catalogs load fences the completed evidence check", async () => {
  let f;
  f = fixture({ fetchImpl: async (url, _options, pack) => {
    f.course.capabilities.wordWorld = false;
    return { ok: true, json: async () => url.includes("manifest.json")
      ? { schemaVersion: "caatuu-word-world-runtime-manifest-v1", runtimeFile: "content.json" } : pack };
  } });
  const result = await f.facade.evaluate({ stageComplete: true, now });
  assert.equal(result.status, "unknown");
  assert.equal(result.recommended, false);
  assert.ok(result.issues.includes("unsupported-game"));
});
