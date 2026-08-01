import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createCurriculumService } from "../runtime/curriculum-service.mjs";
import {
  computeBindingRegistryDigest,
  computeCanonicalContractDigest,
  computeSourceCatalogDigest,
  computeTargetPackDigest
} from "../runtime/curriculum-runtime-core.mjs";

const dataUrl = new URL("../data/", import.meta.url);
const paths = {
  canonicalManifest: "/curriculum/canonical.json",
  realizationPack: "/curriculum/pack.json",
  sourceCatalog: "/curriculum/sources.json",
  bindingRegistry: "/curriculum/bindings.json"
};

class MemoryStorage {
  #values = new Map();

  getItem(key) {
    return this.#values.has(key) ? this.#values.get(key) : null;
  }

  setItem(key, value) {
    this.#values.set(String(key), String(value));
  }
}

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
  const assets = new Map([
    [paths.canonicalManifest, curriculum],
    [paths.realizationPack, targetPack],
    [paths.sourceCatalog, sourceCatalog],
    [paths.bindingRegistry, bindingRegistry]
  ]);
  const fetchImpl = async (path) => ({
    ok: assets.has(path),
    status: assets.has(path) ? 200 : 404,
    json: async () => structuredClone(assets.get(path))
  });
  const courseProfile = {
    id: "cz",
    storage: { namespace: "caatuu-czech-test" },
    curriculum: {
      paths,
      releasePins,
      guidedMode: {
        enabled: true,
        developerOnly: true,
        developerQueryParameter: "curriculum-guided"
      }
    }
  };
  return { courseProfile, fetchImpl };
}

function serviceOptions(base, overrides = {}) {
  let id = 0;
  return {
    courseProfile: base.courseProfile,
    fetchImpl: base.fetchImpl,
    localStorage: new MemoryStorage(),
    sessionStorage: new MemoryStorage(),
    location: { hostname: "localhost", search: "?curriculum-guided=1" },
    now: () => "2026-08-01T10:00:00.000Z",
    uuid: () => `uuid-${++id}`,
    ...overrides
  };
}

test("the service loads four pinned assets and exposes only explicit loopback Guided mode", async () => {
  const base = await fixture();
  const service = createCurriculumService(serviceOptions(base));
  const ready = await service.ready();
  assert.equal(ready.status, "ready");
  assert.equal(ready.guidedModeEnabled, true);
  assert.equal(service.snapshot().storedTaskCount, 0);

  const word = await service.resolveBinding("word-world", "ww-cp-000146");
  assert.equal(word.opportunity.operation, "interpret");
  assert.equal(word.source.snapshot.targets[1].surface, "čte");

  const remote = createCurriculumService(serviceOptions(base, {
    location: { hostname: "learn.example.test", search: "?curriculum-guided=1" }
  }));
  await remote.ready();
  assert.equal(remote.guidedModeEnabled(), false);
  await assert.rejects(
    () => remote.issueTask("binding.word-world.ww-cp-000146", "exposure"),
    (error) => error.code === "CURRICULUM_GUIDED_MODE_DISABLED"
  );

  const accidentallyPublicProfile = structuredClone(base.courseProfile);
  accidentallyPublicProfile.curriculum.guidedMode.developerOnly = false;
  const unapprovedPublic = createCurriculumService(serviceOptions({
    ...base,
    courseProfile: accidentallyPublicProfile
  }, {
    location: { hostname: "learn.example.test", search: "?curriculum-guided=1" }
  }));
  await unapprovedPublic.ready();
  assert.equal(unapprovedPublic.guidedModeEnabled(), false);
});

