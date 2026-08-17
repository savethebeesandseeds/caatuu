let countryDictionary = [];
let countryDictionaryBytes = new Uint8Array();
let countryScripts = [];
let verbNebulaCore = null;
let verbExerciseFamilyCore = null;
let childFacingAssets = null;
let deferredPwaInstallPrompt = null;
let lastAppSettingsTrigger = null;
let nativeUpdateStatus = null;
const course = window.CaatuuCourse;
if (!course) throw new Error("Caatuu course profile must load before the app shell.");

const themeStorageKey = course.storage.theme;
const themeOptions = {
  light: { themeColor: "#f5efe5" },
  dark: { themeColor: "#151a18" }
};
const chatSettingsStorageKey = course.storage.chatSettings;
const verbSpeakOnTapStorageKey = `${course.storage.namespace}.verbNebula.speakOnTap.v1`;
const defaultModelKey = "cstinyllama-1.2b-czech-word-sentence-001";
const browserFallbackModel = "Qwen3-0.6B-q4f16_1-MLC";
const browserFallbackLabel = "Browser fallback";
const browserFallbackSummary = `Browser: ${browserFallbackModel}. Android: local GGUF models.`;
const legacyModelNotice = "Legacy/deprecated: kept for compatibility until the curriculum LoRA GGUF replacements are published.";
const supportedModelKeys = new Set([
  "cstinyllama-1.2b-base",
  "cstinyllama-1.2b-translation-cs-en-001",
  "qwen3-1.7b-translation-cs-en-001",
  "cstinyllama-1.2b-czech-word-sentence-001"
]);
const wordWorldStandardArtifact = Object.freeze({
  key: "caatuu-word-world-standard-v0.1",
  label: "Word World Standard Corpus",
  sourceLabel: "Caatuu-authored and Codex-authored reviewed bilingual learning sentences",
  sourceUrl: "data/games/word-world/manifest.json",
  license: "MIT source license",
  intendedUse: "Standard Word World guided offline sentences. Corpus standard-v0.1 · 792 rows · L1 175 · L2 565 · L3 52 · codex_reviewed · humanApproved=false.",
  artifactKind: "guided-learning-corpus",
  runtime: "Compiled bilingual JSON data pack",
  status: "active",
  entryCount: 792,
  usageScope: "standard_word_world_offline"
});

let modelLicenseCatalog = [
  {
    key: "qwen3-lora-003-hard",
    label: "Caatuu CZ LoRA",
    repoId: "Qwen/Qwen3-1.7B",
    license: "Base Apache-2.0; derived artifact review pending",
    intendedUse: "General Czech assistant and spelling checks.",
    deprecated: true,
    status: "deprecated",
    replacementStatus: "Pending curriculum LoRA GGUF publication."
  },
  {
    key: "cstinyllama-1.2b-base",
    label: "CSTinyLlama CZ Base",
    repoId: "BUT-FIT/CSTinyLlama-1.2B",
    license: "Apache-2.0",
    intendedUse: "Czech-native game/example generation experiments.",
    deprecated: true,
    status: "deprecated",
    replacementStatus: "Keep only as an unfine-tuned baseline."
  },
  {
    key: "cstinyllama-1.2b-planet-wordnet-002-copy",
    label: "Planet Word World CZ",
    repoId: "BUT-FIT/CSTinyLlama-1.2B",
    license: "Base Apache-2.0; derived artifact review pending",
    intendedUse: "Planet of Word World: generate one natural Czech sentence using the selected word or a natural Czech inflection of it.",
    deprecated: true,
    status: "deprecated",
    replacementStatus: "Pending curriculum word-sentence LoRA GGUF publication."
  },
  {
    key: "cstinyllama-1.2b-translation-cs-en-001",
    label: "Czech to English (CSTinyLlama)",
    repoId: "BUT-FIT/CSTinyLlama-1.2B",
    license: "Base Apache-2.0; derived artifact review pending",
    intendedUse: "Translate one simple Czech sentence into simple English for Caatuu learning activities.",
    deprecated: true,
    status: "deprecated",
    replacementStatus: "Replaced by qwen3-1.7b-translation-cs-en-001."
  },
  {
    key: "qwen3-1.7b-translation-cs-en-001",
    label: "Czech to English Qwen",
    repoId: "Qwen/Qwen3-1.7B",
    license: "Base Apache-2.0; derived artifact review pending",
    intendedUse: "Translate one simple Czech sentence into simple English for Caatuu learning activities.",
    deprecated: false,
    status: "active",
    replacementStatus: ""
  },
  {
    key: "cstinyllama-1.2b-czech-word-sentence-001",
    label: "Word Sentence CZ",
    repoId: "BUT-FIT/CSTinyLlama-1.2B",
    license: "Base Apache-2.0; derived artifact review pending",
    intendedUse: "Given one Czech target word, generate one short ordinary Czech sentence for Planet of Word World.",
    deprecated: false,
    status: "active",
    replacementStatus: ""
  },
  {
    key: "caatuu-local-hash-v0.1",
    label: "Caatuu Curriculum and Asset Embeddings",
    sourceLabel: "Caatuu curated curriculum corpus and manual image descriptions",
    sourceUrl: "data/embeddings/README.md",
    license: "Curriculum and asset provenance review pending",
    licenseUrl: "",
    intendedUse: "Local curriculum retrieval, duplicate review, game selection, distractor search, and manually described image asset lookup.",
    artifactKind: "embedding-vector-db",
    runtime: "SQLite vector database with local hash embedder",
    embeddingTextField: "english_text",
    embeddingInputPolicy: "english_text_only"
  },
  wordWorldStandardArtifact
];
const generationPresets = {
  fast: {
    label: "Fast",
    thinking: false,
    maxTokens: 160,
    temperature: 0,
    contextSize: 1024,
    reasoningDisplay: "hidden",
    summary: "Short answers, no requested thinking, smallest practical context."
  },
  chat: {
    label: "Chat",
    thinking: false,
    maxTokens: 384,
    temperature: 0.2,
    contextSize: 2048,
    reasoningDisplay: "collapsed",
    summary: "Good default for Czech chat and spelling checks."
  },
  careful: {
    label: "Careful",
    thinking: true,
    maxTokens: 768,
    temperature: 0.2,
    contextSize: 4096,
    reasoningDisplay: "collapsed",
    summary: "Longer answers with requested reasoning where the runtime supports it."
  }
};
const defaultGenerationSettings = {
  modelKey: defaultModelKey,
  preset: "chat",
  ...generationPresets.chat
};
let generationSettings = loadStoredGenerationSettings();

async function loadJson(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Could not load ${path}: ${response.status}`);
  return response.json();
}

async function loadJsonBytes(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Could not load ${path}: ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  return { bytes, value: JSON.parse(text) };
}

function assertArrayData(name, value) {
  if (!Array.isArray(value)) throw new Error(`Expected ${name} to be an array.`);
}

async function loadContentData() {
  const [dictionarySource, scripts, verbModule, familyModule, childFacingAssetModule] = await Promise.all([
    loadJsonBytes("data/games/verb-nebula/core-vocabulary.json"),
    loadJson("data/language/scripts.json"),
    import("./verb-nebula-core.mjs?v=verb-nebula-core-10"),
    import("./verb-exercise-family-core.mjs?v=verb-exercise-family-core-2"),
    import("../../shared/child-facing-assets.mjs?v=child-facing-assets-1")
  ]);

  assertArrayData("dictionary", dictionarySource.value);
  assertArrayData("scripts", scripts);
  countryDictionaryBytes = dictionarySource.bytes;
  countryDictionary = dictionarySource.value;
  countryScripts = scripts;
  verbNebulaCore = verbModule;
  verbExerciseFamilyCore = familyModule;
  childFacingAssets = childFacingAssetModule;
}

const state = {
  activeView: "home",
  trainTab: "galaxy",
  campaignActive: false,
  campaignQueue: [],
  campaignTransitioning: false,
  campaignTransitionId: 0,
  campaignRobotCursor: -1,
  campaignRobotPathsPromise: null,
  verbDifficulty: 1,
  verbPairs: [],
  verbQueueIds: [],
  verbRound: [],
  verbEnglishRound: [],
  verbMatchedIds: new Set(),
  verbSelectedCzechId: "",
  verbSelectedEnglishId: "",
  verbPairCount: 4,
  verbSpeakOnTap: loadVerbSpeakOnTap(),
  verbRoundNumber: 0,
  verbStats: { attempts: 0, matches: 0, rounds: 0 },
  verbMemoryLoaded: false,
  verbHintRequestId: 0,
  verbHintCache: new Map(),
  verbHintKeymapPromise: null,
  verbHintById: new Map(),
  verbHintsEnabled: false,
  verbSolutionRevealed: false,
  verbRoundTransitioning: false,
  verbRoundInterstitial: false,
  verbRoundRewardXp: 0,
  verbRoundTransitionId: 0,
  verbSolutionAdvanceTimer: null,
  verbInterstitialRobotPath: "",
  verbRobotPathsPromise: null,
  verbRobotCursor: -1,
  verbWrongIds: new Set(),
  verbWrongTimer: null,
  verbGuidedRequested: false,
  verbGuidedMode: false,
  verbGuidedStatus: "off",
  verbGuidedError: "",
  verbGuidedPlan: null,
  verbGuidedTargetId: "",
  verbGuidedResolution: null,
  verbGuidedLifecycle: null,
  verbGuidedActivationPromise: null,
  verbGuidedActivationEpoch: 0,
  verbGuidedEvidencePending: false,
  verbGuidedCatalog: [],
  verbGuidedTargetPair: null,
  verbGuidedContrastPairs: [],
  verbGuidedSupportAtFirstResponse: false,
  verbProgressResetPending: false,
  verbGuidedOperations: new Set(),
  dictionarySection: "rules",
  coreDictionarySearch: "",
  dictionaryBrowseAll: false
};

const $ = (selector) => document.querySelector(selector);

function setText(selector, value) {
  const node = $(selector);
  if (node) node.textContent = value;
}

function explicitLocalGuidedRequest() {
  // The retired developer mode cannot replace Verb Nebula's normal round.
  return false;
}

function verbMeaningExerciseFamilyConfiguration() {
  return null;
}

function confirmDestructiveAction(button, options = {}) {
  if (window.CaatuuChrome?.confirmButtonPress) {
    return window.CaatuuChrome.confirmButtonPress(button, options);
  }
  return window.confirm(options.message || "Continue?");
}

function runtimeAdapter() {
  if (!window.CaatuuRuntime) throw new Error("Caatuu runtime adapter is not available.");
  return window.CaatuuRuntime;
}

function hasNativeRuntime() {
  return window.CaatuuRuntime?.env === "android";
}

function maintenanceUi() {
  if (!window.CaatuuMaintenanceUi) throw new Error("Caatuu maintenance UI helper is not available.");
  return window.CaatuuMaintenanceUi;
}

function renderModelLicenseList() {
  const list = $("#modelLicenseList");
  if (!list) return;
  list.replaceChildren(...modelLicenseCatalog.map((model) => {
    const row = document.createElement("div");
    const term = document.createElement("dt");
    const detail = document.createElement("dd");
    const licenseUrl = model.licenseUrl || "";
    const licenseNode = document.createElement(licenseUrl ? "a" : "span");

    term.textContent = model.deprecated ? `${model.label} (legacy)` : model.label;
    const source = document.createElement("span");
    source.className = "license-source";
    if (model.repoId) {
      const repoLink = document.createElement("a");
      repoLink.href = `https://huggingface.co/${model.repoId}`;
      repoLink.rel = "noopener";
      repoLink.textContent = model.repoId;
      source.append(repoLink);
    } else if (model.sourceUrl) {
      const sourceLink = document.createElement("a");
      sourceLink.href = model.sourceUrl;
      sourceLink.rel = "noopener";
      sourceLink.textContent = model.sourceLabel || model.key;
      source.append(sourceLink);
    } else {
      source.textContent = model.sourceLabel || model.key;
    }
    if (licenseUrl) {
      licenseNode.href = licenseUrl;
      licenseNode.rel = "noopener";
    }
    licenseNode.textContent = modelLicenseDisplay(model);

    detail.append(source, " · ", licenseNode);
    if (model.status) detail.append(" · ", model.status);
    if (model.direction) detail.append(" · ", model.direction.replace("-", " → ").toUpperCase());
    if (model.entryCount) detail.append(" · ", `${Number(model.entryCount).toLocaleString()} entries`);
    if (model.embeddingTextField) detail.append(" · ", `embeds ${model.embeddingTextField}`);
    if (model.usageScope) detail.append(" · ", model.usageScope.replaceAll("_", " "));
    if (model.intendedUse) {
      const note = document.createElement("small");
      note.className = "artifact-license-note";
      note.textContent = model.intendedUse;
      detail.append(note);
    }
    row.append(term, detail);
    return row;
  }));
  setText("#licenseMetaSummary", `${modelLicenseCatalog.length} artifacts, separate terms`);
}

function modelLicenseDisplay(model) {
  const recordedLicense = model.license || "Review pending";
  if (model.adapter) return `Base model: ${recordedLicense}; derived artifact review pending`;
  if (model.artifactKind === "embedding-vector-db") {
    return `Embedding model: ${recordedLicense}; embedded content reviewed separately`;
  }
  return recordedLicense;
}

function normalizeCatalogModel(model) {
  return {
    key: model.key,
    label: model.label || model.key,
    shortLabel: model.short_label || model.shortLabel || model.label || model.key,
    repoId: model.repo_id || "",
    license: model.license || "Review pending",
    adapter: model.adapter || "",
    intendedUse: model.intended_use || "",
    supportsThinking: Boolean(model.supports_thinking || model.supportsThinking),
    modelFile: model.model_file || model.modelFile || "",
    format: model.format || "",
    runtime: model.runtime || "",
    artifactKind: model.artifact_kind || model.artifactKind || "",
    deprecated: Boolean(model.deprecated),
    status: model.status || "active",
    replacementStatus: model.replacement_status || "",
    sourceLabel: model.source_label || "",
    sourceUrl: model.source_url || "",
    licenseUrl: model.license_url || "",
    direction: model.direction || "",
    entryCount: Number(model.entry_count || model.entryCount || 0),
    senseCount: Number(model.sense_count || model.senseCount || 0),
    usageScope: model.usage_scope || model.usageScope || "",
    notes: Array.isArray(model.notes) ? model.notes : []
  };
}

async function loadModelLicenseCatalog() {
  const runtime = runtimeAdapter();
  const nextCatalog = [];
  const modelCatalog = await runtime.models.catalog();
  if (Array.isArray(modelCatalog.models)) {
    modelCatalog.models.forEach((model) => {
      if (model.key) supportedModelKeys.add(model.key);
    });
    nextCatalog.push(...modelCatalog.models.map(normalizeCatalogModel));
  }

  try {
    const embeddingCatalog = await runtime.models.embeddingCatalog();
    if (Array.isArray(embeddingCatalog.models)) {
      nextCatalog.push(...embeddingCatalog.models.map((model) => ({
        ...normalizeCatalogModel(model),
        artifactKind: model.artifact_kind || "",
        embeddingTextField: model.embedding_text_field || "",
        embeddingInputPolicy: model.embedding_input_policy || ""
      })));
    }
  } catch (error) {
    // Model metadata is enough for settings if browser embedding metadata is unavailable.
  }

  try {
    const dictionaryCatalog = await loadJson("data/dictionaries/catalog.json");
    if (Array.isArray(dictionaryCatalog.dictionaries)) {
      nextCatalog.push(...dictionaryCatalog.dictionaries.map(normalizeCatalogModel));
    }
  } catch (error) {
    // Missing dictionary metadata should not prevent the settings screen from opening.
  }

  if (nextCatalog.length) {
    const runtimeArtifactKeys = new Set(nextCatalog.map((artifact) => artifact.key));
    modelLicenseCatalog = runtimeArtifactKeys.has(wordWorldStandardArtifact.key)
      ? nextCatalog
      : [...nextCatalog, wordWorldStandardArtifact];
  }
  generationSettings = normalizeGenerationSettings(generationSettings);
}

function modelSummary(model) {
  if (!model) return "General Czech assistant and spelling checks.";
  return [
    model.intendedUse,
    model.deprecated ? legacyModelNotice : "",
    model.replacementStatus ? `Replacement: ${model.replacementStatus}` : ""
  ].filter(Boolean).join(" ");
}

function clampNumber(value, min, max, fallback) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function loadStoredGenerationSettings() {
  try {
    const raw = localStorage.getItem(chatSettingsStorageKey);
    if (!raw) return { ...defaultGenerationSettings };
    return normalizeGenerationSettings(JSON.parse(raw));
  } catch (error) {
    return { ...defaultGenerationSettings };
  }
}

function normalizeGenerationSettings(input = {}) {
  const modelKey = supportedModelKeys.has(input.modelKey) ? input.modelKey : defaultModelKey;
  const preset = Object.prototype.hasOwnProperty.call(generationPresets, input.preset) ? input.preset : "chat";
  const base = generationPresets[preset];
  const maxTokens = Number(input.maxTokens ?? base.maxTokens);
  const temperature = Number(input.temperature ?? base.temperature);
  const contextSize = Number(input.contextSize ?? base.contextSize);
  const reasoningDisplay = ["collapsed", "expanded", "hidden"].includes(input.reasoningDisplay)
    ? input.reasoningDisplay
    : base.reasoningDisplay;

  return {
    modelKey,
    preset,
    label: base.label,
    summary: base.summary,
    thinking: Boolean(input.thinking ?? base.thinking),
    maxTokens: clampNumber(maxTokens, 64, 1024, base.maxTokens),
    temperature: clampNumber(temperature, 0, 1, base.temperature),
    contextSize: clampNumber(contextSize, 768, 8192, base.contextSize),
    reasoningDisplay
  };
}

function saveGenerationSettings() {
  try {
    localStorage.setItem(chatSettingsStorageKey, JSON.stringify({
      modelKey: generationSettings.modelKey,
      preset: generationSettings.preset,
      thinking: generationSettings.thinking,
      maxTokens: generationSettings.maxTokens,
      temperature: generationSettings.temperature,
      contextSize: generationSettings.contextSize,
      reasoningDisplay: generationSettings.reasoningDisplay
    }));
  } catch (error) {
    // Settings still apply for the current page when storage is unavailable.
  }
}

function setGenerationSettings(next, { persist = true } = {}) {
  generationSettings = normalizeGenerationSettings({ ...generationSettings, ...next });
  syncGenerationSettingsUi();
  if (persist) saveGenerationSettings();
}

function applyGenerationPreset(preset) {
  const settings = generationPresets[preset];
  if (!settings) return;
  setGenerationSettings({ preset, ...settings });
}

function readGenerationSettingsControls() {
  const thinking = $("#thinkingEnabled");
  const maxTokens = $("#maxTokens");
  const temperature = $("#temperature");
  const contextSize = $("#contextSize");
  const reasoningDisplay = $("#reasoningDisplay");
  const settingsModel = $("#settingsModel");
  if (!thinking || !maxTokens || !temperature || !contextSize || !reasoningDisplay) return;

  setGenerationSettings({
    modelKey: hasNativeRuntime() ? (settingsModel?.value || generationSettings.modelKey) : generationSettings.modelKey,
    thinking: thinking.checked,
    maxTokens: Number(maxTokens.value),
    temperature: Number(temperature.value),
    contextSize: Number(contextSize.value),
    reasoningDisplay: reasoningDisplay.value
  });
}

function generationModelCatalog() {
  return modelLicenseCatalog.filter((model) =>
    (model.modelFile || supportedModelKeys.has(model.key)) &&
    model.status === "active" &&
    !model.deprecated &&
    model.artifactKind !== "embedding-vector-db" &&
    model.format !== "sqlite"
  );
}

function displayModelLabel(model) {
  const label = model.shortLabel || model.label || model.key;
  return model.deprecated ? `${label} (legacy)` : label;
}

