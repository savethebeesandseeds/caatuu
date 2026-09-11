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
import {
  validateVerbNebulaCatalog, filterVerbPairsForDifficulty, dealVerbRound,
  shuffleVerbMeanings, verbPairMatches, isVerbRoundComplete, verbHintSearchText
} from '../../../language-runtime/static/source/games/verb-nebula/verb-nebula-core.mjs';
import { availableGameIds, CAMPAIGN_GAME_IDS } from '../../../language-runtime/static/source/shell-policy.mjs';

const root = new URL('../', import.meta.url);
const json = async (relative) => JSON.parse(await readFile(new URL(relative, root), 'utf8'));

test('Spanish word hints preserve every authored contextual meaning by token position', async () => {
  const base = await json('../shared/learner-base-realizations/es-ES/word-world-starter-v1.json');
  const byId = new Map(base.realizations.map((item) => [item.conceptId, item]));
  const authority = await json('content/word-world/content.json');
  assert.equal(byId.size, authority.records.length);
  for (const record of authority.records) {
    const projected = byId.get(record.id);
    assert.deepEqual(projected.tokenMeanings, record.learnerBase.tokenMeanings, record.id);
    assert.equal(projected.text, record.learnerBase.text, record.id);
    for (const meaning of projected.tokenMeanings) {
      assert.equal(record.tokens[meaning.tokenIndex].surface, meaning.surface);
      assert.equal(meaning.targetLanguage, authority.targetLanguage);
      assert.ok(meaning.text.trim());
    }
  }
});

test('the Spanish-to-English course owns direction, identity, resources and isolated state', async () => {
  const course = await json('course.json');
  assert.equal(course.id, 'es-en');
  assert.equal(course.sourceLanguage.locale, 'es-ES');
  assert.equal(course.targetLanguage.locale, 'en-US');
  assert.equal(course.targetLanguage.speechLocale, 'en-US');
  assert.equal(course.routePrefix, '/es-en');
  assert.equal(course.platforms.browser.enabled, true);
  assert.equal(course.platforms.browser.pagesEnabled, true);
  assert.equal(course.platforms.android.enabled, true);
  assert.equal(course.resources.interfaceCatalog.path, 'apps/language-runtime/static/data/interface/es.v1.json');
  assert.equal(course.resources.interfaceCatalog.revision, (await json('../../language-runtime/static/data/interface/es.v1.json')).revision);
  assert.equal(course.resources.appEntry.scope, 'shared');
  assert.deepEqual(course.games, ['verb-lab', 'word-net', 'conjugation-comet', 'grammar-gravity', 'sound-quasar']);
  assert.deepEqual(availableGameIds(course), ['campaign', ...course.games]);
  assert.deepEqual(CAMPAIGN_GAME_IDS.filter((id) => availableGameIds(course).includes(id)),
    ['verb-lab', 'word-net', 'conjugation-comet', 'grammar-gravity']);
  for (const key of ['generation', 'llm', 'chat', 'dictionary', 'skillCompass', 'memory']) {
    assert.equal(course.capabilities[key], false, key);
  }
  for (const value of Object.values(course.storage)) assert.ok(value.startsWith('caatuu-es-en'), value);
  assert.equal(course.cache.prefix, 'caatuu-es-en-pwa-');
  assert.equal((await json('static/manifest.webmanifest')).lang, 'es-ES');
});

