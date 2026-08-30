import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import { compileProductAssets } from "../build-product-assets.mjs";

const workspaceRoot = new URL("../../../..", import.meta.url).pathname;
const languageStaticDir = join(workspaceRoot, "apps/languages/czech/static");
const launcherStaticDir = join(workspaceRoot, "apps/launcher/static");

class MockClassList {
  add() {}
  remove() {}
  toggle() { return false; }
  contains() { return false; }
}

function mockElement(tagName = "div", registry = null) {
  const attributes = new Map();
  const listeners = new Map();
  let source = "";
  const element = {
    nodeType: 1,
    tagName: String(tagName).toUpperCase(),
    classList: new MockClassList(),
    dataset: {},
    style: { setProperty() {}, removeProperty() {} },
    hidden: false,
    disabled: false,
    checked: false,
    open: false,
    value: "",
    textContent: "",
    innerHTML: "",
    complete: false,
    naturalWidth: 0,
    children: [],
    parentElement: null,
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
    append(...children) {
      for (const child of children) {
        if (child && typeof child === "object") child.parentElement = this;
        this.children.push(child);
      }
    },
    prepend(...children) { this.children.unshift(...children); },
    replaceChildren(...children) { this.children = children; },
    replaceWith() {},
    remove() {},
    focus() {},
    click() {},
    reset() {},
    showModal() { this.open = true; },
    close() { this.open = false; },
    querySelector(selector) {
      const id = /^#([\w-]+)$/u.exec(String(selector || "").trim())?.[1];
      return id && registry?.has(id) ? registry.get(id) : mockElement("div", registry);
    },
    querySelectorAll(selector) {
      return String(selector || "").trim() === "*" && registry ? [...registry.values()] : [];
    },
    closest() { return null; },
    matches() { return false; },
    setAttribute(name, value) { attributes.set(name, String(value)); },
    getAttribute(name) { return attributes.get(name) ?? null; },
    hasAttribute(name) { return attributes.has(name); },
    removeAttribute(name) {
      attributes.delete(name);
      if (name === "src") source = "";
    },
    toggleAttribute(name, force) {
      const enabled = force ?? !attributes.has(name);
      if (enabled) attributes.set(name, "");
      else attributes.delete(name);
      return enabled;
    },
    dispatchEvent(event) {
      for (const listener of listeners.get(event?.type) || []) listener.call(this, event);
      return true;
    },
    getBoundingClientRect() { return { top: 0, left: 0, right: 100, bottom: 100, width: 100, height: 100 }; },
    animate() { return { finished: Promise.resolve() }; },
    cloneNode() { return mockElement(tagName); },
    get src() { return source; },
    set src(value) {
      source = new URL(String(value || ""), globalThis.location?.href || "https://caatuu.test/").href;
      queueMicrotask(() => {
        const event = new Event("error");
        for (const listener of listeners.get("error") || []) listener.call(this, event);
        this.onerror?.(event);
      });
    },
    get currentSrc() { return source; },
    get options() { return this.children; },
    get offsetWidth() { return 100; },
  };
  return element;
}

