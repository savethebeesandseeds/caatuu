import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ENGLISH_AUDIT_LANGUAGE,
  validateLanguageContent
} from "./content-contract.mjs";

export const LEARNER_BASE_REALIZATIONS_SCHEMA_VERSION = 1;
export const LEARNER_BASE_REALIZATIONS_SCHEMA =
  "https://caatuu.org/schemas/learner-base-realizations.v1.schema.json";

const DEFAULT_REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const CATALOG_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*-v[1-9][0-9]*$/u;
const CONCEPT_ID_PATTERN = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/u;
const SOURCE_CATALOG_PATTERN =
  /^apps\/languages\/shared\/english-concepts\/[a-z0-9][a-z0-9.-]*\.json$/u;
const LEARNER_BASE_CATALOG_PATTERN =
  /^apps\/languages\/shared\/learner-base-realizations\/[a-z0-9][A-Za-z0-9._/-]*\.json$/u;
const TARGET_CATALOG_PATTERN =
  /^apps\/languages\/([a-z0-9]+(?:-[a-z0-9]+)*)\/content\/[A-Za-z0-9._/-]+\.json$/u;
const LETTER_PATTERN = /\p{Letter}/u;
const ASCII_LETTER_PATTERN = /[A-Za-z]/u;
const BASE_CATALOG_KEYS = [
  "$schema",
  "schemaVersion",
  "id",
  "baseLanguage",
  "sourceCatalog",
  "review",
  "license",
  "realizations"
];
const BASE_LANGUAGE_KEYS = ["languageTag", "script"];
const BASE_REALIZATION_KEYS = ["conceptId", "text"];
const REVIEW_KEYS = ["status", "reviewer", "reviewedAt", "notes"];
const LICENSE_KEYS = [
  "origin",
  "status",
  "spdxExpression",
  "sourceReference",
  "reviewedBy",
  "reviewedAt"
];

export class LanguageRoleError extends Error {
  constructor(issues) {
    const details = issues.map(({ code, message }) => `- [${code}] ${message}`).join("\n");
    super(`Language-role contract validation failed:\n${details}`);
    this.name = "LanguageRoleError";
    this.issues = issues;
  }
}

/**
 * Validates a reusable learner-base overlay over the immutable English
 * concept catalog. This catalog is intentionally target-neutral: the same
 * reviewed base wording can mediate more than one target course.
 */
export function validateLearnerBaseRealizations(
  concepts,
  baseRealizations,
  {
    expectedLanguageTag = null,
    expectedSourceCatalog = null,
    release = false,
    requireNativeReview = false
  } = {}
) {
  const issues = [];
  validateBaseCatalogShape(baseRealizations, issues, { release, requireNativeReview });
  validateBaseCatalogCoverage(concepts, baseRealizations, issues);

  if (
    expectedSourceCatalog
    && baseRealizations?.sourceCatalog !== expectedSourceCatalog
  ) {
    addIssue(
      issues,
      "base.source-catalog",
      `Learner-base sourceCatalog must be ${expectedSourceCatalog}.`
    );
  }

  if (expectedLanguageTag) {
    const expected = canonicalLanguageTag(
      expectedLanguageTag,
      "expectedLanguageTag",
      issues
    );
    const actual = canonicalLanguageTag(
      baseRealizations?.baseLanguage?.languageTag,
      "baseLanguage.languageTag",
      []
    );
    if (expected && actual && expected !== actual) {
      addIssue(
        issues,
        "base.language-mismatch",
        `Learner-base language ${actual} does not match course source language ${expected}.`
      );
    }
  }

  finish(issues);
  return deepFreeze(baseRealizations);
}

/**
 * Joins the three independent language roles used by Word World:
 *
 * - immutable English audit/retrieval text;
 * - the learner's prompt/base wording;
 * - the target-language realization.
 *
 * English-base courses derive their learner prompts from englishText. A
 * non-English source language must supply a reviewed, concept-ID-keyed base
 * overlay. Nothing from that overlay is copied into embedding inputs.
 */
