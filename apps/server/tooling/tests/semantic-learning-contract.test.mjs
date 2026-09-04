import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const repoRoot = new URL("../../../../", import.meta.url);
const czechStatic = new URL("apps/languages/czech/static/", repoRoot);
const runtimeStatic = new URL("apps/language-runtime/static/", repoRoot);

function assertOrdered(source, markers) {
  let cursor = -1;
  for (const marker of markers) {
    const index = source.indexOf(marker);
    assert.ok(index > cursor, `${marker} must follow the preceding application dependency`);
    cursor = index;
  }
}

test("the application initializes declared semantic state before the shared workspace", async () => {
  const [document, bootstrap, profile] = await Promise.all([
    readFile(new URL("app/index.html", runtimeStatic), "utf8"),
    readFile(new URL("source/app-bootstrap.mjs", runtimeStatic), "utf8"),
    readFile(new URL("source/shared/course-profile.js", czechStatic), "utf8")
  ]);

  assertOrdered(document, [
    "source/shared/course-profile.js",
    "/language-runtime/static/source/learning-profile.js",
    "/language-runtime/static/source/caatuu-chrome.js",
    "/language-runtime/static/source/app-bootstrap.mjs"
  ]);
  assertOrdered(profile, [
    "source/shared/runtime.js",
    "source/shared/semantic-learning.js"
  ]);
  assertOrdered(bootstrap, [
    'declaredBrowserProvider("courseRuntime")',
    '"semanticLearningProvider"',
    "/language-runtime/static/source/caatuu-workspace.js"
  ]);
});

test("the offline package closes the semantic runtime with resolvable local assets", async () => {
  const setup = JSON.parse(await readFile(new URL("setup-assets.json", czechStatic), "utf8"));
  const offlineAssets = new Set(setup.offline.assets.map((asset) => asset.split("?")[0]));
  const required = [
    "./source/shared/runtime.js",
    "./source/shared/semantic-learning.js",
    "./source/shared/semantic-learning-core.mjs",
    "./source/shared/vector-db.js",
    "./vendor/transformers/transformers.min.js"
  ];

  for (const asset of required) {
    assert.ok(offlineAssets.has(asset), `${asset} must remain in the offline package`);
    await access(new URL(asset.slice(2), czechStatic));
  }
});
