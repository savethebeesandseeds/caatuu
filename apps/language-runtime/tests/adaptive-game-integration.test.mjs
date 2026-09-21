import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { loadProgressionCatalogs } from '../../../tools/language-content/quality/content-progression-catalogs.mjs';
import { loadCourseCatalog } from '../../../tools/language-packs/lib/course-contract.mjs';
import { browserSharedRuntimeClosureIssues } from '../../../tools/language-packs/lib/browser-shared-runtime-closure.mjs';
import { selectContentItems, practiceEnglishText } from '../static/source/games/adaptive-practice.mjs';
import { createSamplingExperiment } from '../static/source/games/adaptive-sampling.mjs';
import { selectContentItems as legacy } from '../static/source/games/content-progression.mjs';
import { extractCoreVerbPairs, dealVerbRound } from '../static/source/games/verb-nebula/verb-nebula-core.mjs';
import { validateConjugationCometCatalog, selectConjugationPracticeVerbs, buildConjugationHelixRound, judgeConjugationHelixRound } from '../static/source/games/conjugation-comet/conjugation-comet-core.mjs';
import { buildGrammarGravityRounds } from '../static/source/games/grammar-gravity/grammar-gravity-core.mjs';
import { createNounLandingSession } from '../static/source/games/grammar-gravity/noun-landing-core.mjs';
import { createSoundQuasarSession } from '../static/source/games/sound-quasar/sound-quasar-core.mjs';
import { buildCasePracticeRounds } from '../../languages/czech/static/source/games/case-cosmos/case-cosmos-content.mjs';
import { progressiveWordWorldSelection, wordWorldPracticeHistory } from '../static/source/word-world-progression.mjs';

const now = Date.parse('2026-09-20T12:00:00Z');
const random = () => .31;
const gameplayVariants = [
  { id: 'production', controls: null },
  { id: 'outside-exploration', controls: { outsideExploration: .05 } },
  { id: 'soft-frontier', controls: { softFrontier: true } },
  { id: 'cross-category-recency', controls: { crossCategoryRecency: true } }
];
const catalogsPromise = loadProgressionCatalogs();
const nucleusPromise = (async () => {
  const context = { window: {} };
  vm.runInNewContext(await readFile(new URL('../../languages/mandarin-simplified/static/source/games/naturalization-nucleus/naturalization-nucleus.js', import.meta.url), 'utf8'), context);
  return context.window.CaatuuNaturalizationNucleus;
})();
const scope = (courseId, gameId, bankId = 'default', onDecision = () => {}) => ({
  identity: { courseId, gameId, bankId, assessmentDirection: bankId },
  goal: { id: 'balanced', kind: 'balanced' }, semanticsEnabled: false, onDecision
});

