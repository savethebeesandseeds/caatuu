import assert from 'node:assert/strict';
import test from 'node:test';
import { createAdaptiveDecision, selectAdaptiveItems } from '../static/source/games/adaptive-sampling.mjs';
import { CONTENT_DAY_MS as DAY } from '../static/source/games/content-progression.mjs';

const NOW = Date.UTC(2026, 8, 20, 12);
const identity = { courseId: 'fixture', gameId: 'fixture-game', bankId: 'recognition' };
const item = (id, complexity = 10, usefulness = 70, difficulty = 1) => ({ id, difficulty, usefulness, complexity });
const bank = (size = 30) => Array.from({ length: size }, (_, index) => item(`item-${index}`));
const iso = time => new Date(time).toISOString();
const seen = (extra = {}) => ({ exposures: 1, firstSeenAt: iso(NOW - DAY), lastSeenAt: iso(NOW - DAY), ...extra });
const retained = () => seen({ exposures: 20, independentSuccesses: 8, independentDays: 5,
  spacedSuccesses: 4, intervalMs: 16 * DAY, dueAt: iso(NOW - 1000) });
const decide = (items, options = {}) => createAdaptiveDecision(items, { now: NOW, random: () => .4, ...options });
const probability = (decision, id, step = 0) => decision.trace.draws[step].distribution.find(row => row.id === id)?.probability ?? 0;

test('hard difficulty, unique identity and original item references survive stochastic selection', () => {
  const rows = [item('a'), item('b'), item('a'), item('higher', 1, 100, 2), item('__proto__')];
  const decision = decide(rows, { difficulty: 1, minimumPool: 8 });
  assert.equal(decision.items.length, 3);
  assert.equal(new Set(decision.items.map(row => row.id)).size, 3);
  assert.ok(decision.items.every(row => row.difficulty === 1 && rows.includes(row)));
  assert.equal(decision.trace.eligibleCount, 3);
  assert.deepEqual(decide([], { identity }).items, []);
});

test('frontier uses spaced evidence and participation, never exposures or supplied mastery', () => {
  const rows = [...bank(12), item('too-hard', 70), item('next', 30)];
  const history = Object.fromEntries(rows.slice(0, 6).map(row => [row.id, seen({ exposures: 1000, successes: 1000,
    independentSuccesses: 1000, independentDays: 1, spacedSuccesses: 0, intervalMs: DAY })]));
  const learner = { knowledgeByItem: Object.fromEntries(rows.map(row => [row.id, { recallProbability: 1 }])) };
  const first = decide(rows, { history, learner });
  assert.equal(first.trace.constraints.frontier, 28);
  assert.ok(first.items.every(row => row.complexity === 10));
  history[rows[0].id] = retained();
  const later = decide(rows, { history });
  assert.ok(later.trace.constraints.frontier >= 30);
  assert.ok(later.trace.candidates.find(row => row.id === 'next'));
});

test('same-day introductions continue only in their paced slot after the daily target', () => {
  const rows = bank(60), history = {}, introductionSteps = [];
  for (let step = 0; step < 100; step++) {
    const [row] = decide(rows, { history, minimumPool: 1, limit: 1, now: NOW + step * 1000 }).items;
    if (!history[row.id]) introductionSteps.push(step);
    history[row.id] = { exposures: (history[row.id]?.exposures || 0) + 1,
      firstSeenAt: history[row.id]?.firstSeenAt ?? iso(NOW), lastSeenAt: iso(NOW + step * 1000) };
  }
  assert.ok(introductionSteps.length > 6 && introductionSteps.length <= 26);
  for (let index = 7; index < introductionSteps.length; index++) {
    assert.ok(introductionSteps[index] - introductionSteps[index - 1] >= 5);
  }
});

test('the full bank history controls pacing even for a filtered candidate bank', () => {
  const rows = bank(20);
  const history = Object.fromEntries(rows.slice(0, 8).map(row => [row.id, seen({ firstSeenAt: iso(NOW), lastSeenAt: iso(NOW) })]));
  const result = decide(rows.slice(4), { history });
  assert.equal(result.trace.constraints.introducedToday, 8);
  assert.ok(result.items.filter(row => !history[row.id]).length <= 1);
});

test('minimum distinct answers can cross a sparse frontier but never the badge ceiling', () => {
  const rows = [item('first', 1), item('gap', 90), item('higher-badge', 1, 100, 2)];
  const decision = decide(rows, { difficulty: 1, minimumPool: 8 });
  assert.equal(decision.items.length, 2);
  assert.deepEqual(decision.trace.constraints.playabilityFallbackIds, ['gap']);
  assert.ok(decision.trace.draws.some(draw => draw.fallbackReasons.includes('distinct-answer-minimum-exceeds-frontier')));
});

