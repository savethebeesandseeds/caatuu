import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import test from "node:test";

import {
  LANGUAGE_ADAPTER_SCHEMA_VERSION,
  defineLanguageAdapter
} from "../contract.mjs";
import { mountWordWorld } from "../static/source/word-world-provider.mjs";

const execFileAsync = promisify(execFile);
const CHILD_FLAG = "--third-language-scenario";
const RESULT_MARKER = "CAATUU_THIRD_LANGUAGE_RESULT=";

function contentText(value) {
  if (typeof value === "string" || typeof value === "number") return String(value);
  return String(value?.text ?? value?.surface ?? value?.form ?? "");
}

function normalizeText(value) {
  return contentText(value).normalize("NFC").trim();
}

function spanishSegments(value) {
  const tokens = [];
  const pattern = /[\p{L}\p{M}]+(?:[’'-][\p{L}\p{M}]+)?|\d+|[^\s]/gu;
  let match;
  while ((match = pattern.exec(normalizeText(value))) !== null) {
    tokens.push({
      type: /^[\p{L}\p{M}\d]/u.test(match[0]) ? "word" : "punctuation",
      text: match[0]
    });
  }
  return tokens;
}

function pronunciation(value) {
  const text = normalizeText(value);
  return text ? {
    notation: text,
    system: "Spanish orthography",
    source: "display-text",
    languageTag: "es-ES",
    speechText: text
  } : null;
}

const spanishAdapter = defineLanguageAdapter({
  schemaVersion: LANGUAGE_ADAPTER_SCHEMA_VERSION,
  id: "spanish-test",
  direction: "ltr",
  languageTags: {
    primary: "es",
    locale: "es-ES",
    html: "es",
    fallbacks: ["es-MX", "es"]
  },
  normalization: {
    text: normalizeText,
    searchKey(value) {
      return normalizeText(value)
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "")
        .toLocaleLowerCase("es-ES")
        .replace(/\s+/gu, " ")
        .trim();
    },
    answerKey(value) {
      return normalizeText(value).toLocaleLowerCase("es-ES").replace(/\s+/gu, " ").trim();
    }
  },
  segmentation: {
    strategy: "computed",
    segment: spanishSegments
  },
  learner: {
    requiresAuthoredPronunciation: false,
    display(value) {
      return {
        text: normalizeText(value),
        languageTag: "es-ES",
        direction: "ltr",
        pronunciation: pronunciation(value)
      };
    },
    pronunciation
  },
  answers: {
    variants(value) {
      return [contentText(value), ...(value?.acceptedAnswers || [])];
    }
  },
  speech: {
    input: {
      languageTag: "es-MX",
      config: () => ({
        languageTag: "es-MX",
        continuous: false,
        interimResults: false,
        maxAlternatives: 1
      }),
      recognize: null
    },
    output: {
      languageTag: "es-MX",
      config: () => ({
        languageTag: "es-MX",
        rate: 0.9,
        pitch: 1,
        voice: "",
        pace: "slow",
        paceLabel: "Slow",
        maxCharacters: 1_000
      }),
      prepare: normalizeText,
      speak: null
    }
  },
  dictionary: {
    lookupKey(value) {
      return normalizeText(value)
        .replace(/^[^\p{L}\p{M}\d]+|[^\p{L}\p{M}\d]+$/gu, "")
        .toLocaleLowerCase("es-ES");
    },
    lookup: null,
    search: null
  }
});

const baseCapabilities = Object.freeze({
  wordWorld: true,
  embeddings: true,
  semanticSearch: true,
  dictionary: false,
  speech: true,
  pronunciationGuides: true,
  generation: false,
  llm: false,
  chat: false
});

function syntheticCourse(capabilities) {
  return Object.freeze({
    id: "es-test",
    routePrefix: "/es-test",
    sourceLanguage: { id: "en", label: "English", locale: "en-US", direction: "ltr" },
    targetLanguage: {
      id: "es",
      label: "Test Spanish",
      nativeLabel: "Español de prueba",
      locale: "es-ES",
      speechLocale: "es-MX",
      direction: "ltr"
    },
    capabilities: Object.freeze({ ...baseCapabilities, ...capabilities }),
    languageAdapter: { module: "source/language/adapter.mjs" },
    storage: {
      namespace: "caatuu-es-test",
      wordWorldTranslationMode: "caatuu-es-test.wordNet.translationMode",
      wordWorldRecentSentences: "caatuu-es-test.wordNet.recentSentences",
      wordWorldTranslationCache: "caatuu-es-test.wordNet.translationCache"
    }
  });
}

const manifest = Object.freeze({
  schemaVersion: "caatuu-word-world-runtime-manifest-v2",
  courseId: "es-test",
  corpusVersion: "third-language-test-v1",
  mode: "authored",
  sessionProvider: { kind: "authored-realizations" },
  features: { wordMeanings: true },
  sourceConceptCatalog: "/language-runtime/static/data/english-concepts/word-world-starter-v1.json",
  realizationFile: "third-language-test-v1.realizations.json",
  embeddingPolicy: {
    inputLanguage: "en",
    inputField: "embeddingText",
    targetTextAllowed: false,
    modelId: "all-minilm-l6-v2-qint8-v0.1",
    fallback: "deterministic-lexical"
  }
});

function thirdLanguageRealizations(englishCatalog) {
  return {
    schemaVersion: 1,
    courseId: "es-test",
    projectionPolicy: {
      tokenization: "authored",
      pronunciationIncluded: false,
      reason: "Synthetic contract fixture."
    },
    targetLanguage: {
      languageTag: "es-ES",
      speechLocale: "es-MX",
      script: "Latn"
    },
    sourceCatalog: "apps/languages/shared/english-concepts/word-world-starter-v1.json",
    contentPolicy: "third-language-contract-only",
    review: {
      status: "native-reviewed",
      reviewer: "contract-fixture",
      reviewedAt: "2026-08-30T00:00:00Z",
      notes: "Synthetic data used only to prove the shared boundary."
    },
    license: {
      origin: "caatuu-contract-fixture",
      status: "test-only",
      spdxExpression: null,
      sourceReference: null,
      reviewedBy: null,
      reviewedAt: null
    },
    realizations: englishCatalog.concepts.map((concept, index) => ({
      conceptId: concept.id,
      text: `¡Hola, amigo ${index + 1}!`,
      tokens: [
        { surface: "Hola", gloss: "hello (authored)", playable: true },
        { surface: "amigo", gloss: "friend (authored)", playable: true },
        { surface: String(index + 1), gloss: "number (authored)", playable: false }
      ]
    }))
  };
}

class FakeClassList {
  constructor(owner) {
    this.owner = owner;
    this.values = new Set();
  }

  assign(value) {
    this.values = new Set(String(value || "").split(/\s+/u).filter(Boolean));
  }

  add(...values) {
    values.forEach((value) => this.values.add(value));
  }

  remove(...values) {
    values.forEach((value) => this.values.delete(value));
  }

  contains(value) {
    return this.values.has(value);
  }

  toggle(value, force) {
    const enabled = force === undefined ? !this.contains(value) : Boolean(force);
    if (enabled) this.add(value);
    else this.remove(value);
    return enabled;
  }

  toString() {
    return [...this.values].join(" ");
  }
}

class FakeElement {
  constructor(tagName = "div", registry = null) {
    this.tagName = String(tagName).toUpperCase();
    this.registry = registry;
    this.attributes = new Map();
    this.dataset = {};
    this.style = {
      setProperty() {},
      removeProperty() {}
    };
    this.classList = new FakeClassList(this);
    this.childNodes = [];
    this.children = [];
    this.hidden = false;
    this.disabled = false;
    this.checked = false;
    this.open = false;
    this.value = "";
    this.returnValue = "";
    this.complete = false;
    this.naturalWidth = 0;
    this.listeners = new Map();
  }

  set id(value) {
    this.setAttribute("id", value);
  }

  get id() {
    return this.getAttribute("id") || "";
  }

  set className(value) {
    this.classList.assign(value);
    this.attributes.set("class", this.classList.toString());
  }

  get className() {
    return this.classList.toString();
  }

  set textContent(value) {
    const text = String(value ?? "");
    this.childNodes = text ? [{ nodeType: 3, nodeValue: text }] : [];
    this.children = [];
  }

  get textContent() {
    return this.childNodes.map((node) => node.nodeType === 3 ? node.nodeValue : node.textContent).join("");
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  dispatchEvent(event) {
    for (const listener of this.listeners.get(event.type) || []) listener.call(this, event);
    return true;
  }

  append(...nodes) {
    for (const value of nodes) {
      const node = typeof value === "string" ? { nodeType: 3, nodeValue: value } : value;
      if (!node) continue;
      node.parentElement = this;
      this.childNodes.push(node);
      if (node.nodeType !== 3) this.children.push(node);
    }
  }

  appendChild(node) {
    this.append(node);
    return node;
  }

  prepend(...nodes) {
    const prepared = nodes.map((value) => typeof value === "string"
      ? { nodeType: 3, nodeValue: value }
      : value).filter(Boolean);
    for (const node of prepared) node.parentElement = this;
    this.childNodes.unshift(...prepared);
    this.children = this.childNodes.filter((node) => node.nodeType !== 3);
  }

  replaceChildren(...nodes) {
    this.childNodes = [];
    this.children = [];
    this.append(...nodes);
  }

  replaceWith() {}
  remove() {}
  focus() {}
  click() {}
  reset() {}
  scrollTo() {}

  showModal() {
    this.open = true;
  }

  close(value = "") {
    this.open = false;
    this.returnValue = value;
    this.dispatchEvent({ type: "close" });
  }

  querySelector(selector) {
    return this.registry?.querySelector(selector) || null;
  }

  querySelectorAll(selector) {
    return this.registry?.querySelectorAll(selector) || [];
  }

  closest(selector) {
    return this.matches(selector) ? this : null;
  }

  matches(selector) {
    return this.registry?.matches(this, selector) || false;
  }

  setAttribute(name, value) {
    const normalized = String(name);
    const text = String(value);
    this.attributes.set(normalized, text);
    if (normalized === "class") this.classList.assign(text);
    if (normalized.startsWith("data-")) this.dataset[dataProperty(normalized.slice(5))] = text;
    if (normalized === "hidden") this.hidden = true;
    if (normalized === "disabled") this.disabled = true;
  }

  getAttribute(name) {
    return this.attributes.get(String(name)) ?? null;
  }

  hasAttribute(name) {
    return this.attributes.has(String(name));
  }

  removeAttribute(name) {
    const normalized = String(name);
    this.attributes.delete(normalized);
    if (normalized === "hidden") this.hidden = false;
    if (normalized === "disabled") this.disabled = false;
  }

  toggleAttribute(name, force) {
    const enabled = force === undefined ? !this.hasAttribute(name) : Boolean(force);
    if (enabled) this.setAttribute(name, "");
    else this.removeAttribute(name);
    return enabled;
  }

  getBoundingClientRect() {
    return { top: 0, left: 0, right: 100, bottom: 100, width: 100, height: 100 };
  }

  animate() {
    return { finished: Promise.resolve() };
  }

  cloneNode() {
    const clone = new FakeElement(this.tagName, this.registry);
    for (const [name, value] of this.attributes) clone.setAttribute(name, value);
    clone.textContent = this.textContent;
    return clone;
  }
}

function dataProperty(value) {
  return String(value).replace(/-([a-z])/gu, (_match, letter) => letter.toUpperCase());
}

class FakeRegistry {
  constructor() {
    this.elements = [];
    this.byId = new Map();
  }

  create(tagName = "div") {
    const element = new FakeElement(tagName, this);
    this.elements.push(element);
    return element;
  }

  register(element) {
    if (element.id) this.byId.set(element.id, element);
    return element;
  }

  seed(html) {
    const elementPattern = /<([a-z][\w-]*)\b([^>]*\bid="([^"]+)"[^>]*)>/giu;
    for (const match of html.matchAll(elementPattern)) {
      const element = this.create(match[1]);
      const attributes = match[2];
      for (const attribute of attributes.matchAll(/([:\w-]+)(?:="([^"]*)")?/gu)) {
        if (attribute[1] === match[1]) continue;
        element.setAttribute(attribute[1], attribute[2] ?? "");
      }
      element.hidden = /(?:^|\s)hidden(?:\s|$)/u.test(attributes);
      element.disabled = /(?:^|\s)disabled(?:\s|$)/u.test(attributes);
      element.checked = /(?:^|\s)checked(?:\s|$)/u.test(attributes);
      this.register(element);
    }
  }

  element(id) {
    if (!this.byId.has(id)) {
      const element = this.create();
      element.setAttribute("id", id);
      this.register(element);
    }
    return this.byId.get(id);
  }

  matches(element, rawSelector) {
    const selector = String(rawSelector || "").trim().split(/\s+/u).at(-1);
    if (!selector) return false;
    if (selector === "*") return true;
    if (selector.startsWith("#")) return element.id === selector.slice(1);
    if (selector.startsWith(".")) return element.classList.contains(selector.slice(1));
    const attribute = /^\[([\w-]+)(?:="([^"]*)")?\]$/u.exec(selector);
    if (attribute) {
      return element.hasAttribute(attribute[1])
        && (attribute[2] === undefined || element.getAttribute(attribute[1]) === attribute[2]);
    }
    const tagAndAttribute = /^([a-z][\w-]*)(\[[^\]]+\])$/iu.exec(selector);
    if (tagAndAttribute) {
      return element.tagName === tagAndAttribute[1].toUpperCase()
        && this.matches(element, tagAndAttribute[2]);
    }
    return element.tagName === selector.toUpperCase();
  }

  querySelectorAll(rawSelector) {
    const selectors = String(rawSelector || "").split(",").map((value) => value.trim()).filter(Boolean);
    return this.elements.filter((element) => selectors.some((selector) => this.matches(element, selector)));
  }

  querySelector(selector) {
    const text = String(selector || "").trim();
    const id = /^#([\w-]+)$/u.exec(text)?.[1];
    if (id) return this.byId.get(id) || null;
    return this.querySelectorAll(text)[0] || null;
  }
}

