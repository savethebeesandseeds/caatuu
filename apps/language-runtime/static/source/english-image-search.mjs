import { createEnglishMiniLmRanker, validateEnglishEmbeddingPayload } from "./english-minilm-ranker.mjs";
import { isChildFacingMacawActionAssetAllowed } from "./child-facing-assets.mjs";

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

function tokens(value) { return String(value).toLowerCase().match(/[a-z0-9]+/gu) || []; }

export function createEnglishImageSearch({
  loadJson = async (path) => {
    const response = await fetch(path, { cache: "force-cache" });
    if (!response.ok) throw new Error(`Image catalog unavailable (${response.status}).`);
    return response.json();
  },
  ranker = createEnglishMiniLmRanker()
} = {}) {
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
  return async (query, { sourceKind = "", signal } = {}) => {
    // Reject target-language text before touching either the model or asset catalogs.
    validateEnglishEmbeddingPayload({ inputLanguage: "en", query: { embeddingText: query },
      candidates: [{ conceptId: "image-validation", embeddingText: "image" }] });
    signal?.throwIfAborted();
    const sources = IMAGE_SOURCES.filter((source) => !sourceKind || source.kind === sourceKind);
    const rows = (await Promise.all(sources.map(loadSource))).flat();
    signal?.throwIfAborted();
    if (!rows.length) return { rows: [], mode: "embedding" };
    let scored;
    let mode = "embedding";
    try {
      scored = [];
      // Keep first-use WASM memory bounded for the complete global artwork catalog.
      for (let offset = 0; offset < rows.length; offset += 32) {
        signal?.throwIfAborted();
        const candidates = rows.slice(offset, offset + 32).map(({ conceptId, embeddingText }) => ({ conceptId, embeddingText }));
        const ranked = await ranker({ inputLanguage: "en", query: { embeddingText: query }, candidates });
        const ids = new Set(candidates.map(({ conceptId }) => conceptId));
        if (!Array.isArray(ranked) || ranked.length !== candidates.length
            || new Set(ranked.map((row) => row?.conceptId)).size !== ids.size
            || ranked.some((row) => !ids.has(row?.conceptId) || !Number.isFinite(row.score))) {
          throw new Error("Invalid image ranking result.");
        }
        scored.push(...ranked);
      }
    } catch (error) {
      signal?.throwIfAborted();
      mode = "lexical";
      const queryTokens = new Set(tokens(query));
      scored = rows.map((row) => ({ conceptId: row.conceptId,
        score: [...new Set(tokens(row.description))].filter((token) => queryTokens.has(token)).length }));
    }
    signal?.throwIfAborted();
    const byId = new Map(rows.map((row) => [row.conceptId, row]));
    return {
      mode,
      rows: scored.filter((row) => mode !== "lexical" || row.score > 0)
        .sort((a, b) => b.score - a.score || a.conceptId.localeCompare(b.conceptId, "en"))
        .map((row) => ({ ...byId.get(row.conceptId), score: row.score }))
        .filter((row, index, all) => all.slice(0, index).filter((previous) => previous.sourceKind === row.sourceKind).length < 12)
    };
  };
}
