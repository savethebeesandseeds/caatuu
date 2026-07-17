import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  inspectSetupAssetManifest,
  refreshSetupAssetManifest
} from "../refresh-setup-assets.mjs";

async function fixture() {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "caatuu-setup-assets-"));
  const launcherStaticDir = join(workspaceRoot, "apps/launcher/static");
  const languageStaticDir = join(workspaceRoot, "apps/languages/czech/static");
  await mkdir(join(launcherStaticDir, "assets/images"), { recursive: true });
  await mkdir(join(languageStaticDir, "data"), { recursive: true });
  await writeFile(join(launcherStaticDir, "assets/images/example.png"), "shared-image");
  await writeFile(join(languageStaticDir, "data/example.json"), "language-data");

  const manifestPath = join(languageStaticDir, "setup-assets.json");
  await writeFile(manifestPath, `${JSON.stringify({
    version: 1,
    cache_name: "fixture",
    artifacts: [
      { key: "shared", url: "/assets/images/example.png", bytes: 0, sha256: "" },
      { key: "language", url: "/cz/data/example.json", bytes: 0, sha256: "" }
    ]
  }, null, 2)}\n`);

  return { workspaceRoot, launcherStaticDir, languageStaticDir, manifestPath };
}

test("refresh writes current bytes and hashes for shared and language assets", async (t) => {
  const paths = await fixture();
  t.after(() => rm(paths.workspaceRoot, { recursive: true, force: true }));

  const before = inspectSetupAssetManifest(paths);
  assert.equal(before.changes.length, 2);

  const refreshed = refreshSetupAssetManifest(paths);
  assert.equal(refreshed.changes.length, 2);
  assert.equal(inspectSetupAssetManifest(paths).changes.length, 0);

  const manifest = JSON.parse(await readFile(paths.manifestPath, "utf8"));
  assert.equal(manifest.artifacts[0].bytes, Buffer.byteLength("shared-image"));
  assert.match(manifest.artifacts[0].sha256, /^[a-f0-9]{64}$/);
  assert.equal(manifest.artifacts[1].bytes, Buffer.byteLength("language-data"));
  assert.match(manifest.artifacts[1].sha256, /^[a-f0-9]{64}$/);
});

test("check mode detects drift without changing the manifest", async (t) => {
  const paths = await fixture();
  t.after(() => rm(paths.workspaceRoot, { recursive: true, force: true }));
  refreshSetupAssetManifest(paths);
  const previousManifest = await readFile(paths.manifestPath, "utf8");

  await writeFile(join(paths.launcherStaticDir, "assets/images/example.png"), "corrected-image");
  const report = refreshSetupAssetManifest({ ...paths, check: true });

  assert.equal(report.changes.length, 1);
  assert.equal(report.changes[0].key, "shared");
  assert.equal(await readFile(paths.manifestPath, "utf8"), previousManifest);
});

test("duplicate keys fail before the manifest can be refreshed", async (t) => {
  const paths = await fixture();
  t.after(() => rm(paths.workspaceRoot, { recursive: true, force: true }));
  const manifest = JSON.parse(await readFile(paths.manifestPath, "utf8"));
  manifest.artifacts[1].key = manifest.artifacts[0].key;
  await writeFile(paths.manifestPath, JSON.stringify(manifest));

  assert.throws(() => refreshSetupAssetManifest(paths), /Duplicate setup artifact key/);
});

test("legacy public asset URLs resolve to descriptive source folders", async (t) => {
  const paths = await fixture();
  t.after(() => rm(paths.workspaceRoot, { recursive: true, force: true }));

  const aliases = [
    ["mascot", "/assets/aliens/czech.png", "assets/language-mascots/czech.png"],
    ["loading", "/assets/macaw/loading_animation/frame.png", "assets/macaw/loading-animation/frame.png"],
    ["vocabulary", "/assets/miscellaneous/house.png", "assets/visual-vocabulary/house.png"]
  ];
  const manifest = JSON.parse(await readFile(paths.manifestPath, "utf8"));
  for (const [key, url, source] of aliases) {
    const sourcePath = join(paths.launcherStaticDir, source);
    await mkdir(dirname(sourcePath), { recursive: true });
    await writeFile(sourcePath, key);
    manifest.artifacts.push({ key, url, bytes: 0, sha256: "" });
  }
  await writeFile(paths.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const report = inspectSetupAssetManifest(paths);
  for (const [key, , source] of aliases) {
    const change = report.changes.find((item) => item.key === key);
    assert.equal(change?.sourcePath, join(paths.launcherStaticDir, source));
  }
});
