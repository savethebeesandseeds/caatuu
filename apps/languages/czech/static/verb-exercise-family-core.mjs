export const VERB_EXERCISE_FAMILIES = Object.freeze({
  MEANING: "meaning",
  MORPHOLOGY: "morphology"
});

export const VERB_EXERCISE_MODES = Object.freeze({
  EXPLORE: "explore",
  GUIDED: "guided"
});

export const VERB_HINT_STATES = Object.freeze({
  AVAILABLE: "available",
  USED: "used",
  SOLUTION_REVEALED: "solution-revealed"
});

export const VERB_MEMORY_SCHEMA_VERSION = 3;
export const VERB_FAMILY_ROUND_SCHEMA_VERSION = 1;
export const VERB_SETTLEMENT_SCHEMA_VERSION = 1;
export const SHARED_MORPHOLOGY_ROUND_SCHEMA = "caatuu-morphology-selection-round-v1";

const exerciseFamilyIds = new Set(Object.values(VERB_EXERCISE_FAMILIES));
const exerciseModes = new Set(Object.values(VERB_EXERCISE_MODES));
const hintStates = new Set(Object.values(VERB_HINT_STATES));
const settlementKinds = new Set(["first-response", "solution-reveal"]);
const defaultSettlementHistoryLimit = 1024;
const stableReferencePartPattern = /^[A-Za-z0-9][A-Za-z0-9._~:/@+\-]*$/u;

function verbFamilyError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function cloneJsonValue(value, path = "value") {
  if (value == null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) {
    return value.map((entry, index) => cloneJsonValue(entry, `${path}[${index}]`));
  }
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => (
      [key, cloneJsonValue(entry, `${path}.${key}`)]
    )));
  }
  throw verbFamilyError(
    "VERB_FAMILY_NOT_JSON_SAFE",
    `${path} must contain only JSON-safe values.`
  );
}

function normalizedText(value) {
  return String(value ?? "").trim().normalize("NFC");
}

function requiredText(value, field, { maxLength = 1024 } = {}) {
  const text = normalizedText(value);
  if (!text) {
    throw verbFamilyError(
      "VERB_FAMILY_REQUIRED_TEXT",
      `${field} must be a non-empty string.`
    );
  }
  if (text.length > maxLength) {
    throw verbFamilyError(
      "VERB_FAMILY_TEXT_TOO_LONG",
      `${field} must not exceed ${maxLength} characters.`
    );
  }
  return text;
}

function optionalText(value, field, options) {
  const text = normalizedText(value);
  return text ? requiredText(text, field, options) : "";
}

function normalizedFamily(exerciseFamily) {
  const family = normalizedText(exerciseFamily);
  if (!exerciseFamilyIds.has(family)) {
    throw verbFamilyError(
      "VERB_EXERCISE_FAMILY_INVALID",
      `Unknown Verb exercise family: ${family || "(empty)"}.`
    );
  }
  return family;
}

function normalizedMode(mode) {
  const normalized = normalizedText(mode);
  if (!exerciseModes.has(normalized)) {
    throw verbFamilyError(
      "VERB_EXERCISE_MODE_INVALID",
      `Unknown Verb exercise mode: ${normalized || "(empty)"}.`
    );
  }
  return normalized;
}

function normalizedHintState(value) {
  const state = normalizedText(value || VERB_HINT_STATES.AVAILABLE);
  if (!hintStates.has(state)) {
    throw verbFamilyError(
      "VERB_HINT_STATE_INVALID",
      `Unknown Verb hint state: ${state || "(empty)"}.`
    );
  }
  return state;
}

function uniqueIdList(value, field, { minimum = 0, maxLength = 512 } = {}) {
  if (value == null) {
    if (minimum > 0) {
      throw verbFamilyError(
        "VERB_FAMILY_IDS_MISSING",
        `${field} requires at least ${minimum} identifiers.`
      );
    }
    return [];
  }
  if (!Array.isArray(value)) {
    throw verbFamilyError(
      "VERB_FAMILY_IDS_INVALID",
      `${field} must be an array of identifiers.`
    );
  }
  const ids = value.map((entry, index) => (
    requiredText(entry, `${field}[${index}]`, { maxLength })
  ));
  if (new Set(ids).size !== ids.length) {
    throw verbFamilyError(
      "VERB_FAMILY_IDS_DUPLICATE",
      `${field} must not contain duplicate identifiers.`
    );
  }
  if (ids.length < minimum) {
    throw verbFamilyError(
      "VERB_FAMILY_IDS_MISSING",
      `${field} requires at least ${minimum} identifiers.`
    );
  }
  return ids;
}

