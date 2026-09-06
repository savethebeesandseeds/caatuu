import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  normalizeGrammarGravityPack,
  buildGrammarGravityRounds
} from '../../../language-runtime/static/source/games/grammar-gravity/grammar-gravity-core.mjs';

const languagesRoot = new URL('../../', import.meta.url);
const json = async (path) => JSON.parse(await readFile(new URL(path, languagesRoot), 'utf8'));
const courseCases = [
  { id: 'cz', directory: 'czech', challenges: 18, examples: 162, category: 'gender', fingerprint: '30ab958f8b72f1d012bb91764b1dfec40091f9ff4c30287ff102b3d97aa21d0c' },
  { id: 'es', directory: 'spanish', challenges: 8, examples: 64, category: 'gender', fingerprint: 'b820b8837d881ffaa069764db120b08695b6c06d90c48dccd5d30f52ec781dc3' },
  { id: 'es-en', directory: 'english-from-spanish', challenges: 6, examples: 24, category: 'number', fingerprint: 'f06eb813db58d0025b3b0eb6000048670449a41844f195201afd34461ecfa3cc' }
];
const allExamples = (pack) => pack.challenges.flatMap((challenge) => Object.values(challenge.forms).flatMap((form) => form.examples));

// These fingerprints were recorded from the normalized pre-migration corpus.
// They guard every existing phrase, stable ID, focus, level, adjective noun
// meaning, and review/license declaration without retaining an old renderer or
// old-format fixture. Intentional curriculum edits require reviewing this record.
function retainedCorpus(pack) {
  return {
    courseId: pack.courseId, contentId: pack.contentId, status: pack.status,
    learnerBaseLanguage: pack.learnerBaseLanguage, targetLanguage: pack.targetLanguage,
    englishAuditLanguage: pack.englishAuditLanguage, review: pack.review, license: pack.license,
    challenges: pack.challenges.map((challenge) => ({
      id: challenge.id, revision: challenge.revision, difficulty: challenge.difficulty,
      focus: challenge.focus,
      forms: Object.fromEntries(Object.entries(challenge.forms).map(([axisId, form]) => [axisId, {
        displayForm: form.displayForm,
        examples: form.examples.map((example) => ({
          id: example.id, revision: example.revision, learnerBaseText: example.learnerBaseText,
          englishAuditText: example.englishAuditText, targetText: example.targetText,
          ...(challenge.focus.kind === 'adjective' ? { anchorMeaning: {
            learnerBaseText: example.anchor.learnerBaseText,
            englishAuditText: example.anchor.englishAuditText
          } } : {})
        }))
      }]))
    }))
  };
}

for (const entry of courseCases) {
  test(`${entry.id}: the modern sequence preserves and plays the complete existing grammar corpus`, async () => {
    const pack = normalizeGrammarGravityPack(await json(`${entry.directory}/static/data/games/grammar-gravity/challenges.json`), { courseId: entry.id });
    const nouns = await json(`${entry.directory}/static/data/games/grammar-gravity/nouns.json`);
    assert.equal(createHash('sha256').update(JSON.stringify(retainedCorpus(pack))).digest('hex'), entry.fingerprint);
    assert.equal(pack.challenges.length, entry.challenges);
    assert.equal(allExamples(pack).length, entry.examples);
    assert.equal(pack.gameplay.categoryFeature, entry.category);
    assert.deepEqual(pack.gameplay.categoryOptions, nouns.lanes);
    assert.deepEqual(pack.gameplay.stages, ['meaning', 'category', 'form']);
    const maximumRounds = buildGrammarGravityRounds(pack, 3, () => 0.37);
    assert.deepEqual(new Set(maximumRounds.map((round) => round.id)), new Set(allExamples(pack).map((example) => example.id)));
    assert.equal(maximumRounds.length, entry.examples);
    for (const level of [1, 2, 3]) {
      const rounds = buildGrammarGravityRounds(pack, level, () => 0.37);
      const eligibleExamples = pack.challenges.filter((challenge) => challenge.difficulty <= level).flatMap((challenge) => Object.values(challenge.forms).flatMap((form) => form.examples));
      assert.equal(rounds.length, eligibleExamples.length, `No challenge family disappears at level ${level}`);
      for (const round of rounds) {
        assert.deepEqual(round.stages, ['meaning', 'category', 'form']);
        assert.equal(round.flights.length, 1);
        const flight = round.flights[0];
        assert.ok(new Set(flight.options).size >= 2, round.id);
        assert.ok(new Set(flight.meaningOptions).size >= 2, round.id);
        assert.equal(flight.options.filter((value) => value === flight.answer).length, 1);
        assert.equal(flight.beforeText + flight.answer + flight.afterText, flight.targetText);
        assert.ok([flight.beforeText, flight.afterText].some((text) => text.includes(flight.anchorText)), round.id);
      }
    }
  });
}

