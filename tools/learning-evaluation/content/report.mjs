const cell = value => String(value ?? '—').replaceAll('|', '\\|').replaceAll('\n', ' ');
const number = value => typeof value === 'number' ? Number.isInteger(value) ? String(value) : value.toFixed(4) : '—';
const table = (headers, rows) => [`| ${headers.join(' | ')} |`, `| ${headers.map(() => '---').join(' | ')} |`, ...rows.map(row => `| ${row.map(cell).join(' | ')} |`)].join('\n');

export function renderReport(result) {
  const { metadata, semantic, run } = result;
  const all = metadata.overall;
  const lines = ['# Content distribution inspection', '',
    `Run: ${run.id}. Seed: ${run.config.seed}. Input: ${run.fixture ? 'small authored fixture' : 'manifest-driven course inventory'}.`, '',
    `${all.authoredRecords} authored records; ${all.playableAssessmentUnits} known normalized playable assessment units${all.playableCountComplete ? '' : ` (incomplete: ${all.unavailablePlayableBanks} banks unavailable)`}; ${all.semanticDocuments} unique canonical English documents. These are different counting units.`, '',
    '## Inventory and distributions', '',
    table(['Course', 'Game', 'Bank', 'Authored', 'Known playable', 'English docs', 'Missing English'], metadata.groups.filter(row => !row.scope.kind).map(row => [row.scope.courseId, row.scope.gameId ?? '(all)', row.scope.bankId ?? '(all)', row.authoredRecords, row.playableCountComplete ? row.playableAssessmentUnits : `${row.playableAssessmentUnits} (incomplete)`, row.semanticDocuments, row.missingEnglish])), '',
    table(['Field', 'Valid', 'Missing', 'Invalid', 'Min', 'Median', 'Max', 'Mean'], Object.entries(all.authoredMetadata).map(([key, row]) => [key, row.count, row.missing, row.invalid, row.min, number(row.median), row.max, number(row.mean)])), '',
    'Complete histograms, record kinds/roles, authored and playable metadata, category frequencies, HHI, entropy, and category difficulty/complexity spreads are in results.json. Missing badges are reported separately; some record kinds do not support a badge.', '',
    `Exact English duplicate groups: ${metadata.exactDuplicates.documentGroups}; participating authored records: ${metadata.exactDuplicates.participatingRecords}.`, '',
    table(['English', 'Authored records', 'Document'], metadata.exactDuplicates.examples.map(row => [row.englishText, row.records, row.documentId])), '',
    '## Semantic inspection', '',
    `Status: ${semantic.status}. Strategy: SHA-256 priority sample of unique English document IDs, seeded independently from metadata traversal.`, '',
    `Eligible documents: ${semantic.eligibleDocuments}; selected: ${semantic.selectedDocuments}; outside inspection budget: ${semantic.outsideInspectionBudget}.`, '',
    `Authored English absent: ${all.missingEnglish}; authored English present but rejected by the embedding input guard: ${all.semanticInputRejected}.`, ''];
  if (semantic.error) lines.push(`Blocker: ${semantic.error}`, '');
  if (semantic.cacheStats) lines.push(`Cache: ${JSON.stringify(semantic.cacheStats)}.`, '');
  if (semantic.modelSignature) lines.push(`Model: ${semantic.modelSignature.modelId}. Verified signatures and preprocessing recipe are recorded in results.json.`, '');
  if (semantic.metrics) {
    const m = semantic.metrics;
    lines.push(table(['Metric', 'Value'], [
      ['Inspected unique English documents', m.inspectedDocuments], ['Pair comparisons', m.pairComparisons],
      ['Mean pair cosine', number(m.meanPairCosine)], ['Centroid norm squared (concentration)', number(m.centroidNormSquared)],
      ['Mean cosine distance to centroid (dispersion)', number(m.meanCosineDistanceToCentroid)],
      ['Median nearest-neighbor distance (within inspected corpus)', number(m.nearestNeighborDistance.median)],
      ['Isolated at inspection threshold', m.isolatedAtInspectionThreshold], ['Near pairs', m.nearPairCount],
      ['Related pair/scope comparisons', m.relatedPairScopes], ['Related grade-gap candidates', m.relatedGapCandidates.count]
    ]), '', '### Near-neighbor examples', '',
    table(['English A', 'English B', 'Cosine'], m.nearNeighborExamples.map(row => [row.left.englishText, row.right.englishText, number(row.similarity)])), '',
    '### Within-inspection sparsity examples', '',
    table(['English', 'Nearest inspected English', 'Distance'], m.sparseExamples.map(row => [row.left.englishText, row.right.englishText, number(row.nearestDistance)])), '',
    '### Related content grade spreads', '',
    table(['Course/game/bank/kind', 'English A', 'English B', 'Complexity spread', 'Badge spread'], m.relatedSpreadExamples.map(row => [Object.values(row.scope).join('/'), row.left.englishText, row.right.englishText, row.complexitySpread, row.difficultySpread])), '');
  }
  lines.push('## Diagnostic candidates and data quality', '',
    `${metadata.progressionGaps.candidates} empty complexity-interval candidates. ${metadata.progressionGaps.interpretation}`, '',
    table(['Course/game/bank/kind', 'Category', 'Lower', 'Upper', 'Gap'], metadata.progressionGaps.examples.map(row => [Object.values({ course: row.courseId, game: row.gameId, bank: row.bankId, kind: row.kind }).join('/'), row.category.field ? `${row.category.field}=${row.category.value}` : '(bank/kind)', row.lower, row.upper, row.gap])), '',
    table(['Finding', 'Count'], Object.entries(result.findingCounts)), '',
    ...result.findings.slice(0, run.config.diagnostics.exampleLimit).map(row => `- ${row.code}: ${row.message} (${row.recordId || [row.courseId, row.gameId, row.bankId].filter(Boolean).join('/')})`), '',
    `Reference coverage: ${JSON.stringify(metadata.referenceCoverage)}.`, '',
    '## Limits and interpretation', '',
    '- No aggregate course-quality score, universal curriculum, learner model, or sampling-policy comparison is computed.',
    '- Semantic similarity describes English meaning only. It grants no mastery, evidence transfer, or permission to treat target grammar or pronunciation as equivalent.',
    '- Exact English duplicates may be intentional across courses, banks, grammar contexts, and assessments; they do not establish pedagogical redundancy.',
    '- Nearest-neighbor distance, isolation, category richness, entropy, and observed extremes depend on corpus and sample size. A small sample can make content look sparse. Coverage by bank and the exact selected IDs are recorded in JSON.',
    '- Structural parents can lack independent English or target text. Their omissions are explicit; child text is never invented for them.',
    '- English provenance is an authoring contract, not automatic language detection. The encoder adds a mechanical script guard and reports rejected inputs.',
    '- Grades and gaps are authored metadata diagnostics. Numeric gaps and semantic spreads do not establish learner difficulty, optimal sequencing, or missing topics. Topic absence is assessed only against an explicitly supplied reference.',
    '- Category dimensions and any authored Czech semantic-compass axes are not embedding coordinates or universal mastery dimensions.',
    '- Normalized assessment candidates are not generated round combinations, runtime availability guarantees, or counts of dictionary rows. Adapter errors are recorded with unavailable counts, not guessed playable totals.', '',
    '## Reproduction and provenance', '',
    'Exact effective configuration, input/implementation hashes, source provenance, adapter status, selected IDs, model signatures, and skipped-input reasons are retained in results.json and corpus.json.', '',
    `Invocation: ${run.command}`, '',
    table(['Source', 'SHA-256'], result.sources.map(source => [source.path, source.sha256])), '');
  return lines.join('\n');
}
