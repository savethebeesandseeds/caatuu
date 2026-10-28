import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const staticRoot = new URL("../../../../apps/languages/czech/static/", import.meta.url);
const controller = await readFile(
  new URL("../../../../apps/language-runtime/static/source/games/conjugation-comet/conjugation-comet-host.mjs", import.meta.url),
  "utf8"
);
const shell = await readFile(
  new URL("../../../../apps/language-runtime/static/games/conjugation-comet.html", import.meta.url),
  "utf8"
);
const legacyRedirect = await readFile(new URL("conjugation-comet.html", staticRoot), "utf8");
const verbs = JSON.parse(await readFile(
  new URL("data/games/conjugation-comet/content.json", staticRoot),
  "utf8"
));

test("the shared catalog supplies complete six-form paradigms and fair English cues", () => {
  assert.equal(verbs.schemaVersion, "caatuu-conjugation-comet-catalog-v1");
  assert.equal(verbs.courseId, "cz");
  assert.equal(verbs.targetLanguageId, "cs");
  assert.ok(Array.isArray(verbs.verbs) && verbs.verbs.length >= 4);
  for (const verb of verbs.verbs) {
    assert.ok(verb.targetText?.trim());
    assert.ok(verb.learnerBaseText?.trim());
    assert.ok(verb.englishAuditText?.trim());
    assert.equal(verb.forms?.length, 6, `${verb.targetText} needs six forms`);
    for (const form of verb.forms) {
      assert.ok(form.subjectTargetText?.trim(), `${verb.targetText} needs a subject label`);
      assert.ok(form.targetText?.trim(), `${verb.targetText} needs a target form`);
      assert.ok(form.learnerBaseCueText?.trim(), `${verb.targetText} needs a learner-base cue`);
      assert.ok(form.englishAuditText?.trim(), `${verb.targetText} needs an English audit cue`);
      assert.ok(form.acceptedTargetTexts.every((accepted) => accepted?.trim()));
    }
  }
});

test("the -ám surface family stays on the authored forms", () => {
  const endings = { S1: "ám", S2: "áš", S3: "á", P1: "áme", P2: "áte", P3: "ají" };
  const matches = (verb) => Object.entries(endings).every(([label, ending]) => (
    verb.forms.find((form) => form.subjectTargetText === label)?.targetText.endsWith(ending)
  ));
  const training = verbs.verbs.filter((verb) => (
    verb.family.startsWith("Imperfective.")
    && verb.targetText.endsWith("at")
    && !verb.targetText.includes(" ")
    && matches(verb)
  )).slice(0, 5);
  const transfer = verbs.verbs.find((verb) => (
    verb.family.startsWith("Imperfective.")
    && verb.targetText.endsWith("át")
    && !verb.targetText.includes(" ")
    && matches(verb)
  ));
  assert.deepEqual(training.map((verb) => verb.targetText), ["dělat", "hledat", "čekat", "znamenat", "volat"]);
  assert.equal(transfer?.targetText, "znát");
  for (const verb of [...training, transfer]) assert.match(verb.family, /surface family/);
  assert.doesNotMatch(JSON.stringify(verbs), /"pilot"|"challengeId"/);
});

test("the shared host owns Conjugation Comet and the Czech legacy URL only redirects", () => {
  assert.match(controller, /course-game-content\.mjs\?v=[^"']+/u);
  assert.match(controller, /conjugation-comet-core\.mjs\?v=[^"']+/u);
  assert.match(controller, /buildConjugationVerbQueue\(state\.catalog\.verbs/u);
  assert.match(shell, /conjugation-comet-host\.mjs\?v=[^"']+/u);
  assert.match(legacyRedirect, /url=\/cz\/index\.html\?game=conjugation-comet/u);
  assert.doesNotMatch(legacyRedirect, /source\/games\/conjugation-comet/u);
});
