import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { inspectLearnerFields } from "../scripts/learner-content-safety-lib.mjs";
import {
  applyEditorialOverrides,
  findJsonlFiles,
  readJson,
  readJsonl,
} from "../scripts/word-world-standard-lib.mjs";

const mlRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const importScript = path.join(mlRoot, "scripts", "import-word-world-common-phrases.mjs");
const datasetDir = path.join(mlRoot, "data", "word-world", "standard-v0.1");
const rubricFile = path.join(datasetDir, "rubric.json");
const candidateDir = path.join(datasetDir, "candidates");
const sourceDir = path.join(datasetDir, "source");
const promotionScripts = [
  "promote-word-world-reviewed-expansion.mjs",
  "promote-word-world-reviewed-level3.mjs",
  "promote-word-world-reviewed-reflexive.mjs",
];

test("common-phrase import requires explicit child-safe approval before writing", async (t) => {
  const result = await runFixtureImport(t, {
    ...safeSourceRow(),
    child_safe: false,
  });

  assert.equal(result.run.status, 1);
  assert.match(result.run.stderr, /source-child-safe-approval-required/u);
  assert.match(result.run.stderr, /child_safe must be explicitly true/u);
  await assert.rejects(fs.access(result.outputFile));
});

test("common-phrase import scans both languages and stops review findings before writing", async (t) => {
  const result = await runFixtureImport(t, {
    ...safeSourceRow(),
    english_text: "I have two balls.",
    czech_text: "Mám dva míče.",
  });

  assert.equal(result.run.status, 1);
  assert.match(result.run.stderr, /review\.ambiguous-first-person-balls/u);
  assert.match(result.run.stderr, /\/english_text/u);
  assert.match(result.run.stderr, /\/czech_text/u);
  await assert.rejects(fs.access(result.outputFile));
});

test("common-phrase import still accepts explicitly approved content with no deterministic finding", async (t) => {
  const result = await runFixtureImport(t, safeSourceRow());

  assert.equal(result.run.status, 0, result.run.stderr);
  const rows = await readJsonl(result.outputFile);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].languages.en.text, "I play football.");
  assert.equal(rows[0].languages.cs.text, "Hraji fotbal.");
});

test("every Word World promotion scans all learner-facing authoring fields before its first write", async () => {
  for (const scriptName of promotionScripts) {
    const source = await fs.readFile(path.join(mlRoot, "scripts", scriptName), "utf8");
    const gateIndex = source.indexOf("assertPromotedLearnerContentSafe(");
    const writeIndex = source.indexOf("await writeJsonl(");
    assert.ok(gateIndex >= 0, `${scriptName}: missing promotion safety gate`);
    assert.ok(writeIndex >= 0, `${scriptName}: missing output write`);
    assert.ok(gateIndex < writeIndex, `${scriptName}: safety gate must run before output write`);
    assert.match(source, /inspectLearnerFields\(fields\)/u, `${scriptName}: shared scanner`);
    for (const field of [
      "/languages/en/text",
      "/languages/en/alternates/",
      "/languages/cs/text",
      "/scene/query",
    ]) {
      assert.ok(source.includes(field), `${scriptName}: missing ${field}`);
    }
  }
});

test("historical expansion remains evidence while its effective promotion is safe and reproducible", async () => {
  const candidateFile = path.join(candidateDir, "codex-expansion-0001.candidates.jsonl");
  const reviewFile = path.join(candidateDir, "codex-expansion-0001.blind-review.json");
  const [records, review] = await Promise.all([readJsonl(candidateFile), readJson(reviewFile)]);
  const passingIds = new Set(review.rows.filter((row) => row.verdict === "pass").map((row) => row.id));
  const promoted = records.filter((record) => passingIds.has(record.id));
  const findings = inspectLearnerFields(promoted.flatMap((record) => authoringFields(record, candidateFile)));
  const findingsById = new Map();
  for (const finding of findings) {
    if (!findingsById.has(finding.contentId)) findingsById.set(finding.contentId, []);
    findingsById.get(finding.contentId).push(finding);
  }

  assert.ok(findingsById.has("ww-codex-exp-0001-0093"), "historical surname prompt must block re-promotion");
  assert.ok(findingsById.has("ww-codex-exp-0001-0101"), "historical ambiguous balls phrase must block re-promotion");
  assert.ok(findings.every((finding) => finding.severity === "block" || finding.severity === "review"));

  const [editorialOverrides, sourceFiles, promotionSource] = await Promise.all([
    readJson(path.join(datasetDir, "editorial-overrides.json")),
    findJsonlFiles(sourceDir),
    fs.readFile(path.join(mlRoot, "scripts", "promote-word-world-reviewed-expansion.mjs"), "utf8"),
  ]);
  const sourceRecords = (await Promise.all(sourceFiles.map(readJsonl))).flat();
  const effective = applyEditorialOverrides(sourceRecords, editorialOverrides);
  const effectivePromoted = effective.filter((record) => passingIds.has(record.id));
  const effectiveFindings = inspectLearnerFields(
    effectivePromoted.flatMap((record) => authoringFields(record, "word-world-effective-promotion")),
  );

  assert.equal(effectivePromoted.length, promoted.length);
  assert.deepEqual(effectiveFindings, []);
  assert.match(promotionSource, /assertPromotedLearnerContentSafe\(effectivePromotedRows\)/u);
  assert.match(promotionSource, /await writeJsonl\(outputFile, promotedRows\)/u);
});

