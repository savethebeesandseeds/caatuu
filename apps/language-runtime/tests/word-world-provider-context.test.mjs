import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { importBrowserLanguageAdapter } from "./browser-module-loader.mjs";
import {
  mountWordWorld,
  prepareWordWorldContext,
  resolveWordWorldGenerationStrategy
} from "../static/source/word-world-provider.mjs";

const [czechAdapter, mandarinAdapter] = await Promise.all([
  importBrowserLanguageAdapter("../../languages/czech/static/source/language/adapter.mjs"),
  importBrowserLanguageAdapter("../../languages/mandarin-simplified/static/source/language/adapter.mjs")
]);

async function json(relativeUrl) {
  return JSON.parse(await readFile(new URL(relativeUrl, import.meta.url), "utf8"));
}

const [
  mandarinCourseManifest,
  authoredManifest,
  englishCatalog,
  realizationCatalog,
  readingGuideCatalog,
  czechWordWorldManifest
] = await Promise.all([
  json("../../languages/mandarin-simplified/course.json"),
  json("../../languages/mandarin-simplified/static/data/games/word-world/manifest.json"),
  json("../static/data/english-concepts/word-world-starter-v1.json"),
  json("../../languages/mandarin-simplified/static/data/games/word-world/starter-v1.realizations.json"),
  json("../../languages/mandarin-simplified/static/data/games/word-world/starter-v1.reading-guides.json"),
  json("../../languages/czech/static/data/games/word-world/manifest.json")
]);

const mandarinCourse = Object.freeze({
  id: mandarinCourseManifest.id,
  routePrefix: mandarinCourseManifest.routePrefix,
  sourceLanguage: mandarinCourseManifest.sourceLanguage,
  targetLanguage: mandarinCourseManifest.targetLanguage,
  capabilities: mandarinCourseManifest.capabilities,
  languageAdapter: { module: "source/language/adapter.mjs" }
});

function authoredJsonLoader(url) {
  const pathname = new URL(url, "https://caatuu.test").pathname;
  if (pathname === "/language-runtime/static/data/english-concepts/word-world-starter-v1.json") {
    return structuredClone(englishCatalog);
  }
  if (pathname === "/zh/data/games/word-world/starter-v1.realizations.json") {
    return structuredClone(realizationCatalog);
  }
  if (pathname === "/zh/data/games/word-world/starter-v1.reading-guides.json") {
    return structuredClone(readingGuideCatalog);
  }
  throw new Error(`Unexpected authored fixture URL: ${url}`);
}

function rankedByConcept(preferredId, capture) {
  return async (payload) => {
    capture.payload = payload;
    return payload.candidates.map(({ conceptId }) => ({
      conceptId,
      score: conceptId === preferredId ? 1 : 0
    }));
  };
}

function authoredOptions(overrides = {}) {
  const capture = overrides.capture || {};
  return {
    origin: "https://caatuu.test",
    adapter: mandarinAdapter,
    loadJson: authoredJsonLoader,
    embeddingRanker: rankedByConcept("ww.object.book", capture),
    random: () => 0,
    now: () => 1700000000000,
    runtime: null,
    ...overrides,
    capture
  };
}

const frenchBaseCourse = Object.freeze({
  ...mandarinCourse,
  sourceLanguage: Object.freeze({
    id: "fr",
    label: "Français",
    locale: "fr",
    direction: "ltr"
  })
});

function frenchBaseProjection({ mutate } = {}) {
  const projection = {
    $schema: "https://caatuu.org/schemas/runtime/learner-base-realizations.runtime.v1.schema.json",
    schemaVersion: 1,
    id: "word-world-french-base-v1",
    baseLanguage: { languageTag: "fr", script: "Latn" },
    derivedFrom: "apps/languages/shared/learner-base-realizations/fr/word-world-french-base-v1.json",
    sourceCatalog: englishCatalog.derivedFrom,
    review: {
      status: "native-reviewed",
      reviewer: "Synthetic French reviewer",
      reviewedAt: "2026-09-03T00:00:00Z",
      notes: "Synthetic browser-runtime contract fixture only."
    },
    license: structuredClone(englishCatalog.license),
    realizations: [...englishCatalog.concepts].reverse().map((concept, index) => ({
      conceptId: concept.id,
      text: concept.id === "ww.object.book"
        ? "Ceci est un livre français."
        : `Phrase française ${index + 1}.`
    }))
  };
  mutate?.(projection);
  return projection;
}

