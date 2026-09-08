import {
  alignWordReconstructionAttempt,
  buildTokenReconstructionChallenge,
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
  selectDictionaryMeaning,
  selectSpeechSynthesisVoice,
  sentenceFingerprint,
  sentenceIncludesWord,
  sentenceTargets,
  resolveSpeechPace,
  stripModelEcho,
  tokenizeCzechSentence as tokenizeLegacySentence
} from "./word-net-core.mjs?v=word-net-core-21";
import { WordNetBranchQueue } from "./word-net-queue.mjs?v=word-net-queue-6";
import { localAiAvailability } from "./shell-policy.mjs";
import { mountRobotLoadingScreen } from "./games/embedded-game-controls.mjs?v=embedded-game-controls-8";
import { createEnglishImageSearch } from "./english-image-search.mjs?v=english-image-search-3";

let WORD_NET_MODEL_KEY = "";
let TRANSLATION_MODEL_KEY = "";
const SCENE_ASSET_LIMIT = 5;
const SCENE_ASSET_READY_TIMEOUT_MS = 8000;
const SCENE_CANDIDATE_SEARCH_TIMEOUT_MS = 3600;
const SCENE_CANDIDATE_LOAD_TIMEOUT_MS = 1200;
const searchSceneImages = createEnglishImageSearch({ timeoutMs: SCENE_CANDIDATE_SEARCH_TIMEOUT_MS - 100 });
const course = window.CaatuuCourse;
if (!course) throw new Error("Caatuu course profile must load before Word World.");

function interfaceText(messageId, parameters = {}) {
  const api = globalThis.CaatuuI18n;
  if (!api || typeof api.t !== "function") {
    throw new Error("Word World requires installed interface content.");
  }
  const value = api.t(messageId, parameters);
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`Word World interface message ${messageId} must resolve to non-empty text.`);
  }
  return value;
}

function interfaceLanguageName(language, fallbackMessageId = "") {
  const name = globalThis.CaatuuI18n?.languageName?.(language);
  if (typeof name === "string" && name.trim()) return name.trim();
  if (fallbackMessageId) return interfaceText(fallbackMessageId);
  throw new Error("Word World interface content must resolve every visible language name.");
}

const targetLocale = course.targetLanguage.locale;
const sourceLocale = course.sourceLanguage?.locale || course.sourceLanguage?.id || "und";
let sourcePrimaryLanguage = "";
try {
  sourcePrimaryLanguage = new Intl.Locale(sourceLocale).language;
} catch {
  sourcePrimaryLanguage = "";
}
const targetSpeechLocale = course.targetLanguage.speechLocale || targetLocale;
const targetLanguageLabel = interfaceLanguageName(course.targetLanguage);
const sourceLanguageLabel = interfaceLanguageName(course.sourceLanguage);
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
const TARGET_TEXT_PREFERENCES_STORAGE_KEY = `${course.storage.namespace}.wordNet.targetTextPreferences.v1`;
const CHALLENGE_PROMPT_MODE_STORAGE_KEY = `${course.storage.namespace}.wordNet.challengePromptMode.v1`;
const AUDIO_AUTOPLAY_STORAGE_KEY = `${course.storage.namespace}.wordNet.speechAutoplay.v2`;
const DICTIONARY_GAP_REPORTING_KEYS = Object.freeze([
  "dictionaryDirection",
  "dictionaryKey",
  "providerId"
]);

export function resolveDictionaryGapReportingContract(courseProfile = {}) {
  if (courseProfile.capabilities?.dictionary !== true) return null;
  const dictionaryContent = courseProfile.dictionaryContent;
  const reporting = dictionaryContent?.gapReporting;
  if (!reporting || typeof reporting !== "object" || Array.isArray(reporting)) return null;
  if (JSON.stringify(Object.keys(reporting).sort()) !== JSON.stringify([...DICTIONARY_GAP_REPORTING_KEYS].sort())) {
    return null;
  }
  const providerId = String(reporting.providerId || "").trim();
  const dictionaryKey = String(reporting.dictionaryKey || "").trim();
  const dictionaryDirection = String(reporting.dictionaryDirection || "").trim();
  if (
    providerId !== String(dictionaryContent.providerId || "").trim()
    || !/^[a-z0-9]+(?:-[a-z0-9]+)*-v[1-9][0-9]*$/u.test(providerId)
    || !/^[a-z0-9]+(?:-[a-z0-9]+)+$/u.test(dictionaryKey)
    || !/^[a-z]{2,3}(?:-[a-z0-9]+)*-[a-z]{2,3}(?:-[a-z0-9]+)*$/u.test(dictionaryDirection)
  ) return null;
  return Object.freeze({ providerId, dictionaryKey, dictionaryDirection });
}

export function buildDictionaryGapFeedback(courseProfile, {
  targetWord,
  normalizedWord,
  lookupReturned = 0
} = {}) {
  const reporting = resolveDictionaryGapReportingContract(courseProfile);
  const word = String(targetWord || "").normalize("NFC").trim();
  const normalized = String(normalizedWord || "").normalize("NFC").trim();
  if (!reporting || !word || !normalized) return null;
  const returned = Math.max(0, Math.floor(Number(lookupReturned) || 0));
  return Object.freeze({
    targetWord: word,
    normalizedWord: normalized,
    dictionaryKey: reporting.dictionaryKey,
    dictionaryDirection: reporting.dictionaryDirection,
    lookupOutcome: returned > 0 ? "no_exact_usable_entry" : "no_results",
    lookupReturned: returned
  });
}

const dictionaryGapReporting = resolveDictionaryGapReportingContract(course);
const DICTIONARY_GAP_STORAGE_KEY = dictionaryGapReporting
  ? `${course.storage.namespace}.dictionary.missing.${dictionaryGapReporting.dictionaryKey}.v1`
  : "";
const DICTIONARY_GAP_NOTICE_ID = "wordworld.dictionary.missingqueued";
const DICTIONARY_GAP_LIMIT = 80;
const RECONSTRUCTION_DISTRACTOR_COUNT = 4;
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
const PREFETCH_STOPWORDS = new Set([
  "a", "ale", "do", "i", "je", "jsou", "k", "na", "ne", "o", "od", "po", "pro", "se", "si", "s", "u", "v", "ve", "z", "za", "že"
]);
const translationModes = {
  off: { labelId: "wordworld.mode.answer.off", delayMs: null },
  "timer-0": { labelId: "wordworld.mode.answer.delayzero", delayMs: 0 },
  "timer-5": { labelId: "wordworld.mode.answer.delayfive", delayMs: 5000 },
  "timer-10": { labelId: "wordworld.mode.answer.delayten", delayMs: 10000 },
  "timer-30": { labelId: "wordworld.mode.answer.delaythirty", delayMs: 30000 },
  visible: { labelId: "wordworld.mode.answer.visible", delayMs: 0 },
  reconstruct: { labelId: "wordworld.mode.answer.rebuild", delayMs: null }
};
const generationModes = {
  random: { labelId: "wordworld.mode.generation.newword" },
  selected: { labelId: "wordworld.mode.generation.selectedword" }
};
const challengePromptModes = Object.freeze({
  random: Object.freeze({ labelId: "wordworld.mode.prompt.random" }),
  source: Object.freeze({ labelId: "wordworld.mode.prompt.base" }),
  target: Object.freeze({ labelId: "wordworld.mode.prompt.target" })
});
const contentModes = {
  standard: {
    labelId: "wordworld.mode.content.standard",
    summaryId: "wordworld.mode.content.standardsummary"
  },
  generative: {
    labelId: "wordworld.mode.content.generative",
    summaryId: "wordworld.mode.content.generativesummary"
  }
};
const audioSpeedOptions = Object.freeze([
  Object.freeze({ key: "slower", labelId: "speech.speed.slower", rate: 0.5, rateLabel: "0.5×" }),
  Object.freeze({ key: "slow", labelId: "speech.speed.slow", rate: 0.6, rateLabel: "0.6×" }),
  Object.freeze({ key: "normal", labelId: "speech.speed.normal", rate: 1, rateLabel: "1×" })
]);

function translationModeLabel(mode) {
  return interfaceText(translationModes[mode]?.labelId || translationModes.reconstruct.labelId);
}

function generationModeLabel(mode) {
  return interfaceText(generationModes[mode]?.labelId || generationModes.random.labelId);
}

function challengePromptModeLabel(mode) {
  return interfaceText(challengePromptModes[mode]?.labelId || challengePromptModes.random.labelId);
}

function contentModeLabel(mode) {
  return interfaceText(contentModes[mode]?.labelId || contentModes.standard.labelId);
}

function generationAvailabilityMessage(availability) {
  if (availability?.reason === "course-unsupported") {
    return interfaceText("wordworld.generative.unavailable.course");
  }
  if (availability?.reason === "runtime-disabled") {
    return interfaceText("wordworld.generative.unavailable.runtime");
  }
  return "";
}

function speechPaceLabel(value) {
  const key = normalizeWordWorldSpeechPaceKey(value?.key || value?.label || value) || "normal";
  return interfaceText(audioSpeedOptions.find((option) => option.key === key)?.labelId || "speech.speed.normal");
}

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

function playInstruction() {
  return interfaceText("wordworld.instructions.play");
}
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

export function wordWorldWordsMatch(candidate, target, {
  searchKey
} = {}) {
  if (typeof searchKey === "function") {
    const candidateKey = searchKey(candidate, { purpose: "word-world-token-match" });
    const targetKey = searchKey(target, { purpose: "word-world-token-match" });
    return Boolean(candidateKey && targetKey && candidateKey === targetKey);
  }
  return false;
}

function wordMatchesTarget(candidate, target) {
  return wordWorldWordsMatch(candidate, target, {
    searchKey: providerContext?.normalization?.searchKey
  });
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
  selectedWordMeaningKey: "",
  selectedTokenIndex: null,
  dictionaryGapKeys: loadDictionaryGapKeys(),
  wordLookupController: null,
  wordLookupRequestId: 0,
  wordCardPreferences: loadWordCardPreferences(),
  targetTextPreferences: loadTargetTextPreferences(),
  audioAutoplay: loadAudioAutoplay(),
  lastAutoplayFingerprint: "",
  currentSentence: "",
  currentTranslation: "",
  currentSceneQuery: "",
  currentSceneAsset: null,
  imagesEnabled: true,
  currentEntryId: "",
  currentCorpusVersion: "",
  currentDifficulty: null,
  currentStandardRecord: null,
  currentContentMode: "",
  generativeTurnActive: false,
  translationMode: loadTranslationMode(),
  generationMode: loadGenerationMode(),
  challengePromptMode: loadChallengePromptMode(),
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
  loadingScreen: null,
  loadingActive: true,
  loadingPageHidden: false,
  loadingActivityWaiters: new Set(),
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

function failGuidedWordWorld(
  error,
  messageId = "wordworld.guided.locked",
  parameters = {}
) {
  const lifecycle = state.guidedLifecycle;
  if (lifecycle?.abort) {
    void lifecycle.abort().catch((abortError) => {
      console.error("Guided Word World lifecycle could not be released", abortError);
    });
  }
  if (state.guidedLifecycle === lifecycle) state.guidedLifecycle = null;
  state.guidedStatus = "failed";
  state.guidedError = error?.message || String(error || messageId);
  state.guidedEvidencePending = false;
  setStatus(interfaceText(messageId, parameters), { tone: "error" });
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
    detail.textContent = interfaceText("wordworld.guided.detail.locked");
  } else if (state.guidedStatus === "complete") {
    detail.textContent = supportedBeforeResponse
      ? interfaceText("wordworld.guided.detail.completesupported")
      : reviewedAfterResponse
        ? interfaceText("wordworld.guided.detail.completereviewed")
      : interfaceText("wordworld.guided.detail.completelocked");
  } else if (supportedBeforeResponse) {
    detail.textContent = interfaceText("wordworld.guided.detail.supported");
  } else if (reviewedAfterResponse) {
    detail.textContent = interfaceText("wordworld.guided.detail.reviewed");
  } else if (lifecycle?.firstResponseRecorded) {
    detail.textContent = interfaceText("wordworld.guided.detail.recorded");
  } else if (state.guidedStatus === "ready") {
    detail.textContent = interfaceText("wordworld.guided.detail.ready");
  } else {
    detail.textContent = interfaceText("wordworld.guided.detail.verifying");
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
      ? interfaceText("wordworld.guided.reset.preparing")
      : interfaceText("wordworld.guided.reset.cancelled"),
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
    window.CaatuuLearning?.difficultyOption?.(difficulty)?.label
      || interfaceText("common.level.numbered", { level: difficulty })
  );
  return { ...pace, difficulty, badge };
}

