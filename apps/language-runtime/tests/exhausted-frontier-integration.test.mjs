import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { contentPracticeReadiness } from '../static/source/games/content-progression.mjs';
import { createSoundQuasarSession, validateSoundQuasarCatalog } from '../static/source/games/sound-quasar/sound-quasar-core.mjs';
import { createNounLandingSession, normalizeNounLandingPack } from '../static/source/games/grammar-gravity/noun-landing-core.mjs';

const repository = new URL('../../../', import.meta.url);
const read = async path => JSON.parse(await readFile(new URL(path, repository), 'utf8'));
const course = await read('apps/languages/czech/course.json');
const listening = validateSoundQuasarCatalog(await read(course.resources.soundQuasarCatalog.path));
const nouns = normalizeNounLandingPack(await read(course.resources.grammarGravityNouns.path), {
  courseId: course.id,
  learnerBaseLanguage: course.sourceLanguage.locale,
  targetLanguage: course.targetLanguage.locale
});
const cases = [
  { label: 'advanced listening words', gameId: 'sound-quasar', bankId: 'words', difficulty: 3 },
  { label: 'beginner listening sentences', gameId: 'sound-quasar', bankId: 'sentences', difficulty: 1 },
  { label: 'advanced listening sentences', gameId: 'sound-quasar', bankId: 'sentences', difficulty: 3 },
  { label: 'advanced noun landing', gameId: 'grammar-gravity', bankId: 'nouns', difficulty: 3 }
];

function seededRandom() {
  let seed = 191019;
  return () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  };
}

for (const scenario of cases) test(`continued Czech ${scenario.label} reaches material beyond an exhausted initial window`, () => {
  const { difficulty, gameId, bankId } = scenario;
  const bank = gameId === 'grammar-gravity' ? nouns.items
    : bankId === 'sentences' ? listening.sentences : listening.items;
  const eligible = bank.filter(item => item.difficulty === difficulty);
  const byId = new Map(eligible.map(item => [item.id, item]));
  const initialComplexity = Math.min(...eligible.map(item => item.complexity)) + 18;
  const initialWindow = eligible.filter(item => item.complexity <= initialComplexity);
  assert.ok(initialWindow.length < eligible.length, 'the authored bank contains more material at this difficulty');

  const history = {};
  const encountered = new Set();
  const random = seededRandom();
  const now = Date.UTC(2026, 9, 19, 12);
  let continuationDraws = 0;
  let trace;
  const policy = {
    identity: { courseId: course.id, gameId, bankId, assessmentDirection: bankId },
    semanticsEnabled: false,
    now,
    onDecision: value => { trace = value; }
  };
  for (let cohort = 0; cohort < 30; cohort += 1) {
    const before = structuredClone(history);
    const options = { difficulty, history, random, policy };
    let presented;
    if (gameId === 'sound-quasar') {
      const rounds = createSoundQuasarSession(listening, { ...options, mode: bankId });
      assert.ok(rounds.every(round => round.choices.every(choice => byId.has(choice.id))),
        'listening alternatives stay in the selected difficulty');
      presented = rounds.map(round => byId.get(round.answerId));
    } else {
      const session = createNounLandingSession(nouns, options);
      presented = [session.item, ...session.queue];
    }
    assert.deepEqual(history, before, 'constructing a cohort never adds learner evidence');
    assert.ok(presented.length && presented.every(item => item && item.difficulty === difficulty));
    assert.equal(trace.constraints.frontier, (difficulty - 1) * 100 + initialComplexity,
      'continued presentations do not raise the readiness frontier');

    const crossed = trace.draws.filter(draw => !before[draw.chosenId]?.exposures
      && byId.get(draw.chosenId).complexity > initialComplexity);
    assert.ok(crossed.length <= 1, 'a cohort introduces at most one item beyond its exhausted window');
    for (const draw of crossed) {
      assert.equal(draw.requestedCategory, 'new', 'continuation uses the scheduled introduction slot');
      assert.ok(draw.fallbackReasons.includes('exhausted-frontier-continuation'));
      assert.ok(initialWindow.every(item => before[item.id]?.exposures),
        'unseen material inside the current window is introduced first');
      continuationDraws += 1;
    }
    // Only the items actually presented by the game enter its history. In
    // particular, Sound Quasar does not expose unused sampler queue entries.
    for (const item of presented) {
      const previous = history[item.id];
      history[item.id] = {
        exposures: (previous?.exposures || 0) + 1,
        firstSeenAt: previous?.firstSeenAt || new Date(now).toISOString(),
        lastSeenAt: new Date(now).toISOString(),
        practiceDays: 1,
        independentDays: 0,
        spacedSuccesses: 0,
        intervalMs: 0
      };
      encountered.add(item.id);
    }
  }
  assert.ok(continuationDraws > 0);
  assert.ok([...encountered].some(id => byId.get(id).complexity > initialComplexity),
    'completed cohorts do not remain trapped in the initial authored window');
  assert.ok(Object.values(history).every(item => contentPracticeReadiness(item) === 0),
    'exposure-only practice never becomes evidence of delayed recall');
});
