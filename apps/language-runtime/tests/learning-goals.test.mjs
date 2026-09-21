import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { createBrowserHarness } from "./helpers/fake-browser.mjs";
import { createInterfaceContent, installInterfaceContent, validateInterfaceCatalogParity } from "../static/source/interface-content.mjs";
import { validateEnglishEmbeddingPayload } from "../static/source/english-minilm-ranker.mjs";
import { loadCourseCatalog, validateCourseCatalog, generateCourseProfileObject } from "../../../tools/language-packs/lib/course-contract.mjs";

const loadedCourses = await loadCourseCatalog({ repoRoot: new URL("../../../", import.meta.url) });

const [profileSource, chromeSource, english, spanish] = await Promise.all([
  readFile(new URL("../static/source/learning-profile.js", import.meta.url), "utf8"),
  readFile(new URL("../static/source/caatuu-chrome.js", import.meta.url), "utf8"),
  readFile(new URL("../static/data/interface/en.v1.json", import.meta.url), "utf8").then(JSON.parse),
  readFile(new URL("../static/data/interface/es.v1.json", import.meta.url), "utf8").then(JSON.parse)
]);

function course(id = "test", overrides = {}) {
  return {
    id, status: "active", entryPath: `/${id}/index.html`, routePrefix: `/${id}`,
    brandLabel: "Caatuu", workspaceLabel: "Practice",
    sourceLanguage: { id: "en", locale: "en", label: "English", nativeLabel: "English", direction: "ltr" },
    targetLanguage: { id: "cs", locale: "cs", label: "Czech", nativeLabel: "Čeština", direction: "ltr" },
    capabilities: {}, games: [],
    storage: { namespace: `caatuu-${id}`, theme: `caatuu-${id}.theme`, fontSize: `caatuu-${id}.font-size` },
    routes: { home: `/${id}/index.html`, games: `/${id}/index.html`, settings: `/${id}/index.html` },
    ...overrides
  };
}

function browser({ profile = course(), storage, initial = {}, catalog, chrome = false } = {}) {
  const app = createBrowserHarness({ course: profile, localStorageValues: initial });
  if (storage) {
    app.window.localStorage = storage;
    app.context.localStorage = storage;
  }
  app.window.navigator.locks = { request: async (_name, action) => action() };
  const content = createInterfaceContent(catalog || english);
  installInterfaceContent(content, app.context);
  installInterfaceContent(content, app.window);
  vm.runInContext(profileSource, app.context);
  if (chrome) {
    const panel = app.document.createElement("section");
    panel.id = "settingsPanel";
    app.document.body.append(panel);
    vm.runInContext(chromeSource, app.context);
  }
  return { ...app, learning: app.window.CaatuuLearning, content };
}

test("goals persist independently from difficulty, old-client writes, activity and resets", async () => {
  const first = browser();
  assert.equal(first.learning.goal().id, "balanced");
  first.learning.setGoal("review");
  first.learning.setDifficulty(3);
  first.learning.record("sound-quasar", { attempts: 1, successes: 1 });
  await first.learning.retryPendingSaves();
  const keys = first.learning.storage;
  first.localStorage.setItem(keys.preferenceStorageKey, JSON.stringify({ schemaVersion: 1, difficulty: 2 }));
  const reloaded = browser({ storage: first.localStorage });
  assert.equal(reloaded.learning.goal().id, "review");
  assert.equal(reloaded.learning.difficulty(), 2);
  assert.equal(reloaded.learning.snapshot().goal.id, "review");
  assert.equal(reloaded.learning.summarize().attempts, 1);
  reloaded.learning.resetProgress();
  assert.equal(reloaded.learning.goal().id, "review");
  assert.equal(reloaded.learning.difficulty(), 2);
  assert.equal(reloaded.learning.summarize().attempts, 0);
  await reloaded.learning.retryPendingSaves();
});

test("goals and supplied policy context remain course, bank and direction scoped", () => {
  const first = browser();
  first.learning.setGoal("reinforce");
  const other = browser({ profile: course("other"), storage: first.localStorage });
  assert.equal(other.learning.goal().id, "balanced");
  assert.deepEqual(JSON.parse(JSON.stringify(first.learning.samplingContext("word-world", "sentences", "reconstruct-target"))), {
    identity: { courseId: "test", gameId: "word-world", bankId: "sentences", assessmentDirection: "reconstruct-target" },
    semanticsEnabled: false,
    goal: { id: "reinforce", kind: "reinforce", label: "Strengthen practiced material" }
  });
  assert.equal(first.learning.samplingContext("sound-quasar", "words").identity.assessmentDirection, "words");
  assert.equal(first.learning.samplingContext("verb-nebula").identity.bankId, "default");
  const semantic = browser({ profile: course("semantic", { capabilities: { embeddings: true } }) });
  assert.equal(semantic.learning.samplingContext("verb-nebula").semanticsEnabled, true);
});

