export const LEARNING_TASK_SCHEMA = "caatuu-cross-game-learning-task-v1";
export const EVIDENCE_EVENT_SCHEMA = "caatuu-cross-game-learning-evidence-v1";
export const CONJUGATION_COMET_ACTIVITY_ID = "conjugation-comet";
export const CONJUGATION_COMET_EXERCISE_FAMILY_ID = "conjugation-comet.contextual-target-realization";

const CURRICULUM_SCHEMA = "caatuu-canonical-curriculum-v1";
const PACK_SCHEMA = "caatuu-target-realization-pack-v1";
const SOURCE_SCHEMA = "caatuu-content-source-catalog-v1";
const REGISTRY_SCHEMA = "caatuu-cross-game-binding-registry-v1";
const OPPORTUNITY_EVIDENCE_KINDS = new Map([
  ["interpret", new Set(["comprehension", "retrieval"])],
  ["discriminate", new Set(["comprehension", "retrieval"])],
  ["retrieve", new Set(["retrieval"])],
  ["produce", new Set(["production", "transfer"])],
  ["respond", new Set(["production", "transfer"])]
]);
const ACTIVITY_EXERCISE_FAMILIES = new Map([
  ["word-world", new Set(["word-world.sentence-reconstruction"])],
  ["verb-nebula", new Set(["verb-nebula.meaning-match"])],
  [CONJUGATION_COMET_ACTIVITY_ID, new Set([CONJUGATION_COMET_EXERCISE_FAMILY_ID])]
]);
const STAGE_EVIDENCE_KIND = new Map([
  ["encounter", "exposure"],
  ["comprehend", "comprehension"],
  ["discriminate", "comprehension"],
  ["retrieve", "retrieval"],
  ["supported-produce", "production"],
  ["interact", "production"],
  ["transfer", "transfer"],
  ["delayed-retrieval", "retrieval"]
]);
const STAGE_OPPORTUNITY_OPERATIONS = new Map([
  ["comprehend", new Set(["interpret"])],
  ["discriminate", new Set(["discriminate"])],
  ["retrieve", new Set(["retrieve"])],
  ["supported-produce", new Set(["produce"])],
  ["interact", new Set(["respond"])],
  ["transfer", new Set(["produce", "respond"])],
  ["delayed-retrieval", new Set(["retrieve"])]
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

function rows(value) {
  return Array.isArray(value) ? value : [];
}

function unknownKeys(value, allowed) {
  return isObject(value) ? Object.keys(value).filter((key) => !allowed.has(key)) : [];
}

function nonEmptyString(value) {
  return typeof value === "string" && Boolean(value.trim());
}

function clone(value) {
  return globalThis.structuredClone
    ? globalThis.structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

export function canonicalJson(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Canonical JSON cannot contain a non-finite number.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (!isObject(value)) throw new TypeError(`Canonical JSON cannot contain ${typeof value}.`);
  return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${canonicalJson(value[key])}`
  )).join(",")}}`;
}

export async function sha256Canonical(value) {
  if (!globalThis.crypto?.subtle) throw new Error("Web Crypto SHA-256 is required by the curriculum runtime.");
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
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
    learningStageSequence: rows(curriculum?.learningStageSequence),
    semanticDefinitions: rows(curriculum?.semanticDefinitions),
    unitOrder: rows(curriculum?.unitOrder),
    units: rows(curriculum?.units).map((unit) => ({
      id: unit?.id,
      revision: unit?.revision,
      ordinal: unit?.ordinal,
      title: unit?.title,
      description: unit?.description,
      canDo: unit?.canDo,
      semanticScope: unit?.semanticScope,
      transferPolicy: unit?.transferPolicy,
      prerequisiteUnitIds: rows(unit?.prerequisiteUnitIds),
      requiredLearningStages: rows(unit?.requiredLearningStages),
      masteryPolicy: unit?.masteryPolicy
    }))
  };
}

export function contentContractProjection(source) {
  return {
    activityId: source?.activityId,
    exerciseFamilyId: source?.exerciseFamilyId,
    catalogDigest: source?.catalogDigest,
    catalogId: source?.catalogId,
    catalogRevision: source?.catalogRevision,
    contentId: source?.contentId,
    projectionVersion: source?.projectionVersion,
    revision: source?.revision,
    snapshot: source?.snapshot
  };
}

export function learningTaskProjection(task) {
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

export const computeCanonicalContractDigest = (curriculum) => sha256Canonical(canonicalContractProjection(curriculum));
export const computeTargetPackDigest = (pack) => sha256Canonical({
  projectionVersion: "caatuu-target-pack-projection-v1",
  pack
});
export const computeContentDigest = (source) => sha256Canonical(contentContractProjection(source));
export const computeSourceCatalogDigest = (catalog) => sha256Canonical({
  projectionVersion: "caatuu-content-source-catalog-file-v1",
  catalog
});
export const computeBindingRegistryDigest = (registry) => sha256Canonical({
  projectionVersion: "caatuu-cross-game-binding-registry-file-v1",
  registry
});
export const computeLearningTaskFingerprint = (task) => sha256Canonical(learningTaskProjection(task));

function sameArray(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameContentRef(left, right) {
  return left?.catalogId === right?.catalogId
    && left?.catalogRevision === right?.catalogRevision
    && left?.catalogDigest === right?.catalogDigest
    && left?.contentId === right?.contentId
    && left?.revision === right?.revision
    && left?.contentDigest === right?.contentDigest;
}

function sourceKey(catalogId, contentId) {
  return `${catalogId}\u0000${contentId}`;
}

function validLegacyVerbLocator(reference) {
  const pairId = reference?.legacyLocator?.pairId;
  const sourceIndex = reference?.legacyLocator?.sourceIndex;
  const parsed = typeof pairId === "string" && /^core-verb-([0-9]+)$/.exec(pairId);
  return Boolean(parsed && Number.isInteger(sourceIndex) && Number(parsed[1]) === sourceIndex);
}

function validRevisionRef(reference) {
  return isObject(reference)
    && nonEmptyString(reference.id)
    && Number.isInteger(reference.revision)
    && reference.revision > 0;
}

export async function validateRuntimeBundle(bundle, releasePins) {
  const errors = [];
  const error = (code, path, message, relatedIds = []) => errors.push({
    severity: "error", code, path, relatedIds, message
  });
  if (!isObject(bundle) || !isObject(releasePins)) {
    error("RUNTIME_BUNDLE_SCHEMA", "/", "Runtime bundle and externally trusted release pins must be objects.");
    return { valid: false, errors };
  }
  const { curriculum, targetPack, sourceCatalog, bindingRegistry } = bundle;
  for (const [value, schema, path] of [
    [curriculum, CURRICULUM_SCHEMA, "/curriculum"],
    [targetPack, PACK_SCHEMA, "/targetPack"],
    [sourceCatalog, SOURCE_SCHEMA, "/sourceCatalog"],
    [bindingRegistry, REGISTRY_SCHEMA, "/bindingRegistry"]
  ]) {
    if (!isObject(value) || value.schemaVersion !== schema) error("RUNTIME_BUNDLE_SCHEMA", path, `Expected ${schema}.`);
  }
  if (errors.length) return { valid: false, errors };

  const [canonicalContractDigest, targetPackDigest, sourceCatalogDigest, bindingRegistryDigest] = await Promise.all([
    computeCanonicalContractDigest(curriculum),
    computeTargetPackDigest(targetPack),
    computeSourceCatalogDigest(sourceCatalog),
    computeBindingRegistryDigest(bindingRegistry)
  ]);
  const computedDigests = { canonicalContractDigest, targetPackDigest, sourceCatalogDigest, bindingRegistryDigest };
  for (const [field, value] of Object.entries(computedDigests)) {
    if (!nonEmptyString(releasePins[field])) error("RUNTIME_RELEASE_PIN_REQUIRED", `/releasePins/${field}`, `Trusted ${field} is required.`);
    else if (releasePins[field] !== value) error("RUNTIME_RELEASE_PIN_MISMATCH", `/releasePins/${field}`, `Trusted ${field} does not match the loaded runtime asset.`);
  }
  if (releasePins.curriculumId !== curriculum.curriculumId || releasePins.curriculumVersion !== curriculum.version) {
    error("RUNTIME_CURRICULUM_MISMATCH", "/releasePins", "Trusted curriculum identity/version does not match the loaded curriculum.");
  }
  if (releasePins.targetPackId !== targetPack.packId
      || releasePins.targetPackVersion !== targetPack.version
      || releasePins.targetLocale !== targetPack.targetLocale) {
    error("RUNTIME_TARGET_PACK_MISMATCH", "/releasePins", "Trusted target-pack identity/version/locale does not match the loaded pack.");
  }
  if (releasePins.sourceCatalogId !== sourceCatalog.catalogId || releasePins.sourceCatalogVersion !== sourceCatalog.version) {
    error("RUNTIME_SOURCE_CATALOG_MISMATCH", "/releasePins", "Trusted source-catalog identity/version does not match the loaded catalog.");
  }
  if (releasePins.bindingRegistryId !== bindingRegistry.registryId || releasePins.bindingRegistryVersion !== bindingRegistry.version) {
    error("RUNTIME_BINDING_REGISTRY_MISMATCH", "/releasePins", "Trusted binding-registry identity/version does not match the loaded registry.");
  }

  if (targetPack.curriculum?.id !== curriculum.curriculumId
      || targetPack.curriculum?.version !== curriculum.version
      || targetPack.canonicalContractDigest !== canonicalContractDigest) {
    error("RUNTIME_CURRICULUM_MISMATCH", "/targetPack/curriculum", "Target pack does not pin the loaded canonical curriculum.");
  }
  if (!sameArray(rows(targetPack.unitOrder), rows(curriculum.unitOrder))) {
    error("RUNTIME_UNIT_ORDER_MISMATCH", "/targetPack/unitOrder", "Target pack changed the canonical unit order.");
  }
  if (bindingRegistry.curriculum?.id !== curriculum.curriculumId
      || bindingRegistry.curriculum?.version !== curriculum.version
      || bindingRegistry.curriculum?.canonicalContractDigest !== canonicalContractDigest) {
    error("RUNTIME_CURRICULUM_MISMATCH", "/bindingRegistry/curriculum", "Binding registry does not pin the loaded curriculum.");
  }
  if (bindingRegistry.targetPack?.id !== targetPack.packId
      || bindingRegistry.targetPack?.version !== targetPack.version
      || bindingRegistry.targetPack?.targetLocale !== targetPack.targetLocale
      || bindingRegistry.targetPack?.targetPackDigest !== targetPackDigest) {
    error("RUNTIME_TARGET_PACK_MISMATCH", "/bindingRegistry/targetPack", "Binding registry does not pin the loaded target pack.");
  }
  if (bindingRegistry.sourceCatalog?.id !== sourceCatalog.catalogId
      || bindingRegistry.sourceCatalog?.version !== sourceCatalog.version
      || sourceCatalog.targetLocale !== targetPack.targetLocale) {
    error("RUNTIME_SOURCE_CATALOG_MISMATCH", "/bindingRegistry/sourceCatalog", "Binding registry does not pin the loaded target-locale source catalog.");
  }

  const unitById = new Map(rows(curriculum.units).map((unit) => [unit?.id, unit]));
  const skillById = new Map(rows(targetPack.skills).map((skill) => [skill?.id, skill]));
  const contextById = new Map(rows(targetPack.contexts).map((context) => [context?.id, context]));
  const sourceById = new Map(rows(sourceCatalog.sources).map((source) => [sourceKey(source?.catalogId, source?.contentId), source]));
  for (const [unitBindingIndex, unitBinding] of rows(targetPack.unitBindings).entries()) {
    const path = `/targetPack/unitBindings/${unitBindingIndex}`;
    const unit = unitById.get(unitBinding?.unitId);
    if (!unit || unit.revision !== unitBinding?.canonicalRevision) {
      error("RUNTIME_UNIT_BINDING_MISMATCH", `${path}/unitId`, "Target unit binding is missing or stale.", [unitBinding?.unitId].filter(Boolean));
      continue;
    }
    const orderedTargetSkillIds = [];
    const seenTargetSkillIds = new Set();
    for (const [bindingField, canonicalField] of [
      ["functionBindings", "functionIds"],
      ["frameBindings", "frameIds"],
      ["conceptBindings", "conceptIds"]
    ]) {
      const mappings = rows(unitBinding[bindingField]);
      const requiredCanonicalIds = rows(unit.semanticScope?.[canonicalField]);
      if (!sameArray(mappings.map((mapping) => mapping?.canonicalId), requiredCanonicalIds)) {
        error(
          "RUNTIME_SEMANTIC_ORDER_MISMATCH",
          `${path}/${bindingField}`,
          `Target mappings changed the English canonical ${canonicalField} order.`,
          [unit.id]
        );
      }
      for (const mapping of mappings) {
        for (const targetSkillId of rows(mapping?.targetSkillIds)) {
          if (seenTargetSkillIds.has(targetSkillId)) continue;
          seenTargetSkillIds.add(targetSkillId);
          orderedTargetSkillIds.push(targetSkillId);
        }
      }
    }
    if (!sameArray(rows(unitBinding.targetSkillIds), orderedTargetSkillIds)) {
      error(
        "RUNTIME_TARGET_SKILL_ORDER_MISMATCH",
        `${path}/targetSkillIds`,
        "Target skills changed their first occurrence in the English-ordered semantic mappings.",
        [unit.id]
      );
    }
  }
  for (const source of rows(sourceCatalog.sources)) {
    const digest = await computeContentDigest(source);
    if (source.contentDigest !== digest) error("RUNTIME_CONTENT_DIGEST_MISMATCH", "/sourceCatalog/sources", `Source ${source.contentId} content digest is stale.`, [source.contentId]);
    if (!ACTIVITY_EXERCISE_FAMILIES.get(source.activityId)?.has(source.exerciseFamilyId)) {
      error(
        "RUNTIME_EXERCISE_FAMILY_INVALID",
        "/sourceCatalog/sources",
        `Source ${source.contentId} does not declare a supported exercise family for its activity.`,
        [source.contentId, source.exerciseFamilyId].filter(Boolean)
      );
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
        error(
          "RUNTIME_WORD_TARGET_LOCATOR_INVALID",
          "/sourceCatalog/sources",
          `Source ${source.contentId} does not pin one exact playable Word World focus target.`,
          [source.contentId]
        );
      }
    }
    if (source.activityId === "verb-nebula"
        && source.exerciseFamilyId === "verb-nebula.meaning-match") {
      const contrasts = rows(source.snapshot?.guidedContrasts);
      const unique = (field) => {
        const values = contrasts.map((contrast) => contrast?.[field]);
        return values.every(nonEmptyString) && new Set(values).size === values.length;
      };
      if (contrasts.length !== 3
          || !["conceptId", "targetSkillId", "id", "cz", "eng"].every(unique)
          || contrasts.some((contrast) => (
            !validLegacyVerbLocator(contrast)
            || contrast.id === source.snapshot?.id
            || contrast.difficulty !== source.snapshot?.difficulty
            || contrast.difficultyIsAuthored !== true
          ))) {
        error(
          "RUNTIME_VERB_CONTRASTS_INVALID",
          "/sourceCatalog/sources",
          `Source ${source.contentId} does not pin three distinct reviewed Guided contrasts.`,
          [source.contentId]
        );
      }
    }
    if (source.activityId === CONJUGATION_COMET_ACTIVITY_ID
        && source.exerciseFamilyId === CONJUGATION_COMET_EXERCISE_FAMILY_ID) {
      const familyRef = source.snapshot?.familyRef;
      const itemRefs = rows(source.snapshot?.itemRefs);
      const cueRefs = rows(source.snapshot?.cueRefs);
      const selectedCueRef = source.snapshot?.selectedCueRef;
      const targetItemRef = source.snapshot?.targetItemRef;
      const exerciseRef = source.snapshot?.exerciseRef;
      const sequenceRef = source.snapshot?.sequenceRef;
      const uniqueRefs = (references) => new Set(
        references.map((reference) => `${reference?.id}@${reference?.revision}`)
      ).size === references.length;
      const refKey = (reference) => `${reference?.id}@${reference?.revision}`;
      if (!validRevisionRef(familyRef)
          || itemRefs.length < 2
          || cueRefs.length !== itemRefs.length
          || !itemRefs.every(validRevisionRef)
          || !cueRefs.every(validRevisionRef)
          || !uniqueRefs(itemRefs)
          || !uniqueRefs(cueRefs)
          || !validRevisionRef(selectedCueRef)
          || !cueRefs.some((reference) => refKey(reference) === refKey(selectedCueRef))
          || !validRevisionRef(targetItemRef)
          || !itemRefs.some((reference) => refKey(reference) === refKey(targetItemRef))
          || !validRevisionRef(exerciseRef)
          || !validRevisionRef(sequenceRef)
          || !Number.isInteger(source.snapshot?.sequenceStep)
          || source.snapshot.sequenceStep < 1
          || source.snapshot?.id !== source.contentId
          || !validRevisionRef(source.snapshot?.capabilityRef)
          || !validRevisionRef(source.snapshot?.targetSkillRef)
          || source.snapshot?.review?.status !== "prototype-not-human-approved"
          || source.snapshot?.review?.releaseEnabled !== false) {
        error(
          "RUNTIME_MORPHOLOGY_SNAPSHOT_INVALID",
          "/sourceCatalog/sources",
          `Source ${source.contentId} does not pin one explicit developer-only morphology sequence step.`,
          [source.contentId]
        );
      }
    }
  }
  for (const binding of rows(bindingRegistry.bindings)) {
    const path = `/bindingRegistry/bindings/${binding?.id || "unknown"}`;
    if (!ACTIVITY_EXERCISE_FAMILIES.get(binding?.activityId)?.has(binding?.exerciseFamilyId)) {
      error(
        "RUNTIME_EXERCISE_FAMILY_INVALID",
        `${path}/exerciseFamilyId`,
        "Binding does not declare a supported exercise family for its activity.",
        [binding?.id, binding?.exerciseFamilyId].filter(Boolean)
      );
    }
    const source = sourceById.get(sourceKey(binding?.contentRef?.catalogId, binding?.contentRef?.contentId));
    if (!source
        || source.activityId !== binding.activityId
        || source.exerciseFamilyId !== binding.exerciseFamilyId
        || !sameContentRef(source, binding.contentRef)) {
      error("RUNTIME_BINDING_CONTENT_MISMATCH", `${path}/contentRef`, "Binding content does not match a revision-pinned source snapshot.", [binding?.id].filter(Boolean));
    }
    const unit = unitById.get(binding?.canonicalUnitId);
    if (!unit || unit.revision !== binding.canonicalUnitRevision) {
      error("RUNTIME_BINDING_UNIT_MISMATCH", `${path}/canonicalUnitId`, "Binding canonical unit is missing or stale.", [binding?.id].filter(Boolean));
    }
    for (const skillRef of rows(binding?.targetSkillRefs)) {
      const skill = skillById.get(skillRef?.id);
      if (!skill || skill.revision !== skillRef?.revision || skill.unitId !== binding.canonicalUnitId) {
        error("RUNTIME_BINDING_SKILL_MISMATCH", `${path}/targetSkillRefs`, "Binding target skill is missing, stale, or belongs to another unit.", [binding?.id, skillRef?.id].filter(Boolean));
      }
    }
    if (binding.activityId === CONJUGATION_COMET_ACTIVITY_ID
        && binding.exerciseFamilyId === CONJUGATION_COMET_EXERCISE_FAMILY_ID) {
      const targetSkillRefs = rows(binding.targetSkillRefs);
      const skill = targetSkillRefs.length === 1
        ? skillById.get(targetSkillRefs[0]?.id)
        : null;
      const assessed = rows(binding.evidenceCapabilities).filter((capability) => capability?.scoreRequired === true);
      const capability = assessed[0];
      if (!skill
          || skill.kind !== "form"
          || skill.requiredForOutcome !== false
          || assessed.length !== 1
          || capability.id !== "independent-form-discrimination"
          || capability.learningStage !== "discriminate"
          || capability.evidenceKind !== "comprehension"
          || capability.independence !== "independent"
          || capability.masteryEligible !== false
          || capability.minimumScore !== 1) {
        error(
          "RUNTIME_MORPHOLOGY_EVIDENCE_INVALID",
          `${path}/evidenceCapabilities`,
          "Visible-form morphology must target one supplemental form skill and remain independent comprehension evidence that is not mastery-eligible.",
          [binding.id, ...targetSkillRefs.map((reference) => reference?.id)].filter(Boolean)
        );
      }
    }
    if (binding.activityId === "verb-nebula"
        && binding.exerciseFamilyId === "verb-nebula.meaning-match"
        && source
        && unit) {
      const unitConceptIds = rows(unit.semanticScope?.conceptIds);
      const targetConceptIds = [...new Set(rows(binding.targetSkillRefs).flatMap((skillRef) => (
        rows(skillById.get(skillRef?.id)?.canonicalIds).filter((id) => unitConceptIds.includes(id))
      )))];
      const contrasts = rows(source.snapshot?.guidedContrasts);
      const expectedConceptIds = targetConceptIds.length === 1
        ? unitConceptIds.filter((id) => id !== targetConceptIds[0]).slice(0, 3)
        : [];
      const actualConceptIds = contrasts.map((contrast) => contrast?.conceptId);
      if (targetConceptIds.length !== 1 || !sameArray(actualConceptIds, expectedConceptIds)) {
        error(
          "RUNTIME_VERB_CONTRAST_SCOPE_MISMATCH",
          `${path}/contentRef`,
          "Guided verb contrasts do not follow the English backbone's canonical concept order.",
          [binding.id]
        );
      }
      contrasts.forEach((contrast) => {
        const contrastSkill = skillById.get(contrast?.targetSkillId);
        if (!contrastSkill
            || contrastSkill.unitId !== binding.canonicalUnitId
            || contrastSkill.locale !== targetPack.targetLocale
            || !rows(contrastSkill.canonicalIds).includes(contrast?.conceptId)) {
          error(
            "RUNTIME_VERB_CONTRAST_SKILL_MISMATCH",
            `${path}/contentRef`,
            "A target-language Guided contrast is not aligned to its canonical English concept.",
            [binding.id, contrast?.targetSkillId].filter(Boolean)
          );
        }
      });
    }
    let opportunity = null;
    if (binding.contextId !== null) {
      const context = contextById.get(binding.contextId);
      opportunity = rows(context?.opportunities).find((row) => row?.id === binding.opportunityId);
      if (!context || context.revision !== binding.contextRevision || context.unitId !== binding.canonicalUnitId || !opportunity) {
        error("RUNTIME_BINDING_CONTEXT_MISMATCH", `${path}/contextId`, "Binding context/opportunity is missing, stale, or misaligned.", [binding?.id].filter(Boolean));
      }
    } else if (binding.contextRevision !== null || binding.opportunityId !== null) {
      error("RUNTIME_BINDING_CONTEXT_MISMATCH", `${path}/contextId`, "Context-free binding must use null context revision and opportunity.", [binding?.id].filter(Boolean));
    }
    for (const capability of rows(binding?.evidenceCapabilities)) {
      const requiredEvidenceKind = STAGE_EVIDENCE_KIND.get(capability?.learningStage);
      if (!requiredEvidenceKind || capability?.evidenceKind !== requiredEvidenceKind) {
        error(
          "RUNTIME_STAGE_EVIDENCE_MISMATCH",
          `${path}/evidenceCapabilities`,
          `Stage ${capability?.learningStage || "(missing)"} has the wrong evidence classification.`,
          [binding?.id, capability?.id].filter(Boolean)
        );
      }
      if (capability?.evidenceKind !== "exposure" && opportunity) {
        const allowed = OPPORTUNITY_EVIDENCE_KINDS.get(opportunity.operation);
        if (!allowed?.has(capability.evidenceKind)) {
          error("RUNTIME_CAPABILITY_OPPORTUNITY_MISMATCH", `${path}/evidenceCapabilities`, `Opportunity ${opportunity.id} cannot authorize ${capability.evidenceKind} evidence.`, [binding.id, capability.id]);
        }
        const allowedOperations = STAGE_OPPORTUNITY_OPERATIONS.get(capability.learningStage);
        if (!allowedOperations?.has(opportunity.operation)) {
          error(
            "RUNTIME_STAGE_OPPORTUNITY_MISMATCH",
            `${path}/evidenceCapabilities`,
            `Stage ${capability.learningStage} requires one of: ${[...(allowedOperations || [])].join(", ")}.`,
            [binding.id, capability.id]
          );
        }
        if (capability.learningStage === "interact" && rows(opportunity.stimulusUtteranceIds).length === 0) {
          error(
            "RUNTIME_INTERACTION_STIMULUS_REQUIRED",
            `${path}/evidenceCapabilities`,
            "Interaction evidence requires an interlocutor stimulus.",
            [binding.id, capability.id]
          );
        }
      }
      if (capability?.evidenceKind === "exposure"
          && (capability.masteryEligible !== false || capability.scoreRequired !== false || capability.independence !== "exposure")) {
        error("RUNTIME_EXPOSURE_MASTERY_FORBIDDEN", `${path}/evidenceCapabilities`, "Exposure capability cannot qualify for mastery.", [binding?.id, capability?.id].filter(Boolean));
      }
    }
  }

  const bindingById = new Map(rows(bindingRegistry.bindings).map((binding) => [binding?.id, binding]));
  const exerciseSequences = rows(bindingRegistry.exerciseSequences);
  if (!Array.isArray(bindingRegistry.exerciseSequences)) {
    error("RUNTIME_SEQUENCE_INVALID", "/bindingRegistry/exerciseSequences", "Runtime binding registry must explicitly declare its exercise-sequence list.");
  }
  const seenSequenceIds = new Set();
  const sequenceMembership = new Map();
  for (const [sequenceIndex, sequence] of exerciseSequences.entries()) {
    const path = `/bindingRegistry/exerciseSequences/${sequenceIndex}`;
    const orderedBindingIds = rows(sequence?.orderedBindingIds);
    const members = orderedBindingIds.map((bindingId) => bindingById.get(bindingId));
    if (!nonEmptyString(sequence?.id)
        || seenSequenceIds.has(sequence?.id)
        || !Number.isInteger(sequence?.revision)
        || sequence.revision < 1
        || orderedBindingIds.length < 2
        || new Set(orderedBindingIds).size !== orderedBindingIds.length
        || members.some((binding) => !binding)) {
      error("RUNTIME_SEQUENCE_INVALID", path, "Exercise sequence identity and ordered binding membership are invalid.", [sequence?.id].filter(Boolean));
      continue;
    }
    seenSequenceIds.add(sequence.id);
    members.forEach((binding, memberIndex) => {
      if (sequenceMembership.has(binding.id)) {
        error("RUNTIME_SEQUENCE_INVALID", `${path}/orderedBindingIds/${memberIndex}`, `Binding ${binding.id} belongs to more than one sequence.`, [binding.id]);
      }
      sequenceMembership.set(binding.id, sequence.id);
      const source = sourceById.get(sourceKey(binding.contentRef?.catalogId, binding.contentRef?.contentId));
      if (binding.activityId !== sequence.activityId
          || binding.exerciseFamilyId !== sequence.exerciseFamilyId
          || source?.snapshot?.sequenceRef?.id !== sequence.id
          || source?.snapshot?.sequenceRef?.revision !== sequence.revision
          || source?.snapshot?.sequenceStep !== memberIndex + 1) {
        error("RUNTIME_SEQUENCE_INVALID", `${path}/orderedBindingIds/${memberIndex}`, "Runtime sequence order does not match the pinned source step.", [sequence.id, binding.id]);
      }
    });
  }
  for (const binding of rows(bindingRegistry.bindings).filter((entry) => (
    entry?.activityId === CONJUGATION_COMET_ACTIVITY_ID
      && entry?.exerciseFamilyId === CONJUGATION_COMET_EXERCISE_FAMILY_ID
  ))) {
    if (!sequenceMembership.has(binding.id)) {
      error("RUNTIME_SEQUENCE_INVALID", "/bindingRegistry/exerciseSequences", `Morphology binding ${binding.id} is not sequence-owned.`, [binding.id]);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    ...computedDigests,
    summary: {
      units: rows(curriculum.units).length,
      targetSkills: rows(targetPack.skills).length,
      sources: rows(sourceCatalog.sources).length,
      bindings: rows(bindingRegistry.bindings).length,
      exerciseSequences: exerciseSequences.length
    }
  };
}

export function resolveRuntimeBinding(bundle, activityId, contentId) {
  const matches = rows(bundle?.bindingRegistry?.bindings).filter((binding) => (
    binding?.activityId === activityId && binding?.contentRef?.contentId === contentId
  ));
  if (matches.length !== 1) throw new Error(`Expected one binding for ${activityId}/${contentId}; found ${matches.length}.`);
  const binding = matches[0];
  const source = rows(bundle.sourceCatalog.sources).find((row) => (
    row?.activityId === activityId
      && row?.catalogId === binding.contentRef.catalogId
      && row?.contentId === contentId
  ));
  const unit = rows(bundle.curriculum.units).find((row) => row?.id === binding.canonicalUnitId);
  const skills = rows(binding.targetSkillRefs).map((ref) => rows(bundle.targetPack.skills).find((row) => row?.id === ref.id));
  const context = binding.contextId === null
    ? null
    : rows(bundle.targetPack.contexts).find((row) => row?.id === binding.contextId);
  const opportunity = context
    ? rows(context.opportunities).find((row) => row?.id === binding.opportunityId)
    : null;
  return clone({ binding, source, unit, skills, context, opportunity });
}

export class CurriculumTaskError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "CurriculumTaskError";
    this.code = code;
  }
}

export async function issueLearningTask(registry, request) {
  const binding = rows(registry?.bindings).find((row) => row?.id === request?.bindingId);
  if (!binding) throw new CurriculumTaskError("TASK_BINDING_UNKNOWN", `Unknown binding ${request?.bindingId}.`);
  const capability = rows(binding.evidenceCapabilities).find((row) => row?.id === request?.capabilityId);
  if (!capability) throw new CurriculumTaskError("TASK_CAPABILITY_UNKNOWN", `Unknown capability ${request?.capabilityId}.`);
  const skillRef = rows(binding.targetSkillRefs).find((row) => row?.id === request?.targetSkillId)
    || (request?.targetSkillId === undefined ? rows(binding.targetSkillRefs)[0] : null);
  if (!skillRef) throw new CurriculumTaskError("TASK_SKILL_MISMATCH", `Binding ${binding.id} does not supply skill ${request?.targetSkillId}.`);
  if (!nonEmptyString(request?.taskId)
      || !nonEmptyString(request?.sessionId)
      || !nonEmptyString(request?.issuedAt)
      || !Number.isFinite(Date.parse(request.issuedAt))
      || !Number.isInteger(request?.taskSequence)
      || request.taskSequence < 1) {
    throw new CurriculumTaskError("TASK_SCHEMA", "Task request requires IDs, an ISO issue time, and a positive sequence.");
  }
  const task = {
    schemaVersion: LEARNING_TASK_SCHEMA,
    taskId: request.taskId,
    issuedAt: request.issuedAt,
    sessionId: request.sessionId,
    taskSequence: request.taskSequence,
    registry: { id: registry.registryId, version: registry.version },
    bindingId: binding.id,
    capabilityId: capability.id,
    activityId: binding.activityId,
    mechanicId: capability.mechanicId,
    learningStage: capability.learningStage,
    evidenceKind: capability.evidenceKind,
    independence: capability.independence,
    targetLocale: registry.targetPack?.targetLocale,
    contentRef: clone(binding.contentRef),
    canonicalUnitId: binding.canonicalUnitId,
    canonicalUnitRevision: binding.canonicalUnitRevision,
    targetSkillId: skillRef.id,
    targetSkillRevision: skillRef.revision,
    contextId: binding.contextId,
    contextRevision: binding.contextRevision,
    opportunityId: binding.opportunityId
  };
  task.taskFingerprint = await computeLearningTaskFingerprint(task);
  return task;
}

export async function validateLearningTask(curriculum, registry, task) {
  const errors = [];
  const error = (code, path, message) => errors.push({ severity: "error", code, path, message });
  if (!isObject(curriculum) || !isObject(registry) || !isObject(task)) {
    error("TASK_SCHEMA", "/", "Curriculum, registry, and task must be objects.");
    return { valid: false, errors };
  }
  let expectedFingerprint = null;
  try {
    expectedFingerprint = await computeLearningTaskFingerprint(task);
  } catch (cause) {
    error("TASK_SCHEMA", "/", `Task fingerprint projection is invalid: ${cause.message}`);
  }
  if (task.schemaVersion !== LEARNING_TASK_SCHEMA) error("TASK_SCHEMA", "/schemaVersion", `Expected ${LEARNING_TASK_SCHEMA}.`);
  for (const key of unknownKeys(task, LEARNING_TASK_KEYS)) {
    error("TASK_SCHEMA", `/${key}`, `Unknown task field ${key} is not covered by the immutable task contract.`);
  }
  for (const key of unknownKeys(task.registry, ID_VERSION_KEYS)) {
    error("TASK_SCHEMA", `/registry/${key}`, `Unknown task registry field ${key}.`);
  }
  if (!nonEmptyString(task.taskId)
      || !nonEmptyString(task.sessionId)
      || !nonEmptyString(task.issuedAt)
      || !Number.isFinite(Date.parse(task.issuedAt))
      || !Number.isInteger(task.taskSequence)
      || task.taskSequence < 1) {
    error("TASK_SCHEMA", "/", "Task requires an ID, session, ISO issue time, and positive sequence.");
  }
  if (task.taskFingerprint !== expectedFingerprint) error("TASK_FINGERPRINT_MISMATCH", "/taskFingerprint", "Task payload does not match its immutable fingerprint.");
  if (task.registry?.id !== registry.registryId || task.registry?.version !== registry.version) error("TASK_REGISTRY_MISMATCH", "/registry", "Task references a different registry release.");
  const binding = rows(registry.bindings).find((row) => row?.id === task.bindingId);
  const capability = rows(binding?.evidenceCapabilities).find((row) => row?.id === task.capabilityId);
  const skillRef = rows(binding?.targetSkillRefs).find((row) => row?.id === task.targetSkillId);
  const unit = rows(curriculum.units).find((row) => row?.id === task.canonicalUnitId);
  if (!binding) error("TASK_BINDING_UNKNOWN", "/bindingId", "Task binding is unknown.");
  else {
    if (!capability
        || task.activityId !== binding.activityId
        || task.mechanicId !== capability?.mechanicId
        || task.learningStage !== capability?.learningStage
        || task.evidenceKind !== capability?.evidenceKind
        || task.independence !== capability?.independence) {
      error("TASK_CAPABILITY_MISMATCH", "/capabilityId", "Task classification differs from its binding capability.");
    }
    if (!sameContentRef(task.contentRef, binding.contentRef)) error("TASK_CONTENT_STALE", "/contentRef", "Task content is stale.");
    if (!skillRef) error("TASK_SKILL_MISMATCH", "/targetSkillId", "Task skill is absent from this binding.");
    else if (skillRef.revision !== task.targetSkillRevision) error("TASK_SKILL_REVISION_MISMATCH", "/targetSkillRevision", "Task skill revision is stale.");
    if (task.canonicalUnitId !== binding.canonicalUnitId
        || task.canonicalUnitRevision !== binding.canonicalUnitRevision) {
      error("TASK_UNIT_MISMATCH", "/canonicalUnitId", "Task canonical unit differs from its binding.");
    }
    if (task.contextId !== binding.contextId || task.contextRevision !== binding.contextRevision || task.opportunityId !== binding.opportunityId) {
      error("TASK_CONTEXT_MISMATCH", "/contextId", "Task invented or changed its binding context/opportunity.");
    }
  }
  if (!unit || unit.revision !== task.canonicalUnitRevision) error("TASK_UNIT_MISMATCH", "/canonicalUnitId", "Task canonical unit is absent or stale.");
  if (task.targetLocale !== registry.targetPack?.targetLocale) error("TASK_LOCALE_MISMATCH", "/targetLocale", "Task target locale differs from the registry.");
  return { valid: errors.length === 0, errors, expectedFingerprint, binding, capability };
}

export function createLearningEvidenceEvent(task, request) {
  return {
    schemaVersion: EVIDENCE_EVENT_SCHEMA,
    eventId: request.eventId,
    occurredAt: request.occurredAt,
    taskId: task.taskId,
    taskFingerprint: task.taskFingerprint,
    sessionId: task.sessionId,
    taskSequence: task.taskSequence,
    attemptNumber: request.attemptNumber,
    registry: clone(task.registry),
    bindingId: task.bindingId,
    capabilityId: task.capabilityId,
    activityId: task.activityId,
    mechanicId: task.mechanicId,
    contentRef: clone(task.contentRef),
    canonicalUnitId: task.canonicalUnitId,
    canonicalUnitRevision: task.canonicalUnitRevision,
    targetSkillId: task.targetSkillId,
    targetSkillRevision: task.targetSkillRevision,
    contextId: task.contextId,
    contextRevision: task.contextRevision,
    opportunityId: task.opportunityId,
    outcome: {
      score: request.score,
      solutionRevealed: request.solutionRevealed,
      hintsUsed: request.hintsUsed
    }
  };
}

export async function validateLearningEvidenceEvent(curriculum, registry, task, event) {
  const errors = [];
  const error = (code, path, message) => errors.push({ severity: "error", code, path, message });
  const taskValidation = await validateLearningTask(curriculum, registry, task);
  errors.push(...taskValidation.errors);
  const capability = taskValidation.capability;
  if (!isObject(event) || event.schemaVersion !== EVIDENCE_EVENT_SCHEMA) error("EVIDENCE_SCHEMA", "/schemaVersion", `Expected ${EVIDENCE_EVENT_SCHEMA}.`);
  for (const key of unknownKeys(event, EVIDENCE_EVENT_KEYS)) {
    error("EVIDENCE_SCHEMA", `/${key}`, `Unknown evidence field ${key} is not allowed.`);
  }
  for (const key of unknownKeys(event?.registry, ID_VERSION_KEYS)) {
    error("EVIDENCE_SCHEMA", `/registry/${key}`, `Unknown evidence registry field ${key}.`);
  }
  for (const key of unknownKeys(event?.outcome, OUTCOME_KEYS)) {
    error("EVIDENCE_SCHEMA", `/outcome/${key}`, `Unknown evidence outcome field ${key}.`);
  }
  if (!nonEmptyString(event?.eventId)
      || !nonEmptyString(event?.sessionId)
      || !nonEmptyString(event?.occurredAt)
      || !Number.isFinite(Date.parse(event?.occurredAt))
      || !Number.isInteger(event?.taskSequence)
      || event.taskSequence < 1
      || !Number.isInteger(event?.attemptNumber)
      || event.attemptNumber < 1) error("EVIDENCE_SCHEMA", "/", "Evidence requires IDs, an ISO timestamp, positive task sequence, and positive attempt number.");
  if (Number.isFinite(Date.parse(event?.occurredAt))
      && Number.isFinite(Date.parse(task?.issuedAt))
      && Date.parse(event.occurredAt) < Date.parse(task.issuedAt)) {
    error("EVIDENCE_TIME_INVALID", "/occurredAt", "Evidence cannot predate its task.");
  }
  for (const [field, expected] of Object.entries({
    taskId: task.taskId,
    taskFingerprint: task.taskFingerprint,
    sessionId: task.sessionId,
    taskSequence: task.taskSequence,
    bindingId: task.bindingId,
    capabilityId: task.capabilityId,
    activityId: task.activityId,
    mechanicId: task.mechanicId,
    canonicalUnitId: task.canonicalUnitId,
    canonicalUnitRevision: task.canonicalUnitRevision,
    targetSkillId: task.targetSkillId,
    targetSkillRevision: task.targetSkillRevision,
    contextId: task.contextId,
    contextRevision: task.contextRevision,
    opportunityId: task.opportunityId
  })) {
    if (event?.[field] !== expected) error("EVIDENCE_TASK_MISMATCH", `/${field}`, `Evidence ${field} differs from its task.`);
  }
  if (!sameContentRef(event?.contentRef, task.contentRef)) error("EVIDENCE_CONTENT_STALE", "/contentRef", "Evidence content differs from its task.");
  if (event?.registry?.id !== task.registry.id || event?.registry?.version !== task.registry.version) error("EVIDENCE_REGISTRY_MISMATCH", "/registry", "Evidence registry differs from its task.");
  if (!isObject(event?.outcome)
      || typeof event.outcome.solutionRevealed !== "boolean"
      || !Number.isInteger(event.outcome.hintsUsed)
      || event.outcome.hintsUsed < 0) error("EVIDENCE_SCHEMA", "/outcome", "Evidence outcome requires reveal and hint state.");
  const score = event?.outcome?.score;
  if (capability?.scoreRequired && (!Number.isFinite(score) || score < 0 || score > 1)) error("EVIDENCE_SCORE_INVALID", "/outcome/score", "Scored evidence requires a score from zero to one.");
  if (capability?.scoreRequired === false && score !== null) error("EVIDENCE_SCORE_FORBIDDEN", "/outcome/score", "Unscored exposure must use a null score.");
  const qualifiesForIndependentAssessment = errors.length === 0
    && capability?.independence === "independent"
    && capability?.evidenceKind !== "exposure"
    && event.attemptNumber === 1
    && event.outcome.solutionRevealed === false
    && event.outcome.hintsUsed === 0
    && score >= capability?.minimumScore;
  const qualifiesForMastery = qualifiesForIndependentAssessment
    && capability?.masteryEligible === true;
  return {
    valid: errors.length === 0,
    errors,
    capability,
    qualifiesForIndependentAssessment,
    qualifiesForMastery
  };
}

export async function aggregateLearningEvidence(curriculum, registry, tasks, events) {
  const repairGap = curriculum?.planningPolicy?.repairRetryTaskGap;
  if (!Number.isInteger(repairGap?.minimum) || !Number.isInteger(repairGap?.maximum)) {
    throw new CurriculumTaskError("EVIDENCE_POLICY_INVALID", "Canonical repair task gap is invalid.");
  }
  const taskById = new Map();
  const sequenceSlots = new Map();
  for (const task of rows(tasks)) {
    const validation = await validateLearningTask(curriculum, registry, task);
    if (!validation.valid) throw new CurriculumTaskError(validation.errors[0].code, validation.errors[0].message);
    const fingerprint = canonicalJson(task);
    const existing = taskById.get(task.taskId);
    if (existing && existing.fingerprint !== fingerprint) throw new CurriculumTaskError("TASK_ID_CONFLICT", `Task ID ${task.taskId} has conflicting payloads.`);
    const sequenceKey = `${task.sessionId}\u0000${task.taskSequence}`;
    if (sequenceSlots.has(sequenceKey) && sequenceSlots.get(sequenceKey) !== task.taskId) throw new CurriculumTaskError("TASK_SEQUENCE_CONFLICT", "A session sequence belongs to multiple tasks.");
    sequenceSlots.set(sequenceKey, task.taskId);
    if (!existing) taskById.set(task.taskId, { task, validation, fingerprint });
  }
  const eventById = new Map();
  const attemptSlots = new Map();
  for (const event of rows(events)) {
    const taskEntry = taskById.get(event?.taskId);
    if (!taskEntry) throw new CurriculumTaskError("EVIDENCE_TASK_UNKNOWN", `Evidence references unknown task ${event?.taskId}.`);
    const validation = await validateLearningEvidenceEvent(curriculum, registry, taskEntry.task, event);
    if (!validation.valid) throw new CurriculumTaskError(validation.errors[0].code, validation.errors[0].message);
    const fingerprint = canonicalJson(event);
    const existing = eventById.get(event.eventId);
    if (existing && existing.fingerprint !== fingerprint) throw new CurriculumTaskError("EVIDENCE_ID_CONFLICT", `Event ID ${event.eventId} has conflicting payloads.`);
    const attemptKey = `${event.taskId}\u0000${event.attemptNumber}`;
    if (attemptSlots.has(attemptKey) && attemptSlots.get(attemptKey) !== event.eventId) throw new CurriculumTaskError("EVIDENCE_ATTEMPT_CONFLICT", "A task attempt has multiple events.");
    attemptSlots.set(attemptKey, event.eventId);
    if (!existing) eventById.set(event.eventId, { event, task: taskEntry.task, validation, fingerprint });
  }
  const unitById = new Map(rows(curriculum.units).map((unit) => [unit?.id, unit]));
  const aggregates = new Map();
  const ordered = [...eventById.values()].sort((left, right) => (
    Date.parse(left.event.occurredAt) - Date.parse(right.event.occurredAt)
      || left.event.taskSequence - right.event.taskSequence
      || left.event.attemptNumber - right.event.attemptNumber
  ));
  for (const { event, task, validation } of ordered) {
    const key = `${event.canonicalUnitId}\u0000${event.targetSkillId}\u0000${event.targetSkillRevision}`;
    const aggregate = aggregates.get(key) || {
      canonicalUnitId: event.canonicalUnitId,
      canonicalUnitRevision: event.canonicalUnitRevision,
      targetSkillId: event.targetSkillId,
      targetSkillRevision: event.targetSkillRevision,
      exposureEvents: 0,
      assessedAttempts: 0,
      independentRetrievals: 0,
      productionEvidence: 0,
      transferEvidence: 0,
      unresolvedFailure: null,
      contributingActivityIds: new Set(),
      qualifyingSessionIds: new Set(),
      qualifyingContextIds: new Set()
    };
    aggregates.set(key, aggregate);
    const capability = validation.capability;
    if (capability.evidenceKind === "exposure") aggregate.exposureEvents += 1;
    if (capability.scoreRequired) {
      aggregate.assessedAttempts += 1;
      if (capability.independence === "independent"
          && event.attemptNumber === 1
          && !validation.qualifiesForIndependentAssessment) {
        aggregate.unresolvedFailure = {
          learningStage: capability.learningStage,
          sessionId: event.sessionId,
          taskId: event.taskId,
          taskSequence: event.taskSequence
        };
      }
    }
    if (validation.qualifiesForMastery) {
      if (capability.evidenceKind === "retrieval") aggregate.independentRetrievals += 1;
      if (capability.evidenceKind === "production") aggregate.productionEvidence += 1;
      if (capability.evidenceKind === "transfer") aggregate.transferEvidence += 1;
      aggregate.contributingActivityIds.add(event.activityId);
      aggregate.qualifyingSessionIds.add(event.sessionId);
      if (nonEmptyString(event.contextId)) aggregate.qualifyingContextIds.add(event.contextId);
    }
    if (validation.qualifiesForIndependentAssessment) {
      const failure = aggregate.unresolvedFailure;
      if (failure
          && capability.learningStage === failure.learningStage
          && failure.taskId !== task.taskId) {
        const laterSession = task.sessionId !== failure.sessionId;
        const intervening = task.taskSequence - failure.taskSequence - 1;
        if (laterSession || (intervening >= repairGap.minimum && intervening <= repairGap.maximum)) aggregate.unresolvedFailure = null;
      }
    }
  }
  return [...aggregates.values()].map((aggregate) => {
    const policy = unitById.get(aggregate.canonicalUnitId)?.masteryPolicy;
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
      independentRetrievals: aggregate.independentRetrievals,
      productionEvidence: aggregate.productionEvidence,
      transferEvidence: aggregate.transferEvidence,
      unresolvedRecentFailure: Boolean(aggregate.unresolvedFailure),
      contributingActivityIds: [...aggregate.contributingActivityIds].sort(),
      qualifyingSessionIds: [...aggregate.qualifyingSessionIds].sort(),
      qualifyingContextIds: [...aggregate.qualifyingContextIds].sort(),
      masteryReady: shortfalls.length === 0,
      masteryShortfalls: shortfalls
    };
  });
}
