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

const STORAGE_VERSION = 1;
const MAX_STORED_TASKS = 2000;
const MAX_STORED_EVENTS = 4000;

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
  uuid = defaultUuid
} = {}) {
  const configuration = courseProfile?.curriculum;
  if (!isObject(configuration)) throw new CurriculumServiceError("CURRICULUM_CONFIG_MISSING", "Course profile requires a curriculum configuration.");
  if (typeof fetchImpl !== "function") throw new CurriculumServiceError("CURRICULUM_FETCH_MISSING", "Curriculum service requires fetch.");
  if (!localStorage || !sessionStorage) throw new CurriculumServiceError("CURRICULUM_STORAGE_MISSING", "Curriculum service requires local and session storage.");

  const namespace = String(courseProfile?.storage?.namespace || courseProfile?.id || "caatuu");
  const tasksKey = `${namespace}.curriculum.tasks.v${STORAGE_VERSION}`;
  const eventsKey = `${namespace}.curriculum.events.v${STORAGE_VERSION}`;
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
    const response = await fetchImpl(path, { cache: "no-store", headers: { accept: "application/json" } });
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
      await aggregateLearningEvidence(curriculum, bindingRegistry, readStoredArray(tasksKey), readStoredArray(eventsKey));
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

  async function issueTask(bindingId, capabilityId, { targetSkillId } = {}) {
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
      tasks.push(task);
      writeStoredArray(tasksKey, tasks, MAX_STORED_TASKS);
    }
    return clone(task);
  }

  async function recordEvidence(task, {
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
      qualifiesForMastery: eventValidation.qualifiesForMastery,
      skillSummary: clone(summaries.find((row) => row.targetSkillId === task.targetSkillId) || null)
    };
  }

  async function recordExposure(bindingId, { targetSkillId } = {}) {
    const task = await issueTask(bindingId, "exposure", { targetSkillId });
    return recordEvidence(task, { score: null, solutionRevealed: false, hintsUsed: 0 });
  }

  async function beginOpportunity(activityId, stableContentId, {
    capabilityId = "independent-retrieval",
    targetSkillId
  } = {}) {
    await requireReady();
    const resolution = resolveRuntimeBinding(bundle, activityId, stableContentId);
    const task = await issueTask(resolution.binding.id, capabilityId, { targetSkillId });
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

  async function skillSummary(targetSkillId) {
    await requireReady();
    const summaries = await aggregateLearningEvidence(
      bundle.curriculum,
      bundle.bindingRegistry,
      readStoredArray(tasksKey),
      readStoredArray(eventsKey)
    );
    return clone(summaries.find((row) => row.targetSkillId === targetSkillId) || null);
  }

  async function progression() {
    await requireReady();
    const sessionId = currentSessionId();
    return clone(await computeCurriculumProgression({
      curriculum: bundle.curriculum,
      targetPack: bundle.targetPack,
      bindingRegistry: bundle.bindingRegistry,
      tasks: readStoredArray(tasksKey),
      events: readStoredArray(eventsKey),
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
      storedEventCount: (() => { try { return readStoredArray(eventsKey).length; } catch { return null; } })()
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
    skillSummary,
    progression,
    nextRequest,
    snapshot
  });
}
