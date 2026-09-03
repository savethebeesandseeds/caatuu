#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmdirSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { compileProductAssetBundle } from "../../android/tooling/build-product-assets.mjs";
import { compileStaticSite } from "./build-static-site.mjs";
import {
  defaultPagesBaselineDescriptor,
  extractPagesBaselineArchive,
  sha256File,
  validateExtractedPagesBaseline
} from "../../android/tooling/pages-baseline.mjs";
import {
  defaultPagesCurrentReleaseDescriptor,
  loadPagesCurrentRelease
} from "../../android/tooling/pages-current-release.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const toolingDir = dirname(scriptPath);
const defaultWorkspaceRoot = resolve(toolingDir, "../../..");
const defaultOutputDir = resolve(defaultWorkspaceRoot, "artifacts/web/github-pages");
const maximumPagesBytes = 1_000_000_000;
const maximumPagesFileBytes = 200_000_000;
const pagesWorkerPolicyVersion = 3;
const pagesEntrypoints = Object.freeze(["/", "/cz/", "/cz/index.html", "/zh/", "/zh/index.html"]);
const textExtensions = new Set([".css", ".html", ".js", ".json", ".mjs", ".txt", ".webmanifest"]);
const agreementArtworkKey = "planet-agreement-aurora";
const agreementArtworkAssetPath = "assets/planets/agreement-aurora.png";
const mandarinCourseId = "zh";
const standaloneGamePrefix = "games/caatuu-game/";
const sharedCourseWorkerPublicPath = "language-runtime/static/source/course-service-worker.js";
const mandarinCacheRevisionSentinel = "CAATUU_PAGES_CACHE_REVISION";
const durableReleasePrefixes = [
  "/android/",
  "/cz/data/dictionaries/",
  "/cz/data/embeddings/",
  "/language-runtime/models/",
  "/language-runtime/vendor/transformers/"
];
const edgeDynamicRoutes = Object.freeze([
  "/cz/api/dictionary/gaps",
  "/api/sentence-reports",
  "/api/reporting/health"
]);
const reportingModulePublicPath = "cz/source/shared/pages-reporting.mjs";

function exactReplace(source, before, after, label) {
  const count = source.split(before).length - 1;
  assert.equal(count, 1, `${label} anchor count changed: ${count}`);
  return source.replace(before, after);
}

function retainedAndroidChannels(baselineDescriptor, currentDescriptor) {
  const previousStable = structuredClone(baselineDescriptor.stable);
  previousStable.manifest.publicPaths = previousStable.manifest.publicPaths.slice(0, 1);
  previousStable.apk.publicPaths = previousStable.apk.publicPaths.slice(0, 1);
  return [
    currentDescriptor.stable,
    ...currentDescriptor.releases.slice(0, -1),
    previousStable,
    baselineDescriptor.compatibility,
  ];
}

function androidPublicPaths(baselineDescriptor, currentDescriptor) {
  return retainedAndroidChannels(baselineDescriptor, currentDescriptor)
    .flatMap((channel) => [channel.manifest, channel.apk])
    .flatMap((artifact) => artifact.publicPaths);
}

function isDurableReleasePublicPath(path) {
  const rooted = `/${publicPath(path)}`;
  return durableReleasePrefixes.some((prefix) => rooted.startsWith(prefix));
}

function inside(parent, child) {
  const value = relative(resolve(parent), resolve(child));
  return value !== "" && value !== ".." && !value.startsWith(`..${sep}`) && !isAbsolute(value);
}

function sha256Bytes(value) {
  return createHash("sha256").update(value).digest("hex");
}

function readText(path) {
  return readFileSync(path, "utf8").replaceAll("\r\n", "\n");
}

function writeText(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value.endsWith("\n") ? value : `${value}\n`, "utf8");
}

function writeJson(path, value) {
  writeText(path, JSON.stringify(value, null, 2));
}

function allFiles(root) {
  const files = [];
  const visit = (directory, prefix = "") => {
    for (const name of readdirSync(directory).sort((left, right) => left.localeCompare(right, "en"))) {
      const absolute = join(directory, name);
      const path = prefix ? `${prefix}/${name}` : name;
      const stats = lstatSync(absolute);
      assert.ok(!stats.isSymbolicLink(), `Pages input contains a symbolic link: ${path}`);
      if (stats.isDirectory()) visit(absolute, path);
      else {
        assert.ok(stats.isFile(), `Pages input contains a non-file entry: ${path}`);
        files.push(path);
      }
    }
  };
  visit(root);
  return files.sort((left, right) => left.localeCompare(right, "en"));
}

function publicPath(value, label = "public path") {
  const path = String(value || "").replaceAll("\\", "/");
  assert.ok(path && !path.startsWith("/"), `${label} must be a relative path: ${path || "<empty>"}`);
  const parts = path.split("/");
  assert.ok(parts.every((part) => part && part !== "." && part !== ".."), `${label} is unsafe: ${path}`);
  return path;
}

function outputPath(root, path) {
  const normalized = publicPath(path);
  const result = resolve(root, ...normalized.split("/"));
  assert.ok(inside(root, result), `Output path escapes the Pages bundle: ${normalized}`);
  return result;
}

function assertNoSymlinkAncestors(path, boundary, label) {
  const root = resolve(boundary);
  let current = resolve(path);
  assert.ok(current === root || inside(root, current), `${label} escapes ${root}: ${current}`);
  while (current !== root) {
    if (existsSync(current)) assert.ok(!lstatSync(current).isSymbolicLink(), `${label} uses a symbolic link: ${current}`);
    current = dirname(current);
  }
}

function assertSafeOutputDirectory(outputDir, workspaceRoot) {
  const output = resolve(outputDir);
  const workspace = resolve(workspaceRoot);
  assert.notEqual(output.toLowerCase(), workspace.toLowerCase(), `Refusing to replace the workspace: ${output}`);
  assert.notEqual(dirname(output), output, `Refusing to replace a filesystem root: ${output}`);
  if (inside(workspace, output)) {
    const allowedRoot = resolve(workspace, "artifacts/web");
    assert.ok(inside(allowedRoot, output), `Pages output inside the workspace must be below ${allowedRoot}`);
    assertNoSymlinkAncestors(output, workspace, "Pages output");
  } else {
    const temporaryRoot = resolve(tmpdir());
    assert.ok(inside(temporaryRoot, output), `External Pages output must be below ${temporaryRoot}`);
    assert.match(relative(temporaryRoot, output), /(?:caatuu-pages|github-pages)/iu);
    assertNoSymlinkAncestors(output, temporaryRoot, "Pages output");
  }
}

function prepareBaseline({ workspaceRoot, descriptorPath, baselineDir, baselineArchive }) {
  assert.notEqual(
    Boolean(baselineDir),
    Boolean(baselineArchive),
    "Exactly one of baselineDir or baselineArchive is required"
  );
  if (baselineDir) {
    return {
      baseline: validateExtractedPagesBaseline({ workspaceRoot, descriptorPath, baselineDir }),
      cleanup() {}
    };
  }
  const temporaryParent = resolve(process.env.RUNNER_TEMP || tmpdir());
  const temporaryRoot = mkdtempSync(join(temporaryParent, "caatuu-pages-baseline-"));
  const extractionDir = join(temporaryRoot, "content");
  try {
    const baseline = extractPagesBaselineArchive({
      workspaceRoot,
      descriptorPath,
      archivePath: baselineArchive,
      outputDir: extractionDir
    });
    return {
      baseline,
      cleanup() {
        rmSync(temporaryRoot, { recursive: true, force: true });
      }
    };
  } catch (error) {
    rmSync(temporaryRoot, { recursive: true, force: true });
    throw error;
  }
}

function assertReplaceableOutput(outputDir) {
  if (!existsSync(outputDir)) return;
  const stats = lstatSync(outputDir);
  assert.ok(stats.isDirectory() && !stats.isSymbolicLink(), `Pages output is not a regular directory: ${outputDir}`);
  const sentinel = join(outputDir, "caatuu-web-bundle.json");
  assert.ok(existsSync(sentinel) && lstatSync(sentinel).isFile(), `Refusing to replace output without the Pages sentinel: ${outputDir}`);
  const manifest = JSON.parse(readText(sentinel));
  assert.equal(manifest.schema_name || manifest.schemaName, "caatuu-web-bundle");
}

