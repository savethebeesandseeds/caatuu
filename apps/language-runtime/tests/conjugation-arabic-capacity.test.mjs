import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { validateConjugationCometCatalog, buildConjugationHelixRound, judgeConjugationHelixPair, judgeConjugationHelixRound } from "../static/source/games/conjugation-comet/conjugation-comet-core.mjs";

test("a complete thirteen-slot Arabic paradigm remains solvable without truncation", async () => {
  const catalog = JSON.parse(await readFile(new URL("../../languages/norwegian-bokmal/static/data/games/conjugation-comet/content.json", import.meta.url), "utf8"));
  const verb = catalog.verbs[0];
  const forms = ["كَتَبَ", "كَتَبَتْ", "كَتَبَا", "كَتَبَتَا", "كَتَبُوا", "كَتَبْنَ", "كَتَبْتَ", "كَتَبْتِ", "كَتَبْتُمَا", "كَتَبْتُمْ", "كَتَبْتُنَّ", "كَتَبْتُ", "كَتَبْنَا"];
  verb.forms = forms.map((targetText, index) => ({ ...verb.forms[0], id: `slot-${index + 1}`,
    subjectBaseText: `Person/gender/number slot ${index + 1}`, learnerBaseCueText: `Person/gender/number slot ${index + 1}`,
    englishAuditText: `Person/gender/number slot ${index + 1}`, targetText,
    targetPhraseFrame: { beforeText: "", afterText: "" } }));
  const normalized = validateConjugationCometCatalog(catalog);
  const round = buildConjugationHelixRound(normalized, verb.id, { rng: () => 0.37 });
  assert.equal(round.subjects.length, 13); assert.equal(round.options.length, 13);
  assert.ok(round.options.some((_, offset) => judgeConjugationHelixRound(round, 0, offset).correct),
    "whole-round grading accepts a solved thirteen-slot paradigm");
  for (const subject of round.subjects) {
    assert.ok(round.options.some(option => judgeConjugationHelixPair(round, subject.id, option.id)));
    assert.ok(round.options.some(option => !judgeConjugationHelixPair(round, subject.id, option.id)));
  }
  verb.forms.push({ ...verb.forms[0], id: "unsupported-extra-slot" });
  assert.throws(() => validateConjugationCometCatalog(catalog), /2 to 13/u);
});
