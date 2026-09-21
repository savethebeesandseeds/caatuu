import { createHash } from 'node:crypto';
import { simulateRun, validateInputs, distribution } from './runner.mjs';
import { SIMULATOR_MODELS } from './environment.mjs';
import { createExperimentPolicy } from '../production-policy.mjs';

export const jsonHash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const mean = values => values.reduce((a, b) => a + b, 0) / values.length;
const PRIMARY = ['delayedRetention', 'delayedGoalRecall'];
const BOOLEAN_CONTROLS = ['uniformScores', 'frontier', 'introductions', 'slots', 'recency'];

export function validateStudy(plan, { allowUnfrozen = false } = {}) {
  if (plan?.schemaVersion !== 1 || !['screen', 'heldout'].includes(plan.phase) || !plan.id) throw new TypeError('Invalid study identity/phase.');
  if (!['original', 'heldout'].includes(plan.fixture)) throw new TypeError('Invalid study fixture.');
  if (JSON.stringify(plan.primaryMetrics) !== JSON.stringify(PRIMARY)) throw new TypeError('Primary outcomes must remain delayed whole-bank and goal-weighted recall.');
  if (!Array.isArray(plan.seeds) || !plan.seeds.length || plan.seeds.some(seed => !Number.isSafeInteger(seed))
      || new Set(plan.seeds).size !== plan.seeds.length) throw new TypeError('Invalid study seeds.');
  if (!Array.isArray(plan.variants) || (!allowUnfrozen && !plan.variants.length)
      || new Set(plan.variants.map(row => row.id)).size !== plan.variants.length) throw new TypeError('Invalid or unfrozen study variants.');
  for (const row of plan.variants) {
    if (typeof row.id !== 'string' || !row.id || !row.controls || typeof row.controls !== 'object' || Array.isArray(row.controls)) throw new TypeError('Invalid variant.');
    for (const [key, value] of Object.entries(row.controls)) {
      if (BOOLEAN_CONTROLS.includes(key) ? typeof value !== 'boolean'
        : key !== 'outsideExploration' || typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) throw new TypeError(`Invalid experimental control ${key}.`);
    }
  }
  if (!Array.isArray(plan.scenarios) || !plan.scenarios.length || new Set(plan.scenarios.map(row => row.id)).size !== plan.scenarios.length) throw new TypeError('Invalid scenarios.');
  for (const row of plan.scenarios) {
    if (!row.id || !Number.isInteger(row.interactions) || row.interactions < 1 || !['perfect', 'observable-real'].includes(row.stateMode)
        || !Object.hasOwn(SIMULATOR_MODELS, row.simulatorModel)) throw new TypeError('Invalid scenario contract.');
  }
  if (plan.cells && (!Array.isArray(plan.cells) || !plan.cells.length
      || new Set(plan.cells.map(row => JSON.stringify([row.profileId, row.goalId]))).size !== plan.cells.length)) throw new TypeError('Invalid profile/goal cells.');
}

/** Pure freeze record. The CLI saves this before any held-out outcomes exist. */
export function freezeStudy({ proposedPlan, screen, selectedIds, provenance, createdAt }) {
  validateStudy(proposedPlan, { allowUnfrozen: true }); validateStudy(screen.configuration);
  if (proposedPlan.phase !== 'heldout' || screen.configuration.phase !== 'screen') throw new TypeError('Freeze requires a screen and a held-out plan.');
  if (selectedIds.length < 2 || selectedIds.length > 3 || new Set(selectedIds).size !== selectedIds.length) throw new TypeError('Freeze two or three distinct policies.');
  if (proposedPlan.seeds.some(seed => screen.configuration.seeds.includes(seed))) throw new TypeError('Held-out seeds overlap the development screen.');
  const variants = selectedIds.map(id => {
    const variant = screen.configuration.variants.find(row => row.id === id);
    if (!variant) throw new TypeError(`Variant ${id} was not screened.`);
    return structuredClone(variant);
  });
  const plan = { ...structuredClone(proposedPlan), variants };
  validateStudy(plan);
  return { schemaVersion: 1, kind: 'policy-study-freeze', createdAt,
    statement: 'Coordinator-selected shortlist frozen before held-out execution; no automatic winner selection.',
    screenResultSha256: jsonHash(screen), proposedPlanSha256: jsonHash(proposedPlan), planSha256: jsonHash(plan), plan,
    hypotheses: structuredClone(SIMULATOR_MODELS), provenance };
}

