import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { normalizeContentProgression } from '../../../apps/language-runtime/static/source/games/content-progression.mjs';
import { joinConceptCatalogs, validateEnglishConceptCatalog } from '../../../apps/language-runtime/static/source/catalog-runtime.mjs';
import { prepareWordWorldContext } from '../../../apps/language-runtime/static/source/word-world-provider.mjs';
import { normalizeStandardRecord, StandardWordWorldProvider } from '../../../apps/languages/czech/static/source/games/word-world/word-net-standard.mjs';
import { importBrowserLanguageAdapter } from '../../../apps/language-runtime/tests/browser-module-loader.mjs';
import { modernCatalogs, validateWordWorldContent, czechRuntimeRecords } from '../lib/word-world-course-content.mjs';
import { prepareLanguageRoleContent } from '../lib/language-role-contract.mjs';
import { validateLanguageContent } from '../lib/content-contract.mjs';
import { validateEnglishConceptRuntimeProjection } from '../lib/runtime-projection-contract.mjs';
import { buildWordWorldRuntimeProjections } from '../project-word-world-runtime.mjs';

const json = async path => JSON.parse(await readFile(new URL(`../../../${path}`, import.meta.url), 'utf8'));
const grade = item => ({ usefulness: item.usefulness, complexity: item.complexity });
const bounds = [{ usefulness: 1, complexity: 100 }, { usefulness: 37, complexity: 64 }, { usefulness: 100, complexity: 1 }];
const fields = [['usefulness', 'urgency'], ['complexity', 'subdifficulty']];
const spanishCourse = await json('apps/languages/spanish/course.json');
const spanishAuthority = await json('apps/languages/spanish/content/word-world/content.json');
const spanishManifest = await json('apps/languages/spanish/static/data/games/word-world/manifest.json');
const spanishAdapter = await importBrowserLanguageAdapter(new URL('../../../apps/languages/spanish/static/source/language/adapter.mjs', import.meta.url));
const czechAdapter = await importBrowserLanguageAdapter(new URL('../../../apps/languages/czech/static/source/language/adapter.mjs', import.meta.url));

// Reuse publication licensing/policy declarations, but no live curriculum rows
// or teaching-text/count snapshots. The entire playable fixture is synthetic.
function modernFixture(scores = bounds[0]) {
  return { ...structuredClone(spanishAuthority), records: [{
    id: 'ww.fixture.metadata', difficulty: 1, ...scores, topic: 'fixtures',
    englishText: 'An example.', embeddingText: 'An example.', englishAlternates: [],
    targetText: 'Un ejemplo.', pronunciation: null,
    tokens: [
      { surface: 'Un', pronunciation: null, gloss: 'an', playable: false },
      { surface: 'ejemplo', pronunciation: null, gloss: 'example', playable: true }
    ],
    learnerBase: null, sceneQuery: 'an example', sceneAssetIds: [], annotations: {}
  }] };
}

function standaloneFixture(scores = {}) {
  return { id: 'ww-fixture-metadata', cs: 'Příklad.', en: 'Example.', difficulty: 1,
    targets: [{ surface: 'Příklad', normalized: 'příklad', tokenIndex: 0, playable: true }], ...scores };
}

function browserOptions(adapter, extra = {}) {
  return { origin: 'https://fixture.invalid', adapter, embeddingRanker: null, runtime: null, ...extra };
}

function browserCourse(course) {
  return { ...structuredClone(course), capabilities: { ...course.capabilities, wordWorld: true, generation: false, dictionary: false } };
}

test('modern authority, role join, projection, browser join and selection retain boundary and intermediate scores', async () => {
  for (const scores of bounds) {
    const document = modernFixture(scores);
    validateWordWorldContent(document, spanishCourse);
    const { concepts, realizations } = modernCatalogs(document, spanishCourse);
    const roleContent = prepareLanguageRoleContent(concepts, realizations, { sourceLanguage: document.sourceLanguage });
    assert.deepEqual(grade(roleContent.records[0]), scores);
    const output = buildWordWorldRuntimeProjections(concepts, realizations, spanishManifest);
    assert.deepEqual(grade(output.englishProjection.concepts[0]), scores);
    assert.deepEqual(grade(joinConceptCatalogs(output.englishProjection, output.targetProjection)[0]), scores);
    const context = await prepareWordWorldContext(browserCourse(spanishCourse), output.runtimeManifest, browserOptions(spanishAdapter, {
      loadJson: async url => url.includes('english-concepts') ? output.englishProjection : output.targetProjection
    }));
    assert.deepEqual(grade(context.sessionRecord(document.records[0].id)), scores);
    assert.deepEqual(grade(context.selectionProvider.records[0]), scores);
  }
});