test('adaptive practice shared import closure is packaged and cached by every browser course', async () => {
  const repoRoot = new URL('../../../', import.meta.url);
  const sharedSourceRoot = new URL('../static/source/', import.meta.url);
  const pending = [new URL('games/adaptive-practice.mjs', sharedSourceRoot)];
  const dependencies = new Set();
  while (pending.length) {
    const moduleUrl = pending.pop();
    moduleUrl.search = ''; moduleUrl.hash = '';
    assert.ok(moduleUrl.href.startsWith(sharedSourceRoot.href), `Sampling import escapes shared source: ${moduleUrl}`);
    const sourcePath = `apps/language-runtime/static/source/${decodeURIComponent(moduleUrl.href.slice(sharedSourceRoot.href.length))}`;
    if (dependencies.has(sourcePath)) continue;
    dependencies.add(sourcePath);
    const source = await readFile(moduleUrl, 'utf8');
    // Match the literal import/re-export forms checked by the static compiler.
    // Computed optional model imports are outside the sampling module closure.
    const patterns = [
      /(?:^|\n)\s*import\s+(?:[^;]*?\s+from\s+)?["']([^"']+)["']/gu,
      /(?:^|\n)\s*export\s+[^;]*?\s+from\s*["']([^"']+)["']/gu,
      /\bimport\s*\(\s*["']([^"']+)["']\s*\)/gu
    ];
    for (const pattern of patterns) for (const [, reference] of source.matchAll(pattern)) {
      if (reference.startsWith('.')) pending.push(new URL(reference, moduleUrl));
      else if (reference.startsWith('/language-runtime/static/source/')) pending.push(new URL(`apps${reference}`, repoRoot));
    }
  }
  const appAssetCatalog = JSON.parse(await readFile(new URL('../app-assets.json', import.meta.url), 'utf8'));
  const mappings = [...dependencies].map(source => {
    const matching = appAssetCatalog.assets.filter(mapping => mapping.source === source);
    assert.equal(matching.length, 1, `Sampling dependency must have one shared asset mapping: ${source}`);
    assert.equal(matching[0].output, source.slice('apps/'.length), `Sampling dependency must keep its shared public path: ${source}`);
    return matching[0];
  });
  const loaded = await loadCourseCatalog({ repoRoot });
  const browserCourses = loaded.courses.filter(({ course }) => course.platforms?.browser?.enabled);
  assert.ok(browserCourses.length, 'The authoritative catalog must contain browser courses');
  for (const { course } of browserCourses) {
    assert.equal(course.resources.setupCatalog.state, 'present', `${course.id} requires an offline catalog`);
    const setupCatalog = JSON.parse(await readFile(new URL(course.resources.setupCatalog.path, repoRoot), 'utf8'));
    assert.deepEqual(browserSharedRuntimeClosureIssues({ appAssetCatalog: { assets: mappings }, setupCatalog,
      courseId: course.id, routePrefix: course.routePrefix }), [], `${course.id} must cache the complete sampling import graph`);
  }
});

test('legacy callers retain established selection and adaptive English never uses learner-base text', () => {
  const rows = Array.from({ length: 20 }, (_, i) => ({ id: `item-${i}`, difficulty: 1, usefulness: 50, complexity: i + 1 }));
  assert.deepEqual(selectContentItems(rows, { random, now }), legacy(rows, { random, now }));
  assert.equal(practiceEnglishText({ en: 'Me gusta aprender.', englishAuditText: 'I like learning.' }, { courseId: 'es-en', gameId: 'word-world' }), 'I like learning.');
  assert.equal(practiceEnglishText({ en: 'Me gusta aprender.' }, { courseId: 'es-en', gameId: 'word-world' }), '');
});

test('one Word World decision is one draw and recent exclusions have an inspectable conditional distribution', () => {
  const rows = Array.from({ length: 8 }, (_, i) => ({ id: `item-${i}`, difficulty: 1, usefulness: 50, complexity: 1 }));
  let calls = 0, trace, pool;
  const selected = progressiveWordWorldSelection(rows, { now, random: () => { calls++; return .2; },
    excludeIds: ['item-0'], policy: scope('cz', 'word-world', 'reconstruct-target', value => { trace = value; }),
    onPool: value => { pool = value; } });
  assert.equal(calls, 1);
  assert.notEqual(selected.id, 'item-0');
  assert.deepEqual(pool, [selected]);
  assert.equal(trace.draws[0].chosenId, selected.id);
  assert.ok(!trace.draws[0].distribution.some(row => row.id === 'item-0'));
});

