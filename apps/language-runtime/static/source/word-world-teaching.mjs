import { matchesContentDifficulty } from './games/content-progression.mjs';

function teaching(record) {
  // The controller owns this explicit seam; legacy record.learning has a
  // different contract and must never become an inferred teaching unit.
  return Object.hasOwn(record, 'teaching') ? record.teaching : record.target?.learning;
}

export function wordWorldLearningRows(records, { difficulty = 1, unitId = '' } = {}) {
  return (Array.isArray(records) ? records : []).filter(record =>
    teaching(record)?.unitId && matchesContentDifficulty(record, difficulty)
    && (!unitId || teaching(record).unitId === unitId));
}

export function wordWorldLearningUnits(records, difficulty = 1) {
  const units = new Map();
  for (const record of wordWorldLearningRows(records, { difficulty })
    .sort((a, b) => teaching(a).order - teaching(b).order)) {
    const learning = teaching(record);
    if (!units.has(learning.unitId)) units.set(learning.unitId, {
      id: learning.unitId, title: learning.title, count: 0
    });
    units.get(learning.unitId).count += 1;
  }
  return [...units.values()];
}

/** Ordered presentations and revisits; exposure counts never establish mastery. */
export function selectWordWorldFoundationRecord(records, {
  difficulty = 1, history = {}, excludeIds = []
} = {}) {
  const rows = wordWorldLearningRows(records, { difficulty });
  const excluded = new Set(excludeIds);
  const available = rows.filter(record => !excluded.has(record.id));
  const visits = record => Math.max(0, Number(history[record.id]?.exposures) || 0);
  return (available.length ? available : rows).sort((a, b) =>
    visits(a) - visits(b) || teaching(a).order - teaching(b).order
    || a.id.localeCompare(b.id, 'en'))[0] || null;
}
