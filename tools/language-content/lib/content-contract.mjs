import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validatePolicyIssues } from "../policies/contract.mjs";
import { resolveTargetContentPolicy } from "../policies/registry.mjs";

export const ENGLISH_CONCEPT_SCHEMA_VERSION = 1;
export const TARGET_REALIZATIONS_SCHEMA_VERSION = 1;
export const ENGLISH_AUDIT_LANGUAGE = "en";
export const ENGLISH_EMBEDDING_LANGUAGE = ENGLISH_AUDIT_LANGUAGE;
export const ENGLISH_EMBEDDING_FIELD = "embeddingText";
export const ENGLISH_EMBEDDING_POLICY = "embeddingText_only";
export const AUTHORED_TOKENIZATION_METHOD = "authored-word-tokens";

export const DEFAULT_CONCEPTS_PATH =
  "apps/languages/shared/english-concepts/word-world-starter-v1.json";
export const DEFAULT_REALIZATIONS_PATH =
  "apps/languages/mandarin-simplified/content/word-world/starter-v1.realizations.json";

const DEFAULT_REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const CATALOG_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*-v[1-9][0-9]*$/u;
const COURSE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const CONCEPT_ID_PATTERN = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/u;
const TOPIC_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const SOURCE_CATALOG_PATTERN = /^apps\/languages\/shared\/english-concepts\/[a-z0-9][a-z0-9.-]*\.json$/u;
const LETTER_PATTERN = /\p{Letter}/u;
const LATIN_LETTER_PATTERN = /\p{Script=Latin}/u;
const MARK_PATTERN = /\p{Mark}/u;
const PUNCTUATION_OR_SPACE_PATTERN = /[\p{White_Space}\p{Punctuation}]/gu;
const FORBIDDEN_EMBEDDING_KEYS = new Set([
  "gloss",
  "linguisticmetadata",
  "pronunciation",
  "pronunciationjson",
  "targetmetadata",
  "targettext",
  "tokens",
  "tokenspans"
]);

const ENGLISH_CATALOG_KEYS = [
  "$schema",
  "schemaVersion",
  "id",
  "language",
  "embeddingPolicy",
  "license",
  "concepts"
];
const ENGLISH_CONCEPT_KEYS = [
  "id",
  "englishText",
  "embeddingText",
  "sceneQuery",
  "topic",
  "difficulty"
];
const TARGET_CATALOG_KEYS = [
  "$schema",
  "schemaVersion",
  "courseId",
  "targetLanguage",
  "sourceCatalog",
  "contentPolicy",
  "tokenization",
  "review",
  "license",
  "realizations"
];
const REALIZATION_KEYS = ["conceptId", "text", "pronunciation", "tokens"];
const TOKEN_KEYS = ["surface", "pronunciation", "gloss", "playable", "readingUnits"];
const TOKEN_REQUIRED_KEYS = ["surface", "pronunciation", "gloss", "playable"];
const READING_UNIT_KEYS = ["surface", "pronunciation"];
const PRONUNCIATION_KEYS = ["system", "notation", "languageTag", "reviewed"];

export class LanguageContentError extends Error {
  constructor(issues) {
    const details = issues.map(({ code, message }) => `- [${code}] ${message}`).join("\n");
    super(`Language-content contract validation failed:\n${details}`);
    this.name = "LanguageContentError";
    this.issues = issues;
  }
}

export function validateLanguageContent(
  concepts,
  realizations,
  { release = false, requireNativeReview = false, contentPolicy = null } = {}
) {
  // Distribution licensing and native-language approval are deliberately
  // independent: disclosed draft courses may ship before they are activated.
  const issues = [];
  validateEnglishConceptCatalog(concepts, issues, { release });
  validateTargetRealizationCatalog(realizations, issues, {
    release,
    requireNativeReview,
    contentPolicy
  });
  validateCatalogPair(concepts, realizations, issues);

  if (issues.length > 0) throw new LanguageContentError(issues);

  const embeddingInputs = buildEmbeddingInputs(concepts);
  const embeddingDocuments = buildEmbeddingDocuments(concepts);
  validateEmbeddingIsolation(embeddingDocuments, realizations, issues);
  if (issues.length > 0) throw new LanguageContentError(issues);

  return deepFreeze({
    concepts,
    realizations,
    embeddingInputs,
    embeddingDocuments
  });
}

