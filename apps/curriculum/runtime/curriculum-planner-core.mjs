import {
  aggregateLearningEvidence,
  canonicalJson,
  computeCanonicalContractDigest,
  computeTargetPackDigest,
  validateLearningEvidenceEvent,
  validateLearningTask
} from "./curriculum-runtime-core.mjs";

export const CURRICULUM_PLAN_SCHEMA = "caatuu-curriculum-progression-v1";

export const PLANNER_REASON_CODES = Object.freeze({
  DELAYED_RETRIEVAL_SESSION_GAP: "delayed-retrieval-session-gap",
  EARLIER_UNIT_NOT_MASTERED: "earlier-unit-not-mastered",
  MASTERY_DISTINCT_CONTEXTS: "mastery-distinct-contexts",
  MASTERY_INDEPENDENT_RETRIEVALS: "mastery-independent-retrievals",
  MASTERY_PRODUCTION: "mastery-production",
  MASTERY_RETRIEVAL_UNSCHEDULABLE: "mastery-retrieval-unschedulable",
  MASTERY_SESSIONS: "mastery-sessions",
  MASTERY_TRANSFER: "mastery-transfer",
  OPEN_TASK_AWAITING_EVIDENCE: "open-task-awaiting-evidence",
  REPAIR_REQUIRES_LATER_SESSION: "repair-requires-later-session",
  REPAIR_SPACING_NOT_REACHED: "repair-spacing-not-reached",
  REQUIRED_STAGE_INCOMPLETE: "required-stage-incomplete",
  SESSION_SEMANTIC_CONCEPT_BUDGET: "session-semantic-concept-budget",
  SESSION_TARGET_CONSTRUCTION_BUDGET: "session-target-construction-budget",
  STAGE_CAPABILITY_UNAVAILABLE: "stage-capability-unavailable",
  TARGET_SKILL_COVERAGE_EMPTY: "target-skill-coverage-empty",
  UNIT_PREREQUISITE_UNMET: "unit-prerequisite-unmet",
  UNRESOLVED_RECENT_FAILURE: "unresolved-recent-failure"
});

const CURRICULUM_SCHEMA = "caatuu-canonical-curriculum-v1";
const PACK_SCHEMA = "caatuu-target-realization-pack-v1";
const REGISTRY_SCHEMA = "caatuu-cross-game-binding-registry-v1";
const EVIDENCE_KINDS = new Set(["exposure", "comprehension", "retrieval", "production", "transfer"]);
const INDEPENDENCE_VALUES = new Set(["exposure", "supported", "independent"]);
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
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function rows(value) {
  return Array.isArray(value) ? value : [];
}

function nonEmptyString(value) {
  return typeof value === "string" && Boolean(value.trim());
}

function sameArray(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function compareText(left, right) {
  return String(left).localeCompare(String(right), "en");
}

function skillKey(unitId, skillId) {
  return `${unitId}\u0000${skillId}`;
}

function reason(code, details = {}) {
  return { code, ...details };
}

export class CurriculumPlannerError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "CurriculumPlannerError";
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new CurriculumPlannerError(code, message, details);
}

function requireContract(condition, path, message) {
  if (!condition) fail("PLANNER_CONTRACT_INVALID", message, { path });
}

function assertUniqueStrings(values, path) {
  requireContract(Array.isArray(values), path, `${path} must be an array.`);
  const seen = new Set();
  for (const [index, value] of values.entries()) {
    requireContract(nonEmptyString(value), `${path}/${index}`, `${path} must contain non-empty strings.`);
    requireContract(!seen.has(value), `${path}/${index}`, `${path} must not contain duplicate ${value}.`);
    seen.add(value);
  }
  return seen;
}

function canonicalTargetSkillSequence(unit, unitBinding, path) {
  const orderedSkillIds = [];
  const seenSkillIds = new Set();
  const mappingGroups = [
    ["functionBindings", "functionIds"],
    ["frameBindings", "frameIds"],
    ["conceptBindings", "conceptIds"]
  ];
  for (const [bindingField, canonicalField] of mappingGroups) {
    const requiredCanonicalIds = rows(unit.semanticScope?.[canonicalField]);
    assertUniqueStrings(requiredCanonicalIds, `/curriculum/units/${unit.ordinal - 1}/semanticScope/${canonicalField}`);
    const mappings = rows(unitBinding[bindingField]);
    requireContract(
      mappings.length === requiredCanonicalIds.length,
      `${path}/${bindingField}`,
      `Unit ${unit.id} must map every canonical ${canonicalField} entry in English order.`
    );
    const suppliedCanonicalIds = mappings.map((mapping) => mapping?.canonicalId);
    assertUniqueStrings(suppliedCanonicalIds, `${path}/${bindingField}`);
    requireContract(
      sameArray(suppliedCanonicalIds, requiredCanonicalIds),
      `${path}/${bindingField}`,
      `Unit ${unit.id} changed the English canonical ${canonicalField} order.`
    );
    for (const [mappingIndex, mapping] of mappings.entries()) {
      const skillIds = rows(mapping?.targetSkillIds);
      assertUniqueStrings(skillIds, `${path}/${bindingField}/${mappingIndex}/targetSkillIds`);
      requireContract(
        skillIds.length > 0,
        `${path}/${bindingField}/${mappingIndex}/targetSkillIds`,
        `Canonical mapping ${mapping?.canonicalId || "(unknown)"} requires at least one target skill.`
      );
      for (const skillId of skillIds) {
        if (seenSkillIds.has(skillId)) continue;
        seenSkillIds.add(skillId);
        orderedSkillIds.push(skillId);
      }
    }
  }
  return orderedSkillIds;
}

function validatePlanningPolicy(curriculum) {
  const policy = curriculum.planningPolicy;
  requireContract(isObject(policy), "/curriculum/planningPolicy", "Canonical planning policy is required.");
  for (const field of ["maxNewSemanticConceptsPerSession", "maxNewTargetConstructionsPerSession"]) {
    requireContract(
      Number.isInteger(policy[field]) && policy[field] >= 0,
      `/curriculum/planningPolicy/${field}`,
      `${field} must be a non-negative integer.`
    );
  }
  const repair = policy.repairRetryTaskGap;
  requireContract(
    Number.isInteger(repair?.minimum)
      && repair.minimum >= 1
      && Number.isInteger(repair?.maximum)
      && repair.maximum >= repair.minimum,
    "/curriculum/planningPolicy/repairRetryTaskGap",
    "Repair spacing requires a positive minimum and a maximum no smaller than the minimum."
  );
  requireContract(
    Number.isInteger(policy.delayedRetrievalMinimumSessionGap)
      && policy.delayedRetrievalMinimumSessionGap >= 1,
    "/curriculum/planningPolicy/delayedRetrievalMinimumSessionGap",
    "Delayed retrieval requires a positive session gap."
  );
  requireContract(
    policy.exposureCanQualifyForMastery === false,
    "/curriculum/planningPolicy/exposureCanQualifyForMastery",
    "Exposure must never qualify for mastery."
  );
  requireContract(
    policy.solutionRevealCanQualifyForMastery === false,
    "/curriculum/planningPolicy/solutionRevealCanQualifyForMastery",
    "A revealed solution must never qualify for mastery."
  );
}

function validateMasteryPolicy(unit, path) {
  const policy = unit.masteryPolicy;
  requireContract(isObject(policy), `${path}/masteryPolicy`, `Unit ${unit.id} requires a mastery policy.`);
  requireContract(
    Number.isInteger(policy.minimumIndependentRetrievals) && policy.minimumIndependentRetrievals >= 1,
    `${path}/masteryPolicy/minimumIndependentRetrievals`,
    `Unit ${unit.id} must require at least one independent retrieval.`
  );
  requireContract(
    Number.isInteger(policy.minimumSessions) && policy.minimumSessions >= 1,
    `${path}/masteryPolicy/minimumSessions`,
    `Unit ${unit.id} must require evidence from at least one session.`
  );
  requireContract(
    Number.isInteger(policy.minimumDistinctContexts) && policy.minimumDistinctContexts >= 1,
    `${path}/masteryPolicy/minimumDistinctContexts`,
    `Unit ${unit.id} must require evidence from at least one distinct context.`
  );
  requireContract(
    policy.scope === "each-required-target-skill",
    `${path}/masteryPolicy/scope`,
    `Planner v1 requires mastery of each required target skill in unit ${unit.id}.`
  );
  for (const field of ["requiresTransfer", "requiresProduction", "solutionRevealCanQualify", "unresolvedRecentFailureBlocksMastery"]) {
    requireContract(typeof policy[field] === "boolean", `${path}/masteryPolicy/${field}`, `${field} must be boolean.`);
  }
  requireContract(
    policy.solutionRevealCanQualify === false,
    `${path}/masteryPolicy/solutionRevealCanQualify`,
    `A revealed solution must never qualify for mastery in unit ${unit.id}.`
  );
}