for (const variant of gameplayVariants) test(`every authored game bank builds playable adaptive selections under its difficulty ceiling (${variant.id})`, async () => {
  const catalogs = await catalogsPromise;
  const nucleus = await nucleusPromise;
  const seen = new Set();
  for (const { game, document, course } of catalogs) for (const difficulty of [1, 2, 3]) {
    let trace;
    const gameId = game === 'grammar-gravity-nouns' ? 'grammar-gravity' : game;
    const bankId = game === 'grammar-gravity-nouns' ? 'nouns' : game === 'grammar-gravity' ? 'phrases-sequence'
      : game === 'sound-quasar' ? 'words' : game === 'word-world' ? 'sentences'
        : game === 'naturalization-nucleus' ? 'recognize-hanzi-pinyin' : 'default';
    const policy = scope(course.id, gameId, bankId, value => { trace = value; });
    if (variant.controls) policy.select = (items, options) => createSamplingExperiment(items, options, variant.controls);
    const options = { difficulty, history: {}, random, now, policy };
    let items;
    if (game === 'word-world') {
      items = [progressiveWordWorldSelection(document.records, options)];
    } else if (game === 'verb-nebula') {
      items = selectContentItems(extractCoreVerbPairs(document, { learnerBaseLanguage: course.sourceLanguage.locale }), options);
      const board = dealVerbRound(items, items.map(item => item.id), 4, random);
      assert.equal(board.round.length, 4);
      assert.equal(new Set(board.round.map(item => item.id)).size, 4);
    } else if (game === 'conjugation-comet') {
      const pack = validateConjugationCometCatalog(document, { expectedCourseId: course.id,
        expectedTargetLanguageId: course.targetLanguage.id, expectedLearnerBaseLanguageId: course.sourceLanguage.id,
        expectedTargetLocale: course.targetLanguage.locale });
      items = selectConjugationPracticeVerbs(pack.verbs, options);
      for (const item of items) {
        const board = buildConjugationHelixRound(pack, item.id, { rng: random });
        assert.equal(board.subjects.length, item.forms.length);
        assert.equal(board.options.length, item.forms.length);
        assert.ok(board.options.some((_, offset) => judgeConjugationHelixRound(board, 0, offset).correct),
          'every selected paradigm retains a complete solvable helix');
      }
    } else if (game === 'case-cosmos') {
      items = buildCasePracticeRounds(document, difficulty, options);
      assert.ok(items.every(item => item.practiceQuestions.length === 1));
    } else if (game === 'grammar-gravity') {
      const examples = new Map(document.challenges.flatMap(challenge => Object.values(challenge.forms)
        .flatMap(form => form.examples.map(example => [example.id, example]))));
      const rounds = buildGrammarGravityRounds(document, difficulty, random);
      for (const round of rounds) {
        assert.equal(practiceEnglishText(round, policy.identity), examples.get(round.id).englishAuditText,
          `${course.id}/${round.id} carries the complete English example, independently of learner-base text`);
      }
      items = selectContentItems(rounds, options);
    } else if (game === 'grammar-gravity-nouns') {
      const session = createNounLandingSession(document, options);
      items = [session.item, ...session.queue];
    } else if (game === 'sound-quasar') {
      const rounds = createSoundQuasarSession(document, { ...options, mode: 'words' });
      assert.equal(new Set(rounds.map(round => round.answerId)).size, rounds.length);
      assert.ok(rounds.every(round => round.choices.some(choice => choice.id === round.answerId)));
      items = rounds.map(round => document.items.find(item => item.id === round.answerId));
    } else if (game === 'naturalization-nucleus') {
      const pack = nucleus.validateCatalog(document);
      for (const pieceCount of pack.roundSettings.pieceCounts) {
        let decisions = 0;
        policy.onDecision = value => { trace = value; decisions++; };
        const round = nucleus.createRound(pack, pieceCount, random, '', difficulty, { selectContentItems, history: {}, policy });
        items = Array.from(round.solution, piece => piece.left);
        assert.equal(decisions, 1, 'one policy decision owns the actual Nucleus board');
        assert.equal(items.length, pieceCount);
        assert.equal(new Set(items.map(nucleus.readingKey)).size, pieceCount);
        assert.ok(items.every(item => item.difficulty <= difficulty));
        assert.deepEqual(trace.draws.map(draw => draw.chosenId), items.map(item => item.id));
        assert.equal(nucleus.countConnections(round.solution), pieceCount, 'selected items remain a complete solvable ring');
      }
    } else throw new Error(`Uncovered game: ${game}`);
    assert.ok(items.length && items.every(Boolean), `${course.id}/${game} has a playable selection`);
    assert.ok(items.every(item => (item.difficulty ?? 1) <= difficulty), `${course.id}/${game} preserves difficulty ${difficulty}`);
    assert.equal(new Set(items.map(item => item.id)).size, items.length, `${course.id}/${game} keeps distinct selections`);
    assert.deepEqual(trace.identity, policy.identity, `${course.id}/${game} keeps its real game and evidence-bank identity`);
    assert.equal(trace.semanticStatus, 'disabled');
    assert.equal(new Set(trace.draws.map(draw => draw.chosenGroupKey)).size, trace.draws.length,
      `${course.id}/${game} keeps distinct answer groups`);
    if (variant.controls) for (const [key, value] of Object.entries(variant.controls)) {
      assert.equal(trace.experimentalControls[key], value);
    } else assert.equal(trace.experimentalControls, undefined);
    seen.add(`${course.id}/${game}`);
  }
  assert.deepEqual(seen, new Set(catalogs.map(({ course, game }) => `${course.id}/${game}`)));
});

