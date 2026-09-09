import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { validateConjugationCometCatalog, buildConjugationHelixRound, judgeConjugationHelixPair } from '../../../apps/language-runtime/static/source/games/conjugation-comet/conjugation-comet-core.mjs';
import { validateSoundQuasarCatalog, soundQuasarItemsForDifficulty } from '../../../apps/language-runtime/static/source/games/sound-quasar/sound-quasar-core.mjs';
import { normalizeNounLandingPack } from '../../../apps/language-runtime/static/source/games/grammar-gravity/noun-landing-core.mjs';
import { extractCoreVerbPairs } from '../../../apps/language-runtime/static/source/games/verb-nebula/verb-nebula-core.mjs';

const root = new URL('../../../', import.meta.url);
const read = async file => JSON.parse(await readFile(new URL(file, root), 'utf8'));
const course = await read('apps/languages/norwegian-bokmal/course.json');
const resource = key => read(course.resources[key].path);

test('Bokmål course declares only applicable games and separate English learner/target roles', () => {
  assert.equal(course.sourceLanguage.locale, 'en');
  assert.equal(course.targetLanguage.locale, 'nb-NO');
  assert.equal(course.targetLanguage.speechLocale, 'nb-NO');
  assert.equal(course.publication.runtimeProjection.policyId, 'norwegian-bokmal-word-world-v1');
  assert.deepEqual(new Set(course.games), new Set(['verb-lab', 'word-net', 'conjugation-comet', 'grammar-gravity', 'sound-quasar']));
  assert.equal(course.status, 'development');
  assert.equal(course.capabilities.pronunciationGuides, false);
});

test('every Bokmål tense paradigm produces a solvable four-form helix', async () => {
  const catalog = validateConjugationCometCatalog(await resource('conjugationCometCatalog'), { expectedCourseId: course.id, expectedTargetLanguageId: course.targetLanguage.id });
  for (const level of [1, 2, 3]) assert.ok(catalog.verbs.some(verb => verb.difficulty === level));
  for (const verb of catalog.verbs) {
    assert.deepEqual(new Set(verb.forms.map(form => form.id)), new Set(['infinitive', 'present', 'preterite', 'perfect']));
    const round = buildConjugationHelixRound(catalog, verb.id, { rng: () => 0.37 });
    assert.equal(round.subjects.length, 4);
    for (const subject of round.subjects) {
      assert.ok(round.options.some(option => judgeConjugationHelixPair(round, subject.id, option.id)), `${verb.id}/${subject.id}`);
      assert.ok(round.options.some(option => !judgeConjugationHelixPair(round, subject.id, option.id)), `${verb.id}/${subject.id} has meaningful distractors`);
    }
  }
});

test('Bokmål listening records preserve the authored source text, gloss, IDs, and levels', async () => {
  const verbs = await resource('verbNebulaCatalog');
  const wordWorld = await read('apps/languages/norwegian-bokmal/content/word-world/content.json');
  const sounds = validateSoundQuasarCatalog(await resource('soundQuasarCatalog'), { courseId: course.id, targetLanguageId: course.targetLanguage.id, learnerBaseLanguage: 'en' });
  assert.equal(extractCoreVerbPairs(verbs, { learnerBaseLanguage: 'en' }).length, verbs.length);
  const sources = [new Map(verbs.map(item => [item.id, { text: item.target, english: item.source, difficulty: item.difficulty }])), new Map(wordWorld.records.map(item => [item.id, { text: item.targetText, english: item.englishText, difficulty: item.difficulty }]))];
  for (const [index, items] of [sounds.items, sounds.sentences].entries()) {
    assert.equal(items.length, sources[index].size);
    for (const item of items) {
      const source = sources[index].get(item.sourceId);
      assert.ok(source, item.id);
      assert.equal(item.target, source.text);
      assert.equal(item.meaning, source.english);
      assert.equal(item.difficulty, source.difficulty);
    }
  }
  for (const mode of ['words', 'sentences']) for (const difficulty of [1, 2, 3]) {
    const eligible = soundQuasarItemsForDifficulty(sounds, { mode, difficulty });
    assert.ok(eligible.length >= 4);
    assert.ok(eligible.every(item => item.difficulty <= difficulty));
  }
});

test('Bokmål noun bank has bare nouns and permits documented grammatical alternatives', async () => {
  const pack = normalizeNounLandingPack(await resource('grammarGravityNouns'), { courseId: course.id, targetLanguage: course.targetLanguage.locale, learnerBaseLanguage: course.sourceLanguage.locale });
  assert.deepEqual(new Set(pack.lanes.map(lane => lane.id)), new Set(['masculine', 'feminine', 'neuter']));
  for (const level of [1, 2, 3]) assert.ok(pack.items.some(item => item.difficulty === level));
  assert.ok(pack.items.some(item => item.acceptedLaneIds?.length > 1));
  for (const item of pack.items) assert.doesNotMatch(item.targetText, /^(?:en|ei|et)\s/u, item.id);
});

test('listening English provenance binds the new per-course English catalog', async () => {
  const source = await resource('soundQuasarCatalog');
  assert.equal(source.sentenceProvenance.englishSourcePath, course.publication.concepts);
  assert.doesNotThrow(() => validateSoundQuasarCatalog(source));
  const wrongCourse = structuredClone(source);
  wrongCourse.sentenceProvenance.englishSourcePath = 'apps/languages/shared/english-concepts/word-world-es-v1.json';
  assert.throws(() => validateSoundQuasarCatalog(wrongCourse), /English provenance/);
  const escaped = structuredClone(source);
  escaped.sentenceProvenance.englishSourcePath = '../word-world-nb-v1.json';
  assert.throws(() => validateSoundQuasarCatalog(escaped), /English provenance/);
});