async function validateContracts(curriculum, targetPack, bindingRegistry) {
  requireContract(isObject(curriculum) && curriculum.schemaVersion === CURRICULUM_SCHEMA, "/curriculum", `Expected ${CURRICULUM_SCHEMA}.`);
  requireContract(isObject(targetPack) && targetPack.schemaVersion === PACK_SCHEMA, "/targetPack", `Expected ${PACK_SCHEMA}.`);
  requireContract(isObject(bindingRegistry) && bindingRegistry.schemaVersion === REGISTRY_SCHEMA, "/bindingRegistry", `Expected ${REGISTRY_SCHEMA}.`);
  requireContract(nonEmptyString(curriculum.curriculumId) && nonEmptyString(curriculum.version), "/curriculum", "The canonical curriculum requires an identity and version.");
  requireContract(nonEmptyString(targetPack.packId) && nonEmptyString(targetPack.version) && nonEmptyString(targetPack.targetLocale), "/targetPack", "The realization pack requires an identity, version, and target locale.");
  requireContract(nonEmptyString(bindingRegistry.registryId) && nonEmptyString(bindingRegistry.version), "/bindingRegistry", "The binding registry requires an identity and version.");
  requireContract(curriculum.specLocale === "en", "/curriculum/specLocale", "The canonical curriculum must be specified in English.");
  requireContract(targetPack.specLocale === "en", "/targetPack/specLocale", "The realization pack must preserve English as the specification locale.");
  validatePlanningPolicy(curriculum);

  const stageIds = rows(curriculum.learningStageSequence);
  const stageSet = assertUniqueStrings(stageIds, "/curriculum/learningStageSequence");
  requireContract(stageIds.length > 0, "/curriculum/learningStageSequence", "The canonical learning-stage sequence cannot be empty.");
  const stageIndex = new Map(stageIds.map((id, index) => [id, index]));
  const unitOrder = rows(curriculum.unitOrder);
  const unitOrderSet = assertUniqueStrings(unitOrder, "/curriculum/unitOrder");
  requireContract(unitOrder.length > 0, "/curriculum/unitOrder", "The canonical unit order cannot be empty.");
  const units = rows(curriculum.units);
  requireContract(units.length === unitOrder.length, "/curriculum/units", "Canonical unitOrder and units must have the same length.");
  const unitById = new Map();
  for (const [index, unit] of units.entries()) {
    const path = `/curriculum/units/${index}`;
    requireContract(isObject(unit) && nonEmptyString(unit.id), path, "Every canonical unit requires an ID.");
    requireContract(unitOrderSet.has(unit.id), `${path}/id`, `Unit ${unit.id} is absent from canonical unitOrder.`);
    requireContract(!unitById.has(unit.id), `${path}/id`, `Duplicate canonical unit ${unit.id}.`);
    requireContract(Number.isInteger(unit.revision) && unit.revision >= 1, `${path}/revision`, `Unit ${unit.id} has an invalid revision.`);
    requireContract(unit.ordinal === unitOrder.indexOf(unit.id) + 1, `${path}/ordinal`, `Unit ${unit.id} ordinal differs from canonical unitOrder.`);
    const requiredStages = rows(unit.requiredLearningStages);
    assertUniqueStrings(requiredStages, `${path}/requiredLearningStages`);
    requireContract(requiredStages.length > 0, `${path}/requiredLearningStages`, `Unit ${unit.id} requires at least one learning stage.`);
    let previousStage = -1;
    for (const [stageOffset, stageId] of requiredStages.entries()) {
      requireContract(stageSet.has(stageId), `${path}/requiredLearningStages/${stageOffset}`, `Unit ${unit.id} references unknown learning stage ${stageId}.`);
      const nextStage = stageIndex.get(stageId);
      requireContract(nextStage > previousStage, `${path}/requiredLearningStages/${stageOffset}`, `Unit ${unit.id} learning stages must follow canonical order.`);
      previousStage = nextStage;
    }
    validateMasteryPolicy(unit, path);
    unitById.set(unit.id, unit);
  }
  for (const [index, unitId] of unitOrder.entries()) {
    const unit = unitById.get(unitId);
    const prerequisiteIds = rows(unit.prerequisiteUnitIds);
    assertUniqueStrings(prerequisiteIds, `/curriculum/units/${index}/prerequisiteUnitIds`);
    for (const prerequisiteId of prerequisiteIds) {
      requireContract(unitById.has(prerequisiteId), `/curriculum/units/${index}/prerequisiteUnitIds`, `Unit ${unitId} references unknown prerequisite ${prerequisiteId}.`);
      requireContract(unitOrder.indexOf(prerequisiteId) < index, `/curriculum/units/${index}/prerequisiteUnitIds`, `Unit ${unitId} prerequisite ${prerequisiteId} must occur earlier.`);
    }
  }

  requireContract(
    targetPack.curriculum?.id === curriculum.curriculumId && targetPack.curriculum?.version === curriculum.version,
    "/targetPack/curriculum",
    "The realization pack targets a different canonical curriculum."
  );
  requireContract(sameArray(rows(targetPack.unitOrder), unitOrder), "/targetPack/unitOrder", "The realization pack changed canonical unit order.");
  const skills = rows(targetPack.skills);
  const skillById = new Map();
  for (const [index, skill] of skills.entries()) {
    const path = `/targetPack/skills/${index}`;
    requireContract(isObject(skill) && nonEmptyString(skill.id), path, "Every target skill requires an ID.");
    requireContract(!skillById.has(skill.id), `${path}/id`, `Duplicate target skill ${skill.id}.`);
    requireContract(Number.isInteger(skill.revision) && skill.revision >= 1, `${path}/revision`, `Target skill ${skill.id} has an invalid revision.`);
    requireContract(unitById.has(skill.unitId), `${path}/unitId`, `Target skill ${skill.id} belongs to an unknown unit.`);
    requireContract(skill.locale === targetPack.targetLocale, `${path}/locale`, `Target skill ${skill.id} has the wrong target locale.`);
    skillById.set(skill.id, skill);
  }
  const contextById = new Map(rows(targetPack.contexts).map((context) => [context?.id, context]));
  const unitBindingById = new Map();
  const boundPackSkillIds = new Set();
  const requiredPackSkillIds = new Set(
    [...skillById.values()]
      .filter((skill) => skill.requiredForOutcome !== false)
      .map((skill) => skill.id)
  );
  for (const [index, unitBinding] of rows(targetPack.unitBindings).entries()) {
    const path = `/targetPack/unitBindings/${index}`;
    requireContract(isObject(unitBinding) && unitById.has(unitBinding.unitId), path, "Every unit realization must reference a canonical unit.");
    requireContract(!unitBindingById.has(unitBinding.unitId), `${path}/unitId`, `Duplicate realization for unit ${unitBinding.unitId}.`);
    const canonicalUnit = unitById.get(unitBinding.unitId);
    requireContract(unitBinding.canonicalRevision === canonicalUnit.revision, `${path}/canonicalRevision`, `Unit realization ${unitBinding.unitId} is stale.`);
    const targetSkillIds = rows(unitBinding.targetSkillIds);
    assertUniqueStrings(targetSkillIds, `${path}/targetSkillIds`);
    requireContract(targetSkillIds.length > 0, `${path}/targetSkillIds`, `Unit ${unitBinding.unitId} must define required target skills.`);
    const canonicalSkillSequence = canonicalTargetSkillSequence(canonicalUnit, unitBinding, path);
    requireContract(
      sameArray(targetSkillIds, canonicalSkillSequence),
      `${path}/targetSkillIds`,
      `Unit ${unitBinding.unitId} target skills must follow their first occurrence in the English-ordered semantic mappings.`
    );
    for (const skillId of targetSkillIds) {
      const skill = skillById.get(skillId);
      requireContract(Boolean(skill), `${path}/targetSkillIds`, `Unit ${unitBinding.unitId} references unknown skill ${skillId}.`);
      requireContract(skill.unitId === unitBinding.unitId, `${path}/targetSkillIds`, `Skill ${skillId} belongs to another unit.`);
      requireContract(
        skill.requiredForOutcome !== false,
        `${path}/targetSkillIds`,
        `Supplemental skill ${skillId} cannot become a required progression or mastery target.`
      );
      requireContract(!boundPackSkillIds.has(skillId), `${path}/targetSkillIds`, `Skill ${skillId} is required by more than one unit.`);
      boundPackSkillIds.add(skillId);
    }
    unitBindingById.set(unitBinding.unitId, unitBinding);
  }
  requireContract(unitBindingById.size === unitOrder.length, "/targetPack/unitBindings", "Every canonical unit requires exactly one realization binding.");
  requireContract(
    boundPackSkillIds.size === requiredPackSkillIds.size
      && [...requiredPackSkillIds].every((skillId) => boundPackSkillIds.has(skillId)),
    "/targetPack/skills",
    "Every outcome-required target skill must be required by exactly one canonical unit."
  );

  const [canonicalDigest, targetPackDigest] = await Promise.all([
    computeCanonicalContractDigest(curriculum),
    computeTargetPackDigest(targetPack)
  ]);
  requireContract(
    bindingRegistry.curriculum?.id === curriculum.curriculumId
      && bindingRegistry.curriculum?.version === curriculum.version
      && bindingRegistry.curriculum?.canonicalContractDigest === canonicalDigest,
    "/bindingRegistry/curriculum",
    "The binding registry does not pin this exact canonical curriculum."
  );
  requireContract(targetPack.canonicalContractDigest === canonicalDigest, "/targetPack/canonicalContractDigest", "The realization pack does not pin this exact canonical curriculum.");
  requireContract(
    bindingRegistry.targetPack?.id === targetPack.packId
      && bindingRegistry.targetPack?.version === targetPack.version
      && bindingRegistry.targetPack?.targetLocale === targetPack.targetLocale
      && bindingRegistry.targetPack?.targetPackDigest === targetPackDigest,
    "/bindingRegistry/targetPack",
    "The binding registry does not pin this exact realization pack."
  );

  const bindingById = new Map();
  const capabilitiesBySkillStage = new Map();
  for (const [index, binding] of rows(bindingRegistry.bindings).entries()) {
    const path = `/bindingRegistry/bindings/${index}`;
    requireContract(isObject(binding) && nonEmptyString(binding.id), path, "Every game binding requires an ID.");
    requireContract(!bindingById.has(binding.id), `${path}/id`, `Duplicate game binding ${binding.id}.`);
    requireContract(nonEmptyString(binding.activityId), `${path}/activityId`, `Game binding ${binding.id} requires an activity ID.`);
    requireContract(
      isObject(binding.contentRef)
        && nonEmptyString(binding.contentRef.catalogId)
        && nonEmptyString(binding.contentRef.catalogRevision)
        && SHA256_PATTERN.test(binding.contentRef.catalogDigest)
        && nonEmptyString(binding.contentRef.contentId)
        && Number.isInteger(binding.contentRef.revision)
        && binding.contentRef.revision >= 1
        && SHA256_PATTERN.test(binding.contentRef.contentDigest),
      `${path}/contentRef`,
      `Game binding ${binding.id} requires a revision- and digest-pinned content reference.`
    );
    let opportunity = null;
    if (binding.contextId === null) {
      requireContract(binding.contextRevision === null && binding.opportunityId === null, `${path}/contextId`, `Context-free binding ${binding.id} must use null context metadata.`);
    } else {
      requireContract(nonEmptyString(binding.contextId) && Number.isInteger(binding.contextRevision) && binding.contextRevision >= 1 && nonEmptyString(binding.opportunityId), `${path}/contextId`, `Contextual binding ${binding.id} requires a revision-pinned opportunity.`);
      const context = contextById.get(binding.contextId);
      requireContract(Boolean(context), `${path}/contextId`, `Game binding ${binding.id} references an unknown context.`);
      requireContract(
        context.revision === binding.contextRevision
          && context.unitId === binding.canonicalUnitId
          && context.locale === targetPack.targetLocale,
        `${path}/contextId`,
        `Game binding ${binding.id} context is stale or misaligned.`
      );
      requireContract(
        rows(unitBindingById.get(binding.canonicalUnitId)?.contextIds).includes(context.id),
        `${path}/contextId`,
        `Game binding ${binding.id} context is not declared by its unit realization.`
      );
      opportunity = rows(context.opportunities).find((row) => row?.id === binding.opportunityId) || null;
      requireContract(Boolean(opportunity), `${path}/opportunityId`, `Game binding ${binding.id} references an unknown opportunity.`);
    }
    const unit = unitById.get(binding.canonicalUnitId);
    requireContract(Boolean(unit) && binding.canonicalUnitRevision === unit.revision, `${path}/canonicalUnitId`, `Game binding ${binding.id} references a missing or stale unit.`);
    const skillRefs = rows(binding.targetSkillRefs);
    requireContract(skillRefs.length > 0, `${path}/targetSkillRefs`, `Game binding ${binding.id} requires at least one target skill.`);
    const bindingSkills = new Set();
    for (const [skillIndex, ref] of skillRefs.entries()) {
      const skill = skillById.get(ref?.id);
      requireContract(Boolean(skill) && skill.revision === ref.revision && skill.unitId === binding.canonicalUnitId, `${path}/targetSkillRefs/${skillIndex}`, `Game binding ${binding.id} has a missing, stale, or cross-unit skill.`);
      requireContract(!bindingSkills.has(ref.id), `${path}/targetSkillRefs/${skillIndex}`, `Game binding ${binding.id} repeats skill ${ref.id}.`);
      bindingSkills.add(ref.id);
    }
    const capabilityIds = new Set();
    const capabilities = rows(binding.evidenceCapabilities);
    requireContract(capabilities.length > 0, `${path}/evidenceCapabilities`, `Game binding ${binding.id} has no evidence capabilities.`);
    for (const [capabilityIndex, capability] of capabilities.entries()) {
      const capabilityPath = `${path}/evidenceCapabilities/${capabilityIndex}`;
      requireContract(isObject(capability) && nonEmptyString(capability.id), capabilityPath, `Game binding ${binding.id} has an invalid capability.`);
      requireContract(!capabilityIds.has(capability.id), `${capabilityPath}/id`, `Game binding ${binding.id} repeats capability ${capability.id}.`);
      capabilityIds.add(capability.id);
      requireContract(stageSet.has(capability.learningStage), `${capabilityPath}/learningStage`, `Capability ${capability.id} uses an unknown learning stage.`);
      requireContract(unit.requiredLearningStages.includes(capability.learningStage), `${capabilityPath}/learningStage`, `Capability ${capability.id} is outside unit ${unit.id}'s required stages.`);
      requireContract(EVIDENCE_KINDS.has(capability.evidenceKind), `${capabilityPath}/evidenceKind`, `Capability ${capability.id} has an unknown evidence kind.`);
      requireContract(
        STAGE_EVIDENCE_KIND.get(capability.learningStage) === capability.evidenceKind,
        `${capabilityPath}/evidenceKind`,
        `Capability ${capability.id} evidence kind does not match canonical stage ${capability.learningStage}.`
      );
      if (opportunity && capability.evidenceKind !== "exposure") {
        const allowedOperations = STAGE_OPPORTUNITY_OPERATIONS.get(capability.learningStage);
        requireContract(
          allowedOperations?.has(opportunity.operation),
          `${capabilityPath}/learningStage`,
          `Capability ${capability.id} stage ${capability.learningStage} requires one of: ${[...(allowedOperations || [])].join(", ")}.`
        );
        if (capability.learningStage === "interact") {
          requireContract(
            rows(opportunity.stimulusUtteranceIds).length > 0,
            `${path}/opportunityId`,
            `Interaction capability ${capability.id} requires an interlocutor stimulus.`
          );
        }
      }
      requireContract(INDEPENDENCE_VALUES.has(capability.independence), `${capabilityPath}/independence`, `Capability ${capability.id} has an unknown independence classification.`);
      requireContract(typeof capability.scoreRequired === "boolean" && typeof capability.masteryEligible === "boolean", capabilityPath, `Capability ${capability.id} requires explicit scoring and mastery flags.`);
      if (capability.evidenceKind === "exposure") {
        requireContract(
          capability.learningStage === "encounter"
            && capability.independence === "exposure"
            && capability.scoreRequired === false
            && capability.masteryEligible === false,
          capabilityPath,
          `Exposure capability ${capability.id} can only provide a non-mastery encounter.`
        );
      } else {
        requireContract(capability.scoreRequired === true, `${capabilityPath}/scoreRequired`, `Assessed capability ${capability.id} must require a score.`);
        requireContract(Number.isFinite(capability.minimumScore) && capability.minimumScore >= 0 && capability.minimumScore <= 1, `${capabilityPath}/minimumScore`, `Capability ${capability.id} requires a score threshold from zero to one.`);
      }
      if (capability.masteryEligible) {
        requireContract(capability.independence === "independent" && capability.evidenceKind !== "exposure", capabilityPath, `Only independent assessed evidence can be mastery eligible.`);
      }
      for (const skillId of bindingSkills) {
        const key = skillKey(binding.canonicalUnitId, skillId);
        const byStage = capabilitiesBySkillStage.get(key) || new Map();
        const entries = byStage.get(capability.learningStage) || [];
        entries.push({ binding, capability });
        byStage.set(capability.learningStage, entries);
        capabilitiesBySkillStage.set(key, byStage);
      }
    }
    bindingById.set(binding.id, binding);
  }
  for (const byStage of capabilitiesBySkillStage.values()) {
    for (const entries of byStage.values()) entries.sort((left, right) => compareText(left.binding.id, right.binding.id) || compareText(left.capability.id, right.capability.id));
  }
  return { stageIds, unitOrder, unitById, skillById, unitBindingById, bindingById, capabilitiesBySkillStage };
}

