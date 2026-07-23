export const semanticLearningSchema = Object.freeze({
  name: "caatuu-semantic-learning",
  attemptVersion: 1,
  evidenceReducerVersion: 4,
  projectionPolicyVersion: 1,
  historyLedgerVersion: 2,
  historyPolicyVersion: 3,
  temporalSummaryVersion: 1
});

export const boundedSemanticHistoryPolicy = Object.freeze({
  version: semanticLearningSchema.historyPolicyVersion,
  rawAttemptLimit: 512,
  rawAttemptTarget: 384,
  compactedReceiptLimit: 2048,
  // Keep one vector for every bounded capability plus room for disposable axes.
  // Otherwise a mature profile would evict and recompute its own evidence on
  // every projection.
  embeddingLimit: 4608,
  embeddingTarget: 4352,
  maximumStatementKeys: 4096,
  maximumEvidenceReferences: 32,
  maximumSignalsPerAttempt: 16,
  maximumAttemptCharacters: 16384,
  maximumEmbeddingTextCharacters: 4000,
  temporalBucketSlots: 16
});

export const defaultSemanticProjectionPolicy = Object.freeze({
  version: semanticLearningSchema.projectionPolicyVersion,
  similarityFloor: 0.3,
  kernelExponent: 2,
  priorAlpha: 1,
  priorBeta: 1,
  coverageScale: 2,
  assessmentScale: 2,
  maxNeighbors: 5
});

const maximumSignalWeight = 100;
const maximumProjectionAxes = 12;
const maximumTextLength = 4000;
const millisecondsPerDay = 86_400_000;
const temporalScaleDefinitions = Object.freeze([
  Object.freeze({
    name: "daily",
    period: (timestampMs) => Math.floor(timestampMs / millisecondsPerDay),
    startedAt: (period) => period * millisecondsPerDay
  }),
  Object.freeze({
    name: "weekly",
    period: (timestampMs) => Math.floor(timestampMs / (millisecondsPerDay * 7)),
    startedAt: (period) => period * millisecondsPerDay * 7
  }),
  Object.freeze({
    name: "monthly",
    period: (timestampMs) => {
      const date = new Date(timestampMs);
      return date.getUTCFullYear() * 12 + date.getUTCMonth();
    },
    startedAt: (period) => Date.UTC(Math.floor(period / 12), period % 12, 1)
  })
]);