test('true Word World authority requires both new fields and rejects legacy spelling', () => {
  for (const [field, legacy] of fields) {
    const absent = modernFixture();
    delete absent.records[0][field];
    assert.throws(() => validateWordWorldContent(absent, spanishCourse), /missing fields/u);
    absent.records[0][legacy] = 5;
    assert.throws(() => validateWordWorldContent(absent, spanishCourse), /missing fields/u);
    const obsolete = modernFixture();
    obsolete.records[0][legacy] = 5;
    assert.throws(() => validateWordWorldContent(obsolete, spanishCourse), /missing fields/u);
  }
});

test('explicit invalid new scores cannot be rescued by valid legacy scores at runtime boundaries', () => {
  for (const [field, legacy] of fields) {
    for (const invalid of [null, false, '1', 0, 101, 1.5, NaN, Infinity]) {
      const scores = { ...bounds[0], [field]: invalid, [legacy]: 5 };
      assert.throws(() => normalizeContentProgression(scores), new RegExp(field));
      assert.throws(() => normalizeStandardRecord(standaloneFixture(scores)), new RegExp(field));
      const { concepts } = modernCatalogs(modernFixture(), spanishCourse);
      Object.assign(concepts.concepts[0], scores);
      assert.throws(() => validateEnglishConceptCatalog(concepts), new RegExp(field));
    }
  }
});

test('legacy runtime fallback is explicit, preserves modern precedence, and rejects malformed legacy numbers', () => {
  const mapped = [1, 25, 50, 75, 100];
  for (let old = 1; old <= 5; old += 1) {
    const legacy = { urgency: old, subdifficulty: 6 - old };
    const expected = { usefulness: mapped[old - 1], complexity: mapped[5 - old] };
    assert.deepEqual(normalizeContentProgression(legacy), expected);
    assert.deepEqual(grade(normalizeStandardRecord(standaloneFixture(legacy))), expected);
  }
  assert.deepEqual(normalizeContentProgression({}), { usefulness: 50, complexity: 50 });
  assert.deepEqual(grade(normalizeStandardRecord(standaloneFixture())), { usefulness: 50, complexity: 50 });
  for (const scores of bounds) {
    const explicit = { ...scores, urgency: null, subdifficulty: 'obsolete' };
    assert.deepEqual(normalizeContentProgression(explicit), scores);
    assert.deepEqual(grade(normalizeStandardRecord(standaloneFixture(explicit))), scores);
  }
  for (const [, legacy] of fields) for (const invalid of [null, false, '1', 0, 6, 1.5]) {
    assert.throws(() => normalizeContentProgression({ [legacy]: invalid }), TypeError);
    assert.throws(() => normalizeStandardRecord(standaloneFixture({ [legacy]: invalid })), TypeError);
  }
});

test('publication contracts reject explicit invalid or old fields while supporting absent legacy metadata', () => {
  for (const [field, legacy] of fields) {
    for (const invalid of [null, false, '1', 0, 101, 1.5]) {
      const { concepts, realizations } = modernCatalogs(modernFixture(), spanishCourse);
      concepts.concepts[0][field] = invalid;
      assert.throws(() => validateLanguageContent(concepts, realizations), new RegExp(field));
    }
    const { concepts, realizations } = modernCatalogs(modernFixture(), spanishCourse);
    concepts.concepts[0][legacy] = 5;
    assert.throws(() => validateLanguageContent(concepts, realizations), new RegExp(legacy));
  }
  const { concepts, realizations } = modernCatalogs(modernFixture(), spanishCourse);
  for (const [field] of fields) delete concepts.concepts[0][field];
  assert.doesNotThrow(() => validateLanguageContent(concepts, realizations));
  const output = buildWordWorldRuntimeProjections(concepts, realizations, spanishManifest);
  assert.doesNotThrow(() => validateEnglishConceptRuntimeProjection(output.englishProjection, { source: concepts }));
  assert.deepEqual(grade(joinConceptCatalogs(output.englishProjection, output.targetProjection)[0]), { usefulness: 50, complexity: 50 });
});

