import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { MUSIC_TRACKS } from "../../../language-runtime/static/source/background-music.mjs";
import { loadAndroidCourseBundleConfiguration, createAndroidProductDelivery } from "../build-product-assets.mjs";

const workspaceRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const readJson = (path) => JSON.parse(readFileSync(join(workspaceRoot, path), "utf8"));
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

test("the full development APK asset sync excludes downloaded music and checks the final packaged directory", () => {
  const gradle = readFileSync(join(workspaceRoot, "apps/android/app/build.gradle.kts"), "utf8");
  const sync = gradle.slice(gradle.indexOf("val syncLanguageAssets by tasks.registering(Sync::class)"), gradle.indexOf("\nandroid {"));
  assert.match(sync, /for \(\(source, outputPath\) in sharedAppAssets\.filterNot \{ \(_, output\) -> output\.startsWith\("assets\/music\/audio\/"\) \}\)/u,
    "Development APK packaging must not copy the songs from the shared source catalog");
  assert.match(sync, /doLast \{[\s\S]*generatedLanguageAssetsDir\.get\(\)\.dir\("assets\/music\/audio"\)[\s\S]*audioDirectory\.walkTopDown\(\)\.none \{ it\.isFile \}/u,
    "The real Gradle sync must also reject any music audio entering through another source");
  assert.match(sync, /dependsOn\(refreshSetupAssetManifest\)/u,
    "Downloaded songs retain their exact setup receipts in the full app");
  assert.match(sync, /if \(remainingLauncherIcons\.isNotEmpty\(\)\) \{\s*from\(launcherStaticDir\.dir\("assets\/icons"\)\)/u,
    "An empty launcher include list must never become an unrestricted duplicate copy");
});

test("the selectable songs exactly cover the source audio and verified shared setup catalogs", () => {
  const appAssets = readJson("apps/language-runtime/app-assets.json").assets;
  const musicAssets = appAssets.filter(({ output }) => output.startsWith("assets/music/"));
  const audio = readdirSync(join(workspaceRoot, "apps/launcher/static/assets/music/audio")).filter((name) => name.endsWith(".mp3")).sort();
  assert.deepEqual(MUSIC_TRACKS.map(({ url }) => url.split("/").at(-1)).sort(), audio);
  const expectedPaths = [...MUSIC_TRACKS.map(({ url }) => url.slice(1)), "assets/music/MUSIC_CREDITS.txt",
    "assets/music/licenses/CC-BY-3.0.txt", "assets/music/licenses/CC0-1.0.txt"].sort();
  assert.deepEqual(musicAssets.map(({ output }) => output).sort(), expectedPaths);
  const credits = readFileSync(join(workspaceRoot, "apps/launcher/static/assets/music/MUSIC_CREDITS.txt"), "utf8");
  for (const track of MUSIC_TRACKS) {
    assert.ok(credits.includes(track.title));
    assert.ok(credits.includes(track.author));
    const mapping = musicAssets.find(({ output }) => output === track.url.slice(1));
    assert.equal(digest(readFileSync(join(workspaceRoot, mapping.source))), track.sha256);
  }
  for (const { manifest } of readJson("apps/languages/catalog.json").courses) {
    const course = readJson(manifest);
    if (!course.platforms.browser.enabled) continue;
    const setup = readJson(course.resources.setupCatalog.path);
    for (const { source, output } of musicAssets) {
      const artifacts = setup.artifacts.filter(({ asset_path }) => asset_path === output);
      assert.equal(artifacts.length, 1, `${course.id}: ${output}`);
      const artifact = artifacts[0];
      const bytes = readFileSync(join(workspaceRoot, source));
      assert.equal(artifact.bytes, bytes.length);
      assert.equal(artifact.sha256, digest(bytes));
      assert.equal(artifact.url, `/${output}`);
      assert.equal(artifact.native_required, true);
      assert.equal(artifact.browser_required, true);
      assert.ok(!setup.offline.assets.some((url) => url.split("?")[0] === artifact.url),
        "Music must be downloaded once by setup, never duplicated in course precaches");
    }
  }
});

test("the real bootstrap product excludes music and every course installs one identical shared object", (t) => {
  const configuration = loadAndroidCourseBundleConfiguration({ allowMissingSetupDeliveredRuntimeFiles: true });
  const delivery = createAndroidProductDelivery(configuration);
  const musicAssets = configuration.sharedAssets.filter(({ output }) => output.startsWith("assets/music/"));
  for (const { source, output } of musicAssets) {
    assert.ok(!delivery.bundledFiles.has(output), `${output} must not enter the bootstrap APK`);
    assert.ok(!delivery.profile.assets.includes(output));
    assert.equal(configuration.sharedAssets.filter((asset) => asset.output === output).length, 1);
    const records = delivery.setupPayload.artifacts.filter(({ assetPath }) => assetPath === output);
    assert.equal(records.length, 1, "One sealed setup object owns each shared music file");
    const record = records[0];
    assert.equal(record.sha256, digest(readFileSync(source)));
    assert.ok(delivery.setupObjects.get(record.file).equals(readFileSync(source)));
    for (const { course } of configuration.configurations) {
      const setup = JSON.parse(delivery.bundledFiles.get(`courses/${course.id}/setup-assets.json`));
      const installed = setup.artifacts.filter(({ asset_path }) => asset_path === output);
      assert.equal(installed.length, 1, course.id);
      assert.equal(installed[0].url, `/${record.path}`);
      assert.equal(installed[0].sha256, record.sha256);
      assert.equal(installed[0].native_required, true);
      assert.ok(!delivery.logicalFiles.has(`courses/${course.id}/${output}`));
    }
  }
  t.diagnostic(`Bootstrap assets ${delivery.byteCounts.bootstrap} bytes; setup ${delivery.byteCounts.setup} bytes; music ${musicAssets.reduce((sum, { source }) => sum + readFileSync(source).length, 0)} bytes.`);
});
