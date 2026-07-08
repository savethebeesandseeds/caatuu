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
  const benchmark = await readJsonl(path.join(dir, "benchmark.jsonl"));
  const summary = JSON.parse(await fs.readFile(path.join(dir, "summary.json"), "utf8"));
  const task = summary.task;
  const report = {
    dir,
    task,
    train_examples: train.length,
    benchmark_examples: benchmark.length,
    validation_errors: [],
  };

  if (summary.train_examples !== train.length) {
    report.validation_errors.push(`summary train_examples ${summary.train_examples} does not match train rows ${train.length}`);
  }
  if (summary.benchmark_examples !== benchmark.length) {
    report.validation_errors.push(`summary benchmark_examples ${summary.benchmark_examples} does not match benchmark rows ${benchmark.length}`);
  }

  for (const [index, row] of train.entries()) {
    const label = `${path.basename(dir)} train:${index + 1}`;
    validatePromptCompletion(row, label, report.validation_errors);
    if (task === "translation_cs_en") validateTranslationRow(row, label, report.validation_errors);
    if (task === "czech_word_sentence") validateWordSentenceRow(row, label, report.validation_errors);
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

function validatePromptCompletion(row, label, errors) {
  if (!String(row.prompt || "").trim()) errors.push(`${label}: blank prompt`);
  if (!String(row.completion || "").trim()) errors.push(`${label}: blank completion`);
  if (!String(row.completion || "").startsWith(" ")) errors.push(`${label}: completion must start with one leading space`);
  if (/undefined|null|\[object Object\]/u.test(`${row.prompt}\n${row.completion}`)) {
    errors.push(`${label}: generated JavaScript placeholder text`);
  }
}

function validateTranslationRow(row, label, errors) {
  if (row.task !== "translation_cs_en") errors.push(`${label}: wrong task ${row.task}`);
  if (!String(row.czech_text || "").trim()) errors.push(`${label}: blank czech_text`);
  if (!String(row.english_text || "").trim()) errors.push(`${label}: blank english_text`);
  if (!String(row.prompt || "").includes(row.czech_text)) errors.push(`${label}: prompt does not include czech_text`);
  if (String(row.completion || "").trim() !== String(row.english_text || "").trim()) {
    errors.push(`${label}: completion is not the English text`);
  }
}

function validateWordSentenceRow(row, label, errors) {
  if (row.task !== "czech_word_sentence") errors.push(`${label}: wrong task ${row.task}`);
  const word = String(row.word || "").trim().toLocaleLowerCase("cs-CZ");
  const sentence = String(row.completion || "").trim();
  if (!word) errors.push(`${label}: blank word`);
  if (!sentence) errors.push(`${label}: blank sentence`);
  if (word && !tokenSet(sentence).has(word)) {
    errors.push(`${label}: sentence does not contain target word ${word}`);
  }
  if (/slovo|v[ěe]ta se slovem|objevuje|obsahuje/u.test(asciiFold(sentence))) {
    errors.push(`${label}: sentence contains meta-language`);
  }
}

function tokenSet(text) {
  return new Set(Array.from(String(text || "").matchAll(/\p{L}+(?:[-']\p{L}+)?/gu), (match) => match[0].toLocaleLowerCase("cs-CZ")));
}

function asciiFold(text) {
  return String(text || "").toLocaleLowerCase("cs-CZ").normalize("NFD").replace(/\p{M}/gu, "");
}
