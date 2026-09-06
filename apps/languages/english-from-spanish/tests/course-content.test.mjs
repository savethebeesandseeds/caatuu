import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  validateConjugationCometCatalog,
  buildConjugationHelixRound,
  judgeConjugationHelixRound
} from '../../../language-runtime/static/source/games/conjugation-comet/conjugation-comet-core.mjs';
import {
  normalizeGrammarGravityPack,
  buildGrammarGravityRounds
} from '../../../language-runtime/static/source/games/grammar-gravity/grammar-gravity-core.mjs';
import { normalizeNounLandingPack } from '../../../language-runtime/static/source/games/grammar-gravity/noun-landing-core.mjs';
import { validateSoundQuasarCatalog } from '../../../language-runtime/static/source/games/sound-quasar/sound-quasar-core.mjs';

const root = new URL('../', import.meta.url);
const json = async (relative) => JSON.parse(await readFile(new URL(relative, root), 'utf8'));

test('Spanish word hints retain contextual senses instead of generic literal substitutions', async () => {
  const base = await json('../shared/learner-base-realizations/es-ES/word-world-starter-v1.json');
  const byId = new Map(base.realizations.map((item) => [item.conceptId, item]));
  const hint = (conceptId, surface) => {
    const tokens = byId.get(conceptId).tokenMeanings.filter((token) => token.surface === surface);
    assert.equal(tokens.length, 1, `${conceptId}: ${surface}`);
    return tokens[0].text;
  };
  assert.equal(hint('ww.compare.light-bag', 'light'), 'ligera; de poco peso');
  assert.equal(hint('ww.location.light-switch', 'switch'), 'interruptor');
  assert.equal(hint('ww.compare.tea-water', 'hotter'), 'más caliente');
  assert.match(hint('ww.routine.get-up', 'get'), /levantarse/u);
  assert.equal(hint('ww.number.three-apples', 'are'), 'hay (con there)');
  assert.equal(hint('ww.family.together', 'are'), 'somos');
});

test('the Spanish-to-English course owns direction, identity, resources and isolated state', async () => {
  const course = await json('course.json');
  assert.equal(course.id, 'es-en');
  assert.equal(course.sourceLanguage.locale, 'es-ES');
  assert.equal(course.targetLanguage.locale, 'en-US');
  assert.equal(course.targetLanguage.speechLocale, 'en-US');
  assert.equal(course.routePrefix, '/es-en');
  assert.equal(course.platforms.browser.enabled, true);
  assert.equal(course.platforms.browser.pagesEnabled, false);
  assert.equal(course.platforms.android.enabled, false);
  assert.equal(course.resources.interfaceCatalog.path, 'apps/language-runtime/static/data/interface/es.v1.json');
  assert.equal(course.resources.interfaceCatalog.revision, 'interface-es-2');
  assert.equal(course.resources.appEntry.scope, 'shared');
  assert.deepEqual(course.games, ['word-net', 'conjugation-comet', 'grammar-gravity', 'sound-quasar']);
  for (const key of ['generation', 'llm', 'chat', 'dictionary', 'skillCompass', 'memory']) {
    assert.equal(course.capabilities[key], false, key);
  }
  for (const value of Object.values(course.storage)) assert.ok(value.startsWith('caatuu-es-en'), value);
  assert.equal(course.cache.prefix, 'caatuu-es-en-pwa-');
  assert.equal((await json('static/manifest.webmanifest')).lang, 'es-ES');
});

test('English adapter segments contractions, preserves spelling and speaks en-US', async () => {
  let source = await readFile(new URL('static/source/language/adapter.mjs', root), 'utf8');
  source = source.replace('"/language-runtime/contract.mjs"', JSON.stringify(new URL('../../language-runtime/contract.mjs', root).href));
  const { default: adapter } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  assert.equal(adapter.languageTags.primary, 'en');
  assert.equal(adapter.languageTags.locale, 'en-US');
  assert.equal(adapter.learner.display('This is a book.').languageTag, 'en-US');
  const words = adapter.segmentation.segment("Don't lose my sister's book.").filter((token) => token.type === 'word').map((token) => token.text);
  assert.deepEqual(words, ["Don't", 'lose', 'my', "sister's", 'book']);
  assert.equal(adapter.normalization.answerKey(' Books '), 'books');
  assert.notEqual(adapter.normalization.answerKey('color'), adapter.normalization.answerKey('colour'));
  assert.equal(adapter.speech.output.config().languageTag, 'en-US');
  assert.equal(adapter.speech.input.config().languageTag, 'en-US');
  assert.equal(adapter.learner.pronunciation('book'), null);
});

