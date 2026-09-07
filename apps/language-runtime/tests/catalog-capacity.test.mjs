import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { validateSoundQuasarCatalog, createSoundQuasarSession } from '../static/source/games/sound-quasar/sound-quasar-core.mjs';
import { normalizeGrammarGravityPack, buildGrammarGravityRounds } from '../static/source/games/grammar-gravity/grammar-gravity-core.mjs';
import { validatePack } from '../../languages/czech/static/source/games/case-cosmos/case-cosmos-content.mjs';

const read = async path => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
const sound = await read('../../languages/spanish/static/data/games/sound-quasar/content.json');
const grammar = await read('../../languages/spanish/static/data/games/grammar-gravity/content.json');
const cases = await read('../../languages/czech/static/data/games/case-cosmos/content.json');
const random = () => 0.37;

test('Sounds accepts 6,000 records per collection and retains difficulty, choices and item checks', () => {
  // Synthetic capacity fixtures, never published as teaching content.
  const raw = structuredClone(sound);
  for (const [field, prefix, provenance] of [['items', 'word', 'provenance'], ['sentences', 'sentence', 'sentenceProvenance']]) {
    raw[field] = Array.from({ length: 6000 }, (_, index) => ({
      ...structuredClone(sound[field][index % sound[field].length]),
      id: `capacity-${prefix}-${index}`,
      sourceId: `capacity-${prefix}-${index}`,
      target: `${prefix} ${index}`,
      difficulty: index % 3 + 1
    }));
    raw[provenance].sourceItemIds = raw[field].map(item => item.sourceId);
  }
  const catalog = validateSoundQuasarCatalog(raw);
  assert.equal(catalog.items.length, 6000);
  assert.equal(catalog.sentences.length, 6000);
  assert.equal(catalog.sentences.at(-1).id, raw.sentences.at(-1).id);
  for (const mode of ['words', 'sentences']) for (const difficulty of [1, 2, 3]) {
    const eligibleIds = new Set((mode === 'words' ? catalog.items : catalog.sentences)
      .filter(item => item.difficulty <= difficulty).map(item => item.id));
    const rounds = createSoundQuasarSession(catalog, { mode, difficulty, choiceCount: 8, roundLength: 5, random });
    assert.equal(rounds.length, 5);
    for (const round of rounds) {
      assert.equal(round.choices.length, 8);
      assert.equal(round.choices.filter(item => item.id === round.answerId).length, 1);
      assert.ok(round.choices.every(item => eligibleIds.has(item.id)));
    }
  }
  const duplicate = structuredClone(raw);
  duplicate.sentences.at(-1).target = duplicate.sentences[0].target;
  assert.throws(() => validateSoundQuasarCatalog(duplicate), /unique/u);
  const invalid = structuredClone(raw);
  invalid.items.at(-1).difficulty = 4;
  assert.throws(() => validateSoundQuasarCatalog(invalid), /difficulty/u);
  const tooSmall = structuredClone(sound);
  tooSmall.items = tooSmall.items.slice(0, 3);
  assert.throws(() => validateSoundQuasarCatalog(tooSmall), /at least 4/u);
});

test('Grammar accepts more than 48 families with every example reachable at its authored level', () => {
  // Repeated phrases with unique IDs test capacity only, not editorial breadth.
  const raw = structuredClone(grammar);
  raw.challenges = Array.from({ length: 256 }, (_, index) => {
    const challenge = structuredClone(grammar.challenges[index % grammar.challenges.length]);
    challenge.id = `es.capacity.family-${index}`;
    challenge.difficulty = index % 3 + 1;
    for (const [axis, form] of Object.entries(challenge.forms)) {
      form.examples.forEach((example, position) => { example.id = `es.capacity.family-${index}.${axis}.example-${position}`; });
    }
    return challenge;
  });
  const catalog = normalizeGrammarGravityPack(raw, { courseId: 'es', learnerBaseLanguage: 'en', targetLanguage: 'es-ES' });
  assert.equal(catalog.challenges.length, 256);
  for (const difficulty of [1, 2, 3]) {
    const expected = raw.challenges.filter(item => item.difficulty <= difficulty)
      .flatMap(item => Object.values(item.forms).flatMap(form => form.examples.map(example => example.id)));
    const rounds = buildGrammarGravityRounds(catalog, difficulty, random);
    assert.deepEqual(new Set(rounds.map(round => round.id)), new Set(expected));
    assert.ok(rounds.every(round => round.difficulty <= difficulty));
    for (const round of rounds) for (const flight of round.flights) assert.ok(flight.options.includes(flight.answer));
  }
  const duplicate = structuredClone(raw);
  duplicate.challenges.at(-1).id = duplicate.challenges[0].id;
  assert.throws(() => normalizeGrammarGravityPack(duplicate), /repeats challenge ID/u);
  const invalid = structuredClone(raw);
  Object.values(invalid.challenges.at(-1).forms)[0].examples[0].slot.beforeText = 'mismatched ';
  assert.throws(() => normalizeGrammarGravityPack(invalid), /reproduce/u);
  const tooSmall = structuredClone(grammar);
  tooSmall.challenges = tooSmall.challenges.slice(0, 3);
  assert.throws(() => normalizeGrammarGravityPack(tooSmall), /at least four/u);
});

test('Case banks above the former ceilings reach the retained content checks instead of a size rejection', () => {
  // The independent checked-content whitelist still prevents new authored IDs.
  // Do not bypass it or mistake these deliberate rejections for full-scale acceptance.
  const legacy = Array.from({ length: 501 }, (_, index) => structuredClone(cases.legacyNouns[index % cases.legacyNouns.length]));
  assert.throws(() => validatePack(legacy), /noun bank repeats/u);
  const paradigms = structuredClone(cases);
  paradigms.paradigms = Array.from({ length: 201 }, (_, index) => structuredClone(cases.paradigms[index % cases.paradigms.length]));
  assert.throws(() => validatePack(paradigms), /repeats a paradigm ID/u);
  const contexts = structuredClone(cases);
  contexts.contexts = Array.from({ length: 6000 }, (_, index) => structuredClone(cases.contexts[index % cases.contexts.length]));
  assert.throws(() => validatePack(contexts), /repeats a stable context ID/u);
  const unsupported = structuredClone(cases);
  unsupported.contexts[0].id = 'cz.case.unreviewed-new-id';
  assert.throws(() => validatePack(unsupported), /differs from its checked/u);
  assert.throws(() => validatePack([]), /nonempty/u);
  for (const field of ['paradigms', 'contexts']) {
    const empty = structuredClone(cases);
    empty[field] = [];
    assert.throws(() => validatePack(empty), /nonempty/u);
  }
});
