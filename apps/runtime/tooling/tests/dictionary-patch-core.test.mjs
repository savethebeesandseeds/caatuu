import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  DICTIONARY_PATCH_SCHEMA,
  DictionaryPatchValidationError,
  compileDictionaryPatch,
  dedupeDictionaryResults,
  discoverDictionaryAliasTargets,
  materializeDictionaryAliasResults,
  mergeDictionarySearchPayload,
  normalizeCzechPatchSearch,
  searchDictionaryPatch,
  stableDictionaryPatchRecordId,
  tryCompileDictionaryPatch
} from "../../../../apps/languages/czech/static/dictionary-patch-core.mjs";

const review = {
  status: "codex_reviewed",
  reviewer: "Codex task dictionary-gap-review-2026-08-01",
  reviewedOn: "2026-08-01",
  humanApproved: false,
  evidence: [{
    label: "Czech Wiktionary entry",
    url: "https://cs.wiktionary.org/wiki/%C5%BElu%C5%A5ou%C4%8Dk%C3%BD",
    note: "Lemma, form, and learner gloss checked manually."
  }],
  sourceLicense: {
    name: "CC-BY-SA-4.0",
    url: "https://creativecommons.org/licenses/by-sa/4.0/",
    attribution: "Czech Wiktionary contributors"
  }
};

function patchDocument(records = []) {
  return {
    schema: DICTIONARY_PATCH_SCHEMA,
    dictionaryKey: "kaikki-cs-en-2026-07-09",
    direction: "cs-en",
    records
  };
}

function addedEntry() {
  return {
    kind: "add-entry",
    lemma: "žluťoučký",
    pos: "adjective",
    sourceUrl: "https://cs.wiktionary.org/wiki/%C5%BElu%C5%A5ou%C4%8Dk%C3%BD",
    forms: [{ form: "žluťoučká", tags: ["feminine", "singular"] }],
    senses: [{
      gloss: "very yellow",
      rawGloss: "very yellow",
      tags: ["diminutive"],
      topics: ["colors"],
      synonyms: ["žlutý"],
      antonyms: [],
      examples: [{ text: "Žluťoučká kytka.", english: "A very yellow flower.", tags: [] }]
    }],
    review
  };
}

function formAlias() {
  return {
    kind: "form-alias",
    form: "řekněme",
    tags: ["imperative", "first-person", "plural"],
    target: { lemma: "říci", pos: "verb" },
    review
  };
}

test("the tracked reviewed overlay starts empty and compiles", async () => {
  const url = new URL(
    "../../../../apps/languages/czech/static/data/dictionaries/patches/reviewed-cs-en.v1.json",
    import.meta.url
  );
  const raw = JSON.parse(await readFile(url, "utf8"));
  const patch = compileDictionaryPatch(raw);

  assert.equal(patch.schema, DICTIONARY_PATCH_SCHEMA);
  assert.equal(patch.dictionaryKey, "kaikki-cs-en-2026-07-09");
  assert.deepEqual(patch.entries, []);
  assert.deepEqual(patch.aliases, []);
  assert.equal(Object.isFrozen(patch), true);
});

test("strict compilation requires consistent review provenance, evidence, licensing, and known fields", () => {
  const unsafe = addedEntry();
  unsafe.review = {
    status: "draft",
    reviewer: "",
    reviewedOn: "2026-02-30",
    humanApproved: false,
    evidence: [],
    sourceLicense: { name: "unknown", url: "javascript:alert(1)" }
  };
  unsafe.privateNote = "must not pass through";

  const result = tryCompileDictionaryPatch(patchDocument([unsafe]));
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /privateNote is not allowed/);
  assert.match(result.errors.join("\n"), /status must be "codex_reviewed" or "human_approved"/);
  assert.match(result.errors.join("\n"), /real calendar date/);
  assert.match(result.errors.join("\n"), /at least one evidence item/);
  assert.match(result.errors.join("\n"), /HTTPS URL/);
  assert.throws(
    () => compileDictionaryPatch(patchDocument([unsafe])),
    DictionaryPatchValidationError
  );

  const inconsistent = addedEntry();
  inconsistent.review = { ...review, status: "human_approved", humanApproved: false };
  const inconsistentResult = tryCompileDictionaryPatch(patchDocument([inconsistent]));
  assert.equal(inconsistentResult.ok, false);
  assert.match(inconsistentResult.errors.join("\n"), /inconsistent with status "human_approved"/);

  const humanApproved = addedEntry();
  humanApproved.review = { ...review, status: "human_approved", humanApproved: true, reviewer: "A. Human" };
  assert.equal(tryCompileDictionaryPatch(patchDocument([humanApproved])).ok, true);

  const missingAttribution = addedEntry();
  missingAttribution.review = {
    ...review,
    sourceLicense: { ...review.sourceLicense, attribution: "" }
  };
  assert.match(
    tryCompileDictionaryPatch(patchDocument([missingAttribution])).errors.join("\n"),
    /sourceLicense\.attribution is required/
  );

  const wrongBasePack = patchDocument([]);
  wrongBasePack.dictionaryKey = "different-dictionary-build";
  assert.match(
    tryCompileDictionaryPatch(wrongBasePack).errors.join("\n"),
    /dictionaryKey must be "kaikki-cs-en-2026-07-09"/
  );
});

