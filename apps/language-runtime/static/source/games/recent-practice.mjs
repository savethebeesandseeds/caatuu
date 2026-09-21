/** Shared gameplay/evaluator input: the four latest distinct bank identities.
 * Keep insertion order for tied timestamps, as the established runtime does.
 * This is an identity window, not the evaluator's five-turn repetition metric.
 */
export function recentPracticeIds(history = {}) {
  return Object.entries(history).filter(([, row]) => row?.lastSeenAt)
    .sort((a, b) => Date.parse(b[1].lastSeenAt) - Date.parse(a[1].lastSeenAt))
    .slice(0, 4).map(([id]) => id);
}
