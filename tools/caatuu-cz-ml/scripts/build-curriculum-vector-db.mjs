#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { appDataRoot, caatuuRoot, fromRoot, mlRoot } from "./paths.mjs";

const MODEL_ID = "all-minilm-l6-v2-qint8-v0.1";
const LEGACY_HASH_MODEL_ID = "caatuu-local-hash-v0.1";
const MODEL_SOURCE_ID = "sentence-transformers/all-MiniLM-L6-v2";
const MODEL_REVISION = "1110a243fdf4706b3f48f1d95db1a4f5529b4d41";
const MODEL_FILE_BASENAME = "model_qint8_arm64";
const MODEL_FILE_NAME = `${MODEL_FILE_BASENAME}.onnx`;
const MODEL_LICENSE = "Apache-2.0";
const TRANSFORMERS_JS_VERSION = "4.2.0";
const ONNX_RUNTIME_WEB_VERSION = "1.26.0-dev.20260416-b7804b056c";
const ONNX_RUNTIME_WEB_COMMIT = "b7804b056c30aa35c1748f8e4e239d0e2ff25d6d";
const SCHEMA_NAME = "caatuu-cz-vector-db";
const SCHEMA_VERSION = 1;
const EMBEDDING_DIMENSION = 384;
const DB_FILE_NAME = "caatuu-cz-curriculum.sqlite";
const EMBEDDING_TEXT_FIELD = "english_text";
const EMBEDDING_INPUT_POLICY = "english_text_only";
const MISC_ASSET_EMBEDDING_TABLE = "asset_embedding_refs";
const ROBOT_ASSET_EMBEDDING_TABLE = "robot_embedding_refs";
const MACAW_ACTION_EMBEDDING_TABLE = "macaw_action_embedding_refs";
const ASSET_EMBEDDING_TEXT_FIELD = "manual_english_description";
const ASSET_EMBEDDING_INPUT_POLICY = "manual_english_description_only";
const VECTOR_ENCODING = "float32le";
const DISTANCE_METRIC = "cosine";
const MAX_REVIEW_CANDIDATES = 200;
const EMBEDDING_BATCH_SIZE = 64;
const MODEL_RUNTIME_FILES = [
  "config.json",
  "special_tokens_map.json",
  "tokenizer.json",
  "tokenizer_config.json",
  "vocab.txt",
];
const MODEL_RUNTIME_BLOB_IDS = {
  "config.json": "72b987fd805cfa2b58c4c8c952b274a11bfd5a00",
  "special_tokens_map.json": "e7b0375001f109a6b8873d756ad4f7bbb15fbaa5",
  "tokenizer.json": "cb202bfe2e3c98645018a6d12f182a434c9d3e02",
  "tokenizer_config.json": "c79f2b6a0cea6f4b564fed1938984bace9d30ff0",
  "vocab.txt": "fb140275c155a9c7c5a3b3e0e77a9e839594a938",
  [`onnx/${MODEL_FILE_NAME}`]: "4278337fd0ff3c68bfb6291042cad8ab363e1d9fbc43dcb499fe91c871902474",
};
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
    path.join(caatuuRoot, "apps", "caatuu-unified", "static", "assets", "miscellaneous", "keymap.json"),
  ),
);
const robotKeymapFile = path.resolve(
  argValue(
    "--robot-keymap-file",
    path.join(caatuuRoot, "apps", "caatuu-unified", "static", "assets", "robots", "keymap.json"),
  ),
);
const macawActionKeymapsFile = path.resolve(
  argValue(
    "--macaw-action-keymap-file",
    path.join(caatuuRoot, "apps", "caatuu-unified", "static", "assets", "macaw", "actions", "keymaps.json"),
  ),
);
const setupAssetsFile = path.resolve(
  argValue("--setup-assets-file", path.join(caatuuRoot, "apps", "caatuu-czech", "static", "setup-assets.json")),
);
const defaultModelSourceDir = path.join(
  mlRoot,
  "data",
  "models",
  "english-base",
  "hf-cache",
  "hub",
  "models--sentence-transformers--all-MiniLM-L6-v2",
  "snapshots",
  MODEL_REVISION,
);
const modelSourceDir = path.resolve(argValue("--model-source-dir", defaultModelSourceDir));
const modelRuntimeDir = path.resolve(argValue("--model-runtime-dir", path.join(outDir, "runtime")));
const transformersVendorDir = path.resolve(
  argValue(
    "--transformers-vendor-dir",
    path.join(caatuuRoot, "apps", "caatuu-czech", "static", "vendor", "transformers"),
  ),
);
const assetKeymapSpecs = [
  {
    group: "miscellaneous",
    file: assetKeymapFile,
    table: MISC_ASSET_EMBEDDING_TABLE,
    sourceKind: "image_asset",
    defaultCategory: "",
  },
  {
    group: "robots",
    file: robotKeymapFile,
    table: ROBOT_ASSET_EMBEDDING_TABLE,
    sourceKind: "robot_asset",
    defaultCategory: "robot",
  },
  {
    group: "macaw_actions",
    file: macawActionKeymapsFile,
    table: MACAW_ACTION_EMBEDDING_TABLE,
    sourceKind: "macaw_action_asset",
    defaultCategory: "macaw_action",
  },
];
const setupAssetGroups = {
  miscellaneous: {
    keyPrefix: "misc-character",
    keymapKey: "misc-character-keymap",
    keymapLabel: "Character image keymap",
    imageLabel: "Character image",
  },
  robots: {
    keyPrefix: "robot",
    keymapKey: "robot-keymap",
    keymapLabel: "Robot image keymap",
    imageLabel: "Robot image",
  },
  macaw_actions: {
    keyPrefix: "macaw-action",
    keymapKey: "macaw-action-keymap",
    keymapLabel: "Macaw action keymap",
    imageLabel: "Macaw action image",
  },
};

