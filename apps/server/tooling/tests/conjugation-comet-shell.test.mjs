import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const staticRoot = new URL("../../../../apps/languages/czech/static/", import.meta.url);
const verbs = JSON.parse(await readFile(
  new URL("data/games/conjugation-comet/verbs.json", staticRoot),
  "utf8"
));

test("verbs.json supplies simple, complete six-form paradigms and fair English cues", () => {
  const labels = ["S1", "S2", "S3", "P1", "P2", "P3"];
  assert.equal(verbs.language, "cs");
  assert.ok(Array.isArray(verbs.verbs) && verbs.verbs.length >= 4);
  for (const verb of verbs.verbs) {
    assert.ok(verb.verb?.trim());
    assert.ok(verb.meaning?.trim());
    assert.equal(verb.forms?.length, 6, `${verb.verb} needs six forms`);
    assert.deepEqual(verb.forms.map((form) => form.label), labels);
    for (const form of verb.forms) {
      assert.ok(form.form?.trim(), `${verb.verb} ${form.label} needs a Czech form`);
      assert.ok(form.cue?.trim(), `${verb.verb} ${form.label} needs an English cue`);
      if (form.accepted !== undefined) {
        assert.ok(Array.isArray(form.accepted));
        assert.ok(form.accepted.every((accepted) => accepted?.trim()));
      }
    }
  }
});

test("the first pilot derives a reviewed -ám family without adding JSON taxonomy", () => {
  const endings = { S1: "ám", S2: "áš", S3: "á", P1: "áme", P2: "áte", P3: "ají" };
  const matches = (verb) => Object.entries(endings).every(([label, ending]) => (
    verb.forms.find((form) => form.label === label)?.form.endsWith(ending)
  ));
  const training = verbs.verbs.filter((verb) => (
    verb.hint.startsWith("Imperfective.")
    && verb.verb.endsWith("at")
    && !verb.verb.includes(" ")
    && matches(verb)
  )).slice(0, 5);
  const transfer = verbs.verbs.find((verb) => (
    verb.hint.startsWith("Imperfective.")
    && verb.verb.endsWith("át")
    && !verb.verb.includes(" ")
    && matches(verb)
  ));
  assert.deepEqual(training.map((verb) => verb.verb), ["dělat", "hledat", "čekat", "znamenat", "volat"]);
  assert.equal(transfer?.verb, "znát");
  for (const verb of [...training, transfer]) assert.match(verb.hint, /surface family/);
  assert.doesNotMatch(JSON.stringify(verbs), /"family"|"pilot"|"challengeId"/);
});
