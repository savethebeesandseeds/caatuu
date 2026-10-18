import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createBrowserHarness } from './helpers/fake-browser.mjs';
import { createTargetReadingGuide } from '../static/source/target-reading-guide.mjs';
import { createMoonRenderer, moonWordReadingUnits, tokenizeMoonText } from '../static/source/games/memory-moon/memory-moon-render.mjs';

function fixture({ id = 'cs', locale = 'cs-CZ', direction = 'ltr', onSelectWord,
  speech = true, guide = false, saved = {}, namespace = `caatuu.fixture.${id}` } = {}) {
  const browser = createBrowserHarness({ localStorageValues: saved });
  const root = browser.document.createElement('main');
  browser.document.body.append(root);
  const course = { id, storage: { namespace }, sourceLanguage: { locale: 'en-US', direction: 'ltr' },
    targetLanguage: { id, locale, direction }, capabilities: { speech } };
  const readingGuide = guide ? createTargetReadingGuide({ course, gameId: 'memory-moon',
    document: browser.document, storage: browser.localStorage }) : undefined;
  const spoken = [];
  const renderer = createMoonRenderer({ root, course, readingGuide, onSelectWord, storage: browser.localStorage,
    onSpeak: text => spoken.push(text) });
  return { ...browser, root, renderer, spoken, readingGuide,
    paint(item, options) { renderer.render({ currentItem: { choices: [], ...item },
      phase: 'question', index: 0, target: 6 }, options); } };
}
function surfaceText(node) {
  if (node.nodeType === 3) return node.nodeValue;
  if (node.tagName === 'RT') return '';
  return node.childNodes.map(surfaceText).join('');
}
const reading = tokens => ({ system: 'pinyin', tokens: tokens.map(([surface, notations]) => ({
  surface, units: Array.from(surface).map((glyph, index) => ({ surface: glyph, notation: notations[index] }))
})) });

test('clickable words retain source whitespace, combining marks and attached punctuation', () => {
  const selections = [], app = fixture({ onSelectWord: (...args) => selections.push(args) });
  const text = '„Jsou tu dva bílé knoflíky.“';
  const item = { id: 'sentence', targetText: text };
  app.paint(item);
  assert.equal(app.renderer.sentence.textContent, text);
  assert.equal(app.renderer.sentence.getAttribute('aria-label'), text);
  const words = app.root.querySelectorAll('.moon-word-token');
  assert.deepEqual(words.map(word => word.textContent), ['Jsou', 'tu', 'dva', 'bílé', 'knoflíky']);
  words[3].click();
  assert.equal(selections.length, 1);
  assert.equal(selections[0][0], 'bílé');
  assert.equal(selections[0][1].tokenIndex, 3);
  assert.equal(selections[0][1].item.targetText, text);
  assert.equal(selections[0][1].button, words[3]);
  assert.deepEqual(app.spoken, []);
  assert.equal(words[3].getAttribute('aria-label'), 'Show meaning: bílé');
  const fallback = tokenizeMoonText('أَهْلًا  მეგობარო!', 'und', null);
  assert.equal(fallback.map(part => part.text).join(''), 'أَهْلًا  მეგობარო!');
});

test('Mandarin pairs authored pinyin above continuous Hanzi with tone colors by default', () => {
  const app = fixture({ id: 'zh', locale: 'zh-CN' });
  const item = { id: 'zh', targetText: '你好，朋友！',
    targetReading: reading([['你好', ['nǐ', 'hǎo']], ['朋友', ['péng', 'yǒu']]]) };
  app.paint(item);
  assert.equal(surfaceText(app.renderer.sentence), item.targetText);
  assert.equal(app.renderer.sentence.getAttribute('aria-label'), item.targetText);
  assert.deepEqual(app.renderer.sentence.querySelectorAll('rt').map(node => node.textContent), ['nǐ', 'hǎo', 'péng', 'yǒu']);
  assert.ok(app.renderer.sentence.querySelectorAll('rt').every(node => node.lang === 'zh-Latn-pinyin'
    && node.getAttribute('aria-hidden') === 'true' && node.parentElement.tagName === 'RUBY'));
  assert.deepEqual(app.renderer.sentence.querySelectorAll('[data-tone]').map(node => node.dataset.tone), ['3', '3', '2', '3']);
  assert.equal(app.renderer.sentence.querySelectorAll('.caatuu-target-text-glyph').map(node => node.textContent).join(''), '你好朋友');
  const word = app.root.querySelector('.moon-word-token');
  const dictionaryWord = app.document.createElement('strong');
  assert.equal(app.renderer.renderDictionaryWord(dictionaryWord, word.dataset.spokenWord, {
    item, tokenIndex: Number(word.dataset.tokenIndex) }), true);
  assert.ok(dictionaryWord.querySelector('rt'));
  assert.equal(surfaceText(dictionaryWord), word.dataset.spokenWord);
});

