import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMeaningChoices,
  containsGrammarAnchor,
  grammarFeedbackDuration,
  highlightedFormParts,
  shuffledGrammarValues,
  validateGrammarFlight,
  validateGrammarStages
} from "../static/source/games/grammar-gravity/adjective-flight-core.mjs";

const flight = () => ({
  id: "future.test.book", anchorText: "The books", anchorMeaning: "Los libros", anchorEnglishAuditText: "The books",
  targetText: "The books are red.", learnerBaseText: "Los libros son rojos.", beforeText: "The books ", afterText: " red.",
  answer: "are", options: ["is", "are"], categoryId: "plural",
  categoryOptions: [{ id: "singular", label: "Singular" }, { id: "plural", label: "Plural" }],
  stages: ["meaning", "category", "form"], meaningPool: ["Los libros", "Los perros", "La niña"],
  meaningOptions: ["Los libros", "Los perros", "La niña"]
});

test("modern flight uses an authored subject and slot without adjective assumptions", () => {
  const value = flight();
  assert.equal(validateGrammarFlight(value), value);
  assert.equal(value.beforeText + value.answer + value.afterText, value.targetText);
  assert.equal(value.anchorMeaning, "Los libros");
});

test("incomplete flights throw instead of selecting a different game", () => {
  for (const edit of [
    (value) => { delete value.anchorMeaning; },
    (value) => { value.anchorText = "book"; },
    (value) => { value.afterText = " green."; },
    (value) => { value.options = ["are"]; },
    (value) => { value.options = ["are", "are"]; },
    (value) => { value.options = ["was", "were"]; },
    (value) => { value.categoryId = "masculine"; },
    (value) => { value.categoryOptions[1].id = "singular"; },
    (value) => { value.meaningPool = ["Los libros"]; },
    (value) => { value.meaningOptions = ["The books", "Los libros"]; },
    (value) => { delete value.stages; },
    (value) => { value.stages = ["legacy"]; }
  ]) {
    const value = flight(); edit(value);
    assert.throws(() => validateGrammarFlight(value));
  }
});

test("stages are explicit, ordered, unique, supported and end with form", () => {
  for (const stages of [["form"], ["meaning", "form"], ["category", "form"], ["meaning", "category", "form"]]) {
    assert.equal(validateGrammarStages(stages), stages);
  }
  for (const stages of [undefined, [], ["meaning"], ["form", "meaning"], ["category", "meaning", "form"], ["form", "form"], ["gender", "form"]]) {
    assert.throws(() => validateGrammarStages(stages));
  }
});

test("anchors require complete tokens and cannot borrow a boundary inside the form slot", () => {
  assert.equal(containsGrammarAnchor("the books ", "books"), true);
  assert.equal(containsGrammarAnchor("(books)", "books"), true);
  for (const [context, anchor] of [["books", "book"], ["the", "he"], ["brand-new", "new"], ["l'homme", "homme"]]) {
    assert.equal(containsGrammarAnchor(context, anchor), false);
  }
  const value = { ...flight(), anchorText: "book", beforeText: "book", answer: "s", afterText: "", targetText: "books", options: ["s", "es"] };
  assert.throws(() => validateGrammarFlight(value), /complete tokens/u);
});

test("meaning options retain the correct authored answer with unique learner-base distractors", () => {
  const pool = ["casa", "pueblo", "ciudad", "castillo", "libro", "coche", "árbol", "casa"];
  for (const count of [3, 6]) {
    const choices = buildMeaningChoices("árbol", pool, count, () => 0.999);
    assert.equal(choices.length, count);
    assert.equal(new Set(choices).size, count);
    assert.ok(choices.includes("árbol"));
    assert.ok(choices.every((choice) => pool.includes(choice)));
  }
  assert.deepEqual(buildMeaningChoices("casa", ["casa", "ciudad"], 6, () => 0.999), ["casa", "ciudad"]);
  assert.deepEqual(buildMeaningChoices("casa", ["casa", "Casa", "ciudad"], 3, () => 0.999), ["casa", "ciudad"]);
  for (const [answer, meanings] of [["casa", ["casa"]], ["casa", ["Casa", "pueblo"]], ["", pool], [null, pool], ["casa", ["casa", null]]]) {
    assert.throws(() => buildMeaningChoices(answer, meanings));
  }
  assert.throws(() => buildMeaningChoices("casa", pool, 4), /3 or 6/u);
});

test("random injection is deterministic and does not mutate authored values", () => {
  const source = ["a", "b", "c"];
  assert.deepEqual(shuffledGrammarValues(source, () => 0), ["b", "c", "a"]);
  assert.deepEqual(shuffledGrammarValues(source, () => 0), shuffledGrammarValues(source, () => 0));
  assert.deepEqual(source, ["a", "b", "c"]);
});

test("form highlighting finds shared spelling without manufacturing morphology", () => {
  assert.deepEqual(highlightedFormParts("nová", ["nový", "nová", "nové"]), { stem: "nov", ending: "á" });
  assert.deepEqual(highlightedFormParts("are", ["is", "are"]), { stem: "", ending: "are" });
  assert.deepEqual(highlightedFormParts("these", ["this", "these"]), { stem: "th", ending: "ese" });
  assert.deepEqual(highlightedFormParts("e\u0301té", ["e\u0301té", "e\u0300tes"]), { stem: "", ending: "e\u0301té" });
  assert.deepEqual(highlightedFormParts("🦜a", ["🦜a", "🦜b"]), { stem: "🦜", ending: "a" });
});

test("success feedback remains 900 ms while errors allow 2400 ms review", () => {
  assert.equal(grammarFeedbackDuration(true), 900);
  assert.equal(grammarFeedbackDuration(false), 2400);
});
