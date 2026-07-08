#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fromRoot } from "./paths.mjs";

function argValue(name, fallback) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

const files = argValue("--files", [
  fromRoot("data", "curriculum", "core-v0.2", "curated", "curriculum-core.en.jsonl"),
  fromRoot("data", "curriculum", "common-phrases-v0.1", "curated", "common-phrases.en.jsonl"),
].join(";"))
  .split(";")
  .map((file) => path.resolve(file));
const requireFilled = hasFlag("--require-filled");

const reports = [];
const allErrors = [];
for (const file of files) {
  const rows = await readJsonl(file);
  const report = validateFile(file, rows);
  reports.push(report);
  allErrors.push(...report.validation_errors.map((error) => `${file}: ${error}`));
}

const output = {
  generated_at: new Date().toISOString(),
  require_filled: requireFilled,
  files: reports,
  totals: {
    rows: reports.reduce((sum, report) => sum + report.rows, 0),
    czech_text_filled: reports.reduce((sum, report) => sum + report.czech_text_filled, 0),
    czech_text_blank: reports.reduce((sum, report) => sum + report.czech_text_blank, 0),
    validation_errors: allErrors.length,
  },
  validation_errors: allErrors,
};

console.log(JSON.stringify(output, null, 2));
if (allErrors.length > 0) process.exitCode = 1;

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

function validateFile(file, rows) {
  const errors = [];
  let filled = 0;
  let blank = 0;
  let copiedEnglish = 0;
  let possibleWrapperText = 0;
  let noCzechDiacritics = 0;
  let suspiciousQuestionMarks = 0;
  let replacementCharacters = 0;
  for (const [index, row] of rows.entries()) {
    const label = `row ${index + 1} ${row.id || ""}`.trim();
    if (typeof row.czech_text !== "string") {
      errors.push(`${label}: czech_text must be a string`);
      continue;
    }
    const value = row.czech_text.trim();
    if (!value) {
      blank += 1;
      if (requireFilled) errors.push(`${label}: czech_text is blank`);
      continue;
    }
    filled += 1;
    if (normalizeText(value) === normalizeText(row.english_text)) {
      copiedEnglish += 1;
      errors.push(`${label}: czech_text appears copied from english_text`);
    }
    if (/(translation|translate|czech|česk|->|=>|\||\{|\}|\[|\])/i.test(value)) {
      possibleWrapperText += 1;
      errors.push(`${label}: czech_text appears to contain wrapper or explanation text`);
    }
    if (!/[áčďéěíňóřšťúůýžÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ]/u.test(value)) {
      noCzechDiacritics += 1;
    }
    if (value.includes("�")) {
      replacementCharacters += 1;
      errors.push(`${label}: czech_text contains replacement character`);
    }
    if (hasSuspiciousQuestionMark(value)) {
      suspiciousQuestionMarks += 1;
      errors.push(`${label}: czech_text contains suspicious question mark characters`);
    }
    if (value.length > Math.max(160, String(row.english_text || "").length * 5)) {
      errors.push(`${label}: czech_text is unexpectedly long`);
    }
  }
  return {
    file,
    rows: rows.length,
    czech_text_filled: filled,
    czech_text_blank: blank,
    copied_english: copiedEnglish,
    possible_wrapper_text: possibleWrapperText,
    no_czech_diacritics: noCzechDiacritics,
    suspicious_question_marks: suspiciousQuestionMarks,
    replacement_characters: replacementCharacters,
    validation_errors: errors,
  };
}

function hasSuspiciousQuestionMark(text) {
  const value = String(text || "").trim();
  if (!value.includes("?")) return false;
  const withoutFinalQuestion = value.endsWith("?") ? value.slice(0, -1) : value;
  return withoutFinalQuestion.includes("?") || /[A-Za-zÁČĎÉĚÍŇÓŘŠŤÚŮÝŽáčďéěíňóřšťúůýž]\?[A-Za-zÁČĎÉĚÍŇÓŘŠŤÚŮÝŽáčďéěíňóřšťúůýž]/u.test(value);
}

function normalizeText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}
