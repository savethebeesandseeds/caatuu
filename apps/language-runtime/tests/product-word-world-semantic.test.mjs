import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

globalThis.localStorage = {
  getItem() { return null; },
  setItem() {},
  removeItem() {}
};
globalThis.window = {
  CaatuuCourse: {
    id: "synthetic-controller-test",
    targetLanguage: {
      id: "xx",
      label: "Synthetic",
      locale: "xx-Test",
      speechLocale: "xx-Test",
      direction: "ltr"
    },
    storage: {
      namespace: "caatuu-semantic-controller-test",
      wordWorldTranslationMode: "caatuu-semantic-controller-test.translation",
      wordWorldRecentSentences: "caatuu-semantic-controller-test.recent",
      wordWorldTranslationCache: "caatuu-semantic-controller-test.translation-cache"
    }
  },
  CaatuuRuntime: null,
  location: {
    origin: "https://caatuu.test",
    href: "https://caatuu.test/word-world"
  }
};
globalThis.document = {};

const {
  buildDictionaryGapFeedback,
  englishAuditSemanticQuery,
  inferReconstructionSeparator,
  resolveDictionaryGapReportingContract,
  resolveWordWorldRecordLanguageRoles,
  resolveWordWorldSpeechPace,
  runOwnedSemanticSelection,
  selectStandardTurn,
  sourceTranslationFeedbackLabel,
  wordWorldWordsMatch
} = await import(
  `../static/source/product-word-world.mjs?semantic-test=${Date.now()}`
);

test("reconstruction fallback spacing derives from the authored surface, not a script allowlist", () => {
  assert.equal(inferReconstructionSeparator("Dítě čte knihu."), " ");
  assert.equal(inferReconstructionSeparator("هذا كتاب."), " ");
  assert.equal(inferReconstructionSeparator("这是一本书。"), "");
  assert.equal(inferReconstructionSeparator("これは本です。"), "");
  assert.equal(inferReconstructionSeparator("นี่คือหนังสือ"), "");
  assert.equal(inferReconstructionSeparator("这是 一本书。"), " ");
});

test("translation feedback names the learner base without changing English audit authority", () => {
  assert.equal(sourceTranslationFeedbackLabel({ label: "English" }), "Wrong English translation");
  assert.equal(sourceTranslationFeedbackLabel({ label: "Français" }), "Wrong Français translation");
  assert.equal(sourceTranslationFeedbackLabel({}), "Wrong base language translation");
});

test("English semantic queries ignore learner-base and target-language glosses", () => {
  assert.equal(englishAuditSemanticQuery({
    audit: { languageTag: "en", text: "This is a book." },
    englishText: "This is a book.",
    learnerPrompt: { languageTag: "fr", text: "Ceci est un livre." },
    target: { tokens: [{ surface: "libro", gloss: "un libro español" }] }
  }), "This is a book.");
  assert.equal(englishAuditSemanticQuery({
    audit: { languageTag: "fr", text: "Ceci est un livre." }
  }), "", "an audit field is usable only when it explicitly declares English");
});

test("target matching always requires the selected adapter normalization seam", () => {
  const searchKey = (value) => String(value || "").normalize("NFC").toLocaleLowerCase("es-ES");
  assert.equal(wordWorldWordsMatch("knihami", "kniha", {
    searchKey,
    courseId: "es-test",
    targetLanguageId: "es",
    providerKind: "authored-realizations"
  }), false);
  assert.equal(wordWorldWordsMatch("knihami", "kniha", {
    courseId: "cz",
    targetLanguageId: "cs",
    providerKind: "standard-corpus"
  }), false, "course and language identity cannot activate hidden morphology");
});

test("dictionary gap reporting requires a provider-bound explicit declaration", () => {
  const declared = {
    capabilities: { dictionary: true },
    dictionaryContent: {
      providerId: "future-dictionary-v2",
      gapReporting: {
        providerId: "future-dictionary-v2",
        dictionaryKey: "future-es-en-2026-09-04",
        dictionaryDirection: "es-en"
      }
    }
  };
  assert.deepEqual(resolveDictionaryGapReportingContract(declared), declared.dictionaryContent.gapReporting);
  assert.equal(resolveDictionaryGapReportingContract({
    ...declared,
    dictionaryContent: { ...declared.dictionaryContent, gapReporting: undefined }
  }), null);
  assert.equal(resolveDictionaryGapReportingContract({
    ...declared,
    dictionaryContent: {
      ...declared.dictionaryContent,
      gapReporting: { ...declared.dictionaryContent.gapReporting, providerId: "other-provider-v1" }
    }
  }), null);
});