export function semanticTextHash(value) {
  let hash = 0xcbf29ce484222325n;
  for (const character of String(value || "")) {
    const codePoint = character.codePointAt(0);
    hash ^= BigInt(codePoint);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

export function normalizeSemanticAttempt(input = {}, options = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Semantic attempt must be an object.");
  }

  const enforceStorageLimits = options.enforceStorageLimits !== false;
  const allowDerivedConceptId = options.allowDerivedConceptId === true;

  const id = requiredIdentifier(input.id, "Attempt id", 240);
  const activityId = requiredIdentifier(input.activityId, "Activity id", 80);
  const itemId = requiredIdentifier(input.itemId, "Item id", 300);
  const occurredAt = normalizeTimestamp(input.occurredAt);
  const signalInputs = Array.isArray(input.signals) ? input.signals : [];
  if (enforceStorageLimits && signalInputs.length > boundedSemanticHistoryPolicy.maximumSignalsPerAttempt) {
    throw new Error(`Semantic attempt contains more than ${boundedSemanticHistoryPolicy.maximumSignalsPerAttempt} signals.`);
  }
  const signals = signalInputs.map((signal, index) => normalizeSignal(signal, index, { allowDerivedConceptId }));
  if (!signals.length) throw new Error("Semantic attempt must contain at least one signal.");

  const statementKeys = new Set();
  for (const signal of signals) {
    if (statementKeys.has(signal.statementKey)) {
      throw new Error(`Semantic attempt repeats statement ${signal.statementKey}.`);
    }
    statementKeys.add(signal.statementKey);
  }

  const normalized = {
    schemaVersion: semanticLearningSchema.attemptVersion,
    id,
    activityId,
    itemId,
    occurredAt,
    occurredAtMs: Date.parse(occurredAt),
    item: cloneJsonValue(input.item, {}),
    context: cloneJsonValue(input.context, {}),
    signals
  };
  if (enforceStorageLimits && JSON.stringify(normalized).length > boundedSemanticHistoryPolicy.maximumAttemptCharacters) {
    throw new Error("Semantic attempt is too large to retain safely.");
  }
  return normalized;
}

export function semanticAttemptsEqual(leftInput, rightInput, options = {}) {
  return canonicalJson(normalizeSemanticAttempt(leftInput, options))
    === canonicalJson(normalizeSemanticAttempt(rightInput, options));
}

export function semanticAttemptFingerprint(input, options = {}) {
  return semanticTextHash(canonicalJson(normalizeSemanticAttempt(input, options)));
}

export function applyAttemptToEvidence(current, attemptInput, signalInput) {
  const attempt = attemptInput?.schemaVersion === semanticLearningSchema.attemptVersion
    ? attemptInput
    : normalizeSemanticAttempt(attemptInput);
  const signal = signalInput?.statementKey
    ? signalInput
    : normalizeSignal(signalInput, 0);
  const existing = current ? normalizeEvidenceNode(current) : null;

  if (existing && (
    existing.text !== signal.text
    || existing.locale !== signal.locale
    || existing.kind !== signal.kind
    || existing.conceptId !== signal.conceptId
  )) {
    throw new Error(`Statement ${signal.statementKey} changed without a statement revision bump.`);
  }

  const assessed = signal.score !== null && signal.masteryWeight > 0;
  const scoreWeight = assessed ? signal.score * signal.masteryWeight : 0;
  const firstOccurredAtMs = existing
    ? Math.min(existing.firstOccurredAtMs, attempt.occurredAtMs)
    : attempt.occurredAtMs;
  const lastOccurredAtMs = existing
    ? Math.max(existing.lastOccurredAtMs, attempt.occurredAtMs)
    : attempt.occurredAtMs;

  const activityReferences = boundedStringUnion(existing?.activityIds, [attempt.activityId]);
  const itemReferences = boundedStringUnion(existing?.itemIds, [attempt.itemId]);
  const temporal = addTemporalEvidence(existing?.temporal, attempt.occurredAtMs, {
    attemptCount: 1,
    assessedAttemptCount: assessed ? 1 : 0,
    exposureWeight: signal.coverageWeight,
    assessedWeight: assessed ? signal.masteryWeight : 0,
    scoreSum: scoreWeight
  });
  return {
    reducerVersion: semanticLearningSchema.evidenceReducerVersion,
    statementKey: signal.statementKey,
    conceptId: signal.conceptId,
    statementRevision: signal.statementRevision,
    kind: signal.kind,
    locale: signal.locale,
    text: signal.text,
    attemptCount: (existing?.attemptCount || 0) + 1,
    assessedAttemptCount: (existing?.assessedAttemptCount || 0) + (assessed ? 1 : 0),
    exposureWeight: (existing?.exposureWeight || 0) + signal.coverageWeight,
    assessedWeight: (existing?.assessedWeight || 0) + (assessed ? signal.masteryWeight : 0),
    scoreSum: (existing?.scoreSum || 0) + scoreWeight,
    successWeight: (existing?.successWeight || 0) + scoreWeight,
    failureWeight: (existing?.failureWeight || 0) + (assessed ? (1 - signal.score) * signal.masteryWeight : 0),
    firstOccurredAt: new Date(firstOccurredAtMs).toISOString(),
    firstOccurredAtMs,
    lastOccurredAt: new Date(lastOccurredAtMs).toISOString(),
    lastOccurredAtMs,
    temporal,
    activityIds: activityReferences.values,
    activityIdsTruncated: Boolean(existing?.activityIdsTruncated || activityReferences.truncated),
    itemIds: itemReferences.values,
    itemIdsTruncated: Boolean(existing?.itemIdsTruncated || itemReferences.truncated)
  };
}

export function rebuildSemanticEvidence(attemptInputs = [], options = {}) {
  const normalizeOptions = options.normalizeOptions || {};
  const normalized = Array.from(
    attemptInputs || [],
    (attempt) => normalizeSemanticAttempt(attempt, normalizeOptions)
  );
  normalized.sort((left, right) => (
    left.occurredAtMs - right.occurredAtMs || left.id.localeCompare(right.id)
  ));

  const attemptsById = new Map();
  const evidence = new Map();
  for (const baselineInput of Array.from(options.baseline || [])) {
    const baseline = normalizeEvidenceNode(baselineInput);
    if (evidence.has(baseline.statementKey)) {
      throw new Error(`Compacted evidence repeats statement ${baseline.statementKey}.`);
    }
    evidence.set(baseline.statementKey, {
      ...baseline,
      reducerVersion: semanticLearningSchema.evidenceReducerVersion
    });
  }
  for (const attempt of normalized) {
    const previous = attemptsById.get(attempt.id);
    if (previous) {
      if (!semanticAttemptsEqual(previous, attempt, normalizeOptions)) {
        throw new Error(`Attempt id ${attempt.id} refers to different immutable events.`);
      }
      continue;
    }
    attemptsById.set(attempt.id, attempt);
    for (const signal of attempt.signals) {
      evidence.set(
        signal.statementKey,
        applyAttemptToEvidence(evidence.get(signal.statementKey), attempt, signal)
      );
    }
  }
  return [...evidence.values()].sort((left, right) => left.statementKey.localeCompare(right.statementKey));
}

export function compactSemanticEvidence(ledgerInputs = [], attemptInputs = []) {
  return rebuildSemanticEvidence(attemptInputs, { baseline: ledgerInputs });
}

export function migrateSemanticLedger(ledgerInputs = [], fromVersionInput = 0) {
  const fromVersion = Number(fromVersionInput) || 0;
  if (fromVersion === semanticLearningSchema.historyLedgerVersion) {
    return Array.from(ledgerInputs || [], (row) => ({
      ...normalizeEvidenceNode(row),
      reducerVersion: semanticLearningSchema.evidenceReducerVersion,
      ledgerVersion: semanticLearningSchema.historyLedgerVersion
    }));
  }
  if (fromVersion !== 1) {
    if (!Array.from(ledgerInputs || []).length && fromVersion === 0) return [];
    throw new Error(`Compacted semantic ledger version ${fromVersion} requires an explicit migration.`);
  }
  return Array.from(ledgerInputs || [], (row) => {
    const lastOccurredAtMs = normalizeTimestampMs(row?.lastOccurredAtMs, row?.lastOccurredAt);
    return {
      ...normalizeEvidenceNode({
        ...row,
        temporal: emptyTemporalEvidence(lastOccurredAtMs)
      }),
      reducerVersion: semanticLearningSchema.evidenceReducerVersion,
      ledgerVersion: semanticLearningSchema.historyLedgerVersion
    };
  });
}

export function summarizeTemporalEvidence(nodeInput, options = {}) {
  const scale = String(options.scale || "daily");
  if (!temporalScaleDefinitions.some((definition) => definition.name === scale)) {
    throw new Error(`Unknown semantic temporal scale ${scale}.`);
  }
  const periods = Math.floor(boundedNumber(
    options.periods ?? boundedSemanticHistoryPolicy.temporalBucketSlots,
    1,
    boundedSemanticHistoryPolicy.temporalBucketSlots,
    "Semantic temporal period count"
  ));
  const asOfInput = options.asOfMs ?? options.asOf ?? Date.now();
  const asOfMs = normalizeTimestampMs(asOfInput, asOfInput);
  const definition = temporalScaleDefinitions.find((candidate) => candidate.name === scale);
  const currentPeriod = definition.period(asOfMs);
  const firstPeriod = currentPeriod - periods + 1;
  const temporal = normalizeTemporalEvidence(nodeInput?.temporal);
  const summary = emptyTemporalBucket(0);
  for (const bucket of temporal[scale]) {
    if (bucket.period < firstPeriod || bucket.period > currentPeriod) continue;
    addTemporalMetrics(summary, bucket);
  }
  const windowStartedAtMs = definition.startedAt(firstPeriod);
  const latestEvidencePeriod = definition.period(normalizeTimestampMs(
    nodeInput?.lastOccurredAtMs,
    nodeInput?.lastOccurredAt
  ));
  return {
    scale,
    periods,
    asOfMs,
    windowStartedAtMs,
    exactAfterMs: temporal.exactAfterMs,
    exact: (
      temporal.exactAfterMs === 0 || temporal.exactAfterMs < windowStartedAtMs
    ) && currentPeriod >= latestEvidencePeriod,
    attemptCount: summary.attemptCount,
    assessedAttemptCount: summary.assessedAttemptCount,
    exposureWeight: summary.exposureWeight,
    assessedWeight: summary.assessedWeight,
    scoreSum: summary.scoreSum,
    successWeight: summary.scoreSum,
    failureWeight: Math.max(0, summary.assessedWeight - summary.scoreSum)
  };
}

export function projectSemanticEvidence(evidenceInputs, axisPackInput, options = {}) {
  const policy = normalizeProjectionPolicy(options.policy || options);
  const axisPack = normalizeAxisPack(axisPackInput);
  const dimension = normalizedVector(axisPack.axes[0].vector).length;
  const axes = axisPack.axes.map((axis) => ({
    ...axis,
    vector: normalizedVector(axis.vector, dimension)
  }));
  const evidence = Array.from(evidenceInputs || [])
    .map((node) => normalizeProjectedEvidence(node, dimension))
    .filter((node) => node.exposureWeight > 0 || node.assessedWeight > 0);

  const projectedAxes = axes.map((axis) => {
    const neighbors = [];
    let exposureWeight = 0;
    let assessedWeight = 0;
    let scoreSum = 0;

    for (const node of evidence) {
      const similarity = dotProduct(axis.vector, node.vector);
      const kernel = semanticKernel(similarity, policy);
      if (kernel <= 0) continue;
      const exposureContribution = kernel * node.exposureWeight;
      const assessmentContribution = kernel * node.assessedWeight;
      exposureWeight += exposureContribution;
      assessedWeight += assessmentContribution;
      scoreSum += kernel * node.scoreSum;
      neighbors.push({
        statementKey: node.statementKey,
        conceptId: node.conceptId,
        text: node.text,
        kind: node.kind,
        similarity,
        kernel,
        exposureContribution,
        assessmentContribution
      });
    }

    const hasAssessment = assessedWeight > Number.EPSILON;
    const posteriorMean = hasAssessment
      ? (policy.priorAlpha + scoreSum) / (policy.priorAlpha + policy.priorBeta + assessedWeight)
      : null;
    return {
      id: axis.id,
      label: axis.label,
      probe: axis.probe,
      mastery: posteriorMean,
      coverage: 1 - Math.exp(-exposureWeight / policy.coverageScale),
      assessmentConfidence: 1 - Math.exp(-assessedWeight / policy.assessmentScale),
      exposureWeight,
      assessedWeight,
      neighborCount: neighbors.length,
      topEvidence: neighbors
        .sort((left, right) => (
          Math.max(right.exposureContribution, right.assessmentContribution)
          - Math.max(left.exposureContribution, left.assessmentContribution)
        ))
        .slice(0, policy.maxNeighbors)
    };
  });

  return {
    axisPackId: axisPack.id,
    axisPackVersion: axisPack.version,
    modelId: axisPack.modelId,
    projectionPolicy: policy,
    axes: projectedAxes
  };
}

export function semanticKernel(similarityInput, policyInput = defaultSemanticProjectionPolicy) {
  const policy = normalizeProjectionPolicy(policyInput);
  const similarity = Number(similarityInput);
  if (!Number.isFinite(similarity) || similarity <= policy.similarityFloor) return 0;
  const scaled = Math.min(1, (similarity - policy.similarityFloor) / (1 - policy.similarityFloor));
  return scaled ** policy.kernelExponent;
}

function normalizeSignal(input = {}, index = 0, options = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError(`Semantic signal ${index + 1} must be an object.`);
  }
  const text = requiredText(input.text, `Semantic signal ${index + 1} text`);
  const suppliedConceptId = optionalIdentifier(input.conceptId || input.id, 240);
  if (!suppliedConceptId && !options.allowDerivedConceptId) {
    throw new Error(`Semantic signal ${index + 1} must include a stable conceptId.`);
  }
  const conceptId = suppliedConceptId
    || `legacy-statement-${semanticTextHash(`${input.kind || "skill"}\n${text}`)}`;
  const statementRevision = optionalIdentifier(input.statementRevision ?? "1", 80) || "1";
  const score = input.score === null || input.score === undefined
    ? null
    : boundedNumber(input.score, 0, 1, `Semantic signal ${conceptId} score`);
  const coverageWeight = boundedNumber(
    input.coverageWeight ?? input.weight ?? 1,
    0,
    maximumSignalWeight,
    `Semantic signal ${conceptId} coverage weight`
  );
  const masteryWeight = score === null
    ? 0
    : boundedNumber(
      input.masteryWeight ?? input.weight ?? coverageWeight,
      0,
      maximumSignalWeight,
      `Semantic signal ${conceptId} mastery weight`
    );

  return {
    conceptId,
    statementRevision,
    statementKey: `${conceptId}@${statementRevision}`,
    kind: optionalIdentifier(input.kind, 60) || "skill",
    locale: optionalIdentifier(input.locale, 35) || "en",
    text,
    score,
    coverageWeight,
    masteryWeight
  };
}