function ensureMembers(ids, allowedIds, field) {
  const unknown = ids.find((id) => !allowedIds.has(id));
  if (unknown) {
    throw verbFamilyError(
      "VERB_FAMILY_ROUND_REFERENCE_INVALID",
      `${field} contains ${unknown}, which is not part of this round.`
    );
  }
}

function normalizeEntityRef(value, field) {
  if (!isPlainObject(value)) {
    throw verbFamilyError(
      "VERB_FAMILY_ENTITY_REF_INVALID",
      `${field} must be an id/revision reference.`
    );
  }
  const revision = Number(value.revision);
  if (!Number.isInteger(revision) || revision < 1) {
    throw verbFamilyError(
      "VERB_FAMILY_ENTITY_REF_INVALID",
      `${field}.revision must be a positive integer.`
    );
  }
  return {
    id: requiredText(value.id, `${field}.id`, { maxLength: 512 }),
    revision
  };
}

function entityRefKey(value) {
  return `${encodeURIComponent(value.id)}@${value.revision}`;
}

function uniqueEntityRefs(value, field, { minimum = 0 } = {}) {
  if (value == null) {
    if (minimum > 0) {
      throw verbFamilyError(
        "VERB_FAMILY_ENTITY_REFS_MISSING",
        `${field} requires at least ${minimum} references.`
      );
    }
    return [];
  }
  if (!Array.isArray(value)) {
    throw verbFamilyError(
      "VERB_FAMILY_ENTITY_REFS_INVALID",
      `${field} must be an array of id/revision references.`
    );
  }
  const refs = value.map((entry, index) => normalizeEntityRef(entry, `${field}[${index}]`));
  const keys = refs.map(entityRefKey);
  if (new Set(keys).size !== keys.length) {
    throw verbFamilyError(
      "VERB_FAMILY_ENTITY_REFS_DUPLICATE",
      `${field} must not contain duplicate references.`
    );
  }
  if (refs.length < minimum) {
    throw verbFamilyError(
      "VERB_FAMILY_ENTITY_REFS_MISSING",
      `${field} requires at least ${minimum} references.`
    );
  }
  return refs;
}

function nonNegativeInteger(value, field, fallback = 0) {
  if (value == null || value === "") return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) {
    throw verbFamilyError(
      "VERB_FAMILY_INTEGER_INVALID",
      `${field} must be a non-negative integer.`
    );
  }
  return number;
}

function encodedReferencePart(value, field) {
  const text = requiredText(value, field, { maxLength: 512 });
  if (!stableReferencePartPattern.test(text)) {
    throw verbFamilyError(
      "VERB_FAMILY_REFERENCE_PART_INVALID",
      `${field} must be a stable ASCII identifier or fingerprint.`
    );
  }
  return encodeURIComponent(text);
}

function assertReferenceFamily(reference, prefix, exerciseFamily, field) {
  const value = requiredText(reference, field, { maxLength: 4096 });
  const expectedPrefix = `${prefix}:${exerciseFamily}:`;
  if (!value.startsWith(expectedPrefix)) {
    throw verbFamilyError(
      "VERB_FAMILY_REFERENCE_MISMATCH",
      `${field} does not belong to the ${exerciseFamily} exercise family.`
    );
  }
  return value;
}

function normalizeMeaningRound(round) {
  if (!isPlainObject(round)) {
    throw verbFamilyError(
      "VERB_FAMILY_ROUND_INVALID",
      "Meaning round state must be an object."
    );
  }
  const roundIds = uniqueIdList(round.roundIds, "roundIds");
  const roundIdSet = new Set(roundIds);
  const englishRoundIds = uniqueIdList(round.englishRoundIds, "englishRoundIds");
  const matchedIds = uniqueIdList(round.matchedIds, "matchedIds");
  ensureMembers(englishRoundIds, roundIdSet, "englishRoundIds");
  ensureMembers(matchedIds, roundIdSet, "matchedIds");
  if (englishRoundIds.length && englishRoundIds.length !== roundIds.length) {
    throw verbFamilyError(
      "VERB_MEANING_ROUND_CHOICES_INCOMPLETE",
      "A persisted meaning round must retain every English choice."
    );
  }
  return {
    schemaVersion: VERB_FAMILY_ROUND_SCHEMA_VERSION,
    exerciseFamily: VERB_EXERCISE_FAMILIES.MEANING,
    roundIds,
    englishRoundIds,
    matchedIds,
    hintsEnabled: Boolean(round.hintsEnabled)
  };
}