test("the generated Czech profile produces the exact server dictionary-gap tuple", async () => {
  const source = await readFile(
    new URL("../../languages/czech/static/source/shared/course-profile.js", import.meta.url),
    "utf8"
  );
  const context = { window: {} };
  vm.runInNewContext(source, context, { filename: "course-profile.js" });
  assert.deepEqual(
    { ...buildDictionaryGapFeedback(context.window.CaatuuCourse, {
      targetWord: " kočka ",
      normalizedWord: "kočka",
      lookupReturned: 0
    }) },
    {
      targetWord: "kočka",
      normalizedWord: "kočka",
      dictionaryKey: "kaikki-cs-en-2026-07-09",
      dictionaryDirection: "cs-en",
      lookupOutcome: "no_results",
      lookupReturned: 0
    }
  );
});

test("Word World renders learner-base prompts while retaining independent English audit text", () => {
  assert.deepEqual(
    resolveWordWorldRecordLanguageRoles({
      englishText: "This is a book.",
      audit: { languageTag: "en", text: "This is a book." },
      learnerPrompt: {
        languageTag: "fr",
        text: "Ceci est un livre.",
        authority: "learner-base-realization"
      }
    }, {
      sourceText: "Ceci est un livre.",
      englishAuditText: "This is a book."
    }),
    {
      learnerPromptText: "Ceci est un livre.",
      englishAuditText: "This is a book."
    }
  );
  assert.deepEqual(
    resolveWordWorldRecordLanguageRoles({ englishText: "Thank you." }, { sourceText: "Thank you." }),
    { learnerPromptText: "Thank you.", englishAuditText: "Thank you." },
    "English-base records preserve their current prompt bytes and meaning"
  );
});

test("Word World keeps the selected numeric speech rate as the immediate session authority", () => {
  assert.deepEqual(
    resolveWordWorldSpeechPace(1, "slower", "normal"),
    { rate: 1, label: "normal", key: "normal", source: "override" }
  );
  assert.deepEqual(
    resolveWordWorldSpeechPace(3, "normal", "slower"),
    { rate: 0.5, label: "slower", key: "slower", source: "override" }
  );
  assert.deepEqual(
    resolveWordWorldSpeechPace(1, "slow", ""),
    { rate: 0.6, label: "slow", key: "slow", source: "override" }
  );
});

function selectionProvider(records, searchKey) {
  const calls = { nextForWord: 0, nextRandom: 0 };
  const provider = {
    records,
    calls,
    getRecordById(id) {
      return records.find((record) => record.id === id) || null;
    },
    nextRandom() {
      calls.nextRandom += 1;
      return { record: records[0], fallback: false, requestedWord: "" };
    },
    nextForWord(word) {
      calls.nextForWord += 1;
      const requestedWord = searchKey(word);
      const record = records.find((candidate) => candidate.targets.some((target) => (
        target.playable !== false && searchKey(target.surface) === requestedWord
      )));
      return record ? { record, fallback: false, requestedWord } : null;
    }
  };
  return provider;
}

const fixtures = [
  {
    name: "Czech",
    selectedWord: "Kočka",
    englishQuery: "cat",
    mode: "embedding",
    searchKey: (value) => String(value || "")
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLocaleLowerCase("cs-CZ"),
    records: [
      { id: "cz-first", difficulty: 1, targets: [{ surface: "kočka", playable: true }] },
      { id: "cz-ranked", difficulty: 1, targets: [{ surface: "Kočka", playable: true }] }
    ],
    rankedIds: ["cz-ranked", "cz-first"]
  },
  {
    name: "Mandarin",
    selectedWord: "书",
    englishQuery: "book",
    mode: "lexical",
    searchKey: (value) => String(value || "").normalize("NFC").trim(),
    records: [
      { id: "zh-first", difficulty: 1, targets: [{ surface: "书", playable: true }] },
      { id: "zh-ranked", difficulty: 2, targets: [{ surface: "书", playable: true }] }
    ],
    rankedIds: ["zh-ranked", "zh-first"]
  },
  {
    name: "synthetic future course",
    selectedWord: "TAVA",
    englishQuery: "bright star",
    mode: "embedding",
    searchKey: (value) => String(value || "").normalize("NFC").trim().toLocaleLowerCase("en-US"),
    records: [
      { id: "future-first", difficulty: 1, targets: [{ surface: "tava", playable: true }] },
      { id: "future-ranked", difficulty: 1, targets: [{ surface: "Tava", playable: true }] }
    ],
    rankedIds: ["future-ranked", "future-first"]
  }
];

for (const fixture of fixtures) {
  test(`selected-word generation consumes ${fixture.name} provider ranking`, async () => {
    const provider = selectionProvider(fixture.records, fixture.searchKey);
    const queries = [];
    const selection = await selectStandardTurn(provider, {
      generationMode: "selected",
      selectedWord: fixture.selectedWord,
      difficulty: 3,
      englishQuery: fixture.englishQuery,
      searchKey: fixture.searchKey,
      async searchEnglish(query) {
        queries.push(query);
        return {
          mode: fixture.mode,
          records: fixture.rankedIds.map((conceptId) => ({ conceptId }))
        };
      }
    });

    assert.deepEqual(queries, [fixture.englishQuery]);
    assert.equal(queries[0].includes(fixture.selectedWord), false);
    assert.equal(selection.record.id, fixture.rankedIds[0]);
    assert.equal(selection.semanticMode, fixture.mode);
    assert.equal(provider.calls.nextForWord, 1, "target-index fallback must remain available");
  });
}

