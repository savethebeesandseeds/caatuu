// Synthetic, ordered, unique encounters only. This is a scheduler input adapter,
// not production persistence, an estimator, or the production event reducer.
const DAY = 86400000;
const iso = now => new Date(now).toISOString();
const elapsedDay = (now, previous) => previous == null ||
  (now - Date.parse(previous) >= DAY && iso(now).slice(0, 10) !== previous.slice(0, 10));

export function recordOutcome(history, itemId, outcome, now) {
  if (!['exposure', 'assisted', 'independent'].includes(outcome.evidence)
      || ![true, false, null].includes(outcome.correct)) throw new TypeError('Invalid evidence outcome.');
  if (!Number.isFinite(now) || now < 0) throw new TypeError('Invalid evidence time.');
  const previous = Object.hasOwn(history, itemId) ? history[itemId] : null;
  if (previous && now < Date.parse(previous.lastSeenAt)) throw new TypeError('Encounters must be ordered.');
  const row = previous || { exposures: 0, successes: 0, mistakes: 0,
    independentSuccesses: 0, assistedSuccesses: 0, independentDays: 0,
    spacedSuccesses: 0, practiceDays: 0, intervalMs: 0, lapses: 0,
    firstSeenAt: iso(now), lastSeenAt: null, lastPracticeDayAt: null,
    lastIndependentAt: null, spacingAnchorAt: null, dueAt: null };
  const lastSeenAt = row.lastSeenAt;
  row.exposures++;
  if (elapsedDay(now, row.lastPracticeDayAt)) {
    row.practiceDays++;
    row.lastPracticeDayAt = iso(now);
  }
  if (outcome.correct === false) { row.mistakes++; row.lapses++; }
  if (outcome.correct === true) row.successes++;
  if (outcome.evidence === 'assisted') {
    row.lastAssistedAt = iso(now);
    if (outcome.correct === true) row.assistedSuccesses++;
  }
  if (outcome.correct === false || outcome.evidence === 'assisted') {
    row.intervalMs = Math.min(row.intervalMs || 600000, 600000);
    row.dueAt = iso(now + row.intervalMs);
  } else if (outcome.evidence === 'independent' && outcome.correct === true) {
    const first = row.spacingAnchorAt === null;
    const interval = Math.max(DAY, row.intervalMs);
    const spaced = !first && elapsedDay(now, row.spacingAnchorAt)
      && now - Date.parse(row.spacingAnchorAt) >= interval
      && lastSeenAt !== null && now - Date.parse(lastSeenAt) >= interval;
    row.independentSuccesses++;
    row.lastIndependentAt = iso(now);
    if (first || spaced) {
      row.independentDays++;
      if (spaced) row.spacedSuccesses++;
      row.intervalMs = first ? DAY : Math.min(30 * DAY, Math.round(interval * 1.8));
      row.spacingAnchorAt = iso(now);
    }
    row.dueAt = iso(now + row.intervalMs);
  }
  row.lastSeenAt = iso(now);
  row.lastEvidence = outcome.evidence;
  if (outcome.correct !== null) { row.lastCorrect = outcome.correct; row.lastAttemptAt = iso(now); }
  Object.defineProperty(history, itemId, { value: row, enumerable: true, writable: true, configurable: true });
  return row;
}
