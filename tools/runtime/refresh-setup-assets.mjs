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
const defaultWorkspaceRoot = resolve(dirname(scriptPath), "..", "..");

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
  unifiedStaticDir,
  languageStaticDir,
  languageRoutePrefix = "/cz"
}) {
  const key = String(artifact?.key || "<missing-key>");
  const rawUrl = String(artifact?.url || "");
  let decodedUrl;
  try {
    decodedUrl = decodeURIComponent(rawUrl);
  } catch (error) {
    throw new Error(`${key} has an invalid encoded URL: ${rawUrl}`, { cause: error });
  }

  if (decodedUrl.startsWith("/assets/")) {
    return resolvedWithin(unifiedStaticDir, decodedUrl.slice(1), key);
  }

  const routePrefix = `/${String(languageRoutePrefix).replace(/^\/+|\/+$/g, "")}`;
  if (decodedUrl.startsWith(`${routePrefix}/`)) {
    return resolvedWithin(languageStaticDir, decodedUrl.slice(routePrefix.length + 1), key);
  }

  throw new Error(`${key} uses unsupported setup asset URL: ${rawUrl}`);
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
  manifestPath = join(workspaceRoot, "apps/caatuu-czech/static/setup-assets.json"),
  unifiedStaticDir = join(workspaceRoot, "apps/caatuu-unified/static"),
  languageStaticDir = join(workspaceRoot, "apps/caatuu-czech/static"),
  languageRoutePrefix = "/cz"
} = {}) {
  const absoluteManifestPath = resolve(manifestPath);
  if (!existsSync(absoluteManifestPath)) {
    throw new Error(`Setup asset manifest does not exist: ${absoluteManifestPath}`);
  }

  const manifest = JSON.parse(readFileSync(absoluteManifestPath, "utf8"));
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

    const sourcePath = sourcePathForArtifact({
      artifact,
      unifiedStaticDir: resolve(unifiedStaticDir),
      languageStaticDir: resolve(languageStaticDir),
      languageRoutePrefix
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
    artifactCount: artifacts.length,
    changes
  };
}

export function refreshSetupAssetManifest(options = {}) {
  const report = inspectSetupAssetManifest(options);
  if (report.changes.length === 0 || options.check) return report;

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
    ["--unified-static", "unifiedStaticDir"],
    ["--language-static", "languageStaticDir"],
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
  console.log(`Usage: node tools/runtime/refresh-setup-assets.mjs [options]

Refresh every setup artifact byte count and SHA-256 from its source file.

Options:
  --check                         Report drift without writing the manifest
  --manifest PATH                 Manifest path (default: Czech setup-assets.json)
  --unified-static PATH           Shared static root
  --language-static PATH          Language static root
  --language-route-prefix PREFIX  Language URL prefix (default: /cz)
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
  const options = {
    workspaceRoot,
    manifestPath: resolve(workspaceRoot, args.manifestPath || "apps/caatuu-czech/static/setup-assets.json"),
    unifiedStaticDir: resolve(workspaceRoot, args.unifiedStaticDir || "apps/caatuu-unified/static"),
    languageStaticDir: resolve(workspaceRoot, args.languageStaticDir || "apps/caatuu-czech/static"),
    languageRoutePrefix: args.languageRoutePrefix || "/cz",
    check: args.check
  };
  const report = refreshSetupAssetManifest(options);

  if (report.changes.length === 0) {
    console.log(`Setup asset manifest is current (${report.artifactCount} artifacts).`);
    return;
  }

  if (args.check) {
    printChanges(report, "Drift:");
    console.error(`Setup asset manifest is stale for ${report.changes.length} artifact(s).`);
    process.exitCode = 1;
    return;
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
