#!/usr/bin/env node
import path from "node:path";
import {
  RUNTIME_MANIFEST_SCHEMA_VERSION,
  RUNTIME_SCHEMA_VERSION,
  buildCoverageReport,
  findJsonlFiles,
  readJson,
  readJsonl,
  sha256,
  toRuntimeRecord,
  validateRecords,
  writeJson,
} from "./word-world-standard-lib.mjs";
import { appDataRoot, caatuuRoot, fromRoot } from "./paths.mjs";

const datasetDir = fromRoot("data", "word-world", "standard-v0.1");
const rubricFile = path.resolve(argValue("--rubric", path.join(datasetDir, "rubric.json")));
const runtimeRoot = path.resolve(argValue("--runtime-root", path.join(appDataRoot, "word-world")));
const coverageFile = path.resolve(argValue("--coverage-report", path.join(datasetDir, "reports", "coverage.json")));
const rubric = await readJson(rubricFile);
const runtimeBaseRelativeFile = `${rubric.corpusVersion}/records.json`;
const runtimeFile = path.join(runtimeRoot, ...runtimeBaseRelativeFile.split("/"));
const manifestFile = path.join(runtimeRoot, "manifest.json");
const inputFiles = await resolveInputFiles();
const records = (await Promise.all(inputFiles.map(readJsonl))).flat().sort((left, right) => left.id.localeCompare(right.id));
const validation = validateRecords(records, rubric);
const relativeInputs = inputFiles.map((file) => path.relative(caatuuRoot, file));
const coverage = buildCoverageReport(records, rubric, validation, relativeInputs);
await writeJson(coverageFile, coverage);

if (!validation.valid) {
  console.error(JSON.stringify({
    message: "Word World Standard compilation stopped because validation failed.",
    errors: validation.errors,
    warnings: validation.warnings,
    coverageFile,
  }, null, 2));
  process.exitCode = 1;
} else {
  const runtimeRecords = records.map(toRuntimeRecord);
  const pack = {
    schemaVersion: RUNTIME_SCHEMA_VERSION,
    corpusVersion: rubric.corpusVersion,
    records: runtimeRecords,
  };
  const packFileText = `${JSON.stringify(pack)}\n`;
  const contentSha256 = sha256(packFileText);
  // The physical file stays stable for simple packaging, while its public URL
  // is content-addressed. Installed service workers can therefore never serve
  // an older corpus under a newly published manifest.
  const runtimeRelativeFile = `${runtimeBaseRelativeFile}?v=${contentSha256.slice(0, 16)}`;
  const difficultyDistribution = coverage.records.byDifficulty;
  const manifest = {
    schemaVersion: RUNTIME_MANIFEST_SCHEMA_VERSION,
    corpusVersion: rubric.corpusVersion,
    mode: "standard",
    runtimeFile: runtimeRelativeFile,
    recordCount: runtimeRecords.length,
    contentSha256,
    difficultyDistribution,
    difficultyShare: coverage.records.difficultyShare,
    minimumLevel2Share: rubric.distribution.minimumLevel2Share,
    minimumLevel3Records: rubric.distribution.minimumLevel3Records,
    playableTargets: coverage.targets.uniquePlayable,
    branchability: {
      branchableMinimumRecords: rubric.branchability.branchableTargetMinimumRecords,
      branchableTargets: coverage.targets.branchable.targetCount,
      strongMinimumRecords: rubric.branchability.strongTargetMinimumRecords,
      strongTargets: coverage.targets.strong.targetCount,
    },
    translationIncluded: true,
    sceneQueriesIncluded: true,
    reviewStatus: "codex_reviewed",
    humanApproved: false,
    authoringSchema: "caatuu-word-world-record-v1",
  };

  await writeJson(runtimeFile, pack, { compact: true });
  await writeJson(manifestFile, manifest);
  console.log(JSON.stringify({
    inputFiles: relativeInputs,
    records: runtimeRecords.length,
    runtimeFile,
    manifestFile,
    coverageFile,
    contentSha256: manifest.contentSha256,
    warnings: validation.warnings,
  }, null, 2));
}

async function resolveInputFiles() {
  const explicit = argValues("--input-file").map((file) => path.resolve(file));
  if (explicit.length) return [...new Set(explicit)].sort();
  const inputDirectory = path.resolve(argValue("--input-dir", path.join(datasetDir, "source")));
  return findJsonlFiles(inputDirectory);
}

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function argValues(name) {
  return process.argv.flatMap((value, index) => value === name && process.argv[index + 1] ? [process.argv[index + 1]] : []);
}
