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

/**
 * Own one immutable Guided learning opportunity.
 *
 * Activation deliberately records the encounter before issuing the retrieval
 * task. This preserves the real learning sequence used by repair-spacing and
 * delayed-retrieval rules. Games should present the bound content disabled,
 * await activate(), and only then accept an answer.
 */
export function createGuidedOpportunityLifecycle({
  curriculum,
  resolution,
  capabilityId = "independent-retrieval",
  targetSkillId
} = {}) {
  requiredMethod(curriculum, "claimDeveloperPilot");

  const binding = resolution?.binding;
  const activityId = normalizedId(binding?.activityId);
  const stableContentId = normalizedId(binding?.contentRef?.contentId);
  const bindingId = normalizedId(binding?.id);
  const skillId = normalizedId(targetSkillId || binding?.targetSkillRefs?.[0]?.id);
  if (!bindingId || !activityId || !stableContentId || !skillId) {
    throw guidedError(
      "GUIDED_OPPORTUNITY_BINDING_INVALID",
      "Guided opportunity lifecycle requires a resolved binding and target skill."
    );
  }

  let phase = "pending";
  let opportunity = null;
  let activationPromise = null;
  let responsePromise = null;
  let failure = null;
  let releasePilotLease = null;
  const markedHintKeys = new Set();

  function opportunityState() {
    return opportunity?.state?.() || null;
  }

  function state() {
    const active = opportunityState();
    return Object.freeze({
      phase,
      activityId,
      stableContentId,
      bindingId,
      targetSkillId: skillId,
      taskId: active?.taskId || "",
      taskFingerprint: active?.taskFingerprint || "",
      hintsUsed: Number(active?.hintsUsed || 0),
      solutionRevealed: Boolean(active?.solutionRevealed),
      firstResponseRecorded: Boolean(active?.firstResponseRecorded),
      failure: failure ? Object.freeze({
        code: failure.code || "GUIDED_OPPORTUNITY_FAILED",
        message: failure.message || String(failure)
      }) : null
    });
  }

  function requireActive(action) {
    if (!opportunity || !["ready", "responding", "closed"].includes(phase)) {
      throw guidedError(
        "GUIDED_OPPORTUNITY_NOT_ACTIVE",
        `Cannot ${action} before the Guided opportunity is active.`
      );
    }
  }

  async function activate({ requirePresented } = {}) {
    if (opportunity) return state();
    if (failure) throw failure;
    if (activationPromise) return activationPromise;
    phase = "activating";
    const activation = (async () => {
      const claim = await curriculum.claimDeveloperPilot(bindingId, {
        capabilityId,
        targetSkillId: skillId,
        requirePresented
      });
      if (claim?.status === "deferred") {
        phase = "pending";
        return state();
      }
      if (claim?.claimed !== true || claim?.status !== "claimed") {
        throw guidedError(
          "GUIDED_OPPORTUNITY_REENTRY_BLOCKED",
          "This one-shot developer Guided pilot was already claimed or is active elsewhere."
        );
      }
      opportunity = claim.opportunity;
      releasePilotLease = typeof claim.release === "function" ? claim.release : null;
      for (const method of ["state", "markHint", "markSolutionRevealed", "recordFirstResponse", "recordSolutionReveal"]) {
        requiredMethod(opportunity, method);
      }
      phase = "ready";
      return state();
    })();
    activationPromise = activation.catch(async (cause) => {
      if (releasePilotLease) await releasePilotLease();
      releasePilotLease = null;
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
        if (releasePilotLease) await releasePilotLease();
        releasePilotLease = null;
        phase = "closed";
        return Object.freeze({ recorded: true, result, state: state() });
      })
      .catch(async (cause) => {
        if (releasePilotLease) await releasePilotLease();
        releasePilotLease = null;
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
    if (phase === "responding" && responsePromise) await responsePromise;
    const wasClosed = Boolean(opportunityState()?.firstResponseRecorded);
    try {
      const result = await opportunity.recordSolutionReveal({ occurredAt });
      if (releasePilotLease) await releasePilotLease();
      releasePilotLease = null;
      phase = "closed";
      return Object.freeze({ recorded: !wasClosed, result, state: state() });
    } catch (cause) {
      if (releasePilotLease) await releasePilotLease();
      releasePilotLease = null;
      failure = cause instanceof Error
        ? cause
        : guidedError("GUIDED_OPPORTUNITY_REVEAL_FAILED", String(cause));
      phase = "failed";
      throw failure;
    }
  }

  return Object.freeze({
    activate,
    markHint,
    markSolutionRevealed,
    recordFirstResponse,
    recordSolutionReveal,
    state
  });
}
