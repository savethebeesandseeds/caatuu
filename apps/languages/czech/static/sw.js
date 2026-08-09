const CACHE_NAME = "caatuu-czech-pwa-v428";
const CORE_ASSETS = [
  "./",
  "./home.html",
  "./source/features/home/home.css?v=home-28",
  "./index.html",
  "./source/shared/theme.css?v=theme-5",
  "./source/games/verb-nebula/app.css?v=shell-76",
  "./source/shared/chrome.css?v=chrome-style-92",
  "./source/shared/course-profile.js?v=course-16",
  "./source/shared/learning-profile.js?v=learning-5",
  "./source/shared/runtime.js?v=runtime-37",
  "./source/shared/semantic-learning.js?v=semantic-learning-7",
  "./source/shared/semantic-learning-core.mjs?v=semantic-learning-core-5",
  "./source/shared/feedback-outbox.mjs?v=feedback-outbox-5",
  "./source/features/dictionary/dictionary-gap-report.mjs?v=dictionary-gap-report-1",
  "./source/features/dictionary/dictionary-patch-core.mjs?v=dictionary-patch-core-1",
  "./data/dictionaries/patches/reviewed-cs-en.v1.json?v=sha256-3d86c8c0ddddb0122023a1dd686aaa7c9be2c37bf6ae664c8a5bc72d384762d9",
  "./source/shared/chrome.js?v=chrome-96",
  "./source/features/setup/setup-progress.js?v=setup-progress-1",
  "./source/features/setup/setup.js?v=setup-35",
  "./setup-assets.json",
  "./source/shared/maintenance-ui.js?v=maintenance-16",
  "./source/games/verb-nebula/app.js?v=shell-92",
  "./source/games/verb-nebula/verb-nebula-core.mjs?v=verb-nebula-core-10",
  "./source/games/verb-nebula/verb-exercise-family-core.mjs?v=verb-exercise-family-core-2",
  "./source/features/dictionary/dictionary-full.js?v=full-dictionary-5",
  "./word-net.html",
  "./source/games/word-world/word-net.css?v=word-net-76",
  "./source/games/word-world/word-net.js?v=word-net-85",
  "./source/games/word-world/word-net-core.mjs?v=word-net-core-18",
  "./source/games/word-world/word-net-queue.mjs?v=word-net-queue-6",
  "./source/games/word-world/word-net-standard.mjs?v=word-net-standard-5",
  "./conjugation-comet.html",
  "./source/games/conjugation-comet/conjugation-comet.css?v=conjugation-comet-14",
  "./source/games/conjugation-comet/conjugation-comet.js?v=conjugation-comet-19",
  "./source/shared/vector-db.js?v=vector-db-9",
  "./vendor/transformers/transformers.min.js",
  "./chat.html",
  "./source/features/chat/chat.css?v=chat-8",
  "./source/features/chat/chat.js?v=chat-29",
  "./embedding-images.html",
  "./source/features/embedding-images/embedding-images.css?v=embedding-images-7",
  "./source/features/embedding-images/embedding-images.js?v=embedding-images-1",
  "./audio-lab.html",
  "./source/features/audio-lab/audio-lab.css?v=audio-lab-2",
  "./source/features/audio-lab/audio-lab.js?v=audio-lab-1",
  "./verb-difficulty.html",
  "./source/features/verb-difficulty/verb-difficulty.css?v=verb-difficulty-1",
  "./source/features/verb-difficulty/verb-difficulty.js?v=verb-difficulty-5",
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
  "/assets/robots/robot%20(1).png",
  "/assets/icons/dark_mode_ui.png",
  "/assets/icons/light_mode_ui.png",
  "/assets/icons/czech_flag_ui.png",
  "/assets/icons/difficulty_medal_1_ui.png?v=ui-1",
  "/assets/icons/difficulty_medal_2_ui.png?v=ui-1",
  "/assets/icons/difficulty_medal_3_ui.png?v=ui-1",
  "/assets/icons/paper_plane_submit_ui.png?v=paper-plane-1",
  "/assets/loading_animation/animations_manifest.json",
  "./data/games/verb-nebula/core-vocabulary.json",
  "./data/games/conjugation-comet/verbs.json?v=conjugation-comet-verbs-2",
  "./data/language/scripts.json",
  "./data/games/word-world/manifest.json",
  "./data/games/word-world/standard-v0.1/records.json?v=01b7901834527668"
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
