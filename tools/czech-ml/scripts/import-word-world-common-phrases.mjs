#!/usr/bin/env node
import path from "node:path";
import {
  normalizeText,
  normalizeSentence,
  readJson,
  readJsonl,
  tokenize,
  writeJson,
  writeJsonl,
} from "./word-world-standard-lib.mjs";
import { caatuuRoot, fromRoot } from "./paths.mjs";

const datasetDir = fromRoot("data", "word-world", "standard-v0.1");
const policyFile = path.resolve(argValue("--policy", path.join(datasetDir, "import-policy.json")));
const rubricFile = path.resolve(argValue("--rubric", path.join(datasetDir, "rubric.json")));
const outputFile = path.resolve(argValue("--output", path.join(datasetDir, "source", "common-phrases-pilot.jsonl")));
const rejectionFile = path.resolve(argValue("--rejections", path.join(datasetDir, "reports", "common-phrases-rejections.jsonl")));
const importReportFile = path.resolve(argValue("--report", path.join(datasetDir, "reports", "common-phrases-import.json")));
const blindReviewReportFile = path.resolve(argValue("--blind-review-report", path.join(datasetDir, "reports", "blind-review-2026-07-21.json")));

const policy = await readJson(policyFile);
const rubric = await readJson(rubricFile);
const sourceFile = path.resolve(caatuuRoot, policy.sourceDataset);
const sourceManifestFile = path.resolve(caatuuRoot, policy.sourceManifest);
const sourceRows = await readJsonl(sourceFile);
const [sourceManifest] = await readJsonl(sourceManifestFile);
const excluded = new Map(policy.excludedSourceRows.map((entry) => [entry.id, entry]));
const overrides = new Map(policy.sourceRowOverrides.map((entry) => [entry.id, entry]));
if (excluded.size !== policy.excludedSourceRows.length) throw new Error("Duplicate excludedSourceRows IDs in import policy");
if (overrides.size !== policy.sourceRowOverrides.length) throw new Error("Duplicate sourceRowOverrides IDs in import policy");
const nonPlayable = new Set(policy.nonPlayableCzechTokens.map(normalizeText));
const rejections = [];
const accepted = [];
const appliedOverrides = [];

for (const sourceRow of sourceRows) {
  const exclusion = excluded.get(sourceRow.id);
  if (exclusion) {
    rejections.push(rejection(sourceRow, exclusion.reviewStage || "initial_codex_review", exclusion.reason));
    continue;
  }
  const override = overrides.get(sourceRow.id);
  const row = applyOverride(sourceRow, override);
  if (override) appliedOverrides.push({ sourceRow, row, override });
  if (!String(row.english_text || "").trim() || !String(row.czech_text || "").trim()) {
    rejections.push(rejection(row, "missing_bilingual_text", "Both English and Czech text are required."));
    continue;
  }
  accepted.push(row);
}

const missingOverrides = [...overrides.keys()].filter((id) => !appliedOverrides.some((entry) => entry.override.id === id));
if (missingOverrides.length) throw new Error(`Blind-review override IDs were not found in source: ${missingOverrides.join(", ")}`);

const grouped = new Map();
for (const row of accepted) {
  const key = normalizeSentence(row.czech_text);
  if (!grouped.has(key)) grouped.set(key, []);
  grouped.get(key).push(row);
}

const records = [...grouped.values()]
  .map((rows) => buildRecord(rows.sort((left, right) => left.id.localeCompare(right.id))))
  .sort((left, right) => left.id.localeCompare(right.id));

await writeJsonl(outputFile, records);
await writeJsonl(rejectionFile, rejections);
await writeJson(blindReviewReportFile, blindReviewReport(appliedOverrides));
await writeJson(importReportFile, {
  schemaVersion: "caatuu-word-world-import-report-v1",
  sourceDataset: path.relative(caatuuRoot, sourceFile).replaceAll("\\", "/"),
  sourceRows: sourceRows.length,
  importedRecords: records.length,
  rejectedRows: rejections.length,
  mergedRows: accepted.length - records.length,
  mergedGroups: records
    .filter((record) => record.provenance.sourceIds.length > 1)
    .map((record) => ({
      recordId: record.id,
      cs: record.languages.cs.text,
      sourceIds: record.provenance.sourceIds,
      en: record.languages.en.text,
      enAlternates: record.languages.en.alternates,
    })),
  difficultyDistribution: countBy(records, (record) => String(record.difficulty)),
  reviewStatus: countBy(records, (record) => record.review.status),
  blindReview: {
    report: path.relative(caatuuRoot, blindReviewReportFile).replaceAll("\\", "/"),
    findingsResolved: appliedOverrides.length,
    reviewerRole: policy.blindReview.reviewerRole,
    humanApproved: false,
  },
  warning: "Codex review is not human approval. The pilot remains a seed for native-speaker review and corpus expansion.",
});

