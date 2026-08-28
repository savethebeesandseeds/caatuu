import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  countStaticDictionaryEntries,
  createStaticDictionaryApi,
  searchStaticDictionary,
  searchStaticDictionaryWithSupplement
} from "../templates/dictionary-static-core.mjs";
import { selectDictionaryMeaning } from "../../../languages/czech/static/source/games/word-world/word-net-core.mjs";

const testDir = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(testDir, "../../../..");
const rows = JSON.parse(readFileSync(
  join(workspaceRoot, "apps/languages/czech/static/data/games/verb-nebula/core-vocabulary.json"),
  "utf8"
));
const supplement = JSON.parse(readFileSync(
  join(workspaceRoot, "apps/launcher/tooling/data/word-world-static-dictionary.v1.json"),
  "utf8"
));

test("static dictionary preserves the complete curated core", () => {
  assert.equal(rows.length, 865);
  assert.equal(countStaticDictionaryEntries(rows), 863);
  for (const [index, row] of rows.entries()) {
    for (const key of ["cat", "cs", "en", "kind", "cue", "use"]) {
      assert.ok(String(row[key] || "").trim(), `row ${index} is missing ${key}`);
    }
  }
});

test("static dictionary ranks Czech exact, accent-folded, and prefix matches", () => {
  const exact = searchStaticDictionary(rows, "děkuji");
  assert.equal(exact.results[0].lemma, "děkuji");
  assert.equal(exact.results[0].matchedBy, "lemma");

  const folded = searchStaticDictionary(rows, "dekuji");
  assert.equal(folded.results[0].lemma, "děkuji");

  const prefix = searchStaticDictionary(rows, "děk");
  assert.ok(prefix.results.some((entry) => entry.lemma === "děkuji"));
});

test("static dictionary merges duplicate teaching rows without losing meanings or examples", () => {
  const account = searchStaticDictionary(rows, "účet").results.find((entry) => entry.lemma === "účet");
  assert.deepEqual(account.senses.map((sense) => sense.gloss), ["bill", "account"]);

  const thermometer = searchStaticDictionary(rows, "teploměr").results.find((entry) => entry.lemma === "teploměr");
  assert.equal(thermometer.senses.length, 1);
  assert.deepEqual(
    thermometer.senses[0].examples.map((example) => example.text),
    ["Teploměr ukazuje teplotu.", "Máte teploměr?"]
  );
});

test("static dictionary preserves inflected Word World lookups without the full database", () => {
  assert.equal(supplement.schema_name, "caatuu-static-word-world-dictionary");
  assert.equal(supplement.schema_version, 1);
  assert.equal(supplement.surface_count, 1277);
  assert.equal(supplement.resolved_surface_count, 1195);
  assert.equal(supplement.unresolved_surfaces.length, 82);
  const payload = searchStaticDictionaryWithSupplement(rows, supplement, "cítím", { limit: 8 });
  const selected = selectDictionaryMeaning(payload, "cítím", { maxGlosses: 2 });
  assert.equal(selected.lemma, "cítit");
  assert.match(selected.meaning, /feel/u);
});

test("static dictionary handles empty, missing, bounded, and aborted searches", async () => {
  assert.deepEqual(searchStaticDictionary(rows, "").results, []);
  assert.deepEqual(searchStaticDictionary(rows, "definitely-not-a-czech-entry").results, []);
  assert.ok(searchStaticDictionary(rows, "a", { limit: 1000 }).results.length <= 60);

  const api = createStaticDictionaryApi({ rows, supplement });
  const status = await api.status();
  assert.deepEqual(
    { recordCount: status.recordCount, entryCount: status.entryCount, available: status.available, downloadRequired: status.downloadRequired },
    { recordCount: 865, entryCount: 863, available: true, downloadRequired: false }
  );
  assert.deepEqual(await api.download(), status);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(api.search("děkuji", { signal: controller.signal }), { name: "AbortError" });
});
