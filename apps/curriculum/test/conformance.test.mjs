import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

import {
  computeApprovalAttestationDigest,
  computeCanonicalContractDigest,
  computeTargetPackDigest,
  validateConformance
} from "../src/validate-conformance.mjs";

const curriculumUrl = new URL("../data/canonical-curriculum.v1.en.json", import.meta.url);
const packUrl = new URL("../data/cs-CZ.realization-pack.v1.json", import.meta.url);
const fixtureDirectoryUrl = new URL("./fixtures/", import.meta.url);

async function readJson(url) {
  return JSON.parse(await readFile(url, "utf8"));
}

function clone(value) {
  return structuredClone(value);
}

function markPackHumanApprovedForTest(pack) {
  for (const collectionName of ["unitBindings", "skills", "utterances", "contexts"]) {
    for (const entity of pack[collectionName]) entity.review.status = "human-approved";
  }
  return pack;
}

function createTestApprovalAttestation(curriculum, pack) {
  return {
    schemaVersion: "caatuu-target-pack-review-attestation-v1",
    attestationId: "attestation.test.cs-cz.v1",
    curriculum: {
      id: curriculum.curriculumId,
      version: curriculum.version,
      canonicalContractDigest: computeCanonicalContractDigest(curriculum)
    },
    targetPack: {
      id: pack.packId,
      version: pack.version,
      targetLocale: pack.targetLocale,
      targetPackDigest: computeTargetPackDigest(pack)
    },
    reviewer: {
      reviewerId: "test-native-teacher",
      role: "native-language-educator",
      qualifiedTargetLocales: [pack.targetLocale]
    },
    reviewedAt: "2026-08-01T12:00:00Z",
    checklistVersion: "caatuu-target-language-teacher-review-v1",
    decisions: {
      semanticEquivalence: "approved",
      naturalness: "approved",
      pragmatics: "approved",
      morphology: "approved",
      ageSafety: "approved",
      contextValidity: "approved",
      opportunityValidity: "approved",
      mediaValidity: "approved"
    },
    notesEn: "Synthetic approval used only to test the release gate."
  };
}

function decodePointerToken(token) {
  return token.replaceAll("~1", "/").replaceAll("~0", "~");
}

function applyMutation(document, mutation) {
  const tokens = mutation.path
    .split("/")
    .slice(1)
    .map(decodePointerToken);
  assert.ok(tokens.length, `mutation requires a non-root path: ${mutation.path}`);
  let parent = document;
  for (const token of tokens.slice(0, -1)) {
    assert.ok(parent != null && token in parent, `unknown mutation path ${mutation.path}`);
    parent = parent[token];
  }
  const finalToken = tokens.at(-1);
  if (mutation.op === "remove") {
    if (Array.isArray(parent)) parent.splice(Number(finalToken), 1);
    else delete parent[finalToken];
  } else if (mutation.op === "replace" || mutation.op === "add") {
    parent[finalToken] = clone(mutation.value);
  } else {
    assert.fail(`unsupported mutation operation ${mutation.op}`);
  }
}

test("the Czech prototype conforms to the canonical curriculum", async () => {
  const curriculum = await readJson(curriculumUrl);
  const pack = await readJson(packUrl);
  const result = validateConformance(curriculum, pack);

  assert.equal(result.valid, true, JSON.stringify(result.errors, null, 2));
  assert.deepEqual(result.errors, []);
  assert.equal(result.summary.canonicalUnits, 3);
  assert.equal(result.summary.semanticDefinitions, 43);
  assert.equal(result.summary.realizedUnits, 3);
  assert.equal(result.summary.contexts, 48);
  assert.equal(result.canonicalContractDigest, pack.canonicalContractDigest);
  assert.equal(result.targetPackDigest, computeTargetPackDigest(pack));
});