function installBrowserEnvironment(course, authorityHtml) {
  const registry = new FakeRegistry();
  registry.seed(authorityHtml);
  for (const mode of ["standard", "generative"]) {
    const button = registry.create("button");
    button.setAttribute("data-content-mode", mode);
  }
  const root = registry.element("wordWorldRoot");
  const documentElement = registry.create("html");
  documentElement.dataset.theme = "dark";
  documentElement.dataset.fontSize = "largest";
  documentElement.lang = course.sourceLanguage.locale;
  documentElement.dir = course.sourceLanguage.direction;
  const body = registry.create("body");
  const documentListeners = new Map();
  const document = {
    documentElement,
    body,
    visibilityState: "visible",
    readyState: "complete",
    addEventListener(type, listener) {
      if (!documentListeners.has(type)) documentListeners.set(type, new Set());
      documentListeners.get(type).add(listener);
    },
    removeEventListener(type, listener) { documentListeners.get(type)?.delete(listener); },
    querySelector: (selector) => registry.querySelector(selector),
    querySelectorAll: (selector) => registry.querySelectorAll(selector),
    getElementById: (id) => registry.byId.get(String(id)) || null,
    createElement: (tagName) => registry.create(tagName),
    createElementNS: (_namespace, tagName) => registry.create(tagName)
  };
  const storage = new Map();
  const windowListeners = new Map();
  const nativeSpeechCalls = [];
  const runtime = {
    env: "browser",
    registerServiceWorker: async () => null,
    vector: { search: async () => ({ results: [] }) },
    dictionary: { search: async () => ({ results: [] }) },
    maintenance: {
      enqueueDictionaryGap: async () => false,
      enqueueReport: async () => ({ ok: true })
    }
  };
  const window = {
    CaatuuCourse: course,
    CaatuuRuntime: runtime,
    CaatuuChrome: {
      getSpeechRatePreference: () => "slow",
      getSpeechVoicePreference: () => "",
      speakText(text, options) {
        nativeSpeechCalls.push({ text, options });
        return Promise.resolve({ ok: true });
      },
      stopSpeech: async () => null
    },
    CaatuuLearning: { difficulty: () => 1, record() {} },
    CaatuuSemanticLearning: { recordAttempt: async () => null },
    document,
    location: {
      origin: "https://caatuu.test",
      href: "https://caatuu.test/es-test/",
      search: ""
    },
    localStorage: {
      getItem(key) { return storage.get(key) ?? null; },
      setItem(key, value) { storage.set(key, String(value)); },
      removeItem(key) { storage.delete(key); }
    },
    navigator: { onLine: false, connection: { saveData: true } },
    speechSynthesis: { cancel() {}, getVoices() { return []; } },
    SpeechSynthesisUtterance: class {
      constructor(text) { this.text = text; }
    },
    CustomEvent: class {
      constructor(type, options = {}) {
        this.type = type;
        this.detail = options.detail;
        this.bubbles = options.bubbles === true;
      }
    },
    addEventListener(type, listener) {
      if (!windowListeners.has(type)) windowListeners.set(type, new Set());
      windowListeners.get(type).add(listener);
    },
    removeEventListener(type, listener) { windowListeners.get(type)?.delete(listener); },
    dispatchEvent(event) {
      for (const listener of windowListeners.get(event.type) || []) listener.call(window, event);
    },
    postMessage() {},
    requestAnimationFrame(callback) {
      queueMicrotask(() => callback(performance.now()));
      return 1;
    },
    cancelAnimationFrame() {},
    setTimeout(callback, delay, ...args) {
      return setTimeout(callback, Math.min(2, Number(delay) || 0), ...args);
    },
    clearTimeout,
    matchMedia() { return { matches: true, addEventListener() {}, removeEventListener() {} }; },
    getComputedStyle() { return { getPropertyValue() { return ""; } }; },
    confirm() { return false; }
  };
  globalThis.window = window;
  globalThis.document = document;
  globalThis.location = window.location;
  globalThis.localStorage = window.localStorage;
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: window.navigator });
  globalThis.Image = class {
    set src(_value) { queueMicrotask(() => this.onerror?.(new Error("not loaded in contract"))); }
  };
  globalThis.fetch = async () => new Response("not found", { status: 404 });
  return { registry, root, runtime, nativeSpeechCalls };
}

