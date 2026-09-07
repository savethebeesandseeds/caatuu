import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { createBrowserHarness } from '../../../language-runtime/tests/helpers/fake-browser.mjs';
import * as launcherInterface from '../../../language-runtime/static/source/launcher-interface.mjs';
import { projectPagesLauncherSource } from '../build-pages-site.mjs';

const source = await readFile(new URL('../../static/launcher.js', import.meta.url), 'utf8');
const registry = JSON.parse(await readFile(new URL('../../static/languages.json', import.meta.url), 'utf8'));
const settle = async () => { for (let index = 0; index < 3; index++) await new Promise(resolve => setImmediate(resolve)); };

async function launch(script, { courses = registry, valid = true, preferences = {} } = {}) {
  const browser = createBrowserHarness({ localStorageValues: preferences,
    location: { href: 'https://caatuu.test/', pathname: '/' } });
  const { document, window, context } = browser;
  function element(tag, attribute, parent = document.body) {
    const node = document.createElement(tag);
    if (attribute) node.setAttribute(attribute, '');
    parent.append(node);
    return node;
  }
  const list = element('ul', 'data-language-list');
  const entry = element('a', 'data-browser-entry');
  element('b', null, entry);
  const download = element('a', 'data-android-download');
  element('b', null, download);
  element('small', null, download);
  const control = element('label', 'data-language-control');
  const label = element('span', null, control);
  label.setAttribute('data-i18n', 'launcher.language');
  const select = element('select', 'data-page-language', control);
  select.setAttribute('data-i18n-aria-label', 'launcher.language');
  window.navigator.languages = ['es-MX', 'en'];
  const requests = [];
  context.fetch = window.fetch = async (path) => {
    requests.push(path);
    return { ok: true, json: async () => path.startsWith('/languages.json') ? structuredClone(courses) : ({
      package_name: valid ? 'com.waajacu.caatuu' : 'another.app',
      version_code: Math.max(...courses.languages.flatMap(course => course.platforms.android.channels.map(channel => channel.minimumVersionCode))),
      build_type: 'release', debuggable: false
    }) };
  };
  context.launcherInterface = launcherInterface;
  const executable = script.replace(/import\("\/language-runtime\/static\/source\/launcher-interface\.mjs\?[^"]+"\)/u, 'Promise.resolve(launcherInterface)');
  vm.runInContext(executable, context);
  await settle();
  return { ...browser, list, entry, download, control, select, label, requests };
}

for (const [name, script] of [['server', source], ['Pages', projectPagesLauncherSource(source)]]) {
  test(`${name}: page language keeps all courses, the browser entry and APK available`, async () => {
    const app = await launch(script, { preferences: { 'caatuu.launcher.sourceLocale.v1': 'es-ES', 'course.progress': 'preserve' } });
    const ids = () => app.list.children.map(item => item.dataset.languageId);
    assert.equal(app.document.documentElement.lang, 'es-ES');
    assert.deepEqual(ids(), registry.browserSetup.courses.map(course => course.id));
    assert.equal(app.entry.href, registry.browserSetup.entryPath);
    assert.equal(app.download.hidden, false);
    assert.equal(app.download.dataset.state, 'available');
    const href = app.download.href;
    const spanishLabel = app.download.querySelector('b').textContent;
    assert.match(spanishLabel, /Caatuu/u);
    for (const locale of ['en', 'es-ES']) {
      app.select.value = locale;
      app.select.dispatchEvent({ type: 'change' });
      await settle();
      assert.equal(app.document.documentElement.lang, locale, 'export must retain the change handler');
      assert.deepEqual(ids(), registry.browserSetup.courses.map(course => course.id));
      assert.equal(app.download.href, href);
      assert.equal(app.download.hidden, false);
      assert.equal(app.download.dataset.state, 'available');
      assert.equal(app.entry.href, registry.browserSetup.entryPath);
      assert.equal(app.document.querySelector('[data-browser-entry]'), app.entry);
      assert.equal(app.document.querySelector('[data-android-download]'), app.download);
    }
    assert.equal(app.localStorage.getItem('caatuu.launcher.sourceLocale.v1'), 'es-ES');
    assert.equal(app.localStorage.getItem('course.progress'), 'preserve');
    assert.equal(app.localStorage.getItem('caatuu.launcher.interfaceLocale.v1'), 'es-ES');
  });
}

test('Pages remains translatable when only English-base courses are published', async () => {
  const courses = structuredClone(registry);
  courses.browserSetup.courses = courses.browserSetup.courses.filter(course => course.sourceLanguage.locale === 'en');
  const app = await launch(projectPagesLauncherSource(source), { courses });
  assert.equal(app.document.documentElement.lang, 'es-ES');
  assert.equal(app.download.dataset.state, 'available');
  assert.deepEqual(app.list.children.map(item => item.dataset.languageId), courses.browserSetup.courses.map(course => course.id));
  assert.deepEqual(app.select.children.map(option => option.value), launcherInterface.launcherLocales.map(locale => locale.locale));
});

test('invalid Android manifests remain a visible retry action in either page language', async () => {
  const app = await launch(source, { valid: false });
  for (const locale of ['en', 'es-ES']) {
    app.select.value = locale;
    app.select.dispatchEvent({ type: 'change' });
    await settle();
    assert.equal(app.download.hidden, false);
    assert.equal(app.download.dataset.state, 'retry');
    assert.equal(app.download.hasAttribute('href'), false);
  }
});
