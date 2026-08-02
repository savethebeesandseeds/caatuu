import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createCurriculumService } from "../runtime/curriculum-service.mjs";
import { createGuidedOpportunityLifecycle } from "../runtime/guided-opportunity.mjs";
import {
  computeBindingRegistryDigest,
  computeCanonicalContractDigest,
  computeContentDigest,
  computeSourceCatalogDigest,
  computeTargetPackDigest
} from "../runtime/curriculum-runtime-core.mjs";
import { composeMorphologyRound } from "../runtime/morphology-round-core.mjs";

const dataUrl = new URL("../data/", import.meta.url);
const paths = {
  canonicalManifest: "/curriculum/canonical.json",
  realizationPack: "/curriculum/pack.json",
  sourceCatalog: "/curriculum/sources.json",
  bindingRegistry: "/curriculum/bindings.json"
};
const morphologySequenceBindingIds = Object.freeze([
  "binding.conjugation-comet.cs.morphology.cist.present-singular-person.1sg",
  "binding.conjugation-comet.cs.morphology.cist.present-singular-person.2sg",
  "binding.conjugation-comet.cs.morphology.cist.present-singular-person.3sg"
]);
const morphologySkillId = "cs.skill.form.cist.present-singular-person";
const morphologySequenceCueRefs = Object.freeze([
  Object.freeze({ id: "cs.cue.cist.read.speaker-singular-current", revision: 1 }),
  Object.freeze({ id: "cs.cue.cist.read.addressee-singular-current", revision: 2 }),
  Object.freeze({ id: "cs.cue.cist.read.named-third-person-current", revision: 2 })
]);

function composeSequenceRound(catalog, task, stepIndex) {
  return composeMorphologyRound(catalog, {
    catalogRef: { id: catalog.catalogId, version: catalog.version },
    familyRef: { id: "cs.morphology.family.cist.present-singular", revision: 1 },
    cueRef: morphologySequenceCueRefs[Math.min(stepIndex, morphologySequenceCueRefs.length - 1)],
    taskFingerprint: task.taskFingerprint
  });
}

function morphologyTaskRef(task) {
  return [
    "verb-task:v1",
    "morphology",
    encodeURIComponent(task.bindingId),
    encodeURIComponent(task.taskFingerprint)
  ].join(":");
}

function morphologyItemRef(task, round) {
  return [
    "verb-item:v1",
    "morphology",
    encodeURIComponent(task.contentRef.contentId),
    encodeURIComponent(round.cue.cueRef.id)
  ].join(":");
}

function morphologySettlementId(task, round, kind) {
  return [
    "verb-settlement:v1",
    "morphology",
    encodeURIComponent(morphologyTaskRef(task)),
    encodeURIComponent(morphologyItemRef(task, round)),
    kind
  ].join(":");
}

function morphologySettlementJournal(task, round, event, completionKind, {
  completed = true,
  selectedItemRef = completionKind === "solution-review" ? null : round.targetItemRef,
  rejectedItemRefs,
  hintState = completionKind === "solution-review" ? "solution-revealed" : "available",
  settlementKind = completionKind === "solution-review" ? "solution-reveal" : "first-response",
  settlementId = morphologySettlementId(task, round, settlementKind)
} = {}) {
  const selectedIsWrong = Boolean(
    selectedItemRef
      && (selectedItemRef.id !== round.targetItemRef.id
        || selectedItemRef.revision !== round.targetItemRef.revision)
  );
  const rejected = rejectedItemRefs === undefined
    ? (selectedIsWrong ? [selectedItemRef] : [])
    : rejectedItemRefs;
  return {
    schemaVersion: "caatuu-morphology-guided-progress-v1",
    round: {
      schemaVersion: 1,
      exerciseFamily: "morphology",
      taskRef: morphologyTaskRef(task),
      itemRef: morphologyItemRef(task, round),
      roundId: round.roundId,
      cueRef: structuredClone(round.cue.cueRef),
      optionRefs: round.options.map((option) => structuredClone(option.itemRef)),
      selectedItemRef: selectedItemRef && structuredClone(selectedItemRef),
      rejectedItemRefs: rejected.map((reference) => structuredClone(reference)),
      hintState,
      completed,
      settlementId
    },
    evidence: {
      recorded: true,
      score: event.outcome.score,
      solutionRevealed: event.outcome.solutionRevealed,
      hintsUsed: event.outcome.hintsUsed,
      occurredAt: event.occurredAt
    },
    pendingEvidence: null,
    terminalCompletionKind: completionKind,
    pendingCompletionKind: completionKind
  };
}

class MemoryStorage {
  #values = new Map();

  getItem(key) {
    return this.#values.has(key) ? this.#values.get(key) : null;
  }

  setItem(key, value) {
    this.#values.set(String(key), String(value));
  }

