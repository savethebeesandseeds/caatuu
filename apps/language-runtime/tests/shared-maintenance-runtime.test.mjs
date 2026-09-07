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
  assert.equal(h.document.getElementById("updateApp").hidden, false);
  assert.equal(h.row.hidden, false);
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
  const activated = controller.activate();
  const available = { selfUpdateEnabled: true, updateAvailable: true, currentVersionCode: 1, latestVersionCode: 2 };
  h.reply(h.requests[0], available);
  await flush();
  assert.equal(h.requests[1].type, "update_app");
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
