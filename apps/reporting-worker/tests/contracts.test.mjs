import assert from "node:assert/strict";
import test from "node:test";
import {
  SENTENCE_REPORT_SCHEMA,
  validateDictionaryGap,
  validateSentenceReport
} from "../src/contracts.mjs";

const gap = Object.freeze({
  schema: "caatuu.dictionary-gap-report.v1",
  targetWord: "Příklad",
  normalizedWord: "příklad",
  dictionaryKey: "kaikki-cs-en-2026-07-09",
  dictionaryDirection: "cs-en",
  lookupOutcome: "no_results",
  lookupReturned: 0
});

const sentence = Object.freeze({
  schema: SENTENCE_REPORT_SCHEMA,
  clientReportId: "8a3ab972-c925-4d31-a9b8-0e339d32c88a",
  sentence: "Tohle je věta.",
  translation: "This is a sentence.",
  reason: "wrong_translation",
  comment: "The tense is wrong.",
  entryId: "fixture-1",
  contentMode: "standard",
  corpusVersion: "fixture-v1"
});

test("dictionary reports retain only the fixed narrow protocol", () => {
  assert.deepEqual(validateDictionaryGap(gap), gap);
  assert.equal(validateDictionaryGap({ ...gap, sentence: "must not leave the device" }), null);
  assert.equal(validateDictionaryGap({ ...gap, lookupReturned: 1 }), null);
  assert.equal(validateDictionaryGap({ ...gap, dictionaryKey: "another-dictionary" }), null);
});

test("sentence reports accept the exact minimized schema", () => {
  assert.deepEqual(validateSentenceReport(sentence), sentence);
  for (const forbidden of ["reportedAt", "recentSentences", "targetWord", "device", "url", "events"]) {
    assert.equal(validateSentenceReport({ ...sentence, [forbidden]: "forbidden" }), null, forbidden);
  }
});

test("sentence reports enforce identifiers, reasons, and text limits", () => {
  assert.equal(validateSentenceReport({ ...sentence, clientReportId: "not-a-uuid" }), null);
  assert.equal(validateSentenceReport({ ...sentence, reason: "anything" }), null);
  assert.equal(validateSentenceReport({ ...sentence, sentence: "x".repeat(361) }), null);
  assert.equal(validateSentenceReport({ ...sentence, comment: "x".repeat(401) }), null);
});
