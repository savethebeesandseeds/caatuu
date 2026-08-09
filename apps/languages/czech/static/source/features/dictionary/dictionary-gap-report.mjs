export const DICTIONARY_GAP_REPORT_SCHEMA = "caatuu.dictionary-gap-report.v1";

const TARGET_DICTIONARY_KEY = "kaikki-cs-en-2026-07-09";
const TARGET_DICTIONARY_DIRECTION = "cs-en";
const MAX_GAPS = 128;
const LOOKUP_OUTCOMES = new Set(["no_results", "no_exact_usable_entry"]);

function text(value, limit = 160) {
  const normalized = String(value || "").normalize("NFC");
  if (/[\u0000-\u001f\u007f-\u009f\u0300-\u036f]/u.test(normalized)) return "";
  return normalized
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, limit);
}

function reportSource(value) {
  if (value?.payload?.kind === "dictionary_gap_feedback") return value.payload.feedback;
  if (value?.kind === "dictionary_gap_feedback") return value.feedback;
  return value;
}

export function buildDictionaryGapReport(value) {
  const source = reportSource(value);
  if (!source || typeof source !== "object") return null;

  const targetWord = text(source.targetWord, 120);
  const normalizedWord = text(source.normalizedWord || targetWord, 120).toLocaleLowerCase("cs-CZ");
  const dictionaryKey = text(source.dictionaryKey, 120);
  const dictionaryDirection = text(source.dictionaryDirection, 24);
  const lookupOutcome = text(source.lookupOutcome, 80);
  const lookupReturned = Number(source.lookupReturned);
  if (
    !targetWord
    || !normalizedWord
    || targetWord.toLocaleLowerCase("cs-CZ") !== normalizedWord
    || dictionaryKey !== TARGET_DICTIONARY_KEY
    || dictionaryDirection !== TARGET_DICTIONARY_DIRECTION
    || !LOOKUP_OUTCOMES.has(lookupOutcome)
    || !Number.isInteger(lookupReturned)
    || lookupReturned < 0
    || lookupReturned > 60
    || (lookupOutcome === "no_results" && lookupReturned !== 0)
    || (lookupOutcome === "no_exact_usable_entry" && lookupReturned < 1)
  ) return null;

  return {
    schema: DICTIONARY_GAP_REPORT_SCHEMA,
    targetWord,
    normalizedWord,
    dictionaryKey,
    dictionaryDirection,
    lookupOutcome,
    lookupReturned
  };
}

export function collectLegacyDictionaryGapReports(items) {
  const reports = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    const report = buildDictionaryGapReport(item);
    if (!report) continue;
    const key = [report.dictionaryKey, report.dictionaryDirection, report.normalizedWord].join("|");
    if (!reports.has(key)) reports.set(key, report);
  }
  return [...reports.values()]
    .sort((left, right) => left.normalizedWord.localeCompare(right.normalizedWord, "cs"))
    .slice(0, MAX_GAPS);
}
