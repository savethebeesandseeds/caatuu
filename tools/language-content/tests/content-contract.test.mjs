import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  AUTHORED_TOKENIZATION_METHOD,
  ENGLISH_EMBEDDING_FIELD,
  ENGLISH_EMBEDDING_LANGUAGE,
  ENGLISH_EMBEDDING_POLICY,
  LanguageContentError,
  loadAndValidateLanguageContent,
  normalizeSentenceForTokenComparison,
  prepareEnglishEmbeddingDocuments,
  prepareEnglishEmbeddingInputs,
  prepareSemanticRows,
  validateLanguageContent
} from "../lib/content-contract.mjs";
import {
  ENGLISH_CONCEPT_RUNTIME_SCHEMA,
  TARGET_REALIZATION_RUNTIME_SCHEMA,
  validateEnglishConceptRuntimeProjection,
  validateTargetRealizationRuntimeProjection
} from "../lib/runtime-projection-contract.mjs";
import { defineTargetContentPolicy } from "../policies/contract.mjs";
import { MANDARIN_SIMPLIFIED_CONTENT_POLICY_ID } from "../policies/mandarin-simplified.mjs";

const repositoryRoot = new URL("../../../", import.meta.url);
const conceptsUrl = new URL(
  "apps/languages/shared/english-concepts/word-world-starter-v1.json",
  repositoryRoot
);
const realizationsUrl = new URL(
  "apps/languages/mandarin-simplified/content/word-world/starter-v1.realizations.json",
  repositoryRoot
);
const concepts = JSON.parse(await readFile(conceptsUrl, "utf8"));
const realizations = JSON.parse(await readFile(realizationsUrl, "utf8"));

function pinyin(notation) {
  return { system: "pinyin", notation, languageTag: "zh-Latn-pinyin", reviewed: false };
}

function cloneCatalogs() {
  return {
    concepts: structuredClone(concepts),
    realizations: structuredClone(realizations)
  };
}

function hasIssue(error, code, messagePattern) {
  return error instanceof LanguageContentError && error.issues.some((issue) => (
    issue.code === code && (!messagePattern || messagePattern.test(issue.message))
  ));
}

function assertFixtureFails(mutate, code, messagePattern) {
  const candidate = cloneCatalogs();
  mutate(candidate);
  assert.throws(
    () => validateLanguageContent(candidate.concepts, candidate.realizations),
    (error) => hasIssue(error, code, messagePattern)
  );
}