test("the service exposes canonical progression without promoting the Unit 3 developer pilot", async () => {
  const base = await fixture();
  const service = createCurriculumService(serviceOptions(base));
  await service.ready();

  const progression = await service.progression();
  assert.equal(progression.status, "blocked");
  assert.equal(progression.activeUnitId, "unit.interaction.entry-and-repair.01");
  assert.ok(progression.nextRequest.reasons.every((entry) => entry.code === "stage-capability-unavailable"));
  const unitThree = progression.units.find((unit) => unit.canonicalUnitId === "unit.routine.familiar-actions.01");
  assert.equal(unitThree.status, "locked");
  assert.ok(unitThree.blockers.some((entry) => entry.code === "unit-prerequisite-unmet"));
  const unitThreeCoverage = progression.developerDiagnostics.mechanicCoverage.find((unit) => (
    unit.canonicalUnitId === "unit.routine.familiar-actions.01"
  ));
  assert.ok(unitThreeCoverage.coveredStageSlotCount > 0);
  assert.deepEqual(await service.nextRequest(), progression.nextRequest);
});

test("issued tasks and idempotent evidence persist across service reloads", async () => {
  const base = await fixture();
  const localStorage = new MemoryStorage();
  const sessionStorage = new MemoryStorage();
  let id = 0;
  const shared = serviceOptions(base, {
    localStorage,
    sessionStorage,
    uuid: () => `persist-${++id}`
  });
  const service = createCurriculumService(shared);
  await service.ready();

  await service.recordExposure("binding.word-world.ww-cp-000146", { targetSkillId: "cs.skill.sense.cist.read" });
  const wordTask = await service.issueTask("binding.word-world.ww-cp-000146", "independent-retrieval", {
    targetSkillId: "cs.skill.sense.cist.read"
  });
  const wordResult = await service.recordEvidence(wordTask, {
    occurredAt: "2026-08-01T10:01:00.000Z",
    attemptNumber: 1,
    score: 1
  });
  assert.equal(wordResult.qualifiesForMastery, true);
  const repeated = await service.recordEvidence(wordTask, {
    occurredAt: "2026-08-01T10:01:00.000Z",
    attemptNumber: 1,
    score: 1
  });
  assert.equal(repeated.event.eventId, wordResult.event.eventId);
  await assert.rejects(
    () => service.recordEvidence(wordTask, {
      occurredAt: "2026-08-01T10:01:00.000Z",
      attemptNumber: 1,
      score: 0
    }),
    (error) => error.code === "EVIDENCE_ID_CONFLICT"
  );

  const verbTask = await service.issueTask("binding.verb-nebula.cs.verb.cist.read", "independent-retrieval", {
    targetSkillId: "cs.skill.sense.cist.read"
  });
  await service.recordEvidence(verbTask, {
    occurredAt: "2026-08-01T10:02:00.000Z",
    attemptNumber: 1,
    score: 1
  });
  const summary = await service.skillSummary("cs.skill.sense.cist.read");
  assert.deepEqual(summary.contributingActivityIds, ["verb-nebula", "word-world"]);
  assert.equal(summary.masteryReady, false);
  assert.ok(summary.masteryShortfalls.includes("production"));

  const reloaded = createCurriculumService(shared);
  await reloaded.ready();
  assert.equal(reloaded.snapshot().storedTaskCount, 3);
  assert.equal(reloaded.snapshot().storedEventCount, 3);
  assert.deepEqual(await reloaded.skillSummary("cs.skill.sense.cist.read"), summary);
});

test("revealed or hinted responses remain valid practice but never qualify", async () => {
  const base = await fixture();
  const service = createCurriculumService(serviceOptions(base));
  await service.ready();
  const task = await service.issueTask("binding.verb-nebula.cs.verb.cist.read", "independent-retrieval", {
    targetSkillId: "cs.skill.sense.cist.read"
  });
  const result = await service.recordEvidence(task, {
    occurredAt: "2026-08-01T10:01:00.000Z",
    attemptNumber: 1,
    score: 1,
    solutionRevealed: true,
    hintsUsed: 1
  });
  assert.equal(result.qualifiesForMastery, false);
  assert.equal(result.skillSummary.independentRetrievals, 0);
});

