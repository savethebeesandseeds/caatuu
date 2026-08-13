#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import {
  readJson,
  readJsonl,
  sha256,
  writeJson,
  writeJsonl,
} from "./word-world-standard-lib.mjs";
import { fromRoot } from "./paths.mjs";

const batchId = "codex-reflexive-0001";
const reviewedOn = "2026-08-10";
const datasetDir = fromRoot("data", "word-world", "standard-v0.1");
const candidateDir = path.join(datasetDir, "candidates");
const sourceDir = path.join(datasetDir, "source");
const candidateFile = path.join(candidateDir, `${batchId}.candidates.jsonl`);
const reviewFile = path.join(candidateDir, `${batchId}.focused-review.json`);
const outputFile = path.join(sourceDir, `${batchId}-reviewed.jsonl`);
const receiptFile = path.join(candidateDir, `${batchId}.promotion-receipt.json`);

const [candidateBytes, reviewBytes, candidates, review] = await Promise.all([
  fs.readFile(candidateFile),
  fs.readFile(reviewFile),
  readJsonl(candidateFile),
  readJson(reviewFile),
]);
const candidateSha256 = sha256(candidateBytes);
const reviewSha256 = sha256(reviewBytes);

assertEqual(review.batchId, batchId, "review batch ID");
assertEqual(review.independent, false, "honest review independence");
assertEqual(review.humanApproved, false, "human approval");
assertEqual(review.inputs.candidateSha256, candidateSha256, "reviewed candidate hash");
assertEqual(candidates.length, 32, "candidate record count");
assertEqual(review.rows.length, candidates.length, "review row count");

for (const [index, row] of review.rows.entries()) {
  assertEqual(row.id, candidates[index].id, `review order at row ${index + 1}`);
  assertEqual(row.verdict, "pass", `review verdict for ${row.id}`);
}

const promoted = candidates.map(promoteRecord);
await writeJsonl(outputFile, promoted);
const outputBytes = await fs.readFile(outputFile);
const outputSha256 = sha256(outputBytes);

await writeJson(receiptFile, {
  schemaVersion: "caatuu-word-world-promotion-receipt-v1",
  batchId,
  promotedOn: reviewedOn,
  humanApproved: false,
  decision: review.decision,
  inputs: {
    candidateFile: path.basename(candidateFile),
    candidateSha256,
    candidateBytes: candidateBytes.length,
    focusedReviewFile: path.basename(reviewFile),
    focusedReviewSha256: reviewSha256,
    focusedReviewBytes: reviewBytes.length,
    baselineRuntimeContentSha256: review.inputs.baselineRuntimeContentSha256,
  },
  review: {
    reviewer: review.reviewer,
    reviewDate: review.reviewDate,
    independent: false,
    humanApproved: false,
    checks: review.checks,
    productionGate: "Independent qualified Czech review remains required before production linguistic approval.",
  },
  licensingDecision: {
    sourceName: "Caatuu Word World se-family expansion",
    sourceType: "codex_authored",
    sourceLicense: "MIT",
    projectOwnedOriginalAuthoring: true,
    externalCorpusTextUsed: false,
  },
  selection: {
    candidateRecords: candidates.length,
    promotedRecords: promoted.length,
    heldRecords: 0,
    promotedByDifficulty: { "2": promoted.length },
    promotedIds: promoted.map((record) => record.id),
    heldIds: [],
  },
  output: {
    sourceFile: `../source/${path.basename(outputFile)}`,
    sourceSha256: outputSha256,
    sourceBytes: outputBytes.length,
    recordCount: promoted.length,
    reviewStatus: "codex_reviewed",
    humanApproved: false,
  },
  immutableInputPolicy: "The candidate JSONL and focused-review JSON are evidence inputs and must not be rewritten by promotion.",
});

console.log(JSON.stringify({ batchId, promoted: promoted.length, outputFile, outputSha256, receiptFile }, null, 2));

function promoteRecord(record) {
  return {
    ...record,
    provenance: {
      ...record.provenance,
      sourceLicense: "MIT",
      transformation: "Original project-owned bilingual authoring for Caatuu; no external corpus text was used. The unchanged candidate text, difficulty, targets, and family metadata passed a focused Codex bilingual and pedagogical review before development-corpus promotion.",
    },
    review: {
      status: "codex_reviewed",
      reviewer: "OpenAI Codex focused bilingual review in the authoring task",
      reviewedOn,
      humanApproved: false,
      checks: [
        "Czech naturalness review",
        "English naturalness review",
        "bilingual meaning-equivalence review",
        "intentional minimal-contrast family review",
        "Level 2 difficulty review",
        "target surface and token-index review",
        "canonical exact-duplicate review",
        "grammar, topic, scene, and child-safety review",
      ],
      notes: [
        "The four related sentences per verb are intentional placement contrasts, not accidental semantic duplicates.",
        "This Codex review occurred in the authoring task and is not independent or human approval.",
        "Independent qualified Czech review remains required before production linguistic approval.",
      ],
    },
  };
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label}: expected ${expected}, got ${actual}`);
}
