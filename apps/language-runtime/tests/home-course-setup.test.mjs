import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { initializeHomeCourseSetup } from "../static/source/course-setup.mjs";
import { createInterfaceContent } from "../static/source/interface-content.mjs";
import { createBrowserHarness } from "./helpers/fake-browser.mjs";

const chromeSource = await readFile(new URL("../static/source/caatuu-chrome.js", import.meta.url), "utf8");
const catalogs = Object.fromEntries(await Promise.all(["en", "es"].map(async (locale) => [
  locale, createInterfaceContent(JSON.parse(await readFile(new URL(`../static/data/interface/${locale}.v1.json`, import.meta.url), "utf8"))),
])));
const language = (id, locale, label, nativeLabel = label) => ({
  id, locale, label, nativeLabel, flagSrc: `/assets/icons/${id}-flag.png`,
});
const english = language("en", "en-US", "English");
const spanish = language("es", "es-ES", "Spanish", "Español");
const course = (id, sourceLanguage, targetLanguage) => ({
  id, status: "active", routePrefix: `/${id}`, entryPath: `/${id}/index.html`, sourceLanguage, targetLanguage,
});
const courses = [
  course("cz", english, language("cs", "cs-CZ", "Czech", "Čeština")),
  course("zh", english, language("zh", "zh-Hans", "Chinese", "中文")),
  course("es", english, spanish),
  course("es-en", spanish, english),
  course("nb", english, language("nb", "nb-NO", "Norwegian", "Norsk bokmål")),
];
const flush = () => new Promise((resolve) => setImmediate(resolve));

function home({ id = "cz", pathname = null, status = { ready: false }, pendingCourse = null, rememberedCourse = null, bundled = courses.map((item) => item.id) } = {}) {
  const selected = { ...courses.find((item) => item.id === id), courseSelector: { schemaVersion: 1, courses } };
  const navigations = [];
  const requests = [];
  const polling = new Map();
  const priorReceiver = { receive() {} };
  const harness = createBrowserHarness({
    course: selected,
    localStorageValues: {
      "caatuu.appearance.theme.v1": "dark", "caatuu-czech.learning.performance.v1": "saved progress",
      ...(rememberedCourse ? { "caatuu.setup.selected-course.v1": rememberedCourse } : {}),
    },
    sessionStorageValues: pendingCourse ? { "caatuu.setup.pending-course.v1": pendingCourse } : {},
    location: { pathname: pathname || selected.entryPath, assign: (path) => navigations.push(path) },
  });
  const { document, window } = harness;
  const nodes = {};
  function add(tag, id, parent) {
    const element = document.createElement(tag);
    element.id = id;
    parent.append(element);
    nodes[id] = element;
    return element;
  }
  const main = add("main", "homeBaseView", document.body);
  const art = add("img", "originalArt", main);
  art.className = "stage-art";
  art.src = "/language-runtime/static/assets/caatuu-shell-512.png";
  const card = add("section", "nativeSetup", main);
  for (const node of ["setupTitle", "setupPhase", "setupMessage", "setupPercent", "setupCount", "setupBytes", "setupProgress", "setupProgressBar", "setupDetails"]) add("div", node, card);
  for (const node of ["setupAction", "setupAbort", "setupDetailsToggle", "setupReportBug"]) add("button", node, card);
  add("div", "progressMeta", card).className = "setup-progress-meta";
  const choices = add("section", "setupLanguageSelection", card);
  const form = add("form", "setupLanguageForm", choices);
  add("div", "setupSourceLanguageOptions", form);
  const target = add("fieldset", "setupTargetLanguageQuestion", form);
  add("div", "setupTargetLanguageOptions", target);
  add("button", "setupLanguageContinue", form);
  add("section", "homeLanguageCard", main);
  const content = selected.sourceLanguage.id === "es" ? catalogs.es : catalogs.en;
  window.CaatuuI18n = content;
  window.CaatuuShellReady = new Promise(() => {});
  window.CaatuuNative = priorReceiver;
  window.CaatuuAndroid = {
    isCourseBundled: (courseId) => bundled.includes(courseId),
    postMessage(raw) {
      const request = JSON.parse(raw);
      requests.push(request);
      if (request.type === "setup_status") queueMicrotask(() => reply(request, status));
    },
  };
  window.setTimeout = (callback, delay) => {
    if (delay !== 1500) return setTimeout(callback, delay);
    const timer = {};
    polling.set(timer, callback);
    return timer;
  };
  window.clearTimeout = (timer) => { polling.delete(timer); clearTimeout(timer); };
  function reply(request, result, kind = "done") {
    window.CaatuuNative.receive({ id: request.id, kind, ...(kind === "error" ? { message: result } : { result }) });
  }
  let settled = false;
  const completion = initializeHomeCourseSetup(window);
  completion.then(() => { settled = true; }, () => {});
  return {
    ...harness, nodes, requests, navigations, polling, completion, priorReceiver, content,
    setStatus(value) { status = value; },
    settled: () => settled,
    reply,
    select(source, target) {
      const choose = (parent, value) => {
        const input = nodes[parent].querySelectorAll("input").find((item) => item.value === value);
        assert.ok(input, `${value} is a visible choice`);
        input.checked = true;
        input.dispatchEvent({ type: "change" });
      };
      choose("setupSourceLanguageOptions", source);
      choose("setupTargetLanguageOptions", target);
    },
    submit() { nodes.setupLanguageForm.dispatchEvent({ type: "submit" }); },
    async close() {
      if (settled) return;
      window.dispatchEvent({ type: "pagehide" });
      await assert.rejects(completion, { name: "AbortError" });
    },
  };
}

