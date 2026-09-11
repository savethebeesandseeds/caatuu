import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildWordWorldRuntimeProjections } from '../project-word-world-runtime.mjs';

const repositoryRoot = new URL('../../../', import.meta.url);
const readJson = path => readFile(new URL(path, repositoryRoot), 'utf8').then(JSON.parse);
const [authority, verbs, concepts, realizations, publicConcepts, publicRealizations, readingGuides, manifest, nucleus] = await Promise.all([
  'apps/languages/mandarin-simplified/content/word-world/content.json',
  'apps/languages/mandarin-simplified/static/data/games/verb-nebula/content.json',
  'apps/languages/shared/english-concepts/word-world-starter-v1.json',
  'apps/languages/mandarin-simplified/content/word-world/starter-v1.realizations.json',
  'apps/language-runtime/static/data/english-concepts/word-world-starter-v1.json',
  'apps/languages/mandarin-simplified/static/data/games/word-world/content.json',
  'apps/languages/mandarin-simplified/static/data/games/word-world/reading-guides.json',
  'apps/languages/mandarin-simplified/static/data/games/word-world/manifest.json',
  'apps/languages/mandarin-simplified/static/data/games/naturalization-nucleus/content.json'
].map(readJson));
const compositionKey = value => value.normalize('NFC').toLocaleLowerCase('en-US').replace(/[^\p{L}\p{M}\p{N}]+/gu, '');
const pinyinTone = value => {
  const normalized = value.normalize('NFD');
  return ['\u0304', '\u0301', '\u030c', '\u0300'].findIndex(mark => normalized.includes(mark)) + 1 || 5;
};
function text(value, label) {
  assert.equal(typeof value, 'string', label);
  assert.ok(value.trim(), label);
  assert.equal(value, value.trim(), label);
  assert.equal(value, value.normalize('NFC'), label);
  assert.doesNotMatch(value, /[\p{Cc}\p{Cf}]/u, label);
}
function progression(rows, label) {
  assert.ok(rows.length > 0, label);
  assert.deepEqual(new Set(rows.map(row => row.difficulty)), new Set([1, 2, 3]), `${label}: every badge remains playable`);
  assert.equal(new Set(rows.map(row => row.id)).size, rows.length, `${label}: unique IDs`);
  for (const row of rows) {
    text(row.id, label);
    for (const field of ['usefulness', 'complexity']) {
      assert.ok(Number.isInteger(row[field]) && row[field] >= 1 && row[field] <= 100, `${row.id}.${field}`);
    }
  }
}
function pendingReview(review) {
  assert.equal(review.status, 'native-review-required');
  assert.equal(review.reviewer, null);
  assert.equal(review.reviewedAt, null);
}
function pronunciation(value, label) {
  assert.equal(value.system, 'pinyin', label);
  assert.equal(value.languageTag, 'zh-Latn-pinyin', label);
  assert.equal(value.reviewed, false, label);
  text(value.notation, label);
}

test('all Mandarin banks have unique stable IDs, explicit progression and usable badge coverage', () => {
  assert.ok(Array.isArray(verbs));
  progression(verbs, 'Verb Nebula');
  progression(concepts.concepts, 'Word World');
  progression(nucleus.challenges, 'Naturalization Nucleus');
  assert.equal(nucleus.$schema, 'https://caatuu.org/schemas/development/naturalization-nucleus.preview.v1.json');
  const ids = authority.records.map(row => row.id);
  assert.deepEqual(concepts.concepts.map(row => row.id), ids);
  assert.deepEqual(realizations.realizations.map(row => row.conceptId), ids);
  assert.equal(new Set(nucleus.challenges.map(row => row.hanzi)).size, nucleus.challenges.length);
});

test('retrieval, visual fields and translations preserve their authoritative language roles', () => {
  const conceptsById = new Map(concepts.concepts.map(row => [row.id, row]));
  const targetsById = new Map(realizations.realizations.map(row => [row.conceptId, row]));
  assert.equal(concepts.embeddingPolicy.inputLanguage, 'en');
  assert.equal(concepts.embeddingPolicy.inputField, 'embeddingText');
  assert.equal(concepts.embeddingPolicy.targetTextAllowed, false);
  for (const authored of authority.records) {
    const concept = conceptsById.get(authored.id), target = targetsById.get(authored.id);
    for (const field of ['englishText', 'embeddingText', 'sceneQuery', 'topic']) {
      text(concept[field], `${authored.id}.${field}`);
      assert.equal(concept[field], authored[field]);
    }
    assert.equal(target.text, authored.targetText);
    assert.deepEqual(target.tokens, authored.tokens);
    assert.deepEqual(target.pronunciation, authored.pronunciation);
  }
});

