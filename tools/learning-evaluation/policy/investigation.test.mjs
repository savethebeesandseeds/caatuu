import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createEnvironment } from './environment.mjs';
import { baselinePolicies } from './policies.mjs';
import { simulateRun, validateInputs } from './runner.mjs';
import { pairedStudyComparisons, validateStudy, freezeStudy, applyFreeze, renderStudyMarkdown } from './study.mjs';
import { createExperimentPolicy } from '../production-policy.mjs';
import { evidenceDiagnostics } from './diagnostics.mjs';

const read = async name => JSON.parse(await readFile(new URL(name, import.meta.url), 'utf8'));
const fixture = await read('./fixture.json'), base = await read('./config.json');
const screen = await read('./studies/screen.json'), heldout = await read('./studies/heldout-plan.json');
const runtimeScreen = await read('./studies/runtime-aligned-screen.json');
const runtimeHeldout = await read('./studies/runtime-aligned-heldout-plan.json');
const start = Date.parse(base.startTime), DAY = 86400000;
const options = { fixture, profile: fixture.profiles[0], goal: fixture.goals[0], seed: 17 };
const fixed = { id: 'inspect', create: () => ({ select: input => input.candidates[0].id }) };

function assertHistoricalRun(actual, expected, path = '$') {
  assert.equal(typeof actual, typeof expected, `${path}: value type changed`);
  if (typeof expected === 'number') {
    assert.ok(Number.isFinite(actual) && Number.isFinite(expected), `${path}: non-finite number`);
    if (Number.isInteger(expected) || Number.isInteger(actual)) {
      assert.equal(actual, expected, `${path}: integer value changed`);
    } else {
      // V8 versions can round exponentiation differently. Keep the historical
      // reference intact and permit only tightly bounded floating-point noise.
      const tolerance = 1e-12 * Math.max(1, Math.abs(expected));
      assert.ok(Math.abs(actual - expected) <= tolerance,
        `${path}: ${actual} differs from historical ${expected} by more than ${tolerance}`);
    }
  } else if (expected !== null && typeof expected === 'object') {
    assert.ok(actual !== null, `${path}: object became null`);
    assert.equal(Array.isArray(actual), Array.isArray(expected), `${path}: container type changed`);
    assert.deepEqual(Object.keys(actual), Object.keys(expected), `${path}: keys or array length changed`);
    for (const key of Object.keys(expected)) assertHistoricalRun(actual[key], expected[key], `${path}.${key}`);
  } else assert.equal(actual, expected, `${path}: value changed`);
}

test('the original uniform trajectory preserves its historical reference across runtimes', async () => {
  // Extracted without rerunning from investigation-baseline/results.json:
  // uniform / novice / daily-life / seed 17, Node v22.23.2, recorded Git HEAD
  // 685a109ca9d98c9ed959c8def02f8dbcb1a3c756. Preserve the original hash;
  // this is an implementation fixture, never a pedagogical score threshold.
  const historical = await read('./fixtures/original-uniform-run.json');
  assert.equal(createHash('sha256').update(JSON.stringify(historical)).digest('hex'),
    'caee88334324032a505722c58cd7d7077fdba9ab654242ae960a0d79e3e5789e');
  const result = await simulateRun({ ...options, config: base, policy: baselinePolicies()[0] });
  assertHistoricalRun(result, historical);
});

test('historical comparison tolerates numeric rounding without accepting changed trajectories', () => {
  const historical = { id: 'item', step: 1, correct: false, recall: 0.25, trace: [0.4] };
  assertHistoricalRun({ ...historical, recall: historical.recall + Number.EPSILON }, historical);
  for (const changed of [
    { ...historical, id: 'other' }, { ...historical, step: 2 },
    { ...historical, step: 1 + Number.EPSILON }, { ...historical, correct: true },
    { ...historical, recall: 0.25000001 }, { ...historical, recall: NaN },
    { ...historical, recall: '0.25' }, { ...historical, extra: null },
    { ...historical, trace: [] }, { ...historical, trace: { 0: 0.4 } }
  ]) assert.throws(() => assertHistoricalRun(changed, historical), assert.AssertionError);
});