  removeItem(key) {
    this.#values.delete(String(key));
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

async function authorSyntheticMorphologySequenceLength(sourceCatalog, bindingRegistry, length) {
  assert.ok([2, 3, 4].includes(length), "Synthetic sequence fixtures support two to four steps.");
  const sequence = bindingRegistry.exerciseSequences?.[0];
  assert.deepEqual(sequence?.orderedBindingIds, morphologySequenceBindingIds);
  const orderedBindingIds = [...morphologySequenceBindingIds];
  if (length === 2) {
    const removedBindingIds = new Set(orderedBindingIds.splice(2));
    const removedContentIds = new Set(bindingRegistry.bindings
      .filter((binding) => removedBindingIds.has(binding.id))
      .map((binding) => binding.contentRef.contentId));
    bindingRegistry.bindings = bindingRegistry.bindings.filter((binding) => !removedBindingIds.has(binding.id));
    sourceCatalog.sources = sourceCatalog.sources.filter((source) => !removedContentIds.has(source.contentId));
  }
  if (length === 4) {
    const templateBinding = bindingRegistry.bindings.find((binding) => binding.id === orderedBindingIds[2]);
    const templateSource = sourceCatalog.sources.find((source) => (
      source.contentId === templateBinding.contentRef.contentId
    ));
    const binding = structuredClone(templateBinding);
    const source = structuredClone(templateSource);
    binding.id = `${templateBinding.id}.synthetic-step-4`;
    source.contentId = `${templateSource.contentId}.synthetic-step-4`;
    source.snapshot.id = source.contentId;
    source.snapshot.sequenceStep = 4;
    source.snapshot.difficulty.rationaleEn = "Synthetic fourth step used to verify authored sequence cardinality.";
    source.contentDigest = await computeContentDigest(source);
    binding.contentRef.contentId = source.contentId;
    binding.contentRef.contentDigest = source.contentDigest;
    bindingRegistry.bindings.push(binding);
    sourceCatalog.sources.push(source);
    orderedBindingIds.push(binding.id);
  }
  sequence.orderedBindingIds = orderedBindingIds;
  return Object.freeze([...orderedBindingIds]);
}

async function fixture({ withMorphologySequence = false, morphologySequenceLength = null } = {}) {
  const [curriculum, targetPack, sourceCatalog, bindingRegistry] = await Promise.all([
    readJson("canonical-curriculum.v1.en.json"),
    readJson("cs-CZ.realization-pack.v1.json"),
    readJson("pilot-content-sources.v1.json"),
    readJson("cs-CZ.cross-game-bindings.v1.json")
  ]);
  if (withMorphologySequence || morphologySequenceLength !== null) {
    assert.deepEqual(
      bindingRegistry.exerciseSequences?.[0]?.orderedBindingIds,
      morphologySequenceBindingIds
    );
  }
  const sequenceBindingIds = morphologySequenceLength === null
    ? morphologySequenceBindingIds
    : await authorSyntheticMorphologySequenceLength(sourceCatalog, bindingRegistry, morphologySequenceLength);
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
  return { courseProfile, fetchImpl, sequenceBindingIds };
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
  assert.equal(ready.developerPilotModeEnabled, true);
  assert.equal(service.developerPilotModeEnabled(), true);
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
  assert.equal(remote.developerPilotModeEnabled(), false);
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
  assert.equal(unapprovedPublic.developerPilotModeEnabled(), false);

  const unlocked = createCurriculumService(serviceOptions(base, { lockManager: null }));
  await assert.rejects(
    () => unlocked.ready(),
    (error) => error.code === "CURRICULUM_LEDGER_LOCK_UNAVAILABLE"
  );
});

test("developer pilot APIs stay closed in release-enabled and non-developer Guided profiles", async () => {
  const base = await fixture({ withMorphologySequence: true });
  const localStorage = new MemoryStorage();
  const sessionStorage = new MemoryStorage();
  const lockManager = new MemoryLockManager();
  let id = 0;
  const shared = { localStorage, sessionStorage, lockManager, uuid: () => `pilot-mode-${++id}` };
  const developerService = createCurriculumService(serviceOptions(base, shared));
  await developerService.ready();
  const claim = await developerService.claimDeveloperPilotSequence(morphologySequenceBindingIds, {
    targetSkillId: morphologySkillId,
    requirePresented: () => true
  });
  const task = claim.opportunity.task;
  const catalog = await readJson("cs-CZ.morphology-developer-pilot.v1.json");
  const round = composeSequenceRound(catalog, task, 0);
  await claim.release();

  const releaseProfile = structuredClone(base.courseProfile);
  releaseProfile.curriculum.approval = { releaseEnabled: true };
  const releaseService = createCurriculumService(serviceOptions({
    ...base,
    courseProfile: releaseProfile
  }, shared));
  const releaseReady = await releaseService.ready();
  assert.equal(releaseReady.guidedModeEnabled, true);
  assert.equal(releaseReady.developerPilotModeEnabled, false);
  const disabled = (error) => error.code === "CURRICULUM_GUIDED_MODE_DISABLED";
  await assert.rejects(
    () => releaseService.claimDeveloperPilot(task.bindingId, { targetSkillId: morphologySkillId }),
    disabled
  );
  await assert.rejects(
    () => releaseService.claimDeveloperPilotSequence(morphologySequenceBindingIds, {
      targetSkillId: morphologySkillId,
      requirePresented: () => true
    }),
    disabled
  );
  await assert.rejects(
    () => releaseService.completeDeveloperPilotStep({
      orderedBindingIds: morphologySequenceBindingIds,
      targetSkillId: morphologySkillId,
      taskId: task.taskId,
      taskFingerprint: task.taskFingerprint,
      completionKind: "solution-review"
    }),
    disabled
  );
  await assert.rejects(
    () => releaseService.saveMorphologyRoundState(task, { round, state: {}, expectedRevision: 0 }),
    disabled
  );
  await assert.rejects(
    () => releaseService.restoreMorphologyRoundState({
      taskId: task.taskId,
      taskFingerprint: task.taskFingerprint
    }),
    disabled
  );

  const publicProfile = structuredClone(base.courseProfile);
  publicProfile.curriculum.guidedMode.developerOnly = false;
  publicProfile.curriculum.approval = { releaseEnabled: true };
  const remoteRelease = createCurriculumService(serviceOptions({
    ...base,
    courseProfile: publicProfile
  }, {
    location: { hostname: "learn.example.test", search: "?curriculum-guided=1" }
  }));
  const remoteReady = await remoteRelease.ready();
  assert.equal(remoteReady.guidedModeEnabled, true);
  assert.equal(remoteReady.developerPilotModeEnabled, false);
  await assert.rejects(
    () => remoteRelease.claimDeveloperPilot(task.bindingId, { targetSkillId: morphologySkillId }),
    disabled
  );
});

test("resetProgress clears every curriculum ledger and recovers a storage-failed service", async () => {
  const base = await fixture();
  const localStorage = new MemoryStorage();
  const sessionStorage = new MemoryStorage();
  const namespace = "caatuu-czech-test.curriculum";
  const localKeys = [
    `${namespace}.tasks.v4`,
    `${namespace}.events.v4`,
    `${namespace}.developer-pilot-claims.v4`,
    `${namespace}.developer-pilot-sequences.v4`,
    `${namespace}.developer-pilot-step-completions.v4`,
    `${namespace}.morphology-round-states.v4`
  ];
  for (const key of localKeys) localStorage.setItem(key, "corrupt");
  localStorage.setItem("unrelated.preference", "keep-me");
  const sessionKey = `${namespace}.session.v4`;
  sessionStorage.setItem(sessionKey, "session.stale");
  const service = createCurriculumService(serviceOptions(base, { localStorage, sessionStorage }));
  await assert.rejects(
    () => service.ready(),
    (error) => error.code === "CURRICULUM_STORAGE_CORRUPT"
  );

  const reset = await service.resetProgress();
  assert.deepEqual(reset, {
    localStorageKeysCleared: 6,
    sessionStorageKeyCleared: true
  });
  assert.ok(localKeys.every((key) => localStorage.getItem(key) === null));
  assert.equal(sessionStorage.getItem(sessionKey), null);
  assert.equal(localStorage.getItem("unrelated.preference"), "keep-me");

  const ready = await service.ready();
  assert.equal(ready.status, "ready");
  assert.equal(service.snapshot().storedTaskCount, 0);
  assert.equal(service.snapshot().storedEventCount, 0);
  assert.equal(service.snapshot().storedDeveloperPilotClaimCount, 0);
  assert.equal(service.snapshot().storedDeveloperPilotSequenceCount, 0);
  assert.equal(service.snapshot().storedDeveloperPilotCompletionCount, 0);
  assert.equal(service.snapshot().storedMorphologyRoundStateCount, 0);
});

test("v4 storage leaves immutable v3 curriculum evidence untouched", async () => {
  const base = await fixture({ withMorphologySequence: true });
  const localStorage = new MemoryStorage();
  const sessionStorage = new MemoryStorage();
  const namespace = "caatuu-czech-test.curriculum";
  const legacyLocalValues = new Map([
    [`${namespace}.tasks.v3`, "immutable-v3-tasks"],
    [`${namespace}.events.v3`, "immutable-v3-events"],
    [`${namespace}.developer-pilot-claims.v3`, "immutable-v3-claims"],
    [`${namespace}.developer-pilot-sequences.v3`, "immutable-v3-sequences"],
    [`${namespace}.developer-pilot-step-completions.v3`, "immutable-v3-completions"],
    [`${namespace}.morphology-round-states.v3`, "immutable-v3-round-states"]
  ]);
  for (const [key, value] of legacyLocalValues) localStorage.setItem(key, value);
  const legacySessionKey = `${namespace}.session.v3`;
  sessionStorage.setItem(legacySessionKey, "immutable-v3-session");

  const service = createCurriculumService(serviceOptions(base, { localStorage, sessionStorage }));
  const ready = await service.ready();
  assert.equal(ready.status, "ready");
  assert.equal(service.snapshot().storedTaskCount, 0);
  assert.equal(service.snapshot().storedEventCount, 0);
  for (const [key, value] of legacyLocalValues) assert.equal(localStorage.getItem(key), value);
  assert.equal(sessionStorage.getItem(legacySessionKey), "immutable-v3-session");

  await service.resetProgress();
  for (const [key, value] of legacyLocalValues) assert.equal(localStorage.getItem(key), value);
  assert.equal(sessionStorage.getItem(legacySessionKey), "immutable-v3-session");
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
  const wordTask = await service.issueTask("binding.word-world.ww-cp-000146", "independent-comprehension", {
    targetSkillId: "cs.skill.sense.cist.read"
  });
  const wordResult = await service.recordEvidence(wordTask, {
    occurredAt: "2026-08-01T10:01:00.000Z",
    attemptNumber: 1,
    score: 1
  });
  assert.equal(wordResult.qualifiesForIndependentAssessment, true);
  assert.equal(wordResult.qualifiesForMastery, false);
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

  const verbTask = await service.issueTask("binding.verb-nebula.cs.verb.cist.read", "independent-discrimination", {
    targetSkillId: "cs.skill.sense.cist.read"
  });
  await service.recordEvidence(verbTask, {
    occurredAt: "2026-08-01T10:02:00.000Z",
    attemptNumber: 1,
    score: 1
  });
  const summary = await service.skillSummary("cs.skill.sense.cist.read");
  assert.deepEqual(summary.contributingActivityIds, []);
  assert.equal(summary.independentRetrievals, 0);
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
    wordService.issueTask("binding.word-world.ww-cp-000146", "independent-comprehension", { targetSkillId }),
    verbService.issueTask("binding.verb-nebula.cs.verb.cist.read", "independent-discrimination", { targetSkillId })
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
    []
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

  const tasksKey = "caatuu-czech-test.curriculum.tasks.v4";
  const eventsKey = "caatuu-czech-test.curriculum.events.v4";
  const ledgerLockName = "caatuu-czech-test.curriculum.ledger.v4";
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
  assert.equal(first.opportunity.task.capabilityId, "independent-comprehension");
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

test("presentation loss during assessed-task validation consumes only the exposure and releases the lease", async () => {
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
  const tasks = JSON.parse(localStorage.getItem("caatuu-czech-test.curriculum.tasks.v4"));
  assert.deepEqual(tasks.map((task) => task.evidenceKind), ["exposure"]);

  presented = true;
  const retried = await service.claimDeveloperPilot(bindingId, {
    targetSkillId,
    requirePresented: () => presented
  });
  assert.equal(retried.status, "blocked");
  assert.equal(retried.reason, "prior-claim");
});

test("developer pilot re-entry closes pending exposure and in-memory-hinted comprehension tasks without mastery", async () => {
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
    capabilityId: "independent-comprehension",
    targetSkillId
  });
  pendingOpportunity.markHint();
  const comprehensionTask = pendingOpportunity.task;
  assert.equal(pendingOpportunity.state().hintsUsed, 1);
  assert.equal(service.snapshot().storedTaskCount, 2);
  assert.equal(service.snapshot().storedEventCount, 0);

  const reloaded = createCurriculumService(shared);
  await reloaded.ready();
  const blocked = await reloaded.claimDeveloperPilot(bindingId, { targetSkillId });
  assert.equal(blocked.status, "blocked");
  assert.deepEqual(new Set(blocked.priorTaskIds), new Set([exposureTask.taskId, comprehensionTask.taskId]));
  assert.deepEqual(new Set(blocked.closedTaskIds), new Set([exposureTask.taskId, comprehensionTask.taskId]));
  assert.equal(reloaded.snapshot().storedTaskCount, 2);
  assert.equal(reloaded.snapshot().storedEventCount, 2);
  assert.equal(reloaded.snapshot().storedDeveloperPilotClaimCount, 1);

  const events = JSON.parse(localStorage.getItem("caatuu-czech-test.curriculum.events.v4"));
  const exposureClosure = events.find((event) => event.taskId === exposureTask.taskId);
  const comprehensionClosure = events.find((event) => event.taskId === comprehensionTask.taskId);
  assert.deepEqual(exposureClosure.outcome, {
    score: null,
    solutionRevealed: true,
    hintsUsed: 0
  });
  assert.deepEqual(comprehensionClosure.outcome, {
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
    { name: "completed", score: 1, solutionRevealed: false, hintsUsed: 0, independentRetrievals: 0 }
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
      const task = await service.issueTask(bindingId, "independent-comprehension", { targetSkillId });
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

test("an ordered morphology pilot advances only through durable completion receipts", async () => {
  const base = await fixture({ withMorphologySequence: true });
  const localStorage = new MemoryStorage();
  const sessionStorage = new MemoryStorage();
  const lockManager = new MemoryLockManager();
  let id = 0;
  const shared = serviceOptions(base, {
    localStorage,
    sessionStorage,
    lockManager,
    uuid: () => `morph-sequence-${++id}`
  });
  const service = createCurriculumService(shared);
  await service.ready();
  const morphologyCatalog = await readJson("cs-CZ.morphology-developer-pilot.v1.json");

  await assert.rejects(
    () => service.claimDeveloperPilotSequence([...morphologySequenceBindingIds].reverse(), {
      targetSkillId: morphologySkillId,
      requirePresented: () => false
    }),
    (error) => error.code === "CURRICULUM_DEVELOPER_PILOT_SEQUENCE_UNPINNED"
  );

  const preview = await service.claimDeveloperPilotSequence(morphologySequenceBindingIds, {
    targetSkillId: morphologySkillId,
    requirePresented: () => false
  });
  assert.equal(preview.status, "deferred");
  assert.equal(preview.reason, "not-presented");
  assert.equal(preview.bindingId, morphologySequenceBindingIds[0]);
  assert.equal(preview.sequence.stepIndex, 0);
  assert.equal(preview.sequence.stepNumber, 1);
  assert.equal(preview.sequence.totalSteps, 3);
  assert.equal(preview.preview.contentRef.contentId, "cs.morphology.cist.present-singular-person.1sg");
  assert.equal(service.snapshot().storedDeveloperPilotSequenceCount, 0);
  assert.equal(service.snapshot().storedDeveloperPilotClaimCount, 0);
  assert.equal(service.snapshot().storedTaskCount, 0);
  assert.equal(service.snapshot().storedEventCount, 0);
  assert.equal(localStorage.getItem("caatuu-czech-test.curriculum.developer-pilot-sequences.v4"), null);
  assert.equal(localStorage.getItem("caatuu-czech-test.curriculum.developer-pilot-claims.v4"), null);
  assert.equal(localStorage.getItem("caatuu-czech-test.curriculum.tasks.v4"), null);
  assert.equal(localStorage.getItem("caatuu-czech-test.curriculum.events.v4"), null);

  const first = await service.claimDeveloperPilotSequence(morphologySequenceBindingIds, {
    targetSkillId: morphologySkillId,
    expectedStep: preview.sequence.expectedStep,
    requirePresented: () => true
  });
  assert.equal(first.status, "claimed");
  assert.equal(first.bindingId, morphologySequenceBindingIds[0]);
  assert.equal(first.sequence.stepIndex, 0);
  const firstTask = first.opportunity.task;

  const competingService = createCurriculumService(shared);
  await competingService.ready();
  const competing = await competingService.claimDeveloperPilotSequence(morphologySequenceBindingIds, {
    targetSkillId: morphologySkillId,
    requirePresented: () => true
  });
  assert.equal(competing.status, "blocked");
  assert.equal(competing.reason, "active-elsewhere");
  assert.equal(service.snapshot().storedDeveloperPilotClaimCount, 1);
  assert.equal(service.snapshot().storedTaskCount, 2);

  const firstWrongResult = await first.opportunity.recordFirstResponse({ score: 0 });
  await first.release();
  const persistedSequenceKeys = [
    "caatuu-czech-test.curriculum.tasks.v4",
    "caatuu-czech-test.curriculum.events.v4",
    "caatuu-czech-test.curriculum.developer-pilot-claims.v4",
    "caatuu-czech-test.curriculum.developer-pilot-sequences.v4",
    "caatuu-czech-test.curriculum.developer-pilot-step-completions.v4",
    "caatuu-czech-test.curriculum.morphology-round-states.v4"
  ];
  const beforeResumePreview = persistedSequenceKeys.map((key) => localStorage.getItem(key));
  const incomplete = await competingService.claimDeveloperPilotSequence(morphologySequenceBindingIds, {
    targetSkillId: morphologySkillId,
    requirePresented: () => false
  });
  assert.equal(incomplete.status, "blocked");
  assert.equal(incomplete.reason, "incomplete-step");
  assert.deepEqual(incomplete.taskRef, {
    taskId: firstTask.taskId,
    taskFingerprint: firstTask.taskFingerprint
  });
  assert.deepEqual(
    persistedSequenceKeys.map((key) => localStorage.getItem(key)),
    beforeResumePreview
  );
  assert.equal(competingService.snapshot().storedDeveloperPilotCompletionCount, 0);

  await assert.rejects(
    () => competingService.completeDeveloperPilotStep({
      orderedBindingIds: morphologySequenceBindingIds,
      targetSkillId: morphologySkillId,
      taskId: firstTask.taskId,
      taskFingerprint: firstTask.taskFingerprint,
      completionKind: "correct-first-response"
    }),
    (error) => error.code === "CURRICULUM_DEVELOPER_PILOT_COMPLETION_EVIDENCE_MISMATCH"
  );
  const firstRound = composeSequenceRound(morphologyCatalog, firstTask, 0);
  const wrongItemRef = firstRound.options.find((option) => (
    option.itemRef.id !== firstRound.targetItemRef.id
  )).itemRef;
  const wrongJournal = morphologySettlementJournal(
    firstTask,
    firstRound,
    firstWrongResult.event,
    "corrective-correct",
    { completed: false, selectedItemRef: wrongItemRef }
  );
  const wrongSave = await competingService.saveMorphologyRoundState(firstTask, {
    round: firstRound,
    state: wrongJournal,
    expectedRevision: 0
  });
  assert.equal(wrongSave.revision, 1);
  await assert.rejects(
    () => competingService.completeDeveloperPilotStep({
      orderedBindingIds: morphologySequenceBindingIds,
      targetSkillId: morphologySkillId,
      taskId: firstTask.taskId,
      taskFingerprint: firstTask.taskFingerprint,
      completionKind: "corrective-correct"
    }),
    (error) => error.code === "CURRICULUM_DEVELOPER_PILOT_COMPLETION_SETTLEMENT_MISMATCH"
  );
  const terminalWrongJournal = morphologySettlementJournal(
    firstTask,
    firstRound,
    firstWrongResult.event,
    "corrective-correct",
    { completed: true, selectedItemRef: wrongItemRef }
  );
  const terminalWrongSave = await competingService.saveMorphologyRoundState(firstTask, {
    round: firstRound,
    state: terminalWrongJournal,
    expectedRevision: 1
  });
  assert.equal(terminalWrongSave.revision, 2);
  for (const completionKind of ["corrective-correct", "solution-review"]) {
    await assert.rejects(
      () => competingService.completeDeveloperPilotStep({
        orderedBindingIds: morphologySequenceBindingIds,
        targetSkillId: morphologySkillId,
        taskId: firstTask.taskId,
        taskFingerprint: firstTask.taskFingerprint,
        completionKind
      }),
      (error) => error.code === "CURRICULUM_DEVELOPER_PILOT_COMPLETION_SETTLEMENT_MISMATCH"
    );
  }
  const forgedRevealJournal = morphologySettlementJournal(
    firstTask,
    firstRound,
    firstWrongResult.event,
    "solution-review",
    {
      completed: true,
      selectedItemRef: wrongItemRef,
      hintState: "solution-revealed",
      settlementKind: "first-response"
    }
  );
  const forgedRevealSave = await competingService.saveMorphologyRoundState(firstTask, {
    round: firstRound,
    state: forgedRevealJournal,
    expectedRevision: 2
  });
  assert.equal(forgedRevealSave.revision, 3);
  await assert.rejects(
    () => competingService.completeDeveloperPilotStep({
      orderedBindingIds: morphologySequenceBindingIds,
      targetSkillId: morphologySkillId,
      taskId: firstTask.taskId,
      taskFingerprint: firstTask.taskFingerprint,
      completionKind: "solution-review"
    }),
    (error) => error.code === "CURRICULUM_DEVELOPER_PILOT_COMPLETION_SETTLEMENT_MISMATCH"
  );
  const forgedCorrectionWithoutRejection = morphologySettlementJournal(
    firstTask,
    firstRound,
    firstWrongResult.event,
    "corrective-correct"
  );
  const forgedCorrectionSave = await competingService.saveMorphologyRoundState(firstTask, {
    round: firstRound,
    state: forgedCorrectionWithoutRejection,
    expectedRevision: 3
  });
  assert.equal(forgedCorrectionSave.revision, 4);
  await assert.rejects(
    () => competingService.completeDeveloperPilotStep({
      orderedBindingIds: morphologySequenceBindingIds,
      targetSkillId: morphologySkillId,
      taskId: firstTask.taskId,
      taskFingerprint: firstTask.taskFingerprint,
      completionKind: "corrective-correct"
    }),
    (error) => error.code === "CURRICULUM_DEVELOPER_PILOT_COMPLETION_SETTLEMENT_MISMATCH"
  );
  const correctedJournal = morphologySettlementJournal(
    firstTask,
    firstRound,
    firstWrongResult.event,
    "corrective-correct",
    { rejectedItemRefs: [wrongItemRef] }
  );
  const correctedSave = await competingService.saveMorphologyRoundState(firstTask, {
    round: firstRound,
    state: correctedJournal,
    expectedRevision: 4
  });
  assert.equal(correctedSave.revision, 5);
  const corrected = await competingService.completeDeveloperPilotStep({
    orderedBindingIds: morphologySequenceBindingIds,
    targetSkillId: morphologySkillId,
    taskId: firstTask.taskId,
    taskFingerprint: firstTask.taskFingerprint,
    completionKind: "corrective-correct"
  });
  const correctedAgain = await competingService.completeDeveloperPilotStep({
    orderedBindingIds: morphologySequenceBindingIds,
    targetSkillId: morphologySkillId,
    taskId: firstTask.taskId,
    taskFingerprint: firstTask.taskFingerprint,
    completionKind: "corrective-correct"
  });
  assert.deepEqual(correctedAgain, corrected);
  assert.equal(corrected.roundId, firstRound.roundId);
  assert.deepEqual(corrected.cueRef, firstRound.cue.cueRef);
  assert.equal(corrected.settlementId, correctedJournal.round.settlementId);
  assert.equal(corrected.roundStateRevision, 5);
  const settledRetry = await competingService.saveMorphologyRoundState(firstTask, {
    round: firstRound,
    state: correctedJournal,
    expectedRevision: 4
  });
  assert.equal(settledRetry.revision, 5);
  await assert.rejects(
    () => competingService.saveMorphologyRoundState(firstTask, {
      round: firstRound,
      state: { ...correctedJournal, pendingCompletionKind: null },
      expectedRevision: 5
    }),
    (error) => error.code === "CURRICULUM_MORPHOLOGY_ROUND_SETTLED"
  );

  const second = await competingService.claimDeveloperPilotSequence(morphologySequenceBindingIds, {
    targetSkillId: morphologySkillId,
    requirePresented: () => true
  });
  assert.equal(second.status, "claimed");
  assert.equal(second.bindingId, morphologySequenceBindingIds[1]);
  assert.equal(second.sequence.stepIndex, 1);
  const secondReveal = await second.opportunity.recordSolutionReveal();
  const secondRound = composeSequenceRound(morphologyCatalog, second.opportunity.task, 1);
  await competingService.saveMorphologyRoundState(second.opportunity.task, {
    round: secondRound,
    state: morphologySettlementJournal(
      second.opportunity.task,
      secondRound,
      secondReveal.event,
      "solution-review"
    ),
    expectedRevision: 0
  });
  const secondReceipt = await second.complete("solution-review");
  assert.equal(secondReceipt.stepIndex, 1);
  assert.equal(secondReceipt.completionKind, "solution-review");

  const third = await service.claimDeveloperPilotSequence(morphologySequenceBindingIds, {
    targetSkillId: morphologySkillId,
    requirePresented: () => true
  });
  assert.equal(third.status, "claimed");
  assert.equal(third.bindingId, morphologySequenceBindingIds[2]);
  assert.equal(third.sequence.stepIndex, 2);
  const thirdCorrect = await third.opportunity.recordFirstResponse({ score: 1 });
  const thirdRound = composeSequenceRound(morphologyCatalog, third.opportunity.task, 2);
  await service.saveMorphologyRoundState(third.opportunity.task, {
    round: thirdRound,
    state: morphologySettlementJournal(
      third.opportunity.task,
      thirdRound,
      thirdCorrect.event,
      "correct-first-response"
    ),
    expectedRevision: 0
  });
  const thirdReceipt = await third.complete("correct-first-response");
  assert.equal(thirdReceipt.stepIndex, 2);

  const complete = await service.claimDeveloperPilotSequence(morphologySequenceBindingIds, {
    targetSkillId: morphologySkillId,
    requirePresented: () => true
  });
  assert.equal(complete.status, "complete");
  assert.equal(complete.reason, "sequence-complete");
  assert.equal(complete.sequence.stepIndex, 3);
  assert.equal(complete.sequence.bindingId, null);
  assert.equal(service.snapshot().storedDeveloperPilotClaimCount, 3);
  assert.equal(service.snapshot().storedDeveloperPilotCompletionCount, 3);
  assert.equal(service.snapshot().storedTaskCount, 6);
  assert.equal(service.snapshot().storedEventCount, 6);
});

test("authored two-step and four-step morphology sequences remain durable and operable", async (t) => {
  for (const length of [2, 4]) {
    await t.test(`${length} authored steps`, async () => {
      const base = await fixture({ morphologySequenceLength: length });
      const localStorage = new MemoryStorage();
      let id = 0;
      const shared = serviceOptions(base, {
        localStorage,
        uuid: () => `morph-${length}-step-${++id}`
      });
      const service = createCurriculumService(shared);
      const ready = await service.ready();
      assert.equal(ready.validation.summary.exerciseSequences, 1);
      const catalog = await readJson("cs-CZ.morphology-developer-pilot.v1.json");
      const orderedBindingIds = base.sequenceBindingIds;

      const initialPreview = await service.claimDeveloperPilotSequence(orderedBindingIds, {
        targetSkillId: morphologySkillId,
        requirePresented: () => false
      });
      assert.equal(initialPreview.status, "deferred");
      assert.equal(initialPreview.sequence.totalSteps, length);
      await assert.rejects(
        () => service.claimDeveloperPilotSequence(orderedBindingIds, {
          targetSkillId: morphologySkillId,
          expectedStep: {
            bindingId: orderedBindingIds[0],
            stepIndex: length,
            sequenceFingerprint: initialPreview.sequence.fingerprint
          },
          requirePresented: () => true
        }),
        (error) => error.code === "CURRICULUM_DEVELOPER_PILOT_EXPECTED_STEP_INVALID"
      );
      await assert.rejects(
        () => service.claimDeveloperPilotSequence(orderedBindingIds, {
          targetSkillId: morphologySkillId,
          expectedStep: {
            bindingId: orderedBindingIds[1],
            stepIndex: 0,
            sequenceFingerprint: initialPreview.sequence.fingerprint
          },
          requirePresented: () => true
        }),
        (error) => error.code === "CURRICULUM_DEVELOPER_PILOT_EXPECTED_STEP_INVALID"
      );

      for (let stepIndex = 0; stepIndex < length; stepIndex += 1) {
        const preview = stepIndex === 0
          ? initialPreview
          : await service.claimDeveloperPilotSequence(orderedBindingIds, {
            targetSkillId: morphologySkillId,
            requirePresented: () => false
          });
        assert.equal(preview.status, "deferred");
        assert.equal(preview.bindingId, orderedBindingIds[stepIndex]);
        assert.equal(preview.sequence.stepIndex, stepIndex);
        assert.equal(preview.sequence.totalSteps, length);
        const claim = await service.claimDeveloperPilotSequence(orderedBindingIds, {
          targetSkillId: morphologySkillId,
          expectedStep: preview.sequence.expectedStep,
          requirePresented: () => true
        });
        assert.equal(claim.status, "claimed");
        assert.equal(claim.bindingId, orderedBindingIds[stepIndex]);
        const reveal = await claim.opportunity.recordSolutionReveal();
        const round = composeSequenceRound(catalog, claim.opportunity.task, stepIndex);
        await service.saveMorphologyRoundState(claim.opportunity.task, {
          round,
          state: morphologySettlementJournal(
            claim.opportunity.task,
            round,
            reveal.event,
            "solution-review"
          ),
          expectedRevision: 0
        });
        const receipt = await claim.complete("solution-review");
        assert.equal(receipt.stepIndex, stepIndex);
        assert.equal(receipt.bindingId, orderedBindingIds[stepIndex]);
      }

      const complete = await service.claimDeveloperPilotSequence(orderedBindingIds, {
        targetSkillId: morphologySkillId,
        requirePresented: () => true
      });
      assert.equal(complete.status, "complete");
      assert.equal(complete.sequence.stepIndex, length);
      assert.equal(complete.sequence.totalSteps, length);
      assert.equal(service.snapshot().storedDeveloperPilotClaimCount, length);
      assert.equal(service.snapshot().storedDeveloperPilotCompletionCount, length);

      const claimKey = "caatuu-czech-test.curriculum.developer-pilot-claims.v4";
      const validClaims = JSON.parse(localStorage.getItem(claimKey));
      const outOfRangeClaims = structuredClone(validClaims);
      outOfRangeClaims[0].sequenceStepIndex = length;
      localStorage.setItem(claimKey, JSON.stringify(outOfRangeClaims));
      await assert.rejects(
        () => createCurriculumService(shared).ready(),
        (error) => error.code === "CURRICULUM_STORAGE_CORRUPT"
      );
      localStorage.setItem(claimKey, JSON.stringify(validClaims));

      const completionKey = "caatuu-czech-test.curriculum.developer-pilot-step-completions.v4";
      const validCompletions = JSON.parse(localStorage.getItem(completionKey));
      const mismatchedCompletions = structuredClone(validCompletions);
      mismatchedCompletions[0].bindingId = orderedBindingIds[1];
      localStorage.setItem(completionKey, JSON.stringify(mismatchedCompletions));
      await assert.rejects(
        () => createCurriculumService(shared).ready(),
        (error) => error.code === "CURRICULUM_STORAGE_CORRUPT"
      );
    });
  }
});

test("first-correct morphology settlement requires exact hint-state parity", async () => {
  const base = await fixture({ withMorphologySequence: true });
  let id = 0;
  const service = createCurriculumService(serviceOptions(base, {
    uuid: () => `first-correct-hint-parity-${++id}`
  }));
  await service.ready();
  const catalog = await readJson("cs-CZ.morphology-developer-pilot.v1.json");
  for (const [stepIndex, scenario] of [
    [0, { markHint: false, forgedHintState: "used", validHintState: "available" }],
    [1, { markHint: true, forgedHintState: "available", validHintState: "used" }]
  ]) {
    const claim = await service.claimDeveloperPilotSequence(morphologySequenceBindingIds, {
      targetSkillId: morphologySkillId,
      requirePresented: () => true
    });
    assert.equal(claim.status, "claimed");
    assert.equal(claim.sequence.stepIndex, stepIndex);
    if (scenario.markHint) claim.opportunity.markHint();
    const response = await claim.opportunity.recordFirstResponse({ score: 1 });
    assert.equal(response.event.outcome.hintsUsed, scenario.markHint ? 1 : 0);
    const round = composeSequenceRound(catalog, claim.opportunity.task, stepIndex);
    const forged = morphologySettlementJournal(
      claim.opportunity.task,
      round,
      response.event,
      "correct-first-response",
      { hintState: scenario.forgedHintState }
    );
    await service.saveMorphologyRoundState(claim.opportunity.task, {
      round,
      state: forged,
      expectedRevision: 0
    });
    await assert.rejects(
      () => claim.complete("correct-first-response"),
      (error) => error.code === "CURRICULUM_DEVELOPER_PILOT_COMPLETION_SETTLEMENT_MISMATCH"
    );
    const valid = morphologySettlementJournal(
      claim.opportunity.task,
      round,
      response.event,
      "correct-first-response",
      { hintState: scenario.validHintState }
    );
    await service.saveMorphologyRoundState(claim.opportunity.task, {
      round,
      state: valid,
      expectedRevision: 1
    });
    const receipt = await claim.complete("correct-first-response");
    assert.equal(receipt.stepIndex, stepIndex);
  }
});

test("a wrong first response can settle only after the exact solution-reveal checkpoint", async () => {
  const base = await fixture({ withMorphologySequence: true });
  const service = createCurriculumService(serviceOptions(base, {
    uuid: (() => {
      let id = 0;
      return () => `wrong-reveal-${++id}`;
    })()
  }));
  await service.ready();
  const catalog = await readJson("cs-CZ.morphology-developer-pilot.v1.json");
  const claim = await service.claimDeveloperPilotSequence(morphologySequenceBindingIds, {
    targetSkillId: morphologySkillId,
    requirePresented: () => true
  });
  const task = claim.opportunity.task;
  const event = (await claim.opportunity.recordFirstResponse({ score: 0 })).event;
  const round = composeSequenceRound(catalog, task, 0);
  const wrongItemRef = round.options.find((option) => (
    option.itemRef.id !== round.targetItemRef.id
  )).itemRef;
  const otherWrongItemRef = round.options.find((option) => (
    option.itemRef.id !== round.targetItemRef.id
      && option.itemRef.id !== wrongItemRef.id
  )).itemRef;
  async function saveAndReject(state, expectedRevision) {
    const saved = await service.saveMorphologyRoundState(task, {
      round,
      state,
      expectedRevision
    });
    assert.equal(saved.revision, expectedRevision + 1);
    await assert.rejects(
      () => service.completeDeveloperPilotStep({
        orderedBindingIds: morphologySequenceBindingIds,
        targetSkillId: morphologySkillId,
        taskId: task.taskId,
        taskFingerprint: task.taskFingerprint,
        completionKind: "solution-review"
      }),
      (error) => error.code === "CURRICULUM_DEVELOPER_PILOT_COMPLETION_SETTLEMENT_MISMATCH"
    );
  }
  const forgedPlainWrong = morphologySettlementJournal(
    task,
    round,
    event,
    "solution-review",
    { selectedItemRef: wrongItemRef, settlementKind: "first-response" }
  );
  await saveAndReject(forgedPlainWrong, 0);
  const revealed = morphologySettlementJournal(
    task,
    round,
    event,
    "solution-review",
    { selectedItemRef: wrongItemRef }
  );
  const missingTerminalKind = structuredClone(revealed);
  delete missingTerminalKind.terminalCompletionKind;
  await saveAndReject(missingTerminalKind, 1);
  await saveAndReject({
    ...revealed,
    terminalCompletionKind: "corrective-correct"
  }, 2);
  await saveAndReject({
    ...revealed,
    pendingEvidence: {
      request: { score: 0 },
      completionKind: "solution-review"
    }
  }, 3);
  const missingRoundSchema = structuredClone(revealed);
  delete missingRoundSchema.round.schemaVersion;
  await saveAndReject(missingRoundSchema, 4);
  await saveAndReject({
    ...revealed,
    round: {
      ...revealed.round,
      schemaVersion: 2
    }
  }, 5);
  await saveAndReject({
    ...revealed,
    round: {
      ...revealed.round,
      selectedItemRef: structuredClone(round.targetItemRef)
    }
  }, 6);
  await saveAndReject({
    ...revealed,
    round: {
      ...revealed.round,
      selectedItemRef: structuredClone(otherWrongItemRef)
    }
  }, 7);
  const saved = await service.saveMorphologyRoundState(task, {
    round,
    state: revealed,
    expectedRevision: 8
  });
  assert.equal(saved.revision, 9);
  const receipt = await claim.complete("solution-review");
  assert.equal(receipt.completionKind, "solution-review");
  assert.equal(receipt.settlementId, morphologySettlementId(task, round, "solution-reveal"));
  assert.equal(receipt.roundStateRevision, 9);
});

test("a stale morphology preview defers instead of claiming a newly advanced step", async () => {
  const base = await fixture({ withMorphologySequence: true });
  const localStorage = new MemoryStorage();
  const sessionStorage = new MemoryStorage();
  const lockManager = new MemoryLockManager();
  let id = 0;
  const shared = serviceOptions(base, {
    localStorage,
    sessionStorage,
    lockManager,
    uuid: () => `stale-morph-preview-${++id}`
  });
  const previewService = createCurriculumService(shared);
  const advancingService = createCurriculumService(shared);
  await Promise.all([previewService.ready(), advancingService.ready()]);
  const catalog = await readJson("cs-CZ.morphology-developer-pilot.v1.json");
  const preview = await previewService.claimDeveloperPilotSequence(morphologySequenceBindingIds, {
    targetSkillId: morphologySkillId,
    requirePresented: () => false
  });
  const first = await advancingService.claimDeveloperPilotSequence(morphologySequenceBindingIds, {
    targetSkillId: morphologySkillId,
    expectedStep: preview.sequence.expectedStep,
    requirePresented: () => true
  });
  const firstResponse = await first.opportunity.recordFirstResponse({ score: 1 });
  const firstRound = composeSequenceRound(catalog, first.opportunity.task, 0);
  await advancingService.saveMorphologyRoundState(first.opportunity.task, {
    round: firstRound,
    state: morphologySettlementJournal(
      first.opportunity.task,
      firstRound,
      firstResponse.event,
      "correct-first-response"
    ),
    expectedRevision: 0
  });
  await first.complete("correct-first-response");

  const stale = await previewService.claimDeveloperPilotSequence(morphologySequenceBindingIds, {
    targetSkillId: morphologySkillId,
    expectedStep: preview.sequence.expectedStep,
    requirePresented: () => true
  });
  assert.equal(stale.status, "deferred");
  assert.equal(stale.reason, "sequence-step-changed");
  assert.equal(stale.bindingId, morphologySequenceBindingIds[1]);
  assert.equal(stale.sequence.stepIndex, 1);
  assert.equal(stale.preview.contentRef.contentId, "cs.morphology.cist.present-singular-person.2sg");
  assert.equal(previewService.snapshot().storedDeveloperPilotClaimCount, 1);
  assert.equal(previewService.snapshot().storedTaskCount, 2);
  assert.equal(previewService.snapshot().storedEventCount, 2);
});

test("an exact morphology round survives reload while round collisions and corruption fail closed", async () => {
  const base = await fixture({ withMorphologySequence: true });
  const localStorage = new MemoryStorage();
  const sessionStorage = new MemoryStorage();
  const lockManager = new MemoryLockManager();
  let id = 0;
  const shared = serviceOptions(base, {
    localStorage,
    sessionStorage,
    lockManager,
    uuid: () => `morph-round-state-${++id}`
  });
  const service = createCurriculumService(shared);
  await service.ready();
  const claim = await service.claimDeveloperPilotSequence(morphologySequenceBindingIds, {
    targetSkillId: morphologySkillId,
    requirePresented: () => true
  });
  const task = claim.opportunity.task;
  const beforeSave = await service.restoreMorphologyRoundState({
    taskId: task.taskId,
    taskFingerprint: task.taskFingerprint
  });
  assert.deepEqual(beforeSave, {
    task,
    round: null,
    state: null,
    revision: 0,
    savedAt: null
  });
  const catalog = await readJson("cs-CZ.morphology-developer-pilot.v1.json");
  const wrongStepRound = composeMorphologyRound(catalog, {
    catalogRef: { id: catalog.catalogId, version: catalog.version },
    familyRef: { id: "cs.morphology.family.cist.present-singular", revision: 1 },
    cueRef: { id: "cs.cue.cist.read.addressee-singular-current", revision: 2 },
    taskFingerprint: task.taskFingerprint
  });
  await assert.rejects(
    () => service.saveMorphologyRoundState(task, {
      round: wrongStepRound,
      state: { phase: "awaiting-response" },
      expectedRevision: 0
    }),
    (error) => error.code === "CURRICULUM_MORPHOLOGY_ROUND_STATE_INVALID"
  );
  const round = composeMorphologyRound(catalog, {
    catalogRef: { id: catalog.catalogId, version: catalog.version },
    familyRef: { id: "cs.morphology.family.cist.present-singular", revision: 1 },
    cueRef: { id: "cs.cue.cist.read.speaker-singular-current", revision: 1 },
    taskFingerprint: task.taskFingerprint
  });
  await assert.rejects(
    () => service.saveMorphologyRoundState(task, {
      round,
      state: { phase: "awaiting-response", selectedItemRef: null },
      expectedRevision: 1
    }),
    (error) => error.code === "CURRICULUM_MORPHOLOGY_ROUND_REVISION_CONFLICT"
  );
  const saved = await service.saveMorphologyRoundState(task, {
    round,
    state: { phase: "awaiting-response", selectedItemRef: null },
    expectedRevision: 0
  });
  assert.equal(saved.taskId, task.taskId);
  assert.equal(saved.roundId, round.roundId);
  assert.equal(saved.revision, 1);
  assert.equal(service.snapshot().storedMorphologyRoundStateCount, 1);
  await claim.release();

  const storageKey = "caatuu-czech-test.curriculum.morphology-round-states.v4";
  const legacyRecords = JSON.parse(localStorage.getItem(storageKey));
  legacyRecords[0].schemaVersion = "caatuu-morphology-round-state-v1";
  delete legacyRecords[0].revision;
  localStorage.setItem(storageKey, JSON.stringify(legacyRecords));

  const reloaded = createCurriculumService(shared);
  const staleWriter = createCurriculumService(shared);
  await Promise.all([reloaded.ready(), staleWriter.ready()]);
  const restored = await reloaded.restoreMorphologyRoundState({
    taskId: task.taskId,
    taskFingerprint: task.taskFingerprint
  });
  assert.deepEqual(restored.task, task);
  assert.deepEqual(restored.round, round);
  assert.deepEqual(restored.state, { phase: "awaiting-response", selectedItemRef: null });
  assert.equal(restored.revision, 1);
  const staleRestore = await staleWriter.restoreMorphologyRoundState({
    taskId: task.taskId,
    taskFingerprint: task.taskFingerprint
  });
  assert.equal(staleRestore.revision, 1);
  const updatedState = { phase: "corrective", selectedItemRef: round.options[0].itemRef };
  const updated = await reloaded.saveMorphologyRoundState(restored.task, {
    round: restored.round,
    state: updatedState,
    expectedRevision: restored.revision
  });
  assert.equal(updated.state.phase, "corrective");
  assert.equal(updated.revision, 2);
  await assert.rejects(
    () => staleWriter.saveMorphologyRoundState(staleRestore.task, {
      round: staleRestore.round,
      state: { phase: "stale-writer", selectedItemRef: null },
      expectedRevision: staleRestore.revision
    }),
    (error) => error.code === "CURRICULUM_MORPHOLOGY_ROUND_REVISION_CONFLICT"
  );
  const duplicateRetry = await staleWriter.saveMorphologyRoundState(staleRestore.task, {
    round: staleRestore.round,
    state: updatedState,
    expectedRevision: staleRestore.revision
  });
  assert.equal(duplicateRetry.revision, 2);
  assert.deepEqual(duplicateRetry.state, updatedState);

  const collidingRound = structuredClone(round);
  collidingRound.options[0].surface = `${collidingRound.options[0].surface}!`;
  await assert.rejects(
    () => reloaded.saveMorphologyRoundState(task, {
      round: collidingRound,
      state: { phase: "awaiting-response" },
      expectedRevision: 2
    }),
    (error) => error.code === "CURRICULUM_MORPHOLOGY_ROUND_COLLISION"
  );

  const forgedTarget = structuredClone(round);
  forgedTarget.targetItemRef = forgedTarget.options.find((option) => (
    option.itemRef.id !== round.targetItemRef.id
  )).itemRef;
  await assert.rejects(
    () => reloaded.saveMorphologyRoundState(task, {
      round: forgedTarget,
      state: { phase: "awaiting-response" },
      expectedRevision: 2
    }),
    (error) => error.code === "CURRICULUM_MORPHOLOGY_ROUND_STATE_INVALID"
  );

  const currentRecords = JSON.parse(localStorage.getItem(storageKey));
  const missingRevision = structuredClone(currentRecords);
  delete missingRevision[0].revision;
  localStorage.setItem(storageKey, JSON.stringify(missingRevision));
  const missingRevisionReload = createCurriculumService(shared);
  await assert.rejects(
    () => missingRevisionReload.ready(),
    (error) => error.code === "CURRICULUM_STORAGE_CORRUPT"
  );
  localStorage.setItem(storageKey, JSON.stringify(currentRecords));
  const corrupted = structuredClone(currentRecords);
  corrupted[0].taskFingerprint = "sha256:stale";
  localStorage.setItem(storageKey, JSON.stringify(corrupted));
  const corruptReload = createCurriculumService(shared);
  await assert.rejects(
    () => corruptReload.ready(),
    (error) => error.code === "CURRICULUM_STORAGE_CORRUPT"
  );
});

test("both Guided games preserve encounter-before-assessment without manufacturing retrieval", async () => {
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
      capabilityId: activityId === "word-world"
        ? "independent-comprehension"
        : "independent-discrimination",
      targetSkillId: "cs.skill.sense.cist.read"
    });
    await lifecycle.activate();
    await lifecycle.recordFirstResponse({ score: 1 });
  }

  assert.equal(service.snapshot().storedTaskCount, 4);
  assert.equal(service.snapshot().storedEventCount, 4);
  const tasks = JSON.parse(localStorage.getItem("caatuu-czech-test.curriculum.tasks.v4"));
  for (const activityId of ["word-world", "verb-nebula"]) {
    const activityTasks = tasks.filter((task) => task.activityId === activityId);
    const exposure = activityTasks.find((task) => task.evidenceKind === "exposure");
    const assessment = activityTasks.find((task) => task.evidenceKind === "comprehension");
    assert.ok(exposure.taskSequence < assessment.taskSequence);
  }

  const summary = await service.skillSummary("cs.skill.sense.cist.read");
  assert.equal(summary.exposureEvents, 2);
  assert.equal(summary.assessedAttempts, 2);
  assert.equal(summary.independentRetrievals, 0);
  assert.equal(summary.productionEvidence, 0);
  assert.equal(summary.transferEvidence, 0);
  assert.deepEqual(summary.contributingActivityIds, []);
  assert.equal(summary.qualifyingSessionIds.length, 0);
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
  const task = await service.issueTask("binding.verb-nebula.cs.verb.cist.read", "independent-discrimination", {
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
    capabilityId: "independent-comprehension",
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
    capabilityId: "independent-discrimination",
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
  const opportunity = await service.beginOpportunity("word-world", "ww-cp-000146", {
    capabilityId: "independent-comprehension"
  });
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

test("the v2 ledger ignores incompatible pre-reclassification v1 storage", async () => {
  const base = await fixture();
  const localStorage = new MemoryStorage();
  localStorage.setItem("caatuu-czech-test.curriculum.tasks.v1", "not-json");
  localStorage.setItem("caatuu-czech-test.curriculum.events.v1", "not-json");
  localStorage.setItem("caatuu-czech-test.curriculum.developer-pilot-claims.v1", "not-json");
  const service = createCurriculumService(serviceOptions(base, { localStorage }));

  const readiness = await service.ready();
  assert.equal(readiness.status, "ready");
  assert.equal(service.snapshot().storedTaskCount, 0);
  assert.equal(service.snapshot().storedEventCount, 0);
  assert.equal(service.snapshot().storedDeveloperPilotClaimCount, 0);
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
  localStorage.setItem("caatuu-czech-test.curriculum.events.v4", "not-json");
  const corrupt = createCurriculumService(serviceOptions(base, { localStorage }));
  await assert.rejects(
    () => corrupt.ready(),
    (error) => error.code === "CURRICULUM_STORAGE_CORRUPT"
  );
});
