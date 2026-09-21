import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { createBrowserHarness, createMemoryStorage } from "./helpers/fake-browser.mjs";
import { createInterfaceContent, installInterfaceContent } from "../static/source/interface-content.mjs";
import { loadCourseCatalog, generateCourseProfileObject } from "../../../tools/language-packs/lib/course-contract.mjs";

const loaded = await loadCourseCatalog({ repoRoot: new URL("../../../", import.meta.url) });
const courses = loaded.courses.map(({ course }) => generateCourseProfileObject(course, loaded.courses));
const [profileSource, chromeSource, english, spanish] = await Promise.all([
  readFile(new URL("../static/source/learning-profile.js", import.meta.url), "utf8"),
  readFile(new URL("../static/source/caatuu-chrome.js", import.meta.url), "utf8"),
  readFile(new URL("../static/data/interface/en.v1.json", import.meta.url), "utf8").then(JSON.parse),
  readFile(new URL("../static/data/interface/es.v1.json", import.meta.url), "utf8").then(JSON.parse)
]);
const now = Date.UTC(2026, 8, 20, 12);
const day = 24 * 60 * 60 * 1000;
const plain = value => JSON.parse(JSON.stringify(value));

async function browser(t, { course = courses[0], storage = createMemoryStorage(), seed, summaryOverride } = {}) {
  // The common Stats surface must work even when no semantic compass exists.
  const selected = { ...course, capabilities: { ...course.capabilities, skillCompass: false }, skillCompass: null };
  const app = createBrowserHarness({ course: selected });
  app.window.localStorage = storage;
  app.context.localStorage = storage;
  app.window.navigator.locks = { request: async (_name, action) => action() };
  const clock = { now };
  app.context.Date = class extends Date {
    constructor(...args) { super(...(args.length ? args : [clock.now])); }
    static now() { return clock.now; }
  };
  const content = createInterfaceContent(course.sourceLanguage.id === "es" ? spanish : english);
  installInterfaceContent(content, app.context);
  installInterfaceContent(content, app.window);
  vm.runInContext(profileSource, app.context);
  const learning = app.window.CaatuuLearning;
  if (seed) await seed({ learning, storage, clock });
  if (summaryOverride) app.window.CaatuuLearning = { ...learning, practiceSummary: summaryOverride(learning) };
  Object.defineProperty(app.window, "CaatuuSemanticLearning", {
    get() { assert.fail("common Stats attempted to use the optional semantic provider"); }
  });
  const panel = app.document.createElement("section");
  panel.id = "settingsPanel";
  app.document.body.append(panel);
  vm.runInContext(chromeSource, app.context);
  t.after(() => app.window.dispatchEvent({ type: "pagehide" }));
  const template = panel.innerHTML;

  // FakeElement deliberately does not parse template HTML. Keep the generated
  // template for placement/accessibility assertions, and mount its relevant
  // nodes so the real delegated handlers and renderers can operate on them.
  const node = (tag, id, parent, text = "") => {
    const element = app.document.createElement(tag);
    if (id) element.id = id;
    element.textContent = text;
    parent.append(element);
    return element;
  };
  const sheet = node("section", "", panel);
  sheet.className = "settings-sheet";
  sheet.dataset.settingsCurrentView = "items";
  const body = node("div", "", sheet);
  body.className = "settings-sheet-body";
  const items = node("section", "itemsViewPanel", body);
  items.dataset.settingsViewPanel = "items";
  const stats = node("section", "statsViewPanel", body);
  stats.dataset.settingsViewPanel = "stats";
  stats.hidden = true;
  const direction = node("section", "", stats);
  direction.className = "learning-direction-card";
  node("strong", "learningGoalDirection", direction);
  node("p", "learningGoalIntent", direction);
  const select = node("select", "learningGoal", direction);
  node("p", "learningGoalStatus", direction);
  const list = node("ul", "coursePracticeGames", stats);
  for (const id of ["coursePracticeItems", "coursePracticeIndependent", "coursePracticeDue", "coursePracticeStatus", "courseProgressActivities"]) {
    node("p", id, stats);
  }
  node("p", "coursePracticeEmpty", stats, content.t("settings.practice.empty"));
  node("p", "coursePracticeLegacy", stats, content.t("settings.practice.legacy"));
  node("p", "difficultyDescription", items);
  for (const option of learning.difficultyLevels) {
    const button = node("button", "", items);
    button.dataset.difficultyLevel = String(option.level);
  }
  const refresh = () => app.window.dispatchEvent({ type: "caatuu:learning-change" });
  refresh();
  app.window.CaatuuChrome.openSharedSettings({ view: "stats" });
  return { ...app, course: selected, learning, content, storage, clock, panel, template, items, stats, direction, select, list, refresh,
    element: id => panel.querySelector(`#${id}`) };
}

