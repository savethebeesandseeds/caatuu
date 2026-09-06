import { createEnglishImageSearch } from "../../english-image-search.mjs?v=english-image-search-1";

const VISUAL_PREFIX = "/assets/miscellaneous/";
const CACHE_LIMIT = 32;
const sharedSearches = new WeakMap();

function sharedImageSearch(shell) {
  const owner = shell && typeof shell === "object" ? shell : globalThis;
  if (!sharedSearches.has(owner)) sharedSearches.set(owner, createEnglishImageSearch());
  return sharedSearches.get(owner);
}

function visualPath(value, origin) {
  if (typeof value !== "string" || !value.trim() || !origin) return "";
  try {
    const decoded = decodeURIComponent(value.trim());
    if (/[\\\u0000-\u001f\u007f]/u.test(decoded) || /(?:^|\/)\.{1,2}(?:\/|$)/u.test(decoded)) return "";
    const candidate = value.startsWith("assets/") ? `/${value}` : value;
    const url = new URL(candidate, origin);
    if (url.origin !== origin || url.username || url.password || url.search || url.hash) return "";
    const path = decodeURIComponent(url.pathname);
    if (!path.startsWith(VISUAL_PREFIX)) return "";
    // Curated vocabulary images are top-level assets; archives and URL escapes
    // must never become a background, even if a malformed search row names one.
    const filename = path.slice(VISUAL_PREFIX.length);
    if (!/^[a-zA-Z0-9][a-zA-Z0-9 _().-]*\.(?:png|webp|jpe?g)$/u.test(filename)) return "";
    return url.pathname;
  } catch {
    return "";
  }
}

function firstVisual(payload, origin) {
  const rows = Array.isArray(payload?.results) ? payload.results : Array.isArray(payload?.rows) ? payload.rows : [];
  for (const row of rows) {
    if (row?.sourceKind !== "image_asset") continue;
    const path = visualPath(row.documentMetadata?.asset_path || row.chunkMetadata?.asset_path || row.sourceId || row.path, origin);
    if (path) return path;
  }
  return "";
}

// Use the course vector service when present and the shared artwork provider
// otherwise. Both search only the independent English audit description.
export function createNounVisual({ shell, course, image, searchImages } = {}) {
  const cache = new Map();
  let active = true;
  let visible = true;
  let destroyed = false;
  let epoch = 0;
  let currentKey = "";
  let english = "";
  let pending = null;
  let removeImageListeners = () => {};
  const origin = shell?.location?.origin || image?.ownerDocument?.location?.origin || "";

  function clearImage() {
    removeImageListeners();
    removeImageListeners = () => {};
    if (!image) return;
    image.hidden = true;
    image.removeAttribute("src");
  }
  function invalidate() {
    epoch += 1;
    clearImage();
  }
  function enabled() {
    return !destroyed && active && visible && Boolean(image) && Boolean(english)
      && course?.capabilities?.embeddings === true && course?.capabilities?.semanticSearch === true;
  }
  function remember(query, path) {
    cache.delete(query);
    cache.set(query, path);
    if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
  }
  function present(path, token, query) {
    clearImage();
    if (!path || !enabled() || token !== epoch || query !== english) return;
    let expectedSource = path;
    const current = () => enabled() && token === epoch && query === english
      && (image.currentSrc || image.src) === expectedSource;
    const loaded = () => {
      if (current()) image.hidden = false;
    };
    const failed = () => {
      if (!current()) return;
      remember(query, "");
      clearImage();
    };
    image.addEventListener("load", loaded);
    image.addEventListener("error", failed);
    removeImageListeners = () => {
      image.removeEventListener("load", loaded);
      image.removeEventListener("error", failed);
    };
    image.src = path;
    expectedSource = image.src;
    if (image.complete && image.naturalWidth > 0) loaded();
  }
  function requestCurrent() {
    if (!enabled()) return;
    const token = epoch;
    const query = english;
    if (cache.has(query)) {
      const path = cache.get(query);
      remember(query, path);
      present(path, token, query);
      return;
    }
    const vector = shell?.CaatuuRuntime?.vector;
    if (pending) return;
    const request = { query, token };
    pending = request;
    // The API has no cancellation contract. Keep at most one request in flight
    // and continue with the newest noun when it settles; gameplay never waits.
    Promise.resolve()
      .then(() => {
        if (!enabled() || epoch !== token || english !== query) return null;
        return typeof vector?.search === "function"
          ? vector.search(query, { limit: 5, sourceKinds: ["image_asset"] })
          : (searchImages || sharedImageSearch(shell))(query, { sourceKind: "image_asset" });
      })
      .then((payload) => {
        if (destroyed || payload === null) return;
        const path = firstVisual(payload, origin);
        remember(query, path);
        if (token === epoch && query === english) present(path, token, query);
      })
      .catch(() => {
        if (destroyed) return;
        remember(query, "");
        if (token === epoch && query === english) clearImage();
      })
      .finally(() => {
        if (pending === request) pending = null;
        if (!destroyed && (epoch !== token || english !== query)) requestCurrent();
      });
  }

  if (image) {
    image.alt = "";
    image.setAttribute("aria-hidden", "true");
    image.draggable = false;
    image.decoding = "async";
  }
  clearImage();
  return Object.freeze({
    update(item) {
      if (destroyed) return;
      const query = typeof item?.english === "string" ? item.english.trim() : "";
      const key = JSON.stringify([item?.id || "", item?.revision || 0, query]);
      if (key === currentKey) return;
      currentKey = key;
      english = query;
      invalidate();
      requestCurrent();
    },
    setActive(value) {
      if (destroyed || active === Boolean(value)) return;
      active = Boolean(value);
      invalidate();
      requestCurrent();
    },
    setVisible(value) {
      if (destroyed || visible === Boolean(value)) return;
      visible = Boolean(value);
      invalidate();
      requestCurrent();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      invalidate();
      cache.clear();
      pending = null;
    }
  });
}
