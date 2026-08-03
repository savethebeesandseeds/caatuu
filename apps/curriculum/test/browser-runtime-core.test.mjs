import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  aggregateLearningEvidence,
  computeBindingRegistryDigest,
  computeCanonicalContractDigest,
  computeContentDigest,
  computeLearningTaskFingerprint,
  computeSourceCatalogDigest,
  computeTargetPackDigest,
  createLearningEvidenceEvent,
  issueLearningTask,
  resolveRuntimeBinding,
  validateLearningEvidenceEvent,
  validateLearningTask,
  validateRuntimeBundle
} from "../runtime/curriculum-runtime-core.mjs";
import {
  computeContentDigest as computeNodeContentDigest,
  validateLearningEvidenceEvent as validateNodeLearningEvidenceEvent,
  validateLearningTask as validateNodeLearningTask
} from "../src/cross-game-binding-core.mjs";
import {
  computeCanonicalContractDigest as computeNodeCanonicalDigest,
  computeTargetPackDigest as computeNodeTargetPackDigest
} from "../src/validate-conformance.mjs";

const dataUrl = new URL("../data/", import.meta.url);
const WORD_BINDING = "binding.word-world.ww-cp-000146";
const VERB_BINDING = "binding.verb-nebula.cs.verb.cist.read";
const WORD_CAPABILITY = "independent-comprehension";
const VERB_CAPABILITY = "independent-discrimination";
const SKILL_ID = "cs.skill.sense.cist.read";

async function readJson(name) {
  return JSON.parse(await readFile(new URL(name, dataUrl), "utf8"));
}

async function fixture() {
  const [curriculum, targetPack, sourceCatalog, bindingRegistry] = await Promise.all([
    readJson("canonical-curriculum.v1.en.json"),
    readJson("cs-CZ.realization-pack.v1.json"),
    readJson("pilot-content-sources.v1.json"),
    readJson("cs-CZ.cross-game-bindings.v1.json")
  ]);
  const bundle = { curriculum, targetPack, sourceCatalog, bindingRegistry };
  const releasePins = {
    curriculumId: curriculum.curriculumId,
    curriculumVersion: curriculum.version,
    canonicalContractDigest: await computeCanonicalContractDigest(curriculum),
    targetPackId: targetPack.packId,
    targetPackVersion: targetPack.version,
    targetLocale: targetPack.targetLocale,
    targetPackDigest: await computeTargetPackDigest(targetPack),
    sourceCatalogId: sourceCatalog.catalogId,
    sourceCatalogVersion: sourceCatalog.version,
    sourceCatalogDigest: await computeSourceCatalogDigest(sourceCatalog),
    bindingRegistryId: bindingRegistry.registryId,
    bindingRegistryVersion: bindingRegistry.version,
    bindingRegistryDigest: await computeBindingRegistryDigest(bindingRegistry)
  };
  return { bundle, releasePins };
}

function evidence(task, {
  eventId,
  occurredAt,
  attemptNumber = 1,
  score,
  solutionRevealed = false,
  hintsUsed = 0
}) {
  return createLearningEvidenceEvent(task, {
    eventId,
    occurredAt,
    attemptNumber,
    score,
    solutionRevealed,
    hintsUsed
  });
}

test("the browser core reproduces authoritative curriculum, pack, and content digests", async () => {
  const { bundle } = await fixture();
  assert.equal(await computeCanonicalContractDigest(bundle.curriculum), computeNodeCanonicalDigest(bundle.curriculum));
  assert.equal(await computeTargetPackDigest(bundle.targetPack), computeNodeTargetPackDigest(bundle.targetPack));
  for (const source of bundle.sourceCatalog.sources) {
    assert.equal(await computeContentDigest(source), computeNodeContentDigest(source));
  }
});

test("runtime loading is fail-closed on four externally trusted artifact digests", async () => {
  const { bundle, releasePins } = await fixture();
  const valid = await validateRuntimeBundle(bundle, releasePins);
  assert.equal(valid.valid, true, JSON.stringify(valid.errors, null, 2));
  assert.deepEqual(valid.summary, {
    units: 3,
    targetSkills: 22,
    sources: 11,
    bindings: 11,
    exerciseSequences: 2
  });

  const changedRegistry = structuredClone(bundle);
  changedRegistry.bindingRegistry.bindings[0].evidenceCapabilities[1].minimumScore = 0.5;
  const registryResult = await validateRuntimeBundle(changedRegistry, releasePins);
  assert.equal(registryResult.valid, false);
  assert.ok(registryResult.errors.some((entry) => entry.code === "RUNTIME_RELEASE_PIN_MISMATCH"));

  const changedSource = structuredClone(bundle);
  changedSource.sourceCatalog.sources[0].snapshot.en = "Tampered meaning.";
  const sourceResult = await validateRuntimeBundle(changedSource, releasePins);
  assert.equal(sourceResult.valid, false);
  const sourceCodes = new Set(sourceResult.errors.map((entry) => entry.code));
  assert.ok(sourceCodes.has("RUNTIME_RELEASE_PIN_MISMATCH"));
  assert.ok(sourceCodes.has("RUNTIME_CONTENT_DIGEST_MISMATCH"));
});

