import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { prepareSemanticRows, validateLanguageContent } from "../../language-content/lib/content-contract.mjs";
import { czechSemanticIndexConfig } from "../configs/czech-compat.mjs";
import { mandarinSimplifiedSemanticIndexConfig } from "../configs/mandarin-simplified.mjs";
import {
  ENGLISH_EMBEDDING_INPUT_POLICY,
  ENGLISH_EMBEDDING_TEXT_FIELD,
  prepareSemanticCurriculumRows,
  semanticIndexArtifactPaths
} from "../src/contract.mjs";

const repositoryRoot = new URL("../../../", import.meta.url);
const concepts = JSON.parse(await readFile(
  new URL("apps/languages/shared/english-concepts/word-world-starter-v1.json", repositoryRoot),
  "utf8"
));
const realizations = JSON.parse(await readFile(
  new URL("apps/languages/mandarin-simplified/content/word-world/starter-v1.realizations.json", repositoryRoot),
  "utf8"
));

test("Mandarin instantiates the generic English-only semantic-index contract", () => {
  const config = mandarinSimplifiedSemanticIndexConfig;
  assert.equal(config.contract.name, "caatuu-semantic-index");
  assert.equal(config.courseId, "zh");
  assert.equal(config.embedding.sourceLocale, "en");
  assert.equal(config.embedding.textField, ENGLISH_EMBEDDING_TEXT_FIELD);
  assert.equal(config.embedding.inputPolicy, ENGLISH_EMBEDDING_INPUT_POLICY);
  assert.equal(config.target.locale, "zh-Hans");
  assert.equal(config.target.textField, "target_text");
  assert.equal(config.target.pronunciationField, "pronunciation");
  assert.equal(config.contentPolicy, "mandarin-simplified-v1");
  assert.equal(config.record.semanticMetadataFields.includes("tokens"), false);
  assert.equal(config.record.semanticMetadataFields.includes("content_review"), false);

  const paths = semanticIndexArtifactPaths(config, "all-minilm-l6-v2-qint8-v0.1");
  assert.equal(
    paths.repository.database,
    "apps/languages/mandarin-simplified/static/data/embeddings/all-minilm-l6-v2-qint8-v0.1/caatuu-zh-curriculum.sqlite"
  );
  assert.equal(
    paths.route.database,
    "/zh/data/embeddings/all-minilm-l6-v2-qint8-v0.1/caatuu-zh-curriculum.sqlite"
  );
});

test("all 16 prepared embedding documents are English while target realizations remain separate", () => {
  validateLanguageContent(structuredClone(concepts), structuredClone(realizations));
  const semanticRows = prepareSemanticRows(structuredClone(concepts), structuredClone(realizations));
  const prepared = prepareSemanticCurriculumRows(semanticRows, mandarinSimplifiedSemanticIndexConfig);
  assert.equal(prepared.length, 16);
  assert.equal(prepared.every(({ embeddingInput }) => embeddingInput.locale === "en"), true);
  assert.equal(prepared.every(({ targetRealization }) => targetRealization.locale === "zh-Hans"), true);

  const embeddingJson = JSON.stringify(prepared.map(({ embeddingDocument }) => embeddingDocument));
  assert.doesNotMatch(embeddingJson, /\p{Script=Han}/u);
  assert.doesNotMatch(embeddingJson, /[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜü]/iu);
  assert.doesNotMatch(embeddingJson, /"(?:target_text|targetText|pronunciation|tokens|content_review|content_license)"/u);

  const target = prepared.find(({ conceptId }) => conceptId === "ww.question.go-to-park");
  assert.equal(target.embeddingDocument.body, "Inviting someone to go to a park.");
  assert.equal(target.targetRealization.targetText, "你想去公园吗？");
  assert.deepEqual(target.targetRealization.pronunciation, {
    system: "pinyin",
    notation: "Nǐ xiǎng qù gōngyuán ma?",
    languageTag: "zh-Latn-pinyin",
    reviewed: false
  });
  assert.deepEqual(
    target.targetRealization.linguisticMetadata.tokens.map(({ surface }) => surface),
    ["你", "想", "去", "公园", "吗"]
  );
  assert.equal(target.targetRealization.reviewMetadata.content_review.status, "native-review-required");
});

test("adding Mandarin does not alter Czech compatibility identity or artifact paths", () => {
  const paths = semanticIndexArtifactPaths(czechSemanticIndexConfig, "all-minilm-l6-v2-qint8-v0.1");
  assert.equal(czechSemanticIndexConfig.courseId, "czech");
  assert.equal(czechSemanticIndexConfig.compatibility.publishedSchema.name, "caatuu-cz-vector-db");
  assert.equal(
    paths.repository.database,
    "apps/languages/czech/static/data/embeddings/all-minilm-l6-v2-qint8-v0.1/caatuu-cz-curriculum.sqlite"
  );
});
