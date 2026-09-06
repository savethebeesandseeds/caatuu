import {
  LANGUAGE_ADAPTER_SCHEMA_VERSION,
  defineLanguageAdapter
} from "/language-runtime/contract.mjs";

const SPEECH_PACES = Object.freeze({
  slower: Object.freeze({ label: "Más lento", rate: 0.55 }),
  slow: Object.freeze({ label: "Lento", rate: 0.7 }),
  normal: Object.freeze({ label: "Normal", rate: 1 })
});
const SPEECH_PACE_BY_DIFFICULTY = Object.freeze({ 1: "slower", 2: "slow", 3: "normal" });

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function contentText(value) {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (!isRecord(value)) return "";
  return String(value.text ?? value.form ?? value.surface ?? value.answer ?? "");
}

function normalizeText(value) {
  return contentText(value).normalize("NFC").trim();
}

function normalizeWord(value) {
  return normalizeText(value)
    .replace(/^[^\p{L}\p{M}\d]+|[^\p{L}\p{M}\d]+$/gu, "")
    .trim();
}

function searchKey(value) {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLocaleLowerCase("en-US")
    .replace(/\s+/gu, " ")
    .trim();
}

function answerKey(value) {
  return normalizeText(value)
    .toLocaleLowerCase("en-US")
    .replace(/\s+/gu, " ")
    .trim();
}

function segmentEnglish(value) {
  const text = normalizeText(value);
  const tokens = [];
  const pattern = /[\p{L}\p{M}]+(?:[’'-][\p{L}\p{M}]+)?|\d+|[^\s]/gu;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    const part = match[0];
    tokens.push({
      type: /^[\p{L}\p{M}\d]/u.test(part) ? "word" : "punctuation",
      text: part
    });
  }
  return tokens;
}

function pronunciation() {
  return null;
}

function display(value) {
  return {
    text: normalizeText(value),
    languageTag: "en-US",
    direction: "ltr"
  };
}

function answerVariants(value) {
  if (typeof value === "string" || typeof value === "number") return [String(value)];
  if (!isRecord(value)) return [];
  const accepted = [value.acceptedAnswers, value.accepted, value.variants]
    .flatMap((items) => Array.isArray(items) ? items : [])
    .map((item) => typeof item === "string" || typeof item === "number"
      ? String(item)
      : contentText(item));
  return [contentText(value), ...accepted];
}

function clamp(value, minimum, maximum, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback;
}

function speechInputConfig(options = {}) {
  return {
    languageTag: "en-US",
    continuous: options.continuous === true,
    interimResults: options.interimResults === true,
    maxAlternatives: Math.round(clamp(options.maxAlternatives, 1, 10, 1))
  };
}

function speechOutputConfig(options = {}) {
  const preference = String(options.pace || options.preference || "")
    .trim()
    .toLocaleLowerCase("en-US");
  const difficulty = Object.prototype.hasOwnProperty.call(SPEECH_PACE_BY_DIFFICULTY, Number(options.difficulty))
    ? Number(options.difficulty)
    : 1;
  const paceKey = Object.prototype.hasOwnProperty.call(SPEECH_PACES, preference)
    ? preference
    : SPEECH_PACE_BY_DIFFICULTY[difficulty];
  const pace = SPEECH_PACES[paceKey];
  return {
    languageTag: "en-US",
    rate: clamp(options.rate, 0.5, 1.5, pace.rate),
    pitch: clamp(options.pitch, 0.5, 1.5, 1),
    voice: String(options.voice || "").trim().slice(0, 256),
    pace: paceKey,
    paceLabel: pace.label,
    maxCharacters: 1_000
  };
}

function prepareSpeech(value) {
  const text = normalizeText(value);
  if (!text) throw new TypeError("English speech requires non-empty text.");
  if (text.length > 1_000) throw new RangeError("English speech supports up to 1,000 characters.");
  return text;
}

function dictionaryEntryText(value) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string" && typeof value !== "number") return "";
  return String(value).normalize("NFC").trim();
}

function presentDictionaryEntry(record, context = {}) {
  if (!isRecord(record)) {
    throw new TypeError("English dictionary presentation requires an object record.");
  }
  const sourceLanguageId = String(
    context.sourceLanguageId ?? context.course?.sourceLanguage?.id ?? ""
  ).trim().toLocaleLowerCase("en-US");
  const sourceIsEnglish = sourceLanguageId === "en" || sourceLanguageId.startsWith("en-");
  const explicitEnglish = record.englishAuditText ?? record.englishText ?? record.en;
  return {
    targetText: dictionaryEntryText(record.targetText ?? record.target ?? record.text ?? record.surface),
    englishAuditText: dictionaryEntryText(explicitEnglish ?? (sourceIsEnglish ? record.source : undefined)),
    category: dictionaryEntryText(record.category),
    partOfSpeech: dictionaryEntryText(record.partOfSpeech ?? record.kind),
    exampleTargetText: dictionaryEntryText(record.exampleTargetText ?? record.example?.target),
    usageNote: dictionaryEntryText(record.usageNote ?? record.note)
  };
}

export const englishLanguageAdapter = defineLanguageAdapter({
  schemaVersion: LANGUAGE_ADAPTER_SCHEMA_VERSION,
  id: "english-american",
  direction: "ltr",
  languageTags: {
    primary: "en",
    locale: "en-US",
    html: "en",
    fallbacks: ["en"]
  },
  normalization: {
    text: normalizeText,
    searchKey,
    answerKey
  },
  segmentation: {
    strategy: "computed",
    segment: segmentEnglish
  },
  learner: {
    requiresAuthoredPronunciation: false,
    display,
    pronunciation
  },
  answers: {
    variants: answerVariants
  },
  speech: {
    input: {
      languageTag: "en-US",
      config: speechInputConfig,
      recognize: null
    },
    output: {
      languageTag: "en-US",
      config: speechOutputConfig,
      prepare: prepareSpeech,
      speak: null
    }
  },
  dictionary: {
    lookupKey(value) {
      return normalizeWord(value).toLocaleLowerCase("en-US");
    },
    presentEntry: presentDictionaryEntry,
    lookup: null,
    search: null
  }
});

export default englishLanguageAdapter;
