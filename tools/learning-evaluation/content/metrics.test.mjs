import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { buildEvaluationCorpus } from '../shared/corpus.mjs';
import { fixtureCatalogs } from './fixture.mjs';
import { categoryDistribution, gradeDistribution, inspectMetadata, inspectSemantics, numericSummary, selectSemanticDocuments } from './metrics.mjs';
import { parseArgs, validateConfig } from './run.mjs';
import { renderReport } from './report.mjs';

const config = JSON.parse(await readFile(new URL('./config.json', import.meta.url)));
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
const row = (id, documentId, complexity, extra = {}) => ({ id, courseId: 'a', gameId: 'verbs', bankId: 'bank', itemId: id,
  kind: 'lexeme', recordRole: 'leaf', metadata: { complexity, usefulness: 50, difficulty: complexity > 50 ? 3 : 1 },
  english: { text: documentId, field: 'english', reason: null }, categories: { topic: ['movement'] }, translation: {}, semanticDocumentId: documentId, ...extra });

test('grade summaries separate missing and invalid authoring; no numeric-string coercion', () => {
  const result = gradeDistribution([1, 100, null, '90', 0, 101, 2.5].map(complexity => ({ metadata: { complexity } })), 'complexity');
  assert.equal(result.total, 7);
  assert.equal(result.count, 2);
  assert.equal(result.missing, 1);
  assert.equal(result.invalid, 4);
  assert.equal(result.mean, 50.5);
  assert.equal(result.histogram['1-10'], 1);
  assert.equal(result.histogram['91-100'], 1);
  assert.equal(numericSummary([]).mean, null);
});

test('category concentration uses explicit tag occurrences and does not count duplicate tags twice', () => {
  const result = categoryDistribution([
    { categories: { topic: ['cat', 'cat', 'dog'] } }, { categories: { topic: ['cat'] } }, { categories: { topic: ['cat'] } }, { categories: {} }
  ]).topic;
  assert.deepEqual(result.counts, { cat: 3, dog: 1 });
  assert.equal(result.taggedRecords, 3);
  assert.equal(result.missing, 1);
  close(result.concentrationHHI, .625);
  close(result.effectiveCategories, Math.exp(-.75 * Math.log(.75) - .25 * Math.log(.25)));
});

test('seeded inspection is order invariant, bounded, nested by budget, and does not mutate input', () => {
  const docs = Array.from({ length: 30 }, (_, i) => ({ id: `doc-${i}`, englishText: `text ${i}` }));
  const before = structuredClone(docs);
  const small = selectSemanticDocuments(docs, { seed: 'one', maxDocuments: 5 });
  assert.deepEqual(small, selectSemanticDocuments([...docs].reverse(), { seed: 'one', maxDocuments: 5 }));
  assert.deepEqual(small, selectSemanticDocuments(docs, { seed: 'one', maxDocuments: 10 }).slice(0, 5));
  assert.notDeepEqual(small, selectSemanticDocuments(docs, { seed: 'two', maxDocuments: 5 }));
  assert.deepEqual(docs, before);
  assert.deepEqual(selectSemanticDocuments(docs, { seed: 'one', maxDocuments: 0 }), []);
});

test('kind counts follow authored references and unavailable banks remain explicitly incomplete', () => {
  const corpus = buildEvaluationCorpus(fixtureCatalogs);
  const result = inspectMetadata(corpus, config.diagnostics);
  const lexemes = result.groups.filter(group => group.scope.kind === 'lexeme');
  assert.equal(lexemes.reduce((sum, group) => sum + group.playableAssessmentUnits, 0), 5);
  assert.equal(result.overall.playableCountComplete, false);
  assert.equal(result.overall.unavailablePlayableBanks, 2);
  assert.equal(result.referenceCoverage.status, 'not-assessed');
  assert.ok(result.exactDuplicates.documentGroups > 0);
});

test('English text rejected by semantic guard is distinct from absent authoring', () => {
  const corpus = { records: ['x', 'y'].map(id => row(id, null, 10, { english: { text: 'café', field: 'english', reason: null } })), playableUnits: [], documents: [], adapters: [] };
  const result = inspectMetadata(corpus, config.diagnostics);
  assert.equal(result.overall.missingEnglish, 0);
  assert.equal(result.overall.semanticInputRejected, 2);
  assert.equal(result.exactDuplicates.documentGroups, 1);
  assert.equal(result.exactDuplicates.examples[0].documentId, null);
  assert.equal(result.exactDuplicates.examples[0].englishText, 'café');
});

test('gaps and explicit reference coverage never invent topics or cross bank boundaries', () => {
  const records = [row('a', 'one', 5), row('b', 'two', 95), row('c', 'three', 50, { bankId: 'other' })];
  const corpus = { records, playableUnits: [], documents: [], adapters: [] };
  const result = inspectMetadata(corpus, config.diagnostics, { field: 'topic', expected: ['movement', 'food'], bankId: 'bank' });
  assert.ok(result.progressionGaps.examples.every(gap => gap.gap === 90 && gap.bankId === 'bank' && gap.label === 'diagnostic candidate'));
  assert.deepEqual(result.referenceCoverage.missing, ['food']);
  assert.equal(result.referenceCoverage.records, 2);
});

