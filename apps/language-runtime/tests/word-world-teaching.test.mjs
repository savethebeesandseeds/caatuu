import assert from 'node:assert/strict';
import test from 'node:test';
import { wordWorldLearningRows, wordWorldLearningUnits, selectWordWorldFoundationRecord }
  from '../static/source/word-world-teaching.mjs';

const row = (id, order, unitId = 'introductions', difficulty = 1) => ({
  id, difficulty, teaching: { unitId, order, title: unitId, explanation: 'A rule', focus: ['rule'] }
});
const rows = [row('later', 3, 'questions'), row('first', 1),
  row('advanced', 4, 'questions', 2), row('second', 2), { id: 'unannotated', difficulty: 1 }];

test('foundations follow authored order and revisit only after fresh eligible material', () => {
  assert.equal(selectWordWorldFoundationRecord(rows).id, 'first');
  assert.equal(selectWordWorldFoundationRecord(rows, { history: { first: { exposures: 1 } } }).id, 'second');
  assert.equal(selectWordWorldFoundationRecord(rows, { excludeIds: ['first'] }).id, 'second');
  assert.equal(selectWordWorldFoundationRecord(rows, { history: {
    first: { exposures: 2 }, second: { exposures: 1 }, later: { exposures: 1 }
  } }).id, 'second');
});

test('pattern units use declared objectives and preserve the selected difficulty', () => {
  assert.deepEqual(wordWorldLearningRows(rows, { unitId: 'questions' }).map(r => r.id), ['later']);
  assert.deepEqual(wordWorldLearningUnits(rows), [
    { id: 'introductions', title: 'introductions', count: 2 },
    { id: 'questions', title: 'questions', count: 1 }
  ]);
  assert.equal(selectWordWorldFoundationRecord(rows, { difficulty: 2 }).id, 'advanced');
  assert.equal(selectWordWorldFoundationRecord([], {}), null);
  assert.deepEqual(wordWorldLearningRows(rows, { unitId: 'unknown' }), []);
});

test('an explicit empty teaching seam does not reinterpret legacy learning metadata', () => {
  const legacy = { id: 'legacy', difficulty: 1, teaching: null, learning: { unitId: 'introductions' } };
  assert.deepEqual(wordWorldLearningUnits([legacy]), []);
  assert.equal(selectWordWorldFoundationRecord([legacy]), null);
  assert.equal(legacy.learning.unitId, 'introductions');
});
