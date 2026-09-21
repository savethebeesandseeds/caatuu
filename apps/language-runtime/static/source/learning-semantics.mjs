import {
  embedSharedEnglishTexts, normalizeSharedEnglishText, peekSharedEnglishVector, sharedEnglishEmbeddingOwner
} from "./english-image-search.mjs";

function boundedInteger(value, name, maximum) {
  if (!Number.isInteger(value) || value < 1 || value > maximum) throw new TypeError(`${name} must be 1 to ${maximum}.`);
  return value;
}

function itemId(value) {
  if (typeof value !== "string" || !value.trim() || value.length > 256) throw new TypeError("A semantic candidate needs an item id of 1 to 256 characters.");
  return value;
}

function similarity(left, right) {
  if (!left || !right) return null;
  let result = 0;
  for (let index = 0; index < 384; index += 1) result += left[index] * right[index];
  return Math.max(-1, Math.min(1, result));
}

/**
 * Optional English meaning features, never learner knowledge or assessment.
 * Scope a provider to one course/game, or supply qualified candidate IDs.
 * Cached reads cover every supplied eligible candidate without inference.
 * Callers put recent/selected items first for warmup, which inspects at most
 * maxScan rows and adds at most maxCandidateMisses new texts plus the goal
 * and up to maxRecent recent texts. No corpus-wide inference occurs here.
 * English identity is an authoring contract; the script check is not language
 * detection, and English meaning cannot measure target grammar or pronunciation.
 */
export function createLearningSemantics({
  owner = sharedEnglishEmbeddingOwner(), encoder, maxCandidateMisses = 16,
  maxScan = 128, maxRecent = 8, timeoutMs = 2000, retryMs = 30000, now = Date.now
} = {}) {
  boundedInteger(maxCandidateMisses, "maxCandidateMisses", 16);
  boundedInteger(maxScan, "maxScan", 256);
  boundedInteger(maxRecent, "maxRecent", 8);
  boundedInteger(timeoutMs, "timeoutMs", 10000);
  boundedInteger(retryMs, "retryMs", 300000);
  if (typeof now !== "function") throw new TypeError("now must be a function.");
  if (encoder !== undefined && typeof encoder !== "function") throw new TypeError("encoder must be a function.");
  const itemTexts = new Map();
  let inFlight = null, failures = 0, retryAt = 0, reason = null;

  function prepare({ candidates, goalText, recentIds = [] } = {}, scanLimit = null) {
    if (!Array.isArray(candidates) || !Array.isArray(recentIds)) throw new TypeError("candidates and recentIds must be arrays.");
    const seen = new Set();
    const inspected = scanLimit === null ? candidates : candidates.slice(0, scanLimit);
    const rows = inspected.map(candidate => {
      const id = itemId(candidate?.id);
      if (seen.has(id)) throw new TypeError(`Duplicate semantic candidate id: ${id}`);
      seen.add(id);
      return { id, text: normalizeSharedEnglishText(candidate.englishText) };
    });
    const recent = [...new Set(recentIds.slice(0, maxRecent).map(itemId))];
    return { rows, recent, goal: goalText === undefined || goalText === null ? null : normalizeSharedEnglishText(goalText),
      truncated: candidates.length > rows.length, suppliedCount: candidates.length, scanLimit };
  }

  function read(text) { return text ? peekSharedEnglishVector(text, { owner }) : null; }
  function recentTexts(safe) {
    const supplied = new Map(safe.rows.map(row => [row.id, row.text]));
    return safe.recent.map(id => supplied.get(id) || itemTexts.get(id) || null);
  }
  function result(safe) {
    const goal = read(safe.goal);
    const recent = recentTexts(safe).map(read).filter(Boolean);
    const byItem = Object.create(null);
    let cachedCandidates = 0;
    for (const row of safe.rows) {
      const vector = read(row.text);
      if (vector) cachedCandidates += 1;
      byItem[row.id] = { goalSimilarity: similarity(vector, goal),
        recentSimilarity: vector && recent.length ? Math.max(...recent.map(other => similarity(vector, other))) : null };
    }
    const complete = cachedCandidates === safe.rows.length && (!safe.goal || goal)
      && recent.length === safe.recent.length && !safe.truncated;
    const status = complete && safe.rows.length ? "ready" : inFlight ? "loading"
      : reason ? "unavailable" : cachedCandidates ? "partial" : "empty";
    return { byItem, status, cachedCandidates, inspectedCandidates: safe.rows.length,
      suppliedCandidates: safe.suppliedCount, truncated: safe.truncated,
      scanMode: safe.scanLimit === null ? "all-cached-candidates" : "bounded-warmup",
      candidateScanLimit: safe.scanLimit, candidateMissLimit: maxCandidateMisses,
      cachedRecent: recent.length, goalAvailable: Boolean(goal),
      ...(reason ? { reason, retryAt } : {}) };
  }

  function remember(rows) {
    for (const { id, text } of rows) {
      itemTexts.delete(id); itemTexts.set(id, text);
      while (itemTexts.size > 256) itemTexts.delete(itemTexts.keys().next().value);
    }
  }

  function features(input) { return result(prepare(input)); }

  async function warm(input) {
    const safe = prepare(input, maxScan);
    remember(safe.rows);
    if (inFlight) { await inFlight; return result(safe); }
    if (now() < retryAt) return result(safe);
    const priority = [safe.goal, ...recentTexts(safe)].filter(Boolean);
    const selected = new Set(priority);
    let misses = 0;
    for (const { text } of safe.rows) {
      if (selected.has(text) || read(text)) continue;
      selected.add(text);
      if (++misses >= maxCandidateMisses) break;
    }
    const texts = [...selected].filter(text => !read(text));
    if (!texts.length) return result(safe);
    inFlight = embedSharedEnglishTexts(texts, { owner, encoder, timeoutMs }).then(() => {
      failures = 0; retryAt = 0; reason = null;
    }).catch(error => {
      failures = Math.min(5, failures + 1);
      retryAt = now() + Math.min(300000, retryMs * 2 ** (failures - 1));
      reason = error?.message || "English semantics unavailable.";
    }).finally(() => { inFlight = null; });
    await inFlight;
    return result(safe);
  }

  return Object.freeze({ features, warm });
}
