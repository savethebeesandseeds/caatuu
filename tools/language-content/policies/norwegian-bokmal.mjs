import { defineTargetContentPolicy } from "./contract.mjs";

export const NORWEGIAN_BOKMAL_CONTENT_POLICY_ID = "norwegian-bokmal-v1";

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
      "norwegian.format-control",
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
      "norwegian.script",
      `${label} must contain Latin-script Norwegian Bokmål text and no letters from another script.`
    ));
  }
}

function validateNoFormatControls(value, label, issues) {
  if (typeof value === "string" && FORMAT_CONTROL_PATTERN.test(value)) {
    issues.push(issue(
      "norwegian.format-control",
      `${label} must not contain Unicode format-control characters.`
    ));
  }
}

export const norwegianBokmalContentPolicy = defineTargetContentPolicy({
  id: NORWEGIAN_BOKMAL_CONTENT_POLICY_ID,
  validate(catalog) {
    const issues = [];
    if (catalog?.courseId !== "nb") {
      issues.push(issue("norwegian.course", "The Norwegian Bokmål content policy requires courseId nb."));
    }
    if (catalog?.targetLanguage?.languageTag !== "nb-NO"
        || catalog?.targetLanguage?.speechLocale !== "nb-NO"
        || catalog?.targetLanguage?.script !== "Latn") {
      issues.push(issue(
        "norwegian.locale",
        "The Norwegian Bokmål policy requires languageTag nb-NO, speechLocale nb-NO, and script Latn."
      ));
    }
    if (catalog?.tokenization?.method !== "authored-word-tokens"
        || catalog?.tokenization?.characterFallbackAllowed !== false
        || catalog?.tokenization?.pronunciationAuthority !== "authored-contextual-token") {
      issues.push(issue(
        "norwegian.tokenization",
        "Norwegian Bokmål requires authored word tokens, disabled character fallback, and contextual token authority."
      ));
    }

    for (const [index, realization] of (catalog?.realizations ?? []).entries()) {
      const label = `realizations[${index}]`;
      validateLatinText(realization?.text, `${label}.text`, issues);
      if (realization?.pronunciation !== null) {
        issues.push(issue(
          "norwegian.pronunciation",
          `${label}.pronunciation must be null until a separate reviewed Norwegian Bokmål pronunciation policy exists.`
        ));
      }

      for (const [tokenIndex, token] of (realization?.tokens ?? []).entries()) {
        const tokenLabel = `${label}.tokens[${tokenIndex}]`;
        validateLatinText(token?.surface, `${tokenLabel}.surface`, issues);
        validateNoFormatControls(token?.gloss, `${tokenLabel}.gloss`, issues);
        if (token?.pronunciation !== null) {
          issues.push(issue(
            "norwegian.pronunciation",
            `${tokenLabel}.pronunciation must be null until a separate reviewed Norwegian Bokmål pronunciation policy exists.`
          ));
        }
        if (Object.hasOwn(token ?? {}, "readingUnits")) {
          issues.push(issue(
            "norwegian.reading-units",
            `${tokenLabel}.readingUnits must be omitted for authored Norwegian Bokmål word tokens.`
          ));
        }
      }
    }
    return issues;
  }
});

export default norwegianBokmalContentPolicy;
