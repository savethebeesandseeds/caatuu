import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  aggregateLearningEvidence,
  computeBindingRegistryDigest,
  computeCanonicalContractDigest,
  computeContentDigest,
  computeSourceCatalogDigest,
  computeTargetPackDigest,
  createLearningEvidenceEvent,
  issueLearningTask,
  resolveRuntimeBinding,
  validateLearningEvidenceEvent,
  validateLearningTask,
  validateRuntimeBundle
} from "../runtime/curriculum-runtime-core.mjs";

const dataUrl = new URL("../data/", import.meta.url);
const MORPHOLOGY_CONTENT = "cs.morphology.cist.present-singular-person.1sg";
const MORPHOLOGY_BINDING = "binding.conjugation-comet.cs.morphology.cist.present-singular-person.1sg";
const MORPHOLOGY_CAPABILITY = "independent-form-discrimination";
const MORPHOLOGY_SKILL = "cs.skill.form.cist.present-singular-person";
const MEANING_BINDING = "binding.verb-nebula.cs.verb.cist.read";
const MEANING_CAPABILITY = "independent-discrimination";
const MEANING_SKILL = "cs.skill.sense.cist.read";

async function readJson(name) {
  return JSON.parse(await readFile(new URL(name, dataUrl), "utf8"));
}

async function fixture() {
  const [curriculum, targetPack, sourceCatalog, bindingRegistry] = await Promise.all([
    readJson("canonical-curriculum.v1.en.json"),
    readJson("cs-CZ.realization-pack.v1.json"),
    readJson("pilot-content-sources.v1.json"),
    readJson("cs-CZ.cross-game-bindings.v1.json")
  ]);
  const bundle = { curriculum, targetPack, sourceCatalog, bindingRegistry };
  const releasePins = {
    curriculumId: curriculum.curriculumId,
    curriculumVersion: curriculum.version,
    canonicalContractDigest: await computeCanonicalContractDigest(curriculum),
    targetPackId: targetPack.packId,
    targetPackVersion: targetPack.version,
    targetLocale: targetPack.targetLocale,
    targetPackDigest: await computeTargetPackDigest(targetPack),
    sourceCatalogId: sourceCatalog.catalogId,
    sourceCatalogVersion: sourceCatalog.version,
    sourceCatalogDigest: await computeSourceCatalogDigest(sourceCatalog),
    bindingRegistryId: bindingRegistry.registryId,
    bindingRegistryVersion: bindingRegistry.version,
    bindingRegistryDigest: await computeBindingRegistryDigest(bindingRegistry)
  };
  return { bundle, releasePins };
}

async function authorSyntheticMorphologySequenceLength(bundle, length) {
  const sequence = bundle.bindingRegistry.exerciseSequences[0];
  const orderedBindingIds = [...sequence.orderedBindingIds];
  if (length === 2) {
    const removedBindingIds = new Set(orderedBindingIds.splice(2));
    const removedContentIds = new Set(bundle.bindingRegistry.bindings
      .filter((binding) => removedBindingIds.has(binding.id))
      .map((binding) => binding.contentRef.contentId));
    bundle.bindingRegistry.bindings = bundle.bindingRegistry.bindings.filter((binding) => (
      !removedBindingIds.has(binding.id)
    ));
    bundle.sourceCatalog.sources = bundle.sourceCatalog.sources.filter((source) => (
      !removedContentIds.has(source.contentId)
    ));
  } else if (length === 4) {
    const templateBinding = bundle.bindingRegistry.bindings.find((binding) => binding.id === orderedBindingIds[2]);
    const templateSource = bundle.sourceCatalog.sources.find((source) => (
      source.contentId === templateBinding.contentRef.contentId
    ));
    const binding = structuredClone(templateBinding);
    const source = structuredClone(templateSource);
    binding.id = `${binding.id}.synthetic-step-4`;
    source.contentId = `${source.contentId}.synthetic-step-4`;
    source.snapshot.id = source.contentId;
    source.snapshot.sequenceStep = 4;
    source.snapshot.difficulty.rationaleEn = "Synthetic fourth step used to verify authored sequence cardinality.";
    source.contentDigest = await computeContentDigest(source);
    binding.contentRef.contentId = source.contentId;
    binding.contentRef.contentDigest = source.contentDigest;
    bundle.bindingRegistry.bindings.push(binding);
    bundle.sourceCatalog.sources.push(source);
    orderedBindingIds.push(binding.id);
  }
  sequence.orderedBindingIds = orderedBindingIds;
}

