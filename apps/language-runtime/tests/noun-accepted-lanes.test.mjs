import assert from "node:assert/strict";
import test from "node:test";
import {
  NOUN_LANDING_SCHEMA_VERSION, normalizeNounLandingPack, createNounLandingSession,
  startNounLanding, selectNounLane, landNoun, advanceNounFall, nextNoun
} from "../static/source/games/grammar-gravity/noun-landing-core.mjs";

const expected = { courseId: "nb", learnerBaseLanguage: "en", targetLanguage: "nb-NO" };
function fixture() {
  return {
    schemaVersion: NOUN_LANDING_SCHEMA_VERSION, courseId: "nb", gameId: "grammar-gravity",
    contentId: "nb.nouns.fixture-v1", contentRevision: 1,
    learnerBaseLanguage: "en", targetLanguage: "nb-NO", englishAuditLanguage: "en",
    review: { status: "native-review-required", reviewer: null, reviewedAt: null, notes: "Synthetic test fixture." },
    license: { origin: "synthetic-fixture", status: "release-review-required", spdxExpression: null, notes: "Not curriculum." },
    scope: "Bokmål nouns with authored alternatives; laneId names the preferred teaching form.",
    lanes: [{ id: "masculine", label: "Masculine" }, { id: "feminine", label: "Feminine" }, { id: "neuter", label: "Neuter" }],
    items: [
      { id: "nb.noun.book", revision: 1, difficulty: 1, targetText: "bok", learnerBaseText: "book", english: "book",
        laneId: "feminine", acceptedLaneIds: ["feminine", "masculine"] },
      { id: "nb.noun.car", revision: 1, difficulty: 2, targetText: "bil", learnerBaseText: "car", english: "car", laneId: "masculine" },
      { id: "nb.noun.house", revision: 1, difficulty: 3, targetText: "hus", learnerBaseText: "house", english: "house", laneId: "neuter" }
    ]
  };
}
function falling(raw = fixture(), options = {}) {
  return startNounLanding(createNounLandingSession(normalizeNounLandingPack(raw, expected), {
    random: () => 0.999, difficulty: 3, ...options
  }));
}

test("optional noun alternatives are normalized, copied and deeply frozen", () => {
  const raw = fixture();
  const before = structuredClone(raw);
  const pack = normalizeNounLandingPack(raw, expected);
  assert.deepEqual(raw, before);
  assert.deepEqual(pack.items[0].acceptedLaneIds, ["feminine", "masculine"]);
  assert.notEqual(pack.items[0].acceptedLaneIds, raw.items[0].acceptedLaneIds);
  assert.ok(Object.isFrozen(pack.items[0].acceptedLaneIds));
  assert.throws(() => pack.items[0].acceptedLaneIds.push("neuter"), TypeError);
  assert.equal(Object.hasOwn(pack.items[1], "acceptedLaneIds"), false);
  assert.equal(pack.items[0].laneId, "feminine");
});

test("noun alternatives reject empty, duplicate, undeclared, missing-canonical and malformed lanes", () => {
  for (const accepted of [[], null, "masculine", ["masculine"], ["feminine", "feminine"],
    ["feminine", "common"], ["feminine", 1], ["feminine", ""], ["feminine", null],
    ["feminine", "Masculine"], ["feminine", ...new Array(1)]]) {
    const raw = fixture();
    raw.items[0].acceptedLaneIds = accepted;
    assert.throws(() => normalizeNounLandingPack(raw, expected), /acceptedLaneIds/u, JSON.stringify(accepted));
  }
});

test("either authored Bokmål gender earns the same credit and retains normal timing and queue behavior", () => {
  for (const laneId of ["feminine", "masculine"]) {
    const state = falling();
    const selected = selectNounLane(state, laneId);
    const manual = landNoun(selected);
    const timed = advanceNounFall(selected, 10000);
    assert.deepEqual(timed, manual);
    assert.equal(manual.correct, true);
    assert.equal(manual.correctCount, 1);
    assert.equal(manual.streak, 1);
    assert.equal(manual.attempts, 1);
    assert.equal(manual.completed, 1);
    assert.equal(manual.selectedLane, laneId);
    assert.equal(manual.item.laneId, "feminine");
    assert.equal(manual.queue.length, 2);
    assert.equal(landNoun(manual), manual);
    assert.equal(nextNoun(manual).item.id, "nb.noun.car");
  }
});

test("unaccepted or missing noun choices still fail and keep the existing single retry", () => {
  for (const laneId of ["neuter", null]) {
    const state = falling();
    const selected = laneId ? selectNounLane(state, laneId) : state;
    const feedback = landNoun(selected);
    assert.equal(feedback.correct, false);
    assert.equal(feedback.correctCount, 0);
    assert.equal(feedback.streak, 0);
    assert.equal(feedback.queue.length, 3);
    assert.equal(feedback.queue.at(-1).id, state.item.id);
  }
});

test("absent alternatives retain exact single-lane judgments and optional single canonical entry is equivalent", () => {
  const raw = fixture();
  delete raw.items[0].acceptedLaneIds;
  const canonical = falling(raw);
  for (const laneId of ["feminine", "masculine", "neuter"]) {
    const result = landNoun(selectNounLane(canonical, laneId));
    assert.equal(result.correct, laneId === "feminine");
    const explicit = structuredClone(raw);
    explicit.items[0].acceptedLaneIds = ["feminine"];
    const explicitResult = landNoun(selectNounLane(falling(explicit), laneId));
    for (const key of ["correct", "correctCount", "streak", "attempts", "completed", "elapsedMs"]) {
      assert.equal(explicitResult[key], result[key], key);
    }
  }
  assert.equal(createNounLandingSession(normalizeNounLandingPack(fixture(), expected), { difficulty: 1 }).total, 1);
});
