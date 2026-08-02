let countryDictionary = [];
let countryDictionaryBytes = new Uint8Array();
let countryScripts = [];
let verbNebulaCore = null;
let verbMorphologyCore = null;
let verbExerciseFamilyCore = null;
let verbMorphologyCatalogBytes = new Uint8Array();
let guidedOpportunityCore = null;
let deferredPwaInstallPrompt = null;
let lastAppSettingsTrigger = null;
let nativeUpdateStatus = null;
const course = window.CaatuuCourse;
if (!course) throw new Error("Caatuu course profile must load before the app shell.");
const verbMorphologyProgressSchema = "caatuu-morphology-guided-progress-v1";

const themeStorageKey = course.storage.theme;
const themeOptions = {
  light: { themeColor: "#f5efe5" },
  dark: { themeColor: "#151a18" }
};
const chatSettingsStorageKey = course.storage.chatSettings;
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
  sourceUrl: "data/word-world/manifest.json",
  license: "MIT source license",
  intendedUse: "Standard Word World guided offline sentences. Corpus standard-v0.1 · 760 rows · L1 175 · L2 533 · L3 52 · codex_reviewed · humanApproved=false.",
  artifactKind: "guided-learning-corpus",
  runtime: "Compiled bilingual JSON data pack",
  status: "active",
  entryCount: 760,
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
  const morphologyRequested = requestedVerbExerciseFamily() === "morphology";
  const [dictionarySource, scripts, verbModule, familyModule] = await Promise.all([
    loadJsonBytes("data/dictionary.json"),
    loadJson("data/scripts.json"),
    import("./verb-nebula-core.mjs?v=verb-nebula-core-10"),
    import("./verb-exercise-family-core.mjs?v=verb-exercise-family-core-2")
  ]);

  assertArrayData("dictionary", dictionarySource.value);
  assertArrayData("scripts", scripts);
  countryDictionaryBytes = dictionarySource.bytes;
  countryDictionary = dictionarySource.value;
  countryScripts = scripts;
  verbNebulaCore = verbModule;
  verbExerciseFamilyCore = familyModule;
  if (morphologyRequested) {
    const [morphologySource, morphologyModule] = await Promise.all([
      loadJsonBytes(course.curriculum.paths.morphologyCatalog),
      import("./curriculum/morphology-round-core.mjs?v=morphology-round-core-2")
    ]);
    verbMorphologyCatalogBytes = morphologySource.bytes;
    verbMorphologyCore = morphologyModule;
  }
}

const state = {
  activeView: "verbs",
  trainTab: "galaxy",
  verbDifficulty: 1,
  verbPairs: [],
  verbQueueIds: [],
  verbRound: [],
  verbEnglishRound: [],
  verbMatchedIds: new Set(),
  verbSelectedCzechId: "",
  verbSelectedEnglishId: "",
  verbPairCount: 4,
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
  verbExerciseFamily: course.curriculum?.verbExerciseFamilies?.defaultFamily || "meaning",
  verbMorphologyCatalog: null,
  verbMorphologyFamily: null,
  verbMorphologyRound: null,
  verbMorphologyRoundState: null,
  verbMorphologyAdapter: null,
  verbMorphologySequence: null,
  verbMorphologySequencePreview: null,
  verbMorphologySequenceComplete: false,
  verbMorphologyTask: null,
  verbMorphologyProgress: null,
  verbMorphologyProgressRevision: 0,
  verbMorphologyResume: false,
  verbMorphologyAdvancePending: false,
  verbProgressResetPending: false,
  verbMorphologyGeneration: 0,
  verbMorphologyPreparePromise: null,
  verbGuidedOperations: new Set(),
  verbMorphologyFocusNextStep: false,
  verbMorphologyFocusNextAction: false,
  verbMorphologyFocusHintAction: false,
  verbMorphologyFocusRevealAction: false,
  verbMorphologyAnnouncement: "",
  verbMorphologyAnnouncementKind: "",
  dictionarySection: "rules",
  coreDictionarySearch: "",
  dictionaryBrowseAll: false
};

const $ = (selector) => document.querySelector(selector);

function setText(selector, value) {
  const node = $(selector);
  if (node) node.textContent = value;
}

function loopbackLocation() {
  return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(
    String(window.location.hostname || "").toLowerCase()
  );
}

function explicitLocalGuidedRequest() {
  const parameter = course.curriculum?.guidedMode?.developerQueryParameter || "curriculum-guided";
  return loopbackLocation()
    && new URLSearchParams(window.location.search).get(parameter) === "1";
}

function requestedVerbExerciseFamily() {
  const configuration = course.curriculum?.verbExerciseFamilies;
  const queryParameter = configuration?.queryParameter || "verb-family";
  const requested = new URLSearchParams(window.location.search).get(queryParameter);
  return explicitLocalGuidedRequest() && requested === "morphology"
    ? "morphology"
    : (configuration?.defaultFamily || "meaning");
}

function verbExerciseFamilyConfiguration(familyId = requestedVerbExerciseFamily()) {
  return course.curriculum?.verbExerciseFamilies?.families?.[familyId] || null;
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
    assetPath: "/assets/macaw/actions/180-hear_listen.png",
    alt: "The robed macaw cups one wing behind its head and listens to approaching sound waves."
  }],
  ["see", {
    assetPath: "/assets/macaw/actions/181-see_look.png",
    alt: "The robed macaw shades its eyes with one wing and looks carefully into the distance."
  }]
]);
const verbRobotKeymapUrl = "/assets/robots/keymap.json";
const verbRobotFallbackPath = "/assets/robots/word-world-waiting.svg";
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

function morphologySequenceConfiguration(familyConfiguration) {
  const sequence = familyConfiguration?.sequence;
  const orderedBindingIds = Array.from(sequence?.orderedBindingIds || [], (value) => String(value || "").trim());
  const orderedContentIds = Array.from(sequence?.orderedContentIds || [], (value) => String(value || "").trim());
  const targetSkillId = String(familyConfiguration?.targetSkillId || "").trim();
  if (!sequence?.id
      || !Number.isInteger(sequence.revision)
      || sequence.revision < 1
      || orderedBindingIds.length !== 3
      || orderedContentIds.length !== 3
      || new Set(orderedBindingIds).size !== orderedBindingIds.length
      || new Set(orderedContentIds).size !== orderedContentIds.length
      || orderedBindingIds.some((id) => !id)
      || orderedContentIds.some((id) => !id)
      || !targetSkillId) {
    throw new Error("The morphology pilot requires one pinned three-step sequence and target skill.");
  }
  return Object.freeze({
    id: sequence.id,
    revision: sequence.revision,
    orderedBindingIds: Object.freeze(orderedBindingIds),
    orderedContentIds: Object.freeze(orderedContentIds),
    targetSkillId
  });
}

function sameCurriculumContentRef(left, right) {
  return ["catalogId", "catalogRevision", "catalogDigest", "contentId", "revision", "contentDigest"]
    .every((key) => left?.[key] === right?.[key]);
}

function verbMorphologyAdapter() {
  if (!state.verbMorphologyAdapter) {
    state.verbMorphologyAdapter = verbExerciseFamilyCore.createVerbExerciseFamilyAdapter({
      exerciseFamily: verbExerciseFamilyCore.VERB_EXERCISE_FAMILIES.MORPHOLOGY,
      mode: verbExerciseFamilyCore.VERB_EXERCISE_MODES.GUIDED,
      developerMode: true
    });
  }
  return state.verbMorphologyAdapter;
}

function freshVerbMorphologyProgress(roundState) {
  return {
    schemaVersion: verbMorphologyProgressSchema,
    round: verbMorphologyAdapter().restoreRound(roundState),
    evidence: {
      recorded: false,
      score: null,
      solutionRevealed: false,
      hintsUsed: 0,
      occurredAt: null
    },
    pendingEvidence: null,
    terminalCompletionKind: null,
    pendingCompletionKind: null
  };
}