async function issue(bundle, {
  taskId,
  bindingId,
  capabilityId,
  targetSkillId,
  taskSequence
}) {
  return issueLearningTask(bundle.bindingRegistry, {
    taskId,
    issuedAt: `2026-08-02T10:0${taskSequence}:00.000Z`,
    sessionId: "session.morphology-separation",
    taskSequence,
    bindingId,
    capabilityId,
    targetSkillId
  });
}

test("runtime resolves the developer morphology family as a separate supplemental skill", async () => {
  const { bundle, releasePins } = await fixture();
  const validation = await validateRuntimeBundle(bundle, releasePins);
  assert.equal(validation.valid, true, JSON.stringify(validation.errors, null, 2));

  const resolution = resolveRuntimeBinding(bundle, "conjugation-comet", MORPHOLOGY_CONTENT);
  assert.equal(resolution.binding.id, MORPHOLOGY_BINDING);
  assert.equal(
    resolution.binding.exerciseFamilyId,
    "conjugation-comet.contextual-target-realization"
  );
  assert.equal(resolution.source.snapshot.familyRef.id, "cs.morphology.family.cist.present-singular");
  assert.equal(resolution.source.snapshot.itemRefs.length, 3);
  assert.equal(resolution.source.snapshot.cueRefs.length, 3);
  assert.deepEqual(resolution.source.snapshot.selectedCueRef, {
    id: "cs.cue.cist.read.speaker-singular-current",
    revision: 1
  });
  assert.equal(resolution.source.snapshot.sequenceStep, 1);
  assert.deepEqual(resolution.binding.targetSkillRefs, [{ id: MORPHOLOGY_SKILL, revision: 1 }]);
  assert.equal(resolution.skills[0].requiredForOutcome, false);
  assert.equal(
    bundle.bindingRegistry.aggregationGroups.some((group) => group.targetSkillRef.id === MORPHOLOGY_SKILL),
    false
  );
});

test("the former Verb Nebula activity cannot resolve Conjugation Comet content", async () => {
  const { bundle } = await fixture();
  assert.throws(
    () => resolveRuntimeBinding(bundle, "verb-nebula", MORPHOLOGY_CONTENT),
    /Expected one binding for verb-nebula\/cs\.morphology\.cist\.present-singular-person\.1sg; found 0\./
  );
});

test("runtime preserves the authored morphology binding sequence exactly", async () => {
  const { bundle, releasePins } = await fixture();
  const validation = await validateRuntimeBundle(bundle, releasePins);
  assert.equal(validation.valid, true, JSON.stringify(validation.errors, null, 2));
  const sequence = bundle.bindingRegistry.exerciseSequences[0];
  assert.deepEqual(sequence.orderedBindingIds, [
    "binding.conjugation-comet.cs.morphology.cist.present-singular-person.1sg",
    "binding.conjugation-comet.cs.morphology.cist.present-singular-person.2sg",
    "binding.conjugation-comet.cs.morphology.cist.present-singular-person.3sg"
  ]);
  assert.deepEqual(
    sequence.orderedBindingIds.map((bindingId) => {
      const binding = bundle.bindingRegistry.bindings.find(({ id }) => id === bindingId);
      const source = bundle.sourceCatalog.sources.find(({ contentId }) => (
        contentId === binding.contentRef.contentId
      ));
      return [source.snapshot.sequenceStep, source.snapshot.selectedCueRef.id];
    }),
    [
      [1, "cs.cue.cist.read.speaker-singular-current"],
      [2, "cs.cue.cist.read.addressee-singular-current"],
      [3, "cs.cue.cist.read.named-third-person-current"]
    ]
  );
});

