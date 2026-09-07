import { ENGLISH_MINILM_RUNTIME } from "./english-minilm-ranker.mjs";

export const IMAGE_EMBEDDING_INDEX_URL = "/language-runtime/static/data/image-embeddings/minilm-v1.json?v=image-index-1";
export const IMAGE_INDEX_SCHEMA = "caatuu-shared-image-embeddings-v1";

export function imageVectorKey(row) { return `${row.sourceKind}\u0000${row.path}`; }

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
    if (typeof row?.path !== "string" || typeof row.embeddingText !== "string"
        || !["image_asset", "macaw_action_asset"].includes(row.sourceKind)
        || typeof row.vector !== "string") throw new Error("Invalid image index row.");
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
    rows.set(key, { embeddingText: row.embeddingText, vector });
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