for (const variant of gameplayVariants) test(`listening words and sentences use separate adaptive evidence banks on every available course (${variant.id})`, async () => {
  for (const { document, course } of (await catalogsPromise).filter(catalog => catalog.game === 'sound-quasar')) {
    for (const mode of ['words', 'sentences']) for (const difficulty of [1, 2, 3]) {
      const bank = mode === 'words' ? document.items : document.sentences;
      const eligible = bank.filter(row => (row.difficulty ?? 1) <= difficulty);
      let trace;
      const policy = scope(course.id, 'sound-quasar', mode, value => { trace = value; });
      if (variant.controls) policy.select = (items, options) => createSamplingExperiment(items, options, variant.controls);
      const rounds = createSoundQuasarSession(document, { history: {}, difficulty, mode, random, policy });
      const ids = new Set(eligible.map(row => row.id));
      assert.equal(trace.identity.bankId, mode);
      assert.ok(rounds.length);
      assert.equal(new Set(rounds.map(round => round.answerId)).size, rounds.length);
      assert.ok(rounds.every(round => ids.has(round.answerId) && round.choices.every(choice => ids.has(choice.id))));
      assert.deepEqual(rounds.map(round => round.answerId), trace.draws.slice(0, rounds.length).map(draw => draw.chosenId));
    }
  }
});

test('Nucleus retains a full unique-reading board after the introduction budget is exhausted', async () => {
  const catalog = (await catalogsPromise).find(row => row.game === 'naturalization-nucleus');
  assert.ok(catalog);
  const nucleus = await nucleusPromise;
  const pack = nucleus.validateCatalog(catalog.document);
  const pieceCount = Math.min(...pack.roundSettings.pieceCounts);
  const groups = new Map();
  for (const row of nucleus.filterChallengesForDifficulty(pack.challenges, 1)) {
    const key = nucleus.readingKey(row);
    if (!groups.has(key)) groups.set(key, row);
  }
  assert.ok(groups.size >= pieceCount);
  const representatives = [...groups.values()].slice(0, pieceCount);
  // Use actual reviewed readings and target fields; duplicate variants only in
  // this in-memory scenario to guarantee a homophone collision regression.
  const challenges = representatives.flatMap((row, index) => [
    { ...row, id: `scenario-${index}-seen`, complexity: index < 2 ? 1 : 95 },
    { ...row, id: `scenario-${index}-peer`, complexity: index < 2 ? 1 : 95 }
  ]);
  const instant = Date.now();
  const recent = new Date(instant - 600000).toISOString();
  const history = Object.fromEntries(challenges.filter(row => row.id.startsWith('scenario-0-') || row.id.startsWith('scenario-1-'))
    .map(row => [row.id, { exposures: 1, firstSeenAt: recent, lastSeenAt: recent, dueAt: recent }]));
  // Full-bank history, including entries outside this particular candidate set,
  // must still exhaust the daily budget rather than granting another allowance.
  for (let index = 0; index < Math.max(6, pieceCount); index++) history[`other-${index}`] = {
    exposures: 1, firstSeenAt: new Date(instant).toISOString(), lastSeenAt: new Date(instant).toISOString()
  };
  let trace, decisions = 0;
  const policy = scope(catalog.course.id, 'naturalization-nucleus', 'recognize-pinyin-hanzi', value => { trace = value; decisions++; });
  const round = nucleus.createRound({ ...pack, challenges }, pieceCount, random, '', 1, { selectContentItems, history, policy });
  const selected = Array.from(round.solution, piece => piece.left);
  assert.equal(decisions, 1);
  assert.equal(selected.length, pieceCount);
  assert.equal(new Set(selected.map(nucleus.readingKey)).size, pieceCount);
  assert.equal(selected.filter(row => !history[row.id]).length, pieceCount - 2);
  assert.equal(trace.introductions, pieceCount - 2);
  assert.ok(trace.draws.some(draw => draw.fallbackReasons.includes('distinct-group-minimum-overrides-pacing')));
});

