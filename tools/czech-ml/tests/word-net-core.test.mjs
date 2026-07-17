import assert from "node:assert/strict";
import test from "node:test";
import {
  cleanGeneratedSentence,
  sentenceIncludesWord,
} from "../../../apps/languages/czech/static/word-net-core.mjs";

const fallback = (word) => `Vidím ${word} doma.`;

test("keeps a generated sentence containing the exact selected Czech word", () => {
  const result = cleanGeneratedSentence("Věta: Dítě drží košík.", "košík", fallback);
  assert.equal(result, "Dítě drží košík.");
});

test("rejects a fluent sentence that omits the selected word", () => {
  const result = cleanGeneratedSentence("Tatínek vidí vlak.", "stanice", fallback);
  assert.equal(result, "Vidím stanice doma.");
  assert.equal(sentenceIncludesWord(result, "stanice"), true);
});

test("requires the exact surface form instead of a related inflection", () => {
  const result = cleanGeneratedSentence("Tatínek má rád draka.", "tatínkem", fallback);
  assert.equal(result, "Vidím tatínkem doma.");
  assert.equal(sentenceIncludesWord(result, "tatínkem"), true);
});
