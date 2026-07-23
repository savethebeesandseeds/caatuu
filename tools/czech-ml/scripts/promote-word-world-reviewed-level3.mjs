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

const batchId = "codex-level3-0001";
const reviewedOn = "2026-07-22";
const datasetDir = fromRoot("data", "word-world", "standard-v0.1");
const candidateDir = path.join(datasetDir, "candidates");
const sourceDir = path.join(datasetDir, "source");
const candidateFile = path.join(candidateDir, `${batchId}.candidates.jsonl`);
const reviewFile = path.join(candidateDir, `${batchId}.blind-review.json`);
const canonicalFile = path.join(sourceDir, "common-phrases-pilot.jsonl");
const comparisonBatchFile = path.join(candidateDir, "codex-expansion-0001.candidates.jsonl");
const reviewedExpansionFile = path.join(sourceDir, "codex-expansion-0001-reviewed.jsonl");
const outputFile = path.join(sourceDir, `${batchId}-reviewed.jsonl`);
const receiptFile = path.join(candidateDir, `${batchId}.promotion-receipt.json`);

const [
  candidateBytes,
  reviewBytes,
  canonicalBytes,
  comparisonBatchBytes,
  reviewedExpansionBytes,
  audit,
  candidateRows,
] = await Promise.all([
  fs.readFile(candidateFile),
  fs.readFile(reviewFile),
  fs.readFile(canonicalFile),
  fs.readFile(comparisonBatchFile),
  fs.readFile(reviewedExpansionFile),
  readJson(reviewFile),
  readJsonl(candidateFile),
]);
const candidateSha256 = sha256(candidateBytes);
const reviewSha256 = sha256(reviewBytes);
const canonicalSha256 = sha256(canonicalBytes);
const comparisonBatchSha256 = sha256(comparisonBatchBytes);
const reviewedExpansionSha256 = sha256(reviewedExpansionBytes);

assertEqual(audit.batchId, batchId, "blind review batch ID");
assertEqual(candidateSha256, audit.inputs.candidateSha256, "candidate hash recorded by blind review");
assertEqual(canonicalSha256, audit.inputs.canonicalSha256, "canonical hash recorded by blind review");
assertEqual(comparisonBatchSha256, audit.inputs.comparisonBatchSha256, "comparison batch hash recorded by blind review");
assertEqual(candidateRows.length, 80, "candidate record count");
assertEqual(audit.rows.length, candidateRows.length, "blind-review row count");

const decisionById = new Map();
for (const [index, reviewed] of audit.rows.entries()) {
  const candidate = candidateRows[index];
  assertEqual(reviewed.lineNumber, index + 1, `blind-review line number for ${candidate.id}`);
  assertEqual(reviewed.id, candidate.id, `blind-review ID at line ${index + 1}`);
  if (reviewed.verdict === "pass" && reviewed.safeToPromote === true) {
    decisionById.set(reviewed.id, "promote");
  } else if (reviewed.verdict === "fail" && reviewed.safeToPromote === false) {
    decisionById.set(reviewed.id, "hold");
  } else {
    throw new Error(`Inconsistent verdict/safeToPromote decision for ${reviewed.id}`);
  }
}

const promotedRows = candidateRows
  .filter((record) => decisionById.get(record.id) === "promote")
  .map(promoteRecord);
const promotedIds = promotedRows.map((record) => record.id);
const heldIds = candidateRows
  .filter((record) => decisionById.get(record.id) === "hold")
  .map((record) => record.id);

assertEqual(promotedRows.length, 52, "promoted record count");
assertEqual(heldIds.length, 28, "held record count");
assertJsonEqual(promotedIds, audit.aggregates.passRowIds, "promoted IDs and audited pass IDs");
assertJsonEqual(heldIds, audit.aggregates.failedRowIds, "held IDs and audited failed IDs");
assertEqual(promotedRows.filter((record) => record.difficulty === 3).length, 52, "promoted Level 3 count");