test('Verb Nebula deals and completes English-to-Spanish meaning rounds with English-only image queries', async () => {
  const rows = await json('static/data/games/verb-nebula/content.json');
  const pairs = validateVerbNebulaCatalog(rows, { learnerBaseLanguage: 'es-ES' });
  assert.equal(pairs.length, rows.length);
  for (const [index, pair] of pairs.entries()) {
    assert.equal(pair.target, rows[index].target);
    assert.equal(pair.source, rows[index].source);
    assert.equal(verbHintSearchText(pair), rows[index].englishAuditText);
    assert.notEqual(pair.source, pair.englishAuditText);
  }
  for (const difficulty of [1, 2, 3]) for (const pairCount of [2, 4, 6, 8]) {
    const eligible = filterVerbPairsForDifficulty(pairs, difficulty);
    const { round } = dealVerbRound(eligible, [], pairCount, () => 0.37);
    const meanings = shuffleVerbMeanings(round, () => 0.37);
    assert.equal(round.length, pairCount);
    assert.equal(new Set(meanings.map((pair) => pair.source)).size, pairCount);
    assert.ok(round.every((pair, index) => pair.id !== meanings[index].id));
    assert.ok(round.every((pair) => verbPairMatches(pair.id, meanings.find((item) => item.id === pair.id).id)));
    assert.equal(verbPairMatches(round[0].id, round[1].id), false);
    assert.equal(isVerbRoundComplete(round, new Set(round.map((pair) => pair.id))), true);
  }
});

test('non-English Verb Nebula data fails closed for missing audit, ambiguous meanings, and malformed learner fields', async () => {
  const rows = await json('static/data/games/verb-nebula/content.json');
  const options = { learnerBaseLanguage: 'es-ES' };
  for (const badAudit of [undefined, {}, 42, '']) {
    const invalid = structuredClone(rows); invalid[0].englishAuditText = badAudit;
    assert.throws(() => validateVerbNebulaCatalog(invalid, options), /explicit English audit/u);
  }
  for (const key of ['id', 'target', 'source']) {
    const invalid = structuredClone(rows); invalid[0][key] = {};
    assert.throws(() => validateVerbNebulaCatalog(invalid, options), /authored IDs/u);
  }
  const duplicate = structuredClone(rows); duplicate[1].source = duplicate[0].source;
  assert.throws(() => validateVerbNebulaCatalog(duplicate, options), /distinct authored/u);
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
  const raw = await json('static/data/games/conjugation-comet/content.json');
  const catalog = validateConjugationCometCatalog(raw, {
    expectedCourseId: 'es-en', expectedTargetLanguageId: 'en', expectedLearnerBaseLanguageId: 'es', expectedTargetLocale: 'en-US'
  });
  assert.equal(catalog.verbs.length, raw.verbs.length);
  assert.equal(catalog.review.status, 'native-review-required');
  assert.deepEqual(catalog.license, raw.license);
  for (const verb of catalog.verbs) {
    assert.ok(verb.englishAuditText);
    assert.notEqual(verb.learnerBaseText, verb.englishAuditText);
    assert.equal(verb.forms.length, raw.verbs.find(row => row.id === verb.id).forms.length);
    const round = buildConjugationHelixRound(catalog, verb.id, { rng: () => 0.37 });
    assert.ok(Array.from({ length: verb.forms.length }, (_, offset) => judgeConjugationHelixRound(round, 0, offset)).some((result) => result.correct), verb.id);
    for (const form of verb.forms) {
      assert.notEqual(form.learnerBaseCueText, form.englishAuditText);
      assert.ok(form.targetPhraseFrame.beforeText.endsWith(' '));
    }
  }
  assert.throws(() => validateConjugationCometCatalog(raw, { expectedLearnerBaseLanguageId: 'en' }), /learner base/u);
});

