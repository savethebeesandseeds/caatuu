import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { REPORTING_POLICY, SENTENCE_REPORT_SCHEMA } from "../src/contracts.mjs";
import { DURABLE_ASSETS, handleRequest } from "../src/index.mjs";

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

const durableAssetPath = Object.keys(DURABLE_ASSETS)[0];
const durableAsset = DURABLE_ASSETS[durableAssetPath];

function assetRequest(headers = {}, method = "GET") {
  return new Request(`https://caatuu.waajacu.com${durableAssetPath}`, { method, headers });
}

function partialAssetResponse(first = 1000, last = 1999, extraHeaders = {}) {
  return new Response(new Uint8Array(last - first + 1), {
    status: 206,
    headers: {
      "accept-ranges": "bytes",
      "content-length": String(last - first + 1),
      "content-range": `bytes ${first}-${last}/${durableAsset.bytes}`,
      "content-type": "application/octet-stream",
      etag: '"fixture-etag"',
      ...extraHeaders
    }
  });
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

test("durable assets force raw origin bytes and preserve resume headers", async () => {
  const calls = [];
  const first = durableAsset.bytes - 1000;
  const last = durableAsset.bytes - 1;
  const response = await handleRequest(
    assetRequest({
      "accept-encoding": "gzip, br",
      authorization: "must-not-reach-the-public-origin",
      cookie: "must-not-reach-the-public-origin",
      range: `bytes=${first}-`,
      "if-range": '"fixture-etag"'
    }),
    environment(),
    {},
    async (request) => {
      calls.push(request);
      return partialAssetResponse(first, last);
    }
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].headers.get("accept-encoding"), "identity");
  assert.equal(calls[0].headers.get("range"), `bytes=${first}-`);
  assert.equal(calls[0].headers.get("if-range"), '"fixture-etag"');
  assert.equal(calls[0].headers.get("authorization"), null);
  assert.equal(calls[0].headers.get("cookie"), null);
  assert.equal(calls[0].cache, "no-store");
  assert.equal(response.status, 206);
  assert.equal(response.headers.get("content-encoding"), null);
  assert.equal(response.headers.get("content-range"), `bytes ${first}-${last}/${durableAsset.bytes}`);
  assert.equal(response.headers.get("content-type"), durableAsset.contentType);
  assert.match(response.headers.get("cache-control"), /no-transform/u);
  assert.equal((await response.arrayBuffer()).byteLength, 1000);
});

test("durable assets fail closed on compressed or size-mismatched origin data", async () => {
  const compressed = await handleRequest(
    assetRequest({ range: "bytes=1000-1999" }),
    environment(),
    {},
    async () => partialAssetResponse(1000, 1999, { "content-encoding": "gzip" })
  );
  assert.equal(compressed.status, 502);
  assert.equal((await body(compressed)).error, "asset_unavailable");

  const wrongTotal = await handleRequest(
    assetRequest({ range: "bytes=1000-1999" }),
    environment(),
    {},
    async () => new Response(new Uint8Array(1000), {
      status: 206,
      headers: {
        "content-length": "1000",
        "content-range": "bytes 1000-1999/39720004"
      }
    })
  );
  assert.equal(wrongTotal.status, 502);
  assert.equal((await body(wrongTotal)).error, "asset_unavailable");

  const wrongOffset = await handleRequest(
    assetRequest({ range: "bytes=1000-1999" }),
    environment(),
    {},
    async () => partialAssetResponse(2000, 2999)
  );
  assert.equal(wrongOffset.status, 502);
  assert.equal((await body(wrongOffset)).error, "asset_unavailable");
});

test("durable assets validate full, head, and unsatisfied-range responses", async () => {
  const complete = await handleRequest(
    assetRequest({}, "HEAD"),
    environment(),
    {},
    async () => new Response(null, {
      status: 200,
      headers: { "content-length": String(durableAsset.bytes) }
    })
  );
  assert.equal(complete.status, 200);
  assert.equal(complete.headers.get("content-length"), String(durableAsset.bytes));
  assert.equal(complete.body, null);

  const unsatisfied = await handleRequest(
    assetRequest({ range: `bytes=${durableAsset.bytes}-` }),
    environment(),
    {},
    async () => new Response(null, {
      status: 416,
      headers: { "content-range": `bytes */${durableAsset.bytes}` }
    })
  );
  assert.equal(unsatisfied.status, 416);
  assert.equal(unsatisfied.headers.get("content-range"), `bytes */${durableAsset.bytes}`);

  const staleIfRange = await handleRequest(
    assetRequest({ range: "bytes=1000-", "if-range": '"stale-etag"' }),
    environment(),
    {},
    async () => new Response(null, {
      status: 200,
      headers: { "content-length": String(durableAsset.bytes) }
    })
  );
  assert.equal(staleIfRange.status, 200);
  assert.equal(staleIfRange.headers.get("content-length"), String(durableAsset.bytes));
});

test("durable asset routes reject writes without invoking the origin", async () => {
  let called = false;
  const response = await handleRequest(
    assetRequest({}, "POST"),
    environment(),
    {},
    async () => {
      called = true;
      return new Response();
    }
  );
  assert.equal(response.status, 405);
  assert.equal(called, false);
});

test("durable asset query URLs stay inside the exact Worker boundary", async () => {
  const path = "/cz/data/embeddings/all-minilm-l6-v2-qint8-v0.1/caatuu-cz-curriculum.sqlite";
  const asset = DURABLE_ASSETS[path];
  let upstreamUrl = "";
  const response = await handleRequest(
    new Request(`https://caatuu.waajacu.com${path}?v=d30277c5`, {
      headers: { range: "bytes=0-0" }
    }),
    environment(),
    {},
    async (request) => {
      upstreamUrl = request.url;
      return new Response(new Uint8Array(1), {
        status: 206,
        headers: {
          "content-length": "1",
          "content-range": `bytes 0-0/${asset.bytes}`
        }
      });
    }
  );
  assert.equal(response.status, 206);
  assert.equal(upstreamUrl, `https://caatuu.waajacu.com${path}?v=d30277c5`);

  const config = JSON.parse(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
  const configuredPatterns = new Set(config.routes.map(({ pattern }) => pattern));
  for (const assetPath of Object.keys(DURABLE_ASSETS)) {
    assert.ok(
      configuredPatterns.has(`caatuu.waajacu.com${assetPath}*`),
      `missing query-safe Worker route for ${assetPath}`
    );
  }
});
