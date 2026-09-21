import { selectContentItems as existingSelector } from './content-progression.mjs';
import { createAdaptiveDecision } from './adaptive-sampling.mjs';
import { recentPracticeIds } from './recent-practice.mjs';
import { createLearningSemantics } from '../learning-semantics.mjs';
import { normalizeSharedEnglishText } from '../english-image-search.mjs';

export { normalizeContentProgression, newContentEncounterId } from './content-progression.mjs';

const SERVICES = Symbol.for('caatuu.adaptivePractice.v1');
function serviceOwner() {
  try {
    if (globalThis.window?.parent?.location?.origin === globalThis.location?.origin) return window.parent;
  } catch { /* Cross-origin frames cannot share diagnostics or model state. */ }
  return globalThis;
}

function services() {
  const owner = serviceOwner();
  if (!owner[SERVICES]) {
    const state = { banks: new Map(), owner, latest: null };
    owner[SERVICES] = state;
    // Local, on-demand developer inspection; no event stream, storage, or telemetry.
    owner.CaatuuSamplingDiagnostics = Object.freeze({ latest: () => state.latest });
  }
  return owner[SERVICES];
}

function bankSemantics(state, identity) {
  const key = JSON.stringify([identity.courseId, identity.gameId, identity.bankId]);
  const value = state.banks.get(key) || { provider: createLearningSemantics({ owner: state.owner }), warmOffset: 0 };
  state.banks.delete(key);
  state.banks.set(key, value);
  while (state.banks.size > 24) state.banks.delete(state.banks.keys().next().value);
  return value;
}

/** Explicit authored English fields only. Never use a generic learner-base prompt. */
export function practiceEnglishText(item, identity = {}) {
  for (const field of ['englishAuditText', 'embeddingText', 'englishText', 'english']) {
    if (typeof item?.[field] === 'string' && item[field].trim()) return item[field];
  }
  if (identity.gameId === 'case-cosmos') return item?.practiceQuestions?.[0]?.english || '';
  if (identity.courseId === 'cz' && identity.gameId === 'conjugation-comet') return item?.meaning || '';
  if (identity.courseId === 'cz' && ['word-world', 'verb-nebula'].includes(identity.gameId)) return item?.en || '';
  if (identity.courseId === 'zh' && identity.gameId === 'naturalization-nucleus') return item?.translation || '';
  return '';
}

/**
 * Explicit runtime adapter. Callers without a policy context retain the exact
 * established selector, including Node tools and older cached game hosts.
 * A replacement select callback has the same pure decision contract as the
 * adaptive policy. Models run only after selection, on a bounded warmup batch.
 */
export function selectContentItems(items, { policy = null, ...options } = {}) {
  if (!policy?.identity || policy.id === 'existing') return existingSelector(items, options);
  const state = services();
  const getId = options.getId || (item => item.id);
  const getGroupKey = options.getGroupKey || getId;
  const history = options.history || {};
  const recentIds = recentPracticeIds(history);
  const candidates = [];
  for (const item of items) {
    try {
      candidates.push({ id: String(getId(item)), englishText: normalizeSharedEnglishText(practiceEnglishText(item, policy.identity)) });
    } catch { /* Missing or unusable English leaves semantic features unavailable. */ }
  }
  const goalText = policy.goal?.kind === 'topic' ? policy.goal.embeddingText : null;
  const semanticBank = policy.semanticsEnabled === true ? bankSemantics(state, policy.identity) : null;
  const semantics = semanticBank?.provider;
  const semantic = semantics?.features({ candidates, recentIds, goalText })
    || { byItem: {}, status: 'disabled' };
  const decide = typeof policy.select === 'function' ? policy.select : createAdaptiveDecision;
  const decision = decide(items, { ...options, ...policy, recentIds,
    semantic: policy.semantic || semantic });
  const eligibleIds = new Set(items.filter(item => (item.difficulty ?? 1) <= (options.difficulty ?? 3)).map(getId));
  if (!decision || !Array.isArray(decision.items)
      || decision.items.some(item => !items.includes(item) || !eligibleIds.has(getId(item)))
      || new Set(decision.items.map(getId)).size !== decision.items.length
      || decision.items.some(item => !String(getGroupKey(item) ?? ''))
      || new Set(decision.items.map(item => String(getGroupKey(item)))).size !== decision.items.length) {
    throw new TypeError('Practice policy returned an invalid or ineligible selection.');
  }
  state.latest = { ...decision.trace, semanticStatus: semantic.status };
  policy.onDecision?.(state.latest);
  options.onDecision?.(state.latest);
  const selectedIds = new Set(decision.items.map(item => String(getId(item))));
  const offset = semanticBank?.warmOffset || 0;
  const rotated = [...candidates.slice(offset), ...candidates.slice(0, offset)];
  const warmCandidates = [...new Map([...candidates.filter(item => selectedIds.has(item.id)),
    ...candidates.filter(item => recentIds.includes(item.id)), ...rotated].map(item => [item.id, item])).values()];
  if (semanticBank) semanticBank.warmOffset = (offset + 16) % Math.max(1, candidates.length);
  // Semantics is optional. Missing model assets never block ordinary practice.
  if (semantics) void semantics.warm({ candidates: warmCandidates, recentIds, goalText }).catch(() => {});
  return decision.items;
}
