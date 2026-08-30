import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  CourseCatalogError,
  createSafeEmbeddingPayload,
  joinConceptCatalogs,
  learnerFeaturePolicy,
  rankConcepts,
  rankConceptsWithStatus,
  rankConceptsLexically,
  selectConceptBySeed,
  validateEnglishConceptCatalog,
  validateTargetRealizationCatalog
} from "../static/source/catalog-runtime.mjs";
import {
  createWordWorldSession,
  wordWorldPresentation
} from "../static/source/browser-shell.mjs";
import { importBrowserLanguageAdapter } from "./browser-module-loader.mjs";

const [mandarinAdapter, czechAdapter] = await Promise.all([
  importBrowserLanguageAdapter("../../languages/mandarin-simplified/static/source/language/adapter.mjs"),
  importBrowserLanguageAdapter("../../languages/czech/static/source/language/adapter.mjs")
]);

async function json(relativeUrl) {
  return JSON.parse(await readFile(new URL(relativeUrl, import.meta.url), "utf8"));
}

const englishCatalog = await json("../static/data/english-concepts/word-world-starter-v1.json");
const realizationCatalog = await json("../../languages/mandarin-simplified/static/data/games/word-world/starter-v1.realizations.json");
const course = await json("../../languages/mandarin-simplified/course.json");

test("joins language-neutral English concepts to target realizations by stable conceptId", () => {
  assert.equal(validateEnglishConceptCatalog(englishCatalog), englishCatalog);
  assert.equal(validateTargetRealizationCatalog(realizationCatalog), realizationCatalog);
  const joined = joinConceptCatalogs(englishCatalog, realizationCatalog);
  assert.equal(joined.length, 16);
  assert.equal(new Set(joined.map(({ conceptId }) => conceptId)).size, joined.length);
  assert.equal(joined.find(({ conceptId }) => conceptId === "ww.object.book").target.text, "这是一本书。");
  assert.equal(joined.find(({ conceptId }) => conceptId === "ww.object.book").englishText, "This is a book.");
  assert.ok(Object.isFrozen(joined));
  assert.ok(Object.isFrozen(joined[0].target.tokens));
});

test("embedding payloads contain only English embeddingText plus stable identifiers", () => {
  const joined = joinConceptCatalogs(englishCatalog, realizationCatalog);
  const payload = createSafeEmbeddingPayload(joined, "find a friendly greeting");
  assert.deepEqual(Object.keys(payload), ["inputLanguage", "query", "candidates"]);
  assert.deepEqual(Object.keys(payload.query), ["embeddingText"]);
  assert.ok(payload.candidates.every((candidate) => {
    assert.deepEqual(Object.keys(candidate), ["conceptId", "embeddingText"]);
    return candidate.embeddingText.length > 0;
  }));
  const serialized = JSON.stringify(payload);
  assert.doesNotMatch(serialized, /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u);
  assert.doesNotMatch(serialized, /pinyin|target|pronunciation|englishText/iu);
});

test("the injectable ranker receives no target text and invalid hooks fall back deterministically", async () => {
  const joined = joinConceptCatalogs(englishCatalog, realizationCatalog);
  let received;
  const ranked = await rankConcepts(joined, "book", async (payload) => {
    received = payload;
    return payload.candidates.map(({ conceptId }) => ({
      conceptId,
      score: conceptId === "ww.object.book" ? 100 : 0
    }));
  });
  assert.equal(ranked[0].conceptId, "ww.object.book");
  assert.ok(received.candidates.every(({ embeddingText }) => !embeddingText.includes("书")));

  const firstFallback = await rankConcepts(joined, "nearby object book", async () => {
    throw new Error("model unavailable");
  });
  const secondFallback = await rankConcepts(joined, "nearby object book", null);
  assert.deepEqual(
    firstFallback.map(({ conceptId }) => conceptId),
    secondFallback.map(({ conceptId }) => conceptId)
  );
  assert.equal(firstFallback[0].conceptId, "ww.object.book");
});

test("semantic ranking reports whether MiniLM or deterministic fallback produced the order", async () => {
  const joined = joinConceptCatalogs(englishCatalog, realizationCatalog);
  const embedded = await rankConceptsWithStatus(joined, "book", async (payload) => payload.candidates.map(
    ({ conceptId }) => ({ conceptId, score: conceptId === "ww.object.book" ? 1 : 0 })
  ));
  assert.equal(embedded.mode, "embedding");
  assert.equal(embedded.reason, null);
  assert.equal(embedded.records[0].conceptId, "ww.object.book");

  const fallback = await rankConceptsWithStatus(joined, "book", async () => {
    throw new Error("model unavailable");
  });
  assert.equal(fallback.mode, "lexical");
  assert.equal(fallback.reason, "ranker-error");
  assert.equal(fallback.records[0].conceptId, "ww.object.book");

  const unavailable = await rankConceptsWithStatus(joined, "book", null);
  assert.equal(unavailable.mode, "lexical");
  assert.equal(unavailable.reason, "ranker-unavailable");
});

