import {
  CANONICAL_ORIGIN,
  REPORTING_POLICY,
  REPORTING_POLICY_HEADER,
  canonicalSentencePayload,
  validateDictionaryGap,
  validateSentenceReport
} from "./contracts.mjs";

export const DEPLOYMENT_VERSION = "2026-09-02.v1";

const routes = Object.freeze({
  dictionary: "/cz/api/dictionary/gaps",
  sentence: "/api/sentence-reports",
  health: "/api/reporting/health"
});

const responseHeaders = Object.freeze({
  "cache-control": "no-store",
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
  "content-type": "application/json; charset=utf-8",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff"
});

class RequestError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

function json(status, body, extraHeaders = {}) {
  return new Response(`${JSON.stringify(body)}\n`, {
    status,
    headers: { ...responseHeaders, ...extraHeaders }
  });
}

function fail(error) {
  if (error instanceof RequestError) {
    return json(error.status, {
      ok: false,
      stored: false,
      error: error.code,
      message: error.message,
      ...error.extra
    });
  }
  return json(500, {
    ok: false,
    stored: false,
    error: "storage_unavailable",
    message: "The report could not be stored."
  });
}

function assertExactRoute(url, expected) {
  if (url.pathname !== expected || url.search) {
    throw new RequestError(404, "not_found", "This reporting route does not exist.");
  }
}

function assertPostPolicy(request) {
  if (request.headers.get(REPORTING_POLICY_HEADER) !== REPORTING_POLICY) {
    throw new RequestError(428, "reporting_policy_required", "This client is not authorized for the current reporting policy.");
  }
  const contentType = request.headers.get("content-type") || "";
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(contentType)) {
    throw new RequestError(415, "json_required", "The request must use application/json.");
  }
  const origin = request.headers.get("origin");
  if (origin && origin !== CANONICAL_ORIGIN) {
    throw new RequestError(403, "origin_rejected", "The request origin is not allowed.");
  }
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin") {
    throw new RequestError(403, "origin_rejected", "The request origin is not allowed.");
  }
}

async function readJson(request, maximumBytes) {
  const declared = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(declared) && declared > maximumBytes) {
    throw new RequestError(413, "body_too_large", "The report body is too large.");
  }
  const reader = request.body?.getReader();
  const chunks = [];
  let total = 0;
  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel().catch(() => {});
        throw new RequestError(413, "body_too_large", "The report body is too large.");
      }
      chunks.push(value);
    }
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (error) {
    throw new RequestError(400, "invalid_json", "The report body is not valid JSON.");
  }
}

