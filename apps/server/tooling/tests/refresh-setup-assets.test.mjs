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
  const sharedRuntimeDir = join(workspaceRoot, "apps/language-runtime");
  const courseManifestPath = join(workspaceRoot, "apps/languages/czech/course.json");
  await mkdir(join(launcherStaticDir, "assets/images"), { recursive: true });
  await mkdir(join(languageStaticDir, "data"), { recursive: true });
  await mkdir(join(sharedRuntimeDir, "static/app"), { recursive: true });
  await writeFile(join(launcherStaticDir, "assets/images/example.png"), "shared-image");
  await writeFile(join(languageStaticDir, "data/example.json"), "language-data");
  await writeFile(join(sharedRuntimeDir, "static/app/index.html"), "shared-app");
  await writeFile(courseManifestPath, JSON.stringify({
    routePrefix: "/cz",
    entryPath: "/cz/index.html",
    routes: { wordWorld: "index.html?game=word-net" },
    resources: {
      appEntry: { path: "apps/language-runtime/static/app/index.html" }
    }
  }));

  const manifestPath = join(languageStaticDir, "setup-assets.json");
  await writeFile(manifestPath, `${JSON.stringify({
    version: 1,
    cache_name: "fixture",
    application: {
      entryPath: "/cz/legacy.html",
      appEntry: "apps/languages/czech/static/index.html"
    },
    offline: {
      cacheName: "caatuu-czech-pwa-v1",
      cachePrefix: "caatuu-czech-pwa-",
      assets: []
    },
    artifacts: [
      { key: "app-entry", kind: "shared-application", url: "/cz/index.html", bytes: 0, sha256: "" },
      { key: "shared", url: "/assets/images/example.png", bytes: 0, sha256: "" },
      { key: "language", url: "/cz/data/example.json", bytes: 0, sha256: "" }
    ]
  }, null, 2)}\n`);
  await writeFile(
    join(languageStaticDir, "sw.js"),
    '"use strict";\n\n// Offline catalog revision: caatuu-czech-pwa-v1\n' +
      'importScripts("/language-runtime/static/source/course-service-worker.js");\n'
  );

  return {
    workspaceRoot,
    launcherStaticDir,
    languageStaticDir,
    sharedRuntimeDir,
    courseManifestPath,
    manifestPath
  };
}

