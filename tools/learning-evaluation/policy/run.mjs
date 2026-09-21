#!/usr/bin/env node
import { readFile, writeFile, mkdir, realpath, open } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const help = `Manual sampling-policy evaluator (run in existing caatuu-dev at /workspace).
  node tools/learning-evaluation/policy/run.mjs [options]
  --config PATH                 JSON configuration (default: adjacent config.json)
  --fixture PATH                JSON fixture (default: adjacent fixture.json)
  --seeds 17,29                 Paired unique integer seeds
  --interactions 120            Interactions per run
  --profiles ID,ID              Selected fixture learner profiles
  --goals ID,ID                 Selected fixture goals
  --delay-days 7                No-practice retention delay
  --production-adapter PATH     Module delegating to the actual production policy
  --assert-baseline PATH        Require unchanged configuration and complete runs
  --study PATH                  Manual staged study JSON (no default test registration)
  --freeze-from PATH            Screen results to freeze, with --study held-out plan
  --variants ID,ID              Coordinator-selected 2-3 screened variants for freeze
  --freeze PATH                 Pre-outcome freeze required to execute held-out study
  --out NAME                    Report folder under artifacts/learning-evaluation/policy/
  --help                        Show usage
Absent the real production adapter, its comparison is explicitly pending.`;

