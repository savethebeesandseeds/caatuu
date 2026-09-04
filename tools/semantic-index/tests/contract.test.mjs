import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  ENGLISH_EMBEDDING_INPUT_POLICY,
  ENGLISH_EMBEDDING_TEXT_FIELD,
  SEMANTIC_INDEX_CONTRACT_NAME,
  SEMANTIC_INDEX_CONTRACT_VERSION,
  TARGET_REALIZATIONS_TABLE,
  curriculumEnglishEmbeddingInput,
  defineSemanticIndexConfig,
  manualEnglishDescriptionEmbeddingInput,
  prepareSemanticCurriculumRecord,
  prepareSemanticCurriculumRows,
  semanticIndexArtifactPaths,
  validateAuthoredEnglishEmbeddingText,
  validateSemanticIndexManifest,
} from "../src/contract.mjs";
import { czechSemanticIndexConfig } from "../configs/czech-compat.mjs";

const modelId = "all-minilm-l6-v2-qint8-v0.1";
const semanticIndexRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(semanticIndexRoot, "..", "..");

test("the contract fixes one shared English embedding policy", () => {
  assert.equal(SEMANTIC_INDEX_CONTRACT_NAME, "caatuu-semantic-index");
  assert.equal(SEMANTIC_INDEX_CONTRACT_VERSION, 1);
  assert.equal(ENGLISH_EMBEDDING_TEXT_FIELD, "english_text");
  assert.equal(ENGLISH_EMBEDDING_INPUT_POLICY, "english_text_only");
  assert.equal(TARGET_REALIZATIONS_TABLE, "target_realizations");

  const input = curriculumEnglishEmbeddingInput({
    english_text: "A child reads a book.",
    target_text: "一个孩子读一本书。",
  }, { targetTextFields: ["target_text"] });
  assert.deepEqual(input, {
    text: "A child reads a book.",
    locale: "en",
    textField: "english_text",
    inputPolicy: "english_text_only",
  });
});

test("target-language fields cannot be configured as embedding input", () => {
  assert.throws(
    () => curriculumEnglishEmbeddingInput({ target_text: "一个孩子读一本书。" }, {
      recordField: "target_text",
      targetTextFields: ["target_text"],
    }),
    /Refusing curriculum embedding field/u,
  );
  assert.throws(
    () => curriculumEnglishEmbeddingInput({ english_text: "A child reads a book." }, {
      targetTextFields: ["english_text"],
    }),
    /Refusing to embed target-language field english_text/u,
  );
  assert.throws(
    () => curriculumEnglishEmbeddingInput({ target_text: "一个孩子读一本书。" }),
    /english_text must be a non-empty string/u,
  );
});

test("the embedding boundary mechanically rejects mislabeled non-English script", () => {
  for (const text of [
    "一个孩子读一本书。",
    "Příliš žluťoučký kůň.",
    "Łódź is a city.",
    "Ребенок читает книгу.",
    "Cafe\u0301 is nearby.",
    "１２３ apples.",
    "Hello 👋",
    "hello\u064e",
  ]) {
    assert.throws(
      () => curriculumEnglishEmbeddingInput({ english_text: text }),
      /cannot be embedded as English|normalized authored-English/u,
    );
    assert.throws(
      () => manualEnglishDescriptionEmbeddingInput({ description: text }),
      /cannot be embedded as English|normalized authored-English/u,
    );
  }
  assert.throws(
    () => curriculumEnglishEmbeddingInput({ english_text: "1234?!" }),
    /must contain authored English Latin text/u,
  );
  assert.equal(
    validateAuthoredEnglishEmbeddingText("A child reads a book.", "fixture"),
    "A child reads a book.",
  );
});

test("mislabeled English text cannot equal a target-owned realization", () => {
  assert.throws(
    () => curriculumEnglishEmbeddingInput({
      english_text: "Pes je tady.",
      target_text: "  PES   JE TADY. ",
    }, { targetTextFields: ["target_text"] }),
    /matches target-owned field target_text/u,
  );
});

test("semantic preparation rejects forged non-English embedding policy configs", () => {
  const valid = chineseFixtureConfig();
  const row = {
    id: "concept-0001",
    english_text: "A child reads a book.",
    target_text: "一个孩子读一本书。",
  };
  assert.throws(
    () => prepareSemanticCurriculumRecord(row, {
      ...valid,
      embedding: { ...valid.embedding, sourceLocale: "zh-Hans" },
    }),
    /must declare en\/english_text\/english_text_only/u,
  );
});

