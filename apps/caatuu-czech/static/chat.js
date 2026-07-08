const $ = (selector) => document.querySelector(selector);

let loadedRuntimeKind = "";
let modelLoaded = false;
let modelLoadStarted = false;
let nativeAutoDownloadStarted = false;
let nativeDownloadPollTimer = null;
let generating = false;
let lastSettingsTrigger = null;
let nativeUpdateStatus = null;
let chatDownloadAbortRequested = false;
let modelLoadToken = 0;

const browserFallbackModel = "Qwen3-0.6B-q4f16_1-MLC";
const browserFallbackLabel = "Browser fallback";
const browserFallbackSummary = `Browser: ${browserFallbackModel}. Android: local GGUF models.`;
const themeStorageKey = "caatuu-czech.theme";
const themeOptions = {
  light: { themeColor: "#f5efe5" },
  dark: { themeColor: "#0d171e" }
};
const settingsStorageKey = "caatuu-czech.chat.settings.v1";
const chatStorageKey = "caatuu-czech.chat.history.v1";
const verbStorageKey = "caatuu-czech.verb-memory.v2";
const translationModelKey = "qwen3-1.7b-translation-cs-en-001";
const legacyTranslationModelKey = "cstinyllama-1.2b-translation-cs-en-001";
const legacyWordNetModelKey = "cstinyllama-1.2b-planet-wordnet-002-copy";
const wordNetModelKey = "cstinyllama-1.2b-czech-word-sentence-001";
const defaultModelKey = wordNetModelKey;
const legacyModelNotice = "Legacy/deprecated: kept for compatibility until the curriculum LoRA GGUF replacements are published.";
const defaultLocalModelCatalog = {
  version: 1,
  default_model: defaultModelKey,
  base_url: "https://caatuu.waajacu.com/cz/data/models/phone-bench",
  models: [
    {
      key: "qwen3-lora-003-hard",
      label: "Caatuu CZ LoRA",
      short_label: "Caatuu CZ",
      run_id: "qwen3-1.7b-lora-003-hard",
      repo_id: "Qwen/Qwen3-1.7B",
      license: "Apache-2.0",
      base_model: "Qwen3 1.7B",
      adapter: "qwen3-1.7b-lora-003-hard",
      intended_use: "General Czech assistant and spelling checks.",
      status: "deprecated",
      deprecated: true,
      replacement_status: "Pending curriculum LoRA GGUF publication.",
      supports_thinking: true,
      runtime: "llama.cpp",
      format: "gguf",
      quantization: "Q4_K_M",
      model_file: "caatuu-czech-qwen3-1.7b-003-hard-q4_k_m.gguf",
      manifest_file: "qwen3-lora-003-hard.manifest.json",
      bytes: 1107408608,
      sha256: "09f0055af18dfc7cfa85950699c96c8a40e6c32eb5682afc2bfa6fb8cf7561e7"
    },
    {
      key: "cstinyllama-1.2b-base",
      label: "CSTinyLlama CZ Base",
      short_label: "CSTinyLlama",
      run_id: "cstinyllama-1.2b-base",
      repo_id: "BUT-FIT/CSTinyLlama-1.2B",
      license: "Apache-2.0",
      base_model: "BUT-FIT CSTinyLlama 1.2B",
      adapter: "",
      intended_use: "Czech-native game/example generation experiments.",
      status: "deprecated",
      deprecated: true,
      replacement_status: "Keep only as an unfine-tuned baseline.",
      supports_thinking: false,
      runtime: "llama.cpp",
      format: "gguf",
      quantization: "Q4_K_M",
      model_file: "caatuu-czech-cstinyllama-1.2b-base-q4_k_m.gguf",
      manifest_file: "cstinyllama-1.2b-base.manifest.json",
      bytes: 760306464,
      sha256: "13f87a45d4b788b5d5e81a32c451da19a891d5e3f788d065ac9982751b9c025b"
    },
    {
      key: "cstinyllama-1.2b-planet-wordnet-002-copy",
      label: "Planet Word Net CZ",
      short_label: "Word Net",
      run_id: "cstinyllama-1.2b-planet-wordnet-003-clean-sft",
      repo_id: "BUT-FIT/CSTinyLlama-1.2B",
      license: "Apache-2.0",
      base_model: "BUT-FIT CSTinyLlama 1.2B",
      adapter: "cstinyllama-1.2b-planet-wordnet-003-clean-sft",
      intended_use: "Planet of Word Net: generate one natural Czech sentence using the selected word or a natural Czech inflection of it.",
      status: "deprecated",
      deprecated: true,
      replacement_status: "Pending curriculum word-sentence LoRA GGUF publication.",
      supports_thinking: false,
      runtime: "llama.cpp",
      format: "gguf",
      quantization: "Q4_K_M",
      model_file: "caatuu-czech-cstinyllama-1.2b-planet-wordnet-002-copy-q4_k_m.gguf",
      manifest_file: "cstinyllama-1.2b-planet-wordnet-002-copy.manifest.json",
      bytes: 760305888,
      sha256: "6d4d8345316fe14d27c4baee50edf619f984b6c75d66832ccefe975719569227"
    },
    {
      key: legacyTranslationModelKey,
      label: "Czech to English",
      short_label: "CZ -> EN",
      run_id: "cstinyllama-1.2b-translation-cs-en-001",
      repo_id: "BUT-FIT/CSTinyLlama-1.2B",
      license: "Apache-2.0",
      base_model: "BUT-FIT CSTinyLlama 1.2B",
      adapter: "cstinyllama-1.2b-translation-cs-en-001",
      intended_use: "Translate one simple Czech sentence into simple English for Caatuu learning activities.",
      status: "deprecated",
      deprecated: true,
      replacement_status: "Replaced by qwen3-1.7b-translation-cs-en-001.",
      supports_thinking: false,
      runtime: "llama.cpp",
      format: "gguf",
      quantization: "Q4_K_M",
      model_file: "caatuu-czech-cstinyllama-1.2b-translation-cs-en-001-q4_k_m.gguf",
      manifest_file: "cstinyllama-1.2b-translation-cs-en-001.manifest.json",
      bytes: 760305888,
      sha256: "292536a0b2fc8421638404346a384b42ab2e7b1270a152aa9bfd623899d78d47"
    },
    {
      key: translationModelKey,
      label: "Czech to English Qwen",
      short_label: "CZ -> EN",
      run_id: "qwen3-1.7b-translation-cs-en-001",
      repo_id: "Qwen/Qwen3-1.7B",
      license: "Apache-2.0",
      base_model: "Qwen3 1.7B",
      adapter: "qwen3-1.7b-translation-cs-en-001",
      intended_use: "Translate one simple Czech sentence into simple English for Caatuu learning activities.",
      status: "active",
      deprecated: false,
      replacement_status: "",
      supports_thinking: false,
      runtime: "llama.cpp",
      format: "gguf",
      quantization: "Q4_K_M",
      model_file: "caatuu-czech-qwen3-1.7b-translation-cs-en-001-q4_k_m.gguf",
      manifest_file: "qwen3-1.7b-translation-cs-en-001.manifest.json",
      bytes: 1107408576,
      sha256: "e81c61885e21b8cbc9fc6facfc764014210fe4a0f94d1c9808c74e066fc4cc75"
    },
    {
      key: wordNetModelKey,
      label: "Word Sentence CZ",
      short_label: "Word Sentence",
      run_id: "cstinyllama-1.2b-czech-word-sentence-001",
      repo_id: "BUT-FIT/CSTinyLlama-1.2B",
      license: "Apache-2.0",
      base_model: "BUT-FIT CSTinyLlama 1.2B",
      adapter: "cstinyllama-1.2b-czech-word-sentence-001",
      intended_use: "Given one Czech target word, generate one short ordinary Czech sentence for Planet of Word Net.",
      status: "active",
      deprecated: false,
      replacement_status: "",
      supports_thinking: false,
      runtime: "llama.cpp",
      format: "gguf",
      quantization: "Q4_K_M",
      model_file: "caatuu-czech-cstinyllama-1.2b-word-sentence-001-q4_k_m.gguf",
      manifest_file: "cstinyllama-1.2b-czech-word-sentence-001.manifest.json",
      bytes: 760305888,
      sha256: "28818cb4b7e65a448e2cfac697f2fbd7543a761cbf9644b4374fab3b2376722a"
    }
  ]
};
let localModelCatalog = defaultLocalModelCatalog;
const defaultEmbeddingModelCatalog = {
  version: 1,
  default_model: "caatuu-local-hash-v0.1",
  base_url: "https://caatuu.waajacu.com/cz/data/embeddings",
  models: [
    {
      key: "caatuu-local-hash-v0.1",
      label: "Caatuu Curriculum and Asset Embeddings",
      short_label: "Embeddings",
      status: "active",
      artifact_kind: "embedding-vector-db",
      source_label: "Caatuu curated curriculum corpus and manual image descriptions",
      source_url: "data/embeddings/README.md",
      license: "MIT",
      license_url: "https://opensource.org/licenses/MIT",
      intended_use: "Local curriculum retrieval, duplicate review, game selection, distractor search, and manually described image asset lookup.",
      runtime: "SQLite vector database with local hash embedder",
      format: "sqlite",
      model_file: "caatuu-local-hash-v0.1/caatuu-cz-curriculum.sqlite",
      manifest_file: "caatuu-local-hash-v0.1/manifest.json",
      bytes: 17129472,
      sha256: "d37fe70539b38ca07c69e7c7a8963afaf485905582d1045f701227ce24424f51",
      embedding_text_field: "english_text",
      embedding_input_policy: "english_text_only",
      trainable: false
    }
  ]
};
let embeddingModelCatalog = defaultEmbeddingModelCatalog;
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
let generationSettings = loadStoredSettings();
let chatMessages = loadStoredChat();
const czechLoraModel = {
  name: "Caatuu Czech qwen3-1.7b-lora-003-hard Q4_K_M",
  languageBenchmarkPath: "data/models/benchmarks/czech-language-benchmark-qwen3-1.7b-lora-003-hard.json"
};
const localModelBundle = {
  baseUrl: "https://caatuu.waajacu.com/cz/data/models/phone-bench",
  catalogPath: "data/models/phone-bench/models.json",
  manifestPath: "data/models/phone-bench/manifest.json",
  scriptName: "termux-chat-caatuu.sh"
};
const embeddingModelBundle = {
  catalogPath: "data/embeddings/models.json"
};
const modelLoadHints = [
  { max: 6, text: "Caatuu is waking up a local Czech brain." },
  { max: 20, text: "Tiny circuits are learning where the accents live." },
  { max: 38, text: "The macaw is carrying model pieces across the moon." },
  { max: 58, text: "Czech words are lining up inside the phone." },
  { max: 78, text: "Almost enough local intelligence to answer offline." },
  { max: 93, text: "Caatuu is checking every byte before trusting it." },
  { max: 99.5, text: "Last pieces are landing. The model is nearly ready." },
  { max: Infinity, text: "Download complete. Preparing the local model." }
];
const nativeLoadInactivityTimeoutMs = 8 * 60 * 1000;

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

