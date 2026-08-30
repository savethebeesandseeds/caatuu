import {
  alignWordReconstructionAttempt,
  buildWordReconstructionChallenge,
  cleanTranslation,
  interpretHorizontalSwipe,
  isMiscellaneousAssetPath,
  isReservedEdgeGesture,
  isPlausibleSentence,
  isRecentSentence,
  isWordReconstructionCorrect,
  isSpeechSynthesisSupported,
  normalizeWord,
  parseSceneKeymap,
  selectDictionaryMeaning,
  selectSpeechSynthesisVoice,
  sentenceFingerprint,
  sentenceIncludesWord,
  sentenceTargets,
  resolveSpeechPace,
  stripModelEcho,
  tokenizeCzechSentence as tokenizeLegacySentence,
  wordMatchesTarget as legacyWordMatchesTarget
} from "./word-net-core.mjs?v=word-net-core-19";
import { WordNetBranchQueue } from "./word-net-queue.mjs?v=word-net-queue-6";
import { localAiAvailability } from "./shell-policy.mjs";

const WORD_NET_MODEL_KEY = "cstinyllama-1.2b-czech-word-sentence-001";
const TRANSLATION_MODEL_KEY = "qwen3-1.7b-translation-cs-en-001";
const SCENE_KEYMAP_URL = "/assets/miscellaneous/keymap.json";
const ROBOT_KEYMAP_URL = "/assets/robots/keymap.json";
const ROBOT_FALLBACK_URL = "/assets/robots/robot%20(1).png";
const SCENE_ASSET_LIMIT = 5;
const SCENE_ASSET_READY_TIMEOUT_MS = 8000;
const SCENE_SEMANTIC_SEARCH_TIMEOUT_MS = 1600;
const SCENE_KEYMAP_SEARCH_TIMEOUT_MS = 1800;
const SCENE_CANDIDATE_SEARCH_TIMEOUT_MS = 3600;
const SCENE_CANDIDATE_LOAD_TIMEOUT_MS = 1200;
const course = window.CaatuuCourse;
if (!course) throw new Error("Caatuu course profile must load before Word World.");
const targetLocale = course.targetLanguage.locale;
const targetSpeechLocale = course.targetLanguage.speechLocale || targetLocale;
const targetLanguageLabel = String(course.targetLanguage.label || "target language").trim();
let mountRoot = null;
let providerContext = null;
let lifecycleOptions = Object.freeze({});
let mounted = false;
const TRANSLATION_MODE_STORAGE_KEY = course.storage.wordWorldTranslationMode;
const GENERATION_MODE_STORAGE_KEY = `${course.storage.namespace}.wordNet.generationMode`;
const CONTENT_MODE_STORAGE_KEY = `${course.storage.namespace}.wordNet.contentMode.v1`;
const STANDARD_USAGE_STORAGE_KEY = `${course.storage.namespace}.wordNet.standardUsage.v1`;
const PREPARED_QUEUE_STORAGE_KEY = `${course.storage.namespace}.wordNet.preparedQueue.v2`;
const HISTORY_STORAGE_KEY = `${course.storage.namespace}.wordNet.history.v2`;
const LEGACY_HISTORY_STORAGE_KEY = `${course.storage.namespace}.wordNet.history.v1`;
const RECENT_SENTENCES_STORAGE_KEY = course.storage.wordWorldRecentSentences;
const TRANSLATION_CACHE_STORAGE_KEY = course.storage.wordWorldTranslationCache;
const WORD_CARD_PREFERENCES_STORAGE_KEY = `${course.storage.namespace}.wordNet.wordCardPreferences.v1`;
const AUDIO_AUTOPLAY_STORAGE_KEY = `${course.storage.namespace}.wordNet.speechAutoplay.v2`;
const DICTIONARY_GAP_STORAGE_KEY = `${course.storage.namespace}.dictionary.missing.kaikki-cs-en-2026-07-09.v1`;
const DICTIONARY_GAP_SOURCE_KEY = "kaikki-cs-en-2026-07-09";
const DICTIONARY_GAP_NOTICE = "Missing word queued for server review.";
const DICTIONARY_GAP_LIMIT = 80;
const RECONSTRUCTION_DISTRACTOR_COUNT = 2;
const SENTENCE_REWARD_LIMIT = 128;
const CZECH_SPEECH_TIMEOUT_MS = 30_000;
const EXPECTED_SPEECH_CANCELLATIONS = new Set(["canceled", "cancelled", "interrupted"]);
const RECENT_SENTENCE_LIMIT = 48;
const HISTORY_LIMIT = 256;
const PREPARED_QUEUE_CAPACITY = 512;
const QUEUE_RECENT_AVOID_LIMIT = 6;
const WORD_MEANING_CACHE_LIMIT = 64;
const PREFETCH_IDLE_DELAY_MS = 500;
const PREFETCH_NATIVE_IDLE_DELAY_MS = 1200;
const PREFETCH_BETWEEN_DELAY_MS = 900;
const PREFETCH_PER_TURN = 12;
const PREFETCH_FRESH_TARGET = 24;
const PREFETCH_BATTERY_TARGET = 12;
const PREFETCH_PER_WORD = 3;
const PREFETCH_TRANSLATION_BATCH_SIZE = 5;
const PREFETCH_TRANSLATED_LOW_WATER = 4;
const PREFETCH_PAUSED = -1;
const PRESERVABLE_BACKGROUND_ACTIVITIES = new Set(["prefetch", "translation-batch"]);
const FOREGROUND_TRANSLATION_TIMEOUT_MS = 5000;
const MIN_SENTENCE_TRANSITION_MS = 800;
const LOADING_FADE_MS = 240;
const LOADING_ROBOT_KEYMAP_WAIT_MS = 700;
const LOADING_ROBOT_IMAGE_WAIT_MS = 1800;
const PREFETCH_STOPWORDS = new Set([
  "a", "ale", "do", "i", "je", "jsou", "k", "na", "ne", "o", "od", "po", "pro", "se", "si", "s", "u", "v", "ve", "z", "za", "že"
]);
const translationModes = {
  off: { label: "Off", delayMs: null },
  "timer-0": { label: "0s", delayMs: 0 },
  "timer-5": { label: "5s", delayMs: 5000 },
  "timer-10": { label: "10s", delayMs: 10000 },
  "timer-30": { label: "30s", delayMs: 30000 },
  visible: { label: "Visible", delayMs: 0 },
  reconstruct: { label: "Rebuild", delayMs: null }
};
const generationModes = {
  random: { label: "New word" },
  selected: { label: "Selected word" }
};
const contentModes = {
  standard: { label: "Standard", summary: "Curated, guided, and fully offline." },
  generative: { label: "Generative", summary: "Optional local AI for open-ended sentences." }
};
const audioSpeedOptions = Object.freeze([
  Object.freeze({ key: "slower", label: "Slower", rate: 0.5, rateLabel: "0.5×" }),
  Object.freeze({ key: "slow", label: "Slow", rate: 0.6, rateLabel: "0.6×" }),
  Object.freeze({ key: "normal", label: "Normal", rate: 1, rateLabel: "1×" })
]);

function normalizeWordWorldSpeechPaceKey(value) {
  const key = String(value || "").trim().toLocaleLowerCase("en-US");
  return audioSpeedOptions.some((option) => option.key === key) ? key : "";
}

export function resolveWordWorldSpeechPace(
  difficulty,
  persistedPreference = "",
  selectedPreference = ""
) {
  const preference = normalizeWordWorldSpeechPaceKey(selectedPreference)
    || normalizeWordWorldSpeechPaceKey(persistedPreference);
  const resolved = resolveSpeechPace(difficulty, preference);
  const option = audioSpeedOptions.find((candidate) => candidate.key === resolved.key);
  return {
    ...resolved,
    rate: option?.rate ?? resolved.rate
  };
}

const playInstruction = "Use the side arrows or swipe to move between sentences. Tap any word for its meaning.";
const reconstructionInstruction = "Build the English sentence. Submit, then swipe to continue.";
const reconstructionFallbackTexts = [
  "I am here.",
  "You are ready.",
  "We have time.",
  "He is at home.",
  "She is outside.",
  "It is cold today.",
  "The book is on the table.",
  "My friend has a dog.",
  "They are not far away.",
  "This is very good."
];

function wordMatchesTarget(candidate, target) {
  const searchKey = providerContext?.normalization?.searchKey;
  if (typeof searchKey === "function") {
    const candidateKey = searchKey(candidate, { purpose: "word-world-token-match" });
    const targetKey = searchKey(target, { purpose: "word-world-token-match" });
    if (candidateKey && candidateKey === targetKey) return true;
  }
  return legacyWordMatchesTarget(candidate, target);
}

function normalizeWordWorldHistoryEntry(entry = {}) {
  const sentence = String(entry.cs || entry.sentence || "").normalize("NFC").replace(/\s+/g, " ").trim().slice(0, 180);
  const word = String(entry.word || "").normalize("NFC").trim();
  if (!sentence || !word) return null;
  const contentMode = entry.contentMode === "standard" ? "standard" : "generative";
  const difficulty = Number(entry.difficulty);
  return {
    id: String(entry.id || entry.entryId || "").trim(),
    word,
    sentence,
    en: String(entry.en || entry.translation || "").normalize("NFC").replace(/\s+/g, " ").trim().slice(0, 220),
    contentMode,
    source: String(entry.source || (contentMode === "standard" ? "standard-corpus" : "history")).trim().slice(0, 64),
    corpusVersion: String(entry.corpusVersion || "").trim().slice(0, 64),
    difficulty: difficulty >= 1 && difficulty <= 3 ? Math.floor(difficulty) : null,
    sceneQuery: String(entry.sceneQuery || entry.en || entry.translation || "").normalize("NFC").replace(/\s+/g, " ").trim().slice(0, 220)
  };
}

function migrateWordWorldHistory(entries, { limit = 256 } = {}) {
  const seen = new Set();
  return (Array.isArray(entries) ? entries : [])
    .map(normalizeWordWorldHistoryEntry)
    .filter((entry) => {
      if (!entry) return false;
      const key = entry.sentence.toLocaleLowerCase(targetLocale).replace(/[^\p{L}\p{M}\d]+/gu, " ").trim();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, Math.max(1, Number(limit) || 256));
}

function normalizedSelectionKey(value, searchKey) {
  const normalized = typeof searchKey === "function"
    ? searchKey(value, { purpose: "word-world-semantic-selection" })
    : normalizeWord(value).toLocaleLowerCase("en-US");
  return String(normalized || "").trim();
}

function recordMatchesSelectedWord(record, selectedWord, searchKey) {
  const requestedKey = normalizedSelectionKey(selectedWord, searchKey);
  return Boolean(requestedKey) && (Array.isArray(record?.targets) ? record.targets : []).some((target) => (
    target?.playable !== false
    && normalizedSelectionKey(target?.normalized || target?.surface, searchKey) === requestedKey
  ));
}

function semanticSelectionMode(value) {
  return value === "embedding" || value === "lexical" ? value : "provider";
}

export async function selectStandardTurn(provider, {
  generationMode = "random",
  selectedWord = "",
  difficulty = 1,
  excludeIds = [],
  allowSelectedRandomFallback = true,
  englishQuery = "",
  searchEnglish = null,
  searchKey = null
} = {}) {
  if (!provider || typeof provider.nextRandom !== "function" || typeof provider.nextForWord !== "function") {
    throw new TypeError("A prepared Word World selection provider is required.");
  }
  if (generationMode !== "selected") {
    return provider.nextRandom({ difficulty, excludeIds });
  }
  const deterministic = provider.nextForWord(selectedWord, {
        difficulty,
        excludeIds,
        allowRandomFallback: allowSelectedRandomFallback
      });
  const query = String(englishQuery || "").normalize("NFC").replace(/\s+/gu, " ").trim();
  if (!query || typeof searchEnglish !== "function") {
    return deterministic ? { ...deterministic, semanticMode: "provider" } : null;
  }
  try {
    const ranked = await searchEnglish(query);
    const excluded = new Set((Array.isArray(excludeIds) ? excludeIds : []).map(String));
    const level = Math.max(1, Math.min(3, Math.floor(Number(difficulty) || 1)));
    for (const rankedRecord of Array.isArray(ranked?.records) ? ranked.records : []) {
      const id = recordIdentifier(rankedRecord);
      const record = typeof provider.getRecordById === "function"
        ? provider.getRecordById(id)
        : provider.records?.find((candidate) => recordIdentifier(candidate) === id);
      if (!record || excluded.has(recordIdentifier(record))
          || Math.max(1, Math.floor(Number(record.difficulty) || 1)) > level
          || !recordMatchesSelectedWord(record, selectedWord, searchKey)) continue;
      return {
        record,
        fallback: false,
        requestedWord: deterministic?.requestedWord || selectedWord,
        semanticMode: semanticSelectionMode(ranked.mode)
      };
    }
    return deterministic
      ? { ...deterministic, semanticMode: "provider" }
      : null;
  } catch {
    return deterministic ? { ...deterministic, semanticMode: "provider" } : null;
  }
}

export async function runOwnedSemanticSelection({
  select,
  canPresent = () => true,
  present,
  releaseBusy = () => {},
  onSelectionError = () => {}
} = {}) {
  if (typeof select !== "function" || typeof canPresent !== "function"
      || typeof present !== "function" || typeof releaseBusy !== "function"
      || typeof onSelectionError !== "function") {
    throw new TypeError("Semantic selection requires callable ownership hooks.");
  }
  let presentationOwnsBusy = false;
  try {
    const selection = await select();
    if (!selection?.record) {
      return { selection: selection || null, presented: false, skipped: false, error: null };
    }
    if (!canPresent(selection)) {
      return { selection, presented: false, skipped: true, error: null };
    }
    presentationOwnsBusy = true;
    await present(selection);
    return { selection, presented: true, skipped: false, error: null };
  } catch (error) {
    if (presentationOwnsBusy) throw error;
    onSelectionError(error);
    return { selection: null, presented: false, skipped: false, error };
  } finally {
    if (!presentationOwnsBusy) releaseBusy();
  }
}

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
  selectedWordGapNotice: "",
  wordMeaningLoading: false,
  wordMeaningCache: new Map(),
  dictionaryGapKeys: loadDictionaryGapKeys(),
  wordLookupController: null,
  wordLookupRequestId: 0,
  wordCardPreferences: loadWordCardPreferences(),
  audioAutoplay: loadAudioAutoplay(),
  lastAutoplayFingerprint: "",
  currentSentence: "",
  currentTranslation: "",
  currentSceneQuery: "",
  currentSceneAsset: null,
  currentEntryId: "",
  currentCorpusVersion: "",
  currentDifficulty: null,
  currentStandardRecord: null,
  currentContentMode: "",
  generativeTurnActive: false,
  translationMode: loadTranslationMode(),
  generationMode: loadGenerationMode(),
  contentMode: loadContentMode(),
  translationVisible: true,
  translationTimerId: 0,
  sentenceRewardKeys: new Set(),
  reconstruction: null,
  speechSession: null,
  speechBackend: "",
  speechSource: "",
  speechText: "",
  speechPacePreference: "",
  speechRequestId: 0,
  speechState: "idle",
  speechTimeoutId: 0,
  nativeSpeechAvailable: false,
  nativeSpeechReason: "",
  nativeSpeechVoice: "",
  nativeSpeechVoiceLocal: false,
  nativeSpeechLocalVoiceAvailable: false,
  nativeSpeechRequestedVoiceAvailable: true,
  nativeSpeechStatusPending: false,
  nativeSpeechStatusRequestId: 0,
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
  loadingRobotReadyPromise: Promise.resolve(false),
  loadingRobotVisibleAt: 0,
  loadingHideTimerId: 0,
  feedbackSnapshot: null,
  feedbackReportedKey: "",
  standardProvider: null,
  standardCorpusPromise: null,
  standardCorpusError: "",
  standardCorpusLoading: false,
  semanticSelectionMode: "",
  guidedRequested: false,
  guidedMode: false,
  guidedStatus: "off",
  guidedError: "",
  guidedResolution: null,
  guidedLifecycle: null,
  guidedFocusTarget: null,
  guidedEvidencePending: false,
  guidedActivationEpoch: 0,
  guidedSupportAtFirstResponse: false,
  guidedResetPending: false
};

const $ = (selector) => mountRoot?.querySelector(selector) || document.querySelector(selector);

function explicitLocalGuidedRequest() {
  // The retired developer mode cannot replace normal Word World practice.
  return false;
}

function guidedJourneyStep(activityId) {
  return null;
}

function guidedJourneyHref(activityId) {
  const step = guidedJourneyStep(activityId);
  if (!step?.route) return "";
  return new URL(step.route, window.location.href).href;
}

function waitForPaintedFrame() {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(resolve));
  });
}

function guidedWordPresentationReady(requestId, recordId, lifecycle, activationEpoch) {
  const panel = $(".word-net-sentence-panel");
  return Boolean(
    state.guidedMode
    && state.guidedStatus === "activating"
    && !state.guidedResetPending
    && state.guidedActivationEpoch === activationEpoch
    && state.phraseRequestId === requestId
    && state.currentEntryId === recordId
    && state.guidedLifecycle === lifecycle
    && document.visibilityState !== "hidden"
    && panel
    && !panel.hidden
  );
}

function waitForGuidedWordVisibility(requestId, recordId, lifecycle, activationEpoch) {
  if (document.visibilityState !== "hidden") return Promise.resolve(true);
  return new Promise((resolve) => {
    const finish = () => {
      const current = state.phraseRequestId === requestId
        && state.currentEntryId === recordId
        && state.guidedLifecycle === lifecycle
        && state.guidedActivationEpoch === activationEpoch;
      if (document.visibilityState === "hidden" && current) return;
      document.removeEventListener("visibilitychange", finish);
      window.removeEventListener("pagehide", finish);
      resolve(current);
    };
    document.addEventListener("visibilitychange", finish);
    window.addEventListener("pagehide", finish, { once: true });
  });
}

async function activatePresentedGuidedWord(requestId, recordId, lifecycle) {
  const activationEpoch = state.guidedActivationEpoch + 1;
  state.guidedActivationEpoch = activationEpoch;
  while (
    state.phraseRequestId === requestId
    && state.currentEntryId === recordId
    && state.guidedLifecycle === lifecycle
  ) {
    const visible = await waitForGuidedWordVisibility(
      requestId,
      recordId,
      lifecycle,
      activationEpoch
    );
    if (!visible) return null;
    await waitForPaintedFrame();
    if (!guidedWordPresentationReady(requestId, recordId, lifecycle, activationEpoch)) continue;
    const activation = await lifecycle.activate({
      requirePresented: () => guidedWordPresentationReady(
        requestId,
        recordId,
        lifecycle,
        activationEpoch
      )
    });
    if (activation?.phase === "pending") continue;
    if (!guidedWordPresentationReady(requestId, recordId, lifecycle, activationEpoch)) continue;
    return activation;
  }
  return null;
}

function guidedWordInteractionLocked() {
  return state.guidedRequested && (
    !state.guidedMode
    || ["loading", "pending", "activating", "failed"].includes(state.guidedStatus)
    || state.guidedEvidencePending
    || state.guidedResetPending
  );
}

function failGuidedWordWorld(error, message = "Guided Word World is locked.") {
  const lifecycle = state.guidedLifecycle;
  if (lifecycle?.abort) {
    void lifecycle.abort().catch((abortError) => {
      console.error("Guided Word World lifecycle could not be released", abortError);
    });
  }
  if (state.guidedLifecycle === lifecycle) state.guidedLifecycle = null;
  state.guidedStatus = "failed";
  state.guidedError = error?.message || String(error || message);
  state.guidedEvidencePending = false;
  setStatus(message, { tone: "error" });
  renderWordGuidedStatus();
  syncGenerationControl();
  syncContentControl();
  renderReconstruction();
}

