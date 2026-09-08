import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { expectedStaticSetupManifest, serviceWorkerSource } from "../build-static-site.mjs";

test("static website setup retains exact source song and attribution receipts without embedding them in precache", () => {
  const source = JSON.parse(readFileSync(new URL("../../../languages/czech/static/setup-assets.json", import.meta.url), "utf8"));
  const music = source.artifacts.filter(({ asset_path }) => asset_path?.startsWith("assets/music/"));
  assert.ok(music.some(({ artifact_kind }) => artifact_kind === "music"));
  assert.ok(music.some(({ artifact_kind }) => artifact_kind === "music-license"));
  const projected = expectedStaticSetupManifest().artifacts.filter(({ asset_path }) => asset_path?.startsWith("assets/music/"));
  assert.deepEqual(projected, music.map(artifact => ({ ...artifact, native_required: false })),
    "The website downloader must require the identical files and hashes");
});

test("the root website worker serves shared verified music credits offline and never duplicates music into its cache", async () => {
  const opened = [];
  let puts = 0;
  let verified = true;
  const url = "https://caatuu.test/assets/music/MUSIC_CREDITS.txt";
  const context = vm.createContext({ URL, Response, Request,
    location: { origin: "https://caatuu.test" },
    self: { addEventListener() {} },
    fetch: async () => { throw new Error("offline"); },
    caches: { async open(name) {
      opened.push(name);
      return {
        async match(request) {
          assert.equal(typeof request === "string" ? request : request.url, url);
          return new Response("Music credits", { headers: verified ? { "x-caatuu-setup-sha256": "a".repeat(64) } : {} });
        },
        async put() { puts += 1; }
      };
    } }
  });
  vm.runInContext(serviceWorkerSource(["/index.html"], "fixture"), context);
  context.request = new Request(url);
  const response = await vm.runInContext("cacheFirst(request)", context);
  assert.equal(await response.text(), "Music credits");
  assert.deepEqual(opened, ["caatuu-music-v1"]);
  context.response = new Response("Music credits");
  await vm.runInContext("cacheResponse(request, response)", context);
  assert.equal(puts, 0);
  verified = false;
  await assert.rejects(vm.runInContext("cacheFirst(request)", context), /offline/u,
    "Unverified cache data cannot make music available");
});
