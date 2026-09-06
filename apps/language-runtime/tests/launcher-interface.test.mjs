import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { launcherCourses, selectLauncherCourse, loadLauncherInterface } from '../static/source/launcher-interface.mjs';

const root = new URL('../../../', import.meta.url);
const read = async (file) => JSON.parse(await readFile(new URL(file, root), 'utf8'));
const directories = ['czech', 'mandarin-simplified', 'spanish', 'english-from-spanish'];
const manifests = await Promise.all(directories.map((directory) => read(`apps/languages/${directory}/course.json`)));
const english = await read('apps/language-runtime/static/data/interface/en.v1.json');
const spanish = await read('apps/language-runtime/static/data/interface/es.v1.json');
const fixture = () => ({
  schemaVersion: 1,
  defaultLanguage: 'cz',
  browserSetup: {
    schemaVersion: 1,
    entryPath: '/cz/index.html',
    courses: manifests.map((course) => ({
      id: course.id,
      status: course.status,
      sourceLanguage: structuredClone(course.sourceLanguage),
      targetLanguage: structuredClone(course.targetLanguage),
      entryPath: course.entryPath,
      interfaceContent: {
        schemaVersion: 1,
        locale: course.sourceLanguage.locale,
        direction: course.sourceLanguage.direction,
        revision: course.resources.interfaceCatalog.revision,
        catalog: `/${course.resources.interfaceCatalog.path.slice('apps/'.length)}`
      }
    }))
  }
});

test('launcher chooses the learner base with exact and regional locale preferences', () => {
  const registry = fixture();
  assert.equal(selectLauncherCourse(registry).id, 'cz');
  assert.equal(selectLauncherCourse(registry, ['en']).id, 'cz');
  assert.equal(selectLauncherCourse(registry, ['en-US']).id, 'cz');
  assert.equal(selectLauncherCourse(registry, ['es-ES']).id, 'es-en');
  assert.equal(selectLauncherCourse(registry, ['es-MX']).id, 'es-en');
  assert.equal(selectLauncherCourse(registry, ['es']).id, 'es-en');
  assert.equal(selectLauncherCourse(registry, ['invalid_locale', 'fr-FR', 'es-MX']).id, 'es-en');
  assert.equal(selectLauncherCourse(registry, ['en-GB', 'es-ES']).id, 'cz');
  assert.equal(selectLauncherCourse(registry, ['fr-FR']).id, 'cz');
  assert.notEqual(selectLauncherCourse(registry, ['es']).id, 'es', 'a Spanish target does not imply a Spanish learner base');
});

test('launcher omits unsupported records and rejects an empty browser registry', async () => {
  const registry = fixture();
  const valid = structuredClone(registry.browserSetup.courses[0]);
  registry.browserSetup.courses.push(
    { ...valid, id: 'archived', status: 'archived' },
    { ...valid, id: 'bad-locale', sourceLanguage: { locale: 'not a locale' } },
    { ...valid, id: 'off-origin', entryPath: '//elsewhere.test/course/' },
    { ...valid, id: 'relative', entryPath: 'course/index.html' }
  );
  assert.deepEqual(launcherCourses(registry).map((course) => course.id), ['cz', 'zh', 'es', 'es-en']);
  assert.deepEqual(launcherCourses({ browserSetup: { schemaVersion: 2, courses: [] } }), []);
  assert.equal(selectLauncherCourse({}), null);
  await assert.rejects(loadLauncherInterface({}, [], { fetchImpl: () => assert.fail('empty registry must not fetch') }), /No browser course/u);
});

test('launcher fetches only the selected declared Spanish catalog with its exact revision', async () => {
  const requests = [];
  const { course, content } = await loadLauncherInterface(fixture(), ['es-MX'], {
    origin: 'http://127.0.0.1:8765',
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, json: async () => structuredClone(spanish) };
    }
  });
  assert.equal(course.id, 'es-en');
  assert.equal(content.locale, 'es-ES');
  assert.equal(content.direction, 'ltr');
  assert.equal(content.t('launcher.continue'), spanish.messages['launcher.continue']);
  assert.notEqual(content.t('launcher.continue'), english.messages['launcher.continue']);
  assert.deepEqual(requests, [{
    url: 'http://127.0.0.1:8765/language-runtime/static/data/interface/es.v1.json?v=interface-es-2',
    options: { cache: 'no-cache', credentials: 'same-origin' }
  }]);
});

test('launcher rejects declared locale, direction, origin and fetched revision drift', async () => {
  for (const [mutate, expected] of [
    [(course) => { course.interfaceContent.locale = 'en'; }, /learner-base locale/u],
    [(course) => { course.interfaceContent.direction = 'rtl'; }, /learner-base direction/u],
    [(course) => { course.interfaceContent.catalog = 'https://elsewhere.test/es.v1.json'; }, /same-origin shared interface JSON/u]
  ]) {
    const registry = fixture();
    mutate(registry.browserSetup.courses.find((course) => course.id === 'es-en'));
    await assert.rejects(loadLauncherInterface(registry, ['es'], {
      origin: 'http://127.0.0.1:8765', fetchImpl: () => assert.fail('descriptor drift must reject before fetching')
    }), expected);
  }
  for (const [patch, expected] of [
    [{ revision: 'interface-es-stale' }, /revision.*does not match/u],
    [{ locale: 'en' }, /locale.*does not match/u],
    [{ direction: 'rtl' }, /direction.*does not match/u]
  ]) {
    await assert.rejects(loadLauncherInterface(fixture(), ['es'], {
      origin: 'http://127.0.0.1:8765', fetchImpl: async () => ({ ok: true, json: async () => ({ ...spanish, ...patch }) })
    }), expected);
  }
});

test('a Pages-filtered registry cannot select a withheld Spanish-base course', async () => {
  const registry = fixture();
  const pagesIds = new Set(manifests.filter((course) => course.platforms.browser.pagesEnabled).map((course) => course.id));
  assert.equal(pagesIds.has('es-en'), false);
  registry.browserSetup.courses = registry.browserSetup.courses.filter((course) => pagesIds.has(course.id));
  assert.equal(selectLauncherCourse(registry, ['es-MX']).id, 'cz');
  const requests = [];
  const { content } = await loadLauncherInterface(registry, ['es-MX'], {
    origin: 'http://127.0.0.1:8765',
    fetchImpl: async (url) => { requests.push(url); return { ok: true, json: async () => english }; }
  });
  assert.equal(content.locale, 'en');
  assert.equal(requests.length, 1);
  assert.equal(new URL(requests[0]).pathname, '/language-runtime/static/data/interface/en.v1.json');
});

test('generated browser registry exposes the fourth course and exact Spanish interface descriptor', async () => {
  const registry = await read('apps/launcher/static/languages.json');
  assert.deepEqual(launcherCourses(registry).map((course) => course.id), ['cz', 'zh', 'es', 'es-en']);
  assert.deepEqual(registry.languages.map((course) => course.id), ['cz']);
  const selected = selectLauncherCourse(registry, ['es-MX']);
  assert.equal(selected.id, 'es-en');
  assert.equal(selected.entryPath, '/es-en/index.html');
  assert.deepEqual(selected.interfaceContent, fixture().browserSetup.courses.find((course) => course.id === 'es-en').interfaceContent);
});
