const EMBEDDING_DIMENSION = 384;
const CONCEPT_ID_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)+$/u;
const ASCII_LETTER_PATTERN = /[A-Za-z]/u;
const TARGET_SCRIPT_PATTERN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const UNICODE_LETTER_PATTERN = /\p{Letter}/u;

export const ENGLISH_MINILM_RUNTIME = Object.freeze({
  transformersModuleUrl: "/language-runtime/vendor/transformers/transformers.min.js",
  localModelPath: "/language-runtime/models/",
  modelId: "all-minilm-l6-v2-qint8-v0.1/runtime",
  modelFileName: "model_qint8_arm64",
  ortWasmModuleUrl: "/language-runtime/models/all-minilm-l6-v2-qint8-v0.1/runtime/ort/ort-wasm-simd-threaded.mjs",
  ortWasmBinaryUrl: "/language-runtime/models/all-minilm-l6-v2-qint8-v0.1/runtime/ort/ort-wasm-simd-threaded.wasm",
  embeddingDimension: EMBEDDING_DIMENSION,
  pooling: "mean",
  normalize: true
});

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertExactKeys(value, expected, path) {
  if (!isRecord(value)) throw new TypeError(`${path} must be an object.`);
  const actual = Object.keys(value).sort();
  const allowed = expected.slice().sort();
  if (actual.length !== allowed.length || actual.some((key, index) => key !== allowed[index])) {
    throw new TypeError(`${path} must contain only: ${allowed.join(", ")}.`);
  }
  return value;
}

function assertEnglishText(value, path) {
  if (typeof value !== "string") throw new TypeError(`${path} must be a string.`);
  const text = value.normalize("NFKC").trim();
  if (!text || text.length > 1_024) {
    throw new TypeError(`${path} must contain 1 to 1024 characters of authored English text.`);
  }
  if (TARGET_SCRIPT_PATTERN.test(text)) {
    throw new TypeError(`${path} must be English-only; target-language script was found.`);
  }
  for (const character of text) {
    if (UNICODE_LETTER_PATTERN.test(character) && !ASCII_LETTER_PATTERN.test(character)) {
      throw new TypeError(`${path} must be English-only; a non-English letter was found.`);
    }
  }
  if (!ASCII_LETTER_PATTERN.test(text)) {
    throw new TypeError(`${path} must contain authored English text.`);
  }
  return text;
}

function assertConceptId(value, path) {
  if (typeof value !== "string" || !CONCEPT_ID_PATTERN.test(value)) {
    throw new TypeError(`${path} must be a stable dotted or kebab-case concept ID.`);
  }
  return value;
}

export function validateEnglishEmbeddingPayload(payload) {
  assertExactKeys(payload, ["inputLanguage", "query", "candidates"], "payload");
  if (payload.inputLanguage !== "en") {
    throw new TypeError("payload.inputLanguage must be en.");
  }
  assertExactKeys(payload.query, ["embeddingText"], "payload.query");
  const query = assertEnglishText(payload.query.embeddingText, "payload.query.embeddingText");
  if (!Array.isArray(payload.candidates) || payload.candidates.length === 0 || payload.candidates.length > 4_096) {
    throw new TypeError("payload.candidates must contain 1 to 4096 English embedding candidates.");
  }
  const seen = new Set();
  const candidates = payload.candidates.map((candidate, index) => {
    const path = `payload.candidates[${index}]`;
    assertExactKeys(candidate, ["conceptId", "embeddingText"], path);
    const conceptId = assertConceptId(candidate.conceptId, `${path}.conceptId`);
    if (seen.has(conceptId)) throw new TypeError(`Duplicate embedding candidate: ${conceptId}.`);
    seen.add(conceptId);
    return Object.freeze({
      conceptId,
      embeddingText: assertEnglishText(candidate.embeddingText, `${path}.embeddingText`)
    });
  });
  return Object.freeze({
    inputLanguage: "en",
    query: Object.freeze({ embeddingText: query }),
    candidates: Object.freeze(candidates)
  });
}

function assertRuntimePath(value, path, prefix) {
  if (typeof value !== "string" || !value.startsWith(prefix) || value.includes("\\") || value.includes("..")) {
    throw new TypeError(`${path} must stay under ${prefix}.`);
  }
  return value;
}

function normalizeRuntimeOptions(options) {
  if (!isRecord(options)) throw new TypeError("MiniLM runtime options must be an object.");
  const {
    extractor: _extractor,
    importModule: _importModule,
    ...runtimeOptions
  } = options;
  const runtime = { ...ENGLISH_MINILM_RUNTIME, ...runtimeOptions };
  assertRuntimePath(
    runtime.transformersModuleUrl,
    "transformersModuleUrl",
    "/language-runtime/vendor/transformers/"
  );
  assertRuntimePath(runtime.localModelPath, "localModelPath", "/language-runtime/models/");
  assertRuntimePath(runtime.ortWasmModuleUrl, "ortWasmModuleUrl", "/language-runtime/models/");
  assertRuntimePath(runtime.ortWasmBinaryUrl, "ortWasmBinaryUrl", "/language-runtime/models/");
  if (!/^[a-z0-9][a-z0-9._/-]*$/u.test(runtime.modelId) || runtime.modelId.includes("..")) {
    throw new TypeError("modelId must be a confined local model ID.");
  }
  if (!/^[a-z0-9][a-z0-9._-]*$/u.test(runtime.modelFileName)) {
    throw new TypeError("modelFileName must be a safe local model file name.");
  }
  return runtime;
}

