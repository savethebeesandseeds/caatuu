import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  validateConjugationCometCatalog, buildConjugationFormRound,
  buildConjugationMeaningRound, buildConjugationHelixRound, judgeConjugationHelixRound
} from '../static/source/games/conjugation-comet/conjugation-comet-core.mjs';
import { normalizeGrammarGravityPack, buildGrammarGravityRounds } from '../static/source/games/grammar-gravity/grammar-gravity-core.mjs';
import { normalizeNounLandingPack, createNounLandingSession, setNounFallDuration } from '../static/source/games/grammar-gravity/noun-landing-core.mjs';

const languages = ['czech', 'spanish', 'english-from-spanish', 'norwegian-bokmal', 'arabic-standard', 'latin-scientific', 'georgian'];
const read = async (language, game, filename = 'content.json') => JSON.parse(await readFile(new URL(`../../languages/${language}/static/data/games/${game}/${filename}`, import.meta.url), 'utf8'));
const czechAuthority = { expectedCourseId: 'cz', expectedTargetLanguageId: 'cs', expectedLearnerBaseLanguageId: 'en', expectedTargetLocale: 'cs-CZ' };

for (const language of languages) {
  test(`${language}: zero conjugation keeps the normal full board, choice setting and solvable alignment`, async () => {
    const raw = await read(language, 'conjugation-comet');
    const bank = validateConjugationCometCatalog(raw, language === 'czech' ? czechAuthority : {});
    const ordinarySize = bank.verbs.find(verb => verb.difficulty === 1).forms.length;
    const zero = bank.verbs.filter(verb => verb.difficulty === 0);
    assert.ok(zero.length);
    for (const verb of zero) {
      assert.equal(verb.forms.length, ordinarySize, `${verb.id}: full authored course paradigm`);
      const forms = buildConjugationFormRound(bank, verb.id, { random: () => .37 });
      assert.equal(forms.targetForms.length, ordinarySize);
      for (const optionCount of [4, 6]) {
        const meaning = buildConjugationMeaningRound(bank, verb.id, { optionCount, random: () => .37 });
        assert.equal(meaning.options.length, optionCount);
        assert.ok(meaning.options.some(option => option.id === meaning.answerId));
      }
      for (const value of [.17, .63]) {
        const helix = buildConjugationHelixRound(bank, verb.id, { rng: () => value });
        assert.equal(helix.subjects.length, ordinarySize);
        assert.equal(helix.options.length, ordinarySize);
        assert.ok(helix.options.some((_, offset) => judgeConjugationHelixRound(helix, 0, offset).correct), `${verb.id}: the complete board can be solved`);
      }
    }
  });

  test(`${language}: zero grammar uses the complete course contrasts and ordinary authored stages`, async () => {
    const raw = await read(language, 'grammar-gravity');
    const pack = normalizeGrammarGravityPack(raw, { courseId: raw.courseId, learnerBaseLanguage: raw.learnerBaseLanguage, targetLanguage: raw.targetLanguage });
    const rounds = buildGrammarGravityRounds(pack, 0, () => .37);
    assert.ok(rounds.length);
    for (const round of rounds) {
      const challenge = pack.challenges.find(item => item.id === round.challengeId);
      assert.deepEqual(new Set(Object.keys(challenge.forms)), new Set(pack.axes.map(axis => axis.id)));
      assert.deepEqual(round.stages, pack.gameplay.stages);
      const alternatives = new Set(Object.values(challenge.forms).map(form => form.displayForm));
      for (const flight of round.flights) {
        assert.deepEqual(new Set(flight.options), alternatives);
        assert.deepEqual(flight.categoryOptions, pack.gameplay.categoryOptions);
        assert.ok(flight.options.includes(flight.answer));
        assert.equal(flight.meaningOptions.length, 3);
        assert.ok(flight.meaningOptions.includes(flight.anchorMeaning));
      }
    }
  });

  test(`${language}: zero noun practice respects the same timed and untimed settings`, async () => {
    const raw = await read(language, 'grammar-gravity', 'nouns.json');
    const pack = normalizeNounLandingPack(raw, { courseId: raw.courseId, learnerBaseLanguage: raw.learnerBaseLanguage, targetLanguage: raw.targetLanguage });
    for (const durationMs of [0, 5000, 10000, 15000, 20000]) {
      const session = createNounLandingSession(pack, { difficulty: 0, durationMs, random: () => .37 });
      assert.equal(session.durationMs, durationMs);
      assert.deepEqual(session.lanes, pack.lanes);
      const nextDuration = durationMs === 5000 ? 0 : 5000;
      assert.equal(setNounFallDuration(session, nextDuration).durationMs, nextDuration);
    }
  });
}
