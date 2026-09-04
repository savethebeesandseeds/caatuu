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
      addEventListener() {},
      async skipWaiting() {},
      clients: { async claim() {} }
    }
  });
  vm.runInContext(serviceWorkerSource, context, { filename: "course-service-worker.js" });
  return { context, lookups, puts };
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
