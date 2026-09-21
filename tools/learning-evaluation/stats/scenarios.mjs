const DAY = 86_400_000;
const MINUTE = 60_000;

export function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let value = Math.imul(state ^ state >>> 15, 1 | state);
    value ^= value + Math.imul(value ^ value >>> 7, 61 | value);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

export function validateConfiguration(config) {
  if (config.schemaVersion !== 1) throw new TypeError('Only stats configuration schemaVersion 1 is supported.');
  for (const [key, maximum] of [['learners', 1000], ['rounds', 500]]) {
    if (!Number.isSafeInteger(config[key]) || config[key] < 1 || config[key] > maximum) {
      throw new TypeError(`${key} must be an integer from 1 through ${maximum}.`);
    }
  }
  if (!Number.isSafeInteger(config.seed) || config.seed < 0 || config.seed > 0xFFFFFFFF) throw new TypeError('seed must be a uint32.');
  if (typeof config.startAt !== 'string' || !Number.isFinite(Date.parse(config.startAt))) throw new TypeError('startAt must be an ISO timestamp.');
  for (const key of ['daysBetweenRounds', 'longGapDays', 'halfLifeDays']) {
    if (!Number.isFinite(config[key]) || config[key] <= 0 || config[key] > 3650) throw new TypeError(`${key} must be positive and at most 3650.`);
  }
  if (config.daysBetweenRounds < 0.01) throw new TypeError('daysBetweenRounds must be at least 0.01 to fit scripted encounters.');
  for (const key of ['learningGain', 'assistedGain', 'exposureGain', 'guessRate', 'slipRate']) {
    if (!Number.isFinite(config[key]) || config[key] < 0 || config[key] > 1) throw new TypeError(`${key} must be from 0 through 1.`);
  }
  if (!Number.isFinite(config.relatedTransferFraction) || config.relatedTransferFraction < 0 || config.relatedTransferFraction > 0.1) {
    throw new TypeError('relatedTransferFraction must be from 0 through 0.1; transfer is intentionally limited.');
  }
  return config;
}

