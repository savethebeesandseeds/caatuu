import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { validateSoundQuasarCatalog, createSoundQuasarSession } from "../static/source/games/sound-quasar/sound-quasar-core.mjs";
import { normalizeNounLandingPack, createNounLandingSession } from "../static/source/games/grammar-gravity/noun-landing-core.mjs";
import { buildGrammarGravityRounds } from "../static/source/games/grammar-gravity/grammar-gravity-core.mjs";
import { buildCasePracticeRounds } from "../../languages/czech/static/source/games/case-cosmos/case-cosmos-content.mjs";
import { selectConjugationPracticeVerbs } from "../static/source/games/conjugation-comet/conjugation-comet-core.mjs";
import { selectContentItems } from "../static/source/games/content-progression.mjs";

const read = async path => JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
const sound = await read("../../languages/spanish/static/data/games/sound-quasar/content.json");
const nouns = await read("../../languages/spanish/static/data/games/grammar-gravity/nouns.json");
const grammar = await read("../../languages/spanish/static/data/games/grammar-gravity/content.json");
const cases = await read("../../languages/czech/static/data/games/case-cosmos/content.json");
const random = () => 0.3;
const practiced = items => Object.fromEntries(items.map(item => [item.id, {
  exposures: 10, independentSuccesses: 2, lastCorrect: true,
  lastSeenAt: new Date(Date.now() - 60000).toISOString(), dueAt: new Date(Date.now() + 86400000).toISOString()
}]));

test("a complete conjugation board consumes form complexity and outstanding form review", () => {
  const verbs = Array.from({ length: 12 }, (_, index) => ({ id: `verb-${String(index).padStart(2, "0")}`,
    difficulty: 1, usefulness: 50, complexity: 1,
    forms: [{ id: "one", usefulness: 50, complexity: index < 6 ? 90 : 10 },
      { id: "two", usefulness: 100, complexity: 1 }] }));
  const first = selectConjugationPracticeVerbs(verbs, { difficulty: 1, random });
  assert.equal(first[0].forms[0].complexity, 10, "the whole board includes its hardest form");
  assert.ok(first.every(verb => verbs.includes(verb)), "selection returns original complete paradigms");
  const history = practiced(verbs);
  const formHistory = practiced(verbs.flatMap(verb => verb.forms.map(form => ({ id: `${verb.id}.${form.id}` }))));
  formHistory["verb-00.one"].dueAt = new Date(Date.now() - 86400000).toISOString();
  formHistory["verb-00.one"].lastSeenAt = new Date(Date.now() - 172800000).toISOString();
  formHistory["verb-00.one"].lastCorrect = false;
  const review = selectConjugationPracticeVerbs(verbs, { difficulty: 1, history, formHistory, random });
  assert.ok(review.some(verb => verb.id === "verb-00"), "a due form survives recent parent completion");
});

test("conjugation exploration counts separate practice days conservatively across every form", () => {
  const now = Date.parse("2026-09-11T12:00:00Z");
  const verbs = Array.from({ length: 5 }, (_, index) => ({ id: `practice-${index}`,
    difficulty: 1, usefulness: 50, complexity: index < 4 ? 1 : 60,
    forms: [{ id: "one", usefulness: 50, complexity: index < 4 ? 1 : 60 },
      { id: "two", usefulness: 50, complexity: 1 }] }));
  const progress = { exposures: 40, practiceDays: 8, lastPracticeDayAt: "2026-09-11T11:59:00Z",
    firstSeenAt: "2026-09-01T12:00:00Z", lastSeenAt: "2026-09-11T11:59:00Z",
    dueAt: "2026-09-12T12:00:00Z", independentSuccesses: 0, spacedSuccesses: 0, independentDays: 0 };
  const history = Object.fromEntries(verbs.slice(0, 4).map(verb => [verb.id, { ...progress }]));
  const formHistory = Object.fromEntries(verbs.slice(0, 4).flatMap(verb => verb.forms.map(form =>
    [`${verb.id}.${form.id}`, { ...progress }])));
  assert.ok(selectConjugationPracticeVerbs(verbs, { history, formHistory, now, random })
    .some(verb => verb.id === "practice-4"), "supported practice over days allows sparse-bank exploration");
  for (const verb of verbs.slice(0, 4)) formHistory[`${verb.id}.two`].practiceDays = 0;
  assert.ok(!selectConjugationPracticeVerbs(verbs, { history, formHistory, now, random })
    .some(verb => verb.id === "practice-4"), "parent practice cannot stand in for an unpracticed form");
});

