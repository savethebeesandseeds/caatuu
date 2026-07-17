const defaultDbUrl = "data/embeddings/all-minilm-l6-v2-qint8-v0.1/caatuu-cz-curriculum.sqlite?v=765b1062";
const defaultSqlJsModuleUrl = "./vendor/sql.js/sql-wasm.js";
const defaultSqlJsWasmUrl = "./vendor/sql.js/sql-wasm.wasm";
const defaultTransformersModuleUrl = "./vendor/transformers/transformers.min.js";
const defaultSemanticModelId = "all-minilm-l6-v2-qint8-v0.1/runtime";
const defaultSemanticModelPath = "data/embeddings/";
const defaultSemanticModelFileName = "model_qint8_arm64";
const defaultOrtWasmModuleUrl = "data/embeddings/all-minilm-l6-v2-qint8-v0.1/runtime/ort/ort-wasm-simd-threaded.mjs";
const defaultOrtWasmBinaryUrl = "data/embeddings/all-minilm-l6-v2-qint8-v0.1/runtime/ort/ort-wasm-simd-threaded.wasm";

export const caatuuVectorSchema = Object.freeze({
  name: "caatuu-cz-vector-db",
  version: 1,
  defaultModelId: "all-minilm-l6-v2-qint8-v0.1",
  embeddingDimension: 384,
  vectorEncoding: "float32le",
  distanceMetric: "cosine",
  embeddingTextField: "english_text",
  embeddingInputPolicy: "english_text_only"
});

export const caatuuEmbeddingModelCatalog = Object.freeze({
  version: 1,
  defaultModel: "all-minilm-l6-v2-qint8-v0.1",
  models: [
    Object.freeze({
      key: "all-minilm-l6-v2-qint8-v0.1",
      label: "Caatuu Curriculum and Asset Embeddings",
      shortLabel: "Embeddings",
      status: "active",
      artifactKind: "embedding-vector-db",
      runtime: "SQLite vector database with local all-MiniLM ONNX embedder",
      format: "sqlite",
      modelFile: "all-minilm-l6-v2-qint8-v0.1/caatuu-cz-curriculum.sqlite",
      manifestFile: "all-minilm-l6-v2-qint8-v0.1/manifest.json",
      embeddingTextField: "english_text",
      embeddingInputPolicy: "english_text_only",
      trainable: false
    })
  ]
});

export class LocalHashTextEmbedder {
  async embedText(text) {
    return localHashEmbedding(text);
  }
}

export class SemanticMiniLmTextEmbedder {
  constructor(options = {}) {
    this.moduleUrl = options.moduleUrl || defaultTransformersModuleUrl;
    this.modelId = options.modelId || defaultSemanticModelId;
    this.localModelPath = options.localModelPath || defaultSemanticModelPath;
    this.modelFileName = options.modelFileName || defaultSemanticModelFileName;
    this.ortWasmModuleUrl = options.ortWasmModuleUrl || defaultOrtWasmModuleUrl;
    this.ortWasmBinaryUrl = options.ortWasmBinaryUrl || defaultOrtWasmBinaryUrl;
    this.extractorPromise = null;
  }

  async embedText(text) {
    const value = String(text || "").trim();
    if (!value) throw new Error("Semantic embedding text is empty.");
    const extractor = await this.loadExtractor();
    const output = await extractor(value, { pooling: "mean", normalize: true });
    if (!Array.isArray(output.dims) || output.dims[output.dims.length - 1] !== caatuuVectorSchema.embeddingDimension) {
      throw new Error(`Unexpected semantic embedding shape ${JSON.stringify(output.dims || [])}.`);
    }
    return normalizeVector(Float32Array.from(output.data));
  }

