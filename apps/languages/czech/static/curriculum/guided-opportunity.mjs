function guidedError(code, message, cause = null) {
  const error = new Error(message);
  error.name = "GuidedOpportunityError";
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}

function requiredMethod(owner, name) {
  if (typeof owner?.[name] !== "function") {
    throw guidedError(
      "GUIDED_OPPORTUNITY_API_INVALID",
      `Guided opportunity lifecycle requires ${name}().`
    );
  }
}

function normalizedId(value) {
  return String(value || "").trim();
}

function normalizeSequenceConfiguration(value, bindingId) {
  if (value == null) return null;
  const orderedBindingIds = Array.from(value?.orderedBindingIds || [], normalizedId);
  const expectedStep = value?.expectedStep;
  if (orderedBindingIds.length < 2
      || new Set(orderedBindingIds).size !== orderedBindingIds.length
      || orderedBindingIds.some((id) => !id)
      || !expectedStep
      || normalizedId(expectedStep.bindingId) !== bindingId
      || !Number.isInteger(expectedStep.stepIndex)
      || expectedStep.stepIndex < 0
      || expectedStep.stepIndex >= orderedBindingIds.length
      || orderedBindingIds[expectedStep.stepIndex] !== bindingId
      || !normalizedId(expectedStep.sequenceFingerprint)) {
    throw guidedError(
      "GUIDED_OPPORTUNITY_SEQUENCE_INVALID",
      "Guided sequence activation requires at least two unique ordered bindings and an exact expected step."
    );
  }
  return Object.freeze({
    orderedBindingIds: Object.freeze(orderedBindingIds),
    expectedStep: Object.freeze({
      bindingId,
      stepIndex: expectedStep.stepIndex,
      sequenceFingerprint: normalizedId(expectedStep.sequenceFingerprint)
    })
  });
}

/**
 * Own one immutable Guided learning opportunity.
 *
 * Activation deliberately records the encounter before issuing the assessed
 * task. This preserves the real learning sequence used by stage and repair
 * rules. Games should present the bound content disabled, await activate(),
 * and only then accept an answer.
 */
