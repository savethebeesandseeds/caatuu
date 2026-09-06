import assert from "node:assert/strict";
import test from "node:test";

import {
  NOUN_LANDING_SCHEMA_VERSION, normalizeNounLandingPack, createNounLandingSession,
  startNounLanding, selectNounLane, advanceNounFall, landNoun, nextNoun, setNounFallDuration
} from "../static/source/games/grammar-gravity/noun-landing-core.mjs";

const expected = { courseId: "es", learnerBaseLanguage: "en", targetLanguage: "es-ES" };

function fixture() {
  return {
    schemaVersion: NOUN_LANDING_SCHEMA_VERSION,
    courseId: "es", gameId: "grammar-gravity", contentId: "es.nouns.fixture-v1", contentRevision: 1,
    learnerBaseLanguage: "en", targetLanguage: "es-ES", englishAuditLanguage: "en",
    review: { status: "native-review-required", reviewer: null, reviewedAt: null, notes: "Test fixture, not approved curriculum." },
    license: { origin: "caatuu-authored", status: "release-review-required", spdxExpression: null, notes: "Test fixture." },
    scope: "Singular nouns; authored grammatical gender.",
    lanes: [{ id: "masculine", label: "Masculine" }, { id: "feminine", label: "Feminine" }],
    items: [
      { id: "es.noun.mapa", revision: 1, targetText: "mapa", learnerBaseText: "map", english: "map", laneId: "masculine" },
      { id: "es.noun.mano", revision: 1, targetText: "mano", learnerBaseText: "hand", english: "hand", laneId: "feminine" },
      { id: "es.noun.cafe", revision: 1, targetText: "café", learnerBaseText: "coffee", english: "coffee", laneId: "masculine" }
    ]
  };
}

function session(options) {
  return createNounLandingSession(normalizeNounLandingPack(fixture(), expected), { random: () => 0.999, ...options });
}

function answer(state, laneId = state.item.laneId) {
  return landNoun(selectNounLane(state, laneId));
}

test("normalization retains explicit language-owned lanes and English audit text without freezing or changing the input", () => {
  const raw = fixture();
  const before = structuredClone(raw);
  const pack = normalizeNounLandingPack(raw, expected);
  assert.deepEqual(raw, before);
  assert.equal(Object.isFrozen(raw), false);
  assert.notEqual(pack, raw);
  assert.ok(Object.isFrozen(pack.items[0]));
  assert.ok(Object.isFrozen(pack.lanes));
  assert.equal(pack.items[0].laneId, "masculine");
  assert.equal(pack.items[1].laneId, "feminine");
  assert.equal(pack.items[0].english, "map");
  assert.throws(() => { pack.items[0].laneId = "feminine"; }, TypeError);
});

test("course, language, schema and canonical English authority mismatches fail closed", () => {
  for (const [field, value] of [
    ["schemaVersion", "old"], ["gameId", "another-game"], ["courseId", "cz"],
    ["learnerBaseLanguage", "es"], ["targetLanguage", "cs-CZ"], ["englishAuditLanguage", "es"],
    ["contentId", "bad id"], ["contentRevision", 0], ["targetLanguage", "not_a_locale"]
  ]) {
    const raw = fixture();
    raw[field] = value;
    assert.throws(() => normalizeNounLandingPack(raw, expected), undefined, field);
  }
  assert.throws(() => normalizeNounLandingPack(fixture()), /expected courseId/);
  const raw = fixture();
  raw.targetLanguage = "ES-es";
  assert.equal(normalizeNounLandingPack(raw, expected).targetLanguage, "es-ES");
});

test("non-English-base content still requires independently authored English on every noun", () => {
  const raw = fixture();
  raw.courseId = "fr-es";
  raw.learnerBaseLanguage = "fr";
  raw.items.forEach((item, index) => { item.learnerBaseText = ["carte", "main", "café"][index]; });
  const options = { ...expected, courseId: "fr-es", learnerBaseLanguage: "fr" };
  const pack = normalizeNounLandingPack(raw, options);
  assert.equal(pack.items[0].learnerBaseText, "carte");
  assert.equal(pack.items[0].english, "map");
  raw.items[0].english = "";
  assert.throws(() => normalizeNounLandingPack(raw, options), /english/);
  delete raw.items[0].english;
  assert.throws(() => normalizeNounLandingPack(raw, options), /exactly/);
});

test("English-base content cannot silently diverge from its audit meaning", () => {
  const raw = fixture();
  raw.items[0].learnerBaseText = "planet";
  assert.throws(() => normalizeNounLandingPack(raw, expected), /exact English audit text/);
});