const rows = await readJsonl(inputFile);
assertRows(rows);
const assetRows = (await Promise.all(assetKeymapSpecs.map((spec) => readAssetKeymap(spec)))).flat();

const runtimeArtifacts = await prepareSemanticRuntime();
const embedder = await createSemanticEmbedder();
const SQL = await loadSqlJs();
const schemaSql = await fs.readFile(schemaFile, "utf8");
const curriculumTexts = rows.map((row) => indexedTextFor(row));
const assetTexts = assetRows.map((row) => row.description);
const vectors = await embedder.embedTexts([...curriculumTexts, ...assetTexts]);
await embedder.dispose();
const embeddedRows = rows.map((row, index) => {
  const indexedText = indexedTextFor(row);
  return {
    row,
    indexedText,
    vector: vectors[index],
    tokens: contentTokens(row.english_text),
    normalizedText: normalizeText(row.english_text),
  };
});
const embeddedAssetRows = assetRows.map((row, index) => ({
  row,
  indexedText: row.description,
  vector: vectors[rows.length + index],
}));

await fs.mkdir(outDir, { recursive: true });
await buildDatabase(SQL, schemaSql, embeddedRows, embeddedAssetRows, outFile);
const manifest = await writeManifest(rows, embeddedAssetRows, outFile, manifestFile, runtimeArtifacts);
await writeEmbeddingCatalog(manifest, embeddingCatalogFile);
await updateBrowserVectorDbUrl(browserVectorDbFile, manifest.sha256);
await updateAssetKeymapReferences(assetRows);
const setup_assets_file = await updateSetupAssetsManifest(setupAssetsFile, {
  "browser-vector-db-js": browserVectorDbFile,
  "embedding-catalog": embeddingCatalogFile,
  "embedding-manifest": manifestFile,
  "embedding-sqlite": outFile,
  ...Object.fromEntries(runtimeArtifacts.map((artifact) => [artifact.key, artifact.file])),
}, assetRows, runtimeArtifacts);
const quality = await writeQualityReports(embeddedRows, manifest);

