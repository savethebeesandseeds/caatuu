import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { createBrowserHarness } from "./helpers/fake-browser.mjs";
import { createInterfaceContent, installInterfaceContent } from "../static/source/interface-content.mjs";
import { validateEnglishEmbeddingPayload } from "../static/source/english-minilm-ranker.mjs";
import { loadCourseCatalog, generateCourseProfileObject } from "../../../tools/language-packs/lib/course-contract.mjs";

const loadedCourses = await loadCourseCatalog({ repoRoot: new URL("../../../", import.meta.url) });
const [profileSource, english] = await Promise.all([
  readFile(new URL("../static/source/learning-profile.js", import.meta.url), "utf8"),
  readFile(new URL("../static/data/interface/en.v1.json", import.meta.url), "utf8").then(JSON.parse)
]);

function browser({ profile, storage }) {
  const app = createBrowserHarness({ course: profile });
  if (storage) {
    app.window.localStorage = storage;
    app.context.localStorage = storage;
  }
  app.window.navigator.locks = { request: async (_name, action) => action() };
  const content = createInterfaceContent(english);
  installInterfaceContent(content, app.context);
  installInterfaceContent(content, app.window);
  vm.runInContext(profileSource, app.context);
  return { ...app, learning: app.window.CaatuuLearning };
}

test("every registered course projects usable topic goals from its real Word World categories", async () => {
  for (const { course: manifest } of loadedCourses.courses) {
    const corpus = JSON.parse(await readFile(new URL(`../../languages/${manifest.directoryName}/content/word-world/content.json`, import.meta.url), "utf8"));
    const topics = new Set(corpus.records.map(record => record.topic));
    const generated = generateCourseProfileObject(manifest);
    assert.deepEqual(generated.learningGoals, manifest.learningGoals);
    assert.notEqual(generated.learningGoals, manifest.learningGoals);
    assert.ok(generated.learningGoals.length > 0, `${manifest.id} has usable topic goals`);
    assert.equal(new Set(generated.learningGoals.map(goal => goal.id)).size, generated.learningGoals.length);
    const app = browser({ profile: generated });
    assert.equal(app.learning.goalOptions().length, 4 + manifest.learningGoals.length);
    for (const authored of manifest.learningGoals) {
      const topic = app.learning.setGoal(`topic:${authored.id}`);
      assert.equal(topic.kind, "topic");
      assert.equal(topic.label, authored.label, "display text belongs to this course's learner base");
      assert.equal(topic.embeddingText, authored.embeddingText);
      assert.deepEqual(Array.from(topic.categories), authored.categories);
      assert.ok(topic.categories.some(category => topics.has(category)),
        `${manifest.id}: ${authored.id} must cover an authored Word World topic`);
      assert.doesNotThrow(() => validateEnglishEmbeddingPayload({ inputLanguage: "en", query: { embeddingText: authored.embeddingText },
        candidates: [{ conceptId: "test.goal", embeddingText: "English topic" }] }));
    }
    for (const { course: other } of loadedCourses.courses.filter(row => row.course.id !== manifest.id)) {
      const isolated = browser({ profile: generateCourseProfileObject(other), storage: app.localStorage });
      assert.equal(isolated.learning.goal().id, "balanced", `${manifest.id} goal must not leak into ${other.id}`);
    }
  }
});
