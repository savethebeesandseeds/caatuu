import { createHash } from 'node:crypto';

const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const sorted = values => [...values].sort(compare);
const countBy = (rows, key) => {
  const counts = new Map();
  for (const row of rows) { const value = key(row); counts.set(value, (counts.get(value) || 0) + 1); }
  return Object.fromEntries(sorted(counts.keys()).map(value => [value, counts.get(value)]));
};
const finite = value => typeof value === 'number' && Number.isFinite(value);
const mean = values => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
const gradeValid = (key, value) => Number.isInteger(value) && value >= 1 && value <= (key === 'difficulty' ? 3 : 100);
const groupKey = row => JSON.stringify([row.courseId, row.gameId, row.bankId, row.kind]);
const identity = row => ({ courseId: row.courseId, gameId: row.gameId, bankId: row.bankId, kind: row.kind });

export function numericSummary(values) {
  const numbers = values.filter(finite).sort((a, b) => a - b);
  const average = mean(numbers);
  const quantile = p => {
    if (!numbers.length) return null;
    const i = (numbers.length - 1) * p, low = Math.floor(i), fraction = i - low;
    return numbers[low] + (numbers[Math.ceil(i)] - numbers[low]) * fraction;
  };
  return { count: numbers.length, min: numbers[0] ?? null, p25: quantile(.25), median: quantile(.5), p75: quantile(.75),
    max: numbers.at(-1) ?? null, mean: average,
    standardDeviation: average === null ? null : Math.sqrt(mean(numbers.map(value => (value - average) ** 2))) };
}

export function gradeDistribution(rows, key) {
  const values = rows.map(row => row.metadata?.[key]);
  const valid = values.filter(value => gradeValid(key, value));
  const bins = key === 'difficulty' ? [[1, 1], [2, 2], [3, 3]]
    : Array.from({ length: 10 }, (_, i) => [10 * i + 1, 10 * i + 10]);
  return { total: values.length, missing: values.filter(value => value == null).length,
    invalid: values.filter(value => value != null && !gradeValid(key, value)).length,
    ...numericSummary(valid), histogram: Object.fromEntries(bins.map(([lo, hi]) => [lo === hi ? String(lo) : `${lo}-${hi}`, valid.filter(v => v >= lo && v <= hi).length])) };
}

export function categoryDistribution(rows) {
  const fields = sorted(new Set(rows.flatMap(row => Object.keys(row.categories || {}))));
  return Object.fromEntries(fields.map(field => {
    const tagged = rows.filter(row => row.categories?.[field]?.length);
    const counts = countBy(tagged.flatMap(row => [...new Set(row.categories[field])]), value => value);
    const occurrences = Object.values(counts).reduce((a, b) => a + b, 0);
    const proportions = Object.values(counts).map(n => n / occurrences);
    const entropy = occurrences ? -proportions.reduce((s, p) => s + p * Math.log(p), 0) : null;
    return [field, { taggedRecords: tagged.length, missing: rows.length - tagged.length, occurrences, counts,
      concentrationHHI: occurrences ? proportions.reduce((s, p) => s + p * p, 0) : null,
      entropyNats: entropy, effectiveCategories: entropy === null ? null : Math.exp(entropy) }];
  }));
}

function describe(records, units, adapters) {
  return { authoredRecords: records.length, authoredKinds: countBy(records, row => row.kind),
    recordRoles: countBy(records, row => row.recordRole), playableAssessmentUnits: units.length,
    playableKinds: countBy(units, row => row.kind), semanticDocuments: new Set(records.map(row => row.semanticDocumentId).filter(Boolean)).size,
    playableCountComplete: adapters.every(row => row.status === 'ok'), unavailablePlayableBanks: adapters.filter(row => row.status !== 'ok').length,
    missingEnglish: records.filter(row => !row.english?.text).length,
    missingEnglishReasons: countBy(records.filter(row => !row.english?.text), row => row.english?.reason || 'unspecified'),
    semanticInputRejected: records.filter(row => row.english?.text && !row.semanticDocumentId).length,
    missingTarget: records.filter(row => row.translation?.missingTarget).length,
    missingLearnerBase: records.filter(row => row.translation?.missingLearnerBase).length,
    authoredMetadata: Object.fromEntries(['difficulty', 'usefulness', 'complexity'].map(key => [key, gradeDistribution(records, key)])),
    playableMetadata: Object.fromEntries(['difficulty', 'usefulness', 'complexity'].map(key => [key, gradeDistribution(units, key)])),
    categories: categoryDistribution(records) };
}

