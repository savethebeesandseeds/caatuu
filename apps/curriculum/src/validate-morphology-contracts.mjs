import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import {
  computeCanonicalContractDigest,
  computeTargetPackDigest
} from "./validate-conformance.mjs";
import {
  MorphologyRoundError,
  normalizeMorphologyCatalog
} from "../runtime/morphology-round-core.mjs";
import {
  JsonSchemaSubsetError,
  validateJsonSchemaSubset
} from "./json-schema-subset.mjs";

const MECHANIC_CATALOG_SCHEMA = "caatuu-shared-mechanic-capability-catalog-v1";
const MORPHOLOGY_CATALOG_SCHEMA = "caatuu-morphology-developer-pilot-v1";
const CONJUGATION_COMET_ACTIVITY_ID = "conjugation-comet";
const CONJUGATION_COMET_EXERCISE_FAMILY_ID = "conjugation-comet.contextual-target-realization";
const MECHANIC_CATALOG_SCHEMA_URL = new URL(
  "../schemas/shared-mechanic-capability-catalog.schema.json",
  import.meta.url
);
const MORPHOLOGY_CATALOG_SCHEMA_URL = new URL(
  "../schemas/target-morphology-catalog.schema.json",
  import.meta.url
);
const PILOT_REVIEW_STATUS = "prototype-not-human-approved";
const CUE_ENGLISH_FIELDS = [
  "roleTokenEn",
  "contextEn",
  "naturalTranslationEn",
  "teachingLabelEn",
  "hintEn",
  "solutionExplanationEn"
];
const VISIBLE_CUE_ENGLISH_FIELDS = [
  "roleTokenEn",
  "contextEn",
  "naturalTranslationEn",
  "teachingLabelEn"
];
const DIFFICULTY_AUTHORITY_FIELDS = new Set([
  "learningStage",
  "evidenceKind",
  "maximumIndependence",
  "scoreRequired",
  "masteryEligible",
  "requiredLearningStages",
  "masteryPolicy",
  "operation",
  "responseMode",
  "targetLanguageProduction"
]);
const VISIBLE_CHOICE_CONTRACT = {
  mechanicShape: {
    operation: "discriminate",
    responseMode: "closed-choice",
    candidateVisibility: "target-language-options-visible",
    targetLanguageProduction: false
  },
  evidenceCeiling: {
    learningStage: "discriminate",
    evidenceKind: "comprehension",
    maximumIndependence: "independent",
    scoreRequired: true,
    masteryEligible: false
  }
};

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function indexById(rows) {
  return new Map(asArray(rows).filter((row) => row?.id).map((row) => [row.id, row]));
}

function sameRef(left, right) {
  return left?.id === right?.id && left?.revision === right?.revision;
}

function sameFeatureValue(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right)) return Object.is(left, right);
  if (left.length !== right.length) return false;
  const key = (value) => `${typeof value}:${JSON.stringify(value)}`;
  const leftKeys = left.map(key).sort();
  const rightKeys = right.map(key).sort();
  return leftKeys.every((value, index) => value === rightKeys[index]);
}

function sameStringSet(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  return leftSet.size === left.length
    && rightSet.size === right.length
    && [...leftSet].every((value) => rightSet.has(value));
}

function refKey(reference) {
  return `${reference?.id}@${reference?.revision}`;
}

function sameRefSet(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && sameStringSet(left.map(refKey), right.map(refKey));
}

function visibleCueKey(presentation) {
  if (!isObject(presentation)) return null;
  const values = VISIBLE_CUE_ENGLISH_FIELDS.map((field) => presentation[field]);
  if (values.some((value) => !nonEmptyString(value))) return null;
  return JSON.stringify(values.map((value) => (
    value.trim().replace(/\s+/gu, " ").toLocaleLowerCase("en")
  )));
}

function nonEmptyString(value) {
  return typeof value === "string" && Boolean(value.trim());
}

function entityKey(entityType, id) {
  return `${entityType}:${id}`;
}

function findCycle(graph) {
  const visiting = new Set();
  const visited = new Set();
  const stack = [];

  function visit(node) {
    if (visiting.has(node)) {
      const start = stack.indexOf(node);
      return [...stack.slice(start), node];
    }
    if (visited.has(node)) return null;
    visiting.add(node);
    stack.push(node);
    for (const child of graph.get(node) || []) {
      const cycle = visit(child);
      if (cycle) return cycle;
    }
    stack.pop();
    visiting.delete(node);
    visited.add(node);
    return null;
  }

  for (const node of graph.keys()) {
    const cycle = visit(node);
    if (cycle) return cycle;
  }
  return null;
}

/**
 * Validate the English-owned shared mechanic contract and one target-language
 * morphology catalog against their exact curriculum and target-pack revisions.
 *
 * Difficulty is deliberately treated as advisory metadata. Evidence strength
 * is owned exclusively by the shared mechanic capability catalog.
 */
