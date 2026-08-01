import { createHash } from "node:crypto";

import {
  computeCanonicalContractDigest,
  computeTargetPackDigest
} from "./validate-conformance.mjs";

export const CONTENT_SOURCE_SCHEMA = "caatuu-content-source-catalog-v1";
export const BINDING_REGISTRY_SCHEMA = "caatuu-cross-game-binding-registry-v1";
export const LEARNING_TASK_SCHEMA = "caatuu-cross-game-learning-task-v1";
export const EVIDENCE_EVENT_SCHEMA = "caatuu-cross-game-learning-evidence-v1";

const EVIDENCE_KINDS = new Set(["exposure", "comprehension", "retrieval", "production", "transfer"]);
const INDEPENDENCE_LEVELS = new Set(["exposure", "supported", "independent"]);
const OPPORTUNITY_EVIDENCE_KINDS = new Map([
  ["interpret", new Set(["comprehension", "retrieval"])],
  ["discriminate", new Set(["comprehension", "retrieval"])],
  ["retrieve", new Set(["retrieval"])],
  ["produce", new Set(["production"])],
  ["respond", new Set(["production", "transfer"])]
]);
const LEARNING_TASK_KEYS = new Set([
  "schemaVersion", "taskId", "issuedAt", "sessionId", "taskSequence", "registry",
  "bindingId", "capabilityId", "activityId", "mechanicId", "learningStage",
  "evidenceKind", "independence", "targetLocale", "contentRef", "canonicalUnitId",
  "canonicalUnitRevision", "targetSkillId", "targetSkillRevision", "contextId",
  "contextRevision", "opportunityId", "taskFingerprint"
]);
const EVIDENCE_EVENT_KEYS = new Set([
  "schemaVersion", "eventId", "occurredAt", "taskId", "taskFingerprint", "sessionId",
  "taskSequence", "attemptNumber", "registry", "bindingId", "capabilityId", "activityId",
  "mechanicId", "contentRef", "canonicalUnitId", "canonicalUnitRevision", "targetSkillId",
  "targetSkillRevision", "contextId", "contextRevision", "opportunityId", "outcome"
]);
const ID_VERSION_KEYS = new Set(["id", "version"]);
const OUTCOME_KEYS = new Set(["score", "solutionRevealed", "hintsUsed"]);

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && Boolean(value.trim());
}

function rows(value) {
  return Array.isArray(value) ? value : [];
}

function unknownKeys(value, allowed) {
  return isObject(value) ? Object.keys(value).filter((key) => !allowed.has(key)) : [];
}

function stableStringify(value) {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Canonical JSON cannot contain a non-finite number.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (!isObject(value)) throw new TypeError(`Canonical JSON cannot contain ${typeof value}.`);
  return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${stableStringify(value[key])}`
  )).join(",")}}`;
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

export function contentContractProjection(source) {
  return {
    activityId: source?.activityId,
    catalogDigest: source?.catalogDigest,
    catalogId: source?.catalogId,
    catalogRevision: source?.catalogRevision,
    contentId: source?.contentId,
    projectionVersion: source?.projectionVersion,
    revision: source?.revision,
    snapshot: source?.snapshot
  };
}

export function computeContentDigest(source) {
  return sha256(stableStringify(contentContractProjection(source)));
}

export function learningTaskContractProjection(task) {
  return {
    activityId: task?.activityId,
    bindingId: task?.bindingId,
    canonicalUnitId: task?.canonicalUnitId,
    canonicalUnitRevision: task?.canonicalUnitRevision,
    capabilityId: task?.capabilityId,
    contentRef: task?.contentRef,
    contextId: task?.contextId,
    contextRevision: task?.contextRevision,
    evidenceKind: task?.evidenceKind,
    independence: task?.independence,
    issuedAt: task?.issuedAt,
    learningStage: task?.learningStage,
    mechanicId: task?.mechanicId,
    opportunityId: task?.opportunityId,
    projectionVersion: "caatuu-cross-game-learning-task-projection-v1",
    registry: task?.registry,
    schemaVersion: task?.schemaVersion,
    sessionId: task?.sessionId,
    targetLocale: task?.targetLocale,
    targetSkillId: task?.targetSkillId,
    targetSkillRevision: task?.targetSkillRevision,
    taskId: task?.taskId,
    taskSequence: task?.taskSequence
  };
}

export function computeLearningTaskFingerprint(task) {
  return sha256(stableStringify(learningTaskContractProjection(task)));
}

function contentKey(catalogId, contentId) {
  return `${catalogId}\u0000${contentId}`;
}

function duplicateIds(values) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}

