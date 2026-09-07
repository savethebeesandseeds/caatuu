#!/usr/bin/env node
import path from "node:path";
import {
  findJsonlFiles,
  readJson,
  readJsonl,
  validateRecords,
  writeJson,
} from "./word-world-standard-lib.mjs";
import { caatuuRoot, fromRoot } from "./paths.mjs";

if (!["--input-file", "--input-dir", "--rubric"].some(flag => process.argv.includes(flag))) {
  const { loadWordWorldContent, readRepositoryJson, czechRuntimeRecords } = await import("../../language-content/lib/word-world-course-content.mjs");
  const course = await readRepositoryJson(caatuuRoot, "apps/languages/czech/course.json");
  const { document, sourcePath } = await loadWordWorldContent(course);
  const rubric = await readRepositoryJson(caatuuRoot, "tools/czech-ml/data/word-world/standard-v0.1/rubric.json");
  const { runtime, validation } = czechRuntimeRecords(document, rubric);
  await writeJson(path.resolve(argValue("--report", fromRoot("data", "word-world", "standard-v0.1", "reports", "validation.json"))), {
    schemaVersion: "caatuu-word-world-validation-v1", corpusVersion: document.metadata.corpusVersion,
    inputFiles: [sourcePath], ...validation
  });
  console.log(JSON.stringify({ sourcePath, recordCount: runtime.length, ...validation }));
  process.exit(validation.valid ? 0 : 1);
}

const datasetDir = fromRoot("data", "word-world", "standard-v0.1");
const rubricFile = path.resolve(argValue("--rubric", path.join(datasetDir, "rubric.json")));
const reportFile = path.resolve(argValue("--report", path.join(datasetDir, "reports", "validation.json")));
const inputFiles = await resolveInputFiles();
const rubric = await readJson(rubricFile);
const records = (await Promise.all(inputFiles.map(readJsonl))).flat().sort((left, right) => left.id.localeCompare(right.id));
const validation = validateRecords(records, rubric);
const relativeInputs = inputFiles.map((file) => path.relative(caatuuRoot, file));
const report = {
  schemaVersion: "caatuu-word-world-validation-v1",
  corpusVersion: rubric.corpusVersion,
  inputFiles: relativeInputs.map((file) => file.replaceAll("\\", "/")),
  ...validation,
};

await writeJson(reportFile, report);
console.log(JSON.stringify({
  inputFiles: relativeInputs,
  recordCount: records.length,
  valid: validation.valid,
  errors: validation.errors,
  warnings: validation.warnings,
  reportFile,
}, null, 2));

if (!validation.valid) process.exitCode = 1;

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
