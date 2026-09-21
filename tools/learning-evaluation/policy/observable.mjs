import { createLearningHarness } from '../stats/harness.mjs';
import { learnerBankState } from '../../../apps/language-runtime/static/source/learner-state.mjs';

/** Uses a shared harness utility, never executes Evaluator A or its scenarios. */
export async function createObservableEvidence({ identity, itemIds, now, runId }) {
  const harness = await createLearningHarness({ courseId: identity.courseId, learnerId: runId, now });
  let events = 0;
  const history = () => harness.history(identity.gameId, identity.bankId);
  return {
    learner(at) {
      harness.advanceTo(at);
      const evidenceByItem = history();
      const states = learnerBankState({ ...identity, itemIds, history: evidenceByItem, now: at });
      return { mode: 'observable-real', evidenceByItem,
        itemStatesById: Object.fromEntries(states.map(state => [state.identity.itemId, state])) };
    },
    async record(itemId, outcome, at, step) {
      // Deliberately whitelist observed fields. No latent retrieval, probabilities,
      // guessed/helped labels, dynamics or future outcomes reach the real reducer.
      await harness.record({ ...identity, itemId }, {
        encounterId: `${runId}-step-${step}`, correct: outcome.correct, evidence: outcome.evidence
      }, at);
      events++;
    },
    history,
    provenance: () => ({ mode: 'observable-real', recordedEvents: events, saveStatus: harness.saveStatus(),
      reducer: 'apps/language-runtime/static/source/learning-profile.js#recordExposure',
      adapter: 'apps/language-runtime/static/source/learner-state.mjs#learnerBankState',
      observedFields: ['itemId', 'encounterId', 'correct', 'evidence', 'generation', 'bankId'],
      unavailableKnowledge: 'No knowledgeByItem or synthetic probabilities are supplied.' })
  };
}
