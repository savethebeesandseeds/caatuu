import { REPORTING_COURSE_CATALOG } from "./course-catalog.mjs";

export const REPORTING_POLICY_V2 = "2026-11-11.v2";
export const DICTIONARY_GAP_SCHEMA_V2 = "caatuu.dictionary-gap-report.v2";
export const SENTENCE_REPORT_SCHEMA_V2 = "caatuu.sentence-feedback-report.v2";
export const SENTENCE_REPORT_SCHEMA_V3 = "caatuu.sentence-feedback-report.v3";
const tupleFields = ["courseId", "sourceLanguage", "targetLanguage"];
const dictionaryFields = ["schema", ...tupleFields, "providerId", "targetWord", "normalizedWord", "dictionaryKey", "dictionaryDirection", "lookupOutcome", "lookupReturned"];
const sentenceFields = ["schema", ...tupleFields, "clientReportId", "sentence", "translation", "reason", "comment", "entryId", "contentMode", "corpusVersion"];
const sentenceFieldsV3 = [...sentenceFields, "semanticBankId", "contentId", "flagTarget", "englishAtFlag", "translationAtFlag"];
const flagTargets = new Set(["translation", "content", "play"]);
const reasons = new Set(["nonsense_or_incorrect", "unnatural_target_language", "wrong_translation", "repeated_too_soon", "other"]);
const outcomes = new Set(["no_results", "no_exact_usable_entry"]);
function exact(value, fields) {
  return value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === fields.length && fields.every(field => Object.hasOwn(value, field));
}
function text(value, max, required = true) {
  if (typeof value !== "string") return null;
  const normalized = value.normalize("NFC");
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(normalized)) return null;
  const compact = normalized.replace(/\s+/gu, " ").trim();
  return (required && !compact) || [...compact].length > max ? null : compact;
}
function authority(value, catalog) {
  if (catalog?.schemaVersion !== 2 || !Array.isArray(catalog.courses)) return null;
  return catalog.courses.find(course => tupleFields.every(field => course[field] === value[field])) ?? null;
}
function tuple(course) {
  return Object.fromEntries(tupleFields.map(field => [field, course[field]]));
}
export function validateDictionaryGapV2(value, catalog = REPORTING_COURSE_CATALOG) {
  if (!exact(value, dictionaryFields) || value.schema !== DICTIONARY_GAP_SCHEMA_V2) return null;
  const course = authority(value, catalog);
  if (!course?.dictionary || !["providerId", "dictionaryKey", "dictionaryDirection"].every(field => value[field] === course.dictionary[field])) return null;
  const targetWord = text(value.targetWord, 120);
  const normalizedWord = text(value.normalizedWord, 120);
  const lookupReturned = value.lookupReturned;
  if (!targetWord || !normalizedWord || targetWord.toLocaleLowerCase(course.targetLanguage).normalize("NFC") !== normalizedWord
      || normalizedWord.toLocaleLowerCase(course.targetLanguage).normalize("NFC") !== normalizedWord || !outcomes.has(value.lookupOutcome)
      || !Number.isInteger(lookupReturned) || lookupReturned < 0 || lookupReturned > 60
      || (value.lookupOutcome === "no_results" && lookupReturned !== 0)
      || (value.lookupOutcome === "no_exact_usable_entry" && lookupReturned < 1)) return null;
  return { schema: DICTIONARY_GAP_SCHEMA_V2, ...tuple(course), providerId: course.dictionary.providerId,
    targetWord, normalizedWord, dictionaryKey: course.dictionary.dictionaryKey,
    dictionaryDirection: course.dictionary.dictionaryDirection, lookupOutcome: value.lookupOutcome, lookupReturned };
}
export function validateSentenceReportV2(value, catalog = REPORTING_COURSE_CATALOG) {
  if (!exact(value, sentenceFields) || value.schema !== SENTENCE_REPORT_SCHEMA_V2) return null;
  const course = authority(value, catalog);
  if (course?.sentenceReports !== true || typeof value.clientReportId !== "string"
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value.clientReportId)) return null;
  const sentence = text(value.sentence, 360);
  const translation = text(value.translation, 360, false);
  const comment = text(value.comment, 400, false);
  const entryId = text(value.entryId, 120, false);
  const corpusVersion = text(value.corpusVersion, 80, false);
  const contentMode = text(value.contentMode, 32, false);
  if (!sentence || [translation, comment, entryId, corpusVersion, contentMode].some(value => value === null)
      || !["", "standard", "generative", "authored"].includes(contentMode) || !reasons.has(value.reason)) return null;
  return { schema: SENTENCE_REPORT_SCHEMA_V2, ...tuple(course), clientReportId: value.clientReportId.toLowerCase(),
    sentence, translation, reason: value.reason, comment, entryId, contentMode, corpusVersion };
}
export function validateSentenceReportV3(value, catalog = REPORTING_COURSE_CATALOG) {
  if (!exact(value, sentenceFieldsV3) || value.schema !== SENTENCE_REPORT_SCHEMA_V3) return null;
  const base = validateSentenceReportV2(Object.fromEntries(sentenceFields.map(field => [field, field === "schema" ? SENTENCE_REPORT_SCHEMA_V2 : value[field]])), catalog);
  const semanticBankId = text(value.semanticBankId, 80, false);
  const contentId = text(value.contentId, 160, false);
  const englishAtFlag = text(value.englishAtFlag, 360, false);
  const translationAtFlag = text(value.translationAtFlag, 360, false);
  if (!base || semanticBankId === null || contentId === null || englishAtFlag === null || translationAtFlag === null
      || !flagTargets.has(value.flagTarget)) return null;
  return { ...base, schema: SENTENCE_REPORT_SCHEMA_V3, semanticBankId, contentId, flagTarget: value.flagTarget, englishAtFlag, translationAtFlag };
}
export function classifySentenceFlag(report, bankEnglish) {
  if (!report || report.flagTarget === "play") return "play";
  if (report.flagTarget === "translation" && report.englishAtFlag === bankEnglish) return "translation";
  if (report.flagTarget === "content" && report.englishAtFlag === bankEnglish) return "content";
  return "course-local";
}
export function canonicalSentencePayloadV3(report) {
  return JSON.stringify(Object.fromEntries(sentenceFieldsV3.map(field => [field, report[field]])));
}
export function canonicalSentencePayloadV2(report) {
  return JSON.stringify(Object.fromEntries(sentenceFields.map(field => [field, report[field]])));
}
export const contractFieldsV2 = Object.freeze({ dictionary: dictionaryFields, sentence: sentenceFields });