function normalizeMorphologyRound(round) {
  if (!isPlainObject(round)) {
    throw verbFamilyError(
      "VERB_FAMILY_ROUND_INVALID",
      "Morphology round state must be an object."
    );
  }
  const exerciseFamily = VERB_EXERCISE_FAMILIES.MORPHOLOGY;
  const taskRef = assertReferenceFamily(
    round.taskRef,
    "verb-task:v1",
    exerciseFamily,
    "taskRef"
  );
  const itemRef = assertReferenceFamily(
    round.itemRef,
    "verb-item:v1",
    exerciseFamily,
    "itemRef"
  );
  const optionRefs = uniqueEntityRefs(round.optionRefs, "optionRefs", { minimum: 2 });
  const optionRefKeys = new Set(optionRefs.map(entityRefKey));
  const selectedItemRef = round.selectedItemRef == null
    ? null
    : normalizeEntityRef(round.selectedItemRef, "selectedItemRef");
  const rejectedItemRefs = uniqueEntityRefs(round.rejectedItemRefs, "rejectedItemRefs");
  if (selectedItemRef) {
    ensureMembers([entityRefKey(selectedItemRef)], optionRefKeys, "selectedItemRef");
  }
  ensureMembers(rejectedItemRefs.map(entityRefKey), optionRefKeys, "rejectedItemRefs");
  const hintState = normalizedHintState(round.hintState);
  const completed = Boolean(round.completed);
  if (hintState === VERB_HINT_STATES.SOLUTION_REVEALED && !completed) {
    throw verbFamilyError(
      "VERB_MORPHOLOGY_COMPLETION_REQUIRED",
      "A revealed morphology solution must persist the round as completed."
    );
  }
  return {
    schemaVersion: VERB_FAMILY_ROUND_SCHEMA_VERSION,
    exerciseFamily,
    taskRef,
    itemRef,
    roundId: requiredText(round.roundId, "roundId", { maxLength: 512 }),
    cueRef: normalizeEntityRef(round.cueRef, "cueRef"),
    optionRefs,
    selectedItemRef,
    rejectedItemRefs,
    hintState,
    completed,
    settlementId: optionalText(round.settlementId, "settlementId", { maxLength: 16384 })
  };
}

function sameEntityRef(left, right) {
  return left?.id === right?.id && left?.revision === right?.revision;
}

function normalizeComposedMorphologyRound(value) {
  if (!isPlainObject(value) || value.schemaVersion !== SHARED_MORPHOLOGY_ROUND_SCHEMA) {
    throw verbFamilyError(
      "VERB_MORPHOLOGY_COMPOSED_ROUND_INVALID",
      `Morphology UI state requires a ${SHARED_MORPHOLOGY_ROUND_SCHEMA} round.`
    );
  }
  if (!isPlainObject(value.cue) || !isPlainObject(value.cue.presentation)) {
    throw verbFamilyError(
      "VERB_MORPHOLOGY_COMPOSED_ROUND_INVALID",
      "The composed morphology round requires one cue presentation."
    );
  }
  if (!Array.isArray(value.options) || value.options.length < 2) {
    throw verbFamilyError(
      "VERB_MORPHOLOGY_COMPOSED_ROUND_INVALID",
      "The composed morphology round requires at least two options."
    );
  }
  const options = value.options.map((option, index) => {
    if (!isPlainObject(option)) {
      throw verbFamilyError(
        "VERB_MORPHOLOGY_COMPOSED_ROUND_INVALID",
        `options[${index}] must be an object.`
      );
    }
    return {
      itemRef: normalizeEntityRef(option.itemRef, `options[${index}].itemRef`),
      surface: requiredText(option.surface, `options[${index}].surface`, { maxLength: 1024 })
    };
  });
  const optionRefKeys = options.map((option) => entityRefKey(option.itemRef));
  if (new Set(optionRefKeys).size !== optionRefKeys.length) {
    throw verbFamilyError(
      "VERB_MORPHOLOGY_COMPOSED_ROUND_INVALID",
      "The composed morphology round contains duplicate option references."
    );
  }
  const targetItemRef = normalizeEntityRef(value.targetItemRef, "targetItemRef");
  if (!options.some((option) => sameEntityRef(option.itemRef, targetItemRef))) {
    throw verbFamilyError(
      "VERB_MORPHOLOGY_COMPOSED_ROUND_INVALID",
      "The composed morphology target is not one of its options."
    );
  }
  return {
    schemaVersion: SHARED_MORPHOLOGY_ROUND_SCHEMA,
    roundId: requiredText(value.roundId, "roundId", { maxLength: 512 }),
    taskFingerprint: requiredText(
      value.taskFingerprint,
      "taskFingerprint",
      { maxLength: 1024 }
    ),
    cue: {
      cueRef: normalizeEntityRef(value.cue.cueRef, "cue.cueRef"),
      key: requiredText(value.cue.key, "cue.key", { maxLength: 512 }),
      presentation: cloneJsonValue(value.cue.presentation, "cue.presentation")
    },
    options,
    targetItemRef
  };
}

