import assert from "node:assert/strict";
import test from "node:test";

import {
  LANGUAGE_ADAPTER_SCHEMA_VERSION,
  LANGUAGE_CAPABILITIES,
  acceptedAnswerVariants,
  assertLanguageCapabilities,
  callDictionaryHook,
  callSpeechOutputHook,
  canonicalizeLanguageTag,
  composeLanguageAdapter,
  defineLanguageAdapter,
  dictionaryLookupKey,
  isAcceptedLanguageAnswer,
  languageAnswerKey,
  languageSearchKey,
  learnerDisplay,
  learnerPronunciation,
  normalizeLanguageText,
  prepareSpeechOutput,
  segmentLanguageText,
  speechInputConfig,
  speechOutputConfig,
  supportsLanguageCapability,
  validateLanguageAdapter
} from "../contract.mjs";
import { importBrowserLanguageAdapter } from "./browser-module-loader.mjs";

const [czech, mandarin] = await Promise.all([
  importBrowserLanguageAdapter("../../languages/czech/static/source/language/adapter.mjs"),
  importBrowserLanguageAdapter("../../languages/mandarin-simplified/static/source/language/adapter.mjs")
]);

function reviewedPinyin(notation) {
  return { system: "pinyin", notation, reviewed: true };
}

test("defines immutable, canonical, structurally valid adapters", () => {
  for (const adapter of [czech, mandarin]) {
    assert.equal(adapter.schemaVersion, LANGUAGE_ADAPTER_SCHEMA_VERSION);
    assert.deepEqual(validateLanguageAdapter(adapter), { valid: true, errors: [] });
    assert.ok(Object.isFrozen(adapter));
    assert.ok(Object.isFrozen(adapter.languageTags));
    assert.ok(Object.isFrozen(adapter.capabilities));
  }
  assert.equal(canonicalizeLanguageTag("cs_cz"), "cs-CZ");
  assert.equal(canonicalizeLanguageTag("zh-hans"), "zh-Hans");
  assert.throws(() => canonicalizeLanguageTag("not a tag"), /Invalid language tag/);
});

