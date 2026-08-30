import assert from "node:assert/strict";
import test from "node:test";

import {
  alignWordReconstructionAttempt,
  buildWordReconstructionChallenge,
  capitalizeWord,
  cleanGeneratedSentence,
  cleanTranslation,
  dotProduct,
  isMiscellaneousAssetPath,
  isPlausibleSentence,
  isRecentSentence,
  isReservedEdgeGesture,
  isSpeechSynthesisSupported,
  isWordReconstructionCorrect,
  interpretHorizontalSwipe,
  normalizeAssetPath,
  normalizeWord,
  parseSceneKeymap,
  sentenceFingerprint,
  sentenceIncludesWord,
  sentenceSimilarity,
  sentenceTargets,
  selectDictionaryMeaning,
  selectSpeechSynthesisVoice,
  resolveSpeechPace,
  speechPaceForDifficulty,
  speechPaceForPreference,
  stripModelEcho,
  tokenizeCzechSentence,
  tokenizeEnglishReconstruction,
  wordMatchesTarget
} from "../../../../apps/language-runtime/static/source/word-net-core.mjs";

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

test("detects native speech support without requiring voices to be loaded", () => {
  class MockUtterance {}
  const synthesis = {
    speak() {},
    cancel() {},
    getVoices() { return []; }
  };

  assert.equal(isSpeechSynthesisSupported(synthesis, MockUtterance), true);
  assert.equal(isSpeechSynthesisSupported({ cancel() {} }, MockUtterance), false);
  assert.equal(isSpeechSynthesisSupported({ speak() {} }, MockUtterance), false);
  assert.equal(isSpeechSynthesisSupported(synthesis, null), false);
  assert.equal(isSpeechSynthesisSupported(null, MockUtterance), false);
});

test("maps course difficulty badges to distinct Word World speech paces", () => {
  assert.deepEqual(speechPaceForDifficulty(1), { rate: 0.5, label: "slower" });
  assert.deepEqual(speechPaceForDifficulty(2), { rate: 0.6, label: "slow" });
  assert.deepEqual(speechPaceForDifficulty(3), { rate: 1, label: "normal" });
  assert.deepEqual(speechPaceForDifficulty("unknown"), { rate: 0.5, label: "slower" });

  const windowsSapiBuckets = [1, 2, 3]
    .map((difficulty) => speechPaceForDifficulty(difficulty).rate)
    .map((rate) => Math.trunc(10 * Math.log10(rate)));
  assert.equal(
    new Set(windowsSapiBuckets).size,
    3,
    "every shared pace must survive Chromium's integer Windows SAPI conversion"
  );
});

test("lets an explicit speech pace override the badge and safely return to it", () => {
  assert.deepEqual(speechPaceForPreference("slower"), { rate: 0.5, label: "slower" });
  assert.deepEqual(speechPaceForPreference("SLOW"), { rate: 0.6, label: "slow" });
  assert.deepEqual(speechPaceForPreference("normal"), { rate: 1, label: "normal" });
  assert.equal(speechPaceForPreference("fast"), null);

  assert.deepEqual(resolveSpeechPace(1, "normal"), {
    rate: 1,
    label: "normal",
    key: "normal",
    source: "override"
  });
  assert.deepEqual(resolveSpeechPace(3, "slower"), {
    rate: 0.5,
    label: "slower",
    key: "slower",
    source: "override"
  });
  assert.deepEqual(resolveSpeechPace(2, ""), {
    rate: 0.6,
    label: "slow",
    key: "slow",
    source: "badge"
  });
  assert.deepEqual(resolveSpeechPace(3, "invalid"), {
    rate: 1,
    label: "normal",
    key: "normal",
    source: "badge"
  });
});

