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
  compilePagesSite,
  deriveCoursePagesCacheName,
  enablePagesDurableBypassInCourseWorker,
  enableStableAndroidCourseProfile,
  projectPagesCourseProfileSource,
  projectPagesLanguageRegistry,
  projectPagesLauncherFallback,
  projectStableAndroidChannels,
  retainPagesManagedCourseOfflineAssets,
  rewritePagesCourseProfileReceipt,
  stagePagesBrowserCourses,
  transformPagesSentenceReporting,
  validatePagesSite,
  validatePagesArtwork,
} from "../build-pages-site.mjs";
import { evaluateCourseProfile, serializeCourseProfileSource } from "../../../../tools/language-packs/lib/course-contract.mjs";

const testDir = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(testDir, "../../../..");
const source = readFileSync(join(testDir, "../build-pages-site.mjs"), "utf8");

test("renamed current artwork preserves the baseline URL and validates both byte identities", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "caatuu-pages-artwork-test-"));
  try {
    const manifest = JSON.parse(readFileSync(join(workspaceRoot, "apps/languages/czech/static/setup-assets.json"), "utf8"));
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

test("Pages reporting projects the current interface-key call and keeps other courses local-only", () => {
  const wordWorld = readFileSync(join(workspaceRoot, "apps/language-runtime/static/source/product-word-world.mjs"), "utf8");
  const transformed = transformPagesSentenceReporting(wordWorld);
  assert.match(transformed, /course\.id === "cz"[\s\S]*public site will retry later[\s\S]*interfaceText\("wordworld\.report\.savedlocal"\)/u);
  const syntax = spawnSync(process.execPath, ["--input-type=module", "--check"], { input: transformed, encoding: "utf8" });
  assert.equal(syntax.status, 0, syntax.stderr);
  const expression = transformPagesSentenceReporting('interfaceText("wordworld.report.savedlocal")');
  const render = new Function("course", "interfaceText", `return ${expression};`);
  assert.match(render({ id: "cz" }, () => "local-only"), /public site will retry later/u);
  assert.equal(render({ id: "zh" }, () => "local-only"), "local-only");
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
  const expectedIds = localRegistry.browserSetup.courses.map(({ id }) => id);
  const expectedStatuses = localRegistry.browserSetup.courses.map(({ id, status }) => ({ id, status }));
  assert.deepEqual(languagePlan.browserCourses.map(({ id }) => id), expectedIds);
  const projectedRegistry = projectPagesLanguageRegistry({ registry: localRegistry, languagePlan });
  assert.deepEqual(projectedRegistry.browserSetup.courses.map(({ id, status }) => ({ id, status })), expectedStatuses);
  assert.deepEqual(projectedRegistry.languages.map(({ id, status }) => ({ id, status })), expectedStatuses);
  assert.deepEqual(localRegistry.browserSetup.courses.map(({ id }) => id), expectedIds);

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

test("a synthetic third browser course stages from its catalog resources without builder constants", () => {
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
    defaultCourseId: "cz",
    defaultCourse: { id: "cz", entryPath: "/cz/index.html" },
    browserCourses: [
      { id: "cz", entryPath: "/cz/index.html" },
      course,
    ],
  };
  try {
    for (const directory of [
      join(siteDir, "cz"),
      join(staticRoot, "source/shared"),
      join(fixtureWorkspace, "apps/language-runtime/static/source"),
    ]) mkdirSync(directory, { recursive: true });
    writeFileSync(join(siteDir, "cz/index.html"), "<main>Shared app shell</main>\n");
    writeFileSync(join(staticRoot, "source/shared/course-profile.js"), "globalThis.fixtureCourse = true;\n");
    writeFileSync(join(staticRoot, "offline-only.txt"), "fixture offline bytes\n");
    writeFileSync(join(staticRoot, "sw.js"), "// Offline catalog revision: caatuu-xy-pwa-v1\n");
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
    assert.equal(
      readFileSync(join(siteDir, "learn-xy/index.html"), "utf8"),
      readFileSync(join(siteDir, "cz/index.html"), "utf8"),
    );
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
  const workerSource = '"use strict";\n\n// Offline catalog revision: caatuu-zh-hans-pwa-v1\n';
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

test("the Pages bundle keeps Czech reporting scoped and excludes the standalone preview game", () => {
  assert.match(source, /course\.id === "cz"[\s\S]*public site will retry later/u);
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