test("English-only embedding boundaries reject target-script leakage", async () => {
  const leakingEnglish = structuredClone(englishCatalog);
  leakingEnglish.concepts[0].embeddingText = "你好";
  assert.throws(
    () => validateEnglishConceptCatalog(leakingEnglish),
    /English-only; a non-English letter was found/
  );
  const joined = joinConceptCatalogs(englishCatalog, realizationCatalog);
  await assert.rejects(
    rankConcepts(joined, "你好", () => []),
    /English-only; a non-English letter was found/
  );
  await assert.rejects(
    rankConcepts(joined, "find книга", () => []),
    /English-only; a non-English letter was found/
  );
  await assert.rejects(
    rankConcepts(joined, "find كتاب", () => []),
    /English-only; a non-English letter was found/
  );
  await assert.rejects(
    rankConcepts(joined, "nǐ hǎo", () => []),
    /English-only; a non-English letter was found/
  );
});

test("lexical ranking and seeded selection are stable without model files", () => {
  const joined = joinConceptCatalogs(englishCatalog, realizationCatalog);
  const first = rankConceptsLexically(joined, "cold weather today");
  const second = rankConceptsLexically(joined.slice().reverse(), "cold weather today");
  assert.equal(first[0].conceptId, "ww.weather.cold-today");
  assert.deepEqual(first.map(({ conceptId }) => conceptId), second.map(({ conceptId }) => conceptId));
  assert.equal(selectConceptBySeed(joined, "zh").conceptId, selectConceptBySeed(joined, "zh").conceptId);
  assert.equal(
    selectConceptBySeed(joined, "daily-preview").conceptId,
    selectConceptBySeed(joined.slice().reverse(), "daily-preview").conceptId
  );
});

test("pronunciation guides require native review while Hanzi text-to-speech does not", () => {
  assert.deepEqual(
    learnerFeaturePolicy({
      wordWorld: true,
      embeddings: true,
      semanticSearch: true,
      speech: true,
      pronunciationGuides: true
    }, { status: "native-review-required" }),
    {
      wordWorld: true,
      semanticSearch: true,
      pronunciationGuides: false,
      speech: true,
      reviewRequired: true
    }
  );
  assert.equal(
    learnerFeaturePolicy({ pronunciationGuides: true }, { status: "native-reviewed" }).pronunciationGuides,
    true
  );
  assert.equal(
    learnerFeaturePolicy({ pronunciationGuides: false }, { status: "native-reviewed" }).pronunciationGuides,
    false
  );
});

