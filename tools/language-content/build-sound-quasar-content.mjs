#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, rename, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { repositoryRoot, loadWordWorldCourses, loadWordWorldContent, readRepositoryJson, wordWorldContentPath } from './lib/word-world-course-content.mjs';
import { buildWordWorldContent } from './build-word-world-content.mjs';
import { extractCoreVerbPairs } from '../../apps/language-runtime/static/source/games/verb-nebula/verb-nebula-core.mjs';
import { validateSoundQuasarCatalog } from '../../apps/language-runtime/static/source/games/sound-quasar/sound-quasar-core.mjs';

const serialize = value => JSON.stringify(value, null, 2) + '\n';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);
const readingPath = 'apps/languages/mandarin-simplified/static/data/games/word-world/reading-guides.json';
const progression = row => ({ difficulty: row.difficulty, usefulness: row.usefulness, complexity: row.complexity });

// No translation, grading or reading inference: project only authored fields.
export function projectSoundQuasarContent(course, wordWorld, vocabulary) {
  const skipped = [];
  const verbPath = course.resources.verbNebulaCatalog.path;
  const sentencePath = course.publication.runtime ?? course.publication.runtimeProjection.targetRealizationsRuntime;
  const byId = new Map(vocabulary.map(row => [row.id, row]));
  const items = extractCoreVerbPairs(vocabulary, { learnerBaseLanguage: course.sourceLanguage.locale }).map(pair => {
    const source = byId.get(pair.id);
    assert.ok(source, `${course.id}: vocabulary needs stable source IDs`);
    const reading = source.reading ? { ...structuredClone(source.reading), sourcePath: verbPath, sourceId: pair.id } : undefined;
    const item = { id: `${course.id}.sound.word.${pair.id}`, revision: `source-${hash([pair, reading])}`,
      target: pair.target, meaning: pair.source, englishAuditText: pair.englishAuditText,
      sourceId: pair.id, sourceReviewStatus: source.reviewStatus ?? 'not-declared', ...progression(pair),
      ...(reading ? { reading } : {}) };
    return item;
  }).filter(row => {
    if (row.target.length <= 80 && !/[\/|]/u.test(row.target)) return true;
    skipped.push({ sourceId: row.sourceId, reason: 'outside listening word text contract' });
    return false;
  });
  const identities = new Set();
  const sentences = wordWorld.records.filter(row => row.reviewStatus !== 'untranslated').flatMap(row => {
    const target = row.targetText;
    const key = `${row.difficulty === 0 ? 'zero:' : ''}${target.normalize('NFC').replace(/\p{P}/gu, '').toLocaleLowerCase(course.targetLanguage.locale).replace(/\s+/gu, ' ').trim()}`;
    if (target.length > 240 || /[\/|]/u.test(target) || identities.has(key)) {
      skipped.push({ sourceId: row.id, reason: identities.has(key) ? 'duplicate spoken sentence' : 'outside listening sentence text contract' });
      return [];
    }
    identities.add(key);
    const hasReadings = row.tokens.some(token => token.readingUnits?.length);
    const reading = hasReadings ? { system: row.pronunciation?.system, status: 'machine-assisted-preview',
      sourcePath: readingPath, sourceId: row.id,
      tokens: row.tokens.map(token => ({ surface: token.surface, units: token.readingUnits.map(unit => ({
        surface: unit.surface, notation: unit.pronunciation.notation })) })) } : undefined;
    const meaning = course.sourceLanguage.id === 'en' ? row.englishText : row.learnerBase?.text;
    assert.ok(meaning, `${row.id}: missing learner-base sentence`);
    const item = { id: `${course.id}.sound.sentence.${row.id}`, revision: `source-${hash([target, meaning, row.englishText, progression(row), reading])}`,
      target, meaning, englishAuditText: row.englishText, sourceId: row.id,
      sourceReviewStatus: row.reviewStatus ?? row.annotations?.review?.status ?? wordWorld.metadata?.target?.review?.status ?? 'not-declared', ...progression(row),
      ...(reading ? { reading } : {}) };
    return [item];
  });
  const selection = 'Deterministic playable source projection; untranslated rows excluded; duplicate spoken sentences and unsupported lengths reported by the builder.';
  const document = { schemaVersion: 1, gameId: 'sound-quasar', courseId: course.id,
    targetLanguageId: course.targetLanguage.id, learnerBaseLanguage: course.sourceLanguage.locale, auditLanguage: 'en',
    id: `${course.id}-sound-quasar-authored-content`, contentRevision: `sources-${hash([items, sentences])}`,
    mode: 'practice', audio: { kind: 'device-speech', locale: course.targetLanguage.speechLocale, reviewStatus: 'unreviewed', purpose: 'listening-practice' },
    provenance: { sourcePath: verbPath, sourceItemIds: items.map(row => row.sourceId), selection }, items,
    sentenceProvenance: { sourcePath: sentencePath, englishSourcePath: course.publication.concepts ?? sentencePath,
      sourceItemIds: sentences.map(row => row.sourceId), selection }, sentences };
  validateSoundQuasarCatalog(document, { courseId: course.id, targetLanguageId: course.targetLanguage.id, learnerBaseLanguage: course.sourceLanguage.locale });
  for (const [name, rows] of [['words', items], ['sentences', sentences]]) for (const difficulty of [0, 1, 2, 3]) {
    assert.ok(rows.filter(row => row.difficulty === difficulty).length >= 8,
      `${course.id}: ${name} difficulty ${difficulty} needs eight distinct choices before publication`);
  }
  return { document, skipped };
}

