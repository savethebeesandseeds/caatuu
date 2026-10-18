import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createBrowserHarness } from './helpers/fake-browser.mjs';
import { importBrowserLanguageAdapter } from './browser-module-loader.mjs';
import { createMemoryMoonDictionary, createMoonAuthoredWordLookup,
  createMoonWordLookup } from '../static/source/games/memory-moon/memory-moon-dictionary.mjs';

const course = { id: 'cz', routePrefix: '/cz', capabilities: { dictionary: true, speech: true },
  targetLanguage: { locale: 'cs-CZ', direction: 'ltr' }, sourceLanguage: { locale: 'en', direction: 'ltr' },
  gameContent: { 'word-net': { wordWorldManifest: 'data/games/word-world/manifest.json?v=bank-1' } } };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const payload = (surface, meaning) => ({ results: [{ lemma: surface, pos: 'noun', senses: [{ gloss: meaning }] }] });
const json = async path => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));

function fixture(options = {}) {
  const { document } = createBrowserHarness({ course });
  const slot = document.createElement('div'), token = document.createElement('button');
  document.body.append(slot, token);
  const reveals = [], speech = [], requests = [];
  const api = createMemoryMoonDictionary({ slot, course,
    runtime: { dictionary: { async search(word, settings) {
      requests.push({ word, ...settings }); return payload(word, 'button');
    } } },
    onSpeak: text => speech.push(text), onMeaningShown: value => reveals.push(value), ...options });
  return { api, slot, token, reveals, speech, requests, document };
}

test('card stays hidden without loading data until a word click; real Czech meanings alone reveal assistance', async () => {
  const f = fixture();
  assert.equal(f.slot.hidden, true);
  assert.equal(f.requests.length, 0);
  const item = { id: 'moon-one', targetText: 'Dva knoflíky.' };
  const result = await f.api.open('knoflíky', { item, tokenIndex: 1, button: f.token });
  assert.equal(result, true);
  assert.equal(f.slot.hidden, false);
  assert.equal(f.requests[0].limit, 8);
  assert.equal(f.requests[0].signal.aborted, false);
  assert.equal(f.slot.querySelector('.dictionary-word-card__meaning').textContent, 'button');
  assert.equal(f.slot.querySelector('.dictionary-word-card__pos').textContent, 'noun');
  assert.equal(f.reveals.length, 1);
  assert.equal(f.reveals[0].item, item);
  assert.equal(f.reveals[0].tokenIndex, 1);
  f.slot.querySelector('.dictionary-word-card__pronounce').click();
  assert.deepEqual(f.speech, ['knoflíky']);
  f.slot.querySelector('.moon-dictionary-close').click();
  assert.equal(f.slot.hidden, true);
  assert.equal(f.token.classList.contains('is-dictionary-selected'), false);
});

test('a newer selection wins even when the old dictionary ignores cancellation', async () => {
  const first = deferred(), second = deferred(), signals = [];
  const f = fixture({ resolveWord: (word, { signal }) => {
    signals.push(signal); return word === 'první' ? first.promise : second.promise;
  } });
  const p1 = f.api.open('první'), p2 = f.api.open('druhý');
  assert.equal(signals[0].aborted, true);
  second.resolve({ meaning: 'second' });
  assert.equal(await p2, true);
  first.resolve({ meaning: 'first' });
  assert.equal(await p1, false);
  assert.equal(f.slot.querySelector('.dictionary-word-card__meaning').textContent, 'second');
  assert.deepEqual(f.reveals.map(entry => entry.word), ['druhý']);
});

for (const action of ['reset', 'inactive', 'destroy']) {
  test(`${action} aborts and hides a pending lookup without stale meaning or evidence`, async () => {
    const wait = deferred(); let signal;
    const f = fixture({ resolveWord: (_word, options) => { signal = options.signal; return wait.promise; } });
    const opened = f.api.open('knoflík');
    if (action === 'inactive') f.api.setActive(false);
    else f.api[action]();
    assert.equal(signal.aborted, true);
    wait.resolve({ meaning: 'button' });
    assert.equal(await opened, false);
    assert.equal(f.slot.hidden, true);
    assert.equal(f.reveals.length, 0);
    if (action !== 'reset') assert.equal(await f.api.open('knoflík'), false);
  });
}

for (const value of [null, { meaning: ' ' }, new Error('offline')]) {
  test(`missing or failed lookup gives no assistance: ${String(value)}`, async () => {
    const f = fixture({ resolveWord: async () => { if (value instanceof Error) throw value; return value; } });
    assert.equal(await f.api.open('knoflík'), false);
    assert.equal(f.slot.hidden, false);
    assert.equal(f.slot.querySelector('.dictionary-word-card__meaning').textContent, 'Meaning unavailable.');
    assert.equal(f.slot.querySelector('.dictionary-word-card').classList.contains('is-loading'), false);
    assert.equal(f.reveals.length, 0);
  });
}

