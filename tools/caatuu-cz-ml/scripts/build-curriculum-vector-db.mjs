#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { appDataRoot, caatuuRoot, fromRoot, mlRoot } from "./paths.mjs";

const MODEL_ID = "caatuu-local-hash-v0.1";
const SCHEMA_NAME = "caatuu-cz-vector-db";
const SCHEMA_VERSION = 1;
const EMBEDDING_DIMENSION = 384;
const DB_FILE_NAME = "caatuu-cz-curriculum.sqlite";
const EMBEDDING_TEXT_FIELD = "english_text";
const EMBEDDING_INPUT_POLICY = "english_text_only";
const ASSET_EMBEDDING_TABLE = "asset_embedding_refs";
const ASSET_EMBEDDING_TEXT_FIELD = "manual_english_description";
const ASSET_EMBEDDING_INPUT_POLICY = "manual_english_description_only";
const VECTOR_ENCODING = "float32le";
const DISTANCE_METRIC = "cosine";
const MAX_REVIEW_CANDIDATES = 200;
const ASSET_CATEGORIES = new Set(["character", "ship", "house"]);
const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "at",
  "can",
  "do",
  "does",
  "for",
  "has",
  "have",
  "he",
  "her",
  "his",
  "i",
  "in",
  "is",
  "it",
  "my",
  "not",
  "on",
  "our",
  "she",
  "that",
  "the",
  "their",
  "they",
  "this",
  "to",
  "we",
  "with",
  "you",
]);

function argValue(name, fallback) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback;
}

const datasetDir = path.resolve(argValue("--dataset-dir", fromRoot("data", "curriculum", "core-v0.1")));
const inputFile = path.resolve(argValue("--input-file", path.join(datasetDir, "curated", "curriculum-core.en.jsonl")));
const schemaFile = path.resolve(argValue("--schema-file", path.join(mlRoot, "vector-schema.sql")));
const outDir = path.resolve(argValue("--out-dir", path.join(appDataRoot, "embeddings", MODEL_ID)));
const outFile = path.resolve(argValue("--out-file", path.join(outDir, DB_FILE_NAME)));
const manifestFile = path.resolve(argValue("--manifest-file", path.join(outDir, "manifest.json")));
const embeddingCatalogFile = path.resolve(argValue("--catalog-file", path.join(appDataRoot, "embeddings", "models.json")));
const qualityFile = path.resolve(argValue("--quality-file", path.join(datasetDir, "validation", "vector-quality.json")));
const qualityMarkdownFile = path.resolve(
  argValue("--quality-md-file", path.join(datasetDir, "reports", "vector-quality.md")),
);
const sqlJsModuleFile = path.resolve(
  argValue("--sqljs-module", path.join(caatuuRoot, "apps", "caatuu-czech", "static", "vendor", "sql.js", "sql-wasm.js")),
);
const sqlJsWasmFile = path.resolve(
  argValue("--sqljs-wasm", path.join(caatuuRoot, "apps", "caatuu-czech", "static", "vendor", "sql.js", "sql-wasm.wasm")),
);
const browserVectorDbFile = path.resolve(
  argValue("--browser-vector-db-file", path.join(caatuuRoot, "apps", "caatuu-czech", "static", "vector-db.js")),
);
const assetKeymapFile = path.resolve(
  argValue(
    "--asset-keymap-file",
    path.join(caatuuRoot, "apps", "caatuu-unified", "static", "assets", "characters", "miscellaneous", "keymap.json"),
  ),
);
const setupAssetsFile = path.resolve(
  argValue("--setup-assets-file", path.join(caatuuRoot, "apps", "caatuu-czech", "static", "setup-assets.json")),
);

const rows = await readJsonl(inputFile);
assertRows(rows);
const assetRows = await readAssetKeymap(assetKeymapFile);

const SQL = await loadSqlJs();
const schemaSql = await fs.readFile(schemaFile, "utf8");
const embeddedRows = rows.map((row) => {
  const indexedText = indexedTextFor(row);
  const vector = curriculumEmbedding(row, indexedText);
  return {
    row,
    indexedText,
    vector,
    tokens: contentTokens(row.english_text),
    normalizedText: normalizeText(row.english_text),
  };
});
const embeddedAssetRows = assetRows.map((row) => ({
  row,
  indexedText: row.description,
  vector: assetDescriptionEmbedding(row),
}));