/**
 * Project the immutable shared curriculum round into UI-only persisted state.
 * Target answers and visible surfaces remain in the composed content round and
 * are never duplicated into verbMemory.
 */
export function createMorphologyFamilyRoundState(composedRound, {
  taskRef,
  itemRef,
  selectedItemRef = null,
  rejectedItemRefs = [],
  hintState = VERB_HINT_STATES.AVAILABLE,
  completed = false,
  settlementId = ""
} = {}) {
  const round = normalizeComposedMorphologyRound(composedRound);
  return serializeVerbFamilyRound(VERB_EXERCISE_FAMILIES.MORPHOLOGY, {
    taskRef,
    itemRef,
    roundId: round.roundId,
    cueRef: round.cue.cueRef,
    optionRefs: round.options.map((option) => option.itemRef),
    selectedItemRef,
    rejectedItemRefs,
    hintState,
    completed,
    settlementId
  });
}

/**
 * Describe whether a family may be activated. The caller owns the trustworthy
 * loopback/developer check; this core requires that result explicitly and does
 * not infer developer authority from a query string.
 */
export function verbExerciseFamilyAvailability(exerciseFamily, {
  mode = VERB_EXERCISE_MODES.EXPLORE,
  developerMode = false
} = {}) {
  const family = normalizedText(exerciseFamily);
  const normalizedExerciseMode = normalizedMode(mode);
  if (!exerciseFamilyIds.has(family)) {
    return Object.freeze({
      exerciseFamily: family,
      mode: normalizedExerciseMode,
      available: false,
      developerOnly: false,
      reason: "unknown-family"
    });
  }
  if (family === VERB_EXERCISE_FAMILIES.MEANING) {
    return Object.freeze({
      exerciseFamily: family,
      mode: normalizedExerciseMode,
      available: true,
      developerOnly: false,
      reason: "available"
    });
  }
  const available = normalizedExerciseMode === VERB_EXERCISE_MODES.GUIDED
    && developerMode === true;
  return Object.freeze({
    exerciseFamily: family,
    mode: normalizedExerciseMode,
    available,
    developerOnly: true,
    reason: available ? "developer-guided" : "developer-guided-only"
  });
}

export function buildVerbTaskRef({ exerciseFamily, bindingId, taskFingerprint } = {}) {
  const family = normalizedFamily(exerciseFamily);
  return [
    "verb-task:v1",
    family,
    encodedReferencePart(bindingId, "bindingId"),
    encodedReferencePart(taskFingerprint, "taskFingerprint")
  ].join(":");
}

export function buildVerbItemRef({ exerciseFamily, contentId, itemId } = {}) {
  const family = normalizedFamily(exerciseFamily);
  return [
    "verb-item:v1",
    family,
    encodedReferencePart(contentId, "contentId"),
    encodedReferencePart(itemId, "itemId")
  ].join(":");
}

export function buildVerbSettlementId({
  exerciseFamily,
  taskRef,
  itemRef,
  kind = "first-response"
} = {}) {
  const family = normalizedFamily(exerciseFamily);
  const normalizedKind = requiredText(kind, "kind", { maxLength: 64 });
  if (!settlementKinds.has(normalizedKind)) {
    throw verbFamilyError(
      "VERB_SETTLEMENT_KIND_INVALID",
      `Unknown Verb settlement kind: ${normalizedKind}.`
    );
  }
  const normalizedTaskRef = assertReferenceFamily(
    taskRef,
    "verb-task:v1",
    family,
    "taskRef"
  );
  const normalizedItemRef = assertReferenceFamily(
    itemRef,
    "verb-item:v1",
    family,
    "itemRef"
  );
  return [
    "verb-settlement:v1",
    family,
    encodeURIComponent(normalizedTaskRef),
    encodeURIComponent(normalizedItemRef),
    normalizedKind
  ].join(":");
}