test('word card delegates script guides without inserting HTML from dictionary content', async () => {
  const guides = [];
  const f = fixture({ renderWord: (host, word, context) => { guides.push({ host, word, context }); },
    resolveWord: async () => ({ meaning: '<img src=x>', lemma: '<script>', pos: 'noun' }) });
  await f.api.open('猫', { tokenIndex: 2 });
  assert.equal(guides[0].word, '猫');
  assert.equal(guides[0].context.tokenIndex, 2);
  assert.equal(f.slot.querySelector('.dictionary-word-card__meaning').textContent, '<img src=x>');
  assert.equal(f.slot.querySelector('img'), null);
});

test('authored fallback preserves exact-context meanings and offers multiple authored senses', () => {
  const authoredCourse = { ...course, id: 'es', targetLanguage: { locale: 'es-ES' } };
  const targetCatalog = { courseId: 'es', realizations: [
    { conceptId: 'one', text: 'El banco está aquí.', tokens: [{ surface: 'banco', gloss: 'bank' }] },
    { conceptId: 'two', text: 'El banco es largo.', tokens: [{ surface: 'banco', gloss: 'bench' }] },
    { conceptId: 'three', text: 'Una casa.', tokens: [{ surface: 'casa', gloss: 'house' }] }
  ] };
  const lookup = createMoonAuthoredWordLookup({ course: authoredCourse, targetCatalog });
  assert.equal(lookup('banco').meaning, 'bank; bench');
  assert.deepEqual(lookup('banco').glosses, ['bank', 'bench']);
  assert.equal(lookup('banco', { item: { targetText: 'El banco está aquí.' }, tokenIndex: 0 }).meaning, 'bank');
  assert.equal(lookup('casa', { item: { targetText: 'Esta casa es nueva.' } }).meaning, 'house');
  assert.equal(lookup('unknown'), null);
});

test('Spanish-base meanings use exact authored target joins and never English glosses', () => {
  const spanishCourse = { ...course, id: 'es-en', targetLanguage: { locale: 'en-US' },
    sourceLanguage: { locale: 'es-ES' } };
  const targetCatalog = { courseId: 'es-en', realizations: [
    { conceptId: 'one', text: 'Hello, friend!', tokens: [
      { surface: 'Hello', gloss: 'hello' }, { surface: 'friend', gloss: 'friend' }
    ] }
  ] };
  const learnerBaseCatalog = { baseLanguage: { languageTag: 'es-ES' }, realizations: [
    { conceptId: 'one', tokenMeanings: [{ targetLanguage: 'en-US', tokenIndex: 0, surface: 'Hello', text: 'hola' }] }
  ] };
  const lookup = createMoonAuthoredWordLookup({ course: spanishCourse, targetCatalog, learnerBaseCatalog });
  assert.equal(lookup('Hello').meaning, 'hola');
  assert.equal(lookup('Hello').languageTag, 'es-ES');
  assert.equal(lookup('friend'), null);
  assert.throws(() => createMoonAuthoredWordLookup({ course: spanishCourse, targetCatalog }), /learner-base/);
  assert.throws(() => createMoonAuthoredWordLookup({ course: spanishCourse, targetCatalog,
    learnerBaseCatalog: { ...learnerBaseCatalog, baseLanguage: { languageTag: 'en' } } }), /learner-base/);
});

test('Mandarin fallback loads only declared confined authored resources and caches after success', async () => {
  const [realCourse, targetCatalog, manifest] = await Promise.all([
    json('../../languages/mandarin-simplified/course.json'),
    json('../../languages/mandarin-simplified/static/data/games/word-world/content.json'),
    json('../../languages/mandarin-simplified/static/data/games/word-world/manifest.json')
  ]);
  const profile = { ...realCourse, gameContent: { 'word-net': course.gameContent['word-net'] } };
  const requests = [];
  const lookup = createMoonWordLookup({ course: profile, runtimeHref: 'https://caatuu.test/zh/index.html',
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, json: async () => url.includes('manifest.json') ? manifest : targetCatalog };
    } });
  assert.equal(requests.length, 0);
  const result = await lookup('你好', { item: { targetText: '你好！' }, tokenIndex: 0 });
  assert.equal(result.meaning, 'hello');
  assert.equal(requests.length, 2);
  assert.ok(requests.every(entry => entry.url.startsWith('https://caatuu.test/zh/data/games/word-world/')));
  await lookup('你好', { item: { targetText: '你好！' }, tokenIndex: 0 });
  assert.equal(requests.length, 2);
});