await fs.mkdir(outDir, { recursive: true });
await buildDatabase(SQL, schemaSql, embeddedRows, embeddedAssetRows, outFile);
const manifest = await writeManifest(rows, embeddedAssetRows, outFile, manifestFile);
await writeEmbeddingCatalog(manifest, embeddingCatalogFile);
const setup_assets_file = await updateSetupAssetsManifest(setupAssetsFile, {
  "browser-vector-db-js": browserVectorDbFile,
  "embedding-catalog": embeddingCatalogFile,
  "embedding-manifest": manifestFile,
  "embedding-sqlite": outFile,
});
const quality = await writeQualityReports(embeddedRows, manifest);

console.log(JSON.stringify({
  ok: true,
  rows: rows.length,
  asset_rows: embeddedAssetRows.length,
  db_file: outFile,
  db_bytes: manifest.bytes,
  db_sha256: manifest.sha256,
  manifest_file: manifestFile,
  catalog_file: embeddingCatalogFile,
  asset_keymap_file: assetRows.length ? assetKeymapFile : null,
  setup_assets_file,
  quality_file: qualityFile,
  quality_markdown_file: qualityMarkdownFile,
  near_duplicate_candidates: quality.near_duplicate_candidates.length,
}, null, 2));

async function loadSqlJs() {
  const require = createRequire(import.meta.url);
  const initSqlJs = require(sqlJsModuleFile);
  return initSqlJs({ locateFile: () => sqlJsWasmFile });
}

async function readJsonl(file) {
  const text = await fs.readFile(file, "utf8");
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        error.message = `${file}:${index + 1}: ${error.message}`;
        throw error;
      }
    });
}

function assertRows(rows) {
  if (!rows.length) throw new Error(`No rows found in ${inputFile}`);
  const ids = new Set();
  for (const [index, row] of rows.entries()) {
    for (const field of ["id", "english_text", "czech_text", "topic", "target_words", "grammar_tags"]) {
      if (!(field in row)) throw new Error(`row ${index + 1}: missing required field ${field}`);
    }
    if (ids.has(row.id)) throw new Error(`row ${index + 1}: duplicate id ${row.id}`);
    ids.add(row.id);
    if (!String(row.english_text || "").trim()) throw new Error(`row ${index + 1}: blank english_text`);
    if (typeof row.czech_text !== "string") throw new Error(`row ${index + 1}: czech_text must be a string`);
    if (!Array.isArray(row.target_words)) throw new Error(`row ${index + 1}: target_words must be an array`);
    if (!Array.isArray(row.grammar_tags)) throw new Error(`row ${index + 1}: grammar_tags must be an array`);
  }
}

