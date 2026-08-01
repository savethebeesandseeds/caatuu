import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  aggregateLearningEvidence,
  computeBindingRegistryDigest,
  computeCanonicalContractDigest,
  computeContentDigest,
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
  computeContentDigest as computeNodeContentDigest
} from "../src/cross-game-binding-core.mjs";
import {
  computeCanonicalContractDigest as computeNodeCanonicalDigest,
  computeTargetPackDigest as computeNodeTargetPackDigest
} from "../src/validate-conformance.mjs";

const dataUrl = new URL("../data/", import.meta.url);
const WORD_BINDING = "binding.word-world.ww-cp-000146";
const VERB_BINDING = "binding.verb-nebula.cs.verb.cist.read";
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
  assert.deepEqual(valid.summary, { units: 3, targetSkills: 20, sources: 2, bindings: 2 });

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
  assert.equal(word.context.id, "cs.context.u3.read-library-current");
  assert.equal(word.opportunity.id, "interpret-read-library-current");
  assert.equal(word.opportunity.operation, "interpret");

  const verb = resolveRuntimeBinding(bundle, "verb-nebula", "cs.verb.cist.read");
  assert.equal(verb.source.snapshot.cz, "číst");
  assert.equal(verb.source.snapshot.legacyLocator.pairId, "core-verb-179");
  assert.equal(verb.context, null);
});

test("tasks and evidence stay immutable and bound to the selected mechanic", async () => {
  const { bundle } = await fixture();
  const task = await issueLearningTask(bundle.bindingRegistry, {
    taskId: "task-runtime-word-1",
    issuedAt: "2026-08-01T10:00:00.000Z",
    sessionId: "session-runtime-1",
    taskSequence: 1,
    bindingId: WORD_BINDING,
    capabilityId: "independent-retrieval",
    targetSkillId: SKILL_ID
  });
  const taskValidation = await validateLearningTask(bundle.curriculum, bundle.bindingRegistry, task);
  assert.equal(taskValidation.valid, true, JSON.stringify(taskValidation.errors, null, 2));

  const event = evidence(task, {
    eventId: "event-runtime-word-1",
    occurredAt: "2026-08-01T10:01:00.000Z",
    score: 1
  });
  const eventValidation = await validateLearningEvidenceEvent(bundle.curriculum, bundle.bindingRegistry, task, event);
  assert.equal(eventValidation.valid, true, JSON.stringify(eventValidation.errors, null, 2));
  assert.equal(eventValidation.qualifiesForMastery, true);

  const forged = structuredClone(task);
  forged.contextId = "cs.context.forged";
  const forgedValidation = await validateLearningTask(bundle.curriculum, bundle.bindingRegistry, forged);
  assert.equal(forgedValidation.valid, false);
  const codes = new Set(forgedValidation.errors.map((entry) => entry.code));
  assert.ok(codes.has("TASK_FINGERPRINT_MISMATCH"));
  assert.ok(codes.has("TASK_CONTEXT_MISMATCH"));
});

test("both games aggregate honestly while exposure, reveal, and hints remain outside mastery", async () => {
  const { bundle } = await fixture();
  const requests = [
    ["word-exposure", WORD_BINDING, "exposure", "session-a", 1],
    ["word-retrieval", WORD_BINDING, "independent-retrieval", "session-a", 2],
    ["verb-revealed", VERB_BINDING, "independent-retrieval", "session-a", 3],
    ["verb-clean", VERB_BINDING, "independent-retrieval", "session-b", 1]
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
  assert.equal(summary.independentRetrievals, 2);
  assert.deepEqual(summary.contributingActivityIds, ["verb-nebula", "word-world"]);
  assert.deepEqual(summary.qualifyingSessionIds, ["session-a", "session-b"]);
  assert.deepEqual(summary.qualifyingContextIds, ["cs.context.u3.read-library-current"]);
  assert.equal(summary.masteryReady, false);
  assert.ok(summary.masteryShortfalls.includes("production"));
  assert.ok(summary.masteryShortfalls.includes("transfer"));
  assert.ok(summary.masteryShortfalls.includes("distinct-contexts"));
});

test("changed-payload reuse of a task or event ID fails idempotently", async () => {
  const { bundle } = await fixture();
  const task = await issueLearningTask(bundle.bindingRegistry, {
    taskId: "task-idempotent",
    issuedAt: "2026-08-01T10:00:00.000Z",
    sessionId: "session-idempotent",
    taskSequence: 1,
    bindingId: WORD_BINDING,
    capabilityId: "independent-retrieval",
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