test('a sparse challenge cohort cannot leave a required board short of distinct answers', () => {
  const rows = [...bank(3), ...Array.from({ length: 5 }, (_, index) => item(`gap-${index}`, 90))];
  const history = Object.fromEntries(rows.slice(0, 3).map(row => [row.id, retained()]));
  const decision = decide(rows, { history, minimumPool: 8 });
  assert.equal(decision.items.length, 8);
  assert.equal(new Set(decision.items.map(row => row.id)).size, 8);
  assert.ok(decision.trace.constraints.playabilityFallbackIds.length >= 4);
});

test('homophone groups stay distinct through one mixed review/new board and its conditional traces', () => {
  const rows = Array.from({ length: 6 }, (_, group) => Array.from({ length: 3 }, (_, variant) =>
    ({ ...item(`reading-${group}-${variant}`), reading: `reading-${group}` }))).flat();
  const history = Object.fromEntries(rows.filter(row => row.id.endsWith('-0')).map(row => [row.id, retained()]));
  for (const kind of ['balanced', 'explore', 'review']) {
    let calls = 0;
    const result = decide(rows, { history, minimumPool: 4, limit: 4, goal: { kind },
      getGroupKey: row => row.reading, random: () => { calls++; return .6; } });
    assert.equal(result.items.length, 4);
    assert.equal(new Set(result.items.map(row => row.reading)).size, 4);
    assert.equal(calls, 4, 'a single decision draws only the four actual choices');
    const selectedGroups = new Set();
    for (const draw of result.trace.draws) {
      for (const candidate of draw.distribution) {
        assert.ok(!selectedGroups.has(rows.find(row => row.id === candidate.id).reading));
      }
      assert.ok(!selectedGroups.has(draw.chosenGroupKey));
      selectedGroups.add(draw.chosenGroupKey);
      assert.ok(Math.abs(draw.distribution.reduce((sum, row) => sum + row.probability, 0) - 1) < 1e-12);
    }
  }
});

test('an exhausted daily budget introduces only missing groups needed for an unambiguous board', () => {
  const rows = Array.from({ length: 5 }, (_, group) => Array.from({ length: 4 }, (_, variant) =>
    ({ ...item(`reading-${group}-${variant}`, group < 2 ? 10 : 90), reading: `reading-${group}` }))).flat();
  const history = Object.fromEntries(rows.filter(row => ['reading-0', 'reading-1'].includes(row.reading) && !row.id.endsWith('-3'))
    .map(row => [row.id, seen({ firstSeenAt: iso(NOW - 600000), lastSeenAt: iso(NOW - 600000), dueAt: iso(NOW - 1) })]));
  assert.equal(Object.keys(history).length, 6);
  for (const kind of ['balanced', 'explore']) {
    const result = decide(rows, { history, minimumPool: 4, limit: 4, goal: { kind }, getGroupKey: row => row.reading });
    assert.equal(result.items.length, 4);
    assert.equal(new Set(result.items.map(row => row.reading)).size, 4);
    assert.equal(result.trace.constraints.ordinaryIntroductionLimit, 0);
    assert.equal(result.trace.constraints.introductionLimit, 2);
    assert.equal(result.items.filter(row => !history[row.id]).length, 2);
    assert.equal(result.trace.introductions, 2);
    assert.equal(result.trace.draws.filter(draw => draw.fallbackReasons.includes('distinct-group-minimum-overrides-pacing')).length, 2);
  }
});

test('tiny grouped banks cap capacity at distinct readings instead of repeating homophones', () => {
  const rows = [
    { ...item('a-one', 1), reading: 'a' }, { ...item('a-two', 1), reading: 'a' },
    { ...item('b-one', 90), reading: 'b' }, { ...item('b-two', 90), reading: 'b' },
    { ...item('higher', 1, 100, 2), reading: 'c' }
  ];
  const result = decide(rows, { difficulty: 1, minimumPool: 8, limit: 8, getGroupKey: row => row.reading });
  assert.equal(result.items.length, 2);
  assert.deepEqual(new Set(result.items.map(row => row.reading)), new Set(['a', 'b']));
  assert.equal(result.trace.constraints.minimumGroups, 2);
  assert.equal(result.trace.constraints.distinctGroups, 2);
});

test('large easy banks retain one nearest-band challenge opportunity without leaping farther', () => {
  const rows = [...bank(300), item('challenge-a', 70), item('challenge-b', 70), item('too-far', 95)];
  const history = Object.fromEntries(rows.slice(0, 6).map(row => [row.id, seen({ exposures: 30, practiceDays: 8 })]));
  const decision = decide(rows, { history });
  assert.equal(decision.items.filter(row => row.complexity > 10).length, 1);
  assert.ok(decision.items.some(row => row.complexity === 70));
  const challenge = decision.items.find(row => row.complexity === 70);
  history[challenge.id] = { exposures: 1, firstSeenAt: iso(NOW), lastSeenAt: iso(NOW) };
  const later = decide(rows, { history });
  assert.ok(later.items.every(row => history[row.id] || row.complexity === 10));
});

