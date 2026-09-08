import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const serviceWorkerSource = await readFile(
  new URL("../../../language-runtime/static/source/course-service-worker.js", import.meta.url),
  "utf8"
);
const [czechLoader, mandarinLoader, czechSetup, mandarinSetup] = await Promise.all([
  readFile(new URL("../../../languages/czech/static/sw.js", import.meta.url), "utf8"),
  readFile(new URL("../../../languages/mandarin-simplified/static/sw.js", import.meta.url), "utf8"),
  readFile(new URL("../../../languages/czech/static/setup-assets.json", import.meta.url), "utf8").then(JSON.parse),
  readFile(new URL("../../../languages/mandarin-simplified/static/setup-assets.json", import.meta.url), "utf8").then(JSON.parse)
]);
const czechWordWorldCompatibility = await readFile(
  new URL("../../../languages/czech/static/word-net.html", import.meta.url),
  "utf8"
);

class FakeRequest {
  constructor(input, options = {}) {
    const source = typeof input === "string" ? {} : input;
    this.url = typeof input === "string" ? input : source.url;
    this.method = options.method ?? source.method ?? "GET";
    this.mode = options.mode ?? source.mode ?? "cors";
    this.cache = options.cache ?? source.cache ?? "default";
    this.destination = options.destination ?? source.destination ?? "";
    this.headers = options.headers ?? source.headers ?? { has() { return false; } };
  }
}

function serviceWorkerContext({
  scope = "https://caatuu.test/zh/",
  cachedResponses = new Map(),
  fetchImplementation = async () => { throw new Error("offline"); }
} = {}) {
  const lookups = [];
  const puts = [];
  const handlers = new Map();
  const cache = {
    async addAll() {},
    async match(request) {
      const key = typeof request === "string" ? request : request.url;
      lookups.push(key);
      return cachedResponses.get(key);
    },
    async put(request) {
      puts.push(typeof request === "string" ? request : request.url);
    }
  };
  const context = vm.createContext({
    URL,
    Request: FakeRequest,
    Response,
    Headers,
    fetch: fetchImplementation,
    caches: {
      async match(request) {
        const key = typeof request === "string" ? request : request.url;
        lookups.push(key);
        return cachedResponses.get(key);
      },
      async open() {
        return cache;
      },
      async keys() {
        return [];
      },
      async delete() {
        return true;
      }
    },
    self: {
      location: { origin: "https://caatuu.test" },
      registration: { scope },
      addEventListener(type, handler) { handlers.set(type, handler); },
      async skipWaiting() {},
      clients: { async claim() {} }
    }
  });
  vm.runInContext(serviceWorkerSource, context, { filename: "course-service-worker.js" });
  return { context, lookups, puts, handlers };
}

function validatedConfig(context, overrides = {}) {
  context.__testCatalog = {
    application: overrides.application || {
      entryPath: "/zh/index.html",
      appEntry: "apps/language-runtime/static/app/index.html"
    },
    offline: {
      cacheName: "caatuu-zh-hans-pwa-v17",
      cachePrefix: "caatuu-zh-hans-pwa-",
      assets: ["manifest.webmanifest"],
      ...overrides.offline
    }
  };
  return vm.runInContext("validateSetupCatalog(__testCatalog)", context);
}

async function call(context, expression, bindings) {
  Object.assign(context, bindings);
  return vm.runInContext(expression, context);
}

async function fetchThroughWorker(worker, request, config) {
  await call(worker.context, "courseOfflineConfigPromise = Promise.resolve(__config)", {
    __config: config
  });
  let response;
  worker.handlers.get("fetch")({
    request,
    respondWith(value) { response = value; }
  });
  assert.ok(response, "the worker must handle the managed request");
  return response;
}

