import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { Script } from 'node:vm';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const sourcePath = 'apps/languages/mandarin-simplified/content/word-world/content.json';
const catalogPath = 'apps/languages/mandarin-simplified/static/data/games/naturalization-nucleus/content.json';
const englishOnly = value => typeof value === 'string' && /^[\p{Script=Latin}\p{M}\p{P}\p{N}\p{Zs}]+$/u.test(value.trim());
const notation = units => units.map(unit => unit.pronunciation.notation.normalize('NFC')).join(' ');
const exactReading = (unit, challenge) => unit.surface === challenge.hanzi
  && unit.pronunciation?.notation?.normalize('NFC') === challenge.pinyin.normalize('NFC');

/** Project only declared word/sentence readings and English meanings. No glyph lookup. */
export function projectMandarinNucleusContexts(catalog, source) {
  if (catalog.courseId !== 'zh' || catalog.schemaVersion !== 1 || source.courseId !== 'zh') {
    throw new Error('Context projection requires the existing Mandarin Nucleus and Word World authorities.');
  }
  const records = new Map(source.records.map(record => [record.id, record]));
  return { ...catalog, challenges: catalog.challenges.map(challenge => {
    const compounds = [], sentences = [];
    for (const sourceConceptId of challenge.sourceConceptIds) {
      const record = records.get(sourceConceptId);
      if (!record) throw new Error(`${challenge.id} cites missing source ${sourceConceptId}.`);
      if (record.difficulty > challenge.difficulty) continue;
      const units = record.tokens.flatMap(token => token.readingUnits || []);
      if (!units.some(unit => exactReading(unit, challenge))) continue;
      sentences.push({ text: record.targetText, notation: notation(units), meaning: record.englishText, sourceConceptId });
      for (const token of record.tokens) {
        if (Array.from(token.surface).length <= 1 || !token.readingUnits?.some(unit => exactReading(unit, challenge))) continue;
        compounds.push({ text: token.surface, notation: notation(token.readingUnits), meaning: token.gloss, sourceConceptId });
      }
    }
    const context = compounds.sort((first, second) => Array.from(first.text).length - Array.from(second.text).length)[0] || sentences[0];
    if (!context || !englishOnly(context.meaning)) {
      throw new Error(`${challenge.id} has no declared matching context with an English meaning.`);
    }
    const englishAuditText = englishOnly(challenge.englishAuditText) ? challenge.englishAuditText
      : englishOnly(challenge.translation) ? challenge.translation : context.meaning;
    return { ...challenge, englishAuditText, context };
  }) };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--write')) throw new Error('Usage: node tools/language-content/project-mandarin-nucleus-contexts.mjs [--write]');
  const read = async relative => JSON.parse(await readFile(path.join(repositoryRoot, relative), 'utf8'));
  const [catalog, source] = await Promise.all([read(catalogPath), read(sourcePath)]);
  const projection = projectMandarinNucleusContexts(catalog, source);
  const sandbox = { window: {} };
  new Script(await readFile(path.join(repositoryRoot,
    'apps/language-runtime/static/source/games/naturalization-nucleus/naturalization-nucleus.js'), 'utf8')).runInNewContext(sandbox);
  sandbox.window.CaatuuNaturalizationNucleus.validateCatalog(projection);
  const bytes = JSON.stringify(projection, null, 2) + '\n';
  if (args.includes('--write')) {
    // The maintained container workflow runs in the canonical /workspace bind.
    if (process.platform === 'win32' || path.resolve(process.cwd()) !== path.resolve(repositoryRoot)) {
      throw new Error('Write contexts only from the canonical repository development container.');
    }
    const git = args => execFileSync('git', args, { cwd: repositoryRoot, encoding: 'utf8' }).trim();
    const refs = git(['for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/remotes']).split('\n');
    if (git(['branch', '--show-current']) !== 'main'
      || refs.filter(ref => ref.startsWith('refs/heads/')).join(',') !== 'refs/heads/main'
      || refs.some(ref => ref.startsWith('refs/remotes/') && !/\/(?:main|HEAD)$/u.test(ref))) {
      throw new Error('The canonical main-only mutation guard failed.');
    }
    await writeFile(path.join(repositoryRoot, catalogPath), bytes);
  }
  console.log(JSON.stringify({ challenges: projection.challenges.length,
    compounds: projection.challenges.filter(challenge => !/[\p{P}\p{Zs}]/u.test(challenge.context.text)).length,
    englishAuditText: projection.challenges.filter(challenge => englishOnly(challenge.englishAuditText)).length,
    written: args.includes('--write') }));
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
