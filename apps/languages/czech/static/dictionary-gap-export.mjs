const EXPORT_SCHEMA = "caatuu.dictionary-gap-batch.v1";
const TARGET_FEEDBACK_KIND = "dictionary_missing_entry";
const TARGET_PAYLOAD_KIND = "dictionary_gap_feedback";
const TARGET_DICTIONARY_KEY = "kaikki-cs-en-2026-07-09";
const TARGET_DICTIONARY_DIRECTION = "cs-en";
const MAX_GAPS = 128;
const LOOKUP_OUTCOMES = new Set(["no_results", "no_exact_usable_entry"]);

function text(value, limit = 160) {
  return String(value || "").normalize("NFC").trim().slice(0, limit);
}

function normalizedWord(value) {
  return text(value, 120).toLocaleLowerCase("cs-CZ");
}

function sanitizeGapItem(item) {
  const payload = item?.payload;
  const feedback = payload?.feedback;
  if (payload?.kind !== TARGET_PAYLOAD_KIND || feedback?.kind !== TARGET_FEEDBACK_KIND) return null;

  const normalized = normalizedWord(feedback.normalizedWord || feedback.targetWord);
  const targetWord = text(feedback.targetWord || normalized, 120);
  const dictionaryKey = text(feedback.dictionaryKey, 120);
  const dictionaryDirection = text(feedback.dictionaryDirection, 24);
  if (
    !normalized
    || !targetWord
    || dictionaryKey !== TARGET_DICTIONARY_KEY
    || dictionaryDirection !== TARGET_DICTIONARY_DIRECTION
  ) return null;

  const outcome = text(feedback.lookupOutcome || feedback.reason, 80);
  return {
    targetWord,
    normalizedWord: normalized,
    dictionaryKey,
    dictionaryDirection,
    lookupOutcome: LOOKUP_OUTCOMES.has(outcome) ? outcome : "unknown",
    lookupReturned: Math.min(60, Math.max(0, Math.floor(Number(feedback.lookupReturned) || 0)))
  };
}

export function buildDictionaryGapExport(items) {
  const gapsByKey = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    const gap = sanitizeGapItem(item);
    if (!gap) continue;
    const key = [gap.dictionaryKey, gap.dictionaryDirection, gap.normalizedWord].join("|");
    if (!gapsByKey.has(key)) gapsByKey.set(key, gap);
  }

  const gaps = [...gapsByKey.values()]
    .sort((left, right) => {
      const dictionaryOrder = left.dictionaryKey.localeCompare(right.dictionaryKey);
      if (dictionaryOrder) return dictionaryOrder;
      return left.normalizedWord.localeCompare(right.normalizedWord, "cs");
    })
    .slice(0, MAX_GAPS);

  return { schema: EXPORT_SCHEMA, gaps };
}
