import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  StandardWordWorldProvider,
  WordWorldUsageLedger,
  loadStandardWordWorldCorpus,
  migrateWordWorldHistory,
  selectStandardTurn
} from "../../../languages/czech/static/word-net-standard.mjs";

function row(id, difficulty, cs, en, targets = []) {
  return {
    id,
    difficulty,
    cs,
    en,
    cefr: difficulty === 1 ? "A1" : "A2",
    topic: "test",
    targets: targets.map((surface, tokenIndex) => ({ surface, normalized: surface, tokenIndex, playable: true }))
  };
}

function provider({ records, random = () => 0, now = () => 1_000 } = {}) {
  const usageLedger = new WordWorldUsageLedger({ corpusVersion: "test-v1", now });
  return new StandardWordWorldProvider({
    manifest: { corpusVersion: "test-v1" },
    pack: { corpusVersion: "test-v1", records },
    usageLedger,
    random
  });
}

test("keeps level one strictly within very-simple level-one records", () => {
  const corpus = provider({
    records: [
      row("l1", 1, "Pes spí.", "The dog sleeps.", ["Pes"]),
      row("l2", 2, "Pes dnes spí doma.", "The dog sleeps at home today.", ["Pes"]),
      row("l3", 3, "Přestože prší, pes klidně spí doma.", "Although it rains, the dog sleeps calmly at home.", ["pes"])
    ],
    random: () => 0.99
  });

  for (let index = 0; index < 12; index += 1) {
    assert.equal(selectStandardTurn(corpus, { difficulty: 1 })?.record.difficulty, 1);
  }
  assert.deepEqual(corpus.eligible(2).map((record) => record.id), ["l1", "l2"]);
});

test("prefers current-level material while retaining cumulative review", () => {
  const rolls = [0.1, 0, 0.95, 0];
  const corpus = provider({
    records: [
      row("review", 1, "Pes spí.", "The dog sleeps.", ["Pes"]),
      row("current", 2, "Pes běží domů.", "The dog runs home.", ["Pes"])
    ],
    random: () => rolls.shift() ?? 0
  });

  assert.equal(corpus.nextRandom({ difficulty: 2 }).record.id, "current");
  assert.equal(corpus.nextRandom({ difficulty: 2 }).record.id, "review");
});

test("deduplicates immutable rows and cycles through least-used records", () => {
  let now = 1_000;
  const corpus = provider({
    records: [
      row("one", 1, "Pes spí.", "The dog sleeps.", ["Pes"]),
      row("duplicate", 1, "Pes spí.", "A dog is sleeping.", ["Pes"]),
      row("two", 1, "Kočka spí.", "The cat sleeps.", ["Kočka"])
    ],
    random: () => 0,
    now: () => now
  });

  assert.equal(corpus.size, 2);
  const first = corpus.nextRandom({ difficulty: 1 }).record;
  corpus.markUsed(first);
  now += 100;
  const second = corpus.nextRandom({ difficulty: 1 }).record;
  assert.notEqual(second.id, first.id);
  assert.deepEqual(corpus.usage.snapshot().entries[first.id], [1, 1_000]);
});

test("branches only on an exact annotated Czech surface and reports a Standard fallback", () => {
  const corpus = provider({
    records: [
      row("dog", 1, "Vidím psa.", "I see a dog.", ["psa"]),
      row("cat", 1, "Kočka spí.", "The cat sleeps.", ["Kočka"])
    ],
    random: () => 0
  });

  const exact = selectStandardTurn(corpus, {
    generationMode: "selected",
    selectedWord: "PSA",
    difficulty: 1
  });
  assert.equal(exact.record.id, "dog");
  assert.equal(exact.fallback, false);

  const fallback = selectStandardTurn(corpus, {
    generationMode: "selected",
    selectedWord: "neznámé",
    difficulty: 1,
    excludeIds: ["dog"]
  });
  assert.equal(fallback.record.id, "cat");
  assert.equal(fallback.fallback, true);
  assert.equal(fallback.requestedWord, "neznámé");
});

test("does not repeat the current sentence when an exact selected-word branch is exhausted", () => {
  const corpus = provider({
    records: [
      row("only-dog", 1, "Vidím psa.", "I see a dog.", ["psa"]),
      row("cat", 1, "Kočka spí.", "The cat sleeps.", ["Kočka"])
    ],
    random: () => 0
  });

  const next = selectStandardTurn(corpus, {
    generationMode: "selected",
    selectedWord: "psa",
    difficulty: 1,
    excludeIds: ["only-dog"]
  });

  assert.equal(next.record.id, "cat");
  assert.equal(next.fallback, true);
  assert.equal(next.requestedWord, "psa");
});

test("Standard selection has no model dependency or model-call path", () => {
  let modelCalls = 0;
  const runtime = { models: { generate() { modelCalls += 1; } } };
  const corpus = provider({ records: [row("one", 1, "Dům stojí.", "The house stands.", ["Dům"])] });
  const selection = selectStandardTurn(corpus, { difficulty: 1 });

  assert.equal(selection.record.en, "The house stands.");
  assert.equal(modelCalls, 0);
  assert.equal(typeof runtime.models.generate, "function");
});

