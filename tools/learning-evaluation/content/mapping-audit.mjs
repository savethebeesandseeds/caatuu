// Importable mode of evaluator C, not a fourth executable evaluator.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadEvaluationCorpus } from '../shared/corpus.mjs';
import { createSemanticCache, loadPinnedSemanticModel } from '../shared/semantic-cache.mjs';
import { loadMappingCourses, makeFacade, inspectionProfile, primaryPracticeIdentity, identityKey,
  replayMappingProfile, textHash, sharedPracticeAxes, projectPracticeCompass, assertSameCompleted } from '../shared/mapping-audit.mjs';
import { numericSummary, inspectMetadata } from './metrics.mjs';

const countBy = (rows, key) => rows.reduce((counts, row) => { const name = key(row); counts[name] = (counts[name] || 0) + 1; return counts; }, {});
const rounded = value => value == null ? 'unknown' : Number(value.toFixed(6));

function describeProjection(replay) {
  const rows = replay.result.records;
  const groups = new Map();
  for (const row of rows.filter(row => row.englishText)) {
    if (!groups.has(row.englishText)) groups.set(row.englishText, []);
    groups.get(row.englishText).push(row);
  }
  return { ...replay, distributions: {
    maxSimilarity: numericSummary(rows.map(row => row.maxSimilarity)),
    secondSimilarity: numericSummary(rows.map(row => row.secondSimilarity)),
    positiveTopicCounts: countBy(rows.filter(row => row.comparisonComplete), row => row.positiveTopics),
    positiveWeights: numericSummary(rows.flatMap(row => row.topics.map(topic => topic.weight).filter(weight => weight > 0))) },
  repeatedEnglish: [...groups].filter(([, values]) => values.length > 1).map(([englishText, values]) => ({ englishText,
    identities: values.map(row => row.identity), identityCount: values.length,
    weightedMass: sharedPracticeAxes.map(axis => ({ id: axis.id,
      practice: values.reduce((sum, row) => sum + (row.topics.find(topic => topic.id === axis.id)?.weight || 0), 0),
      independent: values.reduce((sum, row) => sum + (row.independentEvidence ? row.topics.find(topic => topic.id === axis.id)?.weight || 0 : 0), 0) })) })) };
}

