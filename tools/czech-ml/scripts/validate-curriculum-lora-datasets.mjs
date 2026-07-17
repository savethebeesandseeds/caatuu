#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fromModels } from "./paths.mjs";

const datasetDirs = [
  path.resolve(fromModels("czech-finetuned", "training-data", "translation-cs-en-001")),
  path.resolve(fromModels("czech-finetuned", "training-data", "czech-word-sentence-001")),
];

const reports = [];
const errors = [];

for (const dir of datasetDirs) {
  const train = await readJsonl(path.join(dir, "train.jsonl"));
  const validation = await readJsonl(path.join(dir, "val.jsonl"));
  const trainAll = await readJsonl(path.join(dir, "train_all.jsonl"));
  const benchmark = await readJsonl(path.join(dir, "benchmark.jsonl"));
  const summary = JSON.parse(await fs.readFile(path.join(dir, "summary.json"), "utf8"));
  const task = summary.task;
  const report = {
    dir,
    task,
    train_examples: train.length,
    validation_examples: validation.length,
    train_all_examples: trainAll.length,
    benchmark_examples: benchmark.length,
    validation_errors: [],
  };

  compareCount(summary, "train_examples", train.length, report.validation_errors);
  compareCount(summary, "validation_examples", validation.length, report.validation_errors);
  compareCount(summary, "train_all_examples", trainAll.length, report.validation_errors);
  compareCount(summary, "benchmark_examples", benchmark.length, report.validation_errors);

  for (const [split, rows] of [["train", train], ["validation", validation]]) {
    for (const [index, row] of rows.entries()) {
      const label = `${path.basename(dir)} ${split}:${index + 1}`;
      validatePromptCompletion(row, label, report.validation_errors);
      if (task === "translation_cs_en") validateTranslationRow(row, label, report.validation_errors);
      if (task === "czech_word_sentence") validateWordSentenceRow(row, label, report.validation_errors);
    }
  }

  for (const [index, row] of benchmark.entries()) {
    const label = `${path.basename(dir)} benchmark:${index + 1}`;
    if (!String(row.prompt || "").trim()) report.validation_errors.push(`${label}: blank prompt`);
    if (task === "translation_cs_en" && !String(row.expected_english_text || "").trim()) {
      report.validation_errors.push(`${label}: blank expected_english_text`);
    }
    if (task === "czech_word_sentence" && !String(row.word || "").trim()) {
      report.validation_errors.push(`${label}: blank benchmark word`);
    }
  }

  validateTrainAll(train, validation, trainAll, report.validation_errors);
  if (task === "translation_cs_en") {
    report.split_checks = validateTranslationSplits(train, validation, benchmark, report.validation_errors);
  } else if (task === "czech_word_sentence") {
    report.split_checks = validateWordSentenceSplits(train, validation, benchmark, summary, report.validation_errors);
  } else {
    report.validation_errors.push(`Unknown task ${task}`);
  }

  errors.push(...report.validation_errors);
  reports.push(report);
}

console.log(JSON.stringify({
  generated_at: new Date().toISOString(),
  datasets: reports,
  validation_errors: errors,
}, null, 2));

if (errors.length) process.exit(1);

async function readJsonl(file) {
  const text = await fs.readFile(file, "utf8");
  return text.split(/\r?\n/).filter((line) => line.trim()).map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`${file}:${index + 1}: ${error.message}`);
    }
  });
}

function compareCount(summary, field, actual, validationErrors) {
  if (summary[field] !== actual) {
    validationErrors.push(`summary ${field} ${summary[field]} does not match rows ${actual}`);
  }
}

function validatePromptCompletion(row, label, validationErrors) {
  if (!String(row.prompt || "").trim()) validationErrors.push(`${label}: blank prompt`);
  if (!String(row.completion || "").trim()) validationErrors.push(`${label}: blank completion`);
  if (!String(row.completion || "").startsWith(" ")) validationErrors.push(`${label}: completion must start with one leading space`);
  if (/undefined|null|\[object Object\]/u.test(`${row.prompt}\n${row.completion}`)) {
    validationErrors.push(`${label}: generated JavaScript placeholder text`);
  }
}

