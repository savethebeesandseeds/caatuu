import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const promotedUrl = new URL("../static/source/caatuu-workspace.js", import.meta.url);
const promoted = await readFile(promotedUrl, "utf8");
const appEntry = await readFile(new URL("../static/app/index.html", import.meta.url), "utf8");

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

function wordWorldOnlyBrowser(options = {}) {
  const documentListeners = new Map();
  const windowListeners = new Map();
  const documentElement = {
    dataset: { theme: "dark", fontSize: "largest" },
    style: {}
  };
  const body = { classList: new FakeClassList(), dataset: {} };
  const launchpadShip = { src: "" };
  const gamesTrigger = {
    getAttribute() {
      return "false";
    },
    click() {
      hostCalls.gamesMenuClicks += 1;
    }
  };
  const document = {
    body,
    documentElement,
    activeElement: null,
    addEventListener(type, listener) {
      const listeners = documentListeners.get(type) ?? [];
      listeners.push(listener);
      documentListeners.set(type, listeners);
    },
    querySelector(selector) {
      if (selector === "#gamesLaunchpadShip") return launchpadShip;
      if (selector === '[data-caatuu-bottom-nav] [data-nav-key="games"]') return gamesTrigger;
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
  const hostCalls = { ensureLoaded: 0, setActive: [], ready: 0, next: 0, gamesMenuClicks: 0 };
  const shellPolicyReads = { campaignGameIds: 0 };
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
      embeddings: options.embeddings === true,
      semanticSearch: options.embeddings === true,
      dictionary: options.dictionary === true,
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
    },
    ...(options.dictionaryContent === undefined
      ? {}
      : { dictionaryContent: options.dictionaryContent }),
    ...(options.embeddingContent === undefined
      ? {}
      : { embeddingContent: options.embeddingContent })
  };
  const location = {
    origin: "https://local.test",
    href: "https://local.test/fixture-word-world/index.html",
    hostname: "local.test"
  };
  const window = {
    CaatuuCourse: course,
    CaatuuShellPolicy: {
      get CAMPAIGN_GAME_IDS() {
        shellPolicyReads.campaignGameIds += 1;
        return ["word-net"];
      },
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
    fetch(url, fetchOptions = {}) {
      fetches.push({ url: String(url), cache: fetchOptions.cache || "default" });
      if (options.embeddingCatalog
          && String(url) === "https://local.test/fixture-word-world/data/embeddings/catalog.json") {
        return Promise.resolve({
          ok: true,
          json: async () => structuredClone(options.embeddingCatalog)
        });
      }
      return Promise.reject(new Error(`Unexpected course fetch: ${url}`));
    },
    localStorage,
    location,
    performance: { now: () => 0 },
    sessionStorage,
    setTimeout,
    window
  });
  return { context, errors, fetches, hostCalls, launchpadShip, shellPolicyReads, window };
}

test("the retired training screen is replaced by a ship-only launchpad", () => {
  assert.match(appEntry, /id="gamesLaunchpadShip"/u);
  assert.match(appEntry, /class="train-route-proxies" hidden aria-hidden="true"/u);
  assert.doesNotMatch(appEntry, /id="sharedTrainWorlds"/u);
  assert.doesNotMatch(appEntry, /class="train-world(?:\s|")/u);
});

test("a Word-World-only course initializes and navigates without unrelated course fetches", async () => {
  const browser = wordWorldOnlyBrowser();
  vm.runInContext(promoted, browser.context, { filename: "caatuu-workspace.js" });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  const workspaceReady = await browser.window.CaatuuWorkspaceReady;

  assert.deepEqual(browser.fetches, []);
  assert.deepEqual(browser.errors, []);
  assert.deepEqual(JSON.parse(JSON.stringify(workspaceReady)), { ready: true });
  assert.equal(browser.shellPolicyReads.campaignGameIds, 1);
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
  assert.match(browser.launchpadShip.src, /^\/assets\/ships\/ship%20\((?:[1-9]|1\d|2[0-8])\)\.png$/u);
  assert.equal(browser.hostCalls.gamesMenuClicks, 1, "returning to the launchpad must open the planet chooser");
  assert.deepEqual(browser.fetches, []);
});

test("a dictionary-enabled workspace fails before fetching undeclared or unconfined content", async () => {
  for (const dictionaryContent of [
    undefined,
    {
      catalog: "data/dictionaries/catalog.json",
      coreEntries: "../other-course/core.json",
      scriptLines: "data/language/scripts.json",
      referenceDocument: "data/dictionaries/reference.html"
    }
  ]) {
    const browser = wordWorldOnlyBrowser({ dictionary: true, dictionaryContent });
    vm.runInContext(promoted, browser.context, { filename: "caatuu-workspace.js" });
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    const workspaceReady = await browser.window.CaatuuWorkspaceReady;

    assert.deepEqual(browser.fetches, []);
    assert.equal(workspaceReady.ready, false);
    assert.match(String(workspaceReady.error?.message || workspaceReady.error), /confined dictionaryContent/u);
    assert.equal(
      browser.errors.some((message) => /confined dictionaryContent\.(?:catalog|coreEntries) course resource/u.test(message)),
      true
    );
  }
});

