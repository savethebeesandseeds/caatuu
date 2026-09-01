import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const repoRoot = new URL("../../../../", import.meta.url);
const runtimeStatic = new URL("apps/language-runtime/static/", repoRoot);

test("every course uses the Czech-authoritative shared home tree", async () => {
  const [html, bootstrap, czechSetup] = await Promise.all([
    readFile(new URL("app/index.html", runtimeStatic), "utf8"),
    readFile(new URL("source/app-bootstrap.mjs", runtimeStatic), "utf8"),
    readFile(new URL("../../languages/czech/static/source/features/setup/setup.js", runtimeStatic), "utf8")
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
  assert.match(html, /class="setup-detail-grid" id="setupDetails" hidden/u);
  assert.match(bootstrap, /if \(details\) details\.hidden = !open/u);
  assert.match(bootstrap, /if \(details\) details\.hidden = true/u);
  assert.doesNotMatch(czechSetup, /await loadSetupVisualFrames\(\);\s+startStageAnimation\(\);\s+card\.hidden = false/u);
  assert.equal(
    (czechSetup.match(/const status = await runtime\.setup\.status\(\);\s+if \(!status\.ready\) await loadSetupVisualFrames\(\);\s+await renderStatus\(status\);/gu) || []).length,
    2
  );
  assert.doesNotMatch(bootstrap, /course\.id\s*(?:===|!==|==|!=)\s*["']/u);
  assert.doesNotMatch(bootstrap, /(?:\/zh(?:-hans)?\/|\/cz\/|mandarin-simplified)/iu);
});
