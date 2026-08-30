import { defineTargetContentPolicy } from "./contract.mjs";

export const MANDARIN_SIMPLIFIED_CONTENT_POLICY_ID = "mandarin-simplified-v1";

const HAN_PATTERN = /\p{Script=Han}/u;
const LATIN_LETTER_PATTERN = /\p{Script=Latin}/u;
const LETTER_PATTERN = /\p{Letter}/u;

function issue(code, message) {
  return { code, message };
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyLatinLetters(value) {
  if (typeof value !== "string" || !value.trim()) return false;
  for (const character of value) {
    if (LETTER_PATTERN.test(character) && !LATIN_LETTER_PATTERN.test(character)) return false;
  }
  return true;
}

function validatePinyin(pronunciation, label, issues) {
  if (!isObject(pronunciation)) {
    issues.push(issue("mandarin.pronunciation-missing", `${label} requires authored contextual pinyin.`));
    return;
  }
  if (pronunciation.system !== "pinyin") {
    issues.push(issue("mandarin.pronunciation-system", `${label}.pronunciation.system must be pinyin.`));
  }
  if (pronunciation.languageTag !== "zh-Latn-pinyin") {
    issues.push(issue(
      "mandarin.pronunciation-language",
      `${label}.pronunciation.languageTag must be zh-Latn-pinyin.`
    ));
  }
  if (!hasOnlyLatinLetters(pronunciation.notation) || HAN_PATTERN.test(pronunciation.notation ?? "")) {
    issues.push(issue(
      "mandarin.pronunciation-notation",
      `${label}.pronunciation.notation must be authored Latin-script pinyin without Han characters.`
    ));
  }
}

export const mandarinSimplifiedContentPolicy = defineTargetContentPolicy({
  id: MANDARIN_SIMPLIFIED_CONTENT_POLICY_ID,
  validate(catalog) {
    const issues = [];
    if (catalog?.courseId !== "zh") {
      issues.push(issue("mandarin.course", "The Mandarin content policy requires courseId zh."));
    }
    if (catalog?.targetLanguage?.languageTag !== "zh-Hans"
        || catalog?.targetLanguage?.speechLocale !== "zh-CN"
        || catalog?.targetLanguage?.script !== "Hans") {
      issues.push(issue(
        "mandarin.locale",
        "The Mandarin Simplified policy requires languageTag zh-Hans, speechLocale zh-CN, and script Hans."
      ));
    }
    if (catalog?.tokenization?.method !== "authored-word-tokens"
        || catalog?.tokenization?.characterFallbackAllowed !== false
        || catalog?.tokenization?.pronunciationAuthority !== "authored-contextual-token") {
      issues.push(issue(
        "mandarin.contextual-tokenization",
        "Mandarin requires authored contextual word tokens and forbids character-level pronunciation fallback."
      ));
    }

    for (const [index, realization] of (catalog?.realizations ?? []).entries()) {
      const label = `realizations[${index}]`;
      if (typeof realization?.text === "string" && !HAN_PATTERN.test(realization.text)) {
        issues.push(issue("mandarin.script", `${label}.text must contain Simplified Chinese learner text.`));
      }
      validatePinyin(realization?.pronunciation, label, issues);
      for (const [tokenIndex, token] of (realization?.tokens ?? []).entries()) {
        const tokenLabel = `${label}.tokens[${tokenIndex}]`;
        const hasHan = typeof token?.surface === "string" && HAN_PATTERN.test(token.surface);
        if (token?.playable === true && !hasHan) {
          issues.push(issue("mandarin.playable-script", `${tokenLabel} must contain Han text to be playable.`));
        }
        if (hasHan || token?.playable === true) validatePinyin(token?.pronunciation, tokenLabel, issues);
      }
    }
    return issues;
  }
});

export default mandarinSimplifiedContentPolicy;
