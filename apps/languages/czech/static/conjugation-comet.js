"use strict";

let verbMorphologyCore = null;
let verbExerciseFamilyCore = null;
let verbNebulaCore = null;
let guidedOpportunityCore = null;
let verbMorphologyCatalogBytes = new Uint8Array();
let verbDictionaryBytes = new Uint8Array();
let verbDictionary = [];

const course = window.CaatuuCourse;
if (!course) throw new Error("Caatuu course profile must load before Conjugation Comet.");

const verbMorphologyProgressSchema = "caatuu-morphology-guided-progress-v1";
const verbMeaningGateSchema = "caatuu-conjugation-comet-meaning-gate-v1";
const verbMeaningGateStorageKey = `${course.storage?.namespace || "caatuu"}.conjugation-comet.meaning-gate.v1`;
const $ = (selector) => document.querySelector(selector);

const state = {
  verbGuidedRequested: true,
  verbGuidedMode: false,
  verbGuidedStatus: "loading",
  verbGuidedError: "",
  verbGuidedResolution: null,
  verbGuidedLifecycle: null,
  verbGuidedActivationPromise: null,
  verbGuidedActivationEpoch: 0,
  verbGuidedEvidencePending: false,
  verbGuidedSupportAtFirstResponse: false,
  verbMeaningPlan: null,
  verbMeaningResolution: null,
  verbMeaningSelectedTarget: false,
  verbMeaningSelectedEnglishId: "",
  verbMeaningWrongEnglishId: "",
  verbMeaningMatched: false,
  verbMeaningTransitionPending: false,
  verbMeaningTransitionTimer: null,
  verbMeaningAnnouncement: "Select the Czech verb to begin.",
  verbMeaningAnnouncementKind: "",
  verbMorphologyCatalog: null,
  verbMorphologyFamily: null,
  verbMorphologyMatchBoard: null,
  verbMorphologyRound: null,
  verbMorphologyRoundState: null,
  verbMorphologyAdapter: null,
  verbMorphologySequence: null,
  verbMorphologySequencePreview: null,
  verbMorphologySequenceCueRefs: [],
  verbMorphologySequenceComplete: false,
  verbMorphologyTask: null,
  verbMorphologyProgress: null,
  verbMorphologyProgressRevision: 0,
  verbMorphologyResume: false,
  verbMorphologyAdvancePending: false,
  verbProgressResetPending: false,
  verbMorphologyGeneration: 0,
  verbMorphologyPreparePromise: null,
  verbGuidedOperations: new Set(),
  verbMorphologyFocusNextStep: false,
  verbMorphologyFocusNextAction: false,
  verbMorphologyFocusHintAction: false,
  verbMorphologyFocusRevealAction: false,
  verbMorphologySelectedItemRef: null,
  verbMorphologySelectedCueRef: null,
  verbMorphologyWrongItemRef: null,
  verbMorphologyWrongCueRef: null,
  verbMorphologyAutoAdvanceTimer: null,
  verbMorphologyAnnouncement: "Preparing the reviewed conjugation matches.",
  verbMorphologyAnnouncementKind: ""
};

function setText(selector, value) {
  const node = $(selector);
  if (node) node.textContent = value;
}

function loopbackLocation() {
  return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(
    String(window.location.hostname || "").toLowerCase()
  );
}

function explicitLocalGuidedRequest() {
  const parameter = course.curriculum?.guidedMode?.developerQueryParameter || "curriculum-guided";
  return loopbackLocation()
    && new URLSearchParams(window.location.search).get(parameter) === "1";
}

function conjugationCometConfiguration() {
  return course.curriculum?.conjugationComet || null;
}

function sequenceTotalSteps() {
  const configured = conjugationCometConfiguration()?.sequence?.orderedBindingIds?.length;
  const claimed = state.verbMorphologySequence?.totalSteps;
  return Number(claimed || configured || 0);
}

function conjugationCometAvailable() {
  const configuration = conjugationCometConfiguration();
  if (!configuration
      || configuration.enabled !== true
      || course.capabilities?.conjugationComet !== true
      || configuration.activityId !== "conjugation-comet"
      || configuration.exerciseFamilyId !== "conjugation-comet.contextual-target-realization") {
    return false;
  }
  if (configuration.developerOnly) return explicitLocalGuidedRequest();
  return configuration.releaseEnabled === true
    && configuration.reviewStatus === "human-approved";
}

function conjugationCometReleaseEnabled() {
  const configuration = conjugationCometConfiguration();
  return configuration?.developerOnly !== true
    && course.capabilities?.conjugationComet === true
    && configuration?.releaseEnabled === true
    && configuration?.reviewStatus === "human-approved";
}

async function loadJsonBytes(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Could not load ${path}: ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  return { bytes, value: JSON.parse(text) };
}

async function loadConjugationCometRuntime() {
  const configuration = conjugationCometConfiguration();
  if (!configuration?.requiresPinnedCatalog || !course.curriculum?.paths?.morphologyCatalog) {
    throw new Error("The course does not pin a morphology catalog for Conjugation Comet.");
  }
  const [
    morphologySource,
    dictionarySource,
    morphologyModule,
    familyModule,
    meaningModule,
    opportunityModule
  ] = await Promise.all([
    loadJsonBytes(course.curriculum.paths.morphologyCatalog),
    loadJsonBytes("data/dictionary.json"),
    import("./curriculum/morphology-round-core.mjs?v=morphology-round-core-3"),
    import("./verb-exercise-family-core.mjs?v=verb-exercise-family-core-2"),
    import("./verb-nebula-core.mjs?v=verb-nebula-core-10"),
    import("./curriculum/guided-opportunity.mjs?v=guided-opportunity-5")
  ]);
  verbMorphologyCatalogBytes = morphologySource.bytes;
  verbDictionaryBytes = dictionarySource.bytes;
  if (!Array.isArray(dictionarySource.value)) {
    throw new Error("Conjugation Comet requires the pinned Core dictionary array for its meaning gate.");
  }
  verbDictionary = dictionarySource.value;
  verbMorphologyCore = morphologyModule;
  verbExerciseFamilyCore = familyModule;
  verbNebulaCore = meaningModule;
  guidedOpportunityCore = opportunityModule;
}

function morphologySequenceConfiguration(familyConfiguration) {
  const sequence = familyConfiguration?.sequence;
  const orderedBindingIds = Array.from(sequence?.orderedBindingIds || [], (value) => String(value || "").trim());
  const orderedContentIds = Array.from(sequence?.orderedContentIds || [], (value) => String(value || "").trim());
  const targetSkillId = String(familyConfiguration?.targetSkillId || "").trim();
  if (!sequence?.id
      || !Number.isInteger(sequence.revision)
      || sequence.revision < 1
      || orderedBindingIds.length < 2
      || orderedContentIds.length !== orderedBindingIds.length
      || new Set(orderedBindingIds).size !== orderedBindingIds.length
      || new Set(orderedContentIds).size !== orderedContentIds.length
      || orderedBindingIds.some((id) => !id)
      || orderedContentIds.some((id) => !id)
      || !targetSkillId) {
    throw new Error("Conjugation Comet requires one pinned sequence with at least two steps and a target skill.");
  }
  return Object.freeze({
    id: sequence.id,
    revision: sequence.revision,
    orderedBindingIds: Object.freeze(orderedBindingIds),
    orderedContentIds: Object.freeze(orderedContentIds),
    targetSkillId
  });
}

function sameCurriculumContentRef(left, right) {
  return ["catalogId", "catalogRevision", "catalogDigest", "contentId", "revision", "contentDigest"]
    .every((key) => left?.[key] === right?.[key]);
}

function sameEntityRef(left, right) {
  return left?.id === right?.id && left?.revision === right?.revision;
}

function normalizedVisibleText(value) {
  return String(value || "").trim().normalize("NFC").toLocaleLowerCase("en");
}

function verbMeaningExerciseConfiguration() {
  return course.curriculum?.verbExerciseFamilies?.families?.meaning || null;
}

function verbMeaningGateIdentity() {
  const family = state.verbMorphologyFamily;
  const plan = state.verbMeaningPlan;
  const meaningResolution = state.verbMeaningResolution;
  const morphologyResolution = state.verbGuidedResolution;
  if (!family || !plan || !meaningResolution || !morphologyResolution) return "";
  return [
    `${family.id}@${family.revision}`,
    plan.targetId,
    meaningResolution.source.contentDigest,
    morphologyResolution.source.catalogDigest
  ].join("|");
}

function restoreVerbMeaningGate() {
  const identity = verbMeaningGateIdentity();
  if (!identity) return false;
  try {
    const value = JSON.parse(localStorage.getItem(verbMeaningGateStorageKey) || "null");
    return value?.schemaVersion === verbMeaningGateSchema
      && value.identity === identity
      && value.matched === true;
  } catch {
    return false;
  }
}

function persistVerbMeaningGate() {
  const identity = verbMeaningGateIdentity();
  if (!identity) throw new Error("The Conjugation Comet meaning gate has no stable content identity.");
  localStorage.setItem(verbMeaningGateStorageKey, JSON.stringify({
    schemaVersion: verbMeaningGateSchema,
    identity,
    matched: true,
    matchedAt: new Date().toISOString()
  }));
}

function clearVerbMeaningGate() {
  try {
    localStorage.removeItem(verbMeaningGateStorageKey);
  } catch {
    // A reset still clears the in-memory gate when storage is unavailable.
  }
}

async function prepareVerbMeaningGate(curriculum, family, morphologyResolution) {
  const configuration = verbMeaningExerciseConfiguration();
  if (!configuration?.stableContentId
      || configuration.exerciseFamilyId !== "verb-nebula.meaning-match") {
    throw new Error("Conjugation Comet requires one reviewed Verb Nebula meaning binding.");
  }
  const resolution = await curriculum.resolveBinding("verb-nebula", configuration.stableContentId);
  if (resolution.binding.exerciseFamilyId !== configuration.exerciseFamilyId
      || resolution.binding.canonicalUnitId !== morphologyResolution.binding.canonicalUnitId
      || resolution.binding.canonicalUnitRevision !== morphologyResolution.binding.canonicalUnitRevision) {
    throw new Error("The meaning gate and morphology round do not share one canonical curriculum unit.");
  }
  const reviewedReferences = [
    resolution.source.snapshot,
    ...Array.from(resolution.source.snapshot.guidedContrasts || [])
  ];
  const [targetPair, ...contrastPairs] = await verbNebulaCore.resolvePinnedStableVerbPairs(
    verbDictionaryBytes,
    resolution.source.catalogDigest,
    reviewedReferences
  );
  const plan = verbNebulaCore.buildGuidedVerbRound(
    verbNebulaCore.extractCoreVerbPairs(verbDictionary),
    targetPair,
    {
      pairCount: 4,
      contrastPairs,
      taskFingerprint: `conjugation-comet-meaning|${resolution.source.contentDigest}|${family.id}@${family.revision}`
    }
  );
  const lemmaTarget = family.metadata?.lemmaTarget;
  const glossEn = family.metadata?.glossEn;
  const visibleTarget = plan.round.find((pair) => pair.id === plan.targetId);
  if (!visibleTarget
      || normalizedVisibleText(visibleTarget.cz) !== normalizedVisibleText(lemmaTarget)
      || normalizedVisibleText(visibleTarget.eng) !== normalizedVisibleText(glossEn)
      || plan.englishRound.length !== 4
      || new Set(plan.englishRound.map((pair) => normalizedVisibleText(pair.eng))).size !== 4) {
    throw new Error("The reviewed meaning gate does not identify the morphology family lemma unambiguously.");
  }
  state.verbMeaningResolution = resolution;
  state.verbMeaningPlan = plan;
  const restoredMeaningGate = restoreVerbMeaningGate();
  state.verbMeaningMatched = restoredMeaningGate
    || Number(state.verbMorphologySequence?.stepIndex || 0) > 0
    || state.verbMorphologySequenceComplete;
  if (state.verbMeaningMatched && !restoredMeaningGate) {
    try {
      persistVerbMeaningGate();
    } catch (error) {
      console.warn("Conjugation Comet could not persist its migrated meaning gate.", error);
    }
  }
}

function composeBoundMorphologyMatchBoard(catalog, resolution) {
  const snapshot = resolution.source.snapshot || {};
  return verbMorphologyCore.composeMorphologyMatchBoard(catalog, {
    catalogRef: { id: catalog.catalogId, version: catalog.version },
    familyRef: snapshot.familyRef,
    itemRefs: snapshot.itemRefs,
    cueRefs: snapshot.cueRefs,
    taskFingerprint: `conjugation-comet-board|${resolution.source.catalogDigest}|${snapshot.sequenceRef?.id || "family"}`,
    releaseMode: conjugationCometReleaseEnabled()
  });
}

async function resolveMorphologySequenceCueRefs(curriculum, sequenceConfiguration) {
  const resolutions = await Promise.all(sequenceConfiguration.orderedContentIds.map((contentId) => (
    curriculum.resolveBinding(conjugationCometConfiguration().activityId, contentId)
  )));
  return resolutions.map((resolution, index) => {
    const cueRef = resolution.source.snapshot?.selectedCueRef;
    if (!cueRef
        || resolution.binding.id !== sequenceConfiguration.orderedBindingIds[index]
        || resolution.source.contentId !== sequenceConfiguration.orderedContentIds[index]) {
      throw new Error("The Conjugation Comet sequence does not pin one exact cue per match.");
    }
    return Object.freeze({ id: cueRef.id, revision: cueRef.revision });
  });
}

