import * as sampling from '../../apps/language-runtime/static/source/games/adaptive-sampling.mjs';
import { recentPracticeIds } from '../../apps/language-runtime/static/source/games/recent-practice.mjs';

export const policyMetadata = Object.freeze({
  label: 'Adaptive practice v1',
  implementation: 'apps/language-runtime/static/source/games/adaptive-sampling.mjs#createAdaptiveDecision',
  // The runner can hash these exact transitive policy inputs without importing
  // production persistence or requiring another evaluator to execute first.
  sourceFiles: [
    'apps/language-runtime/static/source/games/adaptive-sampling.mjs',
    'apps/language-runtime/static/source/games/content-progression.mjs',
    'apps/language-runtime/static/source/games/recent-practice.mjs',
    'apps/language-runtime/static/source/learner-state.mjs'
  ]
});

export function createPolicy() {
  let decision = null;
  return {
    select({ identity, candidates, learner, goal, now, random, difficulty, minimumPool }) {
      const recentIds = recentPracticeIds(learner.evidenceByItem);
      decision = sampling.createAdaptiveDecision(candidates, {
        identity, history: learner.evidenceByItem, learner, goal,
        recentIds,
        now, random, difficulty, minimumPool, limit: 1
      });
      decision.trace.evaluatorInputs = { recentIds,
        semanticFeatures: 'unavailable', selectionUnit: 'one item' };
      return decision.items[0]?.id;
    },
    lastDecision: () => decision?.trace ?? null
  };
}

/** Manual Evaluator B only; never changes production defaults or score weights. */
export function createExperimentPolicy({ id, label = id, controls = {} }) {
  return { id, label, implementation: 'adaptive-sampling.mjs#createSamplingExperiment',
    sourceFiles: policyMetadata.sourceFiles,
    create() {
      if (typeof sampling.createSamplingExperiment !== 'function') throw new Error('Experimental runtime is not ready.');
      let decision = null;
      return {
        select({ identity, candidates, learner, goal, now, random, difficulty, minimumPool }) {
          const recentIds = recentPracticeIds(learner.evidenceByItem);
          decision = sampling.createSamplingExperiment(candidates, {
            identity, history: learner.evidenceByItem, learner, goal,
            recentIds,
            now, random, difficulty, minimumPool, limit: 1
          }, controls);
          decision.trace.evaluatorInputs = { recentIds,
            semanticFeatures: 'unavailable', selectionUnit: 'one item' };
          return decision.items[0]?.id;
        },
        lastDecision: () => decision?.trace ?? null
      };
    }
  };
}