export function prepareEnglishEmbeddingInputs(concepts) {
  const issues = [];
  validateEnglishConceptCatalog(concepts, issues, { release: false });
  if (issues.length > 0) throw new LanguageContentError(issues);
  return deepFreeze(buildEmbeddingInputs(concepts));
}

export function prepareEnglishEmbeddingDocuments(concepts) {
  const issues = [];
  validateEnglishConceptCatalog(concepts, issues, { release: false });
  if (issues.length > 0) throw new LanguageContentError(issues);
  const documents = buildEmbeddingDocuments(concepts);
  validateEmbeddingIsolation(documents, null, issues);
  if (issues.length > 0) throw new LanguageContentError(issues);
  return deepFreeze(documents);
}

export function prepareSemanticRows(concepts, realizations, options = {}) {
  validateLanguageContent(concepts, realizations, options);
  const realizationByConcept = new Map(
    realizations.realizations.map((realization) => [realization.conceptId, realization])
  );
  return deepFreeze(concepts.concepts.map((concept) => {
    const realization = realizationByConcept.get(concept.id);
    return {
      id: concept.id,
      english_text: concept.embeddingText,
      english_display_text: concept.englishText,
      scene_query: concept.sceneQuery,
      topic: concept.topic,
      difficulty: concept.difficulty,
      target_text: realization.text,
      pronunciation: cloneJson(realization.pronunciation),
      tokens: cloneJson(realization.tokens),
      content_review: cloneJson(realizations.review),
      content_license: cloneJson(realizations.license),
      source_license: cloneJson(concepts.license)
    };
  }));
}

export async function loadAndValidateLanguageContent({
  repoRoot = DEFAULT_REPO_ROOT,
  conceptsPath = DEFAULT_CONCEPTS_PATH,
  realizationsPath = DEFAULT_REALIZATIONS_PATH,
  release = false,
  requireNativeReview = false,
  contentPolicy = null
} = {}) {
  const absoluteRoot = path.resolve(repoRoot instanceof URL ? fileURLToPath(repoRoot) : repoRoot);
  const normalizedConceptsPath = normalizeRepositoryPath(conceptsPath, "conceptsPath");
  const normalizedRealizationsPath = normalizeRepositoryPath(realizationsPath, "realizationsPath");
  const conceptsFile = resolveWithin(absoluteRoot, normalizedConceptsPath);
  const realizationsFile = resolveWithin(absoluteRoot, normalizedRealizationsPath);
  const [concepts, realizations] = await Promise.all([
    readJson(conceptsFile),
    readJson(realizationsFile)
  ]);
  if (realizations.sourceCatalog !== normalizedConceptsPath) {
    throw new LanguageContentError([{
      code: "coverage.source-catalog",
      message: `realizations.sourceCatalog must be ${normalizedConceptsPath}.`
    }]);
  }
  const prepared = validateLanguageContent(concepts, realizations, {
    release,
    requireNativeReview,
    contentPolicy
  });
  return deepFreeze({
    ...prepared,
    paths: {
      concepts: normalizedConceptsPath,
      realizations: normalizedRealizationsPath
    }
  });
}

export function normalizeSentenceForTokenComparison(value) {
  if (typeof value !== "string") return "";
  return value.normalize("NFKC").replace(PUNCTUATION_OR_SPACE_PATTERN, "");
}