function verbMorphologyAdapter() {
  if (!state.verbMorphologyAdapter) {
    state.verbMorphologyAdapter = verbExerciseFamilyCore.createVerbExerciseFamilyAdapter({
      exerciseFamily: verbExerciseFamilyCore.VERB_EXERCISE_FAMILIES.MORPHOLOGY,
      mode: verbExerciseFamilyCore.VERB_EXERCISE_MODES.GUIDED,
      developerMode: true
    });
  }
  return state.verbMorphologyAdapter;
}

function freshVerbMorphologyProgress(roundState) {
  return {
    schemaVersion: verbMorphologyProgressSchema,
    round: verbMorphologyAdapter().restoreRound(roundState),
    evidence: {
      recorded: false,
      score: null,
      solutionRevealed: false,
      hintsUsed: 0,
      occurredAt: null
    },
    pendingEvidence: null,
    terminalCompletionKind: null,
    pendingCompletionKind: null
  };
}

function normalizeVerbMorphologyProgress(
  value,
  fallbackRoundState,
  contentRound = state.verbMorphologyRound
) {
  if (value == null) return freshVerbMorphologyProgress(fallbackRoundState);
  if (!value || typeof value !== "object" || Array.isArray(value)
      || value.schemaVersion !== verbMorphologyProgressSchema) {
    throw new Error("The saved morphology progress envelope is unsupported.");
  }
  const round = verbMorphologyAdapter().restoreRound(value.round);
  const evidence = value.evidence;
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
    throw new Error("The saved morphology evidence journal is invalid.");
  }
  const recorded = evidence?.recorded === true;
  const score = recorded ? Number(evidence?.score) : null;
  const hintsUsed = Number(evidence?.hintsUsed || 0);
  const occurredAt = recorded ? String(evidence?.occurredAt || "") : null;
  if ((recorded && ![0, 1].includes(score))
      || !Number.isInteger(hintsUsed)
      || hintsUsed < 0
      || (recorded && !Number.isFinite(Date.parse(occurredAt)))
      || (!recorded && (
        evidence.recorded !== false
          || evidence.score !== null
          || evidence.solutionRevealed !== false
          || evidence.hintsUsed !== 0
          || evidence.occurredAt !== null
      ))) {
    throw new Error("The saved morphology evidence journal is invalid.");
  }
  const completionKinds = new Set(["correct-first-response", "corrective-correct", "solution-review"]);
  const terminalCompletionKind = value.terminalCompletionKind == null
    ? null
    : String(value.terminalCompletionKind);
  const pendingCompletionKind = value.pendingCompletionKind == null
    ? null
    : String(value.pendingCompletionKind);
  if ((terminalCompletionKind && !completionKinds.has(terminalCompletionKind))
      || (pendingCompletionKind && !completionKinds.has(pendingCompletionKind))
      || (pendingCompletionKind && terminalCompletionKind !== pendingCompletionKind)) {
    throw new Error("The saved morphology completion checkpoint is invalid.");
  }
  let pendingEvidence = null;
  if (value.pendingEvidence != null) {
    const pending = value.pendingEvidence;
    const request = pending?.request;
    const pendingScore = Number(request?.score);
    const pendingHints = Number(request?.hintsUsed || 0);
    const pendingOccurredAt = String(request?.occurredAt || "");
    const completionKind = pending?.completionKind == null ? null : String(pending.completionKind);
    if (!pending || typeof pending !== "object" || Array.isArray(pending)
        || request?.attemptNumber !== 1
        || typeof request?.solutionRevealed !== "boolean"
        || ![0, 1].includes(pendingScore)
        || !Number.isInteger(pendingHints)
        || pendingHints < 0
        || !Number.isFinite(Date.parse(pendingOccurredAt))
        || (completionKind && !completionKinds.has(completionKind))) {
      throw new Error("The pending morphology evidence journal is invalid.");
    }
    pendingEvidence = {
      request: {
        attemptNumber: 1,
        score: pendingScore,
        solutionRevealed: request.solutionRevealed === true,
        hintsUsed: pendingHints,
        occurredAt: pendingOccurredAt
      },
      round: verbMorphologyAdapter().restoreRound(pending.round),
      completionKind
    };
  }
  if ((recorded && score === 1 && !round.completed)
      || (round.completed && !pendingEvidence && !terminalCompletionKind)) {
    throw new Error("The saved morphology terminal state is missing its durable completion checkpoint.");
  }
  if (pendingEvidence && (recorded || terminalCompletionKind || pendingCompletionKind)) {
    throw new Error("Pending morphology evidence cannot coexist with recorded or terminal checkpoints.");
  }
  const targetRef = contentRound?.targetItemRef;
  if (!targetRef) throw new Error("The morphology progress envelope is missing its immutable target form.");
  const targetSelected = morphologyRefKey(round.selectedItemRef) === morphologyRefKey(targetRef);
  const rejectedKeys = new Set(round.rejectedItemRefs.map(morphologyRefKey));
  const selectedKey = morphologyRefKey(round.selectedItemRef);
  const targetKey = morphologyRefKey(targetRef);
  const evidenceSolutionRevealed = recorded && evidence?.solutionRevealed === true;
  if ((recorded && hintsUsed > 0
        && round.hintState === verbExerciseFamilyCore.VERB_HINT_STATES.AVAILABLE)
      || (pendingEvidence?.request?.hintsUsed > 0
        && pendingEvidence.round.hintState === verbExerciseFamilyCore.VERB_HINT_STATES.AVAILABLE)) {
    throw new Error("Recorded morphology support must match the visible saved hint state.");
  }
  if (terminalCompletionKind) {
    const solutionReview = terminalCompletionKind === "solution-review";
    const firstResponseCorrect = terminalCompletionKind === "correct-first-response";
    const firstResponseSupportMatches = !firstResponseCorrect || (
      (hintsUsed === 0
        && round.hintState === verbExerciseFamilyCore.VERB_HINT_STATES.AVAILABLE)
      || (hintsUsed > 0
        && round.hintState === verbExerciseFamilyCore.VERB_HINT_STATES.USED)
    );
    const terminalMatches = round.completed
      && recorded
      && Boolean(round.settlementId)
      && firstResponseSupportMatches
      && (solutionReview
        ? round.hintState === verbExerciseFamilyCore.VERB_HINT_STATES.SOLUTION_REVEALED
          && score === 0
          && (evidenceSolutionRevealed
            ? rejectedKeys.size === 0 && !round.selectedItemRef
            : rejectedKeys.size > 0
              && selectedKey !== targetKey
              && rejectedKeys.has(selectedKey))
        : targetSelected
          && round.hintState !== verbExerciseFamilyCore.VERB_HINT_STATES.SOLUTION_REVEALED
          && evidenceSolutionRevealed === false
          && score === (firstResponseCorrect ? 1 : 0)
          && (firstResponseCorrect ? rejectedKeys.size === 0 : rejectedKeys.size > 0));
    if (!terminalMatches) {
      throw new Error("The saved morphology completion kind contradicts its terminal round and first evidence.");
    }
  }
  if (pendingEvidence?.completionKind) {
    const pendingTargetSelected = morphologyRefKey(pendingEvidence.round.selectedItemRef)
      === morphologyRefKey(targetRef);
    const pendingSolution = pendingEvidence.completionKind === "solution-review";
    const pendingFirstCorrect = pendingEvidence.completionKind === "correct-first-response";
    const pendingFirstSupportMatches = !pendingFirstCorrect || (
      (pendingEvidence.request.hintsUsed === 0
        && pendingEvidence.round.hintState === verbExerciseFamilyCore.VERB_HINT_STATES.AVAILABLE)
      || (pendingEvidence.request.hintsUsed > 0
        && pendingEvidence.round.hintState === verbExerciseFamilyCore.VERB_HINT_STATES.USED)
    );
    if (!pendingEvidence.round.completed
        || !pendingFirstSupportMatches
        || (pendingSolution
          ? pendingEvidence.round.hintState !== verbExerciseFamilyCore.VERB_HINT_STATES.SOLUTION_REVEALED
            || pendingEvidence.request.solutionRevealed !== true
            || pendingEvidence.request.score !== 0
            || pendingEvidence.round.selectedItemRef
            || pendingEvidence.round.rejectedItemRefs.length !== 0
          : !pendingFirstCorrect
            || !pendingTargetSelected
            || pendingEvidence.request.score !== 1
            || pendingEvidence.request.solutionRevealed !== false
            || pendingEvidence.round.rejectedItemRefs.length !== 0)) {
      throw new Error("The pending morphology evidence contradicts its terminal round.");
    }
  } else if (pendingEvidence
      && (pendingEvidence.request.score !== 0
        || pendingEvidence.request.solutionRevealed !== false
        || pendingEvidence.round.completed
        || !pendingEvidence.round.settlementId
        || !pendingEvidence.round.selectedItemRef
        || morphologyRefKey(pendingEvidence.round.selectedItemRef) === targetKey
        || !new Set(pendingEvidence.round.rejectedItemRefs.map(morphologyRefKey))
          .has(morphologyRefKey(pendingEvidence.round.selectedItemRef)))) {
    throw new Error("A pending nonterminal morphology response must remain an incorrect first response.");
  }
  if (recorded && !terminalCompletionKind && !pendingEvidence) {
    if (round.completed
        || score !== 0
        || evidenceSolutionRevealed
        || !round.settlementId
        || !round.selectedItemRef
        || selectedKey === targetKey
        || !rejectedKeys.has(selectedKey)) {
      throw new Error("A restored nonterminal morphology response must remain its recorded incorrect first response.");
    }
  }
  return {
    schemaVersion: verbMorphologyProgressSchema,
    round,
    evidence: {
      recorded,
      score,
      solutionRevealed: evidenceSolutionRevealed,
      hintsUsed,
      occurredAt
    },
    pendingEvidence,
    terminalCompletionKind,
    pendingCompletionKind
  };
}

function morphologyTaskRefFor(round, resolution) {
  return verbMorphologyAdapter().buildTaskRef({
    bindingId: resolution.binding.id,
    taskFingerprint: round.taskFingerprint
  });
}

function morphologyItemRefFor(round, resolution) {
  return verbMorphologyAdapter().buildItemRef({
    contentId: resolution.source.contentId,
    itemId: round.cue.cueRef.id
  });
}

function composeBoundMorphologyRound(catalog, resolution, taskFingerprint, optionCount) {
  const selectedCueRef = resolution.source.snapshot?.selectedCueRef;
  if (!selectedCueRef) throw new Error("The morphology sequence step does not pin one learner-visible cue.");
  return verbMorphologyCore.composeMorphologyRound(catalog, {
    catalogRef: { id: catalog.catalogId, version: catalog.version },
    familyRef: resolution.source.snapshot.familyRef,
    cueRef: selectedCueRef,
    taskFingerprint,
    optionCount,
    releaseMode: conjugationCometReleaseEnabled()
  });
}

async function resolveVerbMorphologyStep(curriculum, familyConfiguration, sequenceConfiguration, claim) {
  const sequence = claim?.sequence;
  const preview = claim?.preview;
  if (!sequence || !preview
      || sequence.id !== sequenceConfiguration.id
      || sequence.revision !== sequenceConfiguration.revision
      || sequence.totalSteps !== sequenceConfiguration.orderedBindingIds.length
      || sequence.orderedBindingIds?.some((id, index) => id !== sequenceConfiguration.orderedBindingIds[index])
      || preview.bindingId !== sequenceConfiguration.orderedBindingIds[sequence.stepIndex]
      || preview.contentRef?.contentId !== sequenceConfiguration.orderedContentIds[sequence.stepIndex]
      || preview.targetSkillId !== sequenceConfiguration.targetSkillId
      || preview.capabilityId !== familyConfiguration.assessedCapabilityId) {
    throw new Error("The morphology preview is not the exact authored step in the pinned pilot sequence.");
  }
  const resolution = await curriculum.resolveBinding(conjugationCometConfiguration().activityId, preview.contentRef.contentId);
  if (resolution.binding.id !== preview.bindingId
      || !sameCurriculumContentRef(resolution.binding.contentRef, preview.contentRef)
      || resolution.binding.exerciseFamilyId !== familyConfiguration.exerciseFamilyId
      || !resolution.binding.targetSkillRefs?.some((reference) => (
        reference?.id === sequenceConfiguration.targetSkillId
      ))) {
    throw new Error("The resolved morphology binding differs from the pinned pilot sequence preview.");
  }
  const catalog = await verbMorphologyCore.resolvePinnedMorphologyCatalog(
    verbMorphologyCatalogBytes,
    resolution.source.catalogDigest
  );
  if (catalog.catalogId !== resolution.source.catalogId
      || catalog.version !== resolution.source.catalogRevision) {
    throw new Error("The morphology catalog identity does not match its curriculum source pin.");
  }
  const familyRef = resolution.source.snapshot?.familyRef;
  const family = catalog.families.find((entry) => (
    entry.id === familyRef?.id && entry.revision === familyRef?.revision
  ));
  if (!family) throw new Error("The morphology source references an unavailable family revision.");
  const refKey = (reference) => `${reference?.id || ""}@${reference?.revision || ""}`;
  const sameRefSet = (left, right) => {
    const leftKeys = Array.from(left || [], refKey).sort();
    const rightKeys = Array.from(right || [], refKey).sort();
    return leftKeys.length === rightKeys.length
      && leftKeys.every((value, index) => value === rightKeys[index]);
  };
  const familyItems = catalog.items.filter((item) => refKey(item.familyRef) === refKey(familyRef));
  const familyCues = catalog.cues.filter((cue) => refKey(cue.familyRef) === refKey(familyRef));
  if (!sameRefSet(resolution.source.snapshot?.itemRefs, familyItems)
      || !sameRefSet(resolution.source.snapshot?.cueRefs, familyCues)
      || !familyCues.some((cue) => refKey(cue) === refKey(resolution.source.snapshot?.selectedCueRef))) {
    throw new Error("The morphology source does not pin the exact authored pilot family members and cue.");
  }
  if (resolution.source.snapshot?.sequenceRef?.id !== sequence.id
      || resolution.source.snapshot?.sequenceRef?.revision !== sequence.revision
      || resolution.source.snapshot?.sequenceStep !== sequence.stepNumber
      || family.metadata?.exerciseFamilyId !== resolution.binding.exerciseFamilyId
      || family.metadata?.targetSkillRef?.id !== sequenceConfiguration.targetSkillId) {
    throw new Error("The morphology family metadata is not aligned to its sequence binding.");
  }
  return {
    resolution,
    catalog,
    family,
    matchBoard: composeBoundMorphologyMatchBoard(catalog, resolution)
  };
}