function replaceGeneratedOutput(stagingDir, outputDir, workspaceRoot) {
  assertSafeOutputDirectory(stagingDir, workspaceRoot);
  assertSafeOutputDirectory(outputDir, workspaceRoot);
  assertReplaceableOutput(outputDir);
  let backupDir = null;
  if (existsSync(outputDir)) {
    backupDir = mkdtempSync(join(dirname(outputDir), `.${basename(outputDir)}.backup-`));
    assertSafeOutputDirectory(backupDir, workspaceRoot);
    rmdirSync(backupDir);
    renameSync(outputDir, backupDir);
  }
  try {
    renameSync(stagingDir, outputDir);
  } catch (error) {
    if (backupDir && existsSync(backupDir) && !existsSync(outputDir)) {
      renameSync(backupDir, outputDir);
      backupDir = null;
    }
    throw error;
  }
  if (backupDir) rmSync(backupDir, { recursive: true });
}

function copyVerified(source, destination, expected, label) {
  const sourceStats = lstatSync(source);
  assert.ok(sourceStats.isFile() && !sourceStats.isSymbolicLink(), `${label} source is not a regular file: ${source}`);
  if (expected) {
    assert.equal(sourceStats.size, expected.bytes, `${label} source byte count changed`);
    assert.equal(sha256File(source), expected.sha256, `${label} source SHA-256 changed`);
  }
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(source, destination);
  assert.equal(statSync(destination).size, sourceStats.size, `${label} copy byte count changed`);
  assert.equal(sha256File(destination), sha256File(source), `${label} copy hash changed`);
}

function currentAgreementArtworkContract({ workspaceRoot }) {
  const currentManifest = JSON.parse(readText(resolve(workspaceRoot, "apps/languages/czech/static/setup-assets.json")));
  const artifacts = currentManifest.artifacts.filter((item) => item.key === agreementArtworkKey);
  assert.equal(artifacts.length, 1, "Current Agreement Aurora setup artifact is missing or repeated");
  const artifact = artifacts[0];
  assert.equal(artifact.url, `/${agreementArtworkAssetPath}`, "Current Agreement Aurora source URL changed");
  assert.equal(artifact.asset_path, agreementArtworkAssetPath, "Current Agreement Aurora local asset path changed");
  assert.match(String(artifact.sha256 || ""), /^[a-f0-9]{64}$/u, "Current Agreement Aurora SHA-256 is invalid");
  const source = resolve(workspaceRoot, "apps/launcher/static", agreementArtworkAssetPath);
  assert.equal(statSync(source).size, Number(artifact.bytes));
  assert.equal(sha256File(source), String(artifact.sha256).toLowerCase());
  const versionedPath = `assets/planets/releases/${artifact.sha256.slice(0, 16)}/agreement-aurora.png`;
  return {
    artifact,
    assetPath: agreementArtworkAssetPath,
    bytes: Number(artifact.bytes),
    sha256: String(artifact.sha256).toLowerCase(),
    source,
    versionedPath
  };
}

function rewriteAgreementArtworkSetup({ path, oldAbsolute, newAbsolute, assetPath }) {
  const manifest = JSON.parse(readText(path));
  const artifacts = (manifest.artifacts || []).filter((item) => item.key === agreementArtworkKey);
  assert.ok(artifacts.length <= 1, `Agreement Aurora setup artifact is repeated in ${path}`);
  if (artifacts.length === 1) {
    const artifact = artifacts[0];
    assert.equal(artifact.url, oldAbsolute, `Agreement Aurora setup URL changed in ${path}`);
    assert.equal(artifact.asset_path, assetPath, `Agreement Aurora setup local path changed in ${path}`);
    artifact.url = newAbsolute;
  }
  let offlineReplacements = 0;
  if (Array.isArray(manifest.offline?.assets)) {
    manifest.offline.assets = manifest.offline.assets.map((value) => {
      const source = String(value);
      if (source !== oldAbsolute && !source.startsWith(`${oldAbsolute}?`)) return value;
      offlineReplacements += 1;
      return newAbsolute;
    });
  }
  if (artifacts.length === 0 && offlineReplacements === 0) return false;
  if (artifacts.length === 1 && Array.isArray(manifest.offline?.assets)) {
    assert.ok(offlineReplacements > 0, `Agreement Aurora offline URL is missing in ${path}`);
  }
  writeJson(path, manifest);
  return true;
}

function preserveCurrentAgreementArtwork({ workspaceRoot, siteDir }) {
  const current = currentAgreementArtworkContract({ workspaceRoot });
  const { assetPath, bytes, sha256, source, versionedPath } = current;
  copyVerified(source, outputPath(siteDir, versionedPath), {
    bytes,
    sha256
  }, "Current Agreement Aurora artwork");
  const oldAbsolute = `/${assetPath}`;
  const newAbsolute = `/${versionedPath}`;
  let replacements = 0;
  for (const path of allFiles(siteDir)) {
    if (!textExtensions.has(extname(path))) continue;
    const absolute = outputPath(siteDir, path);
    if (path === "setup-assets.json" || path.endsWith("/setup-assets.json")) {
      if (rewriteAgreementArtworkSetup({ path: absolute, oldAbsolute, newAbsolute, assetPath })) {
        replacements += 1;
      }
      continue;
    }
    let sourceText = readText(absolute);
    const before = sourceText;
    sourceText = sourceText.replaceAll(oldAbsolute, newAbsolute);
    sourceText = sourceText.replaceAll(assetPath, versionedPath);
    if (sourceText !== before) {
      replacements += 1;
      writeText(absolute, sourceText);
    }
  }
  assert.ok(replacements >= 4, "Current web Agreement Aurora references were not rewritten");
  return current;
}

function overlayDurableBaseline({ baseline, siteDir }) {
  const sourceRoot = join(baseline.baselineDir, "site");
  const files = allFiles(sourceRoot);
  for (const path of files) copyVerified(outputPath(sourceRoot, path), outputPath(siteDir, path), null, `Baseline ${path}`);
  return files;
}

function overlayAndroidReleases({ currentRelease, siteDir }) {
  for (const loaded of currentRelease.releases) {
    const { release } = loaded;
    copyVerified(
      loaded.manifestPath,
      outputPath(siteDir, release.manifest.publicPaths[0]),
      release.manifest,
      `Android ${release.versionCode} manifest`,
    );
    copyVerified(
      loaded.apkPath,
      outputPath(siteDir, release.apk.publicPaths[0]),
      release.apk,
      `Android ${release.versionCode} APK`,
    );
  }
}

function browserRequiredArtifact(artifact) {
  return artifact?.browser_required === true || artifact?.browserRequired === true;
}

function setupArtifactPublicPath(artifact, canonicalOrigin, label) {
  const url = new URL(String(artifact?.url || ""), canonicalOrigin);
  assert.equal(url.origin, canonicalOrigin, `${label} changed origin`);
  return publicPath(decodeURIComponent(url.pathname.slice(1)), `${label} path`);
}

function mandarinCourseAssetUrl(value, canonicalOrigin, label) {
  const courseOrigin = new URL(`/${mandarinCourseId}/`, canonicalOrigin);
  const url = new URL(String(value || ""), courseOrigin);
  assert.equal(url.origin, canonicalOrigin, `${label} changed origin: ${value}`);
  return url;
}

export function retainPagesManagedMandarinOfflineAssets(manifest, canonicalOrigin) {
  assert.ok(Array.isArray(manifest?.offline?.assets), "Mandarin setup has no offline closure");
  const retained = [];
  let removedDurableCount = 0;
  for (const value of manifest.offline.assets) {
    const url = mandarinCourseAssetUrl(value, canonicalOrigin, "Mandarin offline asset");
    const path = publicPath(decodeURIComponent(url.pathname.slice(1)), "Mandarin offline asset path");
    if (isDurableReleasePublicPath(path)) {
      removedDurableCount += 1;
      continue;
    }
    retained.push(value);
  }
  manifest.offline.assets = retained;
  return { retainedCount: retained.length, removedDurableCount };
}

function normalizedMandarinSetupForCacheRevision(manifest, canonicalOrigin) {
  const normalized = structuredClone(manifest);
  normalized.offline.cacheName = mandarinCacheRevisionSentinel;
  const localWorkerPath = `${mandarinCourseId}/sw.js`;
  const localWorkerArtifacts = normalized.artifacts.filter(
    (artifact) => setupArtifactPublicPath(artifact, canonicalOrigin, `Mandarin ${artifact.key}`) === localWorkerPath,
  );
  assert.equal(localWorkerArtifacts.length, 1, "Mandarin setup must declare one local course worker");
  localWorkerArtifacts[0].bytes = 0;
  localWorkerArtifacts[0].sha256 = mandarinCacheRevisionSentinel;
  return normalized;
}

