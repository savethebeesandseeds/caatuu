import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const mlRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cleanupScript = path.join(mlRoot, "scripts", "cleanup-curriculum-diversity.mjs");
const correctionsFile = path.join(
  mlRoot,
  "data",
  "curriculum",
  "core-v0.2",
  "editorial",
  "child-safety-corrections.json",
);
const checkedInCuratedFile = path.join(
  mlRoot,
  "data",
  "curriculum",
  "core-v0.2",
  "curated",
  "curriculum-core.en.jsonl",
);
const vectorBuilderFile = path.join(mlRoot, "scripts", "build-curriculum-vector-db.mjs");

test("the curriculum child-safety manifest survives authoritative regeneration", async (t) => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "caatuu-curriculum-safety-"));
  t.after(() => fs.rm(temporaryRoot, { recursive: true, force: true }));

  const generatedCuratedFile = path.join(temporaryRoot, "curated", "curriculum-core.en.jsonl");
  const generatedReportFile = path.join(temporaryRoot, "reports", "diversity-cleanup.json");
  const generatedReportMarkdownFile = path.join(temporaryRoot, "reports", "diversity-cleanup.md");
  const result = spawnSync(process.execPath, [
    cleanupScript,
    "--out-dataset-dir", temporaryRoot,
    "--out-file", generatedCuratedFile,
    "--report-file", generatedReportFile,
    "--report-md-file", generatedReportMarkdownFile,
    "--czech-overlay-file", checkedInCuratedFile,
    "--child-safety-corrections-file", correctionsFile,
  ], { encoding: "utf8" });

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);

  const correctionDocument = JSON.parse(await fs.readFile(correctionsFile, "utf8"));
  const corrections = correctionDocument.corrections;
  assert.equal(corrections.length, 56);
  assert.equal(new Set(corrections.map((correction) => correction.id)).size, corrections.length);

  const generatedRows = await readJsonl(generatedCuratedFile);
  const checkedInRows = await readJsonl(checkedInCuratedFile);
  assert.equal(generatedRows.length, 5000);
  assert.equal(checkedInRows.length, 5000);
  assert.deepEqual(generatedRows, checkedInRows, "checked-in curriculum must match authoritative regeneration");

  const generatedById = new Map(generatedRows.map((row) => [row.id, row]));
  const checkedInById = new Map(checkedInRows.map((row) => [row.id, row]));
  for (const correction of corrections) {
    const generated = generatedById.get(correction.id);
    const checkedIn = checkedInById.get(correction.id);
    assert.ok(generated, `missing generated correction row ${correction.id}`);
    assert.ok(checkedIn, `missing checked-in correction row ${correction.id}`);
    for (const [field, expected] of Object.entries(correction.replacement)) {
      assert.deepEqual(generated[field], expected, `${correction.id}.${field}`);
      assert.deepEqual(checkedIn[field], expected, `checked-in ${correction.id}.${field}`);
    }
    assert.equal(generated.notes, "", `${correction.id} notes`);
    assert.equal(generated.child_safe, true, `${correction.id} child_safe`);
  }

  const generatedReport = JSON.parse(await fs.readFile(generatedReportFile, "utf8"));
  assert.equal(generatedReport.child_safety_correction_count, 56);
  assert.deepEqual(generatedReport.child_safety_correction_ids, corrections.map((correction) => correction.id));
  assert.deepEqual(generatedReport.exact_duplicate_texts, []);
});

test("the corrected curriculum excludes the reviewed ambiguous contexts", async () => {
  const rows = await readJsonl(checkedInCuratedFile);
  const text = rows.map((row) => `${row.english_text}\n${row.czech_text}`).join("\n");

  for (const unsafeContext of [
    "Please show me the pants.",
    "Please show me the dress.",
    "Please show me the skirt.",
    "Please hold the pants.",
    "Please hold the dress.",
    "Please hold the skirt.",
    "Miminko nosí kalhotky oběma rukama.",
    "A teacher rests in the bedroom.",
    "A neighbor gives the child a small rope.",
    "A neighbor carries the hard rope to the room.",
  ]) {
    assert.equal(text.includes(unsafeContext), false, unsafeContext);
  }

  assert.equal(/\b[Pp]řítel\b/u.test(text), false, "friend must use non-romantic Czech Kamarád");
});

test("the clothing review applies one contextual rule without deleting natural examples", async () => {
  const correctionDocument = JSON.parse(await fs.readFile(correctionsFile, "utf8"));
  assert.deepEqual(correctionDocument.review_scope, {
    corpus_rows_screened: 5000,
    effective_clothing_topic_rows_contextually_reviewed: 575,
    effective_clothing_handling_rows_contextually_reviewed: 160,
    context_free_clothing_contact_rows_corrected: 40,
  });
  assert.match(correctionDocument.clothing_context_rule.reject, /context-free touch/u);
  assert.match(correctionDocument.clothing_context_rule.accept, /ordinary wardrobe/u);

  const rows = await readJsonl(checkedInCuratedFile);
  const clothingObjects = /\b(?:boot|boots|coat|coats|dress|dresses|glove|gloves|hat|hats|jacket|jackets|pants|scarf|scarves|shirt|shirts|shoe|shoes|skirt|skirts|sock|socks)\b/iu;
  const bodyGarments = /\b(?:dress|dresses|pants|shirt|shirts|skirt|skirts)\b/iu;
  const detachedGarmentContext = /\b(?:folded|drawer|closet|hanger|picture|shelf|table)\b/iu;
  const ambiguousRows = rows.filter((row) => {
    const english = row.english_text;
    if (
      clothingObjects.test(english)
      && /\btouch(?:es|ed|ing)?\b/iu.test(english)
      && !detachedGarmentContext.test(english)
    ) return true;
    return bodyGarments.test(english)
      && /\b(?:hold|holds|holding|show|shows|showing)\b/iu.test(english)
      && !detachedGarmentContext.test(english);
  });
  assert.deepEqual(
    ambiguousRows.map((row) => `${row.id}: ${row.english_text}`),
    [],
  );

  const englishTexts = new Set(rows.map((row) => row.english_text));
  for (const acceptedContext of [
    "The sister wears a dress.",
    "A father washes the shirt.",
    "A mother chooses a shirt.",
    "Please hold the coat.",
    "Please show me the blue coat.",
    "A child carries the pants.",
  ]) {
    assert.equal(englishTexts.has(acceptedContext), true, acceptedContext);
  }
});

test("the vector database defaults to the corrected core-v0.2 curriculum", async () => {
  const vectorBuilder = await fs.readFile(vectorBuilderFile, "utf8");
  assert.match(vectorBuilder, /fromRoot\("data", "curriculum", "core-v0\.2"\)/u);
  assert.doesNotMatch(vectorBuilder, /fromRoot\("data", "curriculum", "core-v0\.1"\)/u);
});

async function readJsonl(file) {
  return (await fs.readFile(file, "utf8"))
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}
