import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { selectContentItems } from '../../../apps/language-runtime/static/source/games/content-progression.mjs';
import { createEnvironment } from './environment.mjs';
import { recordOutcome } from './evidence.mjs';
import { baselinePolicies } from './policies.mjs';
import { seededRandom } from './random.mjs';
import { renderMarkdown } from './report.mjs';
import { eligibleCandidates, runEvaluation, simulateRun, validateInputs } from './runner.mjs';

const fixture = JSON.parse(await readFile(new URL('./fixture.json', import.meta.url), 'utf8'));
const defaults = JSON.parse(await readFile(new URL('./config.json', import.meta.url), 'utf8'));
const DAY = 86400000;
const NOW = Date.parse(defaults.startTime);
const config = { ...defaults, difficulty: 1, interactions: 16, seeds: [17, 29],
  profiles: [fixture.profiles[0].id], goals: [fixture.goals[0].id] };
const profile = fixture.profiles[0];
const goal = fixture.goals[0];
const fixedPolicy = (id, draws = 0) => ({ id, label: id, create: () => ({
  select(input) {
    for (let draw = 0; draw < draws; draw++) input.random();
    return input.candidates[0].id;
  },
}) });
const run = (policy, extra = {}) => simulateRun({ config, fixture, profile, goal, seed: 17, policy, ...extra });
const environment = (extra = {}) => createEnvironment({ fixture, profile, seed: 17,
  now: NOW, transfer: config.transfer, ...extra });

// Software contracts only: no assertion requires a teaching policy to win.
test('identical seeds, inputs and policy reproduce complete trajectories', async () => {
  const policy = baselinePolicies().find(row => row.id === 'uniform');
  const before = structuredClone({ fixture, config });
  assert.deepEqual(await run(policy), await run(policy));
  assert.deepEqual({ fixture, config }, before);
});

test('policy ordering cannot change paired runs or their initial states', async () => {
  const policies = baselinePolicies();
  const forward = await runEvaluation({ config, fixture, policies });
  const reverse = await runEvaluation({ config, fixture, policies: [...policies].reverse() });
  for (const result of forward.runs) {
    const match = reverse.runs.find(row => row.policyId === result.policyId && row.seed === result.seed);
    assert.deepEqual(result, match);
    assert.deepEqual(result.initialKnowledge, forward.runs[0].initialKnowledge);
    assert.deepEqual(result.eligibleIds, forward.runs[0].eligibleIds);
  }
  assert.equal(forward.policies.find(row => row.id === 'production').status, 'pending');
  assert.equal(forward.runs.some(row => row.policyId === 'production'), false);
});

test('extra policy random draws cannot change environment outcomes for fixed actions', async () => {
  const ordinary = await run(fixedPolicy('ordinary'));
  const consumesRandom = await run(fixedPolicy('consumes-random', 97));
  for (const field of ['trace', 'history', 'initialKnowledge', 'finalKnowledge', 'delayedKnowledge', 'metrics']) {
    assert.deepEqual(ordinary[field], consumesRandom[field]);
  }
});

test('every policy sees the full hard-eligible universe, beyond scheduler introductions', async () => {
  const expected = fixture.items.filter(row => row.validTask && row.difficulty === config.difficulty)
    .map(row => row.id);
  const candidates = eligibleCandidates(fixture, config);
  assert.deepEqual(candidates.map(row => row.id), expected);
  assert.ok(candidates.every(row => !Object.hasOwn(row, 'simulation')));
  const shortlist = selectContentItems(candidates, { difficulty: config.difficulty,
    minimumPool: config.minimumPool, history: {}, now: NOW, random: () => 0 });
  assert.ok(shortlist.length < candidates.length, 'fixture exposes policy shortlist vs eligibility');
  const policy = { id: 'inspect-universe', create: () => ({ select(input) {
    assert.deepEqual(input.candidates.map(row => row.id), expected);
    return input.candidates.at(-1).id;
  } }) };
  const result = await run(policy);
  assert.deepEqual(result.eligibleIds, expected);
  assert.ok(result.trace.every(row => row.itemId === expected.at(-1)));
});

