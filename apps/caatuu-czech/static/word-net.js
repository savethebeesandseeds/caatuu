import {
  cleanTranslation,
  interpretHorizontalSwipe,
  isMiscellaneousAssetPath,
  isPlausibleSentence,
  isRecentSentence,
  normalizeWord,
  parseSceneKeymap,
  selectDictionaryMeaning,
  sentenceFingerprint,
  sentenceIncludesWord,
  sentenceTargets,
  stripModelEcho,
  tokenizeCzechSentence,
  wordMatchesTarget
} from "./word-net-core.mjs?v=word-net-core-10";
import { WordNetBranchQueue } from "./word-net-queue.mjs?v=word-net-queue-5";

const WORD_NET_MODEL_KEY = "cstinyllama-1.2b-czech-word-sentence-001";
const TRANSLATION_MODEL_KEY = "qwen3-1.7b-translation-cs-en-001";
const SCENE_KEYMAP_URL = "/assets/miscellaneous/keymap.json";
const ROBOT_KEYMAP_URL = "/assets/robots/keymap.json";
const SCENE_ASSET_LIMIT = 5;
const course = window.CaatuuCourse;
if (!course) throw new Error("Caatuu course profile must load before Word World.");
const targetLocale = course.targetLanguage.locale;
const TRANSLATION_MODE_STORAGE_KEY = course.storage.wordWorldTranslationMode;
const GENERATION_MODE_STORAGE_KEY = `${course.storage.namespace}.wordNet.generationMode`;
const PREPARED_QUEUE_STORAGE_KEY = `${course.storage.namespace}.wordNet.preparedQueue.v2`;
const HISTORY_STORAGE_KEY = `${course.storage.namespace}.wordNet.history.v1`;
const RECENT_SENTENCES_STORAGE_KEY = course.storage.wordWorldRecentSentences;
const TRANSLATION_CACHE_STORAGE_KEY = course.storage.wordWorldTranslationCache;
const RECENT_SENTENCE_LIMIT = 48;
const HISTORY_LIMIT = 256;
const PREPARED_QUEUE_CAPACITY = 512;
const QUEUE_RECENT_AVOID_LIMIT = 6;
const WORD_MEANING_CACHE_LIMIT = 64;
const PREFETCH_IDLE_DELAY_MS = 500;
const PREFETCH_BETWEEN_DELAY_MS = 900;
const PREFETCH_PER_TURN = 12;
const PREFETCH_FRESH_TARGET = 24;
const PREFETCH_BATTERY_TARGET = 12;
const PREFETCH_PER_WORD = 3;
const PREFETCH_TRANSLATION_BATCH_SIZE = 5;
const MIN_SENTENCE_TRANSITION_MS = 800;
const LOADING_FADE_MS = 240;
const PREFETCH_STOPWORDS = new Set([
  "a", "ale", "do", "i", "je", "jsou", "k", "na", "ne", "o", "od", "po", "pro", "se", "si", "s", "u", "v", "ve", "z", "za", "že"
]);
const translationModes = {
  off: { label: "Off", delayMs: null },
  "timer-5": { label: "5s", delayMs: 5000 },
  "timer-10": { label: "10s", delayMs: 10000 },
  "timer-30": { label: "30s", delayMs: 30000 },
  visible: { label: "Visible", delayMs: 0 }
};
const generationModes = {
  random: { label: "Random" },
  selected: { label: "Selected word" }
};

const playInstruction = "Use the side arrows or swipe to move between sentences. Tap any word for its meaning.";

const seedWords = [
  "dům",
  "škola",
  "máma",
  "táta",
  "pes",
  "kočka",
  "voda",
  "jablko",
  "kniha",
  "kamarád",
  "město",
  "zahrada",
  "hra",
  "slunce",
  "stůl",
  "vlak",
  "ruka",
  "okno",
  "les",
  "dítě"
];

const fallbackTemplates = [
  (word) => `Ve větě se objevuje slovo „${word}“.`,
  (word) => `Dnes zkoumáme slovo „${word}“.`,
  (word) => `Slovo „${word}“ patří do našeho příběhu.`,
  (word) => `Na kartě je napsáno „${word}“.`,
  (word) => `Hra nám ukazuje slovo „${word}“.`,
  (word) => `Učitel dnes vysvětluje slovo „${word}“.`,
  (word) => `V příběhu jsme našli slovo „${word}“.`,
  (word) => `Dítě si zapisuje slovo „${word}“.`,
  (word) => `Na tabuli vidíme slovo „${word}“.`,
  (word) => `Kamarád se ptá na význam slova „${word}“.`
];

const seedEnglish = {
  dům: "house",
  škola: "school",
  máma: "mom",
  táta: "dad",
  pes: "dog",
  kočka: "cat",
  voda: "water",
  jablko: "apple",
  kniha: "book",
  kamarád: "friend",
  město: "city",
  zahrada: "garden",
  hra: "game",
  slunce: "sun",
  stůl: "table",
  vlak: "train",
  ruka: "hand",
  okno: "window",
  les: "forest",
  dítě: "child"
};

const state = {
  busy: false,
  currentWord: "",
  selectedWord: "",
  selectedWordMeaning: "",
  selectedWordDetails: null,
  wordMeaningLoading: false,
  wordMeaningCache: new Map(),
  wordLookupController: null,
  wordLookupRequestId: 0,
  currentSentence: "",
  currentTranslation: "",
  translationMode: loadTranslationMode(),
  generationMode: loadGenerationMode(),
  translationVisible: true,
  translationTimerId: 0,
  sceneAssetRowsPromise: null,
  sceneCandidates: [],
  sceneRequestId: 0,
  history: loadHistory(),
  historyCursor: 0,
  swipeStart: null,
  recentSentences: loadRecentSentences(),
  translationCache: loadTranslationCache(),
  branchQueue: new WordNetBranchQueue({
    capacity: PREPARED_QUEUE_CAPACITY,
    freshReserve: PREFETCH_FRESH_TARGET,
    normalizeKey: normalizeWord,
    sentenceKey: sentenceFingerprint,
    entries: loadPreparedQueue()
  }),
  phraseRequestId: 0,
  currentGenerationSource: "",
  backgroundController: null,
  backgroundActivity: "",
  prefetchTimerId: 0,
  prefetchBudget: 0,
  prefetchSourceSentence: "",
  prefetchAttemptedWords: new Map(),
  prefetchGeneratedSinceTranslation: 0,
  batteryPromise: null,
  robotRowsPromise: null,
  robotRequestId: 0,
  robotCursor: 0,
  loadingHideTimerId: 0,
  feedbackSnapshot: null,
  feedbackReportedKey: ""
};

const $ = (selector) => document.querySelector(selector);

function runtimeAdapter() {
  return window.CaatuuRuntime || null;
}

function randomItem(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function readStoredArray(key, { session = false } = {}) {
  try {
    const storage = session ? window.sessionStorage : window.localStorage;
    const value = JSON.parse(storage.getItem(key) || "[]");
    return Array.isArray(value) ? value : [];
  } catch (error) {
    return [];
  }
}

function loadHistory() {
  const seen = new Set();
  return readStoredArray(HISTORY_STORAGE_KEY)
    .map((entry) => ({
      word: normalizeWord(entry?.word),
      sentence: String(entry?.sentence || "").normalize("NFC").trim().slice(0, 180)
    }))
    .filter((entry) => {
      const fingerprint = sentenceFingerprint(entry.sentence);
      if (!entry.word || !fingerprint || seen.has(fingerprint)) return false;
      seen.add(fingerprint);
      return true;
    })
    .slice(0, HISTORY_LIMIT);
}

function saveHistory() {
  try {
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(state.history.slice(0, HISTORY_LIMIT)));
  } catch (error) {
    // Phrase history remains available for the current session.
  }
}

function loadPreparedQueue() {
  try {
    const value = JSON.parse(localStorage.getItem(PREPARED_QUEUE_STORAGE_KEY) || "null");
    const entries = Array.isArray(value)
      ? value
      : value?.version === 2
        ? value.entries
        : [];
    return Array.isArray(entries) ? entries.slice(-PREPARED_QUEUE_CAPACITY * 2) : [];
  } catch (error) {
    return [];
  }
}

function savePreparedQueue() {
  try {
    // Merge first so an older browser tab cannot erase candidates saved by a newer one.
    state.branchQueue.restore(loadPreparedQueue());
    localStorage.setItem(PREPARED_QUEUE_STORAGE_KEY, JSON.stringify({
      version: 2,
      savedAt: Date.now(),
      entries: state.branchQueue.snapshot()
    }));
  } catch (error) {
    // The in-memory pool still works when persistent storage is unavailable.
  }
}

