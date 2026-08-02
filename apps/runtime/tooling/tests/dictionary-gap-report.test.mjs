import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDictionaryGapReport,
  collectLegacyDictionaryGapReports,
  DICTIONARY_GAP_REPORT_SCHEMA
} from "../../../../apps/languages/czech/static/dictionary-gap-report.mjs";

function observation(overrides = {}) {
  return {
    targetWord: "Řekněme",
    normalizedWord: "řekněme",
    dictionaryKey: "kaikki-cs-en-2026-07-09",
    dictionaryDirection: "cs-en",
    lookupOutcome: "no_results",
    lookupReturned: 0,
    ...overrides
  };
}

test("dictionary-gap reports expose only the narrow server schema", () => {
  const report = buildDictionaryGapReport(observation({
    sentence: "must not leave the device",
    translation: "private",
    comment: "private",
    clientReportId: "private",
    reportedAt: "private",
    device: { model: "private" },
    url: "https://private.invalid"
  }));

  assert.deepEqual(report, {
    schema: DICTIONARY_GAP_REPORT_SCHEMA,
    targetWord: "Řekněme",
    normalizedWord: "řekněme",
    dictionaryKey: "kaikki-cs-en-2026-07-09",
    dictionaryDirection: "cs-en",
    lookupOutcome: "no_results",
    lookupReturned: 0
  });
  assert.doesNotMatch(
    JSON.stringify(report),
    /sentence|translation|comment|clientReportId|reportedAt|device|url|private/
  );
});

test("dictionary-gap reports enforce the pinned dictionary and lookup invariant", () => {
  assert.equal(buildDictionaryGapReport(observation({ dictionaryKey: "another-dictionary" })), null);
  assert.equal(buildDictionaryGapReport(observation({ normalizedWord: "jiné" })), null);
  assert.equal(buildDictionaryGapReport(observation({ lookupReturned: 1 })), null);
  assert.equal(buildDictionaryGapReport(observation({
    lookupOutcome: "no_exact_usable_entry",
    lookupReturned: 0
  })), null);
  assert.equal(buildDictionaryGapReport(observation({ lookupOutcome: "free-form reason" })), null);
  assert.equal(buildDictionaryGapReport(observation({ targetWord: "Řekně\nme" })), null);
  assert.equal(buildDictionaryGapReport(observation({ lookupReturned: 1.5 })), null);
  assert.equal(buildDictionaryGapReport(observation({ lookupReturned: 61 })), null);

  assert.deepEqual(buildDictionaryGapReport(observation({
    lookupOutcome: "no_exact_usable_entry",
    lookupReturned: 2
  })), {
    schema: DICTIONARY_GAP_REPORT_SCHEMA,
    ...observation({ lookupOutcome: "no_exact_usable_entry", lookupReturned: 2 })
  });
});

test("legacy device rows migrate as deduplicated narrow observations", () => {
  const legacy = (id, feedback, kind = "dictionary_gap_feedback") => ({
    id,
    attempts: 8,
    lastError: "private",
    payload: {
      kind,
      url: "https://private.invalid",
      device: { model: "private" },
      feedback: { kind: "dictionary_missing_entry", ...feedback }
    }
  });
  const reports = collectLegacyDictionaryGapReports([
    legacy("first", observation()),
    legacy("duplicate", observation({ targetWord: "řekněme" })),
    legacy("wrong-kind", observation(), "sentence_feedback"),
    legacy("second", observation({ targetWord: "Áčko", normalizedWord: "áčko" }))
  ]);

  assert.deepEqual(reports.map((report) => report.normalizedWord), ["áčko", "řekněme"]);
  assert.doesNotMatch(JSON.stringify(reports), /private|attempts|lastError|sentence_feedback/);
});
