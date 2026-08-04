import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const repoRoot = new URL("../../../../", import.meta.url);
const [build, client, publisher, czechIndex] = await Promise.all([
  readFile(new URL("apps/android/app/build.gradle.kts", repoRoot), "utf8"),
  readFile(
    new URL("apps/android/app/src/main/java/com/caatuu/android/CaatuuAssetClient.kt", repoRoot),
    "utf8",
  ),
  readFile(new URL("apps/android/tooling/publish-public-debug.sh", repoRoot), "utf8"),
  readFile(new URL("apps/languages/czech/static/index.html", repoRoot), "utf8"),
]);

test("Android packages only application assets", () => {
  assert.match(build, /exclude\("games\/\*\*"\)/);
  assert.match(build, /assets\.srcDir\(generatedLanguageAssetsDir\)/);
  assert.doesNotMatch(build, /generatedGameAssetsDir|syncGameAssets|verifyBundledGameArtifacts/);
  assert.doesNotMatch(build, /artifacts\/games|apps\/games\/caatuu-game/);
  assert.doesNotMatch(build, /index\.wasm|index\.pck/);
});

test("the Android WebView cannot resolve standalone game routes", () => {
  assert.doesNotMatch(client, /path\.startsWith\("\/games\/"\)/);
  assert.match(client, /else -> return notFound\(\)/);
});

test("application publication is independent from game readiness", () => {
  assert.doesNotMatch(build, /check-release-readiness|require-game/);
  assert.doesNotMatch(publisher, /check-release-readiness|require-game/);
});

test("the packaged application retains only the Memory Moon placeholder", () => {
  assert.match(czechIndex, /id="trainPanelMemoryMoon"/);
  assert.match(czechIndex, /Coming next/);
  assert.doesNotMatch(czechIndex, /\/games\/caatuu-game|memoryMoonGame/);
});