function frenchBaseManifest() {
  return {
    ...structuredClone(authoredManifest),
    learnerBaseLanguage: "fr",
    learnerBaseFile: "word-world-french-base-v1.runtime.json"
  };
}

function authoredFrenchJsonLoader(projection, calls = []) {
  return (url) => {
    calls.push(String(url));
    const pathname = new URL(url, "https://caatuu.test").pathname;
    if (pathname.endsWith("/word-world-french-base-v1.runtime.json")) {
      return structuredClone(projection);
    }
    return authoredJsonLoader(url);
  };
}

test("authored preparation exposes the complete renderer-neutral provider seam", async () => {
  const reports = [];
  const options = authoredOptions({
    runtime: {
      maintenance: {
        enqueueReport(payload) {
          reports.push(payload);
          return { ok: true };
        }
      }
    }
  });
  const context = await prepareWordWorldContext(mandarinCourse, authoredManifest, options);

  assert.equal(context.providerKind, "authored-realizations");
  assert.equal(context.session.records.length, 250);
  assert.equal(context.selectionProvider.records.length, 250);
  assert.equal(context.selectionProvider.corpusVersion, "starter-v1");
  assert.equal(context.learnerBase, undefined);
  for (const method of [
    "difficultyCounts",
    "nextRandom",
    "nextForWord",
    "primaryWord",
    "markUsed",
    "getRecordById"
  ]) assert.equal(typeof context.selectionProvider[method], "function", method);
  assert.deepEqual(context.selectionProvider.difficultyCounts(), { 1: 50, 2: 150, 3: 50 });

  const book = context.sessionRecord("ww.object.book");
  assert.equal(book.target.text, "这是一本书。");
  assert.equal(book.learnerPrompt, undefined);
  assert.equal(context.selectionProvider.getRecordById(book.conceptId).sourceText, book.englishText);
  assert.equal(context.sessionRecord({ conceptId: book.conceptId }), book);
  assert.equal(context.normalization.text(" 你好 "), "你好");
  assert.equal(context.normalization.searchKey(" 你好 "), "你好");
  const segments = context.segment(book.target, { conceptId: book.conceptId });
  assert.equal(segments.map(({ text }) => text).join(""), book.target.text);

  const authoredMeaning = await context.lookupMeaning({
    record: book,
    token: book.target.tokens.at(-1)
  });
  assert.equal(authoredMeaning.meaning, "book");
  assert.equal(context.fullDictionaryLookup, null);
  assert.deepEqual(context.targetTextGuide, {
    system: "pinyin",
    status: "machine-assisted-preview",
    languageTag: "zh-Latn-pinyin",
    labels: {
      section: "Mandarin text",
      showGuide: "Show pinyin",
      colorTones: "Color tones"
    },
    defaults: { showGuide: true, colorTones: true }
  });
  const thanks = context.sessionRecord("ww.greeting.thanks");
  assert.deepEqual(context.targetTextUnits({
    record: thanks,
    token: thanks.target.tokens[0],
    tokenIndex: 0
  }), [
    { surface: "谢", notation: "xiè", tone: 4 },
    { surface: "谢", notation: "xie", tone: 5 }
  ]);

  const selected = context.selectionProvider.nextForWord("书", {
    difficulty: 3,
    allowRandomFallback: false
  });
  assert.equal(selected.fallback, false);
  assert.ok(selected.record.targets.some(({ surface }) => surface === "书"));
  assert.equal(context.sessionRecord(selected.record.id)?.conceptId, selected.record.id);
  assert.equal(context.selectionProvider.primaryWord(selected.record, selected.requestedWord), "书");
  assert.deepEqual(context.selectionProvider.markUsed(selected.record), {
    count: 1,
    lastSeen: 1700000000000
  });
  assert.equal(context.selectionProvider.usage.get(selected.record.id).count, 1);

  const scene = context.sceneForRecord(book);
  assert.match(scene.src, /^\/assets\/miscellaneous\/burrow-review_\d{3}\.png$/u);
  assert.equal(scene.alt, book.sceneQuery);

  const search = await context.searchEnglish("book");
  assert.equal(search.mode, "embedding");
  assert.equal(search.records[0].conceptId, "ww.object.book");
  assert.deepEqual(Object.keys(options.capture.payload), ["inputLanguage", "query", "candidates"]);
  assert.doesNotMatch(JSON.stringify(options.capture.payload), /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u);
  await assert.rejects(context.searchEnglish("书"), /English-authority/u);

  await context.report({
    courseId: mandarinCourse.id,
    record: book,
    reason: "wrong_source_meaning",
    comment: "Review this meaning."
  });
  assert.equal(reports.length, 1);
  assert.equal(reports[0].feedback.entryId, book.conceptId);
  assert.equal(reports[0].feedback.contentMode, "authored");
});

