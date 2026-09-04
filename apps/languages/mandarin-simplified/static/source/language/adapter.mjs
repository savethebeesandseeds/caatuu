import {
  LANGUAGE_ADAPTER_SCHEMA_VERSION,
  defineLanguageAdapter
} from "/language-runtime/contract.mjs";

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function contentText(value) {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (!isRecord(value)) return "";
  return String(value.text ?? value.surface ?? "");
}

function normalizeText(value) {
  return contentText(value).normalize("NFC").trim();
}

function searchKey(value) {
  return normalizeText(value)
    .replace(/\s+/gu, " ")
    .toLocaleLowerCase("zh-CN");
}

function answerKey(value) {
  return normalizeText(value)
    .replace(/\s+/gu, " ")
    .toLocaleLowerCase("zh-CN");
}

function requireAuthoredPinyin(content, location) {
  if (!isRecord(content)) {
    throw new TypeError(`${location} requires a learner-content object with authored reviewed pinyin.`);
  }
  const metadata = content.pronunciation;
  if (!isRecord(metadata)) {
    throw new TypeError(`${location}.pronunciation must contain authored reviewed pinyin.`);
  }
  if (String(metadata.system || "").trim().toLocaleLowerCase("en-US") !== "pinyin") {
    throw new TypeError(`${location}.pronunciation.system must be pinyin.`);
  }
  const notation = String(metadata.notation || "").normalize("NFC").trim();
  if (!notation) throw new TypeError(`${location}.pronunciation.notation must contain authored pinyin.`);
  if (metadata.reviewed !== true) {
    throw new TypeError(`${location}.pronunciation.reviewed must be true.`);
  }
  return {
    notation,
    system: "pinyin",
    source: "authored",
    reviewed: true,
    languageTag: "zh-Latn-pinyin"
  };
}

function pronunciation(value) {
  if (!isRecord(value) || !isRecord(value.pronunciation)) return null;
  return requireAuthoredPinyin(value, "learner content");
}

function display(value) {
  if (!isRecord(value)) {
    throw new TypeError("Mandarin learner display requires authored content metadata.");
  }
  const text = normalizeText(value);
  if (!text) throw new TypeError("Mandarin learner content requires non-empty text.");
  const pronunciationMetadata = pronunciation(value);
  return {
    text,
    languageTag: "zh-Hans",
    direction: "ltr",
    ...(pronunciationMetadata ? { pronunciation: pronunciationMetadata } : {})
  };
}

function segmentAuthoredContent(value) {
  if (!isRecord(value) || !Array.isArray(value.tokens)) {
    throw new TypeError("Mandarin segmentation requires an authored tokens array; raw strings are not segmented.");
  }
  const text = normalizeText(value);
  if (!text) throw new TypeError("Mandarin segmented content requires non-empty text.");
  const authoredTokens = value.tokens.map((token, index) => {
    if (!isRecord(token)) throw new TypeError(`Mandarin token ${index} must be an object.`);
    const tokenText = normalizeText(token);
    if (!tokenText) throw new TypeError(`Mandarin token ${index} requires non-empty text.`);
    const type = String(token.type || "word");
    if (type !== "word" && type !== "punctuation" && type !== "space" && type !== "other") {
      throw new TypeError(`Mandarin token ${index} has an invalid type.`);
    }
    return {
      ...token,
      type,
      text: tokenText,
      ...(type === "word" && isRecord(token.pronunciation) && token.pronunciation.reviewed === true
        ? { pronunciation: requireAuthoredPinyin(token, `Mandarin token ${index}`) }
        : {})
    };
  });

  const tokens = [];
  let cursor = 0;
  const appendSeparator = (surface, start) => {
    if (!surface) return;
    if (/[\p{L}\p{M}\p{N}]/u.test(surface)) {
      throw new TypeError("Mandarin authored tokens must cover every letter and number in the learner-facing text.");
    }
    tokens.push({
      type: /^\s+$/u.test(surface) ? "space" : "punctuation",
      text: surface,
      start,
      end: start + surface.length
    });
  };
  for (const [index, token] of authoredTokens.entries()) {
    const start = text.indexOf(token.text, cursor);
    if (start < cursor) {
      throw new TypeError(`Mandarin token ${index} must match the learner-facing text in authored order.`);
    }
    appendSeparator(text.slice(cursor, start), cursor);
    tokens.push({ ...token, start, end: start + token.text.length });
    cursor = start + token.text.length;
  }
  appendSeparator(text.slice(cursor), cursor);
  if (tokens.map((token) => token.text).join("") !== text) {
    throw new TypeError("Mandarin authored tokens must reproduce the learner-facing text in order.");
  }
  return tokens;
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
    languageTag: "zh-CN",
    continuous: options.continuous === true,
    interimResults: options.interimResults === true,
    maxAlternatives: Math.round(clamp(options.maxAlternatives, 1, 10, 1))
  };
}