test('shared Word World exposure does not manufacture evidence in the selected reconstruction direction', () => {
  const rows = [{ id: 'sentence', difficulty: 1, usefulness: 60, complexity: 10 }];
  const exposure = { sentence: { exposures: 20, successes: 20, firstSeenAt: new Date(now - 86400000).toISOString(), lastSeenAt: new Date(now).toISOString() } };
  let trace;
  progressiveWordWorldSelection(rows, { now, random, history: wordWorldPracticeHistory(exposure, {}),
    policy: scope('es-en', 'word-world', 'reconstruct-target', value => { trace = value; }) });
  assert.equal(trace.identity.bankId, 'reconstruct-target');
  assert.equal(trace.candidates[0].evidenceStatus, 'exposure-only');
  assert.equal(trace.candidates[0].knowledge.recallProbability, null);
  assert.equal(trace.candidates[0].features.weakness, null);
});

test('disabled semantics never calls a provider; a failed optional warmup leaves practice usable', async () => {
  const key = Symbol.for('caatuu.adaptivePractice.v1');
  const previous = globalThis[key];
  const policy = scope('fixture-semantics', 'verb-nebula');
  let features = 0, warmups = 0;
  globalThis[key] = { owner: globalThis, latest: null, banks: new Map([[JSON.stringify(['fixture-semantics', 'verb-nebula', 'default']), {
    warmOffset: 0,
    provider: { features: () => { features++; return { byItem: {}, status: 'unavailable' }; },
      warm: async () => { warmups++; throw new Error('Model assets unavailable'); } }
  }]]) };
  try {
    const rows = [{ id: 'known', difficulty: 1, usefulness: 70, complexity: 10, englishAuditText: 'To learn' }];
    assert.equal(selectContentItems(rows, { policy, now, random })[0], rows[0]);
    assert.equal(features, 0); assert.equal(warmups, 0);
    assert.equal(globalThis[key].latest.semanticStatus, 'disabled');
    assert.equal(selectContentItems(rows, { policy: { ...policy, semanticsEnabled: true }, now, random })[0], rows[0]);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(features, 1); assert.equal(warmups, 1);
    assert.equal(globalThis[key].latest.semanticStatus, 'unavailable');
  } finally {
    if (previous === undefined) delete globalThis[key]; else globalThis[key] = previous;
  }
});

test('replacement policies cannot return duplicate answer groups or out-of-bank objects', () => {
  const rows = [{ id: 'a', reading: 'same', difficulty: 1 }, { id: 'b', reading: 'same', difficulty: 1 }];
  const policy = scope('fixture', 'naturalization-nucleus');
  assert.throws(() => selectContentItems(rows, { getGroupKey: row => row.reading, policy: {
    ...policy, select: () => ({ items: rows, trace: {} })
  } }), /invalid|ineligible|group/i);
  assert.throws(() => selectContentItems(rows, { policy: {
    ...policy, select: () => ({ items: [{ ...rows[0] }], trace: {} })
  } }), /invalid|ineligible/i);
});