function normalizeVerbMorphologyProgress(
  value,
  fallbackRoundState,
  contentRound = state.verbMorphologyRound
) {
  if (value == null) return freshVerbMorphologyProgress(fallbackRoundState);
  if (!value || typeof value !== "object" || Array.isArray(value)
      || value.schemaVersion !== verbMorphologyProgressSchema) {
    throw new Error("The saved morphology progress envelope is unsupported.");
  }
  const round = verbMorphologyAdapter().restoreRound(value.round);
  const evidence = value.evidence;
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
    throw new Error("The saved morphology evidence journal is invalid.");
  }
  const recorded = evidence?.recorded === true;
  const score = recorded ? Number(evidence?.score) : null;
  const hintsUsed = Number(evidence?.hintsUsed || 0);
  const occurredAt = recorded ? String(evidence?.occurredAt || "") : null;
  if ((recorded && ![0, 1].includes(score))
      || !Number.isInteger(hintsUsed)
      || hintsUsed < 0
      || (recorded && !Number.isFinite(Date.parse(occurredAt)))
      || (!recorded && (
        evidence.recorded !== false
          || evidence.score !== null
          || evidence.solutionRevealed !== false
          || evidence.hintsUsed !== 0
          || evidence.occurredAt !== null
      ))) {
    throw new Error("The saved morphology evidence journal is invalid.");
  }
  const completionKinds = new Set(["correct-first-response", "corrective-correct", "solution-review"]);
  const terminalCompletionKind = value.terminalCompletionKind == null
    ? null
    : String(value.terminalCompletionKind);
  const pendingCompletionKind = value.pendingCompletionKind == null
    ? null
    : String(value.pendingCompletionKind);
  if ((terminalCompletionKind && !completionKinds.has(terminalCompletionKind))
      || (pendingCompletionKind && !completionKinds.has(pendingCompletionKind))
      || (pendingCompletionKind && terminalCompletionKind !== pendingCompletionKind)) {
    throw new Error("The saved morphology completion checkpoint is invalid.");
  }
  let pendingEvidence = null;
  if (value.pendingEvidence != null) {
    const pending = value.pendingEvidence;
    const request = pending?.request;
    const pendingScore = Number(request?.score);
    const pendingHints = Number(request?.hintsUsed || 0);
    const pendingOccurredAt = String(request?.occurredAt || "");
    const completionKind = pending?.completionKind == null ? null : String(pending.completionKind);
    if (!pending || typeof pending !== "object" || Array.isArray(pending)
        || request?.attemptNumber !== 1
        || typeof request?.solutionRevealed !== "boolean"
        || ![0, 1].includes(pendingScore)
        || !Number.isInteger(pendingHints)
        || pendingHints < 0
        || !Number.isFinite(Date.parse(pendingOccurredAt))
        || (completionKind && !completionKinds.has(completionKind))) {
      throw new Error("The pending morphology evidence journal is invalid.");
    }
    pendingEvidence = {
      request: {
        attemptNumber: 1,
        score: pendingScore,
        solutionRevealed: request.solutionRevealed === true,
        hintsUsed: pendingHints,
        occurredAt: pendingOccurredAt
      },
      round: verbMorphologyAdapter().restoreRound(pending.round),
      completionKind
    };
  }
  if ((recorded && score === 1 && !round.completed)
      || (round.completed && !pendingEvidence && !terminalCompletionKind)) {
    throw new Error("The saved morphology terminal state is missing its durable completion checkpoint.");
  }
  if (pendingEvidence && (recorded || terminalCompletionKind || pendingCompletionKind)) {
    throw new Error("Pending morphology evidence cannot coexist with recorded or terminal checkpoints.");
  }
  const targetRef = contentRound?.targetItemRef;
  if (!targetRef) throw new Error("The morphology progress envelope is missing its immutable target form.");
  const targetSelected = morphologyRefKey(round.selectedItemRef) === morphologyRefKey(targetRef);
  const rejectedKeys = new Set(round.rejectedItemRefs.map(morphologyRefKey));
  const selectedKey = morphologyRefKey(round.selectedItemRef);
  const targetKey = morphologyRefKey(targetRef);
  const evidenceSolutionRevealed = recorded && evidence?.solutionRevealed === true;
  if ((recorded && hintsUsed > 0
        && round.hintState === verbExerciseFamilyCore.VERB_HINT_STATES.AVAILABLE)
      || (pendingEvidence?.request?.hintsUsed > 0
        && pendingEvidence.round.hintState === verbExerciseFamilyCore.VERB_HINT_STATES.AVAILABLE)) {
    throw new Error("Recorded morphology support must match the visible saved hint state.");
  }
  if (terminalCompletionKind) {
    const solutionReview = terminalCompletionKind === "solution-review";
    const firstResponseCorrect = terminalCompletionKind === "correct-first-response";
    const firstResponseSupportMatches = !firstResponseCorrect || (
      (hintsUsed === 0
        && round.hintState === verbExerciseFamilyCore.VERB_HINT_STATES.AVAILABLE)
      || (hintsUsed > 0
        && round.hintState === verbExerciseFamilyCore.VERB_HINT_STATES.USED)
    );
    const terminalMatches = round.completed
      && recorded
      && Boolean(round.settlementId)
      && firstResponseSupportMatches
      && (solutionReview
        ? round.hintState === verbExerciseFamilyCore.VERB_HINT_STATES.SOLUTION_REVEALED
          && score === 0
          && (evidenceSolutionRevealed
            ? rejectedKeys.size === 0 && !round.selectedItemRef
            : rejectedKeys.size > 0
              && selectedKey !== targetKey
              && rejectedKeys.has(selectedKey))
        : targetSelected
          && round.hintState !== verbExerciseFamilyCore.VERB_HINT_STATES.SOLUTION_REVEALED
          && evidenceSolutionRevealed === false
          && score === (firstResponseCorrect ? 1 : 0)
          && (firstResponseCorrect ? rejectedKeys.size === 0 : rejectedKeys.size > 0));
    if (!terminalMatches) {
      throw new Error("The saved morphology completion kind contradicts its terminal round and first evidence.");
    }
  }
  if (pendingEvidence?.completionKind) {
    const pendingTargetSelected = morphologyRefKey(pendingEvidence.round.selectedItemRef)
      === morphologyRefKey(targetRef);
    const pendingSolution = pendingEvidence.completionKind === "solution-review";
    const pendingFirstCorrect = pendingEvidence.completionKind === "correct-first-response";
    const pendingFirstSupportMatches = !pendingFirstCorrect || (
      (pendingEvidence.request.hintsUsed === 0
        && pendingEvidence.round.hintState === verbExerciseFamilyCore.VERB_HINT_STATES.AVAILABLE)
      || (pendingEvidence.request.hintsUsed > 0
        && pendingEvidence.round.hintState === verbExerciseFamilyCore.VERB_HINT_STATES.USED)
    );
    if (!pendingEvidence.round.completed
        || !pendingFirstSupportMatches
        || (pendingSolution
          ? pendingEvidence.round.hintState !== verbExerciseFamilyCore.VERB_HINT_STATES.SOLUTION_REVEALED
            || pendingEvidence.request.solutionRevealed !== true
            || pendingEvidence.request.score !== 0
            || pendingEvidence.round.selectedItemRef
            || pendingEvidence.round.rejectedItemRefs.length !== 0
          : !pendingFirstCorrect
            || !pendingTargetSelected
            || pendingEvidence.request.score !== 1
            || pendingEvidence.request.solutionRevealed !== false
            || pendingEvidence.round.rejectedItemRefs.length !== 0)) {
      throw new Error("The pending morphology evidence contradicts its terminal round.");
    }
  } else if (pendingEvidence
      && (pendingEvidence.request.score !== 0
        || pendingEvidence.request.solutionRevealed !== false
        || pendingEvidence.round.completed
        || !pendingEvidence.round.settlementId
        || !pendingEvidence.round.selectedItemRef
        || morphologyRefKey(pendingEvidence.round.selectedItemRef) === targetKey
        || !new Set(pendingEvidence.round.rejectedItemRefs.map(morphologyRefKey))
          .has(morphologyRefKey(pendingEvidence.round.selectedItemRef)))) {
    throw new Error("A pending nonterminal morphology response must remain an incorrect first response.");
  }
  if (recorded && !terminalCompletionKind && !pendingEvidence) {
    if (round.completed
        || score !== 0
        || evidenceSolutionRevealed
        || !round.settlementId
        || !round.selectedItemRef
        || selectedKey === targetKey
        || !rejectedKeys.has(selectedKey)) {
      throw new Error("A restored nonterminal morphology response must remain its recorded incorrect first response.");
    }
  }
  return {
    schemaVersion: verbMorphologyProgressSchema,
    round,
    evidence: {
      recorded,
      score,
      solutionRevealed: evidenceSolutionRevealed,
      hintsUsed,
      occurredAt
    },
    pendingEvidence,
    terminalCompletionKind,
    pendingCompletionKind
  };
}

function morphologyTaskRefFor(round, resolution) {
  return verbMorphologyAdapter().buildTaskRef({
    bindingId: resolution.binding.id,
    taskFingerprint: round.taskFingerprint
  });
}

function morphologyItemRefFor(round, resolution) {
  return verbMorphologyAdapter().buildItemRef({
    contentId: resolution.source.contentId,
    itemId: round.cue.cueRef.id
  });
}

function composeBoundMorphologyRound(catalog, resolution, taskFingerprint, optionCount) {
  const selectedCueRef = resolution.source.snapshot?.selectedCueRef;
  if (!selectedCueRef) throw new Error("The morphology sequence step does not pin one learner-visible cue.");
  return verbMorphologyCore.composeMorphologyRound(catalog, {
    catalogRef: { id: catalog.catalogId, version: catalog.version },
    familyRef: resolution.source.snapshot.familyRef,
    cueRef: selectedCueRef,
    taskFingerprint,
    optionCount,
    releaseMode: false
  });
}

async function resolveVerbMorphologyStep(curriculum, familyConfiguration, sequenceConfiguration, claim) {
  const sequence = claim?.sequence;
  const preview = claim?.preview;
  if (!sequence || !preview
      || sequence.id !== sequenceConfiguration.id
      || sequence.revision !== sequenceConfiguration.revision
      || sequence.totalSteps !== 3
      || sequence.orderedBindingIds?.some((id, index) => id !== sequenceConfiguration.orderedBindingIds[index])
      || preview.bindingId !== sequenceConfiguration.orderedBindingIds[sequence.stepIndex]
      || preview.contentRef?.contentId !== sequenceConfiguration.orderedContentIds[sequence.stepIndex]
      || preview.targetSkillId !== sequenceConfiguration.targetSkillId
      || preview.capabilityId !== familyConfiguration.assessedCapabilityId) {
    throw new Error("The morphology preview is not the exact authored step in the pinned pilot sequence.");
  }
  const resolution = await curriculum.resolveBinding("verb-nebula", preview.contentRef.contentId);
  if (resolution.binding.id !== preview.bindingId
      || !sameCurriculumContentRef(resolution.binding.contentRef, preview.contentRef)
      || resolution.binding.exerciseFamilyId !== familyConfiguration.exerciseFamilyId
      || !resolution.binding.targetSkillRefs?.some((reference) => (
        reference?.id === sequenceConfiguration.targetSkillId
      ))) {
    throw new Error("The resolved morphology binding differs from the pinned pilot sequence preview.");
  }
  const catalog = await verbMorphologyCore.resolvePinnedMorphologyCatalog(
    verbMorphologyCatalogBytes,
    resolution.source.catalogDigest
  );
  if (catalog.catalogId !== resolution.source.catalogId
      || catalog.version !== resolution.source.catalogRevision) {
    throw new Error("The morphology catalog identity does not match its curriculum source pin.");
  }
  const familyRef = resolution.source.snapshot?.familyRef;
  const family = catalog.families.find((entry) => (
    entry.id === familyRef?.id && entry.revision === familyRef?.revision
  ));
  if (!family) throw new Error("The morphology source references an unavailable family revision.");
  const refKey = (reference) => `${reference?.id || ""}@${reference?.revision || ""}`;
  const sameRefSet = (left, right) => {
    const leftKeys = Array.from(left || [], refKey).sort();
    const rightKeys = Array.from(right || [], refKey).sort();
    return leftKeys.length === rightKeys.length
      && leftKeys.every((value, index) => value === rightKeys[index]);
  };
  const familyItems = catalog.items.filter((item) => refKey(item.familyRef) === refKey(familyRef));
  const familyCues = catalog.cues.filter((cue) => refKey(cue.familyRef) === refKey(familyRef));
  if (!sameRefSet(resolution.source.snapshot?.itemRefs, familyItems)
      || !sameRefSet(resolution.source.snapshot?.cueRefs, familyCues)
      || !familyCues.some((cue) => refKey(cue) === refKey(resolution.source.snapshot?.selectedCueRef))) {
    throw new Error("The morphology source does not pin the exact authored pilot family members and cue.");
  }
  if (resolution.source.snapshot?.sequenceRef?.id !== sequence.id
      || resolution.source.snapshot?.sequenceRef?.revision !== sequence.revision
      || resolution.source.snapshot?.sequenceStep !== sequence.stepNumber
      || family.metadata?.exerciseFamilyId !== resolution.binding.exerciseFamilyId
      || family.metadata?.targetSkillRef?.id !== sequenceConfiguration.targetSkillId) {
    throw new Error("The morphology family metadata is not aligned to its sequence binding.");
  }
  return { resolution, catalog, family };
}

function showCompletedVerbMorphologySequence({ focus = false } = {}) {
  state.verbGuidedStatus = "complete";
  state.verbMorphologySequenceComplete = true;
  state.verbMorphologyRound = null;
  state.verbMorphologyRoundState = null;
  state.verbMorphologyTask = null;
  state.verbMorphologyProgress = null;
  state.verbMorphologyProgressRevision = 0;
  state.verbMorphologyFocusNextStep = focus;
  setVerbMorphologyAnnouncement(
    "All three pinned pilot forms are complete. This remains non-mastery practice with 0 XP.",
    "correct"
  );
}

function verbMorphologyPreparationCurrent(generation) {
  return state.verbMorphologyGeneration === generation && !state.verbProgressResetPending;
}

