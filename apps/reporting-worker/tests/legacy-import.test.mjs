import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { generateLegacyImport } from "../tooling/generate-legacy-import.mjs";

function fixture() {
  const source = {
    schema: "caatuu.dictionary-gap-store.v1",
    updatedAtUnixMs: 2000,
    gaps: [{
      targetWord: "Příklad",
      normalizedWord: "příklad",
      dictionaryKey: "kaikki-cs-en-2026-07-09",
      dictionaryDirection: "cs-en",
      lookupOutcome: "no_results",
      lookupReturned: 0,
      firstSeenAtUnixMs: 1000,
      lastSeenAtUnixMs: 2000
    }]
  };
  const bytes = Buffer.from(`${JSON.stringify(source)}\n`);
  return {
    bytes,
    expected: {
      schema: source.schema,
      records: 1,
      bytes: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex")
    }
  };
}

test("legacy import is receipt-bound, private, and idempotent", () => {
  const { bytes, expected } = fixture();
  const generated = generateLegacyImport(bytes, expected, { importedAtUnixMs: 3000 });
  assert.equal(generated.receipt.records, 1);
  assert.match(generated.sql, /ON CONFLICT \(dictionary_key, dictionary_direction, normalized_word\) DO UPDATE/u);
  assert.match(generated.sql, /ON CONFLICT \(source_sha256\) DO NOTHING/u);
  assert.doesNotMatch(JSON.stringify(generated.receipt), /Příklad|příklad/u);
});

test("legacy import refuses any receipt mismatch", () => {
  const { bytes, expected } = fixture();
  assert.throws(() => generateLegacyImport(bytes, { ...expected, records: 2 }), /record count changed/u);
  assert.throws(() => generateLegacyImport(bytes, { ...expected, sha256: "0".repeat(64) }), /digest changed/u);
});