function loadAudioAutoplay() {
  if (window.CaatuuChrome?.getSpeechAutoplay) return window.CaatuuChrome.getSpeechAutoplay();
  try {
    const stored = window.localStorage.getItem(AUDIO_AUTOPLAY_STORAGE_KEY);
    return stored === null ? true : stored === "true";
  } catch (error) {
    return true;
  }
}

function saveAudioAutoplay() {
  if (window.CaatuuChrome?.setSpeechAutoplay) {
    window.CaatuuChrome.setSpeechAutoplay(state.audioAutoplay);
    return;
  }
  try {
    window.localStorage.setItem(AUDIO_AUTOPLAY_STORAGE_KEY, String(state.audioAutoplay));
  } catch (error) {
    // The choice remains active for this session when storage is unavailable.
  }
}

function unavailableSpeechTitle() {
  if (!androidSpeechRuntime()) return interfaceText("speech.unavailable.browser");
  if (state.nativeSpeechReason === "missing-language-data") {
    return interfaceText("speech.unavailable.androidmissingdata", { language: targetLanguageLabel });
  }
  if (state.nativeSpeechReason === "no-language-voice") {
    return interfaceText("speech.unavailable.androidnovoice", { language: targetLanguageLabel });
  }
  return interfaceText("speech.unavailable.androidnotready");
}

function unavailableSpeechLabel() {
  if (state.nativeSpeechReason === "missing-language-data") {
    return interfaceText("speech.unavailable.labelmissingdata", { language: targetLanguageLabel });
  }
  if (state.nativeSpeechReason === "no-language-voice") {
    return interfaceText("speech.unavailable.labelnovoice", { language: targetLanguageLabel });
  }
  return interfaceText("speech.unavailable.labeldevice", { language: targetLanguageLabel });
}

function speechGloballyMuted() {
  return window.CaatuuChrome?.getSpeechMuted?.() === true;
}