test('unsupported knowledge remains missing; an independent error differs from exposure', () => {
  const rows = bank(3);
  const history = { [rows[0].id]: seen({ successes: 100 }),
    [rows[1].id]: seen({ lastEvidence: 'independent', lastCorrect: false, lastAttemptAt: iso(NOW - DAY) }),
    [rows[2].id]: seen({ lastEvidence: 'assisted', lastCorrect: true, assistedSuccesses: 1, lastAssistedAt: iso(NOW - DAY) }) };
  const decision = decide(rows, { history, identity });
  const [exposure, error, assisted] = decision.trace.candidates;
  assert.equal(exposure.evidenceStatus, 'exposure-only');
  assert.equal(error.evidenceStatus, 'independently-assessed');
  assert.equal(assisted.evidenceStatus, 'supported');
  assert.equal(error.features.error, 1);
  for (const row of [exposure, error, assisted]) {
    assert.equal(row.knowledge.recallProbability, null);
    assert.equal(row.features.weakness, null);
    assert.ok(row.missingFeatures.includes('weakness'));
  }
});

test('supplied probability, explicit item goals and categories contribute independently', () => {
  const rows = [item('a'), { ...item('b'), tags: ['travel'] }];
  const learner = { knowledgeByItem: { a: { recallProbability: .9, responseProbability: .9 }, b: { recallProbability: .2, responseProbability: .7 } } };
  const decision = decide(rows, { learner, goal: { id: 'travel', weights: { a: 1, b: 4 } }, limit: 1 });
  assert.ok(probability(decision, 'b') > probability(decision, 'a'));
  assert.equal(decision.trace.candidates[1].features.weakness, .8);
  assert.equal(decision.trace.candidates[0].features.goal, .25);
  const categories = decide(rows, { goal: { id: 'travel', categories: ['travel'] } });
  assert.equal(categories.trace.candidates[1].features.goal, 1);
  assert.equal(categories.trace.candidates[0].features.goal, 0);
});

test('semantic relationships affect selection without supplying assessment or mastery', () => {
  const rows = bank(2);
  const semantic = { byItem: { 'item-0': { goalSimilarity: -1, recentSimilarity: 1 },
    'item-1': { goalSimilarity: 1, recentSimilarity: -1 } } };
  const decision = decide(rows, { semantic, identity, limit: 1 });
  assert.ok(probability(decision, 'item-1') > probability(decision, 'item-0'));
  assert.equal(decision.trace.candidates[0].features.semanticDiversity, 0);
  assert.equal(decision.trace.candidates[1].features.semanticDiversity, 1);
  assert.ok(decision.trace.candidates.every(row => row.evidenceStatus === 'unassessed' && row.features.weakness === null));
});

test('conditional probabilities include the uniform exploration mixture and sum to one', () => {
  const rows = [item('low', 10, 1), item('high', 10, 100)];
  const decision = decide(rows, { config: { exploration: .2, temperature: .5 }, limit: 1 });
  const scores = decision.trace.candidates.map(row => row.score);
  const expected = .2 / 2 + .8 / (1 + Math.exp((scores[1] - scores[0]) / .5));
  assert.ok(Math.abs(probability(decision, 'low') - expected) < 1e-12);
  assert.ok(Math.abs(decision.trace.draws[0].distribution.reduce((sum, row) => sum + row.probability, 0) - 1) < 1e-12);
  const uniform = decide(rows, { config: { exploration: 1 }, limit: 1 });
  assert.equal(probability(uniform, 'low'), .5);
  assert.equal(probability(uniform, 'high'), .5);
});

test('one RNG draw per emitted item and no discarded choices when limit is one', () => {
  let calls = 0;
  const result = decide(bank(), { random: () => { calls++; return .2; }, limit: 1 });
  assert.equal(calls, 1);
  assert.equal(result.items.length, 1);
  assert.equal(result.trace.draws.length, 1);
});