async function readAssetKeymap(file) {
  let text = "";
  try {
    text = await fs.readFile(file, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }

  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${file}: expected a JSON object keyed by served asset path`);
  }

  const rows = Object.entries(parsed).map(([assetPath, value], index) => {
    if (!assetPath.startsWith("/assets/")) {
      throw new Error(`${file}: entry ${index + 1} key must start with /assets/`);
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`${file}: entry ${assetPath} must be an object`);
    }
    const description = String(value.description || "").trim();
    if (!description) throw new Error(`${file}: entry ${assetPath} has blank description`);
    const category = String(value.category || "").trim();
    if (!ASSET_CATEGORIES.has(category)) {
      throw new Error(`${file}: entry ${assetPath} has unsupported category ${category}`);
    }
    const embedding = value.embedding && typeof value.embedding === "object" && !Array.isArray(value.embedding)
      ? value.embedding
      : {};
    const documentId = String(embedding.document_id || assetDocumentId(assetPath)).trim();
    const chunkId = String(embedding.chunk_id || `${documentId}:description`).trim();
    const modelId = String(embedding.model_id || MODEL_ID).trim();
    const table = String(embedding.table || ASSET_EMBEDDING_TABLE).trim();
    if (!documentId || !chunkId) throw new Error(`${file}: entry ${assetPath} has blank DB reference`);
    if (modelId !== MODEL_ID) throw new Error(`${file}: entry ${assetPath} uses unsupported model ${modelId}`);
    if (table !== ASSET_EMBEDDING_TABLE) throw new Error(`${file}: entry ${assetPath} must reference ${ASSET_EMBEDDING_TABLE}`);
    return {
      assetPath,
      description,
      category,
      documentId,
      chunkId,
      modelId,
    };
  });

  const paths = new Set();
  const documents = new Set();
  const chunks = new Set();
  for (const row of rows) {
    if (paths.has(row.assetPath)) throw new Error(`${file}: duplicate asset path ${row.assetPath}`);
    if (documents.has(row.documentId)) throw new Error(`${file}: duplicate document_id ${row.documentId}`);
    if (chunks.has(row.chunkId)) throw new Error(`${file}: duplicate chunk_id ${row.chunkId}`);
    paths.add(row.assetPath);
    documents.add(row.documentId);
    chunks.add(row.chunkId);
  }
  return rows;
}

async function buildDatabase(SQL, schemaSql, items, assetItems, file) {
  const db = new SQL.Database();
  db.run("PRAGMA foreign_keys = ON");
  db.run(schemaSql);
  db.run("DELETE FROM asset_embedding_refs");
  db.run("DELETE FROM embeddings");
  db.run("DELETE FROM chunks");
  db.run("DELETE FROM documents");
  db.run("INSERT OR REPLACE INTO schema_meta(key, value) VALUES (?, ?)", ["schema_name", SCHEMA_NAME]);
  db.run("INSERT OR REPLACE INTO schema_meta(key, value) VALUES (?, ?)", ["schema_version", String(SCHEMA_VERSION)]);
  db.run("INSERT OR REPLACE INTO schema_meta(key, value) VALUES (?, ?)", ["default_embedding_model", MODEL_ID]);
  db.run("INSERT OR REPLACE INTO schema_meta(key, value) VALUES (?, ?)", ["embedding_text_field", EMBEDDING_TEXT_FIELD]);
  db.run("INSERT OR REPLACE INTO schema_meta(key, value) VALUES (?, ?)", ["embedding_input_policy", EMBEDDING_INPUT_POLICY]);
  db.run("INSERT OR REPLACE INTO schema_meta(key, value) VALUES (?, ?)", ["asset_embedding_table", ASSET_EMBEDDING_TABLE]);
  db.run("INSERT OR REPLACE INTO schema_meta(key, value) VALUES (?, ?)", ["asset_embedding_text_field", ASSET_EMBEDDING_TEXT_FIELD]);
  db.run("INSERT OR REPLACE INTO schema_meta(key, value) VALUES (?, ?)", ["asset_embedding_input_policy", ASSET_EMBEDDING_INPUT_POLICY]);

  const documentStmt = db.prepare(`
    INSERT INTO documents(
      id, source_kind, source_id, locale, title, body, content_hash, metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const chunkStmt = db.prepare(`
    INSERT INTO chunks(
      id, document_id, ordinal, text, token_count, content_hash, metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const embeddingStmt = db.prepare(`
    INSERT INTO embeddings(
      chunk_id, model_id, dimension, vector, norm
    ) VALUES (?, ?, ?, ?, ?)
  `);
  const assetRefStmt = db.prepare(`
    INSERT INTO asset_embedding_refs(
      asset_path, category, description, document_id, chunk_id, model_id, metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  db.run("BEGIN");
  try {
    for (const item of items) {
      const { row, indexedText, vector } = item;
      const documentId = `curriculum-en-${row.id}`;
      const chunkId = `${documentId}:0`;
      const documentMetadata = JSON.stringify({
        difficulty: row.difficulty,
        czech_text: row.czech_text,
        cefr: row.cefr,
        age_band: row.age_band,
        topic: row.topic,
        target_words: row.target_words,
        grammar_tags: row.grammar_tags,
        child_safe: row.child_safe,
        modern_english: row.modern_english,
        concrete: row.concrete,
        context_independent: row.context_independent,
        naturalness_score: row.naturalness_score,
        simplicity_score: row.simplicity_score,
      });
      const chunkMetadata = JSON.stringify({
        embedding_text_field: EMBEDDING_TEXT_FIELD,
        embedding_input_policy: EMBEDDING_INPUT_POLICY,
        indexed_text_hash: sha256Text(indexedText),
        indexed_text_tokens: tokenize(indexedText).length,
      });
      documentStmt.run([
        documentId,
        "curriculum",
        row.id,
        "en",
        row.topic,
        row.english_text,
        sha256Text(`${row.english_text}\n${documentMetadata}`),
        documentMetadata,
      ]);
      chunkStmt.run([
        chunkId,
        documentId,
        0,
        row.english_text,
        tokenize(indexedText).length,
        sha256Text(row.english_text),
        chunkMetadata,
      ]);
      embeddingStmt.run([
        chunkId,
        MODEL_ID,
        EMBEDDING_DIMENSION,
        encodeFloat32le(vector),
        1,
      ]);
    }
    for (const item of assetItems) {
      const { row, indexedText, vector } = item;
      const documentMetadata = JSON.stringify({
        asset_path: row.assetPath,
        category: row.category,
        source_keymap: path.relative(caatuuRoot, assetKeymapFile).replaceAll("\\", "/"),
        embedding_text_field: ASSET_EMBEDDING_TEXT_FIELD,
        embedding_input_policy: ASSET_EMBEDDING_INPUT_POLICY,
      });
      const chunkMetadata = JSON.stringify({
        asset_path: row.assetPath,
        category: row.category,
        embedding_text_field: ASSET_EMBEDDING_TEXT_FIELD,
        embedding_input_policy: ASSET_EMBEDDING_INPUT_POLICY,
        indexed_text_hash: sha256Text(indexedText),
        indexed_text_tokens: tokenize(indexedText).length,
      });
      const refMetadata = JSON.stringify({
        source_kind: "image_asset",
        source_keymap: path.relative(caatuuRoot, assetKeymapFile).replaceAll("\\", "/"),
      });

      documentStmt.run([
        row.documentId,
        "image_asset",
        row.assetPath,
        "en",
        displayAssetName(row.assetPath),
        row.description,
        sha256Text(`${row.description}\n${documentMetadata}`),
        documentMetadata,
      ]);
      chunkStmt.run([
        row.chunkId,
        row.documentId,
        0,
        row.description,
        tokenize(indexedText).length,
        sha256Text(row.description),
        chunkMetadata,
      ]);
      embeddingStmt.run([
        row.chunkId,
        row.modelId,
        EMBEDDING_DIMENSION,
        encodeFloat32le(vector),
        1,
      ]);
      assetRefStmt.run([
        row.assetPath,
        row.category,
        row.description,
        row.documentId,
        row.chunkId,
        row.modelId,
        refMetadata,
      ]);
    }
    db.run("COMMIT");
  } catch (error) {
    db.run("ROLLBACK");
    throw error;
  } finally {
    documentStmt.free();
    chunkStmt.free();
    embeddingStmt.free();
    assetRefStmt.free();
  }

  const bytes = db.export();
  db.close();
  await fs.writeFile(file, Buffer.from(bytes));
}

async function writeManifest(rows, assetItems, dbFile, file) {
  const [stat, sha256] = await Promise.all([fs.stat(dbFile), sha256File(dbFile)]);
  const qualityCounts = countFields(rows);
  const totalRows = rows.length + assetItems.length;
  const manifest = {
    schema_name: SCHEMA_NAME,
    schema_version: SCHEMA_VERSION,
    model_id: MODEL_ID,
    embedding_dimension: EMBEDDING_DIMENSION,
    vector_encoding: VECTOR_ENCODING,
    distance_metric: DISTANCE_METRIC,
    embedding_text_field: EMBEDDING_TEXT_FIELD,
    embedding_input_policy: EMBEDDING_INPUT_POLICY,
    file: DB_FILE_NAME,
    url: `data/embeddings/${MODEL_ID}/${DB_FILE_NAME}`,
    catalog_file: "data/embeddings/models.json",
    bytes: stat.size,
    sha256,
    document_count: totalRows,
    chunk_count: totalRows,
    embedding_count: totalRows,
    curriculum_count: rows.length,
    asset_count: assetItems.length,
    generated_at: new Date().toISOString(),
    generated_from: path.relative(caatuuRoot, inputFile).replaceAll("\\", "/"),
    generated_asset_keymap: assetItems.length
      ? path.relative(caatuuRoot, assetKeymapFile).replaceAll("\\", "/")
      : null,
    source_counts: {
      curriculum: rows.length,
      image_asset: assetItems.length,
    },
    row_counts: {
      topics: qualityCounts.topics,
      difficulties: qualityCounts.difficulties,
    },
  };
  await writeJson(file, manifest);
  return manifest;
}

async function writeEmbeddingCatalog(manifest, file) {
  const catalog = {
    version: 1,
    default_model: MODEL_ID,
    base_url: "https://caatuu.waajacu.com/cz/data/embeddings",
    models: [
      {
        key: MODEL_ID,
        model_id: MODEL_ID,
        label: "Caatuu Curriculum and Asset Embeddings",
        short_label: "Embeddings",
        status: "active",
        artifact_kind: "embedding-vector-db",
        source_label: "Caatuu curated curriculum corpus and manual image descriptions",
        source_url: "data/embeddings/README.md",
        license: "MIT",
        license_url: "https://opensource.org/licenses/MIT",
        intended_use: "Local curriculum retrieval, duplicate review, game selection, distractor search, and manually described image asset lookup.",
        runtime: "SQLite vector database with local hash embedder",
        format: "sqlite",
        model_file: `${MODEL_ID}/${DB_FILE_NAME}`,
        manifest_file: `${MODEL_ID}/manifest.json`,
        bytes: manifest.bytes,
        sha256: manifest.sha256,
        embedding_dimension: EMBEDDING_DIMENSION,
        vector_encoding: VECTOR_ENCODING,
        distance_metric: DISTANCE_METRIC,
        embedding_text_field: EMBEDDING_TEXT_FIELD,
        embedding_input_policy: EMBEDDING_INPUT_POLICY,
        trainable: false,
        notes: [
          "This is a deterministic local hash embedding baseline, not a semantic transformer model.",
          "Curriculum metadata is stored in SQLite for filtering and review but is not embedded.",
          "Image asset vectors are computed only from manually written English descriptions.",
          "BAAI/bge-small-en-v1.5 remains a planned future semantic embedding replacement.",
        ],
      },
    ],
  };
  await writeJson(file, catalog);
  return catalog;
}

async function writeQualityReports(items, manifest) {
  const exactDuplicateGroups = exactDuplicates(items);
  const nearDuplicateCandidates = nearDuplicates(items);
  const counts = countFields(items.map((item) => item.row));
  const quality = {
    generated_at: new Date().toISOString(),
    source_file: path.relative(caatuuRoot, inputFile).replaceAll("\\", "/"),
    vector_db: path.relative(caatuuRoot, outFile).replaceAll("\\", "/"),
    model_id: MODEL_ID,
    caveat: "This is a deterministic lexical vector index computed only from english_text, not czech_text or metadata, and not a semantic transformer embedding model.",
    rows: items.length,
    db_bytes: manifest.bytes,
    db_sha256: manifest.sha256,
    exact_duplicate_groups: exactDuplicateGroups,
    near_duplicate_thresholds: {
      vector_score: 0.74,
      token_jaccard: 0.72,
      max_candidates: MAX_REVIEW_CANDIDATES,
    },
    near_duplicate_candidates: nearDuplicateCandidates,
    coverage: {
      topic_counts: counts.topics,
      difficulty_counts: counts.difficulties,
      top_target_words: topEntries(counts.targetWords, 30),
      top_grammar_tags: topEntries(counts.grammarTags, 30),
      most_common_openings: mostCommonOpenings(items, 30),
    },
    suggested_cleanup_uses: [
      "Review near_duplicate_candidates before spending more translation or fine-tuning budget.",
      "Use top_target_words to rebalance overrepresented vocabulary.",
      "Use topic_counts and difficulty_counts to keep game planets varied by topic and level.",
      "Use nearest neighbors to generate distractors that are close but not identical for quiz modes.",
      "Use exact_duplicate_groups as a hard blocker; exact duplicates should stay at zero.",
    ],
  };

  await writeJson(qualityFile, quality);
  await fs.mkdir(path.dirname(qualityMarkdownFile), { recursive: true });
  await fs.writeFile(qualityMarkdownFile, qualityMarkdown(quality), "utf8");
  return quality;
}

function indexedTextFor(row) {
  const text = String(row[EMBEDDING_TEXT_FIELD] || "").trim();
  if (!text) throw new Error(`row ${row.id}: ${EMBEDDING_TEXT_FIELD} is blank`);
  return text;
}

function curriculumEmbedding(row, indexedText) {
  const vector = new Float32Array(EMBEDDING_DIMENSION);
  if (indexedText !== String(row.english_text || "").trim()) {
    throw new Error(`row ${row.id}: embeddings must be computed from english_text only`);
  }
  addTextFeatures(vector, indexedText, 1.0);
  return normalizeVector(vector);
}

function assetDescriptionEmbedding(row) {
  const vector = new Float32Array(EMBEDDING_DIMENSION);
  const indexedText = String(row.description || "").trim();
  if (!indexedText) throw new Error(`${row.assetPath}: asset description is blank`);
  addTextFeatures(vector, indexedText, 1.0);
  return normalizeVector(vector);
}

function addTextFeatures(vector, text, weight) {
  const tokens = tokenize(text);
  const features = tokens.length ? tokens : ["__blank__"];
  for (const token of features) {
    addHashFeature(vector, token, weight);
    addCharNgrams(vector, token, 3, weight * 0.35);
  }
}

function addCharNgrams(vector, token, size, weight) {
  const chars = Array.from(token);
  if (chars.length < size) return;
  for (let index = 0; index <= chars.length - size; index += 1) {
    addHashFeature(vector, `ngram:${chars.slice(index, index + size).join("")}`, weight);
  }
}

function addHashFeature(vector, feature, weight) {
  const hash = stableHash(feature);
  const index = Number(hash % BigInt(vector.length));
  const sign = (hash >> 63n) === 0n ? 1 : -1;
  vector[index] += sign * weight;
}

function stableHash(value) {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(String(value))) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash;
}

function normalizeVector(vector) {
  let norm = 0;
  for (const value of vector) norm += value * value;
  norm = Math.sqrt(norm);
  if (!Number.isFinite(norm) || norm <= 0) throw new Error("Embedding vector has zero or invalid norm.");
  const out = new Float32Array(vector.length);
  for (let index = 0; index < vector.length; index += 1) {
    out[index] = vector[index] / norm;
  }
  return out;
}

function encodeFloat32le(vector) {
  const bytes = new Uint8Array(vector.length * 4);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < vector.length; index += 1) {
    view.setFloat32(index * 4, vector[index], true);
  }
  return bytes;
}

function nearDuplicates(items) {
  const candidatePairs = candidatePairKeys(items);
  const candidates = [];
  for (const key of candidatePairs) {
    const [leftIndex, rightIndex] = key.split(":").map((value) => Number(value));
    const left = items[leftIndex];
    const right = items[rightIndex];
    const vectorScore = dotProduct(left.vector, right.vector);
    const tokenJaccard = jaccard(left.tokens, right.tokens);
    const sharedTargetWords = intersection(
      new Set(left.row.target_words.map((word) => normalizeToken(word))),
      new Set(right.row.target_words.map((word) => normalizeToken(word))),
    ).filter(Boolean);
    const sameGrammar = arrayKey(left.row.grammar_tags) === arrayKey(right.row.grammar_tags);
    const sameTopic = left.row.topic === right.row.topic;

    if (
      vectorScore >= 0.74 ||
      tokenJaccard >= 0.72 ||
      (sharedTargetWords.length > 0 && vectorScore >= 0.62) ||
      (sameGrammar && sameTopic && vectorScore >= 0.66)
    ) {
      candidates.push({
        id_a: left.row.id,
        text_a: left.row.english_text,
        id_b: right.row.id,
        text_b: right.row.english_text,
        vector_score: round(vectorScore, 4),
        token_jaccard: round(tokenJaccard, 4),
        same_topic: sameTopic,
        topic_a: left.row.topic,
        topic_b: right.row.topic,
        difficulty_a: left.row.difficulty,
        difficulty_b: right.row.difficulty,
        shared_target_words: sharedTargetWords,
        grammar_a: left.row.grammar_tags,
        grammar_b: right.row.grammar_tags,
        review_hint: reviewHint({ vectorScore, tokenJaccard, sharedTargetWords, sameTopic, sameGrammar }),
      });
    }
  }

  return candidates
    .sort((left, right) => (
      right.vector_score - left.vector_score ||
      right.token_jaccard - left.token_jaccard ||
      left.id_a.localeCompare(right.id_a)
    ))
    .slice(0, MAX_REVIEW_CANDIDATES);
}

function candidatePairKeys(items) {
  const buckets = new Map();
  for (const [index, item] of items.entries()) {
    const features = new Set();
    for (const token of item.tokens) {
      if (!STOPWORDS.has(token) && token.length > 2) features.add(`tok:${token}`);
    }
    for (const word of item.row.target_words || []) {
      const normalized = normalizeToken(word);
      if (normalized && !STOPWORDS.has(normalized)) features.add(`target:${normalized}`);
    }
    if (item.row.topic) features.add(`topic:${normalizeToken(item.row.topic)}`);
    const grammarKey = arrayKey(item.row.grammar_tags || []);
    if (grammarKey) features.add(`grammar:${grammarKey}`);
    for (const feature of features) {
      if (!buckets.has(feature)) buckets.set(feature, []);
      buckets.get(feature).push(index);
    }
  }

  const pairs = new Set();
  for (const indexes of buckets.values()) {
    if (indexes.length < 2 || indexes.length > 350) continue;
    for (let left = 0; left < indexes.length - 1; left += 1) {
      for (let right = left + 1; right < indexes.length; right += 1) {
        pairs.add(`${indexes[left]}:${indexes[right]}`);
      }
    }
  }
  return pairs;
}

function exactDuplicates(items) {
  const groups = new Map();
  for (const item of items) {
    const key = item.normalizedText;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ id: item.row.id, text: item.row.english_text });
  }
  return [...groups.values()].filter((group) => group.length > 1);
}

