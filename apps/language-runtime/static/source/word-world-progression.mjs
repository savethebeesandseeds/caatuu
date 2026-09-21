import { selectContentItems } from "./games/adaptive-practice.mjs";

/** Keep evidence for recognizing meaning and assembling the target language separate. */
export function wordWorldEvidenceBank(promptSide) {
  return promptSide === "source" ? "reconstruct-target" : "reconstruct-source";
}

export function wordWorldPracticeHistory(exposureHistory = {}, modeHistory = {}) {
  const result = Object.create(null);
  for (const id of new Set([...Object.keys(exposureHistory), ...Object.keys(modeHistory)])) {
    const exposure = Object.hasOwn(exposureHistory, id) ? exposureHistory[id] : {};
    const mode = Object.hasOwn(modeHistory, id) ? modeHistory[id] : {};
    // General encounters establish prior presentation, never recall in another direction.
    result[id] = { exposures: exposure?.exposures || 0, firstSeenAt: exposure?.firstSeenAt,
      lastSeenAt: exposure?.lastSeenAt, practiceDays: exposure?.practiceDays || 0,
      lastPracticeDayAt: exposure?.lastPracticeDayAt, ...mode };
  }
  return result;
}

/** Apply spaced practice after adapting either legacy or modern course records. */
export function progressiveWordWorldSelection(records, {
  difficulty = 1, history = {}, excludeIds = [], selectedWord = "", matchesWord = () => false,
  random = Math.random, now = Date.now(), policy = null, onPool = () => {}
} = {}) {
  const adaptive = policy?.identity && policy.id !== 'existing';
  const pool = wordWorldProgressionPool(records, { difficulty, history, random, selectedWord, matchesWord, now,
    policy, excludeIds, limit: adaptive ? 1 : Infinity });
  onPool(pool);
  // The adaptive decision already accounts for recent exclusions and reports
  // its actual conditional probability. Never filter or resample it afterward.
  if (adaptive) return pool[0] || null;
  const excluded = new Set(excludeIds);
  // If recent history covers the eligible practice pool, repeat within that pool.
  const available = pool.filter(record => !excluded.has(record.id));
  return (available.length ? available : pool)[0] || null;
}

export function wordWorldProgressionPool(records, {
  difficulty = 1, history = {}, random = Math.random, selectedWord = "", matchesWord = () => false,
  now = Date.now(), policy = null, excludeIds = [], limit = Infinity
} = {}) {
  const candidates = selectedWord ? records.filter(record => matchesWord(record, selectedWord)) : records;
  return selectContentItems(candidates, { difficulty, history, random, minimumPool: 4, now, policy, excludeIds, limit });
}