async function resolveCompletedVerbMorphologyBoard(
  curriculum,
  familyConfiguration,
  sequenceConfiguration,
  completedSequence
) {
  const firstContentId = sequenceConfiguration.orderedContentIds[0];
  const firstResolution = await curriculum.resolveBinding(
    conjugationCometConfiguration().activityId,
    firstContentId
  );
  return resolveVerbMorphologyStep(curriculum, familyConfiguration, sequenceConfiguration, {
    sequence: {
      ...completedSequence,
      stepIndex: 0,
      stepNumber: 1
    },
    preview: {
      bindingId: sequenceConfiguration.orderedBindingIds[0],
      contentRef: firstResolution.binding.contentRef,
      targetSkillId: sequenceConfiguration.targetSkillId,
      capabilityId: familyConfiguration.assessedCapabilityId
    }
  });
}

function showCompletedVerbMorphologySequence({ focus = false } = {}) {
  state.verbGuidedStatus = "complete";
  state.verbMorphologySequenceComplete = true;
  state.verbMorphologyRound = null;
  state.verbMorphologyRoundState = null;
  state.verbMorphologyTask = null;
  state.verbMorphologyProgress = null;
  state.verbMorphologyProgressRevision = 0;
  state.verbMorphologyFocusNextStep = focus;
  setVerbMorphologyAnnouncement(
    `All ${sequenceTotalSteps()} pinned pilot forms are complete. This remains non-mastery practice with 0 XP.`,
    "correct"
  );
}

function verbMorphologyPreparationCurrent(generation) {
  return state.verbMorphologyGeneration === generation && !state.verbProgressResetPending;
}

async function prepareVerbMorphologyGuidedStepInternal(curriculum, familyConfiguration, generation) {
  const sequenceConfiguration = morphologySequenceConfiguration(familyConfiguration);
  verbMorphologyAdapter();
  state.verbGuidedMode = true;
  state.verbGuidedStatus = "loading";
  state.verbGuidedError = "";
  state.verbGuidedLifecycle = null;
  state.verbGuidedActivationPromise = null;
  state.verbGuidedEvidencePending = false;
  state.verbGuidedSupportAtFirstResponse = false;
  state.verbMorphologySequenceComplete = false;
  state.verbMorphologyTask = null;
  state.verbMorphologyProgress = null;
  state.verbMorphologyProgressRevision = 0;
  state.verbMorphologyResume = false;

  const claim = await curriculum.claimDeveloperPilotSequence(
    sequenceConfiguration.orderedBindingIds,
    {
      targetSkillId: sequenceConfiguration.targetSkillId,
      capabilityId: familyConfiguration.assessedCapabilityId,
      requirePresented: () => false
    }
  );
  if (!verbMorphologyPreparationCurrent(generation)) return;
  state.verbMorphologySequence = claim?.sequence || null;
  state.verbMorphologySequencePreview = claim?.preview || null;
  if (claim?.status === "complete" && claim.reason === "sequence-complete") {
    if (claim.sequence?.id !== sequenceConfiguration.id
        || claim.sequence?.revision !== sequenceConfiguration.revision
        || claim.sequence?.stepIndex !== sequenceConfiguration.orderedBindingIds.length
        || claim.sequence?.totalSteps !== sequenceConfiguration.orderedBindingIds.length) {
      throw new Error("The completed morphology sequence checkpoint does not match this course.");
    }
    state.verbMorphologySequenceComplete = true;
    const { resolution, catalog, family, matchBoard } = await resolveCompletedVerbMorphologyBoard(
      curriculum,
      familyConfiguration,
      sequenceConfiguration,
      claim.sequence
    );
    if (!verbMorphologyPreparationCurrent(generation)) return;
    state.verbGuidedResolution = resolution;
    state.verbMorphologyCatalog = catalog;
    state.verbMorphologyFamily = family;
    state.verbMorphologyMatchBoard = matchBoard;
    state.verbMorphologySequenceCueRefs = await resolveMorphologySequenceCueRefs(
      curriculum,
      sequenceConfiguration
    );
    if (!verbMorphologyPreparationCurrent(generation)) return;
    await prepareVerbMeaningGate(curriculum, family, resolution);
    if (!verbMorphologyPreparationCurrent(generation)) return;
    showCompletedVerbMorphologySequence();
    return;
  }
  const resumable = claim?.status === "blocked" && claim.reason === "incomplete-step";
  const previewable = claim?.status === "deferred" && claim.reason === "not-presented";
  if (!resumable && !previewable) {
    const reason = claim?.reason || claim?.status || "unavailable";
    throw new Error(`The morphology sequence is locked (${reason}).`);
  }

  const { resolution, catalog, family, matchBoard } = await resolveVerbMorphologyStep(
    curriculum,
    familyConfiguration,
    sequenceConfiguration,
    claim
  );
  if (!verbMorphologyPreparationCurrent(generation)) return;
  state.verbGuidedResolution = resolution;
  state.verbMorphologyCatalog = catalog;
  state.verbMorphologyFamily = family;
  state.verbMorphologyMatchBoard = matchBoard;
  await prepareVerbMeaningGate(curriculum, family, resolution);
  if (!verbMorphologyPreparationCurrent(generation)) return;
  state.verbMorphologySequenceCueRefs = await resolveMorphologySequenceCueRefs(
    curriculum,
    sequenceConfiguration
  );
  if (!verbMorphologyPreparationCurrent(generation)) return;

  if (resumable) {
    const restored = await curriculum.restoreMorphologyRoundState(claim.taskRef);
    if (!verbMorphologyPreparationCurrent(generation)) return;
    if (!restored?.task
        || restored.task.taskId !== claim.taskRef?.taskId
        || restored.task.taskFingerprint !== claim.taskRef?.taskFingerprint) {
      throw new Error("The interrupted morphology task could not be restored exactly.");
    }
    const expectedRound = composeBoundMorphologyRound(
      catalog,
      resolution,
      restored.task.taskFingerprint,
      familyConfiguration.optionCount
    );
    if (restored.round && JSON.stringify(restored.round) !== JSON.stringify(expectedRound)) {
      throw new Error("The restored morphology round differs from its deterministic pinned pilot content.");
    }
    const round = expectedRound;
    if (round.taskFingerprint !== restored.task.taskFingerprint
        || round.cue?.cueRef?.id !== resolution.source.snapshot.selectedCueRef.id
        || round.cue?.cueRef?.revision !== resolution.source.snapshot.selectedCueRef.revision) {
      throw new Error("The restored morphology round differs from its exact sequence cue.");
    }
    const fallbackRoundState = verbMorphologyAdapter().createRoundState(round, {
      taskRef: morphologyTaskRefFor(round, resolution),
      itemRef: morphologyItemRefFor(round, resolution)
    });
    const progress = normalizeVerbMorphologyProgress(restored.state, fallbackRoundState, round);
    state.verbMorphologyProgressRevision = Number(restored.revision || 0);
    applyMorphologyGuidedRound(round, { task: restored.task, progress });
    state.verbMorphologyResume = true;
    if (!restored.round) {
      await saveVerbMorphologyProgress(progress);
      if (!verbMorphologyPreparationCurrent(generation)) return;
    }
    state.verbGuidedStatus = "ready";
    await recoverVerbMorphologyProgress({ duringInitialization: true });
    if (!verbMorphologyPreparationCurrent(generation)) return;
    if (state.verbMorphologySequenceComplete) {
      showCompletedVerbMorphologySequence();
    } else if (state.verbGuidedStatus === "step-complete") {
      state.verbMorphologyFocusNextStep = true;
      await prepareVerbMorphologyGuidedStep(curriculum, familyConfiguration);
    }
    return;
  }

  const previewRound = composeBoundMorphologyRound(
    catalog,
    resolution,
    `preview:${resolution.source.contentDigest}`,
    familyConfiguration.optionCount
  );
  const lifecycle = guidedOpportunityCore.createGuidedOpportunityLifecycle({
    curriculum,
    resolution,
    capabilityId: familyConfiguration.assessedCapabilityId,
    targetSkillId: sequenceConfiguration.targetSkillId,
    sequence: {
      orderedBindingIds: sequenceConfiguration.orderedBindingIds,
      expectedStep: claim.sequence.expectedStep
    }
  });
  state.verbGuidedLifecycle = lifecycle;
  state.verbGuidedStatus = "pending";
  applyMorphologyGuidedRound(previewRound);
}

async function prepareVerbMorphologyGuidedStep(curriculum, familyConfiguration) {
  const generation = state.verbMorphologyGeneration + 1;
  state.verbMorphologyGeneration = generation;
  const preparation = prepareVerbMorphologyGuidedStepInternal(
    curriculum,
    familyConfiguration,
    generation
  );
  state.verbMorphologyPreparePromise = preparation;
  try {
    return await preparation;
  } finally {
    if (state.verbMorphologyPreparePromise === preparation) {
      state.verbMorphologyPreparePromise = null;
    }
  }
}

function applyMorphologyGuidedRound(round, { task = null, progress = null } = {}) {
  const adapter = state.verbMorphologyAdapter;
  const resolution = state.verbGuidedResolution;
  if (!adapter || !resolution || !round) {
    throw new Error("Conjugation Comet round state requires an active pinned curriculum binding.");
  }
  const fallbackRoundState = adapter.createRoundState(round, {
    taskRef: morphologyTaskRefFor(round, resolution),
    itemRef: morphologyItemRefFor(round, resolution)
  });
  const normalizedProgress = progress
    ? normalizeVerbMorphologyProgress(progress, fallbackRoundState, round)
    : freshVerbMorphologyProgress(fallbackRoundState);
  adapter.viewModel(round, normalizedProgress.round, { interactionLocked: true });
  state.verbMorphologyRound = round;
  state.verbMorphologyRoundState = normalizedProgress.round;
  state.verbMorphologyProgress = normalizedProgress;
  state.verbMorphologyTask = task;
  state.verbMorphologyFocusNextAction = false;
  state.verbMorphologyFocusHintAction = false;
  state.verbMorphologyFocusRevealAction = false;
  state.verbMorphologySelectedItemRef = null;
  state.verbMorphologySelectedCueRef = null;
  state.verbMorphologyWrongItemRef = null;
  state.verbMorphologyWrongCueRef = null;
  state.verbGuidedSupportAtFirstResponse = Boolean(
    normalizedProgress.evidence.recorded
      && (normalizedProgress.evidence.hintsUsed || normalizedProgress.evidence.solutionRevealed)
  );
  state.verbMorphologyAnnouncement = "Match the highlighted English cue with its Czech form.";
  state.verbMorphologyAnnouncementKind = "";
}

function verbGuidedInteractionLocked() {
  return !state.verbGuidedMode
    || state.verbGuidedStatus !== "ready"
    || state.verbGuidedEvidencePending
    || state.verbProgressResetPending;
}

function renderVerbGuidedStatus() {
  const banner = $("#verbGuidedStatus");
  const title = $("#verbGuidedStatusTitle");
  const detail = $("#verbGuidedStatusDetail");
  if (!banner || !detail) return;
  banner.hidden = false;
  banner.removeAttribute("role");
  banner.removeAttribute("aria-live");
  banner.removeAttribute("aria-atomic");
  banner.classList.toggle("is-error", ["failed", "unavailable"].includes(state.verbGuidedStatus));
  const support = verbMorphologySupportState();
  const supported = Boolean(support.hintsUsed || support.solutionRevealed);
  const firstResponseRecorded = verbMorphologyFirstResponseRecorded();
  const supportedBeforeResponse = Boolean(state.verbGuidedSupportAtFirstResponse);
  const solutionShownAfterResponse = Boolean(
    firstResponseRecorded && support.solutionRevealed && !supportedBeforeResponse
  );
  const contextHintShownAfterResponse = Boolean(
    firstResponseRecorded && support.hintsUsed && !support.solutionRevealed && !supportedBeforeResponse
  );
  const total = sequenceTotalSteps() || "—";
  const step = Number(state.verbMorphologySequence?.stepNumber || 1);
  if (title) {
    title.textContent = "Conjugation Comet · teacher-review pilot";
  }
  if (state.verbGuidedStatus === "unavailable") {
    detail.textContent = state.verbGuidedError
      || "This course has not released reviewed Conjugation Comet content.";
  } else if (state.verbGuidedStatus === "failed") {
    detail.textContent = `Locked: ${state.verbGuidedError || "curriculum evidence is unavailable"}`;
  } else if (state.verbGuidedStatus === "recovery-pending") {
    detail.textContent = "Saved locally · use Retry to finish the durable evidence checkpoint";
  } else if (!state.verbMeaningMatched || state.verbMeaningTransitionPending) {
    detail.textContent = "Meaning warm-up · one reviewed 1-of-4 match · morphology evidence has not started";
  } else if (state.verbGuidedStatus === "awaiting-next") {
    detail.textContent = supportedBeforeResponse
      ? `Match ${step} of ${total} complete · supported comprehension, not independent evidence · advancing…`
      : solutionShownAfterResponse
        ? `Match ${step} of ${total} complete · first response recorded independently; solution shown afterward · advancing…`
        : contextHintShownAfterResponse
          ? `Match ${step} of ${total} complete · first response recorded independently; context hint shown afterward · advancing…`
          : `Match ${step} of ${total} complete · advancing to the next reviewed cue…`;
  } else if (state.verbGuidedStatus === "step-complete") {
    detail.textContent = `Match ${step} of ${total} complete · preparing the next reviewed cue…`;
  } else if (state.verbGuidedStatus === "complete") {
    detail.textContent = `${total}-form reviewed set complete · meaning and unit mastery remain unchanged · 0 XP`;
  } else if (supportedBeforeResponse) {
    detail.textContent = "Supported practice · not independent evidence";
  } else if (supported && !firstResponseRecorded) {
    detail.textContent = "Context support is visible · the next answer will be supported comprehension";
  } else if (solutionShownAfterResponse) {
    detail.textContent = "First response recorded independently · solution shown afterward";
  } else if (contextHintShownAfterResponse) {
    detail.textContent = "First response recorded independently · context hint shown afterward";
  } else if (firstResponseRecorded) {
    detail.textContent = "First response recorded · finish this exact form contrast";
  } else if (state.verbGuidedStatus === "ready") {
    detail.textContent = `Match ${step} of ${total} · whole reviewed form set visible · non-mastery · 0 XP`;
  } else {
    detail.textContent = "Verifying the exact bound content and evidence task…";
  }
}