test('English grammar uses number and subject agreement with Spanish phrase presentation', async () => {
  const options = { courseId: 'es-en', learnerBaseLanguage: 'es-ES', targetLanguage: 'en-US' };
  const raw = await json('static/data/games/grammar-gravity/content.json');
  const grammar = normalizeGrammarGravityPack(raw, options);
  assert.equal(grammar.challenges.length, raw.challenges.length);
  assert.equal(grammar.schemaVersion, 'caatuu-grammar-gravity-content-v3');
  assert.equal(grammar.gameplay.categoryFeature, 'number');
  assert.deepEqual(grammar.gameplay.stages, ['meaning', 'category', 'form']);
  assert.deepEqual(grammar.axes.map((axis) => axis.id), ['singular', 'plural']);
  assert.ok(grammar.axes.every((axis) => !Object.hasOwn(axis.features, 'gender')));
  const authoredExamples = new Map(raw.challenges.flatMap(challenge => Object.values(challenge.forms)
    .flatMap(form => form.examples)).map(example => [example.id, example]));
  for (const difficulty of [1, 2, 3]) {
    const rounds = buildGrammarGravityRounds(grammar, difficulty);
    assert.ok(rounds.length > 0);
    for (const round of rounds) for (const flight of round.flights) {
      const authored = authoredExamples.get(flight.id);
      assert.equal(flight.learnerBaseText, authored.learnerBaseText);
      assert.equal(flight.anchorMeaning, authored.anchor.learnerBaseText);
      assert.equal(flight.beforeText + flight.answer + flight.afterText, flight.targetText);
      assert.ok(['singular', 'plural'].includes(flight.categoryId));
    }
  }
  assert.equal(buildGrammarGravityRounds(grammar, 3).length,
    raw.challenges.flatMap(challenge => Object.values(challenge.forms).flatMap(form => form.examples)).length);
  const nounSource = await json('static/data/games/grammar-gravity/nouns.json');
  const nouns = normalizeNounLandingPack(nounSource, options);
  assert.equal(nouns.items.length, nounSource.items.length);
  assert.deepEqual(nouns.lanes.map((lane) => lane.id), ['singular', 'plural']);
  for (const item of nouns.items) {
    const authored = nounSource.items.find(row => row.id === item.id);
    assert.equal(item.laneId, authored.laneId);
    assert.equal(item.learnerBaseText, authored.learnerBaseText);
  }
  const wrongBase = structuredClone(raw); wrongBase.learnerBaseLanguage = 'en';
  assert.throws(() => normalizeGrammarGravityPack(wrongBase, options), /learner|base/u);
});

test('Sounds uses Spanish meanings and exact English targets with finite source provenance', async () => {
  const raw = await json('static/data/games/sound-quasar/content.json');
  const sounds = validateSoundQuasarCatalog(raw, { courseId: 'es-en', targetLanguageId: 'en', learnerBaseLanguage: 'es-ES' });
  assert.equal(raw.learnerBaseLanguage, 'es-ES');
  assert.equal(raw.auditLanguage, 'en');
  assert.equal(sounds.audio.locale, 'en-US');
  assert.equal(sounds.audio.reviewStatus, 'unreviewed');
  const vocabulary = await json('static/data/games/verb-nebula/content.json');
  const byId = new Map(vocabulary.map((item) => [item.id, item]));
  const sentences = await json('content/word-world/content.json');
  const sentencesById = new Map(sentences.records.map(row => [row.id, row]));
  assert.equal(sounds.items.length, raw.items.length);
  assert.equal(sounds.sentences.length, raw.sentences.length);
  for (const item of sounds.items) {
    if (item.sourceKind === 'authored-listening') continue;
    const source = byId.get(item.sourceId);
    assert.equal(item.target, source.target);
    assert.equal(item.meaning, source.source);
    assert.equal(item.englishAuditText, source.englishAuditText);
  }
  for (const item of sounds.sentences) {
    if (item.sourceKind === 'authored-listening') continue;
    const authored = sentencesById.get(item.sourceId);
    assert.ok(authored, `${item.id}: missing sentence authority`);
    assert.equal(item.meaning, authored.learnerBase.text);
    assert.equal(item.target, authored.targetText);
  }
  for (const item of [...sounds.items, ...sounds.sentences]) {
    assert.ok(item.meaning.trim()); // Different languages can legitimately share a surface.
    assert.equal(item.englishAuditText, item.target);
    if (item.sourceKind === 'authored-listening') {
      assert.equal(item.sourceId, item.id);
      assert.equal(item.sourceReviewStatus, sounds.authoredProvenance.reviewStatus);
    } else assert.equal(item.sourceReviewStatus, 'native-review-required');
  }
});