function validateEnglishConceptCatalog(catalog, issues, { release }) {
  if (!isObject(catalog)) {
    addIssue(issues, "concepts.shape", "English concept catalog must be an object.");
    return;
  }
  addUnknownAndMissingKeys(issues, catalog, ENGLISH_CATALOG_KEYS, ENGLISH_CATALOG_KEYS, "concept catalog", "concepts.shape");
  if (typeof catalog.$schema !== "string" || !/english-concepts\.v1\.schema\.json$/u.test(catalog.$schema)) {
    addIssue(issues, "concepts.schema", "Concept catalog must reference english-concepts.v1.schema.json.");
  }
  if (catalog.schemaVersion !== ENGLISH_CONCEPT_SCHEMA_VERSION) {
    addIssue(issues, "concepts.version", `Concept schemaVersion must be ${ENGLISH_CONCEPT_SCHEMA_VERSION}.`);
  }
  if (typeof catalog.id !== "string" || !CATALOG_ID_PATTERN.test(catalog.id)) {
    addIssue(issues, "concepts.id", "Concept catalog id must be a stable versioned lowercase ID.");
  }
  if (catalog.language !== ENGLISH_AUDIT_LANGUAGE) {
    addIssue(issues, "embedding.policy", "Concept catalog language must be en.");
  }
  validateEmbeddingPolicy(catalog.embeddingPolicy, issues);
  validateLicenseGate(catalog.license, issues, "concept catalog", { release });
  if (!Array.isArray(catalog.concepts) || catalog.concepts.length === 0) {
    addIssue(issues, "concepts.shape", "Concept catalog must contain at least one concept.");
    return;
  }

  const ids = [];
  for (const [index, concept] of catalog.concepts.entries()) {
    const label = `concepts[${index}]`;
    if (!isObject(concept)) {
      addIssue(issues, "concepts.shape", `${label} must be an object.`);
      continue;
    }
    scanForbiddenEmbeddingKeys(concept, issues, label);
    addUnknownAndMissingKeys(issues, concept, ENGLISH_CONCEPT_KEYS, ENGLISH_CONCEPT_KEYS, label, "concepts.shape");
    if (typeof concept.id !== "string" || !CONCEPT_ID_PATTERN.test(concept.id)) {
      addIssue(issues, "concepts.id", `${label}.id must be a stable namespaced concept ID.`);
    } else {
      ids.push(concept.id);
    }
    for (const field of ["englishText", ENGLISH_EMBEDDING_FIELD, "sceneQuery"]) {
      if (!isNonEmptyString(concept[field])) {
        addIssue(issues, "concepts.shape", `${label}.${field} must be a non-empty string.`);
      } else if (containsUnsupportedEnglishAuthorityCharacters(concept[field])) {
        addIssue(issues, "embedding.leakage", `${label}.${field} violates the conservative English-authority character policy.`);
      }
    }
    if (typeof concept.topic !== "string" || !TOPIC_PATTERN.test(concept.topic)) {
      addIssue(issues, "concepts.shape", `${label}.topic must be a lowercase topic ID.`);
    }
    if (!Number.isInteger(concept.difficulty) || concept.difficulty < 1 || concept.difficulty > 5) {
      addIssue(issues, "concepts.shape", `${label}.difficulty must be an integer from 1 to 5.`);
    }
  }
  addDuplicateIssues(ids, issues, "concepts.duplicate", "concept ID");
}

function validateEmbeddingPolicy(policy, issues) {
  const label = "embeddingPolicy";
  const keys = ["inputLanguage", "inputField", "targetTextAllowed"];
  if (!isObject(policy)) {
    addIssue(issues, "embedding.policy", `${label} must be an object.`);
    return;
  }
  addUnknownAndMissingKeys(issues, policy, keys, keys, label, "embedding.policy");
  if (policy.inputLanguage !== ENGLISH_EMBEDDING_LANGUAGE) {
    addIssue(issues, "embedding.policy", `${label}.inputLanguage must be en.`);
  }
  if (policy.inputField !== ENGLISH_EMBEDDING_FIELD) {
    addIssue(issues, "embedding.policy", `${label}.inputField must be embeddingText.`);
  }
  if (policy.targetTextAllowed !== false) {
    addIssue(issues, "embedding.policy", `${label}.targetTextAllowed must be false.`);
  }
}