test("a reviewed non-English learner base joins by concept ID without entering English retrieval", async () => {
  const projection = frenchBaseProjection();
  const loaderCalls = [];
  const capture = {};
  const context = await prepareWordWorldContext(
    frenchBaseCourse,
    frenchBaseManifest(),
    authoredOptions({
      loadJson: authoredFrenchJsonLoader(projection, loaderCalls),
      embeddingRanker: rankedByConcept("ww.object.book", capture)
    })
  );

  assert.deepEqual(context.learnerBase, {
    languageTag: "fr",
    file: "word-world-french-base-v1.runtime.json",
    catalogId: projection.id
  });
  const book = context.sessionRecord("ww.object.book");
  assert.equal(book.englishText, "This is a book.");
  assert.deepEqual(book.audit, { languageTag: "en", text: "This is a book." });
  assert.deepEqual(book.learnerPrompt, {
    languageTag: "fr",
    text: "Ceci est un livre français.",
    authority: "learner-base-realization"
  });
  const selectionRecord = context.selectionProvider.getRecordById(book.conceptId);
  assert.equal(selectionRecord.sourceText, book.learnerPrompt.text);
  assert.equal(selectionRecord.learnerPromptText, book.learnerPrompt.text);
  assert.equal(selectionRecord.englishAuditText, book.englishText);
  assert.ok(
    loaderCalls.some((url) => url.endsWith("/zh/data/games/word-world/word-world-french-base-v1.runtime.json")),
    "the base projection must resolve beside the target runtime manifest"
  );

  const search = await context.searchEnglish("book");
  assert.equal(search.records[0].conceptId, book.conceptId);
  assert.equal(capture.payload.inputLanguage, "en");
  assert.equal(capture.payload.query.embeddingText, "book");
  assert.doesNotMatch(JSON.stringify(capture.payload), /Phrase française|Ceci est/u);
  await assert.rejects(
    context.searchEnglish(book.learnerPrompt.text),
    /English-authority/u,
    "learner-base prompt text cannot cross the English retrieval boundary"
  );
});

test("non-English learner-base activation fails closed on absent, mismatched, or partial projections", async () => {
  await assert.rejects(
    prepareWordWorldContext(frenchBaseCourse, authoredManifest, authoredOptions()),
    /requires a reviewed learner-base runtime projection/u
  );

  const incomplete = frenchBaseProjection({
    mutate(projection) {
      projection.realizations.pop();
    }
  });
  await assert.rejects(
    prepareWordWorldContext(
      frenchBaseCourse,
      frenchBaseManifest(),
      authoredOptions({ loadJson: authoredFrenchJsonLoader(incomplete) })
    ),
    /Missing learner-base realizations/u
  );

  const wrongAuthority = frenchBaseProjection({
    mutate(projection) {
      projection.sourceCatalog = "apps/languages/shared/english-concepts/different-v1.json";
    }
  });
  await assert.rejects(
    prepareWordWorldContext(
      frenchBaseCourse,
      frenchBaseManifest(),
      authoredOptions({ loadJson: authoredFrenchJsonLoader(wrongAuthority) })
    ),
    /does not reference the loaded English concept authority/u
  );

  const wrongScript = frenchBaseProjection({
    mutate(projection) {
      projection.baseLanguage.script = "Cyrl";
    }
  });
  await assert.rejects(
    prepareWordWorldContext(
      frenchBaseCourse,
      frenchBaseManifest(),
      authoredOptions({ loadJson: authoredFrenchJsonLoader(wrongScript) })
    ),
    /maximized script Latn for fr/u
  );

  const wrongLanguageManifest = frenchBaseManifest();
  wrongLanguageManifest.learnerBaseLanguage = "de";
  await assert.rejects(
    prepareWordWorldContext(frenchBaseCourse, wrongLanguageManifest, authoredOptions()),
    /does not match course source language/u
  );

  await assert.rejects(
    prepareWordWorldContext(
      frenchBaseCourse,
      frenchBaseManifest(),
      authoredOptions({
        loadJson(url) {
          if (String(url).endsWith("word-world-french-base-v1.runtime.json")) {
            throw new Error("learner-base file missing");
          }
          return authoredJsonLoader(url);
        }
      })
    ),
    /learner-base file missing/u
  );
});