export function createVerbSettlement({
  exerciseFamily,
  mode,
  taskRef,
  itemRef,
  kind = "first-response",
  responseId = "",
  correct = false,
  hintState = VERB_HINT_STATES.AVAILABLE,
  requestedXp = 0
} = {}) {
  const family = normalizedFamily(exerciseFamily);
  const normalizedExerciseMode = normalizedMode(mode);
  const normalizedTaskRef = assertReferenceFamily(
    taskRef,
    "verb-task:v1",
    family,
    "taskRef"
  );
  const normalizedItemRef = assertReferenceFamily(
    itemRef,
    "verb-item:v1",
    family,
    "itemRef"
  );
  const normalizedRequestedXp = nonNegativeInteger(requestedXp, "requestedXp");
  const normalizedSupportState = normalizedHintState(hintState);
  const awardedXp = normalizedExerciseMode === VERB_EXERCISE_MODES.GUIDED
    ? 0
    : normalizedRequestedXp;
  return {
    schemaVersion: VERB_SETTLEMENT_SCHEMA_VERSION,
    settlementId: buildVerbSettlementId({
      exerciseFamily: family,
      taskRef: normalizedTaskRef,
      itemRef: normalizedItemRef,
      kind
    }),
    exerciseFamily: family,
    mode: normalizedExerciseMode,
    kind: requiredText(kind, "kind", { maxLength: 64 }),
    taskRef: normalizedTaskRef,
    itemRef: normalizedItemRef,
    responseId: optionalText(responseId, "responseId", { maxLength: 512 }),
    correct: Boolean(correct),
    hintState: normalizedSupportState,
    requestedXp: normalizedRequestedXp,
    awardedXp,
    xpSuppressed: normalizedExerciseMode === VERB_EXERCISE_MODES.GUIDED
      && normalizedRequestedXp > 0
  };
}

export function serializeVerbFamilyRound(exerciseFamily, round) {
  const family = normalizedFamily(exerciseFamily);
  return family === VERB_EXERCISE_FAMILIES.MEANING
    ? normalizeMeaningRound(round)
    : normalizeMorphologyRound(round);
}

export function restoreVerbFamilyRound(snapshot, expectedFamily) {
  const family = normalizedFamily(expectedFamily);
  if (!isPlainObject(snapshot)) {
    throw verbFamilyError(
      "VERB_FAMILY_ROUND_INVALID",
      "Persisted Verb round state must be an object."
    );
  }
  if (snapshot.schemaVersion !== VERB_FAMILY_ROUND_SCHEMA_VERSION) {
    throw verbFamilyError(
      "VERB_FAMILY_ROUND_SCHEMA_UNSUPPORTED",
      `Unsupported Verb family round schema: ${snapshot.schemaVersion}.`
    );
  }
  if (snapshot.exerciseFamily !== family) {
    throw verbFamilyError(
      "VERB_FAMILY_ROUND_MISMATCH",
      `A ${snapshot.exerciseFamily || "tagless"} round cannot be restored as ${family}.`
    );
  }
  return serializeVerbFamilyRound(family, snapshot);
}

function normalizeVerbFamilyState(value, exerciseFamily) {
  if (value == null) return null;
  if (!isPlainObject(value)) {
    throw verbFamilyError(
      "VERB_FAMILY_STATE_INVALID",
      `${exerciseFamily} family state must be an object or null.`
    );
  }
  const state = cloneJsonValue(value, `families.${exerciseFamily}`);
  if (state.round != null) {
    state.round = restoreVerbFamilyRound(state.round, exerciseFamily);
  }
  return state;
}

function recoverVerbFamilyState(value, exerciseFamily) {
  try {
    return normalizeVerbFamilyState(value, exerciseFamily);
  } catch (error) {
    if (typeof error?.code === "string" && error.code.startsWith("VERB_")) {
      return null;
    }
    throw error;
  }
}

function emptyVerbMemoryV3() {
  return {
    schemaVersion: VERB_MEMORY_SCHEMA_VERSION,
    activeFamily: VERB_EXERCISE_FAMILIES.MEANING,
    families: {
      meaning: null,
      morphology: null
    },
    settlementIds: []
  };
}