function catalogModels() {
  return Array.isArray(localModelCatalog.models) && localModelCatalog.models.length
    ? localModelCatalog.models
    : defaultLocalModelCatalog.models;
}

function activeCatalogModels() {
  const active = catalogModels().filter((model) => model.status === "active" && !model.deprecated);
  return active.length ? active : catalogModels();
}

function embeddingCatalogModels() {
  return Array.isArray(embeddingModelCatalog.models) && embeddingModelCatalog.models.length
    ? embeddingModelCatalog.models
    : defaultEmbeddingModelCatalog.models;
}

function activeEmbeddingCatalogModels() {
  const active = embeddingCatalogModels().filter((model) => model.status === "active" && !model.deprecated);
  return active.length ? active : embeddingCatalogModels();
}

function displayModelLabel(model, compact = false) {
  const label = compact ? (model.short_label || model.label || model.key) : (model.label || model.key);
  return model.deprecated ? `${label} (legacy)` : label;
}

function modelSummary(model) {
  return [
    model.intended_use,
    model.deprecated ? legacyModelNotice : "",
    model.replacement_status ? `Replacement: ${model.replacement_status}` : ""
  ].filter(Boolean).join(" ");
}

function normalizeModelKey(modelKey) {
  const key = String(modelKey || localModelCatalog.default_model || defaultModelKey);
  if (key === legacyTranslationModelKey) return translationModelKey;
  if (key === legacyWordNetModelKey) return wordNetModelKey;
  return activeCatalogModels().some((model) => model.key === key) ? key : defaultModelKey;
}

function selectedModelKey() {
  return normalizeModelKey(generationSettings.modelKey);
}

function selectedModel() {
  const key = selectedModelKey();
  return activeCatalogModels().find((model) => model.key === key) || activeCatalogModels()[0] || defaultLocalModelCatalog.models[0];
}

function nativePromptForModel(prompt, modelKey = selectedModelKey()) {
  const value = String(prompt || "").trim();
  if (modelKey === translationModelKey) {
    return `Translate this Czech sentence into simple English.\nReturn only the English sentence.\nCzech: ${value}\nEnglish:`;
  }
  if (modelKey === legacyTranslationModelKey) {
    return `\u00dakol: P\u0159elo\u017e \u010deskou v\u011btu do jednoduch\u00e9 angli\u010dtiny.\n\u010ce\u0161tina: ${value}\nAngli\u010dtina:`;
  }
  if (modelKey === wordNetModelKey) {
    return `C\u00edl: ${value}\nNapi\u0161 jednu kr\u00e1tkou b\u011b\u017enou \u010deskou v\u011btu. Nevysv\u011btluj.\nV\u011bta:`;
  }
  return value;
}

function maxTokensForModel(modelKey = selectedModelKey()) {
  if (modelKey === wordNetModelKey) return Math.min(generationSettings.maxTokens, 64);
  if (modelKey === translationModelKey || modelKey === legacyTranslationModelKey) return Math.min(generationSettings.maxTokens, 96);
  return generationSettings.maxTokens;
}

function setLocalModelCatalog(catalog) {
  if (!catalog || !Array.isArray(catalog.models) || !catalog.models.length) return;
  const validModels = catalog.models.filter((model) => model && model.key && model.model_file);
  if (!validModels.length) return;
  localModelCatalog = {
    ...catalog,
    default_model: catalog.default_model || defaultModelKey,
    base_url: catalog.base_url || localModelBundle.baseUrl,
    models: validModels
  };
  generationSettings = normalizeSettings(generationSettings);
  syncModelSelectOptions();
  renderModelLicenseList();
  syncSettingsUi();
  updateSettingsSupport();
}

function setEmbeddingModelCatalog(catalog) {
  if (!catalog || !Array.isArray(catalog.models) || !catalog.models.length) return;
  const validModels = catalog.models.filter((model) => model && model.key && model.model_file);
  if (!validModels.length) return;
  embeddingModelCatalog = {
    ...catalog,
    default_model: catalog.default_model || defaultEmbeddingModelCatalog.default_model,
    models: validModels
  };
  renderModelLicenseList();
}

function syncModelSelectOptions() {
  const nativeRuntime = hasNativeRuntime();
  ["composerModel", "settingsModel"].forEach((id) => {
    const select = $(`#${id}`);
    if (!select) return;

    if (!nativeRuntime) {
      const option = document.createElement("option");
      option.value = browserFallbackModel;
      option.textContent = id === "composerModel" ? browserFallbackLabel : `${browserFallbackLabel} (${browserFallbackModel})`;
      select.replaceChildren(option);
      select.value = browserFallbackModel;
      select.disabled = true;
      select.title = "Browser WebGPU mode cannot load the Android GGUF models.";
      return;
    }

    select.disabled = false;
    select.title = "";
    select.replaceChildren(
      ...activeCatalogModels().map((model) => {
        const option = document.createElement("option");
        option.value = model.key;
        option.textContent = displayModelLabel(model, id === "composerModel");
        if (model.deprecated) {
          option.dataset.status = "deprecated";
          option.title = legacyModelNotice;
        }
        return option;
      })
    );
    select.value = selectedModelKey();
  });
}

function buildTermuxFallbackCommand() {
  const model = selectedModel();
  const modelPrefix = model?.model_file ? `MODEL_FILE=${model.model_file} ` : "";
  return [
    "pkg update",
    "pkg install -y curl",
    `curl -L ${localModelBundle.baseUrl}/${localModelBundle.scriptName} -o ${localModelBundle.scriptName}`,
    `${modelPrefix}bash ${localModelBundle.scriptName}`
  ].join("\n");
}

