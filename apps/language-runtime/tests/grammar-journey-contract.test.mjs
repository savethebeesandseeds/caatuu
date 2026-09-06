import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import * as core from "../static/source/games/grammar-gravity/grammar-gravity-core.mjs";
import * as flightCore from "../static/source/games/grammar-gravity/adjective-flight-core.mjs";

function futurePack() {
  return {
    schemaVersion: "caatuu-grammar-gravity-content-v3", courseId: "future", gameId: "grammar-gravity",
    contentId: "future.explicit-v1", contentRevision: 1, status: "development",
    learnerBaseLanguage: "es-ES", targetLanguage: "fr-FR", englishAuditLanguage: "en",
    review: { status: "native-review-required", reviewer: null, reviewedAt: null, notes: "Synthetic contract fixture." },
    license: { origin: "caatuu-first-party-authored", status: "release-review-required", spdxExpression: null, notes: "Synthetic contract fixture." },
    presentation: { errorTitle: "Error", errorDetail: "Inténtalo de nuevo.", backLabel: "Volver" },
    gameplay: { contract: "caatuu-grammar-gravity-journey-v1", stages: ["meaning", "category", "form"], categoryFeature: "number",
      categoryOptions: [{ id: "singular", label: "Singular" }, { id: "plural", label: "Plural" }] },
    axes: [{ id: "one", label: "Singular", features: { number: "singular" } }, { id: "many", label: "Plural", features: { number: "plural" } }],
    challenges: [1, 1, 2, 3].map((difficulty, index) => ({
      id: `future.challenge-${index + 1}`, revision: 1, difficulty,
      focus: { kind: "determiner", label: "Artículo", targetText: "le · les", resultTitle: "Artículo", summary: "Elige el artículo correcto." },
      forms: Object.fromEntries(["one", "many"].map((axisId, axisIndex) => [axisId, {
        displayForm: axisIndex ? "les" : "le",
        examples: ["livre", "chat"].map((noun, exampleIndex) => {
          const anchor = noun + (axisIndex ? "s" : "");
          const base = ["libro", "gato"][exampleIndex] + (axisIndex ? "s" : "");
          const audit = ["book", "cat"][exampleIndex] + (axisIndex ? "s" : "");
          return { id: `future.challenge-${index + 1}.${axisId}.example-${exampleIndex + 1}`, revision: 1,
            targetText: `${axisIndex ? "les" : "le"} ${anchor}`, learnerBaseText: `${axisIndex ? "los" : "el"} ${base}`,
            englishAuditText: `the ${audit}`, anchor: { targetText: anchor, learnerBaseText: base, englishAuditText: audit },
            slot: { beforeText: "", afterText: ` ${anchor}` } };
        })
      }]))
    }))
  };
}

const firstExample = (pack) => pack.challenges[0].forms.one.examples[0];

test("future language uses the same modern contract without language-specific switches", () => {
  const pack = core.validateGrammarGravityPack(futurePack());
  const before = JSON.stringify(pack);
  const rounds = core.buildGrammarGravityRounds(pack, 3, () => 0.999);
  assert.equal(rounds.length, 16);
  assert.equal(new Set(rounds.map(({ id }) => id)).size, 16);
  assert.ok(rounds.every((round) => round.flights.length === 1 && round.stages.join() === "meaning,category,form"));
  assert.equal(JSON.stringify(pack), before);
  assert.equal(Object.isFrozen(rounds[0].flights[0]), true);
  assert.notDeepEqual(core.buildGrammarGravityRounds(pack, 3, () => 0), rounds);
});

test("legacy arrays, v2 packs and deleted exports cannot choose a renderer", () => {
  assert.throws(() => core.normalizeGrammarGravityPack([]));
  const pack = futurePack(); pack.schemaVersion = "caatuu-grammar-gravity-content-v2";
  assert.throws(() => core.normalizeGrammarGravityPack(pack), /content-v3/u);
  for (const name of ["derangeGrammarGravityMatches", "grammarGravityPairMatches", "grammarGravityRoundComplete"]) assert.equal(name in core, false);
  for (const name of ["buildAdjectiveFlights", "buildWordJourneyRounds", "adjectiveFeedbackDuration", "highlightedAdjectiveParts"]) assert.equal(name in flightCore, false);
});

test("missing, ambiguous or inconsistent future-language content fails before round generation", () => {
  const mutations = [
    ["missing gameplay", (pack) => { delete pack.gameplay; }],
    ["unknown gameplay", (pack) => { pack.gameplay.contract = "automatic"; }],
    ["legacy lesson", (pack) => { pack.lesson = {}; }],
    ["unsupported stage", (pack) => { pack.gameplay.stages = ["meaning", "gender", "form"]; }],
    ["missing stage", (pack) => { delete pack.gameplay.stages; }],
    ["unordered stages", (pack) => { pack.gameplay.stages = ["category", "meaning", "form"]; }],
    ["unknown category", (pack) => { pack.axes[0].features.number = "dual"; }],
    ["unlabeled category", (pack) => { pack.gameplay.categoryOptions[0].label = ""; }],
    ["missing anchor", (pack) => { delete firstExample(pack).anchor; }],
    ["missing meaning", (pack) => { firstExample(pack).anchor.learnerBaseText = ""; }],
    ["missing audit", (pack) => { delete firstExample(pack).anchor.englishAuditText; }],
    ["audit role drift", (pack) => { pack.englishAuditLanguage = "es"; }],
    ["noun meaning adapter", (pack) => { firstExample(pack).nounMeaning = {}; }],
    ["missing slot", (pack) => { delete firstExample(pack).slot; }],
    ["wrong slot", (pack) => { firstExample(pack).slot.beforeText = "les "; }],
    ["anchor substring", (pack) => { firstExample(pack).anchor.targetText = "livr"; }],
    ["anchor in answer slot", (pack) => { firstExample(pack).anchor.targetText = "le"; }],
    ["duplicate example ID", (pack) => { pack.challenges[0].forms.one.examples[1].id = firstExample(pack).id; }],
    ["missing difficulty", (pack) => { pack.challenges[3].difficulty = 2; }],
    ["one answer option", (pack) => {
      pack.challenges[0].forms.many.displayForm = "le";
      for (const example of pack.challenges[0].forms.many.examples) example.targetText = `le${example.slot.afterText}`;
    }],
    ["no meaning distractors", (pack) => {
      for (const challenge of pack.challenges) for (const form of Object.values(challenge.forms)) for (const example of form.examples) example.anchor.learnerBaseText = "cosa";
    }]
  ];
  for (const [name, mutate] of mutations) {
    const pack = futurePack(); mutate(pack);
    assert.throws(() => core.validateGrammarGravityPack(pack), undefined, name);
    assert.throws(() => core.buildGrammarGravityRounds(pack, 3), undefined, `${name} cannot build a fallback`);
  }
});