test("selected-word generation fails back to the deterministic target index", async () => {
  const searchKey = (value) => String(value || "").trim().toLocaleLowerCase("en-US");
  const records = [
    { id: "fallback-first", difficulty: 1, targets: [{ surface: "tava", playable: true }] },
    { id: "fallback-second", difficulty: 1, targets: [{ surface: "tava", playable: true }] }
  ];
  const provider = selectionProvider(records, searchKey);
  const selection = await selectStandardTurn(provider, {
    generationMode: "selected",
    selectedWord: "tava",
    difficulty: 3,
    englishQuery: "bright star",
    searchKey,
    searchEnglish: async () => { throw new Error("model unavailable"); }
  });

  assert.equal(selection.record.id, "fallback-first");
  assert.equal(selection.semanticMode, "provider");
});

test("ranked rows that are all ineligible report target-index fallback", async () => {
  const searchKey = (value) => String(value || "").trim().toLocaleLowerCase("en-US");
  const records = [
    { id: "eligible-target", difficulty: 1, targets: [{ surface: "tava", playable: true }] },
    { id: "wrong-target", difficulty: 1, targets: [{ surface: "mira", playable: true }] },
    { id: "too-difficult", difficulty: 3, targets: [{ surface: "tava", playable: true }] }
  ];
  const provider = selectionProvider(records, searchKey);
  const selection = await selectStandardTurn(provider, {
    generationMode: "selected",
    selectedWord: "tava",
    difficulty: 1,
    englishQuery: "bright star",
    searchKey,
    searchEnglish: async () => ({
      mode: "embedding",
      records: [{ conceptId: "wrong-target" }, { conceptId: "too-difficult" }]
    })
  });

  assert.equal(selection.record.id, "eligible-target");
  assert.equal(selection.semanticMode, "provider");
});

test("a selection exception releases its owned busy interval and reports the error", async () => {
  let busy = true;
  let releases = 0;
  let presentations = 0;
  const errors = [];
  const outcome = await runOwnedSemanticSelection({
    select: async () => { throw new Error("provider selection failed"); },
    present: async () => { presentations += 1; },
    releaseBusy() {
      releases += 1;
      busy = false;
    },
    onSelectionError(error) {
      errors.push(error.message);
    }
  });

  assert.equal(outcome.error?.message, "provider selection failed");
  assert.equal(busy, false);
  assert.equal(releases, 1);
  assert.equal(presentations, 0);
  assert.deepEqual(errors, ["provider selection failed"]);
});

test("presentation takes busy ownership without a late selection release", async () => {
  const record = { id: "ranked-record" };
  let busy = true;
  let releases = 0;
  let presentationOwnsBusy = false;
  const outcome = await runOwnedSemanticSelection({
    select: async () => ({ record, semanticMode: "embedding" }),
    present: async (selection) => {
      assert.equal(selection.record, record);
      assert.equal(busy, true);
      presentationOwnsBusy = true;
    },
    releaseBusy() {
      releases += 1;
      busy = false;
    }
  });

  assert.equal(outcome.presented, true);
  assert.equal(presentationOwnsBusy, true);
  assert.equal(releases, 0);
  assert.equal(busy, true, "presentation remains responsible for clearing its own busy state");
});

test("the live Next/selected controller path awaits English search and reports its mode", async () => {
  const source = await readFile(
    new URL("../static/source/product-word-world.mjs", import.meta.url),
    "utf8"
  );
  assert.match(source, /const outcome = await runOwnedSemanticSelection\(\{/u);
  assert.match(source, /select: \(\) => selectStandardTurn\(provider, \{/u);
  assert.match(source, /const englishQuery = mode === "selected" \? selectedEnglishSemanticQuery\(\) : ""/u);
  assert.match(source, /Ranking guided sentences by English meaning/u);
  assert.match(source, /searchEnglish: providerContext\?\.searchEnglish/u);
  assert.match(source, /English MiniLM/u);
  assert.match(source, /English lexical fallback/u);
  assert.match(source, /Could not choose a guided sentence\. Please try again\./u);
  const semanticQueryBody = source.match(
    /function selectedEnglishSemanticQuery\(\) \{(?<body>[\s\S]*?)\n\}/u
  )?.groups?.body || "";
  assert.ok(semanticQueryBody, "the English semantic-query boundary must remain inspectable");
  assert.doesNotMatch(
    semanticQueryBody,
    /selectedWordDetails|selectedWordMeaning|preparedTokenForWord|\btoken\b|\bgloss\b/u,
    "UI, dictionary, target-token, and learner-base values must never become English query fallbacks"
  );
});