test("the runtime resolves exact reviewed sources and semantic opportunities", async () => {
  const { bundle } = await fixture();
  const word = resolveRuntimeBinding(bundle, "word-world", "ww-cp-000146");
  assert.equal(word.source.snapshot.cs, "Dědeček čte.");
  assert.equal(word.source.snapshot.targets[1].surface, "čte");
  assert.deepEqual(word.source.snapshot.focusTarget, { surface: "čte", normalized: "čte", tokenIndex: 1 });
  assert.equal(word.context, null);
  assert.equal(word.opportunity, null);

  const verb = resolveRuntimeBinding(bundle, "verb-nebula", "cs.verb.cist.read");
  assert.equal(verb.source.snapshot.cz, "číst");
  assert.equal(verb.source.snapshot.legacyLocator.pairId, "core-verb-179");
  assert.deepEqual(
    verb.source.snapshot.guidedContrasts.map((contrast) => contrast.conceptId),
    ["concept.action.eat", "concept.action.drink", "concept.action.sleep"]
  );
  assert.equal(verb.context, null);
});

test("the browser runtime rejects Guided verb contrasts outside canonical English order", async () => {
  const { bundle, releasePins } = await fixture();
  const changed = structuredClone(bundle);
  const source = changed.sourceCatalog.sources.find((row) => row.activityId === "verb-nebula");
  [source.snapshot.guidedContrasts[0], source.snapshot.guidedContrasts[1]] = [
    source.snapshot.guidedContrasts[1],
    source.snapshot.guidedContrasts[0]
  ];
  source.contentDigest = await computeContentDigest(source);
  const binding = changed.bindingRegistry.bindings.find((row) => row.activityId === "verb-nebula");
  binding.contentRef.contentDigest = source.contentDigest;
  const repinned = {
    ...releasePins,
    sourceCatalogDigest: await computeSourceCatalogDigest(changed.sourceCatalog),
    bindingRegistryDigest: await computeBindingRegistryDigest(changed.bindingRegistry)
  };
  const result = await validateRuntimeBundle(changed, repinned);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((entry) => entry.code === "RUNTIME_VERB_CONTRAST_SCOPE_MISMATCH"));
});

test("the browser runtime rejects mismatched stage and evidence tuples", async () => {
  const { bundle, releasePins } = await fixture();
  for (const [bindingId, capabilityId, mutate] of [
    [WORD_BINDING, WORD_CAPABILITY, (capability) => { capability.learningStage = "retrieve"; }],
    [VERB_BINDING, VERB_CAPABILITY, (capability) => { capability.evidenceKind = "retrieval"; }]
  ]) {
    const changed = structuredClone(bundle);
    const binding = changed.bindingRegistry.bindings.find((row) => row.id === bindingId);
    const capability = binding.evidenceCapabilities.find((row) => row.id === capabilityId);
    mutate(capability);
    const repinned = {
      ...releasePins,
      bindingRegistryDigest: await computeBindingRegistryDigest(changed.bindingRegistry)
    };
    const result = await validateRuntimeBundle(changed, repinned);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((entry) => entry.code === "RUNTIME_STAGE_EVIDENCE_MISMATCH"));
  }
});

test("the browser runtime rejects an assessed stage on the wrong opportunity operation", async () => {
  const { bundle, releasePins } = await fixture();
  const changed = structuredClone(bundle);
  const binding = changed.bindingRegistry.bindings.find((row) => row.id === WORD_BINDING);
  binding.contextId = "cs.context.u3.read-library-current";
  binding.contextRevision = 1;
  binding.opportunityId = "read-library-current";
  const repinned = {
    ...releasePins,
    bindingRegistryDigest: await computeBindingRegistryDigest(changed.bindingRegistry)
  };

  const result = await validateRuntimeBundle(changed, repinned);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((entry) => entry.code === "RUNTIME_CAPABILITY_OPPORTUNITY_MISMATCH"));
  assert.ok(result.errors.some((entry) => entry.code === "RUNTIME_STAGE_OPPORTUNITY_MISMATCH"));
});