export function inspectMetadata(corpus, diagnostics, reference = null) {
  const { records, playableUnits: units, documents } = corpus;
  const groups = [];
  for (const fields of [['courseId'], ['courseId', 'gameId'], ['courseId', 'gameId', 'bankId'], ['courseId', 'gameId', 'bankId', 'kind']]) {
    const keys = sorted(new Set(records.map(row => JSON.stringify(fields.map(key => row[key])))));
    for (const key of keys) {
      const values = JSON.parse(key);
      const matches = row => fields.every((field, index) => row[field] === values[index]);
      const selectedRecords = records.filter(matches), recordIds = new Set(selectedRecords.map(row => row.id));
      const selectedUnits = units.filter(row => row.recordIds.some(id => recordIds.has(id)));
      const selectedAdapters = (corpus.adapters || []).filter(row => fields.every((field, index) => field === 'kind' || row[field] === values[index]));
      groups.push({ scope: Object.fromEntries(fields.map((field, index) => [field, values[index]])), ...describe(selectedRecords, selectedUnits, selectedAdapters) });
    }
  }
  // Duplicate authoring is a text-only question even when the encoder rejects a
  // legitimate English string containing an accented name or borrowed word.
  const authoredEnglish = new Map();
  for (const record of records) if (record.english?.text) {
    const englishText = record.english.text.normalize('NFKC').trim();
    if (!authoredEnglish.has(englishText)) authoredEnglish.set(englishText, {
      id: `english:${createHash('sha256').update(englishText).digest('hex')}`, englishText,
      semanticDocumentId: record.semanticDocumentId, recordIds: []
    });
    authoredEnglish.get(englishText).recordIds.push(record.id);
  }
  const exactDuplicates = [...authoredEnglish.values()].filter(document => document.recordIds.length > 1)
    .map(document => ({ englishTextId: document.id, documentId: document.semanticDocumentId, englishText: document.englishText,
      records: document.recordIds.length, recordIds: document.recordIds }))
    .sort((a, b) => b.records - a.records || compare(a.englishTextId, b.englishTextId));
  const groupsByKind = new Map();
  for (const row of records) {
    const key = groupKey(row);
    if (!groupsByKind.has(key)) groupsByKind.set(key, []);
    groupsByKind.get(key).push(row);
  }
  const gaps = [], categorySpread = [];
  for (const rows of groupsByKind.values()) {
    // Order is authored numeric complexity, never a claimed production learning path.
    const scopes = [{ field: null, value: null, rows }];
    for (const [field, dist] of Object.entries(categoryDistribution(rows))) {
      for (const value of Object.keys(dist.counts)) scopes.push({ field, value, rows: rows.filter(row => row.categories?.[field]?.includes(value)) });
    }
    for (const scope of scopes) {
      const values = sorted(new Set(scope.rows.map(row => row.metadata.complexity).filter(value => gradeValid('complexity', value)))).sort((a, b) => a - b);
      for (let i = 1; i < values.length; i++) if (values[i] - values[i - 1] >= diagnostics.complexityGap) {
        gaps.push({ ...identity(rows[0]), category: { field: scope.field, value: scope.value }, lower: values[i - 1], upper: values[i],
          gap: values[i] - values[i - 1], label: 'diagnostic candidate',
          lowerRecordIds: scope.rows.filter(row => row.metadata.complexity === values[i - 1]).map(row => row.id),
          upperRecordIds: scope.rows.filter(row => row.metadata.complexity === values[i]).map(row => row.id) });
      }
      if (scope.field) categorySpread.push({ ...identity(rows[0]), field: scope.field, value: scope.value, records: scope.rows.length,
        complexity: gradeDistribution(scope.rows, 'complexity'), difficulty: gradeDistribution(scope.rows, 'difficulty') });
    }
  }
  gaps.sort((a, b) => b.gap - a.gap || compare(JSON.stringify(a), JSON.stringify(b)));
  let referenceCoverage = { status: 'not-assessed', reason: 'No explicit reference supplied; topic absence cannot be inferred.' };
  if (reference) {
    const selected = records.filter(row => ['courseId', 'gameId', 'bankId'].every(key => !reference[key] || row[key] === reference[key]));
    const found = new Set(selected.flatMap(row => row.categories?.[reference.field] || []));
    referenceCoverage = { status: 'explicit-reference-only', reference, records: selected.length,
      observed: sorted(found), missing: sorted(new Set(reference.expected.filter(value => !found.has(value)))) };
  }
  const duplicateSpread = [];
  const recordMap = new Map(records.map(row => [row.id, row]));
  for (const document of [...authoredEnglish.values()].filter(row => row.recordIds.length > 1)) {
    const scopes = new Map();
    for (const id of document.recordIds) {
      const row = recordMap.get(id), key = groupKey(row);
      if (!scopes.has(key)) scopes.set(key, []);
      scopes.get(key).push(row);
    }
    for (const rows of scopes.values()) if (rows.length > 1) duplicateSpread.push({ englishTextId: document.id, documentId: document.semanticDocumentId, englishText: document.englishText,
      scope: identity(rows[0]), recordIds: rows.map(row => row.id), complexity: gradeDistribution(rows, 'complexity'), difficulty: gradeDistribution(rows, 'difficulty') });
  }
  return { overall: describe(records, units, corpus.adapters || []), groups, exactDuplicates: { documentGroups: exactDuplicates.length,
    participatingRecords: exactDuplicates.reduce((sum, row) => sum + row.records, 0), examples: exactDuplicates.slice(0, diagnostics.exampleLimit) },
    exactDuplicateSpread: duplicateSpread, categorySpread, progressionGaps: { candidates: gaps.length, examples: gaps.slice(0, diagnostics.exampleLimit),
      interpretation: 'Empty intervals in authored complexity within a bank/kind or authored category; not missing lessons or an evaluated learning path.' },
    referenceCoverage };
}

