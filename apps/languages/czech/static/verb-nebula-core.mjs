export const VERB_NEBULA_PAIR_COUNTS = Object.freeze([2, 4, 6, 8]);

const verbKindPattern = /^V(?:\s|$)/u;
const deliberateSlashSeparator = /\s+\/\s+/u;
const defaultVerbDifficulty = 3;

function normalizedLabel(value) {
  return String(value || "").trim().normalize("NFC");
}

function labelKey(value) {
  return normalizedLabel(value).toLocaleLowerCase("en");
}

function firstLearnerLabel(value) {
  return normalizedLabel(value).split(deliberateSlashSeparator)[0].trim();
}

function normalizeVerbDifficulty(value, fallback = defaultVerbDifficulty) {
  const level = Number(value);
  return Number.isInteger(level) && level >= 1 && level <= 3 ? level : fallback;
}

function hasVerbDifficultyMetadata(value) {
  const level = Number(value);
  return Number.isInteger(level) && level >= 1 && level <= 3;
}

function projectCoreVerbPair(row, sourceIndex) {
  if (!verbKindPattern.test(String(row?.kind || ""))) return null;
  const cz = firstLearnerLabel(row.cs);
  const eng = firstLearnerLabel(row.en);
  if (!labelKey(cz) || !labelKey(eng)) return null;

  return {
    id: `core-verb-${sourceIndex}`,
    cz,
    eng,
    difficulty: normalizeVerbDifficulty(row.difficulty),
    difficultyIsAuthored: hasVerbDifficultyMetadata(row.difficulty),
    sourceIndex
  };
}

function stableVerbLookupError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function bytesToHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function extractCoreVerbPairs(dictionary) {
  if (!Array.isArray(dictionary)) return [];

  const seenCzech = new Set();
  const seenEnglish = new Set();
  const pairs = [];

  dictionary.forEach((row, sourceIndex) => {
    const pair = projectCoreVerbPair(row, sourceIndex);
    if (!pair) return;
    const czKey = labelKey(pair.cz);
    const engKey = labelKey(pair.eng);
    if (!czKey || !engKey || seenCzech.has(czKey) || seenEnglish.has(engKey)) return;

    seenCzech.add(czKey);
    seenEnglish.add(engKey);
    pairs.push(Object.freeze(pair));
  });

  return pairs;
}

/**
 * Resolve a curriculum sidecar identity by its reviewed learner labels.
 *
 * Positional `core-verb-*` IDs are deliberately not used as identity here:
 * they may change when unrelated dictionary rows move. The optional
 * `legacyLocator` on a reference is checked only by
 * `validatePinnedVerbPairLocator`, after the caller has verified the pinned
 * dictionary digest.
 */
