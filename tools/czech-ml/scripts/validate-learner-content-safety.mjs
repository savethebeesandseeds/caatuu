#!/usr/bin/env node

import path from "node:path";
import { scanShippedLearnerContent } from "./learner-content-safety-lib.mjs";
import { caatuuRoot } from "./paths.mjs";

try {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    console.log("Usage: node tools/czech-ml/scripts/validate-learner-content-safety.mjs [--repo-root <path>] [--compact]");
  } else {
    const report = await scanShippedLearnerContent(options.repoRoot);
    console.log(JSON.stringify(report, null, options.compact ? 0 : 2));
    if (!report.valid) process.exitCode = 1;
  }
} catch (error) {
  console.error(JSON.stringify({
    schemaVersion: "caatuu-learner-content-safety-error-v1",
    valid: false,
    error: error instanceof Error ? error.message : String(error),
  }, null, 2));
  process.exitCode = 1;
}

function parseArguments(argv) {
  const options = { compact: false, help: false, repoRoot: caatuuRoot };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      options.help = true;
      continue;
    }
    if (argument === "--compact") {
      options.compact = true;
      continue;
    }
    if (argument !== "--repo-root") throw new Error(`Unknown option: ${argument}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error("--repo-root requires a path");
    options.repoRoot = path.resolve(value);
    index += 1;
  }
  return options;
}
