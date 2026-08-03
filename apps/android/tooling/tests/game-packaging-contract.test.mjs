import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const repoRoot = new URL("../../../../", import.meta.url);
const build = await readFile(new URL("apps/android/app/build.gradle.kts", repoRoot), "utf8");
const exporter = await readFile(
  new URL("apps/games/memory-moon/tooling/export-web.sh", repoRoot),
  "utf8",
);
const gameManifest = JSON.parse(
  await readFile(new URL("apps/games/memory-moon/game.json", repoRoot), "utf8"),
);
const client = await readFile(
  new URL("apps/android/app/src/main/java/com/caatuu/android/CaatuuAssetClient.kt", repoRoot),
  "utf8",
);

test("the Web exporter emits a deterministic manifest for every delivered file", () => {
  assert.match(exporter, /readonly bundle_manifest_name="bundle-manifest\.json"/);
  assert.match(exporter, /readonly bundle_manifest_schema="caatuu-game-web-bundle"/);
  assert.match(exporter, /readonly game_id="memory-moon"/);
  assert.match(exporter, new RegExp(`readonly game_version="${gameManifest.version.replaceAll(".", "\\.")}"`));
  assert.match(exporter, /readonly artifact_version="godot-v1"/);
  assert.match(exporter, /"version": "%s"\\n' "\$\{godot_version\}"/);
  assert.match(exporter, /find "\$\{output_root\}"[\s\S]*-type f[\s\S]*-printf '%P\\0'/);
  assert.match(exporter, /LC_ALL=C sort --zero-terminated/);
  assert.match(exporter, /stat --format='%s'/);
  assert.match(exporter, /sha256sum "\$\{file_path\}"/);
  assert.match(exporter, /! -path "\$\{bundle_manifest_path\}"/);
  assert.match(exporter, /mv -- "\$\{bundle_manifest_temp_path\}" "\$\{bundle_manifest_path\}"/);
  for (const notice of [
    "LICENSES/Godot-MIT.txt",
    "LICENSES/Macaw-Parts-CC0.md",
    "LICENSES/Memory-Grove-Provenance.md",
    "LICENSES/Memory-Moon-Style-Provenance.md",
    "LICENSES/Quaternius-CC0.txt",
    "THIRD_PARTY_NOTICES.md",
  ]) {
    assert.ok(exporter.includes(`"${notice}"`), `export manifest must require ${notice}`);
  }
});

test("Android verifies the complete shared game bundle before copying it", () => {
  assert.match(build, /artifacts\/games\/memory-moon\/web\/godot-v1/);
  assert.match(build, /exclude\("games\/\*\*"\)/);
  assert.match(build, /val verifyBundledGameArtifacts by tasks\.registering/);
  assert.match(build, /listOf\("index\.html", "index\.js", "index\.pck", "index\.wasm"\)/);
  assert.match(build, /val memoryMoonBundleManifestName = "bundle-manifest\.json"/);
  assert.match(build, /inputs\.dir\(memoryMoonWebArtifactDir\)/);
  assert.match(build, /inputs\.file\(memoryMoonGameManifest\)/);
  assert.match(build, /requireExactJsonKeys\(/);
  assert.match(build, /schemaVersion !is Number/);
  assert.match(build, /byteValue !is Number/);
  assert.match(build, /required_notices/);
  assert.match(build, /Files\.isSymbolicLink/);
  assert.match(build, /val missingFiles = expectedSizes\.keys - actualFiles\.keys/);
  assert.match(build, /val staleExtraFiles = actualFiles\.keys - expectedSizes\.keys/);
  assert.match(build, /file\.length\(\) != expectedBytes/);
  assert.match(build, /val actualHash = sha256\(file\)/);
  assert.match(build, /actualHash != expectedHash/);
  assert.match(build, /into\("games\/memory-moon\/godot-v1"\)/);
  assert.match(build, /assets\.srcDir\(generatedGameAssetsDir\)/);
  assert.match(build, /dependsOn\(syncLanguageAssets, syncGameAssets\)/);
});

test("release and Play packaging invoke the canonical catalog and authority gate", () => {
  assert.match(build, /fun verifyGameReleaseReadiness\(surface: String\)/);
  assert.match(build, /apps\/games\/tooling\/check-release-readiness\.mjs/);
  assert.match(build, /ProcessBuilder\(command\)/);
  assert.match(build, /"--repo-root",[\s\S]*workspaceRootDir\.asFile\.absolutePath/);
  assert.match(build, /"--require-game",[\s\S]*memoryMoonGameId/);
  assert.match(build, /if \(task\.project\.path != androidAppProjectPath\) return@any false/);
  assert.match(
    build,
    /if \(releasePackagingRequested\) \{\s*verifyGameReleaseReadiness\("android-release-play"\)\s*\}/,
  );
  assert.doesNotMatch(build, /verifyGameReleaseEligibility/);
  assert.equal(gameManifest.release_status, "local-preview-only");
  assert.ok(
    gameManifest.dependencies.some(({ status }) => status !== "active"),
    "the current preview manifest should remain blocked from release packaging",
  );
  assert.doesNotMatch(
    build.match(/debug \{[\s\S]*?\n        \}/)?.[0] ?? "",
    /verifyGameReleaseReadiness/,
  );
});

test("the Android WebView serves both neutral and legacy game URLs from one APK path", () => {
  assert.match(client, /path\.startsWith\("\/games\/"\)/);
  assert.match(
    client,
    /path == LANGUAGE_ROUTE_PREFIX \|\| path\.startsWith\("\$LANGUAGE_ROUTE_PREFIX\/"\)/,
  );
  assert.match(client, /"wasm" -> "application\/wasm"/);
});
