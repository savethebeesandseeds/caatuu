/** Small reproducible, noncryptographic RNGs. No global random state is touched. */
function hashSeed(seed, keys = []) {
  if (!(typeof seed === "string" || Number.isSafeInteger(seed))) {
    throw new TypeError("Random seed must be a string or safe integer.");
  }
  const text = JSON.stringify([seed, ...keys]);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  return (hash ^ (hash >>> 16)) >>> 0;
}

export function seededRandom(seed) {
  let state = hashSeed(seed);
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stateless draws prevent one policy's extra RNG calls affecting the learner. */
export function keyedRandom(seed, ...keys) {
  return hashSeed(seed, keys) / 4294967296;
}