test("listening keeps shared practice order and valid distinct distractors without recording queue construction", () => {
  const raw = structuredClone(sound);
  raw.items.forEach((item, index) => Object.assign(item,
    { difficulty: 1, usefulness: index < 6 ? 95 : 35, complexity: index < 6 ? 5 : 75 }));
  const catalog = validateSoundQuasarCatalog(raw);
  const history = practiced(catalog.items.slice(0, 2));
  const before = structuredClone(history);
  const expected = selectContentItems(catalog.items, { difficulty: 1, history, minimumPool: 4, random });
  const session = createSoundQuasarSession(catalog, { difficulty: 1, history, random, roundLength: 500 });
  assert.deepEqual(session.map(round => round.id), expected.map(item => item.id));
  const ids = new Set(expected.map(item => item.id));
  for (const round of session) {
    assert.ok(round.choices.every(choice => ids.has(choice.id)));
    assert.equal(new Set(round.choices.map(choice => choice.id)).size, round.choices.length);
  }
  assert.deepEqual(history, before);
});

test("noun practice preserves scheduler order and never borrows a higher badge", () => {
  const raw = structuredClone(nouns);
  raw.items.forEach((item, index) => Object.assign(item,
    { difficulty: index < 12 ? 1 : 3, usefulness: 90, complexity: index < 6 ? 10 : 65 }));
  const pack = normalizeNounLandingPack(raw, raw);
  const history = practiced(pack.items.slice(0, 2));
  const expected = selectContentItems(pack.items, { difficulty: 1, history, minimumPool: Math.max(4, pack.lanes.length), random });
  const session = createNounLandingSession(pack, { difficulty: 1, history, random, avoidFirstItemId: expected[0].id });
  const rows = [session.item, ...session.queue];
  assert.deepEqual(rows.map(item => item.id), expected.map(item => item.id));
  assert.ok(rows.every(item => item.difficulty === 1));
});

test("grammar concrete examples retain their own usefulness and complexity within the parent badge", () => {
  const raw = structuredClone(grammar);
  const family = raw.challenges[0];
  Object.assign(family, { usefulness: 20, complexity: 95 });
  const form = Object.values(family.forms)[0];
  Object.assign(form, { usefulness: 55, complexity: 60 });
  const example = form.examples[0];
  Object.assign(example, { usefulness: 98, complexity: 7 });
  const round = buildGrammarGravityRounds(raw, 3).find(item => item.id === example.id);
  assert.equal(round.usefulness, 98);
  assert.equal(round.complexity, 7);
  assert.equal(round.difficulty, family.difficulty);
});

test("case practice schedules stable sentence IDs with exactly one valid contrast form", () => {
  const rounds = buildCasePracticeRounds(cases, 1);
  assert.ok(rounds.length >= 4);
  assert.equal(new Set(rounds.map(item => item.id)).size, rounds.length);
  for (const round of rounds) {
    assert.equal(round.practiceQuestions.length, 1);
    assert.equal(round.practiceQuestions[0].candidates.filter(choice => choice.matches).length, 1);
    assert.ok(round.difficulty <= 1);
    assert.ok(Number.isInteger(round.usefulness) && Number.isInteger(round.complexity));
  }
});

test("explicit invalid 1–100 grading fails at game content boundaries", () => {
  for (const value of [0, 101, 2.5, "2", null]) {
    const listening = structuredClone(sound);
    listening.items[0].usefulness = value;
    assert.throws(() => validateSoundQuasarCatalog(listening), /usefulness/);
    const noun = structuredClone(nouns);
    noun.items[0].complexity = value;
    assert.throws(() => normalizeNounLandingPack(noun, noun), /complexity/);
  }
});
