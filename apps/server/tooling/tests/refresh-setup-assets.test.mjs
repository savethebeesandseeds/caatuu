import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  inspectSetupAssetManifest,
  refreshAllBrowserCourseSetupAssets,
  refreshSetupAssetManifest
} from "../refresh-setup-assets.mjs";

async function fixture({
  workspaceRoot = null,
  courseId = "cz",
  directoryName = "czech",
  routePrefix = "/cz"
} = {}) {
  workspaceRoot ||= await mkdtemp(join(tmpdir(), "caatuu-setup-assets-"));
  const launcherStaticDir = join(workspaceRoot, "apps/launcher/static");
  const languageStaticDir = join(workspaceRoot, `apps/languages/${directoryName}/static`);
  const sharedRuntimeDir = join(workspaceRoot, "apps/language-runtime");
  const courseManifestPath = join(workspaceRoot, `apps/languages/${directoryName}/course.json`);
  await mkdir(join(launcherStaticDir, "assets/images"), { recursive: true });
  await mkdir(join(languageStaticDir, "data"), { recursive: true });
  await mkdir(join(sharedRuntimeDir, "static/app"), { recursive: true });
  await mkdir(join(sharedRuntimeDir, "static/source"), { recursive: true });
  await writeFile(join(launcherStaticDir, "assets/images/example.png"), "shared-image");
  await writeFile(join(languageStaticDir, "data/example.json"), "language-data");
  await writeFile(join(sharedRuntimeDir, "static/app/index.html"), "shared-app");
  await writeFile(join(sharedRuntimeDir, "static/source/shared-runtime.mjs"), "export {};\n");
  await writeFile(join(sharedRuntimeDir, "app-assets.json"), JSON.stringify({
    schemaVersion: 1,
    appEntry: "apps/language-runtime/static/app/index.html",
    assets: [
      {
        source: "apps/language-runtime/static/source/shared-runtime.mjs",
        output: "language-runtime/static/source/shared-runtime.mjs"
      },
      {
        source: "apps/language-runtime/static/source/course-service-worker.js",
        output: "language-runtime/static/source/course-service-worker.js"
      }
    ]
  }));
  const course = {
    id: courseId,
    directoryName,
    routePrefix,
    entryPath: `${routePrefix}/index.html`,
    routes: { wordWorld: "index.html?game=word-net" },
    cache: {
      prefix: `caatuu-${directoryName}-pwa-`,
      setupFallback: `caatuu-${directoryName}-setup-v1`
    },
    platforms: { browser: { enabled: true } },
    resources: {
      appEntry: { path: "apps/language-runtime/static/app/index.html" },
      staticRoot: { path: `apps/languages/${directoryName}/static` },
      setupCatalog: { path: `apps/languages/${directoryName}/static/setup-assets.json` }
    }
  };
  await writeFile(courseManifestPath, JSON.stringify(course));

  const manifestPath = join(languageStaticDir, "setup-assets.json");
  await writeFile(manifestPath, `${JSON.stringify({
    version: 1,
    cache_name: "fixture",
    application: {
      entryPath: `${routePrefix}/legacy.html`,
      appEntry: `apps/languages/${directoryName}/static/index.html`
    },
    offline: {
      cacheName: `caatuu-${directoryName}-pwa-v1`,
      cachePrefix: `caatuu-${directoryName}-pwa-`,
      assets: ["/language-runtime/static/source/shared-runtime.mjs?v=runtime-1"]
    },
    artifacts: [
      { key: "app-entry", kind: "shared-application", url: `${routePrefix}/index.html`, bytes: 0, sha256: "" },
      { key: "shared", url: "/assets/images/example.png", bytes: 0, sha256: "" },
      { key: "language", url: `${routePrefix}/data/example.json`, bytes: 0, sha256: "" }
    ]
  }, null, 2)}\n`);
  await writeFile(
    join(languageStaticDir, "sw.js"),
    `"use strict";\n\n// Offline catalog revision: caatuu-${directoryName}-pwa-v1\n` +
      'importScripts("/language-runtime/static/source/course-service-worker.js");\n'
  );

  return {
    workspaceRoot,
    launcherStaticDir,
    languageStaticDir,
    sharedRuntimeDir,
    courseManifestPath,
    manifestPath,
    course,
    record: {
      course,
      manifestPath: `apps/languages/${directoryName}/course.json`
    }
  };
}

