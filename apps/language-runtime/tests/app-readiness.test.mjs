import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

import { transformSetupJs } from "../../android/tooling/build-product-assets.mjs";
import { initializeWorkspaceAfterDictionaryProvider } from "../static/source/dictionary-provider-loader.mjs";
import { createBrowserHarness } from "./helpers/fake-browser.mjs";
import { englishInterfaceContent, installEnglishInterfaceContent } from "./helpers/english-interface-content.mjs";

// Exercise the bootstrap itself while replacing only module/resource delivery.
// The real dictionary boundary, UI transitions, readiness event, and startup
// orchestration remain intact; no production test hooks are required.
const bootstrapSource = (await readFile(
  new URL("../static/source/app-bootstrap.mjs", import.meta.url), "utf8"
))
  .replace(/^import\s+[\s\S]*?from\s+"[^"]+";\r?\n/gmu, "")
  .replace(/await import\("\.\/word-world-host\.mjs\?v=[^"]+"\)/u, "await loadWordWorldHost()");

const setupSource = transformSetupJs(await readFile(new URL(
  "../../languages/czech/static/source/features/setup/setup.js", import.meta.url
), "utf8"));
const setupProgressSource = await readFile(new URL(
  "../../languages/czech/static/source/features/setup/setup-progress.js", import.meta.url
), "utf8");

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

function startHarness({ dictionary = false, failScript = "", serviceWorker = null, interfaceGate = null, nativeSetup = null } = {}) {
  const course = {
    id: "en-zh-Hans",
    routePrefix: "/zh",
    status: "active",
    sourceLanguage: { id: "en", locale: "en", label: "English" },
    targetLanguage: { id: "zh-Hans", locale: "zh-Hans", label: "Simplified Chinese" },
    capabilities: { dictionary, offlineModels: false },
    ...(nativeSetup ? {
      browserProviders: { setupProvider: "source/features/setup/setup.js?v=setup-test-1" }
    } : {}),
    ...(dictionary ? {
      dictionaryContent: {
        providerId: "readiness-dictionary-v1",
        providerModule: "source/readiness-dictionary.js?v=readiness-1"
      }
    } : {})
  };
  const harness = createBrowserHarness({ course });
  const { context, document } = harness;
  if (nativeSetup) {
    harness.runtime.env = "android";
    harness.runtime.setup = { status: () => nativeSetup.promise };
    context.Image = class {
      set src(value) { queueMicrotask(() => this.onload?.()); }
    };
    vm.runInContext(setupProgressSource, context);
  }
  const workspace = deferred();
  const dictionaryMount = deferred();
  const scriptUrls = [];
  const errors = [];
  let navigationCalls = 0;
  let readyEvents = 0;
  let workerCalls = 0;

  function element(tagName, id, parent) {
    const node = document.createElement(tagName);
    if (id) node.id = id;
    parent?.append(node);
    return node;
  }

  const home = element("section", "view-home", document.body);
  const main = element("div", null, home);
  main.className = "home-main";
  element("img", null, main).className = "stage-art";
  const card = element("section", "nativeSetup", main);
  card.hidden = true;
  for (const id of [
    "setupTitle", "setupPhase", "setupMessage", "setupPercent", "setupCount", "setupBytes",
    "setupProgress", "setupProgressBar", "setupArtifacts", "setupLog", "setupDetails"
  ]) element("div", id, card);
  for (const id of ["setupAction", "setupAbort", "setupReportBug", "setupDetailsToggle"]) {
    element("button", id, card);
  }
  element("div", null, card).className = "setup-progress-meta";
  const nav = element("nav", null, document.body);
  nav.setAttribute("data-caatuu-bottom-nav", "");
  const gamesButton = element("button", "readinessGamesButton", nav);
  gamesButton.dataset.view = "train";
  gamesButton.dataset.caatuuNav = "train";
  gamesButton.dataset.navKey = "games";

  // Simulate a user interaction, including the browser's inert/disabled rules.
  function clickNavigation() {
    if (gamesButton.disabled || gamesButton.closest("[inert]")) return;
    gamesButton.dispatchEvent({ type: "click", bubbles: true });
  }

  document.styleSheets = [];
  document.addEventListener("caatuu:app-ready", () => {
    readyEvents += 1;
    if (!nativeSetup) assert.equal(card.classList.contains("is-ready"), true, "ready events must observe the ready UI");
    assert.equal(nav.hasAttribute("inert"), false, "ready events must observe usable navigation");
  });
  if (serviceWorker) {
    context.navigator.serviceWorker = {
      register() {
        workerCalls += 1;
        return serviceWorker.promise;
      }
    };
  }
  Object.assign(context, {
    CaatuuCourse: course,
    CaatuuShellPolicy: {},
    initializeWorkspaceAfterDictionaryProvider,
    loadInterfaceContent: async () => {
      if (interfaceGate) await interfaceGate.promise;
      return englishInterfaceContent;
    },
    installInterfaceContent: () => installEnglishInterfaceContent(harness),
    loadWordWorldHost: async () => {},
    console: { error: (error) => errors.push(error) }
  });

  const append = document.body.append.bind(document.body);
  document.body.append = (...nodes) => {
    append(...nodes);
    for (const node of nodes.filter((candidate) => candidate.tagName === "SCRIPT")) {
      scriptUrls.push(node.src);
      queueMicrotask(() => {
        if (failScript && node.src.includes(failScript)) {
          node.dispatchEvent({ type: "error" });
          return;
        }
        if (node.src.includes("readiness-dictionary.js")) {
          context.CaatuuDictionaryProvider = {
            schemaVersion: 1,
            id: course.dictionaryContent.providerId,
            mountDictionaryProvider: () => dictionaryMount.promise
          };
        }
        if (node.src.includes("features/setup/setup.js")) {
          harness.window.CaatuuShellReady = context.CaatuuShellReady;
          vm.runInContext(setupSource, context);
        }
        if (node.src.includes("caatuu-workspace.js")) {
          context.CaatuuWorkspaceReady = workspace.promise.then((result) => {
            if (result?.ready === true) {
              gamesButton.addEventListener("click", () => { navigationCalls += 1; });
            }
            return result;
          });
        }
        node.dispatchEvent({ type: "load" });
      });
    }
  };
  vm.runInContext(bootstrapSource, context, { filename: "app-bootstrap.mjs" });
  return {
    ...harness, card, nav, workspace, dictionaryMount, errors, scriptUrls, clickNavigation,
    get navigationCalls() { return navigationCalls; },
    get readyEvents() { return readyEvents; },
    get workerCalls() { return workerCalls; }
  };
}

function assertLoading(harness) {
  assert.equal(harness.document.documentElement.dataset.caatuuAppReady, "loading");
  assert.equal(harness.document.documentElement.dataset.caatuuShellReady, "loading");
  assert.equal(harness.document.body.classList.contains("app-starting"), true);
  assert.equal(harness.document.body.classList.contains("setup-blocked"), true);
  assert.equal(harness.nav.hasAttribute("inert"), true);
  assert.equal(harness.nav.getAttribute("aria-busy"), "true");
  assert.equal(harness.card.classList.contains("is-ready"), false);
  assert.equal(harness.readyEvents, 0);
  assert.equal(harness.document.dispatchEvent({
    type: "click", target: harness.document.getElementById("readinessGamesButton")
  }), false, "the early navigation guard also blocks clicks before other dock handlers");
  harness.clickNavigation();
  assert.equal(harness.navigationCalls, 0);
}

function assertReady(harness) {
  assert.equal(harness.document.documentElement.dataset.caatuuAppReady, "true");
  assert.equal(harness.document.documentElement.dataset.caatuuShellReady, "true");
  assert.equal(harness.document.body.classList.contains("app-starting"), false);
  assert.equal(harness.document.body.classList.contains("setup-blocked"), false);
  assert.equal(harness.card.classList.contains("is-ready"), true);
  assert.equal(harness.document.getElementById("setupTitle").textContent, englishInterfaceContent.t("setup.readytitle"));
  assert.equal(harness.nav.hasAttribute("inert"), false);
  assert.notEqual(harness.nav.getAttribute("aria-busy"), "true");
  assert.equal(harness.readyEvents, 1);
  harness.clickNavigation();
  assert.equal(harness.navigationCalls, 1);
  assert.deepEqual(harness.errors, []);
}

function assertFailed(harness) {
  assert.equal(harness.document.documentElement.dataset.caatuuAppReady, "error");
  assert.equal(harness.document.documentElement.dataset.caatuuShellReady, "error");
  assert.equal(harness.document.body.classList.contains("app-starting"), true);
  assert.equal(harness.document.body.classList.contains("setup-blocked"), true);
  assert.equal(harness.card.hidden, false);
  assert.equal(harness.card.classList.contains("is-ready"), false);
  assert.equal(harness.card.classList.contains("is-error"), true);
  assert.equal(harness.document.getElementById("setupTitle").textContent, englishInterfaceContent.t("app.loaderror"));
  assert.equal(harness.nav.hasAttribute("inert"), true);
  assert.equal(harness.readyEvents, 0);
  harness.clickNavigation();
  assert.equal(harness.navigationCalls, 0);
  assert.equal(harness.errors.length, 1);
}

test("bootstrap locks navigation immediately and renders ready only after workspace initialization", { timeout: 2_000 }, async () => {
  const interfaceGate = deferred();
  const harness = startHarness({ interfaceGate });
  assert.equal(typeof harness.context.CaatuuShellReady?.then, "function");
  assertLoading(harness);

  interfaceGate.resolve();
  await flush();
  assert.ok(harness.scriptUrls.some((url) => url.includes("caatuu-workspace.js")));
  assertLoading(harness);
  assert.equal(harness.card.hidden, false);
  assert.equal(harness.document.getElementById("setupTitle").textContent, englishInterfaceContent.t("setup.preparing"));

  harness.workspace.resolve({ ready: true });
  const result = await harness.context.CaatuuShellReady;
  assert.equal(result.ready, true);
  assertReady(harness);
});

test("Android's model-free profile leaves readiness and details with its setup provider", { timeout: 2_000 }, async () => {
  const nativeSetup = deferred();
  const harness = startHarness({ nativeSetup });
  await flush();
  harness.workspace.resolve({ ready: true });
  assert.equal((await harness.context.CaatuuShellReady).ready, true);

  const { document, card, nav } = harness;
  const games = document.getElementById("readinessGamesButton");
  const details = document.getElementById("setupDetails");
  const toggle = document.getElementById("setupDetailsToggle");
  assert.equal(card.classList.contains("is-ready"), false, "shell initialization cannot announce native setup readiness");
  assert.equal(document.body.classList.contains("setup-blocked"), true);
  assert.equal(games.getAttribute("aria-disabled"), "true");
  assert.equal(document.getElementById("setupProgress").hidden, false);
  assert.equal(card.querySelector(".setup-progress-meta").hasAttribute("hidden"), false);
  assert.equal(toggle.dataset.readyHomeBound, undefined, "only the setup provider owns the details toggle");

  nativeSetup.resolve({ ready: true, staticAssets: { assets: [{ key: "course", ready: true, bytes: 1 }] } });
  await flush();
  assert.equal(card.classList.contains("is-ready"), true);
  assert.equal(document.body.classList.contains("setup-blocked"), false);
  assert.equal(games.hasAttribute("aria-disabled"), false);
  assert.equal(nav.dataset.setupLocked, "false");
  assert.equal(document.getElementById("setupTitle").textContent, englishInterfaceContent.t("setup.readytitle"));
  assert.equal(details.hidden, true);
  document.dispatchEvent({ type: "click", target: toggle });
  assert.equal(details.hidden, false);
  document.dispatchEvent({ type: "click", target: toggle });
  assert.equal(details.hidden, true);
  harness.clickNavigation();
  assert.equal(harness.navigationCalls, 1);
  assert.deepEqual(harness.errors, []);
});

test("a loaded workspace script cannot report ready when initialization fails", { timeout: 2_000 }, async () => {
  const harness = startHarness();
  await flush();
  assertLoading(harness);
  const error = new Error("Workspace initialization failed");
  harness.workspace.resolve({ ready: false, error });
  const result = await harness.context.CaatuuShellReady;
  assert.equal(result.ready, false);
  assert.equal(result.error, error);
  assertFailed(harness);
});

test("a failed dictionary mount never unlocks navigation or starts the workspace", { timeout: 2_000 }, async () => {
  const harness = startHarness({ dictionary: true });
  await flush();
  assertLoading(harness);
  assert.equal(harness.scriptUrls.some((url) => url.includes("caatuu-workspace.js")), false);
  const error = new Error("Dictionary mount failed");
  harness.dictionaryMount.reject(error);
  const result = await harness.context.CaatuuShellReady;
  assert.equal(result.ready, false);
  assert.equal(result.error, error);
  assertFailed(harness);
  assert.equal(harness.scriptUrls.some((url) => url.includes("caatuu-workspace.js")), false);
});

test("a required script loading failure shows an error instead of a ready card", { timeout: 2_000 }, async () => {
  const harness = startHarness({ failScript: "maintenance-ui.js" });
  const result = await harness.context.CaatuuShellReady;
  assert.equal(result.ready, false);
  assert.match(result.error.message, /Could not load/);
  assertFailed(harness);
});

for (const workerOutcome of ["pending", "rejected"]) {
  test(`an optional ${workerOutcome} service worker does not delay interactive readiness`, { timeout: 2_000 }, async () => {
    const serviceWorker = deferred();
    const harness = startHarness({ serviceWorker });
    await flush();
    harness.workspace.resolve({ ready: true });
    // Flush scheduled work rather than awaiting readiness: a regressed worker
    // dependency must fail promptly instead of hanging this test indefinitely.
    await flush();
    assert.equal(harness.workerCalls, 1);
    if (workerOutcome === "rejected") {
      serviceWorker.reject(new Error("Service workers are unavailable"));
      await flush();
    }
    assertReady(harness);
    assert.equal((await harness.context.CaatuuShellReady).ready, true);
  });
}