test("missing content keeps the original Home and both source languages without downloading or changing preferences", async () => {
  const fixture = home();
  await flush();
  assert.deepEqual(fixture.requests.map(({ type }) => type), ["setup_status"]);
  assert.deepEqual(fixture.nodes.setupSourceLanguageOptions.querySelectorAll("input").map(({ value }) => value), ["en", "es"]);
  assert.equal(fixture.nodes.originalArt.src, "/language-runtime/static/assets/caatuu-shell-512.png");
  assert.equal(fixture.nodes.homeLanguageCard.isConnected, true);
  assert.equal(fixture.nodes.setupTargetLanguageQuestion.disabled, true);
  assert.equal(fixture.nodes.nativeSetup.classList.contains("is-ready"), false);
  assert.equal(fixture.document.body.classList.contains("setup-blocked"), true);
  assert.equal(fixture.localStorage.getItem("caatuu.appearance.theme.v1"), "dark");
  assert.equal(fixture.localStorage.getItem("caatuu-czech.learning.performance.v1"), "saved progress");
  await fixture.close();
});

test("Spanish to English selection reaches only its trusted route and hands off only the confirmed course", async () => {
  const initial = home();
  await flush();
  initial.select("es", "es-en");
  initial.submit();
  assert.deepEqual(initial.navigations, ["/es-en/index.html"]);
  assert.deepEqual(initial.requests.map(({ type }) => type), ["setup_status"]);
  const selected = home({ id: "es-en", pendingCourse: initial.sessionStorage.getItem("caatuu.setup.pending-course.v1") });
  await flush();
  assert.deepEqual(selected.requests.map(({ type }) => type), ["setup_status", "setup_download"]);
  assert.equal(selected.nodes.setupTitle.textContent, catalogs.es.t("setup.preparing"));
  assert.equal(selected.sessionStorage.getItem("caatuu.setup.pending-course.v1"), null);
  selected.reply(selected.requests.at(-1), { ready: true });
  assert.equal(await selected.completion, true);
  assert.equal(selected.window.CaatuuNative, selected.priorReceiver);
  assert.equal(selected.nodes.nativeSetup.classList.contains("is-ready"), false, "content readiness cannot prematurely enable games");
  await initial.close();
});

