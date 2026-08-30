const CATALOG_SCHEMA = "https://caatuu.org/schemas/embedding-runtime-catalog.v1.schema.json";
const ID_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)+$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const REVISION_PATTERN = /^[a-f0-9]{40}$/u;
const SAFE_PATH_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, expected, path) {
  if (!isRecord(value)) throw new TypeError(`${path} must be an object.`);
  const actual = Object.keys(value).sort();
  const allowed = expected.slice().sort();
  if (actual.length !== allowed.length || actual.some((key, index) => key !== allowed[index])) {
    throw new TypeError(`${path} must contain only: ${allowed.join(", ")}.`);
  }
}

function nonblank(value, path) {
  if (typeof value !== "string" || value.trim() !== value || value.length === 0) {
    throw new TypeError(`${path} must be a nonblank trimmed string.`);
  }
  return value;
}

function positiveInteger(value, path) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`${path} must be a positive integer.`);
  return value;
}

function confinedPath(value, path) {
  const candidate = nonblank(value, path);
  if (candidate.startsWith("/") || candidate.includes("\\")) {
    throw new TypeError(`${path} must be relative to apps/language-runtime.`);
  }
  const segments = candidate.split("/");
  if (segments.some((segment) => !SAFE_PATH_SEGMENT.test(segment) || segment === "." || segment === "..")) {
    throw new TypeError(`${path} must be a normalized confined path.`);
  }
  return candidate;
}

