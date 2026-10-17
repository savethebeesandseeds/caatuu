import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadMemoryMoonCatalogs, memoryMoonContentSummary, validateMemoryMoonContent } from '../lib/memory-moon-content.mjs';

const catalogs = await loadMemoryMoonCatalogs();
const clone = document => structuredClone(document);
const mutate = change => {
  const document = clone(catalogs.find(row => row.course.id === 'cz').document);
  change(document);
  return document;
};

test('every registered course owns a complete standalone Memory Moon bank with bound language roles', () => {
  assert.ok(catalogs.length > 0);
  for (const { course, document, path } of catalogs) {
    assert.equal(validateMemoryMoonContent(document, { course }), document);
    assert.equal(path, course.resources.memoryMoonCatalog.path);
    assert.ok((course.games || []).includes('memory-moon') || (course.upcomingGames || []).includes('memory-moon'));
    const summary = memoryMoonContentSummary(document);
    for (const level of [1, 2, 3]) assert.ok(summary.difficulty[level] >= 6);
    assert.ok(summary.topics.length >= 6, `${course.id}: broad semantic coverage`);
    assert.ok(summary.contrasts.length >= 6, `${course.id}: varied meaning contrasts`);
    assert.ok(summary.families > 1);
    assert.equal(summary.choices, summary.challenges * 3);
    assert.equal(summary.review, 'native-review-required');
  }
});

test('course ownership, direction and English retrieval cannot be substituted', () => {
  const { course, document } = catalogs[0];
  assert.throws(() => validateMemoryMoonContent({ ...document, courseId: 'other' }, { course }), /owning course/);
  assert.throws(() => validateMemoryMoonContent({ ...document, targetLanguage: 'other' }, { course }), /course target/);
  assert.throws(() => validateMemoryMoonContent({ ...document, learnerBaseLanguage: 'other' }, { course }), /learner base/);
  assert.throws(() => validateMemoryMoonContent(mutate(pack => { pack.embeddingPolicy.inputLanguage = 'cs'; })), /English embeddingText/);
  assert.throws(() => validateMemoryMoonContent(mutate(pack => { pack.challenges[0].embeddingText = pack.challenges[0].targetText; })), /authored English meaning/);
});

test('Spanish learner-base answers remain distinct from the English target and audit', () => {
  const { course, document } = catalogs.find(row => row.course.id === 'es-en');
  const broken = clone(document), item = broken.challenges[0];
  assert.equal(item.targetText, item.englishText);
  assert.notEqual(item.learnerBaseText, item.englishText);
  const correct = item.choices.find(choice => choice.id === item.correctChoiceId);
  assert.equal(correct.text, item.learnerBaseText);
  correct.text = item.englishText;
  assert.throws(() => validateMemoryMoonContent(broken, { course }), /learner-base translation/);
  const wrongLanguage = clone(document);
  wrongLanguage.challenges[0].choices[1].text = wrongLanguage.challenges[0].choices[1].englishAuditText;
  assert.throws(() => validateMemoryMoonContent(wrongLanguage, { course }), /non-English learner-base realization/);
});

test('catalog discovery rejects manifest traversal and fabricated course directories before reading content', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'memory-moon-catalog-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'apps/languages/czech'), { recursive: true });
  const writeCatalog = manifest => writeFile(path.join(root, 'apps/languages/catalog.json'), JSON.stringify({ courses: [{ id: 'cz', manifest }] }));
  await writeCatalog('../outside.json');
  await assert.rejects(loadMemoryMoonCatalogs({ repositoryRoot: root }), /confined repository-relative/);
  await writeCatalog('apps/languages/czech/course.json');
  await writeFile(path.join(root, 'apps/languages/czech/course.json'), JSON.stringify({ id: 'cz', directoryName: '../escape' }));
  await assert.rejects(loadMemoryMoonCatalogs({ repositoryRoot: root }), /canonical course identity/);
});

test('questions reject duplicate prompts and alternatives, including punctuation-only variations', () => {
  assert.throws(() => validateMemoryMoonContent(mutate(pack => {
    pack.challenges[1].targetText = `${pack.challenges[0].targetText.toUpperCase()} !`;
  })), /duplicates an existing prompt/);
  assert.throws(() => validateMemoryMoonContent(mutate(pack => {
    const choices = pack.challenges[0].choices;
    choices[1].text = `${choices[0].text.toUpperCase()} !`;
  })), /duplicates another visible choice/);
  assert.throws(() => validateMemoryMoonContent(mutate(pack => {
    const choices = pack.challenges[0].choices;
    choices[1].englishAuditText = choices[0].englishAuditText;
  })), /duplicates another choice meaning/);
});

test('inconsistent answers, weak attribution and another game dependency are rejected', () => {
  assert.throws(() => validateMemoryMoonContent(mutate(pack => { pack.challenges[0].correctChoiceId = 'absent'; })), /authored learner-base translation/);
  assert.throws(() => validateMemoryMoonContent(mutate(pack => { delete pack.challenges[0].choices[1].contrast; })), /changed meaning/);
  assert.throws(() => validateMemoryMoonContent(mutate(pack => { pack.challenges[0].sourceReference = { gameId: 'word-world' }; })), /own its learning content/);
  assert.throws(() => validateMemoryMoonContent(mutate(pack => { pack.challenges[1].id = pack.challenges[0].id; })), /unique course-scoped/);
});

test('selected difficulty has enough unique questions and full progression metadata', () => {
  assert.throws(() => validateMemoryMoonContent(mutate(pack => { pack.challenges = pack.challenges.filter(item => item.difficulty !== 3); })), /difficulty 3/);
  for (const key of ['complexity', 'usefulness']) assert.throws(() => validateMemoryMoonContent(mutate(pack => {
    delete pack.challenges[0][key];
  })), /authored integer/);
  assert.throws(() => validateMemoryMoonContent(mutate(pack => { pack.challenges[0].difficulty = 4; })), /one of 1, 2, 3/);
});

test('metadata preserves the new banks as authored drafts with outstanding native review', () => {
  assert.throws(() => validateMemoryMoonContent(mutate(pack => { pack.review.humanApproved = true; })), /outstanding independent native review/);
  assert.throws(() => validateMemoryMoonContent(mutate(pack => { pack.review.notes = ''; })), /authored text/);
  assert.throws(() => validateMemoryMoonContent(mutate(pack => { pack.license.origin = 'copied-from-another-game'; })), /first-party origin/);
});

test('a bank can grow through JSON-only additions without a fixed catalog count or ceiling', () => {
  const document = mutate(pack => {
    const item = structuredClone(pack.challenges[0]);
    item.id = `${item.id}-extension`;
    item.targetText += ' Další kontext.';
    item.englishText += ' Additional context.';
    item.embeddingText = item.englishText;
    item.learnerBaseText = item.englishText;
    const correct = item.choices.find(choice => choice.id === item.correctChoiceId);
    correct.text = correct.englishAuditText = item.englishText;
    pack.challenges.push(item);
  });
  assert.equal(validateMemoryMoonContent(document), document);
});
