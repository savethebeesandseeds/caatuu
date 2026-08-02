import assert from "node:assert/strict";
import test from "node:test";

import { createGuidedOpportunityLifecycle } from "../runtime/guided-opportunity.mjs";

function fixture({ failEvidence = false, claimStatus = "claimed" } = {}) {
  const calls = [];
  let hintsUsed = 0;
  let solutionRevealed = false;
  let firstResponseRecorded = false;
  const opportunity = {
    state() {
      return {
        taskId: "task-1",
        taskFingerprint: "sha256:task",
        hintsUsed,
        solutionRevealed,
        firstResponseRecorded
      };
    },
    markHint() {
      calls.push("opportunity:hint");
      hintsUsed += 1;
    },
    markSolutionRevealed() {
      calls.push("opportunity:mark-reveal");
      solutionRevealed = true;
    },
    async recordFirstResponse({ score }) {
      calls.push(`opportunity:response:${score}:revealed=${solutionRevealed}`);
      if (failEvidence) throw new Error("storage unavailable");
      firstResponseRecorded = true;
      return { score };
    },
    async recordSolutionReveal() {
      calls.push("opportunity:reveal");
      solutionRevealed = true;
      firstResponseRecorded = true;
      return { revealed: true };
    }
  };
  let leaseReleased = false;
  async function release() {
    if (leaseReleased) return;
    leaseReleased = true;
    calls.push("curriculum:release");
  }
  const curriculum = {
    async claimDeveloperPilot(bindingId, { capabilityId, targetSkillId, requirePresented }) {
      calls.push(`curriculum:claim:${bindingId}:${capabilityId}:${targetSkillId}`);
      if (typeof requirePresented === "function" && requirePresented() !== true) {
        return { status: "deferred", claimed: false };
      }
      if (claimStatus !== "claimed") return { status: claimStatus, claimed: false };
      return {
        status: "claimed",
        claimed: true,
        opportunity,
        release
      };
    }
  };
  const resolution = {
    binding: {
      id: "binding.word",
      activityId: "word-world",
      contentRef: { contentId: "ww-1" },
      targetSkillRefs: [{ id: "cs.skill.read" }]
    }
  };
  return { calls, curriculum, opportunity, release, resolution };
}

function sequenceConfiguration({
  orderedBindingIds = ["binding.word", "binding.word.2", "binding.word.3"],
  stepIndex = 0,
  expectedBindingId = "binding.word"
} = {}) {
  return {
    orderedBindingIds,
    expectedStep: {
      bindingId: expectedBindingId,
      stepIndex,
      sequenceFingerprint: "sha256:sequence"
    }
  };
}

test("a Guided lifecycle requires an explicit assessed capability", () => {
  const { curriculum, resolution } = fixture();
  assert.throws(
    () => createGuidedOpportunityLifecycle({ curriculum, resolution }),
    (error) => error.code === "GUIDED_OPPORTUNITY_BINDING_INVALID"
  );
});

test("Guided sequence configuration follows authored cardinality and exact step membership", () => {
  for (const sequence of [
    sequenceConfiguration({ orderedBindingIds: ["binding.word", "binding.word.2"] }),
    sequenceConfiguration({
      orderedBindingIds: ["binding.word.1", "binding.word.2", "binding.word.3", "binding.word"],
      stepIndex: 3
    })
  ]) {
    const { curriculum, resolution } = fixture();
    curriculum.claimDeveloperPilotSequence = async () => ({ status: "deferred", claimed: false });
    assert.doesNotThrow(() => createGuidedOpportunityLifecycle({
      curriculum,
      resolution,
      capabilityId: "independent-comprehension",
      sequence
    }));
  }

  for (const sequence of [
    sequenceConfiguration({ orderedBindingIds: ["binding.word"] }),
    sequenceConfiguration({
      orderedBindingIds: ["binding.word", "binding.word.2"],
      stepIndex: 2
    }),
    sequenceConfiguration({
      orderedBindingIds: ["binding.word.2", "binding.word"],
      stepIndex: 0
    })
  ]) {
    const { curriculum, resolution } = fixture();
    curriculum.claimDeveloperPilotSequence = async () => ({ status: "deferred", claimed: false });
    assert.throws(
      () => createGuidedOpportunityLifecycle({
        curriculum,
        resolution,
        capabilityId: "independent-comprehension",
        sequence
      }),
      (error) => error.code === "GUIDED_OPPORTUNITY_SEQUENCE_INVALID"
    );
  }
});

