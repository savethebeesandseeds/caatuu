import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  aggregateLearningEvidence,
  computeContentDigest,
  issueLearningTask,
  validateCrossGameBindings,
  validateLearningEvidenceEvent,
  validateLearningTask
} from "../src/cross-game-binding-core.mjs";
import {
  computeCanonicalContractDigest,
  computeTargetPackDigest
} from "../src/validate-conformance.mjs";

const curriculumUrl = new URL("../data/canonical-curriculum.v1.en.json", import.meta.url);
const packUrl = new URL("../data/cs-CZ.realization-pack.v1.json", import.meta.url);
const catalogUrl = new URL("../data/pilot-content-sources.v1.json", import.meta.url);
const registryUrl = new URL("../data/cs-CZ.cross-game-bindings.v1.json", import.meta.url);

const WORD_BINDING = "binding.word-world.ww-cp-000146";
const VERB_BINDING = "binding.verb-nebula.cs.verb.cist.read";
const WORD_CAPABILITY = "independent-comprehension";
const VERB_CAPABILITY = "independent-discrimination";

async function readJson(url) {
  return JSON.parse(await readFile(url, "utf8"));
}

async function fixtures() {
  const [curriculum, pack, catalog, registry] = await Promise.all([
    readJson(curriculumUrl),
    readJson(packUrl),
    readJson(catalogUrl),
    readJson(registryUrl)
  ]);
  const canonicalContractDigest = computeCanonicalContractDigest(curriculum);
  pack.canonicalContractDigest = canonicalContractDigest;
  registry.curriculum.canonicalContractDigest = canonicalContractDigest;
  registry.targetPack.targetPackDigest = computeTargetPackDigest(pack);
  return { curriculum, pack, catalog, registry };
}

function authorSyntheticMorphologySequenceLength(catalog, registry, length) {
  const sequence = registry.exerciseSequences[0];
  const orderedBindingIds = [...sequence.orderedBindingIds];
  if (length === 2) {
    const removedBindingIds = new Set(orderedBindingIds.splice(2));
    const removedContentIds = new Set(registry.bindings
      .filter((binding) => removedBindingIds.has(binding.id))
      .map((binding) => binding.contentRef.contentId));
    registry.bindings = registry.bindings.filter((binding) => !removedBindingIds.has(binding.id));
    catalog.sources = catalog.sources.filter((source) => !removedContentIds.has(source.contentId));
  } else if (length === 4) {
    const templateBinding = registry.bindings.find((binding) => binding.id === orderedBindingIds[2]);
    const templateSource = catalog.sources.find((source) => source.contentId === templateBinding.contentRef.contentId);
    const binding = structuredClone(templateBinding);
    const source = structuredClone(templateSource);
    binding.id = `${binding.id}.synthetic-step-4`;
    source.contentId = `${source.contentId}.synthetic-step-4`;
    source.snapshot.id = source.contentId;
    source.snapshot.sequenceStep = 4;
    source.snapshot.difficulty.rationaleEn = "Synthetic fourth step used to verify authored sequence cardinality.";
    source.contentDigest = computeContentDigest(source);
    binding.contentRef.contentId = source.contentId;
    binding.contentRef.contentDigest = source.contentDigest;
    registry.bindings.push(binding);
    catalog.sources.push(source);
    orderedBindingIds.push(binding.id);
  }
  sequence.orderedBindingIds = orderedBindingIds;
}

function taskFor(registry, {
  taskId,
  issuedAt,
  sessionId,
  taskSequence,
  bindingId,
  capabilityId = bindingId === WORD_BINDING ? WORD_CAPABILITY : VERB_CAPABILITY
}) {
  return issueLearningTask(registry, {
    taskId,
    issuedAt,
    sessionId,
    taskSequence,
    bindingId,
    capabilityId,
    targetSkillId: "cs.skill.sense.cist.read"
  });
}

