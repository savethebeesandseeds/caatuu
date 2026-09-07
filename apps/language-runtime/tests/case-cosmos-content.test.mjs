import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { CZECH_CASES, CASE_CONTRASTS, validatePack, targetSpan, buildRounds, buildQuestions }
  from "../../languages/czech/static/source/games/case-cosmos/case-cosmos-content.mjs";
import { assertEnglishCzechCourse, NOUN_POLICY, CONTEXT_POLICY }
  from "../../languages/czech/static/source/games/case-cosmos/case-cosmos-cs-policy.mjs";

const root = new URL("../../languages/czech/", import.meta.url);
const catalog = JSON.parse(await readFile(new URL("static/data/games/case-cosmos/content.json", root), "utf8"));
const pack = catalog.legacyNouns;
const change = (edit) => { const candidate = structuredClone(pack); edit(candidate); return candidate; };

test("all 126 authored pairs satisfy the bounded noun, form, context, and English policy", () => {
  const validated = validatePack(pack);
  assert.equal(validated.length, 18);
  assert.equal(validated.flatMap((entry) => Object.values(entry.cases)).length, 126);
  assert.deepEqual(new Set(validated.map(({ noun }) => noun)), new Set(Object.keys(NOUN_POLICY)));
  assert.ok(Object.isFrozen(validated));
  assert.ok(Object.isFrozen(validated[0].cases.Dative));
  assert.notEqual(validated, pack, "runtime receives a frozen copy, not mutable fetch data");
});

test("target selection uses one complete Unicode word and preserves the source offsets", () => {
  for (const [sentence, form, visible] of [["Petr čte.", "Petr", "Petr"], ["Kotě spí.", "kotě", "Kotě"],
    ["Paní učitelko, prosím, podívejte se!", "učitelko", "učitelko"], ["Jdu s Marií.", "Marií", "Marií"]]) {
    const span = targetSpan(sentence, form);
    assert.equal(sentence.slice(span.start, span.end), visible);
  }
  for (const sentence of ["Petra čte.", "Petr Petr čte.", "Petr-Pavel čte.", "Petr2 čte.", "_Petr čte.", "Petr’s book."]) {
    assert.throws(() => targetSpan(sentence, "Petr"), /exactly one whole-word/u);
  }
  assert.throws(() => targetSpan("Kotě spí.".normalize("NFD"), "kotě"), /normalized/u);
});

test("bad forms, switched roles, mismatched translations, and unseen constructions are rejected", () => {
  const mutations = [
    (p) => { p[0].cases.Dative.form = "Petra"; p[0].cases.Dative.czech = "Dávám Petra knihu."; },
    (p) => { [p[0].cases.Dative, p[0].cases.Locative] = [p[0].cases.Locative, p[0].cases.Dative]; },
    (p) => { p[0].cases.Dative.english = "I see Petr."; },
    (p) => { p[0].cases.Dative.czech = "Petr Petrovi."; },
    (p) => { p[0].cases.Nominative.czech = "Petr Petr čte."; },
    (p) => { p[0].cases.Nominative.czech = "Petra čte."; },
    (p) => { p[0].cases.Dative.english += "\u202e"; },
    (p) => { p[0].cases.Dative.english = "<b>I am giving Petr a book.</b>"; },
    (p) => { p[0].noun = "Unchecked"; },
    (p) => { p[0].cases.Instrumental.czech = "Jdu se Petrem."; },
    (p) => { p[0].cases.Vocative.czech = "Paní Petře, prosím, podívejte se!"; },
    (p) => { delete p[0].cases.Genitive; },
    (p) => { p.push(structuredClone(p[0])); },
    (p) => { p[0].difficulty = 0; },
    (p) => { p[0].cases.Dative.matches = true; }
  ];
  for (const mutate of mutations) assert.throws(() => validatePack(change(mutate)), undefined, mutate.toString());
});

test("JSON field order is immaterial and no bank-size constant permits unreviewed nouns", () => {
  const reordered = pack.map(({ noun, difficulty, cases }) => ({ cases: Object.fromEntries(Object.entries(cases).reverse()
    .map(([name, { form, english, czech }]) => [name, { czech, form, english }])), difficulty, noun }));
  assert.deepEqual(validatePack(reordered), validatePack(pack));
  assert.throws(() => validatePack([]));
  assert.throws(() => validatePack(pack.filter(({ difficulty }) => difficulty === 1)), /three difficulty/u);
  assert.throws(() => buildRounds(pack, 4), /difficulty/u);
});

