import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const repoRoot = new URL("../../../../", import.meta.url);
const [profileSource, catalogSource, manifestSource] = await Promise.all([
  readFile(new URL("apps/languages/czech/static/source/shared/course-profile.js", repoRoot), "utf8"),
  readFile(new URL("apps/languages/catalog.json", repoRoot), "utf8"),
  readFile(new URL("apps/languages/czech/course.json", repoRoot), "utf8"),
]);

test("the executed course profile is immutable, namespaced, and agrees with the catalog manifest", () => {
  const context = { window: {} };
  vm.runInNewContext(profileSource, context, { filename: "course-profile.js" });
  const profile = context.window.CaatuuCourse;
  const catalog = JSON.parse(catalogSource);
  const manifest = JSON.parse(manifestSource);

  assert.ok(Object.isFrozen(profile));
  assert.ok(Object.isFrozen(profile.targetLanguage));
  assert.ok(Object.isFrozen(profile.storage));
  for (const [name, key] of Object.entries(profile.storage)) {
    if (name !== "namespace") {
      assert.ok(key.startsWith(`${profile.storage.namespace}.`), `${name} escaped the course namespace`);
    }
  }

  assert.deepEqual(
    catalog.courses.find(({ id }) => id === manifest.id),
    { id: "cz", manifest: "apps/languages/czech/course.json" },
  );
  assert.equal(profile.id, manifest.id);
  assert.equal(profile.routePrefix, manifest.routePrefix);
  assert.equal(profile.entryPath, manifest.entryPath);
  assert.equal(profile.targetLanguage.locale, manifest.targetLanguage.locale);
  assert.equal(manifest.resources.appEntry.path, "apps/language-runtime/static/app/index.html");
});

test("every enabled browser profile binds source, target and interface independently", async () => {
  const catalog = JSON.parse(catalogSource);
  const records = await Promise.all(catalog.courses.map(async ({ id, manifest }) => ({
    id, manifest: JSON.parse(await readFile(new URL(manifest, repoRoot), "utf8"))
  })));
  const browser = records.filter(({ manifest }) => manifest.platforms.browser.enabled);
  assert.ok(browser.length > 0, "the catalog must expose a browser course");
  assert.equal(new Set(browser.map(({ id }) => id)).size, browser.length);
  for (const { id, manifest } of browser) {
    const source = await readFile(new URL(manifest.resources.courseProfile.path, repoRoot), "utf8");
    const context = { window: {} };
    vm.runInNewContext(source, context, { filename: `${id}-course-profile.js` });
    const profile = context.window.CaatuuCourse;
    assert.ok(Object.isFrozen(profile.sourceLanguage), id);
    assert.ok(Object.isFrozen(profile.interfaceContent), id);
    assert.equal(profile.sourceLanguage.locale, manifest.sourceLanguage.locale, id);
    assert.equal(profile.targetLanguage.locale, manifest.targetLanguage.locale, id);
    assert.equal(profile.interfaceContent.locale, manifest.sourceLanguage.locale, id);
    assert.equal(profile.interfaceContent.revision, manifest.resources.interfaceCatalog.revision, id);
    assert.equal(profile.entryPath, manifest.entryPath, id);
  }
});
