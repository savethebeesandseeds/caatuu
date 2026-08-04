const CACHE_NAME = "caatuu-czech-pwa-v415";
const CORE_ASSETS = [
  "./",
  "./home.html",
  "./home.css?v=home-28",
  "./index.html",
  "./theme.css?v=theme-5",
  "./app.css?v=shell-76",
  "./chrome.css?v=chrome-style-92",
  "./course-profile.js?v=course-16",
  "./learning-profile.js?v=learning-5",
  "./runtime.js?v=runtime-37",
  "./semantic-learning.js?v=semantic-learning-7",
  "./semantic-learning-core.mjs?v=semantic-learning-core-5",
  "./feedback-outbox.mjs?v=feedback-outbox-5",
  "./dictionary-gap-report.mjs?v=dictionary-gap-report-1",
  "./dictionary-patch-core.mjs?v=dictionary-patch-core-1",
  "./data/dictionaries/patches/reviewed-cs-en.v1.json?v=sha256-3d86c8c0ddddb0122023a1dd686aaa7c9be2c37bf6ae664c8a5bc72d384762d9",
  "./chrome.js?v=chrome-96",
  "./setup-progress.js?v=setup-progress-1",
  "./setup.js?v=setup-35",
  "./setup-assets.json",
  "./maintenance-ui.js?v=maintenance-16",
  "./app.js?v=shell-91",
  "./verb-nebula-core.mjs?v=verb-nebula-core-10",
  "./verb-exercise-family-core.mjs?v=verb-exercise-family-core-2",
  "./dictionary-full.js?v=full-dictionary-5",
  "./word-net.html",
  "./word-net.css?v=word-net-76",
  "./word-net.js?v=word-net-84",
  "./word-net-core.mjs?v=word-net-core-18",
  "./word-net-queue.mjs?v=word-net-queue-6",
  "./word-net-standard.mjs?v=word-net-standard-4",
  "./conjugation-comet.html",
  "./conjugation-comet.css?v=conjugation-comet-6",
  "./conjugation-comet.js?v=conjugation-comet-11",
  "./vector-db.js?v=vector-db-9",
  "./vendor/transformers/transformers.min.js",
  "./chat.html",
  "./chat.css?v=chat-8",
  "./chat.js?v=chat-29",
  "./embedding-images.html",
  "./embedding-images.css?v=embedding-images-7",
  "./embedding-images.js?v=embedding-images-1",
  "./audio-lab.html",
  "./audio-lab.css?v=audio-lab-2",
  "./audio-lab.js?v=audio-lab-1",
  "./verb-difficulty.html",
  "./verb-difficulty.css?v=verb-difficulty-1",
  "./verb-difficulty.js?v=verb-difficulty-4",
  "./manifest.webmanifest",
  "./icons/caatuu-czech-192.png",
  "./icons/caatuu-czech-512.png",
  "./icons/caatuu-czech-1024.png",
  "/assets/icons/home_icon.png",
  "/assets/icons/games_icon.png",
  "/assets/icons/backpack_icon.png",
  "/assets/icons/coin_icon_ui.png",
  "/assets/icons/icon_gem.png",
  "/assets/icons/items_icon.png?v=items-2",
  "/assets/icons/stats_icon.png",
  "/assets/icons/gear_icon.png",
  "/assets/planets/nebula.png",
  "/assets/planets/conjugation-comet.png",
  "/assets/planets/planet_A.png",
  "/assets/planets/planet_C.png",
  "/assets/robots/keymap.json",
  "/assets/robots/word-world-waiting.svg",
  "/assets/icons/dark_mode_ui.png",
  "/assets/icons/light_mode_ui.png",
  "/assets/icons/czech_flag_ui.png",
  "/assets/icons/difficulty_medal_1_ui.png?v=ui-1",
  "/assets/icons/difficulty_medal_2_ui.png?v=ui-1",
  "/assets/icons/difficulty_medal_3_ui.png?v=ui-1",
  "/assets/icons/paper_plane_submit_ui.png?v=paper-plane-1",
  "/assets/loading_animation/animations_manifest.json",
  "./data/dictionary.json",
  "./data/verbs.json",
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
    let cached = await currentCacheMatch(request);
    if (cached) return cached;
    if (request.mode === "navigate") {
      const fallbackUrl = new URL(request.url);
      if (fallbackUrl.origin === location.origin && fallbackUrl.search) {
        fallbackUrl.search = "";
        cached = await currentCacheMatch(fallbackUrl.href);
        if (cached) return cached;
      }
    }
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
