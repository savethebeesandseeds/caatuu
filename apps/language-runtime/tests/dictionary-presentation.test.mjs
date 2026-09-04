import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  LANGUAGE_CAPABILITIES,
  presentDictionaryEntry,
  supportsLanguageCapability
} from "../contract.mjs";
import { importBrowserLanguageAdapter } from "./browser-module-loader.mjs";

const [czech, mandarin] = await Promise.all([
  importBrowserLanguageAdapter("../../languages/czech/static/source/language/adapter.mjs"),
  importBrowserLanguageAdapter("../../languages/mandarin-simplified/static/source/language/adapter.mjs")
]);

async function readJson(relativeUrl) {
  return JSON.parse(await readFile(new URL(relativeUrl, import.meta.url), "utf8"));
}

test("Czech legacy records cross the shared target/English presentation boundary", () => {
  const presentation = presentDictionaryEntry(czech, {
    cat: "Basics",
    cs: "příběh",
    en: "story",
    kind: "noun",
    use: "To je příběh.",
    cue: "masculine"
  }, {
    sourceLanguageId: "en",
    targetLanguageId: "cs"
  });

  assert.deepEqual(presentation, {
    targetText: "příběh",
    englishAuditText: "story",
    category: "Basics",
    partOfSpeech: "noun",
    exampleTargetText: "To je příběh.",
    usageNote: "masculine"
  });
  assert.equal(Object.isFrozen(presentation), true);
  assert.equal(
    supportsLanguageCapability(czech, LANGUAGE_CAPABILITIES.DICTIONARY_PRESENTATION),
    true
  );
});

test("Mandarin accepts canonical target and explicit English audit text for every learner base", () => {
  const presentation = presentDictionaryEntry(mandarin, {
    target: "银行",
    englishAuditText: "bank",
    source: "banco",
    category: "places",
    kind: "noun"
  }, {
    sourceLanguageId: "es",
    targetLanguageId: "zh"
  });

  assert.equal(presentation.targetText, "银行");
  assert.equal(presentation.englishAuditText, "bank");
  assert.equal(presentation.category, "places");
  assert.equal(presentation.partOfSpeech, "noun");
});

test("Mandarin only treats source as English when the learner base is English", () => {
  const currentRecord = { target: "有", source: "have", kind: "verb" };
  assert.equal(
    presentDictionaryEntry(mandarin, currentRecord, { sourceLanguageId: "en-US" }).englishAuditText,
    "have"
  );
  assert.throws(
    () => presentDictionaryEntry(mandarin, currentRecord, { sourceLanguageId: "es" }),
    /englishAuditText must be a non-empty string/u
  );
});

test("both current course-owned core catalogs satisfy the presentation seam", async () => {
  const [czechRecords, mandarinRecords] = await Promise.all([
    readJson("../../languages/czech/static/data/games/verb-nebula/core-vocabulary.json"),
    readJson("../../languages/mandarin-simplified/static/data/games/verb-nebula/core-vocabulary.json")
  ]);
  const czechPresentations = czechRecords.map((record, recordIndex) => presentDictionaryEntry(
    czech,
    record,
    { sourceLanguageId: "en", targetLanguageId: "cs", recordIndex }
  ));
  const mandarinPresentations = mandarinRecords.map((record, recordIndex) => presentDictionaryEntry(
    mandarin,
    record,
    { sourceLanguageId: "en", targetLanguageId: "zh", recordIndex }
  ));

  assert.equal(czechPresentations.length, czechRecords.length);
  assert.equal(mandarinPresentations.length, mandarinRecords.length);
  assert.equal(czechPresentations.every((entry) => entry.targetText && entry.englishAuditText), true);
  assert.equal(mandarinPresentations.every((entry) => entry.targetText && entry.englishAuditText), true);
});

test("current Czech script lines use the same target/English presentation contract", async () => {
  const scripts = await readJson("../../languages/czech/static/data/language/scripts.json");
  const presentations = scripts.flatMap((script, scriptIndex) => script.lines.map(
    (record, recordIndex) => presentDictionaryEntry(czech, record, {
      sourceLanguageId: "en",
      targetLanguageId: "cs",
      recordKind: "script-line",
      scriptIndex,
      recordIndex
    })
  ));

  assert.ok(presentations.length > 0);
  assert.equal(presentations.every((entry) => entry.targetText && entry.englishAuditText), true);
});