function normalizeEvidenceNode(input = {}) {
  const firstOccurredAtMs = normalizeTimestampMs(input.firstOccurredAtMs, input.firstOccurredAt);
  const lastOccurredAtMs = normalizeTimestampMs(input.lastOccurredAtMs, input.lastOccurredAt);
  const activityReferences = boundedStringUnion(input.activityIds);
  const itemReferences = boundedStringUnion(input.itemIds);
  return {
    reducerVersion: Number(input.reducerVersion) || semanticLearningSchema.evidenceReducerVersion,
    statementKey: requiredIdentifier(input.statementKey, "Evidence statement key", 340),
    conceptId: requiredIdentifier(input.conceptId, "Evidence concept id", 240),
    statementRevision: optionalIdentifier(input.statementRevision, 80) || "1",
    kind: optionalIdentifier(input.kind, 60) || "skill",
    locale: optionalIdentifier(input.locale, 35) || "en",
    text: requiredText(input.text, "Evidence text"),
    attemptCount: nonNegativeNumber(input.attemptCount),
    assessedAttemptCount: nonNegativeNumber(input.assessedAttemptCount),
    exposureWeight: nonNegativeNumber(input.exposureWeight),
    assessedWeight: nonNegativeNumber(input.assessedWeight),
    scoreSum: nonNegativeNumber(input.scoreSum),
    successWeight: nonNegativeNumber(input.successWeight),
    failureWeight: nonNegativeNumber(input.failureWeight),
    firstOccurredAt: new Date(firstOccurredAtMs).toISOString(),
    firstOccurredAtMs,
    lastOccurredAt: new Date(lastOccurredAtMs).toISOString(),
    lastOccurredAtMs,
    temporal: normalizeTemporalEvidence(input.temporal),
    activityIds: activityReferences.values,
    activityIdsTruncated: Boolean(input.activityIdsTruncated || activityReferences.truncated),
    itemIds: itemReferences.values,
    itemIdsTruncated: Boolean(input.itemIdsTruncated || itemReferences.truncated)
  };
}

