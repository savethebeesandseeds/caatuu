import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const CURRICULUM_SCHEMA = "caatuu-canonical-curriculum-v1";
const PACK_SCHEMA = "caatuu-target-realization-pack-v1";
const APPROVAL_ATTESTATION_SCHEMA = "caatuu-target-pack-review-attestation-v1";
const REVIEW_CHECKLIST_VERSION = "caatuu-target-language-teacher-review-v1";
const ATTESTATION_CLOCK_SKEW_MS = 5 * 60 * 1000;
const STANDARD_STAGE_SEQUENCE = [
  "encounter",
  "comprehend",
  "discriminate",
  "retrieve",
  "supported-produce",
  "interact",
  "transfer",
  "delayed-retrieval"
];
const MAPPING_STATUSES = new Set(["direct", "multiword", "implicit", "incorporated", "split", "merged", "unavailable"]);
const OPPORTUNITY_OPERATIONS = new Set(["interpret", "discriminate", "retrieve", "produce", "respond"]);
const REVIEW_STATUSES = new Set(["prototype-not-human-approved", "human-approved", "rejected"]);
const SEMVER_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+$/;

const ALLOWED_CURRICULUM_KEYS = new Set([
  "schemaVersion", "curriculumId", "version", "specLocale", "title", "description",
  "planningPolicy", "learningStageSequence", "semanticDefinitions", "unitOrder", "units"
]);
const ALLOWED_PLANNING_KEYS = new Set([
  "maxNewSemanticConceptsPerSession", "maxNewTargetConstructionsPerSession",
  "repairRetryTaskGap", "delayedRetrievalMinimumSessionGap",
  "exposureCanQualifyForMastery", "solutionRevealCanQualifyForMastery"
]);
const ALLOWED_UNIT_KEYS = new Set([
  "id", "revision", "ordinal", "title", "description", "canDo", "semanticScope",
  "transferPolicy", "prerequisiteUnitIds", "requiredLearningStages", "masteryPolicy"
]);
const ALLOWED_PACK_KEYS = new Set([
  "schemaVersion", "packId", "version", "specLocale", "targetLocale", "supportLocales",
  "curriculum", "canonicalContractDigest", "unitOrder", "unitBindings", "skills",
  "utterances", "contexts"
]);
const ALLOWED_UNIT_BINDING_KEYS = new Set([
  "unitId", "canonicalRevision", "functionBindings", "frameBindings", "conceptBindings",
  "targetSkillIds", "utteranceIds", "contextIds", "realizationComplexity",
  "withinUnitScaffolds", "review"
]);
const FORBIDDEN_UNIT_OVERRIDE_KEYS = new Set([
  "ordinal", "title", "description", "canDo", "semanticScope", "transferPolicy",
  "prerequisiteUnitIds", "requiredLearningStages", "masteryPolicy"
]);
const ALLOWED_SEMANTIC_BINDING_KEYS = new Set([
  "canonicalId", "mappingStatus", "targetSkillIds", "utteranceIds", "rationaleEn"
]);
const ALLOWED_SKILL_KEYS = new Set([
  "id", "revision", "unitId", "locale", "kind", "descriptionEn", "canonicalIds", "review"
]);
const ALLOWED_UTTERANCE_KEYS = new Set([
  "id", "revision", "unitId", "locale", "normalization", "text", "functionIds",
  "frameIds", "conceptIds", "skillIds", "review"
]);
const ALLOWED_CONTEXT_KEYS = new Set([
  "id", "revision", "unitId", "locale", "descriptionEn", "featureValues", "opportunities", "review"
]);
const ALLOWED_OPPORTUNITY_KEYS = new Set([
  "id", "operation", "targetSkillIds", "stimulusUtteranceIds", "expectedUtteranceIds"
]);
const ALLOWED_REVIEW_KEYS = new Set(["status", "notesEn"]);
const ATTESTATION_DECISION_KEYS = [
  "semanticEquivalence",
  "naturalness",
  "pragmatics",
  "morphology",
  "ageSafety",
  "contextValidity",
  "opportunityValidity",
  "mediaValidity"
];
const ALLOWED_ATTESTATION_KEYS = new Set([
  "schemaVersion", "attestationId", "curriculum", "targetPack", "reviewer",
  "reviewedAt", "checklistVersion", "decisions", "notesEn"
]);
const ALLOWED_ATTESTATION_CURRICULUM_KEYS = new Set(["id", "version", "canonicalContractDigest"]);
const ALLOWED_ATTESTATION_PACK_KEYS = new Set(["id", "version", "targetLocale", "targetPackDigest"]);
const ALLOWED_ATTESTATION_REVIEWER_KEYS = new Set(["reviewerId", "role", "qualifiedTargetLocales"]);

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`);
  return `{${entries.join(",")}}`;
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

export function canonicalContractProjection(curriculum) {
  return {
    projectionVersion: "caatuu-canonical-contract-projection-v1",
    schemaVersion: curriculum?.schemaVersion,
    curriculumId: curriculum?.curriculumId,
    version: curriculum?.version,
    specLocale: curriculum?.specLocale,
    title: curriculum?.title,
    description: curriculum?.description,
    planningPolicy: curriculum?.planningPolicy,
    learningStageSequence: asArray(curriculum?.learningStageSequence),
    semanticDefinitions: asArray(curriculum?.semanticDefinitions),
    unitOrder: asArray(curriculum?.unitOrder),
    units: asArray(curriculum?.units).map((unit) => ({
      id: unit?.id,
      revision: unit?.revision,
      ordinal: unit?.ordinal,
      title: unit?.title,
      description: unit?.description,
      canDo: unit?.canDo,
      semanticScope: unit?.semanticScope,
      transferPolicy: unit?.transferPolicy,
      prerequisiteUnitIds: asArray(unit?.prerequisiteUnitIds),
      requiredLearningStages: asArray(unit?.requiredLearningStages),
      masteryPolicy: unit?.masteryPolicy
    }))
  };
}

export function computeCanonicalContractDigest(curriculum) {
  return sha256(stableStringify(canonicalContractProjection(curriculum)));
}

export function computeTargetPackDigest(pack) {
  return sha256(stableStringify({
    projectionVersion: "caatuu-target-pack-projection-v1",
    pack
  }));
}

export function computeApprovalAttestationDigest(attestation) {
  return sha256(stableStringify({
    projectionVersion: "caatuu-target-pack-review-attestation-projection-v1",
    attestation
  }));
}

function sameArray(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameSet(left, right) {
  return left.length === right.length && left.every((value) => new Set(right).has(value));
}

function uniqueValues(values) {
  return new Set(values).size === values.length;
}

function difference(required, supplied) {
  const suppliedSet = new Set(supplied);
  return required.filter((value) => !suppliedSet.has(value));
}

function duplicateValues(values) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}

function indexById(rows) {
  return new Map(asArray(rows).filter((row) => row?.id).map((row) => [row.id, row]));
}

function isCanonicalLocale(value) {
  if (typeof value !== "string") return false;
  try {
    return Intl.getCanonicalLocales(value)[0] === value;
  } catch {
    return false;
  }
}

function isValidRfc3339DateTime(value) {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , offsetHourText, offsetMinuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const offsetHour = offsetHourText === undefined ? 0 : Number(offsetHourText);
  const offsetMinute = offsetMinuteText === undefined ? 0 : Number(offsetMinuteText);
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59 || offsetHour > 23 || offsetMinute > 59) return false;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day >= 1 && day <= daysInMonth && !Number.isNaN(Date.parse(value));
}

function collectReleaseAttestationIssues(attestation, curriculum, pack, canonicalDigest, targetPackDigest, validationTime) {
  const issues = [];
  const add = (path, message) => issues.push({ path, message });
  const validateExactObject = (value, allowedKeys, path, label) => {
    if (!isObject(value)) {
      add(path, `${label} must be an object.`);
      return false;
    }
    for (const key of Object.keys(value)) {
      if (!allowedKeys.has(key)) add(`${path}/${key}`, `${label} contains unsupported field ${key}.`);
    }
    return true;
  };

  if (!validateExactObject(attestation, ALLOWED_ATTESTATION_KEYS, "/approvalAttestation", "Release approval attestation")) {
    return issues;
  }

  if (attestation.schemaVersion !== APPROVAL_ATTESTATION_SCHEMA) {
    add("/approvalAttestation/schemaVersion", `Expected ${APPROVAL_ATTESTATION_SCHEMA}.`);
  }
  if (typeof attestation.attestationId !== "string" || !/^attestation\.[a-z0-9.-]+$/.test(attestation.attestationId)) {
    add("/approvalAttestation/attestationId", "Attestation ID must be a stable lowercase attestation.* identifier.");
  }

  if (validateExactObject(
    attestation.curriculum,
    ALLOWED_ATTESTATION_CURRICULUM_KEYS,
    "/approvalAttestation/curriculum",
    "Attested curriculum reference"
  )) {
    if (attestation.curriculum.id !== curriculum.curriculumId) {
      add("/approvalAttestation/curriculum/id", `Attestation must name curriculum ${curriculum.curriculumId}.`);
    }
    if (attestation.curriculum.version !== curriculum.version) {
      add("/approvalAttestation/curriculum/version", `Attestation must pin curriculum version ${curriculum.version}.`);
    }
    if (attestation.curriculum.canonicalContractDigest !== canonicalDigest) {
      add("/approvalAttestation/curriculum/canonicalContractDigest", `Attestation must pin canonical contract ${canonicalDigest}.`);
    }
  }

  if (validateExactObject(
    attestation.targetPack,
    ALLOWED_ATTESTATION_PACK_KEYS,
    "/approvalAttestation/targetPack",
    "Attested target-pack reference"
  )) {
    if (attestation.targetPack.id !== pack.packId) {
      add("/approvalAttestation/targetPack/id", `Attestation must name target pack ${pack.packId}.`);
    }
    if (attestation.targetPack.version !== pack.version) {
      add("/approvalAttestation/targetPack/version", `Attestation must pin target-pack version ${pack.version}.`);
    }
    if (attestation.targetPack.targetLocale !== pack.targetLocale) {
      add("/approvalAttestation/targetPack/targetLocale", `Attestation must cover target locale ${pack.targetLocale}.`);
    }
    if (attestation.targetPack.targetPackDigest !== targetPackDigest) {
      add("/approvalAttestation/targetPack/targetPackDigest", `Attestation must pin target pack ${targetPackDigest}.`);
    }
  }

  if (validateExactObject(
    attestation.reviewer,
    ALLOWED_ATTESTATION_REVIEWER_KEYS,
    "/approvalAttestation/reviewer",
    "Attestation reviewer"
  )) {
    if (typeof attestation.reviewer.reviewerId !== "string" || attestation.reviewer.reviewerId.trim().length < 3) {
      add("/approvalAttestation/reviewer/reviewerId", "Reviewer ID must contain at least three non-whitespace characters.");
    }
    if (attestation.reviewer.role !== "native-language-educator") {
      add("/approvalAttestation/reviewer/role", "Release approval requires the native-language-educator role.");
    }
    const locales = attestation.reviewer.qualifiedTargetLocales;
    if (!Array.isArray(locales) || locales.length === 0) {
      add("/approvalAttestation/reviewer/qualifiedTargetLocales", "Reviewer must declare at least one qualified target locale.");
    } else {
      if (!uniqueValues(locales)) {
        add("/approvalAttestation/reviewer/qualifiedTargetLocales", "Reviewer target locales must be unique.");
      }
      for (const locale of locales) {
        if (!isCanonicalLocale(locale)) {
          add("/approvalAttestation/reviewer/qualifiedTargetLocales", `Reviewer locale ${locale} is not a canonical BCP-47 tag.`);
        }
      }
      if (!locales.includes(pack.targetLocale)) {
        add("/approvalAttestation/reviewer/qualifiedTargetLocales", `Reviewer is not qualified for ${pack.targetLocale}.`);
      }
    }
  }

  const reviewedAtIsValid = isValidRfc3339DateTime(attestation.reviewedAt);
  if (!reviewedAtIsValid) {
    add("/approvalAttestation/reviewedAt", "Review timestamp must be a valid RFC 3339 date-time with a timezone.");
  } else {
    const validationTimestamp = validationTime === undefined ? Date.now() : Date.parse(validationTime);
    if (Number.isNaN(validationTimestamp)) {
      add("/approvalAttestation", "Release validation time is invalid.");
    } else if (Date.parse(attestation.reviewedAt) > validationTimestamp + ATTESTATION_CLOCK_SKEW_MS) {
      add("/approvalAttestation/reviewedAt", "Review timestamp cannot be in the future beyond the five-minute clock-skew allowance.");
    }
  }
  if (attestation.checklistVersion !== REVIEW_CHECKLIST_VERSION) {
    add("/approvalAttestation/checklistVersion", `Expected checklist ${REVIEW_CHECKLIST_VERSION}.`);
  }
  if (validateExactObject(
    attestation.decisions,
    new Set(ATTESTATION_DECISION_KEYS),
    "/approvalAttestation/decisions",
    "Attestation decisions"
  )) {
    for (const decision of ATTESTATION_DECISION_KEYS) {
      if (attestation.decisions[decision] !== "approved") {
        add(`/approvalAttestation/decisions/${decision}`, `${decision} must be approved for release.`);
      }
    }
  }
  if (typeof attestation.notesEn !== "string") {
    add("/approvalAttestation/notesEn", "Attestation notes must be an English string, which may be empty.");
  }

  return issues;
}

function isOrderedSubsequence(values, sequence) {
  let previous = -1;
  for (const value of values) {
    const position = sequence.indexOf(value);
    if (position < 0 || position <= previous) return false;
    previous = position;
  }
  return true;
}

function entityWithoutRevision(entity) {
  if (!isObject(entity)) return entity;
  const { revision: _revision, ...rest } = entity;
  return rest;
}

export function validateConformance(curriculum, pack, options = {}) {
  const errors = [];
  const warnings = [];
  const pendingReviewItems = [];
  const diagnosticContext = {
    backboneId: curriculum?.curriculumId ?? null,
    courseId: pack?.packId ?? null,
    locale: pack?.targetLocale ?? null
  };

  const report = (severity, code, path, message, relatedIds = []) => {
    const entry = { severity, code, ...diagnosticContext, path, relatedIds, message };
    (severity === "error" ? errors : warnings).push(entry);
  };
  const error = (code, path, message, relatedIds) => report("error", code, path, message, relatedIds);
  const warn = (code, path, message, relatedIds) => report("warning", code, path, message, relatedIds);

  const validateKeys = (value, allowed, path, code = "CURR_MANIFEST_SCHEMA") => {
    if (!isObject(value)) return;
    for (const key of Object.keys(value)) {
      if (!allowed.has(key)) error(code, `${path}/${key}`, `Unsupported field ${key}.`);
    }
  };
  const requireNonEmptyString = (value, path, label) => {
    if (typeof value !== "string" || !value.trim()) {
      error("CURR_MANIFEST_SCHEMA", path, `${label} must be a non-empty string.`);
      return false;
    }
    if (value.normalize("NFC") !== value) {
      error("CURR_NORMALIZATION", path, `${label} must be Unicode NFC normalized.`);
    }
    return true;
  };
  const requireArray = (value, path, label, { nonEmpty = true } = {}) => {
    if (!Array.isArray(value)) {
      error("CURR_MANIFEST_SCHEMA", path, `${label} must be an array.`);
      return [];
    }
    if (nonEmpty && value.length === 0) error("CURR_MANIFEST_SCHEMA", path, `${label} cannot be empty.`);
    return value;
  };
  const validateReview = (review, path, entityLabel, relatedIds = []) => {
    if (!isObject(review)) {
      error("CURR_MANIFEST_SCHEMA", path, `${entityLabel} requires review metadata.`, relatedIds);
      return;
    }
    validateKeys(review, ALLOWED_REVIEW_KEYS, path);
    if (!REVIEW_STATUSES.has(review.status)) {
      error("CURR_MANIFEST_SCHEMA", `${path}/status`, `${entityLabel} has an invalid review status.`, relatedIds);
    }
    if (typeof review.notesEn !== "string") {
      error("CURR_MANIFEST_SCHEMA", `${path}/notesEn`, `${entityLabel} review notes must be a string.`, relatedIds);
    }
    if (options.requireHumanApproval && review.status !== "human-approved") {
      error("CURR_RELEASE_REVIEW", `${path}/status`, `${entityLabel} is not human approved.`, relatedIds);
    } else if (review.status !== "human-approved") {
      pendingReviewItems.push({ path: `${path}/status`, entityLabel, relatedIds });
    }
  };

  if (!isObject(curriculum)) {
    error("CURR_MANIFEST_SCHEMA", "/", "Canonical curriculum must be an object.");
    return { valid: false, errors, warnings, canonicalContractDigest: null, targetPackDigest: null, approvalAttestationDigest: null };
  }
  if (!isObject(pack)) {
    error("CURR_MANIFEST_SCHEMA", "/", "Target realization pack must be an object.");
    return { valid: false, errors, warnings, canonicalContractDigest: null, targetPackDigest: null, approvalAttestationDigest: null };
  }

  validateKeys(curriculum, ALLOWED_CURRICULUM_KEYS, "");
  validateKeys(pack, ALLOWED_PACK_KEYS, "", "CURR_REALIZATION_OVERRIDE");

  if (curriculum.schemaVersion !== CURRICULUM_SCHEMA) error("CURR_MANIFEST_SCHEMA", "/schemaVersion", `Expected ${CURRICULUM_SCHEMA}.`);
  if (curriculum.specLocale !== "en") error("CURR_AUTHORING_LOCALE", "/specLocale", "Canonical curriculum must be authored in English.");
  requireNonEmptyString(curriculum.curriculumId, "/curriculumId", "Curriculum ID");
  if (!SEMVER_PATTERN.test(curriculum.version || "")) error("CURR_MANIFEST_SCHEMA", "/version", "Curriculum version must use semantic versioning.");
  requireNonEmptyString(curriculum.title, "/title", "Curriculum title");
  requireNonEmptyString(curriculum.description, "/description", "Curriculum description");

  const planningPolicy = curriculum.planningPolicy;
  if (!isObject(planningPolicy)) {
    error("CURR_MANIFEST_SCHEMA", "/planningPolicy", "Canonical curriculum requires a planning policy.");
  } else {
    validateKeys(planningPolicy, ALLOWED_PLANNING_KEYS, "/planningPolicy");
    for (const field of ["maxNewSemanticConceptsPerSession", "maxNewTargetConstructionsPerSession"]) {
      if (!Number.isInteger(planningPolicy[field]) || planningPolicy[field] < 0) {
        error("CURR_MANIFEST_SCHEMA", `/planningPolicy/${field}`, `${field} must be a non-negative integer.`);
      }
    }
    if (!Number.isInteger(planningPolicy.delayedRetrievalMinimumSessionGap) || planningPolicy.delayedRetrievalMinimumSessionGap < 1) {
      error("CURR_MANIFEST_SCHEMA", "/planningPolicy/delayedRetrievalMinimumSessionGap", "Delayed retrieval requires a positive session gap.");
    }
    const repairGap = planningPolicy.repairRetryTaskGap;
    if (!isObject(repairGap)
      || !Number.isInteger(repairGap.minimum)
      || !Number.isInteger(repairGap.maximum)
      || repairGap.minimum < 1
      || repairGap.maximum < repairGap.minimum) {
      error("CURR_MANIFEST_SCHEMA", "/planningPolicy/repairRetryTaskGap", "Repair retry gap requires positive minimum and maximum values in order.");
    }
    if (planningPolicy.exposureCanQualifyForMastery !== false || planningPolicy.solutionRevealCanQualifyForMastery !== false) {
      error("CURR_EXPOSURE_AS_MASTERY", "/planningPolicy", "Exposure and solution reveal cannot qualify for mastery.");
    }
  }

  const learningStageSequence = requireArray(curriculum.learningStageSequence, "/learningStageSequence", "Learning stage sequence");
  if (!sameArray(learningStageSequence, STANDARD_STAGE_SEQUENCE)) {
    error("CURR_STAGE_ORDER", "/learningStageSequence", "The v1 learning stage sequence must preserve the canonical pedagogical progression.");
  }

  const semanticDefinitions = requireArray(curriculum.semanticDefinitions, "/semanticDefinitions", "Semantic definitions");
  const semanticDefinitionIds = semanticDefinitions.map((row) => row?.id);
  const semanticDefinitionById = indexById(semanticDefinitions);
  for (const duplicate of duplicateValues(semanticDefinitionIds)) {
    error("CURR_ID_DUPLICATE", "/semanticDefinitions", `Duplicate semantic definition ${duplicate}.`, [duplicate]);
  }
  semanticDefinitions.forEach((definition, index) => {
    const path = `/semanticDefinitions/${index}`;
    if (!isObject(definition)) {
      error("CURR_MANIFEST_SCHEMA", path, "Semantic definition must be an object.");
      return;
    }
    validateKeys(definition, new Set(["id", "revision", "kind", "definitionEn", "requiredEvidenceMode"]), path);
    requireNonEmptyString(definition.id, `${path}/id`, "Semantic definition ID");
    if (!Number.isInteger(definition.revision) || definition.revision < 1) error("CURR_REVISION_REQUIRED", `${path}/revision`, "Semantic definition requires a positive revision.", [definition.id].filter(Boolean));
    if (!new Set(["function", "frame", "concept"]).has(definition.kind)) error("CURR_MANIFEST_SCHEMA", `${path}/kind`, "Semantic definition kind must be function, frame, or concept.", [definition.id].filter(Boolean));
    if (typeof definition.id === "string" && definition.kind && !definition.id.startsWith(`${definition.kind}.`)) {
      error("CURR_ALIGNMENT_INCOMPLETE", `${path}/kind`, `${definition.id} does not match kind ${definition.kind}.`, [definition.id]);
    }
    if (definition.kind === "function" && !new Set(["comprehension", "production", "interaction"]).has(definition.requiredEvidenceMode)) {
      error("CURR_MANIFEST_SCHEMA", `${path}/requiredEvidenceMode`, `Function ${definition.id} requires an English-defined evidence mode.`, [definition.id]);
    } else if (definition.kind !== "function" && Object.hasOwn(definition, "requiredEvidenceMode")) {
      error("CURR_MANIFEST_SCHEMA", `${path}/requiredEvidenceMode`, "Only communicative functions define an evidence mode.", [definition.id]);
    }
    requireNonEmptyString(definition.definitionEn, `${path}/definitionEn`, "English semantic definition");
  });

  const canonicalUnits = requireArray(curriculum.units, "/units", "Canonical units");
  const canonicalOrder = requireArray(curriculum.unitOrder, "/unitOrder", "Canonical unit order");
  const canonicalUnitIds = canonicalUnits.map((unit) => unit?.id);
  const canonicalUnitById = indexById(canonicalUnits);
  for (const duplicate of duplicateValues(canonicalUnitIds)) error("CURR_ID_DUPLICATE", "/units", `Duplicate canonical unit ID ${duplicate}.`, [duplicate]);
  for (const duplicate of duplicateValues(canonicalOrder)) error("CURR_ORDER_INVALID", "/unitOrder", `Duplicate unit ID ${duplicate} in canonical order.`, [duplicate]);
  if (!sameArray(canonicalOrder, canonicalUnitIds)) error("CURR_ORDER_INVALID", "/unitOrder", "Canonical unitOrder must exactly match the units array.");

  const usedSemanticIds = new Set();
  const canonicalPosition = new Map(canonicalOrder.map((unitId, index) => [unitId, index]));
  canonicalUnits.forEach((unit, index) => {
    const path = `/units/${index}`;
    if (!isObject(unit)) {
      error("CURR_MANIFEST_SCHEMA", path, "Canonical unit must be an object.");
      return;
    }
    validateKeys(unit, ALLOWED_UNIT_KEYS, path);
    if (!unit.id || typeof unit.id !== "string") {
      error("CURR_ID_INVALID", `${path}/id`, "Canonical unit requires a stable string ID.");
      return;
    }
    if (unit.ordinal !== index + 1) error("CURR_ORDER_INVALID", `${path}/ordinal`, `Unit ${unit.id} ordinal must be ${index + 1}.`, [unit.id]);
    if (!Number.isInteger(unit.revision) || unit.revision < 1) error("CURR_REVISION_REQUIRED", `${path}/revision`, `Unit ${unit.id} requires a positive revision.`, [unit.id]);
    requireNonEmptyString(unit.title, `${path}/title`, `Unit ${unit.id} title`);
    requireNonEmptyString(unit.description, `${path}/description`, `Unit ${unit.id} description`);
    if (!isObject(unit.canDo) || Object.keys(unit.canDo).some((key) => key !== "observableOutcome")) error("CURR_MANIFEST_SCHEMA", `${path}/canDo`, `Unit ${unit.id} requires only the canonical observable outcome.`, [unit.id]);
    requireNonEmptyString(unit.canDo?.observableOutcome, `${path}/canDo/observableOutcome`, `Unit ${unit.id} observable outcome`);

    const unitSemanticIds = [];
    for (const [scopeName, expectedKind] of [["functionIds", "function"], ["frameIds", "frame"], ["conceptIds", "concept"]]) {
      const ids = requireArray(unit.semanticScope?.[scopeName], `${path}/semanticScope/${scopeName}`, `${unit.id} ${scopeName}`);
      unitSemanticIds.push(...ids);
      for (const duplicate of duplicateValues(ids)) error("CURR_ID_DUPLICATE", `${path}/semanticScope/${scopeName}`, `Duplicate semantic ID ${duplicate}.`, [unit.id, duplicate]);
      for (const id of ids) {
        usedSemanticIds.add(id);
        const definition = semanticDefinitionById.get(id);
        if (!definition) error("CURR_SEMANTIC_UNDEFINED", `${path}/semanticScope/${scopeName}`, `Semantic ID ${id} has no English definition.`, [unit.id, id]);
        else if (definition.kind !== expectedKind) error("CURR_ALIGNMENT_INCOMPLETE", `${path}/semanticScope/${scopeName}`, `${id} is ${definition.kind}, not ${expectedKind}.`, [unit.id, id]);
      }
    }
    if (!uniqueValues(unitSemanticIds)) error("CURR_ID_DUPLICATE", `${path}/semanticScope`, `Unit ${unit.id} repeats a semantic ID across scope categories.`, [unit.id]);

    const prerequisites = requireArray(unit.prerequisiteUnitIds, `${path}/prerequisiteUnitIds`, `${unit.id} prerequisites`, { nonEmpty: false });
    for (const duplicate of duplicateValues(prerequisites)) error("CURR_PREREQ_DUPLICATE", `${path}/prerequisiteUnitIds`, `Duplicate prerequisite ${duplicate}.`, [unit.id, duplicate]);
    for (const prerequisiteId of prerequisites) {
      if (prerequisiteId === unit.id) error("CURR_PREREQ_SELF", `${path}/prerequisiteUnitIds`, `Unit ${unit.id} cannot require itself.`, [unit.id]);
      else if (!canonicalUnitById.has(prerequisiteId)) error("CURR_PREREQ_UNKNOWN", `${path}/prerequisiteUnitIds`, `Unknown prerequisite ${prerequisiteId}.`, [unit.id, prerequisiteId]);
      else if ((canonicalPosition.get(prerequisiteId) ?? Infinity) >= index) error("CURR_PREREQ_FORWARD", `${path}/prerequisiteUnitIds`, `Prerequisite ${prerequisiteId} must precede ${unit.id}.`, [unit.id, prerequisiteId]);
    }

    const stages = requireArray(unit.requiredLearningStages, `${path}/requiredLearningStages`, `${unit.id} learning stages`);
    if (!uniqueValues(stages) || !isOrderedSubsequence(stages, learningStageSequence)) {
      error("CURR_STAGE_ORDER", `${path}/requiredLearningStages`, `Unit ${unit.id} stages must be a unique ordered subsequence of the canonical progression.`, [unit.id]);
    }
    const mastery = unit.masteryPolicy;
    if (!isObject(mastery)) {
      error("CURR_MASTERY_INVALID", `${path}/masteryPolicy`, `Unit ${unit.id} requires a mastery policy.`, [unit.id]);
    } else {
      const allowedMasteryKeys = new Set(["minimumIndependentRetrievals", "minimumSessions", "minimumDistinctContexts", "scope", "requiresTransfer", "requiresProduction", "solutionRevealCanQualify", "unresolvedRecentFailureBlocksMastery"]);
      validateKeys(mastery, allowedMasteryKeys, `${path}/masteryPolicy`, "CURR_MASTERY_INVALID");
      for (const field of ["minimumIndependentRetrievals", "minimumSessions", "minimumDistinctContexts"]) {
        if (!Number.isInteger(mastery[field]) || mastery[field] < 1) error("CURR_MASTERY_INVALID", `${path}/masteryPolicy/${field}`, `${field} must be a positive integer.`, [unit.id]);
      }
      if (mastery.scope !== "each-required-target-skill") error("CURR_MASTERY_INVALID", `${path}/masteryPolicy/scope`, "Mastery retrieval and context thresholds must apply to each required target skill.", [unit.id]);
      if (typeof mastery.requiresTransfer !== "boolean" || typeof mastery.requiresProduction !== "boolean") error("CURR_MASTERY_INVALID", `${path}/masteryPolicy`, "Transfer and production requirements must be booleans.", [unit.id]);
      if (mastery.solutionRevealCanQualify !== false) error("CURR_EXPOSURE_AS_MASTERY", `${path}/masteryPolicy/solutionRevealCanQualify`, "Solution reveal cannot qualify for mastery.", [unit.id]);
      if (mastery.unresolvedRecentFailureBlocksMastery !== true) error("CURR_MASTERY_INVALID", `${path}/masteryPolicy/unresolvedRecentFailureBlocksMastery`, "Unresolved recent failure must block mastery.", [unit.id]);
      if (mastery.requiresTransfer && !stages.includes("transfer")) error("CURR_STAGE_ORDER", `${path}/requiredLearningStages`, "Transfer mastery requires a transfer learning stage.", [unit.id]);
      if (mastery.requiresProduction && !stages.some((stage) => ["supported-produce", "interact"].includes(stage))) error("CURR_STAGE_ORDER", `${path}/requiredLearningStages`, "Production mastery requires a production or interaction stage.", [unit.id]);
      if (!stages.includes("delayed-retrieval")) error("CURR_STAGE_ORDER", `${path}/requiredLearningStages`, "The shared delayed-retrieval policy requires a delayed-retrieval stage.", [unit.id]);
    }

    const transfer = unit.transferPolicy;
    if (!isObject(transfer)) {
      error("CURR_TRANSFER_POLICY", `${path}/transferPolicy`, `Unit ${unit.id} requires a canonical transfer policy.`, [unit.id]);
    } else {
      validateKeys(transfer, new Set(["requiredContextDimensions", "minimumNovelDimensionsPerTransfer"]), `${path}/transferPolicy`, "CURR_TRANSFER_POLICY");
      const dimensions = requireArray(transfer.requiredContextDimensions, `${path}/transferPolicy/requiredContextDimensions`, `${unit.id} transfer dimensions`);
      const dimensionIds = dimensions.map((row) => row?.id);
      for (const duplicate of duplicateValues(dimensionIds)) error("CURR_ID_DUPLICATE", `${path}/transferPolicy/requiredContextDimensions`, `Duplicate context dimension ${duplicate}.`, [unit.id, duplicate]);
      dimensions.forEach((dimension, dimensionIndex) => {
        const dimensionPath = `${path}/transferPolicy/requiredContextDimensions/${dimensionIndex}`;
        if (!isObject(dimension)) error("CURR_TRANSFER_POLICY", dimensionPath, "Context dimension must be an object.", [unit.id]);
        else {
          validateKeys(dimension, new Set(["id", "definitionEn", "minimumDistinctValuesPerSkill"]), dimensionPath, "CURR_TRANSFER_POLICY");
          requireNonEmptyString(dimension.id, `${dimensionPath}/id`, "Context dimension ID");
          requireNonEmptyString(dimension.definitionEn, `${dimensionPath}/definitionEn`, "Context dimension definition");
          if (!Number.isInteger(dimension.minimumDistinctValuesPerSkill) || dimension.minimumDistinctValuesPerSkill < 2) error("CURR_TRANSFER_POLICY", `${dimensionPath}/minimumDistinctValuesPerSkill`, "A transfer dimension must require at least two distinct values.", [unit.id, dimension.id].filter(Boolean));
        }
      });
      if (!Number.isInteger(transfer.minimumNovelDimensionsPerTransfer)
        || transfer.minimumNovelDimensionsPerTransfer < 1
        || transfer.minimumNovelDimensionsPerTransfer > dimensions.length) {
        error("CURR_TRANSFER_POLICY", `${path}/transferPolicy/minimumNovelDimensionsPerTransfer`, "Minimum novel dimensions must fit the required dimension inventory.", [unit.id]);
      }
    }
  });
  for (const definitionId of semanticDefinitionIds) {
    if (!usedSemanticIds.has(definitionId)) warn("CURR_WARN_UNUSED_DEFINITION", "/semanticDefinitions", `Semantic definition ${definitionId} is not used by a unit.`, [definitionId]);
  }

  if (pack.schemaVersion !== PACK_SCHEMA) error("CURR_MANIFEST_SCHEMA", "/schemaVersion", `Expected ${PACK_SCHEMA}.`);
  requireNonEmptyString(pack.packId, "/packId", "Target pack ID");
  if (!SEMVER_PATTERN.test(pack.version || "")) error("CURR_MANIFEST_SCHEMA", "/version", "Target pack version must use semantic versioning.");
  if (pack.specLocale !== "en") error("CURR_AUTHORING_LOCALE", "/specLocale", "Target pack must reference English as the specification locale.");
  if (!isCanonicalLocale(pack.targetLocale)) error("CURR_REALIZATION_LOCALE", "/targetLocale", "Target locale must be a canonical BCP-47 language tag.");
  const supportLocales = requireArray(pack.supportLocales, "/supportLocales", "Support locales", { nonEmpty: false });
  if (!uniqueValues(supportLocales)) error("CURR_ID_DUPLICATE", "/supportLocales", "Support locales must be unique.");
  for (const locale of supportLocales) if (!isCanonicalLocale(locale)) error("CURR_REALIZATION_LOCALE", "/supportLocales", `Support locale ${locale} is not a canonical BCP-47 tag.`, [locale]);

  if (pack.curriculum?.id !== curriculum.curriculumId || pack.curriculum?.version !== curriculum.version) {
    error("CURR_BACKBONE_MISMATCH", "/curriculum", `Target pack must pin ${curriculum.curriculumId}@${curriculum.version}.`);
  }
  const digest = computeCanonicalContractDigest(curriculum);
  if (pack.canonicalContractDigest !== digest) error("CURR_DIGEST_MISMATCH", "/canonicalContractDigest", `Expected ${digest}.`);
  if (options.expectedCanonicalDigest && options.expectedCanonicalDigest !== digest) {
    error("CURR_DIGEST_MISMATCH", "/canonicalContractDigest", `Trusted release lock expected ${options.expectedCanonicalDigest}, but loaded ${digest}.`);
  }

  if (options.previousCanonical && isObject(options.previousCanonical)) {
    const previous = options.previousCanonical;
    const previousUnitsById = indexById(previous.units);
    for (const previousUnit of asArray(previous.units)) {
      const currentUnit = canonicalUnitById.get(previousUnit.id);
      if (!currentUnit) error("CURR_ID_REMOVED", "/units", `Released unit ${previousUnit.id} was removed without a migration.`, [previousUnit.id]);
      else if (stableStringify(entityWithoutRevision(previousUnit)) !== stableStringify(entityWithoutRevision(currentUnit)) && currentUnit.revision <= previousUnit.revision) {
        error("CURR_REVISION_REQUIRED", `/units/${canonicalOrder.indexOf(currentUnit.id)}/revision`, `Changed unit ${currentUnit.id} must increase its revision.`, [currentUnit.id]);
      }
    }
    const currentDefinitionsById = semanticDefinitionById;
    for (const previousDefinition of asArray(previous.semanticDefinitions)) {
      const currentDefinition = currentDefinitionsById.get(previousDefinition.id);
      if (!currentDefinition) error("CURR_ID_REMOVED", "/semanticDefinitions", `Released semantic definition ${previousDefinition.id} was removed.`, [previousDefinition.id]);
      else if (stableStringify(entityWithoutRevision(previousDefinition)) !== stableStringify(entityWithoutRevision(currentDefinition)) && currentDefinition.revision <= previousDefinition.revision) {
        error("CURR_REVISION_REQUIRED", "/semanticDefinitions", `Changed semantic definition ${currentDefinition.id} must increase its revision.`, [currentDefinition.id]);
      }
    }
    if (computeCanonicalContractDigest(previous) !== digest && previous.version === curriculum.version) {
      error("CURR_VERSION_REQUIRED", "/version", "A changed canonical contract must increase the curriculum version.");
    }
    void previousUnitsById;
  }

  const packOrder = requireArray(pack.unitOrder, "/unitOrder", "Target unit order");
  for (const duplicate of duplicateValues(packOrder)) error("CURR_ORDER_OVERRIDE", "/unitOrder", `Duplicate target unit ${duplicate}.`, [duplicate]);
  if (!sameArray(packOrder, canonicalOrder)) error("CURR_ORDER_OVERRIDE", "/unitOrder", "Target pack must preserve canonical unit order exactly.");

  const unitBindings = requireArray(pack.unitBindings, "/unitBindings", "Target unit bindings");
  const bindingIds = unitBindings.map((binding) => binding?.unitId);
  for (const duplicate of duplicateValues(bindingIds)) error("CURR_ID_DUPLICATE", "/unitBindings", `Duplicate unit binding ${duplicate}.`, [duplicate]);
  if (!sameArray(bindingIds, canonicalOrder)) error("CURR_ORDER_OVERRIDE", "/unitBindings", "Target unit bindings must cover every canonical unit in canonical order.");
  for (const missing of difference(canonicalOrder, bindingIds)) error("CURR_REALIZATION_MISSING", "/unitBindings", `Missing realization for canonical unit ${missing}.`, [missing]);
  for (const extra of difference(bindingIds, canonicalOrder)) error("CURR_REALIZATION_UNKNOWN_ITEM", "/unitBindings", `Unknown target unit binding ${extra}.`, [extra]);

  const skills = requireArray(pack.skills, "/skills", "Target skills");
  const utterances = requireArray(pack.utterances, "/utterances", "Target utterances");
  const contexts = requireArray(pack.contexts, "/contexts", "Target contexts");
  const skillIds = skills.map((skill) => skill?.id);
  const utteranceIds = utterances.map((utteranceRow) => utteranceRow?.id);
  const contextIds = contexts.map((contextRow) => contextRow?.id);
  const skillById = indexById(skills);
  const utteranceById = indexById(utterances);
  const contextById = indexById(contexts);
  for (const duplicate of duplicateValues(skillIds)) error("CURR_ID_DUPLICATE", "/skills", `Duplicate target skill ID ${duplicate}.`, [duplicate]);
  for (const duplicate of duplicateValues(utteranceIds)) error("CURR_ID_DUPLICATE", "/utterances", `Duplicate utterance ID ${duplicate}.`, [duplicate]);
  for (const duplicate of duplicateValues(contextIds)) error("CURR_ID_DUPLICATE", "/contexts", `Duplicate context ID ${duplicate}.`, [duplicate]);

  const referencedSkillIds = new Set();
  const referencedUtteranceIds = new Set();
  const referencedContextIds = new Set();
  const opportunityUtteranceIds = new Set();
  const referenceSets = { skill: referencedSkillIds, utterance: referencedUtteranceIds, context: referencedContextIds };
  const missingCodes = { skill: "CURR_ASSESSMENT_MISSING", utterance: "CURR_REALIZATION_MISSING", context: "CURR_REALIZATION_MISSING" };

  const validateReferenceList = (value, index, unitId, kind, path, { allowEmpty = false, track = true } = {}) => {
    if (!Array.isArray(value)) {
      error("CURR_MANIFEST_SCHEMA", path, `${kind} references must be an array.`, [unitId].filter(Boolean));
      return [];
    }
    if (!allowEmpty && value.length === 0) error("CURR_COVERAGE_INSUFFICIENT", path, `${kind} references cannot be empty.`, [unitId].filter(Boolean));
    for (const duplicate of duplicateValues(value)) error("CURR_ID_DUPLICATE", path, `Duplicate ${kind} reference ${duplicate}.`, [unitId, duplicate].filter(Boolean));
    for (const id of value) {
      const row = index.get(id);
      if (!row) error(missingCodes[kind], path, `Unknown ${kind} reference ${id}.`, [unitId, id].filter(Boolean));
      else if (row.unitId !== unitId) error("CURR_ALIGNMENT_INCOMPLETE", path, `${kind} ${id} belongs to ${row.unitId}, not ${unitId}.`, [unitId, id]);
      if (track && row) referenceSets[kind].add(id);
    }
    return value;
  };

  const bindingConfig = {
    functionBindings: { canonicalFieldName: "functionIds", utteranceClaimField: "functionIds" },
    frameBindings: { canonicalFieldName: "frameIds", utteranceClaimField: "frameIds" },
    conceptBindings: { canonicalFieldName: "conceptIds", utteranceClaimField: "conceptIds" }
  };

  const validateSemanticCoverage = (unit, binding, fieldName, bindingIndex, semanticSkillUnion, semanticUtteranceUnion) => {
    const { canonicalFieldName, utteranceClaimField } = bindingConfig[fieldName];
    const rows = requireArray(binding?.[fieldName], `/unitBindings/${bindingIndex}/${fieldName}`, `${unit.id} ${fieldName}`);
    const suppliedIds = rows.map((row) => row?.canonicalId);
    const requiredIds = asArray(unit.semanticScope?.[canonicalFieldName]);
    for (const missing of difference(requiredIds, suppliedIds)) error("CURR_ALIGNMENT_INCOMPLETE", `/unitBindings/${bindingIndex}/${fieldName}`, `Missing mapping for ${missing}.`, [unit.id, missing]);
    for (const extra of difference(suppliedIds, requiredIds)) error("CURR_REALIZATION_UNKNOWN_ITEM", `/unitBindings/${bindingIndex}/${fieldName}`, `Unknown canonical mapping ${extra}.`, [unit.id, extra]);
    for (const duplicate of duplicateValues(suppliedIds)) error("CURR_ID_DUPLICATE", `/unitBindings/${bindingIndex}/${fieldName}`, `Duplicate canonical mapping ${duplicate}.`, [unit.id, duplicate]);
    if (sameSet(suppliedIds, requiredIds) && !sameArray(suppliedIds, requiredIds)) {
      error(
        "CURR_ORDER_OVERRIDE",
        `/unitBindings/${bindingIndex}/${fieldName}`,
        `Target mappings must preserve the English canonical ${canonicalFieldName} order.`,
        [unit.id]
      );
    }
    rows.forEach((row, rowIndex) => {
      const rowPath = `/unitBindings/${bindingIndex}/${fieldName}/${rowIndex}`;
      if (!isObject(row)) {
        error("CURR_MANIFEST_SCHEMA", rowPath, "Semantic binding must be an object.", [unit.id]);
        return;
      }
      validateKeys(row, ALLOWED_SEMANTIC_BINDING_KEYS, rowPath, "CURR_REALIZATION_OVERRIDE");
      if (!MAPPING_STATUSES.has(row.mappingStatus)) error("CURR_MANIFEST_SCHEMA", `${rowPath}/mappingStatus`, `Invalid mapping status ${row.mappingStatus}.`, [unit.id]);
      if (row.mappingStatus === "unavailable") error("CURR_ALIGNMENT_INCOMPLETE", `${rowPath}/mappingStatus`, `${row.canonicalId} is unavailable and requires shared curriculum governance.`, [unit.id, row.canonicalId]);
      const rowSkills = validateReferenceList(row.targetSkillIds, skillById, unit.id, "skill", `${rowPath}/targetSkillIds`);
      const rowUtterances = validateReferenceList(row.utteranceIds, utteranceById, unit.id, "utterance", `${rowPath}/utteranceIds`);
      for (const skillId of rowSkills) {
        semanticSkillUnion.add(skillId);
        const skill = skillById.get(skillId);
        if (skill && !asArray(skill.canonicalIds).includes(row.canonicalId)) error("CURR_ALIGNMENT_INCOMPLETE", `${rowPath}/targetSkillIds`, `Skill ${skillId} does not claim ${row.canonicalId}.`, [unit.id, row.canonicalId, skillId]);
      }
      for (const utteranceId of rowUtterances) {
        semanticUtteranceUnion.add(utteranceId);
        const utteranceRow = utteranceById.get(utteranceId);
        if (utteranceRow && !asArray(utteranceRow[utteranceClaimField]).includes(row.canonicalId)) error("CURR_ALIGNMENT_INCOMPLETE", `${rowPath}/utteranceIds`, `Utterance ${utteranceId} does not claim ${row.canonicalId}.`, [unit.id, row.canonicalId, utteranceId]);
      }
      if (["implicit", "incorporated", "split", "merged"].includes(row.mappingStatus) && !String(row.rationaleEn || "").trim()) {
        const reporter = options.requireHumanApproval ? error : warn;
        reporter("CURR_COMPLEX_MAPPING_RATIONALE", `${rowPath}/rationaleEn`, `${row.mappingStatus} mapping requires an English rationale.`, [unit.id, row.canonicalId]);
      }
    });
  };

  unitBindings.forEach((binding, bindingIndex) => {
    const bindingPath = `/unitBindings/${bindingIndex}`;
    const unit = canonicalUnitById.get(binding?.unitId);
    if (!isObject(binding)) {
      error("CURR_MANIFEST_SCHEMA", bindingPath, "Unit binding must be an object.");
      return;
    }
    for (const key of Object.keys(binding)) {
      if (FORBIDDEN_UNIT_OVERRIDE_KEYS.has(key)) error("CURR_OUTCOME_MUTATION", `${bindingPath}/${key}`, `Target pack cannot override canonical field ${key}.`, [binding.unitId].filter(Boolean));
      else if (!ALLOWED_UNIT_BINDING_KEYS.has(key)) error("CURR_REALIZATION_OVERRIDE", `${bindingPath}/${key}`, `Unsupported target unit field ${key}.`, [binding.unitId].filter(Boolean));
    }
    if (!unit) return;
    if (binding.canonicalRevision !== unit.revision) error("CURR_REVISION_REQUIRED", `${bindingPath}/canonicalRevision`, `Expected canonical revision ${unit.revision} for ${unit.id}.`, [unit.id]);
    const complexity = binding.realizationComplexity;
    if (!isObject(complexity)
      || complexity.advisoryOnly !== true
      || !Number.isInteger(complexity.receptive)
      || !Number.isInteger(complexity.productive)
      || complexity.receptive < 1 || complexity.receptive > 5
      || complexity.productive < 1 || complexity.productive > 5) {
      error("CURR_REALIZATION_OVERRIDE", `${bindingPath}/realizationComplexity`, "Realization complexity must be a 1-5 advisory record and cannot control sequence.", [unit.id]);
    }
    const semanticSkillUnion = new Set();
    const semanticUtteranceUnion = new Set();
    for (const fieldName of Object.keys(bindingConfig)) validateSemanticCoverage(unit, binding, fieldName, bindingIndex, semanticSkillUnion, semanticUtteranceUnion);
    const aggregateSkills = validateReferenceList(binding.targetSkillIds, skillById, unit.id, "skill", `${bindingPath}/targetSkillIds`);
    const aggregateUtterances = validateReferenceList(binding.utteranceIds, utteranceById, unit.id, "utterance", `${bindingPath}/utteranceIds`);
    validateReferenceList(binding.contextIds, contextById, unit.id, "context", `${bindingPath}/contextIds`);
    if (!sameSet([...semanticSkillUnion], aggregateSkills)) error("CURR_ALIGNMENT_INCOMPLETE", `${bindingPath}/targetSkillIds`, "Unit targetSkillIds must exactly equal the union of semantic binding skill references.", [unit.id]);
    else if (!sameArray([...semanticSkillUnion], aggregateSkills)) {
      error(
        "CURR_ORDER_OVERRIDE",
        `${bindingPath}/targetSkillIds`,
        "Unit targetSkillIds must follow their first occurrence in the English-ordered semantic mappings.",
        [unit.id]
      );
    }
    if (!sameSet([...semanticUtteranceUnion], aggregateUtterances)) error("CURR_ALIGNMENT_INCOMPLETE", `${bindingPath}/utteranceIds`, "Unit utteranceIds must exactly equal the union of semantic binding utterance references.", [unit.id]);
    if (!Array.isArray(binding.withinUnitScaffolds) || binding.withinUnitScaffolds.some((value) => typeof value !== "string" || !value.trim())) error("CURR_MANIFEST_SCHEMA", `${bindingPath}/withinUnitScaffolds`, "Within-unit scaffolds must be English-described strings.", [unit.id]);
    validateReview(binding.review, `${bindingPath}/review`, `Unit ${unit.id} realization`, [unit.id]);
  });

  skills.forEach((skill, index) => {
    const path = `/skills/${index}`;
    if (!isObject(skill)) {
      error("CURR_MANIFEST_SCHEMA", path, "Target skill must be an object.");
      return;
    }
    validateKeys(skill, ALLOWED_SKILL_KEYS, path, "CURR_REALIZATION_OVERRIDE");
    if (!skill.id || !skill.unitId) {
      error("CURR_MANIFEST_SCHEMA", path, "Every target skill requires an ID and canonical unit ID.");
      return;
    }
    const unit = canonicalUnitById.get(skill.unitId);
    if (!unit) error("CURR_REALIZATION_UNKNOWN_ITEM", `${path}/unitId`, `Skill ${skill.id} references unknown unit ${skill.unitId}.`, [skill.id, skill.unitId]);
    if (!Number.isInteger(skill.revision) || skill.revision < 1) error("CURR_REVISION_REQUIRED", `${path}/revision`, `Skill ${skill.id} requires a positive revision.`, [skill.id]);
    if (skill.locale !== pack.targetLocale) error("CURR_REALIZATION_LOCALE", `${path}/locale`, `Skill ${skill.id} locale must be ${pack.targetLocale}.`, [skill.id]);
    requireNonEmptyString(skill.descriptionEn, `${path}/descriptionEn`, `Skill ${skill.id} English description`);
    const claims = requireArray(skill.canonicalIds, `${path}/canonicalIds`, `Skill ${skill.id} canonical claims`);
    for (const duplicate of duplicateValues(claims)) error("CURR_ID_DUPLICATE", `${path}/canonicalIds`, `Skill ${skill.id} repeats claim ${duplicate}.`, [skill.id, duplicate]);
    const scope = unit ? new Set([...asArray(unit.semanticScope?.functionIds), ...asArray(unit.semanticScope?.frameIds), ...asArray(unit.semanticScope?.conceptIds)]) : new Set();
    for (const claim of claims) {
      if (!semanticDefinitionById.has(claim)) error("CURR_SEMANTIC_UNDEFINED", `${path}/canonicalIds`, `Skill ${skill.id} claims undefined semantic ID ${claim}.`, [skill.id, claim]);
      else if (!scope.has(claim)) error("CURR_ALIGNMENT_INCOMPLETE", `${path}/canonicalIds`, `Skill ${skill.id} claim ${claim} is outside ${skill.unitId}.`, [skill.id, claim]);
    }
    validateReview(skill.review, `${path}/review`, `Skill ${skill.id}`, [skill.id]);
  });

  const normalizedTextOwners = new Map();
  utterances.forEach((utteranceRow, index) => {
    const path = `/utterances/${index}`;
    if (!isObject(utteranceRow)) {
      error("CURR_MANIFEST_SCHEMA", path, "Utterance must be an object.");
      return;
    }
    validateKeys(utteranceRow, ALLOWED_UTTERANCE_KEYS, path, "CURR_REALIZATION_OVERRIDE");
    const unit = canonicalUnitById.get(utteranceRow.unitId);
    if (!utteranceRow.id || !unit) {
      error("CURR_REALIZATION_UNKNOWN_ITEM", `${path}/unitId`, `Utterance ${utteranceRow.id || index} references an unknown unit.`, [utteranceRow.id].filter(Boolean));
      return;
    }
    if (!Number.isInteger(utteranceRow.revision) || utteranceRow.revision < 1) error("CURR_REVISION_REQUIRED", `${path}/revision`, `Utterance ${utteranceRow.id} requires a positive revision.`, [utteranceRow.id]);
    if (utteranceRow.locale !== pack.targetLocale) error("CURR_REALIZATION_LOCALE", `${path}/locale`, `Utterance ${utteranceRow.id} locale must be ${pack.targetLocale}.`, [utteranceRow.id]);
    if (utteranceRow.normalization !== "NFC" || typeof utteranceRow.text !== "string" || utteranceRow.text.normalize("NFC") !== utteranceRow.text) error("CURR_NORMALIZATION", `${path}/text`, `Utterance ${utteranceRow.id} must declare and use NFC normalization.`, [utteranceRow.id]);
    requireNonEmptyString(utteranceRow.text, `${path}/text`, `Utterance ${utteranceRow.id} text`);
    const textKey = `${utteranceRow.locale}:${utteranceRow.text}`;
    if (normalizedTextOwners.has(textKey)) warn("CURR_WARN_DUPLICATE_TEXT", `${path}/text`, `Utterance text duplicates ${normalizedTextOwners.get(textKey)}.`, [utteranceRow.id, normalizedTextOwners.get(textKey)]);
    else normalizedTextOwners.set(textKey, utteranceRow.id);
    for (const [field, kind] of [["functionIds", "function"], ["frameIds", "frame"], ["conceptIds", "concept"]]) {
      const claims = requireArray(utteranceRow[field], `${path}/${field}`, `Utterance ${utteranceRow.id} ${field}`, { nonEmpty: field !== "conceptIds" });
      for (const duplicate of duplicateValues(claims)) error("CURR_ID_DUPLICATE", `${path}/${field}`, `Utterance ${utteranceRow.id} repeats ${duplicate}.`, [utteranceRow.id, duplicate]);
      const unitScope = asArray(unit.semanticScope?.[field]);
      for (const claim of claims) {
        const definition = semanticDefinitionById.get(claim);
        if (!definition || definition.kind !== kind) error("CURR_SEMANTIC_UNDEFINED", `${path}/${field}`, `${claim} is not a defined ${kind}.`, [utteranceRow.id, claim]);
        if (!unitScope.includes(claim)) error("CURR_ALIGNMENT_INCOMPLETE", `${path}/${field}`, `${claim} is outside ${unit.id}.`, [utteranceRow.id, claim]);
      }
    }
    validateReferenceList(utteranceRow.skillIds, skillById, unit.id, "skill", `${path}/skillIds`);
    validateReview(utteranceRow.review, `${path}/review`, `Utterance ${utteranceRow.id}`, [utteranceRow.id]);
  });

  const contextsBySkill = new Map(skillIds.map((id) => [id, new Set()]));
  const operationsBySkill = new Map(skillIds.map((id) => [id, new Set()]));
  const contextFingerprintOwners = new Map();
  contexts.forEach((contextRow, index) => {
    const path = `/contexts/${index}`;
    if (!isObject(contextRow)) {
      error("CURR_MANIFEST_SCHEMA", path, "Context must be an object.");
      return;
    }
    validateKeys(contextRow, ALLOWED_CONTEXT_KEYS, path, "CURR_REALIZATION_OVERRIDE");
    const unit = canonicalUnitById.get(contextRow.unitId);
    if (!contextRow.id || !unit) {
      error("CURR_REALIZATION_UNKNOWN_ITEM", `${path}/unitId`, `Context ${contextRow.id || index} references an unknown unit.`, [contextRow.id].filter(Boolean));
      return;
    }
    if (!Number.isInteger(contextRow.revision) || contextRow.revision < 1) error("CURR_REVISION_REQUIRED", `${path}/revision`, `Context ${contextRow.id} requires a positive revision.`, [contextRow.id]);
    if (contextRow.locale !== pack.targetLocale) error("CURR_REALIZATION_LOCALE", `${path}/locale`, `Context ${contextRow.id} locale must be ${pack.targetLocale}.`, [contextRow.id]);
    requireNonEmptyString(contextRow.descriptionEn, `${path}/descriptionEn`, `Context ${contextRow.id} English description`);
    if (!isObject(contextRow.featureValues) || Object.keys(contextRow.featureValues).length === 0) error("CURR_COVERAGE_INSUFFICIENT", `${path}/featureValues`, `Context ${contextRow.id} requires structured feature values.`, [contextRow.id]);
    else {
      for (const [dimension, value] of Object.entries(contextRow.featureValues)) {
        if (!/^[a-z][a-z0-9-]+$/.test(dimension) || typeof value !== "string" || !/^[a-z0-9][a-z0-9.-]*$/.test(value)) error("CURR_MANIFEST_SCHEMA", `${path}/featureValues/${dimension}`, "Context feature names and values must be stable lowercase identifiers.", [contextRow.id]);
      }
      for (const dimension of asArray(unit.transferPolicy?.requiredContextDimensions)) {
        if (!String(contextRow.featureValues[dimension.id] || "").trim()) error("CURR_COVERAGE_INSUFFICIENT", `${path}/featureValues/${dimension.id}`, `Context ${contextRow.id} lacks canonical transfer dimension ${dimension.id}.`, [unit.id, contextRow.id, dimension.id]);
      }
    }
    const opportunities = requireArray(contextRow.opportunities, `${path}/opportunities`, `Context ${contextRow.id} opportunities`);
    const opportunityIds = opportunities.map((row) => row?.id);
    for (const duplicate of duplicateValues(opportunityIds)) error("CURR_ID_DUPLICATE", `${path}/opportunities`, `Duplicate opportunity ${duplicate}.`, [contextRow.id, duplicate]);
    opportunities.forEach((opportunityRow, opportunityIndex) => {
      const opportunityPath = `${path}/opportunities/${opportunityIndex}`;
      if (!isObject(opportunityRow)) {
        error("CURR_MANIFEST_SCHEMA", opportunityPath, "Opportunity must be an object.", [contextRow.id]);
        return;
      }
      validateKeys(opportunityRow, ALLOWED_OPPORTUNITY_KEYS, opportunityPath, "CURR_REALIZATION_OVERRIDE");
      requireNonEmptyString(opportunityRow.id, `${opportunityPath}/id`, "Opportunity ID");
      if (!OPPORTUNITY_OPERATIONS.has(opportunityRow.operation)) error("CURR_MANIFEST_SCHEMA", `${opportunityPath}/operation`, `Invalid opportunity operation ${opportunityRow.operation}.`, [contextRow.id]);
      const targetSkills = validateReferenceList(opportunityRow.targetSkillIds, skillById, unit.id, "skill", `${opportunityPath}/targetSkillIds`);
      const stimulusIds = validateReferenceList(opportunityRow.stimulusUtteranceIds, utteranceById, unit.id, "utterance", `${opportunityPath}/stimulusUtteranceIds`, { allowEmpty: true });
      const expectedIds = validateReferenceList(opportunityRow.expectedUtteranceIds, utteranceById, unit.id, "utterance", `${opportunityPath}/expectedUtteranceIds`, { allowEmpty: true });
      for (const id of [...stimulusIds, ...expectedIds]) opportunityUtteranceIds.add(id);
      if (["interpret", "discriminate"].includes(opportunityRow.operation) && stimulusIds.length === 0) error("CURR_COVERAGE_INSUFFICIENT", `${opportunityPath}/stimulusUtteranceIds`, `${opportunityRow.operation} requires a stimulus utterance.`, [contextRow.id, opportunityRow.id]);
      if (["retrieve", "produce"].includes(opportunityRow.operation) && expectedIds.length === 0) error("CURR_COVERAGE_INSUFFICIENT", `${opportunityPath}/expectedUtteranceIds`, `${opportunityRow.operation} requires an expected utterance.`, [contextRow.id, opportunityRow.id]);
      if (opportunityRow.operation === "respond" && (stimulusIds.length === 0 || expectedIds.length === 0)) error("CURR_COVERAGE_INSUFFICIENT", opportunityPath, "A response opportunity requires both a stimulus and an expected response.", [contextRow.id, opportunityRow.id]);
      const evidenceUtteranceIds = ["interpret", "discriminate"].includes(opportunityRow.operation) ? stimulusIds : expectedIds;
      for (const skillId of targetSkills) {
        contextsBySkill.get(skillId)?.add(contextRow.id);
        operationsBySkill.get(skillId)?.add(opportunityRow.operation);
        if (!evidenceUtteranceIds.some((id) => asArray(utteranceById.get(id)?.skillIds).includes(skillId))) {
          error("CURR_ALIGNMENT_INCOMPLETE", `${opportunityPath}/targetSkillIds`, `No evidence utterance in opportunity ${opportunityRow.id} supports skill ${skillId}.`, [contextRow.id, opportunityRow.id, skillId]);
        }
      }
    });
    const fingerprint = stableStringify({
      unitId: contextRow.unitId,
      featureValues: contextRow.featureValues,
      opportunities: opportunities.map((row) => ({
        operation: row?.operation,
        targetSkillIds: asArray(row?.targetSkillIds).slice().sort(),
        stimulusUtteranceIds: asArray(row?.stimulusUtteranceIds).slice().sort(),
        expectedUtteranceIds: asArray(row?.expectedUtteranceIds).slice().sort()
      }))
    });
    const fingerprintKey = `${contextRow.unitId}:${fingerprint}`;
    if (contextFingerprintOwners.has(fingerprintKey)) error("CURR_COVERAGE_INSUFFICIENT", path, `Context ${contextRow.id} is a semantic duplicate of ${contextFingerprintOwners.get(fingerprintKey)}.`, [contextRow.id, contextFingerprintOwners.get(fingerprintKey)]);
    else contextFingerprintOwners.set(fingerprintKey, contextRow.id);
    validateReview(contextRow.review, `${path}/review`, `Context ${contextRow.id}`, [contextRow.id]);
  });

  unitBindings.forEach((binding, bindingIndex) => {
    const unit = canonicalUnitById.get(binding?.unitId);
    if (!unit) return;
    const bindingPath = `/unitBindings/${bindingIndex}`;
    const declaredContextIds = asArray(binding.contextIds);
    const inventoryContextIds = contexts.filter((row) => row?.unitId === unit.id).map((row) => row.id);
    if (!sameSet(declaredContextIds, inventoryContextIds)) error("CURR_ALIGNMENT_INCOMPLETE", `${bindingPath}/contextIds`, "Unit contextIds must exactly equal the target context inventory for the unit.", [unit.id]);
    for (const skillId of asArray(binding.targetSkillIds)) {
      const skillContexts = [...(contextsBySkill.get(skillId) || [])].filter((id) => declaredContextIds.includes(id));
      if (skillContexts.length < unit.masteryPolicy.minimumDistinctContexts) {
        error("CURR_COVERAGE_INSUFFICIENT", `${bindingPath}/contextIds`, `Skill ${skillId} has ${skillContexts.length} executable contexts; ${unit.masteryPolicy.minimumDistinctContexts} are required.`, [unit.id, skillId]);
      }
      for (const dimension of asArray(unit.transferPolicy?.requiredContextDimensions)) {
        const values = new Set(skillContexts.map((id) => contextById.get(id)?.featureValues?.[dimension.id]).filter(Boolean));
        if (values.size < dimension.minimumDistinctValuesPerSkill) {
          error("CURR_COVERAGE_INSUFFICIENT", `${bindingPath}/contextIds`, `Skill ${skillId} varies ${dimension.id} across ${values.size} values; ${dimension.minimumDistinctValuesPerSkill} are required by the English backbone.`, [unit.id, skillId, dimension.id]);
        }
      }
      const requiredEvidenceModes = new Set(asArray(skillById.get(skillId)?.canonicalIds)
        .map((id) => semanticDefinitionById.get(id))
        .filter((definition) => definition?.kind === "function")
        .map((definition) => definition.requiredEvidenceMode));
      const operations = operationsBySkill.get(skillId) || new Set();
      const modeSatisfied = {
        comprehension: ["interpret", "discriminate"].some((operation) => operations.has(operation)),
        production: ["produce", "respond"].some((operation) => operations.has(operation)),
        interaction: operations.has("respond")
      };
      for (const mode of requiredEvidenceModes) {
        if (!modeSatisfied[mode]) error("CURR_ASSESSMENT_MISSING", `${bindingPath}/contextIds`, `Skill ${skillId} lacks an executable ${mode} opportunity required by its English-defined function.`, [unit.id, skillId, mode]);
      }
    }
    if (unit.masteryPolicy.requiresProduction) {
      const hasProductiveOpportunity = declaredContextIds.some((id) => asArray(contextById.get(id)?.opportunities).some((row) => ["produce", "respond"].includes(row.operation)));
      if (!hasProductiveOpportunity) error("CURR_ASSESSMENT_MISSING", `${bindingPath}/contextIds`, `Unit ${unit.id} requires production but has no productive opportunity.`, [unit.id]);
    }
  });

  for (const skillId of skillIds) if (!referencedSkillIds.has(skillId)) warn("CURR_WARN_UNUSED_REALIZATION", "/skills", `Skill ${skillId} is not referenced by a binding, utterance, or context.`, [skillId]);
  for (const utteranceId of utteranceIds) {
    if (!referencedUtteranceIds.has(utteranceId)) warn("CURR_WARN_UNUSED_REALIZATION", "/utterances", `Utterance ${utteranceId} is not referenced by a binding or context.`, [utteranceId]);
    else if (!opportunityUtteranceIds.has(utteranceId)) warn("CURR_WARN_NO_OPPORTUNITY", "/utterances", `Utterance ${utteranceId} has no executable context opportunity.`, [utteranceId]);
  }
  for (const contextId of contextIds) if (!referencedContextIds.has(contextId)) warn("CURR_WARN_UNUSED_REALIZATION", "/contexts", `Context ${contextId} is not referenced by a unit binding.`, [contextId]);

  if (pendingReviewItems.length) {
    warn(
      "CURR_WARN_REVIEW_PENDING",
      "/",
      `${pendingReviewItems.length} target realization records remain prototype-only and require human review before release.`,
      pendingReviewItems.flatMap((item) => item.relatedIds).slice(0, 20)
    );
  }

  const targetPackDigest = computeTargetPackDigest(pack);
  const approvalAttestationDigest = isObject(options.approvalAttestation)
    ? computeApprovalAttestationDigest(options.approvalAttestation)
    : null;
  if (options.previousPack && isObject(options.previousPack)) {
    for (const collectionName of ["skills", "utterances", "contexts"]) {
      const currentById = indexById(pack[collectionName]);
      for (const previousEntity of asArray(options.previousPack[collectionName])) {
        const currentEntity = currentById.get(previousEntity.id);
        if (!currentEntity) {
          error("CURR_ID_REMOVED", `/${collectionName}`, `Released target entity ${previousEntity.id} was removed without a migration.`, [previousEntity.id]);
        } else if (stableStringify(entityWithoutRevision(previousEntity)) !== stableStringify(entityWithoutRevision(currentEntity))
          && currentEntity.revision <= previousEntity.revision) {
          error("CURR_REVISION_REQUIRED", `/${collectionName}`, `Changed target entity ${currentEntity.id} must increase its revision.`, [currentEntity.id]);
        }
      }
    }
    if (computeTargetPackDigest(options.previousPack) !== targetPackDigest && options.previousPack.version === pack.version) {
      error("CURR_VERSION_REQUIRED", "/version", "A changed target realization pack must increase its version.");
    }
  }
  if (options.expectedPackDigest && options.expectedPackDigest !== targetPackDigest) error("CURR_PACK_DIGEST_MISMATCH", "/", `Trusted release lock expected target pack ${options.expectedPackDigest}, but loaded ${targetPackDigest}.`);
  if (options.requireHumanApproval) {
    if (!options.expectedPackDigest) error("CURR_RELEASE_PIN_REQUIRED", "/", "Release validation requires an externally trusted target-pack digest.");
    if (!options.expectedApprovalAttestationDigest) {
      error("CURR_RELEASE_ATTESTATION_PIN_REQUIRED", "/approvalAttestation", "Release validation requires an externally trusted approval-attestation digest.");
    } else if (approvalAttestationDigest && options.expectedApprovalAttestationDigest !== approvalAttestationDigest) {
      error("CURR_RELEASE_ATTESTATION_DIGEST_MISMATCH", "/approvalAttestation", `Trusted approval lock expected ${options.expectedApprovalAttestationDigest}, but loaded ${approvalAttestationDigest}.`);
    }
    for (const issue of collectReleaseAttestationIssues(
      options.approvalAttestation,
      curriculum,
      pack,
      digest,
      targetPackDigest,
      options.validationTime
    )) {
      error("CURR_RELEASE_ATTESTATION", issue.path, issue.message);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    canonicalContractDigest: digest,
    targetPackDigest,
    approvalAttestationDigest,
    summary: {
      canonicalUnits: canonicalUnits.length,
      semanticDefinitions: semanticDefinitions.length,
      realizedUnits: unitBindings.length,
      targetSkills: skills.length,
      utterances: utterances.length,
      contexts: contexts.length
    }
  };
}

function parseArguments(argv) {
  const result = { requireHumanApproval: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--curriculum") result.curriculumPath = argv[++index];
    else if (token === "--pack") result.packPath = argv[++index];
    else if (token === "--previous-curriculum") result.previousCurriculumPath = argv[++index];
    else if (token === "--previous-pack") result.previousPackPath = argv[++index];
    else if (token === "--expected-canonical-digest") result.expectedCanonicalDigest = argv[++index];
    else if (token === "--expected-pack-digest") result.expectedPackDigest = argv[++index];
    else if (token === "--approval-attestation") result.approvalAttestationPath = argv[++index];
    else if (token === "--expected-attestation-digest") result.expectedApprovalAttestationDigest = argv[++index];
    else if (token === "--require-human-approval") result.requireHumanApproval = true;
    else if (token === "--print-digest") result.printDigest = true;
    else throw new Error(`Unknown argument: ${token}`);
  }
  return result;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  if (!args.curriculumPath) throw new Error("--curriculum is required");
  const curriculum = await readJson(args.curriculumPath);
  if (args.printDigest && !args.packPath) {
    if (curriculum.schemaVersion !== CURRICULUM_SCHEMA || !Array.isArray(curriculum.units) || !Array.isArray(curriculum.semanticDefinitions)) throw new Error("Refusing to digest an invalid canonical manifest shape.");
    process.stdout.write(`${computeCanonicalContractDigest(curriculum)}\n`);
    return;
  }
  if (!args.packPath) throw new Error("--pack is required");
  const pack = await readJson(args.packPath);
  const previousCanonical = args.previousCurriculumPath ? await readJson(args.previousCurriculumPath) : undefined;
  const previousPack = args.previousPackPath ? await readJson(args.previousPackPath) : undefined;
  const approvalAttestation = args.approvalAttestationPath ? await readJson(args.approvalAttestationPath) : undefined;
  const result = validateConformance(curriculum, pack, {
    requireHumanApproval: args.requireHumanApproval,
    expectedCanonicalDigest: args.expectedCanonicalDigest,
    expectedPackDigest: args.expectedPackDigest,
    expectedApprovalAttestationDigest: args.expectedApprovalAttestationDigest,
    approvalAttestation,
    previousCanonical,
    previousPack
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.valid) process.exitCode = 1;
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