await writeJsonl(outputFile, promotedRows);
const outputBytes = await fs.readFile(outputFile);
const outputSha256 = sha256(outputBytes);
const receipt = {
  schemaVersion: "caatuu-word-world-promotion-receipt-v1",
  batchId,
  promotedOn: reviewedOn,
  humanApproved: false,
  decision: "Promote only independently reviewed Level 3 rows with verdict pass and safeToPromote true; hold every failed row outside canonical source without repair.",
  inputs: {
    candidateFile: path.basename(candidateFile),
    candidateSha256,
    candidateBytes: candidateBytes.length,
    blindReviewFile: path.basename(reviewFile),
    blindReviewSha256: reviewSha256,
    blindReviewBytes: reviewBytes.length,
    canonicalReferenceFile: "../source/common-phrases-pilot.jsonl",
    canonicalReferenceSha256: canonicalSha256,
    canonicalReferenceBytes: canonicalBytes.length,
    comparisonBatchFile: path.basename(comparisonBatchFile),
    comparisonBatchSha256,
    comparisonBatchBytes: comparisonBatchBytes.length,
    reviewedExpansionSourceFile: `../source/${path.basename(reviewedExpansionFile)}`,
    reviewedExpansionSourceSha256: reviewedExpansionSha256,
    reviewedExpansionSourceBytes: reviewedExpansionBytes.length,
  },
  independentReview: {
    reviewer: audit.reviewer,
    reviewerRole: "Independent adversarial Czech-English Level 3 and pedagogy reviewer; separate from the candidate author.",
    reviewDate: audit.reviewDate,
    candidateAuthoringReportUsedAsEvidence: audit.inputs.authoringReportUsedAsEvidence,
    checks: [
      "Czech naturalness and supported gender",
      "English naturalness",
      "bilingual meaning equivalence",
      "genuine Level 3 difficulty, CEFR, syntax, and clause relationships",
      "target surface, normalization, token position, and learning usefulness",
      "canonical, expansion-batch, and within-batch exact and semantic duplication",
      "grammar, clause, topic, context, and scene metadata",
      "safety for ages 6 to 10",
    ],
  },
  licensingDecision: {
    sourceName: "Caatuu Word World Codex Level 3 expansion",
    sourceType: "codex_authored",
    sourceLicense: "MIT",
    projectOwnedOriginalAuthoring: true,
    externalCorpusTextUsed: false,
    authority: "The project owner confirmed that this Caatuu-authored Level 3 batch is project-owned original text and is released under the same explicit MIT corpus source license as the Caatuu common-phrase bank.",
  },
  selection: {
    candidateRecords: candidateRows.length,
    promotedRecords: promotedRows.length,
    heldRecords: heldIds.length,
    promotedByDifficulty: { "3": promotedRows.length },
    heldByDifficulty: { "3": heldIds.length },
    promotedIds,
    heldIds,
  },
  output: {
    sourceFile: `../source/${path.basename(outputFile)}`,
    sourceSha256: outputSha256,
    sourceBytes: outputBytes.length,
    recordCount: promotedRows.length,
    reviewStatus: "codex_reviewed",
    humanApproved: false,
  },
  immutableInputPolicy: "The candidate JSONL and independent blind-review JSON are evidence inputs and must not be rewritten by promotion.",
};
await writeJson(receiptFile, receipt);

console.log(JSON.stringify({
  candidateSha256,
  reviewSha256,
  canonicalSha256,
  comparisonBatchSha256,
  reviewedExpansionSha256,
  outputFile,
  outputSha256,
  receiptFile,
  promoted: promotedRows.length,
  held: heldIds.length,
  promotedByDifficulty: receipt.selection.promotedByDifficulty,
}, null, 2));

function promoteRecord(record) {
  return {
    ...record,
    provenance: {
      ...record.provenance,
      sourceLicense: "MIT",
      transformation: "Original project-owned bilingual Level 3 authoring for Caatuu; no external corpus text was used. Guided-learning metadata and exact target positions were authored with Codex assistance. The unchanged candidate text, difficulty, and targets then passed a separate independent adversarial Codex bilingual, Level 3 pedagogy, duplicate, metadata, gender, and child-safety review before promotion.",
    },
    review: {
      status: "codex_reviewed",
      reviewer: "Independent OpenAI Codex adversarial bilingual Level 3 review (separate from candidate author)",
      reviewedOn,
      humanApproved: false,
      checks: [
        "independent Czech naturalness and supported-gender review",
        "independent English naturalness review",
        "independent bilingual meaning-equivalence review",
        "independent Level 3 difficulty, CEFR, syntax, and clause review",
        "independent target surface and token-index review",
        "independent canonical, expansion-batch, and within-batch duplicate review",
        "independent grammar, context, topic, and scene metadata review",
        "independent child-safety review for ages 6 to 10",
      ],
      notes: [
        "Promoted only after this row received verdict pass with safeToPromote true; candidate text, difficulty, targets, and learning metadata were not modified during promotion.",
        "Project-owned original bilingual authoring; no external corpus text used; released under the MIT corpus source license.",
        "Codex-reviewed only; no native-speaker or other human approval is claimed.",
      ],
    },
  };
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label}: expected ${expected}, got ${actual}`);
}

function assertJsonEqual(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: values differ`);
  }
}
