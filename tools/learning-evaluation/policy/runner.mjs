import { createEnvironment, SIMULATOR_ASSUMPTIONS, simulatorModel } from './environment.mjs';
import { seededRandom } from './random.mjs';
import { recordOutcome } from './evidence.mjs';
import { baselinePolicies } from './policies.mjs';
import { compactDecision, evidenceDiagnostics, summarizeDiagnostics } from './diagnostics.mjs';
import { matchesContentDifficulty } from '../../../apps/language-runtime/static/source/games/content-progression.mjs';

const DAY = 86400000;
const mean = values => values.reduce((a, b) => a + b, 0) / values.length;
const finite = (value, min, max) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
const goalWeight = (goal, id) => Object.hasOwn(goal.weights, id) ? goal.weights[id] : 0;
function uniqueIds(rows, label) {
  if (!Array.isArray(rows) || !rows.length || rows.some(row => typeof row.id !== 'string' || !row.id)
      || new Set(rows.map(row => row.id)).size !== rows.length) throw new TypeError(`Invalid ${label} identities.`);
}
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

/** Eligibility contains no frontier, introduction pacing, review or policy score. */
export function eligibleCandidates(fixture, config) {
  return fixture.items.filter(item => item.validTask && matchesContentDifficulty(item, config.difficulty))
    .map(({ simulation, ...item }) => structuredClone(item));
}

export function validateInputs(config, fixture) {
  if (config.schemaVersion !== 1 || fixture.schemaVersion !== 1) throw new TypeError('Unsupported schemaVersion.');
  if (config.stateMode !== undefined && !['perfect', 'observable-real'].includes(config.stateMode)) throw new TypeError('Invalid stateMode.');
  if (config.diagnostics !== undefined && typeof config.diagnostics !== 'boolean') throw new TypeError('diagnostics must be boolean.');
  simulatorModel(config.simulatorModel);
  for (const field of ['courseId', 'gameId', 'bankId']) {
    if (typeof fixture.identity?.[field] !== 'string' || !fixture.identity[field]) throw new TypeError(`Missing identity.${field}.`);
  }
  uniqueIds(fixture.items, 'item'); uniqueIds(fixture.profiles, 'profile'); uniqueIds(fixture.goals, 'goal');
  for (const item of fixture.items) {
    if (![1, 2, 3].includes(item.difficulty) || typeof item.validTask !== 'boolean') throw new TypeError('Invalid hard eligibility.');
    for (const field of ['usefulness', 'complexity']) {
      if (!Number.isInteger(item[field]) || !finite(item[field], 1, 100)) throw new TypeError(`Invalid ${field}.`);
    }
  }
  for (const field of ['interactions', 'interactionsPerDay', 'minimumPool', 'recentWindow']) {
    if (!Number.isSafeInteger(config[field]) || config[field] < 1) throw new TypeError(`Invalid ${field}.`);
  }
  if (![1, 2, 3].includes(config.difficulty)) throw new TypeError('Invalid difficulty.');
  if (!finite(config.stepMinutes, 0.001, 1440)
      || (config.interactionsPerDay - 1) * config.stepMinutes >= 1440) throw new TypeError('Invalid within-day timing.');
  if (!finite(config.delayDays, 0, 36500) || typeof config.startTime !== 'string'
      || !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(config.startTime) || !Number.isFinite(Date.parse(config.startTime))
      || Date.parse(config.startTime) < 0) throw new TypeError('Invalid probe timing.');
  const endTime = Date.parse(config.startTime) + Math.floor((config.interactions - 1) / config.interactionsPerDay) * DAY
    + ((config.interactions - 1) % config.interactionsPerDay) * config.stepMinutes * 60000 + config.delayDays * DAY;
  if (!Number.isFinite(endTime) || endTime > 8.64e15) throw new TypeError('Run time exceeds timestamp range.');
  if (!Array.isArray(config.seeds) || !config.seeds.length
      || config.seeds.some(seed => !Number.isSafeInteger(seed))
      || new Set(config.seeds).size !== config.seeds.length) throw new TypeError('Seeds must be unique safe integers.');
  for (const [field, rows] of [['profiles', fixture.profiles], ['goals', fixture.goals]]) {
    if (!Array.isArray(config[field]) || !config[field].length || new Set(config[field]).size !== config[field].length
        || config[field].some(id => !rows.some(row => row.id === id))) throw new TypeError(`Invalid selected ${field}.`);
  }
  if (!finite(config.weakRecallCutoff, 0, 1) || !Array.isArray(config.suitableRecallRange)
      || config.suitableRecallRange.length !== 2 || config.suitableRecallRange.some(n => !finite(n, 0, 1))
      || config.suitableRecallRange[0] > config.suitableRecallRange[1]) throw new TypeError('Invalid diagnostic thresholds.');
  const candidates = eligibleCandidates(fixture, config);
  if (!candidates.length) throw new TypeError('Empty hard-eligible universe.');
  const itemIds = new Set(fixture.items.map(item => item.id));
  for (const goal of fixture.goals) {
    if (!goal.weights || typeof goal.weights !== 'object' || Array.isArray(goal.weights)
        || Object.entries(goal.weights).some(([id, weight]) => !itemIds.has(id) || !finite(weight, 0, 1e6))) {
      throw new TypeError('Invalid goal weights.');
    }
    if (config.goals.includes(goal.id) && !candidates.some(item => goalWeight(goal, item.id) > 0)) {
      throw new TypeError('Goal has no eligible positive-weight items.');
    }
  }
  return candidates;
}