async function validateHistory(curriculum, bindingRegistry, tasks, events) {
  if (!Array.isArray(tasks) || !Array.isArray(events)) fail("PLANNER_INPUT_INVALID", "Planner tasks and events must be arrays.");
  let aggregateRows;
  try {
    aggregateRows = await aggregateLearningEvidence(curriculum, bindingRegistry, tasks, events);
  } catch (error) {
    fail("PLANNER_HISTORY_INVALID", error.message, { causeCode: error.code || "UNKNOWN" });
  }
  const taskById = new Map();
  for (const task of tasks) {
    let validation;
    try {
      validation = await validateLearningTask(curriculum, bindingRegistry, task);
    } catch (error) {
      fail("PLANNER_HISTORY_INVALID", error.message, { causeCode: error.code || "TASK_VALIDATION_FAILED" });
    }
    if (!validation.valid) fail("PLANNER_HISTORY_INVALID", validation.errors[0].message, { causeCode: validation.errors[0].code });
    const fingerprint = canonicalJson(task);
    const existing = taskById.get(task.taskId);
    if (existing && existing.fingerprint !== fingerprint) fail("PLANNER_HISTORY_INVALID", `Task ID ${task.taskId} has conflicting payloads.`, { causeCode: "TASK_ID_CONFLICT" });
    if (!existing) taskById.set(task.taskId, { task, validation, fingerprint });
  }
  const eventById = new Map();
  const taskIdsWithEvidence = new Set();
  for (const event of events) {
    const taskEntry = taskById.get(event?.taskId);
    if (!taskEntry) fail("PLANNER_HISTORY_INVALID", `Evidence references unknown task ${event?.taskId}.`, { causeCode: "EVIDENCE_TASK_UNKNOWN" });
    const validation = await validateLearningEvidenceEvent(curriculum, bindingRegistry, taskEntry.task, event);
    if (!validation.valid) fail("PLANNER_HISTORY_INVALID", validation.errors[0].message, { causeCode: validation.errors[0].code });
    const fingerprint = canonicalJson(event);
    const existing = eventById.get(event.eventId);
    if (existing && existing.fingerprint !== fingerprint) fail("PLANNER_HISTORY_INVALID", `Event ID ${event.eventId} has conflicting payloads.`, { causeCode: "EVIDENCE_ID_CONFLICT" });
    if (!existing) eventById.set(event.eventId, { event, task: taskEntry.task, validation, fingerprint });
    taskIdsWithEvidence.add(event.taskId);
  }
  const tasksBySession = new Map();
  for (const { task } of taskById.values()) {
    const sessionTasks = tasksBySession.get(task.sessionId) || [];
    sessionTasks.push(task);
    tasksBySession.set(task.sessionId, sessionTasks);
  }
  for (const [sessionId, sessionTasks] of tasksBySession) {
    const sequences = sessionTasks.map((task) => task.taskSequence).sort((left, right) => left - right);
    for (const [index, sequence] of sequences.entries()) {
      if (sequence !== index + 1) fail("PLANNER_HISTORY_INVALID", `Session ${sessionId} task sequence must be contiguous from one.`, { causeCode: "TASK_SEQUENCE_GAP" });
    }
  }
  return {
    aggregateRows,
    taskById,
    eventById,
    openTaskIds: [...taskById.values()].filter(({ task }) => !taskIdsWithEvidence.has(task.taskId)).map(({ task }) => task.taskId).sort(compareText)
  };
}