async function dictionaryFixture() {
  const paths = await fixture();
  const resources = {
    dictionaryCatalog: "data/dictionaries/catalog.json",
    dictionaryCoreEntries: "data/dictionaries/core.json",
    dictionaryScriptLines: "data/language/scripts.json",
    dictionaryReferenceDocument: "data/dictionaries/reference.html",
    dictionaryProvider: "source/features/dictionary/provider.js"
  };
  for (const relativePath of Object.values(resources)) {
    const file = join(paths.languageStaticDir, relativePath);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, relativePath);
  }
  const course = JSON.parse(await readFile(paths.courseManifestPath, "utf8"));
  course.capabilities = { dictionary: true };
  course.resources.staticRoot = {
    path: "apps/languages/czech/static"
  };
  for (const [name, relativePath] of Object.entries(resources)) {
    course.resources[name] = {
      path: `apps/languages/czech/static/${relativePath}`,
      ...(name === "dictionaryProvider" ? { revision: "provider-1" } : {})
    };
  }
  await writeFile(paths.courseManifestPath, JSON.stringify(course));

  const manifest = JSON.parse(await readFile(paths.manifestPath, "utf8"));
  manifest.offline.assets.push(
    ...Object.entries(resources).map(([name, relativePath]) => (
      name === "dictionaryProvider" ? `./${relativePath}?v=provider-1` : `./${relativePath}`
    ))
  );
  await writeFile(paths.manifestPath, JSON.stringify(manifest));
  return { ...paths, dictionaryResources: resources };
}

async function embeddingFixture(options = {}) {
  const paths = await fixture(options);
  const relativePath = "data/embeddings/catalog.json";
  const file = join(paths.languageStaticDir, relativePath);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify({ version: 1, models: [] }));

  const course = JSON.parse(await readFile(paths.courseManifestPath, "utf8"));
  course.capabilities = { embeddings: true };
  course.resources.embeddingCatalog = {
    path: `apps/languages/${paths.course.directoryName}/static/${relativePath}`
  };
  await writeFile(paths.courseManifestPath, JSON.stringify(course));

  const manifest = JSON.parse(await readFile(paths.manifestPath, "utf8"));
  manifest.offline.assets.push(relativePath);
  await writeFile(paths.manifestPath, JSON.stringify(manifest));
  return { ...paths, embeddingCatalogPath: relativePath };
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

test("refresh synchronizes shared runtime revisions from the canonical app entry", async (t) => {
  const paths = await fixture();
  t.after(() => rm(paths.workspaceRoot, { recursive: true, force: true }));
  const appEntryPath = join(paths.sharedRuntimeDir, "static/app/index.html");
  await writeFile(
    appEntryPath,
    '<script src="/language-runtime/static/source/shared-runtime.mjs?v=runtime-2"></script>\n'
  );

  const before = inspectSetupAssetManifest(paths);
  assert.deepEqual(before.offlineAssetChanges, [{
    index: 0,
    pathname: "/language-runtime/static/source/shared-runtime.mjs",
    previousUrl: "/language-runtime/static/source/shared-runtime.mjs?v=runtime-1",
    url: "/language-runtime/static/source/shared-runtime.mjs?v=runtime-2"
  }]);

  const previousManifest = await readFile(paths.manifestPath, "utf8");
  const checked = refreshSetupAssetManifest({ ...paths, check: true });
  assert.equal(checked.offlineAssetChanges.length, 1);
  assert.equal(await readFile(paths.manifestPath, "utf8"), previousManifest);

  refreshSetupAssetManifest(paths);
  const manifest = JSON.parse(await readFile(paths.manifestPath, "utf8"));
  assert.ok(manifest.offline.assets.includes(
    "/language-runtime/static/source/shared-runtime.mjs?v=runtime-2"
  ));
  assert.equal(inspectSetupAssetManifest(paths).offlineAssetChanges.length, 0);
});

