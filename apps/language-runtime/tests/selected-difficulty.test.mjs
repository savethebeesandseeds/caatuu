import assert from 'node:assert/strict';
import test from 'node:test';
import { matchesContentDifficulty, selectContentItems as legacy,
  CONTENT_DAY_MS as DAY } from '../static/source/games/content-progression.mjs';
import { createAdaptiveDecision, createSamplingExperiment } from '../static/source/games/adaptive-sampling.mjs';
import { selectContentItems as practice } from '../static/source/games/adaptive-practice.mjs';

const now = Date.UTC(2026, 8, 22, 12);
const iso = time => new Date(time).toISOString();
const policy = { identity: { courseId: 'fixture', gameId: 'fixture-game', bankId: 'recognition' } };
const rows = [1, 2, 3].flatMap(difficulty => Array.from({ length: 4 }, (_, index) => ({
  id: `${difficulty}-${index}`, difficulty, complexity: 10 + index, usefulness: 80
})));
const history = {
  '1-0': { exposures: 200, firstSeenAt: iso(now - 20 * DAY), lastSeenAt: iso(now - DAY),
    dueAt: iso(now - 1), independentDays: 5, spacedSuccesses: 4, intervalMs: 16 * DAY },
  '2-0': { exposures: 1, firstSeenAt: iso(now), lastSeenAt: iso(now), lastCorrect: false },
  '3-0': { exposures: 20, firstSeenAt: iso(now - 20 * DAY), lastSeenAt: iso(now - DAY), practiceDays: 8 }
};
const options = { now, random: () => .4, minimumPool: 4, limit: 4 };
const selectors = {
  legacy,
  adaptive: (items, config) => createAdaptiveDecision(items, config).items,
  'runtime adaptive': (items, config) => practice(items, { ...config, policy }),
  'runtime legacy': (items, config) => practice(items, { ...config, policy: { ...policy, id: 'existing' } })
};

test('difficulty matches exactly and unclassified cached items belong only to level 1', () => {
  for (const difficulty of [1, 2, 3]) {
    assert.deepEqual(rows.filter(row => matchesContentDifficulty(row, difficulty)), rows.filter(row => row.difficulty === difficulty));
    assert.equal(matchesContentDifficulty({ id: 'cached' }, difficulty), difficulty === 1);
  }
  for (const difficulty of [undefined, null, 0, 4, '1', 1.5]) {
    assert.throws(() => matchesContentDifficulty(rows[0], difficulty), /difficulty/);
    if (difficulty !== undefined) assert.throws(() => matchesContentDifficulty({ difficulty }, 1), /difficulty/);
  }
});

for (const [name, select] of Object.entries(selectors)) {
  test(`${name} switches levels immediately with fresh or mixed difficulty history`, () => {
    const before = structuredClone({ rows, history });
    for (const savedHistory of [{}, history]) for (const difficulty of [1, 2, 3, 1, 3, 2]) {
      const config = { ...options, difficulty, history: savedHistory };
      const selectedBand = rows.filter(row => row.difficulty === difficulty);
      const selected = select(rows, config);
      assert.equal(selected.length, 4);
      assert.ok(selected.every(row => row.difficulty === difficulty && rows.includes(row)));
      assert.equal(new Set(selected.map(row => row.id)).size, selected.length);
      assert.deepEqual(selected, select(selectedBand, config), 'other bands never affect frontier or scoring');
    }
    assert.deepEqual({ rows, history }, before, 'changing a badge keeps all saved history');
  });

  test(`${name} has no cross-band empty fallback and retains the omitted level 3 default`, () => {
    const lower = rows.filter(row => row.difficulty === 1);
    assert.deepEqual(select(lower, { ...options, difficulty: 3, history, minimumPool: 8 }), []);
    const selected = select(rows, options);
    assert.ok(selected.length > 0);
    assert.ok(selected.every(row => row.difficulty === 3));
  });
}

test('difficulty is filtered before progression metadata or learner features are scored', () => {
  const invalidOutside = { id: 'outside', difficulty: 1, usefulness: -1, complexity: -1 };
  const bank = [invalidOutside, ...rows.filter(row => row.difficulty === 3)];
  for (const select of Object.values(selectors)) {
    assert.equal(select(bank, { ...options, difficulty: 3 }).length, 4);
  }
});

test('runtime policy callbacks receive the selected band and cannot return another level with a matching ID', () => {
  const lower = { ...rows[0], id: 'shared' };
  const selected = { ...rows.at(-1), id: 'shared' };
  const bank = [lower, selected];
  const config = { ...options, difficulty: 3, policy: { ...policy, select: candidates => {
    assert.deepEqual(candidates, [selected]);
    return { items: [selected], trace: {} };
  } } };
  assert.deepEqual(practice(bank, config), [selected]);
  assert.throws(() => practice(bank, { ...config, policy: { ...policy,
    select: () => ({ items: [lower], trace: {} }) } }), /ineligible/);
});

test('experimental access and sparse fallback never restore a different selected difficulty', () => {
  for (const controls of [{ softFrontier: true }, { crossCategoryRecency: true },
    { frontier: false, introductions: false, slots: false, recency: false }, { outsideExploration: 1 }]) {
    for (const difficulty of [1, 2, 3]) {
      const result = createSamplingExperiment(rows, { ...options, difficulty, history,
        recentIds: rows.map(row => row.id), excludeIds: rows.map(row => row.id) }, controls);
      assert.ok(result.items.length > 0);
      assert.ok(result.items.every(row => row.difficulty === difficulty));
      assert.equal(result.trace.eligibleCount, 4);
    }
    assert.deepEqual(createSamplingExperiment(rows.filter(row => row.difficulty === 1),
      { ...options, difficulty: 3, history }, controls).items, []);
  }
});
