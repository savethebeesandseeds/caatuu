import {
  LANGUAGE_ADAPTER_SCHEMA_VERSION,
  defineLanguageAdapter
} from "/language-runtime/contract.mjs";

const SPEECH_PACES = Object.freeze({
  slower: Object.freeze({ label: "Slower", rate: 0.5 }),
  slow: Object.freeze({ label: "Slow", rate: 0.6 }),
  normal: Object.freeze({ label: "Normal", rate: 1 })
});
const SPEECH_PACE_BY_DIFFICULTY = Object.freeze({ 1: "slower", 2: "slow", 3: "normal" });

function contentText(value) {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (!value || typeof value !== "object") return "";
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
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("cs-CZ")
    .replace(/\s+/gu, " ")
    .trim();
}

function answerKey(value) {
  return normalizeText(value)
    .replace(/\s+/gu, " ")
    .toLocaleLowerCase("cs-CZ");
}

function segmentCzech(value) {
  const text = normalizeText(value);
  const tokens = [];
  const pattern = /[\p{L}\p{M}]+(?:[-'][\p{L}\p{M}]+)?|\d+|[^\s]/gu;
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

function pronunciation(value) {
  const text = normalizeText(value);
  if (!text) return null;
  return {
    notation: text,
    system: "Czech orthography",
    source: "display-text",
    languageTag: "cs-CZ",
    speechText: text
  };
}

function display(value) {
  const text = normalizeText(value);
  return {
    text,
    languageTag: "cs-CZ",
    direction: "ltr",
    pronunciation: pronunciation(value)
  };
}

function answerVariants(value) {
  if (typeof value === "string" || typeof value === "number") return [String(value)];
  if (!value || typeof value !== "object") return [];
  const primary = contentText(value);
  const accepted = [value.acceptedAnswers, value.accepted, value.variants]
    .flatMap((items) => Array.isArray(items) ? items : [])
    .map((item) => typeof item === "string" || typeof item === "number"
      ? String(item)
      : contentText(item));
  return [primary, ...accepted];
}

function clamp(value, minimum, maximum, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback;
}

function speechInputConfig(options = {}) {
  return {
    languageTag: "cs-CZ",
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
    languageTag: "cs-CZ",
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
  if (!text) throw new TypeError("Czech speech requires non-empty text.");
  if (text.length > 1_000) throw new RangeError("Czech speech supports up to 1,000 characters.");
  return text;
}

function dictionaryLookupKey(value) {
  return normalizeWord(value).toLocaleLowerCase("cs-CZ");
}

export const czechLanguageAdapter = defineLanguageAdapter({
  schemaVersion: LANGUAGE_ADAPTER_SCHEMA_VERSION,
  id: "czech",
  direction: "ltr",
  languageTags: {
    primary: "cs",
    locale: "cs-CZ",
    html: "cs",
    fallbacks: ["cs"]
  },
  normalization: {
    text: normalizeText,
    searchKey,
    answerKey
  },
  segmentation: {
    strategy: "computed",
    segment: segmentCzech
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
      languageTag: "cs-CZ",
      config: speechInputConfig,
      recognize: null
    },
    output: {
      languageTag: "cs-CZ",
      config: speechOutputConfig,
      prepare: prepareSpeech,
      speak: null
    }
  },
  dictionary: {
    lookupKey: dictionaryLookupKey,
    lookup: null,
    search: null
  }
});

export default czechLanguageAdapter;