test('Spanish determiner families retain all 24 examples with noun meanings that do not reveal the assessed determiner', async () => {
  const pack = await json('spanish/static/data/games/grammar-gravity/challenges.json');
  const anchors = {
    problema: 'problem', mapa: 'map', mano: 'hand', foto: 'photograph',
    problemas: 'problems', mapas: 'maps', manos: 'hands', fotos: 'photographs',
    libro: 'book', coche: 'car', mesa: 'table', calle: 'street',
    libros: 'books', coches: 'cars', mesas: 'tables', calles: 'streets',
    día: 'day', idioma: 'language', noche: 'night', clase: 'class',
    días: 'days', idiomas: 'languages', noches: 'nights', clases: 'classes'
  };
  const families = pack.challenges.filter((challenge) => challenge.focus.kind === 'determiner');
  assert.deepEqual(families.map((challenge) => challenge.id), [
    'es.agreement.determiner-definite-surprises',
    'es.agreement.determiner-demonstrative-este',
    'es.agreement.determiner-indefinite'
  ]);
  const examples = families.flatMap((challenge) => Object.values(challenge.forms).flatMap((form) => form.examples));
  assert.equal(examples.length, 24);
  assert.deepEqual(new Set(examples.map((example) => example.anchor.targetText)), new Set(Object.keys(anchors)));
  for (const example of examples) {
    assert.equal(example.anchor.learnerBaseText, anchors[example.anchor.targetText]);
    assert.equal(example.anchor.englishAuditText, anchors[example.anchor.targetText]);
    assert.equal(example.slot.beforeText, '');
    assert.ok(example.slot.afterText.startsWith(` ${example.anchor.targetText}`));
    assert.equal(example.anchor.targetText.split(' ').length, 1);
  }
});

test('English form questions keep explicit subject/noun anchors, Spanish meanings and complete predicate context', async () => {
  const pack = await json('english-from-spanish/static/data/games/grammar-gravity/challenges.json');
  const expected = [
    ['this book', 'book', 'libro', '', ' book'],
    ['this apple', 'apple', 'manzana', '', ' apple'],
    ['these books', 'books', 'libros', '', ' books'],
    ['these apples', 'apples', 'manzanas', '', ' apples'],
    ['that chair', 'chair', 'silla', '', ' chair'],
    ['that window', 'window', 'ventana', '', ' window'],
    ['those chairs', 'chairs', 'sillas', '', ' chairs'],
    ['those windows', 'windows', 'ventanas', '', ' windows'],
    ['The dog is quiet.', 'The dog', 'El perro', 'The dog ', ' quiet.'],
    ['The room is clean.', 'The room', 'La habitación', 'The room ', ' clean.'],
    ['The dogs are quiet.', 'The dogs', 'Los perros', 'The dogs ', ' quiet.'],
    ['The rooms are clean.', 'The rooms', 'Las habitaciones', 'The rooms ', ' clean.'],
    ['The girl has a book.', 'The girl', 'La niña', 'The girl ', ' a book.'],
    ['The teacher has a pen.', 'The teacher', 'El profesor', 'The teacher ', ' a pen.'],
    ['The girls have books.', 'The girls', 'Las niñas', 'The girls ', ' books.'],
    ['The teachers have pens.', 'The teachers', 'Los profesores', 'The teachers ', ' pens.'],
    ['The shop was open.', 'The shop', 'La tienda', 'The shop ', ' open.'],
    ['The student was tired.', 'The student', 'El estudiante', 'The student ', ' tired.'],
    ['The shops were open.', 'The shops', 'Las tiendas', 'The shops ', ' open.'],
    ['The students were tired.', 'The students', 'Los estudiantes', 'The students ', ' tired.'],
    ['The child does not eat rice.', 'The child', 'El niño', 'The child ', ' eat rice.'],
    ['The bus does not stop here.', 'The bus', 'El autobús', 'The bus ', ' stop here.'],
    ['The children do not eat rice.', 'The children', 'Los niños', 'The children ', ' eat rice.'],
    ['The buses do not stop here.', 'The buses', 'Los autobuses', 'The buses ', ' stop here.']
  ];
  const examples = allExamples(pack);
  assert.equal(examples.length, expected.length);
  const byTarget = new Map(examples.map((example) => [example.targetText, example]));
  for (const [targetText, anchorText, learnerBaseText, beforeText, afterText] of expected) {
    const example = byTarget.get(targetText);
    assert.deepEqual(example.anchor, { targetText: anchorText, learnerBaseText, englishAuditText: anchorText }, targetText);
    assert.deepEqual(example.slot, { beforeText, afterText }, targetText);
  }
  assert.deepEqual(pack.challenges.map((challenge) => challenge.focus.kind), ['determiner', 'determiner', 'subject-agreement', 'subject-agreement', 'subject-agreement', 'subject-agreement']);
});