function reviewHint({ vectorScore, tokenJaccard, sharedTargetWords, sameTopic, sameGrammar }) {
  if (tokenJaccard >= 0.9) return "Very close wording; review for duplicate or low-value variation.";
  if (vectorScore >= 0.9) return "Very close vector match; likely same learning example shape.";
  if (sharedTargetWords.length > 0 && vectorScore >= 0.74) return "Same target vocabulary and similar vector; keep only if both add distinct value.";
  if (sameTopic && sameGrammar && vectorScore >= 0.66) return "Same topic and grammar; useful for balancing or distractors, but check repetition.";
  return "Possible near neighbor; review before using as separate training examples.";
}

function qualityMarkdown(quality) {
  const topCandidates = quality.near_duplicate_candidates.slice(0, 25);
  const lines = [
    "# Vector Quality Notes",
    "",
    `Generated: ${quality.generated_at}`,
    "",
    `Rows: ${quality.rows}`,
    `Vector DB: \`${quality.vector_db}\``,
    `Model: \`${quality.model_id}\``,
    "",
    `Caveat: ${quality.caveat}`,
    "",
    "## Cleanup Uses",
    "",
    ...quality.suggested_cleanup_uses.map((item) => `- ${item}`),
    "",
    "## Near-Duplicate Candidates",
    "",
    `Showing ${topCandidates.length} of ${quality.near_duplicate_candidates.length} candidates from \`${qualityFile}\`.`,
    "",
  ];

  if (!topCandidates.length) {
    lines.push("No high-confidence near-duplicate candidates were found.");
  } else {
    for (const candidate of topCandidates) {
      lines.push(
        `- ${candidate.id_a} / ${candidate.id_b} | vector ${candidate.vector_score} | token ${candidate.token_jaccard}`,
        `  - ${candidate.text_a}`,
        `  - ${candidate.text_b}`,
        `  - ${candidate.review_hint}`,
      );
    }
  }

  lines.push(
    "",
    "## Coverage Hot Spots",
    "",
    "Top target words:",
    "",
    ...quality.coverage.top_target_words.slice(0, 15).map(([key, count]) => `- ${key}: ${count}`),
    "",
    "Most common openings:",
    "",
    ...quality.coverage.most_common_openings.slice(0, 15).map(([key, count]) => `- ${key}: ${count}`),
    "",
  );

  return `${lines.join("\n")}\n`;
}

