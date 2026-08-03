import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  MORPHOLOGY_ROUND_SCHEMA
} from "../../../curriculum/runtime/morphology-round-core.mjs";

import {
  SHARED_MORPHOLOGY_ROUND_SCHEMA,
  VERB_EXERCISE_FAMILIES,
  VERB_EXERCISE_MODES,
  VERB_HINT_STATES,
  advanceVerbHintState,
  buildMorphologyChoiceViewModel,
  buildVerbItemRef,
  buildVerbSettlementId,
  buildVerbTaskRef,
  createVerbExerciseFamilyAdapter,
  createMorphologyFamilyRoundState,
  createVerbSettlement,
  migrateVerbMemoryToV3,
  rememberVerbSettlement,
  restoreVerbFamilyRound,
  serializeVerbFamilyRound,
  verbExerciseFamilyAvailability,
  withVerbFamilyState
} from "../../../../apps/languages/czech/static/verb-exercise-family-core.mjs";

const moduleSource = await readFile(
  new URL("../../../../apps/languages/czech/static/verb-exercise-family-core.mjs", import.meta.url),
  "utf8"
);

function morphologyRefs() {
  return {
    taskRef: buildVerbTaskRef({
      exerciseFamily: VERB_EXERCISE_FAMILIES.MORPHOLOGY,
      bindingId: "binding.verb.cist.present-person",
      taskFingerprint: "sha256:guided-task"
    }),
    itemRef: buildVerbItemRef({
      exerciseFamily: VERB_EXERCISE_FAMILIES.MORPHOLOGY,
      contentId: "cs.verb-form.cist.present-person",
      itemId: "speaker-singular"
    })
  };
}

function morphologyRound(overrides = {}) {
  const refs = morphologyRefs();
  return createMorphologyFamilyRoundState(composedMorphologyRound, {
    ...refs,
    selectedItemRef: null,
    rejectedItemRefs: [],
    hintState: VERB_HINT_STATES.AVAILABLE,
    settlementId: "",
    ...overrides
  });
}

const speakerRef = Object.freeze({ id: "form.cs.cist.1sg.present", revision: 1 });
const addresseeRef = Object.freeze({ id: "form.cs.cist.2sg.present", revision: 1 });
const otherRef = Object.freeze({ id: "form.cs.cist.3sg.present", revision: 1 });
const composedMorphologyRound = Object.freeze({
  schemaVersion: SHARED_MORPHOLOGY_ROUND_SCHEMA,
  roundId: "morph-test-round-001",
  taskFingerprint: "sha256:guided-task",
  cue: Object.freeze({
    cueRef: Object.freeze({ id: "cue.cs.cist.speaker", revision: 1 }),
    key: "read.current.speaker.singular",
    presentation: Object.freeze({
      actionConcept: "read",
      supportEn: "I am reading now.",
      timeProfile: "current"
    })
  }),
  options: Object.freeze([
    Object.freeze({ itemRef: speakerRef, surface: "\u010dtu" }),
    Object.freeze({ itemRef: addresseeRef, surface: "\u010dte\u0161" }),
    Object.freeze({ itemRef: otherRef, surface: "\u010dte" })
  ]),
  targetItemRef: speakerRef
});

const morphologyViewOptions = Object.freeze({
  instruction: "Choose the Czech form for the English cue.",
  choiceGroupLabel: "Czech present-tense forms",
  hintText: "Use the speaker-singular form."
});

test("keeps the morphology family behind an explicit developer Guided gate", () => {
  assert.equal(SHARED_MORPHOLOGY_ROUND_SCHEMA, MORPHOLOGY_ROUND_SCHEMA);
  assert.equal(
    verbExerciseFamilyAvailability("meaning", { mode: "explore" }).available,
    true
  );
  assert.deepEqual(
    verbExerciseFamilyAvailability("morphology", {
      mode: "guided",
      developerMode: false
    }),
    {
      exerciseFamily: "morphology",
      mode: "guided",
      available: false,
      developerOnly: true,
      reason: "developer-guided-only"
    }
  );
  assert.equal(
    verbExerciseFamilyAvailability("morphology", {
      mode: "explore",
      developerMode: true
    }).available,
    false
  );
  assert.equal(
    verbExerciseFamilyAvailability("morphology", {
      mode: "guided",
      developerMode: true
    }).available,
    true
  );
  assert.throws(
    () => createVerbExerciseFamilyAdapter({
      exerciseFamily: "morphology",
      mode: "guided",
      developerMode: false
    }),
    (error) => error.code === "VERB_EXERCISE_FAMILY_UNAVAILABLE"
  );
});

