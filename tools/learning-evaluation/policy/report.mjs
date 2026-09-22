const format = value => value == null ? 'n/a' : value.toFixed(4);
const cell = value => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
const spread = stat => stat ? `${format(stat.mean)} ± ${format(stat.sd)} [${format(stat.min)}, ${format(stat.max)}]; n=${stat.n}` : 'pending';

export const metricDescriptions = {
  initialRecall: 'Mean latent retrieval probability over every hard-eligible item at the start.',
  immediateRecall: 'Mean latent retrieval probability immediately after the final interaction.',
  learningGain: 'Immediate recall minus initial recall; includes forgetting during the run.',
  gainOverNoPractice: 'Immediate recall minus a paired no-practice trajectory at the same time.',
  delayedRetention: 'Mean latent retrieval probability after the configured no-practice delay.',
  retainedGainOverNoPractice: 'Delayed recall minus a paired no-practice trajectory at the same delayed time.',
  noPracticeDelayedRecall: 'Delayed mean recall without any practice; a forgetting control, not an optimal policy.',
  retentionDecay: 'Immediate minus delayed recall; not normalized by immediate recall.',
  initialGoalRecall: 'Initial recall weighted by independently authored selected-goal weights, normalized over eligible items.',
  immediateGoalRecall: 'Immediate goal-weighted recall.',
  goalProgress: 'Immediate goal-weighted recall minus initial goal-weighted recall.',
  delayedGoalRecall: 'Delayed goal-weighted recall.',
  delayedGoalGainOverNoPractice: 'Delayed goal-weighted recall minus its no-practice control.',
  challengeSuitability: 'Fraction of selected items whose pre-practice latent recall lies in the configured inclusive diagnostic band.',
  meanSelectedRecall: 'Mean pre-practice latent recall of selected items, excluding chance guessing and slips.',
  repetition: '1 minus distinct selected item count divided by interaction count.',
  recentRepetition: 'Fraction of turns selecting an item seen in the preceding recentWindow turns; denominator includes first turn.',
  noveltyCoverage: 'Distinct practiced items divided by the hard-eligible bank size.',
  weakAreaAttention: 'Fraction choosing positive-goal-weight items below weakRecallCutoff, conditional on any such item existing.',
  weakAreaAvailability: 'Mean fraction of candidates that are relevant and weak, on those same opportunity turns; uniform reference rate.',
  independentAccuracy: 'Observed first-response accuracy on independent assessed turns; includes lucky guesses and slips. Null if none.',
};