function validateTargetRealizationCatalog(
  catalog,
  issues,
  { release, requireNativeReview, contentPolicy }
) {
  if (!isObject(catalog)) {
    addIssue(issues, "realizations.shape", "Target realization catalog must be an object.");
    return;
  }
  addUnknownAndMissingKeys(issues, catalog, TARGET_CATALOG_KEYS, TARGET_CATALOG_KEYS, "target catalog", "realizations.shape");
  if (typeof catalog.$schema !== "string" || !/target-realizations\.v1\.schema\.json$/u.test(catalog.$schema)) {
    addIssue(issues, "realizations.schema", "Target catalog must reference target-realizations.v1.schema.json.");
  }
  if (catalog.schemaVersion !== TARGET_REALIZATIONS_SCHEMA_VERSION) {
    addIssue(issues, "realizations.version", `Target schemaVersion must be ${TARGET_REALIZATIONS_SCHEMA_VERSION}.`);
  }
  if (typeof catalog.courseId !== "string" || !COURSE_ID_PATTERN.test(catalog.courseId)) {
    addIssue(issues, "realizations.course", "Target courseId must be a lowercase course ID.");
  }
  validateTargetLanguage(catalog.targetLanguage, issues);
  if (typeof catalog.sourceCatalog !== "string" || !SOURCE_CATALOG_PATTERN.test(catalog.sourceCatalog) || hasUnsafePathSegment(catalog.sourceCatalog)) {
    addIssue(issues, "coverage.source-catalog", "sourceCatalog must be a confined shared English concept-catalog path.");
  }
  if (typeof catalog.contentPolicy !== "string" || !CATALOG_ID_PATTERN.test(catalog.contentPolicy)) {
    addIssue(issues, "policy.invalid", "contentPolicy must name a stable versioned target-content policy.");
  }
  validateTokenization(catalog.tokenization, issues);
  validateReviewGate(catalog.review, issues, { requireNativeReview });
  validateLicenseGate(catalog.license, issues, "target catalog", { release });

  if (!Array.isArray(catalog.realizations) || catalog.realizations.length === 0) {
    addIssue(issues, "realizations.shape", "Target catalog must contain at least one realization.");
    return;
  }
  const ids = [];
  for (const [index, realization] of catalog.realizations.entries()) {
    const label = `realizations[${index}]`;
    if (!isObject(realization)) {
      addIssue(issues, "realizations.shape", `${label} must be an object.`);
      continue;
    }
    addUnknownAndMissingKeys(issues, realization, REALIZATION_KEYS, REALIZATION_KEYS, label, "realizations.shape");
    if (typeof realization.conceptId !== "string" || !CONCEPT_ID_PATTERN.test(realization.conceptId)) {
      addIssue(issues, "realizations.id", `${label}.conceptId must be a stable namespaced concept ID.`);
    } else {
      ids.push(realization.conceptId);
    }
    if (!isNonEmptyString(realization.text)) {
      addIssue(issues, "realizations.shape", `${label}.text must be a non-empty target sentence.`);
    }
    validatePronunciation(realization.pronunciation, `${label}.pronunciation`, issues);
    validateTokens(realization, label, issues);
  }
  addDuplicateIssues(ids, issues, "realizations.duplicate", "realization concept ID");
  validatePronunciationReviewConsistency(catalog, issues);
  validateSelectedContentPolicy(catalog, contentPolicy, issues);
}

function validateTargetLanguage(language, issues) {
  const keys = ["languageTag", "speechLocale", "script"];
  if (!isObject(language)) {
    addIssue(issues, "locale.invalid", "targetLanguage must be an object.");
    return;
  }
  addUnknownAndMissingKeys(issues, language, keys, keys, "targetLanguage", "locale.invalid");
  const languageTag = canonicalLocale(language.languageTag, "targetLanguage.languageTag", issues);
  const speechLocale = canonicalLocale(language.speechLocale, "targetLanguage.speechLocale", issues);
  if (typeof language.script !== "string" || !/^[A-Z][a-z]{3}$/u.test(language.script)) {
    addIssue(issues, "locale.invalid", "targetLanguage.script must be an ISO 15924-style script code.");
  }
  if (languageTag && speechLocale && languageTag.split("-")[0] !== speechLocale.split("-")[0]) {
    addIssue(issues, "locale.mismatch", "Target language and speech locale must share a base language.");
  }
  if (languageTag && typeof language.script === "string") {
    const localeScript = new Intl.Locale(languageTag).script;
    if (localeScript && localeScript !== language.script) {
      addIssue(issues, "locale.mismatch", `targetLanguage.script must match ${languageTag}.`);
    }
  }
}

function validateTokenization(tokenization, issues) {
  const keys = ["method", "characterFallbackAllowed", "pronunciationAuthority"];
  if (!isObject(tokenization)) {
    addIssue(issues, "tokenization.authority", "tokenization must be an object.");
    return;
  }
  addUnknownAndMissingKeys(issues, tokenization, keys, keys, "tokenization", "tokenization.authority");
  if (tokenization.method !== AUTHORED_TOKENIZATION_METHOD) {
    addIssue(issues, "tokenization.authority", "Tokenization must use authored-word-tokens, never implicit character splitting.");
  }
  if (tokenization.characterFallbackAllowed !== false) {
    addIssue(issues, "tokenization.authority", "Character fallback must remain disabled.");
  }
  if (tokenization.pronunciationAuthority !== "authored-contextual-token") {
    addIssue(issues, "tokenization.authority", "Pronunciation must be authored for each contextual token; codepoint inference is unsupported.");
  }
}