async function prepareVerbMorphologyGuidedStepInternal(curriculum, familyConfiguration, generation) {
  const sequenceConfiguration = morphologySequenceConfiguration(familyConfiguration);
  verbMorphologyAdapter();
  state.verbGuidedMode = true;
  state.verbGuidedStatus = "loading";
  state.verbGuidedError = "";
  state.verbGuidedLifecycle = null;
  state.verbGuidedActivationPromise = null;
  state.verbGuidedEvidencePending = false;
  state.verbGuidedSupportAtFirstResponse = false;
  state.verbMorphologySequenceComplete = false;
  state.verbMorphologyTask = null;
  state.verbMorphologyProgress = null;
  state.verbMorphologyProgressRevision = 0;
  state.verbMorphologyResume = false;

  const claim = await curriculum.claimDeveloperPilotSequence(
    sequenceConfiguration.orderedBindingIds,
    {
      targetSkillId: sequenceConfiguration.targetSkillId,
      capabilityId: familyConfiguration.assessedCapabilityId,
      requirePresented: () => false
    }
  );
  if (!verbMorphologyPreparationCurrent(generation)) return;
  state.verbMorphologySequence = claim?.sequence || null;
  state.verbMorphologySequencePreview = claim?.preview || null;
  if (claim?.status === "complete" && claim.reason === "sequence-complete") {
    if (claim.sequence?.id !== sequenceConfiguration.id
        || claim.sequence?.revision !== sequenceConfiguration.revision
        || claim.sequence?.stepIndex !== 3
        || claim.sequence?.totalSteps !== 3) {
      throw new Error("The completed morphology sequence checkpoint does not match this course.");
    }
    showCompletedVerbMorphologySequence();
    return;
  }
  const resumable = claim?.status === "blocked" && claim.reason === "incomplete-step";
  const previewable = claim?.status === "deferred" && claim.reason === "not-presented";
  if (!resumable && !previewable) {
    const reason = claim?.reason || claim?.status || "unavailable";
    throw new Error(`The morphology sequence is locked (${reason}).`);
  }

  const { resolution, catalog, family } = await resolveVerbMorphologyStep(
    curriculum,
    familyConfiguration,
    sequenceConfiguration,
    claim
  );
  if (!verbMorphologyPreparationCurrent(generation)) return;
  state.verbGuidedResolution = resolution;
  state.verbMorphologyCatalog = catalog;
  state.verbMorphologyFamily = family;

  if (resumable) {
    const restored = await curriculum.restoreMorphologyRoundState(claim.taskRef);
    if (!verbMorphologyPreparationCurrent(generation)) return;
    if (!restored?.task
        || restored.task.taskId !== claim.taskRef?.taskId
        || restored.task.taskFingerprint !== claim.taskRef?.taskFingerprint) {
      throw new Error("The interrupted morphology task could not be restored exactly.");
    }
    const expectedRound = composeBoundMorphologyRound(
      catalog,
      resolution,
      restored.task.taskFingerprint,
      familyConfiguration.optionCount
    );
    if (restored.round && JSON.stringify(restored.round) !== JSON.stringify(expectedRound)) {
      throw new Error("The restored morphology round differs from its deterministic pinned pilot content.");
    }
    const round = expectedRound;
    if (round.taskFingerprint !== restored.task.taskFingerprint
        || round.cue?.cueRef?.id !== resolution.source.snapshot.selectedCueRef.id
        || round.cue?.cueRef?.revision !== resolution.source.snapshot.selectedCueRef.revision) {
      throw new Error("The restored morphology round differs from its exact sequence cue.");
    }
    const fallbackRoundState = verbMorphologyAdapter().createRoundState(round, {
      taskRef: morphologyTaskRefFor(round, resolution),
      itemRef: morphologyItemRefFor(round, resolution)
    });
    const progress = normalizeVerbMorphologyProgress(restored.state, fallbackRoundState, round);
    state.verbMorphologyProgressRevision = Number(restored.revision || 0);
    applyMorphologyGuidedRound(round, { task: restored.task, progress });
    state.verbMorphologyResume = true;
    if (!restored.round) {
      await saveVerbMorphologyProgress(progress);
      if (!verbMorphologyPreparationCurrent(generation)) return;
    }
    state.verbGuidedStatus = "ready";
    await recoverVerbMorphologyProgress({ duringInitialization: true });
    if (!verbMorphologyPreparationCurrent(generation)) return;
    if (state.verbMorphologySequenceComplete) {
      showCompletedVerbMorphologySequence();
    } else if (state.verbGuidedStatus === "step-complete") {
      state.verbMorphologyFocusNextStep = true;
      await prepareVerbMorphologyGuidedStep(curriculum, familyConfiguration);
    }
    return;
  }

  const previewRound = composeBoundMorphologyRound(
    catalog,
    resolution,
    `preview:${resolution.source.contentDigest}`,
    familyConfiguration.optionCount
  );
  const lifecycle = guidedOpportunityCore.createGuidedOpportunityLifecycle({
    curriculum,
    resolution,
    capabilityId: familyConfiguration.assessedCapabilityId,
    targetSkillId: sequenceConfiguration.targetSkillId,
    sequence: {
      orderedBindingIds: sequenceConfiguration.orderedBindingIds,
      expectedStep: claim.sequence.expectedStep
    }
  });
  state.verbGuidedLifecycle = lifecycle;
  state.verbGuidedStatus = "pending";
  applyMorphologyGuidedRound(previewRound);
}

async function prepareVerbMorphologyGuidedStep(curriculum, familyConfiguration) {
  const generation = state.verbMorphologyGeneration + 1;
  state.verbMorphologyGeneration = generation;
  const preparation = prepareVerbMorphologyGuidedStepInternal(
    curriculum,
    familyConfiguration,
    generation
  );
  state.verbMorphologyPreparePromise = preparation;
  try {
    return await preparation;
  } finally {
    if (state.verbMorphologyPreparePromise === preparation) {
      state.verbMorphologyPreparePromise = null;
    }
  }
}

async function initializeVerbGuidedMode() {
  if (!explicitLocalGuidedRequest()) return;
  state.verbGuidedRequested = true;
  state.verbGuidedStatus = "loading";
  state.verbExerciseFamily = requestedVerbExerciseFamily();
  try {
    const familyConfiguration = verbExerciseFamilyConfiguration(state.verbExerciseFamily);
    if (!familyConfiguration) throw new Error("The requested Verb exercise family is not configured for this course.");
    const curriculum = window.CaatuuCurriculum;
    if (!curriculum) throw new Error("The curriculum runtime is unavailable.");
    guidedOpportunityCore = await import("./curriculum/guided-opportunity.mjs?v=guided-opportunity-5");
    await curriculum.ready();
    if (!curriculum.guidedModeEnabled()) {
      throw new Error("Developer Guided mode is not enabled for this local course profile.");
    }
    if (state.verbExerciseFamily === "morphology") {
      if (!verbMorphologyCore || !verbExerciseFamilyCore || !verbMorphologyCatalogBytes.length) {
        throw new Error("The morphology pilot runtime is unavailable.");
      }
      await prepareVerbMorphologyGuidedStep(curriculum, familyConfiguration);
      return;
    }
    const resolution = await curriculum.resolveBinding("verb-nebula", familyConfiguration.stableContentId);
    if (resolution.binding.exerciseFamilyId !== familyConfiguration.exerciseFamilyId) {
      throw new Error("The resolved meaning binding has the wrong exercise family.");
    }
    const reviewedReferences = [
      resolution.source.snapshot,
      ...Array.from(resolution.source.snapshot.guidedContrasts || [])
    ];
    const [targetPair, ...contrastPairs] = await verbNebulaCore.resolvePinnedStableVerbPairs(
      countryDictionaryBytes,
      resolution.source.catalogDigest,
      reviewedReferences
    );
    const catalog = verbNebulaCore.extractCoreVerbPairs(countryDictionary);
    const plan = verbNebulaCore.buildGuidedVerbRound(
      catalog,
      targetPair,
      {
        pairCount: 4,
        contrastPairs,
        taskFingerprint: `preview:${resolution.source.contentDigest}`
      }
    );
    const targetSkillId = resolution.binding.targetSkillRefs[0]?.id;
    const lifecycle = guidedOpportunityCore.createGuidedOpportunityLifecycle({
      curriculum,
      resolution,
      capabilityId: familyConfiguration.assessedCapabilityId,
      targetSkillId
    });
    state.verbGuidedMode = true;
    state.verbGuidedStatus = "pending";
    state.verbGuidedPlan = plan;
    state.verbGuidedTargetId = plan.targetId;
    state.verbGuidedResolution = resolution;
    state.verbGuidedLifecycle = lifecycle;
    state.verbGuidedCatalog = catalog;
    state.verbGuidedTargetPair = targetPair;
    state.verbGuidedContrastPairs = contrastPairs;
  } catch (error) {
    await abortVerbGuidedLifecycle();
    state.verbMorphologyResume = true;
    state.verbGuidedStatus = "failed";
    state.verbGuidedError = error?.message || String(error);
    if (state.verbExerciseFamily === "morphology") {
      setVerbMorphologyAnnouncement("The pinned pilot could not be prepared, so this round is locked.", "wrong");
    }
    console.error("Verb Nebula Guided mode failed closed", error);
  }
}

