import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { extractCoreVerbPairs, filterVerbPairsForDifficulty, dealVerbRound, VERB_NEBULA_PAIR_COUNTS } from '../../../apps/language-runtime/static/source/games/verb-nebula/verb-nebula-core.mjs';
import { validateSoundQuasarCatalog, createSoundQuasarSession, buildSoundQuasarRound } from '../../../apps/language-runtime/static/source/games/sound-quasar/sound-quasar-core.mjs';
import { validateMemoryMoonCatalog, selectMemoryMoonChallenges } from '../../../apps/language-runtime/static/source/games/memory-moon/memory-moon-core.mjs';
import { createNounLandingSession, setNounFallDuration, startNounLanding, selectNounLane, advanceNounFall } from '../../../apps/language-runtime/static/source/games/grammar-gravity/noun-landing-core.mjs';
import { buildGrammarGravityRounds } from '../../../apps/language-runtime/static/source/games/grammar-gravity/grammar-gravity-core.mjs';
import { validateConjugationCometCatalog, buildConjugationVerbQueue, buildConjugationMeaningRound, buildConjugationFormRound, buildConjugationHelixRound, judgeConjugationHelixPair } from '../../../apps/language-runtime/static/source/games/conjugation-comet/conjugation-comet-core.mjs';
import { buildRounds, buildQuestions } from '../../../apps/languages/czech/static/source/games/case-cosmos/case-cosmos-content.mjs';
import { prepareWordWorldContext } from '../../../apps/language-runtime/static/source/word-world-provider.mjs';
import { StandardWordWorldProvider } from '../../../apps/languages/czech/static/source/games/word-world/word-net-standard.mjs';
import { importBrowserLanguageAdapter } from '../../../apps/language-runtime/tests/browser-module-loader.mjs';

const root = new URL('../../../', import.meta.url);
const json = async path => JSON.parse(await readFile(new URL(path, root), 'utf8'));
const catalog = await json('apps/languages/catalog.json');
const courses = await Promise.all(catalog.courses.map(entry => json(entry.manifest)));
const random = () => 0.37;
const eligible = (rows, level) => rows.filter(row => (row.difficulty ?? 1) === level);
const sameIds = (actual, expected) => assert.deepEqual(new Set(actual.map(row => row.id)), new Set(expected.map(row => row.id)));
const difficulties = [0, 1, 2, 3];