test("canonical app entry rejects conflicting revisions for one shared runtime pathname", async (t) => {
  const paths = await fixture();
  t.after(() => rm(paths.workspaceRoot, { recursive: true, force: true }));
  await writeFile(
    join(paths.sharedRuntimeDir, "static/app/index.html"),
    '<script src="/language-runtime/static/source/shared-runtime.mjs?v=runtime-1"></script>\n' +
      '<script src="/language-runtime/static/source/shared-runtime.mjs?v=runtime-2"></script>\n'
  );

  assert.throws(
    () => inspectSetupAssetManifest(paths),
    /runtime graph references shared runtime pathname .* with conflicting URLs/u
  );
});

test("refresh follows revisioned dependencies through the trusted shared runtime graph", async (t) => {
  const paths = await fixture();
  t.after(() => rm(paths.workspaceRoot, { recursive: true, force: true }));
  const transitivePath = join(paths.sharedRuntimeDir, "static/source/transitive-runtime.js");
  await writeFile(
    join(paths.sharedRuntimeDir, "static/app/index.html"),
    '<script src="/language-runtime/static/source/shared-runtime.mjs?v=runtime-1"></script>\n'
  );
  await writeFile(
    join(paths.sharedRuntimeDir, "static/source/shared-runtime.mjs"),
    'await loadSharedScript("/language-runtime/static/source/transitive-runtime.js?v=transitive-2");\n'
  );
  await writeFile(transitivePath, "void 0;\n");

  const appAssetsPath = join(paths.sharedRuntimeDir, "app-assets.json");
  const appAssets = JSON.parse(await readFile(appAssetsPath, "utf8"));
  appAssets.assets.push({
    source: "apps/language-runtime/static/source/transitive-runtime.js",
    output: "language-runtime/static/source/transitive-runtime.js"
  });
  await writeFile(appAssetsPath, JSON.stringify(appAssets));

  const manifest = JSON.parse(await readFile(paths.manifestPath, "utf8"));
  manifest.offline.assets.push(
    "/language-runtime/static/source/transitive-runtime.js?v=transitive-1"
  );
  await writeFile(paths.manifestPath, JSON.stringify(manifest));

  const report = refreshSetupAssetManifest(paths);
  assert.deepEqual(report.offlineAssetChanges.map(({ pathname }) => pathname), [
    "/language-runtime/static/source/transitive-runtime.js"
  ]);
  const refreshed = JSON.parse(await readFile(paths.manifestPath, "utf8"));
  assert.ok(refreshed.offline.assets.includes(
    "/language-runtime/static/source/transitive-runtime.js?v=transitive-2"
  ));
});

test("refresh follows embedded shared-game HTML and its exact module graph", async (t) => {
  const paths = await fixture();
  t.after(() => rm(paths.workspaceRoot, { recursive: true, force: true }));
  const gameHtml = join(paths.sharedRuntimeDir, "static/games/example.html");
  const hostModule = join(paths.sharedRuntimeDir, "static/source/example-host.mjs");
  const coreModule = join(paths.sharedRuntimeDir, "static/source/example-core.mjs");
  await mkdir(dirname(gameHtml), { recursive: true });
  await writeFile(
    join(paths.sharedRuntimeDir, "static/app/index.html"),
    '<iframe data-src="/language-runtime/static/games/example.html"></iframe>\n'
  );
  await writeFile(
    gameHtml,
    '<script type="module" src="../source/example-host.mjs?v=host-2"></script>\n'
  );
  await writeFile(hostModule, 'import "./example-core.mjs?v=core-2";\n');
  await writeFile(coreModule, "export {};\n");

  const appAssetsPath = join(paths.sharedRuntimeDir, "app-assets.json");
  const appAssets = JSON.parse(await readFile(appAssetsPath, "utf8"));
  appAssets.assets.push(
    {
      source: "apps/language-runtime/static/games/example.html",
      output: "language-runtime/static/games/example.html"
    },
    {
      source: "apps/language-runtime/static/source/example-host.mjs",
      output: "language-runtime/static/source/example-host.mjs"
    },
    {
      source: "apps/language-runtime/static/source/example-core.mjs",
      output: "language-runtime/static/source/example-core.mjs"
    }
  );
  await writeFile(appAssetsPath, JSON.stringify(appAssets));

  const manifest = JSON.parse(await readFile(paths.manifestPath, "utf8"));
  manifest.offline.assets.push(
    "/language-runtime/static/games/example.html",
    "/language-runtime/static/source/example-host.mjs?v=host-1",
    "/language-runtime/static/source/example-core.mjs?v=core-1"
  );
  await writeFile(paths.manifestPath, JSON.stringify(manifest));

  const report = refreshSetupAssetManifest(paths);
  assert.deepEqual(
    report.offlineAssetChanges.map(({ pathname }) => pathname).sort(),
    [
      "/language-runtime/static/source/example-core.mjs",
      "/language-runtime/static/source/example-host.mjs"
    ]
  );
  const refreshed = JSON.parse(await readFile(paths.manifestPath, "utf8"));
  assert.ok(refreshed.offline.assets.includes(
    "/language-runtime/static/source/example-host.mjs?v=host-2"
  ));
  assert.ok(refreshed.offline.assets.includes(
    "/language-runtime/static/source/example-core.mjs?v=core-2"
  ));
});

