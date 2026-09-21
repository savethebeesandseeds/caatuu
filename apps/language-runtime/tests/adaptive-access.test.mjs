import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdaptiveDecision, createSamplingExperiment } from '../static/source/games/adaptive-sampling.mjs';
import { loadEvaluationCorpus } from '../../../tools/learning-evaluation/shared/corpus.mjs';

const now = Date.parse('2026-09-20T12:00:00Z');
const item = (id, complexity, usefulness = 60, difficulty = 1) => ({ id, complexity, usefulness, difficulty });
const options = { now, random: () => .4, difficulty: 1, minimumPool: 1, limit: 1 };
const hardOnly = { frontier: false, introductions: false, slots: false, recency: false };
const rows = [item('first', 1, 20), item('near', 10, 100), item('gap', 70), item('higher', 1, 100, 2)];

test('opt-in access diagnostics and default experiment preserve production draws exactly', () => {
  const plain = createAdaptiveDecision(rows, options);
  const traced = createAdaptiveDecision(rows, { ...options, accessDiagnostics: true });
  const experiment = createSamplingExperiment(rows, options);
  for (const result of [traced, experiment]) {
    assert.deepEqual(result.items, plain.items);
    assert.deepEqual(result.trace.draws[0].distribution, plain.trace.draws[0].distribution);
  }
  assert.equal(plain.trace.draws[0].access, undefined, 'normal gameplay avoids detailed restriction arrays');
  assert.equal(plain.trace.experimentalControls, undefined);
});

test('uniform and adaptive scoring share the identical paced access set at a saved state', () => {
  const adaptive = createSamplingExperiment(rows, options);
  const uniform = createSamplingExperiment(rows, options, { uniformScores: true });
  assert.deepEqual(adaptive.trace.draws[0].access, uniform.trace.draws[0].access);
  assert.deepEqual(uniform.trace.draws[0].distribution, [{ id: 'first', probability: .5 }, { id: 'near', probability: .5 }]);
  assert.notDeepEqual(adaptive.trace.draws[0].distribution, uniform.trace.draws[0].distribution);
});

test('hard-only access reaches every eligible item and keeps the original uniform baseline order', () => {
  const history = { near: { exposures: 1, firstSeenAt: new Date(now - 86400000).toISOString() } };
  const result = createSamplingExperiment(rows, { ...options, history, random: () => .9 }, { ...hardOnly, uniformScores: true });
  assert.deepEqual(result.trace.draws[0].distribution, rows.slice(0, 3).map(row => ({ id: row.id, probability: 1 / 3 })));
  assert.equal(result.items[0].id, 'gap');
  assert.equal(result.trace.candidates.some(row => row.id === 'higher'), false);
});

test('removing only the frontier changes admission without changing feature normalization', () => {
  const paced = createSamplingExperiment(rows, options);
  const open = createSamplingExperiment(rows, options, { frontier: false });
  assert.deepEqual(open.trace.candidates, paced.trace.candidates);
  assert.ok(!paced.trace.draws[0].access.availableIds.includes('gap'));
  assert.ok(open.trace.draws[0].access.availableIds.includes('gap'));
});

test('restriction predicates overlap and minimum-playability restoration is explicit', () => {
  const single = createSamplingExperiment(rows, options).trace.draws[0].access;
  const restricted = single.restrictions.filter(rule => rule.excludedIds.includes('gap')).map(rule => rule.name);
  assert.ok(restricted.includes('frontier') && restricted.includes('slot-allocation'));
  const board = createSamplingExperiment(rows, { ...options, minimumPool: 3, limit: 3 });
  assert.equal(board.items.length, 3);
  assert.ok(board.trace.draws.some(draw => draw.fallbackReasons.includes('distinct-answer-minimum-exceeds-frontier')));
  for (const draw of board.trace.draws) {
    assert.deepEqual(draw.access.availableIds, draw.distribution.filter(row => row.probability > 0).map(row => row.id));
    for (const rule of draw.access.restrictions.filter(rule => rule.kind === 'hard')) assert.deepEqual(rule.restoredIds, []);
  }
});

test('outside exploration mixes full hard support honestly using one random draw', () => {
  let calls = 0;
  const paced = createSamplingExperiment(rows, options);
  const expanded = createSamplingExperiment(rows, { ...options, random: () => { calls++; return .999; } }, { outsideExploration: .05 });
  assert.equal(calls, 1);
  assert.equal(expanded.items[0].id, 'gap');
  const before = new Map(paced.trace.draws[0].distribution.map(row => [row.id, row.probability]));
  for (const row of expanded.trace.draws[0].distribution) {
    assert.ok(Math.abs(row.probability - (.95 * (before.get(row.id) || 0) + .05 / 3)) < 1e-12);
  }
  assert.ok(expanded.trace.draws[0].fallbackReasons.includes('experimental-access-outside-paced-set'));
  assert.ok(expanded.trace.draws[0].access.restrictions.find(rule => rule.name === 'frontier').restoredIds.includes('gap'));
});