test("the browser runtime rejects target-pack reordering of the English sequence", async () => {
  const { bundle, releasePins } = await fixture();
  const changed = structuredClone(bundle);
  const unitBinding = changed.targetPack.unitBindings[0];
  [unitBinding.targetSkillIds[0], unitBinding.targetSkillIds[1]] = [
    unitBinding.targetSkillIds[1],
    unitBinding.targetSkillIds[0]
  ];
  const targetPackDigest = await computeTargetPackDigest(changed.targetPack);
  changed.bindingRegistry.targetPack.targetPackDigest = targetPackDigest;
  const repinned = {
    ...releasePins,
    targetPackDigest,
    bindingRegistryDigest: await computeBindingRegistryDigest(changed.bindingRegistry)
  };

  const result = await validateRuntimeBundle(changed, repinned);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((entry) => entry.code === "RUNTIME_TARGET_SKILL_ORDER_MISMATCH"));
});

test("tasks and evidence stay immutable and bound to the selected mechanic", async () => {
  const { bundle } = await fixture();
  const task = await issueLearningTask(bundle.bindingRegistry, {
    taskId: "task-runtime-word-1",
    issuedAt: "2026-08-01T10:00:00.000Z",
    sessionId: "session-runtime-1",
    taskSequence: 1,
    bindingId: WORD_BINDING,
    capabilityId: WORD_CAPABILITY,
    targetSkillId: SKILL_ID
  });
  const taskValidation = await validateLearningTask(bundle.curriculum, bundle.bindingRegistry, task);
  assert.equal(taskValidation.valid, true, JSON.stringify(taskValidation.errors, null, 2));
  assert.equal(task.learningStage, "comprehend");
  assert.equal(task.evidenceKind, "comprehension");

  const event = evidence(task, {
    eventId: "event-runtime-word-1",
    occurredAt: "2026-08-01T10:01:00.000Z",
    score: 1
  });
  const eventValidation = await validateLearningEvidenceEvent(bundle.curriculum, bundle.bindingRegistry, task, event);
  assert.equal(eventValidation.valid, true, JSON.stringify(eventValidation.errors, null, 2));
  assert.equal(eventValidation.qualifiesForIndependentAssessment, true);
  assert.equal(eventValidation.qualifiesForMastery, false);

  const verbTask = await issueLearningTask(bundle.bindingRegistry, {
    taskId: "task-runtime-verb-1",
    issuedAt: "2026-08-01T10:02:00.000Z",
    sessionId: "session-runtime-1",
    taskSequence: 2,
    bindingId: VERB_BINDING,
    capabilityId: VERB_CAPABILITY,
    targetSkillId: SKILL_ID
  });
  const verbEvent = evidence(verbTask, {
    eventId: "event-runtime-verb-1",
    occurredAt: "2026-08-01T10:03:00.000Z",
    score: 1
  });
  const verbValidation = await validateLearningEvidenceEvent(
    bundle.curriculum,
    bundle.bindingRegistry,
    verbTask,
    verbEvent
  );
  assert.equal(verbTask.learningStage, "discriminate");
  assert.equal(verbTask.evidenceKind, "comprehension");
  assert.equal(verbValidation.valid, true, JSON.stringify(verbValidation.errors, null, 2));
  assert.equal(verbValidation.qualifiesForIndependentAssessment, true);
  assert.equal(verbValidation.qualifiesForMastery, false);

  const forged = structuredClone(task);
  forged.contextId = "cs.context.forged";
  const forgedValidation = await validateLearningTask(bundle.curriculum, bundle.bindingRegistry, forged);
  assert.equal(forgedValidation.valid, false);
  const codes = new Set(forgedValidation.errors.map((entry) => entry.code));
  assert.ok(codes.has("TASK_FINGERPRINT_MISMATCH"));
  assert.ok(codes.has("TASK_CONTEXT_MISMATCH"));
});

