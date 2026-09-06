import { defineTargetContentPolicy } from "./contract.mjs";

export const ENGLISH_AMERICAN_CONTENT_POLICY_ID = "english-american-v1";

const LETTER_PATTERN = /\p{Letter}/u;
const LATIN_LETTER_PATTERN = /\p{Script=Latin}/u;
const FORMAT_CONTROL_PATTERN = /\p{Cf}/u;

function issue(code, message) {
  return { code, message };
}

function validateLatinText(value, label, issues) {
  if (typeof value !== "string" || !value.trim()) return;
  if (FORMAT_CONTROL_PATTERN.test(value)) {
    issues.push(issue(
      "english.format-control",
      `${label} must not contain Unicode format-control characters.`
    ));
  }

  let hasLatinLetter = false;
  let hasNonLatinLetter = false;
  for (const character of value) {
    if (!LETTER_PATTERN.test(character)) continue;
    if (LATIN_LETTER_PATTERN.test(character)) hasLatinLetter = true;
    else hasNonLatinLetter = true;
  }
  if (!hasLatinLetter || hasNonLatinLetter) {
    issues.push(issue(
      "english.script",
      `${label} must contain Latin-script English text and no letters from another script.`
    ));
  }
}

function validateNoFormatControls(value, label, issues) {
  if (typeof value === "string" && FORMAT_CONTROL_PATTERN.test(value)) {
    issues.push(issue(
      "english.format-control",
      `${label} must not contain Unicode format-control characters.`
    ));
  }
}

export const englishAmericanContentPolicy = defineTargetContentPolicy({
  id: ENGLISH_AMERICAN_CONTENT_POLICY_ID,
  validate(catalog) {
    const issues = [];
    if (catalog?.courseId !== "es-en") {
      issues.push(issue("english.course", "The American English content policy requires courseId es-en."));
    }
    if (catalog?.targetLanguage?.languageTag !== "en-US"
        || catalog?.targetLanguage?.speechLocale !== "en-US"
        || catalog?.targetLanguage?.script !== "Latn") {
      issues.push(issue(
        "english.locale",
        "The American English policy requires languageTag en-US, speechLocale en-US, and script Latn."
      ));
    }
    if (catalog?.tokenization?.method !== "authored-word-tokens"
        || catalog?.tokenization?.characterFallbackAllowed !== false
        || catalog?.tokenization?.pronunciationAuthority !== "authored-contextual-token") {
      issues.push(issue(
        "english.tokenization",
        "English requires authored word tokens, disabled character fallback, and contextual token authority."
      ));
    }

    for (const [index, realization] of (catalog?.realizations ?? []).entries()) {
      const label = `realizations[${index}]`;
      validateLatinText(realization?.text, `${label}.text`, issues);
      if (realization?.pronunciation !== null) {
        issues.push(issue(
          "english.pronunciation",
          `${label}.pronunciation must be null until a separate reviewed English pronunciation policy exists.`
        ));
      }

      for (const [tokenIndex, token] of (realization?.tokens ?? []).entries()) {
        const tokenLabel = `${label}.tokens[${tokenIndex}]`;
        validateLatinText(token?.surface, `${tokenLabel}.surface`, issues);
        validateNoFormatControls(token?.gloss, `${tokenLabel}.gloss`, issues);
        if (token?.pronunciation !== null) {
          issues.push(issue(
            "english.pronunciation",
            `${tokenLabel}.pronunciation must be null until a separate reviewed English pronunciation policy exists.`
          ));
        }
        if (Object.hasOwn(token ?? {}, "readingUnits")) {
          issues.push(issue(
            "english.reading-units",
            `${tokenLabel}.readingUnits must be omitted for authored English word tokens.`
          ));
        }
      }
    }
    return issues;
  }
});

export default englishAmericanContentPolicy;