console.log(JSON.stringify({
  outputFile,
  records: records.length,
  rejected: rejections.length,
  merged: accepted.length - records.length,
}, null, 2));

function buildRecord(rows) {
  const primary = rows[0];
  const sourceNumber = primary.id.replace(/^cc-/, "");
  const difficulty = Math.max(...rows.map((row) => Number(row.difficulty)));
  const level = rubric.levels[String(difficulty)];
  const grammarTags = unique(rows.flatMap((row) => row.grammar_tags || []));
  const targets = tokenize(primary.czech_text).map((token) => ({
    ...token,
    playable: isPlayable(token, nonPlayable),
  }));
  const functionTag = grammarTags.find((tag) => tag.startsWith("function_"));
  const skillFocus = grammarTags
    .filter((tag) => !tag.startsWith("function_") && !tag.startsWith("category_") && tag !== "common_phrase")
    .map((tag) => tag.replaceAll("_", " "));
  const notes = [];
  if (rows.length > 1) notes.push(`Merged ${rows.length} source rows with the same Czech sentence; alternate English meanings are preserved.`);
  if (rows.some((row) => row.concrete !== true)) notes.push("Image support is optional because the phrase is not reliably concrete.");
  for (const row of rows.filter((entry) => entry._blindReview)) {
    const origins = reviewOrigins(row._blindReview).join(", ");
    notes.push(`Independent Codex review resolution for ${row.id} (${origins}): ${row._blindReview.resolution}`);
  }

  return {
    schemaVersion: "caatuu-word-world-record-v1",
    id: `ww-cp-${sourceNumber}`,
    languages: {
      en: {
        text: primary.english_text,
        alternates: unique(rows.slice(1).map((row) => row.english_text)),
      },
      cs: { text: primary.czech_text },
    },
    difficulty,
    cefr: rows.find((row) => Number(row.difficulty) === difficulty)?.cefr || primary.cefr,
    topic: primary.topic,
    targets,
    learning: {
      objective: functionTag ? functionTag.replace(/^function_/, "").replaceAll("_", " ") : "use an everyday expression",
      skillFocus: unique(skillFocus.length ? skillFocus : ["everyday expression"]),
      ageBand: primary.age_band,
      progression: {
        level: difficulty,
        rationale: level.description,
        prerequisites: [...level.prerequisites],
      },
      support: {
        translationAvailable: true,
        imageSuitable: rows.every((row) => row.concrete === true),
        audioSuitable: true,
        dictionarySuitable: targets.some((target) => target.playable),
      },
    },
    grammar: {
      tags: grammarTags,
      sentenceType: sentenceType(primary, grammarTags),
      clauseCount: clauseCount(primary.czech_text),
    },
    scene: {
      query: primary.english_text,
      assetIds: [],
    },
    provenance: {
      sourceName: sourceManifest.id,
      sourceIds: rows.map((row) => row.id),
      sourceLicense: sourceManifest.license,
      sourceType: sourceManifest.source_type,
      transformation: "Exact-Czech deduplication, alternate-English merge, guided-learning annotation, initial Codex content review, independent Codex blind-review correction, and independent Codex re-audit correction.",
    },
    review: {
      status: "codex_reviewed",
      reviewer: "OpenAI Codex",
      reviewedOn: policy.reviewedOn,
      humanApproved: false,
      checks: [
        "bilingual meaning scan",
        "Czech learner-copy scan",
        "difficulty rubric",
        "exact token annotation",
        "duplicate merge",
        "child-safety source flag",
        "independent Codex blind review",
        "independent Codex re-audit",
      ],
      notes,
    },
  };
}

function applyOverride(sourceRow, override) {
  if (!override) return { ...sourceRow };
  const row = { ...sourceRow };
  for (const field of ["english_text", "czech_text", "difficulty", "cefr", "grammar_tags", "sentence_type"]) {
    if (field in override) row[field] = override[field];
  }
  row._blindReview = override;
  return row;
}

