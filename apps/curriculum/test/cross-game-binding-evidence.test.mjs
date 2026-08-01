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

function taskFor(registry, {
  taskId,
  issuedAt,
  sessionId,
  taskSequence,
  bindingId,
  capabilityId = "independent-retrieval"
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
  assert.deepEqual(result.summary.activities, ["verb-nebula", "word-world"]);
  assert.equal(result.summary.bindings, 2);

  const word = catalog.sources.find((source) => source.contentId === "ww-cp-000146");
  const verb = catalog.sources.find((source) => source.contentId === "cs.verb.cist.read");
  assert.equal(word.snapshot.cs, "Dědeček čte.");
  assert.equal(word.snapshot.en, "Grandpa is reading.");
  assert.equal(verb.snapshot.id, "cs.verb.cist.read");
  assert.equal(verb.snapshot.cz, "číst");
  assert.equal(verb.snapshot.eng, "read");
  assert.deepEqual(verb.snapshot.legacyLocator, { pairId: "core-verb-179", sourceIndex: 179 });
  assert.equal(computeContentDigest(word), word.contentDigest);
  assert.equal(computeContentDigest(verb), verb.contentDigest);

  const wordBinding = registry.bindings.find((binding) => binding.id === WORD_BINDING);
  const verbBinding = registry.bindings.find((binding) => binding.id === VERB_BINDING);
  assert.equal(wordBinding.contextId, "cs.context.u3.read-library-current");
  assert.equal(wordBinding.contextRevision, 1);
  assert.equal(wordBinding.opportunityId, "interpret-read-library-current");
  assert.equal(verbBinding.contextId, null);
  assert.equal(verbBinding.opportunityId, null);

  const context = pack.contexts.find((row) => row.id === wordBinding.contextId);
  const opportunity = context.opportunities.find((row) => row.id === wordBinding.opportunityId);
  const evidenceUtterances = [...opportunity.stimulusUtteranceIds, ...opportunity.expectedUtteranceIds]
    .map((id) => pack.utterances.find((row) => row.id === id));
  assert.ok(evidenceUtterances.some((utterance) => utterance.text === word.snapshot.cs));
  assert.equal(opportunity.operation, "interpret");
});

test("a bound opportunity cannot authorize the wrong evidence modality", async () => {
  const { curriculum, pack, catalog, registry } = await fixtures();
  const invalid = structuredClone(registry);
  const binding = invalid.bindings.find((row) => row.id === WORD_BINDING);
  binding.opportunityId = "read-library-current";

  const result = validateCrossGameBindings(curriculum, pack, catalog, invalid);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((entry) => entry.code === "BIND_CAPABILITY_OPPORTUNITY_MISMATCH"));
});

test("content revisions, digests, and the legacy Verb locator fail closed", async () => {
  const { curriculum, pack, catalog, registry } = await fixtures();
  const changedCatalog = structuredClone(catalog);
  changedCatalog.sources[0].snapshot.en = "A changed source sentence.";
  let result = validateCrossGameBindings(curriculum, pack, changedCatalog, registry);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((entry) => entry.code === "BIND_CONTENT_DIGEST_MISMATCH"));

  const staleRegistry = structuredClone(registry);
  staleRegistry.bindings[1].contentRef.revision = 2;
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

test("exposure is excluded while first clean evidence aggregates across both games", async () => {
  const { curriculum, registry } = await fixtures();
  const tasks = [
    taskFor(registry, { taskId: "task-exposure-word-1", issuedAt: "2026-08-01T08:00:00.000Z", sessionId: "session-1", taskSequence: 1, bindingId: WORD_BINDING, capabilityId: "exposure" }),
    taskFor(registry, { taskId: "task-retrieval-word-1", issuedAt: "2026-08-01T08:01:00.000Z", sessionId: "session-1", taskSequence: 2, bindingId: WORD_BINDING }),
    taskFor(registry, { taskId: "task-retrieval-verb-1", issuedAt: "2026-08-01T08:02:00.000Z", sessionId: "session-1", taskSequence: 3, bindingId: VERB_BINDING }),
    taskFor(registry, { taskId: "task-retrieval-word-2", issuedAt: "2026-08-02T08:00:00.000Z", sessionId: "session-2", taskSequence: 1, bindingId: WORD_BINDING })
  ];
  const events = [
    eventFor(tasks[0], { eventId: "event-exposure-word-1", occurredAt: "2026-08-01T08:00:30.000Z", score: null }),
    eventFor(tasks[1], { eventId: "event-retrieval-word-1", occurredAt: "2026-08-01T08:01:30.000Z", score: 1 }),
    eventFor(tasks[2], { eventId: "event-retrieval-verb-1", occurredAt: "2026-08-01T08:02:30.000Z", score: 1 }),
    eventFor(tasks[3], { eventId: "event-retrieval-word-2", occurredAt: "2026-08-02T08:00:30.000Z", score: 1 })
  ];

  const [summary] = aggregateLearningEvidence(curriculum, registry, tasks, events);
  assert.equal(summary.exposureEvents, 1);
  assert.equal(summary.qualifyingIndependentEvidence, 3);
  assert.equal(summary.independentRetrievals, 3);
  assert.deepEqual(summary.contributingActivityIds, ["verb-nebula", "word-world"]);
  assert.deepEqual(summary.qualifyingSessionIds, ["session-1", "session-2"]);
  assert.deepEqual(summary.qualifyingContextIds, ["cs.context.u3.read-library-current"]);
  assert.equal(summary.masteryReady, false);
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
  assert.equal(summary.qualifyingIndependentEvidence, 1);

  [summary] = aggregateLearningEvidence(curriculum, registry, [failedTask, earlyTask, validTask], [failed, early, valid]);
  assert.equal(summary.unresolvedRecentFailure, false);
  assert.equal(summary.qualifyingIndependentEvidence, 2);
});

test("a clean task in a later session may repair the unresolved failure", async () => {
  const { curriculum, registry } = await fixtures();
  const failedTask = taskFor(registry, { taskId: "task-session-failure-1", issuedAt: "2026-08-01T11:00:00.000Z", sessionId: "session-a", taskSequence: 8, bindingId: VERB_BINDING });
  const laterTask = taskFor(registry, { taskId: "task-session-repair-1", issuedAt: "2026-08-02T11:00:00.000Z", sessionId: "session-b", taskSequence: 1, bindingId: VERB_BINDING });
  const failed = eventFor(failedTask, { eventId: "event-session-failure-1", occurredAt: "2026-08-01T11:01:00.000Z", score: 0 });
  const repaired = eventFor(laterTask, { eventId: "event-session-repair-1", occurredAt: "2026-08-02T11:01:00.000Z", score: 1 });

  const [summary] = aggregateLearningEvidence(curriculum, registry, [failedTask, laterTask], [failed, repaired]);
  assert.equal(summary.unresolvedRecentFailure, false);
  assert.equal(summary.qualifyingIndependentEvidence, 1);
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
  event.contentRef.revision = 2;
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
