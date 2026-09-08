import assert from "node:assert/strict";
import test from "node:test";
import {
  availableSetupCourses, createNativeSetupClient, createSetupDownloadProgress, initializeCourseSetup,
  missingSetupBytes, setupCourseForPath, setupMessages,
} from "../static/source/course-setup.mjs";

const course = (id, source = "en", target = "fr") => ({
  id, routePrefix: `/${id}`, entryPath: `/${id}/index.html`,
  sourceLanguage: { id: source, locale: source, label: source },
  targetLanguage: { id: target, locale: target, label: target, nativeLabel: target },
});
const registry = { schemaVersion: 1, courses: [course("en-fr"), course("es-en", "es-ES", "en-US")] };

class Element {
  children = [];
  dataset = {};
  attributes = new Map();
  listeners = new Map();
  hidden = false;
  disabled = false;
  textContent = "";
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  addEventListener(name, callback) { this.listeners.set(name, callback); }
  setAttribute(name, value) { this.attributes.set(name, value); }
  removeAttribute(name) { this.attributes.delete(name); }
}

function screen(mode, { pathname = "/setup.html", ready = false, setupActive = false, setupStatus = null } = {}) {
  const elements = Object.fromEntries([
    "title", "description", "source-label", "source", "courses", "status", "action", "back", "cancel", "progress", "detail",
  ].map((name) => [`[data-${name}]`, new Element()]));
  const root = new Element();
  root.dataset.courseSetup = mode;
  root.querySelector = (selector) => elements[selector];
  const requests = [];
  const fetches = [];
  let reloads = 0;
  const callbacks = new Map();
  const scope = {
    document: { documentElement: {}, querySelector: () => root, createElement: () => new Element() },
    navigator: { language: "en-US" },
    location: { pathname, reload() { reloads++; } },
    localStorage: { getItem: () => null, setItem() {} },
    addEventListener(name, callback) { callbacks.set(name, callback); },
    setTimeout, clearTimeout,
    async fetch(url) { fetches.push(url); return { ok: true, json: async () => registry }; },
    CaatuuAndroid: { postMessage(raw) {
      const request = JSON.parse(raw);
      requests.push(request);
      if (request.type === "setup_status") queueMicrotask(() => scope.CaatuuNative.receive({
        id: request.id, kind: "done", result: setupStatus || { ready, setupActive, staticAssets: { assets: [{ expectedBytes: 1234, ready }] } },
      }));
    } },
  };
  return { scope, requests, fetches, elements, callbacks, reloads: () => reloads };
}

test("picker reads only bundled metadata and makes no native course requests", async () => {
  const fixture = screen("picker");
  await initializeCourseSetup(fixture.scope);
  assert.deepEqual(fixture.fetches, ["/caatuu-course-bundle.json"]);
  assert.deepEqual(fixture.requests, []);
  const list = fixture.elements["[data-courses]"];
  assert.equal(list.children.length, 1);
  assert.equal(list.children[0].children[0].href, "/en-fr/index.html");
  const source = fixture.elements["[data-source]"];
  source.value = "es-ES";
  source.listeners.get("change")();
  assert.equal(list.children.length, 1);
  assert.equal(list.children[0].children[0].href, "/es-en/index.html");
  assert.deepEqual(fixture.requests, []);
});

test("installer checks only selected trusted course and waits for an explicit download", async () => {
  const fixture = screen("install", { pathname: "/es-en/index.html", setupStatus: { ready: false, staticAssets: { assets: [
    { key: "small", artifactKind: "visual-asset", expectedBytes: 1_000_000 },
    { key: "large", artifactKind: "embedding-runtime", expectedBytes: 99_000_000 },
  ] } } });
  await initializeCourseSetup(fixture.scope);
  assert.deepEqual(fixture.requests.map(({ type }) => type), ["setup_status"]);
  assert.equal(fixture.reloads(), 0);
  assert.equal(fixture.elements["[data-action]"].disabled, false);
  const downloading = fixture.elements["[data-action]"].onclick();
  const request = fixture.requests.at(-1);
  assert.equal(request.type, "setup_download");
  fixture.scope.CaatuuNative.receive({ id: request.id, kind: "progress", artifactKey: "small", artifactKind: "visual-asset", bytes: 500_000, totalBytes: 1_000_000, artifactIndex: 1, artifactCount: 2 });
  assert.equal(fixture.elements["[data-progress]"].value, 0.5);
  assert.equal(fixture.elements["[data-detail]"].textContent, "0% · 0,5 MB / 100 MB");
  assert.equal(fixture.elements["[data-back]"].hidden, true);
  fixture.scope.CaatuuNative.receive({ id: request.id, kind: "done", result: { ready: true } });
  await downloading;
  assert.equal(fixture.reloads(), 1);
});

