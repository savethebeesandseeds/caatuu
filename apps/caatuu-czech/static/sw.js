const CACHE_NAME = "caatuu-czech-pwa-v182";
const CORE_ASSETS = [
  "./",
  "./home.html",
  "./home.css?v=home-21",
  "./index.html",
  "./theme.css?v=theme-2",
  "./app.css?v=shell-36",
  "./chrome.css?v=chrome-style-22",
  "./runtime.js?v=runtime-8",
  "./chrome.js?v=chrome-27",
  "./setup.js?v=setup-20",
  "./setup-assets.json",
  "./maintenance-ui.js?v=maintenance-3",
  "./app.js?v=shell-33",
  "./word-net.html",
  "./word-net.css?v=word-net-13",
  "./word-net.js?v=word-net-9",
  "./vector-db.js",
  "./vector-db.js?v=vector-db-4",
  "./chat.html",
  "./chat.css?v=chat-4",
  "./chat.js?v=chat-22",
  "./embedding-images.html",
  "./embedding-images.css?v=embedding-images-5",
  "./embedding-images.js?v=embedding-images-1",
  "./manifest.webmanifest",
  "./icons/caatuu-czech-192.png",
  "./icons/caatuu-czech-512.png",
  "./icons/caatuu-czech-1024.png",
  "/assets/icons/home_icon.png",
  "/assets/icons/games_icon.png",
  "/assets/icons/settings_icon.png",
  "./logos/dark_mode.png",
  "./logos/czech_flag.png",
  "./data/dictionary.json",
  "./data/scripts.json",
  "./data/verbs.json"
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

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || request.headers.has("range")) return;

  const url = new URL(request.url);
  if (url.origin === location.origin) {
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
  const cached = await caches.match(request);
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
    const cached = await caches.match(request);
    if (cached) return cached;
    throw error;
  }
}

async function cacheResponse(request, response) {
  if (!response || (response.status !== 200 && response.type !== "opaque")) return;
  const cache = await caches.open(CACHE_NAME);
  await cache.put(request, response.clone());
}
