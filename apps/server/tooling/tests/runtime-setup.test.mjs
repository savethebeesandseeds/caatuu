import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import test from "node:test";

const staticRoot = new URL("../../../../apps/languages/czech/static/", import.meta.url);
const [profileSource, source] = await Promise.all([
  readFile(new URL("course-profile.js", staticRoot), "utf8"),
  readFile(new URL("runtime.js", staticRoot), "utf8")
]);

function runtimeWith({ manifest, match = async () => null, fetchArtifact } = {}) {
  let cacheWrites = 0;
  const cache = {
    match,
    async put() {
      cacheWrites += 1;
    }
  };
  const caches = {
    async open() {
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
    location: { hostname: "127.0.0.1" },
    caches,
    WebAssembly,
    addEventListener() {},
    setTimeout() {
      return 0;
    }
  };
  const context = {
    AbortController,
    DOMException,
    Response,
    URL,
    WebAssembly,
    caches,
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