test("confirming a new native course in Home prepares that course without a second language picker", async () => {
  for (const target of courses) {
    const current = courses.find((item) => item.id !== target.id);
    const assignments = [];
    const chooser = createBrowserHarness({
      course: {
        ...current, capabilities: {}, games: [],
        routes: { home: current.entryPath, games: current.entryPath, settings: current.entryPath },
        storage: { namespace: `caatuu-${current.id}`, theme: "test.theme", fontSize: "test.font-size" },
        courseSelector: { schemaVersion: 1, courses },
      },
      localStorageValues: { "caatuu.setup.selected-course.v1": current.id },
      location: { pathname: current.entryPath, assign: (path) => assignments.push(path) },
      window: { CaatuuAndroid: { postMessage() {}, isCourseBundled: (id) => courses.some((item) => item.id === id) } },
    });
    chooser.context.CaatuuI18n = chooser.window.CaatuuI18n = current.sourceLanguage.id === "es" ? catalogs.es : catalogs.en;
    const trigger = chooser.document.createElement("button");
    trigger.dataset.caatuuLanguageSwitch = "";
    trigger.dataset.languageSwitchVariant = "home";
    chooser.document.body.append(trigger);
    vm.runInContext(chromeSource, chooser.context, { filename: "caatuu-chrome.js" });
    trigger.click();
    const menu = chooser.document.querySelector("[data-language-selector-menu]");
    menu.querySelector(`[data-language-base-option="${target.sourceLanguage.locale.toLowerCase()}"]`).click();
    menu.querySelector(`[data-language-course-option="${target.id}"]`).click();
    menu.querySelector("[data-language-selector-review]").click();
    menu.querySelector("[data-language-selector-confirm]").click();
    assert.deepEqual(assignments, [target.entryPath]);

    const selected = home({
      id: target.id,
      pendingCourse: chooser.sessionStorage.getItem("caatuu.setup.pending-course.v1"),
      rememberedCourse: chooser.localStorage.getItem("caatuu.setup.selected-course.v1"),
    });
    try {
      await flush();
      assert.deepEqual(selected.requests.map(({ type }) => type), ["setup_status", "setup_download"], target.id);
      assert.equal(selected.nodes.setupLanguageSelection.hidden, true, target.id);
      assert.equal(selected.settled(), false, "course imports still wait for verified content");
      assert.equal(selected.document.body.classList.contains("setup-blocked"), true);
      assert.equal(selected.sessionStorage.getItem("caatuu.setup.pending-course.v1"), null);
      selected.reply(selected.requests.at(-1), { ready: true });
      assert.equal(await selected.completion, true);
    } finally {
      await selected.close();
    }
  }
});

test("verified saved courses continue without downloads and without awaiting the later shell barrier", async () => {
  const fixture = home({ id: "es-en", status: { ready: true } });
  assert.equal(await fixture.completion, true);
  assert.deepEqual(fixture.requests.map(({ type }) => type), ["setup_status"]);
  assert.equal(fixture.window.CaatuuNative, fixture.priorReceiver);
  assert.equal(fixture.nodes.setupAction.onclick, null);
  assert.equal(fixture.nodes.nativeSetup.classList.contains("is-ready"), false);
  assert.equal(fixture.document.body.classList.contains("setup-blocked"), true);
});

test("native course Home aliases preserve course identity without accepting another course path", async () => {
  for (const pathname of ["/es-en", "/es-en/"]) {
    const fixture = home({ id: "es-en", pathname, status: { ready: true } });
    assert.equal(await fixture.completion, true);
  }
  assert.throws(() => home({ id: "es-en", pathname: "/cz/index.html" }), /selected bundled course route/u);
  assert.throws(() => home({ id: "es-en", pathname: "/es-en-other/index.html" }), /selected bundled course route/u);
});

