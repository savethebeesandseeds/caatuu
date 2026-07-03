const CACHE_NAME = "caatuu-czech-pwa-v51";
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./app.css?v=shell-13",
  "./app.js?v=shell-8",
  "./device-ai.html",
  "./device-ai.css?v=shell-16",
  "./device-ai.js?v=shell-13",
  "./manifest.webmanifest",
  "./icons/caatuu-czech-192.png",
  "./icons/caatuu-czech-512.png",
  "./icons/caatuu-czech-1024.png",
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
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || request.headers.has("range")) return;

  const url = new URL(request.url);
  if (url.origin === location.origin) {
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
    const response = await fetch(request);
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