function blindReviewReport(applied) {
  const findings = applied.map(({ sourceRow, row, override }) => ({
    sourceId: override.id,
    categories: override.categories,
    reviewOrigins: reviewOrigins(override),
    original: {
      en: sourceRow.english_text,
      cs: sourceRow.czech_text,
      difficulty: sourceRow.difficulty,
      cefr: sourceRow.cefr,
      grammarTags: sourceRow.grammar_tags,
      sentenceType: sentenceType(sourceRow, sourceRow.grammar_tags || []),
    },
    resolution: {
      action: "corrected",
      en: row.english_text,
      cs: row.czech_text,
      difficulty: row.difficulty,
      cefr: row.cefr,
      grammarTags: row.grammar_tags,
      sentenceType: sentenceType(row, row.grammar_tags || []),
      rationale: override.resolution,
    },
  }));
  const reviewPasses = policy.blindReview.passes || [];
  const findingsByReviewPass = Object.fromEntries(reviewPasses.map((pass) => [
    pass.id,
    findings.filter((finding) => finding.reviewOrigins.includes(pass.id)).length,
  ]));
  const reviewEvents = Object.values(findingsByReviewPass).reduce((total, count) => total + count, 0);
  return {
    schemaVersion: "caatuu-word-world-blind-review-v1",
    corpusVersion: rubric.corpusVersion,
    reviewDate: policy.blindReview.date,
    reviewPasses,
    reviewerRole: policy.blindReview.reviewerRole,
    method: policy.blindReview.method,
    humanApproved: false,
    sourceRowsReviewed: sourceRows.length,
    findings: findings.length,
    correctedSourceRows: findings.length,
    reviewEvents,
    overlappingReviewRows: reviewEvents - findings.length,
    findingsByCategory: countBy(findings.flatMap((finding) => finding.categories), (category) => category),
    findingsByReviewPass,
    difficultyChanges: findings.filter((finding) => finding.original.difficulty !== finding.resolution.difficulty).length,
    textChanges: findings.filter((finding) => finding.original.en !== finding.resolution.en || finding.original.cs !== finding.resolution.cs).length,
    guidanceChanges: findings.filter((finding) => (
      JSON.stringify(finding.original.grammarTags) !== JSON.stringify(finding.resolution.grammarTags)
      || finding.original.sentenceType !== finding.resolution.sentenceType
    )).length,
    explicitGuidanceCorrections: findings.filter((finding) => finding.categories.includes("metadata_accuracy")).length,
    resolutions: findings,
    caveat: "This receipt covers two independent Codex review passes. It is not human or native-speaker approval.",
  };
}

function reviewOrigins(override) {
  return override.reviewOrigins || ["blind_review_2026-07-21"];
}

function isPlayable(token, excludedTokens) {
  if (!token.normalized || token.normalized.length < 2) return false;
  if (excludedTokens.has(token.normalized)) return false;
  return !/^\p{Lu}/u.test(token.surface) || token.tokenIndex === 0;
}

function sentenceType(row, tags) {
  if (row.sentence_type) return row.sentence_type;
  if (tags.includes("question") || row.czech_text.endsWith("?")) return "question";
  if (tags.includes("imperative")) return "imperative";
  if (tags.includes("short_formula") || tokenize(row.czech_text).length <= 2) return "formula";
  return "statement";
}

function clauseCount(text) {
  const normalized = ` ${normalizeText(text)} `;
  const subordinateMarkers = [" že ", " aby ", " protože ", " když ", " jestli ", " zatímco "];
  return Math.min(3, 1 + subordinateMarkers.filter((marker) => normalized.includes(marker)).length);
}

function rejection(row, gate, reason) {
  return {
    sourceId: row.id,
    en: row.english_text,
    cs: row.czech_text,
    gate,
    reason,
    reviewStatus: "rejected",
    humanApproved: false,
  };
}

function unique(values) {
  return [...new Set(values)];
}

function countBy(values, selector) {
  return Object.fromEntries([...values.reduce((map, value) => {
    const key = selector(value);
    map.set(key, (map.get(key) || 0) + 1);
    return map;
  }, new Map())].sort(([left], [right]) => left.localeCompare(right)));
}

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}