/**
 * Purely migrate the legacy meaning-only envelope into a family-scoped v3
 * envelope. Every non-round legacy field is retained by name; current round
 * fields move into the tagged meaning round without changing their values.
 */
export function migrateVerbMemoryToV3(memory) {
  if (memory == null) return emptyVerbMemoryV3();
  if (!isPlainObject(memory)) {
    throw verbFamilyError(
      "VERB_MEMORY_INVALID",
      "Verb memory must be an object, null, or undefined."
    );
  }
  const source = cloneJsonValue(memory, "memory");
  if (source.schemaVersion === 2) {
    const {
      schemaVersion: legacySchemaVersion,
      roundIds = [],
      englishRoundIds = [],
      matchedIds = [],
      hintsEnabled = false,
      ...meaningState
    } = source;
    void legacySchemaVersion;
    return {
      schemaVersion: VERB_MEMORY_SCHEMA_VERSION,
      activeFamily: VERB_EXERCISE_FAMILIES.MEANING,
      families: {
        meaning: {
          ...meaningState,
          round: serializeVerbFamilyRound(VERB_EXERCISE_FAMILIES.MEANING, {
            roundIds,
            englishRoundIds,
            matchedIds,
            hintsEnabled
          })
        },
        morphology: null
      },
      settlementIds: []
    };
  }
  if (source.schemaVersion !== VERB_MEMORY_SCHEMA_VERSION) {
    throw verbFamilyError(
      "VERB_MEMORY_SCHEMA_UNSUPPORTED",
      `Unsupported Verb memory schema: ${source.schemaVersion}.`
    );
  }
  const activeFamily = normalizedFamily(source.activeFamily);
  if (!isPlainObject(source.families)) {
    throw verbFamilyError(
      "VERB_MEMORY_FAMILIES_INVALID",
      "Verb memory v3 requires a families object."
    );
  }
  return {
    schemaVersion: VERB_MEMORY_SCHEMA_VERSION,
    activeFamily,
    families: {
      meaning: recoverVerbFamilyState(
        source.families.meaning,
        VERB_EXERCISE_FAMILIES.MEANING
      ),
      morphology: recoverVerbFamilyState(
        source.families.morphology,
        VERB_EXERCISE_FAMILIES.MORPHOLOGY
      )
    },
    settlementIds: uniqueIdList(source.settlementIds, "settlementIds", { maxLength: 16384 })
  };
}

export function withVerbFamilyState(memory, exerciseFamily, familyState, {
  makeActive = true
} = {}) {
  const family = normalizedFamily(exerciseFamily);
  const migrated = migrateVerbMemoryToV3(memory);
  return {
    ...migrated,
    activeFamily: makeActive ? family : migrated.activeFamily,
    families: {
      ...migrated.families,
      [family]: normalizeVerbFamilyState(familyState, family)
    }
  };
}

export function rememberVerbSettlement(memory, settlementOrId, {
  historyLimit = defaultSettlementHistoryLimit
} = {}) {
  const migrated = migrateVerbMemoryToV3(memory);
  const settlementId = requiredText(
    typeof settlementOrId === "string"
      ? settlementOrId
      : settlementOrId?.settlementId,
    "settlementId",
    { maxLength: 16384 }
  );
  if (!settlementId.startsWith("verb-settlement:v1:")) {
    throw verbFamilyError(
      "VERB_SETTLEMENT_ID_INVALID",
      "settlementId must be a deterministic Verb settlement reference."
    );
  }
  if (migrated.settlementIds.includes(settlementId)) {
    return { duplicate: true, memory: migrated };
  }
  const limit = nonNegativeInteger(historyLimit, "historyLimit");
  if (limit < 1) {
    throw verbFamilyError(
      "VERB_SETTLEMENT_HISTORY_LIMIT_INVALID",
      "historyLimit must retain at least one settlement identifier."
    );
  }
  return {
    duplicate: false,
    memory: {
      ...migrated,
      settlementIds: [...migrated.settlementIds, settlementId].slice(-limit)
    }
  };
}

export function advanceVerbHintState(currentState, action) {
  const current = normalizedHintState(currentState);
  const normalizedAction = requiredText(action, "action", { maxLength: 64 });
  if (normalizedAction === "show-hint") {
    return current === VERB_HINT_STATES.AVAILABLE
      ? VERB_HINT_STATES.USED
      : current;
  }
  if (normalizedAction === "reveal-solution") {
    return VERB_HINT_STATES.SOLUTION_REVEALED;
  }
  throw verbFamilyError(
    "VERB_HINT_ACTION_INVALID",
    `Unknown Verb hint action: ${normalizedAction}.`
  );
}