test('hard eligibility admits exactly the selected difficulty for every policy', () => {
  for (const difficulty of [1, 2, 3]) {
    const candidates = eligibleCandidates(fixture, { ...config, difficulty });
    assert.deepEqual(candidates.map(item => item.id), fixture.items
      .filter(item => item.validTask && item.difficulty === difficulty).map(item => item.id));
    assert.ok(candidates.length > 0);
    assert.ok(candidates.every(item => !Object.hasOwn(item, 'simulation')));
  }
});

test('out-of-universe selections and invalid policy instances fail explicitly', async () => {
  await assert.rejects(run({ id: 'bad-selection', create: () => ({ select: () => 'not-in-bank' }) }), /ineligible/);
  const ineligible = fixture.items.find(row => !row.validTask);
  await assert.rejects(run({ id: 'invalid-task', create: () => ({ select: () => ineligible.id }) }), /ineligible/);
  await assert.rejects(run({ id: 'bad-factory', create: () => ({}) }), /select/);
});

test('policy snapshots are isolated, recursively frozen and contain current own evidence', async () => {
  let turns = 0;
  const policy = { id: 'inspect-snapshot', create: () => ({ select(input) {
    assert.equal(input.learner.mode, 'perfect-synthetic');
    for (const value of [input, input.identity, input.candidates, input.candidates[0],
      input.learner, input.learner.evidenceByItem, input.learner.knowledgeByItem, input.goal]) {
      assert.ok(Object.isFrozen(value));
    }
    const id = input.candidates[0].id;
    assert.equal(input.learner.evidenceByItem[id]?.exposures ?? 0, turns++);
    assert.throws(() => { input.learner.knowledgeByItem[id].recallProbability = 1; }, TypeError);
    return id;
  } }) };
  const result = await run(policy);
  assert.equal(turns, config.interactions);
  assert.deepEqual(Object.keys(result.history), [result.eligibleIds[0]]);
});

test('a fresh asynchronous policy factory is created for every run', async () => {
  let factories = 0;
  const policy = { id: 'stateful', create: async () => {
    factories++;
    let step = 0;
    return { select: async input => input.candidates[step++ % input.candidates.length].id };
  } };
  const result = await runEvaluation({ config, fixture, policies: [policy] });
  assert.equal(factories, config.seeds.length);
  assert.equal(result.runs.length, config.seeds.length);
  assert.deepEqual(result.runs[0].trace.map(row => row.itemId), result.runs[1].trace.map(row => row.itemId));
});

test('existing baseline exactly delegates selection to selectContentItems', () => {
  const candidates = eligibleCandidates(fixture, config);
  const policy = baselinePolicies().find(row => row.id === 'existing-scheduler').create();
  const history = {};
  for (let step = 0; step < 14; step++) {
    const now = NOW + step * DAY;
    const actual = policy.select({ candidates, learner: { evidenceByItem: history },
      difficulty: config.difficulty, minimumPool: config.minimumPool, now, random: seededRandom(`adapter:${step}`) });
    const expected = selectContentItems(candidates, { history, difficulty: config.difficulty,
      minimumPool: config.minimumPool, now, random: seededRandom(`adapter:${step}`), limit: 1 });
    assert.equal(actual, expected[0].id);
    recordOutcome(history, actual, { evidence: 'independent', correct: true }, now);
  }
});

test('baseline draw boundaries apply uniformly or use authored usefulness weights', () => {
  const candidates = [{ id: 'small', usefulness: 1 }, { id: 'large', usefulness: 99 }];
  const uniform = baselinePolicies().find(row => row.id === 'uniform').create();
  const useful = baselinePolicies().find(row => row.id === 'usefulness').create();
  assert.equal(uniform.select({ candidates, random: () => 0 }), 'small');
  assert.equal(uniform.select({ candidates, random: () => 0.75 }), 'large');
  assert.equal(useful.select({ candidates, random: () => 0 }), 'small');
  assert.equal(useful.select({ candidates, random: () => 0.02 }), 'large');
});

