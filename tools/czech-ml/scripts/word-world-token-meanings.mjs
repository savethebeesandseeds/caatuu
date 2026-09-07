import assert from "node:assert/strict";
import { tokenize } from "./word-world-standard-lib.mjs";

// Apply sentence-bound hints after the historical authoring records have passed
// their existing validator. This leaves their texts and review receipts intact.
export function applyTokenMeanings(runtimeRecords, document) {
  assert.equal(document?.schemaVersion, "caatuu-word-world-token-meanings-v1");
  assert.equal(document.languageTag, "en");
  assert.equal(document.review?.status, "author-reviewed");
  assert.equal(document.review?.humanApproved, false);
  assert.ok(document.review?.reviewer?.trim());
  assert.match(document.review?.reviewedOn || "", /^\d{4}-\d{2}-\d{2}$/u);
  assert.ok(Array.isArray(document.records));
  const records = structuredClone(runtimeRecords);
  const byId = new Map(records.map(record => [record.id, record]));
  const seen = new Set();
  for (const entry of document.records) {
    assert.ok(!seen.has(entry.id), `Duplicate token-meaning record ${entry.id}`);
    seen.add(entry.id);
    const record = byId.get(entry.id);
    assert.ok(record, `Missing token-meaning record ${entry.id}`);
    assert.equal(record.cs, entry.expectedCs, `${entry.id}: Czech text drifted`);
    assert.equal(record.en, entry.expectedEn, `${entry.id}: English text drifted`);
    assert.ok(Array.isArray(entry.tokens) && entry.tokens.length, `${entry.id}: empty token meanings`);
    const positions = new Set();
    const words = tokenize(record.cs);
    for (const hint of entry.tokens) {
      assert.ok(Number.isInteger(hint.tokenIndex) && hint.tokenIndex >= 0, `${entry.id}: invalid token index`);
      assert.ok(!positions.has(hint.tokenIndex), `${entry.id}: duplicate token position`);
      positions.add(hint.tokenIndex);
      assert.equal(words[hint.tokenIndex]?.surface, hint.surface, `${entry.id}: token surface drifted`);
      const target = record.targets.find(target => target.tokenIndex === hint.tokenIndex && target.surface === hint.surface);
      assert.ok(target, `${entry.id}: token must already be annotated`);
      assert.ok(typeof hint.meaning === "string" && hint.meaning.trim(), `${entry.id}: empty token meaning`);
      target.gloss = hint.meaning.normalize("NFC").trim();
    }
  }
  return records;
}
