import { createEnglishImageSearch } from "../../english-image-search.mjs?v=english-image-search-3";

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

// Every course uses the same artwork index and independent English description.
export function createNounVisual({ shell, course, image, searchImages, scope = globalThis, onLoadingChange = () => {} } = {}) {
  const cache = new Map();
  let active = true;
  let visible = true;
  let destroyed = false;
  let epoch = 0;
  let currentKey = "";
  let english = "";
  let pending = null;
  let loading = false;
  let deadline = null;
  let abandonedToken = -1;
  let removeImageListeners = () => {};
  const origin = shell?.location?.origin || image?.ownerDocument?.location?.origin || "";

  function setLoading(value) {
    if (loading === value) return;
    loading = value;
    if (deadline !== null) scope.clearTimeout(deadline);
    deadline = null;
    if (value) {
      deadline = scope.setTimeout(() => {
        // A failed search or image must not block play forever or appear late.
        remember(english, "");
        abandonedToken = epoch;
        epoch += 1;
        clearImage();
        setLoading(false);
      }, 15000);
      deadline?.unref?.();
    }
    onLoadingChange(value);
  }

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
    setLoading(false);
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
    if (!enabled() || token !== epoch || query !== english) return;
    if (!path) { setLoading(false); return; }
    let expectedSource = path;
    const current = () => enabled() && token === epoch && query === english
      && (image.currentSrc || image.src) === expectedSource;
    const loaded = async () => {
      try { if (typeof image.decode === "function") await image.decode(); }
      catch { failed(); return; }
      if (current()) { image.hidden = false; setLoading(false); }
    };
    const failed = () => {
      if (!current()) return;
      remember(query, "");
      clearImage();
      setLoading(false);
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
    setLoading(true);
    const token = epoch;
    const query = english;
    if (cache.has(query)) {
      const path = cache.get(query);
      remember(query, path);
      present(path, token, query);
      return;
    }
    if (pending) return;
    const request = { query, token };
    pending = request;
    // The API has no cancellation contract. Keep at most one request in flight
    // and continue with the newest noun when it settles. The loading deadline
    // bounds the readiness barrier without creating overlapping model work.
    Promise.resolve()
      .then(() => {
        if (!enabled() || epoch !== token || english !== query) return null;
        return (searchImages || sharedImageSearch(shell))(query, { sourceKind: "image_asset" });
      })
      .then((payload) => {
        if (destroyed || payload === null || token === abandonedToken) return;
        const path = firstVisual(payload, origin);
        remember(query, path);
        if (token === epoch && query === english) present(path, token, query);
      })
      .catch(() => {
        if (destroyed) return;
        remember(query, "");
        if (token === epoch && query === english) { clearImage(); setLoading(false); }
      })
      .finally(() => {
        if (pending === request) pending = null;
        if (!destroyed && loading && (epoch !== token || english !== query)) requestCurrent();
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
    get loading() { return loading; },
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
