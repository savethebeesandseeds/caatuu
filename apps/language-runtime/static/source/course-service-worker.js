"use strict";

// Contract revision 6: course notifications return to a safe page inside their owning course.

const CAATUU_CANONICAL_APP_ENTRY = "apps/language-runtime/static/app/index.html";
const CAATUU_SHARED_WORKER_URL = "/language-runtime/static/source/course-service-worker.js";
const CAATUU_LEGACY_MINI_APP_DOCUMENTS = new Set(["word-world.html", "word-net.html"]);
const CAATUU_RETIRED_RUNTIME_PATHS = new Set([
  "/language-runtime/static/source/product-shell.mjs",
  "/language-runtime/static/styles/course-shell.css"
]);
const CAATUU_RETIRED_COURSE_RUNTIME_SUFFIXES = new Set([
  "source/features/home/home.css",
  "source/games/verb-nebula/app.css",
  "source/games/verb-nebula/app.js",
  "source/games/word-world/word-net.css",
  "source/games/word-world/word-net-core.mjs",
  "source/games/word-world/word-net.js",
  "source/games/word-world/word-net-queue.mjs",
  "source/shared/chrome.css",
  "source/shared/chrome.js",
  "source/shared/learning-profile.js",
  "source/shared/theme.css"
]);

let courseOfflineConfigPromise;

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const config = await courseOfflineConfig();
    const cache = await caches.open(config.cacheName);
    await cache.addAll(config.precacheUrls);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const config = await courseOfflineConfig();
    const names = await caches.keys();
    await Promise.all(
      names
        .filter((name) => name.startsWith(config.cachePrefix) && name !== config.cacheName)
        .map((name) => caches.delete(name))
    );
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") void self.skipWaiting();
});

