#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const defaultWorkspaceRoot = resolve(dirname(scriptPath), "..", "..", "..");
const animationDirectoryPattern = /^animation(?:[-_ ].*)?$/i;
const pngPattern = /\.png$/i;
const rootFramePattern = /^loading-animation_(\d+)\.png$/i;
const publicPrefix = "/assets/loading_animation/";
const legacyPublicPrefixes = ["/assets/macaw/loading_animation/"];
const preferredSequenceOrder = ["backpack", "walking-arround", "walking-around", "landing", "leaving"];

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function writeAtomic(path, contents) {
  const temporaryPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  try {
    writeFileSync(temporaryPath, contents, "utf8");
    renameSync(temporaryPath, path);
  } finally {
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
  }
}

function normalizedPath(path) {
  return path.split(sep).join("/");
}

function sequenceId(folder) {
  return folder
    .replace(/^animation[-_ ]*/i, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "default";
}

function frameNumber(file) {
  const matches = [...String(file).matchAll(/(\d+)/g)];
  return matches.length ? Number(matches.at(-1)[1]) : null;
}

function sequenceOrder(left, right) {
  const leftPriority = preferredSequenceOrder.indexOf(left.id);
  const rightPriority = preferredSequenceOrder.indexOf(right.id);
  const normalizedLeft = leftPriority < 0 ? Number.MAX_SAFE_INTEGER : leftPriority;
  const normalizedRight = rightPriority < 0 ? Number.MAX_SAFE_INTEGER : rightPriority;
  return normalizedLeft - normalizedRight || left.folder.localeCompare(right.folder);
}

export function listLoadingAnimationSequences(frameDirectory) {
  const sequences = readdirSync(frameDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && animationDirectoryPattern.test(entry.name))
    .map((entry) => {
      const directory = join(frameDirectory, entry.name);
      const sprites = readdirSync(directory, { withFileTypes: true })
        .filter((file) => file.isFile() && pngPattern.test(file.name))
        .map((file) => {
          const index = frameNumber(file.name);
          return index === null
            ? null
            : {
                index,
                file: file.name,
                path: `${entry.name}/${file.name}`
              };
        })
        .filter(Boolean)
        .sort((left, right) => left.index - right.index || left.file.localeCompare(right.file));

      if (!sprites.length) return null;
      const indices = new Set();
      for (const sprite of sprites) {
        if (indices.has(sprite.index)) {
          throw new Error(`Duplicate frame index ${sprite.index} in ${entry.name}`);
        }
        indices.add(sprite.index);
      }
      return {
        id: sequenceId(entry.name),
        folder: entry.name,
        count: sprites.length,
        sprites
      };
    })
    .filter(Boolean)
    .sort(sequenceOrder);

  if (!sequences.length) {
    throw new Error(`No animation* folders containing numbered PNG files found in ${frameDirectory}`);
  }
  return sequences;
}

function animationManifestText(sequences) {
  return `${JSON.stringify({
    schema_version: 1,
    animations: sequences
  }, null, 2)}\n`;
}

function loadingFramePath(artifact) {
  const url = String(artifact?.url || "");
  const recognizedPrefix = [publicPrefix, ...legacyPublicPrefixes]
    .find((prefix) => url.startsWith(prefix));
  if (!recognizedPrefix) return "";
  const path = decodeURIComponent(url.slice(recognizedPrefix.length));
  if (rootFramePattern.test(basename(path))) return path;
  const [folder, ...remaining] = path.split("/");
  return animationDirectoryPattern.test(folder) && remaining.length && pngPattern.test(remaining.at(-1))
    ? path
    : "";
}

function synchronizedSetupManifest(manifest, sequences, frameDirectory) {
  const artifacts = Array.isArray(manifest?.artifacts) ? manifest.artifacts : [];
  if (!artifacts.length) throw new Error("setup-assets.json does not define any artifacts.");

  const existingFrames = new Map();
  let firstLoadingPosition = -1;
  for (let index = 0; index < artifacts.length; index += 1) {
    const path = loadingFramePath(artifacts[index]);
    if (!path) continue;
    if (firstLoadingPosition < 0) firstLoadingPosition = index;
    existingFrames.set(path, artifacts[index]);
  }

  const retained = artifacts.filter((artifact) => !loadingFramePath(artifact));
  const insertionPosition = firstLoadingPosition < 0
    ? Math.max(0, retained.findIndex((artifact) => artifact?.key === "czech-macaw") + 1)
    : artifacts.slice(0, firstLoadingPosition).filter((artifact) => !loadingFramePath(artifact)).length;
  const loadingArtifacts = sequences.flatMap((sequence) =>
    sequence.sprites.map((frame) => {
      const source = join(frameDirectory, frame.path);
      const existing = existingFrames.get(frame.path) || {};
      const padded = String(frame.index).padStart(3, "0");
      const encodedPath = frame.path.split("/").map(encodeURIComponent).join("/");
      return {
        ...existing,
        key: `loading-animation-${sequence.id}-${padded}`,
        label: `${sequence.id.replaceAll("-", " ")} animation frame ${frame.index}`,
        artifact_kind: "visual-asset",
        url: `${publicPrefix}${encodedPath}`,
        asset_path: `assets/loading_animation/${frame.path}`,
        bytes: statSync(source).size,
        sha256: sha256File(source),
        native_required: existing.native_required ?? true,
        browser_required: existing.browser_required ?? true
      };
    })
  );

  return {
    ...manifest,
    artifacts: [
      ...retained.slice(0, insertionPosition),
      ...loadingArtifacts,
      ...retained.slice(insertionPosition)
    ]
  };
}

export function synchronizeLoadingAnimationManifests({
  workspaceRoot = defaultWorkspaceRoot,
  frameDirectory = join(workspaceRoot, "apps/launcher/static/assets/loading-animation"),
  animationManifestPath = join(frameDirectory, "animations_manifest.json"),
  setupManifestPath = join(workspaceRoot, "apps/languages/czech/static/setup-assets.json"),
  check = false
} = {}) {
  const sequences = listLoadingAnimationSequences(frameDirectory);
  const desiredAnimationManifest = animationManifestText(sequences);
  const setupManifest = JSON.parse(readFileSync(setupManifestPath, "utf8"));
  const desiredSetupManifest = `${JSON.stringify(
    synchronizedSetupManifest(setupManifest, sequences, frameDirectory),
    null,
    2
  )}\n`;
  const animationManifestChanged = !existsSync(animationManifestPath) ||
    readFileSync(animationManifestPath, "utf8") !== desiredAnimationManifest;
  const setupManifestChanged = readFileSync(setupManifestPath, "utf8") !== desiredSetupManifest;

  if (!check) {
    if (animationManifestChanged) writeAtomic(animationManifestPath, desiredAnimationManifest);
    if (setupManifestChanged) writeAtomic(setupManifestPath, desiredSetupManifest);
  }
  return {
    frameCount: sequences.reduce((total, sequence) => total + sequence.count, 0),
    sequences: sequences.map((sequence) => ({
      id: sequence.id,
      folder: sequence.folder,
      count: sequence.count,
      frameIndices: sequence.sprites.map((frame) => frame.index)
    })),
    animationManifestChanged,
    setupManifestChanged
  };
}

function parseArgs(args) {
  const parsed = { check: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--check") {
      parsed.check = true;
      continue;
    }
    if (argument === "--workspace-root") {
      parsed.workspaceRoot = args[index + 1];
      if (!parsed.workspaceRoot) throw new Error("--workspace-root requires a value");
      index += 1;
      continue;
    }
    if (argument === "--help" || argument === "-h") {
      parsed.help = true;
      continue;
    }
    throw new Error(`Unknown option: ${argument}`);
  }
  return parsed;
}

function printHelp() {
  console.log(`Usage: node apps/runtime/tooling/sync-loading-animation-assets.mjs [options]

Synchronize animations_manifest.json and setup-assets.json from numbered PNG files
inside loading-animation/animation* folders. Numeric gaps are preserved.

Options:
  --check                Report drift without writing files
  --workspace-root PATH  Override the repository root
  -h, --help             Show this help`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  const report = synchronizeLoadingAnimationManifests({
    workspaceRoot: resolve(args.workspaceRoot || defaultWorkspaceRoot),
    check: args.check
  });
  const changed = report.animationManifestChanged || report.setupManifestChanged;
  if (args.check && changed) {
    console.error(`Loading animation manifests are stale for ${report.frameCount} available frames.`);
    process.exitCode = 1;
    return;
  }
  console.log(
    changed
      ? `Synchronized ${report.sequences.length} loading animations with ${report.frameCount} frames.`
      : `Loading animation manifests are current (${report.sequences.length} animations, ${report.frameCount} frames).`
  );
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  });
}
