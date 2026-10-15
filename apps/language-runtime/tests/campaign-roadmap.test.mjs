import assert from "node:assert/strict";
import test from "node:test";
import { access, readFile } from "node:fs/promises";
import { campaignRoadmapModel, installCampaignRoadmap } from "../static/source/campaign-roadmap.mjs";
import { createBrowserHarness } from "./helpers/fake-browser.mjs";
import { installEnglishInterfaceContent } from "./helpers/english-interface-content.mjs";

function practice(overrides = {}) {
  return { target: 24, effort: 18, cycle: { target: 16, sets: 5, completed: 36 },
    progression: { available: true, stage: { difficulty: 1, completedCycles: 12,
      completedSets: 195, targetCycles: 425 } }, ...overrides };
}

test("set positions use shared cycle effort while badge progress stays difficulty-specific", () => {
  const snapshot = practice(), before = JSON.stringify(snapshot);
  const model = campaignRoadmapModel(snapshot);
  assert.equal(model.cycle, 37);
  assert.equal(model.sets.length, 16);
  assert.equal(model.sets.filter(set => set.status === "complete").length, 5);
  assert.equal(model.sets.find(set => set.status === "current").number, 6);
  assert.equal(model.effort, 18);
  assert.equal(model.effortTarget, 24);
  assert.equal(model.stage.completedCycles, 12);
  assert.equal(model.stage.targetCycles, 425, "read the real corpus-derived budget");
  assert.equal(JSON.stringify(snapshot), before, "viewing cannot journal practice or award rewards");
});

test("every cycle has distinct stable robots, and later cycles rotate through the full catalog", async () => {
  const robots = new Set();
  for (let cycle = 0; cycle < 100; cycle++) {
    const snapshot = practice({ cycle: { target: 16, sets: 0, completed: cycle } });
    const model = campaignRoadmapModel(snapshot);
    assert.equal(new Set(model.sets.map(set => set.robot)).size, 16);
    assert.deepEqual(model, campaignRoadmapModel(snapshot));
    model.sets.forEach(set => robots.add(set.robot));
  }
  assert.equal(robots.size, 33);
  const catalog = JSON.parse(await readFile(new URL("../app-assets.json", import.meta.url), "utf8"));
  for (const path of robots) {
    const asset = catalog.assets.find(asset => `/${asset.output}` === path);
    assert.ok(asset, `offline delivery: ${path}`);
    await access(new URL(`../../../${asset.source}`, import.meta.url));
  }
});

test("finishing the sixteenth set begins the next cycle without changing the badge", () => {
  const before = campaignRoadmapModel(practice({ cycle: { target: 16, sets: 15, completed: 36 } }));
  const after = campaignRoadmapModel(practice({ effort: 0, cycle: { target: 16, sets: 0, completed: 37 } }));
  assert.equal(before.sets.find(set => set.status === "current").number, 16);
  assert.equal(after.sets.find(set => set.status === "current").number, 1);
  assert.equal(after.cycle, 38);
  assert.equal(after.stage.difficulty, 1);
  assert.equal(after.stage.completedCycles, before.stage.completedCycles);
});

function mount() {
  const browser = createBrowserHarness();
  installEnglishInterfaceContent(browser);
  const root = browser.document.createElement("section");
  root.id = "trainPanelCampaign";
  browser.document.body.append(root);
  let snapshot = practice(), starts = 0, badgeDetails = 0;
  const learning = { practiceSet: () => snapshot,
    difficultyOption: level => ({ label: ["", "Explorer", "Traveler", "Navigator"][level] }) };
  browser.window.CaatuuChrome = { openSharedSettings: () => { badgeDetails++; } };
  const roadmap = installCampaignRoadmap({ scope: browser.window, learning,
    onContinue: () => { starts++; } });
  return { ...browser, root, roadmap, update: value => { snapshot = value; },
    starts: () => starts, badgeDetails: () => badgeDetails };
}

test("only the current set starts the existing campaign; inspection never equips a badge", () => {
  const app = mount();
  app.roadmap.show();
  assert.equal(app.root.querySelectorAll(".campaign-stop").length, 16);
  assert.equal(app.root.querySelectorAll(".campaign-stop button").length, 1);
  const progress = app.root.querySelector(".campaign-stage-progress");
  assert.equal(progress.max, 425 * 16);
  assert.equal(progress.value, 195);
  app.root.querySelector(".campaign-badge-details").click();
  assert.equal(app.badgeDetails(), 1);
  assert.equal(app.starts(), 0);
  app.root.querySelector('[aria-current="step"]').click();
  assert.equal(app.starts(), 1);
  app.roadmap.show(false);
  app.root.querySelector('[aria-current="step"]').click();
  assert.equal(app.starts(), 1, "a hidden map cannot start another rotation");
  app.roadmap.destroy();
});

test("progress updates, resets and unreadable progress cannot offer stale set positions", () => {
  const app = mount();
  app.roadmap.show();
  app.update(practice({ effort: 0, cycle: { target: 16, sets: 0, completed: 0 } }));
  app.window.dispatchEvent({ type: "caatuu:learning-change" });
  assert.equal(app.root.querySelector('[aria-current="step"]').getAttribute("aria-label"), "Continue set 1");
  app.update(practice({ progression: { available: false } }));
  app.window.dispatchEvent({ type: "storage" });
  assert.equal(app.root.querySelector('[aria-current="step"]').disabled, true);
  app.root.querySelector('[aria-current="step"]').click();
  assert.equal(app.starts(), 0);
  app.update(null);
  app.window.dispatchEvent({ type: "caatuu:learning-change" });
  assert.equal(app.root.querySelectorAll(".campaign-stop").length, 0);
  app.roadmap.destroy();
});

test("Navigator continues without inventing a further badge", () => {
  const app = mount();
  app.update(practice({ progression: { available: true,
    stage: { difficulty: 3, completedCycles: 42, completedSets: 672, targetCycles: null } } }));
  app.roadmap.show();
  assert.equal(app.root.querySelectorAll(".campaign-medal").length, 1);
  assert.equal(app.root.querySelectorAll(".campaign-stage-progress").length, 0);
  app.roadmap.destroy();
});