test("unversioned app references do not strip an offline cache-busting query", async (t) => {
  const paths = await fixture();
  t.after(() => rm(paths.workspaceRoot, { recursive: true, force: true }));
  await writeFile(
    join(paths.sharedRuntimeDir, "static/app/index.html"),
    '<script src="/language-runtime/static/source/shared-runtime.mjs"></script>\n'
  );

  assert.equal(inspectSetupAssetManifest(paths).offlineAssetChanges.length, 0);
});

test("versioned app references must belong to the shared app asset catalog", async (t) => {
  const paths = await fixture();
  t.after(() => rm(paths.workspaceRoot, { recursive: true, force: true }));
  await writeFile(
    join(paths.sharedRuntimeDir, "static/app/index.html"),
    '<script src="/language-runtime/static/source/unpackaged.js?v=missing-1"></script>\n'
  );

  assert.throws(
    () => inspectSetupAssetManifest(paths),
    /versioned shared runtime pathname .* is absent from app-assets\.json/u
  );
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

test("retired course-specific grammar renderers cannot re-enter offline packages", async (t) => {
  for (const retiredAsset of [
    "./conjugation-comet.html",
    "./source/games/conjugation-comet/conjugation-comet.js",
    "./agreement-aurora.html",
    "./source/games/agreement-aurora/agreement-aurora.css",
    "./source/games/case-cosmos/launcher.css"
  ]) {
    const paths = await fixture();
    t.after(() => rm(paths.workspaceRoot, { recursive: true, force: true }));
    const manifest = JSON.parse(await readFile(paths.manifestPath, "utf8"));
    manifest.offline.assets.push(retiredAsset);
    await writeFile(paths.manifestPath, JSON.stringify(manifest));

    assert.throws(
      () => inspectSetupAssetManifest(paths),
      /Retired course-specific game renderer cannot be cached/u
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

test("browser setup catalogs close over shared runtime mappings by exact pathname", async (t) => {
  const missing = await fixture();
  const duplicate = await fixture();
  const remapped = await fixture();
  t.after(() => Promise.all([missing, duplicate, remapped].map(
    ({ workspaceRoot }) => rm(workspaceRoot, { recursive: true, force: true })
  )));

  const missingManifest = JSON.parse(await readFile(missing.manifestPath, "utf8"));
  missingManifest.offline.assets = [];
  await writeFile(missing.manifestPath, JSON.stringify(missingManifest));
  assert.throws(
    () => inspectSetupAssetManifest(missing),
    /omit shared runtime pathname \/language-runtime\/static\/source\/shared-runtime\.mjs/
  );

  const duplicateManifest = JSON.parse(await readFile(duplicate.manifestPath, "utf8"));
  duplicateManifest.offline.assets.push(
    "/language-runtime/static/source/shared-runtime.mjs?v=runtime-2"
  );
  await writeFile(duplicate.manifestPath, JSON.stringify(duplicateManifest));
  assert.throws(
    () => inspectSetupAssetManifest(duplicate),
    /repeat shared runtime pathname \/language-runtime\/static\/source\/shared-runtime\.mjs 2 times/
  );

  const appAssets = JSON.parse(
    await readFile(join(remapped.sharedRuntimeDir, "app-assets.json"), "utf8")
  );
  appAssets.assets[0].output = "language-runtime/static/source/renamed-runtime.mjs";
  await writeFile(join(remapped.sharedRuntimeDir, "app-assets.json"), JSON.stringify(appAssets));
  assert.throws(
    () => inspectSetupAssetManifest(remapped),
    /is remapped to language-runtime\/static\/source\/renamed-runtime\.mjs/
  );
});

test("catalog-derived refresh updates every browser course", async (t) => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "caatuu-all-setup-assets-"));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  const czech = await fixture({ workspaceRoot });
  const mandarin = await fixture({
    workspaceRoot,
    courseId: "zh",
    directoryName: "mandarin-simplified",
    routePrefix: "/zh"
  });
  const loadValidatedCatalog = async ({ repoRoot }) => {
    assert.equal(repoRoot, workspaceRoot);
    return { courses: [czech.record, mandarin.record] };
  };

  const reports = await refreshAllBrowserCourseSetupAssets({
    workspaceRoot,
    loadValidatedCatalog
  });

  assert.deepEqual(reports.map(({ courseId }) => courseId), ["cz", "zh"]);
  assert.equal(inspectSetupAssetManifest(czech).changes.length, 0);
  assert.equal(inspectSetupAssetManifest(mandarin).changes.length, 0);
});

test("catalog-derived refresh validates every browser course before writing any", async (t) => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "caatuu-all-setup-assets-"));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  const czech = await fixture({ workspaceRoot });
  const mandarin = await fixture({
    workspaceRoot,
    courseId: "zh",
    directoryName: "mandarin-simplified",
    routePrefix: "/zh"
  });
  const czechBefore = await readFile(czech.manifestPath, "utf8");
  const mandarinManifest = JSON.parse(await readFile(mandarin.manifestPath, "utf8"));
  mandarinManifest.offline.assets = [];
  await writeFile(mandarin.manifestPath, JSON.stringify(mandarinManifest));

  await assert.rejects(
    refreshAllBrowserCourseSetupAssets({
      workspaceRoot,
      loadValidatedCatalog: async () => ({ courses: [czech.record, mandarin.record] })
    }),
    /omit shared runtime pathname/
  );
  assert.equal(await readFile(czech.manifestPath, "utf8"), czechBefore);
});

