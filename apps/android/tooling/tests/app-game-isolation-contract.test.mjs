import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const repoRoot = new URL("../../../../", import.meta.url);
const [build, client, publisher, canonicalIndex] = await Promise.all([
  readFile(new URL("apps/android/app/build.gradle.kts", repoRoot), "utf8"),
  readFile(
    new URL("apps/android/app/src/main/java/com/caatuu/android/CaatuuAssetClient.kt", repoRoot),
    "utf8",
  ),
  readFile(new URL("apps/android/tooling/publish-public-debug.sh", repoRoot), "utf8"),
  readFile(new URL("apps/language-runtime/static/app/index.html", repoRoot), "utf8"),
]);

test("Android packages only application assets", () => {
  assert.match(build, /exclude\("games\/\*\*"\)/);
  assert.match(build, /assets\.srcDir\(generatedLanguageAssetsDir\)/);
  assert.doesNotMatch(build, /generatedGameAssetsDir|syncGameAssets|verifyBundledGameArtifacts/);
  assert.doesNotMatch(build, /artifacts\/games|apps\/games\/caatuu-game/);
  assert.doesNotMatch(build, /index\.wasm|index\.pck/);
});

test("the full Android shell derives its course boundary from one manifest property", () => {
  assert.match(build, /gradleProperty\("caatuuCourseManifest"\)/);
  assert.match(build, /resources[\s\S]*androidAssetCatalog/);
  assert.match(build, /courseResourcePath\("appEntry", "file"\)/);
  assert.match(build, /apps\/language-runtime\/static\/app\/index\.html/);
  assert.match(build, /exclude\("index\.html"\)/);
  assert.match(build, /from\(appEntryFile\)/);
  assert.match(build, /val outputPath = "language-runtime\/\$path"/);
  assert.match(build, /CAATUU_COURSE_CAPABILITIES_JSON/);
  assert.doesNotMatch(build, /gradleProperty\("caatuuLanguage(?:Id|AppDir|RoutePrefix|EntryPath)"\)/);
});

test("the Android WebView cannot resolve standalone game routes", () => {
  assert.doesNotMatch(client, /path\.startsWith\("\/games\/"\)/);
  assert.match(client, /else -> return notFound\(\)/);
});

test("the Android WebView exposes only the packaged shared language runtime prefix", () => {
  assert.match(client, /SHARED_LANGUAGE_RUNTIME_ROUTE_PREFIX = "\/language-runtime\/"/);
  assert.match(client, /path\.startsWith\(SHARED_LANGUAGE_RUNTIME_ROUTE_PREFIX\)[\s\S]*?trimStart\('\/'\)/);
  assert.match(client, /if \(assetPath\.contains\("\.\."\)\) return notFound\(\)/);
  assert.doesNotMatch(client, /apps\/language-runtime|language-runtime\/README|language-runtime\/tests/);
});

test("the shared app document retains a route-specific Android start URL", () => {
  assert.match(client, /LANGUAGE_ENTRY_PATH = normalizePath\(BuildConfig\.CAATUU_LANGUAGE_ENTRY_PATH\)/);
  assert.match(client, /START_URL = "https:\/\/\$HOST\$LANGUAGE_ENTRY_PATH"/);
  assert.match(build, /CAATUU_LANGUAGE_ENTRY_PATH[\s\S]*bundledLanguageEntryPath/);
});

test("application publication is independent from game readiness", () => {
  assert.doesNotMatch(build, /check-release-readiness|require-game/);
  assert.doesNotMatch(publisher, /check-release-readiness|require-game/);
});

test("the packaged application retains only the Memory Moon placeholder", () => {
  assert.match(canonicalIndex, /id="trainPanelMemoryMoon"/);
  assert.match(canonicalIndex, /Coming next/);
  assert.doesNotMatch(canonicalIndex, /\/games\/caatuu-game|memoryMoonGame/);
});
