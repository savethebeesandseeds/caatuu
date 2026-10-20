import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../../', import.meta.url);
const json = async file => JSON.parse(await readFile(new URL(file, root), 'utf8'));
const catalog = await json('apps/languages/catalog.json');
const courses = await Promise.all(catalog.courses.map(entry => json(entry.manifest)));
const zero = rows => rows.filter(row => row.difficulty === 0);
const key = value => value.normalize('NFC').toLocaleLowerCase('en').replace(/[.!?。！？]+$/u, '').trim();
const words = value => value.trim().split(/\s+/u).length;
const short = (value, limit, label) => {
  assert.equal(typeof value, 'string', label);
  assert.ok(value.trim() && words(value) <= limit, `${label}: keep the beginner prompt short`);
  assert.doesNotMatch(value, /[;；]/u, `${label}: avoid linked clauses`);
};
const plainCue = (value, label) => assert.doesNotMatch(value,
  /\(present(?: active)?\)|\b(?:present active|present indicative)\b|^(?:I|you|he|she|we|they)(?:\s*\([^)]*\))?\s*:/iu,
  `${label}: first encounters use ordinary cues, without tense/person jargon`);

for (const course of courses) {
  const resource = name => json(course.resources[name].path);
  if (course.games.includes('conjugation-comet')) test(`${course.id}: zero conjugation keeps short cues within complete supported paradigms`, async () => {
    const bank = await resource('conjugationCometCatalog');
    const standardFormCounts = new Set(bank.verbs.filter(row => row.difficulty !== 0).map(row => row.forms.length));
    for (const verb of zero(bank.verbs)) {
      for (const field of ['learnerBaseText', 'englishAuditText', 'meaningChoiceBaseText']) plainCue(verb[field], `${verb.id}/${field}`);
      assert.ok(standardFormCounts.has(verb.forms.length), `${verb.id}: retain a full supported paradigm`);
      for (const form of verb.forms) {
        short(form.targetText, 3, `${verb.id}/${form.id} form`);
        short(form.englishAuditText, 6, `${verb.id}/${form.id} meaning`);
        plainCue(form.learnerBaseCueText, `${verb.id}/${form.id} cue`);
        plainCue(form.englishAuditText, `${verb.id}/${form.id} meaning`);
        assert.ok(form.complexity <= 20 && verb.complexity <= 20, `${verb.id}: introductory grading`);
      }
    }
  });

  if (course.games.includes('grammar-gravity')) test(`${course.id}: zero agreement stays short and avoids duplicate phrase padding`, async () => {
    const bank = await resource('grammarGravityCatalog');
    const phrases = new Set();
    for (const family of zero(bank.challenges)) {
      assert.equal(Object.keys(family.forms).length, (family.axes || bank.axes).length, `${family.id}: every authored axis retains its form`);
      // A phrase can legitimately return in another lesson, for example
      // "a / two" versus "one / two". Count its actual form contrast as well.
      const contrast = Object.values(family.forms).map(form => key(form.displayForm)).sort().join('\0');
      for (const form of Object.values(family.forms)) for (const example of form.examples) {
        short(example.targetText, 5, `${example.id} target`);
        short(example.englishAuditText, 6, `${example.id} meaning`);
        assert.ok(example.complexity <= 20 && family.complexity <= 20, `${example.id}: introductory grading`);
        const identity = `${contrast}\0${key(example.targetText)}\0${key(example.englishAuditText)}`;
        assert.ok(!phrases.has(identity), `${example.id}: the same phrase is already offered at zero`);
        phrases.add(identity);
      }
    }
  });

  if (course.games.includes('memory-moon')) test(`${course.id}: zero translations and alternatives use tiny self-contained prompts`, async () => {
    const bank = await resource('memoryMoonCatalog');
    for (const question of zero(bank.challenges)) {
      short(question.targetText, 6, `${question.id} target`);
      short(question.englishText, 7, `${question.id} meaning`);
      assert.ok(question.complexity <= 20, `${question.id}: introductory grading`);
      for (const choice of question.choices) short(choice.englishAuditText, 8, `${question.id}/${choice.id}`);
    }
  });

  if (course.games.includes('case-cosmos')) test(`${course.id}: zero case contexts retain the two introductory roles`, async () => {
    const bank = await resource('caseCosmosCatalog');
    for (const context of zero(bank.contexts)) {
      assert.ok(['Nominative', 'Accusative'].includes(context.case), `${context.id}: keep the first two roles`);
      short(context.czech, 4, `${context.id} target`);
      short(context.english, 6, `${context.id} meaning`);
      assert.ok(context.complexity <= 20, `${context.id}: introductory grading`);
    }
  });

  if (course.id === 'zh') test('zh: every zero character is grounded in an existing zero word or tiny phrase', async () => {
    const bank = await resource('naturalizationNucleusCatalog');
    const authority = await json(`apps/languages/${course.directoryName}/content/word-world/content.json`);
    const sources = new Map(zero(authority.records).map(record => [record.id, record]));
    for (const item of zero(bank.challenges)) {
      assert.ok(item.sourceConceptIds.length, `${item.id}: source evidence`);
      for (const sourceId of item.sourceConceptIds) {
        const source = sources.get(sourceId);
        assert.ok(source, `${item.id}: do not borrow a harder source`);
        assert.ok(source.tokens.some(token => token.readingUnits?.some(unit =>
          unit.surface === item.hanzi && key(unit.pronunciation.notation) === key(item.pinyin))),
        `${item.id}: the character and reading must match their occurrence`);
      }
    }
  });
}
