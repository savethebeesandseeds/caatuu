import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

import { DEVELOPER_TOOLS, DEVELOPER_TOOLS_MESSAGES, developerCourses, mountDeveloperTools } from "../static/source/developer-tools/developer-tools.mjs";
import { AUDIO_LAB_MESSAGES } from "../static/source/developer-tools/audio-lab.mjs";
import { catalogInspectorMessages } from "../static/source/developer-tools/catalog-inspectors.mjs";
import { messages as modelToolMessages } from "../static/source/developer-tools/model-tools.mjs";
import { createBrowserHarness } from "./helpers/fake-browser.mjs";

const interfaceCatalog = JSON.parse(await readFile(new URL("../static/data/interface/en.v1.json", import.meta.url), "utf8"));
const messages = { ...interfaceCatalog.messages, ...DEVELOPER_TOOLS_MESSAGES, ...AUDIO_LAB_MESSAGES, ...catalogInspectorMessages, ...modelToolMessages };
const hubSource = await readFile(new URL("../static/source/developer-tools/developer-tools.mjs", import.meta.url), "utf8");
const flush = () => new Promise((resolve) => setImmediate(resolve));

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; });
  return { promise, resolve, reject };
}

function freeze(value) {
  if (!value || typeof value !== "object") return value;
  for (const nested of Object.values(value)) freeze(nested);
  return Object.freeze(value);
}

function courseFixture() {
  const zh = { id: "zh", routePrefix: "/zh", sourceLanguage: { id: "en", label: "English" },
    targetLanguage: { id: "zh", locale: "zh-Hans", speechLocale: "zh-CN", label: "Mandarin" },
    developerContext: { gameContent: { "verb-lab": { verbNebulaCatalog: "data/mandarin-verbs.json" } }, dictionaryContent: null } };
  const cz = { id: "cz", routePrefix: "/cz", sourceLanguage: { id: "en", label: "English" },
    targetLanguage: { id: "cs", locale: "cs-CZ", speechLocale: "cs-CZ", label: "Czech" },
    developerContext: { gameContent: { "verb-lab": { verbNebulaCatalog: "data/czech-verbs.json" } },
      dictionaryContent: { coreEntries: "data/dictionary.json" } } };
  return freeze({
    ...zh, storage: { namespace: "active-learning", learningPerformance: "active-progress" },
    capabilities: { speech: true, chat: false, dictionary: false, verbs: false, offlineModels: false },
    courseSelector: { courses: [zh, cz] }
  });
}

function translate(key, parameters = {}) {
  assert.equal(typeof messages[key], "string", `Unknown developer-tool interface key: ${key}`);
  return messages[key].replace(/\{([a-zA-Z]+)\}/gu, (_match, name) => {
    assert.ok(Object.hasOwn(parameters, name), `Missing ${name} for ${key}`);
    return String(parameters[name]);
  });
}

function browser() {
  const harness = createBrowserHarness();
  const host = harness.window;
  host.AbortController = AbortController;
  const course = courseFixture();
  host.CaatuuCourse = course;
  host.CaatuuI18n = { t: translate, languageName: (language) => language.label || language.id };
  const noStorageWrites = {
    getItem: () => null,
    setItem() { assert.fail("Developer tools must not change learning preferences or progress"); },
    removeItem() { assert.fail("Developer tools must not remove learning preferences or progress"); }
  };
  host.localStorage = noStorageWrites;
  host.sessionStorage = noStorageWrites;
  host.CaatuuChrome = { getSpeechMuted: () => false, stopSpeech: async () => {}, resolveSpeechPace: () => ({ rate: 0.9 }) };
  const root = harness.document.createElement("div");
  const screenRoot = harness.document.createElement("section");
  screenRoot.hidden = true;
  harness.document.body.append(root, screenRoot);
  const navigation = [];
  return { ...harness, host, root, screenRoot, course, navigation,
    onNavigate(tool) { navigation.push(tool); },
    select(name) { return screenRoot.querySelector(`[data-developer-select="${name}"]`); },
    open(id) {
      const opener = root.querySelector(`[data-developer-tool="${id}"]`);
      assert.ok(opener, `Missing developer tool list entry: ${id}`);
      opener.focus();
      opener.dispatchEvent({ type: "click", bubbles: true });
      return opener;
    },
    back() {
      const back = screenRoot.querySelector("[data-developer-back]");
      assert.ok(back, "A developer screen must provide a route back to the tool list");
      back.dispatchEvent({ type: "click", bubbles: true });
    },
    change(name, value) {
      const select = this.select(name);
      assert.ok(select, `Missing developer screen selector: ${name}`);
      select.value = value;
      select.dispatchEvent({ type: "change" });
    }
  };
}

