import { isDeepStrictEqual } from "node:util";

import { validateLearnerBaseRealizations } from "./language-role-contract.mjs";

export const LEARNER_BASE_RUNTIME_SCHEMA =
  "https://caatuu.org/schemas/runtime/learner-base-realizations.runtime.v1.schema.json";

const RUNTIME_KEYS = [
  "$schema",
  "schemaVersion",
  "id",
  "baseLanguage",
  "derivedFrom",
  "sourceCatalog",
  "review",
  "license",
  "realizations"
];
const REALIZATION_KEYS = ["conceptId", "text"];
const BASE_LANGUAGE_KEYS = ["languageTag", "script"];
const REVIEW_KEYS = ["status", "reviewer", "reviewedAt", "notes"];
const LICENSE_KEYS = [
  "origin",
  "status",
  "spdxExpression",
  "sourceReference",
  "reviewedBy",
  "reviewedAt"
];
const CONCEPT_ID_PATTERN = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/u;
const SOURCE_CATALOG_PATTERN =
  /^apps\/languages\/shared\/english-concepts\/[a-z0-9][a-z0-9.-]*\.json$/u;

export class LanguageRoleRuntimeError extends Error {
  constructor(issues) {
    super(`Learner-base runtime projection validation failed:\n${issues.map((issue) => `- ${issue}`).join("\n")}`);
    this.name = "LanguageRoleRuntimeError";
    this.issues = issues;
  }
}

export function buildLearnerBaseRuntimeProjection(
  concepts,
  baseRealizations,
  { derivedFrom }
) {
  validateLearnerBaseRealizations(concepts, baseRealizations);
  if (!nonEmpty(derivedFrom)) {
    throw new TypeError("derivedFrom must name the learner-base authoring path.");
  }
  assertRepositoryPath(derivedFrom, "derivedFrom");
  const projection = {
    $schema: LEARNER_BASE_RUNTIME_SCHEMA,
    schemaVersion: baseRealizations.schemaVersion,
    id: baseRealizations.id,
    baseLanguage: cloneJson(baseRealizations.baseLanguage),
    derivedFrom,
    sourceCatalog: baseRealizations.sourceCatalog,
    review: cloneJson(baseRealizations.review),
    license: cloneJson(baseRealizations.license),
    realizations: baseRealizations.realizations.map(({ conceptId, text }) => ({
      conceptId,
      text
    }))
  };
  validateLearnerBaseRuntimeProjection(projection, {
    source: baseRealizations,
    expectedDerivedFrom: derivedFrom
  });
  return deepFreeze(projection);
}

