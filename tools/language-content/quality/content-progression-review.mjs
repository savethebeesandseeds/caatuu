import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadProgressionCatalogs, progressionRecords, progressionSummary, repositoryRoot } from './content-progression-catalogs.mjs';
import { proposeProgression, englishAuditText } from './content-progression-rubric.mjs';

const FIELDS = ['usefulness', 'complexity'];
const LEGACY = ['urgency', 'subdifficulty'];
export function verifyCanonicalMain() {
  const git = (...args) => execFileSync('git', args, { cwd: repositoryRoot, encoding: 'utf8' }).trim();
  assert.equal(git('branch', '--show-current'), 'main');
  assert.deepEqual(git('for-each-ref', '--format=%(refname)', 'refs/heads').split('\n'), ['refs/heads/main']);
  const remote = git('for-each-ref', '--format=%(refname)', 'refs/remotes').split('\n').filter(Boolean);
  assert.ok(remote.every(ref => /\/(main|HEAD)$/u.test(ref)), `Non-main remote branches: ${remote.join(', ')}`);
  assert.equal(path.resolve(git('rev-parse', '--show-toplevel')), path.resolve(repositoryRoot));
  assert.equal(path.resolve(repositoryRoot), '/workspace', 'Run the migration in the established canonical container mount');
}
export function stripProgression(value) {
  return Array.isArray(value) ? value.map(stripProgression) : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).filter(([key]) => ![...FIELDS, ...LEGACY].includes(key)).map(([key, child]) => [key, stripProgression(child)])) : value;
}
export function matchingListeningSource(record, sources) {
  const linked = sources?.[record.kind]?.get(record.item.sourceId);
  return linked && !record.item.sourceKind
    && (linked.targetText || linked.target || linked.cs) === record.item.target
    && englishAuditText(linked) === record.item.englishAuditText ? linked : null;
}
export function migrateProgressionRecord(record, { courseId = '', regrade = false, linked = null } = {}) {
  const proposed = proposeProgression({ ...record, courseId });
  const existing = Object.fromEntries(FIELDS.map(key => [key, Object.hasOwn(record.item, key)]));
  for (const field of FIELDS) {
    if (!regrade && existing[field]) {
      assert.ok(Number.isInteger(record.item[field]) && record.item[field] >= 1 && record.item[field] <= 100,
        `${record.location}: invalid existing ${field}; correct it explicitly`);
    } else record.item[field] = proposed[field];
  }
  if (linked) {
    if (regrade || !existing.usefulness) record.item.usefulness = linked.usefulness;
    if ((regrade || !existing.complexity) && linked.difficulty === record.item.difficulty && !record.item.contrastGroupId) record.item.complexity = linked.complexity;
  }
  for (const field of LEGACY) delete record.item[field];
  return proposed.reason;
}
export function refinementSummary(decisions) {
  return Object.fromEntries(LEGACY.map((oldField, index) => [oldField, Object.fromEntries([1, 2, 3, 4, 5].map(oldValue => {
    const values = decisions.filter(row => row.before[oldField] === oldValue).map(row => row[FIELDS[index]]);
    return [oldValue, { records: values.length, distinct: new Set(values).size,
      min: values.length ? Math.min(...values) : null, max: values.length ? Math.max(...values) : null }];
  }))]));
}
export async function reviewProgressionCatalogs({ apply = false, regrade = false, alignListening = false, decisions = false } = {}) {
  const catalogs = await loadProgressionCatalogs(), report = [];
  for (const catalog of catalogs) {
    const file = path.join(repositoryRoot, catalog.path);
    const beforeBytes = await readFile(file, 'utf8'), before = JSON.parse(beforeBytes);
    let sources;
    if (catalog.game === 'sound-quasar' && alignListening) {
      const vocabulary = catalogs.find(row => row.course.id === catalog.course.id && row.game === 'verb-nebula').document;
      const sentences = catalogs.find(row => row.course.id === catalog.course.id && row.game === 'word-world').document;
      sources = {
        'listening-word': new Map(vocabulary.map((item, index) => [item.id || `/${index}`, item])),
        'listening-sentence': new Map(sentences.records.map(item => [item.id, item]))
      };
    }
    const reviewed = [];
    let aligned = 0;
    for (const record of progressionRecords(catalog.game, catalog.document)) {
      const previous = Object.fromEntries([...LEGACY, ...FIELDS].filter(key => Object.hasOwn(record.item, key)).map(key => [key, record.item[key]]));
      const linked = matchingListeningSource(record, sources);
      const reason = migrateProgressionRecord(record, { courseId: catalog.course.id, regrade, linked });
      if (linked) {
        assert.equal(record.item.usefulness, linked.usefulness, `${catalog.path} ${record.location}: linked usefulness drift`);
        if (linked.difficulty === record.item.difficulty && !record.item.contrastGroupId) assert.equal(record.item.complexity, linked.complexity, `${catalog.path} ${record.location}: linked complexity drift`);
        aligned += 1;
      }
      reviewed.push({ location: record.location, id: record.item.id || record.item.verb || record.item.noun || null,
        english: englishAuditText(record.item), target: record.item.targetText || record.item.target || record.item.cs || record.item.form || null,
        difficulty: record.item.difficulty ?? record.parent?.difficulty ?? null, before: previous,
        usefulness: record.item.usefulness, complexity: record.item.complexity, reason, aligned: Boolean(linked) });
    }
    assert.deepEqual(stripProgression(catalog.document), stripProgression(before), `${catalog.path}: retained data changed`);
    const summary = { course: catalog.course.id, game: catalog.game, path: catalog.path,
      ...progressionSummary(catalog.game, catalog.document), aligned, refinement: refinementSummary(reviewed) };
    const output = JSON.stringify(catalog.document, null, 2) + '\n';
    if (apply && output !== beforeBytes) {
      verifyCanonicalMain();
      assert.equal(await readFile(file, 'utf8'), beforeBytes, `${catalog.path}: concurrent edit; retry after coordination`);
      for (let attempt = 0; ; attempt += 1) {
        try { await writeFile(file, output); break; }
        catch (error) {
          // Docker Desktop can briefly reject opening an intact bind-mounted
          // file. Retry only that failure, never a changed or truncated file.
          if (error.code !== 'EINVAL' || attempt >= 2) throw error;
          await new Promise(resolve => setTimeout(resolve, 250));
          verifyCanonicalMain();
          assert.equal(await readFile(file, 'utf8'), beforeBytes, `${catalog.path}: changed during write retry`);
        }
      }
    }
    report.push(decisions ? { ...summary, decisions: reviewed } : summary);
  }
  return report;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await reviewProgressionCatalogs({
    apply: process.argv.includes('--apply'), regrade: process.argv.includes('--regrade'),
    alignListening: process.argv.includes('--align-listening'), decisions: process.argv.includes('--decisions')
  }), null, 2));
}
