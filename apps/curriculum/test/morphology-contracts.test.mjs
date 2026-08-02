import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  composeMorphologyRound,
  normalizeMorphologyCatalog
} from "../runtime/morphology-round-core.mjs";
import {
  computeCanonicalContractDigest,
  computeTargetPackDigest
} from "../src/validate-conformance.mjs";
import { validateMorphologyContracts } from "../src/validate-morphology-contracts.mjs";

const curriculumUrl = new URL("../data/canonical-curriculum.v1.en.json", import.meta.url);
const targetPackUrl = new URL("../data/cs-CZ.realization-pack.v1.json", import.meta.url);
const mechanicCatalogUrl = new URL(
  "../data/shared-mechanic-capabilities.v1.en.json",
  import.meta.url
);
const morphologyCatalogUrl = new URL(
  "../data/cs-CZ.morphology-developer-pilot.v1.json",
  import.meta.url
);
const mechanicCatalogSchemaUrl = new URL(
  "../schemas/shared-mechanic-capability-catalog.schema.json",
  import.meta.url
);
const morphologyCatalogSchemaUrl = new URL(
  "../schemas/target-morphology-catalog.schema.json",
  import.meta.url
);
const sourceCatalogUrl = new URL("../data/pilot-content-sources.v1.json", import.meta.url);
const bindingRegistryUrl = new URL("../data/cs-CZ.cross-game-bindings.v1.json", import.meta.url);

const CONTENT_ID = "cs.morphology.cist.present-singular-person.1sg";
const FAMILY_ID = "cs.morphology.family.cist.present-singular";
const CAPABILITY_ID = "capability.contextual-target-realization.visible-form-choice";
const TARGET_SKILL_ID = "cs.skill.form.cist.present-singular-person";

const expectedItemIds = [
  "cs.form.cist.present-indicative.1sg",
  "cs.form.cist.present-indicative.2sg",
  "cs.form.cist.present-indicative.3sg"
];
const expectedCueIds = [
  "cs.cue.cist.read.speaker-singular-current",
  "cs.cue.cist.read.addressee-singular-current",
  "cs.cue.cist.read.named-third-person-current"
];
const expectedExerciseIds = [
  "cs.exercise.cist.visible-form-choice.1sg",
  "cs.exercise.cist.visible-form-choice.2sg",
  "cs.exercise.cist.visible-form-choice.3sg"
];

async function readJson(url) {
  return JSON.parse(await readFile(url, "utf8"));
}

const fixturePromise = Promise.all([
  readJson(curriculumUrl),
  readJson(targetPackUrl),
  readFile(mechanicCatalogUrl),
  readFile(morphologyCatalogUrl),
  readJson(mechanicCatalogSchemaUrl),
  readJson(morphologyCatalogSchemaUrl),
  readJson(sourceCatalogUrl),
  readJson(bindingRegistryUrl)
]).then(([
  curriculum,
  targetPack,
  mechanicCatalogBytes,
  morphologyCatalogBytes,
  mechanicCatalogSchema,
  morphologyCatalogSchema,
  sourceCatalog,
  bindingRegistry
]) => ({
  curriculum,
  targetPack,
  mechanicCatalog: JSON.parse(mechanicCatalogBytes.toString("utf8")),
  mechanicCatalogDigest: `sha256:${createHash("sha256").update(mechanicCatalogBytes).digest("hex")}`,
  mechanicCatalogSchema,
  morphologyCatalog: JSON.parse(morphologyCatalogBytes.toString("utf8")),
  morphologyCatalogDigest: `sha256:${createHash("sha256").update(morphologyCatalogBytes).digest("hex")}`,
  morphologyCatalogSchema,
  sourceCatalog,
  bindingRegistry
}));

async function fixture() {
  return structuredClone(await fixturePromise);
}

function validate(inputs, options) {
  return validateMorphologyContracts(inputs, options);
}

function errorReport(result) {
  return JSON.stringify(result.errors, null, 2);
}

function assertHasCode(result, expectedCode) {
  assert.equal(result.valid, false, `Expected ${expectedCode}, but validation passed.`);
  assert.ok(Array.isArray(result.errors) && result.errors.length > 0, "Expected validation errors.");
  assert.ok(
    result.errors.some((error) => error?.code === expectedCode),
    `Expected ${expectedCode}; received ${errorReport(result)}`
  );
}