export function resolveStableVerbPair(dictionary, reference) {
  if (!Array.isArray(dictionary)) {
    throw stableVerbLookupError(
      "VERB_STABLE_INVALID_CATALOG",
      "Stable verb lookup requires an ordered dictionary array."
    );
  }

  const stableId = normalizedLabel(reference?.id || reference?.contentId);
  const expectedCzech = normalizedLabel(reference?.cz);
  const expectedEnglish = normalizedLabel(reference?.eng);
  if (!stableId || !expectedCzech || !expectedEnglish) {
    throw stableVerbLookupError(
      "VERB_STABLE_INVALID_REFERENCE",
      "Stable verb lookup requires an id plus exact Czech and English labels."
    );
  }

  const matchingRows = [];
  dictionary.forEach((row, sourceIndex) => {
    const pair = projectCoreVerbPair(row, sourceIndex);
    if (pair?.cz === expectedCzech && pair.eng === expectedEnglish) matchingRows.push(pair);
  });

  if (!matchingRows.length) {
    throw stableVerbLookupError(
      "VERB_STABLE_SOURCE_DRIFT",
      `${stableId} no longer resolves to ${expectedCzech} / ${expectedEnglish}.`
    );
  }
  if (matchingRows.length > 1) {
    throw stableVerbLookupError(
      "VERB_STABLE_AMBIGUOUS",
      `${stableId} matches ${matchingRows.length} dictionary rows.`
    );
  }

  const candidate = matchingRows[0];
  const playablePair = extractCoreVerbPairs(dictionary).find((pair) => (
    pair.sourceIndex === candidate.sourceIndex
  ));
  if (!playablePair) {
    throw stableVerbLookupError(
      "VERB_STABLE_SOURCE_DRIFT",
      `${stableId} is no longer a unique playable Verb Nebula pair.`
    );
  }

  if (
    Object.hasOwn(reference, "difficulty")
    && Number(reference.difficulty) !== playablePair.difficulty
  ) {
    throw stableVerbLookupError(
      "VERB_STABLE_SOURCE_DRIFT",
      `${stableId} difficulty no longer matches its reviewed snapshot.`
    );
  }
  if (
    Object.hasOwn(reference, "difficultyIsAuthored")
    && reference.difficultyIsAuthored !== playablePair.difficultyIsAuthored
  ) {
    throw stableVerbLookupError(
      "VERB_STABLE_SOURCE_DRIFT",
      `${stableId} difficulty authorship no longer matches its reviewed snapshot.`
    );
  }

  return Object.freeze({
    ...playablePair,
    curriculumContentId: stableId
  });
}

/**
 * Assert the legacy row locator after the dictionary digest has been checked.
 * This is a snapshot-integrity check, not a stable lookup mechanism.
 */
export function validatePinnedVerbPairLocator(dictionary, reference) {
  const pair = resolveStableVerbPair(dictionary, reference);
  const sourceIndex = reference?.legacyLocator?.sourceIndex;
  const pairId = normalizedLabel(reference?.legacyLocator?.pairId);
  if (!Number.isInteger(sourceIndex) || !pairId) {
    throw stableVerbLookupError(
      "VERB_STABLE_INVALID_LOCATOR",
      `${pair.curriculumContentId} requires a pinned legacy pairId and sourceIndex.`
    );
  }
  if (pair.sourceIndex !== sourceIndex || pair.id !== pairId) {
    throw stableVerbLookupError(
      "VERB_STABLE_LOCATOR_DRIFT",
      `${pair.curriculumContentId} moved from ${pairId} at row ${sourceIndex}.`
    );
  }
  return pair;
}

/**
 * Verify the exact deployed dictionary bytes before trusting its legacy row
 * locator. Keep authoring/migration work on `resolveStableVerbPair`, which is
 * intentionally reorder-tolerant; this runtime boundary is intentionally not.
 */
async function verifiedPinnedVerbDictionary(
  dictionaryBytes,
  catalogDigest
) {
  const sourceBytes = dictionaryBytes instanceof Uint8Array
    ? new Uint8Array(dictionaryBytes)
    : dictionaryBytes instanceof ArrayBuffer
      ? new Uint8Array(dictionaryBytes.slice(0))
      : null;
  if (!sourceBytes) {
    throw stableVerbLookupError(
      "VERB_STABLE_INVALID_CATALOG_BYTES",
      "Pinned verb lookup requires the raw dictionary bytes."
    );
  }
  if (!/^sha256:[0-9a-f]{64}$/u.test(String(catalogDigest || ""))) {
    throw stableVerbLookupError(
      "VERB_STABLE_INVALID_CATALOG_DIGEST",
      "Pinned verb lookup requires an explicit lowercase sha256 catalog digest."
    );
  }

  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.subtle || typeof TextDecoder !== "function") {
    throw stableVerbLookupError(
      "VERB_STABLE_WEB_CRYPTO_UNAVAILABLE",
      "Pinned verb lookup requires Web Crypto and UTF-8 TextDecoder support."
    );
  }

  const digestBytes = await cryptoApi.subtle.digest(
    "SHA-256",
    sourceBytes
  );
  const actualDigest = `sha256:${bytesToHex(new Uint8Array(digestBytes))}`;
  if (actualDigest !== catalogDigest) {
    throw stableVerbLookupError(
      "VERB_STABLE_CATALOG_DIGEST_MISMATCH",
      "The deployed Verb Nebula dictionary does not match its pinned catalog digest."
    );
  }

  let dictionaryJsonText;
  try {
    dictionaryJsonText = new TextDecoder("utf-8", { fatal: true }).decode(sourceBytes);
  } catch (cause) {
    const error = stableVerbLookupError(
      "VERB_STABLE_INVALID_CATALOG_ENCODING",
      "The digest-verified Verb Nebula dictionary is not valid UTF-8."
    );
    error.cause = cause;
    throw error;
  }
  let dictionary;
  try {
    dictionary = JSON.parse(dictionaryJsonText);
  } catch (cause) {
    const error = stableVerbLookupError(
      "VERB_STABLE_INVALID_CATALOG_JSON",
      "The digest-verified Verb Nebula dictionary is not valid JSON."
    );
    error.cause = cause;
    throw error;
  }
  return dictionary;
}

