import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { selectContentItems as legacy, CONTENT_DAY_MS as DAY } from '../static/source/games/content-progression.mjs';
import { createAdaptiveDecision } from '../static/source/games/adaptive-sampling.mjs';
import { extractCoreVerbPairs, filterVerbPairsForDifficulty } from '../static/source/games/verb-nebula/verb-nebula-core.mjs';
import { validateConjugationCometCatalog, buildConjugationHelixRound, buildConjugationMeaningRound } from '../static/source/games/conjugation-comet/conjugation-comet-core.mjs';
import { buildGrammarGravityRounds } from '../static/source/games/grammar-gravity/grammar-gravity-core.mjs';
import { createNounLandingSession, setNounFallDuration, startNounLanding, advanceNounFall } from '../static/source/games/grammar-gravity/noun-landing-core.mjs';
import { validateSoundQuasarCatalog, createSoundQuasarSession } from '../static/source/games/sound-quasar/sound-quasar-core.mjs';
import { selectMemoryMoonChallenges } from '../static/source/games/memory-moon/memory-moon-core.mjs';
import { StandardWordWorldProvider } from '../../languages/czech/static/source/games/word-world/word-net-standard.mjs';
import { normalizeCurriculum, normalizeCurriculumItem } from '../static/source/games/curriculum-progression.mjs';

const root = new URL('../../../', import.meta.url);
const json = async relative => JSON.parse(await readFile(new URL(relative, root), 'utf8'));
const catalog = await json('apps/languages/catalog.json');
const courses = await Promise.all(catalog.courses.map(row => json(row.manifest)));
const spanish = courses.find(course => course.id === 'es');
const resource = async (course, name) => {
  const bank = await json(course.resources[name].path);
  if (Array.isArray(bank)) return bank.filter(row => row.difficulty !== 0);
  for (const key of ['verbs', 'items', 'sentences', 'challenges', 'records']) {
    if (Array.isArray(bank[key])) bank[key] = bank[key].filter(row => row.difficulty !== 0);
  }
  if (bank.provenance?.sourceItemIds && bank.items) bank.provenance.sourceItemIds = bank.items.map(row => row.sourceId);
  if (bank.sentenceProvenance?.sourceItemIds && bank.sentences) bank.sentenceProvenance.sourceItemIds = bank.sentences.map(row => row.sourceId);
  return bank;
};
const zeroCopy = (row, id = `${row.id}-zero-fixture`) => ({ ...structuredClone(row), id, difficulty: 0 });

test('zero curriculum objectives and contexts retain the exact introductory band', () => {
  const curriculum = normalizeCurriculum({ schemaVersion: 1, objectives: [
    { id: 'zero-recognition', label: 'Recognize a familiar word', difficulty: 0 }
  ] });
  const item = { difficulty: 0, objectiveId: 'zero-recognition', phase: 'practice',
    context: 'Use the model to recognize a familiar word.', explanation: 'One familiar word at a time.' };
  assert.equal(normalizeCurriculumItem(item, curriculum).difficulty, 0);
  assert.throws(() => normalizeCurriculumItem({ ...item, difficulty: 1 }, curriculum), /match/);
  assert.throws(() => normalizeCurriculumItem({ difficulty: null }), /difficulty/);
});

test('level zero has a positive frontier, gradual new material, and no Explorer fallback', () => {
  const now = Date.UTC(2026, 9, 19);
  const rows = Array.from({ length: 18 }, (_, index) => ({
    id: `zero-${index}`, difficulty: 0, complexity: index < 12 ? 1 : 35, usefulness: 90
  }));
  const explorer = [{ id: 'explorer', difficulty: 1, complexity: 1, usefulness: 100 }];
  for (const select of [legacy, (items, options) => createAdaptiveDecision(items, options).items]) {
    const history = {};
    const seen = new Set();
    for (let attempt = 0; attempt < 160 && seen.size < rows.length; attempt++) {
      const chosen = select([...explorer, ...rows], { difficulty: 0, history, now, minimumPool: 2, limit: 2, random: () => .37 });
      assert.equal(chosen.length, 2);
      for (const row of chosen) {
        assert.equal(row.difficulty, 0);
        seen.add(row.id);
        history[row.id] = { exposures: (history[row.id]?.exposures || 0) + 1, firstSeenAt: new Date(now).toISOString(), lastSeenAt: new Date(now).toISOString() };
      }
    }
    assert.equal(seen.size, rows.length, 'continued introductory practice can leave its initial cohort');
    assert.deepEqual(select(explorer, { difficulty: 0, now }), []);
    const spaced = Object.fromEntries(rows.slice(0, 2).map(row => [row.id, {
      exposures: 10, firstSeenAt: new Date(now - 10 * DAY).toISOString(), lastSeenAt: new Date(now - DAY).toISOString(),
      independentDays: 5, spacedSuccesses: 4, intervalMs: 16 * DAY
    }]));
    assert.ok(select(rows, { difficulty: 0, history: spaced, now }).length > 0);
  }
  const trace = createAdaptiveDecision(rows, { difficulty: 0, now }).trace;
  assert.ok(trace.constraints.frontier > 0);
});

