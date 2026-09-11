import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeContentProgression, selectContentItems, newContentEncounterId,
  contentPracticeReadiness, CONTENT_DAY_MS as DAY } from '../static/source/games/content-progression.mjs';

const NOW = Date.UTC(2026, 0, 20, 12);
const item = (id, complexity = 10, usefulness = 80, difficulty = 1) => ({ id, difficulty, usefulness, complexity });
const bank = (n = 24) => Array.from({ length: n }, (_, i) => item(`item-${String(i).padStart(2, '0')}`, 10 + Math.floor(i / 6) * 20));
const retained = () => ({ exposures: 20, independentSuccesses: 8, independentDays: 5,
  spacedSuccesses: 4, intervalMs: 16 * DAY, firstSeenAt: NOW - 20 * DAY,
  lastSeenAt: NOW - DAY, dueAt: NOW - 1000 });
const choose = (items, options = {}) => selectContentItems(items, { now: NOW, random: () => 0, ...options });

// Synthetic records exercise scheduling contracts; real phrase wording is not an assertion.
test('badge remains a hard ceiling; useful, simple introductions come first', () => {
  const items = [item('ordinary', 2, 20), item('essential', 8, 95), item('later', 70), item('badge-two', 1, 100, 2)];
  const selected = choose(items, { difficulty: 1, minimumPool: 1 });
  assert.equal(selected[0].id, 'essential');
  assert.deepEqual(new Set(selected.map(row => row.id)), new Set(['essential', 'ordinary']));
});

test('mass repetition, correct counters and legacy exposure do not widen the challenge range', () => {
  const items = bank();
  for (const exposures of [3, 20, 1000]) {
    const history = Object.fromEntries(items.slice(0, 6).map(row => [row.id, {
      exposures, successes: exposures, independentSuccesses: exposures,
      firstSeenAt: NOW - DAY, lastSeenAt: NOW - DAY, independentDays: 1,
      intervalMs: DAY, spacedSuccesses: 0
    }]));
    assert.equal(contentPracticeReadiness(history[items[0].id]), 0);
    assert.ok(choose(items, { history }).every(row => row.complexity === 10));
  }
});

test('delayed independent evidence opens gradual challenge while one stubborn item remains in practice', () => {
  const items = bank();
  const history = Object.fromEntries(items.slice(0, 6).map(row => [row.id, retained()]));
  history[items[0].id] = { exposures: 50, mistakes: 50, firstSeenAt: NOW - 20 * DAY, lastSeenAt: NOW - DAY };
  const selected = choose(items, { history });
  assert.ok(selected.some(row => row.complexity === 30));
  assert.ok(selected.some(row => row.id === items[0].id));
  assert.ok(selected.every(row => row.complexity <= 34));
});

test('small new introductions continue alongside supported practice without a cohort gate', () => {
  const items = Array.from({ length: 20 }, (_, i) => item(`easy-${i}`));
  const history = Object.fromEntries(items.slice(0, 6).map(row => [row.id, {
    exposures: 1, firstSeenAt: NOW - DAY, lastSeenAt: NOW - DAY, dueAt: NOW - 1
  }]));
  const selected = choose(items, { history });
  assert.ok(selected.some(row => !history[row.id]));
  assert.ok(selected.some(row => history[row.id]));
  assert.ok(selected.length <= 6);
});

test('daily introduction budget limits a rapid run and backlog slows fresh introductions', () => {
  const items = Array.from({ length: 40 }, (_, i) => item(`easy-${i}`));
  const history = {};
  for (let step = 0; step < 100; step++) {
    const [row] = choose(items, { history, limit: 1, now: NOW + step * 1000 });
    history[row.id] = { exposures: (history[row.id]?.exposures || 0) + 1,
      firstSeenAt: history[row.id]?.firstSeenAt ?? NOW, lastSeenAt: NOW + step * 1000 };
  }
  assert.equal(Object.keys(history).length, 6);
  for (const row of items.slice(0, 20)) history[row.id] = { exposures: 1, firstSeenAt: NOW - DAY, lastSeenAt: NOW - DAY };
  const novel = choose(items, { history }).filter(row => !history[row.id]);
  assert.ok(novel.length >= 1 && novel.length <= 2);
});

test('an error or early practice does not monopolize selection or erase due review', () => {
  const items = Array.from({ length: 30 }, (_, i) => item(`review-${i}`));
  const history = Object.fromEntries(items.map(row => [row.id, { ...retained(), lastSeenAt: NOW - DAY }]));
  const visited = new Set();
  for (let step = 0; step < items.length; step++) {
    const [row] = choose(items, { history, limit: 1, now: NOW + step * 1000 });
    visited.add(row.id);
    history[row.id] = { ...history[row.id], exposures: history[row.id].exposures + 1,
      lastSeenAt: NOW + step * 1000, dueAt: NOW + step * 1000 + 600000, lastCorrect: false };
  }
  assert.equal(visited.size, items.length);
});

test('future scheduled recall yields to rested items and new material', () => {
  const items = [item('just-correct'), item('rested'), item('new')];
  const history = { 'just-correct': { ...retained(), lastSeenAt: NOW, dueAt: NOW + DAY },
    rested: { ...retained(), lastSeenAt: NOW - DAY, dueAt: NOW + DAY } };
  const selected = choose(items, { history, minimumPool: 1 });
  assert.notEqual(selected[0].id, 'just-correct');
  assert.ok(selected.some(row => row.id === 'new'));
});