console.log(JSON.stringify({
  ok: true,
  rows: rows.length,
  asset_rows: embeddedAssetRows.length,
  asset_counts: countAssetGroups(embeddedAssetRows),
  model_id: MODEL_ID,
  model_source: MODEL_SOURCE_ID,
  model_revision: MODEL_REVISION,
  runtime_artifacts: runtimeArtifacts.map(({ key, file, bytes, sha256 }) => ({ key, file, bytes, sha256 })),
  db_file: outFile,
  db_bytes: manifest.bytes,
  db_sha256: manifest.sha256,
  manifest_file: manifestFile,
  catalog_file: embeddingCatalogFile,
  asset_keymap_files: Object.fromEntries(
    assetKeymapSpecs.map((spec) => [spec.group, spec.file]),
  ),
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

async function prepareSemanticRuntime() {
  const require = createRequire(import.meta.url);
  const transformersPackageDir = path.dirname(path.dirname(require.resolve("@huggingface/transformers")));
  const transformersPackageFile = path.join(transformersPackageDir, "package.json");
  const ortPackageDir = path.dirname(path.dirname(require.resolve("onnxruntime-web")));
  const ortPackageFile = path.join(ortPackageDir, "package.json");
  const ortCommitFile = path.join(ortPackageDir, "__commit.txt");
  const transformersPackage = JSON.parse(await fs.readFile(transformersPackageFile, "utf8"));
  const ortPackage = JSON.parse(await fs.readFile(ortPackageFile, "utf8"));
  const ortCommit = (await fs.readFile(ortCommitFile, "utf8")).trim();
  if (transformersPackage.version !== TRANSFORMERS_JS_VERSION) {
    throw new Error(`Expected @huggingface/transformers ${TRANSFORMERS_JS_VERSION}, got ${transformersPackage.version}.`);
  }
  if (ortPackage.version !== ONNX_RUNTIME_WEB_VERSION) {
    throw new Error(`Expected onnxruntime-web ${ONNX_RUNTIME_WEB_VERSION}, got ${ortPackage.version}.`);
  }
  if (ortCommit !== ONNX_RUNTIME_WEB_COMMIT) {
    throw new Error(`Expected onnxruntime-web commit ${ONNX_RUNTIME_WEB_COMMIT}, got ${ortCommit}.`);
  }

  await fs.mkdir(modelRuntimeDir, { recursive: true });
  await fs.mkdir(path.join(modelRuntimeDir, "onnx"), { recursive: true });
  await fs.mkdir(path.join(modelRuntimeDir, "ort"), { recursive: true });
  await fs.mkdir(transformersVendorDir, { recursive: true });

  for (const file of MODEL_RUNTIME_FILES) {
    await copyRequiredFile(path.join(modelSourceDir, file), path.join(modelRuntimeDir, file));
  }
  await copyRequiredFile(
    path.join(modelSourceDir, "onnx", MODEL_FILE_NAME),
    path.join(modelRuntimeDir, "onnx", MODEL_FILE_NAME),
  );
  await copyRequiredFile(
    path.join(ortPackageDir, "dist", "ort-wasm-simd-threaded.mjs"),
    path.join(modelRuntimeDir, "ort", "ort-wasm-simd-threaded.mjs"),
  );
  await copyRequiredFile(
    path.join(ortPackageDir, "dist", "ort-wasm-simd-threaded.wasm"),
    path.join(modelRuntimeDir, "ort", "ort-wasm-simd-threaded.wasm"),
  );
  await copyRequiredFile(
    path.join(transformersPackageDir, "dist", "transformers.min.js"),
    path.join(transformersVendorDir, "transformers.min.js"),
  );
  await copyRequiredFile(
    path.join(transformersPackageDir, "LICENSE"),
    path.join(transformersVendorDir, "LICENSE"),
  );
  await copyRequiredFile(
    path.join(transformersPackageDir, "LICENSE"),
    path.join(modelRuntimeDir, "LICENSE-APACHE-2.0.txt"),
  );
  await fs.writeFile(
    path.join(modelRuntimeDir, "THIRD_PARTY_NOTICES.json"),
    `${JSON.stringify({
      version: 1,
      components: [
        {
          name: MODEL_SOURCE_ID,
          revision: MODEL_REVISION,
          license: MODEL_LICENSE,
          source_url: `https://huggingface.co/${MODEL_SOURCE_ID}/tree/${MODEL_REVISION}`,
          license_file: "LICENSE-APACHE-2.0.txt",
        },
        {
          name: "@huggingface/transformers",
          version: TRANSFORMERS_JS_VERSION,
          license: transformersPackage.license,
          source_url: transformersPackage.repository?.url || "https://github.com/huggingface/transformers.js",
          packaged_license_file: "/cz/vendor/transformers/LICENSE",
        },
        {
          name: "onnxruntime-web",
          version: ONNX_RUNTIME_WEB_VERSION,
          revision: ONNX_RUNTIME_WEB_COMMIT,
          license: ortPackage.license,
          source_url: `https://github.com/microsoft/onnxruntime/tree/${ONNX_RUNTIME_WEB_COMMIT}`,
          license_url: `https://github.com/microsoft/onnxruntime/blob/${ONNX_RUNTIME_WEB_COMMIT}/LICENSE`,
        },
      ],
    }, null, 2)}\n`,
    "utf8",
  );
  await fs.writeFile(
    path.join(transformersVendorDir, "README.md"),
    [
      "# Transformers.js browser runtime",
      "",
      `Vendored from \`@huggingface/transformers@${TRANSFORMERS_JS_VERSION}\` (Apache-2.0).`,
      "",
      "Only the browser ESM bundle is tracked here. The larger ONNX Runtime WASM and model files are generated under the ignored embedding runtime directory and downloaded after app installation.",
      "",
    ].join("\n"),
    "utf8",
  );

  const runtimeFiles = [
    ...MODEL_RUNTIME_FILES,
    `onnx/${MODEL_FILE_NAME}`,
    "ort/ort-wasm-simd-threaded.mjs",
    "ort/ort-wasm-simd-threaded.wasm",
    "LICENSE-APACHE-2.0.txt",
    "THIRD_PARTY_NOTICES.json",
  ];
  return Promise.all(runtimeFiles.map(async (relativeFile) => {
    const file = path.join(modelRuntimeDir, ...relativeFile.split("/"));
    const [stat, sha256] = await Promise.all([fs.stat(file), sha256File(file)]);
    return {
      key: `embedding-runtime-${relativeFile.replaceAll("/", "-").replaceAll(".", "-")}`,
      label: `Semantic embedding runtime: ${relativeFile}`,
      artifact_kind: "embedding-runtime",
      url: `/cz/data/embeddings/${MODEL_ID}/runtime/${relativeFile}`,
      asset_path: `data/embeddings/${MODEL_ID}/runtime/${relativeFile}`,
      native_required: true,
      browser_required: true,
      file,
      relativeFile,
      bytes: stat.size,
      sha256,
    };
  }));
}

