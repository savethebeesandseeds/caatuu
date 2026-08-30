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

const scriptPath = fileURLToPath(import.meta.url);
const defaultWorkspaceRoot = resolve(dirname(scriptPath), "..", "..", "..");
export const CANONICAL_APP_ENTRY = "apps/language-runtime/static/app/index.html";
const LEGACY_MINI_APP_DOCUMENT = /(?:^|\/)(?:word-world|word-net)\.html$/u;
const RETIRED_PARALLEL_UI_ASSET = /(?:^|\/)(?:source\/features\/home\/home\.css|source\/games\/verb-nebula\/app\.(?:css|js)|source\/games\/word-world\/word-net(?:-core|-queue)?\.(?:css|js|mjs)|source\/shared\/(?:chrome\.(?:css|js)|learning-profile\.js|theme\.css)|language-runtime\/static\/(?:source\/product-shell\.mjs|styles\/course-shell\.css))$/u;

const LEGACY_ASSET_SOURCE_PREFIXES = [
  ["aliens/", "language-mascots/"],
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
  if (!String(offline.cachePrefix || "").endsWith("-pwa-")) {
    throw new Error("setup-assets.json offline.cachePrefix is invalid.");
  }
  if (!String(offline.cacheName || "").startsWith(offline.cachePrefix)
      || !/-v\d+$/u.test(String(offline.cacheName || ""))) {
    throw new Error("setup-assets.json offline.cacheName must be a versioned course cache.");
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
    if (RETIRED_PARALLEL_UI_ASSET.test(pathname)) {
      throw new Error(`Retired parallel UI asset cannot be cached: ${asset}`);
    }
    const sourcePath = sourcePathForOfflineAsset(asset);
    if (!existsSync(sourcePath) || !statSync(sourcePath).isFile()) {
      throw new Error(`Offline asset source file does not exist: ${sourcePath}`);
    }
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
    changes
  };
}

export function refreshSetupAssetManifest(options = {}) {
  const report = inspectSetupAssetManifest(options);
  if ((report.changes.length === 0 && !report.applicationChanged) || options.check) return report;

  report.manifest.application = report.application;
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
  return report;
}

function parseArgs(args) {
  const parsed = { check: false };
  const valueOptions = new Map([
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
  return parsed;
}

function printHelp() {
  console.log(`Usage: node apps/server/tooling/refresh-setup-assets.mjs [options]

Refresh every setup artifact byte count and SHA-256 from its source file.

Options:
  --check                         Report drift without writing the manifest
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const workspaceRoot = resolve(args.workspaceRoot || defaultWorkspaceRoot);
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

  if (report.changes.length === 0 && !report.applicationChanged) {
    console.log(`Setup asset manifest is current (${report.artifactCount} artifacts).`);
    return;
  }

  if (args.check) {
    if (report.applicationChanged) {
      console.log(
        `Drift: application entry must map ${report.application.entryPath} to ${report.application.appEntry}`
      );
    }
    printChanges(report, "Drift:");
    const changeCount = report.changes.length + Number(report.applicationChanged);
    console.error(`Setup asset manifest is stale for ${changeCount} change(s).`);
    process.exitCode = 1;
    return;
  }

  if (report.applicationChanged) {
    console.log(`Updated: application entry maps ${report.application.entryPath} to ${report.application.appEntry}`);
  }
  printChanges(report, "Updated:");
  console.log(`Refreshed ${report.changes.length} of ${report.artifactCount} setup artifacts.`);
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  });
}
