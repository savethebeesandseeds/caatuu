import {
  CANONICAL_ORIGIN,
  REPORTING_POLICY,
  REPORTING_POLICY_HEADER,
  canonicalSentencePayload,
  validateDictionaryGap,
  validateSentenceReport
} from "./contracts.mjs";

export const DEPLOYMENT_VERSION = "2026-09-03.v2";

const routes = Object.freeze({
  dictionary: "/cz/api/dictionary/gaps",
  sentence: "/api/sentence-reports",
  health: "/api/reporting/health"
});

export const DURABLE_ASSETS = Object.freeze({
  "/cz/data/dictionaries/kaikki-cs-en-2026-07-09/caatuu-cs-en.sqlite": Object.freeze({
    bytes: 143106048,
    contentType: "application/vnd.sqlite3"
  }),
  "/cz/data/embeddings/all-minilm-l6-v2-qint8-v0.1/caatuu-cz-curriculum.sqlite": Object.freeze({
    bytes: 20029440,
    contentType: "application/vnd.sqlite3"
  }),
  "/language-runtime/models/all-minilm-l6-v2-qint8-v0.1/runtime/onnx/model_qint8_arm64.onnx": Object.freeze({
    bytes: 23026053,
    contentType: "application/octet-stream"
  }),
  "/language-runtime/models/all-minilm-l6-v2-qint8-v0.1/runtime/ort/ort-wasm-simd-threaded.wasm": Object.freeze({
    bytes: 12942611,
    contentType: "application/wasm"
  })
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

class AssetDeliveryError extends Error {}

function json(status, body, extraHeaders = {}) {
  return new Response(`${JSON.stringify(body)}\n`, {
    status,
    headers: { ...responseHeaders, ...extraHeaders }
  });
}

function fail(error) {
  if (error instanceof AssetDeliveryError) {
    return json(502, {
      ok: false,
      error: "asset_unavailable",
      message: "The setup file could not be delivered safely."
    });
  }
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

function rawAssetHeaders(headers, asset) {
  const result = new Headers(headers);
  result.delete("content-encoding");
  result.set("accept-ranges", "bytes");
  result.set("cache-control", "public, max-age=31536000, immutable, no-transform");
  result.set("content-type", asset.contentType);
  result.set("x-content-type-options", "nosniff");
  return result;
}

function requestedRawRange(value, bytes) {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/iu.exec(value.trim());
  if (!match || (!match[1] && !match[2])) return { valid: false, satisfiable: false };
  if (match[1]) {
    const first = Number(match[1]);
    const requestedLast = match[2] ? Number(match[2]) : bytes - 1;
    if (!Number.isSafeInteger(first) || !Number.isSafeInteger(requestedLast)) {
      return { valid: false, satisfiable: false };
    }
    if (first >= bytes || requestedLast < first) {
      return { valid: true, satisfiable: false };
    }
    return { valid: true, satisfiable: true, first, last: Math.min(requestedLast, bytes - 1) };
  }
  const suffixBytes = Number(match[2]);
  if (!Number.isSafeInteger(suffixBytes) || suffixBytes <= 0) {
    return { valid: true, satisfiable: false };
  }
  return {
    valid: true,
    satisfiable: true,
    first: Math.max(bytes - suffixBytes, 0),
    last: bytes - 1
  };
}

function assertRawAssetResponse(request, response, asset) {
  const encoding = response.headers.get("content-encoding");
  if (encoding && encoding.toLowerCase() !== "identity") {
    throw new AssetDeliveryError("The origin returned an encoded representation.");
  }

  const requestedRange = requestedRawRange(request.headers.get("range"), asset.bytes);

  if (response.status === 304) return;

  if (response.status === 416) {
    if (!requestedRange || requestedRange.satisfiable) {
      throw new AssetDeliveryError("The origin rejected a satisfiable representation.");
    }
    if (response.headers.get("content-range") !== `bytes */${asset.bytes}`) {
      throw new AssetDeliveryError("The origin returned the wrong unsatisfied range size.");
    }
    return;
  }

  if (response.status === 206) {
    if (!requestedRange?.valid || !requestedRange.satisfiable) {
      throw new AssetDeliveryError("The origin returned an unsolicited partial response.");
    }
    const match = /^bytes (\d+)-(\d+)\/(\d+)$/u.exec(response.headers.get("content-range") || "");
    if (!match || Number(match[3]) !== asset.bytes) {
      throw new AssetDeliveryError("The origin returned the wrong partial-file size.");
    }
    const first = Number(match[1]);
    const last = Number(match[2]);
    const contentLength = Number(response.headers.get("content-length"));
    if (
      first !== requestedRange.first ||
      last !== requestedRange.last ||
      contentLength !== last - first + 1
    ) {
      throw new AssetDeliveryError("The origin returned an inconsistent partial response.");
    }
    return;
  }

  if (response.status !== 200 || (requestedRange && !request.headers.has("if-range"))) {
    throw new AssetDeliveryError("The origin did not honor the requested representation.");
  }
  if (Number(response.headers.get("content-length")) !== asset.bytes) {
    throw new AssetDeliveryError("The origin returned the wrong complete-file size.");
  }
}

async function handleDurableAsset(request, asset, fetchImpl) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    throw new RequestError(405, "method_not_allowed", "Use GET or HEAD for this route.");
  }
  const headers = new Headers({ "accept-encoding": "identity" });
  for (const name of ["range", "if-range", "if-match", "if-none-match", "if-modified-since", "if-unmodified-since"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const upstreamRequest = new Request(request.url, {
    method: request.method,
    headers,
    cache: "no-store"
  });
  let upstreamResponse;
  try {
    upstreamResponse = await fetchImpl(upstreamRequest);
  } catch (error) {
    throw new AssetDeliveryError("The origin request failed.", { cause: error });
  }
  try {
    assertRawAssetResponse(request, upstreamResponse, asset);
  } catch (error) {
    await upstreamResponse.body?.cancel().catch(() => {});
    throw error;
  }
  return new Response(request.method === "HEAD" ? null : upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: rawAssetHeaders(upstreamResponse.headers, asset)
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
    return JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes));
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

export async function handleRequest(request, env, context = {}, fetchImpl = fetch) {
  try {
    const url = new URL(request.url);
    const asset = DURABLE_ASSETS[url.pathname];
    if (asset) return await handleDurableAsset(request, asset, fetchImpl);
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
