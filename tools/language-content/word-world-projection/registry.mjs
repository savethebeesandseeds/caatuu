import { mandarinSimplifiedWordWorldProjectionPolicy } from "./mandarin-simplified.mjs";
import { spanishSpainWordWorldProjectionPolicy } from "./spanish-spain.mjs";

const POLICIES = new Map([
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