function waitForVerbPaintedFrame() {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(resolve));
  });
}

function verbMorphologyPresentationPainted() {
  const board = $("#verbMorphologyBoard");
  const matchBoard = state.verbMorphologyMatchBoard;
  const round = state.verbMorphologyRound;
  const selectedCueRef = state.verbGuidedResolution?.source?.snapshot?.selectedCueRef;
  if (!board || board.hidden || !matchBoard || !round || !selectedCueRef
      || !state.verbMeaningMatched || state.verbMeaningTransitionPending
      || round.cue?.cueRef?.id !== selectedCueRef.id
      || round.cue?.cueRef?.revision !== selectedCueRef.revision) return false;
  const presentation = round.cue.presentation || {};
  const cueButton = Array.from(board.querySelectorAll("button[data-morphology-cue-id]"))
    .find((button) => (
      button.dataset.morphologyCueId === selectedCueRef.id
        && Number(button.dataset.morphologyCueRevision) === selectedCueRef.revision
    ));
  const visibleCueMatches = cueButton?.querySelector(".conjugation-comet-cue-natural")?.textContent
      === presentation.naturalTranslationEn
    && cueButton?.querySelector(".conjugation-comet-cue-label")?.textContent
      === `(${presentation.teachingLabelEn})`;
  if (!visibleCueMatches) return false;
  const buttons = Array.from(board.querySelectorAll("button[data-morphology-item-id]"));
  return buttons.length === matchBoard.forms.length
    && matchBoard.forms.every((form) => buttons.some((button) => (
      button.dataset.morphologyItemId === form.itemRef.id
        && Number(button.dataset.morphologyItemRevision) === form.itemRef.revision
        && button.querySelector("[data-morphology-choice-surface]")?.textContent === form.surface
    )));
}

function verbGuidedPresentationReady(epoch, lifecycle) {
  const panel = $("#conjugationCometPanel");
  return Boolean(
    state.verbGuidedMode
    && state.verbGuidedStatus === "activating"
    && !state.verbProgressResetPending
    && state.verbGuidedActivationEpoch === epoch
    && state.verbGuidedLifecycle === lifecycle
    && document.visibilityState !== "hidden"
    && panel
    && !panel.hidden
    && panel.classList.contains("is-active")
    && verbMorphologyPresentationPainted()
  );
}

function deferVerbGuidedActivation() {
  if (!state.verbGuidedMode || state.verbGuidedStatus !== "activating") return;
  state.verbGuidedActivationEpoch += 1;
  state.verbGuidedStatus = "pending";
  state.verbGuidedActivationPromise = null;
}

async function activateVerbGuidedOpportunity() {
  if (!state.verbGuidedMode || state.verbGuidedStatus !== "pending") return;
  if (state.verbGuidedActivationPromise) return state.verbGuidedActivationPromise;
  const activationEpoch = state.verbGuidedActivationEpoch + 1;
  const lifecycle = state.verbGuidedLifecycle;
  state.verbGuidedActivationEpoch = activationEpoch;
  state.verbGuidedStatus = "activating";
  renderConjugationComet();
  const activationPromise = waitForVerbPaintedFrame()
    .then(() => {
      if (!verbGuidedPresentationReady(activationEpoch, lifecycle)) return null;
      return lifecycle.activate({
        requirePresented: () => verbGuidedPresentationReady(activationEpoch, lifecycle)
      });
    })
    .then(async (activation) => {
      if (!activation || activation.phase === "pending") {
        if (state.verbGuidedActivationEpoch === activationEpoch) {
          const changedStep = lifecycle.state().sequencePreview?.bindingId
            && lifecycle.state().sequencePreview.bindingId !== state.verbGuidedResolution?.binding?.id;
          if (changedStep) {
            await prepareVerbMorphologyGuidedStep(
              window.CaatuuCurriculum,
              conjugationCometConfiguration()
            );
            renderConjugationComet();
          } else {
            state.verbGuidedStatus = "pending";
          }
        }
        return;
      }
      if (activation.phase === "complete") {
        if (state.verbGuidedActivationEpoch !== activationEpoch
            || state.verbGuidedLifecycle !== lifecycle
            || state.verbProgressResetPending) return;
        state.verbMorphologySequence = lifecycle.state().sequence || state.verbMorphologySequence;
        state.verbMorphologySequencePreview = lifecycle.state().sequencePreview
          || state.verbMorphologySequencePreview;
        showCompletedVerbMorphologySequence({ focus: true });
        renderConjugationComet();
        return;
      }
      if (!verbGuidedPresentationReady(activationEpoch, lifecycle)) {
        if (state.verbGuidedActivationEpoch === activationEpoch) {
          state.verbGuidedStatus = "pending";
        }
        return;
      }
      const task = lifecycle.state().task;
      if (!task) throw new Error("The claimed Conjugation Comet step did not return its exact issued task.");
      const round = composeBoundMorphologyRound(
        state.verbMorphologyCatalog,
        state.verbGuidedResolution,
        task.taskFingerprint,
        conjugationCometConfiguration().optionCount
      );
      applyMorphologyGuidedRound(round, { task });
      state.verbMorphologySequence = lifecycle.state().sequence || state.verbMorphologySequence;
      state.verbMorphologySequencePreview = lifecycle.state().sequencePreview
        || state.verbMorphologySequencePreview;
      await saveVerbMorphologyProgress();
      state.verbGuidedStatus = "ready";
      state.verbMorphologyResume = false;
      state.verbMorphologyAnnouncement =
        `Choose the ${course.targetLanguage?.label || "target-language"} form for this exact situation.`;
      renderConjugationComet();
    })
    .catch(async (error) => {
      const stillCurrent = state.verbGuidedActivationEpoch === activationEpoch
        && state.verbGuidedLifecycle === lifecycle
        && !state.verbProgressResetPending;
      await abortVerbGuidedLifecycle(lifecycle);
      if (!stillCurrent) return;
      state.verbGuidedStatus = "failed";
      state.verbGuidedError = error?.message || String(error);
      state.verbMorphologyAnnouncement =
        "Guided evidence could not be prepared. This round is locked.";
      console.error("Conjugation Comet activation failed closed", error);
      renderConjugationComet();
    })
    .finally(() => {
      if (state.verbGuidedActivationPromise === activationPromise) {
        state.verbGuidedActivationPromise = null;
      }
    });
  state.verbGuidedActivationPromise = activationPromise;
  return activationPromise;
}

function setVerbMorphologyAnnouncement(message, kind = "") {
  state.verbMorphologyAnnouncement = String(message || "");
  state.verbMorphologyAnnouncementKind = kind;
}

function serializeVerbMorphologyRoundState(changes = {}) {
  if (!state.verbMorphologyAdapter || !state.verbMorphologyRoundState) {
    throw new Error("The morphology round state is unavailable.");
  }
  return state.verbMorphologyAdapter.serializeRound({
    ...state.verbMorphologyRoundState,
    ...changes
  });
}

function updateVerbMorphologyRoundState(changes = {}) {
  state.verbMorphologyRoundState = serializeVerbMorphologyRoundState(changes);
  if (state.verbMorphologyProgress) {
    state.verbMorphologyProgress = {
      ...state.verbMorphologyProgress,
      round: state.verbMorphologyRoundState
    };
  }
}

function verbMorphologyFirstResponseRecorded() {
  return state.verbMorphologyProgress?.evidence?.recorded === true
    || state.verbGuidedLifecycle?.state?.().firstResponseRecorded === true;
}

function verbMorphologySupportState() {
  const progress = state.verbMorphologyProgress;
  const lifecycle = state.verbGuidedLifecycle?.state?.();
  const hintState = progress?.round?.hintState;
  const hintStates = verbExerciseFamilyCore?.VERB_HINT_STATES;
  return {
    hintsUsed: Math.max(
      Number(progress?.evidence?.hintsUsed || progress?.pendingEvidence?.request?.hintsUsed || 0),
      Number(lifecycle?.hintsUsed || 0),
      hintState && hintStates && hintState !== hintStates.AVAILABLE ? 1 : 0
    ),
    solutionRevealed: Boolean(
      progress?.evidence?.solutionRevealed
        || progress?.pendingEvidence?.request?.solutionRevealed
        || lifecycle?.solutionRevealed
        || (hintStates && hintState === hintStates.SOLUTION_REVEALED)
    )
  };
}

async function saveVerbMorphologyProgress(progress = state.verbMorphologyProgress) {
  const task = state.verbMorphologyTask;
  if (!task || !state.verbMorphologyRound || !progress) {
    throw new Error("Morphology progress requires an exact issued task and round.");
  }
  const normalized = normalizeVerbMorphologyProgress(
    progress,
    state.verbMorphologyRoundState,
    state.verbMorphologyRound
  );
  const saved = await window.CaatuuCurriculum.saveMorphologyRoundState(task, {
    round: state.verbMorphologyRound,
    state: normalized,
    expectedRevision: state.verbMorphologyProgressRevision
  });
  state.verbMorphologyProgress = normalized;
  state.verbMorphologyRoundState = normalized.round;
  state.verbMorphologyProgressRevision = Number(saved?.revision || state.verbMorphologyProgressRevision);
  return saved;
}

async function abortVerbGuidedLifecycle(lifecycle = state.verbGuidedLifecycle) {
  if (!lifecycle?.abort) return;
  try {
    await lifecycle.abort();
  } finally {
    if (state.verbGuidedLifecycle === lifecycle) state.verbGuidedLifecycle = null;
  }
}

async function failVerbMorphologyOnRevisionConflict(error) {
  const conflictCodes = [
    "CURRICULUM_MORPHOLOGY_ROUND_REVISION_CONFLICT",
    "CURRICULUM_MORPHOLOGY_ROUND_SETTLED"
  ];
  const invalidatedCodes = [
    "CURRICULUM_MORPHOLOGY_ROUND_TASK_INVALID",
    "EVIDENCE_TASK_NOT_ISSUED",
    "CURRICULUM_DEVELOPER_PILOT_SEQUENCE_INVALID",
    "CURRICULUM_DEVELOPER_PILOT_SEQUENCE_UNKNOWN",
    "CURRICULUM_DEVELOPER_PILOT_SEQUENCE_CONFLICT",
    "CURRICULUM_DEVELOPER_PILOT_COMPLETION_TASK_INVALID",
    "CURRICULUM_DEVELOPER_PILOT_COMPLETION_UNCLAIMED",
    "CURRICULUM_DEVELOPER_PILOT_COMPLETION_OUT_OF_ORDER",
    "CURRICULUM_DEVELOPER_PILOT_COMPLETION_CONFLICT",
    "CURRICULUM_DEVELOPER_PILOT_COMPLETION_EVIDENCE_MISMATCH",
    "CURRICULUM_DEVELOPER_PILOT_COMPLETION_SETTLEMENT_MISMATCH",
    "CURRICULUM_DEVELOPER_PILOT_COMPLETION_KIND_INVALID",
    "CURRICULUM_STORAGE_CORRUPT"
  ];
  if (![...conflictCodes, ...invalidatedCodes].includes(error?.code)) return false;
  await abortVerbGuidedLifecycle();
  state.verbMorphologyResume = true;
  state.verbGuidedError = error.message;
  state.verbGuidedStatus = "failed";
  setVerbMorphologyAnnouncement(
    invalidatedCodes.includes(error?.code)
      ? "This task was cleared or invalidated in another tab. Reload to start from the current curriculum state."
      : "This task changed in another tab. Reload this page to continue from the newest saved state.",
    "wrong"
  );
  return true;
}

function trackVerbGuidedOperation(operation) {
  const promise = Promise.resolve().then(operation);
  state.verbGuidedOperations.add(promise);
  promise.then(
    () => state.verbGuidedOperations.delete(promise),
    (error) => {
      state.verbGuidedOperations.delete(promise);
      if (!state.verbProgressResetPending) console.error("Guided Verb operation failed", error);
    }
  );
  return promise;
}

function morphologyEvidenceRequest({ score, solutionRevealed = false, occurredAt = new Date().toISOString() } = {}) {
  const support = verbMorphologySupportState();
  return {
    attemptNumber: 1,
    score,
    solutionRevealed,
    hintsUsed: support.hintsUsed,
    occurredAt
  };
}