test("integrated progress waits for verified completion, exposes retry after failures and keeps incomplete content locked", async () => {
  const fixture = home({ status: { ready: false, staticAssets: { assets: [
    { key: "art", artifactKind: "visual-asset", expectedBytes: 10_000_000, bytes: 10_000_000, ready: true },
    { key: "model", artifactKind: "embedding-runtime", expectedBytes: 90_000_000, bytes: 0 },
  ] } } });
  await flush();
  fixture.select("en", "cz");
  fixture.submit();
  const download = fixture.requests.at(-1);
  assert.equal(download.type, "setup_download");
  fixture.window.CaatuuNative.receive({ id: download.id, kind: "progress", artifactKey: "model", artifactKind: "embedding-runtime", artifactIndex: 2, artifactCount: 2, bytes: 45_000_000, totalBytes: 90_000_000 });
  assert.equal(fixture.nodes.setupProgress.getAttribute("aria-valuenow"), "55");
  assert.equal(fixture.nodes.setupPercent.textContent, "55%");
  assert.ok(Math.abs(Number.parseFloat(fixture.nodes.setupProgressBar.style.width) - 55) < 0.01);
  assert.equal(fixture.nodes.setupBytes.textContent, "55 MB / 100 MB");
  fixture.window.CaatuuNative.receive({ id: download.id, kind: "status", phase: "asset_ready", artifactKey: "model", artifactKind: "embedding-runtime" });
  assert.equal(fixture.nodes.setupProgress.getAttribute("aria-valuenow"), "99");
  assert.equal(fixture.settled(), false);
  fixture.reply(download, "Hash verification failed", "error");
  await flush();
  assert.equal(fixture.nodes.setupAction.hidden, false);
  assert.equal(fixture.nodes.setupAction.disabled, false);
  assert.equal(fixture.nodes.nativeSetup.classList.contains("is-error"), true);
  const retry = fixture.nodes.setupAction.onclick();
  fixture.reply(fixture.requests.at(-1), { ready: true });
  await retry;
  assert.equal(await fixture.completion, true);
  assert.deepEqual(fixture.requests.map(({ type }) => type), ["setup_status", "setup_download", "setup_download"]);
});

test("Android Back cancels an active download and late completion cannot unlock a cancelled attempt", async () => {
  const fixture = home();
  await flush();
  fixture.select("en", "cz");
  fixture.submit();
  const downloading = fixture.requests.at(-1);
  assert.equal(fixture.window.CaatuuHandleAndroidBack(), true);
  const abort = fixture.requests.at(-1);
  assert.equal(abort.type, "setup_abort");
  fixture.reply(abort, { ready: false });
  fixture.reply(downloading, { ready: true });
  await flush();
  assert.equal(fixture.settled(), false);
  assert.equal(fixture.nodes.setupAction.disabled, false);
  assert.equal(fixture.nodes.nativeSetup.classList.contains("is-error"), false, "intentional cancellation remains neutral");
  assert.equal(fixture.nodes.setupPhase.textContent, fixture.content.t("setup.prepare"));
  assert.equal(fixture.window.CaatuuHandleAndroidBack(), false);
  fixture.nodes.setupAbort.onclick();
  assert.equal(fixture.nodes.setupLanguageSelection.hidden, false);
  await fixture.close();
  assert.equal(fixture.window.CaatuuHandleAndroidBack, undefined);
  assert.equal(fixture.window.CaatuuNative, fixture.priorReceiver);
});

test("reopening an active selected-course download polls without launching a duplicate", async () => {
  const fixture = home({ status: { ready: false, setupActive: true, expectedBytes: 100_000_000, bytes: 30_000_000 } });
  await flush();
  assert.equal(fixture.polling.size, 1);
  assert.equal(fixture.nodes.setupAction.disabled, true);
  assert.equal(fixture.nodes.setupPercent.textContent, "30%");
  assert.equal(fixture.nodes.setupBytes.textContent, "30 MB / 100 MB");
  fixture.setStatus({ ready: true });
  [...fixture.polling.values()][0]();
  assert.equal(await fixture.completion, true);
  assert.deepEqual(fixture.requests.map(({ type }) => type), ["setup_status", "setup_status"]);
  assert.equal(fixture.polling.size, 0);
});

