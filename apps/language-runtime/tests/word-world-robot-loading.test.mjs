import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { createBrowserHarness } from "./helpers/fake-browser.mjs";
import { mountRobotLoadingScreen } from "../static/source/games/embedded-game-controls.mjs";

const hostSource = await readFile(new URL("../static/source/word-world-host.mjs", import.meta.url), "utf8");
const runtimeSource = await readFile(new URL("../static/source/product-word-world.mjs", import.meta.url), "utf8");
const styleSource = await readFile(new URL("../static/styles/caatuu-word-world.css", import.meta.url), "utf8");
const functions = ["robotLoadingActive", "syncRobotLoadingActivity", "holdSentenceTransition", "setBusy"];
const loadingFunctions = functions.map((name) => {
  const start = runtimeSource.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} exists`);
  const prefix = name === "holdSentenceTransition" ? "async " : "";
  return prefix + runtimeSource.slice(start, runtimeSource.indexOf("\n}", start) + 2);
}).join("\n");

async function settle() {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

function hostFixture({ failure = false } = {}) {
  const harness = createBrowserHarness();
  const { document } = harness;
  const stage = document.createElement("div");
  stage.id = "wordNetEmbeddedStage";
  const root = document.createElement("div");
  root.id = "wordWorldRoot";
  const status = document.createElement("div");
  status.id = "wordNetEmbeddedStatus";
  status.append(document.createElement("img"), document.createElement("strong"), document.createElement("small"));
  stage.append(root, status);
  document.body.append(stage);
  let releaseMount;
  const ready = new Promise((resolve) => { releaseMount = resolve; });
  const calls = { resumed: 0, paused: 0 };
  const controller = { resume() { calls.resumed += 1; }, pause() { calls.paused += 1; } };
  Object.assign(harness.context, {
    CaatuuCourse: { id: "cz", routePrefix: "/cz" },
    CaatuuI18n: { t: () => "Preparing the next round" },
    mountRobotLoadingScreen,
    fetch: async () => {
      if (failure) throw new Error("Course unavailable");
      return { ok: true, json: async () => ({}) };
    },
    __mountWordWorld: async () => { await ready; return controller; }
  });
  const executable = hostSource
    .replace(/^import[^\n]+\n/gmu, "")
    .replace(/await import\("\.\/word-world-provider\.mjs[^"\n]*"\)/u, "({ mountWordWorld: __mountWordWorld })")
    .replace("export const CaatuuWordWorldHost", "const CaatuuWordWorldHost")
    .replace("export default CaatuuWordWorldHost;", "");
  vm.runInContext(executable, harness.context);
  return { ...harness, host: harness.context.CaatuuWordWorldHost, stage, root, status, calls, releaseMount };
}

function runtimeFixture({ active = true, deferredMinimum = false } = {}) {
  const harness = createBrowserHarness();
  const { document, window } = harness;
  const panel = document.createElement("section");
  panel.className = "word-net-sentence-panel";
  const loading = document.createElement("div");
  loading.id = "wordNetLoading";
  loading.className = "word-net-loading";
  loading.hidden = true;
  panel.append(loading);
  document.body.append(panel);
  const timers = new Map();
  let serial = 0;
  window.setTimeout = (callback, delay) => { timers.set(++serial, { callback, delay }); return serial; };
  window.clearTimeout = (id) => timers.delete(id);
  window.requestAnimationFrame = (callback) => { callback(); return 0; };
  const minimums = [];
  const loader = mountRobotLoadingScreen({ container: loading, label: "Preparing", active });
  const state = {
    loadingActive: active, loadingPageHidden: false, loadingHideTimerId: 0,
    loadingActivityWaiters: new Set(),
    loadingScreen: { ...loader, minimumVisible(ms) {
      minimums.push(ms);
      return deferredMinimum ? loader.minimumVisible(ms) : Promise.resolve();
    } }
  };
  Object.assign(harness.context, {
    state, MIN_SENTENCE_TRANSITION_MS: 800, LOADING_FADE_MS: 240,
    $: (selector) => document.querySelector(selector)
  });
  for (const name of ["closeAudioMenu", "closeTranslationMenu", "cancelCzechSpeech", "syncGenerationControl",
    "syncContentControl", "syncPreviousSentenceControl", "renderReconstruction", "syncSpeechControl",
    "syncDiagnostics", "maybeAutoplayCurrentSentence"]) harness.context[name] = () => {};
  vm.runInContext(loadingFunctions, harness.context);
  return { ...harness, loading, panel, state, minimums, timers, loader };
}

test("Word World's initial host uses the shared robot and hides it when its controller is ready", async () => {
  const game = hostFixture();
  game.host.setActive(true);
  const ready = game.host.ensureLoaded();
  await settle();
  assert.equal(game.status.hidden, false);
  assert.ok(game.status.classList.contains("caatuu-game-robot-loading"));
  assert.equal(game.status.querySelectorAll(".caatuu-game-robot-loading-art").length, 1);
  assert.equal(game.status.getAttribute("aria-label"), "Preparing the next round");
  assert.equal(game.status.querySelector("strong").textContent, "");
  assert.equal(game.status.dataset.active, "true");
  game.host.setActive(false);
  assert.equal(game.status.dataset.active, "false");
  game.releaseMount();
  await ready;
  assert.equal(game.host.ready(), true, "inactive preloading still completes");
  assert.equal(game.status.hidden, true);
  assert.equal(game.calls.paused, 1);
  game.host.setActive(true);
  assert.equal(game.calls.resumed, 1);
  game.document.visibilityState = "hidden";
  game.document.dispatchEvent({ type: "visibilitychange" });
  assert.equal(game.calls.paused, 2);
});

test("initial loading errors retain readable status text with the shared robot paused", async () => {
  const game = hostFixture({ failure: true });
  game.host.setActive(true);
  await assert.rejects(game.host.ensureLoaded(), /Course unavailable/u);
  assert.equal(game.status.hidden, false);
  assert.ok(game.status.classList.contains("is-error"));
  assert.equal(game.status.dataset.active, "false");
  assert.equal(game.status.querySelector("strong").textContent, "Word World could not start");
  assert.equal(game.status.querySelector("small").textContent, "Course unavailable");
  assert.equal(game.host.ready(), false);
});

test("sentence transitions delegate visibility and the 800ms hold to the shared robot", async () => {
  const game = runtimeFixture();
  game.context.setBusy(true);
  assert.equal(game.loading.hidden, false);
  assert.ok(game.loading.classList.contains("is-visible"));
  assert.equal(game.panel.getAttribute("aria-busy"), "true");
  await game.context.holdSentenceTransition();
  assert.deepEqual(game.minimums, [800]);
  game.context.setBusy(false);
  assert.equal(game.loading.classList.contains("is-visible"), false);
  assert.equal(game.loading.hidden, false, "retain the existing short fade before hiding");
  const [id, timer] = [...game.timers].find(([, item]) => item.delay === 240);
  game.timers.delete(id);
  timer.callback();
  assert.equal(game.loading.hidden, true);
  game.loader.destroy();
});

test("inactive preloading skips visible-time waits and activity pauses the shared blink", async () => {
  const game = runtimeFixture({ active: false });
  game.context.setBusy(true);
  assert.equal(game.loading.dataset.active, "false");
  await game.context.holdSentenceTransition();
  assert.deepEqual(game.minimums, []);
  game.state.loadingActive = true;
  game.context.syncRobotLoadingActivity();
  assert.equal(game.loading.dataset.active, "true");
  await game.context.holdSentenceTransition();
  assert.deepEqual(game.minimums, [800]);
  for (const hide of ["document", "pagehide"]) {
    if (hide === "document") game.document.visibilityState = "hidden";
    else { game.document.visibilityState = "visible"; game.state.loadingPageHidden = true; }
    game.context.syncRobotLoadingActivity();
    assert.equal(game.loading.dataset.active, "false");
    await game.context.holdSentenceTransition();
    assert.deepEqual(game.minimums, [800]);
  }
  game.loader.destroy();
});

test("hiding during the initial 800ms hold lets readiness finish without hiding the robot", async () => {
  for (const hiddenBy of ["document", "pagehide", "controller"]) {
    const game = runtimeFixture({ deferredMinimum: true });
    game.context.setBusy(true);
    let ready = false;
    void game.context.holdSentenceTransition().then(() => { ready = true; });
    await settle();
    assert.equal(ready, false, `${hiddenBy}: initially waits for visible time`);
    assert.deepEqual(game.minimums, [800]);
    assert.equal(game.state.loadingActivityWaiters.size, 1);

    if (hiddenBy === "document") game.document.visibilityState = "hidden";
    else if (hiddenBy === "pagehide") game.state.loadingPageHidden = true;
    else game.state.loadingActive = false;
    game.context.syncRobotLoadingActivity();
    await settle();
    assert.equal(ready, true, `${hiddenBy}: readiness survives becoming inactive mid-hold`);
    assert.equal(game.loading.hidden, false, "the lifecycle release does not dismiss the loading screen");
    assert.equal(game.loading.dataset.active, "false");
    assert.equal(game.state.loadingActivityWaiters.size, 0);
    assert.equal(game.timers.size, 0, "the shared visible-time timer remains paused");

    game.context.setBusy(false, { immediate: true });
    game.document.visibilityState = "visible";
    game.state.loadingPageHidden = false;
    game.state.loadingActive = true;
    game.context.setBusy(true);
    ready = false;
    void game.context.holdSentenceTransition().then(() => { ready = true; });
    await settle();
    assert.equal(ready, false, "a subsequent active transition still waits");
    assert.equal(game.loading.dataset.active, "true");
    const [id, timer] = [...game.timers][0];
    game.timers.delete(id);
    timer.callback();
    await settle();
    assert.equal(ready, true);
    assert.equal(game.state.loadingActivityWaiters.size, 0);
    game.loader.destroy();
  }
});

test("a new busy request cancels a pending hide and immediate completion hides the shared screen", () => {
  const game = runtimeFixture();
  game.context.setBusy(true);
  game.context.setBusy(false);
  game.context.setBusy(true);
  assert.equal(game.timers.size, 0);
  assert.equal(game.loading.hidden, false);
  game.context.setBusy(false, { immediate: true });
  assert.equal(game.loading.hidden, true);
  game.loader.destroy();
});

test("Word World retains only its fade policy and has no separate robot art, asset picker, or blink", () => {
  assert.doesNotMatch(runtimeSource, /ROBOT_KEYMAP|ROBOT_FALLBACK|loadingRobotRows|showLoadingRobot|hideLoadingRobot|LOADING_ROBOT_/u);
  assert.doesNotMatch(styleSource, /word-net-loading-(?:art|copy|spinner)|word-net-robot-breathe|word-net-spin/u);
  assert.match(styleSource, /\.word-net-loading\s*\{\s*opacity: 0;\s*pointer-events: none;\s*transition: opacity 240ms ease;/u);
  assert.match(runtimeSource, /pause\(\)\s*\{\s*state\.loadingActive = false;\s*syncRobotLoadingActivity\(\)/u);
  assert.match(runtimeSource, /resume\(\)\s*\{\s*state\.loadingActive = true;\s*syncRobotLoadingActivity\(\)/u);
});