test("target realization data is separated from the embedding document", () => {
  const config = chineseFixtureConfig();
  const prepared = prepareSemanticCurriculumRecord({
    id: "concept-0001",
    english_text: "A child reads a book.",
    target_text: "一个孩子读一本书。",
    pinyin: "Yí ge háizi dú yì běn shū.",
    topic: "school",
    token_spans: [[0, 2], [2, 4]],
    reviewed_by: "fixture-reviewer",
  }, config);

  assert.deepEqual(prepared.embeddingDocument, {
    id: "curriculum-en-concept-0001",
    sourceKind: "curriculum",
    sourceId: "concept-0001",
    locale: "en",
    body: "A child reads a book.",
    metadata: { topic: "school" },
  });
  assert.equal(Object.hasOwn(prepared.embeddingDocument.metadata, "target_text"), false);
  assert.equal(Object.hasOwn(prepared.embeddingDocument.metadata, "pinyin"), false);
  assert.deepEqual(prepared.targetRealization, {
    id: "zh:zh-Hans:concept-0001",
    conceptId: "concept-0001",
    semanticDocumentId: "curriculum-en-concept-0001",
    courseId: "zh",
    locale: "zh-Hans",
    targetText: "一个孩子读一本书。",
    pronunciation: "Yí ge háizi dú yì běn shū.",
    linguisticMetadata: { token_spans: [[0, 2], [2, 4]] },
    reviewMetadata: { reviewed_by: "fixture-reviewer" },
  });
});

test("configs reject target-owned fields in semantic metadata", () => {
  assert.throws(
    () => defineSemanticIndexConfig({
      ...chineseFixtureConfigInput(),
      record: {
        ...chineseFixtureConfigInput().record,
        semanticMetadataFields: ["topic", "target_text"],
      },
    }),
    /cannot be stored in embedding document metadata/u,
  );
  assert.throws(
    () => defineSemanticIndexConfig({
      ...chineseFixtureConfigInput(),
      target: { locale: "zh-Hans", textField: "english_text" },
    }),
    /cannot be english_text/u,
  );
});

test("IDs and repository paths reject traversal and duplicate concepts", () => {
  assert.throws(
    () => defineSemanticIndexConfig({
      ...chineseFixtureConfigInput(),
      storage: {
        ...chineseFixtureConfigInput().storage,
        repositoryRoot: "../outside",
      },
    }),
    /repository-relative POSIX path/u,
  );
  assert.throws(
    () => semanticIndexArtifactPaths(chineseFixtureConfig(), "../model"),
    /modelId has an invalid value/u,
  );
  const row = {
    id: "concept-0001",
    english_text: "A child reads a book.",
    target_text: "一个孩子读一本书。",
    pinyin: "Yí ge háizi dú yì běn shū.",
  };
  assert.throws(
    () => prepareSemanticCurriculumRows([row, { ...row }], chineseFixtureConfig()),
    /Duplicate concept id/u,
  );
});

test("generic path derivation is course-scoped while Czech compatibility paths stay unchanged", () => {
  const czechPaths = semanticIndexArtifactPaths(czechSemanticIndexConfig, modelId);
  assert.equal(
    czechPaths.repository.database,
    "apps/languages/czech/static/data/embeddings/all-minilm-l6-v2-qint8-v0.1/caatuu-cz-curriculum.sqlite",
  );
  assert.equal(
    czechPaths.route.database,
    "/cz/data/embeddings/all-minilm-l6-v2-qint8-v0.1/caatuu-cz-curriculum.sqlite",
  );
  assert.equal(
    czechPaths.manifest.database,
    "all-minilm-l6-v2-qint8-v0.1/caatuu-cz-curriculum.sqlite",
  );

  const chinesePaths = semanticIndexArtifactPaths(chineseFixtureConfig(), modelId);
  assert.equal(
    chinesePaths.repository.database,
    "apps/languages/mandarin-simplified/static/data/embeddings/all-minilm-l6-v2-qint8-v0.1/caatuu-zh-curriculum.sqlite",
  );
  assert.equal(
    chinesePaths.route.database,
    "/zh/data/embeddings/all-minilm-l6-v2-qint8-v0.1/caatuu-zh-curriculum.sqlite",
  );
  assert.equal(path.posix.basename(chinesePaths.repository.database), "caatuu-zh-curriculum.sqlite");
});

