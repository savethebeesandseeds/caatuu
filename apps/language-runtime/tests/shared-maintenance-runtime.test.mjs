import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { createBrowserHarness } from "./helpers/fake-browser.mjs";
import { englishInterfaceContent, installEnglishInterfaceContent } from "./helpers/english-interface-content.mjs";

const source = await readFile(new URL("../static/source/maintenance-ui.js", import.meta.url), "utf8");
const bootstrap = await readFile(new URL("../static/source/app-bootstrap.mjs", import.meta.url), "utf8");
const profile = await readFile(new URL("../../languages/mandarin-simplified/static/source/shared/course-profile.js", import.meta.url), "utf8");
const spanishProfile = await readFile(new URL("../../languages/spanish/static/source/shared/course-profile.js", import.meta.url), "utf8");
const flush = () => new Promise((resolve) => setImmediate(resolve));

function harness({ android = true, confirm = true, existing = null, speech = true, courseProfile = profile, timers = null, setupProvider = false } = {}) {
  const browser = createBrowserHarness();
  const { context, document } = browser;
  // Tests trigger startup explicitly; direct controller tests control native replies.
  document.readyState = "loading";
  // A real browser's global object and window are the same object.
  context.window = context;
  context.confirm = () => confirm;
  context.CaatuuRuntime = existing;
  vm.runInContext(courseProfile, context);
  context.course = context.CaatuuCourse;
  if (!speech) context.course = { ...context.course, capabilities: { ...context.course.capabilities, speech: false } };
  if (setupProvider) context.course = { ...context.course, browserProviders: { setupProvider: "source/setup.js?v=test-1" } };
  context.CaatuuCourse = context.course;
  installEnglishInterfaceContent(context);
  context.t = englishInterfaceContent.t;
  context.languageName = englishInterfaceContent.languageName;
  const requests = [];
  if (android) context.CaatuuAndroid = { postMessage: (raw) => requests.push(JSON.parse(raw)) };
  vm.runInContext(bootstrap.slice(bootstrap.indexOf("const nativeSpeechPending"), bootstrap.indexOf("function setCourseIdentity")), context);
  context.installSharedSpeechRuntime();
  const row = document.createElement("div");
  row.dataset.maintenanceActionRow = "";
  row.hidden = true;
  for (const id of ["updateApp", "maintenanceStatus", "settingsVersion", "browserInstallActions"]) {
    const node = document.createElement(id === "updateApp" ? "button" : "div");
    node.id = id;
    node.hidden = id === "updateApp";
    row.append(node);
  }
  document.body.append(row);
  if (timers) {
    let timerSequence = 0;
    context.setTimeout = (callback, delay) => { const id = ++timerSequence; timers.set(id, { callback, delay }); return id; };
    context.clearTimeout = (id) => timers.delete(id);
  }
  vm.runInContext(source, context);
  return {
    ...browser, requests, row,
    runtime: context.CaatuuRuntime,
    ui: context.CaatuuMaintenanceUi,
    reply(request, result) { context.CaatuuNative.receive(JSON.stringify({ id: request.id, kind: "done", result })); }
  };
}

test("Mandarin gets update and cache operations without replacing its working speech bridge", async () => {
  const h = harness();
  assert.equal(h.document.getElementById("updateApp").hidden, true);
  assert.equal(h.row.hidden, true);
  const speaking = h.runtime.speech.speak("你好");
  const checking = h.ui.getUpdateController().refresh();
  const clearing = h.runtime.maintenance.clearCache();
  assert.deepEqual(h.requests.map(({ type }) => type), ["speech_speak", "update_app_status", "clear_cache"]);
  h.reply(h.requests[2], { bytesDeleted: 10 });
  h.reply(h.requests[0], { outcome: "completed" });
  h.reply(h.requests[1], { currentVersionName: "1.0", currentVersionCode: 1, updateAvailable: false });
  assert.equal((await clearing).bytesDeleted, 10);
  assert.equal((await speaking).outcome, "completed");
  await checking;
  assert.ok(h.document.getElementById("settingsVersion").textContent.includes("1.0"));
});