function renderModelLicenseList() {
  const list = $("#modelLicenseList");
  if (!list) return;
  const models = [...activeCatalogModels(), ...activeEmbeddingCatalogModels()];
  list.replaceChildren(...models.map((model) => {
    const row = document.createElement("div");
    const term = document.createElement("dt");
    const detail = document.createElement("dd");
    const licenseLink = document.createElement("a");

    term.textContent = displayModelLabel(model);
    const sourceText = model.repo_id || model.source_label || model.key;
    const source = document.createElement("span");
    source.className = "license-source";
    if (model.repo_id) {
      const repoLink = document.createElement("a");
      repoLink.href = `https://huggingface.co/${model.repo_id}`;
      repoLink.rel = "noopener";
      repoLink.textContent = model.repo_id;
      source.append(repoLink);
    } else if (model.source_url) {
      const sourceLink = document.createElement("a");
      sourceLink.href = model.source_url;
      sourceLink.rel = "noopener";
      sourceLink.textContent = sourceText;
      source.append(sourceLink);
    } else {
      source.textContent = sourceText;
    }
    licenseLink.href = model.license_url || "https://www.apache.org/licenses/LICENSE-2.0";
    licenseLink.rel = "noopener";
    licenseLink.textContent = model.license || "Apache-2.0";

    detail.append(source, " · ", licenseLink);
    if (model.status) detail.append(" · ", model.status);
    if (model.embedding_text_field) detail.append(" · ", `embeds ${model.embedding_text_field}`);
    row.append(term, detail);
    return row;
  }));
  setText("#licenseMetaSummary", `MIT app, ${models.length} local artifacts`);
}

function setText(selector, value) {
  const node = $(selector);
  if (node) node.textContent = value;
}

function confirmDestructiveAction(button, options = {}) {
  if (window.CaatuuChrome?.confirmButtonPress) {
    return window.CaatuuChrome.confirmButtonPress(button, options);
  }
  return window.confirm(options.message || "Continue?");
}

function setChatEvent(message, { progress = null, tone = "muted", abortable = false } = {}) {
  const events = $("#chatEvents");
  const line = $("#chatEventLine");
  const abortButton = $("#chatAbortDownload");
  const progressTrack = $("#chatProgress");
  const progressBar = $("#chatProgressBar");
  if (!events || !line) return;

  events.dataset.tone = tone;
  line.textContent = message || "";

  const hasProgressValue = progress !== null && progress !== undefined;
  const numericProgress = Number(progress);
  const hasProgress = hasProgressValue && Number.isFinite(numericProgress);
  if (abortButton) {
    abortButton.hidden = !(abortable && hasProgress && tone === "active");
    abortButton.disabled = false;
    abortButton.textContent = "Abort";
  }
  if (!progressTrack || !progressBar) return;

  if (!hasProgress) {
    progressTrack.hidden = true;
    progressTrack.setAttribute("aria-valuenow", "0");
    progressBar.style.width = "0%";
    return;
  }

  const clamped = Math.min(100, Math.max(0, numericProgress));
  progressTrack.hidden = false;
  progressTrack.setAttribute("aria-valuenow", String(Math.round(clamped)));
  progressBar.style.width = `${clamped}%`;
}

function progressPercent(bytes, totalBytes) {
  const total = Number(totalBytes || 0);
  const value = Number(bytes || 0);
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(value) || value < 0) return null;
  return Math.min(100, Math.max(0, (value / total) * 100));
}

function modelLoadHint(progress) {
  const value = Number(progress);
  const percent = Number.isFinite(value) ? value : 0;
  return modelLoadHints.find((hint) => percent <= hint.max)?.text || modelLoadHints[0].text;
}

function modelDownloadMessage(progress, { verb = "downloading" } = {}) {
  const value = Number(progress);
  const progressLabel = Number.isFinite(value) ? `(${verb} ${value.toFixed(1)}%)` : `(${verb})`;
  return `${progressLabel} ${modelLoadHint(value)}`;
}

function renderDownloadProgress(bytes, totalBytes, { label = "Downloading model" } = {}) {
  const percent = progressPercent(bytes, totalBytes);
  const formattedTotal = Number(totalBytes || 0) > 0 ? ` / ${formatBytes(totalBytes)}` : "";
  const formattedPercent = percent === null ? "" : ` (${percent.toFixed(1)}%)`;
  const progressText = `${label}: ${formatBytes(bytes)}${formattedTotal}${formattedPercent}`;
  setText("#progressBox", progressText);
  setChatEvent(`${modelDownloadMessage(percent)} ${progressText}.`, { progress: percent ?? 0, tone: "active", abortable: true });
}

