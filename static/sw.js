// Caatuu Service Worker
// - HTML:          network-first (fallback to cached index)
// - JS/CSS/worker: network-first (so app code updates; fallback to cache)
// - Other assets:  cache-first

const VERSION = "caatuu-sw-v15"; // bump to force upgrade

// Scope-aware base path ("" or "/caatuu/static")
const BASE  = new URL(self.registration.scope).pathname.replace(/\/$/, "");
const INDEX = BASE + "/index.html";

// Precache (no "/" to avoid redirect weirdness)
const SHELL = [
  INDEX,
  BASE + "/app.css",
  BASE + "/js/audio.js",
  BASE + "/js/main.js",
  BASE + "/js/mock.js",
  BASE + "/js/resizers.js",
  BASE + "/js/socket.js",
  BASE + "/js/state.js",
  BASE + "/js/ui.js",
  BASE + "/js/utils.js",
  BASE + "/js/zh.js",
  BASE + "/manifest.webmanifest",
  BASE + "/assets/icon-192.png",
  BASE + "/assets/icon-512.png",
  BASE + "/assets/icon-1024.png"
];

// --- INSTALL: best-effort precache ---
self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    await Promise.all(SHELL.map(async (url) => {
      try {
        const req = new Request(url, { cache: "reload" });
        const res = await fetch(req);
        if (res.ok) await cache.put(req, res.clone());
        else console.warn("[SW] precache skip (non-OK)", url, res.status);
      } catch (e) {
        console.warn("[SW] precache skip (fetch failed)", url, e);
      }
    }));
    await self.skipWaiting();
  })());
});

// --- ACTIVATE: clean old caches + take control ---
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

// --- FETCH ROUTING ---
self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Only handle same-origin GET
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  const isNav = req.mode === "navigate" || (req.headers.get("accept") || "").includes("text/html");
  const dest  = req.destination; // 'script', 'style', 'worker', 'image', etc.

  // HTML navigations: network-first
  if (isNav) {
    event.respondWith((async () => {
      const cache = await caches.open(VERSION);
      try {
        const fresh = await fetch(req, { cache: "no-store" });
        cache.put(req, fresh.clone());
        return fresh;
      } catch {
        return (await cache.match(req)) || (await cache.match(INDEX));
      }
    })());
    return;
  }

  // App code (JS/CSS/worker): network-first (critical for updates)
  if (dest === "script" || dest === "style" || dest === "worker") {
    event.respondWith((async () => {
      const cache = await caches.open(VERSION);
      try {
        const fresh = await fetch(req, { cache: "no-store" });
        cache.put(req, fresh.clone());
        return fresh;
      } catch {
        const hit = await cache.match(req);
        return hit || new Response("", { status: 503, statusText: "Offline" });
      }
    })());
    return;
  }

  // Everything else: cache-first
  event.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const hit = await cache.match(req);
    if (hit) return hit;
    const res = await fetch(req);
    try { cache.put(req, res.clone()); } catch {}
    return res;
  })());
});