function assertHasSchemaIssue(result, expectedCode, expectedPath, expectedKeyword) {
  assertHasCode(result, expectedCode);
  assert.ok(
    result.errors.some((error) => (
      error?.code === expectedCode
      && error?.path === expectedPath
      && error?.message.includes(`(${expectedKeyword} at `)
    )),
    `Expected ${expectedKeyword} at ${expectedPath}; received ${errorReport(result)}`
  );
}

function repinTargetPack(inputs) {
  inputs.morphologyCatalog.metadata.targetPack.targetPackDigest = computeTargetPackDigest(
    inputs.targetPack
  );
}

function setCuePrerequisites(cue, prerequisiteRefs) {
  cue.metadata.prerequisiteRefs = structuredClone(prerequisiteRefs);
  cue.metadata.exercise.prerequisiteRefs = structuredClone(prerequisiteRefs);
}

function markEveryReviewHumanApproved(value) {
  if (Array.isArray(value)) {
    for (const entry of value) markEveryReviewHumanApproved(entry);
    return;
  }
  if (!value || typeof value !== "object") return;
  if (value.review && typeof value.review === "object") {
    value.review.status = "human-approved";
  }
  for (const child of Object.values(value)) markEveryReviewHumanApproved(child);
}

test("the English-backed Czech morphology pilot validates with stable IDs and counts", async () => {
  const inputs = await fixture();
  const result = validate(inputs);

  assert.equal(result.valid, true, errorReport(result));
  assert.deepEqual(result.errors, []);
  assert.ok(
    result.warnings.some((warning) => warning?.code === "MORPH_REVIEW_PENDING"),
    "The developer pilot must remain visibly pending human review."
  );

  const { mechanicCatalog, morphologyCatalog } = inputs;
  assert.equal(morphologyCatalog.metadata.stableContentId, CONTENT_ID);
  assert.deepEqual(morphologyCatalog.families.map(({ id }) => id), [FAMILY_ID]);
  assert.deepEqual(morphologyCatalog.items.map(({ id }) => id), expectedItemIds);
  assert.deepEqual(morphologyCatalog.cues.map(({ id }) => id), expectedCueIds);
  assert.deepEqual(
    morphologyCatalog.cues.map((cue) => cue.metadata.exercise.id),
    expectedExerciseIds
  );
  assert.deepEqual(mechanicCatalog.capabilities.map(({ id }) => id), [CAPABILITY_ID]);
  assert.deepEqual(
    mechanicCatalog.capabilities[0].requiredCanonicalContextDimensionIds,
    ["referent-person", "time-profile"]
  );
  assert.equal(morphologyCatalog.version, "1.1.0");
  assert.equal(mechanicCatalog.version, "1.0.0");
  assert.deepEqual(morphologyCatalog.families.map(({ revision }) => revision), [1]);
  assert.deepEqual(morphologyCatalog.items.map(({ revision }) => revision), [1, 2, 1]);
  assert.deepEqual(morphologyCatalog.cues.map(({ revision }) => revision), [1, 2, 2]);
  assert.deepEqual(
    morphologyCatalog.cues.map((cue) => cue.metadata.exercise.revision),
    [1, 2, 2]
  );
  assert.equal(
    [...mechanicCatalog.capabilityFamilies, ...mechanicCatalog.capabilities]
      .every(({ revision }) => revision === 1),
    true
  );
  assert.deepEqual(morphologyCatalog.metadata.stableContentSequence.orderedContentIds, [
    "cs.morphology.cist.present-singular-person.1sg",
    "cs.morphology.cist.present-singular-person.2sg",
    "cs.morphology.cist.present-singular-person.3sg"
  ]);

  assert.equal(result.summary.capabilityFamilies, 1);
  assert.equal(result.summary.capabilities, 1);
  assert.equal(result.summary.morphologyFamilies, 1);
  assert.equal(result.summary.morphologyItems, 3);
  assert.equal(result.summary.morphologyCues, 3);
  assert.equal(result.summary.morphologyExercises, 3);
  assert.equal(
    result.digests.canonicalContractDigest,
    computeCanonicalContractDigest(inputs.curriculum)
  );
  assert.equal(result.digests.targetPackDigest, computeTargetPackDigest(inputs.targetPack));
  assert.equal(
    inputs.morphologyCatalog.metadata.mechanicCatalog.digest,
    inputs.mechanicCatalogDigest
  );
});

