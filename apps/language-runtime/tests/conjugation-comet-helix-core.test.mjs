import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildConjugationHelixRound,
  judgeConjugationHelixPair,
  judgeConjugationHelixRound,
  splitConjugationDisplay,
  validateConjugationCometCatalog
} from "../static/source/games/conjugation-comet/conjugation-comet-core.mjs";

const rawCzech = JSON.parse(await readFile(new URL(
  "../../languages/czech/static/data/games/conjugation-comet/content.json", import.meta.url
), "utf8"));
const rawSpanish = JSON.parse(await readFile(new URL(
  "../../languages/spanish/static/data/games/conjugation-comet/content.json", import.meta.url
), "utf8"));
const czechAuthority = {
  expectedCourseId: "cz", expectedTargetLanguageId: "cs",
  expectedLearnerBaseLanguageId: "en", expectedTargetLocale: "cs-CZ"
};
const czech = validateConjugationCometCatalog(rawCzech, czechAuthority);
const spanish = validateConjugationCometCatalog(rawSpanish);

function random(seed = 1) {
  let value = seed;
  return () => {
    value = (Math.imul(1664525, value) + 1013904223) >>> 0;
    return value / 0x100000000;
  };
}

function synthetic(forms) {
  return { id: "test-catalog", contentRevision: 1, verbs: [{
    id: "test-verb", tags: ["synthetic"],
    forms: forms.map((form, index) => ({
      id: `form-${index}`, subjectBaseText: `subject-${index}`,
      learnerBaseCueText: `base phrase-${index}`, acceptedTargetTexts: [],
      ...(typeof form === "string" ? { targetText: form } : form)
    }))
  }] };
}

function normalized(value) {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
}

test("every Czech and Spanish subject retains its authored answer and accepted equivalents", () => {
  for (const catalog of [czech, spanish]) for (const verb of catalog.verbs) {
    const round = buildConjugationHelixRound(catalog, verb.id, { rng: random(8) });
    assert.equal(round.subjects.length, verb.forms.length);
    assert.equal(new Set(round.subjects.map((subject) => subject.id)).size, verb.forms.length);
    assert.equal(new Set(round.options.map((option) => option.id)).size, round.options.length);
    assert.equal(round.options.length, verb.forms.length);
    assert.deepEqual(round.options.map((option) => option.text).sort(), verb.forms.map((form) => form.targetText).sort());
    for (const subject of round.subjects) {
      const form = verb.forms.find((item) => item.id === subject.id);
      assert.equal(subject.learnerBaseText, form.learnerBaseCueText);
      assert.equal(subject.correctText, form.targetText);
      assert.equal(subject.correctFormText, form.targetText);
      assert.deepEqual(subject.acceptedTargetTexts, form.acceptedTargetTexts);
      const accepted = [form.targetText, ...form.acceptedTargetTexts].map(normalized);
      assert.ok(round.options.some((option) => judgeConjugationHelixPair(round, subject.id, option.id)));
      for (const option of round.options) {
        assert.equal(judgeConjugationHelixPair(round, subject.id, option.id), accepted.includes(normalized(option.text)));
      }
    }
    assert.ok(round.options.some((_, offset) => judgeConjugationHelixRound(round, 0, offset).correct));
  }
});

test("only the English-base legacy adapter maps its explicit person labels to subject names", () => {
  assert.deepEqual(czech.verbs[0].forms.map((form) => form.subjectBaseText), [
    "I", "you", "he or she", "we", "you all", "they"
  ]);
  const raw = structuredClone(rawCzech);
  raw.verbs[0].forms[0].subjectBaseText = "  authored subject  ";
  raw.verbs[0].forms[1].label = "custom-person";
  const catalog = validateConjugationCometCatalog(raw, czechAuthority);
  assert.equal(catalog.verbs[0].forms[0].subjectBaseText, "authored subject");
  assert.equal(catalog.verbs[0].forms[1].subjectBaseText, raw.verbs[0].forms[1].cue);
  assert.throws(() => validateConjugationCometCatalog(rawCzech, {
    ...czechAuthority, expectedLearnerBaseLanguageId: "de"
  }), { code: "CONJUGATION_COMET_LEGACY_SCOPE_INVALID" });
});

