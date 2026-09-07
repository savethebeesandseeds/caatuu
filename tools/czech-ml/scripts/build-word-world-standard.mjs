#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import {
  RUNTIME_MANIFEST_SCHEMA_VERSION,
  RUNTIME_SCHEMA_VERSION,
  applyEditorialOverrides,
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
import { applyTokenMeanings } from "./word-world-token-meanings.mjs";

// Ordinary builds use the same per-course JSON as every other Word World
// course. Explicit legacy inputs remain available for historical import tests.
const legacyInputFlags = ["--input-file", "--input-dir", "--editorial-overrides", "--token-meanings", "--rubric"];
if (!legacyInputFlags.some(flag => process.argv.includes(flag))) {
  const { buildWordWorldContent, planWordWorldContent } = await import("../../language-content/build-word-world-content.mjs");
  if (process.argv.includes("--runtime-root") || process.argv.includes("--coverage-report")) {
    const [plan] = await planWordWorldContent({ courseId: "cz" });
    const outputRoot = path.resolve(argValue("--runtime-root", path.join(appDataRoot, "games", "word-world")));
    const coveragePath = path.resolve(argValue("--coverage-report", fromRoot("data", "word-world", "standard-v0.1", "reports", "coverage.json")));
    for (const [file, bytes] of plan.outputs) {
      const destination = file.endsWith("/reports/coverage.json") ? coveragePath
        : file.includes("/static/data/games/word-world/") ? path.join(outputRoot, path.basename(file)) : null;
      if (!destination) continue;
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.writeFile(destination, bytes);
    }
    console.log(JSON.stringify({ source: plan.sourcePath, records: plan.recordCount, outputRoot, coveragePath }));
  } else {
    const report = await buildWordWorldContent({ courseId: "cz", check: process.argv.includes("--check") });
    console.log(JSON.stringify(report));
    if (report.check && report.changes.length) process.exitCode = 1;
  }
  process.exit(process.exitCode ?? 0);
}

const datasetDir = fromRoot("data", "word-world", "standard-v0.1");
const rubricFile = path.resolve(argValue("--rubric", path.join(datasetDir, "rubric.json")));
const editorialOverridesFile = path.resolve(argValue("--editorial-overrides", path.join(datasetDir, "editorial-overrides.json")));
const tokenMeaningsFile = path.resolve(argValue("--token-meanings", path.join(datasetDir, "token-meanings.json")));
const runtimeRoot = path.resolve(argValue("--runtime-root", path.join(appDataRoot, "games", "word-world")));
const coverageFile = path.resolve(argValue("--coverage-report", path.join(datasetDir, "reports", "coverage.json")));
const rubric = await readJson(rubricFile);
const editorialOverrides = await readJson(editorialOverridesFile);
const tokenMeanings = await readJson(tokenMeaningsFile);
const tokenMeaningsEvidence = {
  file: path.relative(caatuuRoot, tokenMeaningsFile).replaceAll("\\", "/"),
  sha256: sha256(await fs.readFile(tokenMeaningsFile)),
  recordCount: tokenMeanings.records.length,
  review: tokenMeanings.review,
};
const editorialOverridesRelativeFile = path.relative(caatuuRoot, editorialOverridesFile).replaceAll("\\", "/");
const editorialOverridesSha256 = sha256(await fs.readFile(editorialOverridesFile));
const editorialOverrideEvidence = {
  file: editorialOverridesRelativeFile,
  sha256: editorialOverridesSha256,
  overrideCount: editorialOverrides.overrides.length,
  reviewedOn: editorialOverrides.editorialPass.reviewedOn,
  humanApproved: editorialOverrides.editorialPass.humanApproved,
};
const runtimeBaseRelativeFile = "content.json";
const runtimeFile = path.join(runtimeRoot, ...runtimeBaseRelativeFile.split("/"));
const manifestFile = path.join(runtimeRoot, "manifest.json");
const inputFiles = await resolveInputFiles();
const sourceRecords = (await Promise.all(inputFiles.map(readJsonl))).flat().sort((left, right) => left.id.localeCompare(right.id));
const records = applyEditorialOverrides(sourceRecords, editorialOverrides);
const validation = validateRecords(records, rubric);
const relativeInputs = inputFiles.map((file) => path.relative(caatuuRoot, file));
const reportedInputs = [...relativeInputs, editorialOverridesRelativeFile, tokenMeaningsEvidence.file];
const coverage = buildCoverageReport(records, rubric, validation, reportedInputs, editorialOverrideEvidence);
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
  const runtimeRecords = applyTokenMeanings(records.map(toRuntimeRecord), tokenMeanings);
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
    sessionProvider: {
      kind: "standard-corpus",
      module: "source/games/word-world/word-net-standard.mjs?v=word-net-standard-6",
      meaningSelectorModule: "/language-runtime/static/source/word-net-core.mjs?v=word-net-core-21",
    },
    features: {
      wordMeanings: true,
    },
    generationStrategy: {
      id: "czech-local-word-world-v1",
      targetLanguageTag: "cs-CZ",
      auditLanguageTag: "en",
      sentenceModelKey: "cstinyllama-1.2b-czech-word-sentence-001",
      translationModelKey: "qwen3-1.7b-translation-cs-en-001",
    },
    embeddingPolicy: {
      inputLanguage: "en",
      inputField: "embeddingText",
      targetTextAllowed: false,
      modelId: "all-minilm-l6-v2-qint8-v0.1",
      fallback: "deterministic-lexical",
    },
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
    editorialOverrides: editorialOverrideEvidence,
    tokenMeanings: tokenMeaningsEvidence,
    authoringSchema: "caatuu-word-world-record-v1",
  };

  await writeJson(runtimeFile, pack, { compact: true });
  await writeJson(manifestFile, manifest);
  console.log(JSON.stringify({
    inputFiles: reportedInputs,
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