test("manifest validation accepts the current Czech schema alias but enforces English input", () => {
  const manifest = {
    schema_name: "caatuu-cz-vector-db",
    schema_version: 1,
    embedding_text_field: "english_text",
    embedding_input_policy: "english_text_only",
    file: "caatuu-cz-curriculum.sqlite",
    url: `${modelId}/caatuu-cz-curriculum.sqlite`,
  };
  assert.equal(validateSemanticIndexManifest(manifest, czechSemanticIndexConfig, { modelId }), true);
  assert.throws(
    () => validateSemanticIndexManifest({ ...manifest, embedding_text_field: "czech_text" }, czechSemanticIndexConfig),
    /must embed english_text/u,
  );
  assert.throws(
    () => validateSemanticIndexManifest({ ...manifest, embedding_input_policy: "target_text" }, czechSemanticIndexConfig),
    /must use english_text_only/u,
  );
});

test("the tracked Czech manifest remains valid through the compatibility adapter", async () => {
  const manifestFile = path.join(
    repositoryRoot,
    "apps",
    "languages",
    "czech",
    "static",
    "data",
    "embeddings",
    modelId,
    "manifest.json",
  );
  const manifest = JSON.parse(await fs.readFile(manifestFile, "utf8"));
  assert.equal(validateSemanticIndexManifest(manifest, czechSemanticIndexConfig, { modelId }), true);
});

test("the current Czech curriculum validates without placing Czech text in embedding metadata", async () => {
  const sourceFile = path.join(
    repositoryRoot,
    "tools",
    "czech-ml",
    "data",
    "curriculum",
    "core-v0.2",
    "curated",
    "curriculum-core.en.jsonl",
  );
  const rows = (await fs.readFile(sourceFile, "utf8"))
    .split(/\r?\n/u)
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
  const prepared = prepareSemanticCurriculumRows(rows, czechSemanticIndexConfig);
  assert.equal(prepared.length, rows.length);
  assert.equal(prepared.length > 0, true);
  assert.equal(prepared.every((item) => item.embeddingInput.locale === "en"), true);
  assert.equal(prepared.every((item) => item.targetRealization.locale === "cs"), true);
  assert.equal(
    prepared.every((item) => !Object.hasOwn(item.embeddingDocument.metadata, "czech_text")),
    true,
  );
});

test("the Czech SQL schema has a separate target-realization overlay", async () => {
  const require = createRequire(import.meta.url);
  const sqlJsRoot = path.join(
    repositoryRoot,
    "apps",
    "languages",
    "czech",
    "static",
    "vendor",
    "sql.js",
  );
  const initSqlJs = require(path.join(sqlJsRoot, "sql-wasm.js"));
  const SQL = await initSqlJs({ locateFile: () => path.join(sqlJsRoot, "sql-wasm.wasm") });
  const schema = await fs.readFile(path.join(repositoryRoot, "tools", "czech-ml", "vector-schema.sql"), "utf8");
  const db = new SQL.Database();
  try {
    db.run(schema);
    const tableNames = db.exec("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")[0].values.flat();
    assert.equal(tableNames.includes("target_realizations"), true);
    const metaRows = db.exec(
      "SELECT key, value FROM schema_meta WHERE key LIKE 'semantic_contract_%' OR key = 'target_realizations_table' ORDER BY key",
    )[0].values;
    assert.deepEqual(metaRows, [
      ["semantic_contract_name", "caatuu-semantic-index"],
      ["semantic_contract_version", "1"],
      ["target_realizations_table", "target_realizations"],
    ]);
    const columns = db.exec("PRAGMA table_info(target_realizations)")[0].values.map((row) => row[1]);
    assert.deepEqual(columns, [
      "id",
      "concept_id",
      "semantic_document_id",
      "course_id",
      "locale",
      "target_text",
      "pronunciation_json",
      "linguistic_metadata_json",
      "review_metadata_json",
      "created_at",
      "updated_at",
    ]);
    assert.equal(columns.includes("czech_text"), false);
  } finally {
    db.close();
  }
});

function chineseFixtureConfig() {
  return defineSemanticIndexConfig(chineseFixtureConfigInput());
}

function chineseFixtureConfigInput() {
  return {
    indexId: "zh-curriculum-v1",
    courseId: "zh",
    target: {
      locale: "zh-Hans",
      textField: "target_text",
      pronunciationField: "pinyin",
    },
    record: {
      idField: "id",
      semanticMetadataFields: ["topic"],
      linguisticMetadataFields: ["token_spans"],
      reviewMetadataFields: ["reviewed_by"],
    },
    storage: {
      repositoryRoot: "apps/languages/mandarin-simplified/static/data/embeddings",
      routeRoot: "/zh/data/embeddings",
      manifestUrlRoot: "data/embeddings",
      databaseFile: "caatuu-zh-curriculum.sqlite",
    },
  };
}