test("verified setup music plays offline with full, bounded, open and suffix byte requests", async () => {
  const url = "https://caatuu.test/assets/music/audio/fixture.mp3";
  for (const [range, status, body, contentRange] of [
    [null, 200, "0123456789", null],
    ["bytes=2-5", 206, "2345", "bytes 2-5/10"],
    ["bytes=7-", 206, "789", "bytes 7-9/10"],
    ["bytes=-3", 206, "789", "bytes 7-9/10"],
    ["bytes=0-999", 206, "0123456789", "bytes 0-9/10"],
    ["bytes=10-", 416, "", "bytes */10"],
    ["bytes=5-2", 416, "", "bytes */10"],
    ["bytes=-0", 416, "", "bytes */10"],
    ["bytes=0-1,4-5", 200, "0123456789", null],
  ]) {
    const worker = serviceWorkerContext({ cachedResponses: new Map([[url, new Response("0123456789", {
      headers: { "content-type": "audio/mpeg", "content-length": "10", "x-caatuu-setup-sha256": "a".repeat(64) }
    })]]) });
    const config = validatedConfig(worker.context);
    const headers = new Headers(range ? { range } : {});
    const response = await fetchThroughWorker(worker, new FakeRequest(url, { headers }), config);
    assert.equal(response.status, status, range);
    assert.equal(response.headers.get("content-type"), "audio/mpeg");
    assert.equal(response.headers.get("content-range"), contentRange, range);
    assert.equal(await response.text(), body, range);
  }
});

test("music bypasses course precaches and never trusts an unverified cache entry", async () => {
  const url = "https://caatuu.test/assets/music/audio/fixture.mp3";
  let networkRequests = 0;
  const worker = serviceWorkerContext({ cachedResponses: new Map([[url, new Response("unverified")]]),
    fetchImplementation: async () => { networkRequests += 1; return new Response("network"); } });
  const config = validatedConfig(worker.context);
  const response = await fetchThroughWorker(worker, new FakeRequest(url, { headers: new Headers() }), config);
  assert.equal(await response.text(), "network");
  assert.equal(networkRequests, 1);
  assert.deepEqual(worker.puts, []);
});

test("shared bootstrap bypasses HTTP caches when updating the course worker", async () => {
  const bootstrap = await readFile(
    new URL("../../../language-runtime/static/source/app-bootstrap.mjs", import.meta.url),
    "utf8"
  );
  assert.match(
    bootstrap,
    /navigator\.serviceWorker\.register\(courseUrl\("sw\.js"\), \{\s*scope: routeBase,\s*updateViaCache: "none"\s*\}\)/u
  );
});

