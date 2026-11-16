import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createCaseCosmosContent, caseCosmosContentForCourse } from "../static/source/games/case-cosmos/case-cosmos-core.mjs";
import { createBadgeRecommendation } from "../static/source/badge-recommendation.mjs";
import { validatePack as validateCzech, buildCasePracticeRounds as czechRounds } from "../../languages/czech/static/source/games/case-cosmos/case-cosmos-content.mjs";

const caseSystem = { targetLocale: "ru", sourceLocale: "en",
  cases: [{ case: "Nominative", meaning: "subject", question: "Who or what?" },
    { case: "Genitive", meaning: "belonging", question: "Whose?" }],
  contrasts: { Nominative: ["Genitive"], Genitive: ["Nominative"] } };
const course = { id: "fixture-ru", routePrefix: "/fixture-ru", sourceLanguage: { id: "en", locale: "en" },
  targetLanguage: { id: "ru", locale: "ru" }, capabilities: {}, linguisticFeatures: ["grammatical-case"],
  games: ["case-cosmos"], routes: { caseCosmos: "case-cosmos.html" },
  gameContent: { "case-cosmos": { caseCosmosCatalog: "data/games/case-cosmos/content.json" } } };
function fixture() {
  const paradigms = [["house", "дом", "дома"], ["cat", "кот", "кота"], ["dog", "пёс", "пса"]]
    .map(([id, noun, other]) => ({ id, noun, number: "singular", forms: [noun, other] }));
  const objectives = [1, 2].map(difficulty => ({ id: "fixture.level-" + difficulty, label: "Fixture " + difficulty, difficulty }));
  const contexts = objectives.flatMap(objective => Array.from({ length: 4 }, (_, index) => {
    const paradigm = paradigms[index % paradigms.length];
    return { id: objective.id + ".item-" + index, revision: 1, paradigmId: paradigm.id,
      case: "Nominative", form: paradigm.noun, acceptedForms: [], target: paradigm.noun + " здесь " + objective.difficulty + " " + index + ".",
      source: "Fixture sentence " + objective.difficulty + " " + index + ".", difficulty: objective.difficulty,
      objectiveId: objective.id, phase: index < 3 ? "practice" : "transfer", context: "Fixture situation.", explanation: "Fixture role." };
  }));
  return { schemaVersion: "caatuu-case-cosmos-content-v3", courseId: course.id, contentRevision: 1,
    caseSystem, curriculum: { schemaVersion: 1, objectives }, legacyNouns: [], paradigms, contexts };
}

test("a non-Latin course owns its case inventory and uses target/source fields through the shared engine", () => {
  const document = fixture();
  const content = caseCosmosContentForCourse(document, course);
  const checked = content.validatePack(document);
  const rounds = content.casePracticeItems(checked, 1, () => .5);
  assert.equal(rounds.length, 4);
  assert.equal(content.caseSystem.cases.length, 2);
  for (const round of rounds) {
    const question = round.practiceQuestions[0];
    assert.equal(question.candidates.filter(candidate => candidate.matches).length, 1);
    assert.equal(question.czech.slice(question.target.start, question.target.end), question.form);
  }
  assert.deepEqual(content.targetSpan("Дом стоит.", "дом"), { start: 0, end: 3 });
  assert.throws(() => caseCosmosContentForCourse(document, { ...course, targetLanguage: { locale: "ka" } }), /locales do not match/u);
});

test("case target matching follows the declared locale", () => {
  const content = createCaseCosmosContent({ courseId: "fixture-tr", caseSystem: { ...caseSystem, targetLocale: "tr" } });
  assert.deepEqual(content.targetSpan("IŞIK var.", "ışık"), { start: 0, end: 4 });
});

test("badge evidence resolves non-Latin authored cases through the same validator as play", async () => {
  const document = fixture();
  const item = document.contexts[0];
  const history = { exposures: 2, successes: 2, mistakes: 0, independentSuccesses: 2,
    independentDays: 2, spacedSuccesses: 1, assistedSuccesses: 0, lapses: 0, intervalMs: 86400000,
    firstSeenAt: "2026-11-08T09:00:00Z", lastSeenAt: "2026-11-10T09:00:00Z",
    lastAttemptAt: "2026-11-10T09:00:00Z", lastIndependentAt: "2026-11-10T09:00:00Z",
    lastCorrect: true, lastEvidence: "independent" };
  const learning = { difficulty: () => 1, contentGeneration: () => "fixture-v1", contentHistory: () => ({ [item.id]: history }),
    practiceSummary: () => ({ courseId: course.id, status: "ready", totals: { encounteredItems: 1 },
      games: [{ gameId: "case-cosmos", banks: [{ bankId: "default" }] }] }) };
  const result = await createBadgeRecommendation({ course, learning,
    runtimeHref: "https://caatuu.test/fixture-ru/index.html",
    fetchImpl: async () => ({ ok: true, json: async () => document }) }).evaluate({ stageComplete: true, now: Date.parse("2026-11-11T09:00:00Z") });
  assert.equal(result.status, "evidence-needed");
  assert.equal(result.counts.resolvedItems, 1);
  assert.deepEqual(result.issues, []);
});

test("retained Czech v2 catalogs normalize without changing any practice identity", async () => {
  const current = JSON.parse(await readFile(new URL("../../languages/czech/static/data/games/case-cosmos/content.json", import.meta.url), "utf8"));
  const { caseSystem: omitted, ...legacy } = current;
  legacy.schemaVersion = "caatuu-case-cosmos-content-v2";
  assert.deepEqual(validateCzech(legacy), validateCzech(current));
  for (const difficulty of [0, 1, 2, 3]) {
    const ids = document => czechRounds(document, difficulty, { random: () => .5 }).map(row => row.id);
    assert.deepEqual(ids(legacy), ids(current));
  }
});