test('English present paradigms retain Spanish cues, explicit audit and solvable repeated forms', async () => {
  const raw = await json('static/data/games/conjugation-comet/verbs.json');
  const catalog = validateConjugationCometCatalog(raw, {
    expectedCourseId: 'es-en', expectedTargetLanguageId: 'en', expectedLearnerBaseLanguageId: 'es', expectedTargetLocale: 'en-US'
  });
  assert.equal(catalog.verbs.length, 8);
  assert.equal(catalog.review.status, 'native-review-required');
  assert.equal(catalog.license.status, 'release-review-required');
  for (const verb of catalog.verbs) {
    assert.ok(verb.englishAuditText);
    assert.notEqual(verb.learnerBaseText, verb.englishAuditText);
    assert.equal(verb.forms.length, 6);
    const round = buildConjugationHelixRound(catalog, verb.id, { rng: () => 0.37 });
    assert.ok(Array.from({ length: 6 }, (_, offset) => judgeConjugationHelixRound(round, 0, offset)).some((result) => result.correct), verb.id);
    for (const form of verb.forms) {
      assert.notEqual(form.learnerBaseCueText, form.englishAuditText);
      assert.ok(form.targetPhraseFrame.beforeText.endsWith(' '));
    }
  }
  assert.throws(() => validateConjugationCometCatalog(raw, { expectedLearnerBaseLanguageId: 'en' }), /learner base/u);
});

test('English grammar uses number and subject agreement with Spanish phrase presentation', async () => {
  const options = { courseId: 'es-en', learnerBaseLanguage: 'es-ES', targetLanguage: 'en-US' };
  const raw = await json('static/data/games/grammar-gravity/challenges.json');
  const grammar = normalizeGrammarGravityPack(raw, options);
  assert.equal(grammar.challenges.length, 6);
  assert.equal(grammar.schemaVersion, 'caatuu-grammar-gravity-content-v3');
  assert.equal(grammar.gameplay.categoryFeature, 'number');
  assert.deepEqual(grammar.gameplay.stages, ['meaning', 'category', 'form']);
  assert.deepEqual(grammar.axes.map((axis) => axis.id), ['singular', 'plural']);
  assert.ok(grammar.axes.every((axis) => !Object.hasOwn(axis.features, 'gender')));
  for (const difficulty of [1, 2, 3]) {
    const rounds = buildGrammarGravityRounds(grammar, difficulty);
    assert.ok(rounds.length > 0);
    for (const round of rounds) for (const flight of round.flights) {
      assert.notEqual(flight.learnerBaseText, flight.targetText);
      assert.notEqual(flight.anchorMeaning, flight.anchorText);
      assert.equal(flight.beforeText + flight.answer + flight.afterText, flight.targetText);
      assert.ok(['singular', 'plural'].includes(flight.categoryId));
    }
  }
  assert.equal(buildGrammarGravityRounds(grammar, 3).length, 24);
  const nouns = normalizeNounLandingPack(await json('static/data/games/grammar-gravity/nouns.json'), options);
  assert.equal(nouns.items.length, 24);
  assert.deepEqual(nouns.lanes.map((lane) => lane.id), ['singular', 'plural']);
  assert.equal(nouns.items.find((item) => item.targetText === 'children').laneId, 'plural');
  assert.equal(nouns.items.find((item) => item.targetText === 'person').learnerBaseText, 'persona');
  const wrongBase = structuredClone(raw); wrongBase.learnerBaseLanguage = 'en';
  assert.throws(() => normalizeGrammarGravityPack(wrongBase, options), /learner|base/u);
});

test('Sounds uses Spanish meanings and exact English targets with finite source provenance', async () => {
  const raw = await json('static/data/games/sound-quasar/challenges.json');
  const sounds = validateSoundQuasarCatalog(raw, { courseId: 'es-en', targetLanguageId: 'en', learnerBaseLanguage: 'es-ES' });
  assert.equal(raw.learnerBaseLanguage, 'es-ES');
  assert.equal(raw.auditLanguage, 'en');
  assert.equal(sounds.audio.locale, 'en-US');
  assert.equal(sounds.audio.reviewStatus, 'unreviewed');
  const vocabulary = await json('static/data/games/verb-nebula/core-vocabulary.json');
  const byId = new Map(vocabulary.map((item) => [item.id, item]));
  assert.equal(sounds.items.length, 16);
  assert.equal(sounds.sentences.length, 16);
  for (const item of sounds.items) {
    const source = byId.get(item.sourceId);
    assert.equal(item.target, source.target);
    assert.equal(item.meaning, source.source);
    assert.equal(item.englishAuditText, source.englishAuditText);
  }
  for (const item of [...sounds.items, ...sounds.sentences]) {
    assert.notEqual(item.meaning, item.englishAuditText);
    assert.equal(item.englishAuditText, item.target);
    assert.equal(item.sourceReviewStatus, 'native-review-required');
  }
});