export async function resolvePinnedStableVerbPairs(
  dictionaryBytes,
  catalogDigest,
  references
) {
  const reviewedReferences = Array.from(references || []);
  if (!reviewedReferences.length) {
    throw stableVerbLookupError(
      "VERB_STABLE_INVALID_REFERENCE",
      "Pinned verb lookup requires at least one reviewed reference."
    );
  }
  const dictionary = await verifiedPinnedVerbDictionary(dictionaryBytes, catalogDigest);
  const resolved = reviewedReferences.map((reference) => (
    validatePinnedVerbPairLocator(dictionary, reference)
  ));
  for (const field of ["curriculumContentId", "id", "sourceIndex", "cz", "eng"]) {
    const values = resolved.map((pair) => pair[field]);
    if (new Set(values).size !== values.length) {
      throw stableVerbLookupError(
        "VERB_STABLE_DUPLICATE_REFERENCE",
        `Pinned Guided verb references require unique ${field} values.`
      );
    }
  }
  return Object.freeze(resolved);
}

export async function resolvePinnedStableVerbPair(
  dictionaryBytes,
  catalogDigest,
  reference
) {
  const [pair] = await resolvePinnedStableVerbPairs(
    dictionaryBytes,
    catalogDigest,
    [reference]
  );
  return pair;
}

function guidedSeedNumber(value) {
  const source = normalizedLabel(value);
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function guidedRandom(seed) {
  let value = guidedSeedNumber(seed);
  return () => {
    value += 0x6d2b79f5;
    let mixed = value;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function guidedShuffle(values, seed) {
  const shuffled = Array.from(values || []);
  const random = guidedRandom(seed);
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[target]] = [shuffled[target], shuffled[index]];
  }
  return shuffled;
}

function guidedDerangement(round, seed) {
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const candidate = guidedShuffle(round, `${seed}|${attempt}`);
    if (candidate.every((pair, index) => pair.id !== round[index]?.id)) return candidate;
  }
  return round.map((_, index) => round[(index + 1) % round.length]);
}

