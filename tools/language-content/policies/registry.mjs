import { englishAmericanContentPolicy } from "./english-american.mjs";
import { arabicStandardContentPolicy } from "./arabic-standard.mjs";
import { latinScientificContentPolicy } from "./latin-scientific.mjs";
import { mandarinSimplifiedContentPolicy } from "./mandarin-simplified.mjs";
import { norwegianBokmalContentPolicy } from "./norwegian-bokmal.mjs";
import { spanishSpainContentPolicy } from "./spanish-spain.mjs";

const POLICIES = new Map([
  [latinScientificContentPolicy.id, latinScientificContentPolicy],
  [arabicStandardContentPolicy.id, arabicStandardContentPolicy],
  [englishAmericanContentPolicy.id, englishAmericanContentPolicy],

  [mandarinSimplifiedContentPolicy.id, mandarinSimplifiedContentPolicy],
  [norwegianBokmalContentPolicy.id, norwegianBokmalContentPolicy],
  [spanishSpainContentPolicy.id, spanishSpainContentPolicy]
]);

export function resolveTargetContentPolicy(policyId) {
  return POLICIES.get(String(policyId || "")) ?? null;
}

export function registeredTargetContentPolicyIds() {
  return Object.freeze([...POLICIES.keys()].sort());
}