  async loadExtractor() {
    if (!this.extractorPromise) {
      this.extractorPromise = (async () => {
        const transformers = await import(resolveUrl(this.moduleUrl));
        const { env, pipeline } = transformers;
        env.allowRemoteModels = false;
        env.allowLocalModels = true;
        env.localModelPath = new URL(this.localModelPath, import.meta.url).pathname;
        env.backends.onnx.wasm.numThreads = 1;
        env.backends.onnx.wasm.proxy = false;
        env.backends.onnx.wasm.wasmPaths = {
          mjs: resolveUrl(this.ortWasmModuleUrl),
          wasm: resolveUrl(this.ortWasmBinaryUrl)
        };
        return pipeline("feature-extraction", this.modelId, {
          dtype: "fp32",
          model_file_name: this.modelFileName,
          local_files_only: true
        });
      })().catch((error) => {
        this.extractorPromise = null;
        throw error;
      });
    }
    return this.extractorPromise;
  }
}

export class BrowserVectorDatabaseManager {
  constructor(options = {}) {
    this.dbUrl = options.dbUrl || defaultDbUrl;
    this.sqlJsModuleUrl = options.sqlJsModuleUrl || defaultSqlJsModuleUrl;
    this.sqlJsWasmUrl = options.sqlJsWasmUrl || defaultSqlJsWasmUrl;
    this.sqlJsGlobalName = options.sqlJsGlobalName || "initSqlJs";
    this.sqlJsFactory = options.sqlJsFactory || null;
    this.embedder = options.embedder || new SemanticMiniLmTextEmbedder(options.semanticEmbedderOptions);
    this.fetchImpl = options.fetchImpl || globalThis.fetch?.bind(globalThis);
    this.SQL = null;
    this.db = null;
  }

  async open() {
    if (this.db) return this;
    if (!this.fetchImpl) throw new Error("Browser fetch is not available.");

    const [SQL, bytes] = await Promise.all([
      this.loadSqlJs(),
      this.fetchBytes(this.dbUrl)
    ]);
    this.SQL = SQL;
    this.db = new SQL.Database(bytes);
    this.assertCompatibleSchema();
    return this;
  }

  close() {
    this.db?.close();
    this.db = null;
  }

  async embedText(text) {
    if (!this.embedder || typeof this.embedder.embedText !== "function") {
      throw new Error("No browser embedding runtime has been configured.");
    }
    const vector = await this.embedder.embedText(text);
    return normalizeVector(vector);
  }

  async searchText(text, options = {}) {
    const queryVector = await this.embedText(text);
    return this.searchVector(queryVector, { ...options, queryText: text });
  }

  searchVector(queryVector, options = {}) {
    this.requireOpen();
    const modelId = options.modelId || caatuuVectorSchema.defaultModelId;
    const limit = clampLimit(options.limit);
    const sourceKinds = normalizeSourceKindFilter(options.sourceKinds);
    const normalizedQuery = normalizeVector(queryVector);
    const rows = [];
    const stmt = this.db.prepare(`
      SELECT
        chunks.id AS chunk_id,
        chunks.document_id,
        chunks.text,
        chunks.metadata_json AS chunk_metadata_json,
        documents.source_kind,
        documents.source_id,
        documents.locale,
        documents.title,
        documents.metadata_json AS document_metadata_json,
        embeddings.vector
      FROM embeddings
      JOIN chunks ON chunks.id = embeddings.chunk_id
      JOIN documents ON documents.id = chunks.document_id
      WHERE embeddings.model_id = $model_id
        AND embeddings.dimension = $dimension
    `);

    try {
      stmt.bind({
        $model_id: modelId,
        $dimension: caatuuVectorSchema.embeddingDimension
      });
      while (stmt.step()) {
        const row = stmt.getAsObject();
        if (sourceKinds.size && !sourceKinds.has(String(row.source_kind || ""))) continue;
        const candidate = decodeFloat32Vector(row.vector);
        const semanticScore = dotProduct(normalizedQuery, candidate);
        const lexicalScore = lexicalOverlapScore(options.queryText, row.text);
        rows.push({
          chunkId: row.chunk_id,
          documentId: row.document_id,
          text: row.text,
          sourceKind: row.source_kind,
          sourceId: row.source_id,
          locale: row.locale,
          title: row.title || "",
          score: semanticScore + lexicalScore * 0.035,
          semanticScore,
          lexicalScore,
          chunkMetadata: parseJsonObject(row.chunk_metadata_json),
          documentMetadata: parseJsonObject(row.document_metadata_json)
        });
      }
    } finally {
      stmt.free();
    }

    return rows
      .sort((left, right) => right.score - left.score)
      .slice(0, limit);
  }