test("the legacy standard corpus cannot bypass the learner-base concept join", async () => {
  const { provider } = standardFixture();
  await assert.rejects(
    prepareWordWorldContext({
      ...czechCourse,
      sourceLanguage: { id: "fr", label: "Français", locale: "fr" }
    }, standardManifest, {
      adapter: czechAdapter,
      standardProvider: provider,
      embeddingRanker: null,
      runtime: null
    }),
    /require the concept-ID-keyed authored-realizations provider/u
  );
});

function standardFixture() {
  const record = {
    id: "standard-cat-sleeps",
    cs: "Kočka spí.",
    en: "The cat sleeps.",
    difficulty: 1,
    topic: "daily-life",
    sceneQuery: "a sleeping cat",
    targets: [{ surface: "Kočka", normalized: "kočka", tokenIndex: 0, playable: true }]
  };
  const usageEntries = new Map();
  const usage = {
    get(id) {
      return usageEntries.get(id) || { count: 0, lastSeen: 0 };
    },
    mark(id) {
      const next = { count: this.get(id).count + 1, lastSeen: 99 };
      usageEntries.set(id, next);
      return { ...next };
    }
  };
  return {
    record,
    provider: {
      records: [record],
      corpusVersion: "standard-test-v1",
      usage,
      difficultyCounts: () => ({ 1: 1, 2: 0, 3: 0 }),
      nextRandom: () => ({ record, fallback: false, requestedWord: "" }),
      nextForWord: (word) => ({ record, fallback: false, requestedWord: czechAdapter.normalization.searchKey(word) }),
      primaryWord: () => "Kočka",
      markUsed: (value) => usage.mark(typeof value === "string" ? value : value.id),
      getRecordById: (id) => id === record.id ? record : null
    }
  };
}

const czechCourse = Object.freeze({
  id: "cz",
  routePrefix: "/cz",
  sourceLanguage: { id: "en", label: "English", locale: "en" },
  targetLanguage: {
    id: "cs",
    label: "Czech",
    locale: "cs-CZ",
    script: "Latn",
    speechLocale: "cs-CZ",
    direction: "ltr"
  },
  capabilities: {
    wordWorld: true,
    embeddings: true,
    semanticSearch: true,
    dictionary: true,
    speech: true
  },
  languageAdapter: { module: "source/language/adapter.mjs" }
});

test("provider preparation rejects a structurally valid adapter for another target", async () => {
  await assert.rejects(
    prepareWordWorldContext(mandarinCourse, authoredManifest, authoredOptions({
      adapter: czechAdapter
    })),
    /adapter locale cs-CZ does not match course target locale zh-Hans/u
  );
});

const standardManifest = Object.freeze({
  mode: "standard",
  corpusVersion: "standard-test-v1",
  reviewStatus: "course-reviewed",
  sessionProvider: {
    kind: "standard-corpus",
    module: "unused-in-test.mjs",
    meaningSelectorModule: "unused-in-test-core.mjs"
  },
  features: { wordMeanings: true },
  embeddingPolicy: {
    inputLanguage: "en",
    inputField: "embeddingText",
    targetTextAllowed: false,
    fallback: "deterministic-lexical"
  }
});