test("course and language identities are checked independently", () => {
  for (const expected of [{ courseId: "other" }, { learnerBaseLanguage: "en" }, { targetLanguage: "de-DE" }]) {
    assert.throws(() => core.validateGrammarGravityPack(futurePack(), expected));
  }
  const pack = futurePack(); pack.learnerBaseLanguage = "en";
  assert.throws(() => core.validateGrammarGravityPack(pack), /exact English audit/u);
});

test("English audit text does not become Spanish question or answer text", () => {
  const pack = futurePack();
  for (const challenge of pack.challenges) for (const form of Object.values(challenge.forms)) for (const example of form.examples) {
    example.englishAuditText = "INDEPENDENT ENGLISH AUDIT";
    example.anchor.englishAuditText = "INDEPENDENT ANCHOR AUDIT";
  }
  const rounds = core.buildGrammarGravityRounds(pack, 3);
  for (const { flights: [flight] } of rounds) {
    assert.equal(flight.anchorEnglishAuditText, "INDEPENDENT ANCHOR AUDIT");
    for (const value of [flight.anchorMeaning, flight.learnerBaseText, ...flight.meaningOptions, ...flight.options]) assert.doesNotMatch(value, /AUDIT/u);
  }
});

test("declared category options must agree with noun lanes without silent inference", () => {
  const pack = core.validateGrammarGravityPack(futurePack());
  const lanes = structuredClone(pack.gameplay.categoryOptions);
  assert.equal(core.validateGrammarGravityCategories(pack, [...lanes].reverse()), pack);
  for (const altered of [[], [lanes[0], lanes[0]], [{ ...lanes[0], label: "One" }, lanes[1]], [{ ...lanes[0], image: "/wrong.svg" }, lanes[1]]]) {
    assert.throws(() => core.validateGrammarGravityCategories(pack, altered));
  }
  const formOnly = futurePack(); formOnly.gameplay.stages = ["form"];
  assert.equal(core.validateGrammarGravityCategories(formOnly, undefined), formOnly);
});

for (const [directory, id, expectedChallenges, expectedExamples] of [["czech", "cz", 18, 162], ["spanish", "es", 8, 64], ["english-from-spanish", "es-en", 6, 24]]) {
  test(`${id}: every authored example uses modern stages at every offered difficulty`, async () => {
    const raw = JSON.parse(await readFile(new URL(`../../languages/${directory}/static/data/games/grammar-gravity/challenges.json`, import.meta.url), "utf8"));
    const pack = core.validateGrammarGravityPack(raw, { courseId: id });
    assert.equal(pack.challenges.length, expectedChallenges);
    assert.equal(core.buildGrammarGravityRounds(pack, 3).length, expectedExamples);
    for (const level of [1, 2, 3]) {
      const eligible = pack.challenges.filter(({ difficulty }) => difficulty <= level);
      const authored = new Map(eligible.flatMap((challenge) => pack.axes.flatMap((axis) => challenge.forms[axis.id].examples
        .map((example) => [example.id, { challenge, axis, form: challenge.forms[axis.id], example }]))));
      const rounds = core.buildGrammarGravityRounds(pack, level, () => 0.999);
      assert.deepEqual(rounds.map(({ id }) => id).sort(), [...authored.keys()].sort());
      for (const round of rounds) {
        const { challenge, axis, form, example } = authored.get(round.id);
        const [flight] = round.flights;
        assert.equal(round.revision, example.revision);
        assert.equal(round.challengeId, challenge.id);
        assert.equal(round.challengeRevision, challenge.revision);
        assert.deepEqual(flight.stages, ["meaning", "category", "form"]);
        assert.equal(flight.categoryId, axis.features[pack.gameplay.categoryFeature]);
        assert.equal(flight.anchorText, example.anchor.targetText);
        assert.equal(flight.anchorMeaning, example.anchor.learnerBaseText);
        assert.equal(flight.learnerBaseText, example.learnerBaseText);
        assert.equal(flight.answer, form.displayForm);
        assert.equal(flight.beforeText + flight.answer + flight.afterText, example.targetText);
        assert.ok(flight.meaningOptions.includes(flight.anchorMeaning));
        assert.ok(flight.options.length >= 2);
        assert.equal("matches" in round, false);
      }
    }
    if (id === "es") assert.ok(pack.challenges.some(({ focus }) => focus.kind === "determiner"));
    if (id === "es-en") assert.equal(pack.challenges.some(({ focus }) => focus.kind === "adjective"), false);
  });
}