function resolveUrl(url) {
  return new URL(url, import.meta.url).href;
}

function normalizeVector(values, path) {
  const vector = values instanceof Float32Array ? values : Float32Array.from(values ?? []);
  if (vector.length !== EMBEDDING_DIMENSION) {
    throw new Error(`${path} must contain ${EMBEDDING_DIMENSION} dimensions; received ${vector.length}.`);
  }
  let normSquared = 0;
  for (const value of vector) {
    if (!Number.isFinite(value)) throw new Error(`${path} contains a non-finite value.`);
    normSquared += value * value;
  }
  const norm = Math.sqrt(normSquared);
  if (!Number.isFinite(norm) || norm <= 0) throw new Error(`${path} has an invalid zero norm.`);
  const normalized = new Float32Array(vector.length);
  for (let index = 0; index < vector.length; index += 1) normalized[index] = vector[index] / norm;
  return normalized;
}

function dotProduct(left, right) {
  let score = 0;
  for (let index = 0; index < EMBEDDING_DIMENSION; index += 1) score += left[index] * right[index];
  return score;
}

function candidateCacheKey(candidate) {
  return `${candidate.conceptId}\u0000${candidate.embeddingText}`;
}

export class EnglishMiniLmRanker {
  constructor(options = {}) {
    this.runtime = Object.freeze(normalizeRuntimeOptions(options));
    this.importModule = options.importModule ?? ((url) => import(url));
    if (typeof this.importModule !== "function") throw new TypeError("importModule must be a function.");
    this.providedExtractor = options.extractor ?? null;
    if (this.providedExtractor !== null && typeof this.providedExtractor !== "function") {
      throw new TypeError("extractor must be a function.");
    }
    this.extractorPromise = null;
    this.candidateVectors = new Map();
  }

  async rank(payload) {
    // Validate and copy the complete boundary before loading any executable model code.
    const safe = validateEnglishEmbeddingPayload(payload);
    const missing = safe.candidates.filter((candidate) => !this.candidateVectors.has(candidateCacheKey(candidate)));
    const texts = [safe.query.embeddingText, ...missing.map(({ embeddingText }) => embeddingText)];
    const vectors = await this.embedBatch(texts);
    const queryVector = vectors[0];
    missing.forEach((candidate, index) => {
      this.candidateVectors.set(candidateCacheKey(candidate), vectors[index + 1]);
    });
    return safe.candidates.map((candidate) => ({
      conceptId: candidate.conceptId,
      score: dotProduct(queryVector, this.candidateVectors.get(candidateCacheKey(candidate)))
    }));
  }

  async embedBatch(texts) {
    if (!Array.isArray(texts) || texts.length === 0) throw new TypeError("Embedding batch must not be empty.");
    const extractor = await this.loadExtractor();
    const output = await extractor(texts, {
      pooling: this.runtime.pooling,
      normalize: this.runtime.normalize
    });
    const dims = Array.from(output?.dims ?? []);
    if (dims.length !== 2 || dims[0] !== texts.length || dims[1] !== EMBEDDING_DIMENSION) {
      throw new Error(`Unexpected MiniLM embedding shape ${JSON.stringify(dims)}.`);
    }
    const data = output?.data;
    if (!data || data.length !== texts.length * EMBEDDING_DIMENSION) {
      throw new Error("MiniLM embedding data length does not match its declared shape.");
    }
    return texts.map((_, index) => normalizeVector(
      data.slice(index * EMBEDDING_DIMENSION, (index + 1) * EMBEDDING_DIMENSION),
      `MiniLM embedding ${index}`
    ));
  }

  async loadExtractor() {
    if (!this.extractorPromise) {
      this.extractorPromise = (async () => {
        if (this.providedExtractor) return this.providedExtractor;
        const transformers = await this.importModule(resolveUrl(this.runtime.transformersModuleUrl));
        const { env, pipeline } = transformers ?? {};
        if (!env?.backends?.onnx?.wasm || typeof pipeline !== "function") {
          throw new Error("The pinned Transformers.js runtime is incompatible.");
        }
        env.allowRemoteModels = false;
        env.allowLocalModels = true;
        env.localModelPath = new URL(this.runtime.localModelPath, import.meta.url).pathname;
        env.backends.onnx.wasm.numThreads = 1;
        env.backends.onnx.wasm.proxy = false;
        env.backends.onnx.wasm.wasmPaths = {
          mjs: resolveUrl(this.runtime.ortWasmModuleUrl),
          wasm: resolveUrl(this.runtime.ortWasmBinaryUrl)
        };
        return pipeline("feature-extraction", this.runtime.modelId, {
          dtype: "fp32",
          model_file_name: this.runtime.modelFileName,
          local_files_only: true
        });
      })().then((extractor) => {
        if (typeof extractor !== "function") throw new Error("MiniLM extractor did not initialize.");
        return extractor;
      }).catch((error) => {
        this.extractorPromise = null;
        throw error;
      });
    }
    return this.extractorPromise;
  }
}

export function createEnglishMiniLmRanker(options = {}) {
  const runtime = new EnglishMiniLmRanker(options);
  const rank = runtime.rank.bind(runtime);
  Object.defineProperty(rank, "runtime", {
    configurable: false,
    enumerable: false,
    writable: false,
    value: runtime
  });
  return rank;
}