test('Chinese Aa switches update sentence and open dictionary in place independently of learning state', () => {
  const selected = [], app = fixture({ id: 'zh', locale: 'zh-CN', onSelectWord: word => selected.push(word) });
  const item = { id: 'zh', targetText: '你好，朋友！', choices: [{ id: 'a', text: 'Hello, friend!' }],
    targetReading: reading([['你好', ['nǐ', 'hǎo']], ['朋友', ['péng', 'yǒu']]]) };
  app.paint(item);
  const settings = app.renderer.targetTextSettings;
  assert.equal(settings.labelKey, 'verbnebula.targettext.title');
  assert.equal(settings.content.ownerDocument, app.document);
  const guide = settings.content.querySelector('[data-target-text-setting="showGuide"]');
  const tones = settings.content.querySelector('[data-target-text-setting="colorTones"]');
  assert.equal(guide.getAttribute('role'), 'switch');
  assert.equal(tones.getAttribute('role'), 'switch');
  assert.equal(guide.getAttribute('aria-checked'), 'true');
  assert.equal(tones.getAttribute('aria-checked'), 'true');
  const words = app.root.querySelectorAll('.moon-word-token'), choices = [...app.renderer.choices.children];
  const word = words[0];
  word.classList.add('is-dictionary-selected');
  word.focus();
  const dictionaryWord = app.document.createElement('strong');
  app.renderer.dictionarySlot.append(dictionaryWord);
  app.renderer.dictionarySlot.hidden = false;
  app.renderer.renderDictionaryWord(dictionaryWord, word.dataset.spokenWord, {
    item, tokenIndex: Number(word.dataset.tokenIndex) });
  const check = (showGuide, colorTones) => {
    assert.equal(guide.getAttribute('aria-checked'), String(showGuide));
    assert.equal(tones.getAttribute('aria-checked'), String(colorTones));
    for (const host of [app.renderer.sentence, dictionaryWord]) {
      assert.equal(Boolean(host.querySelector('rt')), showGuide);
      assert.equal(Boolean(host.querySelector('[data-tone]')), colorTones);
    }
    assert.equal(surfaceText(app.renderer.sentence), item.targetText);
    assert.equal(surfaceText(dictionaryWord), word.dataset.spokenWord);
    assert.deepEqual(app.root.querySelectorAll('.moon-word-token'), words);
    assert.deepEqual([...app.renderer.choices.children], choices);
    assert.equal(word.classList.contains('is-dictionary-selected'), true);
    assert.equal(app.document.activeElement, word);
    assert.deepEqual(selected, []);
    assert.deepEqual(app.spoken, []);
  };
  check(true, true);
  guide.click(); check(false, true);
  tones.click(); check(false, false);
  guide.click(); check(true, false);
  tones.click(); check(true, true);
  word.click();
  assert.deepEqual(selected, [word.dataset.spokenWord], 'repainting keeps the original word interaction');
});

test('Chinese presentation preferences persist for Memory Moon and remain separate from other courses and Word World', () => {
  const namespace = 'caatuu.fixture.chinese';
  const wordWorldKey = `${namespace}.wordNet.targetTextPreferences.v1`;
  const app = fixture({ id: 'zh', locale: 'zh-CN', namespace,
    saved: { [wordWorldKey]: JSON.stringify({ showGuide: false, colorTones: false }) } });
  const settings = app.renderer.targetTextSettings.content;
  settings.querySelector('[data-target-text-setting="showGuide"]').click();
  settings.querySelector('[data-target-text-setting="colorTones"]').click();
  const saved = app.localStorage.snapshot();
  assert.deepEqual(JSON.parse(saved[`${namespace}.memoryMoon.targetTextPreferences.v1`]), { showGuide: false, colorTones: false });
  assert.equal(saved[wordWorldKey], JSON.stringify({ showGuide: false, colorTones: false }));
  const reopened = fixture({ id: 'zh', locale: 'zh-CN', namespace, saved });
  const item = { id: 'one', targetText: '好。', targetReading: reading([['好', ['hǎo']]]) };
  reopened.paint(item);
  assert.equal(reopened.renderer.sentence.textContent, item.targetText);
  assert.equal(reopened.renderer.sentence.querySelector('rt'), null);
  assert.equal(reopened.renderer.sentence.querySelector('[data-tone]'), null);
  const independent = fixture({ id: 'zh', locale: 'zh-CN', namespace: `${namespace}.second`, saved });
  independent.paint(item);
  assert.equal(independent.renderer.sentence.querySelector('rt').textContent, 'hǎo');
  assert.equal(independent.renderer.sentence.querySelector('[data-tone]').dataset.tone, '3');
});