test('exclusion and recency apply inside the selected category with transparent tiny-pool fallback', () => {
  const rows = bank(3);
  const excluded = decide(rows, { excludeIds: ['item-0'], recentIds: ['item-1'], limit: 1 });
  assert.equal(excluded.items[0].id, 'item-2');
  assert.equal(excluded.trace.draws[0].conditionalProbability, 1);
  assert.ok(excluded.trace.draws[0].fallbackReasons.includes('excluded-items-deferred'));
  const tiny = decide(rows.slice(0, 1), { excludeIds: ['item-0'], recentIds: ['item-0'], limit: 1 });
  assert.equal(tiny.items[0].id, 'item-0');
  assert.equal(tiny.trace.draws[0].conditionalProbability, 1);
  assert.ok(tiny.trace.draws[0].fallbackReasons.includes('excluded-items-required-for-category-playability'));
});

test('overdue rested practice displaces immediate repetition and explanations expose source', () => {
  const rows = [item('recent'), item('due'), item('new')];
  const history = { recent: retained(), due: retained() };
  history.recent.lastSeenAt = iso(NOW);
  const result = decide(rows, { history, limit: 1 });
  assert.equal(result.items[0].id, 'due');
  assert.equal(result.trace.draws[0].category, 'review');
  const missing = decide([{ id: 'cached' }]);
  assert.equal(missing.trace.candidates[0].sources.usefulness, 'neutral-compatibility-default');
  assert.equal(missing.trace.candidates[0].features.semanticGoal, null);
});

test('named goals change transparent heuristic controls without changing hard constraints', () => {
  const baseline = decide(bank());
  const review = decide(bank(), { goal: { id: 'review', kind: 'review' } });
  const reinforce = decide(bank(), { goal: { id: 'reinforce', kind: 'reinforce' } });
  const explore = decide(bank(), { goal: { id: 'explore', kind: 'explore' } });
  assert.ok(review.trace.config.weights.review > baseline.trace.config.weights.review);
  assert.ok(reinforce.trace.config.weights.error > baseline.trace.config.weights.error);
  assert.ok(explore.trace.config.weights.semanticDiversity > baseline.trace.config.weights.semanticDiversity);
  assert.deepEqual(review.trace.constraints, baseline.trace.constraints);
  assert.deepEqual(explore.trace.constraints, baseline.trace.constraints);
});

test('explore changes selection without semantic features while preserving exhausted-budget pacing', () => {
  const rows = bank(30);
  const history = Object.fromEntries(rows.slice(0, 10).map(row => [row.id, seen({ dueAt: iso(NOW - 1) })]));
  const balanced = decide(rows, { history, minimumPool: 1, limit: 1 });
  const explore = decide(rows, { history, minimumPool: 1, limit: 1, goal: { kind: 'explore' } });
  assert.ok(history[balanced.items[0].id], 'balanced opens with due review in this shared phase');
  assert.ok(!history[explore.items[0].id], 'explore opens with an available introduction');
  assert.ok(explore.trace.config.exploration > balanced.trace.config.exploration);
  for (const entry of Object.values(history)) entry.firstSeenAt = iso(NOW);
  const paced = decide(rows, { history, minimumPool: 4, limit: 6, goal: { kind: 'explore' } });
  assert.ok(paced.items.filter(row => !history[row.id]).length <= 1);
  assert.equal(paced.trace.constraints.continuedIntroductions, true);
  assert.equal(paced.trace.pattern.filter(category => category === 'new').length, 1);
});

test('selection is read only and adapter emits exactly its own trace', () => {
  const rows = bank(8), history = { 'item-0': retained() };
  const original = structuredClone({ rows, history });
  const options = { now: NOW, history, random: () => .42 };
  const first = createAdaptiveDecision(rows, options);
  assert.deepEqual(createAdaptiveDecision(rows, options), first);
  let trace, calls = 0;
  const selected = selectAdaptiveItems(rows, { ...options, onDecision: value => { trace = value; calls++; } });
  assert.equal(calls, 1);
  assert.deepEqual(trace, first.trace);
  assert.deepEqual(selected, first.items);
  assert.deepEqual({ rows, history }, original);
});

test('invalid policy controls and supplied feature values fail explicitly', () => {
  assert.throws(() => decide(null), /array/);
  assert.throws(() => decide([{ ...item('invalid'), difficulty: null }]), /difficulty/);
  assert.throws(() => decide(bank(), { getGroupKey: null }), /getGroupKey/);
  assert.throws(() => decide(bank(), { getGroupKey: () => '' }), /getGroupKey/);
  for (const options of [{ difficulty: 0 }, { minimumPool: 0 }, { limit: 0 }, { now: -1 }, { random: () => NaN },
    { config: { temperature: 0 } }, { config: { exploration: 2 } }, { config: { weights: { mastery: 2 } } },
    { learner: { knowledgeByItem: { 'item-0': { recallProbability: 2 } } } },
    { semantic: { byItem: { 'item-0': { recentSimilarity: Infinity } } } }, { goal: { weights: { 'item-0': -1 } } }]) {
    assert.throws(() => decide(bank(), options), TypeError);
  }
});