export function buildGuidedVerbRound(pairs, targetPair, {
  pairCount = 4,
  contrastPairs = [],
  taskFingerprint
} = {}) {
  const catalog = Array.from(pairs || []);
  const count = Number(pairCount);
  if (!Number.isInteger(count) || count < 2) {
    throw stableVerbLookupError(
      "VERB_GUIDED_PAIR_COUNT_INVALID",
      "A Guided Verb Nebula round requires at least two pairs."
    );
  }
  const target = catalog.find((pair) => (
    pair?.id === targetPair?.id
    && pair?.sourceIndex === targetPair?.sourceIndex
    && pair?.cz === targetPair?.cz
    && pair?.eng === targetPair?.eng
  ));
  if (!target) {
    throw stableVerbLookupError(
      "VERB_GUIDED_TARGET_MISSING",
      "The verified Guided verb target is absent from the playable catalog."
    );
  }
  const requestedContrasts = Array.from(contrastPairs || []);
  if (requestedContrasts.length !== count - 1) {
    throw stableVerbLookupError(
      "VERB_GUIDED_CONTRASTS_MISSING",
      `The Guided verb target requires ${count - 1} explicitly reviewed contrasts.`
    );
  }
  const contrasts = requestedContrasts.map((reference) => catalog.find((pair) => (
    pair?.id === reference?.id
    && pair?.sourceIndex === reference?.sourceIndex
    && pair?.cz === reference?.cz
    && pair?.eng === reference?.eng
    && pair?.difficulty === reference?.difficulty
  )));
  if (contrasts.some((pair) => !pair)) {
    throw stableVerbLookupError(
      "VERB_GUIDED_CONTRAST_SOURCE_DRIFT",
      "A reviewed Guided contrast is absent from the playable catalog."
    );
  }
  const uniqueIds = new Set([target.id, ...contrasts.map((pair) => pair.id)]);
  if (uniqueIds.size !== count || contrasts.some((pair) => pair.difficulty !== target.difficulty)) {
    throw stableVerbLookupError(
      "VERB_GUIDED_CONTRASTS_INVALID",
      "Guided contrasts must be distinct reviewed pairs at the target difficulty."
    );
  }
  const seed = normalizedLabel(taskFingerprint);
  if (!seed) {
    throw stableVerbLookupError(
      "VERB_GUIDED_TASK_FINGERPRINT_REQUIRED",
      "Guided card positions require a stable task fingerprint."
    );
  }
  const selected = Object.freeze([target, ...contrasts]);
  const round = Object.freeze(guidedShuffle(selected, `${seed}|czech`));
  const englishRound = Object.freeze(guidedDerangement(round, `${seed}|english`));
  if (round.some((pair, index) => pair.id === englishRound[index]?.id)) {
    throw stableVerbLookupError(
      "VERB_GUIDED_DERANGEMENT_FAILED",
      "The Guided English column must not reveal any positional match."
    );
  }
  return Object.freeze({
    round,
    englishRound,
    queueIds: Object.freeze([]),
    targetId: target.id,
    taskFingerprint: seed
  });
}

export function filterVerbPairsForDifficulty(pairs, difficulty) {
  const catalog = Array.from(pairs || []);
  const maximumDifficulty = normalizeVerbDifficulty(difficulty, 1);

  // During an app upgrade, an older service-worker cache can briefly pair the
  // new game code with the pre-tier dictionary. Keep that legacy catalog
  // playable until the authored metadata arrives on the next refresh. A
  // partially classified catalog remains conservative: unclassified verbs
  // stay at Navigator level.
  const catalogHasAuthoredDifficulty = catalog.some((pair) => (
    pair?.difficultyIsAuthored === true
      || (pair?.difficultyIsAuthored == null && hasVerbDifficultyMetadata(pair?.difficulty))
  ));
  if (!catalogHasAuthoredDifficulty) return catalog;

  return catalog.filter((pair) => (
    normalizeVerbDifficulty(pair?.difficulty) <= maximumDifficulty
  ));
}

export function verbHintSearchText(pair) {
  return normalizedLabel(pair?.eng);
}