async function runScenario(name) {
  const speechAndSemantic = name === "speech-and-semantic";
  const capabilities = speechAndSemantic
    ? {
        speech: true,
        generation: false,
        pronunciationGuides: true,
        dictionary: false,
        semanticSearch: true
      }
    : {
        speech: false,
        llm: true,
        generation: true,
        pronunciationGuides: false,
        dictionary: true,
        semanticSearch: false
      };
  const course = syntheticCourse(capabilities);
  const [englishCatalog, authorityHtml] = await Promise.all([
    readFile(new URL("../static/data/english-concepts/word-world-starter-v1.json", import.meta.url), "utf8")
      .then(JSON.parse),
    readFile(new URL("../static/app/index.html", import.meta.url), "utf8")
  ]);
  const realizations = thirdLanguageRealizations(englishCatalog);
  const environment = installBrowserEnvironment(course, authorityHtml);
  globalThis.localStorage.setItem(`${course.storage.namespace}.wordNet.challengePromptMode.v1`, "target");
  const rankerCalls = [];
  let preparedContext = null;
  let rendererSpecifier = "";
  const rendererUrl = new URL("../static/source/product-word-world.mjs", import.meta.url);
  rendererUrl.searchParams.set("third-language", `${name}-${Date.now()}`);
  const controller = await mountWordWorld(environment.root, course, manifest, {
    origin: "https://caatuu.test",
    adapter: spanishAdapter,
    runtime: environment.runtime,
    random: () => 0,
    now: () => 1_700_000_000_000,
    loadJson(url) {
      return String(url).includes("english-concepts")
        ? structuredClone(englishCatalog)
        : structuredClone(realizations);
    },
    embeddingRanker: async (payload) => {
      rankerCalls.push(payload);
      return payload.candidates.map(({ conceptId }) => ({
        conceptId,
        score: conceptId === "ww.object.book" ? 1 : 0
      }));
    },
    fullDictionaryLookup: capabilities.dictionary
      ? async () => null
      : undefined,
    async rendererImport(specifier) {
      rendererSpecifier = specifier;
      const renderer = await import(rendererUrl.href);
      return {
        async mountProductWordWorld(root, context, options) {
          preparedContext = context;
          return renderer.mountProductWordWorld(root, context, options);
        }
      };
    }
  });

  const search = await preparedContext.searchEnglish("book");
  const hello = preparedContext.sessionRecord("ww.greeting.hello");
  const gloss = await preparedContext.lookupMeaning({
    record: hello,
    token: hello.target.tokens[0]
  });
  const segments = preparedContext.segment({ text: "¡Hola, señor!" });
  const sentence = environment.registry.element("wordNetSentence");
  const phraseSound = environment.registry.element("wordNetPhraseSound");
  const wordSound = environment.registry.element("wordNetSelectedWordSound");
  const globalSound = environment.registry.element("wordNetSound");
  const generative = environment.registry.querySelector('[data-content-mode="generative"]');
  const generativeDialog = environment.registry.element("wordNetGenerativeDialog");
  const reconstruction = environment.registry.element("wordNetReconstruction");
  const reconstructionSubmit = environment.registry.element("wordNetReconstructionSubmit");
  if (capabilities.generation) {
    environment.registry.element("wordNetContentSource").dispatchEvent({
      type: "click",
      target: generative
    });
  }
  controller.pause();

  return {
    scenario: name,
    rendererSpecifier,
    providerKind: preparedContext.providerKind,
    adapterId: preparedContext.adapter.id,
    sourceLabel: preparedContext.session.presentation.sourceLabel,
    targetLabel: preparedContext.session.presentation.targetLabel,
    targetLocale: preparedContext.adapter.languageTags.locale,
    targetSpeechLocale: preparedContext.adapter.speech.output.languageTag,
    documentLanguage: globalThis.document.documentElement.lang,
    sentenceLanguage: sentence.getAttribute("lang"),
    sentenceDirection: sentence.getAttribute("dir"),
    sentenceText: sentence.textContent,
    targetCopy: phraseSound.getAttribute("aria-label"),
    segmentSignature: segments.map(({ type, text }) => `${type}:${text}`),
    gloss,
    fullDictionaryAvailable: typeof preparedContext.fullDictionaryLookup === "function",
    speechPolicy: preparedContext.session.policy.speech,
    pronunciationPolicy: preparedContext.session.policy.pronunciationGuides,
    semanticPolicy: preparedContext.session.policy.semanticSearch,
    searchMode: search.mode,
    searchFirst: search.records[0].conceptId,
    rankerCalls: rankerCalls.length,
    speechHidden: [globalSound.hidden, phraseSound.hidden, wordSound.hidden],
    generationHidden: generative?.hidden,
    generationAriaDisabled: generative?.getAttribute("aria-disabled"),
    generativeDialogHidden: generativeDialog.hidden,
    generativeDialogOpen: generativeDialog.open,
    generativeDialogTitle: environment.registry.element("wordNetGenerativeDialogTitle").textContent,
    generativeDialogDescription: environment.registry.element("wordNetGenerativeDialogDescription").textContent,
    reconstructionHidden: reconstruction.hidden,
    reconstructionSubmitDisabled: reconstructionSubmit.disabled
  };
}

