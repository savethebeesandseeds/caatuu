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

function mockElement(tagName = "div") {
  const attributes = new Map();
  const listeners = new Map();
  let source = "";
  const element = {
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
    append(...children) { this.children.push(...children); },
    prepend(...children) { this.children.unshift(...children); },
    replaceChildren(...children) { this.children = children; },
    replaceWith() {},
    remove() {},
    focus() {},
    click() {},
    reset() {},
    showModal() { this.open = true; },
    close() { this.open = false; },
    querySelector() { return mockElement(); },
    querySelectorAll() { return []; },
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
  };
  return element;
}

function installWordWorldEnvironment(outputDir) {
  const elements = new Map();
  const byId = (id) => {
    if (!elements.has(id)) elements.set(id, mockElement());
    return elements.get(id);
  };
  const documentElement = mockElement("html");
  const body = mockElement("body");
  const document = {
    documentElement,
    body,
    visibilityState: "visible",
    readyState: "complete",
    addEventListener() {},
    removeEventListener() {},
    querySelector(selector) { return byId(String(selector)); },
    querySelectorAll() { return []; },
    getElementById(id) { return byId(id); },
    createElement(tagName) { return mockElement(tagName); },
    createElementNS(_namespace, tagName) { return mockElement(tagName); },
  };
  const messages = [];
  const parent = { postMessage(message) { messages.push(message); } };
  const storage = new Map();
  const window = {
    document,
    parent,
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
  globalThis.window = window;
  globalThis.document = document;
  globalThis.location = window.location;
  globalThis.localStorage = window.localStorage;
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: window.navigator });
  globalThis.Image = class {
    set src(_value) { queueMicrotask(() => this.onerror?.(new Error("not loaded in contract"))); }
  };
  globalThis.fetch = async (request) => {
    const url = new URL(request, window.location.href);
    if (url.origin !== window.location.origin || url.pathname.startsWith("/assets/")) {
      return new Response("not found", { status: 404 });
    }
    const path = join(outputDir, decodeURIComponent(url.pathname).replace(/^\/+/, ""));
    try {
      return new Response(readFileSync(path), { status: 200 });
    } catch {
      return new Response("not found", { status: 404 });
    }
  };
  return messages;
}

test("the generated Standard-only Word World completes its startup contract", async (t) => {
  const parent = mkdtempSync(join(tmpdir(), "caatuu-product-word-world-"));
  const outputDir = join(parent, "product");
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  compileProductAssets({ workspaceRoot, languageStaticDir, launcherStaticDir, outputDir });
  const messages = installWordWorldEnvironment(outputDir);

  const courseUrl = pathToFileURL(join(outputDir, "source/shared/course-profile.js"));
  courseUrl.searchParams.set("contract", String(Date.now()));
  await import(courseUrl.href);
  const wordWorldUrl = pathToFileURL(join(outputDir, "source/games/word-world/word-net.js"));
  wordWorldUrl.searchParams.set("contract", String(Date.now()));
  await import(wordWorldUrl.href);

  const deadline = Date.now() + 2_000;
  while (!messages.some((message) => ["ready", "error"].includes(message?.type)) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.deepEqual(messages.find((message) => ["ready", "error"].includes(message?.type)), {
    source: "caatuu-word-world",
    type: "ready",
  });
});
