import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { validateLanguageContent } from '../lib/content-contract.mjs';
import { prepareLanguageRoleContent } from '../lib/language-role-contract.mjs';
import { buildWordWorldRuntimeProjections } from '../project-word-world-runtime.mjs';
import { resolveTargetContentPolicy } from '../policies/registry.mjs';
import { resolveWordWorldProjectionPolicy } from '../word-world-projection/registry.mjs';
import { englishAmericanContentPolicy } from '../policies/english-american.mjs';
import { englishAmericanWordWorldProjectionPolicy, ENGLISH_AMERICAN_WORD_WORLD_PATHS } from '../word-world-projection/english-american.mjs';

const repositoryRoot = new URL('../../../', import.meta.url);
const read = async (relative) => JSON.parse(await readFile(new URL(relative, repositoryRoot), 'utf8'));
const concepts = await read(ENGLISH_AMERICAN_WORD_WORLD_PATHS.conceptsSource);
const target = await read(ENGLISH_AMERICAN_WORD_WORLD_PATHS.realizationsSource);
const base = await read(ENGLISH_AMERICAN_WORD_WORLD_PATHS.learnerBaseSource);
const authored = await read('apps/languages/english-from-spanish/content/word-world/content.json');

test('American English policy owns target locale, authored tokens and review gates', () => {
  assert.equal(resolveTargetContentPolicy('english-american-v1'), englishAmericanContentPolicy);
  assert.equal(resolveWordWorldProjectionPolicy('english-american-v1'), englishAmericanWordWorldProjectionPolicy);
  assert.doesNotThrow(() => validateLanguageContent(concepts, target));
  assert.equal(target.targetLanguage.languageTag, 'en-US');
  assert.deepEqual(target.license, authored.metadata.target.license);
  assert.equal(target.realizations.length, concepts.concepts.length);
  for (let i = 0; i < concepts.concepts.length; i++) {
    assert.equal(target.realizations[i].conceptId, concepts.concepts[i].id);
  }
  const pendingTarget = structuredClone(target);
  pendingTarget.license = {
    origin: 'synthetic-test-fixture', status: 'release-review-required',
    spdxExpression: null, sourceReference: null, reviewedBy: null, reviewedAt: null
  };
  assert.throws(() => validateLanguageContent(concepts, pendingTarget, { release: true }),
    error => error.issues?.some(issue => issue.code === 'release.license'));
  assert.throws(() => validateLanguageContent(concepts, target, { requireNativeReview: true }),
    error => error.issues?.some(issue => issue.code === 'activation.native-review'));
  for (const [mutate, expected] of [
    [(value) => { value.courseId = 'en'; }, 'english.course'],
    [(value) => { value.targetLanguage.speechLocale = 'es-ES'; }, 'english.locale'],
    [(value) => { value.tokenization.characterFallbackAllowed = true; }, 'english.tokenization'],
    [(value) => { value.realizations[0].tokens[0].pronunciation = {}; }, 'english.pronunciation'],
    [(value) => { value.realizations[0].text = 'Привет'; }, 'english.script']
  ]) {
    const candidate = structuredClone(target); mutate(candidate);
    assert.ok(englishAmericanContentPolicy.validate(candidate).some((issue) => issue.code === expected), expected);
  }
});

test('American target wording can differ from the shared English audit without losing Spanish token alignment', () => {
  const targets = new Map(target.realizations.map(record => [record.conceptId, record]));
  const audit = new Map(concepts.concepts.map(record => [record.id, record]));
  for (const [id, targetPhrase, auditPhrase] of [
    ['ww.hobby.football', 'playing soccer', 'playing football'],
    ['ww.family.sister-university', 'at a university', 'at university'],
    ['ww.problem.card-machine', 'the ATM', 'the cash machine']
  ]) {
    assert.ok(targets.get(id).text.includes(targetPhrase), id);
    assert.ok(audit.get(id).englishText.includes(auditPhrase), id);
  }
  assert.doesNotThrow(() => prepareLanguageRoleContent(concepts, target, {
    sourceLanguage: 'es-ES', learnerBaseRealizations: base
  }));
});

test('Spanish base remains independent and covers every authored English token exactly', () => {
  assert.doesNotThrow(() => prepareLanguageRoleContent(concepts, target, { sourceLanguage: 'es-ES', learnerBaseRealizations: base }));
  const baseById = new Map(base.realizations.map((record) => [record.conceptId, record]));
  assert.equal(baseById.size, target.realizations.length);
  for (const record of target.realizations) {
    const learner = baseById.get(record.conceptId);
    assert.equal(learner.tokenMeanings.length, record.tokens.length);
    record.tokens.forEach((token, tokenIndex) => {
      const meaning = learner.tokenMeanings[tokenIndex];
      assert.equal(meaning.targetLanguage, 'en-US');
      assert.equal(meaning.tokenIndex, tokenIndex);
      assert.equal(meaning.surface, token.surface);
      assert.ok(meaning.text.trim());
    });
  }
  const hello = baseById.get('ww.greeting.hello');
  assert.equal(hello.text, '¡Hola!');
  assert.equal(hello.tokenMeanings[0].text, 'hola');
  assert.equal(base.review.status, 'native-review-required');
  assert.deepEqual(base.license, authored.metadata.learnerBase.license);
});

test('projection binds three roles and preserves English-only retrieval without pronunciation claims', () => {
  const policy = englishAmericanWordWorldProjectionPolicy;
  const manifest = {
    ...policy.buildManifest({ concepts, realizations: target, paths: ENGLISH_AMERICAN_WORD_WORLD_PATHS }),
    learnerBaseLanguage: 'es-ES',
    learnerBaseFile: 'learner-base.json'
  };
  const output = buildWordWorldRuntimeProjections(concepts, target, manifest, {
    projectionPolicy: policy, paths: ENGLISH_AMERICAN_WORD_WORLD_PATHS, sourceLanguage: 'es-ES', learnerBaseRealizations: base
  });
  assert.equal(output.englishProjection.language, 'en');
  assert.equal(output.targetProjection.targetLanguage.languageTag, 'en-US');
  assert.equal(output.learnerBaseProjection.baseLanguage.languageTag, 'es-ES');
  assert.equal(output.runtimeManifest.learnerBaseLanguage, 'es-ES');
  assert.equal(output.runtimeManifest.learnerBaseFile, 'learner-base.json');
  assert.equal(output.runtimeManifest.embeddingPolicy.inputLanguage, 'en');
  assert.equal(output.runtimeManifest.embeddingPolicy.targetTextAllowed, false);
  assert.equal(output.runtimeManifest.capabilities.generation, false);
  assert.equal(output.targetProjection.projectionPolicy.pronunciationIncluded, false);
  assert.deepEqual(output.targetProjection.license, target.license);
  assert.deepEqual(output.learnerBaseProjection.license, base.license);
});