test("standard preparation preserves legacy selection and optional full-dictionary hooks", async () => {
  const { record, provider } = standardFixture();
  const dictionaryCalls = [];
  const context = await prepareWordWorldContext(czechCourse, standardManifest, {
    adapter: czechAdapter,
    standardProvider: provider,
    embeddingRanker: null,
    meaningSelector: (_payload, surface) => ({
      meaning: "cat",
      pos: "noun",
      lemma: surface.toLocaleLowerCase("cs-CZ"),
      formTags: ["nominative", "singular"]
    }),
    runtime: {
      dictionary: {
        async search(surface, options) {
          dictionaryCalls.push({ surface, options });
          return { results: [] };
        }
      }
    }
  });

  assert.equal(context.providerKind, "standard-corpus");
  assert.equal(context.selectionProvider.records[0], record);
  assert.equal(context.selectionProvider.corpusVersion, provider.corpusVersion);
  assert.equal(context.selectionProvider.nextRandom().record, record);
  assert.equal(context.selectionProvider.nextForWord("Kočka").record, record);
  assert.equal(context.selectionProvider.primaryWord(record), "Kočka");
  assert.equal(context.selectionProvider.getRecordById(record.id), record);

  const prepared = context.sessionRecord(record.id);
  assert.equal(prepared.conceptId, record.id);
  assert.equal(prepared.target.text, record.cs);
  assert.deepEqual(
    context.segment(record.cs).filter(({ type }) => type === "word").map(({ text }) => text),
    ["Kočka", "spí"]
  );
  assert.equal(context.normalization.searchKey(" KOČKA "), "kocka");

  const meaning = await context.lookupMeaning({ record: prepared, token: prepared.target.tokens[0] });
  assert.deepEqual(dictionaryCalls, [{ surface: "Kočka", options: { limit: 8 } }]);
  assert.deepEqual(meaning, {
    meaning: "cat",
    partOfSpeech: "noun",
    metadata: "nominative singular"
  });
  assert.equal(typeof context.fullDictionaryLookup, "function");
  assert.equal(context.generate({ mode: "selected", token: prepared.target.tokens[0] }), prepared);
  assert.equal(context.generate({ mode: "random" }), prepared);
});

test("a Czech standard-token dictionary miss remains a miss instead of a synthetic authored gloss", async () => {
  const { record, provider } = standardFixture();
  const dictionaryCalls = [];
  const context = await prepareWordWorldContext(czechCourse, standardManifest, {
    adapter: czechAdapter,
    standardProvider: provider,
    embeddingRanker: null,
    meaningSelector: () => null,
    runtime: {
      dictionary: {
        async search(surface, options) {
          dictionaryCalls.push({ surface, options });
          return { results: [] };
        }
      }
    }
  });
  const prepared = context.sessionRecord(record.id);

  assert.equal(Object.hasOwn(prepared.target.tokens[0], "gloss"), false);
  assert.equal(await context.lookupMeaning({ record: prepared, token: prepared.target.tokens[0] }), null);
  assert.deepEqual(dictionaryCalls, [{ surface: "Kočka", options: { limit: 8 } }]);
});

test("the Czech standard provider resolves dictionary selection from the shared runtime core", async () => {
  const { provider } = standardFixture();
  const imported = [];
  await prepareWordWorldContext({
    ...czechCourse,
    capabilities: {
      ...czechCourse.capabilities,
      generation: true,
      llm: true
    }
  }, czechWordWorldManifest, {
    origin: "https://caatuu.test",
    adapter: czechAdapter,
    standardProvider: provider,
    embeddingRanker: null,
    runtime: null,
    async importModule(specifier) {
      imported.push(specifier);
      return { selectDictionaryMeaning: () => null };
    }
  });

  assert.deepEqual(imported, [
    "https://caatuu.test/language-runtime/static/source/word-net-core.mjs?v=word-net-core-21"
  ]);
  assert.equal(
    czechWordWorldManifest.sessionProvider.meaningSelectorModule,
    "/language-runtime/static/source/word-net-core.mjs?v=word-net-core-21"
  );
});

test("generation strategy declarations cannot forge entry into the Czech implementation", () => {
  const futureCourse = {
    ...czechCourse,
    id: "es",
    targetLanguage: {
      id: "es",
      label: "Spanish",
      locale: "es-ES",
      script: "Latn",
      speechLocale: "es-ES",
      direction: "ltr"
    },
    capabilities: {
      ...czechCourse.capabilities,
      generation: true,
      llm: true
    }
  };
  assert.throws(
    () => resolveWordWorldGenerationStrategy(futureCourse, {
      generationStrategy: {
        id: "spanish-local-word-world-v1",
        targetLanguageTag: "es-ES",
        auditLanguageTag: "en",
        sentenceModelKey: "spanish-sentence-model-v1",
        translationModelKey: "spanish-english-model-v1"
      }
    }),
    /has no registered shared-runtime implementation/u
  );
  assert.throws(
    () => resolveWordWorldGenerationStrategy({
      ...czechCourse,
      capabilities: {
        ...czechCourse.capabilities,
        generation: true,
        llm: true
      }
    }, {
      generationStrategy: {
        ...czechWordWorldManifest.generationStrategy,
        sentenceModelKey: "forged-czech-sentence-model-v1"
      }
    }),
    /sentenceModelKey must exactly match the registered/u
  );
});