function countFields(rows) {
  const topics = {};
  const difficulties = {};
  const targetWords = {};
  const grammarTags = {};
  for (const row of rows) {
    topics[row.topic] = (topics[row.topic] || 0) + 1;
    difficulties[row.difficulty] = (difficulties[row.difficulty] || 0) + 1;
    for (const word of row.target_words || []) {
      const key = normalizeToken(word);
      if (key) targetWords[key] = (targetWords[key] || 0) + 1;
    }
    for (const tag of row.grammar_tags || []) {
      grammarTags[tag] = (grammarTags[tag] || 0) + 1;
    }
  }
  return {
    topics: sortObject(topics),
    difficulties: sortObject(difficulties),
    targetWords,
    grammarTags,
  };
}

function mostCommonOpenings(items, limit) {
  const counts = {};
  for (const item of items) {
    const opening = tokenize(item.row.english_text).slice(0, 3).join(" ");
    if (opening) counts[opening] = (counts[opening] || 0) + 1;
  }
  return topEntries(counts, limit);
}

function sortObject(object) {
  return Object.fromEntries(Object.entries(object).sort(([a], [b]) => String(a).localeCompare(String(b))));
}

function topEntries(object, limit) {
  return Object.entries(object)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit);
}

function tokenize(text) {
  const tokens = [];
  let current = "";
  for (const char of String(text || "").toLowerCase()) {
    if (/[\p{L}\p{N}]/u.test(char)) {
      current += char;
    } else if (current) {
      tokens.push(current);
      current = "";
    }
  }
  if (current) tokens.push(current);
  return tokens;
}