test("declared learning topics work independently of the optional stats compass", () => {
  const learningGoals = [{ id: "travel", label: "Travel", embeddingText: "Ask for directions.", categories: ["travel"] }];
  const enabled = browser({ profile: course("topics", { capabilities: { skillCompass: false }, learningGoals }) });
  const topic = enabled.learning.setGoal("topic:travel");
  assert.deepEqual(JSON.parse(JSON.stringify(topic)), {
    id: "topic:travel", kind: "topic", label: "Travel", embeddingText: "Ask for directions.", categories: ["travel"]
  });
  assert.ok(Object.isFrozen(topic));
  assert.ok(Object.isFrozen(topic.categories));
  const options = enabled.learning.goalOptions();
  options.length = 0;
  assert.equal(enabled.learning.goalOptions().length, 5);
  const disabled = browser({ profile: course("disabled", { capabilities: { skillCompass: true },
    skillCompass: { axes: [{ id: "travel", label: "Old compass", probe: { locale: "en", text: "Travel." } }] } }) });
  assert.deepEqual(Array.from(disabled.learning.goalOptions(), goal => goal.id), ["balanced", "reinforce", "explore", "review"]);
  assert.equal(disabled.learning.setGoal("topic:travel").id, "balanced");
});

test("every registered course projects usable topic goals from its real Word World categories", async () => {
  for (const { course: manifest } of loadedCourses.courses) {
    const corpus = JSON.parse(await readFile(new URL(`../../languages/${manifest.directoryName}/content/word-world/content.json`, import.meta.url), "utf8"));
    const topics = new Set(corpus.records.map(record => record.topic));
    const generated = generateCourseProfileObject(manifest);
    assert.deepEqual(generated.learningGoals, manifest.learningGoals);
    assert.notEqual(generated.learningGoals, manifest.learningGoals);
    assert.ok(generated.learningGoals.length >= 6 && generated.learningGoals.length <= 8, manifest.id);
    const app = browser({ profile: generated });
    assert.equal(app.learning.goalOptions().length, 4 + manifest.learningGoals.length);
    for (const authored of manifest.learningGoals) {
      const topic = app.learning.setGoal(`topic:${authored.id}`);
      assert.equal(topic.kind, "topic");
      assert.equal(topic.label, authored.label, "display text belongs to this course's learner base");
      assert.equal(topic.embeddingText, authored.embeddingText);
      assert.deepEqual(Array.from(topic.categories), authored.categories);
      for (const category of topic.categories) assert.ok(topics.has(category), `${manifest.id}: missing authored topic ${category}`);
      assert.doesNotThrow(() => validateEnglishEmbeddingPayload({ inputLanguage: "en", query: { embeddingText: authored.embeddingText },
        candidates: [{ conceptId: "test.goal", embeddingText: "English topic" }] }));
    }
    for (const { course: other } of loadedCourses.courses.filter(row => row.course.id !== manifest.id)) {
      const isolated = browser({ profile: generateCourseProfileObject(other), storage: app.localStorage });
      assert.equal(isolated.learning.goal().id, "balanced", `${manifest.id} goal must not leak into ${other.id}`);
    }
  }
});

test("Spanish-base topic labels remain Spanish while their semantic probes stay English", () => {
  const spanishBase = loadedCourses.courses.find(({ course: manifest }) => manifest.sourceLanguage.id === "es").course;
  const englishBase = loadedCourses.courses.find(({ course: manifest }) => manifest.id === "es").course;
  const app = browser({ profile: generateCourseProfileObject(spanishBase), catalog: spanish, chrome: true });
  const markup = app.document.querySelector("#settingsPanel").innerHTML;
  for (const goal of spanishBase.learningGoals) {
    const comparable = englishBase.learningGoals.find(other => other.id === goal.id);
    assert.notEqual(goal.label, comparable.label);
    assert.equal(goal.embeddingText, comparable.embeddingText);
    assert.ok(markup.includes(`>${goal.label}</option>`));
  }
  app.window.dispatchEvent({ type: "pagehide" });
});

test("learningGoals is additive and validates its exact authored English contract", async () => {
  const absent = structuredClone(loadedCourses);
  for (const record of absent.courses) delete record.course.learningGoals;
  await validateCourseCatalog(absent, { checkExistence: false });
  assert.deepEqual(generateCourseProfileObject(absent.courses[0].course).learningGoals, []);
  const mutations = [
    goals => { goals[0].unexpected = true; },
    goals => { delete goals[0].embeddingText; },
    goals => { goals[0].embeddingText = "旅行和天气"; },
    goals => { goals[0].label = " "; },
    goals => { goals.push(structuredClone(goals[0])); },
    goals => { goals[0].categories = ["not a topic id"]; },
    goals => { goals[0].categories = ["food", "food"]; },
    goals => { goals[0].categories = []; },
    goals => { while (goals.length <= 12) goals.push({ ...goals[0], id: `topic-${goals.length}` }); }
  ];
  for (const mutate of mutations) {
    const fixture = structuredClone(loadedCourses);
    mutate(fixture.courses[0].course.learningGoals);
    await assert.rejects(validateCourseCatalog(fixture, { checkExistence: false }),
      error => error.issues?.some(issue => issue.code === "manifest.learning-goals"));
  }
});