test("the two versioned schemas and actual 16-record catalogs validate as a development draft", async () => {
  const [conceptSchema, realizationSchema] = await Promise.all([
    readFile(new URL("tools/language-packs/schemas/english-concepts.v1.schema.json", repositoryRoot), "utf8").then(JSON.parse),
    readFile(new URL("tools/language-packs/schemas/target-realizations.v1.schema.json", repositoryRoot), "utf8").then(JSON.parse)
  ]);
  assert.equal(conceptSchema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.equal(realizationSchema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.match(conceptSchema.$id, /english-concepts\.v1/u);
  assert.match(realizationSchema.$id, /target-realizations\.v1/u);
  assert.doesNotMatch(JSON.stringify(realizationSchema), /pinyin|Hans|zh-Hans|zh-CN/u);

  const prepared = validateLanguageContent(structuredClone(concepts), structuredClone(realizations));
  assert.equal(prepared.concepts.concepts.length, 16);
  assert.equal(prepared.realizations.realizations.length, 16);
  assert.equal(prepared.embeddingInputs.length, 16);
  assert.equal(prepared.embeddingDocuments.length, 16);

  const loaded = await loadAndValidateLanguageContent({ repoRoot: repositoryRoot });
  assert.equal(loaded.paths.concepts, "apps/languages/shared/english-concepts/word-world-starter-v1.json");
  assert.equal(loaded.paths.realizations, "apps/languages/mandarin-simplified/content/word-world/starter-v1.realizations.json");
});

test("embedding preparation consumes embeddingText only and emits English-only isolated documents", () => {
  const inputs = prepareEnglishEmbeddingInputs(structuredClone(concepts));
  const documents = prepareEnglishEmbeddingDocuments(structuredClone(concepts));
  assert.equal(inputs.length, 16);
  assert.deepEqual(Object.keys(inputs[0]), ["conceptId", "locale", "textField", "inputPolicy", "text"]);
  for (const [index, input] of inputs.entries()) {
    assert.equal(input.locale, ENGLISH_EMBEDDING_LANGUAGE);
    assert.equal(input.textField, ENGLISH_EMBEDDING_FIELD);
    assert.equal(input.inputPolicy, ENGLISH_EMBEDDING_POLICY);
    assert.equal(input.text, concepts.concepts[index].embeddingText);
  }

  const serialized = JSON.stringify(documents);
  assert.doesNotMatch(serialized, /\p{Script=Han}/u);
  assert.doesNotMatch(serialized, /[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜü]/iu);
  assert.doesNotMatch(serialized, /"(?:targetText|target_text|pinyin|gloss|tokens|linguisticMetadata)"/u);
  assert.equal(documents.every(({ locale }) => locale === "en"), true);
  assert.equal(documents.every(({ body }, index) => body === concepts.concepts[index].embeddingText), true);
});

test("target text, pronunciation, tokens, review, and licensing remain on the realization side", () => {
  const rows = prepareSemanticRows(structuredClone(concepts), structuredClone(realizations));
  const row = rows.find(({ id }) => id === "ww.object.book");
  const input = prepareEnglishEmbeddingInputs(structuredClone(concepts))
    .find(({ conceptId }) => conceptId === row.id);
  assert.equal(input.text, "Identifying a nearby object as a book.");
  assert.equal(row.target_text, "这是一本书。");
  assert.deepEqual(row.pronunciation, pinyin("Zhè shì yì běn shū."));
  assert.deepEqual(row.tokens.map(({ surface }) => surface), ["这", "是", "一", "本", "书"]);
  assert.equal(row.content_review.status, "native-review-required");
  assert.equal(row.content_license.status, "release-review-required");
  assert.equal(row.source_license.status, "release-review-required");
});

test("stable IDs are unique and target coverage is exactly one-to-one", () => {
  assertFixtureFails(({ concepts: candidate }) => {
    candidate.concepts.push(structuredClone(candidate.concepts[0]));
  }, "concepts.duplicate", /ww\.greeting\.hello/u);

  assertFixtureFails(({ realizations: candidate }) => {
    candidate.realizations.pop();
  }, "coverage.missing", /ww\.comprehension\.not-understand/u);

  assertFixtureFails(({ realizations: candidate }) => {
    candidate.realizations.push({
      conceptId: "ww.extra.orphan",
      text: "这是多余的。",
      pronunciation: pinyin("Zhè shì duōyú de."),
      tokens: [
        { surface: "这", pronunciation: pinyin("zhè"), gloss: "this", playable: true },
        { surface: "是", pronunciation: pinyin("shì"), gloss: "be", playable: true },
        { surface: "多余", pronunciation: pinyin("duōyú"), gloss: "extra", playable: true },
        { surface: "的", pronunciation: pinyin("de"), gloss: "particle", playable: true }
      ]
    });
  }, "coverage.extra", /ww\.extra\.orphan/u);

  assertFixtureFails(({ realizations: candidate }) => {
    candidate.sourceCatalog = "apps/languages/shared/english-concepts/different-v1.json";
  }, "coverage.source-catalog", /word-world-starter-v1\.json/u);
});

test("adversarial target text, pronunciation, tokens, and opaque metadata cannot enter English concepts", () => {
  for (const [field, value] of [
    ["targetText", "你好"],
    ["pronunciation", pinyin("nǐ hǎo")],
    ["tokens", ["你好"]],
    ["gloss", "hello"],
    ["metadata", { target: "你好" }]
  ]) {
    assertFixtureFails(({ concepts: candidate }) => {
      candidate.concepts[0][field] = value;
    }, field === "metadata" ? "concepts.shape" : "embedding.leakage");
  }

  assertFixtureFails(({ concepts: candidate }) => {
    candidate.concepts[0].embeddingText = "A greeting: 你好。";
  }, "embedding.leakage", /embeddingText/u);

  assertFixtureFails(({ concepts: candidate }) => {
    candidate.concepts[0].embeddingText = "Target pronunciation: nǐ hǎo.";
  }, "embedding.leakage", /diacritics/u);
});

test("Mandarin identifiers, authored token coverage, pronunciation, and playable integrity are enforced", () => {
  assert.equal(realizations.targetLanguage.languageTag, "zh-Hans");
  assert.equal(realizations.targetLanguage.speechLocale, "zh-CN");
  assert.equal(realizations.targetLanguage.script, "Hans");
  assert.equal(realizations.contentPolicy, MANDARIN_SIMPLIFIED_CONTENT_POLICY_ID);
  assert.equal(realizations.tokenization.method, AUTHORED_TOKENIZATION_METHOD);

  assertFixtureFails(({ realizations: candidate }) => {
    candidate.contentPolicy = "unregistered-language-v1";
  }, "policy.unknown");

  assertFixtureFails(({ realizations: candidate }) => {
    candidate.targetLanguage.languageTag = "zh_Hans";
  }, "locale.invalid");

  assertFixtureFails(({ realizations: candidate }) => {
    candidate.targetLanguage.speechLocale = "zh-TW";
  }, "mandarin.locale", /zh-Hans/u);

  assertFixtureFails(({ realizations: candidate }) => {
    candidate.realizations[5].tokens.pop();
  }, "tokenization.coverage");

  assertFixtureFails(({ realizations: candidate }) => {
    candidate.realizations[5].tokens[0].pronunciation = null;
  }, "mandarin.pronunciation-missing");

  assertFixtureFails(({ realizations: candidate }) => {
    candidate.realizations[5].pronunciation.system = "ipa";
  }, "mandarin.pronunciation-system");

  assertFixtureFails(({ realizations: candidate }) => {
    candidate.realizations[5].pronunciation.reviewed = true;
  }, "pronunciation.review-consistency");

  assertFixtureFails(({ realizations: candidate }) => {
    for (const token of candidate.realizations[0].tokens) token.playable = false;
  }, "playable.empty");

  assert.equal(normalizeSentenceForTokenComparison(" 这是 一本书。 "), "这是一本书");
});

test("authored word tokens preserve contextual polyphone pronunciation without character splitting", () => {
  const candidate = cloneCatalogs();
  const index = candidate.realizations.realizations.findIndex(({ conceptId }) => conceptId === "ww.action.read-book");
  candidate.realizations.realizations[index] = {
    conceptId: "ww.action.read-book",
    text: "他去银行。",
    pronunciation: pinyin("Tā qù yínháng."),
    tokens: [
      { surface: "他", pronunciation: pinyin("tā"), gloss: "he", playable: true },
      { surface: "去", pronunciation: pinyin("qù"), gloss: "go", playable: true },
      { surface: "银行", pronunciation: pinyin("yínháng"), gloss: "bank", playable: true }
    ]
  };
  validateLanguageContent(candidate.concepts, candidate.realizations);
  const rows = prepareSemanticRows(candidate.concepts, candidate.realizations);
  const polyphone = rows.find(({ id }) => id === "ww.action.read-book");
  assert.deepEqual(polyphone.tokens.map(({ surface }) => surface), ["他", "去", "银行"]);
  assert.equal(polyphone.tokens[2].pronunciation.notation, "yínháng");
  assert.equal(polyphone.tokens.some(({ surface }) => surface === "行"), false);

  const implicit = cloneCatalogs();
  implicit.realizations.tokenization.method = "implicit-codepoint";
  assert.throws(
    () => validateLanguageContent(implicit.concepts, implicit.realizations),
    (error) => hasIssue(error, "tokenization.authority", /never implicit character splitting/u)
  );
});

test("a synthetic non-Mandarin policy proves the shared schema permits language-specific null pronunciation", () => {
  const syntheticPolicy = defineTargetContentPolicy({
    id: "synthetic-latin-v1",
    validate: () => []
  });
  const syntheticConcepts = structuredClone(concepts);
  syntheticConcepts.id = "synthetic-concepts-v1";
  syntheticConcepts.concepts = [structuredClone(concepts.concepts[0])];
  const syntheticRealizations = {
    $schema: "https://caatuu.org/schemas/target-realizations.v1.schema.json",
    schemaVersion: 1,
    courseId: "spanish-test",
    targetLanguage: {
      languageTag: "es",
      speechLocale: "es-ES",
      script: "Latn"
    },
    sourceCatalog: "apps/languages/shared/english-concepts/synthetic-concepts-v1.json",
    contentPolicy: syntheticPolicy.id,
    tokenization: {
      method: "authored-word-tokens",
      characterFallbackAllowed: false,
      pronunciationAuthority: "authored-contextual-token"
    },
    review: structuredClone(realizations.review),
    license: structuredClone(realizations.license),
    realizations: [{
      conceptId: syntheticConcepts.concepts[0].id,
      text: "¡Hola!",
      pronunciation: null,
      tokens: [{ surface: "Hola", pronunciation: null, gloss: "hello", playable: true }]
    }]
  };
  const prepared = validateLanguageContent(syntheticConcepts, syntheticRealizations, {
    contentPolicy: syntheticPolicy
  });
  assert.equal(prepared.realizations.targetLanguage.languageTag, "es");
  assert.equal(prepared.realizations.realizations[0].pronunciation, null);
});

test("public catalogs use narrow runtime projection schemas and omit unreviewed pronunciation", async () => {
  const englishDerivedFrom = "apps/languages/shared/english-concepts/word-world-starter-v1.json";
  const targetDerivedFrom =
    "apps/languages/mandarin-simplified/content/word-world/starter-v1.realizations.json";
  const [englishProjection, targetProjection, englishSchema, targetSchema] = await Promise.all([
    readFile(
      new URL("apps/language-runtime/static/data/english-concepts/word-world-starter-v1.json", repositoryRoot),
      "utf8"
    ).then(JSON.parse),
    readFile(
      new URL(
        "apps/languages/mandarin-simplified/static/data/games/word-world/starter-v1.realizations.json",
        repositoryRoot
      ),
      "utf8"
    ).then(JSON.parse),
    readFile(
      new URL("apps/language-runtime/static/schemas/english-concepts.runtime.v1.schema.json", repositoryRoot),
      "utf8"
    ).then(JSON.parse),
    readFile(
      new URL("apps/language-runtime/static/schemas/target-realizations.runtime.v1.schema.json", repositoryRoot),
      "utf8"
    ).then(JSON.parse)
  ]);
  assert.equal(englishSchema.$id, ENGLISH_CONCEPT_RUNTIME_SCHEMA);
  assert.equal(targetSchema.$id, TARGET_REALIZATION_RUNTIME_SCHEMA);
  validateEnglishConceptRuntimeProjection(englishProjection, {
    source: concepts,
    expectedDerivedFrom: englishDerivedFrom
  });
  validateTargetRealizationRuntimeProjection(targetProjection, {
    source: realizations,
    expectedDerivedFrom: targetDerivedFrom
  });
  assert.equal(targetProjection.projectionPolicy.pronunciationIncluded, false);
  assert.doesNotMatch(JSON.stringify(targetProjection), /"pronunciation"/u);
  assert.throws(
    () => validateTargetRealizationRuntimeProjection({
      ...structuredClone(targetProjection),
      realizations: targetProjection.realizations.map((record, index) => index === 0
        ? { ...record, pronunciation: pinyin("Nǐ hǎo!") }
        : record)
    }, { source: realizations, expectedDerivedFrom: targetDerivedFrom }),
    /must be omitted/u
  );
});

test("the current draft passes development validation and is blocked by both release gates", () => {
  validateLanguageContent(structuredClone(concepts), structuredClone(realizations));
  assert.throws(
    () => validateLanguageContent(structuredClone(concepts), structuredClone(realizations), { release: true }),
    (error) => (
      hasIssue(error, "release.native-review")
      && hasIssue(error, "release.license", /concept catalog/u)
      && hasIssue(error, "release.license", /target catalog/u)
    )
  );
});

test("only a synthetic fully evidenced fixture can pass the release gate", () => {
  const candidate = cloneCatalogs();
  candidate.realizations.review = {
    status: "native-reviewed",
    reviewer: "Synthetic Test Reviewer",
    reviewedAt: "2026-08-29T00:00:00Z",
    notes: "Synthetic test evidence only; not copied to the tracked content."
  };
  for (const realization of candidate.realizations.realizations) {
    if (realization.pronunciation) realization.pronunciation.reviewed = true;
    for (const token of realization.tokens) {
      if (token.pronunciation) token.pronunciation.reviewed = true;
    }
  }
  for (const gate of [candidate.concepts.license, candidate.realizations.license]) {
    gate.status = "release-cleared";
    gate.spdxExpression = "LicenseRef-Synthetic-Test-Only";
    gate.sourceReference = "test-fixture://not-release-evidence";
    gate.reviewedBy = "Synthetic Test Reviewer";
    gate.reviewedAt = "2026-08-29T00:00:00Z";
  }
  validateLanguageContent(candidate.concepts, candidate.realizations, { release: true });
  assert.equal(realizations.review.status, "native-review-required");
  assert.equal(realizations.license.status, "release-review-required");
  assert.equal(concepts.license.status, "release-review-required");
});