function validateTranslationRow(row, label, validationErrors) {
  if (row.task !== "translation_cs_en") validationErrors.push(`${label}: wrong task ${row.task}`);
  if (!String(row.czech_text || "").trim()) validationErrors.push(`${label}: blank czech_text`);
  if (!String(row.english_text || "").trim()) validationErrors.push(`${label}: blank english_text`);
  if (!String(row.prompt || "").includes(row.czech_text)) validationErrors.push(`${label}: prompt does not include czech_text`);
  if (String(row.completion || "").trim() !== String(row.english_text || "").trim()) {
    validationErrors.push(`${label}: completion is not the English text`);
  }
}

function validateWordSentenceRow(row, label, validationErrors) {
  if (row.task !== "czech_word_sentence") validationErrors.push(`${label}: wrong task ${row.task}`);
  const word = normalizeCs(row.word);
  const sentence = String(row.completion || "").trim();
  if (!word) validationErrors.push(`${label}: blank word`);
  if (!sentence) validationErrors.push(`${label}: blank sentence`);
  if (word && !tokenSet(sentence).has(word)) {
    validationErrors.push(`${label}: sentence does not contain target word ${word}`);
  }
  if (/slovo|v[ěe]ta se slovem|objevuje|obsahuje/u.test(asciiFold(sentence))) {
    validationErrors.push(`${label}: sentence contains meta-language`);
  }
}

function validateTrainAll(train, validation, trainAll, validationErrors) {
  const expected = new Map([...train, ...validation].map((row) => [promptCompletionKey(row), row]));
  const actual = new Map(trainAll.map((row) => [promptCompletionKey(row), row]));
  if (expected.size !== train.length + validation.length) {
    validationErrors.push("train + validation contain duplicate prompt/completion rows");
  }
  if (actual.size !== trainAll.length) {
    validationErrors.push("train_all contains duplicate prompt/completion rows");
  }
  if (expected.size !== actual.size || [...expected.keys()].some((key) => !actual.has(key))) {
    validationErrors.push("train_all is not exactly the union of train and validation");
  }
}

function validateTranslationSplits(train, validation, benchmark, validationErrors) {
  const trainKeys = uniqueKeySet(train, translationPairKey, "translation train", validationErrors);
  const validationKeys = uniqueKeySet(validation, translationPairKey, "translation validation", validationErrors);
  const benchmarkKeys = uniqueKeySet(benchmark, translationPairKey, "translation benchmark", validationErrors);
  const trainValidationOverlap = intersectionSize(trainKeys, validationKeys);
  const trainBenchmarkOverlap = intersectionSize(trainKeys, benchmarkKeys);
  const validationBenchmarkOverlap = intersectionSize(validationKeys, benchmarkKeys);
  const trainSources = uniqueKeySet(train, translationSourceKey, "translation train Czech sources", validationErrors);
  const validationSources = uniqueKeySet(validation, translationSourceKey, "translation validation Czech sources", validationErrors);
  const benchmarkSources = uniqueKeySet(benchmark, translationSourceKey, "translation benchmark Czech sources", validationErrors);
  const trainValidationSourceOverlap = intersectionSize(trainSources, validationSources);
  const trainBenchmarkSourceOverlap = intersectionSize(trainSources, benchmarkSources);
  const validationBenchmarkSourceOverlap = intersectionSize(validationSources, benchmarkSources);
  if (trainValidationOverlap) validationErrors.push(`translation train/validation overlap: ${trainValidationOverlap}`);
  if (trainBenchmarkOverlap) validationErrors.push(`translation train/benchmark overlap: ${trainBenchmarkOverlap}`);
  if (validationBenchmarkOverlap) validationErrors.push(`translation validation/benchmark overlap: ${validationBenchmarkOverlap}`);
  if (trainValidationSourceOverlap) validationErrors.push(`translation train/validation Czech-source overlap: ${trainValidationSourceOverlap}`);
  if (trainBenchmarkSourceOverlap) validationErrors.push(`translation train/benchmark Czech-source overlap: ${trainBenchmarkSourceOverlap}`);
  if (validationBenchmarkSourceOverlap) validationErrors.push(`translation validation/benchmark Czech-source overlap: ${validationBenchmarkSourceOverlap}`);
  if (benchmark.some((row) => row.split !== "test")) {
    validationErrors.push("translation benchmark rows must use split=test");
  }
  return {
    train_validation_pair_overlap: trainValidationOverlap,
    train_test_pair_overlap: trainBenchmarkOverlap,
    validation_test_pair_overlap: validationBenchmarkOverlap,
    train_validation_czech_source_overlap: trainValidationSourceOverlap,
    train_test_czech_source_overlap: trainBenchmarkSourceOverlap,
    validation_test_czech_source_overlap: validationBenchmarkSourceOverlap,
  };
}

