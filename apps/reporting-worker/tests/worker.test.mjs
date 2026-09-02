import assert from "node:assert/strict";
import test from "node:test";
import { REPORTING_POLICY, SENTENCE_REPORT_SCHEMA } from "../src/contracts.mjs";
import { handleRequest } from "../src/index.mjs";

class FakeStatement {
  constructor(database, sql, parameters = []) {
    this.database = database;
    this.sql = sql.replace(/\s+/gu, " ").trim();
    this.parameters = parameters;
  }

  bind(...parameters) {
    return new FakeStatement(this.database, this.sql, parameters);
  }

  async first() {
    this.database.calls.push({ kind: "first", sql: this.sql, parameters: this.parameters });
    if (this.database.fail) throw new Error("synthetic D1 failure");
    if (this.sql === "SELECT 1 AS ready") return { ready: 1 };
    if (this.sql.includes("FROM dictionary_gaps") && this.sql.includes("SELECT 1 AS present")) {
      return this.database.gaps.has(this.parameters.slice(0, 3).join("|")) ? { present: 1 } : null;
    }
    if (this.sql.includes("COUNT(*) AS count FROM dictionary_gaps")) return { count: this.database.gaps.size };
    if (this.sql.includes("FROM sentence_reports")) {
      const row = this.database.sentences.get(this.parameters[0]);
      return row ? { payload_sha256: row.payloadSha256 } : null;
    }
    if (this.sql.includes("FROM service_state")) return { integer_value: Date.now() };
    throw new Error(`Unhandled first statement: ${this.sql}`);
  }

  async run() {
    this.database.calls.push({ kind: "run", sql: this.sql, parameters: this.parameters });
    if (this.database.fail) throw new Error("synthetic D1 failure");
    if (this.sql.startsWith("INSERT INTO dictionary_gaps")) {
      const key = this.parameters.slice(0, 3).join("|");
      this.database.gaps.set(key, { parameters: this.parameters });
      return { success: true };
    }
    if (this.sql.startsWith("INSERT INTO sentence_reports")) {
      this.database.sentences.set(this.parameters[0], {
        payloadSha256: this.parameters[1],
        parameters: this.parameters
      });
      return { success: true };
    }
    throw new Error(`Unhandled run statement: ${this.sql}`);
  }
}

class FakeDatabase {
  constructor() {
    this.calls = [];
    this.gaps = new Map();
    this.sentences = new Map();
    this.fail = false;
  }
  prepare(sql) {
    return new FakeStatement(this, sql);
  }
  async batch(statements) {
    this.calls.push({ kind: "batch", statements });
    return statements.map(() => ({ success: true }));
  }
}

function allow() {
  return { limit: async () => ({ success: true }) };
}

function environment(database = new FakeDatabase()) {
  return {
    DB: database,
    DICTIONARY_RATE_LIMITER: allow(),
    SENTENCE_RATE_LIMITER: allow(),
    SENTENCE_RETENTION_DAYS: "90",
    DICTIONARY_RETENTION_DAYS: "365"
  };
}

const gap = Object.freeze({
  schema: "caatuu.dictionary-gap-report.v1",
  targetWord: "Příklad",
  normalizedWord: "příklad",
  dictionaryKey: "kaikki-cs-en-2026-07-09",
  dictionaryDirection: "cs-en",
  lookupOutcome: "no_results",
  lookupReturned: 0
});

const sentence = Object.freeze({
  schema: SENTENCE_REPORT_SCHEMA,
  clientReportId: "8a3ab972-c925-4d31-a9b8-0e339d32c88a",
  sentence: "Tohle je věta.",
  translation: "This is a sentence.",
  reason: "wrong_translation",
  comment: "The tense is wrong.",
  entryId: "fixture-1",
  contentMode: "standard",
  corpusVersion: "fixture-v1"
});