function buildSessionContext(taskById, currentSession) {
  if (!isObject(currentSession) || !nonEmptyString(currentSession.id)) fail("PLANNER_INPUT_INVALID", "A current session ID is required to plan the next task.");
  const sessionRows = new Map();
  for (const { task } of taskById.values()) {
    const row = sessionRows.get(task.sessionId) || { id: task.sessionId, firstIssuedAt: task.issuedAt, maximumTaskSequence: 0 };
    if (Date.parse(task.issuedAt) < Date.parse(row.firstIssuedAt)) row.firstIssuedAt = task.issuedAt;
    row.maximumTaskSequence = Math.max(row.maximumTaskSequence, task.taskSequence);
    sessionRows.set(task.sessionId, row);
  }
  const ordered = [...sessionRows.values()].sort((left, right) => Date.parse(left.firstIssuedAt) - Date.parse(right.firstIssuedAt) || compareText(left.id, right.id));
  const ordinalById = new Map(ordered.map((row, index) => [row.id, index + 1]));
  const existing = sessionRows.get(currentSession.id);
  if (existing && ordinalById.get(currentSession.id) !== ordered.length) fail("PLANNER_SESSION_STALE", `Session ${currentSession.id} is not the latest known session.`);
  const ordinal = existing ? ordinalById.get(currentSession.id) : ordered.length + 1;
  const minimumSequence = (existing?.maximumTaskSequence || 0) + 1;
  const taskSequence = currentSession.taskSequence === undefined ? minimumSequence : currentSession.taskSequence;
  if (!Number.isInteger(taskSequence) || taskSequence !== minimumSequence) {
    fail("PLANNER_SESSION_SEQUENCE_INVALID", `The next task in session ${currentSession.id} must use sequence ${minimumSequence}.`, { expectedTaskSequence: minimumSequence });
  }
  ordinalById.set(currentSession.id, ordinal);
  return { id: currentSession.id, ordinal, taskSequence, ordinalById };
}

function eventOrder(left, right, ordinalById) {
  return Date.parse(left.event.occurredAt) - Date.parse(right.event.occurredAt)
    || (ordinalById.get(left.event.sessionId) || 0) - (ordinalById.get(right.event.sessionId) || 0)
    || left.event.taskSequence - right.event.taskSequence
    || left.event.attemptNumber - right.event.attemptNumber
    || compareText(left.event.eventId, right.event.eventId);
}

function stageEvidenceQualifies(entry) {
  const { event, validation } = entry;
  const capability = validation.capability;
  if (event.attemptNumber !== 1 || event.outcome.solutionRevealed) return false;
  if (capability.evidenceKind === "exposure") return capability.learningStage === "encounter";
  if (!Number.isFinite(event.outcome.score) || event.outcome.score < capability.minimumScore) return false;
  return capability.independence !== "independent" || event.outcome.hintsUsed === 0;
}

