import { defineTargetContentPolicy } from "./contract.mjs";

export const SPANISH_SPAIN_CONTENT_POLICY_ID = "spanish-spain-v1";

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
      "spanish.format-control",
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
      "spanish.script",
      `${label} must contain Latin-script Spanish text and no letters from another script.`
    ));
  }
}

function validateNoFormatControls(value, label, issues) {
  if (typeof value === "string" && FORMAT_CONTROL_PATTERN.test(value)) {
    issues.push(issue(
      "spanish.format-control",
      `${label} must not contain Unicode format-control characters.`
    ));
  }
}

export const spanishSpainContentPolicy = defineTargetContentPolicy({
  id: SPANISH_SPAIN_CONTENT_POLICY_ID,
  validate(catalog) {
    const issues = [];
    if (catalog?.courseId !== "es") {
      issues.push(issue("spanish.course", "The Spanish (Spain) content policy requires courseId es."));
    }
    if (catalog?.targetLanguage?.languageTag !== "es-ES"
        || catalog?.targetLanguage?.speechLocale !== "es-ES"
        || catalog?.targetLanguage?.script !== "Latn") {
      issues.push(issue(
        "spanish.locale",
        "The Spanish (Spain) policy requires languageTag es-ES, speechLocale es-ES, and script Latn."
      ));
    }
    if (catalog?.tokenization?.method !== "authored-word-tokens"
        || catalog?.tokenization?.characterFallbackAllowed !== false
        || catalog?.tokenization?.pronunciationAuthority !== "authored-contextual-token") {
      issues.push(issue(
        "spanish.tokenization",
        "Spanish requires authored word tokens, disabled character fallback, and contextual token authority."
      ));
    }

    for (const [index, realization] of (catalog?.realizations ?? []).entries()) {
      const label = `realizations[${index}]`;
      validateLatinText(realization?.text, `${label}.text`, issues);
      if (realization?.pronunciation !== null) {
        issues.push(issue(
          "spanish.pronunciation",
          `${label}.pronunciation must be null until a separate reviewed Spanish pronunciation policy exists.`
        ));
      }

      for (const [tokenIndex, token] of (realization?.tokens ?? []).entries()) {
        const tokenLabel = `${label}.tokens[${tokenIndex}]`;
        validateLatinText(token?.surface, `${tokenLabel}.surface`, issues);
        validateNoFormatControls(token?.gloss, `${tokenLabel}.gloss`, issues);
        if (token?.pronunciation !== null) {
          issues.push(issue(
            "spanish.pronunciation",
            `${tokenLabel}.pronunciation must be null until a separate reviewed Spanish pronunciation policy exists.`
          ));
        }
        if (Object.hasOwn(token ?? {}, "readingUnits")) {
          issues.push(issue(
            "spanish.reading-units",
            `${tokenLabel}.readingUnits must be omitted for authored Spanish word tokens.`
          ));
        }
      }
    }
    return issues;
  }
});

export default spanishSpainContentPolicy;