function args(argv) {
  const allowed = new Set(['config', 'fixture', 'seeds', 'interactions', 'profiles', 'goals', 'delay-days', 'production-adapter', 'out',
    'assert-baseline', 'study', 'freeze-from', 'variants', 'freeze']);
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--help') return { help: true };
    const key = argv[i].slice(2);
    if (!argv[i].startsWith('--') || !allowed.has(key) || Object.hasOwn(options, key)
        || !argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error(`Invalid option: ${argv[i]}`);
    options[key] = argv[++i];
  }
  return options;
}
const git = (...argv) => execFileSync('git', ['-c', `safe.directory=${root}`, ...argv], { cwd: root, encoding: 'utf8' }).trim();
async function checkWriteBoundary(output) {
  if (await realpath(root) !== '/workspace' || await realpath(process.cwd()) !== await realpath(root)
      || git('rev-parse', '--show-toplevel') !== '/workspace') throw new Error('Run from the canonical container checkout /workspace.');
  if (git('branch', '--show-current') !== 'main'
      || git('for-each-ref', '--format=%(refname)', 'refs/heads') !== 'refs/heads/main'
      || git('for-each-ref', '--format=%(refname)', 'refs/remotes').split('\n').filter(Boolean)
        .some(ref => !/^refs\/remotes\/[^/]+\/(main|HEAD)$/.test(ref))) throw new Error('Main-only repository policy check failed.');
  // Reject existing symlinked output ancestry before writing outside the artifact boundary.
  let ancestor = output;
  while (true) {
    try {
      if (await realpath(ancestor) !== ancestor) throw new Error('Symlinked artifact output is not supported.');
      break;
    } catch (error) { if (error.code !== 'ENOENT') throw error; ancestor = dirname(ancestor); }
  }
  for (const name of ['results.json', 'report.md']) {
    try { if (await realpath(resolve(output, name)) !== resolve(output, name)) throw new Error('Symlinked report file is not supported.'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  git('check-ignore', relative(root, resolve(output, 'results.json')));
}

const hashFile = async path => createHash('sha256').update(await readFile(path)).digest('hex');

/** Keep detailed studies below the JS single-string limit; each run is a chunk. */
export function* resultJsonChunks(result) {
  yield '{\n';
  let separator = '';
  for (const [key, value] of Object.entries(result)) {
    if (value === undefined) continue;
    yield `${separator}${JSON.stringify(key)}:`;
    if (Array.isArray(value)) {
      yield '[';
      for (let index = 0; index < value.length; index++) yield `${index ? ',\n' : '\n'}${JSON.stringify(value[index])}`;
      yield '\n]';
    } else yield JSON.stringify(value);
    separator = ',\n';
  }
  yield '\n}\n';
}

async function writeResultJson(path, result) {
  const file = await open(path, 'w');
  try { for (const chunk of resultJsonChunks(result)) await file.write(chunk); }
  finally { await file.close(); }
}

async function studyMain(options) {
  if (Object.keys(options).some(key => !['study', 'freeze-from', 'variants', 'freeze', 'out'].includes(key))) throw new Error('Study runs use their frozen configuration; ordinary overrides are not accepted.');
  const studyPath = resolve(options.study);
  const proposedPlan = JSON.parse(await readFile(studyPath, 'utf8'));
  const name = options.out || `investigation-${proposedPlan.phase}`;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(name)) throw new Error('--out must be a simple folder name.');
  const output = resolve(root, 'artifacts/learning-evaluation/policy', name);
  await checkWriteBoundary(output);
  const { runStudy, freezeStudy, applyFreeze, renderStudyMarkdown, validateStudy } = await import('./study.mjs');
  validateStudy(proposedPlan, { allowUnfrozen: Boolean(options['freeze-from'] || options.freeze) });
  const sources = ['run.mjs','runner.mjs','policies.mjs','environment.mjs','evidence.mjs','random.mjs','report.mjs',
    'observable.mjs','diagnostics.mjs','study.mjs','config.json','fixture.json','studies/heldout-fixture.json']
    .map(file => resolve(here, file));
  sources.push(studyPath, ...[
    'tools/learning-evaluation/production-policy.mjs', 'tools/learning-evaluation/stats/harness.mjs',
    'apps/language-runtime/tests/helpers/fake-browser.mjs', 'apps/language-runtime/static/source/learning-profile.js',
    'apps/language-runtime/static/source/learner-state.mjs', 'apps/language-runtime/static/source/games/adaptive-sampling.mjs',
    'apps/language-runtime/static/source/games/content-progression.mjs'
  ].map(file => resolve(root, file)));
  const sourceSha256 = Object.fromEntries(await Promise.all([...new Set(sources)].map(async file => [relative(root, file), await hashFile(file)])));
  const provenance = { node: process.version, gitHead: git('rev-parse', 'HEAD'), sourceSha256,
    commandArguments: process.argv.slice(2), localSourceState: 'Exact file hashes include uncommitted source; Git HEAD alone is insufficient.' };
  let result;
  if (options['freeze-from']) {
    if (options.freeze || !options.variants) throw new Error('Freeze creation needs --variants and cannot also execute --freeze.');
    const screen = JSON.parse(await readFile(resolve(options['freeze-from']), 'utf8'));
    result = freezeStudy({ proposedPlan, screen, selectedIds: options.variants.split(','), provenance, createdAt: new Date().toISOString() });
  } else {
    if (options.variants) throw new Error('--variants is only for freeze creation.');
    const frozen = options.freeze ? JSON.parse(await readFile(resolve(options.freeze), 'utf8')) : null;
    if (proposedPlan.phase === 'heldout' && !frozen) throw new Error('Held-out execution requires a previously saved --freeze record.');
    if (proposedPlan.phase === 'screen' && frozen) throw new Error('Development screen does not consume a held-out freeze.');
    const plan = frozen ? applyFreeze(proposedPlan, frozen, provenance) : proposedPlan;
    const baseConfig = JSON.parse(await readFile(resolve(here, 'config.json'), 'utf8'));
    const fixtures = { original: JSON.parse(await readFile(resolve(here, 'fixture.json'), 'utf8')),
      heldout: JSON.parse(await readFile(resolve(here, 'studies/heldout-fixture.json'), 'utf8')) };
    result = await runStudy({ plan, baseConfig, fixtures, onProgress: progress => console.log(JSON.stringify(progress)) });
    result.provenance = provenance;
    if (frozen) result.freeze = frozen;
  }
  for (const [file, hash] of Object.entries(sourceSha256)) if (await hashFile(resolve(root, file)) !== hash) throw new Error(`Source changed during study: ${file}.`);
  await checkWriteBoundary(output);
  await mkdir(output, { recursive: true });
  await writeResultJson(resolve(output, 'results.json'), result);
  await writeFile(resolve(output, 'report.md'), renderStudyMarkdown(result));
  console.log(JSON.stringify({ kind: result.kind, runs: result.runs?.length || 0, output: relative(root, output) }));
}

export async function main(argv = process.argv.slice(2)) {
  const options = args(argv);
  if (options.help) { console.log(help); return; }
  if (options.study) return studyMain(options);
  if (options.freeze || options['freeze-from'] || options.variants) throw new Error('Freeze options require --study.');
  const configPath = resolve(options.config || resolve(here, 'config.json'));
  const fixturePath = resolve(options.fixture || resolve(here, 'fixture.json'));
  const configBytes = await readFile(configPath);
  const fixtureBytes = await readFile(fixturePath);
  const config = JSON.parse(configBytes.toString('utf8'));
  const fixture = JSON.parse(fixtureBytes.toString('utf8'));
  for (const key of ['seeds', 'profiles', 'goals']) if (options[key]) {
    const values = options[key].split(',');
    if (values.some(value => !value.trim())) throw new Error(`Empty --${key} value.`);
    config[key] = key === 'seeds' ? values.map(Number) : values;
  }
  if (options.interactions) config.interactions = Number(options.interactions);
  if (options['delay-days']) config.delayDays = Number(options['delay-days']);
  const name = options.out || 'default';
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(name)) throw new Error('--out must be a simple folder name.');
  const output = resolve(root, 'artifacts/learning-evaluation/policy', name);
  await checkWriteBoundary(output);
  const [{ runEvaluation }, { baselinePolicies, loadProductionPolicy }, { renderMarkdown }] = await Promise.all([
    import('./runner.mjs'), import('./policies.mjs'), import('./report.mjs'),
  ]);
  const policies = baselinePolicies();
  if (options['production-adapter']) policies.push(await loadProductionPolicy(options['production-adapter']));
  const sourceFiles = ['run.mjs', 'runner.mjs', 'policies.mjs', 'environment.mjs', 'evidence.mjs', 'random.mjs', 'report.mjs', 'diagnostics.mjs'].map(name => resolve(here, name));
  sourceFiles.push(resolve(root, 'apps/language-runtime/static/source/games/content-progression.mjs'), configPath, fixturePath);
  if (config.stateMode === 'observable-real') sourceFiles.push(...[
    'tools/learning-evaluation/policy/observable.mjs', 'tools/learning-evaluation/stats/harness.mjs',
    'apps/language-runtime/tests/helpers/fake-browser.mjs', 'apps/language-runtime/static/source/learning-profile.js',
    'apps/language-runtime/static/source/learner-state.mjs'
  ].map(file => resolve(root, file)));
  if (options['production-adapter']) sourceFiles.push(resolve(options['production-adapter']));
  for (const policy of policies) for (const source of policy.sourceFiles || []) {
    const file = resolve(root, source);
    const relativeFile = relative(root, file);
    if (!relativeFile || relativeFile.startsWith('..') || relativeFile.startsWith('/')) {
      throw new Error('Production policy source provenance must stay within the repository.');
    }
    if (!sourceFiles.includes(file)) sourceFiles.push(file);
  }
  const hashes = {};
  for (const path of sourceFiles) hashes[relative(root, path)] = createHash('sha256').update(await readFile(path)).digest('hex');
  hashes[relative(root, configPath)] = createHash('sha256').update(configBytes).digest('hex');
  hashes[relative(root, fixturePath)] = createHash('sha256').update(fixtureBytes).digest('hex');
  // Check declared executable dependency hashes again after the simulation.
  const result = await runEvaluation({ config, fixture, policies });
  if (options['assert-baseline']) {
    const baseline = JSON.parse(await readFile(resolve(options['assert-baseline']), 'utf8'));
    if (JSON.stringify(result.configuration) !== JSON.stringify(baseline.configuration)
        || JSON.stringify(result.runs) !== JSON.stringify(baseline.runs)) throw new Error('Baseline configuration or complete outcomes changed.');
    result.baselineReproduction = { source: options['assert-baseline'], runs: result.runs.length, exactConfigurationAndRunEquality: true,
      sha256: await hashFile(resolve(options['assert-baseline'])) };
  }
  result.provenance = { node: process.version, gitHead: git('rev-parse', 'HEAD'), sourceSha256: hashes,
    commandArguments: process.argv.slice(2), adapterDependencyNote: 'Source hashes include implementation dependencies explicitly declared by policyMetadata.sourceFiles; additional custom imports must be declared by their adapter.' };
  for (const path of sourceFiles) if (createHash('sha256').update(await readFile(path)).digest('hex') !== hashes[relative(root, path)]) {
    throw new Error(`Source changed during evaluation: ${relative(root, path)}. Rerun after coordination.`);
  }
  await checkWriteBoundary(output);
  await mkdir(output, { recursive: true });
  await writeResultJson(resolve(output, 'results.json'), result);
  await writeFile(resolve(output, 'report.md'), renderMarkdown(result));
  console.log(JSON.stringify({ runs: result.runs.length, policies: result.policies.map(({ id, status }) => ({ id, status })),
    output: relative(root, output) }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
}
