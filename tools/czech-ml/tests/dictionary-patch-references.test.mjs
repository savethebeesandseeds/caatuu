import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

import {
  dictionaryPatchDigest,
  validateRevisionReferences
} from "../scripts/validate-dictionary-patch.mjs";

const courseRoot = new URL("../../../apps/languages/czech/static/", import.meta.url);
const patchPath = "data/dictionaries/patches/reviewed-cs-en.v1.json";
const [patch, runtime, setupCatalog, localWorker, sharedWorker] = await Promise.all([
  readFile(new URL(patchPath, courseRoot), "utf8").then(JSON.parse),
  readFile(new URL("source/shared/runtime.js", courseRoot), "utf8"),
  readFile(new URL("setup-assets.json", courseRoot), "utf8").then(JSON.parse),
  readFile(new URL("sw.js", courseRoot), "utf8"),
  readFile(new URL("../../../apps/language-runtime/static/source/course-service-worker.js", import.meta.url), "utf8")
]);
const versionedPath = `${patchPath}?v=${dictionaryPatchDigest(patch)}`;

test("the course worker caches the dictionary patch under its current content digest", async () => {
  assert.equal(patch.digest, dictionaryPatchDigest(patch));
  assert.deepEqual(validateRevisionReferences(patch, { runtime, setupCatalog }), []);
  const handlers = new Map();
  let cachedUrls;
  let installation;
  const context = vm.createContext({
    URL,
    self: {
      registration: { scope: "https://caatuu.test/cz/" },
      location: { origin: "https://caatuu.test" },
      addEventListener: (name, handler) => handlers.set(name, handler),
      skipWaiting: async () => {}
    },
    fetch: async (url) => {
      assert.equal(url, "https://caatuu.test/cz/setup-assets.json");
      return { ok: true, json: async () => setupCatalog };
    },
    caches: {
      open: async (name) => {
        assert.equal(name, setupCatalog.offline.cacheName);
        return { addAll: async (urls) => { cachedUrls = [...urls]; } };
      }
    }
  });
  context.importScripts = (url) => {
    assert.equal(url, "/language-runtime/static/source/course-service-worker.js");
    vm.runInContext(sharedWorker, context);
  };
  vm.runInContext(localWorker, context);
  handlers.get("install")({ waitUntil: (promise) => { installation = promise; } });
  await installation;
  assert.ok(cachedUrls.includes(`https://caatuu.test/cz/${versionedPath}`));
});

test("dictionary patch validation rejects missing or malformed offline catalogs", () => {
  for (const catalog of [null, {}, { offline: {} }, { offline: { assets: {} } }]) {
    assert.match(validateRevisionReferences(patch, { runtime, setupCatalog: catalog }).join("\n"), /offline\.assets must be an array/u);
  }
});

test("dictionary patch validation rejects missing, stale, unversioned and duplicate cache references", () => {
  for (const assets of [
    [],
    [`./${patchPath}`],
    [`./${patchPath}?v=sha256-${"0".repeat(64)}`],
    [`./${versionedPath}`, `./${versionedPath}`],
    [`./${versionedPath}`, `./${patchPath}?v=stale`]
  ]) {
    assert.match(validateRevisionReferences(patch, {
      runtime,
      setupCatalog: { offline: { assets } }
    }).join("\n"), /offline\.assets must reference .* exactly once/u);
  }
});

test("changed patch content requires fresh cache and runtime digest references", () => {
  const changed = { ...patch, revision: patch.revision + 1 };
  changed.digest = dictionaryPatchDigest(changed);
  const errors = validateRevisionReferences(changed, { runtime, setupCatalog });
  assert.equal(errors.length, 2);
  assert.match(errors.join("\n"), /runtime\.js must reference/u);
  assert.match(errors.join("\n"), /offline\.assets must reference/u);
});

test("a correct cache entry does not conceal a stale legacy runtime reference", () => {
  const errors = validateRevisionReferences(patch, {
    runtime: runtime.replace(patch.digest, `sha256-${"0".repeat(64)}`),
    setupCatalog
  });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /runtime\.js must reference/u);
});