test("v1 subject labels come from authored learner-base fields, never English audit or person IDs", () => {
  const raw = structuredClone(rawSpanish);
  raw.learnerBaseLanguageId = "de";
  raw.verbs.forEach((verb) => verb.forms.forEach((form) => { delete form.subjectBaseText; }));
  raw.verbs[0].forms[0].subjectBaseText = "  ich  ";
  raw.verbs[0].forms[0].learnerBaseCueText = "ich spreche";
  raw.verbs[0].forms[1].id = "S2".toLowerCase();
  raw.verbs[0].forms[1].learnerBaseCueText = "du sprichst";
  const catalog = validateConjugationCometCatalog(raw);
  assert.equal(catalog.verbs[0].forms[0].subjectBaseText, "ich");
  assert.equal(catalog.verbs[0].forms[1].subjectBaseText, "du sprichst");
  assert.equal(catalog.verbs[0].forms[0].englishAuditText, rawSpanish.verbs[0].forms[0].englishAuditText);
});

test("Spanish authored subject labels preserve person, number, and the informal/formal distinction", () => {
  const subjects = {
    "first-singular": "I",
    "second-singular-informal": "you (informal)",
    "third-singular-formal": "he/she/you (formal)",
    "first-plural": "we",
    "second-plural-informal-spain": "you all (informal)",
    "third-plural-formal": "they/you all (formal)"
  };
  for (const verb of spanish.verbs) for (const form of verb.forms) {
    assert.equal(form.subjectBaseText, subjects[form.id]);
    assert.ok(form.learnerBaseCueText.length > form.subjectBaseText.length || form.learnerBaseCueText !== form.subjectBaseText);
  }
});

test("both strands start rotated within a shared shuffled cycle while stable IDs keep the same meanings", () => {
  const catalog = synthetic(["one", "two", "three", "four", "five", "six"]);
  const subjectOrders = new Set();
  const optionOrders = new Set();
  let differingOrders = 0;
  for (let seed = 1; seed <= 20; seed += 1) {
    const round = buildConjugationHelixRound(catalog, "test-verb", { rng: random(seed) });
    subjectOrders.add(round.subjects.map((subject) => subject.id).join(","));
    optionOrders.add(round.options.map((option) => option.id).join(","));
    if (round.subjects.some((subject, index) => !judgeConjugationHelixPair(round, subject.id, round.options[index].id))) differingOrders += 1;
    assert.equal(round.options.find((option) => option.id === "option-1").text, "one");
    assert.equal(judgeConjugationHelixRound(round).correct, false);
  }
  assert.ok(subjectOrders.size > 1);
  assert.ok(optionOrders.size > 1);
  assert.ok(differingOrders > 0);
  assert.deepEqual(
    buildConjugationHelixRound(catalog, "test-verb", { rng: random(4) }),
    buildConjugationHelixRound(catalog, "test-verb", { rng: random(4) })
  );
});

test("pair correctness depends on the selected texts rather than IDs or strand position", () => {
  const round = buildConjugationHelixRound(synthetic(["one", "two"]), "test-verb", { rng: random() });
  const reordered = { ...round, subjects: [...round.subjects].reverse(), options: [...round.options].reverse() };
  assert.equal(judgeConjugationHelixPair(reordered, "form-0", "option-1"), true);
  assert.equal(judgeConjugationHelixPair(reordered, "form-0", "option-2"), false);
  const relabelled = {
    ...round,
    subjects: [{ ...round.subjects.find((subject) => subject.id === "form-0"), id: "same-id" }],
    options: [{ id: "same-id", text: "two" }, { id: "other-id", text: "one" }]
  };
  assert.equal(judgeConjugationHelixPair(relabelled, "same-id", "same-id"), false);
  assert.equal(judgeConjugationHelixPair(relabelled, "same-id", "other-id"), true);
});