function sameOrderedValues(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function validLegacyVerbLocator(reference) {
  const pairId = reference?.legacyLocator?.pairId;
  const sourceIndex = reference?.legacyLocator?.sourceIndex;
  const parsed = typeof pairId === "string" && /^core-verb-([0-9]+)$/.exec(pairId);
  return Boolean(
    parsed
    && Number.isInteger(sourceIndex)
    && Number(parsed[1]) === sourceIndex
  );
}

function sameContentRef(left, right) {
  return left?.catalogId === right?.catalogId
    && left?.catalogRevision === right?.catalogRevision
    && left?.catalogDigest === right?.catalogDigest
    && left?.contentId === right?.contentId
    && left?.revision === right?.revision
    && left?.contentDigest === right?.contentDigest;
}

export function validateCrossGameBindings(curriculum, targetPack, sourceCatalog, registry) {
  const errors = [];
  const warnings = [];
  const report = (code, path, message, relatedIds = []) => {
    errors.push({ severity: "error", code, path, relatedIds, message });
  };

  if (!isObject(curriculum) || !isObject(targetPack) || !isObject(sourceCatalog) || !isObject(registry)) {
    report("BIND_MANIFEST_SCHEMA", "/", "Curriculum, target pack, source catalog, and binding registry must be objects.");
    return { valid: false, errors, warnings };
  }
  if (sourceCatalog.schemaVersion !== CONTENT_SOURCE_SCHEMA) {
    report("BIND_MANIFEST_SCHEMA", "/sourceCatalog/schemaVersion", `Expected ${CONTENT_SOURCE_SCHEMA}.`);
  }
  if (registry.schemaVersion !== BINDING_REGISTRY_SCHEMA) {
    report("BIND_MANIFEST_SCHEMA", "/registry/schemaVersion", `Expected ${BINDING_REGISTRY_SCHEMA}.`);
  }

  let canonicalDigest = null;
  let targetPackDigest = null;
  try {
    canonicalDigest = computeCanonicalContractDigest(curriculum);
  } catch (error) {
    report("BIND_MANIFEST_SCHEMA", "/curriculum", `Could not compute canonical digest: ${error.message}`);
  }
  try {
    targetPackDigest = computeTargetPackDigest(targetPack);
  } catch (error) {
    report("BIND_MANIFEST_SCHEMA", "/targetPack", `Could not compute target-pack digest: ${error.message}`);
  }
  if (registry.curriculum?.id !== curriculum.curriculumId || registry.curriculum?.version !== curriculum.version) {
    report("BIND_CANONICAL_MISMATCH", "/registry/curriculum", "Binding registry must pin the loaded canonical curriculum.");
  }
  if (registry.curriculum?.canonicalContractDigest !== canonicalDigest
      || targetPack.canonicalContractDigest !== canonicalDigest) {
    report("BIND_CANONICAL_DIGEST_MISMATCH", "/registry/curriculum/canonicalContractDigest", "Canonical curriculum digest is stale or inconsistent.");
  }
  if (registry.targetPack?.id !== targetPack.packId
      || registry.targetPack?.version !== targetPack.version
      || registry.targetPack?.targetLocale !== targetPack.targetLocale) {
    report("BIND_TARGET_PACK_MISMATCH", "/registry/targetPack", "Binding registry must pin the loaded target realization pack.");
  }
  if (registry.targetPack?.targetPackDigest !== targetPackDigest) {
    report("BIND_TARGET_PACK_DIGEST_MISMATCH", "/registry/targetPack/targetPackDigest", "Binding registry target-pack digest is stale or inconsistent.");
  }
  if (targetPack.curriculum?.id !== curriculum.curriculumId
      || targetPack.curriculum?.version !== curriculum.version) {
    report("BIND_CANONICAL_MISMATCH", "/targetPack/curriculum", "Target realization pack and binding registry must use the same curriculum release.");
  }
  if (registry.sourceCatalog?.id !== sourceCatalog.catalogId
      || registry.sourceCatalog?.version !== sourceCatalog.version
      || sourceCatalog.targetLocale !== targetPack.targetLocale) {
    report("BIND_SOURCE_CATALOG_MISMATCH", "/registry/sourceCatalog", "Binding registry must pin a source catalog for the target locale.");
  }

  const sources = rows(sourceCatalog.sources);
  if (!Array.isArray(sourceCatalog.sources) || !sources.length) {
    report("BIND_MANIFEST_SCHEMA", "/sourceCatalog/sources", "Source catalog requires at least one content snapshot.");
  }
  const sourceIds = sources.map((source) => contentKey(source?.catalogId, source?.contentId));
  for (const duplicate of duplicateIds(sourceIds)) {
    report("BIND_ID_DUPLICATE", "/sourceCatalog/sources", `Duplicate source identity ${duplicate.replace("\u0000", "/")}.`);
  }
  const sourceById = new Map();
  sources.forEach((source, index) => {
    const path = `/sourceCatalog/sources/${index}`;
    if (!isObject(source) || !isNonEmptyString(source.catalogId) || !isNonEmptyString(source.contentId)) {
      report("BIND_MANIFEST_SCHEMA", path, "Every source requires catalogId and contentId.");
      return;
    }
    sourceById.set(contentKey(source.catalogId, source.contentId), source);
    if (!Number.isInteger(source.revision) || source.revision < 1) {
      report("BIND_CONTENT_REVISION_MISMATCH", `${path}/revision`, "Content revision must be a positive integer.", [source.contentId]);
    }
    if (!isObject(source.snapshot) || source.snapshot.id !== source.contentId) {
      report("BIND_CONTENT_ID_MISMATCH", `${path}/snapshot/id`, "Snapshot ID must equal its source content ID.", [source.contentId]);
    }
    if (source.activityId === "word-world") {
      const focus = source.snapshot?.focusTarget;
      const matchingTargets = rows(source.snapshot?.targets).filter((target) => (
        target?.playable === true
        && target.surface === focus?.surface
        && target.normalized === focus?.normalized
        && target.tokenIndex === focus?.tokenIndex
      ));
      if (!isObject(focus) || matchingTargets.length !== 1) {
        report(
          "BIND_WORD_TARGET_LOCATOR_INVALID",
          `${path}/snapshot/focusTarget`,
          "Word World source requires one exact playable focus target.",
          [source.contentId]
        );
      }
    }
    if (source.activityId === "verb-nebula") {
      const pairId = source.snapshot?.legacyLocator?.pairId;
      const sourceIndex = source.snapshot?.legacyLocator?.sourceIndex;
      const parsedPairIndex = typeof pairId === "string" && /^core-verb-([0-9]+)$/.exec(pairId);
      if (!isNonEmptyString(source.contentId)
          || /^core-verb-[0-9]+$/.test(source.contentId)
          || !parsedPairIndex
          || !Number.isInteger(sourceIndex)
          || Number(parsedPairIndex?.[1]) !== sourceIndex
          || !String(source.sourceLocator?.selector || "").includes(`row[${sourceIndex}]`)
          || !String(source.sourceLocator?.selector || "").includes(pairId)) {
        report("BIND_LEGACY_LOCATOR_INVALID", `${path}/snapshot/legacyLocator`, "Verb source requires a stable sidecar content ID plus a consistent legacy pair/index assertion.", [source.contentId].filter(Boolean));
      }
      const contrasts = rows(source.snapshot?.guidedContrasts);
      if (contrasts.length !== 3) {
        report(
          "BIND_VERB_CONTRASTS_INVALID",
          `${path}/snapshot/guidedContrasts`,
          "The four-pair Guided mechanic requires exactly three reviewed contrast references.",
          [source.contentId]
        );
      }
      for (const field of ["conceptId", "targetSkillId", "id", "cz", "eng"]) {
        const values = contrasts.map((contrast) => contrast?.[field]);
        if (values.some((value) => !isNonEmptyString(value)) || duplicateIds(values).length) {
          report(
            "BIND_VERB_CONTRASTS_INVALID",
            `${path}/snapshot/guidedContrasts`,
            `Guided verb contrasts require unique non-empty ${field} values.`,
            [source.contentId]
          );
        }
      }
      contrasts.forEach((contrast, contrastIndex) => {
        if (!validLegacyVerbLocator(contrast)
            || contrast.id === source.snapshot?.id
            || contrast.difficulty !== source.snapshot?.difficulty
            || contrast.difficultyIsAuthored !== true) {
          report(
            "BIND_VERB_CONTRASTS_INVALID",
            `${path}/snapshot/guidedContrasts/${contrastIndex}`,
            "Each contrast must be a distinct, authored-difficulty stable verb reference aligned to the target level.",
            [source.contentId, contrast?.id].filter(Boolean)
          );
        }
      });
    }
    let computedDigest = null;
    try {
      computedDigest = computeContentDigest(source);
    } catch (error) {
      report("BIND_MANIFEST_SCHEMA", `${path}/snapshot`, error.message, [source.contentId]);
    }
    if (source.contentDigest !== computedDigest) {
      report("BIND_CONTENT_DIGEST_MISMATCH", `${path}/contentDigest`, `Expected ${computedDigest}.`, [source.contentId]);
    }
  });

  const canonicalUnits = rows(curriculum.units);
  const unitById = new Map(canonicalUnits.map((unit) => [unit?.id, unit]));
  const skills = rows(targetPack.skills);
  const skillById = new Map(skills.map((skill) => [skill?.id, skill]));
  const contexts = rows(targetPack.contexts);
  const contextById = new Map(contexts.map((context) => [context?.id, context]));
  const utterances = rows(targetPack.utterances);
  const utteranceById = new Map(utterances.map((utterance) => [utterance?.id, utterance]));
  const unitBindingById = new Map(rows(targetPack.unitBindings).map((binding) => [binding?.unitId, binding]));
  const bindings = rows(registry.bindings);
  if (!Array.isArray(registry.bindings) || !bindings.length) {
    report("BIND_MANIFEST_SCHEMA", "/registry/bindings", "Binding registry requires at least one content binding.");
  }
  for (const duplicate of duplicateIds(bindings.map((binding) => binding?.id))) {
    report("BIND_ID_DUPLICATE", "/registry/bindings", `Duplicate binding ID ${duplicate}.`, [duplicate]);
  }
  const bindingById = new Map();

  bindings.forEach((binding, bindingIndex) => {
    const path = `/registry/bindings/${bindingIndex}`;
    if (!isObject(binding) || !isNonEmptyString(binding.id)) {
      report("BIND_MANIFEST_SCHEMA", path, "Every binding requires a stable ID.");
      return;
    }
    bindingById.set(binding.id, binding);
    const source = sourceById.get(contentKey(binding.contentRef?.catalogId, binding.contentRef?.contentId));
    if (!source) {
      report("BIND_CONTENT_UNKNOWN", `${path}/contentRef`, "Binding references unknown source content.", [binding.id]);
    } else {
      if (binding.contentRef?.revision !== source.revision) {
        report("BIND_CONTENT_REVISION_MISMATCH", `${path}/contentRef/revision`, `Expected source revision ${source.revision}.`, [binding.id, source.contentId]);
      }
      if (binding.contentRef?.catalogRevision !== source.catalogRevision
          || binding.contentRef?.catalogDigest !== source.catalogDigest) {
        report("BIND_CATALOG_DIGEST_MISMATCH", `${path}/contentRef/catalogDigest`, "Binding does not pin the source catalog revision and digest.", [binding.id, source.contentId]);
      }
      if (binding.contentRef?.contentDigest !== source.contentDigest) {
        report("BIND_CONTENT_DIGEST_MISMATCH", `${path}/contentRef/contentDigest`, "Binding content digest does not match the revisioned source snapshot.", [binding.id, source.contentId]);
      }
      if (binding.activityId !== source.activityId) {
        report("BIND_ACTIVITY_MISMATCH", `${path}/activityId`, `Source ${source.contentId} belongs to ${source.activityId}.`, [binding.id]);
      }
    }

    const unit = unitById.get(binding.canonicalUnitId);
    if (!unit) {
      report("BIND_UNIT_UNKNOWN", `${path}/canonicalUnitId`, "Binding references an unknown canonical unit.", [binding.id, binding.canonicalUnitId]);
    } else if (binding.canonicalUnitRevision !== unit.revision) {
      report("BIND_UNIT_REVISION_MISMATCH", `${path}/canonicalUnitRevision`, `Expected canonical unit revision ${unit.revision}.`, [binding.id, unit.id]);
    }

    const targetSkillRefs = rows(binding.targetSkillRefs);
    if (!Array.isArray(binding.targetSkillRefs) || !targetSkillRefs.length) {
      report("BIND_SKILL_UNKNOWN", `${path}/targetSkillRefs`, "Binding requires at least one revision-pinned target skill.", [binding.id]);
    }
    for (const duplicate of duplicateIds(targetSkillRefs.map((skillRef) => skillRef?.id))) {
      report("BIND_ID_DUPLICATE", `${path}/targetSkillRefs`, `Duplicate target skill ${duplicate}.`, [binding.id, duplicate]);
    }
    targetSkillRefs.forEach((skillRef, skillIndex) => {
      const skillPath = `${path}/targetSkillRefs/${skillIndex}`;
      if (!isObject(skillRef) || !isNonEmptyString(skillRef.id)) {
        report("BIND_SKILL_UNKNOWN", skillPath, "Target skill reference requires a stable ID.", [binding.id]);
        return;
      }
      const skill = skillById.get(skillRef.id);
      if (!skill) {
        report("BIND_SKILL_UNKNOWN", `${skillPath}/id`, `Unknown target skill ${skillRef.id}.`, [binding.id, skillRef.id]);
      } else if (!Number.isInteger(skillRef.revision)
          || skillRef.revision < 1
          || skillRef.revision !== skill.revision) {
        report("BIND_SKILL_REVISION_MISMATCH", `${skillPath}/revision`, `Expected target skill revision ${skill.revision}.`, [binding.id, skillRef.id]);
      } else if (skill.unitId !== binding.canonicalUnitId || skill.locale !== targetPack.targetLocale) {
        report("BIND_SKILL_ALIGNMENT", skillPath, `Skill ${skillRef.id} is not aligned to this unit and locale.`, [binding.id, skillRef.id]);
      }
    });

    if (binding.activityId === "verb-nebula" && source && unit) {
      const unitConceptIds = rows(unit.semanticScope?.conceptIds);
      const targetConceptIds = targetSkillRefs.flatMap((skillRef) => {
        const skill = skillById.get(skillRef?.id);
        return rows(skill?.canonicalIds).filter((id) => unitConceptIds.includes(id));
      });
      const uniqueTargetConceptIds = [...new Set(targetConceptIds)];
      const contrasts = rows(source.snapshot?.guidedContrasts);
      const expectedConceptIds = uniqueTargetConceptIds.length === 1
        ? unitConceptIds.filter((id) => id !== uniqueTargetConceptIds[0]).slice(0, 3)
        : [];
      const actualConceptIds = contrasts.map((contrast) => contrast?.conceptId);
      if (uniqueTargetConceptIds.length !== 1 || !sameOrderedValues(actualConceptIds, expectedConceptIds)) {
        report(
          "BIND_VERB_CONTRAST_SCOPE_MISMATCH",
          `${path}/contentRef`,
          "Guided verb contrasts must follow the English backbone's canonical concept order, excluding the assessed concept.",
          [binding.id, ...actualConceptIds].filter(Boolean)
        );
      }
      contrasts.forEach((contrast, contrastIndex) => {
        const contrastSkill = skillById.get(contrast?.targetSkillId);
        if (!contrastSkill
            || contrastSkill.unitId !== binding.canonicalUnitId
            || contrastSkill.locale !== targetPack.targetLocale
            || !rows(contrastSkill.canonicalIds).includes(contrast?.conceptId)) {
          report(
            "BIND_VERB_CONTRAST_SKILL_MISMATCH",
            `${path}/contentRef/guidedContrasts/${contrastIndex}`,
            "Each target-language contrast must realize its declared canonical English concept in the bound unit.",
            [binding.id, contrast?.targetSkillId, contrast?.conceptId].filter(Boolean)
          );
        }
      });
    }

    let boundOpportunity = null;
    if (binding.contextId === null) {
      if (binding.contextRevision !== null || binding.opportunityId !== null) {
        report("BIND_CONTEXT_ALIGNMENT", `${path}/contextId`, "A context-free binding must also have null context revision and opportunity.", [binding.id]);
      }
    } else {
      const context = contextById.get(binding.contextId);
      if (!context) {
        report("BIND_CONTEXT_UNKNOWN", `${path}/contextId`, `Unknown target-pack context ${binding.contextId}.`, [binding.id, binding.contextId].filter(Boolean));
      } else {
        if (binding.contextRevision !== context.revision) {
          report("BIND_CONTEXT_REVISION_MISMATCH", `${path}/contextRevision`, `Expected context revision ${context.revision}.`, [binding.id, context.id]);
        }
        if (context.unitId !== binding.canonicalUnitId || context.locale !== targetPack.targetLocale) {
          report("BIND_CONTEXT_ALIGNMENT", `${path}/contextId`, "Bound context must share the binding unit and target locale.", [binding.id, context.id]);
        }
        const unitBinding = unitBindingById.get(binding.canonicalUnitId);
        if (!rows(unitBinding?.contextIds).includes(context.id)) {
          report("BIND_CONTEXT_ALIGNMENT", `${path}/contextId`, "Bound context must be declared by the target pack's unit binding.", [binding.id, context.id]);
        }
        const opportunity = rows(context.opportunities).find((row) => row?.id === binding.opportunityId);
        boundOpportunity = opportunity || null;
        if (!opportunity) {
          report("BIND_OPPORTUNITY_UNKNOWN", `${path}/opportunityId`, `Context ${context.id} does not contain opportunity ${binding.opportunityId}.`, [binding.id, context.id]);
        } else {
          for (const skillRef of targetSkillRefs) {
            if (!rows(opportunity.targetSkillIds).includes(skillRef?.id)
                || !rows(unitBinding?.targetSkillIds).includes(skillRef?.id)) {
              report("BIND_OPPORTUNITY_ALIGNMENT", `${path}/opportunityId`, `Opportunity ${opportunity.id} does not assess bound skill ${skillRef?.id}.`, [binding.id, opportunity.id, skillRef?.id].filter(Boolean));
            }
          }
          const opportunityUtteranceIds = [
            ...rows(opportunity.stimulusUtteranceIds),
            ...rows(opportunity.expectedUtteranceIds)
          ];
          const opportunityUtterances = opportunityUtteranceIds.map((id) => utteranceById.get(id));
          for (let index = 0; index < opportunityUtteranceIds.length; index += 1) {
            const utteranceId = opportunityUtteranceIds[index];
            const utterance = opportunityUtterances[index];
            if (!utterance
                || utterance.unitId !== binding.canonicalUnitId
                || utterance.locale !== targetPack.targetLocale
                || !targetSkillRefs.every((skillRef) => rows(utterance.skillIds).includes(skillRef?.id))) {
              report("BIND_OPPORTUNITY_ALIGNMENT", `${path}/opportunityId`, `Opportunity utterance ${utteranceId} is missing or does not support the bound unit, locale, and skill.`, [binding.id, opportunity.id, utteranceId]);
            }
          }
          if (binding.activityId === "word-world") {
            const sourceText = source?.snapshot?.cs;
            const hasExactText = isNonEmptyString(sourceText)
              && sourceText === sourceText.normalize("NFC")
              && opportunityUtterances.some((utterance) => (
                isNonEmptyString(utterance?.text)
                  && utterance.text === utterance.text.normalize("NFC")
                  && utterance.text === sourceText
              ));
            if (!hasExactText) {
              report("BIND_SOURCE_TEXT_MISMATCH", `${path}/opportunityId`, "Word World Czech source text must exactly match an NFC opportunity utterance.", [binding.id, opportunity.id]);
            }
          }
        }
      }
    }

    const capabilities = rows(binding.evidenceCapabilities);
    if (!Array.isArray(binding.evidenceCapabilities) || !capabilities.length) {
      report("BIND_CAPABILITY_INVALID", `${path}/evidenceCapabilities`, "Binding requires evidence capabilities.", [binding.id]);
    }
    for (const duplicate of duplicateIds(capabilities.map((capability) => capability?.id))) {
      report("BIND_ID_DUPLICATE", `${path}/evidenceCapabilities`, `Duplicate capability ID ${duplicate}.`, [binding.id, duplicate]);
    }
    let hasExposure = false;
    let hasIndependentMasteryEvidence = false;
    capabilities.forEach((capability, capabilityIndex) => {
      const capabilityPath = `${path}/evidenceCapabilities/${capabilityIndex}`;
      if (!isObject(capability)
          || !isNonEmptyString(capability.id)
          || !isNonEmptyString(capability.mechanicId)
          || !EVIDENCE_KINDS.has(capability.evidenceKind)
          || !INDEPENDENCE_LEVELS.has(capability.independence)) {
        report("BIND_CAPABILITY_INVALID", capabilityPath, "Evidence capability has invalid identity or classification.", [binding.id]);
        return;
      }
      if (unit && !rows(unit.requiredLearningStages).includes(capability.learningStage)) {
        report("BIND_CAPABILITY_INVALID", `${capabilityPath}/learningStage`, `Stage ${capability.learningStage} is not required by ${unit.id}.`, [binding.id]);
      }
      if (capability.evidenceKind === "exposure") {
        hasExposure = true;
        if (capability.independence !== "exposure"
            || capability.masteryEligible !== false
            || capability.scoreRequired !== false
            || Object.hasOwn(capability, "minimumScore")) {
          report("BIND_EXPOSURE_MASTERY_FORBIDDEN", capabilityPath, "Exposure must be unscored and ineligible for mastery.", [binding.id, capability.id]);
        }
      }
      if (capability.masteryEligible) {
        hasIndependentMasteryEvidence = true;
        if (capability.independence !== "independent"
            || capability.scoreRequired !== true
            || !Number.isFinite(capability.minimumScore)
            || capability.minimumScore < 0
            || capability.minimumScore > 1
            || capability.evidenceKind === "exposure") {
          report("BIND_MASTERY_CAPABILITY_INVALID", capabilityPath, "Mastery evidence must be independent, scored, and non-exposure.", [binding.id, capability.id]);
        }
        const allowedEvidenceKinds = OPPORTUNITY_EVIDENCE_KINDS.get(boundOpportunity?.operation);
        if (boundOpportunity && !allowedEvidenceKinds?.has(capability.evidenceKind)) {
          report(
            "BIND_CAPABILITY_OPPORTUNITY_MISMATCH",
            capabilityPath,
            `A ${boundOpportunity.operation} opportunity cannot authorize ${capability.evidenceKind} evidence.`,
            [binding.id, boundOpportunity.id, capability.id]
          );
        }
      } else if (capability.scoreRequired === true && !Number.isFinite(capability.minimumScore)) {
        report("BIND_CAPABILITY_INVALID", `${capabilityPath}/minimumScore`, "A scored capability requires a minimum score.", [binding.id, capability.id]);
      }
    });
    if (!hasExposure || !hasIndependentMasteryEvidence) {
      report("BIND_CAPABILITY_INCOMPLETE", `${path}/evidenceCapabilities`, "Pilot bindings require both exposure and independent mastery evidence.", [binding.id]);
    }
  });

  const groups = rows(registry.aggregationGroups);
  if (!Array.isArray(registry.aggregationGroups) || !groups.length) {
    report("BIND_AGGREGATION_INVALID", "/registry/aggregationGroups", "At least one cross-game aggregation group is required.");
  }
  for (const duplicate of duplicateIds(groups.map((group) => group?.id))) {
    report("BIND_ID_DUPLICATE", "/registry/aggregationGroups", `Duplicate aggregation group ID ${duplicate}.`, [duplicate]);
  }
  groups.forEach((group, groupIndex) => {
    const path = `/registry/aggregationGroups/${groupIndex}`;
    const unit = unitById.get(group?.canonicalUnitId);
    if (!unit || group.canonicalUnitRevision !== unit.revision) {
      report("BIND_AGGREGATION_INVALID", `${path}/canonicalUnitId`, "Aggregation group must pin a current canonical unit revision.", [group?.id].filter(Boolean));
    }
    const groupSkillRef = group?.targetSkillRef;
    const skill = skillById.get(groupSkillRef?.id);
    if (!skill || skill.unitId !== group?.canonicalUnitId || skill.locale !== targetPack.targetLocale) {
      report("BIND_AGGREGATION_INVALID", `${path}/targetSkillRef`, "Aggregation group target skill must belong to its unit and locale.", [group?.id].filter(Boolean));
    } else if (!Number.isInteger(groupSkillRef?.revision)
        || groupSkillRef.revision < 1
        || groupSkillRef.revision !== skill.revision) {
      report("BIND_SKILL_REVISION_MISMATCH", `${path}/targetSkillRef/revision`, `Expected target skill revision ${skill.revision}.`, [group?.id, skill.id].filter(Boolean));
    }
    const memberBindings = rows(group?.bindingIds).map((bindingId) => bindingById.get(bindingId));
    if (memberBindings.length < 2 || memberBindings.some((binding) => !binding)) {
      report("BIND_AGGREGATION_INVALID", `${path}/bindingIds`, "Cross-game aggregation requires at least two known bindings.", [group?.id].filter(Boolean));
      return;
    }
    const activityIds = new Set();
    for (const binding of memberBindings) {
      activityIds.add(binding.activityId);
      if (binding.canonicalUnitId !== group.canonicalUnitId
          || !rows(binding.targetSkillRefs).some((skillRef) => (
            skillRef?.id === groupSkillRef?.id && skillRef?.revision === groupSkillRef?.revision
          ))
          || !rows(binding.evidenceCapabilities).some((capability) => (
            capability.masteryEligible === true && capability.independence === "independent"
          ))) {
        report("BIND_AGGREGATION_INVALID", `${path}/bindingIds`, `Binding ${binding.id} cannot contribute independent evidence to this group.`, [group.id, binding.id]);
      }
    }
    if (activityIds.size < 2) {
      report("BIND_AGGREGATION_INVALID", `${path}/bindingIds`, "Aggregation group must contain distinct game activities.", [group.id]);
    }
  });

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    canonicalContractDigest: canonicalDigest,
    targetPackDigest,
    summary: {
      sources: sources.length,
      bindings: bindings.length,
      aggregationGroups: groups.length,
      activities: [...new Set(bindings.map((binding) => binding?.activityId).filter(Boolean))].sort()
    }
  };
}

