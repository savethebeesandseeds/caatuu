#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildEvaluationCorpus, loadEvaluationCorpus } from '../shared/corpus.mjs';
import { createSemanticCache, loadPinnedSemanticModel } from '../shared/semantic-cache.mjs';
import { inspectMetadata, inspectSemantics, selectSemanticDocuments } from './metrics.mjs';
import { renderReport } from './report.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

export function validateConfig(config) {
  const keys = (value, expected, label) => {
    assert.ok(value && typeof value === 'object' && !Array.isArray(value), `${label}: expected object`);
    assert.deepEqual(Object.keys(value).sort(), [...expected].sort(), `${label}: unknown or missing setting`);
  };
  keys(config, ['schemaVersion', 'seed', 'courses', 'semantic', 'diagnostics'], 'config');
  keys(config.semantic, ['mode', 'maxDocuments', 'batchSize', 'nearSimilarity'], 'semantic');
  keys(config.diagnostics, ['complexityGap', 'difficultyGap', 'exampleLimit'], 'diagnostics');
  assert.equal(config.schemaVersion, 1);
  assert.ok(typeof config.seed === 'string' && config.seed.length > 0);
  assert.ok(Array.isArray(config.courses) && config.courses.every(id => typeof id === 'string' && /^[a-z][a-z0-9-]*$/.test(id)));
  assert.ok(['embed', 'off'].includes(config.semantic.mode));
  for (const [value, min, max, label] of [
    [config.semantic.maxDocuments, 0, 4096, 'maxDocuments'], [config.semantic.batchSize, 1, 256, 'batchSize'],
    [config.diagnostics.exampleLimit, 0, 1000, 'exampleLimit'], [config.diagnostics.complexityGap, 1, 99, 'complexityGap'],
    [config.diagnostics.difficultyGap, 1, 2, 'difficultyGap']
  ]) assert.ok(Number.isInteger(value) && value >= min && value <= max, `Invalid ${label}`);
  assert.ok(typeof config.semantic.nearSimilarity === 'number' && config.semantic.nearSimilarity >= -1 && config.semantic.nearSimilarity <= 1);
  return config;
}

export function parseArgs(argv) {
  const options = {};
  const flags = new Set(['--fixture', '--no-semantic', '--help', '--mapping-audit']);
  const values = new Set(['--config', '--output', '--seed', '--max-documents', '--courses', '--reference', '--profiles']);
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    assert.ok(flags.has(key) || values.has(key), `Unknown option ${key}`);
    assert.ok(!Object.hasOwn(options, key), `Repeated option ${key}`);
    if (flags.has(key)) options[key] = true;
    else {
      assert.ok(argv[i + 1] && !argv[i + 1].startsWith('--'), `Missing value for ${key}`);
      options[key] = argv[++i];
    }
  }
  return options;
}

function verifyWorkspace() {
  assert.equal(path.resolve(root), '/workspace', 'Run only in the existing caatuu-dev container mounted at /workspace');
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  assert.equal(git('rev-parse', '--show-toplevel'), '/workspace');
  assert.equal(git('branch', '--show-current'), 'main');
  assert.equal(git('for-each-ref', '--format=%(refname)', 'refs/heads'), 'refs/heads/main');
  for (const ref of git('for-each-ref', '--format=%(refname) %(symref)', 'refs/remotes').split('\n').filter(Boolean)) {
    const [name, symbolic] = ref.trim().split(/\s+/);
    assert.ok(symbolic || /^refs\/remotes\/[^/]+\/main$/.test(name), `Non-main remote ref: ${name}`);
  }
  return git('rev-parse', 'HEAD');
}