function syncSettingsModelOptions() {
  const settingsModel = $("#settingsModel");
  if (!settingsModel) return;

  if (!hasNativeRuntime()) {
    const option = document.createElement("option");
    option.value = browserFallbackModel;
    option.textContent = `${browserFallbackLabel} (${browserFallbackModel})`;
    settingsModel.replaceChildren(option);
    settingsModel.value = browserFallbackModel;
    settingsModel.disabled = true;
    settingsModel.title = "Browser WebGPU mode cannot load the Android GGUF models.";
    return;
  }

  const models = generationModelCatalog();
  settingsModel.disabled = false;
  settingsModel.title = "";
  settingsModel.replaceChildren(
    ...models.map((model) => {
      const option = document.createElement("option");
      option.value = model.key;
      option.textContent = displayModelLabel(model);
      if (model.deprecated) {
        option.dataset.status = "deprecated";
        option.title = legacyModelNotice;
      }
      return option;
    })
  );
  settingsModel.value = models.some((model) => model.key === generationSettings.modelKey)
    ? generationSettings.modelKey
    : defaultModelKey;
}

function syncGenerationSettingsUi() {
  const thinking = $("#thinkingEnabled");
  const maxTokens = $("#maxTokens");
  const maxTokensValue = $("#maxTokensValue");
  const temperature = $("#temperature");
  const temperatureValue = $("#temperatureValue");
  const contextSize = $("#contextSize");
  const reasoningDisplay = $("#reasoningDisplay");
  const settingsModel = $("#settingsModel");
  if (!thinking || !maxTokens || !temperature || !contextSize || !reasoningDisplay) return;

  syncSettingsModelOptions();
  if (settingsModel && hasNativeRuntime()) settingsModel.value = generationSettings.modelKey;
  thinking.checked = generationSettings.thinking;
  maxTokens.value = String(generationSettings.maxTokens);
  if (maxTokensValue) maxTokensValue.textContent = String(generationSettings.maxTokens);
  temperature.value = String(generationSettings.temperature);
  if (temperatureValue) temperatureValue.textContent = generationSettings.temperature.toFixed(1);
  contextSize.value = String(generationSettings.contextSize);
  reasoningDisplay.value = generationSettings.reasoningDisplay;
  const selectedModel = modelLicenseCatalog.find((model) => model.key === generationSettings.modelKey);
  setText("#modelChoiceSummary", hasNativeRuntime() ? modelSummary(selectedModel) : browserFallbackSummary);
  setText("#settingsSummary", generationSettings.summary);
  updateSettingsSupport(selectedModel);

  document.querySelectorAll("[data-preset]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.preset === generationSettings.preset);
  });
}

function modelSupportsThinking(model) {
  return Boolean(model?.supportsThinking) || model?.key === "qwen3-lora-003-hard";
}

function updateSettingsSupport(model) {
  if (hasNativeRuntime()) {
    const supportsThinking = modelSupportsThinking(model);
    setText("#thinkingSupport", supportsThinking ? "Active in APK request" : "Off for selected base model");
    setText("#temperatureSupport", "APK native bridge pending");
    setText("#contextSupport", "APK native bridge pending");
    setText(
      "#capabilityNote",
      supportsThinking
        ? "APK applies max tokens and Qwen chat-template thinking now. Temperature and context are saved for the next native bridge patch."
        : "APK applies max tokens for this base model. Thinking is disabled; temperature and context are saved for the next native bridge patch."
    );
    return;
  }

  const hasWebGpu = Boolean(runtimeAdapter().capabilities.webGpu);
  setText("#thinkingSupport", hasWebGpu ? "Active in browser request" : "Browser fallback only");
  setText("#temperatureSupport", hasWebGpu ? "Active in browser request" : "Browser fallback only");
  setText("#contextSupport", hasWebGpu ? "Managed by WebLLM" : "Android native only for GGUF");
  setText(
    "#capabilityNote",
    hasWebGpu
      ? `${browserFallbackSummary} Max tokens, temperature, and thinking apply to the browser fallback only.`
      : "Install the Android app to use the local GGUF runtime on this device."
  );
}

function readStoredTheme() {
  try {
    return normalizeTheme(localStorage.getItem(themeStorageKey));
  } catch (error) {
    return "dark";
  }
}

function normalizeTheme(theme) {
  return Object.prototype.hasOwnProperty.call(themeOptions, theme) ? theme : "dark";
}

function syncThemeControls() {
  const activeTheme = document.documentElement.dataset.theme || readStoredTheme();
  document.querySelectorAll("[data-theme-option]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.themeOption === activeTheme);
  });
}

function applyTheme(theme, { persist = true } = {}) {
  const normalizedTheme = normalizeTheme(theme);
  document.documentElement.dataset.theme = normalizedTheme;
  document.documentElement.style.colorScheme = normalizedTheme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute(
    "content",
    themeOptions[normalizedTheme].themeColor
  );
  if (persist) {
    try {
      localStorage.setItem(themeStorageKey, normalizedTheme);
    } catch (error) {
      // Theme still applies for the current session when storage is unavailable.
    }
  }
  syncThemeControls();
}

function bindThemeControls() {
  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-theme-option]");
    if (!button) return;
    applyTheme(button.dataset.themeOption);
  });
}

function openSettingsPanel() {
  const panel = $("#settingsPanel");
  if (!panel) return;
  lastAppSettingsTrigger = document.activeElement;
  panel.hidden = false;
  document.body.classList.add("settings-open");
  window.CaatuuChrome?.setSettingsNavActive?.(true);
  syncThemeControls();
  syncGenerationSettingsUi();
  syncAppRuntimeControls();
}

function closeSettingsPanel({ restoreFocus = true } = {}) {
  const panel = $("#settingsPanel");
  if (!panel) return;
  panel.hidden = true;
  document.body.classList.remove("settings-open");
  window.CaatuuChrome?.setSettingsNavActive?.(false);
  if (restoreFocus && lastAppSettingsTrigger && typeof lastAppSettingsTrigger.focus === "function") {
    lastAppSettingsTrigger.focus();
  }
}

window.CaatuuHandleAndroidBack = () => {
  const panel = $("#settingsPanel");
  if (panel && !panel.hidden) {
    closeSettingsPanel({ restoreFocus: false });
    return true;
  }
  return false;
};

function isPwaInstalled() {
  return window.matchMedia?.("(display-mode: standalone)")?.matches || window.navigator.standalone === true;
}

function updatePwaInstallUi(statusText = "") {
  const button = $("#installPwaAction");
  const status = $("#pwaInstallStatus");
  const help = $("#pwaInstallHelp");
  if (!button || !status) return;

  if (hasNativeRuntime()) {
    button.hidden = true;
    button.disabled = true;
    status.textContent = "Android native";
    if (help) help.hidden = true;
    return;
  }

  button.hidden = false;

  if (isPwaInstalled()) {
    button.textContent = "Installed";
    button.disabled = true;
    status.textContent = "Offline ready";
    if (help) help.hidden = true;
    return;
  }

  button.textContent = "Browser";
  button.disabled = !window.isSecureContext && location.hostname !== "localhost" && location.hostname !== "127.0.0.1";
  status.textContent = statusText || (deferredPwaInstallPrompt ? "Installable" : "Browser");
}

async function promptPwaInstall() {
  if (!deferredPwaInstallPrompt) {
    const help = $("#pwaInstallHelp");
    if (help) help.hidden = false;
    updatePwaInstallUi("Browser");
    return;
  }

  const promptEvent = deferredPwaInstallPrompt;
  deferredPwaInstallPrompt = null;
  promptEvent.prompt();

  try {
    const choice = await promptEvent.userChoice;
    updatePwaInstallUi(choice?.outcome === "accepted" ? "Installed" : "Browser");
  } catch (error) {
    updatePwaInstallUi("Browser");
  }
}

function bindPwaInstall() {
  updatePwaInstallUi();
  $("#installPwaAction")?.addEventListener("click", promptPwaInstall);

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredPwaInstallPrompt = event;
    updatePwaInstallUi("Installable");
  });

  window.addEventListener("appinstalled", () => {
    deferredPwaInstallPrompt = null;
    updatePwaInstallUi("Offline ready");
  });

  window.matchMedia?.("(display-mode: standalone)")?.addEventListener?.("change", () => {
    updatePwaInstallUi();
  });
}

function hasNativeAppUpdate(status = nativeUpdateStatus) {
  return maintenanceUi().hasNativeAppUpdate(status);
}

function setUpdateAppControl(status = nativeUpdateStatus, { busy = false } = {}) {
  maintenanceUi().setUpdateAppControl($("#updateApp"), runtimeAdapter(), status, { busy });
}

function updateStatusLine(status) {
  return maintenanceUi().updateStatusLine(status);
}

function syncAboutVersion(status) {
  maintenanceUi().setVersionNote($("#settingsVersion"), status);
}

function syncAppRuntimeControls() {
  const browserInstallActions = $("#browserInstallActions");
  if (browserInstallActions) browserInstallActions.hidden = hasNativeRuntime();
  updatePwaInstallUi();

  const updateButton = $("#updateApp");
  const clearButton = $("#clearCache");
  if (updateButton) {
    maintenanceUi().getUpdateController?.();
  }
  if (clearButton) clearButton.disabled = false;

  if (hasNativeRuntime()) {
    setText("#maintenanceStatus", "Checking app version.");
    void maintenanceUi().refreshSharedUpdateControl?.({ announce: true });
    return;
  }

  setText("#maintenanceStatus", "");
  void maintenanceUi().refreshSharedUpdateControl?.({ announce: false });
}

async function refreshNativeUpdateStatus() {
  if (!hasNativeRuntime()) {
    nativeUpdateStatus = { updateAvailable: false };
    setUpdateAppControl(nativeUpdateStatus);
    runtimeAdapter().maintenance.updateStatus().then(syncAboutVersion).catch(() => {});
    return;
  }
  try {
    nativeUpdateStatus = await runtimeAdapter().maintenance.updateStatus();
    setUpdateAppControl(nativeUpdateStatus);
    syncAboutVersion(nativeUpdateStatus);
    setText("#maintenanceStatus", updateStatusLine(nativeUpdateStatus));
  } catch (error) {
    nativeUpdateStatus = { updateAvailable: false };
    setUpdateAppControl(nativeUpdateStatus);
    setText("#maintenanceStatus", error?.message || String(error));
  }
}

async function updateApp() {
  if (!hasNativeRuntime()) {
    setText("#maintenanceStatus", "App updates are available inside the Android APK.");
    return;
  }

  setUpdateAppControl(nativeUpdateStatus, { busy: true });
  setText("#maintenanceStatus", "Checking the update server...");
  try {
    const status = await runtimeAdapter().maintenance.updateStatus();
    nativeUpdateStatus = status;
    syncAboutVersion(status);
    if (!hasNativeAppUpdate(status)) {
      setUpdateAppControl(status);
      setText("#maintenanceStatus", updateStatusLine(status));
      return;
    }

    setUpdateAppControl(status);
    setText("#maintenanceStatus", `Update ${status.latestVersionName || status.latestVersionCode || "available"} is ready for confirmation.`);
    const confirmed = await maintenanceUi().confirmAppUpdate(status);
    if (!confirmed) {
      setText("#maintenanceStatus", "Update postponed. You can start it here whenever you are ready.");
      return;
    }
    setUpdateAppControl(status, { busy: true });
    setText("#maintenanceStatus", "Opening Setup for the app update.");
    maintenanceUi().beginAppUpdate(status);
  } catch (error) {
    setText("#maintenanceStatus", error?.message || String(error));
  } finally {
    setUpdateAppControl(nativeUpdateStatus);
  }
}

async function clearAppCache() {
  const clearButton = $("#clearCache");
  if (!confirmDestructiveAction(clearButton, {
    confirmLabel: "Confirm cache clear",
    message: "Clear temporary cache? Course progress stays saved."
  })) {
    setText("#maintenanceStatus", "Press Clear cache again to remove temporary cache. Course progress stays saved.");
    return;
  }

  if (clearButton) clearButton.disabled = true;
  setText("#maintenanceStatus", "Clearing app cache.");

  try {
    const result = await runtimeAdapter().maintenance.clearCache({
      onEvent(message) {
        if (message.kind === "status") {
          setText("#maintenanceStatus", message.message || "Clearing cache.");
        }
      }
    });

    setText("#maintenanceStatus", maintenanceUi().cacheResultMessage(result, formatBytes));
    if (!hasNativeRuntime()) registerServiceWorker();
  } catch (error) {
    setText("#maintenanceStatus", error?.message || String(error));
  } finally {
    if (clearButton) clearButton.disabled = false;
  }
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (!Number.isFinite(value) || value <= 0) return "unknown size";
  const gib = value / 1024 / 1024 / 1024;
  if (gib >= 1) return `${gib.toFixed(2)} GiB`;
  const mib = value / 1024 / 1024;
  return `${mib.toFixed(1)} MiB`;
}

const verbStorageKey = course.storage.verbMemory;
const verbLegacyStorageKey = course.storage.verbMemoryLegacy;
const verbMemorySchemaVersion = 3;
const verbHintKeymapUrl = "/assets/macaw/actions/keymaps.json";
const verbHintFallbackPath = "/assets/macaw/actions/macaw (1).png";
const verbHintExactAssets = new Map([
  ["hear", {
    assetPath: "/assets/macaw/actions/180-hear_listen.png?art=2",
    alt: "The robed macaw cups one wing beside its ear and listens carefully."
  }],
  ["see", {
    assetPath: "/assets/macaw/actions/181-see_look.png?art=2",
    alt: "The robed macaw looks carefully through a magnifying glass."
  }]
]);
const verbRobotKeymapUrl = "/assets/robots/keymap.json";
const verbRobotFallbackPath = "/assets/robots/robot%20(1).png";
const campaignPlayableTabs = Object.freeze([
  "verb-lab",
  "word-net",
  "conjugation-comet",
  "case-cosmos",
  "agreement-aurora"
]);
const campaignGameTitles = Object.freeze({
  "verb-lab": "Verb Nebula",
  "word-net": "Word World",
  "conjugation-comet": "Conjugation Comet",
  "case-cosmos": "Case Cosmos",
  "agreement-aurora": "Agreement Aurora"
});
const campaignTransitionMillis = 1600;
const campaignGameReadyTimeoutMillis = 8000;
const verbSolutionRouteColors = [
  "#b84e45",
  "#23856f",
  "#af741f",
  "#3977ad",
  "#825f9e",
  "#267f94",
  "#a64f78",
  "#627f45"
];
const verbRoundInterstitialMillis = 1600;
const verbRoundCompleteHoldMillis = 420;
const verbSolutionRevealBaseMillis = 1400;
const verbSolutionRevealMillisPerPair = 450;
const verbHintLookupTimeoutMillis = 6000;
const verbHintImageTimeoutMillis = 1800;
const verbHintStopwords = new Set(["a", "an", "and", "be", "by", "for", "from", "in", "into", "of", "on", "or", "the", "to", "with"]);

function verbSolutionRevealDuration(pairCount) {
  const visiblePairs = Math.max(1, Number(pairCount) || 1);
  return verbSolutionRevealBaseMillis + (visiblePairs * verbSolutionRevealMillisPerPair);
}

const defaultPrintOptions = {
  orientation: "landscape",
  columns: "4",
  rows: "2",
  gap: "6",
  joinMargin: "8",
  textScale: "1.12",
  fillBlankRows: true,
  includeGuide: true,
  includeDictionary: true,
  includeScripts: true,
  sides: "booklet"
};

const paperPresets = {
  a4: { label: "A4", css: "A4", width: 210, height: 297 },
  letter: { label: "Letter", css: "letter", width: 216, height: 279 }
};

function textUnits(value) {
  return [...String(value)].reduce((total, char) => {
    if (char === " " || char === "/" || char === "-") return total + 0.45;
    if ("mwMW".includes(char)) return total + 1.25;
    if (char >= "A" && char <= "Z") return total + 1.12;
    return total + 1;
  }, 0);
}

function estimatedLines(value, limit) {
  return Math.max(1, Math.ceil(textUnits(value) / limit));
}

function scalePt(value, scale = 1) {
  const size = Number.parseFloat(value);
  if (!Number.isFinite(size)) return value;
  return `${(size * scale).toFixed(2)}pt`;
}

