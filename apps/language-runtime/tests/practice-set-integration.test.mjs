import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { createBrowserHarness } from "./helpers/fake-browser.mjs";
import { englishInterfaceContent } from "./helpers/english-interface-content.mjs";
import { installGameDynamics } from "../static/source/game-dynamics.mjs";
import { mountRobotLoadingScreen } from "../static/source/games/embedded-game-controls.mjs";

const profile = await readFile(new URL("../static/source/learning-profile.js", import.meta.url), "utf8");
const workspace = await readFile(new URL("../static/source/caatuu-workspace.js", import.meta.url), "utf8");
const visibility = workspace.slice(workspace.indexOf("function syncActiveGameVisibility()"),
  workspace.indexOf("function ensureWordNetLoaded()"));
const courses = ["czech", "mandarin-simplified", "spanish", "english-from-spanish",
  "norwegian-bokmal", "arabic-standard", "latin-scientific", "georgian"];
const settle = async () => { for (let step = 0; step < 30; step++) await Promise.resolve(); };

async function fixture(courseName) {
  let queue = Promise.resolve();
  const browser = createBrowserHarness({ window: { navigator: { locks: {
    request(_name, action) {
      const next = queue.then(action);
      queue = next.catch(() => {});
      return next;
    }
  } } } });
  const courseSource = await readFile(new URL(`../../languages/${courseName}/static/source/shared/course-profile.js`, import.meta.url), "utf8");
  vm.runInContext(courseSource, browser.context);
  vm.runInContext(profile, browser.context);
  const { window, document } = browser;
  window.CaatuuI18n = englishInterfaceContent;
  const panel = document.createElement("section");
  panel.setAttribute("data-train-panel", "word-net");
  document.body.append(panel);
  const speechActivity = [];
  const embeddedActivity = [];
  window.CaatuuWordWorldHost = { setActive: value => speechActivity.push(value) };
  const state = { activeView: "verbs", trainTab: "word-net" };
  Object.assign(browser.context, { state, embeddedGameTabs: { "sound-quasar": {} },
    syncEmbeddedGameVisibility: tab => embeddedActivity.push(tab), syncShellRobotLoading() {} });
  vm.runInContext(visibility, browser.context);
  const sync = vm.runInContext("syncActiveGameVisibility", browser.context);
  window.CaatuuGameDynamics = installGameDynamics({ scope: window, onPauseChange: sync });
  sync();
  const word = () => window.CaatuuLearning.record("word-world", {
    activities: 1, attempts: 1, successes: 1, xp: 3, rounds: 1
  });
  return { ...browser, panel, word, state, sync, speechActivity, embeddedActivity,
    learning: window.CaatuuLearning, dynamics: window.CaatuuGameDynamics };
}

for (const courseName of courses) {
  test(`${courseName}: real shared profile, recorder, shell pause and reward presenter compose`, async () => {
    const f = await fixture(courseName);
    assert.equal(f.document.querySelector(".caatuu-practice-celebration"), null);
    for (let step = 0; step < 7; step++) f.word();
    assert.equal(f.learning.practiceSet().completedSets, 0);
    assert.equal(f.dynamics.active, false);
    f.word();
    assert.equal(f.learning.practiceSet().completedSets, 1);
    assert.equal(f.dynamics.active, true, "the boundary immediately pauses interaction");
    assert.equal(f.panel.hasAttribute("inert"), true);
    assert.equal(f.speechActivity.at(-1), false);
    assert.equal(f.embeddedActivity.at(-1), "");
    await settle();
    const overlay = f.document.querySelector(".caatuu-practice-celebration");
    assert.ok(overlay);
    assert.equal(f.learning.practiceSet().pending, null, "claim precedes presentation");
    assert.equal(f.learning.snapshot().rewards.coins, 1);
    overlay.querySelector("button").dispatchEvent({ type: "click" });
    assert.equal(f.dynamics.active, false);
    assert.equal(f.panel.hasAttribute("inert"), false);
    assert.equal(f.speechActivity.at(-1), true);
    assert.equal(f.embeddedActivity.at(-1), "word-net");
    f.dynamics.destroy();
    await f.learning.retryPendingSaves();
  });
}

test("shared robot transitions settle live completed work across game switches without host changes", async () => {
  const f = await fixture("czech");
  for (let step = 0; step < 6; step++) f.word();
  f.state.trainTab = "verb-lab";
  f.panel.dataset.trainPanel = "verb-lab";
  f.sync();
  for (let step = 0; step < 6; step++) f.learning.record("verb-nebula", {
    activities: 1, attempts: 1, successes: 1, xp: 1
  });
  assert.equal(f.learning.practiceSet().effort, 18, "a matching board is staged until a transition");
  const robot = f.document.createElement("div");
  robot.hidden = true;
  f.panel.append(robot);
  const screen = mountRobotLoadingScreen({ container: robot, label: "Next challenge" });
  screen.show();
  assert.equal(f.learning.practiceSet().completedSets, 1);
  assert.equal(f.learning.practiceSet().effort, 0);
  assert.equal(f.dynamics.active, true);
  screen.hide();
  assert.equal(robot.hidden, false, "the shared loader remains visible through presentation");
  await settle();
  f.document.querySelector(".caatuu-practice-celebration button").dispatchEvent({ type: "click" });
  await settle();
  assert.equal(robot.hidden, true);
  screen.destroy();
  f.dynamics.destroy();
  await f.learning.retryPendingSaves();
});
