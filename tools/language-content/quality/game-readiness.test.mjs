import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { extractCoreVerbPairs, filterVerbPairsForDifficulty, dealVerbRound, VERB_NEBULA_PAIR_COUNTS } from '../../../apps/language-runtime/static/source/games/verb-nebula/verb-nebula-core.mjs';
import { validateSoundQuasarCatalog, createSoundQuasarSession } from '../../../apps/language-runtime/static/source/games/sound-quasar/sound-quasar-core.mjs';
import { createNounLandingSession } from '../../../apps/language-runtime/static/source/games/grammar-gravity/noun-landing-core.mjs';
import { buildGrammarGravityRounds } from '../../../apps/language-runtime/static/source/games/grammar-gravity/grammar-gravity-core.mjs';
import { validateConjugationCometCatalog, buildConjugationVerbQueue, buildConjugationHelixRound, judgeConjugationHelixPair } from '../../../apps/language-runtime/static/source/games/conjugation-comet/conjugation-comet-core.mjs';
import { buildRounds, buildQuestions } from '../../../apps/languages/czech/static/source/games/case-cosmos/case-cosmos-content.mjs';
import { prepareWordWorldContext } from '../../../apps/language-runtime/static/source/word-world-provider.mjs';
import { StandardWordWorldProvider } from '../../../apps/languages/czech/static/source/games/word-world/word-net-standard.mjs';
import { importBrowserLanguageAdapter } from '../../../apps/language-runtime/tests/browser-module-loader.mjs';

const root = new URL('../../../', import.meta.url);
const json = async path => JSON.parse(await readFile(new URL(path, root), 'utf8'));
const catalog = await json('apps/languages/catalog.json');
const courses = await Promise.all(catalog.courses.map(entry => json(entry.manifest)));
const random = () => 0.37;
const eligible = (rows, level) => rows.filter(row => row.difficulty === undefined || row.difficulty <= level);
const sameIds = (actual, expected) => assert.deepEqual(new Set(actual.map(row => row.id)), new Set(expected.map(row => row.id)));

