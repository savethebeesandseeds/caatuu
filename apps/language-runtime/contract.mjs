export const LANGUAGE_ADAPTER_SCHEMA_VERSION = 1;

export const LANGUAGE_CAPABILITIES = Object.freeze({
  NORMALIZE_TEXT: "normalization.text",
  SEARCH_KEYS: "normalization.search-key",
  ANSWER_KEYS: "normalization.answer-key",
  SEGMENTATION: "segmentation",
  AUTHORED_SEGMENTATION: "segmentation.authored",
  COMPUTED_SEGMENTATION: "segmentation.computed",
  LEARNER_DISPLAY: "learner.display",
  LEARNER_PRONUNCIATION: "learner.pronunciation",
  ACCEPTED_ANSWERS: "answers.variants",
  SPEECH_INPUT_CONFIG: "speech.input.config",
  SPEECH_INPUT_RUNTIME: "speech.input.runtime",
  SPEECH_OUTPUT_CONFIG: "speech.output.config",
  SPEECH_OUTPUT_RUNTIME: "speech.output.runtime",
  DICTIONARY_KEYS: "dictionary.lookup-key",
  DICTIONARY_PRESENTATION: "dictionary.presentation",
  DICTIONARY_LOOKUP: "dictionary.lookup",
  DICTIONARY_SEARCH: "dictionary.search"
});

export const LANGUAGE_TOKEN_TYPES = Object.freeze(["word", "punctuation", "space", "other"]);

