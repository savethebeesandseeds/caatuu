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

export function extractCoreVerbPairs(dictionary) {
  if (!Array.isArray(dictionary)) return [];

  const seenCzech = new Set();
  const seenEnglish = new Set();
  const pairs = [];

  dictionary.forEach((row, sourceIndex) => {
    if (!verbKindPattern.test(String(row?.kind || ""))) return;
    const cz = firstLearnerLabel(row.cs);
    const eng = firstLearnerLabel(row.en);
    const czKey = labelKey(cz);
    const engKey = labelKey(eng);
    if (!czKey || !engKey || seenCzech.has(czKey) || seenEnglish.has(engKey)) return;

    seenCzech.add(czKey);
    seenEnglish.add(engKey);
    pairs.push(Object.freeze({
      id: `core-verb-${sourceIndex}`,
      cz,
      eng,
      difficulty: normalizeVerbDifficulty(row.difficulty),
      difficultyIsAuthored: hasVerbDifficultyMetadata(row.difficulty),
      sourceIndex
    }));
  });

  return pairs;
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
