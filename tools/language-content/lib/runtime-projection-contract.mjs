import { isDeepStrictEqual } from "node:util";

export const ENGLISH_CONCEPT_RUNTIME_SCHEMA =
  "https://caatuu.org/schemas/runtime/english-concepts.runtime.v1.schema.json";
export const TARGET_REALIZATION_RUNTIME_SCHEMA =
  "https://caatuu.org/schemas/runtime/target-realizations.runtime.v1.schema.json";

const ENGLISH_KEYS = [
  "$schema",
  "schemaVersion",
  "id",
  "language",
  "derivedFrom",
  "embeddingPolicy",
  "license",
  "concepts"
];
const CONCEPT_KEYS = ["id", "englishText", "embeddingText", "sceneQuery", "topic", "difficulty"];
const TARGET_KEYS = [
  "$schema",
  "schemaVersion",
  "courseId",
  "derivedFrom",
  "projectionPolicy",
  "targetLanguage",
  "sourceCatalog",
  "contentPolicy",
  "review",
  "license",
  "realizations"
];
const REALIZATION_KEYS = ["conceptId", "text", "pronunciation", "tokens"];
const TOKEN_KEYS = ["surface", "pronunciation", "gloss", "playable"];
const PRONUNCIATION_KEYS = ["system", "notation", "languageTag", "reviewed"];
const CONCEPT_ID_PATTERN = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/u;

export class RuntimeProjectionError extends Error {
  constructor(issues) {
    super(`Runtime projection validation failed:\n${issues.map((issue) => `- ${issue}`).join("\n")}`);
    this.name = "RuntimeProjectionError";
    this.issues = issues;
  }
}

export function validateEnglishConceptRuntimeProjection(projection, {
  source = null,
  expectedDerivedFrom = null
} = {}) {
  const issues = [];
  requireObject(projection, "English runtime projection", issues);
  strictKeys(projection, ENGLISH_KEYS, ENGLISH_KEYS, "English runtime projection", issues);
  if (projection?.$schema !== ENGLISH_CONCEPT_RUNTIME_SCHEMA) {
    issues.push(`$schema must be ${ENGLISH_CONCEPT_RUNTIME_SCHEMA}.`);
  }
  if (projection?.schemaVersion !== 1) issues.push("schemaVersion must be 1.");
  if (projection?.language !== "en") issues.push("language must be en.");
  if (!nonEmpty(projection?.derivedFrom)) issues.push("derivedFrom must be a non-empty authoring path.");
  if (expectedDerivedFrom && projection?.derivedFrom !== expectedDerivedFrom) {
    issues.push(`derivedFrom must be ${expectedDerivedFrom}.`);
  }
  if (projection?.embeddingPolicy?.inputLanguage !== "en"
      || projection?.embeddingPolicy?.inputField !== "embeddingText"
      || projection?.embeddingPolicy?.targetTextAllowed !== false) {
    issues.push("embeddingPolicy must preserve the English-only embeddingText boundary.");
  }
  const ids = [];
  if (!Array.isArray(projection?.concepts) || projection.concepts.length === 0) {
    issues.push("concepts must be a non-empty array.");
  } else {
    for (const [index, concept] of projection.concepts.entries()) {
      const label = `concepts[${index}]`;
      strictKeys(concept, CONCEPT_KEYS, CONCEPT_KEYS, label, issues);
      if (!CONCEPT_ID_PATTERN.test(String(concept?.id ?? ""))) issues.push(`${label}.id is invalid.`);
      else ids.push(concept.id);
      for (const field of ["englishText", "embeddingText", "sceneQuery", "topic"]) {
        if (!nonEmpty(concept?.[field])) issues.push(`${label}.${field} must be non-empty.`);
      }
      if (!Number.isInteger(concept?.difficulty) || concept.difficulty < 1 || concept.difficulty > 5) {
        issues.push(`${label}.difficulty must be an integer from 1 to 5.`);
      }
    }
  }
  duplicateIssues(ids, "concept id", issues);
  if (source) {
    const expected = {
      ...cloneJson(source),
      $schema: ENGLISH_CONCEPT_RUNTIME_SCHEMA,
      derivedFrom: projection?.derivedFrom
    };
    if (!isDeepStrictEqual(projection, expected)) {
      issues.push("English runtime projection must be a faithful projection of its authoring source.");
    }
  }
  finish(issues);
  return projection;
}