export function prepareLanguageRoleContent(
  concepts,
  targetRealizations,
  {
    sourceLanguage,
    learnerBaseRealizations = null,
    release = false,
    requireNativeReview = false,
    contentPolicy = null
  } = {}
) {
  const source = normalizeSourceLanguage(sourceLanguage);
  const prepared = validateLanguageContent(concepts, targetRealizations, {
    release,
    requireNativeReview,
    contentPolicy
  });
  const sourceCatalog = targetRealizations.sourceCatalog;
  const isEnglishBase = languagePrimary(source.languageTag) === ENGLISH_AUDIT_LANGUAGE;

  if (isEnglishBase && learnerBaseRealizations) {
    throw new LanguageRoleError([{
      code: "base.redundant",
      message: "English-base courses must use English concept text directly instead of a duplicate base overlay."
    }]);
  }
  if (!isEnglishBase && !learnerBaseRealizations) {
    throw new LanguageRoleError([{
      code: "base.required",
      message: `Course source language ${source.languageTag} requires a reviewed learner-base realization catalog.`
    }]);
  }

  const validatedBase = learnerBaseRealizations
    ? validateLearnerBaseRealizations(concepts, learnerBaseRealizations, {
      expectedLanguageTag: source.languageTag,
      expectedSourceCatalog: sourceCatalog,
      release,
      requireNativeReview
    })
    : null;
  const baseByConcept = new Map(
    validatedBase?.realizations.map((realization) => [realization.conceptId, realization]) ?? []
  );
  const targetByConcept = new Map(
    targetRealizations.realizations.map((realization) => [realization.conceptId, realization])
  );

  const records = concepts.concepts.map((concept) => ({
    conceptId: concept.id,
    englishText: concept.englishText,
    embeddingText: concept.embeddingText,
    sceneQuery: concept.sceneQuery,
    topic: concept.topic,
    difficulty: concept.difficulty,
    audit: {
      languageTag: ENGLISH_AUDIT_LANGUAGE,
      text: concept.englishText
    },
    learnerPrompt: {
      languageTag: source.languageTag,
      text: isEnglishBase
        ? concept.englishText
        : baseByConcept.get(concept.id).text,
      authority: isEnglishBase ? "english-concept" : "learner-base-realization"
    },
    target: cloneJson(targetByConcept.get(concept.id))
  }));

  return deepFreeze({
    roles: {
      auditLanguage: ENGLISH_AUDIT_LANGUAGE,
      retrievalLanguage: ENGLISH_AUDIT_LANGUAGE,
      learnerBaseLanguage: source.languageTag,
      targetLanguage: targetRealizations.targetLanguage.languageTag
    },
    concepts: prepared.concepts,
    targetRealizations: prepared.realizations,
    learnerBaseRealizations: validatedBase,
    embeddingInputs: prepared.embeddingInputs,
    embeddingDocuments: prepared.embeddingDocuments,
    records
  });
}

/**
 * Loads the optional base overlay separately from the English and target
 * authoring catalogs, preserving their independent provenance.
 */
export async function loadAndPrepareLanguageRoleContent({
  repoRoot = DEFAULT_REPO_ROOT,
  conceptsPath,
  targetRealizationsPath,
  learnerBaseRealizationsPath = null,
  sourceLanguage,
  release = false,
  requireNativeReview = false,
  contentPolicy = null
}) {
  const root = path.resolve(repoRoot instanceof URL ? fileURLToPath(repoRoot) : repoRoot);
  const paths = {
    concepts: normalizeRepositoryPath(conceptsPath, "conceptsPath"),
    targetRealizations: normalizeRepositoryPath(
      targetRealizationsPath,
      "targetRealizationsPath"
    ),
    learnerBaseRealizations: learnerBaseRealizationsPath
      ? normalizeRepositoryPath(learnerBaseRealizationsPath, "learnerBaseRealizationsPath")
      : null
  };
  const [conceptsFile, targetRealizationsFile, learnerBaseRealizationsFile] = await Promise.all([
    resolveRealRoleFile(root, paths.concepts, "concepts"),
    resolveRealRoleFile(root, paths.targetRealizations, "targetRealizations"),
    paths.learnerBaseRealizations
      ? resolveRealRoleFile(root, paths.learnerBaseRealizations, "learnerBaseRealizations")
      : null
  ]);
  const [concepts, targetRealizations, learnerBaseRealizations] = await Promise.all([
    readJson(conceptsFile),
    readJson(targetRealizationsFile),
    learnerBaseRealizationsFile ? readJson(learnerBaseRealizationsFile) : null
  ]);
  if (targetRealizations.sourceCatalog !== paths.concepts) {
    throw new LanguageRoleError([{
      code: "target.source-catalog",
      message: `Target sourceCatalog must be ${paths.concepts}.`
    }]);
  }
  if (
    learnerBaseRealizations
    && learnerBaseRealizations.sourceCatalog !== paths.concepts
  ) {
    throw new LanguageRoleError([{
      code: "base.source-catalog",
      message: `Learner-base sourceCatalog must be ${paths.concepts}.`
    }]);
  }

  const prepared = prepareLanguageRoleContent(concepts, targetRealizations, {
    sourceLanguage,
    learnerBaseRealizations,
    release,
    requireNativeReview,
    contentPolicy
  });
  return deepFreeze({ ...prepared, paths });
}

