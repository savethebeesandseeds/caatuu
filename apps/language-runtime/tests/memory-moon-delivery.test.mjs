import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

const root = new URL('../../../', import.meta.url);
const json = async file => JSON.parse(await readFile(new URL(file, root), 'utf8'));
const folder = 'apps/language-runtime/static/source/games/memory-moon/';
test('every production Memory Moon module ships through the shared asset catalog and every course offline catalog', async () => {
  const files = (await readdir(new URL(folder, root))).filter(file=>file.endsWith('.mjs'));
  assert.ok(files.length);
  const catalog = await json('apps/language-runtime/app-assets.json');
  const mappings = new Map(catalog.assets.map(entry=>[entry.source, entry.output]));
  const courses = await json('apps/languages/catalog.json');
  for (const file of files) {
    assert.equal(mappings.get(folder+file), `language-runtime/static/source/games/memory-moon/${file}`,
      `${file} must be delivered, not merely available from the development server`);
  }
  for (const entry of courses.courses) {
    const course = await json(entry.manifest);
    if (!(course.games || []).includes('memory-moon')) continue;
    const setup = await json(course.resources.setupCatalog.path);
    const paths = new Set(setup.offline.assets.map(asset=>new URL(asset, `https://caatuu.invalid${course.routePrefix}/`).pathname));
    for (const file of files) assert.ok(paths.has(`/${mappings.get(folder+file)}`), `${course.id} needs ${file} offline`);
  }
});