function validateTokens(realization, label, issues) {
  if (!Array.isArray(realization.tokens) || realization.tokens.length === 0) {
    addIssue(issues, "tokenization.missing", `${label}.tokens must contain authored word tokens.`);
    return;
  }
  let playableCount = 0;
  for (const [tokenIndex, token] of realization.tokens.entries()) {
    const tokenLabel = `${label}.tokens[${tokenIndex}]`;
    if (!isObject(token)) {
      addIssue(issues, "tokenization.shape", `${tokenLabel} must be an object.`);
      continue;
    }
    addUnknownAndMissingKeys(
      issues,
      token,
      TOKEN_KEYS,
      TOKEN_REQUIRED_KEYS,
      tokenLabel,
      "tokenization.shape"
    );
    if (!isNonEmptyString(token.surface)) {
      addIssue(issues, "tokenization.shape", `${tokenLabel}.surface must be non-empty.`);
    }
    validatePronunciation(token.pronunciation, `${tokenLabel}.pronunciation`, issues);
    if (!isNonEmptyString(token.gloss)) {
      addIssue(issues, "tokenization.gloss", `${tokenLabel}.gloss must be a non-empty mediation-language gloss.`);
    }
    if (typeof token.playable !== "boolean") {
      addIssue(issues, "playable.invalid", `${tokenLabel}.playable must be boolean.`);
    } else if (token.playable) {
      playableCount += 1;
      if (!isNonEmptyString(token.surface) || !isNonEmptyString(token.gloss)) {
        addIssue(issues, "playable.invalid", `${tokenLabel} requires surface and gloss to be playable.`);
      }
    }
    validateReadingUnits(token, tokenLabel, issues);
  }
  if (playableCount === 0) {
    addIssue(issues, "playable.empty", `${label} must expose at least one playable token candidate.`);
  }

  const normalizedSentence = normalizeSentenceForTokenComparison(realization.text);
  const normalizedTokens = normalizeSentenceForTokenComparison(
    realization.tokens
      .filter(isObject)
      .map((token) => typeof token.surface === "string" ? token.surface : "")
      .join("")
  );
  if (!normalizedSentence || normalizedTokens !== normalizedSentence) {
    addIssue(
      issues,
      "tokenization.coverage",
      `${label} authored token surfaces must concatenate to the target sentence after punctuation and space normalization.`
    );
  }
}

function validateReadingUnits(token, tokenLabel, issues) {
  if (!Object.hasOwn(token, "readingUnits")) return;
  if (!Array.isArray(token.readingUnits) || token.readingUnits.length === 0) {
    addIssue(issues, "reading-units.shape", `${tokenLabel}.readingUnits must be a non-empty array when present.`);
    return;
  }
  for (const [unitIndex, unit] of token.readingUnits.entries()) {
    const unitLabel = `${tokenLabel}.readingUnits[${unitIndex}]`;
    if (!isObject(unit)) {
      addIssue(issues, "reading-units.shape", `${unitLabel} must be an object.`);
      continue;
    }
    addUnknownAndMissingKeys(
      issues,
      unit,
      READING_UNIT_KEYS,
      READING_UNIT_KEYS,
      unitLabel,
      "reading-units.shape"
    );
    if (!isNonEmptyString(unit.surface)) {
      addIssue(issues, "reading-units.shape", `${unitLabel}.surface must be non-empty.`);
    }
    validatePronunciation(unit.pronunciation, `${unitLabel}.pronunciation`, issues);
  }
  const readingSurface = token.readingUnits
    .filter(isObject)
    .map((unit) => typeof unit.surface === "string" ? unit.surface : "")
    .join("");
  if (readingSurface !== token.surface) {
    addIssue(
      issues,
      "reading-units.coverage",
      `${tokenLabel}.readingUnits surfaces must reproduce the authored token surface exactly.`
    );
  }
}

