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
const STAGE_OPERATION = {
  comprehend: "interpret",
  discriminate: "discriminate",
  retrieve: "retrieve",
  "supported-produce": "produce",
  interact: "respond",
  transfer: "respond",
  "delayed-retrieval": "retrieve"
};

async function readJson(name) {
  return JSON.parse(await readFile(new URL(name, dataUrl), "utf8"));
}

async function repinFixture(fixture) {
  const canonicalDigest = await computeCanonicalContractDigest(fixture.curriculum);
  fixture.targetPack.canonicalContractDigest = canonicalDigest;
  fixture.bindingRegistry.curriculum.canonicalContractDigest = canonicalDigest;
  fixture.bindingRegistry.targetPack.targetPackDigest = await computeTargetPackDigest(fixture.targetPack);
  return fixture;
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

async function syntheticFixture({ minimumIndependentRetrievals = 2 } = {}) {
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
    semanticDefinitions: [{
      id: "function.synthetic",
      revision: 1,
      kind: "function",
      requiredEvidenceMode: "production",
      definitionEn: "Complete the synthetic target-language function."
    }],
    unitOrder: [unitId],
    units: [{
      id: unitId,
      revision: 1,
      ordinal: 1,
      title: "Synthetic unit",
      description: "Test unit.",
      canDo: { observableOutcome: "Complete the synthetic sequence." },
      semanticScope: { functionIds: ["function.synthetic"], frameIds: [], conceptIds: [] },
      transferPolicy: { requiredContextDimensions: [], minimumNovelDimensionsPerTransfer: 0 },
      prerequisiteUnitIds: [],
      requiredLearningStages: [...STAGES],
      masteryPolicy: {
        minimumIndependentRetrievals,
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
    unitBindings: [{
      unitId,
      canonicalRevision: 1,
      functionBindings: [{ canonicalId: "function.synthetic", targetSkillIds: [skillId] }],
      frameBindings: [],
      conceptBindings: [],
      targetSkillIds: [skillId],
      contextIds: ["xx.context.synthetic"]
    }],
    skills: [{
      id: skillId,
      revision: 1,
      unitId,
      locale: "xx-XX",
      kind: "function",
      descriptionEn: "Synthetic target-language realization.",
      canonicalIds: ["function.synthetic"]
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
        id: "synthetic-opportunity.comprehend",
        operation: "interpret",
        targetSkillIds: [skillId],
        stimulusUtteranceIds: [],
        expectedUtteranceIds: []
      }, ...STAGES.filter((stage) => !["encounter", "comprehend"].includes(stage)).map((stage) => ({
        id: `synthetic-opportunity.${stage}`,
        operation: STAGE_OPERATION[stage],
        targetSkillIds: [skillId],
        stimulusUtteranceIds: ["interact", "transfer"].includes(stage) ? ["xx.utterance.synthetic-stimulus"] : [],
        expectedUtteranceIds: []
      }))]
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
    bindings: STAGES.map((stage) => ({
      id: `binding.synthetic.${stage}`,
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
      contextId: stage === "encounter" ? null : "xx.context.synthetic",
      contextRevision: stage === "encounter" ? null : 1,
      opportunityId: stage === "encounter" ? null : `synthetic-opportunity.${stage}`,
      evidenceCapabilities: [capability(stage)]
    }))
  };
  return { curriculum, targetPack, bindingRegistry, unitId, skillId };
}

async function twoSkillFixture() {
  const fixture = await syntheticFixture();
  const secondSkillId = "xx.skill.synthetic.second";
  const unit = fixture.curriculum.units[0];
  const unitBinding = fixture.targetPack.unitBindings[0];
  fixture.curriculum.semanticDefinitions.push(
    {
      id: "function.synthetic.second",
      revision: 1,
      kind: "function",
      requiredEvidenceMode: "production",
      definitionEn: "Complete the second synthetic target-language function."
    },
    ...["concept.synthetic.first", "concept.synthetic.shared", "concept.synthetic.second"].map((id) => ({
      id,
      revision: 1,
      kind: "concept",
      definitionEn: `Synthetic concept ${id}.`
    }))
  );
  unit.semanticScope.functionIds.push("function.synthetic.second");
  unit.semanticScope.conceptIds.push(
    "concept.synthetic.first",
    "concept.synthetic.shared",
    "concept.synthetic.second"
  );
  fixture.targetPack.skills[0].canonicalIds.push("concept.synthetic.first", "concept.synthetic.shared");
  fixture.targetPack.skills.push({
    id: secondSkillId,
    revision: 1,
    unitId: fixture.unitId,
    locale: "xx-XX",
    kind: "function",
    descriptionEn: "Second synthetic target-language realization.",
    canonicalIds: ["function.synthetic.second", "concept.synthetic.shared", "concept.synthetic.second"]
  });
  unitBinding.functionBindings.push({
    canonicalId: "function.synthetic.second",
    targetSkillIds: [secondSkillId]
  });
  unitBinding.conceptBindings.push(
    { canonicalId: "concept.synthetic.first", targetSkillIds: [fixture.skillId] },
    { canonicalId: "concept.synthetic.shared", targetSkillIds: [fixture.skillId, secondSkillId] },
    { canonicalId: "concept.synthetic.second", targetSkillIds: [secondSkillId] }
  );
  unitBinding.targetSkillIds.push(secondSkillId);
  for (const opportunity of fixture.targetPack.contexts[0].opportunities) {
    opportunity.targetSkillIds.push(secondSkillId);
  }
  const secondBindings = fixture.bindingRegistry.bindings.map((binding) => ({
    ...structuredClone(binding),
    id: binding.id.replace("binding.synthetic.", "binding.synthetic.second."),
    targetSkillRefs: [{ id: secondSkillId, revision: 1 }]
  }));
  fixture.bindingRegistry.bindings.push(...secondBindings);

  await repinFixture(fixture);
  return { ...fixture, secondSkillId };
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
    bindingId: `binding.synthetic.${stage}`,
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
  assert.ok(!actionUnit.requiredTargetSkillIds.includes("cs.skill.form.cist.present-singular-person"));
  assert.ok(!actionUnit.skills.some((skill) => skill.targetSkillId === "cs.skill.form.cist.present-singular-person"));
  assert.ok(actionUnit.blockers.some((entry) => entry.code === PLANNER_REASON_CODES.UNIT_PREREQUISITE_UNMET));
  const readSkill = actionUnit.skills.find((skill) => skill.targetSkillId === "cs.skill.sense.cist.read");
  assert.equal(readSkill.stages.find((stage) => stage.id === "encounter").capabilityCount, 2);
  assert.equal(readSkill.stages.find((stage) => stage.id === "comprehend").capabilityCount, 1);
  assert.equal(readSkill.stages.find((stage) => stage.id === "discriminate").capabilityCount, 1);
  const actionCoverage = progression.developerDiagnostics.mechanicCoverage.find((unit) => unit.canonicalUnitId === actionUnit.canonicalUnitId);
  assert.ok(actionCoverage.coveredStageSlotCount > 0, "developer diagnostics should still expose the Unit 3 pilot mechanics");
  assert.ok(actionCoverage.missingStageSlots.some((slot) => slot.targetSkillId === "cs.skill.sense.cist.read" && slot.learningStage === "retrieve"));
});

test("an unbound skill cannot escape required progression by omitting requiredForOutcome", async () => {
  const fixture = await productionFixture();
  const supplemental = fixture.targetPack.skills.find(
    (skill) => skill.id === "cs.skill.form.cist.present-singular-person"
  );
  assert.equal(supplemental.requiredForOutcome, false);
  delete supplemental.requiredForOutcome;
  await repinFixture(fixture);

  await assert.rejects(
    () => computeCurriculumProgression({
      ...fixture,
      tasks: [],
      events: [],
      currentSession: { id: "session-required-skill-escape" }
    }),
    (error) => error instanceof CurriculumPlannerError
      && error.code === "PLANNER_CONTRACT_INVALID"
      && error.details.path === "/targetPack/skills"
  );
});

test("a supplemental skill cannot be inserted into unit progression or mastery", async () => {
  const fixture = await productionFixture();
  const unitBinding = fixture.targetPack.unitBindings.find(
    (binding) => binding.unitId === "unit.routine.familiar-actions.01"
  );
  const readConcept = unitBinding.conceptBindings.find(
    (binding) => binding.canonicalId === "concept.action.read"
  );
  const requiredReadSkillId = "cs.skill.sense.cist.read";
  const supplementalSkillId = "cs.skill.form.cist.present-singular-person";
  readConcept.targetSkillIds.push(supplementalSkillId);
  assert.ok(unitBinding.targetSkillIds.includes(requiredReadSkillId));
  unitBinding.targetSkillIds.push(supplementalSkillId);
  await repinFixture(fixture);

  await assert.rejects(
    () => computeCurriculumProgression({
      ...fixture,
      tasks: [],
      events: [],
      currentSession: { id: "session-supplemental-mastery" }
    }),
    (error) => error instanceof CurriculumPlannerError
      && error.code === "PLANNER_CONTRACT_INVALID"
      && error.details.path.endsWith("/targetSkillIds")
      && error.message.includes("cannot become a required progression or mastery target")
  );
});

test("the planner rejects a target-pack reorder of the English within-unit sequence", async () => {
  const fixture = await productionFixture();
  [fixture.targetPack.unitBindings[0].targetSkillIds[0], fixture.targetPack.unitBindings[0].targetSkillIds[1]] = [
    fixture.targetPack.unitBindings[0].targetSkillIds[1],
    fixture.targetPack.unitBindings[0].targetSkillIds[0]
  ];
  fixture.bindingRegistry.targetPack.targetPackDigest = await computeTargetPackDigest(fixture.targetPack);

  await assert.rejects(
    () => computeCurriculumProgression({
      ...fixture,
      tasks: [],
      events: [],
      currentSession: { id: "session-reordered" }
    }),
    (error) => error instanceof CurriculumPlannerError
      && error.code === "PLANNER_CONTRACT_INVALID"
      && error.details.path === "/targetPack/unitBindings/0/targetSkillIds"
  );
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

test("a three-retrieval mastery threshold schedules consolidation without weakening the stage ladder", async () => {
  const fixture = await syntheticFixture({ minimumIndependentRetrievals: 3 });
  const state = history();
  for (const [index, stage] of STAGES.slice(0, 4).entries()) {
    await addAttempt(fixture, state, { stage, taskSequence: index + 1 });
  }

  const consolidation = await plan(fixture, state, { id: "session-1" });
  assert.equal(consolidation.nextTask.status, "ready");
  assert.equal(consolidation.nextTask.purpose, "consolidation");
  assert.equal(consolidation.nextTask.learningStage, "retrieve");
  assert.equal(consolidation.nextTask.reservedFutureRetrievals, 1);
  assert.equal(consolidation.nextTask.remainingRetrievalsAfterTask, 0);

  await addAttempt(fixture, state, {
    stage: "retrieve",
    taskSequence: 5,
    label: "consolidation-retrieve"
  });
  const afterConsolidation = await plan(fixture, state, { id: "session-1" });
  assert.equal(afterConsolidation.nextTask.purpose, "stage");
  assert.equal(afterConsolidation.nextTask.learningStage, "supported-produce");
  assert.equal(afterConsolidation.units[0].skills[0].evidence.independentRetrievals, 2);

  for (const [offset, stage] of ["supported-produce", "interact", "transfer"].entries()) {
    await addAttempt(fixture, state, { stage, taskSequence: 6 + offset });
  }
  const sameSession = await plan(fixture, state, { id: "session-1" });
  assert.ok(sameSession.nextTask.reasons.some((entry) => entry.code === PLANNER_REASON_CODES.DELAYED_RETRIEVAL_SESSION_GAP));

  const later = await plan(fixture, state, { id: "session-2" });
  assert.equal(later.nextTask.learningStage, "delayed-retrieval");
  await addAttempt(fixture, state, {
    stage: "delayed-retrieval",
    sessionId: "session-2",
    sessionNumber: 2,
    taskSequence: 1,
    label: "threshold-three-delay"
  });
  const complete = await plan(fixture, state, { id: "session-2" });
  assert.equal(complete.status, "complete");
  assert.equal(complete.units[0].skills[0].evidence.independentRetrievals, 3);
});

test("out-of-order retrieval cannot prepay a later consolidation requirement", async () => {
  const fixture = await syntheticFixture({ minimumIndependentRetrievals: 3 });
  const state = history();
  await addAttempt(fixture, state, { stage: "retrieve", taskSequence: 1, label: "early-retrieve" });
  for (const [offset, stage] of STAGES.slice(0, 4).entries()) {
    await addAttempt(fixture, state, { stage, taskSequence: offset + 2, label: `ordered-${stage}` });
  }

  const progression = await plan(fixture, state, { id: "session-1" });
  assert.equal(progression.units[0].skills[0].evidence.independentRetrievals, 1);
  assert.equal(progression.nextTask.purpose, "consolidation");
  assert.ok(progression.ignoredEvidence.some((entry) => (
    entry.eventId === "event-early-retrieve" && entry.reason === "out-of-order-stage-evidence"
  )));
});

test("session introduction budgets block a second new target skill and a third semantic concept", async (t) => {
  await t.test("target-skill reservation", async () => {
    const fixture = await twoSkillFixture();
    fixture.curriculum.planningPolicy.maxNewSemanticConceptsPerSession = 3;
    fixture.curriculum.planningPolicy.maxNewTargetConstructionsPerSession = 1;
    await repinFixture(fixture);
    fixture.bindingRegistry.bindings = fixture.bindingRegistry.bindings.filter((binding) => (
      binding.targetSkillRefs[0].id !== fixture.skillId
        || binding.evidenceCapabilities[0].learningStage === "encounter"
    ));
    const state = history();
    await addAttempt(fixture, state, { stage: "encounter", taskSequence: 1 });

    const progression = await plan(fixture, state, { id: "session-1" });
    const blocker = progression.nextTask.reasons.find((entry) => (
      entry.code === PLANNER_REASON_CODES.SESSION_TARGET_CONSTRUCTION_BUDGET
    ));
    assert.equal(progression.nextTask.status, "blocked");
    assert.equal(blocker.targetSkillId, fixture.secondSkillId);
    assert.deepEqual(progression.planningContext.introductionBudget.introducedTargetSkillIds, [fixture.skillId]);
  });

  await t.test("semantic concept limit with shared concepts counted once", async () => {
    const fixture = await twoSkillFixture();
    fixture.curriculum.planningPolicy.maxNewSemanticConceptsPerSession = 2;
    fixture.curriculum.planningPolicy.maxNewTargetConstructionsPerSession = 2;
    await repinFixture(fixture);
    fixture.bindingRegistry.bindings = fixture.bindingRegistry.bindings.filter((binding) => (
      binding.targetSkillRefs[0].id !== fixture.skillId
        || binding.evidenceCapabilities[0].learningStage === "encounter"
    ));
    const state = history();
    await addAttempt(fixture, state, { stage: "encounter", taskSequence: 1 });

    const blocked = await plan(fixture, state, { id: "session-1" });
    const conceptBlocker = blocked.nextTask.reasons.find((entry) => (
      entry.code === PLANNER_REASON_CODES.SESSION_SEMANTIC_CONCEPT_BUDGET
    ));
    assert.deepEqual(conceptBlocker.conceptIds, ["concept.synthetic.second"]);
    assert.deepEqual(
      blocked.planningContext.introductionBudget.introducedSemanticConceptIds,
      ["concept.synthetic.first", "concept.synthetic.shared"]
    );

    fixture.curriculum.planningPolicy.maxNewSemanticConceptsPerSession = 3;
    await repinFixture(fixture);
    const allowed = await plan(fixture, state, { id: "session-1" });
    assert.equal(allowed.nextTask.status, "ready");
    assert.equal(allowed.nextTask.targetSkillId, fixture.secondSkillId);
    assert.equal(allowed.nextTask.learningStage, "encounter");
  });
});

test("an issued encounter reserves the session introduction budget even before evidence arrives", async () => {
  const fixture = await twoSkillFixture();
  const state = history();
  const task = await issueLearningTask(fixture.bindingRegistry, {
    taskId: "task-open-encounter",
    issuedAt: iso(1, 1),
    sessionId: "session-1",
    taskSequence: 1,
    bindingId: "binding.synthetic.encounter",
    capabilityId: "cap.encounter",
    targetSkillId: fixture.skillId
  });
  state.tasks.push(task);

  const progression = await plan(fixture, state, { id: "session-1" });
  assert.equal(progression.nextTask.status, "blocked");
  assert.equal(progression.nextTask.reasons[0].code, PLANNER_REASON_CODES.OPEN_TASK_AWAITING_EVIDENCE);
  assert.deepEqual(progression.planningContext.introductionBudget.introducedTargetSkillIds, [fixture.skillId]);
  assert.deepEqual(
    progression.planningContext.introductionBudget.introducedSemanticConceptIds,
    ["concept.synthetic.first", "concept.synthetic.shared"]
  );
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
  assert.equal(progression.nextTask.status, "blocked");
  assert.ok(progression.nextTask.reasons.some((entry) => entry.code === PLANNER_REASON_CODES.REPAIR_SPACING_NOT_REACHED));
  assert.equal(progression.repairQueue[0].learningStage, "retrieve");
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

  const unstimulatedInteraction = await syntheticFixture();
  unstimulatedInteraction.targetPack.contexts[0].opportunities
    .find((opportunity) => opportunity.id === "synthetic-opportunity.interact")
    .stimulusUtteranceIds = [];
  await repinFixture(unstimulatedInteraction);
  await assert.rejects(
    () => plan(unstimulatedInteraction, history(), { id: "session-1" }),
    (error) => error instanceof CurriculumPlannerError
      && error.code === "PLANNER_CONTRACT_INVALID"
      && /requires an interlocutor stimulus/.test(error.message)
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