test("catalog-derived refresh rejects a setup copied with another course cache prefix before writing", async (t) => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "caatuu-cache-prefix-"));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  const czech = await fixture({ workspaceRoot });
  const mandarin = await fixture({
    workspaceRoot,
    courseId: "zh",
    directoryName: "mandarin-simplified",
    routePrefix: "/zh"
  });
  const czechBefore = await readFile(czech.manifestPath, "utf8");
  const mandarinManifest = JSON.parse(await readFile(mandarin.manifestPath, "utf8"));
  mandarinManifest.offline.cachePrefix = czech.course.cache.prefix;
  mandarinManifest.offline.cacheName = `${czech.course.cache.prefix}v999`;
  await writeFile(mandarin.manifestPath, JSON.stringify(mandarinManifest));

  await assert.rejects(
    refreshAllBrowserCourseSetupAssets({
      workspaceRoot,
      loadValidatedCatalog: async () => ({ courses: [czech.record, mandarin.record] })
    }),
    (error) => (
      /offline\.cachePrefix/u.test(error.message)
      && /must exactly match course\.cache\.prefix/u.test(error.message)
      && /caatuu-mandarin-simplified-pwa-/u.test(error.message)
    )
  );
  assert.equal(await readFile(czech.manifestPath, "utf8"), czechBefore);
});

