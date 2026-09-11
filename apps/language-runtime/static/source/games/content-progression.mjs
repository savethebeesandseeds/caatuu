/** Editorial ordering and spaced practice, shared by every course. No prerequisites. */
export const CONTENT_DAY_MS = 24 * 60 * 60 * 1000;
export const CONTENT_PRACTICE_GAP_MS = 5 * 60 * 1000;
export const CONTENT_INTRODUCTION_BUDGET = 6;

export function normalizeContentProgression(item, label = "item") {
  const result = {};
  for (const [field, legacy] of [["usefulness", "urgency"], ["complexity", "subdifficulty"]]) {
    let value = item?.[field];
    // Compatibility for cached, older packs only. Authored catalogs require the new fields.
    if (value === undefined && item?.[legacy] !== undefined) {
      const oldValue = item[legacy];
      if (!Number.isInteger(oldValue) || oldValue < 1 || oldValue > 5) {
        throw new TypeError(`${label}.${legacy} must be an integer from 1 to 5.`);
      }
      value = [1, 25, 50, 75, 100][oldValue - 1];
    }
    if (value === undefined) value = 50;
    if (!Number.isInteger(value) || value < 1 || value > 100) {
      throw new TypeError(`${label}.${field} must be an integer from 1 to 100.`);
    }
    result[field] = value;
  }
  return result;
}

let encounterSequence = 0;
export function newContentEncounterId() {
  return globalThis.crypto?.randomUUID?.()
    || `${Date.now().toString(36)}-${(++encounterSequence).toString(36)}-${Math.random().toString(36).slice(2)}`;
}

const count = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
const seenAt = value => {
  const parsed = typeof value === "string" ? Date.parse(value) : Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
};

/** A conservative queue signal, not a mastery score or a recall probability. */
export function contentPracticeReadiness(progress = {}) {
  const interval = Math.max(0, Number(progress?.intervalMs) || 0);
  return Math.min(1, count(progress?.spacedSuccesses) / 4,
    count(progress?.independentDays) / 5, Math.log2(1 + interval / CONTENT_DAY_MS) / 4);
}

/**
 * Mix due review, rested practice and gradual introductions. Delayed independent
 * evidence widens the challenge range; completion counts only rotate the queue.
 * No item gates another. Constructing a queue never changes learning history.
 * The budgets and readiness curve are tunable product heuristics, not claims
 * that a particular number of answers proves learning.
 */
