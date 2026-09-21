import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { createBrowserHarness } from "./helpers/fake-browser.mjs";
import { createInterfaceContent, installInterfaceContent } from "../static/source/interface-content.mjs";
import { sharedPracticeAxes, projectPracticeCompass } from "../static/source/practice-compass.mjs";
import { loadCourseCatalog, generateCourseProfileObject } from "../../../tools/language-packs/lib/course-contract.mjs";

const catalog = await loadCourseCatalog({ repoRoot: new URL("../../../", import.meta.url) });
const [chromeSource, learningSource, en, es] = await Promise.all([
  readFile(new URL("../static/source/caatuu-chrome.js", import.meta.url), "utf8"),
  readFile(new URL("../static/source/learning-profile.js", import.meta.url), "utf8"),
  readFile(new URL("../static/data/interface/en.v1.json", import.meta.url), "utf8").then(JSON.parse),
  readFile(new URL("../static/data/interface/es.v1.json", import.meta.url), "utf8").then(JSON.parse)
]);
const flush = async () => { for (let n = 0; n < 5; n++) await new Promise(setImmediate); };

function mount(course, projection) {
  const app = createBrowserHarness({ course });
  const content = createInterfaceContent(course.sourceLanguage.id === "es" ? es : en);
  installInterfaceContent(content, app.window);
  installInterfaceContent(content, app.context);
  app.window.navigator.locks = { request: async (_name, action) => action() };
  app.window.requestAnimationFrame = callback => { queueMicrotask(callback); return 1; };
  app.window.CaatuuPracticeCompass = { axes: sharedPracticeAxes, project: async () => {
    if (projection instanceof Error) throw projection;
    return projection;
  } };
  vm.runInContext(learningSource, app.context);
  const make = (tag, id, parent) => {
    const el = app.document.createElement(tag); el.id = id; parent.append(el); return el;
  };
  // The harness does not parse template HTML. Mount the chart before binding,
  // then exercise the real renderer through the public Stats navigation.
  const panel = make("section", "settingsPanel", app.document.body);
  const sheet = make("section", "", panel); sheet.className = "settings-sheet";
  const stats = make("section", "statsViewPanel", sheet); stats.dataset.settingsViewPanel = "stats"; stats.hidden = true;
  const compass = make("details", "semanticSkillCompass", stats); compass.open = true;
  const body = make("div", "semanticSkillCompassBody", compass);
  const chart = make("svg", "semanticSkillCompassChart", body);
  for (const id of ["semanticSkillCompassEyebrow", "semanticSkillCompassTitle", "semanticSkillCompassSummaryState",
    "semanticSkillCompassLegendPractice", "semanticSkillCompassLegendStrength", "semanticSkillCompassStatus"])
    make("span", id, body);
  make("progress", "semanticSkillCompassProgress", body);
  make("button", "semanticSkillCompassRetry", body);
  make("ul", "semanticSkillCompassAxes", body);
  vm.runInContext(chromeSource, app.context);
  app.window.CaatuuChrome.openSharedSettings({ view: "stats" });
  return { ...app, panel, compass, chart, content };
}

test("all courses render the same seven-axis polygon for the same evidence", async t => {
  let reference;
  for (const record of catalog.courses) {
    const course = generateCourseProfileObject(record.course, catalog.courses);
    assert.equal(Object.hasOwn(course, "skillCompass"), false);
    assert.equal(Object.hasOwn(course.capabilities, "skillCompass"), false);
    const projection = projectPracticeCompass({ courseId: course.id,
      axisVectors: Object.fromEntries(sharedPracticeAxes.map(axis => [axis.id, [1, 0]])),
      items: [{ identity: { courseId: course.id, gameId: "word-world", bankId: "read", itemId: "same-meaning" },
        history: { exposures: 1, lastEvidence: "independent", lastCorrect: false, lastAttemptAt: "2026-09-19T12:00:00.000Z" }, vector: [1, 0] }] });
    const app = mount(course, projection);
    t.after(() => app.window.dispatchEvent({ type: "pagehide" }));
    await flush();
    assert.equal(app.compass.dataset.state, "ready", course.id);
    const practice = app.chart.querySelector("[data-semantic-compass-practice]");
    const independent = app.chart.querySelector("[data-semantic-compass-strength]");
    assert.equal(practice.classList.contains("is-hidden"), false, course.id);
    assert.equal(independent.classList.contains("is-hidden"), false, course.id);
    assert.equal(practice.getAttribute("points").split(" ").length, sharedPracticeAxes.length);
    reference ??= practice.getAttribute("points");
    assert.equal(practice.getAttribute("points"), reference, course.id);
    assert.equal(independent.getAttribute("points"), reference, "an independent error is evidence, not zero ability");
    app.window.CaatuuLearning.setGoal("explore");
    await flush();
    assert.equal(practice.getAttribute("points"), reference, "goals do not change recorded shape");
    assert.equal(app.chart.querySelector("title").textContent, app.content.t("settings.compass.charttitle"));
    assert.ok(app.panel.innerHTML.indexOf('id="semanticSkillCompass"') < app.panel.innerHTML.indexOf('class="learning-direction-card"'));
    assert.ok(app.panel.innerHTML.includes('class="course-practice-details"'));
  }
});

