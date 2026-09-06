import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

import { createBrowserHarness } from "./helpers/fake-browser.mjs";

const source = await readFile(new URL("../../languages/czech/static/source/features/setup/setup.js", import.meta.url), "utf8");
const readinessStart = source.indexOf("  async function waitForShellControlsBeforeReady(status)");
const readinessEnd = source.indexOf("  function renderSetupEvent(message)", readinessStart);
const updateStart = source.indexOf("  async function updateApp()");
const updateEnd = source.indexOf("  async function initSetup()", updateStart);
assert.ok(readinessStart >= 0 && readinessEnd > readinessStart);
assert.ok(updateStart >= 0 && updateEnd > updateStart);

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const flushTasks = () => new Promise((resolve) => setImmediate(resolve));

function setupBrowser({ shellReady = Promise.resolve({ ready: true }), preload = async () => {}, updateLocked = false } = {}) {
  const harness = createBrowserHarness();
  const { context, document, window } = harness;
  const card = document.createElement("section");
  card.id = "nativeSetup";
  const nav = document.createElement("nav");
  nav.dataset.caatuuBottomNav = "";
  const buttons = Object.fromEntries(["home", "games", "settings"].map((key) => {
    const button = document.createElement("button");
    button.dataset.navKey = key;
    nav.append(button);
    return [key, button];
  }));
  document.body.append(card, nav);
  const copy = new Map();
  const messages = [];
  const logs = [];
  let status = {};
  let preloads = 0;
  window.CaatuuShellReady = shellReady;
  window.CaatuuChrome = {
    async preloadBackpackStats() {
      preloads += 1;
      return preload();
    }
  };
  Object.assign(context, {
    $: (selector) => document.querySelector(selector),
    syncArtifactState(value) { status = value; },
    totalReady: () => status.artifactsReady !== false,
    hasNativeRuntime: () => true,
    setText(selector, value) {
      copy.set(selector, value);
      messages.push({ selector, value });
    },
    setProgress() {},
    pushLog: (...entry) => logs.push(entry),
    stopSetupMessageCycle() {},
    startSetupMessageCycle() {},
    startStageAnimation() {},
    showReadyStageArt() {},
    updateSummary() {},
    setControls() {},
    clearUpdateStatusPoll() {},
    scheduleUpdateStatusPoll() {},
    refreshUpdateAvailability: async () => ({ currentVersionName: "1.0" }),
    updateDownloadState: () => "",
    hasAppUpdate: () => false,
    installedUpdateReached: () => true,
    updateStatusProblem: () => false,
    updateStatusLabel: () => "1.0"
  });
  vm.runInContext(`
    let setupComplete = false;
    let nativeSetupActive = false;
    let setupRunning = false;
    let lastSetupAttention = null;
    let navigationLocked = true;
    let appUpdateLocked = ${Boolean(updateLocked)};
    let backpackStatsPreloadPromise = null;
    let updateRunning = false;
    let appUpdateUiState = "idle";
    function clearAppUpdateHandoff() { appUpdateLocked = false; }
    ${source.slice(readinessStart, readinessEnd)}
    ${source.slice(updateStart, updateEnd)}
    setNavigationLocked(true);
  `, context);
  return {
    ...harness, buttons, card, copy, messages, logs, nav,
    preloads: () => preloads,
    state: () => vm.runInContext("({ setupComplete, navigationLocked, appUpdateLocked })", context),
    render(value = { ready: true }) {
      context.testStatus = value;
      return vm.runInContext("renderStatus(testStatus)", context);
    },
    checkUpdate() { return vm.runInContext("updateApp()", context); }
  };
}