async function childScenario(name) {
  try {
    const result = await runScenario(name);
    process.stdout.write(`${RESULT_MARKER}${JSON.stringify(result)}\n`);
    process.exit(0);
  } catch (error) {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exit(1);
  }
}

async function executeScenario(name) {
  const { stdout, stderr } = await execFileAsync(process.execPath, [
    new URL(import.meta.url).pathname,
    CHILD_FLAG,
    name
  ], {
    cwd: new URL("../../..", import.meta.url).pathname,
    timeout: 15_000,
    maxBuffer: 1_000_000
  });
  const line = stdout.split(/\r?\n/u).find((value) => value.startsWith(RESULT_MARKER));
  assert.ok(line, `child did not return a contract result:\n${stdout}\n${stderr}`);
  return JSON.parse(line.slice(RESULT_MARKER.length));
}

if (process.argv[2] === CHILD_FLAG) {
  await childScenario(process.argv[3]);
} else {
  test("a synthetic third language mounts through the real shared provider and renderer", async () => {
    const result = await executeScenario("speech-and-semantic");

    assert.match(result.rendererSpecifier, /^\.\/product-word-world\.mjs\?v=shared-renderer-/u);
    assert.equal(result.providerKind, "authored-realizations");
    assert.equal(result.adapterId, "spanish-test");
    assert.equal(result.sourceLabel, "English");
    assert.equal(result.targetLabel, "Test Spanish");
    assert.equal(result.targetLocale, "es-ES");
    assert.equal(result.targetSpeechLocale, "es-MX");
    assert.equal(result.documentLanguage, "en-US");
    assert.equal(result.sentenceLanguage, "es-ES");
    assert.equal(result.sentenceDirection, "ltr");
    assert.match(result.sentenceText, /^¡Hola,amigo\d+!$/u);
    assert.match(result.targetCopy, /Test Spanish/u);
    assert.deepEqual(result.segmentSignature, [
      "punctuation:¡",
      "word:Hola",
      "punctuation:,",
      "word:señor",
      "punctuation:!"
    ]);
    assert.deepEqual(result.gloss, {
      meaning: "hello (authored)",
      partOfSpeech: "",
      metadata: ""
    });
    assert.equal(result.fullDictionaryAvailable, false);
    assert.equal(result.speechPolicy, true);
    assert.equal(result.pronunciationPolicy, true);
    assert.equal(result.semanticPolicy, true);
    assert.equal(result.searchMode, "embedding");
    assert.equal(result.searchFirst, "ww.object.book");
    assert.equal(result.rankerCalls, 1);
    assert.deepEqual(result.speechHidden, [false, false, false]);
    assert.equal(result.generationHidden, true);
    assert.equal(result.generativeDialogHidden, true);
  });

  test("third-language capabilities gate independently without selecting another renderer", async () => {
    const result = await executeScenario("dictionary-and-generation");

    assert.match(result.rendererSpecifier, /^\.\/product-word-world\.mjs\?v=shared-renderer-/u);
    assert.equal(result.providerKind, "authored-realizations");
    assert.equal(result.adapterId, "spanish-test");
    assert.equal(result.fullDictionaryAvailable, true);
    assert.deepEqual(result.gloss, {
      meaning: "hello (authored)",
      partOfSpeech: "",
      metadata: ""
    }, "authored glosses remain available when the optional full dictionary returns no match");
    assert.equal(result.speechPolicy, false);
    assert.equal(result.pronunciationPolicy, false);
    assert.equal(result.semanticPolicy, false);
    assert.equal(result.searchMode, "lexical");
    assert.equal(result.rankerCalls, 0);
    assert.deepEqual(result.speechHidden, [true, true, true]);
    assert.equal(result.generationHidden, false);
    assert.equal(result.generationAriaDisabled, "true");
    assert.equal(result.generativeDialogHidden, false);
    assert.equal(result.reconstructionHidden, false, "the unfinished reconstruction is visibly active");
    assert.equal(result.reconstructionSubmitDisabled, true, "the reconstruction has not been submitted");
    assert.equal(result.generativeDialogOpen, true, "the disabled prompt wins over the reconstruction advance guard");
    assert.equal(result.generativeDialogTitle, "Generative local AI is disabled");
    assert.equal(
      result.generativeDialogDescription,
      "Local AI is currently disabled in this app. No model will be downloaded or loaded."
    );
    assert.equal(result.sentenceLanguage, "es-ES");
    assert.match(result.targetCopy, /Test Spanish/u);
  });
}