function validatePronunciation(pronunciation, label, issues) {
  if (pronunciation === null) return;
  if (!isObject(pronunciation)) {
    addIssue(issues, "pronunciation.invalid", `${label} must be a pronunciation object or null.`);
    return;
  }
  addUnknownAndMissingKeys(
    issues,
    pronunciation,
    PRONUNCIATION_KEYS,
    PRONUNCIATION_KEYS,
    label,
    "pronunciation.invalid"
  );
  if (typeof pronunciation.system !== "string"
      || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(pronunciation.system)) {
    addIssue(issues, "pronunciation.invalid", `${label}.system must be a lowercase pronunciation-system ID.`);
  }
  if (!isNonEmptyString(pronunciation.notation)) {
    addIssue(issues, "pronunciation.invalid", `${label}.notation must be a non-empty authored notation.`);
  }
  canonicalLocale(pronunciation.languageTag, `${label}.languageTag`, issues);
  if (typeof pronunciation.reviewed !== "boolean") {
    addIssue(issues, "pronunciation.invalid", `${label}.reviewed must be boolean.`);
  }
}

function validatePronunciationReviewConsistency(catalog, issues) {
  const expected = catalog?.review?.status === "native-reviewed"
    ? true
    : catalog?.review?.status === "native-review-required"
      ? false
      : null;
  if (expected === null || !Array.isArray(catalog?.realizations)) return;
  for (const [index, realization] of catalog.realizations.entries()) {
    const entries = [
      [`realizations[${index}].pronunciation`, realization?.pronunciation],
      ...(Array.isArray(realization?.tokens)
        ? realization.tokens.flatMap((token, tokenIndex) => [
            [
              `realizations[${index}].tokens[${tokenIndex}].pronunciation`,
              token?.pronunciation
            ],
            ...(Array.isArray(token?.readingUnits)
              ? token.readingUnits.map((unit, unitIndex) => [
                  `realizations[${index}].tokens[${tokenIndex}].readingUnits[${unitIndex}].pronunciation`,
                  unit?.pronunciation
                ])
              : [])
          ])
        : [])
    ];
    for (const [label, pronunciation] of entries) {
      if (pronunciation !== null && isObject(pronunciation) && pronunciation.reviewed !== expected) {
        addIssue(
          issues,
          "pronunciation.review-consistency",
          `${label}.reviewed must be ${expected} while catalog review.status is ${catalog.review.status}.`
        );
      }
    }
  }
}

function validateSelectedContentPolicy(catalog, explicitPolicy, issues) {
  const policy = explicitPolicy ?? resolveTargetContentPolicy(catalog?.contentPolicy);
  if (!policy) {
    addIssue(issues, "policy.unknown", `No target-content policy is registered for ${catalog?.contentPolicy ?? "<missing>"}.`);
    return;
  }
  if (typeof policy.id !== "string" || typeof policy.validate !== "function") {
    addIssue(issues, "policy.invalid", "The selected target-content policy is malformed.");
    return;
  }
  if (policy.id !== catalog?.contentPolicy) {
    addIssue(
      issues,
      "policy.mismatch",
      `Catalog contentPolicy ${catalog?.contentPolicy ?? "<missing>"} does not match selected policy ${policy.id}.`
    );
    return;
  }
  try {
    for (const policyIssue of validatePolicyIssues(policy.validate(catalog), policy.id)) {
      addIssue(issues, policyIssue.code, policyIssue.message);
    }
  } catch (error) {
    addIssue(issues, "policy.failure", `Target-content policy ${policy.id} failed: ${error.message}`);
  }
}

function validateReviewGate(review, issues, { requireNativeReview }) {
  const keys = ["status", "reviewer", "reviewedAt", "notes"];
  if (!isObject(review)) {
    addIssue(issues, "review.gate", "review must be an object.");
    return;
  }
  addUnknownAndMissingKeys(issues, review, keys, keys, "review", "review.gate");
  if (!["native-review-required", "native-reviewed"].includes(review.status)) {
    addIssue(issues, "review.gate", "review.status must be native-review-required or native-reviewed.");
  }
  if (!isNonEmptyString(review.notes)) {
    addIssue(issues, "review.gate", "review.notes must describe the review state.");
  }
  if (review.status === "native-review-required") {
    if (review.reviewer !== null || review.reviewedAt !== null) {
      addIssue(issues, "review.gate", "A native-review-required draft must not claim a reviewer or review date.");
    }
    if (requireNativeReview) {
      addIssue(
        issues,
        "activation.native-review",
        "Learner-course activation and approved authored pronunciation guidance require status native-reviewed."
      );
    }
  } else if (review.status === "native-reviewed") {
    if (!isNonEmptyString(review.reviewer) || !isIsoDateTime(review.reviewedAt)) {
      addIssue(issues, "review.gate", "A native-reviewed catalog requires a named reviewer and ISO review date.");
    }
  }
}