test('basic verbs survive alongside their original difficulty without weakening old deduplication', async () => {
  const bank = await resource(spanish, 'verbNebulaCatalog');
  const original = extractCoreVerbPairs(bank);
  const row = bank.find(item => item.id === original[0].id);
  const extended = [...bank, zeroCopy(row, 'zero-fixture-verb')];
  const pairs = extractCoreVerbPairs(extended);
  assert.deepEqual(pairs.filter(item => item.difficulty > 0), original.filter(item => item.difficulty > 0));
  assert.equal(filterVerbPairsForDifficulty(pairs, 0).filter(item => item.id === 'zero-fixture-verb').length, 1);
  assert.equal(extractCoreVerbPairs([{ ...row, id: 'zero-fixture-word', difficulty: 0, kind: 'word' }]).length, 1);
  assert.equal(extractCoreVerbPairs([{ ...row, id: 'explorer-word', difficulty: 1, kind: 'word' }]).length, 0);
  assert.equal(extractCoreVerbPairs([...bank, { ...row, id: 'duplicate-explorer' }]).length, original.length);
});

test('zero Conjugation presents two forms and two same-band meanings while Explorer keeps all forms', async () => {
  const bank = await resource(spanish, 'conjugationCometCatalog');
  const old = bank.verbs.find(row => row.difficulty === 1);
  const copies = bank.verbs.filter(row => row.difficulty === 1).slice(0, 2).map(row => zeroCopy(row));
  bank.verbs.push(...copies);
  const pack = validateConjugationCometCatalog(bank);
  const round = buildConjugationHelixRound(pack, copies[0].id, { rng: () => .37 });
  assert.equal(round.subjects.length, 2);
  assert.equal(round.options.length, 2);
  assert.equal(buildConjugationHelixRound(pack, old.id).subjects.length, old.forms.length);
  const meaning = buildConjugationMeaningRound(pack, copies[0].id, { random: () => .37 });
  assert.equal(meaning.options.length, 2);
  assert.ok(meaning.options.every(option => pack.verbs.find(row => row.id === option.id).difficulty === 0));
});

test('zero Grammar uses two answers and omits category recall, preserving Explorer stages and options', async () => {
  const bank = await resource(spanish, 'grammarGravityCatalog');
  const before = buildGrammarGravityRounds(structuredClone(bank), 1, () => .37);
  const copies = bank.challenges.filter(row => row.difficulty === 1).slice(0, 2).map(row => {
    const copy = zeroCopy(row);
    for (const form of Object.values(copy.forms)) for (const example of form.examples) example.id += '.zero-fixture';
    return copy;
  });
  bank.challenges.push(...copies);
  const rounds = buildGrammarGravityRounds(bank, 0, () => .37);
  assert.ok(rounds.length > 0);
  for (const round of rounds) for (const flight of round.flights) {
    assert.equal(flight.options.length, 2);
    assert.ok(flight.options.includes(flight.answer));
    assert.ok(!flight.stages.includes('category'));
    if (flight.stages.includes('meaning')) assert.equal(flight.meaningOptions.length, 2);
  }
  assert.deepEqual(buildGrammarGravityRounds(bank, 1, () => .37), before);
});

