import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const serviceWorkerSource = await readFile(
  new URL("../../../languages/czech/static/sw.js", import.meta.url),
  "utf8"
);

class FakeRequest {
  constructor(input, options = {}) {
    const source = typeof input === "string" ? {} : input;
    this.url = typeof input === "string" ? input : source.url;
    this.mode = options.mode ?? source.mode ?? "cors";
    this.cache = options.cache ?? source.cache ?? "default";
  }
}

function offlineServiceWorker(cachedResponses = new Map()) {
  const lookups = [];
  const cache = {
    async match(request) {
      const key = typeof request === "string" ? request : request.url;
      lookups.push(key);
      return cachedResponses.get(key);
    },
    async put() {}
  };
  const context = vm.createContext({
    URL,
    Request: FakeRequest,
    location: { origin: "https://caatuu.test" },
    fetch: async () => {
      throw new Error("offline");
    },
    caches: {
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
      addEventListener() {},
      async skipWaiting() {},
      clients: { async claim() {} }
    }
  });
  vm.runInContext(serviceWorkerSource, context, { filename: "sw.js" });
  return { context, lookups };
}

async function runNetworkThenCache(context, request) {
  context.__testRequest = request;
  return vm.runInContext("networkThenCache(__testRequest)", context);
}

test("offline query navigation falls back to the precached base document", async () => {
  const baseUrl = "https://caatuu.test/apps/languages/czech/static/index.html";
  const queryUrl = `${baseUrl}?curriculum-guided=1&verb-family=morphology`;
  const baseResponse = { source: "precache" };
  const { context, lookups } = offlineServiceWorker(new Map([[baseUrl, baseResponse]]));

  const response = await runNetworkThenCache(
    context,
    new FakeRequest(queryUrl, { mode: "navigate" })
  );

  assert.equal(response, baseResponse);
  assert.deepEqual(lookups, [queryUrl, baseUrl]);
});

test("offline Conjugation Comet developer navigation falls back to its own document", async () => {
  const baseUrl = "https://caatuu.test/apps/languages/czech/static/conjugation-comet.html";
  const queryUrl = `${baseUrl}?curriculum-guided=1`;
  const baseResponse = { source: "conjugation-comet-precache" };
  const { context, lookups } = offlineServiceWorker(new Map([[baseUrl, baseResponse]]));

  const response = await runNetworkThenCache(
    context,
    new FakeRequest(queryUrl, { mode: "navigate" })
  );

  assert.equal(response, baseResponse);
  assert.deepEqual(lookups, [queryUrl, baseUrl]);
});

test("offline script requests preserve version query keys", async () => {
  const scriptUrl = "https://caatuu.test/apps/languages/czech/static/app.js?v=shell-83";
  const { context, lookups } = offlineServiceWorker();

  await assert.rejects(
    runNetworkThenCache(context, new FakeRequest(scriptUrl, { mode: "cors" })),
    /offline/
  );
  assert.deepEqual(lookups, [scriptUrl]);
});

test("offline Conjugation Comet controller requests preserve their version key", async () => {
  const scriptUrl = "https://caatuu.test/apps/languages/czech/static/conjugation-comet.js?v=conjugation-comet-7";
  const { context, lookups } = offlineServiceWorker();

  await assert.rejects(
    runNetworkThenCache(context, new FakeRequest(scriptUrl, { mode: "cors" })),
    /offline/
  );
  assert.deepEqual(lookups, [scriptUrl]);
});