test("empty, partial, unavailable and failed mapping preserve the common polygon frame", async t => {
  const course = generateCourseProfileObject(catalog.courses[0].course);
  const empty = projectPracticeCompass({ courseId: course.id, items: [], axisVectors: {} });
  for (const projection of [empty, { ...empty, status: "partial" }, { ...empty, status: "unavailable" }, new Error("offline")]) {
    const app = mount(course, projection);
    t.after(() => app.window.dispatchEvent({ type: "pagehide" }));
    await flush();
    assert.equal(app.chart.querySelectorAll("[data-axis-id]").length, sharedPracticeAxes.length);
    assert.equal(app.compass.hidden, false);
    assert.equal(app.compass.dataset.state, projection instanceof Error ? "error" : projection.status);
    assert.equal(app.chart.querySelector("[data-semantic-compass-strength]").classList.contains("is-hidden"), true);
    assert.ok(app.document.querySelector("#semanticSkillCompassStatus").textContent);
  }
});

test("reopening Stats refreshes without a learning event and failed refresh clears accessible evidence", async t => {
  const course = generateCourseProfileObject(catalog.courses[0].course);
  const projection = projectPracticeCompass({ courseId: course.id,
    axisVectors: Object.fromEntries(sharedPracticeAxes.map(axis => [axis.id, [1, 0]])),
    items: [{ identity: { courseId: course.id, gameId: "word-world", bankId: "read", itemId: "meaning" },
      history: { exposures: 1, lastEvidence: "independent", lastCorrect: false,
        lastAttemptAt: "2026-09-19T12:00:00.000Z" }, vector: [1, 0] }] });
  const app = mount(course, projection);
  t.after(() => app.window.dispatchEvent({ type: "pagehide" }));
  await flush();
  const axisValues = () => app.document.querySelector("#semanticSkillCompassAxes")
    .querySelectorAll("dd").map(node => node.textContent);
  const description = app.document.querySelector("#semanticSkillCompassChartDescription");
  const oldDescription = description.textContent;
  assert.equal(app.compass.dataset.state, "ready");
  assert.deepEqual(axisValues(), Array(sharedPracticeAxes.length * 2).fill("1"));

  let refreshCalls = 0;
  app.window.CaatuuPracticeCompass.project = async () => {
    refreshCalls++;
    throw new Error("mapping unavailable after the earlier successful read");
  };
  // Exposure-only writes need not emit a learning event. Navigation itself
  // must read the latest evidence instead of reusing the ready chart forever.
  app.window.CaatuuChrome.openSharedSettings({ view: "items" });
  await flush();
  app.window.CaatuuChrome.openSharedSettings({ view: "stats" });
  await flush();
  assert.ok(refreshCalls > 0, "reopening Stats requests a fresh projection without an event");
  assert.equal(app.compass.dataset.state, "error");
  assert.deepEqual(axisValues(), Array(sharedPracticeAxes.length * 2)
    .fill(app.content.t("settings.compass.notmapped")));
  assert.notEqual(description.textContent, oldDescription);
  assert.equal(description.textContent, app.content.t("settings.compass.errormessage"));
  for (const selector of ["[data-semantic-compass-practice]", "[data-semantic-compass-strength]"]) {
    assert.equal(app.chart.querySelector(selector).classList.contains("is-hidden"), true);
  }
  assert.equal(app.document.querySelector("#semanticSkillCompassBody").getAttribute("aria-busy"), "false");
  const retry = app.document.querySelector("#semanticSkillCompassRetry");
  assert.equal(retry.hidden, false);

  app.window.CaatuuPracticeCompass.project = async () => projection;
  retry.click();
  await flush();
  assert.equal(app.compass.dataset.state, "ready", "the retry control restores a current map");
  assert.deepEqual(axisValues(), Array(sharedPracticeAxes.length * 2).fill("1"));
  assert.equal(description.textContent, oldDescription);
  assert.equal(retry.hidden, true);
});

test("Stats has no course-owned switch or legacy mastery projection dependency", () => {
  assert.doesNotMatch(chromeSource, /course\.(?:capabilities\??\.)?skillCompass|CaatuuSemanticLearning\.(?:projectRadar|readEvidence)|\.mastery|assessmentConfidence/);
  assert.doesNotMatch(JSON.stringify(sharedPracticeAxes), /Czech|Mandarin|Norwegian|\bcz\b/);
  assert.doesNotMatch(chromeSource, /if \(!semanticSkillCompassAvailable\)/);
});