test("item IDs, normalized target words, revisions and explicit classifications are checked", () => {
  for (const [field, value, error] of [
    ["id", "es.noun.mano", /repeats ID/], ["targetText", " MANO ", /repeats target word/],
    ["targetText", "cafe\u0301", /repeats target word/], ["laneId", "neuter", /undeclared lane/],
    ["revision", 1.5, /positive integer/], ["explanation", "Unneeded per-noun prose.", /exactly/]
  ]) {
    const raw = fixture();
    raw.items[0][field] = value;
    assert.throws(() => normalizeNounLandingPack(raw, expected), error);
  }
  const raw = fixture();
  raw.items[0].generatedGender = "masculine";
  assert.throws(() => normalizeNounLandingPack(raw, expected), /exactly/);
});

test("packs require 2–6 distinct, populated language-owned lanes", () => {
  const oneLane = fixture();
  oneLane.lanes.pop();
  assert.throws(() => normalizeNounLandingPack(oneLane, expected), /two and six/);
  const duplicate = fixture();
  duplicate.lanes[1].id = "masculine";
  assert.throws(() => normalizeNounLandingPack(duplicate, expected), /repeats ID/);
  const duplicateLabel = fixture();
  duplicateLabel.lanes[1].label = "MASCULINE";
  assert.throws(() => normalizeNounLandingPack(duplicateLabel, expected), /repeats label/);
  const emptyLane = fixture();
  emptyLane.lanes.push({ id: "neuter", label: "Neuter" });
  assert.throws(() => normalizeNounLandingPack(emptyLane, expected), /no authored nouns/);
  emptyLane.items[2].laneId = "neuter";
  assert.equal(normalizeNounLandingPack(emptyLane, expected).lanes.length, 3);
});

test("lane images are optional course-owned PNGs with no URL or path escape", () => {
  const raw = fixture();
  raw.lanes[0].image = "/assets/micelaneous/male_gender.png";
  const pack = normalizeNounLandingPack(raw, expected);
  assert.equal(pack.lanes[0].image, raw.lanes[0].image);
  assert.equal(Object.hasOwn(pack.lanes[1], "image"), false);
  assert.equal(createNounLandingSession(pack).lanes[0].image, raw.lanes[0].image);
  for (const image of [
    "https://example.org/male_gender.png", "//example.org/male_gender.png",
    "/assets/micelaneous/../male_gender.png", "/assets/micelaneous/%2e%2e/male_gender.png",
    "/assets/micelaneous/male_gender.png?x=1", "/assets/micelaneous/male_gender.png#x",
    "/assets/micelaneous/nested/male_gender.png", "/assets/icons/male_gender.png",
    "/assets/micelaneous/male_gender.svg", "/assets/micelaneous/male_gender.png\n",
    "/assets/micelaneous/male\\gender.png", "", null, 42
  ]) {
    raw.lanes[0].image = image;
    assert.throws(() => normalizeNounLandingPack(raw, expected), /safe PNG path/, String(image));
  }
});

test("native-review and license metadata cannot imply approval without required provenance", () => {
  const raw = fixture();
  raw.review.reviewer = "Someone";
  assert.throws(() => normalizeNounLandingPack(raw, expected), /Unapproved/);
  raw.review.status = "approved";
  assert.throws(() => normalizeNounLandingPack(raw, expected), /reviewedAt/);
  raw.review.reviewedAt = "2026-09-05";
  assert.equal(normalizeNounLandingPack(raw, expected).review.status, "approved");
  raw.license.spdxExpression = "AGPL-3.0-only";
  assert.throws(() => normalizeNounLandingPack(raw, expected), /must keep spdxExpression null/);
  raw.license.status = "release-cleared";
  assert.equal(normalizeNounLandingPack(raw, expected).license.spdxExpression, "AGPL-3.0-only");
  raw.license.spdxExpression = null;
  assert.throws(() => normalizeNounLandingPack(raw, expected), /spdxExpression/);
});

test("session starts ready, bounded and deterministic, without consuming or mutating the pack", () => {
  const pack = normalizeNounLandingPack(fixture(), expected);
  const before = JSON.stringify(pack);
  const state = createNounLandingSession(pack, { random: () => 0.999, limit: 2 });
  assert.equal(state.phase, "ready");
  assert.equal(state.item.id, "es.noun.mapa");
  assert.deepEqual(state.queue.map((item) => item.id), ["es.noun.mano"]);
  assert.equal(state.total, 2);
  assert.equal(state.durationMs, 10_000);
  assert.equal(state.selectedLane, null);
  assert.equal(JSON.stringify(pack), before);
  assert.ok(Object.isFrozen(state.attemptsByItem));
  for (const limit of [0, -1, 1.5, NaN, Infinity]) {
    assert.throws(() => createNounLandingSession(pack, { limit }), /limit/);
  }
  for (const value of [-1, 1, 4, NaN, Infinity]) {
    const bounded = createNounLandingSession(pack, { random: () => value, limit: 99 });
    assert.equal(bounded.total, 3);
    assert.equal(new Set([bounded.item, ...bounded.queue].map((item) => item.id)).size, 3);
  }
});

