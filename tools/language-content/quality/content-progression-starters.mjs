import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { loadProgressionCatalogs, repositoryRoot } from './content-progression-catalogs.mjs';

const apply = process.argv.includes('--apply');
const identity = value => value.normalize('NFC').toLowerCase().replace(/\p{P}/gu, '').replace(/\s+/gu, ' ').trim();
function verifyCanonicalMain() {
  const git = (...args) => execFileSync('git', args, { cwd: repositoryRoot, encoding: 'utf8' }).trim();
  assert.equal(path.resolve(repositoryRoot), '/workspace');
  assert.equal(path.resolve(git('rev-parse', '--show-toplevel')), '/workspace');
  assert.equal(git('branch', '--show-current'), 'main');
  assert.equal(git('for-each-ref', '--format=%(refname)', 'refs/heads'), 'refs/heads/main');
  assert.ok(git('for-each-ref', '--format=%(refname)', 'refs/remotes').split('\n').filter(Boolean).every(ref => /\/(main|HEAD)$/u.test(ref)));
}
async function save(catalog, original) {
  if (!apply) return;
  verifyCanonicalMain();
  const destination = path.join(repositoryRoot, catalog.path);
  assert.equal(await readFile(destination, 'utf8'), original, `${catalog.path}: concurrent edit`);
  await writeFile(destination, JSON.stringify(catalog.document, null, 2) + '\n');
}
const greetings = new Set(['ww.greeting.hello', 'ww.greeting.thanks', 'ww.greeting.goodbye', 'ww.politeness.welcome', 'ww.identity.your-name']);
const czech = new Set(['ww-cp-000001','ww-cp-000026','ww-cp-000027','ww-cp-000077','ww-cp-000079','ww-cp-000082','ww-cp-000104','ww-cp-000105','ww-cp-000115','ww-cp-000220']);
for (const catalog of await loadProgressionCatalogs()) {
  const original = await readFile(path.join(repositoryRoot, catalog.path), 'utf8');
  const changes = [];
  if (catalog.game === 'sound-quasar') {
    const source = JSON.parse(await readFile(path.join(repositoryRoot, `apps/languages/${catalog.course.directoryName}/content/word-world/content.json`), 'utf8'));
    const candidates = source.records.filter(record => record.id.startsWith(`ww-${catalog.course.id}-starter260911-`)
      || (catalog.course.id === 'cz' ? czech : greetings).has(record.id));
    const targets = new Set(catalog.document.sentences.map(item => identity(item.target)));
    const sourceIds = new Set(catalog.document.sentences.map(item => item.sourceId));
    for (const record of candidates) {
      if (catalog.course.id === 'es-en' && record.id === 'ww-es-en-starter260911-name') {
        const previous = catalog.document.sentences.find(item => item.sourceId === 'ww.identity.your-name');
        if (previous) {
          assert.equal(previous.target, record.targetText);
          assert.equal(previous.meaning, record.learnerBase.text);
          const oldReference = previous.sourceId;
          previous.sourceId = record.id; previous.difficulty = 1;
          previous.usefulness = record.usefulness; previous.complexity = record.complexity;
          previous.objectiveId = 'es-en.sounds.starter'; previous.revision = String(Number(previous.revision) + 1);
          catalog.document.sentenceProvenance.sourceItemIds = catalog.document.sentenceProvenance.sourceItemIds.map(id => id === oldReference ? record.id : id);
          sourceIds.delete(oldReference); sourceIds.add(record.id); changes.push(`relinked-and-regraded:${previous.id}`);
        }
      }
      if (targets.has(identity(record.targetText)) || sourceIds.has(record.id)) continue;
      const item = {
        id: `${catalog.course.id}-starter-listening-${record.id.replace(/^ww[-.]/u, '')}`,
        difficulty: record.difficulty, usefulness: record.usefulness, complexity: record.complexity,
        revision: '1', target: record.targetText,
        meaning: record.learnerBase?.text || record.englishText,
        englishAuditText: record.englishText,
        sourceId: record.id, sourceReviewStatus: record.annotations?.review?.status || source.metadata.target?.review?.status || 'native-review-required'
      };
      if (catalog.course.id === 'es-en') Object.assign(item, {
        objectiveId: 'es-en.sounds.starter', phase: record.id.endsWith('-no-thanks') ? 'transfer' : 'practice',
        context: 'Escucha una frase breve de una conversación cotidiana y elige su significado.',
        explanation: `La frase «${record.targetText}» significa «${record.learnerBase.text}».`, graded: true
      });
      if (catalog.course.id === 'zh') {
        item.reading = { system: 'pinyin', status: 'machine-assisted-preview',
          sourcePath: 'apps/languages/mandarin-simplified/static/data/games/word-world/reading-guides.json', sourceId: record.id,
          tokens: record.tokens.map(token => ({ surface: token.surface, units: token.readingUnits.map(unit => ({ surface: unit.surface, notation: unit.pronunciation.notation })) })) };
      }
      catalog.document.sentences.push(item);
      catalog.document.sentenceProvenance.sourceItemIds.push(record.id);
      targets.add(identity(item.target)); sourceIds.add(record.id); changes.push(item.id);
    }
    if (catalog.course.id === 'es-en') {
      if (!catalog.document.curriculum.objectives.some(item => item.id === 'es-en.sounds.starter')) {
        catalog.document.curriculum.objectives.unshift({ id: 'es-en.sounds.starter', difficulty: 1,
          label: 'Comprender saludos y necesidades básicas en frases breves' });
      }
      const greetingSources = new Set(['ww.greeting.hello','ww.greeting.thanks','ww.greeting.goodbye','ww.politeness.welcome']);
      for (const item of catalog.document.sentences.filter(row => greetingSources.has(row.sourceId))) {
        if (item.difficulty === 1 && item.objectiveId === 'es-en.sounds.starter') continue;
        item.difficulty = 1; item.usefulness = 94; item.complexity = 7;
        item.objectiveId = 'es-en.sounds.starter';
        item.revision = String(Number(item.revision) + 1);
        changes.push(`regraded:${item.id}`);
      }
    }
  } else if (catalog.game === 'grammar-gravity' && catalog.course.id === 'nb') {
    const challenge = catalog.document.challenges.find(row => row.id === 'nb.grammar.stor');
    assert.ok(challenge);
    const examples = [
      ['common-singular', 'en stor hund', 'a big dog', 'en ', ' hund', 'hund', 'dog'],
      ['neuter-singular', 'et stort hus', 'a big house', 'et ', ' hus', 'hus', 'house'],
      ['common-plural', 'store hunder', 'big dogs', '', ' hunder', 'hunder', 'dogs'],
      ['neuter-plural', 'store hus', 'big houses', '', ' hus', 'hus', 'houses']
    ];
    for (const [axis, targetText, english, beforeText, afterText, nounTarget, nounEnglish] of examples) {
      const form = challenge.forms[axis], id = `nb.grammar.stor.starter260911.${axis}`;
      if (form.examples.some(item => item.id === id)) continue;
      assert.equal(beforeText + form.displayForm + afterText, targetText);
      form.examples.unshift({ id, revision: 1, usefulness: 77, complexity: 18,
        learnerBaseText: english, englishAuditText: english, targetText,
        slot: { beforeText, afterText },
        anchor: { targetText: nounTarget, learnerBaseText: nounEnglish, englishAuditText: nounEnglish } });
      changes.push(id);
    }
  }
  if (changes.length) {
    if (typeof catalog.document.contentRevision === 'number') catalog.document.contentRevision += 1;
    else catalog.document.contentRevision = 'content-progression-starters-1';
    await save(catalog, original);
    console.log(JSON.stringify({ course: catalog.course.id, game: catalog.game, added: changes.length, ids: changes }));
  }
}