function emptyTemporalEvidence(exactAfterMs = 0) {
  return {
    version: semanticLearningSchema.temporalSummaryVersion,
    exactAfterMs: normalizeTimestampMs(exactAfterMs, 0),
    daily: [],
    weekly: [],
    monthly: []
  };
}

function normalizeTemporalEvidence(input = {}) {
  const normalized = emptyTemporalEvidence(input?.exactAfterMs);
  for (const definition of temporalScaleDefinitions) {
    const buckets = new Map();
    for (const bucketInput of Array.from(input?.[definition.name] || [])) {
      const period = Math.floor(Number(bucketInput?.period));
      if (!Number.isFinite(period)) continue;
      const bucket = normalizeTemporalBucket(bucketInput, period);
      const existing = buckets.get(period);
      if (existing) addTemporalMetrics(existing, bucket);
      else buckets.set(period, bucket);
    }
    normalized[definition.name] = [...buckets.values()]
      .sort((left, right) => right.period - left.period)
      .slice(0, boundedSemanticHistoryPolicy.temporalBucketSlots);
  }
  return normalized;
}

function addTemporalEvidence(input, occurredAtMs, contributionInput) {
  const temporal = normalizeTemporalEvidence(input);
  const contribution = normalizeTemporalBucket(contributionInput, 0);
  for (const definition of temporalScaleDefinitions) {
    const period = definition.period(occurredAtMs);
    const existing = temporal[definition.name].find((bucket) => bucket.period === period);
    if (existing) addTemporalMetrics(existing, contribution);
    else temporal[definition.name].push({ ...contribution, period });
    temporal[definition.name].sort((left, right) => right.period - left.period);
    temporal[definition.name] = temporal[definition.name]
      .slice(0, boundedSemanticHistoryPolicy.temporalBucketSlots);
  }
  return temporal;
}