test("12,600 sentence challenges change only the noun, keep one true form, and never mislabel syncretism", () => {
  let state = 719;
  const random = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296);
  const correctPositions = new Set();
  let total = 0;
  for (const round of buildRounds(pack, 3)) {
    const original = JSON.stringify(round);
    for (let iteration = 0; iteration < 100; iteration += 1) {
      const challenges = buildQuestions(round, random);
      assert.equal(new Set(challenges.map(({ case: name }) => name)).size, 7);
      for (const challenge of challenges) {
        total += 1;
        const authored = round.matches.find((entry) => entry.case === challenge.case);
        for (const field of ["czech", "english", "form"]) assert.equal(challenge[field], authored[field]);
        assert.ok(Object.isFrozen(challenge));
        assert.ok(Object.isFrozen(challenge.candidates));
        assert.equal(new Set(challenge.candidates.map((entry) => entry.form)).size, challenge.candidates.length);
        assert.ok(challenge.candidates.length >= 2 && challenge.candidates.length <= 4);
        assert.equal(challenge.candidates.filter((entry) => entry.matches).length, 1);
        correctPositions.add(challenge.candidates.findIndex((entry) => entry.matches));
        for (const candidate of challenge.candidates) {
          assert.ok(Object.isFrozen(candidate));
          assert.ok(NOUN_POLICY[round.noun].forms.includes(candidate.form));
          assert.equal(candidate.case, challenge.case);
          assert.equal(candidate.english, authored.english);
          assert.equal(candidate.matches, candidate.form === authored.form);
          assert.equal(candidate.czech.slice(0, candidate.target.start), authored.czech.slice(0, challenge.target.start));
          assert.equal(candidate.czech.slice(candidate.target.end), authored.czech.slice(challenge.target.end));
          assert.equal(candidate.czech.slice(candidate.target.start, candidate.target.end).toLocaleLowerCase("cs-CZ"), candidate.form.toLocaleLowerCase("cs-CZ"));
          if (candidate.matches) assert.equal(candidate.czech, authored.czech);
          else assert.notEqual(candidate.czech, authored.czech);
        }
      }
    }
    assert.equal(JSON.stringify(round), original);
  }
  assert.equal(total, 12600);
  assert.deepEqual([...correctPositions].sort(), [0, 1, 2, 3], "the correct answer is not predictably last");
  for (const { case: name } of CZECH_CASES) {
    for (const alternative of CASE_CONTRASTS[name]) {
      assert.notEqual(alternative, name);
      assert.ok(CZECH_CASES.some((entry) => entry.case === alternative));
    }
  }
});

test("bad random sources and malformed rounds cannot produce a mislabeled answer", () => {
  const round = buildRounds(pack, 3)[0];
  for (const value of [-0.1, 1, NaN, Infinity, "0.5"]) assert.throws(() => buildQuestions(round, () => value), /randomness/u);
  assert.throws(() => buildQuestions({ matches: [] }), /exactly one/u);
  assert.throws(() => buildQuestions({ matches: Array(7).fill(round.matches[0]) }), /exactly one/u);
  const corrupted = structuredClone(round);
  corrupted.matches[2].english = "I see Petr.";
  assert.throws(() => buildQuestions(corrupted), /translation/u);
});

test("all policies and course scope remain bounded to English -> Czech", () => {
  const course = { id: "cz", sourceLanguage: { id: "en", locale: "en" }, targetLanguage: { id: "cs", locale: "cs-CZ" } };
  assert.doesNotThrow(() => assertEnglishCzechCourse(course));
  for (const candidate of [null, { ...course, id: "es-en" }, { ...course, sourceLanguage: { id: "es", locale: "es" } },
    { ...course, targetLanguage: { id: "en", locale: "en-US" } }]) assert.throws(() => assertEnglishCzechCourse(candidate));
  assert.ok(Object.isFrozen(NOUN_POLICY));
  assert.ok(Object.isFrozen(CONTEXT_POLICY.Dative[0]));
});

test("data and policy versions are included in browser/offline and Android packages", async () => {
  const [course, setup, android, controller, content, profile, sw] = await Promise.all([
    readFile(new URL("course.json", root), "utf8").then(JSON.parse),
    readFile(new URL("static/setup-assets.json", root), "utf8").then(JSON.parse),
    readFile(new URL("android-assets.json", root), "utf8").then(JSON.parse),
    readFile(new URL("static/source/games/case-cosmos/case-cosmos.js", root), "utf8"),
    readFile(new URL("static/source/games/case-cosmos/case-cosmos-content.mjs", root), "utf8"),
    readFile(new URL("static/source/shared/course-profile.js", root), "utf8"),
    readFile(new URL("static/sw.js", root), "utf8")
  ]);
  const dataUrl = `data/games/case-cosmos/content.json?v=${course.resources.caseCosmosCatalog.revision}`;
  assert.ok(controller.includes(`"${dataUrl}"`));
  assert.ok(profile.includes(`"${dataUrl}"`));
  assert.ok(setup.offline.assets.includes(`./${dataUrl}`));
  assert.ok(sw.includes(`Offline catalog revision: ${setup.offline.cacheName}`));
  for (const file of ["case-cosmos-content.mjs", "case-cosmos-cs-policy.mjs"]) {
    const importUrl = `${controller}\n${content}`.match(new RegExp(`${file.replaceAll(".", "\\.")}\\?v=([^\"]+)`, "u"));
    assert.ok(importUrl, `${file} must have a versioned import`);
    const version = importUrl[1];
    const relative = `source/games/case-cosmos/${file}`;
    assert.ok(android.files.includes(relative));
    assert.ok(setup.offline.assets.includes(`./${relative}?v=${version}`));
    assert.ok(`${controller}\n${content}`.includes(`${file}?v=${version}`));
  }
});