export function applyFreeze(proposedPlan, freeze, provenance) {
  if (freeze?.kind !== 'policy-study-freeze' || freeze.proposedPlanSha256 !== jsonHash(proposedPlan)
      || freeze.planSha256 !== jsonHash(freeze.plan)) throw new TypeError('Freeze does not match the held-out plan.');
  for (const [file, hash] of Object.entries(freeze.provenance.sourceSha256)) {
    if (provenance.sourceSha256[file] !== hash) throw new Error(`Frozen executable/config input changed: ${file}`);
  }
  validateStudy(freeze.plan);
  return structuredClone(freeze.plan);
}

/** Paired within cell first; aggregate seed means, never pooled independent runs. */
export function pairedStudyComparisons(runs) {
  const result = [];
  for (const scenarioId of [...new Set(runs.map(row => row.scenarioId))]) {
    const rows = runs.filter(row => row.scenarioId === scenarioId);
    const ids = [...new Set(rows.map(row => row.policyId))];
    const pairs = [
      ['adaptive-paced', 'uniform-paced'], ['adaptive-hard', 'uniform-hard'],
      ['uniform-paced', 'uniform-hard'], ['adaptive-paced', 'adaptive-hard'],
      ...ids.filter(id => id !== 'adaptive-paced').map(id => [id, 'adaptive-paced'])
    ].filter(([policy, reference], index, all) => ids.includes(policy) && ids.includes(reference)
      && all.findIndex(pair => JSON.stringify(pair) === JSON.stringify([policy, reference])) === index);
    for (const [policyId, referenceId] of pairs) {
      const differences = rows.filter(row => row.policyId === policyId).map(row => {
        const reference = rows.find(other => other.policyId === referenceId && other.seed === row.seed
          && other.profileId === row.profileId && other.goalId === row.goalId);
        if (!reference) throw new Error('Missing paired reference cell.');
        return { seed: row.seed, profileId: row.profileId, goalId: row.goalId,
          metrics: Object.fromEntries(Object.entries(row.metrics).map(([key, value]) => [key,
            value === null || reference.metrics[key] === null ? null : value - reference.metrics[key]])) };
      });
      const metricKeys = Object.keys(differences[0].metrics);
      const cells = [...new Set(differences.map(row => JSON.stringify([row.profileId, row.goalId])))];
      const strata = cells.map(key => {
        const [profileId, goalId] = JSON.parse(key), group = differences.filter(row => row.profileId === profileId && row.goalId === goalId);
        return { profileId, goalId, metrics: Object.fromEntries(metricKeys.map(metric => [metric, distribution(group.map(row => row.metrics[metric]))])) };
      });
      const seedMeans = [...new Set(differences.map(row => row.seed))].map(seed => {
        const group = differences.filter(row => row.seed === seed);
        return { seed, cells: group.length, metrics: Object.fromEntries(metricKeys.map(metric => {
          const values = group.map(row => row.metrics[metric]).filter(value => value !== null);
          return [metric, values.length ? mean(values) : null];
        })) };
      });
      result.push({ scenarioId, policyId, referenceId, pairedCells: differences.length,
        independentSeedUnits: seedMeans.length,
        aggregation: 'Equal-weight profile/goal paired differences averaged within each seed, then summarized across seeds; no pooled independent-replicate assumption.',
        differences, strata, seedMeans, metrics: Object.fromEntries(metricKeys.map(metric => [metric, distribution(seedMeans.map(row => row.metrics[metric]))])) });
    }
  }
  return result;
}