function canonicalConceptIdsForSkill(contracts, unitId, targetSkillId) {
  const canonicalConceptIds = new Set(rows(contracts.unitById.get(unitId)?.semanticScope?.conceptIds));
  return rows(contracts.skillById.get(targetSkillId)?.canonicalIds).filter((id) => canonicalConceptIds.has(id));
}

function computeSessionIntroductionBudget(contracts, taskById, sessionContext, curriculum) {
  const encounterTasks = [...taskById.values()]
    .map(({ task }) => task)
    .filter((task) => task.learningStage === "encounter")
    .sort((left, right) => (
      (sessionContext.ordinalById.get(left.sessionId) || 0) - (sessionContext.ordinalById.get(right.sessionId) || 0)
        || left.taskSequence - right.taskSequence
        || compareText(left.taskId, right.taskId)
    ));
  const introducedTargetSkillIds = new Set();
  const introducedSemanticConceptIds = new Set();
  const currentSessionTargetSkillIds = new Set();
  const currentSessionSemanticConceptIds = new Set();

  const introduce = (task, currentSession) => {
    const { canonicalUnitId, targetSkillId } = task;
    if (!introducedTargetSkillIds.has(targetSkillId) && currentSession) {
      currentSessionTargetSkillIds.add(targetSkillId);
    }
    introducedTargetSkillIds.add(targetSkillId);
    for (const conceptId of canonicalConceptIdsForSkill(contracts, canonicalUnitId, targetSkillId)) {
      if (!introducedSemanticConceptIds.has(conceptId) && currentSession) {
        currentSessionSemanticConceptIds.add(conceptId);
      }
      introducedSemanticConceptIds.add(conceptId);
    }
  };

  for (const task of encounterTasks) {
    if (task.sessionId !== sessionContext.id) introduce(task, false);
  }
  for (const task of encounterTasks) {
    if (task.sessionId === sessionContext.id) introduce(task, true);
  }

  const semanticLimit = curriculum.planningPolicy.maxNewSemanticConceptsPerSession;
  const constructionLimit = curriculum.planningPolicy.maxNewTargetConstructionsPerSession;
  return {
    introducedTargetSkillIds,
    introducedSemanticConceptIds,
    currentSessionTargetSkillIds,
    currentSessionSemanticConceptIds,
    maxNewSemanticConcepts: semanticLimit,
    maxNewTargetConstructions: constructionLimit,
    remainingSemanticConcepts: Math.max(0, semanticLimit - currentSessionSemanticConceptIds.size),
    remainingTargetConstructions: Math.max(0, constructionLimit - currentSessionTargetSkillIds.size)
  };
}

function computeStageProgress(contracts, history, sessionContext, curriculum) {
  const progressBySkill = new Map();
  const ignoredEvidence = [];
  const stageQualifiedEventIds = new Set();
  for (const unitId of contracts.unitOrder) {
    const unit = contracts.unitById.get(unitId);
    const unitBinding = contracts.unitBindingById.get(unitId);
    for (const skillId of unitBinding.targetSkillIds) {
      progressBySkill.set(skillKey(unitId, skillId), {
        requiredStages: [...unit.requiredLearningStages],
        completed: new Map()
      });
    }
  }
  const orderedEvents = [...history.eventById.values()].sort((left, right) => eventOrder(left, right, sessionContext.ordinalById));
  for (const entry of orderedEvents) {
    const key = skillKey(entry.event.canonicalUnitId, entry.event.targetSkillId);
    const progress = progressBySkill.get(key);
    if (!progress) continue;
    const stageId = entry.task.learningStage;
    const stageIndex = progress.requiredStages.indexOf(stageId);
    const nextIndex = progress.requiredStages.findIndex((requiredStage) => !progress.completed.has(requiredStage));
    if (stageIndex < 0) {
      ignoredEvidence.push({ eventId: entry.event.eventId, targetSkillId: entry.event.targetSkillId, learningStage: stageId, reason: "stage-not-required" });
      continue;
    }
    if (!stageEvidenceQualifies(entry)) {
      const failureReason = entry.event.outcome.solutionRevealed
        ? "solution-revealed"
        : entry.event.outcome.hintsUsed > 0 && entry.validation.capability.independence === "independent"
          ? "hinted-independent-response"
          : "stage-outcome-not-qualified";
      ignoredEvidence.push({ eventId: entry.event.eventId, targetSkillId: entry.event.targetSkillId, learningStage: stageId, reason: failureReason });
      continue;
    }
    if (progress.completed.has(stageId)) {
      if (stageId === "delayed-retrieval") {
        const previousStageId = progress.requiredStages[stageIndex - 1];
        const previous = progress.completed.get(previousStageId);
        const observedGap = (sessionContext.ordinalById.get(entry.event.sessionId) || 0) - (sessionContext.ordinalById.get(previous?.sessionId) || 0);
        const requiredGap = curriculum.planningPolicy.delayedRetrievalMinimumSessionGap;
        if (!previous || observedGap < requiredGap) {
          ignoredEvidence.push({
            eventId: entry.event.eventId,
            targetSkillId: entry.event.targetSkillId,
            learningStage: stageId,
            reason: "delayed-retrieval-too-early",
            requiredSessionGap: requiredGap,
            observedSessionGap: observedGap
          });
          continue;
        }
      }
      stageQualifiedEventIds.add(entry.event.eventId);
      continue;
    }
    if (nextIndex !== stageIndex) {
      ignoredEvidence.push({ eventId: entry.event.eventId, targetSkillId: entry.event.targetSkillId, learningStage: stageId, reason: "out-of-order-stage-evidence" });
      continue;
    }
    if (stageId === "delayed-retrieval") {
      const previousStageId = progress.requiredStages[stageIndex - 1];
      const previous = progress.completed.get(previousStageId);
      const observedGap = (sessionContext.ordinalById.get(entry.event.sessionId) || 0) - (sessionContext.ordinalById.get(previous?.sessionId) || 0);
      const requiredGap = curriculum.planningPolicy.delayedRetrievalMinimumSessionGap;
      if (!previous || observedGap < requiredGap) {
        ignoredEvidence.push({
          eventId: entry.event.eventId,
          targetSkillId: entry.event.targetSkillId,
          learningStage: stageId,
          reason: "delayed-retrieval-too-early",
          requiredSessionGap: requiredGap,
          observedSessionGap: observedGap
        });
        continue;
      }
    }
    progress.completed.set(stageId, {
      eventId: entry.event.eventId,
      taskId: entry.event.taskId,
      sessionId: entry.event.sessionId,
      sessionOrdinal: sessionContext.ordinalById.get(entry.event.sessionId),
      occurredAt: entry.event.occurredAt
    });
    stageQualifiedEventIds.add(entry.event.eventId);
  }
  return { progressBySkill, ignoredEvidence, orderedEvents, stageQualifiedEventIds };
}

function computeRepairStates(orderedEvents, curriculum, sessionContext) {
  const repairGap = curriculum.planningPolicy.repairRetryTaskGap;
  const unresolved = new Map();
  for (const entry of orderedEvents) {
    const capability = entry.validation.capability;
    const key = skillKey(entry.event.canonicalUnitId, entry.event.targetSkillId);
    if (capability.scoreRequired
        && capability.independence === "independent"
        && entry.event.attemptNumber === 1
        && !entry.validation.qualifiesForIndependentAssessment) {
      unresolved.set(key, {
        canonicalUnitId: entry.event.canonicalUnitId,
        targetSkillId: entry.event.targetSkillId,
        sessionId: entry.event.sessionId,
        sessionOrdinal: sessionContext.ordinalById.get(entry.event.sessionId),
        taskId: entry.event.taskId,
        taskSequence: entry.event.taskSequence,
        bindingId: entry.event.bindingId,
        capabilityId: entry.event.capabilityId,
        learningStage: entry.task.learningStage,
        eventId: entry.event.eventId
      });
      continue;
    }
    const failure = unresolved.get(key);
    if (!failure
        || !entry.validation.qualifiesForIndependentAssessment
        || entry.validation.capability.learningStage !== failure.learningStage
        || entry.event.taskId === failure.taskId) continue;
    const laterSession = entry.event.sessionId !== failure.sessionId
      && (sessionContext.ordinalById.get(entry.event.sessionId) || 0) > failure.sessionOrdinal;
    const intervening = entry.event.taskSequence - failure.taskSequence - 1;
    if (laterSession || (entry.event.sessionId === failure.sessionId && intervening >= repairGap.minimum && intervening <= repairGap.maximum)) {
      unresolved.delete(key);
    }
  }
  return [...unresolved.values()].map((failure) => {
    if (failure.sessionId !== sessionContext.id) {
      return { ...failure, status: "due", timing: "later-session", interveningTasks: null, tasksUntilEligible: 0 };
    }
    const interveningTasks = sessionContext.taskSequence - failure.taskSequence - 1;
    if (interveningTasks < repairGap.minimum) {
      return { ...failure, status: "waiting", timing: "same-session", interveningTasks, tasksUntilEligible: repairGap.minimum - interveningTasks };
    }
    if (interveningTasks > repairGap.maximum) {
      return { ...failure, status: "missed", timing: "same-session", interveningTasks, tasksUntilEligible: null };
    }
    return { ...failure, status: "due", timing: "same-session", interveningTasks, tasksUntilEligible: 0 };
  }).sort((left, right) => left.sessionOrdinal - right.sessionOrdinal || left.taskSequence - right.taskSequence || compareText(left.targetSkillId, right.targetSkillId));
}