test("activation claims the durable encounter and assessed opportunity exactly once", async () => {
  const { calls, curriculum, resolution } = fixture();
  const lifecycle = createGuidedOpportunityLifecycle({ curriculum, resolution, capabilityId: "independent-comprehension" });
  await Promise.all([lifecycle.activate(), lifecycle.activate()]);
  assert.deepEqual(calls, [
    "curriculum:claim:binding.word:independent-comprehension:cs.skill.read"
  ]);
  assert.equal(lifecycle.state().phase, "ready");
  assert.equal(lifecycle.state().taskFingerprint, "sha256:task");
});

test("abort is idempotent before activation and permanently invalidates the lifecycle", async () => {
  const { calls, curriculum, resolution } = fixture();
  const lifecycle = createGuidedOpportunityLifecycle({
    curriculum,
    resolution,
    capabilityId: "independent-comprehension"
  });
  const first = await lifecycle.abort();
  const second = await lifecycle.abort();
  assert.strictEqual(second, first);
  assert.equal(first.phase, "aborted");
  assert.equal(first.aborted, true);
  assert.deepEqual(calls, []);
  await assert.rejects(
    () => lifecycle.activate(),
    (error) => error.code === "GUIDED_OPPORTUNITY_ABORTED"
  );
  assert.throws(
    () => lifecycle.markHint(),
    (error) => error.code === "GUIDED_OPPORTUNITY_ABORTED"
  );
  await assert.rejects(
    () => lifecycle.recordFirstResponse({ score: 1 }),
    (error) => error.code === "GUIDED_OPPORTUNITY_ABORTED"
  );
  await assert.rejects(
    () => lifecycle.completeSequenceStep("correct-first-response"),
    (error) => error.code === "GUIDED_OPPORTUNITY_ABORTED"
  );
});

test("abort waits for an in-flight activation and releases a late-acquired claim exactly once", async () => {
  const { calls, curriculum, resolution } = fixture();
  const originalClaim = curriculum.claimDeveloperPilot.bind(curriculum);
  let continueClaim;
  const claimGate = new Promise((resolve) => { continueClaim = resolve; });
  let markClaimStarted;
  const claimStarted = new Promise((resolve) => { markClaimStarted = resolve; });
  curriculum.claimDeveloperPilot = async (...args) => {
    markClaimStarted();
    await claimGate;
    return originalClaim(...args);
  };
  const lifecycle = createGuidedOpportunityLifecycle({
    curriculum,
    resolution,
    capabilityId: "independent-comprehension"
  });
  const activation = lifecycle.activate();
  await claimStarted;
  let abortResolved = false;
  const aborting = lifecycle.abort().then((result) => {
    abortResolved = true;
    return result;
  });
  await Promise.resolve();
  assert.equal(abortResolved, false);
  continueClaim();
  await assert.rejects(
    () => activation,
    (error) => error.code === "GUIDED_OPPORTUNITY_ABORTED"
  );
  const aborted = await aborting;
  assert.equal(aborted.phase, "aborted");
  assert.equal(calls.filter((call) => call === "curriculum:release").length, 1);
});