function eventFor(task, {
  eventId,
  occurredAt,
  attemptNumber = 1,
  score,
  solutionRevealed = false,
  hintsUsed = 0
}) {
  return {
    schemaVersion: "caatuu-cross-game-learning-evidence-v1",
    eventId,
    occurredAt,
    taskId: task.taskId,
    taskFingerprint: task.taskFingerprint,
    sessionId: task.sessionId,
    taskSequence: task.taskSequence,
    attemptNumber,
    registry: structuredClone(task.registry),
    bindingId: task.bindingId,
    capabilityId: task.capabilityId,
    activityId: task.activityId,
    mechanicId: task.mechanicId,
    contentRef: structuredClone(task.contentRef),
    canonicalUnitId: task.canonicalUnitId,
    canonicalUnitRevision: task.canonicalUnitRevision,
    targetSkillId: task.targetSkillId,
    targetSkillRevision: task.targetSkillRevision,
    contextId: task.contextId,
    contextRevision: task.contextRevision,
    opportunityId: task.opportunityId,
    outcome: { score, solutionRevealed, hintsUsed }
  };
}

test("the pilot binds real Word World content and a stable Verb Nebula sidecar", async () => {
  const { curriculum, pack, catalog, registry } = await fixtures();
  const result = validateCrossGameBindings(curriculum, pack, catalog, registry);

  assert.equal(result.valid, true, JSON.stringify(result.errors, null, 2));
  assert.equal(result.targetPackDigest, computeTargetPackDigest(pack));
  assert.deepEqual(result.summary.activities, ["conjugation-comet", "verb-nebula", "word-world"]);
  assert.equal(result.summary.bindings, 11);
  assert.equal(result.summary.exerciseSequences, 2);

  const word = catalog.sources.find((source) => source.contentId === "ww-cp-000146");
  const verb = catalog.sources.find((source) => source.contentId === "cs.verb.cist.read");
  assert.equal(word.snapshot.cs, "Dědeček čte.");
  assert.equal(word.snapshot.en, "Grandpa is reading.");
  assert.deepEqual(word.snapshot.focusTarget, { surface: "čte", normalized: "čte", tokenIndex: 1 });
  assert.equal(verb.snapshot.id, "cs.verb.cist.read");
  assert.equal(verb.snapshot.cz, "číst");
  assert.equal(verb.snapshot.eng, "read");
  assert.deepEqual(verb.snapshot.legacyLocator, { pairId: "core-verb-179", sourceIndex: 179 });
  assert.deepEqual(
    verb.snapshot.guidedContrasts.map((contrast) => ({
      conceptId: contrast.conceptId,
      targetSkillId: contrast.targetSkillId,
      id: contrast.id,
      cz: contrast.cz,
      eng: contrast.eng,
      legacyLocator: contrast.legacyLocator
    })),
    [
      { conceptId: "concept.action.eat", targetSkillId: "cs.skill.sense.jist.eat", id: "cs.verb.jist.eat", cz: "jíst", eng: "eat", legacyLocator: { pairId: "core-verb-202", sourceIndex: 202 } },
      { conceptId: "concept.action.drink", targetSkillId: "cs.skill.sense.pit.drink", id: "cs.verb.pit.drink", cz: "pít", eng: "drink", legacyLocator: { pairId: "core-verb-203", sourceIndex: 203 } },
      { conceptId: "concept.action.sleep", targetSkillId: "cs.skill.sense.spat.sleep", id: "cs.verb.spat.sleep", cz: "spát", eng: "sleep", legacyLocator: { pairId: "core-verb-157", sourceIndex: 157 } }
    ]
  );
  assert.equal(computeContentDigest(word), word.contentDigest);
  assert.equal(computeContentDigest(verb), verb.contentDigest);

  const wordBinding = registry.bindings.find((binding) => binding.id === WORD_BINDING);
  const verbBinding = registry.bindings.find((binding) => binding.id === VERB_BINDING);
  assert.equal(wordBinding.contextId, null);
  assert.equal(wordBinding.contextRevision, null);
  assert.equal(wordBinding.opportunityId, null);
  assert.equal(verbBinding.contextId, null);
  assert.equal(verbBinding.opportunityId, null);
  assert.deepEqual(wordBinding.evidenceCapabilities[1], {
    id: WORD_CAPABILITY,
    mechanicId: "translation-reconstruction",
    learningStage: "comprehend",
    evidenceKind: "comprehension",
    independence: "independent",
    scoreRequired: true,
    masteryEligible: false,
    minimumScore: 1
  });
  assert.deepEqual(verbBinding.evidenceCapabilities[1], {
    id: VERB_CAPABILITY,
    mechanicId: "association-grid-match",
    learningStage: "discriminate",
    evidenceKind: "comprehension",
    independence: "independent",
    scoreRequired: true,
    masteryEligible: false,
    minimumScore: 1
  });

  assert.equal(pack.contexts.some((row) => row.id === wordBinding.contextId), false);
});