test("unknown stored goals fall back without rewriting the original preference", () => {
  const raw = JSON.stringify({ schemaVersion: 1, goal: "topic:removed" });
  const app = browser({ initial: { "caatuu-test.learning.goal.v1": raw } });
  assert.equal(app.learning.goal().id, "balanced");
  assert.equal(app.localStorage.getItem(app.learning.storage.goalStorageKey), raw);
  assert.equal(app.learning.setGoal("unknown").id, "balanced");
  assert.equal(app.localStorage.getItem(app.learning.storage.goalStorageKey), raw);
});

test("a goal change announces its current snapshot exactly once", () => {
  const app = browser();
  const changes = [];
  app.window.addEventListener("caatuu:learning-change", event => changes.push(event.detail));
  app.learning.setGoal("explore");
  app.learning.setGoal("explore");
  assert.equal(changes.length, 1);
  assert.equal(changes[0].reason, "goal");
  assert.equal(changes[0].goal.id, "explore");
  assert.equal(changes[0].difficulty, 1);
});

test("future and damaged goal preferences retain recovery safeguards", async () => {
  for (const raw of ["{broken", JSON.stringify({ schemaVersion: 999, goal: "review" })]) {
    const app = browser({ initial: { "caatuu-test.learning.goal.v1": raw } });
    assert.equal(app.learning.goal().id, "balanced");
    app.learning.setGoal("explore");
    await app.learning.retryPendingSaves();
    assert.equal(app.localStorage.getItem(app.learning.storage.goalStorageKey), raw);
    assert.equal(app.learning.saveStatus().status, "error");
  }
});

test("goal preference saves retry after a storage failure without dropping the choice", async () => {
  const app = browser();
  const write = app.localStorage.setItem.bind(app.localStorage);
  app.localStorage.setItem = () => { throw new Error("quota"); };
  app.learning.setGoal("review");
  assert.equal(app.learning.goal().id, "review");
  assert.equal(app.learning.saveStatus().status, "error");
  app.localStorage.setItem = write;
  await app.learning.retryPendingSaves();
  assert.equal(app.learning.saveStatus().status, "saved");
  assert.equal(browser({ storage: app.localStorage }).learning.goal().id, "review");
});

test("goal controls are labelled, localized and update the real persisted preference", () => {
  assert.deepEqual(validateInterfaceCatalogParity(english, spanish), { valid: true, errors: [] });
  for (const catalog of [english, spanish]) {
    const app = browser({ catalog, chrome: true });
    const panel = app.document.querySelector("#settingsPanel");
    // The lightweight harness retains template HTML without parsing it. Verify
    // the real output, then mount the control to exercise its delegated handler.
    assert.ok(panel.innerHTML.includes('<label class="setting-select" for="learningGoal">'));
    assert.ok(panel.innerHTML.includes(app.content.t("settings.learninggoal.label")));
    assert.ok(panel.innerHTML.includes('<select id="learningGoal" aria-describedby="learningGoalIntent">'));
    const select = app.document.createElement("select");
    select.id = "learningGoal";
    const status = app.document.createElement("p");
    status.id = "learningGoalStatus";
    panel.append(select, status);
    app.window.dispatchEvent({ type: "caatuu:learning-change" });
    assert.equal(select.value, "balanced");
    for (const goal of app.learning.goalOptions()) {
      assert.ok(panel.innerHTML.includes(`<option value="${goal.id}">${app.content.t(`settings.learninggoal.${goal.kind}`)}</option>`));
    }
    select.value = "reinforce";
    app.document.dispatchEvent({ type: "change", target: select });
    assert.equal(app.learning.goal().id, "reinforce");
    assert.equal(app.learning.difficulty(), 1);
    assert.ok(panel.innerHTML.includes('id="learningGoalStatus" role="status" aria-live="polite"'));
    assert.equal(status.textContent, app.content.t("settings.learninggoal.selected", {
      goal: app.content.t("settings.learninggoal.reinforce")
    }));
    app.localStorage.setItem(app.learning.storage.goalStorageKey, JSON.stringify({ schemaVersion: 1, goal: "review" }));
    app.window.dispatchEvent({ type: "storage", key: app.learning.storage.goalStorageKey });
    assert.equal(select.value, "review");
    app.window.dispatchEvent({ type: "pagehide" });
  }
});
