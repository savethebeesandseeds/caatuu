import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { normalizeGameId } from "../static/source/shell-policy.mjs";

const promotedUrl = new URL("../static/source/caatuu-workspace.js", import.meta.url);
const promoted = await readFile(promotedUrl, "utf8");
const appEntry = await readFile(new URL("../static/app/index.html", import.meta.url), "utf8");

const interfaceMessages = Object.freeze({
  "common.browser": "Browser",
  "common.campaignmode": "Campaign Mode",
  "common.continuequestion": "Continue?",
  "common.games": "Games",
  "common.train": "Train",
  "games.embedded.retry": "Return to the planets and try opening it again.",
  "games.embedded.startfailure": "{game} could not start",
  "maintenance.cache.clearing": "Clearing cache.",
  "maintenance.cache.clearingapp": "Clearing app cache.",
  "maintenance.cache.confirm": "Confirm cache clear",
  "maintenance.cache.pressagain": "Press Clear cache again to remove temporary cache. Course progress stays saved.",
  "maintenance.cache.prompt": "Clear temporary cache? Course progress stays saved.",
  "maintenance.cache.unknownsize": "unknown size",
  "maintenance.status.androidapkonly": "App updates are available inside the Android APK.",
  "maintenance.status.checkingserver": "Checking the update server...",
  "maintenance.status.checkingversion": "Checking app version.",
  "maintenance.status.openingsetup": "Opening Setup for the app update...",
  "maintenance.status.postponed": "Update postponed. You can start it here whenever you are ready.",
  "maintenance.status.readyforconfirmation": "Update {version} is ready for confirmation.",
  "maintenance.version.available": "available",
  "nav.backtomenu": "Back to menu",
  "nav.home": "Home",
  "platform.pwa.androidnative": "Android native",
  "platform.pwa.installable": "Installable",
  "platform.pwa.installed": "Installed",
  "platform.pwa.offlineready": "Offline ready",
  "wordworld.host.retry": "Return to the planets and try opening it again.",
  "wordworld.host.startfailure": "Word World could not start",
  "wordworld.host.unavailable": "The Word World host is unavailable."
});