test("abort releases an active claim once and remains safe after evidence already released it", async () => {
  const activeFixture = fixture();
  const active = createGuidedOpportunityLifecycle({
    curriculum: activeFixture.curriculum,
    resolution: activeFixture.resolution,
    capabilityId: "independent-comprehension"
  });
  await active.activate();
  await Promise.all([active.abort(), active.abort()]);
  assert.equal(active.state().phase, "aborted");
  assert.equal(activeFixture.calls.filter((call) => call === "curriculum:release").length, 1);
  await assert.rejects(
    () => active.recordSolutionReveal(),
    (error) => error.code === "GUIDED_OPPORTUNITY_ABORTED"
  );

  const closedFixture = fixture();
  const closed = createGuidedOpportunityLifecycle({
    curriculum: closedFixture.curriculum,
    resolution: closedFixture.resolution,
    capabilityId: "independent-comprehension"
  });
  await closed.activate();
  await closed.recordFirstResponse({ score: 1 });
  assert.equal(closedFixture.calls.filter((call) => call === "curriculum:release").length, 1);
  await Promise.all([closed.abort(), closed.abort()]);
  assert.equal(closed.state().phase, "aborted");
  assert.equal(closedFixture.calls.filter((call) => call === "curriculum:release").length, 1);
});

test("abort waits for an in-flight response before releasing and settling terminal state", async () => {
  const { calls, curriculum, opportunity, resolution } = fixture();
  const originalResponse = opportunity.recordFirstResponse.bind(opportunity);
  let continueResponse;
  const responseGate = new Promise((resolve) => { continueResponse = resolve; });
  opportunity.recordFirstResponse = async (request) => {
    await responseGate;
    return originalResponse(request);
  };
  const lifecycle = createGuidedOpportunityLifecycle({
    curriculum,
    resolution,
    capabilityId: "independent-comprehension"
  });
  await lifecycle.activate();
  const response = lifecycle.recordFirstResponse({ score: 1 });
  let abortResolved = false;
  const aborting = lifecycle.abort().then((result) => {
    abortResolved = true;
    return result;
  });
  await Promise.resolve();
  assert.equal(abortResolved, false);
  continueResponse();
  await assert.rejects(
    () => response,
    (error) => error.code === "GUIDED_OPPORTUNITY_ABORTED"
  );
  const aborted = await aborting;
  assert.equal(aborted.phase, "aborted");
  assert.equal(calls.filter((call) => call === "curriculum:release").length, 1);
});

test("abort waits for an in-flight sequence reveal and releases its retained lease once", async () => {
  const { calls, curriculum, opportunity, release, resolution } = fixture();
  const originalReveal = opportunity.recordSolutionReveal.bind(opportunity);
  let continueReveal;
  const revealGate = new Promise((resolve) => { continueReveal = resolve; });
  opportunity.recordSolutionReveal = async (request) => {
    await revealGate;
    return originalReveal(request);
  };
  curriculum.claimDeveloperPilotSequence = async (orderedBindingIds) => ({
    status: "claimed",
    claimed: true,
    bindingId: "binding.word",
    sequence: {
      id: "sequence.word",
      fingerprint: "sha256:sequence",
      orderedBindingIds,
      stepIndex: 0,
      stepNumber: 1,
      totalSteps: 3
    },
    opportunity,
    release,
    async complete() {
      await release();
      return { completed: true };
    }
  });
  const lifecycle = createGuidedOpportunityLifecycle({
    curriculum,
    resolution,
    capabilityId: "independent-comprehension",
    sequence: sequenceConfiguration()
  });
  await lifecycle.activate({ requirePresented: () => true });
  const reveal = lifecycle.recordSolutionReveal();
  let abortResolved = false;
  const aborting = lifecycle.abort().then((result) => {
    abortResolved = true;
    return result;
  });
  await Promise.resolve();
  assert.equal(abortResolved, false);
  continueReveal();
  await assert.rejects(
    () => reveal,
    (error) => error.code === "GUIDED_OPPORTUNITY_ABORTED"
  );
  const aborted = await aborting;
  assert.equal(aborted.phase, "aborted");
  assert.equal(calls.filter((call) => call === "curriculum:release").length, 1);
});

