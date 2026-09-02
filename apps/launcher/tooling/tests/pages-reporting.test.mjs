import assert from "node:assert/strict";
import test from "node:test";
import {
  DICTIONARY_OUTBOX_KEY,
  SENTENCE_OUTBOX_KEY,
  buildSentenceFeedbackReport,
  clearAuthorizedOutbox
} from "../templates/pages-reporting.mjs";
import { validateSentenceReport } from "../../../reporting-worker/src/contracts.mjs";

const payload = Object.freeze({
  kind: "word_world_sentence_feedback",
  title: "must be discarded",
  message: "must be discarded",
  device: { must: "be discarded" },
  feedback: {
    clientReportId: "8a3ab972-c925-4d31-a9b8-0e339d32c88a",
    reportedAt: "must be discarded",
    sentence: "Tohle je věta.",
    translation: "This is a sentence.",
    reason: "wrong_translation",
    comment: "The tense is wrong.",
    targetWord: "discarded",
    entryId: "fixture-1",
    contentMode: "standard",
    corpusVersion: "fixture-v1",
    recentSentences: ["discarded"],
    sentenceModelKey: "discarded"
  }
});

test("Pages sentence reports strip the generic diagnostic envelope", () => {
  assert.deepEqual(buildSentenceFeedbackReport(payload), {
    schema: "caatuu.sentence-feedback-report.v1",
    clientReportId: "8a3ab972-c925-4d31-a9b8-0e339d32c88a",
    sentence: "Tohle je věta.",
    translation: "This is a sentence.",
    reason: "wrong_translation",
    comment: "The tense is wrong.",
    entryId: "fixture-1",
    contentMode: "standard",
    corpusVersion: "fixture-v1"
  });
});

test("Pages sentence reports reject unsupported content", () => {
  assert.equal(buildSentenceFeedbackReport({ ...payload, kind: "setup_attention" }), null);
  assert.equal(buildSentenceFeedbackReport({
    ...payload,
    feedback: { ...payload.feedback, reason: "arbitrary" }
  }), null);
});

test("Pages and Worker normalize multiline report text identically", () => {
  const report = buildSentenceFeedbackReport({
    ...payload,
    feedback: {
      ...payload.feedback,
      sentence: "Tohle\tje\nvěta.",
      comment: "First line.\r\nSecond line."
    }
  });
  assert.equal(report.sentence, "Tohle je věta.");
  assert.equal(report.comment, "First line. Second line.");
  assert.deepEqual(validateSentenceReport(report), report);
  assert.deepEqual(validateSentenceReport({
    ...report,
    sentence: "Tohle\tje\nvěta.",
    comment: "First line.\r\nSecond line."
  }), report);
});

function memoryStorage(entries) {
  const values = new Map(entries);
  return {
    get length() { return values.size; },
    key(index) { return [...values.keys()][index] ?? null; },
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
    values
  };
}

test("revocation clears only the new authorized dictionary queue", () => {
  const storage = memoryStorage([
    ["caatuu.dictionaryGapOutbox.v1.item.legacy", "legacy"],
    [`${DICTIONARY_OUTBOX_KEY}.item.authorized`, "authorized"],
    [`${SENTENCE_OUTBOX_KEY}.item.sentence`, "sentence"]
  ]);
  assert.equal(clearAuthorizedOutbox(storage, DICTIONARY_OUTBOX_KEY), 1);
  assert.equal(storage.getItem("caatuu.dictionaryGapOutbox.v1.item.legacy"), "legacy");
  assert.equal(storage.getItem(`${SENTENCE_OUTBOX_KEY}.item.sentence`), "sentence");
  assert.equal(storage.getItem(`${DICTIONARY_OUTBOX_KEY}.item.authorized`), null);
});
