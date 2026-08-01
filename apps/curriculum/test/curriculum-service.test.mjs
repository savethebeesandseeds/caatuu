import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createCurriculumService } from "../runtime/curriculum-service.mjs";
import { createGuidedOpportunityLifecycle } from "../runtime/guided-opportunity.mjs";
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

class MemoryLockManager {
  #states = new Map();

  #state(name) {
    if (!this.#states.has(name)) this.#states.set(name, { held: false, queue: [] });
    return this.#states.get(name);
  }

  #start(name, state, callback, resolve, reject) {
    state.held = true;
    Promise.resolve()
      .then(() => callback(Object.freeze({ name, mode: "exclusive" })))
      .then(resolve, reject)
      .finally(() => {
        state.held = false;
        const next = state.queue.shift();
        if (next) this.#start(name, state, next.callback, next.resolve, next.reject);
      });
  }

  request(name, options, callback) {
    if (typeof options === "function") {
      callback = options;
      options = {};
    }
    const state = this.#state(String(name));
    if (state.held && options?.ifAvailable) return Promise.resolve().then(() => callback(null));
    return new Promise((resolve, reject) => {
      const request = { callback, resolve, reject };
      if (state.held) state.queue.push(request);
      else this.#start(String(name), state, callback, resolve, reject);
    });
  }

  waitingCount(name) {
    return this.#state(String(name)).queue.length;
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
    lockManager: new MemoryLockManager(),
    ...overrides
  };
}

