// Local interaction prototype. No learner evidence, Stats or XP is persisted.
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const normalized = value => String(value ?? '').normalize('NFC').trim().toLowerCase();
const bounded = value => Math.max(0, Math.min(1, Number.isFinite(Number(value)) ? Number(value) : 0));

export function validatePack(pack) {
  if (pack?.schemaVersion !== 'caatuu-memory-moon-demo-v1' || !nonempty(pack.courseId)
      || !Array.isArray(pack.challenges) || !pack.challenges.length) {
    throw new Error('Memory Moon needs a supported nonempty challenge pack.');
  }
  const ids = new Set();
  for (const item of pack.challenges) {
    const reference = item.sourceReference;
    if (!nonempty(item.id) || ids.has(item.id) || !nonempty(item.targetText) || !nonempty(item.englishText)
        || !Array.isArray(item.choices) || item.choices.length !== 3
        || item.choices.some(choice => !nonempty(choice.id) || !nonempty(choice.text))
        || new Set(item.choices.map(choice => choice.id)).size !== 3
        || new Set(item.choices.map(choice => normalized(choice.text))).size !== 3
        || item.choices.find(choice => choice.id === item.correctChoiceId)?.text !== item.englishText
        || !['courseId', 'gameId', 'bankId', 'itemId', 'contentRevision'].every(key => nonempty(reference?.[key]))) {
      throw new Error(`Invalid Memory Moon challenge: ${item.id || '(missing ID)'}.`);
    }
    ids.add(item.id);
  }
  return pack;
}

function shuffled(items, random) {
  const copy = items.slice();
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const next = Math.floor(Math.min(0.999999999, bounded(random())) * (index + 1));
    [copy[index], copy[next]] = [copy[next], copy[index]];
  }
  return copy;
}

function sameSource(item, weakness) {
  const identity = weakness.identity || weakness.sourceReference || weakness;
  const id = identity.itemId || identity.id;
  if (id !== item.sourceReference.itemId && id !== item.id) return false;
  return ['courseId', 'gameId', 'bankId', 'contentRevision'].every(key =>
    identity[key] == null || String(identity[key]) === String(item.sourceReference[key]));
}

/** Supplied similarities are relevance hints, never inferred mastery scores. */
export function selectMoonChallenges(pack, {
  weaknesses = [], similarityById = {}, random = Math.random, limit = 6
} = {}) {
  validatePack(pack);
  const count = Math.min(pack.challenges.length, Math.max(0, Math.floor(Number(limit) || 0)));
  const evidence = Array.isArray(weaknesses) ? weaknesses.filter(row => row && typeof row === 'object') : [];
  const ranked = shuffled(pack.challenges, random).map(item => {
    let score = 0, reason = 'balanced-practice';
    for (const weakness of evidence) {
      const weight = Math.max(0, Math.min(10, Number.isFinite(weakness.weight) ? weakness.weight : 1));
      if (!weight) continue;
      if (sameSource(item, weakness) && 100 + weight > score) {
        score = 100 + weight;
        reason = 'recent-mistake';
      } else if (nonempty(weakness.englishText) && normalized(weakness.englishText) === normalized(item.englishText)
          && 20 + weight > score) {
        score = 20 + weight;
        reason = 'related-practice';
      }
    }
    const similarity = similarityById instanceof Map ? similarityById.get(item.id) : similarityById?.[item.id];
    if (evidence.length && Number.isFinite(similarity) && 10 * bounded(similarity) > score) {
      score = 10 * bounded(similarity);
      reason = 'related-practice';
    }
    return { item, score, reason };
  }).sort((left, right) => right.score - left.score);
  // Leave room for a broader mix even when every candidate resembles a mistake.
  const selected = ranked.filter(row => row.score > 0).slice(0, Math.ceil(count * 2 / 3));
  const chosen = new Set(selected.map(row => row.item.id));
  const topics = new Map();
  for (const row of selected) topics.set(row.item.topic, (topics.get(row.item.topic) || 0) + 1);
  while (selected.length < count) {
    const available = ranked.filter(row => !chosen.has(row.item.id));
    available.sort((left, right) => (topics.get(left.item.topic) || 0) - (topics.get(right.item.topic) || 0));
    const next = available[0];
    selected.push(next);
    chosen.add(next.item.id);
    topics.set(next.item.topic, (topics.get(next.item.topic) || 0) + 1);
  }
  return selected.map(({ item, reason }) => ({ ...item, choices: shuffled(item.choices, random), selectionReason: reason }));
}

export function createMoonSession(items, { target = 6 } = {}) {
  if (!Array.isArray(items) || !items.length || !Number.isSafeInteger(target) || target < 1) {
    throw new Error('A Moon session needs challenges and a positive whole target.');
  }
  return { items: items.slice(), index: 0, target, correctCount: 0, independentCorrectCount: 0,
    mistakes: 0, progress: 0, phase: 'question', attempts: 0, wrongChoiceIds: [], assisted: false, lastAnswer: null };
}

export function answerMoonChallenge(state, choiceId) {
  if (state.phase !== 'question' || state.wrongChoiceIds.includes(choiceId)) return state;
  const item = state.items[state.index % state.items.length];
  if (!item.choices.some(choice => choice.id === choiceId)) throw new Error('Unknown Moon translation choice.');
  const correct = choiceId === item.correctChoiceId;
  const correctCount = state.correctCount + Number(correct);
  return { ...state, correctCount,
    independentCorrectCount: state.independentCorrectCount + Number(correct && !state.assisted),
    mistakes: state.mistakes + Number(!correct),
    progress: correctCount / state.target,
    phase: correct ? (correctCount >= state.target ? 'complete' : 'answered') : 'question',
    attempts: state.attempts + 1,
    wrongChoiceIds: correct ? state.wrongChoiceIds : [...state.wrongChoiceIds, choiceId],
    assisted: state.assisted || !correct,
    lastAnswer: { choiceId, correct, assisted: state.assisted || !correct }
  };
}

export function advanceMoonChallenge(state) {
  if (state.phase !== 'answered') return state;
  return { ...state, index: state.index + 1, phase: 'question', attempts: 0,
    wrongChoiceIds: [], assisted: false, lastAnswer: null };
}

/** Visible lit fraction while the Sun angle advances from new to full Moon. */
export function moonIllumination(progress) {
  return (1 - Math.cos(Math.PI * bounded(progress))) / 2;
}

/** Orthographic shadow on a sphere, SVG viewBox 0 0 200 200; right side lights first. */
export function moonShadePath(progress) {
  const fraction = bounded(progress);
  if (fraction >= 1) return '';
  // A sunlit hemisphere's great-circle boundary projects to a half ellipse.
  // Its horizontal radius follows the phase angle, collapsing to a straight
  // meridian at first quarter before curving back towards the dark limb.
  const terminator = Math.abs(Math.cos(Math.PI * fraction)) * 100;
  const boundary = terminator < 0.000001 ? 'L 100 0' :
    `A ${Number(terminator.toFixed(6))} 100 0 0 ${fraction < 0.5 ? 0 : 1} 100 0`;
  return `M 100 0 A 100 100 0 0 0 100 200 ${boundary} Z`;
}