test("the default session includes the entire JSON pool instead of an arbitrary twelve-noun limit", () => {
  const raw = fixture();
  raw.items = Array.from({ length: 25 }, (_, index) => ({
    id: `es.noun.fixture${index}`, revision: 1, targetText: `palabra${index}`,
    learnerBaseText: `word ${index}`, english: `word ${index}`,
    laneId: index % 2 ? "feminine" : "masculine"
  }));
  const pack = normalizeNounLandingPack(raw, expected);
  const state = createNounLandingSession(pack, { random: () => 0.999 });
  assert.equal(state.total, 25);
  assert.equal(new Set([state.item, ...state.queue].map(({ id }) => id)).size, 25);
  assert.equal(createNounLandingSession(pack, { limit: 7 }).total, 7);
});

test("a new cycle can avoid the last noun with one bounded swap without mutating content", () => {
  const pack = normalizeNounLandingPack(fixture(), expected);
  const before = JSON.stringify(pack);
  const avoidFirstItemId = pack.items[0].id;
  const state = createNounLandingSession(pack, { random: () => 0.999, avoidFirstItemId });
  assert.notEqual(state.item.id, avoidFirstItemId);
  assert.equal(state.total, pack.items.length);
  assert.equal(new Set([state.item, ...state.queue].map(({ id }) => id)).size, pack.items.length);
  const bounded = createNounLandingSession(pack, { random: () => 0.999, avoidFirstItemId, limit: 1 });
  assert.notEqual(bounded.item.id, avoidFirstItemId);
  assert.equal(bounded.total, 1);
  const unknown = createNounLandingSession(pack, { random: () => 0.999, avoidFirstItemId: "es.noun.unknown" });
  assert.equal(unknown.item.id, pack.items[0].id);
  assert.equal(JSON.stringify(pack), before);
  assert.throws(() => createNounLandingSession(pack, { avoidFirstItemId: 1 }), /avoidFirstItemId/);
});

test("ready, feedback and complete phases reject premature or duplicate actions", () => {
  const ready = session({ limit: 1 });
  assert.equal(advanceNounFall(ready, 10_000), ready);
  assert.equal(selectNounLane(ready, "masculine"), ready);
  assert.equal(landNoun(ready), ready);
  assert.equal(nextNoun(ready), ready);
  const falling = startNounLanding(ready);
  assert.equal(startNounLanding(falling), falling);
  const feedback = answer(falling);
  assert.equal(landNoun(feedback), feedback);
  assert.equal(selectNounLane(feedback, "feminine"), feedback);
  assert.equal(advanceNounFall(feedback, 10_000), feedback);
  const complete = nextNoun(feedback);
  assert.equal(complete.phase, "complete");
  assert.equal(complete.item, null);
  assert.equal(nextNoun(complete), complete);
  assert.equal(startNounLanding(complete), complete);
  assert.equal(landNoun(complete), complete);
  assert.equal(complete.correctCount, 1);
  assert.equal(complete.attempts, 1);
});

test("a learner can steer more than once before landing and only the selected authored lane wins", () => {
  const falling = startNounLanding(session());
  assert.equal(selectNounLane(falling, "neuter"), falling);
  const wrongLane = selectNounLane(falling, "feminine");
  const corrected = selectNounLane(wrongLane, "masculine");
  assert.equal(falling.selectedLane, null);
  assert.equal(wrongLane.selectedLane, "feminine");
  assert.equal(selectNounLane(corrected, "masculine"), corrected);
  const landed = landNoun(corrected);
  assert.equal(landed.correct, true);
  assert.equal(landed.correctCount, 1);
  assert.equal(landed.streak, 1);
  assert.equal(landed.completed, 1);
  assert.equal(landed.queue.length, 2);
});

test("time advances only for finite positive deltas and resolves exactly once at expiry", () => {
  const falling = selectNounLane(startNounLanding(session()), "masculine");
  for (const delta of [0, -1, NaN, Infinity, -Infinity, "10000", null]) {
    assert.equal(advanceNounFall(falling, delta), falling);
  }
  const advanced = advanceNounFall(falling, 9_999);
  assert.equal(advanced.phase, "falling");
  assert.equal(advanced.elapsedMs, 9_999);
  assert.equal(falling.elapsedMs, 0);
  const landed = advanceNounFall(advanced, 500_000);
  assert.equal(landed.phase, "feedback");
  assert.equal(landed.elapsedMs, 10_000);
  assert.equal(landed.correct, true);
  assert.equal(landed.attempts, 1);
  assert.equal(advanceNounFall(landed, 500_000), landed);
});

