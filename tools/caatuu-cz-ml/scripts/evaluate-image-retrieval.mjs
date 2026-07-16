#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { env, pipeline } from "@huggingface/transformers";
import { appDataRoot, fromRoot, mlRoot } from "./paths.mjs";

const MODEL_ID = "all-minilm-l6-v2-qint8-v0.1";
const MODEL_REVISION = "1110a243fdf4706b3f48f1d95db1a4f5529b4d41";
const MODEL_FILE_BASENAME = "model_qint8_arm64";
const DIMENSION = 384;

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const evaluationFile = path.resolve(argValue(
  "--evaluation-file",
  fromRoot("data", "curriculum", "core-v0.2", "evaluation", "image-retrieval.en.jsonl"),
));
const databaseFile = path.resolve(argValue(
  "--database-file",
  path.join(appDataRoot, "embeddings", MODEL_ID, "caatuu-cz-curriculum.sqlite"),
));
const modelSourceDir = path.resolve(argValue(
  "--model-source-dir",
  path.join(
    mlRoot,
    "data",
    "models",
    "english-base",
    "hf-cache",
    "hub",
    "models--sentence-transformers--all-MiniLM-L6-v2",
    "snapshots",
    MODEL_REVISION,
  ),
));
const reportFile = path.resolve(argValue(
  "--report-file",
  fromRoot("data", "curriculum", "core-v0.2", "validation", "image-retrieval.json"),
));
const markdownFile = path.resolve(argValue(
  "--report-md-file",
  fromRoot("data", "curriculum", "core-v0.2", "reports", "image-retrieval.md"),
));
const minRecallAt1 = Number(argValue("--min-recall-at-1", "0.75"));
const minRecallAt5 = Number(argValue("--min-recall-at-5", "0.90"));

const evaluations = await readJsonl(evaluationFile);
assertEvaluations(evaluations);
const candidates = await readCandidates(databaseFile);
if (!candidates.length) throw new Error(`No image candidates found in ${databaseFile}.`);

env.allowRemoteModels = false;
env.allowLocalModels = true;
const extractor = await pipeline("feature-extraction", modelSourceDir, {
  dtype: "fp32",
  device: "cpu",
  model_file_name: MODEL_FILE_BASENAME,
  local_files_only: true,
});
const tensor = await extractor(evaluations.map((item) => item.query), {
  pooling: "mean",
  normalize: true,
});
await extractor.dispose?.();
if (tensor.dims?.[0] !== evaluations.length || tensor.dims?.[1] !== DIMENSION) {
  throw new Error(`Unexpected evaluation embedding shape ${JSON.stringify(tensor.dims || [])}.`);
}

const results = evaluations.map((item, queryIndex) => {
  const offset = queryIndex * DIMENSION;
  const vector = Float32Array.from(tensor.data.slice(offset, offset + DIMENSION));
  const ranked = candidates
    .map((candidate) => {
      const semanticScore = dotProduct(vector, candidate.vector);
      const lexicalScore = lexicalOverlapScore(item.query, candidate.description);
      return { ...candidate, semanticScore, lexicalScore, score: semanticScore + lexicalScore * 0.035 };
    })
    .sort((left, right) => right.score - left.score);
  const acceptedRank = ranked.findIndex((candidate) => isAccepted(item, candidate)) + 1;
  return {
    id: item.id,
    query: item.query,
    acceptable_categories: item.acceptable_categories,
    acceptable_paths: item.acceptable_paths || [],
    accepted_rank: acceptedRank || null,
    reciprocal_rank: acceptedRank ? 1 / acceptedRank : 0,
    top: ranked.slice(0, 5).map(({ vector: _vector, ...candidate }) => ({
      ...candidate,
      accepted: isAccepted(item, candidate),
      score: round(candidate.score, 6),
      semanticScore: round(candidate.semanticScore, 6),
      lexicalScore: round(candidate.lexicalScore, 6),
    })),
  };
});

const summary = {
  generated_at: new Date().toISOString(),
  model_id: MODEL_ID,
  model_revision: MODEL_REVISION,
  evaluation_file: evaluationFile,
  database_file: databaseFile,
  query_count: results.length,
  candidate_count: candidates.length,
  recall_at_1: recallAt(results, 1),
  recall_at_3: recallAt(results, 3),
  recall_at_5: recallAt(results, 5),
  mean_reciprocal_rank: round(
    results.reduce((sum, item) => sum + item.reciprocal_rank, 0) / results.length,
    6,
  ),
  gates: {
    min_recall_at_1: minRecallAt1,
    min_recall_at_5: minRecallAt5,
  },
  results,
};
summary.passed = summary.recall_at_1 >= minRecallAt1 && summary.recall_at_5 >= minRecallAt5;

await fs.mkdir(path.dirname(reportFile), { recursive: true });
await fs.writeFile(reportFile, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
await fs.mkdir(path.dirname(markdownFile), { recursive: true });
await fs.writeFile(markdownFile, renderMarkdown(summary), "utf8");
console.log(JSON.stringify({
  passed: summary.passed,
  queries: summary.query_count,
  candidates: summary.candidate_count,
  recall_at_1: summary.recall_at_1,
  recall_at_3: summary.recall_at_3,
  recall_at_5: summary.recall_at_5,
  mean_reciprocal_rank: summary.mean_reciprocal_rank,
  report_file: reportFile,
}, null, 2));
if (!summary.passed) process.exitCode = 1;

async function readJsonl(file) {
  return (await fs.readFile(file, "utf8"))
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`${file}:${index + 1}: ${error.message}`);
      }
    });
}

