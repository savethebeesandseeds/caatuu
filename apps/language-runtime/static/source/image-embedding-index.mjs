import { ENGLISH_MINILM_RUNTIME, validateEnglishEmbeddingPayload } from "./english-minilm-ranker.mjs";

export const IMAGE_EMBEDDING_INDEX_PATH = "/language-runtime/static/data/image-embeddings/minilm-v1.json";
export const IMAGE_EMBEDDING_INDEX_URL = `${IMAGE_EMBEDDING_INDEX_PATH}?v=image-index-2`;
export const IMAGE_EMBEDDING_MODEL_ID = ENGLISH_MINILM_RUNTIME.modelId.replace(/\/runtime$/u, "");
export const IMAGE_INDEX_SCHEMA = "caatuu-shared-image-embeddings-v1";

const SOURCE_PREFIXES = Object.freeze({ image_asset: "/assets/miscellaneous/",
  macaw_action_asset: "/assets/macaw/actions/", robot_asset: "/assets/robots/", ship_asset: "/assets/ships/" });

export function imageVectorKey(row) { return JSON.stringify([row.sourceKind, row.path]); }

export function imageEmbeddingReference(row) {
  return { index: IMAGE_EMBEDDING_INDEX_PATH, model_id: IMAGE_EMBEDDING_MODEL_ID,
    source_kind: row.sourceKind, asset_path: row.path };
}

function validAssetPath(row) {
  const prefix = SOURCE_PREFIXES[row.sourceKind];
  if (!prefix || typeof row.path !== "string" || !row.path.startsWith(prefix)) return false;
  try {
    const decoded = decodeURIComponent(row.path);
    const filename = decoded.slice(prefix.length);
    return decoded.startsWith(prefix) && !/[\\/?#]/u.test(filename)
      && /\.(png|webp|jpe?g|avif)$/iu.test(filename);
  } catch { return false; }
}

export function readImageEmbeddingIndex(raw) {
  if (raw?.schema !== IMAGE_INDEX_SCHEMA || raw.inputLanguage !== "en"
      || raw.modelId !== ENGLISH_MINILM_RUNTIME.modelId
      || raw.modelFileName !== ENGLISH_MINILM_RUNTIME.modelFileName
      || raw.dimension !== ENGLISH_MINILM_RUNTIME.embeddingDimension
      || raw.encoding !== "float32le-base64" || !Array.isArray(raw.rows)) {
    throw new Error("Incompatible shared image embedding index.");
  }
  const rows = new Map();
  for (const row of raw.rows) {
    if (!row || !validAssetPath(row) || typeof row.embeddingText !== "string"
        || typeof row.vector !== "string") throw new Error("Invalid image index row.");
    const english = validateEnglishEmbeddingPayload({ inputLanguage: "en", query: { embeddingText: row.embeddingText },
      candidates: [{ conceptId: "shared-image-description", embeddingText: row.embeddingText }] }).query.embeddingText;
    if (english !== row.embeddingText) throw new Error("Image index descriptions must be normalized English.");
    if (row.sourceKind === "ship_asset" && (!Number.isFinite(row.orientation?.heading_degrees)
        || row.orientation.heading_degrees < 0 || row.orientation.heading_degrees >= 360)) {
      throw new Error("Invalid image index heading.");
    }
    const key = imageVectorKey(row);
    if (rows.has(key)) throw new Error("Duplicate image index row.");
    const decoded = atob(row.vector);
    if (decoded.length !== raw.dimension * 4) throw new Error("Invalid image vector size.");
    const bytes = Uint8Array.from(decoded, character => character.charCodeAt(0));
    const view = new DataView(bytes.buffer);
    const vector = new Float32Array(raw.dimension);
    let norm = 0;
    for (let index = 0; index < vector.length; index += 1) {
      vector[index] = view.getFloat32(index * 4, true);
      if (!Number.isFinite(vector[index])) throw new Error("Invalid image vector value.");
      norm += vector[index] ** 2;
    }
    if (Math.abs(norm - 1) > .002) throw new Error("Image vectors must be normalized.");
    rows.set(key, { embeddingText: row.embeddingText, vector,
      ...(row.category !== undefined ? { category: row.category } : {}),
      ...(row.action !== undefined ? { action: row.action } : {}),
      ...(row.orientation ? { orientation: { ...row.orientation } } : {}) });
  }
  return rows;
}

export function rankIndexedImages(rows, index, queryVector) {
  if (queryVector?.length !== ENGLISH_MINILM_RUNTIME.embeddingDimension
      || !Array.from(queryVector).every(Number.isFinite)) throw new Error("Invalid image query vector.");
  return rows.map(row => {
    const stored = index.get(imageVectorKey(row));
    // Never use an old vector for a changed description or a newly added image.
    if (!stored || stored.embeddingText !== row.embeddingText) throw new Error("Shared image index needs rebuilding.");
    let score = 0;
    for (let i = 0; i < queryVector.length; i += 1) score += queryVector[i] * stored.vector[i];
    return { conceptId: row.conceptId, score };
  });
}
