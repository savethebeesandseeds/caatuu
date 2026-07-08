#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fromRoot } from "./paths.mjs";

function argValue(name, fallback) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : fallback;
}

const datasetDir = path.resolve(argValue("--dataset-dir", fromRoot("data", "curriculum", "core-v0.1")));
const curatedFile = path.resolve(argValue("--input-file", path.join(datasetDir, "curated", "curriculum-core.en.jsonl")));
const validationFile = path.resolve(argValue("--report-file", path.join(datasetDir, "validation", "en.json")));

const REQUIRED_FIELDS = [
  "id",
  "english_text",
  "czech_text",
  "difficulty",
  "cefr",
  "age_band",
  "topic",
  "target_words",
  "grammar_tags",
  "child_safe",
  "modern_english",
  "concrete",
  "context_independent",
  "naturalness_score",
  "simplicity_score",
  "notes",
];

const REMOVED_FIELDS = [
  "custom_id",
  "ok",
  "status_code",
  "result",
  "decision",
  "reject_reasons",
  "cleanup_actions",
];

function normalizeText(text) {
  return String(text ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

async function readJsonl(file) {
  const text = await fs.readFile(file, "utf8");
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        error.message = `${file}:${index + 1}: ${error.message}`;
        throw error;
      }
    });
}

function expectedId(index) {
  return `cc-${String(index + 1).padStart(6, "0")}`;
}

const rows = await readJsonl(curatedFile);
const errors = [];
const ids = new Set();
const texts = new Map();
const topicCounts = {};
const difficultyCounts = {};

rows.forEach((row, index) => {
  for (const field of REQUIRED_FIELDS) {
    if (!(field in row)) {
      errors.push(`row ${index + 1}: missing field ${field}`);
    }
  }
  for (const field of REMOVED_FIELDS) {
    if (field in row) {
      errors.push(`row ${index + 1}: removed field is present: ${field}`);
    }
  }

  const id = row.id;
  const expected = expectedId(index);
  if (id !== expected) {
    errors.push(`row ${index + 1}: expected id ${expected}, found ${id}`);
  }
  if (ids.has(id)) {
    errors.push(`row ${index + 1}: duplicate id ${id}`);
  }
  ids.add(id);

  if (row.notes !== "") {
    errors.push(`row ${index + 1}: notes must be blank`);
  }
  if (!Array.isArray(row.target_words)) {
    errors.push(`row ${index + 1}: target_words must be an array`);
  }
  if (!Array.isArray(row.grammar_tags)) {
    errors.push(`row ${index + 1}: grammar_tags must be an array`);
  }
  if (typeof row.czech_text !== "string") {
    errors.push(`row ${index + 1}: czech_text must be a string`);
  }
  for (const flag of ["child_safe", "modern_english", "concrete", "context_independent"]) {
    if (typeof row[flag] !== "boolean") {
      errors.push(`row ${index + 1}: ${flag} must be boolean`);
    }
  }

  const normalized = normalizeText(row.english_text);
  if (!normalized) {
    errors.push(`row ${index + 1}: english_text is blank`);
  } else if (texts.has(normalized)) {
    errors.push(`row ${index + 1}: duplicate english_text with row ${texts.get(normalized) + 1}`);
  } else {
    texts.set(normalized, index);
  }

  topicCounts[row.topic] = (topicCounts[row.topic] ?? 0) + 1;
  difficultyCounts[row.difficulty] = (difficultyCounts[row.difficulty] ?? 0) + 1;
});

const report = {
  generated_at: new Date().toISOString(),
  schema_version: "caatuu-curriculum-flat-v0.2",
  input_file: curatedFile,
  rows: rows.length,
  unique_ids: ids.size,
  duplicate_text_groups: rows.length - texts.size,
  notes_blank: rows.every((row) => row.notes === ""),
  czech_text_filled: rows.filter((row) => String(row.czech_text || "").trim()).length,
  czech_text_blank: rows.filter((row) => !String(row.czech_text || "").trim()).length,
  id_format: "cc-000001",
  topic_counts: Object.fromEntries(Object.entries(topicCounts).sort(([a], [b]) => a.localeCompare(b))),
  difficulty_counts: Object.fromEntries(Object.entries(difficultyCounts).sort(([a], [b]) => String(a).localeCompare(String(b)))),
  validation_errors: errors,
};

await fs.mkdir(path.dirname(validationFile), { recursive: true });
await fs.writeFile(validationFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));

if (errors.length > 0) {
  process.exitCode = 1;
}