function assertEvaluations(items) {
  if (items.length < 20) throw new Error("Image retrieval evaluation needs at least 20 human-reviewed queries.");
  const ids = new Set();
  for (const [index, item] of items.entries()) {
    if (!String(item.id || "").trim()) throw new Error(`evaluation ${index + 1}: missing id`);
    if (ids.has(item.id)) throw new Error(`evaluation ${index + 1}: duplicate id ${item.id}`);
    ids.add(item.id);
    if (!String(item.query || "").trim()) throw new Error(`evaluation ${item.id}: missing query`);
    const categoryCount = Array.isArray(item.acceptable_categories) ? item.acceptable_categories.length : 0;
    const pathCount = Array.isArray(item.acceptable_paths) ? item.acceptable_paths.length : 0;
    if (!categoryCount && !pathCount) throw new Error(`evaluation ${item.id}: no acceptable answer set`);
  }
}

async function readCandidates(file) {
  const require = createRequire(import.meta.url);
  const sqlJsFile = path.join(appDataRoot, "..", "vendor", "sql.js", "sql-wasm.js");
  const sqlWasmFile = path.join(path.dirname(sqlJsFile), "sql-wasm.wasm");
  const initSqlJs = require(sqlJsFile);
  const SQL = await initSqlJs({ locateFile: () => sqlWasmFile });
  const db = new SQL.Database(await fs.readFile(file));
  const statement = db.prepare(`
    SELECT
      documents.source_kind,
      documents.source_id,
      chunks.text,
      embeddings.vector,
      COALESCE(asset_embedding_refs.asset_path, robot_embedding_refs.asset_path, macaw_action_embedding_refs.asset_path) AS asset_path,
      COALESCE(asset_embedding_refs.category, robot_embedding_refs.category, macaw_action_embedding_refs.action) AS category
    FROM embeddings
    JOIN chunks ON chunks.id = embeddings.chunk_id
    JOIN documents ON documents.id = chunks.document_id
    LEFT JOIN asset_embedding_refs
      ON asset_embedding_refs.chunk_id = chunks.id AND asset_embedding_refs.model_id = embeddings.model_id
    LEFT JOIN robot_embedding_refs
      ON robot_embedding_refs.chunk_id = chunks.id AND robot_embedding_refs.model_id = embeddings.model_id
    LEFT JOIN macaw_action_embedding_refs
      ON macaw_action_embedding_refs.chunk_id = chunks.id AND macaw_action_embedding_refs.model_id = embeddings.model_id
    WHERE embeddings.model_id = $model_id
      AND documents.source_kind IN ('image_asset', 'robot_asset', 'macaw_action_asset')
  `);
  const rows = [];
  try {
    statement.bind({ $model_id: MODEL_ID });
    while (statement.step()) {
      const row = statement.getAsObject();
      rows.push({
        assetPath: String(row.asset_path || row.source_id || ""),
        category: String(row.category || ""),
        description: String(row.text || ""),
        sourceKind: String(row.source_kind || ""),
        vector: decodeFloat32(row.vector),
      });
    }
  } finally {
    statement.free();
    db.close();
  }
  return rows;
}

function decodeFloat32(value) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return Float32Array.from({ length: bytes.byteLength / 4 }, (_, index) => view.getFloat32(index * 4, true));
}

function isAccepted(evaluation, candidate) {
  return (evaluation.acceptable_categories || []).includes(candidate.category) ||
    (evaluation.acceptable_paths || []).includes(candidate.assetPath);
}

function lexicalOverlapScore(queryText, candidateText) {
  const queryTokens = new Set(tokenize(queryText).filter((token) => token.length > 1));
  if (!queryTokens.size) return 0;
  const candidateTokens = new Set(tokenize(candidateText));
  let shared = 0;
  for (const token of queryTokens) if (candidateTokens.has(token)) shared += 1;
  return shared / queryTokens.size;
}

function tokenize(text) {
  return String(text || "").toLowerCase().match(/[a-z0-9]+/g) || [];
}

function dotProduct(left, right) {
  let score = 0;
  for (let index = 0; index < left.length; index += 1) score += left[index] * right[index];
  return score;
}

function recallAt(results, rank) {
  return round(results.filter((item) => item.accepted_rank && item.accepted_rank <= rank).length / results.length, 6);
}

function round(value, digits) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function renderMarkdown(summary) {
  const misses = summary.results.filter((item) => !item.accepted_rank || item.accepted_rank > 5);
  return [
    "# Image Retrieval Evaluation",
    "",
    `Generated: ${summary.generated_at}`,
    `Model: \`${summary.model_id}\``,
    `Human-reviewed queries: ${summary.query_count}`,
    `Image candidates: ${summary.candidate_count}`,
    "",
    `- Recall@1: ${summary.recall_at_1}`,
    `- Recall@3: ${summary.recall_at_3}`,
    `- Recall@5: ${summary.recall_at_5}`,
    `- MRR: ${summary.mean_reciprocal_rank}`,
    `- Gate: ${summary.passed ? "PASS" : "FAIL"}`,
    "",
    "The acceptable sets are intentionally conceptual: an image can be useful without literally depicting every word in a sentence.",
    "This is a regression suite, not a claim of population-level sufficiency. Expand it with real anonymized misses before a release decision.",
    "",
    "## Misses outside top 5",
    "",
    ...(misses.length ? misses.map((item) => `- ${item.id}: ${item.query}`) : ["- None"]),
    "",
  ].join("\n");
}