test("every course renders its own assessed, supported, legacy, and due item counts without a compass", async t => {
  const storage = createMemoryStorage();
  for (const [index, course] of courses.entries()) {
    await t.test(course.id, async subtest => {
      const app = await browser(subtest, { course, storage, seed: async ({ learning, clock }) => {
        const old = { exposures: 20, successes: 19, mistakes: 1, lastSeenAt: new Date(now - day).toISOString(),
          lastCorrect: true, encounters: ["old"] };
        storage.setItem(`${course.storage.namespace}.learning.content.v1`, JSON.stringify({ schemaVersion: 1,
          generation: "legacy", applied: [], banks: { '["word-world","sentences"]': { older: old } } }));
        for (let item = 0; item <= index; item++) learning.recordExposure("sound-quasar", {
          bankId: "words", itemId: `sound-${item}`, encounterId: `sound-${item}`, correct: false, evidence: "independent"
        });
        learning.recordExposure("word-world", { bankId: "sentences", itemId: "helped", encounterId: "helped",
          correct: true, evidence: "assisted" });
        learning.record("sound-quasar", { activities: index + 2 });
        await learning.retryPendingSaves();
        clock.now += day;
      } });
      assert.equal(app.stats.hidden, false);
      assert.equal(app.element("coursePracticeItems").textContent, String(index + 3));
      assert.equal(app.element("coursePracticeIndependent").textContent, String(index + 1), "independent errors are assessed tries");
      assert.equal(app.element("coursePracticeDue").textContent, String(index + 2));
      assert.equal(app.element("coursePracticeStatus").hidden, true);
      assert.equal(app.element("coursePracticeEmpty").hidden, true);
      assert.equal(app.element("coursePracticeLegacy").hidden, false);
      assert.equal(app.element("coursePracticeLegacy").textContent, app.content.t("settings.practice.legacy"));
      const sound = app.list.querySelector('[data-game-id="sound-quasar"]');
      assert.equal(sound.querySelector("strong").textContent, app.content.t("games.soundsquasar.title"));
      assert.equal(sound.querySelector("small").textContent, app.content.t("settings.practice.breakdown", {
        independent: index + 1, supported: 0, other: 0
      }));
      const word = app.list.querySelector('[data-game-id="word-world"]');
      assert.equal(word.querySelector("small").textContent, app.content.t("settings.practice.breakdown", { independent: 0, supported: 1, other: 1 }));
      assert.ok(sound.querySelector(".practice-independent"));
      assert.ok(word.querySelector(".practice-supported"));
      assert.ok(word.querySelector(".practice-unknown"));
      assert.equal(word.querySelector("svg").getAttribute("aria-hidden"), "true", "text conveys the chart counts");
      // Campaign orchestrates games rather than supplying its own item bank.
      const practiceGames = course.games.filter(id => id !== "campaign")
        .map(id => id === "verb-lab" ? "verb-nebula" : id === "word-net" ? "word-world" : id);
      assert.deepEqual(new Set(app.list.children.map(row => row.dataset.gameId)), new Set(practiceGames));
      assert.equal(app.element("courseProgressActivities").textContent, String(index + 2));
      if (index) assert.ok(app.learning.snapshot().journey.summary.activities > index + 2, "other courses have journey activity");
      assert.ok(app.template.includes(app.content.t("settings.practice.explanation")));
    });
  }
});