function formatInterfaceMessage(messageId, parameters = {}) {
  const template = interfaceMessages[messageId];
  if (!template) throw new Error(`Unexpected interface message: ${messageId}`);
  return template.replace(/\{([a-z][a-zA-Z0-9]*)\}/gu, (_match, name) => String(parameters[name]));
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

function wordWorldOnlyBrowser(options = {}) {
  const documentListeners = new Map();
  const windowListeners = new Map();
  const documentElement = {
    dataset: { theme: "dark", fontSize: "largest" },
    style: {}
  };
  const body = { classList: new FakeClassList(), dataset: {} };
  const launchpadShip = { src: "" };
  const pwaInstallButton = {
    addEventListener() {},
    disabled: false,
    hidden: false,
    textContent: ""
  };
  const pwaInstallStatus = { textContent: "" };
  const pwaInstallHelp = { hidden: true };
  const wordWorldStatusTitle = { textContent: "" };
  const wordWorldStatusCopy = { textContent: "" };
  const wordWorldStatus = {
    classList: new FakeClassList(),
    querySelector(selector) {
      if (selector === "strong") return wordWorldStatusTitle;
      if (selector === "small") return wordWorldStatusCopy;
      return null;
    }
  };
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
      if (options.pwaControls && selector === "#installPwaAction") return pwaInstallButton;
      if (options.pwaControls && selector === "#pwaInstallStatus") return pwaInstallStatus;
      if (options.pwaControls && selector === "#pwaInstallHelp") return pwaInstallHelp;
      return null;
    },
    querySelectorAll() {
      return [];
    },
    getElementById(id) {
      return id === "wordNetEmbeddedStatus" ? wordWorldStatus : null;
    }
  };
  const localStorage = storage();
  const sessionStorage = storage();
  const fetches = [];
  const hostCalls = { ensureLoaded: 0, setActive: [], ready: 0, next: 0, gamesMenuClicks: 0 };
  const chromeCalls = { pagePresentation: [], bottomNavSection: [], headerTitle: [], gamePresentation: [] };
  const interfaceCalls = [];
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
  const interfaceContent = {
    locale: "en",
    languageName(language) {
      return String(language?.label || language?.nativeLabel || language?.id || "").trim();
    },
    t(messageId, parameters = {}) {
      interfaceCalls.push({ messageId, parameters: { ...parameters } });
      return formatInterfaceMessage(messageId, parameters);
    }
  };
  const window = {
    CaatuuCourse: course,
    CaatuuChrome: {
      gamePresentation(gameId) {
        chromeCalls.gamePresentation.push(gameId);
        const titles = {
          campaign: "Campaign Mode",
          "word-net": "Word World",
          ...options.gameTitles
        };
        const title = titles[gameId];
        return title ? { title, summary: `${title} summary` } : null;
      },
      setBottomNavSection(section) {
        chromeCalls.bottomNavSection.push(section);
      },
      setHeaderTitle(title, configuration) {
        chromeCalls.headerTitle.push({ title, configuration });
      },
      setPagePresentation(presentation) {
        chromeCalls.pagePresentation.push(presentation);
      }
    },
    CaatuuI18n: options.interfaceContent === false ? undefined : interfaceContent,
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
        if (options.wordWorldHost === "reject") return Promise.reject(new Error("fixture failure"));
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
  if (options.wordWorldHost === false) window.CaatuuWordWorldHost = undefined;
  window.window = window;
  const context = vm.createContext({
    CaatuuI18n: options.interfaceContent === false ? undefined : interfaceContent,
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
  return {
    chromeCalls,
    context,
    dispatchDocumentEvent(type, event = {}) {
      for (const listener of documentListeners.get(type) || []) listener(event);
    },
    dispatchWindowEvent(type, event = {}) {
      for (const listener of windowListeners.get(type) || []) listener(event);
    },
    errors,
    fetches,
    hostCalls,
    interfaceCalls,
    launchpadShip,
    pwaInstallButton,
    pwaInstallHelp,
    pwaInstallStatus,
    shellPolicyReads,
    window,
    wordWorldStatus,
    wordWorldStatusCopy,
    wordWorldStatusTitle
  };
}

test("the workspace shell fails closed without installed interface content", () => {
  const browser = wordWorldOnlyBrowser({ interfaceContent: false });
  assert.throws(
    () => vm.runInContext(promoted, browser.context, { filename: "caatuu-workspace.js" }),
    /interface content must load before the app shell/u
  );
});

test("generic navigation and PWA status copy resolves through interface content", async () => {
  const browser = wordWorldOnlyBrowser({ pwaControls: true });
  vm.runInContext(promoted, browser.context, { filename: "caatuu-workspace.js" });
  assert.equal((await browser.window.CaatuuWorkspaceReady).ready, true);

  assert.equal(browser.pwaInstallButton.textContent, "Browser");
  assert.equal(browser.pwaInstallStatus.textContent, "Browser");
  browser.dispatchWindowEvent("beforeinstallprompt", { preventDefault() {} });
  assert.equal(browser.pwaInstallStatus.textContent, "Installable");
  browser.dispatchWindowEvent("appinstalled");
  assert.equal(browser.pwaInstallStatus.textContent, "Offline ready");

  browser.window.CaatuuWorkspaceShell.setView("home");
  browser.window.CaatuuWorkspaceShell.setView("verbs");
  assert.deepEqual(JSON.parse(JSON.stringify(browser.chromeCalls.pagePresentation)), [
    { kicker: "Caatuu", title: "Home", iconSrc: "/assets/icons/home_icon.png" },
    { kicker: "Train", title: "Games", iconSrc: "/assets/icons/games_icon.png" }
  ]);
  assert.equal(
    browser.interfaceCalls.some(({ messageId }) => messageId === "platform.pwa.installable"),
    true
  );
  assert.equal(
    browser.interfaceCalls.some(({ messageId }) => messageId === "nav.backtomenu"),
    true
  );
});

test("workspace headers and embedded shells consume the shared catalog-backed game presentation", async () => {
  const browser = wordWorldOnlyBrowser({
    gameTitles: { "word-net": "Catalog Word World" }
  });
  vm.runInContext(promoted, browser.context, { filename: "caatuu-workspace.js" });
  assert.equal((await browser.window.CaatuuWorkspaceReady).ready, true);

  browser.window.CaatuuWorkspaceShell.setTrainTab("word-net");
  assert.equal(browser.chromeCalls.headerTitle.at(-1).title, "Catalog Word World");
  assert.equal(browser.chromeCalls.gamePresentation.includes("word-net"), true);
  assert.doesNotMatch(promoted, /const trainTitles\s*=/u);
  assert.doesNotMatch(promoted, /title:\s*"Conjugation Comet"/u);
  assert.match(promoted, /interfaceText\("games\.embedded\.startfailure", \{ game: gameTitle \}\)/u);
  assert.match(promoted, /interfaceText\("games\.embedded\.retry"\)/u);
  assert.match(appEntry, /data-i18n-aria-label="games\.conjugationcomet\.title"/u);
  assert.match(appEntry, /data-i18n-title="games\.grammargravity\.title"/u);
});

test("Word World host failures use installed interface content", async () => {
  for (const [wordWorldHost, expectedCopy] of [
    [false, "The Word World host is unavailable."],
    ["reject", "Return to the planets and try opening it again."]
  ]) {
    const browser = wordWorldOnlyBrowser({ wordWorldHost });
    vm.runInContext(promoted, browser.context, { filename: "caatuu-workspace.js" });
    assert.equal((await browser.window.CaatuuWorkspaceReady).ready, true);
    browser.window.CaatuuWorkspaceShell.setView("verbs");
    browser.window.CaatuuWorkspaceShell.setTrainTab("word-net");
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(browser.wordWorldStatus.classList.contains("is-error"), true);
    assert.equal(browser.wordWorldStatusTitle.textContent, "Word World could not start");
    assert.equal(browser.wordWorldStatusCopy.textContent, expectedCopy);
  }
});

test("old game navigation requests and direct selection enter the renamed shared panel", async () => {
  for (const [source, legacyId] of ["bookmark", "session"].flatMap((source) =>
    ["agreement-aurora", "triangular-thermosphere"].map((legacyId) => [source, legacyId]))) {
    const browser = wordWorldOnlyBrowser({
      gameTitles: { "grammar-gravity": "Grammar Gravity" }
    });
    browser.window.CaatuuShellPolicy.normalizeGameId = normalizeGameId;
    browser.window.CaatuuShellPolicy.gameAvailable = (_course, gameId) => (
      ["word-net", "grammar-gravity"].includes(gameId)
    );
    const { document, sessionStorage } = browser.context;
    if (source === "bookmark") document.documentElement.dataset.navigationRequest = `game:${legacyId}`;
    else sessionStorage.setItem("caatuu-fixture-word-world.navigation.request.v1", `game:${legacyId}`);
    const query = document.querySelector.bind(document);
    const requests = [];
    document.querySelector = (selector) => {
      if (selector === '[data-train-tab="grammar-gravity"]') {
        return { click() {
          requests.push("grammar-gravity");
          browser.window.CaatuuWorkspaceShell.setTrainTab("grammar-gravity");
        } };
      }
      return query(selector);
    };
    vm.runInContext(promoted, browser.context, { filename: "caatuu-workspace.js" });
    assert.equal((await browser.window.CaatuuWorkspaceReady).ready, true);
    assert.deepEqual(requests, ["grammar-gravity"]);
    assert.equal(browser.window.CaatuuWorkspaceShell.state().trainTab, "grammar-gravity");
    assert.equal(sessionStorage.getItem("caatuu-fixture-word-world.navigation.request.v1"), null);
    browser.window.CaatuuWorkspaceShell.setTrainTab("galaxy");
    browser.window.CaatuuWorkspaceShell.setTrainTab(legacyId);
    assert.equal(browser.window.CaatuuWorkspaceShell.state().trainTab, "grammar-gravity");
    assert.equal(browser.chromeCalls.headerTitle.at(-1).title, "Grammar Gravity");
    assert.deepEqual(browser.errors, []);
  }
});

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

test("Home recovery deactivates Word World and returning to Games restores its visibility", async () => {
  const browser = wordWorldOnlyBrowser();
  vm.runInContext(promoted, browser.context, { filename: "caatuu-workspace.js" });
  await browser.window.CaatuuWorkspaceReady;
  const shell = browser.window.CaatuuWorkspaceShell;
  shell.setView("verbs");
  shell.setTrainTab("word-net");
  assert.equal(browser.hostCalls.setActive.at(-1).active, true);
  assert.equal(browser.context.document.body.classList.contains("word-net-active"), true);

  browser.dispatchDocumentEvent("caatuu:home-request");
  assert.equal(shell.state().activeView, "home");
  assert.equal(browser.hostCalls.setActive.at(-1).active, false);
  assert.equal(browser.context.document.body.classList.contains("word-net-active"), false);
  assert.equal(browser.context.document.body.classList.contains("embedded-game-active"), false, "setup must regain normal page scrolling");
  shell.setTrainTab("word-net");
  assert.equal(browser.hostCalls.setActive.at(-1).active, false, "a tab refresh while Home is visible must not activate a hidden game");
  assert.equal(browser.context.document.body.classList.contains("word-net-active"), false);
  shell.setView("verbs");
  assert.equal(browser.hostCalls.setActive.at(-1).active, true);
  assert.equal(browser.context.document.body.classList.contains("word-net-active"), true);
});

test("Home recovery deactivates embedded games and a late iframe load stays inactive until Games is visible", async () => {
  const browser = wordWorldOnlyBrowser({ gameTitles: { "grammar-gravity": "Grammar Gravity" } });
  const messages = [];
  const frameListeners = new Map();
  const frame = {
    dataset: { src: "/language-runtime/static/games/grammar-gravity.html" },
    classList: new FakeClassList(),
    contentWindow: { postMessage(message, origin) { messages.push({ message, origin }); } },
    addEventListener(type, listener) { frameListeners.set(type, listener); },
    removeAttribute() {}
  };
  const originalGetElementById = browser.context.document.getElementById;
  browser.context.document.getElementById = (id) => id === "grammarGravityEmbeddedGame" ? frame : originalGetElementById(id);
  browser.window.CaatuuShellPolicy.gameAvailable = (_course, gameId) => ["word-net", "grammar-gravity"].includes(gameId);
  vm.runInContext(promoted, browser.context, { filename: "caatuu-workspace.js" });
  await browser.window.CaatuuWorkspaceReady;
  const shell = browser.window.CaatuuWorkspaceShell;
  shell.setView("verbs");
  shell.setTrainTab("grammar-gravity");
  assert.equal(frame.dataset.loading, "true");
  assert.equal(browser.context.document.body.classList.contains("embedded-game-active"), true);

  browser.dispatchDocumentEvent("caatuu:home-request");
  assert.equal(browser.context.document.body.classList.contains("embedded-game-active"), false);
  frameListeners.get("load")();
  assert.equal(frame.dataset.ready, "true");
  assert.equal(messages.at(-1).message.active, false, "loading after Home recovery must not restart the hidden falling-word timer");
  shell.setView("verbs");
  assert.equal(messages.at(-1).message.active, true);
  assert.equal(browser.context.document.body.classList.contains("embedded-game-active"), true);
  assert.equal(messages.at(-1).origin, browser.window.location.origin);
  browser.dispatchDocumentEvent("caatuu:home-request");
  assert.equal(messages.at(-1).message.active, false);
  shell.setTrainTab("grammar-gravity");
  assert.equal(messages.at(-1).message.active, false);
  assert.deepEqual(browser.errors, []);
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