// Isolate asynchronous mount boundaries without adding injection hooks to the
// production registry or mutating its shared module exports.
function isolatedHub(harness, mounts = {}) {
  const calls = [];
  const disposals = [];
  const definitions = {
    mountAudioLab: "audio-lab", mountEmbeddingImages: "embedding-images", mountVerbDifficulty: "verb-difficulty",
    mountDictionaryInspector: "dictionary", mountDebugChat: "debug-chat"
  };
  for (const [name, id] of Object.entries(definitions)) {
    harness.context[name] = async (options) => {
      calls.push({ id, ...options });
      if (mounts[id]) return mounts[id](options);
      const panel = harness.document.createElement("p");
      panel.dataset.testTool = id;
      panel.textContent = `${id}:${options.course.id}`;
      options.root.replaceChildren(panel);
      return () => disposals.push(id);
    };
  }
  vm.runInContext(`${hubSource.replace(/^import .*;\r?\n/gmu, "").replace(/^export /gmu, "")}\n` +
    "globalThis.testHubMount = mountDeveloperTools;", harness.context);
  return { calls, disposals, mount: () => harness.context.testHubMount({
    root: harness.root, screenRoot: harness.screenRoot, host: harness.host,
    course: harness.course, onNavigate: harness.onNavigate
  }) };
}

test("Settings opens a list of all five tools without mounting a tool or showing a tool selector", async () => {
  assert.deepEqual(DEVELOPER_TOOLS.map(({ id }) => id), ["audio-lab", "embedding-images", "verb-difficulty", "dictionary", "debug-chat"]);
  assert.deepEqual(DEVELOPER_TOOLS.filter(({ language }) => !language).map(({ id }) => id), ["embedding-images"]);
  const harness = browser();
  const hub = isolatedHub(harness);
  const cleanup = await hub.mount();
  await flush();
  const entries = harness.root.querySelectorAll("[data-developer-tool]");
  assert.deepEqual(entries.map(({ dataset }) => dataset.developerTool), DEVELOPER_TOOLS.map(({ id }) => id));
  assert.ok(entries.every((entry) => entry.tagName === "BUTTON"));
  assert.deepEqual(hub.calls, []);
  assert.deepEqual(harness.navigation, []);
  assert.equal(harness.root.hidden, false);
  assert.equal(harness.screenRoot.hidden, true);
  assert.equal(harness.root.querySelector("select"), null);
  assert.equal(harness.select("tool"), null);
  assert.equal(harness.host.CaatuuCourse, harness.course);
  cleanup();
});

test("each list entry opens its named dedicated screen and back disposes it and restores focus", async () => {
  const harness = browser();
  const hub = isolatedHub(harness);
  const cleanup = await hub.mount();
  for (const tool of DEVELOPER_TOOLS) {
    const opener = harness.open(tool.id);
    await flush();
    assert.equal(harness.root.hidden, true);
    assert.equal(harness.screenRoot.hidden, false);
    assert.equal(hub.calls.at(-1).id, tool.id);
    assert.equal(harness.screenRoot.querySelector("h2").textContent, translate(tool.label));
    assert.ok(harness.screenRoot.querySelector(`[data-test-tool="${tool.id}"]`));
    assert.equal(harness.select("tool"), null);
    assert.equal(harness.navigation.at(-1)?.id, tool.id);
    const language = harness.select("language");
    if (tool.language) {
      assert.ok(language);
      assert.equal(language.value, "zh");
      assert.equal(language.closest("[hidden]"), null);
    } else {
      assert.ok(!language || language.closest("[hidden]"));
    }
    const signal = hub.calls.at(-1).signal;
    harness.back();
    assert.equal(signal.aborted, true);
    assert.equal(harness.root.hidden, false);
    assert.equal(harness.screenRoot.hidden, true);
    assert.equal(harness.document.activeElement, opener);
    assert.equal(harness.navigation.at(-1), null);
    assert.equal(hub.disposals.at(-1), tool.id);
  }
  assert.deepEqual(hub.disposals, DEVELOPER_TOOLS.map(({ id }) => id));
  cleanup();
});

