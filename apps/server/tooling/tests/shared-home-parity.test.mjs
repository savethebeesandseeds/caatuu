import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const repoRoot = new URL("../../../../", import.meta.url);
const runtimeStatic = new URL("apps/language-runtime/static/", repoRoot);

test("every course uses the Czech-authoritative shared home tree", async () => {
  const [html, bootstrap] = await Promise.all([
    readFile(new URL("app/index.html", runtimeStatic), "utf8"),
    readFile(new URL("source/app-bootstrap.mjs", runtimeStatic), "utf8")
  ]);

  for (const marker of [
    'id="view-home"',
    'class="home-hero"',
    'class="setup-visual"',
    'class="stage-art"',
    'id="nativeSetup"',
    'id="setupDetailsToggle"',
    'id="setupArtifacts"',
    'id="setupLog"'
  ]) {
    assert.equal((html.match(new RegExp(marker, "gu")) || []).length, 1, marker);
  }

  assert.match(bootstrap, /const READY_HOME_ART = "\/assets\/icons\/hello\.png";/u);
  assert.match(bootstrap, /function renderReadyCourseHome\(\)[\s\S]*?document\.getElementById\("nativeSetup"\)/u);
  assert.match(bootstrap, /course\.capabilities\?\.offlineModels === true[\s\S]*?renderReadyCourseHome\(\)/u);
  assert.match(bootstrap, /course\.sourceLanguage\?\.label/u);
  assert.match(bootstrap, /course\.targetLanguage\?\.label/u);
  assert.match(bootstrap, /course\.capabilities\?\.embeddings === true/u);
  assert.doesNotMatch(bootstrap, /course\.id\s*(?:===|!==|==|!=)\s*["']/u);
  assert.doesNotMatch(bootstrap, /(?:\/zh(?:-hans)?\/|\/cz\/|mandarin-simplified)/iu);
});
