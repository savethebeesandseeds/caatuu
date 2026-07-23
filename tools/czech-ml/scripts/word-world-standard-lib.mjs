import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export const AUTHORING_SCHEMA_VERSION = "caatuu-word-world-record-v1";
export const RUNTIME_SCHEMA_VERSION = "caatuu-word-world-runtime-v1";
export const RUNTIME_MANIFEST_SCHEMA_VERSION = "caatuu-word-world-runtime-manifest-v1";

export async function readJson(file) {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

export async function readJsonl(file) {
  const text = await fs.readFile(file, "utf8");
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        error.message = `${file}:${index + 1}: ${error.message}`;
        throw error;
      }
    });
}

export async function writeJson(file, value, { compact = false } = {}) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const json = compact ? JSON.stringify(value) : JSON.stringify(value, null, 2);
  await fs.writeFile(file, `${json}\n`, "utf8");
}

export async function writeJsonl(file, rows) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
}

export async function findJsonlFiles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await findJsonlFiles(target));
    else if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(target);
  }
  return files;
}

export function normalizeText(value) {
  return String(value || "")
    .normalize("NFC")
    .toLocaleLowerCase("cs-CZ")
    .match(/[\p{L}\p{M}\p{N}]+/gu)
    ?.join(" ") || "";
}

export function normalizeSentence(value) {
  return String(value || "")
    .normalize("NFC")
    .trim()
    .toLocaleLowerCase("cs-CZ")
    .replace(/\s+/g, " ");
}