test("developer courses flatten declared inspection data while preserving the complete active learning profile", () => {
  const course = courseFixture();
  const before = JSON.stringify(course);
  const records = developerCourses(course);
  assert.deepEqual(records.map(({ id }) => id), ["zh", "cz"]);
  assert.equal(records[0].capabilities, course.capabilities);
  assert.equal(records[0].storage, course.storage);
  assert.equal(records[0].gameContent["verb-lab"].verbNebulaCatalog, "data/mandarin-verbs.json");
  assert.equal(records[1].dictionaryContent.coreEntries, "data/dictionary.json");
  assert.equal(records[1].gameContent["verb-lab"].verbNebulaCatalog, "data/czech-verbs.json");
  assert.equal(JSON.stringify(course), before);
  const catalog = { ...course, courseSelector: { courses: [
    ...course.courseSelector.courses,
    course.courseSelector.courses[0],
    { id: "bad", routePrefix: "//outside.example" },
    { id: "bad", routePrefix: "../course" },
    { routePrefix: "/no-id" }
  ] } };
  assert.deepEqual(developerCourses(catalog).map(({ id }) => id), ["zh", "cz"]);
});

test("the real Audio Lab follows hub language selection without switching the active learning course", async () => {
  const harness = browser();
  const locales = [];
  harness.host.CaatuuRuntime = { env: "android", speech: {
    forLocale(locale) {
      locales.push(locale);
      return { status: async () => ({ available: true, locale, voices: [] }), speak: async () => {}, stop: async () => {} };
    }
  } };
  const before = JSON.stringify(harness.course);
  const cleanup = await mountDeveloperTools(harness);
  assert.deepEqual(locales, []);
  harness.open("audio-lab");
  await flush();
  assert.equal(harness.screenRoot.querySelector("[data-audio-lab-text]").lang, "zh-Hans");
  harness.change("language", "cz");
  await flush();
  assert.deepEqual(locales, ["zh-CN", "cs-CZ"]);
  assert.equal(harness.screenRoot.querySelector("[data-audio-lab-text]").lang, "cs-CZ");
  assert.equal(harness.host.CaatuuCourse, harness.course);
  assert.equal(JSON.stringify(harness.course), before);
  cleanup();
});

test("language switching stays inside the selected screen and preserves the active learning course", async () => {
  const harness = browser();
  const hub = isolatedHub(harness);
  const cleanup = await hub.mount();
  const before = JSON.stringify(harness.course);
  harness.open("dictionary");
  await flush();
  const firstSignal = hub.calls.at(-1).signal;
  harness.change("language", "cz");
  assert.equal(firstSignal.aborted, true);
  await flush();
  assert.equal(hub.calls.at(-1).id, "dictionary");
  assert.equal(hub.calls.at(-1).course.id, "cz");
  assert.equal(hub.calls.at(-1).course.dictionaryContent.coreEntries, "data/dictionary.json");
  assert.deepEqual(hub.disposals, ["dictionary"]);
  assert.equal(harness.screenRoot.querySelector("h2").textContent, translate("developer.tools.dictionary"));
  assert.equal(harness.screenRoot.hidden, false);
  assert.equal(harness.root.hidden, true);
  assert.equal(harness.host.CaatuuCourse.id, "zh");
  assert.equal(JSON.stringify(harness.course), before);
  const disposedOpener = harness.root.querySelector('[data-developer-tool="debug-chat"]');
  cleanup();
  assert.deepEqual(hub.disposals, ["dictionary", "dictionary"]);
  const count = hub.calls.length;
  disposedOpener.dispatchEvent({ type: "click", bubbles: true });
  await flush();
  assert.equal(hub.calls.length, count, "Disposed list entries no longer open tools");
});

test("a late mount is disposed without replacing the newer inspector", async () => {
  const harness = browser();
  const pending = deferred();
  let lateDisposals = 0;
  const hub = isolatedHub(harness, { "audio-lab": async ({ root }) => {
    await pending.promise;
    root.textContent = "Late audio content";
    return () => { lateDisposals += 1; };
  } });
  const cleanup = await hub.mount();
  harness.open("audio-lab");
  const audioSignal = hub.calls.at(-1).signal;
  harness.back();
  assert.equal(audioSignal.aborted, true);
  harness.open("dictionary");
  await flush();
  const current = harness.screenRoot.querySelector("[data-test-tool=\"dictionary\"]");
  assert.ok(current);
  pending.resolve();
  await flush();
  assert.equal(lateDisposals, 1);
  assert.equal(harness.screenRoot.querySelector("[data-test-tool=\"dictionary\"]"), current);
  assert.equal(harness.screenRoot.querySelector("h2").textContent, translate("developer.tools.dictionary"));
  cleanup();
  assert.deepEqual(hub.disposals, ["dictionary"]);
});