function installWordWorldEnvironment(outputDir, sharedAppHtml) {
  const elements = new Map();
  for (const match of sharedAppHtml.matchAll(/<([a-z][\w-]*)\b[^>]*\bid="([^"]+)"[^>]*>/giu)) {
    elements.set(match[2], mockElement(match[1], elements));
  }
  const byId = (id) => {
    if (!elements.has(id)) elements.set(id, mockElement("div", elements));
    return elements.get(id);
  };
  const documentElement = mockElement("html", elements);
  const body = mockElement("body", elements);
  const document = {
    documentElement,
    body,
    visibilityState: "visible",
    readyState: "complete",
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() { return true; },
    querySelector(selector) {
      const id = /^#([\w-]+)$/u.exec(String(selector || "").trim())?.[1];
      return id ? byId(id) : mockElement("div", elements);
    },
    querySelectorAll() { return []; },
    getElementById(id) { return byId(id); },
    createElement(tagName) { return mockElement(tagName, elements); },
    createElementNS(_namespace, tagName) { return mockElement(tagName, elements); },
  };
  const storage = new Map();
  const window = {
    document,
    parent: null,
    location: {
      origin: "https://caatuu.test",
      href: "https://caatuu.test/word-net.html",
      search: "",
    },
    localStorage: {
      getItem(key) { return storage.get(key) ?? null; },
      setItem(key, value) { storage.set(key, String(value)); },
      removeItem(key) { storage.delete(key); },
    },
    addEventListener() {},
    removeEventListener() {},
    requestAnimationFrame(callback) { return setTimeout(() => callback(performance.now()), 0); },
    cancelAnimationFrame(id) { clearTimeout(id); },
    setTimeout,
    clearTimeout,
    matchMedia() { return { matches: true, addEventListener() {}, removeEventListener() {} }; },
    getComputedStyle() { return { getPropertyValue() { return ""; } }; },
    navigator: { onLine: false },
    speechSynthesis: { cancel() {}, getVoices() { return []; } },
    SpeechSynthesisUtterance: class {},
    CaatuuRuntime: {
      env: "android",
      registerServiceWorker: async () => null,
      vector: { search: async () => ({ results: [] }) },
      dictionary: { search: async () => ({ results: [] }) },
      maintenance: { enqueueDictionaryGap: async () => false, enqueueReport: async () => false },
      speech: { status: async () => ({ available: false }), stop: async () => null },
    },
    CaatuuChrome: {
      getSpeechRatePreference: () => "slower",
      getSpeechVoicePreference: () => "",
      speakCzechText: async () => ({ ok: false }),
      stopCzechSpeech: async () => null,
    },
    CaatuuLearning: {
      difficulty: () => 1,
      record() {},
    },
  };
  window.parent = window;
  globalThis.window = window;
  globalThis.document = document;
  globalThis.location = window.location;
  globalThis.localStorage = window.localStorage;
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: window.navigator });
  globalThis.Image = class {
    set src(_value) { queueMicrotask(() => this.onerror?.(new Error("not loaded in contract"))); }
  };
  const fetchImpl = async (request) => {
    const url = new URL(request, window.location.href);
    if (url.origin !== window.location.origin) {
      return new Response("not found", { status: 404 });
    }
    const pathname = decodeURIComponent(url.pathname);
    const relativePath = pathname.startsWith("/cz/")
      ? pathname.slice("/cz/".length)
      : pathname.replace(/^\/+/, "");
    const path = join(outputDir, relativePath);
    try {
      return new Response(readFileSync(path), { status: 200 });
    } catch {
      return new Response("not found", { status: 404 });
    }
  };
  globalThis.fetch = fetchImpl;
  return { elements, fetchImpl };
}