test("keeps the family core isolated from storage, DOM, and learner reward globals", () => {
  assert.doesNotMatch(moduleSource, /\b(?:window|document|localStorage|sessionStorage)\b/u);
  assert.doesNotMatch(moduleSource, /CaatuuLearning|recordVerbSemanticAttempt/u);
});

test("purely migrates verbMemory v2 into a family-scoped v3 envelope", () => {
  const legacy = {
    schemaVersion: 2,
    difficulty: 2,
    knownPairIds: ["core-verb-1", "core-verb-2", "core-verb-3"],
    pairCount: 2,
    queueIds: ["core-verb-3"],
    roundIds: ["core-verb-1", "core-verb-2"],
    englishRoundIds: ["core-verb-2", "core-verb-1"],
    matchedIds: ["core-verb-1"],
    hintsEnabled: true,
    roundNumber: 7,
    stats: { attempts: 9, matches: 6, rounds: 3 },
    futureMeaningField: { retained: true }
  };
  const untouched = structuredClone(legacy);
  const migrated = migrateVerbMemoryToV3(legacy);

  assert.deepEqual(legacy, untouched, "migration must not mutate v2 input");
  assert.equal(migrated.schemaVersion, 3);
  assert.equal(migrated.activeFamily, "meaning");
  assert.equal(migrated.families.morphology, null);
  assert.deepEqual(migrated.settlementIds, []);
  assert.deepEqual(migrated.families.meaning, {
    difficulty: 2,
    knownPairIds: ["core-verb-1", "core-verb-2", "core-verb-3"],
    pairCount: 2,
    queueIds: ["core-verb-3"],
    roundNumber: 7,
    stats: { attempts: 9, matches: 6, rounds: 3 },
    futureMeaningField: { retained: true },
    round: {
      schemaVersion: 1,
      exerciseFamily: "meaning",
      roundIds: ["core-verb-1", "core-verb-2"],
      englishRoundIds: ["core-verb-2", "core-verb-1"],
      matchedIds: ["core-verb-1"],
      hintsEnabled: true
    }
  });
  assert.deepEqual(migrateVerbMemoryToV3(migrated), migrated);
  assert.throws(
    () => migrateVerbMemoryToV3({ schemaVersion: 4 }),
    (error) => error.code === "VERB_MEMORY_SCHEMA_UNSUPPORTED"
  );
});

test("serializes meaning and morphology rounds with non-interchangeable tags", () => {
  const meaning = serializeVerbFamilyRound("meaning", {
    roundIds: ["verb-a", "verb-b"],
    englishRoundIds: ["verb-b", "verb-a"],
    matchedIds: ["verb-a"],
    hintsEnabled: true
  });
  const morphology = morphologyRound();

  assert.equal(restoreVerbFamilyRound(meaning, "meaning").exerciseFamily, "meaning");
  assert.equal(
    restoreVerbFamilyRound(morphology, "morphology").exerciseFamily,
    "morphology"
  );
  assert.throws(
    () => restoreVerbFamilyRound(meaning, "morphology"),
    (error) => error.code === "VERB_FAMILY_ROUND_MISMATCH"
  );
  assert.throws(
    () => serializeVerbFamilyRound("morphology", {
      ...morphology,
      selectedItemRef: { id: "form.cs.cist.not-in-round", revision: 1 }
    }),
    (error) => error.code === "VERB_FAMILY_ROUND_REFERENCE_INVALID"
  );
});