test("morphology bindings must preserve their source-pinned sequence order", async () => {
  const { curriculum, pack, catalog, registry } = await fixtures();
  const invalid = structuredClone(registry);
  const ordered = invalid.exerciseSequences[0].orderedBindingIds;
  [ordered[1], ordered[2]] = [ordered[2], ordered[1]];
  const result = validateCrossGameBindings(curriculum, pack, catalog, invalid);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(({ code }) => code === "BIND_SEQUENCE_INVALID"));
});

test("the binding contract accepts authored two-step and four-step morphology sequences", async () => {
  for (const length of [2, 4]) {
    const { curriculum, pack, catalog, registry } = await fixtures();
    authorSyntheticMorphologySequenceLength(catalog, registry, length);
    const result = validateCrossGameBindings(curriculum, pack, catalog, registry);
    assert.equal(result.valid, true, `${length} steps: ${JSON.stringify(result.errors, null, 2)}`);
    assert.equal(registry.exerciseSequences[0].orderedBindingIds.length, length);
  }
});

test("Word comprehension and Verb discrimination reject mismatched stage evidence", async () => {
  const { curriculum, pack, catalog, registry } = await fixtures();
  for (const [bindingId, mutate] of [
    [WORD_BINDING, (capability) => { capability.learningStage = "retrieve"; }],
    [VERB_BINDING, (capability) => { capability.evidenceKind = "retrieval"; }]
  ]) {
    const invalid = structuredClone(registry);
    const capability = invalid.bindings
      .find((binding) => binding.id === bindingId)
      .evidenceCapabilities[1];
    mutate(capability);
    const result = validateCrossGameBindings(curriculum, pack, catalog, invalid);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((entry) => (
      entry.code === "BIND_STAGE_EVIDENCE_MISMATCH"
        && entry.relatedIds.includes(bindingId)
        && entry.relatedIds.includes(capability.id)
    )));
  }
});

test("clean comprehension and discrimination are valid independent assessments but never mastery", async () => {
  const { curriculum, registry } = await fixtures();
  for (const [index, bindingId] of [WORD_BINDING, VERB_BINDING].entries()) {
    const task = taskFor(registry, {
      taskId: `task-clean-assessment-${index + 1}`,
      issuedAt: `2026-08-01T07:0${index}:00.000Z`,
      sessionId: "session-clean-assessment",
      taskSequence: index + 1,
      bindingId
    });
    const event = eventFor(task, {
      eventId: `event-clean-assessment-${index + 1}`,
      occurredAt: `2026-08-01T07:0${index}:30.000Z`,
      score: 1
    });
    const result = validateLearningEvidenceEvent(curriculum, registry, task, event);
    assert.equal(result.valid, true, JSON.stringify(result.errors, null, 2));
    assert.equal(result.qualifiesForIndependentAssessment, true);
    assert.equal(result.qualifiesForMastery, false);
  }
});

test("a bound opportunity cannot authorize the wrong evidence modality", async () => {
  const { curriculum, pack, catalog, registry } = await fixtures();
  const invalid = structuredClone(registry);
  const binding = invalid.bindings.find((row) => row.id === WORD_BINDING);
  binding.contextId = "cs.context.u3.read-library-current";
  binding.contextRevision = 1;
  binding.opportunityId = "read-library-current";

  const result = validateCrossGameBindings(curriculum, pack, catalog, invalid);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((entry) => entry.code === "BIND_CAPABILITY_OPPORTUNITY_MISMATCH"));
  assert.ok(result.errors.some((entry) => entry.code === "BIND_STAGE_OPPORTUNITY_MISMATCH"));
});

test("content revisions, digests, and the legacy Verb locator fail closed", async () => {
  const { curriculum, pack, catalog, registry } = await fixtures();
  const changedCatalog = structuredClone(catalog);
  changedCatalog.sources[0].snapshot.en = "A changed source sentence.";
  let result = validateCrossGameBindings(curriculum, pack, changedCatalog, registry);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((entry) => entry.code === "BIND_CONTENT_DIGEST_MISMATCH"));

  const staleRegistry = structuredClone(registry);
  staleRegistry.bindings[1].contentRef.revision = 3;
  result = validateCrossGameBindings(curriculum, pack, catalog, staleRegistry);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((entry) => entry.code === "BIND_CONTENT_REVISION_MISMATCH"));

  const reorderedDictionary = structuredClone(catalog);
  reorderedDictionary.sources[1].snapshot.legacyLocator.sourceIndex = 180;
  result = validateCrossGameBindings(curriculum, pack, reorderedDictionary, registry);
  assert.equal(result.valid, false);
  const codes = new Set(result.errors.map((entry) => entry.code));
  assert.ok(codes.has("BIND_LEGACY_LOCATOR_INVALID"));
  assert.ok(codes.has("BIND_CONTENT_DIGEST_MISMATCH"));
});