function registryIndexes(registry) {
  const bindingById = new Map(rows(registry?.bindings).map((binding) => [binding?.id, binding]));
  return { bindingById };
}

export class LearningTaskValidationError extends Error {
  constructor(errors) {
    super(errors[0]?.message || "Learning task is invalid.");
    this.name = "LearningTaskValidationError";
    this.code = errors[0]?.code || "TASK_INVALID";
    this.errors = errors;
  }
}

export function issueLearningTask(registry, {
  taskId,
  issuedAt,
  sessionId,
  taskSequence,
  bindingId,
  capabilityId,
  targetSkillId
}) {
  const { bindingById } = registryIndexes(registry);
  const binding = bindingById.get(bindingId);
  const capability = rows(binding?.evidenceCapabilities).find((row) => row?.id === capabilityId);
  const skillRef = rows(binding?.targetSkillRefs).find((row) => row?.id === targetSkillId)
    || (targetSkillId === undefined ? rows(binding?.targetSkillRefs)[0] : null);
  const errors = [];
  if (!binding) errors.push({ severity: "error", code: "TASK_BINDING_UNKNOWN", path: "/bindingId", message: `Unknown binding ${bindingId}.` });
  if (binding && !capability) errors.push({ severity: "error", code: "TASK_CAPABILITY_UNKNOWN", path: "/capabilityId", message: `Unknown capability ${capabilityId}.` });
  if (binding && !skillRef) errors.push({ severity: "error", code: "TASK_SKILL_MISMATCH", path: "/targetSkillId", message: `Binding ${bindingId} does not supply skill ${targetSkillId}.` });
  if (errors.length) throw new LearningTaskValidationError(errors);

  const task = {
    schemaVersion: LEARNING_TASK_SCHEMA,
    taskId,
    issuedAt,
    sessionId,
    taskSequence,
    registry: { id: registry.registryId, version: registry.version },
    bindingId: binding.id,
    capabilityId: capability.id,
    activityId: binding.activityId,
    mechanicId: capability.mechanicId,
    learningStage: capability.learningStage,
    evidenceKind: capability.evidenceKind,
    independence: capability.independence,
    targetLocale: registry.targetPack?.targetLocale,
    contentRef: structuredClone(binding.contentRef),
    canonicalUnitId: binding.canonicalUnitId,
    canonicalUnitRevision: binding.canonicalUnitRevision,
    targetSkillId: skillRef.id,
    targetSkillRevision: skillRef.revision,
    contextId: binding.contextId,
    contextRevision: binding.contextRevision,
    opportunityId: binding.opportunityId
  };
  task.taskFingerprint = computeLearningTaskFingerprint(task);
  return task;
}