function validateLicenseGate(license, issues, label, { release }) {
  const keys = ["origin", "status", "spdxExpression", "sourceReference", "reviewedBy", "reviewedAt"];
  if (!isObject(license)) {
    addIssue(issues, "license.gate", `${label}.license must be an object.`);
    return;
  }
  addUnknownAndMissingKeys(issues, license, keys, keys, `${label}.license`, "license.gate");
  if (!isNonEmptyString(license.origin)) {
    addIssue(issues, "license.gate", `${label}.license.origin must be non-empty.`);
  }
  if (!["release-review-required", "release-cleared"].includes(license.status)) {
    addIssue(issues, "license.gate", `${label}.license.status is invalid.`);
  }
  if (license.status === "release-review-required") {
    for (const field of ["spdxExpression", "sourceReference", "reviewedBy", "reviewedAt"]) {
      if (license[field] !== null) {
        addIssue(issues, "license.gate", `${label}.license.${field} must remain null until licensing is cleared.`);
      }
    }
    if (release) addIssue(issues, "release.license", `${label} licensing is not release-cleared.`);
  } else if (license.status === "release-cleared") {
    for (const field of ["spdxExpression", "sourceReference", "reviewedBy"]) {
      if (!isNonEmptyString(license[field])) {
        addIssue(issues, "license.gate", `${label}.license.${field} is required when release-cleared.`);
      }
    }
    if (!isIsoDateTime(license.reviewedAt)) {
      addIssue(issues, "license.gate", `${label}.license.reviewedAt must be an ISO date-time when release-cleared.`);
    }
  }
}

function validateCatalogPair(concepts, realizations, issues) {
  if (!Array.isArray(concepts?.concepts) || !Array.isArray(realizations?.realizations)) return;
  const expectedSourceCatalog = typeof concepts.id === "string"
    ? `apps/languages/shared/english-concepts/${concepts.id}.json`
    : null;
  if (expectedSourceCatalog && realizations.sourceCatalog !== expectedSourceCatalog) {
    addIssue(
      issues,
      "coverage.source-catalog",
      `Target catalog must name its paired English source as ${expectedSourceCatalog}.`
    );
  }
  const conceptIds = new Set(concepts.concepts.map(({ id }) => id).filter((id) => typeof id === "string"));
  const realizationIds = new Set(realizations.realizations.map(({ conceptId }) => conceptId).filter((id) => typeof id === "string"));
  for (const conceptId of conceptIds) {
    if (!realizationIds.has(conceptId)) {
      addIssue(issues, "coverage.missing", `Missing target realization for ${conceptId}.`);
    }
  }
  for (const conceptId of realizationIds) {
    if (!conceptIds.has(conceptId)) {
      addIssue(issues, "coverage.extra", `Target realization ${conceptId} has no English concept.`);
    }
  }
}

function buildEmbeddingInputs(catalog) {
  return catalog.concepts.map((concept) => ({
    conceptId: concept.id,
    locale: ENGLISH_EMBEDDING_LANGUAGE,
    textField: ENGLISH_EMBEDDING_FIELD,
    inputPolicy: ENGLISH_EMBEDDING_POLICY,
    text: concept.embeddingText
  }));
}

function buildEmbeddingDocuments(catalog) {
  return catalog.concepts.map((concept) => ({
    id: `concept-en-${concept.id}`,
    sourceKind: "english-concept",
    sourceId: concept.id,
    locale: ENGLISH_EMBEDDING_LANGUAGE,
    body: concept.embeddingText,
    metadata: {
      catalogId: catalog.id,
      englishText: concept.englishText,
      sceneQuery: concept.sceneQuery,
      topic: concept.topic,
      difficulty: concept.difficulty
    }
  }));
}

