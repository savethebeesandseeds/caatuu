// Course scope only. All authored Case Cosmos content lives in content.json.
export function assertEnglishCzechCourse(course) {
  if (course?.id !== "cz" || course.sourceLanguage?.id !== "en"
      || !/^en(?:-[A-Za-z]+)*$/u.test(course.sourceLanguage?.locale || "")
      || course.targetLanguage?.id !== "cs" || course.targetLanguage?.locale !== "cs-CZ") {
    throw new Error("Case Cosmos content requires the English -> Czech course.");
  }
}

export const CZECH_CASES = Object.freeze([
  Object.freeze({ case: "Nominative", meaning: "naming or subject", question: "Who or what is the subject?" }),
  Object.freeze({ case: "Genitive", meaning: "belonging, origin, or absence", question: "Whose? From or without whom or what?" }),
  Object.freeze({ case: "Dative", meaning: "receiver or beneficiary", question: "Who or what receives or benefits?" }),
  Object.freeze({ case: "Accusative", meaning: "direct target", question: "Who or what is the target?" }),
  Object.freeze({ case: "Vocative", meaning: "direct address", question: "Who or what is addressed?" }),
  Object.freeze({ case: "Locative", meaning: "place or topic after a preposition", question: "Where, or about whom or what?" }),
  Object.freeze({ case: "Instrumental", meaning: "companion or means", question: "With whom, or using what?" })
]);

// Prefer these checked forms as distractors, then fill from the other cases.
// Equal surface forms are deduplicated: a syncretic form is never a false answer.
export const CASE_CONTRASTS = Object.freeze(Object.fromEntries(Object.entries({
  Nominative: ["Accusative", "Vocative"],
  Genitive: ["Accusative", "Dative"],
  Dative: ["Locative", "Accusative"],
  Accusative: ["Nominative", "Genitive"],
  Vocative: ["Nominative", "Accusative"],
  Locative: ["Dative", "Instrumental"],
  Instrumental: ["Locative", "Dative"]
}).map(([name, alternatives]) => [name, Object.freeze(alternatives)])));

export const CZECH_CASE_SYSTEM = Object.freeze({
  targetLocale: "cs-CZ", sourceLocale: "en", cases: CZECH_CASES, contrasts: CASE_CONTRASTS
});
