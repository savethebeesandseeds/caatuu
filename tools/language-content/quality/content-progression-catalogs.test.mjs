import assert from 'node:assert/strict';
import test from 'node:test';
import { progressionRecords, validateProgressionCatalog } from './content-progression-catalogs.mjs';
import { proposeProgression } from './content-progression-rubric.mjs';
import { migrateProgressionRecord, stripProgression, matchingListeningSource } from './content-progression-review.mjs';

const graded = extra => ({ usefulness: 78, complexity: 24, ...extra });

test('nested independent examples must each carry both numbers', () => {
  const document = { challenges: [graded({ difficulty: 1,
    forms: { singular: graded({ examples: [graded({ id: 'synthetic.example' })] }) } })] };
  assert.equal(validateProgressionCatalog('grammar-gravity', document).length, 3);
  delete document.challenges[0].forms.singular.examples[0].usefulness;
  assert.throws(() => validateProgressionCatalog('grammar-gravity', document), /examples\[0\].*usefulness/u);
});

test('case context metadata is required without changing string answer pools', () => {
  const forms = ['form-a', 'form-b'];
  const document = { legacyNouns: [graded({ cases: { Nominative: graded({}) } })],
    paradigms: [graded({ forms })], contexts: [graded({})] };
  assert.equal(validateProgressionCatalog('case-cosmos', document).length, 4);
  assert.deepEqual(document.paradigms[0].forms, forms);
});

test('invalid grading numbers and badges fail while legacy absent badges survive', () => {
  for (const field of ['usefulness','complexity']) for (const invalid of [0, 101, 2.5, NaN, '2', null]) {
    assert.throws(() => validateProgressionCatalog('verb-nebula', [graded({ [field]: invalid })]), new RegExp(field));
  }
  assert.doesNotThrow(() => validateProgressionCatalog('verb-nebula', [graded({})]));
  assert.throws(() => validateProgressionCatalog('verb-nebula', [graded({ difficulty: 4 })]), /badge/u);
  assert.doesNotThrow(() => validateProgressionCatalog('verb-nebula', [graded({ usefulness: 1, complexity: 100 })]));
  for (const field of ['urgency', 'subdifficulty']) {
    assert.throws(() => validateProgressionCatalog('verb-nebula', [graded({ [field]: 3 })]), /obsolete/u);
  }
});

test('non-learning metadata objects are excluded from the inventory', () => {
  const item = graded({ difficulty: 1, provenance: { id: 'review' }, tokens: [{ gloss: 'hint' }] });
  assert.equal(progressionRecords('word-world', { records: [item] }).length, 1);
});

test('editorial task demand can vary independently from a retained badge', () => {
  const parent = { difficulty: 1, id: 'synthetic.family', forms: [] };
  const simple = proposeProgression({ kind: 'conjugation-form', item: {}, parent: { ...parent, family: 'regular' }, detail: 'first-singular' });
  const complex = proposeProgression({ kind: 'conjugation-form', item: {}, parent: { ...parent, family: 'irregular' }, detail: 'third-plural-formal' });
  assert.ok(complex.complexity > simple.complexity);
  assert.equal(parent.difficulty, 1);
});

test('agreement grading distinguishes a bare phrase, a finite clause, past tense and added setting', () => {
  const english = ['a blue cup', 'We see a blue cup.', 'We saw a blue cup.', 'We saw a blue cup near the door.'];
  const translations = {
    nb: ['en blå kopp', 'Vi ser en blå kopp.', 'Vi så en blå kopp.', 'Vi så en blå kopp ved døren.'],
    cz: ['modrý hrnek', 'Vidíme modrý hrnek.', 'Viděli jsme modrý hrnek.', 'Viděli jsme modrý hrnek u dveří.'],
    es: ['una taza azul', 'Vemos una taza azul.', 'Vimos una taza azul.', 'Vimos una taza azul junto a la puerta.'],
    'es-en': english
  };
  const parent = { id: 'synthetic.agreement', difficulty: 1 };
  for (const [courseId, targets] of Object.entries(translations)) {
    const scores = targets.map((targetText, index) => proposeProgression({
      kind: 'agreement-example', parent, courseId,
      item: { targetText, englishAuditText: english[index], learnerBaseText: 'Separate learner translation' }
    }).complexity);
    for (let index = 1; index < scores.length; index += 1) {
      assert.ok(scores[index] > scores[index - 1], `${courseId}: added grammatical demand must raise the proposal`);
    }
  }
});

