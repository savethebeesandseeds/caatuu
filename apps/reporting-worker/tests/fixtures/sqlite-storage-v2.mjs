import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { handleRequest, runRetentionIfDue } from "../../src/index.mjs";
import { REPORTING_COURSE_CATALOG } from "../../src/course-catalog.mjs";
import { REPORTING_POLICY_V2, SENTENCE_REPORT_SCHEMA_V2, DICTIONARY_GAP_SCHEMA_V2 } from "../../src/contracts-v2.mjs";

class Database {
  constructor() {
    this.sqlite = new DatabaseSync(":memory:");
    this.sqlite.exec(readFileSync(new URL("../../migrations/0001_reporting.sql", import.meta.url), "utf8"));
    this.sqlite.exec("INSERT INTO dictionary_gaps VALUES ('kaikki-cs-en-2026-07-09','cs-en','legacy','legacy','no_results',0,1,1,1)");
    this.sqlite.exec(readFileSync(new URL("../../migrations/0002_course_reporting.sql", import.meta.url), "utf8"));
    this.sqlite.exec(readFileSync(new URL("../../migrations/0003_sentence_flag_target.sql", import.meta.url), "utf8"));
    assert.equal(this.sqlite.prepare("SELECT COUNT(*) AS count FROM dictionary_gaps").get().count, 1);
  }
  prepare(sql) {
    const statement = this.sqlite.prepare(sql);
    const bound = parameters => ({ bind: (...values) => bound(values),
      first: async () => statement.get(...parameters) ?? null,
      run: async () => { await this.beforeWrite?.(); const result = statement.run(...parameters); return { success: true, meta: { changes: result.changes } }; },
    });
    return bound([]);
  }
  async batch(statements) {
    this.sqlite.exec("BEGIN");
    try { const result = []; for (const statement of statements) result.push(await statement.run()); this.sqlite.exec("COMMIT"); return result; }
    catch (error) { this.sqlite.exec("ROLLBACK"); throw error; }
  }
  pairWrites() {
    let release, arrivals = 0;
    const ready = new Promise(resolve => { release = resolve; });
    this.beforeWrite = async () => { if (++arrivals === 2) release(); await ready; };
  }
}
const env = DB => ({ DB, SENTENCE_RATE_LIMITER: { limit: async () => ({ success: true }) }, DICTIONARY_RATE_LIMITER: { limit: async () => ({ success: true }) } });
const post = (path, report) => new Request(`https://caatuu.waajacu.com${path}`, { method: "POST",
  headers: { "content-type": "application/json", "x-caatuu-reporting-policy": REPORTING_POLICY_V2 }, body: JSON.stringify(report) });
const sentence = course => ({ schema: SENTENCE_REPORT_SCHEMA_V2,
  courseId: course.courseId, sourceLanguage: course.sourceLanguage, targetLanguage: course.targetLanguage,
  clientReportId: "8a3ab972-c925-4d31-a9b8-0e339d32c88a", sentence: "An example.", translation: "Example.",
  reason: "wrong_translation", comment: "", entryId: "fixture", contentMode: "authored", corpusVersion: "fixture-v1" });
for (const conflicting of [false, true]) {
  const database = new Database();
  try {
    const report = sentence(REPORTING_COURSE_CATALOG.courses[0]);
    database.pairWrites();
    const responses = await Promise.all([report, { ...report, comment: conflicting ? "Changed" : "" }]
      .map(value => handleRequest(post("/api/v2/sentence-reports", value), env(database))));
    assert.deepEqual(responses.map(response => response.status).sort(), conflicting ? [200,409] : [200,200]);
    if (!conflicting) assert.deepEqual((await Promise.all(responses.map(response => response.json()))).map(result => result.deduplicated).sort(), [false,true]);
    assert.equal(database.sqlite.prepare("SELECT COUNT(*) AS count FROM sentence_reports_v2").get().count, 1);
  } finally { database.sqlite.close(); }
}
const database = new Database();
try {
  const first = sentence(REPORTING_COURSE_CATALOG.courses[0]);
  const second = sentence(REPORTING_COURSE_CATALOG.courses[1]);
  database.pairWrites();
  const responses = await Promise.all([first, second].map(report => handleRequest(post("/api/v2/sentence-reports", report), env(database))));
  assert.deepEqual(responses.map(response => response.status), [200,200]);
  assert.equal(database.sqlite.prepare("SELECT COUNT(*) AS count FROM sentence_reports_v2").get().count, 2);
  database.beforeWrite = undefined;
  assert.equal((await handleRequest(post("/api/v2/sentence-reports", first), env(database))).status, 200);
  assert.equal((await handleRequest(post("/api/v2/sentence-reports", { ...first, comment: "changed" }), env(database))).status, 409);
  assert.equal((await handleRequest(post("/api/v2/sentence-reports", { ...first, sourceLanguage: "zz" }), env(database))).status, 422);

  const course = REPORTING_COURSE_CATALOG.courses.find(course => course.dictionary);
  const gap = { schema: DICTIONARY_GAP_SCHEMA_V2, courseId: course.courseId, sourceLanguage: course.sourceLanguage,
    targetLanguage: course.targetLanguage, ...course.dictionary, targetWord: "Příklad", normalizedWord: "příklad", lookupOutcome: "no_results", lookupReturned: 0 };
  const identity = [course.courseId, course.sourceLanguage, course.targetLanguage, course.dictionary.providerId, course.dictionary.dictionaryKey, course.dictionary.dictionaryDirection];
  const seed = database.sqlite.prepare("INSERT INTO dictionary_gaps_v2 VALUES (?1,?2,?3,?4,?5,?6,?7,?7,'no_results',0,1,1,1)");
  for (let i=0;i<4095;i++) seed.run(...identity, `existing-${i}`);
  database.pairWrites();
  const gaps = [gap, { ...gap, targetWord: "Jiný", normalizedWord: "jiný" }];
  const accepted = await Promise.all(gaps.map(report => handleRequest(post("/api/v2/dictionary-gaps", report), env(database))));
  assert.deepEqual(accepted.map(response => response.status).sort(), [200,507]);
  database.beforeWrite = undefined;
  const winner = gaps[accepted.findIndex(response => response.status === 200)];
  assert.equal((await handleRequest(post("/api/v2/dictionary-gaps", winner), env(database))).status, 200);
  assert.equal(database.sqlite.prepare("SELECT observation_count FROM dictionary_gaps_v2 WHERE normalized_word = ?1").get(winner.normalizedWord).observation_count, 2);
  // SQL uniqueness includes the course tuple even when providers, keys and words match.
  seed.run("ordinary", ...identity.slice(1), winner.normalizedWord);
  assert.equal(database.sqlite.prepare("SELECT COUNT(*) AS count FROM dictionary_gaps_v2").get().count, 4097);

  const old = Date.now() - 500 * 86400000;
  database.sqlite.prepare("UPDATE sentence_reports_v2 SET received_at_unix_ms = ?1 WHERE course_id = ?2").run(old, first.courseId);
  const now = Date.now();
  assert.deepEqual(await runRetentionIfDue(env(database), now), { ran: true });
  assert.equal(database.sqlite.prepare("SELECT COUNT(*) AS count FROM sentence_reports_v2").get().count, 1);
  assert.equal(database.sqlite.prepare("SELECT COUNT(*) AS count FROM dictionary_gaps_v2").get().count, 1);
  assert.equal(database.sqlite.prepare("SELECT COUNT(*) AS count FROM dictionary_gaps").get().count, 0);
  assert.deepEqual(await runRetentionIfDue(env(database), now), { ran: false });
} finally { database.sqlite.close(); }