async function recordVerbMorphologyEvidence(request, { direct = false } = {}) {
  if (!direct && state.verbGuidedLifecycle && !state.verbMorphologyResume) {
    return request.solutionRevealed
      ? state.verbGuidedLifecycle.recordSolutionReveal({ occurredAt: request.occurredAt })
      : state.verbGuidedLifecycle.recordFirstResponse({
        score: request.score,
        occurredAt: request.occurredAt
      });
  }
  return window.CaatuuCurriculum.recordEvidence(state.verbMorphologyTask, request);
}

async function completeVerbMorphologySequenceStep(completionKind, { direct = false } = {}) {
  const sequenceConfiguration = morphologySequenceConfiguration(
    conjugationCometConfiguration()
  );
  const task = state.verbMorphologyTask;
  if (!task) throw new Error("The morphology sequence checkpoint has no issued task.");
  let completion;
  if (!direct && state.verbGuidedLifecycle && !state.verbMorphologyResume) {
    completion = await state.verbGuidedLifecycle.completeSequenceStep(completionKind, {
      completedAt: new Date().toISOString()
    });
    completion = completion.result;
  } else {
    completion = await window.CaatuuCurriculum.completeDeveloperPilotStep({
      orderedBindingIds: sequenceConfiguration.orderedBindingIds,
      targetSkillId: sequenceConfiguration.targetSkillId,
      taskId: task.taskId,
      taskFingerprint: task.taskFingerprint,
      completionKind,
      completedAt: new Date().toISOString()
    });
  }
  const totalSteps = sequenceTotalSteps();
  const finalStep = Number(completion?.stepIndex) + 1 >= totalSteps;
  state.verbMorphologyProgress = {
    ...state.verbMorphologyProgress,
    pendingCompletionKind: null
  };
  state.verbMorphologySequenceComplete = finalStep;
  state.verbGuidedStatus = finalStep ? "complete" : "step-complete";
  const completedNumber = Number(completion?.stepIndex) + 1;
  setVerbMorphologyAnnouncement(
    finalStep
      ? `All ${totalSteps} pinned pilot forms are complete. This remains non-mastery practice with 0 XP.`
      : `Form ${completedNumber} of ${totalSteps} complete. Continue when you are ready for the next pilot contrast.`,
    "correct"
  );
  return completion;
}

async function recoverVerbMorphologyProgress({ duringInitialization = false } = {}) {
  let progress = state.verbMorphologyProgress;
  if (!progress || !state.verbMorphologyTask) return;
  state.verbGuidedEvidencePending = true;
  if (!duringInitialization) renderConjugationComet();
  try {
    if (progress.pendingEvidence) {
      const pending = progress.pendingEvidence;
      await recordVerbMorphologyEvidence(pending.request, { direct: true });
      state.verbMorphologyResume = true;
      const recoveredProgress = {
        ...progress,
        round: pending.round,
        evidence: {
          recorded: true,
          score: pending.request.score,
          solutionRevealed: pending.request.solutionRevealed,
          hintsUsed: pending.request.hintsUsed,
          occurredAt: pending.request.occurredAt
        },
        pendingEvidence: null,
        terminalCompletionKind: pending.completionKind,
        pendingCompletionKind: null
      };
      await saveVerbMorphologyProgress(recoveredProgress);
      progress = state.verbMorphologyProgress;
      state.verbGuidedSupportAtFirstResponse = Boolean(
        progress.evidence.hintsUsed || progress.evidence.solutionRevealed
      );
    }
    const completionKind = progress.pendingCompletionKind;
    if (completionKind) {
      await completeVerbMorphologySequenceStep(completionKind, { direct: true });
    } else if (progress.terminalCompletionKind) {
      state.verbGuidedStatus = "awaiting-next";
      const restoredWithSupport = Boolean(state.verbGuidedSupportAtFirstResponse);
      setVerbMorphologyAnnouncement(
        progress.terminalCompletionKind === "solution-review"
          ? restoredWithSupport
            ? "The shown solution is restored. This remains supported comprehension, not independent evidence. Continuing to the next match."
            : "The earlier first response remains recorded; the restored solution review does not change it. Continuing to the next match."
          : restoredWithSupport
            ? "This form contrast is restored as supported comprehension, not independent evidence. Continuing to the next match."
            : "This form contrast is complete. Continuing to the next match.",
        progress.terminalCompletionKind === "solution-review" ? "hint" : "correct"
      );
    } else {
      state.verbGuidedStatus = "ready";
      if (progress.evidence.recorded) {
        setVerbMorphologyAnnouncement(
          "Your recorded first response was restored. Continue the same corrective round or review the form.",
          "hint"
        );
      }
    }
  } catch (error) {
    state.verbGuidedError = error?.message || String(error);
    if (!(await failVerbMorphologyOnRevisionConflict(error))) {
      state.verbGuidedStatus = "recovery-pending";
      setVerbMorphologyAnnouncement(
        progress.pendingEvidence
          ? "Your answer is saved locally but its curriculum evidence still needs to be retried."
          : "Your evidence is recorded, but the sequence checkpoint still needs to be retried.",
        "wrong"
      );
    }
    if (duringInitialization) return;
  } finally {
    state.verbGuidedEvidencePending = false;
    renderConjugationComet();
    if (state.verbGuidedStatus === "awaiting-next") scheduleVerbMorphologyAutoAdvance();
  }
}

function morphologyPresentation() {
  return state.verbMorphologyRound?.cue?.presentation || {};
}

function verbMorphologyFocusVisible(board = $("#verbMorphologyBoard")) {
  const panel = $("#conjugationCometPanel");
  return Boolean(
    board
      && !board.hidden
      && panel
      && !panel.hidden
      && panel.classList.contains("is-active")
      && document.visibilityState !== "hidden"
  );
}

function focusVerbMorphologyControl(control, board) {
  if (!control || !verbMorphologyFocusVisible(board)) return false;
  control.focus({ preventScroll: true });
  return document.activeElement === control;
}

function createVerbMatchCard({
  text,
  language = "",
  className = "",
  disabled = false,
  ariaLabel = ""
} = {}) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `verb-match-card${className ? ` ${className}` : ""}`;
  button.disabled = disabled;
  if (language) button.lang = language;
  if (ariaLabel) button.setAttribute("aria-label", ariaLabel);
  const copy = document.createElement("span");
  copy.className = "verb-match-card-copy";
  copy.textContent = text;
  button.append(copy);
  const row = document.createElement("div");
  row.className = "verb-match-card-row";
  row.append(button);
  return { row, button, copy };
}

function renderVerbMeaningGate() {
  const board = $("#verbMeaningGateBoard");
  const targetColumn = $("#verbMeaningTargetColumn");
  const englishColumn = $("#verbMeaningEnglishColumn");
  if (!board || !targetColumn || !englishColumn) return;
  const plan = state.verbMeaningPlan;
  board.hidden = false;
  board.style.setProperty("--verb-pair-count", "4");
  board.setAttribute("aria-busy", state.verbMeaningTransitionPending || !plan ? "true" : "false");
  if (!plan) {
    targetColumn.replaceChildren();
    englishColumn.replaceChildren();
    setText("#verbMeaningGateFeedback", "Preparing the reviewed meaning choices.");
    return;
  }
  const targetPair = plan.round.find((pair) => pair.id === plan.targetId);
  const targetCard = createVerbMatchCard({
    text: targetPair.cz,
    language: course.targetLanguage?.locale || "cs",
    className: [
      state.verbMeaningSelectedTarget ? "is-selected" : "",
      state.verbMeaningMatched ? "is-matched" : ""
    ].filter(Boolean).join(" "),
    disabled: verbMeaningInteractionLocked(),
    ariaLabel: `${targetPair.cz}, Czech verb${state.verbMeaningSelectedTarget ? ", selected" : ""}`
  });
  targetCard.button.dataset.verbMeaningTargetId = targetPair.id;
  targetColumn.replaceChildren(targetCard.row);

  const englishRows = plan.englishRound.map((pair) => {
    const matched = state.verbMeaningMatched && pair.id === plan.targetId;
    const wrong = state.verbMeaningWrongEnglishId === pair.id;
    const selected = state.verbMeaningSelectedEnglishId === pair.id;
    const card = createVerbMatchCard({
      text: pair.eng,
      language: "en",
      className: [
        "verb-match-card-en",
        matched ? "is-matched" : "",
        wrong ? "is-wrong" : "",
        selected ? "is-selected" : ""
      ].filter(Boolean).join(" "),
      disabled: verbMeaningInteractionLocked(),
      ariaLabel: `${pair.eng}, English meaning${matched ? ", matched" : ""}`
    });
    card.button.dataset.verbMeaningEnglishId = pair.id;
    return card.row;
  });
  englishColumn.replaceChildren(...englishRows);
  const feedback = $("#verbMeaningGateFeedback");
  if (feedback) {
    feedback.textContent = state.verbMeaningAnnouncement;
    feedback.className = `verb-match-feedback${state.verbMeaningAnnouncementKind ? ` is-${state.verbMeaningAnnouncementKind}` : ""}`;
  }
  setText(
    "#verbMeaningGateProgress",
    state.verbMeaningMatched
      ? "1 of 1 matched · opening forms · 0 XP"
      : "0 of 1 matched · warm-up · 0 XP"
  );
}

function selectVerbMeaningTarget(event) {
  const button = event.target.closest("button[data-verb-meaning-target-id]");
  if (!button || button.disabled || verbMeaningInteractionLocked()) return;
  state.verbMeaningSelectedTarget = true;
  state.verbMeaningAnnouncement = "Now choose this verb’s English meaning.";
  state.verbMeaningAnnouncementKind = "";
  renderConjugationComet();
}

function clearVerbMeaningWrongState() {
  state.verbMeaningWrongEnglishId = "";
  if (!state.verbMeaningMatched) renderConjugationComet();
}

function verbMeaningInteractionLocked() {
  return state.verbMeaningMatched
    || state.verbMeaningTransitionPending
    || state.verbProgressResetPending
    || state.verbGuidedStatus !== "pending";
}

function selectVerbMeaningEnglish(event) {
  const button = event.target.closest("button[data-verb-meaning-english-id]");
  if (!button || button.disabled || verbMeaningInteractionLocked()) return;
  if (!state.verbMeaningSelectedTarget) {
    state.verbMeaningAnnouncement = "Select the Czech verb first, then choose its meaning.";
    state.verbMeaningAnnouncementKind = "hint";
    renderConjugationComet();
    return;
  }
  const selectedId = button.dataset.verbMeaningEnglishId;
  state.verbMeaningSelectedEnglishId = selectedId;
  if (selectedId !== state.verbMeaningPlan.targetId) {
    state.verbMeaningWrongEnglishId = selectedId;
    state.verbMeaningAnnouncement = "Not this meaning. Keep the same Czech verb and try another English card.";
    state.verbMeaningAnnouncementKind = "wrong";
    renderConjugationComet();
    window.setTimeout(clearVerbMeaningWrongState, 520);
    return;
  }
  state.verbMeaningMatched = true;
  state.verbMeaningTransitionPending = true;
  state.verbMeaningAnnouncement = "Correct. Now match the verb’s reviewed Czech forms.";
  state.verbMeaningAnnouncementKind = "correct";
  try {
    persistVerbMeaningGate();
  } catch (error) {
    console.warn("Conjugation Comet could not persist its unscored meaning gate.", error);
  }
  renderConjugationComet();
  if (state.verbMeaningTransitionTimer) window.clearTimeout(state.verbMeaningTransitionTimer);
  state.verbMeaningTransitionTimer = window.setTimeout(() => {
    state.verbMeaningTransitionTimer = null;
    state.verbMeaningTransitionPending = false;
    state.verbMeaningSelectedTarget = false;
    state.verbMeaningSelectedEnglishId = "";
    renderConjugationComet();
  }, 640);
}

function completedMorphologyCueKeys() {
  const total = sequenceTotalSteps();
  let completedCount = Math.max(0, Number(state.verbMorphologySequence?.stepNumber || 1) - 1);
  if (["awaiting-next", "step-complete"].includes(state.verbGuidedStatus)) {
    completedCount += 1;
  }
  if (state.verbMorphologySequenceComplete || state.verbGuidedStatus === "complete") {
    completedCount = total;
  }
  return new Set(
    state.verbMorphologySequenceCueRefs
      .slice(0, completedCount)
      .map(morphologyRefKey)
  );
}

function matchedMorphologyItemKeys(completedCueKeys) {
  const cues = state.verbMorphologyMatchBoard?.cues || [];
  return new Set(cues
    .filter((cue) => completedCueKeys.has(morphologyRefKey(cue.cueRef)))
    .map((cue) => morphologyRefKey(cue.targetItemRef)));
}