test('known vector geometry yields exact concentration, dispersion and sample-neighbor distances', () => {
  const records = [row('a', 'A', 10), row('b', 'B', 20), row('c', 'C', 30)];
  const corpus = { records, documents: records.map(record => ({ id: record.semanticDocumentId, englishText: record.semanticDocumentId, recordIds: [record.id] })) };
  const result = inspectSemantics(corpus, [{ id: 'A', vector: [1, 0] }, { id: 'B', vector: [-1, 0] }, { id: 'C', vector: [0, 1] }], config);
  assert.equal(result.pairComparisons, 3);
  close(result.meanPairCosine, -1 / 3);
  close(result.centroidNormSquared, 1 / 9);
  close(result.meanCosineDistanceToCentroid, 2 / 3);
  assert.equal(result.nearestNeighborDistance.median, 1);
  assert.equal(result.isolatedAtInspectionThreshold, 3);
  assert.equal(result.nearPairCount, 0);
});

test('semantic related spreads stay within learner course/game/bank/kind and preserve text identities', () => {
  const records = [row('a', 'A', 10), row('b', 'B', 20), row('different-course', 'B', 99, { courseId: 'other' })];
  const corpus = { records, documents: [{ id: 'A', englishText: 'walk', recordIds: ['a'] }, { id: 'B', englishText: 'run', recordIds: ['b', 'different-course'] }] };
  const result = inspectSemantics(corpus, [{ id: 'A', vector: [1, 0] }, { id: 'B', vector: [.8, .6] }], config);
  assert.equal(result.relatedPairScopes, 1);
  assert.equal(result.relatedSpreadExamples[0].complexitySpread, 10);
  assert.equal(result.relatedGapCandidates.count, 0);
  assert.equal(result.coverageByBank.find(group => group.courseId === 'other').inspected, 1);
});

test('empty, singleton, zero-centroid and malformed vector inputs remain interpretable', () => {
  const records = [row('a', 'A', 10), row('b', 'B', 20)];
  const corpus = { records, documents: records.map(record => ({ id: record.semanticDocumentId, englishText: record.semanticDocumentId, recordIds: [record.id] })) };
  const empty = inspectSemantics(corpus, [], config);
  assert.equal(empty.meanPairCosine, null);
  assert.equal(empty.centroidNormSquared, null);
  assert.equal(empty.nearestNeighborDistance.count, 0);
  assert.equal(inspectSemantics(corpus, [{ id: 'A', vector: [1, 0] }], config).isolatedAtInspectionThreshold, null);
  assert.equal(inspectSemantics(corpus, [{ id: 'A', vector: [1, 0] }, { id: 'B', vector: [-1, 0] }], config).meanCosineDistanceToCentroid, null);
  assert.throws(() => inspectSemantics(corpus, [{ id: 'A', vector: [2, 0] }], config), /unit vectors/);
  assert.throws(() => inspectSemantics(corpus, [{ id: 'unknown', vector: [1, 0] }], config), /Unknown semantic/);
});

test('configuration and CLI reject silent typos, unsafe sizes and ambiguous repeated options', () => {
  assert.deepEqual(validateConfig(structuredClone(config)), config);
  assert.deepEqual(parseArgs(['--fixture', '--max-documents', '12']), { '--fixture': true, '--max-documents': '12' });
  assert.throws(() => parseArgs(['--seed']), /Missing value/);
  assert.throws(() => parseArgs(['--seed', 'a', '--seed', 'b']), /Repeated/);
  assert.throws(() => parseArgs(['--typo']), /Unknown/);
  assert.throws(() => validateConfig({ ...config, accidental: true }), /unknown/);
  assert.throws(() => validateConfig({ ...config, semantic: { ...config.semantic, maxDocuments: -1 } }), /Invalid/);
});

test('Markdown reports disclose incomplete totals and missing reference instead of presenting a quality score', () => {
  const corpus = buildEvaluationCorpus(fixtureCatalogs);
  const metadata = inspectMetadata(corpus, config.diagnostics);
  const report = renderReport({ metadata, semantic: { status: 'disabled', eligibleDocuments: corpus.documents.length, selectedDocuments: 0, outsideInspectionBudget: corpus.documents.length },
    run: { id: 'fixture', config, fixture: true, command: 'node run.mjs --fixture --no-semantic' }, sources: [], findings: corpus.findings, findingCounts: {} });
  assert.match(report, /incomplete: 2 banks unavailable/);
  assert.match(report, /No explicit reference supplied/);
  assert.match(report, /No aggregate course-quality score/);
});
