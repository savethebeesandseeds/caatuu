import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  computeCurriculumProgression,
  CurriculumPlannerError,
  PLANNER_REASON_CODES
} from "../runtime/curriculum-planner-core.mjs";
import {
  computeCanonicalContractDigest,
  computeTargetPackDigest,
  createLearningEvidenceEvent,
  issueLearningTask
} from "../runtime/curriculum-runtime-core.mjs";

const dataUrl = new URL("../data/", import.meta.url);
const STAGES = [
  "encounter",
  "comprehend",
  "discriminate",
  "retrieve",
  "supported-produce",
  "interact",
  "transfer",
  "delayed-retrieval"
];

async function readJson(name) {
  return JSON.parse(await readFile(new URL(name, dataUrl), "utf8"));
}

async function productionFixture() {
  const [curriculum, targetPack, bindingRegistry] = await Promise.all([
    readJson("canonical-curriculum.v1.en.json"),
    readJson("cs-CZ.realization-pack.v1.json"),
    readJson("cs-CZ.cross-game-bindings.v1.json")
  ]);
  return { curriculum, targetPack, bindingRegistry };
}

function capability(stage) {
  if (stage === "encounter") {
    return {
      id: `cap.${stage}`,
      mechanicId: `mechanic.${stage}`,
      learningStage: stage,
      evidenceKind: "exposure",
      independence: "exposure",
      scoreRequired: false,
      masteryEligible: false
    };
  }
  const definitions = {
    comprehend: ["comprehension", "independent", false],
    discriminate: ["comprehension", "independent", false],
    retrieve: ["retrieval", "independent", true],
    "supported-produce": ["production", "supported", false],
    interact: ["production", "independent", true],
    transfer: ["transfer", "independent", true],
    "delayed-retrieval": ["retrieval", "independent", true]
  };
  const [evidenceKind, independence, masteryEligible] = definitions[stage];
  return {
    id: `cap.${stage}`,
    mechanicId: `mechanic.${stage}`,
    learningStage: stage,
    evidenceKind,
    independence,
    scoreRequired: true,
    masteryEligible,
    minimumScore: 1
  };
}

async function syntheticFixture() {
  const unitId = "unit.synthetic.01";
  const skillId = "xx.skill.synthetic";
  const curriculum = {
    schemaVersion: "caatuu-canonical-curriculum-v1",
    curriculumId: "caatuu.synthetic",
    version: "1.0.0",
    specLocale: "en",
    title: "Synthetic canonical curriculum",
    description: "Test-only English curriculum.",
    planningPolicy: {
      maxNewSemanticConceptsPerSession: 2,
      maxNewTargetConstructionsPerSession: 1,
      repairRetryTaskGap: { minimum: 2, maximum: 4 },
      delayedRetrievalMinimumSessionGap: 1,
      exposureCanQualifyForMastery: false,
      solutionRevealCanQualifyForMastery: false
    },
    learningStageSequence: [...STAGES],
    semanticDefinitions: [],
    unitOrder: [unitId],
    units: [{
      id: unitId,
      revision: 1,
      ordinal: 1,
      title: "Synthetic unit",
      description: "Test unit.",
      canDo: { observableOutcome: "Complete the synthetic sequence." },
      semanticScope: { functionIds: [], frameIds: [], conceptIds: [] },
      transferPolicy: { requiredContextDimensions: [], minimumNovelDimensionsPerTransfer: 0 },
      prerequisiteUnitIds: [],
      requiredLearningStages: [...STAGES],
      masteryPolicy: {
        minimumIndependentRetrievals: 2,
        minimumSessions: 2,
        minimumDistinctContexts: 1,
        scope: "each-required-target-skill",
        requiresTransfer: true,
        requiresProduction: true,
        solutionRevealCanQualify: false,
        unresolvedRecentFailureBlocksMastery: true
      }
    }]
  };
  const targetPack = {
    schemaVersion: "caatuu-target-realization-pack-v1",
    packId: "caatuu.xx.synthetic",
    version: "1.0.0",
    specLocale: "en",
    targetLocale: "xx-XX",
    supportLocales: ["en"],
    curriculum: { id: curriculum.curriculumId, version: curriculum.version },
    canonicalContractDigest: await computeCanonicalContractDigest(curriculum),
    unitOrder: [unitId],
    unitBindings: [{ unitId, canonicalRevision: 1, targetSkillIds: [skillId] }],
    skills: [{
      id: skillId,
      revision: 1,
      unitId,
      locale: "xx-XX",
      kind: "function",
      descriptionEn: "Synthetic target-language realization.",
      canonicalIds: []
    }],
    utterances: [],
    contexts: [{
      id: "xx.context.synthetic",
      revision: 1,
      unitId,
      locale: "xx-XX",
      descriptionEn: "Synthetic assessment context.",
      featureValues: { setting: "synthetic" },
      opportunities: [{
        id: "synthetic-opportunity",
        operation: "respond",
        targetSkillIds: [skillId],
        stimulusUtteranceIds: [],
        expectedUtteranceIds: []
      }]
    }]
  };
  const bindingRegistry = {
    schemaVersion: "caatuu-cross-game-binding-registry-v1",
    registryId: "caatuu.xx.synthetic-bindings",
    version: "1.0.0",
    curriculum: {
      id: curriculum.curriculumId,
      version: curriculum.version,
      canonicalContractDigest: await computeCanonicalContractDigest(curriculum)
    },
    targetPack: {
      id: targetPack.packId,
      version: targetPack.version,
      targetLocale: targetPack.targetLocale,
      targetPackDigest: await computeTargetPackDigest(targetPack)
    },
    bindings: [{
      id: "binding.synthetic",
      activityId: "synthetic-game",
      contentRef: {
        catalogId: "synthetic-catalog",
        catalogRevision: "1",
        catalogDigest: `sha256:${"0".repeat(64)}`,
        contentId: "synthetic-content",
        revision: 1,
        contentDigest: `sha256:${"1".repeat(64)}`
      },
      canonicalUnitId: unitId,
      canonicalUnitRevision: 1,
      targetSkillRefs: [{ id: skillId, revision: 1 }],
      contextId: "xx.context.synthetic",
      contextRevision: 1,
      opportunityId: "synthetic-opportunity",
      evidenceCapabilities: STAGES.map(capability)
    }]
  };
  return { curriculum, targetPack, bindingRegistry, unitId, skillId };
}

