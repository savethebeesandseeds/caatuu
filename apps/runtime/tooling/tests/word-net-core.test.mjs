import assert from "node:assert/strict";
import test from "node:test";

import {
  capitalizeWord,
  cleanGeneratedSentence,
  cleanTranslation,
  dotProduct,
  isMiscellaneousAssetPath,
  isPlausibleSentence,
  isRecentSentence,
  interpretHorizontalSwipe,
  normalizeAssetPath,
  normalizeWord,
  parseSceneKeymap,
  sentenceFingerprint,
  sentenceIncludesWord,
  sentenceSimilarity,
  sentenceTargets,
  selectDictionaryMeaning,
  stripModelEcho,
  tokenizeCzechSentence,
  wordMatchesTarget
} from "../../../../apps/languages/czech/static/word-net-core.mjs";

test("normalizes and capitalizes Czech words without losing diacritics", () => {
  assert.equal(normalizeWord("…příběh!"), "příběh");
  assert.equal(capitalizeWord("člověk"), "Člověk");
});

test("tokenizes Czech sentences into playable words and punctuation", () => {
  assert.deepEqual(tokenizeCzechSentence("Dítě čte knihu."), [
    { type: "word", text: "Dítě" },
    { type: "word", text: "čte" },
    { type: "word", text: "knihu" },
    { type: "punctuation", text: "." }
  ]);
  assert.equal(sentenceIncludesWord("Kočka spí doma.", "kočka"), true);
  assert.equal(sentenceIncludesWord("Kočka spí doma.", "pes"), false);
  assert.equal(wordMatchesTarget("kočku", "kočka"), true);
  assert.equal(wordMatchesTarget("kočka", "kočku"), true);
  assert.equal(wordMatchesTarget("psa", "pes"), true);
  assert.equal(wordMatchesTarget("hru", "hra"), true);
  assert.equal(wordMatchesTarget("hra", "hru"), true);
  assert.equal(wordMatchesTarget("autobus", "auto"), false);
  assert.equal(sentenceIncludesWord("Vidím kočku.", "kočka"), true);
});

test("maps deliberate horizontal swipes to Word World navigation", () => {
  assert.equal(
    interpretHorizontalSwipe({ x: 100, y: 200, time: 10 }, { x: 190, y: 212, time: 280 }),
    "previous"
  );
  assert.equal(
    interpretHorizontalSwipe({ x: 190, y: 200, time: 10 }, { x: 90, y: 188, time: 280 }),
    "random"
  );
  assert.equal(interpretHorizontalSwipe({ x: 100, y: 200, time: 10 }, { x: 145, y: 202, time: 250 }), null);
  assert.equal(interpretHorizontalSwipe({ x: 100, y: 200, time: 10 }, { x: 180, y: 275, time: 250 }), null);
  assert.equal(interpretHorizontalSwipe({ x: 100, y: 200, time: 10 }, { x: 180, y: 205, time: 1200 }), null);
});

test("cleans model wrappers and falls back for unusable output", () => {
  assert.equal(stripModelEcho("<|assistant|> Věta: „Pes běží domů.“"), "Pes běží domů.");
  assert.equal(
    cleanGeneratedSentence("x".repeat(160), "pes", (word) => `${word} je tady.`),
    "pes je tady."
  );
  assert.equal(
    cleanGeneratedSentence("Kočka spí.", "pes", (word) => `${word} je tady.`),
    "pes je tady."
  );
  assert.equal(
    cleanGeneratedSentence("Vidím kočku.", "kočka", (word) => `${word} je tady.`),
    "Vidím kočku."
  );
  assert.equal(cleanTranslation('Translation: "The child reads."'), "The child reads.");
});