test("a hidden presentation defers activation without consuming the lifecycle", async () => {
  const { calls, curriculum, resolution } = fixture();
  const lifecycle = createGuidedOpportunityLifecycle({ curriculum, resolution, capabilityId: "independent-comprehension" });
  let presented = false;
  const deferred = await lifecycle.activate({ requirePresented: () => presented });
  assert.equal(deferred.phase, "pending");
  assert.equal(deferred.taskFingerprint, "");
  presented = true;
  const ready = await lifecycle.activate({ requirePresented: () => presented });
  assert.equal(ready.phase, "ready");
  assert.equal(calls.filter((call) => call.startsWith("curriculum:claim:")).length, 2);
});

test("a used or active developer pilot fails lifecycle activation closed", async () => {
  const { curriculum, resolution } = fixture({ claimStatus: "blocked" });
  const lifecycle = createGuidedOpportunityLifecycle({ curriculum, resolution, capabilityId: "independent-comprehension" });
  await assert.rejects(
    () => lifecycle.activate(),
    (error) => error.code === "GUIDED_OPPORTUNITY_REENTRY_BLOCKED"
  );
  assert.equal(lifecycle.state().phase, "failed");
  assert.equal(lifecycle.state().taskFingerprint, "");
});

test("hint support is sticky and each explicit hint kind is counted at most once", async () => {
  const { calls, curriculum, resolution } = fixture();
  const lifecycle = createGuidedOpportunityLifecycle({ curriculum, resolution, capabilityId: "independent-comprehension" });
  await lifecycle.activate();
  lifecycle.markHint("dictionary");
  lifecycle.markHint("dictionary");
  lifecycle.markHint("picture");
  assert.equal(lifecycle.state().hintsUsed, 2);
  assert.equal(calls.filter((call) => call === "opportunity:hint").length, 2);
});

test("the first response closes evidence while later corrections remain practice", async () => {
  const { calls, curriculum, resolution } = fixture();
  const lifecycle = createGuidedOpportunityLifecycle({ curriculum, resolution, capabilityId: "independent-comprehension" });
  await lifecycle.activate();
  const first = await lifecycle.recordFirstResponse({ score: 0 });
  const correction = await lifecycle.recordFirstResponse({ score: 1 });
  assert.equal(first.recorded, true);
  assert.equal(correction.recorded, false);
  assert.equal(calls.filter((call) => call.startsWith("opportunity:response:")).length, 1);
  assert.equal(calls.filter((call) => call === "curriculum:release").length, 1);
  assert.equal(lifecycle.state().phase, "closed");
});

test("a reveal closes the opportunity before the answer may be displayed", async () => {
  const { calls, curriculum, resolution } = fixture();
  const lifecycle = createGuidedOpportunityLifecycle({ curriculum, resolution, capabilityId: "independent-comprehension" });
  await lifecycle.activate();
  const reveal = await lifecycle.recordSolutionReveal();
  assert.equal(reveal.recorded, true);
  assert.equal(lifecycle.state().solutionRevealed, true);
  assert.equal(lifecycle.state().firstResponseRecorded, true);
  assert.ok(calls.includes("opportunity:reveal"));
  assert.equal(calls.filter((call) => call === "curriculum:release").length, 1);
});

test("an incorrect answer can persist sticky reveal support in its immutable first response", async () => {
  const { calls, curriculum, resolution } = fixture();
  const lifecycle = createGuidedOpportunityLifecycle({ curriculum, resolution, capabilityId: "independent-comprehension" });
  await lifecycle.activate();
  lifecycle.markSolutionRevealed();
  await lifecycle.recordFirstResponse({ score: 0 });
  assert.equal(lifecycle.state().solutionRevealed, true);
  assert.ok(calls.includes("opportunity:mark-reveal"));
  assert.ok(calls.includes("opportunity:response:0:revealed=true"));
  assert.equal(calls.filter((call) => call === "curriculum:release").length, 1);
});