export function createGuidedOpportunityLifecycle({
  curriculum,
  resolution,
  capabilityId,
  targetSkillId,
  sequence
} = {}) {
  requiredMethod(curriculum, "claimDeveloperPilot");

  const binding = resolution?.binding;
  const activityId = normalizedId(binding?.activityId);
  const stableContentId = normalizedId(binding?.contentRef?.contentId);
  const bindingId = normalizedId(binding?.id);
  const skillId = normalizedId(targetSkillId || binding?.targetSkillRefs?.[0]?.id);
  const assessedCapabilityId = normalizedId(capabilityId);
  if (!bindingId || !activityId || !stableContentId || !skillId || !assessedCapabilityId) {
    throw guidedError(
      "GUIDED_OPPORTUNITY_BINDING_INVALID",
      "Guided opportunity lifecycle requires a resolved binding, target skill, and assessed capability."
    );
  }
  const sequenceConfiguration = normalizeSequenceConfiguration(sequence, bindingId);
  if (sequenceConfiguration) requiredMethod(curriculum, "claimDeveloperPilotSequence");

  let phase = "pending";
  let opportunity = null;
  let activationPromise = null;
  let responsePromise = null;
  let revealPromise = null;
  let completionPromise = null;
  let abortPromise = null;
  let aborted = false;
  let failure = null;
  let releasePilotLease = null;
  let completeClaimedSequenceStep = null;
  let sequenceState = null;
  let sequencePreview = null;
  let sequenceCompletion = null;
  let claimedTask = null;
  const markedHintKeys = new Set();

  function opportunityState() {
    return opportunity?.state?.() || null;
  }

  function abortedError(action) {
    return guidedError(
      "GUIDED_OPPORTUNITY_ABORTED",
      `Cannot ${action}; this Guided opportunity lifecycle was aborted.`
    );
  }

  function requireNotAborted(action) {
    if (aborted) throw abortedError(action);
  }

  function state() {
    const active = opportunityState();
    return Object.freeze({
      phase,
      activityId,
      stableContentId,
      bindingId,
      targetSkillId: skillId,
      capabilityId: assessedCapabilityId,
      taskId: active?.taskId || "",
      taskFingerprint: active?.taskFingerprint || "",
      task: claimedTask,
      hintsUsed: Number(active?.hintsUsed || 0),
      solutionRevealed: Boolean(active?.solutionRevealed),
      firstResponseRecorded: Boolean(active?.firstResponseRecorded),
      sequence: sequenceState ? Object.freeze({ ...sequenceState }) : null,
      sequencePreview: sequencePreview ? Object.freeze({ ...sequencePreview }) : null,
      sequenceCompletion: sequenceCompletion ? Object.freeze({ ...sequenceCompletion }) : null,
      aborted,
      failure: failure ? Object.freeze({
        code: failure.code || "GUIDED_OPPORTUNITY_FAILED",
        message: failure.message || String(failure)
      }) : null
    });
  }

  function requireActive(action) {
    requireNotAborted(action);
    if (!opportunity || !["ready", "responding", "closed"].includes(phase)) {
      throw guidedError(
        "GUIDED_OPPORTUNITY_NOT_ACTIVE",
        `Cannot ${action} before the Guided opportunity is active.`
      );
    }
  }

  async function activate({ requirePresented } = {}) {
    requireNotAborted("activate");
    if (opportunity) return state();
    if (failure) throw failure;
    if (activationPromise) return activationPromise;
    phase = "activating";
    const activation = Promise.resolve().then(async () => {
      requireNotAborted("activate");
      const claimOptions = {
        capabilityId: assessedCapabilityId,
        targetSkillId: skillId,
        requirePresented
      };
      if (sequenceConfiguration) claimOptions.expectedStep = sequenceConfiguration.expectedStep;
      const claim = sequenceConfiguration
        ? await curriculum.claimDeveloperPilotSequence(
            sequenceConfiguration.orderedBindingIds,
            claimOptions
          )
        : await curriculum.claimDeveloperPilot(bindingId, claimOptions);
      if (claim?.claimed === true && claim?.status === "claimed") {
        releasePilotLease = typeof claim.release === "function" ? claim.release : null;
      }
      requireNotAborted("activate");
      sequenceState = claim?.sequence || sequenceState;
      sequencePreview = claim?.preview || null;
      if (claim?.status === "deferred") {
        phase = "pending";
        return state();
      }
      if (sequenceConfiguration
          && claim?.status === "complete"
          && claim?.reason === "sequence-complete") {
        phase = "complete";
        return state();
      }
      if (claim?.claimed !== true || claim?.status !== "claimed") {
        throw guidedError(
          "GUIDED_OPPORTUNITY_REENTRY_BLOCKED",
          "This one-shot developer Guided pilot was already claimed or is active elsewhere."
        );
      }
      if (sequenceConfiguration && claim.bindingId !== bindingId) {
        throw guidedError(
          "GUIDED_OPPORTUNITY_SEQUENCE_STEP_MISMATCH",
          "The claimed Guided sequence step differs from the content currently presented."
        );
      }
      opportunity = claim.opportunity;
      claimedTask = opportunity?.task ? Object.freeze({ ...opportunity.task }) : null;
      completeClaimedSequenceStep = typeof claim.complete === "function" ? claim.complete : null;
      if (sequenceConfiguration && !completeClaimedSequenceStep) {
        throw guidedError(
          "GUIDED_OPPORTUNITY_SEQUENCE_API_INVALID",
          "A claimed Guided sequence step must expose a durable completion operation."
        );
      }
      for (const method of ["state", "markHint", "markSolutionRevealed", "recordFirstResponse", "recordSolutionReveal"]) {
        requiredMethod(opportunity, method);
      }
      phase = "ready";
      return state();
    });
    activationPromise = activation.catch(async (cause) => {
      if (releasePilotLease) await releasePilotLease();
      releasePilotLease = null;
      if (aborted) {
        phase = "aborted";
        throw cause?.code === "GUIDED_OPPORTUNITY_ABORTED"
          ? cause
          : abortedError("activate");
      }
      failure = cause instanceof Error
        ? cause
        : guidedError("GUIDED_OPPORTUNITY_ACTIVATION_FAILED", String(cause));
      phase = "failed";
      throw failure;
    });
    try {
      return await activationPromise;
    } finally {
      if (phase === "pending") activationPromise = null;
    }
  }

  function markHint(hintKey = "hint") {
    requireActive("record a hint");
    const key = normalizedId(hintKey) || "hint";
    if (opportunityState()?.firstResponseRecorded || markedHintKeys.has(key)) return state();
    opportunity.markHint();
    markedHintKeys.add(key);
    return state();
  }

  function markSolutionRevealed() {
    requireActive("mark a solution reveal");
    if (opportunityState()?.firstResponseRecorded) return state();
    opportunity.markSolutionRevealed();
    return state();
  }

  async function recordFirstResponse({ score, occurredAt } = {}) {
    requireActive("record a first response");
    if (opportunityState()?.firstResponseRecorded) {
      return Object.freeze({ recorded: false, result: null, state: state() });
    }
    if (responsePromise) return responsePromise;
    phase = "responding";
    responsePromise = Promise.resolve(opportunity.recordFirstResponse({ score, occurredAt }))
      .then(async (result) => {
        if (!sequenceConfiguration && releasePilotLease) await releasePilotLease();
        if (!sequenceConfiguration) releasePilotLease = null;
        if (aborted) throw abortedError("record a first response");
        phase = "closed";
        return Object.freeze({ recorded: true, result, state: state() });
      })
      .catch(async (cause) => {
        if (releasePilotLease) await releasePilotLease();
        releasePilotLease = null;
        if (aborted) {
          phase = "aborted";
          throw cause?.code === "GUIDED_OPPORTUNITY_ABORTED"
            ? cause
            : abortedError("record a first response");
        }
        failure = cause instanceof Error
          ? cause
          : guidedError("GUIDED_OPPORTUNITY_EVIDENCE_FAILED", String(cause));
        phase = "failed";
        throw failure;
      });
    return responsePromise;
  }

  async function recordSolutionReveal({ occurredAt } = {}) {
    requireActive("record a solution reveal");
    if (revealPromise) return revealPromise;
    revealPromise = (async () => {
      if (phase === "responding" && responsePromise) await responsePromise;
      requireNotAborted("record a solution reveal");
      const wasClosed = Boolean(opportunityState()?.firstResponseRecorded);
      try {
        const result = await opportunity.recordSolutionReveal({ occurredAt });
        if (!sequenceConfiguration && releasePilotLease) await releasePilotLease();
        if (!sequenceConfiguration) releasePilotLease = null;
        if (aborted) throw abortedError("record a solution reveal");
        phase = "closed";
        return Object.freeze({ recorded: !wasClosed, result, state: state() });
      } catch (cause) {
        if (releasePilotLease) await releasePilotLease();
        releasePilotLease = null;
        if (aborted) {
          phase = "aborted";
          throw cause?.code === "GUIDED_OPPORTUNITY_ABORTED"
            ? cause
            : abortedError("record a solution reveal");
        }
        failure = cause instanceof Error
          ? cause
          : guidedError("GUIDED_OPPORTUNITY_REVEAL_FAILED", String(cause));
        phase = "failed";
        throw failure;
      }
    })();
    return revealPromise;
  }

  async function completeSequenceStep(completionKind, { completedAt } = {}) {
    requireNotAborted("complete a Guided sequence step");
    if (!sequenceConfiguration) {
      throw guidedError(
        "GUIDED_OPPORTUNITY_SEQUENCE_UNAVAILABLE",
        "This Guided opportunity does not belong to an ordered sequence."
      );
    }
    requireActive("complete a Guided sequence step");
    if (typeof completeClaimedSequenceStep !== "function") {
      throw guidedError(
        "GUIDED_OPPORTUNITY_SEQUENCE_NOT_CLAIMED",
        "The Guided sequence step must be claimed before it can be completed."
      );
    }
    if (completionPromise) return completionPromise;
    completionPromise = (async () => {
      try {
        const result = await completeClaimedSequenceStep(completionKind, { completedAt });
        releasePilotLease = null;
        sequenceCompletion = result;
        if (aborted) throw abortedError("complete a Guided sequence step");
        phase = "complete";
        return Object.freeze({ result, state: state() });
      } catch (cause) {
        if (releasePilotLease) await releasePilotLease();
        releasePilotLease = null;
        if (aborted) {
          phase = "aborted";
          throw cause?.code === "GUIDED_OPPORTUNITY_ABORTED"
            ? cause
            : abortedError("complete a Guided sequence step");
        }
        failure = cause instanceof Error
          ? cause
          : guidedError("GUIDED_OPPORTUNITY_SEQUENCE_COMPLETION_FAILED", String(cause));
        phase = "failed";
        throw failure;
      }
    })();
    return completionPromise;
  }

  /**
   * Permanently invalidate this lifecycle and release its one-shot pilot lease.
   * The same promise is returned for every call so reset and teardown paths can
   * safely coordinate with work that was already in flight.
   */
  function abort() {
    if (abortPromise) return abortPromise;
    aborted = true;
    phase = "aborting";
    const pendingActivation = activationPromise;
    const pendingOperations = [responsePromise, revealPromise, completionPromise].filter(Boolean);
    abortPromise = (async () => {
      if (pendingActivation) {
        try {
          await pendingActivation;
        } catch {
          // Activation failure is superseded by the explicit lifecycle abort.
        }
      }
      if (pendingOperations.length) await Promise.allSettled(pendingOperations);
      const release = releasePilotLease;
      if (release) {
        await release();
        if (releasePilotLease === release) releasePilotLease = null;
      }
      completeClaimedSequenceStep = null;
      phase = "aborted";
      return state();
    })();
    return abortPromise;
  }

  return Object.freeze({
    activate,
    abort,
    markHint,
    markSolutionRevealed,
    recordFirstResponse,
    recordSolutionReveal,
    completeSequenceStep,
    state
  });
}
