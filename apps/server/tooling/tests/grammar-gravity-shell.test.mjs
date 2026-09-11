import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildGrammarGravityRounds } from "../../../language-runtime/static/source/games/grammar-gravity/grammar-gravity-core.mjs";

const staticRoot = new URL("../../../../apps/languages/czech/static/", import.meta.url);
const [controller, legacyRedirect, pack, oldCzechRedirect, oldSharedRedirect, sharedPage, thermosphereCzechRedirect, thermosphereSharedRedirect] = await Promise.all([
  readFile(new URL("../../../../apps/language-runtime/static/source/games/grammar-gravity/grammar-gravity-host.mjs", import.meta.url), "utf8"),
  readFile(new URL("grammar-gravity.html", staticRoot), "utf8"),
  readFile(new URL("data/games/grammar-gravity/content.json", staticRoot), "utf8").then(JSON.parse),
  readFile(new URL("agreement-aurora.html", staticRoot), "utf8"),
  readFile(new URL("../../../../apps/language-runtime/static/games/agreement-aurora.html", import.meta.url), "utf8"),
  readFile(new URL("../../../../apps/language-runtime/static/games/grammar-gravity.html", import.meta.url), "utf8"),
  readFile(new URL("triangular-thermosphere.html", staticRoot), "utf8"),
  readFile(new URL("../../../../apps/language-runtime/static/games/triangular-thermosphere.html", import.meta.url), "utf8")
]);

test("both former game addresses remain redirect-only bridges and the planet image is unchanged", () => {
  assert.match(oldCzechRedirect, /url=\/cz\/index\.html\?game=grammar-gravity/u);
  assert.match(oldSharedRedirect, /url=grammar-gravity\.html/u);
  assert.match(thermosphereCzechRedirect, /url=\/cz\/index\.html\?game=grammar-gravity/u);
  assert.match(thermosphereSharedRedirect, /url=grammar-gravity\.html/u);
  for (const redirect of [oldCzechRedirect, oldSharedRedirect, thermosphereCzechRedirect, thermosphereSharedRedirect, legacyRedirect]) {
    assert.match(redirect, /name="robots" content="noindex, nofollow"/u);
    assert.doesNotMatch(redirect, /<script\b|<iframe\b/u);
  }
  assert.match(sharedPage, /src="\/assets\/planets\/grammar-gravity\.png"/u);
  assert.doesNotMatch(sharedPage, /agreement-aurora\.png/u);
});

test("retired Czech renderer files are absent while the compatibility redirect remains", async () => {
  for (const name of ["grammar-gravity.js", "grammar-gravity.css", "launcher.css"]) {
    await assert.rejects(readFile(new URL(`source/games/grammar-gravity/${name}`, staticRoot)), { code: "ENOENT" });
  }
  assert.match(legacyRedirect, /url=\/cz\/index\.html\?game=grammar-gravity/u);
});

test("the current journey schedules every authored example within its cumulative badge", () => {
  assert.equal(pack.schemaVersion, "caatuu-grammar-gravity-content-v3");
  assert.deepEqual(pack.gameplay.stages, ["meaning", "category", "form"]);
  assert.equal(pack.gameplay.categoryFeature, "gender");
  for (const level of [1, 2, 3]) {
    const eligible = pack.challenges.filter(entry => entry.difficulty <= level);
    const expectedIds = eligible.flatMap(entry => Object.values(entry.forms).flatMap(form => form.examples.map(example => example.id)));
    const rounds = buildGrammarGravityRounds(pack, level, () => 0.3);
    assert.ok(rounds.length > 0);
    assert.deepEqual(rounds.map(round => round.id).sort(), expectedIds.sort());
    assert.equal(new Set(rounds.map(round => round.id)).size, rounds.length);
    assert.ok(rounds.every(round => round.difficulty <= level));
  }
  assert.equal(Object.hasOwn(pack, "lesson"), false);
  assert.deepEqual(Object.keys(pack.presentation), ["errorTitle", "errorDetail", "backLabel"]);
  assert.equal(pack.review.status, "native-review-required");

  for (const entry of pack.challenges) {
    assert.ok(entry.focus.kind?.trim());
    assert.ok(entry.focus.targetText?.trim());
    assert.ok(Number.isInteger(entry.difficulty) && entry.difficulty >= 1 && entry.difficulty <= 3);
    assert.deepEqual(Object.keys(entry.forms), (entry.axes || pack.axes).map(axis => axis.id));
    assert.ok(new Set(Object.values(entry.forms).map((form) => form.displayForm)).size >= 2,
      "each challenge must provide distinct answer choices");
    for (const form of Object.values(entry.forms)) {
      assert.ok(form.displayForm?.trim());
      assert.ok(form.examples.length > 0, "every form must have a schedulable example");
      for (const example of form.examples) {
        assert.ok(example.id?.startsWith(`${entry.id}.`));
        assert.equal(example.learnerBaseText, example.englishAuditText);
        assert.ok(example.anchor.learnerBaseText?.trim());
        assert.equal(example.anchor.learnerBaseText, example.anchor.englishAuditText);
        assert.equal(example.slot.beforeText + form.displayForm + example.slot.afterText, example.targetText);
      }
    }
  }
});

test("the Grammar Gravity examples remain suitable for children", () => {
  const examples = pack.challenges.flatMap((entry) => Object.values(entry.forms).flatMap((form) => form.examples));
  const glass = pack.challenges[3].forms.neuter.examples[2];
  assert.equal(glass.targetText, "české sklo");
  assert.equal(glass.englishAuditText, "Czech glass");
  assert.deepEqual(glass.anchor, { targetText: "sklo", learnerBaseText: "glass", englishAuditText: "glass" });
  assert.doesNotMatch(JSON.stringify(examples), /\b(?:beer|wine|alcohol)\b|\b(?:pivo|víno|alkohol)\b/iu);
});

test("Czech challenge families retain their forms in the sole animated renderer", () => {
  const rounds = new Map(buildGrammarGravityRounds(pack, 3, () => 0.3).map(round => [round.id, round]));
  for (const challenge of pack.challenges) {
    for (const form of Object.values(challenge.forms)) {
      for (const example of form.examples) {
        const round = rounds.get(example.id);
        assert.equal(round.challengeId, challenge.id);
        assert.deepEqual(round.focus, challenge.focus);
        assert.equal(round.flights[0].answer, form.displayForm);
        assert.equal(round.flights[0].targetText, example.targetText);
        assert.equal(round.flights[0].anchorText, example.anchor.targetText);
        assert.equal(round.flights[0].anchorMeaning, example.anchor.learnerBaseText);
        assert.equal(round.flights[0].beforeText, example.slot.beforeText);
        assert.equal(round.flights[0].afterText, example.slot.afterText);
        assert.ok(round.flights[0].options.includes(form.displayForm));
      }
    }
  }
  assert.match(controller, /buildGrammarGravityRounds/u);
  assert.match(controller, /grammar-gravity-core\.mjs\?v=[^"']+/u);
  assert.doesNotMatch(sharedPage, /id="(?:grammarGravityBoard|grammarGravityLearnerBaseColumn|grammarGravityTargetColumn|grammarGravityNext)"/u);
  assert.doesNotMatch(controller, /function (?:renderMatchingBoard|selectMatch|selectPhrase|makeLegacyRound)|mode:\s*["']legacy["']/u);
  assert.match(sharedPage, /id="gravityAdjectiveArena"/u);
  assert.match(legacyRedirect, /url=\/cz\/index\.html\?game=grammar-gravity/u);
  assert.doesNotMatch(legacyRedirect, /source\/games\/grammar-gravity/u);
});
