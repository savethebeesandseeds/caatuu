import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const staticRoot = new URL("../../../../apps/languages/czech/static/", import.meta.url);
const [controller, legacyRedirect, pack, oldCzechRedirect, oldSharedRedirect, sharedPage, thermosphereCzechRedirect, thermosphereSharedRedirect] = await Promise.all([
  readFile(new URL("../../../../apps/language-runtime/static/source/games/grammar-gravity/grammar-gravity-host.mjs", import.meta.url), "utf8"),
  readFile(new URL("grammar-gravity.html", staticRoot), "utf8"),
  readFile(new URL("data/games/grammar-gravity/challenges.json", staticRoot), "utf8").then(JSON.parse),
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

test("the current explicit journey keeps all eighteen Czech challenges and 162 examples", () => {
  const genderNames = ["masculine", "feminine", "neuter"];
  assert.equal(pack.schemaVersion, "caatuu-grammar-gravity-content-v3");
  assert.deepEqual(pack.gameplay.stages, ["meaning", "category", "form"]);
  assert.equal(pack.gameplay.categoryFeature, "gender");
  assert.equal(pack.challenges.length, 18);
  assert.equal(pack.challenges.flatMap((entry) => Object.values(entry.forms).flatMap((form) => form.examples)).length, 162);
  assert.deepEqual(Object.fromEntries([1, 2, 3].map((level) => [level, pack.challenges.filter((entry) => entry.difficulty === level).length])), {
    1: 6,
    2: 6,
    3: 6
  });
  assert.equal(Object.hasOwn(pack, "lesson"), false);
  assert.deepEqual(Object.keys(pack.presentation), ["errorTitle", "errorDetail", "backLabel"]);
  assert.equal(pack.review.status, "native-review-required");

  for (const entry of pack.challenges) {
    assert.equal(entry.focus.kind, "adjective");
    assert.ok(entry.focus.targetText?.trim());
    assert.ok(Number.isInteger(entry.difficulty) && entry.difficulty >= 1 && entry.difficulty <= 3);
    assert.deepEqual(Object.keys(entry.forms), genderNames);
    assert.equal(new Set(Object.values(entry.forms).map((form) => form.displayForm)).size, 3);
    for (const form of Object.values(entry.forms)) {
      assert.ok(form.displayForm?.trim());
      assert.equal(form.examples.length, 3);
      for (const example of form.examples) {
        assert.ok(example.id?.startsWith(`${entry.id}.`));
        assert.equal(example.learnerBaseText, example.englishAuditText);
        assert.ok(example.anchor.learnerBaseText?.trim());
        assert.equal(example.anchor.learnerBaseText, example.anchor.englishAuditText);
        assert.ok(example.englishAuditText.endsWith(example.anchor.learnerBaseText));
        assert.equal(example.slot.beforeText + form.displayForm + example.slot.afterText, example.targetText);
        assert.equal(example.slot.afterText.trim(), example.anchor.targetText);
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
  assert.deepEqual(pack.challenges.map((entry) => entry.focus.targetText), [
    "nový", "malý", "dobrý", "český", "velký", "starý", "dlouhý", "mladý", "rychlý",
    "pomalý", "krásný", "teplý", "zajímavý", "důležitý", "chytrý", "studený", "vysoký", "krátký"
  ]);
  assert.deepEqual(Object.values(pack.challenges[0].forms).map((form) => form.displayForm), ["nový", "nová", "nové"]);
  assert.deepEqual(Object.values(pack.challenges[0].forms).map((form) => form.examples[0].targetText), ["nový dům", "nová kniha", "nové město"]);
  assert.match(controller, /buildGrammarGravityRounds/u);
  assert.match(controller, /grammar-gravity-core\.mjs\?v=grammar-gravity-core-4/u);
  assert.doesNotMatch(sharedPage, /id="(?:grammarGravityBoard|grammarGravityLearnerBaseColumn|grammarGravityTargetColumn|grammarGravityNext)"/u);
  assert.doesNotMatch(controller, /function (?:renderMatchingBoard|selectMatch|selectPhrase|makeLegacyRound)|mode:\s*["']legacy["']/u);
  assert.match(sharedPage, /id="gravityAdjectiveArena"/u);
  assert.match(legacyRedirect, /url=\/cz\/index\.html\?game=grammar-gravity/u);
  assert.doesNotMatch(legacyRedirect, /source\/games\/grammar-gravity/u);
});