function post(path, body, headers = {}) {
  return new Request(`https://caatuu.waajacu.com${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-caatuu-reporting-policy": REPORTING_POLICY,
      origin: "https://caatuu.waajacu.com",
      "sec-fetch-site": "same-origin",
      ...headers
    },
    body: JSON.stringify(body)
  });
}

async function body(response) {
  return response.json();
}

test("legacy requests are rejected before D1 or body validation", async () => {
  const env = environment();
  const request = post("/cz/api/dictionary/gaps", { expansive: true });
  request.headers.delete("x-caatuu-reporting-policy");
  const response = await handleRequest(request, env);
  assert.equal(response.status, 428);
  assert.equal((await body(response)).stored, false);
  assert.equal(env.DB.calls.length, 0);
});

test("dictionary gaps are stored and retried idempotently", async () => {
  const env = environment();
  const first = await handleRequest(post("/cz/api/dictionary/gaps", gap), env);
  assert.equal(first.status, 200);
  assert.deepEqual(await body(first), { ok: true, stored: true, deduplicated: false });
  const second = await handleRequest(post("/cz/api/dictionary/gaps", gap), env);
  assert.equal(second.status, 200);
  assert.deepEqual(await body(second), { ok: true, stored: true, deduplicated: true });
  assert.equal(env.DB.gaps.size, 1);
});

test("sentence retries deduplicate and conflicting identifier reuse fails", async () => {
  const env = environment();
  const first = await handleRequest(post("/api/sentence-reports", sentence), env);
  assert.equal(first.status, 200);
  const retry = await handleRequest(post("/api/sentence-reports", sentence), env);
  assert.deepEqual(await body(retry), { ok: true, stored: true, deduplicated: true });
  const conflict = await handleRequest(post("/api/sentence-reports", { ...sentence, comment: "Different" }), env);
  assert.equal(conflict.status, 409);
  assert.equal((await body(conflict)).stored, false);
});

test("generic diagnostic envelopes and unexpected fields fail closed", async () => {
  const env = environment();
  const response = await handleRequest(post("/api/sentence-reports", {
    ...sentence,
    device: { model: "must not be accepted" }
  }), env);
  assert.equal(response.status, 422);
  assert.equal(env.DB.sentences.size, 0);
});

test("wrong origins, query strings, and oversized requests fail closed", async () => {
  const env = environment();
  const wrongOrigin = await handleRequest(post("/api/sentence-reports", sentence, { origin: "https://example.invalid" }), env);
  assert.equal(wrongOrigin.status, 403);
  const query = await handleRequest(post("/api/sentence-reports?unexpected=1", sentence), env);
  assert.equal(query.status, 404);
  const oversized = await handleRequest(post("/api/sentence-reports", { ...sentence, comment: "x".repeat(5000) }), env);
  assert.equal(oversized.status, 413);
});

test("rate-limit and D1 failures never acknowledge storage", async () => {
  const limited = environment();
  limited.SENTENCE_RATE_LIMITER = { limit: async () => ({ success: false }) };
  const rejected = await handleRequest(post("/api/sentence-reports", sentence), limited);
  assert.equal(rejected.status, 429);
  assert.equal(limited.DB.calls.length, 0);

  const failedDatabase = new FakeDatabase();
  failedDatabase.fail = true;
  const failed = await handleRequest(post("/api/sentence-reports", sentence), environment(failedDatabase));
  assert.equal(failed.status, 500);
  assert.equal((await body(failed)).stored, false);
});

test("health exposes readiness and version but no report data", async () => {
  const response = await handleRequest(
    new Request("https://caatuu.waajacu.com/api/reporting/health"),
    environment()
  );
  assert.equal(response.status, 200);
  const result = await body(response);
  assert.equal(result.ok, true);
  assert.equal(result.ready, true);
  assert.equal(typeof result.version, "string");
  assert.deepEqual(Object.keys(result).sort(), ["ok", "ready", "version"]);
});