export function validateLearnerBaseRuntimeProjection(projection, {
  source = null,
  expectedDerivedFrom = null
} = {}) {
  const issues = [];
  strictKeys(projection, RUNTIME_KEYS, RUNTIME_KEYS, "projection", issues);
  if (projection?.$schema !== LEARNER_BASE_RUNTIME_SCHEMA) {
    issues.push(`$schema must be ${LEARNER_BASE_RUNTIME_SCHEMA}.`);
  }
  if (projection?.schemaVersion !== 1) issues.push("schemaVersion must be 1.");
  if (!nonEmpty(projection?.id)) issues.push("id must be non-empty.");
  if (!nonEmpty(projection?.derivedFrom)) issues.push("derivedFrom must be non-empty.");
  else validateRepositoryPath(projection.derivedFrom, "derivedFrom", issues);
  if (expectedDerivedFrom && projection?.derivedFrom !== expectedDerivedFrom) {
    issues.push(`derivedFrom must be ${expectedDerivedFrom}.`);
  }
  strictKeys(
    projection?.baseLanguage,
    BASE_LANGUAGE_KEYS,
    BASE_LANGUAGE_KEYS,
    "baseLanguage",
    issues
  );
  let canonicalBaseLanguage = null;
  if (!nonEmpty(projection?.baseLanguage?.languageTag)) {
    issues.push("baseLanguage.languageTag must be non-empty.");
  } else {
    try {
      const canonical = Intl.getCanonicalLocales(projection.baseLanguage.languageTag)[0];
      canonicalBaseLanguage = canonical;
      if (canonical !== projection.baseLanguage.languageTag) {
        issues.push(`baseLanguage.languageTag must use canonical form ${canonical}.`);
      }
      if (new Intl.Locale(canonical).language === "en") {
        issues.push("baseLanguage.languageTag must be non-English.");
      }
    } catch {
      issues.push("baseLanguage.languageTag must be a valid BCP 47 language tag.");
    }
  }
  const declaredBaseScript = String(projection?.baseLanguage?.script ?? "");
  if (!/^[A-Z][a-z]{3}$/u.test(declaredBaseScript)) {
    issues.push("baseLanguage.script must be an ISO 15924-style code.");
  } else if (canonicalBaseLanguage) {
    const maximizedScript = new Intl.Locale(canonicalBaseLanguage).maximize().script;
    if (!maximizedScript) {
      issues.push(`baseLanguage.script cannot be inferred from ${canonicalBaseLanguage}.`);
    } else if (declaredBaseScript !== maximizedScript) {
      issues.push(
        `baseLanguage.script must match the maximized script ${maximizedScript} for ${canonicalBaseLanguage}.`
      );
    }
  }
  if (!SOURCE_CATALOG_PATTERN.test(String(projection?.sourceCatalog ?? ""))) {
    issues.push("sourceCatalog must name a shared English concept catalog.");
  }
  strictKeys(projection?.review, REVIEW_KEYS, REVIEW_KEYS, "review", issues);
  if (!["native-review-required", "native-reviewed"].includes(projection?.review?.status)) {
    issues.push("review.status must use a supported native-review state.");
  }
  strictKeys(projection?.license, LICENSE_KEYS, LICENSE_KEYS, "license", issues);
  if (!["release-review-required", "release-cleared"].includes(projection?.license?.status)) {
    issues.push("license.status must use a supported release state.");
  }
  if (!Array.isArray(projection?.realizations) || projection.realizations.length === 0) {
    issues.push("realizations must be a non-empty array.");
  } else {
    const ids = new Set();
    for (const [index, realization] of projection.realizations.entries()) {
      const label = `realizations[${index}]`;
      strictKeys(realization, REALIZATION_KEYS, REALIZATION_KEYS, label, issues);
      if (!CONCEPT_ID_PATTERN.test(String(realization?.conceptId ?? ""))) {
        issues.push(`${label}.conceptId is invalid.`);
      } else if (ids.has(realization.conceptId)) {
        issues.push(`Duplicate learner-base concept ID: ${realization.conceptId}.`);
      } else {
        ids.add(realization.conceptId);
      }
      if (!nonEmpty(realization?.text)) issues.push(`${label}.text must be non-empty.`);
    }
  }
  if (source) {
    const expected = {
      $schema: LEARNER_BASE_RUNTIME_SCHEMA,
      schemaVersion: source.schemaVersion,
      id: source.id,
      baseLanguage: cloneJson(source.baseLanguage),
      derivedFrom: projection?.derivedFrom,
      sourceCatalog: source.sourceCatalog,
      review: cloneJson(source.review),
      license: cloneJson(source.license),
      realizations: source.realizations.map(({ conceptId, text }) => ({ conceptId, text }))
    };
    if (!isDeepStrictEqual(projection, expected)) {
      issues.push("Projection must be a faithful, narrow copy of learner-base authoring.");
    }
  }
  if (issues.length > 0) throw new LanguageRoleRuntimeError(issues);
  return projection;
}

function strictKeys(value, allowed, required, label, issues) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    issues.push(`${label} must be an object.`);
    return;
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) issues.push(`${label} is missing ${key}.`);
  }
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) issues.push(`${label} contains unsupported field ${key}.`);
  }
}

function nonEmpty(value) {
  return typeof value === "string" && Boolean(value.trim());
}

function assertRepositoryPath(value, label) {
  const issues = [];
  validateRepositoryPath(value, label, issues);
  if (issues.length > 0) throw new TypeError(issues.join(" "));
}

function validateRepositoryPath(value, label, issues) {
  const normalized = String(value ?? "").replaceAll("\\", "/");
  if (
    !normalized.startsWith("apps/languages/")
    || normalized.split("/").some((segment) => !segment || segment === "." || segment === "..")
  ) {
    issues.push(`${label} must be a confined language-content authoring path.`);
  }
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const item of Object.values(value)) deepFreeze(item);
  return Object.freeze(value);
}