function publicUrl(value, path) {
  const url = nonblank(value, path);
  if (!url.startsWith("/language-runtime/") || url.includes("\\") || url.includes("..") || /[?#]/u.test(url)) {
    throw new TypeError(`${path} must be a canonical /language-runtime URL.`);
  }
  return url;
}

function validateRuntime(runtime, index) {
  const path = `runtimes[${index}]`;
  exactKeys(runtime, ["id", "status", "inputLanguage", "source", "embedding", "runtime", "artifacts"], path);
  const id = nonblank(runtime.id, `${path}.id`);
  if (!ID_PATTERN.test(id)) throw new TypeError(`${path}.id must be a stable runtime ID.`);
  if (runtime.status !== "active") throw new TypeError(`${path}.status must be active.`);
  if (runtime.inputLanguage !== "en") throw new TypeError(`${path}.inputLanguage must be en.`);

  exactKeys(runtime.source, ["model", "revision", "url", "license"], `${path}.source`);
  nonblank(runtime.source.model, `${path}.source.model`);
  if (!REVISION_PATTERN.test(runtime.source.revision)) {
    throw new TypeError(`${path}.source.revision must be a pinned 40-character commit hash.`);
  }
  const sourceUrl = nonblank(runtime.source.url, `${path}.source.url`);
  if (!sourceUrl.startsWith("https://")) throw new TypeError(`${path}.source.url must use HTTPS.`);
  nonblank(runtime.source.license, `${path}.source.license`);

  exactKeys(runtime.embedding, ["dimension", "distanceMetric", "pooling", "normalized"], `${path}.embedding`);
  positiveInteger(runtime.embedding.dimension, `${path}.embedding.dimension`);
  if (runtime.embedding.distanceMetric !== "cosine") throw new TypeError(`${path}.embedding.distanceMetric must be cosine.`);
  if (runtime.embedding.pooling !== "mean") throw new TypeError(`${path}.embedding.pooling must be mean.`);
  if (runtime.embedding.normalized !== true) throw new TypeError(`${path}.embedding.normalized must be true.`);

  exactKeys(runtime.runtime, [
    "transformersModuleUrl",
    "localModelPath",
    "modelId",
    "modelFileName",
    "ortWasmModuleUrl",
    "ortWasmBinaryUrl"
  ], `${path}.runtime`);
  const expectedModelId = `${id}/runtime`;
  if (runtime.runtime.modelId !== expectedModelId) throw new TypeError(`${path}.runtime.modelId must be ${expectedModelId}.`);
  if (runtime.runtime.localModelPath !== "/language-runtime/models/") {
    throw new TypeError(`${path}.runtime.localModelPath must be /language-runtime/models/.`);
  }
  const modelFileName = nonblank(runtime.runtime.modelFileName, `${path}.runtime.modelFileName`);
  if (!SAFE_PATH_SEGMENT.test(modelFileName)) throw new TypeError(`${path}.runtime.modelFileName is unsafe.`);
  for (const field of ["transformersModuleUrl", "ortWasmModuleUrl", "ortWasmBinaryUrl"]) {
    publicUrl(runtime.runtime[field], `${path}.runtime.${field}`);
  }

  if (!Array.isArray(runtime.artifacts) || runtime.artifacts.length === 0) {
    throw new TypeError(`${path}.artifacts must be a non-empty array.`);
  }
  const paths = new Set();
  const urls = new Set();
  for (const [artifactIndex, artifact] of runtime.artifacts.entries()) {
    const artifactPath = `${path}.artifacts[${artifactIndex}]`;
    exactKeys(artifact, ["path", "url", "bytes", "sha256"], artifactPath);
    const repositoryPath = confinedPath(artifact.path, `${artifactPath}.path`);
    const url = publicUrl(artifact.url, `${artifactPath}.url`);
    if (url !== `/language-runtime/${repositoryPath}`) {
      throw new TypeError(`${artifactPath}.url must map exactly to its repository path.`);
    }
    if (!repositoryPath.startsWith("vendor/transformers/")
        && !repositoryPath.startsWith(`models/${id}/runtime/`)) {
      throw new TypeError(`${artifactPath}.path is outside this runtime's reviewed shared roots.`);
    }
    if (/(?:^|\/)(?:README(?:\.[^/]*)?|tests?)(?:\/|$)/iu.test(repositoryPath)) {
      throw new TypeError(`${artifactPath}.path must not expose repository documentation or tests.`);
    }
    positiveInteger(artifact.bytes, `${artifactPath}.bytes`);
    if (typeof artifact.sha256 !== "string" || !SHA256_PATTERN.test(artifact.sha256)) {
      throw new TypeError(`${artifactPath}.sha256 must be lowercase SHA-256.`);
    }
    if (paths.has(repositoryPath) || urls.has(url)) throw new TypeError(`${artifactPath} duplicates an artifact path or URL.`);
    paths.add(repositoryPath);
    urls.add(url);
  }

  const requiredUrls = [
    runtime.runtime.transformersModuleUrl,
    runtime.runtime.ortWasmModuleUrl,
    runtime.runtime.ortWasmBinaryUrl,
    `/language-runtime/models/${id}/runtime/config.json`,
    `/language-runtime/models/${id}/runtime/tokenizer.json`,
    `/language-runtime/models/${id}/runtime/onnx/${modelFileName}.onnx`,
    `/language-runtime/models/${id}/runtime/LICENSE-APACHE-2.0.txt`,
    `/language-runtime/models/${id}/runtime/THIRD_PARTY_NOTICES.json`,
    "/language-runtime/vendor/transformers/LICENSE"
  ];
  for (const url of requiredUrls) {
    if (!urls.has(url)) throw new TypeError(`${path}.artifacts is missing required runtime URL ${url}.`);
  }
  return runtime;
}

export function validateEmbeddingRuntimeCatalog(catalog) {
  exactKeys(catalog, ["$schema", "schemaVersion", "runtimes"], "catalog");
  if (catalog.$schema !== CATALOG_SCHEMA) throw new TypeError(`catalog.$schema must be ${CATALOG_SCHEMA}.`);
  if (catalog.schemaVersion !== 1) throw new TypeError("catalog.schemaVersion must be 1.");
  if (!Array.isArray(catalog.runtimes) || catalog.runtimes.length === 0) {
    throw new TypeError("catalog.runtimes must be a non-empty array.");
  }
  const ids = new Set();
  for (const [index, runtime] of catalog.runtimes.entries()) {
    validateRuntime(runtime, index);
    if (ids.has(runtime.id)) throw new TypeError(`Duplicate embedding runtime ID: ${runtime.id}.`);
    ids.add(runtime.id);
  }
  return catalog;
}

export function selectEmbeddingRuntime(catalog, runtimeId) {
  validateEmbeddingRuntimeCatalog(catalog);
  const selected = catalog.runtimes.find(({ id }) => id === runtimeId);
  if (!selected) throw new TypeError(`Unknown shared embedding runtime: ${runtimeId}.`);
  return selected;
}

export const EMBEDDING_RUNTIME_CATALOG_SCHEMA = CATALOG_SCHEMA;
