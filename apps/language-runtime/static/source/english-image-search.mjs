import { EnglishMiniLmRanker, validateEnglishEmbeddingPayload } from "./english-minilm-ranker.mjs";
import { isChildFacingMacawActionAssetAllowed } from "./child-facing-assets.mjs";
import { IMAGE_EMBEDDING_INDEX_URL, readImageEmbeddingIndex, rankIndexedImages } from "./image-embedding-index.mjs?v=image-index-runtime-1";

export const IMAGE_SOURCES = Object.freeze([
  { kind: "image_asset", path: "/assets/miscellaneous/keymap.json", prefix: "/assets/miscellaneous/", label: "developer.images.miscellaneous" },
  { kind: "macaw_action_asset", path: "/assets/macaw/actions/keymaps.json", prefix: "/assets/macaw/actions/", label: "developer.images.actions" }
]);
function safeAssetPath(value, source) {
  const candidate = String(value || "").trim();
  if (!candidate.startsWith(source.prefix)) return "";
  try {
    const decoded = decodeURIComponent(candidate);
    if (!decoded.startsWith(source.prefix) || decoded.slice(source.prefix.length).includes("/")
        || decoded.includes("\\") || /[?#]/u.test(decoded) || !/\.(png|webp|jpe?g|avif)$/iu.test(decoded)) return "";
    return candidate;
  } catch { return ""; }
}

/** Build the image-only catalog from shared metadata, without a course vector database. */
export function normalizeImageCatalog(raw, sourceKind) {
  const source = IMAGE_SOURCES.find(({ kind }) => kind === sourceKind);
  if (!source || !raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  return Object.entries(raw).flatMap(([path, metadata], index) => {
    const safePath = safeAssetPath(path, source);
    const description = String(typeof metadata === "string" ? metadata : metadata?.description || "").trim();
    const action = String(metadata?.action || "");
    if (!safePath || !description
        || (sourceKind === "macaw_action_asset" && !isChildFacingMacawActionAssetAllowed(safePath, action))) return [];
    return [{
      conceptId: `shared-${sourceKind.replaceAll("_", "-")}-${index}`,
      embeddingText: description.slice(0, 1024), description, path: safePath,
      title: String(metadata?.title || action.replaceAll("_", " ") || metadata?.category || ""),
      sourceKind, sourceCatalog: source.path, sourceLabel: source.label
    }];
  });
}

const STOPWORDS = new Set("a an and are as at be by for from he her his in is it its of on or she that the their they this to was were with you your".split(" "));
function tokens(value) { return (String(value).toLowerCase().match(/[a-z0-9]+/gu) || []).filter(token => !STOPWORDS.has(token)); }

// Games and developer tools share one model; Android WebViews cannot afford a
// separate WASM model and simultaneous inference for each image panel.
const SHARED_RANKING = Symbol.for("caatuu.sharedImageRanking.v2");
const textCacheKey = (text, individualInputs = false) => JSON.stringify([individualInputs ? "individual-input-v1" : "legacy-batch-v1", text]);
export function sharedEnglishEmbeddingOwner() {
  try {
    if (globalThis.window?.parent?.location?.origin === globalThis.location?.origin) return window.parent;
  } catch { /* A cross-origin frame owns its own runtime. */ }
  return globalThis;
}

function createRankingState(options = {}) {
  return { engine: new EnglishMiniLmRanker(), tail: Promise.resolve(), indexPromise: null, queries: new Map(), ...options };
}

function sharedRanking(owner) {
  // A live page can still have an older consumer. Keep its model and queue so
  // cache-version migration cannot create overlapping inference operations.
  const legacy = Symbol.for("caatuu.sharedImageRanking.v1");
  const ranking = owner[SHARED_RANKING] ||= owner[legacy] || createRankingState();
  owner[legacy] ||= ranking;
  return ranking;
}

const SHARED_TEXT_CACHE_LIMIT = 256;

export function normalizeSharedEnglishText(text) {
  return validateEnglishEmbeddingPayload({ inputLanguage: "en", query: { embeddingText: text },
    candidates: [{ conceptId: "shared-english-text", embeddingText: "English text" }] }).query.embeddingText;
}

function cachedTextVector(ranking, text) {
  const vector = ranking?.queries.get(text);
  if (vector) { ranking.queries.delete(text); ranking.queries.set(text, vector); }
  return vector || null;
}

function rememberTextVector(ranking, text, vector) {
  ranking.queries.delete(text);
  ranking.queries.set(text, vector);
  while (ranking.queries.size > SHARED_TEXT_CACHE_LIMIT) ranking.queries.delete(ranking.queries.keys().next().value);
}

/** A cache read never constructs a model or starts inference. */
export function peekSharedEnglishVector(text, { owner = sharedEnglishEmbeddingOwner(), individualInputs = false } = {}) {
  return cachedTextVector(owner[SHARED_RANKING], textCacheKey(normalizeSharedEnglishText(text), individualInputs));
}

function checkedTextVector(values) {
  if (!values || values.length !== 384) throw new Error("English embeddings require 384 dimensions.");
  const vector = Float32Array.from(values);
  let squared = 0;
  for (const value of vector) {
    if (!Number.isFinite(value)) throw new Error("English embedding contains a non-finite value.");
    squared += value * value;
  }
  if (!(squared > 0) || !Number.isFinite(squared)) throw new Error("English embedding has an invalid norm.");
  const norm = Math.sqrt(squared);
  return vector.map(value => value / norm);
}

/**
 * Bounded optional consumers share image search's model, queue and text cache.
 * A timeout releases the caller, not the underlying model lock: a stalled
 * inference must never allow a second model operation to run concurrently.
 */
export async function embedSharedEnglishTexts(texts, {
  owner = sharedEnglishEmbeddingOwner(), encoder, timeoutMs = 5000, individualInputs = false
} = {}) {
  if (!Array.isArray(texts) || !texts.length || texts.length > 32) throw new TypeError("Supply 1 to 32 English texts.");
  if (encoder !== undefined && typeof encoder !== "function") throw new TypeError("encoder must be a function.");
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 10000) throw new TypeError("timeoutMs must be 1 to 10000.");
  const normalized = texts.map(normalizeSharedEnglishText);
  const key = text => textCacheKey(text, individualInputs);
  const ranking = sharedRanking(owner);
  const pending = ranking.textRequests ||= new Map();
  const missing = [...new Set(normalized)].filter(text => !cachedTextVector(ranking, key(text)) && !pending.has(key(text)));
  if (pending.size + missing.length > 64) throw new Error("Shared English embedding queue is full.");
  if (missing.length) {
    let expired = false;
    const expiry = setTimeout(() => { expired = true; }, timeoutMs);
    const request = ranking.tail.then(async () => {
      if (expired) throw new Error("Shared English embedding request timed out before inference.");
      // Earlier image queries may have supplied some of these vectors while
      // this request waited for the shared model lock.
      const absent = missing.filter(text => !cachedTextVector(ranking, key(text)));
      const encode = texts => encoder ? encoder(texts) : ranking.engine.embedBatch(texts);
      let vectors = [];
      if (individualInputs) {
        // The pinned model's output depends on batch companions. One input per model
        // call gives each text a stable vector; the outer request stays bounded.
        for (const text of absent) {
          if (expired) throw new Error("Shared English embedding request timed out before inference.");
          const value = await encode([text]);
          if (!Array.isArray(value) || value.length !== 1) throw new Error("English embedding batch size does not match its input.");
          const checked = checkedTextVector(value[0]);
          vectors.push(checked);
          rememberTextVector(ranking, key(text), checked);
        }
      } else if (absent.length) vectors = await encode(absent);
      if (!Array.isArray(vectors) || vectors.length !== absent.length) throw new Error("English embedding batch size does not match its input.");
      const checked = individualInputs ? vectors : vectors.map(checkedTextVector);
      absent.forEach((text, index) => rememberTextVector(ranking, key(text), checked[index]));
      return missing.map(text => cachedTextVector(ranking, key(text)));
    }).finally(() => { clearTimeout(expiry); missing.forEach(text => pending.delete(key(text))); });
    ranking.tail = request.catch(() => {});
    missing.forEach((text, index) => pending.set(key(text), request.then(vectors => vectors[index])));
  }
  let timer;
  try {
    return await Promise.race([
      Promise.all(normalized.map(text => cachedTextVector(ranking, key(text)) || pending.get(key(text)))),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Shared English embeddings timed out.")), timeoutMs); })
    ]);
  } finally { clearTimeout(timer); }
}

export function createEnglishImageSearch({
  loadJson = async (path) => {
    const response = await fetch(path, { cache: "force-cache" });
    if (!response.ok) throw new Error(`Image catalog unavailable (${response.status}).`);
    return response.json();
  },
  ranker,
  embedQuery,
  owner = sharedEnglishEmbeddingOwner(),
  timeoutMs = 10000
} = {}) {
  const ranking = ranker || embedQuery ? createRankingState({ ranker, embedQuery })
    : sharedRanking(owner);
  const catalogPromises = new Map();
  function loadSource(source) {
    if (!catalogPromises.has(source.kind)) {
      const pending = Promise.resolve()
        .then(() => loadJson(source.path))
        .then((raw) => normalizeImageCatalog(raw, source.kind))
        .catch((error) => { catalogPromises.delete(source.kind); throw error; });
      catalogPromises.set(source.kind, pending);
    }
    return catalogPromises.get(source.kind);
  }
  async function rankImages(query, rows) {
    // Injected rankers retain the bounded catalog interface used by callers
    // testing alternate engines. Production reads precomputed image vectors.
    if (ranking.ranker) {
      const scored = [];
      for (let offset = 0; offset < rows.length; offset += 32) {
        const candidates = rows.slice(offset, offset + 32).map(({ conceptId, embeddingText }) => ({ conceptId, embeddingText }));
        const ranked = await ranking.ranker({ inputLanguage: "en", query: { embeddingText: query }, candidates });
        const ids = new Set(candidates.map(row => row.conceptId));
        if (!Array.isArray(ranked) || ranked.length !== candidates.length
            || new Set(ranked.map(row => row?.conceptId)).size !== ids.size
            || ranked.some(row => !ids.has(row?.conceptId) || !Number.isFinite(row.score))) {
          throw new Error("Invalid image ranking result.");
        }
        scored.push(...ranked);
      }
      return scored;
    }
    ranking.indexPromise ||= Promise.resolve().then(() => loadJson(IMAGE_EMBEDDING_INDEX_URL))
      .then(readImageEmbeddingIndex).catch(error => { ranking.indexPromise = null; throw error; });
    const index = await ranking.indexPromise;
    const key = textCacheKey(query);
    if (!ranking.queries.has(key)) {
      const vector = ranking.embedQuery ? await ranking.embedQuery(query) : (await ranking.engine.embedBatch([query]))[0];
      rememberTextVector(ranking, key, checkedTextVector(vector));
    }
    return rankIndexedImages(rows, index, ranking.queries.get(key));
  }
  return async (query, { sourceKind = "", signal } = {}) => {
    // Reject target-language text before touching either the model or asset catalogs.
    query = normalizeSharedEnglishText(query);
    signal?.throwIfAborted();
    if (sourceKind && !IMAGE_SOURCES.some(source => source.kind === sourceKind)) throw new Error("Unknown image source kind.");
    const sources = IMAGE_SOURCES.filter((source) => !sourceKind || source.kind === sourceKind);
    const rows = (await Promise.all(sources.map(loadSource))).flat();
    signal?.throwIfAborted();
    if (!rows.length) return { rows: [], mode: "embedding" };
    let scored;
    let mode = "embedding";
    let reason;
    let timer;
    let expired = false;
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => { expired = true; reject(new Error("Image ranking timed out.")); }, timeoutMs);
    });
    try {
      // Keep one inference in flight across games/frames. A busy model queues
      // the next query instead of silently downgrading it to keyword matching.
      const request = ranking.tail.then(() => {
        if (expired) throw new Error("Image ranking timed out.");
        signal?.throwIfAborted();
        return rankImages(query, rows);
      });
      ranking.tail = request.catch(() => {});
      scored = await Promise.race([request, deadline]);
    } catch (error) {
      signal?.throwIfAborted();
      mode = "lexical";
      reason = error?.message || "Image embeddings unavailable.";
      const queryTokens = new Set(tokens(query));
      scored = rows.map((row) => ({ conceptId: row.conceptId,
        score: [...new Set(tokens(row.description))].filter((token) => queryTokens.has(token)).length }));
    } finally {
      clearTimeout(timer);
    }
    signal?.throwIfAborted();
    const byId = new Map(rows.map((row) => [row.conceptId, row]));
    return {
      mode, ...(reason ? { reason } : {}),
      rows: scored.filter((row) => mode !== "lexical" || row.score > 0)
        .sort((a, b) => b.score - a.score || a.conceptId.localeCompare(b.conceptId, "en"))
        .map((row) => ({ ...byId.get(row.conceptId), score: row.score }))
        .filter((row, index, all) => all.slice(0, index).filter((previous) => previous.sourceKind === row.sourceKind).length < 12)
    };
  };
}
