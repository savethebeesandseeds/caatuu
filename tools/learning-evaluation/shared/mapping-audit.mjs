import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadCourseCatalog, generateCourseProfileObject } from '../../language-packs/lib/course-contract.mjs';
import { createPracticeCompass, projectPracticeCompass, sharedPracticeAxes } from '../../../apps/language-runtime/static/source/practice-compass.mjs';

export const identityKey = i => JSON.stringify([i.courseId, i.gameId, i.bankId, i.itemId]);
export const textHash = text => createHash('sha256').update(text).digest('hex');
export const statuses = ['identity-unresolved', 'english-unavailable', 'evidence-unavailable', 'pending', 'vector-unavailable', 'unmatched', 'matched'];

export async function loadMappingCourses(root) {
  const catalog = await loadCourseCatalog({ repoRoot: pathToFileURL(`${root}/`) });
  return catalog.courses.map(({ course }) => ({ manifest: course, profile: generateCourseProfileObject(course, catalog.courses) }));
}

export function filesystemFetch(root, manifest, hashes = new Map()) {
  return async url => {
    const parsed = new URL(url);
    assert.equal(parsed.origin, 'https://mapping.invalid');
    const relative = parsed.pathname.startsWith(`${manifest.routePrefix}/`)
      ? `apps/languages/${manifest.directoryName}/static/${decodeURIComponent(parsed.pathname.slice(manifest.routePrefix.length + 1))}`
      : `apps${decodeURIComponent(parsed.pathname)}`;
    assert.ok(relative.startsWith(`apps/languages/${manifest.directoryName}/static/`) || relative.startsWith('apps/language-runtime/static/data/english-concepts/'));
    const file = path.resolve(root, relative);
    assert.ok(file.startsWith(path.resolve(root) + path.sep));
    const bytes = await readFile(file);
    const digest = textHash(bytes);
    if (hashes.has(relative)) assert.equal(hashes.get(relative), digest, `Content changed during audit: ${relative}`);
    hashes.set(relative, digest);
    return { ok: true, json: async () => JSON.parse(bytes) };
  };
}

export function capturedLearning(profile) {
  const banks = new Map(profile.banks.map(bank => [JSON.stringify([bank.gameId, bank.bankId]), bank.history]));
  const total = profile.banks.reduce((sum, bank) => sum + Object.keys(bank.history).length, 0);
  const games = [...new Set(profile.banks.map(bank => bank.gameId))].map(gameId => ({ gameId,
    banks: profile.banks.filter(bank => bank.gameId === gameId).map(bank => ({ bankId: bank.bankId })) }));
  assert.equal(new Set(profile.banks.flatMap(bank => Object.keys(bank.history).map(itemId => identityKey({ courseId: profile.courseId, ...bank, itemId })))).size, total);
  if (profile.summary) assert.equal(profile.summary.totals.encounteredItems, total, 'Captured denominator differs from retained identities');
  return { contentGeneration: () => 'audit-fixed-snapshot', practiceSummary: () => profile.summary || {
    courseId: profile.courseId, status: 'ready', games, totals: { encounteredItems: total } },
  contentHistory: (gameId, bankId) => banks.get(JSON.stringify([gameId, bankId])) || {} };
}

export function inspectionProfile(courseId, identities) {
  const banks = new Map();
  for (const identity of identities) {
    assert.equal(identity.courseId, courseId);
    const key = JSON.stringify([identity.gameId, identity.bankId]);
    if (!banks.has(key)) banks.set(key, { gameId: identity.gameId, bankId: identity.bankId, history: {} });
    banks.get(key).history[identity.itemId] = { exposures: 1, successes: 0, mistakes: 0, lastEvidence: 'exposure' };
  }
  return { courseId, syntheticEvidence: 'One exposure per inventory identity, only to inspect topic placement; not learner progress.', banks: [...banks.values()] };
}

// Inventory resource names are not persistence bank IDs. Translate the existing
// playable adapter's identity into one primary runtime context per playable unit.
// Directional aliases remain separate in real profile replay and runtime tests.
export function primaryPracticeIdentity(unit) {
  const gameId = ({ 'verb-lab': 'verb-nebula', 'word-net': 'word-world' })[unit.gameId] || unit.gameId;
  const bankId = ({ 'verb-match': 'default', sentence: 'sentences', 'conjugation-form': 'forms',
    'case-context': 'default', 'agreement-example': 'phrases-sequence', 'noun-category': 'nouns',
    'listening-word': 'words', 'listening-sentence': 'sentences', 'character-puzzle': 'default' })[unit.kind];
  assert.ok(bankId, `Unknown playable kind ${unit.kind}`);
  const itemId = unit.kind === 'conjugation-form' ? unit.itemId.replace('/', '.') : unit.itemId;
  return { courseId: unit.courseId, gameId, bankId, itemId };
}

export function makeFacade(root, course, profile, options = {}) {
  return createPracticeCompass({ course: course.profile, learning: capturedLearning(profile),
    runtimeHref: `https://mapping.invalid${course.manifest.entryPath}`, owner: {},
    fetchImpl: filesystemFetch(root, course.manifest, options.hashes), ...options });
}