test("syncretic target rows are retained and accepted variants still grade by text", () => {
  const round = buildConjugationHelixRound(synthetic([
    { targetText: "same", acceptedTargetTexts: ["alternate"] },
    "same", "alternate", "different"
  ]), "test-verb", { rng: random() });
  assert.equal(round.subjects.length, 4);
  assert.equal(round.options.length, 4);
  assert.equal(round.options.filter((option) => option.text === "same").length, 2);
  const same = round.options.find((option) => option.text === "same");
  const alternate = round.options.find((option) => option.text === "alternate");
  assert.equal(judgeConjugationHelixPair(round, "form-0", same.id), true);
  assert.equal(judgeConjugationHelixPair(round, "form-1", same.id), true);
  assert.equal(judgeConjugationHelixPair(round, "form-0", alternate.id), true);
  assert.equal(judgeConjugationHelixPair(round, "form-1", alternate.id), false);
});

test("NFC equivalents, case and spacing match without discarding meaningful accents or particles", () => {
  const round = buildConjugationHelixRound(synthetic([
    "dívám se", "DI\u0301VA\u0301M\tSE", "divám se", "dívám si"
  ]), "test-verb", { rng: random() });
  assert.equal(round.options.length, 4);
  const same = round.options.find((option) => option.text === "dívám se");
  assert.equal(judgeConjugationHelixPair(round, "form-0", same.id), true);
  assert.equal(judgeConjugationHelixPair(round, "form-1", same.id), true);
  assert.equal(judgeConjugationHelixPair(round, "form-2", same.id), false);
  assert.equal(judgeConjugationHelixPair(round, "form-3", same.id), false);
});

test("phrase frames remain authored context while pairing uses the whole conjugation option", () => {
  const round = buildConjugationHelixRound(synthetic([
    { targetText: "first form", targetPhraseFrame: { beforeText: "before\t", afterText: " — after." } },
    "second form"
  ]), "test-verb", { rng: random() });
  const subject = round.subjects.find((item) => item.id === "form-0");
  assert.equal(subject.beforeText, "before ");
  assert.equal(subject.afterText, " — after.");
  assert.equal(subject.correctText, "before first form — after.");
  assert.equal(subject.correctFormText, "first form");
  assert.equal(judgeConjugationHelixPair(round, subject.id, "option-1"), true);
});

test("helix rounds are deeply frozen without freezing or changing their source catalog", () => {
  const catalog = synthetic([{ targetText: "one", acceptedTargetTexts: ["alternate"] }, "two"]);
  const before = structuredClone(catalog);
  const round = buildConjugationHelixRound(catalog, "test-verb", { rng: random() });
  assert.deepEqual(catalog, before);
  assert.ok(Object.isFrozen(round));
  assert.ok(Object.isFrozen(round.verb.forms));
  assert.ok(Object.isFrozen(round.subjects[0].acceptedTargetTexts));
  assert.ok(Object.isFrozen(round.options[0]));
  assert.throws(() => { round.options[0].text = "changed"; }, TypeError);
  assert.equal(Object.isFrozen(catalog.verbs[0]), false);
  catalog.verbs[0].forms[0].acceptedTargetTexts.push("later source edit");
  assert.ok(round.subjects.every((subject) => !subject.acceptedTargetTexts.includes("later source edit")));
});

test("unknown verbs and invalid pair IDs cannot produce a match", () => {
  assert.throws(() => buildConjugationHelixRound(czech, "missing"), {
    code: "CONJUGATION_COMET_ROUND_INVALID"
  });
  const round = buildConjugationHelixRound(czech, czech.verbs[0].id, { rng: random() });
  for (const [subjectId, optionId] of [["missing", "option-1"], [round.subjects[0].id, "missing"], [null, null], [0, 0], ["", ""]]) {
    assert.equal(judgeConjugationHelixPair(round, subjectId, optionId), false);
  }
  assert.equal(judgeConjugationHelixPair(null, "form-0", "option-1"), false);
});

