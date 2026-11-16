import assert from "node:assert/strict";
import vm from "node:vm";
import test from "node:test";
import { serviceWorkerSource } from "../build-static-site.mjs";

test("neutral shared worker caches replace legacy deliveries without deleting other course or music caches", async () => {
  const events = new Map(), deleted = [];
  const current = "caatuu-web-static-ab12";
  const retained = ["caatuu-es-pwa-v7", "caatuu-music-v1", current, "unrelated-cache"];
  const replaced = ["caatuu-czech-web-static-old", "caatuu-czech-pwa-v1", "caatuu-web-static-old"];
  let claimed = false, completion;
  vm.runInNewContext(serviceWorkerSource([], "ab12"), {
    self: {
      addEventListener: (name, handler) => events.set(name, handler),
      clients: { claim: async () => { claimed = true; } },
    },
    caches: {
      keys: async () => [...retained, ...replaced],
      delete: async key => { deleted.push(key); return true; },
    },
  });
  events.get("activate")({ waitUntil: promise => { completion = promise; } });
  await completion;
  assert.deepEqual(deleted.sort(), replaced.sort());
  assert.equal(claimed, true);
});
