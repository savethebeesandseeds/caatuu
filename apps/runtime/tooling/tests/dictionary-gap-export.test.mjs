import assert from "node:assert/strict";
import test from "node:test";

import { buildDictionaryGapExport } from "../../../../apps/languages/czech/static/dictionary-gap-export.mjs";

function gapItem({
  id = "report-1",
  targetWord = "Chybinka",
  normalizedWord = "chybinka",
  lookupOutcome = "no_results",
  lookupReturned = 0,
  outerKind = "dictionary_gap_feedback",
  innerKind = "dictionary_missing_entry"
} = {}) {
  return {
    id,
    attempts: 9,
    lastError: "must-not-leak",
    payload: {
      kind: outerKind,
      url: "https://must-not-leak.invalid/private",
      device: { model: "must-not-leak" },
      feedback: {
        clientReportId: id,
        reportedAt: "2026-08-01T10:00:00.000Z",
        kind: innerKind,
        targetWord,
        normalizedWord,
        dictionaryKey: "kaikki-cs-en-2026-07-09",
        dictionaryDirection: "cs-en",
        lookupOutcome,
        lookupReturned,
        sentence: "must not be exported",
        comment: "private"
      }
    }
  };
}

test("dictionary-gap export contains only the six maintenance fields", () => {
  const exported = buildDictionaryGapExport([
    gapItem(),
    gapItem({ id: "wrong-outer", outerKind: "sentence_feedback" }),
    gapItem({ id: "wrong-inner", innerKind: "sentence_problem" }),
    {
      payload: {
        kind: "dictionary_gap_feedback",
        feedback: {
          kind: "dictionary_missing_entry",
          targetWord: "Wrong pack",
          normalizedWord: "wrong pack",
          dictionaryKey: "other-private-pack",
          dictionaryDirection: "cs-en"
        }
      }
    }
  ]);

  assert.deepEqual(exported, {
    schema: "caatuu.dictionary-gap-batch.v1",
    gaps: [{
      targetWord: "Chybinka",
      normalizedWord: "chybinka",
      dictionaryKey: "kaikki-cs-en-2026-07-09",
      dictionaryDirection: "cs-en",
      lookupOutcome: "no_results",
      lookupReturned: 0
    }]
  });
  assert.doesNotMatch(
    JSON.stringify(exported),
    /must-not-leak|sentence_feedback|sentence_problem|reportedAt|clientReportId|attempts|private/
  );
});

test("dictionary-gap export rejects malformed rows, normalizes bounds, deduplicates, and sorts", () => {
  const exported = buildDictionaryGapExport([
    gapItem({ targetWord: "Žeton", normalizedWord: "ŽETON", lookupReturned: 900 }),
    gapItem({ id: "duplicate", targetWord: "žeton", normalizedWord: "žeton", lookupOutcome: "unexpected" }),
    gapItem({ id: "first", targetWord: "Áčko", normalizedWord: "ÁČKO" }),
    gapItem({ id: "missing-key", targetWord: "", normalizedWord: "" }),
    null
  ]);

  assert.deepEqual(exported.gaps.map((gap) => gap.normalizedWord), ["áčko", "žeton"]);
  assert.equal(exported.gaps[1].lookupReturned, 60);
  assert.equal(exported.gaps.length, 2);
});

test("dictionary-gap export marks an unrecognized outcome without echoing it", () => {
  const exported = buildDictionaryGapExport([
    gapItem({ lookupOutcome: "private free-form reason" })
  ]);
  assert.equal(exported.gaps[0].lookupOutcome, "unknown");
  assert.doesNotMatch(JSON.stringify(exported), /private free-form/);
});