/**
 * Produces the only payload shape an English semantic ranker may receive from
 * a three-role bundle. Base prompts and target realizations are intentionally
 * unrepresentable here.
 */
export function prepareEnglishRankingPayload(roleContent, englishQuery) {
  if (roleContent?.roles?.retrievalLanguage !== ENGLISH_AUDIT_LANGUAGE) {
    throw new LanguageRoleError([{
      code: "retrieval.language",
      message: "Word World retrieval language must remain English."
    }]);
  }
  if (!isNonEmptyString(englishQuery)) {
    throw new LanguageRoleError([{
      code: "retrieval.query",
      message: "English retrieval query must be a non-empty string."
    }]);
  }
  assertEnglishRetrievalCharacterPolicy(englishQuery);
  return deepFreeze({
    inputLanguage: ENGLISH_AUDIT_LANGUAGE,
    query: { embeddingText: englishQuery.trim() },
    candidates: roleContent.records.map(({ conceptId, embeddingText }) => ({
      conceptId,
      embeddingText
    }))
  });
}

// This is a conservative cross-script tripwire, not language identification.
// English authority comes from the catalog path, language declaration, review,
// and the role-specific API that supplies this query.
function assertEnglishRetrievalCharacterPolicy(value) {
  const text = String(value).normalize("NFKC").trim();
  for (const character of text) {
    if (LETTER_PATTERN.test(character) && !ASCII_LETTER_PATTERN.test(character)) {
      throw new LanguageRoleError([{
        code: "retrieval.query-language",
        message: "English-authority retrieval query violates the conservative ASCII character policy."
      }]);
    }
  }
  if (!ASCII_LETTER_PATTERN.test(text)) {
    throw new LanguageRoleError([{
      code: "retrieval.query-language",
      message: "English-authority retrieval query must contain an ASCII letter."
    }]);
  }
}