test("already verified courses open without downloading, while failed setup never opens the app", async () => {
  const installed = screen("install", { pathname: "/en-fr/index.html", ready: true });
  await initializeCourseSetup(installed.scope);
  assert.equal(installed.reloads(), 1);
  assert.deepEqual(installed.requests.map(({ type }) => type), ["setup_status"]);
  const failure = screen("install", { pathname: "/en-fr/index.html" });
  await initializeCourseSetup(failure.scope);
  const attempt = failure.elements["[data-action]"].onclick();
  failure.scope.CaatuuNative.receive({ id: failure.requests.at(-1).id, kind: "error", message: "hash mismatch" });
  await attempt;
  assert.equal(failure.reloads(), 0);
  assert.equal(failure.elements["[data-action]"].disabled, false);
  assert.equal(failure.elements["[data-cancel]"].hidden, true);
});

test("unknown routes and unsafe registry entries cannot initiate native downloads", async () => {
  const unknown = screen("install", { pathname: "/unknown/index.html" });
  await initializeCourseSetup(unknown.scope);
  assert.deepEqual(unknown.requests, []);
  assert.equal(setupCourseForPath(registry.courses, "/en-fr-other/index.html"), null);
  for (const override of [{ entryPath: "https://outside.test/" }, { routePrefix: "/../en-fr" }, { id: "../outside" }]) {
    assert.throws(() => availableSetupCourses({ schemaVersion: 1, courses: [{ ...course("en-fr"), ...override }] }));
  }
  assert.throws(() => availableSetupCourses({ schemaVersion: 1, courses: [course("duplicate"), course("duplicate")] }));
});

test("cancelling setup keeps the installer recoverable and never activates partial content", async () => {
  const fixture = screen("install", { pathname: "/en-fr/index.html" });
  await initializeCourseSetup(fixture.scope);
  const attempt = fixture.elements["[data-action]"].onclick();
  const download = fixture.requests.at(-1);
  const stopping = fixture.elements["[data-cancel]"].onclick();
  const abort = fixture.requests.at(-1);
  assert.equal(abort.type, "setup_abort");
  fixture.scope.CaatuuNative.receive({ id: download.id, kind: "error", message: "aborted" });
  fixture.scope.CaatuuNative.receive({ id: abort.id, kind: "done", result: { ready: false, expectedBytes: 1234, bytes: 500 } });
  await Promise.all([attempt, stopping]);
  assert.equal(fixture.reloads(), 0);
  assert.equal(fixture.elements["[data-action]"].disabled, false);
  assert.equal(fixture.elements["[data-back]"].hidden, false);
});

test("download estimates exclude verified shared files and include unverified full-length files", () => {
  assert.equal(missingSetupBytes({ staticAssets: { assets: [
    { expectedBytes: 500, bytes: 500, ready: true },
    { expectedBytes: 200, bytes: 200, ready: false },
  ] }, dictionary: { expectedBytes: 300, ready: false } }), 500);
});

test("total progress includes saved files and weights native databases by bytes regardless of download order", () => {
  const progress = createSetupDownloadProgress();
  assert.deepEqual(progress.reset({ staticAssets: { assets: [
    { key: "shared", artifactKind: "visual-asset", expectedBytes: 10, ready: true },
    { key: "loading-art", artifactKind: "visual-asset", expectedBytes: 20 },
  ] }, vectorDatabase: { modelKey: "model", expectedBytes: 60, bytes: 12 },
  dictionary: { key: "dictionary", expectedBytes: 10 } }), { bytes: 22, totalBytes: 100, percent: 22 });
  assert.equal(progress.update({ phase: "asset", artifactKey: "loading-art", artifactKind: "visual-asset", artifactIndex: 1 }).bytes, 22);
  assert.equal(progress.update({ artifactKey: "loading-art", artifactKind: "visual-asset", bytes: 10, totalBytes: 20 }).percent, 32);
  assert.equal(progress.update({ phase: "asset_ready", artifactKey: "loading-art", artifactKind: "visual-asset" }).percent, 42);
  assert.equal(progress.update({ artifactKey: "model", artifactKind: "embedding-vector-db", bytes: 30, totalBytes: 60 }).percent, 60);
  assert.equal(progress.update({ phase: "vector_ready", artifactKey: "model", artifactKind: "embedding-vector-db" }).percent, 90);
  assert.equal(progress.update({ phase: "dictionary_ready", artifactKey: "dictionary", artifactKind: "dictionary-database" }).percent, 99);
  assert.equal(progress.snapshot().bytes, 100);
  assert.equal(progress.reset({ ready: true, bytes: 100, expectedBytes: 100 }).percent, 100);
});