export function validateLearningTask(curriculum, registry, task) {
  const errors = [];
  const error = (code, path, message) => errors.push({ severity: "error", code, path, message });
  if (!isObject(curriculum) || !isObject(registry) || !isObject(task)) {
    error("TASK_SCHEMA", "/", "Curriculum, registry, and learning task must be objects.");
    return { valid: false, errors };
  }
  if (task.schemaVersion !== LEARNING_TASK_SCHEMA) {
    error("TASK_SCHEMA", "/schemaVersion", `Expected ${LEARNING_TASK_SCHEMA}.`);
  }
  for (const key of unknownKeys(task, LEARNING_TASK_KEYS)) {
    error("TASK_SCHEMA", `/${key}`, `Unknown task field ${key} is not covered by the immutable task contract.`);
  }
  for (const key of unknownKeys(task.registry, ID_VERSION_KEYS)) {
    error("TASK_SCHEMA", `/registry/${key}`, `Unknown task registry field ${key}.`);
  }
  if (!isNonEmptyString(task.taskId)
      || !isNonEmptyString(task.sessionId)
      || !isNonEmptyString(task.issuedAt)
      || !Number.isFinite(Date.parse(task.issuedAt))
      || !Number.isInteger(task.taskSequence)
      || task.taskSequence < 1) {
    error("TASK_SCHEMA", "/", "Task requires an ID, session, ISO issue time, and positive sequence.");
  }
  if (task.registry?.id !== registry.registryId || task.registry?.version !== registry.version) {
    error("TASK_REGISTRY_MISMATCH", "/registry", "Task references a different binding registry release.");
  }
  let expectedFingerprint = null;
  try {
    expectedFingerprint = computeLearningTaskFingerprint(task);
  } catch (cause) {
    error("TASK_SCHEMA", "/", `Task fingerprint projection is invalid: ${cause.message}`);
  }
  if (task.taskFingerprint !== expectedFingerprint) {
    error("TASK_FINGERPRINT_MISMATCH", "/taskFingerprint", "Task payload does not match its immutable fingerprint.");
  }

  const { bindingById } = registryIndexes(registry);
  const binding = bindingById.get(task.bindingId);
  if (!binding) {
    error("TASK_BINDING_UNKNOWN", "/bindingId", `Unknown binding ${task.bindingId}.`);
    return { valid: false, errors, expectedFingerprint };
  }
  const capability = rows(binding.evidenceCapabilities).find((row) => row?.id === task.capabilityId);
  if (!capability) {
    error("TASK_CAPABILITY_UNKNOWN", "/capabilityId", `Unknown capability ${task.capabilityId}.`);
    return { valid: false, errors, binding, expectedFingerprint };
  }
  if (task.activityId !== binding.activityId
      || task.mechanicId !== capability.mechanicId
      || task.learningStage !== capability.learningStage
      || task.evidenceKind !== capability.evidenceKind
      || task.independence !== capability.independence) {
    error("TASK_CAPABILITY_MISMATCH", "/capabilityId", "Task classification must be copied from the bound mechanic capability.");
  }
  if (task.targetLocale !== registry.targetPack?.targetLocale) {
    error("TASK_LOCALE_MISMATCH", "/targetLocale", "Task target locale must match the binding registry.");
  }
  if (!sameContentRef(task.contentRef, binding.contentRef)) {
    error("TASK_CONTENT_STALE", "/contentRef", "Task content revision or digest does not match its binding.");
  }
  const unit = rows(curriculum.units).find((row) => row?.id === task.canonicalUnitId);
  if (task.canonicalUnitId !== binding.canonicalUnitId
      || task.canonicalUnitRevision !== binding.canonicalUnitRevision
      || !unit
      || unit.revision !== task.canonicalUnitRevision) {
    error("TASK_UNIT_MISMATCH", "/canonicalUnitId", "Task canonical unit identity is unknown, stale, or inconsistent.");
  }
  const targetSkillRef = rows(binding.targetSkillRefs).find((row) => row?.id === task.targetSkillId);
  if (!targetSkillRef) {
    error("TASK_SKILL_MISMATCH", "/targetSkillId", "Task skill is not supplied by this binding.");
  } else if (task.targetSkillRevision !== targetSkillRef.revision) {
    error("TASK_SKILL_REVISION_MISMATCH", "/targetSkillRevision", "Task target skill revision is stale or inconsistent.");
  }
  if (task.contextId !== binding.contextId
      || task.contextRevision !== binding.contextRevision
      || task.opportunityId !== binding.opportunityId) {
    error("TASK_CONTEXT_MISMATCH", "/contextId", "Task context and opportunity must be copied from the validated binding.");
  }
  return {
    valid: errors.length === 0,
    errors,
    binding,
    capability,
    expectedFingerprint
  };
}

