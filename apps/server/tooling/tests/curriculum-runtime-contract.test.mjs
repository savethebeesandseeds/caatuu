import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const repoRoot = new URL("../../../../", import.meta.url);
const staticRoot = new URL("apps/languages/czech/static/", repoRoot);
const removedFiles = [
  new URL("apps/curriculum/", repoRoot),
  new URL("curriculum/", staticRoot),
  new URL("data/curriculum/", staticRoot),
  new URL("curriculum-service.js", staticRoot)
];
const retiredRootDataPaths = [
  new URL("data/dictionary.json", staticRoot),
  new URL("data/verbs.json", staticRoot),
  new URL("data/scripts.json", staticRoot),
  new URL("data/word-world/", staticRoot)
];

const [profileSource, indexHtml, wordWorldHtml, cometHtml, cometSource, serviceWorker, verbs, wordManifest] = await Promise.all([
  readFile(new URL("source/shared/course-profile.js", staticRoot), "utf8"),
  readFile(new URL("index.html", staticRoot), "utf8"),
  readFile(new URL("word-net.html", staticRoot), "utf8"),
  readFile(new URL("conjugation-comet.html", staticRoot), "utf8"),
  readFile(new URL("source/games/conjugation-comet/conjugation-comet.js", staticRoot), "utf8"),
  readFile(new URL("sw.js", staticRoot), "utf8"),
  readFile(new URL("data/games/conjugation-comet/verbs.json", staticRoot), "utf8").then(JSON.parse),
  readFile(new URL("data/games/word-world/manifest.json", staticRoot), "utf8").then(JSON.parse)
]);

const context = { window: {} };
vm.runInNewContext(profileSource, context, { filename: "course-profile.js" });
const course = context.window.CaatuuCourse;

test("the experimental curriculum package and runtime copies are absent", async () => {
  for (const path of removedFiles) {
    await assert.rejects(stat(path), (error) => error?.code === "ENOENT");
  }
  assert.equal(Object.hasOwn(course, "curriculum"), false);
});

test("learner pages no longer load the curriculum service", () => {
  for (const page of [indexHtml, wordWorldHtml, cometHtml]) {
    assert.doesNotMatch(page, /curriculum-service/);
  }
  assert.doesNotMatch(cometSource, /CaatuuCurriculum|data\/curriculum|guided-opportunity/);
});

test("authored data is grouped by game or shared language ownership", async () => {
  for (const path of retiredRootDataPaths) {
    await assert.rejects(stat(path), (error) => error?.code === "ENOENT");
  }
  await stat(new URL("data/games/verb-nebula/core-vocabulary.json", staticRoot));
  await stat(new URL("data/games/conjugation-comet/verbs.json", staticRoot));
  await stat(new URL("data/games/word-world/manifest.json", staticRoot));
  await stat(new URL("data/language/scripts.json", staticRoot));
});

test("curated game JSON is the learner-facing content boundary", () => {
  assert.equal(verbs.language, "cs");
  assert.ok(Array.isArray(verbs.verbs) && verbs.verbs.length >= 4);
  assert.equal(typeof wordManifest.corpusVersion, "string");
  assert.match(cometSource, /const VERBS_URL = "data\/games\/conjugation-comet\/verbs\.json\?v=conjugation-comet-verbs-4"/);
  assert.match(serviceWorker, /\.\/data\/games\/conjugation-comet\/verbs\.json\?v=conjugation-comet-verbs-4/);
  assert.match(serviceWorker, /\.\/data\/games\/word-world\/manifest\.json/);
  assert.doesNotMatch(serviceWorker, /data\/curriculum|curriculum-service/);
});
