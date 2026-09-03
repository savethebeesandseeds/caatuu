import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const staticRoot = new URL("../../../../apps/languages/czech/static/", import.meta.url);
const [controller, pack] = await Promise.all([
  readFile(new URL("source/games/case-cosmos/case-cosmos.js", staticRoot), "utf8"),
  readFile(new URL("data/games/case-cosmos/challenges.json", staticRoot), "utf8").then(JSON.parse)
]);

test("the direct JSON keeps the first Case Cosmos content boundary small and inspectable", () => {
  const caseNames = ["Nominative", "Genitive", "Dative", "Accusative", "Vocative", "Locative", "Instrumental"];
  assert.ok(Array.isArray(pack));
  assert.equal(pack.length, 18);
  assert.equal(pack.flatMap((entry) => Object.values(entry.cases)).length, 126);
  assert.deepEqual(Object.fromEntries([1, 2, 3].map((level) => [level, pack.filter((entry) => entry.difficulty === level).length])), {
    1: 12,
    2: 4,
    3: 2
  });
  assert.doesNotMatch(JSON.stringify(pack), /"(?:id|meaning|question|prompt|review|source|url|language|lesson|rounds|summary|cue|focus|note)"/i);

  for (const entry of pack) {
    assert.deepEqual(Object.keys(entry), ["noun", "difficulty", "cases"]);
    assert.ok(entry.noun?.trim());
    assert.ok(Number.isInteger(entry.difficulty) && entry.difficulty >= 1 && entry.difficulty <= 3);
    assert.deepEqual(Object.keys(entry.cases), caseNames);
    for (const example of Object.values(entry.cases)) {
      assert.deepEqual(Object.keys(example), ["form", "english", "czech"]);
      assert.ok(example.form?.trim());
      assert.ok(example.english?.trim());
      assert.ok(example.czech?.trim());
      assert.ok(example.czech.toLocaleLowerCase("cs-CZ").includes(example.form.toLocaleLowerCase("cs-CZ")));
    }
  }
});

test("the base stays fixed while eighteen difficulty-ranked noun pages demonstrate all seven cases", () => {
  const examples = pack.flatMap((entry) => Object.values(entry.cases));
  for (const [caseName, meaning, question] of [
    ["Nominative", "naming or subject", "Who or what is the subject?"],
    ["Genitive", "belonging, origin, or absence", "Whose? From or without whom or what?"],
    ["Dative", "receiver or beneficiary", "Who or what receives or benefits?"],
    ["Accusative", "direct target", "Who or what is the target?"],
    ["Vocative", "direct address", "Who or what is addressed?"],
    ["Locative", "place or topic after a preposition", "Where, or about whom or what?"],
    ["Instrumental", "companion or means", "With whom, or using what?"]
  ]) {
    assert.match(controller, new RegExp(`case: "${caseName}"[^\n]+meaning: "${meaning}"[^\n]+question: "${question.replace(/[?]/g, "\\?")}"`));
  }
  assert.deepEqual(pack.map((entry) => entry.noun), [
    "Petr", "Jana", "kamarád", "učitelka", "kotě", "Tomáš",
    "doktor", "maminka", "Marie", "Karel", "tatínek", "hrdina",
    "Anna", "Eva", "Martin", "David", "student", "soused"
  ]);
  assert.deepEqual(Object.values(pack[0].cases).map((example) => example.form), [
    "Petr", "Petra", "Petrovi", "Petra", "Petře", "Petrovi", "Petrem"
  ]);
  assert.ok(examples.some((example) => example.czech === "Petr čte."));
  assert.ok(examples.some((example) => example.czech === "Dopis je od Petra."));
  assert.ok(examples.some((example) => example.czech === "Dávám Petrovi knihu."));
  assert.ok(examples.some((example) => example.czech === "Vidím Petra."));
  assert.ok(examples.some((example) => example.czech === "Petře, pojď sem!"));
  assert.ok(examples.some((example) => example.czech === "Mluvím o Petrovi."));
  assert.ok(examples.some((example) => example.czech === "Jdu s Petrem."));
  assert.ok(examples.some((example) => example.czech === "Jdu s Janou."));
  assert.ok(examples.some((example) => example.czech === "Cestuji s kamarádem."));
  assert.ok(examples.some((example) => example.czech === "Jdu s učitelkou."));
  assert.ok(examples.some((example) => example.czech === "Jdu s kotětem."));
  assert.ok(examples.some((example) => example.czech === "Jdu s Tomášem."));
  assert.ok(examples.some((example) => example.czech === "Mluvím s doktorem."));
  assert.ok(examples.some((example) => example.czech === "Jdu s maminkou."));
  assert.ok(examples.some((example) => example.czech === "Jdu s Marií."));
  assert.ok(examples.some((example) => example.czech === "Jdu s Karlem."));
  assert.ok(examples.some((example) => example.czech === "Jdu s tatínkem."));
  assert.ok(examples.some((example) => example.czech === "Jdu s hrdinou."));
  assert.ok(examples.some((example) => example.czech === "Jdu s Annou."));
  assert.ok(examples.some((example) => example.czech === "Pracuji s Evou."));
  assert.ok(examples.some((example) => example.czech === "Cestuji s Martinem."));
  assert.ok(examples.some((example) => example.czech === "Pracuji s Davidem."));
  assert.ok(examples.some((example) => example.czech === "Pracuji se studentem."));
  assert.ok(examples.some((example) => example.czech === "Jdu se sousedem."));
  assert.doesNotMatch(JSON.stringify(pack), /The woman is cooking|Žena vaří|The doer|Who is it about/i);
  assert.doesNotMatch(JSON.stringify(pack), /motion means accusative/i);
});
