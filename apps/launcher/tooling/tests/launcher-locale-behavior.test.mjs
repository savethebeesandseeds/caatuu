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

async function launch(script, { courses = registry, valid = true, preferences = {}, versionCode } = {}) {
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
  const previous = element('button', 'data-course-previous');
  const next = element('button', 'data-course-next');
  list.clientWidth = list.scrollWidth = 800;
  list.scrollLeft = 0;
  const bounces = [];
  list.animate = (frames) => { bounces.push(frames); return { cancel() {} }; };
  list.scrollBy = ({ left }) => {
    list.scrollLeft = Math.max(0, Math.min(list.scrollWidth - list.clientWidth, list.scrollLeft + left));
    list.dispatchEvent({ type: 'scroll' });
  };
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
  const audioMenu = element('details', 'data-audio-menu');
  const audioToggle = element('summary', null, audioMenu);
  audioToggle.setAttribute('data-i18n-aria-label', 'common.audio.settings');
  const musicControls = element('div', 'data-music-controls', audioMenu);
  const musicLocales = [];
  window.addEventListener('caatuu:interfacechange', (event) => musicLocales.push(event.detail.content));
  const dialog = element('dialog', 'data-course-dialog');
  const dismiss = element('button', 'data-course-dialog-close', dialog);
  element('h2', 'data-course-dialog-title', dialog);
  element('img', 'data-course-dialog-flag', dialog);
  const dialogBrowser = element('a', 'data-course-dialog-browser', dialog);
  const dialogAndroid = element('a', 'data-course-dialog-android', dialog);
  const dialogStatus = element('p', 'data-course-dialog-status', dialog);
  window.navigator.languages = ['es-MX', 'en'];
  const requests = [];
  context.fetch = window.fetch = async (path) => {
    requests.push(path);
    return { ok: true, json: async () => path.startsWith('/languages.json') ? structuredClone(courses) : ({
      package_name: valid ? 'com.waajacu.caatuu' : 'another.app',
      version_code: versionCode ?? Math.max(...courses.languages.flatMap(course => course.platforms.android.channels.map(channel => channel.minimumVersionCode))),
      build_type: 'release', debuggable: false
    }) };
  };
  context.launcherInterface = launcherInterface;
  const executable = script.replace(/import\("\/language-runtime\/static\/source\/launcher-interface\.mjs\?[^"]+"\)/u, 'Promise.resolve(launcherInterface)');
  vm.runInContext(executable, context);
  await settle();
  return { ...browser, list, bounces, previous, next, entry, download, control, select, label, requests, dialog, dismiss, dialogBrowser, dialogAndroid, dialogStatus, audioMenu, audioToggle, musicControls, musicLocales };
}

for (const [name, script] of [['server', source], ['Pages', projectPagesLauncherSource(source)]]) {
  test(`${name}: the audio menu preserves inside clicks and dismisses with Escape or an outside click`, async () => {
    const app = await launch(script);
    app.audioMenu.open = true;
    app.musicControls.click();
    assert.equal(app.audioMenu.open, true);
    app.musicControls.dispatchEvent({ type: 'keydown', key: 'Escape', bubbles: true });
    assert.equal(app.audioMenu.open, false);
    assert.equal(app.document.activeElement, app.audioToggle);
    app.audioMenu.open = true;
    app.document.body.click();
    assert.equal(app.audioMenu.open, false);
  });

  test(`${name}: music receives the chosen launcher locale on initial load and language changes`, async () => {
    const app = await launch(script);
    assert.equal(app.musicLocales.at(-1), app.window.CaatuuLauncherInterface);
    for (const locale of ['en', 'es-ES']) {
      app.select.value = locale;
      app.select.dispatchEvent({ type: 'change' });
      await settle();
      const content = app.musicLocales.at(-1);
      assert.equal(content.locale, locale);
      assert.equal(content, app.window.CaatuuLauncherInterface);
      assert.equal(app.audioToggle.getAttribute('aria-label'), content.t('common.audio.settings'));
      assert.ok(content.t('music.volume'));
      assert.ok(content.t('music.pending'));
    }
  });

  test(`${name}: course arrows scroll when possible and bounce at the edges`, async () => {
    const app = await launch(script);
    app.window.matchMedia = () => ({ matches: false });
    app.previous.click();
    app.next.click();
    assert.equal(app.bounces.length, 2);
    assert.equal(app.list.scrollLeft, 0);
    app.list.scrollWidth = 1600;
    app.next.click();
    assert.equal(app.list.scrollLeft, 800);
    assert.equal(app.bounces.length, 2);
    app.next.click();
    assert.equal(app.bounces.length, 3);
    app.previous.click();
    assert.equal(app.list.scrollLeft, 0);
    app.window.matchMedia = () => ({ matches: true });
    app.previous.click();
    assert.equal(app.bounces.length, 3);
  });
  test(`${name}: course cards offer the selected course in the browser and a validated APK`, async () => {
    const app = await launch(script);
    for (const [index, course] of registry.browserSetup.courses.entries()) {
      const link = app.list.children[index].querySelector('a');
      link.click();
      await settle();
      assert.equal(app.dialog.open, true);
      assert.equal(app.dialogBrowser.href, course.entryPath);
      const { content } = await launcherInterface.loadLauncherInterface(registry, [app.document.documentElement.lang]);
      assert.equal(app.dialog.querySelector('[data-course-dialog-title]').textContent, content.languageName(course.targetLanguage));
      assert.match(app.dialogAndroid.href, /caatuu_release=/u);
      assert.equal(app.dialogAndroid.hasAttribute('aria-disabled'), false);
      app.dismiss.click();
      assert.equal(app.dialog.open, false);
    }
  });

  test(`${name}: the popup offers the main app download without choosing a learner base`, async () => {
    const courses = structuredClone(registry);
    const spanish = courses.languages.find(course => course.id === 'es');
    const defaultCourse = courses.languages.find(course => course.id === courses.defaultLanguage);
    const versionCode = defaultCourse.platforms.android.channels.find(channel => channel.kind === 'release').minimumVersionCode;
    for (const channel of spanish.platforms.android.channels) channel.minimumVersionCode = versionCode + 100;
    const app = await launch(script, { courses, versionCode });
    const index = courses.browserSetup.courses.findIndex(course => course.id === 'es');
    app.list.children[index].querySelector('a').click();
    assert.equal(app.dialogAndroid.href, app.download.href);
    assert.equal(app.dialogAndroid.hasAttribute('aria-disabled'), false);
    assert.equal(app.dialogBrowser.href, courses.browserSetup.courses[index].entryPath);
  });

  test(`${name}: an unsupported APK leaves the course browser choice usable`, async () => {
    const app = await launch(script, { versionCode: 1 });
    app.list.children[0].querySelector('a').click();
    await settle();
    assert.equal(app.dialog.open, true);
    assert.equal(app.dialogBrowser.href, registry.browserSetup.courses[0].entryPath);
    assert.equal(app.dialogAndroid.hasAttribute('href'), false);
    assert.equal(app.dialogAndroid.getAttribute('aria-disabled'), 'true');
    assert.ok(app.dialogStatus.textContent);
  });

  test(`${name}: development courses retain preview disclosure and an enabled Android download`, async () => {
    const courses = structuredClone(registry);
    const preview = courses.browserSetup.courses.find(course => course.status === 'development');
    const android = courses.languages.find(course => course.platforms?.android?.enabled);
    assert.ok(preview, 'fixture must exercise a development course');
    assert.ok(android, 'fixture must include an enabled Android channel');
    courses.defaultLanguage = preview.id;
    courses.browserSetup.entryPath = preview.entryPath;
    courses.browserSetup.courses = [preview];
    courses.languages = [{ ...android, id: preview.id, status: preview.status }];
    const app = await launch(script, { courses });
    assert.deepEqual(app.list.children.map(item => item.dataset.languageId), [preview.id]);
    assert.equal(app.list.children[0].dataset.courseStatus, 'development');
    assert.ok(app.list.children[0].querySelector('.language-choice-status')?.textContent);
    assert.equal(app.download.dataset.state, 'available');
  });

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
      const { content } = await launcherInterface.loadLauncherInterface(registry, [locale]);
      for (const [index, card] of app.list.children.entries()) {
        const course = registry.browserSetup.courses[index];
        const link = card.querySelector('a');
        assert.equal(link.href, course.entryPath, 'course cards must open their declared course');
        assert.equal(link.querySelector('.language-choice-name').textContent, content.languageName(course.targetLanguage));
        assert.equal(link.querySelector('.language-choice-start').textContent, content.t('launcher.start'));
        assert.equal(Boolean(link.querySelector('.language-choice-status')), course.status === 'development');
      }
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
