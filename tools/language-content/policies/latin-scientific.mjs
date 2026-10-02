import { defineTargetContentPolicy } from "./contract.mjs";

export const LATIN_SCIENTIFIC_CONTENT_POLICY_ID = "latin-scientific-v1";
export const latinScientificContentPolicy = defineTargetContentPolicy({
  id: LATIN_SCIENTIFIC_CONTENT_POLICY_ID,
  validate(catalog) {
    const issues = [];
    const add = (code, message) => issues.push({ code, message });
    if (catalog?.courseId !== "la" || catalog?.targetLanguage?.languageTag !== "la"
      || catalog?.targetLanguage?.speechLocale !== "la" || catalog?.targetLanguage?.script !== "Latn") {
      add("latin.locale", "Scientific Latin requires course/language la and script Latn.");
    }
    if (catalog?.tokenization?.method !== "authored-word-tokens" || catalog?.tokenization?.characterFallbackAllowed !== false) {
      add("latin.tokenization", "Latin uses explicitly authored orthographic word tokens, including attached enclitics.");
    }
    const text = (value, label) => {
      if (typeof value !== "string" || !value.trim()) return;
      if (/\p{Cf}/u.test(value) || !/\p{Script=Latin}/u.test(value)
        || [...value].some(c => /\p{L}/u.test(c) && !/\p{Script=Latin}/u.test(c))) {
        add("latin.script", `${label} must use logical Latin-script text without hidden formatting controls.`);
      }
    };
    for (const [index, realization] of (catalog?.realizations ?? []).entries()) {
      text(realization.text, `realizations[${index}].text`);
      if (realization.pronunciation !== null) add("latin.pronunciation", "No approved Latin pronunciation guide is supplied.");
      for (const token of realization.tokens ?? []) {
        text(token.surface, `realizations[${index}].token`);
        if (token.pronunciation !== null || Object.hasOwn(token, "readingUnits")) add("latin.pronunciation", "Macrons are orthographic quantity aids, not an approved audio/transliteration guide.");
      }
    }
    return issues;
  }
});