test("standard corpus construction hydrates validated course-scoped usage before selection", async () => {
  const { provider } = standardFixture();
  const loaderCalls = [];
  const storageKeys = [];
  const storedUsage = {
    version: 1,
    corpusVersion: "standard-test-v1",
    entries: {
      "standard-cat-sleeps": [4, 1700000000000],
      malformed: [-1, "yesterday"]
    }
  };
  const course = {
    ...czechCourse,
    storage: { namespace: "caatuu-czech" },
    capabilities: { ...czechCourse.capabilities, dictionary: false }
  };
  const manifest = {
    ...standardManifest,
    sessionProvider: {
      kind: "standard-corpus",
      module: "source/games/word-world/word-net-standard.mjs?v=word-net-standard-5"
    }
  };
  await prepareWordWorldContext(course, manifest, {
    origin: "https://caatuu.test",
    adapter: czechAdapter,
    embeddingRanker: null,
    now: () => 1700000000001,
    random: () => 0.25,
    runtime: null,
    storage: {
      getItem(key) {
        storageKeys.push(key);
        return JSON.stringify(storedUsage);
      }
    },
    async importModule(specifier) {
      assert.equal(specifier, "https://caatuu.test/cz/source/games/word-world/word-net-standard.mjs?v=word-net-standard-5");
      return {
        async loadStandardWordWorldCorpus(options) {
          loaderCalls.push(options);
          return provider;
        }
      };
    }
  });

  assert.deepEqual(storageKeys, ["caatuu-czech.wordNet.standardUsage.v1"]);
  assert.equal(loaderCalls.length, 1);
  assert.equal(loaderCalls[0].manifestUrl, "https://caatuu.test/cz/data/games/word-world/manifest.json");
  assert.deepEqual(loaderCalls[0].usageEntries, {
    version: 1,
    corpusVersion: "standard-test-v1",
    entries: { "standard-cat-sleeps": [4, 1700000000000] }
  });
  assert.equal(loaderCalls[0].now(), 1700000000001);
  assert.equal(loaderCalls[0].random(), 0.25);
});

test("authored glosses survive an unavailable optional dictionary", async () => {
  const options = authoredOptions({
    fullDictionaryLookup: async () => {
      throw new Error("dictionary offline");
    },
    runtime: null
  });
  const dictionaryCapableCourse = {
    ...mandarinCourse,
    capabilities: { ...mandarinCourse.capabilities, dictionary: true }
  };
  const context = await prepareWordWorldContext(dictionaryCapableCourse, authoredManifest, options);
  const record = context.sessionRecord("ww.object.book");
  const result = await context.lookupMeaning({ record, token: record.target.tokens.at(-1) });
  assert.equal(result.meaning, "book");
});

test("preparation rejects a non-English embedding policy even with an injected ranker", async () => {
  const unsafeManifest = structuredClone(authoredManifest);
  unsafeManifest.embeddingPolicy.inputLanguage = "zh";
  await assert.rejects(
    prepareWordWorldContext(mandarinCourse, unsafeManifest, authoredOptions()),
    /authored English embeddingText only/u
  );
});

test("mountWordWorld lazily delegates one prepared context to a replaceable renderer", async () => {
  const calls = [];
  const root = { id: "fixture-root" };
  const result = await mountWordWorld(root, mandarinCourse, authoredManifest, authoredOptions({
    mountRenderer(receivedRoot, context, rendererOptions) {
      calls.push({ receivedRoot, context, rendererOptions });
      return { mounted: true, conceptCount: context.session.records.length };
    }
  }));

  assert.deepEqual(result, { mounted: true, conceptCount: 250 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].receivedRoot, root);
  assert.equal(calls[0].rendererOptions.providerContext, calls[0].context);
  assert.equal(Object.isFrozen(calls[0].context), true);
  assert.equal(calls[0].rendererOptions.lookupMeaning, calls[0].rendererOptions.providerContext.lookupMeaning);
  assert.equal(calls[0].rendererOptions.sceneForRecord, calls[0].rendererOptions.providerContext.sceneForRecord);

  const source = await readFile(
    new URL("../static/source/word-world-provider.mjs", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(source, /import\s*\{[^}]*mountProductWordWorld[^}]*\}\s*from/su);
  assert.match(source, /options\.rendererModule \|\| DEFAULT_RENDERER_MODULE/u);
  assert.doesNotMatch(source, /(?:zh-hans|mandarin-simplified|course\.id\s*[!=]==?)/iu);
});