function loadRecentSentences() {
  return readStoredArray(RECENT_SENTENCES_STORAGE_KEY)
    .map((value) => String(value || "").slice(0, 180))
    .filter(Boolean)
    .slice(0, RECENT_SENTENCE_LIMIT);
}

function saveRecentSentences() {
  try {
    localStorage.setItem(RECENT_SENTENCES_STORAGE_KEY, JSON.stringify(state.recentSentences));
  } catch (error) {
    // Recent phrases remain useful in memory when storage is unavailable.
  }
}

function loadTranslationCache() {
  const rows = readStoredArray(TRANSLATION_CACHE_STORAGE_KEY, { session: true });
  return new Map(rows
    .filter((row) => Array.isArray(row) && row.length === 2)
    .slice(-24));
}

function saveTranslationCache() {
  try {
    sessionStorage.setItem(
      TRANSLATION_CACHE_STORAGE_KEY,
      JSON.stringify([...state.translationCache.entries()].slice(-24))
    );
  } catch (error) {
    // Translation caching is a session optimization, not required state.
  }
}

function generationAvoidList() {
  return [
    ...state.recentSentences,
    ...state.branchQueue.values().map((item) => item.sentence)
  ].filter(Boolean);
}

function queueAvoidFingerprints() {
  return [...new Set([
    sentenceFingerprint(state.currentSentence),
    ...state.history
      .slice(0, QUEUE_RECENT_AVOID_LIMIT)
      .map((entry) => sentenceFingerprint(entry.sentence))
  ])].filter(Boolean);
}

function queueWordsForSentence(word, sentence) {
  return [
    normalizeWord(word),
    ...sentenceTargets(sentence, { limit: 14 })
  ].filter(Boolean);
}

function rememberPreparedCandidate(word, candidate, { used = false } = {}) {
  const sentence = String(candidate?.sentence || "").normalize("NFC").trim();
  if (!sentence) return false;
  const added = state.branchQueue.put(word, {
    sentence,
    translation: String(candidate?.translation || "").normalize("NFC").trim(),
    source: candidate?.originalSource || candidate?.source || "unknown",
    words: queueWordsForSentence(word, sentence),
    useCount: used ? Math.max(1, Number(candidate?.useCount) || 0) : Number(candidate?.useCount) || 0,
    lastUsedAt: used ? Math.max(Date.now(), Number(candidate?.lastUsedAt) || 0) : Number(candidate?.lastUsedAt) || 0
  });
  savePreparedQueue();
  syncDiagnostics();
  return added;
}

function hydrateQueueFromHistory() {
  let changed = false;
  for (const entry of [...state.history].reverse()) {
    const added = state.branchQueue.put(entry.word, {
      sentence: entry.sentence,
      source: "history",
      words: queueWordsForSentence(entry.word, entry.sentence),
      useCount: 1
    });
    changed ||= added;
  }
  if (changed) savePreparedQueue();
}

function wordNetPrompt(word, { attempt = 0 } = {}) {
  const variations = [
    "Popiš konkrétní každodenní děj.",
    "Použij jiný slovesný děj a přirozený kontext.",
    "Napiš živou, ale jednoduchou větu z běžného života."
  ];
  const avoid = generationAvoidList().slice(0, 5).map((sentence) => `- ${sentence}`).join("\n");
  return [
    `Cíl: ${word}`,
    "Napiš jednu krátkou běžnou českou větu, která přirozeně použije cílové slovo nebo jeho správný tvar.",
    variations[Math.min(attempt, variations.length - 1)],
    avoid ? `Neopakuj tyto nedávné věty:\n${avoid}` : "",
    "Nevysvětluj. Vrať pouze větu.",
    "Věta:"
  ].filter(Boolean).join("\n");
}

function translationPrompt(sentence) {
  return `Translate this Czech sentence into simple English.\nReturn only the English sentence.\nCzech: ${sentence}\nEnglish:`;
}

function nativeWordNetRuntimeAvailable() {
  const runtime = runtimeAdapter();
  if (!runtime?.models?.generate) return false;
  return runtime.env === "android";
}

function nativeTranslationRuntimeAvailable() {
  const runtime = runtimeAdapter();
  if (!runtime?.models?.generate) return false;
  return runtime.env === "android";
}

function localSentence(word, recentSentences = state.recentSentences) {
  const candidates = fallbackTemplates.map((template) => template(word));
  return candidates.find((sentence) => !isRecentSentence(sentence, recentSentences)) || randomItem(candidates);
}

function englishWordFor(word) {
  const normalized = normalizeWord(word).toLocaleLowerCase(targetLocale);
  const key = seedWords.find((seed) => wordMatchesTarget(normalized, seed)) || normalized;
  return seedEnglish[key] || key || "word";
}

function fallbackWordMeaning(word) {
  const normalized = normalizeWord(word).toLocaleLowerCase(targetLocale);
  const key = seedWords.find((seed) => wordMatchesTarget(normalized, seed)) || normalized;
  return seedEnglish[key] || "";
}

function localTranslation(sentence, word) {
  const english = englishWordFor(word);
  const capitalEnglish = english.charAt(0).toLocaleUpperCase("en-US") + english.slice(1);
  if (/^Vidím\s/i.test(sentence)) return `I see ${english} at home.`;
  if (/^Dnes máme\s/i.test(sentence)) return `Today we have ${english} in the game.`;
  if (/^Malé dítě říká\s/i.test(sentence)) return `A small child says ${english}.`;
  if (/^Ve škole slyším\s/i.test(sentence)) return `At school I hear ${english}.`;
  if (sentence.includes(" je tady")) return `${capitalEnglish} is here.`;
  return `A sentence with ${english}.`;
}

function setStatus(message, { tone = "muted" } = {}) {
  const status = $("#wordNetStatus");
  const panel = $(".word-net-status-panel");
  if (status) status.textContent = message;
  if (panel) panel.dataset.tone = tone;
  syncDiagnostics();
}

function diagnosticsPhase() {
  if (state.busy) return "generating";
  if (state.backgroundActivity === "translation") return "translating";
  if (state.backgroundActivity === "translation-batch") return "translating queue";
  if (state.backgroundActivity === "prefetch") return "prefetching";
  if (state.prefetchTimerId) return "prefetch queued";
  return state.currentSentence ? "ready" : "starting";
}

function diagnosticsModel(phase) {
  if (runtimeAdapter()?.env !== "android") return "browser fallback";
  if (phase === "translating" || phase === "translating queue") return "Czech → English Qwen";
  return "Word Sentence CZ";
}

function diagnosticsSource() {
  const labels = {
    "browser-fallback": "browser fallback",
    "error-fallback": "error fallback",
    "validated-fallback": "validated fallback",
    "saved-queue": "saved queue",
    native: "native model",
    history: "history"
  };
  return labels[state.currentGenerationSource] || state.currentGenerationSource || "—";
}

function syncDiagnostics() {
  const phase = diagnosticsPhase();
  const runtime = runtimeAdapter()?.env === "android" ? "android" : "browser";
  const queueSize = state.branchQueue.size;
  const queueFresh = state.branchQueue.freshSize;
  const queueCapacity = state.branchQueue.capacity;
  const mode = generationModes[state.generationMode]?.label || generationModes.random.label;
  const history = state.historyCursor
    ? `${state.history.length} · back ${state.historyCursor}`
    : String(state.history.length);
  const values = {
    wordNetMetaPhase: phase,
    wordNetMetaModel: diagnosticsModel(phase),
    wordNetMetaQueue: `${queueFresh} fresh · ${queueSize} saved`,
    wordNetMetaMode: mode,
    wordNetMetaSource: diagnosticsSource(),
    wordNetMetaHistory: history
  };
  for (const [id, value] of Object.entries(values)) {
    const node = document.getElementById(id);
    if (node) node.textContent = value;
  }
  const summary = $("#wordNetDiagnosticsSummary");
  if (summary) summary.textContent = `${phase} · ${runtime} · queue ${queueFresh}/${queueSize} · cap ${queueCapacity}`;
}

function loadTranslationMode() {
  try {
    const value = localStorage.getItem(TRANSLATION_MODE_STORAGE_KEY);
    if (hasTranslationMode(value)) return value;
  } catch (error) {
    // Ignore storage failures and use the default.
  }
  // Batched queue enrichment limits model swaps, so English can be ready by
  // default while an explicit Off choice still disables translation work.
  return "visible";
}

