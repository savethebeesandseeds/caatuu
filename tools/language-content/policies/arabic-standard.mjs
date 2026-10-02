import { defineTargetContentPolicy } from "./contract.mjs";

export const ARABIC_STANDARD_CONTENT_POLICY_ID = "arabic-standard-v1";

function validateArabic(value, label, issues) {
  if (typeof value !== "string" || !value.trim()) return;
  if (/[\p{Cf}\u0640\ufb50-\ufdff\ufe70-\ufeff]/u.test(value)) {
    issues.push({ code: "arabic.logical-text", message: `${label} must use logical Arabic characters without bidi controls, tatweel, or presentation forms.` });
  }
  if (!/\p{Script=Arabic}/u.test(value) || [...value].some(character => /\p{L}/u.test(character) && !/\p{Script=Arabic}/u.test(character))) {
    issues.push({ code: "arabic.script", message: `${label} must contain Arabic-script text without letters from another script.` });
  }
}

export const arabicStandardContentPolicy = defineTargetContentPolicy({
  id: ARABIC_STANDARD_CONTENT_POLICY_ID,
  validate(catalog) {
    const issues = [];
    if (catalog?.courseId !== "ar" || catalog?.targetLanguage?.languageTag !== "ar"
      || catalog?.targetLanguage?.speechLocale !== "ar" || catalog?.targetLanguage?.script !== "Arab") {
      issues.push({ code: "arabic.locale", message: "Modern Standard Arabic requires course ar, language/speech tag ar, and script Arab." });
    }
    if (catalog?.tokenization?.method !== "authored-word-tokens" || catalog?.tokenization?.characterFallbackAllowed !== false
      || catalog?.tokenization?.pronunciationAuthority !== "authored-contextual-token") {
      issues.push({ code: "arabic.tokenization", message: "Arabic requires authored orthographic word tokens and disabled character fallback." });
    }
    for (const [index, realization] of (catalog?.realizations ?? []).entries()) {
      const label = `realizations[${index}]`;
      validateArabic(realization?.text, `${label}.text`, issues);
      if (realization?.pronunciation !== null) issues.push({ code: "arabic.pronunciation", message: `${label}.pronunciation must remain null until reviewed pronunciation guidance is approved.` });
      for (const [tokenIndex, token] of (realization?.tokens ?? []).entries()) {
        const tokenLabel = `${label}.tokens[${tokenIndex}]`;
        validateArabic(token?.surface, `${tokenLabel}.surface`, issues);
        if (token?.pronunciation !== null || Object.hasOwn(token ?? {}, "readingUnits")) {
          issues.push({ code: "arabic.pronunciation", message: `${tokenLabel} cannot expose unreviewed pronunciation or character reading units.` });
        }
      }
    }
    return issues;
  }
});