function morphologyCueText(round, override) {
  const explicit = optionalText(override, "cueText", { maxLength: 1024 });
  if (explicit) return explicit;
  for (const key of ["supportEn", "descriptionEn", "promptEn", "textEn"]) {
    if (typeof round.cue.presentation[key] !== "string") continue;
    const text = normalizedText(round.cue.presentation[key]);
    if (text) return text;
  }
  return round.cue.key;
}

/**
 * Build a DOM-agnostic accessibility contract. Correctness is deliberately
 * absent before a correct settlement or an explicit solution reveal. Visible
 * cue/choice content comes only from the immutable shared curriculum round;
 * verbMemory contributes interaction state but never becomes content authority.
 */
export function buildMorphologyChoiceViewModel(composedRound, persistedRound, {
  interactionLocked = false,
  announcement = "",
  cueText = "",
  cueLanguage = "en",
  targetLanguage = "cs",
  instruction = "Choose the form that matches the cue.",
  choiceGroupLabel = "Target-language form choices",
  hintText = ""
} = {}) {
  const contentRound = normalizeComposedMorphologyRound(composedRound);
  const savedRound = restoreVerbFamilyRound(
    persistedRound,
    VERB_EXERCISE_FAMILIES.MORPHOLOGY
  );
  if (
    savedRound.roundId !== contentRound.roundId
    || !sameEntityRef(savedRound.cueRef, contentRound.cue.cueRef)
  ) {
    throw verbFamilyError(
      "VERB_MORPHOLOGY_CONTENT_DRIFT",
      "The persisted morphology round no longer matches its reviewed cue."
    );
  }
  const contentOptionKeys = contentRound.options.map((option) => entityRefKey(option.itemRef));
  const savedOptionKeys = savedRound.optionRefs.map(entityRefKey);
  if (
    contentOptionKeys.length !== savedOptionKeys.length
    || contentOptionKeys.some((id, index) => id !== savedOptionKeys[index])
  ) {
    throw verbFamilyError(
      "VERB_MORPHOLOGY_CONTENT_DRIFT",
      "The persisted morphology options no longer match their reviewed order."
    );
  }

  const selectedItemKey = savedRound.selectedItemRef
    ? entityRefKey(savedRound.selectedItemRef)
    : "";
  const correctItemKey = entityRefKey(contentRound.targetItemRef);
  const evidenceSettled = Boolean(savedRound.settlementId);
  const solutionRevealed = savedRound.hintState === VERB_HINT_STATES.SOLUTION_REVEALED;
  const selectedIsCorrect = selectedItemKey === correctItemKey;
  if (savedRound.completed && !solutionRevealed && !selectedIsCorrect) {
    throw verbFamilyError(
      "VERB_MORPHOLOGY_COMPLETION_INVALID",
      "A completed morphology round must have a correct selection or a revealed solution."
    );
  }
  const exposeCorrectChoice = savedRound.completed
    && (solutionRevealed || selectedIsCorrect);
  const rejectedItemKeys = new Set(savedRound.rejectedItemRefs.map(entityRefKey));
  const disabled = Boolean(interactionLocked) || savedRound.completed;
  const visibleTargetLanguage = optionalText(
    targetLanguage,
    "targetLanguage",
    { maxLength: 64 }
  ) || "cs";
  const choices = contentRound.options.map((option, index) => {
    const id = entityRefKey(option.itemRef);
    const selected = id === selectedItemKey;
    const rejected = rejectedItemKeys.has(id);
    const correct = exposeCorrectChoice ? id === correctItemKey : null;
    const state = correct === true
      ? "correct"
      : rejected
        ? "rejected"
        : selected
          ? "selected"
          : "available";
    const stateDescription = state === "correct"
      ? "Correct."
      : state === "rejected"
        ? "Previously tried."
        : selected
          ? "Selected."
          : "";
    return {
      id,
      itemRef: { ...option.itemRef },
      text: option.surface,
      language: visibleTargetLanguage,
      position: index + 1,
      selected,
      rejected,
      correct,
      state,
      disabled,
      stateDescription
    };
  });

  let statusMessage = optionalText(announcement, "announcement", { maxLength: 1024 });
  if (!statusMessage && solutionRevealed) {
    const answer = contentRound.options.find((option) => (
      sameEntityRef(option.itemRef, contentRound.targetItemRef)
    ));
    statusMessage = `Solution revealed: ${answer.surface}.`;
  } else if (!statusMessage && savedRound.completed && selectedIsCorrect) {
    const answer = contentRound.options.find((option) => (
      sameEntityRef(option.itemRef, contentRound.targetItemRef)
    ));
    statusMessage = `Correct: ${answer.surface}.`;
  } else if (!statusMessage && savedRound.hintState === VERB_HINT_STATES.USED) {
    const visibleHint = optionalText(hintText, "hintText", { maxLength: 1024 });
    statusMessage = visibleHint ? `Hint: ${visibleHint}` : "Hint used.";
  } else if (!statusMessage && evidenceSettled) {
    statusMessage = "Not quite. Try another form.";
  }

  const hintUsed = savedRound.hintState !== VERB_HINT_STATES.AVAILABLE;
  const visibleCueText = morphologyCueText(contentRound, cueText);
  const visibleHintText = optionalText(hintText, "hintText", { maxLength: 1024 });
  return {
    exerciseFamily: VERB_EXERCISE_FAMILIES.MORPHOLOGY,
    taskRef: savedRound.taskRef,
    itemRef: savedRound.itemRef,
    roundId: savedRound.roundId,
    evidenceSettled,
    completed: savedRound.completed,
    cue: {
      id: entityRefKey(contentRound.cue.cueRef),
      cueRef: { ...contentRound.cue.cueRef },
      text: visibleCueText,
      language: optionalText(cueLanguage, "cueLanguage", { maxLength: 64 }) || "en",
      ariaLabel: `Cue: ${visibleCueText}`
    },
    instruction: optionalText(instruction, "instruction", { maxLength: 1024 })
      || "Choose the form that matches the cue.",
    choiceGroup: {
      role: "group",
      ariaLabel: optionalText(
        choiceGroupLabel,
        "choiceGroupLabel",
        { maxLength: 1024 }
      ) || "Target-language form choices",
      reusable: true,
      choices
    },
    hint: {
      state: savedRound.hintState,
      used: hintUsed,
      solutionRevealed,
      text: hintUsed ? visibleHintText : "",
      actionLabel: savedRound.hintState === VERB_HINT_STATES.AVAILABLE
        ? "Show hint"
        : solutionRevealed
          ? "Solution shown"
          : "Hint shown",
      actionDisabled: disabled || hintUsed
    },
    interactionLocked: disabled,
    focusTarget: disabled ? "status" : "choice-group",
    status: {
      role: "status",
      ariaLive: "polite",
      message: statusMessage
    }
  };
}