test('exposure, assistance and mistakes do not fabricate independent or spaced evidence', () => {
  const history = {};
  recordOutcome(history, 'item', { evidence: 'exposure', correct: null }, NOW);
  recordOutcome(history, 'item', { evidence: 'assisted', correct: true }, NOW + DAY);
  recordOutcome(history, 'item', { evidence: 'independent', correct: false }, NOW + 2 * DAY);
  assert.equal(history.item.exposures, 3);
  assert.equal(history.item.assistedSuccesses, 1);
  assert.equal(history.item.mistakes, 1);
  for (const field of ['independentSuccesses', 'independentDays', 'spacedSuccesses']) assert.equal(history.item[field], 0);
  assert.deepEqual(Object.keys(history), ['item']);
  assert.throws(() => recordOutcome(history, 'item', { evidence: 'exposure', correct: null }, NOW), /ordered/);
});

test('spaced evidence needs the elapsed interval after the latest encounter, not just a new UTC day', () => {
  const history = {};
  const start = Date.UTC(2026, 0, 5, 23, 59);
  const correct = { evidence: 'independent', correct: true };
  recordOutcome(history, 'item', correct, start);
  recordOutcome(history, 'item', correct, start + 2 * 60000);
  assert.equal(history.item.independentDays, 1);
  assert.equal(history.item.spacedSuccesses, 0);
  recordOutcome(history, 'item', correct, start + 2 * 60000 + DAY);
  assert.equal(history.item.independentDays, 2);
  assert.equal(history.item.spacedSuccesses, 1);
  const rehearsed = {};
  recordOutcome(rehearsed, 'item', correct, start);
  recordOutcome(rehearsed, 'item', { evidence: 'exposure', correct: null }, start + DAY - 60000);
  recordOutcome(rehearsed, 'item', correct, start + DAY);
  assert.equal(rehearsed.item.spacedSuccesses, 0);
  assert.equal(rehearsed.item.intervalMs, DAY);
});

test('forgetting and future probes are deterministic, read only and do not consume training randomness', () => {
  const probed = environment();
  const control = environment();
  const initial = probed.snapshot(NOW);
  const delayed = probed.knowledge(NOW + 7 * DAY);
  for (const [id, state] of Object.entries(initial)) {
    assert.ok(delayed[id].recallProbability <= state.recallProbability);
    assert.ok(delayed[id].recallProbability >= 0);
  }
  probed.snapshot(NOW + 30 * DAY);
  assert.deepEqual(probed.snapshot(NOW), initial);
  assert.deepEqual(probed.interact(fixture.items[0].id, NOW, 0), control.interact(fixture.items[0].id, NOW, 0));
});

test('environment dynamics ignore usefulness, complexity and selected-goal weights', () => {
  const altered = structuredClone(fixture);
  for (const item of altered.items) { item.usefulness = 101 - item.usefulness; item.complexity = 101 - item.complexity; }
  for (const selectedGoal of altered.goals) {
    for (const id of Object.keys(selectedGoal.weights)) selectedGoal.weights[id] = 1;
  }
  const ordinary = environment();
  const edited = environment({ fixture: altered });
  for (let step = 0; step < 20; step++) {
    const id = fixture.items[step % 3].id;
    assert.deepEqual(ordinary.interact(id, NOW + step * DAY, step), edited.interact(id, NOW + step * DAY, step));
  }
});

test('transfer is capped, one hop only, and never creates direct practice or evidence', async () => {
  const shaped = structuredClone(fixture);
  const [source, target, downstream] = shaped.items;
  shaped.transferEdges = [{ from: source.id, to: target.id, weight: 1 },
    { from: target.id, to: downstream.id, weight: 1 }];
  const transfer = { rate: 1, totalCap: 0.04, maxPerStep: 0.01 };
  const learner = environment({ fixture: shaped, transfer });
  const initial = learner.snapshot(NOW);
  for (let step = 0; step < 40; step++) {
    const outcome = learner.interact(source.id, NOW, step);
    assert.ok(outcome.transfer.reduce((sum, row) => sum + row.gain, 0) <= transfer.maxPerStep + 1e-12);
    assert.ok(outcome.transfer.every(row => row.from === source.id && row.to === target.id));
    const snapshot = learner.snapshot(NOW);
    assert.ok(snapshot[target.id].cumulativeTransfer <= transfer.totalCap + 1e-12);
    assert.equal(snapshot[target.id].practices, 0);
    assert.deepEqual(snapshot[downstream.id], initial[downstream.id]);
    assert.ok(Object.values(snapshot).every(row => row.recallProbability >= 0 && row.recallProbability <= 1));
  }
  assert.ok(learner.snapshot(NOW)[target.id].cumulativeTransfer > 0);
  const simulated = await run(fixedPolicy('direct-only'), { fixture: shaped, config: { ...config, transfer } });
  assert.deepEqual(Object.keys(simulated.history), [source.id]);
  assert.equal(simulated.finalState[target.id].practices, 0);
});

