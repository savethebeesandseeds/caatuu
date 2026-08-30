import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const repoRoot = new URL("../../../../", import.meta.url);

async function readText(relativePath) {
  return readFile(new URL(relativePath, repoRoot), "utf8");
}

const [catalog, manifest, routes, compose, gradle, androidClient, czechIndex, czechApp, launcher] =
  await Promise.all([
    readText("apps/games/catalog.json").then(JSON.parse),
    readText("apps/games/caatuu-game/game.json").then(JSON.parse),
    readText("apps/server/src/routes/mod.rs"),
    readText("compose.yaml"),
    readText("apps/android/app/build.gradle.kts"),
    readText("apps/android/app/src/main/java/com/caatuu/android/CaatuuAssetClient.kt"),
    readText("apps/language-runtime/static/app/index.html"),
    readText("apps/language-runtime/static/source/caatuu-workspace.js"),
    readText("apps/launcher/static/index.html"),
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

test("the runtime exposes only the feature-gated standalone route", () => {
  assert.match(routes, /id: "caatuu-game"/);
  assert.match(routes, /route_prefix: "\/caatuu-game\/godot-v1"/);
  assert.match(routes, /artifact_dir: "artifacts\/games\/caatuu-game\/web\/godot-v1"/);
  assert.match(routes, /if features\.caatuu_game_preview[\s\S]*?nest\("\/games", build_web_games/);
  assert.match(routes, /Redirect::temporary\("\/games\/caatuu-game\/godot-v1\/"\)/);
  assert.doesNotMatch(routes, /legacy_games_compatibility|memory-moon/);
});

test("root Compose owns export and public-preview gating without a second project", () => {
  assert.match(compose, /^name: caatuu$/m);
  assert.match(compose, /ENABLE_CAATUU_GAME_PREVIEW/);
  assert.match(compose, /caatuu-game-godot-export:/);
  assert.match(compose, /\.\/apps\/games\/caatuu-game:\/project:ro/);
  assert.match(compose, /\.\/artifacts\/games\/caatuu-game\/web\/godot-v1:\/output/);
  assert.match(compose, /--require-game caatuu-game/);
  assert.match(compose, /preview is disabled but its route returned HTTP/);
  assert.doesNotMatch(compose, /memory-moon/);
});

test("the Caatuu app and Android package contain no standalone game integration", () => {
  const appSources = `${czechIndex}\n${czechApp}`;
  assert.doesNotMatch(appSources, /\/games\/caatuu-game|memoryMoonGame/);
  assert.match(czechIndex, /A smaller orbit for recall games will live here\./);
  assert.doesNotMatch(gradle, /artifacts\/games|generatedGameAssetsDir|syncGameAssets/);
  assert.doesNotMatch(androidClient, /path\.startsWith\("\/games\/"\)/);
});

test("the launcher keeps the standalone preview behind a subtle disclosure", () => {
  assert.match(
    launcher,
    /<details class="advanced-entry">[\s\S]*?<summary>More<\/summary>[\s\S]*?href="\/games\/caatuu-game\/"/,
  );
});