function renderMorphologyMatchColumns() {
  const board = state.verbMorphologyMatchBoard;
  const formsColumn = $("#verbMorphologyFormsColumn");
  const cuesColumn = $("#verbMorphologyCuesColumn");
  if (!formsColumn || !cuesColumn) return;
  if (!board) {
    formsColumn.replaceChildren();
    cuesColumn.replaceChildren();
    return;
  }
  const completedCueKeys = completedMorphologyCueKeys();
  const matchedItemKeys = matchedMorphologyItemKeys(completedCueKeys);
  const currentCueRef = state.verbMorphologyRound?.cue?.cueRef || null;
  const currentCueKey = morphologyRefKey(currentCueRef);
  const locked = verbGuidedInteractionLocked();
  const targetLanguage = course.targetLanguage?.locale || "cs";
  const formRows = board.forms.map((form) => {
    const key = morphologyRefKey(form.itemRef);
    const matched = matchedItemKeys.has(key);
    const selected = sameEntityRef(state.verbMorphologySelectedItemRef, form.itemRef);
    const wrong = sameEntityRef(state.verbMorphologyWrongItemRef, form.itemRef);
    const card = createVerbMatchCard({
      text: form.surface,
      language: targetLanguage,
      className: [
        matched ? "is-matched" : "",
        selected ? "is-selected" : "",
        wrong ? "is-wrong" : ""
      ].filter(Boolean).join(" "),
      disabled: matched || locked,
      ariaLabel: `${form.surface}, Czech form${matched ? ", matched" : selected ? ", selected" : ""}`
    });
    card.button.dataset.morphologyItemId = form.itemRef.id;
    card.button.dataset.morphologyItemRevision = String(form.itemRef.revision);
    card.copy.dataset.morphologyChoiceSurface = "";
    return card.row;
  });
  formsColumn.replaceChildren(...formRows);

  const cueRows = board.cues.map((cue) => {
    const key = morphologyRefKey(cue.cueRef);
    const matched = completedCueKeys.has(key);
    const current = key === currentCueKey && !matched;
    const selected = sameEntityRef(state.verbMorphologySelectedCueRef, cue.cueRef);
    const wrong = sameEntityRef(state.verbMorphologyWrongCueRef, cue.cueRef);
    const natural = cue.presentation.naturalTranslationEn;
    const teachingLabel = cue.presentation.teachingLabelEn;
    const card = createVerbMatchCard({
      text: "",
      language: "en",
      className: [
        "verb-match-card-en",
        matched ? "is-matched" : "",
        current ? "is-current" : "",
        !matched && !current ? "is-upcoming" : "",
        selected ? "is-selected" : "",
        wrong ? "is-wrong" : ""
      ].filter(Boolean).join(" "),
      disabled: matched || locked,
      ariaLabel: `${natural} ${teachingLabel}.${matched ? " Matched." : current ? " Current cue." : " Upcoming cue."}`
    });
    const cueCopy = document.createElement("span");
    cueCopy.className = "conjugation-comet-cue-copy";
    const naturalNode = document.createElement("span");
    naturalNode.className = "conjugation-comet-cue-natural";
    naturalNode.textContent = natural;
    const labelNode = document.createElement("span");
    labelNode.className = "conjugation-comet-cue-label";
    labelNode.textContent = `(${teachingLabel})`;
    cueCopy.append(naturalNode, labelNode);
    card.button.replaceChildren(cueCopy);
    card.button.dataset.morphologyCueId = cue.cueRef.id;
    card.button.dataset.morphologyCueRevision = String(cue.cueRef.revision);
    return card.row;
  });
  cuesColumn.replaceChildren(...cueRows);
}

function renderVerbMorphology() {
  const board = $("#verbMorphologyBoard");
  if (!board) return;
  board.hidden = false;
  renderVerbGuidedStatus();

  const round = state.verbMorphologyRound;
  const persistedRound = state.verbMorphologyRoundState;
  const adapter = state.verbMorphologyAdapter;
  const instructions = $("#verbMorphologyInstructions");
  const actions = board.querySelector(".verb-morphology-actions");
  const lemma = $("#verbMorphologyLemma");
  const nextButton = $("#verbMorphologyNextButton");
  const hintPanel = $("#verbMorphologyHint");
  const total = sequenceTotalSteps();
  const matchedCount = Math.min(total, completedMorphologyCueKeys().size);
  board.style.setProperty(
    "--verb-pair-count",
    String(Math.max(1, state.verbMorphologyMatchBoard?.forms?.length || total || 1))
  );
  board.classList.toggle("is-sequence-complete", state.verbMorphologySequenceComplete);
  renderMorphologyMatchColumns();

  if (state.verbMorphologySequenceComplete && !round) {
    if (instructions) {
      instructions.hidden = false;
      instructions.textContent = "Every reviewed Czech form has been matched to its distinct English cue.";
    }
    if (actions) actions.hidden = true;
    if (lemma) lemma.hidden = !state.verbMorphologyFamily;
    if (hintPanel) hintPanel.hidden = true;
    if (nextButton) nextButton.hidden = true;
    setText("#verbMorphologyTitle", `${total} reviewed forms matched`);
    setText("#verbMorphologyLemmaTarget", state.verbMorphologyFamily?.metadata?.lemmaTarget || "");
    setText("#verbMorphologyGloss", state.verbMorphologyFamily?.metadata?.glossEn || "");
    setText("#verbMorphologyFeedback", state.verbMorphologyAnnouncement);
    setText("#verbMorphologyProgress", `${total} of ${total} matched · non-mastery · 0 XP`);
    const feedback = $("#verbMorphologyFeedback");
    if (feedback) feedback.className = "verb-match-feedback is-correct";
    board.setAttribute("aria-busy", state.verbProgressResetPending ? "true" : "false");
    if (state.verbMorphologyFocusNextStep) {
      const summary = $("#verbMorphologyFeedback");
      if (summary) {
        summary.tabIndex = -1;
        if (focusVerbMorphologyControl(summary, board)) {
          state.verbMorphologyFocusNextStep = false;
        }
      }
    }
    return;
  }

  if (!round || !persistedRound || !adapter) {
    if (instructions) instructions.hidden = true;
    if (actions) actions.hidden = true;
    if (lemma) lemma.hidden = true;
    if (hintPanel) hintPanel.hidden = true;
    if (nextButton) nextButton.hidden = true;
    const preparing = ["loading", "pending", "activating"].includes(state.verbGuidedStatus);
    setText("#verbMorphologyTitle", preparing ? "Preparing reviewed forms" : "Conjugation Comet is locked");
    setText(
      "#verbMorphologyFeedback",
      preparing
        ? "Verifying the reviewed form set and its exact curriculum task."
        : state.verbGuidedError || "The pinned pilot content is unavailable."
    );
    setText("#verbMorphologyProgress", preparing ? "Preparing · non-mastery · 0 XP" : "Unavailable · non-mastery · 0 XP");
    const feedback = $("#verbMorphologyFeedback");
    if (feedback) feedback.className = `verb-match-feedback${preparing ? "" : " is-wrong"}`;
    board.setAttribute(
      "aria-busy",
      state.verbProgressResetPending
        || ["loading", "pending", "activating"].includes(state.verbGuidedStatus)
        ? "true"
        : "false"
    );
    return;
  }

  if (instructions) instructions.hidden = false;
  if (actions) actions.hidden = false;
  if (lemma) lemma.hidden = false;

  const presentation = morphologyPresentation();
  const familyMetadata = state.verbMorphologyFamily?.metadata || {};
  const lemmaTarget = familyMetadata.lemmaTarget || "pilot verb";
  const glossEn = familyMetadata.glossEn || "verb form";
  const targetLanguageLabel = course.targetLanguage?.label || "target language";
  const targetLanguageLocale = course.targetLanguage?.locale || course.targetLanguage?.id || "";
  const instruction = `Match the highlighted English cue with its ${targetLanguageLabel} form; select either card first.`;
  const hintText = presentation.hintEn || presentation.contextEn || "Use the participant role and current-time cue.";
  const viewModel = adapter.viewModel(round, persistedRound, {
    interactionLocked: verbGuidedInteractionLocked(),
    announcement: state.verbMorphologyAnnouncement,
    cueText: presentation.naturalTranslationEn || presentation.contextEn || round.cue.key,
    cueLanguage: "en",
    targetLanguage: targetLanguageLocale,
    instruction,
    choiceGroupLabel: `${targetLanguageLabel} verb-form choices`,
    hintText
  });

  board.setAttribute(
    "aria-busy",
    state.verbProgressResetPending
      || state.verbGuidedEvidencePending
      || state.verbMorphologyAdvancePending
      || ["loading", "pending", "activating"].includes(state.verbGuidedStatus)
      ? "true"
      : "false"
  );
  setText("#verbMorphologyTitle", "Match every form");
  setText("#verbMorphologyLemmaTarget", lemmaTarget);
  setText("#verbMorphologyGloss", glossEn);
  setText("#verbMorphologyInstructions", `${instruction} Every reviewed form remains visible.`);
  const lemmaNode = $("#verbMorphologyLemmaTarget");
  if (lemmaNode) lemmaNode.lang = targetLanguageLocale;
  const glossNode = $("#verbMorphologyGloss");
  if (glossNode) glossNode.lang = "en";
  setText(
    "#verbMorphologyProgress",
    `${matchedCount} of ${total} matched · reviewed present-singular set · 0 XP`
  );

  renderMorphologyMatchColumns();
  if (state.verbMorphologyFocusNextStep
      && state.verbGuidedStatus === "ready"
      && !state.verbGuidedEvidencePending) {
    const currentCueRef = state.verbMorphologyRound?.cue?.cueRef;
    const currentCue = Array.from(board.querySelectorAll("button[data-morphology-cue-id]"))
      .find((button) => (
        button.dataset.morphologyCueId === currentCueRef?.id
          && Number(button.dataset.morphologyCueRevision) === currentCueRef?.revision
      ));
    if (focusVerbMorphologyControl(currentCue, board)) {
      state.verbMorphologyFocusNextStep = false;
    }
  }

  const hint = $("#verbMorphologyHint");
  if (hint) hint.hidden = !viewModel.hint.used;
  setText(
    "#verbMorphologyHintTitle",
    viewModel.hint.solutionRevealed ? "Shown pilot solution" : "Participant and context cue"
  );
  setText(
    "#verbMorphologyHintCopy",
    viewModel.hint.solutionRevealed
      ? (presentation.solutionExplanationEn || hintText)
      : hintText
  );

  const hintButton = $("#verbMorphologyHintButton");
  if (hintButton) {
    hintButton.disabled = viewModel.hint.actionDisabled;
    hintButton.textContent = viewModel.hint.used ? "Context hint shown" : "Context hint";
    if (state.verbMorphologyFocusHintAction
        && !hintButton.disabled
        && focusVerbMorphologyControl(hintButton, board)) {
      state.verbMorphologyFocusHintAction = false;
    }
  }
  const revealButton = $("#verbMorphologyRevealButton");
  if (revealButton) {
    revealButton.disabled = viewModel.completed || verbGuidedInteractionLocked();
    revealButton.textContent = viewModel.hint.solutionRevealed ? "Form revealed" : "Reveal form";
    if (state.verbMorphologyFocusRevealAction
        && !revealButton.disabled
        && focusVerbMorphologyControl(revealButton, board)) {
      state.verbMorphologyFocusRevealAction = false;
    }
  }
  if (nextButton) {
    const recoveryPending = state.verbGuidedStatus === "recovery-pending";
    const awaitingNext = state.verbGuidedStatus === "awaiting-next";
    const stepComplete = state.verbGuidedStatus === "step-complete";
    nextButton.hidden = !recoveryPending && !awaitingNext && !stepComplete;
    nextButton.disabled = state.verbProgressResetPending
      || state.verbGuidedEvidencePending
      || state.verbMorphologyAdvancePending;
    nextButton.textContent = recoveryPending
      ? (state.verbMorphologyProgress?.pendingEvidence ? "Retry saved match" : "Retry checkpoint")
      : "Continue matching";
  }
  const feedback = $("#verbMorphologyFeedback");
  if (feedback) {
    feedback.textContent = viewModel.status.message || "Match the highlighted English cue with its Czech form.";
    feedback.className = `verb-match-feedback${state.verbMorphologyAnnouncementKind
      ? ` is-${state.verbMorphologyAnnouncementKind}`
      : ""}`;
    if (state.verbMorphologyFocusNextAction
        && nextButton
        && !nextButton.hidden
        && !nextButton.disabled) {
      if (focusVerbMorphologyControl(nextButton, board)) {
        state.verbMorphologyFocusNextAction = false;
      }
    }
  }
}

function morphologyRefKey(reference) {
  return `${reference?.id || ""}@${reference?.revision || ""}`;
}

function morphologySettlement(kind, selection, correct, {
  hintState = state.verbMorphologyRoundState?.hintState
} = {}) {
  const current = state.verbMorphologyRoundState;
  const settlement = state.verbMorphologyAdapter.settle({
    taskRef: current.taskRef,
    itemRef: current.itemRef,
    kind,
    responseId: morphologyRefKey(selection),
    correct,
    hintState,
    requestedXp: 1
  });
  if (settlement.awardedXp !== 0 || settlement.xpSuppressed !== true) {
    throw new Error("Developer Guided morphology must suppress game XP.");
  }
  return settlement;
}

function morphologyRefFromButton(button, kind) {
  const id = kind === "cue"
    ? button?.dataset?.morphologyCueId
    : button?.dataset?.morphologyItemId;
  const revision = Number(kind === "cue"
    ? button?.dataset?.morphologyCueRevision
    : button?.dataset?.morphologyItemRevision);
  if (!id || !Number.isInteger(revision) || revision < 1) return null;
  return { id, revision };
}

function currentMorphologyCueSelected() {
  return sameEntityRef(
    state.verbMorphologySelectedCueRef,
    state.verbMorphologyRound?.cue?.cueRef
  );
}