test("stores each family independently without changing migrated meaning progress", () => {
  const migrated = migrateVerbMemoryToV3({
    schemaVersion: 2,
    difficulty: 1,
    knownPairIds: ["verb-a", "verb-b"],
    pairCount: 2,
    queueIds: [],
    roundIds: ["verb-a", "verb-b"],
    englishRoundIds: ["verb-b", "verb-a"],
    matchedIds: [],
    hintsEnabled: false,
    roundNumber: 1,
    stats: { attempts: 0, matches: 0, rounds: 0 }
  });
  const originalMeaning = structuredClone(migrated.families.meaning);
  const updated = withVerbFamilyState(migrated, "morphology", {
    catalogRevision: "cs-morphology-v1",
    roundNumber: 1,
    stats: { attempts: 0, correct: 0 },
    round: morphologyRound()
  });

  assert.equal(updated.activeFamily, "morphology");
  assert.deepEqual(updated.families.meaning, originalMeaning);
  assert.equal(updated.families.morphology.round.exerciseFamily, "morphology");
  assert.equal(migrated.families.morphology, null, "updates must not mutate prior memory");
});

test("recovers valid meaning memory when the morphology family is malformed", () => {
  const withBothFamilies = withVerbFamilyState(
    migrateVerbMemoryToV3({
      schemaVersion: 2,
      difficulty: 1,
      roundIds: ["verb-a", "verb-b"],
      englishRoundIds: ["verb-b", "verb-a"],
      matchedIds: ["verb-a"],
      hintsEnabled: false
    }),
    "morphology",
    {
      catalogRevision: "cs-morphology-v1",
      round: morphologyRound()
    }
  );
  const expectedMeaning = structuredClone(withBothFamilies.families.meaning);
  const corrupted = structuredClone(withBothFamilies);
  corrupted.families.morphology.round.exerciseFamily = "meaning";

  const recovered = migrateVerbMemoryToV3(corrupted);
  assert.deepEqual(recovered.families.meaning, expectedMeaning);
  assert.equal(recovered.families.morphology, null);
});

test("recovers valid morphology memory when the meaning family is malformed", () => {
  const withBothFamilies = withVerbFamilyState(
    migrateVerbMemoryToV3({
      schemaVersion: 2,
      difficulty: 1,
      roundIds: ["verb-a", "verb-b"],
      englishRoundIds: ["verb-b", "verb-a"],
      matchedIds: [],
      hintsEnabled: true
    }),
    "morphology",
    {
      catalogRevision: "cs-morphology-v1",
      round: morphologyRound()
    }
  );
  const expectedMorphology = structuredClone(withBothFamilies.families.morphology);
  const corrupted = structuredClone(withBothFamilies);
  corrupted.families.meaning.round.exerciseFamily = "morphology";

  const recovered = migrateVerbMemoryToV3(corrupted);
  assert.equal(recovered.families.meaning, null);
  assert.deepEqual(recovered.families.morphology, expectedMorphology);
});

test("builds stable task, item, and first-response settlement references", () => {
  const taskRef = buildVerbTaskRef({
    exerciseFamily: "morphology",
    bindingId: "binding.verb.cist",
    taskFingerprint: "task-1"
  });
  const firstItemRef = buildVerbItemRef({
    exerciseFamily: "morphology",
    contentId: "cs.verb.cist",
    itemId: "speaker-singular"
  });
  const secondItemRef = buildVerbItemRef({
    exerciseFamily: "morphology",
    contentId: "cs.verb.cist",
    itemId: "speaker-singular"
  });
  assert.equal(firstItemRef, secondItemRef);
  assert.throws(
    () => buildVerbItemRef({
      exerciseFamily: "morphology",
      contentId: "cs.\u010dist",
      itemId: "speaker-singular"
    }),
    (error) => error.code === "VERB_FAMILY_REFERENCE_PART_INVALID"
  );

  const first = buildVerbSettlementId({
    exerciseFamily: "morphology",
    taskRef,
    itemRef: firstItemRef
  });
  const retried = buildVerbSettlementId({
    exerciseFamily: "morphology",
    taskRef,
    itemRef: firstItemRef
  });
  const otherItem = buildVerbItemRef({
    exerciseFamily: "morphology",
    contentId: "cs.verb.cist",
    itemId: "addressee-singular"
  });
  assert.equal(first, retried);
  assert.notEqual(first, buildVerbSettlementId({
    exerciseFamily: "morphology",
    taskRef,
    itemRef: otherItem
  }));
  assert.throws(
    () => buildVerbSettlementId({
      exerciseFamily: "meaning",
      taskRef,
      itemRef: firstItemRef
    }),
    (error) => error.code === "VERB_FAMILY_REFERENCE_MISMATCH"
  );
});