function renderWordGuidedStatus() {
  const banner = $("#wordNetGuidedStatus");
  const detail = $("#wordNetGuidedStatusDetail");
  if (!banner || !detail) return;
  banner.hidden = true;
  banner.removeAttribute("role");
  banner.removeAttribute("aria-live");
  banner.removeAttribute("aria-atomic");
  banner.classList.toggle("is-error", state.guidedStatus === "failed");
  const lifecycle = state.guidedLifecycle?.state();
  const supported = Boolean(lifecycle?.hintsUsed || lifecycle?.solutionRevealed);
  const supportedBeforeResponse = Boolean(state.guidedSupportAtFirstResponse);
  const reviewedAfterResponse = Boolean(
    lifecycle?.firstResponseRecorded && supported && !supportedBeforeResponse
  );
  banner.classList.toggle("is-supported", supported);
  if (!state.guidedRequested) return;
  if (state.guidedStatus === "failed") {
    detail.textContent = `Locked: ${state.guidedError || "curriculum evidence is unavailable"}`;
  } else if (state.guidedStatus === "complete") {
    detail.textContent = supportedBeforeResponse
      ? "Pilot complete · supported practice, not independent evidence"
      : reviewedAfterResponse
        ? "Pilot complete · first response recorded independently; solution reviewed afterward"
      : "Pilot complete · Unit 3 remains locked behind Units 1–2";
  } else if (supportedBeforeResponse) {
    detail.textContent = "Supported practice · not independent evidence";
  } else if (reviewedAfterResponse) {
    detail.textContent = "First response recorded independently · solution reviewed afterward";
  } else if (lifecycle?.firstResponseRecorded) {
    detail.textContent = "First response recorded · this one pilot task is closed";
  } else if (state.guidedStatus === "ready") {
    detail.textContent = "Unit 3 mechanic pilot · independent comprehension, non-mastery";
  } else {
    detail.textContent = "Verifying the exact bound content and evidence task…";
  }
}

async function initializeGuidedWordWorldMode({ force = false } = {}) {
  return;
}

async function prepareGuidedWordProgressReset() {
  if (!state.guidedRequested && !state.guidedLifecycle) return;
  state.guidedResetPending = true;
  state.guidedActivationEpoch += 1;
  state.phraseRequestId += 1;
  clearTranslationTimer();
  cancelBackgroundWork();
  const lifecycle = state.guidedLifecycle;
  if (lifecycle?.abort) await lifecycle.abort();
  if (state.guidedLifecycle === lifecycle) state.guidedLifecycle = null;
  state.guidedEvidencePending = false;
}

async function restartGuidedWordWorldAfterReset({ resetCompleted = true } = {}) {
  state.guidedResetPending = false;
  state.guidedActivationEpoch += 1;
  state.phraseRequestId += 1;
  state.guidedMode = false;
  state.guidedStatus = "loading";
  state.guidedError = "";
  state.guidedResolution = null;
  state.guidedLifecycle = null;
  state.guidedFocusTarget = null;
  state.guidedEvidencePending = false;
  state.guidedSupportAtFirstResponse = false;
  state.reconstruction = null;
  setBusy(true);
  setStatus(
    resetCompleted
      ? "Preparing the first Guided Word World task again."
      : "The restart was cancelled. Rechecking the existing Guided task.",
    { tone: "active" }
  );
  await initializeGuidedWordWorldMode({ force: true });
  if (!state.guidedMode) {
    setBusy(false);
    renderWordGuidedStatus();
    return;
  }
  try {
    await initializeStandardCorpus();
    await generateGuidedStandardPhrase({ allowBusy: true });
  } finally {
    if (state.busy) setBusy(false);
  }
}

function runtimeAdapter() {
  return window.CaatuuRuntime || null;
}

function browserSpeechSynthesisSupported() {
  return isSpeechSynthesisSupported(
    window.speechSynthesis,
    window.SpeechSynthesisUtterance
  );
}

function androidSpeechRuntime() {
  const runtime = runtimeAdapter();
  if (runtime?.env !== "android" || !runtime.speech) return null;
  return runtime.speech;
}

function speechControlSupported() {
  return androidSpeechRuntime()
    ? state.nativeSpeechAvailable
    : browserSpeechSynthesisSupported();
}

function preferredSpeechVoice() {
  return String(window.CaatuuChrome?.getSpeechVoicePreference?.() || "").trim().slice(0, 256);
}

function sharedCzechSpeechApi() {
  const api = window.CaatuuChrome;
  const speak = api?.speakText || api?.speakCzechText;
  const stop = api?.stopSpeech || api?.stopCzechSpeech;
  if (typeof speak !== "function" || typeof stop !== "function") return null;
  return Object.freeze({
    speak: (...args) => speak.call(api, ...args),
    stop: (...args) => stop.call(api, ...args),
    install: typeof (api?.installSpeechData || api?.installCzechSpeechData) === "function"
      ? (...args) => (api.installSpeechData || api.installCzechSpeechData).call(api, ...args)
      : null
  });
}

function czechSpeechPace() {
  const difficulty = learningDifficulty();
  const persistedPreference = window.CaatuuChrome?.getSpeechPacePreference?.() || "";
  const pace = resolveWordWorldSpeechPace(
    difficulty,
    persistedPreference,
    state.speechPacePreference
  );
  const badge = String(
    window.CaatuuLearning?.difficultyOption?.(difficulty)?.label || `Level ${difficulty}`
  );
  return { ...pace, difficulty, badge };
}

function loadAudioAutoplay() {
  try {
    const stored = window.localStorage.getItem(AUDIO_AUTOPLAY_STORAGE_KEY);
    return stored === null ? true : stored === "true";
  } catch (error) {
    return true;
  }
}

function saveAudioAutoplay() {
  try {
    window.localStorage.setItem(AUDIO_AUTOPLAY_STORAGE_KEY, String(state.audioAutoplay));
  } catch (error) {
    // The choice remains active for this session when storage is unavailable.
  }
}

function unavailableSpeechTitle() {
  if (!androidSpeechRuntime()) return "This browser does not expose built-in speech synthesis.";
  if (state.nativeSpeechReason === "missing-language-data") {
    return `Install or enable a ${targetLanguageLabel} voice in Android text-to-speech settings.`;
  }
  if (state.nativeSpeechReason === "no-language-voice") {
    return `The selected Android text-to-speech engine does not provide a ${targetLanguageLabel} voice.`;
  }
  return "Android text-to-speech is not ready on this device.";
}

function unavailableSpeechLabel() {
  if (state.nativeSpeechReason === "missing-language-data") {
    return `${targetLanguageLabel} pronunciation unavailable; install or enable a ${targetLanguageLabel} voice in Android text-to-speech settings`;
  }
  if (state.nativeSpeechReason === "no-language-voice") {
    return `${targetLanguageLabel} pronunciation unavailable; select an Android text-to-speech engine with a ${targetLanguageLabel} voice`;
  }
  return `${targetLanguageLabel} pronunciation unavailable on this device`;
}

function syncSpeechControl() {
  const sentenceButton = $("#wordNetPhraseSound");
  const wordButton = $("#wordNetSelectedWordSound");
  if (!sentenceButton && !wordButton) return;

  const speechPace = czechSpeechPace();
  const paceDescription = `${speechPace.label} speed`;
  const supported = speechControlSupported();
  const checking = Boolean(androidSpeechRuntime() && state.nativeSpeechStatusPending);
  const hasSentence = Boolean(String(state.currentSentence || "").trim());
  const speaking = state.speechState === "speaking" && Boolean(state.speechSession);
  const sentenceSpeaking = speaking && state.speechSource === "sentence";
  let sentenceLabel = `Play ${targetLanguageLabel} sentence aloud — ${paceDescription}`;
  let sentenceTitle = sentenceLabel;

  if (checking) {
    sentenceLabel = `Checking ${targetLanguageLabel} pronunciation support`;
    sentenceTitle = `Checking the device's ${targetLanguageLabel} text-to-speech voice.`;
  } else if (!supported) {
    sentenceLabel = unavailableSpeechLabel();
    sentenceTitle = unavailableSpeechTitle();
  } else if (state.busy || !hasSentence) {
    sentenceLabel = `${targetLanguageLabel} pronunciation will be available when the sentence is ready`;
    sentenceTitle = `Wait for the ${targetLanguageLabel} sentence to finish loading.`;
  } else if (sentenceSpeaking) {
    sentenceLabel = `Stop ${targetLanguageLabel} sentence pronunciation`;
    sentenceTitle = sentenceLabel;
  }

  if (sentenceButton) {
    sentenceButton.dataset.speechPace = speechPace.label;
    sentenceButton.dataset.speechPaceSource = speechPace.source;
    sentenceButton.dataset.speechDifficulty = String(speechPace.difficulty);
    sentenceButton.dataset.speechRate = String(speechPace.rate);
    sentenceButton.disabled = checking || state.busy || !supported || !hasSentence;
    sentenceButton.classList.toggle("is-speaking", sentenceSpeaking);
    sentenceButton.setAttribute("aria-pressed", String(sentenceSpeaking));
    sentenceButton.setAttribute("aria-label", sentenceLabel);
    sentenceButton.title = sentenceTitle;
    sentenceButton.querySelector('[data-speech-icon="play"]')?.toggleAttribute("hidden", sentenceSpeaking);
    sentenceButton.querySelector('[data-speech-icon="stop"]')?.toggleAttribute("hidden", !sentenceSpeaking);
  }

  const selectedWord = normalizeWord(state.selectedWord);
  const wordAvailable = Boolean(selectedWord) && state.translationMode !== "off";
  const wordSpeaking = speaking && state.speechSource === "word";
  let wordLabel = selectedWord
    ? `Play “${selectedWord}” aloud — ${paceDescription}`
    : `Play selected ${targetLanguageLabel} word aloud — ${paceDescription}`;
  let wordTitle = wordLabel;
  if (checking) {
    wordLabel = `Checking ${targetLanguageLabel} pronunciation support`;
    wordTitle = `Checking the device's ${targetLanguageLabel} text-to-speech voice.`;
  } else if (!supported) {
    wordLabel = unavailableSpeechLabel();
    wordTitle = unavailableSpeechTitle();
  } else if (state.busy || !wordAvailable) {
    wordLabel = `Select a ${targetLanguageLabel} word to hear it`;
    wordTitle = wordLabel;
  } else if (wordSpeaking) {
    wordLabel = `Stop pronunciation of “${selectedWord}”`;
    wordTitle = wordLabel;
  }
  if (wordButton) {
    wordButton.dataset.speechPace = speechPace.label;
    wordButton.dataset.speechPaceSource = speechPace.source;
    wordButton.dataset.speechDifficulty = String(speechPace.difficulty);
    wordButton.dataset.speechRate = String(speechPace.rate);
    wordButton.disabled = checking || state.busy || !supported || !wordAvailable;
    wordButton.classList.toggle("is-speaking", wordSpeaking);
    wordButton.setAttribute("aria-pressed", String(wordSpeaking));
    wordButton.setAttribute("aria-label", wordLabel);
    wordButton.title = wordTitle;
    wordButton.querySelector('[data-speech-icon="play"]')?.toggleAttribute("hidden", wordSpeaking);
    wordButton.querySelector('[data-speech-icon="stop"]')?.toggleAttribute("hidden", !wordSpeaking);
  }
  syncAudioSettingsControl();
}

function syncAudioSettingsControl() {
  const toggle = $("#wordNetSound");
  const autoplay = $("#wordNetAudioAutoplay");
  const speed = $("#wordNetAudioSpeed");
  const pace = czechSpeechPace();
  const paceDescription = `${pace.label} speed`;
  if (toggle) {
    toggle.dataset.speechPace = pace.label;
    toggle.dataset.speechPaceSource = pace.source;
    toggle.dataset.speechRate = String(pace.rate);
    toggle.setAttribute("aria-label", `${targetLanguageLabel} audio settings. Current: ${paceDescription}.`);
    toggle.title = `${targetLanguageLabel} audio settings — ${paceDescription}`;
  }
  const paceIndex = Math.max(0, audioSpeedOptions.findIndex((option) => option.key === pace.key));
  const paceOption = audioSpeedOptions[paceIndex];
  if (speed) {
    speed.value = String(paceIndex);
    speed.setAttribute("aria-valuetext", `${paceOption.label}, ${paceOption.rateLabel} speed`);
    speed.style.setProperty("--audio-speed-progress", `${paceIndex * 50}%`);
  }
  if (autoplay) autoplay.setAttribute("aria-checked", String(state.audioAutoplay));
}

async function refreshAudioVoiceOptions() {
  const select = $("#wordNetAudioVoice");
  const status = $("#wordNetAudioVoiceStatus");
  const installButton = $("#wordNetAudioInstallVoice");
  const api = window.CaatuuChrome;
  if (!select || !api?.listSpeechVoiceOptions) return;
  select.disabled = true;
  if (status) status.textContent = `Checking ${targetLanguageLabel} voices...`;
  try {
    const result = api.getSpeechVoiceControlState
      ? await api.getSpeechVoiceControlState()
      : await api.listSpeechVoiceOptions();
    const preferred = preferredSpeechVoice();
    const options = [new Option("Automatic (recommended)", "")];
    for (const voice of result?.voices || []) {
      options.push(new Option(
        `${voice.name}${voice.locale ? ` · ${voice.locale}` : ""}`,
        voice.value || ""
      ));
    }
    select.replaceChildren(...options);
    const matching = [...select.options].find((option) => (
      option.value === preferred || option.value.endsWith(`:${preferred}`)
    ));
    select.value = matching?.value || "";
    select.disabled = result?.available === false && !(result?.voices || []).length;
    if (status) {
      status.textContent = api.describeSpeechVoiceState
        ? api.describeSpeechVoiceState(result)
        : (result?.available
          ? `${targetLanguageLabel} voice ready.`
          : `${targetLanguageLabel} voice unavailable.`);
    }
    if (installButton) {
      installButton.hidden = result?.backend !== "android" || result?.canInstallVoice !== true;
      installButton.disabled = false;
    }
  } catch (error) {
    select.disabled = true;
    if (status) status.textContent = `Unable to check ${targetLanguageLabel} voices.`;
    if (installButton) installButton.hidden = true;
  }
}

function previewCurrentCzechSentenceFromAudioMenu() {
  const sentence = String(state.currentSentence || "").normalize("NFC").trim();
  if (!sentence) return;
  cancelCzechSpeech({ force: true });
  toggleCzechSpeech(sentence, "sentence");
}

async function installCzechVoiceFromAudioMenu() {
  const button = $("#wordNetAudioInstallVoice");
  const status = $("#wordNetAudioVoiceStatus");
  const install = sharedCzechSpeechApi()?.install;
  if (!button || button.disabled || !install || !androidSpeechRuntime()) return;
  button.disabled = true;
  if (status) status.textContent = "Opening Android voice installation...";
  try {
    const result = await install();
    if (status) {
      status.textContent = result?.launched === false
        ? `Open Android speech settings to add a ${targetLanguageLabel} voice.`
        : `Finish adding the ${targetLanguageLabel} voice in Android, then return here.`;
    }
  } catch (error) {
    if (status) status.textContent = "Android could not open its voice installation settings.";
  } finally {
    button.disabled = false;
    void refreshAndroidSpeechStatus({ force: true });
  }
}