function loadGenerationMode() {
  try {
    const value = localStorage.getItem(GENERATION_MODE_STORAGE_KEY);
    if (hasGenerationMode(value)) return value;
  } catch (error) {
    // Generation mode is a convenience setting; storage is optional.
  }
  return "random";
}

function hasTranslationMode(mode) {
  return Object.prototype.hasOwnProperty.call(translationModes, mode);
}

function hasGenerationMode(mode) {
  return Object.prototype.hasOwnProperty.call(generationModes, mode);
}

function saveTranslationMode() {
  try {
    localStorage.setItem(TRANSLATION_MODE_STORAGE_KEY, state.translationMode);
  } catch (error) {
    // Translation timing is a convenience setting; storage is optional.
  }
}

function saveGenerationMode() {
  try {
    localStorage.setItem(GENERATION_MODE_STORAGE_KEY, state.generationMode);
  } catch (error) {
    // Generation mode remains available for the current session.
  }
}

function clearTranslationTimer() {
  if (!state.translationTimerId) return;
  window.clearTimeout(state.translationTimerId);
  state.translationTimerId = 0;
}

function closeTranslationMenu() {
  const menu = $("#wordNetTranslationMenu");
  const button = $("#wordNetTranslationToggle");
  if (menu) menu.hidden = true;
  if (button) button.setAttribute("aria-expanded", "false");
}

function toggleTranslationMenu() {
  const menu = $("#wordNetTranslationMenu");
  const button = $("#wordNetTranslationToggle");
  if (!menu || !button) return;
  const nextHidden = !menu.hidden;
  menu.hidden = nextHidden;
  button.setAttribute("aria-expanded", nextHidden ? "false" : "true");
}

function closeGenerationMenu() {
  const menu = $("#wordNetGenerationMenu");
  const button = $("#wordNetGenerationToggle");
  if (menu) menu.hidden = true;
  if (button) button.setAttribute("aria-expanded", "false");
}

function toggleGenerationMenu() {
  const menu = $("#wordNetGenerationMenu");
  const button = $("#wordNetGenerationToggle");
  if (!menu || !button) return;
  const nextHidden = !menu.hidden;
  menu.hidden = nextHidden;
  button.setAttribute("aria-expanded", nextHidden ? "false" : "true");
}

function syncTranslationMenu() {
  document.querySelectorAll("[data-translation-mode]").forEach((button) => {
    const selected = button.dataset.translationMode === state.translationMode;
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-checked", selected ? "true" : "false");
  });
}

function syncGenerationControl() {
  const button = $("#wordNetGenerationToggle");
  const icon = $("#wordNetGenerationIcon");
  const mode = hasGenerationMode(state.generationMode) ? state.generationMode : "random";
  if (mode !== state.generationMode) state.generationMode = mode;
  const config = generationModes[mode];
  icon?.querySelectorAll("[data-generation-icon]").forEach((generationIcon) => {
    generationIcon.toggleAttribute("hidden", generationIcon.dataset.generationIcon !== mode);
  });
  if (button) {
    button.disabled = state.busy;
    button.setAttribute("aria-label", `Generation options. Current: ${config.label}.`);
    button.setAttribute("title", `Generation: ${config.label}`);
  }
  document.querySelectorAll("[data-generation-mode]").forEach((option) => {
    const optionMode = option.dataset.generationMode;
    const selected = optionMode === mode;
    option.classList.toggle("is-selected", selected);
    option.setAttribute("aria-checked", selected ? "true" : "false");
    option.disabled = state.busy || (optionMode === "selected" && !normalizeWord(state.selectedWord));
  });
  syncDiagnostics();
}

function setGenerationMode(mode) {
  if (!hasGenerationMode(mode)) return;
  state.generationMode = mode;
  saveGenerationMode();
  syncGenerationControl();
  closeGenerationMenu();
}

function generateFromConfiguredMode(mode = state.generationMode) {
  if (state.busy) return;
  if (mode === "selected") {
    const selectedWord = normalizeWord(state.selectedWord);
    if (!selectedWord) {
      setStatus("Tap a word before using selected-word generation.", { tone: "muted" });
      return;
    }
    void generateSentenceForWord(selectedWord, { source: "choice" });
    return;
  }
  void generateRandomPhrase({ source: "seed" });
}

function takeQueuedRandomCandidate() {
  const queued = state.branchQueue.takeAny({
    preferredWords: seedWords,
    excludeWords: [state.currentWord],
    excludeFingerprints: queueAvoidFingerprints()
  });
  if (queued) {
    savePreparedQueue();
    syncDiagnostics();
  }
  return queued;
}

async function generateRandomPhrase({ source = "seed" } = {}) {
  if (state.busy) return;
  const queued = takeQueuedRandomCandidate();
  if (!queued) {
    await generateSentenceForWord(freshSeedWord(), { source });
    return;
  }

  cancelBackgroundWork({ preservePrefetch: state.translationMode === "off" });
  const target = normalizeWord(queued.word) || freshSeedWord();
  state.currentWord = target;
  selectWord(target, { lookup: state.translationMode !== "off" });
  setTranslation("");
  hideSceneAsset({ cancel: true });
  const transitionStartedAt = performance.now();
  setBusy(true);
  setProgress(null);
  setStatus("Ready from the saved sentence queue.", { tone: "active" });
  await holdSentenceTransition(transitionStartedAt);
  showPreparedPhrase(target, queued);
}

function applyTranslationMode({ restartTimer = false } = {}) {
  clearTranslationTimer();

  const mode = hasTranslationMode(state.translationMode) ? state.translationMode : "visible";
  if (mode !== state.translationMode) state.translationMode = mode;

  state.translationVisible = mode === "visible";
  if (restartTimer && translationModes[mode].delayMs && state.currentTranslation) {
    state.translationTimerId = window.setTimeout(() => {
      state.translationTimerId = 0;
      state.translationVisible = true;
      syncTranslationToggle();
    }, translationModes[mode].delayMs);
  }

  syncTranslationToggle();
}

function setTranslationMode(mode) {
  if (!hasTranslationMode(mode)) return;
  cancelBackgroundWork();
  state.translationMode = mode;
  saveTranslationMode();
  applyTranslationMode({ restartTimer: true });
  closeTranslationMenu();
  if (mode === "off") {
    abortWordLookup();
  } else if (state.selectedWord && !state.selectedWordMeaning) {
    void lookupSelectedWord(state.selectedWord);
  }
  if (mode !== "off" && !state.busy && state.currentSentence && !state.currentTranslation) {
    void enrichCurrentPhrase();
  } else if (mode === "off" && state.currentSentence) {
    setTranslation("");
    void updateSceneAsset(localTranslation(state.currentSentence, state.currentWord));
    schedulePrefetch(state.currentSentence);
  }
}

function setTranslation(text, { loading = false } = {}) {
  state.currentTranslation = String(text || "");
  const node = $("#wordNetTranslation");
  if (!node) return;
  node.textContent = loading ? "Translating..." : state.currentTranslation;
  if (loading) {
    clearTranslationTimer();
    state.translationVisible = state.translationMode === "visible";
    syncTranslationToggle();
    return;
  }
  applyTranslationMode({ restartTimer: Boolean(state.currentTranslation) });
}

function syncTranslationToggle() {
  const button = $("#wordNetTranslationToggle");
  const translation = $("#wordNetTranslation");
  if (!button || !translation) return;
  const mode = hasTranslationMode(state.translationMode) ? state.translationMode : "visible";
  const label = translationModes[mode].label;
  button.classList.toggle("is-off", mode === "off");
  button.classList.toggle("is-waiting", mode.startsWith("timer-") && !state.translationVisible);
  button.setAttribute("aria-label", `Translation options. Current: ${label}.`);
  button.setAttribute("title", `Translation: ${label}`);
  translation.classList.toggle("is-hidden", !state.translationVisible);
  translation.setAttribute("aria-hidden", state.translationVisible ? "false" : "true");
  syncWordTranslation();
  syncTranslationMenu();
}