test("goal controls belong only to Stats, difficulty remains in Items, and changing goals preserves recorded practice", async t => {
  for (const course of [courses.find(course => course.sourceLanguage.id === "en"), courses.find(course => course.sourceLanguage.id === "es")]) {
    const app = await browser(t, { course, seed: async ({ learning }) => {
      learning.setDifficulty(2);
      learning.recordExposure("sound-quasar", { bankId: "words", itemId: "heard", encounterId: "heard", correct: false, evidence: "independent" });
      await learning.retryPendingSaves();
    } });
    const starts = ["itemsViewPanel", "statsViewPanel", "settingsViewPanel"].map(id => app.template.indexOf(`id="${id}"`));
    assert.ok(starts[0] >= 0 && starts[1] > starts[0] && starts[2] > starts[1]);
    const itemsMarkup = app.template.slice(starts[0], starts[1]);
    const statsMarkup = app.template.slice(starts[1], starts[2]);
    assert.ok(itemsMarkup.includes('data-difficulty-level="2"'));
    assert.ok(!statsMarkup.includes("data-difficulty-level"));
    assert.ok(!itemsMarkup.includes('id="learningGoal"'));
    assert.equal(app.template.match(/id="learningGoal"/gu).length, 1);
    assert.ok(statsMarkup.includes('class="learning-direction-card"'));
    assert.ok(statsMarkup.includes('<label class="setting-select" for="learningGoal">'));
    assert.ok(statsMarkup.includes('<select id="learningGoal" aria-describedby="learningGoalDescription">'));
    assert.ok(statsMarkup.includes('id="learningGoalStatus" role="status" aria-live="polite"'));
    const before = plain(app.learning.practiceSummary());
    for (const goal of [app.learning.goalOptions().find(goal => goal.id === "review"), app.learning.goalOptions().find(goal => goal.kind === "topic")]) {
      app.select.value = goal.id;
      app.document.dispatchEvent({ type: "change", target: app.select });
      assert.equal(app.learning.goal().id, goal.id);
      assert.equal(app.learning.difficulty(), 2);
      assert.deepEqual(plain(app.learning.practiceSummary()), before);
      const label = goal.kind === "topic" ? goal.label : app.content.t(`settings.learninggoal.${goal.kind}`);
      assert.equal(app.element("learningGoalDirection").textContent, label);
      assert.equal(app.element("learningGoalIntent").textContent, app.content.t(`settings.learninggoal.intent.${goal.kind}`));
      assert.equal(app.element("learningGoalStatus").textContent, app.content.t("settings.learninggoal.selected", { goal: label }));
      assert.equal(app.element("coursePracticeIndependent").textContent, "1");
    }
    app.window.CaatuuChrome.openSharedSettings({ view: "items" });
    assert.equal(app.stats.hidden, true);
    assert.equal(app.items.hidden, false);
    assert.equal(app.items.querySelector('[data-difficulty-level="2"]').getAttribute("aria-pressed"), "true");
    app.window.CaatuuChrome.openSharedSettings({ view: "stats" });
    assert.equal(app.stats.hidden, false);
    assert.equal(app.items.hidden, true);
  }
});