test('sparse and tiny banks remain playable; delayed evidence can cross an editorial gap', () => {
  const items = [item('first', 1), item('gap', 95), item('next-badge', 5, 80, 2)];
  assert.equal(choose(items.slice(0, 2), { minimumPool: 8 }).length, 2);
  const selected = choose(items, { minimumPool: 1, history: { first: retained() } });
  assert.ok(selected.some(row => row.id === 'gap'));
  assert.ok(!selected.some(row => row.id === 'next-badge'));
});

test('selection is read only, deterministic with its inputs, and safe for arbitrary IDs', () => {
  const items = bank(); const history = { xp: 9000, attempts: 4000 };
  const snapshot = structuredClone({ items, history });
  const first = choose(items, { history });
  for (let n = 0; n < 10; n++) assert.deepEqual(choose(items, { history }), first);
  assert.deepEqual({ items, history }, snapshot);
  assert.equal(choose([item('__proto__')])[0].id, '__proto__');
  assert.equal(choose([item('duplicate'), item('duplicate')]).length, 1);
});

test('both editorial fields accept the full100 scale, with strict legacy compatibility only when absent', () => {
  for (const field of ['usefulness', 'complexity']) {
    for (const value of [1, 17, 51, 99, 100]) assert.equal(normalizeContentProgression({ [field]: value })[field], value);
    for (const value of [0, 101, 1.5, '2', null, NaN]) {
      assert.throws(() => normalizeContentProgression({ [field]: value, urgency: 3, subdifficulty: 3 }), new RegExp(field));
    }
  }
  assert.deepEqual(normalizeContentProgression({}), { usefulness: 50, complexity: 50 });
  assert.deepEqual(normalizeContentProgression({ urgency: 5, subdifficulty: 2 }), { usefulness: 100, complexity: 25 });
  assert.deepEqual(normalizeContentProgression({ usefulness: 17, complexity: 44, urgency: 'obsolete' }), { usefulness: 17, complexity: 44 });
  assert.throws(() => normalizeContentProgression({ urgency: 6 }), /urgency/);
  assert.notEqual(newContentEncounterId(), newContentEncounterId());
});

test('invalid selection settings fail at the boundary', () => {
  assert.throws(() => choose(null), /array/);
  for (const difficulty of [0, 4, '1']) assert.throws(() => choose([], { difficulty }), /difficulty/);
  for (const now of [-1, NaN, Infinity]) assert.throws(() => choose([], { now }), /timestamp/);
  assert.throws(() => choose([], { minimumPool: 0 }), /minimumPool/);
  assert.throws(() => choose([], { limit: 0 }), /limit/);
});
test('supported practice across separate days permits slow exploration without recall credit', () => {
  const items = bank();
  const history = Object.fromEntries(items.slice(0, 6).map(row => [row.id, {
    exposures: 100, assistedSuccesses: 80, practiceDays: 8,
    firstSeenAt: NOW - 12 * DAY, lastSeenAt: NOW - DAY
  }]));
  const selected = choose(items, { history });
  assert.ok(selected.some(row => row.complexity === 30));
  assert.ok(selected.every(row => row.complexity <= 30));
  assert.ok(Object.values(history).every(progress => contentPracticeReadiness(progress) === 0));
  const sparse = [item('first', 10), item('next', 90)];
  assert.ok(choose(sparse, { minimumPool: 1, history: { first: history[items[0].id] } }).some(row => row.id === 'next'));
});

test('filtering a bank does not reset its daily introduction budget', () => {
  const items = Array.from({ length: 15 }, (_, i) => item(`filtered-${i}`));
  const history = Object.fromEntries(items.slice(0, 8).map(row => [row.id, {
    exposures: 1, firstSeenAt: NOW, lastSeenAt: NOW - 1000
  }]));
  const selected = choose(items.slice(4), { history, minimumPool: 4 });
  assert.ok(selected.every(row => history[row.id]));
});
test('large easy banks cannot become implicit prerequisites for the next challenge band', () => {
  for (const easyCount of [12, 300]) {
    const items = [...Array.from({ length: easyCount }, (_, i) => item(`easy-${i}`, 10)),
      item('next-band', 70), item('another-next-band', 70), item('later-band', 95)];
    const history = Object.fromEntries(items.slice(0, 6).map(row => [row.id, {
      exposures: 30, practiceDays: 8, firstSeenAt: NOW - 12 * DAY, lastSeenAt: NOW - DAY
    }]));
    const selected = choose(items, { history });
    const challenges = selected.filter(row => row.complexity > 10);
    assert.equal(challenges.length, 1);
    assert.equal(challenges[0].complexity, 70, 'try the nearest band, never leap past an available intermediate band');
    history[challenges[0].id] = { exposures: 1, firstSeenAt: NOW, lastSeenAt: NOW };
    const following = choose(items, { history });
    assert.ok(following.some(row => !history[row.id] && row.complexity === 10), 'ordinary introductions continue too');
    assert.ok(following.every(row => history[row.id] || row.complexity === 10),
      'the challenge opportunity consumes its daily slot and cannot chain into further new challenges');
  }
});