async function submitVerbMorphologyPair() {
  const itemRef = state.verbMorphologySelectedItemRef;
  const cueRef = state.verbMorphologySelectedCueRef;
  if (!itemRef || !cueRef || verbGuidedInteractionLocked()) return;
  if (!currentMorphologyCueSelected()) {
    state.verbMorphologySelectedCueRef = null;
    setVerbMorphologyAnnouncement(
      "That English cue comes later. Match the highlighted cue first so the reviewed sequence stays meaningful.",
      "hint"
    );
    renderConjugationComet();
    return;
  }

  const pairEvaluation = verbMorphologyCore.evaluateMorphologyMatchPair(
    state.verbMorphologyMatchBoard,
    { itemRef, cueRef }
  );
  const roundEvaluation = verbMorphologyCore.evaluateMorphologySelection(
    state.verbMorphologyRound,
    { itemRef }
  );
  if (pairEvaluation.correct !== roundEvaluation.correct
      || !sameEntityRef(pairEvaluation.targetItemRef, state.verbMorphologyRound.targetItemRef)) {
    throw new Error("The visible conjugation pair does not match the active curriculum evidence task.");
  }

  state.verbMorphologyWrongItemRef = pairEvaluation.correct ? null : itemRef;
  state.verbMorphologyWrongCueRef = pairEvaluation.correct ? null : cueRef;
  const button = Array.from(document.querySelectorAll("button[data-morphology-item-id]"))
    .find((candidate) => sameEntityRef(morphologyRefFromButton(candidate, "item"), itemRef));
  if (!button) throw new Error("The selected Czech form is no longer visible on the match board.");
  await chooseVerbMorphologyForm({ target: button });
  state.verbMorphologySelectedItemRef = null;
  state.verbMorphologySelectedCueRef = null;
  renderConjugationComet();
}

async function selectVerbMorphologyItem(event) {
  const button = event.target.closest("button[data-morphology-item-id]");
  if (!button || button.disabled || verbGuidedInteractionLocked()) return;
  const itemRef = morphologyRefFromButton(button, "item");
  if (!itemRef) return;
  state.verbMorphologySelectedItemRef = itemRef;
  state.verbMorphologyWrongItemRef = null;
  state.verbMorphologyWrongCueRef = null;
  if (state.verbMorphologySelectedCueRef) {
    await submitVerbMorphologyPair();
    return;
  }
  setVerbMorphologyAnnouncement("Now select the highlighted English cue for this Czech form.", "");
  renderConjugationComet();
}

async function selectVerbMorphologyCue(event) {
  const button = event.target.closest("button[data-morphology-cue-id]");
  if (!button || button.disabled || verbGuidedInteractionLocked()) return;
  const cueRef = morphologyRefFromButton(button, "cue");
  if (!cueRef) return;
  if (!sameEntityRef(cueRef, state.verbMorphologyRound?.cue?.cueRef)) {
    state.verbMorphologySelectedCueRef = null;
    setVerbMorphologyAnnouncement(
      "That cue is visible for the whole paradigm, but it unlocks after the highlighted cue.",
      "hint"
    );
    renderConjugationComet();
    return;
  }
  state.verbMorphologySelectedCueRef = cueRef;
  state.verbMorphologyWrongItemRef = null;
  state.verbMorphologyWrongCueRef = null;
  if (state.verbMorphologySelectedItemRef) {
    await submitVerbMorphologyPair();
    return;
  }
  setVerbMorphologyAnnouncement("Now choose the Czech form that belongs with this English cue.", "");
  renderConjugationComet();
}

async function chooseVerbMorphologyForm(event) {
  const button = event.target.closest("button[data-morphology-item-id]");
  if (!button || button.disabled || verbGuidedInteractionLocked()) return;
  const transferFocus = Boolean($("#verbMorphologyBoard")?.contains(button));
  const selectedSurface = button.querySelector("[data-morphology-choice-surface]")?.textContent?.trim()
    || button.textContent.trim();
  const selection = {
    id: button.dataset.morphologyItemId,
    revision: Number(button.dataset.morphologyItemRevision)
  };
  const evaluation = verbMorphologyCore.evaluateMorphologySelection(
    state.verbMorphologyRound,
    { itemRef: selection }
  );
  const firstResponseWasRecorded = verbMorphologyFirstResponseRecorded();
  const support = verbMorphologySupportState();
  const supportAtFirstResponse = Boolean(support.hintsUsed || support.solutionRevealed);
  let nextRoundState;
  let completionKind = null;

  try {
    const settlementId = state.verbMorphologyRoundState.settlementId || morphologySettlement(
      "first-response",
      evaluation.selectedItemRef,
      evaluation.correct
    ).settlementId;
    if (evaluation.correct) {
      nextRoundState = serializeVerbMorphologyRoundState({
        selectedItemRef: evaluation.selectedItemRef,
        settlementId,
        completed: true
      });
    } else {
      const rejectedItemRefs = [
        ...state.verbMorphologyRoundState.rejectedItemRefs,
        evaluation.selectedItemRef
      ].filter((reference, index, rows) => (
        rows.findIndex((candidate) => morphologyRefKey(candidate) === morphologyRefKey(reference)) === index
      ));
      nextRoundState = serializeVerbMorphologyRoundState({
        selectedItemRef: evaluation.selectedItemRef,
        rejectedItemRefs,
        settlementId,
        completed: false
      });
    }
    if (evaluation.correct) {
      completionKind = firstResponseWasRecorded
        ? "corrective-correct"
        : "correct-first-response";
    }
  } catch (error) {
    await abortVerbGuidedLifecycle();
    state.verbMorphologyResume = true;
    state.verbGuidedStatus = "failed";
    state.verbGuidedError = error?.message || String(error);
    setVerbMorphologyAnnouncement(
      firstResponseWasRecorded
        ? "The earlier first response remains recorded, but this corrective result could not be prepared."
        : "Your answer was not recorded because the local result could not be prepared.",
      "wrong"
    );
    renderConjugationComet();
    return;
  }

  state.verbGuidedEvidencePending = true;
  renderConjugationComet();
  let journalSaved = false;
  try {
    if (!firstResponseWasRecorded) {
      const request = morphologyEvidenceRequest({ score: evaluation.score });
      const pendingProgress = {
        ...state.verbMorphologyProgress,
        pendingEvidence: {
          request,
          round: nextRoundState,
          completionKind
        }
      };
      await saveVerbMorphologyProgress(pendingProgress);
      journalSaved = true;
      await recordVerbMorphologyEvidence(request);
      state.verbGuidedSupportAtFirstResponse = supportAtFirstResponse;
      const completedEvidenceProgress = {
        ...pendingProgress,
        round: nextRoundState,
        evidence: {
          recorded: true,
          score: request.score,
          solutionRevealed: false,
          hintsUsed: request.hintsUsed,
          occurredAt: request.occurredAt
        },
        pendingEvidence: null,
        terminalCompletionKind: completionKind,
        pendingCompletionKind: null
      };
      await saveVerbMorphologyProgress(completedEvidenceProgress);
    } else {
      await saveVerbMorphologyProgress({
        ...state.verbMorphologyProgress,
        round: nextRoundState,
        terminalCompletionKind: completionKind,
        pendingCompletionKind: null
      });
    }
    state.verbMorphologyRoundState = nextRoundState;
    if (evaluation.correct) {
      state.verbGuidedStatus = "awaiting-next";
      state.verbMorphologyFocusNextAction = transferFocus;
      setVerbMorphologyAnnouncement(
        firstResponseWasRecorded
          ? `Correct now: ${selectedSurface}. The earlier first response remains recorded; continuing to the next match.`
          : supportAtFirstResponse
            ? `Correct: ${selectedSurface}. This is supported form comprehension, not independent evidence; continuing.`
            : `Correct: ${selectedSurface}. This records form comprehension only; continuing to the next match.`,
        "correct"
      );
    } else {
      state.verbGuidedStatus = "ready";
      state.verbMorphologyFocusNextStep = transferFocus;
      setVerbMorphologyAnnouncement(
        `Not quite. Keep the same English situation and try another ${course.targetLanguage?.label || "target-language"} form.`,
        "wrong"
      );
    }
  } catch (error) {
    state.verbGuidedError = error?.message || String(error);
    if (!(await failVerbMorphologyOnRevisionConflict(error))) {
      state.verbGuidedStatus = state.verbMorphologyProgress?.pendingEvidence
        || state.verbMorphologyProgress?.pendingCompletionKind
        ? "recovery-pending"
        : "ready";
      state.verbMorphologyFocusNextAction = transferFocus
        && state.verbGuidedStatus === "recovery-pending";
      state.verbMorphologyFocusNextStep = transferFocus
        && state.verbGuidedStatus === "ready";
      setVerbMorphologyAnnouncement(
        journalSaved
          ? "Your answer is saved locally. Retry the durable curriculum checkpoint; no second answer will be created."
          : firstResponseWasRecorded
            ? "The earlier first response remains recorded, but this corrective result could not be saved."
            : "Your answer was not recorded because its local recovery journal could not be saved.",
        "wrong"
      );
    }
  } finally {
    state.verbGuidedEvidencePending = false;
    renderConjugationComet();
    if (state.verbGuidedStatus === "awaiting-next") scheduleVerbMorphologyAutoAdvance();
  }
}

async function showVerbMorphologyHint() {
  const current = state.verbMorphologyRoundState;
  if (!current
      || current.completed
      || verbGuidedInteractionLocked()
      || current.hintState !== verbExerciseFamilyCore.VERB_HINT_STATES.AVAILABLE) return;
  const transferFocus = Boolean(
    document.activeElement && $("#verbMorphologyBoard")?.contains(document.activeElement)
  );
  const firstResponseRecorded = verbMorphologyFirstResponseRecorded();
  state.verbGuidedEvidencePending = true;
  renderConjugationComet();
  try {
    const nextRoundState = serializeVerbMorphologyRoundState({
      hintState: verbExerciseFamilyCore.advanceVerbHintState(current.hintState, "show-hint")
    });
    await saveVerbMorphologyProgress({
      ...state.verbMorphologyProgress,
      round: nextRoundState
    });
    if (!firstResponseRecorded && state.verbGuidedLifecycle && !state.verbMorphologyResume) {
      state.verbGuidedLifecycle.markHint("participant-and-context-cue");
    }
    state.verbMorphologyFocusNextStep = transferFocus;
    setVerbMorphologyAnnouncement(
      firstResponseRecorded
        ? "Context support shown for corrective review; the recorded first response is unchanged."
        : "Context support shown. The next answer will be classified as supported practice.",
      "hint"
    );
  } catch (error) {
    state.verbGuidedError = error?.message || String(error);
    if (!(await failVerbMorphologyOnRevisionConflict(error))) {
      state.verbMorphologyFocusHintAction = transferFocus;
      setVerbMorphologyAnnouncement("The context hint stayed hidden because support could not be recorded.", "wrong");
    }
  } finally {
    state.verbGuidedEvidencePending = false;
    renderConjugationComet();
  }
}

async function revealVerbMorphologySolution() {
  const current = state.verbMorphologyRoundState;
  if (!current || current.completed || verbGuidedInteractionLocked()) return;
  const transferFocus = Boolean(
    document.activeElement && $("#verbMorphologyBoard")?.contains(document.activeElement)
  );
  const correctiveReview = verbMorphologyFirstResponseRecorded();
  let nextRoundState;
  try {
    const nextHintState = verbExerciseFamilyCore.advanceVerbHintState(
      current.hintState,
      "reveal-solution"
    );
    const settlementId = morphologySettlement(
      "solution-reveal",
      state.verbMorphologyRound.targetItemRef,
      false,
      { hintState: nextHintState }
    ).settlementId;
    nextRoundState = serializeVerbMorphologyRoundState({
      hintState: nextHintState,
      settlementId,
      completed: true
    });
  } catch (error) {
    await abortVerbGuidedLifecycle();
    state.verbMorphologyResume = true;
    state.verbGuidedStatus = "failed";
    state.verbGuidedError = error?.message || String(error);
    setVerbMorphologyAnnouncement(
      correctiveReview
        ? "The earlier first response remains recorded, but this corrective review could not be prepared."
        : "The solution was not recorded because the local result could not be prepared.",
      "wrong"
    );
    renderConjugationComet();
    return;
  }
  state.verbGuidedEvidencePending = true;
  renderConjugationComet();
  let journalSaved = false;
  try {
    if (!correctiveReview) {
      const request = morphologyEvidenceRequest({ score: 0, solutionRevealed: true });
      const pendingProgress = {
        ...state.verbMorphologyProgress,
        pendingEvidence: {
          request,
          round: nextRoundState,
          completionKind: "solution-review"
        }
      };
      await saveVerbMorphologyProgress(pendingProgress);
      journalSaved = true;
      await recordVerbMorphologyEvidence(request);
      state.verbGuidedSupportAtFirstResponse = true;
      await saveVerbMorphologyProgress({
        ...pendingProgress,
        round: nextRoundState,
        evidence: {
          recorded: true,
          score: 0,
          solutionRevealed: true,
          hintsUsed: request.hintsUsed,
          occurredAt: request.occurredAt
        },
        pendingEvidence: null,
        terminalCompletionKind: "solution-review",
        pendingCompletionKind: null
      });
    } else {
      await saveVerbMorphologyProgress({
        ...state.verbMorphologyProgress,
        round: nextRoundState,
        terminalCompletionKind: "solution-review",
        pendingCompletionKind: null
      });
    }
    state.verbMorphologyRoundState = nextRoundState;
    state.verbGuidedStatus = "awaiting-next";
    state.verbMorphologyFocusNextAction = transferFocus;
    setVerbMorphologyAnnouncement(
      correctiveReview
        ? "Pilot solution shown. The earlier first response remains recorded; continuing to the next match."
        : "Pilot solution shown. This is supported comprehension, not independent mastery; continuing.",
      "hint"
    );
  } catch (error) {
    state.verbGuidedError = error?.message || String(error);
    if (!(await failVerbMorphologyOnRevisionConflict(error))) {
      state.verbGuidedStatus = state.verbMorphologyProgress?.pendingEvidence
        || state.verbMorphologyProgress?.pendingCompletionKind
        ? "recovery-pending"
        : "ready";
      state.verbMorphologyFocusNextAction = transferFocus
        && state.verbGuidedStatus === "recovery-pending";
      state.verbMorphologyFocusRevealAction = transferFocus
        && state.verbGuidedStatus === "ready";
      setVerbMorphologyAnnouncement(
        journalSaved
          ? "The reveal is saved locally. Retry its durable curriculum checkpoint; the answer remains protected until then."
          : correctiveReview
            ? "The earlier first response remains recorded, but this corrective review could not be saved."
            : "The solution stayed hidden because its local recovery journal could not be saved.",
        "wrong"
      );
    }
  } finally {
    state.verbGuidedEvidencePending = false;
    renderConjugationComet();
    if (state.verbGuidedStatus === "awaiting-next") scheduleVerbMorphologyAutoAdvance();
  }
}

