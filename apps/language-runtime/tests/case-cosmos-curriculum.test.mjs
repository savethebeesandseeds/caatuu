import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { validatePack, buildRounds, buildQuestions } from "../../languages/czech/static/source/games/case-cosmos/case-cosmos-content.mjs";
import { CHECKED_CONTEXTS, CHECKED_PARADIGMS } from "../../languages/czech/static/source/games/case-cosmos/case-cosmos-cs-policy.mjs";

const catalog = JSON.parse(await readFile(new URL("../../languages/czech/static/data/games/case-cosmos/content.json", import.meta.url), "utf8"));
const checked = validatePack(catalog);
const change = (edit) => { const value = structuredClone(catalog); edit(value); return value; };

test("versioned Case pilot preserves the legacy API and exposes all declared objectives with distinct practice anchors", () => {
  assert.ok(Array.isArray(validatePack(catalog.legacyNouns)));
  assert.deepEqual(checked.legacyNouns, catalog.legacyNouns);
  assert.equal(checked.legacyNouns.length, 18);
  assert.equal(checked.legacyNouns.flatMap(({ cases }) => Object.values(cases)).length, 126);
  assert.equal(checked.contexts.length, 30);
  assert.equal(checked.paradigms.length, 22);
  assert.ok(Object.isFrozen(checked.contexts[0].acceptedForms));
  assert.ok(Object.isFrozen(CHECKED_CONTEXTS[checked.contexts[0].id]));
  assert.ok(Object.isFrozen(CHECKED_PARADIGMS[checked.paradigms[0].id].forms));
  assert.deepEqual(checked.curriculum.objectives.map(({ id, difficulty }) => [id, difficulty]), [
    ["cz.case.roles", 1], ["cz.case.absence", 1], ["cz.case.place", 2],
    ["cz.case.means", 2], ["cz.case.plural", 3], ["cz.case.address", 3]
  ]);
  for (const objective of checked.curriculum.objectives) {
    const rows = checked.contexts.filter(({ objectiveId }) => objectiveId === objective.id);
    const anchors = new Set(rows.filter(({ phase }) => phase === "practice").map(({ paradigmId }) => checked.paradigms.find(({ id }) => id === paradigmId).noun));
    assert.ok(anchors.size >= 3, objective.id);
    assert.ok(rows.some(({ phase }) => phase === "transfer"), objective.id);
  }
  const inanimate = checked.contexts.filter(({ paradigmId }) => /\.(?:stul|okno|kniha|skola|destnik)\./u.test(paradigmId));
  assert.ok(inanimate.length > 0);
  assert.ok(inanimate.every(({ case: name }) => name !== "Vocative"));
  assert.ok(checked.contexts.some(({ paradigmId }) => paradigmId.endsWith(".plural")));
});

test("checked authoring rejects wrong answers, false alternatives, number drift and substituted bilingual meanings", () => {
  const mutations = [
    value => { value.contexts[0].form = "knihu"; value.contexts[0].czech = "Knihu leží na stole."; },
    value => { value.contexts[1].english = "I am giving a book."; },
    value => { value.contexts[1].case = "Dative"; },
    value => { value.contexts[1].paradigmId = "cz.case.paradigm.kniha.plural"; },
    value => { value.contexts[1].phase = "transfer"; },
    value => { value.contexts[1].objectiveId = "cz.case.plural"; },
    value => { value.contexts[1].explanation = "Every moving action requires accusative."; },
    value => { value.contexts[0].matches = true; },
    value => { value.contexts.push(structuredClone(value.contexts[0])); },
    value => { value.paradigms[0].forms.push("unchecked"); },
    value => { value.paradigms[0].number = "plural"; },
    value => { value.paradigms.shift(); },
    value => { value.contexts = value.contexts.filter(item => item.phase !== "transfer"); },
    value => { value.contexts.find(item => item.id === "cz.case.place.table-location").acceptedForms = []; }
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
      if (round.id === "cz.case.place.table-location") {
        assert.ok(question.candidates.every(({ form, matches }) => form !== "stolu" || matches));
      }
    }
  }
  assert.equal(count, 150);
});

test("fixed case probes retain real preposition/role distinctions rather than a universal movement rule", () => {
  const byId = new Map(checked.contexts.map(item => [item.id, item]));
  for (const [id, text, name, form] of [
    ["cz.case.roles.read-book", "Čtu knihu.", "Accusative", "knihu"],
    ["cz.case.place.table-location", "Kniha je na stole.", "Locative", "stole"],
    ["cz.case.place.table-destination", "Pokládám knihu na stůl.", "Accusative", "stůl"],
    ["cz.case.absence.without-umbrella", "Jdu bez deštníku.", "Genitive", "deštníku"],
    ["cz.case.means.write-pencil", "Píšu tužkou.", "Instrumental", "tužkou"],
    ["cz.case.place.school-destination", "Jdeme do školy.", "Genitive", "školy"],
    ["cz.case.place.running-in-park", "Běhám v parku.", "Locative", "parku"]
  ]) {
    const item = byId.get(id);
    assert.deepEqual([item.czech, item.case, item.form], [text, name, form]);
  }
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