function validateBaseCatalogShape(catalog, issues, { release, requireNativeReview }) {
  if (!isObject(catalog)) {
    addIssue(issues, "base.shape", "Learner-base realization catalog must be an object.");
    return;
  }
  strictKeys(catalog, BASE_CATALOG_KEYS, BASE_CATALOG_KEYS, "base catalog", "base.shape", issues);
  if (catalog.$schema !== LEARNER_BASE_REALIZATIONS_SCHEMA) {
    addIssue(
      issues,
      "base.schema",
      `Learner-base catalog must reference ${LEARNER_BASE_REALIZATIONS_SCHEMA}.`
    );
  }
  if (catalog.schemaVersion !== LEARNER_BASE_REALIZATIONS_SCHEMA_VERSION) {
    addIssue(
      issues,
      "base.version",
      `Learner-base schemaVersion must be ${LEARNER_BASE_REALIZATIONS_SCHEMA_VERSION}.`
    );
  }
  if (typeof catalog.id !== "string" || !CATALOG_ID_PATTERN.test(catalog.id)) {
    addIssue(issues, "base.id", "Learner-base catalog id must be a stable versioned ID.");
  }
  validateBaseLanguage(catalog.baseLanguage, issues);
  if (
    typeof catalog.sourceCatalog !== "string"
    || !SOURCE_CATALOG_PATTERN.test(catalog.sourceCatalog)
    || hasUnsafePathSegment(catalog.sourceCatalog)
  ) {
    addIssue(
      issues,
      "base.source-catalog",
      "Learner-base sourceCatalog must be a confined shared English concept-catalog path."
    );
  }
  validateReview(catalog.review, issues, { requireNativeReview });
  validateLicense(catalog.license, issues, { release });

  if (!Array.isArray(catalog.realizations) || catalog.realizations.length === 0) {
    addIssue(issues, "base.shape", "Learner-base catalog must contain realizations.");
    return;
  }
  const ids = [];
  for (const [index, realization] of catalog.realizations.entries()) {
    const label = `realizations[${index}]`;
    if (!isObject(realization)) {
      addIssue(issues, "base.shape", `${label} must be an object.`);
      continue;
    }
    strictKeys(
      realization,
      BASE_REALIZATION_KEYS,
      BASE_REALIZATION_KEYS,
      label,
      "base.shape",
      issues
    );
    if (
      typeof realization.conceptId !== "string"
      || !CONCEPT_ID_PATTERN.test(realization.conceptId)
    ) {
      addIssue(issues, "base.id", `${label}.conceptId must be a stable concept ID.`);
    } else {
      ids.push(realization.conceptId);
    }
    if (!isNonEmptyString(realization.text)) {
      addIssue(issues, "base.shape", `${label}.text must be non-empty learner-base text.`);
    }
  }
  addDuplicateIssues(ids, issues, "base.duplicate", "learner-base concept ID");
}

function validateBaseCatalogCoverage(concepts, baseRealizations, issues) {
  if (!Array.isArray(concepts?.concepts) || !Array.isArray(baseRealizations?.realizations)) return;
  const expectedSourceCatalog = typeof concepts.id === "string"
    ? `apps/languages/shared/english-concepts/${concepts.id}.json`
    : null;
  if (expectedSourceCatalog && baseRealizations.sourceCatalog !== expectedSourceCatalog) {
    addIssue(
      issues,
      "base.source-catalog",
      `Learner-base catalog must name its paired English source as ${expectedSourceCatalog}.`
    );
  }
  const conceptIds = new Set(concepts.concepts.map(({ id }) => id));
  const baseIds = new Set(baseRealizations.realizations.map(({ conceptId }) => conceptId));
  const missing = [...conceptIds].filter((id) => !baseIds.has(id));
  const extra = [...baseIds].filter((id) => !conceptIds.has(id));
  if (missing.length > 0) {
    addIssue(
      issues,
      "base.coverage-missing",
      `Learner-base catalog is missing ${formatIds(missing)}.`
    );
  }
  if (extra.length > 0) {
    addIssue(
      issues,
      "base.coverage-extra",
      `Learner-base catalog contains unknown ${formatIds(extra)}.`
    );
  }
}

function validateBaseLanguage(language, issues) {
  if (!isObject(language)) {
    addIssue(issues, "base.language", "baseLanguage must be an object.");
    return;
  }
  strictKeys(
    language,
    BASE_LANGUAGE_KEYS,
    BASE_LANGUAGE_KEYS,
    "baseLanguage",
    "base.language",
    issues
  );
  const languageTag = canonicalLanguageTag(
    language.languageTag,
    "baseLanguage.languageTag",
    issues
  );
  if (languagePrimary(languageTag) === ENGLISH_AUDIT_LANGUAGE) {
    addIssue(
      issues,
      "base.redundant",
      "A learner-base overlay must not duplicate the authoritative English concept catalog."
    );
  }
  if (typeof language.script !== "string" || !/^[A-Z][a-z]{3}$/u.test(language.script)) {
    addIssue(issues, "base.language", "baseLanguage.script must be an ISO 15924-style code.");
  } else if (languageTag) {
    const localeScript = new Intl.Locale(languageTag).maximize().script;
    if (!localeScript) {
      addIssue(
        issues,
        "base.language",
        `baseLanguage.script cannot be inferred from ${languageTag}.`
      );
    } else if (localeScript !== language.script) {
      addIssue(
        issues,
        "base.language",
        `baseLanguage.script must match the maximized script ${localeScript} for ${languageTag}.`
      );
    }
  }
}