/** Synthetic world only. Nothing in this object is an estimator input. */
export function createScriptedLearner(config, learnerIndex) {
  const random = seededRandom((config.seed + Math.imul(learnerIndex + 1, 2654435761)) >>> 0);
  const learnerId = `learner-${learnerIndex}`;
  const priorType = learnerIndex % 2 ? 'uneven-prior' : 'beginner';
  const start = Date.parse(config.startAt);
  const definitions = [
    ['exposure', 'sound-quasar', 'words', 'exposure-only', null],
    ['supported', 'sound-quasar', 'words', 'supported-only', null],
    ['learning', 'sound-quasar', 'words', 'learning-and-forgetting', null],
    ['errors', 'sound-quasar', 'words', 'repeated-errors', null],
    ['lucky', 'sound-quasar', 'words', 'lucky-guess', null],
    ['error-then-support', 'sound-quasar', 'words', 'error-provenance', null],
    ['related-source', 'sound-quasar', 'words', 'related-a', null],
    ['related-unpracticed', 'sound-quasar', 'words', 'related-b', null],
    ['forward', 'word-world', 'reconstruct-target', 'directional-item', 'reconstruct-target'],
    ['reverse', 'word-world', 'reconstruct-source', 'directional-item', 'reconstruct-source'],
    ['unseen', 'sound-quasar', 'words', 'unseen-item', null],
  ];
  const targets = definitions.map(([label, gameId, bankId, itemId, assessmentDirection]) => ({ label,
    identity: { courseId: 'stats-fixture', gameId, bankId, itemId, assessmentDirection } }));
  const states = new Map(targets.map(target => [target.label, {
    strength: target.label === 'lucky' ? 0.01
      : priorType === 'uneven-prior' && ['learning', 'forward', 'unseen'].includes(target.label) ? 0.75 + random() * 0.15
        : 0.02 + random() * 0.08,
    at: start,
  }]));
  const strengthAt = (label, at) => {
    const state = states.get(label);
    return state.strength * 2 ** (-(at - state.at) / (DAY * config.halfLifeDays));
  };
  const truthAt = at => Object.fromEntries(targets.map(({ label }) => [label, strengthAt(label, at)]));
  const steps = [{ phase: 'initial', at: start, interaction: null, hiddenTruth: truthAt(start) }];
  const add = (label, at, evidence, forcedCorrect, phase, encounterId = `${learnerId}-${steps.length}`) => {
    const target = targets.find(value => value.label === label);
    const before = strengthAt(label, at);
    let correct = forcedCorrect;
    let luckyGuess = phase === 'scripted-lucky-guess';
    if (correct === undefined) {
      const retrieved = random() < before;
      luckyGuess = !retrieved && random() < config.guessRate;
      correct = (retrieved || luckyGuess) && random() >= config.slipRate;
      luckyGuess &&= correct;
    }
    const gain = evidence === 'exposure' ? config.exposureGain
      : evidence === 'assisted' ? config.assistedGain : config.learningGain;
    const increase = (1 - before) * gain;
    states.set(label, { strength: before + increase, at });
    if (label === 'related-source') {
      // Only this authored synthetic relation transfers; directions and all other pairs do not.
      const related = strengthAt('related-unpracticed', at);
      states.set('related-unpracticed', { strength: Math.min(1, related + increase * config.relatedTransferFraction), at });
    }
    steps.push({ phase, at, target: label,
      interaction: { identity: target.identity, event: { encounterId, correct, evidence } },
      simulator: { strengthBefore: before, luckyGuess, scriptedOutcome: forcedCorrect !== undefined },
      hiddenTruth: truthAt(at) });
  };
  add('exposure', start + MINUTE, 'exposure', null, 'presentation-only');
  add('supported', start + 2 * MINUTE, 'assisted', null, 'hint', 'supported-encounter');
  add('supported', start + 3 * MINUTE, 'independent', true, 'hinted-correction', 'supported-encounter');
  add('errors', start + 4 * MINUTE, 'independent', false, 'first-independent-error');
  add('lucky', start + 5 * MINUTE, 'independent', true, 'scripted-lucky-guess');
  add('error-then-support', start + 6 * MINUTE, 'independent', false, 'error-before-support');
  add('error-then-support', start + 7 * MINUTE, 'assisted', null, 'error-provenance-after-support');
  for (let round = 0; round < config.rounds; round++) {
    const at = start + (round + 1) * config.daysBetweenRounds * DAY;
    add('learning', at, 'independent', round < 4 ? true : undefined, 'learning-practice');
    add('errors', at + MINUTE, 'independent', round < 3 ? false : undefined, 'repeated-error-practice');
    add('related-source', at + 2 * MINUTE, 'independent', undefined, 'related-exercise-practice');
    add('forward', at + 3 * MINUTE, 'independent', round < 4 ? true : undefined, 'forward-direction-practice');
    add('exposure', at + 4 * MINUTE, 'exposure', null, 'repeated-presentation');
    add('supported', at + 5 * MINUTE, 'assisted', true, 'assisted-practice');
  }
  const beforeGap = steps.at(-1).at + MINUTE;
  steps.push({ phase: 'before-gap', at: beforeGap, interaction: null, hiddenTruth: truthAt(beforeGap) });
  const afterGap = beforeGap + config.longGapDays * DAY;
  steps.push({ phase: 'after-gap-before-response', at: afterGap, interaction: null, hiddenTruth: truthAt(afterGap) });
  add('learning', afterGap + MINUTE, 'independent', false, 'post-gap-lapse');
  add('reverse', afterGap + 2 * MINUTE, 'independent', false, 'reverse-direction-assessment');
  return { learnerId, priorType, targets, steps };
}
