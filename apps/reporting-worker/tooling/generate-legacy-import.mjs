import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateDictionaryGap } from "../src/contracts.mjs";

const toolingDir = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(toolingDir, "../../..");
const defaultSource = resolve(workspaceRoot, "artifacts/dictionary-gaps/czech-missing-words.v1.json");
const defaultOutput = resolve(workspaceRoot, "artifacts/reporting-worker/private/import-legacy-dictionary-gaps.sql");

export const expectedLegacyReceipt = Object.freeze({
  schema: "caatuu.dictionary-gap-store.v1",
  records: 10,
  bytes: 3309,
  sha256: "3d5657bfb739f5cdd3db1e7bf0d2161c93efbbfd2cdcca2d05156048a8e9ee3f"
});

function sqlText(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function generateLegacyImport(bytes, expected = expectedLegacyReceipt, { importedAtUnixMs = Date.now() } = {}) {
  const sourceSha256 = digest(bytes);
  assert.equal(bytes.byteLength, expected.bytes, "Legacy dictionary-gap byte count changed");
  assert.equal(sourceSha256, expected.sha256, "Legacy dictionary-gap digest changed");
  const source = JSON.parse(bytes.toString("utf8"));
  assert.equal(source.schema, expected.schema, "Legacy dictionary-gap schema changed");
  assert.ok(Array.isArray(source.gaps), "Legacy dictionary-gap store has no gaps array");
  assert.equal(source.gaps.length, expected.records, "Legacy dictionary-gap record count changed");
  assert.ok(Number.isInteger(source.updatedAtUnixMs) && source.updatedAtUnixMs >= 0, "Legacy update timestamp is invalid");

  const seen = new Set();
  const rows = source.gaps.map((gap) => {
    const report = validateDictionaryGap({
      schema: "caatuu.dictionary-gap-report.v1",
      targetWord: gap.targetWord,
      normalizedWord: gap.normalizedWord,
      dictionaryKey: gap.dictionaryKey,
      dictionaryDirection: gap.dictionaryDirection,
      lookupOutcome: gap.lookupOutcome,
      lookupReturned: gap.lookupReturned
    });
    assert.ok(report, "Legacy dictionary-gap record is invalid");
    assert.ok(Number.isInteger(gap.firstSeenAtUnixMs) && gap.firstSeenAtUnixMs > 0, "Legacy first-seen timestamp is invalid");
    assert.ok(
      Number.isInteger(gap.lastSeenAtUnixMs) && gap.lastSeenAtUnixMs >= gap.firstSeenAtUnixMs,
      "Legacy last-seen timestamp is invalid"
    );
    const key = `${report.dictionaryKey}|${report.dictionaryDirection}|${report.normalizedWord}`;
    assert.ok(!seen.has(key), "Legacy dictionary-gap records are not unique");
    seen.add(key);
    return { ...report, firstSeenAtUnixMs: gap.firstSeenAtUnixMs, lastSeenAtUnixMs: gap.lastSeenAtUnixMs };
  });

  const statements = rows.map((row) => `INSERT INTO dictionary_gaps (
  dictionary_key, dictionary_direction, normalized_word, target_word,
  lookup_outcome, lookup_returned, first_seen_at_unix_ms,
  last_seen_at_unix_ms, observation_count
) VALUES (
  ${sqlText(row.dictionaryKey)}, ${sqlText(row.dictionaryDirection)}, ${sqlText(row.normalizedWord)}, ${sqlText(row.targetWord)},
  ${sqlText(row.lookupOutcome)}, ${row.lookupReturned}, ${row.firstSeenAtUnixMs}, ${row.lastSeenAtUnixMs}, 1
)
ON CONFLICT (dictionary_key, dictionary_direction, normalized_word) DO UPDATE SET
  target_word = excluded.target_word,
  lookup_outcome = excluded.lookup_outcome,
  lookup_returned = excluded.lookup_returned,
  first_seen_at_unix_ms = MIN(dictionary_gaps.first_seen_at_unix_ms, excluded.first_seen_at_unix_ms),
  last_seen_at_unix_ms = MAX(dictionary_gaps.last_seen_at_unix_ms, excluded.last_seen_at_unix_ms);`);

  statements.push(`INSERT INTO legacy_imports (
  source_schema, source_sha256, source_bytes, record_count,
  source_updated_at_unix_ms, imported_at_unix_ms
) VALUES (
  ${sqlText(source.schema)}, ${sqlText(sourceSha256)}, ${bytes.byteLength}, ${rows.length},
  ${source.updatedAtUnixMs}, ${Number(importedAtUnixMs)}
)
ON CONFLICT (source_sha256) DO NOTHING;`);

  return {
    sql: `${statements.join("\n\n")}\n`,
    receipt: {
      schema: source.schema,
      records: rows.length,
      bytes: bytes.byteLength,
      sha256: sourceSha256,
      sourceUpdatedAtUnixMs: source.updatedAtUnixMs
    }
  };
}

function parseArguments(argv) {
  const options = { source: defaultSource, output: defaultOutput };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--source") options.source = resolve(argv[++index]);
    else if (argv[index] === "--output") options.output = resolve(argv[++index]);
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  return options;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseArguments(process.argv.slice(2));
  const generated = generateLegacyImport(readFileSync(options.source));
  mkdirSync(dirname(options.output), { recursive: true });
  writeFileSync(options.output, generated.sql, { encoding: "utf8", mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ ok: true, output: options.output, ...generated.receipt })}\n`);
}