test("Word World focus selection must identify one exact playable token", async () => {
  const { curriculum, pack, catalog, registry } = await fixtures();
  const invalid = structuredClone(catalog);
  invalid.sources[0].snapshot.focusTarget.tokenIndex = 0;
  const result = validateCrossGameBindings(curriculum, pack, invalid, registry);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((entry) => entry.code === "BIND_WORD_TARGET_LOCATOR_INVALID"));
});

test("Verb Nebula contrasts must follow canonical English scope and exact target-skill mappings", async () => {
  const { curriculum, pack, catalog, registry } = await fixtures();
  const wrongOrder = structuredClone(catalog);
  const contrasts = wrongOrder.sources[1].snapshot.guidedContrasts;
  [contrasts[0], contrasts[1]] = [contrasts[1], contrasts[0]];
  wrongOrder.sources[1].contentDigest = computeContentDigest(wrongOrder.sources[1]);
  const wrongOrderRegistry = structuredClone(registry);
  wrongOrderRegistry.bindings[1].contentRef.contentDigest = wrongOrder.sources[1].contentDigest;
  let result = validateCrossGameBindings(curriculum, pack, wrongOrder, wrongOrderRegistry);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((entry) => entry.code === "BIND_VERB_CONTRAST_SCOPE_MISMATCH"));

  const wrongSkill = structuredClone(catalog);
  wrongSkill.sources[1].snapshot.guidedContrasts[0].targetSkillId = "cs.skill.sense.pit.drink";
  wrongSkill.sources[1].contentDigest = computeContentDigest(wrongSkill.sources[1]);
  const wrongSkillRegistry = structuredClone(registry);
  wrongSkillRegistry.bindings[1].contentRef.contentDigest = wrongSkill.sources[1].contentDigest;
  result = validateCrossGameBindings(curriculum, pack, wrongSkill, wrongSkillRegistry);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((entry) => entry.code === "BIND_VERB_CONTRAST_SKILL_MISMATCH"));
});

test("target-pack tampering invalidates the registry digest pin", async () => {
  const { curriculum, pack, catalog, registry } = await fixtures();
  const tamperedPack = structuredClone(pack);
  const skill = tamperedPack.skills.find((row) => row.id === "cs.skill.sense.cist.read");
  skill.descriptionEn = `${skill.descriptionEn} Tampered.`;

  const result = validateCrossGameBindings(curriculum, tamperedPack, catalog, registry);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((entry) => entry.code === "BIND_TARGET_PACK_DIGEST_MISMATCH"));
});

test("unknown contexts and non-matching opportunity utterances are rejected", async () => {
  const { curriculum, pack, catalog, registry } = await fixtures();
  const unknownContext = structuredClone(registry);
  unknownContext.bindings[0].contextId = "cs.context.unknown";
  let result = validateCrossGameBindings(curriculum, pack, catalog, unknownContext);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((entry) => entry.code === "BIND_CONTEXT_UNKNOWN"));

  const changedPack = structuredClone(pack);
  const utterance = changedPack.utterances.find((row) => row.id === "cs.utterance.dedecek-cte");
  utterance.text = "Dědeček spí.";
  const repinnedRegistry = structuredClone(registry);
  repinnedRegistry.targetPack.targetPackDigest = computeTargetPackDigest(changedPack);
  repinnedRegistry.bindings[0].contextId = "cs.context.u3.read-library-current";
  repinnedRegistry.bindings[0].contextRevision = 1;
  repinnedRegistry.bindings[0].opportunityId = "interpret-read-library-current";
  result = validateCrossGameBindings(curriculum, changedPack, catalog, repinnedRegistry);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((entry) => entry.code === "BIND_SOURCE_TEXT_MISMATCH"));
});