test("the canonical digest is independent of JSON object key order", async () => {
  const curriculum = await readJson(curriculumUrl);
  const reordered = {
    units: curriculum.units.map((unit) => ({
      masteryPolicy: unit.masteryPolicy,
      requiredLearningStages: unit.requiredLearningStages,
      prerequisiteUnitIds: unit.prerequisiteUnitIds,
      semanticScope: unit.semanticScope,
      transferPolicy: unit.transferPolicy,
      canDo: unit.canDo,
      ordinal: unit.ordinal,
      revision: unit.revision,
      id: unit.id,
      title: unit.title,
      description: unit.description
    })),
    unitOrder: curriculum.unitOrder,
    semanticDefinitions: curriculum.semanticDefinitions.map((definition) => ({
      definitionEn: definition.definitionEn,
      ...(definition.requiredEvidenceMode ? { requiredEvidenceMode: definition.requiredEvidenceMode } : {}),
      kind: definition.kind,
      revision: definition.revision,
      id: definition.id
    })),
    learningStageSequence: curriculum.learningStageSequence,
    planningPolicy: curriculum.planningPolicy,
    description: curriculum.description,
    title: curriculum.title,
    specLocale: curriculum.specLocale,
    version: curriculum.version,
    curriculumId: curriculum.curriculumId,
    schemaVersion: curriculum.schemaVersion
  };

  assert.equal(computeCanonicalContractDigest(reordered), computeCanonicalContractDigest(curriculum));
});

test("canonical semantic drift invalidates the pinned target pack", async () => {
  const curriculum = await readJson(curriculumUrl);
  const pack = await readJson(packUrl);
  curriculum.units[0].canDo.observableOutcome = "A materially different outcome.";

  const result = validateConformance(curriculum, pack);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((entry) => entry.code === "CURR_DIGEST_MISMATCH"));
});

test("locked English descriptions and planning rules are covered by the canonical digest", async () => {
  const curriculum = await readJson(curriculumUrl);
  const originalDigest = computeCanonicalContractDigest(curriculum);

  const changedDescription = clone(curriculum);
  changedDescription.units[0].description = "A changed English learning definition.";
  assert.notEqual(computeCanonicalContractDigest(changedDescription), originalDigest);

  const changedPlanning = clone(curriculum);
  changedPlanning.planningPolicy.repairRetryTaskGap.maximum += 1;
  assert.notEqual(computeCanonicalContractDigest(changedPlanning), originalDigest);
});

test("trusted release pins detect target-language content tampering", async () => {
  const curriculum = await readJson(curriculumUrl);
  const pack = await readJson(packUrl);
  const expectedPackDigest = computeTargetPackDigest(pack);
  pack.utterances[0].text = "Nazdar.";

  const result = validateConformance(curriculum, pack, { expectedPackDigest });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((entry) => entry.code === "CURR_PACK_DIGEST_MISMATCH"));
});

test("target-language edits require both entity revision and pack version bumps", async () => {
  const curriculum = await readJson(curriculumUrl);
  const previousPack = await readJson(packUrl);
  const currentPack = clone(previousPack);
  currentPack.utterances[0].text = "Nazdar.";

  const result = validateConformance(curriculum, currentPack, { previousPack });
  const codes = new Set(result.errors.map((entry) => entry.code));
  assert.ok(codes.has("CURR_REVISION_REQUIRED"));
  assert.ok(codes.has("CURR_VERSION_REQUIRED"));
});

test("co-edited canonical files still require release version and entity revision bumps", async () => {
  const previous = await readJson(curriculumUrl);
  const current = clone(previous);
  const pack = await readJson(packUrl);
  current.units[0].canDo.observableOutcome = "A co-edited outcome that should not inherit the old revision.";
  pack.canonicalContractDigest = computeCanonicalContractDigest(current);

  const result = validateConformance(current, pack, { previousCanonical: previous });
  const codes = new Set(result.errors.map((entry) => entry.code));
  assert.ok(codes.has("CURR_REVISION_REQUIRED"));
  assert.ok(codes.has("CURR_VERSION_REQUIRED"));
});

test("the canonical learning operations cannot be reordered", async () => {
  const curriculum = await readJson(curriculumUrl);
  const pack = await readJson(packUrl);
  curriculum.units[0].requiredLearningStages.reverse();
  pack.canonicalContractDigest = computeCanonicalContractDigest(curriculum);

  const result = validateConformance(curriculum, pack);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((entry) => entry.code === "CURR_STAGE_ORDER"));
});

test("release validation blocks prototype content pending human approval", async () => {
  const curriculum = await readJson(curriculumUrl);
  const pack = await readJson(packUrl);
  const result = validateConformance(curriculum, pack, { requireHumanApproval: true });

  assert.equal(result.valid, false);
  const codes = new Set(result.errors.map((entry) => entry.code));
  assert.ok(codes.has("CURR_RELEASE_REVIEW"));
  assert.ok(codes.has("CURR_RELEASE_PIN_REQUIRED"));
  assert.ok(codes.has("CURR_RELEASE_ATTESTATION"));
  assert.ok(codes.has("CURR_RELEASE_ATTESTATION_PIN_REQUIRED"));
});