test("explicit registry compatibility preserves unchanged older tasks and rejects undeclared releases", async () => {
  const { bundle } = await fixture();
  const task = await issueLearningTask(bundle.bindingRegistry, {
    taskId: "task-runtime-compatible-registry-1",
    issuedAt: "2026-08-01T10:00:00.000Z",
    sessionId: "session-runtime-compatible-registry",
    taskSequence: 1,
    bindingId: WORD_BINDING,
    capabilityId: WORD_CAPABILITY,
    targetSkillId: SKILL_ID
  });
  task.registry.version = "1.6.0";
  task.taskFingerprint = await computeLearningTaskFingerprint(task);

  const browserCompatible = await validateLearningTask(
    bundle.curriculum,
    bundle.bindingRegistry,
    task
  );
  const authoringCompatible = validateNodeLearningTask(
    bundle.curriculum,
    bundle.bindingRegistry,
    task
  );
  assert.equal(browserCompatible.valid, true, JSON.stringify(browserCompatible.errors, null, 2));
  assert.equal(authoringCompatible.valid, true, JSON.stringify(authoringCompatible.errors, null, 2));

  const incompatibleRegistry = structuredClone(bundle.bindingRegistry);
  incompatibleRegistry.compatibleTaskRegistryVersions = [];
  const rejected = await validateLearningTask(bundle.curriculum, incompatibleRegistry, task);
  assert.equal(rejected.valid, false);
  assert.ok(rejected.errors.some(({ code }) => code === "TASK_REGISTRY_MISMATCH"));
});

test("browser task and evidence validation rejects every field the authoring contract rejects", async () => {
  const { bundle } = await fixture();
  const task = await issueLearningTask(bundle.bindingRegistry, {
    taskId: "task-runtime-parity-1",
    issuedAt: "2026-08-01T10:00:00.000Z",
    sessionId: "session-runtime-parity",
    taskSequence: 1,
    bindingId: WORD_BINDING,
    capabilityId: WORD_CAPABILITY,
    targetSkillId: SKILL_ID
  });
  for (const mutate of [
    (changed) => { changed.untrusted = true; },
    (changed) => { changed.registry.untrusted = true; },
    (changed) => { changed.taskId = ""; },
    (changed) => { changed.issuedAt = "not-a-time"; },
    (changed) => { changed.taskSequence = 0; },
    (changed) => {
      changed.canonicalUnitId = bundle.curriculum.unitOrder[0];
      changed.canonicalUnitRevision = bundle.curriculum.units.find((unit) => unit.id === changed.canonicalUnitId).revision;
    }
  ]) {
    const changed = structuredClone(task);
    mutate(changed);
    changed.taskFingerprint = await computeLearningTaskFingerprint(changed);
    const browserResult = await validateLearningTask(bundle.curriculum, bundle.bindingRegistry, changed);
    const authoringResult = validateNodeLearningTask(bundle.curriculum, bundle.bindingRegistry, changed);
    assert.equal(browserResult.valid, false);
    assert.equal(authoringResult.valid, false);
  }

  const event = createLearningEvidenceEvent(task, {
    eventId: "event-runtime-parity-1",
    occurredAt: "2026-08-01T10:01:00.000Z",
    attemptNumber: 1,
    score: 1,
    solutionRevealed: false,
    hintsUsed: 0
  });
  for (const mutate of [
    (changed) => { changed.untrusted = true; },
    (changed) => { changed.registry.untrusted = true; },
    (changed) => { changed.outcome.untrusted = true; },
    (changed) => { changed.sessionId = ""; },
    (changed) => { changed.occurredAt = "not-a-time"; },
    (changed) => { changed.taskSequence = 0; }
  ]) {
    const changed = structuredClone(event);
    mutate(changed);
    const browserResult = await validateLearningEvidenceEvent(
      bundle.curriculum,
      bundle.bindingRegistry,
      task,
      changed
    );
    const authoringResult = validateNodeLearningEvidenceEvent(
      bundle.curriculum,
      bundle.bindingRegistry,
      task,
      changed
    );
    assert.equal(browserResult.valid, false);
    assert.equal(authoringResult.valid, false);
  }
});