function history() {
  return { tasks: [], events: [] };
}

function iso(sessionNumber, taskSequence, seconds = 0) {
  return new Date(Date.UTC(2026, 7, sessionNumber, 10, taskSequence, seconds)).toISOString();
}

async function addAttempt(fixture, state, {
  stage,
  sessionId = "session-1",
  sessionNumber = 1,
  taskSequence,
  score = stage === "encounter" ? null : 1,
  solutionRevealed = false,
  hintsUsed = 0,
  attemptNumber = 1,
  label = `${sessionId}-${taskSequence}-${stage}`
}) {
  const task = await issueLearningTask(fixture.bindingRegistry, {
    taskId: `task-${label}`,
    issuedAt: iso(sessionNumber, taskSequence),
    sessionId,
    taskSequence,
    bindingId: "binding.synthetic",
    capabilityId: `cap.${stage}`,
    targetSkillId: fixture.skillId
  });
  const event = createLearningEvidenceEvent(task, {
    eventId: `event-${label}`,
    occurredAt: iso(sessionNumber, taskSequence, 10),
    attemptNumber,
    score,
    solutionRevealed,
    hintsUsed
  });
  state.tasks.push(task);
  state.events.push(event);
  return { task, event };
}

async function plan(fixture, state, currentSession) {
  return computeCurriculumProgression({ ...fixture, ...state, currentSession });
}

