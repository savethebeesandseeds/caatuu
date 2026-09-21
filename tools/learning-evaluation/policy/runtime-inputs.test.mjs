import assert from 'node:assert/strict';
import test from 'node:test';
import { recentPracticeIds } from '../../../apps/language-runtime/static/source/games/recent-practice.mjs';
import { selectContentItems } from '../../../apps/language-runtime/static/source/games/adaptive-practice.mjs';
import { createAdaptiveDecision } from '../../../apps/language-runtime/static/source/games/adaptive-sampling.mjs';
import { createPolicy, createExperimentPolicy, policyMetadata } from '../production-policy.mjs';
import { renderMarkdown } from './report.mjs';

const now = Date.UTC(2026, 0, 6, 12);
const iso = ageMinutes => new Date(now - ageMinutes * 60000).toISOString();
const candidates = Array.from({ length: 8 }, (_, index) => ({
  id: `item-${index}`, difficulty: 1, usefulness: 70, complexity: 10,
  englishAuditText: `Example ${index}`
}));
const history = Object.fromEntries(candidates.slice(0, 5).map((item, index) => [item.id, {
  exposures: 1, firstSeenAt: iso(1440), lastSeenAt: iso(20 - index), dueAt: iso(10 - index)
}]));

test('recent identity input matches gameplay ordering and retains only four distinct history identities', () => {
  assert.deepEqual(recentPracticeIds(history), ['item-4', 'item-3', 'item-2', 'item-1']);
  assert.deepEqual(recentPracticeIds({}), []);
  const tied = { ignored: {}, a: { lastSeenAt: iso(1) }, b: { lastSeenAt: iso(1) },
    c: { lastSeenAt: iso(2) }, missing: null, d: { lastSeenAt: iso(3) }, e: { lastSeenAt: iso(4) } };
  assert.deepEqual(recentPracticeIds(tied), ['a', 'b', 'c', 'd']);
});

test('both evaluator bridges match runtime recent filtering and scores for the same observed history', () => {
  for (const courseId of ['cz', 'zh', 'es', 'es-en', 'nb']) for (const draw of [0, .31, .99]) {
    const identity = { courseId, gameId: 'fixture', bankId: 'recognition' };
    const learner = { mode: 'observable-real', evidenceByItem: history };
    const goal = { id: 'balanced', kind: 'balanced' };
    const input = { identity, candidates, learner, goal, now, difficulty: 1, minimumPool: 1, random: () => draw };
    let runtimeTrace;
    const selected = selectContentItems(candidates, { history, now, difficulty: 1, minimumPool: 1, limit: 1,
      random: () => draw, policy: { identity, learner, goal, semanticsEnabled: false,
        onDecision: value => { runtimeTrace = value; } } });
    assert.equal(selected[0].id, 'item-0', 'runtime defers the four recent IDs when an older due item exists');
    for (const bridge of [createPolicy(), createExperimentPolicy({ id: 'current', controls: {} }).create()]) {
      assert.equal(bridge.select(input), selected[0].id);
      const trace = bridge.lastDecision();
      assert.deepEqual(trace.evaluatorInputs.recentIds, ['item-4', 'item-3', 'item-2', 'item-1']);
      assert.deepEqual(trace.candidates, runtimeTrace.candidates);
      assert.deepEqual(trace.draws[0].distribution, runtimeTrace.draws[0].distribution);
      assert.ok(trace.candidates.every(row => row.knowledge.recallProbability === null));
      assert.ok(trace.candidates.every(row => row.features.semanticGoal === null));
    }
    const omitted = createAdaptiveDecision(candidates, { ...input, history, limit: 1 });
    assert.ok(omitted.trace.draws[0].distribution.length > runtimeTrace.draws[0].distribution.length,
      'regression would catch the previous omitted recent-list input');
  }
});

test('production bridge declares the shared input helper for provenance hashing', () => {
  assert.ok(policyMetadata.sourceFiles.includes('apps/language-runtime/static/source/games/recent-practice.mjs'));
});

test('ordinary evaluation reports identify actual state input mode', () => {
  const report = stateMode => renderMarkdown({ configuration: { stateMode, seeds: [1], profiles: ['fixture'],
    goals: ['fixture'], interactions: 1, interactionsPerDay: 1, stepMinutes: 2,
    startTime: new Date(now).toISOString(), difficulty: 1, minimumPool: 1, delayDays: 7,
    suitableRecallRange: [.35, .85], weakRecallCutoff: .6, recentWindow: 5 },
    scope: 'fixture', policies: [], runs: [], summary: [], pairedDifferences: [] });
  assert.match(report('observable-real'), /State input: observable-real/);
  assert.doesNotMatch(report('observable-real'), /State input: perfect synthetic/);
  assert.match(report('perfect'), /State input: perfect synthetic/);
});
