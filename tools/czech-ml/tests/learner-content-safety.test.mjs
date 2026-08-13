import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  SHIPPED_LEARNER_CONTENT_SOURCES,
  assertRegisteredGameJsonCoverage,
  extractLearnerContent,
  inspectLearnerField,
  normalizeSafetyText,
  scanShippedLearnerContent,
} from "../scripts/learner-content-safety-lib.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function findings(text, locale = "en") {
  return inspectLearnerField({
    file: "fixture.json",
    contentId: "fixture",
    field: "/text",
    locale,
    text,
  });
}

function ruleIds(text, locale = "en") {
  return findings(text, locale).map((finding) => finding.ruleId);
}

test("normalizes learner text to NFC before matching", () => {
  assert.equal(normalizeSafetyText("  VI\u0301NO!  ", "cs"), "víno");
  assert.deepEqual(ruleIds("VI\u0301NO!", "cs"), ["blocked.adult-substances.alcohol"]);
});

test("catches the reported double meaning without rejecting clear sports contexts", () => {
  assert.deepEqual(ruleIds("I have two balls."), ["review.ambiguous-first-person-balls"]);
  assert.deepEqual(ruleIds("Well, I have two balls."), ["review.ambiguous-first-person-balls"]);
  assert.deepEqual(ruleIds("Mám dva míče.", "cs"), ["review.ambiguous-first-person-balls"]);
  assert.deepEqual(ruleIds("Kick the ball."), []);
  assert.deepEqual(ruleIds("Two balls ended up behind the fence while the children practiced passing."), []);
  assert.deepEqual(ruleIds("I have two balls for football practice."), []);
  assert.deepEqual(ruleIds("The ball is under the table."), []);
  assert.deepEqual(ruleIds("A wineglass-shaped ornament."), []);
});

test("blocks high-confidence adult and dangerous content categories", () => {
  const cases = [
    ["A glass of wine.", "en", "blocked.adult-substances.alcohol"],
    ["Jedno pivo, prosím.", "cs", "blocked.adult-substances.alcohol"],
    ["He is smoking a cigarette.", "en", "blocked.adult-substances.tobacco"],
    ["They found cocaine.", "en", "blocked.adult-substances.illicit-drugs"],
    ["Pornographic content.", "en", "blocked.sexual-content"],
    ["That is bullshit.", "en", "blocked.profanity"],
    ["Suicide.", "en", "blocked.self-harm"],
    ["The murderer hid a corpse.", "en", "blocked.graphic-hazard"],
    ["They killed the dog.", "en", "blocked.graphic-hazard"],
    ["A loaded pistol.", "en", "blocked.weapon-hazard"],
  ];
  for (const [text, locale, expected] of cases) {
    assert.ok(ruleIds(text, locale).includes(expected), `${expected}: ${text}`);
  }
});

test("blocks base profanity variants including the uninflected form", () => {
  for (const text of ["Fuck.", "They fucked up.", "That fucking noise.", "He says fucks too often."]) {
    assert.deepEqual(ruleIds(text), ["blocked.profanity"]);
  }
  assert.deepEqual(ruleIds("The fuchsia flower is bright."), []);
});

test("distinguishes edged-weapon violence from harmless cutlery and idiom contexts", () => {
  assert.deepEqual(ruleIds("The knight carries a sword."), ["blocked.edged-weapon-violence"]);
  assert.deepEqual(ruleIds("They stabbed the dog."), ["blocked.edged-weapon-violence"]);
  assert.deepEqual(ruleIds("She threatened him with a knife."), ["blocked.edged-weapon-violence"]);
  assert.deepEqual(ruleIds("The knife is on the table."), ["review.edged-weapon-reference"]);
  assert.deepEqual(ruleIds("A stabbing pain started in my arm."), ["review.edged-weapon-reference"]);
  assert.deepEqual(ruleIds("Put the butter knife beside the fork."), []);
  assert.deepEqual(ruleIds("Let's take a stab at the puzzle."), []);

  assert.deepEqual(ruleIds("Ryt\u00ed\u0159 m\u00e1 me\u010d.", "cs"), ["blocked.edged-weapon-violence"]);
  assert.deepEqual(ruleIds("N\u016f\u017e je na stole.", "cs"), ["review.edged-weapon-reference"]);
});

test("blocks violent shooting while permitting clear sport, media, plant, and idiom senses", () => {
  assert.deepEqual(ruleIds("He shot the dog."), ["blocked.shooting-violence"]);
  assert.deepEqual(ruleIds("They shoot ducks."), ["blocked.shooting-violence"]);
  assert.deepEqual(ruleIds("Do not shoot yourself."), ["blocked.shooting-violence"]);
  assert.deepEqual(ruleIds("Shoot at him."), ["blocked.shooting-violence"]);
  assert.deepEqual(ruleIds("I heard a shot."), ["review.ambiguous-shooting"]);
  assert.deepEqual(ruleIds("She shoots the basketball into the hoop."), []);
  assert.deepEqual(ruleIds("We planned a photo shoot with her."), []);
  assert.deepEqual(ruleIds("The photographer shot her portrait."), []);
  assert.deepEqual(ruleIds("The film was shot in Prague."), []);
  assert.deepEqual(ruleIds("Let's give it a shot."), []);
  assert.deepEqual(ruleIds("Bamboo shoots grow quickly."), []);

  assert.deepEqual(ruleIds("St\u0159elil psa.", "cs"), ["blocked.shooting-violence"]);
  assert.deepEqual(ruleIds("St\u0159elil g\u00f3l.", "cs"), []);
});

