import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

import { generateCourseProfileObject } from "../../../tools/language-packs/lib/course-contract.mjs";

const [chromeSource, czechManifest, mandarinManifest, czechProfileSource, mandarinProfileSource] = await Promise.all([
  readFile(new URL("../static/source/caatuu-chrome.js", import.meta.url), "utf8"),
  readFile(new URL("../../languages/czech/course.json", import.meta.url), "utf8").then(JSON.parse),
  readFile(new URL("../../languages/mandarin-simplified/course.json", import.meta.url), "utf8").then(JSON.parse),
  readFile(new URL("../../languages/czech/static/source/shared/course-profile.js", import.meta.url), "utf8"),
  readFile(new URL("../../languages/mandarin-simplified/static/source/shared/course-profile.js", import.meta.url), "utf8")
]);

function evaluateProfile(source) {
  const context = { window: {} };
  vm.runInNewContext(source, context, { filename: "course-profile.js" });
  return JSON.parse(JSON.stringify(context.window.CaatuuCourse));
}

function chromeContext(course) {
  const document = {
    addEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    readyState: "loading"
  };
  const context = {
    CaatuuCourse: course,
    document,
    location: { hostname: "127.0.0.1" },
    localStorage: {
      getItem() { return null; },
      removeItem() {},
      setItem() {}
    },
    addEventListener() {},
    clearTimeout,
    dispatchEvent() {},
    setTimeout
  };
  context.window = context;
  return context;
}

test("the established Czech compass is authored by the Czech course pack", () => {
  assert.equal(czechManifest.capabilities.skillCompass, true);
  assert.equal(czechManifest.skillCompass.id, "cz-everyday-compass");
  assert.equal(czechManifest.skillCompass.version, "1.1.0");
  assert.equal(czechManifest.skillCompass.modelId, "all-minilm-l6-v2-qint8-v0.1");
  assert.equal(czechManifest.skillCompass.minimumConfidence, 0.12);
  assert.equal(czechManifest.skillCompass.axes.length, 7);
  assert.equal(czechManifest.skillCompass.copy.chartTitle, "Lifetime Czech skill compass");
  assert.equal(czechManifest.skillCompass.axes[0].probe.text.endsWith("in Czech."), true);
  assert.deepEqual(evaluateProfile(czechProfileSource).skillCompass, czechManifest.skillCompass);
});

test("Mandarin and a synthetic third language can keep embeddings without inheriting Czech compass content", async () => {
  assert.equal(mandarinManifest.capabilities.embeddings, true);
  assert.equal(mandarinManifest.capabilities.semanticSearch, true);
  assert.equal(mandarinManifest.capabilities.skillCompass, false);
  assert.equal(mandarinManifest.skillCompass, null);
  assert.equal(evaluateProfile(mandarinProfileSource).skillCompass, null);

  const synthetic = structuredClone(czechManifest);
  synthetic.id = "eo";
  synthetic.directoryName = "esperanto";
  synthetic.capabilities.skillCompass = false;
  synthetic.skillCompass = null;
  const syntheticProfile = generateCourseProfileObject(synthetic);
  assert.equal(syntheticProfile.id, "eo");
  assert.equal(syntheticProfile.capabilities.embeddings, true);
  assert.equal(syntheticProfile.capabilities.skillCompass, false);
  assert.equal(syntheticProfile.skillCompass, null);

  const context = chromeContext(syntheticProfile);
  vm.runInNewContext(chromeSource, context, { filename: "caatuu-chrome.js" });
  assert.equal(await context.CaatuuChrome.preloadBackpackStats(), null);
});

test("shared Chrome gates only the compass and contains no Czech course content or literal identity branch", () => {
  assert.match(chromeSource, /course\.capabilities\?\.skillCompass === true/);
  assert.match(chromeSource, /if \(!semanticSkillCompassAvailable\) panel\.querySelector\("#semanticSkillCompass"\)\?\.remove\(\)/);
  assert.doesNotMatch(chromeSource, /course\.capabilities\?\.semanticSearch !== true/);
  assert.doesNotMatch(chromeSource, /cz-everyday-compass|Lifetime Czech skill compass|everyday Czech topics|personal needs in Czech/);
  assert.doesNotMatch(
    chromeSource,
    /course\.(?:id|targetLanguage(?:\?|)\.id)\s*===\s*["'](?:cz|zh(?:-hans)?)["']|["'](?:cz|zh(?:-hans)?)["']\s*===\s*course\.(?:id|targetLanguage(?:\?|)\.id)/
  );
  assert.match(chromeSource, /id="itemsViewTab"/);
  assert.match(chromeSource, /id="statsViewTab"/);
  assert.match(chromeSource, /id="settingsViewTab"/);
});