export function accountProjection(projection) {
  const counts = Object.fromEntries(statuses.map(status => [status, 0]));
  const reasons = {};
  for (const row of projection.records || []) {
    assert.ok(Object.hasOwn(counts, row.status), row.status);
    counts[row.status]++;
    const reason = row.englishIssue?.reason || row.reason || row.status;
    reasons[reason] = (reasons[reason] || 0) + 1;
  }
  counts['evidence-unavailable'] += projection.unavailableIdentityCount || 0;
  assert.equal(Object.values(counts).reduce((a, b) => a + b, 0), projection.counts.encounteredItems);
  return { denominator: projection.counts.encounteredItems, statuses: counts, reasons,
    pendingTexts: projection.pendingTexts, issues: projection.issueDetails || [],
    weakPositive: (projection.records || []).filter(row => row.status === 'matched' && Math.max(...row.topics.map(t => t.weight || 0)) < .01).length };
}

/** Optional real-profile replay for evaluator A; does not import evaluator C. */
export async function replayCapturedProfiles({ root, profilesPath }) {
  const { createSemanticCache, loadPinnedSemanticModel } = await import('./semantic-cache.mjs');
  const bytes = await readFile(path.resolve(root, profilesPath));
  const captured = JSON.parse(bytes);
  assert.equal(captured.kind, 'real-browser-retained-practice');
  const courses = await loadMappingCourses(root), model = await loadPinnedSemanticModel({ root, individualInputs: true }), hashes = new Map();
  const cache = await createSemanticCache({ root, model, batchSize: 24, directory: path.join(root, 'artifacts/learning-evaluation/content/cache') });
  try {
    const profiles = [];
    const encoder = async texts => (await cache.embed(texts.map(englishText => ({ id: textHash(englishText), englishText })))).rows.map(row => row.vector);
    for (const profile of captured.profiles) profiles.push(await replayMappingProfile({ root,
      course: courses.find(course => course.manifest.id === profile.courseId), profile, encoder, hashes }));
    return { captureSha256: textHash(bytes), model: model.signature, profiles, cache: cache.stats(),
      sources: [...hashes].map(([path, sha256]) => ({ path, sha256 })) };
  } finally { await cache.dispose(); }
}

export function assertSameCompleted(left, right, tolerance = 1e-9) {
  assert.equal(left.courseId, right.courseId);
  assert.deepEqual(left.counts, right.counts);
  for (let i = 0; i < left.axes.length; i++) for (const field of ['practiceWeight', 'independentWeight', 'practice', 'independent']) {
    const a = left.axes[i][field], b = right.axes[i][field];
    if (a === null || b === null) assert.equal(a, b);
    else assert.ok(Math.abs(a - b) <= tolerance, `${left.courseId}/${left.axes[i].id}/${field}: ${a} vs ${b}`);
  }
  assert.deepEqual(left.records.map(r => [identityKey(r.identity), r.status]).sort(), right.records.map(r => [identityKey(r.identity), r.status]).sort());
}

export async function replayMappingProfile({ root, course, profile, encoder, hashes, maxNewTexts = 96, maxPasses = 256 }) {
  const calls = [];
  const facade = makeFacade(root, course, profile, { hashes, maxNewTexts, encoder: async texts => {
    calls.push({ texts: [...texts], size: texts.length }); return encoder(texts);
  } });
  const resolved = await facade.resolve();
  const checkpoints = [];
  let result, priorPending = Infinity, unchanged = 0;
  for (let pass = 0; pass < maxPasses; pass++) {
    const firstCall = calls.length;
    result = await facade.project({ diagnostics: true });
    const newCalls = calls.slice(firstCall);
    assert.ok(newCalls.every(call => call.size <= 24));
    assert.ok(newCalls.reduce((sum, call) => sum + call.size, 0) <= maxNewTexts);
    checkpoints.push({ pass: pass + 1, accounting: accountProjection(result), counts: result.counts,
      batches: newCalls.map(call => call.size), axes: result.axes });
    if (!result.pendingTexts) break;
    unchanged = result.pendingTexts === priorPending ? unchanged + 1 : 0;
    if (unchanged >= 3) break;
    priorPending = result.pendingTexts;
  }
  const firstWarmCall = calls.length;
  const warm = await facade.project({ diagnostics: true });
  if (!result.pendingTexts) { assertSameCompleted(result, warm); assert.equal(calls.length, firstWarmCall); }
  return { courseId: profile.courseId, syntheticEvidence: profile.syntheticEvidence || null,
    retainedIdentities: resolved.items.map(item => ({ ...item, history: item.history })),
    checkpoints, completed: !result.pendingTexts, result, accounting: accountProjection(result),
    warm: { additionalBatches: calls.length - firstWarmCall, identicalCompletedProjection: !result.pendingTexts },
    calls };
}

export { sharedPracticeAxes, projectPracticeCompass };