test("streak notification clicks stay inside their owning course", () => {
  assert.match(serviceWorkerSource, /addEventListener\("notificationclick"/u);
  assert.match(serviceWorkerSource, /requested\.pathname\.startsWith\(config\.scope\.pathname\)/u);
  assert.match(serviceWorkerSource, /self\.clients\.matchAll\(\{ type: "window", includeUncontrolled: true \}\)/u);
  assert.match(serviceWorkerSource, /self\.clients\.openWindow\?\.\(target\.href\)/u);
});

test("setup application entry resolves the course URL to the canonical shared document", () => {
  const { context } = serviceWorkerContext();
  const config = validatedConfig(context);

  assert.equal(config.entryUrl.href, "https://caatuu.test/zh/index.html");
  assert.ok(config.precacheUrls.includes("https://caatuu.test/zh/index.html"));
  assert.ok(config.precacheUrls.includes(
    "https://caatuu.test/language-runtime/static/source/course-service-worker.js"
  ));
});

test("the selected interface catalog keeps its exact query revision through precache and offline lookup", async () => {
  const catalogUrl = "https://caatuu.test/language-runtime/static/data/interface/en.v1.json?v=interface-en-1";
  const cachedResponse = { source: "revisioned-interface-catalog" };
  const { context, lookups } = serviceWorkerContext({
    cachedResponses: new Map([[catalogUrl, cachedResponse]])
  });
  const config = validatedConfig(context, {
    offline: {
      assets: ["/language-runtime/static/data/interface/en.v1.json?v=interface-en-1"]
    }
  });

  assert.ok(config.precacheUrls.includes(catalogUrl));
  assert.ok(!config.precacheUrls.includes(
    "https://caatuu.test/language-runtime/static/data/interface/en.v1.json"
  ));

  const response = await call(context, "cacheFirst(__request, __config)", {
    __request: new FakeRequest(catalogUrl),
    __config: config
  });

  assert.equal(response, cachedResponse);
  assert.deepEqual(lookups, [catalogUrl]);
});

test("no-cache interface requests refresh stale course-cache content through the fetch handler", async () => {
  const catalogUrl = "https://caatuu.test/language-runtime/static/data/interface/en.v1.json?v=interface-en-25";
  const staleResponse = { source: "stale-interface-without-submit" };
  const freshResponse = new Response(JSON.stringify({ "conjugationcomet.submit": "Submit" }));
  const requests = [];
  const worker = serviceWorkerContext({
    cachedResponses: new Map([[catalogUrl, staleResponse]]),
    fetchImplementation: async (request) => {
      requests.push(request);
      return freshResponse;
    }
  });
  const response = await fetchThroughWorker(
    worker,
    new FakeRequest(catalogUrl, { cache: "no-cache" }),
    validatedConfig(worker.context)
  );

  assert.equal(response, freshResponse);
  assert.equal((await response.json())["conjugationcomet.submit"], "Submit");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, catalogUrl);
  assert.equal(requests[0].cache, "reload");
  assert.deepEqual(worker.lookups, []);
  assert.deepEqual(worker.puts, [catalogUrl]);
});

test("no-cache interface requests retain their exact revision when falling back offline", async () => {
  const catalogUrl = "https://caatuu.test/language-runtime/static/data/interface/en.v1.json?v=interface-en-25";
  const cachedResponse = { source: "cached-interface-revision-25" };
  const requests = [];
  const worker = serviceWorkerContext({
    cachedResponses: new Map([[catalogUrl, cachedResponse]]),
    fetchImplementation: async (request) => {
      requests.push(request);
      throw new Error("offline");
    }
  });
  const response = await fetchThroughWorker(
    worker,
    new FakeRequest(catalogUrl, { cache: "no-cache" }),
    validatedConfig(worker.context)
  );

  assert.equal(response, cachedResponse);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, catalogUrl);
  assert.deepEqual(worker.lookups, [catalogUrl]);
  assert.deepEqual(worker.puts, []);
});

test("no-store requests still bypass course-cache reads and writes", async () => {
  const catalogUrl = "https://caatuu.test/language-runtime/static/data/interface/en.v1.json?v=interface-en-25";
  const request = new FakeRequest(catalogUrl, { cache: "no-store" });
  const freshResponse = new Response("fresh interface");
  const requests = [];
  const worker = serviceWorkerContext({
    cachedResponses: new Map([[catalogUrl, { source: "stale-interface" }]]),
    fetchImplementation: async (incoming) => {
      requests.push(incoming);
      return freshResponse;
    }
  });
  const response = await fetchThroughWorker(worker, request, validatedConfig(worker.context));

  assert.equal(response, freshResponse);
  assert.deepEqual(requests, [request]);
  assert.deepEqual(worker.lookups, []);
  assert.deepEqual(worker.puts, []);
});

test("a course cannot redirect setup back to a course-owned application document", () => {
  const { context } = serviceWorkerContext();
  assert.throws(
    () => validatedConfig(context, {
      application: {
        entryPath: "/zh/index.html",
        appEntry: "apps/languages/mandarin-simplified/static/index.html"
      }
    }),
    /application\.appEntry must be apps\/language-runtime\/static\/app\/index\.html/
  );
});

