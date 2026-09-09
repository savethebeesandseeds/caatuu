import assert from "node:assert/strict";
import test from "node:test";
import {
  assertLanguageAdapterMatchesTarget, dictionaryLookupKey, isAcceptedLanguageAnswer,
  languageAnswerKey, languageSearchKey, learnerDisplay, learnerPronunciation,
  normalizeLanguageText, prepareSpeechOutput, segmentLanguageText,
  speechInputConfig, speechOutputConfig, validateLanguageAdapter
} from "../contract.mjs";
import { importBrowserLanguageAdapter } from "./browser-module-loader.mjs";

const adapter = await importBrowserLanguageAdapter("../../languages/norwegian-bokmal/static/source/language/adapter.mjs");
const target = { id: "nb", locale: "nb-NO", script: "Latn", speechLocale: "nb-NO", direction: "ltr" };

test("Bokmål adapter is immutable and bound to its exact target", () => {
  assert.deepEqual(validateLanguageAdapter(adapter), { valid: true, errors: [] });
  assert.ok(Object.isFrozen(adapter));
  assert.equal(assertLanguageAdapterMatchesTarget(adapter, target), adapter);
  assert.throws(() => assertLanguageAdapterMatchesTarget(adapter, { ...target, locale: "nn-NO" }), /does not match/u);
  assert.equal(learnerPronunciation(adapter, "blåbær"), null);
  assert.deepEqual(learnerDisplay(adapter, "Blåbær"), { text: "Blåbær", languageTag: "nb-NO", direction: "ltr" });
});

test("Norwegian answer, search and dictionary keys preserve æ, ø, å and canonical composition", () => {
  assert.equal(normalizeLanguageText(adapter, "  bla\u030Abær  "), "blåbær");
  for (const operation of [languageAnswerKey, languageSearchKey, dictionaryLookupKey]) {
    assert.equal(operation(adapter, " BLÅBÆR "), "blåbær");
    assert.notEqual(operation(adapter, "bær"), operation(adapter, "bar"));
    assert.notEqual(operation(adapter, "før"), operation(adapter, "for"));
    assert.notEqual(operation(adapter, "bål"), operation(adapter, "bal"));
  }
  assert.equal(isAcceptedLanguageAnswer(adapter, "før", "for"), false);
  assert.equal(isAcceptedLanguageAnswer(adapter, "BLÅBÆR", "blåbær"), true);
});

test("Norwegian segmentation retains complete word tokens and punctuation", () => {
  const result = segmentLanguageText(adapter, "Æsop så 2 ørner.");
  assert.deepEqual(result.map(item => [item.type, item.text]), [
    ["word", "Æsop"], ["word", "så"], ["word", "2"], ["word", "ørner"], ["punctuation", "."]
  ]);
});

test("Bokmål speech uses the declared locale and existing pace and length limits", () => {
  assert.equal(speechInputConfig(adapter).languageTag, "nb-NO");
  for (const [difficulty, rate] of [[1, 0.55], [2, 0.7], [3, 1]]) {
    const config = speechOutputConfig(adapter, { difficulty });
    assert.equal(config.languageTag, "nb-NO");
    assert.equal(config.rate, rate);
  }
  assert.equal(prepareSpeechOutput(adapter, "  Ørnen flyr.  "), "Ørnen flyr.");
  assert.throws(() => prepareSpeechOutput(adapter, ""), /non-empty/u);
  assert.throws(() => prepareSpeechOutput(adapter, "a".repeat(1001)), /1,000/u);
});