test("startup and resume checks are quiet and show a separate Home action only for an available APK", async () => {
  const h = harness();
  const homeRow = h.document.createElement("div");
  homeRow.setAttribute("data-app-update-container", "");
  const home = h.document.createElement("button");
  home.setAttribute("data-app-update-control", "");
  homeRow.append(home);
  h.document.body.append(homeRow);
  h.document.dispatchEvent({ type: "DOMContentLoaded" });
  assert.equal(h.requests[0].type, "update_app_status");
  assert.equal(homeRow.hidden, true);
  h.reply(h.requests[0], { selfUpdateEnabled: true, currentVersionCode: 1, updateAvailable: false });
  await flush();
  assert.equal(homeRow.hidden, true);
  assert.equal(h.document.getElementById("maintenanceStatus").textContent, "");
  h.document.visibilityState = "visible";
  h.document.dispatchEvent({ type: "visibilitychange" });
  h.reply(h.requests[1], { selfUpdateEnabled: true, currentVersionCode: 1, latestVersionCode: 2, updateAvailable: true });
  await flush();
  assert.equal(homeRow.hidden, false);
  assert.equal(home.hidden, false);
  assert.equal(h.document.getElementById("updateApp").hidden, false);
  assert.equal(h.document.getElementById("maintenanceStatus").textContent, "");
  assert.deepEqual(h.requests.map(({ type }) => type), ["update_app_status", "update_app_status"], "background checks never start an APK download");
});

test("a failed background update check is silent", async () => {
  const h = harness({ android: false, existing: { env: "browser", maintenance: {
    updateStatus: async () => { throw new Error("Offline"); }
  } } });
  h.document.dispatchEvent({ type: "DOMContentLoaded" });
  await flush();
  assert.equal(h.document.getElementById("maintenanceStatus").textContent, "");
  assert.equal(h.document.getElementById("updateApp").hidden, true);
});

function browserWorkers(h, { installed = false } = {}) {
  const serviceWorker = h.document.createElement("div");
  const registration = h.document.createElement("div");
  const worker = () => {
    const node = h.document.createElement("div");
    node.state = "installing";
    return node;
  };
  serviceWorker.controller = installed ? worker() : null;
  registration.active = serviceWorker.controller;
  registration.installing = worker();
  registration.update = async () => {};
  serviceWorker.getRegistration = async () => registration;
  h.context.navigator.serviceWorker = serviceWorker;
  return { serviceWorker, registration, worker };
}

test("browser first installation stays quiet; a later ready worker shows Update without reloading", async () => {
  const h = harness({ android: false });
  const { serviceWorker, registration, worker } = browserWorkers(h);
  let reloads = 0;
  h.context.location.reload = () => { reloads += 1; };
  const controller = h.ui.getUpdateController();
  await controller.refresh({ announce: false });
  registration.installing.state = "activated";
  registration.installing.dispatchEvent({ type: "statechange" });
  registration.active = registration.installing;
  registration.installing = null;
  serviceWorker.controller = registration.active;
  serviceWorker.dispatchEvent({ type: "controllerchange" });
  assert.equal(h.document.getElementById("updateApp").hidden, true);

  registration.installing = worker();
  registration.dispatchEvent({ type: "updatefound" });
  assert.equal(h.document.getElementById("updateApp").hidden, true, "an unfinished download is not offered");
  registration.installing.state = "installed";
  registration.installing.dispatchEvent({ type: "statechange" });
  assert.equal(h.document.getElementById("updateApp").hidden, false);
  assert.equal(h.document.getElementById("updateApp").textContent, englishInterfaceContent.t("settings.update.title"));
  serviceWorker.controller = registration.installing;
  registration.active = registration.installing;
  registration.active.state = "activated";
  registration.installing = null;
  serviceWorker.dispatchEvent({ type: "controllerchange" });
  await controller.refresh({ force: true, announce: false });
  assert.equal(h.document.getElementById("updateApp").hidden, false, "an automatically activated worker still needs a page update");
  assert.equal(reloads, 0);
  await controller.activate();
  assert.equal(reloads, 1, "only the user's Update action reloads the page");
});

test("a browser worker already waiting or newly claiming control makes the update available", async () => {
  for (const waiting of [true, false]) {
    const h = harness({ android: false });
    const { serviceWorker, registration, worker } = browserWorkers(h, { installed: true });
    registration.installing = null;
    if (waiting) { registration.waiting = worker(); registration.waiting.state = "installed"; }
    const controller = h.ui.getUpdateController();
    await controller.refresh({ announce: false });
    if (!waiting) {
      assert.equal(h.document.getElementById("updateApp").hidden, true);
      serviceWorker.controller = worker();
      serviceWorker.dispatchEvent({ type: "controllerchange" });
    }
    assert.equal(h.document.getElementById("updateApp").hidden, false);
  }
});