test("the browser Standard render path cannot call models or contaminate the generated queue", async () => {
  const runtimeSource = await readFile(new URL("../../../languages/czech/static/word-net.js", import.meta.url), "utf8");
  const start = runtimeSource.indexOf("function showStandardPhrase");
  const end = runtimeSource.indexOf("function takeQueuedRandomCandidate", start);
  assert.ok(start >= 0 && end > start);
  const standardPath = runtimeSource.slice(start, end);
  assert.doesNotMatch(standardPath, /models\.generate|requestEnglishTranslation|enrichCurrentPhrase/);
  assert.doesNotMatch(standardPath, /branchQueue|rememberPreparedCandidate/);
  assert.match(runtimeSource, /if \(state\.contentMode === "standard"\) \{\s*void generateStandardFromConfiguredMode/);
  assert.match(
    runtimeSource,
    /state\.contentMode !== "generative" \|\| state\.currentContentMode !== "generative"/,
    "selecting Generative must not start an on-demand model download before a Generative turn runs"
  );
  assert.match(runtimeSource, /phraseRequestId !== state\.phraseRequestId/);
  assert.match(runtimeSource, /generativeTurnActive: false/);
  assert.match(runtimeSource, /if \(!state\.generativeTurnActive \|\| state\.contentMode !== "generative"/);
  assert.match(runtimeSource, /models\.abortDownload\(WORD_NET_MODEL_KEY\)/);
  assert.match(runtimeSource, /models\.abortDownload\(TRANSLATION_MODEL_KEY\)/);
  assert.match(runtimeSource, /if \(mode === "standard"\) abortOptionalGenerationDownloads\(\)/);
  assert.match(runtimeSource, /if \(state\.contentMode === "standard"\) \{\s*abortOptionalGenerationDownloads\(\)/);
  const historyStart = runtimeSource.indexOf("async function showPreviousSentence");
  const historyEnd = runtimeSource.indexOf("function rememberSeenSentence", historyStart);
  const historyPath = runtimeSource.slice(historyStart, historyEnd);
  assert.doesNotMatch(historyPath, /enrichCurrentPhrase|schedulePrefetch/);
  const initStart = runtimeSource.indexOf("async function init()");
  const initPath = runtimeSource.slice(initStart);
  assert.doesNotMatch(
    initPath,
    /state\.generativeTurnActive = true|generateRandomPhrase\(\{ source: "initial" \}\)/,
    "reopening a saved Generative mode must remain idle until the learner explicitly presses Next"
  );
  assert.match(initPath, /restoreSavedGenerativePhraseAtInit/);
  assert.match(runtimeSource, /currentGenerationSource = saved\.source \|\| "history"/);
  assert.match(runtimeSource, /currentGenerationSource = previous\.source \|\| "history"/);
});

test("Standard feedback provenance survives the compact runtime report boundary", async () => {
  const runtimeSource = await readFile(new URL("../../../languages/czech/static/runtime.js", import.meta.url), "utf8");
  for (const field of ["entryId", "contentMode", "corpusVersion", "difficulty"]) {
    assert.match(runtimeSource, new RegExp(`payload\\.feedback\\.${field}`));
  }
});

test("the Word World UI exposes Standard and Generative as independent sentence sources", async () => {
  const html = await readFile(new URL("../../../languages/czech/static/word-net.html", import.meta.url), "utf8");
  assert.match(html, /id="wordNetContentSource"/);
  assert.match(html, /data-content-mode="standard" aria-pressed="true"/);
  assert.match(html, /data-content-mode="generative" aria-pressed="false"/);
  assert.match(html, /guided · offline/);
  assert.match(html, /optional local AI/);
});

test("migrates legacy history and retains complete Standard history metadata", () => {
  const migrated = migrateWordWorldHistory([
    { word: "pes", sentence: "Pes spí." },
    {
      entryId: "std-2",
      word: "kočka",
      cs: "Kočka spí.",
      en: "The cat sleeps.",
      contentMode: "standard",
      source: "standard-corpus",
      corpusVersion: "pilot-v1",
      difficulty: 1,
      sceneQuery: "sleeping cat"
    }
  ]);

  assert.equal(migrated[0].contentMode, "generative");
  assert.equal(migrated[0].sentence, "Pes spí.");
  assert.deepEqual(migrated[1], {
    id: "std-2",
    word: "kočka",
    sentence: "Kočka spí.",
    en: "The cat sleeps.",
    contentMode: "standard",
    source: "standard-corpus",
    corpusVersion: "pilot-v1",
    difficulty: 1,
    sceneQuery: "sleeping cat"
  });
});

test("loads the versioned manifest and its relative compact runtime pack", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (calls.length === 1) {
      return {
        ok: true,
        url: "https://example.test/cz/data/word-world/manifest.json",
        async json() {
          return { corpusVersion: "pilot-v1", runtimeFile: "standard-v0.1/records.json" };
        }
      };
    }
    return {
      ok: true,
      async json() {
        return {
          corpusVersion: "pilot-v1",
          records: [row("one", 1, "Dům stojí.", "The house stands.", ["Dům"])]
        };
      }
    };
  };

  const corpus = await loadStandardWordWorldCorpus({ fetchImpl });
  assert.equal(corpus.size, 1);
  assert.equal(calls[0].options.cache, "reload");
  assert.equal(calls[1].url, "https://example.test/cz/data/word-world/standard-v0.1/records.json");
});

test("the shipped runtime pack URL is addressed by its content hash", async () => {
  const manifest = JSON.parse(await readFile(
    new URL("../../../languages/czech/static/data/word-world/manifest.json", import.meta.url),
    "utf8"
  ));
  assert.match(
    manifest.runtimeFile,
    new RegExp(`\\?v=${manifest.contentSha256.slice(0, 16)}$`)
  );
  const serviceWorker = await readFile(
    new URL("../../../languages/czech/static/sw.js", import.meta.url),
    "utf8"
  );
  assert.match(
    serviceWorker,
    new RegExp(`data/word-world/${manifest.runtimeFile.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`)
  );
});