test("the generated Standard-only Word World completes its startup contract", async (t) => {
  const parent = mkdtempSync(join(tmpdir(), "caatuu-product-word-world-"));
  const outputDir = join(parent, "product");
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const result = compileProductAssets({ workspaceRoot, languageStaticDir, launcherStaticDir, outputDir });
  const sharedAppHtml = readFileSync(join(outputDir, "index.html"), "utf8");
  assert.deepEqual(
    readFileSync(join(outputDir, "index.html")),
    readFileSync(join(workspaceRoot, "apps/language-runtime/static/app/index.html")),
    "the generated product must use the byte-exact canonical shared app entry",
  );
  for (const id of ["wordWorldRoot", "wordNetSentence", "wordNetPrevious", "wordNetNext", "wordNetStatus"]) {
    assert.match(sharedAppHtml, new RegExp(`id=["']${id}["']`, "u"), `shared app entry is missing #${id}`);
  }
  assert.doesNotMatch(sharedAppHtml, /<iframe[^>]+(?:word-net|word-world)\.html/iu);
  for (const legacy of [
    "word-net.html",
    "source/games/word-world/word-net.js",
    "source/games/word-world/word-net.css",
    "language-runtime/static/source/product-shell.mjs",
  ]) {
    assert.ok(!result.files.includes(legacy), `generated product must exclude ${legacy}`);
  }
  const environment = installWordWorldEnvironment(outputDir, sharedAppHtml);

  const courseUrl = pathToFileURL(join(outputDir, "source/shared/course-profile.js"));
  courseUrl.searchParams.set("contract", String(Date.now()));
  await import(courseUrl.href);
  globalThis.CaatuuCourse = window.CaatuuCourse;
  globalThis.CaatuuRuntime = window.CaatuuRuntime;

  const compiledAdapter = join(outputDir, "source/language/adapter.mjs");
  assert.deepEqual(
    readFileSync(compiledAdapter),
    readFileSync(join(languageStaticDir, "source/language/adapter.mjs")),
    "the generated product must retain its course adapter byte-for-byte",
  );
  const adapterSource = readFileSync(compiledAdapter, "utf8");
  const contractUrl = pathToFileURL(join(outputDir, "language-runtime/contract.mjs")).href;
  const executableAdapterSource = adapterSource.replace(
    'from "/language-runtime/contract.mjs"',
    `from ${JSON.stringify(contractUrl)}`,
  );
  assert.notEqual(
    executableAdapterSource,
    adapterSource,
    "the Node harness must map the canonical browser URL to the compiled shared contract",
  );
  const executableAdapterUrl = `data:text/javascript;base64,${Buffer.from(executableAdapterSource).toString("base64")}`;
  const { default: czechLanguageAdapter } = await import(executableAdapterUrl);

  const manifestUrl = "https://caatuu.test/cz/data/games/word-world/manifest.json";
  const manifest = JSON.parse(readFileSync(join(outputDir, "data/games/word-world/manifest.json"), "utf8"));
  const standardModuleUrl = pathToFileURL(join(outputDir, "source/games/word-world/word-net-standard.mjs"));
  standardModuleUrl.searchParams.set("contract", String(Date.now()));
  const standardModule = await import(standardModuleUrl.href);
  const standardProvider = await standardModule.loadStandardWordWorldCorpus({
    manifestUrl,
    fetchImpl: environment.fetchImpl,
    random: () => 0,
    now: () => 1_700_000_000_000,
  });

  const hostSource = readFileSync(join(outputDir, "language-runtime/static/source/word-world-host.mjs"), "utf8");
  assert.match(hostSource, /import\("\.\/word-world-provider\.mjs\?v=word-world-provider-/u);
  assert.match(hostSource, /mountWordWorld\(root, course, manifest\)/u);
  const hostUrl = pathToFileURL(join(outputDir, "language-runtime/static/source/word-world-host.mjs"));
  hostUrl.searchParams.set("contract", String(Date.now()));
  const hostModule = await import(hostUrl.href);
  assert.equal(typeof hostModule.CaatuuWordWorldHost.ensureLoaded, "function");

  const providerUrl = pathToFileURL(join(outputDir, "language-runtime/static/source/word-world-provider.mjs"));
  providerUrl.searchParams.set("contract", String(Date.now()));
  const providerModule = await import(providerUrl.href);
  let rendererSpecifier = "";
  const controller = await providerModule.mountWordWorld(
    environment.elements.get("wordWorldRoot"),
    window.CaatuuCourse,
    manifest,
    {
      origin: "https://caatuu.test",
      adapter: czechLanguageAdapter,
      standardProvider,
      embeddingRanker: null,
      meaningSelector: () => null,
      runtime: window.CaatuuRuntime,
      async rendererImport(specifier) {
        rendererSpecifier = specifier;
        return import(new URL(specifier, providerUrl).href);
      },
    },
  );
  assert.match(rendererSpecifier, /^\.\/product-word-world\.mjs\?v=shared-renderer-/u);
  assert.equal(typeof controller.next, "function");
  assert.equal(typeof controller.pause, "function");
  assert.equal(typeof controller.resume, "function");
  assert.equal(environment.elements.get("wordNetSentence").getAttribute("lang"), "cs-CZ");
  assert.equal(environment.elements.get("wordNetSentence").getAttribute("dir"), "ltr");
  controller.pause();
});
