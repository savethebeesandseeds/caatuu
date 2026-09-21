import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdaptiveDecision, createSamplingExperiment } from '../static/source/games/adaptive-sampling.mjs';
import { CONTENT_DAY_MS as DAY } from '../static/source/games/content-progression.mjs';

const now = Date.parse('2026-09-21T12:00:00Z');
const iso = time => new Date(time).toISOString();
const item = (id, complexity = 10, difficulty = 1, group = id) => ({ id, complexity, difficulty, usefulness: 60, group });
const seen = (extra = {}) => ({ exposures: 5, firstSeenAt: iso(now - DAY), lastSeenAt: iso(now - DAY),
  dueAt: iso(now - 1), ...extra });
const options = { now, difficulty: 1, minimumPool: 1, limit: 1, random: () => .4 };
const experiment = (rows, control, overrides = {}) => createSamplingExperiment(rows, { ...options, ...overrides }, control);
const support = result => result.trace.draws[0].distribution.map(row => row.id);

test('new experimental controls are boolean and cannot leak through production options', () => {
  const rows = [item('low', 1), item('far', 90), item('higher', 1, 2)];
  const baseline = createAdaptiveDecision(rows, options);
  for (const control of ['softFrontier', 'crossCategoryRecency']) {
    assert.throws(() => experiment(rows, { [control]: 1 }), /boolean/);
    const ignored = createAdaptiveDecision(rows, { ...options, [control]: true,
      controls: { [control]: true }, config: { [control]: true } });
    assert.deepEqual(ignored, baseline);
    const disabled = experiment(rows, { [control]: false });
    assert.deepEqual(disabled.items, baseline.items);
    assert.deepEqual(disabled.trace.candidates, baseline.trace.candidates);
    assert.deepEqual(disabled.trace.draws[0].distribution, baseline.trace.draws[0].distribution);
  }
  assert.ok(baseline.trace.candidates.every(row => !Object.hasOwn(row, 'softFrontierPenalty')));
});

test('soft frontier admits distant unseen candidates and subtracts its fixed unseen-only penalty', () => {
  const rows = [item('low', 1), item('far', 80), item('known', 90), item('higher', 1, 2)];
  const history = { known: seen({ lastSeenAt: iso(now - 1), dueAt: iso(now + DAY) }) };
  const ordinary = experiment(rows, {}, { history });
  const noFrontier = experiment(rows, { frontier: false }, { history });
  const soft = experiment(rows, { softFrontier: true }, { history });
  assert.equal(soft.trace.constraints.frontier, 19);
  assert.deepEqual(support(ordinary), ['low']);
  assert.deepEqual(support(soft), ['low', 'far']);
  const candidates = Object.fromEntries(soft.trace.candidates.map(row => [row.id, row]));
  assert.equal(candidates.low.softFrontierPenalty, 0);
  assert.equal(candidates.far.softFrontierPenalty, 1.22);
  assert.equal(candidates.known.softFrontierPenalty, 0, 'seen items are not penalized even above frontier');
  assert.equal(candidates.higher, undefined, 'the badge remains a hard limit');
  for (const candidate of soft.trace.candidates) {
    const withoutPenalty = noFrontier.trace.candidates.find(row => row.id === candidate.id);
    assert.deepEqual(candidate.features, withoutPenalty.features);
    assert.deepEqual(candidate.contributions, withoutPenalty.contributions);
    assert.equal(candidate.scoreBeforePenalty, withoutPenalty.score);
    assert.equal(candidate.score, withoutPenalty.score - candidate.softFrontierPenalty);
  }
  assert.ok(soft.trace.draws[0].distribution.every(row => row.probability > 0));
});

test('soft frontier does not restore the nearest-band reservation or one-challenge cap', () => {
  const rows = [item('low', 1), item('far-a', 70), item('far-b', 80)];
  const result = experiment(rows, { softFrontier: true }, { limit: 3, random: () => .999 });
  assert.deepEqual(result.items.map(row => row.id), ['far-b', 'far-a', 'low']);
  assert.equal(result.trace.constraints.nextChallengeBand, null);
  assert.equal(result.trace.introductions, 3);
  assert.ok(result.trace.draws.every(draw => !draw.fallbackReasons.includes('nearest-challenge-band-reserved')));
  assert.ok(result.trace.draws.every(draw => draw.access.restrictions
    .filter(rule => ['frontier', 'one-frontier-challenge-per-board'].includes(rule.name))
    .every(rule => rule.excludedIds.length === 0)));
});

test('soft frontier and recency experiments preserve continuation introduction limits', () => {
  const old = Array.from({ length: 6 }, (_, index) => item(`old-${index}`));
  const rows = [...old, item('new-a', 70), item('new-b', 80), item('new-c', 90)];
  const history = Object.fromEntries(old.map(row => [row.id, seen({ exposures: 1,
    firstSeenAt: iso(now - 1000), lastSeenAt: iso(now - 1000), dueAt: iso(now + DAY) })]));
  for (const controls of [{ softFrontier: true }, { crossCategoryRecency: true },
    { softFrontier: true, crossCategoryRecency: true }]) {
    const result = experiment(rows, controls, { history, limit: 6, recentIds: old.map(row => row.id) });
    assert.equal(result.trace.constraints.continuedIntroductions, true);
    assert.equal(result.trace.constraints.introductionLimit, 1);
    assert.ok(result.trace.introductions <= 1);
    assert.ok(result.items.filter(row => !history[row.id]).length <= 1);
  }
});