test("an embedding-enabled course loads its declared static license catalog without a model runtime", async () => {
  const browser = wordWorldOnlyBrowser({
    embeddings: true,
    embeddingContent: { catalog: "data/embeddings/catalog.json" },
    embeddingCatalog: {
      version: 1,
      default_model: "fixture-minilm",
      models: [{
        key: "fixture-minilm",
        label: "Fixture MiniLM",
        license: "Apache-2.0",
        artifact_kind: "embedding-model",
        status: "active",
        embedding_text_field: "english_text",
        embedding_input_policy: "english_text_only"
      }]
    }
  });
  vm.runInContext(promoted, browser.context, { filename: "caatuu-workspace.js" });
  const workspaceReady = await browser.window.CaatuuWorkspaceReady;

  assert.equal(workspaceReady.ready, true);
  assert.deepEqual(browser.errors, []);
  assert.deepEqual(browser.fetches, [
    {
      url: "https://local.test/fixture-word-world/data/embeddings/catalog.json",
      cache: "reload"
    }
  ]);
});

test("a course embedding selection is accepted by schema while preserving English audit authority", async () => {
  const embeddingCatalog = {
    $schema: "https://caatuu.org/schemas/embedding-catalog.v1.schema.json",
    schemaVersion: 1,
    courseId: "fixture-word-world",
    embeddingPolicy: {
      inputLanguage: "en",
      inputField: "embeddingText",
      targetTextAllowed: false,
      targetPronunciationAllowed: false
    },
    conceptCatalog: "/language-runtime/static/data/english-concepts/word-world-starter-v1.json",
    runtime: {
      rankerModule: "/language-runtime/static/source/english-minilm-ranker.mjs",
      sharedCatalog: "/language-runtime/embedding-runtimes.json",
      modelRequired: true,
      defaultModelId: "all-minilm-l6-v2-qint8-v0.1",
      modelDelivery: "browser-on-demand",
      modelPrecached: false,
      androidPackaged: false,
      fallback: "deterministic-lexical"
    },
    thirdPartyNotices: [{
      component: "sentence-transformers/all-MiniLM-L6-v2",
      license: "Apache-2.0",
      noticeUrl: "/language-runtime/models/all-minilm-l6-v2-qint8-v0.1/runtime/LICENSE-APACHE-2.0.txt"
    }],
    notes: "Ranks authored English embeddingText only."
  };
  const browser = wordWorldOnlyBrowser({
    embeddings: true,
    embeddingContent: { catalog: "data/embeddings/catalog.json" },
    embeddingCatalog
  });
  vm.runInContext(promoted, browser.context, { filename: "caatuu-workspace.js" });
  const workspaceReady = await browser.window.CaatuuWorkspaceReady;

  assert.equal(workspaceReady.ready, true);
  assert.deepEqual(browser.errors, []);
  assert.deepEqual(browser.fetches, [{
    url: "https://local.test/fixture-word-world/data/embeddings/catalog.json",
    cache: "reload"
  }]);

  embeddingCatalog.embeddingPolicy.inputLanguage = "fr";
  const unsafeBrowser = wordWorldOnlyBrowser({
    embeddings: true,
    embeddingContent: { catalog: "data/embeddings/catalog.json" },
    embeddingCatalog
  });
  vm.runInContext(promoted, unsafeBrowser.context, { filename: "caatuu-workspace.js" });
  const unsafeReady = await unsafeBrowser.window.CaatuuWorkspaceReady;
  assert.equal(unsafeReady.ready, false);
  assert.match(String(unsafeReady.error?.message || unsafeReady.error), /English embeddingText audit boundary/u);
});

test("schema-tagged embedding catalogs cannot fall through the legacy models shape", async () => {
  for (const $schema of [
    "https://caatuu.org/schemas/embedding-catalog.v2.schema.json",
    "https://example.invalid/forged-embedding-catalog.json"
  ]) {
    const browser = wordWorldOnlyBrowser({
      embeddings: true,
      embeddingContent: { catalog: "data/embeddings/catalog.json" },
      embeddingCatalog: {
        $schema,
        schemaVersion: 1,
        models: [{
          key: "target-language-vectors",
          label: "Unreviewed target vectors",
          embedding_input_policy: "target_text"
        }]
      }
    });
    vm.runInContext(promoted, browser.context, { filename: "caatuu-workspace.js" });
    const workspaceReady = await browser.window.CaatuuWorkspaceReady;

    assert.equal(workspaceReady.ready, false);
    assert.match(
      String(workspaceReady.error?.message || workspaceReady.error),
      /models catalog or a versioned course embedding selection/u
    );
  }
});

test("legacy embedding catalogs require a versioned English-only active default", async () => {
  const catalog = {
    version: 1,
    default_model: "fixture-minilm",
    models: [{
      key: "fixture-minilm",
      label: "Fixture MiniLM",
      license: "Apache-2.0",
      artifact_kind: "embedding-model",
      status: "active",
      embedding_text_field: "english_text",
      embedding_input_policy: "english_text_only"
    }]
  };
  const invalidCatalogs = [
    { ...catalog, version: undefined },
    { ...catalog, version: 2 },
    { ...catalog, default_model: "unregistered-model" },
    {
      ...catalog,
      models: [{ ...catalog.models[0], embedding_text_field: "target_text" }]
    },
    {
      ...catalog,
      models: [{ ...catalog.models[0], embedding_input_policy: "target_text" }]
    }
  ];

  for (const embeddingCatalog of invalidCatalogs) {
    const browser = wordWorldOnlyBrowser({
      embeddings: true,
      embeddingContent: { catalog: "data/embeddings/catalog.json" },
      embeddingCatalog
    });
    vm.runInContext(promoted, browser.context, { filename: "caatuu-workspace.js" });
    const workspaceReady = await browser.window.CaatuuWorkspaceReady;

    assert.equal(workspaceReady.ready, false);
    assert.match(
      String(workspaceReady.error?.message || workspaceReady.error),
      /version 1 models catalog|active default model|English-only embedding input policy/u
    );
  }
});