test("the target catalog pins the exact English mechanic contract bytes", async () => {
  const inputs = await fixture();
  inputs.mechanicCatalogDigest = `sha256:${"0".repeat(64)}`;
  assertHasCode(validate(inputs), "MORPH_MECHANIC_CATALOG_DIGEST_MISMATCH");
});

test("the authoring gate rejects unknown fields and likely property-name typos", async (t) => {
  await t.test("unknown shared-mechanic field", async () => {
    const inputs = await fixture();
    inputs.mechanicCatalog.capabilities[0].unreviewedOverride = true;
    assertHasSchemaIssue(
      validate(inputs),
      "MORPH_MECHANIC_SCHEMA",
      "/mechanicCatalog/capabilities/0/unreviewedOverride",
      "additionalProperties"
    );
  });

  await t.test("misspelled shared-mechanic definition", async () => {
    const inputs = await fixture();
    const capability = inputs.mechanicCatalog.capabilities[0];
    capability.definitonEn = capability.definitionEn;
    delete capability.definitionEn;
    const result = validate(inputs);
    assertHasSchemaIssue(
      result,
      "MORPH_MECHANIC_SCHEMA",
      "/mechanicCatalog/capabilities/0/definitionEn",
      "required"
    );
    assertHasSchemaIssue(
      result,
      "MORPH_MECHANIC_SCHEMA",
      "/mechanicCatalog/capabilities/0/definitonEn",
      "additionalProperties"
    );
  });

  await t.test("unknown target-catalog teaching field", async () => {
    const inputs = await fixture();
    inputs.morphologyCatalog.cues[0].presentation.unreviewedCueEn = "Do not ship.";
    assertHasSchemaIssue(
      validate(inputs),
      "MORPH_CATALOG_SCHEMA",
      "/morphologyCatalog/cues/0/presentation/unreviewedCueEn",
      "additionalProperties"
    );
  });

  await t.test("misspelled natural translation", async () => {
    const inputs = await fixture();
    const presentation = inputs.morphologyCatalog.cues[0].presentation;
    presentation.naturalTranslatonEn = presentation.naturalTranslationEn;
    delete presentation.naturalTranslationEn;
    const result = validate(inputs);
    assertHasSchemaIssue(
      result,
      "MORPH_CATALOG_SCHEMA",
      "/morphologyCatalog/cues/0/presentation/naturalTranslationEn",
      "required"
    );
    assertHasSchemaIssue(
      result,
      "MORPH_CATALOG_SCHEMA",
      "/morphologyCatalog/cues/0/presentation/naturalTranslatonEn",
      "additionalProperties"
    );
  });
});

test("the deterministic runtime core accepts the authored catalog and composes its three-form round", async () => {
  const { morphologyCatalog } = await fixture();
  const normalized = normalizeMorphologyCatalog(morphologyCatalog);

  assert.equal(normalized.catalogId, "caatuu.cs-CZ.morphology-developer-pilot");
  assert.deepEqual(normalized.items.map(({ surface }) => surface), [
    "\u010dtu",
    "\u010dte\u0161",
    "\u010dte"
  ]);

  const cue = morphologyCatalog.cues[0];
  const round = composeMorphologyRound(morphologyCatalog, {
    catalogRef: {
      id: morphologyCatalog.catalogId,
      version: morphologyCatalog.version
    },
    familyRef: {
      id: morphologyCatalog.families[0].id,
      revision: morphologyCatalog.families[0].revision
    },
    cueRef: { id: cue.id, revision: cue.revision },
    optionCount: 3,
    taskFingerprint: "contract-test:cs-cist-present-singular"
  });

  assert.equal(round.options.length, 3);
  assert.deepEqual(round.targetItemRef, cue.targetItemRef);
  assert.equal(round.cue.presentation.naturalTranslationEn, "I am reading now.");
  assert.equal(new Set(round.options.map(({ surface }) => surface)).size, 3);
  assert.ok(Object.isFrozen(round));
});

