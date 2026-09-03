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