export function assignUniqueVerbHintCandidates(candidateGroups) {
  const groups = Array.from(candidateGroups || []);
  const assignments = new Array(groups.length).fill(null);
  const usedPaths = new Set();
  const candidates = [];

  groups.forEach((group, groupIndex) => {
    const seenPaths = new Set();
    Array.from(group || []).forEach((candidate, rank) => {
      const assetPath = normalizedLabel(candidate?.assetPath);
      if (!assetPath || seenPaths.has(assetPath)) return;
      seenPaths.add(assetPath);
      const rawScore = Number(candidate?.score);
      candidates.push({
        groupIndex,
        rank,
        score: Number.isFinite(rawScore) ? rawScore : 0,
        candidate: { ...candidate, assetPath }
      });
    });
  });

  // Resolve the whole round together. If two verbs want the same picture,
  // the verb with the stronger similarity keeps it and the other verb falls
  // through to its next-best unused candidate.
  candidates.sort((left, right) => (
    right.score - left.score
    || left.rank - right.rank
    || left.groupIndex - right.groupIndex
  ));
  candidates.forEach(({ groupIndex, candidate }) => {
    if (assignments[groupIndex] || usedPaths.has(candidate.assetPath)) return;
    assignments[groupIndex] = candidate;
    usedPaths.add(candidate.assetPath);
  });

  return assignments;
}

export function normalizeVerbPairCount(value, fallback = 4) {
  const count = Number(value);
  if (VERB_NEBULA_PAIR_COUNTS.includes(count)) return count;
  return VERB_NEBULA_PAIR_COUNTS.includes(Number(fallback)) ? Number(fallback) : 4;
}

export function shuffleVerbItems(values, random = Math.random) {
  const items = Array.from(values || []);
  for (let index = items.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [items[index], items[target]] = [items[target], items[index]];
  }
  return items;
}

function uniqueKnownIds(ids, knownIds) {
  const seen = new Set();
  return Array.from(ids || []).filter((id) => {
    if (!knownIds.has(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

export function restoreVerbQueue(pairs, savedIds, random = Math.random, knownIds = null) {
  const availableIds = new Set((pairs || []).map((pair) => pair.id));
  const restored = uniqueKnownIds(savedIds, availableIds);
  const restoredSet = new Set(restored);
  const previousCatalog = Array.isArray(knownIds) ? new Set(knownIds) : null;
  const missing = shuffleVerbItems(
    (pairs || []).map((pair) => pair.id).filter((id) => (
      !restoredSet.has(id) && (!previousCatalog || !previousCatalog.has(id))
    )),
    random
  );
  return [...restored, ...missing];
}

export function dealVerbRound(pairs, queueIds, requestedCount, random = Math.random) {
  const pairCount = normalizeVerbPairCount(requestedCount);
  const pairById = new Map((pairs || []).map((pair) => [pair.id, pair]));
  let queue = uniqueKnownIds(queueIds, new Set(pairById.keys()));
  const round = [];
  const roundIds = new Set();
  let cyclesStarted = 0;

  while (round.length < pairCount && pairById.size) {
    if (!queue.length) {
      cyclesStarted += 1;
      queue = shuffleVerbItems(
        [...pairById.keys()].filter((id) => !roundIds.has(id)),
        random
      );
      if (!queue.length) break;
    }

    const id = queue.shift();
    if (!id || roundIds.has(id) || !pairById.has(id)) continue;
    roundIds.add(id);
    round.push(pairById.get(id));
  }

  return {
    pairCount,
    round,
    queueIds: queue,
    cyclesStarted
  };
}

export function shuffleVerbMeanings(round, random = Math.random) {
  const items = Array.from(round || []);
  if (items.length < 2) return items;

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const shuffled = shuffleVerbItems(items, random);
    if (shuffled.every((item, index) => item.id !== items[index]?.id)) return shuffled;
  }

  return [...items.slice(1), items[0]];
}

export function verbPairMatches(czechId, englishId) {
  return Boolean(czechId && englishId && czechId === englishId);
}

export function isVerbRoundComplete(round, matchedIds) {
  const pairs = Array.from(round || []);
  if (!pairs.length) return false;
  const matched = matchedIds instanceof Set ? matchedIds : new Set(matchedIds || []);
  return pairs.every((pair) => matched.has(pair.id));
}