function score(knowledge, candidates, goal) {
  const recall = mean(candidates.map(item => knowledge[item.id].recallProbability));
  const total = candidates.reduce((sum, item) => sum + goalWeight(goal, item.id), 0);
  return { recall, goalRecall: candidates.reduce((sum, item) =>
    sum + goalWeight(goal, item.id) * knowledge[item.id].recallProbability, 0) / total };
}

export async function simulateRun({ config, fixture, profile, goal, seed, policy }) {
  const candidates = validateInputs(config, fixture);
  if (!fixture.profiles.some(row => row.id === profile.id) || !fixture.goals.some(row => row.id === goal.id)) {
    throw new TypeError('Run profile/goal must belong to the fixture.');
  }
  const start = Date.parse(config.startTime);
  const environment = createEnvironment({ fixture, profile, seed, now: start, transfer: config.transfer, model: config.simulatorModel });
  const noPractice = createEnvironment({ fixture, profile, seed, now: start, transfer: config.transfer, model: config.simulatorModel });
  const initialKnowledge = environment.knowledge(start);
  const initial = score(initialKnowledge, candidates, goal);
  const random = seededRandom(`policy:${seed}:${profile.id}:${goal.id}`);
  const instance = await policy.create();
  if (typeof instance?.select !== 'function') throw new TypeError('Policy factory must return select(input).');
  let history = Object.create(null);
  const observable = config.stateMode === 'observable-real'
    ? await (await import('./observable.mjs')).createObservableEvidence({ identity: fixture.identity,
      itemIds: candidates.map(item => item.id), now: start, runId: `b-${seed}-${profile.id}-${goal.id}-${policy.id}` }) : null;
  const trace = [];
  const visited = new Set(), independentlyAssessed = new Set(), decisionSnapshots = [];
  let now = start;
  for (let step = 0; step < config.interactions; step++) {
    now = start + Math.floor(step / config.interactionsPerDay) * DAY
      + (step % config.interactionsPerDay) * config.stepMinutes * 60000;
    const knowledge = environment.knowledge(now);
    const learner = observable ? observable.learner(now)
      : { mode: 'perfect-synthetic', evidenceByItem: history, knowledgeByItem: knowledge };
    const input = freeze(structuredClone({ identity: fixture.identity, candidates,
      learner,
      goal, now, difficulty: config.difficulty, minimumPool: config.minimumPool }));
    // random remains a callable stream; adapter receives no environment object.
    const selected = await instance.select(Object.freeze({ ...input, random }));
    const itemId = typeof selected === 'string' ? selected : selected?.itemId;
    const rawDecision = config.diagnostics ? (selected?.trace ?? instance.lastDecision?.() ?? null) : null;
    const decision = config.diagnostics ? compactDecision(rawDecision, candidates) : null;
    if (config.diagnostics && [0, Math.floor(config.interactions / 2), config.interactions - 1].includes(step)) {
      decisionSnapshots.push({ step, input: structuredClone(input), decision: structuredClone(rawDecision) });
    }
    if (typeof itemId !== 'string' || !candidates.some(item => item.id === itemId)) {
      throw new Error(`Policy ${policy.id} selected an ineligible item: ${String(itemId)}`);
    }
    const weak = candidates.filter(item => goalWeight(goal, item.id) > 0
      && knowledge[item.id].recallProbability < config.weakRecallCutoff);
    const novel = !visited.has(itemId);
    const recentRepeat = trace.slice(-config.recentWindow).some(row => row.itemId === itemId);
    const evidenceBefore = config.diagnostics ? evidenceDiagnostics(history, now) : null;
    const outcome = environment.interact(itemId, now, step);
    if (observable) { await observable.record(itemId, outcome, now, step); history = observable.history(); }
    else recordOutcome(history, itemId, outcome, now);
    trace.push({ step, itemId, now, novel, recentRepeat,
      relevantWeak: weak.some(item => item.id === itemId), weakOpportunity: weak.length > 0,
      weakAvailability: weak.length / candidates.length, outcome,
      ...(config.diagnostics ? { decision, evidenceBefore, unassessedBefore: !independentlyAssessed.has(itemId) } : {}) });
    visited.add(itemId);
    if (outcome.evidence === 'independent') independentlyAssessed.add(itemId);
  }
  const finalKnowledge = environment.knowledge(now);
  const delayedKnowledge = environment.knowledge(now + config.delayDays * DAY);
  const final = score(finalKnowledge, candidates, goal);
  const delayed = score(delayedKnowledge, candidates, goal);
  const idle = score(noPractice.knowledge(now), candidates, goal);
  const idleDelayed = score(noPractice.knowledge(now + config.delayDays * DAY), candidates, goal);
  const independent = trace.filter(row => row.outcome.evidence === 'independent' && row.outcome.correct !== null);
  const opportunities = trace.filter(row => row.weakOpportunity);
  const metrics = {
    initialRecall: initial.recall, immediateRecall: final.recall,
    learningGain: final.recall - initial.recall, gainOverNoPractice: final.recall - idle.recall,
    delayedRetention: delayed.recall, retainedGainOverNoPractice: delayed.recall - idleDelayed.recall,
    noPracticeDelayedRecall: idleDelayed.recall, retentionDecay: final.recall - delayed.recall,
    initialGoalRecall: initial.goalRecall, immediateGoalRecall: final.goalRecall,
    goalProgress: final.goalRecall - initial.goalRecall, delayedGoalRecall: delayed.goalRecall,
    delayedGoalGainOverNoPractice: delayed.goalRecall - idleDelayed.goalRecall,
    challengeSuitability: mean(trace.map(row => Number(row.outcome.recallProbability >= config.suitableRecallRange[0]
      && row.outcome.recallProbability <= config.suitableRecallRange[1]))),
    meanSelectedRecall: mean(trace.map(row => row.outcome.recallProbability)),
    repetition: 1 - visited.size / trace.length, recentRepetition: mean(trace.map(row => Number(row.recentRepeat))),
    noveltyCoverage: visited.size / candidates.length,
    weakAreaAttention: opportunities.length ? mean(opportunities.map(row => Number(row.relevantWeak))) : null,
    weakAreaAvailability: opportunities.length ? mean(opportunities.map(row => row.weakAvailability)) : null,
    independentAccuracy: independent.length ? mean(independent.map(row => Number(row.outcome.correct))) : null,
  };
  const additional = config.diagnostics ? summarizeDiagnostics({ fixture, candidates, trace, history, now }) : null;
  if (additional) Object.assign(metrics, additional.metrics);
  return { policyId: policy.id, profileId: profile.id, goalId: goal.id, seed,
    eligibleIds: candidates.map(item => item.id), initialKnowledge, finalKnowledge, delayedKnowledge,
    history, trace, metrics, finalState: environment.snapshot(now),
    ...(additional ? { diagnostics: additional.diagnostics, decisionSnapshots } : {}),
    ...(observable ? { stateProvenance: observable.provenance() } : {}),
    ...(config.stateMode || config.simulatorModel ? { stateMode: config.stateMode || 'perfect', model: config.simulatorModel || 'fixed' } : {}) };
}