test("evidence persistence failure releases the lease and never reports success", async () => {
  const { calls, curriculum, resolution } = fixture({ failEvidence: true });
  const lifecycle = createGuidedOpportunityLifecycle({ curriculum, resolution, capabilityId: "independent-comprehension" });
  await lifecycle.activate();
  await assert.rejects(() => lifecycle.recordFirstResponse({ score: 1 }), /storage unavailable/);
  assert.equal(lifecycle.state().phase, "failed");
  assert.equal(lifecycle.state().firstResponseRecorded, false);
  assert.equal(calls.filter((call) => call === "curriculum:release").length, 1);
});

test("an ordered Guided sequence retains its lease through correction and completes durably", async () => {
  const { calls, curriculum, opportunity, release, resolution } = fixture();
  curriculum.claimDeveloperPilotSequence = async (orderedBindingIds, options) => {
    calls.push(`curriculum:sequence:${orderedBindingIds.join(",")}`);
    return {
      status: "claimed",
      claimed: true,
      bindingId: "binding.word",
      sequence: {
        id: "sequence.word",
        fingerprint: "sha256:sequence",
        orderedBindingIds,
        stepIndex: 0,
        stepNumber: 1,
        totalSteps: 3
      },
      opportunity,
      release,
      async complete(completionKind) {
        calls.push(`curriculum:complete:${completionKind}`);
        await release();
        return { completionKind, completed: true };
      }
    };
  };
  const lifecycle = createGuidedOpportunityLifecycle({
    curriculum,
    resolution,
    capabilityId: "independent-comprehension",
    sequence: sequenceConfiguration()
  });

  await lifecycle.activate({ requirePresented: () => true });
  await lifecycle.recordFirstResponse({ score: 0 });
  assert.equal(calls.filter((call) => call === "curriculum:release").length, 0);
  const correction = await lifecycle.recordFirstResponse({ score: 1 });
  assert.equal(correction.recorded, false);
  const completion = await lifecycle.completeSequenceStep("corrective-correct");

  assert.equal(completion.result.completionKind, "corrective-correct");
  assert.equal(lifecycle.state().phase, "complete");
  assert.equal(lifecycle.state().sequence.stepNumber, 1);
  assert.equal(calls.filter((call) => call.startsWith("opportunity:response:")).length, 1);
  assert.equal(calls.filter((call) => call === "curriculum:release").length, 1);
});

test("abort releases an ordered sequence lease and prevents later completion", async () => {
  const { calls, curriculum, opportunity, release, resolution } = fixture();
  curriculum.claimDeveloperPilotSequence = async (orderedBindingIds) => ({
    status: "claimed",
    claimed: true,
    bindingId: "binding.word",
    sequence: {
      id: "sequence.word",
      fingerprint: "sha256:sequence",
      orderedBindingIds,
      stepIndex: 0,
      stepNumber: 1,
      totalSteps: 3
    },
    opportunity,
    release,
    async complete() {
      throw new Error("completion must not run after abort");
    }
  });
  const lifecycle = createGuidedOpportunityLifecycle({
    curriculum,
    resolution,
    capabilityId: "independent-comprehension",
    sequence: sequenceConfiguration()
  });
  await lifecycle.activate({ requirePresented: () => true });
  await lifecycle.abort();
  assert.equal(lifecycle.state().phase, "aborted");
  assert.equal(calls.filter((call) => call === "curriculum:release").length, 1);
  await assert.rejects(
    () => lifecycle.completeSequenceStep("correct-first-response"),
    (error) => error.code === "GUIDED_OPPORTUNITY_ABORTED"
  );
});