for (const course of courses) {
  const resource = key => json(course.resources[key].path);
  for (const game of course.games.filter(game => game !== 'campaign')) {
    test(`${course.id}/${game}: every level builds playable content`, async t => {
      if (game === 'verb-lab') {
        const pairs = extractCoreVerbPairs(await resource('verbNebulaCatalog'), { learnerBaseLanguage: course.sourceLanguage.locale });
        for (const difficulty of [1, 2, 3]) {
          const rows = filterVerbPairsForDifficulty(pairs, difficulty);
          assert.ok(rows.length >= Math.max(...VERB_NEBULA_PAIR_COUNTS), 'Each level must support every offered board size.');
          for (const count of VERB_NEBULA_PAIR_COUNTS) {
            let queue = rows.map(row => row.id);
            const seen = new Set();
            while (seen.size < rows.length) {
              const dealt = dealVerbRound(rows, queue, count, random);
              assert.equal(dealt.round.length, count);
              assert.equal(new Set(dealt.round.map(row => row.id)).size, count);
              assert.ok(dealt.round.every(row => rows.some(item => item.id === row.id)));
              const before = seen.size;
              dealt.round.forEach(row => seen.add(row.id));
              assert.ok(seen.size > before, 'Queued verbs must remain reachable.');
              queue = dealt.queueIds;
            }
          }
          t.diagnostic(`L${difficulty}: ${rows.length} verbs; all board sizes`);
        }
      } else if (game === 'sound-quasar') {
        const pack = validateSoundQuasarCatalog(await resource('soundQuasarCatalog'));
        for (const mode of ['words', 'sentences']) for (const difficulty of [1, 2, 3]) {
          const rows = eligible(mode === 'words' ? pack.items : pack.sentences, difficulty);
          for (const choiceCount of [2, 4, 6, 8]) {
            const rounds = createSoundQuasarSession(pack, { mode, difficulty, choiceCount, roundLength: 500, random });
            assert.deepEqual(new Set(rounds.map(round => round.answerId)), new Set(rows.map(row => row.id)));
            for (const round of rounds) {
              assert.equal(round.choices.length, Math.min(choiceCount, rows.length));
              assert.ok(round.choices.some(row => row.id === round.answerId));
              assert.equal(new Set(round.choices.map(row => row.id)).size, round.choices.length);
              assert.ok(round.choices.every(row => rows.some(item => item.id === row.id)));
              assert.equal(new Set(round.choices.map(row => row.target.normalize('NFC').toLocaleLowerCase(course.targetLanguage.locale))).size,
                round.choices.length, 'Spoken options must not be identical text with different answer IDs.');
            }
          }
          t.diagnostic(`L${difficulty} ${mode}: ${rows.length} items; all choice counts`);
        }
      } else if (game === 'grammar-gravity') {
        const pack = await resource('grammarGravityCatalog');
        const nouns = await resource('grammarGravityNouns');
        for (const difficulty of [1, 2, 3]) {
          const rounds = buildGrammarGravityRounds(pack, difficulty, random);
          assert.ok(rounds.length > 0);
          assert.ok(rounds.every(round => round.difficulty <= difficulty));
          assert.deepEqual(new Set(rounds.map(round => round.challengeId)), new Set(eligible(pack.challenges, difficulty).map(row => row.id)));
          for (const round of rounds) for (const flight of round.flights) {
            assert.ok(flight.options.includes(flight.answer));
          }
          const session = createNounLandingSession(nouns, { difficulty, random });
          const rows = [session.item, ...session.queue];
          sameIds(rows, eligible(nouns.items, difficulty));
          assert.deepEqual(new Set(rows.map(row => row.laneId)), new Set(nouns.lanes.map(lane => lane.id)), 'Each displayed noun category must have practice at every level.');
          t.diagnostic(`L${difficulty}: ${rounds.length} phrases; ${rows.length} nouns`);
        }
      } else if (game === 'conjugation-comet') {
        const pack = validateConjugationCometCatalog(await resource('conjugationCometCatalog'), {
          expectedCourseId: course.id, expectedTargetLanguageId: course.targetLanguage.id,
          expectedLearnerBaseLanguageId: course.sourceLanguage.id, expectedTargetLocale: course.targetLanguage.locale
        });
        for (const difficulty of [1, 2, 3]) {
          const rows = eligible(pack.verbs, difficulty);
          assert.ok(rows.length > 0, 'A beginner must not need the host fallback to harder material.');
          const queue = buildConjugationVerbQueue(rows, { random });
          sameIds(queue, rows);
          for (const verb of queue) {
            const round = buildConjugationHelixRound(pack, verb.id, { rng: random });
            assert.equal(round.subjects.length, verb.forms.length);
            for (const subject of round.subjects) {
              assert.ok(round.options.some(option => judgeConjugationHelixPair(round, subject.id, option.id)));
            }
          }
          t.diagnostic(`L${difficulty}: ${rows.length} paradigms; ${rows.reduce((n, row) => n + row.forms.length, 0)} forms`);
        }
      } else if (game === 'case-cosmos') {
        const pack = await resource('caseCosmosCatalog');
        for (const difficulty of [1, 2, 3]) {
          const rounds = buildRounds(pack, difficulty);
          assert.ok(rounds.length > 0);
          assert.ok(rounds.every(round => round.difficulty <= difficulty));
          let count = 0;
          for (const round of rounds) for (const question of buildQuestions(round, random)) {
            count++;
            assert.equal(question.candidates.filter(candidate => candidate.matches).length, 1);
          }
          t.diagnostic(`L${difficulty}: ${count} contexts`);
        }
      } else if (game === 'naturalization-nucleus') {
        const context = vm.createContext({ window: {} });
        const controller = 'apps/languages/mandarin-simplified/static/source/games/naturalization-nucleus/naturalization-nucleus.js';
        vm.runInContext(await readFile(new URL(controller, root), 'utf8'), context);
        const api = context.window.CaatuuNaturalizationNucleus;
        const pack = api.validateCatalog(await resource('naturalizationNucleusCatalog'));
        for (const difficulty of [1, 2, 3]) {
          const rows = api.filterChallengesForDifficulty(pack.challenges, difficulty);
          for (const count of pack.roundSettings.pieceCounts) {
            const round = api.createRound(pack, count, random, '', difficulty);
            assert.equal(round.pieces.length, count);
            assert.equal(new Set(round.pieces.map(piece => api.readingKey(piece.left))).size, count);
            assert.ok(round.pieces.every(piece => piece.left.difficulty <= difficulty && piece.right.difficulty <= difficulty));
          }
          t.diagnostic(`L${difficulty}: ${rows.length} characters; all board sizes`);
        }
      } else if (game === 'word-net') {
        const manifest = await resource('wordWorldManifest');
        const staticRoot = course.resources.staticRoot.path;
        const loadJson = url => {
          const pathname = new URL(url, 'https://caatuu.test').pathname;
          if (pathname.startsWith('/language-runtime/')) return json(`apps${pathname}`);
          assert.ok(pathname.startsWith(`${course.routePrefix}/`));
          return json(`${staticRoot}/${pathname.slice(course.routePrefix.length + 1)}`);
        };
        const adapter = await importBrowserLanguageAdapter(new URL(`${staticRoot}/source/language/adapter.mjs`, root));
        const standardProvider = manifest.runtimeFile ? new StandardWordWorldProvider({ manifest,
          pack: await json(`${staticRoot}/data/games/word-world/${manifest.runtimeFile.split('?')[0]}`), random }) : undefined;
        const context = await prepareWordWorldContext({ ...course, learnerBasePreview: true }, manifest, {
          adapter, loadJson, standardProvider, meaningSelector: () => null, origin: 'https://caatuu.test',
          runtime: null, random, embeddingRanker: async () => []
        });
        const provider = context.selectionProvider;
        assert.equal(provider.records.length, manifest.recordCount, 'Normalization must not silently discard content.');
        for (const difficulty of [1, 2, 3]) {
          const rows = eligible(provider.records, difficulty);
          assert.ok(rows.length > 0);
          const seen = [];
          for (let i = 0; i < rows.length; i++) {
            const turn = provider.nextRandom({ difficulty, excludeIds: seen, allowExcludedFallback: false });
            assert.ok(turn?.record);
            assert.ok(turn.record.difficulty <= difficulty);
            seen.push(turn.record.id);
          }
          assert.deepEqual(new Set(seen), new Set(rows.map(row => row.id)));
          assert.equal(provider.nextRandom({ difficulty, excludeIds: seen, allowExcludedFallback: false }), null);
          t.diagnostic(`L${difficulty}: ${rows.length} sentences`);
        }
      } else assert.fail(`Enabled game needs a readiness check: ${course.id}/${game}`);
    });
  }
}

test('readiness rejects catalogs with empty introductory listening or noun pools', async () => {
  const course = courses.find(course => course.id === 'es-en');
  const sound = await json(course.resources.soundQuasarCatalog.path);
  for (const row of [...sound.items, ...sound.sentences]) row.difficulty = 3;
  const pack = validateSoundQuasarCatalog(sound);
  for (const mode of ['words', 'sentences']) assert.throws(() => createSoundQuasarSession(pack, { mode, difficulty: 1 }), /eligible/);
  const nouns = await json(course.resources.grammarGravityNouns.path);
  nouns.items.forEach(row => { row.difficulty = 3; });
  assert.throws(() => createNounLandingSession(nouns, { difficulty: 1 }), /eligible/);
});