export function selectSemanticDocuments(documents, { seed, maxDocuments }) {
  if (typeof seed !== 'string' || !Number.isInteger(maxDocuments) || maxDocuments < 0) throw new TypeError('Invalid semantic inspection seed or size');
  // Stable hash priority sample: invariant to input order; never samples learner records.
  return documents.map(document => ({ document, key: createHash('sha256').update(JSON.stringify([seed, document.id])).digest('hex') }))
    .sort((a, b) => compare(a.key, b.key) || compare(a.document.id, b.document.id)).slice(0, maxDocuments).map(row => row.document);
}

export function inspectSemantics(corpus, vectorRows, config) {
  const rows = [...vectorRows].sort((a, b) => compare(a.id, b.id));
  if (new Set(rows.map(row => row.id)).size !== rows.length) throw new TypeError('Duplicate semantic document ID');
  const dimension = rows[0]?.vector.length || 0;
  for (const row of rows) {
    if (!dimension || row.vector.length !== dimension || !row.vector.every(finite)) throw new TypeError('Invalid semantic vector');
    const squaredNorm = row.vector.reduce((s, v) => s + v * v, 0);
    if (Math.abs(squaredNorm - 1) > .002) throw new TypeError('Semantic metrics require unit vectors');
  }
  const recordMap = new Map(corpus.records.map(row => [row.id, row]));
  const documents = new Map(corpus.documents.map(row => [row.id, row]));
  const scopeMetadata = new Map(rows.map(row => {
    if (!documents.has(row.id)) throw new TypeError(`Unknown semantic document ${row.id}`);
    const scopes = new Map();
    for (const id of documents.get(row.id).recordIds) {
      const record = recordMap.get(id);
      if (!record) throw new TypeError(`Unknown authored record ${id}`);
      const key = groupKey(record);
      if (!scopes.has(key)) scopes.set(key, []);
      scopes.get(key).push(record);
    }
    return [row.id, scopes];
  }));
  const dot = (a, b) => Math.max(-1, Math.min(1, a.reduce((sum, value, i) => sum + value * b[i], 0)));
  const closest = rows.map(() => ({ similarity: -Infinity, index: -1 }));
  const neighbors = [], related = [], relatedCandidates = [];
  let pairSum = 0, pairCount = 0, nearPairCount = 0;
  const retain = (list, value, order) => { list.push(value); list.sort(order); list.length = Math.min(list.length, config.diagnostics.exampleLimit); };
  const example = (i, j, similarity) => ({ left: { id: rows[i].id, englishText: documents.get(rows[i].id).englishText, recordIds: documents.get(rows[i].id).recordIds },
    right: { id: rows[j].id, englishText: documents.get(rows[j].id).englishText, recordIds: documents.get(rows[j].id).recordIds }, similarity });
  let relatedPairScopes = 0, relatedGapCandidates = 0;
  for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) {
    const similarity = dot(rows[i].vector, rows[j].vector);
    pairSum += similarity; pairCount++;
    if (similarity > closest[i].similarity) closest[i] = { similarity, index: j };
    if (similarity > closest[j].similarity) closest[j] = { similarity, index: i };
    if (similarity < config.semantic.nearSimilarity) continue;
    nearPairCount++;
    retain(neighbors, example(i, j, similarity), (a, b) => b.similarity - a.similarity);
    for (const [key, left] of scopeMetadata.get(rows[i].id)) {
      const right = scopeMetadata.get(rows[j].id).get(key);
      if (!right) continue;
      relatedPairScopes++;
      const spread = field => {
        const values = [...left, ...right].map(row => row.metadata[field]).filter(value => gradeValid(field, value));
        return values.length ? Math.max(...values) - Math.min(...values) : null;
      };
      const value = { ...example(i, j, similarity), scope: identity(left[0]), complexitySpread: spread('complexity'), difficultySpread: spread('difficulty') };
      retain(related, value, (a, b) => (b.complexitySpread ?? -1) - (a.complexitySpread ?? -1) || b.similarity - a.similarity);
      if (value.complexitySpread >= config.diagnostics.complexityGap || value.difficultySpread >= config.diagnostics.difficultyGap) {
        relatedGapCandidates++;
        retain(relatedCandidates, { ...value, label: 'diagnostic candidate' }, (a, b) => (b.complexitySpread ?? -1) - (a.complexitySpread ?? -1));
      }
    }
  }
  const centroid = Array.from({ length: dimension }, (_, k) => mean(rows.map(row => row.vector[k])));
  const centroidNorm = Math.sqrt(centroid.reduce((s, v) => s + v * v, 0));
  const nearestDistances = closest.filter(row => row.index >= 0).map(row => 1 - row.similarity);
  const sparseExamples = closest.map((nearest, i) => nearest.index < 0 ? null : { ...example(i, nearest.index, nearest.similarity), nearestDistance: 1 - nearest.similarity })
    .filter(Boolean).sort((a, b) => b.nearestDistance - a.nearestDistance).slice(0, config.diagnostics.exampleLimit);
  const selectedIds = new Set(rows.map(row => row.id));
  const groupCoverage = new Map();
  for (const record of corpus.records) {
    const key = JSON.stringify([record.courseId, record.gameId, record.bankId]);
    if (!groupCoverage.has(key)) groupCoverage.set(key, { courseId: record.courseId, gameId: record.gameId, bankId: record.bankId, eligible: new Set(), inspected: new Set() });
    const group = groupCoverage.get(key);
    if (record.semanticDocumentId) {
      group.eligible.add(record.semanticDocumentId);
      if (selectedIds.has(record.semanticDocumentId)) group.inspected.add(record.semanticDocumentId);
    }
  }
  return { inspectedDocuments: rows.length, pairComparisons: pairCount, coverageByBank: [...groupCoverage.values()].map(({ eligible, inspected, ...rest }) => ({ ...rest, eligible: eligible.size, inspected: inspected.size })),
    meanPairCosine: pairCount ? pairSum / pairCount : null, centroidNormSquared: rows.length ? centroidNorm ** 2 : null,
    meanCosineDistanceToCentroid: centroidNorm > 1e-10 ? mean(rows.map(row => 1 - dot(row.vector, centroid.map(v => v / centroidNorm)))) : null,
    nearestNeighborDistance: numericSummary(nearestDistances), isolatedAtInspectionThreshold: pairCount ? closest.filter(row => row.similarity < config.semantic.nearSimilarity).length : null,
    nearPairCount, nearNeighborExamples: neighbors, sparseExamples, relatedPairScopes, relatedSpreadExamples: related,
    relatedGapCandidates: { count: relatedGapCandidates, examples: relatedCandidates },
    interpretation: 'Distances and isolation are within this sampled unique-English corpus only. Thresholds are inspection controls, not pedagogical pass/fail criteria.' };
}