test("approved Level 3 and reflexive promotion inputs pass the deterministic gate", async () => {
  const batches = [
    {
      candidate: "codex-level3-0001.candidates.jsonl",
      review: "codex-level3-0001.blind-review.json",
      selected: (row) => row.verdict === "pass" && row.safeToPromote === true,
    },
    {
      candidate: "codex-reflexive-0001.candidates.jsonl",
      review: "codex-reflexive-0001.focused-review.json",
      selected: (row) => row.verdict === "pass",
    },
  ];

  for (const batch of batches) {
    const candidateFile = path.join(candidateDir, batch.candidate);
    const [records, review] = await Promise.all([
      readJsonl(candidateFile),
      readJson(path.join(candidateDir, batch.review)),
    ]);
    const selectedIds = new Set(review.rows.filter(batch.selected).map((row) => row.id));
    const promoted = records.filter((record) => selectedIds.has(record.id));
    const findings = inspectLearnerFields(promoted.flatMap((record) => authoringFields(record, candidateFile)));
    assert.deepEqual(findings, [], `${batch.candidate}: ${JSON.stringify(findings, null, 2)}`);
  }
});

async function runFixtureImport(t, row) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "caatuu-word-world-safety-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const sourceFile = path.join(directory, "source.jsonl");
  const manifestFile = path.join(directory, "manifest.jsonl");
  const policyFile = path.join(directory, "policy.json");
  const outputFile = path.join(directory, "output.jsonl");
  const rejectionFile = path.join(directory, "rejections.jsonl");
  const importReportFile = path.join(directory, "import-report.json");
  const blindReviewReportFile = path.join(directory, "blind-review.json");

  await fs.writeFile(sourceFile, `${JSON.stringify(row)}\n`, "utf8");
  await fs.writeFile(manifestFile, `${JSON.stringify({
    id: "fixture-common-phrases",
    license: "MIT",
    source_type: "test_fixture",
  })}\n`, "utf8");
  await fs.writeFile(policyFile, `${JSON.stringify({
    schemaVersion: "caatuu-word-world-import-policy-v1",
    reviewedOn: "2026-08-13",
    sourceDataset: sourceFile,
    sourceManifest: manifestFile,
    excludedSourceRows: [],
    sourceRowOverrides: [],
    nonPlayableCzechTokens: [],
    blindReview: {
      date: "2026-08-13",
      reviewerRole: "test fixture",
      method: "deterministic safety-gate fixture",
      passes: [],
    },
  }, null, 2)}\n`, "utf8");

  const run = spawnSync(process.execPath, [
    importScript,
    "--policy", policyFile,
    "--rubric", rubricFile,
    "--output", outputFile,
    "--rejections", rejectionFile,
    "--report", importReportFile,
    "--blind-review-report", blindReviewReportFile,
  ], { encoding: "utf8" });
  if (run.error) throw run.error;
  return { run, outputFile };
}

function safeSourceRow() {
  return {
    id: "cc-990001",
    english_text: "I play football.",
    czech_text: "Hraji fotbal.",
    difficulty: 1,
    cefr: "Pre-A1/A1",
    age_band: "6-8",
    topic: "sports",
    target_words: ["play", "football"],
    grammar_tags: ["common_phrase", "present"],
    child_safe: true,
    concrete: true,
  };
}

function authoringFields(record, file) {
  return [
    { file, contentId: record.id, field: "/languages/en/text", locale: "en", text: record.languages.en.text },
    ...record.languages.en.alternates.map((text, index) => ({
      file,
      contentId: record.id,
      field: `/languages/en/alternates/${index}`,
      locale: "en",
      text,
    })),
    { file, contentId: record.id, field: "/languages/cs/text", locale: "cs", text: record.languages.cs.text },
    { file, contentId: record.id, field: "/scene/query", locale: "en", text: record.scene.query },
  ];
}