test("selects a stable Czech device voice without forcing a foreign fallback", () => {
  const englishDefault = { name: "English", lang: "en-US", localService: true, default: true };
  const genericCzech = { name: "Czech generic", lang: "cs", localService: true };
  const exactRemote = { name: "Czech cloud", lang: "cs-CZ", localService: false };
  const exactLocalLater = { name: "Zora", lang: "cs_CZ", localService: true };
  const exactLocalFirst = { name: "Alena", lang: "cs-CZ", localService: true };
  const exactLocalDefault = { name: "Zuzana", lang: "cs-CZ", localService: true, default: true };

  assert.equal(selectSpeechSynthesisVoice([genericCzech, exactRemote], "cs-CZ"), exactRemote);
  assert.equal(
    selectSpeechSynthesisVoice([
      { name: "Alpha remote", lang: "cs-CZ", localService: false },
      exactLocalLater
    ], "cs-CZ"),
    exactLocalLater
  );
  assert.equal(selectSpeechSynthesisVoice([exactLocalLater], "cs-CZ"), exactLocalLater);
  assert.equal(
    selectSpeechSynthesisVoice([exactLocalFirst, exactLocalDefault], "cs-CZ"),
    exactLocalDefault
  );
  assert.equal(
    selectSpeechSynthesisVoice([
      englishDefault,
      genericCzech,
      exactRemote,
      exactLocalLater,
      exactLocalFirst
    ], "cs-CZ"),
    exactLocalFirst
  );
  assert.equal(selectSpeechSynthesisVoice([englishDefault, genericCzech], "cs-CZ"), genericCzech);
  assert.equal(selectSpeechSynthesisVoice([englishDefault], "cs-CZ"), null);
  assert.equal(selectSpeechSynthesisVoice([], "cs-CZ"), null);
  assert.equal(selectSpeechSynthesisVoice(null, "cs-CZ"), null);
  assert.equal(selectSpeechSynthesisVoice([genericCzech], ""), null);
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

test("reserves both screen edges for Android system navigation", () => {
  assert.equal(isReservedEdgeGesture(0, 475), true);
  assert.equal(isReservedEdgeGesture(24, 475), true);
  assert.equal(isReservedEdgeGesture(451, 475), true);
  assert.equal(isReservedEdgeGesture(237, 475), false);
  assert.equal(isReservedEdgeGesture(20, 475, { edgeGutter: 12 }), false);
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

test("finds an exact accented form when search matched an accent-normalized sibling", () => {
  const payload = {
    results: [{
      lemma: "říci",
      pos: "verb",
      matchedBy: "form",
      matchedTerm: "řekneme",
      forms: [
        { form: "řekneme", tags: ["indicative", "first-person", "plural"] },
        { form: "řekněme", tags: ["imperative", "first-person", "plural"] }
      ],
      senses: [{ gloss: "to say", tags: ["perfective"] }]
    }]
  };

  const selected = selectDictionaryMeaning(payload, "Řekněme");
  assert.equal(selected?.meaning, "to say");
  assert.equal(selected?.lemma, "říci");
  assert.deepEqual(selected?.formTags, ["imperative", "first-person", "plural"]);
});

test("rejects dictionary prefix suggestions that are not exact lemma or form matches", () => {
  const payload = {
    results: [{
      lemma: "autobus",
      pos: "noun",
      matchedBy: "prefix",
      matchedTerm: "autobus",
      senses: [{ gloss: "bus", tags: [] }]
    }]
  };

  assert.equal(selectDictionaryMeaning(payload, "auto"), null);
});

test("builds deterministic English reconstruction challenges with two distractors", () => {
  const candidates = [
    "I'm cold.",
    "She feels calm.",
    "They are ready."
  ];
  const first = buildWordReconstructionChallenge("I'm hot.", candidates, { distractorCount: 2 });
  const second = buildWordReconstructionChallenge("I'm hot.", candidates, { distractorCount: 2 });

  assert.deepEqual(first, second);
  assert.deepEqual(first.answerTokens, ["I'm", "hot"]);
  assert.equal(first.punctuation, ".");
  assert.equal(first.options.filter((option) => option.answer).length, 2);
  assert.equal(first.options.filter((option) => !option.answer).length, 2);
  assert.equal(new Set(first.options.map((option) => option.id)).size, first.options.length);
});

test("reconstruction keeps contractions intact and checks the complete order", () => {
  assert.deepEqual(tokenizeEnglishReconstruction("I'm sure we’ll win."), ["I'm", "sure", "we’ll", "win"]);
  assert.equal(isWordReconstructionCorrect(["I’m", "HOT"], ["I'm", "hot"]), true);
  assert.equal(isWordReconstructionCorrect(["hot", "I'm"], ["I'm", "hot"]), false);
  assert.equal(isWordReconstructionCorrect(["I'm"], ["I'm", "hot"]), false);
  assert.equal(isWordReconstructionCorrect(["I'm", "hot", "today"], ["I'm", "hot"]), false);
});

test("aligns reconstruction feedback without losing words that already match", () => {
  assert.deepEqual(
    alignWordReconstructionAttempt(["your"], ["What", "is", "your", "name"]),
    [
      { type: "missing", entered: "", expected: "What" },
      { type: "missing", entered: "", expected: "is" },
      { type: "match", entered: "your", expected: "your" },
      { type: "missing", entered: "", expected: "name" }
    ]
  );
  assert.deepEqual(
    alignWordReconstructionAttempt(["What", "is", "your", "very", "name"], ["What", "is", "your", "name"]),
    [
      { type: "match", entered: "What", expected: "What" },
      { type: "match", entered: "is", expected: "is" },
      { type: "match", entered: "your", expected: "your" },
      { type: "extra", entered: "very", expected: "" },
      { type: "match", entered: "name", expected: "name" }
    ]
  );
  assert.deepEqual(
    alignWordReconstructionAttempt(["Who", "is", "your", "name"], ["What", "is", "your", "name"])[0],
    { type: "replacement", entered: "Who", expected: "What" }
  );
  assert.deepEqual(
    alignWordReconstructionAttempt(["very", "very"], ["very"]),
    [
      { type: "match", entered: "very", expected: "very" },
      { type: "extra", entered: "very", expected: "" }
    ]
  );
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