test("release validation accepts an exact digest-bound teacher attestation", async () => {
  const curriculum = await readJson(curriculumUrl);
  const pack = markPackHumanApprovedForTest(await readJson(packUrl));
  const expectedPackDigest = computeTargetPackDigest(pack);
  const approvalAttestation = createTestApprovalAttestation(curriculum, pack);
  const expectedApprovalAttestationDigest = computeApprovalAttestationDigest(approvalAttestation);

  const result = validateConformance(curriculum, pack, {
    requireHumanApproval: true,
    expectedPackDigest,
    expectedApprovalAttestationDigest,
    validationTime: "2026-08-02T12:00:00Z",
    approvalAttestation
  });

  assert.equal(result.valid, true, JSON.stringify(result.errors, null, 2));
  assert.equal(result.approvalAttestationDigest, expectedApprovalAttestationDigest);
});

test("release validation rejects forged or incomplete teacher attestations", async (t) => {
  const curriculum = await readJson(curriculumUrl);
  const pack = markPackHumanApprovedForTest(await readJson(packUrl));
  const expectedPackDigest = computeTargetPackDigest(pack);
  const trustedApprovalAttestation = createTestApprovalAttestation(curriculum, pack);
  const expectedApprovalAttestationDigest = computeApprovalAttestationDigest(trustedApprovalAttestation);
  const cases = [
    ["self-declared replacement reviewer", (row) => { row.reviewer.reviewerId = "forged-native-teacher"; }],
    ["wrong target-pack digest", (row) => { row.targetPack.targetPackDigest = `sha256:${"0".repeat(64)}`; }],
    ["wrong canonical digest", (row) => { row.curriculum.canonicalContractDigest = `sha256:${"1".repeat(64)}`; }],
    ["unqualified locale", (row) => { row.reviewer.qualifiedTargetLocales = ["sk-SK"]; }],
    ["unapproved decision", (row) => { row.decisions.pragmatics = "rejected"; }],
    ["unsupported hidden field", (row) => { row.selfApproved = true; }],
    ["invalid review timestamp", (row) => { row.reviewedAt = "sometime yesterday"; }],
    ["impossible calendar timestamp", (row) => { row.reviewedAt = "2026-02-30T12:00:00Z"; }],
    ["future review timestamp", (row) => { row.reviewedAt = "2026-08-03T12:00:00Z"; }]
  ];

  for (const [name, mutate] of cases) {
    await t.test(name, () => {
      const approvalAttestation = createTestApprovalAttestation(curriculum, pack);
      mutate(approvalAttestation);
      const result = validateConformance(curriculum, pack, {
        requireHumanApproval: true,
        expectedPackDigest,
        expectedApprovalAttestationDigest,
        validationTime: "2026-08-02T12:00:00Z",
        approvalAttestation
      });
      assert.equal(result.valid, false);
      const codes = new Set(result.errors.map((entry) => entry.code));
      assert.ok(codes.has("CURR_RELEASE_ATTESTATION") || codes.has("CURR_RELEASE_ATTESTATION_DIGEST_MISMATCH"));
    });
  }
});

test("canonical reveal policy cannot be weakened", async () => {
  const curriculum = await readJson(curriculumUrl);
  const pack = await readJson(packUrl);
  curriculum.units[1].masteryPolicy.solutionRevealCanQualify = true;

  const result = validateConformance(curriculum, pack);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((entry) => entry.code === "CURR_EXPOSURE_AS_MASTERY"));
});

test("all divergence fixtures fail with their declared error codes", async (t) => {
  const curriculum = await readJson(curriculumUrl);
  const basePack = await readJson(packUrl);
  const names = (await readdir(fixtureDirectoryUrl))
    .filter((name) => name.endsWith(".json"))
    .sort();

  assert.ok(names.length >= 5);
  for (const name of names) {
    await t.test(name, async () => {
      const fixture = await readJson(new URL(name, fixtureDirectoryUrl));
      assert.equal(fixture.schemaVersion, "caatuu-conformance-mutation-v1");
      const pack = clone(basePack);
      for (const mutation of fixture.mutations) applyMutation(pack, mutation);

      const result = validateConformance(curriculum, pack);
      const codes = new Set(result.errors.map((entry) => entry.code));
      assert.equal(result.valid, false, `${name} unexpectedly conformed`);
      for (const expectedCode of fixture.expectedErrorCodes) {
        assert.ok(codes.has(expectedCode), `${name} missing ${expectedCode}; got ${[...codes].join(", ")}`);
      }
    });
  }
});
