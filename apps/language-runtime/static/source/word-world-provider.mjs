import {
  assertValidLanguageAdapter,
  segmentLanguageText
} from "../../contract.mjs";
import {
  createPreparedWordWorldSession,
  createWordWorldSession
} from "./browser-shell.mjs?v=browser-shell-2";
import {
  createEnglishMiniLmRanker
} from "./english-minilm-ranker.mjs";
import {
  selectEmbeddingRuntime
} from "./embedding-runtime-contract.mjs";

const DEFAULT_EMBEDDING_MODEL = "all-minilm-l6-v2-qint8-v0.1";
const SHARED_EMBEDDING_CATALOG = "/language-runtime/embedding-runtimes.json";
const DEFAULT_ENGLISH_EMBEDDING_POLICY = Object.freeze({
  inputLanguage: "en",
  inputField: "embeddingText",
  targetTextAllowed: false,
  modelId: DEFAULT_EMBEDDING_MODEL,
  fallback: "deterministic-lexical"
});
const LEGACY_STANDARD_PROVIDER_MODULE = "source/games/word-world/word-net-standard.mjs";
const SHARED_STANDARD_MEANING_SELECTOR = "/language-runtime/static/source/word-net-core.mjs";
const DEFAULT_RENDERER_MODULE = "./product-word-world.mjs?v=shared-renderer-8";
const SCENE_NUMBERS = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15, 16, 33]);
const STANDARD_USAGE_CAPACITY = 8192;

async function loadJson(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
    ...options
  });
  if (!response.ok) throw new Error(`Could not load ${url}: ${response.status}`);
  return response.json();
}

function runtimeOrigin(options = {}) {
  const origin = String(options.origin || globalThis.location?.origin || "").replace(/\/$/u, "");
  if (!origin) throw new Error("Word World requires an explicit runtime origin.");
  return origin;
}