export function validateTargetRealizationRuntimeProjection(projection, {
  source = null,
  expectedDerivedFrom = null
} = {}) {
  const issues = [];
  requireObject(projection, "Target runtime projection", issues);
  strictKeys(projection, TARGET_KEYS, TARGET_KEYS, "Target runtime projection", issues);
  if (projection?.$schema !== TARGET_REALIZATION_RUNTIME_SCHEMA) {
    issues.push(`$schema must be ${TARGET_REALIZATION_RUNTIME_SCHEMA}.`);
  }
  if (projection?.schemaVersion !== 1) issues.push("schemaVersion must be 1.");
  if (!nonEmpty(projection?.courseId)) issues.push("courseId must be non-empty.");
  if (!nonEmpty(projection?.contentPolicy)) issues.push("contentPolicy must name the source policy.");
  if (!nonEmpty(projection?.derivedFrom)) issues.push("derivedFrom must be a non-empty authoring path.");
  if (expectedDerivedFrom && projection?.derivedFrom !== expectedDerivedFrom) {
    issues.push(`derivedFrom must be ${expectedDerivedFrom}.`);
  }
  const pronunciationIncluded = projection?.projectionPolicy?.pronunciationIncluded;
  strictKeys(
    projection?.projectionPolicy,
    ["tokenization", "pronunciationIncluded", "reason"],
    ["tokenization", "pronunciationIncluded", "reason"],
    "projectionPolicy",
    issues
  );
  if (projection?.projectionPolicy?.tokenization !== "authored") {
    issues.push("projectionPolicy.tokenization must be authored.");
  }
  if (typeof pronunciationIncluded !== "boolean") {
    issues.push("projectionPolicy.pronunciationIncluded must be boolean.");
  }
  if (projection?.review?.status === "native-review-required" && pronunciationIncluded === true) {
    issues.push("Unreviewed runtime projections must omit pronunciation metadata.");
  }
  if (!nonEmpty(projection?.projectionPolicy?.reason)) {
    issues.push("projectionPolicy.reason must explain the learner projection.");
  }

  const ids = [];
  if (!Array.isArray(projection?.realizations) || projection.realizations.length === 0) {
    issues.push("realizations must be a non-empty array.");
  } else {
    for (const [index, realization] of projection.realizations.entries()) {
      const label = `realizations[${index}]`;
      const required = pronunciationIncluded
        ? ["conceptId", "text", "pronunciation", "tokens"]
        : ["conceptId", "text", "tokens"];
      strictKeys(realization, REALIZATION_KEYS, required, label, issues);
      if (!CONCEPT_ID_PATTERN.test(String(realization?.conceptId ?? ""))) issues.push(`${label}.conceptId is invalid.`);
      else ids.push(realization.conceptId);
      if (!nonEmpty(realization?.text)) issues.push(`${label}.text must be non-empty.`);
      validateProjectedPronunciation(realization, label, pronunciationIncluded, issues);
      if (!Array.isArray(realization?.tokens) || realization.tokens.length === 0) {
        issues.push(`${label}.tokens must contain authored word boundaries.`);
        continue;
      }
      for (const [tokenIndex, token] of realization.tokens.entries()) {
        const tokenLabel = `${label}.tokens[${tokenIndex}]`;
        const tokenRequired = pronunciationIncluded
          ? ["surface", "pronunciation", "gloss", "playable"]
          : ["surface", "gloss", "playable"];
        strictKeys(token, TOKEN_KEYS, tokenRequired, tokenLabel, issues);
        if (!nonEmpty(token?.surface)) issues.push(`${tokenLabel}.surface must be non-empty.`);
        if (!nonEmpty(token?.gloss)) issues.push(`${tokenLabel}.gloss must be non-empty.`);
        if (typeof token?.playable !== "boolean") issues.push(`${tokenLabel}.playable must be boolean.`);
        validateProjectedPronunciation(token, tokenLabel, pronunciationIncluded, issues);
      }
      if (lexicalSurface(realization.tokens.map((token) => token?.surface ?? "").join(""))
          !== lexicalSurface(realization.text)) {
        issues.push(`${label}.tokens must reproduce learner text in order.`);
      }
    }
  }
  duplicateIssues(ids, "target realization id", issues);
  if (source) compareTargetProjectionToSource(projection, source, pronunciationIncluded, issues);
  finish(issues);
  return projection;
}

