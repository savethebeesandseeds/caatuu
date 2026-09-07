import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { launcherCourses, selectLauncherCourse, loadLauncherInterface, launcherLocales } from '../static/source/launcher-interface.mjs';

const registry = JSON.parse(await readFile(new URL('../../launcher/static/languages.json', import.meta.url), 'utf8'));

test('page locale supports regional preferences without changing the browser course', async () => {
  for (const [preferences, expected] of [
    [[], 'en'], [['en-US'], 'en'], [['es'], 'es-ES'], [['es-MX'], 'es-ES'],
    [['invalid_locale', 'fr-FR', 'es-MX'], 'es-ES'], [['en-GB', 'es'], 'en'],
    [['fr-FR'], 'en']
  ]) {
    const { course, content } = await loadLauncherInterface(registry, preferences);
    assert.equal(content.locale, expected);
    assert.equal(course.id, registry.defaultLanguage);
    assert.equal(content.direction, 'ltr');
  }
});

test('page translation is independent of course publication and interface descriptors', async () => {
  const filtered = structuredClone(registry);
  filtered.browserSetup.courses = filtered.browserSetup.courses.filter(course => course.id === 'cz');
  delete filtered.browserSetup.courses[0].interfaceContent;
  const { course, content } = await loadLauncherInterface(filtered, ['es-MX']);
  assert.equal(course.id, 'cz');
  assert.equal(content.locale, 'es-ES');
  assert.equal((await loadLauncherInterface({}, ['es'])).content.locale, 'es-ES');
  assert.equal(selectLauncherCourse({}), null);
});

test('the landing catalogs cover all HTML messages and use product-wide Android labels', async () => {
  const html = await readFile(new URL('../../launcher/static/index.html', import.meta.url), 'utf8');
  const keys = [...html.matchAll(/data-i18n(?:-aria-label)?="([^"]+)"/gu)].map(match => match[1]);
  for (const { locale } of launcherLocales) {
    const { content } = await loadLauncherInterface(registry, [locale]);
    for (const key of keys) assert.ok(content.t(key), `${locale}: ${key}`);
    assert.match(content.t('launcher.android.downloadbeta'), /Caatuu/u);
    assert.match(content.t('launcher.android.downloadpreview'), /Caatuu/u);
    assert.ok(content.t('launcher.language'));
  }
});

test('launcher retains every declared browser course and omits unsafe records', () => {
  const courses = launcherCourses(registry);
  assert.deepEqual(courses.map(course => course.id), registry.browserSetup.courses.map(course => course.id));
  const valid = structuredClone(courses[0]);
  const invalid = { browserSetup: { schemaVersion: 1, courses: [
    { ...valid, status: 'archived' },
    { ...valid, sourceLanguage: { locale: 'not a locale' } },
    { ...valid, entryPath: '//elsewhere.test/course/' },
    { ...valid, entryPath: 'course/index.html' }
  ] } };
  assert.deepEqual(launcherCourses(invalid), []);
});