function normalizeMandarinWorkerForCacheRevision(source) {
  const pattern = /^\/\/ Offline catalog revision: [^\r\n]+$/gmu;
  assert.equal([...source.matchAll(pattern)].length, 1, "Mandarin course worker revision comment changed");
  return source.replace(pattern, `// Offline catalog revision: ${mandarinCacheRevisionSentinel}`);
}

export function deriveMandarinPagesCacheName({ siteDir, canonicalOrigin, manifest, localWorkerSource }) {
  const cachePrefix = String(manifest?.offline?.cachePrefix || "");
  assert.ok(cachePrefix.startsWith("caatuu-") && cachePrefix.endsWith("-pwa-"), "Mandarin cache prefix changed");
  assert.ok(Array.isArray(manifest?.offline?.assets), "Mandarin setup has no offline closure");

  const requests = new Map();
  for (const value of [
    `/${mandarinCourseId}/`,
    manifest.application?.entryPath,
    `/${sharedCourseWorkerPublicPath}`,
    ...manifest.offline.assets,
  ]) {
    const url = mandarinCourseAssetUrl(value, canonicalOrigin, "Mandarin precache asset");
    const path = publicPathForCoreAsset(`${url.pathname}${url.search}`);
    assert.ok(!isDurableReleasePublicPath(path), `Mandarin precache retained a durable release path: ${path}`);
    const file = pathForCoreAsset(siteDir, `${url.pathname}${url.search}`);
    assert.ok(existsSync(file), `Mandarin precache asset is missing: ${path}`);
    const requestPath = `${url.pathname}${url.search}`;
    const identity = `${statSync(file).size}\0${sha256File(file)}`;
    if (requests.has(requestPath)) assert.equal(requests.get(requestPath), identity);
    else requests.set(requestPath, identity);
  }

  const digest = sha256Bytes([
    `manifest\0${JSON.stringify(normalizedMandarinSetupForCacheRevision(manifest, canonicalOrigin))}`,
    `worker\0${normalizeMandarinWorkerForCacheRevision(localWorkerSource)}`,
    ...[...requests]
      .map(([requestPath, identity]) => `${requestPath}\0${identity}`)
      .sort((left, right) => left.localeCompare(right, "en")),
  ].join("\n"));
  return `${cachePrefix}v${Number.parseInt(digest.slice(0, 12), 16).toString(10)}`;
}

export function enablePagesDurableBypassInCourseWorker(path) {
  let source = readText(path);
  const policyMarker = "const CAATUU_DURABLE_RELEASE_PREFIXES =";
  if (source.includes(policyMarker)) {
    assert.equal(source.split(policyMarker).length - 1, 1, "Pages course-worker durable policy is repeated");
    assert.equal(
      source.split("if (isDurableReleasePath(url.pathname)) return fetch(request);").length - 1,
      1,
      "Pages course-worker durable fetch bypass changed",
    );
    assert.equal(
      source.split("Durable release assets cannot be precached:").length - 1,
      1,
      "Pages course-worker durable precache rejection changed",
    );
    return;
  }
  source = exactReplace(
    source,
    "let courseOfflineConfigPromise;",
    `const CAATUU_DURABLE_RELEASE_PREFIXES = ${JSON.stringify(durableReleasePrefixes, null, 2)};

function isDurableReleasePath(pathname) {
  return CAATUU_DURABLE_RELEASE_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

let courseOfflineConfigPromise;`,
    "Pages course-worker durable path policy",
  );
  source = exactReplace(
    source,
    "    if (!isManagedUrl(url, config)) return fetch(request);",
    `    if (isDurableReleasePath(url.pathname)) return fetch(request);
    if (!isManagedUrl(url, config)) return fetch(request);`,
    "Pages course-worker durable fetch bypass",
  );
  source = exactReplace(
    source,
    "    if (isLegacyMiniAppUrl(url)) {",
    `    if (isDurableReleasePath(url.pathname)) {
      throw new Error(\`Durable release assets cannot be precached: \${url.pathname}\`);
    }
    if (isLegacyMiniAppUrl(url)) {`,
    "Pages course-worker durable precache rejection",
  );
  writeText(path, source);
}

function mandarinProductSource(productDir, path) {
  if (path === `${mandarinCourseId}/index.html`) return join(productDir, "index.html");
  if (path.startsWith(`${mandarinCourseId}/`)) {
    return outputPath(join(productDir, `courses/${mandarinCourseId}`), path.slice(mandarinCourseId.length + 1));
  }
  return outputPath(productDir, path);
}

