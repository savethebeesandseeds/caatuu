import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { selectContentItems } from '../../../apps/language-runtime/static/source/games/content-progression.mjs';

/** Each factory is invoked separately for every profile/goal/seed run. */
export function baselinePolicies() {
  return [
    { id: 'uniform', label: 'Uniform random', create: () => ({
      select: ({ candidates, random }) => candidates[Math.floor(random() * candidates.length)].id,
    }) },
    { id: 'existing-scheduler', label: 'Existing selectContentItems', create: () => ({
      select: ({ candidates, learner, difficulty, minimumPool, now, random }) =>
        selectContentItems(candidates, { history: learner.evidenceByItem,
          difficulty, minimumPool, now, random, limit: 1 })[0]?.id,
    }) },
    { id: 'usefulness', label: 'Usefulness weighted', create: () => ({
      select: ({ candidates, random }) => {
        let draw = random() * candidates.reduce((sum, item) => sum + item.usefulness, 0);
        for (const item of candidates) {
          draw -= item.usefulness;
          if (draw < 0) return item.id;
        }
        return candidates.at(-1).id;
      },
    }) },
  ];
}

/** Integration-owned module must delegate to the real production implementation. */
export async function loadProductionPolicy(adapterPath) {
  const module = await import(pathToFileURL(resolve(adapterPath)).href);
  if (typeof module.createPolicy !== 'function'
      || typeof module.policyMetadata?.implementation !== 'string'
      || !module.policyMetadata.implementation.trim()) {
    throw new TypeError('Production adapter requires createPolicy and policyMetadata.implementation.');
  }
  return { id: 'production', label: module.policyMetadata.label || 'Production policy',
    implementation: module.policyMetadata.implementation,
    sourceFiles: module.policyMetadata.sourceFiles || [], create: module.createPolicy };
}
