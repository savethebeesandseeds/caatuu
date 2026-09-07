#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { IMAGE_SOURCES, normalizeImageCatalog } from "../static/source/english-image-search.mjs";
import { EnglishMiniLmRanker, ENGLISH_MINILM_RUNTIME } from "../static/source/english-minilm-ranker.mjs";
import { IMAGE_INDEX_SCHEMA, readImageEmbeddingIndex, imageVectorKey } from "../static/source/image-embedding-index.mjs";
import { verifyEmbeddingRuntimeAssets } from "./verify-embedding-runtime.mjs";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const output = path.join(root, "apps/language-runtime/static/data/image-embeddings/minilm-v1.json");
const json = async file => JSON.parse(await readFile(file, "utf8"));
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

export async function imageIndexInputs() {
  const catalog = await json(path.join(root, "apps/language-runtime/app-assets.json"));
  const rows = [], sources = [];
  for (const source of IMAGE_SOURCES) {
    const mappings = catalog.assets.filter(asset => asset.output === source.path.slice(1));
    assert.equal(mappings.length, 1, `One authoritative image catalog is required: ${source.path}`);
    const bytes = await readFile(path.join(root, mappings[0].source));
    const entries = normalizeImageCatalog(JSON.parse(bytes), source.kind);
    rows.push(...entries);
    sources.push({ path: source.path, source: mappings[0].source, sha256: sha256(bytes), count: entries.length });
  }
  const catalogRuntime = await json(path.join(root, "apps/language-runtime/embedding-runtimes.json"));
  const runtime = catalogRuntime.runtimes.find(item => item.runtime.modelId === ENGLISH_MINILM_RUNTIME.modelId);
  assert.ok(runtime, "Shared MiniLM runtime must be declared");
  const model = runtime.artifacts.find(artifact => artifact.path.endsWith(".onnx"));
  return { rows, sources, model };
}

export async function checkImageEmbeddingIndex() {
  const inputs = await imageIndexInputs();
  const raw = await json(output);
  const index = readImageEmbeddingIndex(raw);
  assert.equal(raw.modelSha256, inputs.model.sha256, "Image index model must match query model");
  assert.deepEqual(raw.sources, inputs.sources, "Image index catalogs changed; rebuild the shared index");
  assert.equal(index.size, inputs.rows.length);
  for (const row of inputs.rows) assert.equal(index.get(imageVectorKey(row))?.embeddingText, row.embeddingText);
  return { images: index.size, sources: raw.sources, modelSha256: raw.modelSha256 };
}

async function build() {
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  assert.equal(root.replace(/\/$/, ""), "/workspace", "Run in the established caatuu-dev container");
  assert.equal(git("branch", "--show-current"), "main");
  assert.equal(git("for-each-ref", "--format=%(refname)", "refs/heads", "refs/remotes"), "refs/heads/main\nrefs/remotes/origin/main");
  await verifyEmbeddingRuntimeAssets();
  const { rows, sources, model } = await imageIndexInputs();
  const require = createRequire(path.join(root, "tools/czech-ml/package.json"));
  const { env, pipeline } = await import(pathToFileURL(require.resolve("@huggingface/transformers")));
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  const modelDirectory = path.join(root, "apps/language-runtime/models", ENGLISH_MINILM_RUNTIME.modelId);
  const extractor = await pipeline("feature-extraction", modelDirectory, {
    dtype: "fp32", device: "cpu", model_file_name: ENGLISH_MINILM_RUNTIME.modelFileName, local_files_only: true
  });
  const encoder = new EnglishMiniLmRanker({ extractor });
  const indexed = [];
  try {
    for (let offset = 0; offset < rows.length; offset += 32) {
      const batch = rows.slice(offset, offset + 32);
      const vectors = await encoder.embedBatch(batch.map(row => row.embeddingText));
      batch.forEach((row, i) => {
        const bytes = Buffer.alloc(vectors[i].length * 4);
        vectors[i].forEach((value, j) => bytes.writeFloatLE(value, j * 4));
        indexed.push({ path: row.path, sourceKind: row.sourceKind, embeddingText: row.embeddingText, vector: bytes.toString("base64") });
      });
      console.error(`Indexed ${indexed.length}/${rows.length} shared image descriptions`);
    }
  } finally { await extractor.dispose?.(); }
  const result = { schema: IMAGE_INDEX_SCHEMA, inputLanguage: "en", modelId: ENGLISH_MINILM_RUNTIME.modelId,
    modelFileName: ENGLISH_MINILM_RUNTIME.modelFileName, modelSha256: model.sha256,
    dimension: ENGLISH_MINILM_RUNTIME.embeddingDimension, encoding: "float32le-base64", sources, rows: indexed };
  readImageEmbeddingIndex(result);
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(result) + "\n");
  console.log(JSON.stringify(await checkImageEmbeddingIndex()));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  (process.argv.includes("--check") ? checkImageEmbeddingIndex().then(result => console.log(JSON.stringify(result))) : build())
    .catch(error => { console.error(error); process.exitCode = 1; });
}