test("reload requests use the network first and fall back to the current course cache", async () => {
  const manifestUrl = "https://caatuu.test/zh/data/games/word-world/manifest.json";
  const networkRequests = [];
  const networkResponse = {
    status: 200,
    type: "basic",
    clone() { return this; }
  };
  const online = serviceWorkerContext({
    fetchImplementation: async (request) => {
      networkRequests.push(request);
      return networkResponse;
    }
  });
  const onlineConfig = validatedConfig(online.context);

  const fresh = await call(online.context, "networkThenCache(__request, __config)", {
    __request: new FakeRequest(manifestUrl),
    __config: onlineConfig
  });

  assert.equal(fresh, networkResponse);
  assert.equal(networkRequests.length, 1);
  assert.equal(networkRequests[0].url, manifestUrl);
  assert.equal(networkRequests[0].cache, "reload");
  assert.deepEqual(online.puts, [manifestUrl]);

  const cachedResponse = { source: "current-course-cache" };
  const offline = serviceWorkerContext({
    cachedResponses: new Map([[manifestUrl, cachedResponse]])
  });
  const offlineConfig = validatedConfig(offline.context);
  const fallback = await call(offline.context, "networkThenCache(__request, __config)", {
    __request: new FakeRequest(manifestUrl),
    __config: offlineConfig
  });

  assert.equal(fallback, cachedResponse);
  assert.deepEqual(offline.lookups, [manifestUrl]);
});

test("offline query navigation falls back to the precached canonical course entry", async () => {
  const entryUrl = "https://caatuu.test/zh/index.html";
  const queryUrl = `${entryUrl}?codex=stale-link`;
  const entryResponse = { source: "canonical-entry" };
  const { context, lookups } = serviceWorkerContext({
    cachedResponses: new Map([[entryUrl, entryResponse]])
  });
  const config = validatedConfig(context);

  const response = await call(context, "networkThenCache(__request, __config)", {
    __request: new FakeRequest(queryUrl, { mode: "navigate" }),
    __config: config
  });

  assert.equal(response, entryResponse);
  assert.deepEqual(lookups, [queryUrl, entryUrl]);
});

test("offline game navigation may use its own precached query-free document", async () => {
  const baseUrl = "https://caatuu.test/zh/case-cosmos.html";
  const queryUrl = `${baseUrl}?codex=stale-link`;
  const baseResponse = { source: "game-document" };
  const { context, lookups } = serviceWorkerContext({
    cachedResponses: new Map([[baseUrl, baseResponse]])
  });
  const config = validatedConfig(context);

  const response = await call(context, "networkThenCache(__request, __config)", {
    __request: new FakeRequest(queryUrl, { mode: "navigate" }),
    __config: config
  });

  assert.equal(response, baseResponse);
  assert.deepEqual(lookups, [queryUrl, baseUrl]);
});

test("deprecated Mandarin mini-app HTML is never cached and redirects to shared Word World", async () => {
  const legacyUrl = "https://caatuu.test/zh/word-world.html?stale=1";
  const { context, lookups, puts } = serviceWorkerContext({
    cachedResponses: new Map()
  });
  const config = validatedConfig(context);

  const response = await call(context, "legacyMiniAppResponse(__request, __config)", {
    __request: new FakeRequest(legacyUrl, { mode: "navigate" }),
    __config: config
  });
  await call(context, "cacheResponse(__request, __response, __config)", {
    __request: new FakeRequest(legacyUrl),
    __response: { status: 200, type: "basic", clone() { return this; } },
    __config: config
  });

  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "https://caatuu.test/zh/index.html?game=word-net");
  assert.deepEqual(lookups, []);
  assert.deepEqual(puts, []);
  assert.throws(
    () => validatedConfig(context, { offline: { assets: ["word-world.html"] } }),
    /Deprecated mini-app documents cannot be cached/
  );
});