test("visible target-form choice cannot exceed discrimination, comprehension, or non-mastery", async (t) => {
  const cases = [
    ["retrieval operation", ["mechanicShape", "operation"], "retrieve"],
    ["constructed production response", ["mechanicShape", "responseMode"], "constructed-form"],
    ["hidden target candidates", ["mechanicShape", "candidateVisibility"], "none"],
    ["target-language production", ["mechanicShape", "targetLanguageProduction"], true],
    ["retrieval learning stage", ["evidenceCeiling", "learningStage"], "retrieve"],
    ["production evidence", ["evidenceCeiling", "evidenceKind"], "production"],
    ["mastery eligibility", ["evidenceCeiling", "masteryEligible"], true]
  ];

  for (const [name, path, value] of cases) {
    await t.test(name, async () => {
      const inputs = await fixture();
      const capability = inputs.mechanicCatalog.capabilities[0];
      capability[path[0]][path[1]] = value;
      assertHasCode(validate(inputs), "MORPH_CAPABILITY_CEILING");
    });
  }
});

test("the morphology catalog must pin the current English curriculum and target-pack digests", async (t) => {
  await t.test("canonical curriculum digest", async () => {
    const inputs = await fixture();
    inputs.morphologyCatalog.metadata.curriculum.canonicalContractDigest = `sha256:${"0".repeat(64)}`;
    assertHasCode(validate(inputs), "MORPH_CURRICULUM_DIGEST_MISMATCH");
  });

  await t.test("target realization-pack digest", async () => {
    const inputs = await fixture();
    inputs.morphologyCatalog.metadata.targetPack.targetPackDigest = `sha256:${"0".repeat(64)}`;
    assertHasCode(validate(inputs), "MORPH_TARGET_PACK_DIGEST_MISMATCH");
  });
});

test("unknown and stale curriculum, target-pack, and mechanic references fail explicitly", async (t) => {
  const cases = [
    {
      name: "unknown unit",
      code: "MORPH_UNIT_REF_UNKNOWN",
      mutate: ({ morphologyCatalog }) => {
        morphologyCatalog.families[0].metadata.unitRef.id = "unit.missing";
      }
    },
    {
      name: "stale unit",
      code: "MORPH_UNIT_REF_STALE",
      mutate: ({ morphologyCatalog }) => {
        morphologyCatalog.families[0].metadata.unitRef.revision += 1;
      }
    },
    {
      name: "unknown target skill",
      code: "MORPH_TARGET_SKILL_REF_UNKNOWN",
      mutate: ({ morphologyCatalog }) => {
        morphologyCatalog.families[0].metadata.targetSkillRef.id = "cs.skill.form.missing";
      }
    },
    {
      name: "stale target skill",
      code: "MORPH_TARGET_SKILL_REF_STALE",
      mutate: ({ morphologyCatalog }) => {
        morphologyCatalog.families[0].metadata.targetSkillRef.revision += 1;
      }
    },
    {
      name: "unknown English semantic",
      code: "MORPH_SEMANTIC_REF_UNKNOWN",
      mutate: ({ morphologyCatalog }) => {
        morphologyCatalog.families[0].metadata.canonicalSemanticRefs[0].id =
          "function.missing";
      }
    },
    {
      name: "stale English semantic",
      code: "MORPH_SEMANTIC_REF_STALE",
      mutate: ({ morphologyCatalog }) => {
        morphologyCatalog.families[0].metadata.canonicalSemanticRefs[0].revision += 1;
      }
    },
    {
      name: "unknown shared capability",
      code: "MORPH_CAPABILITY_REF_UNKNOWN",
      mutate: ({ morphologyCatalog }) => {
        morphologyCatalog.families[0].metadata.capabilityRef.id =
          "capability.contextual-target-realization.missing";
      }
    },
    {
      name: "stale shared capability",
      code: "MORPH_CAPABILITY_REF_STALE",
      mutate: ({ morphologyCatalog }) => {
        morphologyCatalog.families[0].metadata.capabilityRef.revision += 1;
      }
    }
  ];

  for (const { name, code, mutate } of cases) {
    await t.test(name, async () => {
      const inputs = await fixture();
      mutate(inputs);
      assertHasCode(validate(inputs), code);
    });
  }
});

