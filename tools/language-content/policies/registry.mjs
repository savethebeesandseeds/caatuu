import { mandarinSimplifiedContentPolicy } from "./mandarin-simplified.mjs";
import { spanishSpainContentPolicy } from "./spanish-spain.mjs";

const POLICIES = new Map([
  [mandarinSimplifiedContentPolicy.id, mandarinSimplifiedContentPolicy],
  [spanishSpainContentPolicy.id, spanishSpainContentPolicy]
]);

export function resolveTargetContentPolicy(policyId) {
  return POLICIES.get(String(policyId || "")) ?? null;
}

export function registeredTargetContentPolicyIds() {
  return Object.freeze([...POLICIES.keys()].sort());
}