test("the service loads four pinned assets and exposes only explicit loopback Guided mode", async () => {
  const base = await fixture();
  const fetchRequests = [];
  const service = createCurriculumService(serviceOptions(base, {
    fetchImpl: async (path, options) => {
      fetchRequests.push({ path, options });
      return base.fetchImpl(path, options);
    }
  }));
  const ready = await service.ready();
  assert.equal(ready.status, "ready");
  assert.equal(ready.guidedModeEnabled, true);
  assert.equal(service.snapshot().storedTaskCount, 0);
  assert.equal(service.snapshot().storedDeveloperPilotClaimCount, 0);
  assert.equal(fetchRequests.length, 4);
  assert.ok(fetchRequests.every(({ options }) => options?.cache === "reload"));

  const word = await service.resolveBinding("word-world", "ww-cp-000146");
  assert.equal(word.context, null);
  assert.equal(word.opportunity, null);
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
  await assert.rejects(
    () => remote.claimDeveloperPilot("binding.word-world.ww-cp-000146", {
      targetSkillId: "cs.skill.sense.cist.read"
    }),
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

  const unlocked = createCurriculumService(serviceOptions(base, { lockManager: null }));
  await assert.rejects(
    () => unlocked.ready(),
    (error) => error.code === "CURRICULUM_LEDGER_LOCK_UNAVAILABLE"
  );
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

test("separate game services serialize concurrent task and evidence writes", async () => {
  const base = await fixture();
  const localStorage = new MemoryStorage();
  const sessionStorage = new MemoryStorage();
  const lockManager = new MemoryLockManager();
  let id = 0;
  const shared = serviceOptions(base, {
    localStorage,
    sessionStorage,
    lockManager,
    uuid: () => `concurrent-ledger-${++id}`
  });
  const wordService = createCurriculumService(shared);
  const verbService = createCurriculumService(shared);
  await Promise.all([wordService.ready(), verbService.ready()]);
  const targetSkillId = "cs.skill.sense.cist.read";
  const [wordTask, verbTask] = await Promise.all([
    wordService.issueTask("binding.word-world.ww-cp-000146", "independent-retrieval", { targetSkillId }),
    verbService.issueTask("binding.verb-nebula.cs.verb.cist.read", "independent-retrieval", { targetSkillId })
  ]);
  assert.deepEqual(
    [wordTask.taskSequence, verbTask.taskSequence].sort((left, right) => left - right),
    [1, 2]
  );

  await Promise.all([
    wordService.recordEvidence(wordTask, { score: 1 }),
    verbService.recordEvidence(verbTask, { score: 1 })
  ]);
  assert.equal(wordService.snapshot().storedTaskCount, 2);
  assert.equal(wordService.snapshot().storedEventCount, 2);
  assert.deepEqual(
    (await verbService.skillSummary(targetSkillId)).contributingActivityIds,
    ["verb-nebula", "word-world"]
  );
});

test("paired ledger readers wait for one atomic cross-context task and evidence commit", async () => {
  const base = await fixture();
  const localStorage = new MemoryStorage();
  const sessionStorage = new MemoryStorage();
  const lockManager = new MemoryLockManager();
  let id = 0;
  const shared = serviceOptions(base, {
    localStorage,
    sessionStorage,
    lockManager,
    uuid: () => `atomic-reader-${++id}`
  });
  const service = createCurriculumService(shared);
  await service.ready();
  const targetSkillId = "cs.skill.sense.cist.read";
  await service.recordExposure("binding.word-world.ww-cp-000146", { targetSkillId });

  const tasksKey = "caatuu-czech-test.curriculum.tasks.v1";
  const eventsKey = "caatuu-czech-test.curriculum.events.v1";
  const ledgerLockName = "caatuu-czech-test.curriculum.ledger.v1";
  const committedTasks = localStorage.getItem(tasksKey);
  const committedEvents = localStorage.getItem(eventsKey);
  localStorage.setItem(tasksKey, "[]");
  localStorage.setItem(eventsKey, "[]");

  let partialCommitReady;
  const partialCommit = new Promise((resolve) => {
    partialCommitReady = resolve;
  });
  let finishCommit;
  const commitGate = new Promise((resolve) => {
    finishCommit = resolve;
  });
  const writer = lockManager.request(ledgerLockName, { mode: "exclusive" }, async () => {
    localStorage.setItem(tasksKey, committedTasks);
    partialCommitReady();
    await commitGate;
    localStorage.setItem(eventsKey, committedEvents);
  });
  await partialCommit;

  const reloaded = createCurriculumService(shared);
  const summaryPromise = service.skillSummary(targetSkillId);
  const progressionPromise = service.progression();
  const readinessPromise = reloaded.ready();
  for (let attempts = 0; lockManager.waitingCount(ledgerLockName) < 3 && attempts < 200; attempts += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(lockManager.waitingCount(ledgerLockName), 3);

  finishCommit();
  const [, summary, progression, readiness] = await Promise.all([
    writer,
    summaryPromise,
    progressionPromise,
    readinessPromise
  ]);
  assert.equal(readiness.status, "ready");
  assert.equal(summary.exposureEvents, 1);
  const unitThree = progression.units.find((unit) => (
    unit.canonicalUnitId === "unit.routine.familiar-actions.01"
  ));
  const skill = unitThree.skills.find((row) => row.targetSkillId === targetSkillId);
  assert.equal(skill.evidence.exposureEvents, 1);
});

test("a developer pilot claim is a durable one-shot exposure for one exact binding and skill", async () => {
  const base = await fixture();
  const localStorage = new MemoryStorage();
  const sessionStorage = new MemoryStorage();
  let id = 0;
  const shared = serviceOptions(base, {
    localStorage,
    sessionStorage,
    uuid: () => `pilot-${++id}`
  });
  const service = createCurriculumService(shared);
  await service.ready();

  await assert.rejects(
    () => service.claimDeveloperPilot("binding.missing", {
      targetSkillId: "cs.skill.sense.cist.read"
    }),
    (error) => error.code === "CURRICULUM_DEVELOPER_PILOT_BINDING_UNKNOWN"
  );
  await assert.rejects(
    () => service.claimDeveloperPilot("binding.word-world.ww-cp-000146"),
    (error) => error.code === "CURRICULUM_DEVELOPER_PILOT_SKILL_MISMATCH"
  );

  const [first, duplicate] = await Promise.all([
    service.claimDeveloperPilot("binding.word-world.ww-cp-000146", {
      targetSkillId: "cs.skill.sense.cist.read"
    }),
    service.claimDeveloperPilot("binding.word-world.ww-cp-000146", {
      targetSkillId: "cs.skill.sense.cist.read"
    })
  ]);
  assert.equal(first.status, "claimed");
  assert.equal(first.claimed, true);
  assert.equal(first.exposure.task.capabilityId, "exposure");
  assert.equal(first.opportunity.task.capabilityId, "independent-retrieval");
  assert.ok(first.exposure.task.taskSequence < first.opportunity.task.taskSequence);
  assert.deepEqual(first.exposure.event.outcome, {
    score: null,
    solutionRevealed: false,
    hintsUsed: 0
  });
  assert.equal(duplicate.status, "blocked");
  assert.equal(duplicate.claimed, false);
  assert.equal(duplicate.reason, "active-elsewhere");
  assert.deepEqual(duplicate.priorTaskIds, []);
  assert.deepEqual(duplicate.closedTaskIds, []);
  assert.equal(service.snapshot().storedTaskCount, 2);
  assert.equal(service.snapshot().storedEventCount, 1);
  assert.equal(service.snapshot().storedDeveloperPilotClaimCount, 1);
  await first.opportunity.recordFirstResponse({ score: 1 });
  await first.release();

  const reloaded = createCurriculumService(shared);
  await reloaded.ready();
  const blockedAfterReload = await reloaded.claimDeveloperPilot(
    "binding.word-world.ww-cp-000146",
    { targetSkillId: "cs.skill.sense.cist.read" }
  );
  assert.equal(blockedAfterReload.status, "blocked");
  assert.equal(reloaded.snapshot().storedTaskCount, 2);
  assert.equal(reloaded.snapshot().storedEventCount, 2);
  assert.equal(reloaded.snapshot().storedDeveloperPilotClaimCount, 1);

  const otherBinding = await reloaded.claimDeveloperPilot(
    "binding.verb-nebula.cs.verb.cist.read",
    { targetSkillId: "cs.skill.sense.cist.read" }
  );
  assert.equal(otherBinding.status, "claimed");
  assert.equal(reloaded.snapshot().storedTaskCount, 4);
  assert.equal(reloaded.snapshot().storedEventCount, 3);
  assert.equal(reloaded.snapshot().storedDeveloperPilotClaimCount, 2);
  await otherBinding.opportunity.recordSolutionReveal();
  await otherBinding.release();
});

test("a persisted pilot marker blocks re-entry when the first task write crashes", async () => {
  const base = await fixture();
  const localStorage = new MemoryStorage();
  const sessionStorage = new MemoryStorage();
  const lockManager = new MemoryLockManager();
  let failTaskId = true;
  let id = 0;
  const shared = serviceOptions(base, {
    localStorage,
    sessionStorage,
    lockManager,
    uuid: () => {
      id += 1;
      if (failTaskId && id > 1) throw new Error("simulated task-id crash");
      return `marker-recovery-${id}`;
    }
  });
  const service = createCurriculumService(shared);
  await service.ready();
  const bindingId = "binding.word-world.ww-cp-000146";
  const targetSkillId = "cs.skill.sense.cist.read";
  await assert.rejects(
    () => service.claimDeveloperPilot(bindingId, { targetSkillId }),
    /simulated task-id crash/
  );
  assert.equal(service.snapshot().storedDeveloperPilotClaimCount, 1);
  assert.equal(service.snapshot().storedTaskCount, 0);
  assert.equal(service.snapshot().storedEventCount, 0);

  failTaskId = false;
  const reloaded = createCurriculumService(shared);
  await reloaded.ready();
  const blocked = await reloaded.claimDeveloperPilot(bindingId, { targetSkillId });
  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.reason, "prior-claim");
  assert.deepEqual(blocked.priorTaskIds, []);
  assert.equal(reloaded.snapshot().storedTaskCount, 0);
  assert.equal(reloaded.snapshot().storedEventCount, 0);
});

test("a hidden presentation defers without consuming the pilot marker", async () => {
  const base = await fixture();
  const service = createCurriculumService(serviceOptions(base));
  await service.ready();
  const bindingId = "binding.word-world.ww-cp-000146";
  const targetSkillId = "cs.skill.sense.cist.read";
  const deferred = await service.claimDeveloperPilot(bindingId, {
    targetSkillId,
    requirePresented: () => false
  });
  assert.equal(deferred.status, "deferred");
  assert.equal(service.snapshot().storedDeveloperPilotClaimCount, 0);
  assert.equal(service.snapshot().storedTaskCount, 0);
  assert.equal(service.snapshot().storedEventCount, 0);

  const claimed = await service.claimDeveloperPilot(bindingId, {
    targetSkillId,
    requirePresented: () => true
  });
  assert.equal(claimed.status, "claimed");
  await claimed.opportunity.recordSolutionReveal();
  await claimed.release();
});

test("presentation loss during retrieval validation consumes only the exposure and releases the lease", async () => {
  const base = await fixture();
  const localStorage = new MemoryStorage();
  let presented = true;
  let id = 0;
  const service = createCurriculumService(serviceOptions(base, {
    localStorage,
    uuid: () => {
      id += 1;
      if (id === 3) queueMicrotask(() => {
        presented = false;
      });
      return `presentation-race-${id}`;
    }
  }));
  await service.ready();
  const bindingId = "binding.word-world.ww-cp-000146";
  const targetSkillId = "cs.skill.sense.cist.read";
  const blocked = await service.claimDeveloperPilot(bindingId, {
    targetSkillId,
    requirePresented: () => presented
  });
  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.reason, "presentation-lost-after-exposure");
  assert.equal(service.snapshot().storedDeveloperPilotClaimCount, 1);
  assert.equal(service.snapshot().storedTaskCount, 1);
  assert.equal(service.snapshot().storedEventCount, 1);
  const tasks = JSON.parse(localStorage.getItem("caatuu-czech-test.curriculum.tasks.v1"));
  assert.deepEqual(tasks.map((task) => task.evidenceKind), ["exposure"]);

  presented = true;
  const retried = await service.claimDeveloperPilot(bindingId, {
    targetSkillId,
    requirePresented: () => presented
  });
  assert.equal(retried.status, "blocked");
  assert.equal(retried.reason, "prior-claim");
});

test("developer pilot re-entry closes pending exposure and in-memory-hinted retrieval tasks without mastery", async () => {
  const base = await fixture();
  const localStorage = new MemoryStorage();
  const sessionStorage = new MemoryStorage();
  let id = 0;
  const shared = serviceOptions(base, {
    localStorage,
    sessionStorage,
    uuid: () => `pending-pilot-${++id}`
  });
  const service = createCurriculumService(shared);
  await service.ready();
  const bindingId = "binding.word-world.ww-cp-000146";
  const targetSkillId = "cs.skill.sense.cist.read";
  const exposureTask = await service.issueTask(bindingId, "exposure", { targetSkillId });
  const pendingOpportunity = await service.beginOpportunity("word-world", "ww-cp-000146", {
    capabilityId: "independent-retrieval",
    targetSkillId
  });
  pendingOpportunity.markHint();
  const retrievalTask = pendingOpportunity.task;
  assert.equal(pendingOpportunity.state().hintsUsed, 1);
  assert.equal(service.snapshot().storedTaskCount, 2);
  assert.equal(service.snapshot().storedEventCount, 0);

  const reloaded = createCurriculumService(shared);
  await reloaded.ready();
  const blocked = await reloaded.claimDeveloperPilot(bindingId, { targetSkillId });
  assert.equal(blocked.status, "blocked");
  assert.deepEqual(new Set(blocked.priorTaskIds), new Set([exposureTask.taskId, retrievalTask.taskId]));
  assert.deepEqual(new Set(blocked.closedTaskIds), new Set([exposureTask.taskId, retrievalTask.taskId]));
  assert.equal(reloaded.snapshot().storedTaskCount, 2);
  assert.equal(reloaded.snapshot().storedEventCount, 2);
  assert.equal(reloaded.snapshot().storedDeveloperPilotClaimCount, 1);

  const events = JSON.parse(localStorage.getItem("caatuu-czech-test.curriculum.events.v1"));
  const exposureClosure = events.find((event) => event.taskId === exposureTask.taskId);
  const retrievalClosure = events.find((event) => event.taskId === retrievalTask.taskId);
  assert.deepEqual(exposureClosure.outcome, {
    score: null,
    solutionRevealed: true,
    hintsUsed: 0
  });
  assert.deepEqual(retrievalClosure.outcome, {
    score: 0,
    solutionRevealed: true,
    hintsUsed: 0
  });
  const summary = await reloaded.skillSummary(targetSkillId);
  assert.equal(summary.independentRetrievals, 0);
  assert.equal(summary.masteryReady, false);

  const repeated = await reloaded.claimDeveloperPilot(bindingId, { targetSkillId });
  assert.equal(repeated.status, "blocked");
  assert.equal(repeated.reason, "prior-claim");
  assert.deepEqual(repeated.closedTaskIds, []);
  assert.equal(reloaded.snapshot().storedTaskCount, 2);
  assert.equal(reloaded.snapshot().storedEventCount, 2);
});

test("hinted, revealed, incorrect, and completed evidence all block developer pilot re-entry", async (t) => {
  const base = await fixture();
  const scenarios = [
    { name: "hinted", score: 1, solutionRevealed: false, hintsUsed: 1, independentRetrievals: 0 },
    { name: "revealed", score: 0, solutionRevealed: true, hintsUsed: 0, independentRetrievals: 0 },
    { name: "incorrect", score: 0, solutionRevealed: false, hintsUsed: 0, independentRetrievals: 0 },
    { name: "completed", score: 1, solutionRevealed: false, hintsUsed: 0, independentRetrievals: 1 }
  ];
  for (const scenario of scenarios) {
    await t.test(scenario.name, async () => {
      const localStorage = new MemoryStorage();
      const sessionStorage = new MemoryStorage();
      let id = 0;
      const shared = serviceOptions(base, {
        localStorage,
        sessionStorage,
        uuid: () => `${scenario.name}-pilot-${++id}`
      });
      const service = createCurriculumService(shared);
      await service.ready();
      const bindingId = "binding.word-world.ww-cp-000146";
      const targetSkillId = "cs.skill.sense.cist.read";
      const task = await service.issueTask(bindingId, "independent-retrieval", { targetSkillId });
      await service.recordEvidence(task, {
        attemptNumber: 1,
        score: scenario.score,
        solutionRevealed: scenario.solutionRevealed,
        hintsUsed: scenario.hintsUsed
      });

      const reloaded = createCurriculumService(shared);
      await reloaded.ready();
      const blocked = await reloaded.claimDeveloperPilot(bindingId, { targetSkillId });
      assert.equal(blocked.status, "blocked");
      assert.deepEqual(blocked.priorTaskIds, [task.taskId]);
      assert.deepEqual(blocked.closedTaskIds, []);
      assert.equal(reloaded.snapshot().storedTaskCount, 1);
      assert.equal(reloaded.snapshot().storedEventCount, 1);
      assert.equal((await reloaded.skillSummary(targetSkillId)).independentRetrievals, scenario.independentRetrievals);
    });
  }
});

test("both Guided games preserve encounter-before-retrieval and aggregate without claiming mastery", async () => {
  const base = await fixture();
  const localStorage = new MemoryStorage();
  let id = 0;
  const service = createCurriculumService(serviceOptions(base, {
    localStorage,
    uuid: () => `cross-game-${++id}`
  }));
  await service.ready();

  for (const [activityId, contentId] of [
    ["word-world", "ww-cp-000146"],
    ["verb-nebula", "cs.verb.cist.read"]
  ]) {
    const resolution = await service.resolveBinding(activityId, contentId);
    const lifecycle = createGuidedOpportunityLifecycle({
      curriculum: service,
      resolution,
      targetSkillId: "cs.skill.sense.cist.read"
    });
    await lifecycle.activate();
    await lifecycle.recordFirstResponse({ score: 1 });
  }

  assert.equal(service.snapshot().storedTaskCount, 4);
  assert.equal(service.snapshot().storedEventCount, 4);
  const tasks = JSON.parse(localStorage.getItem("caatuu-czech-test.curriculum.tasks.v1"));
  for (const activityId of ["word-world", "verb-nebula"]) {
    const activityTasks = tasks.filter((task) => task.activityId === activityId);
    const exposure = activityTasks.find((task) => task.evidenceKind === "exposure");
    const retrieval = activityTasks.find((task) => task.evidenceKind === "retrieval");
    assert.ok(exposure.taskSequence < retrieval.taskSequence);
  }

  const summary = await service.skillSummary("cs.skill.sense.cist.read");
  assert.equal(summary.exposureEvents, 2);
  assert.equal(summary.assessedAttempts, 2);
  assert.equal(summary.independentRetrievals, 2);
  assert.equal(summary.productionEvidence, 0);
  assert.equal(summary.transferEvidence, 0);
  assert.deepEqual(summary.contributingActivityIds, ["verb-nebula", "word-world"]);
  assert.equal(summary.qualifyingSessionIds.length, 1);
  assert.deepEqual(summary.qualifyingContextIds, []);
  assert.equal(summary.masteryReady, false);
  for (const shortfall of ["independent-retrievals", "sessions", "distinct-contexts", "production", "transfer"]) {
    assert.ok(summary.masteryShortfalls.includes(shortfall), shortfall);
  }

  const progression = await service.progression();
  const unitThree = progression.units.find((unit) => unit.canonicalUnitId === "unit.routine.familiar-actions.01");
  assert.equal(unitThree.status, "locked");
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