export async function runStudy({ plan, baseConfig, fixtures, onProgress = () => {} }) {
  validateStudy(plan);
  const fixture = fixtures[plan.fixture];
  if (!fixture) throw new TypeError('Missing declared study fixture.');
  const cells = plan.cells || baseConfig.profiles.flatMap(profileId => baseConfig.goals.map(goalId => ({ profileId, goalId })));
  const policies = plan.variants.map(createExperimentPolicy);
  const runs = [], scenarios = [];
  for (const scenario of plan.scenarios) {
    const config = { ...baseConfig, seeds: plan.seeds, interactions: scenario.interactions,
      stateMode: scenario.stateMode, simulatorModel: scenario.simulatorModel, diagnostics: true };
    validateInputs(config, fixture);
    scenarios.push({ ...scenario, configuration: config, cells });
    for (const { profileId, goalId } of cells) {
      const profile = fixture.profiles.find(row => row.id === profileId), goal = fixture.goals.find(row => row.id === goalId);
      if (!profile || !goal) throw new TypeError('Unknown selected profile/goal cell.');
      for (const seed of plan.seeds) for (const policy of policies) {
        runs.push({ scenarioId: scenario.id, ...await simulateRun({ config, fixture, profile, goal, seed, policy }) });
      }
      onProgress({ scenario: scenario.id, profileId, goalId, completedRuns: runs.length });
    }
  }
  const summary = [];
  for (const scenario of scenarios) for (const policy of policies) {
    const selected = runs.filter(row => row.scenarioId === scenario.id && row.policyId === policy.id);
    summary.push({ scenarioId: scenario.id, policyId: policy.id, runCount: selected.length,
      metrics: Object.fromEntries(Object.keys(selected[0].metrics).map(metric => [metric, distribution(selected.map(row => row.metrics[metric]))])) });
  }
  return { schemaVersion: 1, kind: 'policy-access-study', scope: 'Performance under authored simulator assumptions, not demonstrated learning by people.',
    configuration: structuredClone(plan), baseConfiguration: structuredClone(baseConfig), fixture: structuredClone(fixture),
    hypotheses: structuredClone(SIMULATOR_MODELS), scenarios, runs, summary, pairedComparisons: pairedStudyComparisons(runs),
    units: 'One chosen authored assessment-item identity per interaction. Exposure has no response; assistance and independent responses have one assessed item. No time-cost model.',
    semanticScope: 'No semantic inference in these simulations. Transfer uses explicit simulator-only edges, not embeddings or inferred mastery.' };
}