test('introductory noun practice holds until an answer, including after changing the timer', async () => {
  const bank = await resource(spanish, 'grammarGravityNouns');
  const copy = zeroCopy(bank.items[0]);
  bank.items.push(copy);
  let session = createNounLandingSession(bank, { difficulty: 0, durationMs: 5000 });
  assert.equal(session.durationMs, 0);
  session = startNounLanding(setNounFallDuration(session, 10000));
  assert.equal(session.durationMs, 0);
  assert.equal(advanceNounFall(session, 100000), session);
  assert.equal(createNounLandingSession(bank, { difficulty: 1, durationMs: 5000 }).durationMs, 5000);
});

test('zero listening and Memory use one authored contrast and retain the correct answer', async () => {
  const sound = await resource(spanish, 'soundQuasarCatalog');
  const copies = sound.items.filter(row => row.difficulty === 1).slice(0, 4).map(row => {
    const copy = zeroCopy(row, `${row.id}-zero-fixture`);
    copy.sourceId += '-zero-fixture';
    return copy;
  });
  sound.items.push(...copies);
  sound.provenance.sourceItemIds.push(...copies.map(row => row.sourceId));
  const pack = validateSoundQuasarCatalog(sound);
  const rounds = createSoundQuasarSession(pack, { difficulty: 0, choiceCount: 8, random: () => .37 });
  assert.ok(rounds.length > 0);
  for (const round of rounds) {
    assert.equal(round.choices.length, 2);
    assert.ok(round.choices.every(item => pack.items.find(row => row.id === item.id).difficulty === 0));
    assert.ok(round.choices.some(item => item.id === round.answerId));
  }
  const moon = await resource(spanish, 'memoryMoonCatalog');
  moon.challenges.push(...moon.challenges.slice(0, 3).map((row, index) => zeroCopy(row, `mm-es-zero-fixture-${index}`)));
  const selected = selectMemoryMoonChallenges(moon, { difficulty: 0, random: () => .37 }).items;
  assert.equal(selected.length, 3);
  for (const item of selected) {
    assert.equal(item.choices.length, 2);
    assert.equal(item.choices.filter(choice => choice.id === item.correctChoiceId).length, 1);
  }
});

test('zero Naturalization uses three distinct readings without borrowing a higher level', async () => {
  const course = courses.find(row => row.id === 'zh');
  const bank = await resource(course, 'naturalizationNucleusCatalog');
  const source = await readFile(new URL('../static/source/games/naturalization-nucleus/naturalization-nucleus.js', import.meta.url), 'utf8');
  const scope = vm.createContext({ window: {} });
  vm.runInContext(source, scope);
  const api = scope.window.CaatuuNaturalizationNucleus;
  const readings = new Set();
  const copies = bank.challenges.filter(row => row.difficulty > 0).filter(row => {
    const key = api.readingKey(row);
    if (readings.has(key)) return false;
    readings.add(key);
    return readings.size <= 3;
  }).map(row => zeroCopy(row, `${row.id}-zero-fixture`));
  bank.challenges.push(...copies);
  const pack = api.validateCatalog(bank);
  const round = api.createRound(pack, 9, () => .37, '', 0);
  assert.equal(round.pieceCount, 3);
  assert.equal(round.pieces.length, 3);
  assert.equal(new Set(round.pieces.map(piece => api.readingKey(piece.left))).size, 3);
  assert.ok(round.pieces.every(piece => piece.left.difficulty === 0 && piece.right.difficulty === 0));
});

test('legacy Czech Word World preserves zero and existing basic-sentence versions', async () => {
  const course = courses.find(row => row.id === 'cz');
  const manifest = await resource(course, 'wordWorldManifest');
  const bank = await json(`${course.resources.staticRoot.path}/data/games/word-world/${manifest.runtimeFile.split('?')[0]}`);
  bank.records = bank.records.filter(row => row.difficulty !== 0);
  const original = new StandardWordWorldProvider({ manifest, pack: bank });
  const record = original.records.find(row => row.difficulty === 1);
  const raw = bank.records.find(row => row.id === record.id);
  bank.records.push(zeroCopy(raw, `${raw.id}-zero-fixture`));
  const provider = new StandardWordWorldProvider({ manifest, pack: bank });
  assert.equal(provider.records.filter(row => row.id === `${raw.id}-zero-fixture`).length, 1);
  assert.equal(provider.nextRandom({ difficulty: 0 }).record.difficulty, 0);
  assert.deepEqual(provider.records.filter(row => row.difficulty > 0), original.records.filter(row => row.difficulty > 0));
});
