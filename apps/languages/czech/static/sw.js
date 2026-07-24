const CACHE_NAME = "caatuu-czech-pwa-v337";
const CORE_ASSETS = [
  "./",
  "./home.html",
  "./home.css?v=home-28",
  "./index.html",
  "./theme.css?v=theme-4",
  "./app.css?v=shell-63",
  "./chrome.css?v=chrome-style-71",
  "./course-profile.js?v=course-5",
  "./learning-profile.js?v=learning-2",
  "./runtime.js?v=runtime-30",
  "./semantic-learning.js?v=semantic-learning-6",
  "./semantic-learning-core.mjs?v=semantic-learning-core-5",
  "./feedback-outbox.mjs?v=feedback-outbox-5",
  "./chrome.js?v=chrome-72",
  "./setup-progress.js?v=setup-progress-1",
  "./setup.js?v=setup-33",
  "./setup-assets.json",
  "./maintenance-ui.js?v=maintenance-14",
  "./app.js?v=shell-69",
  "./verb-nebula-core.mjs?v=verb-nebula-core-7",
  "./dictionary-full.js?v=full-dictionary-4",
  "./word-net.html",
  "./word-net.css?v=word-net-48",
  "./word-net.js?v=word-net-50",
  "./word-net-core.mjs?v=word-net-core-11",
  "./word-net-queue.mjs?v=word-net-queue-6",
  "./word-net-standard.mjs?v=word-net-standard-1",
  "./vector-db.js?v=vector-db-9",
  "./vendor/transformers/transformers.min.js",
  "./chat.html",
  "./chat.css?v=chat-8",
  "./chat.js?v=chat-29",
  "./embedding-images.html",
  "./embedding-images.css?v=embedding-images-7",
  "./embedding-images.js?v=embedding-images-1",
  "./verb-difficulty.html",
  "./verb-difficulty.css?v=verb-difficulty-1",
  "./verb-difficulty.js?v=verb-difficulty-3",
  "./manifest.webmanifest",
  "./icons/caatuu-czech-192.png",
  "./icons/caatuu-czech-512.png",
  "./icons/caatuu-czech-1024.png",
  "/assets/icons/home_icon.png",
  "/assets/icons/games_icon.png",
  "/assets/icons/backpack_icon.png",
  "/assets/icons/coin_icon.png",
  "/assets/icons/icon_gem.png",
  "/assets/icons/items_icon.png?v=items-2",
  "/assets/icons/stats_icon.png",
  "/assets/icons/gear_icon.png",
  "/assets/robots/keymap.json",
  "/assets/robots/word-world-waiting.svg",
  "/assets/icons/dark_mode.png",
  "/assets/icons/czech_flag.png",
  "/assets/loading_animation/animations_manifest.json",
  "./data/dictionary.json",
  "./data/scripts.json",
  "./data/word-world/manifest.json",
  "./data/word-world/standard-v0.1/records.json?v=01b7901834527668"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith("caatuu-czech-pwa-") && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") void self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || request.headers.has("range")) return;

  const url = new URL(request.url);
  if (url.origin === location.origin) {
    if (request.cache === "no-store") {
      event.respondWith(fetch(request));
      return;
    }
    if (request.cache === "reload") {
      event.respondWith(networkThenCache(request));
      return;
    }
    if (request.mode === "navigate" || ["document", "script", "style"].includes(request.destination)) {
      event.respondWith(networkThenCache(request));
      return;
    }
    event.respondWith(cacheFirst(request));
    return;
  }

  if (isModelRuntimeRequest(url)) {
    event.respondWith(networkThenCache(request));
  }
});

function isModelRuntimeRequest(url) {
  return [
    "huggingface.co",
    "cdn.jsdelivr.net",
    "esm.run",
    "raw.githubusercontent.com",
    "github.com"
  ].some((host) => url.hostname.endsWith(host));
}

async function cacheFirst(request) {
  const cached = await currentCacheMatch(request);
  if (cached) return cached;
  const response = await fetch(request);
  await cacheResponse(request, response);
  return response;
}

async function networkThenCache(request) {
  try {
    const freshRequest = new Request(request, { cache: "reload" });
    const response = await fetch(freshRequest);
    await cacheResponse(request, response);
    return response;
  } catch (error) {
    const cached = await currentCacheMatch(request);
    if (cached) return cached;
    throw error;
  }
}

async function currentCacheMatch(request) {
  const cache = await caches.open(CACHE_NAME);
  return cache.match(request);
}

async function cacheResponse(request, response) {
  if (!response || (response.status !== 200 && response.type !== "opaque")) return;
  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, response.clone());
  } catch (error) {
    // The PWA cache is opportunistic. A full quota must not hide a valid network response.
  }
}
