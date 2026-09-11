import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { wordWorldContentPath } from '../lib/word-world-course-content.mjs';

export const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const RESOURCE_GAMES = {
  verbNebulaCatalog: 'verb-nebula', conjugationCometCatalog: 'conjugation-comet',
  caseCosmosCatalog: 'case-cosmos', grammarGravityCatalog: 'grammar-gravity',
  grammarGravityNouns: 'grammar-gravity-nouns', naturalizationNucleusCatalog: 'naturalization-nucleus',
  soundQuasarCatalog: 'sound-quasar'
};
const DECLARED_GAMES = {
  campaign: [], 'word-net': ['wordWorldManifest'], 'verb-lab': ['verbNebulaCatalog'],
  'conjugation-comet': ['conjugationCometCatalog'], 'case-cosmos': ['caseCosmosCatalog'],
  'grammar-gravity': ['grammarGravityCatalog', 'grammarGravityNouns'],
  'naturalization-nucleus': ['naturalizationNucleusCatalog'], 'sound-quasar': ['soundQuasarCatalog']
};

export async function loadProgressionCatalogs(root = repositoryRoot) {
  const read = async relative => JSON.parse(await readFile(path.join(root, relative), 'utf8'));
  const catalog = await read('apps/languages/catalog.json');
  const result = [];
  for (const entry of catalog.courses) {
    const course = await read(entry.manifest);
    for (const game of course.games) {
      assert.ok(Object.hasOwn(DECLARED_GAMES, game), `${course.id}: unmapped declared game ${game}`);
      for (const resource of DECLARED_GAMES[game]) assert.equal(course.resources[resource]?.state, 'present', `${course.id}/${game}: missing ${resource}`);
    }
    for (const [resource, game] of Object.entries(RESOURCE_GAMES)) {
      const reference = course.resources[resource];
      if (reference?.state !== 'present') continue;
      result.push({ course, resource, game, path: reference.path, document: await read(reference.path) });
    }
    if (course.games.includes('word-net')) {
      const manifest = await read(course.resources.wordWorldManifest.path);
      const source = wordWorldContentPath(course);
      if (manifest.authoringFile) assert.equal(manifest.authoringFile, source, `${course.id}: unexpected Word World source owner`);
      result.push({ course, resource: 'wordWorldAuthoring', game: 'word-world', path: source, document: await read(source) });
    }
  }
  // Listening inherits matching source grades after both vocabulary and
  // sentence authorities have been processed by an explicit editorial pass.
  return result.sort((a, b) => Number(a.game === 'sound-quasar') - Number(b.game === 'sound-quasar'));
}

// Only learning records are enumerated. A token gloss, axis, curriculum
// objective, accepted alternative, provenance or review object is not a round.
// String form pools remain strings; the context selecting a form owns its grade.
export function progressionRecords(game, document) {
  const records = [];
  const add = (item, location, kind, parent = null, detail = '') => {
    assert.ok(item && typeof item === 'object' && !Array.isArray(item), `${location}: expected learning record`);
    records.push({ item, location, kind, parent, detail });
  };
  if (game === 'verb-nebula') {
    document.forEach((item, i) => add(item, `[${i}]`, 'lexeme'));
  } else if (game === 'word-world') {
    document.records.forEach((item, i) => add(item, `records[${i}]`, 'sentence'));
  } else if (game === 'conjugation-comet') {
    document.verbs.forEach((verb, i) => {
      add(verb, `verbs[${i}]`, 'conjugation');
      for (const [key, form] of Object.entries(verb.forms)) {
        add(form, `verbs[${i}].forms[${key}]`, 'conjugation-form', verb, form.id || form.label || key);
      }
    });
  } else if (game === 'case-cosmos') {
    document.legacyNouns.forEach((noun, i) => {
      add(noun, `legacyNouns[${i}]`, 'case-paradigm');
      for (const [name, context] of Object.entries(noun.cases)) {
        add(context, `legacyNouns[${i}].cases.${name}`, 'case-context', noun, name);
      }
    });
    document.paradigms.forEach((item, i) => add(item, `paradigms[${i}]`, 'case-paradigm'));
    document.contexts.forEach((item, i) => add(item, `contexts[${i}]`, 'case-context', null, item.case));
  } else if (game === 'grammar-gravity') {
    document.challenges.forEach((challenge, i) => {
      add(challenge, `challenges[${i}]`, 'agreement');
      for (const [axis, form] of Object.entries(challenge.forms)) {
        add(form, `challenges[${i}].forms.${axis}`, 'agreement-form', challenge, axis);
        form.examples.forEach((example, j) => add(example, `challenges[${i}].forms.${axis}.examples[${j}]`, 'agreement-example', challenge, axis));
      }
    });
  } else if (game === 'grammar-gravity-nouns') {
    document.items.forEach((item, i) => add(item, `items[${i}]`, 'noun'));
  } else if (game === 'sound-quasar') {
    document.items.forEach((item, i) => add(item, `items[${i}]`, 'listening-word'));
    document.sentences.forEach((item, i) => add(item, `sentences[${i}]`, 'listening-sentence'));
  } else if (game === 'naturalization-nucleus') {
    document.challenges.forEach((item, i) => add(item, `challenges[${i}]`, 'character'));
  } else throw new Error(`Unsupported game ${game}`);
  return records;
}

export function validateProgressionCatalog(game, document, label = game) {
  const rows = progressionRecords(game, document);
  for (const { item, location } of rows) {
    for (const key of ['urgency', 'subdifficulty']) assert.ok(!Object.hasOwn(item, key), `${label} ${location}: obsolete ${key}`);
    for (const key of ['usefulness', 'complexity']) {
      assert.ok(Number.isInteger(item[key]) && item[key] >= 1 && item[key] <= 100,
        `${label} ${location} ${key} must be an integer from 1 to 100`);
    }
    if (Object.hasOwn(item, 'difficulty')) assert.ok([1, 2, 3].includes(item.difficulty), `${label} ${location}: invalid badge`);
  }
  return rows;
}

export function progressionSummary(game, document) {
  const rows = validateProgressionCatalog(game, document);
  const distribution = key => Object.fromEntries(Array.from({ length: 10 }, (_, index) => {
    const low = index * 10 + 1, high = low + 9;
    return [`${low}-${high}`, rows.filter(row => row.item[key] >= low && row.item[key] <= high).length];
  }));
  return { records: rows.length,
    kinds: Object.fromEntries([...new Set(rows.map(row => row.kind))].map(kind => [kind, rows.filter(row => row.kind === kind).length])),
    usefulness: distribution('usefulness'), complexity: distribution('complexity') };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const catalogs = await loadProgressionCatalogs();
  const output = [];
  for (const catalog of catalogs) output.push({ course: catalog.course.id, game: catalog.game, path: catalog.path, ...progressionSummary(catalog.game, catalog.document) });
  console.log(JSON.stringify(output, null, 2));
}