test('repeated Mandarin surfaces use their own occurrence and malformed alignment stays plain', () => {
  const item = { targetText: '长，长。', targetReading: reading([['长', ['cháng']], ['长', ['zhǎng']]]) };
  assert.deepEqual(moonWordReadingUnits(item, '长', 0, 'zh-CN').map(unit => unit.notation), ['cháng']);
  assert.deepEqual(moonWordReadingUnits(item, '长', 1, 'zh-CN').map(unit => unit.notation), ['zhǎng']);
  assert.equal(moonWordReadingUnits(item, '错', 1, 'zh-CN'), null);
  const malformed = { ...item, targetReading: reading([['长', ['cháng']]]) };
  assert.equal(moonWordReadingUnits(malformed, '长', 0, 'zh-CN'), null);
  const app = fixture({ id: 'zh', locale: 'zh-CN' });
  app.paint({ id: 'fixture', ...malformed });
  assert.equal(app.renderer.sentence.textContent, item.targetText);
  assert.equal(app.renderer.sentence.querySelector('[data-tone]'), null);
});

test('Arabic and Georgian reuse their established whole-word guides and preserve script direction', () => {
  for (const [id, locale, direction, text, notations] of [
    ['ar', 'ar', 'rtl', 'كَتَبَ وَلَدٌ.', ['kataba', 'waladun']],
    ['ka', 'ka-GE', 'ltr', 'დილა მშვიდობისა!', ['dila', 'mshvidobisa']]
  ]) {
    const app = fixture({ id, locale, direction, guide: true });
    assert.equal(app.renderer.targetTextSettings, null);
    app.paint({ id, targetText: text });
    assert.equal(surfaceText(app.renderer.sentence), text);
    assert.equal(app.renderer.sentence.dir, direction);
    assert.deepEqual(app.renderer.sentence.querySelectorAll('rt').map(node => node.textContent), notations);
    assert.ok(app.renderer.sentence.querySelectorAll('rt').every(node => node.dir === 'ltr' && node.lang === `${id}-Latn`));
    app.readingGuide.setEnabled(false);
    assert.equal(app.renderer.sentence.textContent, text);
    assert.equal(app.renderer.sentence.querySelector('rt'), null);
    app.readingGuide.setEnabled(true);
    assert.equal(surfaceText(app.renderer.sentence), text);
  }
});

test('dictionary mounts hidden in the upper-right overview and words can select it without speech', () => {
  const selections = [], app = fixture({ speech: false, onSelectWord: word => selections.push(word) });
  assert.equal(app.renderer.targetTextSettings, null);
  assert.equal(app.renderer.dictionarySlot.hidden, true);
  assert.ok(app.renderer.dictionarySlot.closest('.moon-overview-side'));
  assert.equal(app.renderer.dictionarySlot.closest('.moon-challenge'), null);
  app.paint({ id: 'first', targetText: 'Dobrý den.' });
  app.root.querySelector('.moon-word-token').click();
  assert.deepEqual(selections, ['Dobrý']);
  assert.equal(app.root.querySelector('.moon-speak').hidden, true);
  app.paint({ id: 'second', targetText: 'Dobrý den.' }, { interactive: false });
  app.root.querySelector('.moon-word-token').click();
  assert.equal(selections.length, 1);
});

test('inline token styles inherit sentence size without adding horizontal padding or artificial targets', async () => {
  const css = await readFile(new URL('../static/source/games/memory-moon/memory-moon.css', import.meta.url), 'utf8');
  const token = css.match(/\.moon-word-token\s*\{([^}]+)\}/u)?.[1];
  assert.ok(token);
  assert.match(token, /display:\s*inline;/u);
  assert.match(token, /padding:\s*0;/u);
  assert.match(token, /min-width:\s*0;/u);
  assert.match(token, /font:\s*inherit;/u);
  assert.match(token, /user-select:\s*text;/u);
  assert.doesNotMatch(token, /font-size:/u);
});
