const DAY = 86400000;
const mean = values => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
const finite = value => typeof value === 'number' && Number.isFinite(value);
const date = value => value === null || value === undefined ? NaN : typeof value === 'string' ? Date.parse(value) : Number(value);

export function evidenceDiagnostics(history, now) {
  const rows = Object.values(history);
  return { dueItems: rows.filter(row => row.exposures > 0 && Number.isFinite(date(row.dueAt)) && date(row.dueAt) <= now).length,
    maximumPracticeDays: Math.max(0, ...rows.map(row => row.practiceDays || 0)),
    maximumIndependentDays: Math.max(0, ...rows.map(row => row.independentDays || 0)),
    maximumSpacedSuccesses: Math.max(0, ...rows.map(row => row.spacedSuccesses || 0)) };
}

/** Compact every actual draw; full score snapshots are retained separately. */
export function compactDecision(decision, candidates) {
  if (!decision) return null;
  const draw = decision.draws?.[0];
  const access = draw?.access || null;
  if (access) {
    const hard = new Set(candidates.map(item => item.id));
    for (const name of ['hardEligibleIds', 'hardRemainingIds', 'availableIds', 'pacedIds']) {
      if (!Array.isArray(access[name]) || new Set(access[name]).size !== access[name].length
          || access[name].some(id => !hard.has(id))) throw new Error(`Invalid candidate access ${name}.`);
    }
    const remaining = new Set(access.hardRemainingIds), available = new Set(access.availableIds);
    if (access.availableIds.some(id => !remaining.has(id)) || !available.has(draw.chosenId)) throw new Error('Access support violates hard eligibility or omits choice.');
    const positive = (draw.distribution || []).filter(row => row.probability > 0).map(row => row.id);
    if (positive.length !== available.size || positive.some(id => !available.has(id))) throw new Error('Access support differs from positive conditional probability.');
    const sum = draw.distribution.reduce((value, row) => value + row.probability, 0);
    if (Math.abs(sum - 1) > 1e-8) throw new Error('Conditional probabilities do not sum to one.');
  }
  const featureKeys = [...new Set((decision.candidates || []).flatMap(row => Object.keys(row.features || {})))];
  const availability = Object.fromEntries(featureKeys.map(key => [key, {
    available: decision.candidates.filter(row => finite(row.features?.[key])).length,
    total: decision.candidates.length
  }]));
  const selected = decision.candidates?.find(row => row.id === draw?.chosenId);
  return { access, constraints: decision.constraints || {}, category: draw?.category ?? null,
    requestedCategory: draw?.requestedCategory ?? null, conditionalProbability: draw?.conditionalProbability ?? null,
    distribution: draw?.distribution || null, fallbackReasons: draw?.fallbackReasons || [],
    selectedFeatures: selected?.features || null, selectedSources: selected?.sources || null, availability };
}