test('cross-category recency can prefer a permitted new item over a recent or excluded review', () => {
  const rows = [item('review'), item('new')];
  const history = { review: seen() };
  for (const lists of [{ recentIds: ['review'] }, { excludeIds: ['review'] }]) {
    const ordinary = experiment(rows, {}, { history, ...lists });
    const crossed = experiment(rows, { crossCategoryRecency: true }, { history, ...lists });
    assert.deepEqual(ordinary.items.map(row => row.id), ['review']);
    assert.deepEqual(crossed.items.map(row => row.id), ['new']);
    assert.equal(crossed.trace.draws[0].requestedCategory, 'review');
    assert.equal(crossed.trace.draws[0].category, 'new');
    assert.ok(crossed.trace.draws[0].fallbackReasons.includes('cross-category-recency-alternative'));
    assert.deepEqual(crossed.trace.draws[0].access.stages
      .find(stage => stage.name === 'cross-category-recency').remainingIds, ['new']);
    assert.ok(crossed.trace.draws[0].access.restrictions.find(rule => rule.name === 'slot-allocation').restoredIds.includes('new'));
  }
});

test('cross-category alternatives must clear both recent and exclusion lists', () => {
  const rows = [item('review-excluded'), item('review-recent'), item('practice')];
  const history = {
    'review-excluded': seen(), 'review-recent': seen(),
    practice: seen({ lastSeenAt: iso(now - 1), dueAt: iso(now + DAY) })
  };
  const result = experiment(rows, { crossCategoryRecency: true }, { history,
    recentIds: ['review-recent'], excludeIds: ['review-excluded'] });
  assert.deepEqual(result.items.map(row => row.id), ['practice']);
  assert.equal(result.trace.draws[0].category, 'practice');
});

test('cross-category recency leaves a category with a fresh candidate unchanged', () => {
  const rows = [item('review-recent'), item('review-fresh'), item('new')];
  const overrides = { history: { 'review-recent': seen(), 'review-fresh': seen() }, recentIds: ['review-recent'] };
  const result = experiment(rows, { crossCategoryRecency: true }, overrides);
  const original = experiment(rows, {}, overrides);
  assert.deepEqual(result.items, original.items);
  assert.deepEqual(support(result), ['review-fresh']);
  assert.equal(result.trace.draws[0].category, 'review');
  assert.ok(!result.trace.draws[0].fallbackReasons.includes('cross-category-recency-alternative'));
});

test('cross-category recency alone never admits an unseen item outside the frontier', () => {
  const result = experiment([item('review'), item('far', 80), item('higher', 1, 2)],
    { crossCategoryRecency: true }, { history: { review: seen() }, recentIds: ['review'] });
  assert.deepEqual(support(result), ['review']);
  assert.ok(result.trace.draws[0].access.restrictions.find(rule => rule.name === 'frontier').excludedIds.includes('far'));
  assert.ok(result.trace.draws[0].fallbackReasons.includes('cross-category-recency-exhausted'));
});

test('cross-category recency retains explicit repeat fallback in sparse and paced banks', () => {
  const single = experiment([item('only')], { crossCategoryRecency: true },
    { history: { only: seen() }, recentIds: ['only'], excludeIds: ['only'] });
  assert.deepEqual(single.items.map(row => row.id), ['only']);
  assert.ok(single.trace.draws[0].fallbackReasons.includes('cross-category-recency-exhausted'));
  assert.ok(single.trace.draws[0].fallbackReasons.includes('recent-items-required-for-playability'));
  assert.ok(single.trace.draws[0].fallbackReasons.includes('excluded-items-required-for-category-playability'));

  const history = { review: seen({ firstSeenAt: iso(now - 600000), lastSeenAt: iso(now - 600000) }) };
  for (let index = 0; index < 5; index++) history[`elsewhere-${index}`] = seen({ firstSeenAt: iso(now - 600000) });
  const paced = experiment([item('review'), item('new')], { crossCategoryRecency: true },
    { history, recentIds: ['review'] });
  assert.equal(paced.trace.constraints.continuedIntroductions, true);
  assert.deepEqual(paced.items.map(row => row.id), ['review'], 'a review slot cannot bypass continuation pacing');
  assert.ok(paced.trace.draws[0].fallbackReasons.includes('cross-category-recency-exhausted'));
});

test('each experiment preserves badge ceilings and distinct answer groups across a board', () => {
  const rows = [item('a'), item('a-alternate', 90, 1, 'a'), item('b', 80), item('c', 70), item('higher', 1, 2)];
  for (const controls of [{ softFrontier: true }, { crossCategoryRecency: true },
    { softFrontier: true, crossCategoryRecency: true }]) {
    const result = experiment(rows, controls, { minimumPool: 3, limit: 3,
      getGroupKey: row => row.group, recentIds: ['a', 'b', 'c'], random: () => .999 });
    assert.equal(result.items.length, 3);
    assert.equal(new Set(result.items.map(row => row.group)).size, 3);
    assert.ok(result.items.every(row => row.difficulty === 1 && rows.includes(row)));
    const used = new Set();
    for (const draw of result.trace.draws) {
      assert.ok(draw.distribution.every(entry => !used.has(rows.find(row => row.id === entry.id).group)));
      assert.ok(Math.abs(draw.distribution.reduce((sum, entry) => sum + entry.probability, 0) - 1) < 1e-12);
      used.add(draw.chosenGroupKey);
    }
  }
});