export function distribution(values) {
  const finiteValues = values.filter(value => typeof value === 'number' && Number.isFinite(value));
  if (!finiteValues.length) return { n: 0, mean: null, sd: null, min: null, max: null };
  const average = mean(finiteValues);
  return { n: finiteValues.length, mean: average,
    sd: finiteValues.length > 1 ? Math.sqrt(finiteValues.reduce((sum, value) => sum + (value - average) ** 2, 0) / (finiteValues.length - 1)) : null,
    min: Math.min(...finiteValues), max: Math.max(...finiteValues) };
}
function summarize(runs) {
  const keys = Object.keys(runs[0].metrics);
  const groups = new Map();
  for (const run of runs) {
    for (const key of [JSON.stringify([run.policyId, null, null]), JSON.stringify([run.policyId, run.profileId, run.goalId])]) {
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(run);
    }
  }
  return [...groups].map(([key, rows]) => {
    const [policyId, profileId, goalId] = JSON.parse(key);
    return { policyId, profileId, goalId, metrics: Object.fromEntries(keys.map(metric =>
      [metric, distribution(rows.map(run => run.metrics[metric]))])) };
  });
}

export async function runEvaluation({ config, fixture, policies = baselinePolicies() }) {
  validateInputs(config, fixture);
  uniqueIds(policies, 'policy');
  const runs = [];
  for (const profileId of config.profiles) for (const goalId of config.goals) for (const seed of config.seeds) {
    const profile = fixture.profiles.find(row => row.id === profileId);
    const goal = fixture.goals.find(row => row.id === goalId);
    for (const policy of policies) runs.push(await simulateRun({ config, fixture, profile, goal, seed, policy }));
  }
  const deltas = [];
  for (const run of runs.filter(row => row.policyId !== 'uniform')) {
    const reference = runs.find(row => row.policyId === 'uniform' && row.seed === run.seed
      && row.profileId === run.profileId && row.goalId === run.goalId);
    if (!reference) continue;
    deltas.push({ ...run, metrics: Object.fromEntries(Object.entries(run.metrics).map(([key, value]) =>
      [key, value === null || reference.metrics[key] === null ? null : value - reference.metrics[key]])) });
  }
  return { schemaVersion: 1, scope: 'Independent synthetic learner simulation; not demonstrated human learning gains.',
    configuration: structuredClone(config), fixture: structuredClone(fixture), simulator: structuredClone(SIMULATOR_ASSUMPTIONS),
    ...(config.simulatorModel ? { sensitivityHypothesis: simulatorModel(config.simulatorModel) } : {}),
    policies: [...policies.map(({ id, label, implementation }) => ({ id, label, implementation, status: 'executed' })),
      ...(!policies.some(policy => policy.id === 'production') ? [{ id: 'production', label: 'New production policy',
        status: 'pending', reason: 'Integration-owned real implementation adapter has not been supplied.' }] : [])],
    runs, summary: summarize(runs), pairedDifferences: deltas.length ? summarize(deltas) : [] };
}