test("abort waits for in-flight sequence completion and keeps the lifecycle aborted", async () => {
  const { calls, curriculum, opportunity, release, resolution } = fixture();
  let continueCompletion;
  const completionGate = new Promise((resolve) => { continueCompletion = resolve; });
  let markCompletionStarted;
  const completionStarted = new Promise((resolve) => { markCompletionStarted = resolve; });
  curriculum.claimDeveloperPilotSequence = async (orderedBindingIds) => ({
    status: "claimed",
    claimed: true,
    bindingId: "binding.word",
    sequence: {
      id: "sequence.word",
      fingerprint: "sha256:sequence",
      orderedBindingIds,
      stepIndex: 0,
      stepNumber: 1,
      totalSteps: 3
    },
    opportunity,
    release,
    async complete(completionKind) {
      markCompletionStarted();
      await completionGate;
      await release();
      return { completionKind, completed: true };
    }
  });
  const lifecycle = createGuidedOpportunityLifecycle({
    curriculum,
    resolution,
    capabilityId: "independent-comprehension",
    sequence: sequenceConfiguration()
  });
  await lifecycle.activate({ requirePresented: () => true });
  const completion = lifecycle.completeSequenceStep("correct-first-response");
  await completionStarted;
  let abortResolved = false;
  const aborting = lifecycle.abort().then((result) => {
    abortResolved = true;
    return result;
  });
  await Promise.resolve();
  assert.equal(abortResolved, false);
  continueCompletion();
  await assert.rejects(
    () => completion,
    (error) => error.code === "GUIDED_OPPORTUNITY_ABORTED"
  );
  const aborted = await aborting;
  assert.equal(aborted.phase, "aborted");
  assert.equal(calls.filter((call) => call === "curriculum:release").length, 1);
});

test("a sequence completed by another context activates as terminal instead of reentry failure", async () => {
  const { curriculum, resolution } = fixture();
  curriculum.claimDeveloperPilotSequence = async (orderedBindingIds) => ({
    status: "complete",
    claimed: false,
    reason: "sequence-complete",
    sequence: {
      id: "sequence.word",
      fingerprint: "sha256:sequence",
      orderedBindingIds,
      stepIndex: 3,
      stepNumber: 3,
      totalSteps: 3,
      bindingId: null
    },
    preview: null
  });
  const lifecycle = createGuidedOpportunityLifecycle({
    curriculum,
    resolution,
    capabilityId: "independent-comprehension",
    sequence: sequenceConfiguration()
  });
  const activated = await lifecycle.activate({ requirePresented: () => true });
  assert.equal(activated.phase, "complete");
  assert.equal(activated.sequence.stepIndex, 3);
  assert.equal(activated.taskId, "");
  assert.equal(activated.failure, null);
});

test("a sequence preview defers without evidence and exposes the exact expected binding", async () => {
  const { calls, curriculum, opportunity, release, resolution } = fixture();
  curriculum.claimDeveloperPilotSequence = async (orderedBindingIds, options) => {
    const sequence = {
      id: "sequence.word",
      fingerprint: "sha256:sequence",
      orderedBindingIds,
      stepIndex: 0,
      stepNumber: 1,
      totalSteps: 3
    };
    if (options.requirePresented() !== true) {
      return {
        status: "deferred",
        claimed: false,
        reason: "not-presented",
        sequence,
        preview: {
          bindingId: "binding.word",
          activityId: "word-world",
          contentRef: { contentId: "ww-1" },
          targetSkillId: "cs.skill.read",
          capabilityId: "independent-comprehension"
        }
      };
    }
    return {
      status: "claimed",
      claimed: true,
      bindingId: "binding.word",
      sequence,
      opportunity,
      release,
      async complete() {
        await release();
        return { completed: true };
      }
    };
  };
  const lifecycle = createGuidedOpportunityLifecycle({
    curriculum,
    resolution,
    capabilityId: "independent-comprehension",
    sequence: sequenceConfiguration()
  });

  const deferred = await lifecycle.activate({ requirePresented: () => false });
  assert.equal(deferred.phase, "pending");
  assert.equal(deferred.sequencePreview.bindingId, "binding.word");
  assert.equal(calls.filter((call) => call.startsWith("opportunity:")).length, 0);
  const ready = await lifecycle.activate({ requirePresented: () => true });
  assert.equal(ready.phase, "ready");
});
