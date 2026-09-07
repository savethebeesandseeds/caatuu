import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { CZECH_CASES, validatePack, buildRounds, buildQuestions }
  from "../../../languages/czech/static/source/games/case-cosmos/case-cosmos-content.mjs";

const courseRoot = new URL("../../../languages/czech/", import.meta.url);
const course = JSON.parse(await readFile(new URL("course.json", courseRoot), "utf8"));
const catalog = JSON.parse(await readFile(new URL(course.resources.caseCosmosCatalog.path, new URL("../../../../", import.meta.url)), "utf8"));

test("Case Cosmos loads its authored catalog from the course manifest", () => {
  assert.deepEqual(validatePack(catalog).legacyNouns, catalog.legacyNouns);
  assert.deepEqual(validatePack(catalog).contexts, catalog.contexts);
  assert.deepEqual(new Set(catalog.legacyNouns.map(item => item.difficulty)), new Set([1, 2, 3]));
});

test("all declared content reaches its difficulty without pinning vocabulary or catalog counts", () => {
  for (const difficulty of [1, 2, 3]) {
    const rounds = buildRounds(catalog, difficulty);
    const nouns = catalog.legacyNouns.filter(item => item.difficulty <= difficulty);
    const contexts = catalog.contexts.filter(item => item.difficulty <= difficulty);
    assert.equal(rounds.length, nouns.length + contexts.length);
    assert.deepEqual(rounds.filter(round => !round.contextItem).map(round => round.noun),
      [...nouns].sort((a, b) => a.difficulty - b.difficulty).map(item => item.noun));
    assert.deepEqual(rounds.filter(round => round.contextItem).map(round => round.id), contexts.map(item => item.id));
    for (const round of rounds) {
      assert.equal(buildQuestions(round, () => 0.5).length, round.contextItem ? 1 : CZECH_CASES.length);
    }
  }
});