export function summarizeDiagnostics({ fixture, candidates, trace, history, now }) {
  const hard = new Set(candidates.map(item => item.id));
  const selected = new Set(trace.map(row => row.itemId));
  const independent = new Set(trace.filter(row => row.outcome.evidence === 'independent').map(row => row.itemId));
  const admitted = new Set(), restrictions = new Map(), perItem = new Map(candidates.map(item => [item.id,
    { id: item.id, difficulty: item.difficulty, complexity: item.complexity, position: (item.difficulty - 1) * 100 + item.complexity,
      category: item.category || 'not-authored', admittedSlots: 0, selected: 0, independentAssessments: 0 }]));
  const featureAvailability = {}, fallbacks = {}, selectedSources = {}, actionMix = { exposure: 0, assisted: 0, independent: 0 };
  let measured = 0, stallStart = null, previousFrontier = null, longestStallDays = 0;
  const sizes = [], remainingSizes = [], hardSizes = [];
  for (const row of trace) {
    actionMix[row.outcome.evidence]++;
    perItem.get(row.itemId).selected++;
    if (row.outcome.evidence === 'independent') perItem.get(row.itemId).independentAssessments++;
    const decision = row.decision;
    if (!decision) continue;
    for (const reason of decision.fallbackReasons) fallbacks[reason] = (fallbacks[reason] || 0) + 1;
    for (const [feature, value] of Object.entries(decision.availability)) {
      const counts = featureAvailability[feature] ||= { available: 0, total: 0 };
      counts.available += value.available; counts.total += value.total;
    }
    for (const [feature, source] of Object.entries(decision.selectedSources || {})) {
      const key = `${feature}:${source}`;
      selectedSources[key] = (selectedSources[key] || 0) + 1;
    }
    const access = decision.access;
    if (access) {
      measured++; sizes.push(access.availableIds.length); remainingSizes.push(access.hardRemainingIds.length); hardSizes.push(access.hardEligibleIds.length);
      for (const id of access.availableIds) { admitted.add(id); perItem.get(id).admittedSlots++; }
      for (const restriction of access.restrictions || []) {
        const key = `${restriction.kind}:${restriction.name}`;
        const aggregate = restrictions.get(key) || { name: restriction.name, kind: restriction.kind, slots: 0, excludedItemSlots: 0, ids: new Set() };
        aggregate.slots++; aggregate.excludedItemSlots += restriction.excludedIds.length;
        restriction.excludedIds.forEach(id => aggregate.ids.add(id)); restrictions.set(key, aggregate);
      }
    }
    const frontier = decision.constraints.frontier;
    const beyond = finite(frontier) && candidates.some(item => (item.difficulty - 1) * 100 + item.complexity > frontier);
    if (beyond && frontier === previousFrontier) longestStallDays = Math.max(longestStallDays, (row.now - stallStart) / DAY);
    else stallStart = beyond ? row.now : null;
    previousFrontier = beyond ? frontier : null;
  }
  const finalEvidence = evidenceDiagnostics(history, now);
  const groups = key => [...new Set([...perItem.values()].map(item => item[key]))].map(value => {
    const rows = [...perItem.values()].filter(item => item[key] === value);
    return { value, eligible: rows.length, admitted: measured ? rows.filter(row => row.admittedSlots > 0).length : null,
      selected: rows.filter(row => row.selected > 0).length, independentlyAssessed: rows.filter(row => row.independentAssessments > 0).length };
  });
  const diagnostics = {
    denominator: 'Distinct authored playable assessment-item IDs in this one bank; not English documents or answer-equivalence groups.',
    measuredAccessTurns: measured,
    neverHardEligibleIds: fixture.items.filter(item => !hard.has(item.id)).map(item => item.id),
    hardEligibleNeverAdmittedIds: measured === trace.length ? candidates.filter(item => !admitted.has(item.id)).map(item => item.id) : null,
    admittedNeverSelectedIds: measured === trace.length ? [...admitted].filter(id => !selected.has(id)) : null,
    selectedNotIndependentlyAssessedIds: [...selected].filter(id => !independent.has(id)),
    perItem: [...perItem.values()], byDifficulty: groups('difficulty'), byCategory: groups('category'),
    restrictions: [...restrictions.values()].map(({ ids, ...row }) => ({ ...row, uniqueExcludedIds: [...ids] })),
    restrictionWarning: 'Restriction labels overlap; excluded counts must not be added. Availability is actual positive per-slot support.',
    featureAvailability, selectedFeatureSources: selectedSources, fallbackCounts: fallbacks, actionMix,
    finalEvidence, assessmentUnitsPerInteraction: 1,
    calendar: { practiceDays: new Set(trace.map(row => Math.floor(row.now / DAY))).size,
      start: new Date(trace[0].now).toISOString(), finalInteraction: new Date(now).toISOString(),
      elapsedDays: (now - trace[0].now) / DAY, probeAnchor: 'Final interaction plus configured no-practice delay' }
  };
  const metrics = {
    exposureCoverage: selected.size / hard.size, independentAssessmentCoverage: independent.size / hard.size,
    unassessedAttention: mean(trace.map(row => Number(row.unassessedBefore))),
    exposureShare: actionMix.exposure / trace.length, assistedShare: actionMix.assisted / trace.length,
    independentShare: actionMix.independent / trace.length,
    assessedItemsPerInteraction: (actionMix.assisted + actionMix.independent) / trace.length,
    finalReviewBacklog: finalEvidence.dueItems, meanReviewBacklog: mean(trace.map(row => row.evidenceBefore.dueItems)),
    meanHardEligibleCount: mean(hardSizes), meanHardRemainingCount: mean(remainingSizes), meanAvailableCount: mean(sizes),
    admissionCoverage: measured === trace.length ? admitted.size / hard.size : null,
    longestUnchangedFrontierDays: measured ? longestStallDays : null,
    recallFeatureAvailability: featureAvailability.weakness?.total ? featureAvailability.weakness.available / featureAvailability.weakness.total : null,
    maximumPracticeDays: finalEvidence.maximumPracticeDays, maximumIndependentDays: finalEvidence.maximumIndependentDays,
    maximumSpacedSuccesses: finalEvidence.maximumSpacedSuccesses
  };
  return { diagnostics, metrics };
}
