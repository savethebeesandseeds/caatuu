import { readFile, mkdir, writeFile, realpath, lstat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { learnerItemState } from '../../../apps/language-runtime/static/source/learner-state.mjs';
import { createLearningHarness } from './harness.mjs';
import { createScriptedLearner, validateConfiguration } from './scenarios.mjs';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const artifactRoot = path.join(repositoryRoot, 'artifacts', 'learning-evaluation', 'stats');
const unavailable = reason => ({ available: false, value: null, reason });
const identityKey = identity => JSON.stringify(identity);

function argumentsFrom(argv) {
  const result = { fixture: false, semantic: false };
  for (let index = 0; index < argv.length; index++) {
    const option = argv[index];
    if (option === '--fixture' || option === '--semantic' || option === '--help') result[option.slice(2)] = true;
    else if (['--config', '--seed', '--learners', '--rounds', '--name', '--profiles'].includes(option)) {
      const value = argv[++index];
      if (!value || value.startsWith('--')) throw new TypeError(`${option} needs a value.`);
      result[option.slice(2)] = ['--seed', '--learners', '--rounds'].includes(option) ? Number(value) : value;
    } else throw new TypeError(`Unknown option: ${option}`);
  }
  if (result.fixture && result.config) throw new TypeError('Use either --fixture or --config.');
  if (result.profiles && !result.semantic) throw new TypeError('--profiles requires --semantic.');
  if (result.name && !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/u.test(result.name)) throw new TypeError('--name must be a simple directory name.');
  return result;
}

function stateFor(harness, target, now) {
  const history = harness.history(target.identity.gameId, target.identity.bankId);
  // Explicit whitelist: no simulator truth, priors, guesses, skill or future interactions cross this boundary.
  const { courseId, gameId, bankId, itemId, assessmentDirection } = target.identity;
  return { history: history[itemId] ?? null,
    adapter: learnerItemState({ courseId, gameId, bankId, itemId, assessmentDirection, history, now }) };
}

function expectedStatus(step) {
  if (['presentation-only', 'repeated-presentation'].includes(step.phase)) return 'exposure-only';
  if (['hint', 'hinted-correction', 'assisted-practice', 'error-provenance-after-support'].includes(step.phase)) return 'supported';
  return 'independently-assessed';
}

/** Independent evaluator; no policy selection and no other evaluator execution. */
export async function evaluateStats(configuration, { semantic = false, profilesPath } = {}) {
  const config = validateConfiguration({ ...configuration });
  const learners = [];
  const checks = [];
  for (let learnerIndex = 0; learnerIndex < config.learners; learnerIndex++) {
    const scenario = createScriptedLearner(config, learnerIndex);
    const harness = await createLearningHarness({ courseId: 'stats-fixture', learnerId: scenario.learnerId, now: scenario.steps[0].at });
    const observations = [];
    const checkpoints = [];
    for (const step of scenario.steps) {
      if (!step.interaction) {
        harness.advanceTo(step.at);
        checkpoints.push({ phase: step.phase, at: step.at, hiddenTruth: step.hiddenTruth,
          states: Object.fromEntries(scenario.targets.map(target => [target.label, stateFor(harness, target, step.at)])) });
        continue;
      }
      const target = scenario.targets.find(value => value.label === step.target);
      const before = stateFor(harness, target, step.at);
      await harness.record(step.interaction.identity, step.interaction.event, step.at);
      const after = stateFor(harness, target, step.at);
      const expectation = expectedStatus(step);
      checks.push({ name: 'scripted-evidence-status', learnerId: scenario.learnerId, phase: step.phase,
        expected: expectation, actual: after.adapter.evidenceStatus, passed: after.adapter.evidenceStatus === expectation });
      observations.push({ phase: step.phase, at: step.at, target: step.target,
        interaction: step.interaction, simulator: step.simulator, hiddenTruth: step.hiddenTruth, before, after });
    }
    const last = scenario.steps.at(-1);
    const final = Object.fromEntries(scenario.targets.map(target => [target.label, stateFor(harness, target, last.at)]));
    await harness.reload();
    const reloaded = Object.fromEntries(scenario.targets.map(target => [target.label, stateFor(harness, target, last.at)]));
    // Compact checkpoint decoding may reorder object keys without changing data.
    checks.push({ name: 'real-storage-reload-parity', learnerId: scenario.learnerId, passed: isDeepStrictEqual(final, reloaded) });
    checkpoints.push({ phase: 'final', at: last.at, hiddenTruth: last.hiddenTruth, states: final });
    for (const checkpoint of checkpoints) {
      const untouched = ['related-unpracticed', 'unseen', ...(checkpoint.phase !== 'final' ? ['reverse'] : [])];
      for (const label of untouched) checks.push({ name: 'no-unassessed-transfer-credit', learnerId: scenario.learnerId,
        phase: checkpoint.phase, target: label, passed: checkpoint.states[label].adapter.evidenceStatus === 'unassessed' });
    }
    learners.push({ learnerId: scenario.learnerId, priorType: scenario.priorType, targets: scenario.targets, observations, checkpoints });
  }
  const states = learners.flatMap(learner => [
    ...learner.observations.map(value => value.after.adapter),
    ...learner.checkpoints.flatMap(checkpoint => Object.values(checkpoint.states).map(value => value.adapter)),
  ]);
  const statuses = Object.fromEntries(['unassessed', 'exposure-only', 'supported', 'independently-assessed'].map(status => [status, 0]));
  for (const state of states) statuses[state.evidenceStatus]++;
  const unsupportedConfidenceClaims = states.filter(state => Object.values(state.estimates).some(value => value !== null)
    || state.uncertainty.independentResponseDenominator !== null || state.readiness.calibrated !== false).length;
  checks.push({ name: 'unsupported-estimates-stay-unavailable', passed: unsupportedConfidenceClaims === 0, violations: unsupportedConfidenceClaims });
  const identityViolations = learners.flatMap(learner => learner.observations).filter(value =>
    identityKey(value.interaction.identity) !== identityKey(value.after.adapter.identity)).length;
  checks.push({ name: 'explicit-identity-preserved', passed: identityViolations === 0, violations: identityViolations });
  const phaseResponses = {};
  for (const { observations } of learners) for (const observation of observations) {
    const row = phaseResponses[observation.phase] ??= { encounters: 0, statusChanges: 0, readinessDeltaTotal: 0,
      independentSuccessDelta: 0, spacedSuccessDelta: 0, reviewDeadlineChanges: 0, intervalDeltaMsTotal: 0 };
    row.encounters++;
    row.statusChanges += Number(observation.before.adapter.evidenceStatus !== observation.after.adapter.evidenceStatus);
    row.readinessDeltaTotal += observation.after.adapter.readiness.value - observation.before.adapter.readiness.value;
    row.independentSuccessDelta += observation.after.adapter.evidence.independentSuccesses - observation.before.adapter.evidence.independentSuccesses;
    row.spacedSuccessDelta += observation.after.adapter.evidence.spacedSuccesses - observation.before.adapter.evidence.spacedSuccesses;
    row.reviewDeadlineChanges += Number(observation.before.adapter.review.dueAt !== observation.after.adapter.review.dueAt);
    row.intervalDeltaMsTotal += observation.after.adapter.review.intervalMs - observation.before.adapter.review.intervalMs;
  }
  const forgetting = learners.map(learner => {
    const before = learner.checkpoints.find(value => value.phase === 'before-gap');
    const after = learner.checkpoints.find(value => value.phase === 'after-gap-before-response');
    return { learnerId: learner.learnerId, syntheticStrengthBefore: before.hiddenTruth.learning,
      syntheticStrengthAfter: after.hiddenTruth.learning,
      readinessBefore: before.states.learning.adapter.readiness.value,
      readinessAfter: after.states.learning.adapter.readiness.value,
      overdueBefore: before.states.learning.adapter.review.overdueMs,
      overdueAfter: after.states.learning.adapter.review.overdueMs };
  });
  let pairs = 0; let concordant = 0; let readinessTies = 0;
  for (const learner of learners) {
    const checkpoint = learner.checkpoints.find(value => value.phase === 'before-gap');
    const labels = Object.keys(checkpoint.states).filter(label => {
      const state = checkpoint.states[label].adapter;
      return state.evidence.independentlyAssessed && state.identity.gameId === 'sound-quasar' && state.identity.bankId === 'words';
    });
    for (let left = 0; left < labels.length; left++) for (let right = left + 1; right < labels.length; right++) {
      const a = labels[left]; const b = labels[right];
      const truthDifference = checkpoint.hiddenTruth[a] - checkpoint.hiddenTruth[b];
      if (truthDifference === 0) continue;
      const readinessDifference = checkpoint.states[a].adapter.readiness.value - checkpoint.states[b].adapter.readiness.value;
      pairs++;
      if (readinessDifference === 0) { readinessTies++; concordant += 0.5; }
      else if (Math.sign(readinessDifference) === Math.sign(truthDifference)) concordant++;
    }
  }
  const unsupportedReason = 'Adapter deliberately returns no calibrated recall/knowledge probability or independent-response denominator; heuristic readiness is not a probability.';
  const result = {
    schemaVersion: 1, evaluator: 'A: learner-state/stats', configuration: config,
    method: { persistence: 'real CaatuuLearning.recordExposure -> retryPendingSaves -> contentHistory',
      estimatorInputs: 'explicit course/game/bank/item/direction + actual public bank history + controlled clock',
      latentTruth: 'synthetic decaying strength; retained only in diagnostics, never given to adapter',
      script: 'fixed coverage interactions plus seeded outcomes; first four learning/forward successes, early errors and one lucky success are forced diagnostics',
      relatedTransfer: 'only related-a -> related-b; gain fraction is configured at 0..0.1; no direction transfer',
      runPolicy: 'manually invoked; no pedagogical pass/fail thresholds' },
    metrics: {
      evidenceStatuses: { samplingUnit: 'post-interaction item states and full-bank checkpoint item states', counts: statuses },
      responseToEvidence: phaseResponses,
      unsupportedConfidence: { inspectedStates: states.length, claims: unsupportedConfidenceClaims },
      readinessDiscrimination: pairs ? { available: true, pairs, readinessTies, concordance: concordant / pairs,
        interpretation: 'Within-learner, pre-gap, independently-assessed listening items; pairwise ordering of heuristic versus synthetic strength, ties count 0.5. Descriptive only.' }
        : unavailable('No comparable independently-assessed item pairs.'),
      recallProbabilityError: unavailable(unsupportedReason),
      knowledgeProbabilityError: unavailable(unsupportedReason),
      probabilityCalibration: unavailable(unsupportedReason),
      independentAccuracyError: unavailable(unsupportedReason),
      historicalErrorProvenance: learners.flatMap(learner => learner.observations
        .filter(observation => observation.phase === 'error-provenance-after-support')
        .map(observation => ({ learnerId: learner.learnerId, scriptedEarlierIndependentError: true,
          retainedIndependentlyAssessed: observation.after.adapter.evidence.independentlyAssessed,
          latestAssessment: observation.after.adapter.evidence.latestAssessment,
          uncertaintyReasons: observation.after.adapter.uncertainty.reasons,
          interpretation: 'Earlier independent error provenance is unavailable after later support; this is a persistence limitation, not missing knowledge or a software-failure metric.' }))),
      forgetting,
    },
    softwareChecks: { passed: checks.every(check => check.passed), count: checks.length, failures: checks.filter(check => !check.passed), checks },
    limitations: [
      'Synthetic strength, priors, guessing, learning and forgetting are scenario assumptions, not validated learner models.',
      'The heuristic is a practice-selection signal; long gaps may increase review overdue time without decreasing readiness.',
      'Public history does not retain a complete independent-response denominator or historical mistake support provenance.',
      'Later unscored support can hide an earlier independent error; retained independentlyAssessed may become false, and latest-assessment support may be unavailable. This is reported as a persistence limitation.',
      'Separate directions are exercised through actual separate banks. Supplying a direction label cannot partition an already mixed bank.',
      'Assistance, exposure and activity counts cannot establish recall; a lucky independent success remains observationally indistinguishable from recall.',
      'Related synthetic exercises have an explicit limited transfer edge. Similarity alone never grants adapter evidence or mastery.',
      'This harness covers controlled storage/reload, not browser rendering, real users, speech/writing transfer or an adaptive sampling policy.',
    ],
    learners,
    semantic: semantic ? await (await import('./semantic-diagnostic.mjs')).runSemanticDiagnostic({ profilesPath, root: repositoryRoot }) : { enabled: false },
  };
  return result;
}

function markdown(result) {
  const metric = result.metrics;
  const rank = metric.readinessDiscrimination;
  const semanticLines = result.semantic.enabled === false
    ? ['Not requested. Run with --semantic to include the shared practice-map diagnostic.']
    : [
      `Status: ${result.semantic.status}. The shared topic map describes practice and independent assessment evidence, not mastery, accuracy or calibrated knowledge.`, '',
      '| Diagnostic | Software check |', '| --- | --- |',
      ...result.semantic.checks.map(check => `| ${check.id} | ${check.passed ? 'passed' : 'FAILED'} |`), '',
      ...Object.entries(result.semantic.metrics).filter(([, value]) => value?.available === false)
        .map(([name, value]) => `- ${name}: unavailable. ${value.reason}`), '',
      ...result.semantic.limitations.map(value => `- ${value}`),
      ...(result.semantic.realProfiles ? ['', 'Real retained profiles were also replayed through the production catalog resolver and pinned embedding engine. Full accounting and input/model hashes are in results.json.', '',
        '| Course | Identities | Matched | Unmatched | English unavailable | Pending | Vector unavailable |', '|---|---:|---:|---:|---:|---:|---:|',
        ...result.semantic.realProfiles.profiles.map(p => `| ${p.courseId} | ${p.accounting.denominator} | ${p.accounting.statuses.matched} | ${p.accounting.statuses.unmatched} | ${p.accounting.statuses['english-unavailable']} | ${p.accounting.statuses.pending} | ${p.accounting.statuses['vector-unavailable']} |`)] : []),
    ];
  return [
    '# Evaluator A: learner-state/stats', '',
    `Seed: ${result.configuration.seed}; learners: ${result.configuration.learners}; rounds: ${result.configuration.rounds}.`, '',
    'Interactions ran through the real CaatuuLearning journal, save retry, public history and learner-state adapter. Hidden synthetic strength was never supplied to the adapter.', '',
    `Software checks: ${result.softwareChecks.passed ? 'passed' : 'FAILED'} (${result.softwareChecks.count} checks, ${result.softwareChecks.failures.length} failures). These are software invariants, not pedagogical release gates.`, '',
    '## Evidence diagnostics', '', '| Status | Observed item snapshots |', '| --- | ---: |',
    ...Object.entries(metric.evidenceStatuses.counts).map(([status, count]) => `| ${status} | ${count} |`), '',
    `Unsupported confidence claims: ${metric.unsupportedConfidence.claims} in ${metric.unsupportedConfidence.inspectedStates} states.`, '',
    '## Response to new evidence', '', '| Script phase | Encounters | Status changes | Readiness delta sum | Independent successes added | Spaced successes added |', '| --- | ---: | ---: | ---: | ---: | ---: |',
    ...Object.entries(metric.responseToEvidence).map(([phase, row]) => `| ${phase} | ${row.encounters} | ${row.statusChanges} | ${row.readinessDeltaTotal.toFixed(4)} | ${row.independentSuccessDelta} | ${row.spacedSuccessDelta} |`), '',
    '## Discrimination and unsupported metrics', '',
    rank.available ? `Descriptive readiness concordance: ${rank.concordance.toFixed(4)} across ${rank.pairs} item pairs (${rank.readinessTies} readiness ties). ${rank.interpretation}` : `Readiness discrimination unavailable: ${rank.reason}`, '',
    'Recall-probability error, knowledge-probability error, probability calibration and independent-accuracy error: **unavailable**. No corresponding probability or trustworthy response denominator is exposed; readiness must not be interpreted as one.', '',
    `Historical error provenance diagnostic: ${metric.historicalErrorProvenance.length} independent-error-then-support scripts. See results.json for retained evidence and uncertainty reasons; unavailable earlier provenance is a persistence limitation.`, '',
    '## Long gap diagnostic', '', '| Learner | Synthetic strength before / after | Readiness before / after | Overdue milliseconds before / after |', '| --- | --- | --- | --- |',
    ...metric.forgetting.map(row => `| ${row.learnerId} | ${row.syntheticStrengthBefore.toFixed(4)} / ${row.syntheticStrengthAfter.toFixed(4)} | ${row.readinessBefore.toFixed(4)} / ${row.readinessAfter.toFixed(4)} | ${row.overdueBefore} / ${row.overdueAfter} |`), '',
    'Readiness can remain unchanged while the synthetic world forgets. Overdue review is an observable timing signal; this evaluator does not claim the adapter estimates forgetting probability.', '',
    '## Limitations', '', ...result.limitations.map(value => `- ${value}`), '',
    '## Optional shared practice-map diagnostic', '',
    ...semanticLines, '',
    ...(result.softwareChecks.failures.length ? ['## Software invariant failures', '', '```json', JSON.stringify(result.softwareChecks.failures, null, 2), '```', ''] : []),
    'Full configuration, source hashes, observations, hidden diagnostic truth and actual adapter outputs are in [results.json](results.json).', '',
  ].join('\n');
}

async function main() {
  const args = argumentsFrom(process.argv.slice(2));
  if (args.help) {
    console.log('node tools/learning-evaluation/stats/run.mjs [--fixture | --config FILE] [--seed N] [--learners N] [--rounds N] [--semantic [--profiles captured.json]] [--name SIMPLE_NAME]');
    return;
  }
  const configPath = args.config ? path.resolve(args.config) : fileURLToPath(new URL(args.fixture ? './fixture.json' : './config.json', import.meta.url));
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  for (const key of ['seed', 'learners', 'rounds']) if (args[key] !== undefined) config[key] = args[key];
  validateConfiguration(config);
  const result = await evaluateStats(config, { semantic: args.semantic, profilesPath: args.profiles });
  const sources = ['apps/language-runtime/static/source/learning-profile.js', 'apps/language-runtime/static/source/learner-state.mjs',
    'apps/language-runtime/static/source/games/content-progression.mjs', 'apps/language-runtime/tests/helpers/fake-browser.mjs',
    'tools/learning-evaluation/stats/harness.mjs', 'tools/learning-evaluation/stats/scenarios.mjs', 'tools/learning-evaluation/stats/run.mjs'];
  if (args.semantic) sources.push('tools/learning-evaluation/stats/semantic-diagnostic.mjs',
    'apps/language-runtime/static/source/practice-compass.mjs', 'apps/languages/catalog.json');
  if (args.profiles) sources.push('tools/learning-evaluation/shared/mapping-audit.mjs', 'tools/learning-evaluation/shared/semantic-cache.mjs');
  result.sourceHashes = Object.fromEntries(await Promise.all(sources.map(async source =>
    [source, createHash('sha256').update(await readFile(path.join(repositoryRoot, source))).digest('hex')])));
  const fingerprint = createHash('sha256').update(JSON.stringify({ config, semantic: args.semantic, sources: result.sourceHashes })).digest('hex').slice(0, 12);
  const name = args.name ?? `${args.fixture ? 'fixture' : 'run'}-${config.seed}-${fingerprint}`;
  // Inspect each existing ancestor before creating anything; no output through symlinks/junctions.
  let ancestor = path.resolve(repositoryRoot);
  for (const segment of ['artifacts', 'learning-evaluation', 'stats']) {
    ancestor = path.join(ancestor, segment);
    const stat = await lstat(ancestor).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (stat?.isSymbolicLink() || (stat && !stat.isDirectory())) throw new Error('Artifact ancestors must be real directories.');
    if (!stat) await mkdir(ancestor);
  }
  const resolvedRoot = await realpath(artifactRoot);
  if (resolvedRoot !== path.resolve(artifactRoot)) throw new Error('Artifact root must not redirect to another directory.');
  const outputDirectory = path.join(resolvedRoot, name);
  await mkdir(outputDirectory); // Never overwrite another evaluator run, including a symlink.
  if (await realpath(outputDirectory) !== outputDirectory) throw new Error('Run output must stay in the stats artifact root.');
  await writeFile(path.join(outputDirectory, 'results.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  await writeFile(path.join(outputDirectory, 'report.md'), markdown(result), 'utf8');
  console.log(JSON.stringify({ outputDirectory, softwareChecks: { passed: result.softwareChecks.passed, count: result.softwareChecks.count },
    unsupportedConfidenceClaims: result.metrics.unsupportedConfidence.claims, readinessDiscrimination: result.metrics.readinessDiscrimination,
    semanticStatus: result.semantic.status ?? 'not-requested' }, null, 2));
  if (!result.softwareChecks.passed || result.semantic.status === 'failed') process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
}
