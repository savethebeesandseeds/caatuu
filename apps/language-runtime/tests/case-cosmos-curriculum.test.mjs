import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { validatePack, buildRounds, buildQuestions } from "../../languages/czech/static/source/games/case-cosmos/case-cosmos-content.mjs";

const catalog = JSON.parse(await readFile(new URL("../../languages/czech/static/data/games/case-cosmos/content.json", import.meta.url), "utf8"));
const checked = validatePack(catalog);
const change = (edit) => { const value = structuredClone(catalog); edit(value); return value; };

test("versioned Case content preserves the legacy API and exposes declared objectives with distinct practice anchors", () => {
  assert.ok(Array.isArray(validatePack(catalog.legacyNouns)));
  assert.deepEqual(checked.legacyNouns, catalog.legacyNouns);
  assert.deepEqual(checked.contexts, catalog.contexts);
  assert.deepEqual(checked.paradigms, catalog.paradigms);
  assert.ok(Object.isFrozen(checked.contexts[0].acceptedForms));
  assert.ok(Object.isFrozen(checked.contexts[0]));
  assert.ok(Object.isFrozen(checked.paradigms[0].forms));
  assert.deepEqual(checked.curriculum, catalog.curriculum);
  for (const objective of checked.curriculum.objectives) {
    const rows = checked.contexts.filter(({ objectiveId }) => objectiveId === objective.id);
    const anchors = new Set(rows.filter(({ phase }) => phase === "practice").map(({ paradigmId }) => checked.paradigms.find(({ id }) => id === paradigmId).noun));
    assert.ok(anchors.size >= 3, objective.id);
    assert.ok(rows.some(({ phase }) => phase === "transfer"), objective.id);
  }
});

test("content validation rejects broken references, invalid structure and unsolvable form pools", () => {
  const mutations = [
    value => { value.contexts[0].form = "missing"; value.contexts[0].czech = "Missing leží na stole."; },
    value => { value.contexts[1].english = ""; },
    value => { value.contexts[1].case = "Unknown"; },
    value => { value.contexts[1].paradigmId = "unknown"; },
    value => { value.contexts[1].phase = "unknown"; },
    value => { value.contexts[1].objectiveId = "unknown"; },
    value => { value.contexts[1].explanation = "<b>Markup</b>"; },
    value => { value.contexts[1].difficulty = 4; },
    value => { value.contexts[1].revision = 0; },
    value => { value.contexts[1].id = "Invalid ID"; },
    value => { value.contexts[1].acceptedForms = null; },
    value => { value.contexts[1].acceptedForms = [value.contexts[1].form]; },
    value => { const item = value.contexts[1]; const paradigm = value.paradigms.find(row => row.id === item.paradigmId); item.acceptedForms = paradigm.forms.filter(form => form !== item.form); },
    value => { value.contexts[0].matches = true; },
    value => { value.contexts.push(structuredClone(value.contexts[0])); },
    value => { value.paradigms[0].forms.push(value.paradigms[0].forms[0]); },
    value => { value.paradigms[0].forms = []; },
    value => { value.paradigms[0].forms.push("two words"); },
    value => { value.paradigms[0].number = "unknown"; },
    value => { value.paradigms.shift(); },
    value => { value.contexts = value.contexts.filter(item => item.phase !== "transfer"); }
  ];
  for (const mutation of mutations) assert.throws(() => validatePack(change(mutation)), undefined, mutation.toString());
});

test("all new contexts produce exactly one correct answer while retaining only authored sentence boundaries", () => {
  let count = 0;
  for (const round of buildRounds(catalog, 3).filter(({ contextItem }) => contextItem)) {
    for (const sample of [0, 0.2, 0.49, 0.8, 0.999]) {
      const [question] = buildQuestions(round, () => sample);
      count += 1;
      const accepted = new Set([round.form, ...round.acceptedForms]);
      assert.equal(question.id, round.id);
      assert.equal(question.candidates.filter(({ matches }) => matches).length, 1);
      assert.equal(new Set(question.candidates.map(({ form }) => form)).size, question.candidates.length);
      for (const candidate of question.candidates) {
        assert.equal(candidate.matches, accepted.has(candidate.form));
        assert.ok(round.formPool.includes(candidate.form));
        assert.equal(candidate.english, question.english);
        assert.equal(candidate.czech.slice(0, candidate.target.start), question.czech.slice(0, question.target.start));
        assert.equal(candidate.czech.slice(candidate.target.end), question.czech.slice(question.target.end));
      }
      assert.ok(question.candidates.every(({ form, matches }) => !round.acceptedForms.includes(form) || matches));
    }
  }
  assert.equal(count, catalog.contexts.length * 5);
});

test("new paradigms, context IDs and revised teaching text come only from JSON", () => {
  const expanded = structuredClone(catalog);
  const paradigm = { id: "cz.case.paradigm.mesto.singular", noun: "město", number: "singular",
    forms: ["město", "města", "městu", "městě", "městem"] };
  const item = { ...expanded.contexts.find(row => row.case === "Nominative"),
    id: "cz.case.roles.riverside-city", paradigmId: paradigm.id, form: "město", acceptedForms: [],
    czech: "Město leží u řeky.", english: "The city lies by the river.",
    context: "Describe the location of a city.", explanation: "Město is the subject of leží." };
  expanded.paradigms.push(paradigm);
  expanded.contexts.push(item);
  const round = buildRounds(expanded, item.difficulty).find(row => row.id === item.id);
  const [question] = buildQuestions(round, () => 0.3);
  assert.equal(question.czech, item.czech);
  assert.equal(question.english, item.english);
  assert.equal(question.explanation, item.explanation);
  assert.equal(question.candidates.filter(row => row.matches).length, 1);
  item.revision += 1;
  item.english = "The city is located by the river.";
  assert.equal(validatePack(expanded).contexts.at(-1).english, item.english);
});

test("existing seven-case noun rounds remain first and every added context is reachable at its level", () => {
  for (const level of [1, 2, 3]) {
    const rounds = buildRounds(catalog, level);
    const original = buildRounds(catalog.legacyNouns, level);
    assert.deepEqual(rounds.slice(0, original.length), original);
    assert.ok(original.every(round => buildQuestions(round).length === 7));
    assert.deepEqual(rounds.slice(original.length).map(round => round.id),
      catalog.contexts.filter(item => item.difficulty <= level).map(item => item.id));
  }
});