  status() {
    if (!this.db) {
      return {
        open: false,
        schema: caatuuVectorSchema,
        embeddingModelCatalog: caatuuEmbeddingModelCatalog,
        dbUrl: this.dbUrl
      };
    }

    return {
      open: true,
      schema: caatuuVectorSchema,
      embeddingModelCatalog: caatuuEmbeddingModelCatalog,
      dbUrl: this.dbUrl,
      documentCount: this.scalar("SELECT COUNT(*) FROM documents"),
      chunkCount: this.scalar("SELECT COUNT(*) FROM chunks"),
      embeddingCount: this.scalar("SELECT COUNT(*) FROM embeddings")
    };
  }

  async loadSqlJs() {
    if (this.SQL) return this.SQL;
    if (this.sqlJsFactory) {
      this.SQL = await this.sqlJsFactory({
        locateFile: () => this.sqlJsWasmUrl
      });
      return this.SQL;
    }

    let factory = null;
    if (typeof document !== "undefined") {
      await loadClassicScript(this.sqlJsModuleUrl);
      factory = globalThis[this.sqlJsGlobalName];
    } else {
      const module = await import(this.sqlJsModuleUrl);
      factory = module.default || module.initSqlJs;
    }

    if (typeof factory !== "function") {
      throw new Error(`Could not initialize sql.js from ${this.sqlJsModuleUrl}.`);
    }

    this.SQL = await factory({
      locateFile: (file) => file.endsWith(".wasm") ? this.sqlJsWasmUrl : file
    });
    return this.SQL;
  }