function routeUrl(course, path, options = {}) {
  const base = `${runtimeOrigin(options)}${String(course.routePrefix || "").replace(/\/$/u, "")}/`;
  return new URL(String(path || "").replace(/^\.\//u, ""), base).href;
}

async function importModule(specifier) {
  return import(specifier);
}

async function loadLanguageAdapter(course, options = {}) {
  if (options.adapter) return assertValidLanguageAdapter(options.adapter);
  const adapterUrl = routeUrl(course, course.languageAdapter?.module, options);
  const adapterModule = await (options.importModule || importModule)(adapterUrl);
  const adapter = adapterModule.default;
  return assertValidLanguageAdapter(adapter);
}

function assertEnglishEmbeddingBoundary(policy = {}) {
  if (policy.inputLanguage !== "en"
      || policy.inputField !== "embeddingText"
      || policy.targetTextAllowed !== false) {
    throw new Error("Word World embeddings must use authored English embeddingText only.");
  }
}

async function createSharedEnglishRanker(wordWorldManifest, options = {}) {
  const policy = wordWorldManifest.embeddingPolicy || DEFAULT_ENGLISH_EMBEDDING_POLICY;
  assertEnglishEmbeddingBoundary(policy);
  if (Object.hasOwn(options, "embeddingRanker")) {
    if (options.embeddingRanker !== null && typeof options.embeddingRanker !== "function") {
      throw new TypeError("embeddingRanker must be a function or null.");
    }
    return options.embeddingRanker;
  }
  const catalog = await (options.loadJson || loadJson)(SHARED_EMBEDDING_CATALOG);
  const modelId = String(policy.modelId || DEFAULT_EMBEDDING_MODEL);
  const model = selectEmbeddingRuntime(catalog, modelId);
  if (model.inputLanguage !== "en") {
    throw new Error("The selected embedding runtime must accept English only.");
  }
  const createRanker = options.createEmbeddingRanker || createEnglishMiniLmRanker;
  return createRanker(model.runtime);
}

function stableHash(value) {
  const source = String(value ?? "").normalize("NFC");
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

function sceneForRecord(record) {
  const index = stableHash(record.conceptId || record.sceneQuery) % SCENE_NUMBERS.length;
  return {
    src: `/assets/miscellaneous/burrow-review_${String(SCENE_NUMBERS[index]).padStart(3, "0")}.png`,
    alt: record.sceneQuery || record.englishText
  };
}

function englishEmbeddingText(value) {
  const normalized = String(value ?? "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\x20-\x7e]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return /[A-Za-z]/u.test(normalized) ? normalized : "English language learning sentence";
}

function standardTokens(adapter, record) {
  const segments = segmentLanguageText(adapter, record.cs, { record });
  const wordSegments = segments.filter(({ type }) => type === "word");
  return wordSegments.map((segment, index) => {
    const surfaceKey = adapter.normalization.searchKey(segment.text);
    const target = record.targets?.find((candidate) => (
      candidate.tokenIndex === index
      || adapter.normalization.searchKey(candidate.surface) === surfaceKey
    ));
    return {
      surface: segment.text,
      gloss: target ? "Meaning available" : "Look up meaning",
      playable: target?.playable !== false
    };
  });
}

function adaptStandardRecord(adapter, record) {
  return Object.freeze({
    conceptId: record.id,
    englishText: record.en,
    embeddingText: englishEmbeddingText(`${record.en}. ${record.sceneQuery || ""}`),
    sceneQuery: record.sceneQuery || record.en,
    topic: record.topic || "general",
    difficulty: record.difficulty,
    preferredTokenIndex: Number.isInteger(record.targets?.[0]?.tokenIndex)
      ? record.targets[0].tokenIndex
      : 0,
    target: Object.freeze({
      text: record.cs,
      tokens: Object.freeze(standardTokens(adapter, record))
    }),
    sourceRecord: record
  });
}

function recordId(value) {
  const candidate = value && typeof value === "object"
    ? value.id ?? value.conceptId
    : value;
  return String(candidate || "").trim();
}

function requireSelectionProvider(provider) {
  if (!provider || !Array.isArray(provider.records) || provider.records.length === 0) {
    throw new TypeError("Word World selection provider requires records.");
  }
  for (const method of ["difficultyCounts", "nextRandom", "nextForWord", "primaryWord", "markUsed"]) {
    if (typeof provider[method] !== "function") {
      throw new TypeError(`Word World selection provider is missing ${method}().`);
    }
  }
  return provider;
}

function exposeStandardSelectionProvider(provider) {
  requireSelectionProvider(provider);
  return Object.freeze({
    records: provider.records,
    corpusVersion: String(provider.corpusVersion || "unknown"),
    usage: provider.usage || null,
    difficultyCounts: (...args) => provider.difficultyCounts(...args),
    nextRandom: (...args) => provider.nextRandom(...args),
    nextForWord: (...args) => provider.nextForWord(...args),
    primaryWord: (...args) => provider.primaryWord(...args),
    markUsed: (...args) => provider.markUsed(...args),
    getRecordById: typeof provider.getRecordById === "function"
      ? (...args) => provider.getRecordById(...args)
      : (id) => provider.records.find((record) => recordId(record) === recordId(id)) || null,
    selectBoundTarget: typeof provider.selectBoundTarget === "function"
      ? (...args) => provider.selectBoundTarget(...args)
      : null,
    nextForBinding: typeof provider.nextForBinding === "function"
      ? (...args) => provider.nextForBinding(...args)
      : null
  });
}

function validatedUsageSnapshot(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
      || value.version !== 1
      || typeof value.entries !== "object" || value.entries === null || Array.isArray(value.entries)) {
    return {};
  }
  const corpusVersion = String(value.corpusVersion || "").trim();
  if (!corpusVersion) return {};
  const entries = {};
  for (const [rawId, rawValue] of Object.entries(value.entries).slice(0, STANDARD_USAGE_CAPACITY)) {
    const id = String(rawId || "").trim();
    if (!id || id.length > 256 || !Array.isArray(rawValue) || rawValue.length !== 2) continue;
    const count = Number(rawValue[0]);
    const lastSeen = Number(rawValue[1]);
    if (!Number.isFinite(count) || count < 0 || !Number.isFinite(lastSeen) || lastSeen < 0) continue;
    entries[id] = [Math.floor(count), Math.floor(lastSeen)];
  }
  return { version: 1, corpusVersion, entries };
}

function standardUsageEntries(course, options = {}) {
  if (Object.hasOwn(options, "usageEntries")) {
    return validatedUsageSnapshot(options.usageEntries);
  }
  const namespace = String(course.storage?.namespace || "").trim();
  if (!namespace) return {};
  try {
    const storage = Object.hasOwn(options, "storage") ? options.storage : globalThis.localStorage;
    if (typeof storage?.getItem !== "function") return {};
    const stored = storage.getItem(`${namespace}.wordNet.standardUsage.v1`);
    return stored ? validatedUsageSnapshot(JSON.parse(stored)) : {};
  } catch {
    return {};
  }
}

function createUsageLedger(corpusVersion, options = {}) {
  if (options.usage && typeof options.usage.get === "function" && typeof options.usage.mark === "function") {
    return options.usage;
  }
  const stored = options.usageEntries?.entries || options.usageEntries || {};
  const entries = new Map(Object.entries(stored).map(([id, value]) => {
    const tuple = Array.isArray(value) ? value : [value?.count, value?.lastSeen];
    return [id, {
      count: Math.max(0, Math.floor(Number(tuple[0]) || 0)),
      lastSeen: Math.max(0, Math.floor(Number(tuple[1]) || 0))
    }];
  }));
  const now = typeof options.now === "function" ? options.now : () => Date.now();
  return Object.freeze({
    get(id) {
      const value = entries.get(recordId(id)) || { count: 0, lastSeen: 0 };
      return { ...value };
    },
    mark(id) {
      const key = recordId(id);
      if (!key) return { count: 0, lastSeen: 0 };
      const current = entries.get(key) || { count: 0, lastSeen: 0 };
      const next = { count: current.count + 1, lastSeen: Math.max(0, Math.floor(Number(now()) || 0)) };
      entries.set(key, next);
      return { ...next };
    },
    snapshot() {
      return {
        version: 1,
        corpusVersion,
        entries: Object.fromEntries([...entries.entries()].map(([id, value]) => [
          id,
          [value.count, value.lastSeen]
        ]))
      };
    }
  });
}

function authoredSelectionRecord(adapter, record) {
  return Object.freeze({
    id: record.conceptId,
    conceptId: record.conceptId,
    sourceText: record.englishText,
    targetText: record.target.text,
    difficulty: Math.max(1, Math.min(3, Math.floor(Number(record.difficulty) || 1))),
    topic: record.topic || "general",
    targets: Object.freeze(record.target.tokens.map((token, tokenIndex) => Object.freeze({
      surface: token.surface,
      normalized: adapter.normalization.searchKey(token.surface, { record, token, tokenIndex }),
      tokenIndex,
      playable: token.playable !== false,
      gloss: token.gloss
    })))
  });
}

function createAuthoredSelectionProvider(session, manifest, adapter, options = {}) {
  const records = Object.freeze(session.records.map((record) => authoredSelectionRecord(adapter, record)));
  const corpusVersion = String(manifest.corpusVersion || manifest.schemaVersion || "authored");
  const usage = createUsageLedger(corpusVersion, options);
  const random = typeof options.random === "function" ? options.random : Math.random;
  const byId = new Map(records.map((record) => [record.id, record]));
  const choose = (candidates, { difficulty = 3, excludeIds = [], allowExcludedFallback = true } = {}) => {
    const level = Math.max(1, Math.min(3, Math.floor(Number(difficulty) || 1)));
    const eligible = candidates.filter((record) => record.difficulty <= level);
    if (!eligible.length) return null;
    const excluded = new Set((Array.isArray(excludeIds) ? excludeIds : []).map(recordId));
    const unexcluded = eligible.filter((record) => !excluded.has(record.id));
    const available = unexcluded.length ? unexcluded : allowExcludedFallback ? eligible : [];
    if (!available.length) return null;
    const leastCount = Math.min(...available.map((record) => usage.get(record.id).count));
    const leastUsed = available.filter((record) => usage.get(record.id).count === leastCount);
    const oldestSeen = Math.min(...leastUsed.map((record) => usage.get(record.id).lastSeen));
    const oldest = leastUsed
      .filter((record) => usage.get(record.id).lastSeen === oldestSeen)
      .sort((left, right) => left.id.localeCompare(right.id, "en"));
    const index = Math.min(oldest.length - 1, Math.floor(Math.max(0, Number(random()) || 0) * oldest.length));
    return oldest[index] || oldest[0] || null;
  };
  const provider = {
    records,
    corpusVersion,
    usage,
    difficultyCounts() {
      return records.reduce((counts, record) => {
        counts[record.difficulty] = (counts[record.difficulty] || 0) + 1;
        return counts;
      }, { 1: 0, 2: 0, 3: 0 });
    },
    nextRandom(selectionOptions = {}) {
      const record = choose(records, selectionOptions);
      return record ? { record, fallback: false, requestedWord: "" } : null;
    },
    nextForWord(word, { allowRandomFallback = true, ...selectionOptions } = {}) {
      const requestedWord = adapter.normalization.searchKey(word, { purpose: "word-world-selection" });
      const matches = records.filter((record) => record.targets.some((target) => (
        target.playable && target.normalized === requestedWord
      )));
      const exact = choose(matches, { ...selectionOptions, allowExcludedFallback: false });
      if (exact) return { record: exact, fallback: false, requestedWord };
      if (!allowRandomFallback) return null;
      const randomTurn = provider.nextRandom(selectionOptions);
      return randomTurn ? { ...randomTurn, fallback: true, requestedWord } : null;
    },
    primaryWord(record, requestedWord = "") {
      const normalized = adapter.normalization.searchKey(requestedWord, { purpose: "word-world-selection" });
      return record?.targets?.find((target) => target.playable && target.normalized === normalized)?.surface
        || record?.targets?.find((target) => target.playable)?.surface
        || record?.targets?.[0]?.surface
        || "";
    },
    markUsed(recordOrId) {
      return usage.mark(recordId(recordOrId));
    },
    getRecordById(id) {
      return byId.get(recordId(id)) || null;
    }
  };
  return Object.freeze(provider);
}

function languageTools(adapter) {
  return Object.freeze({
    segment(value, context = {}) {
      return segmentLanguageText(adapter, value, context);
    },
    normalization: Object.freeze({
      text: (value, context = {}) => adapter.normalization.text(value, context),
      searchKey: (value, context = {}) => adapter.normalization.searchKey(value, context),
      answerKey: (value, context = {}) => adapter.normalization.answerKey(value, context)
    })
  });
}

function authoredGlossLookup({ token } = {}) {
  const meaning = String(token?.gloss || "").normalize("NFC").trim();
  return meaning ? { meaning, partOfSpeech: "", metadata: "" } : null;
}

function createFullDictionaryLookup(course, adapter, meaningSelector, runtime) {
  const dictionary = runtime?.dictionary;
  if (course.capabilities?.dictionary !== true
      || !dictionary?.search
      || typeof meaningSelector !== "function") return null;
  return async ({ token }) => {
    const payload = await dictionary.search(token.surface, { limit: 8 });
    const result = meaningSelector(payload, token.surface, { maxGlosses: 2 });
    if (!result) return null;
    const metadata = [];
    if (result.lemma && adapter.normalization.searchKey(result.lemma)
        !== adapter.normalization.searchKey(token.surface)) metadata.push(`lemma ${result.lemma}`);
    if (result.formTags?.length) metadata.push(result.formTags.slice(0, 3).join(" ").replaceAll("-", " "));
    return {
      meaning: result.meaning,
      partOfSpeech: result.pos || "",
      metadata: metadata.join(" · ")
    };
  };
}

function meaningLookup(fullDictionaryLookup) {
  return async (request) => {
    const authored = authoredGlossLookup(request);
    if (!fullDictionaryLookup) return authored;
    try {
      return await fullDictionaryLookup(request) || authored;
    } catch {
      return authored;
    }
  };
}

async function createAuthoredContext(course, manifest, adapter, options) {
  const origin = runtimeOrigin(options);
  const manifestUrl = routeUrl(course, "data/games/word-world/manifest.json", options);
  const conceptUrl = new URL(manifest.sourceConceptCatalog, origin).href;
  const realizationUrl = new URL(manifest.realizationFile, manifestUrl).href;
  const [conceptCatalog, realizationCatalog, embeddingRanker] = await Promise.all([
    (options.loadJson || loadJson)(conceptUrl),
    (options.loadJson || loadJson)(realizationUrl),
    createSharedEnglishRanker(manifest, options)
  ]);
  const session = createWordWorldSession({
    course,
    conceptCatalog,
    realizationCatalog,
    adapter,
    embeddingRanker,
    features: {
      wordMeanings: manifest.features?.wordMeanings === true,
      contentProvider: "authored-realizations"
    }
  });
  const selectionProvider = createAuthoredSelectionProvider(session, manifest, adapter, options);
  const byId = new Map(session.records.map((record) => [record.conceptId, record]));
  const fullDictionaryLookup = typeof options.fullDictionaryLookup === "function"
    && course.capabilities?.dictionary === true
    ? options.fullDictionaryLookup
    : null;
  return {
    session,
    selectionProvider,
    sessionRecord: (id) => byId.get(recordId(id)) || null,
    fullDictionaryLookup,
    generate: null
  };
}

async function createStandardContext(course, manifest, adapter, options) {
  const providerConfig = manifest.sessionProvider || {};
  let provider = options.standardProvider || null;
  if (!provider) {
    const providerModuleUrl = routeUrl(
      course,
      providerConfig.module || LEGACY_STANDARD_PROVIDER_MODULE,
      options
    );
    const providerModule = await (options.importModule || importModule)(providerModuleUrl);
    if (typeof providerModule.loadStandardWordWorldCorpus !== "function") {
      throw new Error("The standard Word World provider is missing its corpus loader.");
    }
    const manifestUrl = routeUrl(course, "data/games/word-world/manifest.json", options);
    provider = await providerModule.loadStandardWordWorldCorpus({
      manifestUrl,
      usageEntries: standardUsageEntries(course, options),
      now: options.now,
      random: options.random
    });
  }
  requireSelectionProvider(provider);
  const embeddingRanker = await createSharedEnglishRanker(manifest, options);
  const adaptedById = new Map(provider.records.map((record) => [
    record.id,
    adaptStandardRecord(adapter, record)
  ]));
  const records = [...adaptedById.values()];
  const session = createPreparedWordWorldSession({
    course,
    adapter,
    records,
    review: { status: manifest.reviewStatus || "course-reviewed" },
    embeddingRanker,
    features: {
      wordMeanings: manifest.features?.wordMeanings === true || course.capabilities?.dictionary === true,
      contentProvider: "standard-corpus"
    }
  });

  let meaningSelector = null;
  const meaningSelectorModule = providerConfig.meaningSelectorModule
    || SHARED_STANDARD_MEANING_SELECTOR;
  if (typeof options.meaningSelector === "function") {
    meaningSelector = options.meaningSelector;
  } else if (meaningSelectorModule && course.capabilities?.dictionary === true) {
    const selectorModule = await (options.importModule || importModule)(
      routeUrl(course, meaningSelectorModule, options)
    );
    meaningSelector = selectorModule.selectDictionaryMeaning;
  }
  const runtime = Object.hasOwn(options, "runtime") ? options.runtime : globalThis.CaatuuRuntime;
  const fullDictionaryLookup = createFullDictionaryLookup(course, adapter, meaningSelector, runtime);
  const selectionProvider = exposeStandardSelectionProvider(provider);
  return {
    session,
    selectionProvider,
    sessionRecord: (id) => adaptedById.get(recordId(id)) || null,
    fullDictionaryLookup,
    generate({ mode, token }) {
      const turn = mode === "selected"
        ? provider.nextForWord(token?.surface || "", { difficulty: 3 })
        : provider.nextRandom({ difficulty: 3 });
      return turn ? adaptedById.get(turn.record.id) : null;
    }
  };
}

async function saveReport({ courseId, record, reason, comment }, runtime = globalThis.CaatuuRuntime) {
  const enqueue = runtime?.maintenance?.enqueueReport;
  if (typeof enqueue !== "function") {
    console.info("Word World report", { courseId, conceptId: record.conceptId, reason, hasComment: Boolean(comment) });
    return { ok: true };
  }
  const feedback = {
    kind: "word_world_sentence",
    reason,
    comment,
    sentence: record.target.text,
    translation: record.englishText,
    entryId: record.conceptId,
    contentMode: record.sourceRecord ? "standard" : "authored"
  };
  return enqueue({
    kind: "word_world_sentence_feedback",
    title: "Word World sentence feedback",
    message: `${reason}: ${record.target.text}`,
    feedback
  });
}

/**
 * Prepares one language-neutral provider context. It exposes the complete
 * selection/search/meaning seam without mounting or owning learner-facing UI.
 */
export async function prepareWordWorldContext(course, manifest, options = {}) {
  if (!course || course.capabilities?.wordWorld !== true) {
    throw new Error("Word World is unavailable for this course.");
  }
  if (!manifest || typeof manifest !== "object") {
    throw new TypeError("Word World manifest must be an object.");
  }
  const adapter = await loadLanguageAdapter(course, options);
  const providerKind = String(manifest.sessionProvider?.kind || manifest.mode || "");
  const prepared = providerKind === "standard-corpus" || providerKind === "standard"
    ? await createStandardContext(course, manifest, adapter, options)
    : providerKind === "authored-realizations" || providerKind === "authored"
      ? await createAuthoredContext(course, manifest, adapter, options)
      : null;
  if (!prepared) throw new Error(`Unsupported Word World content provider: ${providerKind || "<missing>"}.`);
  const tools = languageTools(adapter);
  const lookupMeaning = meaningLookup(prepared.fullDictionaryLookup);
  const runtime = Object.hasOwn(options, "runtime") ? options.runtime : globalThis.CaatuuRuntime;
  const policy = manifest.embeddingPolicy || DEFAULT_ENGLISH_EMBEDDING_POLICY;
  assertEnglishEmbeddingBoundary(policy);
  return Object.freeze({
    providerKind,
    session: prepared.session,
    selectionProvider: prepared.selectionProvider,
    sessionRecord: prepared.sessionRecord,
    adapter,
    segment: tools.segment,
    normalization: tools.normalization,
    lookupMeaning,
    fullDictionaryLookup: prepared.fullDictionaryLookup,
    report: (payload) => saveReport(payload, runtime),
    sceneForRecord,
    searchEnglish: (queryEmbeddingText) => prepared.session.searchWithStatus(queryEmbeddingText),
    embeddingPolicy: Object.freeze({ ...policy }),
    generate: prepared.generate
  });
}

async function resolveRenderer(options = {}) {
  if (Object.hasOwn(options, "mountRenderer")) {
    if (typeof options.mountRenderer !== "function") {
      throw new TypeError("mountRenderer must be a function.");
    }
    return options.mountRenderer;
  }
  const rendererModule = await (options.rendererImport || options.importModule || importModule)(
    options.rendererModule || DEFAULT_RENDERER_MODULE
  );
  if (typeof rendererModule.mountProductWordWorld !== "function") {
    throw new Error("The selected Word World renderer does not export mountProductWordWorld().");
  }
  return rendererModule.mountProductWordWorld;
}

/**
 * The only public Word World mount. Provider preparation is renderer-neutral;
 * the selected authoritative renderer is imported lazily and may be replaced
 * without moving course or language policy into the UI layer.
 */
export async function mountWordWorld(root, course, manifest, options = {}) {
  if (!root) throw new Error("Word World root is missing.");
  const context = await prepareWordWorldContext(course, manifest, options);
  const mountRenderer = await resolveRenderer(options);
  return mountRenderer(root, context, {
    ...(options.rendererOptions || {}),
    providerContext: context,
    sceneForRecord: context.sceneForRecord,
    lookupMeaning: context.lookupMeaning,
    generate: context.generate,
    report: context.report
  });
}

export default mountWordWorld;