test("production bindings cannot jump ahead of the English canonical unit sequence", async () => {
  const fixture = await productionFixture();
  const progression = await computeCurriculumProgression({
    ...fixture,
    tasks: [],
    events: [],
    currentSession: { id: "session-production" }
  });

  assert.equal(progression.status, "blocked");
  assert.equal(progression.activeUnitId, "unit.interaction.entry-and-repair.01");
  assert.ok(progression.nextTask.reasons.every((entry) => entry.code === PLANNER_REASON_CODES.STAGE_CAPABILITY_UNAVAILABLE));
  assert.equal(progression.nextRequest.status, "blocked");

  const actionUnit = progression.units.find((unit) => unit.canonicalUnitId === "unit.routine.familiar-actions.01");
  assert.equal(actionUnit.status, "locked");
  assert.equal(actionUnit.requiredTargetSkillIds.length, 8);
  assert.ok(actionUnit.blockers.some((entry) => entry.code === PLANNER_REASON_CODES.UNIT_PREREQUISITE_UNMET));
  const readSkill = actionUnit.skills.find((skill) => skill.targetSkillId === "cs.skill.sense.cist.read");
  assert.equal(readSkill.stages.find((stage) => stage.id === "encounter").capabilityCount, 2);
  assert.equal(readSkill.stages.find((stage) => stage.id === "comprehend").capabilityCount, 0);
  const actionCoverage = progression.developerDiagnostics.mechanicCoverage.find((unit) => unit.canonicalUnitId === actionUnit.canonicalUnitId);
  assert.ok(actionCoverage.coveredStageSlotCount > 0, "developer diagnostics should still expose the Unit 3 pilot mechanics");
  assert.ok(actionCoverage.missingStageSlots.some((slot) => slot.targetSkillId === "cs.skill.sense.cist.read" && slot.learningStage === "comprehend"));
});

test("ordered stages and delayed retrieval require a later session before honest mastery", async () => {
  const fixture = await syntheticFixture();
  const state = history();
  const initial = await plan(fixture, state, { id: "session-1" });
  assert.equal(initial.nextTask.status, "ready");
  assert.equal(initial.nextTask.learningStage, "encounter");

  for (const [index, stage] of STAGES.slice(0, -1).entries()) {
    await addAttempt(fixture, state, {
      stage,
      taskSequence: index + 1,
      hintsUsed: stage === "supported-produce" ? 1 : 0
    });
  }
  const sameSession = await plan(fixture, state, { id: "session-1" });
  assert.equal(sameSession.nextTask.status, "blocked");
  assert.ok(sameSession.nextTask.reasons.some((entry) => entry.code === PLANNER_REASON_CODES.DELAYED_RETRIEVAL_SESSION_GAP));
  const beforeDelay = sameSession.units[0].skills[0];
  assert.equal(beforeDelay.evidence.exposureEvents, 1);
  assert.equal(beforeDelay.evidence.productionEvidence, 1, "hinted supported production must not count as mastery evidence");
  assert.equal(beforeDelay.masteryReady, false);

  await addAttempt(fixture, state, { stage: "delayed-retrieval", taskSequence: 8, label: "too-early-delay" });
  const ignoredDelay = await plan(fixture, state, { id: "session-1" });
  assert.ok(ignoredDelay.ignoredEvidence.some((entry) => entry.eventId === "event-too-early-delay" && entry.reason === "delayed-retrieval-too-early"));
  assert.equal(ignoredDelay.units[0].skills[0].stages.at(-1).status, "current");

  const nextSession = await plan(fixture, state, { id: "session-2" });
  assert.equal(nextSession.nextTask.status, "ready");
  assert.equal(nextSession.nextTask.learningStage, "delayed-retrieval");
  await addAttempt(fixture, state, {
    stage: "delayed-retrieval",
    sessionId: "session-2",
    sessionNumber: 2,
    taskSequence: 1,
    label: "valid-delay"
  });
  const completed = await plan(fixture, state, { id: "session-2" });
  assert.equal(completed.status, "complete");
  assert.equal(completed.units[0].skills[0].masteryReady, true);
  assert.deepEqual(completed.masteredUnitIds, [fixture.unitId]);
});

test("reveals and independent hints are valid practice records but cannot advance a stage or mastery", async () => {
  const fixture = await syntheticFixture();
  const state = history();
  for (const [index, stage] of STAGES.slice(0, 3).entries()) {
    await addAttempt(fixture, state, { stage, taskSequence: index + 1 });
  }
  await addAttempt(fixture, state, {
    stage: "retrieve",
    taskSequence: 4,
    solutionRevealed: true,
    hintsUsed: 1,
    label: "revealed-retrieve"
  });
  const progression = await plan(fixture, state, { id: "session-1" });
  const skill = progression.units[0].skills[0];
  assert.equal(progression.nextTask.learningStage, "retrieve");
  assert.equal(skill.evidence.independentRetrievals, 0);
  assert.equal(skill.stages.find((stage) => stage.id === "retrieve").status, "current");
  assert.ok(progression.ignoredEvidence.some((entry) => entry.eventId === "event-revealed-retrieve" && entry.reason === "solution-revealed"));
});

