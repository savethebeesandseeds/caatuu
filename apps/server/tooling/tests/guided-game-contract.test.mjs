import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const staticRoot = new URL("../../../languages/czech/static/", import.meta.url);
const appEntry = new URL("../../../language-runtime/static/app/index.html", import.meta.url);
const productWordWorld = new URL("../../../language-runtime/static/source/product-word-world.mjs", import.meta.url);
const wordWorldProviderUrl = new URL("../../../language-runtime/static/source/word-world-provider.mjs", import.meta.url);
const [app, indexHtml, comet, cometHtml, wordWorld, wordWorldProvider, wordWorldHtml, verbs, scripts] = await Promise.all([
  readFile(new URL("../../../language-runtime/static/source/caatuu-workspace.js", import.meta.url), "utf8"),
  readFile(appEntry, "utf8"),
  readFile(new URL("source/games/conjugation-comet/conjugation-comet.js", staticRoot), "utf8"),
  readFile(new URL("conjugation-comet.html", staticRoot), "utf8"),
  readFile(productWordWorld, "utf8"),
  readFile(wordWorldProviderUrl, "utf8"),
  readFile(new URL("word-net.html", staticRoot), "utf8"),
  readFile(new URL("data/games/conjugation-comet/verbs.json", staticRoot), "utf8").then(JSON.parse),
  readFile(new URL("data/language/scripts.json", staticRoot), "utf8").then(JSON.parse)
]);

function functionSource(source, name, nextName) {
  const start = source.indexOf(`function ${name}`);
  const end = source.indexOf(`function ${nextName}`, start + 1);
  assert.ok(start >= 0 && end > start, `${name} source boundary must exist`);
  return source.slice(start, end);
}

test("shared practice scripts model child-safe privacy behavior", () => {
  assert.deepEqual(scripts[3].lines[1], {
    cs: "Tady je potvrzení rezervace.",
    en: "Here is the booking confirmation."
  });
  assert.deepEqual(scripts[5].lines[2], {
    cs: "Tady je vyplněný formulář.",
    en: "Here is the completed form."
  });
  assert.deepEqual(scripts[6].lines[1], {
    cs: "Jak se připojím?",
    en: "How do I connect?"
  });
  assert.doesNotMatch(JSON.stringify(scripts), /passport|signature|password|\bpas\b|podpis|heslo/iu);
});