async function createSemanticEmbedder() {
  const { env, pipeline } = await import("@huggingface/transformers");
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  // Embed from the staged runtime tree. Besides matching the files shipped to
  // clients, this avoids reopening Hugging Face snapshot symlinks that Windows
  // cannot resolve when the cache was populated inside WSL or a Linux container.
  const extractor = await pipeline("feature-extraction", modelRuntimeDir, {
    dtype: "fp32",
    device: "cpu",
    model_file_name: MODEL_FILE_BASENAME,
    local_files_only: true,
  });

  return {
    async embedTexts(texts) {
      const vectors = [];
      for (let start = 0; start < texts.length; start += EMBEDDING_BATCH_SIZE) {
        const batch = texts.slice(start, start + EMBEDDING_BATCH_SIZE);
        const output = await extractor(batch, { pooling: "mean", normalize: true });
        const dimensions = output.dims || [];
        if (dimensions.length !== 2 || dimensions[0] !== batch.length || dimensions[1] !== EMBEDDING_DIMENSION) {
          throw new Error(`Unexpected semantic embedding tensor shape ${JSON.stringify(dimensions)}.`);
        }
        for (let row = 0; row < batch.length; row += 1) {
          const offset = row * EMBEDDING_DIMENSION;
          vectors.push(normalizeVector(Float32Array.from(
            output.data.slice(offset, offset + EMBEDDING_DIMENSION),
          )));
        }
        console.error(`Embedded ${Math.min(start + batch.length, texts.length)} / ${texts.length}`);
      }
      return vectors;
    },
    async dispose() {
      await extractor.dispose?.();
    },
  };
}

async function copyRequiredFile(source, destination) {
  let bytes;
  try {
    bytes = await fs.readFile(source);
  } catch {
    try {
      const linkTarget = await fs.readlink(source);
      bytes = await fs.readFile(path.resolve(path.dirname(source), linkTarget));
    } catch {
      const relativeModelFile = path.relative(modelSourceDir, source).replaceAll("\\", "/");
      const blobId = MODEL_RUNTIME_BLOB_IDS[relativeModelFile];
      if (!blobId) throw new Error(`Required semantic runtime file is missing: ${source}`);
      const blobFile = path.resolve(modelSourceDir, "..", "..", "blobs", blobId);
      try {
        bytes = await fs.readFile(blobFile);
      } catch {
        throw new Error(`Required semantic runtime file is missing: ${source}`);
      }
    }
  }
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, bytes);
    await fs.rm(destination, { force: true });
    await fs.rename(temporary, destination);
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => {});
  }
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