export async function runMappingAudit({ root, options, argv, gitHead, outputDirectory, verifyWorkspace }) {
  assert.ok(options['--profiles'], '--mapping-audit requires --profiles captured.json');
  for (const key of Object.keys(options)) assert.ok(['--mapping-audit', '--profiles', '--config', '--output', '--reference'].includes(key), `Unsupported mapping option ${key}`);
  const configFile = options['--config'] || 'tools/learning-evaluation/content/mapping-config.json';
  const configBytes = await readFile(path.resolve(root, configFile));
  const config = JSON.parse(configBytes);
  assert.equal(config.schemaVersion, 1);
  assert.ok(Number.isInteger(config.perStratum) && config.perStratum >= 0 && config.perStratum <= 32);
  assert.ok(Number.isInteger(config.maxNewTexts) && config.maxNewTexts >= 7 && config.maxNewTexts <= 96);
  const captureBytes = await readFile(path.resolve(root, options['--profiles']));
  const capture = JSON.parse(captureBytes);
  assert.equal(capture.kind, 'real-browser-retained-practice');
  const courses = await loadMappingCourses(root), hashes = new Map();
  const corpus = await loadEvaluationCorpus({ root });
  const model = await loadPinnedSemanticModel({ root, individualInputs: true });
  const cache = await createSemanticCache({ root, model, batchSize: 24, directory: path.join(root, 'artifacts/learning-evaluation/content/cache') });
  const output = await outputDirectory(options['--output'] || `artifacts/learning-evaluation/content/mapping-${Date.now()}`);
  const save = (name, value) => writeFile(path.join(output, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
  const result = { schemaVersion: 1, evaluator: 'C: content, mapping audit mode', gitHead, createdAt: new Date().toISOString(),
    command: ['node', 'tools/learning-evaluation/content/run.mjs', ...argv], config, configSha256: textHash(configBytes),
    capture: { path: options['--profiles'], sha256: textHash(captureBytes), capturedAt: capture.capturedAt,
      historicalSnapshotsUnavailable: capture.historicalSnapshotsUnavailable },
    model: model.signature, axes: sharedPracticeAxes,
    projection: { cosineFloor: .3, kernelExponent: 2, saturationDenominator: 2, maxNewTexts: config.maxNewTexts, batchSize: 24 },
    metadata: inspectMetadata(corpus, { complexityGap: 30, difficultyGap: 1, exampleLimit: 10 }),
    profiles: [], inventory: [], semanticSample: [], reviewSet: [], anchorSimilarities: [], sources: [] };
  await save('configuration.json', { ...result, metadata: undefined });
  const encoder = async texts => {
    const values = await cache.embed(texts.map(englishText => ({ id: textHash(englishText), englishText })));
    assert.equal(values.skipped.length, 0); return values.rows.map(row => row.vector);
  };
  try {
    // Exact current retained histories first; no corpus exposure is mixed into them.
    for (const profile of capture.profiles) {
      const course = courses.find(course => course.manifest.id === profile.courseId);
      assert.ok(course);
      const replay = describeProjection(await replayMappingProfile({ root, course, profile, encoder, hashes, maxNewTexts: config.maxNewTexts }));
      result.profiles.push(replay);
      await save(`profile-${profile.courseId}.json`, replay);
      console.log(JSON.stringify({ phase: 'retained-profile', course: profile.courseId, ...replay.accounting }));
    }
    // Review descriptions are authored from meaning before requesting their scores.
    const reviewDocuments = config.reviewMeanings.map(review => ({ ...review,
      document: corpus.documents.find(row => row.englishText.toLowerCase() === review.english.toLowerCase()) || null }));
    await save('review-selection-before-scores.json', reviewDocuments);
    for (const course of courses) {
      const units = corpus.playableUnits.filter(unit => unit.courseId === course.manifest.id);
      const profile = inspectionProfile(course.manifest.id, units.map(primaryPracticeIdentity));
      const resolved = await makeFacade(root, course, profile, { hashes }).resolve();
      assert.equal(resolved.items.length, units.length);
      const inventory = { courseId: course.manifest.id, authoredRecords: corpus.records.filter(row => row.courseId === course.manifest.id).length,
        playableUnits: units.length, primaryIdentitiesResolved: resolved.items.length, fullResolutionFraction: 1,
        contexts: 'One primary persistence bank per playable unit; directional aliases are not expanded into this denominator.',
        resolution: countBy(resolved.items, row => row.englishIssue?.reason || row.unmappedReason || 'eligible-English'),
        uniqueEligibleEnglish: new Set(resolved.items.filter(row => !row.unmappedReason).map(row => row.text)).size,
        exclusions: resolved.items.filter(row => row.unmappedReason), strata: [] };
      const selected = [];
      const strata = new Map();
      for (const unit of units) { const key = `${unit.gameId}/${unit.kind}`; if (!strata.has(key)) strata.set(key, []); strata.get(key).push(unit); }
      for (const [key, members] of strata) {
        const chosen = members.map(unit => ({ unit, priority: textHash(`${config.seed}\0${unit.id}`) }))
          .sort((a, b) => a.priority.localeCompare(b.priority)).slice(0, config.perStratum).map(row => row.unit);
        selected.push(...chosen); inventory.strata.push({ key, inventoryUnits: members.length, selectedUnits: chosen.length });
      }
      inventory.semanticSelectedUnits = selected.length;
      inventory.semanticSelectedFraction = selected.length / units.length;
      result.inventory.push(inventory);
      await save(`inventory-${course.manifest.id}.json`, { ...inventory, items: resolved.items });
      const sample = describeProjection(await replayMappingProfile({ root, course, encoder, hashes, maxNewTexts: config.maxNewTexts,
        profile: inspectionProfile(course.manifest.id, selected.map(primaryPracticeIdentity)) }));
      result.semanticSample.push(sample);
      await save(`sample-${course.manifest.id}.json`, sample);
      console.log(JSON.stringify({ phase: 'sample', course: course.manifest.id, fullInventory: units.length, ...sample.accounting }));
    }
    const anchorVectors = await encoder(sharedPracticeAxes.map(axis => axis.probe.text));
    const cosine = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0) / Math.hypot(...a) / Math.hypot(...b);
    result.anchorSimilarities = sharedPracticeAxes.map((axis, i) => ({ id: axis.id, similarities: Object.fromEntries(sharedPracticeAxes.map((other, j) => [other.id, cosine(anchorVectors[i], anchorVectors[j])])) }));
    for (const review of reviewDocuments) {
      if (!review.document) { result.reviewSet.push({ ...review, status: 'not-found-exactly-in-real-content' }); continue; }
      const [vector] = await encoder([review.document.englishText]);
      const projection = projectPracticeCompass({ courseId: 'review', diagnostics: true,
        axisVectors: Object.fromEntries(sharedPracticeAxes.map((axis, i) => [axis.id, anchorVectors[i]])),
        items: [{ identity: { courseId: 'review', gameId: 'diagnostic', bankId: 'review', itemId: review.document.id },
          text: review.document.englishText, history: { exposures: 1 }, vector }] });
      result.reviewSet.push({ ...review, status: 'completed', ...projection.records[0] });
    }
    result.runtimeBoundaries = await (await import('../shared/mapping-runtime-probes.mjs')).mappingBoundaryProbes();
    result.encoding = await (await import('../shared/mapping-encoding-probe.mjs')).inspectMappingEncoding(model);
    assert.ok(result.encoding.correctedInvariant, 'Individual-input encoding is not reproducible within tolerance');
    if (options['--reference']) {
      const bytes = await readFile(path.resolve(root, options['--reference']));
      const baseline = JSON.parse(bytes);
      assert.deepEqual(baseline.axes, result.axes);
      assert.deepEqual(baseline.projection, result.projection);
      const sameRecipe = baseline.model.recipe.version === result.model.recipe.version;
      const changes = [];
      for (const key of ['profiles', 'semanticSample']) for (const replay of result[key]) {
        const previous = baseline[key].find(row => row.courseId === replay.courseId);
        if (sameRecipe) assertSameCompleted(previous.result, replay.result);
        changes.push({ scope:key,courseId:replay.courseId,before:previous.accounting,after:replay.accounting,
          axes:replay.result.axes.map((axis,i)=>({id:axis.id,before:previous.result.axes[i],after:axis})) });
      }
      result.baselineComparison = { path: options['--reference'], sha256: textHash(bytes), identicalCountsMassesRadii: sameRecipe,
        unchangedFormulaAndAnchors:true,recipeChanged:!sameRecipe,changes,tolerance:1e-9 };
    }
    result.cache = cache.stats();
    result.sources = [...hashes].map(([path, sha256]) => ({ path, sha256 }));
    for (const file of ['apps/language-runtime/static/source/practice-compass.mjs', 'apps/language-runtime/static/source/english-image-search.mjs',
      'tools/learning-evaluation/content/mapping-audit.mjs', 'tools/learning-evaluation/shared/mapping-audit.mjs',
      'tools/learning-evaluation/shared/mapping-runtime-probes.mjs', 'tools/learning-evaluation/shared/mapping-encoding-probe.mjs', 'tools/learning-evaluation/shared/corpus.mjs']) {
      result.sources.push({ path: file, sha256: textHash(await readFile(path.join(root, file))) });
    }
    verifyWorkspace();
    await save('results.json', result);
    await writeFile(path.join(output, 'report.md'), renderMappingReport(result), { flag: 'wx' });
    console.log(JSON.stringify({ output, cache: result.cache }));
    return result;
  } finally { await cache.dispose(); }
}

export function renderMappingReport(result) {
  const lines = ['# Shared practice-topic mapping audit', '',
    'Unchanged production anchors and formula: k = clamp((cosine - 0.3) / 0.7, 0, 1)^2; radius = 1 - exp(-mass / 2). Independent mass includes retained independent errors. These are evidence masses, not ability or completion.', '',
    'Current retained records replace earlier unsaved observations; identical counts alone cannot establish historical snapshot identity. Every checkpoint counts identities, never inference attempts.', '',
    '| Profile | Identities | Matched | Zero weights | English unavailable | Identity unresolved | Pending | Vector unavailable | Weak positive |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|'];
  for (const p of result.profiles) { const s = p.accounting.statuses; lines.push(`| ${p.courseId} | ${p.accounting.denominator} | ${s.matched} | ${s.unmatched} | ${s['english-unavailable']} | ${s['identity-unresolved']} | ${s.pending} | ${s['vector-unavailable']} | ${p.accounting.weakPositive} |`); }
  lines.push('', 'Weak positive means maximum actual kernel weight below 0.01, a descriptive audit bin only.', '',
    '| Course | Authored | Playable / primary identities checked | Rejected English identities | Eligible unique English | Sampled units | Matched | Zero weights | Sample rejected |', '|---|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const row of result.inventory) { const sample = result.semanticSample.find(p => p.courseId === row.courseId); lines.push(`| ${row.courseId} | ${row.authoredRecords} | ${row.playableUnits} / ${row.primaryIdentitiesResolved} | ${row.resolution['english-input-rejected'] || 0} | ${row.uniqueEligibleEnglish} | ${row.semanticSelectedUnits} (${rounded(100 * row.semanticSelectedFraction)}%) | ${sample.accounting.statuses.matched} | ${sample.accounting.statuses.unmatched} | ${sample.accounting.statuses['english-unavailable']} |`); }
  lines.push('', 'Metadata and primary-identity resolution inspect the full inventory. Semantic findings describe only the seeded sample, saved profiles, and review examples. Full inventories were not embedded. Separate identity contributions remain separate even when English vectors are shared.', '',
    'The Node replay uses the actual runtime catalog resolvers and projection with the verified shared MiniLM engine on the established CPU backend. Browser WASM outcomes are separate observations; numerical equality between backends is not assumed.', '',
    'Per-profile JSON retains every identity, raw similarities, weights, max/second similarity, positive topic counts, repeated-English masses, axes/radii and reconciled bounded checkpoints. Inventory files retain every resolved primary identity and rejection detail. Configuration includes model/tokenizer/library hashes and source hashes.', '',
    'Review descriptions were saved before requesting their scores. They are developer diagnostic judgments, not validated educational labels.', '',
    'Historical first-response and support provenance remains lossy. Durable evidence storage is deferred.', '',
    'Run configuration and command: [results.json](results.json). Individual profile/sample/inventory files are in this directory.', '',
    '## Actual positive profile contributions', '',
    '| Course | English meaning | Max cosine | Second cosine | Positive topics | Largest weight |', '|---|---|---:|---:|---:|---:|');
  for (const p of result.profiles) for (const row of p.result.records.filter(row => row.status === 'matched')) lines.push(`| ${p.courseId} | ${row.englishText.replaceAll('|', '/')} | ${rounded(row.maxSimilarity)} | ${rounded(row.secondSimilarity)} | ${row.positiveTopics} | ${rounded(Math.max(...row.topics.map(topic => topic.weight)))} |`);
  lines.push('', '## Mass and radii', '', '| Scope | Course | Topic | Practice mass | Independent mass | Practice radius | Independent radius |', '|---|---|---|---:|---:|---:|---:|');
  for (const [scope, profiles] of [['Retained',result.profiles], ['Sample (synthetic exposures)',result.semanticSample]]) for (const p of profiles) for (const axis of p.result.axes) lines.push(`| ${scope} | ${p.courseId} | ${axis.id} | ${rounded(axis.practiceWeight)} | ${rounded(axis.independentWeight)} | ${rounded(axis.practice)} | ${rounded(axis.independent)} |`);
  lines.push('', '## Developer review examples', '', '| English | Judgment made before scores | Maximum cosine | Positive topics and weights |', '|---|---|---:|---|');
  for (const row of result.reviewSet) lines.push(`| ${row.english} | ${row.description} | ${rounded(row.maxSimilarity)} | ${(row.topics || []).filter(topic => topic.weight > 0).map(topic => `${topic.id}: ${rounded(topic.weight)}`).join(', ') || row.status} |`);
  lines.push('', '## Anchor similarities', '', '| Anchor | ' + sharedPracticeAxes.map(axis => axis.id).join(' | ') + ' |', '|---|' + sharedPracticeAxes.map(()=>'---:|').join(''));
  for (const row of result.anchorSimilarities) lines.push('| ' + row.id + ' | ' + sharedPracticeAxes.map(axis=>rounded(row.similarities[axis.id])).join(' | ') + ' |');
  if (result.baselineComparison) lines.push('', result.baselineComparison.recipeChanged
    ? 'Baseline comparison: formula and anchors are identical, but the encoding recipe now isolates each input from batch companions. Counts and radii can change for that reason; exact before/after accounting and axes are retained in results.json.'
    : 'Baseline comparison: all retained-profile and sampled identity counts, masses and radii agree within 1e-9. Formula and anchors are identical.');
  if (result.encoding) lines.push('', `Actual uncached encoding: old batch versus individual input maximum component difference ${rounded(Math.max(...result.encoding.comparisons.map(row=>row.legacyVsIndividualDelta)))}. Corrected reverse-order and partition checks: ${result.encoding.correctedInvariant ? 'passed' : 'FAILED'} within 1e-9. The cache signature distinguishes these recipes.`);
  lines.push('', '## Interpretation and recommendation', '',
    'Most inspected short meanings score below the unchanged 0.3 floor. A positive match can also be tiny after squaring: matched counts do not explain polygon size on their own. The review set includes clear meanings missed by the anchors, generic meanings reasonably left unassigned, and weak overlaps that are not necessarily useful labels.', '',
    'Retain the current constants while shipping the bounded mapping reliability/status correction. If projection quality is investigated next, compare the current long topic descriptions with one fixed alternative wording on a separately reviewed set, holding threshold and saturation fixed. Inspect inappropriate matches and missed clear examples; do not optimize assignment rate.', '',
    'Source histories are lossy summaries. Durable first-response/support evidence remains separate deferred work; this audit neither reconstructs it nor adds an event ledger.', '');
  return lines.join('\n');
}