test("all finite duration choices include an exact five-second expiry without changing the ten-second default", () => {
  assert.equal(session().durationMs, 10000);
  for (const durationMs of [5000, 10000, 15000, 20000]) {
    const falling = selectNounLane(startNounLanding(session({ durationMs })), "masculine");
    const almost = advanceNounFall(falling, durationMs - 1);
    assert.equal(almost.phase, "falling");
    assert.equal(almost.attempts, 0);
    const landed = advanceNounFall(almost, 1);
    assert.equal(landed.phase, "feedback");
    assert.equal(landed.elapsedMs, durationMs);
    assert.equal(landed.correct, true);
    assert.equal(landed.attempts, 1);
    assert.equal(advanceNounFall(landed, durationMs), landed);
  }
});

test("five-second duration changes preserve elapsed fraction and reject nonfinite or unsupported timing", () => {
  const falling = advanceNounFall(startNounLanding(session()), 2500);
  const faster = setNounFallDuration(falling, 5000);
  assert.equal(faster.elapsedMs, 1250);
  assert.equal(faster.durationMs, 5000);
  assert.equal(faster.item, falling.item);
  assert.equal(faster.queue, falling.queue);
  assert.equal(falling.elapsedMs, 2500);
  assert.equal(Object.isFrozen(faster), true);
  assert.equal(setNounFallDuration(faster, 5000), faster);
  const slower = setNounFallDuration(faster, 20000);
  assert.equal(slower.elapsedMs, 5000);
  assert.equal(slower.elapsedMs / slower.durationMs, 0.25);
  for (const durationMs of [-1, 4999, 5001, 25000, Infinity, NaN, "5000", null]) {
    assert.throws(() => session({ durationMs }), /durationMs/);
    assert.throws(() => setNounFallDuration(faster, durationMs), /durationMs/);
  }
});

test("infinite time holds the noun until a deliberate answer and can return to timed play", () => {
  const falling = startNounLanding(session({ durationMs: 0 }));
  assert.equal(advanceNounFall(falling, 3600000), falling);
  const timed = setNounFallDuration(falling, 10000);
  assert.equal(timed.elapsedMs, 0);
  assert.equal(advanceNounFall(timed, 10000).phase, "feedback");
  const answered = landNoun(selectNounLane(falling, falling.item.laneId));
  assert.equal(answered.phase, "feedback");
  assert.equal(answered.correct, true);
  assert.equal(answered.attempts, 1);
});

test("an unselected timeout or early drop is a miss, never an automatic correct answer", () => {
  for (const finish of [landNoun, (state) => advanceNounFall(state, 10_000)]) {
    const missed = finish(startNounLanding(session({ limit: 1 })));
    assert.equal(missed.correct, false);
    assert.equal(missed.correctCount, 0);
    assert.equal(missed.completed, 1);
    assert.equal(missed.queue.length, 1);
    assert.equal(missed.queue[0].id, missed.item.id);
  }
});

test("misses return once after the remaining nouns; successful retry does not double-count coverage", () => {
  let state = startNounLanding(session({ limit: 2 }));
  state = answer(state, "feminine");
  assert.deepEqual(state.queue.map((item) => item.id), ["es.noun.mano", "es.noun.mapa"]);
  assert.equal(state.review, false);
  state = nextNoun(state);
  assert.equal(state.item.id, "es.noun.mano");
  assert.equal(state.review, false);
  state = answer(state);
  assert.equal(state.completed, 2);
  state = nextNoun(state);
  assert.equal(state.item.id, "es.noun.mapa");
  assert.equal(state.review, true);
  assert.equal(state.elapsedMs, 0);
  assert.equal(state.selectedLane, null);
  state = answer(state);
  assert.equal(state.completed, 2);
  assert.equal(state.correctCount, 2);
  assert.equal(state.attempts, 3);
  assert.equal(state.streak, 2);
  assert.equal(state.bestStreak, 2);
  assert.equal(nextNoun(state).phase, "complete");
});

test("repeated misses terminate after two attempts per noun and reset the streak", () => {
  let state = startNounLanding(session());
  state = nextNoun(answer(state));
  state = landNoun(state);
  assert.equal(state.streak, 0);
  assert.equal(state.bestStreak, 1);
  let transitions = 0;
  while (state.phase !== "complete" && transitions < 20) {
    state = state.phase === "feedback" ? nextNoun(state) : landNoun(state);
    transitions += 1;
  }
  assert.equal(state.phase, "complete");
  assert.equal(state.attempts, 5);
  assert.equal(state.completed, 3);
  assert.equal(state.correctCount, 1);
  assert.ok(Object.values(state.attemptsByItem).every((count) => count <= 2));
});