test("validation reports incomplete adapter sections without invoking hooks", () => {
  const result = validateLanguageAdapter({
    schemaVersion: 1,
    id: "broken",
    direction: "ltr",
    languageTags: { primary: "cs", locale: "bad tag", html: "cs", fallbacks: [] }
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("languageTags.locale must be a valid BCP 47 language tag."));
  assert.ok(result.errors.includes("normalization must be an object."));
  assert.ok(result.errors.includes("dictionary must be an object."));
  assert.throws(() => defineLanguageAdapter({}), /Invalid language adapter/);
});

test("composition attaches optional I/O hooks and derives capability assertions", async () => {
  assert.equal(supportsLanguageCapability(czech, LANGUAGE_CAPABILITIES.DICTIONARY_LOOKUP), false);
  assert.equal(supportsLanguageCapability(czech, LANGUAGE_CAPABILITIES.SPEECH_OUTPUT_RUNTIME), false);

  const lookup = async ({ key, options }) => ({ key, limit: options.limit });
  const speak = async ({ text, config }) => ({ text, config });
  const composed = composeLanguageAdapter(czech, {
    dictionary: { lookup },
    speech: { output: { speak } }
  });

  assert.notEqual(composed, czech);
  assert.equal(czech.dictionary.lookup, null);
  assert.equal(composed.dictionary.lookup, lookup);
  assertLanguageCapabilities(composed, [
    LANGUAGE_CAPABILITIES.DICTIONARY_LOOKUP,
    LANGUAGE_CAPABILITIES.SPEECH_OUTPUT_RUNTIME
  ]);
  assert.deepEqual(await callDictionaryHook(composed, "lookup", "  PŘÍBĚH! ", { limit: 2 }), {
    key: "příběh",
    limit: 2
  });
  assert.deepEqual(await callSpeechOutputHook(composed, " Dobrý den. ", { difficulty: 3 }), {
    text: "Dobrý den.",
    config: {
      languageTag: "cs-CZ",
      rate: 1,
      pitch: 1,
      voice: "",
      pace: "normal",
      paceLabel: "Normal",
      maxCharacters: 1000
    }
  });
  assert.throws(
    () => assertLanguageCapabilities(czech, LANGUAGE_CAPABILITIES.DICTIONARY_LOOKUP),
    /missing capabilities: dictionary.lookup/
  );
  assert.throws(() => composeLanguageAdapter(czech, { id: "other" }), /cannot change id/);
});

test("Czech normalization preserves orthography while search remains accent-insensitive", () => {
  assert.equal(normalizeLanguageText(czech, "  pr\u030ci\u0301be\u030ch  "), "příběh");
  assert.equal(languageSearchKey(czech, "  PŘÍBĚH  "), "pribeh");
  assert.equal(languageAnswerKey(czech, "  DĚLÁM   TO  "), "dělám to");
  assert.equal(dictionaryLookupKey(czech, "…PŘÍBĚH!"), "příběh");
});

test("Czech segmentation matches the current Unicode word and punctuation behavior", () => {
  assert.equal(czech.segmentation.strategy, "computed");
  assert.deepEqual(segmentLanguageText(czech, "Dítě čte e-mail, ne?"), [
    { type: "word", text: "Dítě" },
    { type: "word", text: "čte" },
    { type: "word", text: "e-mail" },
    { type: "punctuation", text: "," },
    { type: "word", text: "ne" },
    { type: "punctuation", text: "?" }
  ]);
  assertLanguageCapabilities(czech, LANGUAGE_CAPABILITIES.COMPUTED_SEGMENTATION);
});

test("Czech learner, answer, and speech metadata preserve current policies", () => {
  assert.deepEqual(learnerPronunciation(czech, "Dobrý den."), {
    notation: "Dobrý den.",
    system: "Czech orthography",
    source: "display-text",
    languageTag: "cs-CZ",
    speechText: "Dobrý den."
  });
  assert.deepEqual(learnerDisplay(czech, "Dobrý den."), {
    text: "Dobrý den.",
    languageTag: "cs-CZ",
    direction: "ltr",
    pronunciation: learnerPronunciation(czech, "Dobrý den.")
  });

  const answer = { form: "dělají", accepted: ["dělaj", "DĚLAJÍ"] };
  assert.deepEqual(acceptedAnswerVariants(czech, answer), ["dělají", "dělaj"]);
  assert.equal(isAcceptedLanguageAnswer(czech, " DĚLAJ ", answer), true);
  assert.equal(isAcceptedLanguageAnswer(czech, "delaji", answer), false);

  assert.deepEqual(speechInputConfig(czech, { maxAlternatives: 20 }), {
    languageTag: "cs-CZ",
    continuous: false,
    interimResults: false,
    maxAlternatives: 10
  });
  assert.deepEqual(speechOutputConfig(czech, { difficulty: 2 }), {
    languageTag: "cs-CZ",
    rate: 0.6,
    pitch: 1,
    voice: "",
    pace: "slow",
    paceLabel: "Slow",
    maxCharacters: 1000
  });
  assert.equal(prepareSpeechOutput(czech, "  Dobrý den.  "), "Dobrý den.");
  assert.throws(() => prepareSpeechOutput(czech, "x".repeat(1001)), /up to 1,000 characters/);
});

test("Mandarin keeps the Simplified Chinese locale zh-Hans and speech locale zh-CN", () => {
  assert.deepEqual(mandarin.languageTags, {
    primary: "zh-Hans",
    locale: "zh-Hans",
    html: "zh-Hans",
    fallbacks: ["zh-CN", "zh"]
  });
  assert.equal(mandarin.speech.input.languageTag, "zh-CN");
  assert.equal(mandarin.speech.output.languageTag, "zh-CN");
  assert.equal(mandarin.learner.requiresAuthoredPronunciation, true);
  assertLanguageCapabilities(mandarin, LANGUAGE_CAPABILITIES.AUTHORED_SEGMENTATION);
});

test("Mandarin Hanzi display and speech work without exposing unreviewed pinyin", () => {
  assert.deepEqual(learnerDisplay(mandarin, { text: "银行" }), {
    text: "银行",
    languageTag: "zh-Hans",
    direction: "ltr"
  });
  assert.equal(learnerPronunciation(mandarin, { text: "银行" }), null);
  assert.throws(
    () => learnerPronunciation(mandarin, {
      text: "银行",
      pronunciation: { system: "pinyin", notation: "yínháng", reviewed: false }
    }),
    /reviewed must be true/
  );

  const content = { text: "银行", pronunciation: reviewedPinyin("yínháng") };
  assert.deepEqual(learnerDisplay(mandarin, content), {
    text: "银行",
    languageTag: "zh-Hans",
    direction: "ltr",
    pronunciation: {
      notation: "yínháng",
      system: "pinyin",
      source: "authored",
      reviewed: true,
      languageTag: "zh-Latn-pinyin"
    }
  });
  assert.equal(prepareSpeechOutput(mandarin, "银行"), "银行");
  assert.equal(prepareSpeechOutput(mandarin, { text: "银行" }), "银行");
  assert.equal(prepareSpeechOutput(mandarin, content), "银行");
});

test("Mandarin segmentation accepts authored Hanzi boundaries without requiring pinyin", () => {
  const content = {
    text: "我去银行。",
    tokens: [
      { surface: "我", gloss: "I; me", playable: true },
      { surface: "去", gloss: "go", playable: true },
      { surface: "银行", gloss: "bank", playable: true }
    ]
  };
  const tokens = segmentLanguageText(mandarin, content);
  assert.deepEqual(tokens.map(({ type, text }) => ({ type, text })), [
    { type: "word", text: "我" },
    { type: "word", text: "去" },
    { type: "word", text: "银行" },
    { type: "punctuation", text: "。" }
  ]);
  assert.equal(tokens.some((token) => "pronunciation" in token), false);
  assert.equal(tokens.some((token) => token.text === "行"), false);
  assert.throws(() => segmentLanguageText(mandarin, "我去银行。"), /raw strings are not segmented/);
  assert.throws(
    () => segmentLanguageText(mandarin, {
      ...content,
      tokens: [{ surface: "银行。", gloss: "bank" }]
    }),
    /learner-facing text|authored letter and number|authored order/u
  );
});

test("Mandarin accepted answers never gain pinyin or guessed variants implicitly", () => {
  const answer = {
    text: "银行",
    pronunciation: reviewedPinyin("yínháng"),
    acceptedAnswers: ["銀行"]
  };
  assert.deepEqual(acceptedAnswerVariants(mandarin, answer), ["银行", "銀行"]);
  assert.equal(isAcceptedLanguageAnswer(mandarin, "银行", answer), true);
  assert.equal(isAcceptedLanguageAnswer(mandarin, "銀行", answer), true);
  assert.equal(isAcceptedLanguageAnswer(mandarin, "yínháng", answer), false);
  assert.equal(languageSearchKey(mandarin, "  银行  "), "银行");
});

test("both adapters expose optional dictionary and speech runtime hooks cleanly", () => {
  for (const adapter of [czech, mandarin]) {
    assert.equal(adapter.dictionary.lookup, null);
    assert.equal(adapter.dictionary.search, null);
    assert.equal(adapter.speech.input.recognize, null);
    assert.equal(adapter.speech.output.speak, null);
    assert.equal(supportsLanguageCapability(adapter, LANGUAGE_CAPABILITIES.DICTIONARY_LOOKUP), false);
    assert.equal(supportsLanguageCapability(adapter, LANGUAGE_CAPABILITIES.SPEECH_INPUT_RUNTIME), false);
    assert.equal(supportsLanguageCapability(adapter, LANGUAGE_CAPABILITIES.SPEECH_OUTPUT_RUNTIME), false);
  }
});