function blankAggregate(unit, skill) {
  return {
    canonicalUnitId: unit.id,
    canonicalUnitRevision: unit.revision,
    targetSkillId: skill.id,
    targetSkillRevision: skill.revision,
    exposureEvents: 0,
    assessedAttempts: 0,
    independentRetrievals: 0,
    productionEvidence: 0,
    transferEvidence: 0,
    unresolvedRecentFailure: false,
    contributingActivityIds: [],
    qualifyingSessionIds: [],
    qualifyingContextIds: [],
    masteryReady: false,
    masteryShortfalls: []
  };
}

function masteryDetails(unit, aggregate, stages) {
  const policy = unit.masteryPolicy;
  const shortfalls = [];
  if (aggregate.independentRetrievals < policy.minimumIndependentRetrievals) shortfalls.push(reason(PLANNER_REASON_CODES.MASTERY_INDEPENDENT_RETRIEVALS, { required: policy.minimumIndependentRetrievals, observed: aggregate.independentRetrievals }));
  if (aggregate.qualifyingSessionIds.length < policy.minimumSessions) shortfalls.push(reason(PLANNER_REASON_CODES.MASTERY_SESSIONS, { required: policy.minimumSessions, observed: aggregate.qualifyingSessionIds.length }));
  if (aggregate.qualifyingContextIds.length < policy.minimumDistinctContexts) shortfalls.push(reason(PLANNER_REASON_CODES.MASTERY_DISTINCT_CONTEXTS, { required: policy.minimumDistinctContexts, observed: aggregate.qualifyingContextIds.length }));
  if (policy.requiresProduction && aggregate.productionEvidence < 1) shortfalls.push(reason(PLANNER_REASON_CODES.MASTERY_PRODUCTION, { required: 1, observed: aggregate.productionEvidence }));
  if (policy.requiresTransfer && aggregate.transferEvidence < 1) shortfalls.push(reason(PLANNER_REASON_CODES.MASTERY_TRANSFER, { required: 1, observed: aggregate.transferEvidence }));
  if (policy.unresolvedRecentFailureBlocksMastery && aggregate.unresolvedRecentFailure) shortfalls.push(reason(PLANNER_REASON_CODES.UNRESOLVED_RECENT_FAILURE));
  for (const stage of stages) {
    if (stage.status !== "complete") shortfalls.push(reason(PLANNER_REASON_CODES.REQUIRED_STAGE_INCOMPLETE, { learningStage: stage.id }));
  }
  return shortfalls;
}

function stageRowsForSkill(unit, progress, capabilitiesByStage) {
  const firstIncompleteIndex = unit.requiredLearningStages.findIndex((stageId) => !progress.completed.has(stageId));
  return unit.requiredLearningStages.map((stageId, index) => {
    const completion = progress.completed.get(stageId) || null;
    const capabilityCount = rows(capabilitiesByStage?.get(stageId)).length;
    let status = completion ? "complete" : index === firstIncompleteIndex ? "current" : "pending";
    if (!completion && index === firstIncompleteIndex && capabilityCount === 0) status = "blocked";
    return { id: stageId, status, capabilityCount, completion };
  });
}

function masteryRetrievalEntries(skillRow, contracts, learningStage) {
  return rows(
    contracts.capabilitiesBySkillStage
      .get(skillKey(skillRow.canonicalUnitId, skillRow.targetSkillId))
      ?.get(learningStage)
  ).filter(({ capability }) => (
    capability.evidenceKind === "retrieval"
      && capability.independence === "independent"
      && capability.scoreRequired === true
      && capability.masteryEligible === true
      && Number.isFinite(capability.minimumScore)
  ));
}

function consolidationCandidateForSkill(skillRow, contracts, sessionContext, curriculum) {
  if (skillRow.masteryReady) return { required: false, candidate: null, blockers: [] };
  const retrieveIndex = skillRow.stages.findIndex((stage) => stage.id === "retrieve");
  if (retrieveIndex < 0 || skillRow.stages[retrieveIndex].status !== "complete") {
    return { required: false, candidate: null, blockers: [] };
  }
  const unit = contracts.unitById.get(skillRow.canonicalUnitId);
  const reservedFutureRetrievals = skillRow.stages
    .slice(retrieveIndex + 1)
    .filter((stage) => stage.status !== "complete" && masteryRetrievalEntries(skillRow, contracts, stage.id).length > 0)
    .length;
  const observedRetrievals = skillRow.evidence.independentRetrievals;
  const deficit = unit.masteryPolicy.minimumIndependentRetrievals
    - observedRetrievals
    - reservedFutureRetrievals;
  if (deficit <= 0) return { required: false, candidate: null, blockers: [] };

  const allStagesComplete = skillRow.stages.every((stage) => stage.status === "complete");
  const learningStage = allStagesComplete ? "delayed-retrieval" : "retrieve";
  const entries = masteryRetrievalEntries(skillRow, contracts, learningStage);
  if (entries.length === 0) {
    return {
      required: true,
      candidate: null,
      blockers: [reason(PLANNER_REASON_CODES.MASTERY_RETRIEVAL_UNSCHEDULABLE, {
        targetSkillId: skillRow.targetSkillId,
        required: unit.masteryPolicy.minimumIndependentRetrievals,
        observed: observedRetrievals,
        reservedFutureRetrievals
      })]
    };
  }
  if (learningStage === "delayed-retrieval") {
    const completion = skillRow.stages.find((stage) => stage.id === learningStage)?.completion;
    const observedGap = sessionContext.ordinal - (completion?.sessionOrdinal || sessionContext.ordinal);
    const requiredGap = curriculum.planningPolicy.delayedRetrievalMinimumSessionGap;
    if (observedGap < requiredGap) {
      return {
        required: true,
        candidate: null,
        blockers: [reason(PLANNER_REASON_CODES.DELAYED_RETRIEVAL_SESSION_GAP, {
          targetSkillId: skillRow.targetSkillId,
          purpose: "consolidation",
          requiredSessionGap: requiredGap,
          observedSessionGap: observedGap
        })]
      };
    }
  }
  const selected = entries[0];
  return {
    required: true,
    candidate: {
      purpose: "consolidation",
      canonicalUnitId: skillRow.canonicalUnitId,
      targetSkillId: skillRow.targetSkillId,
      learningStage,
      activityId: selected.binding.activityId,
      bindingId: selected.binding.id,
      capabilityId: selected.capability.id,
      remainingRetrievalsAfterTask: Math.max(0, deficit - 1),
      reservedFutureRetrievals,
      request: {
        bindingId: selected.binding.id,
        capabilityId: selected.capability.id,
        targetSkillId: skillRow.targetSkillId
      }
    },
    blockers: []
  };
}

