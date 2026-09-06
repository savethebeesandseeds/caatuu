import { englishAmericanContentPolicy } from "./english-american.mjs";
import { mandarinSimplifiedContentPolicy } from "./mandarin-simplified.mjs";
import { spanishSpainContentPolicy } from "./spanish-spain.mjs";

const POLICIES = new Map([
  [englishAmericanContentPolicy.id, englishAmericanContentPolicy],

  [mandarinSimplifiedContentPolicy.id, mandarinSimplifiedContentPolicy],
  [spanishSpainContentPolicy.id, spanishSpainContentPolicy]
]);

export function resolveTargetContentPolicy(policyId) {
  return POLICIES.get(String(policyId || "")) ?? null;
}

export function registeredTargetContentPolicyIds() {
  return Object.freeze([...POLICIES.keys()].sort());
}