function printLayout(options) {
  const pageSlots = options.columns * options.rows;
  const compact = Math.max(options.columns, options.rows);
  const dense = pageSlots >= 12 || compact >= 4;

  if (pageSlots <= 4) {
    return {
      cols: options.columns,
      rows: options.rows,
      pageSlots,
      margin: "6mm",
      gap: `${options.gap}mm`,
      wordFont: "6.4pt",
      smallFont: "5.1pt",
      translationFont: "6.8pt",
      codeFont: "4.8pt",
      headFont: "6.2pt",
      titleFont: "12pt",
      blankHeight: "18px",
      blankLine: "15px"
    };
  }

  if (pageSlots <= 8 && !dense) {
    return {
      cols: options.columns,
      rows: options.rows,
      pageSlots,
      margin: "5mm",
      gap: `${options.gap}mm`,
      wordFont: "5.6pt",
      smallFont: "4.6pt",
      translationFont: "6pt",
      codeFont: "4.3pt",
      headFont: "5.5pt",
      titleFont: "10.5pt",
      blankHeight: "15px",
      blankLine: "12px"
    };
  }

  if (pageSlots <= 8) {
    return {
      cols: options.columns,
      rows: options.rows,
      pageSlots,
      margin: "5mm",
      gap: `${options.gap}mm`,
      wordFont: "5.2pt",
      smallFont: "4.3pt",
      translationFont: "6pt",
      codeFont: "4pt",
      headFont: "5.2pt",
      titleFont: "10pt",
      blankHeight: "14px",
      blankLine: "12px"
    };
  }

  if (pageSlots <= 12) {
    return {
      cols: options.columns,
      rows: options.rows,
      pageSlots,
      margin: "4.5mm",
      gap: `${options.gap}mm`,
      wordFont: "4.6pt",
      smallFont: "3.9pt",
      translationFont: "5pt",
      codeFont: "3.6pt",
      headFont: "4.6pt",
      titleFont: "9pt",
      blankHeight: "12px",
      blankLine: "10px"
    };
  }

  return {
    cols: options.columns,
    rows: options.rows,
    pageSlots,
    margin: "4mm",
    gap: `${options.gap}mm`,
    wordFont: "4.1pt",
    smallFont: "3.5pt",
    translationFont: "4.5pt",
    codeFont: "3.3pt",
    headFont: "4.1pt",
    titleFont: "8pt",
    blankHeight: "10px",
    blankLine: "9px"
  };
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function categories() {
  return [...new Set(countryDictionary.map((item) => item.cat))];
}

function normalizeDictionarySearch(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

function dictionarySearchText(item) {
  return normalizeDictionarySearch([
    item.cs,
    item.en,
    item.kind,
    item.use,
    item.cue,
    item.cat
  ].join(" "));
}

const dictionarySectionOrder = ["rules", "core", "full"];

function setDictionarySection(section, options = {}) {
  const nextSection = dictionarySectionOrder.includes(section) ? section : "rules";
  state.dictionarySection = nextSection;
  document.querySelectorAll("[data-dictionary-section]").forEach((button) => {
    const selected = button.dataset.dictionarySection === nextSection;
    button.classList.toggle("is-active", selected);
    button.setAttribute("aria-selected", String(selected));
    button.tabIndex = selected ? 0 : -1;
    if (selected && options.focus) button.focus();
  });
  document.querySelectorAll("[data-dictionary-panel]").forEach((panel) => {
    const selected = panel.dataset.dictionaryPanel === nextSection;
    panel.hidden = !selected;
    panel.classList.toggle("is-active", selected);
  });
  if (nextSection === "core") renderDictionary();
}

function nounModels() {
  return [
    ...new Set(
      countryDictionary
        .map((item) => item.kind.match(/^N\s+[^>]+>[\p{L}-]+/u)?.[0])
        .filter(Boolean)
    )
  ];
}

function renderDictionary() {
  const query = normalizeDictionarySearch(state.coreDictionarySearch);
  const showCore = Boolean(query) || state.dictionaryBrowseAll;
  const panel = $("#coreDictionaryPanel");
  const list = $("#dictionaryList");
  const toggle = $("#toggleCoreDictionary");
  if (panel) panel.hidden = !showCore;
  if (toggle) {
    toggle.setAttribute("aria-expanded", String(state.dictionaryBrowseAll));
    const label = toggle.querySelector("span");
    if (label) label.textContent = state.dictionaryBrowseAll ? "Hide all" : "Browse all";
  }
  if (!showCore) {
    list?.replaceChildren();
    return;
  }

  const filtered = query
    ? countryDictionary.filter((item) => dictionarySearchText(item).includes(query))
    : countryDictionary;
  if (query && !filtered.length) {
    panel.hidden = true;
    list.replaceChildren();
    return;
  }
  const groupData = categories()
    .map((category) => ({
      category,
      rows: filtered.filter((item) => item.cat === category)
    }))
    .filter((group) => group.rows.length);
  const count = $("#dictionaryCount");
  if (count) {
    count.textContent = query
      ? `${filtered.length} Core result${filtered.length === 1 ? "" : "s"}`
      : `${countryDictionary.length} words`;
  }

  if (!filtered.length) {
    list.innerHTML = `<p class="empty-state">No Core match. The full dictionary may still have this form.</p>`;
  } else {
    list.replaceChildren(
      ...groupData.map((group) => {
        const section = document.createElement("section");
        section.className = "dictionary-group";
        section.innerHTML = `
          <h4><span>${escapeHtml(group.category)}</span><small>${group.rows.length}</small></h4>
          <div class="dictionary-rows">
          ${group.rows.map((item) => `
            <article class="dictionary-entry">
              <div class="dict-line dict-word">
                <b>${escapeHtml(item.cs)}</b>
                <span>${escapeHtml(item.en)}</span>
                <small>${escapeHtml(item.kind)}</small>
              </div>
              <div class="dict-line dict-example">
                <em>${escapeHtml(item.use)}</em>
                <code>${escapeHtml(item.cue)}</code>
              </div>
            </article>
          `).join("")}
          </div>
        `;
        return section;
      })
    );
  }

}

function renderScripts() {
  $("#scriptCount").textContent = `${countryScripts.length} scripts`;
  $("#scriptList").replaceChildren(
    ...countryScripts.map((script) => {
      const card = document.createElement("article");
      card.className = "script-card";
      card.innerHTML = `
        <h4><span>${escapeHtml(script.title)}</span><small>${escapeHtml(script.goal)}</small></h4>
        <div class="script-rows">
          ${script.lines.map((line) => `
            <div class="script-row">
              <b>${escapeHtml(line.cs)}</b>
              <span>${escapeHtml(line.en)}</span>
            </div>
          `).join("")}
        </div>
      `;
      return card;
    })
  );
}

function emptyVerbStats() {
  return { attempts: 0, matches: 0, rounds: 0 };
}

function safeVerbStat(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0;
}

async function initializeVerbGuidedMode() {
  return;
}

function verbGuidedInteractionLocked() {
  if (!state.verbGuidedRequested) return false;
  return !state.verbGuidedMode
    || state.verbGuidedStatus !== "ready"
    || state.verbGuidedEvidencePending
    || state.verbProgressResetPending;
}

function verbGuidedTargetPending() {
  return state.verbGuidedMode
    && state.verbGuidedStatus === "ready"
    && !state.verbGuidedLifecycle?.state().firstResponseRecorded;
}

function renderVerbGuidedStatus() {
  const banner = $("#verbGuidedStatus");
  const title = $("#verbGuidedStatusTitle");
  const detail = $("#verbGuidedStatusDetail");
  const pairMenu = document.querySelector(".verb-pair-menu");
  if (pairMenu) pairMenu.hidden = false;
  if (!banner || !detail) return;
  banner.hidden = true;
  banner.removeAttribute("role");
  banner.removeAttribute("aria-live");
  banner.removeAttribute("aria-atomic");
  if (title) title.textContent = "Developer Guided · prototype-not-human-approved";
  banner.classList.toggle("is-error", state.verbGuidedStatus === "failed");
  const lifecycle = state.verbGuidedLifecycle?.state();
  const supported = Boolean(lifecycle?.hintsUsed || lifecycle?.solutionRevealed);
  const firstResponseRecorded = Boolean(lifecycle?.firstResponseRecorded);
  const supportedBeforeResponse = Boolean(state.verbGuidedSupportAtFirstResponse);
  const solutionShownAfterResponse = Boolean(
    firstResponseRecorded
      && lifecycle?.solutionRevealed
      && !supportedBeforeResponse
  );
  banner.classList.toggle("is-supported", supported);
  if (!state.verbGuidedRequested) return;
  if (state.verbGuidedStatus === "failed") {
    detail.textContent = `Locked: ${state.verbGuidedError || "curriculum evidence is unavailable"}`;
  } else if (state.verbGuidedStatus === "complete") {
    detail.textContent = supportedBeforeResponse
      ? "Pilot complete · supported practice, not independent evidence"
      : solutionShownAfterResponse
        ? "Pilot complete · first response recorded independently; solution shown afterward"
        : "Pilot complete · Unit 3 remains locked behind Units 1–2";
  } else if (supportedBeforeResponse) {
    detail.textContent = "Supported practice · not independent evidence";
  } else if (supported && !firstResponseRecorded) {
    detail.textContent = "Support is visible · the next answer will be supported practice";
  } else if (solutionShownAfterResponse) {
    detail.textContent = "First response recorded independently · solution shown afterward";
  } else if (firstResponseRecorded) {
    detail.textContent = "First response recorded · finish this exact meaning contrast";
  } else if (state.verbGuidedStatus === "ready") {
    detail.textContent = "Unit 3 mechanic pilot · independent discrimination, non-mastery";
  } else {
    detail.textContent = "Verifying the exact bound content and evidence task…";
  }
}

function waitForVerbPaintedFrame() {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(resolve));
  });
}


function verbGuidedPresentationReady(epoch, lifecycle) {
  const panel = $("#trainPanelVerbLab");
  return Boolean(
    state.verbGuidedMode
    && state.verbGuidedStatus === "activating"
    && !state.verbProgressResetPending
    && state.verbGuidedActivationEpoch === epoch
    && state.verbGuidedLifecycle === lifecycle
    && document.visibilityState !== "hidden"
    && panel
    && !panel.hidden
    && panel.classList.contains("is-active")
  );
}

function applyActivatedGuidedVerbPlan(plan) {
  state.verbGuidedPlan = plan;
  state.verbPairs = [...plan.round];
  state.verbQueueIds = [];
  state.verbRound = [...plan.round];
  state.verbEnglishRound = [...plan.englishRound];
  state.verbMatchedIds = new Set();
  state.verbSelectedCzechId = "";
  state.verbSelectedEnglishId = "";
}

function deferVerbGuidedActivation() {
  if (!state.verbGuidedMode || state.verbGuidedStatus !== "activating") return;
  state.verbGuidedActivationEpoch += 1;
  state.verbGuidedStatus = "pending";
  state.verbGuidedActivationPromise = null;
}

async function activateVerbGuidedOpportunity() {
  if (!state.verbGuidedMode || state.verbGuidedStatus !== "pending") return;
  if (state.verbGuidedActivationPromise) return state.verbGuidedActivationPromise;
  const activationEpoch = state.verbGuidedActivationEpoch + 1;
  const lifecycle = state.verbGuidedLifecycle;
  state.verbGuidedActivationEpoch = activationEpoch;
  state.verbGuidedStatus = "activating";
  renderVerbNebula();
  const activationPromise = waitForVerbPaintedFrame()
    .then(() => {
      if (!verbGuidedPresentationReady(activationEpoch, lifecycle)) return null;
      return lifecycle.activate({
        requirePresented: () => verbGuidedPresentationReady(activationEpoch, lifecycle)
      });
    })
    .then((activation) => {
      if (!activation || activation.phase === "pending") {
        if (state.verbGuidedActivationEpoch === activationEpoch) {
          state.verbGuidedStatus = "pending";
        }
        return;
      }
      if (!verbGuidedPresentationReady(activationEpoch, lifecycle)) {
        if (state.verbGuidedActivationEpoch === activationEpoch) {
          state.verbGuidedStatus = "pending";
        }
        return;
      }
      const plan = verbNebulaCore.buildGuidedVerbRound(
        state.verbGuidedCatalog,
        state.verbGuidedTargetPair,
        {
          pairCount: 4,
          contrastPairs: state.verbGuidedContrastPairs,
          taskFingerprint: lifecycle.state().taskFingerprint
        }
      );
      applyActivatedGuidedVerbPlan(plan);
      state.verbGuidedStatus = "ready";
      setVerbMatchFeedback("Match each Czech verb with its English meaning.");
      renderVerbNebula();
    })
    .catch(async (error) => {
      const stillCurrent = state.verbGuidedActivationEpoch === activationEpoch
        && state.verbGuidedLifecycle === lifecycle
        && !state.verbProgressResetPending;
      await abortVerbGuidedLifecycle(lifecycle);
      if (!stillCurrent) return;
      state.verbGuidedStatus = "failed";
      state.verbGuidedError = error?.message || String(error);
      setVerbMatchFeedback("Guided evidence could not be prepared. This round is locked.", "wrong");
      renderVerbNebula();
    })
    .finally(() => {
      if (state.verbGuidedActivationPromise === activationPromise) {
        state.verbGuidedActivationPromise = null;
      }
    });
  state.verbGuidedActivationPromise = activationPromise;
  return activationPromise;
}

function parseStoredVerbMemory(key) {
  if (!key) return null;
  try {
    return JSON.parse(localStorage.getItem(key) || "null");
  } catch (error) {
    console.warn(`Could not parse Verb Nebula memory at ${key}`, error);
    return null;
  }
}

function readVerbMemoryEnvelope() {
  const current = parseStoredVerbMemory(verbStorageKey);
  if (current?.schemaVersion === verbMemorySchemaVersion) {
    return verbExerciseFamilyCore.migrateVerbMemoryToV3(current);
  }
  const legacy = verbLegacyStorageKey
    ? parseStoredVerbMemory(verbLegacyStorageKey)
    : null;
  if (legacy?.schemaVersion !== 2) return null;
  const migrated = verbExerciseFamilyCore.migrateVerbMemoryToV3(legacy);
  try {
    localStorage.setItem(verbStorageKey, JSON.stringify(migrated));
  } catch (error) {
    console.warn("Verb memory migration could not be persisted; using the migrated state in memory.", error);
  }
  return migrated;
}

function readVerbMemory() {
  try {
    const envelope = readVerbMemoryEnvelope();
    const meaning = envelope?.families?.meaning;
    if (!meaning) return null;
    return {
      ...meaning,
      roundIds: meaning.round?.roundIds || [],
      englishRoundIds: meaning.round?.englishRoundIds || [],
      matchedIds: meaning.round?.matchedIds || [],
      hintsEnabled: Boolean(meaning.round?.hintsEnabled)
    };
  } catch (error) {
    console.warn("Could not read Verb Nebula memory", error);
    return null;
  }
}

function saveVerbMemory() {
  if (!state.verbMemoryLoaded || state.verbGuidedRequested) return;
  try {
    const legacyMeaning = {
      schemaVersion: 2,
      difficulty: state.verbDifficulty,
      knownPairIds: state.verbPairs.map((pair) => pair.id),
      pairCount: state.verbPairCount,
      queueIds: state.verbQueueIds,
      roundIds: state.verbRound.map((pair) => pair.id),
      englishRoundIds: state.verbEnglishRound.map((pair) => pair.id),
      matchedIds: [...state.verbMatchedIds],
      hintsEnabled: state.verbHintsEnabled,
      roundNumber: state.verbRoundNumber,
      stats: state.verbStats
    };
    const current = readVerbMemoryEnvelope()
      || verbExerciseFamilyCore.migrateVerbMemoryToV3(null);
    const migratedMeaning = verbExerciseFamilyCore
      .migrateVerbMemoryToV3(legacyMeaning)
      .families.meaning;
    const next = verbExerciseFamilyCore.withVerbFamilyState(
      current,
      verbExerciseFamilyCore.VERB_EXERCISE_FAMILIES.MEANING,
      migratedMeaning
    );
    localStorage.setItem(verbStorageKey, JSON.stringify(next));
  } catch (error) {
    console.warn("Could not save Verb Nebula memory", error);
  }
}