export async function buildSoundQuasarContent({ root = repositoryRoot, courseId, check = false } = {}) {
  const courses = (await loadWordWorldCourses({ root })).filter(({ course }) =>
    (!courseId || course.id === courseId) && course.games.includes('sound-quasar'));
  assert.ok(courses.length, 'No Sounds Quasar course selected');
  const plans = [];
  const inputSnapshots = new Map();
  // Capture before validating publication so a concurrent edit cannot become
  // the accepted input baseline after the old runtime was checked.
  for (const { course, manifestPath } of courses) {
    for (const file of [manifestPath, wordWorldContentPath(course), course.resources.verbNebulaCatalog.path]) {
      inputSnapshots.set(file, await readFile(path.resolve(root, file), 'utf8'));
    }
  }
  // A listening catalog may never claim provenance from stale published sentences.
  const wordWorld = await buildWordWorldContent({ root, courseId, check: true, allowPartial: true });
  assert.equal(wordWorld.changes.length, 0, 'Publish the authored Word Net subset before rebuilding Sounds Quasar.');
  for (const { course } of courses) {
    const { document: source } = await loadWordWorldContent(course, { root });
    const vocabulary = await readRepositoryJson(root, course.resources.verbNebulaCatalog.path);
    const { document, skipped } = projectSoundQuasarContent(course, source, vocabulary);
    const file = course.resources.soundQuasarCatalog.path;
    // The confined reader rejects escaped and symlinked destinations.
    await readRepositoryJson(root, file);
    const destination = path.resolve(await realpath(root), file);
    const before = await readFile(destination, 'utf8'), after = serialize(document);
    plans.push({ courseId: course.id, file, destination, before, after, skipped,
      words: document.items.length, sentences: document.sentences.length, changed: before !== after });
  }
  for (const [file, before] of inputSnapshots) assert.equal(await readFile(path.resolve(root, file), 'utf8'), before,
    `${file}: authored input changed while planning`);
  for (const plan of plans) assert.equal(await readFile(plan.destination, 'utf8'), plan.before, `${plan.courseId}: source changed while planning`);
  if (!check) for (const plan of plans.filter(plan => plan.changed)) {
    const temporary = `${plan.destination}.tmp-${process.pid}`;
    await writeFile(temporary, plan.after, { flag: 'wx' });
    await rename(temporary, plan.destination);
  }
  return plans.map(({ destination, before, after, ...report }) => report);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = {};
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg === '--all') continue;
    if (arg === '--check') options.check = true;
    else if (arg === '--course') { options.courseId = process.argv[++i]; assert.ok(options.courseId); }
    else throw new Error(`Unknown argument ${arg}`);
  }
  try {
    const report = await buildSoundQuasarContent(options);
    console.log(JSON.stringify(report, null, 2));
    if (options.check && report.some(row => row.changed)) process.exitCode = 1;
  } catch (error) { console.error(error.stack ?? error); process.exitCode = 1; }
}