test("every generated size from two to twelve is solvable by rotating whole strands across seeds", () => {
  for (let size = 2; size <= 12; size += 1) {
    const catalog = synthetic(Array.from({ length: size }, (_, index) => `distinct-form-${index}`));
    for (let seed = 1; seed <= 40; seed += 1) {
      const round = buildConjugationHelixRound(catalog, "test-verb", { rng: random(seed) });
      assert.equal(judgeConjugationHelixRound(round).correct, false, `${size} rows, seed ${seed}: initial alignment`);
      for (let subjectOffset = 0; subjectOffset < size; subjectOffset += 1) {
        const solutions = round.options.filter((_, targetOffset) => (
          judgeConjugationHelixRound(round, subjectOffset, targetOffset).correct
        ));
        assert.equal(solutions.length, 1, `${size} rows, seed ${seed}, subject offset ${subjectOffset}`);
      }
    }
  }
});

test("bounded random values cannot make a distinct-form helix solved initially or impossible", () => {
  const catalog = synthetic(["one", "two", "three", "four"]);
  for (const value of [0, 1, -1, NaN, Infinity, 0.99999999]) {
    const round = buildConjugationHelixRound(catalog, "test-verb", { rng: () => value });
    assert.equal(judgeConjugationHelixRound(round).correct, false);
    assert.ok(round.options.some((_, offset) => judgeConjugationHelixRound(round, 0, offset).correct));
  }
});

test("duplicate and accepted forms allow every valid solution without forcing a false unsolved state", () => {
  const catalogs = [
    synthetic(["same", "same", "other", "other"]),
    synthetic([
      { targetText: "one", acceptedTargetTexts: ["two"] },
      { targetText: "two", acceptedTargetTexts: ["one"] }, "three", "three"
    ]),
    synthetic(["same", "same", "same"]),
    synthetic([
      { targetText: "one", acceptedTargetTexts: ["two", "three"] },
      { targetText: "two", acceptedTargetTexts: ["one", "three"] },
      { targetText: "three", acceptedTargetTexts: ["one", "two"] }
    ])
  ];
  for (const catalog of catalogs) for (let seed = 1; seed <= 30; seed += 1) {
    const round = buildConjugationHelixRound(catalog, "test-verb", { rng: random(seed) });
    const alignments = round.options.map((_, offset) => judgeConjugationHelixRound(round, 0, offset));
    assert.ok(alignments.some((result) => result.correct), "some complete alignment must remain valid");
    assert.equal(judgeConjugationHelixRound(round).correct, alignments.every((result) => result.correct));
  }
});

test("whole-helix submission requires every row, even when the first pair or most pairs are correct", () => {
  const round = {
    subjects: ["one", "two", "three", "four"].map((text, index) => ({ id: `subject-${index}`, correctFormText: text })),
    options: ["one", "two", "three", "wrong"].map((text, index) => ({ id: `option-${index}`, text }))
  };
  const result = judgeConjugationHelixRound(round);
  assert.deepEqual(result, {
    correct: false, matched: 3, total: 4,
    pairs: [true, true, true, false].map((correct, index) => ({ subjectId: `subject-${index}`, optionId: `option-${index}`, correct }))
  });
  const justFirst = { ...round, options: ["one", "three", "four", "two"].map((text, index) => ({ id: `option-${index}`, text })) };
  assert.equal(judgeConjugationHelixRound(justFirst).matched, 1);
  assert.equal(judgeConjugationHelixRound(justFirst).correct, false);
  round.options[3].text = "four";
  assert.equal(judgeConjugationHelixRound(round).correct, true);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.pairs));
  assert.ok(Object.isFrozen(result.pairs[0]));
});

test("whole-helix grading follows displayed row order and wraps signed integer offsets", () => {
  const round = buildConjugationHelixRound(synthetic(["one", "two", "three", "four"]), "test-verb", { rng: random(3) });
  const before = structuredClone(round);
  const result = judgeConjugationHelixRound(round, -1, 6);
  assert.deepEqual(result.pairs, Array.from({ length: 4 }, (_, row) => ({
    subjectId: round.subjects[(row + 3) % 4].id,
    optionId: round.options[(row + 2) % 4].id,
    correct: judgeConjugationHelixPair(round, round.subjects[(row + 3) % 4].id, round.options[(row + 2) % 4].id)
  })));
  assert.deepEqual(judgeConjugationHelixRound(round, Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER),
    judgeConjugationHelixRound(round, Number.MAX_SAFE_INTEGER % 4, Number.MIN_SAFE_INTEGER % 4));
  assert.deepEqual(round, before);
});