function syncDisplaySettingsControl() {
  const toggle = $("#wordNetDisplayToggle");
  const theme = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
  const fontSize = document.documentElement.dataset.fontSize || "largest";
  const themeLabel = theme === "dark" ? "Dark" : "Light";
  const fontSizeLabel = {
    largest: "Standard",
    large: "Small",
    standard: "Smaller"
  }[fontSize] || "Standard";
  if (toggle) {
    const label = `Display settings. Current: ${themeLabel} theme, ${fontSizeLabel} text.`;
    toggle.setAttribute("aria-label", label);
    toggle.title = label;
  }
  document.querySelectorAll("#wordNetDisplayMenu [data-theme-option]").forEach((button) => {
    const selected = button.dataset.themeOption === theme;
    button.classList.toggle("is-active", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  document.querySelectorAll("#wordNetDisplayMenu [data-font-size-option]").forEach((button) => {
    const selected = button.dataset.fontSizeOption === fontSize;
    button.classList.toggle("is-active", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
}

function closeDisplayMenu({ restoreFocus = false } = {}) {
  const menu = $("#wordNetDisplayMenu");
  const button = $("#wordNetDisplayToggle");
  if (menu) menu.hidden = true;
  if (button) button.setAttribute("aria-expanded", "false");
  if (restoreFocus) button?.focus({ preventScroll: true });
}

function openDisplayMenu() {
  const menu = $("#wordNetDisplayMenu");
  const button = $("#wordNetDisplayToggle");
  if (!menu || !button) return;
  closeAudioMenu();
  closeTranslationMenu();
  closeGenerationMenu();
  syncDisplaySettingsControl();
  menu.hidden = false;
  button.setAttribute("aria-expanded", "true");
}

function toggleDisplayMenu() {
  const menu = $("#wordNetDisplayMenu");
  if (!menu) return;
  if (menu.hidden) openDisplayMenu();
  else closeDisplayMenu({ restoreFocus: true });
}

function closeAudioMenu({ restoreFocus = false } = {}) {
  const menu = $("#wordNetAudioMenu");
  const button = $("#wordNetSound");
  if (menu) menu.hidden = true;
  if (button) button.setAttribute("aria-expanded", "false");
  if (restoreFocus) button?.focus({ preventScroll: true });
}

function openAudioMenu() {
  const menu = $("#wordNetAudioMenu");
  const button = $("#wordNetSound");
  if (!menu || !button) return;
  closeDisplayMenu();
  closeTranslationMenu();
  closeGenerationMenu();
  syncAudioSettingsControl();
  menu.hidden = false;
  button.setAttribute("aria-expanded", "true");
  void refreshAudioVoiceOptions();
}

function toggleAudioMenu() {
  const menu = $("#wordNetAudioMenu");
  if (!menu) return;
  if (menu.hidden) openAudioMenu();
  else closeAudioMenu({ restoreFocus: true });
}

function clearCzechSpeechTimeout() {
  if (!state.speechTimeoutId) return;
  window.clearTimeout(state.speechTimeoutId);
  state.speechTimeoutId = 0;
}

function cancelCzechSpeech({ force = false } = {}) {
  const session = state.speechSession;
  const active = Boolean(state.speechSession) || state.speechState === "speaking";
  if (!active && !force) {
    syncSpeechControl();
    return false;
  }

  const backend = state.speechBackend;
  clearCzechSpeechTimeout();
  state.speechRequestId += 1;
  state.speechSession = null;
  state.speechBackend = "";
  state.speechSource = "";
  state.speechText = "";
  state.speechState = "idle";
  if (backend === "shared") {
    void sharedCzechSpeechApi()?.stop?.();
  } else if (backend === "android") {
    session?.controller?.abort?.();
  } else if (backend === "browser" || (force && browserSpeechSynthesisSupported())) {
    try {
      window.speechSynthesis.cancel();
    } catch (error) {
      // The control still returns to idle if the platform speech queue disappeared.
    }
  }
  syncSpeechControl();
  return active;
}

function reportCzechSpeechFailure() {
  setStatus(
    `This device could not pronounce the ${targetLanguageLabel} text. Check its ${targetLanguageLabel} text-to-speech voice and try again.`,
    { tone: "error" }
  );
}

function finishCzechSpeech(session, requestId, errorCode = "") {
  if (state.speechSession !== session || state.speechRequestId !== requestId) return;
  state.speechSession = null;
  state.speechBackend = "";
  state.speechSource = "";
  state.speechText = "";
  state.speechState = "idle";
  clearCzechSpeechTimeout();
  syncSpeechControl();

  const normalizedError = String(errorCode || "").toLocaleLowerCase("en-US");
  if (normalizedError && !EXPECTED_SPEECH_CANCELLATIONS.has(normalizedError)) {
    reportCzechSpeechFailure();
  }
}

function speakCzechWithSharedService(text, source, pace) {
  const api = sharedCzechSpeechApi();
  if (!api) return false;

  const session = { backend: "shared", text, source };
  const requestId = state.speechRequestId + 1;
  state.speechRequestId = requestId;
  state.speechSession = session;
  state.speechBackend = "shared";
  state.speechSource = source;
  state.speechText = text;
  state.speechState = "speaking";
  syncSpeechControl();

  void api.speak(text, {
    locale: targetSpeechLocale,
    rate: pace.rate,
    pitch: 1,
    voice: preferredSpeechVoice(),
    onStart() {
      if (state.speechSession !== session || state.speechRequestId !== requestId) return;
      state.speechState = "speaking";
      syncSpeechControl();
    }
  }).then((result) => {
    const errorCode = result?.outcome === "error" ? "synthesis-failed" : "";
    finishCzechSpeech(session, requestId, errorCode);
  }).catch((error) => {
    const errorCode = error?.name === "AbortError" ? "canceled" : "synthesis-failed";
    finishCzechSpeech(session, requestId, errorCode);
  });
  return true;
}

function speakCzechWithAndroid(text, source, pace) {
  const speech = androidSpeechRuntime();
  if (!speech || !state.nativeSpeechAvailable) {
    syncSpeechControl();
    return;
  }

  const session = { backend: "android", text, source, controller: new AbortController() };
  const requestId = state.speechRequestId + 1;
  state.speechRequestId = requestId;
  state.speechSession = session;
  state.speechBackend = "android";
  state.speechSource = source;
  state.speechText = text;
  state.speechState = "speaking";
  syncSpeechControl();

  void speech.speak(
    text,
    { locale: targetSpeechLocale, rate: pace.rate, pitch: 1, voice: preferredSpeechVoice() },
    {
      signal: session.controller.signal,
      onEvent(event) {
        if (
          state.speechSession !== session
          || state.speechRequestId !== requestId
          || event?.kind !== "speech"
          || event?.phase !== "started"
        ) return;
        state.speechState = "speaking";
        syncSpeechControl();
      }
    }
  ).then((result) => {
    const errorCode = result?.outcome === "error" ? "native-synthesis-failed" : "";
    finishCzechSpeech(session, requestId, errorCode);
  }).catch((error) => {
    const errorCode = error?.name === "AbortError" ? "canceled" : "native-synthesis-failed";
    finishCzechSpeech(session, requestId, errorCode);
  });
}

function speakCzechWithBrowser(text, source, pace) {
  const synthesis = window.speechSynthesis;
  const requestId = state.speechRequestId + 1;
  state.speechRequestId = requestId;
  let utterance = null;
  try {
    utterance = new window.SpeechSynthesisUtterance(text);
    utterance.lang = targetSpeechLocale;
    utterance.rate = pace.rate;
    utterance.pitch = 1;
    try {
      const voices = typeof synthesis.getVoices === "function" ? synthesis.getVoices() : [];
      const requestedVoice = preferredSpeechVoice();
      const requestedLanguage = targetSpeechLocale.split(/[-_]/u)[0].toLocaleLowerCase("en-US");
      const savedVoice = voices.find((voice) => (
        String(voice?.voiceURI || voice?.name || "") === requestedVoice
        && String(voice?.lang || "").split(/[-_]/u)[0].toLocaleLowerCase("en-US") === requestedLanguage
      ));
      const preferredVoice = savedVoice || selectSpeechSynthesisVoice(voices, targetSpeechLocale);
      if (preferredVoice) utterance.voice = preferredVoice;
    } catch (error) {
      // Leaving voice unset lets the device resolve utterance.lang itself.
    }
  } catch (error) {
    syncSpeechControl();
    reportCzechSpeechFailure();
    return;
  }

  utterance.onstart = () => {
    if (state.speechSession !== utterance || state.speechRequestId !== requestId) return;
    state.speechState = "speaking";
    syncSpeechControl();
  };
  utterance.onend = () => finishCzechSpeech(utterance, requestId);
  utterance.onerror = (event) => finishCzechSpeech(utterance, requestId, event?.error);
  state.speechSession = utterance;
  state.speechBackend = "browser";
  state.speechSource = source;
  state.speechText = text;
  state.speechState = "speaking";
  syncSpeechControl();

  try {
    synthesis.cancel();
    state.speechTimeoutId = window.setTimeout(() => {
      finishCzechSpeech(utterance, requestId, "synthesis-timeout");
    }, CZECH_SPEECH_TIMEOUT_MS);
    synthesis.speak(utterance);
  } catch (error) {
    finishCzechSpeech(utterance, requestId, "synthesis-failed");
  }
}

function toggleCzechSpeech(text, source) {
  const normalizedText = String(text || "").normalize("NFC").trim();
  const sameSpeech = Boolean(
    state.speechSession
    && state.speechSource === source
    && state.speechText === normalizedText
  );
  if (state.speechSession || state.speechState === "speaking") {
    cancelCzechSpeech();
    if (sameSpeech) return;
  }
  if (!speechControlSupported() || state.busy || !normalizedText) {
    syncSpeechControl();
    return;
  }

  const pace = czechSpeechPace();
  if (speakCzechWithSharedService(normalizedText, source, pace)) return;
  if (androidSpeechRuntime()) speakCzechWithAndroid(normalizedText, source, pace);
  else speakCzechWithBrowser(normalizedText, source, pace);
}

function speakCurrentCzechSentence() {
  toggleCzechSpeech(state.currentSentence, "sentence");
}

function speakSelectedCzechWord() {
  if (state.translationMode === "off") return;
  toggleCzechSpeech(state.selectedWord, "word");
}

function maybeAutoplayCurrentSentence({ force = false } = {}) {
  const fingerprint = sentenceFingerprint(state.currentSentence);
  if (
    !state.audioAutoplay
    || state.busy
    || !fingerprint
    || !speechControlSupported()
    || (!force && fingerprint === state.lastAutoplayFingerprint)
  ) return;
  state.lastAutoplayFingerprint = fingerprint;
  toggleCzechSpeech(state.currentSentence, "sentence");
}

async function refreshAndroidSpeechStatus({ force = false } = {}) {
  const speech = androidSpeechRuntime();
  if (!speech || (state.nativeSpeechStatusPending && !force)) return;
  const requestId = state.nativeSpeechStatusRequestId + 1;
  state.nativeSpeechStatusRequestId = requestId;
  state.nativeSpeechStatusPending = true;
  syncSpeechControl();
  try {
    const status = await speech.status(targetSpeechLocale, { voice: preferredSpeechVoice() });
    if (requestId !== state.nativeSpeechStatusRequestId) return;
    state.nativeSpeechAvailable = status?.available === true;
    state.nativeSpeechReason = String(status?.reason || "");
    state.nativeSpeechVoice = String(status?.voice || "");
    state.nativeSpeechVoiceLocal = status?.localService === true;
    state.nativeSpeechLocalVoiceAvailable = typeof status?.localVoiceAvailable === "boolean"
      ? status.localVoiceAvailable
      : (status?.voices || []).some((voice) => voice?.localService === true);
    state.nativeSpeechRequestedVoiceAvailable = status?.requestedVoiceAvailable !== false;
  } catch (error) {
    if (requestId !== state.nativeSpeechStatusRequestId) return;
    state.nativeSpeechAvailable = false;
    state.nativeSpeechReason = "engine-unavailable";
    state.nativeSpeechVoice = "";
    state.nativeSpeechVoiceLocal = false;
    state.nativeSpeechLocalVoiceAvailable = false;
    state.nativeSpeechRequestedVoiceAvailable = true;
  } finally {
    if (requestId === state.nativeSpeechStatusRequestId) {
      state.nativeSpeechStatusPending = false;
      syncSpeechControl();
    }
  }
}

function initializeSpeechControl() {
  syncSpeechControl();
  window.addEventListener("caatuu:speech-voice-change", async () => {
    cancelCzechSpeech();
    if (androidSpeechRuntime()) await refreshAndroidSpeechStatus({ force: true });
    else syncSpeechControl();
  });
  window.addEventListener("caatuu:speech-pace-change", (event) => {
    state.speechPacePreference = normalizeWordWorldSpeechPaceKey(event?.detail?.preference);
    cancelCzechSpeech();
    const pace = czechSpeechPace();
    syncSpeechControl();
    setStatus(
      pace.source === "override"
        ? `${targetLanguageLabel} audio now uses manual ${pace.label} speed.`
        : `${pace.badge} controls ${targetLanguageLabel} audio at ${pace.label} speed.`,
      { tone: "active" }
    );
  });
  window.addEventListener("caatuu:speech-voices-refresh", async () => {
    cancelCzechSpeech();
    if (androidSpeechRuntime()) await refreshAndroidSpeechStatus({ force: true });
    const menu = $("#wordNetAudioMenu");
    if (menu && !menu.hidden) await refreshAudioVoiceOptions();
  });
  if (androidSpeechRuntime()) {
    void refreshAndroidSpeechStatus();
    return;
  }
  const synthesis = window.speechSynthesis;
  if (!browserSpeechSynthesisSupported() || typeof synthesis.addEventListener !== "function") return;
  synthesis.addEventListener("voiceschanged", () => {
    syncSpeechControl();
    const menu = $("#wordNetAudioMenu");
    if (menu && !menu.hidden) void refreshAudioVoiceOptions();
  });
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

function readStoredObject(key) {
  try {
    const value = JSON.parse(window.localStorage.getItem(key) || "null");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch (error) {
    return {};
  }
}

function loadWordCardPreferences() {
  const stored = readStoredObject(WORD_CARD_PREFERENCES_STORAGE_KEY);
  return {
    showCard: stored.showCard !== false,
    autoPronounce: stored.autoPronounce !== false
  };
}

function saveWordCardPreferences() {
  if (state.guidedRequested) return;
  try {
    window.localStorage.setItem(
      WORD_CARD_PREFERENCES_STORAGE_KEY,
      JSON.stringify(state.wordCardPreferences)
    );
  } catch (error) {
    // Word-card preferences remain active for the current session.
  }
}

function loadDictionaryGapKeys() {
  const seen = new Set();
  return readStoredArray(DICTIONARY_GAP_STORAGE_KEY)
    .map((value) => normalizeWord(value).toLocaleLowerCase(targetLocale))
    .filter((value) => {
      if (!value || seen.has(value)) return false;
      seen.add(value);
      return true;
    })
    .slice(0, DICTIONARY_GAP_LIMIT);
}

function rememberDictionaryGap(key) {
  const normalized = normalizeWord(key).toLocaleLowerCase(targetLocale);
  if (!normalized || state.dictionaryGapKeys.includes(normalized)) return true;
  const previousKeys = [...state.dictionaryGapKeys];
  state.dictionaryGapKeys = [
    ...state.dictionaryGapKeys.slice(-(DICTIONARY_GAP_LIMIT - 1)),
    normalized
  ];
  try {
    localStorage.setItem(DICTIONARY_GAP_STORAGE_KEY, JSON.stringify(state.dictionaryGapKeys));
    return true;
  } catch (error) {
    state.dictionaryGapKeys = previousKeys;
    return false;
  }
}

function forgetDictionaryGap(key) {
  const normalized = normalizeWord(key).toLocaleLowerCase(targetLocale);
  if (!normalized || !state.dictionaryGapKeys.includes(normalized)) return true;
  const previousKeys = [...state.dictionaryGapKeys];
  state.dictionaryGapKeys = state.dictionaryGapKeys.filter((value) => value !== normalized);
  try {
    localStorage.setItem(DICTIONARY_GAP_STORAGE_KEY, JSON.stringify(state.dictionaryGapKeys));
    return true;
  } catch (error) {
    state.dictionaryGapKeys = previousKeys;
    return false;
  }
}

function loadHistory() {
  const current = readStoredArray(HISTORY_STORAGE_KEY);
  const legacy = current.length ? [] : readStoredArray(LEGACY_HISTORY_STORAGE_KEY);
  return migrateWordWorldHistory(current.length ? current : legacy, { limit: HISTORY_LIMIT });
}

function saveHistory() {
  try {
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(state.history.slice(0, HISTORY_LIMIT)));
  } catch (error) {
    // Phrase history remains available for the current session.
  }
}

function loadStandardUsage() {
  return readStoredObject(STANDARD_USAGE_STORAGE_KEY);
}

function saveStandardUsage() {
  if (!state.standardProvider) return;
  try {
    localStorage.setItem(STANDARD_USAGE_STORAGE_KEY, JSON.stringify(state.standardProvider.usage.snapshot()));
  } catch (error) {
    // Standard selection remains useful in memory when storage is unavailable.
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
    if (entry.contentMode === "standard") continue;
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

async function restoreSavedGenerativePhraseAtInit() {
  const historyIndex = state.history.findIndex((entry) => (
    entry.contentMode !== "standard" && entry.sentence
  ));
  if (historyIndex < 0) return false;

  const saved = state.history[historyIndex];
  const transitionStartedAt = performance.now();
  const requestId = state.phraseRequestId + 1;
  state.phraseRequestId = requestId;
  hideSceneAsset({ cancel: true });
  setBusy(true);
  try {
    state.historyCursor = historyIndex;
    state.currentWord = saved.word;
    state.currentSentence = saved.sentence;
    state.currentTranslation = saved.en || "";
    state.currentSceneQuery = saved.sceneQuery || saved.en || "";
    state.currentEntryId = saved.id || "";
    state.currentCorpusVersion = saved.corpusVersion || "";
    state.currentDifficulty = saved.difficulty || null;
    state.currentStandardRecord = null;
    state.currentContentMode = "generative";
    state.currentGenerationSource = saved.source || "history";
    selectWord(saved.word, { lookup: state.translationMode !== "off", render: false });
    setTranslation(saved.en || "");
    renderCzechSentence(saved.sentence, saved.word);
    resetSentenceFeedback();
    renderTrail();
    syncDiagnostics();
    const sceneReady = updateSceneAsset(saved.sceneQuery || saved.en || localTranslation(saved.sentence, saved.word));
    await Promise.all([holdSentenceTransition(transitionStartedAt), sceneReady]);
    if (requestId === state.phraseRequestId) {
      setStatus("Saved Generative sentence restored. Press Next when you want a new one.", { tone: "muted" });
    }
  } catch (error) {
    if (requestId === state.phraseRequestId) {
      setStatus("The saved sentence could not be restored.", { tone: "error" });
    }
  } finally {
    if (requestId === state.phraseRequestId) setBusy(false);
  }
  return true;
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

function currentPlayInstruction() {
  return state.translationMode === "reconstruct" ? reconstructionInstruction : playInstruction;
}

function syncPlayInstruction() {
  const instruction = $("#wordNetInstructions");
  if (instruction) instruction.textContent = currentPlayInstruction();
}

function setStatus(message, { tone = "muted" } = {}) {
  const status = $("#wordNetStatus");
  const panel = $(".word-net-status-panel");
  const isRestingInstruction = message === playInstruction || message === reconstructionInstruction;
  syncPlayInstruction();
  if (status) {
    status.textContent = isRestingInstruction ? "" : targetLanguageCopy(message);
    status.hidden = isRestingInstruction || !message;
  }
  if (panel) panel.dataset.tone = isRestingInstruction ? "muted" : tone;
  syncDiagnostics();
}

function diagnosticsPhase() {
  if (state.standardCorpusLoading) return "loading corpus";
  if (state.busy) return "generating";
  if (state.backgroundActivity === "translation") return "translating";
  if (state.backgroundActivity === "translation-batch") return "translating queue";
  if (state.backgroundActivity === "prefetch") return "prefetching";
  if (state.prefetchTimerId) return "prefetch queued";
  return state.currentSentence ? "ready" : "starting";
}

function diagnosticsModel(phase) {
  if (state.contentMode === "standard") return "none · curated corpus";
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
    "standard-corpus": "guided corpus",
    native: "native model",
    history: "history"
  };
  const source = labels[state.currentGenerationSource] || state.currentGenerationSource || "—";
  if (state.currentGenerationSource !== "standard-corpus" || !state.semanticSelectionMode) return source;
  const semantic = {
    embedding: "English MiniLM",
    lexical: "English lexical fallback",
    provider: "target index fallback"
  }[state.semanticSelectionMode] || "target index fallback";
  return `${source} · ${semantic}`;
}

function syncDiagnostics() {
  const phase = diagnosticsPhase();
  const runtime = runtimeAdapter()?.env === "android" ? "android" : "browser";
  const queueSize = state.branchQueue.size;
  const queueFresh = state.branchQueue.freshSize;
  const queueCapacity = state.branchQueue.capacity;
  const generationMode = generationModes[state.generationMode]?.label || generationModes.random.label;
  const contentMode = contentModes[state.contentMode]?.label || contentModes.standard.label;
  const difficulty = learningDifficulty();
  const standardCounts = state.standardProvider?.difficultyCounts?.() || { 1: 0, 2: 0, 3: 0 };
  const eligibleStandard = standardCounts[1]
    + (difficulty >= 2 ? standardCounts[2] : 0)
    + (difficulty >= 3 ? standardCounts[3] : 0);
  const history = state.historyCursor
    ? `${state.history.length} · back ${state.historyCursor}`
    : String(state.history.length);
  const values = {
    wordNetMetaPhase: phase,
    wordNetMetaModel: diagnosticsModel(phase),
    wordNetMetaQueue: state.contentMode === "standard"
      ? `${eligibleStandard} eligible · ${state.standardProvider?.usage?.entries?.size || 0} seen`
      : `${queueFresh} fresh · ${queueSize} saved`,
    wordNetMetaMode: `${contentMode} · ${generationMode} · L${difficulty}`,
    wordNetMetaSource: diagnosticsSource(),
    wordNetMetaHistory: history
  };
  for (const [id, value] of Object.entries(values)) {
    const node = document.getElementById(id);
    if (node) node.textContent = value;
  }
  const poolLabel = $("#wordNetMetaPoolLabel");
  if (poolLabel) poolLabel.textContent = state.contentMode === "standard" ? "corpus" : "queue";
  const summary = $("#wordNetDiagnosticsSummary");
  if (summary) {
    summary.textContent = state.contentMode === "standard"
      ? `${phase} · Standard · L${difficulty} · ${eligibleStandard} eligible`
      : `${phase} · ${runtime} · queue ${queueFresh}/${queueSize} · cap ${queueCapacity}`;
  }
}

function loadTranslationMode() {
  try {
    const value = localStorage.getItem(TRANSLATION_MODE_STORAGE_KEY);
    if (value === "visible" || value === "off") {
      try {
        localStorage.setItem(TRANSLATION_MODE_STORAGE_KEY, "timer-5");
      } catch (error) {
        // The current session can still use the migrated mode.
      }
      return "timer-5";
    }
    if (hasTranslationMode(value)) return value;
  } catch (error) {
    // Ignore storage failures and use the default.
  }
  // Rebuild turns the English translation into the default challenge while a
  // learner's explicit saved choice continues to take precedence.
  return "reconstruct";
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

function loadContentMode() {
  try {
    const value = localStorage.getItem(CONTENT_MODE_STORAGE_KEY);
    if (hasContentMode(value)) return value;
  } catch (error) {
    // Content source remains available for the current session.
  }
  return "standard";
}

function hasTranslationMode(mode) {
  return Object.prototype.hasOwnProperty.call(translationModes, mode);
}

function isTimedTranslationMode(mode) {
  return typeof mode === "string" && mode.startsWith("timer-") && hasTranslationMode(mode);
}

function hasGenerationMode(mode) {
  return Object.prototype.hasOwnProperty.call(generationModes, mode);
}

function generationAvailability() {
  return localAiAvailability(course, runtimeAdapter(), "generation");
}

function supportsContentMode(mode) {
  if (!Object.prototype.hasOwnProperty.call(contentModes, mode)) return false;
  if (mode === "generative") return generationAvailability().supported;
  return true;
}

function hasContentMode(mode) {
  if (!supportsContentMode(mode)) return false;
  if (mode === "generative" && !generationAvailability().enabled) return false;
  return true;
}

function saveTranslationMode() {
  if (state.guidedRequested) return;
  try {
    localStorage.setItem(TRANSLATION_MODE_STORAGE_KEY, state.translationMode);
  } catch (error) {
    // Translation timing is a convenience setting; storage is optional.
  }
}

function saveGenerationMode() {
  if (state.guidedRequested) return;
  try {
    localStorage.setItem(GENERATION_MODE_STORAGE_KEY, state.generationMode);
  } catch (error) {
    // Generation mode remains available for the current session.
  }
}

function saveContentMode() {
  if (state.guidedRequested) return;
  try {
    localStorage.setItem(CONTENT_MODE_STORAGE_KEY, state.contentMode);
  } catch (error) {
    // Content source remains available for the current session.
  }
}

function clearTranslationTimer() {
  if (!state.translationTimerId) return;
  window.clearTimeout(state.translationTimerId);
  state.translationTimerId = 0;
}

function markGuidedDictionaryHint() {
  if (!state.guidedMode || !state.guidedLifecycle) return true;
  try {
    state.guidedLifecycle.markHint("dictionary-card");
    renderWordGuidedStatus();
    return true;
  } catch (error) {
    failGuidedWordWorld(error, "The dictionary hint stayed hidden because support could not be recorded.");
    return false;
  }
}

function toggleWordCardPreference(key) {
  if (!Object.prototype.hasOwnProperty.call(state.wordCardPreferences, key)) return;
  if (key === "showCard" && !state.wordCardPreferences.showCard && !markGuidedDictionaryHint()) return;
  state.wordCardPreferences[key] = !state.wordCardPreferences[key];
  saveWordCardPreferences();
  syncTranslationMenu();
  syncWordTranslation();
  if (
    state.guidedMode
    && key === "showCard"
    && state.wordCardPreferences.showCard
    && state.selectedWord
    && !state.selectedWordMeaning
    && !state.wordMeaningLoading
  ) {
    void lookupSelectedWord(state.selectedWord);
  }
}

function translationMenuItems() {
  const menu = $("#wordNetTranslationMenu");
  return menu
    ? [...menu.querySelectorAll('[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]')]
      .filter((item) => !item.closest("[hidden]"))
    : [];
}

function closeTranslationMenu({ restoreFocus = false } = {}) {
  const menu = $("#wordNetTranslationMenu");
  const button = $("#wordNetTranslationToggle");
  if (menu) menu.hidden = true;
  if (button) button.setAttribute("aria-expanded", "false");
  if (restoreFocus) button?.focus({ preventScroll: true });
}

function openTranslationMenu({ focus = "selected" } = {}) {
  const menu = $("#wordNetTranslationMenu");
  const button = $("#wordNetTranslationToggle");
  if (!menu || !button) return;
  closeDisplayMenu();
  closeAudioMenu();
  closeGenerationMenu();
  syncTranslationMenu();
  menu.hidden = false;
  button.setAttribute("aria-expanded", "true");
  const items = translationMenuItems();
  const target = focus === "last"
    ? items.at(-1)
    : items.find((item) => item.getAttribute("aria-checked") === "true") || items[0];
  window.requestAnimationFrame(() => target?.focus({ preventScroll: true }));
}

function toggleTranslationMenu() {
  const menu = $("#wordNetTranslationMenu");
  if (!menu) return;
  if (menu.hidden) openTranslationMenu();
  else closeTranslationMenu({ restoreFocus: true });
}

function handleTranslationToggleKeydown(event) {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  event.preventDefault();
  openTranslationMenu({ focus: event.key === "ArrowUp" ? "last" : "selected" });
}

function handleTranslationMenuKeydown(event) {
  const menu = $("#wordNetTranslationMenu");
  if (!menu || menu.hidden) return;
  if (event.key === "Escape") {
    event.preventDefault();
    closeTranslationMenu({ restoreFocus: true });
    return;
  }
  if (event.key === "Tab") {
    event.preventDefault();
    closeTranslationMenu();
    const target = event.shiftKey ? $("#wordNetTranslationToggle") : $("#wordNetGenerationToggle");
    target?.focus({ preventScroll: true });
    return;
  }
  const items = translationMenuItems();
  if (!items.length) return;
  const currentIndex = Math.max(0, items.indexOf(document.activeElement));
  let nextIndex = -1;
  if (event.key === "ArrowDown") nextIndex = (currentIndex + 1) % items.length;
  if (event.key === "ArrowUp") nextIndex = (currentIndex - 1 + items.length) % items.length;
  if (event.key === "Home") nextIndex = 0;
  if (event.key === "End") nextIndex = items.length - 1;
  if (nextIndex < 0) return;
  event.preventDefault();
  items[nextIndex].focus({ preventScroll: true });
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
  closeDisplayMenu();
  closeAudioMenu();
  const nextHidden = !menu.hidden;
  menu.hidden = nextHidden;
  button.setAttribute("aria-expanded", nextHidden ? "false" : "true");
}

function syncTranslationMenu() {
  const showTimers = isTimedTranslationMode(state.translationMode);
  const timers = $("#wordNetTranslationTimers");
  if (timers) timers.hidden = !showTimers;
  document.querySelectorAll("[data-answer-mode]").forEach((button) => {
    const selected = button.dataset.answerMode === "reconstruct"
      ? state.translationMode === "reconstruct"
      : isTimedTranslationMode(state.translationMode);
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-checked", selected ? "true" : "false");
    button.disabled = state.busy || guidedWordInteractionLocked();
  });
  document.querySelectorAll("[data-translation-delay]").forEach((button) => {
    const selected = button.dataset.translationDelay === state.translationMode;
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-checked", selected ? "true" : "false");
    button.disabled = state.busy || guidedWordInteractionLocked();
  });
  document.querySelectorAll("[data-word-card-setting]").forEach((button) => {
    const key = button.dataset.wordCardSetting;
    button.setAttribute("aria-checked", String(Boolean(state.wordCardPreferences[key])));
    button.disabled = state.busy || guidedWordInteractionLocked();
  });
}

function syncGenerationControl() {
  const button = $("#wordNetGenerationToggle");
  const icon = $("#wordNetGenerationIcon");
  const mode = hasGenerationMode(state.generationMode) ? state.generationMode : "random";
  if (mode !== state.generationMode) state.generationMode = mode;
  const config = generationModes[mode];
  const selectedModeLabel = config.label;
  icon?.querySelectorAll("[data-generation-icon]").forEach((generationIcon) => {
    generationIcon.toggleAttribute("hidden", generationIcon.dataset.generationIcon !== mode);
  });
  if (button) {
    button.disabled = state.busy || state.guidedRequested;
    const label = mode === "selected" ? selectedModeLabel : config.label;
    button.setAttribute("aria-label", `Generation options. Current: ${label}.`);
    button.setAttribute("title", `Generation: ${label}`);
  }
  document.querySelectorAll("[data-generation-mode]").forEach((option) => {
    const optionMode = option.dataset.generationMode;
    const selected = optionMode === mode;
    option.classList.toggle("is-selected", selected);
    option.setAttribute("aria-checked", selected ? "true" : "false");
    option.disabled = state.busy
      || state.guidedRequested
      || (optionMode === "selected" && !normalizeWord(state.selectedWord));
    const label = option.querySelector("[data-generation-label]");
    if (label) label.textContent = generationModes[optionMode]?.label || generationModes.selected.label;
  });
  syncDiagnostics();
}

function learningDifficulty() {
  const value = Number(window.CaatuuLearning?.difficulty?.() || 1);
  return value >= 1 && value <= 3 ? Math.floor(value) : 1;
}

function syncContentControl() {
  const mode = hasContentMode(state.contentMode) ? state.contentMode : "standard";
  const generative = generationAvailability();
  if (mode !== state.contentMode) state.contentMode = mode;
  document.querySelectorAll("[data-content-mode]").forEach((button) => {
    const buttonMode = button.dataset.contentMode;
    const selected = buttonMode === mode;
    const runtimeDisabled = buttonMode === "generative" && generative.supported && !generative.enabled;
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-pressed", selected ? "true" : "false");
    button.disabled = state.busy || state.guidedRequested || !supportsContentMode(buttonMode);
    button.setAttribute("aria-disabled", String(button.disabled || runtimeDisabled));
    button.title = runtimeDisabled ? generative.message : "";
  });
  const note = $("#wordNetGenerativeNote");
  if (note) {
    note.textContent = generative.enabled
      ? "Optional local AI requires an initial download."
      : generative.message;
    note.hidden = !generative.supported || (generative.enabled && mode !== "generative");
  }
  const control = $("#wordNetContentSource");
  if (control) {
    control.setAttribute(
      "aria-label",
      `Sentence source. Current: ${contentModes[mode].label}.${generative.supported && !generative.enabled ? ` ${generative.message}` : ""}`
    );
  }
  syncDiagnostics();
}

const providerRecordSources = new WeakMap();

function recordIdentifier(record) {
  return String(record?.id ?? record?.conceptId ?? "").trim();
}

function controllerRecord(record) {
  if (!record || typeof record !== "object") return null;
  const id = recordIdentifier(record);
  const prepared = typeof providerContext?.sessionRecord === "function"
    ? providerContext.sessionRecord(id)
    : null;
  const target = prepared?.target && typeof prepared.target === "object"
    ? prepared.target
    : null;
  const tokens = Array.isArray(target?.tokens) ? target.tokens : [];
  const converted = {
    ...record,
    id,
    cs: String(target?.text ?? record.cs ?? record.targetText ?? "").normalize("NFC").trim(),
    en: String(prepared?.englishText ?? record.en ?? record.sourceText ?? "").normalize("NFC").trim(),
    sceneQuery: String(
      prepared?.sceneQuery
      ?? record.sceneQuery
      ?? prepared?.englishText
      ?? record.en
      ?? record.sourceText
      ?? ""
    ).normalize("NFC").trim(),
    targets: Array.isArray(record.targets) && record.targets.length
      ? record.targets
      : tokens.map((token, tokenIndex) => ({
          surface: String(token?.surface ?? token?.text ?? "").normalize("NFC").trim(),
          normalized: providerContext?.normalization?.searchKey?.(
            token?.surface ?? token?.text ?? "",
            { record: prepared, token, tokenIndex }
          ) || normalizeWord(token?.surface ?? token?.text ?? ""),
          tokenIndex,
          playable: token?.playable !== false,
          gloss: String(token?.gloss || "").normalize("NFC").trim()
        })).filter((token) => token.surface)
  };
  providerRecordSources.set(converted, record);
  return converted;
}

function createControllerSelectionProvider(selectionProvider) {
  if (!selectionProvider || !Array.isArray(selectionProvider.records)
      || typeof selectionProvider.nextRandom !== "function"
      || typeof selectionProvider.nextForWord !== "function") {
    throw new TypeError("The prepared Word World context is missing its selection provider.");
  }
  const records = selectionProvider.records.map(controllerRecord).filter(Boolean);
  const byId = new Map(records.map((record) => [record.id, record]));
  const adaptSelection = (selection) => {
    if (!selection?.record) return selection || null;
    const record = byId.get(recordIdentifier(selection.record)) || controllerRecord(selection.record);
    return { ...selection, record };
  };
  const sourceRecord = (record) => providerRecordSources.get(record) || record;
  return Object.freeze({
    records,
    corpusVersion: String(selectionProvider.corpusVersion || "unknown"),
    usage: selectionProvider.usage || null,
    difficultyCounts: (...args) => selectionProvider.difficultyCounts(...args),
    nextRandom: (...args) => adaptSelection(selectionProvider.nextRandom(...args)),
    nextForWord: (...args) => adaptSelection(selectionProvider.nextForWord(...args)),
    primaryWord: (record, ...args) => selectionProvider.primaryWord(sourceRecord(record), ...args),
    markUsed: (record) => selectionProvider.markUsed(sourceRecord(record)),
    getRecordById: (id) => byId.get(recordIdentifier(id)) || null,
    selectBoundTarget: typeof selectionProvider.selectBoundTarget === "function"
      ? (...args) => selectionProvider.selectBoundTarget(...args)
      : null,
    nextForBinding: typeof selectionProvider.nextForBinding === "function"
      ? (...args) => adaptSelection(selectionProvider.nextForBinding(...args))
      : null
  });
}

async function initializeStandardCorpus() {
  if (state.standardProvider) return state.standardProvider;
  if (state.standardCorpusPromise) return state.standardCorpusPromise;
  state.standardCorpusPromise = (async () => {
    state.standardCorpusLoading = true;
    state.standardCorpusError = "";
    syncDiagnostics();
    try {
      state.standardProvider = createControllerSelectionProvider(providerContext?.selectionProvider);
      return state.standardProvider;
    } catch (error) {
      state.standardCorpusError = error?.message || "The curated sentence pack is unavailable.";
      return null;
    } finally {
      state.standardCorpusLoading = false;
      state.standardCorpusPromise = null;
      syncDiagnostics();
    }
  })();
  return state.standardCorpusPromise;
}

function abortOptionalGenerationDownloads() {
  const models = runtimeAdapter()?.models;
  if (typeof models?.abortDownload !== "function") return;
  void Promise.allSettled([
    models.abortDownload(WORD_NET_MODEL_KEY),
    models.abortDownload(TRANSLATION_MODEL_KEY)
  ]);
}

async function setContentMode(mode) {
  if (state.guidedRequested) return;
  if (!hasContentMode(mode)) return;
  if (mode === "standard") abortOptionalGenerationDownloads();
  if (mode === state.contentMode) {
    if (mode === "standard" && !state.standardProvider) {
      const provider = await initializeStandardCorpus();
      if (state.contentMode !== mode) return;
      setStatus(provider ? "Standard is ready." : state.standardCorpusError, { tone: provider ? "active" : "error" });
    }
    return;
  }
  cancelBackgroundWork();
  state.generativeTurnActive = false;
  state.contentMode = mode;
  saveContentMode();
  syncContentControl();
  if (mode === "standard") {
    const provider = await initializeStandardCorpus();
    if (state.contentMode !== mode) return;
    setStatus(provider
      ? "Standard is ready. The next sentence comes from the guided corpus."
      : state.standardCorpusError, { tone: provider ? "active" : "error" });
  } else {
    setStatus("Generative uses optional local models (about 1.9 GB). They download only after you request a new sentence.", { tone: "active" });
  }
}

function configureGenerativeDialog(mode, availability = generationAvailability()) {
  const dialog = $("#wordNetGenerativeDialog");
  if (!dialog) return null;
  const title = $("#wordNetGenerativeDialogTitle");
  const description = $("#wordNetGenerativeDialogDescription");
  const note = dialog.querySelector(".word-net-generative-dialog-note");
  const cancelButton = dialog.querySelector('button[value="cancel"]');
  const continueButton = dialog.querySelector('button[value="confirm"]');
  const disabled = mode === "disabled";
  if (title) title.textContent = disabled ? "Generative local AI is disabled" : "Prepare Generative mode?";
  if (description) {
    description.textContent = disabled
      ? availability.message
      : "The first use downloads about 1.9 GB of models to this device and may take several minutes. Wi-Fi is recommended.";
  }
  if (note) {
    note.textContent = disabled
      ? "Standard mode remains available offline."
      : "Nothing downloads yet. The download starts only when you ask for a new Generative sentence; Standard remains available offline.";
  }
  if (cancelButton) cancelButton.hidden = disabled;
  if (continueButton) continueButton.textContent = disabled ? "Close" : "Continue";
  dialog.dataset.mode = mode;
  return dialog;
}

function showGenerativeUnavailablePrompt() {
  const availability = generationAvailability();
  const dialog = configureGenerativeDialog("disabled", availability);
  if (!dialog || typeof dialog.showModal !== "function") {
    window.alert?.(availability.message);
    return;
  }
  if (!dialog.open) dialog.showModal();
}

function confirmGenerativeMode() {
  const dialog = configureGenerativeDialog("confirmation");
  if (!dialog || typeof dialog.showModal !== "function") {
    return Promise.resolve(window.confirm(
      "Generative mode may download about 1.9 GB of local AI models and can take several minutes. Continue?"
    ));
  }
  if (dialog.open) return Promise.resolve(false);
  dialog.returnValue = "";
  dialog.showModal();
  return new Promise((resolve) => {
    dialog.addEventListener("close", () => resolve(dialog.returnValue === "confirm"), { once: true });
  });
}

async function requestContentMode(mode) {
  if (state.guidedRequested) return;
  if (mode === "generative" && !generationAvailability().enabled) {
    closeGenerationMenu();
    showGenerativeUnavailablePrompt();
    syncContentControl();
    return;
  }
  if (mode !== state.contentMode && shouldBlockReconstructionAdvance()) return;
  if (!hasContentMode(mode) || mode === state.contentMode) {
    await setContentMode(mode);
    return;
  }
  if (mode === "generative" && !(await confirmGenerativeMode())) {
    syncContentControl();
    return;
  }
  await setContentMode(mode);
}

function setGenerationMode(mode) {
  if (state.guidedRequested) return;
  if (!hasGenerationMode(mode)) return;
  state.generationMode = mode;
  saveGenerationMode();
  syncGenerationControl();
  closeGenerationMenu();
}

function generateFromConfiguredMode(mode = state.generationMode, { force = false } = {}) {
  if (state.guidedRequested) return;
  if (state.busy) return;
  if (!force && shouldBlockReconstructionAdvance()) return;
  if (state.contentMode === "standard") {
    void generateStandardFromConfiguredMode(mode);
    return;
  }
  if (mode === "selected") {
    const selectedWord = normalizeWord(state.selectedWord);
    if (!selectedWord) {
      setStatus("Tap a word before using selected-word generation.", { tone: "muted" });
      return;
    }
    state.generativeTurnActive = true;
    void generateSentenceForWord(selectedWord, { source: "choice" });
    return;
  }
  state.generativeTurnActive = true;
  void generateRandomPhrase({ source: "seed" });
}

function recentStandardEntryIds() {
  return [...new Set([
    state.currentContentMode === "standard" ? state.currentEntryId : "",
    ...state.history
      .filter((entry) => entry.contentMode === "standard")
      .slice(0, 10)
      .map((entry) => entry.id)
  ])].filter(Boolean);
}

async function generateGuidedStandardPhrase({ allowBusy = false } = {}) {
  return;
}

async function generateStandardFromConfiguredMode(mode = state.generationMode, { allowBusy = false } = {}) {
  if (state.guidedRequested) return;
  if (state.busy && !allowBusy) return;
  if (mode === "selected" && !normalizeWord(state.selectedWord)) {
    setStatus("Tap a word before using selected-word mode.", { tone: "muted" });
    return;
  }
  const phraseRequestId = state.phraseRequestId;
  const provider = state.standardProvider || await initializeStandardCorpus();
  if (state.contentMode !== "standard" || phraseRequestId !== state.phraseRequestId) return;
  if (!provider) {
    setStatus(state.standardCorpusError || "The curated sentence pack is unavailable.", { tone: "error" });
    return;
  }
  const difficulty = learningDifficulty();
  const englishQuery = mode === "selected" ? selectedEnglishSemanticQuery(state.selectedWord) : "";
  const ownsSemanticBusy = Boolean(
    mode === "selected" && englishQuery && typeof providerContext?.searchEnglish === "function" && !state.busy
  );
  if (ownsSemanticBusy) {
    setBusy(true);
    setStatus("Ranking guided sentences by English meaning.", { tone: "active" });
  }
  const outcome = await runOwnedSemanticSelection({
    select: () => selectStandardTurn(provider, {
      generationMode: mode,
      selectedWord: state.selectedWord,
      difficulty,
      excludeIds: mode === "selected" ? [state.currentEntryId].filter(Boolean) : recentStandardEntryIds(),
      allowSelectedRandomFallback: false,
      englishQuery,
      searchEnglish: providerContext?.searchEnglish,
      searchKey: providerContext?.normalization?.searchKey
    }),
    canPresent: () => state.contentMode === "standard" && phraseRequestId === state.phraseRequestId,
    async present(selection) {
      state.semanticSelectionMode = mode === "selected" ? selection.semanticMode || "provider" : "";
      await showStandardPhrase(selection, { difficulty });
    },
    releaseBusy() {
      if (ownsSemanticBusy && state.busy) setBusy(false);
    },
    onSelectionError(error) {
      state.semanticSelectionMode = mode === "selected" ? "provider" : "";
      console.warn("Word World sentence selection failed.", error);
      setStatus("Could not choose a guided sentence. Please try again.", { tone: "error" });
    }
  });
  if (outcome.error || outcome.skipped || outcome.presented) return;
  const selection = outcome.selection;
  state.semanticSelectionMode = mode === "selected" ? selection?.semanticMode || "provider" : "";
  if (!selection?.record) {
    if (mode === "selected") {
      setStatus(
        `No other Level ${difficulty} Standard sentence uses "${state.selectedWord}". Choose Random for a different guided sentence.`,
        { tone: "active" }
      );
      return;
    }
    setStatus(`No Standard sentences are available for Level ${difficulty}.`, { tone: "error" });
    return;
  }
}

async function showStandardPhrase(selection, {
  difficulty = learningDifficulty(),
  guidedLifecycle = null
} = {}) {
  const provider = state.standardProvider;
  const record = selection?.record;
  if (!provider || !record) return;
  const transitionStartedAt = performance.now();
  const requestId = state.phraseRequestId + 1;
  state.phraseRequestId = requestId;
  if (!state.busy) setBusy(true);
  try {
    cancelBackgroundWork();
    hideSceneAsset({ cancel: true });
    setStatus("Preparing the next guided sentence.", { tone: "active" });
    if (requestId !== state.phraseRequestId || state.contentMode !== "standard") return;
    const target = normalizeWord(
      guidedLifecycle
        ? selection.target?.surface
        : provider.primaryWord(record, selection.fallback ? "" : selection.requestedWord)
    );
    if (!target) throw new Error("The selected Word World turn has no playable target.");
    state.guidedLifecycle = guidedLifecycle;
    if (guidedLifecycle) state.guidedStatus = "activating";
    state.guidedFocusTarget = guidedLifecycle ? { ...selection.target } : null;
    state.currentWord = target;
    state.currentSentence = record.cs;
    state.currentTranslation = guidedLifecycle ? "" : record.en;
    state.currentSceneQuery = record.sceneQuery || record.en;
    state.currentEntryId = record.id;
    state.currentCorpusVersion = provider.corpusVersion;
    state.currentDifficulty = record.difficulty;
    state.currentStandardRecord = record;
    state.currentContentMode = "standard";
    state.currentGenerationSource = "standard-corpus";
    selectWord(target, { lookup: false, render: false });
    renderCzechSentence(record.cs, target);
    renderWordGuidedStatus();
    if (guidedLifecycle) {
      setBusy(false, { immediate: true });
      const activation = await activatePresentedGuidedWord(requestId, record.id, guidedLifecycle);
      if (!activation) return;
      if (requestId !== state.phraseRequestId || state.currentEntryId !== record.id) return;
      state.guidedStatus = "ready";
      setTranslation(record.en);
      renderWordGuidedStatus();
    } else {
      setTranslation(record.en);
    }
    if (!guidedLifecycle) {
      provider.markUsed(record);
      saveStandardUsage();
      rememberStep(target, record.cs, {
        id: record.id,
        en: record.en,
        contentMode: "standard",
        source: "standard-corpus",
        corpusVersion: provider.corpusVersion,
        difficulty: record.difficulty,
        sceneQuery: record.sceneQuery || record.en
      });
      recordStandardSemanticExposure(record, provider, target);
      rememberSeenSentence(record.cs);
    }
    resetSentenceFeedback();
    setProgress(null);
    const sceneReady = guidedLifecycle
      ? Promise.resolve(hideSceneAsset({ cancel: true }))
      : updateSceneAsset(record.sceneQuery || record.en);
    await Promise.all([holdSentenceTransition(transitionStartedAt), sceneReady]);
    if (requestId !== state.phraseRequestId || state.contentMode !== "standard") return;
    if (!guidedLifecycle && state.translationMode !== "off" && !state.selectedWordMeaning && !state.wordMeaningLoading) {
      void lookupSelectedWord(target);
    }
    if (guidedLifecycle) {
      setStatus(reconstructionInstruction, { tone: "muted" });
    } else if (selection.fallback) {
      setStatus(`No unused Level ${difficulty} Standard sentence remains for “${selection.requestedWord}”. Showing another guided sentence.`, { tone: "active" });
    } else {
      setStatus(playInstruction, { tone: "muted" });
    }
  } finally {
    if (requestId === state.phraseRequestId) setBusy(false);
  }
}

function takeQueuedRandomCandidate() {
  const queued = state.branchQueue.takeAny({
    preferredWords: seedWords,
    excludeWords: [state.currentWord],
    excludeFingerprints: queueAvoidFingerprints(),
    preferTranslated: state.translationMode !== "off"
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

  cancelBackgroundWork({ preserveSpeculative: Boolean(queued?.translation) });
  const target = normalizeWord(queued.word) || freshSeedWord();
  state.currentWord = target;
  selectWord(target, { lookup: state.translationMode !== "off" });
  setTranslation("");
  hideSceneAsset({ cancel: true });
  const transitionStartedAt = performance.now();
  setBusy(true);
  setProgress(null);
  setStatus("Ready from the saved sentence queue.", { tone: "active" });
  try {
    await presentPreparedCandidate(target, queued, transitionStartedAt);
  } catch (error) {
    if (!state.busy) setBusy(true);
    await presentPreparedCandidate(target, {
      sentence: localSentence(target, generationAvoidList()),
      source: "queue-error-fallback"
    }, transitionStartedAt);
    setStatus(error?.message || "Could not restore the saved phrase.", { tone: "error" });
  }
}

function reconstructionGrammarSignals(record) {
  const grammar = record?.grammar;
  if (Array.isArray(grammar)) return grammar.map((value) => String(value || "").toLocaleLowerCase("en-US"));
  if (!grammar || typeof grammar !== "object") return [];
  return Object.entries(grammar).flatMap(([key, value]) => [
    key,
    ...(Array.isArray(value) ? value : [value])
  ]).map((value) => String(value || "").toLocaleLowerCase("en-US"));
}

function reconstructionWordCount(text) {
  return String(text || "").match(/[\p{L}\p{M}\d]+(?:[’'-][\p{L}\p{M}\d]+)*/gu)?.length || 0;
}

function reconstructionCandidateTexts() {
  const current = state.currentStandardRecord;
  const currentSignals = new Set(reconstructionGrammarSignals(current));
  const currentObjective = String(current?.learning?.objective || "").toLocaleLowerCase("en-US");
  const answerLength = reconstructionWordCount(state.currentTranslation);
  const scoredRecords = (state.standardProvider?.records || [])
    .filter((record) => record?.id !== current?.id)
    .map((record) => {
      const signals = reconstructionGrammarSignals(record);
      const sharedSignals = signals.filter((signal) => currentSignals.has(signal)).length;
      const objective = String(record?.learning?.objective || "").toLocaleLowerCase("en-US");
      const score = (currentObjective && objective === currentObjective ? 80 : 0)
        + (current?.topic && record.topic === current.topic ? 32 : 0)
        + sharedSignals * 14
        + (Number(record.difficulty) === Number(state.currentDifficulty) ? 10 : 0)
        - Math.abs(reconstructionWordCount(record.en) - answerLength) * 2;
      return { record, score };
    })
    .sort((left, right) => right.score - left.score || left.record.id.localeCompare(right.record.id, "en-US"))
    .slice(0, 48)
    .flatMap(({ record }) => [record.en, ...(record.enAlternates || [])]);
  const historyTexts = state.history.map((entry) => entry.en).filter(Boolean);
  const seen = new Set();
  return [...scoredRecords, ...historyTexts, ...reconstructionFallbackTexts].filter((text) => {
    const value = String(text || "").trim();
    const key = value.toLocaleLowerCase("en-US");
    if (!value || value === state.currentTranslation || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function currentReconstructionKey() {
  const translation = String(state.currentTranslation || "").normalize("NFC").trim();
  if (!translation || !state.currentSentence) return "";
  return [
    state.currentContentMode,
    state.currentCorpusVersion,
    state.currentEntryId,
    sentenceFingerprint(state.currentSentence),
    translation.toLocaleLowerCase("en-US")
  ].join("|");
}

function ensureReconstructionChallenge() {
  const key = currentReconstructionKey();
  if (!key) {
    state.reconstruction = null;
    return null;
  }
  const guidedTaskFingerprint = state.guidedMode
    ? state.guidedLifecycle?.state().taskFingerprint || ""
    : "";
  if (state.guidedMode && !guidedTaskFingerprint) {
    state.reconstruction = null;
    return null;
  }
  if (state.reconstruction?.key === key) return state.reconstruction;
  const challenge = buildWordReconstructionChallenge(
    state.currentTranslation,
    reconstructionCandidateTexts(),
    { distractorCount: RECONSTRUCTION_DISTRACTOR_COUNT }
  );
  if (!challenge.answerTokens.length) {
    state.reconstruction = null;
    return null;
  }
  state.reconstruction = {
    key,
    challenge,
    selectedIds: [],
    submitted: false,
    evidencePending: false,
    correct: false,
    awardedXp: 0,
    submittedText: "",
    announcement: "",
    guidedLifecycle: state.guidedMode ? state.guidedLifecycle : null,
    guidedTaskFingerprint,
    phraseRequestId: state.phraseRequestId
  };
  return state.reconstruction;
}

function reconstructionSelectedOptions(round) {
  const options = new Map(round.challenge.options.map((option) => [option.id, option]));
  return round.selectedIds.map((id) => options.get(id)).filter(Boolean);
}

function reconstructionSelectedText(round) {
  const words = reconstructionSelectedOptions(round).map((option) => option.text).join(" ");
  return `${words}${round.challenge.punctuation || ""}`.trim();
}

function reconstructionTokenButton(option, location, { inAnswer = false } = {}) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "word-net-reconstruction-token";
  button.dataset.reconstructionOptionId = option.id;
  button.dataset.reconstructionLocation = location;
  button.textContent = option.text;
  button.classList.toggle("is-in-answer", location === "bank" && inAnswer);
  button.disabled = state.busy || guidedWordInteractionLocked() || state.reconstruction?.evidencePending || inAnswer;
  if (location === "answer") {
    button.setAttribute("aria-label", `Remove ${option.text}`);
  } else if (inAnswer) {
    button.tabIndex = -1;
    button.setAttribute("aria-hidden", "true");
  } else {
    button.setAttribute("aria-label", `Add ${option.text}`);
  }
  return button;
}

function reconstructionOptionNode(id, location) {
  return [...document.querySelectorAll("[data-reconstruction-option-id]")].find((node) => (
    node.dataset.reconstructionOptionId === id
    && node.dataset.reconstructionLocation === location
  )) || null;
}

function animateReconstructionTransfer(id, fromRect, toLocation, { restoreFocus = false } = {}) {
  const target = reconstructionOptionNode(id, toLocation);
  const host = $("#wordNetReconstruction");
  if (!target) return;
  if (restoreFocus && !target.disabled) target.focus({ preventScroll: true });
  if (
    !fromRect
    || typeof target.animate !== "function"
    || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  ) return;
  const toRect = target.getBoundingClientRect();
  if (!toRect.width || !toRect.height) return;
  const deltaX = fromRect.left - toRect.left;
  const deltaY = fromRect.top - toRect.top;
  const scaleX = Math.max(0.72, Math.min(1.28, fromRect.width / toRect.width));
  const scaleY = Math.max(0.72, Math.min(1.28, fromRect.height / toRect.height));
  host?.classList.add("is-transferring");
  target.classList.add("is-moving");
  const animation = target.animate([
    {
      transform: `translate3d(${deltaX}px, ${deltaY}px, 0) scale(${scaleX}, ${scaleY})`,
      opacity: 0.58
    },
    { transform: "translate3d(0, 0, 0) scale(1)", opacity: 1 }
  ], {
    duration: 240,
    easing: "cubic-bezier(0.22, 1, 0.36, 1)"
  });
  Promise.resolve(animation.finished)
    .catch(() => {})
    .finally(() => {
      target.classList.remove("is-moving");
      host?.classList.remove("is-transferring");
    });
}

function renderReconstructionAttempt(round, host) {
  const selected = reconstructionSelectedOptions(round);
  host.classList.toggle("is-complete-sentence", round.correct);
  if (round.correct) {
    const sentence = round.submittedText || reconstructionSelectedText(round);
    host.textContent = sentence;
    host.removeAttribute("role");
    host.setAttribute("aria-label", `Your answer: ${sentence} Correct.`);
    return;
  }

  const operations = alignWordReconstructionAttempt(
    selected.map((option) => option.text),
    round.challenge.answerTokens
  );
  const submittedSentence = reconstructionSelectedText(round);
  const submitted = document.createElement("span");
  submitted.className = "word-net-reconstruction-result-submitted";
  const spokenFeedback = [];
  operations.filter((operation) => operation.entered).forEach((operation) => {
    const token = document.createElement("span");
    const isCorrect = operation.type === "match";
    token.className = `word-net-reconstruction-result-token ${isCorrect ? "is-correct" : "is-wrong"}`;
    token.textContent = operation.entered;
    submitted.append(token);
    spokenFeedback.push(`${operation.entered}: ${isCorrect ? "correct" : "incorrect"}`);
  });
  if (round.challenge.punctuation) {
    const punctuation = document.createElement("span");
    punctuation.className = "word-net-reconstruction-result-punctuation";
    punctuation.textContent = round.challenge.punctuation;
    submitted.append(punctuation);
  }

  host.replaceChildren(submitted);
  host.removeAttribute("role");
  host.setAttribute(
    "aria-label",
    `Your answer: ${submittedSentence}. ${spokenFeedback.join(", ")}.`
  );
}

function renderReconstructionResult(round, result) {
  if (!round.submitted) {
    result.hidden = true;
    $("#wordNetReconstructionResultPoints")?.classList.remove("is-xp-awarded");
    return;
  }

  const outcome = round.correct ? "correct" : "incorrect";
  const outcomeContent = {
    correct: {
      mark: "\u2713",
      message: "",
      points: `+${round.awardedXp || 0} XP`
    },
    incorrect: {
      mark: "\u21ba",
      message: "That answer is incorrect — check the words in red, then try again.",
      points: "+0 XP"
    }
  }[outcome];

  result.hidden = false;
  result.dataset.outcome = outcome;
  result.classList.toggle("is-correct", outcome === "correct");
  result.classList.toggle("is-incorrect", outcome === "incorrect");

  const mark = $("#wordNetReconstructionResultMark");
  const title = $("#wordNetReconstructionResultTitle");
  const message = $("#wordNetReconstructionResultMessage");
  const points = $("#wordNetReconstructionResultPoints");
  const attempt = $("#wordNetReconstructionResultAttempt");
  const attemptText = $("#wordNetReconstructionResultAttemptText");
  const correct = $("#wordNetReconstructionResultCorrect");
  const correctText = $("#wordNetReconstructionResultCorrectText");

  if (mark) mark.textContent = outcomeContent.mark;
  if (title) title.textContent = state.currentSentence;
  if (points) {
    points.textContent = outcomeContent.points;
    points.classList.remove("is-xp-awarded");
    if (outcome === "correct") {
      void points.offsetWidth;
      points.classList.add("is-xp-awarded");
    }
  }
  if (message) {
    message.textContent = outcomeContent.message;
    message.hidden = !outcomeContent.message;
  }

  if (attempt && attemptText) {
    attempt.hidden = false;
    attempt.classList.toggle("is-correct-attempt", outcome === "correct");
    renderReconstructionAttempt(round, attemptText);
  }
  if (correct && correctText) {
    correct.hidden = outcome === "correct";
    correctText.textContent = `\u201c${round.challenge.text}\u201d`;
  }
}

function syncPreviousSentenceControl(round = null) {
  const previous = $("#wordNetPrevious");
  if (!previous) return;
  const challengeLocked = Boolean(round && !round.submitted);
  const historyUnavailable = !state.history[state.historyCursor + 1];
  const navigationLocked = state.guidedRequested || challengeLocked || historyUnavailable;
  previous.disabled = state.busy || navigationLocked;
  previous.classList.toggle("is-navigation-locked", navigationLocked);
  const label = challengeLocked
    ? "Submit the challenge before viewing history"
    : state.guidedRequested
      ? "History is unavailable for this guided task"
      : historyUnavailable
        ? "No previous sentence"
        : "Previous sentence";
  previous.setAttribute("aria-label", label);
  previous.title = label;
}

function syncNextSentenceControl(round = null) {
  const next = $("#wordNetNext");
  if (!next) return;
  const challengeLocked = Boolean(round && !round.submitted);
  const challengeReady = Boolean(round?.submitted && !state.busy);
  next.disabled = state.busy || challengeLocked || (state.guidedRequested && !round?.submitted);
  next.classList.toggle("is-challenge-locked", challengeLocked);
  next.classList.toggle("is-challenge-ready", challengeReady);
  const label = state.guidedRequested && round?.submitted && round.guidedIndependentQualified
    ? "Continue to Verb Nebula"
    : state.guidedRequested && round?.submitted
      ? "Try this lesson again"
    : challengeLocked
      ? "Submit the challenge to continue"
      : state.guidedRequested
        ? "Complete this guided sentence"
        : "Next sentence";
  next.setAttribute("aria-label", label);
  next.title = label;
  syncPreviousSentenceControl(round);
}

function renderReconstruction() {
  const host = $("#wordNetReconstruction");
  const play = $("#wordNetReconstructionPlay");
  const answer = $("#wordNetReconstructionAnswer");
  const bank = $("#wordNetReconstructionBank");
  const actions = $("#wordNetReconstructionActions");
  const submit = $("#wordNetReconstructionSubmit");
  const status = $("#wordNetReconstructionStatus");
  const result = $("#wordNetReconstructionResult");
  if (!host || !play || !answer || !bank || !actions || !submit || !status || !result) return;

  const translationToggle = $("#wordNetTranslationToggle");
  if (translationToggle) translationToggle.disabled = state.busy || guidedWordInteractionLocked();
  syncTranslationMenu();

  const round = state.translationMode === "reconstruct" ? ensureReconstructionChallenge() : null;
  const panel = host.closest(".word-net-sentence-panel");
  panel?.classList.toggle("has-reconstruction-actions", Boolean(round && !round.submitted));
  panel?.classList.toggle("has-reconstruction-result", Boolean(round?.submitted));
  host.hidden = !round;
  syncNextSentenceControl(round);
  if (!round) {
    actions.hidden = true;
    status.textContent = "";
    result.hidden = true;
    return;
  }
  const selected = reconstructionSelectedOptions(round);
  const selectedIds = new Set(round.selectedIds);
  const answerNodes = selected.map((option) => reconstructionTokenButton(option, "answer"));
  if (selected.length && round.challenge.punctuation) {
    const punctuation = document.createElement("span");
    punctuation.className = "word-net-reconstruction-punctuation";
    punctuation.textContent = round.challenge.punctuation;
    punctuation.setAttribute("aria-hidden", "true");
    answerNodes.push(punctuation);
  }
  answer.replaceChildren(...answerNodes);
  bank.replaceChildren(...round.challenge.options.map((option) => reconstructionTokenButton(option, "bank", {
    inAnswer: selectedIds.has(option.id)
  })));
  submit.disabled = state.busy || guidedWordInteractionLocked() || round.evidencePending || selected.length === 0;
  status.textContent = round.announcement;

  play.hidden = round.submitted;
  actions.hidden = round.submitted;
  renderReconstructionResult(round, result);
}

function stabilizeReconstructionResultViewport() {
  const scrollLeft = window.scrollX;
  const scrollTop = window.scrollY;
  const restoreScroll = () => window.scrollTo(scrollLeft, scrollTop);
  window.requestAnimationFrame(() => {
    restoreScroll();
    window.requestAnimationFrame(restoreScroll);
  });
}

function selectReconstructionOption(id) {
  if ($("#wordNetReconstruction")?.classList.contains("is-transferring")) return;
  const round = ensureReconstructionChallenge();
  const option = round?.challenge.options.find((candidate) => candidate.id === id);
  if (!round || !option || round.submitted || guidedWordInteractionLocked() || round.evidencePending || round.selectedIds.includes(id)) return;
  const source = reconstructionOptionNode(id, "bank");
  const sourceRect = source?.getBoundingClientRect();
  const restoreFocus = source === document.activeElement;
  round.selectedIds.push(id);
  round.announcement = `Added ${option.text}.`;
  renderReconstruction();
  animateReconstructionTransfer(id, sourceRect, "answer", { restoreFocus });
}

function removeReconstructionOption(id) {
  if ($("#wordNetReconstruction")?.classList.contains("is-transferring")) return;
  const round = ensureReconstructionChallenge();
  const option = round?.challenge.options.find((candidate) => candidate.id === id);
  if (!round || !option || round.submitted || guidedWordInteractionLocked() || round.evidencePending) return;
  const source = reconstructionOptionNode(id, "answer");
  const sourceRect = source?.getBoundingClientRect();
  const restoreFocus = source === document.activeElement;
  round.selectedIds = round.selectedIds.filter((selectedId) => selectedId !== id);
  round.announcement = `Removed ${option.text}.`;
  renderReconstruction();
  animateReconstructionTransfer(id, sourceRect, "bank", { restoreFocus });
}

async function submitReconstructionChallenge() {
  if ($("#wordNetReconstruction")?.classList.contains("is-transferring")) return;
  const round = ensureReconstructionChallenge();
  if (!round || round.submitted || guidedWordInteractionLocked() || round.evidencePending) return;
  if (round.guidedLifecycle) {
    const currentFingerprint = round.guidedLifecycle.state().taskFingerprint;
    if (
      !round.guidedTaskFingerprint
      || round.guidedTaskFingerprint !== currentFingerprint
      || round.phraseRequestId !== state.phraseRequestId
      || round.guidedLifecycle !== state.guidedLifecycle
    ) {
      failGuidedWordWorld(
        new Error("The Guided response no longer matches its immutable curriculum task."),
        "This Guided task changed before submission and is now locked."
      );
      return;
    }
  }
  const selected = reconstructionSelectedOptions(round);
  if (!selected.length) {
    round.announcement = "Choose at least one word before submitting.";
    renderReconstruction();
    return;
  }
  const correct = isWordReconstructionCorrect(
    selected.map((option) => option.text),
    round.challenge.answerTokens
  );
  if (round.guidedLifecycle && !round.guidedLifecycle.state().firstResponseRecorded) {
    round.evidencePending = true;
    state.guidedEvidencePending = true;
    round.announcement = "Saving the first response before showing feedback…";
    renderReconstruction();
    try {
      if (!correct) round.guidedLifecycle.markSolutionRevealed();
      const supportState = round.guidedLifecycle.state();
      state.guidedSupportAtFirstResponse = Boolean(
        supportState.hintsUsed || supportState.solutionRevealed
      );
      const evidence = await round.guidedLifecycle.recordFirstResponse({
        score: correct ? 1 : 0,
        occurredAt: new Date().toISOString()
      });
      round.guidedIndependentQualified = evidence?.result?.qualifiesForIndependentAssessment === true;
      if (state.guidedResetPending || round.guidedLifecycle !== state.guidedLifecycle) {
        round.evidencePending = false;
        state.guidedEvidencePending = false;
        return;
      }
    } catch (error) {
      round.evidencePending = false;
      failGuidedWordWorld(error, "Your answer stayed hidden because its evidence could not be saved.");
      round.announcement = "Evidence was not saved. Feedback remains hidden.";
      renderReconstruction();
      return;
    }
    round.evidencePending = false;
    state.guidedEvidencePending = false;
  }
  round.correct = correct;
  const guidedRound = Boolean(round.guidedLifecycle);
  const rewardAvailable = guidedRound ? false : claimSentenceReward(round.key);
  round.awardedXp = round.correct && rewardAvailable ? 3 : 0;
  round.submitted = true;
  round.submittedText = reconstructionSelectedText(round);
  round.announcement = round.correct
    ? guidedRound
      ? round.guidedIndependentQualified
        ? "Correct. Continue to Verb Nebula."
        : "Correct with support. Try once more without help."
      : (round.awardedXp ? "Correct. 3 XP gained." : "Correct. This sentence was already rewarded.")
    : "That answer is incorrect. Check the words in red, then try again.";
  if (!guidedRound) {
    window.CaatuuLearning?.record("word-world", {
      attempts: 1,
      successes: round.correct ? 1 : 0,
      xp: round.awardedXp,
      rounds: 1
    });
    if (round.correct) announceCampaignRoundSuccess();
  } else {
    state.guidedStatus = round.guidedIndependentQualified ? "complete" : "retry";
    renderWordGuidedStatus();
  }
  renderReconstruction();
  stabilizeReconstructionResultViewport();
  window.requestAnimationFrame(() => $("#wordNetNext")?.focus({ preventScroll: true }));
}

function shouldBlockReconstructionAdvance() {
  if (state.translationMode !== "reconstruct") return false;
  const round = ensureReconstructionChallenge();
  if (!round || round.submitted) return false;
  round.announcement = "Submit your answer before moving to the next sentence.";
  renderReconstruction();
  $("#wordNetReconstructionSubmit")?.focus({ preventScroll: true });
  return true;
}

async function activateNextSentence() {
  if (state.guidedRequested) {
    const round = ensureReconstructionChallenge();
    if (!round?.submitted || state.busy || state.guidedEvidencePending) return;
    if (round.guidedIndependentQualified) {
      if (window.parent !== window) {
        notifyHost("guided-journey-continue", {
          completedActivityId: "word-world",
          nextActivityId: "verb-nebula"
        });
        return;
      }
      const href = guidedJourneyHref("verb-nebula");
      if (href) window.location.href = href;
      return;
    }

    const lifecycle = state.guidedLifecycle;
    if (lifecycle?.abort) await lifecycle.abort();
    if (state.guidedLifecycle === lifecycle) state.guidedLifecycle = null;
    state.guidedSupportAtFirstResponse = false;
    state.guidedStatus = "pending";
    state.reconstruction = null;
    state.translationVisible = false;
    state.guidedActivationEpoch += 1;
    state.phraseRequestId += 1;
    setBusy(true);
    setStatus("Preparing another attempt with the same reviewed sentence.", { tone: "active" });
    try {
      await generateGuidedStandardPhrase({ allowBusy: true });
    } finally {
      if (state.busy) setBusy(false);
    }
    return;
  }
  if (state.busy) return;
  if (shouldBlockReconstructionAdvance()) return;
  generateFromConfiguredMode(state.generationMode, { force: true });
}

function claimSentenceReward(rewardKey = currentReconstructionKey()) {
  if (!rewardKey || state.sentenceRewardKeys.has(rewardKey)) return false;
  state.sentenceRewardKeys.add(rewardKey);
  while (state.sentenceRewardKeys.size > SENTENCE_REWARD_LIMIT) {
    state.sentenceRewardKeys.delete(state.sentenceRewardKeys.values().next().value);
  }
  return true;
}

function awardTimedRevealXp() {
  if (!claimSentenceReward()) return false;
  window.CaatuuLearning?.record("word-world", { xp: 1 });
  setStatus("English revealed. +1 XP.", { tone: "success" });
  return true;
}

function currentGuidedPhraseToken() {
  return [state.phraseRequestId, state.currentEntryId, state.currentSentence].join("|");
}

async function revealGuidedEnglish(lifecycle, phraseToken) {
  if (!state.guidedMode || !lifecycle || guidedWordInteractionLocked()) return;
  state.guidedEvidencePending = true;
  state.translationVisible = false;
  syncTranslationToggle();
  try {
    if (!lifecycle.state().firstResponseRecorded) {
      state.guidedSupportAtFirstResponse = true;
    }
    await lifecycle.recordSolutionReveal({ occurredAt: new Date().toISOString() });
  } catch (error) {
    failGuidedWordWorld(error, "The English answer stayed hidden because its evidence could not be saved.");
    return;
  } finally {
    state.guidedEvidencePending = false;
  }
  if (phraseToken !== currentGuidedPhraseToken() || lifecycle !== state.guidedLifecycle) return;
  state.translationVisible = true;
  renderWordGuidedStatus();
  syncTranslationToggle();
}

function applyTranslationMode({ restartTimer = false } = {}) {
  clearTranslationTimer();

  const mode = hasTranslationMode(state.translationMode) ? state.translationMode : "reconstruct";
  if (mode !== state.translationMode) state.translationMode = mode;
  const delayMs = translationModes[mode].delayMs;

  state.translationVisible = state.guidedMode ? false : mode === "visible";
  if (state.guidedMode && mode === "visible" && state.currentTranslation && state.guidedLifecycle) {
    void revealGuidedEnglish(state.guidedLifecycle, currentGuidedPhraseToken());
  }
  if (restartTimer && isTimedTranslationMode(mode) && Number.isFinite(delayMs) && state.currentTranslation) {
    const guidedLifecycle = state.guidedLifecycle;
    const phraseToken = currentGuidedPhraseToken();
    state.translationTimerId = window.setTimeout(() => {
      state.translationTimerId = 0;
      if (document.visibilityState === "hidden") return;
      if (state.guidedMode && guidedLifecycle) {
        void revealGuidedEnglish(guidedLifecycle, phraseToken);
        return;
      }
      state.translationVisible = true;
      syncTranslationToggle();
      awardTimedRevealXp();
    }, delayMs);
  }

  syncTranslationToggle();
}

function setTranslationMode(mode, { closeMenu = true } = {}) {
  if (guidedWordInteractionLocked()) return;
  if (!hasTranslationMode(mode)) return;
  cancelBackgroundWork();
  state.translationMode = mode;
  saveTranslationMode();
  applyTranslationMode({ restartTimer: true });
  setStatus(currentPlayInstruction());
  if (closeMenu) closeTranslationMenu({ restoreFocus: true });
  if (mode === "off") {
    if (state.speechSource === "word") cancelCzechSpeech();
    abortWordLookup();
  } else if (state.selectedWord && !state.selectedWordMeaning) {
    void lookupSelectedWord(state.selectedWord);
  }
  if (state.currentContentMode === "standard" && state.currentSentence) {
    setTranslation(state.currentTranslation);
    if (state.guidedMode) hideSceneAsset({ cancel: true });
    else void updateSceneAsset(state.currentSceneQuery || state.currentTranslation);
    return;
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
  const mode = hasTranslationMode(state.translationMode) ? state.translationMode : "reconstruct";
  const reconstructing = mode === "reconstruct";
  const label = translationModes[mode].label;
  button.classList.toggle("is-off", mode === "off");
  button.classList.toggle("is-waiting", mode.startsWith("timer-") && !state.translationVisible);
  button.setAttribute("aria-label", `Challenge type and dictionary settings. Current answer mode: ${label}.`);
  button.setAttribute("title", `Answer mode: ${label}`);
  translation.hidden = reconstructing;
  translation.classList.toggle("is-hidden", !state.translationVisible && !reconstructing);
  translation.setAttribute("aria-hidden", state.translationVisible && !reconstructing ? "false" : "true");
  const panel = $(".word-net-sentence-panel");
  if (panel) panel.dataset.translationMode = mode;
  syncPlayInstruction();
  renderReconstruction();
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
  const guidedState = state.guidedLifecycle?.state();
  const guidedCardAllowed = !state.guidedMode
    || Boolean(guidedState?.hintsUsed || guidedState?.firstResponseRecorded);
  const visible = Boolean(state.selectedWord)
    && translationEnabled
    && state.wordCardPreferences.showCard
    && guidedCardAllowed;
  const details = state.selectedWordDetails;
  const normalizedSelected = normalizeWord(state.selectedWord).toLocaleLowerCase(targetLocale);
  const normalizedLemma = normalizeWord(details?.lemma).toLocaleLowerCase(targetLocale);
  const metadata = [];
  if (normalizedLemma && normalizedLemma !== normalizedSelected) metadata.push(`lemma ${details.lemma}`);
  if (details?.formTags?.length) metadata.push(details.formTags.slice(0, 3).join(" ").replaceAll("-", " "));
  const grammarTags = (details?.senseTags || []).filter((tag) => !details?.formTags?.includes(tag));
  if (grammarTags.length) metadata.push(grammarTags.slice(0, 2).join(" ").replaceAll("-", " "));
  if (details?.synonyms?.length) metadata.push(`also ${details.synonyms.slice(0, 2).join(", ")}`);
  if (state.selectedWordGapNotice) metadata.push(state.selectedWordGapNotice);
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
  metaNode.hidden = !metaNode.textContent;
  metaNode.title = metaNode.textContent;
  syncTranslationMenu();
  syncSpeechControl();
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

async function queueMissingDictionaryFeedback(selectedWord, { lookupReturned = 0 } = {}) {
  if (providerContext?.session?.course?.capabilities?.dictionary !== true) return;
  const normalizedWord = normalizeWord(selectedWord).toLocaleLowerCase(targetLocale);
  if (!normalizedWord) return;
  if (state.dictionaryGapKeys.includes(normalizedWord)) {
    if (normalizedWord === state.selectedWord.toLocaleLowerCase(targetLocale)) {
      state.selectedWordGapNotice = DICTIONARY_GAP_NOTICE;
      syncWordTranslation();
    }
    return;
  }
  const lookupOutcome = Number(lookupReturned) > 0 ? "no_exact_usable_entry" : "no_results";
  const feedback = {
    targetWord: selectedWord,
    normalizedWord,
    dictionaryKey: DICTIONARY_GAP_SOURCE_KEY,
    dictionaryDirection: "cs-en",
    lookupOutcome,
    lookupReturned: Math.max(0, Math.floor(Number(lookupReturned) || 0))
  };
  try {
    const queued = await runtimeAdapter()?.maintenance?.enqueueDictionaryGap?.(feedback);
    if (!queued?.queued || queued.persisted === false || !rememberDictionaryGap(normalizedWord)) return;
    if (normalizedWord === state.selectedWord.toLocaleLowerCase(targetLocale)) {
      state.selectedWordGapNotice = DICTIONARY_GAP_NOTICE;
      syncWordTranslation();
    }
  } catch (error) {
    // The general fallback meaning remains useful even when device storage is full.
  }
}

function preparedTokenForWord(selectedWord) {
  const record = typeof providerContext?.sessionRecord === "function"
    ? providerContext.sessionRecord(state.currentEntryId)
    : null;
  const tokens = Array.isArray(record?.target?.tokens) ? record.target.tokens : [];
  const searchKey = providerContext?.normalization?.searchKey;
  const selectedKey = typeof searchKey === "function"
    ? searchKey(selectedWord, { record, purpose: "word-world-meaning" })
    : normalizeWord(selectedWord).toLocaleLowerCase(targetLocale);
  const tokenIndex = tokens.findIndex((token, index) => {
    const value = token?.surface ?? token?.text ?? "";
    const key = typeof searchKey === "function"
      ? searchKey(value, { record, token, tokenIndex: index, purpose: "word-world-meaning" })
      : normalizeWord(value).toLocaleLowerCase(targetLocale);
    return key && key === selectedKey;
  });
  return tokenIndex >= 0 ? { record, token: tokens[tokenIndex], tokenIndex } : null;
}

function selectedEnglishSemanticQuery(selectedWord) {
  const prepared = preparedTokenForWord(selectedWord);
  const record = prepared?.record || (typeof providerContext?.sessionRecord === "function"
    ? providerContext.sessionRecord(state.currentEntryId)
    : null);
  const candidates = [
    state.selectedWordDetails?.meaning,
    state.selectedWordMeaning,
    prepared?.token?.gloss,
    record?.englishText,
    state.currentTranslation
  ];
  const placeholders = new Set([
    "meaning available",
    "look up meaning",
    "no english meaning found.",
    "meaning unavailable."
  ]);
  for (const candidate of candidates) {
    const query = String(candidate || "").normalize("NFC").replace(/\s+/gu, " ").trim();
    if (query && !placeholders.has(query.toLocaleLowerCase("en-US"))) return query;
  }
  return "";
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
    if (state.selectedWordDetails && !state.selectedWordDetails.dictionaryMissing && forgetDictionaryGap(key)) {
      state.selectedWordGapNotice = "";
    }
    syncWordTranslation();
    if (state.selectedWordDetails?.dictionaryMissing) {
      void queueMissingDictionaryFeedback(selectedWord, {
        lookupReturned: state.selectedWordDetails.lookupReturned
      });
    }
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
    const authored = preparedTokenForWord(selectedWord);
    const preparedMeaning = authored && typeof providerContext?.lookupMeaning === "function"
      ? await providerContext.lookupMeaning({
          course: providerContext.session.course,
          ...authored
        })
      : null;
    let result = preparedMeaning
      ? {
          lemma: selectedWord,
          pos: String(preparedMeaning.partOfSpeech || ""),
          formTags: [],
          senseTags: [],
          synonyms: [],
          meaning: String(preparedMeaning.meaning || "").normalize("NFC").trim(),
          metadata: String(preparedMeaning.metadata || "").normalize("NFC").trim()
        }
      : null;
    let lookupReturned = result ? 1 : 0;
    if (!result && providerContext?.session?.course?.capabilities?.dictionary === true) {
      const dictionary = runtimeAdapter()?.dictionary;
      if (!dictionary?.search) throw new Error("Dictionary lookup is unavailable.");
      const payload = await dictionary.search(selectedWord, { limit: 8, signal: controller.signal });
      result = selectDictionaryMeaning(payload, selectedWord, { maxGlosses: 2 });
      lookupReturned = Array.isArray(payload?.results) ? payload.results.length : 0;
    }
    const meaning = result?.meaning || fallback || "No English meaning found.";
    const details = result || {
      lemma: selectedWord,
      pos: "",
      formTags: [],
      senseTags: [],
      synonyms: [],
      meaning,
      dictionaryMissing: true,
      lookupReturned
    };
    cacheWordMeaning(key, details);
    if (result) forgetDictionaryGap(key);
    if (requestId !== state.wordLookupRequestId || key !== state.selectedWord.toLocaleLowerCase(targetLocale)) return;
    state.selectedWordMeaning = meaning;
    state.selectedWordDetails = details;
    if (result) state.selectedWordGapNotice = "";
    if (!result) void queueMissingDictionaryFeedback(selectedWord, { lookupReturned });
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

function selectWord(word, { lookup = true, render = true, userInitiated = false } = {}) {
  const selectedWord = normalizeWord(word);
  if (!selectedWord) return;
  const previousKey = state.selectedWord.toLocaleLowerCase(targetLocale);
  const nextKey = selectedWord.toLocaleLowerCase(targetLocale);
  state.selectedWord = selectedWord;
  if (previousKey !== nextKey) {
    if (state.speechSource === "word") cancelCzechSpeech();
    abortWordLookup();
    state.selectedWordGapNotice = state.dictionaryGapKeys.includes(nextKey)
      ? DICTIONARY_GAP_NOTICE
      : "";
    state.selectedWordDetails = state.wordMeaningCache.get(nextKey) || null;
    state.selectedWordMeaning = state.selectedWordDetails?.meaning || "";
  }
  if (render && state.currentSentence) renderCzechSentence(state.currentSentence, selectedWord);
  syncGenerationControl();
  syncWordTranslation();
  if (lookup && state.translationMode !== "off" && !state.selectedWordMeaning) {
    void lookupSelectedWord(selectedWord);
  }
  if (
    userInitiated
    && state.translationMode !== "off"
    && state.wordCardPreferences.autoPronounce
  ) {
    speakSelectedCzechWord();
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
  state.loadingRobotVisibleAt = 0;
  const image = $("#wordNetLoadingArt");
  if (!image) return;
  image.onload = null;
  image.onerror = null;
  image.hidden = true;
  image.removeAttribute("src");
}

function waitForVisiblePaint() {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(resolve));
  });
}

async function showLoadingRobot() {
  const image = $("#wordNetLoadingArt");
  const loading = $("#wordNetLoading");
  if (!image || !loading || loading.hidden) return false;
  const requestId = state.robotRequestId + 1;
  state.robotRequestId = requestId;
  state.loadingRobotVisibleAt = 0;
  const rows = await Promise.race([
    loadingRobotRows(),
    new Promise((resolve) => window.setTimeout(() => resolve([]), LOADING_ROBOT_KEYMAP_WAIT_MS))
  ]);
  if (requestId !== state.robotRequestId || loading.hidden) return false;

  const startIndex = rows.length ? state.robotCursor % rows.length : 0;
  if (rows.length) state.robotCursor = (state.robotCursor + 1) % rows.length;
  const paths = rows.length
    ? [...rows.slice(startIndex), ...rows.slice(0, startIndex)].map((row) => row.assetPath)
    : [];
  if (!paths.includes(ROBOT_FALLBACK_URL)) paths.push(ROBOT_FALLBACK_URL);

  return new Promise((resolve) => {
    let settled = false;
    let timeoutId = 0;
    let loadHandler = null;
    let errorHandler = null;
    const removeImageListeners = () => {
      if (loadHandler) image.removeEventListener("load", loadHandler);
      if (errorHandler) image.removeEventListener("error", errorHandler);
      loadHandler = null;
      errorHandler = null;
    };
    const finish = (visible) => {
      if (settled) return;
      if (
        !visible
        && requestId === state.robotRequestId
        && !loading.hidden
        && !state.loadingRobotVisibleAt
      ) {
        // Even if every artwork fails, keep a calm, predictable pause on the
        // loading layer instead of flashing directly to the next sentence.
        state.loadingRobotVisibleAt = performance.now();
      }
      settled = true;
      window.clearTimeout(timeoutId);
      removeImageListeners();
      resolve(visible);
    };
    const tryPath = (offset) => {
      const path = paths[offset];
      if (!path || requestId !== state.robotRequestId || loading.hidden) {
        finish(false);
        return;
      }
      removeImageListeners();
      image.hidden = true;
      const expectedSrc = new URL(path, window.location.href).href;
      loadHandler = async () => {
        if (image.currentSrc !== expectedSrc && image.src !== expectedSrc) return;
        removeImageListeners();
        if (requestId !== state.robotRequestId || loading.hidden) {
          finish(false);
          return;
        }
        image.hidden = false;
        await waitForVisiblePaint();
        if (settled) return;
        if (requestId !== state.robotRequestId || loading.hidden) {
          finish(false);
          return;
        }
        state.loadingRobotVisibleAt = performance.now();
        finish(true);
      };
      errorHandler = () => {
        if (image.currentSrc !== expectedSrc && image.src !== expectedSrc) return;
        removeImageListeners();
        tryPath(offset + 1);
      };
      image.addEventListener("load", loadHandler);
      image.addEventListener("error", errorHandler);
      image.src = path;
      if (image.complete && image.naturalWidth && (image.currentSrc === expectedSrc || image.src === expectedSrc)) {
        void loadHandler();
      }
    };
    timeoutId = window.setTimeout(() => finish(false), LOADING_ROBOT_IMAGE_WAIT_MS);
    tryPath(0);
  });
}

async function holdSentenceTransition(startedAt) {
  await Promise.resolve(state.loadingRobotReadyPromise).catch(() => false);
  const visibleAt = Number(state.loadingRobotVisibleAt || 0);
  const transitionAnchor = Math.max(startedAt, visibleAt);
  const elapsed = performance.now() - transitionAnchor;
  const remaining = Math.max(0, MIN_SENTENCE_TRANSITION_MS - elapsed);
  if (remaining > 0) {
    await new Promise((resolve) => window.setTimeout(resolve, remaining));
  }
}

function setBusy(busy, { cover = busy, immediate = false } = {}) {
  state.busy = busy;
  if (busy) {
    closeAudioMenu();
    closeTranslationMenu();
    cancelCzechSpeech();
  }
  document.querySelectorAll(".word-net-generation-toggle, .word-net-generation-menu button, .word-net-translation-toggle, .word-net-translation-menu button, .word-net-word-pronounce, .word-net-side-nav, .cz-word-token, .word-net-reconstruction button, #wordNetReconstructionSubmit, .word-net-reconstruction-result button, [data-content-mode]").forEach((button) => {
    button.disabled = busy;
  });
  syncGenerationControl();
  syncContentControl();
  syncPreviousSentenceControl(state.translationMode === "reconstruct" ? state.reconstruction : null);
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
      state.loadingRobotReadyPromise = showLoadingRobot();
    } else if (immediate) {
      loading.classList.remove("is-visible");
      loading.hidden = true;
      hideLoadingRobot();
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
  renderReconstruction();
  syncSpeechControl();
  syncDiagnostics();
  if (!busy) window.requestAnimationFrame(() => maybeAutoplayCurrentSentence());
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
  const [semanticRows, keymapRows] = await Promise.all([
    semanticSceneCandidates(text),
    Promise.race([
      rankedKeymapSceneCandidates(text),
      sceneDelay(SCENE_KEYMAP_SEARCH_TIMEOUT_MS, [])
    ])
  ]);
  const seenPaths = new Set();
  return [...semanticRows, ...keymapRows].filter((candidate) => {
    const path = String(candidate?.assetPath || "");
    if (!path || seenPaths.has(path)) return false;
    seenPaths.add(path);
    return true;
  });
}

async function semanticSceneCandidates(text) {
  try {
    const response = await Promise.race([
      Promise.resolve(runtimeAdapter()?.vector?.search?.(text, {
        limit: SCENE_ASSET_LIMIT,
        sourceKinds: ["image_asset"]
      })),
      sceneDelay(SCENE_SEMANTIC_SEARCH_TIMEOUT_MS, null)
    ]);
    return (Array.isArray(response?.results) ? response.results : [])
      .map((row) => ({
        assetPath: row.documentMetadata?.asset_path || row.chunkMetadata?.asset_path || row.sourceId || "",
        description: row.text || row.title || "Caatuu scene",
        score: Number(row.score || 0),
        semanticScore: Number(row.semanticScore ?? row.score ?? 0),
        lexicalScore: Number(row.lexicalScore || 0)
      }))
      .filter((row) => isMiscellaneousAssetPath(row.assetPath));
  } catch (error) {
    // The game must remain playable if setup is incomplete or a runtime is not
    // available. The keymap-only fallback below still chooses a related image.
  }
  return [];
}

async function rankedKeymapSceneCandidates(text) {
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
  state.currentSceneAsset = null;
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

function sceneDelay(milliseconds, value = false) {
  return new Promise((resolve) => window.setTimeout(() => resolve(value), Math.max(0, milliseconds)));
}

function sceneTimeRemaining(deadline) {
  return Math.max(0, Number(deadline || 0) - performance.now());
}

async function waitForImageLoad(image, src, deadline) {
  const remaining = sceneTimeRemaining(deadline);
  if (remaining <= 0) return false;
  const expectedSrc = new URL(src, window.location.href).href;
  return new Promise((resolve) => {
    let settled = false;
    const matchesExpectedSource = () => image.currentSrc === expectedSrc || image.src === expectedSrc;
    const onLoad = () => {
      if (matchesExpectedSource()) finish(Boolean(image.complete && image.naturalWidth));
    };
    const onError = () => {
      if (matchesExpectedSource()) finish(false);
    };
    const finish = (ready) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      image.removeEventListener("load", onLoad);
      image.removeEventListener("error", onError);
      resolve(ready);
    };
    const timeoutId = window.setTimeout(() => finish(false), remaining);
    image.addEventListener("load", onLoad);
    image.addEventListener("error", onError);
    image.src = src;
    if (matchesExpectedSource() && image.complete) finish(Boolean(image.naturalWidth));
  });
}

async function waitForImageDecode(image, deadline) {
  if (typeof image.decode !== "function") return true;
  const remaining = sceneTimeRemaining(deadline);
  if (remaining <= 0) return false;
  return Promise.race([
    image.decode()
      .then(() => Boolean(image.complete && image.naturalWidth))
      .catch(() => Boolean(image.complete && image.naturalWidth)),
    sceneDelay(remaining, false)
  ]);
}

async function renderSceneCandidate(candidateIndex, requestId, deadline) {
  const scene = $("#wordNetScene");
  const image = $("#wordNetSceneImage");
  const candidate = state.sceneCandidates[candidateIndex];
  if (!scene || !image || !candidate || requestId !== state.sceneRequestId) return false;

  const candidateDeadline = Math.min(deadline, performance.now() + SCENE_CANDIDATE_LOAD_TIMEOUT_MS);
  scene.hidden = true;
  image.alt = candidate.description;
  if (!(await waitForImageLoad(image, candidate.assetPath, candidateDeadline))) return false;
  if (!(await waitForImageDecode(image, candidateDeadline))) return false;
  if (requestId !== state.sceneRequestId) return false;
  state.currentSceneAsset = {
    src: image.currentSrc || image.src || candidate.assetPath,
    alt: candidate.description
  };
  scene.hidden = false;
  await Promise.race([
    waitForVisiblePaint(),
    sceneDelay(Math.min(180, sceneTimeRemaining(deadline)), true)
  ]);
  return requestId === state.sceneRequestId && !scene.hidden;
}

async function updateSceneAsset(englishText) {
  const requestId = state.sceneRequestId + 1;
  state.sceneRequestId = requestId;
  hideSceneAsset();
  const deadline = performance.now() + SCENE_ASSET_READY_TIMEOUT_MS;

  try {
    if (providerContext?.providerKind === "authored-realizations"
        && typeof providerContext.sceneForRecord === "function"
        && typeof providerContext.sessionRecord === "function") {
      const record = providerContext.sessionRecord(state.currentEntryId);
      const scene = record ? providerContext.sceneForRecord(record) : null;
      if (scene?.src) {
        state.sceneCandidates = [{
          assetPath: String(scene.src),
          description: String(scene.alt || record?.sceneQuery || record?.englishText || "Caatuu scene")
        }];
        if (await renderSceneCandidate(0, requestId, deadline)) return true;
        if (requestId !== state.sceneRequestId) return false;
      }
    }
    let candidates = await Promise.race([
      rankedSceneCandidates(englishText),
      sceneDelay(Math.min(SCENE_CANDIDATE_SEARCH_TIMEOUT_MS, sceneTimeRemaining(deadline)), null)
    ]);
    if (requestId !== state.sceneRequestId) return false;
    if (!Array.isArray(candidates)) {
      const fallbackBudget = Math.max(0, Math.min(1200, sceneTimeRemaining(deadline) - 1800));
      candidates = fallbackBudget > 0
        ? await Promise.race([
            rankedKeymapSceneCandidates(String(englishText || "").trim()),
            sceneDelay(fallbackBudget, [])
          ])
        : [];
    }
    if (requestId !== state.sceneRequestId) return false;
    state.sceneCandidates = candidates;
    for (let index = 0; index < candidates.length && sceneTimeRemaining(deadline) > 0; index += 1) {
      if (await renderSceneCandidate(index, requestId, deadline)) return true;
      if (requestId !== state.sceneRequestId) return false;
    }
    if (requestId === state.sceneRequestId) hideSceneAsset();
  } catch (error) {
    if (requestId === state.sceneRequestId) hideSceneAsset();
  }
  return false;
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

async function requestEnglishTranslation(
  sentence,
  word,
  { signal, onStatus, timeoutMs = 180000 } = {}
) {
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
        timeoutMs,
        timeoutMessage: timeoutMs <= FOREGROUND_TRANSLATION_TIMEOUT_MS
          ? "English is still being prepared in the background."
          : "English translation took too long.",
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

async function prepareCandidateForDisplay(word, candidate) {
  if (state.translationMode === "off" || candidate?.translation || !candidate?.sentence) {
    return candidate;
  }

  setStatus("Preparing English before the phrase appears.", { tone: "active" });
  let translation = "";
  try {
    translation = await requestEnglishTranslation(candidate.sentence, word, {
      timeoutMs: FOREGROUND_TRANSLATION_TIMEOUT_MS
    });
  } catch (error) {
    // A navigation cancellation must never leave the sentence covered by the
    // loading layer. The queue can continue richer translation work later.
    translation = localTranslation(candidate.sentence, word);
  }
  if (state.branchQueue.setTranslation(candidate.sentence, translation)) savePreparedQueue();
  return {
    ...candidate,
    translation
  };
}

async function presentPreparedCandidate(target, candidate, transitionStartedAt) {
  let requestId = state.phraseRequestId;
  try {
    const prepared = await prepareCandidateForDisplay(target, candidate);
    if (requestId !== state.phraseRequestId) return null;
    requestId += 1;
    state.phraseRequestId = requestId;
    await Promise.all([
      holdSentenceTransition(transitionStartedAt),
      showPreparedPhrase(target, prepared)
    ]);
    return prepared;
  } finally {
    if (requestId === state.phraseRequestId) setBusy(false);
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
  updateHistoryTranslation(sentence, translation);
  setTranslation(translation);
  return translation;
}

async function enrichCurrentPhrase() {
  if (!state.generativeTurnActive || state.contentMode !== "generative" || state.currentContentMode === "standard") return;
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

function cancelBackgroundWork({ preserveSpeculative = false } = {}) {
  clearPrefetchTimer();
  if (preserveSpeculative && PRESERVABLE_BACKGROUND_ACTIVITIES.has(state.backgroundActivity)) {
    syncDiagnostics();
    return;
  }
  state.backgroundController?.abort();
  state.backgroundController = null;
  state.backgroundActivity = "";
  syncDiagnostics();
}

async function prefetchAllowance() {
  if (document.visibilityState === "hidden") return PREFETCH_PAUSED;
  if (navigator.connection?.saveData === true) return PREFETCH_PAUSED;
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
    if (!battery.charging && Number(battery.level) < 0.35) return PREFETCH_PAUSED;
    if (battery.charging) freshTarget = PREFETCH_FRESH_TARGET;
  } catch (error) {
    // Use the conservative fresh target when battery state is unavailable.
  }
  return allowanceForTarget();
}

function schedulePrefetch(
  sentence,
  delayMs = nativeWordNetRuntimeAvailable() ? PREFETCH_NATIVE_IDLE_DELAY_MS : PREFETCH_IDLE_DELAY_MS
) {
  clearPrefetchTimer();
  // Choosing Generative only reveals the optional mode. Do not start its
  // on-demand model download until a Generative sentence has actually run.
  if (!state.generativeTurnActive || state.contentMode !== "generative" || state.currentContentMode !== "generative") return;
  if (!sentence || document.visibilityState === "hidden") return;
  state.prefetchSourceSentence = sentence;
  state.prefetchBudget = PREFETCH_PER_TURN;
  state.prefetchAttemptedWords = new Map();
  if (PRESERVABLE_BACKGROUND_ACTIVITIES.has(state.backgroundActivity)) {
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

function freshTranslatedPreparedCount() {
  return state.branchQueue.values()
    .filter((entry) => entry.sentence && entry.translation && entry.useCount === 0)
    .length;
}

async function translatePreparedBatch({ signal } = {}) {
  const candidates = untranslatedPreparedCandidates();
  if (!candidates.length) return 0;

  let translated = 0;
  for (const candidate of candidates) {
    signal?.throwIfAborted?.();
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
  if (!state.generativeTurnActive || state.contentMode !== "generative" || state.currentContentMode !== "generative") return;
  if (state.busy || state.backgroundController || state.prefetchBudget <= 0) return;
  if (state.prefetchSourceSentence !== state.currentSentence) return;
  const phraseRequestId = state.phraseRequestId;
  const prefetchSourceSentence = state.prefetchSourceSentence;
  const allowance = await prefetchAllowance();
  if (
    !state.generativeTurnActive
    || state.contentMode !== "generative"
    || state.currentContentMode !== "generative"
    || phraseRequestId !== state.phraseRequestId
  ) return;
  if (state.busy || state.backgroundController || state.prefetchBudget <= 0) return;
  if (state.prefetchSourceSentence !== state.currentSentence) return;
  if (allowance === PREFETCH_PAUSED) return;
  const pendingTranslations = state.translationMode === "off"
    ? []
    : untranslatedPreparedCandidates();
  const translatedFresh = freshTranslatedPreparedCount();
  let translateBatch = pendingTranslations.length > 0
    && (
      translatedFresh < PREFETCH_TRANSLATED_LOW_WATER
      || state.prefetchGeneratedSinceTranslation >= PREFETCH_TRANSLATION_BATCH_SIZE
      || allowance === 0
    );
  const target = !translateBatch && allowance > 0 ? nextPrefetchTarget() : "";
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
    const phraseChanged = phraseRequestId !== state.phraseRequestId
      || prefetchSourceSentence !== state.prefetchSourceSentence;
    if (
      phraseChanged
      && !controller.signal.aborted
      && state.generativeTurnActive
      && state.contentMode === "generative"
      && state.currentContentMode === "generative"
      && state.currentSentence
    ) {
      state.prefetchBudget = 0;
      schedulePrefetch(state.currentSentence);
    } else {
      state.prefetchBudget = translateBatch ? 0 : state.prefetchBudget - 1;
    }
    if (
      !phraseChanged
      && !controller.signal.aborted
      && state.prefetchBudget > 0
      && state.prefetchSourceSentence === state.currentSentence
    ) {
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

function segmentedSentence(sentence) {
  const currentRecord = typeof providerContext?.sessionRecord === "function"
    ? providerContext.sessionRecord(state.currentEntryId)
    : null;
  if (typeof providerContext?.segment === "function") {
    const learnerContent = currentRecord?.target?.text === String(sentence || "").normalize("NFC").trim()
      ? currentRecord.target
      : sentence;
    try {
      return providerContext.segment(learnerContent, { record: currentRecord });
    } catch (error) {
      if (currentRecord?.target) throw error;
    }
  }
  return tokenizeLegacySentence(sentence);
}

function renderCzechSentence(
  sentence,
  selectedWord = "",
  curriculumFocus = state.guidedMode ? state.guidedFocusTarget : null
) {
  const host = $("#wordNetSentence");
  if (!host) return;

  const tokens = segmentedSentence(sentence);
  if (!tokens.length) {
    const empty = document.createElement("p");
    empty.className = "word-net-empty";
    empty.textContent = `Preparing a ${targetLanguageLabel} phrase.`;
    host.replaceChildren(empty);
    syncSpeechControl();
    return;
  }

  const nodes = [];
  let openingPunctuation = [];
  let wordIndex = 0;
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
    const curriculumFocused = Number(curriculumFocus?.tokenIndex) === wordIndex
      && wordMatchesTarget(button.dataset.word, curriculumFocus?.normalized);
    const label = curriculumFocused
      ? `Curriculum focus: ${token.text}. Select it to show its meaning`
      : `Select ${token.text} and show its meaning`;
    button.setAttribute("aria-label", label);
    const selected = wordMatchesTarget(button.dataset.word, selectedWord);
    button.setAttribute("aria-pressed", selected ? "true" : "false");
    if (selected) {
      button.classList.add("is-selected");
    }
    if (curriculumFocused) {
      button.classList.add("is-curriculum-focus");
      button.dataset.curriculumFocus = "true";
    }
    wordIndex += 1;
    cluster.append(button);
    nodes.push(cluster);
  }
  nodes.push(...openingPunctuation);
  host.replaceChildren(...nodes);
  syncGenerationControl();
  syncSpeechControl();
}

function rememberStep(word, sentence, metadata = {}) {
  const fingerprint = sentenceFingerprint(sentence);
  const alreadyRemembered = state.history.some((entry) => sentenceFingerprint(entry.sentence) === fingerprint);
  state.history = state.history.filter((entry) => sentenceFingerprint(entry.sentence) !== fingerprint);
  state.history.unshift({
    id: String(metadata.id || ""),
    word,
    sentence,
    en: String(metadata.en || ""),
    contentMode: metadata.contentMode === "standard" ? "standard" : "generative",
    source: String(metadata.source || state.currentGenerationSource || "unknown"),
    corpusVersion: String(metadata.corpusVersion || ""),
    difficulty: Number(metadata.difficulty) >= 1 && Number(metadata.difficulty) <= 3
      ? Math.floor(Number(metadata.difficulty))
      : null,
    sceneQuery: String(metadata.sceneQuery || metadata.en || "")
  });
  state.history = state.history.slice(0, HISTORY_LIMIT);
  state.historyCursor = 0;
  saveHistory();
  if (!alreadyRemembered) {
    window.CaatuuLearning?.record("word-world", { activities: 1 });
  }
  renderTrail();
  syncDiagnostics();
}

function recordStandardSemanticExposure(record, provider, targetWord) {
  const semanticLearning = window.CaatuuSemanticLearning;
  const english = String(record?.en || "").trim();
  if (!semanticLearning || !record?.id || !english) return;
  const corpusVersion = String(provider?.corpusVersion || "1");
  void semanticLearning.recordAttempt({
    activityId: "word-world",
    itemId: `word-world:${corpusVersion}:${record.id}`,
    item: {
      sourceId: record.id,
      corpusVersion,
      czech: record.cs,
      english,
      difficulty: record.difficulty,
      cefr: record.cefr,
      topic: record.topic,
      grammar: record.grammar,
      learning: record.learning
    },
    signals: [{
      conceptId: `cz.word-world.${record.id}.sentence-meaning`,
      statementRevision: corpusVersion,
      kind: "meaning",
      locale: "en",
      text: `Builds familiarity with the meaning of an everyday Czech sentence: “${english}”`,
      score: null,
      coverageWeight: 0.25,
      masteryWeight: 0
    }],
    context: {
      outcome: "exposure",
      contentMode: "standard",
      targetWord,
      courseDifficulty: learningDifficulty(),
      itemDifficulty: record.difficulty,
      corpusVersion
    }
  }).catch(() => {});
}

function updateHistoryTranslation(sentence, translation) {
  const fingerprint = sentenceFingerprint(sentence);
  const entry = state.history.find((item) => sentenceFingerprint(item.sentence) === fingerprint);
  if (!entry || !translation) return;
  entry.en = String(translation);
  if (!entry.sceneQuery) entry.sceneQuery = String(translation);
  saveHistory();
}

async function showPreviousSentence() {
  if (state.guidedRequested) {
    setStatus("History is disabled while the exact Guided task is active.", { tone: "muted" });
    return;
  }
  if (state.busy) return;
  if (shouldBlockReconstructionAdvance()) return;
  const previousIndex = state.historyCursor + 1;
  const previous = state.history[previousIndex];
  if (!previous) {
    setStatus("There is no earlier sentence yet.", { tone: "muted" });
    return;
  }

  const transitionStartedAt = performance.now();
  cancelBackgroundWork();
  state.generativeTurnActive = false;
  const requestId = state.phraseRequestId + 1;
  state.phraseRequestId = requestId;
  hideSceneAsset({ cancel: true });
  setBusy(true);
  setStatus("Restoring the previous sentence.", { tone: "active" });
  try {
    state.historyCursor = previousIndex;
    state.currentWord = previous.word;
    state.currentSentence = previous.sentence;
    state.currentTranslation = previous.en || "";
    state.currentSceneQuery = previous.sceneQuery || previous.en || "";
    state.currentEntryId = previous.id || "";
    state.currentCorpusVersion = previous.corpusVersion || "";
    state.currentDifficulty = previous.difficulty || null;
    state.currentStandardRecord = previous.contentMode === "standard"
      ? state.standardProvider?.records?.find((record) => record.id === previous.id) || null
      : null;
    state.currentContentMode = previous.contentMode || "generative";
    state.currentGenerationSource = previous.source || "history";
    if (previous.contentMode !== "standard") {
      state.branchQueue.markUsed(previous.sentence);
      savePreparedQueue();
    }
    selectWord(previous.word, { lookup: state.translationMode !== "off", render: false });
    setTranslation(previous.en || "");
    renderCzechSentence(previous.sentence, previous.word);
    resetSentenceFeedback();
    setProgress(null);
    const sceneText = previous.sceneQuery || previous.en || localTranslation(previous.sentence, previous.word);
    await Promise.all([holdSentenceTransition(transitionStartedAt), updateSceneAsset(sceneText)]);
    if (requestId !== state.phraseRequestId) return;

    if (previous.contentMode === "standard") {
      setStatus("Previous Standard sentence restored.", { tone: "muted" });
    } else {
      if (state.translationMode !== "off" && !state.selectedWordMeaning && !state.wordMeaningLoading) {
        void lookupSelectedWord(previous.word);
      }
      setStatus(previous.en
        ? "Previous sentence restored."
        : "Previous sentence restored. English was not saved for this older phrase.", { tone: "muted" });
    }
  } finally {
    if (requestId === state.phraseRequestId) setBusy(false);
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
    excludeFingerprints: queueAvoidFingerprints(),
    preferTranslated: state.translationMode !== "off"
  });
  cancelBackgroundWork({ preserveSpeculative: Boolean(queued?.translation) });
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
    await presentPreparedCandidate(target, queued, transitionStartedAt);
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
    await presentPreparedCandidate(target, candidate, transitionStartedAt);
  } catch (error) {
    if (!state.busy) setBusy(true);
    await presentPreparedCandidate(target, {
      sentence: localSentence(target, generationAvoidList()),
      source: "error-fallback"
    }, transitionStartedAt);
    setStatus(error?.message || "Could not generate with the model.", { tone: "error" });
  }
}

async function showPreparedPhrase(target, candidate) {
  const sentence = candidate?.sentence || localSentence(target, generationAvoidList());
  state.currentWord = target;
  selectWord(target, { lookup: false, render: false });
  state.currentSentence = sentence;
  state.currentTranslation = String(candidate?.translation || "");
  state.currentSceneQuery = String(candidate?.translation || "");
  state.currentEntryId = "";
  state.currentCorpusVersion = "";
  state.currentDifficulty = learningDifficulty();
  state.currentStandardRecord = null;
  state.currentContentMode = "generative";
  state.currentGenerationSource = candidate?.source || "unknown";
  hideSceneAsset({ cancel: true });
  setTranslation("");
  renderCzechSentence(sentence, target);
  rememberPreparedCandidate(target, candidate, { used: true });
  rememberStep(target, sentence, {
    en: candidate?.translation || "",
    contentMode: "generative",
    source: candidate?.source || "unknown",
    difficulty: learningDifficulty(),
    sceneQuery: candidate?.translation || ""
  });
  rememberSeenSentence(sentence);
  resetSentenceFeedback();
  setProgress(null);

  let sceneText = "";
  if (state.translationMode === "off") {
    sceneText = localTranslation(sentence, target);
    setStatus(playInstruction, { tone: "muted" });
    schedulePrefetch(sentence);
  } else if (candidate?.translation) {
    cacheTranslation(sentence, candidate.translation);
    setTranslation(candidate.translation);
    sceneText = candidate.translation;
    setStatus(playInstruction, { tone: "muted" });
    if (!state.selectedWordMeaning && !state.wordMeaningLoading) void lookupSelectedWord(target);
    schedulePrefetch(sentence);
  } else {
    const fallbackEnglish = localTranslation(sentence, target);
    setTranslation(fallbackEnglish);
    sceneText = fallbackEnglish;
    setStatus(playInstruction, { tone: "muted" });
    if (!state.selectedWordMeaning && !state.wordMeaningLoading) void lookupSelectedWord(target);
    schedulePrefetch(sentence);
  }
  await updateSceneAsset(sceneText);
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
    entryId: state.currentEntryId,
    targetWord: state.currentWord,
    sentence: state.currentSentence,
    translation: state.currentTranslation,
    contentMode: state.currentContentMode || state.contentMode,
    corpusVersion: state.currentCorpusVersion,
    difficulty: state.currentDifficulty,
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
    ...(snapshot.contentMode === "generative" ? {
      sentenceModelKey: WORD_NET_MODEL_KEY,
      translationModelKey: TRANSLATION_MODEL_KEY
    } : {})
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
    const preparedRecord = typeof providerContext?.sessionRecord === "function"
      ? providerContext.sessionRecord(snapshot.entryId)
      : null;
    const queued = providerContext?.providerKind === "authored-realizations"
        && preparedRecord
        && typeof providerContext.report === "function"
      ? await providerContext.report({
          courseId: course.id,
          record: preparedRecord,
          reason,
          comment
        })
      : await runtimeAdapter()?.maintenance?.enqueueReport?.(payload, {
          id: clientReportId,
          dedupeKey
        });
    if (!queued?.queued && queued?.ok !== true) throw new Error("Feedback queue is unavailable.");
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
          ? "Kept for this session, but device storage is unavailable."
          : "Saved on this device. Sending remains off until a reviewed feedback channel is enabled.";
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
  window.CaatuuLearning?.registerProgressResetPreparation?.(prepareGuidedWordProgressReset);
  window.addEventListener("caatuu:progress-reset-cancelled", () => {
    if (state.guidedResetPending && state.guidedRequested) {
      void restartGuidedWordWorldAfterReset({ resetCompleted: false });
    }
  });
  $("#wordNetDisplayToggle")?.addEventListener("click", toggleDisplayMenu);
  $("#wordNetDisplayMenu")?.addEventListener("click", (event) => {
    if (!event.target.closest("[data-theme-option], [data-font-size-option]")) return;
    window.requestAnimationFrame(syncDisplaySettingsControl);
  });
  $("#wordNetDisplayMenu")?.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    closeDisplayMenu({ restoreFocus: true });
  });
  $("#wordNetContentSource")?.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-content-mode]");
    if (!button || button.disabled) return;
    closeGenerationMenu();
    await requestContentMode(button.dataset.contentMode);
  });
  $("#wordNetTranslationToggle")?.addEventListener("click", () => {
    if (guidedWordInteractionLocked()) return;
    closeDisplayMenu();
    closeAudioMenu();
    closeGenerationMenu();
    toggleTranslationMenu();
  });
  $("#wordNetTranslationToggle")?.addEventListener("keydown", handleTranslationToggleKeydown);
  $("#wordNetTranslationMenu")?.addEventListener("click", (event) => {
    if (guidedWordInteractionLocked()) return;
    const answerMode = event.target.closest("button[data-answer-mode]");
    if (answerMode?.dataset.answerMode === "reconstruct") {
      setTranslationMode("reconstruct");
      return;
    }
    if (answerMode?.dataset.answerMode === "wait") {
      const delay = isTimedTranslationMode(state.translationMode) ? state.translationMode : "timer-5";
      setTranslationMode(delay, { closeMenu: false });
      const selectedDelay = $("#wordNetTranslationTimers")?.querySelector(`[data-translation-delay="${delay}"]`);
      window.requestAnimationFrame(() => selectedDelay?.focus({ preventScroll: true }));
      return;
    }
    const delayOption = event.target.closest("button[data-translation-delay]");
    if (delayOption) {
      setTranslationMode(delayOption.dataset.translationDelay);
      return;
    }
    const wordCardOption = event.target.closest("button[data-word-card-setting]");
    if (wordCardOption) {
      toggleWordCardPreference(wordCardOption.dataset.wordCardSetting);
      return;
    }
  });
  $("#wordNetTranslationMenu")?.addEventListener("keydown", handleTranslationMenuKeydown);
  $("#wordNetGenerationToggle")?.addEventListener("click", () => {
    closeDisplayMenu();
    closeAudioMenu();
    closeTranslationMenu();
    toggleGenerationMenu();
  });
  $("#wordNetGenerationMenu")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-generation-mode]");
    if (!button || button.disabled) return;
    if (shouldBlockReconstructionAdvance()) return;
    const mode = button.dataset.generationMode;
    setGenerationMode(mode);
    generateFromConfiguredMode(mode);
  });
  $("#wordNetPrevious")?.addEventListener("click", showPreviousSentence);
  $("#wordNetNext")?.addEventListener("click", activateNextSentence);
  $("#wordNetSound")?.addEventListener("click", toggleAudioMenu);
  $("#wordNetSound")?.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowDown") return;
    event.preventDefault();
    openAudioMenu();
    window.requestAnimationFrame(() => $("#wordNetAudioAutoplay")?.focus({ preventScroll: true }));
  });
  $("#wordNetAudioVoice")?.addEventListener("change", async (event) => {
    window.CaatuuChrome?.setSpeechVoicePreference?.(event.currentTarget.value);
    if (androidSpeechRuntime()) await refreshAndroidSpeechStatus({ force: true });
    previewCurrentCzechSentenceFromAudioMenu();
  });
  $("#wordNetAudioInstallVoice")?.addEventListener("click", installCzechVoiceFromAudioMenu);
  $("#wordNetAudioSpeed")?.addEventListener("input", (event) => {
    const option = audioSpeedOptions[Number(event.currentTarget.value)] || audioSpeedOptions[0];
    state.speechPacePreference = option.key;
    window.CaatuuChrome?.setSpeechPacePreference?.(option.key);
    syncAudioSettingsControl();
  });
  $("#wordNetAudioSpeed")?.addEventListener("change", previewCurrentCzechSentenceFromAudioMenu);
  $("#wordNetAudioMenu")?.addEventListener("click", async (event) => {
    if (event.target.closest("#wordNetAudioAutoplay")) {
      state.audioAutoplay = !state.audioAutoplay;
      saveAudioAutoplay();
      syncAudioSettingsControl();
      if (state.audioAutoplay) maybeAutoplayCurrentSentence({ force: true });
    }
  });
  $("#wordNetAudioMenu")?.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    closeAudioMenu({ restoreFocus: true });
  });
  $("#wordNetPhraseSound")?.addEventListener("click", speakCurrentCzechSentence);
  $("#wordNetSelectedWordSound")?.addEventListener("click", speakSelectedCzechWord);
  $("#wordNetReconstruction")?.addEventListener("click", (event) => {
    const option = event.target.closest("[data-reconstruction-option-id]");
    if (option) {
      if (option.dataset.reconstructionLocation === "answer") {
        removeReconstructionOption(option.dataset.reconstructionOptionId);
      } else {
        selectReconstructionOption(option.dataset.reconstructionOptionId);
      }
      return;
    }
  });
  $("#wordNetReconstructionSubmit")?.addEventListener("click", submitReconstructionChallenge);
  document.addEventListener("click", (event) => {
    if (event.target.closest(".word-net-panel-actions")) return;
    closeDisplayMenu();
    closeAudioMenu();
    closeTranslationMenu();
    closeGenerationMenu();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeDisplayMenu();
      closeAudioMenu();
      closeTranslationMenu();
      closeGenerationMenu();
    }
  });
  $("#wordNetSentence")?.addEventListener("click", (event) => {
    const button = event.target.closest(".cz-word-token");
    if (!button || state.busy || guidedWordInteractionLocked()) return;
    if (state.guidedMode) {
      if (!markGuidedDictionaryHint()) return;
      state.wordCardPreferences.showCard = true;
    }
    selectWord(button.dataset.word, { userInitiated: true });
    setStatus(state.guidedMode
      ? `Dictionary support opened for "${button.dataset.word}".`
      : `Selected "${button.dataset.word}". Choose ↻ in Generation to continue with it.`, { tone: "muted" });
  });
  const sentencePanel = $(".word-net-sentence-panel");
  sentencePanel?.addEventListener("pointerdown", (event) => {
    if (
      state.busy
      || event.button > 0
      || event.isPrimary === false
      || (event.pointerType && event.pointerType !== "touch")
      || isReservedEdgeGesture(event.clientX, window.innerWidth)
      || event.target.closest("button, a, input, select, textarea, dialog")
    ) return;
    state.swipeStart = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      time: event.timeStamp
    };
  });
  window.addEventListener("pointermove", (event) => {
    const start = state.swipeStart;
    if (!start || start.pointerId !== event.pointerId) return;
    const deltaX = Math.abs(event.clientX - start.x);
    const deltaY = Math.abs(event.clientY - start.y);
    if (deltaY > 18 && deltaY > deltaX * 1.15) state.swipeStart = null;
  }, { passive: true });
  window.addEventListener("pointerup", (event) => {
    const start = state.swipeStart;
    state.swipeStart = null;
    if (!start || start.pointerId !== event.pointerId || state.busy) return;
    const action = interpretHorizontalSwipe(start, {
      x: event.clientX,
      y: event.clientY,
      time: event.timeStamp
    }, {
      minDistance: Math.max(48, Math.min(72, window.innerWidth * 0.12)),
      maxVerticalRatio: 0.72,
      maxDurationMs: 1200
    });
    if (action === "random") {
      activateNextSentence();
    } else if (action === "previous") {
      showPreviousSentence();
    }
  });
  window.addEventListener("pointercancel", () => {
    state.swipeStart = null;
  });
  $("#wordNetReportToggle")?.addEventListener("click", openSentenceFeedback);
  $("#wordNetFeedbackCancel")?.addEventListener("click", closeSentenceFeedback);
  $("#wordNetFeedbackForm")?.addEventListener("submit", submitSentenceFeedback);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      clearTranslationTimer();
      cancelCzechSpeech();
      cancelBackgroundWork();
      abortWordLookup();
    } else {
      if (androidSpeechRuntime() && !state.nativeSpeechAvailable) void refreshAndroidSpeechStatus();
      if (isTimedTranslationMode(state.translationMode) && state.currentTranslation && !state.translationVisible) {
        applyTranslationMode({ restartTimer: true });
      }
      if (!state.busy && state.currentSentence) {
        if (state.translationMode !== "off" && !state.currentTranslation) void enrichCurrentPhrase();
        else schedulePrefetch(state.currentSentence, 180);
      }
    }
  });
  window.addEventListener("pagehide", () => cancelCzechSpeech());
  window.addEventListener("caatuu:learning-change", (event) => {
    if (event.detail?.reason === "progress-reset" && state.guidedRequested) {
      void restartGuidedWordWorldAfterReset();
      return;
    }
    if (event.detail?.reason !== "difficulty") return;
    const pace = czechSpeechPace();
    cancelCzechSpeech();
    syncDiagnostics();
    setStatus(
      pace.source === "override"
        ? `${pace.badge} equipped. ${targetLanguageLabel} audio remains at manual ${pace.label} speed.`
        : `${pace.badge} equipped. ${targetLanguageLabel} audio now uses ${pace.label} speed. The next Standard sentence will follow this level.`,
      { tone: "active" }
    );
  });
}

async function init() {
  bindUi();
  syncDisplaySettingsControl();
  initializeSpeechControl();
  runtimeAdapter()?.registerServiceWorker?.().catch(() => {});
  await initializeGuidedWordWorldMode();
  const diagnostics = $("#wordNetDiagnostics");
  if (diagnostics) diagnostics.open = false;
  applyTranslationMode();
  renderCzechSentence("");
  syncGenerationControl();
  syncContentControl();
  syncWordTranslation();
  syncDiagnostics();
  renderWordGuidedStatus();
  setStatus(playInstruction);
  if (!state.guidedRequested) hydrateQueueFromHistory();
  if (state.guidedRequested) {
    setBusy(true);
    if (!state.guidedMode) {
      setStatus("Guided Word World is locked because its curriculum contract could not be verified.", { tone: "error" });
      renderWordGuidedStatus();
      setBusy(false);
      return;
    }
    setStatus("Preparing the exact Guided developer task.", { tone: "active" });
    try {
      await initializeStandardCorpus();
      await generateGuidedStandardPhrase({ allowBusy: true });
    } finally {
      if (state.busy) setBusy(false);
    }
    return;
  }
  if (state.contentMode === "standard") {
    abortOptionalGenerationDownloads();
    setBusy(true);
    setStatus("Preparing the guided sentence pack.", { tone: "active" });
    try {
      await initializeStandardCorpus();
      await generateStandardFromConfiguredMode("random", { allowBusy: true });
    } finally {
      if (state.busy) setBusy(false);
    }
  } else {
    state.generativeTurnActive = false;
    if (!(await restoreSavedGenerativePhraseAtInit())) {
      setStatus("Generative mode is ready. Press Next to create a sentence.", { tone: "muted" });
    }
  }
}

function notifyHost(type, detail = {}) {
  const payload = {
    source: "caatuu-word-world",
    type,
    ...detail
  };
  lifecycleOptions.onEvent?.(payload);
  if (type === "ready") lifecycleOptions.onReady?.(payload);
  if (type === "error") {
    lifecycleOptions.onError?.(detail.error || new Error(detail.message || "Word World error"));
  }
  const CustomEventConstructor = window.CustomEvent || globalThis.CustomEvent;
  if (typeof CustomEventConstructor === "function") {
    mountRoot?.dispatchEvent?.(new CustomEventConstructor(`caatuu:word-world-${type}`, {
      bubbles: true,
      detail: payload
    }));
  }
}

function announceCampaignRoundSuccess() {
  const payload = {
    source: "caatuu-game",
    type: "round-success",
    gameId: "word-net",
    courseId: course.id
  };
  lifecycleOptions.onRoundSuccess?.(payload);
  window.postMessage?.(payload, window.location.origin);
}

function suspendStarterWordPresentation() {
  clearTranslationTimer();
  cancelBackgroundWork();
  abortWordLookup();
  state.swipeStart = null;
}

function targetLanguageCopy(value) {
  const text = String(value ?? "");
  return text.replaceAll("Czech", targetLanguageLabel);
}

function applyTargetLanguageLabels(root) {
  const nodes = [root, ...root.querySelectorAll("*")];
  for (const node of nodes) {
    for (const attribute of ["aria-label", "aria-description", "title"]) {
      const value = node.getAttribute?.(attribute);
      if (value?.includes("Czech")) node.setAttribute(attribute, targetLanguageCopy(value));
    }
    for (const child of node.childNodes || []) {
      if (child.nodeType === 3 && child.nodeValue?.includes("Czech")) {
        child.nodeValue = targetLanguageCopy(child.nodeValue);
      }
    }
  }
}

function applyTargetContentLanguage(root) {
  const target = providerContext.session.course?.targetLanguage || {};
  const lang = String(target.locale || target.id || "").trim();
  const requestedDirection = String(target.direction || providerContext.adapter?.direction || "ltr").trim();
  const direction = requestedDirection === "rtl" ? "rtl" : "ltr";
  for (const selector of ["#wordNetSentence", "#wordNetSelectedWord", "#wordNetTrail"]) {
    const node = root.querySelector(selector);
    if (!node) continue;
    if (lang) node.setAttribute("lang", lang);
    node.setAttribute("dir", direction);
  }
}

function applyWordWorldCapabilities(root) {
  const capabilities = providerContext.session.course?.capabilities || {};
  const generationSupported = capabilities.llm === true && capabilities.generation === true;
  for (const node of root.querySelectorAll('[data-content-mode="generative"]')) {
    node.hidden = !generationSupported;
    node.disabled = !generationSupported;
    node.setAttribute("aria-hidden", String(!generationSupported));
  }
  const generativeDialog = root.querySelector("#wordNetGenerativeDialog");
  if (generativeDialog) generativeDialog.hidden = !generationSupported;
  const speechAvailable = capabilities.speech === true;
  for (const id of ["#wordNetSound", "#wordNetPhraseSound", "#wordNetSelectedWordSound"]) {
    const node = root.querySelector(id);
    if (node) node.hidden = !speechAvailable;
  }
}

function requirePreparedContext(value) {
  if (!value || typeof value !== "object" || !value.session || !value.selectionProvider) {
    throw new TypeError("mountProductWordWorld requires a prepared Word World provider context.");
  }
  if (typeof value.sessionRecord !== "function" || typeof value.segment !== "function"
      || typeof value.lookupMeaning !== "function") {
    throw new TypeError("The prepared Word World context is missing its language seams.");
  }
  if (value.session.course?.id !== course.id) {
    throw new Error("The prepared Word World context does not match the active course.");
  }
  return value;
}

/**
 * Mounts the Czech-authoritative Word World controller over the pre-existing
 * shared component tree. Language packs may supply data and narrow linguistic
 * seams through the prepared context; they never supply markup or a renderer.
 */
export async function mountProductWordWorld(root, preparedContext, options = {}) {
  if (!root || typeof root.querySelector !== "function") {
    throw new TypeError("Word World root must be an existing DOM element.");
  }
  if (mounted) throw new Error("Word World is already mounted.");
  const context = requirePreparedContext(options.providerContext || preparedContext);
  for (const id of ["#wordNetSentence", "#wordNetNext", "#wordNetPrevious", "#wordNetStatus"]) {
    if (!root.querySelector(id)) throw new Error(`Word World authority markup is missing ${id}.`);
  }

  mountRoot = root;
  providerContext = context;
  lifecycleOptions = Object.freeze({ ...options });
  mounted = true;
  state.contentMode = loadContentMode();
  if (!hasContentMode(state.contentMode)) state.contentMode = "standard";
  state.generationMode = loadGenerationMode();
  applyTargetLanguageLabels(root);
  applyTargetContentLanguage(root);
  applyWordWorldCapabilities(root);

  try {
    await init();
    notifyHost("ready", { courseId: course.id });
  } catch (error) {
    console.error("Word World could not initialize", error);
    notifyHost("error", {
      courseId: course.id,
      message: String(error?.message || error),
      error
    });
    throw error;
  }

  return Object.freeze({
    next: () => activateNextSentence(),
    pause() {
      cancelCzechSpeech();
      suspendStarterWordPresentation();
    },
    resume() {
      syncDisplaySettingsControl();
      syncSpeechControl();
      if (!state.busy && state.currentSentence) {
        if (state.translationMode !== "off" && !state.currentTranslation) void enrichCurrentPhrase();
        else schedulePrefetch(state.currentSentence, 180);
      }
    }
  });
}

export default mountProductWordWorld;