test("malformed objects and getters are rejected without executing a partial patch", () => {
  const hostile = Object.create({ inherited: "data" });
  Object.defineProperty(hostile, "schema", {
    enumerable: true,
    get() { throw new Error("hostile getter"); }
  });

  assert.deepEqual(tryCompileDictionaryPatch(hostile), {
    ok: false,
    errors: ["$ must be an object."]
  });
  assert.deepEqual(searchDictionaryPatch(hostile, "anything").results, []);
});

test("stable IDs do not depend on property insertion order and duplicate records fail", () => {
  const first = formAlias();
  const reordered = {
    review: first.review,
    target: { pos: "verb", lemma: "říci" },
    tags: first.tags,
    form: first.form,
    kind: first.kind
  };
  const firstId = stableDictionaryPatchRecordId(first, "kaikki-cs-en-2026-07-09");
  const secondId = stableDictionaryPatchRecordId(reordered, "kaikki-cs-en-2026-07-09");

  assert.match(firstId, /^dp1-alias-[0-9a-f]{16}$/u);
  assert.equal(firstId, secondId);
  const duplicate = tryCompileDictionaryPatch(patchDocument([first, reordered]));
  assert.equal(duplicate.ok, false);
  assert.match(duplicate.errors.join("\n"), /duplicates \$\.records\[0\]/);
});

test("patch entries search Czech text accent-insensitively and return API-shaped data", () => {
  const patch = compileDictionaryPatch(patchDocument([addedEntry()]));
  assert.equal(normalizeCzechPatchSearch("  ŽLUŤOUČKÝ  "), "zlutoucky");

  const lemmaResult = searchDictionaryPatch(patch, "ZLUTOUCKY", { prefix: false });
  assert.equal(lemmaResult.returned, 1);
  assert.equal(lemmaResult.results[0].matchedBy, "lemma");
  assert.equal(lemmaResult.results[0].matchedTerm, "žluťoučký");
  assert.equal(lemmaResult.results[0].senses[0].gloss, "very yellow");
  assert.match(lemmaResult.results[0].id, /^dp1-entry-/u);

  const formResult = searchDictionaryPatch(patch, "zlutoucka", { prefix: false });
  assert.equal(formResult.results[0].matchedBy, "form");
  assert.equal(formResult.results[0].matchedTerm, "žluťoučká");
  assert.deepEqual(formResult.results[0].forms[0].tags, ["feminine", "singular"]);
});