test("the morphology target skill remains supplemental to English-owned unit outcomes", async () => {
  const inputs = await fixture();
  const targetSkill = inputs.targetPack.skills.find(({ id }) => id === TARGET_SKILL_ID);
  assert.ok(targetSkill, `Missing fixture skill ${TARGET_SKILL_ID}.`);
  assert.equal(targetSkill.requiredForOutcome, false);

  targetSkill.requiredForOutcome = true;
  repinTargetPack(inputs);
  assertHasCode(validate(inputs), "MORPH_TARGET_SKILL_OUTCOME_SCOPE");
});

test("stable variant records must describe the runtime surfaces exactly", async () => {
  const inputs = await fixture();
  inputs.morphologyCatalog.items[0].metadata.variantRecords[0].surface = "incorrect-surface";
  assertHasCode(validate(inputs), "MORPH_VARIANT_METADATA_MISMATCH");
});

test("English cue constraints must select the exact target feature bundle", async () => {
  const inputs = await fixture();
  inputs.morphologyCatalog.cues[0].metadata.targetFeatureConstraints["cs.verb.person"] = 2;
  assertHasCode(validate(inputs), "MORPH_FEATURE_CONSTRAINT_MISMATCH");
});

test("multi-valued target features compare as exact order-independent sets", async () => {
  const inputs = await fixture();
  inputs.morphologyCatalog.items[0].features["cs.verb.polarity"] = ["affirmative", "emphatic"];
  inputs.morphologyCatalog.cues[0].metadata.targetFeatureConstraints["cs.verb.polarity"] = [
    "emphatic",
    "affirmative"
  ];
  const result = validate(inputs);
  assert.equal(result.valid, true, errorReport(result));
});

test("the Czech familiar 2sg record declares formality in the form and English cue", async () => {
  const { morphologyCatalog } = await fixture();
  const item = morphologyCatalog.items.find(({ id }) => id.endsWith(".2sg"));
  const cue = morphologyCatalog.cues.find(({ id }) => id.includes("addressee"));
  assert.equal(item.features["cs.address.formality"], "familiar");
  assert.deepEqual(item.metadata.register, ["familiar"]);
  assert.equal(Object.hasOwn(cue.metadata.canonicalFeatureValues, "address-formality"), false);
  assert.equal(cue.metadata.targetFeatureConstraints["cs.address.formality"], "familiar");
  assert.deepEqual(cue.metadata.register, ["familiar"]);
});

test("cue context dimensions remain owned by the English curriculum backbone", async (t) => {
  await t.test("a required capability dimension cannot be omitted", async () => {
    const inputs = await fixture();
    delete inputs.morphologyCatalog.cues[0].metadata.canonicalFeatureValues["time-profile"];
    assertHasCode(validate(inputs), "MORPH_CANONICAL_CONTEXT_DIMENSION_MISSING");
  });

  await t.test("a target catalog cannot invent an English context dimension", async () => {
    const inputs = await fixture();
    inputs.morphologyCatalog.cues[0].metadata.canonicalFeatureValues.polarity = "affirmative";
    assertHasCode(validate(inputs), "MORPH_CANONICAL_CONTEXT_DIMENSION_UNKNOWN");
  });

  await t.test("a shared capability cannot require a dimension absent from its canonical unit", async () => {
    const inputs = await fixture();
    inputs.mechanicCatalog.capabilities[0].requiredCanonicalContextDimensionIds.push("invented-dimension");
    inputs.morphologyCatalog.cues.forEach((cue) => {
      cue.metadata.canonicalFeatureValues["invented-dimension"] = "invented-value";
    });
    assertHasCode(validate(inputs), "MORPH_CANONICAL_CONTEXT_DIMENSION_UNKNOWN");
  });
});

test("feature constraints cannot remain ambiguous even when they happen to match the target", async () => {
  const inputs = await fixture();
  inputs.morphologyCatalog.cues[0].metadata.targetFeatureConstraints = {
    "cs.verb.number": "singular"
  };
  assertHasCode(validate(inputs), "MORPH_FEATURE_CONSTRAINT_AMBIGUOUS");
});

