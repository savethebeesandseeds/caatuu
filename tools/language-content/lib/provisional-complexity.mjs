// One provisional complexity until a person sets it on a translated record.
const BY_DIFFICULTY = Object.freeze([15, 30, 50, 70]);

export function provisionalComplexity(difficulty) {
  return BY_DIFFICULTY[difficulty] ?? 30;
}