function syncSpeechControl() {
  const sentenceButton = $("#wordNetPhraseSound");
  const wordButton = $("#wordNetSelectedWordSound");
  if (!sentenceButton && !wordButton) return;

  const speechPace = czechSpeechPace();
  const paceDescription = interfaceText("speech.speed.description", { speed: speechPaceLabel(speechPace) });
  const supported = speechControlSupported();
  const muted = speechGloballyMuted();
  const checking = Boolean(androidSpeechRuntime() && state.nativeSpeechStatusPending);
  const hasSentence = Boolean(String(state.currentSentence || "").trim());
  const speaking = !muted && state.speechState === "speaking" && Boolean(state.speechSession);
  const sentenceSpeaking = speaking && state.speechSource === "sentence";
  let sentenceLabel = interfaceText("speech.sentence.play", {
    language: targetLanguageLabel,
    speed: paceDescription
  });
  let sentenceTitle = sentenceLabel;

  if (muted) {
    sentenceLabel = sentenceTitle = interfaceText("speech.audio.mutednotice");
  } else if (checking) {
    sentenceLabel = interfaceText("speech.pronunciation.checking", { language: targetLanguageLabel });
    sentenceTitle = interfaceText("speech.pronunciation.checkingtitle", { language: targetLanguageLabel });
  } else if (!supported) {
    sentenceLabel = unavailableSpeechLabel();
    sentenceTitle = unavailableSpeechTitle();
  } else if (state.busy || !hasSentence) {
    sentenceLabel = interfaceText("speech.sentence.waitlabel", { language: targetLanguageLabel });
    sentenceTitle = interfaceText("speech.sentence.waittitle", { language: targetLanguageLabel });
  } else if (sentenceSpeaking) {
    sentenceLabel = interfaceText("speech.sentence.stop", { language: targetLanguageLabel });
    sentenceTitle = sentenceLabel;
  }

  if (sentenceButton) {
    sentenceButton.dataset.speechPace = speechPace.label;
    sentenceButton.dataset.speechPaceSource = speechPace.source;
    sentenceButton.dataset.speechDifficulty = String(speechPace.difficulty);
    sentenceButton.dataset.speechRate = String(speechPace.rate);
    sentenceButton.disabled = muted || checking || state.busy || !supported || !hasSentence;
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
    ? interfaceText("speech.word.play", { word: selectedWord, speed: paceDescription })
    : interfaceText("speech.word.playselected", {
        language: targetLanguageLabel,
        speed: paceDescription
      });
  let wordTitle = wordLabel;
  if (muted) {
    wordLabel = wordTitle = interfaceText("speech.audio.mutednotice");
  } else if (checking) {
    wordLabel = interfaceText("speech.pronunciation.checking", { language: targetLanguageLabel });
    wordTitle = interfaceText("speech.pronunciation.checkingtitle", { language: targetLanguageLabel });
  } else if (!supported) {
    wordLabel = unavailableSpeechLabel();
    wordTitle = unavailableSpeechTitle();
  } else if (state.busy || !wordAvailable) {
    wordLabel = interfaceText("speech.word.select", { language: targetLanguageLabel });
    wordTitle = wordLabel;
  } else if (wordSpeaking) {
    wordLabel = interfaceText("speech.word.stop", { word: selectedWord });
    wordTitle = wordLabel;
  }
  if (wordButton) {
    wordButton.dataset.speechPace = speechPace.label;
    wordButton.dataset.speechPaceSource = speechPace.source;
    wordButton.dataset.speechDifficulty = String(speechPace.difficulty);
    wordButton.dataset.speechRate = String(speechPace.rate);
    wordButton.disabled = muted || checking || state.busy || !supported || !wordAvailable;
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
  const paceDescription = interfaceText("speech.speed.description", { speed: speechPaceLabel(pace) });
  if (toggle) {
    toggle.dataset.speechPace = pace.label;
    toggle.dataset.speechPaceSource = pace.source;
    toggle.dataset.speechRate = String(pace.rate);
    toggle.setAttribute("aria-label", interfaceText("speech.settings.current", {
      language: targetLanguageLabel,
      speed: paceDescription
    }));
    toggle.title = interfaceText("speech.settings.title", {
      language: targetLanguageLabel,
      speed: paceDescription
    });
  }
  const paceIndex = Math.max(0, audioSpeedOptions.findIndex((option) => option.key === pace.key));
  const paceOption = audioSpeedOptions[paceIndex];
  if (speed) {
    speed.value = String(paceIndex);
    speed.setAttribute("aria-valuetext", interfaceText("speech.speed.value", {
      speed: interfaceText(paceOption.labelId),
      rate: paceOption.rateLabel
    }));
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
  if (status) status.textContent = interfaceText("speech.voices.checking", { language: targetLanguageLabel });
  try {
    const result = api.getSpeechVoiceControlState
      ? await api.getSpeechVoiceControlState()
      : await api.listSpeechVoiceOptions();
    const preferred = preferredSpeechVoice();
    const options = [new Option(interfaceText("speech.voices.automatic"), "")];
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
          ? interfaceText("speech.voices.ready", { language: targetLanguageLabel })
          : interfaceText("speech.voices.unavailable", { language: targetLanguageLabel }));
    }
    if (installButton) {
      installButton.hidden = result?.backend !== "android" || result?.canInstallVoice !== true;
      installButton.disabled = false;
    }
  } catch (error) {
    select.disabled = true;
    if (status) status.textContent = interfaceText("speech.voices.checkfailed", { language: targetLanguageLabel });
    if (installButton) installButton.hidden = true;
  }
}

function targetSentenceSpeechAllowed() {
  return state.translationMode !== "reconstruct"
    || state.reconstruction?.promptSide === "target";
}

function previewCurrentCzechSentenceFromAudioMenu() {
  if (!targetSentenceSpeechAllowed()) {
    syncSpeechControl();
    return;
  }
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
  if (status) status.textContent = interfaceText("speech.install.opening");
  try {
    const result = await install();
    if (status) {
      status.textContent = result?.launched === false
        ? interfaceText("speech.install.openmanually", { language: targetLanguageLabel })
        : interfaceText("speech.install.finish", { language: targetLanguageLabel });
    }
  } catch (error) {
    if (status) status.textContent = interfaceText("speech.install.failed");
  } finally {
    button.disabled = false;
    void refreshAndroidSpeechStatus({ force: true });
  }
}

function syncDisplaySettingsControl() {
  const toggle = $("#wordNetDisplayToggle");
  const theme = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
  const fontSize = document.documentElement.dataset.fontSize || "largest";
  const themeLabel = interfaceText(theme === "dark" ? "common.theme.dark" : "common.theme.light");
  const fontSizeLabel = {
    largest: "wordworld.display.text.standard",
    large: "wordworld.display.text.small",
    standard: "wordworld.display.text.smaller"
  }[fontSize] || "wordworld.display.text.standard";
  if (toggle) {
    const label = interfaceText("wordworld.display.current", {
      theme: themeLabel,
      size: interfaceText(fontSizeLabel)
    });
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
  window.CaatuuChrome?.releaseToolbarPopover?.(menu);
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
  window.CaatuuChrome?.constrainToolbarPopover?.(menu);
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
  window.CaatuuChrome?.releaseToolbarPopover?.(menu);
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
  window.CaatuuChrome?.constrainToolbarPopover?.(menu);
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
    interfaceText("speech.pronunciation.failed", { language: targetLanguageLabel }),
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
  if (speechGloballyMuted()) {
    syncSpeechControl();
    return;
  }
  if (source === "sentence" && !targetSentenceSpeechAllowed()) {
    syncSpeechControl();
    return;
  }
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
    speechGloballyMuted()
    || !state.audioAutoplay
    || state.busy
    || !targetSentenceSpeechAllowed()
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
  window.addEventListener("caatuu:speech-autoplay-change", () => {
    state.audioAutoplay = loadAudioAutoplay();
    if (!state.audioAutoplay) cancelCzechSpeech();
    syncAudioSettingsControl();
  });
  window.addEventListener("caatuu:speech-mute-change", () => {
    if (speechGloballyMuted()) cancelCzechSpeech();
    syncSpeechControl();
  });
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
        ? interfaceText("speech.pace.manual", {
            language: targetLanguageLabel,
            speed: speechPaceLabel(pace)
          })
        : interfaceText("speech.pace.difficulty", {
            level: pace.badge,
            language: targetLanguageLabel,
            speed: speechPaceLabel(pace)
          }),
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

function readStoredArray(key, { session = false, gameState = false } = {}) {
  try {
    const value = gameState && !session && typeof window.CaatuuLearning?.readGameState === "function"
      ? window.CaatuuLearning.readGameState(key, { validate: Array.isArray })
      : JSON.parse((session ? window.sessionStorage : window.localStorage).getItem(key) || "[]");
    return Array.isArray(value) ? value : [];
  } catch (error) {
    return [];
  }
}

function readStoredObject(key, { gameState = false } = {}) {
  try {
    const value = gameState && typeof window.CaatuuLearning?.readGameState === "function"
      ? window.CaatuuLearning.readGameState(key, {
        validate: (entry) => Boolean(entry && typeof entry === "object" && !Array.isArray(entry))
      })
      : JSON.parse(window.localStorage.getItem(key) || "null");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch (error) {
    return {};
  }
}

function writeStoredGameState(key, value) {
  if (typeof window.CaatuuLearning?.writeGameState === "function") {
    return window.CaatuuLearning.writeGameState(key, value);
  }
  window.localStorage.setItem(key, JSON.stringify(value));
  return true;
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

function loadTargetTextPreferences(defaults = {}) {
  const stored = readStoredObject(TARGET_TEXT_PREFERENCES_STORAGE_KEY);
  return {
    showGuide: Object.hasOwn(stored, "showGuide")
      ? stored.showGuide !== false
      : defaults.showGuide !== false,
    colorTones: Object.hasOwn(stored, "colorTones")
      ? stored.colorTones !== false
      : defaults.colorTones !== false
  };
}

function saveTargetTextPreferences() {
  try {
    window.localStorage.setItem(
      TARGET_TEXT_PREFERENCES_STORAGE_KEY,
      JSON.stringify(state.targetTextPreferences)
    );
  } catch (error) {
    // Target-text preferences remain active for the current session.
  }
}

function loadDictionaryGapKeys() {
  if (!DICTIONARY_GAP_STORAGE_KEY) return [];
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
  if (!DICTIONARY_GAP_STORAGE_KEY) return false;
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
  if (!DICTIONARY_GAP_STORAGE_KEY) return false;
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
  const current = readStoredArray(HISTORY_STORAGE_KEY, { gameState: true });
  const legacy = current.length ? [] : readStoredArray(LEGACY_HISTORY_STORAGE_KEY, { gameState: true });
  return migrateWordWorldHistory(current.length ? current : legacy, { limit: HISTORY_LIMIT });
}

function saveHistory() {
  try {
    writeStoredGameState(HISTORY_STORAGE_KEY, state.history.slice(0, HISTORY_LIMIT));
  } catch (error) {
    // Phrase history remains available for the current session.
  }
}

function loadStandardUsage() {
  return readStoredObject(STANDARD_USAGE_STORAGE_KEY, { gameState: true });
}

function saveStandardUsage() {
  if (!state.standardProvider) return;
  try {
    writeStoredGameState(STANDARD_USAGE_STORAGE_KEY, state.standardProvider.usage.snapshot());
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
  return readStoredArray(RECENT_SENTENCES_STORAGE_KEY, { gameState: true })
    .map((value) => String(value || "").slice(0, 180))
    .filter(Boolean)
    .slice(0, RECENT_SENTENCE_LIMIT);
}

function saveRecentSentences() {
  try {
    writeStoredGameState(RECENT_SENTENCES_STORAGE_KEY, state.recentSentences);
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
      setStatus(interfaceText("wordworld.history.generativerestored"), { tone: "muted" });
    }
  } catch (error) {
    if (requestId === state.phraseRequestId) {
      setStatus(interfaceText("wordworld.history.restorefailed"), { tone: "error" });
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

function currentReconstructionInstruction(round = state.reconstruction) {
  const answerSide = round?.answerSide;
  const answerLabel = answerSide === "target"
    ? targetLanguageLabel
    : answerSide === "source"
      ? sourceLanguageLabel
      : "other-language";
  return interfaceText("wordworld.instructions.rebuild", { language: answerLabel });
}

function currentPlayInstruction() {
  return state.translationMode === "reconstruct" ? currentReconstructionInstruction() : playInstruction();
}

function syncPlayInstruction() {
  const instruction = $("#wordNetInstructions");
  if (instruction) instruction.textContent = currentPlayInstruction();
}

function setStatus(message, { tone = "muted" } = {}) {
  const status = $("#wordNetStatus");
  const panel = $(".word-net-status-panel");
  const isRestingInstruction = message === playInstruction() || message === currentReconstructionInstruction();
  syncPlayInstruction();
  if (status) {
    status.textContent = isRestingInstruction ? "" : targetLanguageCopy(message);
    status.hidden = isRestingInstruction || !message;
  }
  if (panel) panel.dataset.tone = isRestingInstruction ? "muted" : tone;
  syncDiagnostics();
}

function diagnosticsPhase() {
  if (state.standardCorpusLoading) return "loading-corpus";
  if (state.busy) return "generating";
  if (state.backgroundActivity === "translation") return "translating";
  if (state.backgroundActivity === "translation-batch") return "translating-queue";
  if (state.backgroundActivity === "prefetch") return "prefetching";
  if (state.prefetchTimerId) return "prefetch-queued";
  return state.currentSentence ? "ready" : "starting";
}

function diagnosticsPhaseLabel(phase) {
  return interfaceText(`wordworld.diagnostics.phase.${String(phase).replaceAll("-", "")}`);
}

function diagnosticsModel(phase) {
  if (state.contentMode === "standard") return interfaceText("wordworld.diagnostics.model.curated");
  if (runtimeAdapter()?.env !== "android") return interfaceText("wordworld.diagnostics.model.browserfallback");
  if (phase === "translating" || phase === "translating-queue") return "Czech → English Qwen";
  return "Word Sentence CZ";
}

function diagnosticsSource() {
  const labelIds = {
    "browser-fallback": "wordworld.diagnostics.source.browserfallback",
    "error-fallback": "wordworld.diagnostics.source.errorfallback",
    "validated-fallback": "wordworld.diagnostics.source.validatedfallback",
    "saved-queue": "wordworld.diagnostics.source.savedqueue",
    "standard-corpus": "wordworld.diagnostics.source.guidedcorpus",
    native: "wordworld.diagnostics.source.nativemodel",
    history: "wordworld.diagnostics.source.history"
  };
  const source = labelIds[state.currentGenerationSource]
    ? interfaceText(labelIds[state.currentGenerationSource])
    : state.currentGenerationSource || "—";
  if (state.currentGenerationSource !== "standard-corpus" || !state.semanticSelectionMode) return source;
  const semantic = state.semanticSelectionMode === "embedding"
    ? "English MiniLM"
    : interfaceText(state.semanticSelectionMode === "lexical"
      ? "wordworld.diagnostics.semantic.englishlexical"
      : "wordworld.diagnostics.semantic.targetindex");
  return `${source} · ${semantic}`;
}

function syncDiagnostics() {
  const phase = diagnosticsPhase();
  const runtime = runtimeAdapter()?.env === "android" ? "android" : "browser";
  const queueSize = state.branchQueue.size;
  const queueFresh = state.branchQueue.freshSize;
  const queueCapacity = state.branchQueue.capacity;
  const generationMode = generationModeLabel(state.generationMode);
  const contentMode = contentModeLabel(state.contentMode);
  const difficulty = learningDifficulty();
  const standardCounts = state.standardProvider?.difficultyCounts?.() || { 1: 0, 2: 0, 3: 0 };
  const eligibleStandard = standardCounts[1]
    + (difficulty >= 2 ? standardCounts[2] : 0)
    + (difficulty >= 3 ? standardCounts[3] : 0);
  const history = state.historyCursor
    ? interfaceText("wordworld.diagnostics.history.back", {
        count: state.history.length,
        offset: state.historyCursor
      })
    : String(state.history.length);
  const values = {
    wordNetMetaPhase: diagnosticsPhaseLabel(phase),
    wordNetMetaModel: diagnosticsModel(phase),
    wordNetMetaQueue: state.contentMode === "standard"
      ? interfaceText("wordworld.diagnostics.pool.standard", {
          eligible: eligibleStandard,
          seen: state.standardProvider?.usage?.entries?.size || 0
        })
      : interfaceText("wordworld.diagnostics.pool.generative", {
          fresh: queueFresh,
          saved: queueSize
        }),
    wordNetMetaMode: `${contentMode} · ${generationMode} · L${difficulty}`,
    wordNetMetaSource: diagnosticsSource(),
    wordNetMetaHistory: history
  };
  for (const [id, value] of Object.entries(values)) {
    const node = document.getElementById(id);
    if (node) node.textContent = value;
  }
  const poolLabel = $("#wordNetMetaPoolLabel");
  if (poolLabel) {
    poolLabel.textContent = interfaceText(state.contentMode === "standard"
      ? "wordworld.diagnostics.pool.corpus"
      : "wordworld.diagnostics.pool.queue");
  }
  const summary = $("#wordNetDiagnosticsSummary");
  if (summary) {
    summary.textContent = state.contentMode === "standard"
      ? interfaceText("wordworld.diagnostics.summary.standard", {
          phase: diagnosticsPhaseLabel(phase),
          mode: contentModeLabel("standard"),
          level: difficulty,
          eligible: eligibleStandard
        })
      : interfaceText("wordworld.diagnostics.summary.generative", {
          phase: diagnosticsPhaseLabel(phase),
          runtime,
          fresh: queueFresh,
          saved: queueSize,
          capacity: queueCapacity
        });
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

function loadChallengePromptMode() {
  try {
    const value = localStorage.getItem(CHALLENGE_PROMPT_MODE_STORAGE_KEY);
    if (hasChallengePromptMode(value)) return value;
  } catch (error) {
    // Challenge direction remains available for the current session.
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

function hasChallengePromptMode(mode) {
  return Object.prototype.hasOwnProperty.call(challengePromptModes, mode);
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

function saveChallengePromptMode() {
  if (state.guidedRequested) return;
  try {
    localStorage.setItem(CHALLENGE_PROMPT_MODE_STORAGE_KEY, state.challengePromptMode);
  } catch (error) {
    // Challenge direction remains available for the current session.
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
    failGuidedWordWorld(error, "wordworld.guided.dictionarysavefailed");
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

function toggleTargetTextPreference(key) {
  if (!providerContext?.targetTextGuide) return;
  if (!Object.hasOwn(state.targetTextPreferences, key)) return;
  state.targetTextPreferences[key] = !state.targetTextPreferences[key];
  saveTargetTextPreferences();
  syncTranslationMenu();
  if (state.currentSentence) renderCzechSentence(state.currentSentence, state.selectedWord);
  syncWordTranslation();
  renderReconstruction();
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
  window.CaatuuChrome?.releaseToolbarPopover?.(menu);
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
  window.CaatuuChrome?.constrainToolbarPopover?.(menu);
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
  window.CaatuuChrome?.releaseToolbarPopover?.(menu);
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
  if (!nextHidden) window.CaatuuChrome?.constrainToolbarPopover?.(menu);
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
  const guide = providerContext?.targetTextGuide || null;
  const targetTextSection = $("#wordNetTargetTextSettings");
  if (targetTextSection) targetTextSection.hidden = !guide;
  const targetTextLabel = $("#wordNetTargetTextSettingsLabel");
  if (targetTextLabel && guide) targetTextLabel.textContent = guide.labels.section;
  document.querySelectorAll("[data-target-text-setting]").forEach((button) => {
    const key = button.dataset.targetTextSetting;
    const label = guide?.labels?.[key];
    if (label) button.textContent = label;
    button.setAttribute("aria-checked", String(Boolean(state.targetTextPreferences[key])));
    button.disabled = !guide || state.busy || guidedWordInteractionLocked();
  });
}

function syncGenerationControl() {
  const button = $("#wordNetGenerationToggle");
  const icon = $("#wordNetGenerationIcon");
  const mode = hasGenerationMode(state.generationMode) ? state.generationMode : "random";
  if (mode !== state.generationMode) state.generationMode = mode;
  const config = generationModes[mode];
  const selectedModeLabel = generationModeLabel(mode);
  icon?.querySelectorAll("[data-generation-icon]").forEach((generationIcon) => {
    generationIcon.toggleAttribute("hidden", generationIcon.dataset.generationIcon !== mode);
  });
  if (button) {
    button.disabled = state.busy || state.guidedRequested;
    const label = mode === "selected" ? selectedModeLabel : generationModeLabel(mode);
    button.setAttribute("aria-label", interfaceText("wordworld.generation.current", { mode: label }));
    button.setAttribute("title", interfaceText("wordworld.generation.title", { mode: label }));
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
    if (label) label.textContent = generationModeLabel(optionMode);
  });
  const configuredPromptMode = hasChallengePromptMode(state.challengePromptMode)
    ? state.challengePromptMode
    : "random";
  const promptMode = sourcePrimaryLanguage === "en" ? configuredPromptMode : "source";
  if (promptMode !== state.challengePromptMode) state.challengePromptMode = promptMode;
  const sourceLabel = sourceLanguageLabel;
  document.querySelectorAll("[data-challenge-prompt-mode]").forEach((option) => {
    const optionMode = option.dataset.challengePromptMode;
    const selected = optionMode === promptMode;
    option.classList.toggle("is-selected", selected);
    option.setAttribute("aria-checked", selected ? "true" : "false");
    option.disabled = state.busy
      || state.guidedRequested
      || (sourcePrimaryLanguage !== "en" && optionMode !== "source");
    option.setAttribute("aria-disabled", String(option.disabled));
    const label = option.querySelector("[data-challenge-prompt-label]");
    if (label) {
      label.textContent = optionMode === "source"
        ? interfaceText("wordworld.prompt.language", { language: sourceLabel })
        : optionMode === "target"
          ? interfaceText("wordworld.prompt.language", { language: targetLanguageLabel })
          : challengePromptModeLabel("random");
    }
    const summary = option.querySelector("small");
    if (summary) {
      summary.textContent = optionMode === "source"
        ? interfaceText("wordworld.prompt.arrange", { language: targetLanguageLabel })
        : optionMode === "target"
          ? interfaceText("wordworld.prompt.arrange", { language: sourceLabel })
          : interfaceText("wordworld.prompt.either", {
              source: sourceLabel,
              target: targetLanguageLabel
            });
    }
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
  const generativeMessage = generationAvailabilityMessage(generative);
  if (mode !== state.contentMode) state.contentMode = mode;
  document.querySelectorAll("[data-content-mode]").forEach((button) => {
    const buttonMode = button.dataset.contentMode;
    const selected = buttonMode === mode;
    const runtimeDisabled = buttonMode === "generative" && generative.supported && !generative.enabled;
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-pressed", selected ? "true" : "false");
    button.disabled = state.busy || state.guidedRequested || !supportsContentMode(buttonMode);
    button.setAttribute("aria-disabled", String(button.disabled || runtimeDisabled));
    button.title = runtimeDisabled ? generativeMessage : "";
  });
  const note = $("#wordNetGenerativeNote");
  if (note) {
    note.textContent = generative.enabled
      ? interfaceText("wordworld.generative.downloadrequired")
      : generativeMessage;
    note.hidden = !generative.supported || (generative.enabled && mode !== "generative");
  }
  const control = $("#wordNetContentSource");
  if (control) {
    control.setAttribute(
      "aria-label",
      interfaceText("wordworld.content.current", {
        mode: contentModeLabel(mode),
        note: generative.supported && !generative.enabled ? ` ${generativeMessage}` : ""
      })
    );
  }
  syncDiagnostics();
}

const providerRecordSources = new WeakMap();

function recordIdentifier(record) {
  return String(record?.id ?? record?.conceptId ?? "").trim();
}

export function resolveWordWorldRecordLanguageRoles(prepared = {}, record = {}) {
  const englishAuditText = String(
    prepared?.audit?.text
    ?? record.englishAuditText
    ?? prepared?.englishText
    ?? record.en
    ?? record.sourceText
    ?? ""
  ).normalize("NFC").trim();
  return Object.freeze({
    englishAuditText,
    learnerPromptText: String(
      prepared?.learnerPrompt?.text
      ?? record.learnerPromptText
      ?? record.sourceText
      ?? englishAuditText
    ).normalize("NFC").trim()
  });
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
  const { englishAuditText, learnerPromptText } = resolveWordWorldRecordLanguageRoles(
    prepared,
    record
  );
  const converted = {
    ...record,
    id,
    cs: String(target?.text ?? record.cs ?? record.targetText ?? "").normalize("NFC").trim(),
    en: learnerPromptText,
    englishAuditText,
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
      console.error("Word World curated sentence pack could not initialize", error);
      state.standardCorpusError = interfaceText("wordworld.standard.unavailable");
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
      setStatus(
        provider ? interfaceText("wordworld.standard.ready") : state.standardCorpusError,
        { tone: provider ? "active" : "error" }
      );
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
      ? interfaceText("wordworld.standard.readynext")
      : state.standardCorpusError, { tone: provider ? "active" : "error" });
  } else {
    setStatus(interfaceText("wordworld.generative.explanation"), { tone: "active" });
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
  if (title) {
    title.textContent = disabled
      ? interfaceText("wordworld.generative.dialog.disabledtitle")
      : interfaceText("wordworld.generative.dialog.title");
  }
  if (description) {
    description.textContent = disabled
      ? generationAvailabilityMessage(availability)
      : interfaceText("wordworld.generative.dialog.description");
  }
  if (note) {
    note.textContent = disabled
      ? interfaceText("wordworld.generative.dialog.disablednote")
      : interfaceText("wordworld.generative.dialog.note");
  }
  if (cancelButton) cancelButton.hidden = disabled;
  if (continueButton) {
    continueButton.textContent = interfaceText(disabled ? "common.action.close" : "common.action.continue");
  }
  dialog.dataset.mode = mode;
  return dialog;
}

function showGenerativeUnavailablePrompt() {
  const availability = generationAvailability();
  const dialog = configureGenerativeDialog("disabled", availability);
  if (!dialog || typeof dialog.showModal !== "function") {
    window.alert?.(generationAvailabilityMessage(availability));
    return;
  }
  if (!dialog.open) dialog.showModal();
}

function confirmGenerativeMode() {
  const dialog = configureGenerativeDialog("confirmation");
  if (!dialog || typeof dialog.showModal !== "function") {
    return Promise.resolve(window.confirm(
      interfaceText("wordworld.generative.confirm")
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

function setChallengePromptMode(mode) {
  if (
    state.guidedRequested
    || !hasChallengePromptMode(mode)
    || (sourcePrimaryLanguage !== "en" && mode !== "source")
  ) return;
  state.challengePromptMode = mode;
  saveChallengePromptMode();
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
      setStatus(interfaceText("wordworld.generation.selectfirst"), { tone: "muted" });
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
    setStatus(interfaceText("wordworld.generation.selectfirst"), { tone: "muted" });
    return;
  }
  const phraseRequestId = state.phraseRequestId;
  const provider = state.standardProvider || await initializeStandardCorpus();
  if (state.contentMode !== "standard" || phraseRequestId !== state.phraseRequestId) return;
  if (!provider) {
    setStatus(state.standardCorpusError || interfaceText("wordworld.standard.unavailable"), { tone: "error" });
    return;
  }
  const difficulty = learningDifficulty();
  const englishQuery = mode === "selected" ? selectedEnglishSemanticQuery() : "";
  const ownsSemanticBusy = Boolean(
    mode === "selected" && englishQuery && typeof providerContext?.searchEnglish === "function" && !state.busy
  );
  if (ownsSemanticBusy) {
    setBusy(true);
    setStatus(interfaceText("wordworld.standard.rankingenglish"), { tone: "active" });
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
      setStatus(interfaceText("wordworld.standard.selectionfailed"), { tone: "error" });
    }
  });
  if (outcome.error || outcome.skipped || outcome.presented) return;
  const selection = outcome.selection;
  state.semanticSelectionMode = mode === "selected" ? selection?.semanticMode || "provider" : "";
  if (!selection?.record) {
    if (mode === "selected") {
      setStatus(
        interfaceText("wordworld.standard.nomatching", {
          level: difficulty,
          word: state.selectedWord
        }),
        { tone: "active" }
      );
      return;
    }
    setStatus(interfaceText("wordworld.standard.none", { level: difficulty }), { tone: "error" });
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
    setStatus(interfaceText("wordworld.standard.preparing"), { tone: "active" });
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
      setStatus(currentReconstructionInstruction(), { tone: "muted" });
    } else if (selection.fallback) {
      setStatus(interfaceText("wordworld.standard.fallback", {
        level: difficulty,
        word: selection.requestedWord
      }), { tone: "active" });
    } else {
      setStatus(playInstruction(), { tone: "muted" });
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
  setStatus(interfaceText("wordworld.queue.ready"), { tone: "active" });
  try {
    await presentPreparedCandidate(target, queued, transitionStartedAt);
  } catch (error) {
    if (!state.busy) setBusy(true);
    await presentPreparedCandidate(target, {
      sentence: localSentence(target, generationAvoidList()),
      source: "queue-error-fallback"
    }, transitionStartedAt);
    console.error("Word World could not restore a queued phrase", error);
    setStatus(interfaceText("wordworld.history.restorefailed"), { tone: "error" });
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
  const fallbacks = sourcePrimaryLanguage === "en" ? reconstructionFallbackTexts : [];
  return [...scoredRecords, ...historyTexts, ...fallbacks].filter((text) => {
    const value = String(text || "").trim();
    const key = value.toLocaleLowerCase("en-US");
    if (!value || value === state.currentTranslation || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function preparedTargetRecord(entryId = state.currentEntryId) {
  return typeof providerContext?.sessionRecord === "function"
    ? providerContext.sessionRecord(entryId)
    : null;
}

function targetReconstructionParts(text, record = preparedTargetRecord()) {
  const surface = String(text || "").normalize("NFC").trim();
  if (!surface || typeof providerContext?.segment !== "function") return [];
  const target = record?.target?.text === surface ? record.target : surface;
  let segments;
  try {
    segments = providerContext.segment(target, { record });
  } catch (error) {
    return [];
  }
  const preparedTokens = Array.isArray(record?.target?.tokens) ? record.target.tokens : [];
  let tokenIndex = 0;
  return (Array.isArray(segments) ? segments : []).flatMap((segment) => {
    if (segment?.type !== "word") return [];
    const index = tokenIndex;
    tokenIndex += 1;
    const token = preparedTokens[index] || segment;
    return [{
      text: String(segment.text || token?.surface || token?.text || "").normalize("NFC").trim(),
      prepared: { record, token, tokenIndex: index }
    }];
  }).filter((part) => part.text);
}

function reconstructionLayout(text, parts, { defaultSeparator = " " } = {}) {
  const surface = String(text || "").normalize("NFC").trim();
  const separators = [];
  let cursor = 0;
  for (const part of Array.isArray(parts) ? parts : []) {
    const token = String(part?.text || "");
    const index = surface.indexOf(token, cursor);
    if (!token || index < cursor) {
      return {
        separators: (Array.isArray(parts) ? parts : []).map((unused, partIndex) => partIndex ? defaultSeparator : ""),
        trailing: "",
        defaultSeparator
      };
    }
    separators.push(surface.slice(cursor, index));
    cursor = index + token.length;
  }
  return { separators, trailing: surface.slice(cursor), defaultSeparator };
}

export function inferReconstructionSeparator(text) {
  const surface = String(text || "").normalize("NFC").trim();
  return surface.match(/\s+/u)?.[0] || "";
}

export function sourceTranslationFeedbackLabel(sourceLanguage = {}) {
  const label = interfaceLanguageName(sourceLanguage, "wordworld.language.base").normalize("NFC").trim();
  return interfaceText("wordworld.feedback.wrongtranslation", {
    language: label || interfaceText("wordworld.language.base")
  });
}

function targetReconstructionCandidateParts() {
  const currentId = String(state.currentEntryId || "");
  const parts = [];
  for (const candidate of state.standardProvider?.records || []) {
    if (String(candidate?.id || "") === currentId) continue;
    const record = preparedTargetRecord(candidate?.id);
    parts.push(...targetReconstructionParts(record?.target?.text || candidate?.cs, record));
    if (parts.length >= 240) break;
  }
  if (!parts.length) {
    for (const entry of state.history.slice(0, 48)) {
      parts.push(...targetReconstructionParts(entry.sentence, null));
    }
  }
  return parts;
}

function buildTargetReconstructionChallenge() {
  const record = preparedTargetRecord();
  const answerParts = targetReconstructionParts(state.currentSentence, record);
  if (!answerParts.length) return null;
  const normalize = (value) => {
    try {
      return providerContext?.normalization?.answerKey?.(value, { purpose: "word-world-reconstruction" })
        || String(value || "").normalize("NFC").trim().toLocaleLowerCase(targetLocale);
    } catch (error) {
      return String(value || "").normalize("NFC").trim().toLocaleLowerCase(targetLocale);
    }
  };
  const challenge = buildTokenReconstructionChallenge(
    answerParts,
    targetReconstructionCandidateParts(),
    { distractorCount: RECONSTRUCTION_DISTRACTOR_COUNT, normalize }
  );
  const defaultSeparator = inferReconstructionSeparator(state.currentSentence);
  return {
    ...challenge,
    text: state.currentSentence,
    layout: reconstructionLayout(state.currentSentence, answerParts, { defaultSeparator })
  };
}

function buildSourceReconstructionChallenge() {
  if (sourcePrimaryLanguage !== "en") return null;
  const challenge = buildWordReconstructionChallenge(
    state.currentTranslation,
    reconstructionCandidateTexts(),
    { distractorCount: RECONSTRUCTION_DISTRACTOR_COUNT }
  );
  return {
    ...challenge,
    layout: reconstructionLayout(challenge.text, challenge.answerParts, { defaultSeparator: " " })
  };
}

function resolvedChallengePromptSide() {
  if (sourcePrimaryLanguage !== "en") return "source";
  if (state.guidedMode) return "target";
  if (state.challengePromptMode === "source" || state.challengePromptMode === "target") {
    return state.challengePromptMode;
  }
  return Math.random() < 0.5 ? "source" : "target";
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
  let promptSide = resolvedChallengePromptSide();
  let challenge = promptSide === "source"
    ? buildTargetReconstructionChallenge()
    : buildSourceReconstructionChallenge();
  if (!challenge && promptSide === "source" && sourcePrimaryLanguage === "en") {
    promptSide = "target";
    challenge = buildSourceReconstructionChallenge();
  }
  if (!challenge?.answerTokens?.length) {
    state.reconstruction = null;
    return null;
  }
  state.reconstruction = {
    key,
    promptSide,
    answerSide: promptSide === "source" ? "target" : "source",
    promptText: promptSide === "source" ? state.currentTranslation : state.currentSentence,
    answerText: promptSide === "source" ? state.currentSentence : state.currentTranslation,
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
  const selected = reconstructionSelectedOptions(round);
  const layout = round.challenge.layout || { separators: [], trailing: "", defaultSeparator: " " };
  let text = "";
  selected.forEach((option, index) => {
    const separator = layout.separators?.[index]
      ?? (index ? layout.defaultSeparator || " " : "");
    text += `${separator}${option.text}`;
  });
  if (selected.length) text += layout.trailing || "";
  return text.trim();
}

function reconstructionTokenButton(option, location, { inAnswer = false } = {}) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "word-net-reconstruction-token";
  button.dataset.reconstructionOptionId = option.id;
  button.dataset.reconstructionLocation = location;
  if (state.reconstruction?.answerSide === "target") {
    replaceTargetText(button, option.text, option.part?.prepared || null);
  } else {
    button.textContent = option.text;
  }
  button.classList.toggle("is-in-answer", location === "bank" && inAnswer);
  button.disabled = state.busy || guidedWordInteractionLocked() || state.reconstruction?.evidencePending || inAnswer;
  if (location === "answer") {
    button.setAttribute("aria-label", interfaceText("wordworld.reconstruction.remove", { word: option.text }));
  } else if (inAnswer) {
    button.tabIndex = -1;
    button.setAttribute("aria-hidden", "true");
  } else {
    button.setAttribute("aria-label", interfaceText("wordworld.reconstruction.add", { word: option.text }));
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

function replaceTargetSentence(host, text, record = preparedTargetRecord(), {
  prefix = "",
  suffix = ""
} = {}) {
  if (!host) return false;
  const surface = String(text || "").normalize("NFC").trim();
  const parts = providerContext?.targetTextGuide
    ? targetReconstructionParts(surface, record)
    : [];
  if (!parts.length) {
    host.classList.remove("has-target-text-guide", "has-target-text-colors");
    host.textContent = `${prefix}${surface}${suffix}`;
    return false;
  }
  const defaultSeparator = inferReconstructionSeparator(surface);
  const layout = reconstructionLayout(surface, parts, { defaultSeparator });
  const fragment = document.createDocumentFragment();
  if (prefix) fragment.append(document.createTextNode(prefix));
  let guided = false;
  parts.forEach((part, index) => {
    const separator = layout.separators?.[index]
      ?? (index ? layout.defaultSeparator : "");
    if (separator) fragment.append(document.createTextNode(separator));
    const token = document.createElement("span");
    token.className = "word-net-target-sentence-token";
    guided = replaceTargetText(token, part.text, part.prepared) || guided;
    fragment.append(token);
  });
  if (layout.trailing) fragment.append(document.createTextNode(layout.trailing));
  if (suffix) fragment.append(document.createTextNode(suffix));
  host.classList.toggle("has-target-text-guide", guided && state.targetTextPreferences.showGuide);
  host.classList.toggle("has-target-text-colors", guided && state.targetTextPreferences.colorTones);
  host.replaceChildren(fragment);
  return guided;
}

function renderReconstructionAttempt(round, host) {
  const selected = reconstructionSelectedOptions(round);
  host.classList.toggle("is-complete-sentence", round.correct);
  if (round.correct) {
    const sentence = round.submittedText || reconstructionSelectedText(round);
    if (round.answerSide === "target") replaceTargetSentence(host, sentence);
    else {
      host.classList.remove("has-target-text-guide", "has-target-text-colors");
      host.textContent = sentence;
    }
    host.removeAttribute("role");
    host.setAttribute("aria-label", interfaceText("wordworld.reconstruction.answercorrect", { answer: sentence }));
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
  let enteredIndex = 0;
  operations.filter((operation) => operation.entered).forEach((operation) => {
    const token = document.createElement("span");
    const isCorrect = operation.type === "match";
    token.className = `word-net-reconstruction-result-token ${isCorrect ? "is-correct" : "is-wrong"}`;
    const option = selected[enteredIndex];
    enteredIndex += 1;
    if (round.answerSide === "target") {
      replaceTargetText(token, operation.entered, option?.part?.prepared || null);
    } else {
      token.textContent = operation.entered;
    }
    submitted.append(token);
    spokenFeedback.push(interfaceText(
      isCorrect
        ? "wordworld.reconstruction.tokencorrect"
        : "wordworld.reconstruction.tokenincorrect",
      { word: operation.entered }
    ));
  });
  if (round.challenge.layout?.trailing) {
    const punctuation = document.createElement("span");
    punctuation.className = "word-net-reconstruction-result-punctuation";
    punctuation.textContent = round.challenge.layout.trailing;
    submitted.append(punctuation);
  }

  host.replaceChildren(submitted);
  host.removeAttribute("role");
  host.setAttribute(
    "aria-label",
    interfaceText("wordworld.reconstruction.answerfeedback", {
      answer: submittedSentence,
      feedback: spokenFeedback.join(", ")
    })
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
      points: interfaceText("wordworld.reconstruction.points", { count: round.awardedXp || 0 })
    },
    incorrect: {
      mark: "\u21ba",
      message: interfaceText("wordworld.reconstruction.incorrectdetail"),
      points: interfaceText("wordworld.reconstruction.points", { count: 0 })
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
  const targetRecord = preparedTargetRecord();
  if (title) {
    if (round.promptSide === "target") replaceTargetSentence(title, round.promptText, targetRecord);
    else {
      title.classList.remove("has-target-text-guide", "has-target-text-colors");
      title.textContent = round.promptText;
    }
    const promptLanguage = round.promptSide === "target" ? course.targetLanguage : course.sourceLanguage;
    title.lang = String(promptLanguage?.locale || promptLanguage?.id || "");
    title.dir = promptLanguage?.direction === "rtl" ? "rtl" : "ltr";
  }
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
    if (round.answerSide === "target") {
      replaceTargetSentence(correctText, round.answerText, targetRecord, {
        prefix: "\u201c",
        suffix: "\u201d"
      });
    } else {
      correctText.classList.remove("has-target-text-guide", "has-target-text-colors");
      correctText.textContent = `\u201c${round.answerText}\u201d`;
    }
    const answerLanguage = round.answerSide === "target" ? course.targetLanguage : course.sourceLanguage;
    correctText.lang = String(answerLanguage?.locale || answerLanguage?.id || "");
    correctText.dir = answerLanguage?.direction === "rtl" ? "rtl" : "ltr";
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
    ? interfaceText("wordworld.navigation.previous.submitfirst")
    : state.guidedRequested
      ? interfaceText("wordworld.navigation.previous.guidedunavailable")
      : historyUnavailable
        ? interfaceText("wordworld.navigation.previous.none")
        : interfaceText("wordworld.navigation.previous.label");
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
    ? interfaceText("wordworld.navigation.next.verbnebula")
    : state.guidedRequested && round?.submitted
      ? interfaceText("wordworld.navigation.next.retry")
    : challengeLocked
      ? interfaceText("wordworld.navigation.next.submitfirst")
      : state.guidedRequested
        ? interfaceText("wordworld.navigation.next.completeguided")
        : interfaceText("wordworld.navigation.next.label");
  next.setAttribute("aria-label", label);
  next.title = label;
  syncPreviousSentenceControl(round);
}

function syncReconstructionPresentation(round = null) {
  const promptSide = round?.promptSide === "source" ? "source" : "target";
  const promptLanguage = promptSide === "source" ? course.sourceLanguage : course.targetLanguage;
  const answerSide = round?.answerSide === "target" ? "target" : "source";
  const answerLanguage = answerSide === "target" ? course.targetLanguage : course.sourceLanguage;
  const sentence = $("#wordNetSentence");
  const phraseSound = $("#wordNetPhraseSound");
  const root = $("#wordNetReconstruction");
  const answer = $("#wordNetReconstructionAnswer");
  const bank = $("#wordNetReconstructionBank");
  const badge = $("#wordNetReconstructionLanguage");
  const promptLocale = String(promptLanguage?.locale || promptLanguage?.id || "").trim();
  const promptDirection = promptLanguage?.direction === "rtl" ? "rtl" : "ltr";
  const answerLocale = String(answerLanguage?.locale || answerLanguage?.id || "").trim();
  const answerDirection = answerLanguage?.direction === "rtl" ? "rtl" : "ltr";
  const answerLabel = interfaceLanguageName(answerLanguage, "wordworld.language.other");

  if (sentence) {
    if (promptSide === "source") {
      sentence.classList.add("is-source-language-prompt");
      sentence.textContent = round?.promptText || state.currentTranslation;
    } else if (sentence.classList.contains("is-source-language-prompt")) {
      sentence.classList.remove("is-source-language-prompt");
      renderCzechSentence(state.currentSentence, state.selectedWord);
    }
    if (promptLocale) sentence.lang = promptLocale;
    sentence.dir = promptDirection;
  }
  if (phraseSound) {
    phraseSound.hidden = promptSide === "source" || course.capabilities?.speech !== true;
  }
  if (promptSide === "source" && state.speechSource === "sentence") {
    cancelCzechSpeech();
  }
  if (root) {
    root.setAttribute("aria-label", interfaceText("wordworld.reconstruction.region", {
      language: answerLabel
    }));
  }
  if (answer) {
    answer.setAttribute("aria-label", interfaceText("wordworld.reconstruction.answerregion", {
      language: answerLabel
    }));
    if (answerLocale) answer.lang = answerLocale;
    answer.dir = answerDirection;
  }
  if (bank) {
    bank.setAttribute("aria-label", interfaceText("wordworld.reconstruction.bank", {
      language: answerLabel
    }));
    if (answerLocale) bank.lang = answerLocale;
    bank.dir = answerDirection;
  }
  if (badge) badge.textContent = String(answerLanguage?.shortCode || answerLanguage?.id || "").toUpperCase();
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
  syncReconstructionPresentation(round);
  syncPlayInstruction();
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
  const answerNodes = [];
  const leading = round.challenge.layout?.separators?.[0] || "";
  if (selected.length && leading.trim()) {
    const punctuation = document.createElement("span");
    punctuation.className = "word-net-reconstruction-punctuation";
    punctuation.textContent = leading;
    punctuation.setAttribute("aria-hidden", "true");
    answerNodes.push(punctuation);
  }
  answerNodes.push(...selected.map((option) => reconstructionTokenButton(option, "answer")));
  if (selected.length && round.challenge.layout?.trailing?.trim()) {
    const punctuation = document.createElement("span");
    punctuation.className = "word-net-reconstruction-punctuation";
    punctuation.textContent = round.challenge.layout.trailing;
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
  round.announcement = interfaceText("wordworld.reconstruction.added", { word: option.text });
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
  round.announcement = interfaceText("wordworld.reconstruction.removed", { word: option.text });
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
        "wordworld.guided.changed"
      );
      return;
    }
  }
  const selected = reconstructionSelectedOptions(round);
  if (!selected.length) {
    round.announcement = interfaceText("wordworld.reconstruction.chooseword");
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
    round.announcement = interfaceText("wordworld.reconstruction.savingevidence");
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
      failGuidedWordWorld(error, "wordworld.guided.answersavefailed");
      round.announcement = interfaceText("wordworld.reconstruction.evidencenotsaved");
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
        ? interfaceText("wordworld.reconstruction.correctcontinue")
        : interfaceText("wordworld.reconstruction.correctsupported")
      : (round.awardedXp
          ? interfaceText("wordworld.reconstruction.correctxp", { count: round.awardedXp })
          : interfaceText("wordworld.reconstruction.correctalreadyrewarded"))
    : interfaceText("wordworld.reconstruction.incorrect");
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
  round.announcement = interfaceText("wordworld.reconstruction.submitbeforeadvance");
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
    setStatus(interfaceText("wordworld.guided.retry.preparing"), { tone: "active" });
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
  setStatus(interfaceText("wordworld.translation.revealedxp", {
    language: sourceLanguageLabel,
    count: 1
  }), { tone: "success" });
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
    failGuidedWordWorld(
      error,
      "wordworld.guided.revealsavefailed",
      { language: sourceLanguageLabel }
    );
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
  if (providerContext?.learnerBase) {
    const sourceLanguage = course.sourceLanguage || {};
    node.lang = String(sourceLanguage.locale || sourceLanguage.id || "").trim();
    node.dir = sourceLanguage.direction === "rtl" ? "rtl" : "ltr";
  }
  node.textContent = loading ? interfaceText("wordworld.translation.loading") : state.currentTranslation;
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
  const label = translationModeLabel(mode);
  button.classList.toggle("is-off", mode === "off");
  button.classList.toggle("is-waiting", mode.startsWith("timer-") && !state.translationVisible);
  button.setAttribute("aria-label", interfaceText("wordworld.translation.settingscurrent", { mode: label }));
  button.setAttribute("title", interfaceText("wordworld.translation.modetitle", { mode: label }));
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
  if (normalizedLemma && normalizedLemma !== normalizedSelected) {
    metadata.push(interfaceText("wordworld.dictionary.lemma", { lemma: details.lemma }));
  }
  if (details?.formTags?.length) metadata.push(details.formTags.slice(0, 3).join(" ").replaceAll("-", " "));
  const grammarTags = (details?.senseTags || []).filter((tag) => !details?.formTags?.includes(tag));
  if (grammarTags.length) metadata.push(grammarTags.slice(0, 2).join(" ").replaceAll("-", " "));
  if (details?.synonyms?.length) {
    metadata.push(interfaceText("wordworld.dictionary.also", {
      synonyms: details.synonyms.slice(0, 2).join(", ")
    }));
  }
  if (state.selectedWordGapNotice) metadata.push(state.selectedWordGapNotice);
  panel.hidden = !visible;
  panel.setAttribute("aria-hidden", visible ? "false" : "true");
  panel.classList.toggle("is-loading", visible && state.wordMeaningLoading);
  replaceTargetText(
    wordNode,
    visible ? state.selectedWord : "",
    visible ? preparedTokenForWord(state.selectedWord) : null
  );
  posNode.textContent = visible && details?.pos && details.pos !== "word" ? details.pos : "";
  meaningNode.textContent = !visible
    ? ""
    : state.wordMeaningLoading
      ? interfaceText("wordworld.dictionary.loading")
      : state.selectedWordMeaning || unavailableWordMeaning();
  meaningNode.lang = details?.languageTag || providerContext?.learnerBase?.languageTag || "en";
  metaNode.textContent = visible && !state.wordMeaningLoading ? metadata.join(" · ") : "";
  metaNode.hidden = !metaNode.textContent;
  metaNode.title = metaNode.textContent;
  syncTranslationMenu();
  syncSpeechControl();
}

function targetTextUnits(prepared) {
  if (!prepared || typeof providerContext?.targetTextUnits !== "function") return null;
  try {
    return providerContext.targetTextUnits(prepared);
  } catch (error) {
    return null;
  }
}

function replaceTargetText(host, text, prepared) {
  if (!host) return false;
  const surface = String(text || "").normalize("NFC");
  const units = targetTextUnits(prepared);
  const validUnits = Array.isArray(units)
    && units.length > 0
    && units.every((unit) => String(unit?.surface || "") && String(unit?.notation || ""))
    && units.map((unit) => String(unit.surface)).join("") === surface;
  host.classList.toggle("has-target-text-guide", validUnits && state.targetTextPreferences.showGuide);
  host.classList.toggle("has-target-text-colors", validUnits && state.targetTextPreferences.colorTones);
  if (!validUnits) {
    host.textContent = surface;
    return false;
  }

  const run = document.createElement("span");
  run.className = "word-net-target-text";
  for (const unit of units) {
    const wrapper = document.createElement(state.targetTextPreferences.showGuide ? "ruby" : "span");
    wrapper.className = "word-net-target-text-unit";
    if (state.targetTextPreferences.colorTones) wrapper.dataset.tone = String(unit.tone || 5);
    const glyph = document.createElement("span");
    glyph.className = "word-net-target-text-glyph";
    glyph.textContent = unit.surface;
    wrapper.append(glyph);
    if (state.targetTextPreferences.showGuide) {
      const guide = document.createElement("rt");
      guide.className = "word-net-target-text-notation";
      guide.lang = providerContext.targetTextGuide?.languageTag || "";
      guide.setAttribute("aria-hidden", "true");
      guide.textContent = unit.notation;
      wrapper.append(guide);
    }
    run.append(wrapper);
  }
  host.replaceChildren(run);
  return true;
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
  if (!dictionaryGapReporting || providerContext?.session?.course?.capabilities?.dictionary !== true) return;
  const normalizedWord = normalizeWord(selectedWord).toLocaleLowerCase(targetLocale);
  if (!normalizedWord) return;
  if (state.dictionaryGapKeys.includes(normalizedWord)) {
    if (normalizedWord === state.selectedWord.toLocaleLowerCase(targetLocale)) {
      state.selectedWordGapNotice = interfaceText(DICTIONARY_GAP_NOTICE_ID);
      syncWordTranslation();
    }
    return;
  }
  const feedback = buildDictionaryGapFeedback(course, {
    targetWord: selectedWord,
    normalizedWord,
    lookupReturned
  });
  if (!feedback) return;
  try {
    const queued = await runtimeAdapter()?.maintenance?.enqueueDictionaryGap?.(feedback);
    if (!queued?.queued || queued.persisted === false || !rememberDictionaryGap(normalizedWord)) return;
    if (normalizedWord === state.selectedWord.toLocaleLowerCase(targetLocale)) {
      state.selectedWordGapNotice = interfaceText(DICTIONARY_GAP_NOTICE_ID);
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
  const matchesSelected = (token, index) => {
    const value = token?.surface ?? token?.text ?? "";
    const key = typeof searchKey === "function"
      ? searchKey(value, { record, token, tokenIndex: index, purpose: "word-world-meaning" })
      : normalizeWord(value).toLocaleLowerCase(targetLocale);
    return key && key === selectedKey;
  };
  const tokenIndex = Number.isInteger(state.selectedTokenIndex)
    && tokens[state.selectedTokenIndex]
    && matchesSelected(tokens[state.selectedTokenIndex], state.selectedTokenIndex)
    ? state.selectedTokenIndex
    : tokens.findIndex(matchesSelected);
  return tokenIndex >= 0 ? { record, token: tokens[tokenIndex], tokenIndex } : null;
}

function wordMeaningCacheKey(word) {
  const normalized = normalizeWord(word).toLocaleLowerCase(targetLocale);
  if (!providerContext?.learnerBase) return normalized;
  const prepared = preparedTokenForWord(word);
  return `${state.currentEntryId}\u0000${prepared?.tokenIndex ?? ""}\u0000${normalized}`;
}

function unavailableWordMeaning() {
  return interfaceText(providerContext?.learnerBase
    ? "wordworld.dictionary.unavailable"
    : "wordworld.dictionary.nomeaning");
}

export function englishAuditSemanticQuery(record = {}) {
  const candidates = [
    String(record?.audit?.languageTag || "").toLocaleLowerCase("en-US").split("-")[0] === "en"
      ? record.audit.text
      : "",
    record?.englishAuditText,
    record?.englishText
  ];
  for (const candidate of candidates) {
    const query = String(candidate || "").normalize("NFC").replace(/\s+/gu, " ").trim();
    if (query) return query;
  }
  return "";
}

function selectedEnglishSemanticQuery() {
  const record = typeof providerContext?.sessionRecord === "function"
    ? providerContext.sessionRecord(state.currentEntryId)
    : null;
  return englishAuditSemanticQuery(record);
}

async function lookupSelectedWord(word) {
  const selectedWord = normalizeWord(word);
  if (!selectedWord || state.translationMode === "off") {
    syncWordTranslation();
    return;
  }

  const key = wordMeaningCacheKey(selectedWord);
  if (state.wordMeaningCache.has(key)) {
    state.selectedWordDetails = state.wordMeaningCache.get(key);
    state.selectedWordMeaning = state.selectedWordDetails?.meaning || unavailableWordMeaning();
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

  const fallback = providerContext?.learnerBase ? "" : fallbackWordMeaning(selectedWord);
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
          languageTag: preparedMeaning.languageTag || "en",
          metadata: String(preparedMeaning.metadata || "").normalize("NFC").trim()
        }
      : null;
    let lookupReturned = result ? 1 : 0;
    if (!result && !Array.isArray(authored?.record?.learnerTokenMeanings)
        && providerContext?.session?.course?.capabilities?.dictionary === true) {
      const dictionary = runtimeAdapter()?.dictionary;
      if (!dictionary?.search) throw new Error("Dictionary lookup is unavailable.");
      const payload = await dictionary.search(selectedWord, { limit: 8, signal: controller.signal });
      result = selectDictionaryMeaning(payload, selectedWord, { maxGlosses: 2 });
      lookupReturned = Array.isArray(payload?.results) ? payload.results.length : 0;
    }
    const meaning = result?.meaning || fallback || unavailableWordMeaning();
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
    if (requestId !== state.wordLookupRequestId || key !== wordMeaningCacheKey(state.selectedWord)) return;
    state.selectedWordMeaning = meaning;
    state.selectedWordDetails = details;
    if (result) state.selectedWordGapNotice = "";
    if (!result) void queueMissingDictionaryFeedback(selectedWord, { lookupReturned });
  } catch (error) {
    if (error?.name === "AbortError" || requestId !== state.wordLookupRequestId) return;
    state.selectedWordMeaning = fallback || interfaceText("wordworld.dictionary.unavailable");
    state.selectedWordDetails = null;
  } finally {
    if (requestId === state.wordLookupRequestId) {
      state.wordLookupController = null;
      state.wordMeaningLoading = false;
      syncWordTranslation();
    }
  }
}

function selectWord(word, { lookup = true, render = true, userInitiated = false, tokenIndex = null } = {}) {
  const selectedWord = normalizeWord(word);
  if (!selectedWord) return;
  const previousKey = state.selectedWord.toLocaleLowerCase(targetLocale);
  const nextKey = selectedWord.toLocaleLowerCase(targetLocale);
  state.selectedTokenIndex = Number.isInteger(tokenIndex) && tokenIndex >= 0 ? tokenIndex : null;
  const nextMeaningKey = wordMeaningCacheKey(selectedWord);
  state.selectedWord = selectedWord;
  if (previousKey !== nextKey || state.selectedWordMeaningKey !== nextMeaningKey) {
    state.selectedWordMeaningKey = nextMeaningKey;
    if (state.speechSource === "word") cancelCzechSpeech();
    abortWordLookup();
    state.selectedWordGapNotice = state.dictionaryGapKeys.includes(nextKey)
      ? interfaceText(DICTIONARY_GAP_NOTICE_ID)
      : "";
    state.selectedWordDetails = state.wordMeaningCache.get(wordMeaningCacheKey(selectedWord)) || null;
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
    const formattedPercent = new Intl.NumberFormat(globalThis.CaatuuI18n?.locale || sourceLocale, {
      maximumFractionDigits: 1,
      minimumFractionDigits: 1
    }).format(percent);
    setStatus(interfaceText("wordworld.generative.downloadprogress", {
      percent: formattedPercent
    }), { tone: "active" });
    return;
  }

  progress.hidden = true;
  progress.setAttribute("aria-valuenow", "0");
  bar.style.width = "0%";
}

function robotLoadingActive() {
  return state.loadingActive && !state.loadingPageHidden && document.visibilityState !== "hidden";
}

function syncRobotLoadingActivity() {
  const active = robotLoadingActive();
  state.loadingScreen?.setActive(active);
  if (!active) {
    for (const release of state.loadingActivityWaiters) release();
  }
}

function waitForVisiblePaint() {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(resolve));
  });
}

async function holdSentenceTransition() {
  // A preloaded, inactive controller must become ready without waiting for a
  // resume call that the shell cannot send until its mount has completed. If
  // activity changes during the cosmetic hold, let readiness finish as well.
  if (!robotLoadingActive()) return;
  let release;
  const inactive = new Promise((resolve) => { release = resolve; });
  state.loadingActivityWaiters.add(release);
  try {
    await Promise.race([state.loadingScreen?.minimumVisible(MIN_SENTENCE_TRANSITION_MS), inactive]);
  } finally {
    state.loadingActivityWaiters.delete(release);
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
      state.loadingScreen?.show();
      syncRobotLoadingActivity();
      window.requestAnimationFrame(() => {
        if (state.busy && !loading.hidden) loading.classList.add("is-visible");
      });
    } else if (immediate) {
      loading.classList.remove("is-visible");
      state.loadingScreen?.hide();
    } else {
      loading.classList.remove("is-visible");
      state.loadingHideTimerId = window.setTimeout(() => {
        state.loadingHideTimerId = 0;
        if (state.busy || loading.classList.contains("is-visible")) return;
        state.loadingScreen?.hide();
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

  const sourceLanguage = providerContext.session.course?.sourceLanguage || {};
  const targetLanguage = providerContext.session.course?.targetLanguage || {};
  const sourceLang = String(sourceLanguage.locale || sourceLanguage.id || "").trim();
  const targetLang = String(targetLanguage.locale || targetLanguage.id || "").trim();
  const sourceDirection = sourceLanguage.direction === "rtl" ? "rtl" : "ltr";
  const targetDirection = targetLanguage.direction === "rtl" ? "rtl" : "ltr";

  trail.replaceChildren(...state.history.slice(0, 6).map((item) => {
    const li = document.createElement("li");
    const base = document.createElement("b");
    const target = document.createElement("span");
    base.className = "word-net-trail-base";
    target.className = "word-net-trail-target";
    base.textContent = item.en || localTranslation(item.sentence, item.word);
    target.textContent = item.sentence;
    if (sourceLang) base.setAttribute("lang", sourceLang);
    if (targetLang) target.setAttribute("lang", targetLang);
    base.setAttribute("dir", sourceDirection);
    target.setAttribute("dir", targetDirection);
    li.append(base, target);
    return li;
  }));
}

async function rankedSceneCandidates(englishText) {
  const text = String(englishText || "").trim();
  if (!text) return [];
  try {
    const response = await searchSceneImages(text, { sourceKind: "image_asset" });
    return (Array.isArray(response?.rows) ? response.rows : [])
      .filter(row => row.sourceKind === "image_asset")
      .slice(0, SCENE_ASSET_LIMIT)
      .map((row) => ({
        assetPath: row.path,
        description: row.description || "Caatuu scene",
        score: Number(row.score || 0),
        semanticScore: response.mode === "embedding" ? Number(row.score || 0) : 0,
        lexicalScore: response.mode === "lexical" ? Number(row.score || 0) : 0
      }))
      .filter((row) => isMiscellaneousAssetPath(row.assetPath));
  } catch (error) {
    // An unavailable image service does not alter or block the learning round.
  }
  return [];
}

function syncImageControl() {
  const button = $("#wordNetImageToggle");
  const scene = $("#wordNetScene");
  if (scene) scene.dataset.illustrations = String(state.imagesEnabled);
  if (!button) return;
  const label = interfaceText(state.imagesEnabled ? "verbnebula.hints.hide" : "verbnebula.hints.show");
  button.setAttribute("aria-pressed", String(state.imagesEnabled));
  button.setAttribute("aria-label", label);
  button.title = label;
  button.classList.toggle("is-active", state.imagesEnabled);
}

function toggleSceneImage() {
  state.imagesEnabled = !state.imagesEnabled;
  syncImageControl();
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
      if (scene?.query) englishText = scene.query;
    }
    let candidates = await Promise.race([
      rankedSceneCandidates(englishText),
      sceneDelay(Math.min(SCENE_CANDIDATE_SEARCH_TIMEOUT_MS, sceneTimeRemaining(deadline)), null)
    ]);
    if (requestId !== state.sceneRequestId) return false;
    if (!Array.isArray(candidates)) candidates = [];
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
            onStatus?.(interfaceText("wordworld.translation.generating", {
              language: sourceLanguageLabel
            }));
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

  setStatus(interfaceText("wordworld.translation.preparingbefore", {
    language: sourceLanguageLabel
  }), { tone: "active" });
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
  setStatus(interfaceText("wordworld.translation.preparing", {
    language: sourceLanguageLabel
  }), { tone: "active" });
  try {
    const englishSentence = await translateCurrentSentence(sentence, target, { signal: controller.signal });
    if (requestId !== state.phraseRequestId || sentence !== state.currentSentence) return;
    void updateSceneAsset(englishSentence);
    setStatus(playInstruction(), { tone: "muted" });
  } catch (error) {
    if (isAbortError(error)) return;
    if (requestId === state.phraseRequestId && sentence === state.currentSentence) {
      setStatus(interfaceText("wordworld.translation.failed", {
        language: sourceLanguageLabel
      }), { tone: "error" });
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
  const currentRecord = typeof providerContext?.sessionRecord === "function"
    ? providerContext.sessionRecord(state.currentEntryId)
    : null;
  const preparedTokens = Array.isArray(currentRecord?.target?.tokens) ? currentRecord.target.tokens : [];
  if (!tokens.length) {
    const empty = document.createElement("p");
    empty.className = "word-net-empty";
    empty.textContent = interfaceText("wordworld.sentence.preparing", {
      language: targetLanguageLabel
    });
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
    replaceTargetText(button, token.text, {
      record: currentRecord,
      token: preparedTokens[wordIndex] || token,
      tokenIndex: wordIndex
    });
    button.dataset.word = normalizeWord(token.text);
    button.dataset.tokenIndex = String(wordIndex);
    const curriculumFocused = Number(curriculumFocus?.tokenIndex) === wordIndex
      && wordMatchesTarget(button.dataset.word, curriculumFocus?.normalized);
    const label = curriculumFocused
      ? interfaceText("wordworld.word.curriculumfocus", { word: token.text })
      : interfaceText("wordworld.word.selectmeaning", { word: token.text });
    button.setAttribute("aria-label", label);
    const selected = wordMatchesTarget(button.dataset.word, selectedWord)
      && (state.selectedTokenIndex === null || state.selectedTokenIndex === wordIndex);
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
  const conceptId = String(record?.conceptId || record?.id || "").trim();
  const englishAuditText = String(record?.englishAuditText || "").normalize("NFC").trim();
  const targetText = String(record?.cs || record?.targetText || "").normalize("NFC").trim();
  if (!semanticLearning || !conceptId || !englishAuditText || !targetText) return;
  const corpusVersion = String(provider?.corpusVersion || "1");
  void semanticLearning.recordAttempt({
    activityId: "word-world",
    itemId: `word-world:${course.id}:${corpusVersion}:${conceptId}`,
    item: {
      courseId: course.id,
      conceptId,
      corpusVersion,
      targetText,
      targetLanguageTag: targetLocale,
      englishAuditText,
      difficulty: record.difficulty,
      cefr: record.cefr,
      topic: record.topic,
      grammar: record.grammar,
      learning: record.learning
    },
    signals: [{
      conceptId,
      statementRevision: corpusVersion,
      kind: "meaning",
      locale: "en",
      text: `Builds familiarity with a target expression whose English meaning is: “${englishAuditText}”`,
      score: null,
      coverageWeight: 0.25,
      masteryWeight: 0
    }],
    context: {
      outcome: "exposure",
      contentMode: "standard",
      targetWord,
      courseId: course.id,
      targetLanguageTag: targetLocale,
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
  renderTrail();
}

async function showPreviousSentence() {
  if (state.guidedRequested) {
    setStatus(interfaceText("wordworld.history.guideddisabled"), { tone: "muted" });
    return;
  }
  if (state.busy) return;
  if (shouldBlockReconstructionAdvance()) return;
  const previousIndex = state.historyCursor + 1;
  const previous = state.history[previousIndex];
  if (!previous) {
    setStatus(interfaceText("wordworld.history.none"), { tone: "muted" });
    return;
  }

  const transitionStartedAt = performance.now();
  cancelBackgroundWork();
  state.generativeTurnActive = false;
  const requestId = state.phraseRequestId + 1;
  state.phraseRequestId = requestId;
  hideSceneAsset({ cancel: true });
  setBusy(true);
  setStatus(interfaceText("wordworld.history.restoring"), { tone: "active" });
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
      setStatus(interfaceText("wordworld.history.standardrestored"), { tone: "muted" });
    } else {
      if (state.translationMode !== "off" && !state.selectedWordMeaning && !state.wordMeaningLoading) {
        void lookupSelectedWord(previous.word);
      }
    setStatus(previous.en
        ? interfaceText("wordworld.history.restored")
        : interfaceText("wordworld.history.restoredwithoutbase", {
            language: sourceLanguageLabel
          }), { tone: "muted" });
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
    toggle.textContent = interfaceText("wordworld.report.action");
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
    setStatus(interfaceText("wordworld.queue.readyfor", { word: target }), { tone: "active" });
    await presentPreparedCandidate(target, queued, transitionStartedAt);
    return;
  }

  const transitionStartedAt = performance.now();
  setBusy(true);
  renderCzechSentence(state.currentSentence, target);

  const firstRun = source === "initial" || source === "seed";
  setStatus(firstRun
    ? interfaceText("wordworld.generative.generating", { language: targetLanguageLabel })
    : interfaceText("wordworld.generative.generatingfrom", { word: target }), { tone: "active" });

  try {
    const candidate = await requestSentenceCandidate(target, {
      onEvent(message) {
        if (message.kind === "progress") {
          setProgress(message);
        } else if (message.kind === "status") {
          setStatus(interfaceText("wordworld.generative.generatinglocal"), { tone: "active" });
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
    console.error("Word World local generation failed", error);
    setStatus(interfaceText("wordworld.generative.failed"), { tone: "error" });
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
    setStatus(playInstruction(), { tone: "muted" });
    schedulePrefetch(sentence);
  } else if (candidate?.translation) {
    cacheTranslation(sentence, candidate.translation);
    setTranslation(candidate.translation);
    sceneText = candidate.translation;
    setStatus(playInstruction(), { tone: "muted" });
    if (!state.selectedWordMeaning && !state.wordMeaningLoading) void lookupSelectedWord(target);
    schedulePrefetch(sentence);
  } else {
    const fallbackEnglish = localTranslation(sentence, target);
    setTranslation(fallbackEnglish);
    sceneText = fallbackEnglish;
    setStatus(playInstruction(), { tone: "muted" });
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
  if (status) status.textContent = interfaceText("wordworld.report.saving");
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
        toggle.textContent = interfaceText("wordworld.report.savedaction");
        toggle.disabled = true;
      }
      if (status) {
        status.textContent = queued.persisted === false
          ? interfaceText("wordworld.report.sessiononly")
          : interfaceText("wordworld.report.savedlocal");
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
          status.textContent = interfaceText("wordworld.report.sent");
        }
      }).catch(() => {});
    }
  } catch (error) {
    if (
      phraseRequestId === state.phraseRequestId &&
      snapshot.sentence === state.currentSentence &&
      status
    ) {
      status.textContent = interfaceText("wordworld.report.savefailed");
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
  $("#wordNetImageToggle")?.addEventListener("click", toggleSceneImage);
  syncImageControl();
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
    const targetTextOption = event.target.closest("button[data-target-text-setting]");
    if (targetTextOption) {
      toggleTargetTextPreference(targetTextOption.dataset.targetTextSetting);
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
    const promptButton = event.target.closest("[data-challenge-prompt-mode]");
    if (promptButton && !promptButton.disabled) {
      setChallengePromptMode(promptButton.dataset.challengePromptMode);
      return;
    }
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
    selectWord(button.dataset.word, {
      userInitiated: true,
      tokenIndex: Number(button.dataset.tokenIndex)
    });
    setStatus(state.guidedMode
      ? interfaceText("wordworld.word.guidedsupport", { word: button.dataset.word })
      : interfaceText("wordworld.word.selected", { word: button.dataset.word }), { tone: "muted" });
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
    syncRobotLoadingActivity();
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
  window.addEventListener("pagehide", () => {
    state.loadingPageHidden = true;
    syncRobotLoadingActivity();
    cancelCzechSpeech();
  });
  window.addEventListener("pageshow", () => {
    state.loadingPageHidden = false;
    syncRobotLoadingActivity();
  });
  window.addEventListener("caatuu:learning-change", (event) => {
    if (event.detail?.reason === "progress-reset" && state.guidedRequested) {
      void restartGuidedWordWorldAfterReset();
      return;
    }
    if (event.detail?.reason !== "difficulty") return;
    // Retire prepared and in-flight turns from the previous level. The next
    // selection reads the new difficulty without clearing earned progress.
    state.phraseRequestId += 1;
    clearTranslationTimer();
    cancelBackgroundWork();
    state.branchQueue.restore([]);
    savePreparedQueue();
    setBusy(false);
    if (state.contentMode === "standard" && !state.guidedRequested) {
      void generateStandardFromConfiguredMode("random");
    }
    const pace = czechSpeechPace();
    cancelCzechSpeech();
    syncDiagnostics();
    setStatus(
      pace.source === "override"
        ? interfaceText("speech.pace.difficultymanual", {
            level: pace.badge,
            language: targetLanguageLabel,
            speed: speechPaceLabel(pace)
          })
        : interfaceText("speech.pace.difficultychanged", {
            level: pace.badge,
            language: targetLanguageLabel,
            speed: speechPaceLabel(pace)
          }),
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
  setStatus(playInstruction());
  if (!state.guidedRequested) hydrateQueueFromHistory();
  if (state.guidedRequested) {
    setBusy(true);
    if (!state.guidedMode) {
      setStatus(interfaceText("wordworld.guided.contractlocked"), { tone: "error" });
      renderWordGuidedStatus();
      setBusy(false);
      return;
    }
    setStatus(interfaceText("wordworld.guided.developerpreparing"), { tone: "active" });
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
    setStatus(interfaceText("wordworld.standard.packpreparing"), { tone: "active" });
    try {
      await initializeStandardCorpus();
      await generateStandardFromConfiguredMode("random", { allowBusy: true });
    } finally {
      if (state.busy) setBusy(false);
    }
  } else {
    state.generativeTurnActive = false;
    if (!(await restoreSavedGenerativePhraseAtInit())) {
      setStatus(interfaceText("wordworld.generative.ready"), { tone: "muted" });
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
  const feedbackReason = root.querySelector("#wordNetFeedbackReason");
  const wrongTranslation = [...(feedbackReason?.children || [])].find((option) => (
    option.getAttribute?.("value") === "wrong_translation"
  ));
  if (wrongTranslation) {
    wrongTranslation.textContent = sourceTranslationFeedbackLabel(course.sourceLanguage);
  }
}

function applyTargetContentLanguage(root) {
  const target = providerContext.session.course?.targetLanguage || {};
  const lang = String(target.locale || target.id || "").trim();
  const requestedDirection = String(target.direction || providerContext.adapter?.direction || "ltr").trim();
  const direction = requestedDirection === "rtl" ? "rtl" : "ltr";
  for (const selector of ["#wordNetSentence", "#wordNetSelectedWord"]) {
    const node = root.querySelector(selector);
    if (!node) continue;
    if (lang) node.setAttribute("lang", lang);
    node.setAttribute("dir", direction);
  }
}

function applyWordWorldCapabilities(root) {
  const capabilities = providerContext.session.course?.capabilities || {};
  const generationSupported = capabilities.llm === true
    && capabilities.generation === true
    && Boolean(providerContext.generationStrategy);
  for (const node of root.querySelectorAll('[data-content-mode="generative"]')) {
    node.hidden = !generationSupported;
    node.disabled = !generationSupported;
    node.setAttribute("aria-hidden", String(!generationSupported));
  }
  const generativeDialog = root.querySelector("#wordNetGenerativeDialog");
  if (generativeDialog) generativeDialog.hidden = !generationSupported;
  const speechAvailable = capabilities.speech === true;
  for (const id of ["#wordNetPhraseSound", "#wordNetSelectedWordSound"]) {
    const node = root.querySelector(id);
    if (node) node.hidden = !speechAvailable;
  }
  const audioMenu = root.querySelector("#wordNetAudioMenu");
  if (!speechAvailable) audioMenu?.querySelectorAll("[data-voice-controls], .caatuu-audio-speed, .caatuu-audio-extras").forEach((node) => { node.hidden = true; });
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
  const generationEnabled = value.session.course?.capabilities?.generation === true;
  if (generationEnabled !== Boolean(value.generationStrategy)) {
    throw new Error(
      generationEnabled
        ? "Word World generation is unavailable without an explicit course-owned versioned strategy."
        : "A Word World generation strategy cannot be mounted while generation is disabled."
    );
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

  WORD_NET_MODEL_KEY = context.generationStrategy?.sentenceModelKey || "";
  TRANSLATION_MODEL_KEY = context.generationStrategy?.translationModelKey || "";
  mountRoot = root;
  state.loadingActive = !root.closest?.("[data-train-panel]")?.hidden;
  state.loadingScreen = mountRobotLoadingScreen({
    container: root.querySelector("#wordNetLoading"),
    label: interfaceText("verbnebula.round.preparing"),
    active: robotLoadingActive()
  });
  providerContext = context;
  state.targetTextPreferences = loadTargetTextPreferences(context.targetTextGuide?.defaults);
  lifecycleOptions = Object.freeze({ ...options });
  mounted = true;
  state.contentMode = loadContentMode();
  if (!hasContentMode(state.contentMode)) state.contentMode = "standard";
  state.generationMode = loadGenerationMode();
  state.challengePromptMode = loadChallengePromptMode();
  applyTargetLanguageLabels(root);
  applyTargetContentLanguage(root);
  applyWordWorldCapabilities(root);

  try {
    await init();
    notifyHost("ready", { courseId: course.id });
  } catch (error) {
    state.loadingScreen?.destroy();
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
      state.loadingActive = false;
      syncRobotLoadingActivity();
      cancelCzechSpeech();
      suspendStarterWordPresentation();
    },
    resume() {
      state.loadingActive = true;
      syncRobotLoadingActivity();
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