test("refresh writes current bytes and hashes for shared and language assets", async (t) => {
  const paths = await fixture();
  t.after(() => rm(paths.workspaceRoot, { recursive: true, force: true }));

  const before = inspectSetupAssetManifest(paths);
  assert.equal(before.changes.length, 3);
  assert.equal(before.applicationChanged, true);

  const refreshed = refreshSetupAssetManifest(paths);
  assert.equal(refreshed.changes.length, 3);
  const current = inspectSetupAssetManifest(paths);
  assert.equal(current.changes.length, 0);
  assert.equal(current.applicationChanged, false);

  const manifest = JSON.parse(await readFile(paths.manifestPath, "utf8"));
  assert.deepEqual(manifest.application, {
    entryPath: "/cz/index.html",
    appEntry: "apps/language-runtime/static/app/index.html"
  });
  assert.equal(manifest.artifacts[0].bytes, Buffer.byteLength("shared-app"));
  assert.match(manifest.artifacts[0].sha256, /^[a-f0-9]{64}$/);
  assert.equal(manifest.artifacts[1].bytes, Buffer.byteLength("shared-image"));
  assert.match(manifest.artifacts[1].sha256, /^[a-f0-9]{64}$/);
  assert.equal(manifest.artifacts[2].bytes, Buffer.byteLength("language-data"));
  assert.match(manifest.artifacts[2].sha256, /^[a-f0-9]{64}$/);
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

test("refresh fails closed when the worker revision does not match the offline catalog", async (t) => {
  const paths = await fixture();
  t.after(() => rm(paths.workspaceRoot, { recursive: true, force: true }));
  await writeFile(
    join(paths.languageStaticDir, "sw.js"),
    '"use strict";\n\n// Offline catalog revision: caatuu-czech-pwa-v0\n' +
      'importScripts("/language-runtime/static/source/course-service-worker.js");\n'
  );

  assert.throws(
    () => refreshSetupAssetManifest(paths),
    /does not match offline\.cacheName caatuu-czech-pwa-v1/
  );
});

test("duplicate keys fail before the manifest can be refreshed", async (t) => {
  const paths = await fixture();
  t.after(() => rm(paths.workspaceRoot, { recursive: true, force: true }));
  const manifest = JSON.parse(await readFile(paths.manifestPath, "utf8"));
  manifest.artifacts[1].key = manifest.artifacts[0].key;
  await writeFile(paths.manifestPath, JSON.stringify(manifest));

  assert.throws(() => refreshSetupAssetManifest(paths), /Duplicate setup artifact key/);
});

test("deprecated mini-app documents are rejected from offline and setup catalogs", async (t) => {
  for (const legacyDocument of ["word-world.html", "word-net.html"]) {
    const paths = await fixture();
    t.after(() => rm(paths.workspaceRoot, { recursive: true, force: true }));
    const manifest = JSON.parse(await readFile(paths.manifestPath, "utf8"));
    manifest.offline.assets.push(`/cz/${legacyDocument}`);
    await writeFile(paths.manifestPath, JSON.stringify(manifest));

    assert.throws(
      () => inspectSetupAssetManifest(paths),
      /Deprecated mini-app document cannot be cached/
    );
  }
});

test("retired parallel UI assets are rejected from offline catalogs", async (t) => {
  for (const retiredAsset of [
    "/cz/source/features/home/home.css",
    "/cz/source/games/verb-nebula/app.css",
    "/cz/source/games/verb-nebula/app.js",
    "/cz/source/games/word-world/word-net.js",
    "/cz/source/shared/chrome.css",
    "/cz/source/shared/chrome.js",
    "/cz/source/shared/learning-profile.js",
    "/cz/source/shared/theme.css",
    "/language-runtime/static/source/product-shell.mjs",
    "/language-runtime/static/styles/course-shell.css"
  ]) {
    const paths = await fixture();
    t.after(() => rm(paths.workspaceRoot, { recursive: true, force: true }));
    const manifest = JSON.parse(await readFile(paths.manifestPath, "utf8"));
    manifest.offline.assets.push(retiredAsset);
    await writeFile(paths.manifestPath, JSON.stringify(manifest));

    assert.throws(
      () => inspectSetupAssetManifest(paths),
      /Retired parallel UI asset cannot be cached/
    );
  }
});

test("offline catalog URLs must resolve to canonical course or shared files", async (t) => {
  const paths = await fixture();
  t.after(() => rm(paths.workspaceRoot, { recursive: true, force: true }));
  const manifest = JSON.parse(await readFile(paths.manifestPath, "utf8"));
  manifest.offline.assets.push("./source/missing.js");
  await writeFile(paths.manifestPath, JSON.stringify(manifest));

  assert.throws(
    () => inspectSetupAssetManifest(paths),
    /Offline asset source file does not exist/
  );
});

test("course gameplay routes cannot point at retired mini-app documents", async (t) => {
  for (const legacyDocument of ["word-world.html", "word-net.html"]) {
    const paths = await fixture();
    t.after(() => rm(paths.workspaceRoot, { recursive: true, force: true }));
    const course = JSON.parse(await readFile(paths.courseManifestPath, "utf8"));
    course.routes.wordWorld = `${legacyDocument}?legacy=1`;
    await writeFile(paths.courseManifestPath, JSON.stringify(course));

    assert.throws(
      () => inspectSetupAssetManifest(paths),
      /must use the canonical shared app/
    );
  }
});

test("remaining legacy public asset URLs resolve to descriptive source folders", async (t) => {
  const paths = await fixture();
  t.after(() => rm(paths.workspaceRoot, { recursive: true, force: true }));

  const aliases = [
    ["loading", "/assets/loading_animation/frame.png", "assets/loading-animation/frame.png"],
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