test("form aliases expose target requests and materialize only from matching base lemma and POS", () => {
  const patch = compileDictionaryPatch(patchDocument([formAlias()]));
  const targets = discoverDictionaryAliasTargets(patch, "REKNEME", { prefix: false });
  assert.deepEqual(targets, [{
    lemma: "říci",
    pos: "verb",
    aliasIds: [stableDictionaryPatchRecordId(formAlias(), patch.dictionaryKey)],
    forms: [{ form: "řekněme", tags: ["imperative", "first-person", "plural"] }]
  }]);

  const basePayload = {
    results: [
      {
        id: 42,
        lemma: "říci",
        pos: "verb",
        sourceUrl: "https://kaikki.org/dictionary/Czech/meaning/r/%C5%99/%C5%99%C3%ADci.html",
        matchedBy: "lemma",
        matchedTerm: "říci",
        forms: [{ form: "řekl", tags: ["past"] }],
        senses: [{ sourceSenseId: "sense-1", position: 1, gloss: "to say", tags: ["perfective"] }]
      },
      {
        id: 43,
        lemma: "říci",
        pos: "noun",
        forms: [],
        senses: [{ gloss: "wrong POS" }]
      }
    ]
  };
  const results = materializeDictionaryAliasResults(patch, "rekneme", basePayload, { prefix: false });

  assert.equal(results.length, 1);
  assert.equal(results[0].id, 42);
  assert.equal(results[0].matchedBy, "form");
  assert.equal(results[0].matchedTerm, "řekněme");
  assert.match(results[0].patchId, /^dp1-alias-/u);
  assert.deepEqual(results[0].forms.at(-1), {
    form: "řekněme",
    tags: ["imperative", "first-person", "plural"]
  });
  assert.equal(results[0].senses[0].gloss, "to say");
});

test("merge and dedupe prefer overlay results and bound malformed input", () => {
  const base = {
    query: "řekněme",
    direction: "cs-en",
    limit: 30,
    results: [
      {
        id: 42,
        lemma: "říci",
        pos: "verb",
        matchedBy: "lemma",
        matchedTerm: "říci",
        forms: [],
        senses: [{
          gloss: "to say",
          examples: [{ text: "Řeknu to.", english: "I will say it.", tags: ["future"] }]
        }]
      },
      { id: 44, lemma: "mluvit", pos: "verb", forms: [], senses: [{ gloss: "to speak" }] },
      null,
      { id: 45, lemma: "", pos: "verb" }
    ]
  };
  const overlay = {
    results: [
      { id: 42, lemma: "říci", pos: "verb", matchedBy: "form", matchedTerm: "řekněme", forms: [], senses: [{ gloss: "to say" }] },
      { id: "patch-entry", lemma: "řekněme", pos: "phrase", forms: [], senses: [{ gloss: "let us say" }] }
    ]
  };

  const deduped = dedupeDictionaryResults([overlay, base]);
  assert.deepEqual(deduped.map((entry) => entry.id), [42, "patch-entry", 44]);
  assert.equal(deduped[0].matchedBy, "form");

  const merged = mergeDictionarySearchPayload(base, overlay, { limit: 2 });
  assert.equal(merged.returned, 2);
  assert.equal(merged.results[0].matchedTerm, "řekněme");
  assert.deepEqual(merged.results.map((entry) => entry.id), [42, "patch-entry"]);

  const baseOnly = mergeDictionarySearchPayload(base, { results: [] }, { limit: 2 });
  assert.deepEqual(baseOnly.results[0].senses[0].examples, [{
    text: "Řeknu to.",
    english: "I will say it.",
    tags: ["future"]
  }]);
});

test("the shared runtime applies the reviewed overlay to browser and Android searches", async () => {
  const runtimeUrl = new URL(
    "../../../../apps/languages/czech/static/runtime.js",
    import.meta.url
  );
  const runtime = await readFile(runtimeUrl, "utf8");

  assert.match(runtime, /const dictionaryPatchPath = "data\/dictionaries\/patches\/reviewed-cs-en\.v1\.json"/);
  assert.match(runtime, /import\("\.\/dictionary-patch-core\.mjs\?v=dictionary-patch-core-1"\)/);
  assert.match(runtime, /patch: core\.compileDictionaryPatch\(rawPatch\)/);
  assert.match(runtime, /if \(env === "android"\) \{\s*return nativeCall\(\s*"dictionary_search"/);
  assert.match(runtime, /return browserDictionarySearch\(query, \{ \.\.\.options, limit \}\)/);
  assert.match(runtime, /async function searchDictionaryWithPatch\(query, options = \{\}\)/);
  assert.match(runtime, /core\.discoverDictionaryAliasTargets\(patch, query, \{ prefix: false \}\)/);
  assert.match(runtime, /core\.materializeDictionaryAliasResults\([\s\S]*?\{ limit, prefix: false \}/);
  assert.match(runtime, /core\.mergeDictionarySearchPayload/);
  assert.match(runtime, /search\(query, options = \{\}\) \{\s*return searchDictionaryWithPatch\(query, options\);/);
});