test("the retired Czech Word World document is never cached and redirects to shared Word World", async () => {
  const legacyUrl = "https://caatuu.test/cz/word-net.html?legacy=1";
  const { context, lookups, puts } = serviceWorkerContext({
    scope: "https://caatuu.test/cz/",
    cachedResponses: new Map()
  });
  const config = validatedConfig(context, {
    application: {
      entryPath: "/cz/index.html",
      appEntry: "apps/language-runtime/static/app/index.html"
    },
    offline: {
      cacheName: "caatuu-czech-pwa-v537",
      cachePrefix: "caatuu-czech-pwa-"
    }
  });

  const response = await call(context, "legacyMiniAppResponse(__request, __config)", {
    __request: new FakeRequest(legacyUrl, { mode: "navigate" }),
    __config: config
  });
  await call(context, "cacheResponse(__request, __response, __config)", {
    __request: new FakeRequest(legacyUrl),
    __response: { status: 200, type: "basic", clone() { return this; } },
    __config: config
  });

  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "https://caatuu.test/cz/index.html?game=word-net");
  assert.deepEqual(lookups, []);
  assert.deepEqual(puts, []);
  assert.throws(
    () => validatedConfig(context, {
      application: {
        entryPath: "/cz/index.html",
        appEntry: "apps/language-runtime/static/app/index.html"
      },
      offline: {
        cacheName: "caatuu-czech-pwa-v537",
        cachePrefix: "caatuu-czech-pwa-",
        assets: ["word-net.html"]
      }
    }),
    /Deprecated mini-app documents cannot be cached/
  );
});

test("retired parallel runtimes are rejected from precache and never enter runtime cache", async () => {
  const retiredUrls = [
    "/cz/source/features/home/home.css",
    "/cz/source/games/verb-nebula/app.css",
    "/cz/source/games/verb-nebula/app.js",
    "/cz/source/games/word-world/word-net.css",
    "/cz/source/games/word-world/word-net-core.mjs",
    "/cz/source/games/word-world/word-net.js",
    "/cz/source/games/word-world/word-net-queue.mjs",
    "/cz/source/shared/chrome.css",
    "/cz/source/shared/chrome.js",
    "/cz/source/shared/learning-profile.js",
    "/cz/source/shared/theme.css",
    "/language-runtime/static/source/product-shell.mjs",
    "/language-runtime/static/styles/course-shell.css"
  ];
  const { context, puts } = serviceWorkerContext({ scope: "https://caatuu.test/cz/" });
  const config = validatedConfig(context, {
    application: {
      entryPath: "/cz/index.html",
      appEntry: "apps/language-runtime/static/app/index.html"
    },
    offline: {
      cacheName: "caatuu-czech-pwa-v542",
      cachePrefix: "caatuu-czech-pwa-"
    }
  });

  for (const retiredUrl of retiredUrls) {
    assert.throws(
      () => validatedConfig(context, {
        application: {
          entryPath: "/cz/index.html",
          appEntry: "apps/language-runtime/static/app/index.html"
        },
        offline: {
          cacheName: "caatuu-czech-pwa-v542",
          cachePrefix: "caatuu-czech-pwa-",
          assets: [retiredUrl]
        }
      }),
      /Retired runtime assets cannot be cached/
    );
    await call(context, "cacheResponse(__request, __response, __config)", {
      __request: new FakeRequest(`https://caatuu.test${retiredUrl}`),
      __response: { status: 200, type: "basic", clone() { return this; } },
      __config: config
    });
  }

  assert.deepEqual(puts, []);
  assert.match(serviceWorkerSource, /isRetiredRuntimeUrl\(url\)\) return fetch\(request, \{ cache: "no-store" \}\)/u);
});

test("offline script requests preserve version query keys", async () => {
  const scriptUrl = "https://caatuu.test/zh/source/language/adapter.mjs?v=reviewed";
  const { context, lookups } = serviceWorkerContext();
  const config = validatedConfig(context);

  await assert.rejects(
    call(context, "networkThenCache(__request, __config)", {
      __request: new FakeRequest(scriptUrl, { destination: "script" }),
      __config: config
    }),
    /offline/
  );
  assert.deepEqual(lookups, [scriptUrl]);
});
