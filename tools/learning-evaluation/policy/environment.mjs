import { keyedRandom } from "./random.mjs";

const DAY_MS = 86400000;
const clamp = value => Math.max(0, Math.min(1, value));
const MODALITY_LEARNING = Object.freeze({ exposure: 0.35, assisted: 0.65,
  retrieved: 1, feedback: 0.75 });
const ASSISTANCE_RESCUE_PROBABILITY = 0.6;

export const SIMULATOR_ASSUMPTIONS = Object.freeze({
  modalityLearning: MODALITY_LEARNING,
  assistanceRescueProbability: ASSISTANCE_RESCUE_PROBABILITY,
  initialRecall: 'clamp(item.initialRecall + profile.initialRecallOffset, 0, 1)',
  effectiveHalfLifeDays: 'item.halfLifeDays / profile.forgettingMultiplier; fixed throughout run',
  forgetting: 'storedRecall * 2^(-elapsedDays / effectiveHalfLifeDays)',
  independentResponse: 'p * (1 - slipProbability) + (1 - p) * guessProbability',
  directLearning: '(1 - p) * clamp(item.learningRate * profile.learningMultiplier * modalityFactor, 0, 1)',
  transfer: 'directGain * rate * edge.weight; cap per destination by recall headroom and remaining lifetime cap; proportionally share outgoing per-step cap; one hop only',
  randomPairing: 'environment draws keyed by seed/profile/step/channel, independent of policy stream',
  evidence: 'ordered unique synthetic encounters; no transfer of assessment evidence',
  probes: 'exact latent expectations; read-only, no sampled error or testing effect',
});

/** Frozen sensitivity hypotheses, authored before screening; not fitted effects. */
export const SIMULATOR_MODELS = Object.freeze({
  fixed: Object.freeze({ kind: 'fixed', description: 'Original fixed-half-life model, unchanged.' }),
  spacing: Object.freeze({ kind: 'spacing', minimumGapDays: .5, saturationGapDays: 2,
    maximumGrowth: .4, maximumHalfLifeMultiplier: 4,
    description: 'After a genuinely retrieved independent response without a slip, a prior practice gap >=0.5 day increases H by H*0.4*min(1,gapDays/2)*(1-0.5*p), capped at four initial half-lives. Assistance, exposure and guesses never increase stability. This is an authored hypothesis, not an empirical claim.' }),
  'low-benefit': Object.freeze({ kind: 'low-benefit', learningMultiplier: .2, repetitionPenalty: .5,
    description: 'Unfavorable hypothesis: original fixed forgetting, no transfer, and direct gain multiplied by 0.2/(1+0.5*priorPractices). Repetition has little additional benefit.' })
});

export function simulatorModel(value = 'fixed') {
  if (typeof value !== 'string' || !Object.hasOwn(SIMULATOR_MODELS, value)) throw new TypeError('Unknown simulatorModel.');
  return SIMULATOR_MODELS[value];
}

function bounded(value, label, minimum = 0, maximum = 1, exclusiveMinimum = false) {
  if (!Number.isFinite(value) || value < minimum || value > maximum
      || (exclusiveMinimum && value === minimum)) {
    throw new TypeError(`${label} must be finite ${exclusiveMinimum ? ">" : ">="} ${minimum} and <= ${maximum}.`);
  }
  return value;
}

function timestamp(value, label) {
  return bounded(value, label, 0, Number.MAX_SAFE_INTEGER);
}

/**
 * An authored synthetic learner, independent of scheduling scores and evidence
 * heuristics. Latent recall decays exponentially with an item/profile half-life.
 * Practice closes a fraction of the remaining recall gap; fixed modality factors
 * distinguish presentation, hints, retrieval and feedback. Guessing/slips change
 * the observed response, never the latent retrieval probability.
 *
 * Explicit one-hop transfer uses only newly learned recall, with a per-interaction
 * outgoing budget and lifetime per-target cap. It never creates assessment credit.
 * Future knowledge/snapshot probes do not decay or otherwise mutate stored state.
 */
