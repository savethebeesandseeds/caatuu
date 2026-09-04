#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  browserCourseGameContentClosureIssues,
  browserSetupCacheNamespaceIssues,
  browserSharedRuntimeClosureIssues
} from "../../../tools/language-packs/lib/browser-shared-runtime-closure.mjs";
import { loadAndValidateCourseCatalog } from "../../../tools/language-packs/lib/course-contract.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const defaultWorkspaceRoot = resolve(dirname(scriptPath), "..", "..", "..");
export const CANONICAL_APP_ENTRY = "apps/language-runtime/static/app/index.html";
const LEGACY_MINI_APP_DOCUMENT = /(?:^|\/)(?:word-world|word-net)\.html$/u;
const RETIRED_COURSE_GAME_RENDERER_ASSET = /^(?:\.\/)?(?:conjugation-comet\.html|agreement-aurora\.html|source\/games\/conjugation-comet\/conjugation-comet\.(?:css|js)|source\/games\/agreement-aurora\/(?:agreement-aurora\.(?:css|js)|launcher\.css)|source\/games\/case-cosmos\/launcher\.css)$/u;
const RETIRED_PARALLEL_UI_ASSET = /(?:^|\/)(?:source\/features\/home\/home\.css|source\/games\/verb-nebula\/app\.(?:css|js)|source\/games\/word-world\/word-net(?:-core|-queue)?\.(?:css|js|mjs)|source\/shared\/(?:chrome\.(?:css|js)|learning-profile\.js|theme\.css)|language-runtime\/static\/(?:source\/product-shell\.mjs|styles\/course-shell\.css))$/u;

const LEGACY_ASSET_SOURCE_PREFIXES = [
  ["loading_animation/", "loading-animation/"],
  ["miscellaneous/", "visual-vocabulary/"]
];

function resolvedWithin(root, relativePath, label) {
  const candidate = resolve(root, relativePath);
  const pathFromRoot = relative(root, candidate);
  if (!pathFromRoot || pathFromRoot.startsWith("..") || isAbsolute(pathFromRoot)) {
    throw new Error(`${label} escapes its static root: ${relativePath}`);
  }
  return candidate;
}