test('preview pronunciation and native review remain separate from owner-cleared licensing', () => {
  assert.ok(verbs.every(row => row.reviewStatus === 'native-review-required'));
  pendingReview(realizations.review);
  pendingReview(nucleus.review);
  pendingReview(readingGuides.review);
  assert.equal(nucleus.status, 'machine-assisted-preview');
  assert.equal(readingGuides.status, 'machine-assisted-preview');
  assert.deepEqual(realizations.review, authority.metadata.target.review);
  assert.deepEqual(concepts.license, authority.metadata.english.license);
  assert.deepEqual(realizations.license, authority.metadata.target.license);
  for (const license of [concepts.license, realizations.license]) {
    assert.equal(license.origin, 'caatuu-first-party-authored');
    assert.equal(license.status, 'release-cleared');
    assert.equal(license.spdxExpression, 'AGPL-3.0-only');
    assert.equal(license.sourceReference, 'docs/LICENSING.md#first-party-curriculum');
    text(license.reviewedBy, 'license.reviewedBy');
    assert.ok(Number.isFinite(Date.parse(license.reviewedAt)));
  }
});

test('every Mandarin sentence, token and character unit composes exactly in surface and contextual pinyin', () => {
  for (const row of realizations.realizations) {
    pronunciation(row.pronunciation, row.conceptId);
    assert.equal(compositionKey(row.text), compositionKey(row.tokens.map(token => token.surface).join('')), row.conceptId);
    assert.equal(compositionKey(row.pronunciation.notation), compositionKey(row.tokens.map(token => token.pronunciation.notation).join('')), row.conceptId);
    for (const token of row.tokens) {
      text(token.surface, `${row.conceptId}: surface`);
      text(token.gloss, `${row.conceptId}: gloss`);
      pronunciation(token.pronunciation, row.conceptId);
      if (!/\p{Script=Han}/u.test(token.surface)) continue;
      assert.ok(Array.isArray(token.readingUnits) && token.readingUnits.length > 0, row.conceptId);
      assert.equal(token.readingUnits.map(unit => unit.surface).join(''), token.surface, row.conceptId);
      assert.equal(compositionKey(token.pronunciation.notation), compositionKey(token.readingUnits.map(unit => unit.pronunciation.notation).join('')), row.conceptId);
      for (const unit of token.readingUnits) {
        assert.equal(Array.from(unit.surface).length, 1);
        assert.match(unit.surface, /\p{Script=Han}/u);
        pronunciation(unit.pronunciation, row.conceptId);
        assert.doesNotMatch(unit.pronunciation.notation, /\s/u);
      }
    }
  }
});

test('Word World public catalogs and preview guide are exact projections of current authoring data', () => {
  const projected = buildWordWorldRuntimeProjections(structuredClone(concepts), structuredClone(realizations), structuredClone(manifest));
  assert.deepEqual(publicConcepts, projected.englishProjection);
  assert.deepEqual(publicRealizations, projected.targetProjection);
  assert.deepEqual(readingGuides, projected.readingGuideProjection);
  assert.deepEqual(manifest, projected.runtimeManifest);
  assert.equal(manifest.recordCount, authority.records.length);
  assert.equal(manifest.targetTextGuide.system, 'pinyin');
  assert.equal(manifest.targetTextGuide.status, 'machine-assisted-preview');
  assert.equal(manifest.review.status, 'native-review-required');
  assert.equal(manifest.review.pronunciationApproved, false);
  assert.doesNotMatch(JSON.stringify(publicRealizations), /"(?:pronunciation|readingUnits)"\s*:/u);
});

test('each Nucleus reading has exact source evidence within its badge and enough distinct readings for every puzzle size', () => {
  const conceptsById = new Map(concepts.concepts.map(row => [row.id, row]));
  const targetsById = new Map(realizations.realizations.map(row => [row.conceptId, row]));
  for (const challenge of nucleus.challenges) {
    assert.equal(Array.from(challenge.hanzi).length, 1);
    assert.match(challenge.hanzi, /\p{Script=Han}/u);
    text(challenge.pinyin, challenge.id);
    assert.doesNotMatch(challenge.pinyin, /\s/u);
    assert.equal(challenge.tone, pinyinTone(challenge.pinyin));
    assert.ok(challenge.sourceConceptIds.length > 0);
    assert.equal(new Set(challenge.sourceConceptIds).size, challenge.sourceConceptIds.length);
    let eligible = false;
    for (const sourceId of challenge.sourceConceptIds) {
      const concept = conceptsById.get(sourceId), target = targetsById.get(sourceId);
      assert.ok(concept && target, `${challenge.id}: missing source ${sourceId}`);
      assert.ok(target.tokens.some(token => token.readingUnits?.some(unit =>
        unit.surface === challenge.hanzi && compositionKey(unit.pronunciation.notation) === compositionKey(challenge.pinyin))), challenge.id);
      eligible ||= concept.difficulty <= challenge.difficulty;
    }
    assert.equal(eligible, true, `${challenge.id}: no source available within its badge`);
  }
  assert.ok(nucleus.roundSettings.pieceCounts.includes(nucleus.roundSettings.defaultPieceCount));
  for (const level of [1, 2, 3]) {
    const eligible = nucleus.challenges.filter(row => row.difficulty <= level);
    const readings = new Set(eligible.map(row => `${compositionKey(row.pinyin)}:${row.tone}`));
    for (const pieceCount of nucleus.roundSettings.pieceCounts) assert.ok(readings.size >= pieceCount);
  }
});