function emptyTemporalBucket(period) {
  return {
    period,
    attemptCount: 0,
    assessedAttemptCount: 0,
    exposureWeight: 0,
    assessedWeight: 0,
    scoreSum: 0
  };
}

function normalizeTemporalBucket(input = {}, period = 0) {
  return {
    period,
    attemptCount: nonNegativeNumber(input.attemptCount),
    assessedAttemptCount: nonNegativeNumber(input.assessedAttemptCount),
    exposureWeight: nonNegativeNumber(input.exposureWeight),
    assessedWeight: nonNegativeNumber(input.assessedWeight),
    scoreSum: nonNegativeNumber(input.scoreSum)
  };
}

function addTemporalMetrics(target, source) {
  target.attemptCount += nonNegativeNumber(source.attemptCount);
  target.assessedAttemptCount += nonNegativeNumber(source.assessedAttemptCount);
  target.exposureWeight += nonNegativeNumber(source.exposureWeight);
  target.assessedWeight += nonNegativeNumber(source.assessedWeight);
  target.scoreSum += nonNegativeNumber(source.scoreSum);
  return target;
}

function normalizeProjectedEvidence(input, dimension) {
  const node = normalizeEvidenceNode(input);
  return {
    ...node,
    vector: normalizedVector(input.vector, dimension)
  };
}

