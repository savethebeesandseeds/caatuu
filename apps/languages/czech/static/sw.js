const CACHE_NAME = "caatuu-czech-pwa-v527";
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./source/features/home/home.css?v=home-29",
  "./source/shared/theme.css?v=theme-5",
  "./source/games/verb-nebula/app.css?v=shell-82",
  "./source/games/case-cosmos/launcher.css?v=case-cosmos-launcher-1",
  "./source/games/agreement-aurora/launcher.css?v=agreement-aurora-launcher-1",
  "./source/features/campaign/campaign.css?v=campaign-2",
  "./source/shared/chrome.css?v=chrome-style-120",
  "./source/shared/course-profile.js?v=course-17",
  "./source/shared/learning-profile.js?v=learning-5",
  "./source/shared/runtime.js?v=runtime-39",
  "./source/shared/semantic-learning.js?v=semantic-learning-7",
  "./source/shared/semantic-learning-core.mjs?v=semantic-learning-core-5",
  "./source/shared/child-facing-assets.mjs?v=child-facing-assets-1",
  "./source/shared/feedback-outbox.mjs?v=feedback-outbox-5",
  "./source/features/dictionary/dictionary-gap-report.mjs?v=dictionary-gap-report-1",
  "./source/features/dictionary/dictionary-patch-core.mjs?v=dictionary-patch-core-1",
  "./data/dictionaries/patches/reviewed-cs-en.v1.json?v=sha256-3d86c8c0ddddb0122023a1dd686aaa7c9be2c37bf6ae664c8a5bc72d384762d9",
  "./source/shared/chrome.js?v=chrome-109",
  "./source/features/setup/setup-progress.js?v=setup-progress-1",
  "./source/features/setup/setup.js?v=setup-36",
  "./setup-assets.json",
  "./source/shared/maintenance-ui.js?v=maintenance-16",
  "./source/games/verb-nebula/app.js?v=shell-103",
  "./source/games/verb-nebula/verb-nebula-core.mjs?v=verb-nebula-core-10",
  "./source/games/verb-nebula/verb-exercise-family-core.mjs?v=verb-exercise-family-core-2",
  "./source/features/dictionary/dictionary-full.js?v=full-dictionary-5",
  "./word-net.html",
  "./source/games/word-world/word-net.css?v=word-net-79",
  "./source/games/word-world/word-net.js?v=word-net-89",
  "./source/games/word-world/word-net-core.mjs?v=word-net-core-18",
  "./source/games/word-world/word-net-queue.mjs?v=word-net-queue-6",
  "./source/games/word-world/word-net-standard.mjs?v=word-net-standard-5",
  "./conjugation-comet.html",
  "./source/games/conjugation-comet/conjugation-comet.css?v=conjugation-comet-46",
  "./source/games/conjugation-comet/conjugation-comet.js?v=conjugation-comet-59",
  "./case-cosmos.html",
  "./source/games/case-cosmos/case-cosmos.css?v=case-cosmos-1",
  "./source/games/case-cosmos/case-cosmos.js?v=case-cosmos-6",
  "./agreement-aurora.html",
  "./source/games/agreement-aurora/agreement-aurora.css?v=agreement-aurora-1",
  "./source/games/agreement-aurora/agreement-aurora.js?v=agreement-aurora-3",
  "./source/shared/vector-db.js?v=vector-db-10",
  "./vendor/transformers/transformers.min.js",
  "./chat.html",
  "./source/features/chat/chat.css?v=chat-8",
  "./source/features/chat/chat.js?v=chat-29",
  "./embedding-images.html",
  "./source/features/embedding-images/embedding-images.css?v=embedding-images-8",
  "./source/features/embedding-images/embedding-images.js?v=embedding-images-2",
  "./audio-lab.html",
  "./source/features/audio-lab/audio-lab.css?v=audio-lab-2",
  "./source/features/audio-lab/audio-lab.js?v=audio-lab-1",
  "./verb-difficulty.html",
  "./source/features/verb-difficulty/verb-difficulty.css?v=verb-difficulty-2",
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
  "/assets/planets/verb-nebula.png",
  "/assets/planets/conjugation-comet.png",
  "/assets/planets/word-world.png",
  "/assets/planets/case-cosmos.png",
  "/assets/planets/memory-moon.png",
  "/assets/planets/agreement-aurora.png?v=agreement-aurora-art-2",
  "/assets/planets/campaign-mode.png",
  "/assets/robots/keymap.json",
  "/assets/robots/robot%20(1).png",
  "/assets/macaw/actions/keymaps.json",
  "/assets/macaw/actions/macaw%20(1).png",
  "/assets/macaw/pronouns/v1.png",
  "/assets/macaw/pronouns/v2-formal-gala.png",
  "/assets/macaw/pronouns/v3-costume-party.png",
  "/assets/macaw/pronouns/v4-retro-vacation.png",
  "/assets/macaw/pronouns/v5-chaotic-chefs.png",
  "/assets/macaw/pronouns/v6-rainy-day.png",
  "/assets/macaw/pronouns/v7-homemade-heroes.png",
  "/assets/macaw/pronouns/v8-disco-fever.png",
  "/assets/macaw/pronouns/v9-pajama-party.png",
  "/assets/macaw/pronouns/v10-garden-club.png",
  "/assets/macaw/pronouns/v11-steampunk-finale.png",
  "/assets/macaw/pronouns/v12-chaotic-orchestra.png",
  "/assets/macaw/pronouns/v13-circus-troupe.png",
  "/assets/macaw/pronouns/v14-winter-festival.png",
  "/assets/icons/dark_mode_ui.png",
  "/assets/icons/light_mode_ui.png",
  "/assets/icons/czech_flag_ui.png",
  "/assets/icons/difficulty_medal_1_ui.png?v=ui-1",
  "/assets/icons/difficulty_medal_2_ui.png?v=ui-1",
  "/assets/icons/difficulty_medal_3_ui.png?v=ui-1",
  "/assets/icons/paper_plane_submit_ui.png?v=paper-plane-1",
  "/assets/loading_animation/animations_manifest.json",
  "./data/games/verb-nebula/core-vocabulary.json",
  "./data/games/conjugation-comet/verbs.json?v=conjugation-comet-verbs-4",
  "./data/games/case-cosmos/challenges.json?v=case-cosmos-data-5",
  "./data/games/agreement-aurora/challenges.json?v=agreement-aurora-data-3",
  "./data/language/scripts.json",
  "./data/games/word-world/manifest.json",
  "./data/games/word-world/standard-v0.1/records.json?v=657e502666ae7aee"
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