function validVerbIds(ids, pairById) {
  const seen = new Set();
  return Array.from(ids || []).filter((id) => {
    if (!pairById.has(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function loadVerbMemory() {
  if (state.verbMemoryLoaded) return;
  if (!verbNebulaCore) throw new Error("Verb Nebula engine is not available.");

  if (state.verbGuidedRequested) {
    const plan = state.verbGuidedPlan;
    state.verbDifficulty = Number(plan?.round?.[0]?.difficulty) || 1;
    state.verbPairs = plan ? [...plan.round] : [];
    state.verbQueueIds = [];
    state.verbRound = plan ? [...plan.round] : [];
    state.verbEnglishRound = plan ? [...plan.englishRound] : [];
    state.verbMatchedIds = new Set();
    state.verbSelectedCzechId = "";
    state.verbSelectedEnglishId = "";
    state.verbPairCount = 4;
    state.verbRoundNumber = plan ? 1 : 0;
    state.verbStats = emptyVerbStats();
    state.verbHintsEnabled = false;
    state.verbSolutionRevealed = false;
    state.verbMemoryLoaded = true;
    void loadVerbRobotPaths();
    return;
  }

  state.verbDifficulty = Number(window.CaatuuLearning?.difficulty?.()) || 1;
  state.verbPairs = verbNebulaCore.filterVerbPairsForDifficulty(
    verbNebulaCore.extractCoreVerbPairs(countryDictionary),
    state.verbDifficulty
  );
  const pairById = new Map(state.verbPairs.map((pair) => [pair.id, pair]));
  const memory = readVerbMemory();
  const sameDifficulty = Number(memory?.difficulty) === state.verbDifficulty;
  state.verbPairCount = verbNebulaCore.normalizeVerbPairCount(memory?.pairCount, 4);
  state.verbHintsEnabled = memory ? Boolean(memory.hintsEnabled) : true;
  state.verbRoundNumber = safeVerbStat(memory?.roundNumber);
  state.verbStats = {
    attempts: safeVerbStat(memory?.stats?.attempts),
    matches: safeVerbStat(memory?.stats?.matches),
    rounds: safeVerbStat(memory?.stats?.rounds)
  };

  const savedRoundIds = sameDifficulty ? validVerbIds(memory?.roundIds, pairById) : [];
  const canRestoreRound = savedRoundIds.length === state.verbPairCount;
  const restoredRoundIds = canRestoreRound ? savedRoundIds : [];
  const restoredRoundSet = new Set(restoredRoundIds);
  const queueSeed = sameDifficulty
    ? (canRestoreRound
        ? memory?.queueIds
        : [...savedRoundIds, ...Array.from(memory?.queueIds || [])])
    : [];
  const queuePairs = state.verbPairs.filter((pair) => !restoredRoundSet.has(pair.id));
  state.verbQueueIds = verbNebulaCore.restoreVerbQueue(
    queuePairs,
    queueSeed,
    Math.random,
    sameDifficulty ? (memory?.knownPairIds || null) : null
  );

  if (canRestoreRound) {
    state.verbRound = restoredRoundIds.map((id) => pairById.get(id));
    const englishIds = validVerbIds(memory?.englishRoundIds, pairById)
      .filter((id) => restoredRoundSet.has(id));
    state.verbEnglishRound = englishIds.length === restoredRoundIds.length
      ? englishIds.map((id) => pairById.get(id))
      : verbNebulaCore.shuffleVerbMeanings(state.verbRound);
    state.verbMatchedIds = new Set(
      validVerbIds(memory?.matchedIds, pairById).filter((id) => restoredRoundSet.has(id))
    );
    // A transition timer cannot survive an app pause, reload, or WebView
    // recreation. Treat a persisted completed round as consumed so rendering
    // immediately deals the next puzzle from the preserved queue.
    if (verbNebulaCore.isVerbRoundComplete(state.verbRound, state.verbMatchedIds)) {
      state.verbRound = [];
      state.verbEnglishRound = [];
      state.verbMatchedIds.clear();
    }
  }

  state.verbMemoryLoaded = true;
  void loadVerbRobotPaths();
}

function setVerbMatchFeedback(message, kind = "") {
  const feedback = $("#verbMatchFeedback");
  if (!feedback) return;
  feedback.textContent = message;
  feedback.className = `verb-match-feedback${kind ? ` is-${kind}` : ""}`;
}

function resetVerbSelections() {
  state.verbSelectedCzechId = "";
  state.verbSelectedEnglishId = "";
  state.verbWrongIds.clear();
  if (state.verbWrongTimer) {
    window.clearTimeout(state.verbWrongTimer);
    state.verbWrongTimer = null;
  }
}

function returnUnmatchedVerbsToQueue() {
  const queued = new Set(state.verbQueueIds);
  const unfinished = state.verbRound
    .filter((pair) => !state.verbMatchedIds.has(pair.id) && !queued.has(pair.id))
    .map((pair) => pair.id);
  state.verbQueueIds.push(...unfinished);
}

function planVerbRound() {
  if (state.verbGuidedMode && state.verbGuidedPlan) return state.verbGuidedPlan;
  const dealt = verbNebulaCore.dealVerbRound(
    state.verbPairs,
    state.verbQueueIds,
    state.verbPairCount
  );
  return {
    round: dealt.round,
    englishRound: verbNebulaCore.shuffleVerbMeanings(dealt.round),
    queueIds: dealt.queueIds
  };
}

function applyVerbRound(plan, preloadedHints = null) {
  clearVerbSolutionAdvance();
  resetVerbSelections();
  state.verbHintRequestId += 1;
  state.verbRound = plan.round;
  state.verbEnglishRound = plan.englishRound;
  state.verbQueueIds = plan.queueIds;
  state.verbMatchedIds = new Set();
  state.verbSolutionRevealed = false;
  state.verbRoundTransitioning = false;
  state.verbRoundInterstitial = false;
  state.verbRoundRewardXp = 0;
  state.verbInterstitialRobotPath = "";
  state.verbHintById.clear();
  if (state.verbHintsEnabled && preloadedHints instanceof Map) {
    plan.round.forEach((pair) => {
      state.verbHintById.set(pair.id, preloadedHints.get(pair.id) || {
        status: "ready",
        assetPath: verbHintFallbackPath,
        alt: "Macaw picture clue"
      });
    });
  }
  state.verbRoundNumber += 1;
  saveVerbMemory();

  if (state.verbRound.length) {
    setVerbMatchFeedback("Match each Czech verb with its English meaning.");
  } else {
    setVerbMatchFeedback("No Core verbs are available for this game.", "wrong");
  }
  renderVerbNebula();
}

async function startVerbRound(options = {}) {
  loadVerbMemory();
  if (state.verbGuidedRequested) {
    renderVerbNebula();
    return;
  }
  if (state.verbRoundTransitioning) return;
  if (options.returnUnmatched) returnUnmatchedVerbsToQueue();
  const transitionId = state.verbRoundTransitionId + 1;
  state.verbRoundTransitionId = transitionId;
  state.verbRoundTransitioning = true;
  state.verbSolutionRevealed = false;
  state.verbHintRequestId += 1;
  resetVerbSelections();
  await prepareVerbRound(planVerbRound(), transitionId);
}

function verbRoundComplete() {
  return verbNebulaCore.isVerbRoundComplete(state.verbRound, state.verbMatchedIds);
}

function renderVerbPairCountControls() {
  document.querySelectorAll("[data-verb-pair-count]").forEach((button) => {
    const selected = Number(button.dataset.verbPairCount) === state.verbPairCount;
    button.setAttribute("aria-pressed", String(selected));
    button.classList.toggle("is-active", selected);
    button.disabled = state.verbGuidedRequested;
  });
  setText("#verbPairCurrent", String(state.verbPairCount));
}

function loadVerbSpeakOnTap() {
  try {
    const stored = window.localStorage.getItem(verbSpeakOnTapStorageKey);
    return stored === null ? true : stored === "true";
  } catch (error) {
    return true;
  }
}

function saveVerbSpeakOnTap() {
  try {
    window.localStorage.setItem(verbSpeakOnTapStorageKey, String(state.verbSpeakOnTap));
  } catch (error) {
    // The preference remains active for this session when storage is unavailable.
  }
}

function renderVerbAudioControls() {
  const button = $("#verbSpeakOnTap");
  const summary = document.querySelector(".verb-audio-menu > summary");
  const settings = $("#verbAudioSettings");
  if (button) {
    button.setAttribute("aria-checked", String(state.verbSpeakOnTap));
    button.classList.toggle("is-active", state.verbSpeakOnTap);
  }
  if (settings) settings.hidden = !state.verbSpeakOnTap;
  if (summary) {
    const stateLabel = state.verbSpeakOnTap ? "on" : "off";
    summary.setAttribute("aria-label", `Czech audio settings. Speak on tap is ${stateLabel}.`);
    summary.title = `Czech audio settings. Speak on tap is ${stateLabel}.`;
    summary.classList.toggle("is-active", state.verbSpeakOnTap);
  }
  const slider = $("#verbAudioSpeed");
  const paceOrder = ["slower", "slow", "normal"];
  const pace = window.CaatuuChrome?.resolveSpeechPace?.();
  if (slider && pace) {
    const paceIndex = Math.max(0, paceOrder.indexOf(pace.key));
    slider.value = String(paceIndex);
    slider.style.setProperty("--speech-pace-position", `${(paceIndex / (paceOrder.length - 1)) * 100}%`);
    slider.setAttribute("aria-valuetext", `${pace.label}, ${pace.rate} times`);
  }
}

function renderVerbDisplayControls() {
  const theme = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
  const fontSize = document.documentElement.dataset.fontSize || "largest";
  document.querySelectorAll(".verb-display-menu [data-theme-option]").forEach((button) => {
    const selected = button.dataset.themeOption === theme;
    button.classList.toggle("is-active", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  document.querySelectorAll(".verb-display-menu [data-font-size-option]").forEach((button) => {
    const selected = button.dataset.fontSizeOption === fontSize;
    button.classList.toggle("is-active", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
}

async function refreshVerbAudioVoiceControls() {
  const select = $("#verbAudioVoice");
  const status = $("#verbAudioVoiceStatus");
  if (!select || !status || !state.verbSpeakOnTap) return;
  const chrome = window.CaatuuChrome;
  if (typeof chrome?.getSpeechVoiceControlState !== "function") {
    select.disabled = true;
    status.textContent = "Czech voice settings are unavailable.";
    return;
  }
  const request = Number(select.dataset.request || 0) + 1;
  select.dataset.request = String(request);
  select.disabled = true;
  status.textContent = "Checking Czech voices...";
  const result = await chrome.getSpeechVoiceControlState();
  if (request !== Number(select.dataset.request)) return;
  const automatic = document.createElement("option");
  automatic.value = "";
  automatic.textContent = "Automatic (recommended)";
  select.replaceChildren(automatic);
  result.voices.forEach((voice) => {
    const option = document.createElement("option");
    option.value = voice.value;
    option.textContent = `${voice.name} (${voice.locale || "Czech"} · ${voice.service})`;
    select.append(option);
  });
  const preferred = chrome.getSpeechVoicePreference?.() || "";
  const selected = result.voices.find((voice) => voice.id === preferred);
  select.value = selected ? selected.value : "";
  select.disabled = !(result.available || result.voices.length);
  status.textContent = chrome.describeSpeechVoiceState?.(result) || "Voice selection is ready.";
}

function closeVerbToolbarMenus(except = null) {
  document.querySelectorAll("#verbMeaningBoard details.verb-toolbar-menu[open]").forEach((menu) => {
    if (menu !== except) menu.open = false;
  });
}

function speakVerbCzechOnTap(verbId) {
  if (!state.verbSpeakOnTap) return;
  const pair = state.verbRound.find((item) => item.id === verbId);
  if (!pair?.cz || typeof window.CaatuuChrome?.speakCzechText !== "function") return;
  void window.CaatuuChrome.speakCzechText(pair.cz).catch((error) => {
    console.warn("Could not speak the selected Czech verb.", error);
  });
}

function renderVerbMatchStats() {
  const matched = state.verbMatchedIds.size;
  setText("#verbRoundProgress", `${matched} / ${state.verbRound.length || state.verbPairCount}`);
  setText("#verbQueueRemaining", String(state.verbQueueIds.length));
  const accuracy = state.verbStats.attempts
    ? `${Math.round((state.verbStats.matches / state.verbStats.attempts) * 100)}%`
    : "—";
  setText("#verbMatchAccuracy", accuracy);

  const revealButton = $("#verbRevealSolution");
  if (revealButton) {
    const canToggleSolution = Boolean(state.verbRound.length)
      && !state.verbRoundTransitioning
      && !verbRoundComplete()
      && !verbGuidedInteractionLocked();
    revealButton.disabled = !canToggleSolution;
    revealButton.classList.toggle("is-ready", state.verbSolutionRevealed);
    revealButton.setAttribute("aria-pressed", String(state.verbSolutionRevealed));
    revealButton.setAttribute(
      "aria-label",
      state.verbSolutionRevealed ? "Hide solution" : "Reveal solution"
    );
    revealButton.title = state.verbSolutionRevealed ? "Hide solution" : "Reveal solution";
  }
}

function renderVerbHintSlot(pair) {
  const slot = document.createElement("span");
  slot.className = "verb-match-hint-slot";
  if (!state.verbHintsEnabled) {
    slot.hidden = true;
    return slot;
  }
  const hint = state.verbHintById.get(pair.id);
  if (!hint) {
    slot.hidden = true;
    return slot;
  }

  slot.hidden = false;
  if (hint.status === "loading") {
    const loader = document.createElement("span");
    loader.className = "verb-hint-loader";
    loader.setAttribute("aria-label", "Loading picture clue");
    slot.append(loader);
    return slot;
  }

  if (hint.status === "ready") {
    const image = document.createElement("img");
    image.src = hint.assetPath;
    image.alt = hint.alt || "Picture clue";
    image.addEventListener("error", () => {
      state.verbHintById.set(pair.id, {
        status: "ready",
        assetPath: verbHintFallbackPath,
        alt: "Macaw picture clue"
      });
      renderVerbNebula();
    }, { once: true });
    slot.append(image);
    return slot;
  }

  const fallback = document.createElement("img");
  fallback.src = verbHintFallbackPath;
  fallback.alt = "Macaw picture clue";
  slot.append(fallback);
  return slot;
}

function createVerbMatchCard(pair, side) {
  const matched = state.verbMatchedIds.has(pair.id);
  const selected = side === "cz"
    ? state.verbSelectedCzechId === pair.id
    : state.verbSelectedEnglishId === pair.id;
  const button = document.createElement("button");
  button.type = "button";
  button.className = `verb-match-card verb-match-card-${side}`;
  button.dataset.verbId = pair.id;
  button.dataset.verbSide = side;
  button.disabled = matched
    || state.verbRoundTransitioning
    || state.verbSolutionRevealed
    || verbGuidedInteractionLocked()
    || (verbGuidedTargetPending() && side === "cz" && pair.id !== state.verbGuidedTargetId);
  button.setAttribute("aria-pressed", String(selected));
  button.classList.toggle("is-selected", selected);
  button.classList.toggle("is-matched", matched);
  button.classList.toggle("is-wrong", state.verbWrongIds.has(`${side}:${pair.id}`));
  button.classList.toggle("is-solution", state.verbSolutionRevealed);

  const copy = document.createElement("span");
  copy.className = "verb-match-card-copy";
  const label = side === "cz" ? pair.cz : pair.eng;
  copy.textContent = label;
  if (state.verbSolutionRevealed) button.setAttribute("aria-label", `${pair.cz} means ${pair.eng}`);
  button.append(copy);
  if (side === "cz") {
    const row = document.createElement("div");
    row.className = "verb-match-card-row verb-match-card-row-cz";
    row.dataset.verbRowId = pair.id;
    row.append(renderVerbHintSlot(pair), button);
    return row;
  }
  return button;
}

function verbMatchCardForId(column, pairId) {
  return Array.from(column?.querySelectorAll("[data-verb-id]") || [])
    .find((card) => card.dataset.verbId === pairId) || null;
}

function renderVerbSolutionArrows() {
  const board = document.querySelector(".verb-match-board");
  const svg = $("#verbSolutionArrows");
  const paths = $("#verbSolutionArrowPaths");
  const czechColumn = $("#verbCzechColumn");
  const englishColumn = $("#verbEnglishColumn");
  const visible = state.verbSolutionRevealed && !state.verbRoundInterstitial;
  if (svg) {
    svg.toggleAttribute("hidden", !visible);
    svg.classList.toggle("is-visible", Boolean(visible));
    svg.setAttribute("aria-hidden", String(!visible));
  }
  if (!board || !svg || !paths || !czechColumn || !englishColumn || !visible) {
    if (paths) paths.replaceChildren();
    return;
  }

  window.requestAnimationFrame(() => {
    if (!state.verbSolutionRevealed || state.verbRoundInterstitial || !svg.isConnected) {
      svg.toggleAttribute("hidden", true);
      svg.classList.remove("is-visible");
      svg.setAttribute("aria-hidden", "true");
      paths.replaceChildren();
      return;
    }
    const boardRect = board.getBoundingClientRect();
    if (!boardRect.width || !boardRect.height) return;
    svg.setAttribute("viewBox", `0 0 ${boardRect.width} ${boardRect.height}`);
    svg.setAttribute("width", String(boardRect.width));
    svg.setAttribute("height", String(boardRect.height));
    const arrowRoutes = state.verbRound.map((pair, index) => {
      const leftCard = verbMatchCardForId(czechColumn, pair.id);
      const rightCard = verbMatchCardForId(englishColumn, pair.id);
      if (!leftCard || !rightCard) return null;
      const leftRect = leftCard.getBoundingClientRect();
      const rightRect = rightCard.getBoundingClientRect();
      const startX = leftRect.right - boardRect.left - 4;
      const startY = leftRect.top - boardRect.top + leftRect.height / 2;
      const endX = rightRect.left - boardRect.left + 4;
      const endY = rightRect.top - boardRect.top + rightRect.height / 2;
      const gapWidth = Math.max(1, endX - startX);
      const laneInset = Math.max(7, Math.min(12, gapWidth * 0.18));
      const laneSpan = Math.max(0, gapWidth - laneInset * 2);
      const laneX = state.verbRound.length > 1
        ? startX + laneInset + laneSpan * (index / (state.verbRound.length - 1))
        : startX + gapWidth / 2;
      const middleY = (startY + endY) / 2;
      const bendWidth = Math.max(6, Math.min(14, gapWidth * 0.24));
      const routeColor = verbSolutionRouteColors[index % verbSolutionRouteColors.length];
      const routeData = `M ${startX} ${startY} C ${startX + bendWidth} ${startY}, ${laneX} ${startY}, ${laneX} ${middleY} C ${laneX} ${endY}, ${endX - bendWidth} ${endY}, ${endX} ${endY}`;

      [leftCard, rightCard].forEach((card) => {
        card.style.setProperty("--verb-solution-color", routeColor);
        card.dataset.solutionRoute = String(index + 1);
      });

      const route = document.createElementNS("http://www.w3.org/2000/svg", "g");
      route.classList.add("verb-solution-route");
      route.dataset.verbPairId = pair.id;
      route.style.setProperty("--verb-solution-color", routeColor);
      route.style.setProperty("--verb-solution-index", String(index));

      const halo = document.createElementNS("http://www.w3.org/2000/svg", "path");
      halo.classList.add("verb-solution-route-halo");
      halo.setAttribute("d", routeData);
      halo.setAttribute("pathLength", "1");

      const line = document.createElementNS("http://www.w3.org/2000/svg", "path");
      line.classList.add("verb-solution-route-line");
      line.setAttribute("d", routeData);
      line.setAttribute("pathLength", "1");
      line.setAttribute("marker-end", "url(#verbSolutionArrowhead)");

      route.append(halo, line);
      return route;
    }).filter(Boolean);
    paths.replaceChildren(...arrowRoutes);
  });
}

function renderVerbHintButton() {
  const button = $("#verbHintButton");
  if (!button) return;
  const loading = state.verbHintsEnabled
    && [...state.verbHintById.values()].some((hint) => hint?.status === "loading");
  button.disabled = !state.verbRound.length || state.verbRoundTransitioning;
  if (state.verbGuidedRequested) button.disabled ||= verbGuidedInteractionLocked();
  button.setAttribute("aria-pressed", String(state.verbHintsEnabled));
  button.setAttribute("aria-label", state.verbHintsEnabled ? "Hide picture clues" : "Show picture clues");
  button.title = state.verbHintsEnabled ? "Hide picture clues" : "Show picture clues";
  button.classList.toggle("is-active", state.verbHintsEnabled);
  button.classList.toggle("is-loading", loading);
}

function renderVerbRoundInterstitial() {
  const active = state.verbRoundInterstitial;
  const board = document.querySelector(".verb-match-board");
  const interstitial = $("#verbRoundInterstitial");
  const image = $("#verbRoundRobot");
  const reward = $("#verbRoundReward");
  const rewardAmount = $("#verbRoundRewardAmount");
  const rewardXp = Math.max(0, Number(state.verbRoundRewardXp) || 0);
  const rewardVisible = active && rewardXp > 0;
  const gameNodes = [
    document.querySelector(".verb-match-controls"),
    ...document.querySelectorAll(".verb-match-column-heading"),
    $("#verbCzechColumn"),
    $("#verbEnglishColumn")
  ].filter(Boolean);

  gameNodes.forEach((node) => {
    node.hidden = active;
    node.style.display = active ? "none" : "";
  });
  board?.setAttribute("aria-busy", active ? "true" : "false");
  if (!interstitial) return;

  interstitial.hidden = !active;
  interstitial.setAttribute(
    "aria-label",
    rewardVisible
      ? `Round cleared. ${rewardXp} XP earned this round. Preparing the next round.`
      : "Preparing the next round"
  );
  interstitial.style.display = active ? "grid" : "none";
  interstitial.style.gridColumn = "1 / -1";
  interstitial.style.gridRow = "1 / -1";
  interstitial.style.minHeight = "clamp(260px, 52vh, 420px)";
  interstitial.style.placeItems = "center";
  interstitial.style.padding = "18px";
  if (reward) {
    reward.hidden = !rewardVisible;
    reward.classList.toggle("is-visible", rewardVisible);
  }
  if (rewardAmount) rewardAmount.textContent = rewardVisible ? `+${rewardXp} XP` : "";
  if (!image) return;
  image.style.width = "clamp(150px, 34vw, 240px)";
  image.style.maxHeight = "300px";
  image.style.objectFit = "contain";
  image.style.opacity = "0.9";
  const nextPath = state.verbInterstitialRobotPath || verbRobotFallbackPath;
  if (image.getAttribute("src") !== nextPath) image.src = nextPath;
}


async function abortVerbGuidedLifecycle(lifecycle = state.verbGuidedLifecycle) {
  if (!lifecycle?.abort) return;
  try {
    await lifecycle.abort();
  } finally {
    if (state.verbGuidedLifecycle === lifecycle) state.verbGuidedLifecycle = null;
  }
}


function trackVerbGuidedOperation(operation) {
  const promise = Promise.resolve().then(operation);
  state.verbGuidedOperations.add(promise);
  promise.then(
    () => state.verbGuidedOperations.delete(promise),
    (error) => {
      state.verbGuidedOperations.delete(promise);
      if (!state.verbProgressResetPending) console.error("Guided Verb operation failed", error);
    }
  );
  return promise;
}


function renderVerbNebula() {
  const panel = $("#trainPanelVerbLab");
  if (!panel) return;
  setText("#verbWorldSubtitle", "Match meanings");
  loadVerbMemory();
  if (!state.verbRound.length && state.verbPairs.length && !state.verbRoundTransitioning) {
    void startVerbRound();
    return;
  }

  const board = document.querySelector(".verb-match-board");
  board?.style.setProperty(
    "--verb-pair-count",
    String(state.verbRoundInterstitial ? 1 : (state.verbRound.length || state.verbPairCount))
  );

  $("#verbCzechColumn")?.replaceChildren(
    ...state.verbRound.map((pair) => createVerbMatchCard(pair, "cz"))
  );
  $("#verbEnglishColumn")?.replaceChildren(
    ...state.verbEnglishRound.map((pair) => createVerbMatchCard(pair, "en"))
  );
  renderVerbPairCountControls();
  renderVerbAudioControls();
  renderVerbMatchStats();
  renderVerbHintButton();
  renderVerbGuidedStatus();
  renderVerbRoundInterstitial();
  renderVerbSolutionArrows();
  if (state.verbHintsEnabled && state.verbRound.length && !state.verbHintById.size) {
    void loadVerbHintsForRound();
  }
  if (state.verbGuidedMode && state.verbGuidedStatus === "pending" && !panel.hidden) {
    void activateVerbGuidedOpportunity();
  }
}


function waitForVerbTransition(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

async function loadVerbRobotPaths() {
  if (!state.verbRobotPathsPromise) {
    state.verbRobotPathsPromise = fetch(verbRobotKeymapUrl, { cache: "force-cache" })
      .then((response) => {
        if (!response.ok) throw new Error(`Could not load robot keymap (${response.status}).`);
        return response.json();
      })
      .then((raw) => Object.keys(raw || {}).filter((path) => path.startsWith("/assets/robots/")))
      .catch(() => []);
  }
  return state.verbRobotPathsPromise;
}

async function nextVerbInterstitialRobot() {
  const paths = await loadVerbRobotPaths();
  if (!paths.length) return verbRobotFallbackPath;
  let index = Math.floor(Math.random() * paths.length);
  if (paths.length > 1 && index === state.verbRobotCursor) {
    index = (index + 1) % paths.length;
  }
  state.verbRobotCursor = index;
  return paths[index];
}

async function preloadVerbHintsForRound(round) {
  const pairs = Array.from(round || []);
  const candidateGroups = await Promise.all(
    pairs.map((pair) => cachedVerbHintCandidates(pair))
  );
  const assignments = verbNebulaCore.assignUniqueVerbHintCandidates(candidateGroups);
  const entries = await Promise.all(pairs.map(async (pair, index) => {
    const assigned = assignments[index];
    const hint = assigned ? await loadableVerbHint([assigned], pair) : null;
    return [pair.id, hint || {
      status: "ready",
      assetPath: verbHintFallbackPath,
      alt: "Macaw picture clue"
    }];
  }));
  const hints = new Map(entries);
  await Promise.all([...hints.values()].map((hint) => preloadVerbHintAsset(hint?.assetPath)));
  return hints;
}

async function prepareVerbRound(nextRound, transitionId) {
  state.verbRoundInterstitial = true;
  state.verbInterstitialRobotPath = verbRobotFallbackPath;
  setVerbMatchFeedback("Preparing the next round…", "hint");
  renderVerbNebula();

  const robotPromise = nextVerbInterstitialRobot().then((path) => {
    if (transitionId !== state.verbRoundTransitionId) return;
    state.verbInterstitialRobotPath = path;
    renderVerbRoundInterstitial();
  });
  const hintPromise = state.verbHintsEnabled
    ? preloadVerbHintsForRound(nextRound.round)
    : Promise.resolve(null);
  let preloadedHints = null;
  await Promise.all([
    waitForVerbTransition(verbRoundInterstitialMillis),
    robotPromise,
    hintPromise.then((hints) => {
      preloadedHints = hints;
    })
  ]);
  if (transitionId !== state.verbRoundTransitionId) return;
  applyVerbRound(nextRound, preloadedHints);
}

function preloadVerbHintAsset(assetPath) {
  const path = String(assetPath || verbHintFallbackPath);
  return new Promise((resolve) => {
    const image = new Image();
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      image.onload = null;
      image.onerror = null;
      resolve();
    };
    const timer = window.setTimeout(finish, verbHintImageTimeoutMillis);
    image.onload = finish;
    image.onerror = finish;
    image.src = path;
    if (image.complete) {
      if (typeof image.decode === "function") image.decode().catch(() => {}).finally(finish);
      else finish();
    }
  });
}

async function transitionToNextVerbRound({ holdMillis = verbRoundCompleteHoldMillis } = {}) {
  if (state.verbGuidedRequested) {
    state.verbGuidedStatus = "complete";
    state.verbRoundTransitioning = false;
    setVerbMatchFeedback("Developer Guided pilot complete. This round will not repeat automatically.", "correct");
    renderVerbNebula();
    return;
  }
  if (state.verbRoundTransitioning || !state.verbRound.length) return;
  clearVerbSolutionAdvance();
  const transitionId = state.verbRoundTransitionId + 1;
  state.verbRoundTransitionId = transitionId;
  state.verbRoundTransitioning = true;
  state.verbSolutionRevealed = false;
  state.verbHintRequestId += 1;
  resetVerbSelections();

  renderVerbNebula();
  await waitForVerbTransition(Math.max(0, holdMillis));
  if (transitionId !== state.verbRoundTransitionId) return;
  await prepareVerbRound(planVerbRound(), transitionId);
}

function clearVerbSolutionAdvance() {
  if (state.verbSolutionAdvanceTimer !== null) {
    window.clearTimeout(state.verbSolutionAdvanceTimer);
    state.verbSolutionAdvanceTimer = null;
  }
}

async function toggleVerbSolution() {
  if (verbRoundComplete()
      || state.verbRoundTransitioning
      || state.verbGuidedEvidencePending
      || verbGuidedInteractionLocked()) return;
  resetVerbSelections();
  clearVerbSolutionAdvance();
  if (state.verbSolutionRevealed) {
    state.verbSolutionRevealed = false;
    setVerbMatchFeedback("Match each Czech verb with its English meaning.");
    renderVerbNebula();
    return;
  }
  if (state.verbGuidedMode) {
    const guidedLifecycle = state.verbGuidedLifecycle;
    if (!guidedLifecycle?.state().firstResponseRecorded) {
      state.verbGuidedSupportAtFirstResponse = true;
    }
    state.verbGuidedEvidencePending = true;
    renderVerbNebula();
    try {
      await guidedLifecycle.recordSolutionReveal({ occurredAt: new Date().toISOString() });
      if (state.verbProgressResetPending || guidedLifecycle !== state.verbGuidedLifecycle) return;
    } catch (error) {
      state.verbGuidedStatus = "failed";
      state.verbGuidedError = error?.message || String(error);
      setVerbMatchFeedback("The solution stayed hidden because its evidence could not be saved.", "wrong");
      return;
    } finally {
      state.verbGuidedEvidencePending = false;
      renderVerbNebula();
    }
  }
  state.verbSolutionRevealed = true;
  setVerbMatchFeedback(
    "Follow the arrows to review every pair.",
    "hint"
  );
  renderVerbNebula();
  if (!state.verbGuidedMode) {
    const revealDuration = verbSolutionRevealDuration(state.verbRound.length);
    state.verbSolutionAdvanceTimer = window.setTimeout(() => {
      state.verbSolutionAdvanceTimer = null;
      if (!state.verbSolutionRevealed || state.verbRoundTransitioning) return;
      void transitionToNextVerbRound({ holdMillis: 0 });
    }, revealDuration);
  }
}

function recordVerbSemanticAttempt(pair, {
  correct,
  chosenEnglish = "",
  roundComplete = false
} = {}) {
  const semanticLearning = window.CaatuuSemanticLearning;
  if (!semanticLearning || !pair?.id || !pair?.eng) return;
  const hint = state.verbHintById.get(pair.id);
  const hintShown = Boolean(state.verbHintsEnabled && hint && hint.status !== "loading");
  const solutionShown = Boolean(state.verbSolutionRevealed);
  const totalWeight = solutionShown ? 0.25 : (hintShown ? 0.65 : 1);
  const masteryWeight = solutionShown ? 0 : totalWeight;
  const score = solutionShown ? null : (correct ? 1 : 0);
  const signalWeight = totalWeight / 2;
  const signalMasteryWeight = masteryWeight / 2;
  void semanticLearning.recordAttempt({
    activityId: "verb-nebula",
    itemId: `verb-nebula:${pair.id}`,
    item: {
      sourceId: pair.id,
      sourceIndex: pair.sourceIndex,
      czech: pair.cz,
      english: pair.eng,
      difficulty: pair.difficulty
    },
    signals: [
      {
        conceptId: `cz.verb.${pair.id}.meaning`,
        statementRevision: "1",
        kind: "meaning",
        locale: "en",
        text: `Understands the Czech verb meaning “${pair.eng}”.`,
        score,
        coverageWeight: signalWeight,
        masteryWeight: signalMasteryWeight
      },
      {
        conceptId: `cz.verb.${pair.id}.meaning-match`,
        statementRevision: "1",
        kind: "skill",
        locale: "en",
        text: `Recognizes a Czech verb and matches it to the English meaning “${pair.eng}”.`,
        score,
        coverageWeight: signalWeight,
        masteryWeight: signalMasteryWeight
      }
    ],
    context: {
      correct: Boolean(correct),
      chosenEnglish,
      expectedEnglish: pair.eng,
      courseDifficulty: state.verbDifficulty,
      pairCount: state.verbPairCount,
      roundNumber: state.verbRoundNumber,
      roundComplete: Boolean(roundComplete),
      hintsEnabled: state.verbHintsEnabled,
      hintShown,
      hintStatus: hint?.status || "",
      solutionShown
    }
  }).catch(() => {});
}

async function settleVerbMatch() {
  const czechId = state.verbSelectedCzechId;
  const englishId = state.verbSelectedEnglishId;
  if (
    !czechId
    || !englishId
    || state.verbWrongTimer
    || state.verbGuidedEvidencePending
    || verbGuidedInteractionLocked()
  ) return;

  const correct = verbNebulaCore.verbPairMatches(czechId, englishId);
  const isGuidedTargetAttempt = state.verbGuidedMode
    && czechId === state.verbGuidedTargetId
    && !state.verbGuidedLifecycle.state().firstResponseRecorded;
  if (isGuidedTargetAttempt) {
    const guidedLifecycle = state.verbGuidedLifecycle;
    const supportState = guidedLifecycle.state();
    state.verbGuidedSupportAtFirstResponse = Boolean(
      supportState.hintsUsed || supportState.solutionRevealed
    );
    state.verbGuidedEvidencePending = true;
    renderVerbNebula();
    try {
      await guidedLifecycle.recordFirstResponse({
        score: correct ? 1 : 0,
        occurredAt: new Date().toISOString()
      });
      if (state.verbProgressResetPending || guidedLifecycle !== state.verbGuidedLifecycle) return;
    } catch (error) {
      state.verbGuidedStatus = "failed";
      state.verbGuidedError = error?.message || String(error);
      setVerbMatchFeedback("Your answer stayed unscored because its evidence could not be saved.", "wrong");
      state.verbGuidedEvidencePending = false;
      renderVerbNebula();
      return;
    }
    state.verbGuidedEvidencePending = false;
  }

  state.verbStats.attempts += 1;
  if (correct) {
    const pair = state.verbRound.find((item) => item.id === czechId);
    state.verbStats.matches += 1;
    state.verbMatchedIds.add(czechId);
    resetVerbSelections();

    const roundComplete = verbRoundComplete();
    if (roundComplete) {
      state.verbStats.rounds += 1;
      state.verbRoundRewardXp = state.verbGuidedMode ? 0 : state.verbRound.length;
      setVerbMatchFeedback("Round complete.", "correct");
    } else {
      setVerbMatchFeedback(`${pair?.cz || "This verb"} means ${pair?.eng || "this meaning"}.`, "correct");
    }
    if (!state.verbGuidedMode) {
      window.CaatuuLearning?.record("verb-nebula", {
        activities: 1,
        attempts: 1,
        successes: 1,
        xp: 1,
        rounds: roundComplete ? 1 : 0
      });
      recordVerbSemanticAttempt(pair, {
        correct: true,
        chosenEnglish: pair?.eng || "",
        roundComplete
      });
    }
    saveVerbMemory();
    if (roundComplete && state.verbGuidedMode) {
      state.verbGuidedStatus = "complete";
      setVerbMatchFeedback("Developer Guided pilot complete. Unit 3 remains locked behind Units 1–2.", "correct");
    }
    renderVerbNebula();
    if (roundComplete && !state.verbGuidedMode) {
      if (state.campaignActive) void completeCampaignRound("verb-lab", window);
      else void transitionToNextVerbRound();
    }
    return;
  }

  // Qualify the wrong selections by side. Pair ids exist in both columns, so
  // storing bare ids would also mark the two correct counterparts and reveal
  // the answer during the mistake animation.
  state.verbWrongIds = new Set([`cz:${czechId}`, `en:${englishId}`]);
  const pair = state.verbRound.find((item) => item.id === czechId);
  const chosenPair = state.verbEnglishRound.find((item) => item.id === englishId);
  if (!state.verbGuidedMode) {
    window.CaatuuLearning?.record("verb-nebula", { activities: 1, attempts: 1 });
    recordVerbSemanticAttempt(pair, {
      correct: false,
      chosenEnglish: chosenPair?.eng || ""
    });
  }
  setVerbMatchFeedback("Those two do not match. Keep the Czech verb and try another meaning.", "wrong");
  saveVerbMemory();
  renderVerbNebula();
  state.verbWrongTimer = window.setTimeout(() => {
    state.verbSelectedEnglishId = "";
    state.verbWrongIds.clear();
    state.verbWrongTimer = null;
    renderVerbNebula();
  }, 560);
}

function chooseVerbMatchCard(event) {
  const card = event.target.closest("button[data-verb-side][data-verb-id]");
  if (!card || card.disabled || state.verbWrongTimer) return;
  const id = card.dataset.verbId;

  if (card.dataset.verbSide === "cz") {
    speakVerbCzechOnTap(id);
    state.verbSelectedCzechId = state.verbSelectedCzechId === id ? "" : id;
  } else {
    state.verbSelectedEnglishId = state.verbSelectedEnglishId === id ? "" : id;
  }

  syncVerbSelectedCards();
  if (state.verbSelectedCzechId && state.verbSelectedEnglishId) {
    void trackVerbGuidedOperation(settleVerbMatch);
  }
}

function syncVerbSelectedCards() {
  document.querySelectorAll("button[data-verb-side][data-verb-id]").forEach((button) => {
    const selected = button.dataset.verbSide === "cz"
      ? state.verbSelectedCzechId === button.dataset.verbId
      : state.verbSelectedEnglishId === button.dataset.verbId;
    button.setAttribute("aria-pressed", String(selected));
    button.classList.toggle("is-selected", selected);
  });
}

function changeVerbPairCount(event) {
  const button = event.target.closest("[data-verb-pair-count]");
  if (!button || state.verbRoundTransitioning || state.verbGuidedRequested) return;
  button.closest("details")?.removeAttribute("open");
  const nextCount = verbNebulaCore.normalizeVerbPairCount(button.dataset.verbPairCount, state.verbPairCount);
  if (nextCount === state.verbPairCount) return;
  state.verbPairCount = nextCount;
  saveVerbMemory();
  setVerbMatchFeedback(`${nextCount} pairs will appear in the next round.`, "hint");
  renderVerbNebula();
}

function verbHintTokens(value) {
  return (String(value || "").toLowerCase().match(/[a-z0-9]+/g) || [])
    .filter((token) => token.length > 1 && !verbHintStopwords.has(token));
}

function normalizeVerbHintPath(value) {
  const path = String(value || "").trim().replaceAll("\\", "/");
  const normalized = path.startsWith("assets/") ? `/${path}` : path;
  return normalized.startsWith("/assets/macaw/actions/") ? normalized : "";
}

function isChildSafeVerbHintAsset(assetPath, action = "") {
  const normalizedPath = normalizeVerbHintPath(assetPath);
  return Boolean(childFacingAssets?.isChildFacingMacawActionAssetAllowed(normalizedPath, action));
}

function vectorVerbHintCandidates(pair) {
  const englishText = verbNebulaCore.verbHintSearchText(pair);
  return runtimeAdapter().vector.search(englishText, {
    limit: 10,
    sourceKinds: ["macaw_action_asset"]
  }).then((response) => (Array.isArray(response?.results) ? response.results : [])
    .filter((row) => row?.sourceKind === "macaw_action_asset")
    .map((row) => ({
      assetPath: normalizeVerbHintPath(
        row.documentMetadata?.asset_path
          || row.chunkMetadata?.asset_path
          || row.sourceId
      ),
      alt: row.text || "Picture clue",
      score: 100 + (Number.isFinite(Number(row.score)) ? Number(row.score) : 0)
    }))
    .filter((row) => isChildSafeVerbHintAsset(row.assetPath)));
}

async function loadVerbHintKeymap() {
  if (!state.verbHintKeymapPromise) {
    state.verbHintKeymapPromise = fetch(verbHintKeymapUrl, { cache: "force-cache" })
      .then((response) => {
        if (!response.ok) throw new Error(`Could not load Macaw keymap (${response.status}).`);
        return response.json();
      })
      .then((raw) => Object.entries(raw || {}).map(([path, metadata]) => ({
        assetPath: normalizeVerbHintPath(path),
        action: String(metadata?.action || "").replaceAll("_", " "),
        description: String(metadata?.description || "")
      })).filter((row) => isChildSafeVerbHintAsset(row.assetPath, row.action)))
      .catch(() => []);
  }
  return state.verbHintKeymapPromise;
}

async function fallbackVerbHintCandidates(pair) {
  const englishText = verbNebulaCore.verbHintSearchText(pair);
  const queryTokens = new Set(verbHintTokens(englishText));
  if (!queryTokens.size) return [];
  const rows = await loadVerbHintKeymap();
  return rows
    .map((row) => {
      const actionText = row.action.toLowerCase().trim();
      const candidateTokens = new Set(verbHintTokens(`${row.action} ${row.description}`));
      let shared = 0;
      queryTokens.forEach((token) => {
        if (candidateTokens.has(token)) shared += 1;
      });
      const exact = actionText === englishText.toLowerCase() ? 2 : 0;
      return {
        assetPath: row.assetPath,
        alt: row.description || "Picture clue",
        score: 50 + exact + shared / queryTokens.size
      };
    })
    .filter((row) => row.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 10);
}

function stableVerbHintOffset(value, length) {
  if (!length) return 0;
  let hash = 0;
  Array.from(String(value || "")).forEach((character) => {
    hash = ((hash * 31) + character.codePointAt(0)) >>> 0;
  });
  return hash % length;
}

function genericVerbHintCandidates(pair, rows) {
  if (!rows.length) return [];
  const offset = stableVerbHintOffset(verbNebulaCore.verbHintSearchText(pair), rows.length);
  return rows.map((_, rank) => {
    const row = rows[(offset + rank) % rows.length];
    return {
      assetPath: row.assetPath,
      alt: row.description || "Macaw picture clue",
      score: -100 - rank
    };
  });
}

function mergeVerbHintCandidates(...candidateGroups) {
  const byPath = new Map();
  candidateGroups.flat().forEach((candidate) => {
    if (!candidate?.assetPath) return;
    const current = byPath.get(candidate.assetPath);
    if (!current || Number(candidate.score) > Number(current.score)) {
      byPath.set(candidate.assetPath, candidate);
    }
  });
  return [...byPath.values()].sort((left, right) => Number(right.score) - Number(left.score));
}

function loadableVerbHint(candidates, pair) {
  return new Promise((resolve) => {
    const tryCandidate = (index) => {
      const candidate = candidates[index];
      if (!candidate) {
        resolve(null);
        return;
      }
      const image = new Image();
      const candidateTimer = window.setTimeout(() => {
        image.onload = null;
        image.onerror = null;
        tryCandidate(index + 1);
      }, verbHintImageTimeoutMillis);
      image.onload = () => {
        window.clearTimeout(candidateTimer);
        resolve({
          status: "ready",
          assetPath: candidate.assetPath,
          alt: candidate.alt || "Picture clue"
        });
      };
      image.onerror = () => {
        window.clearTimeout(candidateTimer);
        tryCandidate(index + 1);
      };
      image.src = candidate.assetPath;
    };
    tryCandidate(0);
  });
}

function cachedVerbHintCandidates(pair) {
  const key = verbNebulaCore.verbHintSearchText(pair).toLocaleLowerCase("en");
  const exactAsset = verbHintExactAssets.get(key);
  if (exactAsset) return Promise.resolve([{ ...exactAsset, score: 1000 }]);
  if (!state.verbHintCache.has(key)) {
    const lookup = Promise.all([
      vectorVerbHintCandidates(pair).catch(() => []),
      fallbackVerbHintCandidates(pair),
      loadVerbHintKeymap()
    ]).then(([vectorCandidates, lexicalCandidates, keymapRows]) => mergeVerbHintCandidates(
      vectorCandidates,
      lexicalCandidates,
      genericVerbHintCandidates(pair, keymapRows)
    )).catch(() => []);
    const deadline = new Promise((resolve) => {
      window.setTimeout(() => resolve([]), verbHintLookupTimeoutMillis);
    });
    const request = Promise.race([lookup, deadline]);
    state.verbHintCache.set(key, request);
  }
  return state.verbHintCache.get(key);
}

async function loadVerbHintsForRound() {
  if (!state.verbHintsEnabled || !state.verbRound.length) return;
  const requestId = state.verbHintRequestId + 1;
  state.verbHintRequestId = requestId;
  state.verbHintById.clear();
  const round = [...state.verbRound];
  round.forEach((pair) => state.verbHintById.set(pair.id, { status: "loading" }));
  setVerbMatchFeedback("Loading picture clues…", "hint");
  renderVerbNebula();

  const hints = await preloadVerbHintsForRound(round);
  if (requestId !== state.verbHintRequestId || !state.verbHintsEnabled) return;
  round.forEach((pair) => state.verbHintById.set(pair.id, hints.get(pair.id) || {
    status: "ready",
    assetPath: verbHintFallbackPath,
    alt: "Macaw picture clue"
  }));
  setVerbMatchFeedback("Match each Czech verb with its English meaning.");
  renderVerbNebula();
}

function toggleVerbHints() {
  if (state.verbRoundTransitioning || verbGuidedInteractionLocked()) return;
  if (state.verbGuidedMode && !state.verbHintsEnabled) {
    try {
      state.verbGuidedLifecycle.markHint("picture-clue");
    } catch (error) {
      state.verbGuidedStatus = "failed";
      state.verbGuidedError = error?.message || String(error);
      setVerbMatchFeedback("The clue stayed hidden because support could not be recorded.", "wrong");
      renderVerbNebula();
      return;
    }
  }
  state.verbHintsEnabled = !state.verbHintsEnabled;
  state.verbHintRequestId += 1;
  state.verbHintById.clear();
  saveVerbMemory();
  setVerbMatchFeedback(
    state.verbHintsEnabled
      ? "Loading picture clues…"
      : "Match each Czech verb with its English meaning.",
    state.verbHintsEnabled ? "hint" : ""
  );
  renderVerbNebula();
}

function cancelVerbRoundTransition() {
  clearVerbSolutionAdvance();
  state.verbRoundTransitionId += 1;
  state.verbRoundTransitioning = false;
  state.verbRoundInterstitial = false;
  state.verbRoundRewardXp = 0;
  state.verbSolutionRevealed = false;
  state.verbInterstitialRobotPath = "";
}

function rebaseVerbDifficulty() {
  if (!state.verbMemoryLoaded || state.verbGuidedRequested) return;

  // Persist the old pool before rebuilding. loadVerbMemory deliberately
  // refuses to restore that round when its recorded level differs from the
  // newly selected course difficulty.
  saveVerbMemory();
  cancelVerbRoundTransition();
  state.verbMemoryLoaded = false;
  state.verbPairs = [];
  state.verbQueueIds = [];
  state.verbRound = [];
  state.verbEnglishRound = [];
  state.verbMatchedIds = new Set();
  state.verbHintRequestId += 1;
  state.verbHintById.clear();
  resetVerbSelections();
  loadVerbMemory();
  startVerbRound();
}

function resetVerbProgress() {
  cancelVerbRoundTransition();
  returnUnmatchedVerbsToQueue();
  state.verbStats = emptyVerbStats();
  state.verbRound = [];
  state.verbEnglishRound = [];
  state.verbMatchedIds = new Set();
  state.verbRoundNumber = 0;
  startVerbRound();
}

async function prepareVerbProgressReset() {
  if (!state.verbGuidedRequested
      && !state.verbGuidedLifecycle
      && !state.verbGuidedActivationPromise) return;
  state.verbProgressResetPending = true;
  state.verbGuidedActivationEpoch += 1;
  renderVerbNebula();

  const lifecycle = state.verbGuidedLifecycle;
  const aborting = lifecycle?.abort?.() || Promise.resolve();
  const pending = [
    state.verbGuidedActivationPromise,
    ...state.verbGuidedOperations
  ].filter(Boolean);
  if (pending.length) await Promise.allSettled(pending);
  await aborting;
  if (state.verbGuidedLifecycle === lifecycle) state.verbGuidedLifecycle = null;
  state.verbGuidedActivationPromise = null;
  state.verbGuidedEvidencePending = false;
}

function resetGuidedVerbRuntimeState() {
  state.verbGuidedActivationEpoch += 1;
  state.verbGuidedActivationPromise = null;
  state.verbGuidedStartPromise = null;
  state.verbGuidedLifecycle = null;
  state.verbGuidedMode = false;
  state.verbGuidedStatus = "loading";
  state.verbGuidedError = "";
  state.verbGuidedPlan = null;
  state.verbGuidedTargetId = "";
  state.verbGuidedResolution = null;
  state.verbGuidedEvidencePending = false;
  state.verbGuidedSupportAtFirstResponse = false;
  state.verbGuidedFirstResponseQualified = null;
  state.verbGuidedCatalog = [];
  state.verbGuidedTargetPair = null;
  state.verbGuidedContrastPairs = [];
}

function restartGuidedVerbRuntimeAfterReset({ resetCompleted = true } = {}) {
  state.verbProgressResetPending = false;
  resetGuidedVerbRuntimeState();
  setVerbMatchFeedback(
    resetCompleted
      ? "Preparing the Developer Guided meaning pilot again."
      : "The restart was cancelled. Rechecking the existing Guided task.",
    resetCompleted ? "" : "wrong"
  );
  renderVerbNebula();
  void initializeVerbGuidedMode().then(() => {
    state.verbMemoryLoaded = false;
    renderVerbNebula();
  }).catch((error) => {
    state.verbGuidedStatus = "failed";
    state.verbGuidedError = error?.message || String(error);
    setVerbMatchFeedback(
      resetCompleted
        ? "Course progress was cleared, but the Guided meaning pilot could not be prepared."
        : "The existing Guided task could not be restored after the cancelled restart.",
      "wrong"
    );
    renderVerbNebula();
  });
}

function clearVerbMemory({ confirmed = false } = {}) {
  const resetButton = $("#settingsResetCourseProgress");
  if (!confirmed && !confirmDestructiveAction(resetButton, {
    confirmLabel: "Confirm restart",
    message: "Restart course progress? Difficulty, downloads, and cache will be kept."
  })) {
    setText("#maintenanceStatus", "Press Restart again to clear course progress.");
    return;
  }

  try {
    localStorage.removeItem(verbStorageKey);
    if (verbLegacyStorageKey) localStorage.removeItem(verbLegacyStorageKey);
  } catch (error) {
    console.warn("Could not clear Verb Nebula memory", error);
  }
  cancelVerbRoundTransition();
  state.verbMemoryLoaded = false;
  state.verbDifficulty = 1;
  state.verbPairs = [];
  state.verbQueueIds = [];
  state.verbRound = [];
  state.verbEnglishRound = [];
  state.verbMatchedIds = new Set();
  state.verbPairCount = 4;
  state.verbRoundNumber = 0;
  state.verbStats = emptyVerbStats();
  state.verbHintsEnabled = false;
  state.verbHintRequestId += 1;
  state.verbHintById.clear();
  state.verbHintCache.clear();
  resetVerbSelections();
  loadVerbMemory();
  if (state.verbGuidedRequested) {
    restartGuidedVerbRuntimeAfterReset();
  } else {
    startVerbRound();
  }
  setText("#maintenanceStatus", "Course progress restarted. Difficulty, downloads, and cache were preserved.");
}

function bindVerbNebulaControls() {
  $("#trainPanelVerbLab")?.addEventListener("click", (event) => {
    if (event.target.closest("#verbSpeakOnTap")) {
      state.verbSpeakOnTap = !state.verbSpeakOnTap;
      saveVerbSpeakOnTap();
      renderVerbAudioControls();
      if (state.verbSpeakOnTap) void refreshVerbAudioVoiceControls();
    } else if (event.target.closest("button[data-verb-side]")) chooseVerbMatchCard(event);
    else if (event.target.closest("[data-verb-pair-count]")) changeVerbPairCount(event);
  });
  document.querySelectorAll("#verbMeaningBoard details.verb-toolbar-menu").forEach((menu) => {
    menu.addEventListener("toggle", () => {
      if (!menu.open) return;
      closeVerbToolbarMenus(menu);
      if (menu.classList.contains("verb-display-menu")) renderVerbDisplayControls();
      if (menu.classList.contains("verb-audio-menu") && state.verbSpeakOnTap) {
        void refreshVerbAudioVoiceControls();
      }
    });
  });
  document.querySelector(".verb-display-menu")?.addEventListener("click", (event) => {
    if (!event.target.closest("[data-theme-option], [data-font-size-option]")) return;
    window.requestAnimationFrame(renderVerbDisplayControls);
  });
  $("#verbAudioSpeed")?.addEventListener("input", (event) => {
    const paceOrder = ["slower", "slow", "normal"];
    const paceIndex = Math.max(0, Math.min(paceOrder.length - 1, Math.round(Number(event.currentTarget.value) || 0)));
    window.CaatuuChrome?.setSpeechPacePreference?.(paceOrder[paceIndex]);
    renderVerbAudioControls();
  });
  $("#verbAudioVoice")?.addEventListener("change", async (event) => {
    const select = event.currentTarget;
    select.disabled = true;
    await window.CaatuuChrome?.stopCzechSpeech?.();
    window.CaatuuChrome?.setSpeechVoicePreference?.(select.value);
    await refreshVerbAudioVoiceControls();
  });
  document.querySelector("#verbMeaningBoard .verb-match-control-cluster")?.addEventListener("click", (event) => {
    if (event.target.closest("details.verb-toolbar-menu")) return;
    closeVerbToolbarMenus();
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest("#verbMeaningBoard .verb-match-control-cluster")) closeVerbToolbarMenus();
  });
  $("#verbHintButton")?.addEventListener("click", toggleVerbHints);
  $("#verbRevealSolution")?.addEventListener("click", () => {
    void trackVerbGuidedOperation(toggleVerbSolution);
  });
  window.addEventListener("resize", () => {
    if (state.verbSolutionRevealed) renderVerbSolutionArrows();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") deferVerbGuidedActivation();
    else if (state.trainTab === "verb-lab") renderVerbNebula();
  });
  window.addEventListener("caatuu:speech-pace-change", renderVerbAudioControls);
  window.addEventListener("caatuu:speech-voice-change", () => {
    if (state.verbSpeakOnTap && document.querySelector(".verb-audio-menu")?.open) {
      void refreshVerbAudioVoiceControls();
    }
  });
}

function printOptions() {
  return {
    paper: $("#printPaper").value,
    orientation: $("#printOrientation").value,
    columns: Number($("#printColumns").value),
    rows: Number($("#printRows").value),
    gap: Number($("#printGap").value),
    joinMargin: Number($("#printJoinMargin").value),
    textScale: Number($("#printTextScale").value),
    sides: $("#printSides").value,
    includeGuide: $("#printIncludeGuide").checked,
    includeDictionary: $("#printIncludeDictionary").checked,
    includeScripts: $("#printIncludeScripts").checked,
    blankRows: Number($("#printBlankRows").value),
    fillBlankRows: $("#printFillBlankRows").checked,
    cutMarks: $("#printCutMarks").checked,
    pageNumbers: $("#printPageNumbers").checked
  };
}

function applyPrintDefaults() {
  $("#printOrientation").value = defaultPrintOptions.orientation;
  $("#printColumns").value = defaultPrintOptions.columns;
  $("#printRows").value = defaultPrintOptions.rows;
  $("#printGap").value = defaultPrintOptions.gap;
  $("#printJoinMargin").value = defaultPrintOptions.joinMargin;
  $("#printTextScale").value = defaultPrintOptions.textScale;
  $("#printSides").value = defaultPrintOptions.sides;
  $("#printIncludeGuide").checked = defaultPrintOptions.includeGuide;
  $("#printIncludeDictionary").checked = defaultPrintOptions.includeDictionary;
  $("#printIncludeScripts").checked = defaultPrintOptions.includeScripts;
  $("#printFillBlankRows").checked = defaultPrintOptions.fillBlankRows;
}

function paperSize(options) {
  const preset = paperPresets[options.paper] || paperPresets.a4;
  const isLandscape = options.orientation === "landscape";
  return {
    ...preset,
    width: isLandscape ? preset.height : preset.width,
    height: isLandscape ? preset.width : preset.height,
    orientation: options.orientation
  };
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function splitRows(rows, size) {
  const chunks = [];
  for (let index = 0; index < rows.length; index += size) chunks.push(rows.slice(index, index + size));
  return chunks;
}

function titledPages(type, title, rows, size) {
  return splitRows(rows, size).map((chunk, index, chunks) => ({
    type,
    title: chunks.length > 1 ? `${title} ${index + 1}/${chunks.length}` : title,
    rows: chunk
  }));
}

function guideTextPages(title, rows, layout) {
  const size = layout && layout.pageSlots <= 8 ? 8 : 6;
  return titledPages("guide", title, rows, size);
}

function guideModelPages(title, rows, layout) {
  const size = layout && layout.pageSlots <= 8 ? 4 : 3;
  return titledPages("guide-models", title, rows, size);
}

function guidePageCapacity(layout) {
  if (!layout) return 26;
  if (layout.pageSlots <= 4) return 31;
  if (layout.pageSlots <= 8) return 28;
  return 26;
}

function guideRowUnits(item, layout) {
  if (item.type === "section") return 0.9;
  if (item.type === "model-row") return layout && layout.pageSlots <= 8 ? 3.15 : 3.45;

  const leftLimit = layout && layout.pageSlots <= 8 ? 16 : 12;
  const rightLimit = layout && layout.pageSlots <= 8 ? 48 : 34;
  const lines = Math.max(
    1,
    estimatedLines(item.left, leftLimit),
    estimatedLines(item.right, rightLimit)
  );
  return lines * 1.15;
}

function packGuideItems(items, layout) {
  const capacity = guidePageCapacity(layout);
  const pages = [];
  let pageRows = [];
  let usedUnits = 0;

  const pushPage = () => {
    if (!pageRows.length) return;
    pages.push({ type: "guide-flow", title: "Guide", rows: pageRows });
    pageRows = [];
    usedUnits = 0;
  };

  items.forEach((item) => {
    const units = guideRowUnits(item, layout);
    if (pageRows.length && usedUnits + units > capacity && item.type !== "section") pushPage();
    if (item.type === "section" && pageRows.length && usedUnits + units > capacity - 1) pushPage();
    pageRows.push(item);
    usedUnits += units;
  });

  pushPage();
  return pages;
}

function guideRowsFromList(list) {
  return [...list.querySelectorAll("li")].map((item) => {
    const text = cleanText(item.textContent);
    const separator = text.indexOf(":");
    if (separator === -1) return ["Note", text];
    return [text.slice(0, separator), text.slice(separator + 1).trim()];
  });
}

function guideRowsFromCodeLedger(ledger) {
  return [...ledger.querySelectorAll("span")].map((item) => {
    const code = cleanText(item.querySelector("code")?.textContent);
    const full = cleanText(item.textContent);
    return [code, cleanText(full.slice(code.length))];
  });
}

function guideRowsFromTable(table, note) {
  const headers = [...table.querySelectorAll("thead th")].map((cell) => cleanText(cell.textContent));
  const rows = [];
  if (note) rows.push(["Note", note]);

  table.querySelectorAll("tbody tr").forEach((row) => {
    const cells = [...row.children].map((cell) => cleanText(cell.textContent));
    rows.push([
      cells[0],
      cells.slice(1).map((cell, index) => {
        const header = headers[index + 1];
        return header ? `${header}: ${cell}` : cell;
      }).join(" · ")
    ]);
  });

  return rows;
}

function modelRowsFromTable(table) {
  return [...table.querySelectorAll("tbody tr")].map((row) => {
    const cells = [...row.children];
    return {
      code: cleanText(cells[0]?.textContent),
      use: cleanText(cells[1]?.textContent),
      endings: cleanText(cells[2]?.textContent),
      cases: [...row.querySelectorAll(".case-pair")].map((pair) => {
        const label = cleanText(pair.querySelector("code")?.textContent);
        const form = cleanText(pair.textContent).slice(label.length).trim();
        return { label, form };
      })
    };
  });
}

function guideItemsFromCard(card) {
  const title = cleanText(card.querySelector("h3")?.textContent);
  if (!title) return [];

  const rows = [{ type: "section", title }];
  const note = cleanText(card.querySelector(".guide-note")?.textContent);
  const count = cleanText(card.querySelector(".count-pill")?.textContent);
  const sample = card.querySelector(".sample-entry");
  const list = card.querySelector(".plain-steps");
  const ledger = card.querySelector(".code-ledger");
  const table = card.querySelector("table");
  const addRow = ([left, right]) => rows.push({ type: "guide-row", left, right });

  if (count) addRow(["Marker", count]);
  if (sample) {
    addRow(["Sample top", [...sample.querySelectorAll(".dict-word > *")].map((node) => cleanText(node.textContent)).join(" · ")]);
    addRow(["Sample bottom", [...sample.querySelectorAll(".dict-example > *")].map((node) => cleanText(node.textContent)).join(" · ")]);
  }
  if (list) guideRowsFromList(list).forEach(addRow);
  if (ledger) guideRowsFromCodeLedger(ledger).forEach(addRow);
  if (table?.classList.contains("model-matrix")) {
    if (note) addRow(["Note", note]);
    addRow(["Columns", [...table.querySelectorAll("thead th")].map((cell) => cleanText(cell.textContent)).join(" · ")]);
    modelRowsFromTable(table).forEach((row) => rows.push({ type: "model-row", ...row }));
    return rows;
  }
  if (table) guideRowsFromTable(table, note).forEach(addRow);
  else if (note) rows.splice(1, 0, { type: "guide-row", left: "Note", right: note });

  return rows;
}

function guidePrintPages(layout) {
  const cover = {
    type: "cover",
    title: "Caatuu Czech",
    lines: ["by Waajacu™", "Pocket dictionary", `${countryDictionary.length} words and phrases`, `${categories().length} groups + ${countryScripts.length} scripts`]
  };
  const guide = $("#view-dictionary");
  if (!guide) return [cover];

  const guidePages = [...guide.querySelectorAll(".guide-card")]
    .flatMap((card) => packGuideItems(guideItemsFromCard(card), layout))
    .map((page, index, all) => ({ ...page, title: `Guide ${index + 1}/${all.length}` }));

  return [
    cover,
    ...guidePages
  ];
}

function renderPrintDictionaryRows(rows) {
  return rows.map((row) => {
    if (row.type === "blank") {
      return `
        <div class="print-entry blank">
          <div class="print-entry-top">
            <b></b>
            <span></span>
            <small></small>
          </div>
          <div class="print-entry-bottom">
            <em></em>
            <code></code>
          </div>
        </div>
      `;
    }

    const item = row.item;
    return `
      <div class="print-entry">
        <div class="print-entry-top">
          <b>${escapeHtml(item.cs)}</b>
          <span>${escapeHtml(item.en)}</span>
          <small>${escapeHtml(item.kind)}</small>
        </div>
        <div class="print-entry-bottom">
          <em>${escapeHtml(item.use)}</em>
          <code>${escapeHtml(item.cue)}</code>
        </div>
      </div>
    `;
  }).join("");
}

function createDictionaryPageMeasure(options, layout) {
  const joinClass = measurementJoinClass(options, layout);
  const measureBook = document.createElement("section");
  measureBook.className = "print-book";
  measureBook.setAttribute("aria-hidden", "true");
  measureBook.style.cssText = [
    "display:block",
    "position:absolute",
    "left:-10000px",
    "top:0",
    "width:var(--paper-width, 297mm)",
    "padding:0",
    "visibility:hidden",
    "pointer-events:none"
  ].join(";");
  applyPrintBookVariables(measureBook, options, layout);
  measureBook.innerHTML = `
    <section class="print-sheet">
      <div class="print-grid">
        <article class="print-pocket-page${joinClass ? ` ${joinClass}` : ""}">
          <header class="print-page-head">
            <span></span>
            ${pageNumber({ logicalNumber: 999 }, options)}
          </header>
          <div class="print-page-body"></div>
        </article>
      </div>
    </section>
  `;
  document.body.append(measureBook);

  const titleNode = measureBook.querySelector(".print-page-head span:first-child");
  const body = measureBook.querySelector(".print-page-body");
  const tolerance = 1;

  const setRows = (title, rows) => {
    titleNode.textContent = title;
    body.innerHTML = renderPrintDictionaryRows(rows);
  };

  const fits = (title, rows) => {
    setRows(title, rows);
    return body.scrollHeight <= body.clientHeight + tolerance;
  };

  const fillWithBlanks = (title, rows) => {
    const filled = [...rows];
    while (filled.length < 200 && fits(title, [...filled, { type: "blank" }])) filled.push({ type: "blank" });
    return filled;
  };

  return { fits, fillWithBlanks, destroy: () => measureBook.remove() };
}

function measurementJoinClass(options, layout) {
  if (!options.joinMargin) return "";

  if (options.sides === "booklet") {
    const pairs = bookletSlotPairs(layout);
    const hasHorizontalPair = pairs.some(([firstSlot, secondSlot]) => {
      const first = slotPosition(firstSlot, layout);
      const second = slotPosition(secondSlot, layout);
      return first.row === second.row;
    });
    return hasHorizontalPair ? "join-left" : "join-top";
  }

  return "join-left";
}

function dictionaryPrintPages(options, layout) {
  const measure = createDictionaryPageMeasure(options, layout);
  try {
    return categories().flatMap((category) => {
      const rows = countryDictionary
        .filter((item) => item.cat === category)
        .map((item) => ({ type: "entry", item }));
      const blanks = Array.from({ length: options.blankRows }, () => ({ type: "blank" }));
      const allRows = [...rows, ...blanks];
      const pages = [];
      let pageRows = [];

      const pushPage = () => {
        if (!pageRows.length) return;
        pages.push({
          type: "dictionary",
          title: category,
          rows: pageRows
        });
        pageRows = [];
      };

      allRows.forEach((row) => {
        if (pageRows.length && !measure.fits(category, [...pageRows, row])) pushPage();
        pageRows.push(row);
      });

      pushPage();
      balanceDictionaryPages(category, pages, measure);
      if (options.fillBlankRows) {
        pages.forEach((page) => {
          page.rows = measure.fillWithBlanks(category, page.rows);
        });
      }

      return pages;
    });
  } finally {
    measure.destroy();
  }
}

function balanceDictionaryPages(category, pages, measure) {
  if (pages.length < 2) return;

  const lastPage = pages[pages.length - 1];
  const previousPage = pages[pages.length - 2];
  const hasManualBlanks = [...lastPage.rows, ...previousPage.rows].some((row) => row.type === "blank");
  if (hasManualBlanks) return;

  const minimumLastEntries = 3;
  const entryCount = (page) => page.rows.filter((row) => row.type === "entry").length;

  while (entryCount(lastPage) < minimumLastEntries && entryCount(previousPage) > minimumLastEntries) {
    const moved = previousPage.rows.pop();
    lastPage.rows.unshift(moved);

    if (!measure.fits(category, previousPage.rows) || !measure.fits(category, lastPage.rows)) {
      lastPage.rows.shift();
      previousPage.rows.push(moved);
      break;
    }
  }
}

function scriptPrintPages() {
  return countryScripts.map((script) => ({
    type: "script",
    title: script.title,
    goal: script.goal,
    rows: script.lines
  }));
}

function logicalPrintPages(options, layout) {
  const pages = [];

  if (options.includeGuide) pages.push(...guidePrintPages(layout));
  if (options.includeDictionary) pages.push(...dictionaryPrintPages(options, layout));
  if (options.includeScripts) pages.push(...scriptPrintPages());

  return pages.map((page, index) => ({ ...page, logicalNumber: index + 1 }));
}

function blankPocketPage() {
  return { type: "empty", title: "", rows: [] };
}

function paddedPages(pages, size) {
  const padded = [...pages];
  while (padded.length % size) padded.push(blankPocketPage());
  return padded;
}

function mirrorColumns(slots, layout) {
  const mirrored = [];
  for (let row = 0; row < layout.rows; row += 1) {
    const start = row * layout.cols;
    mirrored.push(...slots.slice(start, start + layout.cols).reverse());
  }
  return mirrored;
}

function mirrorRows(slots, layout) {
  const mirrored = [];
  for (let row = layout.rows - 1; row >= 0; row -= 1) {
    const start = row * layout.cols;
    mirrored.push(...slots.slice(start, start + layout.cols));
  }
  return mirrored;
}

function mirrorBackSlots(slots, options, layout) {
  return options.orientation === "landscape" ? mirrorRows(slots, layout) : mirrorColumns(slots, layout);
}

function landscapeRowCorrectedBackSlots(slots, options, layout) {
  const mirrored = mirrorBackSlots(slots, options, layout);
  return options.orientation === "landscape" ? mirrorRows(mirrored, layout) : mirrored;
}

function sheetLabel(sheetNumber, side) {
  return `Sheet ${sheetNumber} ${side}`;
}

function singleSidedPrintSides(pages, layout) {
  const padded = paddedPages(pages, layout.pageSlots);
  const sides = [];

  for (let start = 0; start < padded.length; start += layout.pageSlots) {
    sides.push({ label: `Sheet ${sides.length + 1}`, pages: padded.slice(start, start + layout.pageSlots) });
  }

  return sides;
}

function duplexCutStackSides(pages, options, layout) {
  const blockSize = layout.pageSlots * 2;
  const padded = paddedPages(pages, blockSize);
  const sides = [];

  for (let start = 0; start < padded.length; start += blockSize) {
    const block = padded.slice(start, start + blockSize);
    const front = [];
    const back = [];

    for (let slot = 0; slot < layout.pageSlots; slot += 1) {
      front.push(block[slot * 2] || blankPocketPage());
      back.push(block[slot * 2 + 1] || blankPocketPage());
    }

    const sheetNumber = sides.length / 2 + 1;
    sides.push({ label: sheetLabel(sheetNumber, "front"), pages: front });
    sides.push({ label: sheetLabel(sheetNumber, "back"), pages: landscapeRowCorrectedBackSlots(back, options, layout) });
  }

  return sides;
}

function bookletSlotPairs(layout) {
  const pairs = [];

  if (layout.cols % 2 === 0) {
    for (let row = 0; row < layout.rows; row += 1) {
      for (let column = 0; column + 1 < layout.cols; column += 2) {
        const left = row * layout.cols + column;
        pairs.push([left, left + 1]);
      }
    }
    return pairs;
  }

  if (layout.rows % 2 === 0) {
    for (let row = 0; row + 1 < layout.rows; row += 2) {
      for (let column = 0; column < layout.cols; column += 1) {
        const top = row * layout.cols + column;
        pairs.push([top, top + layout.cols]);
      }
    }
    return pairs;
  }

  for (let row = 0; row < layout.rows; row += 1) {
    for (let column = 0; column + 1 < layout.cols; column += 2) {
      const left = row * layout.cols + column;
      pairs.push([left, left + 1]);
    }
  }

  const lastColumn = layout.cols - 1;
  for (let row = 0; row + 1 < layout.rows; row += 2) {
    const top = row * layout.cols + lastColumn;
    pairs.push([top, top + layout.cols]);
  }

  return pairs;
}

function placeSpreadsInSlots(spreads, pairs, layout) {
  const slots = Array.from({ length: layout.pageSlots }, () => blankPocketPage());

  spreads.forEach(([leftPage, rightPage], index) => {
    const pair = pairs[index];
    if (!pair) return;
    slots[pair[0]] = leftPage;
    slots[pair[1]] = rightPage;
  });

  return slots;
}

function bookletBackSlots(slots, options, layout) {
  // Emit the back as the image sent to the printer; duplex printing mirrors it back onto the front.
  return mirrorColumns(slots, layout);
}

function slotPosition(slot, layout) {
  return {
    row: Math.floor(slot / layout.cols),
    column: slot % layout.cols
  };
}

function bookletJoinClasses(layout) {
  const classes = Array.from({ length: layout.pageSlots }, () => "");

  bookletSlotPairs(layout).forEach(([firstSlot, secondSlot]) => {
    const first = slotPosition(firstSlot, layout);
    const second = slotPosition(secondSlot, layout);

    if (first.row === second.row) {
      classes[firstSlot] = "join-right";
      classes[secondSlot] = "join-left";
    } else if (first.column === second.column) {
      classes[firstSlot] = "join-bottom";
      classes[secondSlot] = "join-top";
    }
  });

  return classes;
}

function printJoinClasses(side, options, layout) {
  if (!options.joinMargin) return Array.from({ length: layout.pageSlots }, () => "");

  if (options.sides === "booklet") return bookletJoinClasses(layout);

  if (options.sides === "duplex") {
    const isBack = side.label.endsWith("back");
    return Array.from({ length: layout.pageSlots }, () => (isBack ? "join-right" : "join-left"));
  }

  return Array.from({ length: layout.pageSlots }, () => "join-left");
}

function bookletSides(pages, options, layout) {
  const pairs = bookletSlotPairs(layout);
  const blockSize = pairs.length * 4;
  const padded = paddedPages(pages, blockSize);
  const sides = [];

  for (let start = 0; start < padded.length; start += blockSize) {
    const block = padded.slice(start, start + blockSize);
    const frontSpreads = [];
    const backSpreads = [];
    let low = 0;
    let high = block.length - 1;

    while (frontSpreads.length < pairs.length) {
      frontSpreads.push([block[high], block[low]]);

      // Build the back in front-side coordinates first: the inside page
      // must sit behind the matching outside page after duplex flipping.
      backSpreads.push([block[high - 1], block[low + 1]]);
      low += 2;
      high -= 2;
    }

    const sheetNumber = sides.length / 2 + 1;
    const frontSlots = placeSpreadsInSlots(frontSpreads, pairs, layout);
    const backSlots = placeSpreadsInSlots(backSpreads, pairs, layout);

    sides.push({ label: sheetLabel(sheetNumber, "front"), pages: frontSlots });
    sides.push({ label: sheetLabel(sheetNumber, "back"), pages: bookletBackSlots(backSlots, options, layout) });
  }

  return sides;
}

function imposedPrintSides(pages, options, layout) {
  if (options.sides === "single") return singleSidedPrintSides(pages, layout);
  if (options.sides === "booklet") return bookletSides(pages, options, layout);
  return duplexCutStackSides(pages, options, layout);
}

function printInstruction(options, layout) {
  if (options.sides === "single") {
    return "Print single-sided, cut along the lines, then stack by page number.";
  }

  if (options.sides === "booklet") {
    if (layout.pageSlots % 2 !== 0) {
      return "Print double-sided. Dotted guides show cuts. Joined sides get extra margin. This odd grid leaves one blank pocket space per side so the remaining pages can still fold into pairs.";
    }
    return "Print double-sided. Dotted guides show cuts. Joined sides get extra margin. Back sides are horizontally mirrored so they land behind the fronts. Nest the folded groups from outside to inside. If the backs land upside down, switch the printer flip edge.";
  }

  return "Print double-sided with flip on long edge. Fronts hold odd pages; backs hold the matching even pages. The binding side gets extra margin. Cut, then stack by page number.";
}

function pageNumber(page, options) {
  if (!options.pageNumbers || !page.logicalNumber) return "";
  return `<span class="print-page-number">${page.logicalNumber}</span>`;
}

function cutMarks(options) {
  if (!options.cutMarks) return "";
  return `
    <i class="print-cut-mark tl"></i>
    <i class="print-cut-mark tr"></i>
    <i class="print-cut-mark bl"></i>
    <i class="print-cut-mark br"></i>
  `;
}

function cutLinePosition(part, gap) {
  const percent = (part * 100).toFixed(4);
  const shift = (part - 0.5) * gap;
  const sign = shift < 0 ? "-" : "+";
  return `calc(${percent}% ${sign} ${Math.abs(shift).toFixed(3)}mm)`;
}

function pairKey(a, b) {
  return [a, b].sort((left, right) => left - right).join("-");
}

function bookletPairSet(layout) {
  return new Set(bookletSlotPairs(layout).map(([a, b]) => pairKey(a, b)));
}

function bookletVerticalGuide(column, layout, pairs) {
  for (let row = 0; row < layout.rows; row += 1) {
    const left = row * layout.cols + column - 1;
    const right = left + 1;
    if (!pairs.has(pairKey(left, right))) return "is-cut";
  }
  return "is-fold";
}

function bookletHorizontalGuide(row, layout, pairs) {
  for (let column = 0; column < layout.cols; column += 1) {
    const top = (row - 1) * layout.cols + column;
    const bottom = top + layout.cols;
    if (!pairs.has(pairKey(top, bottom))) return "is-cut";
  }
  return "is-fold";
}

function sheetCutLines(options, layout) {
  if (!options.cutMarks) return "";

  const lines = [];
  const pairSet = options.sides === "booklet" ? bookletPairSet(layout) : null;
  for (let column = 1; column < layout.cols; column += 1) {
    const kind = pairSet ? bookletVerticalGuide(column, layout, pairSet) : "is-cut";
    if (kind !== "is-cut") continue;
    lines.push(
      `<i class="print-cut-line vertical ${kind}" style="left: ${cutLinePosition(column / layout.cols, options.gap)}"></i>`
    );
  }
  for (let row = 1; row < layout.rows; row += 1) {
    const kind = pairSet ? bookletHorizontalGuide(row, layout, pairSet) : "is-cut";
    if (kind !== "is-cut") continue;
    lines.push(
      `<i class="print-cut-line horizontal ${kind}" style="top: ${cutLinePosition(row / layout.rows, options.gap)}"></i>`
    );
  }

  return lines.join("");
}

function renderPrintPocketPage(page, options, joinClass = "") {
  const joinClassName = joinClass ? ` ${joinClass}` : "";

  if (page.type === "empty") {
    return `<article class="print-pocket-page is-empty${joinClassName}">${cutMarks(options)}</article>`;
  }

  if (page.type === "cover") {
    return `
      <article class="print-pocket-page${joinClassName}">
        ${cutMarks(options)}
        <div class="print-cover">
          <strong>${escapeHtml(page.title)}</strong>
          ${page.lines.map((line) => `<span>${escapeHtml(line)}</span>`).join("")}
        </div>
      </article>
    `;
  }

  const head = `
    <header class="print-page-head">
      <span>${escapeHtml(page.title)}</span>
      ${pageNumber(page, options)}
    </header>
  `;

  if (page.type === "guide-flow") {
    return `
      <article class="print-pocket-page${joinClassName}">
        ${cutMarks(options)}
        ${head}
        <div class="print-page-body">
          ${page.rows.map((row) => {
            if (row.type === "section") {
              return `<div class="print-guide-section">${escapeHtml(row.title)}</div>`;
            }
            if (row.type === "model-row") {
              return `
                <div class="print-model-row">
                  <div class="print-model-label">
                    <b>${escapeHtml(row.code)}</b>
                    <small>${escapeHtml(row.use)}</small>
                  </div>
                  <div class="print-model-detail">
                    <em>${escapeHtml(row.endings)}</em>
                    <div class="print-model-cases">
                      ${row.cases.map((item) => `<span class="print-model-case"><code>${escapeHtml(item.label)}</code> ${escapeHtml(item.form)}</span>`).join("")}
                    </div>
                  </div>
                </div>
              `;
            }
            return `
              <div class="print-guide-row">
                <b>${escapeHtml(row.left)}</b>
                <span>${escapeHtml(row.right)}</span>
              </div>
            `;
          }).join("")}
        </div>
      </article>
    `;
  }

  if (page.type === "guide-models") {
    return `
      <article class="print-pocket-page${joinClassName}">
        ${cutMarks(options)}
        ${head}
        <div class="print-page-body">
          ${page.rows.map((row) => `
            <div class="print-model-row">
              <div class="print-model-label">
                <b>${escapeHtml(row.code)}</b>
                <small>${escapeHtml(row.use)}</small>
              </div>
              <div class="print-model-detail">
                <em>${escapeHtml(row.endings)}</em>
                <div class="print-model-cases">
                  ${row.cases.map((item) => `<span class="print-model-case"><code>${escapeHtml(item.label)}</code> ${escapeHtml(item.form)}</span>`).join("")}
                </div>
              </div>
            </div>
          `).join("")}
        </div>
      </article>
    `;
  }

  if (page.type === "guide") {
    return `
      <article class="print-pocket-page${joinClassName}">
        ${cutMarks(options)}
        ${head}
        <div class="print-page-body">
          ${page.rows.map(([left, right]) => `
            <div class="print-guide-row">
              <b>${escapeHtml(left)}</b>
              <span>${escapeHtml(right)}</span>
            </div>
          `).join("")}
        </div>
      </article>
    `;
  }

  if (page.type === "script") {
    return `
      <article class="print-pocket-page${joinClassName}">
        ${cutMarks(options)}
        <header class="print-page-head">
          <span>${escapeHtml(page.title)}</span>
          <span>${escapeHtml(page.goal)}</span>
        </header>
        <div class="print-page-body">
          ${page.rows.map((line) => `
            <div class="print-script-row">
              <b>${escapeHtml(line.cs)}</b>
              <span>${escapeHtml(line.en)}</span>
            </div>
          `).join("")}
        </div>
      </article>
    `;
  }

  return `
    <article class="print-pocket-page${joinClassName}">
      ${cutMarks(options)}
      ${head}
      <div class="print-page-body">
        ${renderPrintDictionaryRows(page.rows)}
      </div>
    </article>
  `;
}

function applyPrintBookVariables(book, options, layout) {
  const paper = paperSize(options);
  book.style.setProperty("--paper-width", `${paper.width}mm`);
  book.style.setProperty("--paper-height", `${paper.height}mm`);
  book.style.setProperty("--paper-ratio", `${paper.width} / ${paper.height}`);
  book.style.setProperty("--print-cols", layout.cols);
  book.style.setProperty("--print-rows", layout.rows);
  book.style.setProperty("--sheet-margin", layout.margin);
  book.style.setProperty("--print-gap", layout.gap);
  book.style.setProperty("--join-margin", `${options.joinMargin}mm`);
  book.style.setProperty("--print-word-font", scalePt(layout.wordFont, options.textScale));
  book.style.setProperty("--print-small-font", scalePt(layout.smallFont, options.textScale));
  book.style.setProperty("--print-code-font", scalePt(layout.codeFont, options.textScale));
  book.style.setProperty("--print-head-font", scalePt(layout.headFont, options.textScale));
  book.style.setProperty("--print-title-font", scalePt(layout.titleFont, options.textScale));
  book.style.setProperty("--print-translation-font", scalePt(layout.translationFont, options.textScale));
  book.style.setProperty("--print-blank-height", layout.blankHeight);
  book.style.setProperty("--print-blank-line", layout.blankLine);
}

function updatePrintBookStyles(options, layout) {
  const paper = paperSize(options);
  applyPrintBookVariables($("#printBook"), options, layout);

  let style = $("#printPageStyle");
  if (!style) {
    style = document.createElement("style");
    style.id = "printPageStyle";
    document.head.append(style);
  }
  style.textContent = `@page { size: ${paper.css} ${paper.orientation}; margin: 0; }`;
}

function buildPrintBook(options = printOptions()) {
  const layout = printLayout(options);
  const logicalPages = logicalPrintPages(options, layout);

  updatePrintBookStyles(options, layout);

  if (!logicalPages.length) {
    $("#printBook").replaceChildren();
    $("#printSummary").textContent = "Select at least one content section to build the pocket book.";
    $("#printBook").setAttribute("aria-hidden", "true");
    return { logicalPages, sides: [], physicalSheets: 0 };
  }

  const sides = imposedPrintSides(logicalPages, options, layout);

  $("#printBook").replaceChildren(
    ...sides.map((side) => {
      const sheet = document.createElement("section");
      const joinClasses = printJoinClasses(side, options, layout);
      sheet.className = "print-sheet";
      sheet.innerHTML = `
        <span class="print-sheet-label">${escapeHtml(side.label)}</span>
        <div class="print-grid">
          ${sheetCutLines(options, layout)}
          ${side.pages.map((page, index) => renderPrintPocketPage(page, options, joinClasses[index])).join("")}
        </div>
      `;
      return sheet;
    })
  );

  const physicalSheets = options.sides === "single" ? sides.length : Math.ceil(sides.length / 2);
  $("#printSummary").textContent = `${logicalPages.length} pocket pages on a ${layout.cols} x ${layout.rows} grid, ${physicalSheets} ${physicalSheets === 1 ? "paper sheet" : "paper sheets"} (${sides.length} printed ${sides.length === 1 ? "side" : "sides"}). ${printInstruction(options, layout)}`;

  $("#printBook").setAttribute("aria-hidden", "false");
  return { logicalPages, sides, physicalSheets };
}

function openPrintMenu() {
  closeSettingsPanel({ restoreFocus: false });
  applyPrintDefaults();
  $("#printMenu").hidden = false;
  $("#printBackdrop").hidden = false;
  buildPrintBook(printOptions());
}

function closePrintMenu() {
  $("#printMenu").hidden = true;
  $("#printBackdrop").hidden = true;
}

function previewPrintBook() {
  buildPrintBook(printOptions());
  document.body.classList.add("print-preview-on");
  closePrintMenu();
  $("#printBook").scrollIntoView({ block: "start" });
}

function printBookNow() {
  buildPrintBook(printOptions());
  document.body.classList.add("print-preview-on", "print-book-ready");
  window.print();
}

function normalizeView(view) {
  if (view === "home") return "home";
  if (view === "guide" || view === "dictionary") return "dictionary";
  if (view === "train" || view === "verbs") return "verbs";
  return "verbs";
}

function setView(view) {
  view = normalizeView(view);
  state.activeView = view;
  $(".view.is-active")?.classList.remove("is-active");
  $(`#view-${view}`)?.classList.add("is-active");
  $(".nav-tab.is-active")?.classList.remove("is-active");
  $(`.nav-tab[data-view="${view}"]`)?.classList.add("is-active");
  const homeView = view === "home";
  window.CaatuuChrome?.setPagePresentation?.(homeView
    ? { kicker: "Caatuu", title: "Home", iconSrc: "/assets/icons/home_icon.png" }
    : { kicker: "Train", title: "Games", iconSrc: "/assets/icons/games_icon.png" });
  window.CaatuuChrome?.setBottomNavSection?.(homeView ? "home" : view === "verbs" ? "games" : "");
  const viewTitle = view === "verbs"
    ? state.campaignActive
      ? "Campaign Mode"
      : ({
          "verb-lab": "Verb Nebula",
          "word-net": "Word World",
          "conjugation-comet": "Conjugation Comet",
          "case-cosmos": "Case Cosmos",
          "agreement-aurora": "Agreement Aurora",
          "memory-moon": "Memory Moon"
        }[state.trainTab] || "")
    : "";
  window.CaatuuChrome?.setHeaderTitle?.(viewTitle, {
    backLabel: "← Menu",
    backHref: viewTitle ? "index.html" : "",
    trainTab: viewTitle ? "galaxy" : ""
  });
}

function syncEmbeddedWordNetVisibility(active) {
  const frame = document.getElementById("wordNetEmbeddedGame");
  if (!frame?.contentWindow || frame.dataset.ready !== "true") return;
  frame.contentWindow.postMessage({
    source: "caatuu-app-shell",
    type: "visibility",
    active: Boolean(active),
    theme: document.documentElement.dataset.theme || "dark",
    fontSize: document.documentElement.dataset.fontSize || "largest"
  }, window.location.origin);
}

function ensureWordNetLoaded() {
  const frame = document.getElementById("wordNetEmbeddedGame");
  const stage = document.getElementById("wordNetEmbeddedStage");
  const status = document.getElementById("wordNetEmbeddedStatus");
  if (!frame || frame.dataset.loading === "true" || frame.dataset.ready === "true") return;

  const source = frame.dataset.src;
  if (!source) return;
  frame.dataset.loading = "true";

  const handleMessage = (event) => {
    if (event.origin !== window.location.origin || event.source !== frame.contentWindow) return;
    if (event.data?.source !== "caatuu-word-world") return;

    if (event.data.type === "ready") {
      frame.dataset.ready = "true";
      frame.dataset.loading = "false";
      frame.classList.add("is-ready");
      frame.removeAttribute("aria-hidden");
      frame.removeAttribute("tabindex");
      stage?.setAttribute("aria-busy", "false");
      if (status) status.hidden = true;
      syncEmbeddedWordNetVisibility(state.trainTab === "word-net");
    }

    if (event.data.type === "error" && status) {
      status.classList.add("is-error");
      const title = status.querySelector("strong");
      const copy = status.querySelector("small");
      if (title) title.textContent = "Word World could not start";
      if (copy) copy.textContent = "Return to the planets and try opening it again.";
    }

  };
  window.addEventListener("message", handleMessage);
  frame.src = source;

  window.setTimeout(() => {
    if (frame.dataset.ready === "true" || !status) return;
    status.classList.add("is-error");
    const title = status.querySelector("strong");
    const copy = status.querySelector("small");
    if (title) title.textContent = "Word World is taking longer than expected";
    if (copy) copy.textContent = "You can return to the planets while it finishes loading.";
  }, 20000);
}

const embeddedGameTabs = {
  "conjugation-comet": {
    frameId: "conjugationCometEmbeddedGame",
    stageId: "conjugationCometEmbeddedStage",
    statusId: "conjugationCometEmbeddedStatus",
    title: "Conjugation Comet"
  },
  "case-cosmos": {
    frameId: "caseCosmosEmbeddedGame",
    stageId: "caseCosmosEmbeddedStage",
    statusId: "caseCosmosEmbeddedStatus",
    title: "Case Cosmos"
  },
  "agreement-aurora": {
    frameId: "agreementAuroraEmbeddedGame",
    stageId: "agreementAuroraEmbeddedStage",
    statusId: "agreementAuroraEmbeddedStatus",
    title: "Agreement Aurora"
  }
};

function prepareEmbeddedGameDocument(frame) {
  const embeddedDocument = frame.contentDocument;
  if (!embeddedDocument) return;
  embeddedDocument.documentElement.classList.add("caatuu-embedded-shell");
  embeddedDocument.body?.classList.add("caatuu-embedded-shell");
  if (embeddedDocument.getElementById("caatuuEmbeddedShellStyle")) return;
  const style = embeddedDocument.createElement("style");
  style.id = "caatuuEmbeddedShellStyle";
  style.textContent = `
    html.caatuu-embedded-shell,
    body.caatuu-embedded-shell { min-height: 100%; }
    body.caatuu-embedded-shell { padding: 0 !important; overflow-x: hidden; }
    body.caatuu-embedded-shell > .app-header,
    body.caatuu-embedded-shell > .app-shell > .app-header,
    body.caatuu-embedded-shell > .app-bottom-dock,
    body.caatuu-embedded-shell > [data-caatuu-bottom-dock],
    body.caatuu-embedded-shell > #gamesMenuPanel,
    body.caatuu-embedded-shell > #settingsPanel { display: none !important; }
    body.caatuu-embedded-shell > .app-shell {
      min-height: 100dvh;
      padding-bottom: 0 !important;
      display: grid;
      grid-template-rows: minmax(0, 1fr) auto;
    }
    body.caatuu-embedded-shell > .app-shell > .workspace {
      min-height: 0;
      padding-bottom: 14px !important;
    }
    body.caatuu-embedded-shell > .app-footer,
    body.caatuu-embedded-shell > .app-shell > .app-footer {
      min-height: 44px;
      margin: 0 !important;
      padding: 6px 12px !important;
      display: flex !important;
      align-items: center;
    }
  `;
  embeddedDocument.head?.append(style);
}

function syncEmbeddedGameVisibility(activeTab) {
  Object.entries(embeddedGameTabs).forEach(([gameId, config]) => {
    const frame = document.getElementById(config.frameId);
    if (!frame?.contentWindow || frame.dataset.ready !== "true") return;
    frame.contentWindow.postMessage({
      source: "caatuu-app-shell",
      type: "visibility",
      active: activeTab === gameId,
      theme: document.documentElement.dataset.theme || "dark",
      fontSize: document.documentElement.dataset.fontSize || "largest"
    }, window.location.origin);
  });
}

function ensureEmbeddedGameLoaded(gameId) {
  const config = embeddedGameTabs[gameId];
  const frame = config ? document.getElementById(config.frameId) : null;
  const stage = config ? document.getElementById(config.stageId) : null;
  const status = config ? document.getElementById(config.statusId) : null;
  if (!config || !frame || frame.dataset.loading === "true" || frame.dataset.ready === "true") return;
  const source = frame.dataset.src;
  if (!source) return;
  frame.dataset.loading = "true";

  frame.addEventListener("load", () => {
    try {
      prepareEmbeddedGameDocument(frame);
      frame.dataset.ready = "true";
      frame.dataset.loading = "false";
      frame.classList.add("is-ready");
      frame.removeAttribute("aria-hidden");
      frame.removeAttribute("tabindex");
      stage?.setAttribute("aria-busy", "false");
      if (status) status.hidden = true;
      syncEmbeddedGameVisibility(state.trainTab);
    } catch (error) {
      console.error(`Could not prepare embedded ${config.title}.`, error);
      if (status) {
        status.classList.add("is-error");
        const title = status.querySelector("strong");
        const copy = status.querySelector("small");
        if (title) title.textContent = `${config.title} could not start`;
        if (copy) copy.textContent = "Return to the planets and try opening it again.";
      }
    }
  }, { once: true });
  frame.src = source;
}

function campaignAvailableTabs() {
  return campaignPlayableTabs.filter((gameId) => {
    if (gameId === "conjugation-comet" && course.capabilities?.conjugationComet !== true) return false;
    return Boolean(document.querySelector(`[data-train-tab="${gameId}"]`));
  });
}

function shuffledCampaignTabs(tabs) {
  const shuffled = [...tabs];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

function nextCampaignTab(previousTab = state.trainTab) {
  const available = campaignAvailableTabs();
  if (!available.length) return "";
  state.campaignQueue = state.campaignQueue.filter((gameId) => available.includes(gameId));
  if (!state.campaignQueue.length) {
    state.campaignQueue = shuffledCampaignTabs(available);
  }
  if (available.length > 1 && state.campaignQueue[0] === previousTab) {
    const alternativeIndex = state.campaignQueue.findIndex((gameId) => gameId !== previousTab);
    if (alternativeIndex > 0) {
      [state.campaignQueue[0], state.campaignQueue[alternativeIndex]] = [
        state.campaignQueue[alternativeIndex],
        state.campaignQueue[0]
      ];
    }
  }
  return state.campaignQueue.shift() || available[0];
}

function campaignFrame(gameId) {
  if (gameId === "word-net") return document.getElementById("wordNetEmbeddedGame");
  const config = embeddedGameTabs[gameId];
  return config ? document.getElementById(config.frameId) : null;
}

function ensureCampaignGameLoaded(gameId) {
  if (gameId === "word-net") ensureWordNetLoaded();
  else if (Object.hasOwn(embeddedGameTabs, gameId)) ensureEmbeddedGameLoaded(gameId);
}

async function waitForCampaignGameReady(gameId, transitionId) {
  const frame = campaignFrame(gameId);
  if (!frame) return;
  ensureCampaignGameLoaded(gameId);
  const startedAt = performance.now();
  while (frame.dataset.ready !== "true") {
    if (transitionId !== state.campaignTransitionId || !state.campaignActive) return;
    if (performance.now() - startedAt >= campaignGameReadyTimeoutMillis) return;
    await waitForVerbTransition(80);
  }
}

async function loadCampaignRobotPaths() {
  if (!state.campaignRobotPathsPromise) {
    state.campaignRobotPathsPromise = fetch(verbRobotKeymapUrl, { cache: "force-cache" })
      .then((response) => {
        if (!response.ok) throw new Error(`Could not load robot keymap (${response.status}).`);
        return response.json();
      })
      .then((raw) => Object.keys(raw || {}).filter((path) => path.startsWith("/assets/robots/")))
      .catch(() => []);
  }
  return state.campaignRobotPathsPromise;
}

async function nextCampaignRobot() {
  const paths = await loadCampaignRobotPaths();
  if (!paths.length) return verbRobotFallbackPath;
  let index = Math.floor(Math.random() * paths.length);
  if (paths.length > 1 && index === state.campaignRobotCursor) index = (index + 1) % paths.length;
  state.campaignRobotCursor = index;
  return paths[index];
}

function showCampaignTransition(nextGameId, transitionId) {
  const transition = document.getElementById("campaignTransition");
  const image = document.getElementById("campaignTransitionRobot");
  const title = document.getElementById("campaignTransitionTitle");
  if (image) image.src = verbRobotFallbackPath;
  if (title) title.textContent = `Traveling to ${campaignGameTitles[nextGameId] || "another planet"}…`;
  if (transition) transition.hidden = false;
  void nextCampaignRobot().then((path) => {
    if (transitionId !== state.campaignTransitionId || !state.campaignActive) return;
    if (image) image.src = path;
  });
}

function hideCampaignTransition() {
  const transition = document.getElementById("campaignTransition");
  if (transition) transition.hidden = true;
}

function advanceCompletedCampaignGame(gameId, sourceWindow) {
  if (sourceWindow === window || !sourceWindow?.postMessage) return;
  if (!["word-net", "case-cosmos", "agreement-aurora"].includes(gameId)) return;
  sourceWindow.postMessage({
    source: "caatuu-app-shell",
    type: "campaign-advance"
  }, window.location.origin);
}

async function completeCampaignRound(gameId, sourceWindow) {
  if (!state.campaignActive || state.campaignTransitioning || gameId !== state.trainTab) return;
  const nextGameId = nextCampaignTab(gameId);
  if (!nextGameId) return;

  state.campaignTransitioning = true;
  const transitionId = state.campaignTransitionId + 1;
  state.campaignTransitionId = transitionId;
  showCampaignTransition(nextGameId, transitionId);
  advanceCompletedCampaignGame(gameId, sourceWindow);
  ensureCampaignGameLoaded(nextGameId);

  await Promise.all([
    waitForVerbTransition(campaignTransitionMillis),
    waitForCampaignGameReady(nextGameId, transitionId)
  ]);
  if (transitionId !== state.campaignTransitionId || !state.campaignActive) return;

  setTrainTab(nextGameId);
  state.campaignTransitioning = false;
  hideCampaignTransition();
}

function startCampaign() {
  state.campaignTransitionId += 1;
  state.campaignTransitioning = false;
  state.campaignQueue = [];
  state.campaignActive = true;
  document.body.dataset.campaignActive = "true";
  hideCampaignTransition();
  const firstGameId = nextCampaignTab(state.trainTab);
  if (!firstGameId) {
    stopCampaign();
    setTrainTab("galaxy");
    return;
  }
  setTrainTab(firstGameId);
}

function stopCampaign() {
  state.campaignTransitionId += 1;
  state.campaignActive = false;
  state.campaignTransitioning = false;
  state.campaignQueue = [];
  delete document.body.dataset.campaignActive;
  hideCampaignTransition();
}

function handleCampaignGameMessage(event) {
  if (event.origin !== window.location.origin) return;
  const message = event.data;
  if (message?.source !== "caatuu-game" || message.type !== "round-success") return;
  const gameId = String(message.gameId || "");
  const frame = campaignFrame(gameId);
  if (!frame?.contentWindow || event.source !== frame.contentWindow) return;
  void completeCampaignRound(gameId, event.source);
}

function setTrainTab(tab) {
  const trainPanels = {
    galaxy: "trainPanelGalaxy",
    "verb-lab": "trainPanelVerbLab",
    "word-net": "trainPanelWordNet",
    "conjugation-comet": "trainPanelConjugationComet",
    "case-cosmos": "trainPanelCaseCosmos",
    "agreement-aurora": "trainPanelAgreementAurora",
    "memory-moon": "trainPanelMemoryMoon"
  };
  const activeTab = Object.prototype.hasOwnProperty.call(trainPanels, tab) ? tab : "galaxy";
  if (activeTab !== "verb-lab") deferVerbGuidedActivation();
  const targetId = trainPanels[activeTab];
  state.trainTab = activeTab;
  document.body.classList.toggle("word-net-active", activeTab === "word-net");
  document.body.classList.toggle("embedded-game-active", activeTab === "word-net" || Object.hasOwn(embeddedGameTabs, activeTab));
  const trainTitles = {
    galaxy: "",
    "verb-lab": "Verb Nebula",
    "word-net": "Word World",
    "conjugation-comet": "Conjugation Comet",
    "case-cosmos": "Case Cosmos",
    "agreement-aurora": "Agreement Aurora",
    "memory-moon": "Memory Moon"
  };
  const title = state.campaignActive ? "Campaign Mode" : (trainTitles[activeTab] || "");
  window.CaatuuChrome?.setHeaderTitle?.(title, {
    backLabel: "← Menu",
    backHref: title ? "index.html" : "",
    trainTab: title ? "galaxy" : ""
  });
  document.querySelectorAll(".train-world").forEach((button) => {
    const selected = state.campaignActive
      ? button.dataset.trainTab === "campaign"
      : button.dataset.trainTab === activeTab;
    button.classList.toggle("is-active", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  document.querySelectorAll(".train-tab-panel").forEach((panel) => {
    const selected = panel.id === targetId;
    panel.hidden = !selected;
    panel.classList.toggle("is-active", selected);
  });
  if (activeTab === "verb-lab") renderVerbNebula();
  if (activeTab === "word-net") ensureWordNetLoaded();
  if (Object.hasOwn(embeddedGameTabs, activeTab)) ensureEmbeddedGameLoaded(activeTab);
  syncEmbeddedWordNetVisibility(activeTab === "word-net");
  syncEmbeddedGameVisibility(activeTab);
}

function setInitialViewFromLocation() {
  const url = new URL(window.location.href);
  const navigationRequestStorageKey = `${course.storage.namespace || `caatuu-${course.id}`}.navigation.request.v1`;
  let navigationRequest = String(document.documentElement.dataset.navigationRequest || "");
  try {
    navigationRequest ||= String(sessionStorage.getItem(navigationRequestStorageKey) || "");
    sessionStorage.removeItem(navigationRequestStorageKey);
  } catch (error) {
    // The default Games view remains available when session storage is unavailable.
  }
  delete document.documentElement.dataset.navigationRequest;
  const openSettings = navigationRequest === "backpack";
  const openHome = navigationRequest === "home";
  const requestedView = navigationRequest === "dictionary" ? "dictionary" : "";
  const requestedGame = navigationRequest.startsWith("game:")
    ? navigationRequest.slice("game:".length)
    : "";

  if (openHome) {
    setView("home");
  } else if (openSettings) {
    setView(state.activeView);
    window.requestAnimationFrame(openSettingsPanel);
  } else if (requestedView) {
    setView(requestedView);
  } else if (["campaign", "verb-lab", "word-net", "conjugation-comet", "case-cosmos", "agreement-aurora", "memory-moon"].includes(requestedGame)) {
    setView("verbs");
    window.requestAnimationFrame(() => {
      document.querySelector(`[data-train-tab="${requestedGame}"]`)?.click();
    });
  }

  if (url.search || url.hash) {
    window.history.replaceState(window.history.state, "", url.pathname);
  }
}

function render() {
  renderDictionary();
  renderScripts();
  renderVerbNebula();
}

function renderDataError(error) {
  console.error(error);
  const panel = $("#coreDictionaryPanel");
  if (panel) panel.hidden = false;
  $("#dictionaryList").innerHTML = `<p class="empty-state">Could not load dictionary data. Open the app from the local server and reload.</p>`;
}

function bindUi() {
  bindPwaInstall();
  window.CaatuuLearning?.registerProgressResetPreparation?.(prepareVerbProgressReset);
  window.addEventListener("caatuu:progress-reset-cancelled", () => {
    if (state.verbProgressResetPending && state.verbGuidedRequested) {
      restartGuidedVerbRuntimeAfterReset({ resetCompleted: false });
    }
  });
  window.addEventListener("message", handleCampaignGameMessage);
  document.addEventListener("click", (event) => {
    const tab = event.target.closest(".nav-tab");
    if (tab) setView(tab.dataset.view);
    const trainTab = event.target.closest("[data-train-tab]");
    if (trainTab) {
      event.preventDefault();
      if (state.activeView !== "verbs") setView("verbs");
      const selectedTab = trainTab.dataset.trainTab;
      if (selectedTab === "campaign") {
        startCampaign();
        return;
      }
      stopCampaign();
      if (trainTab.classList.contains("train-world") && selectedTab !== "galaxy") {
        setTrainTab(selectedTab);
        return;
      }
      setTrainTab(selectedTab);
    }
  });
  document.addEventListener("caatuu:home-request", () => {
    stopCampaign();
    setView("home");
  });

  $("#openSettings")?.addEventListener("click", openSettingsPanel);
  $("#settingsPanel")?.addEventListener("click", (event) => {
    if (event.target === $("#settingsPanel")) closeSettingsPanel();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && $("#settingsPanel") && !$("#settingsPanel").hidden) {
      closeSettingsPanel();
    }
  });
  bindThemeControls();
  document.querySelectorAll("[data-preset]").forEach((button) => {
    button.addEventListener("click", () => applyGenerationPreset(button.dataset.preset));
  });
  ["settingsModel", "thinkingEnabled", "maxTokens", "temperature", "contextSize", "reasoningDisplay"].forEach((id) => {
    const control = $(`#${id}`);
    if (!control) return;
    control.addEventListener("input", readGenerationSettingsControls);
    control.addEventListener("change", readGenerationSettingsControls);
  });
  window.addEventListener("caatuu:learning-change", (event) => {
    if (event.detail?.reason === "progress-reset") clearVerbMemory({ confirmed: true });
    else if (event.detail?.reason === "difficulty") rebaseVerbDifficulty();
  });
  $("#clearCache")?.addEventListener("click", clearAppCache);

  document.querySelectorAll("[data-dictionary-section]").forEach((button) => {
    button.addEventListener("click", () => setDictionarySection(button.dataset.dictionarySection));
    button.addEventListener("keydown", (event) => {
      const currentIndex = dictionarySectionOrder.indexOf(button.dataset.dictionarySection);
      let nextIndex = currentIndex;
      if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % dictionarySectionOrder.length;
      if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + dictionarySectionOrder.length) % dictionarySectionOrder.length;
      if (event.key === "Home") nextIndex = 0;
      if (event.key === "End") nextIndex = dictionarySectionOrder.length - 1;
      if (nextIndex === currentIndex) return;
      event.preventDefault();
      setDictionarySection(dictionarySectionOrder[nextIndex], { focus: true });
    });
  });
  setDictionarySection(state.dictionarySection);

  $("#coreDictionarySearch")?.addEventListener("input", (event) => {
    state.coreDictionarySearch = event.target.value;
    renderDictionary();
  });
  $("#toggleCoreDictionary")?.addEventListener("click", () => {
    state.dictionaryBrowseAll = !state.dictionaryBrowseAll;
    renderDictionary();
  });

  applyPrintDefaults();

  $("#openPrintMenu")?.addEventListener("click", openPrintMenu);
  $("#closePrintMenu").addEventListener("click", closePrintMenu);
  $("#printBackdrop").addEventListener("click", closePrintMenu);
  $("#previewPrintBook").addEventListener("click", previewPrintBook);
  $("#printBookNow").addEventListener("click", printBookNow);

  [
    "#printPaper",
    "#printOrientation",
    "#printColumns",
    "#printRows",
    "#printGap",
    "#printJoinMargin",
    "#printTextScale",
    "#printSides",
    "#printIncludeGuide",
    "#printIncludeDictionary",
    "#printIncludeScripts",
    "#printBlankRows",
    "#printFillBlankRows",
    "#printCutMarks",
    "#printPageNumbers"
  ].forEach((selector) => {
    $(selector).addEventListener("change", () => buildPrintBook(printOptions()));
  });

  window.addEventListener("afterprint", () => {
    document.body.classList.remove("print-book-ready");
  });

  bindVerbNebulaControls();
}

async function init() {
  try {
    await loadContentData();
    await initializeVerbGuidedMode();
    await loadModelLicenseCatalog().catch(() => {});
    applyTheme(readStoredTheme(), { persist: false });
    bindUi();
    renderModelLicenseList();
    syncGenerationSettingsUi();
    setInitialViewFromLocation();
    render();
    registerServiceWorker();
  } catch (error) {
    renderDataError(error);
  }
}

function registerServiceWorker() {
  runtimeAdapter().registerServiceWorker().catch(() => {});
}

init();