test("target skill revisions are pinned in bindings, groups, tasks, and evidence", async () => {
  const { curriculum, pack, catalog, registry } = await fixtures();
  const staleBinding = structuredClone(registry);
  staleBinding.bindings[0].targetSkillRefs[0].revision = 2;
  let result = validateCrossGameBindings(curriculum, pack, catalog, staleBinding);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((entry) => entry.code === "BIND_SKILL_REVISION_MISMATCH"));

  const staleGroup = structuredClone(registry);
  staleGroup.aggregationGroups[0].targetSkillRef.revision = 2;
  result = validateCrossGameBindings(curriculum, pack, catalog, staleGroup);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((entry) => entry.code === "BIND_SKILL_REVISION_MISMATCH"));

  const task = taskFor(registry, {
    taskId: "task-skill-revision-1",
    issuedAt: "2026-08-01T07:00:00.000Z",
    sessionId: "session-skill-revision",
    taskSequence: 1,
    bindingId: WORD_BINDING
  });
  const event = eventFor(task, {
    eventId: "event-skill-revision-1",
    occurredAt: "2026-08-01T07:01:00.000Z",
    score: 1
  });
  event.targetSkillRevision = 2;
  const evidenceResult = validateLearningEvidenceEvent(curriculum, registry, task, event);
  assert.equal(evidenceResult.valid, false);
  assert.ok(evidenceResult.errors.some((entry) => entry.code === "EVIDENCE_SKILL_REVISION_MISMATCH"));
});

test("an exposure capability can never claim mastery eligibility", async () => {
  const { curriculum, pack, catalog, registry } = await fixtures();
  const invalid = structuredClone(registry);
  invalid.bindings[0].evidenceCapabilities[0].masteryEligible = true;
  invalid.bindings[0].evidenceCapabilities[0].scoreRequired = true;
  invalid.bindings[0].evidenceCapabilities[0].minimumScore = 1;

  const result = validateCrossGameBindings(curriculum, pack, catalog, invalid);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((entry) => entry.code === "BIND_EXPOSURE_MASTERY_FORBIDDEN"));
});

test("forged task payloads and evidence fingerprints are rejected", async () => {
  const { curriculum, registry } = await fixtures();
  const task = taskFor(registry, {
    taskId: "task-fingerprint-word-1",
    issuedAt: "2026-08-01T07:30:00.000Z",
    sessionId: "session-fingerprint",
    taskSequence: 1,
    bindingId: WORD_BINDING
  });
  assert.equal(validateLearningTask(curriculum, registry, task).valid, true);

  const forgedTask = structuredClone(task);
  forgedTask.opportunityId = "forged-opportunity";
  const taskResult = validateLearningTask(curriculum, registry, forgedTask);
  assert.equal(taskResult.valid, false);
  const taskCodes = new Set(taskResult.errors.map((entry) => entry.code));
  assert.ok(taskCodes.has("TASK_FINGERPRINT_MISMATCH"));
  assert.ok(taskCodes.has("TASK_CONTEXT_MISMATCH"));

  const injectedTask = structuredClone(task);
  injectedTask.unboundMasteryCredit = 1;
  const injectedResult = validateLearningTask(curriculum, registry, injectedTask);
  assert.equal(injectedResult.valid, false);
  assert.ok(injectedResult.errors.some((entry) => entry.code === "TASK_SCHEMA"));

  const event = eventFor(task, {
    eventId: "event-fingerprint-word-1",
    occurredAt: "2026-08-01T07:31:00.000Z",
    score: 1
  });
  event.taskFingerprint = `sha256:${"f".repeat(64)}`;
  const evidenceResult = validateLearningEvidenceEvent(curriculum, registry, task, event);
  assert.equal(evidenceResult.valid, false);
  assert.ok(evidenceResult.errors.some((entry) => entry.code === "EVIDENCE_TASK_MISMATCH"));
});

