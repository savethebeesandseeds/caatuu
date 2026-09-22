import {
  normalizeContentProgression, contentPracticeReadiness, matchesContentDifficulty,
  CONTENT_DAY_MS as DAY, CONTENT_PRACTICE_GAP_MS as GAP, CONTENT_INTRODUCTION_BUDGET as BUDGET
} from './content-progression.mjs';
import { learnerItemState } from '../learner-state.mjs';

const DEFAULT_WEIGHTS = Object.freeze({ usefulness: .7, goal: 2, weakness: 1.4,
  error: .8, uncertainty: .5, challenge: .8, novelty: .5, review: 1,
  semanticGoal: .7, semanticDiversity: 1, recency: 1 });
const DEFAULT_PATTERN = ['review', 'practice', 'new', 'review', 'practice'];
const NORMAL_ACCESS = Object.freeze({ uniformScores: false, frontier: true,
  introductions: true, slots: true, recency: true, outsideExploration: 0,
  softFrontier: false, crossCategoryRecency: false });
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
const timestamp = value => {
  const time = typeof value === 'string' ? Date.parse(value) : Number(value);
  return Number.isFinite(time) && time >= 0 ? time : 0;
};
const own = (object, key) => object && Object.hasOwn(object, key) ? object[key] : undefined;
const clamp = value => Math.max(0, Math.min(1, value));

function bounded(value, name, low = 0, high = 1) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < low || value > high) {
    throw new TypeError(`${name} must be finite in [${low}, ${high}].`);
  }
  return value;
}

function optionalProbability(value, name) {
  return value === undefined || value === null ? null : bounded(value, name);
}

function settings(config, goal) {
  const weights = { ...DEFAULT_WEIGHTS };
  if (goal.kind === 'review') weights.review *= 2;
  if (goal.kind === 'reinforce') {
    weights.weakness *= 1.5; weights.error *= 2; weights.novelty *= .5;
  }
  if (goal.kind === 'explore') {
    weights.novelty *= 2; weights.semanticDiversity *= 2; weights.uncertainty *= 1.5;
  }
  for (const [key, value] of Object.entries(config.weights || {})) {
    if (!Object.hasOwn(weights, key)) throw new TypeError(`Unknown policy weight ${key}.`);
    weights[key] = bounded(value, `weights.${key}`, 0, 100);
  }
  return { weights, exploration: bounded(config.exploration ?? (goal.kind === 'explore' ? .25 : .15), 'exploration'),
    temperature: bounded(config.temperature ?? .7, 'temperature', .01, 100),
    targetResponseProbability: bounded(config.targetResponseProbability ?? .75, 'targetResponseProbability', .01, .99) };
}

/**
 * Pure sequential selection without replacement. All candidates are already
 * course/game/bank scoped by the caller; difficulty selects one exact band.
 * Optional learner.evidenceByItem supplies actual bank evidence separately from
 * aggregate scheduling history (e.g. a complete conjugation board's readiness).
 * Optional learner.knowledgeByItem[id] contains explicitly supplied probabilities,
 * never inferred from exposure/readiness. identity enables learnerItemState's
 * evidence adapter. Optional semantic.byItem[id] contains goalSimilarity and/or
 * recentSimilarity, finite cosine values in [-1, 1], mapped to [0, 1]. They
 * describe English meaning only and never change assessment evidence.
 * goal.weights maps item IDs to nonnegative relevance weights; goal.categories
 * matches explicit item category/topic/objectiveId/tags/categories values.
 * Named kinds balanced/review/reinforce/explore tune documented heuristic weights.
 * Explore uses 25% uniform exploration (normally 15%) and, while the ordinary
 * daily allowance remains, new/practice/new/review/practice category slots.
 * After that allowance, the normal one-new-slot pattern and pacing still apply.
 * config overrides weights, exploration, temperature and targetResponseProbability.
 * excludeIds/recentIds defer those items when the same available category has
 * alternatives; exhausted categories remain playable with an explicit fallback.
 * getGroupKey(item), defaulting to getId, supplies an optional answer-equivalence
 * key (e.g. a pinyin reading). One decision samples at most one item per group;
 * minimumPool counts distinct groups, while introduction evidence stays per item.
 *
 * trace.candidates records observed and missing features and score contributions.
 * Each trace.draws distribution is conditional on its category, pacing constraints,
 * and earlier draws. It is NOT an item's total batch inclusion probability.
 * Selection, clock, random source and explanation are evaluated once per decision.
 */
