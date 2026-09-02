export const REPORTING_POLICY = "2026-09-02.v1";
export const REPORTING_POLICY_HEADER = "x-caatuu-reporting-policy";
export const DICTIONARY_GAP_SCHEMA = "caatuu.dictionary-gap-report.v1";
export const SENTENCE_REPORT_SCHEMA = "caatuu.sentence-feedback-report.v1";
export const CANONICAL_ORIGIN = "https://caatuu.waajacu.com";

const DICTIONARY_KEY = "kaikki-cs-en-2026-07-09";
const DICTIONARY_DIRECTION = "cs-en";
const LOOKUP_OUTCOMES = new Set(["no_results", "no_exact_usable_entry"]);
const SENTENCE_REASONS = new Set([
  "nonsense_or_incorrect",
  "unnatural_czech",
  "wrong_translation",
  "repeated_too_soon",
  "other"
]);

const dictionaryFields = Object.freeze([
  "schema",
  "targetWord",
  "normalizedWord",
  "dictionaryKey",
  "dictionaryDirection",
  "lookupOutcome",
  "lookupReturned"
]);

const sentenceFields = Object.freeze([
  "schema",
  "clientReportId",
  "sentence",
  "translation",
  "reason",
  "comment",
  "entryId",
  "contentMode",
  "corpusVersion"
]);

function hasExactFields(value, fields) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  return keys.length === fields.length
    && fields.every((field, index) => keys[index] === [...fields].sort()[index]);
}

function compactText(value, { max, required = true }) {
  if (typeof value !== "string") return null;
  const normalized = value.normalize("NFC");
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u0300-\u036f]/u.test(normalized)) return null;
  const compact = normalized.replace(/\s+/gu, " ").trim();
  if ((required && !compact) || [...compact].length > max) return null;
  return compact;
}

function optionalText(value, max) {
  return compactText(value, { max, required: false });
}

function uuid(value) {
  const text = String(value || "");
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(text)
    ? text.toLowerCase()
    : null;
}

export function validateDictionaryGap(value) {
  if (!hasExactFields(value, dictionaryFields)) return null;
  const targetWord = compactText(value.targetWord, { max: 120 });
  const normalizedWord = compactText(value.normalizedWord, { max: 120 });
  const lookupReturned = Number(value.lookupReturned);
  if (
    value.schema !== DICTIONARY_GAP_SCHEMA
    || !targetWord
    || !normalizedWord
    || targetWord.toLocaleLowerCase("cs-CZ") !== normalizedWord
    || normalizedWord.toLocaleLowerCase("cs-CZ") !== normalizedWord
    || value.dictionaryKey !== DICTIONARY_KEY
    || value.dictionaryDirection !== DICTIONARY_DIRECTION
    || !LOOKUP_OUTCOMES.has(value.lookupOutcome)
    || !Number.isInteger(lookupReturned)
    || lookupReturned < 0
    || lookupReturned > 60
    || (value.lookupOutcome === "no_results" && lookupReturned !== 0)
    || (value.lookupOutcome === "no_exact_usable_entry" && lookupReturned < 1)
  ) return null;
  return {
    schema: DICTIONARY_GAP_SCHEMA,
    targetWord,
    normalizedWord,
    dictionaryKey: DICTIONARY_KEY,
    dictionaryDirection: DICTIONARY_DIRECTION,
    lookupOutcome: value.lookupOutcome,
    lookupReturned
  };
}

export function validateSentenceReport(value) {
  if (!hasExactFields(value, sentenceFields)) return null;
  const clientReportId = uuid(value.clientReportId);
  const sentence = compactText(value.sentence, { max: 360 });
  const translation = optionalText(value.translation, 360);
  const comment = optionalText(value.comment, 400);
  const entryId = optionalText(value.entryId, 120);
  const corpusVersion = optionalText(value.corpusVersion, 80);
  const contentMode = optionalText(value.contentMode, 32);
  if (
    value.schema !== SENTENCE_REPORT_SCHEMA
    || !clientReportId
    || !sentence
    || translation === null
    || comment === null
    || entryId === null
    || corpusVersion === null
    || !["", "standard", "generative", "authored"].includes(contentMode)
    || !SENTENCE_REASONS.has(value.reason)
  ) return null;
  return {
    schema: SENTENCE_REPORT_SCHEMA,
    clientReportId,
    sentence,
    translation,
    reason: value.reason,
    comment,
    entryId,
    contentMode,
    corpusVersion
  };
}

export function canonicalSentencePayload(report) {
  return JSON.stringify(sentenceFields.reduce((result, key) => {
    result[key] = report[key];
    return result;
  }, {}));
}

export const contractFields = Object.freeze({
  dictionary: dictionaryFields,
  sentence: sentenceFields
});
