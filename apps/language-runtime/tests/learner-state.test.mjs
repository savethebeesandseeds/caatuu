import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { createBrowserHarness } from './helpers/fake-browser.mjs';
import { learnerItemState, learnerBankState } from '../static/source/learner-state.mjs';
import { contentPracticeReadiness } from '../static/source/games/content-progression.mjs';

const source = await readFile(new URL('../static/source/learning-profile.js', import.meta.url), 'utf8');
const start = Date.parse('2026-01-01T12:00:00.000Z');
const day = 86_400_000;
const identity = { courseId: 'test', gameId: 'word-world', bankId: 'reconstruct-target', itemId: 'a', assessmentDirection: 'reconstruct-target' };

function fixture() {
  const clock = { now: start };
  const harness = createBrowserHarness({ course: { id: 'test', storage: { namespace: 'learner-state-test' } } });
  harness.context.Date = class extends Date {
    constructor(...args) { super(...(args.length ? args : [clock.now])); }
    static now() { return clock.now; }
  };
  let nextId = 0;
  harness.window.crypto = { randomUUID: () => `event-${++nextId}` };
  harness.window.navigator.locks = { request: async (_name, action) => action() };
  vm.runInContext(source, harness.context);
  const learning = harness.window.CaatuuLearning;
  return {
    clock, learning,
    record: (encounterId, evidence, correct, changes = {}) => learning.recordExposure(identity.gameId,
      { bankId: identity.bankId, itemId: identity.itemId, encounterId, evidence, correct, ...changes }),
    state: (changes = {}) => learnerItemState({ ...identity,
      history: learning.contentHistory(identity.gameId, changes.bankId || identity.bankId), now: clock.now, ...changes })
  };
}

test('unseen and legacy activity remain unavailable as independent knowledge estimates', () => {
  const unseen = learnerItemState({ ...identity, now: start });
  assert.equal(unseen.evidenceStatus, 'unassessed');
  assert.equal(unseen.review.isDue, null);
  const history = { a: { exposures: 80, successes: 70, mistakes: 10, lastSeenAt: new Date(start).toISOString(), lastCorrect: true } };
  const state = learnerItemState({ ...identity, history, now: start });
  assert.equal(state.evidenceStatus, 'exposure-only');
  assert.deepEqual([state.activity.successes, state.activity.mistakes], [70, 10]);
  assert.equal(state.evidence.independentSuccesses, 0);
  assert.equal(state.evidence.latestAssessment, null);
  assert.equal(state.readiness.value, 0);
  assert.ok(Object.values(state.estimates).every(value => value === null));
  assert.equal(state.uncertainty.independentResponseDenominator, null);
});

test('real exposure, assistance and failed independent assessment have distinct evidence status', async () => {
  const f = fixture();
  f.record('exposure', 'exposure', null);
  assert.equal(f.state().evidenceStatus, 'exposure-only');
  f.record('supported', 'assisted', true);
  assert.equal(f.state().evidenceStatus, 'supported');
  f.record('failed', 'independent', false);
  const state = f.state();
  assert.equal(state.evidenceStatus, 'independently-assessed');
  assert.equal(state.evidence.independentSuccesses, 0);
  assert.equal(state.evidence.latestAssessment.correct, false);
  assert.equal(state.review.intervalMs, 600_000);
  assert.equal(state.readiness.value, 0);
  await f.learning.retryPendingSaves();
});

test('corrections and duplicates use real reducer results without fabricating independent credit', async () => {
  const f = fixture();
  f.record('attempt', 'independent', false);
  f.record('attempt', 'assisted', true);
  f.record('attempt', 'assisted', true);
  const state = f.state();
  assert.equal(state.activity.exposures, 1);
  assert.equal(state.activity.mistakes, 1);
  assert.equal(state.evidence.assistedSuccesses, 1);
  assert.equal(state.evidence.independentSuccesses, 0);
  assert.equal(state.evidenceStatus, 'supported');
  assert.ok(state.uncertainty.reasons.includes('historical-error-support-provenance-unavailable'));
  await f.learning.retryPendingSaves();
});

test('spaced evidence and overdue timing preserve heuristic interpretation over a long gap', async () => {
  const f = fixture();
  f.record('first', 'independent', true);
  f.clock.now += 2 * day;
  f.record('spaced', 'independent', true);
  const before = f.state();
  assert.equal(before.evidence.spacedSuccesses, 1);
  assert.equal(before.readiness.value, contentPracticeReadiness(f.learning.contentHistory(identity.gameId, identity.bankId).a));
  assert.equal(before.readiness.calibrated, false);
  assert.equal(before.review.isDue, false);
  f.clock.now += 90 * day;
  const after = f.state();
  assert.equal(after.review.isDue, true);
  assert.ok(after.review.overdueMs > 0);
  assert.deepEqual(after.evidence, before.evidence);
  assert.deepEqual(after.estimates, before.estimates);
  assert.equal(after.readiness.value, before.readiness.value);
  await f.learning.retryPendingSaves();
});

test('directions, item IDs and caller identity stay explicit; unrelated banks receive no transfer', async () => {
  const f = fixture();
  f.record('first', 'independent', true);
  const reverse = f.state({ bankId: 'reconstruct-source', assessmentDirection: 'reconstruct-source' });
  assert.equal(reverse.evidenceStatus, 'unassessed');
  assert.equal(reverse.identity.assessmentDirection, 'reconstruct-source');
  assert.equal(f.state({ itemId: 'related' }).evidenceStatus, 'unassessed');
  const history = Object.fromEntries([['__proto__', { exposures: 1 }]]);
  const states = learnerBankState({ ...identity, history, itemIds: ['__proto__', 'unseen', '__proto__'], now: start });
  assert.equal(states.length, 2);
  assert.equal(states[0].activity.exposures, 1);
  assert.equal(states[1].evidenceStatus, 'unassessed');
  assert.deepEqual(states[0].identity, { ...identity, itemId: '__proto__' });
  await f.learning.retryPendingSaves();
});

test('adapter neither mutates history nor accepts malformed confidence-producing input', () => {
  const history = Object.freeze({ a: Object.freeze({ exposures: 3, independentSuccesses: 1 }) });
  learnerItemState({ ...identity, history, now: start });
  assert.deepEqual(history.a, { exposures: 3, independentSuccesses: 1 });
  for (const changes of [{ courseId: '' }, { gameId: undefined }, { now: NaN }, { history: [] },
    { history: { a: { independentSuccesses: -1 } } }, { history: { a: { dueAt: 'not-a-date' } } }]) {
    assert.throws(() => learnerItemState({ ...identity, now: start, ...changes }), TypeError);
  }
});

test('later unscored support cannot relabel an older assessment, including same-millisecond support', async () => {
  for (const correct of [true, false]) {
    for (const elapsed of [0, 1000]) {
      const f = fixture();
      f.record('assessed', 'independent', correct);
      const before = f.state();
      f.clock.now += elapsed;
      f.record('later-support', 'assisted', null);
      const after = f.state();
      assert.equal(after.evidence.latestAssessment.at, before.evidence.latestAssessment.at);
      assert.equal(after.evidence.latestAssessment.correct, correct);
      assert.equal(after.evidence.latestAssessment.evidence, null);
      assert.ok(after.uncertainty.reasons.includes('latest-assessment-support-provenance-unavailable'));
      assert.equal(after.evidence.independentlyAssessed, correct);
      assert.equal(after.uncertainty.independentResponseDenominator, null);
      await f.learning.retryPendingSaves();
    }
  }
});