function clearVerbMorphologyAutoAdvance() {
  if (!state.verbMorphologyAutoAdvanceTimer) return;
  window.clearTimeout(state.verbMorphologyAutoAdvanceTimer);
  state.verbMorphologyAutoAdvanceTimer = null;
}

function scheduleVerbMorphologyAutoAdvance() {
  clearVerbMorphologyAutoAdvance();
  if (state.verbGuidedStatus !== "awaiting-next" || state.verbProgressResetPending) return;
  state.verbMorphologyAutoAdvanceTimer = window.setTimeout(() => {
    state.verbMorphologyAutoAdvanceTimer = null;
    void trackVerbGuidedOperation(advanceVerbMorphologySequence);
  }, 720);
}

async function advanceVerbMorphologySequence() {
  clearVerbMorphologyAutoAdvance();
  if (state.verbProgressResetPending
      || state.verbMorphologyAdvancePending
      || state.verbGuidedEvidencePending) return;
  if (!["recovery-pending", "awaiting-next", "step-complete"].includes(state.verbGuidedStatus)) return;
  const retainActionFocus = Boolean(
    document.activeElement && $("#verbMorphologyBoard")?.contains(document.activeElement)
  );
  state.verbMorphologyAdvancePending = true;
  renderConjugationComet();
  try {
    if (state.verbGuidedStatus === "recovery-pending") {
      await recoverVerbMorphologyProgress();
      if (state.verbGuidedStatus === "recovery-pending") return;
      if (state.verbGuidedStatus === "ready") {
        state.verbMorphologyFocusNextStep = retainActionFocus;
      } else if (state.verbGuidedStatus === "awaiting-next") {
        state.verbMorphologyFocusNextAction = retainActionFocus;
      }
    } else if (state.verbGuidedStatus === "awaiting-next") {
      const completionKind = state.verbMorphologyProgress?.terminalCompletionKind;
      if (!completionKind) throw new Error("The completed form is missing its pinned pilot completion kind.");
      await saveVerbMorphologyProgress({
        ...state.verbMorphologyProgress,
        pendingCompletionKind: completionKind
      });
      await completeVerbMorphologySequenceStep(completionKind);
    }
    if (state.verbMorphologySequenceComplete) {
      showCompletedVerbMorphologySequence({ focus: true });
      return;
    }
    if (state.verbGuidedStatus !== "step-complete") return;
    state.verbMorphologyFocusNextStep = true;
    await prepareVerbMorphologyGuidedStep(
      window.CaatuuCurriculum,
      conjugationCometConfiguration()
    );
  } catch (error) {
    state.verbGuidedError = error?.message || String(error);
    console.error("Conjugation Comet sequence advance failed", error);
    if (!(await failVerbMorphologyOnRevisionConflict(error))) {
      state.verbGuidedStatus = state.verbMorphologyProgress?.pendingCompletionKind
        || state.verbMorphologyProgress?.pendingEvidence
        ? "recovery-pending"
        : state.verbMorphologyProgress?.terminalCompletionKind
          ? "awaiting-next"
          : "failed";
      state.verbMorphologyFocusNextAction = retainActionFocus
        && ["recovery-pending", "awaiting-next"].includes(state.verbGuidedStatus);
      setVerbMorphologyAnnouncement(
        state.verbGuidedStatus === "recovery-pending"
          ? "Your completed form is saved. Retry the sequence checkpoint; it will not create another answer."
          : "The next pilot form could not be prepared. The completed step remains recorded.",
        "wrong"
      );
    }
  } finally {
    state.verbMorphologyAdvancePending = false;
    renderConjugationComet();
  }
}

function renderConjugationComet() {
  const panel = $("#conjugationCometPanel");
  if (!panel) return;
  const unavailable = $("#conjugationCometUnavailable");
  const meaningBoard = $("#verbMeaningGateBoard");
  const morphologyBoard = $("#verbMorphologyBoard");
  const banner = $("#verbGuidedStatus");
  const capabilityUnavailable = state.verbGuidedStatus === "unavailable";
  if (unavailable) unavailable.hidden = !capabilityUnavailable;
  if (capabilityUnavailable) {
    for (const board of [meaningBoard, morphologyBoard]) {
      if (!board) continue;
      board.hidden = true;
      board.setAttribute("aria-busy", "false");
    }
    if (banner) banner.hidden = true;
    return;
  }

  const meaningPhase = state.verbGuidedStatus !== "failed"
    && Boolean(state.verbMeaningPlan)
    && (!state.verbMeaningMatched || state.verbMeaningTransitionPending);
  if (meaningBoard) meaningBoard.hidden = !meaningPhase;
  if (morphologyBoard) morphologyBoard.hidden = meaningPhase;
  if (meaningPhase) {
    renderVerbGuidedStatus();
    renderVerbMeaningGate();
    return;
  }

  renderVerbMorphology();
  if (state.verbGuidedMode
      && state.verbGuidedStatus === "pending"
      && !panel.hidden
      && document.visibilityState !== "hidden") {
    void activateVerbGuidedOpportunity();
  }
}

async function prepareConjugationCometProgressReset() {
  if (!state.verbGuidedMode
      && !state.verbGuidedLifecycle
      && !state.verbGuidedActivationPromise) return;
  state.verbProgressResetPending = true;
  state.verbGuidedActivationEpoch += 1;
  state.verbMorphologyGeneration += 1;
  clearVerbMorphologyAutoAdvance();
  if (state.verbMeaningTransitionTimer) {
    window.clearTimeout(state.verbMeaningTransitionTimer);
    state.verbMeaningTransitionTimer = null;
  }
  renderConjugationComet();

  const lifecycle = state.verbGuidedLifecycle;
  const aborting = lifecycle?.abort?.() || Promise.resolve();
  const pending = [
    state.verbGuidedActivationPromise,
    state.verbMorphologyPreparePromise,
    ...state.verbGuidedOperations
  ].filter(Boolean);
  if (pending.length) await Promise.allSettled(pending);
  await aborting;
  if (state.verbGuidedLifecycle === lifecycle) state.verbGuidedLifecycle = null;
  state.verbGuidedActivationPromise = null;
  state.verbGuidedEvidencePending = false;
  state.verbMorphologyAdvancePending = false;
}

function resetConjugationCometRuntimeState() {
  clearVerbMorphologyAutoAdvance();
  if (state.verbMeaningTransitionTimer) window.clearTimeout(state.verbMeaningTransitionTimer);
  state.verbGuidedActivationEpoch += 1;
  state.verbMorphologyGeneration += 1;
  state.verbGuidedActivationPromise = null;
  state.verbGuidedLifecycle = null;
  state.verbGuidedMode = false;
  state.verbGuidedStatus = "loading";
  state.verbGuidedError = "";
  state.verbGuidedResolution = null;
  state.verbGuidedEvidencePending = false;
  state.verbGuidedSupportAtFirstResponse = false;
  state.verbMeaningPlan = null;
  state.verbMeaningResolution = null;
  state.verbMeaningSelectedTarget = false;
  state.verbMeaningSelectedEnglishId = "";
  state.verbMeaningWrongEnglishId = "";
  state.verbMeaningMatched = false;
  state.verbMeaningTransitionPending = false;
  state.verbMeaningTransitionTimer = null;
  state.verbMeaningAnnouncement = "Select the Czech verb to begin.";
  state.verbMeaningAnnouncementKind = "";
  state.verbMorphologyCatalog = null;
  state.verbMorphologyFamily = null;
  state.verbMorphologyMatchBoard = null;
  state.verbMorphologySequence = null;
  state.verbMorphologySequencePreview = null;
  state.verbMorphologySequenceCueRefs = [];
  state.verbMorphologySequenceComplete = false;
  state.verbMorphologyRound = null;
  state.verbMorphologyRoundState = null;
  state.verbMorphologyTask = null;
  state.verbMorphologyProgress = null;
  state.verbMorphologyProgressRevision = 0;
  state.verbMorphologyResume = false;
  state.verbMorphologyAdvancePending = false;
  state.verbMorphologyFocusNextStep = false;
  state.verbMorphologyFocusNextAction = false;
  state.verbMorphologyFocusHintAction = false;
  state.verbMorphologyFocusRevealAction = false;
  state.verbMorphologySelectedItemRef = null;
  state.verbMorphologySelectedCueRef = null;
  state.verbMorphologyWrongItemRef = null;
  state.verbMorphologyWrongCueRef = null;
  state.verbMorphologyAutoAdvanceTimer = null;
}

function restartConjugationCometRuntimeAfterReset({ resetCompleted = true } = {}) {
  if (resetCompleted) clearVerbMeaningGate();
  state.verbProgressResetPending = false;
  resetConjugationCometRuntimeState();
  setVerbMorphologyAnnouncement(
    resetCompleted
      ? "Preparing the first pinned Conjugation Comet form again."
      : "The restart was cancelled. Rechecking the existing Guided task.",
    resetCompleted ? "" : "wrong"
  );
  renderConjugationComet();
  void initializeConjugationCometRuntime().catch((error) => {
    state.verbGuidedStatus = "failed";
    state.verbGuidedError = error?.message || String(error);
    setVerbMorphologyAnnouncement(
      resetCompleted
        ? "Course progress was cleared, but the first Comet task could not be prepared."
        : "The existing Comet task could not be restored after the cancelled restart.",
      "wrong"
    );
    renderConjugationComet();
  });
}

function bindConjugationCometControls() {
  $("#verbMeaningTargetColumn")?.addEventListener("click", selectVerbMeaningTarget);
  $("#verbMeaningEnglishColumn")?.addEventListener("click", selectVerbMeaningEnglish);
  $("#verbMorphologyFormsColumn")?.addEventListener("click", (event) => {
    if (!event.target.closest("button[data-morphology-item-id]")) return;
    void trackVerbGuidedOperation(() => selectVerbMorphologyItem(event));
  });
  $("#verbMorphologyCuesColumn")?.addEventListener("click", (event) => {
    if (!event.target.closest("button[data-morphology-cue-id]")) return;
    void trackVerbGuidedOperation(() => selectVerbMorphologyCue(event));
  });
  $("#verbMorphologyHintButton")?.addEventListener("click", () => {
    void trackVerbGuidedOperation(showVerbMorphologyHint);
  });
  $("#verbMorphologyRevealButton")?.addEventListener("click", () => {
    void trackVerbGuidedOperation(revealVerbMorphologySolution);
  });
  $("#verbMorphologyNextButton")?.addEventListener("click", () => {
    void trackVerbGuidedOperation(advanceVerbMorphologySequence);
  });
  window.CaatuuLearning?.registerProgressResetPreparation?.(
    prepareConjugationCometProgressReset
  );
  window.addEventListener("caatuu:progress-reset-cancelled", () => {
    if (state.verbProgressResetPending) {
      restartConjugationCometRuntimeAfterReset({ resetCompleted: false });
    }
  });
  window.addEventListener("caatuu:learning-change", (event) => {
    if (event.detail?.reason === "progress-reset") {
      restartConjugationCometRuntimeAfterReset();
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") deferVerbGuidedActivation();
    else renderConjugationComet();
  });
}

async function initializeConjugationCometRuntime() {
  state.verbGuidedRequested = true;
  state.verbGuidedStatus = "loading";
  state.verbGuidedError = "";
  if (!conjugationCometAvailable()) {
    state.verbGuidedStatus = "unavailable";
    state.verbGuidedError = conjugationCometConfiguration()
      ? "This teacher-review preview is available only through the explicit local Guided gate."
      : "This course has not declared reviewed Conjugation Comet support.";
    setVerbMorphologyAnnouncement(state.verbGuidedError, "wrong");
    renderConjugationComet();
    return;
  }

  try {
    await loadConjugationCometRuntime();
    const configuration = conjugationCometConfiguration();
    const curriculum = window.CaatuuCurriculum;
    if (!configuration || !curriculum) {
      throw new Error("Conjugation Comet curriculum configuration is unavailable.");
    }
    await curriculum.ready();
    if (configuration.developerOnly && !curriculum.developerPilotModeEnabled()) {
      throw new Error("Developer Guided mode is not enabled for this local course profile.");
    }
    await prepareVerbMorphologyGuidedStep(curriculum, configuration);
  } catch (error) {
    await abortVerbGuidedLifecycle();
    state.verbMorphologyResume = true;
    state.verbGuidedStatus = "failed";
    state.verbGuidedError = error?.message || String(error);
    setVerbMorphologyAnnouncement(
      "The pinned Conjugation Comet pilot could not be prepared, so this round is locked.",
      "wrong"
    );
    console.error("Conjugation Comet failed closed", error);
  }
  renderConjugationComet();
}

function registerServiceWorker() {
  window.CaatuuRuntime?.registerServiceWorker?.().catch(() => {});
}

function initConjugationComet() {
  bindConjugationCometControls();
  renderConjugationComet();
  registerServiceWorker();
  void initializeConjugationCometRuntime();
}

initConjugationComet();