function validateReview(review, issues, { requireNativeReview }) {
  if (!isObject(review)) {
    addIssue(issues, "base.review", "Learner-base review must be an object.");
    return;
  }
  strictKeys(review, REVIEW_KEYS, REVIEW_KEYS, "review", "base.review", issues);
  if (!["native-review-required", "native-reviewed"].includes(review.status)) {
    addIssue(issues, "base.review", "review.status must use a supported native-review state.");
  }
  if (!isNonEmptyString(review.notes)) {
    addIssue(issues, "base.review", "review.notes must be non-empty.");
  }
  if (review.status === "native-reviewed") {
    if (!isNonEmptyString(review.reviewer) || !isIsoDateTime(review.reviewedAt)) {
      addIssue(
        issues,
        "base.review",
        "Native-reviewed base content requires reviewer and reviewedAt evidence."
      );
    }
  } else if (review.reviewer !== null || review.reviewedAt !== null) {
    addIssue(
      issues,
      "base.review",
      "Pending learner-base review must not name completed review evidence."
    );
  }
  if (requireNativeReview && review.status !== "native-reviewed") {
    addIssue(
      issues,
      "base.activation-native-review",
      "Course activation requires native-reviewed learner-base realizations."
    );
  }
}

function validateLicense(license, issues, { release }) {
  if (!isObject(license)) {
    addIssue(issues, "base.license", "Learner-base license must be an object.");
    return;
  }
  strictKeys(license, LICENSE_KEYS, LICENSE_KEYS, "license", "base.license", issues);
  if (!isNonEmptyString(license.origin)) {
    addIssue(issues, "base.license", "license.origin must be non-empty.");
  }
  if (!["release-review-required", "release-cleared"].includes(license.status)) {
    addIssue(issues, "base.license", "license.status must use a supported release state.");
  }
  if (license.status === "release-cleared") {
    for (const field of ["spdxExpression", "sourceReference", "reviewedBy"]) {
      if (!isNonEmptyString(license[field])) {
        addIssue(issues, "base.license", `Release-cleared base content requires ${field}.`);
      }
    }
    if (!isIsoDateTime(license.reviewedAt)) {
      addIssue(issues, "base.license", "Release-cleared base content requires reviewedAt.");
    }
  } else if (license.status === "release-review-required") {
    for (const field of ["spdxExpression", "sourceReference", "reviewedBy", "reviewedAt"]) {
      if (license[field] !== null) {
        addIssue(
          issues,
          "base.license",
          `license.${field} must remain null until learner-base licensing is cleared.`
        );
      }
    }
  }
  if (release && license.status !== "release-cleared") {
    addIssue(
      issues,
      "base.release-license",
      "Release requires release-cleared learner-base content."
    );
  }
}

function normalizeSourceLanguage(sourceLanguage) {
  const value = typeof sourceLanguage === "string"
    ? sourceLanguage
    : sourceLanguage?.locale ?? sourceLanguage?.id;
  const issues = [];
  const languageTag = canonicalLanguageTag(value, "sourceLanguage.locale", issues);
  finish(issues);
  return { languageTag };
}

function canonicalLanguageTag(value, label, issues) {
  if (!isNonEmptyString(value)) {
    addIssue(issues, "base.language", `${label} must be a valid BCP 47 language tag.`);
    return null;
  }
  try {
    const canonical = Intl.getCanonicalLocales(value)[0];
    if (canonical !== value) {
      addIssue(issues, "base.language", `${label} must use canonical form ${canonical}.`);
    }
    return canonical;
  } catch {
    addIssue(issues, "base.language", `${label} must be a valid BCP 47 language tag.`);
    return null;
  }
}

function languagePrimary(languageTag) {
  if (!languageTag) return null;
  try {
    return new Intl.Locale(languageTag).language;
  } catch {
    return null;
  }
}

function strictKeys(value, allowed, required, label, code, issues) {
  if (!isObject(value)) return;
  for (const key of required) {
    if (!Object.hasOwn(value, key)) addIssue(issues, code, `${label} is missing ${key}.`);
  }
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) addIssue(issues, code, `${label} contains unsupported field ${key}.`);
  }
}