function compareTargetProjectionToSource(projection, source, pronunciationIncluded, issues) {
  for (const field of ["schemaVersion", "courseId", "targetLanguage", "sourceCatalog", "contentPolicy", "review", "license"]) {
    if (!isDeepStrictEqual(projection?.[field], source?.[field])) {
      issues.push(`${field} must match the authoring source.`);
    }
  }
  if (projection?.realizations?.length !== source?.realizations?.length) {
    issues.push("Runtime realization count must match the authoring source.");
    return;
  }
  const sourceById = new Map(source.realizations.map((item) => [item.conceptId, item]));
  for (const realization of projection.realizations) {
    const authored = sourceById.get(realization.conceptId);
    if (!authored) {
      issues.push(`Runtime realization ${realization.conceptId} is absent from the authoring source.`);
      continue;
    }
    if (realization.text !== authored.text) issues.push(`${realization.conceptId}.text differs from authoring.`);
    if (pronunciationIncluded) {
      if (!isDeepStrictEqual(realization.pronunciation, authored.pronunciation)) {
        issues.push(`${realization.conceptId}.pronunciation differs from authoring.`);
      }
    } else if (Object.hasOwn(realization, "pronunciation")) {
      issues.push(`${realization.conceptId}.pronunciation must be omitted while unreviewed.`);
    }
    const expectedTokens = authored.tokens.map((token) => ({
      surface: token.surface,
      ...(pronunciationIncluded ? { pronunciation: token.pronunciation } : {}),
      gloss: token.gloss,
      playable: token.playable
    }));
    if (!isDeepStrictEqual(realization.tokens, expectedTokens)) {
      issues.push(`${realization.conceptId}.tokens differ from the learner-safe authoring projection.`);
    }
  }
}

function validateProjectedPronunciation(owner, label, included, issues) {
  const present = Object.hasOwn(owner ?? {}, "pronunciation");
  if (!included && present) {
    issues.push(`${label}.pronunciation must be omitted by the current projection policy.`);
    return;
  }
  if (!included) return;
  const pronunciation = owner?.pronunciation;
  strictKeys(
    pronunciation,
    PRONUNCIATION_KEYS,
    PRONUNCIATION_KEYS,
    `${label}.pronunciation`,
    issues
  );
  for (const field of PRONUNCIATION_KEYS) {
    if (field === "reviewed") {
      if (typeof pronunciation?.reviewed !== "boolean") {
        issues.push(`${label}.pronunciation.reviewed must be boolean.`);
      }
    } else if (!nonEmpty(pronunciation?.[field])) {
      issues.push(`${label}.pronunciation.${field} must be non-empty.`);
    }
  }
  if (pronunciation?.reviewed !== true) {
    issues.push(`${label}.pronunciation.reviewed must be true in a learner-visible pronunciation projection.`);
  }
}

function strictKeys(value, allowed, required, label, issues) {
  if (!requireObject(value, label, issues)) return;
  for (const key of required) {
    if (!Object.hasOwn(value, key)) issues.push(`${label} is missing ${key}.`);
  }
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) issues.push(`${label} contains unsupported field ${key}.`);
  }
}

function requireObject(value, label, issues) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    issues.push(`${label} must be an object.`);
    return false;
  }
  return true;
}

function duplicateIssues(values, label, issues) {
  const seen = new Set();
  for (const value of values) {
    if (seen.has(value)) issues.push(`Duplicate ${label}: ${value}.`);
    seen.add(value);
  }
}

function lexicalSurface(value) {
  return String(value ?? "").normalize("NFKC").replace(/[\p{White_Space}\p{Punctuation}]/gu, "");
}

function nonEmpty(value) {
  return typeof value === "string" && Boolean(value.trim());
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function finish(issues) {
  if (issues.length > 0) throw new RuntimeProjectionError(issues);
}