test("visible Stats refreshes course item evidence saved by another tab without changing the goal", async t => {
  const storage = createMemoryStorage();
  const app = await browser(t, { storage });
  const other = await browser(t, { storage });
  const contentKey = `${app.course.storage.namespace}.learning.content.v2`;
  other.learning.recordExposure("sound-quasar", { bankId: "words", itemId: "from-another-tab", encounterId: "visit", correct: false, evidence: "independent" });
  await other.learning.retryPendingSaves();
  assert.equal(app.element("coursePracticeItems").textContent, "0");
  app.window.dispatchEvent({ type: "storage", key: contentKey });
  assert.equal(app.element("coursePracticeItems").textContent, "1");
  assert.equal(app.element("coursePracticeIndependent").textContent, "1");
  assert.equal(app.select.value, "balanced");
  other.learning.resetProgress();
  await other.learning.retryPendingSaves();
  app.window.dispatchEvent({ type: "storage", key: `${other.learning.storage.performanceStorageKey}.reset` });
  assert.equal(app.element("coursePracticeItems").textContent, "0");
  assert.equal(app.element("coursePracticeEmpty").hidden, false);
});

test("zero practice shows real zeros and a useful empty state while goals remain available", async t => {
  const app = await browser(t);
  for (const id of ["coursePracticeItems", "coursePracticeIndependent", "coursePracticeDue"]) assert.equal(app.element(id).textContent, "0");
  assert.equal(app.element("coursePracticeEmpty").hidden, false);
  assert.equal(app.element("coursePracticeEmpty").textContent, app.content.t("settings.practice.empty"));
  assert.equal(app.element("coursePracticeStatus").hidden, true);
  assert.equal(app.element("coursePracticeLegacy").hidden, true);
  assert.ok(app.list.children.length > 0);
  assert.ok(app.list.children.every(row => row.querySelector("small").textContent === app.content.t("settings.practice.notstarted")));
  assert.equal(app.select.value, "balanced");
  assert.equal(app.element("learningGoalDirection").textContent, app.content.t("settings.learninggoal.balanced"));
});

test("partial history keeps available evidence visible and explains the read problem", async t => {
  for (const readableItems of [0, 1]) {
    const app = await browser(t, { seed: async ({ learning, storage }) => {
      if (readableItems) {
        learning.recordExposure("sound-quasar", { bankId: "words", itemId: "known", encounterId: "known", correct: false, evidence: "independent" });
        await learning.retryPendingSaves();
      }
      storage.setItem(`${courses[0].storage.namespace}.learning.content.v2`, "{broken");
    } });
    assert.equal(app.element("coursePracticeItems").textContent, String(readableItems));
    assert.equal(app.element("coursePracticeIndependent").textContent, String(readableItems));
    assert.equal(app.element("coursePracticeStatus").hidden, false);
    assert.equal(app.element("coursePracticeStatus").textContent, app.content.t("settings.practice.partial"));
    assert.equal(app.element("coursePracticeEmpty").hidden, true, "unreadable history must not imply a fresh learner");
    assert.equal(app.select.value, "balanced");
  }
});

test("unavailable or wrong-course summaries never display fabricated zeros or another course's practice", async t => {
  for (const summaryOverride of [() => () => { throw new Error("unavailable"); }, () => undefined,
    learning => () => ({ ...learning.practiceSummary(), courseId: "another-course" })]) {
    const app = await browser(t, { summaryOverride });
    for (const id of ["coursePracticeItems", "coursePracticeIndependent", "coursePracticeDue"]) assert.equal(app.element(id).textContent, "—");
    assert.equal(app.element("coursePracticeStatus").hidden, false);
    assert.equal(app.element("coursePracticeStatus").textContent, app.content.t("settings.practice.unavailable"));
    assert.equal(app.element("coursePracticeEmpty").hidden, true);
    assert.equal(app.element("coursePracticeLegacy").hidden, true);
    assert.equal(app.list.children.length, 0);
    app.select.value = "explore";
    app.document.dispatchEvent({ type: "change", target: app.select });
    assert.equal(app.learning.goal().id, "explore");
    assert.equal(app.element("learningGoalDirection").textContent, app.content.t("settings.learninggoal.explore"));
    assert.equal(app.element("coursePracticeItems").textContent, "—");
  }
});