test("every cue needs complete English teaching fields distinct from its natural translation", async (t) => {
  await t.test("missing English field", async () => {
    const inputs = await fixture();
    delete inputs.morphologyCatalog.cues[0].presentation.roleTokenEn;
    assertHasCode(validate(inputs), "MORPH_CUE_ENGLISH_INVALID");
  });

  await t.test("teaching label is not a natural translation", async () => {
    const inputs = await fixture();
    const presentation = inputs.morphologyCatalog.cues[0].presentation;
    presentation.teachingLabelEn = presentation.naturalTranslationEn;
    assertHasCode(validate(inputs), "MORPH_CUE_ENGLISH_INVALID");
  });
});

test("revision-pinned exercise prerequisites cannot form a cycle", async () => {
  const inputs = await fixture();
  setCuePrerequisites(inputs.morphologyCatalog.cues[0], [{
    entityType: "exercise",
    id: expectedExerciseIds[2],
    revision: 2
  }]);
  assertHasCode(validate(inputs), "MORPH_PREREQUISITE_CYCLE");
});

test("sequence projections preserve exact 1sg to 2sg to 3sg cue and binding order", async (t) => {
  await t.test("source selected cue cannot drift", async () => {
    const inputs = await fixture();
    const sources = inputs.sourceCatalog.sources.filter((source) => (
      source.exerciseFamilyId === "verb-nebula.contextual-target-realization"
    ));
    sources[1].snapshot.selectedCueRef = structuredClone(sources[0].snapshot.selectedCueRef);
    assertHasCode(validate(inputs), "MORPH_SEQUENCE_SOURCE_MISMATCH");
  });

  await t.test("binding order cannot drift", async () => {
    const inputs = await fixture();
    const ordered = inputs.bindingRegistry.exerciseSequences[0].orderedBindingIds;
    [ordered[0], ordered[1]] = [ordered[1], ordered[0]];
    assertHasCode(validate(inputs), "MORPH_SEQUENCE_BINDING_MISMATCH");
  });

  await t.test("exercise prerequisites cannot skip a step", async () => {
    const inputs = await fixture();
    const third = inputs.morphologyCatalog.cues[2].metadata.exercise;
    third.prerequisiteRefs = [{
      entityType: "exercise",
      id: expectedExerciseIds[0],
      revision: 1
    }];
    assertHasCode(validate(inputs), "MORPH_SEQUENCE_INVALID");
  });
});

test("difficulty is advisory metadata and never an evidence or mastery authority", async (t) => {
  await t.test("advisory difficulty levels may change without changing the mechanic ceiling", async () => {
    const inputs = await fixture();
    inputs.morphologyCatalog.families[0].metadata.difficulty.level = 5;
    inputs.morphologyCatalog.items[0].metadata.difficulty.level = 1;
    inputs.morphologyCatalog.cues[0].metadata.difficulty.level = 4;

    const result = validate(inputs);
    assert.equal(result.valid, true, errorReport(result));
    assert.deepEqual(inputs.mechanicCatalog.capabilities[0].evidenceCeiling, {
      learningStage: "discriminate",
      evidenceKind: "comprehension",
      maximumIndependence: "independent",
      scoreRequired: true,
      masteryEligible: false
    });
  });

  await t.test("difficulty must remain explicitly advisory", async () => {
    const inputs = await fixture();
    inputs.morphologyCatalog.families[0].metadata.difficulty.advisoryOnly = false;
    assertHasCode(validate(inputs), "MORPH_DIFFICULTY_NOT_ADVISORY");
  });

  await t.test("difficulty cannot declare learning-stage or mastery evidence", async () => {
    const inputs = await fixture();
    const difficulty = inputs.morphologyCatalog.cues[0].metadata.difficulty;
    difficulty.learningStage = "retrieve";
    difficulty.masteryEligible = true;
    assertHasCode(validate(inputs), "MORPH_DIFFICULTY_EVIDENCE_AUTHORITY");
  });
});

test("human approval can never promote the permanent developer-only pilot in place", async () => {
  const inputs = await fixture();
  markEveryReviewHumanApproved(inputs.morphologyCatalog);

  const result = validate(inputs, { requireHumanApproval: true });
  assertHasCode(result, "MORPH_RELEASE_INELIGIBLE");
  assert.equal(inputs.morphologyCatalog.metadata.releasePolicy.status, "developer-only");
  assert.equal(
    inputs.morphologyCatalog.metadata.releasePolicy.requiresNewCatalogForRelease,
    true
  );
});