function speechOutputConfig(options = {}) {
  return {
    languageTag: "zh-CN",
    rate: clamp(options.rate, 0.5, 1.5, 1),
    pitch: clamp(options.pitch, 0.5, 1.5, 1),
    voice: String(options.voice || "").trim().slice(0, 256),
    maxCharacters: 1_000
  };
}

function prepareSpeech(value) {
  const text = normalizeText(value);
  if (!text) throw new TypeError("Mandarin speech requires non-empty Hanzi text.");
  if (text.length > 1_000) throw new RangeError("Mandarin speech supports up to 1,000 characters.");
  return text;
}

function dictionaryLookupKey(value) {
  return searchKey(value);
}

function dictionaryEntryText(value) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string" && typeof value !== "number") return "";
  return String(value).normalize("NFC").trim();
}

function presentDictionaryEntry(record, context = {}) {
  if (!isRecord(record)) {
    throw new TypeError("Mandarin dictionary presentation requires an object record.");
  }
  const sourceLanguageId = String(
    context.sourceLanguageId ?? context.course?.sourceLanguage?.id ?? ""
  ).trim().toLocaleLowerCase("en-US");
  const sourceIsEnglish = sourceLanguageId === "en" || sourceLanguageId.startsWith("en-");
  const explicitEnglish = record.englishAuditText ?? record.englishText ?? record.en;
  const englishAuditText = explicitEnglish ?? (sourceIsEnglish ? record.source : undefined);
  return {
    targetText: dictionaryEntryText(record.targetText ?? record.target ?? record.text ?? record.surface),
    englishAuditText: dictionaryEntryText(englishAuditText),
    category: dictionaryEntryText(record.category),
    partOfSpeech: dictionaryEntryText(record.partOfSpeech ?? record.kind),
    exampleTargetText: dictionaryEntryText(record.exampleTargetText ?? record.example?.target),
    usageNote: dictionaryEntryText(record.usageNote ?? record.note)
  };
}

export const mandarinSimplifiedLanguageAdapter = defineLanguageAdapter({
  schemaVersion: LANGUAGE_ADAPTER_SCHEMA_VERSION,
  id: "mandarin-simplified",
  direction: "ltr",
  languageTags: {
    primary: "zh-Hans",
    locale: "zh-Hans",
    html: "zh-Hans",
    fallbacks: ["zh-CN", "zh"]
  },
  normalization: {
    text: normalizeText,
    searchKey,
    answerKey
  },
  segmentation: {
    strategy: "authored",
    segment: segmentAuthoredContent
  },
  learner: {
    requiresAuthoredPronunciation: true,
    display,
    pronunciation
  },
  answers: {
    variants: answerVariants
  },
  speech: {
    input: {
      languageTag: "zh-CN",
      config: speechInputConfig,
      recognize: null
    },
    output: {
      languageTag: "zh-CN",
      config: speechOutputConfig,
      prepare: prepareSpeech,
      speak: null
    }
  },
  dictionary: {
    lookupKey: dictionaryLookupKey,
    presentEntry: presentDictionaryEntry,
    lookup: null,
    search: null
  }
});

export default mandarinSimplifiedLanguageAdapter;
