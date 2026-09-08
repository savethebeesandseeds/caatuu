import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { createHash, webcrypto } from "node:crypto";

const staticRoot = new URL("../../../../apps/languages/czech/static/", import.meta.url);
const [profileSource, source] = await Promise.all([
  readFile(new URL("source/shared/course-profile.js", staticRoot), "utf8"),
  readFile(new URL("source/shared/runtime.js", staticRoot), "utf8")
]);

function runtimeWith({ manifest, match = async () => null, fetchArtifact, sharedCaches = null, crypto = undefined } = {}) {
  let cacheWrites = 0;
  const cache = {
    match,
    async put() {
      cacheWrites += 1;
    }
  };
  const caches = {
    async open(name) {
      if (sharedCaches) {
        if (!sharedCaches.has(name)) sharedCaches.set(name, new Map());
        const entries = sharedCaches.get(name);
        return {
          async match(url) { return entries.get(url)?.clone(); },
          async put(url, response) { cacheWrites += 1; entries.set(url, response.clone()); }
        };
      }
      return cache;
    },
    async keys() {
      return [];
    },
    async delete() {
      return true;
    }
  };
  const window = {
    location: { hostname: "127.0.0.1", href: "http://127.0.0.1:8765/cz/" },
    caches,
    WebAssembly,
    addEventListener() {},
    CustomEvent: class { constructor(type) { this.type = type; } },
    dispatchEvent(event) { events.push(event.type); },
    setTimeout() {
      return 0;
    }
  };
  const events = [];
  const context = {
    AbortController,
    DOMException,
    Response,
    URL,
    WebAssembly,
    caches,
    crypto,
    document: {
      visibilityState: "visible",
      addEventListener() {}
    },
    navigator: {},
    window,
    fetch: async (path) => {
      if (path === "setup-assets.json") {
        return new Response(JSON.stringify(manifest), {
          headers: { "content-type": "application/json" }
        });
      }
      if (fetchArtifact) return fetchArtifact(path);
      throw new Error(`Unexpected fetch: ${path}`);
    }
  };

  runInNewContext(profileSource, context, { filename: "course-profile.js" });
  runInNewContext(source, context, { filename: "runtime.js" });
  return {
    runtime: window.CaatuuRuntime,
    events,
    cacheWrites: () => cacheWrites
  };
}

test("an empty required setup manifest is never ready", async () => {
  const { runtime } = runtimeWith({
    manifest: { cache_name: "test-cache", artifacts: [] }
  });

  const status = await runtime.setup.status();
  assert.equal(status.artifactCount, 0);
  assert.equal(status.readyArtifacts, 0);
  assert.equal(status.ready, false);
});

test("music downloads are verified once and reused across course setup caches", async () => {
  const audio = new Uint8Array([1, 4, 9, 16]);
  const sha256 = createHash("sha256").update(audio).digest("hex");
  const artifact = { key: "music", label: "Music", artifact_kind: "music", browser_required: true,
    url: "/assets/music/audio/fixture.mp3", bytes: audio.length, sha256 };
  const sharedCaches = new Map();
  let downloads = 0;
  const first = runtimeWith({ manifest: { cache_name: "course-one", artifacts: [artifact] }, sharedCaches,
    crypto: webcrypto, fetchArtifact: async () => { downloads += 1; return new Response(audio); } });
  assert.equal((await first.runtime.setup.start()).ready, true);
  assert.equal(downloads, 1);
  assert.equal(sharedCaches.get("caatuu-music-v1").size, 1);
  assert.equal(sharedCaches.has("course-one"), false);
  assert.deepEqual(first.events, ["caatuu:music-assets-ready"]);
  const second = runtimeWith({ manifest: { cache_name: "course-two", artifacts: [artifact] }, sharedCaches,
    crypto: webcrypto, fetchArtifact: async () => { throw new Error("offline"); } });
  assert.equal((await second.runtime.setup.status()).ready, true);
  assert.equal((await second.runtime.setup.start()).ready, true);
  assert.equal(second.cacheWrites(), 0);
  assert.equal(sharedCaches.has("course-two"), false);
  sharedCaches.get("caatuu-music-v1").set(artifact.url, new Response(new Uint8Array([2, 4, 9, 16])));
  assert.equal((await second.runtime.setup.status()).ready, false, "Corrupt cached music must require repair");
});