test('aborted lazy load is retryable, and a foreign manifest or escaped resource is refused', async () => {
  const authoredCourse = { ...course, id: 'zh', routePrefix: '/zh', capabilities: { dictionary: false },
    targetLanguage: { locale: 'zh-CN' } };
  const controller = new AbortController();
  controller.abort();
  let fetches = 0;
  const lookup = createMoonWordLookup({ course: authoredCourse, runtimeHref: 'https://caatuu.test/zh/index.html',
    fetchImpl: async () => { fetches++; return { ok: true, json: async () => ({ courseId: 'other' }) }; } });
  await assert.rejects(lookup('你好', { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(fetches, 0);
  assert.equal(await lookup('你好'), null);
  assert.equal(fetches, 1);
  const escaped = createMoonWordLookup({ course: authoredCourse, runtimeHref: 'https://caatuu.test/zh/index.html',
    fetchImpl: async () => ({ ok: true, json: async () => ({ courseId: 'zh',
      sessionProvider: { kind: 'authored-realizations' }, realizationFile: '../outside.json' }) }) });
  await assert.rejects(escaped('你好'), /confined/);
});

test('all authored course word banks retain their actual learner-language meaning authority', async () => {
  for (const directory of ['mandarin-simplified', 'spanish', 'english-from-spanish',
    'norwegian-bokmal', 'arabic-standard', 'latin-scientific', 'georgian']) {
    const [actualCourse, targetCatalog] = await Promise.all([
      json(`../../languages/${directory}/course.json`),
      json(`../../languages/${directory}/static/data/games/word-world/content.json`)
    ]);
    const learnerBaseCatalog = directory === 'english-from-spanish'
      ? await json(`../../languages/${directory}/static/data/games/word-world/learner-base.json`)
      : null;
    const adapter = await importBrowserLanguageAdapter(`../../languages/${directory}/static/source/language/adapter.mjs`);
    const lookup = createMoonAuthoredWordLookup({ course: actualCourse, targetCatalog, learnerBaseCatalog, adapter });
    const record = targetCatalog.realizations.find(entry => entry.tokens.some(token => token.gloss));
    const tokenIndex = record.tokens.findIndex(token => token.gloss);
    const word = record.tokens[tokenIndex].surface;
    const result = lookup(word, { item: { targetText: record.text }, tokenIndex });
    assert.ok(result?.meaning, `${actualCourse.id} has an authored exact-context meaning`);
    assert.equal(result.languageTag, actualCourse.sourceLanguage.locale);
    if (learnerBaseCatalog) {
      const base = learnerBaseCatalog.realizations.find(entry => entry.conceptId === record.conceptId);
      assert.equal(result.meaning, base.tokenMeanings.find(entry => entry.tokenIndex === tokenIndex).text);
    } else assert.equal(result.meaning, record.tokens[tokenIndex].gloss);
  }
});

test('Arabic help tolerates omitted short vowels, preserves shadda and displays normalized senses', async () => {
  const [actualCourse, adapter] = await Promise.all([
    json('../../languages/arabic-standard/course.json'),
    importBrowserLanguageAdapter('../../languages/arabic-standard/static/source/language/adapter.mjs')
  ]);
  const targetCatalog = { courseId: 'ar', realizations: [
    { conceptId: 'water', text: 'المَاءُ بارِدٌ.', tokens: [{ surface: 'المَاءُ', gloss: 'the water' }] },
    { conceptId: 'write', text: 'كَتَبَ.', tokens: [{ surface: 'كَتَبَ', gloss: 'he wrote' }] },
    { conceptId: 'written', text: 'كُتِبَ.', tokens: [{ surface: 'كُتِبَ', gloss: 'was written' }] },
    { conceptId: 'teach', text: 'عَلَّمَ.', tokens: [{ surface: 'عَلَّمَ', gloss: 'he taught' }] }
  ] };
  const lookup = createMoonAuthoredWordLookup({ course: actualCourse, adapter, targetCatalog });
  assert.equal(lookup('الماءُ').meaning, 'the water');
  assert.equal(lookup('كتب').meaning, 'he wrote; was written', 'vowel-dependent meanings remain separate authored senses');
  assert.equal(lookup('كَتَبَ').meaning, 'he wrote', 'the exact written form is preferred to normalized alternatives');
  assert.equal(lookup('كَتَبَ', { item: { targetText: 'كَتَبَ.' }, tokenIndex: 0 }).meaning, 'he wrote');
  assert.equal(lookup('علم'), null, 'shadda remains a different spelling');
  assert.equal(lookup('علّم').meaning, 'he taught');
});

test('lazy authored help uses only the declared current-course normalization adapter', async () => {
  const [actualCourse, adapter] = await Promise.all([
    json('../../languages/arabic-standard/course.json'),
    importBrowserLanguageAdapter('../../languages/arabic-standard/static/source/language/adapter.mjs')
  ]);
  const profile = { ...actualCourse, languageAdapter: { module: 'source/language/adapter.mjs' },
    gameContent: course.gameContent };
  const imports = [];
  const lookup = createMoonWordLookup({ course: profile, runtimeHref: 'https://caatuu.test/ar/index.html',
    fetchImpl: async url => ({ ok: true, json: async () => url.includes('manifest.json')
      ? { courseId: 'ar', sessionProvider: { kind: 'authored-realizations' }, realizationFile: 'content.json' }
      : { courseId: 'ar', realizations: [{ conceptId: 'water', text: 'المَاءُ.', tokens: [{ surface: 'المَاءُ', gloss: 'the water' }] }] } }),
    importModule: async url => { imports.push(url); return { default: adapter }; }
  });
  assert.equal((await lookup('الماء')).meaning, 'the water');
  assert.deepEqual(imports, ['https://caatuu.test/ar/source/language/adapter.mjs']);
});
