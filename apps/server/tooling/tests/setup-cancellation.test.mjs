import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../../../languages/czech/static/source/features/setup/setup.js", import.meta.url), "utf8");
function between(start, end) {
  const first = source.indexOf(start);
  const last = source.indexOf(end, first);
  assert.ok(first >= 0 && last > first, "The actual setup controller is available");
  return source.slice(first, last);
}
const controller = between("  async function startSetup()", "  async function updateApp()");
const preflightController = between("  async function runStoragePreflight(", "  function setupBugReportPayload()");

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
const flush = () => new Promise((resolve) => setImmediate(resolve));

function setup({ preflight = async () => ({ ok: true }) } = {}) {
  const downloads = [];
  const events = [];
  const statuses = [];
  const stopped = [];
  const logs = [];
  const context = vm.createContext({
    runtime: { setup: {
      preflight,
      start(handlers) {
        const pending = deferred();
        downloads.push({ ...pending, handlers });
        return pending.promise;
      },
      async abort() { return { ready: false, aborted: true }; },
      async status() { return { ready: false }; }
    } },
    $() {},
    clearSetupStatusPoll() {},
    startSetupMessageCycle() {},
    setControls() {},
    setText() {},
    phaseText: (phase) => phase,
    formatBytes: (bytes) => String(bytes),
    pushLog: (...entry) => logs.push(entry),
    renderSetupEvent: (event) => events.push(event),
    renderStatus: async (status) => statuses.push(status),
    artifactRows: () => [],
    syncArtifactState() {},
    scheduleSetupStatusPoll() {},
    stopSetupUi(message) {
      stopped.push(message);
      vm.runInContext("setupRunning = false; setupAborted = true; nativeSetupActive = false; setupComplete = false;", context);
    }
  });
  vm.runInContext(`
    let setupRunning = false, setupGeneration = 0, setupAborted = false, nativeSetupActive = false;
    let setupComplete = false, updateRunning = false, setupMode = "browser";
    let lastSetupAttention = null, lastStoragePreflight = null, activeArtifactKey = "", setupMessageIndex = 0;
    const stableSetupMessage = "Preparing files";
    const progressLogBuckets = new Map();
    ${preflightController}
    ${controller}
  `, context);
  return {
    downloads, events, statuses, stopped, logs,
    start: () => vm.runInContext("startSetup()", context),
    abort: () => vm.runInContext("abortSetup()", context),
    running: () => vm.runInContext("setupRunning", context)
  };
}

test("cancelling during storage checks prevents the original attempt from starting downloads", async () => {
  const preflight = deferred();
  const app = setup({ preflight: () => preflight.promise });
  const pending = app.start();
  await app.abort();
  const logCount = app.logs.length;
  preflight.resolve({ ok: true });
  await pending;
  assert.equal(app.downloads.length, 0);
  assert.equal(app.logs.length, logCount, "A late preflight cannot replace the stopped screen");
  assert.equal(app.running(), false);
  assert.deepEqual(app.statuses, []);
});

test("an aborted download cannot update or complete its replacement attempt", async () => {
  const app = setup();
  const first = app.start();
  await flush();
  await app.abort();
  const second = app.start();
  await flush();
  assert.equal(app.downloads.length, 2);
  app.downloads[0].handlers.onEvent({ kind: "progress", bytes: 100 });
  app.downloads[0].resolve({ ready: true });
  await first;
  assert.deepEqual(app.events, []);
  assert.deepEqual(app.statuses, []);
  assert.equal(app.running(), true);
  app.downloads[1].handlers.onEvent({ kind: "progress", bytes: 10 });
  app.downloads[1].resolve({ ready: true });
  await second;
  assert.equal(app.events.length, 1);
  assert.equal(app.statuses.length, 1);
  assert.equal(app.statuses[0].ready, true);
  assert.equal(app.running(), false);
});

test("a late error from a cancelled download cannot stop the replacement", async () => {
  const app = setup();
  const first = app.start();
  await flush();
  await app.abort();
  const second = app.start();
  await flush();
  const stoppedCount = app.stopped.length;
  app.downloads[0].reject(new Error("old download aborted"));
  await first;
  assert.equal(app.stopped.length, stoppedCount);
  assert.equal(app.running(), true);
  app.downloads[1].resolve({ ready: true });
  await second;
  assert.equal(app.statuses.length, 1);
});

test("a superseded ready result cannot unlock the app after either readiness barrier", async () => {
  const renderController = between("  async function renderStatus(", "  function applyStageArt()");
  for (const barrier of ["controls", "stats"]) {
    const waiting = deferred();
    let current = true;
    let published = 0;
    const context = vm.createContext({
      document: { body: { classList: { remove() {} } } },
      waitForShellControlsBeforeReady: () => barrier === "controls" ? waiting.promise : Promise.resolve(),
      preloadBackpackStatsBeforeReady: () => barrier === "stats" ? waiting.promise : Promise.resolve(),
      syncArtifactState: () => { published += 1; },
      isCurrent: () => current
    });
    vm.runInContext(renderController, context);
    const rendering = vm.runInContext("renderStatus({ ready: true }, '', isCurrent)", context);
    await flush();
    current = false;
    waiting.resolve();
    await rendering;
    assert.equal(published, 0, `${barrier} cannot publish a superseded setup result`);
  }
});
