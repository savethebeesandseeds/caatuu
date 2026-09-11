import assert from 'node:assert/strict';
import test from 'node:test';
import { progressiveWordWorldSelection, wordWorldPracticeHistory, wordWorldEvidenceBank } from '../static/source/word-world-progression.mjs';
const now = Date.UTC(2026, 0, 20, 12);
const DAY = 86400000;
const records = Array.from({ length: 20 }, (_, i) => ({ id: `sentence-${String(i).padStart(2, '0')}`,
  difficulty: i < 16 ? 1 : 2, usefulness: i < 6 ? 95 : 60, complexity: i < 6 ? 10 : 30,
  tokens: i % 2 ? ['chosen'] : ['different'] }));

test('history exclusions stay within the current challenge range', () => {
  const chosen = progressiveWordWorldSelection(records, { excludeIds: records.slice(0, 6).map(r => r.id), random: () => 0, now });
  assert.ok(records.indexOf(chosen) < 6);
});
test('delayed independent practice widens selection and a word request stays within the badge', () => {
  const history = Object.fromEntries(records.slice(0, 6).map(r => [r.id, {
    exposures: 20, firstSeenAt: now - 20 * DAY, lastSeenAt: now - DAY,
    independentDays: 5, spacedSuccesses: 4, intervalMs: 16 * DAY }]));
  const chosen = progressiveWordWorldSelection(records, { history, random: () => 0, now,
    excludeIds: records.slice(0, 6).map(r => r.id) });
  assert.ok(records.indexOf(chosen) >= 6 && records.indexOf(chosen) < 16);
  const requested = progressiveWordWorldSelection(records, { selectedWord: 'chosen', now,
    matchesWord: (record, word) => record.tokens.includes(word) });
  assert.ok(requested.tokens.includes('chosen')); assert.equal(requested.difficulty, 1);
  assert.equal(progressiveWordWorldSelection(records, { selectedWord: 'missing', now }), null);
});

test('massed mistakes rotate practice without inferring retention or raising the challenge', () => {
  const history = {}; const excludeIds = []; const visited = new Set();
  for (let step = 1; step <= 80; step++) {
    const row = progressiveWordWorldSelection(records, { history, excludeIds, random: () => 0, now: now + step * 1000 });
    visited.add(row.id); excludeIds.push(row.id);
    history[row.id] = { exposures: (history[row.id]?.exposures || 0) + 1,
      firstSeenAt: history[row.id]?.firstSeenAt || now, lastSeenAt: now + step * 1000, lastCorrect: false };
  }
  assert.equal(visited.size, 6);
  assert.ok(records.slice(6).every(row => !history[row.id]));
});

test('general exposure is reusable but directional recall evidence does not transfer', () => {
  const exposure = { x: { exposures: 20, successes: 20, firstSeenAt: now - DAY,
    lastSeenAt: now, independentDays: 9, spacedSuccesses: 8, intervalMs: DAY * 30 } };
  const source = { x: { exposures: 3, independentDays: 2, spacedSuccesses: 1, intervalMs: DAY } };
  const noDirection = wordWorldPracticeHistory(exposure);
  assert.equal(noDirection.x.exposures, 20);
  assert.equal(noDirection.x.independentDays, undefined);
  assert.equal(noDirection.x.spacedSuccesses, undefined);
  assert.equal(wordWorldPracticeHistory(exposure, source).x.independentDays, 2);
  assert.notEqual(wordWorldEvidenceBank('source'), wordWorldEvidenceBank('target'));
  assert.equal(wordWorldEvidenceBank('source'), 'reconstruct-target');
  assert.equal(Object.getPrototypeOf(wordWorldPracticeHistory(JSON.parse('{"__proto__":{"exposures":2}}'))), null);
});