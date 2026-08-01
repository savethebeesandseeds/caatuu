import {
  aggregateLearningEvidence,
  canonicalJson,
  createLearningEvidenceEvent,
  issueLearningTask,
  resolveRuntimeBinding,
  validateLearningEvidenceEvent,
  validateLearningTask,
  validateRuntimeBundle
} from "./curriculum-runtime-core.mjs";
import { computeCurriculumProgression } from "./curriculum-planner-core.mjs";

const STORAGE_VERSION = 2;
const MAX_STORED_TASKS = 2000;
const MAX_STORED_EVENTS = 4000;
const MAX_STORED_DEVELOPER_PILOT_CLAIMS = 256;

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
      ) {
        throw new CurriculumServiceError(
          "CURRICULUM_STORAGE_CORRUPT",
          `Stored developer pilot claim data at ${developerPilotClaimsKey} is invalid.`
        );
      }
    }
    return claims;
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
      await aggregateLearningEvidence(curriculum, bindingRegistry, ledger.tasks, ledger.events);
      status = "ready";
      return {
        status,
        guidedModeEnabled: guidedModeEnabled(),
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
    requirePresented
  } = {}) {
    await requireReady();
    if (!guidedModeEnabled()) {
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
              claims.push({
                bindingId: binding.id,
                targetSkillId: skillRef.id,
                capabilityId: capability.id,
                claimedAt: developerPilotClaimTime(),
                sessionId: currentSessionId()
              });
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
          claims.push({
            bindingId: binding.id,
            targetSkillId: skillRef.id,
            capabilityId: capability.id,
            claimedAt,
            sessionId: currentSessionId()
          });
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
    return performDeveloperPilotClaim(bindingId, options);
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
      failure: failure ? { code: failure.code, message: failure.message, details: clone(failure.details) } : null,
      validation: validation ? clone(validation) : null,
      storedTaskCount: (() => { try { return readStoredArray(tasksKey).length; } catch { return null; } })(),
      storedEventCount: (() => { try { return readStoredArray(eventsKey).length; } catch { return null; } })(),
      storedDeveloperPilotClaimCount: (() => { try { return readDeveloperPilotClaims().length; } catch { return null; } })()
    };
  }

  return Object.freeze({
    ready,
    guidedModeEnabled,
    resolveBinding,
    issueTask,
    beginOpportunity,
    recordEvidence,
    recordExposure,
    claimDeveloperPilot,
    skillSummary,
    progression,
    nextRequest,
    snapshot
  });
}