test("a guided opportunity keeps hints and the first response attached to one immutable task", async () => {
  const base = await fixture();
  const service = createCurriculumService(serviceOptions(base));
  await service.ready();
  const opportunity = await service.beginOpportunity("word-world", "ww-cp-000146", {
    targetSkillId: "cs.skill.sense.cist.read"
  });

  assert.equal(opportunity.resolution.binding.id, "binding.word-world.ww-cp-000146");
  assert.equal(opportunity.task.contentRef.contentId, "ww-cp-000146");
  assert.equal(opportunity.state().firstResponseRecorded, false);
  const exposure = await opportunity.recordExposure();
  assert.equal(exposure.event.capabilityId, "exposure");

  opportunity.markHint();
  const result = await opportunity.recordFirstResponse({
    score: 1,
    occurredAt: "2026-08-01T10:03:00.000Z"
  });
  assert.equal(result.event.outcome.hintsUsed, 1);
  assert.equal(result.qualifiesForMastery, false);
  assert.equal(opportunity.state().firstResponseRecorded, true);
  assert.throws(
    () => opportunity.markHint(),
    (error) => error.code === "CURRICULUM_OPPORTUNITY_CLOSED"
  );
  await assert.rejects(
    () => opportunity.recordFirstResponse({
      score: 0,
      occurredAt: "2026-08-01T10:03:00.000Z"
    }),
    (error) => error.code === "CURRICULUM_FIRST_RESPONSE_CONFLICT"
  );
});

test("a reveal without a response closes the opportunity as non-mastery evidence", async () => {
  const base = await fixture();
  const service = createCurriculumService(serviceOptions(base));
  await service.ready();
  const opportunity = await service.beginOpportunity("verb-nebula", "cs.verb.cist.read", {
    targetSkillId: "cs.skill.sense.cist.read"
  });

  const result = await opportunity.recordSolutionReveal({ occurredAt: "2026-08-01T10:04:00.000Z" });
  assert.equal(result.event.outcome.score, 0);
  assert.equal(result.event.outcome.solutionRevealed, true);
  assert.equal(result.qualifiesForMastery, false);
  assert.deepEqual(opportunity.state(), {
    activityId: "verb-nebula",
    stableContentId: "cs.verb.cist.read",
    taskId: opportunity.task.taskId,
    taskFingerprint: opportunity.task.taskFingerprint,
    hintsUsed: 0,
    solutionRevealed: true,
    firstResponseRecorded: true
  });
  await assert.rejects(
    () => opportunity.recordFirstResponse({
      score: 1,
      occurredAt: "2026-08-01T10:05:00.000Z"
    }),
    (error) => error.code === "CURRICULUM_FIRST_RESPONSE_CONFLICT"
  );
});

test("a post-failure reveal remains sticky without rewriting first-response evidence", async () => {
  const base = await fixture();
  const service = createCurriculumService(serviceOptions(base));
  await service.ready();
  const opportunity = await service.beginOpportunity("word-world", "ww-cp-000146");
  const first = await opportunity.recordFirstResponse({
    score: 0,
    occurredAt: "2026-08-01T10:06:00.000Z"
  });
  const revealed = await opportunity.recordSolutionReveal({ occurredAt: "2026-08-01T10:06:01.000Z" });

  assert.equal(revealed.event.eventId, first.event.eventId);
  assert.equal(revealed.event.outcome.solutionRevealed, false);
  assert.equal(opportunity.state().solutionRevealed, true);
  assert.equal(service.snapshot().storedEventCount, 1);
});

test("invalid release pins and corrupted persisted evidence fail readiness closed", async () => {
  const base = await fixture();
  const changedProfile = structuredClone(base.courseProfile);
  changedProfile.curriculum.releasePins.targetPackDigest = `sha256:${"0".repeat(64)}`;
  const mismatched = createCurriculumService(serviceOptions({ ...base, courseProfile: changedProfile }));
  await assert.rejects(
    () => mismatched.ready(),
    (error) => error.code === "CURRICULUM_RUNTIME_INVALID"
  );
  assert.equal(mismatched.snapshot().status, "failed");

  const localStorage = new MemoryStorage();
  localStorage.setItem("caatuu-czech-test.curriculum.events.v1", "not-json");
  const corrupt = createCurriculumService(serviceOptions(base, { localStorage }));
  await assert.rejects(
    () => corrupt.ready(),
    (error) => error.code === "CURRICULUM_STORAGE_CORRUPT"
  );
});