function overlayMandarinWebProduct({ workspaceRoot, siteDir, canonicalOrigin }) {
  assert.ok(!existsSync(join(siteDir, mandarinCourseId)), "Static core unexpectedly contains a Mandarin route");
  const temporaryRoot = mkdtempSync(join(tmpdir(), "caatuu-pages-product-"));
  const productDir = join(temporaryRoot, "product-bundle");
  try {
    compileProductAssetBundle({
      workspaceRoot,
      outputDir: productDir,
      allowMissingSetupDeliveredRuntimeFiles: true,
    });
    const courseDir = join(productDir, `courses/${mandarinCourseId}`);
    assert.ok(existsSync(courseDir), "Product bundle is missing the Mandarin course");
    for (const path of allFiles(courseDir)) {
      copyVerified(
        outputPath(courseDir, path),
        outputPath(siteDir, `${mandarinCourseId}/${path}`),
        null,
        `Mandarin course ${path}`,
      );
    }
    copyVerified(
      join(productDir, "index.html"),
      outputPath(siteDir, `${mandarinCourseId}/index.html`),
      null,
      "Mandarin shared application entry",
    );

    const setup = JSON.parse(readText(join(courseDir, "setup-assets.json")));
    assert.equal(setup.courseId, mandarinCourseId, "Mandarin setup course ID changed");
    const browserArtifacts = setup.artifacts.filter(browserRequiredArtifact);
    assert.ok(browserArtifacts.length > 0, "Mandarin setup has no browser-required product artifacts");
    const deferredReleaseAssets = new Set();
    for (const artifact of browserArtifacts) {
      const path = setupArtifactPublicPath(artifact, canonicalOrigin, `Mandarin ${artifact.key}`);
      const destination = outputPath(siteDir, path);
      if (existsSync(destination)) {
        const stats = lstatSync(destination);
        assert.ok(stats.isFile() && !stats.isSymbolicLink(), `Mandarin destination is not a regular file: ${path}`);
        continue;
      }
      const source = mandarinProductSource(productDir, path);
      if (!existsSync(source)) {
        assert.ok(
          isDurableReleasePublicPath(path),
          `Mandarin product bundle is missing a non-durable browser artifact: ${path}`,
        );
        deferredReleaseAssets.add(path);
        continue;
      }
      copyVerified(
        source,
        destination,
        null,
        `Mandarin browser artifact ${artifact.key}`,
      );
    }
    const offlineAssets = setup.offline?.assets;
    assert.ok(Array.isArray(offlineAssets) && offlineAssets.length > 0, "Mandarin setup has no offline closure");
    const courseOrigin = new URL(`/${mandarinCourseId}/`, canonicalOrigin);
    for (const value of offlineAssets) {
      const url = new URL(String(value || ""), courseOrigin);
      assert.equal(url.origin, canonicalOrigin, `Mandarin offline asset changed origin: ${value}`);
      const path = publicPath(decodeURIComponent(url.pathname.slice(1)), "Mandarin offline asset path");
      const destination = outputPath(siteDir, path);
      if (existsSync(destination)) continue;
      const source = mandarinProductSource(productDir, path);
      if (!existsSync(source)) {
        assert.ok(
          isDurableReleasePublicPath(path),
          `Mandarin product bundle is missing a non-durable offline asset: ${path}`,
        );
        deferredReleaseAssets.add(path);
        continue;
      }
      copyVerified(
        source,
        destination,
        null,
        `Mandarin offline asset ${path}`,
      );
    }
    return {
      courseFileCount: allFiles(courseDir).length,
      browserArtifactCount: browserArtifacts.length,
      offlineAssetCount: offlineAssets.length,
      deferredReleaseAssetCount: deferredReleaseAssets.size,
    };
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function restoreWebSetupCompatibility({ siteDir, releaseSetup }) {
  const path = join(siteDir, "cz/setup-assets.json");
  const manifest = JSON.parse(readText(path));
  const releaseByKey = new Map(releaseSetup.artifacts.map((artifact) => [artifact.key, artifact]));
  for (const key of ["misc-character-keymap", "macaw-action-keymap", "robot-keymap"]) {
    const current = manifest.artifacts.find((artifact) => artifact.key === key);
    const release = releaseByKey.get(key);
    assert.ok(current && release, `Missing keymap compatibility record: ${key}`);
    assert.equal(current.url, release.url);
    current.bytes = release.bytes;
    current.sha256 = release.sha256;
    current.native_required = false;
    current.browser_required = true;
    const file = outputPath(siteDir, decodeURIComponent(new URL(release.url, "https://caatuu.invalid").pathname.slice(1)));
    assert.equal(statSync(file).size, Number(release.bytes));
    assert.equal(sha256File(file), String(release.sha256).toLowerCase());
  }
  writeJson(path, manifest);
  return manifest;
}

function validateFinalWebSetup({ siteDir, canonicalOrigin, courseId }) {
  const manifest = JSON.parse(readText(join(siteDir, `${courseId}/setup-assets.json`)));
  if (courseId === mandarinCourseId) {
    assert.equal(manifest.application?.entryPath, `/${courseId}/index.html`, `${courseId} setup entry path changed`);
  }
  const paths = [];
  for (const artifact of manifest.artifacts.filter(browserRequiredArtifact)) {
    const path = setupArtifactPublicPath(artifact, canonicalOrigin, `${courseId}:${artifact.key}`);
    const file = outputPath(siteDir, path);
    assert.ok(existsSync(file), `Final Pages setup is missing ${artifact.key}: ${path}`);
    assert.equal(statSync(file).size, Number(artifact.bytes), `${artifact.key} final setup byte count changed`);
    assert.equal(sha256File(file), String(artifact.sha256).toLowerCase(), `${artifact.key} final setup hash changed`);
    paths.push(path);
  }
  assert.equal(new Set(paths).size, paths.length, "Final Pages setup repeats a browser artifact path");
  assert.equal(
    new Set(paths.map((path) => path.toLocaleLowerCase("en-US"))).size,
    paths.length,
    "Final Pages setup repeats a browser artifact path without case distinctions"
  );
  assert.ok(paths.length > 0, `${courseId} setup has no browser-required artifacts`);

  const offlinePaths = [];
  if (courseId === mandarinCourseId) {
    const courseOrigin = new URL(`/${courseId}/`, canonicalOrigin);
    assert.ok(Array.isArray(manifest.offline?.assets), `${courseId} setup has no offline asset list`);
    for (const value of manifest.offline.assets) {
      const url = new URL(String(value || ""), courseOrigin);
      assert.equal(url.origin, canonicalOrigin, `${courseId} offline asset changed origin: ${value}`);
      const path = publicPath(decodeURIComponent(url.pathname.slice(1)), `${courseId} offline asset`);
      assert.ok(!isDurableReleasePublicPath(path), `${courseId} offline asset retained a durable release path: ${path}`);
      assert.ok(existsSync(outputPath(siteDir, path)), `${courseId} offline asset is missing: ${path}`);
      offlinePaths.push(path);
    }
  }
  return { manifest, paths, offlinePaths };
}

function createAndroidAliases({ baselineDescriptor, currentDescriptor, siteDir }) {
  for (const channel of [currentDescriptor.stable, baselineDescriptor.compatibility]) {
    for (const artifact of [channel.manifest, channel.apk]) {
      const canonical = outputPath(siteDir, artifact.publicPaths[0]);
      assert.equal(statSync(canonical).size, artifact.bytes);
      assert.equal(sha256File(canonical), artifact.sha256);
      for (const alias of artifact.publicPaths.slice(1)) {
        copyVerified(canonical, outputPath(siteDir, alias), artifact, `Android alias ${alias}`);
      }
    }
  }
}

function androidChannels() {
  return [
    {
      kind: "release",
      manifest: "/android/caatuu.json",
      artifact: "/android/caatuu.apk",
      minimumVersionCode: 160
    }
  ];
}

export function enableStableAndroidCourseProfile(path, label) {
  let source = readText(path);
  const startAnchor = "      android: {";
  assert.equal(source.split(startAnchor).length - 1, 1, `${label} Android block changed`);
  const start = source.indexOf(startAnchor);
  const endAnchor = "\n      }\n    }\n  });";
  const end = source.indexOf(endAnchor, start);
  assert.ok(start >= 0 && end > start, `${label} platform boundary changed`);
  const channels = JSON.stringify(androidChannels(), null, 2).replaceAll("\n", "\n        ");
  const android = `      android: {
        enabled: true,
        channels: ${channels}
      }`;
  source = `${source.slice(0, start)}${android}${source.slice(end + "\n      }".length)}`;
  assert.match(source, /"kind": "release"/u, `${label} stable Android channel is missing`);
  assert.doesNotMatch(source, /"kind": "preview"|caatuu-preview/u, `${label} retained a preview Android channel`);
  writeText(path, source);
}

function enableAndroidSurfaces({ workspaceRoot, siteDir }) {
  const registryPath = join(siteDir, "languages.json");
  const registry = JSON.parse(readText(registryPath));
  const czech = registry.languages.find((language) => language.id === "cz");
  assert.ok(czech, "Pages registry is missing Czech");
  assert.ok(!registry.languages.some((language) => language.id === mandarinCourseId), "Mandarin must remain unlisted");
  czech.platforms.android = { enabled: true, channels: androidChannels() };
  writeJson(registryPath, registry);

  enableStableAndroidCourseProfile(join(siteDir, "cz/source/shared/course-profile.js"), "Czech course profile");
  enableStableAndroidCourseProfile(join(siteDir, `${mandarinCourseId}/source/shared/course-profile.js`), "Mandarin course profile");

  let launcher = readText(resolve(workspaceRoot, "apps/launcher/static/launcher.js"));
  const startAnchor = "  async function removeLegacyRootServiceWorker() {";
  const endAnchor = "\n  download?.addEventListener";
  const start = launcher.indexOf(startAnchor);
  const end = launcher.indexOf(endAnchor, start);
  assert.ok(start >= 0 && end > start, "Launcher service-worker boundary changed");
  const registration = `  async function registerStaticWorker() {
    if (!("serviceWorker" in navigator)) return;
    const rootScope = new URL("/", window.location.origin).href;
    const legacyCzechScope = new URL("/cz/", window.location.origin).href;
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations
      .filter((entry) => entry.scope === legacyCzechScope && entry.scope !== rootScope)
      .map((entry) => entry.unregister()));
    await navigator.serviceWorker.register("/sw.js", {
      scope: "/",
      updateViaCache: "none"
    });
  }
`;
  launcher = `${launcher.slice(0, start)}${registration}${launcher.slice(end)}`;
  const finalCall = "  removeLegacyRootServiceWorker().finally(loadRegistry);";
  assert.equal(launcher.split(finalCall).length - 1, 1, "Launcher final startup call changed");
  launcher = launcher.replace(finalCall, "  void registerStaticWorker().catch(() => {});\n  loadRegistry();");
  writeText(join(siteDir, "launcher.js"), launcher);
}

function enableReportingSurfaces({ siteDir }) {
  const reportingSource = join(toolingDir, "templates/pages-reporting.mjs");
  const reportingDestination = outputPath(siteDir, reportingModulePublicPath);
  copyVerified(reportingSource, reportingDestination, null, "Pages reporting client");

  const bootstrapPath = join(siteDir, "language-runtime/static/source/app-bootstrap.mjs");
  const bootstrap = exactReplace(
    readText(bootstrapPath),
    '  if (requiresCourseRuntime()) await loadScript("source/shared/runtime.js?v=runtime-41");',
    `  if (requiresCourseRuntime()) {
    await loadScript("source/shared/runtime.js?v=runtime-41");
    const { installPagesReporting } = await import("/cz/source/shared/pages-reporting.mjs?v=pages-reporting-1");
    await installPagesReporting();
  }`,
    "Pages reporting bootstrap"
  );
  writeText(bootstrapPath, bootstrap);

  const wordWorldPath = join(siteDir, "language-runtime/static/source/product-word-world.mjs");
  const wordWorld = exactReplace(
    readText(wordWorldPath),
    "Saved on this device. Sending remains off until a reviewed feedback channel is enabled.",
    `course.id === "cz"
            ? "Saved on this device. If sending is interrupted, the public site will retry later."
            : "Saved on this device. Sending remains off until a reviewed feedback channel is enabled."`,
    "Pages sentence-report retry copy"
  );
  writeText(wordWorldPath, wordWorld);

  const profilePath = join(siteDir, "cz/caatuu-profile.json");
  const profile = JSON.parse(readText(profilePath));
  profile.capabilities.reportingApi = true;
  profile.privacy.dictionaryGapReportsLocalOnly = false;
  profile.privacy.sentenceFeedbackRemoteConsent = true;
  profile.privacy.dictionaryGapReportsFutureOptIn = true;
  profile.privacy.legacyReportingQueuesLocalOnly = true;
  writeJson(profilePath, profile);
}

function rewriteFinalMandarinSetup({ siteDir, canonicalOrigin }) {
  const setupPath = join(siteDir, `${mandarinCourseId}/setup-assets.json`);
  const manifest = JSON.parse(readText(setupPath));
  assert.equal(manifest.courseId, mandarinCourseId, "Mandarin setup course ID changed");
  assert.equal(manifest.application?.entryPath, `/${mandarinCourseId}/index.html`, "Mandarin setup entry path changed");
  assert.ok(Array.isArray(manifest.artifacts), "Mandarin setup has no artifacts");

  const offline = retainPagesManagedMandarinOfflineAssets(manifest, canonicalOrigin);
  assert.ok(offline.retainedCount > 0, "Mandarin Pages setup has no retained offline assets");

  const browserArtifacts = manifest.artifacts.filter(browserRequiredArtifact);
  const workerPublicPath = `${mandarinCourseId}/sw.js`;
  let localWorkerArtifact = null;
  for (const artifact of browserArtifacts) {
    const path = setupArtifactPublicPath(artifact, canonicalOrigin, `Mandarin ${artifact.key}`);
    const file = outputPath(siteDir, path);
    assert.ok(existsSync(file), `Mandarin browser artifact is missing: ${path}`);
    const bytes = statSync(file).size;
    const sha256 = sha256File(file);
    if (artifact.native_required === true) {
      assert.equal(bytes, Number(artifact.bytes), `Mandarin native artifact byte count changed: ${artifact.key}`);
      assert.equal(sha256, String(artifact.sha256).toLowerCase(), `Mandarin native artifact hash changed: ${artifact.key}`);
    } else if (path === workerPublicPath) {
      assert.equal(localWorkerArtifact, null, "Mandarin setup repeats its local course worker");
      localWorkerArtifact = artifact;
    } else {
      artifact.bytes = bytes;
      artifact.sha256 = sha256;
    }
  }
  assert.ok(localWorkerArtifact, "Mandarin setup has no Pages-managed local course worker");

  const previousCacheName = String(manifest.offline?.cacheName || "");
  const workerPath = outputPath(siteDir, workerPublicPath);
  const originalWorker = readText(workerPath);
  const cacheName = deriveMandarinPagesCacheName({
    siteDir,
    canonicalOrigin,
    manifest,
    localWorkerSource: originalWorker,
  });
  assert.ok(previousCacheName.startsWith(String(manifest.offline.cachePrefix)), "Mandarin cache name changed prefix");
  manifest.offline.cacheName = cacheName;
  const worker = exactReplace(
    originalWorker,
    `// Offline catalog revision: ${previousCacheName}`,
    `// Offline catalog revision: ${cacheName}`,
    "Mandarin course-worker revision"
  );
  writeText(workerPath, worker);
  localWorkerArtifact.bytes = statSync(workerPath).size;
  localWorkerArtifact.sha256 = sha256File(workerPath);
  writeJson(setupPath, manifest);
  assert.equal(
    deriveMandarinPagesCacheName({ siteDir, canonicalOrigin, manifest, localWorkerSource: worker }),
    cacheName,
    "Mandarin cache revision is not reproducible",
  );
  return { manifest, cacheName };
}

function pathForCoreAsset(siteDir, asset) {
  if (asset === "/") return join(siteDir, "index.html");
  const url = new URL(asset, "https://caatuu.invalid");
  let path = decodeURIComponent(url.pathname.slice(1));
  if (path.endsWith("/")) path = `${path}index.html`;
  return outputPath(siteDir, path);
}

function publicPathForCoreAsset(asset) {
  if (asset === "/") return "index.html";
  const url = new URL(asset, "https://caatuu.invalid");
  let path = decodeURIComponent(url.pathname.slice(1));
  if (path.endsWith("/")) path = `${path}index.html`;
  return path;
}

function rewriteServiceWorker({
  siteDir,
  baselinePublicPaths,
  baselineDescriptor,
  currentDescriptor,
  mandarinSetup,
}) {
  const path = join(siteDir, "sw.js");
  let source = readText(path);
  const coreMatch = /const CORE_ASSETS = (\[[\s\S]*?\]);/u.exec(source);
  assert.ok(coreMatch, "Pages service worker does not declare CORE_ASSETS");
  const originalCore = JSON.parse(coreMatch[1]);
  const androidPaths = new Set(androidPublicPaths(baselineDescriptor, currentDescriptor));
  const filteredCore = originalCore.filter((asset) => {
    const publishedPath = publicPathForCoreAsset(asset);
    return !baselinePublicPaths.has(publishedPath)
      && !androidPaths.has(publishedPath)
      && !isDurableReleasePublicPath(publishedPath);
  });
  assert.ok(filteredCore.length < originalCore.length, "Release setup assets were not removed from service-worker precache");
  const coreAssets = new Set(filteredCore);
  const reportingAsset = `/${reportingModulePublicPath}`;
  assert.ok(existsSync(pathForCoreAsset(siteDir, reportingAsset)), "Pages reporting client is missing");
  coreAssets.add(reportingAsset);
  coreAssets.add(`/${mandarinCourseId}/`);
  for (const path of allFiles(join(siteDir, mandarinCourseId))) coreAssets.add(`/${mandarinCourseId}/${path}`);
  for (const artifact of mandarinSetup.artifacts.filter(browserRequiredArtifact)) {
    const path = setupArtifactPublicPath(artifact, baselineDescriptor.canonicalOrigin, `Mandarin ${artifact.key}`);
    if (
      !baselinePublicPaths.has(path)
      && !androidPaths.has(path)
      && !isDurableReleasePublicPath(path)
    ) coreAssets.add(`/${path}`);
  }
  const sortedCoreAssets = [...coreAssets].sort((left, right) => left.localeCompare(right, "en"));
  source = source.replace(coreMatch[0], `const CORE_ASSETS = ${JSON.stringify(sortedCoreAssets, null, 2)};`);
  const policyDeclaration = "const WORKER_POLICY_VERSION = 2;";
  assert.equal(source.split(policyDeclaration).length - 1, 1, "Service-worker policy declaration changed");
  source = source.replace(policyDeclaration, `const WORKER_POLICY_VERSION = ${pagesWorkerPolicyVersion};`);
  const prefixSource = `const DURABLE_RELEASE_PREFIXES = ${JSON.stringify(durableReleasePrefixes, null, 2)};

function isDurableReleasePath(pathname) {
  return DURABLE_RELEASE_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}
`;
  const coreEnd = `const CORE_ASSETS = ${JSON.stringify(sortedCoreAssets, null, 2)};`;
  source = source.replace(coreEnd, `${coreEnd}\n${prefixSource}`);
  const originCheck = "  if (url.origin !== location.origin) return;";
  assert.equal(source.split(originCheck).length - 1, 1, "Service-worker origin check changed");
  source = source.replace(originCheck, `${originCheck}\n  if (isDurableReleasePath(url.pathname)) return;`);
  const digest = sha256Bytes([
    `policy:${pagesWorkerPolicyVersion}`,
    ...sortedCoreAssets.map((asset) => `${asset}\0${sha256File(pathForCoreAsset(siteDir, asset))}`)
  ].join("\n")).slice(0, 16);
  const cacheDeclaration = /const CACHE_NAME = "caatuu-czech-web-static-[a-f0-9]+";/gu;
  assert.equal([...source.matchAll(cacheDeclaration)].length, 1, "Service-worker cache declaration changed");
  source = source.replace(cacheDeclaration, `const CACHE_NAME = "caatuu-czech-web-static-${digest}";`);
  writeText(path, source);
  return { cacheName: `caatuu-czech-web-static-${digest}`, coreAssets: sortedCoreAssets };
}

function inventoryFor(siteDir) {
  return allFiles(siteDir)
    .filter((path) => path !== "caatuu-web-bundle.json")
    .map((path) => ({ path, bytes: statSync(outputPath(siteDir, path)).size, sha256: sha256File(outputPath(siteDir, path)) }));
}

function inventoryDigest(files) {
  return sha256Bytes(files.map((file) => `${file.path}\0${file.bytes}\0${file.sha256}`).join("\n"));
}

function generateBundleManifest({ siteDir, baseline, currentRelease, worker }) {
  const files = inventoryFor(siteDir);
  const payloadBytes = files.reduce((sum, file) => sum + file.bytes, 0);
  const descriptor = baseline.descriptor;
  const current = currentRelease.descriptor;
  const previousStable = current.releases.length > 1
    ? current.releases.at(-2)
    : descriptor.stable;
  const manifest = {
    schema_name: "caatuu-web-bundle",
    schema_version: 1,
    profile: "web-static-pages-cutover",
    basePath: "/",
    canonicalOrigin: descriptor.canonicalOrigin,
    entrypoints: pagesEntrypoints,
    serviceWorkerCache: worker.cacheName,
    releaseArchive: descriptor.releaseArchive,
    currentAndroidRelease: current.githubRelease,
    android: {
      stableVersionCode: current.stable.versionCode,
      stableVersionName: current.stable.versionName,
      previousStableVersionCode: previousStable.versionCode,
      previousStableVersionName: previousStable.versionName,
      compatibilityVersionCode: descriptor.compatibility.versionCode,
      compatibilityVersionName: descriptor.compatibility.versionName
    },
    nativeCompatibility: {
      setupManifestBytes: descriptor.nativeSetup.bytes,
      setupManifestSha256: descriptor.nativeSetup.sha256,
      nativeArtifactCount: descriptor.nativeSetup.nativeArtifactCount,
      nativeArtifactBytes: descriptor.nativeSetup.nativeArtifactBytes,
      completeDownloadBytes: descriptor.nativeSetup.completeDownloadBytes
    },
    edgeDynamicRoutes,
    retiredPublicRoutes: descriptor.retiredPublicRoutes.filter((route) => route !== "/cz/api/dictionary/gaps"),
    payloadFileCount: files.length,
    payloadBytes,
    payloadSha256: inventoryDigest(files),
    files
  };
  writeJson(join(siteDir, "caatuu-web-bundle.json"), manifest);
  return manifest;
}

function validateAndroidManifest({ path, channel, canonicalOrigin, compatibility = false }) {
  const manifest = JSON.parse(readText(path));
  assert.equal(manifest.version_code, channel.versionCode);
  assert.equal(manifest.version_name, channel.versionName);
  assert.equal(manifest.source_revision, channel.sourceRevision);
  assert.equal(manifest.package_name, "com.waajacu.caatuu");
  assert.equal(manifest.bytes, channel.apk.bytes);
  assert.equal(manifest.sha256, channel.apk.sha256);
  assert.equal(manifest.apk_url, `${canonicalOrigin}/${channel.apk.publicPaths[0]}`);
  if (compatibility) {
    assert.equal(manifest.stable_manifest_url, `${canonicalOrigin}/android/caatuu.json`);
  }
  return manifest;
}

function validateCurrentAndroidSetupClosure({ siteDir, currentRelease }) {
  const canonicalOrigin = currentRelease.descriptor.canonicalOrigin;
  const seen = new Map();
  let nativeArtifactCount = 0;
  for (const [entry, setup] of currentRelease.setupManifests) {
    for (const artifact of setup.artifacts.filter((item) => item.native_required === true)) {
      const url = new URL(artifact.url, canonicalOrigin);
      assert.equal(url.origin, canonicalOrigin, `${entry}:${artifact.key} changed setup origin`);
      const path = publicPath(decodeURIComponent(url.pathname.slice(1)), `${entry}:${artifact.key} path`);
      const file = outputPath(siteDir, path);
      assert.ok(
        existsSync(file),
        `Pages output is missing Android ${currentRelease.current.release.versionCode} setup artifact ${entry}:${path}`,
      );
      assert.equal(statSync(file).size, Number(artifact.bytes), `${entry}:${artifact.key} byte count changed`);
      assert.equal(sha256File(file), String(artifact.sha256).toLowerCase(), `${entry}:${artifact.key} hash changed`);
      const identity = `${artifact.bytes}:${String(artifact.sha256).toLowerCase()}`;
      if (seen.has(path)) {
        assert.equal(
          seen.get(path),
          identity,
          `Android ${currentRelease.current.release.versionCode} setup path has conflicting bytes: ${path}`,
        );
      } else seen.set(path, identity);
      nativeArtifactCount += 1;
    }
  }
  return { nativeArtifactCount, uniqueNativePaths: seen.size };
}

function validatePreparedPagesSite({ workspaceRoot, outputDir, baseline, currentRelease }) {
  const workspace = resolve(workspaceRoot);
  const siteDir = resolve(outputDir);
  assertSafeOutputDirectory(siteDir, workspace);
  assert.ok(existsSync(siteDir), `Pages output does not exist: ${siteDir}`);
  const files = allFiles(siteDir);
  assert.equal(new Set(files.map((path) => path.toLocaleLowerCase("en-US"))).size, files.length, "Pages output has a case-insensitive path collision");
  assert.ok(
    files.every((path) => !path.startsWith(standaloneGamePrefix)),
    "The local-preview-only standalone Caatuu Game was published",
  );
  let totalBytes = 0;
  for (const path of files) {
    const bytes = statSync(outputPath(siteDir, path)).size;
    assert.ok(bytes <= maximumPagesFileBytes, `${path} exceeds the Pages single-file safety limit`);
    totalBytes += bytes;
  }
  assert.ok(totalBytes <= maximumPagesBytes, `Pages bundle exceeds ${maximumPagesBytes} bytes`);

  const baselineSite = join(baseline.baselineDir, "site");
  for (const path of allFiles(baselineSite)) {
    const source = outputPath(baselineSite, path);
    const published = outputPath(siteDir, path);
    assert.ok(existsSync(published), `Pages output is missing baseline path: ${path}`);
    assert.equal(statSync(published).size, statSync(source).size, `${path} byte count changed`);
    assert.equal(sha256File(published), sha256File(source), `${path} hash changed`);
  }

  const currentAgreement = currentAgreementArtworkContract({ workspaceRoot });
  const currentAgreementPublic = outputPath(siteDir, currentAgreement.versionedPath);
  assert.ok(existsSync(currentAgreementPublic), "Pages output is missing current Agreement Aurora artwork");
  assert.equal(statSync(currentAgreementPublic).size, currentAgreement.bytes);
  assert.equal(sha256File(currentAgreementPublic), currentAgreement.sha256);
  const legacyAgreement = baseline.descriptor.sourceOverrides.find(
    (item) => item.key === "legacy-agreement-aurora",
  );
  assert.ok(legacyAgreement, "Pages baseline is missing legacy Agreement Aurora artwork");
  assert.equal(legacyAgreement.publicPath, currentAgreement.assetPath);
  const legacyAgreementPublic = outputPath(siteDir, legacyAgreement.publicPath);
  assert.equal(statSync(legacyAgreementPublic).size, Number(legacyAgreement.bytes));
  assert.equal(sha256File(legacyAgreementPublic), String(legacyAgreement.sha256).toLowerCase());
  assert.notEqual(sha256File(currentAgreementPublic), sha256File(legacyAgreementPublic));

  const descriptor = baseline.descriptor;
  const currentDescriptor = currentRelease.descriptor;
  assert.equal(currentDescriptor.baselineStableVersionCode, descriptor.stable.versionCode);
  assert.equal(currentDescriptor.compatibilityVersionCode, descriptor.compatibility.versionCode);
  for (const channel of retainedAndroidChannels(descriptor, currentDescriptor)) {
    validateAndroidManifest({
      path: outputPath(siteDir, channel.manifest.publicPaths[0]),
      channel,
      canonicalOrigin: descriptor.canonicalOrigin,
      compatibility: channel.versionCode === descriptor.compatibility.versionCode,
    });
    for (const artifact of [channel.manifest, channel.apk]) {
      for (const path of artifact.publicPaths) {
        const published = outputPath(siteDir, path);
        assert.equal(statSync(published).size, artifact.bytes, `${path} byte count changed`);
        assert.equal(sha256File(published), artifact.sha256, `${path} hash changed`);
      }
    }
  }

  const registry = JSON.parse(readText(join(siteDir, "languages.json")));
  const czech = registry.languages.find((language) => language.id === "cz");
  assert.equal(registry.languages.filter((language) => language.id === mandarinCourseId).length, 0, "Mandarin must remain unlisted");
  assert.deepEqual(czech.platforms.android, { enabled: true, channels: androidChannels() });
  const rootIndex = readText(join(siteDir, "index.html"));
  assert.doesNotMatch(rootIndex, /\/games\/caatuu-game\//u);
  const launcher = readText(join(siteDir, "launcher.js"));
  assert.match(launcher, /fetch\(freshRequestUrl\(channel\.manifest/u);
  assert.match(launcher, /serviceWorker\.register\("\/sw\.js"/u);
  assert.doesNotMatch(launcher, /Published separately/u);

  const finalCzechSetup = validateFinalWebSetup({ siteDir, canonicalOrigin: descriptor.canonicalOrigin, courseId: "cz" });
  const finalMandarinSetup = validateFinalWebSetup({
    siteDir,
    canonicalOrigin: descriptor.canonicalOrigin,
    courseId: mandarinCourseId,
  });
  const finalAgreement = finalCzechSetup.manifest.artifacts.filter(
    (item) => item.key === agreementArtworkKey,
  );
  assert.equal(finalAgreement.length, 1);
  assert.equal(finalAgreement[0].url, `/${currentAgreement.versionedPath}`);
  assert.equal(finalAgreement[0].asset_path, currentAgreement.assetPath);
  assert.equal(
    finalMandarinSetup.manifest.offline.assets.filter((value) => value === `/${currentAgreement.versionedPath}`).length,
    1,
  );
  assert.ok(finalMandarinSetup.manifest.offline.assets.every(
    (value) => !String(value).startsWith(`/${currentAgreement.assetPath}`),
  ));
  const czechCourseProfile = readText(join(siteDir, "cz/source/shared/course-profile.js"));
  const mandarinCourseProfile = readText(join(siteDir, `${mandarinCourseId}/source/shared/course-profile.js`));
  for (const [label, courseProfile] of [
    ["Czech", czechCourseProfile],
    ["Mandarin", mandarinCourseProfile],
  ]) {
    assert.match(courseProfile, /"kind": "release"[\s\S]*"manifest": "\/android\/caatuu\.json"/u, `${label} stable Android channel is missing`);
    assert.doesNotMatch(courseProfile, /"kind": "preview"|caatuu-preview/u, `${label} retained a preview Android channel`);
  }
  assert.match(mandarinCourseProfile, /id: "zh"/u);
  assert.match(mandarinCourseProfile, /status: "development"/u);
  assert.match(mandarinCourseProfile, /browser:\s*\{\s*enabled: true,\s*entryPath: "\/zh\/index\.html"/u);
  const mandarinWorker = readText(join(siteDir, `${mandarinCourseId}/sw.js`));
  assert.match(
    mandarinWorker,
    new RegExp(`Offline catalog revision: ${finalMandarinSetup.manifest.offline.cacheName}`, "u"),
  );
  assert.equal(
    deriveMandarinPagesCacheName({
      siteDir,
      canonicalOrigin: descriptor.canonicalOrigin,
      manifest: finalMandarinSetup.manifest,
      localWorkerSource: mandarinWorker,
    }),
    finalMandarinSetup.manifest.offline.cacheName,
    "Mandarin offline cache revision does not match its complete closure",
  );
  const sharedCourseWorker = readText(outputPath(siteDir, sharedCourseWorkerPublicPath));
  assert.match(sharedCourseWorker, /const CAATUU_DURABLE_RELEASE_PREFIXES/u);
  assert.match(sharedCourseWorker, /if \(isDurableReleasePath\(url\.pathname\)\) return fetch\(request\);/u);
  assert.match(sharedCourseWorker, /Durable release assets cannot be precached/u);

  const currentAndroidSetup = validateCurrentAndroidSetupClosure({ siteDir, currentRelease });
  assert.ok(currentAndroidSetup.nativeArtifactCount > 0);

  const releaseSetupPaths = new Set([
    ...baseline.setupManifest.artifacts,
    ...[...currentRelease.setupManifests.values()].flatMap((setup) => setup.artifacts),
  ]
    .filter((artifact) => artifact.native_required === true)
    .map((artifact) => decodeURIComponent(new URL(artifact.url, descriptor.canonicalOrigin).pathname.slice(1))));
  const worker = readText(join(siteDir, "sw.js"));
  const coreAssets = JSON.parse(/const CORE_ASSETS = (\[[\s\S]*?\]);/u.exec(worker)?.[1] || "null");
  assert.ok(Array.isArray(coreAssets));
  const corePublicPaths = coreAssets.map((asset) => publicPathForCoreAsset(asset));
  const baselinePublicPaths = new Set(allFiles(baselineSite));
  const retainedAndroidPaths = new Set(androidPublicPaths(descriptor, currentDescriptor));
  assert.equal(corePublicPaths.filter((path) => releaseSetupPaths.has(path)).length, 0);
  assert.equal(corePublicPaths.filter((path) => baselinePublicPaths.has(path)).length, 0);
  assert.equal(corePublicPaths.filter((path) => retainedAndroidPaths.has(path)).length, 0);
  assert.equal(corePublicPaths.filter((path) => isDurableReleasePublicPath(path)).length, 0);
  for (const path of ["/zh/", "/zh/index.html", "/zh/setup-assets.json", "/zh/sw.js"]) {
    assert.ok(coreAssets.includes(path), `Pages service worker is missing Mandarin core asset ${path}`);
  }
  assert.match(worker, /request\.headers\.has\("range"\)/u);
  assert.match(worker, /request\.method !== "GET"/u);
  assert.match(worker, /isDurableReleasePath\(url\.pathname\)/u);
  assert.match(worker, /"\/android\/"/u);
  assert.match(worker, new RegExp(`WORKER_POLICY_VERSION = ${pagesWorkerPolicyVersion}`, "u"));

  const finalRetiredRoutes = descriptor.retiredPublicRoutes.filter((route) => route !== "/cz/api/dictionary/gaps");
  for (const route of finalRetiredRoutes) {
    const candidate = outputPath(siteDir, route.slice(1));
    assert.ok(!existsSync(candidate), `Retired dynamic route was published as a file: ${route}`);
  }
  for (const route of edgeDynamicRoutes) {
    const candidate = outputPath(siteDir, route.slice(1));
    assert.ok(!existsSync(candidate), `Edge dynamic route collided with a Pages file: ${route}`);
  }

  const reportingClient = readText(outputPath(siteDir, reportingModulePublicPath));
  assert.match(reportingClient, /X-Caatuu-Reporting-Policy/u);
  assert.match(reportingClient, /2026-09-02\.v1/u);
  assert.match(reportingClient, /caatuu\.sentenceFeedbackAuthorizedOutbox\.v2/u);
  assert.match(reportingClient, /caatuu\.dictionaryGapAuthorizedOutbox\.v2/u);
  assert.match(reportingClient, /credentials:\s*"omit"/u);
  assert.match(reportingClient, /referrerPolicy:\s*"no-referrer"/u);
  assert.doesNotMatch(reportingClient, /caatuu\.(?:feedbackOutbox|dictionaryGapOutbox)\.v1/u);
  const bootstrap = readText(join(siteDir, "language-runtime/static/source/app-bootstrap.mjs"));
  assert.match(bootstrap, /await loadScript\("source\/shared\/runtime\.js\?v=runtime-41"\);[\s\S]*await import\("\/cz\/source\/shared\/pages-reporting\.mjs/u);
  assert.match(bootstrap, /course\.status !== "active"[\s\S]*robots\.content = "noindex, nofollow"/u);
  const wordWorld = readText(join(siteDir, "language-runtime/static/source/product-word-world.mjs"));
  assert.match(wordWorld, /course\.id === "cz"[\s\S]*public site will retry later[\s\S]*Sending remains off until a reviewed feedback channel is enabled/u);
  const profile = JSON.parse(readText(join(siteDir, "cz/caatuu-profile.json")));
  assert.equal(profile.capabilities.reportingApi, true);
  assert.equal(profile.privacy.dictionaryGapReportsFutureOptIn, true);
  assert.equal(profile.privacy.legacyReportingQueuesLocalOnly, true);

  const manifest = JSON.parse(readText(join(siteDir, "caatuu-web-bundle.json")));
  const previousStable = currentDescriptor.releases.length > 1
    ? currentDescriptor.releases.at(-2)
    : descriptor.stable;
  const inventory = inventoryFor(siteDir);
  assert.equal(manifest.schema_name, "caatuu-web-bundle");
  assert.equal(manifest.schema_version, 1);
  assert.equal(manifest.profile, "web-static-pages-cutover");
  assert.deepEqual(manifest.entrypoints, pagesEntrypoints);
  assert.deepEqual(manifest.releaseArchive, descriptor.releaseArchive);
  assert.deepEqual(manifest.currentAndroidRelease, currentDescriptor.githubRelease);
  assert.equal(manifest.android.stableVersionCode, currentDescriptor.stable.versionCode);
  assert.equal(manifest.android.previousStableVersionCode, previousStable.versionCode);
  assert.equal(manifest.android.compatibilityVersionCode, descriptor.compatibility.versionCode);
  assert.deepEqual(manifest.edgeDynamicRoutes, edgeDynamicRoutes);
  assert.deepEqual(manifest.retiredPublicRoutes, finalRetiredRoutes);
  assert.equal(
    /const CACHE_NAME = "([^"]+)";/u.exec(worker)?.[1],
    manifest.serviceWorkerCache,
    "Pages bundle and service worker disagree about the cache name"
  );
  assert.deepEqual(manifest.files, inventory);
  assert.equal(manifest.payloadFileCount, inventory.length);
  assert.equal(manifest.payloadBytes, inventory.reduce((sum, file) => sum + file.bytes, 0));
  assert.equal(manifest.payloadSha256, inventoryDigest(inventory));

  return {
    outputDir: siteDir,
    profile: manifest.profile,
    fileCount: files.length,
    totalBytes,
    stableVersionCode: currentDescriptor.stable.versionCode,
    previousStableVersionCode: previousStable.versionCode,
    compatibilityVersionCode: descriptor.compatibility.versionCode,
    releaseArchiveSha256: descriptor.releaseArchive.sha256
  };
}

export function validatePagesSite({
  workspaceRoot = defaultWorkspaceRoot,
  outputDir = defaultOutputDir,
  baselineDir,
  baselineArchive,
  descriptorPath = defaultPagesBaselineDescriptor,
  currentReleaseDescriptorPath = defaultPagesCurrentReleaseDescriptor
} = {}) {
  const workspace = resolve(workspaceRoot);
  const currentRelease = loadPagesCurrentRelease({
    workspaceRoot: workspace,
    descriptorPath: currentReleaseDescriptorPath,
  });
  const prepared = prepareBaseline({
    workspaceRoot: workspace,
    descriptorPath,
    baselineDir,
    baselineArchive
  });
  try {
    return validatePreparedPagesSite({
      workspaceRoot: workspace,
      outputDir,
      baseline: prepared.baseline,
      currentRelease,
    });
  } finally {
    prepared.cleanup();
  }
}

export function compilePagesSite({
  workspaceRoot = defaultWorkspaceRoot,
  outputDir = defaultOutputDir,
  baselineDir,
  baselineArchive,
  descriptorPath = defaultPagesBaselineDescriptor,
  currentReleaseDescriptorPath = defaultPagesCurrentReleaseDescriptor
} = {}) {
  const workspace = resolve(workspaceRoot);
  const output = resolve(outputDir);
  assertSafeOutputDirectory(output, workspace);
  const currentRelease = loadPagesCurrentRelease({
    workspaceRoot: workspace,
    descriptorPath: currentReleaseDescriptorPath,
  });
  let prepared = null;
  let stagingRoot = null;
  let stagingDir = null;
  try {
    mkdirSync(dirname(output), { recursive: true });
    stagingRoot = mkdtempSync(join(dirname(output), `.${basename(output)}.pages-staging-`));
    assertSafeOutputDirectory(stagingRoot, workspace);
    stagingDir = join(stagingRoot, "site");
    assertSafeOutputDirectory(stagingDir, workspace);
    assert.ok(!existsSync(stagingDir), `Pages staging output already exists: ${stagingDir}`);
    compileStaticSite({ workspaceRoot: workspace, outputDir: stagingDir });
    overlayMandarinWebProduct({
      workspaceRoot: workspace,
      siteDir: stagingDir,
      canonicalOrigin: currentRelease.descriptor.canonicalOrigin,
    });
    preserveCurrentAgreementArtwork({ workspaceRoot: workspace, siteDir: stagingDir });
    prepared = prepareBaseline({
      workspaceRoot: workspace,
      descriptorPath,
      baselineDir,
      baselineArchive
    });
    const baseline = prepared.baseline;
    assert.equal(
      baseline.descriptor.canonicalOrigin,
      currentRelease.descriptor.canonicalOrigin,
      "Pages baseline and current release origins differ",
    );
    const baselineFiles = overlayDurableBaseline({ baseline, siteDir: stagingDir });
    overlayAndroidReleases({ currentRelease, siteDir: stagingDir });
    restoreWebSetupCompatibility({ siteDir: stagingDir, releaseSetup: baseline.setupManifest });
    createAndroidAliases({
      baselineDescriptor: baseline.descriptor,
      currentDescriptor: currentRelease.descriptor,
      siteDir: stagingDir,
    });
    enableAndroidSurfaces({ workspaceRoot: workspace, siteDir: stagingDir });
    enableReportingSurfaces({ siteDir: stagingDir });
    enablePagesDurableBypassInCourseWorker(outputPath(stagingDir, sharedCourseWorkerPublicPath));
    const mandarinSetup = rewriteFinalMandarinSetup({
      siteDir: stagingDir,
      canonicalOrigin: baseline.descriptor.canonicalOrigin,
    });
    const baselinePublicPaths = new Set(baselineFiles);
    const worker = rewriteServiceWorker({
      siteDir: stagingDir,
      baselinePublicPaths,
      baselineDescriptor: baseline.descriptor,
      currentDescriptor: currentRelease.descriptor,
      mandarinSetup: mandarinSetup.manifest,
    });
    generateBundleManifest({ siteDir: stagingDir, baseline, currentRelease, worker });
    const staged = validatePreparedPagesSite({
      workspaceRoot: workspace,
      outputDir: stagingDir,
      baseline,
      currentRelease,
    });
    replaceGeneratedOutput(stagingDir, output, workspace);
    return { ...staged, outputDir: output };
  } finally {
    if (stagingRoot && existsSync(stagingRoot)) rmSync(stagingRoot, { recursive: true, force: true });
    prepared?.cleanup();
  }
}

function parseArguments(argv) {
  const options = { validateOnly: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") return { help: true };
    if (argument === "--validate-only") {
      options.validateOnly = true;
      continue;
    }
    const value = argv[index + 1];
    assert.ok(value && !value.startsWith("--"), `${argument} requires a value`);
    index += 1;
    if (argument === "--workspace-root") options.workspaceRoot = resolve(value);
    else if (argument === "--output") options.outputDir = resolve(value);
    else if (argument === "--baseline-dir") options.baselineDir = resolve(value);
    else if (argument === "--baseline-archive") options.baselineArchive = resolve(value);
    else if (argument === "--descriptor") options.descriptorPath = resolve(value);
    else if (argument === "--current-release-descriptor") options.currentReleaseDescriptorPath = resolve(value);
    else throw new Error(`Unknown argument: ${argument}`);
  }
  assert.notEqual(
    Boolean(options.baselineDir),
    Boolean(options.baselineArchive),
    "Exactly one of --baseline-dir or --baseline-archive is required"
  );
  return options;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(scriptPath)) {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(
        "Usage: node apps/launcher/tooling/build-pages-site.mjs "
          + "(--baseline-dir DIR | --baseline-archive FILE) "
          + "[--output DIR] [--workspace-root DIR] [--descriptor FILE] "
          + "[--current-release-descriptor FILE] [--validate-only]\n"
      );
    } else {
      const result = options.validateOnly ? validatePagesSite(options) : compilePagesSite(options);
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