test("verified local files wait for working app controls and saved stats before announcing readiness", async () => {
  const shell = deferred();
  const stats = deferred();
  const browser = setupBrowser({ shellReady: shell.promise, preload: () => stats.promise });
  browser.card.classList.add("is-ready");
  const rendering = browser.render();
  await flushTasks();

  assert.equal(browser.copy.get("#setupTitle"), "Preparing Caatuu");
  assert.equal(browser.copy.get("#setupPhase"), "App controls");
  assert.equal(browser.card.classList.contains("is-ready"), false);
  assert.equal(browser.state().setupComplete, false);
  assert.equal(browser.state().navigationLocked, true);
  assert.equal(browser.buttons.games.getAttribute("aria-disabled"), "true");
  assert.equal(browser.preloads(), 0, "stats cannot substitute for the app-controls barrier");

  shell.resolve({ ready: true });
  await flushTasks();
  assert.equal(browser.copy.get("#setupPhase"), "Learning stats");
  assert.equal(browser.state().setupComplete, false);
  assert.equal(browser.state().navigationLocked, true);

  stats.resolve();
  await rendering;
  assert.equal(browser.copy.get("#setupTitle"), "Caatuu is ready");
  assert.equal(browser.card.classList.contains("is-ready"), true);
  assert.equal(browser.state().setupComplete, true);
  assert.equal(browser.state().navigationLocked, false);
  assert.equal(browser.buttons.games.hasAttribute("aria-disabled"), false);
});

test("incomplete files render without waiting on controls and remain locked after controls finish", async () => {
  const shell = deferred();
  const browser = setupBrowser({ shellReady: shell.promise });
  await browser.render({ ready: true, artifactsReady: false });
  shell.resolve({ ready: true });
  await flushTasks();
  assert.equal(browser.copy.get("#setupTitle"), "Preparing Caatuu");
  assert.equal(browser.state().setupComplete, false);
  assert.equal(browser.state().navigationLocked, true);
  assert.equal(browser.preloads(), 0);

  await browser.render({ ready: true, artifactsReady: true });
  assert.equal(browser.state().setupComplete, true);
  assert.equal(browser.state().navigationLocked, false);
});

test("failed or missing app-controls readiness never announces ready or unlocks verified files", async () => {
  for (const shellReady of [
    null,
    Promise.resolve({ ready: false, error: new Error("Course data failed") }),
    Promise.resolve({ ready: false })
  ]) {
    const browser = setupBrowser({ shellReady });
    await assert.rejects(browser.render(), /App controls|Course data failed/u);
    assert.equal(browser.state().setupComplete, false);
    assert.equal(browser.state().navigationLocked, true);
    assert.equal(browser.card.classList.contains("is-ready"), false);
    assert.equal(browser.messages.some(({ value }) => value === "Caatuu is ready"), false);
    assert.equal(browser.preloads(), 0);
  }
});

test("working controls preserve the separate confirmed-update navigation lock", async () => {
  const browser = setupBrowser({ updateLocked: true });
  await browser.render();
  assert.equal(browser.state().setupComplete, true);
  assert.equal(browser.state().appUpdateLocked, true);
  assert.equal(browser.state().navigationLocked, true);
  assert.equal(browser.buttons.home.getAttribute("aria-disabled"), "true");
});

test("up-to-date and installed-update checks do not claim readiness while app preparation is incomplete", async () => {
  for (const updateLocked of [false, true]) {
    const browser = setupBrowser({ updateLocked });
    await browser.checkUpdate();
    assert.equal(browser.copy.get("#setupTitle"), "Preparing Caatuu");
    assert.equal(browser.copy.get("#setupCount"), "Preparing");
    assert.equal(browser.messages.some(({ value }) => value === "Caatuu is ready"), false);
    assert.equal(browser.state().setupComplete, false);
    assert.equal(browser.state().navigationLocked, true);
  }
});

test("update checks retain ready copy once files and app controls are ready", async () => {
  const browser = setupBrowser();
  await browser.render();
  await browser.checkUpdate();
  assert.equal(browser.copy.get("#setupTitle"), "Caatuu is ready");
  assert.equal(browser.copy.get("#setupCount"), "Ready");
  assert.equal(browser.state().navigationLocked, false);
});