export function createVerbExerciseFamilyAdapter({
  exerciseFamily = VERB_EXERCISE_FAMILIES.MEANING,
  mode = VERB_EXERCISE_MODES.EXPLORE,
  developerMode = false
} = {}) {
  const availability = verbExerciseFamilyAvailability(exerciseFamily, {
    mode,
    developerMode
  });
  if (!availability.available) {
    throw verbFamilyError(
      "VERB_EXERCISE_FAMILY_UNAVAILABLE",
      `${availability.exerciseFamily || "Unknown"} is unavailable in ${availability.mode} mode (${availability.reason}).`
    );
  }
  const family = normalizedFamily(availability.exerciseFamily);
  const normalizedExerciseMode = normalizedMode(availability.mode);
  return Object.freeze({
    exerciseFamily: family,
    mode: normalizedExerciseMode,
    developerOnly: availability.developerOnly,
    availability,
    buildTaskRef(fields = {}) {
      return buildVerbTaskRef({ ...fields, exerciseFamily: family });
    },
    buildItemRef(fields = {}) {
      return buildVerbItemRef({ ...fields, exerciseFamily: family });
    },
    createRoundState: family === VERB_EXERCISE_FAMILIES.MORPHOLOGY
      ? createMorphologyFamilyRoundState
      : null,
    serializeRound(round) {
      return serializeVerbFamilyRound(family, round);
    },
    restoreRound(round) {
      return restoreVerbFamilyRound(round, family);
    },
    settle(fields = {}) {
      return createVerbSettlement({
        ...fields,
        exerciseFamily: family,
        mode: normalizedExerciseMode
      });
    },
    viewModel: family === VERB_EXERCISE_FAMILIES.MORPHOLOGY
      ? buildMorphologyChoiceViewModel
      : null
  });
}
