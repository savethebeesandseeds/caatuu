#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fromRoot } from "./paths.mjs";

function argValue(name, fallback) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback;
}

const datasetDir = path.resolve(argValue("--dataset-dir", fromRoot("data", "curriculum", "common-phrases-v0.1")));
const inputFile = path.resolve(argValue("--input-file", path.join(datasetDir, "curated", "common-phrases.en.jsonl")));
const validationFile = path.resolve(argValue("--report-file", path.join(datasetDir, "validation", "en.json")));
const expectedRows = Number(argValue("--count", "500"));

const requiredFields = [
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
const removedFields = ["common_rank", "category", "conversation_function", "provenance"];

const rows = await readJsonl(inputFile);
const report = validateRows(rows);
await fs.mkdir(path.dirname(validationFile), { recursive: true });
await fs.writeFile(validationFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));

if (report.validation_errors.length > 0) {
  process.exitCode = 1;
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

function validateRows(rows) {
  const errors = [];
  const ids = new Set();
  const texts = new Map();
  const categoryCounts = {};
  const difficultyCounts = {};

  rows.forEach((row, index) => {
    for (const field of requiredFields) {
      if (!(field in row)) errors.push(`row ${index + 1}: missing field ${field}`);
    }
    const expectedId = `cc-${String(index + 1).padStart(6, "0")}`;
    if (row.id !== expectedId) errors.push(`row ${index + 1}: expected id ${expectedId}, found ${row.id}`);
    for (const field of removedFields) {
      if (field in row) errors.push(`row ${index + 1}: removed field is present: ${field}`);
    }
    if (ids.has(row.id)) errors.push(`row ${index + 1}: duplicate id ${row.id}`);
    ids.add(row.id);

    const normalized = normalizeText(row.english_text);
    if (!normalized) errors.push(`row ${index + 1}: english_text is blank`);
    else if (texts.has(normalized)) errors.push(`row ${index + 1}: duplicate english_text with row ${texts.get(normalized) + 1}`);
    else texts.set(normalized, index);
    if (typeof row.czech_text !== "string") errors.push(`row ${index + 1}: czech_text must be a string`);

    if (!Array.isArray(row.target_words)) errors.push(`row ${index + 1}: target_words must be an array`);
    if (!Array.isArray(row.grammar_tags)) errors.push(`row ${index + 1}: grammar_tags must be an array`);
    if (row.notes !== "") errors.push(`row ${index + 1}: notes must be blank`);
    for (const flag of ["child_safe", "modern_english", "concrete", "context_independent"]) {
      if (typeof row[flag] !== "boolean") errors.push(`row ${index + 1}: ${flag} must be boolean`);
    }
    const category = categoryFromRow(row);
    categoryCounts[category] = (categoryCounts[category] || 0) + 1;
    difficultyCounts[row.difficulty] = (difficultyCounts[row.difficulty] || 0) + 1;
  });

  if (rows.length !== expectedRows) errors.push(`expected ${expectedRows} rows, found ${rows.length}`);
  return {
    generated_at: new Date().toISOString(),
    schema_version: "caatuu-curriculum-flat-v0.2",
    input_file: inputFile,
    rows: rows.length,
    unique_ids: ids.size,
    duplicate_text_groups: rows.length - texts.size,
    notes_blank: rows.every((row) => row.notes === ""),
    czech_text_filled: rows.filter((row) => String(row.czech_text || "").trim()).length,
    czech_text_blank: rows.filter((row) => !String(row.czech_text || "").trim()).length,
    category_counts: sortObject(categoryCounts),
    difficulty_counts: sortObject(difficultyCounts),
    validation_errors: errors,
  };
}

function categoryFromRow(row) {
  return (row.grammar_tags || [])
    .find((tag) => String(tag).startsWith("category_"))
    ?.replace(/^category_/, "") || "unknown";
}

function sortObject(object) {
  return Object.fromEntries(Object.entries(object).sort(([left], [right]) => String(left).localeCompare(String(right))));
}

function normalizeText(text) {
  return String(text || "").toLowerCase().match(/[\p{L}\p{N}]+/gu)?.join(" ") || "";
}