function candidateForSkill(skillRow, contracts, sessionContext, curriculum, introductionBudget) {
  if (skillRow.masteryReady) return { candidate: null, blockers: [] };
  const currentStage = skillRow.stages.find((stage) => stage.status !== "complete");
  if (!currentStage) return { candidate: null, blockers: skillRow.shortfalls };
  const entries = contracts.capabilitiesBySkillStage.get(skillKey(skillRow.canonicalUnitId, skillRow.targetSkillId))?.get(currentStage.id) || [];
  if (entries.length === 0) {
    return {
      candidate: null,
      blockers: [reason(PLANNER_REASON_CODES.STAGE_CAPABILITY_UNAVAILABLE, { targetSkillId: skillRow.targetSkillId, learningStage: currentStage.id })]
    };
  }
  if (currentStage.id === "encounter" && !introductionBudget.introducedTargetSkillIds.has(skillRow.targetSkillId)) {
    const blockers = [];
    const nextConstructionCount = introductionBudget.currentSessionTargetSkillIds.size + 1;
    if (nextConstructionCount > introductionBudget.maxNewTargetConstructions) {
      blockers.push(reason(PLANNER_REASON_CODES.SESSION_TARGET_CONSTRUCTION_BUDGET, {
        targetSkillId: skillRow.targetSkillId,
        limit: introductionBudget.maxNewTargetConstructions,
        introducedThisSession: introductionBudget.currentSessionTargetSkillIds.size
      }));
    }
    const newConceptIds = canonicalConceptIdsForSkill(
      contracts,
      skillRow.canonicalUnitId,
      skillRow.targetSkillId
    ).filter((conceptId) => !introductionBudget.introducedSemanticConceptIds.has(conceptId));
    const nextConceptCount = introductionBudget.currentSessionSemanticConceptIds.size + newConceptIds.length;
    if (nextConceptCount > introductionBudget.maxNewSemanticConcepts) {
      blockers.push(reason(PLANNER_REASON_CODES.SESSION_SEMANTIC_CONCEPT_BUDGET, {
        targetSkillId: skillRow.targetSkillId,
        conceptIds: newConceptIds,
        limit: introductionBudget.maxNewSemanticConcepts,
        introducedThisSession: introductionBudget.currentSessionSemanticConceptIds.size
      }));
    }
    if (blockers.length) return { candidate: null, blockers };
  }
  if (currentStage.id === "delayed-retrieval") {
    const previousStage = skillRow.stages[skillRow.stages.length - 2];
    const observedGap = sessionContext.ordinal - (previousStage?.completion?.sessionOrdinal || sessionContext.ordinal);
    const requiredGap = curriculum.planningPolicy.delayedRetrievalMinimumSessionGap;
    if (observedGap < requiredGap) {
      return {
        candidate: null,
        blockers: [reason(PLANNER_REASON_CODES.DELAYED_RETRIEVAL_SESSION_GAP, {
          targetSkillId: skillRow.targetSkillId,
          requiredSessionGap: requiredGap,
          observedSessionGap: observedGap
        })]
      };
    }
  }
  const selected = entries[0];
  return {
    candidate: {
      purpose: "stage",
      canonicalUnitId: skillRow.canonicalUnitId,
      targetSkillId: skillRow.targetSkillId,
      learningStage: currentStage.id,
      activityId: selected.binding.activityId,
      bindingId: selected.binding.id,
      capabilityId: selected.capability.id,
      request: {
        bindingId: selected.binding.id,
        capabilityId: selected.capability.id,
        targetSkillId: skillRow.targetSkillId
      }
    },
    blockers: []
  };
}

function repairCandidate(repair, skillRow, contracts) {
  const currentStage = skillRow?.stages.find((stage) => stage.status !== "complete");
  const failedStageIndex = skillRow?.stages.findIndex((stage) => stage.id === repair.learningStage) ?? -1;
  const currentStageIndex = currentStage ? skillRow.stages.indexOf(currentStage) : skillRow?.stages.length ?? -1;
  if (!skillRow || failedStageIndex > currentStageIndex) return null;
  const binding = contracts.bindingById.get(repair.bindingId);
  const capability = rows(binding?.evidenceCapabilities).find((row) => row?.id === repair.capabilityId);
  if (!binding || !capability) return null;
  return {
    purpose: "repair",
    canonicalUnitId: repair.canonicalUnitId,
    targetSkillId: repair.targetSkillId,
    learningStage: repair.learningStage,
    activityId: binding.activityId,
    bindingId: binding.id,
    capabilityId: capability.id,
    repairsTaskId: repair.taskId,
    repairTiming: repair.timing,
    request: {
      bindingId: binding.id,
      capabilityId: capability.id,
      targetSkillId: repair.targetSkillId
    }
  };
}