test("a stale opening error does not overwrite the newly selected tool", async () => {
  const harness = browser();
  const pending = deferred();
  const hub = isolatedHub(harness, { "audio-lab": () => pending.promise });
  const cleanup = await hub.mount();
  harness.open("audio-lab");
  harness.back();
  harness.open("dictionary");
  await flush();
  pending.reject(new Error("Old audio mount failed"));
  await flush();
  assert.ok(harness.screenRoot.querySelector("[data-test-tool=\"dictionary\"]"));
  assert.equal(harness.screenRoot.querySelector("[role=\"alert\"]"), null);
  cleanup();
});

test("an opening failure is accessible and another tool remains selectable", async () => {
  const harness = browser();
  const hub = isolatedHub(harness, { "audio-lab": async () => { throw new Error("Device check failed"); } });
  const cleanup = await hub.mount();
  harness.open("audio-lab");
  await flush();
  assert.match(harness.screenRoot.querySelector("[role=\"alert\"]").textContent, /This tool could not open\. Device check failed/u);
  assert.equal(harness.screenRoot.querySelector(".developer-tool-content").hasAttribute("aria-busy"), false);
  harness.back();
  harness.open("debug-chat");
  await flush();
  assert.ok(harness.screenRoot.querySelector("[data-test-tool=\"debug-chat\"]"));
  cleanup();
});

test("shared developer entrypoints and their direct module dependencies are declared in the app asset catalog", async () => {
  const catalog = JSON.parse(await readFile(new URL("../app-assets.json", import.meta.url), "utf8"));
  const mapped = new Map(catalog.assets.map((asset) => [asset.source, asset.output]));
  const repo = new URL("../../../", import.meta.url);
  for (const name of ["developer-tools", "audio-lab", "catalog-inspectors", "model-tools"]) {
    const source = `apps/language-runtime/static/source/developer-tools/${name}.mjs`;
    assert.equal(mapped.get(source), `language-runtime/static/source/developer-tools/${name}.mjs`);
    const content = await readFile(new URL(source, repo), "utf8");
    for (const match of content.matchAll(/^import .* from "(\.[^"]+)";/gmu)) {
      const target = new URL(match[1], new URL(source, repo));
      const relative = decodeURIComponent(target.pathname.slice(repo.pathname.length));
      assert.ok(mapped.has(relative), `${name} imports an unmapped shared app dependency: ${match[1]}`);
    }
  }
  assert.equal(mapped.get("apps/language-runtime/static/styles/caatuu-developer-tools.css"), "language-runtime/static/styles/caatuu-developer-tools.css");
});

test("back and closing the hub abort pending screen mounts immediately", async () => {
  const harness = browser();
  const pending = deferred();
  let signal;
  const hub = isolatedHub(harness, { "audio-lab": (options) => { signal = options.signal; return pending.promise; } });
  const cleanup = await hub.mount();
  const opener = harness.open("audio-lab");
  assert.equal(signal.aborted, false);
  harness.back();
  assert.equal(signal.aborted, true, "back cancels initial data loading without awaiting the old mount");
  assert.equal(harness.document.activeElement, opener);
  assert.equal(harness.screenRoot.hidden, true);
  harness.open("dictionary");
  await flush();
  const dictionarySignal = hub.calls.at(-1).signal;
  cleanup();
  assert.equal(dictionarySignal.aborted, true);
  assert.deepEqual(hub.disposals, ["dictionary"]);
  pending.resolve(() => {});
  await flush();
});

test("closing the hub during its first pending mount prevents late screen content from reopening it", async () => {
  const harness = browser();
  const pending = deferred();
  let lateDisposals = 0;
  const hub = isolatedHub(harness, { "audio-lab": async ({ root }) => {
    await pending.promise;
    root.textContent = "Late closed audio content";
    return () => { lateDisposals += 1; };
  } });
  const cleanup = await hub.mount();
  harness.open("audio-lab");
  const signal = hub.calls[0].signal;
  const disposedOpener = harness.root.querySelector('[data-developer-tool="dictionary"]');
  cleanup();
  assert.equal(signal.aborted, true);
  assert.equal(harness.screenRoot.hidden, true);
  assert.equal(harness.navigation.at(-1), null);
  const navigations = harness.navigation.length;
  pending.resolve();
  await flush();
  assert.equal(lateDisposals, 1);
  assert.equal(harness.navigation.length, navigations);
  assert.equal(harness.screenRoot.hidden, true);
  const count = hub.calls.length;
  disposedOpener.dispatchEvent({ type: "click", bubbles: true });
  await flush();
  assert.equal(hub.calls.length, count);
});
