import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  assertDeclaredPagesLanguageCoverage,
  disabledCourseSetupSurface,
  omitDisabledCourseSetupSurfaces,
  retiredCzechDatabasePath,
  unreferencedDuplicateSetupPaths,
  compilePagesSite,
  deriveCoursePagesCacheName,
  enablePagesDurableBypassInCourseWorker,
  enableReportingSurfaces,
  rewriteServiceWorker,
  enableStableAndroidCourseProfile,
  projectPagesCourseProfileSource,
  projectPagesLanguageRegistry,
  projectPagesLauncherFallback,
  projectStableAndroidChannels,
  retainPagesManagedCourseOfflineAssets,
  rewritePagesCourseProfileReceipt,
  rewriteFinalCourseSetup,
  stagePagesBrowserCourses,
  transformPagesSentenceReporting,
  validatePagesSite,
  validatePagesArtwork,
} from "../build-pages-site.mjs";
import { serviceWorkerSource } from "../build-static-site.mjs";
import { evaluateCourseProfile, serializeCourseProfileSource } from "../../../../tools/language-packs/lib/course-contract.mjs";

const testDir = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(testDir, "../../../..");
const source = readFileSync(join(testDir, "../build-pages-site.mjs"), "utf8");

test("renamed current artwork preserves the baseline URL and validates both byte identities", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "caatuu-pages-artwork-test-"));
  try {
    const manifest = JSON.parse(readFileSync(join(workspaceRoot, "apps/launcher/static/assets/browser-assets.json"), "utf8"));
    const current = manifest.artifacts.find(artifact => artifact.key === "planet-agreement-aurora");
    const baseline = JSON.parse(readFileSync(join(workspaceRoot, "apps/android/tooling/pages-baseline.json"), "utf8"));
    const historical = baseline.sourceOverrides.find(artifact => artifact.key === "legacy-agreement-aurora");
    const oldBytes = Buffer.from("distinct preserved historical fixture");
    const descriptor = { sourceOverrides: [{ ...historical, bytes: oldBytes.length,
      sha256: createHash("sha256").update(oldBytes).digest("hex") }] };
    const legacyPath = join(temporaryDirectory, historical.publicPath);
    const currentPath = join(temporaryDirectory, `assets/planets/releases/${current.sha256.slice(0, 16)}/agreement-aurora.png`);
    mkdirSync(dirname(legacyPath), { recursive: true });
    mkdirSync(dirname(currentPath), { recursive: true });
    const currentBytes = readFileSync(join(workspaceRoot, "apps/launcher/static", current.asset_path));
    writeFileSync(legacyPath, oldBytes);
    writeFileSync(currentPath, currentBytes);
    const check = () => validatePagesArtwork({ workspaceRoot, siteDir: temporaryDirectory, baselineDescriptor: descriptor });
    assert.equal(check().assetPath, current.asset_path);
    const corruptOld = Buffer.from(oldBytes);
    corruptOld[0] ^= 1;
    writeFileSync(legacyPath, corruptOld);
    assert.throws(check, /Expected values/u, "historical bytes must retain their pinned hash");
    writeFileSync(legacyPath, oldBytes);
    const corruptCurrent = Buffer.from(currentBytes);
    corruptCurrent[0] ^= 1;
    writeFileSync(currentPath, corruptCurrent);
    assert.throws(check, /Expected values/u, "current artwork must also match its source receipt");
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("Pages reporting shows retry copy only for an explicitly authorized remote queue", () => {
  const wordWorld = readFileSync(join(workspaceRoot, "apps/language-runtime/static/source/product-word-world.mjs"), "utf8");
  const transformed = transformPagesSentenceReporting(wordWorld);
  assert.match(transformed, /queued\.localOnly === false && queued\.authorized === true/u);
  const syntax = spawnSync(process.execPath, ["--input-type=module", "--check"], { input: transformed, encoding: "utf8" });
  assert.equal(syntax.status, 0, syntax.stderr);
  const expression = transformPagesSentenceReporting('interfaceText("wordworld.report.savedlocal")');
  const render = new Function("queued", "interfaceText", `return ${expression};`);
  assert.equal(render({ localOnly: false, authorized: true }, id => id), "reporting.sentence.saved");
  for (const queue of [{ localOnly: true }, {}, { localOnly: false, authorized: false }]) {
    assert.equal(render(queue, id => id), "wordworld.report.savedlocal");
  }
  assert.throws(() => transformPagesSentenceReporting("changed boundary"), /anchor count/u);
});

test("the Pages builder exposes compilation and validation without running on import", () => {
  assert.equal(typeof compilePagesSite, "function");
  assert.equal(typeof validatePagesSite, "function");
  assert.match(source, /process\.argv\[1\].*resolve\(scriptPath\)/u);
});

test("the Pages builder accepts one frozen baseline plus every validated release overlay", () => {
  assert.match(source, /Exactly one of baselineDir or baselineArchive is required/u);
  assert.match(source, /extractPagesBaselineArchive/u);
  assert.match(source, /--baseline-archive/u);
  assert.match(source, /loadPagesCurrentRelease/u);
  assert.match(source, /overlayAndroidReleases/u);
  assert.match(source, /for \(const loaded of currentRelease\.releases\)/u);
  assert.match(source, /currentDescriptor\.releases\.slice\(0, -1\)/u);
  assert.match(source, /currentReleaseDescriptorPath/u);
  assert.match(source, /stagePagesBrowserCourses/u);
  assert.match(source, /for \(const course of languagePlan\.browserCourses\)/u);
  assert.doesNotMatch(source, /compileProductAssetBundle|overlayMandarinWebProduct/u);
  assert.match(source, /prepared\?\.cleanup\(\)/u);
});

test("the Pages builder keeps every Android release exact and outside service-worker handling", () => {
  assert.match(source, /retainedAndroidChannels/u);
  assert.match(source, /"\/android\/"/u);
  assert.match(source, /isDurableReleasePath\(url\.pathname\)/u);
  assert.match(source, /isDurableReleasePublicPath/u);
  assert.match(source, /androidPublicPaths/u);
  assert.match(source, /headers\\\.has/u);
  assert.match(source, /releaseSetupPaths/u);
  assert.match(source, /validateCurrentAndroidSetupClosure/u);
  assert.match(source, /validateFinalWebSetup/u);
  assert.match(source, /Pages bundle and service worker disagree about the cache name/u);
});

test("Pages preserves course APK minimums while offering only the declared stable channel", () => {
  const catalog = JSON.parse(readFileSync(join(workspaceRoot, "apps/languages/catalog.json"), "utf8"));
  for (const entry of catalog.courses) {
    const course = JSON.parse(readFileSync(join(workspaceRoot, entry.manifest), "utf8"));
    if (!course.platforms.android.enabled) continue;
    const expected = course.platforms.android.channels.filter(({ kind }) => kind === "release");
    assert.deepEqual(projectStableAndroidChannels(course.platforms.android), expected, course.id);
    const laterCourse = structuredClone(course.platforms.android);
    laterCourse.channels.find(({ kind }) => kind === "release").minimumVersionCode += 100;
    assert.equal(projectStableAndroidChannels(laterCourse)[0].minimumVersionCode, expected[0].minimumVersionCode + 100);
  }
  assert.throws(() => projectStableAndroidChannels({ channels: [] }), /one declared stable channel/u);
});

test("the Pages profile rewrite preserves every course APK minimum and removes preview channels", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "caatuu-pages-profile-test-"));
  const profilePath = join(temporaryDirectory, "course-profile.js");
  try {
    const catalog = JSON.parse(readFileSync(join(workspaceRoot, "apps/languages/catalog.json"), "utf8"));
    for (const entry of catalog.courses) {
      const course = JSON.parse(readFileSync(join(workspaceRoot, entry.manifest), "utf8"));
      if (!course.platforms.android.enabled) continue;
      writeFileSync(profilePath, readFileSync(join(workspaceRoot, course.resources.courseProfile.path), "utf8"));
      enableStableAndroidCourseProfile(profilePath, `${course.id} test profile`);
      const source = readFileSync(profilePath, "utf8");
      const profile = evaluateCourseProfile(source, `${course.id} projected profile`);
      assert.deepEqual(JSON.parse(JSON.stringify(profile.platforms.android)), {
        enabled: true,
        channels: course.platforms.android.channels.filter(({ kind }) => kind === "release"),
      });
      assert.doesNotMatch(source, /"kind": "preview"|caatuu-preview/u);
      const browserProfile = JSON.parse(JSON.stringify(profile));
      browserProfile.platforms.android = { enabled: false, channels: [] };
      writeFileSync(profilePath, serializeCourseProfileSource(browserProfile));
      enableStableAndroidCourseProfile(profilePath, `${course.id} browser-only core`, course.platforms.android);
      const restored = evaluateCourseProfile(readFileSync(profilePath, "utf8"), `${course.id} restored profile`);
      assert.deepEqual(JSON.parse(JSON.stringify(restored.platforms.android.channels)),
        course.platforms.android.channels.filter(({ kind }) => kind === "release"));
    }
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("Pages retains every supported course and its preview status in registry, fallback, and selectors", async () => {
  const languagePlan = await assertDeclaredPagesLanguageCoverage({ workspaceRoot });
  const localRegistry = JSON.parse(readFileSync(join(testDir, "../../static/languages.json"), "utf8"));
  const catalog = JSON.parse(readFileSync(join(workspaceRoot, "apps/languages/catalog.json"), "utf8"));
  const pagesIds = new Set(catalog.courses.filter(({ manifest }) => {
    const course = JSON.parse(readFileSync(join(workspaceRoot, manifest), "utf8"));
    return course.platforms.browser.enabled && course.platforms.browser.pagesEnabled !== false;
  }).map(({ id }) => id));
  const expectedCourses = localRegistry.browserSetup.courses.filter(({ id }) => pagesIds.has(id));
  const expectedIds = expectedCourses.map(({ id }) => id);
  const expectedStatuses = expectedCourses.map(({ id, status }) => ({ id, status }));
  assert.deepEqual(languagePlan.browserCourses.map(({ id }) => id), expectedIds);
  const projectedRegistry = projectPagesLanguageRegistry({ registry: localRegistry, languagePlan });
  assert.deepEqual(projectedRegistry.browserSetup.courses.map(({ id, status }) => ({ id, status })), expectedStatuses);
  assert.deepEqual(projectedRegistry.languages.map(({ id, status }) => ({ id, status })), expectedStatuses);
  assert.equal(localRegistry.browserSetup.courses.length, catalog.courses.length, "projection must preserve the local catalog");

  const localLauncher = readFileSync(join(testDir, "../../static/index.html"), "utf8");
  const projectedLauncher = projectPagesLauncherFallback({ source: localLauncher, languagePlan });
  assert.deepEqual([...projectedLauncher.matchAll(/data-language-id="([^"]+)"/gu)].map(match => match[1]), expectedIds);

  for (const course of languagePlan.browserCourses) {
    const localProfile = readFileSync(join(workspaceRoot, course.profileRepositoryPath), "utf8");
    const projectedProfile = projectPagesCourseProfileSource({
      source: localProfile,
      languagePlan,
      courseId: course.id,
      label: `${course.id} test profile`,
    });
    const profile = evaluateCourseProfile(projectedProfile, `${course.id} projected test profile`);
    assert.deepEqual(Array.from(profile.courseSelector.courses, ({ id, status }) => ({ id, status })), expectedStatuses);
  }
});

test("Pages filters explicitly withheld courses without dropping a published development preview", () => {
  const registry = {
    browserSetup: { schemaVersion: 1, courses: [
      { id: "baseline", status: "active" },
      { id: "preview", status: "development" },
      { id: "withheld", status: "development" },
    ] },
    languages: [
      { id: "baseline", status: "active" },
      { id: "preview", status: "development" },
      { id: "withheld", status: "development" },
    ],
  };
  const languagePlan = {
    defaultCourse: { entryPath: "/baseline/index.html" },
    browserCourses: registry.browserSetup.courses.slice(0, 2),
  };
  const projected = projectPagesLanguageRegistry({ registry, languagePlan });
  for (const records of [projected.languages, projected.browserSetup.courses]) {
    assert.deepEqual(records, languagePlan.browserCourses);
  }
  assert.equal(registry.languages.length, 3, "projection must not change the local catalog");
});

test("Pages adds and refreshes a staged-only profile receipt for the legacy default setup", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "caatuu-pages-default-profile-receipt-"));
  const siteDir = join(temporaryDirectory, "site");
  const course = {
    id: "cz",
    publicRoute: "/cz/",
    entryPath: "/cz/index.html",
    setupPath: "/cz/setup-assets.json",
    profilePath: "/cz/source/shared/course-profile.js",
    profileRelativePath: "source/shared/course-profile.js",
  };
  try {
    mkdirSync(join(siteDir, "cz/source/shared"), { recursive: true });
    writeFileSync(join(siteDir, "cz/index.html"), "<main>Czech</main>\n");
    writeFileSync(join(siteDir, "cz/source/shared/course-profile.js"), "first profile\n");
    writeFileSync(join(siteDir, "cz/setup-assets.json"), JSON.stringify({
      version: 1,
      cache_name: "caatuu-czech-setup-v1",
      artifacts: [],
    }));

    rewritePagesCourseProfileReceipt({
      course,
      siteDir,
      canonicalOrigin: "https://caatuu.waajacu.com",
    });
    const first = JSON.parse(readFileSync(join(siteDir, "cz/setup-assets.json"), "utf8"));
    assert.equal(first.artifacts.length, 1);
    assert.deepEqual(
      {
        key: first.artifacts[0].key,
        url: first.artifacts[0].url,
        asset_path: first.artifacts[0].asset_path,
        browser_required: first.artifacts[0].browser_required,
        native_required: first.artifacts[0].native_required,
        bytes: first.artifacts[0].bytes,
      },
      {
        key: "course-profile",
        url: course.profilePath,
        asset_path: course.profileRelativePath,
        browser_required: true,
        native_required: false,
        bytes: 14,
      },
    );
    assert.match(first.artifacts[0].sha256, /^[a-f0-9]{64}$/u);

    writeFileSync(join(siteDir, "cz/source/shared/course-profile.js"), "second, longer profile\n");
    rewritePagesCourseProfileReceipt({
      course,
      siteDir,
      canonicalOrigin: "https://caatuu.waajacu.com",
    });
    const second = JSON.parse(readFileSync(join(siteDir, "cz/setup-assets.json"), "utf8"));
    assert.equal(second.artifacts.length, 1);
    assert.equal(second.artifacts[0].bytes, 23);
    assert.notEqual(second.artifacts[0].sha256, first.artifacts[0].sha256);
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("the Pages builder derives browser course staging and final setup rewrites from the language plan", () => {
  assert.match(source, /legacy-agreement-aurora/u);
  assert.match(source, /currentAgreement\.versionedPath/u);
  assert.match(source, /stagePagesBrowserCourses/u);
  assert.match(source, /rewriteFinalCourseSetup/u);
  assert.match(source, /browserRequiredArtifact/u);
  assert.match(source, /setup\.artifacts\.filter\(browserRequiredArtifact\)/u);
  assert.match(source, /course\.setupRepositoryPath/u);
  assert.match(source, /course\.staticRootPath/u);
  assert.match(source, /for \(const course of languagePlan\.browserCourses\)/u);
  assert.doesNotMatch(source, /mandarin|Mandarin|"\/zh\/", "\/zh\/index\.html"/u);
});

test("a non-Czech default stages without a Czech course or pre-existing default entry", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "caatuu-pages-third-course-test-"));
  const fixtureWorkspace = join(temporaryDirectory, "workspace");
  const siteDir = join(temporaryDirectory, "site");
  const staticRoot = join(fixtureWorkspace, "apps/languages/fixture-language/static");
  const setupPath = join(staticRoot, "setup-assets.json");
  const canonicalOrigin = "https://caatuu.waajacu.com";
  const course = {
    id: "xy",
    status: "development",
    directoryName: "fixture-language",
    manifestPath: "apps/languages/fixture-language/course.json",
    staticRootPath: "apps/languages/fixture-language/static",
    setupRepositoryPath: "apps/languages/fixture-language/static/setup-assets.json",
    setupRelativePath: "setup-assets.json",
    routePrefix: "/learn-xy",
    publicRoute: "/learn-xy/",
    entryPath: "/learn-xy/index.html",
    setupPath: "/learn-xy/setup-assets.json",
    profilePath: "/learn-xy/source/shared/course-profile.js",
    profileRelativePath: "source/shared/course-profile.js",
    androidEnabled: false,
  };
  const setup = {
    schemaVersion: "fixture-v1",
    courseId: course.id,
    application: { entryPath: course.entryPath },
    offline: {
      cacheName: "caatuu-xy-pwa-v1",
      cachePrefix: "caatuu-xy-pwa-",
      assets: ["offline-only.txt?v=1", "/language-runtime/static/source/course-service-worker.js"],
    },
    artifacts: [
      {
        key: "course-profile",
        url: "/learn-xy/source/shared/course-profile.js",
        browserRequired: true,
        bytes: 1,
        sha256: "0".repeat(64),
      },
      {
        key: "course-service-worker",
        url: "/learn-xy/sw.js",
        browserRequired: true,
        bytes: 1,
        sha256: "0".repeat(64),
      },
    ],
  };
  const languagePlan = {
    defaultCourseId: course.id,
    defaultCourse: course,
    browserCourses: [course],
  };
  try {
    for (const directory of [
      siteDir,
      join(fixtureWorkspace, "apps/language-runtime/static/app"),
      join(staticRoot, "source/shared"),
      join(fixtureWorkspace, "apps/language-runtime/static/source"),
    ]) mkdirSync(directory, { recursive: true });
    writeFileSync(join(fixtureWorkspace, "apps/language-runtime/static/app/index.html"),
      readFileSync(join(workspaceRoot, "apps/language-runtime/static/app/index.html")));
    writeFileSync(join(fixtureWorkspace, course.manifestPath), JSON.stringify({ id: course.id, resources: {} }));
    writeFileSync(join(staticRoot, "source/shared/course-profile.js"), "globalThis.fixtureCourse = true;\n");
    writeFileSync(join(staticRoot, "offline-only.txt"), "fixture offline bytes\n");
    writeFileSync(join(staticRoot, "sw.js"), '// Offline catalog revision: caatuu-xy-pwa-v1\nself.CAATUU_OFFLINE_CACHE_NAME = "caatuu-xy-pwa-v1";\n');
    writeFileSync(
      join(fixtureWorkspace, "apps/language-runtime/static/source/course-service-worker.js"),
      "globalThis.fixtureSharedWorker = true;\n",
    );
    writeFileSync(setupPath, JSON.stringify(setup));

    assert.deepEqual(
      stagePagesBrowserCourses({
        workspaceRoot: fixtureWorkspace,
        siteDir,
        canonicalOrigin,
        languagePlan,
      }),
      [{
        id: "xy",
        browserArtifactCount: 2,
        offlineAssetCount: 2,
        deferredReleaseAssetCount: 0,
      }],
    );
    assert.ok(readFileSync(join(siteDir, "learn-xy/index.html"), "utf8").includes("app-bootstrap.mjs"));
    assert.equal(existsSync(join(siteDir, "cz")), false);
    assert.equal(existsSync(join(fixtureWorkspace, "apps/languages/czech")), false);
    for (const path of [
      "learn-xy/setup-assets.json",
      "learn-xy/source/shared/course-profile.js",
      "learn-xy/offline-only.txt",
      "learn-xy/sw.js",
      "language-runtime/static/source/course-service-worker.js",
    ]) assert.ok(existsSync(join(siteDir, path)), `third-course staging omitted ${path}`);

    rmSync(join(siteDir, "learn-xy"), { recursive: true, force: true });
    const escapedCourseDirectory = join(temporaryDirectory, "escaped-course-source");
    mkdirSync(escapedCourseDirectory, { recursive: true });
    writeFileSync(join(escapedCourseDirectory, "escape.txt"), "not course-owned\n");
    symlinkSync(escapedCourseDirectory, join(staticRoot, "linked-course-source"), "dir");
    setup.offline.assets = [
      "linked-course-source/escape.txt",
      "/language-runtime/static/source/course-service-worker.js",
    ];
    writeFileSync(setupPath, JSON.stringify(setup));
    assert.throws(
      () => stagePagesBrowserCourses({
        workspaceRoot: fixtureWorkspace,
        siteDir,
        canonicalOrigin,
        languagePlan,
      }),
      /browser source .* does not resolve to its declared physical path/u,
    );

    rmSync(join(siteDir, "learn-xy"), { recursive: true, force: true });
    const escapedSharedDirectory = join(temporaryDirectory, "escaped-shared-source");
    const sharedAlias = join(
      fixtureWorkspace,
      "apps/language-runtime/static/source/linked-shared-source",
    );
    mkdirSync(escapedSharedDirectory, { recursive: true });
    writeFileSync(join(escapedSharedDirectory, "escape.js"), "globalThis.escape = true;\n");
    symlinkSync(escapedSharedDirectory, sharedAlias, "dir");
    setup.offline.assets = [
      "/language-runtime/static/source/linked-shared-source/escape.js",
      "/language-runtime/static/source/course-service-worker.js",
    ];
    writeFileSync(setupPath, JSON.stringify(setup));
    assert.throws(
      () => stagePagesBrowserCourses({
        workspaceRoot: fixtureWorkspace,
        siteDir,
        canonicalOrigin,
        languagePlan,
      }),
      /shared browser source .* does not resolve to its declared physical path/u,
    );

    rmSync(join(siteDir, "learn-xy"), { recursive: true, force: true });
    setup.offline.assets = [
      "offline-only.txt?v=1",
      "/language-runtime/static/source/course-service-worker.js",
    ];
    setup.offline.assets.push("missing-non-durable.txt");
    writeFileSync(setupPath, JSON.stringify(setup));
    assert.throws(
      () => stagePagesBrowserCourses({
        workspaceRoot: fixtureWorkspace,
        siteDir,
        canonicalOrigin,
        languagePlan,
      }),
      /xy setup is missing a non-durable browser asset: learn-xy\/missing-non-durable\.txt/u,
    );
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("each planned course cache revision covers offline-only bytes and excludes durable assets", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "caatuu-pages-course-cache-test-"));
  const siteDir = join(temporaryDirectory, "site");
  const workerSource = '"use strict";\n\n// Offline catalog revision: caatuu-zh-hans-pwa-v1\nself.CAATUU_OFFLINE_CACHE_NAME = "caatuu-zh-hans-pwa-v1";\n';
  const course = {
    id: "zh",
    publicRoute: "/zh/",
    entryPath: "/zh/index.html",
    setupPath: "/zh/setup-assets.json",
  };
  const manifest = {
    schemaVersion: "fixture-v1",
    courseId: "zh",
    application: { entryPath: "/zh/index.html" },
    offline: {
      cacheName: "caatuu-zh-hans-pwa-v1",
      cachePrefix: "caatuu-zh-hans-pwa-",
      assets: ["offline-only.txt?v=1", "/language-runtime/vendor/transformers/transformers.min.js"],
    },
    artifacts: [
      {
        key: "course-service-worker",
        url: "/zh/sw.js",
        browserRequired: true,
        bytes: 1,
        sha256: "0".repeat(64),
      },
    ],
  };
  try {
    for (const directory of [
      join(siteDir, "zh"),
      join(siteDir, "language-runtime/static/source"),
    ]) mkdirSync(directory, { recursive: true });
    writeFileSync(join(siteDir, "zh/index.html"), "<main>Mandarin</main>\n");
    writeFileSync(join(siteDir, "zh/offline-only.txt"), "first\n");
    writeFileSync(join(siteDir, "zh/sw.js"), workerSource);
    writeFileSync(join(siteDir, "language-runtime/static/source/course-service-worker.js"), "shared worker\n");

    const filtered = retainPagesManagedCourseOfflineAssets({
      course,
      manifest,
      canonicalOrigin: "https://caatuu.waajacu.com",
    });
    assert.deepEqual(filtered, { retainedCount: 1, removedDurableCount: 1 });
    assert.deepEqual(manifest.offline.assets, ["offline-only.txt?v=1"]);
    const options = {
      course,
      siteDir,
      canonicalOrigin: "https://caatuu.waajacu.com",
      manifest,
      localWorkerSource: workerSource,
    };
    const first = deriveCoursePagesCacheName(options);
    // Published revisions must update both the catalog and executable loader.
    course.profilePath = "/zh/course-profile.js";
    course.profileRelativePath = "course-profile.js";
    manifest.courseId = "zh";
    writeFileSync(join(siteDir, "zh/course-profile.js"), "globalThis.fixtureCourse = true;\n");
    writeFileSync(join(siteDir, "zh/setup-assets.json"), JSON.stringify(manifest));
    const rewritten = rewriteFinalCourseSetup({ course, siteDir, canonicalOrigin: options.canonicalOrigin });
    const publishedWorker = readFileSync(join(siteDir, "zh/sw.js"), "utf8");
    assert.ok(publishedWorker.includes(`self.CAATUU_OFFLINE_CACHE_NAME = "${rewritten.cacheName}";`));
    assert.equal(rewriteFinalCourseSetup({ course, siteDir, canonicalOrigin: options.canonicalOrigin }).cacheName, rewritten.cacheName);
    assert.equal(deriveCoursePagesCacheName(options), first);
    writeFileSync(join(siteDir, "zh/offline-only.txt"), "second\n");
    const changedBytes = deriveCoursePagesCacheName(options);
    assert.notEqual(changedBytes, first);
    manifest.schemaVersion = "fixture-v2";
    assert.notEqual(deriveCoursePagesCacheName(options), changedBytes);
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("baseline-owned public artwork keeps its historical bytes", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "caatuu-pages-baseline-art-test-"));
  const siteDir = join(temporaryDirectory, "site");
  const baselineSite = join(temporaryDirectory, "baseline");
  const workerSource = '"use strict";\n\n// Offline catalog revision: caatuu-cz-pwa-v1\nself.CAATUU_OFFLINE_CACHE_NAME = "caatuu-cz-pwa-v1";\n';
  const course = {
    id: "cz",
    publicRoute: "/cz/",
    entryPath: "/cz/index.html",
    setupPath: "/cz/setup-assets.json",
    profilePath: "/cz/course-profile.js",
    profileRelativePath: "course-profile.js",
  };
  const historical = "historical-planet";
  const manifest = {
    schemaVersion: "fixture-v1",
    courseId: "cz",
    application: { entryPath: "/cz/index.html" },
    offline: {
      cacheName: "caatuu-cz-pwa-v1",
      cachePrefix: "caatuu-cz-pwa-",
      assets: ["/assets/planets/conjugation-comet.png"],
    },
    artifacts: [
      {
        key: "course-service-worker",
        url: "/cz/sw.js",
        browser_required: true,
        native_required: false,
        bytes: 1,
        sha256: "0".repeat(64),
      },
      {
        key: "planet-conjugation",
        url: "/assets/planets/conjugation-comet.png",
        browser_required: true,
        native_required: true,
        bytes: 11,
        sha256: "b".repeat(64),
      },
    ],
  };
  try {
    mkdirSync(join(siteDir, "cz"), { recursive: true });
    mkdirSync(join(siteDir, "assets/planets"), { recursive: true });
    mkdirSync(join(siteDir, "language-runtime/static/source"), { recursive: true });
    mkdirSync(join(baselineSite, "assets/planets"), { recursive: true });
    writeFileSync(join(siteDir, "cz/index.html"), "<main>Czech</main>\n");
    writeFileSync(join(siteDir, "cz/course-profile.js"), "globalThis.fixtureCourse = true;\n");
    writeFileSync(join(siteDir, "cz/sw.js"), workerSource);
    writeFileSync(join(siteDir, "language-runtime/static/source/course-service-worker.js"), "shared worker\n");
    writeFileSync(join(siteDir, "assets/planets/conjugation-comet.png"), historical);
    writeFileSync(join(baselineSite, "assets/planets/conjugation-comet.png"), historical);
    writeFileSync(join(siteDir, "cz/setup-assets.json"), JSON.stringify(manifest));
    const rewritten = rewriteFinalCourseSetup({
      course,
      siteDir,
      canonicalOrigin: "https://caatuu.waajacu.com",
      baselineSite,
    });
    const artwork = rewritten.manifest.artifacts.find((artifact) => artifact.key === "planet-conjugation");
    assert.equal(artwork.native_required, false);
    assert.equal(artwork.bytes, historical.length);
    assert.equal(readFileSync(join(siteDir, "assets/planets/conjugation-comet.png"), "utf8"), historical);
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("the published course worker bypasses durable release paths idempotently", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "caatuu-pages-course-worker-test-"));
  const workerPath = join(temporaryDirectory, "course-service-worker.js");
  try {
    writeFileSync(
      workerPath,
      readFileSync(join(testDir, "../../../language-runtime/static/source/course-service-worker.js"), "utf8"),
    );
    enablePagesDurableBypassInCourseWorker(workerPath);
    const first = readFileSync(workerPath, "utf8");
    assert.match(first, /const CAATUU_DURABLE_RELEASE_PREFIXES/u);
    assert.match(first, /if \(isDurableReleasePath\(url\.pathname\)\) return fetch\(request\);/u);
    assert.match(first, /Durable release assets cannot be precached/u);
    enablePagesDurableBypassInCourseWorker(workerPath);
    assert.equal(readFileSync(workerPath, "utf8"), first);
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("the Pages bundle declares course-scoped reporting and excludes the standalone preview game", () => {
  assert.match(source, /buildReportingCourseCatalog/u);
  assert.match(source, /reporting-courses\.v2\.json/u);
  assert.doesNotMatch(transformPagesSentenceReporting('interfaceText("wordworld.report.savedlocal")'), /course\.id/u);
  assert.match(source, /standaloneGamePrefix/u);
  assert.match(source, /local-preview-only standalone Caatuu Game/u);
  assert.match(source, /assert\.doesNotMatch\(rootIndex/u);
});

test("canonical validation rejects invalid browser-only course content before output mutation", async () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "caatuu-pages-invalid-browser-test-"));
  const fixtureWorkspace = join(temporaryDirectory, "workspace");
  const outputDir = join(fixtureWorkspace, "artifacts/web/test-pages-output");
  const catalog = JSON.parse(readFileSync(join(workspaceRoot, "apps/languages/catalog.json"), "utf8"));
  const czechEntry = catalog.courses.find(({ id }) => id === "cz");
  const course = JSON.parse(readFileSync(join(workspaceRoot, czechEntry.manifest), "utf8"));
  catalog.courses = [czechEntry];
  course.platforms.android = { enabled: false, channels: [] };
  course.platforms.browser.entryPath = "/cz/not-the-shared-entry.html";
  try {
    mkdirSync(join(fixtureWorkspace, "apps/languages/czech/static"), { recursive: true });
    writeFileSync(join(fixtureWorkspace, "apps/languages/catalog.json"), JSON.stringify(catalog));
    writeFileSync(join(fixtureWorkspace, czechEntry.manifest), JSON.stringify(course));
    writeFileSync(join(fixtureWorkspace, "apps/languages/czech/static/setup-assets.json"), "{}");
    await assert.rejects(
      compilePagesSite({
        workspaceRoot: fixtureWorkspace,
        outputDir,
        baselineDir: join(fixtureWorkspace, "unused-baseline"),
      }),
      /browser entryPath must equal the course entryPath|browser entry path disagrees/u,
    );
    assert.equal(existsSync(outputDir), false, "invalid browser content created the Pages output directory");
    assert.equal(
      existsSync(join(fixtureWorkspace, "artifacts/web")),
      false,
      "invalid browser content mutated the Pages output parent",
    );
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("the canonical Pages preflight validates generated views", async () => {
  assert.equal((await assertDeclaredPagesLanguageCoverage({ workspaceRoot })).defaultCourseId, "cz");
  assert.match(source, /await loadAndValidateCourseCatalog/u);
  assert.match(source, /await checkGeneratedViews\(validated\)/u);
});

test("the Pages builder stages and validates before replacing generated output", () => {
  const compileStart = source.indexOf("export async function compilePagesSite({");
  const catalogPreflight = source.indexOf("await assertDeclaredPagesLanguageCoverage({ workspaceRoot: workspace });", compileStart);
  const firstOutputMutation = source.indexOf("mkdirSync(dirname(output)", compileStart);
  const courseStaging = source.indexOf("stagePagesBrowserCourses({", compileStart);
  const baselinePreparation = source.indexOf("prepared = prepareBaseline({", compileStart);
  const validation = source.indexOf("const staged = validatePreparedPagesSite({", compileStart);
  const replacement = source.indexOf("replaceGeneratedOutput(stagingDir, output, workspace);", compileStart);
  assert.ok(compileStart >= 0);
  assert.ok(catalogPreflight > compileStart);
  assert.ok(firstOutputMutation > catalogPreflight);
  assert.ok(courseStaging > firstOutputMutation);
  assert.ok(baselinePreparation > courseStaging);
  assert.ok(validation >= 0);
  assert.ok(replacement > validation);
  assert.match(source, /Pages staging output already exists/u);
  assert.match(source, /Refusing to replace output without the Pages sentinel/u);
});

test("Spanish-only reporting installs and precaches shared delivery without Czech files", () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "caatuu-reporting-spanish-"));
  const fixtureWorkspace = join(temporaryRoot, "workspace");
  const siteDir = join(temporaryRoot, "site");
  const shared = "language-runtime/static/source";
  const course = { id: "es", routePrefix: "/es", publicRoute: "/es/",
    entryPath: "/es/index.html", setupPath: "/es/setup-assets.json" };
  const languagePlan = { defaultCourseId: "es", defaultCourse: course, browserCourses: [course] };
  const setup = { courseId: "es", artifacts: [] };
  const channel = { manifest: { publicPaths: ["/android/review.json"] }, apk: { publicPaths: ["/android/review.apk"] } };
  try {
    for (const directory of [join(fixtureWorkspace, "apps/languages/spanish"), join(siteDir, shared), join(siteDir, "es")]) {
      mkdirSync(directory, { recursive: true });
    }
    writeFileSync(join(fixtureWorkspace, "apps/languages/catalog.json"), JSON.stringify({
      courses: [{ id: "es", manifest: "apps/languages/spanish/course.json" }],
    }));
    writeFileSync(join(fixtureWorkspace, "apps/languages/spanish/course.json"), JSON.stringify({
      id: "es", sourceLanguage: { locale: "en" }, targetLanguage: { locale: "es-ES" },
      platforms: { browser: { enabled: true, pagesEnabled: true } }, capabilities: {}, resources: {},
    }));
    writeFileSync(join(siteDir, shared, "app-bootstrap.mjs"),
      'async function start() {\n  await loadSharedScript("/language-runtime/static/source/maintenance-ui.js?v=maintenance-28");\n}\n');
    writeFileSync(join(siteDir, shared, "product-word-world.mjs"),
      'const saved = (queued) => interfaceText("wordworld.report.savedlocal");\n');
    writeFileSync(join(siteDir, shared, "feedback-outbox.mjs"),
      readFileSync(join(workspaceRoot, "apps/language-runtime/static/source/feedback-outbox.mjs")));
    writeFileSync(join(siteDir, "es/caatuu-profile.json"), JSON.stringify({ capabilities: { stats: true }, privacy: {} }));
    writeFileSync(join(siteDir, "es/index.html"), "<main>Spanish</main>");
    writeFileSync(join(siteDir, "es/setup-assets.json"), JSON.stringify(setup));
    writeFileSync(join(siteDir, "es/retained.bin"), "historical release bytes");
    writeFileSync(join(siteDir, "index.html"), "<main>Caatuu</main>");
    enableReportingSurfaces({ workspaceRoot: fixtureWorkspace, siteDir, languagePlan });
    const catalogPath = "language-runtime/static/data/reporting-courses.v2.json";
    const catalog = JSON.parse(readFileSync(join(siteDir, catalogPath), "utf8"));
    assert.deepEqual(catalog, { schemaVersion: 2, courses: [{
      courseId: "es", sourceLanguage: "en", targetLanguage: "es-ES", sentenceReports: true, dictionary: null,
    }] });
    const bootstrap = readFileSync(join(siteDir, shared, "app-bootstrap.mjs"), "utf8");
    assert.ok(bootstrap.includes("/" + catalogPath));
    assert.ok(bootstrap.includes("/" + shared + "/pages-reporting.mjs"));
    assert.equal(existsSync(join(siteDir, "cz")), false);
    assert.equal(existsSync(join(fixtureWorkspace, "apps/languages/czech")), false);
    const profile = JSON.parse(readFileSync(join(siteDir, "es/caatuu-profile.json"), "utf8"));
    assert.equal(profile.capabilities.reportingApi, true);
    assert.equal(profile.privacy.sentenceFeedbackRemoteConsent, true);
    assert.equal(profile.privacy.dictionaryGapReportsLocalOnly, true);
    writeFileSync(join(siteDir, "sw.js"), serviceWorkerSource([
      "/", "/es/retained.bin", "/" + shared + "/app-bootstrap.mjs",
      "/" + shared + "/product-word-world.mjs", "/" + shared + "/feedback-outbox.mjs",
    ], "ab12"));
    const worker = rewriteServiceWorker({
      siteDir, languagePlan, baselinePublicPaths: new Set(["es/retained.bin"]),
      baselineDescriptor: { stable: channel, compatibility: channel, canonicalOrigin: "https://caatuu.waajacu.com" },
      currentDescriptor: { stable: channel, releases: [channel] },
      courseSetups: new Map([["es", { manifest: setup }]]),
    });
    for (const asset of ["/" + catalogPath, "/" + shared + "/pages-reporting.mjs", "/" + shared + "/feedback-outbox.mjs"]) {
      assert.ok(worker.coreAssets.includes(asset), "Reporting must be available after offline return: " + asset);
    }
    assert.equal(worker.coreAssets.includes("/es/retained.bin"), false);
    assert.ok(worker.cacheName.startsWith("caatuu-web-static-"));
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("retired Czech databases and unreferenced setup duplicates are omitted", () => {
  assert.equal(retiredCzechDatabasePath("cz/data/dictionaries/kaikki-cs-en-2026-07-09/caatuu-cs-en.sqlite"), true);
  assert.equal(retiredCzechDatabasePath("cz/data/embeddings/all-minilm-l6-v2-qint8-v0.1/caatuu-cz-curriculum.sqlite"), true);
  assert.equal(
    retiredCzechDatabasePath("assets/setup/8ec3e42b476ffbbeeede427a2fb80cdca70f62c2d420e7298038393ea2ffa8df/d4ed923795f43a0c-caatuu-cz-curriculum.sqlite"),
    true,
  );
  assert.equal(retiredCzechDatabasePath("language-runtime/models/all-minilm-l6-v2-qint8-v0.1/runtime/onnx/model_qint8_arm64.onnx"), false);
  const latest = new Set(["assets/setup/current/picture.png", "assets/macaw/picture.png"]);
  assert.deepEqual(unreferencedDuplicateSetupPaths([
    { path: "assets/macaw/picture.png", sha256: "same" },
    { path: "assets/setup/current/picture.png", sha256: "same" },
    { path: "assets/setup/old/picture.png", sha256: "same" },
    { path: "assets/setup/old-only/catalog.json", sha256: "unique" },
  ], latest).sort(), ["assets/setup/old/picture.png"]);
  const sharedOnnx = "language-runtime/models/all-minilm-l6-v2-qint8-v0.1/runtime/onnx/model_qint8_arm64.onnx";
  const czechOnnx = "cz/data/embeddings/all-minilm-l6-v2-qint8-v0.1/runtime/onnx/model_qint8_arm64.onnx";
  assert.deepEqual(unreferencedDuplicateSetupPaths([
    { path: sharedOnnx, sha256: "onnx" },
    { path: czechOnnx, sha256: "onnx" },
    { path: "assets/setup/old/model_qint8_arm64.onnx", sha256: "onnx" },
  ], new Set([sharedOnnx])).sort(), [
    "assets/setup/old/model_qint8_arm64.onnx",
    czechOnnx,
  ]);
  assert.deepEqual(unreferencedDuplicateSetupPaths([
    { path: "assets/setup/a/file.png", sha256: "old" },
    { path: "assets/setup/b/file.png", sha256: "old" },
  ], new Set()).sort(), ["assets/setup/a/file.png", "assets/setup/b/file.png"]);
  assert.deepEqual(unreferencedDuplicateSetupPaths([
    { path: "assets/stores/stores (1).png", sha256: "store" },
    { path: "assets/setup/current/stores (1).png", sha256: "store" },
    { path: "assets/setup/old/stores (1).png", sha256: "store" },
  ], new Set(["assets/setup/current/stores (1).png"])).sort(), [
    "assets/setup/old/stores (1).png",
  ]);
  const filtered = omitDisabledCourseSetupSurfaces({
    artifacts: [
      {
        key: "embedding-runtime-onnx",
        artifact_kind: "embedding-runtime",
        url: `/${czechOnnx}`,
        asset_path: "data/embeddings/all-minilm-l6-v2-qint8-v0.1/runtime/onnx/model_qint8_arm64.onnx",
      },
      { key: "shared-model", artifact_kind: "embedding-runtime", url: `/${sharedOnnx}` },
      { key: "lesson", url: "/cz/index.html" },
    ],
    offline: { assets: ["./data/embeddings/models.json", "./index.html", "./source/shared/vector-db.js?v=vector-db-10", "./vendor/transformers/transformers.min.js"] },
  }, { embeddings: false, dictionary: false });
  assert.deepEqual(filtered.artifacts.map((artifact) => artifact.key), ["lesson"]);
  assert.deepEqual(filtered.offline.assets, ["./index.html"]);
  assert.equal(disabledCourseSetupSurface("language-runtime/models/model.onnx", { embeddings: true }), false);
});
