import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const repoRoot = new URL("../../../../", import.meta.url);
const catalog = await readJson("apps/languages/catalog.json");
const courseRecords = await Promise.all(catalog.courses.map(async ({ id, manifest }) => ({
  id,
  course: await readJson(manifest)
})));
const browserRecords = courseRecords.filter(({ course }) => course.platforms?.browser?.enabled === true);
const [profiles, setups, launcherRegistry, appAssets] = await Promise.all([
  Promise.all(browserRecords.map(async ({ id, course }) => ({
    id,
    profile: evaluateProfile(
      await readFile(new URL(course.resources.courseProfile.path, repoRoot), "utf8"),
      `${id}-course-profile.js`
    )
  }))),
  Promise.all(browserRecords.map(async ({ id, course }) => ({
    id,
    setup: await readJson(course.resources.setupCatalog.path)
  }))),
  readJson("apps/launcher/static/languages.json"),
  readJson("apps/language-runtime/app-assets.json")
]);

async function readJson(relativePath) {
  return JSON.parse(await readFile(new URL(relativePath, repoRoot), "utf8"));
}

function evaluateProfile(source, filename) {
  const context = { window: {} };
  vm.runInNewContext(source, context, { filename });
  return JSON.parse(JSON.stringify(context.window.CaatuuCourse));
}

test("every browser course receives one catalog-derived course-selector projection", () => {
  assert.equal(profiles.length, 3);
  const reference = profiles[0].profile.courseSelector;
  for (const { id, profile } of profiles) {
    assert.deepEqual(profile.courseSelector, reference, `${id} selector projection drifted`);
  }
  assert.deepEqual(
    reference.courses.map(({ id, status, entryPath, storage }) => ({ id, status, entryPath, storage })),
    browserRecords.map(({ id, course }) => ({
      id,
      status: course.status,
      entryPath: course.entryPath,
      storage: { learningPerformance: course.storage.learningPerformance }
    }))
  );
  assert.deepEqual(
    reference.courses.map(({ sourceLanguage }) => sourceLanguage.id),
    browserRecords.map(({ course }) => course.sourceLanguage.id)
  );
  assert.deepEqual(
    reference.courses.map(({ targetLanguage }) => targetLanguage.shortCode),
    browserRecords.map(({ course }) => course.targetLanguage.shortCode)
  );
  assert.deepEqual(launcherRegistry.languages.map(({ id }) => id), ["cz"], "the public launcher remains active-only");
});

test("every shared selector flag is cached by every browser course and packaged by the shared app", () => {
  const flagUrls = new Set(profiles[0].profile.courseSelector.courses.flatMap(
    ({ sourceLanguage, targetLanguage }) => [sourceLanguage.flagSrc, targetLanguage.flagSrc]
  ));
  const sharedOutputs = new Set(appAssets.assets.map(({ output }) => output));
  for (const flagUrl of flagUrls) {
    for (const { id, setup } of setups) {
      assert.ok(setup.offline.assets.includes(flagUrl), `${id} offline cache must include ${flagUrl}`);
    }
    assert.ok(sharedOutputs.has(flagUrl.slice(1)), `shared Android assets must include ${flagUrl}`);
  }
});