export function sourcePathForArtifact({
  artifact,
  application,
  workspaceRoot,
  launcherStaticDir,
  languageStaticDir,
  sharedRuntimeDir,
  languageRoutePrefix = "/cz"
}) {
  const key = String(artifact?.key || "<missing-key>");
  const rawUrl = String(artifact?.url || "");
  let decodedUrl;
  try {
    decodedUrl = decodeURIComponent(rawUrl.split(/[?#]/u, 1)[0]);
  } catch (error) {
    throw new Error(`${key} has an invalid encoded URL: ${rawUrl}`, { cause: error });
  }

  if (decodedUrl === application?.entryPath) {
    return resolvedWithin(workspaceRoot, application.appEntry, key);
  }

  if (decodedUrl.startsWith("/assets/")) {
    const publicAssetPath = decodedUrl.slice("/assets/".length);
    const alias = LEGACY_ASSET_SOURCE_PREFIXES.find(([publicPrefix]) =>
      publicAssetPath.startsWith(publicPrefix)
    );
    const sourceAssetPath = alias
      ? `${alias[1]}${publicAssetPath.slice(alias[0].length)}`
      : publicAssetPath;
    return resolvedWithin(launcherStaticDir, `assets/${sourceAssetPath}`, key);
  }

  if (decodedUrl.startsWith("/language-runtime/")) {
    return resolvedWithin(sharedRuntimeDir, decodedUrl.slice("/language-runtime/".length), key);
  }

  const routePrefix = `/${String(languageRoutePrefix).replace(/^\/+|\/+$/g, "")}`;
  if (decodedUrl.startsWith(`${routePrefix}/`)) {
    return resolvedWithin(languageStaticDir, decodedUrl.slice(routePrefix.length + 1), key);
  }

  throw new Error(`${key} uses unsupported setup asset URL: ${rawUrl}`);
}

function expectedApplicationForCourse(course) {
  const appEntry = course?.resources?.appEntry?.path;
  if (appEntry !== CANONICAL_APP_ENTRY) {
    throw new Error(`Course appEntry must be the shared canonical path ${CANONICAL_APP_ENTRY}.`);
  }
  const entryPath = String(course?.entryPath || "");
  if (!entryPath.startsWith(`${course?.routePrefix}/`) || !entryPath.endsWith("/index.html")) {
    throw new Error(`Course entryPath must be a routed index document: ${entryPath || "<missing>"}`);
  }
  return { entryPath, appEntry };
}

function validateCourseRoutes(course) {
  for (const [routeName, rawRoute] of Object.entries(course?.routes || {})) {
    const route = String(rawRoute || "");
    if (LEGACY_MINI_APP_DOCUMENT.test(route.split(/[?#]/u, 1)[0])) {
      throw new Error(
        `Course route ${routeName} must use the canonical shared app instead of ${route}.`
      );
    }
  }
}

function validateOfflineCatalog(manifest, sourcePathForOfflineAsset) {
  const offline = manifest?.offline;
  if (!offline || typeof offline !== "object" || Array.isArray(offline)) {
    throw new Error("setup-assets.json does not define its offline catalog.");
  }
  if (!Array.isArray(offline.assets)) {
    throw new Error("setup-assets.json offline.assets must be an array.");
  }
  const assets = new Set();
  for (const rawAsset of offline.assets) {
    const asset = String(rawAsset || "");
    requireUnique(asset, assets, "offline asset URL");
    const pathname = asset.split(/[?#]/u, 1)[0];
    if (LEGACY_MINI_APP_DOCUMENT.test(pathname)) {
      throw new Error(`Deprecated mini-app document cannot be cached: ${asset}`);
    }
    if (RETIRED_COURSE_GAME_RENDERER_ASSET.test(pathname)) {
      throw new Error(`Retired course-specific game renderer cannot be cached: ${asset}`);
    }
    if (RETIRED_PARALLEL_UI_ASSET.test(pathname)) {
      throw new Error(`Retired parallel UI asset cannot be cached: ${asset}`);
    }
    const sourcePath = sourcePathForOfflineAsset(asset);
    if (!existsSync(sourcePath) || !statSync(sourcePath).isFile()) {
      throw new Error(`Offline asset source file does not exist: ${sourcePath}`);
    }
  }
}

function validateDictionaryOfflineContract(course, manifest) {
  if (course?.capabilities?.dictionary !== true) return;
  const staticRoot = String(course?.resources?.staticRoot?.path || "").replace(/\/$/u, "");
  const relativeResource = (name) => {
    const resourcePath = String(course?.resources?.[name]?.path || "");
    if (!staticRoot || !resourcePath.startsWith(`${staticRoot}/`)) {
      throw new Error(`Dictionary resource ${name} must stay inside the course static root.`);
    }
    return resourcePath.slice(staticRoot.length + 1);
  };
  const revision = String(course?.resources?.dictionaryProvider?.revision || "").trim();
  if (!revision) throw new Error("Dictionary provider must declare a cache revision.");
  const expected = [
    relativeResource("dictionaryCatalog"),
    relativeResource("dictionaryCoreEntries"),
    relativeResource("dictionaryScriptLines"),
    `${relativeResource("dictionaryProvider")}?v=${revision}`,
    relativeResource("dictionaryReferenceDocument")
  ];
  const cached = new Set(
    manifest.offline.assets.map((asset) => String(asset).replace(/^\.\//u, ""))
  );
  for (const asset of expected) {
    if (!cached.has(asset)) {
      throw new Error(`Dictionary offline catalog must include the declared resource: ${asset}`);
    }
  }
}

function validateEmbeddingOfflineContract(course, manifest) {
  if (course?.capabilities?.embeddings !== true) return;
  const staticRoot = String(course?.resources?.staticRoot?.path || "").replace(/\/$/u, "");
  const resourcePath = String(course?.resources?.embeddingCatalog?.path || "");
  if (!staticRoot || !resourcePath.startsWith(`${staticRoot}/`)) {
    throw new Error("Embedding catalog resource must stay inside the course static root.");
  }
  const expected = resourcePath.slice(staticRoot.length + 1);
  const matches = manifest.offline.assets.filter(
    (asset) => String(asset).replace(/^\.\//u, "") === expected
  );
  if (matches.length !== 1) {
    throw new Error(
      `Embedding offline catalog must include the declared resource exactly once: ${expected}`
    );
  }
}

function validateBrowserSharedRuntimeOfflineContract({
  course,
  manifest,
  appAssetCatalogPath
}) {
  let appAssetCatalog;
  try {
    appAssetCatalog = JSON.parse(readFileSync(appAssetCatalogPath, "utf8"));
  } catch (error) {
    throw new Error(`Cannot read shared app asset catalog ${appAssetCatalogPath}: ${error.message}`);
  }
  const issues = browserSharedRuntimeClosureIssues({
    appAssetCatalog,
    setupCatalog: manifest,
    courseId: course.id || "course",
    routePrefix: course.routePrefix
  });
  if (issues.length > 0) {
    throw new Error(issues.map(({ message }) => message).join("\n"));
  }
  return appAssetCatalog;
}

function validateCourseGameContentOfflineContract(course, manifest) {
  const issues = browserCourseGameContentClosureIssues({
    course,
    setupCatalog: manifest
  });
  if (issues.length > 0) {
    throw new Error(issues.map(({ message }) => message).join("\n"));
  }
}

function canonicalSharedRuntimeOfflineAssetChanges({
  manifest,
  application,
  workspaceRoot,
  appAssetCatalog
}) {
  const appEntryPath = resolvedWithin(
    resolve(workspaceRoot),
    application.appEntry,
    "canonical shared app entry"
  );
  const appEntry = readFileSync(appEntryPath, "utf8");
  const sourceByPathname = new Map();
  for (const mapping of appAssetCatalog.assets) {
    if (!mapping.source.startsWith("apps/language-runtime/")
        || !mapping.output.startsWith("language-runtime/")) continue;
    sourceByPathname.set(
      new URL(`/${mapping.output}`, "https://caatuu.invalid/").pathname,
      resolvedWithin(resolve(workspaceRoot), mapping.source, "shared runtime source")
    );
  }

  const canonicalByPathname = new Map();
  const pendingSources = [];
  const queuedPathnames = new Set();
  const recordReference = (rawReference, baseUrl, authority) => {
    let reference;
    try {
      reference = new URL(rawReference, baseUrl);
    } catch (error) {
      throw new Error(`${authority} has an invalid shared runtime reference: ${rawReference}`, {
        cause: error
      });
    }
    if (reference.origin !== "https://caatuu.invalid"
        || !reference.pathname.startsWith("/language-runtime/")) return;

    const sourcePath = sourceByPathname.get(reference.pathname);
    const versions = reference.searchParams.getAll("v");
    if (versions.length > 0) {
      if (versions.length !== 1
          || !versions[0]
          || [...reference.searchParams.keys()].some((key) => key !== "v")
          || reference.hash) {
        throw new Error(
          `${authority} must use exactly one non-empty v parameter for ${reference.pathname}.`
        );
      }
      if (!sourcePath) {
        throw new Error(
          `${authority} references versioned shared runtime pathname ${reference.pathname} that is absent from app-assets.json.`
        );
      }
      const canonicalUrl = `${reference.pathname}${reference.search}`;
      const previous = canonicalByPathname.get(reference.pathname);
      if (previous && previous !== canonicalUrl) {
        throw new Error(
          `Canonical runtime graph references shared runtime pathname ${reference.pathname} with conflicting URLs: ${previous} and ${canonicalUrl}`
        );
      }
      canonicalByPathname.set(reference.pathname, canonicalUrl);
    }

    if (sourcePath
        && /\.(?:html|js|mjs)$/u.test(reference.pathname)
        && !queuedPathnames.has(reference.pathname)) {
      queuedPathnames.add(reference.pathname);
      pendingSources.push({ pathname: reference.pathname, sourcePath });
    }
  };

  const attributePattern = /\b(?:src|href|data-src)\s*=\s*(["'])([^"'<>]+)\1/giu;

  for (const match of appEntry.matchAll(attributePattern)) {
    recordReference(
      match[2],
      "https://caatuu.invalid/",
      "Canonical app entry"
    );
  }

  const referencePatterns = [
    /(["'])((?:\/language-runtime\/|\.\.?\/)[^"'\\\r\n?]*\?v=[^"'\\\r\n]+)\1/gu,
    /\bfrom\s*(["'])([^"']+)\1/gu,
    /\bimport\s*\(\s*(["'])([^"']+)\1/gu,
    /^\s*import\s*(["'])([^"']+)\1/gmu,
    /\b(?:loadSharedScript|importScripts)\s*\(\s*(["'])([^"']+)\1/gu
  ];
  for (let index = 0; index < pendingSources.length; index += 1) {
    const { pathname, sourcePath } = pendingSources[index];
    const source = readFileSync(sourcePath, "utf8");
    const references = new Set();
    for (const match of source.matchAll(attributePattern)) references.add(match[2]);
    for (const pattern of referencePatterns) {
      for (const match of source.matchAll(pattern)) references.add(match[2]);
    }
    for (const reference of references) {
      recordReference(
        reference,
        `https://caatuu.invalid${pathname}`,
        `Shared runtime source ${pathname}`
      );
    }
  }

  const changes = [];
  for (const [index, rawAsset] of manifest.offline.assets.entries()) {
    const previousUrl = String(rawAsset);
    const reference = new URL(previousUrl, "https://caatuu.invalid/");
    const canonicalUrl = canonicalByPathname.get(reference.pathname);
    if (canonicalUrl && previousUrl !== canonicalUrl) {
      changes.push({ index, pathname: reference.pathname, previousUrl, url: canonicalUrl });
    }
  }
  return changes;
}

function validateBrowserSetupCacheNamespace(course, manifest) {
  const issues = browserSetupCacheNamespaceIssues({ course, setupCatalog: manifest });
  if (issues.length > 0) {
    throw new Error(issues.map(({ message }) => message).join("\n"));
  }
}

function validateServiceWorkerRevision(manifest, languageStaticDir) {
  const serviceWorkerPath = join(resolve(languageStaticDir), "sw.js");
  if (!existsSync(serviceWorkerPath) || !statSync(serviceWorkerPath).isFile()) {
    throw new Error(`Course service worker does not exist: ${serviceWorkerPath}`);
  }
  const source = readFileSync(serviceWorkerPath, "utf8");
  const revisions = [...source.matchAll(/^\/\/ Offline catalog revision: (.+)$/gmu)]
    .map((match) => match[1].trim());
  if (revisions.length !== 1) {
    throw new Error("Course service worker must declare exactly one offline catalog revision.");
  }
  if (revisions[0] !== manifest.offline.cacheName) {
    throw new Error(
      `Course service worker revision ${revisions[0]} does not match offline.cacheName ${manifest.offline.cacheName}.`
    );
  }
}

function sha256File(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function requireUnique(value, values, label) {
  if (!value) throw new Error(`Setup artifact is missing ${label}.`);
  if (values.has(value)) throw new Error(`Duplicate setup artifact ${label}: ${value}`);
  values.add(value);
}

export function inspectSetupAssetManifest({
  workspaceRoot = defaultWorkspaceRoot,
  manifestPath = join(workspaceRoot, "apps/languages/czech/static/setup-assets.json"),
  launcherStaticDir = join(workspaceRoot, "apps/launcher/static"),
  languageStaticDir = join(workspaceRoot, "apps/languages/czech/static"),
  sharedRuntimeDir = join(workspaceRoot, "apps/language-runtime"),
  appAssetCatalogPath = join(sharedRuntimeDir, "app-assets.json"),
  courseManifestPath = join(dirname(languageStaticDir), "course.json"),
  languageRoutePrefix
} = {}) {
  const absoluteManifestPath = resolve(manifestPath);
  if (!existsSync(absoluteManifestPath)) {
    throw new Error(`Setup asset manifest does not exist: ${absoluteManifestPath}`);
  }

  const manifest = JSON.parse(readFileSync(absoluteManifestPath, "utf8"));
  const absoluteCourseManifestPath = resolve(courseManifestPath);
  if (!existsSync(absoluteCourseManifestPath)) {
    throw new Error(`Course manifest does not exist: ${absoluteCourseManifestPath}`);
  }
  const course = JSON.parse(readFileSync(absoluteCourseManifestPath, "utf8"));
  const application = expectedApplicationForCourse(course);
  validateCourseRoutes(course);
  const effectiveRoutePrefix = languageRoutePrefix || course.routePrefix;
  if (effectiveRoutePrefix !== course.routePrefix) {
    throw new Error(
      `Setup route prefix ${effectiveRoutePrefix} does not match course routePrefix ${course.routePrefix}.`
    );
  }
  const applicationChanged = JSON.stringify(manifest.application) !== JSON.stringify(application);
  validateBrowserSetupCacheNamespace(course, manifest);
  validateOfflineCatalog(manifest, (asset) => {
    const publicUrl = new URL(
      asset,
      `https://caatuu.invalid${course.routePrefix.replace(/\/$/u, "")}/`
    );
    return sourcePathForArtifact({
      artifact: { key: `offline:${asset}`, url: publicUrl.pathname },
      application,
      workspaceRoot: resolve(workspaceRoot),
      launcherStaticDir: resolve(launcherStaticDir),
      languageStaticDir: resolve(languageStaticDir),
      sharedRuntimeDir: resolve(sharedRuntimeDir),
      languageRoutePrefix: effectiveRoutePrefix
    });
  });
  const appAssetCatalog = validateBrowserSharedRuntimeOfflineContract({
    course,
    manifest,
    appAssetCatalogPath: resolve(appAssetCatalogPath)
  });
  validateCourseGameContentOfflineContract(course, manifest);
  const offlineAssetChanges = canonicalSharedRuntimeOfflineAssetChanges({
    manifest,
    application,
    workspaceRoot: resolve(workspaceRoot),
    appAssetCatalog
  });
  validateDictionaryOfflineContract(course, manifest);
  validateEmbeddingOfflineContract(course, manifest);
  validateServiceWorkerRevision(manifest, languageStaticDir);
  const artifacts = Array.isArray(manifest.artifacts) ? manifest.artifacts : [];
  if (artifacts.length === 0) throw new Error("setup-assets.json does not define any artifacts.");

  const keys = new Set();
  const urls = new Set();
  const changes = [];

  for (const artifact of artifacts) {
    const key = String(artifact?.key || "");
    const url = String(artifact?.url || "");
    requireUnique(key, keys, "key");
    requireUnique(url, urls, "URL");
    if (LEGACY_MINI_APP_DOCUMENT.test(url.split(/[?#]/u, 1)[0])) {
      throw new Error(`Deprecated mini-app document cannot be a setup artifact: ${url}`);
    }

    const sourcePath = sourcePathForArtifact({
      artifact,
      application,
      workspaceRoot: resolve(workspaceRoot),
      launcherStaticDir: resolve(launcherStaticDir),
      languageStaticDir: resolve(languageStaticDir),
      sharedRuntimeDir: resolve(sharedRuntimeDir),
      languageRoutePrefix: effectiveRoutePrefix
    });
    if (!existsSync(sourcePath) || !statSync(sourcePath).isFile()) {
      throw new Error(`${key} source file does not exist: ${sourcePath}`);
    }

    const bytes = statSync(sourcePath).size;
    const sha256 = sha256File(sourcePath);
    if (Number(artifact.bytes) !== bytes || String(artifact.sha256 || "").toLowerCase() !== sha256) {
      changes.push({
        artifact,
        key,
        url,
        sourcePath,
        previousBytes: artifact.bytes,
        bytes,
        previousSha256: artifact.sha256,
        sha256
      });
    }
  }

  return {
    manifest,
    manifestPath: absoluteManifestPath,
    application,
    applicationChanged,
    artifactCount: artifacts.length,
    offlineAssetChanges,
    changes
  };
}

export function refreshSetupAssetManifest(options = {}) {
  const report = inspectSetupAssetManifest(options);
  if ((report.changes.length === 0
      && report.offlineAssetChanges.length === 0
      && !report.applicationChanged) || options.check) return report;

  writeSetupAssetReport(report);
  return report;
}

function writeSetupAssetReport(report) {
  report.manifest.application = report.application;
  for (const change of report.offlineAssetChanges) {
    report.manifest.offline.assets[change.index] = change.url;
  }
  for (const change of report.changes) {
    change.artifact.bytes = change.bytes;
    change.artifact.sha256 = change.sha256;
  }

  const temporaryPath = `${report.manifestPath}.tmp-${process.pid}-${Date.now()}`;
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(report.manifest, null, 2)}\n`, "utf8");
    renameSync(temporaryPath, report.manifestPath);
  } finally {
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
  }
}

function catalogCourseRefreshOptions(workspaceRoot, record) {
  const { course, manifestPath } = record;
  const staticRoot = course.resources?.staticRoot?.path;
  const setupCatalog = course.resources?.setupCatalog?.path;
  if (typeof staticRoot !== "string" || typeof setupCatalog !== "string") {
    throw new Error(`${course.id || "Course"} has no canonical browser setup resources.`);
  }
  return {
    workspaceRoot,
    manifestPath: resolvedWithin(workspaceRoot, setupCatalog, `${course.id} setup catalog`),
    launcherStaticDir: resolvedWithin(workspaceRoot, "apps/launcher/static", "launcher static root"),
    languageStaticDir: resolvedWithin(workspaceRoot, staticRoot, `${course.id} static root`),
    sharedRuntimeDir: resolvedWithin(workspaceRoot, "apps/language-runtime", "shared runtime root"),
    appAssetCatalogPath: resolvedWithin(
      workspaceRoot,
      "apps/language-runtime/app-assets.json",
      "shared app asset catalog"
    ),
    courseManifestPath: resolvedWithin(workspaceRoot, manifestPath, `${course.id} manifest`),
    languageRoutePrefix: course.routePrefix
  };
}

export async function refreshAllBrowserCourseSetupAssets({
  workspaceRoot = defaultWorkspaceRoot,
  catalogPath,
  check = false,
  loadValidatedCatalog = loadAndValidateCourseCatalog
} = {}) {
  const absoluteWorkspaceRoot = resolve(workspaceRoot);
  const loadOptions = { repoRoot: absoluteWorkspaceRoot };
  if (catalogPath) loadOptions.catalogPath = catalogPath;
  const loaded = await loadValidatedCatalog(loadOptions);
  const browserRecords = loaded.courses.filter(
    ({ course }) => course.platforms?.browser?.enabled === true
  );
  if (browserRecords.length === 0) {
    throw new Error("The language catalog does not contain a browser-enabled course.");
  }

  // Inspect every course before the first write so one invalid pack cannot leave
  // a partially refreshed multi-language catalog.
  const reports = browserRecords.map((record) => ({
    courseId: record.course.id,
    ...inspectSetupAssetManifest(catalogCourseRefreshOptions(absoluteWorkspaceRoot, record))
  }));
  if (!check) {
    for (const report of reports) {
      if (report.changes.length > 0
          || report.offlineAssetChanges.length > 0
          || report.applicationChanged) {
        writeSetupAssetReport(report);
      }
    }
  }
  return reports;
}

function parseArgs(args) {
  const parsed = { check: false, allBrowserCourses: false };
  const valueOptions = new Map([
    ["--catalog", "catalogPath"],
    ["--workspace-root", "workspaceRoot"],
    ["--manifest", "manifestPath"],
    ["--launcher-static", "launcherStaticDir"],
    ["--language-static", "languageStaticDir"],
    ["--shared-runtime", "sharedRuntimeDir"],
    ["--course-manifest", "courseManifestPath"],
    ["--language-route-prefix", "languageRoutePrefix"]
  ]);

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--check") {
      parsed.check = true;
      continue;
    }
    if (argument === "--all-browser-courses") {
      parsed.allBrowserCourses = true;
      continue;
    }
    if (argument === "--help" || argument === "-h") {
      parsed.help = true;
      continue;
    }

    const option = [...valueOptions.keys()].find((name) => argument === name || argument.startsWith(`${name}=`));
    if (!option) throw new Error(`Unknown option: ${argument}`);
    const inlineValue = argument.startsWith(`${option}=`) ? argument.slice(option.length + 1) : "";
    const value = inlineValue || args[index + 1];
    if (!value || (!inlineValue && value.startsWith("--"))) throw new Error(`${option} requires a value.`);
    parsed[valueOptions.get(option)] = value;
    if (!inlineValue) index += 1;
  }
  if (parsed.allBrowserCourses) {
    const incompatible = [
      "manifestPath",
      "launcherStaticDir",
      "languageStaticDir",
      "sharedRuntimeDir",
      "courseManifestPath",
      "languageRoutePrefix"
    ].filter((key) => parsed[key] !== undefined);
    if (incompatible.length > 0) {
      throw new Error("--all-browser-courses cannot be combined with single-course path options.");
    }
  } else if (parsed.catalogPath !== undefined) {
    throw new Error("--catalog requires --all-browser-courses.");
  }
  return parsed;
}

function printHelp() {
  console.log(`Usage: node apps/server/tooling/refresh-setup-assets.mjs [options]

Refresh every setup artifact byte count, SHA-256, and canonical shared-runtime URL.

Options:
  --check                         Report drift without writing the manifest
  --all-browser-courses           Validate and refresh every catalog browser course
  --catalog PATH                  Internal catalog path for --all-browser-courses
  --manifest PATH                 Manifest path (default: Czech setup-assets.json)
  --launcher-static PATH          Launcher and shared-asset static root
  --language-static PATH          Language static root
  --shared-runtime PATH           Shared language runtime root
  --course-manifest PATH          Course manifest that owns the setup catalog
  --language-route-prefix PREFIX  Language URL prefix (default: course routePrefix)
  --workspace-root PATH           Workspace root used for default paths
  -h, --help                      Show this help`);
}

function printChanges(report, verb) {
  const limit = 20;
  for (const change of report.changes.slice(0, limit)) {
    console.log(
      `${verb} ${change.key}: ${change.previousBytes ?? "missing"} -> ${change.bytes} bytes, ` +
      `${String(change.previousSha256 || "missing").slice(0, 12)} -> ${change.sha256.slice(0, 12)}`
    );
  }
  if (report.changes.length > limit) {
    console.log(`...and ${report.changes.length - limit} more artifact(s).`);
  }
}

function printOfflineAssetChanges(report, verb) {
  for (const change of report.offlineAssetChanges) {
    console.log(`${verb} ${change.pathname}: ${change.previousUrl} -> ${change.url}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const workspaceRoot = resolve(args.workspaceRoot || defaultWorkspaceRoot);
  if (args.allBrowserCourses) {
    const reports = await refreshAllBrowserCourseSetupAssets({
      workspaceRoot,
      catalogPath: args.catalogPath,
      check: args.check
    });
    let staleCount = 0;
    for (const report of reports) {
      const changeCount = report.changes.length
        + report.offlineAssetChanges.length
        + Number(report.applicationChanged);
      staleCount += changeCount;
      if (changeCount === 0) {
        console.log(`${report.courseId}: setup asset manifest is current (${report.artifactCount} artifacts).`);
        continue;
      }
      if (report.applicationChanged) {
        console.log(
          `${report.courseId}: ${args.check ? "Drift" : "Updated"}: application entry maps `
          + `${report.application.entryPath} to ${report.application.appEntry}`
        );
      }
      printOfflineAssetChanges(report, `${report.courseId}: ${args.check ? "Drift" : "Updated"}:`);
      printChanges(report, `${report.courseId}: ${args.check ? "Drift" : "Updated"}:`);
    }
    if (args.check && staleCount > 0) {
      console.error(`Browser-course setup manifests are stale for ${staleCount} change(s).`);
      process.exitCode = 1;
    } else if (!args.check) {
      console.log(`Refreshed ${reports.length} browser-course setup manifest(s).`);
    }
    return;
  }
  const languageStaticDir = resolve(
    workspaceRoot,
    args.languageStaticDir || "apps/languages/czech/static"
  );
  const options = {
    workspaceRoot,
    manifestPath: resolve(workspaceRoot, args.manifestPath || "apps/languages/czech/static/setup-assets.json"),
    launcherStaticDir: resolve(workspaceRoot, args.launcherStaticDir || "apps/launcher/static"),
    languageStaticDir,
    sharedRuntimeDir: resolve(workspaceRoot, args.sharedRuntimeDir || "apps/language-runtime"),
    courseManifestPath: resolve(
      workspaceRoot,
      args.courseManifestPath || relative(workspaceRoot, join(dirname(languageStaticDir), "course.json"))
    ),
    languageRoutePrefix: args.languageRoutePrefix,
    check: args.check
  };
  const report = refreshSetupAssetManifest(options);

  if (report.changes.length === 0
      && report.offlineAssetChanges.length === 0
      && !report.applicationChanged) {
    console.log(`Setup asset manifest is current (${report.artifactCount} artifacts).`);
    return;
  }

  if (args.check) {
    if (report.applicationChanged) {
      console.log(
        `Drift: application entry must map ${report.application.entryPath} to ${report.application.appEntry}`
      );
    }
    printOfflineAssetChanges(report, "Drift:");
    printChanges(report, "Drift:");
    const changeCount = report.changes.length
      + report.offlineAssetChanges.length
      + Number(report.applicationChanged);
    console.error(`Setup asset manifest is stale for ${changeCount} change(s).`);
    process.exitCode = 1;
    return;
  }

  if (report.applicationChanged) {
    console.log(`Updated: application entry maps ${report.application.entryPath} to ${report.application.appEntry}`);
  }
  printOfflineAssetChanges(report, "Updated:");
  printChanges(report, "Updated:");
  console.log(
    `Refreshed ${report.changes.length} of ${report.artifactCount} setup artifacts and `
    + `${report.offlineAssetChanges.length} canonical offline URL(s).`
  );
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  });
}
