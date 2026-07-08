const CACHE_NAME = "caatuu-czech-pwa-v134";
const CORE_ASSETS = [
  "./",
  "./home.html",
  "./home.css?v=home-8",
  "./index.html",
  "./theme.css?v=theme-2",
  "./app.css?v=shell-36",
  "./chrome.css?v=chrome-style-7",
  "./runtime.js?v=runtime-2",
  "./chrome.js?v=chrome-14",
  "./setup.js?v=setup-9",
  "./setup-assets.json",
  "./maintenance-ui.js?v=maintenance-1",
  "./app.js?v=shell-27",
  "./word-net.html",
  "./word-net.css?v=word-net-7",
  "./word-net.js?v=word-net-6",
  "./chat.html",
  "./chat.css?v=chat-3",
  "./chat.js?v=chat-16",
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