test("clean comprehension and discrimination aggregate as assessed attempts without manufacturing mastery", async () => {
  const { curriculum, registry } = await fixtures();
  const tasks = [
    taskFor(registry, { taskId: "task-exposure-word-1", issuedAt: "2026-08-01T08:00:00.000Z", sessionId: "session-1", taskSequence: 1, bindingId: WORD_BINDING, capabilityId: "exposure" }),
    taskFor(registry, { taskId: "task-comprehension-word-1", issuedAt: "2026-08-01T08:01:00.000Z", sessionId: "session-1", taskSequence: 2, bindingId: WORD_BINDING }),
    taskFor(registry, { taskId: "task-discrimination-verb-1", issuedAt: "2026-08-01T08:02:00.000Z", sessionId: "session-1", taskSequence: 3, bindingId: VERB_BINDING }),
    taskFor(registry, { taskId: "task-comprehension-word-2", issuedAt: "2026-08-02T08:00:00.000Z", sessionId: "session-2", taskSequence: 1, bindingId: WORD_BINDING })
  ];
  const events = [
    eventFor(tasks[0], { eventId: "event-exposure-word-1", occurredAt: "2026-08-01T08:00:30.000Z", score: null }),
    eventFor(tasks[1], { eventId: "event-comprehension-word-1", occurredAt: "2026-08-01T08:01:30.000Z", score: 1 }),
    eventFor(tasks[2], { eventId: "event-discrimination-verb-1", occurredAt: "2026-08-01T08:02:30.000Z", score: 1 }),
    eventFor(tasks[3], { eventId: "event-comprehension-word-2", occurredAt: "2026-08-02T08:00:30.000Z", score: 1 })
  ];

  const [summary] = aggregateLearningEvidence(curriculum, registry, tasks, events);
  assert.equal(summary.exposureEvents, 1);
  assert.equal(summary.assessedAttempts, 3);
  assert.equal(summary.qualifyingIndependentEvidence, 0);
  assert.equal(summary.independentRetrievals, 0);
  assert.deepEqual(summary.contributingActivityIds, []);
  assert.deepEqual(summary.qualifyingSessionIds, []);
  assert.deepEqual(summary.qualifyingContextIds, []);
  assert.equal(summary.masteryReady, false);
  assert.ok(summary.masteryShortfalls.includes("independent-retrievals"));
  assert.ok(summary.masteryShortfalls.includes("sessions"));
  assert.ok(summary.masteryShortfalls.includes("distinct-contexts"));
  assert.ok(summary.masteryShortfalls.includes("production"));
  assert.ok(summary.masteryShortfalls.includes("transfer"));
});

test("revealed, hinted, and non-first responses cannot qualify", async () => {
  const { curriculum, registry } = await fixtures();
  const task = taskFor(registry, {
    taskId: "task-supported-word-1",
    issuedAt: "2026-08-01T09:00:00.000Z",
    sessionId: "session-supported",
    taskSequence: 1,
    bindingId: WORD_BINDING
  });
  const revealed = eventFor(task, {
    eventId: "event-supported-word-1",
    occurredAt: "2026-08-01T09:01:00.000Z",
    score: 1,
    solutionRevealed: true,
    hintsUsed: 1
  });
  let validation = validateLearningEvidenceEvent(curriculum, registry, task, revealed);
  assert.equal(validation.valid, true);
  assert.equal(validation.qualifiesForIndependentAssessment, false);
  assert.equal(validation.qualifiesForMastery, false);

  const correction = eventFor(task, {
    eventId: "event-supported-word-2",
    occurredAt: "2026-08-01T09:02:00.000Z",
    attemptNumber: 2,
    score: 1
  });
  validation = validateLearningEvidenceEvent(curriculum, registry, task, correction);
  assert.equal(validation.valid, true);
  assert.equal(validation.firstCleanResponse, false);
  assert.equal(validation.qualifiesForIndependentAssessment, false);
  assert.equal(validation.qualifiesForMastery, false);

  const [summary] = aggregateLearningEvidence(curriculum, registry, [task], [revealed, correction]);
  assert.equal(summary.assessedAttempts, 2);
  assert.equal(summary.qualifyingIndependentEvidence, 0);
});

test("a same-opportunity correction cannot resolve its first-response failure", async () => {
  const { curriculum, registry } = await fixtures();
  const task = taskFor(registry, {
    taskId: "task-failed-verb-1",
    issuedAt: "2026-08-01T09:10:00.000Z",
    sessionId: "session-failure",
    taskSequence: 1,
    bindingId: VERB_BINDING
  });
  const failed = eventFor(task, { eventId: "event-failed-verb-1", occurredAt: "2026-08-01T09:11:00.000Z", score: 0 });
  const corrected = eventFor(task, { eventId: "event-corrected-verb-1", occurredAt: "2026-08-01T09:12:00.000Z", attemptNumber: 2, score: 1 });

  const [summary] = aggregateLearningEvidence(curriculum, registry, [task], [failed, corrected]);
  assert.equal(summary.unresolvedRecentFailure, true);
  assert.equal(summary.unresolvedFailureTaskId, task.taskId);
  assert.equal(summary.qualifyingIndependentEvidence, 0);
});

