import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import { loadCourseCatalog } from "../../../../tools/language-packs/lib/course-contract.mjs";

const repoRoot = new URL("../../../../", import.meta.url);
const runtimeStatic = new URL("apps/language-runtime/static/", repoRoot);

function assertOrdered(source, markers) {
  let cursor = -1;
  for (const marker of markers) {
    const index = source.indexOf(marker);
    assert.ok(index > cursor, `${marker} must follow the preceding application dependency`);
    cursor = index;
  }
}

test("the application initializes one shared compass and evidence provider for all courses", async () => {
  const [document, bootstrap] = await Promise.all([
    readFile(new URL("app/index.html", runtimeStatic), "utf8"),
    readFile(new URL("source/app-bootstrap.mjs", runtimeStatic), "utf8")
  ]);

  assertOrdered(document, [
    "source/shared/course-profile.js",
    "/language-runtime/static/source/learning-profile.js",
    "/language-runtime/static/source/app-bootstrap.mjs"
  ]);
  assert.doesNotMatch(document, /<script\b[^>]*src="[^"]*\/caatuu-chrome\.js/u);
  assertOrdered(bootstrap.slice(bootstrap.indexOf("async function start()")), [
    "await loadInterfaceContent(course)",
    "installInterfaceContent(interfaceContent)",
    "interfaceContent.apply(document)",
    "setCourseIdentity()",
    "createPracticeCompass",
    "/language-runtime/static/source/caatuu-chrome.js",
    "await loadCourseFeatureProviders()"
  ]);
  assertOrdered(bootstrap, [
    'declaredBrowserProvider("courseRuntime")',
    "/language-runtime/static/source/semantic-learning.js",
    "/language-runtime/static/source/caatuu-workspace.js"
  ]);
  assert.doesNotMatch(bootstrap, /declaredBrowserProvider\("semanticLearningProvider"\)/);
});

test("the offline package closes the semantic runtime with resolvable local assets", async () => {
  const catalog = await loadCourseCatalog({ repoRoot });
  const required = [
    "/language-runtime/static/source/practice-compass.mjs",
    "/language-runtime/static/source/semantic-learning.js",
    "/language-runtime/static/source/semantic-learning-core.mjs",
    "/language-runtime/static/source/english-image-search.mjs"
  ];
  const directImports = [];
  for (const moduleName of ["practice-compass.mjs", "semantic-learning.js"]) {
    const source = await readFile(new URL(`source/${moduleName}`, runtimeStatic), "utf8");
    for (const [, specifier] of source.matchAll(/(?:from\s*|import\(\s*)["']([^"']+)["']/gu)) {
      if (specifier.startsWith(".")) {
        directImports.push(new URL(specifier, `https://offline.test/language-runtime/static/source/${moduleName}`).href);
      }
    }
  }
  for (const { course } of catalog.courses) {
    const setup = JSON.parse(await readFile(new URL(course.resources.setupCatalog.path, repoRoot), "utf8"));
    const offlineAssets = new Set(setup.offline.assets.map(asset => asset.split("?")[0]));
    for (const asset of required) {
      assert.ok(offlineAssets.has(asset), `${course.id}: ${asset} must be in the shared offline package`);
      await access(new URL(`apps${asset}`, repoRoot));
    }
    const exactUrls = new Set(setup.offline.assets.map(asset => new URL(asset, `https://offline.test${course.entryPath}`).href));
    for (const url of directImports) {
      assert.ok(exactUrls.has(url), `${course.id}: direct Stats import ${url} must match its offline cache URL, including revision`);
    }
  }
});