test("reviews ordinary death references, blocks severe contexts, and permits non-living idioms", () => {
  assert.deepEqual(ruleIds("The story mentions death."), ["review.death-reference"]);
  assert.deepEqual(ruleIds("The bird is dead."), ["review.death-reference"]);
  assert.deepEqual(ruleIds("They found a dead body."), ["blocked.severe-death-reference"]);
  assert.deepEqual(ruleIds("The battery is dead."), []);
  assert.deepEqual(ruleIds("This road is a dead end."), []);
  assert.deepEqual(ruleIds("Pes je mrtv\u00fd.", "cs"), ["review.death-reference"]);
});

test("blocks direct credential solicitation but permits protective language", () => {
  assert.deepEqual(ruleIds("Tell me your password."), ["blocked.credential-solicitation"]);
  assert.deepEqual(ruleIds("Please tell me your password."), ["blocked.credential-solicitation"]);
  assert.deepEqual(ruleIds("What's your password?"), ["blocked.credential-solicitation"]);
  assert.deepEqual(ruleIds("Jaké je tvoje heslo?", "cs"), ["blocked.credential-solicitation"]);
  assert.deepEqual(ruleIds("Jaký je tvůj PIN?", "cs"), ["blocked.credential-solicitation"]);
  assert.deepEqual(ruleIds("Prosím, řekni mi svoje heslo.", "cs"), ["blocked.credential-solicitation"]);
  assert.deepEqual(ruleIds("We do not share a password even when someone asks politely."), []);
  assert.deepEqual(ruleIds("Never share your password."), []);
  assert.deepEqual(ruleIds("What is the password?"), ["blocked.credential-solicitation"]);
});

test("blocks requests for a child's personal data but permits fictional-character context", () => {
  assert.deepEqual(ruleIds("What is your name?"), ["blocked.personal-data-solicitation"]);
  assert.deepEqual(ruleIds("Try to spell your surname."), ["blocked.personal-data-solicitation"]);
  assert.deepEqual(ruleIds("Napiš své jméno.", "cs"), ["blocked.personal-data-solicitation"]);
  assert.deepEqual(ruleIds("What is the character's name?"), []);
  assert.deepEqual(ruleIds("Write the character's name."), []);
});

test("reports review-required audit terms separately from hard blockers", () => {
  assert.equal(findings("I see blood.")[0].severity, "review");
  assert.deepEqual(ruleIds("The doctor checks a fracture."), ["review.graphic-medical-detail"]);
  assert.deepEqual(ruleIds("Mám průjem.", "cs"), ["review.graphic-medical-detail"]);
  assert.deepEqual(ruleIds("Byla nehoda.", "cs"), ["review.accident"]);
  assert.deepEqual(ruleIds("Jsem v baru.", "cs"), ["review.adult-venue-bar"]);
});

test("Conjugation extraction includes every accepted answer field", () => {
  const extracted = extractLearnerContent("conjugation-comet", {
    language: "cs",
    verbs: [{
      verb: "dělat",
      meaning: "do",
      hint: "Imperfective.",
      forms: [{ label: "S1", form: "dělám", cue: "I do", accepted: ["dělávám"] }],
    }],
  }, "fixture-conjugation.json");
  assert.deepEqual(extracted.fields.map((field) => field.field), [
    "/verbs/0/verb",
    "/verbs/0/meaning",
    "/verbs/0/hint",
    "/verbs/0/forms/0/form",
    "/verbs/0/forms/0/cue",
    "/verbs/0/forms/0/accepted/0",
  ]);
});

test("all shipped game JSON files are registered and all learner sources parse", async () => {
  const coverage = await assertRegisteredGameJsonCoverage(repoRoot);
  assert.equal(coverage.discovered.length, 6);
  assert.equal(coverage.registered.length, 5);

  const report = await scanShippedLearnerContent(repoRoot);
  assert.deepEqual(report.files.map((file) => file.sourceId), SHIPPED_LEARNER_CONTENT_SOURCES.map((source) => source.id));
  assert.equal(report.files.length, 6);
  assert.ok(report.scannedRecords > 1_700);
  assert.ok(report.scannedFields > 9_000);
  assert.equal(report.findingCounts.block + report.findingCounts.review, report.findings.length);
  assert.match(report.limitation, /does not replace bilingual human/i);
});