test('agreement context grading recognizes regular past tense without using length alone', () => {
  const grade = englishAuditText => proposeProgression({ kind: 'agreement-example', courseId: 'es-en',
    parent: { id: 'synthetic.agreement', difficulty: 1 }, item: { englishAuditText, targetText: englishAuditText } }).complexity;
  assert.ok(grade('They painted a blue box.') > grade('They paint a blue box.'));
  assert.ok(grade('They paint a blue box.') > grade('a blue box'));
  assert.ok(grade('They paint a blue box near the door.') > grade('They paint a blue box.'));
  assert.equal(grade('a painted wooden box'), grade('a wooden painted box'), 'an attributive past participle is not a past-tense clause');
});

test('whole-example regrading is explicit and preserves authored grades during normal migration', () => {
  const record = { kind: 'agreement-example', parent: { id: 'synthetic.agreement', difficulty: 1 },
    item: { id: 'synthetic.context', englishAuditText: 'We saw a blue cup near the door.',
      targetText: 'Vi så en blå kopp ved døren.', usefulness: 88, complexity: 9 } };
  const retained = stripProgression(structuredClone(record.item));
  migrateProgressionRecord(record, { courseId: 'nb' });
  assert.equal(record.item.usefulness, 88);
  assert.equal(record.item.complexity, 9);
  migrateProgressionRecord(record, { courseId: 'nb', regrade: true });
  const bare = proposeProgression({ kind: 'agreement-example', parent: record.parent, courseId: 'nb',
    item: { targetText: 'en blå kopp', englishAuditText: 'a blue cup' } });
  assert.ok(record.item.complexity > bare.complexity);
  assert.deepEqual(stripProgression(record.item), retained);
});

test('migration preserves authored new scores and all retained data on repeat runs', () => {
  const record = { kind: 'lexeme', item: { id: 'example', difficulty: 2, meaning: 'walk', urgency: 5, subdifficulty: 4,
    usefulness: 83, complexity: 37, annotations: { note: 'retained' }, tokens: ['retained'] } };
  const retained = stripProgression(structuredClone(record.item));
  migrateProgressionRecord(record);
  assert.equal(record.item.usefulness, 83);
  assert.equal(record.item.complexity, 37);
  assert.deepEqual(stripProgression(record.item), retained);
  assert.ok(!Object.hasOwn(record.item, 'urgency') && !Object.hasOwn(record.item, 'subdifficulty'));
  const migrated = structuredClone(record.item);
  migrateProgressionRecord(record);
  assert.deepEqual(record.item, migrated);
  assert.throws(() => migrateProgressionRecord({ kind: 'lexeme', item: { usefulness: 0 } }), /invalid existing/u);
});

test('semantic regrading is independent of old buckets and unrelated record identifiers', () => {
  const first = { kind: 'sentence', item: { id: 'first', englishText: 'Please speak slowly.', difficulty: 1, urgency: 1, subdifficulty: 5 } };
  const second = structuredClone(first);
  Object.assign(second.item, { id: 'unrelated', urgency: 5, subdifficulty: 1 });
  migrateProgressionRecord(first);
  migrateProgressionRecord(second);
  assert.equal(first.item.usefulness, second.item.usefulness);
  assert.equal(first.item.complexity, second.item.complexity);
});

test('matching listening sources inherit scores while independent contrasts retain their task demand', () => {
  const linked = { targetText: 'target', englishText: 'meaning', difficulty: 1, usefulness: 87, complexity: 19 };
  const record = { kind: 'listening-sentence', item: { sourceId: 'source', target: 'target', englishAuditText: 'meaning', difficulty: 1 } };
  const sources = { 'listening-sentence': new Map([['source', linked]]) };
  assert.equal(matchingListeningSource(record, sources), linked);
  migrateProgressionRecord(record, { linked });
  assert.equal(record.item.usefulness, 87);
  assert.equal(record.item.complexity, 19);
  const contrast = { kind: 'listening-sentence', item: { ...record.item, contrastGroupId: 'contrast', complexity: 48 } };
  migrateProgressionRecord(contrast, { linked });
  assert.equal(contrast.item.complexity, 48);
  record.item.target = 'changed';
  assert.equal(matchingListeningSource(record, sources), null);
});