const fmt = value => typeof value === 'number' ? value.toFixed(4) : 'n/a';
export function renderStudyMarkdown(result) {
  if (result.kind === 'policy-study-freeze') return `# Frozen policy shortlist\n\n${result.statement}\n\nCreated: ${result.createdAt}\n\nVariants: ${result.plan.variants.map(row => row.id).join(', ')}\n\nPlan SHA-256: ${result.planSha256}\n\nScreen SHA-256: ${result.screenResultSha256}\n\nNo held-out outcomes were executed by this command. Exact hypotheses, source/config hashes, primary metrics, fixture and schedule are frozen in results.json.\n`;
  const lines = ['# Candidate access investigation', '', result.scope, '',
    `Stage: ${result.configuration.phase}; ${result.runs.length} runs; seeds ${result.configuration.seeds.join(', ')}.`,
    result.configuration.notes, '', result.units, result.semanticScope, '',
    'Primary outcomes remain delayed whole-bank recall and delayed goal-weighted recall. Summary means below are descriptive; profile/goal cells are repeated conditions, not independent experimental replicates.', '',
    '| Scenario | Policy | Delayed recall | Delayed goal | Learning gain | Exposure coverage | Independent coverage | Mean H | Mean A | Backlog | Recall feature available |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |'];
  for (const row of result.summary) lines.push(`| ${row.scenarioId} | ${row.policyId} | ${['delayedRetention','delayedGoalRecall','learningGain','exposureCoverage','independentAssessmentCoverage','meanHardEligibleCount','meanAvailableCount','finalReviewBacklog','recallFeatureAvailability'].map(key => fmt(row.metrics[key]?.mean)).join(' | ')} |`);
  lines.push('', '## Paired differences and seed variation', '',
    'Subtract the reference within each identical scenario/profile/goal/seed. Aggregate by equal-weight cell mean within each seed before reporting seed SD/range. With only two development or three held-out seeds these are descriptive uncertainty summaries, not confidence intervals. Negative recall differences remain visible.', '',
    '| Scenario | Policy minus reference | Paired cells | Seed units | Delayed recall mean / SD / range | Delayed goal mean / SD / range |',
    '| --- | --- | --- | --- | --- | --- |');
  const spread = stat => `${fmt(stat.mean)} / ${fmt(stat.sd)} / [${fmt(stat.min)}, ${fmt(stat.max)}]`;
  for (const row of result.pairedComparisons) lines.push(`| ${row.scenarioId} | ${row.policyId} − ${row.referenceId} | ${row.pairedCells} | ${row.independentSeedUnits} | ${spread(row.metrics.delayedRetention)} | ${spread(row.metrics.delayedGoalRecall)} |`);
  lines.push('', '## Profile and goal differences', '', '| Scenario | Policy minus reference | Profile | Goal | Delayed recall mean / SD / range |', '| --- | --- | --- | --- | --- |');
  for (const comparison of result.pairedComparisons) for (const row of comparison.strata) lines.push(`| ${comparison.scenarioId} | ${comparison.policyId} − ${comparison.referenceId} | ${row.profileId} | ${row.goalId} | ${spread(row.metrics.delayedRetention)} |`);
  lines.push('', '## Access, evidence and action diagnostics', '',
    'H is the initial hard-eligible authored item universe; hardRemaining removes already-used board answer groups. A is the actual positive-probability support for a slot, including an outside exploration route. Restriction labels overlap and must not be summed. Per-item admission counts, never-admitted/never-selected/unassessed distinctions, difficulty/category/position, exact conditional distributions and fallbacks are in JSON.', '',
    '| Scenario | Policy | Never admitted (union across runs) | Unchanged frontier days (max) | Exposure / assisted / independent shares | Max practice / independent days / spaced successes |',
    '| --- | --- | --- | --- | --- | --- |');
  for (const group of result.summary) {
    const runs = result.runs.filter(row => row.scenarioId === group.scenarioId && row.policyId === group.policyId);
    const inaccessible = [...new Set(runs.flatMap(row => row.diagnostics.hardEligibleNeverAdmittedIds || []))];
    const keys = ['exposureShare','assistedShare','independentShare'];
    lines.push(`| ${group.scenarioId} | ${group.policyId} | ${inaccessible.join(', ') || 'none'} | ${fmt(group.metrics.longestUnchangedFrontierDays.max)} | ${keys.map(key => fmt(group.metrics[key].mean)).join(' / ')} | ${['maximumPracticeDays','maximumIndependentDays','maximumSpacedSuccesses'].map(key => group.metrics[key].max).join(' / ')} |`);
  }
  lines.push('', '## Calendar and model limits', '');
  for (const scenario of result.scenarios) {
    const first = result.runs.find(row => row.scenarioId === scenario.id).diagnostics.calendar;
    lines.push(`- ${scenario.id}: ${scenario.interactions} interactions over ${first.practiceDays} practice days; ${scenario.configuration.interactionsPerDay}/day, ${scenario.configuration.stepMinutes} minutes apart; ${first.start} through ${first.finalInteraction}; probe ${scenario.configuration.delayDays} days after the final interaction.`);
  }
  lines.push('', '- Fixed model: spacing does not improve half-life. Editorial difficulty/complexity and goal suitability do not change learning dynamics. Transfer only follows authored directed edges. Modality factors are fixed hypotheses, not measured costs.',
    '- Spacing hypothesis changes memory stability after genuinely retrieved independent spaced practice; its exact formula and constants were authored before outcomes and are embedded in JSON. It does not prove a spacing benefit in people.',
    '- Low-benefit hypothesis keeps fixed forgetting, disables transfer and discounts repeated direct gains. It is intentionally unfavorable to reinforcement.',
    '- Perfect state is a diagnostic input, not a guaranteed upper bound. Observable state uses the actual production journal/reducer and learner-state adapter; missing recall remains unavailable. This comparison changes both probability availability and the synthetic-versus-real evidence path, so it does not isolate either effect. Evaluator A is not executed.',
    '- An unchanged frontier is flagged only while some hard-eligible item lies beyond it; this is a diagnostic stall indicator, not proof that no outside item can be admitted through a fallback.',
    '- Feature availability counts finite values over hard-eligible candidate/item slots. Sources distinguish editorial challenge fallback from supplied response probability. Missing-evidence indicators are not calibrated uncertainty.',
    '- Review backlog counts encountered items with an explicit due date at/before the current timestamp. Independent coverage uses directly observed independent outcomes in this run, not recovered historical denominators.',
    '- Modality draws are paired by seed/profile/step and independent of chosen item. Each interaction addresses one assessment unit; exposure has no assessment. No synthetic time-cost model is introduced.',
    '- Full per-profile/goal/seed trajectories and score/input snapshots at start, midpoint and end are retained. Probe reads do not alter memory, evidence or random streams.', '',
    '## Provenance and reproduction', '', 'Use the exact manual command in provenance.commandArguments with the recorded source/config/fixture hashes. Held-out reports embed their pre-outcome freeze. A changed source invalidates that freeze; no thresholds here gate releases.', '');
  return lines.join('\n');
}