test("retries replace the current partial byte count without double counting or completing unverified setup", () => {
  const progress = createSetupDownloadProgress();
  progress.reset({ staticAssets: { assets: [{ key: "model", artifactKind: "embedding-runtime", expectedBytes: 100, bytes: 80 }] } });
  assert.equal(progress.update({ artifactKey: "model", artifactKind: "embedding-runtime", bytes: 20, totalBytes: 100 }).percent, 20);
  assert.equal(progress.update({ artifactKey: "model", artifactKind: "embedding-runtime", bytes: 20, totalBytes: 100 }).percent, 20);
  assert.equal(progress.update({ artifactKey: "model", artifactKind: "embedding-runtime", bytes: 200, totalBytes: 200 }).percent, 99);
  assert.equal(progress.snapshot().totalBytes, 100, "The verified catalog owns the total, not response headers");
});

test("reopening an active installer follows its status without starting another download", async () => {
  const fixture = screen("install", { pathname: "/en-fr/index.html", setupActive: true });
  const timers = [];
  fixture.scope.setTimeout = (callback, delay) => delay === 1500 ? (timers.push(callback), -1) : setTimeout(callback, delay);
  await initializeCourseSetup(fixture.scope);
  assert.equal(fixture.elements["[data-action]"].disabled, true);
  assert.equal(timers.length, 1);
  fixture.scope.CaatuuAndroid.postMessage = (raw) => {
    const request = JSON.parse(raw);
    fixture.requests.push(request);
    queueMicrotask(() => fixture.scope.CaatuuNative.receive({ id: request.id, kind: "done", result: { ready: true } }));
  };
  timers[0]();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(fixture.requests.map(({ type }) => type), ["setup_status", "setup_status"]);
  assert.equal(fixture.reloads(), 1);
  fixture.callbacks.get("pagehide")();
});

test("Android Back stops a download before allowing the installer to close", async () => {
  const fixture = screen("install", { pathname: "/en-fr/index.html" });
  await initializeCourseSetup(fixture.scope);
  assert.equal(fixture.scope.CaatuuHandleAndroidBack(), false);
  const pending = fixture.elements["[data-action]"].onclick();
  const download = fixture.requests.at(-1);
  assert.equal(fixture.scope.CaatuuHandleAndroidBack(), true);
  const abort = fixture.requests.at(-1);
  assert.equal(abort.type, "setup_abort");
  fixture.scope.CaatuuNative.receive({ id: download.id, kind: "error", message: "aborted" });
  fixture.scope.CaatuuNative.receive({ id: abort.id, kind: "done", result: { ready: false } });
  await pending;
  assert.equal(fixture.scope.CaatuuHandleAndroidBack(), false);
  fixture.callbacks.get("pagehide")();
  assert.equal(fixture.scope.CaatuuHandleAndroidBack, undefined);
});

test("a late native response from an older setup screen cannot complete a new request", async () => {
  const fixture = screen("picker");
  const previous = createNativeSetupClient(fixture.scope);
  const oldRequest = previous.request("setup_download");
  const oldId = fixture.requests.at(-1).id;
  previous.dispose();
  await assert.rejects(oldRequest);
  const current = createNativeSetupClient(fixture.scope);
  const pending = current.request("setup_download");
  const id = fixture.requests.at(-1).id;
  assert.notEqual(id, oldId);
  fixture.scope.CaatuuNative.receive({ id: oldId, kind: "done", result: { ready: true } });
  fixture.scope.CaatuuNative.receive({ id, kind: "done", result: { ready: false } });
  assert.deepEqual(await pending, { ready: false });
  current.dispose();
});

test("native responses are request-scoped, streamed progress cannot resolve completion", async () => {
  const fixture = screen("picker");
  const client = createNativeSetupClient(fixture.scope);
  const progress = [];
  const pending = client.request("setup_download", (event) => progress.push(event));
  const { id } = fixture.requests.at(-1);
  fixture.scope.CaatuuNative.receive("not-json");
  fixture.scope.CaatuuNative.receive({ id: "other", kind: "done", result: { ready: true } });
  fixture.scope.CaatuuNative.receive({ id, kind: "progress", bytes: 8 });
  assert.equal(progress.length, 1);
  fixture.scope.CaatuuNative.receive({ id, kind: "done", result: { ready: false } });
  assert.deepEqual(await pending, { ready: false });
  await assert.rejects(client.request("dictionary_download"));
  client.dispose();
  assert.equal(fixture.scope.CaatuuNative, undefined);
});

test("bootstrap translations retain the same controls across supported interface languages", () => {
  const keys = Object.keys(setupMessages.en).sort();
  for (const messages of Object.values(setupMessages)) {
    assert.deepEqual(Object.keys(messages).sort(), keys);
    assert.ok(Object.values(messages).every((value) => typeof value === "string" && value.trim()));
  }
});
