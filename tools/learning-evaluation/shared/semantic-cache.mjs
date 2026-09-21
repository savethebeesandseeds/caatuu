import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, mkdir, readFile, readdir, realpath, rename, unlink } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  EnglishMiniLmRanker, ENGLISH_MINILM_RUNTIME, validateEnglishEmbeddingPayload,
} from "../../../apps/language-runtime/static/source/english-minilm-ranker.mjs";
import { verifyEmbeddingRuntimeAssets } from "../../../apps/language-runtime/tooling/verify-embedding-runtime.mjs";

export const SEMANTIC_CACHE_SCHEMA = "caatuu-learning-semantic-cache-v1";
export const PREPROCESSING_VERSION = "english-authority-nfkc-trim-runtime-guard-v1";
export const NORMALIZATION_VERSION = "minilm-mean-l2-float32-v1";
const DEFAULT_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const RECIPE_VERSION = "build-image-embedding-index-cpu-fp32-qint8-file-v1";
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function stableJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
}

function freezeDeep(value) {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freezeDeep);
    Object.freeze(value);
  }
  return value;
}

async function hashFile(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

/** Canonicalization preserves case, punctuation, and interior whitespace. This
 * mechanical runtime guard is not language detection; adapters own provenance. */
export function canonicalEnglishInput(text) {
  return validateEnglishEmbeddingPayload({
    inputLanguage: "en", query: { embeddingText: text },
    candidates: [{ conceptId: "cache.validation", embeddingText: text }],
  }).query.embeddingText;
}

export function semanticCacheKey(text, signature) {
  assertSignature(signature);
  return sha256(stableJson({
    schema: SEMANTIC_CACHE_SCHEMA, preprocessingVersion: PREPROCESSING_VERSION,
    normalizationVersion: NORMALIZATION_VERSION,
    englishText: canonicalEnglishInput(text), signature,
  }));
}

function assertSignature(signature) {
  if (!signature || signature.inputLanguage !== "en" ||
      !Number.isInteger(signature.dimension) || signature.dimension < 1 || signature.dimension > 65_536) {
    throw new TypeError("Model signature requires inputLanguage en and a positive bounded dimension.");
  }
  if (typeof signature.modelId !== "string" || !signature.modelId) {
    throw new TypeError("Model signature requires modelId.");
  }
}

/** Reject malformed, nonfinite, zero, or non-normalized vectors; never silently
 * normalize unknown imported vectors into apparent compatibility. */
export function validateSemanticVector(vector, dimension) {
  if ((!Array.isArray(vector) && !(vector instanceof Float32Array)) || vector.length !== dimension) {
    throw new TypeError(`Semantic vector must contain ${dimension} numeric dimensions.`);
  }
  if (Array.from(vector).some((value) => typeof value !== "number" || !Number.isFinite(value))) {
    throw new TypeError("Semantic vector contains a nonfinite or nonnumeric value.");
  }
  const values = Array.from(Float32Array.from(vector));
  const squaredNorm = values.reduce((sum, value) => sum + value * value, 0);
  if (!Number.isFinite(squaredNorm) || Math.abs(squaredNorm - 1) > 0.002) {
    throw new TypeError("Semantic vector must have unit L2 norm within 0.002 squared-norm tolerance.");
  }
  return values;
}

async function packageSignature(require, name) {
  const entry = require.resolve(name);
  let directory = path.dirname(entry);
  while (true) {
    try {
      const bytes = await readFile(path.join(directory, "package.json"));
      const metadata = JSON.parse(bytes);
      if (metadata.name === name) {
        return {
          directory, entry,
          signature: { name, version: metadata.version, packageSha256: sha256(bytes),
            entrySha256: await hashFile(entry) },
        };
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const parent = path.dirname(directory);
    if (parent === directory) throw new Error(`Cannot locate package metadata for ${name}.`);
    directory = parent;
  }
}

/** Verify the pinned assets and installed recipe without loading the ML engine.
 * The existing container's Transformers CPU recipe loads only when encode runs. */
export async function loadPinnedSemanticModel({ root = DEFAULT_ROOT, individualInputs = false } = {}) {
  const runtimeRoot = path.join(root, "apps/language-runtime");
  await verifyEmbeddingRuntimeAssets({ root: runtimeRoot });
  const catalogBytes = await readFile(path.join(runtimeRoot, "embedding-runtimes.json"));
  const catalog = JSON.parse(catalogBytes);
  const declared = catalog.runtimes.find((entry) => entry.runtime.modelId === ENGLISH_MINILM_RUNTIME.modelId);
  if (!declared || declared.inputLanguage !== "en") throw new Error("Pinned English MiniLM runtime is not declared.");
  if (declared.runtime.modelFileName !== ENGLISH_MINILM_RUNTIME.modelFileName ||
      declared.embedding.dimension !== ENGLISH_MINILM_RUNTIME.embeddingDimension ||
      declared.embedding.pooling !== ENGLISH_MINILM_RUNTIME.pooling ||
      declared.embedding.normalized !== ENGLISH_MINILM_RUNTIME.normalize) {
    throw new Error("Pinned catalog and shared English MiniLM encoder settings differ.");
  }
  const require = createRequire(path.join(root, "tools/czech-ml/package.json"));
  const transformers = await packageSignature(require, "@huggingface/transformers");
  const backend = await packageSignature(require, "onnxruntime-node");
  const common = await packageSignature(require, "onnxruntime-common");
  const projectPackage = JSON.parse(await readFile(path.join(root, "tools/czech-ml/package.json"), "utf8"));
  if (projectPackage.dependencies["@huggingface/transformers"] !== transformers.signature.version) {
    throw new Error("Installed Transformers version differs from the repository's pinned dependency.");
  }
  const nativeDirectory = path.join(backend.directory, "bin/napi-v6", process.platform, process.arch);
  const nativeArtifacts = [];
  for (const file of (await readdir(nativeDirectory, { withFileTypes: true })).filter((item) => item.isFile()).map((item) => item.name).sort()) {
    nativeArtifacts.push({ file, sha256: await hashFile(path.join(nativeDirectory, file)) });
  }
  if (nativeArtifacts.length === 0) throw new Error("No installed native ONNX backend artifacts found.");
  const signature = freezeDeep({
    modelId: declared.runtime.modelId, modelFileName: declared.runtime.modelFileName,
    inputLanguage: "en", dimension: ENGLISH_MINILM_RUNTIME.embeddingDimension,
    modelRevision: declared.source.revision, catalogSha256: sha256(catalogBytes),
    // The verifier checked these hashes against actual bytes, not merely metadata.
    artifacts: declared.artifacts.map(({ path: artifactPath, sha256: digest, bytes }) => ({ path: artifactPath, sha256: digest, bytes })),
    libraries: [transformers.signature, backend.signature, common.signature], nativeArtifacts,
    environment: { node: process.version, platform: process.platform, architecture: process.arch },
    recipe: { version: individualInputs ? `${RECIPE_VERSION}-individual-input-v1` : RECIPE_VERSION, task: "feature-extraction", device: "cpu", dtype: "fp32",
      pooling: "mean", normalize: true, localFilesOnly: true,
      preprocessingVersion: PREPROCESSING_VERSION, normalizationVersion: NORMALIZATION_VERSION,
      rankerSha256: await hashFile(path.join(runtimeRoot, "static/source/english-minilm-ranker.mjs")) },
  });
  let encoderPromise = null;
  const loadEncoder = () => {
    if (!encoderPromise) encoderPromise = (async () => {
      const { env, pipeline } = await import(pathToFileURL(transformers.entry));
      env.allowRemoteModels = false;
      env.allowLocalModels = true;
      const extractor = await pipeline("feature-extraction", path.join(runtimeRoot, "models", ENGLISH_MINILM_RUNTIME.modelId), {
        dtype: "fp32", device: "cpu", model_file_name: ENGLISH_MINILM_RUNTIME.modelFileName, local_files_only: true,
      });
      return { encoder: new EnglishMiniLmRanker({ extractor }), extractor };
    })().catch((error) => { encoderPromise = null; throw error; });
    return encoderPromise;
  };
  return Object.freeze({
    signature,
    async encode(texts) {
      const canonical = texts.map(canonicalEnglishInput);
      const encoder = (await loadEncoder()).encoder;
      if (!individualInputs) return encoder.embedBatch(canonical);
      const vectors = [];
      for (const text of canonical) vectors.push((await encoder.embedBatch([text]))[0]);
      return vectors;
    },
    async encodeBatchedDiagnostic(texts) {
      return (await loadEncoder()).encoder.embedBatch(texts.map(canonicalEnglishInput));
    },
    async dispose() {
      if (encoderPromise) await (await encoderPromise).extractor.dispose?.();
      encoderPromise = null;
    },
  });
}

function confinedCacheDirectory(root, directory) {
  const allowed = path.resolve(root, "artifacts/learning-evaluation");
  const resolved = path.resolve(directory);
  const relative = path.relative(allowed, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Semantic cache directory must be below artifacts/learning-evaluation/<area>/.");
  }
  return resolved;
}

function unsafeCachePath(message) {
  const error = new Error(message);
  error.code = "EUNSAFECACHE";
  return error;
}

async function assertCacheDirectorySafe(root, directory) {
  const canonicalRoot = path.resolve(root);
  if (await realpath(canonicalRoot) !== canonicalRoot) {
    throw unsafeCachePath("Semantic cache root must be canonical, without symlink ancestors.");
  }
  let component = canonicalRoot;
  for (const segment of path.relative(canonicalRoot, directory).split(path.sep).filter(Boolean)) {
    component = path.join(component, segment);
    let info;
    try { info = await lstat(component); }
    catch (error) { if (error.code === "ENOENT") return; throw error; }
    if (info.isSymbolicLink()) throw unsafeCachePath(`Semantic cache directory contains a symlink: ${component}`);
    if (!info.isDirectory()) throw unsafeCachePath(`Semantic cache component is not a directory: ${component}`);
  }
}

/** Each key owns one immutable complete JSON entry. Unique temporary files plus
 * atomic rename prevent partial readers and lost aggregate-index updates across
 * processes. A concurrent equivalent writer may replace a complete same-key file. */
async function atomicWrite(root, file, value) {
  await assertCacheDirectorySafe(root, path.dirname(file));
  await mkdir(path.dirname(file), { recursive: true });
  await assertCacheDirectorySafe(root, path.dirname(file));
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  const { writeFile } = await import("node:fs/promises");
  try {
    await writeFile(temporary, `${JSON.stringify(value)}\n`, { flag: "wx" });
    await rename(temporary, file);
  } finally {
    await unlink(temporary).catch((error) => { if (error.code !== "ENOENT") throw error; });
  }
}

export async function createSemanticCache({
  root = DEFAULT_ROOT,
  directory = path.join(root, "artifacts/learning-evaluation/content/semantic-cache"),
  model, batchSize = 32,
} = {}) {
  if (!model || typeof model.encode !== "function") throw new TypeError("A semantic model with encode(texts) is required.");
  assertSignature(model.signature);
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 4096) throw new TypeError("batchSize must be an integer from 1 to 4096.");
  const cacheDirectory = confinedCacheDirectory(root, directory);
  await assertCacheDirectorySafe(root, cacheDirectory);
  const signature = freezeDeep(JSON.parse(stableJson(model.signature)));
  const signatureHash = sha256(stableJson(signature));
  const memory = new Map();
  const counters = { requestedDocuments: 0, eligibleDocuments: 0, skippedDocuments: 0,
    uniqueCanonicalInputs: 0, embeddedVectors: 0, reusedVectors: 0, diskReusedVectors: 0,
    memoryReusedVectors: 0, duplicateDocuments: 0, invalidCacheEntries: 0, skipReasons: {} };
  const seen = new Set();
  const stats = () => JSON.parse(JSON.stringify(counters));
  let pending = Promise.resolve();

  async function embed(documents) {
    if (!Array.isArray(documents)) throw new TypeError("Semantic documents must be an array.");
    const prepared = [], skipped = [], missing = new Map();
    for (const document of documents) {
      counters.requestedDocuments += 1;
      let englishText;
      try {
        if (typeof document?.id !== "string" || !document.id) throw new TypeError("invalid-document-id");
        englishText = canonicalEnglishInput(document.englishText);
      } catch (error) {
        const reason = error.message === "invalid-document-id" ? "invalid-document-id" : "invalid-or-missing-English-input";
        skipped.push({ id: document?.id ?? null, reason, detail: error.message });
        counters.skippedDocuments += 1;
        counters.skipReasons[reason] = (counters.skipReasons[reason] ?? 0) + 1;
        continue;
      }
      counters.eligibleDocuments += 1;
      const key = semanticCacheKey(englishText, signature);
      if (seen.has(key)) counters.duplicateDocuments += 1;
      else { counters.uniqueCanonicalInputs += 1; seen.add(key); }
      prepared.push({ id: document.id, englishText, key });
      if (missing.has(key)) continue;
      if (memory.has(key)) {
        counters.memoryReusedVectors += 1;
        counters.reusedVectors += 1;
        continue;
      }
      const file = path.join(cacheDirectory, key.slice(0, 2), `${key}.json`);
      await assertCacheDirectorySafe(root, path.dirname(file));
      let cached = null;
      try {
        if ((await lstat(file)).isSymbolicLink()) throw unsafeCachePath(`Semantic cache entry is a symlink: ${file}`);
        const raw = JSON.parse(await readFile(file, "utf8"));
        if (raw.schema !== SEMANTIC_CACHE_SCHEMA || raw.key !== key || raw.englishText !== englishText ||
            raw.signatureHash !== signatureHash || stableJson(raw.signature) !== stableJson(signature) ||
            raw.preprocessingVersion !== PREPROCESSING_VERSION || raw.normalizationVersion !== NORMALIZATION_VERSION ||
            raw.encoding !== "number-array-float32") throw new Error("Incompatible semantic-cache entry.");
        cached = validateSemanticVector(raw.vector, signature.dimension);
      } catch (error) {
        if (error.code === "ENOENT") { /* Cache miss, including an absent directory. */ }
        else if (error.code) throw error;
        else counters.invalidCacheEntries += 1;
      }
      if (cached) {
        memory.set(key, cached);
        counters.diskReusedVectors += 1;
        counters.reusedVectors += 1;
      } else missing.set(key, { key, englishText, file });
    }
    const entries = [...missing.values()];
    for (let offset = 0; offset < entries.length; offset += batchSize) {
      const batch = entries.slice(offset, offset + batchSize);
      const vectors = await model.encode(batch.map((entry) => entry.englishText));
      if (!Array.isArray(vectors) || vectors.length !== batch.length) throw new Error("Encoder returned the wrong number of vectors.");
      const validated = vectors.map((vector) => validateSemanticVector(vector, signature.dimension));
      for (let index = 0; index < batch.length; index += 1) {
        const entry = batch[index], vector = validated[index];
        await atomicWrite(root, entry.file, { schema: SEMANTIC_CACHE_SCHEMA, key: entry.key,
          englishText: entry.englishText, signatureHash, signature,
          preprocessingVersion: PREPROCESSING_VERSION, normalizationVersion: NORMALIZATION_VERSION,
          encoding: "number-array-float32", vector });
        memory.set(entry.key, vector);
        counters.embeddedVectors += 1;
      }
    }
    return { rows: prepared.map((entry) => ({ ...entry, vector: [...memory.get(entry.key)],
      cache: missing.has(entry.key) ? "embedded" : "reused" })), skipped, stats: stats() };
  }

  return Object.freeze({
    signature, signatureHash, directory: cacheDirectory, stats,
    embed(documents) {
      // Serialize one instance while allowing another independent evaluator process.
      const result = pending.then(() => embed(documents));
      pending = result.catch(() => {});
      return result;
    },
    async dispose() { await pending; await model.dispose?.(); },
  });
}