test("verified installation retries failed same-origin artwork without changing paths or reloading successful images", async () => {
  const fixture = home({ status: { ready: true } });
  const retried = [];
  const addImage = (name, src, complete, naturalWidth) => {
    const image = fixture.document.createElement("img");
    image.src = src;
    image.complete = complete;
    image.naturalWidth = naturalWidth;
    fixture.nodes.homeBaseView.append(image);
    const setAttribute = image.setAttribute.bind(image);
    image.setAttribute = (attribute, value) => {
      if (attribute === "src") retried.push({ name, value });
      setAttribute(attribute, value);
    };
    return image;
  };
  addImage("failed", "/assets/robots/robot%20(1).png", true, 0);
  addImage("loaded", "/assets/icons/hello.png", true, 200);
  addImage("external", "https://outside.test/art.png", true, 0);
  addImage("inline", "data:image/png;base64,eA==", true, 0);
  const pending = addImage("pending", "/assets/planets/memory-moon.png", false, 0);
  const changed = addImage("changed", "/assets/icons/old.png", false, 0);
  await fixture.completion;
  assert.deepEqual(retried, [{ name: "failed", value: "/assets/robots/robot%20(1).png" }]);
  pending.complete = true;
  pending.dispatchEvent({ type: "error" });
  pending.dispatchEvent({ type: "error" });
  changed.complete = true;
  changed.src = "https://outside.test/replacement.png";
  changed.dispatchEvent({ type: "error" });
  assert.deepEqual(retried.slice(0, 2), [
    { name: "failed", value: "/assets/robots/robot%20(1).png" },
    { name: "pending", value: "/assets/planets/memory-moon.png" },
  ]);
  assert.equal(retried.length, 3, "only the explicit test source replacement occurs after the two retries");
});

test("course options use the native bundle boundary and stale cross-course intent cannot start a download", async () => {
  const fixture = home({ bundled: ["cz", "es-en"], pendingCourse: "zh" });
  await flush();
  fixture.select("en", "cz");
  assert.deepEqual(fixture.nodes.setupTargetLanguageOptions.querySelectorAll("input").map(({ value }) => value), ["cz"]);
  assert.deepEqual(fixture.requests.map(({ type }) => type), ["setup_status"]);
  assert.equal(fixture.sessionStorage.getItem("caatuu.setup.pending-course.v1"), null);
  await fixture.close();
});

test("a confirmed partial course resumes on restart without resetting its language choice", async () => {
  const first = home({ id: "es-en" });
  await flush();
  first.select("es", "es-en");
  first.submit();
  const rememberedCourse = first.localStorage.getItem("caatuu.setup.selected-course.v1");
  assert.equal(rememberedCourse, "es-en");
  await first.close();
  const resumed = home({ id: "es-en", rememberedCourse, status: { ready: false, bytes: 40, expectedBytes: 100 } });
  await flush();
  assert.deepEqual(resumed.requests.map(({ type }) => type), ["setup_status", "setup_download"]);
  assert.equal(resumed.nodes.setupLanguageSelection.hidden, true);
  resumed.reply(resumed.requests.at(-1), { ready: true });
  await resumed.completion;
  assert.equal(resumed.localStorage.getItem("caatuu.setup.selected-course.v1"), "es-en");
});

test("revisiting an installed course remembers it for a later update that needs more files", async () => {
  const installed = home({ id: "zh", rememberedCourse: "cz", status: { ready: true } });
  await installed.completion;
  assert.equal(installed.nodes.setupLanguageSelection.hidden, true);
  const rememberedCourse = installed.localStorage.getItem("caatuu.setup.selected-course.v1");
  assert.equal(rememberedCourse, "zh");
  const updated = home({ id: "zh", rememberedCourse, status: { ready: false, bytes: 20, expectedBytes: 100 } });
  await flush();
  assert.deepEqual(updated.requests.map(({ type }) => type), ["setup_status", "setup_download"]);
  assert.equal(updated.nodes.setupLanguageSelection.hidden, true);
  updated.reply(updated.requests.at(-1), { ready: true });
  await updated.completion;
});

test("browser and full development shells retain their existing setup controller", async () => {
  assert.equal(await initializeHomeCourseSetup({}), false);
  assert.equal(await initializeHomeCourseSetup({ CaatuuAndroid: { postMessage() { throw new Error("unexpected native call"); } } }), false);
});