export function validateLearningEvidenceEvent(curriculum, registry, task, event) {
  const errors = [];
  const error = (code, path, message) => errors.push({ severity: "error", code, path, message });
  if (!isObject(curriculum) || !isObject(registry) || !isObject(task) || !isObject(event)) {
    error("EVIDENCE_SCHEMA", "/", "Curriculum, registry, task, and evidence event must be objects.");
    return { valid: false, errors, qualifiesForMastery: false };
  }
  const taskValidation = validateLearningTask(curriculum, registry, task);
  errors.push(...taskValidation.errors);
  if (event.schemaVersion !== EVIDENCE_EVENT_SCHEMA) {
    error("EVIDENCE_SCHEMA", "/schemaVersion", `Expected ${EVIDENCE_EVENT_SCHEMA}.`);
  }
  for (const key of unknownKeys(event, EVIDENCE_EVENT_KEYS)) {
    error("EVIDENCE_SCHEMA", `/${key}`, `Unknown evidence field ${key} is not allowed.`);
  }
  for (const key of unknownKeys(event.registry, ID_VERSION_KEYS)) {
    error("EVIDENCE_SCHEMA", `/registry/${key}`, `Unknown evidence registry field ${key}.`);
  }
  for (const key of unknownKeys(event.outcome, OUTCOME_KEYS)) {
    error("EVIDENCE_SCHEMA", `/outcome/${key}`, `Unknown evidence outcome field ${key}.`);
  }
  if (!isNonEmptyString(event.eventId)
      || !isNonEmptyString(event.sessionId)
      || !isNonEmptyString(event.occurredAt)
      || !Number.isFinite(Date.parse(event.occurredAt))
      || !Number.isInteger(event.taskSequence)
      || event.taskSequence < 1
      || !Number.isInteger(event.attemptNumber)
      || event.attemptNumber < 1) {
    error("EVIDENCE_SCHEMA", "/", "Evidence requires IDs, an ISO timestamp, positive task sequence, and positive attempt number.");
  }
  if (Number.isFinite(Date.parse(event.occurredAt))
      && Number.isFinite(Date.parse(task.issuedAt))
      && Date.parse(event.occurredAt) < Date.parse(task.issuedAt)) {
    error("EVIDENCE_TIME_INVALID", "/occurredAt", "Evidence cannot occur before its task was issued.");
  }
  if (event.taskId !== task.taskId || event.taskFingerprint !== task.taskFingerprint) {
    error("EVIDENCE_TASK_MISMATCH", "/taskId", "Evidence is not bound to this immutable task fingerprint.");
  }
  if (event.sessionId !== task.sessionId
      || event.taskSequence !== task.taskSequence
      || event.opportunityId !== task.opportunityId) {
    error("EVIDENCE_TASK_MISMATCH", "/taskSequence", "Evidence session, sequence, and opportunity must match its task.");
  }
  if (event.registry?.id !== task.registry?.id || event.registry?.version !== task.registry?.version) {
    error("EVIDENCE_REGISTRY_MISMATCH", "/registry", "Evidence event references a different binding registry release.");
  }
  if (event.bindingId !== task.bindingId
      || event.capabilityId !== task.capabilityId
      || event.activityId !== task.activityId
      || event.mechanicId !== task.mechanicId) {
    error("EVIDENCE_ACTIVITY_MISMATCH", "/bindingId", "Evidence binding, activity, and mechanic must match its task.");
  }
  if (!sameContentRef(event.contentRef, task.contentRef)) {
    error("EVIDENCE_CONTENT_STALE", "/contentRef", "Evidence content revision or digest does not match its task.");
  }
  if (event.canonicalUnitId !== task.canonicalUnitId
      || event.canonicalUnitRevision !== task.canonicalUnitRevision) {
    error("EVIDENCE_UNIT_MISMATCH", "/canonicalUnitId", "Evidence canonical unit identity is stale or inconsistent.");
  }
  if (event.targetSkillId !== task.targetSkillId) {
    error("EVIDENCE_SKILL_MISMATCH", "/targetSkillId", "Evidence skill is not supplied by this binding.");
  } else if (event.targetSkillRevision !== task.targetSkillRevision) {
    error("EVIDENCE_SKILL_REVISION_MISMATCH", "/targetSkillRevision", "Evidence target skill revision is stale or inconsistent.");
  }
  if (event.contextId !== task.contextId || event.contextRevision !== task.contextRevision) {
    error("EVIDENCE_CONTEXT_MISMATCH", "/contextId", "Evidence cannot invent a new mastery context outside its binding.");
  }
  if (!isObject(event.outcome)
      || typeof event.outcome.solutionRevealed !== "boolean"
      || !Number.isInteger(event.outcome.hintsUsed)
      || event.outcome.hintsUsed < 0) {
    error("EVIDENCE_SCHEMA", "/outcome", "Evidence outcome requires reveal and hint state.");
  }
  const capability = taskValidation.capability;
  const score = event.outcome?.score;
  if (!capability) {
    return { valid: false, errors, qualifiesForMastery: false, task };
  }
  if (capability.scoreRequired) {
    if (!Number.isFinite(score) || score < 0 || score > 1) {
      error("EVIDENCE_SCORE_INVALID", "/outcome/score", "Scored capability requires a score from 0 to 1.");
    }
  } else if (score !== null) {
    error("EVIDENCE_SCORE_FORBIDDEN", "/outcome/score", "Unscored exposure must use a null score.");
  }
  const qualifiesForMastery = errors.length === 0
    && capability.masteryEligible === true
    && capability.independence === "independent"
    && capability.evidenceKind !== "exposure"
    && event.attemptNumber === 1
    && event.outcome.solutionRevealed === false
    && event.outcome.hintsUsed === 0
    && score >= capability.minimumScore;
  return {
    valid: errors.length === 0,
    errors,
    binding: taskValidation.binding,
    capability,
    task,
    firstCleanResponse: event.attemptNumber === 1
      && event.outcome?.solutionRevealed === false
      && event.outcome?.hintsUsed === 0,
    qualifiesForMastery
  };
}