function syncWordTranslation() {
  const panel = $("#wordNetWordTranslation");
  const wordNode = $("#wordNetSelectedWord");
  const meaningNode = $("#wordNetSelectedMeaning");
  const posNode = $("#wordNetSelectedPos");
  const metaNode = $("#wordNetSelectedMeta");
  if (!panel || !wordNode || !meaningNode || !posNode || !metaNode) return;

  const translationEnabled = state.translationMode !== "off";
  const visible = Boolean(state.selectedWord) && translationEnabled;
  const details = state.selectedWordDetails;
  const normalizedSelected = normalizeWord(state.selectedWord).toLocaleLowerCase(targetLocale);
  const normalizedLemma = normalizeWord(details?.lemma).toLocaleLowerCase(targetLocale);
  const metadata = [];
  if (normalizedLemma && normalizedLemma !== normalizedSelected) metadata.push(`lemma ${details.lemma}`);
  if (details?.formTags?.length) metadata.push(details.formTags.slice(0, 3).join(" ").replaceAll("-", " "));
  const grammarTags = (details?.senseTags || []).filter((tag) => !details?.formTags?.includes(tag));
  if (grammarTags.length) metadata.push(grammarTags.slice(0, 2).join(" ").replaceAll("-", " "));
  if (details?.synonyms?.length) metadata.push(`also ${details.synonyms.slice(0, 2).join(", ")}`);
  panel.hidden = !visible;
  panel.setAttribute("aria-hidden", visible ? "false" : "true");
  panel.classList.toggle("is-loading", visible && state.wordMeaningLoading);
  wordNode.textContent = visible ? state.selectedWord : "";
  posNode.textContent = visible && details?.pos && details.pos !== "word" ? details.pos : "";
  meaningNode.textContent = !visible
    ? ""
    : state.wordMeaningLoading
      ? "Looking up..."
      : state.selectedWordMeaning || "No English meaning found.";
  metaNode.textContent = visible && !state.wordMeaningLoading ? metadata.join(" · ") : "";
  metaNode.title = metaNode.textContent;
}

function abortWordLookup() {
  state.wordLookupController?.abort();
  state.wordLookupController = null;
  state.wordMeaningLoading = false;
  state.wordLookupRequestId += 1;
  syncWordTranslation();
}

function cacheWordMeaning(key, meaning) {
  state.wordMeaningCache.delete(key);
  state.wordMeaningCache.set(key, meaning);
  while (state.wordMeaningCache.size > WORD_MEANING_CACHE_LIMIT) {
    state.wordMeaningCache.delete(state.wordMeaningCache.keys().next().value);
  }
}

async function lookupSelectedWord(word) {
  const selectedWord = normalizeWord(word);
  if (!selectedWord || state.translationMode === "off") {
    syncWordTranslation();
    return;
  }

  const key = selectedWord.toLocaleLowerCase(targetLocale);
  if (state.wordMeaningCache.has(key)) {
    state.selectedWordDetails = state.wordMeaningCache.get(key);
    state.selectedWordMeaning = state.selectedWordDetails?.meaning || "No English meaning found.";
    state.wordMeaningLoading = false;
    syncWordTranslation();
    return;
  }

  abortWordLookup();
  const requestId = state.wordLookupRequestId + 1;
  state.wordLookupRequestId = requestId;
  const controller = new AbortController();
  state.wordLookupController = controller;
  state.wordMeaningLoading = true;
  syncWordTranslation();

  const fallback = fallbackWordMeaning(selectedWord);
  try {
    const dictionary = runtimeAdapter()?.dictionary;
    if (!dictionary?.search) throw new Error("Dictionary lookup is unavailable.");
    const payload = await dictionary.search(selectedWord, { limit: 8, signal: controller.signal });
    const result = selectDictionaryMeaning(payload, selectedWord, { maxGlosses: 2 });
    const meaning = result?.meaning || fallback || "No English meaning found.";
    const details = result || { lemma: selectedWord, pos: "", formTags: [], senseTags: [], synonyms: [], meaning };
    cacheWordMeaning(key, details);
    if (requestId !== state.wordLookupRequestId || key !== state.selectedWord.toLocaleLowerCase(targetLocale)) return;
    state.selectedWordMeaning = meaning;
    state.selectedWordDetails = details;
  } catch (error) {
    if (error?.name === "AbortError" || requestId !== state.wordLookupRequestId) return;
    state.selectedWordMeaning = fallback || "Meaning unavailable.";
    state.selectedWordDetails = null;
  } finally {
    if (requestId === state.wordLookupRequestId) {
      state.wordLookupController = null;
      state.wordMeaningLoading = false;
      syncWordTranslation();
    }
  }
}

function selectWord(word, { lookup = true, render = true } = {}) {
  const selectedWord = normalizeWord(word);
  if (!selectedWord) return;
  const previousKey = state.selectedWord.toLocaleLowerCase(targetLocale);
  const nextKey = selectedWord.toLocaleLowerCase(targetLocale);
  state.selectedWord = selectedWord;
  if (previousKey !== nextKey) {
    abortWordLookup();
    state.selectedWordDetails = state.wordMeaningCache.get(nextKey) || null;
    state.selectedWordMeaning = state.selectedWordDetails?.meaning || "";
  }
  if (render && state.currentSentence) renderCzechSentence(state.currentSentence, selectedWord);
  syncGenerationControl();
  syncWordTranslation();
  if (lookup && state.translationMode !== "off" && !state.selectedWordMeaning) {
    void lookupSelectedWord(selectedWord);
  }
}

function setProgress(message) {
  const progress = $("#wordNetProgress");
  const bar = $("#wordNetProgressBar");
  if (!progress || !bar) return;

  if (message?.kind === "progress" && message.phase === "download") {
    const total = Number(message.totalBytes || 0);
    const bytes = Number(message.bytes || 0);
    const percent = total > 0 ? Math.max(0, Math.min(100, (bytes / total) * 100)) : 0;
    progress.hidden = false;
    progress.setAttribute("aria-valuenow", String(Math.round(percent)));
    bar.style.width = `${percent}%`;
    setStatus(`Downloading local model ${percent.toFixed(1)}%. Keep the app open.`, { tone: "active" });
    return;
  }

  progress.hidden = true;
  progress.setAttribute("aria-valuenow", "0");
  bar.style.width = "0%";
}

async function loadingRobotRows() {
  if (!state.robotRowsPromise) {
    state.robotRowsPromise = fetch(ROBOT_KEYMAP_URL, { cache: "force-cache" })
      .then((response) => {
        if (!response.ok) throw new Error(`Could not load robot keymap (${response.status}).`);
        return response.json();
      })
      .then((raw) => parseSceneKeymap(raw).filter((row) => row.assetPath.startsWith("/assets/robots/")))
      .catch(() => []);
  }
  return state.robotRowsPromise;
}

function hideLoadingRobot() {
  state.robotRequestId += 1;
  const image = $("#wordNetLoadingArt");
  if (!image) return;
  image.onload = null;
  image.onerror = null;
  image.hidden = true;
  image.removeAttribute("src");
}

async function showLoadingRobot() {
  const image = $("#wordNetLoadingArt");
  const loading = $("#wordNetLoading");
  if (!image || !loading || loading.hidden) return;
  const requestId = state.robotRequestId + 1;
  state.robotRequestId = requestId;
  const rows = await loadingRobotRows();
  if (requestId !== state.robotRequestId || loading.hidden || !rows.length) return;

  const startIndex = state.robotCursor % rows.length;
  state.robotCursor = (state.robotCursor + 1) % rows.length;
  const tryRow = (offset) => {
    const row = rows[(startIndex + offset) % rows.length];
    if (offset >= rows.length || !row || requestId !== state.robotRequestId || loading.hidden) {
      hideLoadingRobot();
      return;
    }
    image.hidden = true;
    image.onload = () => {
      if (requestId === state.robotRequestId && !loading.hidden) image.hidden = false;
    };
    image.onerror = () => tryRow(offset + 1);
    image.src = row.assetPath;
  };
  tryRow(0);
}

async function holdSentenceTransition(startedAt) {
  const elapsed = performance.now() - startedAt;
  const remaining = Math.max(0, MIN_SENTENCE_TRANSITION_MS - elapsed);
  if (remaining > 0) {
    await new Promise((resolve) => window.setTimeout(resolve, remaining));
  }
}

function setBusy(busy, { cover = busy } = {}) {
  state.busy = busy;
  document.querySelectorAll(".word-net-generation-toggle, .word-net-generation-menu button, .word-net-side-nav, .cz-word-token").forEach((button) => {
    button.disabled = busy;
  });
  syncGenerationControl();
  const loading = $("#wordNetLoading");
  const panel = $(".word-net-sentence-panel");
  if (panel) panel.setAttribute("aria-busy", busy ? "true" : "false");
  if (loading) {
    if (state.loadingHideTimerId) {
      window.clearTimeout(state.loadingHideTimerId);
      state.loadingHideTimerId = 0;
    }
    if (cover) {
      loading.hidden = false;
      window.requestAnimationFrame(() => {
        if (state.busy && !loading.hidden) loading.classList.add("is-visible");
      });
      void showLoadingRobot();
    } else {
      loading.classList.remove("is-visible");
      state.loadingHideTimerId = window.setTimeout(() => {
        state.loadingHideTimerId = 0;
        if (state.busy || loading.classList.contains("is-visible")) return;
        loading.hidden = true;
        hideLoadingRobot();
      }, LOADING_FADE_MS);
    }
  }
  syncDiagnostics();
}

