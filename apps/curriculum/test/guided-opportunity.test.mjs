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
        async release() {
          if (leaseReleased) return;
          leaseReleased = true;
          calls.push("curriculum:release");
        }
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
  return { calls, curriculum, resolution };
}

test("a Guided lifecycle requires an explicit assessed capability", () => {
  const { curriculum, resolution } = fixture();
  assert.throws(
    () => createGuidedOpportunityLifecycle({ curriculum, resolution }),
    (error) => error.code === "GUIDED_OPPORTUNITY_BINDING_INVALID"
  );
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
