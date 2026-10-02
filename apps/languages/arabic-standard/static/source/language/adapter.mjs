import { LANGUAGE_ADAPTER_SCHEMA_VERSION, defineLanguageAdapter } from "/language-runtime/contract.mjs";

const SHORT_VOWELS = /[\u064b-\u0650\u0652\u0670]/gu;
const TATWEEL = /\u0640/gu;
const FORMATTING = /\p{Cf}/gu;

function contentText(value) {
  if (typeof value === "string" || typeof value === "number") return String(value);
  return String(value?.text ?? value?.form ?? value?.surface ?? value?.answer ?? "");
}

function normalizeText(value) {
  return contentText(value).normalize("NFC").replace(TATWEEL, "").replace(FORMATTING, "").trim();
}

// Search tolerates omitted pedagogical vowel marks. Orthographic hamza, ta
// marbuta, alif maqsura, ya, and consonant doubling (shadda) remain distinct.
function searchKey(value) {
  return normalizeText(value).replace(SHORT_VOWELS, "").replace(/\s+/gu, " ");
}

// Assessment preserves vowel marks: deleting them would collapse genuine
// contrasts such as kataba/kutiba and second-person masculine/feminine forms.
function answerKey(value) {
  return normalizeText(value).replace(/\s+/gu, " ");
}

function segment(value) {
  return [...normalizeText(value).matchAll(/[\p{L}\p{M}]+|[\p{N}]+|[^\s]/gu)].map(([text]) => ({
    type: /^[\p{L}\p{M}\p{N}]/u.test(text) ? "word" : "punctuation", text
  }));
}

function answerVariants(value) {
  if (typeof value === "string" || typeof value === "number") return [String(value)];
  return [contentText(value), ...[value?.acceptedAnswers, value?.accepted, value?.variants]
    .flatMap(items => Array.isArray(items) ? items : []).map(contentText)].filter(Boolean);
}

function bounded(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

function dictionaryText(value) {
  return typeof value === "string" || typeof value === "number" ? normalizeText(value) : "";
}

export const arabicStandardLanguageAdapter = defineLanguageAdapter({
  schemaVersion: LANGUAGE_ADAPTER_SCHEMA_VERSION,
  id: "arabic-standard",
  direction: "rtl",
  languageTags: { primary: "ar", locale: "ar", html: "ar", fallbacks: ["ar"] },
  normalization: { text: normalizeText, searchKey, answerKey },
  segmentation: { strategy: "computed", segment },
  learner: {
    requiresAuthoredPronunciation: false,
    display(value) { return { text: normalizeText(value), languageTag: "ar", direction: "rtl" }; },
    pronunciation() { return null; }
  },
  answers: { variants: answerVariants },
  speech: {
    input: {
      languageTag: "ar", recognize: null,
      config(options = {}) {
        return { languageTag: "ar", continuous: options.continuous === true,
          interimResults: options.interimResults === true,
          maxAlternatives: Math.round(bounded(options.maxAlternatives, 1, 10, 1)) };
      }
    },
    output: {
      languageTag: "ar", speak: null,
      config(options = {}) {
        const pace = options.pace || options.preference || (Number(options.difficulty) === 3 ? "normal" : "slow");
        return { languageTag: "ar", rate: bounded(options.rate, 0.5, 1.5, pace === "normal" ? 1 : 0.7),
          pitch: bounded(options.pitch, 0.5, 1.5, 1), voice: String(options.voice || "").slice(0, 256),
          pace, paceLabel: pace === "normal" ? "Normal" : "Slow", maxCharacters: 1000 };
      },
      prepare(value) {
        const text = normalizeText(value);
        if (!text) throw new TypeError("Arabic speech requires non-empty text.");
        if (text.length > 1000) throw new RangeError("Arabic speech supports up to 1,000 characters.");
        return text;
      }
    }
  },
  dictionary: {
    lookupKey(value) { return searchKey(value).replace(/^[^\p{L}\p{M}\p{N}]+|[^\p{L}\p{M}\p{N}]+$/gu, ""); },
    presentEntry(record, context = {}) {
      if (!record || typeof record !== "object") throw new TypeError("Arabic dictionary presentation requires a record.");
      const base = String(context.sourceLanguageId ?? context.course?.sourceLanguage?.id ?? "");
      return {
        targetText: dictionaryText(record.targetText ?? record.target ?? record.text ?? record.surface),
        englishAuditText: dictionaryText(record.englishAuditText ?? record.englishText ?? record.en
          ?? (/^en(?:-|$)/u.test(base) ? record.source : undefined)),
        category: dictionaryText(record.category), partOfSpeech: dictionaryText(record.partOfSpeech ?? record.kind),
        exampleTargetText: dictionaryText(record.exampleTargetText ?? record.example?.target),
        usageNote: dictionaryText(record.usageNote ?? record.note)
      };
    },
    lookup: null, search: null
  }
});

export default arabicStandardLanguageAdapter;
