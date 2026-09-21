import { contentPracticeReadiness } from './games/content-progression.mjs';

const activityCounts = ['exposures', 'successes', 'mistakes', 'practiceDays'];
const evidenceCounts = ['independentSuccesses', 'spacedSuccesses', 'independentDays', 'assistedSuccesses', 'lapses'];
const dateFields = ['firstSeenAt', 'lastSeenAt', 'lastPracticeDayAt', 'lastIndependentAt', 'lastAssistedAt', 'lastAttemptAt', 'dueAt'];

function identifier(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${field} must be an explicit nonempty string.`);
  return value;
}

function count(value, field) {
  if (value === undefined) return 0; // Older public histories omit newer counters.
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${field} must be a nonnegative safe integer.`);
  return value;
}

function date(value, field) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new TypeError(`${field} must be an ISO date or null.`);
  return value;
}

/**
 * Read-only view of ONE course-scoped contentHistory(gameId, bankId) entry.
 * The caller supplies its actual course/game/bank identity; public histories do
 * not contain these labels and this function cannot verify their provenance.
 * assessmentDirection labels that bank's task; it does not partition a mixed
 * bank. Pass separate persisted banks for opposite assessment directions.
 * No profile, latent state, embedding, event receipts or activity-to-mastery
 * conversion is used. Missing estimates are deliberately null.
 */
export function learnerItemState({
  courseId, gameId, bankId, itemId, assessmentDirection = null,
  history = {}, now = Date.now()
} = {}) {
  const identity = Object.fromEntries(Object.entries({ courseId, gameId, bankId, itemId })
    .map(([field, value]) => [field, identifier(value, field)]));
  identity.assessmentDirection = assessmentDirection === null ? null : identifier(assessmentDirection, 'assessmentDirection');
  if (!Number.isFinite(now)) throw new TypeError('now must be finite epoch milliseconds.');
  if (!history || typeof history !== 'object' || Array.isArray(history)) throw new TypeError('history must be a contentHistory bank object.');
  const entry = Object.hasOwn(history, itemId) ? history[itemId] : {};
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new TypeError('History entry must be an object.');
  const counts = Object.fromEntries([...activityCounts, ...evidenceCounts, 'intervalMs']
    .map(field => [field, count(entry[field], field)]));
  const dates = Object.fromEntries(dateFields.map(field => [field, date(entry[field], field)]));
  const lastEvidence = entry.lastEvidence ?? 'exposure';
  const lastCorrect = entry.lastCorrect ?? null;
  if (!['exposure', 'assisted', 'independent'].includes(lastEvidence)) throw new TypeError('Unknown evidence classification.');
  if (![null, true, false].includes(lastCorrect)) throw new TypeError('lastCorrect must be boolean or null.');

  // A latest independent error is assessed evidence too. Earlier independent
  // errors cannot be recovered from aggregate mistakes after a later response.
  const independentlyAssessed = counts.independentSuccesses > 0
    || (lastEvidence === 'independent' && lastCorrect !== null && dates.lastAttemptAt !== null);
  const supported = counts.assistedSuccesses > 0 || dates.lastAssistedAt !== null || lastEvidence === 'assisted';
  const presented = counts.exposures > 0 || counts.successes > 0 || counts.mistakes > 0 || dates.lastSeenAt !== null;
  const evidenceStatus = independentlyAssessed ? 'independently-assessed'
    : supported ? 'supported' : presented ? 'exposure-only' : 'unassessed';
  const reasons = ['no-independent-response-denominator', 'no-calibrated-retention-model', 'task-specific-evidence-only'];
  if (!independentlyAssessed) reasons.push('no-retained-independent-assessment');
  if (counts.mistakes > 0) reasons.push('historical-error-support-provenance-unavailable');
  if (dates.lastAttemptAt !== null && lastEvidence === 'assisted') reasons.push('latest-assessment-support-provenance-unavailable');
  if (counts.successes > counts.independentSuccesses + counts.assistedSuccesses) reasons.push('legacy-or-unclassified-successes');
  if (assessmentDirection === null) reasons.push('assessment-direction-unspecified');
  if (dateFields.filter(field => field !== 'dueAt').some(field => dates[field] !== null && Date.parse(dates[field]) > now)) {
    reasons.push('history-ahead-of-clock');
  }
  const elapsed = value => value === null ? null : Math.max(0, now - Date.parse(value));
  const dueMs = dates.dueAt === null ? null : Date.parse(dates.dueAt);

  return {
    identity,
    evidenceStatus,
    activity: {
      ...Object.fromEntries(activityCounts.map(field => [field, counts[field]])),
      firstSeenAt: dates.firstSeenAt, lastSeenAt: dates.lastSeenAt, lastPracticeDayAt: dates.lastPracticeDayAt
    },
    evidence: {
      independentlyAssessed,
      ...Object.fromEntries(evidenceCounts.map(field => [field, counts[field]])),
      lastIndependentAt: dates.lastIndependentAt, lastAssistedAt: dates.lastAssistedAt,
      // An unscored hint can overwrite lastEvidence without changing the last
      // scored timestamp/result, even in the same millisecond. Do not attribute
      // that support to the earlier assessment; public history cannot decide.
      latestAssessment: dates.lastAttemptAt === null ? null
        : { at: dates.lastAttemptAt, correct: lastCorrect, evidence: lastEvidence === 'assisted' ? null : lastEvidence }
    },
    review: {
      dueAt: dates.dueAt, intervalMs: counts.intervalMs,
      isDue: dueMs === null ? null : now >= dueMs,
      overdueMs: dueMs === null ? null : Math.max(0, now - dueMs),
      sinceLastSeenMs: elapsed(dates.lastSeenAt), sinceLastIndependentMs: elapsed(dates.lastIndependentAt)
    },
    uncertainty: { kind: 'unquantified', reasons, independentResponseDenominator: null },
    estimates: { recallProbability: null, independentAccuracy: null, knowledgeProbability: null },
    readiness: {
      kind: 'heuristic', value: contentPracticeReadiness(counts), source: 'contentPracticeReadiness',
      interpretation: 'practice-selection-only', calibrated: false
    }
  };
}

/** Include itemIds from a catalog to represent unseen items as unassessed. */
export function learnerBankState({ history = {}, itemIds = Object.keys(history), ...options } = {}) {
  if (!Array.isArray(itemIds)) throw new TypeError('itemIds must be an array.');
  return [...new Set(itemIds)].map(itemId => learnerItemState({ ...options, history, itemId }));
}
