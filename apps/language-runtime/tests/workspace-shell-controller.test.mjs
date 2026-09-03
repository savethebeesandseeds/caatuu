import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const promotedUrl = new URL("../static/source/caatuu-workspace.js", import.meta.url);
const promoted = await readFile(promotedUrl, "utf8");

class FakeClassList {
  constructor() {
    this.names = new Set();
  }

  add(...names) {
    names.forEach((name) => this.names.add(name));
  }

  remove(...names) {
    names.forEach((name) => this.names.delete(name));
  }

  toggle(name, force) {
    const enabled = force === undefined ? !this.names.has(name) : Boolean(force);
    if (enabled) this.names.add(name);
    else this.names.delete(name);
    return enabled;
  }

  contains(name) {
    return this.names.has(name);
  }
}

function storage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(String(key)) ? values.get(String(key)) : null;
    },
    setItem(key, value) {
      values.set(String(key), String(value));
    },
    removeItem(key) {
      values.delete(String(key));
    }
  };
}

function wordWorldOnlyBrowser() {
  const documentListeners = new Map();
  const windowListeners = new Map();
  const documentElement = {
    dataset: { theme: "dark", fontSize: "largest" },
    style: {}
  };
  const body = { classList: new FakeClassList(), dataset: {} };
  const document = {
    body,
    documentElement,
    activeElement: null,
    addEventListener(type, listener) {
      const listeners = documentListeners.get(type) ?? [];
      listeners.push(listener);
      documentListeners.set(type, listeners);
    },
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
    getElementById() {
      return null;
    }
  };
  const localStorage = storage();
  const sessionStorage = storage();
  const fetches = [];
  const hostCalls = { ensureLoaded: 0, setActive: [], ready: 0, next: 0 };
  const errors = [];
  const course = {
    id: "fixture-word-world",
    routePrefix: "/fixture-word-world",
    sourceLanguage: { id: "en", label: "English", locale: "en" },
    targetLanguage: { id: "xx", label: "Fixture", locale: "xx" },
    capabilities: {
      llm: false,
      generation: false,
      offlineModels: false,
      embeddings: true,
      semanticSearch: true,
      dictionary: false,
      verbs: false,
      wordWorld: true,
      conjugationComet: false,
      memory: false
    },
    games: ["word-net"],
    linguisticFeatures: [],
    routes: { wordWorld: "index.html?game=word-net" },
    storage: {
      namespace: "caatuu-fixture-word-world",
      theme: "caatuu-fixture-word-world.theme",
      fontSize: "caatuu-fixture-word-world.font-size"
    }
  };
  const location = {
    origin: "https://local.test",
    href: "https://local.test/fixture-word-world/index.html",
    hostname: "local.test"
  };
  const window = {
    CaatuuCourse: course,
    CaatuuShellPolicy: {
      gameAvailable(candidate, gameId) {
        return candidate === course && gameId === "word-net";
      }
    },
    CaatuuWordWorldHost: {
      ensureLoaded() {
        hostCalls.ensureLoaded += 1;
        return Promise.resolve();
      },
      setActive(active, display) {
        hostCalls.setActive.push({ active, display });
      },
      ready() {
        hostCalls.ready += 1;
        return true;
      },
      next() {
        hostCalls.next += 1;
      }
    },
    addEventListener(type, listener) {
      const listeners = windowListeners.get(type) ?? [];
      listeners.push(listener);
      windowListeners.set(type, listeners);
    },
    confirm() {
      return false;
    },
    history: { state: null, replaceState() {} },
    location,
    matchMedia() {
      return { matches: false, addEventListener() {} };
    },
    navigator: { standalone: false },
    requestAnimationFrame(callback) {
      callback();
      return 1;
    },
    setTimeout,
    clearTimeout
  };
  window.window = window;
  const context = vm.createContext({
    URL,
    Uint8Array,
    TextDecoder,
    clearTimeout,
    console: {
      error(...parts) {
        errors.push(parts.map(String).join(" "));
      },
      warn() {},
      info() {},
      log() {}
    },
    document,
    fetch(url) {
      fetches.push(String(url));
      return Promise.reject(new Error(`Unexpected course fetch: ${url}`));
    },
    localStorage,
    location,
    performance: { now: () => 0 },
    sessionStorage,
    setTimeout,
    window
  });
  return { context, errors, fetches, hostCalls, window };
}

test("a Word-World-only course initializes and navigates without unrelated course fetches", async () => {
  const browser = wordWorldOnlyBrowser();
  vm.runInContext(promoted, browser.context, { filename: "caatuu-workspace.js" });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(browser.fetches, []);
  assert.deepEqual(browser.errors, []);
  assert.equal(Object.isFrozen(browser.window.CaatuuWorkspaceShell), true);
  assert.equal(typeof browser.window.CaatuuWorkspaceShell.setView, "function");
  assert.equal(typeof browser.window.CaatuuWorkspaceShell.setTrainTab, "function");
  assert.equal(typeof browser.window.CaatuuWorkspaceShell.state, "function");

  browser.window.CaatuuWorkspaceShell.setView("verbs");
  browser.window.CaatuuWorkspaceShell.setTrainTab("word-net");
  await Promise.resolve();
  assert.equal(browser.hostCalls.ensureLoaded, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(browser.hostCalls.setActive.at(-1))), {
    active: true,
    display: { theme: "light", fontSize: "largest" }
  });
  assert.deepEqual(JSON.parse(JSON.stringify(browser.window.CaatuuWorkspaceShell.state())), {
    activeView: "verbs",
    trainTab: "word-net",
    campaignActive: false,
    campaignTransitioning: false
  });

  browser.window.CaatuuWorkspaceShell.setTrainTab("verb-lab");
  assert.equal(browser.window.CaatuuWorkspaceShell.state().trainTab, "galaxy");
  assert.deepEqual(browser.fetches, []);
});
