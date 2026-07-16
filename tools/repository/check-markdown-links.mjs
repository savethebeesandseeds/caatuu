#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDir, "..", "..");
const candidates = listRepositoryCandidates();
const candidateSet = new Set(candidates.map(normalize));
const markdownFiles = candidates.filter((path) => path.toLowerCase().endsWith(".md"));
const failures = [];

for (const markdownPath of markdownFiles) {
  const absoluteMarkdownPath = resolve(repositoryRoot, markdownPath);
  if (!existsSync(absoluteMarkdownPath)) continue;

  const lines = readFileSync(absoluteMarkdownPath, "utf8").split(/\r?\n/u);
  let inFence = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^\s*```/u.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const linkPattern = /!?\[[^\]]*\]\(([^)]+)\)/gu;
    for (const match of line.matchAll(linkPattern)) {
      const target = parseTarget(match[1]);
      if (!target || shouldSkip(target)) continue;

      const pathOnly = target.split("#", 1)[0].split("?", 1)[0];
      if (!pathOnly) continue;

      let decoded;
      try {
        decoded = decodeURIComponent(pathOnly);
      } catch {
        failures.push(`${markdownPath}:${index + 1}: invalid URL encoding in ${target}`);
        continue;
      }

      const absoluteTarget = resolve(dirname(absoluteMarkdownPath), decoded);
      const repositoryRelative = normalize(relative(repositoryRoot, absoluteTarget));

      if (repositoryRelative === ".." || repositoryRelative.startsWith("../")) {
        failures.push(`${markdownPath}:${index + 1}: link leaves the repository: ${target}`);
        continue;
      }

      if (!isCandidateTarget(repositoryRelative, absoluteTarget)) {
        failures.push(`${markdownPath}:${index + 1}: missing repository target: ${target}`);
      }
    }
  }
}

if (failures.length > 0) {
  console.error("Markdown link check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Markdown link check passed for ${markdownFiles.length} files.`);

function listRepositoryCandidates() {
  const output = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: repositoryRoot }
  );
  return [...new Set(output.toString("utf8").split("\0").filter(Boolean))].sort();
}

function normalize(path) {
  return path.split(sep).join("/").replaceAll("\\", "/");
}

function parseTarget(rawTarget) {
  const trimmed = rawTarget.trim();
  if (trimmed.startsWith("<")) {
    const end = trimmed.indexOf(">");
    return end >= 0 ? trimmed.slice(1, end) : trimmed.slice(1);
  }
  return trimmed.split(/\s+/u, 1)[0];
}

function shouldSkip(target) {
  return (
    target.startsWith("#") ||
    target.startsWith("/") ||
    /^[a-z][a-z0-9+.-]*:/iu.test(target) ||
    /^[a-z]:[\\/]/iu.test(target)
  );
}

function isCandidateTarget(repositoryRelative, absoluteTarget) {
  if (candidateSet.has(repositoryRelative)) return true;
  if (!existsSync(absoluteTarget)) return false;

  try {
    if (!statSync(absoluteTarget).isDirectory()) return false;
  } catch {
    return false;
  }

  const prefix = repositoryRelative.endsWith("/") ? repositoryRelative : `${repositoryRelative}/`;
  return candidates.some((path) => normalize(path).startsWith(prefix));
}