function contentTokens(text) {
  return new Set(tokenize(text).filter((token) => !STOPWORDS.has(token)));
}

function normalizeText(text) {
  return tokenize(text).join(" ");
}

function normalizeToken(text) {
  return tokenize(text)[0] || "";
}

function arrayKey(values) {
  return [...(values || [])].map(String).sort().join("|");
}

function dotProduct(left, right) {
  let score = 0;
  for (let index = 0; index < left.length; index += 1) score += left[index] * right[index];
  return score;
}

function jaccard(left, right) {
  if (!left.size && !right.size) return 1;
  let shared = 0;
  for (const value of left) {
    if (right.has(value)) shared += 1;
  }
  return shared / (left.size + right.size - shared);
}

function intersection(left, right) {
  const values = [];
  for (const value of left) {
    if (right.has(value)) values.push(value);
  }
  return values;
}

function round(value, digits) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

async function updateSetupAssetsManifest(file, artifactFilesByKey) {
  let text = "";
  try {
    text = await fs.readFile(file, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }

  const manifest = JSON.parse(text);
  if (!Array.isArray(manifest.artifacts)) return null;

  let changed = false;
  for (const artifact of manifest.artifacts) {
    const artifactFile = artifactFilesByKey[artifact?.key];
    if (!artifactFile) continue;
    const [stat, sha256] = await Promise.all([fs.stat(artifactFile), sha256File(artifactFile)]);
    if (artifact.bytes !== stat.size || artifact.sha256 !== sha256) changed = true;
    artifact.bytes = stat.size;
    artifact.sha256 = sha256;
  }

  if (changed) await writeJson(file, manifest);
  return path.relative(caatuuRoot, file).replaceAll("\\", "/");
}

function assetDocumentId(assetPath) {
  return `asset-${sha256Text(assetPath).slice(0, 16)}`;
}

function displayAssetName(assetPath) {
  let decoded = assetPath;
  try {
    decoded = decodeURIComponent(assetPath);
  } catch {
    // Keep the original string if it is not valid URI encoding.
  }
  return path.posix.basename(decoded);
}

async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function sha256File(file) {
  const hash = crypto.createHash("sha256");
  hash.update(await fs.readFile(file));
  return hash.digest("hex");
}

function sha256Text(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}