test('explicit existing-policy fallback preserves Word World recent exclusions', () => {
  const rows = Array.from({ length: 8 }, (_, index) => ({ id: `fallback-${index}`, difficulty: 1, usefulness: 50, complexity: 10 }));
  const first = progressiveWordWorldSelection(rows, { now, random });
  const options = { now, random, excludeIds: [first.id] };
  const legacySelection = progressiveWordWorldSelection(rows, options);
  const explicitFallback = progressiveWordWorldSelection(rows, { ...options, policy: { ...scope('cz', 'word-world'), id: 'existing' } });
  assert.equal(explicitFallback.id, legacySelection.id);
});

test('explicit existing-policy fallback retains Nucleus distinct-reading construction', async () => {
  const catalog = (await catalogsPromise).find(row => row.game === 'naturalization-nucleus');
  const nucleus = await nucleusPromise;
  const pack = nucleus.validateCatalog(catalog.document);
  const pieceCount = Math.min(...pack.roundSettings.pieceCounts);
  const groups = new Map(nucleus.filterChallengesForDifficulty(pack.challenges, 1).map(row => [nucleus.readingKey(row), row]));
  const [first, ...others] = [...groups.values()].slice(0, pieceCount);
  const challenges = [
    ...Array.from({ length: pieceCount + 1 }, (_, index) => ({ ...first, id: `homophone-${index}`, complexity: 1 })),
    ...others.map((row, index) => ({ ...row, id: `other-${index}`, complexity: 90 }))
  ];
  const scenario = { ...pack, challenges };
  const legacyRound = nucleus.createRound(scenario, pieceCount, random, '', 1, { selectContentItems, history: {} });
  assert.equal(new Set(Array.from(legacyRound.solution, piece => nucleus.readingKey(piece.left))).size, pieceCount);
  const fallbackRound = nucleus.createRound(scenario, pieceCount, random, '', 1, {
    selectContentItems, history: {}, policy: { ...scope(catalog.course.id, 'naturalization-nucleus'), id: 'existing' }
  });
  assert.equal(new Set(Array.from(fallbackRound.solution, piece => nucleus.readingKey(piece.left))).size, pieceCount);
});

test('an assisted form error cannot become an independent parent error during conjugation aggregation', async () => {
  const catalog = (await catalogsPromise).find(row => row.game === 'conjugation-comet');
  const { course } = catalog;
  const pack = validateConjugationCometCatalog(catalog.document, { expectedCourseId: course.id,
    expectedTargetLanguageId: course.targetLanguage.id, expectedLearnerBaseLanguageId: course.sourceLanguage.id,
    expectedTargetLocale: course.targetLanguage.locale });
  const verb = pack.verbs.find(row => row.difficulty === 1);
  assert.ok(verb?.forms.length);
  const at = new Date(now - 86400000).toISOString();
  const independent = { exposures: 3, independentSuccesses: 2, lastEvidence: 'independent', lastCorrect: true,
    firstSeenAt: at, lastSeenAt: at, lastAttemptAt: at, lastIndependentAt: at };
  const history = { [verb.id]: { ...independent } };
  const formHistory = Object.fromEntries(verb.forms.map(form => [`${verb.id}.${form.id}`, { ...independent }]));
  formHistory[`${verb.id}.${verb.forms[0].id}`] = { ...independent, independentSuccesses: 0,
    lastEvidence: 'assisted', lastCorrect: false, lastAssistedAt: at };
  let trace;
  selectConjugationPracticeVerbs([verb], { now, random, history, formHistory,
    policy: scope(catalog.course.id, 'conjugation-comet', 'default', value => { trace = value; }) });
  assert.notEqual(trace.candidates[0].features.error, 1,
    'a parent independent-success timestamp must not be combined with an assisted form result to invent independent failure');
});
