import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const authorityCommit = "cf29a378dc7fcb3552c8f8427dad92d59bdf2eb3";
const repositoryRoot = new URL("../../../", import.meta.url);
const promotedUrl = new URL("../static/source/caatuu-workspace.js", import.meta.url);
const authority = execFileSync(
  "git",
  [
    "show",
    `${authorityCommit}:apps/languages/czech/static/source/games/verb-nebula/app.js`
  ],
  { cwd: fileURLToPath(repositoryRoot), encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }
);
const promoted = await readFile(promotedUrl, "utf8");

function declaredFunctions(source) {
  return [...source.matchAll(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gmu)]
    .map((match) => match[1]);
}

function stateModel(source) {
  const start = source.indexOf("const state = {");
  const endMarker = "\n};\n\nconst $";
  const end = source.indexOf(endMarker, start);
  assert.notEqual(start, -1, "controller must declare its private state model");
  assert.notEqual(end, -1, "controller state model must retain its authority boundary");
  return source.slice(start, end + 3);
}

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

test("promotion retains the complete Czech function and state authority", () => {
  const authorityFunctions = declaredFunctions(authority);
  const promotedFunctions = new Set(declaredFunctions(promoted));
  const missing = authorityFunctions.filter((name) => !promotedFunctions.has(name));

  assert.deepEqual(missing, []);
  assert.equal(stateModel(promoted), stateModel(authority));
  for (const functionName of [
    "setView",
    "setTrainTab",
    "startCampaign",
    "completeCampaignRound",
    "ensureEmbeddedGameLoaded",
    "bindUi"
  ]) {
    assert.ok(promotedFunctions.has(functionName), `${functionName} must remain in the promoted controller`);
  }
});

test("workspace promotion removes the competing controller and uses only the narrow Word World host", () => {
  assert.doesNotMatch(promoted, /CaatuuProductShell/u);
  assert.doesNotMatch(promoted, /wordNetEmbeddedGame/u);
  assert.match(promoted, /CaatuuWordWorldHost\?\.setActive\?\./u);
  assert.match(promoted, /host\.ensureLoaded\(\)/u);
  assert.match(promoted, /CaatuuWordWorldHost\?\.ready\?\.\(\)/u);
  assert.match(promoted, /CaatuuWordWorldHost\?\.next\?\.\(\)/u);
  assert.match(promoted, /window\.CaatuuWorkspaceShell = Object\.freeze\(\{/u);
  assert.match(promoted, /setView,\s*\n\s*setTrainTab,\s*\n\s*state\(\)/u);
});

test("a Word-World-only course initializes without Czech data, model, verb, or dictionary fetches", async () => {
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
    display: { theme: "dark", fontSize: "largest" }
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

test("game content stays course-owned while the Verb Nebula engine is shared", () => {
  assert.match(promoted, /fetch\(courseAssetUrl\(path\)\)/u);
  assert.match(
    promoted,
    /import\("\/language-runtime\/static\/source\/games\/verb-nebula\/verb-nebula-core\.mjs\?v=verb-nebula-core-11"\)/u
  );
  assert.match(promoted, /const verbsEnabled = courseGameAvailable\("verb-lab"\)/u);
  assert.match(promoted, /if \(!verbsEnabled && !dictionaryEnabled\) return;/u);
  assert.match(promoted, /if \(courseUsesModels\(\)\) await loadModelLicenseCatalog/u);
});