test("dictionary presentation fails closed without its hook or mandatory English", () => {
  const adapterWithoutPresentation = {
    ...mandarin,
    dictionary: { ...mandarin.dictionary, presentEntry: null },
    capabilities: mandarin.capabilities.filter(
      (capability) => capability !== LANGUAGE_CAPABILITIES.DICTIONARY_PRESENTATION
    )
  };

  assert.throws(
    () => presentDictionaryEntry(adapterWithoutPresentation, { target: "银行", englishAuditText: "bank" }),
    /missing capabilities: dictionary\.presentation/u
  );
  assert.throws(
    () => presentDictionaryEntry(czech, { cs: "příběh" }),
    /englishAuditText must be a non-empty string/u
  );
  assert.throws(
    () => presentDictionaryEntry(mandarin, {
      target: { text: "银行" },
      englishAuditText: "bank"
    }),
    /targetText must be a non-empty string/u
  );
});

test("the shared workspace renders and prints canonical presentations, not language fields", async () => {
  const source = await readFile(
    new URL("../static/source/caatuu-workspace.js", import.meta.url),
    "utf8"
  );
  assert.match(source, /presentDictionaryEntry/u);
  assert.match(source, /countryDictionaryPresentations/u);
  assert.match(source, /requiredDictionaryContentPath\("coreEntries"\)/u);
  assert.match(source, /requiredDictionaryContentPath\("scriptLines"\)/u);
  assert.doesNotMatch(source, /loadJson\("data\/language\/scripts\.json"\)/u);

  const coreRenderer = source.slice(
    source.indexOf("function dictionarySearchText"),
    source.indexOf("function renderScripts")
  );
  assert.match(coreRenderer, /item\.targetText/u);
  assert.match(coreRenderer, /item\.englishAuditText/u);
  assert.doesNotMatch(coreRenderer, /item\.(?:cs|en)\b/u);

  const printRenderer = source.slice(
    source.indexOf("function renderPrintDictionaryRows"),
    source.indexOf("function createDictionaryPageMeasure")
  );
  assert.match(printRenderer, /item\.targetText/u);
  assert.match(printRenderer, /item\.englishAuditText/u);
  assert.doesNotMatch(printRenderer, /item\.(?:cs|en)\b/u);
  assert.doesNotMatch(source, /line\.(?:cs|en)\b/u);
});

test("the shared dictionary layout is neutral and course resources own reference and provider content", async () => {
  const [app, bootstrap, reference] = await Promise.all([
    readFile(new URL("../static/app/index.html", import.meta.url), "utf8"),
    readFile(new URL("../static/source/app-bootstrap.mjs", import.meta.url), "utf8"),
    readFile(new URL("../../languages/czech/static/data/dictionaries/reference.html", import.meta.url), "utf8")
  ]);
  const dictionaryView = app.slice(
    app.indexOf('id="view-dictionary"'),
    app.indexOf('id="view-verbs"')
  );
  assert.match(dictionaryView, /id="dictionaryReferenceContent"/u);
  assert.doesNotMatch(dictionaryView, /Czech|město|žena|genitive/u);
  assert.match(reference, /město/u);
  assert.match(reference, /Cases are operations/u);
  assert.match(bootstrap, /initializeWorkspaceAfterDictionaryProvider/u);
  assert.ok(
    bootstrap.indexOf("initializeWorkspaceAfterDictionaryProvider")
      < bootstrap.indexOf("caatuu-workspace.js")
  );
  assert.doesNotMatch(bootstrap, /loadScript\("source\/features\/dictionary\/dictionary-full\.js/u);
});

test("workspace initialization never owns initial service-worker registration", async () => {
  const [workspace, bootstrap] = await Promise.all([
    readFile(new URL("../static/source/caatuu-workspace.js", import.meta.url), "utf8"),
    readFile(new URL("../static/source/app-bootstrap.mjs", import.meta.url), "utf8")
  ]);
  const init = workspace.slice(
    workspace.indexOf("async function init()"),
    workspace.indexOf("function registerServiceWorker()")
  );
  assert.doesNotMatch(init, /registerServiceWorker\(\)/u);
  assert.match(bootstrap, /await loadCourseFeatureProviders\(\)[\s\S]*await registerCourseServiceWorker\(\)/u);
});