function normalizeAxisPack(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Axis pack must be an object.");
  }
  const axes = Array.isArray(input.axes) ? input.axes : [];
  if (!axes.length) throw new Error("Axis pack must contain at least one axis.");
  if (axes.length > maximumProjectionAxes) {
    throw new Error(`Axis pack cannot contain more than ${maximumProjectionAxes} axes.`);
  }
  const axisIds = new Set();
  return {
    id: requiredIdentifier(input.id, "Axis pack id", 160),
    version: optionalIdentifier(input.version ?? "1", 80) || "1",
    modelId: optionalIdentifier(input.modelId, 180) || "",
    axes: axes.map((axis, index) => {
      const probe = typeof axis?.probe === "object" && axis.probe
        ? {
          locale: optionalIdentifier(axis.probe.locale, 35) || "en",
          text: requiredText(axis.probe.text, `Axis ${index + 1} probe text`),
          revision: optionalIdentifier(axis.probe.revision ?? "1", 80) || "1"
        }
        : {
          locale: "en",
          text: requiredText(axis?.text, `Axis ${index + 1} probe text`),
          revision: "1"
        };
      const id = requiredIdentifier(axis?.id, `Axis ${index + 1} id`, 160);
      if (axisIds.has(id)) throw new Error(`Axis pack contains duplicate axis id ${id}.`);
      axisIds.add(id);
      return {
        id,
        label: requiredText(axis?.label, `Axis ${index + 1} label`, 240),
        probe,
        vector: axis?.vector
      };
    })
  };
}

