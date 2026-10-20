import assert from 'node:assert/strict';
import test from 'node:test';
import { createBrowserHarness } from './helpers/fake-browser.mjs';
import { startMemoryMoon } from '../static/source/games/memory-moon/memory-moon-entry.mjs';

function fixture({ selected = true, hidden = false, reward = false, wait = false, campaign = false } = {}) {
  const course = { id: 'ar', routePrefix: '/ar', sourceLanguage: { locale: 'es', direction: 'ltr' } };
  const shell = createBrowserHarness({ course }).window;
  const frame = createBrowserHarness();
  frame.window.parent = shell;
  shell.CaatuuGameDynamics = { active: reward };
  const view = shell.document.createElement('section');
  view.id = 'view-verbs';
  view.classList.toggle('is-active', selected);
  const panel = shell.document.createElement('section');
  panel.setAttribute('data-train-panel', 'memory-moon');
  panel.hidden = hidden;
  view.append(panel); shell.document.body.append(view);
  shell.document.body.dataset.campaignActive = String(campaign);
  shell.document.documentElement.dataset.theme = 'dark';
  shell.document.documentElement.dataset.fontSize = 'largest';
  const root = frame.document.createElement('main');
  root.id = 'memoryMoonRoot'; frame.document.body.append(root);
  const calls = []; let phase = 'question', release, options;
  const mounted = new Promise(resolve => { release = resolve; });
  const controller = {
    setActive(value) { calls.push(['active', value]); },
    setPaused(value) { calls.push(['paused', value]); },
    setCampaign(value) { calls.push(['campaign', value]); },
    restart() { calls.push(['restart']); phase = 'question'; return Promise.resolve(); },
    destroy() { calls.push(['destroy']); },
    snapshot: () => ({ phase }), ready: Promise.resolve()
  };
  const starting = startMemoryMoon(frame.window, { mount: async received => {
    options = received;
    if (wait) await mounted;
    return controller;
  } });
  return { shell, frame, root, calls, starting, release,
    get options() { return options; },
    complete() { phase = 'complete'; },
    message(data, overrides = {}) {
      frame.window.dispatchEvent({ type: 'message', origin: frame.window.location.origin,
        source: shell, data: { source: 'caatuu-app-shell', ...data }, ...overrides });
    }
  };
}

test('entry reads the actual selected workspace view/panel and respects reward overlays', async () => {
  for (const options of [{ selected: true, hidden: false, reward: false },
    { selected: false }, { hidden: true }, { reward: true }]) {
    const app = fixture(options); const controller = await app.starting;
    const expected = options.selected !== false && options.hidden !== true && options.reward !== true;
    assert.equal(app.options.active, expected);
    assert.equal(app.options.root.ownerDocument, app.frame.document);
    assert.equal(app.options.shell, app.shell);
    assert.equal(app.options.course.id, 'ar');
    assert.equal(app.frame.document.documentElement.lang, 'es');
    assert.equal(app.frame.document.documentElement.dir, 'ltr');
    controller.destroy();
  }
});

test('visibility and appearance messages require the exact same-origin parent authority', async () => {
  const app = fixture(); const controller = await app.starting;
  app.calls.length = 0;
  app.message({ type: 'visibility', active: false, theme: 'light' }, { origin: 'https://other.test' });
  app.message({ type: 'visibility', active: false, theme: 'light' }, { source: {} });
  app.message({ type: 'visibility', active: false, theme: 'light', source: 'other-source' });
  assert.deepEqual(app.calls, []);
  assert.equal(app.frame.document.documentElement.dataset.theme, 'dark');
  app.message({ type: 'visibility', active: false, theme: 'light', fontSize: 'large' });
  assert.deepEqual(app.calls, [['campaign', false], ['active', false]]);
  assert.equal(app.frame.document.documentElement.dataset.theme, 'light');
  assert.equal(app.frame.document.documentElement.dataset.fontSize, 'large');
  app.message({ type: 'visibility', active: 'true', theme: 'invalid', fontSize: 'invalid' });
  assert.deepEqual(app.calls.at(-1), ['active', false]);
  assert.equal(app.frame.document.documentElement.dataset.theme, 'light');
  app.message({ type: 'theme', theme: 'dark' });
  app.message({ type: 'fontSize', fontSize: 'standard' });
  assert.equal(app.frame.document.documentElement.dataset.theme, 'dark');
  assert.equal(app.frame.document.documentElement.dataset.fontSize, 'standard');
  controller.destroy();
});

test('an early visibility message wins over initial active state while mounting', async () => {
  const app = fixture({ wait: true });
  assert.equal(app.options.active, true);
  app.message({ type: 'visibility', active: false });
  app.release(); const controller = await app.starting;
  assert.deepEqual(app.calls.find(call => call[0] === 'active'), ['active', false]);
  controller.destroy();
});

test('non-persisted pagehide before mount completion destroys the late controller once', async () => {
  const app = fixture({ wait: true });
  app.frame.window.dispatchEvent({ type: 'pagehide', persisted: false });
  app.release(); assert.equal(await app.starting, null);
  assert.deepEqual(app.calls, [['destroy']]);
  app.message({ type: 'visibility', active: true });
  app.frame.window.dispatchEvent({ type: 'pageshow', persisted: false });
  assert.deepEqual(app.calls, [['destroy']]);
});

test('back-forward cached pages retain pause state during mount and resume on pageshow', async () => {
  const app = fixture({ wait: true });
  app.frame.window.dispatchEvent({ type: 'pagehide', persisted: true });
  app.release(); const controller = await app.starting;
  assert.deepEqual(app.calls.find(call => call[0] === 'paused'), ['paused', true]);
  app.frame.window.dispatchEvent({ type: 'pageshow', persisted: true });
  assert.deepEqual(app.calls.at(-2), ['paused', false]);
  assert.deepEqual(app.calls.at(-1), ['active', true]);
  controller.destroy(); controller.destroy();
  assert.equal(app.calls.filter(call => call[0] === 'destroy').length, 1);
});

test('campaign advance silently resets the completed campaign moon while suspended', async () => {
  const app = fixture({ campaign: true }); const controller = await app.starting;
  app.message({ type: 'campaign-advance' });
  assert.equal(app.calls.some(call => call[0] === 'restart'), false);
  app.complete(); app.message({ type: 'visibility', active: false });
  app.calls.length = 0;
  app.message({ type: 'campaign-advance' });
  assert.deepEqual(app.calls, [['active', false], ['restart']]);
  app.message({ type: 'campaign-advance' });
  assert.equal(app.calls.filter(call => call[0] === 'restart').length, 1);
  app.calls.length = 0;
  app.complete();
  app.message({ type: 'visibility', active: true });
  app.shell.document.body.dataset.campaignActive = 'false';
  app.message({ type: 'campaign-advance' });
  assert.equal(app.calls.some(call => call[0] === 'restart'), false);
  app.shell.document.body.dataset.campaignActive = 'true';
  app.message({ type: 'campaign-advance' }); app.message({ type: 'campaign-advance' });
  assert.equal(app.calls.filter(call => call[0] === 'restart').length, 1);
  assert.deepEqual(app.calls.slice(-2), [['active', false], ['restart']]);
  controller.dispose();
  app.message({ type: 'visibility', active: false });
  assert.deepEqual(app.calls.at(-1), ['destroy']);
});
