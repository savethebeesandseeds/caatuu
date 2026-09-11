import { selectContentItems } from "./games/content-progression.mjs";

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
  random = Math.random, now = Date.now()
} = {}) {
  const pool = wordWorldProgressionPool(records, { difficulty, history, random, selectedWord, matchesWord, now });
  const excluded = new Set(excludeIds);
  // If recent history covers the eligible practice pool, repeat within that pool.
  const available = pool.filter(record => !excluded.has(record.id));
  return (available.length ? available : pool)[0] || null;
}

export function wordWorldProgressionPool(records, {
  difficulty = 1, history = {}, random = Math.random, selectedWord = "", matchesWord = () => false,
  now = Date.now()
} = {}) {
  const candidates = selectedWord ? records.filter(record => matchesWord(record, selectedWord)) : records;
  return selectContentItems(candidates, { difficulty, history, random, minimumPool: 4, now });
}
