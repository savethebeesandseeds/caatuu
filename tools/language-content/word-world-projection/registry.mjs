import { englishAmericanWordWorldProjectionPolicy } from "./english-american.mjs";
import { mandarinSimplifiedWordWorldProjectionPolicy } from "./mandarin-simplified.mjs";
import { norwegianBokmalWordWorldProjectionPolicy } from "./norwegian-bokmal.mjs";
import { spanishSpainWordWorldProjectionPolicy } from "./spanish-spain.mjs";

const POLICIES = new Map([
  [englishAmericanWordWorldProjectionPolicy.contentPolicyId, englishAmericanWordWorldProjectionPolicy],
  [norwegianBokmalWordWorldProjectionPolicy.contentPolicyId, norwegianBokmalWordWorldProjectionPolicy],

  [
    mandarinSimplifiedWordWorldProjectionPolicy.contentPolicyId,
    mandarinSimplifiedWordWorldProjectionPolicy
  ],
  [
    spanishSpainWordWorldProjectionPolicy.contentPolicyId,
    spanishSpainWordWorldProjectionPolicy
  ]
]);

export function resolveWordWorldProjectionPolicy(contentPolicyId) {
  return POLICIES.get(String(contentPolicyId ?? "")) ?? null;
}

export function registeredWordWorldProjectionPolicyIds() {
  return Object.freeze([...POLICIES.values()].map(({ id }) => id).sort());
}