test("both games retain assessed attempts while comprehension and discrimination remain outside mastery", async () => {
  const { bundle } = await fixture();
  const requests = [
    ["word-exposure", WORD_BINDING, "exposure", "session-a", 1],
    ["word-comprehension", WORD_BINDING, WORD_CAPABILITY, "session-a", 2],
    ["verb-revealed", VERB_BINDING, VERB_CAPABILITY, "session-a", 3],
    ["verb-discrimination", VERB_BINDING, VERB_CAPABILITY, "session-b", 1]
  ];
  const tasks = [];
  for (const [taskId, bindingId, capabilityId, sessionId, taskSequence] of requests) {
    tasks.push(await issueLearningTask(bundle.bindingRegistry, {
      taskId,
      issuedAt: `2026-08-0${sessionId === "session-a" ? "1" : "2"}T10:00:00.000Z`,
      sessionId,
      taskSequence,
      bindingId,
      capabilityId,
      targetSkillId: SKILL_ID
    }));
  }
  const events = [
    evidence(tasks[0], { eventId: "exposure", occurredAt: "2026-08-01T10:00:10.000Z", score: null }),
    evidence(tasks[1], { eventId: "word-clean", occurredAt: "2026-08-01T10:01:00.000Z", score: 1 }),
    evidence(tasks[2], { eventId: "verb-reveal", occurredAt: "2026-08-01T10:02:00.000Z", score: 1, solutionRevealed: true }),
    evidence(tasks[3], { eventId: "verb-clean", occurredAt: "2026-08-02T10:01:00.000Z", score: 1 })
  ];
  const summaries = await aggregateLearningEvidence(bundle.curriculum, bundle.bindingRegistry, tasks, events);
  assert.equal(summaries.length, 1);
  const summary = summaries[0];
  assert.equal(summary.exposureEvents, 1);
  assert.equal(summary.assessedAttempts, 3);
  assert.equal(summary.independentRetrievals, 0);
  assert.deepEqual(summary.contributingActivityIds, []);
  assert.deepEqual(summary.qualifyingSessionIds, []);
  assert.deepEqual(summary.qualifyingContextIds, []);
  assert.equal(summary.masteryReady, false);
  assert.ok(summary.masteryShortfalls.includes("independent-retrievals"));
  assert.ok(summary.masteryShortfalls.includes("sessions"));
  assert.ok(summary.masteryShortfalls.includes("production"));
  assert.ok(summary.masteryShortfalls.includes("transfer"));
  assert.ok(summary.masteryShortfalls.includes("distinct-contexts"));
});

test("a non-mastery failure clears only after a spaced clean assessment in the same stage", async () => {
  const { bundle } = await fixture();
  const requests = [
    ["word-failure", WORD_BINDING, WORD_CAPABILITY, "session-a"],
    ["verb-other-stage", VERB_BINDING, VERB_CAPABILITY, "session-b"],
    ["word-repair", WORD_BINDING, WORD_CAPABILITY, "session-c"]
  ];
  const tasks = [];
  for (const [taskId, bindingId, capabilityId, sessionId] of requests) {
    tasks.push(await issueLearningTask(bundle.bindingRegistry, {
      taskId,
      issuedAt: `2026-08-0${tasks.length + 1}T10:00:00.000Z`,
      sessionId,
      taskSequence: 1,
      bindingId,
      capabilityId,
      targetSkillId: SKILL_ID
    }));
  }
  const events = [
    evidence(tasks[0], { eventId: "word-failed", occurredAt: "2026-08-01T10:01:00.000Z", score: 0 }),
    evidence(tasks[1], { eventId: "verb-clean-other-stage", occurredAt: "2026-08-02T10:01:00.000Z", score: 1 }),
    evidence(tasks[2], { eventId: "word-clean-repair", occurredAt: "2026-08-03T10:01:00.000Z", score: 1 })
  ];

  let [summary] = await aggregateLearningEvidence(
    bundle.curriculum,
    bundle.bindingRegistry,
    tasks.slice(0, 2),
    events.slice(0, 2)
  );
  assert.equal(summary.unresolvedRecentFailure, true);
  [summary] = await aggregateLearningEvidence(bundle.curriculum, bundle.bindingRegistry, tasks, events);
  assert.equal(summary.unresolvedRecentFailure, false);
  assert.equal(summary.independentRetrievals, 0);
});

test("changed-payload reuse of a task or event ID fails idempotently", async () => {
  const { bundle } = await fixture();
  const task = await issueLearningTask(bundle.bindingRegistry, {
    taskId: "task-idempotent",
    issuedAt: "2026-08-01T10:00:00.000Z",
    sessionId: "session-idempotent",
    taskSequence: 1,
    bindingId: WORD_BINDING,
    capabilityId: WORD_CAPABILITY,
    targetSkillId: SKILL_ID
  });
  const event = evidence(task, {
    eventId: "event-idempotent",
    occurredAt: "2026-08-01T10:01:00.000Z",
    score: 1
  });
  const changedTask = structuredClone(task);
  changedTask.taskFingerprint = task.taskFingerprint;
  changedTask.mechanicId = "forged-mechanic";
  await assert.rejects(
    () => aggregateLearningEvidence(bundle.curriculum, bundle.bindingRegistry, [task, changedTask], [event]),
    (error) => ["TASK_FINGERPRINT_MISMATCH", "TASK_CAPABILITY_MISMATCH", "TASK_ID_CONFLICT"].includes(error.code)
  );

  const changedEvent = structuredClone(event);
  changedEvent.outcome.score = 0;
  await assert.rejects(
    () => aggregateLearningEvidence(bundle.curriculum, bundle.bindingRegistry, [task], [event, changedEvent]),
    (error) => error.code === "EVIDENCE_ID_CONFLICT"
  );
});