test("maintenance does not depend on speech and preserves existing course maintenance", async () => {
  const h = harness({ speech: false });
  assert.equal(h.runtime.speech, undefined);
  const checking = h.runtime.maintenance.updateStatus();
  h.reply(h.requests[0], { currentVersionCode: 1 });
  assert.equal((await checking).currentVersionCode, 1);
  const maintenance = { updateStatus: async () => ({}) };
  assert.equal(harness({ existing: { env: "android", maintenance } }).runtime.maintenance, maintenance);
});

test("confirmed Mandarin updates run through the native installer without a missing setup handoff", async () => {
  const h = harness();
  const location = h.context.location.href;
  const controller = h.ui.getUpdateController();
  const home = h.document.createElement("button");
  home.setAttribute("data-app-update-control", "");
  h.document.body.append(home);
  controller.render();
  const activated = controller.activate();
  const available = { selfUpdateEnabled: true, updateAvailable: true, currentVersionCode: 1, latestVersionCode: 2 };
  h.reply(h.requests[0], available);
  await flush();
  assert.equal(h.requests[1].type, "update_app");
  assert.equal(home.disabled, true, "Home shares the native download lock");
  assert.equal(home.textContent, h.document.getElementById("updateApp").textContent);
  assert.equal(h.context.location.href, location);
  assert.equal(h.ui.pendingAppUpdate(), null);
  h.context.CaatuuNative.receive({ id: h.requests[1].id, kind: "progress", phase: "download", bytes: 100, totalBytes: 200 });
  assert.ok(h.document.getElementById("maintenanceStatus").textContent.includes("50.0%"));
  const second = controller.activate();
  assert.equal(h.requests.length, 2, "double clicks cannot start a second download");
  h.reply(h.requests[1], { action: "installer", reused: true });
  await flush();
  assert.equal(h.requests[2].type, "update_app_status");
  h.reply(h.requests[2], { ...available, downloadReady: true, downloadedVersionCode: 2 });
  await Promise.all([activated, second]);
  assert.equal(h.document.getElementById("updateApp").disabled, false);
  assert.equal(home.disabled, false);
  assert.equal(h.context.location.href, location);
});

test("declined updates make no download request and native failures remain retryable", async () => {
  const h = harness({ confirm: false });
  const activation = h.ui.getUpdateController().activate();
  h.reply(h.requests[0], { selfUpdateEnabled: true, updateAvailable: true, currentVersionCode: 1, latestVersionCode: 2 });
  await activation;
  assert.equal(h.requests.length, 1);
  const failure = h.runtime.maintenance.clearCache();
  h.context.CaatuuNative.receive({ id: h.requests[1].id, kind: "error", message: "Cache is busy" });
  await assert.rejects(failure, /Cache is busy/u);
  const retry = h.runtime.maintenance.clearCache();
  h.reply(h.requests[2], { bytesDeleted: 1 });
  assert.equal((await retry).bytesDeleted, 1);
});

test("browser cache clearing keeps other courses and saved learning progress", async () => {
  const h = harness({ android: false, courseProfile: spanishProfile });
  // Overlapping storage namespaces must not make one course own another's caches.
  const names = ["caatuu-es-pwa-v1", "caatuu-es-setup-v1", "caatuu-es-en-pwa-v1", "caatuu-es-en-setup-v1", "other-course"];
  const deleted = [];
  h.context.caches = { keys: async () => names, delete: async (name) => { deleted.push(name); return true; } };
  h.context.localStorage.setItem("learning-progress", "keep");
  const result = await h.runtime.maintenance.clearCache();
  assert.deepEqual(deleted, names.slice(0, 2));
  assert.equal(result.cacheNamesDeleted.length, 2);
  assert.equal(h.context.localStorage.getItem("learning-progress"), "keep");
  assert.equal((await h.runtime.maintenance.updateStatus()).selfUpdateEnabled, false);
  assert.equal(h.document.getElementById("updateApp").hidden, true);
});

test("browser refresh waits for the new offline worker and preserves the page when offline", async () => {
  const h = harness({ android: false });
  let reloads = 0;
  let onStateChange;
  let removed = 0;
  const messages = [];
  const worker = {
    state: "installing",
    addEventListener(type, listener) { onStateChange = listener; },
    removeEventListener() { removed += 1; },
    postMessage(message) { messages.push(message); }
  };
  h.context.location.reload = () => { reloads += 1; };
  h.context.navigator.serviceWorker = { getRegistration: async () => ({ update: async () => {}, installing: worker }) };
  const updating = h.runtime.maintenance.updateApp();
  await flush();
  assert.equal(reloads, 0);
  worker.state = "installed";
  onStateChange();
  assert.equal(messages[0].type, "SKIP_WAITING");
  assert.equal(reloads, 0);
  worker.state = "activated";
  onStateChange();
  assert.equal((await updating).reloaded, true);
  assert.equal(reloads, 1);
  assert.equal(removed, 1);
  h.context.navigator.onLine = false;
  assert.equal((await h.runtime.maintenance.updateApp()).offline, true);
  assert.equal(reloads, 1);
});

