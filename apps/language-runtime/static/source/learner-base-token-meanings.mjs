const MEANING_KEYS = Object.freeze(["targetLanguage", "tokenIndex", "surface", "text"]);

/**
 * Base wording remains reusable across targets. Contextual word meanings name
 * their exact target locale and authored token position; the surface guards
 * against silently applying a translation after target tokenization changes.
 */
export function learnerTokenMeanings(realization, {
  targetLanguage = null,
  targetTokens = null
} = {}) {
  if (!Object.hasOwn(realization, "tokenMeanings")) return null;
  if (targetTokens && !targetLanguage) {
    throw new TypeError("Learner-base token meanings require the exact target language for a token join.");
  }
  if (!Array.isArray(realization.tokenMeanings) || realization.tokenMeanings.length === 0) {
    throw new TypeError("Learner-base tokenMeanings must be a non-empty array when supplied.");
  }
  const seen = new Set();
  const selected = [];
  for (const [index, meaning] of realization.tokenMeanings.entries()) {
    const label = `Learner-base tokenMeanings[${index}]`;
    if (!meaning || typeof meaning !== "object" || Array.isArray(meaning)
        || Object.keys(meaning).length !== MEANING_KEYS.length
        || MEANING_KEYS.some((key) => !Object.hasOwn(meaning, key))) {
      throw new TypeError(`${label} must contain exactly ${MEANING_KEYS.join(", ")}.`);
    }
    const locale = typeof meaning.targetLanguage === "string"
      ? Intl.getCanonicalLocales(meaning.targetLanguage)[0]
      : null;
    if (!locale || locale !== meaning.targetLanguage) {
      throw new TypeError(`${label}.targetLanguage must be a canonical language tag.`);
    }
    if (!Number.isInteger(meaning.tokenIndex) || meaning.tokenIndex < 0) {
      throw new TypeError(`${label}.tokenIndex must be a non-negative integer.`);
    }
    for (const field of ["surface", "text"]) {
      if (typeof meaning[field] !== "string" || !meaning[field].trim()) {
        throw new TypeError(`${label}.${field} must be non-empty text.`);
      }
    }
    const key = `${locale}\u0000${meaning.tokenIndex}`;
    if (seen.has(key)) throw new TypeError(`${label} duplicates a target locale and token index.`);
    seen.add(key);
    if (targetLanguage && locale !== targetLanguage) continue;
    if (targetTokens) {
      const token = targetTokens[meaning.tokenIndex];
      if (!token || token.surface.normalize("NFC") !== meaning.surface.normalize("NFC")) {
        throw new TypeError(`${label}.surface does not match its authored target token.`);
      }
    }
    selected.push(Object.freeze({ ...meaning }));
  }
  return Object.freeze(selected);
}
