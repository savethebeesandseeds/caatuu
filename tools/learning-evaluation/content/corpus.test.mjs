import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { buildEvaluationCorpus, englishAuthority } from '../shared/corpus.mjs';
import { fixtureCatalogs } from './fixture.mjs';

test('playable corpus covers every exact band of the real Case and Grammar banks once', async () => {
  const read = async path => JSON.parse(await readFile(new URL(`../../../${path}`, import.meta.url), 'utf8'));
  const course = await read('apps/languages/czech/course.json');
  const catalogs = await Promise.all([
    ['caseCosmosCatalog', 'case-cosmos'], ['grammarGravityCatalog', 'grammar-gravity']
  ].map(async ([resource, game]) => ({ course, resource, game,
    path: course.resources[resource].path, document: await read(course.resources[resource].path) })));
  const corpus = buildEvaluationCorpus(catalogs);
  assert.ok(corpus.adapters.every(adapter => adapter.status === 'ok'), JSON.stringify(corpus.adapters));
  assert.equal(new Set(corpus.playableUnits.map(unit => unit.id)).size, corpus.playableUnits.length);
  for (const kind of ['case-context', 'agreement-example']) {
    const records = corpus.records.filter(record => record.kind === kind);
    const units = corpus.playableUnits.filter(unit => unit.kind === kind);
    assert.ok(records.length > 0);
    assert.deepEqual([...new Set(units.map(unit => unit.metadata.difficulty))].sort(), [1, 2, 3]);
    assert.deepEqual(units.flatMap(unit => unit.recordIds).sort(), records.map(record => record.id).sort());
  }
});

test('authoring traversal, static playable units, and English documents remain distinct', () => {
  const corpus = buildEvaluationCorpus(fixtureCatalogs);
  assert.equal(corpus.records.length, 16);
  assert.equal(corpus.playableUnits.length, 7);
  assert.equal(corpus.documents.length, 10);
  const verbs = corpus.playableUnits.filter(unit => unit.courseId === 'fixture-en-cs' && unit.gameId === 'verb-lab');
  assert.deepEqual(verbs.map(unit => unit.itemId).sort(), ['fixture-missing-grades', 'fixture-run', 'fixture-walk']);
  assert.ok(corpus.records.some(record => record.itemId === 'fixture-noun'));
  assert.ok(!corpus.playableUnits.some(unit => unit.itemId === 'fixture-noun'));
});

test('non-English learner text never becomes English authority by fallback', () => {
  const corpus = buildEvaluationCorpus(fixtureCatalogs);
  const record = corpus.records.find(record => record.courseId === 'fixture-es-en' && record.itemId === 'fixture-run');
  assert.deepEqual(record.english, { text: 'run', field: 'englishAuditText', reason: null });
  assert.equal(record.translation.learnerBaseText, 'correr');
  const catalog = fixtureCatalogs.find(catalog => catalog.course.id === 'fixture-es-en' && catalog.game === 'verb-nebula');
  assert.equal(englishAuthority(catalog, { item: { source: 'correr', target: 'run' }, kind: 'lexeme' }).text, null);
  const greeting = corpus.records.find(record => record.courseId === 'fixture-es-en' && record.kind === 'sentence');
  assert.equal(greeting.english.field, 'englishText');
  assert.equal(greeting.english.text, 'Hello!');
  assert.equal(greeting.translation.learnerBaseText, '¡Hola!');
});

test('equal English documents share semantic identity but never learner identity', () => {
  const corpus = buildEvaluationCorpus(fixtureCatalogs);
  const document = corpus.documents.find(document => document.englishText === 'run');
  assert.equal(document.recordIds.length, 3);
  const units = corpus.playableUnits.filter(unit => unit.itemId === 'fixture-run');
  assert.equal(units.length, 2);
  assert.notEqual(units[0].id, units[1].id);
  assert.notDeepEqual(units[0].learnerIdentity, units[1].learnerIdentity);
  assert.ok(units.every(unit => !Object.hasOwn(unit, 'mastery')));
});