export function createEnvironment({ fixture, profile, seed, now, transfer = {}, model = 'fixed' }) {
  const hypothesis = simulatorModel(model);
  timestamp(now, "now");
  keyedRandom(seed, "validate-seed");
  if (fixture?.schemaVersion !== 1 || !Array.isArray(fixture.items) || !fixture.items.length) {
    throw new TypeError("Environment requires a nonempty schemaVersion 1 fixture.");
  }
  const chosen = typeof profile === "string"
    ? fixture.profiles?.find(candidate => candidate.id === profile) : profile;
  if (!chosen || typeof chosen.id !== "string" || !chosen.id) {
    throw new TypeError("Environment requires an identified learner profile.");
  }
  const learner = {
    id: chosen.id,
    initialRecallOffset: bounded(chosen.initialRecallOffset, "initialRecallOffset", -1, 1),
    learningMultiplier: bounded(chosen.learningMultiplier, "learningMultiplier", 0, 10),
    forgettingMultiplier: bounded(chosen.forgettingMultiplier, "forgettingMultiplier", 0, 100, true),
    slipProbability: bounded(chosen.slipProbability, "slipProbability"),
    assistanceProbability: bounded(chosen.assistanceProbability, "assistanceProbability"),
    exposureProbability: bounded(chosen.exposureProbability, "exposureProbability")
  };
  if (learner.assistanceProbability + learner.exposureProbability > 1) {
    throw new TypeError("Assistance and exposure probabilities must sum to at most 1.");
  }
  const transferSettings = {
    rate: bounded(transfer.rate ?? 0, "transfer.rate"),
    totalCap: bounded(transfer.totalCap ?? 0, "transfer.totalCap"),
    maxPerStep: bounded(transfer.maxPerStep ?? 0, "transfer.maxPerStep")
  };
  if (hypothesis.kind === 'low-benefit') Object.assign(transferSettings, { rate: 0, totalCap: 0, maxPerStep: 0 });
  const items = new Map();
  const states = new Map();
  for (const item of fixture.items) {
    if (typeof item?.id !== "string" || !item.id || items.has(item.id)) {
      throw new TypeError("Fixture item IDs must be unique nonempty strings.");
    }
    const parameters = item.simulation ?? {};
    const simulation = {
      initialRecall: bounded(parameters.initialRecall, `${item.id}.initialRecall`),
      learningRate: bounded(parameters.learningRate, `${item.id}.learningRate`),
      halfLifeDays: bounded(parameters.halfLifeDays, `${item.id}.halfLifeDays`, 0, 100000, true),
      guessProbability: bounded(parameters.guessProbability, `${item.id}.guessProbability`)
    };
    const halfLifeDays = bounded(simulation.halfLifeDays / learner.forgettingMultiplier,
      `${item.id}.effectiveHalfLifeDays`, 0, Number.MAX_VALUE, true);
    items.set(item.id, simulation);
    states.set(item.id, { storedRecall: clamp(simulation.initialRecall + learner.initialRecallOffset),
      lastUpdatedAt: now, halfLifeDays,
      cumulativeTransfer: 0, practices: 0,
      ...(hypothesis.kind === 'spacing' ? { initialHalfLifeDays: halfLifeDays, lastPracticeAt: null } : {}) });
  }
  const edges = new Map();
  const edgeIds = new Set();
  for (const edge of fixture.transferEdges ?? []) {
    if (!items.has(edge?.from) || !items.has(edge?.to) || edge.from === edge.to) {
      throw new TypeError("Transfer edges require distinct known from/to items.");
    }
    const key = JSON.stringify([edge.from, edge.to]);
    if (edgeIds.has(key)) throw new TypeError("Duplicate transfer edge.");
    edgeIds.add(key);
    const outgoing = edges.get(edge.from) ?? [];
    outgoing.push({ from: edge.from, to: edge.to, weight: bounded(edge.weight, "transfer edge weight") });
    edges.set(edge.from, outgoing);
  }
  let lastInteractionAt = now;
  let lastStep = -1;
  const checkTime = value => {
    timestamp(value, "probe/interaction time");
    if (value < lastInteractionAt) throw new RangeError("Environment time cannot precede its latest interaction.");
  };
  const recallAt = (state, at) => state.storedRecall
    * 2 ** (-(at - state.lastUpdatedAt) / DAY_MS / state.halfLifeDays);
  const probabilities = (id, at) => {
    const recallProbability = recallAt(states.get(id), at);
    const responseProbability = recallProbability * (1 - learner.slipProbability)
      + (1 - recallProbability) * items.get(id).guessProbability;
    return { recallProbability, responseProbability };
  };
  const knowledge = at => {
    checkTime(at);
    return Object.fromEntries([...items.keys()].map(id => [id, probabilities(id, at)]));
  };
  const snapshot = at => {
    checkTime(at);
    return Object.fromEntries([...states].map(([id, state]) => [id, { ...state, ...probabilities(id, at) }]));
  };
  const interact = (itemId, at, step) => {
    checkTime(at);
    if (!items.has(itemId)) throw new RangeError(`Unknown simulation item: ${itemId}`);
    if (!Number.isSafeInteger(step) || step < 0 || step <= lastStep) {
      throw new RangeError("Interaction step must be a strictly increasing nonnegative safe integer.");
    }
    const simulation = items.get(itemId);
    const state = states.get(itemId);
    const before = probabilities(itemId, at);
    // Deliberately omit item ID: paired policies share exogenous uniform draws
    // even when their actions diverge. Their selected item changes probabilities.
    const draw = channel => keyedRandom(seed, learner.id, step, channel);
    const modality = draw("modality");
    const evidence = modality < learner.exposureProbability ? "exposure"
      : modality < learner.exposureProbability + learner.assistanceProbability ? "assisted" : "independent";
    const retrieved = evidence === "exposure" ? null : draw("retrieval") < before.recallProbability;
    const slipped = retrieved === true && draw("slip") < learner.slipProbability;
    const guessed = retrieved === false && draw("guess") < simulation.guessProbability;
    const rawCorrect = (retrieved === true && !slipped) || guessed;
    const helped = evidence === "assisted" && !rawCorrect && draw("aid") < ASSISTANCE_RESCUE_PROBABILITY;
    const correct = evidence === "exposure" ? null : rawCorrect || helped;
    const learningFactor = evidence === "exposure" ? MODALITY_LEARNING.exposure
      : evidence === "assisted" ? MODALITY_LEARNING.assisted
        : retrieved ? MODALITY_LEARNING.retrieved : MODALITY_LEARNING.feedback;
    let directGain = (1 - before.recallProbability)
      * clamp(simulation.learningRate * learner.learningMultiplier * learningFactor);
    if (hypothesis.kind === 'low-benefit') directGain *= hypothesis.learningMultiplier / (1 + hypothesis.repetitionPenalty * state.practices);
    let stability;
    if (hypothesis.kind === 'spacing') {
      const gapDays = state.lastPracticeAt === null ? null : (at - state.lastPracticeAt) / DAY_MS;
      const beforeHalfLifeDays = state.halfLifeDays;
      const qualifies = evidence === 'independent' && retrieved === true && !slipped
        && gapDays !== null && gapDays >= hypothesis.minimumGapDays;
      if (qualifies) state.halfLifeDays = Math.min(state.initialHalfLifeDays * hypothesis.maximumHalfLifeMultiplier,
        state.halfLifeDays * (1 + hypothesis.maximumGrowth * Math.min(1, gapDays / hypothesis.saturationGapDays) * (1 - .5 * before.recallProbability)));
      state.lastPracticeAt = at;
      stability = { gapDays, qualifies, beforeHalfLifeDays, afterHalfLifeDays: state.halfLifeDays };
    }
    state.storedRecall = clamp(before.recallProbability + directGain);
    state.lastUpdatedAt = at;
    state.practices++;

    const proposals = (edges.get(itemId) ?? []).map(edge => {
      const target = states.get(edge.to);
      const remainingCap = Math.max(0, transferSettings.totalCap - target.cumulativeTransfer);
      return { edge, target, currentRecall: recallAt(target, at), proposed:
        Math.min(directGain * transferSettings.rate * edge.weight, remainingCap, 1 - recallAt(target, at)) };
    });
    const proposedTotal = proposals.reduce((sum, proposal) => sum + proposal.proposed, 0);
    const scale = proposedTotal > 0 ? Math.min(1, transferSettings.maxPerStep / proposedTotal) : 0;
    const transferred = [];
    for (const proposal of proposals) {
      const gain = proposal.proposed * scale;
      if (gain <= 0) continue;
      proposal.target.storedRecall = clamp(proposal.currentRecall + gain);
      proposal.target.lastUpdatedAt = at;
      proposal.target.cumulativeTransfer += gain;
      transferred.push({ from: itemId, to: proposal.edge.to, gain });
    }
    lastInteractionAt = at;
    lastStep = step;
    return { itemId, now: at, step, evidence, correct, retrieved, slipped, guessed, helped,
      ...before, directGain, afterRecallProbability: state.storedRecall, transfer: transferred,
      ...(stability ? { stability } : {}) };
  };
  return Object.freeze({ knowledge, snapshot, interact });
}