function validateWordSentenceSplits(train, validation, benchmark, summary, validationErrors) {
  uniqueKeySet(train, promptCompletionKey, "word-sentence train", validationErrors);
  uniqueKeySet(validation, promptCompletionKey, "word-sentence validation", validationErrors);
  const trainWords = new Set(train.map((row) => normalizeCs(row.word)));
  const validationWords = new Set(validation.map((row) => normalizeCs(row.word)));
  const targetOverlap = intersectionSize(trainWords, validationWords);
  if (targetOverlap) validationErrors.push(`word-sentence train/validation target overlap: ${targetOverlap}`);

  const benchmarkWords = uniqueKeySet(benchmark, (row) => normalizeCs(row.word), "word-sentence benchmark", validationErrors);
  let seenRows = 0;
  let unseenRows = 0;
  for (const row of benchmark) {
    const word = normalizeCs(row.word);
    if (row.split === "seen") {
      seenRows += 1;
      if (!trainWords.has(word)) validationErrors.push(`seen benchmark target is absent from training: ${word}`);
      if (!(Number(row.training_hits) > 0)) validationErrors.push(`seen benchmark target has invalid training_hits: ${word}`);
    } else if (row.split === "unseen") {
      unseenRows += 1;
      if (trainWords.has(word)) validationErrors.push(`unseen benchmark target leaked into training: ${word}`);
      if (validationWords.has(word)) validationErrors.push(`unseen benchmark target leaked into validation: ${word}`);
      if (Number(row.training_hits) !== 0) validationErrors.push(`unseen benchmark target has nonzero training_hits: ${word}`);
    } else {
      validationErrors.push(`word-sentence benchmark target ${word} has invalid split ${row.split}`);
    }
  }
  if (seenRows !== summary.benchmark_seen_words) {
    validationErrors.push(`summary benchmark_seen_words ${summary.benchmark_seen_words} does not match ${seenRows}`);
  }
  if (unseenRows !== summary.benchmark_unseen_words) {
    validationErrors.push(`summary benchmark_unseen_words ${summary.benchmark_unseen_words} does not match ${unseenRows}`);
  }

  const counts = countBy(train, (row) => normalizeCs(row.word));
  const maxCount = Math.max(0, ...counts.values());
  if (maxCount > summary.max_examples_per_word) {
    validationErrors.push(`word-sentence training target count ${maxCount} exceeds cap ${summary.max_examples_per_word}`);
  }
  return {
    train_validation_target_overlap: targetOverlap,
    benchmark_unique_words: benchmarkWords.size,
    seen_benchmark_words: seenRows,
    unseen_benchmark_words: unseenRows,
    maximum_training_examples_per_word: maxCount,
  };
}

function uniqueKeySet(rows, keyFn, label, validationErrors) {
  const keys = new Set();
  let duplicates = 0;
  for (const row of rows) {
    const key = keyFn(row);
    if (keys.has(key)) duplicates += 1;
    keys.add(key);
  }
  if (duplicates) validationErrors.push(`${label} contains ${duplicates} duplicate row(s)`);
  return keys;
}

function intersectionSize(left, right) {
  let count = 0;
  for (const value of left) if (right.has(value)) count += 1;
  return count;
}

function countBy(rows, keyFn) {
  const counts = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

function promptCompletionKey(row) {
  return `${String(row.prompt || "").trim()}\n${String(row.completion || "").trim()}`;
}

function translationPairKey(row) {
  const englishText = row.english_text || row.expected_english_text;
  return `${normalizeText(row.czech_text, "cs-CZ")}\n${normalizeText(englishText, "en-US")}`;
}

function translationSourceKey(row) {
  return normalizeText(row.czech_text, "cs-CZ");
}

function normalizeText(text, locale) {
  return String(text || "").normalize("NFC").toLocaleLowerCase(locale).replace(/\s+/gu, " ").trim();
}

function normalizeCs(text) {
  return normalizeText(text, "cs-CZ");
}

function tokenSet(text) {
  return new Set(Array.from(String(text || "").matchAll(/\p{L}+(?:[-']\p{L}+)?/gu), (match) => normalizeCs(match[0])));
}

function asciiFold(text) {
  return normalizeCs(text).normalize("NFD").replace(/\p{M}/gu, "");
}