test("same-session repair waits for two intervening tasks and is due through the fourth", async () => {
  const fixture = await syntheticFixture();
  const state = history();
  for (const [index, stage] of STAGES.slice(0, 3).entries()) {
    await addAttempt(fixture, state, { stage, taskSequence: index + 1 });
  }
  await addAttempt(fixture, state, { stage: "retrieve", taskSequence: 4, score: 0, label: "failed-retrieve" });

  const tooSoon = await plan(fixture, state, { id: "session-1" });
  assert.equal(tooSoon.nextTask.status, "blocked");
  const spacing = tooSoon.nextTask.reasons.find((entry) => entry.code === PLANNER_REASON_CODES.REPAIR_SPACING_NOT_REACHED);
  assert.equal(spacing.tasksUntilEligible, 2);

  await addAttempt(fixture, state, { stage: "encounter", taskSequence: 5, label: "filler-1" });
  await addAttempt(fixture, state, { stage: "encounter", taskSequence: 6, label: "filler-2" });
  const due = await plan(fixture, state, { id: "session-1" });
  assert.equal(due.nextTask.status, "ready");
  assert.equal(due.nextTask.purpose, "repair");
  assert.equal(due.nextTask.repairsTaskId, "task-failed-retrieve");
  assert.equal(due.repairQueue[0].interveningTasks, 2);

  await addAttempt(fixture, state, { stage: "retrieve", taskSequence: 7, label: "spaced-repair" });
  const repaired = await plan(fixture, state, { id: "session-1" });
  assert.equal(repaired.repairQueue.length, 0);
  assert.equal(repaired.nextTask.learningStage, "supported-produce");
});

test("a missed same-session repair window waits for a later session", async () => {
  const fixture = await syntheticFixture();
  const state = history();
  for (const [index, stage] of STAGES.slice(0, 3).entries()) {
    await addAttempt(fixture, state, { stage, taskSequence: index + 1 });
  }
  await addAttempt(fixture, state, { stage: "retrieve", taskSequence: 4, score: 0, label: "missed-window-failure" });
  for (let sequence = 5; sequence <= 9; sequence += 1) {
    await addAttempt(fixture, state, { stage: "encounter", taskSequence: sequence, label: `late-filler-${sequence}` });
  }
  const missed = await plan(fixture, state, { id: "session-1" });
  assert.equal(missed.repairQueue[0].status, "missed");
  assert.ok(missed.nextTask.reasons.some((entry) => entry.code === PLANNER_REASON_CODES.REPAIR_REQUIRES_LATER_SESSION));

  const later = await plan(fixture, state, { id: "session-2" });
  assert.equal(later.nextTask.status, "ready");
  assert.equal(later.nextTask.purpose, "repair");
  assert.equal(later.nextTask.repairTiming, "later-session");
});

test("invalid contracts, tampered history, and sequence rewinds fail closed", async () => {
  const fixture = await syntheticFixture();
  const staleCanonicalPin = structuredClone(fixture);
  staleCanonicalPin.targetPack.canonicalContractDigest = `sha256:${"f".repeat(64)}`;
  await assert.rejects(
    () => plan(staleCanonicalPin, history(), { id: "session-1" }),
    (error) => error instanceof CurriculumPlannerError
      && error.code === "PLANNER_CONTRACT_INVALID"
      && error.details.path === "/targetPack/canonicalContractDigest"
  );

  const unsafePolicy = structuredClone(fixture);
  unsafePolicy.curriculum.planningPolicy.exposureCanQualifyForMastery = true;
  await assert.rejects(
    () => plan(unsafePolicy, history(), { id: "session-1" }),
    (error) => error instanceof CurriculumPlannerError && error.code === "PLANNER_CONTRACT_INVALID"
  );

  const state = history();
  await addAttempt(fixture, state, { stage: "encounter", taskSequence: 1 });
  const tampered = structuredClone(state);
  tampered.tasks[0].learningStage = "retrieve";
  await assert.rejects(
    () => plan(fixture, tampered, { id: "session-1" }),
    (error) => error instanceof CurriculumPlannerError
      && error.code === "PLANNER_HISTORY_INVALID"
      && error.details.causeCode === "TASK_FINGERPRINT_MISMATCH"
  );
  await assert.rejects(
    () => plan(fixture, state, { id: "session-1", taskSequence: 1 }),
    (error) => error instanceof CurriculumPlannerError && error.code === "PLANNER_SESSION_SEQUENCE_INVALID"
  );
});
