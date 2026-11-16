import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { standardCorpusRuntimeRecords } from "../record-projection/standard-corpus.mjs";

const rubric = JSON.parse(await readFile(new URL(
  "../../czech-ml/data/word-world/standard-v0.1/rubric.json", import.meta.url), "utf8"));
// Exercise real per-record validation without requiring a production-sized fixture.
const smallRubric = { ...rubric, distribution: {
  minimumRecords: 2, minimumLevel2Share: 0, minimumLevel3Records: 0
} };

function record(id, englishText, targetText, gloss, usefulness, complexity) {
  const surface = targetText.replace(/\.$/u, "");
  return {
    id, englishText, targetText, embeddingText: englishText, englishAlternates: [],
    difficulty: 1, usefulness, complexity, topic: "conversation", pronunciation: null,
    tokens: [{ surface, normalized: surface.toLowerCase(), tokenIndex: 0, playable: true, gloss }],
    sceneQuery: englishText, sceneAssetIds: [],
    annotations: {
      cefr: "A1",
      learning: {
        objective: "Use a polite everyday formula.", skillFocus: ["short formula"], ageBand: "6-8",
        progression: { level: 1, rationale: "A short formula.", prerequisites: [] },
        support: { translationAvailable: true, imageSuitable: false, audioSuitable: true, dictionarySuitable: true }
      },
      grammar: { tags: ["short_formula"], sentenceType: "formula", clauseCount: 1 },
      provenance: { sourceName: "projection-test", sourceIds: [id], sourceLicense: "AGPL-3.0-only",
        sourceType: "authored", transformation: "Synthetic projection fixture." },
      review: { status: "codex_reviewed", reviewer: "Test fixture", reviewedOn: "2026-11-13",
        humanApproved: false, checks: ["synthetic fixture"], notes: [] }
    }
  };
}

test("mixed standard records keep each playable record's grades and contextual hints", () => {
  const first = record("ww-fixture-hello", "Hello.", "Ahoj.", "hello", 91, 12);
  const second = record("ww-fixture-thanks", "Thank you.", "Děkuji.", "thank you", 83, 28);
  const untranslated = { id: "cz.word-net.000001", reviewStatus: "untranslated",
    targetText: "", tokens: [], usefulness: 1, complexity: 99 };
  const document = { records: [untranslated, first, { ...untranslated, id: "cz.word-net.000002" }, second] };
  const before = structuredClone(document);
  const { runtime } = standardCorpusRuntimeRecords(document, smallRubric);
  assert.deepEqual(runtime.map(item => ({ id: item.id, usefulness: item.usefulness,
    complexity: item.complexity, gloss: item.targets[0].gloss })), [
    { id: first.id, usefulness: 91, complexity: 12, gloss: "hello" },
    { id: second.id, usefulness: 83, complexity: 28, gloss: "thank you" }
  ]);
  assert.deepEqual(document, before, "projection must not mutate the authoring records");
});

test("null hints stay absent and wholly untranslated sources emit no records", () => {
  const first = record("ww-fixture-hello", "Hello.", "Ahoj.", null, 91, 12);
  const second = record("ww-fixture-thanks", "Thank you.", "Děkuji.", "thank you", 83, 28);
  const { runtime } = standardCorpusRuntimeRecords({ records: [first, second] }, smallRubric);
  assert.equal(Object.hasOwn(runtime[0].targets[0], "gloss"), false);
  assert.deepEqual(standardCorpusRuntimeRecords({ records: [{ reviewStatus: "untranslated" }] }, rubric).runtime, []);
});
