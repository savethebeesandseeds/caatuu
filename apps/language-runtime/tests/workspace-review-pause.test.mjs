import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { createReviewContinuation } from "../static/source/games/practice-pacing.mjs";
import { createBrowserHarness } from "./helpers/fake-browser.mjs";

const source = await readFile(new URL("../static/source/caatuu-workspace.js", import.meta.url), "utf8");
const between = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function fixture(gameId = "verb-lab") {
  let serial = 0; const frames = new Map();
  const browser = createBrowserHarness({ window: {
    requestAnimationFrame(callback) { const id = ++serial; frames.set(id, callback); return id; },
    cancelAnimationFrame(id) { frames.delete(id); }
  } });
  const panel = browser.document.createElement("section"); panel.setAttribute("data-train-panel", gameId); browser.document.body.append(panel);
  const state = { activeView: "verbs", trainTab: gameId, verbRoundTransitionId: 1, verbHintsEnabled: true };
  browser.window.CaatuuGameDynamics = { active: false };
  Object.assign(browser.context, { state, shellRobotPageHidden: false });
  vm.runInContext(between("const practicePresentationWaits =", "async function preloadVerbHintsForRound"), browser.context);
  const frame = () => { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(60_000)); };
  return { ...browser, state, panel, frames, frame, wait: () => browser.context.waitForPracticePresentation(gameId) };
}

test("readiness never replaces content while menus, rewards or another view own attention", async () => {
  for (const reason of ["menu", "dialog", "reward", "inactive", "background"]) {
    const f = fixture(), control = f.document.createElement("details"); f.panel.append(control);
    const pause = value => {
      if (reason === "menu") control.toggleAttribute("open", value);
      if (reason === "dialog") { control.setAttribute("aria-haspopup", "menu"); control.setAttribute("aria-expanded", String(value)); }
      if (reason === "speech") control.classList.toggle("is-speaking", value);
      if (reason === "reward") f.window.CaatuuGameDynamics.active = value;
      if (reason === "inactive") f.state.activeView = value ? "home" : "verbs";
      if (reason === "background") f.document.visibilityState = value ? "hidden" : "visible";
    };
    pause(true); const wait = f.wait(); let done = false; void wait.promise.then(() => { done = true; });
    for (let i = 0; i < 10; i++) f.frame(); await settle(); assert.equal(done, false, reason);
    pause(false); f.frame(); assert.equal(await wait.promise, true); assert.equal(f.frames.size, 0);
  }
});

test("shared settings and visible embedded tools block readiness; hidden menus do not", async () => {
  const f = fixture("conjugation-comet"), child = createBrowserHarness();
  const frame = f.document.createElement("iframe"); frame.contentDocument = child.document; f.panel.append(frame);
  const menu = child.document.createElement("details"); menu.setAttribute("open", ""); child.document.body.append(menu);
  const wait = f.wait(); let done = false; void wait.promise.then(() => { done = true; });
  f.frame(); await settle(); assert.equal(done, false); menu.hidden = true;
  const settings = f.document.createElement("section"); settings.id = "settingsPanel"; f.document.body.append(settings);
  f.frame(); await settle(); assert.equal(done, false); settings.hidden = true; f.frame(); assert.equal(await wait.promise, true);
});

test("cancellation fences callbacks already queued by the browser", async () => {
  for (const cancel of [f => f.context.cancelPracticePresentationWaits("verb-lab"), f => f.window.dispatchEvent({ type: "pagehide", persisted: false })]) {
    const f = fixture(), wait = f.wait(), callback = [...f.frames.values()][0]; cancel(f);
    assert.equal(await wait.promise, false); callback(); assert.equal(f.frames.size, 0);
  }
});

test("late image readiness respects rewards and has no forced loading interval", async () => {
  const f = fixture(); let finishImages, applied = 0;
  Object.assign(f.context, { renderVerbNebula() {}, setVerbMatchFeedback() {}, interfaceText: id => id,
    preloadVerbHintsForRound: () => new Promise(resolve => { finishImages = resolve; }), applyVerbRound() { applied++; } });
  vm.runInContext(between("async function prepareVerbRound(", "function preloadVerbHintAsset"), f.context);
  const prepared = f.context.prepareVerbRound({ round: [] }, 1);
  f.window.CaatuuGameDynamics.active = true; finishImages(new Map()); await settle(); f.frame(); await settle(); assert.equal(applied, 0);
  f.window.CaatuuGameDynamics.active = false; f.frame(); await prepared; assert.equal(applied, 1);
});

for (const result of ["matched", "revealed"]) test(`Verb ${result} review waits for Continue and consumes repeated input once`, () => {
  const f = fixture(), button = f.document.createElement("button"); button.id = "verbContinue"; f.panel.append(button);
  let advances = 0, exposures = 0;
  Object.assign(f.state, { verbRound: [{ id: "pair" }], verbSolutionRevealed: result === "revealed" });
  f.window.CaatuuPracticePacing = { createReviewContinuation };
  Object.assign(f.context, { $: selector => f.document.querySelector(selector), verbRoundComplete: () => result === "matched",
    recordVerbContentExposure() { exposures++; }, transitionToNextVerbRound() { advances++; f.state.verbRoundTransitioning = true; } });
  vm.runInContext(between("let verbReviewContinuation =", "function waitForVerbTransition"), f.context);
  f.context.renderVerbReviewContinuation(); for (let i = 0; i < 10; i++) f.frame();
  assert.equal(advances, 0); assert.equal(button.hidden, false); button.click(); button.click();
  assert.equal(advances, 1); assert.equal(exposures, result === "revealed" ? 1 : 0);
});