test("a too-early same-session retry cannot repair failure, but the canonical gap can", async () => {
  const { curriculum, registry } = await fixtures();
  const failedTask = taskFor(registry, { taskId: "task-gap-failure-1", issuedAt: "2026-08-01T10:00:00.000Z", sessionId: "session-gap", taskSequence: 1, bindingId: VERB_BINDING });
  const earlyTask = taskFor(registry, { taskId: "task-gap-early-3", issuedAt: "2026-08-01T10:02:00.000Z", sessionId: "session-gap", taskSequence: 3, bindingId: VERB_BINDING });
  const validTask = taskFor(registry, { taskId: "task-gap-valid-4", issuedAt: "2026-08-01T10:04:00.000Z", sessionId: "session-gap", taskSequence: 4, bindingId: VERB_BINDING });
  const failed = eventFor(failedTask, { eventId: "event-gap-failure-1", occurredAt: "2026-08-01T10:01:00.000Z", score: 0 });
  const early = eventFor(earlyTask, { eventId: "event-gap-early-3", occurredAt: "2026-08-01T10:03:00.000Z", score: 1 });
  const valid = eventFor(validTask, { eventId: "event-gap-valid-4", occurredAt: "2026-08-01T10:05:00.000Z", score: 1 });

  let [summary] = aggregateLearningEvidence(curriculum, registry, [failedTask, earlyTask], [failed, early]);
  assert.equal(summary.unresolvedRecentFailure, true);
  assert.equal(summary.qualifyingIndependentEvidence, 0);

  [summary] = aggregateLearningEvidence(curriculum, registry, [failedTask, earlyTask, validTask], [failed, early, valid]);
  assert.equal(summary.unresolvedRecentFailure, false);
  assert.equal(summary.qualifyingIndependentEvidence, 0);
});

test("a clean task in a later session may repair the unresolved failure", async () => {
  const { curriculum, registry } = await fixtures();
  const failedTask = taskFor(registry, { taskId: "task-session-failure-1", issuedAt: "2026-08-01T11:00:00.000Z", sessionId: "session-a", taskSequence: 8, bindingId: VERB_BINDING });
  const laterTask = taskFor(registry, { taskId: "task-session-repair-1", issuedAt: "2026-08-02T11:00:00.000Z", sessionId: "session-b", taskSequence: 1, bindingId: VERB_BINDING });
  const failed = eventFor(failedTask, { eventId: "event-session-failure-1", occurredAt: "2026-08-01T11:01:00.000Z", score: 0 });
  const repaired = eventFor(laterTask, { eventId: "event-session-repair-1", occurredAt: "2026-08-02T11:01:00.000Z", score: 1 });

  const [summary] = aggregateLearningEvidence(curriculum, registry, [failedTask, laterTask], [failed, repaired]);
  assert.equal(summary.unresolvedRecentFailure, false);
  assert.equal(summary.qualifyingIndependentEvidence, 0);
});

test("evidence cannot rewrite bound content, context, opportunity, or task sequence", async () => {
  const { curriculum, registry } = await fixtures();
  const task = taskFor(registry, {
    taskId: "task-stale-word-1",
    issuedAt: "2026-08-01T12:00:00.000Z",
    sessionId: "session-stale",
    taskSequence: 1,
    bindingId: WORD_BINDING
  });
  const event = eventFor(task, {
    eventId: "event-stale-word-1",
    occurredAt: "2026-08-01T12:01:00.000Z",
    score: 1
  });
  event.contentRef.revision = 3;
  event.contextId = "cs.context.u3.read-home-current";
  event.opportunityId = "forged-opportunity";
  event.taskSequence = 2;
  const result = validateLearningEvidenceEvent(curriculum, registry, task, event);
  assert.equal(result.valid, false);
  const codes = new Set(result.errors.map((entry) => entry.code));
  assert.ok(codes.has("EVIDENCE_CONTENT_STALE"));
  assert.ok(codes.has("EVIDENCE_CONTEXT_MISMATCH"));
  assert.ok(codes.has("EVIDENCE_TASK_MISMATCH"));
});
