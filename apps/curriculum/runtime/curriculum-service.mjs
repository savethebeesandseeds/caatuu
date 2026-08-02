import {
  aggregateLearningEvidence,
  canonicalJson,
  CONJUGATION_COMET_ACTIVITY_ID,
  CONJUGATION_COMET_EXERCISE_FAMILY_ID,
  createLearningEvidenceEvent,
  issueLearningTask,
  resolveRuntimeBinding,
  validateLearningEvidenceEvent,
  validateLearningTask,
  validateRuntimeBundle
} from "./curriculum-runtime-core.mjs";
import { computeCurriculumProgression } from "./curriculum-planner-core.mjs";
import { MORPHOLOGY_ROUND_SCHEMA } from "./morphology-round-core.mjs";

// v2 tasks predate explicit exercise-family identity in content digests, and
// v3 morphology tasks were issued under the former Verb Nebula activity. Keep
// both generations intact for audit; immutable tasks, fingerprints, evidence,
// and completion proofs must not be rewritten into Conjugation Comet.
const STORAGE_VERSION = 4;
const MAX_STORED_TASKS = 2000;
const MAX_STORED_EVENTS = 4000;
const MAX_STORED_DEVELOPER_PILOT_CLAIMS = 256;
const MAX_STORED_DEVELOPER_PILOT_SEQUENCES = 64;
const MAX_STORED_DEVELOPER_PILOT_COMPLETIONS = 256;
const MAX_STORED_MORPHOLOGY_ROUND_STATES = 256;
const DEVELOPER_PILOT_SEQUENCE_SCHEMA = "caatuu-developer-pilot-sequence-v1";
const DEVELOPER_PILOT_COMPLETION_SCHEMA = "caatuu-developer-pilot-step-completion-v1";
const MORPHOLOGY_ROUND_STATE_SCHEMA = "caatuu-morphology-round-state-v2";
const LEGACY_MORPHOLOGY_ROUND_STATE_SCHEMA = "caatuu-morphology-round-state-v1";
const MORPHOLOGY_GUIDED_PROGRESS_SCHEMA = "caatuu-morphology-guided-progress-v1";
const MORPHOLOGY_FAMILY_ROUND_SCHEMA = 1;
const MORPHOLOGY_SOLUTION_REVEALED = "solution-revealed";
const MORPHOLOGY_UNREVEALED_HINT_STATES = new Set(["available", "used"]);
const VERB_MORPHOLOGY_FAMILY = "morphology";
const DEVELOPER_PILOT_COMPLETION_KINDS = new Set([
  "correct-first-response",
  "corrective-correct",
  "solution-review"
]);

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
  return globalThis.structuredClone
    ? globalThis.structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function defaultUuid() {
  if (!globalThis.crypto?.randomUUID) throw new Error("crypto.randomUUID is required by the curriculum service.");
  return globalThis.crypto.randomUUID();
}

function loopbackHost(hostname) {
  return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(String(hostname || "").toLowerCase());
}

export class CurriculumServiceError extends Error {
  constructor(code, message, details = []) {
    super(message);
    this.name = "CurriculumServiceError";
    this.code = code;
    this.details = details;
  }
}

