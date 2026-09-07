import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { importBrowserLanguageAdapter } from '../../../language-runtime/tests/browser-module-loader.mjs';
import { prepareWordWorldContext } from '../../../language-runtime/static/source/word-world-provider.mjs';
import { validateVerbNebulaCatalog, filterVerbPairsForDifficulty, dealVerbRound } from '../../../language-runtime/static/source/games/verb-nebula/verb-nebula-core.mjs';
import { validateConjugationCometCatalog, buildConjugationVerbQueue } from '../../../language-runtime/static/source/games/conjugation-comet/conjugation-comet-core.mjs';
import { normalizeGrammarGravityPack, buildGrammarGravityRounds } from '../../../language-runtime/static/source/games/grammar-gravity/grammar-gravity-core.mjs';
import { validateSoundQuasarCatalog, createSoundQuasarSession } from '../../../language-runtime/static/source/games/sound-quasar/sound-quasar-core.mjs';

const repository = new URL('../../../../', import.meta.url);
const json = async path => JSON.parse(await readFile(new URL(path, repository), 'utf8'));
const course = await json('apps/languages/english-from-spanish/course.json');
const resource = key => json(course.resources[key].path);
const contentResources = {
  'verb-lab': ['verbNebulaCatalog'],
  'word-net': ['wordWorldManifest'],
  'conjugation-comet': ['conjugationCometCatalog'],
  'grammar-gravity': ['grammarGravityCatalog', 'grammarGravityNouns'],
  'sound-quasar': ['soundQuasarCatalog']
};

test('every enabled game declares readable JSON content, including all Word World authorities', async () => {
  assert.deepEqual([...course.games].sort(), Object.keys(contentResources).sort());
  for (const keys of Object.values(contentResources)) for (const key of keys) {
    const entry = course.resources[key];
    assert.equal(entry.kind, 'file', key);
    assert.match(entry.path, /\.json$/u, key);
    assert.ok(await resource(key), key);
  }
  for (const key of ['concepts', 'realizations', 'learnerBaseRealizations']) {
    assert.match(course.publication[key], /\.json$/u);
    assert.ok(await json(course.publication[key]));
  }
});

test('Word World loads the three declared JSON roles and covers eligible content before repeating it', async () => {
  const manifest = await resource('wordWorldManifest');
  const adapter = await importBrowserLanguageAdapter('../../languages/english-from-spanish/static/source/language/adapter.mjs');
  const origin = 'https://caatuu.test';
  const manifestUrl = new URL(`${course.routePrefix}/data/games/word-world/manifest.json`, origin);
  const projection = course.publication.runtimeProjection;
  const paths = new Map([
    [new URL(manifest.sourceConceptCatalog, origin).href, projection.conceptsRuntime],
    [new URL(manifest.realizationFile, manifestUrl).href, projection.targetRealizationsRuntime],
    [new URL(manifest.learnerBaseFile, manifestUrl).href, projection.learnerBaseRuntime]
  ]);
  const requests = new Set();
  for (const difficulty of [1, 2, 3]) {
    const context = await prepareWordWorldContext({...course, learnerBasePreview: true}, manifest, {
      origin, adapter, runtime: null, random: () => 0.37, now: () => 1000,
      embeddingRanker: async () => [],
      loadJson: async url => {
        assert.ok(paths.has(String(url)), `Undeclared content request: ${url}`);
        requests.add(String(url));
        return json(paths.get(String(url)));
      }
    });
    const provider = context.selectionProvider;
    const eligible = provider.records.filter(record => record.difficulty <= difficulty);
    assert.ok(eligible.length);
    const seen = new Set();
    for (let i = 0; i < eligible.length; i++) {
      const {record} = provider.nextRandom({difficulty});
      assert.ok(record.difficulty <= difficulty);
      assert.ok(!seen.has(record.id), `Repeated before coverage: ${record.id}`);
      seen.add(record.id);
      provider.markUsed(record);
    }
    assert.deepEqual(seen, new Set(eligible.map(record => record.id)));
    assert.ok(provider.nextRandom({difficulty}));
    const first = provider.nextRandom({difficulty}).record;
    assert.notEqual(provider.nextRandom({difficulty, excludeIds: [first.id]}).record.id, first.id);
  }
  assert.deepEqual(requests, new Set(paths.keys()));
});

test('Verb Nebula deals a shuffled eligible queue without losing or repeating entries within one pass', async () => {
  const catalog = validateVerbNebulaCatalog(await resource('verbNebulaCatalog'), {learnerBaseLanguage: 'es-ES'});
  for (const difficulty of [1, 2, 3]) {
    const eligible = filterVerbPairsForDifficulty(catalog, difficulty);
    assert.ok(eligible.every(item => item.difficulty <= difficulty));
    let queue = [];
    const seen = [];
    while (seen.length < eligible.length) {
      const dealt = dealVerbRound(eligible, queue, 2, () => 0.37);
      seen.push(...dealt.round.map(item => item.id));
      queue = dealt.queueIds;
    }
    assert.equal(new Set(seen.slice(0, eligible.length)).size, eligible.length);
  }
});

test('Conjugation Comet currently shuffles within ascending eligible difficulty tiers', async () => {
  const catalog = validateConjugationCometCatalog(await resource('conjugationCometCatalog'));
  for (const difficulty of [1, 2, 3]) {
    const eligible = catalog.verbs.filter(verb => verb.difficulty <= difficulty);
    const queue = buildConjugationVerbQueue(eligible, {random: () => 0.37});
    assert.deepEqual(new Set(queue.map(verb => verb.id)), new Set(eligible.map(verb => verb.id)));
    assert.ok(queue.every((verb, index) => !index || verb.difficulty >= queue[index - 1].difficulty));
  }
});

test('Grammar Gravity uses only eligible JSON phrase examples and avoids adjacent repeated anchors', async () => {
  const pack = normalizeGrammarGravityPack(await resource('grammarGravityCatalog'), {
    courseId: course.id, learnerBaseLanguage: course.sourceLanguage.locale, targetLanguage: course.targetLanguage.locale
  });
  for (const difficulty of [1, 2, 3]) {
    const expected = pack.challenges.filter(c => c.difficulty <= difficulty)
      .flatMap(c => Object.values(c.forms).flatMap(f => f.examples.map(example => example.id)));
    const rounds = buildGrammarGravityRounds(pack, difficulty, () => 0.37);
    assert.deepEqual(new Set(rounds.map(round => round.id)), new Set(expected));
    assert.ok(rounds.every(round => round.difficulty <= difficulty));
    assert.ok(rounds.every((round, index) => !index
      || round.flights[0].anchorEnglishAuditText !== rounds[index - 1].flights[0].anchorEnglishAuditText));
  }
});

test('Sounds Quasar sessions draw distinct answers and distractors from their selected JSON bank', async () => {
  const catalog = validateSoundQuasarCatalog(await resource('soundQuasarCatalog'));
  for (const mode of ['words', 'sentences']) {
    const bank = mode === 'words' ? catalog.items : catalog.sentences;
    const ids = new Set(bank.map(item => item.id));
    const session = createSoundQuasarSession(catalog, {mode, roundLength: bank.length, random: () => 0.37});
    assert.equal(session.length, bank.length);
    assert.deepEqual(new Set(session.map(round => round.answerId)), ids);
    for (const round of session) {
      assert.ok(round.choices.every(choice => ids.has(choice.id)));
      assert.equal(new Set(round.choices.map(choice => choice.id)).size, round.choices.length);
    }
  }
});