export function tokenize(value) {
  return [...String(value || "").normalize("NFC").matchAll(/[\p{L}\p{M}\p{N}]+(?:[’'][\p{L}\p{M}\p{N}]+)*/gu)]
    .map((match, tokenIndex) => ({
      surface: match[0],
      normalized: normalizeText(match[0]),
      tokenIndex,
    }));
}

export function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function toRuntimeRecord(record) {
  return {
    id: record.id,
    cs: record.languages.cs.text,
    en: record.languages.en.text,
    enAlternates: [...record.languages.en.alternates],
    difficulty: record.difficulty,
    cefr: record.cefr,
    topic: record.topic,
    targets: record.targets.map((target) => ({
      surface: target.surface,
      normalized: target.normalized,
      tokenIndex: target.tokenIndex,
      playable: target.playable,
    })),
    learning: record.learning,
    grammar: record.grammar,
    sceneQuery: record.scene.query,
    sceneAssetIds: [...record.scene.assetIds],
    provenance: record.provenance,
    review: record.review,
  };
}

export function validateRecords(records, rubric) {
  const errors = [];
  const warnings = [];
  const ids = new Map();
  const czech = new Map();
  const english = new Map();
  const sourceIds = new Map();
  const allowedReviewStatuses = new Set(rubric.reviewPolicy.allowedStatuses);

  records.forEach((record, index) => {
    const label = `record ${index + 1}${record?.id ? ` (${record.id})` : ""}`;
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      errors.push(`${label}: must be an object`);
      return;
    }
    requireExactKeys(record, [
      "schemaVersion", "id", "languages", "difficulty", "cefr", "topic", "targets", "learning", "grammar", "scene", "provenance", "review",
    ], label, errors);
    if (record.schemaVersion !== AUTHORING_SCHEMA_VERSION) errors.push(`${label}: unsupported schemaVersion ${record.schemaVersion}`);
    if (!/^ww-[a-z0-9-]+$/.test(String(record.id || ""))) errors.push(`${label}: invalid id`);
    registerUnique(ids, record.id, label, "id", errors);

    validateLanguages(record.languages, label, errors);
    const csText = record.languages?.cs?.text || "";
    const enText = record.languages?.en?.text || "";
    registerUnique(czech, normalizeSentence(csText), label, "normalized Czech sentence", errors);
    for (const candidate of [enText, ...(record.languages?.en?.alternates || [])]) {
      registerOccurrence(english, normalizeText(candidate), label);
    }

    const level = rubric.levels[String(record.difficulty)];
    if (!level) errors.push(`${label}: difficulty must be 1, 2, or 3`);
    else validateLevel(record, level, label, errors);
    if (record.learning?.progression?.level !== record.difficulty) {
      errors.push(`${label}: learning.progression.level must match difficulty`);
    }

    validateTargets(record.targets, csText, label, errors);
    validateLearning(record.learning, label, errors);
    validateGrammar(record.grammar, label, errors);
    validateScene(record.scene, label, errors);
    validateProvenance(record.provenance, label, sourceIds, errors);
    validateReview(record.review, label, allowedReviewStatuses, rubric.reviewPolicy, errors);
  });

  if (records.length < rubric.distribution.minimumRecords) {
    errors.push(`bank has ${records.length} records; minimum is ${rubric.distribution.minimumRecords}`);
  }
  const level2Count = records.filter((record) => record.difficulty === 2).length;
  const level2Share = records.length ? level2Count / records.length : 0;
  if (level2Share < rubric.distribution.minimumLevel2Share) {
    errors.push(`level 2 share is ${formatPercent(level2Share)}; minimum is ${formatPercent(rubric.distribution.minimumLevel2Share)}`);
  }
  const level3Count = records.filter((record) => record.difficulty === 3).length;
  if (level3Count < rubric.distribution.minimumLevel3Records) {
    errors.push(`level 3 has ${level3Count} records; minimum is ${rubric.distribution.minimumLevel3Records}`);
  }
  if (!records.some((record) => record.difficulty === 1)) warnings.push("bank has no level 1 records");
  const duplicateEnglishGroups = [...english.values()].filter((labels) => labels.length > 1).length;
  if (duplicateEnglishGroups > 0) {
    warnings.push(`${duplicateEnglishGroups} English meaning group(s) occur in more than one record; allowed for Czech variants and minimal contrasts`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    recordCount: records.length,
    level2Share: Number(level2Share.toFixed(6)),
    duplicateEnglishGroups,
  };
}

export function buildCoverageReport(records, rubric, validation, inputFiles = []) {
  const targetMap = new Map();
  for (const record of records) {
    for (const target of record.targets.filter((entry) => entry.playable)) {
      if (!targetMap.has(target.normalized)) {
        targetMap.set(target.normalized, {
          normalized: target.normalized,
          surfaces: new Set(),
          recordIds: new Set(),
          difficulties: new Set(),
          topics: new Set(),
        });
      }
      const entry = targetMap.get(target.normalized);
      entry.surfaces.add(target.surface);
      entry.recordIds.add(record.id);
      entry.difficulties.add(record.difficulty);
      entry.topics.add(record.topic);
    }
  }

  const perTarget = [...targetMap.values()]
    .map((entry) => ({
      normalized: entry.normalized,
      surfaces: [...entry.surfaces].sort((left, right) => left.localeCompare(right, "cs")),
      recordCount: entry.recordIds.size,
      recordIds: [...entry.recordIds].sort(),
      difficulties: [...entry.difficulties].sort((left, right) => left - right),
      topics: [...entry.topics].sort(),
    }))
    .sort((left, right) => left.normalized.localeCompare(right.normalized, "cs"));
  const branchableMinimum = rubric.branchability.branchableTargetMinimumRecords;
  const strongMinimum = rubric.branchability.strongTargetMinimumRecords;
  const branchable = perTarget.filter((target) => target.recordCount >= branchableMinimum).length;
  const strong = perTarget.filter((target) => target.recordCount >= strongMinimum).length;
  const uniqueTargets = perTarget.length;

  return {
    schemaVersion: "caatuu-word-world-coverage-v1",
    corpusVersion: rubric.corpusVersion,
    inputFiles: inputFiles.map((file) => file.replaceAll("\\", "/")),
    validation,
    records: {
      total: records.length,
      byDifficulty: countBy(records, (record) => String(record.difficulty)),
      difficultyShare: shareBy(records, (record) => String(record.difficulty)),
      byCefr: countBy(records, (record) => record.cefr),
      byTopic: countBy(records, (record) => record.topic),
      byReviewStatus: countBy(records, (record) => record.review.status),
    },
    guidance: {
      skillFocus: countMany(records, (record) => record.learning.skillFocus),
      grammarTags: countMany(records, (record) => record.grammar.tags),
      support: {
        translationAvailable: records.filter((record) => record.learning.support.translationAvailable).length,
        imageSuitable: records.filter((record) => record.learning.support.imageSuitable).length,
        audioSuitable: records.filter((record) => record.learning.support.audioSuitable).length,
        dictionarySuitable: records.filter((record) => record.learning.support.dictionarySuitable).length,
      },
    },
    targets: {
      uniquePlayable: uniqueTargets,
      singleton: perTarget.filter((target) => target.recordCount === 1).length,
      branchable: {
        minimumRecords: branchableMinimum,
        targetCount: branchable,
        share: uniqueTargets ? Number((branchable / uniqueTargets).toFixed(6)) : 0,
      },
      strong: {
        minimumRecords: strongMinimum,
        targetCount: strong,
        share: uniqueTargets ? Number((strong / uniqueTargets).toFixed(6)) : 0,
      },
      perTarget,
    },
  };
}

function validateLanguages(languages, label, errors) {
  requireObject(languages, `${label}.languages`, errors);
  requireExactKeys(languages, ["en", "cs"], `${label}.languages`, errors);
  requireObject(languages?.en, `${label}.languages.en`, errors);
  requireExactKeys(languages?.en, ["text", "alternates"], `${label}.languages.en`, errors);
  requireString(languages?.en?.text, `${label}.languages.en.text`, errors);
  if (!Array.isArray(languages?.en?.alternates)) errors.push(`${label}.languages.en.alternates: must be an array`);
  else {
    const seen = new Set();
    for (const alternate of languages.en.alternates) {
      requireString(alternate, `${label}.languages.en.alternates`, errors);
      const key = normalizeText(alternate);
      if (seen.has(key) || key === normalizeText(languages.en.text)) errors.push(`${label}: duplicate English alternate`);
      seen.add(key);
    }
  }
  requireObject(languages?.cs, `${label}.languages.cs`, errors);
  requireExactKeys(languages?.cs, ["text"], `${label}.languages.cs`, errors);
  requireString(languages?.cs?.text, `${label}.languages.cs.text`, errors);
}

function validateLevel(record, level, label, errors) {
  const csTokens = tokenize(record.languages?.cs?.text).length;
  const enTokens = tokenize(record.languages?.en?.text).length;
  if (csTokens < level.minimumTokens) errors.push(`${label}: Czech text has fewer than ${level.minimumTokens} tokens for level ${record.difficulty}`);
  if (enTokens < level.minimumTokens) errors.push(`${label}: English text has fewer than ${level.minimumTokens} tokens for level ${record.difficulty}`);
  if (csTokens > level.maximumCzechTokens) errors.push(`${label}: Czech text has ${csTokens} tokens; level ${record.difficulty} allows ${level.maximumCzechTokens}`);
  if (enTokens > level.maximumEnglishTokens) errors.push(`${label}: English text has ${enTokens} tokens; level ${record.difficulty} allows ${level.maximumEnglishTokens}`);
  if (record.languages?.cs?.text.length > level.maximumCzechCharacters) errors.push(`${label}: Czech text exceeds level ${record.difficulty} character limit`);
  if (record.languages?.en?.text.length > level.maximumEnglishCharacters) errors.push(`${label}: English text exceeds level ${record.difficulty} character limit`);
  if (!level.allowedCefr.includes(record.cefr)) errors.push(`${label}: CEFR ${record.cefr} is not allowed at level ${record.difficulty}`);
  if (record.grammar?.clauseCount > level.maximumClauses) errors.push(`${label}: clause count exceeds level ${record.difficulty} limit`);
}

function validateTargets(targets, csText, label, errors) {
  if (!Array.isArray(targets) || targets.length === 0) {
    errors.push(`${label}.targets: must contain at least one exact token annotation`);
    return;
  }
  const tokens = tokenize(csText);
  const indexes = new Set();
  for (const target of targets) {
    requireExactKeys(target, ["surface", "normalized", "tokenIndex", "playable"], `${label}.targets`, errors);
    const token = tokens[target?.tokenIndex];
    if (!token) errors.push(`${label}: target tokenIndex ${target?.tokenIndex} is outside Czech text`);
    else {
      if (target.surface !== token.surface) errors.push(`${label}: target surface ${target.surface} does not match token ${token.surface}`);
      if (target.normalized !== token.normalized) errors.push(`${label}: target normalized ${target.normalized} does not match token ${token.normalized}`);
    }
    if (indexes.has(target?.tokenIndex)) errors.push(`${label}: duplicate target tokenIndex ${target?.tokenIndex}`);
    indexes.add(target?.tokenIndex);
    if (target?.playable !== true && target?.playable !== false) errors.push(`${label}: target.playable must be boolean`);
  }
}

function validateLearning(learning, label, errors) {
  requireObject(learning, `${label}.learning`, errors);
  requireExactKeys(learning, ["objective", "skillFocus", "ageBand", "progression", "support"], `${label}.learning`, errors);
  requireString(learning?.objective, `${label}.learning.objective`, errors);
  requireString(learning?.ageBand, `${label}.learning.ageBand`, errors);
  requireStringArray(learning?.skillFocus, `${label}.learning.skillFocus`, errors, { minimum: 1 });
  requireObject(learning?.progression, `${label}.learning.progression`, errors);
  requireExactKeys(learning?.progression, ["level", "rationale", "prerequisites"], `${label}.learning.progression`, errors);
  requireString(learning?.progression?.rationale, `${label}.learning.progression.rationale`, errors);
  requireStringArray(learning?.progression?.prerequisites, `${label}.learning.progression.prerequisites`, errors);
  requireObject(learning?.support, `${label}.learning.support`, errors);
  requireExactKeys(learning?.support, ["translationAvailable", "imageSuitable", "audioSuitable", "dictionarySuitable"], `${label}.learning.support`, errors);
  for (const field of ["translationAvailable", "imageSuitable", "audioSuitable", "dictionarySuitable"]) {
    if (typeof learning?.support?.[field] !== "boolean") errors.push(`${label}.learning.support.${field}: must be boolean`);
  }
  if (learning?.support?.translationAvailable !== true) errors.push(`${label}: Standard mode requires an included translation`);
}

function validateGrammar(grammar, label, errors) {
  requireObject(grammar, `${label}.grammar`, errors);
  requireExactKeys(grammar, ["tags", "sentenceType", "clauseCount"], `${label}.grammar`, errors);
  requireStringArray(grammar?.tags, `${label}.grammar.tags`, errors);
  if (!["statement", "question", "imperative", "formula"].includes(grammar?.sentenceType)) errors.push(`${label}.grammar.sentenceType: invalid value`);
  if (!Number.isInteger(grammar?.clauseCount) || grammar.clauseCount < 1 || grammar.clauseCount > 3) errors.push(`${label}.grammar.clauseCount: must be 1..3`);
}

function validateScene(scene, label, errors) {
  requireObject(scene, `${label}.scene`, errors);
  requireExactKeys(scene, ["query", "assetIds"], `${label}.scene`, errors);
  if (typeof scene?.query !== "string") errors.push(`${label}.scene.query: must be a string`);
  requireStringArray(scene?.assetIds, `${label}.scene.assetIds`, errors);
}

function validateProvenance(provenance, label, sourceIds, errors) {
  requireObject(provenance, `${label}.provenance`, errors);
  requireExactKeys(provenance, ["sourceName", "sourceIds", "sourceLicense", "sourceType", "transformation"], `${label}.provenance`, errors);
  for (const field of ["sourceName", "sourceLicense", "sourceType", "transformation"]) requireString(provenance?.[field], `${label}.provenance.${field}`, errors);
  requireStringArray(provenance?.sourceIds, `${label}.provenance.sourceIds`, errors, { minimum: 1 });
  for (const sourceId of provenance?.sourceIds || []) registerUnique(sourceIds, sourceId, label, "source id", errors);
}

function validateReview(review, label, allowedStatuses, policy, errors) {
  requireObject(review, `${label}.review`, errors);
  requireExactKeys(review, ["status", "reviewer", "reviewedOn", "humanApproved", "checks", "notes"], `${label}.review`, errors);
  if (!allowedStatuses.has(review?.status)) errors.push(`${label}.review.status: ${review?.status} is not allowed by this corpus rubric`);
  requireString(review?.reviewer, `${label}.review.reviewer`, errors);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(review?.reviewedOn || ""))) errors.push(`${label}.review.reviewedOn: must be YYYY-MM-DD`);
  if (review?.humanApproved !== false && !policy.humanApprovalAllowed) errors.push(`${label}: human approval must not be claimed by this corpus`);
  if (review?.status === "human_approved" && review?.humanApproved !== true) errors.push(`${label}: human_approved status requires humanApproved true`);
  requireStringArray(review?.checks, `${label}.review.checks`, errors, { minimum: 1 });
  requireStringArray(review?.notes, `${label}.review.notes`, errors);
}

function requireObject(value, label, errors) {
  if (!value || typeof value !== "object" || Array.isArray(value)) errors.push(`${label}: must be an object`);
}

function requireString(value, label, errors) {
  if (typeof value !== "string" || !value.trim()) errors.push(`${label}: must be a non-empty string`);
}

function requireStringArray(value, label, errors, { minimum = 0 } = {}) {
  if (!Array.isArray(value)) {
    errors.push(`${label}: must be an array`);
    return;
  }
  if (value.length < minimum) errors.push(`${label}: must contain at least ${minimum} item(s)`);
  const seen = new Set();
  for (const item of value) {
    if (typeof item !== "string" || !item.trim()) errors.push(`${label}: entries must be non-empty strings`);
    if (seen.has(item)) errors.push(`${label}: duplicate entry ${item}`);
    seen.add(item);
  }
}

function requireExactKeys(value, expected, label, errors) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  for (const missing of wanted.filter((key) => !actual.includes(key))) errors.push(`${label}: missing field ${missing}`);
  for (const extra of actual.filter((key) => !wanted.includes(key))) errors.push(`${label}: unknown field ${extra}`);
}

function registerUnique(map, key, label, kind, errors) {
  if (!key) return;
  if (map.has(key)) errors.push(`${label}: duplicate ${kind}; first seen in ${map.get(key)}`);
  else map.set(key, label);
}

function registerOccurrence(map, key, label) {
  if (!key) return;
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(label);
}

function countBy(records, selector) {
  const counts = {};
  for (const record of records) {
    const key = selector(record) || "unknown";
    counts[key] = (counts[key] || 0) + 1;
  }
  return sortObject(counts);
}

function shareBy(records, selector) {
  const counts = countBy(records, selector);
  return Object.fromEntries(Object.entries(counts).map(([key, value]) => [key, records.length ? Number((value / records.length).toFixed(6)) : 0]));
}

function countMany(records, selector) {
  const values = [];
  for (const record of records) values.push(...selector(record));
  return countBy(values, (value) => value);
}

function sortObject(value) {
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
}

function formatPercent(value) {
  return `${(value * 100).toFixed(1)}%`;
}
