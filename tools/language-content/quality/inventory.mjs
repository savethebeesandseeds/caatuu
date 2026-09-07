import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractCoreVerbPairs } from '../../../apps/language-runtime/static/source/games/verb-nebula/verb-nebula-core.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const sources = new Map();
async function read(relative) {
  const bytes = await readFile(path.resolve(root, relative));
  sources.set(relative.replaceAll('\\', '/'), createHash('sha256').update(bytes).digest('hex'));
  return JSON.parse(bytes);
}
const levels = (items) => ({ ...Object.fromEntries([1, 2, 3].map(level => [level, items.filter(item => item.difficulty === level).length])),
  ungraded: items.filter(item => ![1, 2, 3].includes(item.difficulty)).length });
const countExamples = (value) => {
  if (!value || typeof value !== 'object') return 0;
  if (typeof value.targetText === 'string' && typeof value.learnerBaseText === 'string') return 1;
  return Object.values(value).reduce((total, child) => total + countExamples(child), 0);
};
const catalog = await read('apps/languages/catalog.json');
const pairs = [];
for (const entry of catalog.courses) {
  const course = await read(entry.manifest);
  const resource = async key => read(course.resources[key].path);
  for (const game of course.games) {
    if (game === 'campaign') continue; // Derived score, no independent bank.
    const base = { courseId: course.id, gameId: game };
    if (game === 'verb-lab') {
      const raw = await resource('verbNebulaCatalog');
      const playable = extractCoreVerbPairs(raw, { learnerBaseLanguage: course.sourceLanguage.locale });
      pairs.push({ ...base, rawRecords: raw.length, playablePairs: playable.length, levels: levels(playable), ids: playable.map(item => item.id) });
    } else if (game === 'word-net') {
      const manifest = await resource('wordWorldManifest');
      if (manifest.runtimeFile) {
        const runtimePath = path.posix.join(path.posix.dirname(course.resources.wordWorldManifest.path), manifest.runtimeFile.split('?')[0]);
        const bank = await read(runtimePath);
        const records = bank.records;
        pairs.push({ ...base, playableSentences: records.length, levels: levels(records), ids: records.map(item => item.id) });
      } else {
        const bank = await read(course.publication.runtimeProjection.targetRealizationsRuntime);
        const concepts = await read(course.publication.runtimeProjection.conceptsRuntime);
        const records = bank.realizations;
        pairs.push({ ...base, playableSentences: records.length, levels: levels(concepts.concepts), ids: records.map(item => item.conceptId) });
      }
    } else if (game === 'conjugation-comet') {
      const bank = await resource('conjugationCometCatalog');
      pairs.push({ ...base, paradigms: bank.verbs.length, forms: bank.verbs.reduce((sum, verb) => sum + (verb.forms?.length || Object.keys(verb.forms || {}).length), 0), levels: levels(bank.verbs),
        ...(bank.schemaVersion === undefined && bank.verbs.some(item => item.difficulty === undefined) ? { runtimeDefaultDifficulty: 1 } : {}), ids: bank.verbs.map(item => item.id || item.verb || item.infinitive) });
    } else if (game === 'case-cosmos') {
      const bank = await resource('caseCosmosCatalog');
      const legacy = Array.isArray(bank) ? bank : bank.legacyNouns;
      const authored = Array.isArray(bank) ? [] : bank.contexts;
      pairs.push({ ...base, legacyParadigms: legacy.length, authoredParadigms: bank.paradigms?.length || 0,
        contexts: legacy.reduce((sum, item) => sum + Object.keys(item.cases).length, 0) + authored.length,
        legacyLevels: levels(legacy), authoredLevels: levels(authored),
        ids: [...legacy.map(item => item.id || item.noun), ...authored.map(item => item.id)] });
    } else if (game === 'grammar-gravity') {
      const bank = await resource('grammarGravityCatalog');
      const nouns = await resource('grammarGravityNouns');
      pairs.push({ ...base, families: bank.challenges.length, bilingualExamples: countExamples(bank.challenges), nouns: nouns.items.length, nounLevels: levels(nouns.items), levels: levels(bank.challenges), ids: bank.challenges.map(item => item.id) });
    } else if (game === 'naturalization-nucleus') {
      const bank = await resource('naturalizationNucleusCatalog');
      pairs.push({ ...base, characters: bank.challenges.length, levels: levels(bank.challenges), ids: bank.challenges.map(item => item.id) });
    } else if (game === 'sound-quasar') {
      const bank = await resource('soundQuasarCatalog');
      pairs.push({ ...base, words: bank.items.length, sentences: bank.sentences.length, wordLevels: levels(bank.items), sentenceLevels: levels(bank.sentences), audioReview: bank.audio.reviewStatus, ids: [...bank.items, ...bank.sentences].map(item => item.id) });
    } else throw new Error(`Unmapped enabled game: ${course.id}/${game}`);
  }
}
if (pairs.length !== 20) throw new Error(`Benchmark has 20 independent pairs; observed ${pairs.length}. Record scope changes explicitly.`);
const result = { schemaVersion: 1, capturedAt: new Date().toISOString(), measurement: 'inventory only; no quality points', pairs, sourceSha256: Object.fromEntries(sources) };
const outputIndex = process.argv.indexOf('--output');
if (outputIndex >= 0) {
  const output = path.resolve(root, process.argv[outputIndex + 1] || '');
  const allowed = path.join(root, 'artifacts', 'language-content-quality') + path.sep;
  if (!output.startsWith(allowed)) throw new Error('Inventory output must be in artifacts/language-content-quality/.');
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  console.log(`Captured ${pairs.length} pairs and ${sources.size} source hashes: ${path.relative(root, output)}`);
  console.log(JSON.stringify(pairs.map(({ ids, ...summary }) => summary), null, 2));
} else console.log(JSON.stringify(result, null, 2));