for (const course of courses) {
  const resource = key => json(course.resources[key].path);
  for (const game of course.games.filter(game => game !== 'campaign')) {
    test(`${course.id}/${game}: every level builds playable content`, async t => {
      if (game === 'verb-lab') {
        const pairs = extractCoreVerbPairs(await resource('verbNebulaCatalog'), { learnerBaseLanguage: course.sourceLanguage.locale });
        for (const difficulty of difficulties) {
          const rows = filterVerbPairsForDifficulty(pairs, difficulty);
          const boardSizes = VERB_NEBULA_PAIR_COUNTS;
          assert.ok(rows.length >= Math.max(...boardSizes), 'Each level must support every board size offered at that level.');
          for (const count of boardSizes) {
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
        for (const mode of ['words', 'sentences']) for (const difficulty of difficulties) {
          const rows = eligible(mode === 'words' ? pack.items : pack.sentences, difficulty);
          for (const choiceCount of [2, 4, 6, 8]) {
            const session = createSoundQuasarSession(pack, { mode, difficulty, choiceCount, roundLength: 500, random });
            assert.equal(session.length, Math.min(500, rows.length), 'Finite sessions retain their existing size bound.');
            assert.equal(new Set(session.map(round => round.answerId)).size, session.length, 'A finite session never repeats an answer.');
            assert.ok(session.every(round => rows.some(row => row.id === round.answerId)));
            // Banks may exceed one finite session. The round builder must still
            // expose every authored item without raising the session limit.
            const rounds = rows.length <= 500 ? session : rows.map((_row, index) =>
              buildSoundQuasarRound(pack, { mode, difficulty, choiceCount, index, random }));
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
      } else if (game === 'memory-moon') {
        const pack = validateMemoryMoonCatalog(await resource('memoryMoonCatalog'), { course });
        for (const difficulty of difficulties) {
          const rows = eligible(pack.challenges, difficulty);
          const selected = selectMemoryMoonChallenges(pack, { difficulty, limit: 6, random }).items;
          assert.equal(selected.length, 6);
          assert.equal(new Set(selected.map(row => row.id)).size, selected.length);
          for (const question of selected) {
            const authored = rows.find(row => row.id === question.id);
            assert.ok(authored, 'Every selected question stays in its chosen badge.');
            for (const key of ['revision', 'usefulness', 'complexity', 'familyId']) assert.equal(question[key], authored[key]);
            assert.equal(question.choices.filter(choice => choice.id === question.correctChoiceId).length, 1);
            sameIds(question.choices, authored.choices);
            assert.ok(question.choices.every(choice => authored.choices.some(item => item.id === choice.id && item.text === choice.text)),
              'The game retains all authored alternatives at every difficulty.');
          }
          if (difficulty === 0) {
            assert.ok(rows.length >= 12, 'A second six-question beginner session must have fresh material.');
            const recentIds = selected.map(item => item.id);
            const next = selectMemoryMoonChallenges(pack, { difficulty, limit: 6, recentIds, random }).items;
            assert.equal(next.length, 6);
            assert.ok(next.every(item => item.difficulty === 0 && !recentIds.includes(item.id)), 'Beginner sessions rotate beyond the first six questions.');
          }
          t.diagnostic(`L${difficulty}: ${rows.length} independent translation questions`);
        }
      } else if (game === 'grammar-gravity') {
        const pack = await resource('grammarGravityCatalog');
        const nouns = await resource('grammarGravityNouns');
        const familyContract = challenge => ({ axes: challenge.axes || pack.axes, gameplay: challenge.gameplay || pack.gameplay });
        const normalContracts = new Set([JSON.stringify({ axes: pack.axes, gameplay: pack.gameplay }),
          ...pack.challenges.filter(challenge => challenge.difficulty !== 0).map(challenge => JSON.stringify(familyContract(challenge)))]);
        for (const difficulty of difficulties) {
          const rounds = buildGrammarGravityRounds(pack, difficulty, random);
          assert.ok(rounds.length > 0);
          assert.ok(rounds.every(round => round.difficulty === difficulty));
          assert.deepEqual(new Set(rounds.map(round => round.challengeId)), new Set(eligible(pack.challenges, difficulty).map(row => row.id)));
          const meanings = new Set(eligible(pack.challenges, difficulty).flatMap(challenge => Object.values(challenge.forms)
            .flatMap(form => form.examples.map(example => example.anchor.learnerBaseText.normalize('NFKC').toLocaleLowerCase(course.sourceLanguage.locale)))));
          for (const challenge of eligible(pack.challenges, difficulty)) {
            const { axes } = familyContract(challenge);
            assert.deepEqual(new Set(Object.keys(challenge.forms)), new Set(axes.map(axis => axis.id)),
              'Every family retains the course\'s complete form board.');
            if (difficulty === 0) assert.ok(normalContracts.has(JSON.stringify(familyContract(challenge))),
              'Introductory content uses an existing course board and stage contract.');
          }
          for (const round of rounds) for (const flight of round.flights) {
            assert.ok(flight.options.includes(flight.answer));
            const challenge = pack.challenges.find(row => row.id === round.challengeId);
            const { axes, gameplay } = familyContract(challenge);
            assert.deepEqual(new Set(flight.options), new Set(axes.map(axis => challenge.forms[axis.id].displayForm)));
            assert.ok(flight.options.some(option => option !== flight.answer), 'Every flight retains a real form contrast.');
            assert.deepEqual(flight.stages, gameplay.stages, 'The course\'s normal stages apply at every badge.');
            assert.deepEqual(round.stages, gameplay.stages);
            assert.deepEqual(flight.categoryOptions, gameplay.categoryOptions);
            if (flight.stages.includes('category')) assert.ok(flight.categoryOptions.some(option => option.id === flight.categoryId));
            if (flight.stages.includes('meaning')) {
              assert.equal(flight.meaningOptions.length, Math.min(3, meanings.size));
              assert.ok(flight.meaningOptions.includes(flight.anchorMeaning));
              assert.ok(flight.meaningOptions.some(option => option !== flight.anchorMeaning));
            }
          }
          const session = createNounLandingSession(nouns, { difficulty, random, durationMs: 5000 });
          assert.equal(session.durationMs, 5000, 'The selected timer applies at every difficulty.');
          assert.equal(setNounFallDuration(session, 10000).durationMs, 10000);
          assert.equal(setNounFallDuration(session, 0).durationMs, 0, 'Untimed practice remains an explicit setting.');
          const correctFall = selectNounLane(startNounLanding(session), session.item.laneId);
          const landed = advanceNounFall(correctFall, session.durationMs);
          assert.equal(landed.phase, 'feedback');
          assert.equal(landed.correct, true, 'The timer can finish a correctly sorted noun.');
          const wrongLane = session.lanes.find(lane => !(session.item.acceptedLaneIds || [session.item.laneId]).includes(lane.id));
          if (wrongLane) assert.equal(advanceNounFall(selectNounLane(startNounLanding(session), wrongLane.id), session.durationMs).correct, false);
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
        for (const difficulty of difficulties) {
          const rows = eligible(pack.verbs, difficulty);
          assert.ok(rows.length > 0, 'Every selected band must be playable without borrowing another level.');
          const queue = buildConjugationVerbQueue(rows, { random });
          sameIds(queue, rows);
          for (const verb of queue) {
            const meaning = buildConjugationMeaningRound(pack, verb.id, { random });
            const meaningCount = new Set(rows.map(row => row.meaningChoiceBaseText.normalize('NFKC').toLocaleLowerCase(course.sourceLanguage.locale))).size;
            assert.equal(meaning.options.length, Math.min(4, meaningCount), 'Meaning recognition retains its standard option count.');
            assert.equal(meaning.options.filter(option => option.id === meaning.answerId).length, 1);
            assert.ok(meaning.options.every(option => rows.some(row => row.id === option.id)));
            const formRound = buildConjugationFormRound(pack, verb.id, { random });
            sameIds(formRound.targetForms, verb.forms);
            sameIds(formRound.baseCues, verb.forms);
            const round = buildConjugationHelixRound(pack, verb.id, { rng: random });
            assert.equal(round.subjects.length, verb.forms.length);
            assert.equal(round.options.length, verb.forms.length, 'Both helix strands retain every authored form.');
            assert.equal(new Set(round.subjects.map(subject => subject.id)).size, verb.forms.length);
            assert.equal(new Set(round.options.map(option => option.id)).size, verb.forms.length);
            for (const subject of round.subjects) {
              assert.ok(round.options.some(option => judgeConjugationHelixPair(round, subject.id, option.id)));
            }
          }
          t.diagnostic(`L${difficulty}: ${rows.length} paradigms; ${rows.reduce((n, row) => n + row.forms.length, 0)} forms`);
        }
      } else if (game === 'case-cosmos') {
        const pack = await resource('caseCosmosCatalog');
        for (const difficulty of difficulties) {
          const rounds = buildRounds(pack, difficulty);
          assert.ok(rounds.length > 0);
          assert.ok(rounds.every(round => round.difficulty === difficulty));
          let count = 0;
          for (const round of rounds) for (const question of buildQuestions(round, random)) {
            count++;
            assert.equal(question.candidates.filter(candidate => candidate.matches).length, 1);
            assert.ok(question.candidates.length >= 2 && question.candidates.length <= 4,
              'Each case question retains the normal variable set of real contrasts.');
          }
          t.diagnostic(`L${difficulty}: ${count} contexts`);
        }
      } else if (game === 'naturalization-nucleus') {
        const context = vm.createContext({ window: {} });
        const controller = 'apps/language-runtime/static/source/games/naturalization-nucleus/naturalization-nucleus.js';
        vm.runInContext(await readFile(new URL(controller, root), 'utf8'), context);
        const api = context.window.CaatuuNaturalizationNucleus;
        const pack = api.validateCatalog(await resource('naturalizationNucleusCatalog'));
        for (const difficulty of difficulties) {
          const rows = api.filterChallengesForDifficulty(pack.challenges, difficulty);
          for (const count of pack.roundSettings.pieceCounts) {
            const round = api.createRound(pack, count, random, '', difficulty);
            assert.equal(round.pieceCount, count);
            assert.equal(round.pieces.length, count);
            assert.equal(new Set(round.pieces.map(piece => api.readingKey(piece.left))).size, count);
            assert.ok(round.pieces.every(piece => piece.left.difficulty === difficulty && piece.right.difficulty === difficulty));
            const targets = round.solution.map(piece => piece.left);
            let placements = Array.from({ length: count }, () => '');
            const first = round.pieces[0];
            const wrongIndex = targets.findIndex(target => api.readingKey(target) !== api.readingKey(first.left));
            assert.equal(api.placeHanzi(placements, first, targets, wrongIndex), null, 'A wrong reading cannot solve a socket.');
            for (const piece of round.pieces) {
              const index = targets.findIndex(target => api.readingKey(target) === api.readingKey(piece.left));
              const result = api.placeHanzi(placements, piece, targets, index);
              assert.ok(result, 'Every displayed tile has a legal socket.');
              placements = [...result.placements];
              assert.equal(result.solved, placements.every(Boolean));
            }
            assert.ok(placements.every(Boolean), 'Every supported board size can be completed in every band.');
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
        for (const difficulty of difficulties) {
          const rows = eligible(provider.records, difficulty);
          assert.ok(rows.length > 0);
          const seen = [];
          for (let i = 0; i < rows.length; i++) {
            const turn = provider.nextRandom({ difficulty, excludeIds: seen, allowExcludedFallback: false });
            assert.ok(turn?.record);
            assert.ok(turn.record.difficulty === difficulty);
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

test('empty introductory pools cannot borrow content from another band', async () => {
  const course = courses.find(course => course.id === 'es-en');
  const sound = await json(course.resources.soundQuasarCatalog.path);
  sound.items = sound.items.filter(row => row.difficulty > 1);
  sound.sentences = sound.sentences.filter(row => row.difficulty > 1);
  sound.provenance.sourceItemIds = sound.items.map(row => row.sourceId);
  sound.sentenceProvenance.sourceItemIds = sound.sentences.map(row => row.sourceId);
  const pack = validateSoundQuasarCatalog(sound);
  for (const mode of ['words', 'sentences']) for (const difficulty of [0, 1]) {
    assert.throws(() => createSoundQuasarSession(pack, { mode, difficulty }), /eligible/);
  }
  const nouns = await json(course.resources.grammarGravityNouns.path);
  nouns.items = nouns.items.filter(row => row.difficulty > 1);
  for (const difficulty of [0, 1]) assert.throws(() => createNounLandingSession(nouns, { difficulty }), /eligible/);
  const memory = await json(course.resources.memoryMoonCatalog.path);
  memory.challenges = memory.challenges.filter(row => row.difficulty > 1);
  assert.deepEqual(selectMemoryMoonChallenges(memory, { difficulty: 0, random }).items, []);
  const grammar = await json(course.resources.grammarGravityCatalog.path);
  grammar.challenges = grammar.challenges.filter(row => row.difficulty !== 0);
  assert.throws(() => buildGrammarGravityRounds(grammar, 0, random), /no challenge/);
});
