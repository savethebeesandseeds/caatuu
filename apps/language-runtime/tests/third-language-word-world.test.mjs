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
import { importBrowserLanguageAdapter } from "./browser-module-loader.mjs";
import { FakeRegistry } from "./helpers/fake-browser.mjs";

const execFileAsync = promisify(execFile);
const CHILD_FLAG = "--third-language-scenario";
const RESULT_MARKER = "CAATUU_THIRD_LANGUAGE_RESULT=";
const czechAdapter = await importBrowserLanguageAdapter(
  "../../languages/czech/static/source/language/adapter.mjs"
);

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
    sourceLanguage: { id: "fr", label: "Français", locale: "fr-FR", direction: "ltr" },
    targetLanguage: {
      id: "es",
      label: "Test Spanish",
      nativeLabel: "Español de prueba",
      locale: "es-ES",
      script: "Latn",
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
  learnerBaseLanguage: "fr-FR",
  learnerBaseFile: "third-language-test-v1.learner-base.fr.json",
  recordCount: 250,
  embeddingPolicy: {
    inputLanguage: "en",
    inputField: "embeddingText",
    targetTextAllowed: false,
    modelId: "all-minilm-l6-v2-qint8-v0.1",
    fallback: "deterministic-lexical"
  }
});

function thirdLanguageLearnerBase(englishCatalog) {
  return {
    $schema: "https://caatuu.org/schemas/runtime/learner-base-realizations.runtime.v1.schema.json",
    schemaVersion: 1,
    id: "third-language-test-v1-learner-base-fr",
    baseLanguage: { languageTag: "fr-FR", script: "Latn" },
    derivedFrom: "apps/languages/shared/learner-base-realizations/fr/third-language-test-v1.json",
    sourceCatalog: englishCatalog.derivedFrom,
    review: {
      status: "native-reviewed",
      reviewer: "Synthetic French reviewer",
      reviewedAt: "2026-09-03T00:00:00Z",
      notes: "Synthetic end-to-end renderer contract fixture only."
    },
    license: structuredClone(englishCatalog.license),
    realizations: englishCatalog.concepts.map((concept, index) => ({
      conceptId: concept.id,
      text: concept.id === "ww.greeting.hello"
        ? "Bonjour !"
        : concept.id === "ww.object.book"
          ? "Ceci est un livre."
          : `Phrase française ${index + 1}.`
    }))
  };
}

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
  const semanticAttempts = [];
  const dictionaryGapCalls = [];
  const runtime = {
    env: "browser",
    registerServiceWorker: async () => null,
    vector: { search: async () => ({ results: [] }) },
    dictionary: { search: async () => ({ results: [] }) },
    maintenance: {
      enqueueDictionaryGap: async (payload) => {
        dictionaryGapCalls.push(structuredClone(payload));
        return { queued: true, persisted: true };
      },
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
    CaatuuSemanticLearning: {
      recordAttempt: async (payload) => {
        semanticAttempts.push(structuredClone(payload));
        return null;
      }
    },
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
    speechSynthesis: {
      cancel() {},
      getVoices() { return []; },
      ...(course.capabilities?.speech === true ? { speak() {} } : {})
    },
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
  return { registry, root, runtime, nativeSpeechCalls, semanticAttempts, dictionaryGapCalls };
}

async function runCzechStandardDictionaryGapScenario() {
  const course = Object.freeze({
    id: "cz",
    routePrefix: "/cz",
    sourceLanguage: { id: "en", label: "English", locale: "en", direction: "ltr" },
    targetLanguage: {
      id: "cs",
      label: "Czech",
      nativeLabel: "Čeština",
      locale: "cs-CZ",
      script: "Latn",
      speechLocale: "cs-CZ",
      direction: "ltr"
    },
    capabilities: {
      wordWorld: true,
      embeddings: false,
      semanticSearch: false,
      dictionary: true,
      speech: false,
      pronunciationGuides: false,
      generation: false,
      llm: false,
      chat: false
    },
    dictionaryContent: {
      providerId: "czech-full-dictionary-v1",
      gapReporting: {
        providerId: "czech-full-dictionary-v1",
        dictionaryKey: "kaikki-cs-en-2026-07-09",
        dictionaryDirection: "cs-en"
      }
    },
    languageAdapter: { module: "source/language/adapter.mjs" },
    storage: {
      namespace: "caatuu-czech-gap-test",
      wordWorldTranslationMode: "caatuu-czech-gap-test.wordNet.translationMode",
      wordWorldRecentSentences: "caatuu-czech-gap-test.wordNet.recentSentences",
      wordWorldTranslationCache: "caatuu-czech-gap-test.wordNet.translationCache"
    }
  });
  const record = {
    id: "standard-cat-sleeps",
    cs: "Kočka spí.",
    en: "The cat sleeps.",
    difficulty: 1,
    topic: "daily-life",
    sceneQuery: "a sleeping cat",
    targets: [{ surface: "Kočka", normalized: "kočka", tokenIndex: 0, playable: true }]
  };
  const provider = {
    records: [record],
    corpusVersion: "standard-gap-test-v1",
    usage: { entries: new Map(), get: () => ({ count: 0, lastSeen: 0 }), mark: () => ({ count: 1, lastSeen: 1 }) },
    difficultyCounts: () => ({ 1: 1, 2: 0, 3: 0 }),
    nextRandom: () => ({ record, fallback: false, requestedWord: "" }),
    nextForWord: () => ({ record, fallback: false, requestedWord: "kočka" }),
    primaryWord: () => "Kočka",
    markUsed: () => ({ count: 1, lastSeen: 1 }),
    getRecordById: (id) => id === record.id ? record : null
  };
  const manifest = {
    schemaVersion: "caatuu-word-world-runtime-manifest-v1",
    corpusVersion: "standard-gap-test-v1",
    mode: "standard",
    sessionProvider: { kind: "standard-corpus", module: "unused.mjs" },
    features: { wordMeanings: true },
    embeddingPolicy: {
      inputLanguage: "en",
      inputField: "embeddingText",
      targetTextAllowed: false,
      fallback: "deterministic-lexical"
    }
  };
  const authorityHtml = await readFile(new URL("../static/app/index.html", import.meta.url), "utf8");
  const environment = installBrowserEnvironment(course, authorityHtml);
  globalThis.localStorage.setItem(course.storage.wordWorldTranslationMode, "timer-0");
  let preparedContext = null;
  const rendererUrl = new URL("../static/source/product-word-world.mjs", import.meta.url);
  rendererUrl.searchParams.set("czech-gap", String(Date.now()));
  const controller = await mountWordWorld(environment.root, course, manifest, {
    origin: "https://caatuu.test",
    adapter: czechAdapter,
    runtime: environment.runtime,
    standardProvider: provider,
    embeddingRanker: null,
    meaningSelector: () => null,
    random: () => 0,
    async rendererImport() {
      const renderer = await import(rendererUrl.href);
      return {
        async mountProductWordWorld(root, context, options) {
          preparedContext = context;
          return renderer.mountProductWordWorld(root, context, options);
        }
      };
    }
  });
  await new Promise((resolve) => setTimeout(resolve, 40));
  controller.pause();
  const prepared = preparedContext.sessionRecord(record.id);
  return {
    tokenHasGloss: Object.hasOwn(prepared.target.tokens[0], "gloss"),
    dictionaryGapCalls: environment.dictionaryGapCalls
  };
}

async function runScenario(name) {
  if (name === "czech-standard-dictionary-gap") {
    return runCzechStandardDictionaryGapScenario();
  }
  const speechEnabled = name === "speech-and-semantic" || name === "source-prompt-speech";
  const sourcePrompt = name === "source-prompt-speech";
  const unsupportedGeneration = name === "unsupported-generation";
  const capabilities = speechEnabled
    ? {
        speech: true,
        generation: false,
        pronunciationGuides: true,
        dictionary: false,
        semanticSearch: true
      }
    : {
        speech: false,
        llm: unsupportedGeneration,
        generation: unsupportedGeneration,
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
  const learnerBase = thirdLanguageLearnerBase(englishCatalog);
  const environment = installBrowserEnvironment(course, authorityHtml);
  globalThis.localStorage.setItem(
    `${course.storage.namespace}.wordNet.challengePromptMode.v1`,
    sourcePrompt ? "target" : "source"
  );
  if (name === "speech-and-semantic") {
    globalThis.localStorage.setItem(course.storage.wordWorldTranslationMode, "visible");
  }
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
      const value = String(url);
      if (value.includes("english-concepts")) return structuredClone(englishCatalog);
      if (value.endsWith(manifest.learnerBaseFile)) return structuredClone(learnerBase);
      return structuredClone(realizations);
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
          const mounted = await renderer.mountProductWordWorld(root, context, options);
          if (name === "speech-and-semantic") {
            const record = context.sessionRecord("ww.greeting.hello");
            await context.searchEnglish(renderer.englishAuditSemanticQuery(record));
          }
          return mounted;
        }
      };
    }
  });

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
  const reconstructionBank = environment.registry.element("wordNetReconstructionBank");
  const reconstructionSubmit = environment.registry.element("wordNetReconstructionSubmit");
  await new Promise((resolve) => setTimeout(resolve, 10));
  const initialSpeechCallCount = environment.nativeSpeechCalls.length;
  if (sourcePrompt) {
    phraseSound.click();
    environment.registry.element("wordNetAudioSpeed").dispatchEvent({ type: "change" });
    const autoplay = environment.registry.element("wordNetAudioAutoplay");
    autoplay.click();
    autoplay.click();
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
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
    sentenceLanguage: sentence.lang || sentence.getAttribute("lang"),
    sentenceDirection: sentence.getAttribute("dir"),
    sentenceText: sentence.textContent,
    targetCopy: phraseSound.getAttribute("aria-label"),
    segmentSignature: segments.map(({ type, text }) => `${type}:${text}`),
    gloss,
    fullDictionaryAvailable: typeof preparedContext.fullDictionaryLookup === "function",
    speechPolicy: preparedContext.session.policy.speech,
    pronunciationPolicy: preparedContext.session.policy.pronunciationGuides,
    semanticPolicy: preparedContext.session.policy.semanticSearch,
    searchMode: rankerCalls.length ? "embedding" : "lexical",
    selectedEnglishQuery: rankerCalls[0]?.query?.embeddingText || "",
    semanticAttempts: environment.semanticAttempts,
    dictionaryGapCalls: environment.dictionaryGapCalls,
    rankerCalls: rankerCalls.length,
    initialSpeechCallCount,
    speechCalls: environment.nativeSpeechCalls.map(({ text, options }) => ({
      text,
      locale: options.locale,
      rate: options.rate
    })),
    speechHidden: [globalSound.hidden, phraseSound.hidden, wordSound.hidden],
    generationHidden: generative?.hidden,
    generationAriaDisabled: generative?.getAttribute("aria-disabled"),
    generativeDialogHidden: generativeDialog.hidden,
    generativeDialogOpen: generativeDialog.open,
    generativeDialogTitle: environment.registry.element("wordNetGenerativeDialogTitle").textContent,
    generativeDialogDescription: environment.registry.element("wordNetGenerativeDialogDescription").textContent,
    reconstructionHidden: reconstruction.hidden,
    reconstructionSubmitDisabled: reconstructionSubmit.disabled,
    reconstructionAnswerOptionCount: reconstructionBank.children.filter((button) => (
      button.dataset.reconstructionOptionId?.startsWith("answer-")
    )).length,
    reconstructionDistractorCount: reconstructionBank.children.filter((button) => (
      button.dataset.reconstructionOptionId?.startsWith("distractor-")
    )).length,
    reconstructionOptionTexts: reconstructionBank.children.map((button) => button.textContent)
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
    assert.equal(result.sourceLabel, "Français");
    assert.equal(result.targetLabel, "Test Spanish");
    assert.equal(result.targetLocale, "es-ES");
    assert.equal(result.targetSpeechLocale, "es-MX");
    assert.equal(result.documentLanguage, "fr-FR");
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
    assert.equal(result.rankerCalls, 1);
    assert.ok(result.semanticAttempts.length >= 1);
    assert.equal(result.selectedEnglishQuery, "Hello!", "the renderer must submit the immutable English audit text");
    for (const attempt of result.semanticAttempts) {
      assert.match(attempt.itemId, /^word-world:es-test:third-language-test-v1:ww\./u);
      assert.equal(attempt.item.courseId, "es-test");
      assert.equal(attempt.item.targetLanguageTag, "es-ES");
      assert.match(attempt.item.targetText, /^¡Hola, amigo \d+!$/u);
      assert.ok(attempt.item.englishAuditText);
      assert.equal(attempt.signals[0].conceptId, attempt.item.conceptId);
      assert.equal(attempt.signals[0].locale, "en");
      assert.match(attempt.signals[0].text, /English meaning/u);
      assert.doesNotMatch(JSON.stringify(attempt), /Czech|cz\.word-world|"czech"/iu);
    }
    assert.equal(result.initialSpeechCallCount, 1);
    assert.equal(result.speechCalls.length, 1);
    assert.match(result.speechCalls[0].text, /^¡Hola, amigo \d+!$/u);
    assert.equal(result.speechCalls[0].locale, "es-MX");
    assert.deepEqual(result.speechHidden, [false, false, false]);
    assert.equal(result.generationHidden, true);
    assert.equal(result.generativeDialogHidden, true);
  });

  test("third-language dictionary capability gates independently without selecting another renderer", async () => {
    const result = await executeScenario("dictionary-only");

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
    assert.equal(result.generationHidden, true);
    assert.equal(result.generativeDialogHidden, true);
    assert.equal(result.reconstructionHidden, false, "the unfinished reconstruction is visibly active");
    assert.equal(result.reconstructionSubmitDisabled, true, "the reconstruction has not been submitted");
    assert.equal(result.sentenceLanguage, "fr-FR");
    assert.match(result.sentenceText, /française|Bonjour|Ceci est/u);
    assert.match(result.targetCopy, /Test Spanish/u);
    assert.deepEqual(result.dictionaryGapCalls, [], "undeclared dictionary reporting must fail closed");
  });

  test("a Czech standard-token dictionary miss reaches declared gap reporting", async () => {
    const result = await executeScenario("czech-standard-dictionary-gap");

    assert.equal(result.tokenHasGloss, false, "legacy lookup hints are not authored meanings");
    assert.deepEqual(result.dictionaryGapCalls, [{
      targetWord: "Kočka",
      normalizedWord: "kočka",
      dictionaryKey: "kaikki-cs-en-2026-07-09",
      dictionaryDirection: "cs-en",
      lookupOutcome: "no_results",
      lookupReturned: 0
    }]);
  });

  test("third-language generation fails before the Czech-specific renderer can mount", async () => {
    await assert.rejects(
      executeScenario("unsupported-generation"),
      /without an explicit course-owned versioned strategy/u
    );
  });

  test("non-English learner-base reconstruction stays target-tokenized and never speaks the hidden answer", async () => {
    const result = await executeScenario("source-prompt-speech");

    assert.equal(result.sentenceLanguage, "fr-FR");
    assert.doesNotMatch(result.sentenceText, /¡Hola/u);
    assert.match(result.sentenceText, /française|Bonjour|Ceci est/u);
    assert.deepEqual(result.speechHidden, [false, true, false]);
    assert.equal(result.initialSpeechCallCount, 0, "autoplay must not reveal the target answer");
    assert.deepEqual(
      result.speechCalls,
      [],
      "hidden phrase activation, audio preview, and autoplay re-enable must remain silent"
    );
    assert.ok(result.reconstructionAnswerOptionCount > 0);
    assert.equal(result.reconstructionDistractorCount, 4);
    assert.ok(result.reconstructionOptionTexts.every((text) => (
      !/^(?:I|You|We|He|She|It|The|My|They|This)$/u.test(text)
    )), "English-only fallback distractors must not enter a non-English learner base");
  });
}