test("shared presentation derives language labels and examples without Mandarin-specific copy", async () => {
  const joined = joinConceptCatalogs(englishCatalog, realizationCatalog);
  const presentation = wordWorldPresentation(course, joined);
  assert.equal(presentation.eyebrow, "English meaning → Mandarin");
  assert.match(presentation.lede, /Mandarin sentences by their English meaning/u);
  assert.match(presentation.searchPlaceholder, /greetings, identity, objects/u);

  const synthetic = wordWorldPresentation({
    sourceLanguage: { label: "French" },
    targetLanguage: { label: "Arabic" }
  }, [{ topic: "travel" }, { topic: "daily-life" }]);
  assert.deepEqual(synthetic, {
    sourceLabel: "French",
    targetLabel: "Arabic",
    eyebrow: "French meaning → Arabic",
    lede: "Explore a small, authored set of useful Arabic sentences by their French meaning.",
    searchLabel: "Find by French meaning",
    searchPlaceholder: "Try travel, daily life…",
    searchLanguageError: "Search is French-only. Try a French meaning."
  });

  const source = await readFile(new URL("../static/source/browser-shell.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /zh-Latn-pinyin|Simplified Mandarin|useful Mandarin sentences/u);
});

test("browser-shell prepares sessions and contains no alternate Word World renderer", async () => {
  const source = await readFile(new URL("../static/source/browser-shell.mjs", import.meta.url), "utf8");
  assert.match(source, /export function createPreparedWordWorldSession/u);
  assert.doesNotMatch(source, /export function renderWordWorld/u);
  assert.doesNotMatch(source, /\.createElement\(|\.replaceChildren\(|\.innerHTML\s*=/u);
});

test("authored token integrity is mandatory and never replaced with guessed character splits", () => {
  const broken = structuredClone(realizationCatalog);
  broken.realizations[5].tokens = [{ surface: "书", gloss: "book", playable: true }];
  assert.throws(
    () => validateTargetRealizationCatalog(broken),
    /tokens must reproduce the learner-facing text in order/
  );
  const noTokens = structuredClone(realizationCatalog);
  delete noTokens.realizations[0].tokens;
  assert.throws(
    () => validateTargetRealizationCatalog(noTokens),
    /must contain authored word boundaries/
  );
});

test("the browser session keeps TTS available while gating unreviewed pronunciation guides", async () => {
  const session = createWordWorldSession({
    course,
    conceptCatalog: englishCatalog,
    realizationCatalog,
    adapter: mandarinAdapter
  });
  assert.equal(session.adapter.id, "mandarin-simplified");
  assert.equal(session.adapter.segmentation.strategy, "authored");
  assert.equal(session.policy.pronunciationGuides, false);
  assert.equal(session.policy.speech, true);
  assert.equal(session.policy.reviewRequired, true);
  assert.equal((await session.search("student"))[0].conceptId, "ww.identity.student");
  assert.throws(
    () => createWordWorldSession({
      course: { ...course, id: "wrong" },
      conceptCatalog: englishCatalog,
      realizationCatalog,
      adapter: mandarinAdapter
    }),
    CourseCatalogError
  );
  const wrongTarget = structuredClone(realizationCatalog);
  wrongTarget.targetLanguage.languageTag = "zh-Hant";
  assert.throws(
    () => createWordWorldSession({
      course,
      conceptCatalog: englishCatalog,
      realizationCatalog: wrongTarget,
      adapter: mandarinAdapter
    }),
    /Realization target locale must match/u
  );
});

test("regional course and realization locales bind to adapter locale while rendered lang uses primary", () => {
  const regionalCourse = {
    ...course,
    id: "czech-test",
    targetLanguage: { ...course.targetLanguage, locale: "cs-CZ", label: "Czech" }
  };
  const regionalRealizations = {
    ...structuredClone(realizationCatalog),
    courseId: "czech-test",
    targetLanguage: {
      ...realizationCatalog.targetLanguage,
      languageTag: "cs-CZ"
    }
  };
  const session = createWordWorldSession({
    course: regionalCourse,
    conceptCatalog: englishCatalog,
    realizationCatalog: regionalRealizations,
    adapter: czechAdapter
  });
  assert.equal(session.adapter.languageTags.locale, "cs-CZ");
  assert.equal(session.adapter.languageTags.primary, "cs");
});

test("only the schema-defined native-reviewed state can authorize pronunciation guides", () => {
  for (const unsupported of ["approved", "release-approved", "reviewed"]) {
    const policy = learnerFeaturePolicy({ pronunciationGuides: true, speech: true }, { status: unsupported });
    assert.equal(policy.pronunciationGuides, false);
    assert.equal(policy.speech, true);
    assert.equal(policy.reviewRequired, true);
  }
});

test("approved learner pronunciation is revalidated through the selected language adapter", () => {
  const approvedCourse = {
    ...course,
    capabilities: { ...course.capabilities, pronunciationGuides: true }
  };
  const approvedRealizations = structuredClone(realizationCatalog);
  approvedRealizations.review.status = "native-reviewed";
  for (const realization of approvedRealizations.realizations) {
    realization.pronunciation = {
      system: "pinyin",
      notation: "authored contextual reading",
      languageTag: "zh-Latn-pinyin",
      reviewed: true
    };
    for (const token of realization.tokens) {
      token.pronunciation = {
        system: "pinyin",
        notation: "authored token reading",
        languageTag: "zh-Latn-pinyin",
        reviewed: true
      };
    }
  }
  const tamperedRealizations = structuredClone(approvedRealizations);
  tamperedRealizations.realizations[0].tokens[0].pronunciation.reviewed = false;
  assert.doesNotThrow(() => createWordWorldSession({
    course: approvedCourse,
    conceptCatalog: englishCatalog,
    realizationCatalog: approvedRealizations,
    adapter: mandarinAdapter
  }));

  assert.throws(
    () => createWordWorldSession({
      course: approvedCourse,
      conceptCatalog: englishCatalog,
      realizationCatalog: tamperedRealizations,
      adapter: mandarinAdapter
    }),
    /reviewed must be true|authored reviewed pinyin/u
  );
});
