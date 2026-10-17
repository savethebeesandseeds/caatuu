import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../../', import.meta.url);
const readJson = async path => JSON.parse(await readFile(new URL(path, root), 'utf8'));

// Local review pages may allow injected selector styles in their CSP. Exclude
// the complete directory, including scripts and data, rather than one filename.
function assertOutsideLocalReview(value, label) {
  assert.equal(typeof value, 'string', `${label} must declare an asset path`);
  const pathname = decodeURIComponent(new URL(value, 'https://caatuu.example/').pathname).replaceAll('\\', '/');
  assert.doesNotMatch(pathname, /(?:^|\/)review(?:\/|$)/iu, `${label} exposes a local-only review route: ${value}`);
}

function assertReferencesOutsideLocalReview(entries, label) {
  assert.ok(Array.isArray(entries), `${label} must be an asset inventory`);
  for (const [index, entry] of entries.entries()) {
    if (typeof entry === 'string') {
      assertOutsideLocalReview(entry, `${label}[${index}]`);
      continue;
    }
    assert.ok(entry && typeof entry === 'object', `${label}[${index}] must declare an asset`);
    const references = Object.entries(entry).filter(([key, value]) =>
      ['source', 'output', 'url', 'asset_path', 'path'].includes(key) && typeof value === 'string');
    assert.ok(references.length > 0, `${label}[${index}] needs a declared source or route`);
    for (const [key, value] of references) assertOutsideLocalReview(value, `${label}[${index}].${key}`);
  }
}

test('local review routes stay outside production app, offline and Android declarations for every registered course', async () => {
  const [application, catalog, reviewFiles] = await Promise.all([
    readJson('apps/language-runtime/app-assets.json'),
    readJson('apps/languages/catalog.json'),
    readdir(new URL('../static/review/', import.meta.url)),
  ]);
  assert.ok(reviewFiles.includes('memory-moon.html'), 'the Memory Moon review entry is included in this exclusion boundary');
  assertReferencesOutsideLocalReview(application.assets, 'app-assets.assets');
  assert.ok(Array.isArray(catalog.courses) && catalog.courses.length > 0);
  for (const entry of catalog.courses) {
    const course = await readJson(entry.manifest);
    assert.equal(course.id, entry.id);
    const declarations = await Promise.all(['setupCatalog', 'androidAssetCatalog'].map(async name => {
      const resource = course.resources[name];
      assert.ok(resource?.kind === 'file' && resource.state === 'present', `${entry.id}.${name} must name its authoritative inventory`);
      return readJson(resource.path);
    }));
    const [setup, android] = declarations;
    assertReferencesOutsideLocalReview(setup.offline.assets, `${entry.id}.setup.offline.assets`);
    assertReferencesOutsideLocalReview(setup.artifacts, `${entry.id}.setup.artifacts`);
    for (const key of ['files', 'sharedRuntimeFiles', 'launcherIconFiles']) {
      assertReferencesOutsideLocalReview(android[key] ?? [], `${entry.id}.android.${key}`);
    }
  }
});

test('the exclusion catches renamed exports, encoded offline routes and Android shared review modules', () => {
  assert.throws(() => assertReferencesOutsideLocalReview([{
    source: 'apps/language-runtime/static/review/memory-moon.html',
    output: 'language-runtime/static/games/memory-moon.html',
  }], 'app-assets.assets'), /local-only review route/);
  assert.throws(() => assertReferencesOutsideLocalReview([{
    url: '/language-runtime/static/%72eview/memory-moon.html?v=local',
    asset_path: 'language-runtime/static/games/renamed-moon.html',
  }], 'setup.artifacts'), /local-only review route/);
  assert.throws(() => assertReferencesOutsideLocalReview([
    'static/review/memory-moon-core.mjs',
  ], 'android.sharedRuntimeFiles'), /local-only review route/);
  assert.doesNotThrow(() => assertReferencesOutsideLocalReview([
    './data/dictionaries/patches/reviewed-cs-en.v1.json?v=revision',
  ], 'setup.offline.assets'), 'reviewed production content is not a local review directory');
});
