import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const staticRoot = new URL("../../../../apps/languages/czech/static/", import.meta.url);
const [controller, legacyRedirect, pack] = await Promise.all([
  readFile(new URL("../../../../apps/language-runtime/static/source/games/agreement-aurora/agreement-aurora-host.mjs", import.meta.url), "utf8"),
  readFile(new URL("agreement-aurora.html", staticRoot), "utf8"),
  readFile(new URL("data/games/agreement-aurora/challenges.json", staticRoot), "utf8").then(JSON.parse)
]);

test("the JSON is a direct list of eighteen adjective challenge records", () => {
  const genderNames = ["masculine", "feminine", "neuter"];
  assert.ok(Array.isArray(pack));
  assert.equal(pack.length, 18);
  assert.equal(pack.flatMap((entry) => Object.values(entry.forms).flatMap((form) => form.examples)).length, 162);
  assert.deepEqual(Object.fromEntries([1, 2, 3].map((level) => [level, pack.filter((entry) => entry.difficulty === level).length])), {
    1: 6,
    2: 6,
    3: 6
  });
  assert.doesNotMatch(JSON.stringify(pack), /"(?:id|prompt|review|source|url|language|lesson|rounds|summary|rule|gender)"/i);

  for (const entry of pack) {
    assert.deepEqual(Object.keys(entry), ["adjective", "difficulty", "forms"]);
    assert.ok(entry.adjective?.trim());
    assert.ok(Number.isInteger(entry.difficulty) && entry.difficulty >= 1 && entry.difficulty <= 3);
    assert.deepEqual(Object.keys(entry.forms), genderNames);
    assert.equal(new Set(Object.values(entry.forms).map((form) => form.form)).size, 3);
    for (const form of Object.values(entry.forms)) {
      assert.deepEqual(Object.keys(form), ["form", "examples"]);
      assert.ok(form.form?.trim());
      assert.equal(form.examples.length, 3);
      for (const example of form.examples) {
        assert.deepEqual(Object.keys(example), ["english", "czech"]);
        assert.ok(example.english?.trim());
        assert.ok(example.czech?.startsWith(`${form.form} `));
      }
    }
  }
});

test("the Agreement Aurora examples remain suitable for children", () => {
  const examples = pack.flatMap((entry) => Object.values(entry.forms).flatMap((form) => form.examples));
  assert.deepEqual(
    pack[3].forms.neuter.examples[2],
    { english: "Czech glass", czech: "české sklo" }
  );
  assert.doesNotMatch(JSON.stringify(examples), /\b(?:beer|wine|alcohol)\b|\b(?:pivo|víno|alkohol)\b/iu);
});

test("each page holds one adjective while the three gender forms change", () => {
  assert.deepEqual(pack.map((entry) => entry.adjective), [
    "nový", "malý", "dobrý", "český", "velký", "starý", "dlouhý", "mladý", "rychlý",
    "pomalý", "krásný", "teplý", "zajímavý", "důležitý", "chytrý", "studený", "vysoký", "krátký"
  ]);
  assert.deepEqual(Object.values(pack[0].forms).map((form) => form.form), ["nový", "nová", "nové"]);
  assert.deepEqual(Object.values(pack[0].forms).map((form) => form.examples[0].czech), ["nový dům", "nová kniha", "nové město"]);
  assert.match(controller, /buildAgreementAuroraRounds/u);
  assert.match(controller, /agreement-aurora-core\.mjs\?v=agreement-aurora-core-2/u);
  assert.match(legacyRedirect, /url=\/cz\/index\.html\?game=agreement-aurora/u);
  assert.doesNotMatch(legacyRedirect, /source\/games\/agreement-aurora/u);
});