self.addEventListener("notificationclick", (event) => {
  event.notification?.close?.();
  event.waitUntil((async () => {
    const config = await courseOfflineConfig();
    let target = config.entryUrl;
    try {
      const requested = new URL(String(event.notification?.data?.url || ""), self.location.origin);
      if (
        requested.origin === self.location.origin
        && requested.pathname.startsWith(config.scope.pathname)
      ) target = requested;
    } catch (error) {
      // Invalid notification state falls back to the owning course entry.
    }
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const exact = windows.find((client) => client.url === target.href);
    if (exact?.focus) {
      await exact.focus();
      return;
    }
    const courseWindow = windows.find((client) => {
      try {
        const url = new URL(client.url);
        return url.origin === self.location.origin && url.pathname.startsWith(config.scope.pathname);
      } catch (error) {
        return false;
      }
    });
    if (courseWindow?.navigate) await courseWindow.navigate(target.href);
    if (courseWindow?.focus) {
      await courseWindow.focus();
      return;
    }
    await self.clients.openWindow?.(target.href);
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || request.headers.has("range")) return;

  event.respondWith((async () => {
    const config = await courseOfflineConfig();
    const url = new URL(request.url);

    if (url.origin !== self.location.origin) {
      if (isModelRuntimeRequest(url)) return networkThenCache(request, config);
      return fetch(request);
    }

    if (!isManagedUrl(url, config)) return fetch(request);
    if (isRetiredRuntimeUrl(url)) return fetch(request, { cache: "no-store" });
    if (isLegacyMiniAppUrl(url)) return legacyMiniAppResponse(request, config);
    if (request.cache === "no-store") return fetch(request);

    if (
      request.cache === "reload"
      || request.mode === "navigate"
      || ["document", "script", "style"].includes(request.destination)
    ) {
      return networkThenCache(request, config);
    }
    return cacheFirst(request, config);
  })());
});

function courseScopeUrl() {
  const scope = new URL(self.registration.scope);
  if (scope.origin !== self.location.origin || !scope.pathname.endsWith("/")) {
    throw new Error(`Invalid Caatuu course service-worker scope: ${scope.href}`);
  }
  return scope;
}

function setupCatalogUrl() {
  return new URL("setup-assets.json", courseScopeUrl());
}

async function readSetupCatalog() {
  const catalogUrl = setupCatalogUrl();
  try {
    const response = await fetch(catalogUrl.href, { cache: "no-store" });
    if (!response.ok) throw new Error(`Setup catalog returned HTTP ${response.status}.`);
    return response.json();
  } catch (networkError) {
    const cached = await caches.match(catalogUrl.href);
    if (!cached) throw networkError;
    return cached.json();
  }
}

function validateSetupCatalog(catalog) {
  const scope = courseScopeUrl();
  const application = catalog?.application;
  const offline = catalog?.offline;

  if (application?.appEntry !== CAATUU_CANONICAL_APP_ENTRY) {
    throw new Error(
      `setup-assets.json application.appEntry must be ${CAATUU_CANONICAL_APP_ENTRY}.`
    );
  }

  const entryUrl = new URL(String(application?.entryPath || ""), self.location.origin);
  const expectedEntryUrl = new URL("index.html", scope);
  if (
    entryUrl.origin !== self.location.origin
    || entryUrl.pathname !== expectedEntryUrl.pathname
    || entryUrl.search
    || entryUrl.hash
  ) {
    throw new Error(`setup-assets.json entryPath must resolve to ${expectedEntryUrl.pathname}.`);
  }

  const cacheName = String(offline?.cacheName || "");
  const cachePrefix = String(offline?.cachePrefix || "");
  if (!cachePrefix.startsWith("caatuu-") || !cachePrefix.endsWith("-pwa-")) {
    throw new Error("setup-assets.json offline.cachePrefix is invalid.");
  }
  if (!cacheName.startsWith(cachePrefix) || !/-v\d+$/u.test(cacheName)) {
    throw new Error("setup-assets.json offline.cacheName must be a versioned course cache.");
  }
  if (!Array.isArray(offline?.assets)) {
    throw new Error("setup-assets.json offline.assets must be an array.");
  }

  const setupUrl = setupCatalogUrl();
  const workerUrl = new URL(CAATUU_SHARED_WORKER_URL, self.location.origin);
  const localWorkerUrl = new URL("sw.js", scope);
  const precacheUrls = new Set([
    scope.href,
    entryUrl.href,
    setupUrl.href,
    localWorkerUrl.href,
    workerUrl.href
  ]);

  for (const asset of offline.assets) {
    const url = new URL(String(asset || ""), scope);
    if (url.origin !== self.location.origin || !isManagedUrl(url, { scope })) {
      throw new Error(`Offline asset is outside the Caatuu course boundary: ${url.href}`);
    }
    if (isLegacyMiniAppUrl(url)) {
      throw new Error(`Deprecated mini-app documents cannot be cached: ${url.pathname}`);
    }
    if (isRetiredRuntimeUrl(url)) {
      throw new Error(`Retired runtime assets cannot be cached: ${url.pathname}`);
    }
    precacheUrls.add(url.href);
  }

  return Object.freeze({
    cacheName,
    cachePrefix,
    scope,
    entryUrl,
    precacheUrls: Object.freeze([...precacheUrls])
  });
}

async function courseOfflineConfig() {
  courseOfflineConfigPromise ||= readSetupCatalog().then(validateSetupCatalog);
  return courseOfflineConfigPromise;
}

function isManagedUrl(url, config) {
  return url.origin === self.location.origin && (
    url.pathname.startsWith(config.scope.pathname)
    || url.pathname.startsWith("/language-runtime/")
    || url.pathname.startsWith("/assets/")
  );
}

function isLegacyMiniAppUrl(url) {
  const fileName = url.pathname.split("/").pop();
  return CAATUU_LEGACY_MINI_APP_DOCUMENTS.has(fileName);
}

function isRetiredRuntimeUrl(url) {
  if (url.origin !== self.location.origin) return false;
  if (CAATUU_RETIRED_RUNTIME_PATHS.has(url.pathname)) return true;
  return [...CAATUU_RETIRED_COURSE_RUNTIME_SUFFIXES]
    .some((suffix) => url.pathname.endsWith(`/${suffix}`));
}

function isModelRuntimeRequest(url) {
  return [
    "huggingface.co",
    "cdn.jsdelivr.net",
    "esm.run",
    "raw.githubusercontent.com",
    "github.com"
  ].some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
}

async function cacheFirst(request, config) {
  const cached = await currentCacheMatch(request, config);
  if (cached) return cached;
  const response = await fetch(request);
  await cacheResponse(request, response, config);
  return response;
}

async function networkThenCache(request, config) {
  try {
    const freshRequest = new Request(request, { cache: "reload" });
    const response = await fetch(freshRequest);
    await cacheResponse(request, response, config);
    return response;
  } catch (error) {
    let cached = await currentCacheMatch(request, config);
    if (cached) return cached;

    if (request.mode === "navigate") {
      const requestUrl = new URL(request.url);
      if (requestUrl.origin === self.location.origin && requestUrl.search) {
        requestUrl.search = "";
        cached = await currentCacheMatch(requestUrl.href, config);
        if (cached) return cached;
      }
      cached = await currentCacheMatch(config.entryUrl.href, config);
      if (cached) return cached;
    }
    throw error;
  }
}

async function legacyMiniAppResponse(request, config) {
  const target = new URL(config.entryUrl.href);
  target.searchParams.set("game", "word-net");
  return Response.redirect(target.href, 302);
}

async function currentCacheMatch(request, config) {
  const cache = await caches.open(config.cacheName);
  return cache.match(request);
}

async function cacheResponse(request, response, config) {
  const url = new URL(typeof request === "string" ? request : request.url);
  if (isLegacyMiniAppUrl(url) || isRetiredRuntimeUrl(url)) return;
  if (!response || (response.status !== 200 && response.type !== "opaque")) return;
  try {
    const cache = await caches.open(config.cacheName);
    await cache.put(request, response.clone());
  } catch {
    // The PWA cache is opportunistic. A full quota must not hide a valid network response.
  }
}