async function outputDirectory(relative) {
  const allowed = path.resolve(root, 'artifacts/learning-evaluation/content');
  const output = path.resolve(root, relative);
  assert.ok(output.startsWith(allowed + path.sep), 'Reports must be in a new child of artifacts/learning-evaluation/content/');
  // Check existing ancestors before mkdir so symlinks cannot escape the allowed output.
  for (let current = path.dirname(output); current.startsWith(root) && current !== root; current = path.dirname(current)) {
    try { assert.equal(await realpath(current), current, 'Output ancestor must not be a symlink'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  await mkdir(path.dirname(output), { recursive: true });
  await mkdir(output); // Existing reports are never overwritten.
  return output;
}

export async function run(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options['--help']) {
    console.log('node tools/learning-evaluation/content/run.mjs [--fixture] [--no-semantic] [--config file.json] [--seed text] [--max-documents N] [--courses cz,es-en] [--reference file.json] [--output artifacts/learning-evaluation/content/new-run]');
    console.log('Mapping mode: --mapping-audit --profiles captured.json [--config mapping-config.json] [--reference baseline-results.json] [--output new-run-directory]');
    return null;
  }
  const gitHead = verifyWorkspace();
  if (options['--mapping-audit']) {
    const { runMappingAudit } = await import('./mapping-audit.mjs');
    return runMappingAudit({ root, options, argv, gitHead, outputDirectory, verifyWorkspace });
  }
  const configPath = path.resolve(root, options['--config'] || 'tools/learning-evaluation/content/config.json');
  const configBytes = await readFile(configPath);
  const config = JSON.parse(configBytes);
  if (options['--seed']) config.seed = options['--seed'];
  if (options['--courses']) config.courses = options['--courses'].split(',');
  if (options['--max-documents']) config.semantic.maxDocuments = Number(options['--max-documents']);
  if (options['--no-semantic']) config.semantic.mode = 'off';
  validateConfig(config);
  let reference = null;
  const extraSources = [{ path: path.relative(root, configPath), sha256: hash(configBytes) }];
  if (options['--reference']) {
    const referencePath = path.resolve(root, options['--reference']);
    const bytes = await readFile(referencePath);
    reference = JSON.parse(bytes);
    assert.ok(typeof reference.field === 'string' && reference.field && Array.isArray(reference.expected) && reference.expected.every(v => typeof v === 'string' && v));
    assert.ok(Object.keys(reference).every(key => ['field', 'expected', 'courseId', 'gameId', 'bankId'].includes(key)), 'Unknown reference field');
    for (const key of ['courseId', 'gameId', 'bankId']) assert.ok(reference[key] === undefined || typeof reference[key] === 'string' && reference[key]);
    extraSources.push({ path: path.relative(root, referencePath), sha256: hash(bytes) });
  }
  let corpus;
  if (options['--fixture']) {
    const { fixtureCatalogs } = await import('./fixture.mjs');
    corpus = buildEvaluationCorpus(fixtureCatalogs, { courses: config.courses });
    extraSources.push({ path: 'tools/learning-evaluation/content/fixture.mjs', sha256: hash(await readFile(new URL('./fixture.mjs', import.meta.url))) });
  } else corpus = await loadEvaluationCorpus({ root, courses: config.courses });
  const metadata = inspectMetadata(corpus, config.diagnostics, reference);
  const selected = config.semantic.mode === 'off' ? [] : selectSemanticDocuments(corpus.documents, { seed: config.seed, maxDocuments: config.semantic.maxDocuments });
  const semantic = { status: config.semantic.mode === 'off' ? 'disabled' : 'pending', eligibleDocuments: corpus.documents.length,
    selectedDocuments: selected.length, selectedDocumentIds: selected.map(row => row.id), outsideInspectionBudget: corpus.documents.length - selected.length,
    strategy: 'sha256-seed-and-document-id-priority-without-replacement-v1', modelSignature: null, skipped: [],
    excludedAuthoredRecords: { missingEnglish: metadata.overall.missingEnglish, reasons: metadata.overall.missingEnglishReasons, semanticInputRejected: metadata.overall.semanticInputRejected } };
  let cache;
  if (config.semantic.mode !== 'off') {
    try {
      const model = await loadPinnedSemanticModel({ root });
      semantic.modelSignature = model.signature;
      cache = await createSemanticCache({ root, directory: path.join(root, 'artifacts/learning-evaluation/content/cache'), model, batchSize: config.semantic.batchSize });
      const embeddings = await cache.embed(selected);
      semantic.cacheStats = embeddings.stats;
      semantic.skipped = embeddings.skipped;
      semantic.metrics = inspectSemantics(corpus, embeddings.rows, config);
      semantic.status = 'completed';
    } catch (error) {
      semantic.status = 'blocked';
      semantic.error = error.message;
      semantic.cacheStats = cache?.stats();
    } finally { await cache?.dispose(); }
  }
  const findings = [...corpus.findings];
  const findingCounts = {};
  for (const finding of findings) findingCounts[finding.code] = (findingCounts[finding.code] || 0) + 1;
  const implementationSources = [];
  for (const relative of ['content/run.mjs', 'content/metrics.mjs', 'content/report.mjs', 'shared/corpus.mjs', 'shared/semantic-cache.mjs']) {
    const file = `tools/learning-evaluation/${relative}`;
    implementationSources.push({ path: file, sha256: hash(await readFile(path.join(root, file))) });
  }
  const id = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-') + `-${process.pid}`;
  const sources = [...new Map([...corpus.sources, ...extraSources, ...implementationSources].map(row => [row.path, row])).values()].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const result = { schemaVersion: 1, evaluator: 'content', run: { id, gitHead, fixture: Boolean(options['--fixture']), config,
    configSha256: hash(JSON.stringify(config)), command: ['node', 'tools/learning-evaluation/content/run.mjs', ...argv].map(part => JSON.stringify(part)).join(' ') },
    sources, adapters: corpus.adapters, metadata, semantic, findings, findingCounts };
  verifyWorkspace();
  const output = await outputDirectory(options['--output'] || `artifacts/learning-evaluation/content/${id}`);
  await writeFile(path.join(output, 'corpus.json'), JSON.stringify(corpus, null, 2) + '\n', { flag: 'wx' });
  await writeFile(path.join(output, 'results.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  await writeFile(path.join(output, 'report.md'), renderReport(result), { flag: 'wx' });
  console.log(JSON.stringify({ output: path.relative(root, output), authored: metadata.overall.authoredRecords, playable: metadata.overall.playableAssessmentUnits,
    semanticDocuments: metadata.overall.semanticDocuments, semanticStatus: semantic.status, cache: semantic.cacheStats, findings: findingCounts }));
  if (semantic.status === 'blocked') process.exitCode = 1;
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  run().catch(error => { console.error(error.stack); process.exitCode = 1; });
}