test('every experimental access route preserves unique answer groups and hard ceiling', () => {
  const bank = [...rows, { ...item('near-homophone', 99), reading: 'near' }].map(row => ({ ...row, reading: row.reading || row.id }));
  for (const controls of [hardOnly, { frontier: false }, { introductions: false }, { slots: false }, { outsideExploration: 1 }]) {
    const result = createSamplingExperiment(bank, { ...options, minimumPool: 3, limit: 3, getGroupKey: row => row.reading }, controls);
    assert.equal(result.items.length, 3);
    assert.equal(new Set(result.items.map(row => row.reading)).size, 3);
    assert.ok(result.items.every(row => row.difficulty === 1));
    const groups = new Set();
    for (const draw of result.trace.draws) {
      assert.ok(draw.distribution.every(entry => !groups.has(bank.find(row => row.id === entry.id).reading)));
      groups.add(draw.chosenGroupKey);
    }
  }
});

test('experimental controls cannot be enabled through production configuration', () => {
  const normal = createAdaptiveDecision(rows, options);
  const ignored = createAdaptiveDecision(rows, { ...options, controls: hardOnly, config: { frontier: false, slots: false } });
  assert.deepEqual(normal.items, ignored.items);
  assert.deepEqual(normal.trace.draws, ignored.trace.draws);
  assert.throws(() => createSamplingExperiment(rows, options, { mystery: true }), /Unknown/);
  assert.throws(() => createSamplingExperiment(rows, options, { frontier: 0 }), /boolean/);
  assert.throws(() => createSamplingExperiment(rows, options, { outsideExploration: 1.1 }), /finite/);
});

test('real course metadata gaps remain bridgeable on a fresh new slot after either readiness or participation', async t => {
  // Static assessment units test the metadata assumption only. Real parent
  // selection, answer equivalence and playable rounds are tested separately in
  // adaptive-game-integration.test.mjs; these are not simulated learner results.
  const corpus = await loadEvaluationCorpus();
  const banks = Map.groupBy(corpus.playableUnits, unit => JSON.stringify([
    unit.courseId, unit.gameId, unit.bankId, unit.kind
  ]));
  const day = 86400000;
  const at = new Date(now - 2 * day).toISOString();
  const scenarios = {
    readiness: { independentDays: 5, spacedSuccesses: 4, intervalMs: 15 * day },
    participation: { practiceDays: 8 }
  };
  const checked = {};
  for (const [bank, units] of banks) {
    const rows = units.map(unit => ({ id: unit.itemId, ...unit.metadata }));
    for (const difficulty of [1, 2, 3]) {
      const eligible = rows.filter(row => row.difficulty <= difficulty);
      const position = row => (row.difficulty - 1) * 100 + row.complexity;
      const band = row => Math.floor((position(row) - 1) / 10);
      const bands = [...Map.groupBy(eligible, band)].sort((a, b) => a[0] - b[0]);
      for (let index = 0; index < bands.length - 1; index++) {
        const anchor = bands[index][1].reduce((a, b) => position(a) > position(b) ? a : b);
        const nextBand = bands[index + 1][0];
        for (const [scenario, progress] of Object.entries(scenarios)) {
          const history = { [anchor.id]: { exposures: 2, firstSeenAt: at, lastSeenAt: at,
            dueAt: new Date(now + day).toISOString(), ...progress } };
          const result = createAdaptiveDecision(rows, { ...options, difficulty, history, accessDiagnostics: true });
          const label = `${bank}, ceiling ${difficulty}, ${scenario}, band ${bands[index][0]} -> ${nextBand}`;
          assert.equal(result.trace.constraints.nextChallengeBand, nextBand, label);
          assert.equal(band(result.items[0]), nextBand, label);
          assert.ok(result.trace.draws[0].fallbackReasons.includes('nearest-challenge-band-reserved'), label);
          assert.ok(result.items[0].difficulty <= difficulty, label);
          const summary = checked[units[0].courseId] ||= { snapshots: 0, maximumPositionGap: 0 };
          summary.snapshots++;
          summary.maximumPositionGap = Math.max(summary.maximumPositionGap,
            Math.min(...bands[index + 1][1].map(position)) - position(anchor));
        }
      }
    }
  }
  assert.equal(Object.keys(checked).length, corpus.courses.length);
  t.diagnostic(JSON.stringify(checked));
});
