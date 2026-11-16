import assert from "node:assert/strict";
import test from "node:test";
import { bankDigits, courseRecordId } from "../lib/derive-semantic-bank-content.mjs";
import { classifySentenceFlag, validateSentenceReportV3 } from "../../../apps/reporting-worker/src/contracts-v2.mjs";

test("course record ids are derived from the bank id and stay stable", () => {
  const bankId = "sb.word-net.000042";
  assert.equal(bankDigits(bankId), "000042");
  assert.equal(courseRecordId("es", "word-net", bankId), "es.word-net.000042");
  assert.equal(courseRecordId("es-en", "memory-moon", "sb.memory-moon.000007"), "mm-es-en-000007");
  assert.equal(courseRecordId("cz", "conjugation-comet", "sb.conjugation-comet.000008"), "cz-conjugation-comet-000008");
});

test("a content flag reaches the bank only when the English line still matches", () => {
  const bank = "The book is on the table.";
  assert.equal(classifySentenceFlag({ flagTarget: "content", englishAtFlag: bank }, bank), "content");
  assert.equal(classifySentenceFlag({ flagTarget: "translation", englishAtFlag: bank }, bank), "translation");
  assert.equal(classifySentenceFlag({ flagTarget: "content", englishAtFlag: "The book is under the table." }, bank), "course-local");
  assert.equal(classifySentenceFlag({ flagTarget: "play", englishAtFlag: bank }, bank), "play");
});

test("a v3 sentence report names the bank and the flag target", () => {
  const report = validateSentenceReportV3({
    schema: "caatuu.sentence-feedback-report.v3",
    courseId: "es",
    sourceLanguage: "en",
    targetLanguage: "es-ES",
    clientReportId: "8a3ab972-c925-4d31-a9b8-0e339d32c88a",
    sentence: "El libro está en la mesa.",
    translation: "The book is on the table.",
    reason: "nonsense_or_incorrect",
    comment: "",
    entryId: "es.word-net.000042",
    contentMode: "authored",
    corpusVersion: "bank",
    semanticBankId: "sb.word-net.000042",
    contentId: "es.word-net.000042",
    flagTarget: "content",
    englishAtFlag: "The book is on the table.",
    translationAtFlag: "El libro está en la mesa."
  });
  assert.equal(report.flagTarget, "content");
  assert.equal(report.semanticBankId, "sb.word-net.000042");
  assert.equal(classifySentenceFlag(report, "The book is on the table."), "content");
  assert.equal(classifySentenceFlag(report, "A different line."), "course-local");
});
