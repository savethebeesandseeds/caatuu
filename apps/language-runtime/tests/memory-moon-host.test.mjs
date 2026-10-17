import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createBrowserHarness } from './helpers/fake-browser.mjs';
import { mountMemoryMoon } from '../static/source/games/memory-moon/memory-moon-host.mjs';
import { createMoonSession, answerMoonChallenge, advanceMoonChallenge } from '../static/source/games/memory-moon/memory-moon-core.mjs';
import { tokenizeMoonText, moonLabels } from '../static/source/games/memory-moon/memory-moon-render.mjs';

const directories = ['czech', 'mandarin-simplified', 'spanish', 'english-from-spanish',
  'norwegian-bokmal', 'arabic-standard', 'latin-scientific', 'georgian'];
const json = async relative => JSON.parse(await readFile(new URL(relative, import.meta.url), 'utf8'));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function flush() { for (let index = 0; index < 12; index++) await Promise.resolve(); }

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
  speechAvailable, initialActive = true, resetDuringAnswer = false } = {}) {
  const [originalCourse, pack] = await Promise.all([
    json(`../../languages/${directory}/course.json`),
    json(`../../languages/${directory}/static/data/games/memory-moon/content.json`)
  ]);
  const course = structuredClone(originalCourse);
  if (speechAvailable !== undefined) course.capabilities.speech = speechAvailable;
  const time = clock(), messages = [], speechCalls = [], starts = [], assists = [];
  const shell = createBrowserHarness({ course }).window;
  shell.postMessage = (...args) => messages.push(args);
  shell.CaatuuI18n = { t: key => key, languageName: locale => locale };
  shell.CaatuuChrome = {
    applyTheme() {}, applyFontSize() {},
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
      session = createMoonSession(pack.challenges.filter(item => item.difficulty === 1).slice(0, 6));
    },
    snapshot: () => session ? { ...session, currentItem: session.items[session.index], saveStatus: 'ready' } : null,
    answer(id) {
      session = answerMoonChallenge(session, id);
      const result = this.snapshot();
      if (resetDuringAnswer) shell.dispatchEvent({ type: 'caatuu:learning-change', detail: { reason: 'progress-reset' } });
      return result;
    },
    assist(reason) { assists.push(reason); },
    advance() { session = advanceMoonChallenge(session); return this.snapshot(); },
    cancelPending() { cancelled++; }, dispose() { disposed = true; }
  };
  const services = {
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
  return { host, root, shell, frame, course, pack, time, messages, speechCalls, assists, starts,
    get disposed() { return disposed; }, get cancelled() { return cancelled; },
    get controlsOptions() { return controlsOptions; }, get requestOptions() { return requestOptions; },
    choice(id) { return root.querySelector(`[data-choice-id="${id}"]`); },
    correct() { const item = host.snapshot().currentItem; this.choice(item.correctChoiceId).click(); },
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
    assert.equal(sentence.textContent, item.targetText);
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

test('incorrect feedback shakes only the rejected alternative and a correction animates before advancing', async t => {
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
  app.time.tick(800);
  assert.equal(app.host.snapshot().index, 1);
  assert.equal(shade.getAttribute('d'), finalPhase, 'new question must not restart the previous phase animation');
});

test('pausing, hidden pages and controls retain feedback and require a fresh visible two-second delay', async t => {
  const app = await fixture(); t.after(() => app.host.destroy()); await app.host.ready;
  app.correct(); app.time.tick(500);
  app.host.setPaused(true);
  const stoppedShade = app.root.querySelector('.moon-shade').getAttribute('d');
  app.time.tick(10000);
  assert.equal(app.host.snapshot().index, 0);
  assert.equal(app.root.querySelector('.moon-shade').getAttribute('d'), stoppedShade);
  app.host.setPaused(false); app.time.tick(1999);
  assert.equal(app.host.snapshot().index, 0);
  app.time.tick(1); assert.equal(app.host.snapshot().index, 1);
  app.correct(); app.visible(true); app.time.tick(10000);
  assert.equal(app.host.snapshot().index, 1);
  app.visible(false); app.controlsOptions.onOpenChange(true); app.time.tick(10000);
  assert.equal(app.host.snapshot().index, 1);
  app.controlsOptions.onOpenChange(false); app.time.tick(2000);
  assert.equal(app.host.snapshot().index, 2);
});

test('final reward completes its animation before the single campaign completion message', async t => {
  const app = await fixture(); t.after(() => app.host.destroy()); await app.host.ready;
  app.host.setCampaign(true);
  for (let index = 0; index < 5; index++) { app.correct(); app.time.tick(2000); }
  app.correct();
  assert.equal(app.host.snapshot().phase, 'complete');
  assert.equal(app.messages.length, 0);
  assert.equal(app.root.querySelector('.moon-restart').hidden, true);
  app.time.tick(1200);
  assert.equal(app.root.querySelector('.moon-shade').getAttribute('d'), '');
  assert.equal(app.messages.length, 0);
  app.time.tick(800);
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
  for (let index = 0; index < 6; index++) { app.correct(); app.time.tick(2000); }
  assert.equal(app.host.snapshot().phase, 'complete');
  assert.equal(app.messages.length, 1);
  app.host.setActive(false); app.host.setCampaign(true); app.host.setActive(true); await flush();
  assert.equal(app.host.snapshot().phase, 'question');
  assert.equal(app.host.snapshot().progress, 0);
  for (let index = 0; index < 6; index++) { app.correct(); app.time.tick(2000); }
  assert.equal(app.messages.length, 2);
});

test('leaving during the final animation and reentering campaign cancels the obsolete completion', async t => {
  const app = await fixture(); t.after(() => app.host.destroy()); await app.host.ready;
  app.host.setCampaign(true);
  for (let index = 0; index < 5; index++) { app.correct(); app.time.tick(2000); }
  app.correct(); app.time.tick(500);
  app.host.setCampaign(false); app.host.setActive(false);
  app.host.setCampaign(true); app.host.setActive(true); await flush();
  app.time.tick(2000);
  assert.equal(app.host.snapshot().phase, 'question');
  assert.equal(app.host.snapshot().progress, 0);
  assert.equal(app.messages.length, 0);
});

test('target audio delegates to shared speech and only acknowledges a live playback start', async t => {
  const app = await fixture({ directory: 'arabic-standard', speechAvailable: true });
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
  assert.equal(app.root.querySelector('[data-spoken-word]'), null);
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