function renderTrail() {
  const trail = $("#wordNetTrail");
  if (!trail) return;

  trail.replaceChildren(...state.history.slice(0, 6).map((item) => {
    const li = document.createElement("li");
    const word = document.createElement("b");
    const sentence = document.createElement("span");
    word.textContent = item.word;
    sentence.textContent = item.sentence;
    li.append(word, sentence);
    return li;
  }));
}

async function sceneAssetRows() {
  if (!state.sceneAssetRowsPromise) {
    state.sceneAssetRowsPromise = fetch(SCENE_KEYMAP_URL, { cache: "force-cache" })
      .then((response) => {
        if (!response.ok) throw new Error(`Could not load scene keymap (${response.status}).`);
        return response.json();
      })
      .then((raw) => parseSceneKeymap(raw).filter((row) => isMiscellaneousAssetPath(row.assetPath)))
      .catch(() => []);
  }
  return state.sceneAssetRowsPromise;
}

async function rankedSceneCandidates(englishText) {
  const text = String(englishText || "").trim();
  if (!text) return [];

  try {
    const response = await runtimeAdapter()?.vector?.search?.(text, {
      limit: SCENE_ASSET_LIMIT,
      sourceKinds: ["image_asset"]
    });
    const semanticRows = (Array.isArray(response?.results) ? response.results : [])
      .map((row) => ({
        assetPath: row.documentMetadata?.asset_path || row.chunkMetadata?.asset_path || row.sourceId || "",
        description: row.text || row.title || "Caatuu scene",
        score: Number(row.score || 0),
        semanticScore: Number(row.semanticScore ?? row.score ?? 0),
        lexicalScore: Number(row.lexicalScore || 0)
      }))
      .filter((row) => isMiscellaneousAssetPath(row.assetPath));
    if (semanticRows.length) return semanticRows;
  } catch (error) {
    // The game must remain playable if setup is incomplete or a runtime is not
    // available. The keymap-only fallback below still chooses a related image.
  }

  const rows = await sceneAssetRows();
  if (!rows.length) return [];
  const queryTokens = englishSceneTokens(text);
  const ranked = rows
    .map((row) => ({
      ...row,
      score: sceneLexicalScore(queryTokens, row)
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, SCENE_ASSET_LIMIT);
  if (ranked[0]?.score > 0) return ranked;

  const offset = stableSceneOffset(text, rows.length);
  return Array.from({ length: Math.min(SCENE_ASSET_LIMIT, rows.length) }, (_, index) => (
    rows[(offset + index) % rows.length]
  ));
}

function englishSceneTokens(text) {
  return new Set(String(text || "").toLowerCase().match(/[a-z0-9]+/g) || []);
}

function sceneLexicalScore(queryTokens, row) {
  if (!queryTokens.size) return 0;
  const candidateTokens = englishSceneTokens(`${row.description || ""} ${row.category || ""}`);
  let shared = 0;
  for (const token of queryTokens) {
    if (candidateTokens.has(token)) shared += 1;
  }
  return shared / queryTokens.size;
}

function stableSceneOffset(text, length) {
  let hash = 2166136261;
  for (const char of String(text || "")) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0) % Math.max(1, length);
}

function hideSceneAsset({ cancel = false } = {}) {
  if (cancel) state.sceneRequestId += 1;
  state.sceneCandidates = [];
  const scene = $("#wordNetScene");
  const image = $("#wordNetSceneImage");
  if (image) {
    image.onload = null;
    image.onerror = null;
    image.removeAttribute("src");
    image.alt = "";
  }
  if (scene) scene.hidden = true;
}

function renderSceneCandidate(candidateIndex, requestId) {
  const scene = $("#wordNetScene");
  const image = $("#wordNetSceneImage");
  const candidate = state.sceneCandidates[candidateIndex];
  if (!scene || !image || !candidate) {
    hideSceneAsset();
    return;
  }

  scene.hidden = true;
  image.onload = () => {
    if (requestId === state.sceneRequestId) scene.hidden = false;
  };
  image.onerror = () => {
    if (requestId === state.sceneRequestId) renderSceneCandidate(candidateIndex + 1, requestId);
  };
  image.alt = candidate.description;
  image.src = candidate.assetPath;
}

async function updateSceneAsset(englishText) {
  const requestId = state.sceneRequestId + 1;
  state.sceneRequestId = requestId;
  hideSceneAsset();

  try {
    const candidates = await rankedSceneCandidates(englishText);
    if (requestId !== state.sceneRequestId) return;
    state.sceneCandidates = candidates;
    renderSceneCandidate(0, requestId);
  } catch (error) {
    if (requestId === state.sceneRequestId) hideSceneAsset();
  }
}

function isAbortError(error) {
  return error?.name === "AbortError";
}

function cacheTranslation(sentence, translation) {
  const key = sentenceFingerprint(sentence);
  if (!key || !translation) return;
  state.translationCache.delete(key);
  state.translationCache.set(key, translation);
  while (state.translationCache.size > 24) {
    state.translationCache.delete(state.translationCache.keys().next().value);
  }
  saveTranslationCache();
}

async function requestEnglishTranslation(sentence, word, { signal, onStatus } = {}) {
  const cached = state.translationCache.get(sentenceFingerprint(sentence));
  if (cached) return cached;
  if (!nativeTranslationRuntimeAvailable()) {
    return localTranslation(sentence, word);
  }

  try {
    let output = "";
    const result = await runtimeAdapter().models.generate(
      {
        prompt: translationPrompt(sentence),
        modelKey: TRANSLATION_MODEL_KEY,
        maxTokens: 48,
        options: {
          thinking: false,
          temperature: 0,
          stateless: true
        }
      },
      {
        timeoutMs: 180000,
        timeoutMessage: "English translation took too long.",
        signal,
        onEvent(message) {
          if (message.kind === "token") {
            output += message.token || "";
          } else if (message.kind === "status") {
            onStatus?.(message.message || "Translating to English.");
          }
        }
      }
    );
    signal?.throwIfAborted?.();
    const translation = cleanTranslation(output || result?.output || "") || localTranslation(sentence, word);
    cacheTranslation(sentence, translation);
    return translation;
  } catch (error) {
    if (isAbortError(error)) throw error;
    return localTranslation(sentence, word);
  }
}

async function translateCurrentSentence(sentence, word, { signal } = {}) {
  if (state.translationMode === "off") {
    setTranslation("");
    return localTranslation(sentence, word);
  }

  setTranslation("", { loading: true });
  const translation = await requestEnglishTranslation(sentence, word, {
    signal,
    onStatus(message) {
      setStatus(message, { tone: "active" });
    }
  });
  cacheTranslation(sentence, translation);
  if (state.branchQueue.setTranslation(sentence, translation)) savePreparedQueue();
  setTranslation(translation);
  return translation;
}

async function prepareNextWordTurn({ signal } = {}) {
  const runtime = runtimeAdapter();
  if (runtime?.env !== "android" || !runtime.models?.load) return;

  const status = await runtime.models.status(WORD_NET_MODEL_KEY);
  signal?.throwIfAborted?.();
  if (status?.loaded) return;

  setStatus("Phrase ready. Preparing the next turn.", { tone: "active" });
  await runtime.models.load(WORD_NET_MODEL_KEY, {
    timeoutMs: 180000,
    timeoutMessage: "The sentence model took too long to prepare.",
    signal,
    onEvent(message) {
      if (message.kind === "progress") setProgress(message);
    }
  });
}

async function enrichCurrentPhrase() {
  if (state.busy || state.translationMode === "off" || !state.currentSentence) return;

  const sentence = state.currentSentence;
  const target = state.currentWord;
  const requestId = state.phraseRequestId;
  const controller = new AbortController();
  state.backgroundController = controller;
  state.backgroundActivity = "translation";
  setStatus("Preparing English for this phrase.", { tone: "active" });
  try {
    const englishSentence = await translateCurrentSentence(sentence, target, { signal: controller.signal });
    if (requestId !== state.phraseRequestId || sentence !== state.currentSentence) return;
    void updateSceneAsset(englishSentence);
    await prepareNextWordTurn({ signal: controller.signal });
    if (requestId !== state.phraseRequestId) return;
    setStatus(playInstruction, { tone: "muted" });
  } catch (error) {
    if (isAbortError(error)) return;
    if (requestId === state.phraseRequestId && sentence === state.currentSentence) {
      setStatus("The phrase is ready, but English could not be prepared.", { tone: "error" });
    }
  } finally {
    if (state.backgroundController === controller) {
      state.backgroundController = null;
      state.backgroundActivity = "";
    }
    syncDiagnostics();
    if (requestId === state.phraseRequestId && sentence === state.currentSentence) {
      setProgress(null);
      schedulePrefetch(sentence);
    }
  }
}

function clearPrefetchTimer() {
  if (!state.prefetchTimerId) return;
  window.clearTimeout(state.prefetchTimerId);
  state.prefetchTimerId = 0;
  syncDiagnostics();
}

function cancelBackgroundWork({ preservePrefetch = false } = {}) {
  clearPrefetchTimer();
  if (preservePrefetch && state.backgroundActivity === "prefetch") {
    syncDiagnostics();
    return;
  }
  state.backgroundController?.abort();
  state.backgroundController = null;
  state.backgroundActivity = "";
  syncDiagnostics();
}

async function prefetchAllowance() {
  if (document.visibilityState === "hidden") return 0;
  if (navigator.connection?.saveData === true) return 0;
  let freshTarget = nativeWordNetRuntimeAvailable() ? PREFETCH_BATTERY_TARGET : PREFETCH_FRESH_TARGET;
  const allowanceForTarget = () => {
    const globalDeficit = Math.max(0, freshTarget - state.branchQueue.freshSize);
    if (state.generationMode !== "selected") return globalDeficit;
    const selectedLaneDeficit = prefetchPriorityWords()
      .slice(0, 8)
      .reduce((total, word) => total + Math.max(0, PREFETCH_PER_WORD - state.branchQueue.count(word, {
        freshOnly: true,
        excludeFingerprints: queueAvoidFingerprints()
      })), 0);
    return Math.max(globalDeficit, Math.min(PREFETCH_PER_TURN, selectedLaneDeficit));
  };
  if (typeof navigator.getBattery !== "function") {
    return allowanceForTarget();
  }
  try {
    if (!state.batteryPromise) state.batteryPromise = navigator.getBattery();
    const battery = await state.batteryPromise;
    if (!battery.charging && Number(battery.level) < 0.35) return 0;
    if (battery.charging) freshTarget = PREFETCH_FRESH_TARGET;
  } catch (error) {
    // Use the conservative fresh target when battery state is unavailable.
  }
  return allowanceForTarget();
}

function schedulePrefetch(sentence, delayMs = PREFETCH_IDLE_DELAY_MS) {
  clearPrefetchTimer();
  if (!sentence || document.visibilityState === "hidden") return;
  state.prefetchSourceSentence = sentence;
  state.prefetchBudget = PREFETCH_PER_TURN;
  state.prefetchAttemptedWords = new Map();
  if (state.backgroundActivity === "prefetch") {
    syncDiagnostics();
    return;
  }
  state.prefetchTimerId = window.setTimeout(() => {
    state.prefetchTimerId = 0;
    syncDiagnostics();
    void runPrefetch();
  }, delayMs);
  syncDiagnostics();
}

function prefetchPriorityWords() {
  const sentenceWords = sentenceTargets(state.prefetchSourceSentence, { limit: 14 });
  const currentSelection = normalizeWord(state.selectedWord || state.currentWord);
  const seedOffset = state.history.length % Math.max(1, seedWords.length);
  const rotatedSeeds = [...seedWords.slice(seedOffset), ...seedWords.slice(0, seedOffset)];
  const priorities = state.generationMode === "selected"
    ? [currentSelection, ...sentenceWords, ...rotatedSeeds]
    : [...rotatedSeeds, ...sentenceWords];
  const seen = new Set();
  return priorities.filter((word) => {
    const normalized = normalizeWord(word);
    const key = normalized.toLocaleLowerCase(targetLocale);
    if (!key || seen.has(key) || PREFETCH_STOPWORDS.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function nextPrefetchTarget() {
  const recentFingerprints = queueAvoidFingerprints();
  const candidates = prefetchPriorityWords()
    .map((word, priority) => {
      const key = word.toLocaleLowerCase(targetLocale);
      return {
        word,
        key,
        priority,
        attempts: state.prefetchAttemptedWords.get(key) || 0,
        freshCount: state.branchQueue.count(word, {
          freshOnly: true,
          excludeFingerprints: recentFingerprints
        })
      };
    })
    .filter((candidate) => (
      candidate.attempts < PREFETCH_PER_WORD
      && candidate.freshCount < PREFETCH_PER_WORD
    ));
  if (state.generationMode === "random") {
    candidates.sort((left, right) => left.freshCount - right.freshCount || left.priority - right.priority);
  }
  const candidate = candidates[0];
  if (!candidate) return "";
  state.prefetchAttemptedWords.set(candidate.key, candidate.attempts + 1);
  return candidate.word;
}

function untranslatedPreparedCandidates(limit = PREFETCH_TRANSLATION_BATCH_SIZE) {
  return state.branchQueue.values()
    .filter((entry) => entry.sentence && !entry.translation)
    .sort((left, right) => (
      Number(left.useCount > 0) - Number(right.useCount > 0)
      || Number(left.createdAt || 0) - Number(right.createdAt || 0)
    ))
    .slice(0, Math.max(0, limit));
}

async function translatePreparedBatch({ signal } = {}) {
  const candidates = untranslatedPreparedCandidates();
  if (!candidates.length) return 0;

  let translated = 0;
  for (const [index, candidate] of candidates.entries()) {
    signal?.throwIfAborted?.();
    setStatus(`Preparing English for saved phrase ${index + 1} of ${candidates.length}.`, { tone: "active" });
    const english = await requestEnglishTranslation(candidate.sentence, candidate.word, { signal });
    signal?.throwIfAborted?.();
    if (!state.branchQueue.setTranslation(candidate.sentence, english)) continue;
    cacheTranslation(candidate.sentence, english);
    translated += 1;
  }
  if (translated) savePreparedQueue();
  return translated;
}

async function runPrefetch() {
  if (state.busy || state.backgroundController || state.prefetchBudget <= 0) return;
  if (state.prefetchSourceSentence !== state.currentSentence) return;
  const allowance = await prefetchAllowance();
  if (state.busy || state.backgroundController || state.prefetchBudget <= 0) return;
  if (state.prefetchSourceSentence !== state.currentSentence) return;
  const pendingTranslations = state.translationMode === "off"
    ? []
    : untranslatedPreparedCandidates();
  let translateBatch = pendingTranslations.length > 0
    && state.prefetchGeneratedSinceTranslation >= PREFETCH_TRANSLATION_BATCH_SIZE;
  const target = !translateBatch && allowance ? nextPrefetchTarget() : "";
  if (!target && pendingTranslations.length) translateBatch = true;
  if (!target && !translateBatch) return;

  const controller = new AbortController();
  state.backgroundController = controller;
  state.backgroundActivity = translateBatch ? "translation-batch" : "prefetch";
  syncDiagnostics();
  try {
    if (translateBatch) {
      await translatePreparedBatch({ signal: controller.signal });
      state.prefetchGeneratedSinceTranslation = 0;
      await prepareNextWordTurn({ signal: controller.signal });
    } else {
      const candidate = await requestSentenceCandidate(target, {
        signal: controller.signal,
        speculative: true
      });
      if (!controller.signal.aborted && candidate?.sentence && !isRecentSentence(candidate.sentence, generationAvoidList())) {
        if (rememberPreparedCandidate(target, candidate)) {
          state.prefetchGeneratedSinceTranslation += 1;
        }
      }
    }
  } catch (error) {
    if (!isAbortError(error)) {
      // Speculative work is optional; foreground generation remains authoritative.
    }
  } finally {
    if (state.backgroundController === controller) {
      state.backgroundController = null;
      state.backgroundActivity = "";
    }
    state.prefetchBudget = translateBatch ? 0 : state.prefetchBudget - 1;
    if (state.prefetchBudget > 0 && state.prefetchSourceSentence === state.currentSentence) {
      state.prefetchTimerId = window.setTimeout(() => {
        state.prefetchTimerId = 0;
        syncDiagnostics();
        void runPrefetch();
      }, PREFETCH_BETWEEN_DELAY_MS);
    }
    syncDiagnostics();
  }
}

async function requestSentenceCandidate(target, { signal, speculative = false, onEvent } = {}) {
  if (!nativeWordNetRuntimeAvailable()) {
    return { sentence: localSentence(target, generationAvoidList()), source: "browser-fallback" };
  }

  const attempts = speculative ? 1 : 2;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    signal?.throwIfAborted?.();
    let output = "";
    const result = await runtimeAdapter().models.generate(
      {
        prompt: wordNetPrompt(target, { attempt }),
        modelKey: WORD_NET_MODEL_KEY,
        maxTokens: 56,
        options: {
          thinking: false,
          temperature: 0.68 + attempt * 0.16,
          stateless: true
        }
      },
      {
        timeoutMs: 180000,
        timeoutMessage: "Czech phrase generation took too long.",
        signal,
        onEvent(message) {
          if (message.kind === "token") output += message.token || "";
          onEvent?.(message);
        }
      }
    );
    signal?.throwIfAborted?.();
    const sentence = stripModelEcho(output || result?.output || "");
    if (
      sentenceIncludesWord(sentence, target) &&
      isPlausibleSentence(sentence) &&
      !isRecentSentence(sentence, generationAvoidList())
    ) {
      return { sentence, source: "native", settings: result?.settings || {} };
    }
  }
  return { sentence: localSentence(target, generationAvoidList()), source: "validated-fallback" };
}

function renderCzechSentence(sentence, selectedWord = "") {
  const host = $("#wordNetSentence");
  if (!host) return;

  const tokens = tokenizeCzechSentence(sentence);
  if (!tokens.length) {
    const empty = document.createElement("p");
    empty.className = "word-net-empty";
    empty.textContent = "Preparing a Czech phrase.";
    host.replaceChildren(empty);
    return;
  }

  const nodes = [];
  let openingPunctuation = [];
  const punctuationNode = (text) => {
    const span = document.createElement("span");
    span.className = "cz-punctuation-token";
    span.textContent = text;
    return span;
  };

  for (const token of tokens) {
    if (token.type !== "word") {
      if (/^[„«(\[]$/u.test(token.text)) {
        openingPunctuation.push(punctuationNode(token.text));
      } else {
        const last = nodes[nodes.length - 1];
        if (last?.classList?.contains("cz-token-cluster")) last.append(punctuationNode(token.text));
        else nodes.push(punctuationNode(token.text));
      }
      continue;
    }

    const cluster = document.createElement("span");
    cluster.className = "cz-token-cluster";
    cluster.append(...openingPunctuation);
    openingPunctuation = [];
    const button = document.createElement("button");
    button.type = "button";
    button.className = "cz-word-token";
    button.textContent = token.text;
    button.dataset.word = normalizeWord(token.text);
    button.setAttribute("aria-label", `Select ${token.text} and show its meaning`);
    const selected = wordMatchesTarget(button.dataset.word, selectedWord);
    button.setAttribute("aria-pressed", selected ? "true" : "false");
    if (selected) {
      button.classList.add("is-selected");
    }
    cluster.append(button);
    nodes.push(cluster);
  }
  nodes.push(...openingPunctuation);
  host.replaceChildren(...nodes);
  syncGenerationControl();
}

function rememberStep(word, sentence) {
  const fingerprint = sentenceFingerprint(sentence);
  state.history = state.history.filter((entry) => sentenceFingerprint(entry.sentence) !== fingerprint);
  state.history.unshift({ word, sentence });
  state.history = state.history.slice(0, HISTORY_LIMIT);
  state.historyCursor = 0;
  saveHistory();
  renderTrail();
  syncDiagnostics();
}

async function showPreviousSentence() {
  if (state.busy) return;
  const previousIndex = state.historyCursor + 1;
  const previous = state.history[previousIndex];
  if (!previous) {
    setStatus("There is no earlier sentence yet.", { tone: "muted" });
    return;
  }

  const transitionStartedAt = performance.now();
  cancelBackgroundWork();
  setBusy(true);
  setStatus("Restoring the previous sentence.", { tone: "active" });
  await holdSentenceTransition(transitionStartedAt);
  state.historyCursor = previousIndex;
  state.phraseRequestId += 1;
  state.currentWord = previous.word;
  state.currentSentence = previous.sentence;
  state.currentGenerationSource = "history";
  state.branchQueue.markUsed(previous.sentence);
  savePreparedQueue();
  selectWord(previous.word, { lookup: state.translationMode !== "off", render: false });
  hideSceneAsset({ cancel: true });
  setTranslation("");
  renderCzechSentence(previous.sentence, previous.word);
  resetSentenceFeedback();
  setProgress(null);
  setBusy(false);

  if (state.translationMode === "off") {
    void updateSceneAsset(localTranslation(previous.sentence, previous.word));
    setStatus("Previous sentence restored. Swipe right again to go farther back.", { tone: "muted" });
    schedulePrefetch(previous.sentence);
  } else {
    setStatus("Previous sentence restored. Preparing its English.", { tone: "active" });
    if (!state.selectedWordMeaning && !state.wordMeaningLoading) void lookupSelectedWord(previous.word);
    void enrichCurrentPhrase();
  }
}

function rememberSeenSentence(sentence) {
  const fingerprint = sentenceFingerprint(sentence);
  state.recentSentences = state.recentSentences
    .filter((item) => sentenceFingerprint(item) !== fingerprint);
  state.recentSentences.unshift(sentence);
  state.recentSentences = state.recentSentences.slice(0, RECENT_SENTENCE_LIMIT);
  saveRecentSentences();
}

function resetSentenceFeedback() {
  state.feedbackSnapshot = null;
  state.feedbackReportedKey = "";
  const dialog = $("#wordNetFeedbackDialog");
  const form = $("#wordNetFeedbackForm");
  const toggle = $("#wordNetReportToggle");
  const status = $("#wordNetFeedbackStatus");
  const submit = $("#wordNetFeedbackSubmit");
  if (dialog?.open) dialog.close();
  if (form) form.reset();
  if (toggle) {
    toggle.hidden = !state.currentSentence;
    toggle.disabled = !state.currentSentence;
    toggle.textContent = "Report this sentence";
  }
  if (status) status.textContent = "";
  if (submit) submit.disabled = false;
}

async function generateSentenceForWord(word, { source = "choice" } = {}) {
  const target = normalizeWord(word) || randomItem(seedWords);
  if (state.busy) return;

  const queued = state.branchQueue.take(target, {
    excludeFingerprints: queueAvoidFingerprints()
  });
  cancelBackgroundWork({ preservePrefetch: Boolean(queued) && state.translationMode === "off" });
  state.currentWord = target;
  selectWord(target, { lookup: state.translationMode !== "off" });
  setTranslation("");
  hideSceneAsset({ cancel: true });
  setProgress(null);

  if (queued) {
    savePreparedQueue();
    const transitionStartedAt = performance.now();
    setBusy(true);
    setStatus(`Ready from the saved queue for "${target}".`, { tone: "active" });
    await holdSentenceTransition(transitionStartedAt);
    showPreparedPhrase(target, queued);
    return;
  }

  const transitionStartedAt = performance.now();
  setBusy(true);
  renderCzechSentence(state.currentSentence, target);

  const firstRun = source === "initial" || source === "seed";
  setStatus(firstRun ? "Generating a Czech sentence." : `Generating from "${target}".`, { tone: "active" });

  try {
    const candidate = await requestSentenceCandidate(target, {
      onEvent(message) {
        if (message.kind === "progress") {
          setProgress(message);
        } else if (message.kind === "status") {
          setStatus(message.message || "Generating locally.", { tone: "active" });
        }
      }
    });
    await holdSentenceTransition(transitionStartedAt);
    showPreparedPhrase(target, candidate);
  } catch (error) {
    const candidate = { sentence: localSentence(target, generationAvoidList()), source: "error-fallback" };
    await holdSentenceTransition(transitionStartedAt);
    showPreparedPhrase(target, candidate);
    setStatus(error?.message || "Could not generate with the model.", { tone: "error" });
  }
}

function showPreparedPhrase(target, candidate) {
  const sentence = candidate?.sentence || localSentence(target, generationAvoidList());
  state.phraseRequestId += 1;
  state.currentWord = target;
  selectWord(target, { lookup: false, render: false });
  state.currentSentence = sentence;
  state.currentGenerationSource = candidate?.source || "unknown";
  hideSceneAsset({ cancel: true });
  setTranslation("");
  renderCzechSentence(sentence, target);
  rememberPreparedCandidate(target, candidate, { used: true });
  rememberStep(target, sentence);
  rememberSeenSentence(sentence);
  resetSentenceFeedback();
  setProgress(null);
  setBusy(false);

  if (state.translationMode === "off") {
    void updateSceneAsset(localTranslation(sentence, target));
    setStatus(playInstruction, { tone: "muted" });
    schedulePrefetch(sentence);
  } else if (candidate?.translation) {
    cacheTranslation(sentence, candidate.translation);
    setTranslation(candidate.translation);
    void updateSceneAsset(candidate.translation);
    setStatus(playInstruction, { tone: "muted" });
    if (!state.selectedWordMeaning && !state.wordMeaningLoading) void lookupSelectedWord(target);
    schedulePrefetch(sentence);
  } else {
    setStatus("Phrase ready. Preparing English in the background.", { tone: "active" });
    if (!state.selectedWordMeaning && !state.wordMeaningLoading) void lookupSelectedWord(target);
    void enrichCurrentPhrase();
  }
}

function freshSeedWord() {
  const recentWords = new Set(state.history.slice(0, 5)
    .map((item) => normalizeWord(item.word).toLocaleLowerCase(targetLocale)));
  const candidates = seedWords.filter((word) => !recentWords.has(word.toLocaleLowerCase(targetLocale)));
  return randomItem(candidates.length ? candidates : seedWords);
}

function openSentenceFeedback() {
  if (!state.currentSentence || state.feedbackReportedKey === sentenceFingerprint(state.currentSentence)) return;
  const dialog = $("#wordNetFeedbackDialog");
  if (!dialog) return;
  if (dialog.open) {
    dialog.close();
    return;
  }
  state.feedbackSnapshot = {
    targetWord: state.currentWord,
    sentence: state.currentSentence,
    translation: state.currentTranslation,
    generationSource: state.currentGenerationSource,
    translationMode: state.translationMode,
    recentSentences: state.recentSentences.slice(1, 5)
  };
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
  $("#wordNetFeedbackReason")?.focus();
}

function closeSentenceFeedback() {
  const dialog = $("#wordNetFeedbackDialog");
  if (!dialog) return;
  if (typeof dialog.close === "function" && dialog.open) dialog.close();
  else dialog.removeAttribute("open");
}

function createClientReportId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}

async function submitSentenceFeedback(event) {
  event.preventDefault();
  const snapshot = state.feedbackSnapshot;
  if (!snapshot?.sentence) return;
  const phraseRequestId = state.phraseRequestId;
  const sentenceKey = sentenceFingerprint(snapshot.sentence);
  const submit = $("#wordNetFeedbackSubmit");
  const status = $("#wordNetFeedbackStatus");
  const reason = $("#wordNetFeedbackReason")?.value || "nonsense_or_incorrect";
  const comment = String($("#wordNetFeedbackComment")?.value || "").trim().slice(0, 400);
  const clientReportId = createClientReportId();
  const reportedAt = new Date().toISOString();
  const feedback = {
    clientReportId,
    reportedAt,
    kind: "word_world_sentence",
    reason,
    comment,
    ...snapshot,
    sentenceModelKey: WORD_NET_MODEL_KEY,
    translationModelKey: TRANSLATION_MODEL_KEY
  };
  const payload = {
    kind: "word_world_sentence_feedback",
    title: "Word World sentence feedback",
    message: `${reason}: ${snapshot.sentence}`,
    feedback
  };
  const dedupeKey = [feedback.kind, sentenceKey, reason].join("|");
  if (submit) submit.disabled = true;
  if (status) status.textContent = "Saving your report…";
  try {
    const queued = await runtimeAdapter()?.maintenance?.enqueueReport?.(payload, {
      id: clientReportId,
      dedupeKey
    });
    if (!queued?.queued) throw new Error("Feedback queue is unavailable.");
    const stillCurrent = phraseRequestId === state.phraseRequestId && snapshot.sentence === state.currentSentence;
    if (stillCurrent) {
      state.feedbackReportedKey = sentenceKey;
      closeSentenceFeedback();
      const toggle = $("#wordNetReportToggle");
      if (toggle) {
        toggle.textContent = "Report saved";
        toggle.disabled = true;
      }
      if (status) {
        status.textContent = queued.persisted === false
          ? "Kept for this session — keep Caatuu open while we send it."
          : "Saved — thank you. We’ll send it quietly when a connection is available.";
      }
    }
    const flush = runtimeAdapter()?.maintenance?.flushReports?.();
    if (flush) {
      void flush.then((result) => {
        if (
          result?.sent?.includes(clientReportId) &&
          phraseRequestId === state.phraseRequestId &&
          snapshot.sentence === state.currentSentence &&
          status
        ) {
          status.textContent = "Thank you — report sent.";
        }
      }).catch(() => {});
    }
  } catch (error) {
    if (
      phraseRequestId === state.phraseRequestId &&
      snapshot.sentence === state.currentSentence &&
      status
    ) {
      status.textContent = "Could not save the report on this device.";
    }
  } finally {
    if (phraseRequestId === state.phraseRequestId && submit) submit.disabled = false;
  }
}

function bindUi() {
  $("#wordNetTranslationToggle")?.addEventListener("click", () => {
    closeGenerationMenu();
    toggleTranslationMenu();
  });
  $("#wordNetTranslationMenu")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-translation-mode]");
    if (!button) return;
    setTranslationMode(button.dataset.translationMode);
  });
  $("#wordNetGenerationToggle")?.addEventListener("click", () => {
    closeTranslationMenu();
    toggleGenerationMenu();
  });
  $("#wordNetGenerationMenu")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-generation-mode]");
    if (!button || button.disabled) return;
    const mode = button.dataset.generationMode;
    setGenerationMode(mode);
    generateFromConfiguredMode(mode);
  });
  $("#wordNetPrevious")?.addEventListener("click", showPreviousSentence);
  $("#wordNetNext")?.addEventListener("click", () => generateFromConfiguredMode());
  document.addEventListener("click", (event) => {
    if (event.target.closest(".word-net-panel-actions")) return;
    closeTranslationMenu();
    closeGenerationMenu();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeTranslationMenu();
      closeGenerationMenu();
    }
  });
  $("#wordNetSentence")?.addEventListener("click", (event) => {
    const button = event.target.closest(".cz-word-token");
    if (!button || state.busy) return;
    selectWord(button.dataset.word);
    setStatus(`Selected "${button.dataset.word}". Choose ↻ in Generation to continue with it.`, { tone: "muted" });
  });
  const sentencePanel = $(".word-net-sentence-panel");
  sentencePanel?.addEventListener("pointerdown", (event) => {
    if (state.busy || event.button > 0 || event.target.closest("button, a, input, select, textarea, dialog")) return;
    state.swipeStart = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      time: event.timeStamp
    };
    try {
      sentencePanel.setPointerCapture(event.pointerId);
    } catch (error) {
      // Some WebViews do not expose pointer capture; pointerup still handles in-panel swipes.
    }
  });
  sentencePanel?.addEventListener("pointerup", (event) => {
    const start = state.swipeStart;
    state.swipeStart = null;
    if (!start || start.pointerId !== event.pointerId || state.busy) return;
    const action = interpretHorizontalSwipe(start, {
      x: event.clientX,
      y: event.clientY,
      time: event.timeStamp
    });
    if (action === "random") {
      generateFromConfiguredMode();
    } else if (action === "previous") {
      showPreviousSentence();
    }
  });
  sentencePanel?.addEventListener("pointercancel", () => {
    state.swipeStart = null;
  });
  $("#wordNetReportToggle")?.addEventListener("click", openSentenceFeedback);
  $("#wordNetFeedbackCancel")?.addEventListener("click", closeSentenceFeedback);
  $("#wordNetFeedbackForm")?.addEventListener("submit", submitSentenceFeedback);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      cancelBackgroundWork();
      abortWordLookup();
    }
    else if (!state.busy && state.currentSentence && state.translationMode === "off") schedulePrefetch(state.currentSentence);
  });
}

async function init() {
  bindUi();
  runtimeAdapter()?.registerServiceWorker?.().catch(() => {});
  const diagnostics = $("#wordNetDiagnostics");
  if (diagnostics) diagnostics.open = false;
  applyTranslationMode();
  renderCzechSentence("");
  syncGenerationControl();
  syncWordTranslation();
  syncDiagnostics();
  setStatus(playInstruction);
  hydrateQueueFromHistory();
  await generateRandomPhrase({ source: "initial" });
}

init();
