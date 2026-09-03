import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const repoRoot = new URL("../../../../", import.meta.url);

async function readText(relativePath) {
  return readFile(new URL(relativePath, repoRoot), "utf8");
}

const [catalog, manifest, compose] =
  await Promise.all([
    readText("apps/games/catalog.json").then(JSON.parse),
    readText("apps/games/caatuu-game/game.json").then(JSON.parse),
    readText("compose.yaml")
  ]);

test("the catalog defines one standalone browser-only Caatuu Game", () => {
  assert.deepEqual(catalog.games, [{ id: "caatuu-game", manifest: "caatuu-game/game.json" }]);
  assert.equal(manifest.id, "caatuu-game");
  assert.equal(manifest.schema_version, 2);
  assert.equal(manifest.browser_mode, "standalone");
  assert.deepEqual(manifest.platforms, { browser: true, android: false });
  assert.deepEqual(manifest.delivery.compatibility_entrypoints, []);
  assert.equal(Object.hasOwn(manifest, "host_contract"), false);
});

test("root Compose owns export and public-preview gating without a second project", () => {
  assert.match(compose, /^name: caatuu$/m);
  assert.match(compose, /ENABLE_CAATUU_GAME_PREVIEW/);
  assert.match(compose, /caatuu-game-godot-export:/);
  assert.match(compose, /\.\/apps\/games\/caatuu-game:\/project:ro/);
  assert.match(compose, /\.\/artifacts\/games\/caatuu-game\/web\/godot-v1:\/output/);
  assert.doesNotMatch(compose, /memory-moon/);
});