export async function computeCurriculumProgression({
  curriculum,
  targetPack,
  bindingRegistry,
  tasks = [],
  events = [],
  currentSession
} = {}) {
  const contracts = await validateContracts(curriculum, targetPack, bindingRegistry);
  const history = await validateHistory(curriculum, bindingRegistry, tasks, events);
  const sessionContext = buildSessionContext(history.taskById, currentSession);
  const {
    progressBySkill,
    ignoredEvidence,
    orderedEvents,
    stageQualifiedEventIds
  } = computeStageProgress(contracts, history, sessionContext, curriculum);
  const introductionBudget = computeSessionIntroductionBudget(
    contracts,
    history.taskById,
    sessionContext,
    curriculum
  );
  const repairQueue = computeRepairStates(orderedEvents, curriculum, sessionContext);
  const repairBySkill = new Map(repairQueue.map((entry) => [skillKey(entry.canonicalUnitId, entry.targetSkillId), entry]));
  const stageQualifiedEvents = [...history.eventById.values()]
    .filter(({ event }) => stageQualifiedEventIds.has(event.eventId))
    .map(({ event }) => event);
  const stageQualifiedAggregates = await aggregateLearningEvidence(
    curriculum,
    bindingRegistry,
    tasks,
    stageQualifiedEvents
  );
  const rawAggregateBySkill = new Map(history.aggregateRows.map((row) => [skillKey(row.canonicalUnitId, row.targetSkillId), row]));
  const aggregateBySkill = new Map(stageQualifiedAggregates.map((row) => {
    const key = skillKey(row.canonicalUnitId, row.targetSkillId);
    const raw = rawAggregateBySkill.get(key);
    return [key, {
      ...row,
      exposureEvents: raw?.exposureEvents ?? row.exposureEvents,
      assessedAttempts: raw?.assessedAttempts ?? row.assessedAttempts,
      unresolvedRecentFailure: raw?.unresolvedRecentFailure ?? row.unresolvedRecentFailure
    }];
  }));
  for (const [key, raw] of rawAggregateBySkill) {
    if (!aggregateBySkill.has(key)) {
      aggregateBySkill.set(key, {
        ...raw,
        independentRetrievals: 0,
        productionEvidence: 0,
        transferEvidence: 0,
        contributingActivityIds: [],
        qualifyingSessionIds: [],
        qualifyingContextIds: [],
        masteryReady: false
      });
    }
  }

  const skillsByUnit = new Map();
  const skillRowByKey = new Map();
  for (const unitId of contracts.unitOrder) {
    const unit = contracts.unitById.get(unitId);
    const skillRows = [];
    for (const skillId of contracts.unitBindingById.get(unitId).targetSkillIds) {
      const skill = contracts.skillById.get(skillId);
      const key = skillKey(unitId, skillId);
      const aggregate = aggregateBySkill.get(key) || blankAggregate(unit, skill);
      const stages = stageRowsForSkill(unit, progressBySkill.get(key), contracts.capabilitiesBySkillStage.get(key));
      const shortfalls = masteryDetails(unit, aggregate, stages);
      const skillRow = {
        canonicalUnitId: unitId,
        canonicalUnitRevision: unit.revision,
        targetSkillId: skillId,
        targetSkillRevision: skill.revision,
        stages,
        evidence: {
          exposureEvents: aggregate.exposureEvents,
          assessedAttempts: aggregate.assessedAttempts,
          independentRetrievals: aggregate.independentRetrievals,
          productionEvidence: aggregate.productionEvidence,
          transferEvidence: aggregate.transferEvidence,
          contributingActivityIds: [...aggregate.contributingActivityIds],
          qualifyingSessionIds: [...aggregate.qualifyingSessionIds],
          qualifyingContextIds: [...aggregate.qualifyingContextIds]
        },
        repair: repairBySkill.get(key) || null,
        masteryReady: shortfalls.length === 0,
        masteryShortfalls: shortfalls.map((entry) => entry.code),
        shortfalls
      };
      skillRows.push(skillRow);
      skillRowByKey.set(key, skillRow);
    }
    skillsByUnit.set(unitId, skillRows);
  }

  const unitRows = [];
  const masteredUnitIds = new Set();
  for (const [index, unitId] of contracts.unitOrder.entries()) {
    const unit = contracts.unitById.get(unitId);
    const skills = skillsByUnit.get(unitId);
    const explicitUnmet = unit.prerequisiteUnitIds.filter((id) => !masteredUnitIds.has(id));
    const earlierUnmet = contracts.unitOrder.slice(0, index).filter((id) => !masteredUnitIds.has(id));
    const masteryReady = skills.length > 0 && skills.every((skill) => skill.masteryReady);
    const mastered = masteryReady && explicitUnmet.length === 0 && earlierUnmet.length === 0;
    if (mastered) masteredUnitIds.add(unitId);
    const blockers = [];
    for (const prerequisiteUnitId of explicitUnmet) blockers.push(reason(PLANNER_REASON_CODES.UNIT_PREREQUISITE_UNMET, { prerequisiteUnitId }));
    for (const earlierUnitId of earlierUnmet.filter((id) => !explicitUnmet.includes(id))) blockers.push(reason(PLANNER_REASON_CODES.EARLIER_UNIT_NOT_MASTERED, { earlierUnitId }));
    if (skills.length === 0) blockers.push(reason(PLANNER_REASON_CODES.TARGET_SKILL_COVERAGE_EMPTY, { canonicalUnitId: unitId }));
    unitRows.push({
      canonicalUnitId: unitId,
      canonicalUnitRevision: unit.revision,
      ordinal: unit.ordinal,
      prerequisiteUnitIds: [...unit.prerequisiteUnitIds],
      status: mastered ? "mastered" : blockers.length ? "locked" : "available",
      masteryReady,
      mastered,
      requiredTargetSkillIds: skills.map((skill) => skill.targetSkillId),
      unmasteredTargetSkillIds: skills.filter((skill) => !skill.masteryReady).map((skill) => skill.targetSkillId),
      blockers,
      skills
    });
  }

  const activeUnit = unitRows.find((unit) => !unit.mastered);
  let nextTask;
  if (!activeUnit) {
    nextTask = { status: "complete", reasons: [] };
  } else if (activeUnit.status === "locked") {
    nextTask = { status: "blocked", reasons: [...activeUnit.blockers] };
  } else if (history.openTaskIds.length > 0) {
    nextTask = {
      status: "blocked",
      reasons: [reason(PLANNER_REASON_CODES.OPEN_TASK_AWAITING_EVIDENCE, { taskIds: history.openTaskIds })]
    };
  } else {
    const activeRepairs = repairQueue.filter((repair) => repair.canonicalUnitId === activeUnit.canonicalUnitId);
    const dueRepair = activeRepairs.find((repair) => repair.status === "due");
    const dueCandidate = dueRepair
      ? repairCandidate(dueRepair, skillRowByKey.get(skillKey(dueRepair.canonicalUnitId, dueRepair.targetSkillId)), contracts)
      : null;
    if (dueCandidate) {
      nextTask = { status: "ready", ...dueCandidate, reasons: [] };
    } else {
      const readyCandidates = [];
      const blockers = [];
      for (const skill of activeUnit.skills) {
        const repair = repairBySkill.get(skillKey(skill.canonicalUnitId, skill.targetSkillId));
        if (repair?.status === "waiting") {
          blockers.push(reason(PLANNER_REASON_CODES.REPAIR_SPACING_NOT_REACHED, {
            targetSkillId: skill.targetSkillId,
            failedTaskId: repair.taskId,
            tasksUntilEligible: repair.tasksUntilEligible,
            minimumInterveningTasks: curriculum.planningPolicy.repairRetryTaskGap.minimum,
            maximumInterveningTasks: curriculum.planningPolicy.repairRetryTaskGap.maximum
          }));
          continue;
        }
        if (repair?.status === "missed") {
          blockers.push(reason(PLANNER_REASON_CODES.REPAIR_REQUIRES_LATER_SESSION, {
            targetSkillId: skill.targetSkillId,
            failedTaskId: repair.taskId,
            maximumInterveningTasks: curriculum.planningPolicy.repairRetryTaskGap.maximum
          }));
          continue;
        }
        const consolidation = consolidationCandidateForSkill(skill, contracts, sessionContext, curriculum);
        if (consolidation.required) {
          if (consolidation.candidate) readyCandidates.push(consolidation.candidate);
          blockers.push(...consolidation.blockers);
          continue;
        }
        const result = candidateForSkill(skill, contracts, sessionContext, curriculum, introductionBudget);
        if (result.candidate) readyCandidates.push(result.candidate);
        blockers.push(...result.blockers);
      }
      if (readyCandidates.length > 0) {
        const selected = readyCandidates[0];
        const waitingRepair = activeRepairs.find((repair) => repair.status === "waiting");
        nextTask = {
          status: "ready",
          ...selected,
          purpose: waitingRepair ? "spacing" : selected.purpose,
          spacingForTaskId: waitingRepair?.taskId || null,
          reasons: []
        };
      } else {
        nextTask = { status: "blocked", reasons: blockers.length ? blockers : activeUnit.skills.flatMap((skill) => skill.shortfalls) };
      }
    }
  }

  if (activeUnit) {
    activeUnit.status = nextTask.status === "blocked" ? "blocked" : "active";
    if (nextTask.status === "blocked") activeUnit.blockers = [...activeUnit.blockers, ...nextTask.reasons];
  }
  const mechanicCoverage = contracts.unitOrder.map((unitId) => {
    const unit = contracts.unitById.get(unitId);
    const requiredTargetSkillIds = contracts.unitBindingById.get(unitId).targetSkillIds;
    const stageSlots = requiredTargetSkillIds.flatMap((targetSkillId) => unit.requiredLearningStages.map((learningStage) => {
      const entries = contracts.capabilitiesBySkillStage.get(skillKey(unitId, targetSkillId))?.get(learningStage) || [];
      return {
        targetSkillId,
        learningStage,
        covered: entries.length > 0,
        mechanics: entries.map(({ binding, capability }) => ({
          activityId: binding.activityId,
          bindingId: binding.id,
          capabilityId: capability.id,
          mechanicId: capability.mechanicId
        }))
      };
    }));
    return {
      canonicalUnitId: unitId,
      requiredTargetSkillCount: requiredTargetSkillIds.length,
      requiredStageSlotCount: stageSlots.length,
      coveredStageSlotCount: stageSlots.filter((slot) => slot.covered).length,
      missingStageSlots: stageSlots.filter((slot) => !slot.covered).map(({ targetSkillId, learningStage }) => ({ targetSkillId, learningStage })),
      stageSlots
    };
  });
  return {
    schemaVersion: CURRICULUM_PLAN_SCHEMA,
    curriculum: { id: curriculum.curriculumId, version: curriculum.version, specLocale: curriculum.specLocale },
    targetPack: { id: targetPack.packId, version: targetPack.version, targetLocale: targetPack.targetLocale },
    status: nextTask.status === "complete" ? "complete" : nextTask.status,
    planningContext: {
      sessionId: sessionContext.id,
      sessionOrdinal: sessionContext.ordinal,
      nextTaskSequence: sessionContext.taskSequence,
      introductionBudget: {
        maxNewSemanticConcepts: introductionBudget.maxNewSemanticConcepts,
        introducedSemanticConceptIds: [...introductionBudget.currentSessionSemanticConceptIds],
        remainingSemanticConcepts: introductionBudget.remainingSemanticConcepts,
        maxNewTargetConstructions: introductionBudget.maxNewTargetConstructions,
        introducedTargetSkillIds: [...introductionBudget.currentSessionTargetSkillIds],
        remainingTargetConstructions: introductionBudget.remainingTargetConstructions
      }
    },
    activeUnitId: activeUnit?.canonicalUnitId || null,
    masteredUnitIds: [...masteredUnitIds],
    units: unitRows,
    repairQueue,
    openTaskIds: history.openTaskIds,
    ignoredEvidence,
    nextTask,
    nextRequest: nextTask,
    developerDiagnostics: {
      note: "Mechanic coverage is diagnostic only and never bypasses canonical learner eligibility.",
      mechanicCoverage
    }
  };
}

export async function planNextLearningTask(input) {
  return (await computeCurriculumProgression(input)).nextTask;
}
