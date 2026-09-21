// Controlled software probes, shared by tests and the existing manual evaluators.
// Synthetic vectors exercise accounting only; they are never semantic findings.
import { createPracticeCompass, projectPracticeCompass, sharedPracticeAxes } from '../../../apps/language-runtime/static/source/practice-compass.mjs';
import { capturedLearning, inspectionProfile } from './mapping-audit.mjs';

const unit = () => Float32Array.from({ length: 384 }, (_, i) => i === 0 ? 1 : 0);
export function mappingFixture(count, options = {}) {
  const course = { id: 'fixture', sourceLanguage: { id: 'en' }, routePrefix: '/fixture',
    gameContent: { 'word-net': { wordWorldManifest: 'data/games/word-world/manifest.json' } } };
  const identities = Array.from({ length: count }, (_, i) => ({ courseId: 'fixture', gameId: 'word-world', bankId: 'sentences', itemId: `item-${i}` }));
  const profile = inspectionProfile('fixture', identities);
  const pack = { schemaVersion: 'caatuu-word-world-runtime-v1', records: identities.map((row, i) => ({ id: row.itemId, en: `A real fixture text number ${i}.` })) };
  const calls = [], learning = capturedLearning(profile), owner = {};
  const fetchImpl = async url => ({ ok: true, json: async () => url.includes('manifest.json')
    ? { schemaVersion: 'caatuu-word-world-runtime-manifest-v1', runtimeFile: 'content.json' } : pack });
  const encoder = async texts => { calls.push(texts.length); return texts.map(unit); };
  const settings = { course, learning, owner, fetchImpl, encoder, runtimeHref: 'https://fixture.invalid/fixture/index.html', ...options };
  return { facade: createPracticeCompass(settings), calls, profile, settings, pack, owner };
}

export async function mappingBoundaryProbes() {
  const item = { identity: { courseId: 'fixture', gameId: 'word-world', bankId: 'sentences', itemId: 'item' }, history: { exposures: 1 }, vector: [0, 1] };
  const partialAxes = Object.fromEntries(sharedPracticeAxes.slice(1).map(axis => [axis.id, [1, 0]]));
  const partial = projectPracticeCompass({ courseId: 'fixture', items: [item], axisVectors: partialAxes, diagnostics: true });
  const large = mappingFixture(4200, { maxNewTexts: 512 });
  const checkpoints = [];
  for (let pass = 0; pass < 11; pass++) {
    const first = large.calls.length;
    const projection = await large.facade.project();
    checkpoints.push({ pass: pass + 1, counts: projection.counts, pendingTexts: projection.pendingTexts,
      batches: large.calls.slice(first), maxRadius: Math.max(...projection.axes.map(axis => axis.practice || 0)) });
    if (!projection.pendingTexts) break;
  }
  const final = checkpoints.at(-1);
  return { vectorMeaning: 'controlled 384-dimensional unit vectors; software checks only',
    missingAxis: { reason: partial.unmapped[0]?.reason, status: partial.records[0].status,
      incorrectlyCalledSemanticNonmatch: partial.unmapped[0]?.reason === 'outside-shared-topics', axes: partial.axes },
    capacity: { identities: 4200, checkpoints, completed: final.pendingTexts === 0,
      maxBatch: Math.max(...large.calls), maxPass: Math.max(...checkpoints.map(row => row.batches.reduce((a, b) => a + b, 0))) } };
}