function applyMorphologyGuidedRound(round, { task = null, progress = null } = {}) {
  const adapter = state.verbMorphologyAdapter;
  const resolution = state.verbGuidedResolution;
  if (!adapter || !resolution || !round) {
    throw new Error("Morphology round state requires an active pinned pilot binding.");
  }
  const fallbackRoundState = adapter.createRoundState(round, {
    taskRef: morphologyTaskRefFor(round, resolution),
    itemRef: morphologyItemRefFor(round, resolution)
  });
  const normalizedProgress = progress
    ? normalizeVerbMorphologyProgress(progress, fallbackRoundState, round)
    : freshVerbMorphologyProgress(fallbackRoundState);
  adapter.viewModel(round, normalizedProgress.round, { interactionLocked: true });
  state.verbMorphologyRound = round;
  state.verbMorphologyRoundState = normalizedProgress.round;
  state.verbMorphologyProgress = normalizedProgress;
  state.verbMorphologyTask = task;
  state.verbMorphologyFocusNextAction = false;
  state.verbMorphologyFocusHintAction = false;
  state.verbMorphologyFocusRevealAction = false;
  state.verbGuidedSupportAtFirstResponse = Boolean(
    normalizedProgress.evidence.recorded
      && (normalizedProgress.evidence.hintsUsed || normalizedProgress.evidence.solutionRevealed)
  );
  state.verbMorphologyAnnouncement = "Review the situation, then choose a form.";
  state.verbMorphologyAnnouncementKind = "";
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
  const morphology = state.verbExerciseFamily === "morphology";
  if (pairMenu) pairMenu.hidden = state.verbGuidedRequested;
  if (!banner || !detail) return;
  banner.hidden = !state.verbGuidedRequested;
  if (morphology) {
    banner.removeAttribute("role");
    banner.removeAttribute("aria-live");
    banner.removeAttribute("aria-atomic");
  } else {
    banner.setAttribute("role", "status");
    banner.setAttribute("aria-live", "polite");
    banner.setAttribute("aria-atomic", "true");
  }
  if (title) {
    title.textContent = state.verbExerciseFamily === "morphology"
      ? "Developer Guided · Verb forms · prototype-not-human-approved"
      : "Developer Guided · prototype-not-human-approved";
  }
  banner.classList.toggle("is-error", state.verbGuidedStatus === "failed");
  const lifecycle = state.verbGuidedLifecycle?.state();
  const morphologySupport = morphology ? verbMorphologySupportState() : null;
  const supported = Boolean(
    morphology
      ? morphologySupport.hintsUsed || morphologySupport.solutionRevealed
      : lifecycle?.hintsUsed || lifecycle?.solutionRevealed
  );
  const firstResponseRecorded = morphology
    ? verbMorphologyFirstResponseRecorded()
    : Boolean(lifecycle?.firstResponseRecorded);
  const supportedBeforeResponse = Boolean(state.verbGuidedSupportAtFirstResponse);
  const solutionShownAfterResponse = Boolean(
    firstResponseRecorded
      && (morphology ? morphologySupport.solutionRevealed : lifecycle?.solutionRevealed)
      && !supportedBeforeResponse
  );
  const contextHintShownAfterResponse = Boolean(
    morphology
      && firstResponseRecorded
      && morphologySupport.hintsUsed
      && !morphologySupport.solutionRevealed
      && !supportedBeforeResponse
  );
  banner.classList.toggle("is-supported", supported);
  if (!state.verbGuidedRequested) return;
  if (state.verbGuidedStatus === "failed") {
    detail.textContent = `Locked: ${state.verbGuidedError || "curriculum evidence is unavailable"}`;
  } else if (state.verbGuidedStatus === "recovery-pending" && morphology) {
    detail.textContent = "Saved locally · use Retry to finish the durable evidence checkpoint";
  } else if (state.verbGuidedStatus === "awaiting-next" && morphology) {
    const completed = Number(state.verbMorphologySequence?.stepNumber || 1);
    detail.textContent = supportedBeforeResponse
      ? `Form ${completed} of 3 complete · supported comprehension, not independent evidence · choose Next form when ready`
      : solutionShownAfterResponse
        ? `Form ${completed} of 3 complete · first response recorded independently; solution shown afterward · choose Next form when ready`
        : contextHintShownAfterResponse
          ? `Form ${completed} of 3 complete · first response recorded independently; context hint shown afterward · choose Next form when ready`
          : `Form ${completed} of 3 complete · choose Next form when ready`;
  } else if (state.verbGuidedStatus === "step-complete" && morphology) {
    const completed = Number(state.verbMorphologySequence?.stepNumber || 1);
    detail.textContent = `Form ${completed} of 3 complete · next form is ready when you choose`;
  } else if (state.verbGuidedStatus === "complete"
      && morphology) {
    detail.textContent = "Three-form pilot complete · meaning and unit mastery remain unchanged · 0 XP";
  } else if (state.verbGuidedStatus === "complete") {
    detail.textContent = supportedBeforeResponse
      ? "Pilot complete · supported practice, not independent evidence"
      : solutionShownAfterResponse
        ? "Pilot complete · first response recorded independently; solution shown afterward"
      : "Pilot complete · Unit 3 remains locked behind Units 1–2";
  } else if (supportedBeforeResponse) {
    detail.textContent = "Supported practice · not independent evidence";
  } else if (supported && !firstResponseRecorded) {
    detail.textContent = morphology
      ? "Context support is visible · the next answer will be supported comprehension"
      : "Support is visible · the next answer will be supported practice";
  } else if (solutionShownAfterResponse) {
    detail.textContent = "First response recorded independently · solution shown afterward";
  } else if (contextHintShownAfterResponse) {
    detail.textContent = "First response recorded independently · context hint shown afterward";
  } else if (firstResponseRecorded) {
    detail.textContent = "First response recorded · finish this exact form contrast";
  } else if (state.verbGuidedStatus === "ready"
      && morphology) {
    const step = Number(state.verbMorphologySequence?.stepNumber || 1);
    detail.textContent = `Form ${step} of 3 · visible-form comprehension · non-mastery · 0 XP`;
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

function verbMorphologyPresentationPainted() {
  const board = $("#verbMorphologyBoard");
  const round = state.verbMorphologyRound;
  const selectedCueRef = state.verbGuidedResolution?.source?.snapshot?.selectedCueRef;
  if (!board || board.hidden || !round || !selectedCueRef
      || round.cue?.cueRef?.id !== selectedCueRef.id
      || round.cue?.cueRef?.revision !== selectedCueRef.revision) return false;
  const presentation = round.cue.presentation || {};
  const visibleCueMatches = [
    ["#verbMorphologyRole", presentation.roleTokenEn],
    ["#verbMorphologyContext", presentation.contextEn],
    ["#verbMorphologyPrompt", presentation.naturalTranslationEn],
    ["#verbMorphologyTeachingLabel", presentation.teachingLabelEn]
  ].every(([selector, expected]) => $(selector)?.textContent === expected);
  if (!visibleCueMatches) return false;
  const buttons = Array.from(board.querySelectorAll("button[data-morphology-item-id]"));
  return buttons.length === round.options.length
    && buttons.every((button, index) => (
      button.dataset.morphologyItemId === round.options[index].itemRef.id
        && Number(button.dataset.morphologyItemRevision) === round.options[index].itemRef.revision
        && button.querySelector("[data-morphology-choice-surface]")?.textContent === round.options[index].surface
    ));
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
    && (state.verbExerciseFamily !== "morphology" || verbMorphologyPresentationPainted())
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
    .then(async (activation) => {
      if (!activation || activation.phase === "pending") {
        if (state.verbGuidedActivationEpoch === activationEpoch) {
          const changedStep = state.verbExerciseFamily === "morphology"
            && lifecycle.state().sequencePreview?.bindingId
            && lifecycle.state().sequencePreview.bindingId !== state.verbGuidedResolution?.binding?.id;
          if (changedStep) {
            await prepareVerbMorphologyGuidedStep(
              window.CaatuuCurriculum,
              verbExerciseFamilyConfiguration("morphology")
            );
            renderVerbNebula();
          } else {
            state.verbGuidedStatus = "pending";
          }
        }
        return;
      }
      if (activation.phase === "complete" && state.verbExerciseFamily === "morphology") {
        if (state.verbGuidedActivationEpoch !== activationEpoch
            || state.verbGuidedLifecycle !== lifecycle
            || state.verbProgressResetPending) return;
        state.verbMorphologySequence = lifecycle.state().sequence || state.verbMorphologySequence;
        state.verbMorphologySequencePreview = lifecycle.state().sequencePreview
          || state.verbMorphologySequencePreview;
        showCompletedVerbMorphologySequence({ focus: true });
        renderVerbNebula();
        return;
      }
      if (!verbGuidedPresentationReady(activationEpoch, lifecycle)) {
        if (state.verbGuidedActivationEpoch === activationEpoch) {
          state.verbGuidedStatus = "pending";
        }
        return;
      }
      if (state.verbExerciseFamily === "morphology") {
        const task = lifecycle.state().task;
        if (!task) throw new Error("The claimed morphology step did not return its exact issued task.");
        const round = composeBoundMorphologyRound(
          state.verbMorphologyCatalog,
          state.verbGuidedResolution,
          task.taskFingerprint,
          verbExerciseFamilyConfiguration("morphology").optionCount
        );
        applyMorphologyGuidedRound(round, { task });
        state.verbMorphologySequence = lifecycle.state().sequence || state.verbMorphologySequence;
        state.verbMorphologySequencePreview = lifecycle.state().sequencePreview || state.verbMorphologySequencePreview;
        await saveVerbMorphologyProgress();
        state.verbGuidedStatus = "ready";
        state.verbMorphologyResume = false;
        state.verbMorphologyAnnouncement = `Choose the ${course.targetLanguage?.label || "target-language"} form for this exact situation.`;
        renderVerbNebula();
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
      if (state.verbExerciseFamily === "morphology") {
        state.verbMorphologyAnnouncement = "Guided evidence could not be prepared. This round is locked.";
      } else {
        setVerbMatchFeedback("Guided evidence could not be prepared. This round is locked.", "wrong");
      }
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
    if (state.verbExerciseFamily === "morphology") {
      state.verbMemoryLoaded = true;
      return;
    }
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
  state.verbHintsEnabled = Boolean(memory?.hintsEnabled);
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

function setVerbMorphologyAnnouncement(message, kind = "") {
  state.verbMorphologyAnnouncement = String(message || "");
  state.verbMorphologyAnnouncementKind = kind;
}

function serializeVerbMorphologyRoundState(changes = {}) {
  if (!state.verbMorphologyAdapter || !state.verbMorphologyRoundState) {
    throw new Error("The morphology round state is unavailable.");
  }
  return state.verbMorphologyAdapter.serializeRound({
    ...state.verbMorphologyRoundState,
    ...changes
  });
}

function updateVerbMorphologyRoundState(changes = {}) {
  state.verbMorphologyRoundState = serializeVerbMorphologyRoundState(changes);
  if (state.verbMorphologyProgress) {
    state.verbMorphologyProgress = {
      ...state.verbMorphologyProgress,
      round: state.verbMorphologyRoundState
    };
  }
}

function verbMorphologyFirstResponseRecorded() {
  return state.verbMorphologyProgress?.evidence?.recorded === true
    || state.verbGuidedLifecycle?.state?.().firstResponseRecorded === true;
}

function verbMorphologySupportState() {
  const progress = state.verbMorphologyProgress;
  const lifecycle = state.verbGuidedLifecycle?.state?.();
  const hintState = progress?.round?.hintState;
  return {
    hintsUsed: Math.max(
      Number(progress?.evidence?.hintsUsed || progress?.pendingEvidence?.request?.hintsUsed || 0),
      Number(lifecycle?.hintsUsed || 0),
      hintState && hintState !== verbExerciseFamilyCore.VERB_HINT_STATES.AVAILABLE ? 1 : 0
    ),
    solutionRevealed: Boolean(
      progress?.evidence?.solutionRevealed
        || progress?.pendingEvidence?.request?.solutionRevealed
        || lifecycle?.solutionRevealed
        || hintState === verbExerciseFamilyCore.VERB_HINT_STATES.SOLUTION_REVEALED
    )
  };
}

async function saveVerbMorphologyProgress(progress = state.verbMorphologyProgress) {
  const task = state.verbMorphologyTask;
  if (!task || !state.verbMorphologyRound || !progress) {
    throw new Error("Morphology progress requires an exact issued task and round.");
  }
  const normalized = normalizeVerbMorphologyProgress(
    progress,
    state.verbMorphologyRoundState,
    state.verbMorphologyRound
  );
  const saved = await window.CaatuuCurriculum.saveMorphologyRoundState(task, {
    round: state.verbMorphologyRound,
    state: normalized,
    expectedRevision: state.verbMorphologyProgressRevision
  });
  state.verbMorphologyProgress = normalized;
  state.verbMorphologyRoundState = normalized.round;
  state.verbMorphologyProgressRevision = Number(saved?.revision || state.verbMorphologyProgressRevision);
  return saved;
}

async function abortVerbGuidedLifecycle(lifecycle = state.verbGuidedLifecycle) {
  if (!lifecycle?.abort) return;
  try {
    await lifecycle.abort();
  } finally {
    if (state.verbGuidedLifecycle === lifecycle) state.verbGuidedLifecycle = null;
  }
}

async function failVerbMorphologyOnRevisionConflict(error) {
  const conflictCodes = [
    "CURRICULUM_MORPHOLOGY_ROUND_REVISION_CONFLICT",
    "CURRICULUM_MORPHOLOGY_ROUND_SETTLED"
  ];
  const invalidatedCodes = [
    "CURRICULUM_MORPHOLOGY_ROUND_TASK_INVALID",
    "EVIDENCE_TASK_NOT_ISSUED",
    "CURRICULUM_DEVELOPER_PILOT_SEQUENCE_INVALID",
    "CURRICULUM_DEVELOPER_PILOT_SEQUENCE_UNKNOWN",
    "CURRICULUM_DEVELOPER_PILOT_SEQUENCE_CONFLICT",
    "CURRICULUM_DEVELOPER_PILOT_COMPLETION_TASK_INVALID",
    "CURRICULUM_DEVELOPER_PILOT_COMPLETION_UNCLAIMED",
    "CURRICULUM_DEVELOPER_PILOT_COMPLETION_OUT_OF_ORDER",
    "CURRICULUM_DEVELOPER_PILOT_COMPLETION_CONFLICT",
    "CURRICULUM_DEVELOPER_PILOT_COMPLETION_EVIDENCE_MISMATCH",
    "CURRICULUM_DEVELOPER_PILOT_COMPLETION_SETTLEMENT_MISMATCH",
    "CURRICULUM_DEVELOPER_PILOT_COMPLETION_KIND_INVALID",
    "CURRICULUM_STORAGE_CORRUPT"
  ];
  if (![...conflictCodes, ...invalidatedCodes].includes(error?.code)) return false;
  await abortVerbGuidedLifecycle();
  state.verbMorphologyResume = true;
  state.verbGuidedError = error.message;
  state.verbGuidedStatus = "failed";
  setVerbMorphologyAnnouncement(
    invalidatedCodes.includes(error?.code)
      ? "This task was cleared or invalidated in another tab. Reload to start from the current curriculum state."
      : "This task changed in another tab. Reload this page to continue from the newest saved state.",
    "wrong"
  );
  return true;
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

function morphologyEvidenceRequest({ score, solutionRevealed = false, occurredAt = new Date().toISOString() } = {}) {
  const support = verbMorphologySupportState();
  return {
    attemptNumber: 1,
    score,
    solutionRevealed,
    hintsUsed: support.hintsUsed,
    occurredAt
  };
}

async function recordVerbMorphologyEvidence(request, { direct = false } = {}) {
  if (!direct && state.verbGuidedLifecycle && !state.verbMorphologyResume) {
    return request.solutionRevealed
      ? state.verbGuidedLifecycle.recordSolutionReveal({ occurredAt: request.occurredAt })
      : state.verbGuidedLifecycle.recordFirstResponse({
        score: request.score,
        occurredAt: request.occurredAt
      });
  }
  return window.CaatuuCurriculum.recordEvidence(state.verbMorphologyTask, request);
}

async function completeVerbMorphologySequenceStep(completionKind, { direct = false } = {}) {
  const sequenceConfiguration = morphologySequenceConfiguration(
    verbExerciseFamilyConfiguration("morphology")
  );
  const task = state.verbMorphologyTask;
  if (!task) throw new Error("The morphology sequence checkpoint has no issued task.");
  let completion;
  if (!direct && state.verbGuidedLifecycle && !state.verbMorphologyResume) {
    completion = await state.verbGuidedLifecycle.completeSequenceStep(completionKind, {
      completedAt: new Date().toISOString()
    });
    completion = completion.result;
  } else {
    completion = await window.CaatuuCurriculum.completeDeveloperPilotStep({
      orderedBindingIds: sequenceConfiguration.orderedBindingIds,
      targetSkillId: sequenceConfiguration.targetSkillId,
      taskId: task.taskId,
      taskFingerprint: task.taskFingerprint,
      completionKind,
      completedAt: new Date().toISOString()
    });
  }
  const sequence = state.verbMorphologySequence;
  const finalStep = Number(completion?.stepIndex) + 1 >= Number(sequence?.totalSteps || 3);
  state.verbMorphologyProgress = {
    ...state.verbMorphologyProgress,
    pendingCompletionKind: null
  };
  state.verbMorphologySequenceComplete = finalStep;
  state.verbGuidedStatus = finalStep ? "complete" : "step-complete";
  const completedNumber = Number(completion?.stepIndex) + 1;
  setVerbMorphologyAnnouncement(
    finalStep
      ? "All three pinned pilot forms are complete. This remains non-mastery practice with 0 XP."
      : `Form ${completedNumber} of 3 complete. Continue when you are ready for the next pilot contrast.`,
    "correct"
  );
  return completion;
}

async function recoverVerbMorphologyProgress({ duringInitialization = false } = {}) {
  let progress = state.verbMorphologyProgress;
  if (!progress || !state.verbMorphologyTask) return;
  state.verbGuidedEvidencePending = true;
  if (!duringInitialization) renderVerbNebula();
  try {
    if (progress.pendingEvidence) {
      const pending = progress.pendingEvidence;
      await recordVerbMorphologyEvidence(pending.request, { direct: true });
      state.verbMorphologyResume = true;
      const recoveredProgress = {
        ...progress,
        round: pending.round,
        evidence: {
          recorded: true,
          score: pending.request.score,
          solutionRevealed: pending.request.solutionRevealed,
          hintsUsed: pending.request.hintsUsed,
          occurredAt: pending.request.occurredAt
        },
        pendingEvidence: null,
        terminalCompletionKind: pending.completionKind,
        pendingCompletionKind: null
      };
      await saveVerbMorphologyProgress(recoveredProgress);
      progress = state.verbMorphologyProgress;
      state.verbGuidedSupportAtFirstResponse = Boolean(
        progress.evidence.hintsUsed || progress.evidence.solutionRevealed
      );
    }
    const completionKind = progress.pendingCompletionKind;
    if (completionKind) {
      await completeVerbMorphologySequenceStep(completionKind, { direct: true });
    } else if (progress.terminalCompletionKind) {
      state.verbGuidedStatus = "awaiting-next";
      const restoredWithSupport = Boolean(state.verbGuidedSupportAtFirstResponse);
      setVerbMorphologyAnnouncement(
        progress.terminalCompletionKind === "solution-review"
          ? restoredWithSupport
            ? "The shown solution is restored. This remains supported comprehension, not independent evidence. Choose Next form when you are ready to continue."
            : "The earlier first response remains recorded; the restored solution review does not change it. Choose Next form when you are ready to continue."
          : restoredWithSupport
            ? "This form contrast is restored as supported comprehension, not independent evidence. Choose Next form when you are ready to continue."
            : "This form contrast is complete. Choose Next form when you are ready to continue.",
        progress.terminalCompletionKind === "solution-review" ? "hint" : "correct"
      );
    } else {
      state.verbGuidedStatus = "ready";
      if (progress.evidence.recorded) {
        setVerbMorphologyAnnouncement(
          "Your recorded first response was restored. Continue the same corrective round or review the form.",
          "hint"
        );
      }
    }
  } catch (error) {
    state.verbGuidedError = error?.message || String(error);
    if (!(await failVerbMorphologyOnRevisionConflict(error))) {
      state.verbGuidedStatus = "recovery-pending";
      setVerbMorphologyAnnouncement(
        progress.pendingEvidence
          ? "Your answer is saved locally but its curriculum evidence still needs to be retried."
          : "Your evidence is recorded, but the sequence checkpoint still needs to be retried.",
        "wrong"
      );
    }
    if (duringInitialization) return;
  } finally {
    state.verbGuidedEvidencePending = false;
    renderVerbNebula();
  }
}

function morphologyPresentation() {
  return state.verbMorphologyRound?.cue?.presentation || {};
}

function verbMorphologyFocusVisible(board = $("#verbMorphologyBoard")) {
  const panel = $("#trainPanelVerbLab");
  return Boolean(
    board
      && !board.hidden
      && panel
      && !panel.hidden
      && panel.classList.contains("is-active")
      && document.visibilityState !== "hidden"
  );
}

function focusVerbMorphologyControl(control, board) {
  if (!control || !verbMorphologyFocusVisible(board)) return false;
  control.focus({ preventScroll: true });
  return document.activeElement === control;
}

function renderVerbMorphology() {
  const board = $("#verbMorphologyBoard");
  const meaningBoard = $("#verbMeaningBoard");
  const meaningFooter = $("#verbMeaningFooter");
  if (meaningBoard) meaningBoard.hidden = true;
  if (meaningFooter) meaningFooter.hidden = true;
  if (!board) return;
  board.hidden = false;
  renderVerbGuidedStatus();

  const round = state.verbMorphologyRound;
  const persistedRound = state.verbMorphologyRoundState;
  const adapter = state.verbMorphologyAdapter;
  const choices = $("#verbMorphologyChoices");
  const cue = $("#verbMorphologyCue");
  const instructions = $("#verbMorphologyInstructions");
  const actions = board.querySelector(".verb-morphology-actions");
  const lemma = $("#verbMorphologyLemma");
  const nextButton = $("#verbMorphologyNextButton");
  board.classList.toggle("is-sequence-complete", state.verbMorphologySequenceComplete);
  if (state.verbMorphologySequenceComplete && !round) {
    const hintPanel = $("#verbMorphologyHint");
    if (choices) {
      choices.replaceChildren();
      choices.hidden = true;
    }
    if (cue) cue.hidden = true;
    if (instructions) instructions.hidden = true;
    if (actions) actions.hidden = true;
    if (lemma) lemma.hidden = true;
    if (hintPanel) hintPanel.hidden = true;
    if (nextButton) nextButton.hidden = true;
    setText("#verbMorphologyTitle", "Three pilot forms complete");
    setText("#verbMorphologyFeedback", state.verbMorphologyAnnouncement);
    setText("#verbMorphologyProgress", "3 of 3 · non-mastery · 0 XP");
    board.setAttribute("aria-busy", state.verbProgressResetPending ? "true" : "false");
    if (state.verbMorphologyFocusNextStep) {
      const summary = $("#verbMorphologyFeedback");
      if (summary) {
        summary.tabIndex = -1;
        if (focusVerbMorphologyControl(summary, board)) {
          state.verbMorphologyFocusNextStep = false;
        }
      }
    }
    return;
  }
  if (!round || !persistedRound || !adapter) {
    const hintPanel = $("#verbMorphologyHint");
    if (choices) {
      choices.replaceChildren();
      choices.hidden = true;
    }
    if (cue) cue.hidden = true;
    if (instructions) instructions.hidden = true;
    if (actions) actions.hidden = true;
    if (lemma) lemma.hidden = true;
    if (hintPanel) hintPanel.hidden = true;
    if (nextButton) nextButton.hidden = true;
    setText("#verbMorphologyTitle", "Verb forms are locked");
    setText("#verbMorphologyFeedback", state.verbGuidedError || "The pinned pilot content is unavailable.");
    setText("#verbMorphologyProgress", "Unavailable · non-mastery · 0 XP");
    board.setAttribute(
      "aria-busy",
      state.verbProgressResetPending
        || ["loading", "pending", "activating"].includes(state.verbGuidedStatus)
        ? "true"
        : "false"
    );
    return;
  }
  if (choices) choices.hidden = false;
  if (cue) cue.hidden = false;
  if (instructions) instructions.hidden = false;
  if (actions) actions.hidden = false;
  if (lemma) lemma.hidden = false;

  const presentation = morphologyPresentation();
  const familyMetadata = state.verbMorphologyFamily?.metadata || {};
  const lemmaTarget = familyMetadata.lemmaTarget || "pilot verb";
  const glossEn = familyMetadata.glossEn || "verb form";
  const targetLanguageLabel = course.targetLanguage?.label || "target language";
  const targetLanguageLocale = course.targetLanguage?.locale || course.targetLanguage?.id || "";
  const instruction = `Choose the ${targetLanguageLabel} form that fits this exact situation.`;
  const hintText = presentation.hintEn || presentation.contextEn || "Use the participant role and current-time cue.";
  const viewModel = adapter.viewModel(round, persistedRound, {
    interactionLocked: verbGuidedInteractionLocked(),
    announcement: state.verbMorphologyAnnouncement,
    cueText: presentation.naturalTranslationEn || presentation.contextEn || round.cue.key,
    cueLanguage: "en",
    targetLanguage: targetLanguageLocale,
    instruction,
    choiceGroupLabel: `${targetLanguageLabel} verb-form choices`,
    hintText
  });

  board.setAttribute(
    "aria-busy",
    state.verbProgressResetPending
      || state.verbGuidedEvidencePending
      || state.verbMorphologyAdvancePending
      || ["loading", "pending", "activating"].includes(state.verbGuidedStatus)
      ? "true"
      : "false"
  );
  setText("#verbMorphologyTitle", "Which form fits?");
  setText("#verbMorphologyLemmaTarget", lemmaTarget);
  setText("#verbMorphologyGloss", glossEn);
  setText("#verbMorphologyInstructions", `${instruction} All choices stay available on every trial.`);
  const lemmaNode = $("#verbMorphologyLemmaTarget");
  if (lemmaNode) lemmaNode.lang = targetLanguageLocale;
  const glossNode = $("#verbMorphologyGloss");
  if (glossNode) glossNode.lang = "en";
  setText("#verbMorphologyRole", presentation.roleTokenEn || "?");
  setText("#verbMorphologyContext", presentation.contextEn || viewModel.cue.text);
  setText("#verbMorphologyPrompt", presentation.naturalTranslationEn || viewModel.cue.text);
  setText("#verbMorphologyTeachingLabel", presentation.teachingLabelEn || "pinned pilot context contrast");
  const sequenceStep = Number(state.verbMorphologySequence?.stepNumber || 1);
  setText(
    "#verbMorphologyProgress",
    `Form ${sequenceStep} of 3 · ${viewModel.choiceGroup.choices.length} pinned choices · 0 XP`
  );

  if (choices) {
    choices.setAttribute("aria-label", viewModel.choiceGroup.ariaLabel);
    const renderedChoices = viewModel.choiceGroup.choices;
    const existingButtons = Array.from(choices.children).filter((node) => (
      node instanceof HTMLButtonElement && node.matches("button[data-morphology-item-id]")
    ));
    const reusable = existingButtons.length === renderedChoices.length
      && existingButtons.every((button, index) => (
        button.dataset.morphologyItemId === renderedChoices[index].itemRef.id
          && button.dataset.morphologyItemRevision === String(renderedChoices[index].itemRef.revision)
      ));
    const buttons = reusable
      ? existingButtons
      : renderedChoices.map(() => document.createElement("button"));
    buttons.forEach((button, index) => {
      const choice = renderedChoices[index];
      button.type = "button";
      button.className = "verb-morphology-choice";
      button.classList.toggle("is-selected", choice.state === "selected");
      button.classList.toggle("is-wrong", choice.state === "rejected");
      button.classList.toggle("is-correct", choice.state === "correct");
      button.classList.toggle(
        "is-revealed",
        viewModel.hint.solutionRevealed && choice.correct === true
      );
      button.dataset.morphologyItemId = choice.itemRef.id;
      button.dataset.morphologyItemRevision = String(choice.itemRef.revision);
      button.disabled = choice.disabled;
      button.removeAttribute("lang");
      button.removeAttribute("aria-pressed");
      button.removeAttribute("aria-label");
      const surface = button.querySelector("[data-morphology-choice-surface]")
        || document.createElement("span");
      surface.dataset.morphologyChoiceSurface = "";
      surface.lang = choice.language;
      surface.textContent = choice.text;
      const stateDescription = button.querySelector("[data-morphology-choice-state]")
        || document.createElement("span");
      stateDescription.dataset.morphologyChoiceState = "";
      stateDescription.className = "verb-morphology-visually-hidden";
      stateDescription.lang = "en";
      stateDescription.textContent = choice.stateDescription
        ? ` ${choice.stateDescription}`
        : "";
      button.replaceChildren(surface, stateDescription);
    });
    if (!reusable) choices.replaceChildren(...buttons);
    if (state.verbMorphologyFocusNextStep
        && state.verbGuidedStatus === "ready"
        && !state.verbGuidedEvidencePending) {
      const firstChoice = buttons.find((button) => (
        !button.disabled && !button.classList.contains("is-wrong")
      )) || buttons.find((button) => !button.disabled);
      if (focusVerbMorphologyControl(firstChoice, board)) {
        state.verbMorphologyFocusNextStep = false;
      }
    }
  }

  const hint = $("#verbMorphologyHint");
  if (hint) hint.hidden = !viewModel.hint.used;
  setText(
    "#verbMorphologyHintTitle",
    viewModel.hint.solutionRevealed ? "Shown pilot solution" : "Participant and context cue"
  );
  setText(
    "#verbMorphologyHintCopy",
    viewModel.hint.solutionRevealed
      ? (presentation.solutionExplanationEn || hintText)
      : hintText
  );

  const hintButton = $("#verbMorphologyHintButton");
  if (hintButton) {
    hintButton.disabled = viewModel.hint.actionDisabled;
    hintButton.textContent = viewModel.hint.used ? "Context hint shown" : "Context hint";
    if (state.verbMorphologyFocusHintAction
        && !hintButton.disabled
        && focusVerbMorphologyControl(hintButton, board)) {
      state.verbMorphologyFocusHintAction = false;
    }
  }
  const revealButton = $("#verbMorphologyRevealButton");
  if (revealButton) {
    revealButton.disabled = viewModel.completed || verbGuidedInteractionLocked();
    revealButton.textContent = viewModel.hint.solutionRevealed ? "Form revealed" : "Reveal form";
    if (state.verbMorphologyFocusRevealAction
        && !revealButton.disabled
        && focusVerbMorphologyControl(revealButton, board)) {
      state.verbMorphologyFocusRevealAction = false;
    }
  }
  if (nextButton) {
    const recoveryPending = state.verbGuidedStatus === "recovery-pending";
    const awaitingNext = state.verbGuidedStatus === "awaiting-next";
    const stepComplete = state.verbGuidedStatus === "step-complete";
    nextButton.hidden = !recoveryPending && !awaitingNext && !stepComplete;
    nextButton.disabled = state.verbProgressResetPending
      || state.verbGuidedEvidencePending
      || state.verbMorphologyAdvancePending;
    nextButton.textContent = recoveryPending
      ? (state.verbMorphologyProgress?.pendingEvidence ? "Retry saved answer" : "Retry checkpoint")
      : "Next form";
  }
  const feedback = $("#verbMorphologyFeedback");
  if (feedback) {
    feedback.textContent = viewModel.status.message || "Review the situation, then choose a form.";
    feedback.className = state.verbMorphologyAnnouncementKind
      ? `is-${state.verbMorphologyAnnouncementKind}`
      : "";
    if (state.verbMorphologyFocusNextAction
        && nextButton
        && !nextButton.hidden
        && !nextButton.disabled) {
      if (focusVerbMorphologyControl(nextButton, board)) {
        state.verbMorphologyFocusNextAction = false;
      }
    }
  }
}

function renderVerbNebula() {
  const panel = $("#trainPanelVerbLab");
  if (!panel) return;
  setText(
    "#verbWorldSubtitle",
    state.verbExerciseFamily === "morphology" ? "Choose forms" : "Match meanings"
  );
  loadVerbMemory();
  if (state.verbExerciseFamily === "morphology") {
    renderVerbMorphology();
    if (state.verbGuidedMode && state.verbGuidedStatus === "pending" && !panel.hidden) {
      void activateVerbGuidedOpportunity();
    }
    return;
  }
  const morphologyBoard = $("#verbMorphologyBoard");
  const meaningBoard = $("#verbMeaningBoard");
  const meaningFooter = $("#verbMeaningFooter");
  if (morphologyBoard) morphologyBoard.hidden = true;
  if (meaningBoard) meaningBoard.hidden = false;
  if (meaningFooter) meaningFooter.hidden = false;
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

function morphologyRefKey(reference) {
  return `${reference?.id || ""}@${reference?.revision || ""}`;
}

function morphologySettlement(kind, selection, correct, {
  hintState = state.verbMorphologyRoundState?.hintState
} = {}) {
  const current = state.verbMorphologyRoundState;
  const settlement = state.verbMorphologyAdapter.settle({
    taskRef: current.taskRef,
    itemRef: current.itemRef,
    kind,
    responseId: morphologyRefKey(selection),
    correct,
    hintState,
    requestedXp: 1
  });
  if (settlement.awardedXp !== 0 || settlement.xpSuppressed !== true) {
    throw new Error("Developer Guided morphology must suppress game XP.");
  }
  return settlement;
}

async function chooseVerbMorphologyForm(event) {
  const button = event.target.closest("button[data-morphology-item-id]");
  if (!button || button.disabled || verbGuidedInteractionLocked()) return;
  const transferFocus = Boolean($("#verbMorphologyBoard")?.contains(button));
  const selectedSurface = button.querySelector("[data-morphology-choice-surface]")?.textContent?.trim()
    || button.textContent.trim();
  const selection = {
    id: button.dataset.morphologyItemId,
    revision: Number(button.dataset.morphologyItemRevision)
  };
  const evaluation = verbMorphologyCore.evaluateMorphologySelection(
    state.verbMorphologyRound,
    { itemRef: selection }
  );
  const firstResponseWasRecorded = verbMorphologyFirstResponseRecorded();
  const support = verbMorphologySupportState();
  const supportAtFirstResponse = Boolean(support.hintsUsed || support.solutionRevealed);
  let nextRoundState;
  let completionKind = null;

  try {
    const settlementId = state.verbMorphologyRoundState.settlementId || morphologySettlement(
      "first-response",
      evaluation.selectedItemRef,
      evaluation.correct
    ).settlementId;
    if (evaluation.correct) {
      nextRoundState = serializeVerbMorphologyRoundState({
        selectedItemRef: evaluation.selectedItemRef,
        settlementId,
        completed: true
      });
    } else {
      const rejectedItemRefs = [
        ...state.verbMorphologyRoundState.rejectedItemRefs,
        evaluation.selectedItemRef
      ].filter((reference, index, rows) => (
        rows.findIndex((candidate) => morphologyRefKey(candidate) === morphologyRefKey(reference)) === index
      ));
      nextRoundState = serializeVerbMorphologyRoundState({
        selectedItemRef: evaluation.selectedItemRef,
        rejectedItemRefs,
        settlementId,
        completed: false
      });
    }
    if (evaluation.correct) {
      completionKind = firstResponseWasRecorded
        ? "corrective-correct"
        : "correct-first-response";
    }
  } catch (error) {
    await abortVerbGuidedLifecycle();
    state.verbMorphologyResume = true;
    state.verbGuidedStatus = "failed";
    state.verbGuidedError = error?.message || String(error);
    setVerbMorphologyAnnouncement(
      firstResponseWasRecorded
        ? "The earlier first response remains recorded, but this corrective result could not be prepared."
        : "Your answer was not recorded because the local result could not be prepared.",
      "wrong"
    );
    renderVerbNebula();
    return;
  }

  state.verbGuidedEvidencePending = true;
  renderVerbNebula();
  let journalSaved = false;
  try {
    if (!firstResponseWasRecorded) {
      const request = morphologyEvidenceRequest({ score: evaluation.score });
      const pendingProgress = {
        ...state.verbMorphologyProgress,
        pendingEvidence: {
          request,
          round: nextRoundState,
          completionKind
        }
      };
      await saveVerbMorphologyProgress(pendingProgress);
      journalSaved = true;
      await recordVerbMorphologyEvidence(request);
      state.verbGuidedSupportAtFirstResponse = supportAtFirstResponse;
      const completedEvidenceProgress = {
        ...pendingProgress,
        round: nextRoundState,
        evidence: {
          recorded: true,
          score: request.score,
          solutionRevealed: false,
          hintsUsed: request.hintsUsed,
          occurredAt: request.occurredAt
        },
        pendingEvidence: null,
        terminalCompletionKind: completionKind,
        pendingCompletionKind: null
      };
      await saveVerbMorphologyProgress(completedEvidenceProgress);
    } else {
      await saveVerbMorphologyProgress({
        ...state.verbMorphologyProgress,
        round: nextRoundState,
        terminalCompletionKind: completionKind,
        pendingCompletionKind: null
      });
    }
    state.verbMorphologyRoundState = nextRoundState;
    if (evaluation.correct) {
      state.verbGuidedStatus = "awaiting-next";
      state.verbMorphologyFocusNextAction = transferFocus;
      setVerbMorphologyAnnouncement(
        firstResponseWasRecorded
          ? `Correct now: ${selectedSurface}. The earlier first response remains recorded; choose Next form when ready.`
          : supportAtFirstResponse
            ? `Correct: ${selectedSurface}. This is supported form comprehension, not independent evidence; choose Next form when ready.`
            : `Correct: ${selectedSurface}. This records form comprehension only; choose Next form when ready.`,
        "correct"
      );
    } else {
      state.verbGuidedStatus = "ready";
      state.verbMorphologyFocusNextStep = transferFocus;
      setVerbMorphologyAnnouncement(
        `Not quite. Keep the same English situation and try another ${course.targetLanguage?.label || "target-language"} form.`,
        "wrong"
      );
    }
  } catch (error) {
    state.verbGuidedError = error?.message || String(error);
    if (!(await failVerbMorphologyOnRevisionConflict(error))) {
      state.verbGuidedStatus = state.verbMorphologyProgress?.pendingEvidence
        || state.verbMorphologyProgress?.pendingCompletionKind
        ? "recovery-pending"
        : "ready";
      state.verbMorphologyFocusNextAction = transferFocus
        && state.verbGuidedStatus === "recovery-pending";
      state.verbMorphologyFocusNextStep = transferFocus
        && state.verbGuidedStatus === "ready";
      setVerbMorphologyAnnouncement(
        journalSaved
          ? "Your answer is saved locally. Retry the durable curriculum checkpoint; no second answer will be created."
          : firstResponseWasRecorded
            ? "The earlier first response remains recorded, but this corrective result could not be saved."
            : "Your answer was not recorded because its local recovery journal could not be saved.",
        "wrong"
      );
    }
  } finally {
    state.verbGuidedEvidencePending = false;
    renderVerbNebula();
  }
}

async function showVerbMorphologyHint() {
  const current = state.verbMorphologyRoundState;
  if (!current
      || current.completed
      || verbGuidedInteractionLocked()
      || current.hintState !== verbExerciseFamilyCore.VERB_HINT_STATES.AVAILABLE) return;
  const transferFocus = Boolean(
    document.activeElement && $("#verbMorphologyBoard")?.contains(document.activeElement)
  );
  const firstResponseRecorded = verbMorphologyFirstResponseRecorded();
  state.verbGuidedEvidencePending = true;
  renderVerbNebula();
  try {
    const nextRoundState = serializeVerbMorphologyRoundState({
      hintState: verbExerciseFamilyCore.advanceVerbHintState(current.hintState, "show-hint")
    });
    await saveVerbMorphologyProgress({
      ...state.verbMorphologyProgress,
      round: nextRoundState
    });
    if (!firstResponseRecorded && state.verbGuidedLifecycle && !state.verbMorphologyResume) {
      state.verbGuidedLifecycle.markHint("participant-and-context-cue");
    }
    state.verbMorphologyFocusNextStep = transferFocus;
    setVerbMorphologyAnnouncement(
      firstResponseRecorded
        ? "Context support shown for corrective review; the recorded first response is unchanged."
        : "Context support shown. The next answer will be classified as supported practice.",
      "hint"
    );
  } catch (error) {
    state.verbGuidedError = error?.message || String(error);
    if (!(await failVerbMorphologyOnRevisionConflict(error))) {
      state.verbMorphologyFocusHintAction = transferFocus;
      setVerbMorphologyAnnouncement("The context hint stayed hidden because support could not be recorded.", "wrong");
    }
  } finally {
    state.verbGuidedEvidencePending = false;
    renderVerbNebula();
  }
}

async function revealVerbMorphologySolution() {
  const current = state.verbMorphologyRoundState;
  if (!current || current.completed || verbGuidedInteractionLocked()) return;
  const transferFocus = Boolean(
    document.activeElement && $("#verbMorphologyBoard")?.contains(document.activeElement)
  );
  const correctiveReview = verbMorphologyFirstResponseRecorded();
  let nextRoundState;
  try {
    const nextHintState = verbExerciseFamilyCore.advanceVerbHintState(
      current.hintState,
      "reveal-solution"
    );
    const settlementId = morphologySettlement(
      "solution-reveal",
      state.verbMorphologyRound.targetItemRef,
      false,
      { hintState: nextHintState }
    ).settlementId;
    nextRoundState = serializeVerbMorphologyRoundState({
      hintState: nextHintState,
      settlementId,
      completed: true
    });
  } catch (error) {
    await abortVerbGuidedLifecycle();
    state.verbMorphologyResume = true;
    state.verbGuidedStatus = "failed";
    state.verbGuidedError = error?.message || String(error);
    setVerbMorphologyAnnouncement(
      correctiveReview
        ? "The earlier first response remains recorded, but this corrective review could not be prepared."
        : "The solution was not recorded because the local result could not be prepared.",
      "wrong"
    );
    renderVerbNebula();
    return;
  }
  state.verbGuidedEvidencePending = true;
  renderVerbNebula();
  let journalSaved = false;
  try {
    if (!correctiveReview) {
      const request = morphologyEvidenceRequest({ score: 0, solutionRevealed: true });
      const pendingProgress = {
        ...state.verbMorphologyProgress,
        pendingEvidence: {
          request,
          round: nextRoundState,
          completionKind: "solution-review"
        }
      };
      await saveVerbMorphologyProgress(pendingProgress);
      journalSaved = true;
      await recordVerbMorphologyEvidence(request);
      state.verbGuidedSupportAtFirstResponse = true;
      await saveVerbMorphologyProgress({
        ...pendingProgress,
        round: nextRoundState,
        evidence: {
          recorded: true,
          score: 0,
          solutionRevealed: true,
          hintsUsed: request.hintsUsed,
          occurredAt: request.occurredAt
        },
        pendingEvidence: null,
        terminalCompletionKind: "solution-review",
        pendingCompletionKind: null
      });
    } else {
      await saveVerbMorphologyProgress({
        ...state.verbMorphologyProgress,
        round: nextRoundState,
        terminalCompletionKind: "solution-review",
        pendingCompletionKind: null
      });
    }
    state.verbMorphologyRoundState = nextRoundState;
    state.verbGuidedStatus = "awaiting-next";
    state.verbMorphologyFocusNextAction = transferFocus;
    setVerbMorphologyAnnouncement(
      correctiveReview
        ? "Pilot solution shown. The earlier first response remains recorded; choose Next form when ready."
        : "Pilot solution shown. This is supported comprehension, not independent mastery; choose Next form when ready.",
      "hint"
    );
  } catch (error) {
    state.verbGuidedError = error?.message || String(error);
    if (!(await failVerbMorphologyOnRevisionConflict(error))) {
      state.verbGuidedStatus = state.verbMorphologyProgress?.pendingEvidence
        || state.verbMorphologyProgress?.pendingCompletionKind
        ? "recovery-pending"
        : "ready";
      state.verbMorphologyFocusNextAction = transferFocus
        && state.verbGuidedStatus === "recovery-pending";
      state.verbMorphologyFocusRevealAction = transferFocus
        && state.verbGuidedStatus === "ready";
      setVerbMorphologyAnnouncement(
        journalSaved
          ? "The reveal is saved locally. Retry its durable curriculum checkpoint; the answer remains protected until then."
          : correctiveReview
            ? "The earlier first response remains recorded, but this corrective review could not be saved."
            : "The solution stayed hidden because its local recovery journal could not be saved.",
        "wrong"
      );
    }
  } finally {
    state.verbGuidedEvidencePending = false;
    renderVerbNebula();
  }
}

async function advanceVerbMorphologySequence() {
  if (state.verbProgressResetPending
      || state.verbMorphologyAdvancePending
      || state.verbGuidedEvidencePending) return;
  if (!["recovery-pending", "awaiting-next", "step-complete"].includes(state.verbGuidedStatus)) return;
  const retainActionFocus = Boolean(
    document.activeElement && $("#verbMorphologyBoard")?.contains(document.activeElement)
  );
  state.verbMorphologyAdvancePending = true;
  renderVerbNebula();
  try {
    if (state.verbGuidedStatus === "recovery-pending") {
      await recoverVerbMorphologyProgress();
      if (state.verbGuidedStatus === "recovery-pending") return;
      if (state.verbGuidedStatus === "ready") {
        state.verbMorphologyFocusNextStep = retainActionFocus;
      } else if (state.verbGuidedStatus === "awaiting-next") {
        state.verbMorphologyFocusNextAction = retainActionFocus;
      }
    } else if (state.verbGuidedStatus === "awaiting-next") {
      const completionKind = state.verbMorphologyProgress?.terminalCompletionKind;
      if (!completionKind) throw new Error("The completed form is missing its pinned pilot completion kind.");
      await saveVerbMorphologyProgress({
        ...state.verbMorphologyProgress,
        pendingCompletionKind: completionKind
      });
      await completeVerbMorphologySequenceStep(completionKind);
    }
    if (state.verbMorphologySequenceComplete) {
      showCompletedVerbMorphologySequence({ focus: true });
      return;
    }
    if (state.verbGuidedStatus !== "step-complete") return;
    state.verbMorphologyFocusNextStep = true;
    await prepareVerbMorphologyGuidedStep(
      window.CaatuuCurriculum,
      verbExerciseFamilyConfiguration("morphology")
    );
  } catch (error) {
    state.verbGuidedError = error?.message || String(error);
    if (!(await failVerbMorphologyOnRevisionConflict(error))) {
      state.verbGuidedStatus = state.verbMorphologyProgress?.pendingCompletionKind
        || state.verbMorphologyProgress?.pendingEvidence
        ? "recovery-pending"
        : state.verbMorphologyProgress?.terminalCompletionKind
          ? "awaiting-next"
          : "failed";
      state.verbMorphologyFocusNextAction = retainActionFocus
        && ["recovery-pending", "awaiting-next"].includes(state.verbGuidedStatus);
      setVerbMorphologyAnnouncement(
        state.verbGuidedStatus === "recovery-pending"
          ? "Your completed form is saved. Retry the sequence checkpoint; it will not create another answer."
          : "The next pilot form could not be prepared. The completed step remains recorded.",
        "wrong"
      );
    }
  } finally {
    state.verbMorphologyAdvancePending = false;
    renderVerbNebula();
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
      void transitionToNextVerbRound();
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
    state.verbSelectedCzechId = state.verbSelectedCzechId === id ? "" : id;
  } else {
    state.verbSelectedEnglishId = state.verbSelectedEnglishId === id ? "" : id;
  }

  renderVerbNebula();
  void trackVerbGuidedOperation(settleVerbMatch);
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
    .filter((row) => row.assetPath));
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
      })).filter((row) => row.assetPath))
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
  state.verbMorphologyGeneration += 1;
  renderVerbNebula();

  const lifecycle = state.verbGuidedLifecycle;
  const aborting = lifecycle?.abort?.() || Promise.resolve();
  const pending = [
    state.verbGuidedActivationPromise,
    state.verbMorphologyPreparePromise,
    ...state.verbGuidedOperations
  ].filter(Boolean);
  if (pending.length) await Promise.allSettled(pending);
  await aborting;
  if (state.verbGuidedLifecycle === lifecycle) state.verbGuidedLifecycle = null;
  state.verbGuidedActivationPromise = null;
  state.verbGuidedEvidencePending = false;
  state.verbMorphologyAdvancePending = false;
}

function resetGuidedVerbRuntimeState() {
  state.verbGuidedActivationEpoch += 1;
  state.verbMorphologyGeneration += 1;
  state.verbGuidedActivationPromise = null;
  state.verbGuidedLifecycle = null;
  state.verbGuidedMode = false;
  state.verbGuidedStatus = "loading";
  state.verbGuidedError = "";
  state.verbGuidedPlan = null;
  state.verbGuidedTargetId = "";
  state.verbGuidedResolution = null;
  state.verbGuidedEvidencePending = false;
  state.verbGuidedSupportAtFirstResponse = false;
  state.verbMorphologySequence = null;
  state.verbMorphologySequencePreview = null;
  state.verbMorphologySequenceComplete = false;
  state.verbMorphologyRound = null;
  state.verbMorphologyRoundState = null;
  state.verbMorphologyTask = null;
  state.verbMorphologyProgress = null;
  state.verbMorphologyProgressRevision = 0;
  state.verbMorphologyResume = false;
  state.verbMorphologyAdvancePending = false;
  state.verbMorphologyFocusNextStep = false;
  state.verbMorphologyFocusNextAction = false;
  state.verbMorphologyFocusHintAction = false;
  state.verbMorphologyFocusRevealAction = false;
}

function restartGuidedVerbRuntimeAfterReset({ resetCompleted = true } = {}) {
  state.verbProgressResetPending = false;
  resetGuidedVerbRuntimeState();
  setVerbMorphologyAnnouncement(
    resetCompleted
      ? "Preparing the first pinned pilot form again."
      : "The restart was cancelled. Rechecking the existing Guided task.",
    resetCompleted ? "" : "wrong"
  );
  renderVerbNebula();
  void initializeVerbGuidedMode().then(() => {
    renderVerbNebula();
  }).catch((error) => {
    state.verbGuidedStatus = "failed";
    state.verbGuidedError = error?.message || String(error);
    setVerbMorphologyAnnouncement(
      resetCompleted
        ? "Course progress was cleared, but the first pilot task could not be prepared."
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
    if (event.target.closest("button[data-morphology-item-id]")) {
      void trackVerbGuidedOperation(() => chooseVerbMorphologyForm(event));
    } else if (event.target.closest("button[data-verb-side]")) chooseVerbMatchCard(event);
    else if (event.target.closest("[data-verb-pair-count]")) changeVerbPairCount(event);
  });
  $("#verbHintButton")?.addEventListener("click", toggleVerbHints);
  $("#verbRevealSolution")?.addEventListener("click", () => {
    void trackVerbGuidedOperation(toggleVerbSolution);
  });
  $("#verbMorphologyHintButton")?.addEventListener("click", () => {
    void trackVerbGuidedOperation(showVerbMorphologyHint);
  });
  $("#verbMorphologyRevealButton")?.addEventListener("click", () => {
    void trackVerbGuidedOperation(revealVerbMorphologySolution);
  });
  $("#verbMorphologyNextButton")?.addEventListener("click", () => {
    void trackVerbGuidedOperation(advanceVerbMorphologySequence);
  });
  window.addEventListener("resize", () => {
    if (state.verbSolutionRevealed) renderVerbSolutionArrows();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") deferVerbGuidedActivation();
    else if (state.trainTab === "verb-lab") renderVerbNebula();
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
  const viewTitle = view === "verbs" ? ({
    "verb-lab": "Verb Nebula",
    "word-net": "Word World",
    "memory-moon": "Memory Moon"
  }[state.trainTab] || "") : "";
  window.CaatuuChrome?.setHeaderTitle?.(viewTitle, {
    backLabel: "← Menu",
    backHref: viewTitle ? "index.html" : "",
    trainTab: viewTitle ? "galaxy" : ""
  });
}

const sharedAnimationManifestPath = "/assets/loading_animation/animations_manifest.json";
const worldLandingFrameDelayMs = 600;
const worldLandingFramesPerSelection = 4;
const worldLandingCursorStorageKey = "caatuu.czech.animation.landing.cursor.v1";
let worldLandingFramesPromise = null;
let worldLandingActive = false;
let worldLandingCursorFallback = 0;

function animationFrameNumber(value) {
  const matches = [...String(value || "").matchAll(/(\d+)/g)];
  return matches.length ? Number(matches.at(-1)[1]) : Number.MAX_SAFE_INTEGER;
}

function sharedAnimationFrameUrl(folder, file) {
  if (!folder || !file) return "";
  return `/assets/loading_animation/${[folder, file].map(encodeURIComponent).join("/")}`;
}

function preloadAnimationFrame(src) {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(src);
    image.onerror = () => resolve("");
    image.src = src;
  });
}

async function loadWorldLandingFrames() {
  const response = await fetch(sharedAnimationManifestPath);
  if (!response.ok) throw new Error(`Animation manifest returned ${response.status}`);
  const manifest = await response.json();
  const landing = (Array.isArray(manifest?.animations) ? manifest.animations : [])
    .find((sequence) => sequence?.id === "landing");
  if (!landing) return [];
  const frames = (Array.isArray(landing.sprites) ? landing.sprites : [])
    .map((frame) => sharedAnimationFrameUrl(landing.folder, frame?.file))
    .filter(Boolean)
    .sort((left, right) => animationFrameNumber(left) - animationFrameNumber(right) || left.localeCompare(right));
  return (await Promise.all(frames.map(preloadAnimationFrame))).filter(Boolean);
}

function worldLandingFrames() {
  if (!worldLandingFramesPromise) {
    worldLandingFramesPromise = loadWorldLandingFrames().catch((error) => {
      console.warn("Could not load the landing animation.", error);
      return [];
    });
  }
  return worldLandingFramesPromise;
}

function animationDelay(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function nextWorldLandingFrames(frames) {
  let cursor = worldLandingCursorFallback;
  try {
    const storedCursor = Number(window.sessionStorage.getItem(worldLandingCursorStorageKey));
    if (Number.isInteger(storedCursor) && storedCursor >= 0) cursor = storedCursor;
  } catch (error) {
    // The in-memory cursor still advances when session storage is unavailable.
  }
  cursor %= frames.length;
  const count = Math.min(worldLandingFramesPerSelection, frames.length);
  const selectedFrames = Array.from(
    { length: count },
    (_, offset) => frames[(cursor + offset) % frames.length]
  );
  worldLandingCursorFallback = (cursor + count) % frames.length;
  try {
    window.sessionStorage.setItem(
      worldLandingCursorStorageKey,
      String(worldLandingCursorFallback)
    );
  } catch (error) {
    // The in-memory cursor above remains authoritative for this page.
  }
  return selectedFrames;
}

async function playWorldLandingAnimation() {
  if (worldLandingActive) return false;
  worldLandingActive = true;
  const overlay = $("#worldLandingAnimation");
  const image = $("#worldLandingAnimationFrame");
  try {
    const frames = await worldLandingFrames();
    if (!overlay || !image || !frames.length) return true;
    const selectedFrames = nextWorldLandingFrames(frames);
    document.body.classList.add("world-landing-active");
    overlay.hidden = false;
    overlay.setAttribute("aria-hidden", "false");
    overlay.classList.remove("is-finishing");
    window.requestAnimationFrame(() => overlay.classList.add("is-visible"));

    for (const frame of selectedFrames) {
      image.src = frame;
      await animationDelay(worldLandingFrameDelayMs);
    }

    overlay.classList.add("is-finishing");
    await animationDelay(180);
    overlay.classList.remove("is-visible", "is-finishing");
    overlay.hidden = true;
    overlay.setAttribute("aria-hidden", "true");
    document.body.classList.remove("world-landing-active");
    return true;
  } finally {
    overlay?.classList.remove("is-visible", "is-finishing");
    if (overlay) {
      overlay.hidden = true;
      overlay.setAttribute("aria-hidden", "true");
    }
    document.body.classList.remove("world-landing-active");
    worldLandingActive = false;
  }
}

function ensureMemoryMoonLoaded() {
  const frame = document.getElementById("memoryMoonGame");
  const stage = document.getElementById("memoryMoonStage");
  const status = document.getElementById("memoryMoonStatus");
  if (!frame || frame.dataset.loading === "true" || frame.dataset.ready === "true") return;

  const source = frame.dataset.src;
  if (!source) return;
  frame.dataset.loading = "true";

  const handleMessage = (event) => {
    if (event.origin !== window.location.origin || event.source !== frame.contentWindow) return;
    if (event.data?.source !== "caatuu-memory-moon") return;

    if (event.data.type === "ready") {
      frame.dataset.ready = "true";
      frame.classList.add("is-ready");
      frame.removeAttribute("aria-hidden");
      frame.removeAttribute("tabindex");
      stage?.setAttribute("aria-busy", "false");
      if (status) status.hidden = true;
    }
    if (event.data.type === "complete") {
      frame.dataset.lastCompletion = String(event.data.value || "");
    }
  };
  window.addEventListener("message", handleMessage);
  frame.src = source;

  window.setTimeout(() => {
    if (frame.dataset.ready === "true" || !status) return;
    status.classList.add("is-error");
    const title = status.querySelector("strong");
    const copy = status.querySelector("small");
    if (title) title.textContent = "Memory Moon could not start";
    if (copy) copy.textContent = "Reload the page and try entering the orbit again.";
  }, 20000);
}

function setTrainTab(tab) {
  const trainPanels = {
    galaxy: "trainPanelGalaxy",
    "verb-lab": "trainPanelVerbLab",
    "word-net": "trainPanelWordNet",
    "memory-moon": "trainPanelMemoryMoon"
  };
  const activeTab = Object.prototype.hasOwnProperty.call(trainPanels, tab) ? tab : "galaxy";
  if (activeTab !== "verb-lab") deferVerbGuidedActivation();
  const targetId = trainPanels[activeTab];
  state.trainTab = activeTab;
  document.body.classList.toggle("memory-moon-active", activeTab === "memory-moon");
  const trainTitles = {
    galaxy: "",
    "verb-lab": "Verb Nebula",
    "word-net": "Word World",
    "memory-moon": "Memory Moon"
  };
  const title = trainTitles[activeTab] || "";
  window.CaatuuChrome?.setHeaderTitle?.(title, {
    backLabel: "← Menu",
    backHref: title ? "index.html" : "",
    trainTab: title ? "galaxy" : ""
  });
  document.querySelectorAll(".train-world").forEach((button) => {
    const selected = button.dataset.trainTab === activeTab;
    button.classList.toggle("is-active", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  document.querySelectorAll(".train-tab-panel").forEach((panel) => {
    const selected = panel.id === targetId;
    panel.hidden = !selected;
    panel.classList.toggle("is-active", selected);
  });
  if (activeTab === "verb-lab") renderVerbNebula();
  if (activeTab === "memory-moon") ensureMemoryMoonLoaded();
}

function setInitialViewFromLocation() {
  const url = new URL(window.location.href);
  const legacyView = url.hash.replace("#", "");
  const requestedView = url.searchParams.get("view") || legacyView;
  const openSettings = url.searchParams.get("settings") === "1" || legacyView === "settings";

  if (openSettings) {
    setView(state.activeView);
    window.requestAnimationFrame(openSettingsPanel);
  } else if (requestedView) {
    setView(requestedView);
  }

  const hadTransientRoute = url.hash || url.searchParams.has("view") || url.searchParams.has("settings");
  if (hadTransientRoute) {
    url.hash = "";
    url.searchParams.delete("view");
    url.searchParams.delete("settings");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}`);
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

  document.addEventListener("click", async (event) => {
    const tab = event.target.closest(".nav-tab");
    if (tab) setView(tab.dataset.view);
    const trainTab = event.target.closest("[data-train-tab]");
    if (trainTab) {
      event.preventDefault();
      const selectedTab = trainTab.dataset.trainTab;
      if (trainTab.classList.contains("train-world") && selectedTab !== "galaxy") {
        if (worldLandingActive) return;
        await playWorldLandingAnimation();
      }
      if (selectedTab === "word-net") {
        window.location.href = "word-net.html";
        return;
      }
      setTrainTab(selectedTab);
    }
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
    void worldLandingFrames();
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
