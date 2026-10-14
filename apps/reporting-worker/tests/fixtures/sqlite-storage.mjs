import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { handleRequest } from "../../src/index.mjs";
import { REPORTING_POLICY, SENTENCE_REPORT_SCHEMA } from "../../src/contracts.mjs";

class Database {
  constructor() {
    this.sqlite = new DatabaseSync(":memory:");
    this.sqlite.exec(readFileSync(new URL("../../migrations/0001_reporting.sql", import.meta.url), "utf8"));
  }
  prepare(sql) {
    const database = this;
    const statement = this.sqlite.prepare(sql);
    const bound = (parameters) => ({
      bind: (...values) => bound(values),
      first: async () => {
        const row = statement.get(...parameters) || null;
        if (sql.includes("SELECT 1 AS present")) database.afterGapRead?.();
        return row;
      },
      run: async () => {
        await database.beforeWrite?.();
        const result = statement.run(...parameters);
        return { success: true, meta: { changes: result.changes } };
      }
    });
    return bound([]);
  }
  pairWrites() {
    let release;
    const ready = new Promise((resolve) => { release = resolve; });
    let arrivals = 0;
    this.beforeWrite = async () => {
      if (++arrivals === 2) release();
      await ready;
    };
  }
}

const post = (route, report) => new Request(`https://caatuu.waajacu.com${route}`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-caatuu-reporting-policy": REPORTING_POLICY },
  body: JSON.stringify(report)
});
const environment = (DB) => ({
  DB,
  SENTENCE_RATE_LIMITER: { limit: async () => ({ success: true }) },
  DICTIONARY_RATE_LIMITER: { limit: async () => ({ success: true }) }
});
const sentence = {
  schema: SENTENCE_REPORT_SCHEMA,
  clientReportId: "8a3ab972-c925-4d31-a9b8-0e339d32c88a",
  sentence: "Tohle je věta.", translation: "This is a sentence.",
  reason: "wrong_translation", comment: "", entryId: "fixture-1",
  contentMode: "standard", corpusVersion: "fixture-v1"
};

for (const conflicting of [false, true]) {
  const database = new Database();
  try {
    database.pairWrites();
    const reports = [sentence, { ...sentence, comment: conflicting ? "Different" : "" }];
    const responses = await Promise.all(reports.map((report) =>
      handleRequest(post("/api/sentence-reports", report), environment(database))
    ));
    assert.deepEqual(responses.map(({ status }) => status).sort(), conflicting ? [200, 409] : [200, 200]);
    if (!conflicting) {
      const results = await Promise.all(responses.map((response) => response.json()));
      assert.deepEqual(results.map(({ deduplicated }) => deduplicated).sort(), [false, true]);
    }
    const winner = responses.findIndex(({ status }) => status === 200);
    assert.equal(database.sqlite.prepare("SELECT comment FROM sentence_reports").get().comment, reports[winner].comment);
    assert.equal(database.sqlite.prepare("SELECT COUNT(*) AS count FROM sentence_reports").get().count, 1);
  } finally { database.sqlite.close(); }
}

const database = new Database();
try {
  const seed = database.sqlite.prepare(`
    INSERT INTO dictionary_gaps VALUES (
      'kaikki-cs-en-2026-07-09', 'cs-en', ?1, ?1, 'no_results', 0, 1, 1, 1
    )
  `);
  for (let index = 0; index < 4095; index += 1) seed.run(`existing-${index}`);
  const gap = {
    schema: "caatuu.dictionary-gap-report.v1", targetWord: "Příklad", normalizedWord: "příklad",
    dictionaryKey: "kaikki-cs-en-2026-07-09", dictionaryDirection: "cs-en",
    lookupOutcome: "no_results", lookupReturned: 0
  };
  const reports = [gap, { ...gap, targetWord: "Jiný", normalizedWord: "jiný" }];
  database.pairWrites();
  const responses = await Promise.all(reports.map((report) =>
    handleRequest(post("/cz/api/dictionary/gaps", report), environment(database))
  ));
  assert.deepEqual(responses.map(({ status }) => status).sort(), [200, 507]);
  assert.equal(database.sqlite.prepare("SELECT COUNT(*) AS count FROM dictionary_gaps").get().count, 4096);
  database.beforeWrite = undefined;
  const winner = reports[responses.findIndex(({ status }) => status === 200)];
  const retry = await handleRequest(post("/cz/api/dictionary/gaps", winner), environment(database));
  assert.equal(retry.status, 200);
  assert.equal((await retry.json()).deduplicated, true);
  assert.equal(database.sqlite.prepare("SELECT observation_count FROM dictionary_gaps WHERE normalized_word = ?1")
    .get(winner.normalizedWord).observation_count, 2);
} finally { database.sqlite.close(); }

// A competing request can fill the final slot with this same word after an
// absent initial read. The authoritative UPSERT must still accept the retry.
const duplicateDatabase = new Database();
try {
  const seed = duplicateDatabase.sqlite.prepare(`
    INSERT INTO dictionary_gaps VALUES (
      'kaikki-cs-en-2026-07-09', 'cs-en', ?1, ?1, 'no_results', 0, 1, 1, 1
    )
  `);
  for (let index = 0; index < 4095; index += 1) seed.run(`existing-${index}`);
  duplicateDatabase.afterGapRead = () => {
    duplicateDatabase.afterGapRead = undefined;
    seed.run("příklad");
  };
  const response = await handleRequest(post("/cz/api/dictionary/gaps", {
    schema: "caatuu.dictionary-gap-report.v1", targetWord: "Příklad", normalizedWord: "příklad",
    dictionaryKey: "kaikki-cs-en-2026-07-09", dictionaryDirection: "cs-en",
    lookupOutcome: "no_results", lookupReturned: 0
  }), environment(duplicateDatabase));
  assert.equal(response.status, 200);
  assert.equal(duplicateDatabase.sqlite.prepare("SELECT COUNT(*) AS count FROM dictionary_gaps").get().count, 4096);
  assert.equal(duplicateDatabase.sqlite.prepare("SELECT observation_count FROM dictionary_gaps WHERE normalized_word = 'příklad'")
    .get().observation_count, 2);
} finally { duplicateDatabase.sqlite.close(); }
