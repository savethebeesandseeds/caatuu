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
test('delayed independent practice widens a new-material turn and a word request stays within the badge', () => {
  const history = Object.fromEntries(records.slice(0, 6).map(r => [r.id, {
    exposures: 20, firstSeenAt: now - 20 * DAY, lastSeenAt: now - DAY,
    independentDays: 5, spacedSuccesses: 4, intervalMs: 16 * DAY }]));
  history[records[0].id].exposures += 2; // The next completed-content phase is the new-material slot.
  const chosen = progressiveWordWorldSelection(records, { history, random: () => 0, now,
    excludeIds: records.slice(0, 6).map(r => r.id) });
  assert.ok(records.indexOf(chosen) >= 6 && records.indexOf(chosen) < 16);
  const requested = progressiveWordWorldSelection(records, { selectedWord: 'chosen', now,
    matchesWord: (record, word) => record.tokens.includes(word) });
  assert.ok(requested.tokens.includes('chosen')); assert.equal(requested.difficulty, 1);
  assert.equal(progressiveWordWorldSelection(records, { selectedWord: 'missing', now }), null);
});

test('recent exclusions cannot pull a future exhausted-frontier introduction into this turn', () => {
  const rows = Array.from({ length: 12 }, (_, index) => ({ id: `paced-${index}`,
    difficulty: 1, usefulness: 70, complexity: index < 6 ? 10 : 30 }));
  for (const policy of [null, { identity: { courseId: 'test', gameId: 'word-world', bankId: 'sentences' } }]) {
    const history = Object.fromEntries(rows.slice(0, 6).map(row => [row.id, {
      exposures: 1, firstSeenAt: new Date(now).toISOString(), lastSeenAt: new Date(now).toISOString()
    }]));
    const options = { history, policy, now, random: () => 0,
      excludeIds: rows.slice(0, 6).map(row => row.id) };
    let pool;
    const review = progressiveWordWorldSelection(rows, { ...options, onPool: value => { pool = value; } });
    assert.ok(history[review.id], 'an exhausted recent list repeats within the current practice category');
    assert.deepEqual(pool, [review], 'the controller must see only the single scheduled turn');
    history[rows[0].id].exposures += 1;
    const fresh = progressiveWordWorldSelection(rows, options);
    assert.equal(fresh.complexity, 30, 'the following scheduled new slot admits the nearest band');
    assert.ok(!history[fresh.id]);
  }
});

test('massed mistakes retain zero readiness while the exhausted window continues into the nearest band', () => {
  const history = {}; const excludeIds = []; const visited = new Set();
  for (let step = 1; step <= 80; step++) {
    const row = progressiveWordWorldSelection(records, { history, excludeIds, random: () => 0, now: now + step * 1000 });
    visited.add(row.id); excludeIds.push(row.id);
    history[row.id] = { exposures: (history[row.id]?.exposures || 0) + 1,
      firstSeenAt: history[row.id]?.firstSeenAt || now, lastSeenAt: now + step * 1000, lastCorrect: false };
  }
  assert.ok(visited.size > 6, 'continuing play must not remain trapped in the first six sentences');
  assert.ok([...visited].every(id => records.find(row => row.id === id).difficulty === 1));
  assert.ok(Object.values(history).every(progress => !progress.spacedSuccesses && !progress.independentDays));
  assert.ok(records.filter(row => row.difficulty !== 1).every(row => !history[row.id]));
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

test('changing difficulty filters before old due reviews and exhausted recent history', () => {
  const history = Object.fromEntries(records.filter(row => row.difficulty === 1).map(row => [row.id, {
    exposures: 20, firstSeenAt: new Date(now - 20 * DAY).toISOString(),
    lastSeenAt: new Date(now - DAY).toISOString(), dueAt: new Date(now - DAY).toISOString(),
    independentDays: 5, spacedSuccesses: 4, intervalMs: 16 * DAY
  }]));
  const original = structuredClone(history);
  for (const policy of [null, { identity: { courseId: 'test', gameId: 'word-world', bankId: 'sentences' } }]) {
    for (const difficulty of [2, 1, 2]) {
      const chosen = progressiveWordWorldSelection(records, { difficulty, history, policy,
        excludeIds: records.map(row => row.id), random: () => 0, now });
      assert.equal(chosen.difficulty, difficulty);
    }
    assert.equal(progressiveWordWorldSelection(records, { difficulty: 3, history, policy, now }), null);
  }
  assert.deepEqual(history, original, 'changing difficulty never rewrites completed evidence');
});