test("a newly active browser worker announces an update without reloading an in-progress page", () => {
  const workerEvents = new Map();
  const states = [];
  let reloads = 0;
  const binding = source.slice(source.indexOf("  function bindBrowserFreshnessEvents()"), source.indexOf("  function browserServiceWorkerRegistration()"));
  runInNewContext(`${binding}\nbindBrowserFreshnessEvents();`, {
    capabilities: { serviceWorker: true }, serviceWorkerFreshnessBound: false,
    navigator: { serviceWorker: { controller: null, addEventListener(type, handler) { workerEvents.set(type, handler); } } },
    document: { visibilityState: "visible", addEventListener() {} },
    window: { addEventListener() {}, setTimeout(callback) { callback(); }, location: { reload() { reloads += 1; } } },
    announceBrowserFreshness(state) { states.push(state); }
  });
  workerEvents.get("controllerchange")();
  assert.deepEqual(states, ["current"]);
  workerEvents.get("controllerchange")();
  assert.deepEqual(states, ["current", "update-ready"]);
  assert.equal(reloads, 0);
});

test("cached SHA metadata is not trusted when Web Crypto is unavailable", async () => {
  const sha256 = "a".repeat(64);
  const { runtime } = runtimeWith({
    manifest: {
      cache_name: "test-cache",
      artifacts: [{
        key: "fixture",
        label: "Fixture",
        artifact_kind: "test",
        browser_required: true,
        url: "fixture.bin",
        bytes: 3,
        sha256
      }]
    },
    match: async () => new Response(new Uint8Array([1, 2, 3]), {
      headers: {
        "content-length": "3",
        "x-caatuu-setup-sha256": sha256
      }
    })
  });

  const status = await runtime.setup.status();
  assert.equal(status.readyArtifacts, 0);
  assert.equal(status.ready, false);
});

test("a SHA-required download fails closed before entering the setup cache", async () => {
  const { runtime, cacheWrites } = runtimeWith({
    manifest: {
      cache_name: "test-cache",
      artifacts: [{
        key: "fixture",
        label: "Fixture",
        artifact_kind: "test",
        browser_required: true,
        url: "fixture.bin",
        bytes: 3,
        sha256: "a".repeat(64)
      }]
    },
    fetchArtifact: async () => new Response(new Uint8Array([1, 2, 3]), {
      headers: { "content-length": "3" }
    })
  });

  await assert.rejects(
    runtime.setup.start(),
    /requires SHA-256 verification, but this browser cannot provide it/
  );
  assert.equal(cacheWrites(), 0);
});

test("a SHA-pinned setup download bypasses stale service-worker asset URLs", async () => {
  const sha256 = "b".repeat(64);
  let requestedUrl = "";
  const { runtime } = runtimeWith({
    manifest: {
      cache_name: "test-cache",
      artifacts: [{
        key: "fixture",
        label: "Fixture",
        artifact_kind: "test",
        browser_required: true,
        url: "/cz/fixture.bin",
        bytes: 3,
        sha256
      }]
    },
    fetchArtifact: async (path) => {
      requestedUrl = String(path);
      return new Response(new Uint8Array([1, 2, 3]), {
        headers: { "content-length": "3" }
      });
    }
  });

  await assert.rejects(
    runtime.setup.start(),
    /requires SHA-256 verification, but this browser cannot provide it/
  );
  assert.equal(
    requestedUrl,
    `http://127.0.0.1:8765/cz/fixture.bin?caatuu_setup_sha256=${sha256}`
  );
});