test('structural parent English is missing by design, and nested records retain parent provenance', () => {
  const corpus = buildEvaluationCorpus(fixtureCatalogs);
  const parent = corpus.records.find(record => record.kind === 'case-paradigm');
  assert.equal(parent.recordRole, 'parent');
  assert.equal(parent.english.text, null);
  assert.equal(parent.english.reason, 'structural-record-without-independent-English');
  assert.equal(parent.semanticDocumentId, null);
  const children = corpus.records.filter(record => record.parentId === parent.id);
  assert.equal(children.length, 2);
  assert.ok(children.every(record => record.recordRole === 'nested' && record.english.field === 'english'));
  assert.ok(corpus.findings.some(finding => finding.recordId === parent.id && finding.code === parent.english.reason && finding.severity === 'info'));
});

test('runtime defaults do not conceal missing authored grades or translations', () => {
  const corpus = buildEvaluationCorpus(fixtureCatalogs);
  const missing = corpus.records.find(record => record.itemId === 'fixture-missing-grades');
  assert.deepEqual(missing.metadata, { difficulty: null, usefulness: null, complexity: null });
  assert.equal(corpus.findings.filter(finding => finding.recordId === missing.id && finding.code === 'missing-or-invalid-metadata').length, 2);
  const playable = corpus.playableUnits.find(unit => unit.itemId === missing.itemId);
  assert.equal(playable.metadata.difficulty, 1, 'unclassified cached content belongs to the first exact band');
  assert.ok(corpus.findings.some(finding => finding.code === 'missing-target-translation'));
  assert.ok(corpus.findings.some(finding => finding.code === 'missing-authored-English'));
});

test('unavailable and invalid runtime banks never fall back to counting raw rows as playable', () => {
  const corpus = buildEvaluationCorpus(fixtureCatalogs);
  const failed = corpus.adapters.filter(adapter => adapter.status === 'failed');
  assert.equal(failed.length, 2);
  assert.ok(failed.every(adapter => adapter.playableUnits === null && adapter.playableCountAvailable === false && adapter.reason));
  assert.equal(corpus.playableUnits.filter(unit => unit.courseId === 'fixture-es-en' && unit.gameId === 'word-net').length, 0);
  assert.equal(corpus.records.filter(record => record.courseId === 'fixture-es-en' && record.gameId === 'word-net').length, 1);
});

test('runtime projection drift is reported instead of silently attaching different authoring grades', () => {
  const catalog = structuredClone(fixtureCatalogs.find(catalog => catalog.game === 'word-world' && catalog.runtime));
  catalog.runtime.document.records[0].complexity += 1;
  const corpus = buildEvaluationCorpus([catalog]);
  assert.equal(corpus.playableUnits.length, 0);
  assert.equal(corpus.adapters[0].status, 'failed');
  assert.match(corpus.adapters[0].reason, /differs from its authoring text or grades/u);
});

test('capture is deterministic, categories survive, and fixture inputs stay mutable', () => {
  const input = structuredClone(fixtureCatalogs);
  const before = structuredClone(input);
  const first = buildEvaluationCorpus(input);
  assert.deepEqual(first, buildEvaluationCorpus(input));
  assert.deepEqual(input, before);
  assert.ok(!Object.isFrozen(input[0].document[0]));
  assert.deepEqual(first.records.find(record => record.itemId === 'fixture-run').categories.category, ['motion']);
  assert.deepEqual(first.records.find(record => record.itemId === 'fixture-run').categoryProvenance.category, { source: 'item.category', inherited: false });
  assert.ok(first.playableUnits.every(unit => unit.recordIds.every(id => first.records.some(record => record.id === id))));
});

test('course filtering is explicit and unknown IDs are rejected', () => {
  assert.equal(buildEvaluationCorpus(fixtureCatalogs, { courses: [] }).records.length, 16);
  const corpus = buildEvaluationCorpus(fixtureCatalogs, { courses: ['fixture-es-en'] });
  assert.deepEqual(corpus.courses.map(course => course.id), ['fixture-es-en']);
  assert.ok(corpus.records.every(record => record.courseId === 'fixture-es-en'));
  assert.throws(() => buildEvaluationCorpus(fixtureCatalogs, { courses: ['unknown'] }), /Unknown course/u);
  assert.throws(() => buildEvaluationCorpus(fixtureCatalogs, { courses: 'cz' }), /array/u);
});