export class LearningEvidenceValidationError extends Error {
  constructor(errors) {
    super(errors[0]?.message || "Learning evidence is invalid.");
    this.name = "LearningEvidenceValidationError";
    this.code = errors[0]?.code || "EVIDENCE_INVALID";
    this.errors = errors;
  }
}

export function aggregateLearningEvidence(curriculum, registry, tasks, events) {
  const unitById = new Map(rows(curriculum?.units).map((unit) => [unit?.id, unit]));
  const repairGap = curriculum?.planningPolicy?.repairRetryTaskGap;
  if (!Number.isInteger(repairGap?.minimum)
      || !Number.isInteger(repairGap?.maximum)
      || repairGap.minimum < 1
      || repairGap.maximum < repairGap.minimum) {
    throw new LearningEvidenceValidationError([{
      severity: "error",
      code: "EVIDENCE_POLICY_INVALID",
      path: "/planningPolicy/repairRetryTaskGap",
      message: "Canonical repair retry gap is missing or invalid."
    }]);
  }

  const uniqueTasks = new Map();
  const taskSequenceSlots = new Map();
  for (const task of rows(tasks)) {
    const validation = validateLearningTask(curriculum, registry, task);
    if (!validation.valid) throw new LearningTaskValidationError(validation.errors);
    const fingerprint = stableStringify(task);
    const existing = uniqueTasks.get(task.taskId);
    if (existing && existing.fingerprint !== fingerprint) {
      throw new LearningTaskValidationError([{
        severity: "error",
        code: "TASK_ID_CONFLICT",
        path: "/taskId",
        message: `Task ID ${task.taskId} was reused for a different task.`
      }]);
    }
    if (!existing) {
      const sequenceKey = `${task.sessionId}\u0000${task.taskSequence}`;
      const sequenceOwner = taskSequenceSlots.get(sequenceKey);
      if (sequenceOwner && sequenceOwner !== task.taskId) {
        throw new LearningTaskValidationError([{
          severity: "error",
          code: "TASK_SEQUENCE_CONFLICT",
          path: "/taskSequence",
          message: `Session ${task.sessionId} sequence ${task.taskSequence} belongs to multiple tasks.`
        }]);
      }
      taskSequenceSlots.set(sequenceKey, task.taskId);
      uniqueTasks.set(task.taskId, { task, validation, fingerprint });
    }
  }

  const uniqueEvents = new Map();
  for (const event of rows(events)) {
    const taskEntry = uniqueTasks.get(event?.taskId);
    if (!taskEntry) {
      throw new LearningEvidenceValidationError([{
        severity: "error",
        code: "EVIDENCE_TASK_UNKNOWN",
        path: "/taskId",
        message: `Evidence references unknown task ${event?.taskId}.`
      }]);
    }
    const validation = validateLearningEvidenceEvent(curriculum, registry, taskEntry.task, event);
    if (!validation.valid) throw new LearningEvidenceValidationError(validation.errors);
    const fingerprint = stableStringify(event);
    const existing = uniqueEvents.get(event.eventId);
    if (existing && existing.fingerprint !== fingerprint) {
      throw new LearningEvidenceValidationError([{
        severity: "error",
        code: "EVIDENCE_ID_CONFLICT",
        path: "/eventId",
        message: `Event ID ${event.eventId} was reused for different evidence.`
      }]);
    }
    if (!existing) uniqueEvents.set(event.eventId, { event, task: taskEntry.task, validation, fingerprint });
  }

  const attemptSlots = new Map();
  for (const entry of uniqueEvents.values()) {
    const attemptKey = `${entry.event.taskId}\u0000${entry.event.attemptNumber}`;
    const existing = attemptSlots.get(attemptKey);
    if (existing && existing !== entry.event.eventId) {
      throw new LearningEvidenceValidationError([{
        severity: "error",
        code: "EVIDENCE_ATTEMPT_CONFLICT",
        path: "/attemptNumber",
        message: `Task ${entry.event.taskId} attempt ${entry.event.attemptNumber} has multiple evidence events.`
      }]);
    }
    attemptSlots.set(attemptKey, entry.event.eventId);
  }

  const ordered = [...uniqueEvents.values()].sort((left, right) => (
    Date.parse(left.event.occurredAt) - Date.parse(right.event.occurredAt)
      || left.event.taskSequence - right.event.taskSequence
      || left.event.attemptNumber - right.event.attemptNumber
      || left.event.eventId.localeCompare(right.event.eventId, "en")
  ));
  const aggregates = new Map();
  for (const { event, task, validation } of ordered) {
    const key = `${event.canonicalUnitId}\u0000${event.targetSkillId}\u0000${event.targetSkillRevision}`;
    const unit = unitById.get(event.canonicalUnitId);
    if (!unit || unit.revision !== event.canonicalUnitRevision) {
      throw new LearningEvidenceValidationError([{
        severity: "error",
        code: "EVIDENCE_UNIT_MISMATCH",
        path: "/canonicalUnitId",
        message: `Unknown or stale canonical unit ${event.canonicalUnitId} revision ${event.canonicalUnitRevision}.`
      }]);
    }
    let aggregate = aggregates.get(key);
    if (!aggregate) {
      aggregate = {
        canonicalUnitId: event.canonicalUnitId,
        canonicalUnitRevision: event.canonicalUnitRevision,
        targetSkillId: event.targetSkillId,
        targetSkillRevision: event.targetSkillRevision,
        exposureEvents: 0,
        assessedAttempts: 0,
        qualifyingIndependentEvidence: 0,
        independentRetrievals: 0,
        productionEvidence: 0,
        transferEvidence: 0,
        unresolvedFailure: null,
        contributingActivityIds: new Set(),
        qualifyingSessionIds: new Set(),
        qualifyingContextIds: new Set()
      };
      aggregates.set(key, aggregate);
    }
    const capability = validation.capability;
    if (capability.evidenceKind === "exposure") aggregate.exposureEvents += 1;
    if (capability.scoreRequired) {
      aggregate.assessedAttempts += 1;
      if (capability.independence === "independent"
          && event.attemptNumber === 1
          && event.outcome.score < capability.minimumScore) {
        aggregate.unresolvedFailure = {
          occurredAt: event.occurredAt,
          opportunityId: event.opportunityId,
          sessionId: event.sessionId,
          taskId: event.taskId,
          taskSequence: event.taskSequence
        };
      }
    }
    if (validation.qualifiesForMastery) {
      aggregate.qualifyingIndependentEvidence += 1;
      if (capability.evidenceKind === "retrieval") aggregate.independentRetrievals += 1;
      if (capability.evidenceKind === "production") aggregate.productionEvidence += 1;
      if (capability.evidenceKind === "transfer") aggregate.transferEvidence += 1;
      aggregate.contributingActivityIds.add(event.activityId);
      aggregate.qualifyingSessionIds.add(event.sessionId);
      if (isNonEmptyString(event.contextId)) aggregate.qualifyingContextIds.add(event.contextId);
      const failure = aggregate.unresolvedFailure;
      if (failure && task.taskId !== failure.taskId) {
        const laterSession = task.sessionId !== failure.sessionId;
        const interveningTaskCount = task.taskSequence - failure.taskSequence - 1;
        const validSameSessionGap = !laterSession
          && interveningTaskCount >= repairGap.minimum
          && interveningTaskCount <= repairGap.maximum;
        if (laterSession || validSameSessionGap) aggregate.unresolvedFailure = null;
      }
    }
  }

  return [...aggregates.values()].map((aggregate) => {
    const unit = unitById.get(aggregate.canonicalUnitId);
    const policy = unit.masteryPolicy;
    const shortfalls = [];
    if (aggregate.independentRetrievals < policy.minimumIndependentRetrievals) shortfalls.push("independent-retrievals");
    if (aggregate.qualifyingSessionIds.size < policy.minimumSessions) shortfalls.push("sessions");
    if (aggregate.qualifyingContextIds.size < policy.minimumDistinctContexts) shortfalls.push("distinct-contexts");
    if (policy.requiresProduction && aggregate.productionEvidence < 1) shortfalls.push("production");
    if (policy.requiresTransfer && aggregate.transferEvidence < 1) shortfalls.push("transfer");
    if (policy.unresolvedRecentFailureBlocksMastery && aggregate.unresolvedFailure) shortfalls.push("unresolved-recent-failure");
    return {
      canonicalUnitId: aggregate.canonicalUnitId,
      canonicalUnitRevision: aggregate.canonicalUnitRevision,
      targetSkillId: aggregate.targetSkillId,
      targetSkillRevision: aggregate.targetSkillRevision,
      exposureEvents: aggregate.exposureEvents,
      assessedAttempts: aggregate.assessedAttempts,
      qualifyingIndependentEvidence: aggregate.qualifyingIndependentEvidence,
      independentRetrievals: aggregate.independentRetrievals,
      productionEvidence: aggregate.productionEvidence,
      transferEvidence: aggregate.transferEvidence,
      unresolvedRecentFailure: Boolean(aggregate.unresolvedFailure),
      unresolvedFailureTaskId: aggregate.unresolvedFailure?.taskId || null,
      contributingActivityIds: [...aggregate.contributingActivityIds].sort(),
      qualifyingSessionIds: [...aggregate.qualifyingSessionIds].sort(),
      qualifyingContextIds: [...aggregate.qualifyingContextIds].sort(),
      masteryReady: shortfalls.length === 0,
      masteryShortfalls: shortfalls
    };
  });
}