test("runtime accepts authored two-step and four-step morphology sequences", async () => {
  for (const length of [2, 4]) {
    const { bundle, releasePins } = await fixture();
    await authorSyntheticMorphologySequenceLength(bundle, length);
    releasePins.sourceCatalogDigest = await computeSourceCatalogDigest(bundle.sourceCatalog);
    releasePins.bindingRegistryDigest = await computeBindingRegistryDigest(bundle.bindingRegistry);
    const validation = await validateRuntimeBundle(bundle, releasePins);
    assert.equal(validation.valid, true, `${length} steps: ${JSON.stringify(validation.errors, null, 2)}`);
    assert.equal(bundle.bindingRegistry.exerciseSequences[0].orderedBindingIds.length, length);
  }
});

test("visible form choices record comprehension but never meaning or mastery", async () => {
  const { bundle } = await fixture();
  const morphologyTask = await issue(bundle, {
    taskId: "task.morphology.1",
    bindingId: MORPHOLOGY_BINDING,
    capabilityId: MORPHOLOGY_CAPABILITY,
    targetSkillId: MORPHOLOGY_SKILL,
    taskSequence: 1
  });
  const meaningTask = await issue(bundle, {
    taskId: "task.meaning.1",
    bindingId: MEANING_BINDING,
    capabilityId: MEANING_CAPABILITY,
    targetSkillId: MEANING_SKILL,
    taskSequence: 2
  });
  const taskValidation = await validateLearningTask(
    bundle.curriculum,
    bundle.bindingRegistry,
    morphologyTask
  );
  assert.equal(taskValidation.valid, true, JSON.stringify(taskValidation.errors, null, 2));

  const morphologyEvent = await createLearningEvidenceEvent(morphologyTask, {
    eventId: "event.morphology.1",
    occurredAt: "2026-08-02T10:01:30.000Z",
    attemptNumber: 1,
    score: 1,
    solutionRevealed: false,
    hintsUsed: 0
  });
  const meaningEvent = await createLearningEvidenceEvent(meaningTask, {
    eventId: "event.meaning.1",
    occurredAt: "2026-08-02T10:02:30.000Z",
    attemptNumber: 1,
    score: 1,
    solutionRevealed: false,
    hintsUsed: 0
  });
  const eventValidation = await validateLearningEvidenceEvent(
    bundle.curriculum,
    bundle.bindingRegistry,
    morphologyTask,
    morphologyEvent
  );
  assert.equal(eventValidation.valid, true, JSON.stringify(eventValidation.errors, null, 2));
  assert.equal(eventValidation.qualifiesForIndependentAssessment, true);
  assert.equal(eventValidation.qualifiesForMastery, false);

  const summaries = await aggregateLearningEvidence(
    bundle.curriculum,
    bundle.bindingRegistry,
    [morphologyTask, meaningTask],
    [morphologyEvent, meaningEvent]
  );
  assert.deepEqual(
    summaries.map((summary) => summary.targetSkillId).sort(),
    [MEANING_SKILL, MORPHOLOGY_SKILL].sort()
  );
  const morphologySummary = summaries.find((summary) => summary.targetSkillId === MORPHOLOGY_SKILL);
  const meaningSummary = summaries.find((summary) => summary.targetSkillId === MEANING_SKILL);
  assert.equal(morphologySummary.assessedAttempts, 1);
  assert.equal(morphologySummary.masteryReady, false);
  assert.equal(meaningSummary.assessedAttempts, 1);
  assert.equal(meaningSummary.masteryReady, false);
});

test("runtime fails closed if a binding changes exercise family independently of its source", async () => {
  const { bundle, releasePins } = await fixture();
  const changed = structuredClone(bundle);
  const binding = changed.bindingRegistry.bindings.find((row) => row.id === MORPHOLOGY_BINDING);
  binding.exerciseFamilyId = "verb-nebula.meaning-match";
  const repinned = {
    ...releasePins,
    bindingRegistryDigest: await computeBindingRegistryDigest(changed.bindingRegistry)
  };
  const validation = await validateRuntimeBundle(changed, repinned);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((entry) => entry.code === "RUNTIME_BINDING_CONTENT_MISMATCH"));
});