test("malformed strands and invalid offsets safely return an unsuccessful empty verdict", () => {
  const round = buildConjugationHelixRound(synthetic(["one", "two"]), "test-verb", { rng: random() });
  const invalid = { correct: false, matched: 0, total: 0, pairs: [] };
  for (const value of [1.5, "1", null, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, 1n]) {
    assert.deepEqual(judgeConjugationHelixRound(round, value, 0), invalid);
    assert.deepEqual(judgeConjugationHelixRound(round, 0, value), invalid);
  }
  for (const malformed of [
    null, {}, { subjects: [], options: [] },
    { ...round, options: round.options.slice(1) },
    { ...round, options: [{ id: "duplicate", text: "one" }, { id: "duplicate", text: "two" }] },
    { ...round, subjects: [round.subjects[0], round.subjects[0]] },
    { ...round, subjects: [null, round.subjects[1]] },
    { ...round, subjects: new Array(2) },
    { ...round, options: [undefined, round.options[1]] },
    { ...round, options: [{ id: "empty", text: " " }, round.options[1]] },
    { ...round, subjects: [{ ...round.subjects[0], acceptedTargetTexts: "not an array" }, round.subjects[1]] },
    { ...round, subjects: [{ ...round.subjects[0], acceptedTargetTexts: [null] }, round.subjects[1]] }
  ]) assert.deepEqual(judgeConjugationHelixRound(malformed), invalid);
  for (const count of [0, 1, 13]) assert.throws(() => buildConjugationHelixRound(
    synthetic(Array.from({ length: count }, (_, index) => `form-${index}`)), "test-verb"
  ), { code: "CONJUGATION_COMET_ROUND_INVALID" });
});

test("malformed phrase frames are rejected at catalog normalization", () => {
  for (const frame of [null, "text", [], { beforeText: 3 }, { afterText: "x".repeat(321) }]) {
    const raw = structuredClone(rawCzech);
    raw.verbs[0].forms[0].targetPhraseFrame = frame;
    assert.throws(() => validateConjugationCometCatalog(raw, czechAuthority), {
      code: "CONJUGATION_COMET_CONTENT_INVALID"
    });
  }
});

test("orthographic highlighting preserves the complete Czech form and its accents", () => {
  const parts = splitConjugationDisplay("ukážeme", ["ukážu", "ukážeš", "ukáže", "ukážeme", "ukážete", "ukážou"]);
  assert.deepEqual(parts, { beforeText: "", commonText: "ukáž", differingText: "eme", afterText: "" });
  assert.equal(Object.values(parts).join(""), "ukážeme");
  assert.ok(Object.isFrozen(parts));
});

test("highlighting a varying word retains reflexive particles and unchanged auxiliary context", () => {
  assert.deepEqual(splitConjugationDisplay("díváme se", ["dívám se", "díváš se", "díváme se"]), {
    beforeText: "", commonText: "dívá", differingText: "me", afterText: " se"
  });
  assert.deepEqual(splitConjugationDisplay("se díváme", ["se dívám", "se díváš", "se díváme"]), {
    beforeText: "se ", commonText: "dívá", differingText: "me", afterText: ""
  });
});

test("irregular or multiword changes retain whole forms instead of inventing a stem", () => {
  for (const [display, options] of [
    ["jsem", ["jsem", "jsi", "je", "jsme", "jste", "jsou"]],
    ["me levanto", ["me levanto", "te levantas", "se levanta"]],
    ["first word", ["first word", "different"]],
    ["same", ["same", "same"]]
  ]) {
    assert.deepEqual(splitConjugationDisplay(display, options), {
      beforeText: "", commonText: "", differingText: display, afterText: ""
    });
  }
});