async function readAssetKeymap(spec) {
  const { file } = spec;
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
    const category = String(value.category || spec.defaultCategory || "").trim();
    if (!category) throw new Error(`${file}: entry ${assetPath} has blank category`);
    const action = String(value.action || category).trim();
    if (!action) throw new Error(`${file}: entry ${assetPath} has blank action`);
    const embedding = value.embedding && typeof value.embedding === "object" && !Array.isArray(value.embedding)
      ? value.embedding
      : {};
    const documentId = String(embedding.document_id || assetDocumentId(assetPath)).trim();
    const chunkId = String(embedding.chunk_id || `${documentId}:description`).trim();
    const referencedModelId = String(embedding.model_id || MODEL_ID).trim();
    const table = String(embedding.table || spec.table).trim();
    if (!documentId || !chunkId) throw new Error(`${file}: entry ${assetPath} has blank DB reference`);
    if (![MODEL_ID, LEGACY_HASH_MODEL_ID].includes(referencedModelId)) {
      throw new Error(`${file}: entry ${assetPath} uses unsupported model ${referencedModelId}`);
    }
    if (table !== spec.table) throw new Error(`${file}: entry ${assetPath} must reference ${spec.table}`);
    return {
      assetPath,
      description,
      category,
      action,
      documentId,
      chunkId,
      modelId: MODEL_ID,
      table,
      group: spec.group,
      sourceKind: spec.sourceKind,
      sourceKeymapFile: file,
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

async function updateAssetKeymapReferences(assetRows) {
  const rowsByFile = new Map();
  for (const row of assetRows) {
    if (!rowsByFile.has(row.sourceKeymapFile)) rowsByFile.set(row.sourceKeymapFile, []);
    rowsByFile.get(row.sourceKeymapFile).push(row);
  }

  for (const [file, rowsForFile] of rowsByFile) {
    const keymap = JSON.parse(await fs.readFile(file, "utf8"));
    let changed = false;
    for (const row of rowsForFile) {
      const entry = keymap[row.assetPath];
      if (!entry) throw new Error(`${file}: missing asset entry ${row.assetPath}`);
      const previous = entry.embedding && typeof entry.embedding === "object" ? entry.embedding : {};
      const embedding = {
        ...previous,
        database: `/cz/data/embeddings/${MODEL_ID}/${DB_FILE_NAME}`,
        table: row.table,
        model_id: MODEL_ID,
        document_id: row.documentId,
        chunk_id: row.chunkId,
      };
      if (JSON.stringify(previous) !== JSON.stringify(embedding)) changed = true;
      entry.embedding = embedding;
    }
    if (changed) await writeJson(file, keymap);
  }
}

async function buildDatabase(SQL, schemaSql, items, assetItems, file) {
  const db = new SQL.Database();
  db.run("PRAGMA foreign_keys = ON");
  db.run(schemaSql);
  db.run("DELETE FROM macaw_action_embedding_refs");
  db.run("DELETE FROM robot_embedding_refs");
  db.run("DELETE FROM asset_embedding_refs");
  db.run("DELETE FROM embeddings");
  db.run("DELETE FROM chunks");
  db.run("DELETE FROM documents");
  db.run("INSERT OR REPLACE INTO schema_meta(key, value) VALUES (?, ?)", ["schema_name", SCHEMA_NAME]);
  db.run("INSERT OR REPLACE INTO schema_meta(key, value) VALUES (?, ?)", ["schema_version", String(SCHEMA_VERSION)]);
  db.run("INSERT OR REPLACE INTO schema_meta(key, value) VALUES (?, ?)", ["default_embedding_model", MODEL_ID]);
  db.run("INSERT OR REPLACE INTO schema_meta(key, value) VALUES (?, ?)", ["embedding_text_field", EMBEDDING_TEXT_FIELD]);
  db.run("INSERT OR REPLACE INTO schema_meta(key, value) VALUES (?, ?)", ["embedding_input_policy", EMBEDDING_INPUT_POLICY]);
  db.run("INSERT OR REPLACE INTO schema_meta(key, value) VALUES (?, ?)", ["asset_embedding_table", MISC_ASSET_EMBEDDING_TABLE]);
  db.run("INSERT OR REPLACE INTO schema_meta(key, value) VALUES (?, ?)", ["asset_embedding_text_field", ASSET_EMBEDDING_TEXT_FIELD]);
  db.run("INSERT OR REPLACE INTO schema_meta(key, value) VALUES (?, ?)", ["asset_embedding_input_policy", ASSET_EMBEDDING_INPUT_POLICY]);
  db.run("INSERT OR REPLACE INTO schema_meta(key, value) VALUES (?, ?)", ["robot_embedding_table", ROBOT_ASSET_EMBEDDING_TABLE]);
  db.run("INSERT OR REPLACE INTO schema_meta(key, value) VALUES (?, ?)", ["robot_embedding_text_field", ASSET_EMBEDDING_TEXT_FIELD]);
  db.run("INSERT OR REPLACE INTO schema_meta(key, value) VALUES (?, ?)", ["robot_embedding_input_policy", ASSET_EMBEDDING_INPUT_POLICY]);
  db.run("INSERT OR REPLACE INTO schema_meta(key, value) VALUES (?, ?)", ["macaw_action_embedding_table", MACAW_ACTION_EMBEDDING_TABLE]);
  db.run("INSERT OR REPLACE INTO schema_meta(key, value) VALUES (?, ?)", ["macaw_action_embedding_text_field", ASSET_EMBEDDING_TEXT_FIELD]);
  db.run("INSERT OR REPLACE INTO schema_meta(key, value) VALUES (?, ?)", ["macaw_action_embedding_input_policy", ASSET_EMBEDDING_INPUT_POLICY]);
  db.run(
    `INSERT OR REPLACE INTO embedding_models(
      id, provider, model_name, revision, license, dimension, max_tokens, pooling,
      normalized, vector_encoding, distance_metric, source_url, metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      MODEL_ID,
      "sentence-transformers",
      MODEL_SOURCE_ID,
      MODEL_REVISION,
      MODEL_LICENSE,
      EMBEDDING_DIMENSION,
      256,
      "attention_mask_mean_pooling",
      1,
      VECTOR_ENCODING,
      DISTANCE_METRIC,
      `https://huggingface.co/${MODEL_SOURCE_ID}/tree/${MODEL_REVISION}`,
      JSON.stringify({
        quantization: "qint8_arm64",
        onnx_file: `onnx/${MODEL_FILE_NAME}`,
        embedding_text_field: EMBEDDING_TEXT_FIELD,
        embedding_input_policy: EMBEDDING_INPUT_POLICY,
      }),
    ],
  );

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
  const robotRefStmt = db.prepare(`
    INSERT INTO robot_embedding_refs(
      asset_path, category, description, document_id, chunk_id, model_id, metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const macawActionRefStmt = db.prepare(`
    INSERT INTO macaw_action_embedding_refs(
      asset_path, action, description, document_id, chunk_id, model_id, metadata_json
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
        asset_group: row.group,
        category: row.category,
        action: row.action,
        source_keymap: path.relative(caatuuRoot, row.sourceKeymapFile).replaceAll("\\", "/"),
        embedding_text_field: ASSET_EMBEDDING_TEXT_FIELD,
        embedding_input_policy: ASSET_EMBEDDING_INPUT_POLICY,
      });
      const chunkMetadata = JSON.stringify({
        asset_path: row.assetPath,
        asset_group: row.group,
        category: row.category,
        action: row.action,
        embedding_text_field: ASSET_EMBEDDING_TEXT_FIELD,
        embedding_input_policy: ASSET_EMBEDDING_INPUT_POLICY,
        indexed_text_hash: sha256Text(indexedText),
        indexed_text_tokens: tokenize(indexedText).length,
      });
      const refMetadata = JSON.stringify({
        source_kind: row.sourceKind,
        asset_group: row.group,
        category: row.category,
        action: row.action,
        source_keymap: path.relative(caatuuRoot, row.sourceKeymapFile).replaceAll("\\", "/"),
      });

      documentStmt.run([
        row.documentId,
        row.sourceKind,
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
      if (row.table === MISC_ASSET_EMBEDDING_TABLE) {
        assetRefStmt.run([
          row.assetPath,
          row.category,
          row.description,
          row.documentId,
          row.chunkId,
          row.modelId,
          refMetadata,
        ]);
      } else if (row.table === ROBOT_ASSET_EMBEDDING_TABLE) {
        robotRefStmt.run([
          row.assetPath,
          row.category,
          row.description,
          row.documentId,
          row.chunkId,
          row.modelId,
          refMetadata,
        ]);
      } else if (row.table === MACAW_ACTION_EMBEDDING_TABLE) {
        macawActionRefStmt.run([
          row.assetPath,
          row.action,
          row.description,
          row.documentId,
          row.chunkId,
          row.modelId,
          refMetadata,
        ]);
      } else {
        throw new Error(`${row.assetPath}: unsupported asset embedding table ${row.table}`);
      }
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
    robotRefStmt.free();
    macawActionRefStmt.free();
  }

  const bytes = db.export();
  db.close();
  await fs.writeFile(file, Buffer.from(bytes));
}

async function writeManifest(rows, assetItems, dbFile, file, runtimeArtifacts) {
  const [stat, sha256] = await Promise.all([fs.stat(dbFile), sha256File(dbFile)]);
  const qualityCounts = countFields(rows);
  const totalRows = rows.length + assetItems.length;
  const assetCounts = countAssetGroups(assetItems);
  const assetSourceCounts = countAssetSourceKinds(assetItems);
  const manifest = {
    schema_name: SCHEMA_NAME,
    schema_version: SCHEMA_VERSION,
    model_id: MODEL_ID,
    model_source: MODEL_SOURCE_ID,
    model_revision: MODEL_REVISION,
    model_license: MODEL_LICENSE,
    model_source_url: `https://huggingface.co/${MODEL_SOURCE_ID}/tree/${MODEL_REVISION}`,
    model_file_name: MODEL_FILE_BASENAME,
    pooling: "attention_mask_mean_pooling",
    normalized: true,
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
    runtime: {
      transformers_js_version: TRANSFORMERS_JS_VERSION,
      onnx_runtime_web_version: ONNX_RUNTIME_WEB_VERSION,
      model_root: `data/embeddings/${MODEL_ID}/runtime`,
      wasm_paths: {
        mjs: `data/embeddings/${MODEL_ID}/runtime/ort/ort-wasm-simd-threaded.mjs`,
        wasm: `data/embeddings/${MODEL_ID}/runtime/ort/ort-wasm-simd-threaded.wasm`,
      },
      artifacts: runtimeArtifacts.map(({ relativeFile, bytes, sha256 }) => ({
        file: relativeFile,
        bytes,
        sha256,
      })),
    },
    document_count: totalRows,
    chunk_count: totalRows,
    embedding_count: totalRows,
    curriculum_count: rows.length,
    asset_count: assetItems.length,
    asset_counts: assetCounts,
    generated_at: new Date().toISOString(),
    generated_from: path.relative(caatuuRoot, inputFile).replaceAll("\\", "/"),
    generated_asset_keymap: assetCounts.miscellaneous
      ? path.relative(caatuuRoot, assetKeymapFile).replaceAll("\\", "/")
      : null,
    generated_asset_keymaps: Object.fromEntries(
      assetKeymapSpecs
        .filter((spec) => assetCounts[spec.group])
        .map((spec) => [spec.group, path.relative(caatuuRoot, spec.file).replaceAll("\\", "/")]),
    ),
    source_counts: {
      curriculum: rows.length,
      ...assetSourceCounts,
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
        license: MODEL_LICENSE,
        license_url: "https://www.apache.org/licenses/LICENSE-2.0",
        embedding_model_source: MODEL_SOURCE_ID,
        embedding_model_revision: MODEL_REVISION,
        embedding_model_source_url: `https://huggingface.co/${MODEL_SOURCE_ID}/tree/${MODEL_REVISION}`,
        intended_use: "Local curriculum retrieval, duplicate review, game selection, distractor search, and manually described image asset lookup.",
        runtime: `SQLite vector database with Transformers.js ${TRANSFORMERS_JS_VERSION} and ONNX Runtime Web`,
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
        pooling: "attention_mask_mean_pooling",
        normalized: true,
        runtime_root: `${MODEL_ID}/runtime`,
        model_file_name: MODEL_FILE_BASENAME,
        trainable: false,
        notes: [
          "Semantic English retrieval uses the pinned quantized all-MiniLM-L6-v2 ONNX artifact.",
          "Curriculum metadata is stored in SQLite for filtering and review but is not embedded.",
          "Image asset vectors are computed only from manually written English descriptions.",
          "Miscellaneous scene assets and macaw action assets are stored in separate lookup tables.",
          "The legacy local hash database remains versioned separately for rollback and comparison.",
        ],
      },
    ],
  };
  await writeJson(file, catalog);
  return catalog;
}

async function updateBrowserVectorDbUrl(file, sqliteSha256) {
  const shortHash = String(sqliteSha256 || "").slice(0, 8);
  if (!shortHash) throw new Error("Cannot update browser vector DB URL without a SQLite SHA-256.");
  const text = await fs.readFile(file, "utf8");
  const nextUrl = `data/embeddings/${MODEL_ID}/${DB_FILE_NAME}?v=${shortHash}`;
  const nextText = text.replace(
    /^const defaultDbUrl = "data\/embeddings\/[^"]+";/m,
    `const defaultDbUrl = "${nextUrl}";`,
  );
  if (nextText === text) return false;
  await fs.writeFile(file, nextText, "utf8");
  return true;
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
    caveat: "This semantic vector index is computed only from english_text (or manual English image descriptions), never from czech_text or metadata. Retrieval quality is measured separately by the human-curated image benchmark.",
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

function countAssetGroups(assetItems) {
  const counts = {};
  for (const item of assetItems) {
    const key = item?.row?.group || "unknown";
    counts[key] = (counts[key] || 0) + 1;
  }
  return sortObject(counts);
}

function countAssetSourceKinds(assetItems) {
  const counts = {};
  for (const item of assetItems) {
    const key = item?.row?.sourceKind || "image_asset";
    counts[key] = (counts[key] || 0) + 1;
  }
  return sortObject(counts);
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

async function updateSetupAssetsManifest(file, artifactFilesByKey, assetRows = [], extraArtifacts = []) {
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
  const managedArtifacts = [
    await setupArtifactForFile({
      key: "embedding-catalog",
      label: "Embedding catalog",
      artifactKind: "browser-data",
      url: "/cz/data/embeddings/models.json",
      file: artifactFilesByKey["embedding-catalog"],
      nativeRequired: false,
      browserRequired: true,
    }),
    await setupArtifactForFile({
      key: "embedding-manifest",
      label: "Embedding manifest",
      artifactKind: "browser-data",
      url: `/cz/data/embeddings/${MODEL_ID}/manifest.json`,
      file: artifactFilesByKey["embedding-manifest"],
      nativeRequired: false,
      browserRequired: true,
    }),
    await setupArtifactForFile({
      key: "embedding-sqlite",
      label: "Browser embeddings",
      artifactKind: "browser-data",
      url: `/cz/data/embeddings/${MODEL_ID}/${DB_FILE_NAME}`,
      file: artifactFilesByKey["embedding-sqlite"],
      nativeRequired: false,
      browserRequired: true,
    }),
    ...extraArtifacts.map(({ file: _file, relativeFile: _relativeFile, ...artifact }) => artifact),
    ...await setupArtifactsForAssetRows(assetRows),
  ];
  const generatedManagedKeys = new Set(managedArtifacts.map((artifact) => artifact.key));
  const managedAssetPrefixes = [
    ...Object.values(setupAssetGroups).map((group) => `${group.keyPrefix}-`),
    "robot-art-",
  ];
  const retainedArtifacts = manifest.artifacts.filter((artifact) => {
    const key = String(artifact?.key || "");
    const isManagedAsset = managedAssetPrefixes.some((prefix) => key.startsWith(prefix));
    if (!isManagedAsset || generatedManagedKeys.has(key)) return true;
    changed = true;
    return false;
  });
  if (retainedArtifacts.length !== manifest.artifacts.length) manifest.artifacts = retainedArtifacts;
  for (const generatedArtifact of managedArtifacts) {
    const index = manifest.artifacts.findIndex((artifact) => artifact?.key === generatedArtifact.key);
    if (index >= 0) {
      if (JSON.stringify(manifest.artifacts[index]) !== JSON.stringify(generatedArtifact)) changed = true;
      manifest.artifacts[index] = generatedArtifact;
    } else {
      manifest.artifacts.push(generatedArtifact);
      changed = true;
    }
  }

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

async function setupArtifactsForAssetRows(assetRows) {
  const artifacts = [];
  const rowsByGroup = groupAssetRows(assetRows);

  for (const spec of assetKeymapSpecs) {
    const rows = rowsByGroup.get(spec.group) || [];
    const setupGroup = setupAssetGroups[spec.group];
    if (!setupGroup || !rows.length) continue;

    artifacts.push(await setupArtifactForFile({
      key: setupGroup.keymapKey,
      label: setupGroup.keymapLabel,
      artifactKind: "asset-keymap",
      url: unifiedStaticUrlForFile(spec.file),
      file: spec.file,
    }));

    for (const [index, row] of rows.entries()) {
      artifacts.push(await setupArtifactForFile({
        key: `${setupGroup.keyPrefix}-${String(index + 1).padStart(3, "0")}`,
        label: `${setupGroup.imageLabel} ${index + 1}`,
        artifactKind: "visual-asset",
        url: row.assetPath,
        file: unifiedStaticFileForUrl(row.assetPath),
      }));
    }
  }

  return artifacts;
}

function groupAssetRows(assetRows) {
  const groups = new Map();
  for (const row of assetRows) {
    if (!groups.has(row.group)) groups.set(row.group, []);
    groups.get(row.group).push(row);
  }
  return groups;
}

async function setupArtifactForFile({
  key,
  label,
  artifactKind,
  url,
  file,
  nativeRequired = true,
  browserRequired = true,
}) {
  const [stat, sha256] = await Promise.all([fs.stat(file), sha256File(file)]);
  return {
    key,
    label,
    artifact_kind: artifactKind,
    url,
    asset_path: decodeAssetUrl(url),
    bytes: stat.size,
    sha256,
    native_required: nativeRequired,
    browser_required: browserRequired,
  };
}

function unifiedStaticUrlForFile(file) {
  const unifiedStaticRoot = path.join(caatuuRoot, "apps", "caatuu-unified", "static");
  return `/${path.relative(unifiedStaticRoot, file).replaceAll("\\", "/")}`;
}

function unifiedStaticFileForUrl(url) {
  const unifiedStaticRoot = path.join(caatuuRoot, "apps", "caatuu-unified", "static");
  return path.join(unifiedStaticRoot, decodeAssetUrl(url));
}

function decodeAssetUrl(url) {
  const cleanUrl = String(url || "").replace(/^\/+/, "");
  try {
    return decodeURIComponent(cleanUrl);
  } catch {
    return cleanUrl;
  }
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
