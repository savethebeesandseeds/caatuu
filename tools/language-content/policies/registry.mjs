import { mandarinSimplifiedContentPolicy } from "./mandarin-simplified.mjs";

const POLICIES = new Map([
  [mandarinSimplifiedContentPolicy.id, mandarinSimplifiedContentPolicy]
]);

export function resolveTargetContentPolicy(policyId) {
  return POLICIES.get(String(policyId || "")) ?? null;
}

export function registeredTargetContentPolicyIds() {
  return Object.freeze([...POLICIES.keys()].sort());
}