test("setup cache names stay inside the exact course prefix and use numeric revisions", async (t) => {
  for (const cacheName of ["caatuu-other-pwa-v1", "caatuu-czech-pwa-current"]) {
    const paths = await fixture();
    t.after(() => rm(paths.workspaceRoot, { recursive: true, force: true }));
    const manifest = JSON.parse(await readFile(paths.manifestPath, "utf8"));
    manifest.offline.cacheName = cacheName;
    await writeFile(paths.manifestPath, JSON.stringify(manifest));

    assert.throws(
      () => inspectSetupAssetManifest(paths),
      /offline\.cacheName .* must start with course\.cache\.prefix .* and end in a numeric -v revision/
    );
  }
});

test("dictionary offline coverage is exact for every required content boundary", async (t) => {
  const expectedAssets = [
    "./data/dictionaries/catalog.json",
    "./data/dictionaries/core.json",
    "./data/language/scripts.json",
    "./data/dictionaries/reference.html",
    "./source/features/dictionary/provider.js?v=provider-1"
  ];
  for (const missingAsset of expectedAssets) {
    const paths = await dictionaryFixture();
    t.after(() => rm(paths.workspaceRoot, { recursive: true, force: true }));
    const manifest = JSON.parse(await readFile(paths.manifestPath, "utf8"));
    manifest.offline.assets = manifest.offline.assets.filter((asset) => asset !== missingAsset);
    await writeFile(paths.manifestPath, JSON.stringify(manifest));

    assert.throws(
      () => inspectSetupAssetManifest(paths),
      (error) => (
        /Dictionary offline catalog must include/u.test(error.message)
        && error.message.includes(missingAsset.replace(/^\.\//u, ""))
      )
    );
  }
});

test("every browser course precaches its exact declared embedding catalog", async (t) => {
  for (const options of [
    {},
    { courseId: "zh", directoryName: "mandarin-simplified", routePrefix: "/zh" }
  ]) {
    for (const replacement of [null, "data/embeddings/catalog.json?v=stale-key"]) {
      const paths = await embeddingFixture(options);
      t.after(() => rm(paths.workspaceRoot, { recursive: true, force: true }));
      const manifest = JSON.parse(await readFile(paths.manifestPath, "utf8"));
      manifest.offline.assets = manifest.offline.assets.filter(
        (asset) => asset !== paths.embeddingCatalogPath
      );
      if (replacement) manifest.offline.assets.push(replacement);
      await writeFile(paths.manifestPath, JSON.stringify(manifest));

      assert.throws(
        () => inspectSetupAssetManifest(paths),
        /Embedding offline catalog must include the declared resource exactly once/u
      );
    }
  }
});

test("every enabled game precaches its exact revisioned course content", async (t) => {
  const paths = await fixture();
  t.after(() => rm(paths.workspaceRoot, { recursive: true, force: true }));

  const relativeCatalog = "data/games/conjugation-comet/verbs.json";
  const catalogFile = join(paths.languageStaticDir, relativeCatalog);
  await mkdir(dirname(catalogFile), { recursive: true });
  await writeFile(catalogFile, JSON.stringify({ schemaVersion: 1, verbs: [] }));

  const course = JSON.parse(await readFile(paths.courseManifestPath, "utf8"));
  course.games = ["conjugation-comet"];
  course.routes.conjugationComet = "/language-runtime/static/games/conjugation-comet.html";
  course.resources.conjugationCometCatalog = {
    path: `apps/languages/${paths.course.directoryName}/static/${relativeCatalog}`,
    revision: "verbs-1"
  };
  await writeFile(paths.courseManifestPath, JSON.stringify(course));

  assert.throws(
    () => inspectSetupAssetManifest(paths),
    /omit the exact conjugation-comet\.conjugationCometCatalog URL .*verbs\.json\?v=verbs-1/u
  );

  const setup = JSON.parse(await readFile(paths.manifestPath, "utf8"));
  setup.offline.assets.push(`${relativeCatalog}?v=stale`);
  await writeFile(paths.manifestPath, JSON.stringify(setup));
  assert.throws(
    () => inspectSetupAssetManifest(paths),
    /verbs\.json\?v=verbs-1/u
  );

  setup.offline.assets[setup.offline.assets.length - 1] = `${relativeCatalog}?v=verbs-1`;
  await writeFile(paths.manifestPath, JSON.stringify(setup));
  assert.doesNotThrow(() => inspectSetupAssetManifest(paths));
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
