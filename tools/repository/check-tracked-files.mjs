#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";
import { dirname, extname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDir, "..", "..");
const maximumFileBytes = 20 * 1024 * 1024;
const allowedRootMarkdown = new Set(["AGENTS.md", "CHANGELOG.md", "README.md"]);

const paths = listRepositoryCandidates();
const failures = [];

for (const path of paths) {
  const normalized = path.replaceAll("\\", "/");
  const absolutePath = resolve(repositoryRoot, path);
  let stat;

  try {
    stat = statSync(absolutePath);
  } catch {
    continue;
  }

  if (!stat.isFile()) continue;

  if (isForbiddenPath(normalized)) {
    failures.push(`${normalized}: forbidden generated, secret, dependency, or research path`);
  }

  if (stat.size > maximumFileBytes) {
    failures.push(
      `${normalized}: ${(stat.size / 1024 / 1024).toFixed(2)} MiB exceeds the 20 MiB source-file limit`
    );
  }

  if (!normalized.includes("/") && extname(normalized).toLowerCase() === ".md") {
    if (!allowedRootMarkdown.has(normalized)) {
      failures.push(`${normalized}: project documentation belongs under docs/ or .github/`);
    }
  }
}

if (failures.length > 0) {
  console.error("Repository file policy failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Repository file policy passed for ${paths.length} tracked and candidate files.`);

function listRepositoryCandidates() {
  const output = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: repositoryRoot }
  );

  return [...new Set(output.toString("utf8").split("\0").filter(Boolean))].sort();
}

function isForbiddenPath(path) {
  return (
    /^(?:artifacts|secrets)\//u.test(path) ||
    /^tools\/images-generation\//u.test(path) ||
    /^demos\/[^/]+\/research\/[^/]+\//u.test(path) ||
    /(?:^|\/)(?:node_modules|target|target-linux|build|dist|\.venv|venv)(?:\/|$)/u.test(path) ||
    /(?:^|\/)\.env(?:\.|$)/u.test(path) ||
    /\.(?:jks|keystore|zip)$/iu.test(path)
  );
}