  async fetchBytes(url) {
    const response = await this.fetchImpl(url);
    if (!response.ok) throw new Error(`Could not load vector database ${url}: HTTP ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  }

  assertCompatibleSchema() {
    const schemaName = this.metaValue("schema_name");
    const schemaVersion = Number(this.metaValue("schema_version"));
    const defaultModel = this.metaValue("default_embedding_model");
    const embeddingTextField = this.metaValue("embedding_text_field");
    const embeddingInputPolicy = this.metaValue("embedding_input_policy");
    if (schemaName !== caatuuVectorSchema.name || schemaVersion !== caatuuVectorSchema.version) {
      throw new Error(`Unsupported vector database schema ${schemaName || "unknown"} v${schemaVersion || "unknown"}.`);
    }
    if (defaultModel !== caatuuVectorSchema.defaultModelId) {
      throw new Error(`Unsupported default embedding model ${defaultModel || "unknown"}.`);
    }
    if (embeddingTextField !== caatuuVectorSchema.embeddingTextField) {
      throw new Error(`Unsupported embedding text field ${embeddingTextField || "unknown"}.`);
    }
    if (embeddingInputPolicy !== caatuuVectorSchema.embeddingInputPolicy) {
      throw new Error(`Unsupported embedding input policy ${embeddingInputPolicy || "unknown"}.`);
    }
  }

  metaValue(key) {
    const stmt = this.db.prepare("SELECT value FROM schema_meta WHERE key = $key");
    try {
      stmt.bind({ $key: key });
      return stmt.step() ? String(stmt.get()[0]) : "";
    } finally {
      stmt.free();
    }
  }

  scalar(sql) {
    const stmt = this.db.prepare(sql);
    try {
      return stmt.step() ? Number(stmt.get()[0]) : 0;
    } finally {
      stmt.free();
    }
  }

  requireOpen() {
    if (!this.db) throw new Error("Vector database is not open.");
  }
}

export function decodeFloat32Vector(value) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  if (bytes.byteLength % 4 !== 0) throw new Error("Vector byte length is not divisible by 4.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const vector = new Float32Array(bytes.byteLength / 4);
  for (let index = 0; index < vector.length; index += 1) {
    vector[index] = view.getFloat32(index * 4, true);
  }
  return vector;
}

export function encodeFloat32Vector(vector) {
  const normalized = normalizeVector(vector);
  const bytes = new Uint8Array(normalized.length * 4);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < normalized.length; index += 1) {
    view.setFloat32(index * 4, normalized[index], true);
  }
  return bytes;
}

export function normalizeVector(vector) {
  const values = vector instanceof Float32Array ? vector : Float32Array.from(vector || []);
  if (values.length !== caatuuVectorSchema.embeddingDimension) {
    throw new Error(`Expected ${caatuuVectorSchema.embeddingDimension} dimensions, got ${values.length}.`);
  }

  let norm = 0;
  for (const value of values) norm += value * value;
  norm = Math.sqrt(norm);
  if (!Number.isFinite(norm) || norm <= 0) throw new Error("Embedding vector has zero or invalid norm.");

  const out = new Float32Array(values.length);
  for (let index = 0; index < values.length; index += 1) {
    out[index] = values[index] / norm;
  }
  return out;
}

function dotProduct(left, right) {
  if (left.length !== right.length) throw new Error("Vector dimension mismatch.");
  let score = 0;
  for (let index = 0; index < left.length; index += 1) {
    score += left[index] * right[index];
  }
  return score;
}

function clampLimit(value) {
  const limit = Number(value || 10);
  if (!Number.isFinite(limit)) return 10;
  return Math.min(100, Math.max(1, Math.trunc(limit)));
}

function normalizeSourceKindFilter(value) {
  if (!Array.isArray(value)) return new Set();
  return new Set(value.map((item) => String(item || "").trim()).filter(Boolean));
}

function parseJsonObject(value) {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function lexicalOverlapScore(queryText, candidateText) {
  const queryTokens = new Set(tokenize(queryText).filter((token) => token.length > 1));
  if (!queryTokens.size) return 0;
  const candidateTokens = new Set(tokenize(candidateText));
  let shared = 0;
  for (const token of queryTokens) {
    if (candidateTokens.has(token)) shared += 1;
  }
  return shared / queryTokens.size;
}

function resolveUrl(url) {
  return new URL(url, import.meta.url).href;
}

function loadClassicScript(url) {
  const absoluteUrl = new URL(url, document.baseURI).href;
  const existing = Array.from(document.scripts).find((script) => script.src === absoluteUrl);
  if (existing?.dataset.loaded === "true") return Promise.resolve();
  if (existing?.dataset.loading === "true") {
    return new Promise((resolve, reject) => {
      existing.addEventListener("load", resolve, { once: true });
      existing.addEventListener("error", () => reject(new Error(`Could not load script ${url}.`)), { once: true });
    });
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = absoluteUrl;
    script.async = true;
    script.dataset.loading = "true";
    script.addEventListener("load", () => {
      script.dataset.loading = "false";
      script.dataset.loaded = "true";
      resolve();
    }, { once: true });
    script.addEventListener("error", () => reject(new Error(`Could not load script ${url}.`)), { once: true });
    document.head.append(script);
  });
}

function localHashEmbedding(text) {
  const tokens = tokenize(text);
  const features = tokens.length ? tokens : ["__blank__"];
  const vector = new Float32Array(caatuuVectorSchema.embeddingDimension);
  for (const token of features) {
    addHashFeature(vector, token, 1);
    addCharNgrams(vector, token, 3, 0.35);
  }
  return normalizeVector(vector);
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