test('observable input hides simulator truth and invokes the actual reducer and adapter', async () => {
  let seen = 0;
  const banned = new Set(['simulation', 'knowledgeByItem', 'learningRate', 'halfLifeDays', 'retrieved', 'guessProbability', 'transferEdges', 'afterRecallProbability', 'responseProbability']);
  function inspect(value) {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      assert.ok(!banned.has(key), `Hidden field ${key} leaked to policy`);
      if (['recallProbability', 'knowledgeProbability', 'independentAccuracy'].includes(key)) assert.equal(child, null);
      inspect(child);
    }
  }
  const policy = { id: 'observable-input', create: () => ({ select(input) {
    inspect(input);
    assert.equal(input.learner.mode, 'observable-real');
    const id = input.candidates[0].id, state = input.learner.itemStatesById[id];
    assert.equal(state.identity.courseId, fixture.identity.courseId);
    assert.equal(state.activity.exposures, seen++);
    assert.ok(Object.isFrozen(input.learner.itemStatesById));
    return id;
  } }) };
  const result = await simulateRun({ ...options, policy, config: { ...base, interactions: 16, stateMode: 'observable-real', diagnostics: true } });
  assert.equal(seen, 16);
  assert.equal(result.stateProvenance.recordedEvents, 16);
  assert.match(result.stateProvenance.reducer, /learning-profile\.js#recordExposure$/);
  assert.match(result.stateProvenance.adapter, /learner-state\.mjs#learnerBankState$/);
  assert.equal(result.stateProvenance.saveStatus.status, 'saved');
  assert.equal(result.history[result.eligibleIds[0]].exposures, 16);
});

test('real observable exposures remain unassessed instead of becoming knowledge', async () => {
  const shaped = structuredClone(fixture), profile = { ...shaped.profiles[0], exposureProbability: 1, assistanceProbability: 0 };
  shaped.profiles[0] = profile;
  const result = await simulateRun({ ...options, fixture: shaped, profile, policy: fixed,
    config: { ...base, interactions: 8, stateMode: 'observable-real', diagnostics: true } });
  const record = result.history[result.eligibleIds[0]];
  assert.equal(record.exposures, 8); assert.equal(record.independentSuccesses, 0);
  assert.equal(result.metrics.independentAssessmentCoverage, 0);
  assert.equal(result.metrics.exposureShare, 1);
  assert.equal(result.metrics.assessedItemsPerInteraction, 0);
});

test('explicit fixed model preserves original outcomes and probes exactly', () => {
  const args = { fixture, profile: fixture.profiles[0], seed: 17, now: start, transfer: base.transfer };
  const implicit = createEnvironment(args), explicit = createEnvironment({ ...args, model: 'fixed' });
  for (let step = 0; step < 24; step++) {
    const id = fixture.items[step % 4].id, at = start + step * DAY;
    assert.deepEqual(implicit.interact(id, at, step), explicit.interact(id, at, step));
    assert.deepEqual(implicit.snapshot(at + DAY), explicit.snapshot(at + DAY));
  }
});

test('spacing stability is explicit, bounded and requires genuine independent spaced retrieval', () => {
  const shaped = structuredClone(fixture);
  shaped.items[0].simulation = { initialRecall: 1, learningRate: 0, halfLifeDays: 1000, guessProbability: 0 };
  const profile = { ...shaped.profiles[0], initialRecallOffset: 0, exposureProbability: 0, assistanceProbability: 0, slipProbability: 0, forgettingMultiplier: 1 };
  const create = (model, selectedProfile = profile) => createEnvironment({ fixture: shaped, profile: selectedProfile, seed: 17, now: start, model });
  const learner = create('spacing'), original = create('fixed'), id = shaped.items[0].id;
  for (const environment of [learner, original]) environment.interact(id, start, 0);
  const tooSoon = learner.interact(id, start + .25 * DAY, 1);
  assert.equal(tooSoon.stability.qualifies, false);
  const spaced = learner.interact(id, start + 2 * DAY, 2);
  assert.equal(spaced.retrieved, true); assert.equal(spaced.stability.qualifies, true);
  assert.ok(spaced.stability.afterHalfLifeDays > spaced.stability.beforeHalfLifeDays);
  assert.ok(spaced.stability.afterHalfLifeDays <= 4000);
  assert.equal(original.snapshot(start + 2 * DAY)[id].halfLifeDays, 1000);
  const exposure = create('spacing', { ...profile, exposureProbability: 1 });
  exposure.interact(id, start, 0);
  assert.equal(exposure.interact(id, start + 2 * DAY, 1).stability.qualifies, false);
  shaped.items[0].simulation.initialRecall = 0; shaped.items[0].simulation.guessProbability = 1;
  const guessing = create('spacing'); guessing.interact(id, start, 0);
  const lucky = guessing.interact(id, start + 2 * DAY, 1);
  assert.equal(lucky.correct, true); assert.equal(lucky.guessed, true); assert.equal(lucky.stability.qualifies, false);
});

test('low-benefit hypothesis cannot silently retain transfer or fixed-model gain', () => {
  const args = { fixture, profile: fixture.profiles[0], seed: 17, now: start, transfer: base.transfer };
  const lower = createEnvironment({ ...args, model: 'low-benefit' }), original = createEnvironment(args);
  const id = fixture.items[0].id;
  const before = original.interact(id, start, 0), after = lower.interact(id, start, 0);
  assert.equal(after.directGain, before.directGain * .2);
  assert.deepEqual(after.transfer, []);
  assert.equal(lower.snapshot(start)[id].halfLifeDays, original.snapshot(start)[id].halfLifeDays);
});

test('paired summaries count seed units rather than treating profile/goal replicates as independent', () => {
  const runs = [];
  for (const seed of [11, 23]) for (const profileId of ['p1', 'p2']) for (const goalId of ['g1', 'g2']) {
    for (const policyId of ['adaptive-paced', 'uniform-hard']) runs.push({ scenarioId: 's', seed, profileId, goalId, policyId,
      metrics: { delayedRetention: policyId === 'uniform-hard' ? 1 : seed === 11 ? .8 : .6, delayedGoalRecall: .5 } });
  }
  const result = pairedStudyComparisons(runs).find(row => row.policyId === 'uniform-hard');
  assert.equal(result.pairedCells, 8); assert.equal(result.independentSeedUnits, 2);
  assert.equal(result.metrics.delayedRetention.n, 2);
  assert.ok(Math.abs(result.metrics.delayedRetention.mean - .3) < 1e-12);
  assert.ok(result.strata.every(row => row.metrics.delayedRetention.n === 2));
});

test('access partitions and feature availability use explicit denominators in both state modes', async () => {
  for (const stateMode of ['perfect', 'observable-real']) {
    const result = await simulateRun({ ...options, policy: createExperimentPolicy({ id: 'adaptive-paced', controls: {} }),
      config: { ...base, interactions: 5, stateMode, diagnostics: true } });
    const diagnostics = result.diagnostics;
    assert.equal(diagnostics.measuredAccessTurns, 5);
    assert.equal(diagnostics.hardEligibleNeverAdmittedIds.length + diagnostics.admittedNeverSelectedIds.length
      + new Set(result.trace.map(row => row.itemId)).size, result.eligibleIds.length);
    assert.equal(result.metrics.recallFeatureAvailability, stateMode === 'perfect' ? 1 : 0);
    assert.equal(Object.values(diagnostics.actionMix).reduce((a, b) => a + b, 0), 5);
    assert.ok(diagnostics.perItem.every(row => row.admittedSlots >= row.selected));
    assert.ok(result.trace.every(row => row.decision.access.availableIds.includes(row.itemId)));
  }
  assert.equal(evidenceDiagnostics({ exposure: { exposures: 1, dueAt: null } }, start).dueItems, 0);
});

test('study freeze validates controls, held-out seeds, metrics and unchanged source hashes', () => {
  validateStudy(screen); validateStudy(heldout, { allowUnfrozen: true });
  assert.throws(() => validateStudy({ ...screen, primaryMetrics: ['noveltyCoverage'] }), /Primary/);
  assert.throws(() => validateStudy({ ...screen, variants: [{ id: 'bad', controls: { outsideExploration: 2 } }] }), /control/);
  assert.throws(() => validateStudy({ ...screen, variants: [{ id: 'bad', controls: { frontierBridge: true } }] }), /control/);
  assert.throws(() => validateInputs({ ...base, stateMode: 'guessed' }, fixture), /stateMode/);
  assert.throws(() => validateInputs({ ...base, simulatorModel: 'miracle' }, fixture), /simulatorModel/);
  const provenance = { sourceSha256: { 'source.mjs': 'frozen' } };
  const freeze = freezeStudy({ proposedPlan: heldout, screen: { configuration: screen, provenance },
    selectedIds: ['adaptive-paced', 'uniform-hard'], provenance, createdAt: '2026-09-20T00:00:00Z' });
  assert.equal(applyFreeze(heldout, freeze, provenance).variants.length, 2);
  assert.throws(() => applyFreeze(heldout, freeze, { sourceSha256: { 'source.mjs': 'changed' } }), /changed/);
  assert.throws(() => freezeStudy({ proposedPlan: { ...heldout, seeds: [17] }, screen: { configuration: screen, provenance },
    selectedIds: ['adaptive-paced', 'uniform-hard'], provenance }), /overlap/);
});

test('runtime-aligned plans predeclare all five isolated variants and complete observable cells', () => {
  const variants = [
    { id: 'adaptive-paced', controls: {} },
    { id: 'uniform-hard', controls: { uniformScores: true, frontier: false, introductions: false, slots: false, recency: false } },
    { id: 'outside-exploration-.05', controls: { outsideExploration: .05 } },
    { id: 'soft-frontier', controls: { softFrontier: true } },
    { id: 'cross-category-recency', controls: { crossCategoryRecency: true } }
  ];
  const previousSeeds = new Set([...base.seeds, ...screen.seeds, ...heldout.seeds]);
  for (const plan of [runtimeScreen, runtimeHeldout]) {
    validateStudy(plan);
    assert.deepEqual(plan.variants, variants);
    assert.equal(plan.cells, undefined, 'use every default profile/goal cell');
    assert.ok(plan.seeds.every(seed => !previousSeeds.has(seed)));
    assert.ok(plan.scenarios.every(row => row.stateMode === 'observable-real'));
    assert.match(plan.notes, /already been studied/);
    assert.match(plan.notes, /not (?:fresh content|content)/);
  }
  assert.equal(runtimeScreen.fixture, 'original');
  assert.equal(runtimeHeldout.fixture, 'heldout');
  assert.deepEqual(runtimeScreen.seeds, [503, 607]);
  assert.deepEqual(runtimeHeldout.seeds, [709, 811, 907]);
  assert.deepEqual(runtimeScreen.scenarios, [{ id: 'short-fixed-observable', interactions: 120, stateMode: 'observable-real', simulatorModel: 'fixed' }]);
  assert.deepEqual(runtimeHeldout.scenarios.map(({ id, interactions, simulatorModel }) => [id, interactions, simulatorModel]), [
    ['short-fixed-observable', 120, 'fixed'], ['long-fixed-observable', 432, 'fixed'],
    ['long-spacing-observable', 432, 'spacing'], ['long-low-benefit-observable', 432, 'low-benefit']
  ]);
  const runCount = plan => base.profiles.length * base.goals.length * plan.variants.length * plan.seeds.length * plan.scenarios.length;
  assert.equal(runCount(runtimeScreen), 60);
  assert.equal(runCount(runtimeHeldout), 360);
  assert.deepEqual([base.interactionsPerDay, base.stepMinutes, base.delayDays], [12, 2, 7]);
});

test('new experimental controls require booleans and a freeze accepts at most five distinct policies', () => {
  for (const key of ['softFrontier', 'crossCategoryRecency']) {
    for (const value of [true, false]) validateStudy({ ...runtimeScreen, variants: [{ id: key, controls: { [key]: value } }] });
    for (const value of [1, 'true', null]) assert.throws(() => validateStudy({
      ...runtimeScreen, variants: [{ id: key, controls: { [key]: value } }]
    }), /control/);
  }
  const provenance = { sourceSha256: { 'apps/language-runtime/static/source/games/recent-practice.mjs': 'frozen' } };
  const selectedIds = runtimeScreen.variants.map(row => row.id);
  const freeze = freezeStudy({ proposedPlan: runtimeHeldout, screen: { configuration: runtimeScreen, provenance },
    selectedIds, provenance, createdAt: '2026-09-21T00:00:00Z' });
  assert.deepEqual(applyFreeze(runtimeHeldout, freeze, provenance).variants, runtimeHeldout.variants);
  assert.match(freeze.statement, /All predeclared policies/);
  for (const ids of [undefined, [], selectedIds.slice(0, 1), [...selectedIds, selectedIds[0]], selectedIds.map(() => selectedIds[0])]) {
    assert.throws(() => freezeStudy({ proposedPlan: runtimeHeldout, screen: { configuration: runtimeScreen, provenance },
      selectedIds: ids, provenance }), /two to five distinct/);
  }
  // Six distinct screened policies exceed the cap, independently of duplication.
  assert.throws(() => freezeStudy({ proposedPlan: heldout, screen: { configuration: screen, provenance },
    selectedIds: screen.variants.slice(0, 6).map(row => row.id), provenance }), /two to five distinct/);
  assert.throws(() => freezeStudy({ proposedPlan: runtimeHeldout, screen: { configuration: runtimeScreen, provenance },
    selectedIds: selectedIds.slice(0, 3), provenance }), /every predeclared variant/);
  const changedScreen = structuredClone(runtimeScreen);
  changedScreen.variants.find(row => row.id === 'soft-frontier').controls = { softFrontier: true, crossCategoryRecency: true };
  assert.throws(() => freezeStudy({ proposedPlan: runtimeHeldout, screen: { configuration: changedScreen, provenance },
    selectedIds, provenance }), /unchanged controls/);
  assert.throws(() => applyFreeze(runtimeHeldout, freeze, { sourceSha256: {
    'apps/language-runtime/static/source/games/recent-practice.mjs': 'changed'
  } }), /recent-practice/);
});

test('freeze rejects changed shared screen inputs while allowing distinct stage plan paths', () => {
  const shared = { 'source.mjs': 'same-source', 'config.json': 'same-config', 'fixture.json': 'same-fixture' };
  const provenance = { sourceSha256: { ...shared, 'heldout-plan.json': 'heldout-plan' } };
  const screened = { configuration: runtimeScreen,
    provenance: { sourceSha256: { ...shared, 'screen-plan.json': 'screen-plan' } } };
  const args = { proposedPlan: runtimeHeldout, screen: screened,
    selectedIds: runtimeScreen.variants.map(row => row.id), provenance, createdAt: '2026-09-21T00:00:00Z' };
  assert.deepEqual(freezeStudy(args).plan.variants, runtimeHeldout.variants);
  for (const file of Object.keys(shared)) {
    assert.throws(() => freezeStudy({ ...args, provenance: {
      sourceSha256: { ...provenance.sourceSha256, [file]: 'edited-after-screen' }
    } }), /changed before freeze/);
  }
  assert.throws(() => freezeStudy({ ...args, screen: { configuration: runtimeScreen } }), /require source provenance/);
});

test('study summary displays repetition and both backlog measures with the actual seed count', () => {
  const metrics = Object.fromEntries([
    'delayedRetention', 'delayedGoalRecall', 'learningGain', 'exposureCoverage', 'independentAssessmentCoverage',
    'meanHardEligibleCount', 'meanAvailableCount', 'recallFeatureAvailability', 'longestUnchangedFrontierDays',
    'exposureShare', 'assistedShare', 'independentShare', 'maximumPracticeDays', 'maximumIndependentDays', 'maximumSpacedSuccesses'
  ].map(key => [key, { mean: 0, max: 0 }]));
  Object.assign(metrics, { recentRepetition: { mean: .375 }, meanReviewBacklog: { mean: 2.5 }, finalReviewBacklog: { mean: 4 } });
  const result = { kind: 'policy-access-study', scope: 'Synthetic fixture',
    configuration: { ...runtimeScreen, seeds: [1, 2, 3, 4] }, units: 'One item', semanticScope: 'No semantic inference',
    summary: [{ scenarioId: 'sample', policyId: 'adaptive-paced', metrics }], pairedComparisons: [],
    scenarios: [{ id: 'sample', interactions: 1, configuration: base }],
    runs: [{ scenarioId: 'sample', policyId: 'adaptive-paced', eligibleIds: ['item-a', 'item-b'], diagnostics: {
      hardEligibleNeverAdmittedIds: [], calendar: { practiceDays: 1, start: base.startTime, finalInteraction: base.startTime }
    } }] };
  const markdown = renderStudyMarkdown(result);
  const lines = markdown.split('\n'), header = lines.find(line => line.startsWith('| Scenario | Policy | Delayed recall'));
  const values = lines[lines.indexOf(header) + 2].split('|').map(value => value.trim());
  const columns = header.split('|').map(value => value.trim());
  assert.equal(values[columns.indexOf('Recent repetition')], '0.3750');
  assert.equal(values[columns.indexOf('Mean review backlog')], '2.5000');
  assert.equal(values[columns.indexOf('Final review backlog')], '4.0000');
  assert.match(markdown, /This stage has 4 independent seed units/);
  assert.match(markdown, /2 hard-eligible item identities/);
  assert.match(markdown, /four most recently practiced distinct item IDs/);
  assert.match(markdown, /preceding 5 turns/);
  assert.match(markdown, /not fresh-content validation/);
  assert.match(markdown, /Word World excludeIds/);
  assert.match(markdown, /Review\/Reinforce\/Explore/);
  assert.doesNotMatch(markdown, /two development or three held-out seeds/);
});

test('CLI help advertises the bounded five-policy freeze and predeclared constraint', async () => {
  const { main } = await import('./run.mjs');
  const output = [], original = console.log;
  console.log = value => output.push(value);
  try { await main(['--help']); } finally { console.log = original; }
  assert.match(output.join('\n'), /Freeze 2-5 screened variants; retain all predeclared variants/);
});

test('importing the CLI and study modules does not execute an experiment', async () => {
  let output = 0;
  const original = console.log; console.log = () => { output++; };
  try {
    const module = await import('./run.mjs');
    assert.equal(typeof module.main, 'function');
    await import('./study.mjs');
    assert.equal(output, 0);
  } finally { console.log = original; }
});

test('large study output is serialized per run without losing JSON data', async () => {
  const { resultJsonChunks } = await import('./run.mjs');
  const result = { schemaVersion: 1, omitted: undefined,
    runs: [{ id: 'first', unicode: 'čeština', trace: Array(100).fill({ p: .05 }) }, { id: 'second', value: null }],
    sourceSha256: { 'sample.mjs': 'abc' }, empty: [] };
  const chunks = [...resultJsonChunks(result)];
  assert.deepEqual(JSON.parse(chunks.join('')), JSON.parse(JSON.stringify(result)));
  assert.ok(chunks.some(chunk => chunk === JSON.stringify(result.runs[0]) || chunk === `\n${JSON.stringify(result.runs[0])}`));
  assert.ok(chunks.every(chunk => !(chunk.includes('first') && chunk.includes('second'))));
});
