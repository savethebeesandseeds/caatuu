import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const repoRoot = new URL("../../../../", import.meta.url);

async function readText(relativePath) {
  return readFile(new URL(relativePath, repoRoot), "utf8");
}

async function readJson(relativePath) {
  return JSON.parse(await readText(relativePath));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const catalog = await readJson("apps/games/catalog.json");
const catalogEntry = catalog.games.find((entry) => entry.id === "memory-moon");
assert.ok(catalogEntry, "the catalog must select Memory Moon for delivery validation");

const manifest = await readJson(`apps/games/${catalogEntry.manifest}`);
const adapterRelativePath = `apps/languages/czech/static/data/game-adapters/${manifest.id}.v1.json`;
const adapter = await readJson(adapterRelativePath);
const routes = await readText("apps/server/src/routes/mod.rs");
const compose = await readText("compose.yaml");
const gradle = await readText("apps/android/app/build.gradle.kts");
const androidClient = await readText(
  "apps/android/app/src/main/java/com/caatuu/android/CaatuuAssetClient.kt",
);
const czechIndex = await readText("apps/languages/czech/static/index.html");
const czechApp = await readText("apps/languages/czech/static/app.js");
const czechChrome = await readText("apps/languages/czech/static/chrome.js");
const publicDebugPublisher = await readText("apps/android/tooling/publish-public-debug.sh");
const runtimeAudit = await readText("apps/server/tooling/audit-runtime-boundary.mjs");

const { artifact_directory: artifactDirectory, public_entrypoint: publicEntrypoint } =
  manifest.delivery;
assert.ok(publicEntrypoint.endsWith("/index.html"));
const publicDirectory = publicEntrypoint.slice(0, -"/index.html".length);
assert.ok(publicDirectory.startsWith("/games/"));
const runtimeGameRoute = publicDirectory.slice("/games".length);
const artifactRoot = artifactDirectory.split("/").slice(0, 2).join("/");
const apkAssetDirectory = publicDirectory.slice(1);
const languageRoute = `/${adapter.language_id}`;
const compatibilityEntrypoint = `${languageRoute}${publicEntrypoint}`;
const expectedPlatforms = Object.entries(manifest.platforms)
  .filter(([, enabled]) => enabled)
  .map(([platform]) => platform)
  .sort();

test("catalog identity selects the manifest that drives every delivery boundary", () => {
  assert.equal(manifest.id, catalogEntry.id);
  assert.equal(adapter.game_id, manifest.id);
  assert.deepEqual([...adapter.enabled_platforms].sort(), expectedPlatforms);
});

test("the executable runtime audit derives game paths from the central manifest", () => {
  assert.match(
    runtimeAudit,
    /readFileSync\(join\(workspaceRoot, "apps\/games\/memory-moon\/game\.json"\)/,
  );
  assert.match(runtimeAudit, /MEMORY_MOON_MANIFEST\.delivery\.artifact_directory/);
  assert.match(runtimeAudit, /MEMORY_MOON_MANIFEST\.delivery\.public_entrypoint/);
  assert.match(runtimeAudit, /MEMORY_MOON_MANIFEST\.delivery\.compatibility_entrypoints\[0\]/);
});

test("runtime serves the manifest artifact at its neutral route and declares Czech compatibility", () => {
  const gameSpec = new RegExp(
    `const ACTIVE_WEB_GAMES:[\\s\\S]*?WebGameSpec \\{[^}]*id: "${escapeRegExp(manifest.id)}",[^}]*route_prefix: "${escapeRegExp(runtimeGameRoute)}",[^}]*artifact_dir: "${escapeRegExp(artifactDirectory)}"`,
  );
  const languageSpec = new RegExp(
    `LanguageAppSpec \\{[^}]*id: "${escapeRegExp(adapter.language_id)}",[^}]*route_prefix: "${escapeRegExp(languageRoute)}",[^}]*legacy_games_compatibility: true`,
  );

  assert.match(routes, gameSpec);
  assert.match(routes, /\.nest\("\/games", build_web_games\(&workspace\)\)/);
  assert.match(routes, languageSpec);
  assert.match(
    routes,
    /let router = if spec\.legacy_games_compatibility \{\s*router\.nest\("\/games", build_web_games\(workspace\)\)/,
  );
  assert.match(routes, /HeaderValue::from_static\("no-cache, max-age=0"\)/);
});

test("Compose reads and exports only the manifest-owned central artifact", () => {
  assert.ok(compose.includes(`./${artifactRoot}:/workspace/${artifactRoot}:ro`));
  assert.ok(compose.includes(`./${artifactDirectory}:/output`));
  assert.equal(
    compose.includes(`./apps/languages/czech/static${publicDirectory}:/output`),
    false,
  );
});

test("every public delivery gate selects the manifest game and mounted authorities", () => {
  assert.ok(compose.includes("node /workspace/apps/games/tooling/check-release-readiness.mjs"));
  assert.ok(compose.includes(`--require-game ${manifest.id}`));
  assert.ok(gradle.includes(`val memoryMoonGameId = "${manifest.id}"`));
  assert.match(gradle, /"--require-game",\s*memoryMoonGameId/);
  assert.ok(publicDebugPublisher.includes(`--require-game ${manifest.id}`));
  assert.ok(
    compose.includes(
      "./apps/curriculum/src/json-schema-subset.mjs:/workspace/apps/curriculum/src/json-schema-subset.mjs:ro",
    ),
  );
  for (const dependency of manifest.dependencies) {
    assert.ok(
      compose.includes(`./${dependency.authority}:/workspace/${dependency.authority}:ro`),
      `public tunnel must read the ${dependency.id} authority through a narrow read-only mount`,
    );
  }
  assert.equal(compose.includes("- .:/workspace:ro"), false);
});

test("Android packages the manifest artifact under the same neutral URL path", () => {
  assert.equal(manifest.platforms.android, true);
  assert.ok(gradle.includes(`workspaceRootDir.dir("${artifactDirectory}")`));
  assert.ok(gradle.includes(`into("${apkAssetDirectory}")`));
  assert.ok(gradle.includes('exclude("games/**")'));
  assert.ok(androidClient.includes('path.startsWith("/games/")'));
  assert.ok(
    androidClient.includes(
      'path == LANGUAGE_ROUTE_PREFIX || path.startsWith("$LANGUAGE_ROUTE_PREFIX/")',
    ),
  );
});

test("Czech iframe and reviewed adapter mirror manifest paths and host presentation", () => {
  assert.ok(manifest.delivery.compatibility_entrypoints.includes(compatibilityEntrypoint));
  assert.match(
    czechIndex,
    new RegExp(
      `id="memoryMoonGame"[\\s\\S]*?data-src="${escapeRegExp(publicEntrypoint)}"`,
    ),
  );
  assert.ok(czechIndex.includes(`<h2>${adapter.presentation.title}</h2>`));
  assert.ok(
    czechIndex.includes(
      `<p class="memory-moon-copy">${adapter.presentation.description}</p>`,
    ),
  );
  assert.ok(czechIndex.includes(`<strong>${adapter.presentation.loading_text}</strong>`));
  assert.match(
    czechIndex,
    new RegExp(
      `data-train-tab="${escapeRegExp(manifest.id)}"[\\s\\S]{0,240}<img src="${escapeRegExp(adapter.presentation.icon)}"`,
    ),
  );
  assert.match(
    czechChrome,
    new RegExp(
      `"${escapeRegExp(manifest.id)}": \\{[^}]*title: "${escapeRegExp(adapter.presentation.title)}"[^}]*iconSrc: "${escapeRegExp(adapter.presentation.icon)}"`,
    ),
  );

  const executableHostSources = `${czechIndex}\n${czechApp}\n${czechChrome}`;
  assert.equal(executableHostSources.includes("data/game-adapters/"), false);
  assert.equal(executableHostSources.includes(`${manifest.id}.v1.json`), false);
});