export function validateMorphologyContracts(inputs, options = {}) {
  const curriculum = inputs?.curriculum;
  const targetPack = inputs?.targetPack;
  const mechanicCatalog = inputs?.mechanicCatalog;
  const morphologyCatalog = inputs?.morphologyCatalog;
  const mechanicCatalogSchema = inputs?.mechanicCatalogSchema;
  const morphologyCatalogSchema = inputs?.morphologyCatalogSchema;
  const sourceCatalog = inputs?.sourceCatalog;
  const bindingRegistry = inputs?.bindingRegistry;
  const mechanicCatalogDigest = inputs?.mechanicCatalogDigest;
  const morphologyCatalogDigest = inputs?.morphologyCatalogDigest;
  const errors = [];
  const warnings = [];
  let pendingReviewCount = 0;

  const report = (severity, code, path, message, relatedIds = []) => {
    const entry = { severity, code, path, relatedIds, message };
    (severity === "error" ? errors : warnings).push(entry);
  };
  const error = (code, path, message, relatedIds) => report("error", code, path, message, relatedIds);
  const warn = (code, path, message, relatedIds) => report("warning", code, path, message, relatedIds);

  const validateSchemaGate = (schema, value, code, instancePath, label) => {
    if (!isObject(schema)) {
      error(
        "MORPH_SCHEMA_CONFIGURATION",
        instancePath,
        `${label} requires its shipped JSON Schema in the authoring gate.`
      );
      return;
    }
    try {
      const result = validateJsonSchemaSubset(schema, value, { instancePath });
      for (const issue of result.errors) {
        error(
          code,
          issue.instancePath || instancePath,
          `${label}: ${issue.message} (${issue.keyword} at ${issue.schemaPath})`
        );
      }
    } catch (caught) {
      const detail = caught instanceof JsonSchemaSubsetError
        ? `${caught.message} (${caught.code} at ${caught.schemaPath})`
        : caught?.message || "Schema validation failed.";
      error("MORPH_SCHEMA_CONFIGURATION", instancePath, `${label}: ${detail}`);
    }
  };

  const validateNfc = (value, path, ancestors = new WeakSet()) => {
    if (typeof value === "string") {
      if (value.normalize("NFC") !== value) {
        error("MORPH_NORMALIZATION", path, "Contract strings must be Unicode NFC normalized.");
      }
      return;
    }
    if (!value || typeof value !== "object" || ancestors.has(value)) return;
    ancestors.add(value);
    if (Array.isArray(value)) {
      value.forEach((entry, index) => validateNfc(entry, `${path}/${index}`, ancestors));
    } else {
      for (const [key, child] of Object.entries(value)) {
        validateNfc(key, `${path}/${key}`, ancestors);
        validateNfc(child, `${path}/${key}`, ancestors);
      }
    }
    ancestors.delete(value);
  };

  const validateReview = (review, path, label) => {
    if (!isObject(review) || !nonEmptyString(review.status)) {
      error("MORPH_CONTRACT_SCHEMA", path, `${label} requires explicit review metadata.`);
      return;
    }
    if (review.status === PILOT_REVIEW_STATUS) {
      pendingReviewCount += 1;
    } else if (review.status === "rejected") {
      error("MORPH_REVIEW_REJECTED", `${path}/status`, `${label} is explicitly rejected.`);
    } else if (review.status !== "human-approved") {
      error("MORPH_CONTRACT_SCHEMA", `${path}/status`, `${label} has an unsupported review status.`);
    }
    if (!nonEmptyString(review.notesEn)) {
      error("MORPH_CONTRACT_SCHEMA", `${path}/notesEn`, `${label} review notes must be authored in English.`);
    }
  };

  const validateDifficulty = (difficulty, path) => {
    if (!isObject(difficulty)) {
      error("MORPH_CONTRACT_SCHEMA", path, "Difficulty metadata must be an object.");
      return;
    }
    if (difficulty.advisoryOnly !== true) {
      error(
        "MORPH_DIFFICULTY_NOT_ADVISORY",
        `${path}/advisoryOnly`,
        "Morphology difficulty can guide sequencing but cannot own progression or evidence."
      );
    }
    const authorityFields = Object.keys(difficulty).filter((key) => DIFFICULTY_AUTHORITY_FIELDS.has(key));
    if (authorityFields.length) {
      error(
        "MORPH_DIFFICULTY_EVIDENCE_AUTHORITY",
        path,
        "Difficulty metadata cannot declare a learning stage, evidence strength, or mastery authority.",
        authorityFields
      );
    }
    if (!Number.isInteger(difficulty.level) || difficulty.level < 1) {
      error("MORPH_CONTRACT_SCHEMA", `${path}/level`, "Difficulty level must be a positive advisory integer.");
    }
    if (!nonEmptyString(difficulty.dimension) || !nonEmptyString(difficulty.rationaleEn)) {
      error("MORPH_CONTRACT_SCHEMA", path, "Difficulty requires a dimension and English rationale.");
    }
  };

  const validateProvenance = (provenance, path) => {
    const required = [
      "sourceType",
      "sourceId",
      "sourceRevision",
      "licenseId",
      "attributionEn",
      "transformationEn"
    ];
    if (!isObject(provenance) || required.some((key) => !nonEmptyString(provenance[key]))) {
      error("MORPH_CONTRACT_SCHEMA", path, "Morphology records require stable provenance and English transformation notes.");
    }
  };

  const resolveRevisionRef = (ref, rowsById, codePrefix, path, label) => {
    if (!isObject(ref) || !nonEmptyString(ref.id)) {
      error(`${codePrefix}_UNKNOWN`, path, `${label} reference is missing or malformed.`);
      return null;
    }
    const current = rowsById.get(ref.id);
    if (!current) {
      error(`${codePrefix}_UNKNOWN`, path, `${label} ${ref.id} is unknown.`, [ref.id]);
      return null;
    }
    if (current.revision !== ref.revision) {
      error(
        `${codePrefix}_STALE`,
        path,
        `${label} ${ref.id} must pin revision ${current.revision}.`,
        [ref.id]
      );
      return null;
    }
    return current;
  };

  if (!isObject(curriculum) || !isObject(targetPack) || !isObject(mechanicCatalog) || !isObject(morphologyCatalog)) {
    error(
      "MORPH_CONTRACT_SCHEMA",
      "/",
      "Curriculum, target pack, mechanic catalog, and morphology catalog must all be objects."
    );
    return {
      valid: false,
      errors,
      warnings,
      digests: {
        canonicalContractDigest: null,
        targetPackDigest: null,
        mechanicCatalogDigest: mechanicCatalogDigest || null,
        morphologyCatalogDigest: morphologyCatalogDigest || null
      },
      summary: {
        capabilityFamilies: 0,
        capabilities: 0,
        morphologyFamilies: 0,
        morphologyItems: 0,
        morphologyCues: 0,
        morphologyExercises: 0
      }
    };
  }

  validateSchemaGate(
    mechanicCatalogSchema,
    mechanicCatalog,
    "MORPH_MECHANIC_SCHEMA",
    "/mechanicCatalog",
    "Shared mechanic capability catalog"
  );
  validateSchemaGate(
    morphologyCatalogSchema,
    morphologyCatalog,
    "MORPH_CATALOG_SCHEMA",
    "/morphologyCatalog",
    "Target morphology catalog"
  );

  validateNfc(mechanicCatalog, "/mechanicCatalog");
  validateNfc(morphologyCatalog, "/morphologyCatalog");

  let normalizedCatalog = null;
  try {
    normalizedCatalog = normalizeMorphologyCatalog(morphologyCatalog);
  } catch (caught) {
    if (caught instanceof MorphologyRoundError) {
      error(
        caught.code,
        caught.details?.path || "/morphologyCatalog",
        caught.message,
        [caught.details?.id, caught.details?.familyId, caught.details?.itemId, caught.details?.cueId].filter(Boolean)
      );
    } else {
      error("MORPH_CONTRACT_SCHEMA", "/morphologyCatalog", caught?.message || "Morphology normalization failed.");
    }
  }

  const capabilityFamilies = asArray(mechanicCatalog.capabilityFamilies);
  const capabilities = asArray(mechanicCatalog.capabilities);
  const capabilityFamilyById = indexById(capabilityFamilies);
  const capabilityById = indexById(capabilities);

  if (mechanicCatalog.schemaVersion !== MECHANIC_CATALOG_SCHEMA) {
    error("MORPH_CONTRACT_SCHEMA", "/mechanicCatalog/schemaVersion", `Expected ${MECHANIC_CATALOG_SCHEMA}.`);
  }
  if (mechanicCatalog.specLocale !== "en" || mechanicCatalog.authority !== "english-authored-shared-contract") {
    error(
      "MORPH_AUTHORING_LOCALE",
      "/mechanicCatalog",
      "Shared mechanic capability contracts must be English-authored authority."
    );
  }
  if (capabilityFamilyById.size !== capabilityFamilies.length || capabilityById.size !== capabilities.length) {
    error("MORPH_CONTRACT_SCHEMA", "/mechanicCatalog", "Capability family and capability IDs must be unique.");
  }
  for (const [index, family] of capabilityFamilies.entries()) {
    const path = `/mechanicCatalog/capabilityFamilies/${index}`;
    if (!nonEmptyString(family?.id) || !Number.isInteger(family?.revision) || family.revision < 1) {
      error("MORPH_CONTRACT_SCHEMA", path, "Capability families require stable IDs and positive revisions.");
    }
    if (!nonEmptyString(family?.definitionEn)) {
      error("MORPH_CONTRACT_SCHEMA", `${path}/definitionEn`, "Capability family definitions must be authored in English.");
    }
  }

  const capabilityGraph = new Map();
  for (const [index, capability] of capabilities.entries()) {
    const path = `/mechanicCatalog/capabilities/${index}`;
    if (!nonEmptyString(capability?.id) || !Number.isInteger(capability?.revision) || capability.revision < 1) {
      error("MORPH_CONTRACT_SCHEMA", path, "Capabilities require stable IDs and positive revisions.");
      continue;
    }
    if (!capabilityFamilyById.has(capability.familyId)) {
      error("MORPH_CONTRACT_SCHEMA", `${path}/familyId`, `Capability family ${capability.familyId} is unknown.`);
    }
    if (!nonEmptyString(capability.definitionEn) || capability.contextRequirement !== "required") {
      error("MORPH_CONTRACT_SCHEMA", path, "Contextual target realization requires an English definition and visible context.");
    }
    const requiredCanonicalDimensions = capability?.requiredCanonicalContextDimensionIds;
    if (!Array.isArray(requiredCanonicalDimensions)
        || requiredCanonicalDimensions.length === 0
        || new Set(requiredCanonicalDimensions).size !== requiredCanonicalDimensions.length
        || requiredCanonicalDimensions.some((dimensionId) => !nonEmptyString(dimensionId))) {
      error(
        "MORPH_CONTRACT_SCHEMA",
        `${path}/requiredCanonicalContextDimensionIds`,
        "Each contextual capability must name its required English-curriculum context dimensions."
      );
    }
    const visibleTargetOptions = capability?.mechanicShape?.candidateVisibility === "target-language-options-visible"
      || capability?.id === "capability.contextual-target-realization.visible-form-choice";
    if (visibleTargetOptions) {
      for (const [section, expected] of Object.entries(VISIBLE_CHOICE_CONTRACT)) {
        for (const [field, expectedValue] of Object.entries(expected)) {
          if (capability?.[section]?.[field] !== expectedValue) {
            error(
              "MORPH_CAPABILITY_CEILING",
              `${path}/${section}/${field}`,
              "Visible target-form choices are capped at discrimination, comprehension evidence, and non-mastery.",
              [capability.id]
            );
          }
        }
      }
    }
    const prerequisiteIds = asArray(capability.prerequisiteCapabilityIds);
    capabilityGraph.set(capability.id, new Set(prerequisiteIds));
    for (const prerequisiteId of prerequisiteIds) {
      if (!capabilityById.has(prerequisiteId)) {
        error("MORPH_CAPABILITY_REF_UNKNOWN", `${path}/prerequisiteCapabilityIds`, `Capability ${prerequisiteId} is unknown.`);
      }
    }
  }
  const capabilityCycle = findCycle(capabilityGraph);
  if (capabilityCycle) {
    error(
      "MORPH_CAPABILITY_PREREQUISITE_CYCLE",
      "/mechanicCatalog/capabilities",
      "Shared capability prerequisites cannot form a cycle.",
      capabilityCycle
    );
  }

  const canonicalDigest = computeCanonicalContractDigest(curriculum);
  const targetPackDigest = computeTargetPackDigest(targetPack);
  const metadata = morphologyCatalog.metadata;
  if (morphologyCatalog.schemaVersion !== MORPHOLOGY_CATALOG_SCHEMA) {
    error("MORPH_CONTRACT_SCHEMA", "/morphologyCatalog/schemaVersion", `Expected ${MORPHOLOGY_CATALOG_SCHEMA}.`);
  }
  if (!isObject(metadata) || metadata.specLocale !== "en") {
    error("MORPH_AUTHORING_LOCALE", "/morphologyCatalog/metadata/specLocale", "Morphology teaching specifications must be authored in English.");
  }
  if (!nonEmptyString(metadata?.stableContentId)
      || metadata?.activityId !== CONJUGATION_COMET_ACTIVITY_ID
      || metadata?.exerciseFamilyId !== CONJUGATION_COMET_EXERCISE_FAMILY_ID) {
    error(
      "MORPH_CONTRACT_SCHEMA",
      "/morphologyCatalog/metadata",
      `Morphology catalogs require a stable content ID and ${CONJUGATION_COMET_ACTIVITY_ID}/${CONJUGATION_COMET_EXERCISE_FAMILY_ID} ownership.`
    );
  }
  if (morphologyCatalog.targetLocale !== targetPack.targetLocale) {
    error("MORPH_TARGET_LOCALE_MISMATCH", "/morphologyCatalog/targetLocale", "Morphology and target-pack locales must match.");
  }
  if (metadata?.curriculum?.id !== curriculum.curriculumId || metadata?.curriculum?.version !== curriculum.version) {
    error("MORPH_CURRICULUM_REF_MISMATCH", "/morphologyCatalog/metadata/curriculum", "Morphology catalog must pin the loaded English curriculum ID and version.");
  }
  if (metadata?.curriculum?.canonicalContractDigest !== canonicalDigest) {
    error(
      "MORPH_CURRICULUM_DIGEST_MISMATCH",
      "/morphologyCatalog/metadata/curriculum/canonicalContractDigest",
      `Morphology catalog must pin canonical contract ${canonicalDigest}.`
    );
  }
  if (metadata?.targetPack?.id !== targetPack.packId
    || metadata?.targetPack?.version !== targetPack.version
    || metadata?.targetPack?.targetLocale !== targetPack.targetLocale) {
    error("MORPH_TARGET_PACK_REF_MISMATCH", "/morphologyCatalog/metadata/targetPack", "Morphology catalog must pin the loaded target pack ID, version, and locale.");
  }
  if (metadata?.targetPack?.targetPackDigest !== targetPackDigest) {
    error(
      "MORPH_TARGET_PACK_DIGEST_MISMATCH",
      "/morphologyCatalog/metadata/targetPack/targetPackDigest",
      `Morphology catalog must pin target pack ${targetPackDigest}.`
    );
  }
  if (metadata?.mechanicCatalog?.id !== mechanicCatalog.catalogId
    || metadata?.mechanicCatalog?.version !== mechanicCatalog.version) {
    error("MORPH_MECHANIC_CATALOG_REF_MISMATCH", "/morphologyCatalog/metadata/mechanicCatalog", "Morphology catalog must pin the loaded shared mechanic catalog.");
  }
  if (!/^sha256:[a-f0-9]{64}$/u.test(String(mechanicCatalogDigest || ""))
    || metadata?.mechanicCatalog?.digest !== mechanicCatalogDigest) {
    error(
      "MORPH_MECHANIC_CATALOG_DIGEST_MISMATCH",
      "/morphologyCatalog/metadata/mechanicCatalog/digest",
      "Morphology catalog must pin the exact loaded English shared mechanic catalog bytes."
    );
  }

  const releasePolicy = metadata?.releasePolicy;
  const permanentDeveloperOnly = releasePolicy?.status === "developer-only"
    && releasePolicy?.requiresNewCatalogForRelease === true;
  if (!permanentDeveloperOnly || options.requireHumanApproval) {
    error(
      "MORPH_RELEASE_INELIGIBLE",
      "/morphologyCatalog/metadata/releasePolicy",
      "This developer-pilot catalog can never become learner-release content in place; release requires a new catalog."
    );
  }

  validateReview(morphologyCatalog.review, "/morphologyCatalog/review", "Morphology catalog");

  const unitsById = indexById(curriculum.units);
  const semanticsById = indexById(curriculum.semanticDefinitions);
  const targetSkillsById = indexById(targetPack.skills);
  const families = asArray(morphologyCatalog.families);
  const items = asArray(morphologyCatalog.items);
  const cues = asArray(morphologyCatalog.cues);
  const familiesById = indexById(families);
  const itemsById = indexById(items);
  const cuesById = indexById(cues);
  const prerequisiteRegistry = new Map();
  const prerequisiteGraph = new Map();
  const prerequisiteOwners = [];
  const variantIds = new Set();
  const exerciseIds = new Set();
  const exerciseById = new Map();
  const visibleCueOwners = new Map();

  const registerPrerequisiteEntity = (entityType, ref, path) => {
    if (!isObject(ref) || !nonEmptyString(ref.id) || !Number.isInteger(ref.revision)) {
      error("MORPH_CONTRACT_SCHEMA", path, `${entityType} identity must include an ID and positive revision.`);
      return null;
    }
    const key = entityKey(entityType, ref.id);
    const prior = prerequisiteRegistry.get(key);
    if (prior && prior.revision !== ref.revision) {
      error("MORPH_METADATA_REF_MISMATCH", path, `${entityType} ${ref.id} is declared at conflicting revisions.`);
    } else if (!prior) {
      prerequisiteRegistry.set(key, { ...ref, entityType });
    }
    return key;
  };

  for (const [index, family] of families.entries()) {
    const path = `/morphologyCatalog/families/${index}`;
    const familyMetadata = family?.metadata;
    validateReview(family?.review, `${path}/review`, `Family ${family?.id || index}`);
    if (!isObject(familyMetadata)) {
      error("MORPH_CONTRACT_SCHEMA", `${path}/metadata`, "Morphology family metadata is required.");
      continue;
    }
    validateReview(familyMetadata.review, `${path}/metadata/review`, `Family metadata ${family.id}`);
    validateDifficulty(familyMetadata.difficulty, `${path}/metadata/difficulty`);
    validateProvenance(familyMetadata.provenance, `${path}/metadata/provenance`);
    const lexemeKey = registerPrerequisiteEntity("lexeme", family.lemmaRef, `${path}/lemmaRef`);
    registerPrerequisiteEntity("sense", familyMetadata.senseRef, `${path}/metadata/senseRef`);
    prerequisiteOwners.push({
      ownerKey: lexemeKey,
      refs: familyMetadata.prerequisiteRefs,
      path: `${path}/metadata/prerequisiteRefs`
    });

    const unit = resolveRevisionRef(
      familyMetadata.unitRef,
      unitsById,
      "MORPH_UNIT_REF",
      `${path}/metadata/unitRef`,
      "Curriculum unit"
    );
    const targetSkill = resolveRevisionRef(
      familyMetadata.targetSkillRef,
      targetSkillsById,
      "MORPH_TARGET_SKILL_REF",
      `${path}/metadata/targetSkillRef`,
      "Target skill"
    );
    const capability = resolveRevisionRef(
      familyMetadata.capabilityRef,
      capabilityById,
      "MORPH_CAPABILITY_REF",
      `${path}/metadata/capabilityRef`,
      "Shared mechanic capability"
    );
    if (familyMetadata.exerciseFamilyId !== metadata.exerciseFamilyId) {
      error("MORPH_EXERCISE_FAMILY_MISMATCH", `${path}/metadata/exerciseFamilyId`, "Family and catalog exercise-family IDs must match.");
    }
    if (targetSkill) {
      if (targetSkill.requiredForOutcome !== false) {
        error(
          "MORPH_TARGET_SKILL_OUTCOME_SCOPE",
          `/targetPack/skills/${targetSkill.id}/requiredForOutcome`,
          "Form discrimination is supplemental and cannot redefine the English-owned unit outcome.",
          [targetSkill.id]
        );
      }
      if (targetSkill.kind !== "form"
        || targetSkill.unitId !== familyMetadata.unitRef?.id
        || targetSkill.locale !== targetPack.targetLocale) {
        error("MORPH_METADATA_REF_MISMATCH", `${path}/metadata/targetSkillRef`, "Target skill kind, unit, and locale must match the morphology family.");
      }
    }
    if (unit && targetSkill && targetSkill.unitId !== unit.id) {
      error("MORPH_METADATA_REF_MISMATCH", `${path}/metadata/unitRef`, "Family unit and target-skill unit must match.");
    }
    if (capability && capability.mechanicShape?.candidateVisibility !== "target-language-options-visible") {
      error("MORPH_CAPABILITY_CEILING", `${path}/metadata/capabilityRef`, "This pilot requires the visible target-form choice capability.");
    }
    for (const [semanticIndex, semanticRef] of asArray(familyMetadata.canonicalSemanticRefs).entries()) {
      const semantic = resolveRevisionRef(
        semanticRef,
        semanticsById,
        "MORPH_SEMANTIC_REF",
        `${path}/metadata/canonicalSemanticRefs/${semanticIndex}`,
        "English semantic definition"
      );
      if (semantic && targetSkill && !asArray(targetSkill.canonicalIds).includes(semantic.id)) {
        error("MORPH_METADATA_REF_MISMATCH", `${path}/metadata/canonicalSemanticRefs/${semanticIndex}`, "Target skill must retain every English semantic reference used by the morphology family.");
      }
    }
  }

  for (const [index, item] of items.entries()) {
    const path = `/morphologyCatalog/items/${index}`;
    const family = familiesById.get(item?.familyRef?.id);
    const itemMetadata = item?.metadata;
    validateReview(item?.review, `${path}/review`, `Item ${item?.id || index}`);
    registerPrerequisiteEntity("form", { id: item?.id, revision: item?.revision }, `${path}`);
    if (!isObject(itemMetadata)) {
      error("MORPH_CONTRACT_SCHEMA", `${path}/metadata`, "Morphology item metadata is required.");
      continue;
    }
    validateReview(itemMetadata.review, `${path}/metadata/review`, `Item metadata ${item.id}`);
    validateDifficulty(itemMetadata.difficulty, `${path}/metadata/difficulty`);
    validateProvenance(itemMetadata.provenance, `${path}/metadata/provenance`);
    prerequisiteOwners.push({
      ownerKey: entityKey("form", item.id),
      refs: itemMetadata.prerequisiteRefs,
      path: `${path}/metadata/prerequisiteRefs`
    });
    if (itemMetadata.normalization !== "NFC" || item.surface?.normalize("NFC") !== item.surface) {
      error("MORPH_NORMALIZATION", `${path}/surface`, "Morphology surfaces must explicitly use Unicode NFC normalization.");
    }
    if (!sameRef(itemMetadata.formRef, item)
      || !family
      || !sameRef(itemMetadata.lexemeRef, family.lemmaRef)
      || !sameRef(itemMetadata.senseRef, family.metadata?.senseRef)
      || !sameRef(itemMetadata.unitRef, family.metadata?.unitRef)) {
      error("MORPH_METADATA_REF_MISMATCH", `${path}/metadata`, "Item lexeme, sense, form, and unit references must match its family and runtime identity.");
    }
    const variantRecords = asArray(itemMetadata.variantRecords);
    const preferred = variantRecords.filter((record) => record?.acceptance === "preferred");
    const accepted = variantRecords
      .filter((record) => record?.acceptance === "accepted")
      .map((record) => record.surface);
    let variantMismatch = preferred.length !== 1
      || preferred[0]?.surface !== item.surface
      || !sameStringSet(accepted, asArray(item.acceptedVariants));
    const localSurfaces = new Set();
    for (const [variantIndex, record] of variantRecords.entries()) {
      const variantPath = `${path}/metadata/variantRecords/${variantIndex}`;
      if (!nonEmptyString(record?.id) || !Number.isInteger(record?.revision) || record.revision < 1) {
        variantMismatch = true;
      }
      if (variantIds.has(record?.id)) {
        error("MORPH_METADATA_ID_DUPLICATE", `${variantPath}/id`, `Variant ID ${record.id} is duplicated.`);
      }
      variantIds.add(record?.id);
      if (!nonEmptyString(record?.surface)
        || record.surface.normalize("NFC") !== record.surface
        || localSurfaces.has(record.surface)) {
        variantMismatch = true;
      }
      localSurfaces.add(record?.surface);
    }
    if (variantMismatch) {
      error(
        "MORPH_VARIANT_METADATA_MISMATCH",
        `${path}/metadata/variantRecords`,
        "Stable variant records must describe the runtime primary surface and accepted variants exactly.",
        [item.id]
      );
    }
  }

  for (const [index, cue] of cues.entries()) {
    const path = `/morphologyCatalog/cues/${index}`;
    const family = familiesById.get(cue?.familyRef?.id);
    const targetItem = itemsById.get(cue?.targetItemRef?.id);
    const cueMetadata = cue?.metadata;
    validateReview(cue?.review, `${path}/review`, `Cue ${cue?.id || index}`);
    registerPrerequisiteEntity("cue", { id: cue?.id, revision: cue?.revision }, path);
    const presentation = cue?.presentation;
    const presentationKeys = isObject(presentation) ? Object.keys(presentation) : [];
    if (!isObject(presentation)
      || !sameStringSet(presentationKeys, CUE_ENGLISH_FIELDS)
      || CUE_ENGLISH_FIELDS.some((field) => !nonEmptyString(presentation?.[field]))
      || presentation.naturalTranslationEn.trim().toLocaleLowerCase("en")
        === presentation.teachingLabelEn.trim().toLocaleLowerCase("en")) {
      error(
        "MORPH_CUE_ENGLISH_INVALID",
        `${path}/presentation`,
        "Cues require six complete English fields, with a natural translation distinct from the teaching label.",
        [cue?.id].filter(Boolean)
      );
    }
    const visibleKey = visibleCueKey(presentation);
    if (visibleKey) {
      const ownerKey = `${cue?.familyRef?.id || "(missing)"}\u0000${visibleKey}`;
      const priorCueId = visibleCueOwners.get(ownerKey);
      if (priorCueId) {
        error(
          "MORPH_CUE_VISIBLE_COLLISION",
          `${path}/presentation`,
          "Cues in one family must be distinguishable using only the English fields visible before an answer; hidden hints and solutions do not count.",
          [priorCueId, cue.id]
        );
      } else {
        visibleCueOwners.set(ownerKey, cue.id);
      }
    }
    if (!isObject(cueMetadata)) {
      error("MORPH_CONTRACT_SCHEMA", `${path}/metadata`, "Morphology cue metadata is required.");
      continue;
    }
    validateReview(cueMetadata.review, `${path}/metadata/review`, `Cue metadata ${cue.id}`);
    validateDifficulty(cueMetadata.difficulty, `${path}/metadata/difficulty`);
    validateProvenance(cueMetadata.provenance, `${path}/metadata/provenance`);
    prerequisiteOwners.push({
      ownerKey: entityKey("cue", cue.id),
      refs: cueMetadata.prerequisiteRefs,
      path: `${path}/metadata/prerequisiteRefs`
    });
    if (!family || !targetItem || !sameRef(targetItem.familyRef, family)) {
      error("MORPH_METADATA_REF_MISMATCH", path, "Cue, target item, and family references must agree.");
    } else {
      if (!sameRef(cueMetadata.senseRef, family.metadata?.senseRef)
        || !sameRef(cueMetadata.unitRef, family.metadata?.unitRef)
        || !sameRef(cueMetadata.targetSkillRef, family.metadata?.targetSkillRef)) {
        error("MORPH_METADATA_REF_MISMATCH", `${path}/metadata`, "Cue sense, unit, and target-skill references must match its family.");
      }
      const constraints = Object.entries(cueMetadata.targetFeatureConstraints || {});
      for (const [feature, expectedValue] of constraints) {
        if (!sameFeatureValue(targetItem.features?.[feature], expectedValue)) {
          error(
            "MORPH_FEATURE_CONSTRAINT_MISMATCH",
            `${path}/metadata/targetFeatureConstraints/${feature}`,
            `Cue feature constraint ${feature} does not select target item ${targetItem.id}.`,
            [cue.id, targetItem.id]
          );
        }
      }
      const selectedItems = items.filter((item) => (
        sameRef(item.familyRef, family)
        && constraints.every(([feature, expectedValue]) => sameFeatureValue(item.features?.[feature], expectedValue))
      ));
      if (constraints.length === 0
          || selectedItems.length !== 1
          || !sameRef(selectedItems[0], targetItem)) {
        error(
          "MORPH_FEATURE_CONSTRAINT_AMBIGUOUS",
          `${path}/metadata/targetFeatureConstraints`,
          "Cue feature constraints must select exactly its one target form within the family.",
          [cue.id, ...selectedItems.map((item) => item.id)]
        );
      }
    }
    const cueUnit = resolveRevisionRef(
      cueMetadata.unitRef,
      unitsById,
      "MORPH_UNIT_REF",
      `${path}/metadata/unitRef`,
      "Curriculum unit"
    );
    if (cueUnit && family) {
      const unitDimensionIds = new Set(asArray(
        cueUnit.transferPolicy?.requiredContextDimensions
      ).map((dimension) => dimension?.id).filter(nonEmptyString));
      const capability = capabilityById.get(family.metadata?.capabilityRef?.id);
      const requiredDimensionIds = asArray(
        capability?.requiredCanonicalContextDimensionIds
      );
      const canonicalFeatureValues = cueMetadata.canonicalFeatureValues;
      for (const dimensionId of requiredDimensionIds) {
        if (!unitDimensionIds.has(dimensionId)) {
          error(
            "MORPH_CANONICAL_CONTEXT_DIMENSION_UNKNOWN",
            `${path}/metadata/canonicalFeatureValues`,
            `Capability context dimension ${dimensionId} is not declared by English curriculum unit ${cueUnit.id}.`,
            [cue.id, cueUnit.id, dimensionId]
          );
        } else if (!Object.hasOwn(canonicalFeatureValues || {}, dimensionId)) {
          error(
            "MORPH_CANONICAL_CONTEXT_DIMENSION_MISSING",
            `${path}/metadata/canonicalFeatureValues/${dimensionId}`,
            `Cue ${cue.id} must supply English-curriculum context dimension ${dimensionId}.`,
            [cue.id, dimensionId]
          );
        }
      }
      for (const dimensionId of Object.keys(canonicalFeatureValues || {})) {
        if (!unitDimensionIds.has(dimensionId)) {
          error(
            "MORPH_CANONICAL_CONTEXT_DIMENSION_UNKNOWN",
            `${path}/metadata/canonicalFeatureValues/${dimensionId}`,
            `Cue context dimension ${dimensionId} is not declared by English curriculum unit ${cueUnit.id}; target-only distinctions belong in namespaced targetFeatureConstraints.`,
            [cue.id, cueUnit.id, dimensionId]
          );
        }
      }
    }
    const targetSkill = resolveRevisionRef(
      cueMetadata.targetSkillRef,
      targetSkillsById,
      "MORPH_TARGET_SKILL_REF",
      `${path}/metadata/targetSkillRef`,
      "Target skill"
    );
    if (targetSkill?.requiredForOutcome !== false) {
      error("MORPH_TARGET_SKILL_OUTCOME_SCOPE", `${path}/metadata/targetSkillRef`, "Morphology form discrimination must remain supplemental.", [targetSkill?.id].filter(Boolean));
    }

    const exercise = cueMetadata.exercise;
    if (!isObject(exercise) || !nonEmptyString(exercise.id) || !Number.isInteger(exercise.revision)) {
      error("MORPH_CONTRACT_SCHEMA", `${path}/metadata/exercise`, "Cue exercises require a stable ID and positive revision.");
      continue;
    }
    if (exerciseIds.has(exercise.id)) {
      error("MORPH_METADATA_ID_DUPLICATE", `${path}/metadata/exercise/id`, `Exercise ID ${exercise.id} is duplicated.`);
    }
    exerciseIds.add(exercise.id);
    exerciseById.set(exercise.id, exercise);
    registerPrerequisiteEntity("exercise", exercise, `${path}/metadata/exercise`);
    prerequisiteOwners.push({
      ownerKey: entityKey("exercise", exercise.id),
      refs: exercise.prerequisiteRefs,
      path: `${path}/metadata/exercise/prerequisiteRefs`
    });
    validateReview(exercise.review, `${path}/metadata/exercise/review`, `Exercise ${exercise.id}`);
    const capability = resolveRevisionRef(
      exercise.capabilityRef,
      capabilityById,
      "MORPH_CAPABILITY_REF",
      `${path}/metadata/exercise/capabilityRef`,
      "Shared mechanic capability"
    );
    if (exercise.exerciseFamilyId !== metadata.exerciseFamilyId
      || exercise.exerciseFamilyId !== family?.metadata?.exerciseFamilyId) {
      error("MORPH_EXERCISE_FAMILY_MISMATCH", `${path}/metadata/exercise/exerciseFamilyId`, "Exercise, family, and catalog exercise-family IDs must match.");
    }
    const expectedOptionCount = items.filter((item) => sameRef(item.familyRef, family)).length;
    if (exercise.challenge?.optionsVisible !== true
      || exercise.challenge?.optionCount !== expectedOptionCount
      || exercise.challenge?.distractorPolicy !== "same-family-feature-contrast"
      || exercise.challenge?.timePressure !== false
      || capability?.mechanicShape?.candidateVisibility !== "target-language-options-visible") {
      error(
        "MORPH_CAPABILITY_CEILING",
        `${path}/metadata/exercise/challenge`,
        "Pilot exercises must preserve visible, untimed, same-family discrimination exactly.",
        [exercise.id]
      );
    }
  }

  const stableSequence = metadata?.stableContentSequence;
  const orderedContentIds = asArray(stableSequence?.orderedContentIds);
  const orderedCueRefs = asArray(stableSequence?.orderedCueRefs);
  const orderedExerciseRefs = asArray(stableSequence?.orderedExerciseRefs);
  const sequenceLength = orderedContentIds.length;
  if (!isObject(stableSequence)
      || !nonEmptyString(stableSequence.id)
      || !Number.isInteger(stableSequence.revision)
      || stableSequence.revision < 1
      || sequenceLength !== 3
      || orderedCueRefs.length !== sequenceLength
      || orderedExerciseRefs.length !== sequenceLength
      || new Set(orderedContentIds).size !== sequenceLength
      || new Set(orderedCueRefs.map(refKey)).size !== sequenceLength
      || new Set(orderedExerciseRefs.map(refKey)).size !== sequenceLength
      || metadata?.stableContentId !== orderedContentIds[0]) {
    error(
      "MORPH_SEQUENCE_INVALID",
      "/morphologyCatalog/metadata/stableContentSequence",
      "The Czech developer pilot must declare three distinct stable content, cue, and exercise steps, with stableContentId pointing to step one."
    );
  } else {
    orderedCueRefs.forEach((cueRef, index) => {
      const cue = cuesById.get(cueRef?.id);
      const exerciseRef = orderedExerciseRefs[index];
      const exercise = exerciseById.get(exerciseRef?.id);
      const priorExerciseRef = index === 0 ? null : orderedExerciseRefs[index - 1];
      const exercisePrerequisites = asArray(exercise?.prerequisiteRefs)
        .filter((reference) => reference?.entityType === "exercise")
        .map(({ id, revision }) => ({ id, revision }));
      const expectedPrerequisites = priorExerciseRef ? [priorExerciseRef] : [];
      if (!cue
          || cue.revision !== cueRef?.revision
          || !exercise
          || exercise.revision !== exerciseRef?.revision
          || !sameRef(cue.metadata?.exercise, exerciseRef)
          || !sameRefSet(exercisePrerequisites, expectedPrerequisites)) {
        error(
          "MORPH_SEQUENCE_INVALID",
          `/morphologyCatalog/metadata/stableContentSequence/orderedCueRefs/${index}`,
          "Each ordered cue must own the matching exercise and require exactly the immediately preceding exercise.",
          [cueRef?.id, exerciseRef?.id].filter(Boolean)
        );
      }
    });

    if (sourceCatalog !== undefined) {
      const sequenceSources = orderedContentIds.map((contentId) => (
        asArray(sourceCatalog?.sources).filter((source) => (
          source?.catalogId === morphologyCatalog.catalogId && source?.contentId === contentId
        ))
      ));
      sequenceSources.forEach((matches, index) => {
        const source = matches[0];
        const cueRef = orderedCueRefs[index];
        const exerciseRef = orderedExerciseRefs[index];
        const cue = cuesById.get(cueRef.id);
        const family = familiesById.get(cue?.familyRef?.id);
        const expectedItems = items.filter((item) => sameRef(item.familyRef, family));
        const expectedCues = cues.filter((entry) => sameRef(entry.familyRef, family));
        if (matches.length !== 1
            || source?.catalogRevision !== morphologyCatalog.version
            || (morphologyCatalogDigest && source?.catalogDigest !== morphologyCatalogDigest)
            || source?.snapshot?.id !== orderedContentIds[index]
            || !sameRef(source?.snapshot?.familyRef, family)
            || !sameRefSet(source?.snapshot?.itemRefs, expectedItems)
            || !sameRefSet(source?.snapshot?.cueRefs, expectedCues)
            || !sameRef(source?.snapshot?.selectedCueRef, cueRef)
            || !sameRef(source?.snapshot?.targetItemRef, cue?.targetItemRef)
            || !sameRef(source?.snapshot?.exerciseRef, exerciseRef)
            || source?.snapshot?.sequenceRef?.id !== stableSequence.id
            || source?.snapshot?.sequenceRef?.revision !== stableSequence.revision
            || source?.snapshot?.sequenceStep !== index + 1
            || !sameRef(source?.snapshot?.capabilityRef, family?.metadata?.capabilityRef)
            || !sameRef(source?.snapshot?.targetSkillRef, family?.metadata?.targetSkillRef)) {
          error(
            "MORPH_SEQUENCE_SOURCE_MISMATCH",
            `/sourceCatalog/sources/${orderedContentIds[index]}`,
            "Each sequence source must pin the exact catalog, family members, selected cue/exercise, capability, target skill, and step number.",
            [orderedContentIds[index]]
          );
        }
      });
    }

    if (bindingRegistry !== undefined) {
      const sequences = asArray(bindingRegistry?.exerciseSequences)
        .filter((sequence) => sequence?.id === stableSequence.id);
      const sequence = sequences[0];
      const bindingById = indexById(bindingRegistry?.bindings);
      const memberBindings = asArray(sequence?.orderedBindingIds).map((bindingId) => bindingById.get(bindingId));
      const memberContentIds = memberBindings.map((binding) => binding?.contentRef?.contentId);
      if (sequences.length !== 1
          || sequence?.revision !== stableSequence.revision
          || sequence?.activityId !== metadata.activityId
          || sequence?.exerciseFamilyId !== metadata.exerciseFamilyId
          || !sameStringSet(memberContentIds, orderedContentIds)
          || memberBindings.some((binding, index) => (
            binding?.contentRef?.contentId !== orderedContentIds[index]
            || binding?.contentRef?.catalogRevision !== morphologyCatalog.version
            || (morphologyCatalogDigest && binding?.contentRef?.catalogDigest !== morphologyCatalogDigest)
          ))) {
        error(
          "MORPH_SEQUENCE_BINDING_MISMATCH",
          "/bindingRegistry/exerciseSequences",
          "The binding registry must preserve the exact authored 1sg to 2sg to 3sg content order.",
          [stableSequence.id]
        );
      }
    }
  }

  for (const { ownerKey, refs, path } of prerequisiteOwners) {
    if (!ownerKey) continue;
    const edges = prerequisiteGraph.get(ownerKey) || new Set();
    const seen = new Set();
    for (const [index, ref] of asArray(refs).entries()) {
      const refPath = `${path}/${index}`;
      const targetKey = entityKey(ref?.entityType, ref?.id);
      if (seen.has(targetKey)) {
        error("MORPH_CONTRACT_SCHEMA", refPath, "Prerequisite references must be unique.");
        continue;
      }
      seen.add(targetKey);
      const current = prerequisiteRegistry.get(targetKey);
      if (!current) {
        error("MORPH_PREREQUISITE_REF_UNKNOWN", refPath, `Prerequisite ${targetKey} is unknown.`);
        continue;
      }
      if (current.revision !== ref.revision) {
        error("MORPH_PREREQUISITE_REF_STALE", refPath, `Prerequisite ${targetKey} must pin revision ${current.revision}.`);
        continue;
      }
      if (targetKey === ownerKey) {
        error("MORPH_PREREQUISITE_CYCLE", refPath, "An entity cannot require itself.", [ownerKey]);
      }
      edges.add(targetKey);
    }
    prerequisiteGraph.set(ownerKey, edges);
  }
  const prerequisiteCycle = findCycle(prerequisiteGraph);
  if (prerequisiteCycle) {
    error(
      "MORPH_PREREQUISITE_CYCLE",
      "/morphologyCatalog",
      "Revision-pinned morphology prerequisites cannot form a cycle.",
      prerequisiteCycle
    );
  }

  if (pendingReviewCount > 0) {
    warn(
      "MORPH_REVIEW_PENDING",
      "/morphologyCatalog",
      `${pendingReviewCount} morphology catalog records remain prototype-only and require qualified target-language educator review.`
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    normalizedCatalog,
    digests: {
      canonicalContractDigest: canonicalDigest,
      targetPackDigest,
      mechanicCatalogDigest: mechanicCatalogDigest || null,
      morphologyCatalogDigest: morphologyCatalogDigest || null
    },
    summary: {
      capabilityFamilies: capabilityFamilies.length,
      capabilities: capabilities.length,
      morphologyFamilies: families.length,
      morphologyItems: items.length,
      morphologyCues: cues.length,
      morphologyExercises: exerciseIds.size
    }
  };
}

function parseArguments(argv) {
  const result = {
    requireHumanApproval: false,
    mechanicCatalogSchemaPath: MECHANIC_CATALOG_SCHEMA_URL,
    morphologyCatalogSchemaPath: MORPHOLOGY_CATALOG_SCHEMA_URL
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--curriculum") result.curriculumPath = argv[++index];
    else if (token === "--pack") result.targetPackPath = argv[++index];
    else if (token === "--mechanic-catalog") result.mechanicCatalogPath = argv[++index];
    else if (token === "--morphology-catalog") result.morphologyCatalogPath = argv[++index];
    else if (token === "--mechanic-schema") result.mechanicCatalogSchemaPath = argv[++index];
    else if (token === "--morphology-schema") result.morphologyCatalogSchemaPath = argv[++index];
    else if (token === "--source-catalog") result.sourceCatalogPath = argv[++index];
    else if (token === "--binding-registry") result.bindingRegistryPath = argv[++index];
    else if (token === "--require-human-approval") result.requireHumanApproval = true;
    else throw new Error(`Unknown argument: ${token}`);
  }
  for (const [name, path] of [
    ["--curriculum", result.curriculumPath],
    ["--pack", result.targetPackPath],
    ["--mechanic-catalog", result.mechanicCatalogPath],
    ["--morphology-catalog", result.morphologyCatalogPath],
    ["--source-catalog", result.sourceCatalogPath],
    ["--binding-registry", result.bindingRegistryPath]
  ]) {
    if (!path) throw new Error(`${name} is required`);
  }
  return result;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  const [
    curriculum,
    targetPack,
    mechanicCatalogBytes,
    morphologyCatalogBytes,
    mechanicCatalogSchema,
    morphologyCatalogSchema,
    sourceCatalog,
    bindingRegistry
  ] = await Promise.all([
    readJson(args.curriculumPath),
    readJson(args.targetPackPath),
    readFile(args.mechanicCatalogPath),
    readFile(args.morphologyCatalogPath),
    readJson(args.mechanicCatalogSchemaPath),
    readJson(args.morphologyCatalogSchemaPath),
    readJson(args.sourceCatalogPath),
    readJson(args.bindingRegistryPath)
  ]);
  const mechanicCatalog = JSON.parse(mechanicCatalogBytes.toString("utf8"));
  const mechanicCatalogDigest = `sha256:${createHash("sha256").update(mechanicCatalogBytes).digest("hex")}`;
  const morphologyCatalog = JSON.parse(morphologyCatalogBytes.toString("utf8"));
  const morphologyCatalogDigest = `sha256:${createHash("sha256").update(morphologyCatalogBytes).digest("hex")}`;
  const result = validateMorphologyContracts(
    {
      curriculum,
      targetPack,
      mechanicCatalog,
      mechanicCatalogDigest,
      mechanicCatalogSchema,
      morphologyCatalog,
      morphologyCatalogDigest,
      morphologyCatalogSchema,
      sourceCatalog,
      bindingRegistry
    },
    { requireHumanApproval: args.requireHumanApproval }
  );
  const { normalizedCatalog: _normalizedCatalog, ...report } = result;
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!result.valid) process.exitCode = 1;
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invokedPath) {
  main().catch((caught) => {
    process.stderr.write(`${caught?.stack || caught?.message || caught}\n`);
    process.exitCode = 1;
  });
}
