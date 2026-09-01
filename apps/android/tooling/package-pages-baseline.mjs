#!/usr/bin/env node

import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  defaultPagesBaselineDescriptor,
  packagePagesBaseline
} from "./pages-baseline.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const defaultWorkspaceRoot = resolve(dirname(scriptPath), "../../..");

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") return { help: true };
    const value = argv[index + 1];
    assert.ok(value && !value.startsWith("--"), `${argument} requires a value`);
    index += 1;
    if (argument === "--workspace-root") options.workspaceRoot = resolve(value);
    else if (argument === "--descriptor") options.descriptorPath = resolve(value);
    else if (argument === "--output") options.outputPath = resolve(value);
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

function printHelp() {
  process.stdout.write(
    "Usage: node apps/android/tooling/package-pages-baseline.mjs "
      + "[--workspace-root DIR] [--descriptor FILE] [--output FILE]\n"
  );
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  const workspaceRoot = options.workspaceRoot || defaultWorkspaceRoot;
  const descriptorPath = options.descriptorPath || defaultPagesBaselineDescriptor;
  const result = packagePagesBaseline({
    workspaceRoot,
    descriptorPath,
    outputPath: options.outputPath
  });
  process.stdout.write(`${JSON.stringify({
    outputPath: result.outputPath,
    bytes: result.bytes,
    sha256: result.sha256,
    reused: result.reused,
    releaseTag: result.descriptor.releaseArchive.tag,
    releaseAsset: result.descriptor.releaseArchive.assetName,
    stableVersionCode: result.descriptor.stable.versionCode,
    compatibilityVersionCode: result.descriptor.compatibility.versionCode,
    archivedFiles: result.manifest.files.length
  }, null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(scriptPath)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