test("selects a useful exact dictionary meaning over a same-spelling name", () => {
  const payload = {
    results: [
      {
        lemma: "Voda",
        pos: "name",
        matchedBy: "lemma",
        matchedTerm: "Voda",
        senses: [{ gloss: "a male surname", tags: [] }]
      },
      {
        lemma: "voda",
        pos: "noun",
        matchedBy: "lemma",
        matchedTerm: "voda",
        forms: [{ form: "voda", tags: ["nominative", "singular"] }],
        senses: [
          { gloss: "water", tags: ["feminine"], synonyms: ["H₂O"] },
          { gloss: "a body of water", tags: [], topics: ["nature"] }
        ]
      }
    ]
  };
  assert.deepEqual(selectDictionaryMeaning(payload, "voda"), {
    lemma: "voda",
    pos: "noun",
    matchedBy: "lemma",
    matchedTerm: "voda",
    formTags: ["nominative", "singular"],
    senseTags: ["feminine"],
    topics: ["nature"],
    synonyms: ["H₂O"],
    glosses: ["water", "a body of water"],
    meaning: "water · a body of water"
  });
});

test("uses an inflected-form dictionary match and ignores form-only senses", () => {
  const payload = {
    results: [
      {
        lemma: "vodu",
        pos: "form",
        matchedBy: "lemma",
        matchedTerm: "vodu",
        senses: [{ gloss: "accusative singular of voda", tags: ["form-of"] }]
      },
      {
        lemma: "voda",
        pos: "noun",
        matchedBy: "form",
        matchedTerm: "vodu",
        forms: [{ form: "vodu", tags: ["accusative", "singular"] }],
        senses: [{ gloss: "water", tags: ["feminine"] }]
      }
    ]
  };
  const selected = selectDictionaryMeaning(payload, "vodu");
  assert.equal(selected?.meaning, "water");
  assert.equal(selected?.lemma, "voda");
  assert.deepEqual(selected?.formTags, ["accusative", "singular"]);
  assert.deepEqual(selected?.senseTags, ["feminine"]);
  assert.equal(selectDictionaryMeaning({ results: [] }, "vodu"), null);
});

test("recognizes recent and near-duplicate Word World sentences", () => {
  assert.equal(sentenceFingerprint("  Kočka spí doma! "), "kočka spí doma");
  assert.equal(isRecentSentence("Kočka spí doma.", ["Kočka spí doma!"]), true);
  assert.equal(
    isRecentSentence("Malá kočka dnes klidně spí doma.", ["Malá kočka dnes tiše spí doma."]),
    true
  );
  assert.equal(isRecentSentence("Pes běží přes zahradu.", ["Kočka spí doma."]), false);
  assert.ok(sentenceSimilarity("Dítě čte knihu doma.", "Dítě čte novou knihu doma.") > 0.7);
});

test("filters implausible phrases and extracts unique branch targets", () => {
  assert.equal(isPlausibleSentence("Pes spí."), true);
  assert.equal(isPlausibleSentence("pes pes pes"), false);
  assert.equal(isPlausibleSentence("https://example.com"), false);
  assert.deepEqual(sentenceTargets("Malý pes vidí psa a dům.", { exclude: ["pes"], limit: 4 }), [
    "Malý",
    "vidí",
    "psa",
    "dům"
  ]);
});

test("parses only usable scene descriptions and safe asset paths", () => {
  assert.equal(normalizeAssetPath("assets/miscellaneous/scene.png"), "/assets/miscellaneous/scene.png");
  assert.equal(normalizeAssetPath("https://example.com/scene.png"), "");
  assert.equal(isMiscellaneousAssetPath("assets/miscellaneous/scene.png"), true);
  assert.equal(isMiscellaneousAssetPath("/assets/macaw/actions/fly.png"), false);
  assert.equal(isMiscellaneousAssetPath("/assets/robots/helper.png"), false);
  assert.deepEqual(
    parseSceneKeymap({
      "assets/miscellaneous/scene.png": { description: "A child reading", category: "school" },
      "https://example.com/remote.png": { description: "Remote" },
      "assets/miscellaneous/empty.png": { description: "" }
    }),
    [
      {
        assetPath: "/assets/miscellaneous/scene.png",
        description: "A child reading",
        category: "school"
      }
    ]
  );
  assert.equal(dotProduct([1, 2, 3], [4, 5]), 14);
});