export function createCurriculumService({
  courseProfile,
  fetchImpl = globalThis.fetch,
  localStorage = globalThis.localStorage,
  sessionStorage = globalThis.sessionStorage,
  location = globalThis.location,
  now = () => new Date().toISOString(),
  uuid = defaultUuid,
  lockManager = globalThis.navigator?.locks
} = {}) {
  const configuration = courseProfile?.curriculum;
  if (!isObject(configuration)) throw new CurriculumServiceError("CURRICULUM_CONFIG_MISSING", "Course profile requires a curriculum configuration.");
  if (typeof fetchImpl !== "function") throw new CurriculumServiceError("CURRICULUM_FETCH_MISSING", "Curriculum service requires fetch.");
  if (!localStorage || !sessionStorage) throw new CurriculumServiceError("CURRICULUM_STORAGE_MISSING", "Curriculum service requires local and session storage.");

  const namespace = String(courseProfile?.storage?.namespace || courseProfile?.id || "caatuu");
  const tasksKey = `${namespace}.curriculum.tasks.v${STORAGE_VERSION}`;
  const eventsKey = `${namespace}.curriculum.events.v${STORAGE_VERSION}`;
  const developerPilotClaimsKey = `${namespace}.curriculum.developer-pilot-claims.v${STORAGE_VERSION}`;
  const developerPilotSequencesKey = `${namespace}.curriculum.developer-pilot-sequences.v${STORAGE_VERSION}`;
  const developerPilotCompletionsKey = `${namespace}.curriculum.developer-pilot-step-completions.v${STORAGE_VERSION}`;
  const morphologyRoundStatesKey = `${namespace}.curriculum.morphology-round-states.v${STORAGE_VERSION}`;
  const sessionKey = `${namespace}.curriculum.session.v${STORAGE_VERSION}`;
  const paths = configuration.paths;
  const requiredPaths = ["canonicalManifest", "realizationPack", "sourceCatalog", "bindingRegistry"];
  for (const field of requiredPaths) {
    if (typeof paths?.[field] !== "string" || !paths[field]) throw new CurriculumServiceError("CURRICULUM_CONFIG_INVALID", `Curriculum path ${field} is required.`);
  }

  let status = "idle";
  let failure = null;
  let bundle = null;
  let validation = null;
  let readyPromise = null;

  function readStoredArray(key) {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (cause) {
      throw new CurriculumServiceError("CURRICULUM_STORAGE_CORRUPT", `Stored curriculum data at ${key} is not JSON.`, [cause.message]);
    }
    if (!Array.isArray(parsed)) throw new CurriculumServiceError("CURRICULUM_STORAGE_CORRUPT", `Stored curriculum data at ${key} is not an array.`);
    return parsed;
  }

  function writeStoredArray(key, value, limit) {
    if (!Array.isArray(value) || value.length > limit) throw new CurriculumServiceError("CURRICULUM_STORAGE_LIMIT", `Refusing to store more than ${limit} records at ${key}.`);
    localStorage.setItem(key, JSON.stringify(value));
  }

  function readDeveloperPilotClaims() {
    const claims = readStoredArray(developerPilotClaimsKey);
    for (const claim of claims) {
      const hasSequenceClaim = [
        claim?.sequenceId,
        claim?.sequenceRevision,
        claim?.sequenceFingerprint,
        claim?.sequenceStepIndex
      ].some((value) => value !== undefined);
      if (
        !isObject(claim)
        || typeof claim.bindingId !== "string"
        || !claim.bindingId
        || typeof claim.targetSkillId !== "string"
        || !claim.targetSkillId
        || typeof claim.capabilityId !== "string"
        || !claim.capabilityId
        || typeof claim.claimedAt !== "string"
        || !Number.isFinite(Date.parse(claim.claimedAt))
        || typeof claim.sessionId !== "string"
        || !claim.sessionId
        || (hasSequenceClaim && (
          typeof claim.sequenceId !== "string"
          || !claim.sequenceId
          || !Number.isInteger(claim.sequenceRevision)
          || claim.sequenceRevision < 1
          || typeof claim.sequenceFingerprint !== "string"
          || !claim.sequenceFingerprint
          || !Number.isInteger(claim.sequenceStepIndex)
          || claim.sequenceStepIndex < 0
        ))
      ) {
        throw new CurriculumServiceError(
          "CURRICULUM_STORAGE_CORRUPT",
          `Stored developer pilot claim data at ${developerPilotClaimsKey} is invalid.`
        );
      }
    }
    return claims;
  }

  function validTimestamp(value) {
    return typeof value === "string" && Number.isFinite(Date.parse(value));
  }

  function sequenceFingerprint(sequenceId, sequenceRevision, targetSkillId, orderedBindingIds) {
    return canonicalJson({
      orderedBindingIds,
      sequenceRef: { id: sequenceId, revision: sequenceRevision },
      targetSkillId
    });
  }

  function readDeveloperPilotSequences() {
    const sequences = readStoredArray(developerPilotSequencesKey);
    const ids = new Set();
    const skills = new Set();
    for (const sequence of sequences) {
      const orderedBindingIds = sequence?.orderedBindingIds;
      if (
        !isObject(sequence)
        || sequence.schemaVersion !== DEVELOPER_PILOT_SEQUENCE_SCHEMA
        || typeof sequence.sequenceId !== "string"
        || !sequence.sequenceId
        || !Number.isInteger(sequence.sequenceRevision)
        || sequence.sequenceRevision < 1
        || typeof sequence.sequenceFingerprint !== "string"
        || !sequence.sequenceFingerprint
        || typeof sequence.targetSkillId !== "string"
        || !sequence.targetSkillId
        || !Array.isArray(orderedBindingIds)
        || orderedBindingIds.length < 2
        || orderedBindingIds.some((bindingId) => typeof bindingId !== "string" || !bindingId)
        || new Set(orderedBindingIds).size !== orderedBindingIds.length
        || sequence.sequenceFingerprint !== sequenceFingerprint(
          sequence.sequenceId,
          sequence.sequenceRevision,
          sequence.targetSkillId,
          orderedBindingIds
        )
        || !validTimestamp(sequence.establishedAt)
        || ids.has(sequence.sequenceId)
        || skills.has(sequence.targetSkillId)
      ) {
        throw new CurriculumServiceError(
          "CURRICULUM_STORAGE_CORRUPT",
          `Stored developer pilot sequence data at ${developerPilotSequencesKey} is invalid.`
        );
      }
      ids.add(sequence.sequenceId);
      skills.add(sequence.targetSkillId);
    }
    return sequences;
  }

  function readDeveloperPilotCompletions() {
    const completions = readStoredArray(developerPilotCompletionsKey);
    const steps = new Set();
    const tasks = new Set();
    for (const completion of completions) {
      const stepKey = `${completion?.sequenceId || ""}|${completion?.stepIndex}`;
      if (
        !isObject(completion)
        || completion.schemaVersion !== DEVELOPER_PILOT_COMPLETION_SCHEMA
        || typeof completion.sequenceId !== "string"
        || !completion.sequenceId
        || !Number.isInteger(completion.sequenceRevision)
        || completion.sequenceRevision < 1
        || typeof completion.sequenceFingerprint !== "string"
        || !completion.sequenceFingerprint
        || typeof completion.targetSkillId !== "string"
        || !completion.targetSkillId
        || !Number.isInteger(completion.stepIndex)
        || completion.stepIndex < 0
        || typeof completion.bindingId !== "string"
        || !completion.bindingId
        || typeof completion.taskId !== "string"
        || !completion.taskId
        || typeof completion.taskFingerprint !== "string"
        || !completion.taskFingerprint
        || typeof completion.roundId !== "string"
        || !completion.roundId
        || !isObject(completion.cueRef)
        || typeof completion.cueRef.id !== "string"
        || !completion.cueRef.id
        || !Number.isInteger(completion.cueRef.revision)
        || completion.cueRef.revision < 1
        || typeof completion.settlementId !== "string"
        || !completion.settlementId
        || !Number.isInteger(completion.roundStateRevision)
        || completion.roundStateRevision < 1
        || !DEVELOPER_PILOT_COMPLETION_KINDS.has(completion.completionKind)
        || !validTimestamp(completion.completedAt)
        || steps.has(stepKey)
        || tasks.has(completion.taskId)
      ) {
        throw new CurriculumServiceError(
          "CURRICULUM_STORAGE_CORRUPT",
          `Stored developer pilot completion data at ${developerPilotCompletionsKey} is invalid.`
        );
      }
      steps.add(stepKey);
      tasks.add(completion.taskId);
    }
    return completions;
  }

  function readMorphologyRoundStates() {
    // Prototype records written before optimistic revisions are interpreted as
    // revision 1. The next successful compare-and-save rewrites the normalized
    // record; no implicit storage mutation occurs during readiness or restore.
    const records = readStoredArray(morphologyRoundStatesKey).map((record) => (
      isObject(record)
          && record.schemaVersion === LEGACY_MORPHOLOGY_ROUND_STATE_SCHEMA
          && record.revision === undefined
        ? { ...record, schemaVersion: MORPHOLOGY_ROUND_STATE_SCHEMA, revision: 1 }
        : record
    ));
    const tasks = new Set();
    for (const record of records) {
      let canonicalRound;
      let canonicalState;
      try {
        canonicalRound = canonicalJson(record?.round);
        canonicalState = canonicalJson(record?.state);
      } catch {
        canonicalRound = null;
        canonicalState = null;
      }
      if (
        !isObject(record)
        || record.schemaVersion !== MORPHOLOGY_ROUND_STATE_SCHEMA
        || typeof record.taskId !== "string"
        || !record.taskId
        || typeof record.taskFingerprint !== "string"
        || !record.taskFingerprint
        || typeof record.bindingId !== "string"
        || !record.bindingId
        || typeof record.roundId !== "string"
        || !record.roundId
        || !isObject(record.round)
        || record.round.schemaVersion !== MORPHOLOGY_ROUND_SCHEMA
        || record.round.roundId !== record.roundId
        || record.round.taskFingerprint !== record.taskFingerprint
        || !isObject(record.state)
        || !Number.isInteger(record.revision)
        || record.revision < 1
        || canonicalRound === null
        || canonicalState === null
        || !validTimestamp(record.savedAt)
        || tasks.has(record.taskId)
      ) {
        throw new CurriculumServiceError(
          "CURRICULUM_STORAGE_CORRUPT",
          `Stored morphology round state data at ${morphologyRoundStatesKey} is invalid.`
        );
      }
      tasks.add(record.taskId);
    }
    return records;
  }

  function assessedCapabilitiesFor(binding) {
    return (Array.isArray(binding?.evidenceCapabilities) ? binding.evidenceCapabilities : []).filter((row) => (
      row?.evidenceKind !== "exposure"
        && row?.independence === "independent"
        && row?.scoreRequired === true
    ));
  }

  function morphologyBinding(bindingId) {
    const binding = bundle?.bindingRegistry?.bindings?.find((row) => row?.id === bindingId);
    if (!binding
        || binding.activityId !== CONJUGATION_COMET_ACTIVITY_ID
        || binding.exerciseFamilyId !== CONJUGATION_COMET_EXERCISE_FAMILY_ID) return null;
    return binding;
  }

  function completionKindMatchesEvent(task, event, completionKind) {
    const binding = bundle?.bindingRegistry?.bindings?.find((row) => row?.id === task?.bindingId);
    const capability = binding?.evidenceCapabilities?.find((row) => row?.id === task?.capabilityId);
    const minimumScore = Number.isFinite(capability?.minimumScore) ? capability.minimumScore : 1;
    const score = event?.outcome?.score;
    const correct = Number.isFinite(score) && score >= minimumScore;
    const incorrect = Number.isFinite(score) && score < minimumScore;
    const revealed = event?.outcome?.solutionRevealed === true;
    if (completionKind === "correct-first-response") return correct && !revealed;
    if (completionKind === "corrective-correct") return incorrect && !revealed;
    if (completionKind === "solution-review") return revealed || incorrect;
    return false;
  }

  function sameEntityReference(left, right) {
    return Boolean(
      isObject(left)
      && isObject(right)
      && typeof left.id === "string"
      && left.id
      && Number.isInteger(left.revision)
      && left.revision > 0
      && left.id === right.id
      && left.revision === right.revision
    );
  }

  function sameEntityReferenceList(left, right) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((reference, index) => sameEntityReference(reference, right[index]));
  }

  function expectedMorphologySettlement(task, immutableRound, kind) {
    const bindingId = task?.bindingId;
    const taskFingerprint = task?.taskFingerprint;
    const contentId = task?.contentRef?.contentId;
    const cueId = immutableRound?.cue?.cueRef?.id;
    if (![bindingId, taskFingerprint, contentId, cueId].every((value) => (
      typeof value === "string" && value
    ))) return null;
    const taskRef = [
      "verb-task:v1",
      VERB_MORPHOLOGY_FAMILY,
      encodeURIComponent(bindingId),
      encodeURIComponent(taskFingerprint)
    ].join(":");
    const itemRef = [
      "verb-item:v1",
      VERB_MORPHOLOGY_FAMILY,
      encodeURIComponent(contentId),
      encodeURIComponent(cueId)
    ].join(":");
    return Object.freeze({
      taskRef,
      itemRef,
      settlementId: [
        "verb-settlement:v1",
        VERB_MORPHOLOGY_FAMILY,
        encodeURIComponent(taskRef),
        encodeURIComponent(itemRef),
        kind
      ].join(":")
    });
  }

  function morphologySettlementProof(record, event, completionKind, task) {
    const progress = record?.state;
    const settledRound = progress?.round;
    const immutableRound = record?.round;
    const evidence = progress?.evidence;
    const immutableOptionRefs = Array.isArray(immutableRound?.options)
      ? immutableRound.options.map((option) => option?.itemRef)
      : [];
    const rejectedItemRefs = settledRound?.rejectedItemRefs;
    const rejectedKeys = Array.isArray(rejectedItemRefs)
      ? rejectedItemRefs.map((reference) => `${reference?.id || ""}@${reference?.revision || ""}`)
      : [];
    const selectedItemRef = settledRound?.selectedItemRef;
    const selectedIsOption = immutableOptionRefs.some((optionRef) => (
      sameEntityReference(selectedItemRef, optionRef)
    ));
    const settlementKind = completionKind === "solution-review" ? "solution-reveal" : "first-response";
    const expectedSettlement = expectedMorphologySettlement(task, immutableRound, settlementKind);
    if (!expectedSettlement
        || !isObject(progress)
        || progress.schemaVersion !== MORPHOLOGY_GUIDED_PROGRESS_SCHEMA
        || !isObject(settledRound)
        || settledRound.schemaVersion !== MORPHOLOGY_FAMILY_ROUND_SCHEMA
        || settledRound.exerciseFamily !== VERB_MORPHOLOGY_FAMILY
        || settledRound.taskRef !== expectedSettlement?.taskRef
        || settledRound.itemRef !== expectedSettlement?.itemRef
        || !sameEntityReferenceList(settledRound.optionRefs, immutableOptionRefs)
        || !Array.isArray(rejectedItemRefs)
        || new Set(rejectedKeys).size !== rejectedKeys.length
        || rejectedItemRefs.some((reference) => (
          sameEntityReference(reference, immutableRound?.targetItemRef)
            || !immutableOptionRefs.some((optionRef) => sameEntityReference(reference, optionRef))
        ))
        || (selectedItemRef !== null && !selectedIsOption)
        || settledRound.completed !== true
        || settledRound.roundId !== immutableRound?.roundId
        || !sameEntityReference(settledRound.cueRef, immutableRound?.cue?.cueRef)
        || settledRound.settlementId !== expectedSettlement?.settlementId
        || progress.terminalCompletionKind !== completionKind
        || progress.pendingCompletionKind !== completionKind
        || progress.pendingEvidence !== null
        || !isObject(evidence)
        || evidence.recorded !== true
        || evidence.score !== event?.outcome?.score
        || evidence.solutionRevealed !== event?.outcome?.solutionRevealed
        || evidence.hintsUsed !== event?.outcome?.hintsUsed
        || evidence.occurredAt !== event?.occurredAt) {
      return null;
    }
    if (completionKind === "solution-review") {
      const directReveal = evidence.solutionRevealed === true
        && event?.outcome?.solutionRevealed === true;
      const correctiveReveal = evidence.solutionRevealed === false
        && event?.outcome?.solutionRevealed === false;
      if (settledRound.hintState !== MORPHOLOGY_SOLUTION_REVEALED
          || (!directReveal && !correctiveReveal)
          || (directReveal && (selectedItemRef !== null || rejectedItemRefs.length !== 0))
          || (correctiveReveal && (
            rejectedItemRefs.length === 0
              || !rejectedItemRefs.some((reference) => sameEntityReference(reference, selectedItemRef))
          ))) return null;
    } else {
      if (!MORPHOLOGY_UNREVEALED_HINT_STATES.has(settledRound.hintState)
          || !sameEntityReference(settledRound.selectedItemRef, immutableRound?.targetItemRef)) {
        return null;
      }
      if (completionKind === "correct-first-response"
          && (rejectedItemRefs.length !== 0
            || (evidence.hintsUsed === 0 && settledRound.hintState !== "available")
            || (evidence.hintsUsed > 0 && settledRound.hintState !== "used"))) return null;
      if (completionKind === "corrective-correct"
          && (evidence.score !== 0
            || event?.outcome?.score !== 0
            || rejectedItemRefs.length === 0)) return null;
    }
    return Object.freeze({
      roundId: immutableRound.roundId,
      cueRef: Object.freeze({
        id: immutableRound.cue.cueRef.id,
        revision: immutableRound.cue.cueRef.revision
      }),
      settlementId: settledRound.settlementId,
      roundStateRevision: record.revision
    });
  }

  function completionMatchesSettlementProof(completion, proof) {
    return Boolean(
      proof
      && completion.roundId === proof.roundId
      && sameEntityReference(completion.cueRef, proof.cueRef)
      && completion.settlementId === proof.settlementId
      && completion.roundStateRevision === proof.roundStateRevision
    );
  }

  function validatePersistentDeveloperPilotData(tasks, events) {
    const claims = readDeveloperPilotClaims();
    const sequences = readDeveloperPilotSequences();
    const completions = readDeveloperPilotCompletions();
    const sequenceById = new Map(sequences.map((sequence) => [sequence.sequenceId, sequence]));
    const taskById = new Map(tasks.map((task) => [task?.taskId, task]));
    const eventByTaskId = new Map(events.map((event) => [event?.taskId, event]));
    const roundStateByTaskId = new Map(readMorphologyRoundStates().map((record) => [record.taskId, record]));
    for (const sequence of sequences) {
      const authoredSequence = bundle?.bindingRegistry?.exerciseSequences?.find((row) => (
        row?.id === sequence.sequenceId && row?.revision === sequence.sequenceRevision
      ));
      if (!authoredSequence
          || canonicalJson(authoredSequence.orderedBindingIds) !== canonicalJson(sequence.orderedBindingIds)) {
        throw new CurriculumServiceError(
          "CURRICULUM_STORAGE_CORRUPT",
          `Stored developer pilot sequence ${sequence.sequenceId} is stale against its pinned sequence authority.`
        );
      }
      for (const bindingId of sequence.orderedBindingIds) {
        const binding = morphologyBinding(bindingId);
        if (!binding
            || !binding.targetSkillRefs?.some((reference) => reference?.id === sequence.targetSkillId)
            || assessedCapabilitiesFor(binding).length < 1) {
          throw new CurriculumServiceError(
            "CURRICULUM_STORAGE_CORRUPT",
            `Stored developer pilot sequence ${sequence.sequenceId} is stale against the pinned curriculum bundle.`
          );
        }
      }
    }
    for (const claim of claims.filter((row) => row.sequenceId !== undefined)) {
      const sequence = sequenceById.get(claim.sequenceId);
      if (!sequence
          || claim.sequenceRevision !== sequence.sequenceRevision
          || claim.sequenceFingerprint !== sequence.sequenceFingerprint
          || claim.targetSkillId !== sequence.targetSkillId
          || sequence.orderedBindingIds[claim.sequenceStepIndex] !== claim.bindingId) {
        throw new CurriculumServiceError(
          "CURRICULUM_STORAGE_CORRUPT",
          `Stored developer pilot sequence claim for ${claim.bindingId} is stale or inconsistent.`
        );
      }
    }
    for (const completion of completions) {
      const sequence = sequenceById.get(completion.sequenceId);
      const task = taskById.get(completion.taskId);
      const event = eventByTaskId.get(completion.taskId);
      const roundState = roundStateByTaskId.get(completion.taskId);
      const settlementProof = morphologySettlementProof(roundState, event, completion.completionKind, task);
      const claim = claims.find((row) => (
        row.bindingId === completion.bindingId
          && row.targetSkillId === completion.targetSkillId
          && row.sequenceId === completion.sequenceId
          && row.sequenceRevision === completion.sequenceRevision
          && row.sequenceFingerprint === completion.sequenceFingerprint
          && row.sequenceStepIndex === completion.stepIndex
      ));
      if (!sequence
          || completion.sequenceRevision !== sequence.sequenceRevision
          || completion.sequenceFingerprint !== sequence.sequenceFingerprint
          || completion.targetSkillId !== sequence.targetSkillId
          || sequence.orderedBindingIds[completion.stepIndex] !== completion.bindingId
          || !task
          || task.taskFingerprint !== completion.taskFingerprint
          || task.bindingId !== completion.bindingId
          || task.targetSkillId !== completion.targetSkillId
          || !assessedCapabilitiesFor(morphologyBinding(task.bindingId)).some((row) => row.id === task.capabilityId)
          || !event
          || !claim
          || !completionKindMatchesEvent(task, event, completion.completionKind)
          || !completionMatchesSettlementProof(completion, settlementProof)) {
        throw new CurriculumServiceError(
          "CURRICULUM_STORAGE_CORRUPT",
          `Stored developer pilot completion ${completion.taskId} is stale or inconsistent.`
        );
      }
    }
  }

  function validateMorphologyRoundAgainstTask(task, round) {
    const binding = morphologyBinding(task?.bindingId);
    const source = bundle?.sourceCatalog?.sources?.find((row) => (
      row?.activityId === task?.activityId
        && row?.catalogId === task?.contentRef?.catalogId
        && row?.contentId === task?.contentRef?.contentId
    ));
    const expectedFamilyRef = source?.snapshot?.familyRef;
    const expectedCueRef = source?.snapshot?.selectedCueRef;
    const expectedTargetItemRef = source?.snapshot?.targetItemRef;
    const optionRefs = Array.isArray(round?.options) ? round.options.map((option) => option?.itemRef) : [];
    const allowedItems = new Map((source?.snapshot?.itemRefs || []).map((reference) => [reference.id, reference.revision]));
    const allowedCues = new Map((source?.snapshot?.cueRefs || []).map((reference) => [reference.id, reference.revision]));
    return Boolean(
      binding
      && source
      && round?.schemaVersion === MORPHOLOGY_ROUND_SCHEMA
      && typeof round.roundId === "string"
      && round.roundId
      && round.taskFingerprint === task.taskFingerprint
      && round.catalogRef?.id === task.contentRef.catalogId
      && round.catalogRef?.version === task.contentRef.catalogRevision
      && round.familyRef?.id === expectedFamilyRef?.id
      && round.familyRef?.revision === expectedFamilyRef?.revision
      && allowedCues.get(round.cue?.cueRef?.id) === round.cue?.cueRef?.revision
      && round.cue?.cueRef?.id === expectedCueRef?.id
      && round.cue?.cueRef?.revision === expectedCueRef?.revision
      && optionRefs.length === allowedItems.size
      && optionRefs.every((reference) => allowedItems.get(reference?.id) === reference?.revision)
      && new Set(optionRefs.map((reference) => reference?.id)).size === optionRefs.length
      && optionRefs.some((reference) => (
        reference?.id === round.targetItemRef?.id && reference?.revision === round.targetItemRef?.revision
      ))
      && round.targetItemRef?.id === expectedTargetItemRef?.id
      && round.targetItemRef?.revision === expectedTargetItemRef?.revision
    );
  }

  function validatePersistentMorphologyRoundStates(tasks) {
    const taskById = new Map(tasks.map((task) => [task?.taskId, task]));
    for (const record of readMorphologyRoundStates()) {
      const task = taskById.get(record.taskId);
      if (!task
          || task.taskFingerprint !== record.taskFingerprint
          || task.bindingId !== record.bindingId
          || !validateMorphologyRoundAgainstTask(task, record.round)) {
        throw new CurriculumServiceError(
          "CURRICULUM_STORAGE_CORRUPT",
          `Stored morphology round ${record.roundId} is stale against its issued task or pinned content.`
        );
      }
    }
  }

  function currentSessionId() {
    let sessionId = sessionStorage.getItem(sessionKey);
    if (!sessionId) {
      sessionId = `session.${uuid()}`;
      sessionStorage.setItem(sessionKey, sessionId);
    }
    return sessionId;
  }

  function nextTaskSequence(sessionId) {
    return readStoredArray(tasksKey)
      .filter((task) => task?.sessionId === sessionId)
      .reduce((maximum, task) => Math.max(maximum, Number(task?.taskSequence) || 0), 0) + 1;
  }

  function guidedModeEnabled() {
    const guided = configuration.guidedMode;
    if (!isObject(guided) || guided.enabled !== true) return false;
    const queryName = String(guided.developerQueryParameter || "curriculum-guided");
    const requested = new URLSearchParams(String(location?.search || "")).get(queryName) === "1";
    if (!requested) return false;
    const loopback = loopbackHost(location?.hostname);
    if (guided.developerOnly === true) return loopback;
    return loopback || configuration.approval?.releaseEnabled === true;
  }

  function developerPilotModeEnabled() {
    const guided = configuration.guidedMode;
    if (!isObject(guided)
        || guided.enabled !== true
        || guided.developerOnly !== true
        || configuration.approval?.releaseEnabled === true
        || !loopbackHost(location?.hostname)) {
      return false;
    }
    const queryName = String(guided.developerQueryParameter || "curriculum-guided");
    return new URLSearchParams(String(location?.search || "")).get(queryName) === "1";
  }

  async function fetchJson(path, label) {
    const response = await fetchImpl(path, { cache: "reload", headers: { accept: "application/json" } });
    if (!response?.ok) throw new CurriculumServiceError("CURRICULUM_ASSET_UNAVAILABLE", `${label} failed to load from ${path} (${response?.status || "no response"}).`);
    try {
      return await response.json();
    } catch (cause) {
      throw new CurriculumServiceError("CURRICULUM_ASSET_INVALID", `${label} is not valid JSON.`, [cause.message]);
    }
  }

  async function initialize() {
    status = "loading";
    try {
      const [curriculum, targetPack, sourceCatalog, bindingRegistry] = await Promise.all([
        fetchJson(paths.canonicalManifest, "Canonical curriculum"),
        fetchJson(paths.realizationPack, "Target realization pack"),
        fetchJson(paths.sourceCatalog, "Content source catalog"),
        fetchJson(paths.bindingRegistry, "Cross-game binding registry")
      ]);
      const loaded = { curriculum, targetPack, sourceCatalog, bindingRegistry };
      const result = await validateRuntimeBundle(loaded, configuration.releasePins);
      if (!result.valid) {
        throw new CurriculumServiceError("CURRICULUM_RUNTIME_INVALID", result.errors[0]?.message || "Curriculum runtime validation failed.", result.errors);
      }
      bundle = loaded;
      validation = result;
      readDeveloperPilotClaims();
      const ledger = await readCurriculumLedgerSnapshot();
      validatePersistentDeveloperPilotData(ledger.tasks, ledger.events);
      validatePersistentMorphologyRoundStates(ledger.tasks);
      await aggregateLearningEvidence(curriculum, bindingRegistry, ledger.tasks, ledger.events);
      status = "ready";
      return {
        status,
        guidedModeEnabled: guidedModeEnabled(),
        developerPilotModeEnabled: developerPilotModeEnabled(),
        validation: clone(result),
        curriculum: { id: curriculum.curriculumId, version: curriculum.version },
        targetPack: { id: targetPack.packId, version: targetPack.version, locale: targetPack.targetLocale }
      };
    } catch (cause) {
      status = "failed";
      failure = cause instanceof CurriculumServiceError
        ? cause
        : new CurriculumServiceError("CURRICULUM_RUNTIME_FAILED", cause.message || String(cause));
      throw failure;
    }
  }

  function ready() {
    if (!readyPromise) readyPromise = initialize();
    return readyPromise;
  }

  async function requireReady() {
    await ready();
    if (!bundle || status !== "ready") throw failure || new CurriculumServiceError("CURRICULUM_NOT_READY", "Curriculum service is not ready.");
  }

  async function resolveBinding(activityId, stableContentId) {
    await requireReady();
    return resolveRuntimeBinding(bundle, activityId, stableContentId);
  }

  function withCurriculumLedgerLock(callback) {
    if (typeof lockManager?.request !== "function") {
      throw new CurriculumServiceError(
        "CURRICULUM_LEDGER_LOCK_UNAVAILABLE",
        "Curriculum task and evidence writes require a cross-context Web Lock."
      );
    }
    return lockManager.request(
      `${namespace}.curriculum.ledger.v${STORAGE_VERSION}`,
      { mode: "exclusive" },
      (lock) => {
        if (!lock) {
          throw new CurriculumServiceError(
            "CURRICULUM_LEDGER_LOCK_UNAVAILABLE",
            "Curriculum ledger lock was not acquired."
          );
        }
        return callback();
      }
    );
  }

  function readCurriculumLedgerSnapshot() {
    return withCurriculumLedgerLock(() => Object.freeze({
      tasks: readStoredArray(tasksKey),
      events: readStoredArray(eventsKey)
    }));
  }

  async function resetProgress() {
    const localKeys = [
      tasksKey,
      eventsKey,
      developerPilotClaimsKey,
      developerPilotSequencesKey,
      developerPilotCompletionsKey,
      morphologyRoundStatesKey
    ];
    const result = await withCurriculumLedgerLock(() => {
      for (const key of localKeys) localStorage.removeItem(key);
      sessionStorage.removeItem(sessionKey);
      return Object.freeze({
        localStorageKeysCleared: localKeys.length,
        sessionStorageKeyCleared: true
      });
    });
    if (status === "failed") {
      status = "idle";
      failure = null;
      bundle = null;
      validation = null;
      readyPromise = null;
    }
    return result;
  }

  async function issueTaskUnlocked(bindingId, capabilityId, {
    targetSkillId,
    requirePresented
  } = {}) {
    await requireReady();
    if (!guidedModeEnabled()) throw new CurriculumServiceError("CURRICULUM_GUIDED_MODE_DISABLED", "Curriculum tasks are available only in explicitly enabled developer Guided mode.");
    const sessionId = currentSessionId();
    const task = await issueLearningTask(bundle.bindingRegistry, {
      taskId: `task.${uuid()}`,
      issuedAt: now(),
      sessionId,
      taskSequence: nextTaskSequence(sessionId),
      bindingId,
      capabilityId,
      targetSkillId
    });
    const taskValidation = await validateLearningTask(bundle.curriculum, bundle.bindingRegistry, task);
    if (!taskValidation.valid) throw new CurriculumServiceError("CURRICULUM_TASK_INVALID", taskValidation.errors[0].message, taskValidation.errors);
    const tasks = readStoredArray(tasksKey);
    const existing = tasks.find((row) => row?.taskId === task.taskId);
    if (existing && canonicalJson(existing) !== canonicalJson(task)) throw new CurriculumServiceError("TASK_ID_CONFLICT", `Task ID ${task.taskId} already has a different payload.`);
    if (!existing) {
      if (!developerPilotIsPresented(requirePresented)) {
        throw new CurriculumServiceError(
          "CURRICULUM_DEVELOPER_PILOT_PRESENTATION_LOST",
          "Developer pilot presentation was lost before retrieval persistence."
        );
      }
      tasks.push(task);
      writeStoredArray(tasksKey, tasks, MAX_STORED_TASKS);
    }
    return clone(task);
  }

  function issueTask(bindingId, capabilityId, options = {}) {
    return withCurriculumLedgerLock(() => issueTaskUnlocked(bindingId, capabilityId, options));
  }

  async function recordEvidenceUnlocked(task, {
    attemptNumber = 1,
    score,
    solutionRevealed = false,
    hintsUsed = 0,
    occurredAt = now()
  } = {}) {
    await requireReady();
    const tasks = readStoredArray(tasksKey);
    const issuedTask = tasks.find((row) => row?.taskId === task?.taskId);
    if (!issuedTask || canonicalJson(issuedTask) !== canonicalJson(task)) {
      throw new CurriculumServiceError("EVIDENCE_TASK_NOT_ISSUED", "Evidence must reference an exact task issued by this service.");
    }
    const event = createLearningEvidenceEvent(task, {
      eventId: `${task.taskId}.attempt.${attemptNumber}`,
      occurredAt,
      attemptNumber,
      score,
      solutionRevealed,
      hintsUsed
    });
    const eventValidation = await validateLearningEvidenceEvent(bundle.curriculum, bundle.bindingRegistry, task, event);
    if (!eventValidation.valid) throw new CurriculumServiceError("CURRICULUM_EVIDENCE_INVALID", eventValidation.errors[0].message, eventValidation.errors);
    const events = readStoredArray(eventsKey);
    const existing = events.find((row) => row?.eventId === event.eventId);
    if (existing && canonicalJson(existing) !== canonicalJson(event)) throw new CurriculumServiceError("EVIDENCE_ID_CONFLICT", `Event ID ${event.eventId} already has a different payload.`);
    if (!existing) {
      events.push(event);
      writeStoredArray(eventsKey, events, MAX_STORED_EVENTS);
    }
    const summaries = await aggregateLearningEvidence(bundle.curriculum, bundle.bindingRegistry, tasks, existing ? events : [...events]);
    return {
      event: clone(existing || event),
      qualifiesForIndependentAssessment: eventValidation.qualifiesForIndependentAssessment,
      qualifiesForMastery: eventValidation.qualifiesForMastery,
      skillSummary: clone(summaries.find((row) => row.targetSkillId === task.targetSkillId) || null)
    };
  }

  function recordEvidence(task, options = {}) {
    return withCurriculumLedgerLock(() => recordEvidenceUnlocked(task, options));
  }

  function recordExposure(bindingId, { targetSkillId } = {}) {
    return withCurriculumLedgerLock(async () => {
      const task = await issueTaskUnlocked(bindingId, "exposure", { targetSkillId });
      return recordEvidenceUnlocked(task, { score: null, solutionRevealed: false, hintsUsed: 0 });
    });
  }

  function requireDeveloperPilotLockManager() {
    if (typeof lockManager?.request !== "function") {
      throw new CurriculumServiceError(
        "CURRICULUM_DEVELOPER_PILOT_LOCK_UNAVAILABLE",
        "Developer pilot claims require a cross-context Web Lock and fail closed without one."
      );
    }
  }

  function acquireDeveloperPilotLease(name) {
    return new Promise((resolve, reject) => {
      let callbackStarted = false;
      let released = false;
      let releaseHold;
      const hold = new Promise((release) => {
        releaseHold = release;
      });
      let request;
      try {
        request = lockManager.request(name, { mode: "exclusive", ifAvailable: true }, async (lock) => {
          callbackStarted = true;
          if (!lock) {
            resolve(null);
            return;
          }
          resolve(Object.freeze({
            release() {
              if (!released) {
                released = true;
                releaseHold();
              }
              return Promise.resolve(request).then(() => undefined);
            }
          }));
          await hold;
        });
      } catch (cause) {
        reject(cause);
        return;
      }
      Promise.resolve(request).catch((cause) => {
        if (!callbackStarted) reject(cause);
      });
    });
  }

  function developerPilotIsPresented(requirePresented) {
    if (requirePresented === undefined) return true;
    if (typeof requirePresented !== "function") {
      throw new CurriculumServiceError(
        "CURRICULUM_DEVELOPER_PILOT_PRESENTATION_INVALID",
        "Developer pilot presentation guard must be a function."
      );
    }
    try {
      return requirePresented() === true;
    } catch (cause) {
      throw new CurriculumServiceError(
        "CURRICULUM_DEVELOPER_PILOT_PRESENTATION_FAILED",
        "Developer pilot presentation guard failed.",
        [cause?.message || String(cause)]
      );
    }
  }

  function developerPilotClaimTime() {
    const claimedAt = now();
    if (typeof claimedAt !== "string" || !Number.isFinite(Date.parse(claimedAt))) {
      throw new CurriculumServiceError(
        "CURRICULUM_DEVELOPER_PILOT_TIME_INVALID",
        "Developer pilot claim time must be an ISO timestamp."
      );
    }
    return claimedAt;
  }

  async function performDeveloperPilotClaim(bindingId, {
    targetSkillId,
    capabilityId,
    requirePresented,
    sequenceClaim = null
  } = {}) {
    await requireReady();
    if (!developerPilotModeEnabled()) {
      throw new CurriculumServiceError(
        "CURRICULUM_GUIDED_MODE_DISABLED",
        "Developer pilot claims are available only in explicitly enabled developer Guided mode."
      );
    }

    const requestedBindingId = String(bindingId || "").trim();
    const binding = bundle.bindingRegistry.bindings.find((row) => row?.id === requestedBindingId);
    if (!binding) {
      throw new CurriculumServiceError(
        "CURRICULUM_DEVELOPER_PILOT_BINDING_UNKNOWN",
        `Unknown developer pilot binding ${requestedBindingId || "(empty)"}.`
      );
    }
    const requestedSkillId = String(targetSkillId || "").trim();
    const skillRef = requestedSkillId
      ? binding.targetSkillRefs.find((row) => row?.id === requestedSkillId)
      : null;
    if (!skillRef) {
      throw new CurriculumServiceError(
        "CURRICULUM_DEVELOPER_PILOT_SKILL_MISMATCH",
        `Binding ${binding.id} does not supply developer pilot skill ${requestedSkillId || "(empty)"}.`
      );
    }
    const requestedCapabilityId = String(capabilityId || "").trim();
    const assessedCapabilities = binding.evidenceCapabilities.filter((row) => (
      row?.evidenceKind !== "exposure"
        && row?.independence === "independent"
        && row?.scoreRequired === true
    ));
    const capability = requestedCapabilityId
      ? assessedCapabilities.find((row) => row?.id === requestedCapabilityId)
      : assessedCapabilities.length === 1 ? assessedCapabilities[0] : null;
    if (!capability
        || capability.evidenceKind === "exposure"
        || capability.independence !== "independent"
        || capability.scoreRequired !== true) {
      throw new CurriculumServiceError(
        "CURRICULUM_DEVELOPER_PILOT_CAPABILITY_MISMATCH",
        `Binding ${binding.id} does not supply independent scored capability ${requestedCapabilityId || "(empty)"}.`
      );
    }
    if (requirePresented !== undefined && typeof requirePresented !== "function") {
      throw new CurriculumServiceError(
        "CURRICULUM_DEVELOPER_PILOT_PRESENTATION_INVALID",
        "Developer pilot presentation guard must be a function."
      );
    }
    if (sequenceClaim !== null && (
      !isObject(sequenceClaim)
      || typeof sequenceClaim.sequenceId !== "string"
      || !sequenceClaim.sequenceId
      || !Number.isInteger(sequenceClaim.sequenceRevision)
      || sequenceClaim.sequenceRevision < 1
      || typeof sequenceClaim.sequenceFingerprint !== "string"
      || !sequenceClaim.sequenceFingerprint
      || !Number.isInteger(sequenceClaim.sequenceStepIndex)
      || sequenceClaim.sequenceStepIndex < 0
    )) {
      throw new CurriculumServiceError(
        "CURRICULUM_DEVELOPER_PILOT_SEQUENCE_INVALID",
        "Internal developer pilot sequence claim metadata is invalid."
      );
    }
    if (sequenceClaim !== null) {
      const storedSequence = readDeveloperPilotSequences().find((sequence) => (
        sequence.sequenceId === sequenceClaim.sequenceId
          && sequence.sequenceRevision === sequenceClaim.sequenceRevision
          && sequence.sequenceFingerprint === sequenceClaim.sequenceFingerprint
          && sequence.targetSkillId === skillRef.id
      ));
      if (!storedSequence
          || storedSequence.orderedBindingIds[sequenceClaim.sequenceStepIndex] !== binding.id) {
        throw new CurriculumServiceError(
          "CURRICULUM_DEVELOPER_PILOT_SEQUENCE_INVALID",
          "Internal developer pilot sequence claim must match one exact stored sequence step."
        );
      }
    }
    function claimRecord(claimedAt, { includeSequence = true } = {}) {
      return {
        bindingId: binding.id,
        targetSkillId: skillRef.id,
        capabilityId: capability.id,
        claimedAt,
        sessionId: currentSessionId(),
        ...(sequenceClaim === null || !includeSequence ? {} : sequenceClaim)
      };
    }
    requireDeveloperPilotLockManager();

    const pairLockName = `${namespace}.curriculum.developer-pilot.${binding.id}.${skillRef.id}`;
    const lease = await acquireDeveloperPilotLease(pairLockName);
    if (!lease) {
      return Object.freeze({
        status: "blocked",
        claimed: false,
        reason: "active-elsewhere",
        bindingId: binding.id,
        targetSkillId: skillRef.id,
        priorTaskIds: Object.freeze([]),
        closedTaskIds: Object.freeze([])
      });
    }

    try {
      const result = await withCurriculumLedgerLock(
        async () => {
          const tasks = readStoredArray(tasksKey);
          const events = readStoredArray(eventsKey);
          validatePersistentDeveloperPilotData(tasks, events);
          const claims = readDeveloperPilotClaims();
          const priorTasks = tasks.filter((task) => (
            task?.bindingId === binding.id && task?.targetSkillId === skillRef.id
          ));
          const existingClaim = claims.find((claim) => (
            claim.bindingId === binding.id && claim.targetSkillId === skillRef.id
          ));
          if (!developerPilotIsPresented(requirePresented)) {
            return Object.freeze({
              status: "deferred",
              claimed: false,
              reason: "not-presented",
              bindingId: binding.id,
              targetSkillId: skillRef.id,
              priorTaskIds: Object.freeze(priorTasks.map((task) => task.taskId)),
              closedTaskIds: Object.freeze([])
            });
          }

          if (existingClaim || priorTasks.length) {
            if (!existingClaim) {
              claims.push(claimRecord(developerPilotClaimTime(), { includeSequence: false }));
              writeStoredArray(developerPilotClaimsKey, claims, MAX_STORED_DEVELOPER_PILOT_CLAIMS);
            }
            const evidencedTaskIds = new Set(events.map((event) => event?.taskId).filter(Boolean));
            const openTasks = priorTasks.filter((task) => !evidencedTaskIds.has(task.taskId));
            const closedTaskIds = [];
            for (const task of openTasks) {
              const taskCapability = binding.evidenceCapabilities.find((row) => row?.id === task.capabilityId);
              if (!taskCapability) {
                throw new CurriculumServiceError(
                  "CURRICULUM_DEVELOPER_PILOT_TASK_INVALID",
                  `Open developer pilot task ${task.taskId} has no current capability.`
                );
              }
              const closure = await recordEvidenceUnlocked(task, {
                attemptNumber: 1,
                score: taskCapability.scoreRequired ? 0 : null,
                solutionRevealed: true,
                hintsUsed: 0,
                // A task-local timestamp keeps racing recovery attempts byte-identical.
                occurredAt: task.issuedAt
              });
              if (closure.qualifiesForMastery) {
                throw new CurriculumServiceError(
                  "CURRICULUM_DEVELOPER_PILOT_CLOSE_QUALIFIED",
                  `Conservative closure of developer pilot task ${task.taskId} unexpectedly qualified for mastery.`
                );
              }
              closedTaskIds.push(task.taskId);
            }
            return Object.freeze({
              status: "blocked",
              claimed: false,
              reason: existingClaim ? "prior-claim" : "prior-task",
              bindingId: binding.id,
              targetSkillId: skillRef.id,
              priorTaskIds: Object.freeze(priorTasks.map((task) => task.taskId)),
              closedTaskIds: Object.freeze(closedTaskIds)
            });
          }

          const claimedAt = developerPilotClaimTime();
          // This marker is the crash-safe claim. It is written before either
          // task, so a reload cannot obtain a clean pilot after a partial write.
          claims.push(claimRecord(claimedAt));
          writeStoredArray(developerPilotClaimsKey, claims, MAX_STORED_DEVELOPER_PILOT_CLAIMS);
          const exposureTask = await issueTaskUnlocked(binding.id, "exposure", { targetSkillId: skillRef.id });
          const exposure = await recordEvidenceUnlocked(exposureTask, {
            attemptNumber: 1,
            score: null,
            solutionRevealed: false,
            hintsUsed: 0
          });
          if (!developerPilotIsPresented(requirePresented)) {
            return Object.freeze({
              status: "blocked",
              claimed: false,
              reason: "presentation-lost-after-exposure",
              bindingId: binding.id,
              targetSkillId: skillRef.id,
              priorTaskIds: Object.freeze([exposureTask.taskId]),
              closedTaskIds: Object.freeze([])
            });
          }
          let opportunity;
          try {
            opportunity = await beginOpportunityUnlocked(binding.activityId, binding.contentRef.contentId, {
              capabilityId: capability.id,
              targetSkillId: skillRef.id,
              requirePresented
            });
          } catch (cause) {
            if (cause?.code === "CURRICULUM_DEVELOPER_PILOT_PRESENTATION_LOST") {
              return Object.freeze({
                status: "blocked",
                claimed: false,
                reason: "presentation-lost-after-exposure",
                bindingId: binding.id,
                targetSkillId: skillRef.id,
                priorTaskIds: Object.freeze([exposureTask.taskId]),
                closedTaskIds: Object.freeze([])
              });
            }
            throw cause;
          }
          if (
            opportunity.task?.bindingId !== binding.id
            || opportunity.task?.targetSkillId !== skillRef.id
            || opportunity.task?.capabilityId !== capability.id
          ) {
            throw new CurriculumServiceError(
              "CURRICULUM_DEVELOPER_PILOT_TASK_MISMATCH",
              "Developer pilot assessed task differs from its claimed binding, skill, or capability."
            );
          }
          return Object.freeze({
            status: "claimed",
            claimed: true,
            reason: null,
            bindingId: binding.id,
            targetSkillId: skillRef.id,
            capabilityId: capability.id,
            exposure: Object.freeze({
              task: clone(exposureTask),
              event: clone(exposure.event)
            }),
            opportunity
          });
        }
      );
      if (result.status !== "claimed") await lease.release();
      if (result.status === "claimed") {
        return Object.freeze({ ...result, release: lease.release });
      }
      return result;
    } catch (cause) {
      await lease.release();
      throw cause;
    }
  }

  function claimDeveloperPilot(bindingId, options = {}) {
    return performDeveloperPilotClaim(bindingId, {
      targetSkillId: options?.targetSkillId,
      capabilityId: options?.capabilityId,
      requirePresented: options?.requirePresented
    });
  }

  async function resolveDeveloperPilotSequence(orderedBindingIds, {
    targetSkillId,
    capabilityId,
    expectedStep,
    requirePresented
  } = {}) {
    await requireReady();
    if (!developerPilotModeEnabled()) {
      throw new CurriculumServiceError(
        "CURRICULUM_GUIDED_MODE_DISABLED",
        "Developer pilot sequences are available only in explicitly enabled developer Guided mode."
      );
    }
    if (!Array.isArray(orderedBindingIds)
        || orderedBindingIds.length < 2
        || orderedBindingIds.some((bindingId) => typeof bindingId !== "string" || !bindingId.trim())
        || new Set(orderedBindingIds).size !== orderedBindingIds.length) {
      throw new CurriculumServiceError(
        "CURRICULUM_DEVELOPER_PILOT_SEQUENCE_INVALID",
        "Developer pilot sequence requires at least two unique binding IDs in authored order."
      );
    }
    const normalizedBindingIds = orderedBindingIds.map((bindingId) => bindingId.trim());
    const normalizedSkillId = String(targetSkillId || "").trim();
    if (!normalizedSkillId) {
      throw new CurriculumServiceError(
        "CURRICULUM_DEVELOPER_PILOT_SKILL_MISMATCH",
        "Developer pilot sequence requires one explicit target skill."
      );
    }
    if (requirePresented !== undefined && typeof requirePresented !== "function") {
      throw new CurriculumServiceError(
        "CURRICULUM_DEVELOPER_PILOT_PRESENTATION_INVALID",
        "Developer pilot presentation guard must be a function."
      );
    }
    const authoredSequence = bundle.bindingRegistry.exerciseSequences?.find((sequence) => (
      canonicalJson(sequence?.orderedBindingIds) === canonicalJson(normalizedBindingIds)
    ));
    if (!authoredSequence
        || typeof authoredSequence.id !== "string"
        || !authoredSequence.id
        || !Number.isInteger(authoredSequence.revision)
        || authoredSequence.revision < 1
        || authoredSequence.activityId !== CONJUGATION_COMET_ACTIVITY_ID
        || authoredSequence.exerciseFamilyId !== CONJUGATION_COMET_EXERCISE_FAMILY_ID) {
      throw new CurriculumServiceError(
        "CURRICULUM_DEVELOPER_PILOT_SEQUENCE_UNPINNED",
        "Developer pilot binding order must exactly match one pinned morphology exercise sequence."
      );
    }
    const normalizedCapabilityId = String(capabilityId || "").trim();
    const bindings = [];
    const capabilities = [];
    for (const bindingId of normalizedBindingIds) {
      const binding = morphologyBinding(bindingId);
      if (!binding) {
        throw new CurriculumServiceError(
          "CURRICULUM_DEVELOPER_PILOT_BINDING_UNKNOWN",
          `Developer pilot sequence binding ${bindingId} is not a pinned morphology binding.`
        );
      }
      if (!binding.targetSkillRefs?.some((reference) => reference?.id === normalizedSkillId)) {
        throw new CurriculumServiceError(
          "CURRICULUM_DEVELOPER_PILOT_SKILL_MISMATCH",
          `Binding ${bindingId} does not supply developer pilot skill ${normalizedSkillId}.`
        );
      }
      const assessedCapabilities = assessedCapabilitiesFor(binding);
      const selectedCapability = normalizedCapabilityId
        ? assessedCapabilities.find((row) => row?.id === normalizedCapabilityId)
        : assessedCapabilities.length === 1 ? assessedCapabilities[0] : null;
      if (!selectedCapability) {
        throw new CurriculumServiceError(
          "CURRICULUM_DEVELOPER_PILOT_CAPABILITY_MISMATCH",
          `Binding ${bindingId} does not supply the requested single independent scored capability.`
        );
      }
      bindings.push(binding);
      capabilities.push(selectedCapability);
    }
    const fingerprint = sequenceFingerprint(
      authoredSequence.id,
      authoredSequence.revision,
      normalizedSkillId,
      normalizedBindingIds
    );
    let normalizedExpectedStep = null;
    if (expectedStep !== undefined) {
      if (!isObject(expectedStep)
          || typeof expectedStep.bindingId !== "string"
          || !expectedStep.bindingId
          || !Number.isInteger(expectedStep.stepIndex)
          || expectedStep.stepIndex < 0
          || expectedStep.stepIndex >= normalizedBindingIds.length
          || normalizedBindingIds[expectedStep.stepIndex] !== expectedStep.bindingId
          || typeof expectedStep.sequenceFingerprint !== "string"
          || !expectedStep.sequenceFingerprint) {
        throw new CurriculumServiceError(
          "CURRICULUM_DEVELOPER_PILOT_EXPECTED_STEP_INVALID",
          "Expected developer pilot step must include bindingId, stepIndex, and sequenceFingerprint."
        );
      }
      normalizedExpectedStep = Object.freeze({
        bindingId: expectedStep.bindingId,
        stepIndex: expectedStep.stepIndex,
        sequenceFingerprint: expectedStep.sequenceFingerprint
      });
    }
    return Object.freeze({
      bindings,
      capabilities,
      targetSkillId: normalizedSkillId,
      orderedBindingIds: normalizedBindingIds,
      sequenceId: authoredSequence.id,
      sequenceRevision: authoredSequence.revision,
      sequenceFingerprint: fingerprint,
      expectedStep: normalizedExpectedStep,
      requirePresented
    });
  }

  function sequenceStepMetadata(sequence, stepIndex) {
    const bindingId = stepIndex < sequence.orderedBindingIds.length
      ? sequence.orderedBindingIds[stepIndex]
      : null;
    return Object.freeze({
      id: sequence.sequenceId,
      revision: sequence.sequenceRevision,
      fingerprint: sequence.sequenceFingerprint,
      orderedBindingIds: Object.freeze([...sequence.orderedBindingIds]),
      stepIndex,
      stepNumber: stepIndex + 1,
      totalSteps: sequence.orderedBindingIds.length,
      bindingId,
      expectedStep: bindingId === null ? null : Object.freeze({
        bindingId,
        stepIndex,
        sequenceFingerprint: sequence.sequenceFingerprint
      })
    });
  }

  function sequencePreview(request, stepIndex) {
    const binding = request.bindings[stepIndex];
    const capability = request.capabilities[stepIndex];
    return Object.freeze({
      bindingId: binding.id,
      activityId: binding.activityId,
      contentRef: clone(binding.contentRef),
      targetSkillId: request.targetSkillId,
      capabilityId: capability.id
    });
  }

  function establishSequenceUnlocked(request, { persist = true } = {}) {
    const sequences = readDeveloperPilotSequences();
    let sequence = sequences.find((row) => row.targetSkillId === request.targetSkillId);
    if (sequence) {
      if (sequence.sequenceId !== request.sequenceId
          || sequence.sequenceRevision !== request.sequenceRevision
          || sequence.sequenceFingerprint !== request.sequenceFingerprint
          || canonicalJson(sequence.orderedBindingIds) !== canonicalJson(request.orderedBindingIds)) {
        throw new CurriculumServiceError(
          "CURRICULUM_DEVELOPER_PILOT_SEQUENCE_CONFLICT",
          `Developer pilot skill ${request.targetSkillId} already has a different durable sequence.`
        );
      }
      return sequence;
    }
    sequence = {
      schemaVersion: DEVELOPER_PILOT_SEQUENCE_SCHEMA,
      sequenceId: request.sequenceId,
      sequenceRevision: request.sequenceRevision,
      sequenceFingerprint: request.sequenceFingerprint,
      targetSkillId: request.targetSkillId,
      orderedBindingIds: [...request.orderedBindingIds],
      establishedAt: null
    };
    if (!persist) return sequence;
    sequence.establishedAt = developerPilotClaimTime();
    sequences.push(sequence);
    writeStoredArray(developerPilotSequencesKey, sequences, MAX_STORED_DEVELOPER_PILOT_SEQUENCES);
    return sequence;
  }

  function sequencePositionUnlocked(sequence) {
    const completions = readDeveloperPilotCompletions()
      .filter((completion) => completion.sequenceId === sequence.sequenceId);
    let firstIncomplete = sequence.orderedBindingIds.length;
    for (let stepIndex = 0; stepIndex < sequence.orderedBindingIds.length; stepIndex += 1) {
      const completion = completions.find((row) => row.stepIndex === stepIndex);
      if (!completion) {
        firstIncomplete = stepIndex;
        break;
      }
    }
    if (completions.some((completion) => completion.stepIndex > firstIncomplete)) {
      throw new CurriculumServiceError(
        "CURRICULUM_STORAGE_CORRUPT",
        `Developer pilot sequence ${sequence.sequenceId} has an out-of-order completion receipt.`
      );
    }
    return firstIncomplete;
  }

  async function completeDeveloperPilotStep({
    orderedBindingIds,
    targetSkillId,
    taskId,
    taskFingerprint,
    completionKind,
    completedAt
  } = {}) {
    const request = await resolveDeveloperPilotSequence(orderedBindingIds, { targetSkillId });
    if (!DEVELOPER_PILOT_COMPLETION_KINDS.has(completionKind)) {
      throw new CurriculumServiceError(
        "CURRICULUM_DEVELOPER_PILOT_COMPLETION_KIND_INVALID",
        "Developer pilot completion kind must be correct-first-response, corrective-correct, or solution-review."
      );
    }
    const requestedTaskId = String(taskId || "").trim();
    const requestedTaskFingerprint = String(taskFingerprint || "").trim();
    if (!requestedTaskId || !requestedTaskFingerprint) {
      throw new CurriculumServiceError(
        "CURRICULUM_DEVELOPER_PILOT_COMPLETION_TASK_INVALID",
        "Developer pilot completion requires an exact task ID and fingerprint."
      );
    }
    return withCurriculumLedgerLock(() => {
      const sequence = readDeveloperPilotSequences().find((row) => row.sequenceId === request.sequenceId);
      if (!sequence || sequence.sequenceFingerprint !== request.sequenceFingerprint) {
        throw new CurriculumServiceError(
          "CURRICULUM_DEVELOPER_PILOT_SEQUENCE_UNKNOWN",
          "Developer pilot completion requires its previously established durable sequence."
        );
      }
      const tasks = readStoredArray(tasksKey);
      const events = readStoredArray(eventsKey);
      validatePersistentDeveloperPilotData(tasks, events);
      const task = tasks.find((row) => row?.taskId === requestedTaskId);
      if (!task || task.taskFingerprint !== requestedTaskFingerprint) {
        throw new CurriculumServiceError(
          "CURRICULUM_DEVELOPER_PILOT_COMPLETION_TASK_INVALID",
          "Developer pilot completion task is missing, stale, or has a different fingerprint."
        );
      }
      const stepIndex = sequence.orderedBindingIds.indexOf(task.bindingId);
      const binding = request.bindings[stepIndex];
      const capability = binding?.evidenceCapabilities?.find((row) => row?.id === task.capabilityId);
      if (stepIndex < 0
          || task.targetSkillId !== sequence.targetSkillId
          || !assessedCapabilitiesFor(binding).some((row) => row.id === capability?.id)) {
        throw new CurriculumServiceError(
          "CURRICULUM_DEVELOPER_PILOT_COMPLETION_TASK_INVALID",
          "Developer pilot completion task is not the assessed task for a step in this sequence."
        );
      }
      const claims = readDeveloperPilotClaims();
      if (!claims.some((claim) => (
        claim.bindingId === task.bindingId
        && claim.targetSkillId === task.targetSkillId
        && claim.sequenceId === sequence.sequenceId
        && claim.sequenceRevision === sequence.sequenceRevision
        && claim.sequenceFingerprint === sequence.sequenceFingerprint
        && claim.sequenceStepIndex === stepIndex
      ))) {
        throw new CurriculumServiceError(
          "CURRICULUM_DEVELOPER_PILOT_COMPLETION_UNCLAIMED",
          "Developer pilot completion cannot be recorded for an unclaimed task."
        );
      }
      const completions = readDeveloperPilotCompletions();
      const existing = completions.find((row) => row.sequenceId === sequence.sequenceId && row.stepIndex === stepIndex);
      if (existing) {
        if (existing.taskId !== task.taskId
            || existing.taskFingerprint !== task.taskFingerprint
            || existing.completionKind !== completionKind) {
          throw new CurriculumServiceError(
            "CURRICULUM_DEVELOPER_PILOT_COMPLETION_CONFLICT",
            `Developer pilot step ${stepIndex + 1} already has a different completion receipt.`
          );
        }
        return clone(existing);
      }
      if (sequencePositionUnlocked(sequence) !== stepIndex) {
        throw new CurriculumServiceError(
          "CURRICULUM_DEVELOPER_PILOT_COMPLETION_OUT_OF_ORDER",
          `Developer pilot step ${stepIndex + 1} cannot complete before all earlier steps.`
        );
      }
      const event = events.find((row) => row?.taskId === task.taskId && row?.attemptNumber === 1);
      if (!event || !completionKindMatchesEvent(task, event, completionKind)) {
        throw new CurriculumServiceError(
          "CURRICULUM_DEVELOPER_PILOT_COMPLETION_EVIDENCE_MISMATCH",
          `Completion kind ${completionKind} is inconsistent with the durable first-response evidence.`
        );
      }
      const roundState = readMorphologyRoundStates().find((record) => record.taskId === task.taskId);
      const settlementProof = morphologySettlementProof(roundState, event, completionKind, task);
      if (!settlementProof) {
        throw new CurriculumServiceError(
          "CURRICULUM_DEVELOPER_PILOT_COMPLETION_SETTLEMENT_MISMATCH",
          `Completion kind ${completionKind} is not proven by the exact persisted morphology settlement.`
        );
      }
      const timestamp = completedAt === undefined ? developerPilotClaimTime() : completedAt;
      if (!validTimestamp(timestamp)) {
        throw new CurriculumServiceError(
          "CURRICULUM_DEVELOPER_PILOT_TIME_INVALID",
          "Developer pilot completion time must be an ISO timestamp."
        );
      }
      const receipt = {
        schemaVersion: DEVELOPER_PILOT_COMPLETION_SCHEMA,
        sequenceId: sequence.sequenceId,
        sequenceRevision: sequence.sequenceRevision,
        sequenceFingerprint: sequence.sequenceFingerprint,
        targetSkillId: sequence.targetSkillId,
        stepIndex,
        bindingId: task.bindingId,
        taskId: task.taskId,
        taskFingerprint: task.taskFingerprint,
        roundId: settlementProof.roundId,
        cueRef: clone(settlementProof.cueRef),
        settlementId: settlementProof.settlementId,
        roundStateRevision: settlementProof.roundStateRevision,
        completionKind,
        completedAt: timestamp
      };
      completions.push(receipt);
      writeStoredArray(developerPilotCompletionsKey, completions, MAX_STORED_DEVELOPER_PILOT_COMPLETIONS);
      return clone(receipt);
    });
  }

  async function claimDeveloperPilotSequence(orderedBindingIds, options = {}) {
    const request = await resolveDeveloperPilotSequence(orderedBindingIds, options);
    requireDeveloperPilotLockManager();
    const lease = await acquireDeveloperPilotLease(
      `${namespace}.curriculum.developer-pilot-sequence.${request.targetSkillId}`
    );
    if (!lease) {
      return Object.freeze({
        status: "blocked",
        claimed: false,
        reason: "active-elsewhere",
        targetSkillId: request.targetSkillId,
        sequence: null,
        preview: null
      });
    }
    let pairRelease = null;
    let released = false;
    async function release() {
      if (released) return;
      released = true;
      if (pairRelease) await pairRelease();
      await lease.release();
    }
    try {
      const selection = await withCurriculumLedgerLock(() => {
        let sequence = establishSequenceUnlocked(request, { persist: false });
        const tasks = readStoredArray(tasksKey);
        const events = readStoredArray(eventsKey);
        validatePersistentDeveloperPilotData(tasks, events);
        const stepIndex = sequencePositionUnlocked(sequence);
        const sequenceMetadata = sequenceStepMetadata(sequence, stepIndex);
        if (stepIndex === sequence.orderedBindingIds.length) {
          return Object.freeze({ status: "complete", sequence, sequenceMetadata });
        }
        const preview = sequencePreview(request, stepIndex);
        const expected = request.expectedStep;
        if (expected && (
          expected.bindingId !== preview.bindingId
          || expected.stepIndex !== stepIndex
          || expected.sequenceFingerprint !== sequence.sequenceFingerprint
        )) {
          return Object.freeze({ status: "step-changed", sequence, sequenceMetadata, preview });
        }
        const claims = readDeveloperPilotClaims();
        const priorTasks = tasks.filter((task) => (
          task?.bindingId === preview.bindingId && task?.targetSkillId === request.targetSkillId
        ));
        const existingClaim = claims.find((claim) => (
          claim.bindingId === preview.bindingId && claim.targetSkillId === request.targetSkillId
        ));
        if (existingClaim || priorTasks.length) {
          const isSequenceClaim = Boolean(
            existingClaim
            && existingClaim.sequenceId === sequence.sequenceId
            && existingClaim.sequenceRevision === sequence.sequenceRevision
            && existingClaim.sequenceFingerprint === sequence.sequenceFingerprint
            && existingClaim.sequenceStepIndex === stepIndex
          );
          const assessedTasks = priorTasks.filter((task) => (
            assessedCapabilitiesFor(request.bindings[stepIndex]).some((row) => row.id === task.capabilityId)
          ));
          if (assessedTasks.length > 1) {
            throw new CurriculumServiceError(
              "CURRICULUM_STORAGE_CORRUPT",
              `Developer pilot sequence step ${stepIndex + 1} has more than one assessed task.`
            );
          }
          const task = isSequenceClaim ? assessedTasks[0] || null : null;
          return Object.freeze({
            status: task ? "incomplete" : "incomplete-unrecoverable",
            sequence,
            sequenceMetadata,
            preview,
            taskRef: task ? Object.freeze({ taskId: task.taskId, taskFingerprint: task.taskFingerprint }) : null
          });
        }
        if (!developerPilotIsPresented(request.requirePresented)) {
          return Object.freeze({ status: "not-presented", sequence, sequenceMetadata, preview });
        }
        sequence = establishSequenceUnlocked(request);
        return Object.freeze({ status: "claim", sequence, sequenceMetadata, preview });
      });

      if (selection.status === "complete") {
        await release();
        return Object.freeze({
          status: "complete",
          claimed: false,
          reason: "sequence-complete",
          targetSkillId: request.targetSkillId,
          sequence: selection.sequenceMetadata,
          preview: null
        });
      }
      if (selection.status === "step-changed" || selection.status === "not-presented") {
        await release();
        return Object.freeze({
          status: "deferred",
          claimed: false,
          reason: selection.status === "step-changed" ? "sequence-step-changed" : "not-presented",
          bindingId: selection.preview.bindingId,
          targetSkillId: request.targetSkillId,
          sequence: selection.sequenceMetadata,
          preview: selection.preview
        });
      }
      if (selection.status === "incomplete") {
        await release();
        return Object.freeze({
          status: "blocked",
          claimed: false,
          reason: "incomplete-step",
          bindingId: selection.preview.bindingId,
          targetSkillId: request.targetSkillId,
          sequence: selection.sequenceMetadata,
          preview: selection.preview,
          taskRef: selection.taskRef
        });
      }
      if (selection.status === "incomplete-unrecoverable") {
        await release();
        return Object.freeze({
          status: "blocked",
          claimed: false,
          reason: "incomplete-step-unrecoverable",
          bindingId: selection.preview.bindingId,
          targetSkillId: request.targetSkillId,
          sequence: selection.sequenceMetadata,
          preview: selection.preview,
          taskRef: null
        });
      }

      const claim = await performDeveloperPilotClaim(selection.preview.bindingId, {
        targetSkillId: request.targetSkillId,
        capabilityId: selection.preview.capabilityId,
        requirePresented: request.requirePresented,
        sequenceClaim: {
          sequenceId: selection.sequence.sequenceId,
          sequenceRevision: selection.sequence.sequenceRevision,
          sequenceFingerprint: selection.sequence.sequenceFingerprint,
          sequenceStepIndex: selection.sequenceMetadata.stepIndex
        }
      });
      if (claim.status !== "claimed") {
        await release();
        return Object.freeze({
          ...claim,
          sequence: selection.sequenceMetadata,
          preview: selection.preview
        });
      }
      pairRelease = claim.release;
      const opportunityTask = claim.opportunity.task;
      async function complete(completionKind, { completedAt } = {}) {
        const receipt = await completeDeveloperPilotStep({
          orderedBindingIds: request.orderedBindingIds,
          targetSkillId: request.targetSkillId,
          taskId: opportunityTask.taskId,
          taskFingerprint: opportunityTask.taskFingerprint,
          completionKind,
          completedAt
        });
        await release();
        return receipt;
      }
      return Object.freeze({
        ...claim,
        sequence: selection.sequenceMetadata,
        preview: selection.preview,
        complete,
        release
      });
    } catch (cause) {
      await release();
      throw cause;
    }
  }

  async function beginOpportunityUnlocked(activityId, stableContentId, {
    capabilityId,
    targetSkillId,
    requirePresented
  } = {}) {
    await requireReady();
    const resolution = resolveRuntimeBinding(bundle, activityId, stableContentId);
    const requestedCapabilityId = String(capabilityId || "").trim();
    const assessedCapabilities = resolution.binding.evidenceCapabilities.filter((row) => (
      row?.evidenceKind !== "exposure"
        && row?.independence === "independent"
        && row?.scoreRequired === true
    ));
    const selectedCapabilityId = requestedCapabilityId
      || (assessedCapabilities.length === 1 ? assessedCapabilities[0].id : "");
    if (!selectedCapabilityId) {
      throw new CurriculumServiceError(
        "CURRICULUM_OPPORTUNITY_CAPABILITY_REQUIRED",
        `Binding ${resolution.binding.id} requires an explicit assessed capability.`
      );
    }
    const task = await issueTaskUnlocked(resolution.binding.id, selectedCapabilityId, {
      targetSkillId,
      requirePresented
    });
    let hintsUsed = 0;
    let solutionRevealed = false;
    let responseSignature = null;
    let responsePromise = null;

    function ensureOpen(action) {
      if (responseSignature !== null) {
        throw new CurriculumServiceError(
          "CURRICULUM_OPPORTUNITY_CLOSED",
          `Cannot ${action} after the first response or reveal has closed this curriculum opportunity.`
        );
      }
    }

    function markHint(count = 1) {
      ensureOpen("add a hint");
      const increment = Number(count);
      if (!Number.isInteger(increment) || increment < 1) {
        throw new CurriculumServiceError("CURRICULUM_HINT_COUNT_INVALID", "Hint count must be a positive integer.");
      }
      hintsUsed += increment;
      return state();
    }

    function markSolutionRevealed() {
      ensureOpen("mark a solution reveal");
      solutionRevealed = true;
      return state();
    }

    async function persistFirstOutcome({ score, occurredAt = now() }) {
      const request = {
        attemptNumber: 1,
        score,
        solutionRevealed,
        hintsUsed,
        occurredAt
      };
      const signature = canonicalJson(request);
      if (responseSignature !== null) {
        if (responseSignature !== signature) {
          throw new CurriculumServiceError(
            "CURRICULUM_FIRST_RESPONSE_CONFLICT",
            "The first response for this curriculum opportunity was already recorded with a different outcome."
          );
        }
        return responsePromise;
      }
      responseSignature = signature;
      responsePromise = recordEvidence(task, request).catch((cause) => {
        responseSignature = null;
        responsePromise = null;
        throw cause;
      });
      return responsePromise;
    }

    function recordFirstResponse({ score, occurredAt } = {}) {
      return persistFirstOutcome({ score, occurredAt });
    }

    function recordSolutionReveal({ occurredAt } = {}) {
      solutionRevealed = true;
      if (responseSignature !== null) {
        return responsePromise;
      }
      return persistFirstOutcome({ score: 0, occurredAt });
    }

    function recordExposureForOpportunity() {
      return recordExposure(resolution.binding.id, { targetSkillId: task.targetSkillId });
    }

    function state() {
      return Object.freeze({
        activityId: task.activityId,
        stableContentId,
        taskId: task.taskId,
        taskFingerprint: task.taskFingerprint,
        hintsUsed,
        solutionRevealed,
        firstResponseRecorded: responseSignature !== null
      });
    }

    return Object.freeze({
      resolution: clone(resolution),
      task: clone(task),
      markHint,
      markSolutionRevealed,
      recordExposure: recordExposureForOpportunity,
      recordFirstResponse,
      recordSolutionReveal,
      state
    });
  }

  function beginOpportunity(activityId, stableContentId, options = {}) {
    return withCurriculumLedgerLock(() => beginOpportunityUnlocked(activityId, stableContentId, options));
  }

  async function saveMorphologyRoundState(task, {
    round,
    state: roundState = {},
    expectedRevision
  } = {}) {
    await requireReady();
    if (!developerPilotModeEnabled()) {
      throw new CurriculumServiceError(
        "CURRICULUM_GUIDED_MODE_DISABLED",
        "Morphology pilot state is available only in explicitly local developer Guided mode."
      );
    }
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
      throw new CurriculumServiceError(
        "CURRICULUM_MORPHOLOGY_ROUND_REVISION_INVALID",
        "Morphology round save requires a non-negative expectedRevision."
      );
    }
    let canonicalRound;
    let canonicalState;
    try {
      canonicalRound = canonicalJson(round);
      canonicalState = canonicalJson(roundState);
    } catch (cause) {
      throw new CurriculumServiceError(
        "CURRICULUM_MORPHOLOGY_ROUND_STATE_INVALID",
        "Morphology round and state must be canonical JSON values.",
        [cause?.message || String(cause)]
      );
    }
    if (!isObject(round) || !isObject(roundState)) {
      throw new CurriculumServiceError(
        "CURRICULUM_MORPHOLOGY_ROUND_STATE_INVALID",
        "Morphology round persistence requires one round object and one state object."
      );
    }
    return withCurriculumLedgerLock(() => {
      const tasks = readStoredArray(tasksKey);
      const events = readStoredArray(eventsKey);
      validatePersistentDeveloperPilotData(tasks, events);
      const issuedTask = tasks.find((row) => row?.taskId === task?.taskId);
      const binding = morphologyBinding(issuedTask?.bindingId);
      if (!issuedTask
          || canonicalJson(issuedTask) !== canonicalJson(task)
          || !binding
          || !assessedCapabilitiesFor(binding).some((row) => row.id === issuedTask.capabilityId)) {
        throw new CurriculumServiceError(
          "CURRICULUM_MORPHOLOGY_ROUND_TASK_INVALID",
          "Morphology round state requires an exact issued assessed morphology task."
        );
      }
      if (!validateMorphologyRoundAgainstTask(issuedTask, round)) {
        throw new CurriculumServiceError(
          "CURRICULUM_MORPHOLOGY_ROUND_STATE_INVALID",
          "Morphology round does not match its issued task fingerprint or pinned content projection."
        );
      }
      const records = readMorphologyRoundStates();
      validatePersistentMorphologyRoundStates(tasks);
      const existing = records.find((record) => record.taskId === issuedTask.taskId);
      if (existing && canonicalJson(existing.round) !== canonicalRound) {
        throw new CurriculumServiceError(
          "CURRICULUM_MORPHOLOGY_ROUND_COLLISION",
          `Task ${issuedTask.taskId} is already bound to a different immutable morphology round.`
        );
      }
      if (existing && canonicalJson(existing.state) === canonicalState) return clone(existing);
      if (existing && readDeveloperPilotCompletions().some((completion) => completion.taskId === issuedTask.taskId)) {
        throw new CurriculumServiceError(
          "CURRICULUM_MORPHOLOGY_ROUND_SETTLED",
          `Task ${issuedTask.taskId} already has a durable completion receipt and its settlement journal is immutable.`
        );
      }
      const currentRevision = existing?.revision || 0;
      if (expectedRevision !== currentRevision) {
        throw new CurriculumServiceError(
          "CURRICULUM_MORPHOLOGY_ROUND_REVISION_CONFLICT",
          `Morphology round state revision ${currentRevision} does not match expected revision ${expectedRevision}.`,
          [{ taskId: issuedTask.taskId, expectedRevision, currentRevision }]
        );
      }
      const savedAt = developerPilotClaimTime();
      const record = {
        schemaVersion: MORPHOLOGY_ROUND_STATE_SCHEMA,
        taskId: issuedTask.taskId,
        taskFingerprint: issuedTask.taskFingerprint,
        bindingId: issuedTask.bindingId,
        roundId: round.roundId,
        round: clone(round),
        state: clone(roundState),
        revision: currentRevision + 1,
        savedAt
      };
      if (existing) records[records.indexOf(existing)] = record;
      else records.push(record);
      writeStoredArray(morphologyRoundStatesKey, records, MAX_STORED_MORPHOLOGY_ROUND_STATES);
      return clone(record);
    });
  }

  async function restoreMorphologyRoundState(taskOrRef) {
    await requireReady();
    if (!developerPilotModeEnabled()) {
      throw new CurriculumServiceError(
        "CURRICULUM_GUIDED_MODE_DISABLED",
        "Morphology pilot state is available only in explicitly local developer Guided mode."
      );
    }
    const taskId = String(taskOrRef?.taskId || "").trim();
    const taskFingerprint = String(taskOrRef?.taskFingerprint || "").trim();
    if (!taskId || !taskFingerprint) {
      throw new CurriculumServiceError(
        "CURRICULUM_MORPHOLOGY_ROUND_TASK_INVALID",
        "Morphology round restore requires an exact task ID and fingerprint."
      );
    }
    return withCurriculumLedgerLock(() => {
      const tasks = readStoredArray(tasksKey);
      const task = tasks.find((row) => row?.taskId === taskId);
      if (!task || task.taskFingerprint !== taskFingerprint) {
        throw new CurriculumServiceError(
          "CURRICULUM_MORPHOLOGY_ROUND_TASK_INVALID",
          "Morphology round restore task is missing, stale, or has a different fingerprint."
        );
      }
      if (Object.keys(taskOrRef).length > 2 && canonicalJson(taskOrRef) !== canonicalJson(task)) {
        throw new CurriculumServiceError(
          "CURRICULUM_MORPHOLOGY_ROUND_TASK_INVALID",
          "Morphology round restore received a task payload that differs from the issued task."
        );
      }
      const binding = morphologyBinding(task.bindingId);
      if (!binding || !assessedCapabilitiesFor(binding).some((row) => row.id === task.capabilityId)) {
        throw new CurriculumServiceError(
          "CURRICULUM_MORPHOLOGY_ROUND_TASK_INVALID",
          "Morphology round restore requires an assessed morphology task."
        );
      }
      validatePersistentMorphologyRoundStates(tasks);
      const record = readMorphologyRoundStates().find((row) => row.taskId === taskId);
      if (!record) {
        return Object.freeze({
          task: clone(task),
          round: null,
          state: null,
          revision: 0,
          savedAt: null
        });
      }
      return Object.freeze({
        task: clone(task),
        round: clone(record.round),
        state: clone(record.state),
        revision: record.revision,
        savedAt: record.savedAt
      });
    });
  }

  async function skillSummary(targetSkillId) {
    await requireReady();
    const ledger = await readCurriculumLedgerSnapshot();
    const summaries = await aggregateLearningEvidence(
      bundle.curriculum,
      bundle.bindingRegistry,
      ledger.tasks,
      ledger.events
    );
    return clone(summaries.find((row) => row.targetSkillId === targetSkillId) || null);
  }

  async function progression() {
    await requireReady();
    const sessionId = currentSessionId();
    const ledger = await readCurriculumLedgerSnapshot();
    return clone(await computeCurriculumProgression({
      curriculum: bundle.curriculum,
      targetPack: bundle.targetPack,
      bindingRegistry: bundle.bindingRegistry,
      tasks: ledger.tasks,
      events: ledger.events,
      currentSession: {
        id: sessionId,
        taskSequence: nextTaskSequence(sessionId)
      }
    }));
  }

  async function nextRequest() {
    return (await progression()).nextRequest;
  }

  function snapshot() {
    return {
      status,
      guidedModeEnabled: guidedModeEnabled(),
      developerPilotModeEnabled: developerPilotModeEnabled(),
      failure: failure ? { code: failure.code, message: failure.message, details: clone(failure.details) } : null,
      validation: validation ? clone(validation) : null,
      storedTaskCount: (() => { try { return readStoredArray(tasksKey).length; } catch { return null; } })(),
      storedEventCount: (() => { try { return readStoredArray(eventsKey).length; } catch { return null; } })(),
      storedDeveloperPilotClaimCount: (() => { try { return readDeveloperPilotClaims().length; } catch { return null; } })(),
      storedDeveloperPilotSequenceCount: (() => { try { return readDeveloperPilotSequences().length; } catch { return null; } })(),
      storedDeveloperPilotCompletionCount: (() => { try { return readDeveloperPilotCompletions().length; } catch { return null; } })(),
      storedMorphologyRoundStateCount: (() => { try { return readMorphologyRoundStates().length; } catch { return null; } })()
    };
  }

  return Object.freeze({
    ready,
    guidedModeEnabled,
    developerPilotModeEnabled,
    resetProgress,
    resolveBinding,
    issueTask,
    beginOpportunity,
    recordEvidence,
    recordExposure,
    claimDeveloperPilot,
    claimDeveloperPilotSequence,
    completeDeveloperPilotStep,
    saveMorphologyRoundState,
    restoreMorphologyRoundState,
    skillSummary,
    progression,
    nextRequest,
    snapshot
  });
}