async function enforceRateLimit(binding, request, routeName) {
  if (!binding || typeof binding.limit !== "function") {
    throw new RequestError(503, "rate_limit_unavailable", "Reporting is temporarily unavailable.");
  }
  const address = request.headers.get("cf-connecting-ip") || "unknown";
  const result = await binding.limit({ key: `${routeName}:${address}` });
  if (!result?.success) {
    throw new RequestError(429, "rate_limited", "Please wait before sending another report.", { retryAfterSeconds: 60 });
  }
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function storeDictionaryGap(env, report, now) {
  const existing = await env.DB.prepare(`
    SELECT 1 AS present
    FROM dictionary_gaps
    WHERE dictionary_key = ?1 AND dictionary_direction = ?2 AND normalized_word = ?3
  `).bind(report.dictionaryKey, report.dictionaryDirection, report.normalizedWord).first();
  if (!existing) {
    const capacity = await env.DB.prepare("SELECT COUNT(*) AS count FROM dictionary_gaps").first();
    if (Number(capacity?.count || 0) >= 4096) {
      throw new RequestError(507, "dictionary_capacity_reached", "Dictionary maintenance storage is full.");
    }
  }
  const result = await env.DB.prepare(`
    INSERT INTO dictionary_gaps (
      dictionary_key, dictionary_direction, normalized_word, target_word,
      lookup_outcome, lookup_returned, first_seen_at_unix_ms,
      last_seen_at_unix_ms, observation_count
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7, 1)
    ON CONFLICT (dictionary_key, dictionary_direction, normalized_word) DO UPDATE SET
      target_word = excluded.target_word,
      lookup_outcome = excluded.lookup_outcome,
      lookup_returned = excluded.lookup_returned,
      last_seen_at_unix_ms = MAX(dictionary_gaps.last_seen_at_unix_ms, excluded.last_seen_at_unix_ms),
      observation_count = dictionary_gaps.observation_count + 1
  `).bind(
    report.dictionaryKey,
    report.dictionaryDirection,
    report.normalizedWord,
    report.targetWord,
    report.lookupOutcome,
    report.lookupReturned,
    now
  ).run();
  if (result?.success !== true) throw new Error("D1 did not acknowledge the dictionary write.");
  return { deduplicated: Boolean(existing) };
}

async function storeSentenceReport(env, report, now) {
  const payloadSha256 = await sha256(canonicalSentencePayload(report));
  const existing = await env.DB.prepare(`
    SELECT payload_sha256
    FROM sentence_reports
    WHERE client_report_id = ?1
  `).bind(report.clientReportId).first();
  if (existing) {
    if (existing.payload_sha256 !== payloadSha256) {
      throw new RequestError(409, "report_id_conflict", "That report identifier was already used for different content.");
    }
    return { deduplicated: true };
  }
  const result = await env.DB.prepare(`
    INSERT INTO sentence_reports (
      client_report_id, payload_sha256, sentence, translation, reason,
      comment, entry_id, content_mode, corpus_version, received_at_unix_ms
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
  `).bind(
    report.clientReportId,
    payloadSha256,
    report.sentence,
    report.translation,
    report.reason,
    report.comment,
    report.entryId,
    report.contentMode,
    report.corpusVersion,
    now
  ).run();
  if (result?.success !== true) throw new Error("D1 did not acknowledge the sentence write.");
  return { deduplicated: false };
}

function retentionDays(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 3650 ? parsed : fallback;
}

export async function runRetentionIfDue(env, now = Date.now()) {
  const state = await env.DB.prepare(`
    SELECT integer_value
    FROM service_state
    WHERE state_key = 'last_retention_at_unix_ms'
  `).first();
  const lastRun = Number(state?.integer_value || 0);
  if (now - lastRun < 24 * 60 * 60 * 1000) return { ran: false };
  const sentenceCutoff = now - retentionDays(env.SENTENCE_RETENTION_DAYS, 90) * 24 * 60 * 60 * 1000;
  const dictionaryCutoff = now - retentionDays(env.DICTIONARY_RETENTION_DAYS, 365) * 24 * 60 * 60 * 1000;
  await env.DB.batch([
    env.DB.prepare("DELETE FROM sentence_reports WHERE received_at_unix_ms < ?1").bind(sentenceCutoff),
    env.DB.prepare("DELETE FROM dictionary_gaps WHERE last_seen_at_unix_ms < ?1").bind(dictionaryCutoff),
    env.DB.prepare(`
      INSERT INTO service_state (state_key, integer_value, text_value, updated_at_unix_ms)
      VALUES ('last_retention_at_unix_ms', ?1, NULL, ?1)
      ON CONFLICT (state_key) DO UPDATE SET
        integer_value = excluded.integer_value,
        updated_at_unix_ms = excluded.updated_at_unix_ms
    `).bind(now)
  ]);
  return { ran: true };
}

async function handleHealth(request, env, url) {
  assertExactRoute(url, routes.health);
  if (request.method !== "GET") {
    throw new RequestError(405, "method_not_allowed", "Use GET for this route.");
  }
  const ready = await env.DB.prepare("SELECT 1 AS ready").first();
  if (Number(ready?.ready) !== 1) throw new Error("D1 readiness check failed.");
  return json(200, { ok: true, ready: true, version: DEPLOYMENT_VERSION });
}

async function handlePost(request, env, context, url, kind) {
  const expected = kind === "dictionary" ? routes.dictionary : routes.sentence;
  assertExactRoute(url, expected);
  if (request.method !== "POST") {
    throw new RequestError(405, "method_not_allowed", "Use POST for this route.");
  }
  assertPostPolicy(request);
  await enforceRateLimit(
    kind === "dictionary" ? env.DICTIONARY_RATE_LIMITER : env.SENTENCE_RATE_LIMITER,
    request,
    kind
  );
  const body = await readJson(request, kind === "dictionary" ? 2 * 1024 : 4 * 1024);
  const report = kind === "dictionary" ? validateDictionaryGap(body) : validateSentenceReport(body);
  if (!report) throw new RequestError(422, "invalid_report", "The report does not match the accepted schema.");
  const now = Date.now();
  const stored = kind === "dictionary"
    ? await storeDictionaryGap(env, report, now)
    : await storeSentenceReport(env, report, now);
  if (context?.waitUntil) {
    context.waitUntil(runRetentionIfDue(env, now).catch(() => ({ ran: false })));
  }
  return json(200, { ok: true, stored: true, deduplicated: stored.deduplicated });
}

export async function handleRequest(request, env, context = {}) {
  try {
    const url = new URL(request.url);
    if (url.pathname === routes.health) return await handleHealth(request, env, url);
    if (url.pathname === routes.dictionary) return await handlePost(request, env, context, url, "dictionary");
    if (url.pathname === routes.sentence) return await handlePost(request, env, context, url, "sentence");
    throw new RequestError(404, "not_found", "This reporting route does not exist.");
  } catch (error) {
    return fail(error);
  }
}

export default {
  fetch: handleRequest
};