async function abortChatDownload() {
  chatDownloadAbortRequested = true;
  modelLoadToken += 1;
  nativeAutoDownloadStarted = false;
  scheduleNativeDownloadPoll(false);

  const abortButton = $("#chatAbortDownload");
  if (abortButton) {
    abortButton.disabled = true;
    abortButton.textContent = "Stopping";
  }

  try {
    if (hasNativeRuntime()) {
      await runtimeAdapter().models.abortDownload(selectedModelKey());
      setText("#progressBox", "Download aborted. Tap Load model when you want to resume.");
      setChatEvent("Download aborted. Caatuu kept any reusable partial file.", { tone: "muted" });
    } else {
      await runtimeAdapter().models.unload?.();
      setText("#progressBox", "Browser loading stopped in the UI.");
      setChatEvent("Loading stopped. Tap Load model to try again.", { tone: "muted" });
    }
  } catch (error) {
    const message = error?.message || String(error);
    setText("#progressBox", message);
    setChatEvent(message, { tone: "error" });
  } finally {
    modelLoadStarted = false;
    setBusy(false);
    updateLoadButton(hasNativeRuntime() ? "Load model" : "Start");
    updateSendButton();
  }
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

function setBusy(isBusy) {
  generating = isBusy;
  const promptInput = $("#promptInput");
  const runPrompt = $("#runPrompt");
  const loadButton = $("#loadModel");
  const contextStatus = $("#contextStatus");
  if (promptInput) {
    promptInput.disabled = isBusy;
    promptInput.placeholder = isBusy ? "Loading..." : "Ask";
  }
  if (runPrompt) {
    const runPromptLabel = runPrompt.querySelector(".send-label");
    const runPromptSymbol = runPrompt.querySelector(".send-symbol");
    if (runPromptLabel) {
      runPromptLabel.textContent = isBusy ? "Loading" : "Send";
      if (runPromptSymbol) runPromptSymbol.textContent = isBusy ? "\u2026" : "\u27a4";
      runPrompt.setAttribute("aria-label", isBusy ? "Sending message" : "Send message");
    } else {
      runPrompt.textContent = isBusy ? "Loading" : "Send";
    }
  }
  contextStatus?.classList.toggle("is-generating", isBusy);
  updateSendButton();
  if (loadButton) loadButton.disabled = isBusy;
}

function updateSendButton() {
  const runPrompt = $("#runPrompt");
  const promptInput = $("#promptInput");
  if (!runPrompt) return;
  const hasPrompt = Boolean(promptInput?.value.trim());
  const canLoadThenSend = hasNativeRuntime() && hasPrompt;
  runPrompt.disabled = generating || !hasPrompt || (!modelLoaded && !canLoadThenSend);
}

function updateLoadButton(label) {
  const loadButton = $("#loadModel");
  if (loadButton) loadButton.textContent = label;
}

function openSettingsPanel() {
  const panel = $("#settingsPanel");
  if (!panel) return;
  lastSettingsTrigger = document.activeElement;
  panel.hidden = false;
  document.body.classList.add("settings-open");
  syncThemeControls();
  syncSettingsUi();
  updateSettingsSupport();
  $("#closeSettings")?.focus();
}

function closeSettingsPanel({ restoreFocus = true } = {}) {
  const panel = $("#settingsPanel");
  if (!panel) return;
  panel.hidden = true;
  document.body.classList.remove("settings-open");
  if (restoreFocus && lastSettingsTrigger && typeof lastSettingsTrigger.focus === "function") {
    lastSettingsTrigger.focus();
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

function loadStoredSettings() {
  try {
    const raw = localStorage.getItem(settingsStorageKey);
    if (!raw) return { ...defaultGenerationSettings };
    return normalizeSettings(JSON.parse(raw));
  } catch (error) {
    return { ...defaultGenerationSettings };
  }
}

function loadStoredChat() {
  try {
    const raw = localStorage.getItem(chatStorageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => {
        return item
          && ["user", "assistant"].includes(item.role)
          && typeof item.content === "string"
          && item.content.trim();
      })
      .slice(-60);
  } catch (error) {
    return [];
  }
}

function saveStoredChat() {
  try {
    localStorage.setItem(chatStorageKey, JSON.stringify(chatMessages.slice(-60)));
  } catch (error) {
  }
}

function rememberChatMessage(role, content) {
  if (!["user", "assistant"].includes(role) || !content || !String(content).trim()) return;
  chatMessages = [...chatMessages, { role, content: String(content) }].slice(-60);
  saveStoredChat();
}

function renderStoredChat() {
  $("#chatLog").replaceChildren();
  chatMessages.forEach((message) => {
    addMessage(message.role, message.content, { persist: false });
  });
}

function startNewChat() {
  chatMessages = [];
  saveStoredChat();
  resetChat();
  $("#promptInput").value = "";
  $("#promptInput").focus();
}

function normalizeSettings(input = {}) {
  const modelKey = normalizeModelKey(input.modelKey);
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

function clampNumber(value, min, max, fallback) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function saveSettings() {
  localStorage.setItem(settingsStorageKey, JSON.stringify({
    modelKey: generationSettings.modelKey,
    preset: generationSettings.preset,
    thinking: generationSettings.thinking,
    maxTokens: generationSettings.maxTokens,
    temperature: generationSettings.temperature,
    contextSize: generationSettings.contextSize,
    reasoningDisplay: generationSettings.reasoningDisplay
  }));
}

function setGenerationSettings(next, { persist = true } = {}) {
  const previousReasoningDisplay = generationSettings.reasoningDisplay;
  generationSettings = normalizeSettings({ ...generationSettings, ...next });
  syncSettingsUi();
  updateSettingsSupport();
  if (persist) saveSettings();
  if (!generating && previousReasoningDisplay !== generationSettings.reasoningDisplay) renderStoredChat();
}

function applyPreset(preset) {
  const settings = generationPresets[preset];
  if (!settings) return;
  setGenerationSettings({ preset, ...settings });
}

async function chooseModel(modelKey) {
  if (!hasNativeRuntime()) {
    syncSettingsUi();
    setText("#progressBox", browserFallbackSummary);
    return;
  }

  const previous = selectedModelKey();
  const next = normalizeModelKey(modelKey);
  if (previous === next) {
    syncSettingsUi();
    return;
  }

  setGenerationSettings({ modelKey: next });
  modelLoaded = false;
  modelLoadStarted = false;
  nativeAutoDownloadStarted = false;
  updateSendButton();
  const hasWebGpu = "gpu" in navigator;
  updateLoadButton(hasNativeRuntime() ? "Load model" : hasWebGpu ? "Start" : "Install app");
  setText("#runtimeBadge", hasNativeRuntime() ? "Android native" : hasWebGpu ? "Browser WebGPU" : "No local runtime");
  setText("#progressBox", "Model changed. Load the selected model before generating.");
  setChatEvent("Model changed. Load the selected model before sending a message.", { tone: "muted" });
  if (chatMessages.length) {
    resetChat("Model changed. Start a new generation after loading.", { clearStored: true });
  }
  await loadLocalModelManifest();
  await refreshNativeStatus();
  await startNativeDownloadIfNeeded({ silent: false });
}

function readSettingsControls() {
  setGenerationSettings({
    modelKey: hasNativeRuntime() ? ($("#settingsModel")?.value || selectedModelKey()) : selectedModelKey(),
    thinking: $("#thinkingEnabled").checked,
    maxTokens: Number($("#maxTokens").value),
    temperature: Number($("#temperature").value),
    contextSize: Number($("#contextSize").value),
    reasoningDisplay: $("#reasoningDisplay").value
  });
}

function syncSettingsUi() {
  syncModelSelectOptions();
  $("#thinkingEnabled").checked = generationSettings.thinking;
  $("#maxTokens").value = String(generationSettings.maxTokens);
  $("#maxTokensValue").textContent = String(generationSettings.maxTokens);
  $("#temperature").value = String(generationSettings.temperature);
  $("#temperatureValue").textContent = generationSettings.temperature.toFixed(1);
  $("#contextSize").value = String(generationSettings.contextSize);
  $("#reasoningDisplay").value = generationSettings.reasoningDisplay;
  $("#composerEffort").value = generationSettings.preset;
  if (hasNativeRuntime()) {
    $("#composerModel").value = selectedModelKey();
    $("#settingsModel").value = selectedModelKey();
    const model = selectedModel();
    setText("#modelChoiceSummary", modelSummary(model) || model.label);
    renderSelectedModelMeta();
  } else {
    $("#composerModel").value = browserFallbackModel;
    $("#settingsModel").value = browserFallbackModel;
    renderBrowserFallbackMeta();
  }
  setText("#contextIndicator", formatContextShort(generationSettings.contextSize));
  setText("#contextSizeLabel", formatContextWindow(generationSettings.contextSize));
  setText("#settingsSummary", generationSettings.summary);

  document.querySelectorAll("[data-preset]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.preset === generationSettings.preset);
  });
}

function renderSelectedModelMeta(status = {}) {
  const model = selectedModel();
  setText("#baseModelMeta", status.baseModel || model.base_model || "Local GGUF");
  setText("#adapterMeta", status.adapter || model.adapter || "None");
  setText("#modelFileMeta", status.modelName || status.modelFile || model.model_file || "Caatuu Czech GGUF");
}

function renderBrowserFallbackMeta() {
  setText("#modelStatus", browserFallbackModel);
  setText("#baseModelMeta", "Qwen3 0.6B WebLLM");
  setText("#adapterMeta", "None");
  setText("#modelFileMeta", browserFallbackModel);
  setText("#modelMetaSummary", modelLoaded ? "Browser fallback loaded" : "Browser fallback only");
  setText("#modelChoiceSummary", browserFallbackSummary);
}

function formatContextWindow(tokens) {
  const value = Number(tokens || 0);
  if (!Number.isFinite(value) || value <= 0) return "ctx";
  if (value >= 1024) return `${Math.round(value / 1024)}k context`;
  return `${value} context`;
}

function formatContextShort(tokens) {
  const value = Number(tokens || 0);
  if (!Number.isFinite(value) || value <= 0) return "ctx";
  if (value >= 1024) return `${Math.round(value / 1024)}k`;
  return String(value);
}

function updateSettingsSupport() {
  const model = selectedModel();
  const hasBrowserWebGpu = Boolean(runtimeAdapter().capabilities.webGpu);
  if (!hasNativeRuntime() && (loadedRuntimeKind === "browser-webgpu" || hasBrowserWebGpu)) {
    setText("#thinkingSupport", "Active in browser request");
    setText("#temperatureSupport", "Active in browser request");
    setText("#contextSupport", "Managed by WebLLM");
    setText("#capabilityNote", `${browserFallbackSummary} Max tokens, temperature, and thinking apply to the browser fallback only.`);
    setText("#controlMeta", `Browser fallback: ${browserFallbackModel}. GGUF model selection is Android-only here.`);
    setText("#frontierModelStatus", modelLoaded ? "Browser fallback ready" : "Browser fallback");
    return;
  }

  if (loadedRuntimeKind === "android-native" || hasNativeRuntime()) {
    setText("#thinkingSupport", model.supports_thinking ? "Active in APK request" : "Off for selected base model");
    setText("#temperatureSupport", "APK native bridge pending");
    setText("#contextSupport", "APK native bridge pending");
    setText(
      "#capabilityNote",
      model.supports_thinking
        ? "APK applies max tokens and Qwen chat-template thinking now. Temperature and context are saved for the next native bridge patch."
        : "APK applies max tokens for this base model. Thinking is disabled; temperature and context are saved for the next native bridge patch."
    );
    setText("#controlMeta", model.supports_thinking ? "APK active: max tokens, thinking. Pending: temperature, context size." : "APK active: max tokens. Thinking unavailable for this model; temperature and context pending.");
    setText("#frontierModelStatus", modelLoaded ? `${model.short_label || model.label} ready` : model.short_label || "Local");
    return;
  }

  setText("#thinkingSupport", "Browser fallback only");
  setText("#temperatureSupport", "Browser fallback only");
  setText("#contextSupport", "Android native only for GGUF");
  setText("#capabilityNote", browserFallbackSummary);
  setText("#controlMeta", `Browser fallback: ${browserFallbackModel}.`);
  setText("#frontierModelStatus", "Browser fallback");
}

function requestOptions() {
  return {
    preset: generationSettings.preset,
    thinking: generationSettings.thinking,
    max_tokens: generationSettings.maxTokens,
    temperature: generationSettings.temperature,
    context_size: generationSettings.contextSize,
    reasoning_display: generationSettings.reasoningDisplay
  };
}

function addMessage(role, text, { persist = false } = {}) {
  const article = document.createElement("article");
  article.className = `message ${role}`;

  const label = document.createElement("b");
  label.textContent = role === "user" ? "You" : role === "system" ? "App" : "Model";

  const body = document.createElement("div");
  body.className = "message-body";
  renderMessageContent(body, text);

  article.append(label, body);
  $("#chatLog").append(article);
  $("#chatLog").scrollTop = $("#chatLog").scrollHeight;
  if (persist) rememberChatMessage(role, text);
  return body;
}

function updateMessage(node, text) {
  renderMessageContent(node, text || "...");
  $("#chatLog").scrollTop = $("#chatLog").scrollHeight;
}

function renderMessageContent(node, content) {
  node.replaceChildren();
  const parts = parseThinkBlocks(String(content || ""));
  if (!parts.length) {
    appendTextPart(node, "...");
    return;
  }

  for (const part of parts) {
    if (part.type === "think") {
      if (generationSettings.reasoningDisplay === "hidden") continue;

      const details = document.createElement("details");
      details.className = "think-block";
      if (part.open || generationSettings.reasoningDisplay === "expanded") details.open = true;

      const summary = document.createElement("summary");
      summary.textContent = part.open ? "Reasoning in progress" : "Reasoning";

      const pre = document.createElement("pre");
      pre.textContent = part.text.trim() || "...";

      details.append(summary, pre);
      node.append(details);
    } else {
      appendTextPart(node, part.text);
    }
  }

  if (!node.childNodes.length) appendTextPart(node, "(reasoning hidden)");
}

function appendTextPart(node, text) {
  const normalizedText = String(text || "").trim();
  if (!normalizedText) return;
  const span = document.createElement("span");
  span.className = "message-text";
  span.textContent = normalizedText;
  node.append(span);
}

function parseThinkBlocks(content) {
  const parts = [];
  const lower = content.toLowerCase();
  let cursor = 0;

  while (cursor < content.length) {
    const start = lower.indexOf("<think>", cursor);
    if (start < 0) {
      parts.push({ type: "text", text: content.slice(cursor) });
      break;
    }

    if (start > cursor) {
      parts.push({ type: "text", text: content.slice(cursor, start) });
    }

    const bodyStart = start + "<think>".length;
    const end = lower.indexOf("</think>", bodyStart);
    if (end < 0) {
      parts.push({ type: "think", text: content.slice(bodyStart), open: true });
      break;
    }

    parts.push({ type: "think", text: content.slice(bodyStart, end), open: false });
    cursor = end + "</think>".length;
  }

  return parts.filter((part) => part.text && part.text.trim());
}

function resetChat(message = "", { clearStored = false } = {}) {
  if (clearStored) {
    chatMessages = [];
    saveStoredChat();
  }
  $("#chatLog").replaceChildren();
  if (message) addMessage("system", message);
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

function renderInitialRuntime() {
  const hasWebGpu = runtimeAdapter().capabilities.webGpu;
  setText("#gpuStatus", hasWebGpu ? "Available" : "Missing");
  setText("#cacheStatus", runtimeAdapter().capabilities.serviceWorker ? "Checking" : "Unavailable");

  if (hasNativeRuntime()) {
    loadedRuntimeKind = "android-native";
    setText("#runtimeBadge", "Android native");
    setText("#runtimeStatus", "Native llama.cpp");
    setText("#runtimeSummary", "Local Czech GGUF runtime is ready.");
    setText("#storageStatus", "Checking");
    setText("#maintenanceStatus", "Checking app version.");
    refreshNativeUpdateStatus();
    updateLoadButton("Load model");
    setText("#progressBox", "Checking app-private model storage.");
    setChatEvent("Checking local model storage.", { tone: "muted" });
    updateSettingsSupport();
    return;
  }

  loadedRuntimeKind = hasWebGpu ? "browser-webgpu" : "";
  setText("#runtimeBadge", hasWebGpu ? "Browser WebGPU" : "No local runtime");
  setText("#runtimeStatus", hasWebGpu ? "Browser fallback" : "Unavailable here");
  setText("#storageStatus", "Browser cache only");
  setText("#storageMeta", hasWebGpu ? "Browser WebGPU cache" : "No local model storage");
  setText("#maintenanceStatus", "");
  setUpdateAppControl({ updateAvailable: false });
  runtimeAdapter().maintenance.updateStatus().then(syncAboutVersion).catch(() => {});
  updateLoadButton(hasWebGpu ? "Start" : "Install app");
  renderBrowserFallbackMeta();
  setText(
    "#runtimeSummary",
    hasWebGpu
      ? "Ready in this browser."
      : "Install the Android app to use the local GGUF runtime on this device."
  );
  setText(
    "#progressBox",
    hasWebGpu
      ? "Browser model will start automatically."
      : "No WebGPU or native Android bridge is available on this page."
  );
  setChatEvent(
    hasWebGpu
      ? "Caatuu has built-in intelligence. The browser model will start loading."
      : "No local model runtime is available in this browser.",
    { progress: hasWebGpu ? 0 : null, tone: hasWebGpu ? "active" : "error" }
  );
  updateSettingsSupport();
}

function nativeManagedStatusName(status) {
  const managedDownload = status?.downloadManager || null;
  return typeof managedDownload?.status === "string" ? managedDownload.status : "";
}

function isNativeDownloadActive(status) {
  return Boolean(status?.downloadActive) || ["pending", "running", "paused"].includes(nativeManagedStatusName(status));
}

function isNativeModelReady(status) {
  return Boolean(status?.loaded || status?.verified || status?.downloaded);
}

async function refreshNativeStatus() {
  if (!hasNativeRuntime()) return;

  try {
    const status = await runtimeAdapter().models.status(selectedModelKey());
    renderNativeStatus(status);
    if (typeof status.loaded === "boolean") {
      modelLoaded = status.loaded;
      loadedRuntimeKind = "android-native";
      updateLoadButton(
        status.loaded
          ? "Reload"
          : status.verified || status.downloaded
            ? "Load downloaded model"
            : status.resumable
              ? "Resume download"
              : "Load model"
      );
      updateSendButton();
      updateSettingsSupport();
    }
    const managedDownload = status.downloadManager || null;
    const managedBytes = status.managedDownloadBytes || managedDownload?.bytes || 0;
    const systemDownloadActive = isNativeDownloadActive(status);
    if (status.downloadFailed) nativeAutoDownloadStarted = false;
    const downloadProgress = progressPercent(managedBytes || status.downloadBytes || status.bytes, status.expectedBytes) ?? 0;
    const statusMessage = status.loaded
      ? "Model ready. Write a message and press Send."
      : status.verified || status.downloaded
        ? "Model is downloaded locally. Load it to enable Send."
        : systemDownloadActive
          ? modelDownloadMessage(downloadProgress)
        : status.downloadFailed
          ? "The Android system download stopped. Caatuu will try again."
        : status.resumable
          ? `${modelDownloadMessage(downloadProgress, { verb: "saved" })} Caatuu will continue from local progress.`
          : "Caatuu needs one model download before local chat can start.";
    setText(
      "#progressBox",
      status.loaded
        ? "Ready. Write a message and press Send."
        : status.verified || status.downloaded
          ? "Model file is already downloaded."
        : systemDownloadActive
            ? `${modelDownloadMessage(downloadProgress)} ${formatBytes(managedBytes || status.downloadBytes || status.bytes)} / ${formatBytes(status.expectedBytes)}.`
          : status.downloadFailed
            ? "Download stopped. Restarting the Android system download."
          : status.resumable
            ? `${modelDownloadMessage(downloadProgress, { verb: "saved" })} Restarting from saved local progress.`
            : "Model download needed."
    );
    setChatEvent(statusMessage, {
      progress: status.verified || status.downloaded ? null : status.resumable || systemDownloadActive ? downloadProgress : 0,
      tone: systemDownloadActive || status.downloadFailed ? "active" : status.loaded || status.verified || status.downloaded || status.resumable ? "muted" : "active",
      abortable: systemDownloadActive
    });
    scheduleNativeDownloadPoll(systemDownloadActive);
    return status;
  } catch (error) {
    setText("#runtimeStatus", "Native bridge error");
    setText("#progressBox", error?.message || String(error));
    setChatEvent(error?.message || String(error), { tone: "error" });
    scheduleNativeDownloadPoll(false);
    return null;
  }
}

let nativeStatusRefreshPending = false;

function scheduleNativeDownloadPoll(active) {
  if (nativeDownloadPollTimer !== null) {
    window.clearTimeout(nativeDownloadPollTimer);
    nativeDownloadPollTimer = null;
  }
  if (!active || document.hidden) return;
  nativeDownloadPollTimer = window.setTimeout(() => {
    nativeDownloadPollTimer = null;
    refreshNativeStatusAfterResume();
  }, 2500);
}

async function refreshNativeStatusAfterResume() {
  if (!hasNativeRuntime() || nativeStatusRefreshPending) return;
  nativeStatusRefreshPending = true;
  try {
    const status = await refreshNativeStatus();
    if (!status || isNativeModelReady(status) || isNativeDownloadActive(status)) return;
    await startNativeDownloadIfNeeded({ silent: true, knownStatus: status });
  } finally {
    nativeStatusRefreshPending = false;
  }
}

async function startNativeDownloadIfNeeded({ silent = true, knownStatus = null } = {}) {
  if (!hasNativeRuntime() || modelLoaded || nativeAutoDownloadStarted) return;

  const status = knownStatus || await refreshNativeStatus();
  if (!status || isNativeModelReady(status) || isNativeDownloadActive(status)) {
    nativeAutoDownloadStarted = Boolean(status && (isNativeModelReady(status) || isNativeDownloadActive(status)));
    return;
  }

  nativeAutoDownloadStarted = true;
  if (!silent) {
    addMessage("system", "Starting model download.");
  }
  updateLoadButton("Downloading");
  setText("#progressBox", "Starting Android system download.");
  setChatEvent(modelDownloadMessage(0), { progress: 0, tone: "active", abortable: true });

  try {
    await runtimeAdapter().models.startDownload(selectedModelKey(), {
      timeoutMs: 30000,
      onEvent(message) {
        if (message.kind === "status") {
          const statusMessage = message.message || modelDownloadMessage(0);
          setText("#progressBox", statusMessage);
          setChatEvent(statusMessage, { progress: 0, tone: "active", abortable: true });
        }
      }
    });
    await refreshNativeStatus();
  } catch (error) {
    nativeAutoDownloadStarted = false;
    setText("#progressBox", error?.message || String(error));
    setChatEvent(error?.message || String(error), { tone: "error" });
  }
}

function renderNativeStatus(status) {
  if (status.models && Array.isArray(status.models)) {
    setLocalModelCatalog({
      version: 1,
      default_model: status.defaultModelKey || defaultModelKey,
      base_url: localModelBundle.baseUrl,
      models: status.models
    });
  }
  const model = selectedModel();
  setText("#modelStatus", status.label || status.modelName || model.label || czechLoraModel.name);
  setText(
    "#storageStatus",
    status.verified
      ? `Verified (${formatBytes(status.expectedBytes || status.bytes)})`
      : status.downloaded
        ? `Downloaded (${formatBytes(status.bytes || status.expectedBytes)})`
        : status.partial
          ? `Partial (${formatBytes(status.bytes || 0)} / ${formatBytes(status.expectedBytes || 0)})`
          : "Download needed"
  );
  setText("#runtimeStatus", status.runtime || "Native llama.cpp");
  renderSelectedModelMeta(status);
  setText("#storageMeta", status.deletedOnUninstall ? "App-private filesDir, removed on uninstall" : "Runtime storage checking");
  setText(
    "#modelMetaSummary",
    status.verified
      ? "Local GGUF verified"
      : status.downloaded
        ? "Local GGUF downloaded"
        : "Download needed"
  );
  const selectedSummary = status.intendedUse || model.intended_use || model.label;
  setText("#modelChoiceSummary", model.deprecated ? `${selectedSummary} ${legacyModelNotice}` : selectedSummary);
  if (status.generationControls) {
    const controls = status.generationControls;
    const active = Object.entries(controls)
      .filter(([, value]) => value && value.active)
      .map(([key]) => key)
      .join(", ");
    setText("#controlMeta", active ? `Active now: ${active}. Other controls are pending native bridge support.` : "Controls pending native bridge support.");
  }
  setText("#diagnosticOutput", JSON.stringify(status, null, 2));
  updateSettingsSupport();
}

async function loadModel({ silent = false } = {}) {
  if (hasNativeRuntime()) {
    await loadNativeModel({ silent });
    return;
  }

  if ("gpu" in navigator) {
    await loadBrowserFallback({ silent });
    return;
  }

  if (!silent) addMessage("system", "Model unavailable.");
  setText("#progressBox", "No compatible local runtime is available in this browser.");
  setChatEvent("No compatible local runtime is available in this browser.", { tone: "error" });
}

async function loadNativeModel({ silent = false } = {}) {
  const wasLoaded = modelLoaded;
  setBusy(true);
  modelLoaded = false;
  if (wasLoaded && !silent) {
    resetChat("Chat cleared. Reloading the local model.", { clearStored: true });
    $("#promptInput").value = "";
  }
  setText("#runtimeBadge", "Loading");
  setText("#runtimeStatus", "Loading model");
  setText("#progressBox", "Checking the model file.");
  setChatEvent("(loading) Caatuu is opening the local model.", { progress: 0, tone: "active", abortable: true });

  try {
    const result = await runtimeAdapter().models.load(selectedModelKey(), {
      onEvent: renderNativeEvent,
      timeoutMs: nativeLoadInactivityTimeoutMs,
      timeoutMessage: "Model loading is taking too long. The downloaded file is kept in app storage; close and reopen Caatuu, then tap Load downloaded model again."
    });
    modelLoaded = Boolean(result.loaded);
    loadedRuntimeKind = "android-native";
    renderNativeStatus(result);
    if (!modelLoaded) throw new Error("Native runtime did not report the selected model as loaded.");
    setText("#runtimeBadge", "Ready");
    setText("#runtimeStatus", "Native loaded");
    setText("#progressBox", "Ready. Write a message and press Send.");
    setChatEvent("Model ready. Write a message and press Send.", { tone: "muted" });
    updateLoadButton("Reload");
    if (!silent) addMessage("assistant", "Ready.");
  } catch (error) {
    modelLoaded = false;
    setText("#runtimeBadge", "Load failed");
    setText("#runtimeStatus", "Native failed");
    setText("#progressBox", error?.message || String(error));
    setChatEvent(error?.message || String(error), { tone: "error" });
    if (!silent) addMessage("system", "Model load failed.");
  } finally {
    setBusy(false);
    updateSendButton();
  }
}

function renderNativeEvent(message) {
  if (message.kind === "progress" && message.phase === "download") {
    const total = Number(message.totalBytes || 0);
    const bytes = Number(message.bytes || 0);
    renderDownloadProgress(bytes, total);
    return;
  }

  if (message.kind === "status") {
    const statusMessage = message.message || "Working.";
    setText("#progressBox", statusMessage);
    setChatEvent(statusMessage, { tone: "active" });
    if (message.settings) {
      setText("#diagnosticOutput", JSON.stringify(message.settings, null, 2));
    }
  }
}

async function loadBrowserFallback({ silent = false } = {}) {
  const loadToken = ++modelLoadToken;
  chatDownloadAbortRequested = false;
  setBusy(true);
  modelLoaded = false;
  setText("#runtimeBadge", "Browser loading");
  setText("#runtimeStatus", "Loading WebGPU");
  setText("#progressBox", `Loading ${browserFallbackModel}.`);
  setChatEvent("(loading) Caatuu is warming up the browser model.", { progress: 0, tone: "active", abortable: true });

  try {
    const result = await runtimeAdapter().models.load(browserFallbackModel, {
      onEvent(message) {
        if (loadToken !== modelLoadToken || chatDownloadAbortRequested) return;
        if (message.kind !== "progress") return;
        const percent = Number.isFinite(message.progress) ? message.progress : null;
        const pct = percent === null ? "" : ` ${percent.toFixed(1)}%`;
        const progressText = `${message.text || message.message || "Loading"}${pct}`;
        setText("#progressBox", progressText);
        setChatEvent(`${modelDownloadMessage(percent)} ${progressText}.`, { progress: percent ?? 0, tone: "active", abortable: true });
      }
    });
    if (loadToken !== modelLoadToken || chatDownloadAbortRequested) return;
    modelLoaded = Boolean(result.loaded);
    loadedRuntimeKind = result.runtime || "browser-webgpu";
    if (!modelLoaded) throw new Error("Browser WebGPU runtime did not report the fallback model as loaded.");
    setText("#runtimeBadge", "Browser ready");
    setText("#runtimeStatus", "WebGPU loaded");
    setText("#storageMeta", "Browser WebGPU cache");
    renderBrowserFallbackMeta();
    setText("#progressBox", "Browser model ready.");
    setChatEvent("Browser model ready. Write a message and press Send.", { tone: "muted" });
    updateSettingsSupport();
    if (!silent) addMessage("assistant", "Ready.");
  } catch (error) {
    if (loadToken !== modelLoadToken || chatDownloadAbortRequested) return;
    modelLoaded = false;
    setText("#runtimeBadge", "Load failed");
    setText("#runtimeStatus", "WebGPU failed");
    setText("#progressBox", browserGpuErrorMessage(error));
    setChatEvent(browserGpuErrorMessage(error), { tone: "error" });
    if (!silent) addMessage("system", "Model unavailable.");
  } finally {
    if (loadToken === modelLoadToken) {
      setBusy(false);
      updateSendButton();
    }
  }
}

async function autoLoadModel() {
  if (modelLoadStarted || modelLoaded) return;
  if (hasNativeRuntime()) {
    await startNativeDownloadIfNeeded({ silent: true });
    return;
  }
  if (!("gpu" in navigator)) return;
  modelLoadStarted = true;
  await loadModel({ silent: true });
}

async function submitPrompt(event) {
  event.preventDefault();
  if (generating) return;

  const prompt = $("#promptInput").value.trim();
  if (!prompt) return;

  if (!modelLoaded) {
    if (!hasNativeRuntime()) {
      addMessage("system", "Load the model first.");
      setChatEvent("The model must finish loading before Send is available.", { tone: "error" });
      return;
    }
    setChatEvent("Loading the selected model before sending.", { progress: 0, tone: "active", abortable: true });
    await loadModel({ silent: true });
    if (!modelLoaded) return;
  }

  addMessage("user", prompt, { persist: true });
  $("#promptInput").value = "";
  updateSendButton();

  if (loadedRuntimeKind === "android-native") {
    await runNativePrompt(prompt);
  } else if (loadedRuntimeKind === "browser-webgpu") {
    await runBrowserPrompt(prompt);
  }
}

async function runNativePrompt(prompt) {
  setBusy(true);
  const assistantNode = addMessage("assistant", "...");
  let output = "";
  const modelKey = selectedModelKey();
  const model = selectedModel();
  const nativePrompt = nativePromptForModel(prompt, modelKey);
  const maxTokens = maxTokensForModel(modelKey);
  const options = requestOptions();
  const request = {
    runtime: "android-native-llama.cpp",
    model: {
      key: modelKey,
      label: model.label
    },
    messages: [{ role: "user", content: prompt }],
    prompt_sent_to_model: nativePrompt,
    options,
    max_tokens_sent_to_model: maxTokens,
    prompt_transformed_by_ui: nativePrompt !== prompt,
    active_controls: {
      max_tokens: true,
      thinking: Boolean(model.supports_thinking),
      temperature: false,
      context_size: false
    },
    system_prompt_added_by_bridge: false
  };
  setText("#requestPreview", JSON.stringify(request, null, 2));
  setText("#progressBox", "Generating with native llama.cpp.");
  setChatEvent("Thinking locally.", { tone: "active" });

  try {
    const result = await runtimeAdapter().models.generate(
      { prompt: nativePrompt, maxTokens, options, modelKey },
      {
        onEvent(message) {
          if (message.kind === "token") {
            output += message.token || "";
            updateMessage(assistantNode, output);
          } else if (message.kind === "status") {
            const statusMessage = message.message || "Generating.";
            setText("#progressBox", statusMessage);
            setChatEvent(statusMessage, { tone: "active" });
          }
        }
      }
    );
    const finalOutput = output || result.output || "(empty output)";
    updateMessage(assistantNode, finalOutput);
    rememberChatMessage("assistant", finalOutput);
    if (result.settings) setText("#diagnosticOutput", JSON.stringify(result.settings, null, 2));
    setText("#progressBox", "Done.");
    setChatEvent("Done.", { tone: "muted" });
  } catch (error) {
    updateMessage(assistantNode, error?.message || String(error));
    setText("#progressBox", "Generation failed.");
    setChatEvent(error?.message || "Generation failed.", { tone: "error" });
  } finally {
    setBusy(false);
  }
}

async function runBrowserPrompt(prompt) {
  setBusy(true);
  const assistantNode = addMessage("assistant", "...");
  let output = "";
  const options = requestOptions();
  const request = {
    runtime: "browser-webgpu",
    model: browserFallbackModel,
    gguf_selector_available: false,
    note: "Desktop browser mode uses WebLLM fallback. Android native mode is required for Caatuu CZ, Qwen translation, and CSTinyLlama GGUF.",
    messages: [{ role: "user", content: prompt }],
    temperature: generationSettings.temperature,
    max_tokens: generationSettings.maxTokens,
    extra_body: { enable_thinking: generationSettings.thinking }
  };
  setText("#requestPreview", JSON.stringify({ ...request, stream: true, options }, null, 2));
  setText("#progressBox", `Generating with ${browserFallbackModel}.`);
  setChatEvent("Thinking in the browser.", { tone: "active" });

  try {
    const result = await runtimeAdapter().models.generate(
      request,
      {
        onEvent(message) {
          if (message.kind === "token") {
            output += message.token || "";
            updateMessage(assistantNode, output);
            return;
          }
          if (message.kind === "status") {
            const statusMessage = message.message || "Generating.";
            setText("#progressBox", statusMessage);
            setChatEvent(statusMessage, { tone: "active" });
          }
        }
      }
    );
    const finalOutput = result.output || output || "(empty output)";
    updateMessage(assistantNode, finalOutput);
    rememberChatMessage("assistant", finalOutput);
    setText("#progressBox", "Done.");
    setChatEvent("Done.", { tone: "muted" });
  } catch (error) {
    updateMessage(assistantNode, error?.message || String(error));
    setText("#progressBox", "Generation failed.");
    setChatEvent(error?.message || "Generation failed.", { tone: "error" });
  } finally {
    setBusy(false);
  }
}

async function registerServiceWorker() {
  try {
    const registered = await runtimeAdapter().registerServiceWorker();
    if (registered) setText("#cacheStatus", "Registered");
  } catch (error) {
    setText("#cacheStatus", "Registration failed");
  }
}

async function cacheProbe() {
  const status = await runtimeAdapter().maintenance.cacheStatus();
  if (!status.available) {
    setText("#diagnosticOutput", "Cache API missing.");
    return;
  }
  const names = status.cacheNames || [];
  setText("#diagnosticOutput", names.length ? `Caches: ${names.join(", ")}` : "No cache entries yet.");
}

async function clearBrowserCache() {
  return runtimeAdapter().maintenance.clearCache();
}

async function loadBenchmarks() {
  try {
    const result = await fetchJson(czechLoraModel.languageBenchmarkPath);
    renderBenchmarks(result.models.base, result.models.tuned);
    setText("#diagnosticOutput", "Loaded saved base vs LoRA benchmark contrast.");
  } catch (error) {
    setText("#diagnosticOutput", error?.message || String(error));
  }
}

async function loadLocalModelManifest() {
  try {
    const catalog = await runtimeAdapter().models.catalog();
    setLocalModelCatalog(catalog);
  } catch (error) {
    // The bundled fallback catalog still gives the app a usable model selector.
  }

  try {
    const embeddingCatalog = await runtimeAdapter().models.embeddingCatalog();
    setEmbeddingModelCatalog(embeddingCatalog);
  } catch (error) {
    // The bundled fallback catalog still exposes the current local embedding artifact.
  }

  setText("#termuxCommand", buildTermuxFallbackCommand());

  if (hasNativeRuntime()) {
    const copyTermux = $("#copyTermuxCommand");
    if (copyTermux) copyTermux.disabled = true;
    return;
  }

  renderBrowserFallbackMeta();
  setText(
    "#diagnosticOutput",
    `${browserFallbackSummary} Android and Termux GGUF files remain available from the model catalog.`
  );
}

async function copyTermuxFallbackCommand() {
  try {
    await navigator.clipboard.writeText(buildTermuxFallbackCommand());
    setText("#diagnosticOutput", "Copied the Termux fallback command.");
  } catch (error) {
    setText("#diagnosticOutput", "Copy failed. Select the command text manually.");
  }
}

async function updateApp() {
  if (!hasNativeRuntime()) {
    setText("#maintenanceStatus", "App updates are available inside the Android APK.");
    return;
  }

  try {
    nativeUpdateStatus = await runtimeAdapter().maintenance.updateStatus();
    syncAboutVersion(nativeUpdateStatus);
    if (!hasNativeAppUpdate(nativeUpdateStatus)) {
      setUpdateAppControl(nativeUpdateStatus);
      setText("#maintenanceStatus", updateStatusLine(nativeUpdateStatus));
      return;
    }

    setUpdateAppControl(nativeUpdateStatus, { busy: true });
    setText("#maintenanceStatus", "Checking the latest debug APK.");

    const result = await runtimeAdapter().maintenance.updateApp({
      onEvent(message) {
        const progressText = maintenanceUi().updateProgressMessage(message, formatBytes);
        if (progressText) setText("#maintenanceStatus", progressText);
      }
    });

    setText("#maintenanceStatus", maintenanceUi().updateResultMessage(result));
    setText("#diagnosticOutput", JSON.stringify(result, null, 2));
  } catch (error) {
    setText("#maintenanceStatus", error?.message || String(error));
  } finally {
    setUpdateAppControl(nativeUpdateStatus);
  }
}

async function clearCache() {
  const clearButton = $("#clearCache");
  if (!confirmDestructiveAction(clearButton, {
    confirmLabel: "Confirm cache clear",
    message: "Clear temporary cache? Course progress stays saved."
  })) {
    setText("#maintenanceStatus", "Press Clear cache again to remove temporary cache. Course progress stays saved.");
    return;
  }

  clearButton.disabled = true;
  setText("#maintenanceStatus", "Clearing app cache.");
  setChatEvent("Clearing temporary cache and downloaded update APK.", { tone: "active" });

  try {
    if (!hasNativeRuntime()) await unloadBrowserEngine();
    const result = await runtimeAdapter().maintenance.clearCache({
      onEvent(message) {
        if (message.kind === "status") {
          const statusMessage = message.message || "Clearing cache.";
          setText("#maintenanceStatus", statusMessage);
          setChatEvent(statusMessage, { tone: "active" });
        }
      }
    });
    modelLoaded = false;
    modelLoadStarted = false;
    updateSendButton();
    setText("#runtimeBadge", hasNativeRuntime() ? "Android native" : "Browser WebGPU");
    setText("#progressBox", "Cache cleared. Downloaded models and setup files stay installed.");
    setChatEvent("Cache cleared. Downloaded models and setup files stay installed.", { tone: "muted" });
    setText("#maintenanceStatus", maintenanceUi().cacheResultMessage(result, formatBytes, {
      includeStorageScope: false
    }));
    setText("#diagnosticOutput", JSON.stringify(result, null, 2));
    if (hasNativeRuntime()) {
      await refreshNativeStatus();
    } else {
      await registerServiceWorker();
      setText("#storageStatus", "Browser cache cleared");
    }
  } catch (error) {
    setText("#maintenanceStatus", error?.message || String(error));
    setChatEvent(error?.message || String(error), { tone: "error" });
  } finally {
    clearButton.disabled = false;
  }
}

function clearStoredVerbMemory() {
  const resetButton = $("#settingsResetVerbMemory");
  if (!confirmDestructiveAction(resetButton, {
    confirmLabel: "Confirm restart",
    message: "Start the course again? This clears saved mastery but keeps downloads and cache."
  })) {
    setText("#maintenanceStatus", "Press Start course again once more to clear saved mastery.");
    return;
  }

  try {
    localStorage.removeItem(verbStorageKey);
    setText("#maintenanceStatus", "Course mastery cleared. Downloads and cache were preserved.");
  } catch (error) {
    setText("#maintenanceStatus", "Could not clear saved verb mastery in this browser.");
  }
}

function renderBenchmarks(base, tuned) {
  const benchmarkList = $("#benchmarkList");
  if (!benchmarkList) return;
  const tunedById = Object.fromEntries(tuned.prompts.map((item) => [item.id, item]));
  benchmarkList.replaceChildren(
    ...base.prompts.map((item) => {
      const tunedItem = tunedById[item.id];
      const article = document.createElement("article");
      article.className = "benchmark-item";
      article.innerHTML = `
        <h3>${escapeHtml(item.id)}</h3>
        <div class="benchmark-columns">
          <div>
            <b>Base</b>
            <p>${escapeHtml(item.output)}</p>
          </div>
          <div>
            <b>LoRA</b>
            <p>${escapeHtml(tunedItem?.output || "")}</p>
          </div>
        </div>
      `;
      return article;
    })
  );
}

async function fetchJson(path) {
  return runtimeAdapter().fetchJson(path);
}

function browserGpuErrorMessage(error) {
  const message = error?.message || String(error);
  if (/compatible gpu|webgpu|gpu/i.test(message)) {
    return window.isSecureContext
      ? "This browser or device does not expose a compatible WebGPU runtime."
      : "WebGPU needs a secure browser context. Use HTTPS, localhost, or the Android APK.";
  }
  return message;
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (!Number.isFinite(value) || value <= 0) return "unknown size";
  const gib = value / 1024 / 1024 / 1024;
  if (gib >= 1) return `${gib.toFixed(2)} GiB`;
  const mib = value / 1024 / 1024;
  return `${mib.toFixed(1)} MiB`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function bindUi() {
  $("#openSettings")?.addEventListener("click", openSettingsPanel);
  $("#closeSettings")?.addEventListener("click", closeSettingsPanel);
  $("#settingsPanel")?.addEventListener("click", (event) => {
    if (event.target === $("#settingsPanel")) closeSettingsPanel();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && $("#settingsPanel") && !$("#settingsPanel").hidden) closeSettingsPanel();
  });

  $("#loadModel")?.addEventListener("click", () => loadModel());
  $("#chatAbortDownload")?.addEventListener("click", abortChatDownload);
  $("#newChat").addEventListener("click", startNewChat);
  $("#promptForm").addEventListener("submit", submitPrompt);
  $("#cacheProbe")?.addEventListener("click", cacheProbe);
  $("#loadBenchmarks")?.addEventListener("click", loadBenchmarks);
  $("#copyTermuxCommand")?.addEventListener("click", copyTermuxFallbackCommand);
  $("#updateApp").addEventListener("click", updateApp);
  $("#clearCache").addEventListener("click", clearCache);
  $("#settingsResetVerbMemory")?.addEventListener("click", clearStoredVerbMemory);

  document.querySelectorAll("[data-preset]").forEach((button) => {
    button.addEventListener("click", () => applyPreset(button.dataset.preset));
  });
  $("#composerEffort")?.addEventListener("change", (event) => applyPreset(event.target.value));
  $("#composerModel")?.addEventListener("change", (event) => chooseModel(event.target.value));
  $("#settingsModel")?.addEventListener("change", (event) => chooseModel(event.target.value));

  bindThemeControls();

  ["thinkingEnabled", "maxTokens", "temperature", "contextSize", "reasoningDisplay"].forEach((id) => {
    $(`#${id}`).addEventListener("input", readSettingsControls);
    $(`#${id}`).addEventListener("change", readSettingsControls);
  });

  $("#promptInput").addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      $("#promptForm").requestSubmit();
    }
  });
  $("#promptInput").addEventListener("input", updateSendButton);

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refreshNativeStatusAfterResume();
  });
  window.addEventListener("focus", refreshNativeStatusAfterResume);

  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-prompt]");
    if (!button) return;
    $("#promptInput").value = button.dataset.prompt || "";
    updateSendButton();
    $("#promptInput").focus();
  });
}

async function init() {
  applyTheme(readStoredTheme(), { persist: false });
  syncModelSelectOptions();
  renderModelLicenseList();
  bindUi();
  syncSettingsUi();
  renderStoredChat();
  renderInitialRuntime();
  await registerServiceWorker();
  await loadLocalModelManifest();
  await refreshNativeStatus();
  await autoLoadModel();
}

init();