function addDuplicateIssues(values, issues, code, label) {
  const seen = new Set();
  for (const value of values) {
    if (seen.has(value)) addIssue(issues, code, `Duplicate ${label}: ${value}.`);
    seen.add(value);
  }
}

function formatIds(ids) {
  const shown = ids.slice(0, 5).join(", ");
  return ids.length > 5 ? `${shown}, and ${ids.length - 5} more concept IDs` : shown;
}

function normalizeRepositoryPath(value, label) {
  if (!isNonEmptyString(value)) throw new TypeError(`${label} must be a repository-relative path.`);
  const normalized = value.replaceAll("\\", "/");
  if (path.posix.isAbsolute(normalized) || hasUnsafePathSegment(normalized)) {
    throw new TypeError(`${label} must remain inside the repository.`);
  }
  return normalized;
}

function hasUnsafePathSegment(value) {
  return String(value).split("/").some((segment) => !segment || segment === "." || segment === "..");
}

function resolveWithin(root, relativePath) {
  const resolved = path.resolve(root, ...relativePath.split("/"));
  const relative = path.relative(root, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new TypeError("Repository path escapes the workspace.");
  }
  return resolved;
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (
    relative !== ".."
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative)
  );
}

function expectedPhysicalPath(lexicalRoot, realRoot, lexicalPath) {
  return path.resolve(realRoot, path.relative(path.resolve(lexicalRoot), path.resolve(lexicalPath)));
}

function samePath(left, right) {
  return path.relative(path.resolve(left), path.resolve(right)) === "";
}

function roleAuthorityRoot(root, relativePath, role) {
  if (role === "concepts" && SOURCE_CATALOG_PATTERN.test(relativePath)) {
    return resolveWithin(root, "apps/languages/shared/english-concepts");
  }
  if (role === "learnerBaseRealizations" && LEARNER_BASE_CATALOG_PATTERN.test(relativePath)) {
    return resolveWithin(root, "apps/languages/shared/learner-base-realizations");
  }
  const targetMatch = role === "targetRealizations"
    ? relativePath.match(TARGET_CATALOG_PATTERN)
    : null;
  if (targetMatch) {
    return resolveWithin(root, `apps/languages/${targetMatch[1]}/content`);
  }
  throw new TypeError(`${role}Path is outside its declared language-content authority root.`);
}

async function resolveRealRoleFile(root, relativePath, role) {
  const lexicalFile = resolveWithin(root, relativePath);
  const lexicalAuthorityRoot = roleAuthorityRoot(root, relativePath, role);
  try {
    const [realRepoRoot, realAuthorityRoot, realFile] = await Promise.all([
      realpath(root),
      realpath(lexicalAuthorityRoot),
      realpath(lexicalFile)
    ]);
    const [authorityInfo, fileInfo] = await Promise.all([
      stat(realAuthorityRoot),
      stat(realFile)
    ]);
    const expectedRealAuthorityRoot = expectedPhysicalPath(
      root,
      realRepoRoot,
      lexicalAuthorityRoot
    );
    const expectedRealFile = expectedPhysicalPath(root, realRepoRoot, lexicalFile);
    if (
      !authorityInfo.isDirectory()
      || !fileInfo.isFile()
      || !isInside(realRepoRoot, realAuthorityRoot)
      || !isInside(realAuthorityRoot, realFile)
      || !samePath(realAuthorityRoot, expectedRealAuthorityRoot)
      || !samePath(realFile, expectedRealFile)
    ) {
      throw new TypeError(`${role}Path resolves outside its declared language-content authority root.`);
    }
    return realFile;
  } catch (error) {
    if (error instanceof TypeError) throw error;
    throw new TypeError(
      `${relativePath}: cannot resolve a confined content file (${error.code ?? error.message}).`
    );
  }
}

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    throw new TypeError(`${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function isNonEmptyString(value) {
  return typeof value === "string" && Boolean(value.trim());
}

function isIsoDateTime(value) {
  return isNonEmptyString(value) && !Number.isNaN(Date.parse(value));
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const item of Object.values(value)) deepFreeze(item);
  return Object.freeze(value);
}

function addIssue(issues, code, message) {
  issues.push({ code, message });
}

function finish(issues) {
  if (issues.length > 0) throw new LanguageRoleError(issues);
}