test("suppresses Guided XP and deduplicates a retried settlement", () => {
  const adapter = createVerbExerciseFamilyAdapter({
    exerciseFamily: VERB_EXERCISE_FAMILIES.MORPHOLOGY,
    mode: VERB_EXERCISE_MODES.GUIDED,
    developerMode: true
  });
  const refs = morphologyRefs();
  const settlement = adapter.settle({
    ...refs,
    responseId: "form.cs.cist.1sg.present@1",
    correct: true,
    requestedXp: 99
  });
  assert.equal(settlement.awardedXp, 0);
  assert.equal(settlement.requestedXp, 99);
  assert.equal(settlement.xpSuppressed, true);
  assert.equal(
    adapter.settle({ ...refs, responseId: "form.cs.cist.1sg.present@1" }).settlementId,
    settlement.settlementId
  );

  const first = rememberVerbSettlement(null, settlement);
  const retry = rememberVerbSettlement(first.memory, settlement);
  assert.equal(first.duplicate, false);
  assert.equal(retry.duplicate, true);
  assert.deepEqual(retry.memory.settlementIds, [settlement.settlementId]);

  const meaningTaskRef = buildVerbTaskRef({
    exerciseFamily: "meaning",
    bindingId: "meaning-binding",
    taskFingerprint: "meaning-task"
  });
  const meaningItemRef = buildVerbItemRef({
    exerciseFamily: "meaning",
    contentId: "cs.verb.cist.read",
    itemId: "pair"
  });
  assert.equal(createVerbSettlement({
    exerciseFamily: "meaning",
    mode: "explore",
    taskRef: meaningTaskRef,
    itemRef: meaningItemRef,
    requestedXp: 3
  }).awardedXp, 3);
});

test("keeps hint and solution support states sticky", () => {
  assert.equal(
    advanceVerbHintState(VERB_HINT_STATES.AVAILABLE, "show-hint"),
    VERB_HINT_STATES.USED
  );
  assert.equal(
    advanceVerbHintState(VERB_HINT_STATES.USED, "show-hint"),
    VERB_HINT_STATES.USED
  );
  assert.equal(
    advanceVerbHintState(VERB_HINT_STATES.USED, "reveal-solution"),
    VERB_HINT_STATES.SOLUTION_REVEALED
  );
  assert.equal(
    advanceVerbHintState(VERB_HINT_STATES.SOLUTION_REVEALED, "show-hint"),
    VERB_HINT_STATES.SOLUTION_REVEALED
  );
});

