import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createBrowserHarness } from './helpers/fake-browser.mjs';
import { mountMemoryMoon } from '../static/source/games/memory-moon/memory-moon-host.mjs';
import { MEMORY_MOON_ROUND_COUNT, createMoonSession, answerMoonChallenge, advanceMoonChallenge } from '../static/source/games/memory-moon/memory-moon-core.mjs';
import { tokenizeMoonText, moonLabels } from '../static/source/games/memory-moon/memory-moon-render.mjs';
import { arabicReadingUnits } from '../static/source/arabic-romanization.mjs';
import { georgianReadingUnits } from '../static/source/georgian-romanization.mjs';

const directories = ['czech', 'mandarin-simplified', 'spanish', 'english-from-spanish',
  'norwegian-bokmal', 'arabic-standard', 'latin-scientific', 'georgian'];
const json = async relative => JSON.parse(await readFile(new URL(relative, import.meta.url), 'utf8'));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function flush() { for (let index = 0; index < 12; index++) await Promise.resolve(); }
function surfaceText(node) {
  if (node.nodeType === 3) return node.nodeValue;
  if (node.tagName === 'RT') return '';
  return node.childNodes.map(surfaceText).join('');
}

function clock() {
  let time = 0, sequence = 0;
  const timers = new Map(), frames = new Map();
  return { timers, frames, now: () => time,
    setTimeout(callback, delay) { const id = ++sequence; timers.set(id, { callback, at: time + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    requestAnimationFrame(callback) { const id = ++sequence; frames.set(id, callback); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
    tick(milliseconds) {
      time += milliseconds;
      const callbacks = [...frames.values()]; frames.clear();
      callbacks.forEach(callback => callback(time));
      for (const [id, timer] of [...timers]) if (timer.at <= time) {
        timers.delete(id); timer.callback();
      }
    }
  };
}

async function fixture({ directory = 'czech', catalogWait, selectionWait, realControls = false,
  speechAvailable, initialActive = true, resetDuringAnswer = false, autoplay = true, muted = false,
  resolveWord = async () => null, saved = {} } = {}) {
  const [originalCourse, pack] = await Promise.all([
    json(`../../languages/${directory}/course.json`),
    json(`../../languages/${directory}/static/data/games/memory-moon/content.json`)
  ]);
  const course = structuredClone(originalCourse);
  if (speechAvailable !== undefined) course.capabilities.speech = speechAvailable;
  const time = clock(), messages = [], speechCalls = [], starts = [], assists = [], wordLookups = [];
  const shell = createBrowserHarness({ course, localStorageValues: saved }).window;
  shell.postMessage = (...args) => messages.push(args);
  shell.CaatuuI18n = { t: key => key, languageName: locale => locale };
  shell.CaatuuChrome = {
    applyTheme() {}, applyFontSize() {},
    getSpeechMuted: () => muted,
    setSpeechMuted(value) { muted = value; shell.dispatchEvent({ type: 'caatuu:speech-mute-change' }); },
    getSpeechAutoplay: () => autoplay,
    setSpeechAutoplay(value) { autoplay = value; shell.dispatchEvent({ type: 'caatuu:speech-autoplay-change' }); },
    resolveSpeechPace: () => ({ key: 'normal', label: 'Normal', rate: 1 }),
    setSpeechPacePreference() {},
    stopSpeech: async () => {},
    speakText(text, options) { const wait = deferred(); speechCalls.push({ text, options, ...wait }); return wait.promise; }
  };
  const frame = createBrowserHarness({ course, window: {
    ...time, performance: { now: time.now }, AbortController
  } });
  frame.document.hidden = false;
  const root = frame.document.createElement('main');
  frame.document.body.append(root);
  let session = null, disposed = false, cancelled = 0, controlsOptions, requestOptions;
  const service = {
    async startRound(options) {
      starts.push(options);
      if (selectionWait) await selectionWait.promise;
      // Deliberately tolerate cancellation to test the host's independent fence.
      session = createMoonSession(pack.challenges.filter(item => item.difficulty === 1).slice(0, MEMORY_MOON_ROUND_COUNT));
    },
    snapshot: () => session ? { ...session, currentItem: session.items[session.index], saveStatus: 'ready' } : null,
    answer(id) {
      session = answerMoonChallenge(session, id);
      const result = this.snapshot();
      if (resetDuringAnswer) shell.dispatchEvent({ type: 'caatuu:learning-change', detail: { reason: 'progress-reset' } });
      return result;
    },
    assist(reason) { assists.push(reason); return this.snapshot(); },
    advance() { session = advanceMoonChallenge(session); return this.snapshot(); },
    cancelPending() { cancelled++; }, dispose() { disposed = true; }
  };
  const services = {
    resolveWord(word, context) { wordLookups.push({ word, ...context }); return resolveWord(word, context); },
    async loadCatalog(receivedCourse, options) {
      assert.equal(receivedCourse.id, course.id);
      requestOptions = options;
      if (catalogWait) await catalogWait.promise;
      return { document: pack };
    },
    createPractice(options) { assert.equal(options.pack, pack); return service; }
  };
  if (!realControls) services.mountControls = options => {
    controlsOptions = options;
    return { destroy() {}, close() {}, isOpen: () => false };
  };
  const host = await mountMemoryMoon({ root, shell, course, learning: { difficulty: () => 1 },
    active: initialActive, random: () => 0, services,
    fetchImpl: async () => ({ ok: true, json: async () => ({}) })
  });
  return { host, root, shell, frame, course, pack, time, messages, speechCalls, assists, starts, wordLookups,
    get disposed() { return disposed; }, get cancelled() { return cancelled; },
    get controlsOptions() { return controlsOptions; }, get requestOptions() { return requestOptions; },
    choice(id) { return root.querySelector(`[data-choice-id="${id}"]`); },
    correct() { const item = host.snapshot().currentItem; this.choice(item.correctChoiceId).click(); },
    continue() { root.querySelector('.moon-continue').click(); },
    visible(hidden) { frame.document.hidden = hidden; frame.document.dispatchEvent({ type: 'visibilitychange' }); }
  };
}

test('every registered course renders its own target and learner-base choices in the local frame', async t => {
  for (const directory of directories) await t.test(directory, async t => {
    const app = await fixture({ directory }); t.after(() => app.host.destroy());
    await app.host.ready;
    const item = app.host.snapshot().currentItem;
    const sentence = app.root.querySelector('.moon-sentence');
    assert.equal(sentence.ownerDocument, app.frame.document);
    assert.notEqual(sentence.ownerDocument, app.shell.document);
    assert.equal(surfaceText(sentence), item.targetText);
    assert.equal(sentence.getAttribute('aria-label'), item.targetText);
    const guided = ['arabic-standard', 'georgian'].includes(directory);
    assert.equal(app.controlsOptions.readingGuide.available, guided);
    if (guided) {
      const notations = sentence.querySelectorAll('rt');
      const project = directory === 'arabic-standard' ? arabicReadingUnits : georgianReadingUnits;
      const expectedReadings = project(item.targetText).filter(unit => unit.notation).map(unit => unit.notation);
      assert.deepEqual(notations.map(node => node.textContent), expectedReadings,
        'guides use the established written-form authority without inventing missing Arabic vowels');
      assert.ok(notations.every(node => node.dir === 'ltr'
        && node.lang === `${app.course.targetLanguage.id}-Latn` && node.getAttribute('aria-hidden') === 'true'));
      app.controlsOptions.readingGuide.setEnabled(false);
      assert.equal(sentence.textContent, item.targetText);
      assert.equal(sentence.querySelector('rt'), null);
      app.controlsOptions.readingGuide.setEnabled(true);
      assert.equal(surfaceText(sentence), item.targetText);
      assert.equal(Boolean(sentence.querySelector('rt')), expectedReadings.length > 0);
    } else if (directory === 'mandarin-simplified') {
      assert.deepEqual(sentence.querySelectorAll('rt').map(node => node.textContent),
        item.targetReading.tokens.flatMap(token => token.units).map(unit => unit.notation));
      assert.ok(sentence.querySelector('[data-tone]'));
      assert.equal(app.controlsOptions.challenge.labelKey, 'verbnebula.targettext.title');
      assert.equal(app.controlsOptions.challenge.content.ownerDocument, app.frame.document);
    } else assert.equal(sentence.querySelector('rt'), null);
    if (directory !== 'mandarin-simplified') assert.equal(app.controlsOptions.challenge, null);
    assert.equal(sentence.lang, app.course.targetLanguage.locale);
    assert.equal(sentence.dir, app.course.targetLanguage.direction || 'auto');
    assert.deepEqual(app.root.querySelectorAll('.moon-choice').map(button => button.textContent), item.choices.map(choice => choice.text));
    assert.equal(app.root.querySelector('.moon-choices').lang, app.course.sourceLanguage.locale);
    assert.equal(app.requestOptions.resourceName, 'memoryMoonCatalog');
    assert.equal(new URL(app.requestOptions.runtimeHref).pathname, `${app.course.routePrefix}/index.html`);
    assert.equal(app.messages.length, 0);
    assert.equal(app.root.getAttribute('aria-busy'), 'false');
    assert.equal(app.root.querySelector('.moon-brand-footer').closest('.moon-board'), null);
  });
});

test('Chinese Aa controls toggle persisted readings and tone colors without advancing or replaying the question', async t => {
  const app = await fixture({ directory: 'mandarin-simplified', realControls: true, autoplay: false });
  t.after(() => app.host.destroy()); await app.host.ready; await flush();
  const aaIcon = app.root.querySelector('.caatuu-game-challenge-icon');
  assert.ok(aaIcon, 'Chinese text controls use the shared Aa button');
  assert.equal(aaIcon.textContent, 'Aa');
  const menuToggle = aaIcon.closest('button');
  assert.equal(menuToggle.getAttribute('aria-expanded'), 'false');
  menuToggle.click();
  assert.equal(menuToggle.getAttribute('aria-expanded'), 'true');
  const guide = app.root.querySelector('[data-target-text-setting="showGuide"]');
  const tones = app.root.querySelector('[data-target-text-setting="colorTones"]');
  assert.equal(guide.getAttribute('role'), 'switch');
  assert.equal(tones.getAttribute('role'), 'switch');
  const sentence = app.root.querySelector('.moon-sentence'), words = sentence.querySelectorAll('.moon-word-token');
  const choices = app.root.querySelectorAll('.moon-choice'), snapshot = app.host.snapshot();
  guide.click();
  assert.equal(guide.getAttribute('aria-checked'), 'false');
  assert.equal(sentence.querySelector('rt'), null);
  assert.ok(sentence.querySelector('[data-tone]'));
  tones.click();
  assert.equal(tones.getAttribute('aria-checked'), 'false');
  assert.equal(sentence.querySelector('[data-tone]'), null);
  assert.equal(surfaceText(sentence), snapshot.currentItem.targetText);
  assert.deepEqual(sentence.querySelectorAll('.moon-word-token'), words);
  assert.deepEqual(app.root.querySelectorAll('.moon-choice'), choices);
  assert.equal(app.host.snapshot(), snapshot);
  assert.equal(app.starts.length, 1);
  assert.equal(app.speechCalls.length, 0);
  assert.deepEqual(app.assists, []);
  assert.equal(app.messages.length, 0);
  menuToggle.click();
  assert.equal(menuToggle.getAttribute('aria-expanded'), 'false');
  assert.ok(app.root.querySelectorAll('.moon-choice').every(choice => !choice.disabled));
  const saved = app.shell.localStorage.snapshot();
  assert.deepEqual(JSON.parse(saved[`${app.course.storage.namespace}.memoryMoon.targetTextPreferences.v1`]),
    { showGuide: false, colorTones: false });
  const reopened = await fixture({ directory: 'mandarin-simplified', realControls: true, autoplay: false, saved });
  t.after(() => reopened.host.destroy()); await reopened.host.ready;
  assert.equal(reopened.root.querySelector('[data-target-text-setting="showGuide"]').getAttribute('aria-checked'), 'false');
  assert.equal(reopened.root.querySelector('[data-target-text-setting="colorTones"]').getAttribute('aria-checked'), 'false');
  assert.equal(reopened.root.querySelector('.moon-sentence').querySelector('rt'), null);
  assert.equal(reopened.root.querySelector('.moon-sentence').querySelector('[data-tone]'), null);
  assert.equal(reopened.host.snapshot().index, 0);
});

test('incorrect feedback shakes only the rejected alternative and a correction waits for Continue', async t => {
  const app = await fixture(); t.after(() => app.host.destroy()); await app.host.ready;
  const wrong = app.host.snapshot().currentItem.choices.find(choice => choice.id !== 'correct').id;
  const shade = app.root.querySelector('.moon-shade'), initial = shade.getAttribute('d');
  app.choice(wrong).click();
  assert.equal(app.choice(wrong).classList.contains('is-shaking'), true);
  assert.equal(app.choice(wrong).disabled, true);
  assert.equal(app.host.snapshot().progress, 0);
  assert.equal(app.time.timers.size, 0);
  app.correct();
  assert.equal(app.host.snapshot().phase, 'answered');
  app.time.tick(600);
  assert.notEqual(shade.getAttribute('d'), initial);
  assert.equal(app.host.snapshot().index, 0);
  app.time.tick(600);
  const finalPhase = shade.getAttribute('d');
  app.time.tick(86400000);
  assert.equal(app.host.snapshot().index, 0);
  assert.equal(app.time.timers.size, 0);
  app.continue(); app.continue();
  assert.equal(app.host.snapshot().index, 1);
  assert.equal(shade.getAttribute('d'), finalPhase, 'new question must not restart the previous phase animation');
});

test('pausing, hidden pages and controls retain feedback until an eligible Continue click', async t => {
  const app = await fixture(); t.after(() => app.host.destroy()); await app.host.ready;
  app.correct(); app.time.tick(500);
  app.host.setPaused(true);
  app.continue();
  const stoppedShade = app.root.querySelector('.moon-shade').getAttribute('d');
  app.time.tick(10000);
  assert.equal(app.host.snapshot().index, 0);
  assert.equal(app.root.querySelector('.moon-shade').getAttribute('d'), stoppedShade);
  app.host.setPaused(false); app.time.tick(1999);
  assert.equal(app.host.snapshot().index, 0);
  app.time.tick(86400000); assert.equal(app.host.snapshot().index, 0);
  app.continue(); assert.equal(app.host.snapshot().index, 1);
  app.correct(); app.visible(true); app.time.tick(10000);
  assert.equal(app.host.snapshot().index, 1);
  app.visible(false); app.controlsOptions.onOpenChange(true); app.time.tick(10000);
  app.continue();
  assert.equal(app.host.snapshot().index, 1);
  app.controlsOptions.onOpenChange(false); app.time.tick(2000);
  assert.equal(app.host.snapshot().index, 1);
  app.continue();
  assert.equal(app.host.snapshot().index, 2);
});

test('final review and its animation do not hand off campaign until Continue', async t => {
  const app = await fixture(); t.after(() => app.host.destroy()); await app.host.ready;
  app.host.setCampaign(true);
  assert.equal(app.host.snapshot().target, 3);
  for (let index = 0; index < MEMORY_MOON_ROUND_COUNT - 1; index++) { app.correct(); app.continue(); }
  app.correct();
  assert.equal(app.host.snapshot().phase, 'complete');
  assert.equal(app.messages.length, 0);
  assert.equal(app.root.querySelector('.moon-restart').hidden, true);
  app.time.tick(1200);
  assert.equal(app.root.querySelector('.moon-shade').getAttribute('d'), '');
  assert.equal(app.messages.length, 0);
  app.time.tick(86400000);
  assert.equal(app.messages.length, 0);
  app.continue(); app.continue();
  assert.deepEqual(app.messages, [[{ source: 'caatuu-game', type: 'round-complete', gameId: 'memory-moon' }, app.frame.window.location.origin]]);
  app.host.setActive(false); app.host.setActive(true); app.host.setCampaign(false);
  assert.equal(app.messages.length, 1);
  assert.equal(app.root.querySelector('.moon-restart').hidden, false);
  app.root.querySelector('.moon-restart').click(); await flush();
  assert.equal(app.host.snapshot().phase, 'question');
  assert.equal(app.host.snapshot().progress, 0);
});

test('entering a new campaign restarts a previously completed free-play moon', async t => {
  const app = await fixture(); t.after(() => app.host.destroy()); await app.host.ready;
  for (let index = 0; index < MEMORY_MOON_ROUND_COUNT; index++) { app.correct(); app.continue(); }
  assert.equal(app.host.snapshot().phase, 'complete');
  assert.equal(app.messages.length, 1);
  app.host.setActive(false); app.host.setCampaign(true); app.host.setActive(true); await flush();
  assert.equal(app.host.snapshot().phase, 'question');
  assert.equal(app.host.snapshot().progress, 0);
  for (let index = 0; index < MEMORY_MOON_ROUND_COUNT; index++) { app.correct(); app.continue(); }
  assert.equal(app.messages.length, 2);
});

test('leaving during the final animation and reentering campaign cancels the obsolete completion', async t => {
  const app = await fixture(); t.after(() => app.host.destroy()); await app.host.ready;
  app.host.setCampaign(true);
  for (let index = 0; index < MEMORY_MOON_ROUND_COUNT - 1; index++) { app.correct(); app.continue(); }
  app.correct(); app.time.tick(500);
  app.host.setCampaign(false); app.host.setActive(false);
  app.host.setCampaign(true); app.host.setActive(true); await flush();
  app.time.tick(2000);
  assert.equal(app.host.snapshot().phase, 'question');
  assert.equal(app.host.snapshot().progress, 0);
  assert.equal(app.messages.length, 0);
});

test('target audio delegates to shared speech and only acknowledges a live playback start', async t => {
  const app = await fixture({ directory: 'arabic-standard', speechAvailable: true, autoplay: false });
  t.after(() => app.host.destroy()); await app.host.ready;
  const word = app.root.querySelector('[data-spoken-word]'); word.click(); await flush();
  assert.equal(app.assists.length, 0);
  assert.equal(app.speechCalls[0].text, word.dataset.spokenWord);
  assert.deepEqual(Object.keys(app.speechCalls[0].options).sort(), ['allowWhileMuted', 'onStart']);
  app.speechCalls[0].options.onStart(); app.speechCalls[0].options.onStart();
  assert.deepEqual(app.assists, ['audio']);
  app.host.setActive(false);
  app.speechCalls[0].options.onStart(); app.speechCalls[0].resolve({ outcome: 'completed' }); await flush();
  assert.deepEqual(app.assists, ['audio']);
  assert.equal(app.root.querySelector('.moon-speak').getAttribute('aria-pressed'), 'false');
});

test('each new question automatically reads its target once across ready, advance and restart', async t => {
  const app = await fixture(); t.after(() => app.host.destroy()); await app.host.ready; await flush();
  assert.equal(app.controlsOptions.autoplay, true);
  assert.equal(app.speechCalls.length, 1);
  assert.equal(app.speechCalls[0].text, app.host.snapshot().currentItem.targetText);
  assert.equal(app.speechCalls[0].options.allowWhileMuted, false);
  const wrong = app.host.snapshot().currentItem.choices.find(choice => choice.id !== 'correct').id;
  app.choice(wrong).click(); app.host.setCampaign(true);
  app.host.setPaused(true); app.host.setPaused(false); await flush();
  assert.equal(app.speechCalls.length, 1, 'feedback, rendering and resumed activity cannot replay a prompt');
  app.correct(); app.continue(); await flush();
  assert.equal(app.speechCalls.length, 2);
  assert.equal(app.speechCalls[1].text, app.host.snapshot().currentItem.targetText);
  app.speechCalls[0].options.onStart();
  assert.deepEqual(app.assists, [], 'the preceding question cannot acknowledge a late audio start');
  app.speechCalls[1].options.onStart(); app.speechCalls[1].options.onStart();
  assert.deepEqual(app.assists, ['audio']);
  await app.host.restart(); await flush();
  assert.equal(app.speechCalls.length, 3, 'a fresh round presents its first question again');
  assert.equal(app.speechCalls[2].text, app.host.snapshot().currentItem.targetText);
});

test('mute and the persisted autoplay preference suppress automatic audio while manual replay remains available', async t => {
  for (const setting of ['muted', 'autoplay']) await t.test(setting, async t => {
    const app = await fixture(setting === 'muted' ? { muted: true } : { autoplay: false });
    t.after(() => app.host.destroy()); await app.host.ready; await flush();
    assert.equal(app.speechCalls.length, 0);
    app.root.querySelector('.moon-speak').click(); await flush();
    assert.equal(app.speechCalls.length, 1);
    assert.equal(app.speechCalls[0].options.allowWhileMuted, true);
    app.speechCalls[0].resolve({ outcome: 'completed' }); await flush();
    if (setting === 'muted') app.shell.CaatuuChrome.setSpeechMuted(false);
    else app.shell.CaatuuChrome.setSpeechAutoplay(true);
    await flush();
    assert.equal(app.speechCalls.length, 1, 'enabling audio cannot replay the current question');
    app.correct(); app.continue(); await flush();
    assert.equal(app.speechCalls.length, 2);
    assert.equal(app.speechCalls[1].options.allowWhileMuted, false);
  });
});

test('automatic speech cancels stale starts on every activity and audio boundary', async t => {
  const boundaries = {
    inactive: app => app.host.setActive(false),
    paused: app => app.host.setPaused(true),
    hidden: app => app.visible(true),
    menu: app => app.controlsOptions.onOpenChange(true),
    pagehide: app => app.frame.window.dispatchEvent({ type: 'pagehide' }),
    muted: app => app.shell.CaatuuChrome.setSpeechMuted(true),
    autoplay: app => app.shell.CaatuuChrome.setSpeechAutoplay(false),
    destroyed: app => app.host.destroy()
  };
  for (const [name, cancel] of Object.entries(boundaries)) await t.test(name, async t => {
    const app = await fixture(); t.after(() => app.host.destroy()); await app.host.ready; await flush();
    assert.equal(app.speechCalls.length, 1);
    cancel(app);
    app.speechCalls[0].options.onStart(); app.speechCalls[0].resolve({ outcome: 'completed' }); await flush();
    assert.deepEqual(app.assists, []);
    if (name !== 'destroyed') assert.equal(app.root.querySelector('.moon-speak').getAttribute('aria-pressed'), 'false');
  });
});

test('a queued automatic request cannot reach the speech backend after its question is hidden', async t => {
  const app = await fixture(); t.after(() => app.host.destroy()); await app.host.ready; await flush();
  const waiting = deferred();
  app.shell.CaatuuChrome.stopSpeech = () => waiting.promise;
  app.correct(); app.continue();
  app.visible(true); waiting.resolve(); await flush();
  assert.equal(app.speechCalls.length, 1);
  app.visible(false); await flush();
  assert.equal(app.speechCalls.length, 1, 'resuming does not revive the cancelled presentation');
});

test('Memory Moon exposes the shared Audio autoplay switch and uses its persisted value', async t => {
  const app = await fixture({ realControls: true }); t.after(() => app.host.destroy());
  await app.host.ready; await flush();
  const toggle = app.root.querySelector('[role="switch"]');
  assert.ok(toggle);
  assert.equal(toggle.textContent, 'common.audio.autoplay');
  assert.equal(toggle.getAttribute('aria-checked'), 'true');
  toggle.click();
  assert.equal(app.shell.CaatuuChrome.getSpeechAutoplay(), false);
  assert.equal(toggle.getAttribute('aria-checked'), 'false');
  app.correct(); app.continue(); await flush();
  assert.equal(app.speechCalls.length, 1);
  app.shell.CaatuuChrome.setSpeechMuted(true);
  assert.equal(toggle.disabled, true);
});

test('word help stays hidden until selected and only a visible meaning marks dictionary assistance', async t => {
  const waiting = deferred();
  const app = await fixture({ autoplay: false, resolveWord: () => waiting.promise });
  t.after(() => app.host.destroy()); await app.host.ready;
  const slot = app.root.querySelector('.moon-dictionary-slot');
  assert.equal(slot.hidden, true);
  assert.equal(app.wordLookups.length, 0);
  const word = app.root.querySelector('.moon-word-token');
  const item = app.host.snapshot().currentItem;
  word.click(); await flush();
  assert.equal(slot.hidden, false);
  assert.equal(slot.querySelector('.dictionary-word-card').classList.contains('is-loading'), true);
  assert.equal(word.classList.contains('is-dictionary-selected'), true);
  assert.equal(app.wordLookups.length, 1);
  assert.equal(app.wordLookups[0].word, word.dataset.spokenWord);
  assert.equal(app.wordLookups[0].item, item);
  assert.equal(app.wordLookups[0].tokenIndex, Number(word.dataset.tokenIndex));
  assert.equal(app.wordLookups[0].button, word);
  assert.deepEqual(app.assists, []);
  waiting.resolve({ meaning: 'scarf', languageTag: app.course.sourceLanguage.locale, pos: 'noun' });
  await flush();
  assert.equal(slot.querySelector('.dictionary-word-card__meaning').textContent, 'scarf');
  assert.equal(slot.querySelector('.dictionary-word-card__meaning').lang, app.course.sourceLanguage.locale);
  assert.equal(slot.querySelector('.dictionary-word-card').classList.contains('is-loading'), false);
  assert.deepEqual(app.assists, ['dictionary']);
  app.correct();
  assert.equal(slot.hidden, false, 'the current meaning remains available during answer review');
  assert.equal(word.classList.contains('is-dictionary-selected'), true);
  app.time.tick(10000);
  assert.equal(app.host.snapshot().currentItem, item, 'review remains until Continue');
  slot.querySelector('.moon-dictionary-close').click();
  assert.equal(word.classList.contains('is-dictionary-selected'), false);
  app.time.tick(2000); await flush();
  assert.equal(app.host.snapshot().currentItem, item);
  app.continue(); await flush();
  assert.notEqual(app.host.snapshot().currentItem, item);
  assert.equal(slot.hidden, true);
  assert.equal(slot.querySelector('.dictionary-word-card__meaning').textContent, '');
  assert.equal(app.wordLookups.length, 1, 'a new question never opens or loads help automatically');
});

test('pending word meanings cannot mark assistance after their question loses eligibility', async t => {
  const boundaries = {
    hidden: app => app.visible(true),
    inactive: app => app.host.setActive(false),
    paused: app => app.host.setPaused(true),
    menu: app => app.controlsOptions.onOpenChange(true),
    reset: app => app.shell.dispatchEvent({ type: 'caatuu:learning-change', detail: { reason: 'progress-reset' } }),
    destroy: app => app.host.destroy()
  };
  for (const [name, cancel] of Object.entries(boundaries)) await t.test(name, async t => {
    const waiting = deferred();
    const app = await fixture({ autoplay: false, resolveWord: () => waiting.promise });
    t.after(() => app.host.destroy()); await app.host.ready;
    const slot = app.root.querySelector('.moon-dictionary-slot');
    app.root.querySelector('.moon-word-token').click(); await flush();
    assert.equal(slot.hidden, false);
    assert.equal(app.wordLookups[0].signal.aborted, false);
    cancel(app);
    assert.equal(app.wordLookups[0].signal.aborted, true);
    waiting.resolve({ meaning: 'obsolete meaning' }); await flush();
    assert.deepEqual(app.assists, []);
    assert.equal(slot.hidden, true);
    if (name === 'destroy') assert.equal(app.root.children.length, 0);
    else assert.equal(slot.querySelector('.dictionary-word-card__meaning').textContent, '');
    if (name === 'hidden') {
      app.visible(false); await flush();
      assert.equal(slot.hidden, true);
      assert.equal(app.wordLookups.length, 1, 'returning does not revive the cancelled help');
    }
  });
});

test('a pending meaning can finish after grading without changing independent answer evidence', async t => {
  const waiting = deferred();
  const app = await fixture({ autoplay: false, speechAvailable: false, resolveWord: () => waiting.promise });
  t.after(() => app.host.destroy()); await app.host.ready;
  const word = app.root.querySelector('.moon-word-token');
  word.click(); await flush();
  app.correct();
  const graded = app.host.snapshot();
  assert.equal(graded.independentCorrectCount, 1);
  assert.deepEqual(app.assists, []);
  waiting.resolve({ meaning: 'review meaning' }); await flush();
  const slot = app.root.querySelector('.moon-dictionary-slot');
  assert.equal(slot.hidden, false);
  assert.equal(slot.querySelector('.dictionary-word-card__meaning').textContent, 'review meaning');
  assert.deepEqual(app.assists, [], 'help discovered after grading does not rewrite the earned result');
  assert.equal(app.host.snapshot(), graded);
  app.time.tick(10000);
  assert.equal(app.host.snapshot().index, 0);
  slot.querySelector('.moon-dictionary-close').click();
  app.time.tick(1999); assert.equal(app.host.snapshot().index, 0);
  app.time.tick(86400000); assert.equal(app.host.snapshot().index, 0);
  app.continue(); assert.equal(app.host.snapshot().index, 1);
});

test('answered sentences can open dictionary help without speech or changing the earned result', async t => {
  const app = await fixture({ autoplay: false, speechAvailable: false,
    resolveWord: async () => ({ meaning: 'review meaning' }) });
  t.after(() => app.host.destroy()); await app.host.ready;
  app.correct();
  const graded = app.host.snapshot();
  const word = app.root.querySelector('.moon-word-token');
  assert.equal(word.disabled, false);
  word.click(); await flush(); app.time.tick(10000);
  assert.equal(app.root.querySelector('.moon-dictionary-slot').hidden, false);
  assert.equal(app.host.snapshot(), graded);
  assert.deepEqual(app.assists, []);
  assert.equal(app.speechCalls.length, 0);
  assert.ok(app.root.querySelectorAll('.moon-choice').every(choice => choice.disabled));
});

test('audio completion and failure leave answer review pending until Continue', async t => {
  for (const outcome of ['completed', 'error']) await t.test(outcome, async t => {
    const app = await fixture({ autoplay: false });
    t.after(() => app.host.destroy()); await app.host.ready;
    app.correct();
    const graded = app.host.snapshot(), speak = app.root.querySelector('.moon-speak');
    assert.equal(speak.disabled, false);
    speak.click(); await flush();
    assert.equal(app.speechCalls.length, 1);
    app.time.tick(10000);
    assert.equal(app.host.snapshot(), graded, 'queued speech holds the current answer');
    app.speechCalls[0].options.onStart();
    app.time.tick(10000);
    assert.equal(app.host.snapshot(), graded, 'playing speech holds the current answer');
    assert.deepEqual(app.assists, []);
    app.speechCalls[0].resolve({ outcome, message: 'offline' }); await flush();
    assert.equal(speak.disabled, false);
    app.time.tick(1999); assert.equal(app.host.snapshot(), graded);
    app.time.tick(86400000); assert.equal(app.host.snapshot(), graded);
    app.continue(); assert.equal(app.host.snapshot().index, 1);
  });
});

test('the final sentence and choices remain reviewable until Continue', async t => {
  const app = await fixture({ autoplay: false });
  t.after(() => app.host.destroy()); await app.host.ready;
  app.host.setCampaign(true);
  for (let index = 0; index < MEMORY_MOON_ROUND_COUNT - 1; index++) { app.correct(); app.continue(); }
  const item = app.host.snapshot().currentItem;
  app.correct();
  assert.equal(surfaceText(app.root.querySelector('.moon-sentence')), item.targetText);
  assert.equal(app.root.querySelector('.moon-speak').hidden, false);
  assert.equal(app.root.querySelector('.moon-speak').disabled, false);
  assert.deepEqual(app.root.querySelectorAll('.moon-choice').map(choice => choice.textContent), item.choices.map(choice => choice.text));
  assert.ok(app.root.querySelectorAll('.moon-choice').every(choice => choice.disabled));
  assert.equal(app.choice(item.correctChoiceId).classList.contains('is-correct'), true);
  assert.equal(app.messages.length, 0);
  app.root.querySelector('.moon-speak').click(); await flush();
  app.time.tick(10000); assert.equal(app.messages.length, 0);
  app.speechCalls[0].options.onStart();
  app.speechCalls[0].resolve({ outcome: 'completed' }); await flush();
  assert.deepEqual(app.assists, []);
  app.time.tick(1999); assert.equal(app.messages.length, 0);
  app.time.tick(86400000); assert.equal(app.messages.length, 0);
  app.continue(); app.continue(); assert.equal(app.messages.length, 1);
  assert.equal(app.root.querySelector('.moon-speak').hidden, true);
  assert.equal(app.root.querySelectorAll('.moon-choice').length, 0);
});

test('reset during final review fences obsolete audio, meanings and a retained Continue control', async t => {
  const waiting = deferred();
  const app = await fixture({ autoplay: false, resolveWord: () => waiting.promise });
  t.after(() => app.host.destroy()); await app.host.ready;
  app.host.setCampaign(true);
  for (let index = 0; index < MEMORY_MOON_ROUND_COUNT - 1; index++) { app.correct(); app.continue(); }
  app.correct();
  const continueButton = app.root.querySelector('.moon-continue');
  assert.equal(app.time.timers.size, 0);
  app.root.querySelector('.moon-word-token').click(); await flush();
  assert.equal(app.messages.length, 0);
  app.shell.dispatchEvent({ type: 'caatuu:learning-change', detail: { reason: 'progress-reset' } });
  await flush();
  waiting.resolve({ meaning: 'obsolete review' });
  app.speechCalls[0].options.onStart(); app.speechCalls[0].resolve({ outcome: 'completed' });
  continueButton.click(); await flush(); app.time.tick(86400000);
  assert.equal(app.host.snapshot().phase, 'question');
  assert.equal(app.host.snapshot().progress, 0);
  assert.equal(app.root.querySelector('.moon-dictionary-slot').hidden, true);
  assert.equal(app.messages.length, 0);
  assert.deepEqual(app.assists, []);
});

test('explicit Continue closes help and stops pending replay before moving once', async t => {
  const waiting = deferred();
  const app = await fixture({ autoplay: false, resolveWord: () => waiting.promise });
  t.after(() => app.host.destroy()); await app.host.ready;
  app.correct();
  const button = app.root.querySelector('.moon-continue');
  app.root.querySelector('.moon-word-token').click(); await flush();
  assert.equal(button.disabled, false);
  button.click(); button.click();
  assert.equal(app.host.snapshot().index, 1);
  assert.equal(app.root.querySelector('.moon-dictionary-slot').hidden, true);
  assert.equal(app.wordLookups[0].signal.aborted, true);
  waiting.resolve({ meaning: 'old meaning' });
  app.speechCalls[0].options.onStart(); app.speechCalls[0].resolve({ outcome: 'completed' }); await flush();
  assert.deepEqual(app.assists, []);
  assert.equal(app.host.snapshot().index, 1);
  assert.equal(button.hidden, true);
});

test('missing dictionary meanings preserve an independent answer without claiming help was shown', async t => {
  const app = await fixture({ autoplay: false }); t.after(() => app.host.destroy()); await app.host.ready;
  app.root.querySelector('.moon-word-token').click(); await flush();
  assert.equal(app.root.querySelector('.moon-dictionary-slot').hidden, false);
  assert.ok(app.root.querySelector('.dictionary-word-card__meaning').textContent);
  assert.deepEqual(app.assists, []);
  app.correct();
  assert.equal(app.host.snapshot().phase, 'answered');
  assert.deepEqual(app.assists, []);
});

test('navigation fences late selection and resumes with a fresh session', async t => {
  const wait = deferred(); const app = await fixture({ selectionWait: wait });
  t.after(() => app.host.destroy()); await flush();
  assert.equal(app.starts.length, 1);
  app.host.setActive(false); wait.resolve(); await app.host.ready;
  assert.equal(app.host.snapshot(), null);
  assert.equal(app.cancelled > 0, true);
  assert.equal(app.starts[0].signal.aborted, true);
  app.host.setActive(true); await flush();
  assert.equal(app.starts.length, 2);
  assert.equal(app.host.snapshot().phase, 'question');
});

test('an initially inactive embedded tab starts selection only when activated', async t => {
  const app = await fixture({ initialActive: false }); t.after(() => app.host.destroy());
  await app.host.ready;
  assert.equal(app.host.snapshot(), null);
  assert.equal(app.starts.length, 0);
  app.host.setActive(true); await flush();
  assert.equal(app.starts.length, 1);
  assert.equal(app.host.snapshot().phase, 'question');
});

test('destroy fences late catalog callbacks and releases animation/timer listeners', async () => {
  const wait = deferred(); const app = await fixture({ catalogWait: wait });
  app.host.destroy(); wait.resolve(); await app.host.ready;
  assert.equal(app.host.snapshot(), null);
  assert.equal(app.starts.length, 0);
  assert.equal(app.root.children.length, 0);
  assert.equal(app.time.frames.size, 0);
  assert.equal(app.time.timers.size, 0);
  app.host.setActive(true); await app.host.restart();
  assert.equal(app.starts.length, 0);
});

test('progress reset cancels feedback and starts a fresh moon', async t => {
  const app = await fixture(); t.after(() => app.host.destroy()); await app.host.ready;
  app.correct(); app.time.tick(500);
  app.shell.dispatchEvent({ type: 'caatuu:learning-change', detail: { reason: 'progress-reset' } });
  await flush(); app.time.tick(2000);
  assert.equal(app.host.snapshot().index, 0);
  assert.equal(app.host.snapshot().progress, 0);
  assert.equal(app.host.snapshot().phase, 'question');
});

test('a synchronous progress-reset evidence listener cannot restore the obsolete answer', async t => {
  const app = await fixture({ resetDuringAnswer: true }); t.after(() => app.host.destroy()); await app.host.ready;
  app.correct();
  assert.equal(app.host.snapshot(), null);
  assert.equal(app.time.timers.size, 0);
  await flush();
  assert.equal(app.host.snapshot().progress, 0);
  assert.equal(app.host.snapshot().phase, 'question');
});

test('standard controls mount against the local frame even when speech is unavailable', async t => {
  const app = await fixture({ speechAvailable: false, realControls: true });
  t.after(() => app.host.destroy()); await app.host.ready;
  assert.ok(app.root.querySelector('.caatuu-game-controls'));
  assert.equal(app.root.querySelector('.moon-speak').hidden, true);
  const word = app.root.querySelector('[data-spoken-word]');
  assert.ok(word, 'word meanings remain available without speech');
  word.click(); await flush();
  assert.equal(app.root.querySelector('.moon-dictionary-slot').hidden, false);
  assert.equal(app.wordLookups.length, 1);
  assert.equal(app.speechCalls.length, 0);
  assert.equal(app.root.querySelector('.moon-sentence').textContent, app.host.snapshot().currentItem.targetText);
});

test('tokenization preserves each target script without splitting combining marks in the fallback', () => {
  for (const [locale, text] of [['ar', 'يَقْرَأُ الطِّفْلُ.'], ['ka', 'ბავშვი წიგნს კითხულობს.'],
    ['zh-CN', '孩子在看书。'], ['nb', 'Toget kommer snart.']]) {
    for (const Segmenter of [Intl.Segmenter, null]) {
      const parts = tokenizeMoonText(text, locale, Segmenter);
      assert.equal(parts.map(part => part.text).join(''), text.normalize('NFC'));
      assert.ok(parts.some(part => part.word));
      assert.ok(parts.filter(part => part.word).every(part => !/^\p{M}/u.test(part.text)));
    }
  }
});

test('interface labels use the shared catalog with structured parameters', () => {
  const calls = [];
  const labels = moonLabels({ sourceLanguage: { locale: 'es' } }, { t(key, parameters) {
    calls.push({ key, parameters });
    return `catalog:${key}`;
  } });
  assert.equal(labels.game, 'catalog:games.memorymoon.practice');
  assert.equal(labels.round(2, 6), 'catalog:games.memorymoon.round');
  assert.equal(labels.word('palabra'), 'catalog:games.memorymoon.word');
  assert.equal(labels.illumination(75), 'catalog:games.memorymoon.illumination');
  assert.deepEqual(calls.find(call => call.key.endsWith('.round')).parameters, { index: 2, total: 6 });
  assert.deepEqual(calls.find(call => call.key.endsWith('.word')).parameters, { text: 'palabra' });
  assert.deepEqual(calls.find(call => call.key.endsWith('.illumination')).parameters, { percent: 75 });
});
