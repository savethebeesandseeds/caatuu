import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { importBrowserLanguageAdapter } from "../../../apps/language-runtime/tests/browser-module-loader.mjs";
import { auditDictionaryContentDocuments } from "../lib/dictionary-content-audit.mjs";

const czech = await importBrowserLanguageAdapter(
  "../../languages/czech/static/source/language/adapter.mjs"
);

async function readJson(relativeUrl) {
  return JSON.parse(await readFile(new URL(relativeUrl, import.meta.url), "utf8"));
}

test("the current Czech dictionary is target/English complete at the build boundary", async () => {
  const [catalog, coreEntries, scripts] = await Promise.all([
    readJson("../../../apps/languages/czech/static/data/dictionaries/catalog.json"),
    readJson("../../../apps/languages/czech/static/data/games/verb-nebula/core-vocabulary.json"),
    readJson("../../../apps/languages/czech/static/data/language/scripts.json")
  ]);
  assert.deepEqual(auditDictionaryContentDocuments({
    adapter: czech,
    catalog,
    coreEntries,
    scripts,
    sourceLanguageId: "en",
    targetLanguageId: "cs",
    targetLanguageLocale: "cs-CZ",
    targetLanguageScript: "Latn"
  }), []);
});

test("dictionary audit rejects empty providers and missing target or English text", () => {
  const base = {
    catalog: {
      default_dictionary: "fixture",
      dictionaries: [{
        key: "fixture",
        status: "active",
        lookupLanguage: "cs",
        lookupLanguageTag: "cs-CZ",
        meaningLanguage: "en",
        meaningLanguageTag: "en"
      }]
    },
    coreEntries: [{ targetText: "příběh", englishAuditText: "story" }],
    scripts: [{ lines: [{ targetText: "Dobrý den.", englishAuditText: "Hello." }] }],
    sourceLanguageId: "en",
    targetLanguageId: "cs",
    targetLanguageLocale: "cs-CZ",
    targetLanguageScript: "Latn"
  };

  for (const [mutate, code] of [
    [(candidate) => { candidate.catalog.dictionaries = []; }, "dictionary.catalog"],
    [(candidate) => { delete candidate.coreEntries[0].englishAuditText; }, "dictionary.presentation"],
    [(candidate) => { delete candidate.scripts[0].lines[0].targetText; }, "dictionary.presentation"],
    [(candidate) => { candidate.catalog.dictionaries[0].meaningLanguage = "fr"; }, "dictionary.language"]
  ]) {
    const candidate = structuredClone(base);
    mutate(candidate);
    assert.ok(
      auditDictionaryContentDocuments({ ...candidate, adapter: czech })
        .some((issue) => issue.code === code),
      code
    );
  }
});

test("a synthetic third-language adapter uses the same canonical dictionary audit", () => {
  const syntheticAdapter = {
    ...czech,
    id: "synthetic-third",
    languageTags: {
      primary: "tl",
      locale: "tl",
      html: "tl",
      fallbacks: ["tl"]
    }
  };
  const issues = auditDictionaryContentDocuments({
    adapter: syntheticAdapter,
    catalog: {
      default_dictionary: "fixture-tl-en",
      dictionaries: [{
        key: "fixture-tl-en",
        status: "active",
        lookupLanguage: "tl",
        lookupLanguageTag: "tl",
        meaningLanguage: "en",
        meaningLanguageTag: "en"
      }]
    },
    coreEntries: [{ targetText: "Kuwento", englishAuditText: "story" }],
    scripts: [{ lines: [{ targetText: "Kumusta.", englishAuditText: "Hello." }] }],
    sourceLanguageId: "fr",
    targetLanguageId: "tl",
    targetLanguageLocale: "tl",
    targetLanguageScript: "Latn"
  });
  assert.deepEqual(issues, []);
});

test("dictionary audit distinguishes target script variants with the same primary ID", () => {
  const simplifiedAdapter = {
    ...czech,
    id: "synthetic-hans",
    languageTags: {
      primary: "zh-Hans",
      locale: "zh-Hans",
      html: "zh-Hans",
      fallbacks: ["zh-Hans"]
    }
  };
  const issues = auditDictionaryContentDocuments({
    adapter: simplifiedAdapter,
    catalog: {
      default_dictionary: "fixture-zh-hant-en",
      dictionaries: [{
        key: "fixture-zh-hant-en",
        status: "active",
        lookupLanguage: "zh",
        lookupLanguageTag: "zh-Hant",
        meaningLanguage: "en",
        meaningLanguageTag: "en"
      }]
    },
    coreEntries: [{ targetText: "故事", englishAuditText: "story" }],
    scripts: [{ lines: [{ targetText: "你好。", englishAuditText: "Hello." }] }],
    sourceLanguageId: "en",
    targetLanguageId: "zh",
    targetLanguageLocale: "zh-Hans",
    targetLanguageScript: "Hans"
  });
  assert.equal(issues.some(({ message }) => /lookupLanguageTag/u.test(message)), true);
});