function normalizeProjectionPolicy(input = {}) {
  return {
    version: Number(input.version) || defaultSemanticProjectionPolicy.version,
    similarityFloor: boundedNumber(
      input.similarityFloor ?? defaultSemanticProjectionPolicy.similarityFloor,
      -0.99,
      0.99,
      "Projection similarity floor"
    ),
    kernelExponent: boundedNumber(
      input.kernelExponent ?? defaultSemanticProjectionPolicy.kernelExponent,
      0.01,
      20,
      "Projection kernel exponent"
    ),
    priorAlpha: boundedNumber(input.priorAlpha ?? defaultSemanticProjectionPolicy.priorAlpha, 0.001, 1000, "Projection prior alpha"),
    priorBeta: boundedNumber(input.priorBeta ?? defaultSemanticProjectionPolicy.priorBeta, 0.001, 1000, "Projection prior beta"),
    coverageScale: boundedNumber(input.coverageScale ?? defaultSemanticProjectionPolicy.coverageScale, 0.001, 10000, "Projection coverage scale"),
    assessmentScale: boundedNumber(input.assessmentScale ?? defaultSemanticProjectionPolicy.assessmentScale, 0.001, 10000, "Projection assessment scale"),
    maxNeighbors: Math.floor(boundedNumber(input.maxNeighbors ?? defaultSemanticProjectionPolicy.maxNeighbors, 1, 100, "Projection neighbor limit"))
  };
}

function normalizedVector(input, expectedDimension = null) {
  const values = ArrayBuffer.isView(input)
    ? Float64Array.from(input)
    : Array.isArray(input)
      ? Float64Array.from(input)
      : null;
  if (!values?.length) throw new Error("Semantic vector is empty.");
  if (expectedDimension !== null && values.length !== expectedDimension) {
    throw new Error(`Semantic vector dimension mismatch: expected ${expectedDimension}, got ${values.length}.`);
  }
  let squaredNorm = 0;
  for (const value of values) {
    if (!Number.isFinite(value)) throw new Error("Semantic vector contains a non-finite value.");
    squaredNorm += value * value;
  }
  const norm = Math.sqrt(squaredNorm);
  if (!(norm > 0)) throw new Error("Semantic vector has zero norm.");
  for (let index = 0; index < values.length; index += 1) values[index] /= norm;
  return values;
}

function dotProduct(left, right) {
  let value = 0;
  for (let index = 0; index < left.length; index += 1) value += left[index] * right[index];
  return Math.max(-1, Math.min(1, value));
}

function requiredIdentifier(value, label, maximumLength) {
  const normalized = optionalIdentifier(value, maximumLength);
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

function optionalIdentifier(value, maximumLength) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return "";
  if (normalized.length > maximumLength || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new Error(`Invalid identifier ${normalized.slice(0, 80)}.`);
  }
  return normalized;
}

function requiredText(value, label, maximumLength = maximumTextLength) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new Error(`${label} is required.`);
  if (normalized.length > maximumLength) throw new Error(`${label} is too long.`);
  return normalized;
}

function boundedNumber(value, minimum, maximum, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) {
    throw new Error(`${label} must be between ${minimum} and ${maximum}.`);
  }
  return number;
}

function nonNegativeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function normalizeTimestamp(value) {
  const date = value ? new Date(value) : new Date();
  if (!Number.isFinite(date.getTime())) throw new Error("Semantic attempt timestamp is invalid.");
  return date.toISOString();
}

function normalizeTimestampMs(value, fallback) {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric >= 0) return numeric;
  const parsed = Date.parse(String(fallback || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function cloneJsonValue(value, fallback) {
  try {
    return JSON.parse(JSON.stringify(value ?? fallback));
  } catch (error) {
    throw new Error("Semantic attempt metadata must be JSON-serializable.", { cause: error });
  }
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function boundedStringUnion(...collections) {
  const values = [...new Set(
    collections.flatMap((collection) => Array.from(collection || [], String)).filter(Boolean)
  )].sort();
  return {
    values: values.slice(0, boundedSemanticHistoryPolicy.maximumEvidenceReferences),
    truncated: values.length > boundedSemanticHistoryPolicy.maximumEvidenceReferences
  };
}