const DIRECTIONS = new Set(["ltr", "rtl"]);
const SEGMENTATION_STRATEGIES = new Set(["authored", "computed"]);
const TOKEN_TYPES = new Set(LANGUAGE_TOKEN_TYPES);
const LANGUAGE_TAG_PATTERN = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/u;

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isFunctionOrNull(value) {
  return value === null || typeof value === "function";
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

export function canonicalizeLanguageTag(value) {
  const tag = String(value || "").trim().replaceAll("_", "-");
  if (!LANGUAGE_TAG_PATTERN.test(tag)) throw new TypeError(`Invalid language tag: ${tag || "<empty>"}`);
  try {
    return Intl.getCanonicalLocales(tag)[0];
  } catch (error) {
    throw new TypeError(`Invalid language tag: ${tag}`, { cause: error });
  }
}

function isLanguageTag(value) {
  try {
    canonicalizeLanguageTag(value);
    return true;
  } catch (error) {
    return false;
  }
}

function expectedCapabilities(adapter) {
  const capabilities = [
    LANGUAGE_CAPABILITIES.NORMALIZE_TEXT,
    LANGUAGE_CAPABILITIES.SEARCH_KEYS,
    LANGUAGE_CAPABILITIES.ANSWER_KEYS,
    LANGUAGE_CAPABILITIES.SEGMENTATION,
    adapter?.segmentation?.strategy === "authored"
      ? LANGUAGE_CAPABILITIES.AUTHORED_SEGMENTATION
      : LANGUAGE_CAPABILITIES.COMPUTED_SEGMENTATION,
    LANGUAGE_CAPABILITIES.LEARNER_DISPLAY,
    LANGUAGE_CAPABILITIES.LEARNER_PRONUNCIATION,
    LANGUAGE_CAPABILITIES.ACCEPTED_ANSWERS,
    LANGUAGE_CAPABILITIES.SPEECH_INPUT_CONFIG,
    LANGUAGE_CAPABILITIES.SPEECH_OUTPUT_CONFIG,
    LANGUAGE_CAPABILITIES.DICTIONARY_KEYS
  ];
  if (typeof adapter?.speech?.input?.recognize === "function") {
    capabilities.push(LANGUAGE_CAPABILITIES.SPEECH_INPUT_RUNTIME);
  }
  if (typeof adapter?.speech?.output?.speak === "function") {
    capabilities.push(LANGUAGE_CAPABILITIES.SPEECH_OUTPUT_RUNTIME);
  }
  if (typeof adapter?.dictionary?.lookup === "function") {
    capabilities.push(LANGUAGE_CAPABILITIES.DICTIONARY_LOOKUP);
  }
  if (typeof adapter?.dictionary?.search === "function") {
    capabilities.push(LANGUAGE_CAPABILITIES.DICTIONARY_SEARCH);
  }
  if (typeof adapter?.dictionary?.presentEntry === "function") {
    capabilities.push(LANGUAGE_CAPABILITIES.DICTIONARY_PRESENTATION);
  }
  return capabilities.sort();
}

function validateFunction(errors, value, path) {
  if (typeof value !== "function") errors.push(`${path} must be a function.`);
}

function validateNullableFunction(errors, value, path) {
  if (!isFunctionOrNull(value)) errors.push(`${path} must be a function or null.`);
}

export function validateLanguageAdapter(adapter) {
  const errors = [];
  if (!isRecord(adapter)) return { valid: false, errors: ["Adapter must be an object."] };

  if (adapter.schemaVersion !== LANGUAGE_ADAPTER_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${LANGUAGE_ADAPTER_SCHEMA_VERSION}.`);
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(String(adapter.id || ""))) {
    errors.push("id must be a lowercase, kebab-case identifier.");
  }
  if (!DIRECTIONS.has(adapter.direction)) errors.push('direction must be "ltr" or "rtl".');

  if (!isRecord(adapter.languageTags)) {
    errors.push("languageTags must be an object.");
  } else {
    for (const name of ["primary", "locale", "html"]) {
      if (!isLanguageTag(adapter.languageTags[name])) {
        errors.push(`languageTags.${name} must be a valid BCP 47 language tag.`);
      }
    }
    if (!Array.isArray(adapter.languageTags.fallbacks)) {
      errors.push("languageTags.fallbacks must be an array.");
    } else {
      adapter.languageTags.fallbacks.forEach((tag, index) => {
        if (!isLanguageTag(tag)) errors.push(`languageTags.fallbacks[${index}] must be a valid BCP 47 language tag.`);
      });
    }
  }

  if (!isRecord(adapter.normalization)) {
    errors.push("normalization must be an object.");
  } else {
    validateFunction(errors, adapter.normalization.text, "normalization.text");
    validateFunction(errors, adapter.normalization.searchKey, "normalization.searchKey");
    validateFunction(errors, adapter.normalization.answerKey, "normalization.answerKey");
  }

  if (!isRecord(adapter.segmentation)) {
    errors.push("segmentation must be an object.");
  } else {
    if (!SEGMENTATION_STRATEGIES.has(adapter.segmentation.strategy)) {
      errors.push('segmentation.strategy must be "authored" or "computed".');
    }
    validateFunction(errors, adapter.segmentation.segment, "segmentation.segment");
  }

  if (!isRecord(adapter.learner)) {
    errors.push("learner must be an object.");
  } else {
    if (typeof adapter.learner.requiresAuthoredPronunciation !== "boolean") {
      errors.push("learner.requiresAuthoredPronunciation must be a boolean.");
    }
    validateFunction(errors, adapter.learner.display, "learner.display");
    validateFunction(errors, adapter.learner.pronunciation, "learner.pronunciation");
  }

  if (!isRecord(adapter.answers)) {
    errors.push("answers must be an object.");
  } else {
    validateFunction(errors, adapter.answers.variants, "answers.variants");
  }

  if (!isRecord(adapter.speech)) {
    errors.push("speech must be an object.");
  } else {
    const input = adapter.speech.input;
    if (!isRecord(input)) {
      errors.push("speech.input must be an object.");
    } else {
      if (!isLanguageTag(input.languageTag)) errors.push("speech.input.languageTag must be a valid BCP 47 language tag.");
      validateFunction(errors, input.config, "speech.input.config");
      validateNullableFunction(errors, input.recognize, "speech.input.recognize");
    }

    const output = adapter.speech.output;
    if (!isRecord(output)) {
      errors.push("speech.output must be an object.");
    } else {
      if (!isLanguageTag(output.languageTag)) errors.push("speech.output.languageTag must be a valid BCP 47 language tag.");
      validateFunction(errors, output.config, "speech.output.config");
      validateFunction(errors, output.prepare, "speech.output.prepare");
      validateNullableFunction(errors, output.speak, "speech.output.speak");
    }
  }

  if (!isRecord(adapter.dictionary)) {
    errors.push("dictionary must be an object.");
  } else {
    validateFunction(errors, adapter.dictionary.lookupKey, "dictionary.lookupKey");
    if (adapter.dictionary.presentEntry !== undefined) {
      validateNullableFunction(errors, adapter.dictionary.presentEntry, "dictionary.presentEntry");
    }
    validateNullableFunction(errors, adapter.dictionary.lookup, "dictionary.lookup");
    validateNullableFunction(errors, adapter.dictionary.search, "dictionary.search");
  }

  if (adapter.capabilities !== undefined) {
    if (!Array.isArray(adapter.capabilities) || adapter.capabilities.some((value) => typeof value !== "string")) {
      errors.push("capabilities must be an array of strings when present.");
    } else if (errors.length === 0) {
      const expected = expectedCapabilities(adapter);
      const actual = [...new Set(adapter.capabilities)].sort();
      if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) {
        errors.push("capabilities do not match the adapter's declared strategies and optional hooks.");
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

export function assertValidLanguageAdapter(adapter) {
  const result = validateLanguageAdapter(adapter);
  if (!result.valid) {
    throw new TypeError(`Invalid language adapter:\n- ${result.errors.join("\n- ")}`);
  }
  return adapter;
}

function languageIdentity(value, label) {
  let locale;
  try {
    locale = new Intl.Locale(canonicalizeLanguageTag(value));
  } catch (error) {
    throw new TypeError(`${label} must be a valid language tag.`, { cause: error });
  }
  return Object.freeze({
    tag: locale.toString(),
    language: locale.language,
    script: locale.script || locale.maximize().script || ""
  });
}

/**
 * Binds a structurally valid target-language adapter to the exact course
 * language identity that selected it. This is deliberately separate from
 * adapter shape validation: two individually valid adapters are not
 * interchangeable when their locale, script, direction, or speech contract
 * differs.
 */
export function assertLanguageAdapterMatchesTarget(adapter, targetLanguage) {
  assertValidLanguageAdapter(adapter);
  if (!isRecord(targetLanguage)) {
    throw new TypeError("Course targetLanguage must be an object.");
  }

  const target = languageIdentity(targetLanguage.locale, "Course targetLanguage.locale");
  const speech = languageIdentity(
    targetLanguage.speechLocale,
    "Course targetLanguage.speechLocale"
  );
  const targetId = String(targetLanguage.id || "").trim();
  const targetScript = String(targetLanguage.script || "").trim();
  if (targetId !== target.language) {
    throw new TypeError(
      `Course targetLanguage.id ${targetId || "<missing>"} does not match locale ${target.tag}.`
    );
  }
  if (!/^[A-Z][a-z]{3}$/u.test(targetScript) || targetScript !== target.script) {
    throw new TypeError(
      `Course targetLanguage.script ${targetScript || "<missing>"} does not match locale ${target.tag}.`
    );
  }
  if (speech.language !== target.language || speech.script !== targetScript) {
    throw new TypeError(
      `Course targetLanguage.speechLocale ${speech.tag} does not match target ${target.language}-${targetScript}.`
    );
  }
  if (adapter.direction !== targetLanguage.direction) {
    throw new TypeError(
      `Language adapter direction ${adapter.direction} does not match course target direction ${targetLanguage.direction}.`
    );
  }

  const adapterLocale = languageIdentity(
    adapter.languageTags.locale,
    "Language adapter languageTags.locale"
  );
  if (adapterLocale.tag !== target.tag) {
    throw new TypeError(
      `Language adapter locale ${adapterLocale.tag} does not match course target locale ${target.tag}.`
    );
  }
  for (const [label, value] of [
    ["languageTags.primary", adapter.languageTags.primary],
    ["languageTags.html", adapter.languageTags.html],
    ...adapter.languageTags.fallbacks.map((value, index) => [
      `languageTags.fallbacks[${index}]`,
      value
    ])
  ]) {
    const identity = languageIdentity(value, `Language adapter ${label}`);
    if (identity.language !== target.language || identity.script !== targetScript) {
      throw new TypeError(
        `Language adapter ${label} ${identity.tag} does not match target ${target.language}-${targetScript}.`
      );
    }
  }
  for (const side of ["input", "output"]) {
    const adapterSpeech = languageIdentity(
      adapter.speech[side].languageTag,
      `Language adapter speech.${side}.languageTag`
    );
    if (adapterSpeech.tag !== speech.tag) {
      throw new TypeError(
        `Language adapter speech.${side}.languageTag ${adapterSpeech.tag} does not match course speech locale ${speech.tag}.`
      );
    }
  }
  return adapter;
}

function canonicalLanguageTags(languageTags) {
  const seen = new Set();
  const fallbacks = [];
  for (const value of languageTags.fallbacks) {
    const tag = canonicalizeLanguageTag(value);
    const key = tag.toLocaleLowerCase("en-US");
    if (seen.has(key)) continue;
    seen.add(key);
    fallbacks.push(tag);
  }
  return {
    primary: canonicalizeLanguageTag(languageTags.primary),
    locale: canonicalizeLanguageTag(languageTags.locale),
    html: canonicalizeLanguageTag(languageTags.html),
    fallbacks
  };
}

function cloneAdapterSpec(spec) {
  return {
    ...spec,
    languageTags: isRecord(spec.languageTags) ? { ...spec.languageTags } : spec.languageTags,
    normalization: isRecord(spec.normalization) ? { ...spec.normalization } : spec.normalization,
    segmentation: isRecord(spec.segmentation) ? { ...spec.segmentation } : spec.segmentation,
    learner: isRecord(spec.learner) ? { ...spec.learner } : spec.learner,
    answers: isRecord(spec.answers) ? { ...spec.answers } : spec.answers,
    speech: isRecord(spec.speech)
      ? {
          ...spec.speech,
          input: isRecord(spec.speech.input) ? { ...spec.speech.input } : spec.speech.input,
          output: isRecord(spec.speech.output) ? { ...spec.speech.output } : spec.speech.output
        }
      : spec.speech,
    dictionary: isRecord(spec.dictionary) ? { ...spec.dictionary } : spec.dictionary
  };
}

export function defineLanguageAdapter(spec) {
  const candidate = cloneAdapterSpec(spec || {});
  delete candidate.capabilities;
  assertValidLanguageAdapter(candidate);
  candidate.languageTags = canonicalLanguageTags(candidate.languageTags);
  candidate.speech.input.languageTag = canonicalizeLanguageTag(candidate.speech.input.languageTag);
  candidate.speech.output.languageTag = canonicalizeLanguageTag(candidate.speech.output.languageTag);
  candidate.capabilities = expectedCapabilities(candidate);
  assertValidLanguageAdapter(candidate);
  return deepFreeze(candidate);
}

function mergeObjects(base, extension) {
  if (!isRecord(base) || !isRecord(extension)) return extension;
  const merged = { ...base };
  for (const [key, value] of Object.entries(extension)) {
    merged[key] = isRecord(value) && isRecord(base[key])
      ? mergeObjects(base[key], value)
      : value;
  }
  return merged;
}

function assertStableIdentity(base, extension) {
  for (const key of ["schemaVersion", "id", "direction"]) {
    if (extension[key] !== undefined && extension[key] !== base[key]) {
      throw new TypeError(`Adapter composition cannot change ${key}.`);
    }
  }
  if (extension.languageTags !== undefined) {
    const baseTags = JSON.stringify(canonicalLanguageTags(base.languageTags));
    const extendedTags = JSON.stringify(canonicalLanguageTags({ ...base.languageTags, ...extension.languageTags }));
    if (baseTags !== extendedTags) throw new TypeError("Adapter composition cannot change languageTags.");
  }
  if (extension.capabilities !== undefined) {
    throw new TypeError("Adapter capabilities are derived and cannot be supplied by an extension.");
  }
}

export function composeLanguageAdapter(baseAdapter, ...extensions) {
  assertValidLanguageAdapter(baseAdapter);
  let composed = cloneAdapterSpec(baseAdapter);
  delete composed.capabilities;
  for (const extension of extensions) {
    if (!isRecord(extension)) throw new TypeError("Adapter extensions must be objects.");
    assertStableIdentity(baseAdapter, extension);
    composed = mergeObjects(composed, extension);
  }
  return defineLanguageAdapter(composed);
}

export function supportsLanguageCapability(adapter, capability) {
  assertValidLanguageAdapter(adapter);
  const capabilities = Array.isArray(adapter.capabilities) ? adapter.capabilities : expectedCapabilities(adapter);
  return capabilities.includes(String(capability || ""));
}

export function assertLanguageCapabilities(adapter, requiredCapabilities) {
  assertValidLanguageAdapter(adapter);
  const capabilities = Array.isArray(adapter.capabilities) ? adapter.capabilities : expectedCapabilities(adapter);
  const requested = Array.isArray(requiredCapabilities) ? requiredCapabilities : [requiredCapabilities];
  const missing = [...new Set(requested.map((value) => String(value || "").trim()).filter(Boolean))]
    .filter((capability) => !capabilities.includes(capability));
  if (missing.length) {
    throw new Error(`Language adapter "${adapter.id}" is missing capabilities: ${missing.join(", ")}.`);
  }
  return adapter;
}

function requireStringResult(value, path) {
  if (typeof value !== "string") throw new TypeError(`${path} must return a string.`);
  return value;
}

export function normalizeLanguageText(adapter, value, context = {}) {
  assertValidLanguageAdapter(adapter);
  return requireStringResult(adapter.normalization.text(value, context), "normalization.text");
}

export function languageSearchKey(adapter, value, context = {}) {
  assertValidLanguageAdapter(adapter);
  return requireStringResult(adapter.normalization.searchKey(value, context), "normalization.searchKey");
}

export function languageAnswerKey(adapter, value, context = {}) {
  assertValidLanguageAdapter(adapter);
  return requireStringResult(adapter.normalization.answerKey(value, context), "normalization.answerKey");
}

function validateSegmentToken(token, index) {
  if (!isRecord(token)) throw new TypeError(`segmentation.segment token ${index} must be an object.`);
  if (!TOKEN_TYPES.has(token.type)) {
    throw new TypeError(`segmentation.segment token ${index} has an invalid type.`);
  }
  if (typeof token.text !== "string" || !token.text) {
    throw new TypeError(`segmentation.segment token ${index} must have non-empty text.`);
  }
  if (token.start !== undefined && (!Number.isInteger(token.start) || token.start < 0)) {
    throw new TypeError(`segmentation.segment token ${index} has an invalid start.`);
  }
  if (token.end !== undefined && (!Number.isInteger(token.end) || token.end < 0)) {
    throw new TypeError(`segmentation.segment token ${index} has an invalid end.`);
  }
}

export function segmentLanguageText(adapter, value, context = {}) {
  assertValidLanguageAdapter(adapter);
  const tokens = adapter.segmentation.segment(value, context);
  if (!Array.isArray(tokens)) throw new TypeError("segmentation.segment must return an array.");
  tokens.forEach(validateSegmentToken);
  return tokens;
}

function validatePronunciation(metadata, path) {
  if (metadata === null) return null;
  if (!isRecord(metadata)) throw new TypeError(`${path} must return an object or null.`);
  for (const key of ["notation", "system", "source"]) {
    if (typeof metadata[key] !== "string" || !metadata[key].trim()) {
      throw new TypeError(`${path}.${key} must be a non-empty string.`);
    }
  }
  if (metadata.languageTag !== undefined && !isLanguageTag(metadata.languageTag)) {
    throw new TypeError(`${path}.languageTag must be a valid BCP 47 language tag.`);
  }
  if (metadata.reviewed !== undefined && typeof metadata.reviewed !== "boolean") {
    throw new TypeError(`${path}.reviewed must be a boolean when present.`);
  }
  if (metadata.speechText !== undefined && typeof metadata.speechText !== "string") {
    throw new TypeError(`${path}.speechText must be a string when present.`);
  }
  return metadata;
}

export function learnerPronunciation(adapter, value, context = {}) {
  assertValidLanguageAdapter(adapter);
  return validatePronunciation(adapter.learner.pronunciation(value, context), "learner.pronunciation");
}

export function learnerDisplay(adapter, value, context = {}) {
  assertValidLanguageAdapter(adapter);
  const metadata = adapter.learner.display(value, context);
  if (!isRecord(metadata)) throw new TypeError("learner.display must return an object.");
  if (typeof metadata.text !== "string" || !metadata.text.trim()) {
    throw new TypeError("learner.display.text must be a non-empty string.");
  }
  if (!isLanguageTag(metadata.languageTag)) {
    throw new TypeError("learner.display.languageTag must be a valid BCP 47 language tag.");
  }
  if (!DIRECTIONS.has(metadata.direction)) {
    throw new TypeError('learner.display.direction must be "ltr" or "rtl".');
  }
  if (metadata.pronunciation !== undefined) {
    validatePronunciation(metadata.pronunciation, "learner.display.pronunciation");
  }
  return metadata;
}

export function acceptedAnswerVariants(adapter, answer, context = {}) {
  assertValidLanguageAdapter(adapter);
  const variants = adapter.answers.variants(answer, context);
  if (!Array.isArray(variants)) throw new TypeError("answers.variants must return an array.");
  const seen = new Set();
  const result = [];
  for (const variant of variants) {
    if (typeof variant !== "string") throw new TypeError("answers.variants must return only strings.");
    const text = normalizeLanguageText(adapter, variant, context);
    const key = languageAnswerKey(adapter, text, context);
    if (!text || !key || seen.has(key)) continue;
    seen.add(key);
    result.push(text);
  }
  return result;
}

export function isAcceptedLanguageAnswer(adapter, attempt, answer, context = {}) {
  const key = languageAnswerKey(adapter, attempt, context);
  if (!key) return false;
  return acceptedAnswerVariants(adapter, answer, context)
    .some((variant) => languageAnswerKey(adapter, variant, context) === key);
}

function validateConfig(config, path) {
  if (!isRecord(config)) throw new TypeError(`${path} must return an object.`);
  if (!isLanguageTag(config.languageTag)) {
    throw new TypeError(`${path}.languageTag must be a valid BCP 47 language tag.`);
  }
  return config;
}

export function speechInputConfig(adapter, options = {}) {
  assertValidLanguageAdapter(adapter);
  return validateConfig(adapter.speech.input.config(options), "speech.input.config");
}

export function speechOutputConfig(adapter, options = {}) {
  assertValidLanguageAdapter(adapter);
  return validateConfig(adapter.speech.output.config(options), "speech.output.config");
}

export function prepareSpeechOutput(adapter, value, context = {}) {
  assertValidLanguageAdapter(adapter);
  return requireStringResult(adapter.speech.output.prepare(value, context), "speech.output.prepare");
}

export function callSpeechInputHook(adapter, options = {}) {
  assertLanguageCapabilities(adapter, LANGUAGE_CAPABILITIES.SPEECH_INPUT_RUNTIME);
  return adapter.speech.input.recognize({
    config: speechInputConfig(adapter, options),
    options,
    adapter
  });
}

export function callSpeechOutputHook(adapter, value, options = {}, context = {}) {
  assertLanguageCapabilities(adapter, LANGUAGE_CAPABILITIES.SPEECH_OUTPUT_RUNTIME);
  return adapter.speech.output.speak({
    text: prepareSpeechOutput(adapter, value, context),
    config: speechOutputConfig(adapter, options),
    context,
    adapter
  });
}

export function dictionaryLookupKey(adapter, value, context = {}) {
  assertValidLanguageAdapter(adapter);
  return requireStringResult(adapter.dictionary.lookupKey(value, context), "dictionary.lookupKey");
}

function requiredPresentationText(value, path) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`${path} must be a non-empty string.`);
  }
  return value.normalize("NFC").trim();
}

function optionalPresentationText(value, path) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new TypeError(`${path} must be a string when present.`);
  return value.normalize("NFC").trim();
}

export function presentDictionaryEntry(adapter, record, context = {}) {
  assertLanguageCapabilities(adapter, LANGUAGE_CAPABILITIES.DICTIONARY_PRESENTATION);
  if (!isRecord(record)) throw new TypeError("Dictionary record must be an object.");
  const presentation = adapter.dictionary.presentEntry(record, context);
  if (!isRecord(presentation)) {
    throw new TypeError("dictionary.presentEntry must return an object.");
  }
  return Object.freeze({
    targetText: requiredPresentationText(
      presentation.targetText,
      "dictionary.presentEntry.targetText"
    ),
    englishAuditText: requiredPresentationText(
      presentation.englishAuditText,
      "dictionary.presentEntry.englishAuditText"
    ),
    category: optionalPresentationText(
      presentation.category,
      "dictionary.presentEntry.category"
    ) || "Core",
    partOfSpeech: optionalPresentationText(
      presentation.partOfSpeech,
      "dictionary.presentEntry.partOfSpeech"
    ),
    exampleTargetText: optionalPresentationText(
      presentation.exampleTargetText,
      "dictionary.presentEntry.exampleTargetText"
    ),
    usageNote: optionalPresentationText(
      presentation.usageNote,
      "dictionary.presentEntry.usageNote"
    )
  });
}

export function callDictionaryHook(adapter, hookName, query, options = {}) {
  if (hookName !== "lookup" && hookName !== "search") {
    throw new TypeError('Dictionary hook name must be "lookup" or "search".');
  }
  const capability = hookName === "lookup"
    ? LANGUAGE_CAPABILITIES.DICTIONARY_LOOKUP
    : LANGUAGE_CAPABILITIES.DICTIONARY_SEARCH;
  assertLanguageCapabilities(adapter, capability);
  return adapter.dictionary[hookName]({
    query: normalizeLanguageText(adapter, query),
    key: dictionaryLookupKey(adapter, query),
    options,
    adapter
  });
}
