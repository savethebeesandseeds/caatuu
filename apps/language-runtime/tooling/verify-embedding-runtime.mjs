#!/usr/bin/env node
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  validateEmbeddingRuntimeCatalog
} from "../static/source/embedding-runtime-contract.mjs";

const runtimeRoot = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const catalogFile = path.join(runtimeRoot, "embedding-runtimes.json");

async function sha256(file) {
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => {
    const stream = createReadStream(file);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex");
}

function confinedArtifactFile(root, repositoryPath) {
  const file = path.resolve(root, ...repositoryPath.split("/"));
  const relative = path.relative(root, file);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Embedding artifact escapes apps/language-runtime: ${repositoryPath}`);
  }
  return file;
}

export async function verifyEmbeddingRuntimeAssets({
  root = runtimeRoot,
  catalogPath = path.join(root, "embedding-runtimes.json")
} = {}) {
  const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
  validateEmbeddingRuntimeCatalog(catalog);
  let artifactCount = 0;
  let totalBytes = 0;
  for (const runtime of catalog.runtimes) {
    for (const artifact of runtime.artifacts) {
      const file = confinedArtifactFile(root, artifact.path);
      const fileStat = await stat(file);
      if (!fileStat.isFile()) throw new Error(`Embedding artifact is not a file: ${artifact.path}`);
      if (fileStat.size !== artifact.bytes) {
        throw new Error(`Embedding artifact byte mismatch for ${artifact.path}: expected ${artifact.bytes}, found ${fileStat.size}.`);
      }
      const actualHash = await sha256(file);
      if (actualHash !== artifact.sha256) {
        throw new Error(`Embedding artifact SHA-256 mismatch for ${artifact.path}.`);
      }
      artifactCount += 1;
      totalBytes += fileStat.size;
    }
  }
  return Object.freeze({
    schemaVersion: catalog.schemaVersion,
    runtimeCount: catalog.runtimes.length,
    artifactCount,
    totalBytes
  });
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  verifyEmbeddingRuntimeAssets()
    .then((summary) => process.stdout.write(`${JSON.stringify(summary)}\n`))
    .catch((error) => {
      process.stderr.write(`Shared embedding runtime verification failed: ${error.message}\n`);
      process.exitCode = 1;
    });
}