export function createAdaptiveDecision(items, options = {}) {
  return samplingDecision(items, options, NORMAL_ACCESS);
}

/**
 * Manual Evaluator B ablations only; gameplay never opts into these controls.
 * softFrontier admits unseen items without the frontier/challenge-band exclusion,
 * retaining introduction, category, badge and answer-group rules. It subtracts
 * 2 * max(0, (position - frontier) / 100) from the score of unseen items only.
 * This fixed experimental penalty is not a fitted probability or configurable weight.
 * crossCategoryRecency tries another otherwise allowed category before repeating
 * an item in recentIds/excludeIds. Continued-introduction slot rules still apply;
 * exhausted alternatives retain the ordinary explicit playability fallback.
 */
export function createSamplingExperiment(items, options = {}, controls = {}) {
  if (!controls || typeof controls !== 'object' || Array.isArray(controls)) throw new TypeError('Experiment controls must be an object.');
  const access = { ...NORMAL_ACCESS };
  for (const [key, value] of Object.entries(controls)) {
    if (!Object.hasOwn(access, key)) throw new TypeError(`Unknown experiment control ${key}.`);
    if (key === 'outsideExploration') access[key] = bounded(value, key);
    else if (typeof value !== 'boolean') throw new TypeError(`${key} must be boolean.`);
    else access[key] = value;
  }
  const decision = samplingDecision(items, { ...options, accessDiagnostics: true }, access);
  decision.trace.experimentalControls = access;
  return decision;
}