function validateEmbeddingIsolation(documents, realizations, issues) {
  for (const [index, document] of documents.entries()) {
    if (document.locale !== ENGLISH_EMBEDDING_LANGUAGE) {
      addIssue(issues, "embedding.policy", `embeddingDocuments[${index}] locale must be en.`);
    }
    walkObject(document, (key, value, objectPath) => {
      if (key && isForbiddenEmbeddingKey(key)) {
        addIssue(issues, "embedding.leakage", `${objectPath} contains target-owned field ${key}.`);
      }
      if (typeof value === "string" && containsUnsupportedEnglishAuthorityCharacters(value)) {
        addIssue(issues, "embedding.leakage", `${objectPath} violates the conservative English-authority character policy.`);
      }
    });
  }
  if (!Array.isArray(realizations?.realizations)) return;
  const documentIds = new Set(documents.map(({ sourceId }) => sourceId));
  for (const realization of realizations.realizations) {
    if (!documentIds.has(realization.conceptId)) {
      addIssue(issues, "coverage.missing", `No isolated English embedding document exists for ${realization.conceptId}.`);
    }
  }
}

function scanForbiddenEmbeddingKeys(value, issues, label) {
  walkObject(value, (key, _item, objectPath) => {
    if (key && isForbiddenEmbeddingKey(key)) {
      addIssue(issues, "embedding.leakage", `${label}.${objectPath} contains forbidden target-owned field ${key}.`);
    }
  });
}

function isForbiddenEmbeddingKey(key) {
  return FORBIDDEN_EMBEDDING_KEYS.has(key.replace(/[^A-Za-z0-9]/gu, "").toLowerCase());
}

// This is intentionally only a conservative cross-script/diacritic tripwire.
// The English catalog authority, language declaration, and review establish
// language identity; character shape alone cannot distinguish Latin languages.
function containsUnsupportedEnglishAuthorityCharacters(value) {
  for (const character of value) {
    if (LETTER_PATTERN.test(character) && !LATIN_LETTER_PATTERN.test(character)) return true;
  }
  return MARK_PATTERN.test(value.normalize("NFD"));
}

function walkObject(value, callback, objectPath = "value") {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      callback(null, item, `${objectPath}[${index}]`);
      walkObject(item, callback, `${objectPath}[${index}]`);
    }
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    const itemPath = `${objectPath}.${key}`;
    callback(key, item, itemPath);
    walkObject(item, callback, itemPath);
  }
}

function canonicalLocale(value, label, issues) {
  if (!isNonEmptyString(value)) {
    addIssue(issues, "locale.invalid", `${label} must be a non-empty BCP 47 tag.`);
    return null;
  }
  try {
    const [canonical] = Intl.getCanonicalLocales(value);
    if (canonical !== value) {
      addIssue(issues, "locale.invalid", `${label} must use canonical BCP 47 spelling (${canonical}).`);
      return null;
    }
    return canonical;
  } catch {
    addIssue(issues, "locale.invalid", `${label} is not a valid BCP 47 tag.`);
    return null;
  }
}

function addUnknownAndMissingKeys(issues, value, allowed, required, label, code) {
  if (!isObject(value)) return;
  for (const key of required) {
    if (!Object.hasOwn(value, key)) addIssue(issues, code, `${label} is missing required field ${key}.`);
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

function addIssue(issues, code, message) {
  issues.push({ code, message });
}

function normalizeRepositoryPath(value, label) {
  if (!isNonEmptyString(value) || value.includes("\\") || value.startsWith("/") || hasUnsafePathSegment(value)) {
    throw new LanguageContentError([{
      code: "path.invalid",
      message: `${label} must be a confined repository-relative POSIX path.`
    }]);
  }
  return value;
}

function hasUnsafePathSegment(value) {
  return value.split("/").some((segment) => segment === "" || segment === "." || segment === "..");
}

function resolveWithin(root, relativePath) {
  const candidate = path.resolve(root, ...relativePath.split("/"));
  const relative = path.relative(root, candidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new LanguageContentError([{
      code: "path.invalid",
      message: `Resolved path leaves repository: ${relativePath}.`
    }]);
  }
  return candidate;
}

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    throw new LanguageContentError([{
      code: "json.invalid",
      message: `${file}: ${error.message}`
    }]);
  }
}

function isNonEmptyString(value) {
  return typeof value === "string" && Boolean(value.trim());
}

function isIsoDateTime(value) {
  return isNonEmptyString(value)
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u.test(value)
    && !Number.isNaN(Date.parse(value));
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