test("Home and lazily created About update controls share status and a single browser refresh", async () => {
  let updates = 0;
  let finishUpdate;
  const h = harness({ android: false, existing: { env: "browser", maintenance: {
    updateStatus: async () => ({ selfUpdateEnabled: false, updateAvailable: true }),
    updateApp: () => { updates += 1; return new Promise((resolve) => { finishUpdate = resolve; }); }
  } } });
  const controller = h.ui.getUpdateController();
  const home = h.document.createElement("button");
  home.setAttribute("data-app-update-control", "");
  const status = h.document.createElement("p");
  status.id = "homeUpdateStatus";
  h.document.body.append(home, status);
  // Replace About with a fresh node as happens when Settings is first rendered.
  h.document.getElementById("updateApp").remove();
  const about = h.document.createElement("button");
  about.id = "updateApp";
  h.row.append(about);
  await controller.refresh();
  await controller.refresh();
  assert.equal(home.hidden, false);
  assert.equal(about.hidden, false);
  assert.equal(home.textContent, about.textContent);
  home.click();
  about.click();
  await flush();
  assert.equal(updates, 1);
  assert.ok(home.disabled && about.disabled);
  finishUpdate({ offline: true });
  await flush();
  assert.equal(status.textContent, h.document.getElementById("maintenanceStatus").textContent);
  assert.equal(status.textContent, englishInterfaceContent.t("maintenance.browser.offline"));
  assert.equal(status.hidden, false);
  assert.ok(!home.disabled && !about.disabled);
  about.click();
  await flush();
  assert.equal(updates, 2, "the later About button is bound exactly once and can retry");
  finishUpdate({});
  await flush();
});

test("a download started by an earlier page becomes installable without reopening Settings", async () => {
  const timers = new Map();
  const h = harness({ timers });
  const available = { selfUpdateEnabled: true, updateAvailable: true, currentVersionCode: 1, latestVersionCode: 2 };
  const checking = h.ui.getUpdateController().refresh();
  h.reply(h.requests[0], { ...available, downloadActive: true, downloadState: "downloading" });
  await checking;
  assert.equal(h.document.getElementById("updateApp").disabled, true);
  const [id, poll] = [...timers].find(([, timer]) => timer.delay === 2500);
  timers.delete(id);
  poll.callback();
  assert.equal(h.requests[1].type, "update_app_status");
  h.reply(h.requests[1], { ...available, downloadReady: true, downloadedVersionCode: 2 });
  await flush();
  assert.equal(h.document.getElementById("updateApp").disabled, false);
  assert.equal(timers.size, 0, "polling ends after the existing download completes");
  h.document.visibilityState = "visible";
  h.document.dispatchEvent({ type: "visibilitychange" });
  assert.equal(h.requests[2].type, "update_app_status");
  h.reply(h.requests[2], { ...available, updateAvailable: false, currentVersionCode: 2 });
  await flush();
  assert.equal(timers.size, 0);
});

test("installer success survives a subsequent status failure", async () => {
  const h = harness();
  const activation = h.ui.getUpdateController().activate();
  h.reply(h.requests[0], { selfUpdateEnabled: true, updateAvailable: true, currentVersionCode: 1, latestVersionCode: 2 });
  await flush();
  const result = { action: "installer", reused: true };
  h.reply(h.requests[1], result);
  await flush();
  h.context.CaatuuNative.receive({ id: h.requests[2].id, kind: "error", message: "offline" });
  await activation;
  assert.equal(h.document.getElementById("maintenanceStatus").textContent, h.ui.updateResultMessage(result));
  assert.equal(h.document.getElementById("updateApp").disabled, false);
});

test("courses with a setup provider retain their confirmed update handoff", async () => {
  const h = harness({ setupProvider: true });
  const activation = h.ui.getUpdateController().activate();
  h.reply(h.requests[0], { selfUpdateEnabled: true, updateAvailable: true, currentVersionCode: 1, latestVersionCode: 2 });
  await activation;
  assert.equal(h.requests.length, 1);
  assert.equal(h.context.location.href, "index.html");
  assert.equal(h.ui.pendingAppUpdate().latestVersionCode, 2);
});