export function selectContentItems(items, {
  difficulty = 3, history = {}, minimumPool = 4, limit = Infinity,
  random = Math.random, getId = item => item.id, now = Date.now()
} = {}) {
  if (!Array.isArray(items)) throw new TypeError("Content selection needs an array.");
  if (![1, 2, 3].includes(difficulty)) throw new TypeError("difficulty must be 1, 2, or 3.");
  if (!Number.isInteger(minimumPool) || minimumPool < 1) throw new TypeError("minimumPool must be a positive integer.");
  if (limit !== Infinity && (!Number.isInteger(limit) || limit < 1)) throw new TypeError("limit must be a positive integer.");
  if (!Number.isFinite(now) || now < 0) throw new TypeError("now must be a nonnegative timestamp.");
  const ids = new Set();
  const rows = [];
  for (const item of items) {
    const badge = item.difficulty === undefined ? 1 : item.difficulty;
    if (![1, 2, 3].includes(badge)) throw new TypeError("Authored difficulty must be 1, 2, or 3.");
    if (badge > difficulty) continue;
    const id = String(getId(item) ?? "");
    if (!id || ids.has(id)) continue;
    ids.add(id);
    const grade = normalizeContentProgression(item, id);
    const progress = Object.hasOwn(history || {}, id) ? history[id] : {};
    rows.push({ item, id, badge, ...grade, progress: progress || {},
      position: (badge - 1) * 100 + grade.complexity,
      visits: count(progress?.exposures), readiness: contentPracticeReadiness(progress),
      lastSeen: Math.min(now, seenAt(progress?.lastSeenAt)),
      tie: Math.max(0, Math.min(1, Number(random()) || 0)) });
  }
  if (!rows.length) return [];
  const size = Math.min(rows.length, Math.max(CONTENT_INTRODUCTION_BUDGET, minimumPool));
  const introduced = rows.filter(row => row.visits > 0);
  const unseen = rows.filter(row => row.visits === 0);
  let frontier = Math.min(...rows.map(row => row.position)) + 18;
  for (const row of introduced) {
    if (row.readiness > 0) frontier = Math.max(frontier, row.position + 24 * row.readiness);
    // Supported study remains explorable over separate days without earning recall credit.
    const exploration = Math.min(24, Math.max(0, count(row.progress.practiceDays) - 3) * 4);
    if (exploration > 0) frontier = Math.max(frontier, row.position + exploration);
  }
  const today = Math.floor(now / CONTENT_DAY_MS);
  const isIntroducedToday = progress => count(progress?.exposures) > 0
    && Math.floor(Math.min(now, seenAt(progress.firstSeenAt || progress.lastSeenAt)) / CONTENT_DAY_MS) === today;
  const introducedToday = Object.values(history || {}).filter(isIntroducedToday).length;
  const pending = introduced.filter(row => row.readiness < 0.5).length;
  const meanReadiness = introduced.length
    ? introduced.reduce((sum, row) => sum + row.readiness, 0) / introduced.length : 0;
  const usualBudget = Math.max(CONTENT_INTRODUCTION_BUDGET, minimumPool);
  const dailyBudget = pending > Math.max(12, minimumPool * 3)
    ? Math.max(1, Math.floor(usualBudget / 3)) : usualBudget + Math.floor(meanReadiness * 4);
  const editorialOrder = (a, b) => a.badge - b.badge
    || Math.floor((a.complexity - 1) / 10) - Math.floor((b.complexity - 1) / 10)
    || b.usefulness - a.usefulness || a.complexity - b.complexity || a.id.localeCompare(b.id, "en");
  const allowance = Math.max(0, dailyBudget - introducedToday);
  const experienced = introduced.filter(row => row.readiness >= 0.5 || count(row.progress.practiceDays) >= 8);
  const anchor = experienced.length ? Math.max(...experienced.map(row => row.position)) : 0;
  const band = position => Math.floor((position - 1) / 10);
  // Reserve at most one daily introduction in the nearest higher band. Otherwise
  // hundreds of easy records would form an implicit prerequisite gate.
  const challengeUsedToday = introduced.some(row => isIntroducedToday(row.progress) && band(row.position) > band(anchor));
  const challenge = allowance && anchor && !challengeUsedToday
    ? unseen.filter(row => band(row.position) > band(anchor))
      .sort((a, b) => a.position - b.position || b.usefulness - a.usefulness || a.id.localeCompare(b.id, "en"))[0]
    : null;
  const novel = challenge ? [challenge] : [];
  for (const row of unseen.filter(row => row.position <= frontier).sort(editorialOrder)) {
    if (novel.length >= allowance) break;
    if (row !== challenge) novel.push(row);
  }
  // Supply the distinct answers a game needs, even in a tiny or sparse new bank.
  for (const row of [...unseen].sort(editorialOrder)) {
    if (introduced.length + novel.length >= Math.min(minimumPool, rows.length)) break;
    if (!novel.includes(row)) novel.push(row);
  }
  const deadline = row => seenAt(row.progress.dueAt) || row.lastSeen + CONTENT_PRACTICE_GAP_MS;
  const due = introduced.filter(row => deadline(row) <= now).sort((a, b) => deadline(a) - deadline(b)
    || a.lastSeen - b.lastSeen || b.usefulness - a.usefulness || a.tie - b.tie);
  const practice = [...introduced].sort((a, b) => a.lastSeen - b.lastSeen
    || a.readiness - b.readiness || b.usefulness - a.usefulness || a.tie - b.tie);
  const rested = practice.filter(row => now - row.lastSeen >= CONTENT_PRACTICE_GAP_MS);
  const rotation = introduced.reduce((sum, row) => (sum + row.visits) % 5, 0);
  const pattern = ["review", "practice", "new", "review", "practice"];
  const selected = [];
  const selectedIds = new Set();
  while (selected.length < size) {
    const category = pattern[(rotation + selected.length) % pattern.length];
    const queues = category === "new" ? [novel, due, rested, practice]
      : category === "review" ? [due, rested, novel, practice] : [rested, due, novel, practice];
    let next;
    for (const queue of queues) {
      next = queue.find(row => !selectedIds.has(row.id));
      if (next) break;
    }
    if (!next) break;
    selected.push(next);
    selectedIds.add(next.id);
  }
  return selected.slice(0, limit).map(row => row.item);
}