export function renderMarkdown(result) {
  const { configuration: config, policies } = result;
  const all = result.summary.filter(row => row.profileId === null);
  const lines = ['# Sampling-policy evaluation', '', result.scope, '',
    'This manually invoked evaluator is independent of stats/content evaluator execution.',
    config.stateMode === 'observable-real'
      ? 'State input: observable-real. The production journal/reducer supplies observed evidence; latent recall and response probabilities are unavailable to the selector.'
      : 'State input: perfect synthetic probabilities, supplied diagnostically rather than estimated from production activity.',
    'The maintained production adapter shares gameplay\'s four-most-recent-identity input. This differs from the five-turn repetition diagnostic; semantic inputs and complete game boards remain outside this simulation.', '',
    `- Seeds: ${config.seeds.join(', ')}. Profiles: ${config.profiles.map(cell).join(', ')}. Goals: ${config.goals.map(cell).join(', ')}.`,
    `- Each run: ${config.interactions} interactions; ${config.interactionsPerDay} per day; ${config.stepMinutes} minutes apart; start ${config.startTime}.`,
    `- Exact difficulty band: ${config.difficulty}; minimumPool: ${config.minimumPool}; delayed probe: ${config.delayDays} days.`,
    `- Executed runs: ${result.runs.length}. Every policy has the same hard-eligible IDs, initial states, goals, time schedule and seed set.`,
    `- Diagnostic recall band: ${config.suitableRecallRange.join('–')}; weak cutoff: ${config.weakRecallCutoff}; recent window: ${config.recentWindow}. These are simulator diagnostics, not pedagogical gates.`, '',
    '## Policy status', '', '| Policy | Status | Implementation / limitation |', '| --- | --- | --- |'];
  for (const policy of policies) lines.push(`| ${cell(policy.label)} | ${policy.status} | ${cell(policy.reason || policy.implementation || (policy.id === 'existing-scheduler'
    ? 'Actual imported selectContentItems; its frontier, pacing and shortlist remain policy behavior.' : 'Baseline over the full eligible bank.'))} |`);
  lines.push('', '## Aggregate metrics', '',
    'Cells are mean ± sample standard deviation [minimum, maximum]; n is non-null runs. Aggregate spread mixes seed, profile and goal variation; it is not a confidence interval. Every profile/goal has equal seed count.', '',
    `| Metric | ${policies.map(policy => cell(policy.label)).join(' | ')} |`,
    `| --- | ${policies.map(() => '---').join(' | ')} |`);
  for (const metric of Object.keys(metricDescriptions)) lines.push(`| ${metric} | ${policies.map(policy =>
    spread(all.find(row => row.policyId === policy.id)?.metrics[metric])).join(' | ')} |`);
  lines.push('', '## Variation by profile and goal', '',
    'Each cell summarizes variation across the paired seed set; full distributions for all metrics are in results.json.', '',
    '| Policy | Profile | Goal | Learning gain | Delayed retention | Goal progress | Weak attention |',
    '| --- | --- | --- | --- | --- | --- | --- |');
  for (const row of result.summary.filter(row => row.profileId !== null)) lines.push(
    `| ${cell(row.policyId)} | ${cell(row.profileId)} | ${cell(row.goalId)} | ${spread(row.metrics.learningGain)} | ${spread(row.metrics.delayedRetention)} | ${spread(row.metrics.goalProgress)} | ${spread(row.metrics.weakAreaAttention)} |`);
  lines.push('', '## Paired differences from uniform', '',
    'Differences are computed within the same profile, goal and seed before summarizing. No optimal reference or regret is defined.', '',
    '| Policy | Delayed retention difference | Goal progress difference |', '| --- | --- | --- |');
  for (const row of result.pairedDifferences.filter(row => row.profileId === null)) lines.push(
    `| ${cell(row.policyId)} | ${spread(row.metrics.delayedRetention)} | ${spread(row.metrics.goalProgress)} |`);
  if (!result.pairedDifferences.length) lines.push('| n/a | Uniform comparison not executed | Uniform comparison not executed |');
  lines.push('', '## Metric definitions', '');
  for (const [metric, definition] of Object.entries(metricDescriptions)) lines.push(`- **${metric}**: ${definition}`);
  lines.push('', '## Assumptions and limitations', '',
    '- Fixture initial recall, learning rates, half-lives, guess probabilities and profile parameters are independently authored synthetic assumptions. They are not calibrated to human data or computed from scheduler scores, usefulness, complexity or readiness.',
    '- Recall decays exponentially. Practice adds a diminishing gain toward one; exposure, assistance, retrieved answers and failed retrieval use distinct fixed learning multipliers. Forgetting rates do not improve with practice. Full parameters and formulas are documented beside the evaluator and embedded in JSON.',
    '- Retrieval, slips and guessing are distinct events. Correct guesses can produce observed independent success without true retrieval. Assistance and exposure never produce independent or spaced evidence.',
    '- Transfer follows explicit directed fixture links only, never semantic similarity or embeddings. Per-step and lifetime destination caps bound it; there is no transfer cascade, no transferred assessment evidence and no mastered state.',
    '- Policy and environment randomness are separate. Environment draws are keyed by seed, profile, interaction and channel. Action-dependent probabilities and each run’s own learning/history determine responses; policies do not share outcomes.',
    '- Probes compute expected latent recall for all eligible items without training, changing history or consuming randomness. There is no sampled assessment error in these metrics.',
    '- Goal weights define the simulator objective independently of usefulness. A synthetic bank and a single-item selection loop do not model full boards, distraction quality, motivation, time-on-task variation, multimodal production, dropouts or real learners.',
    '- Only the existing-scheduler adapter uses selectContentItems. Synthetic evidence supports ordered unique encounters and its current scheduling inputs; browser persistence, duplicate correction and concurrency behavior are outside this evaluator.',
    '- Perfect state removes estimation error but does not give the runner a validated learning model. The existing baselines intentionally ignore the optional perfect knowledge. No real-world efficacy, optimal teaching sequence, universal mastery or unrestricted transfer is claimed.', '',
    '## Reproduction', '',
    'results.json contains resolved configuration, complete fixture, per-run history/outcomes, initial/final/probe state, summary distributions and source provenance. Use the README commands with the same source hashes and adapter. A production comparison remains pending unless the real integration-owned adapter was explicitly supplied.', '');
  return lines.join('\n');
}