test('no-learning trajectories match the no-practice reference despite observed responses', async () => {
  const unchanged = structuredClone(fixture);
  unchanged.profiles[0].learningMultiplier = 0;
  const result = await run(fixedPolicy('no-learning'), { fixture: unchanged, profile: unchanged.profiles[0] });
  assert.ok(result.metrics.learningGain < 0, 'elapsed time still forgets without learning');
  assert.ok(Math.abs(result.metrics.gainOverNoPractice) < 1e-12);
  assert.ok(Math.abs(result.metrics.retainedGainOverNoPractice) < 1e-12);
  assert.ok(result.trace.every(row => row.outcome.directGain === 0));
});

test('invalid configurations fail before simulation and environment enforces ordered actions', () => {
  for (const changed of [{ seeds: [17, 17] }, { interactions: 0 }, { difficulty: 4 },
    { goals: ['unknown'] }, { stepMinutes: 1440 }]) {
    assert.throws(() => validateInputs({ ...config, ...changed }, fixture), TypeError);
  }
  const learner = environment();
  learner.interact(fixture.items[0].id, NOW, 0);
  assert.throws(() => learner.interact(fixture.items[0].id, NOW, 0), /step/);
  assert.throws(() => learner.interact(fixture.items[0].id, NOW - 1, 1), /time/);
  assert.throws(() => learner.interact('unknown', NOW, 1), /Unknown/);
});

test('sparse goal weights safely handle item IDs that name object prototype properties', async () => {
  const unusual = structuredClone(fixture);
  unusual.items = ['constructor', '__proto__', 'weighted'].map((id, index) => ({ ...unusual.items[index], id }));
  unusual.transferEdges = [];
  unusual.goals = [{ id: 'sparse', weights: { weighted: 1 } }];
  const result = await run(fixedPolicy('special-ids'), { fixture: unusual,
    goal: unusual.goals[0], config: { ...config, goals: ['sparse'] } });
  assert.equal(result.metrics.initialGoalRecall, result.initialKnowledge.weighted.recallProbability);
  assert.equal(result.metrics.immediateGoalRecall, result.finalKnowledge.weighted.recallProbability);
  assert.equal(result.metrics.weakAreaAttention, 0);
  assert.ok(Object.values(result.metrics).every(value => value === null || Number.isFinite(value)));
  assert.ok(Object.hasOwn(result.history, 'constructor'));
  const history = {};
  recordOutcome(history, '__proto__', { evidence: 'exposure', correct: null }, NOW);
  assert.equal(history.__proto__.exposures, 1);
  assert.equal(Object.getPrototypeOf(history), Object.prototype);
});

test('reproducible run timestamps require an explicit timezone', () => {
  for (const startTime of ['2026-01-05', '2026-01-05T09:00:00']) {
    assert.throws(() => validateInputs({ ...config, startTime }, fixture), /timing/);
  }
  assert.doesNotThrow(() => validateInputs({ ...config, startTime: '2026-01-05T10:00:00+01:00' }, fixture));
});

test('reports retain pending production status and serialize simulator assumptions and variation', async () => {
  const result = await runEvaluation({ config: { ...config, interactions: 2 }, fixture });
  const persisted = JSON.parse(JSON.stringify(result));
  assert.equal(persisted.simulator.assistanceRescueProbability, 0.6);
  assert.ok(persisted.simulator.modalityLearning.exposure > 0);
  assert.ok(persisted.summary.some(row => row.profileId === profile.id && row.metrics.delayedRetention.n === config.seeds.length));
  assert.ok(persisted.pairedDifferences.some(row => row.policyId === 'existing-scheduler'));
  assert.match(renderMarkdown(persisted), /New production policy \| pending/);
  assert.match(renderMarkdown(persisted), /not demonstrated human learning gains/);
});