test('faithful runtime projection contract catches dropped or changed metadata despite compatibility defaults', () => {
  const { concepts, realizations } = modernCatalogs(modernFixture(), spanishCourse);
  const output = buildWordWorldRuntimeProjections(concepts, realizations, spanishManifest);
  for (const [field, legacy] of fields) {
    const missing = structuredClone(output.englishProjection);
    delete missing.concepts[0][field];
    assert.throws(() => validateEnglishConceptRuntimeProjection(missing, { source: concepts }), /faithful/u);
    const altered = structuredClone(output.englishProjection);
    altered.concepts[0][field] = 50;
    assert.throws(() => validateEnglishConceptRuntimeProjection(altered, { source: concepts }), /faithful/u);
    const obsolete = structuredClone(output.englishProjection);
    obsolete.concepts[0][legacy] = 5;
    assert.throws(() => validateEnglishConceptRuntimeProjection(obsolete), new RegExp(legacy));
    for (const invalid of [null, false, '1', 0, 101, 1.5]) {
      const corrupt = structuredClone(output.englishProjection);
      corrupt.concepts[0][field] = invalid;
      assert.throws(() => validateEnglishConceptRuntimeProjection(corrupt), new RegExp(field));
    }
  }
});

test('both published English schemas declare the full integer scale and prohibit old fields', async () => {
  for (const path of ['tools/language-packs/schemas/english-concepts.v1.schema.json', 'apps/language-runtime/static/schemas/english-concepts.runtime.v1.schema.json']) {
    const schema = await json(path);
    const concept = schema.$defs.concept;
    assert.equal(concept.additionalProperties, false);
    for (const [field, legacy] of fields) {
      assert.equal(concept.properties[field].type, 'integer');
      assert.equal(concept.properties[field].minimum, 1);
      assert.equal(concept.properties[field].maximum, 100);
      assert.equal(Object.hasOwn(concept.properties, legacy), false);
    }
  }
});

test('Czech archival schema and standalone provider retain metadata through the separate runtime projection', async () => {
  const czechCourse = await json('apps/languages/czech/course.json');
  const rubric = await json('tools/czech-ml/data/word-world/standard-v0.1/rubric.json');
  // This one-row synthetic fixture tests transformation, not corpus distribution.
  rubric.distribution = { minimumRecords: 1, minimumLevel2Share: 0, minimumLevel3Records: 0 };
  for (const scores of bounds) {
    const document = { schemaVersion: 'caatuu-word-world-course-content-v1', courseId: 'cz', sourceLanguage: 'en', targetLanguage: 'cs-CZ', metadata: {}, records: [{
      id: 'ww-fixture-metadata', difficulty: 1, ...scores, topic: 'fixtures',
      englishText: 'Example.', embeddingText: 'Example.', englishAlternates: [], targetText: 'Příklad.', pronunciation: null,
      tokens: [{ surface: 'Příklad', normalized: 'příklad', tokenIndex: 0, playable: true, gloss: null }],
      learnerBase: null, sceneQuery: 'example', sceneAssetIds: [], annotations: {
        cefr: 'Pre-A1',
        learning: { objective: 'Synthetic operation', skillFocus: ['recognition'], ageBand: 'all',
          progression: { level: 1, rationale: 'Synthetic fixture', prerequisites: [] },
          support: { translationAvailable: true, imageSuitable: true, audioSuitable: true, dictionarySuitable: true } },
        grammar: { tags: [], sentenceType: 'statement', clauseCount: 1 },
        provenance: { sourceName: 'Synthetic fixture', sourceIds: ['fixture-metadata'], sourceLicense: 'Synthetic fixture', sourceType: 'authored', transformation: 'Synthetic fixture' },
        review: { status: 'codex_reviewed', reviewer: 'Synthetic reviewer', reviewedOn: '2026-01-01', humanApproved: false, checks: ['synthetic'], notes: [] }
      }
    }] };
    validateWordWorldContent(document, czechCourse);
    const { runtime } = czechRuntimeRecords(document, rubric);
    assert.deepEqual(grade(runtime[0]), scores);
    const provider = new StandardWordWorldProvider({ pack: runtime });
    assert.deepEqual(grade(provider.records[0]), scores);
    const context = await prepareWordWorldContext(browserCourse(czechCourse), { sessionProvider: { kind: 'standard-corpus' } },
      browserOptions(czechAdapter, { standardProvider: provider }));
    assert.deepEqual(grade(context.sessionRecord(runtime[0].id)), scores);
    assert.deepEqual(grade(context.selectionProvider.records[0]), scores);
  }
});
