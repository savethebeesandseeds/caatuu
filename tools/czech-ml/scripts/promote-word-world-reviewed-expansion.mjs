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

const batchId = "codex-expansion-0001";
const reviewedOn = "2026-07-22";
const datasetDir = fromRoot("data", "word-world", "standard-v0.1");
const candidateDir = path.join(datasetDir, "candidates");
const sourceDir = path.join(datasetDir, "source");
const candidateFile = path.join(candidateDir, `${batchId}.candidates.jsonl`);
const reviewFile = path.join(candidateDir, `${batchId}.blind-review.json`);
const canonicalFile = path.join(sourceDir, "common-phrases-pilot.jsonl");
const outputFile = path.join(sourceDir, `${batchId}-reviewed.jsonl`);
const receiptFile = path.join(candidateDir, `${batchId}.promotion-receipt.json`);

const [candidateBytes, reviewBytes, canonicalBytes, audit, candidateRows] = await Promise.all([
  fs.readFile(candidateFile),
  fs.readFile(reviewFile),
  fs.readFile(canonicalFile),
  readJson(reviewFile),
  readJsonl(candidateFile),
]);
const candidateSha256 = sha256(candidateBytes);
const reviewSha256 = sha256(reviewBytes);
const canonicalSha256 = sha256(canonicalBytes);

assertEqual(audit.batchId, batchId, "blind review batch ID");
assertEqual(candidateSha256, audit.inputs.candidateSha256, "candidate hash recorded by blind review");
assertEqual(canonicalSha256, audit.inputs.canonicalSha256, "canonical hash recorded by blind review");
assertEqual(candidateRows.length, 250, "candidate record count");
assertEqual(audit.rows.length, candidateRows.length, "blind-review row count");

const verdictById = new Map();
for (const [index, reviewed] of audit.rows.entries()) {
  const candidate = candidateRows[index];
  assertEqual(reviewed.lineNumber, index + 1, `blind-review line number for ${candidate.id}`);
  assertEqual(reviewed.id, candidate.id, `blind-review ID at line ${index + 1}`);
  if (reviewed.verdict !== "pass" && reviewed.verdict !== "fail") {
    throw new Error(`Unsupported verdict ${reviewed.verdict} for ${reviewed.id}`);
  }
  if (verdictById.has(reviewed.id)) throw new Error(`Duplicate reviewed ID ${reviewed.id}`);
  verdictById.set(reviewed.id, reviewed.verdict);
}

const promotedRows = candidateRows
  .filter((record) => verdictById.get(record.id) === "pass")
  .map(promoteRecord);
const promotedIds = promotedRows.map((record) => record.id);
const heldIds = candidateRows
  .filter((record) => verdictById.get(record.id) === "fail")
  .map((record) => record.id);

assertEqual(promotedRows.length, 219, "promoted record count");
assertEqual(heldIds.length, 31, "held record count");
assertJsonEqual(heldIds, audit.aggregates.failedRowIds, "held IDs and audited failed IDs");
assertEqual(promotedRows.filter((record) => record.difficulty === 1).length, 49, "promoted Level 1 count");
assertEqual(promotedRows.filter((record) => record.difficulty === 2).length, 170, "promoted Level 2 count");

await writeJsonl(outputFile, promotedRows);
const outputBytes = await fs.readFile(outputFile);
const outputSha256 = sha256(outputBytes);
const receipt = {
  schemaVersion: "caatuu-word-world-promotion-receipt-v1",
  batchId,
  promotedOn: reviewedOn,
  humanApproved: false,
  decision: "Promote only rows with an independent blind-review verdict of pass; hold every failed row outside canonical source.",
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
  },
  independentReview: {
    reviewer: audit.reviewer,
    reviewerRole: "Independent bilingual and learning-difficulty reviewer; separate from the candidate author.",
    reviewDate: audit.reviewDate,
    candidateAuthoringReportUsedAsEvidence: audit.inputs.authoringReportUsedAsEvidence,
    checks: [
      "Czech naturalness",
      "English naturalness",
      "bilingual meaning equivalence",
      "Level 1 and Level 2 difficulty and CEFR",
      "target surface, normalization, token position, and learning usefulness",
      "canonical and within-batch exact and semantic duplication",
      "grammar, clause, topic, and scene metadata",
      "safety for ages 6 to 10",
    ],
  },
  licensingDecision: {
    sourceName: "Caatuu Word World Codex expansion",
    sourceType: "codex_authored",
    sourceLicense: "MIT",
    projectOwnedOriginalAuthoring: true,
    externalCorpusTextUsed: false,
    authority: "The project owner confirmed that this Caatuu-authored batch is project-owned original text and is released under the same explicit MIT corpus source license as the Caatuu common-phrase bank.",
  },
  selection: {
    candidateRecords: candidateRows.length,
    promotedRecords: promotedRows.length,
    heldRecords: heldIds.length,
    promotedByDifficulty: countByDifficulty(promotedRows),
    heldByDifficulty: countByDifficulty(candidateRows.filter((record) => heldIds.includes(record.id))),
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
      transformation: "Original project-owned bilingual authoring for Caatuu; no external corpus text was used. Guided-learning metadata and exact target positions were authored with Codex assistance. The unchanged candidate text, difficulty, and targets then passed a separate independent Codex bilingual, difficulty, duplicate, metadata, and child-safety review before promotion.",
    },
    review: {
      status: "codex_reviewed",
      reviewer: "Independent OpenAI Codex bilingual review (separate from candidate author)",
      reviewedOn,
      humanApproved: false,
      checks: [
        "independent Czech naturalness review",
        "independent English naturalness review",
        "independent bilingual meaning-equivalence review",
        "independent Level 1 and Level 2 difficulty review",
        "independent target surface and token-index review",
        "independent canonical and within-batch duplicate review",
        "independent grammar, clause, topic, and scene metadata review",
        "independent child-safety review for ages 6 to 10",
      ],
      notes: [
        "Promoted only after this row received an independent pass; candidate text, difficulty, targets, and learning metadata were not modified during promotion.",
        "Project-owned original bilingual authoring; no external corpus text used; released under the MIT corpus source license.",
        "Codex-reviewed only; no native-speaker or other human approval is claimed.",
      ],
    },
  };
}

function countByDifficulty(records) {
  const counts = {};
  for (const record of records) counts[String(record.difficulty)] = (counts[String(record.difficulty)] || 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label}: expected ${expected}, got ${actual}`);
}

function assertJsonEqual(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: values differ`);
  }
}
