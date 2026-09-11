import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { normalizeGrammarGravityPack, buildGrammarGravityRounds }
  from '../../../language-runtime/static/source/games/grammar-gravity/grammar-gravity-core.mjs';

const languagesRoot = new URL('../../', import.meta.url);
const json = async path => JSON.parse(await readFile(new URL(path, languagesRoot), 'utf8'));
const courseCases = [
  { id: 'cz', directory: 'czech', category: 'gender' },
  { id: 'es', directory: 'spanish', category: 'gender' },
  { id: 'es-en', directory: 'english-from-spanish', category: 'number' }
];
const allExamples = pack => pack.challenges.flatMap(challenge => Object.values(challenge.forms).flatMap(form => form.examples));

for (const entry of courseCases) {
  test(`${entry.id}: normalization and all badge queues preserve every authored grammar example`, async () => {
    const raw = await json(`${entry.directory}/static/data/games/grammar-gravity/content.json`);
    const pack = normalizeGrammarGravityPack(raw, { courseId: entry.id });
    const nouns = await json(`${entry.directory}/static/data/games/grammar-gravity/nouns.json`);
    assert.deepEqual(pack.challenges.map(row => row.id), raw.challenges.map(row => row.id));
    assert.deepEqual(pack.review, raw.review);
    assert.deepEqual(pack.license, raw.license);
    assert.equal(pack.gameplay.categoryFeature, entry.category);
    assert.deepEqual(pack.gameplay.categoryOptions, nouns.lanes);
    assert.deepEqual(pack.gameplay.stages, ['meaning', 'category', 'form']);
    const byId = new Map(allExamples(raw).map(example => [example.id, example]));
    for (const level of [1, 2, 3]) {
      const rounds = buildGrammarGravityRounds(pack, level, () => 0.37);
      const eligible = raw.challenges.filter(challenge => challenge.difficulty <= level)
        .flatMap(challenge => Object.values(challenge.forms).flatMap(form => form.examples));
      assert.equal(rounds.length, eligible.length);
      assert.deepEqual(new Set(rounds.map(row => row.id)), new Set(eligible.map(row => row.id)));
      for (const round of rounds) {
        const challenge = raw.challenges.find(row => row.id === round.challengeId);
        const authored = byId.get(round.id);
        assert.deepEqual(round.stages, (challenge.gameplay || raw.gameplay).stages);
        assert.equal(round.flights.length, 1);
        const flight = round.flights[0];
        assert.equal(flight.targetText, authored.targetText);
        assert.equal(flight.learnerBaseText, authored.learnerBaseText);
        assert.equal(flight.anchorText, authored.anchor.targetText);
        assert.equal(flight.anchorMeaning, authored.anchor.learnerBaseText);
        assert.equal(flight.anchorEnglishAuditText, authored.anchor.englishAuditText);
        assert.equal(flight.beforeText, authored.slot.beforeText);
        assert.equal(flight.afterText, authored.slot.afterText);
        assert.ok(new Set(flight.options).size >= 2, round.id);
        assert.ok(new Set(flight.meaningOptions).size >= 2, round.id);
        assert.equal(flight.options.filter(value => value === flight.answer).length, 1);
        assert.equal(flight.beforeText + flight.answer + flight.afterText, flight.targetText);
        assert.ok([flight.beforeText, flight.afterText].some(text => text.includes(flight.anchorText)), round.id);
      }
    }
  });
}

test('Spanish determiner rounds use the authored noun anchor rather than the completed phrase as their meaning cue', async () => {
  const raw = await json('spanish/static/data/games/grammar-gravity/content.json');
  const pack = normalizeGrammarGravityPack(raw, { courseId: 'es' });
  const families = pack.challenges.filter(challenge => challenge.focus.kind === 'determiner');
  assert.ok(families.length > 0);
  const examples = new Map(families.flatMap(challenge => Object.values(challenge.forms).flatMap(form => form.examples)).map(row => [row.id, row]));
  for (const round of buildGrammarGravityRounds(pack, 3, () => 0.37).filter(row => examples.has(row.id))) {
    const example = examples.get(round.id), flight = round.flights[0];
    assert.equal(flight.anchorMeaning, example.anchor.learnerBaseText);
    assert.equal(flight.anchorEnglishAuditText, example.anchor.englishAuditText);
    assert.notEqual(example.anchor.targetText, example.targetText);
    assert.ok(example.slot.beforeText.includes(example.anchor.targetText) || example.slot.afterText.includes(example.anchor.targetText));
  }
});

test('English form questions preserve arbitrary Spanish anchors and complete predicate frames', async () => {
  const pack = normalizeGrammarGravityPack(await json('english-from-spanish/static/data/games/grammar-gravity/content.json'), { courseId: 'es-en' });
  const example = pack.challenges[0].forms[pack.axes[0].id].examples[0];
  const changed = structuredClone(pack);
  const changedExample = changed.challenges[0].forms[changed.axes[0].id].examples[0];
  changedExample.anchor.learnerBaseText = 'synthetic-context-cue';
  const rounds = buildGrammarGravityRounds(changed, 3, () => 0.37);
  const flight = rounds.find(row => row.id === example.id).flights[0];
  assert.equal(flight.anchorMeaning, 'synthetic-context-cue');
  assert.equal(flight.targetText, example.targetText);
  assert.equal(flight.beforeText + flight.answer + flight.afterText, example.targetText);
});