function samplingDecision(items, {
  difficulty = 3, history = {}, minimumPool = 4, limit = Infinity,
  random = Math.random, getId = item => item.id, getGroupKey = getId, now = Date.now(),
  identity = null, learner = null, goal = {}, semantic = null, recentIds = [], excludeIds = [], config = {}, accessDiagnostics = false
} = {}, access = NORMAL_ACCESS) {
  if (!Array.isArray(items)) throw new TypeError('Content selection needs an array.');
  if (![1, 2, 3].includes(difficulty)) throw new TypeError('difficulty must be 1, 2, or 3.');
  if (!Number.isInteger(minimumPool) || minimumPool < 1) throw new TypeError('minimumPool must be positive.');
  if (limit !== Infinity && (!Number.isInteger(limit) || limit < 1)) throw new TypeError('limit must be positive.');
  if (!Number.isFinite(now) || now < 0) throw new TypeError('now must be a nonnegative timestamp.');
  if ([random, getId, getGroupKey].some(value => typeof value !== 'function')) throw new TypeError('random/getId/getGroupKey must be functions.');
  if (!history || typeof history !== 'object' || Array.isArray(history)) throw new TypeError('history must be a bank object.');
  if (!Array.isArray(recentIds)) throw new TypeError('recentIds must be an array.');
  if (!Array.isArray(excludeIds)) throw new TypeError('excludeIds must be an array.');
  const resolved = settings(config, goal);
  const hardFrontier = access.frontier && !access.softFrontier;
  const recent = new Set(recentIds.map(String));
  const excluded = new Set(excludeIds.map(String));
  const rows = [], ids = new Set();
  for (const item of items) {
    if (!matchesContentDifficulty(item, difficulty)) continue;
    const badge = item.difficulty === undefined ? 1 : item.difficulty;
    const id = String(getId(item) ?? '');
    if (!id || ids.has(id)) continue;
    const groupKey = String(getGroupKey(item) ?? '');
    if (!groupKey) throw new TypeError('getGroupKey must return a nonempty key.');
    ids.add(id);
    const grades = normalizeContentProgression(item, id);
    const progress = own(history, id) || {};
    const state = identity ? learnerItemState({ ...identity, itemId: id, history: learner?.evidenceByItem || history, now }) : null;
    rows.push({ item, id, groupKey, badge, ...grades, progress, state,
      position: (badge - 1) * 100 + grades.complexity,
      visits: count(progress.exposures), readiness: contentPracticeReadiness(progress),
      lastSeen: Math.min(now, timestamp(progress.lastSeenAt)) });
  }
  const trace = { policy: 'adaptive-scoring-v1', identity, goal: { id: goal.id || 'balanced', kind: goal.kind || 'balanced' },
    config: resolved, now, eligibleCount: rows.length, constraints: {}, candidates: [], draws: [],
    interpretation: 'Heuristic scheduling; missing knowledge is not zero knowledge. Conditional draw probabilities, not total inclusion probabilities.' };
  if (!rows.length) return { items: [], trace };
  const introduced = rows.filter(row => row.visits > 0);
  const unseen = rows.filter(row => row.visits === 0);
  const distinctGroups = new Set(rows.map(row => row.groupKey));
  const introducedGroups = new Set(introduced.map(row => row.groupKey));
  const minimumGroups = Math.min(minimumPool, distinctGroups.size);
  let frontier = Math.min(...rows.map(row => row.position)) + 18;
  for (const row of introduced) {
    if (row.readiness > 0) frontier = Math.max(frontier, row.position + 24 * row.readiness);
    const participation = Math.min(24, Math.max(0, count(row.progress.practiceDays) - 3) * 4);
    if (participation > 0) frontier = Math.max(frontier, row.position + participation);
  }
  const today = Math.floor(now / DAY);
  const introducedToday = progress => count(progress.exposures) > 0
    && Math.floor(Math.min(now, timestamp(progress.firstSeenAt || progress.lastSeenAt)) / DAY) === today;
  const todayCount = Object.values(history).filter(progress => progress && introducedToday(progress)).length;
  const pending = introduced.filter(row => row.readiness < .5).length;
  const usualBudget = Math.max(BUDGET, minimumPool);
  const meanReadiness = introduced.length ? introduced.reduce((sum, row) => sum + row.readiness, 0) / introduced.length : 0;
  const dailyBudget = pending > Math.max(12, minimumPool * 3)
    ? Math.max(1, Math.floor(usualBudget / 3)) : usualBudget + Math.floor(meanReadiness * 4);
  const allowance = access.introductions ? Math.max(0, dailyBudget - todayCount) : unseen.length;
  const continued = access.introductions && allowance === 0 && introducedGroups.size >= minimumGroups;
  const ordinaryIntroductionLimit = continued ? 1 : allowance;
  const introductionLimit = Math.max(ordinaryIntroductionLimit, minimumGroups - introducedGroups.size);
  const experienced = introduced.filter(row => row.readiness >= .5 || count(row.progress.practiceDays) >= 8);
  const anchor = experienced.length ? Math.max(...experienced.map(row => row.position)) : 0;
  const band = position => Math.floor((position - 1) / 10);
  const challengeUsedToday = introduced.some(row => introducedToday(row.progress) && band(row.position) > band(anchor));
  const higher = hardFrontier && allowance && anchor && !challengeUsedToday ? unseen.filter(row => band(row.position) > band(anchor)) : [];
  const nextBand = higher.length ? Math.min(...higher.map(row => band(row.position))) : null;
  const novel = unseen.filter(row => !hardFrontier || row.position <= frontier || band(row.position) === nextBand);
  const playable = new Set();
  // Sparse banks can exceed the ordinary frontier to provide enough distinct answers.
  const playableGroups = () => new Set([...introducedGroups,
    ...novel.filter(row => !hardFrontier || row.position <= frontier || playable.has(row.id)).map(row => row.groupKey)]);
  const playableCount = () => {
    const covered = playableGroups();
    return covered.size + Number(novel.some(row => !covered.has(row.groupKey)));
  };
  for (const row of [...unseen].sort((a, b) => a.position - b.position || b.usefulness - a.usefulness || a.id.localeCompare(b.id, 'en'))) {
    if (playableCount() >= minimumGroups) break;
    if (row.position <= frontier || playableGroups().has(row.groupKey)) continue;
    if (!novel.includes(row)) novel.push(row);
    playable.add(row.id);
  }
  const categories = Array.isArray(goal.categories) ? goal.categories : [];
  const explicitWeights = goal.weights && typeof goal.weights === 'object' ? goal.weights : null;
  const rawWeights = rows.map(row => explicitWeights ? bounded(own(explicitWeights, row.id) ?? 0, `goal.weights.${row.id}`, 0, Number.MAX_VALUE) : 0);
  const maxGoalWeight = Math.max(0, ...rawWeights);
  for (const [index, row] of rows.entries()) {
    const knowledge = own(learner?.knowledgeByItem, row.id);
    const recall = optionalProbability(knowledge?.recallProbability, `${row.id}.recallProbability`);
    const response = optionalProbability(knowledge?.responseProbability, `${row.id}.responseProbability`);
    const suppliedSemantic = own(semantic?.byItem, row.id);
    const cosine = name => suppliedSemantic?.[name] === undefined || suppliedSemantic?.[name] === null ? null
      : (bounded(suppliedSemantic[name], `${row.id}.${name}`, -1, 1) + 1) / 2;
    const goalSimilarity = cosine('goalSimilarity'), recentSimilarity = cosine('recentSimilarity');
    const itemCategories = [row.item.category, row.item.topic, row.item.objectiveId,
      ...(Array.isArray(row.item.categories) ? row.item.categories : []), ...(Array.isArray(row.item.tags) ? row.item.tags : [])];
    const relevantCategory = categories.some(category => itemCategories.includes(category));
    const latest = row.state?.evidence.latestAssessment;
    const independent = row.state?.evidence.independentlyAssessed
      ?? (count(row.progress.independentSuccesses) > 0 || row.progress.lastEvidence === 'independent');
    const independentError = row.state ? latest?.evidence === 'independent' && latest.correct === false
      : row.progress.lastEvidence === 'independent' && row.progress.lastCorrect === false;
    row.deadline = timestamp(row.progress.dueAt) || row.lastSeen + GAP;
    const target = resolved.targetResponseProbability;
    row.features = {
      usefulness: (row.usefulness - 1) / 99,
      goal: explicitWeights || categories.length ? Math.max(maxGoalWeight ? rawWeights[index] / maxGoalWeight : 0, relevantCategory ? 1 : 0) : null,
      weakness: recall === null ? null : 1 - recall,
      error: independent ? (independentError ? 1 : 0) : null,
      // A missing-evidence flag, not a numerical confidence or posterior variance.
      uncertainty: recall !== null ? 0 : independent ? 0 : 1,
      challenge: response === null ? 1 - clamp(Math.abs(row.position - frontier) / 100)
        : 1 - clamp(Math.abs(response - target) / Math.max(target, 1 - target)),
      novelty: row.visits ? 0 : 1,
      review: row.visits && row.deadline <= now ? .5 + .5 * clamp((now - row.deadline) / DAY) : 0,
      semanticGoal: goalSimilarity, semanticDiversity: recentSimilarity === null ? null : 1 - recentSimilarity,
      recency: recent.has(row.id) ? 0 : row.visits ? clamp((now - row.lastSeen) / GAP) : 1
    };
    row.contributions = Object.fromEntries(Object.entries(row.features).map(([key, value]) => [key, value === null ? 0 : value * resolved.weights[key]]));
    row.score = Object.values(row.contributions).reduce((sum, value) => sum + value, 0);
    const scoreBeforePenalty = row.score;
    const softFrontierPenalty = !row.visits ? 2 * Math.max(0, (row.position - frontier) / 100) : 0;
    if (access.softFrontier) row.score -= softFrontierPenalty;
    trace.candidates.push({ id: row.id, groupKey: row.groupKey, difficulty: row.badge, complexity: row.complexity,
      position: row.position, readiness: row.readiness,
      categories: [...new Set(itemCategories.filter(value => typeof value === 'string'))],
      knowledge: { recallProbability: recall, responseProbability: response },
      evidenceStatus: row.state?.evidenceStatus || (independent ? 'independently-assessed' : row.visits ? 'exposure-only' : 'unassessed'),
      sources: { usefulness: row.item.usefulness === undefined ? row.item.urgency === undefined ? 'neutral-compatibility-default' : 'legacy-urgency' : 'authored',
        complexity: row.item.complexity === undefined ? row.item.subdifficulty === undefined ? 'neutral-compatibility-default' : 'legacy-subdifficulty' : 'authored',
        challenge: response === null ? 'editorial-frontier-heuristic' : 'supplied-response-probability',
        uncertainty: 'missing-independent-evidence-indicator', weakness: recall === null ? 'unavailable' : 'supplied-recall-probability' },
      features: row.features, contributions: row.contributions, score: row.score,
      ...(access.softFrontier ? { scoreBeforePenalty, softFrontierPenalty } : {}),
      missingFeatures: Object.keys(row.features).filter(key => row.features[key] === null) });
  }
  Object.assign(trace.constraints, { difficulty, minimumPool, frontier, dailyBudget, introducedToday: todayCount,
    distinctGroups: distinctGroups.size, minimumGroups, introducedGroups: introducedGroups.size,
    ordinaryIntroductionLimit, introductionLimit, continuedIntroductions: continued, nextChallengeBand: nextBand,
    playabilityFallbackIds: [...playable] });
  const due = introduced.filter(row => row.deadline <= now && now - row.lastSeen >= GAP);
  const rested = introduced.filter(row => now - row.lastSeen >= GAP);
  const selected = [], selectedGroups = new Set();
  const size = Math.min(distinctGroups.size, Math.max(BUDGET, minimumPool), limit);
  const requiredSize = Math.min(minimumGroups, size);
  const rotation = introduced.reduce((sum, row) => (sum + row.visits) % DEFAULT_PATTERN.length, 0);
  const pattern = goal.kind === 'review' ? ['review', 'review', 'new', 'review', 'practice']
    : goal.kind === 'explore' && allowance > 0 ? ['new', 'practice', 'new', 'review', 'practice'] : DEFAULT_PATTERN;
  trace.pattern = [...pattern];
  let introductions = 0, challengeChosen = false;
  const novelIds = accessDiagnostics ? new Set(novel.map(row => row.id)) : null;
  const hardIds = accessDiagnostics ? rows.map(row => row.id) : null;
  while (selected.length < size) {
    const hardRemaining = accessDiagnostics || access.outsideExploration > 0
      ? rows.filter(row => !selectedGroups.has(row.groupKey)) : null;
    const restrictions = accessDiagnostics ? [] : null, stages = accessDiagnostics ? [] : null;
    const restriction = (name, kind, excludedRows) => {
      if (accessDiagnostics) restrictions.push({ name, kind, excludedIds: excludedRows.map(row => row.id) });
    };
    const stage = (name, remainingRows) => {
      if (accessDiagnostics) stages.push({ name, remainingIds: remainingRows.map(row => row.id) });
    };
    if (accessDiagnostics) {
      restriction('used-answer-group', 'hard', rows.filter(row => selectedGroups.has(row.groupKey)));
      restriction('frontier', 'soft', hardRemaining.filter(row => !row.visits && !novelIds.has(row.id)));
      restriction('introduction-budget', 'soft', access.introductions && introductions >= introductionLimit
        ? hardRemaining.filter(row => !row.visits) : []);
      restriction('one-frontier-challenge-per-board', 'soft', hardFrontier && challengeChosen
        ? hardRemaining.filter(row => !row.visits && row.position > frontier && !playable.has(row.id)) : []);
      stage('hard-remaining', hardRemaining);
    }
    const requestedCategory = pattern[(rotation + selected.length) % pattern.length];
    const remainingIntroducedGroups = [...introducedGroups].filter(key => !selectedGroups.has(key)).length;
    const requiredNewGroups = Math.max(0, requiredSize - selected.length - remainingIntroducedGroups);
    const availableNew = introductions < introductionLimit ? novel.filter(row =>
      (!hardFrontier || playable.has(row.id) || row.position <= frontier || !challengeChosen)
      // Reserve scarce introduction slots for genuinely missing answer groups,
      // instead of spending them on unseen homophones of already known groups.
      && (introductionLimit - introductions > requiredNewGroups || !introducedGroups.has(row.groupKey))) : [];
    const pools = { new: availableNew, review: due, rested, practice: introduced };
    const order = requestedCategory === 'new' ? ['new', 'review', 'rested', 'practice']
      : continued ? (requestedCategory === 'review' ? ['review', 'rested', 'practice'] : ['rested', 'review', 'practice'])
        : requestedCategory === 'review' ? ['review', 'rested', 'new', 'practice'] : ['rested', 'review', 'new', 'practice'];
    let candidates = [], category = '';
    if (!access.slots) {
      const newIds = new Set(availableNew.map(row => row.id));
      candidates = rows.filter(row => (row.visits || newIds.has(row.id)) && !selectedGroups.has(row.groupKey));
      category = 'mixed';
    } else {
      for (const key of order) {
        candidates = pools[key].filter(row => !selectedGroups.has(row.groupKey));
        if (candidates.length) { category = key; break; }
      }
    }
    if (accessDiagnostics) {
      const poolIds = new Set(candidates.map(row => row.id));
      restriction('slot-allocation', 'soft', access.slots ? hardRemaining.filter(row => !poolIds.has(row.id)) : []);
      restriction('pacing-reservation-for-missing-groups', 'soft', introductionLimit - introductions <= requiredNewGroups
        ? hardRemaining.filter(row => !row.visits && introducedGroups.has(row.groupKey)) : []);
      stage('scheduled-pool', candidates);
    }
    // Group collisions can remove the ordinary challenge candidate. Guarantee
    // only the requested playable minimum, using the nearest remaining demand.
    let minimumFallback = false;
    if (!candidates.length && selected.length < requiredSize) {
      const remaining = unseen.filter(row => !selectedGroups.has(row.groupKey));
      const nearest = remaining.length ? Math.min(...remaining.map(row => row.position)) : null;
      candidates = remaining.filter(row => row.position === nearest);
      category = 'new'; minimumFallback = true;
    }
    if (!candidates.length && access.outsideExploration > 0 && hardRemaining.length) {
      candidates = hardRemaining;
      category = 'hard-fallback';
    }
    if (!candidates.length) break;
    stage('minimum-playability', candidates);
    const reasons = !access.slots || category === requestedCategory || requestedCategory === 'practice' && category === 'rested'
      ? [] : [`${requestedCategory}-empty-or-paced`];
    if (minimumFallback || category === 'new' && introductions >= ordinaryIntroductionLimit) {
      reasons.push('distinct-group-minimum-overrides-pacing');
    }
    if (access.crossCategoryRecency && access.recency && access.slots) {
      const fresh = row => !recent.has(row.id) && !excluded.has(row.id);
      if (!candidates.some(fresh)) {
        let alternativeCategory = '';
        // Reuse only pools already permitted by this slot's pacing. In particular,
        // an exhausted daily allowance must not turn every repeat into a new item.
        for (const key of order) {
          if (key === category) continue;
          const alternatives = pools[key].filter(row => !selectedGroups.has(row.groupKey) && fresh(row));
          if (alternatives.length) { candidates = alternatives; alternativeCategory = key; break; }
        }
        if (alternativeCategory) {
          category = alternativeCategory;
          reasons.push('cross-category-recency-alternative');
        } else reasons.push('cross-category-recency-exhausted');
      }
      stage('cross-category-recency', candidates);
    }
    const unexcluded = access.recency ? candidates.filter(row => !excluded.has(row.id)) : candidates;
    if (accessDiagnostics) restriction('recent-exclusion-list', 'soft', unexcluded.length
      ? hardRemaining.filter(row => access.recency && excluded.has(row.id)) : []);
    if (unexcluded.length && unexcluded.length !== candidates.length) { candidates = unexcluded; reasons.push('excluded-items-deferred'); }
    else if (!unexcluded.length && candidates.length) reasons.push('excluded-items-required-for-category-playability');
    stage('recent-exclusion-list', candidates);
    const notRecent = access.recency ? candidates.filter(row => !recent.has(row.id)) : candidates;
    if (accessDiagnostics) restriction('recent-history', 'soft', notRecent.length
      ? hardRemaining.filter(row => access.recency && recent.has(row.id)) : []);
    if (notRecent.length && notRecent.length !== candidates.length) { candidates = notRecent; reasons.push('recent-items-deferred'); }
    else if (!notRecent.length && candidates.length) reasons.push('recent-items-required-for-playability');
    stage('recent-history', candidates);
    // A single reserved higher-band introduction prevents hundreds of easy
    // records from becoming an implicit prerequisite gate. Exploration still
    // samples among that band's eligible items; exclusion rules apply first.
    const challengeCandidates = category === 'new' && !challengeChosen && nextBand !== null
      ? candidates.filter(row => band(row.position) === nextBand && !playable.has(row.id)) : [];
    if (accessDiagnostics) {
      const challengeIds = new Set(challengeCandidates.map(row => row.id));
      restriction('nearest-challenge-reservation', 'soft', challengeCandidates.length
        ? hardRemaining.filter(row => !challengeIds.has(row.id)) : []);
    }
    if (challengeCandidates.length) { candidates = challengeCandidates; reasons.push('nearest-challenge-band-reserved'); }
    stage('paced-support', candidates);
    const pacedIds = accessDiagnostics || access.outsideExploration > 0 ? candidates.map(row => row.id) : null;
    const maxScore = Math.max(...candidates.map(row => row.score));
    const masses = candidates.map(row => Math.exp((row.score - maxScore) / resolved.temperature));
    const total = masses.reduce((sum, mass) => sum + mass, 0);
    let distribution = candidates.map((row, index) => ({ id: row.id,
      probability: access.uniformScores ? 1 / candidates.length
        : (1 - resolved.exploration) * masses[index] / total + resolved.exploration / candidates.length }));
    if (access.outsideExploration > 0) {
      const paced = new Map(distribution.map(row => [row.id, row.probability]));
      candidates = hardRemaining;
      distribution = candidates.map(row => ({ id: row.id,
        probability: (1 - access.outsideExploration) * (paced.get(row.id) || 0)
          + access.outsideExploration / candidates.length }));
    }
    stage('actual-support', candidates);
    const draw = bounded(random(), 'random result', 0, 1);
    let cumulative = 0, chosenIndex = candidates.length - 1;
    for (let index = 0; index < distribution.length; index++) {
      cumulative += distribution[index].probability;
      if (draw < cumulative) { chosenIndex = index; break; }
    }
    const chosen = candidates[chosenIndex];
    if (access.outsideExploration > 0 && !pacedIds.includes(chosen.id)) reasons.push('experimental-access-outside-paced-set');
    if (!chosen.visits) {
      introductions++;
      if (nextBand !== null && band(chosen.position) === nextBand && !playable.has(chosen.id)) challengeChosen = true;
    }
    if (playable.has(chosen.id)) reasons.push('distinct-answer-minimum-exceeds-frontier');
    selected.push(chosen.item); selectedGroups.add(chosen.groupKey);
    const availableIds = accessDiagnostics ? distribution.filter(row => row.probability > 0).map(row => row.id) : null;
    const availableSet = accessDiagnostics ? new Set(availableIds) : null;
    trace.draws.push({ slot: selected.length - 1, requestedCategory, category, chosenId: chosen.id, chosenGroupKey: chosen.groupKey,
      conditionalProbability: distribution[chosenIndex].probability, distribution, fallbackReasons: reasons,
      ...(accessDiagnostics ? { access: { hardEligibleIds: hardIds, hardRemainingIds: hardRemaining.map(row => row.id),
        pacedIds, availableIds, stages,
        restrictions: restrictions.map(rule => ({ ...rule,
          restoredIds: rule.excludedIds.filter(id => availableSet.has(id)) })),
        interpretation: 'Restriction predicates overlap. Stages show actual support; fallbacks and outside exploration can restore soft exclusions. Do not sum restriction counts.' } } : {}) });
  }
  trace.introductions = introductions;
  return { items: selected, trace };
}

export function selectAdaptiveItems(items, options = {}) {
  const decision = createAdaptiveDecision(items, options);
  options.onDecision?.(decision.trace);
  return decision.items;
}