test("builds one accessible cue with reusable choices without leaking the answer", () => {
  const available = buildMorphologyChoiceViewModel(
    composedMorphologyRound,
    morphologyRound(),
    morphologyViewOptions
  );
  assert.equal(available.exerciseFamily, "morphology");
  assert.deepEqual(available.cue, {
    id: "cue.cs.cist.speaker@1",
    cueRef: { id: "cue.cs.cist.speaker", revision: 1 },
    text: "I am reading now.",
    language: "en",
    ariaLabel: "Cue: I am reading now."
  });
  assert.equal(available.choiceGroup.role, "group");
  assert.equal(available.choiceGroup.reusable, true);
  assert.equal(available.choiceGroup.choices.length, 3);
  assert.deepEqual(
    available.choiceGroup.choices.map((choice) => choice.correct),
    [null, null, null]
  );
  assert.equal(available.choiceGroup.choices.every((choice) => !choice.disabled), true);
  assert.deepEqual(
    available.choiceGroup.choices.map((choice) => choice.stateDescription),
    ["", "", ""]
  );
  assert.equal(
    available.choiceGroup.choices.every((choice) => (
      !Object.hasOwn(choice, "ariaPressed") && !Object.hasOwn(choice, "ariaLabel")
    )),
    true
  );
  assert.equal(available.hint.actionLabel, "Show hint");
  assert.equal(available.hint.text, "");
  assert.deepEqual(available.status, { role: "status", ariaLive: "polite", message: "" });

  const hinted = buildMorphologyChoiceViewModel(
    composedMorphologyRound,
    morphologyRound({ hintState: VERB_HINT_STATES.USED }),
    morphologyViewOptions
  );
  assert.equal(hinted.hint.used, true);
  assert.equal(hinted.hint.text, "Use the speaker-singular form.");
  assert.deepEqual(
    hinted.choiceGroup.choices.map((choice) => choice.correct),
    [null, null, null]
  );

  const refs = morphologyRefs();
  const wrongSettlement = createVerbSettlement({
    exerciseFamily: "morphology",
    mode: "guided",
    ...refs,
    responseId: "form.cs.cist.2sg.present@1",
    correct: false
  });
  const wrong = buildMorphologyChoiceViewModel(
    composedMorphologyRound,
    morphologyRound({
      selectedItemRef: addresseeRef,
      rejectedItemRefs: [addresseeRef],
      settlementId: wrongSettlement.settlementId
    }),
    morphologyViewOptions
  );
  assert.equal(wrong.evidenceSettled, true);
  assert.equal(wrong.completed, false);
  assert.equal(wrong.interactionLocked, false);
  assert.equal(wrong.status.message, "Not quite. Try another form.");
  assert.doesNotMatch(wrong.status.message, /\u010dtu/u);
  assert.deepEqual(wrong.choiceGroup.choices.map((choice) => choice.correct), [null, null, null]);
  assert.equal(wrong.choiceGroup.choices.every((choice) => !choice.disabled), true);
  assert.equal(
    wrong.choiceGroup.choices.find((choice) => choice.state === "rejected").stateDescription,
    "Previously tried."
  );
  assert.equal(wrong.focusTarget, "choice-group");

  const corrected = buildMorphologyChoiceViewModel(
    composedMorphologyRound,
    morphologyRound({
      selectedItemRef: speakerRef,
      rejectedItemRefs: [addresseeRef],
      completed: true,
      settlementId: wrongSettlement.settlementId
    }),
    morphologyViewOptions
  );
  assert.equal(corrected.evidenceSettled, true);
  assert.equal(corrected.completed, true);
  assert.equal(corrected.interactionLocked, true);
  assert.equal(
    corrected.choiceGroup.choices.filter((choice) => choice.correct === true).length,
    1
  );
  assert.equal(
    corrected.choiceGroup.choices.find((choice) => choice.correct === true).stateDescription,
    "Correct."
  );
  assert.match(corrected.status.message, /\u010dtu/u);

  const revealed = buildMorphologyChoiceViewModel(
    composedMorphologyRound,
    morphologyRound({
      selectedItemRef: addresseeRef,
      rejectedItemRefs: [addresseeRef],
      hintState: VERB_HINT_STATES.SOLUTION_REVEALED,
      completed: true,
      settlementId: buildVerbSettlementId({
        exerciseFamily: "morphology",
        ...refs,
        kind: "solution-reveal"
      })
    }),
    morphologyViewOptions
  );
  assert.equal(revealed.hint.solutionRevealed, true);
  assert.equal(revealed.choiceGroup.choices.filter((choice) => choice.correct === true).length, 1);
  assert.equal(
    revealed.choiceGroup.choices.find((choice) => choice.correct === true).stateDescription,
    "Correct."
  );
  assert.match(revealed.status.message, /\u010dtu/u);
  assert.equal(revealed.focusTarget, "status");
  assert.throws(
    () => morphologyRound({ hintState: VERB_HINT_STATES.SOLUTION_REVEALED }),
    (error) => error.code === "VERB_MORPHOLOGY_COMPLETION_REQUIRED"
  );
});

test("fails closed when persisted morphology content no longer matches", () => {
  const changedRound = structuredClone(composedMorphologyRound);
  changedRound.options.reverse();
  assert.throws(
    () => buildMorphologyChoiceViewModel(
      changedRound,
      morphologyRound(),
      morphologyViewOptions
    ),
    (error) => error.code === "VERB_MORPHOLOGY_CONTENT_DRIFT"
  );
});
