const $ = (selector) => document.querySelector(selector);

let browserEngine = null;
let loadedRuntimeKind = "";
let modelLoaded = false;
let modelLoadStarted = false;
let generating = false;
let lastSettingsTrigger = null;
const nativePending = new Map();

const webllmCdn = "https://esm.run/@mlc-ai/web-llm";
const browserFallbackModel = "Qwen3-0.6B-q4f16_1-MLC";
const themeStorageKey = "caatuu-czech.theme";
const settingsStorageKey = "caatuu-czech.device-ai.settings.v1";
const chatStorageKey = "caatuu-czech.device-ai.chat.v1";
const verbStorageKey = "caatuu-czech.verb-memory.v2";
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
  manifestPath: "data/models/phone-bench/manifest.json",
  scriptName: "termux-chat-caatuu.sh"
};
const termuxFallbackCommand = [
  "pkg update",
  "pkg install -y curl",
  `curl -L ${localModelBundle.baseUrl}/${localModelBundle.scriptName} -o ${localModelBundle.scriptName}`,
  `bash ${localModelBundle.scriptName}`
].join("\n");

window.CaatuuNative = {
  receive(rawMessage) {
    const message = typeof rawMessage === "string" ? JSON.parse(rawMessage) : rawMessage;
    const pending = nativePending.get(message.id);
    if (!pending) return;

    if (message.kind === "done") {
      nativePending.delete(message.id);
      pending.resolve(message.result || {});
      return;
    }

    if (message.kind === "error") {
      nativePending.delete(message.id);
      pending.reject(new Error(message.message || "Native Android runtime failed."));
      return;
    }

    if (pending.onEvent) pending.onEvent(message);
  }
};

function hasNativeRuntime() {
  return Boolean(window.CaatuuAndroid && typeof window.CaatuuAndroid.postMessage === "function");
}

function nativeCall(type, payload = {}, handlers = {}) {
  if (!hasNativeRuntime()) {
    return Promise.reject(new Error("Native Android runtime is not available."));
  }

  const id = `native-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const request = { id, type, ...payload };

  return new Promise((resolve, reject) => {
    nativePending.set(id, { resolve, reject, onEvent: handlers.onEvent });
    try {
      window.CaatuuAndroid.postMessage(JSON.stringify(request));
    } catch (error) {
      nativePending.delete(id);
      reject(error);
    }
  });
}

function setText(selector, value) {
  const node = $(selector);
  if (node) node.textContent = value;
}

function readStoredTheme() {
  try {
    return localStorage.getItem(themeStorageKey) === "light" ? "light" : "dark";
  } catch (error) {
    return "dark";
  }
}

function syncThemeControls() {
  const activeTheme = document.documentElement.dataset.theme || readStoredTheme();
  document.querySelectorAll("[data-theme-option]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.themeOption === activeTheme);
  });
}

function applyTheme(theme, { persist = true } = {}) {
  const normalizedTheme = theme === "light" ? "light" : "dark";
  document.documentElement.dataset.theme = normalizedTheme;
  document.documentElement.style.colorScheme = normalizedTheme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute(
    "content",
    normalizedTheme === "dark" ? "#071013" : "#22594d"
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
  if (promptInput) promptInput.disabled = isBusy;
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
  runPrompt.disabled = generating || !modelLoaded || !hasPrompt;
}

function updateLoadButton(label) {
  const loadButton = $("#loadModel");
  if (loadButton) loadButton.textContent = label;
}

function openSettingsPanel() {
  const panel = $("#settingsPanel");
  lastSettingsTrigger = document.activeElement;
  panel.hidden = false;
  document.body.classList.add("settings-open");
  syncThemeControls();
  $("#closeSettings").focus();
}

function closeSettingsPanel() {
  const panel = $("#settingsPanel");
  panel.hidden = true;
  document.body.classList.remove("settings-open");
  if (lastSettingsTrigger && typeof lastSettingsTrigger.focus === "function") {
    lastSettingsTrigger.focus();
  }
}

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
  const preset = Object.prototype.hasOwnProperty.call(generationPresets, input.preset) ? input.preset : "chat";
  const base = generationPresets[preset];
  const maxTokens = Number(input.maxTokens ?? base.maxTokens);
  const temperature = Number(input.temperature ?? base.temperature);
  const contextSize = Number(input.contextSize ?? base.contextSize);
  const reasoningDisplay = ["collapsed", "expanded", "hidden"].includes(input.reasoningDisplay)
    ? input.reasoningDisplay
    : base.reasoningDisplay;

  return {
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

function readSettingsControls() {
  setGenerationSettings({
    thinking: $("#thinkingEnabled").checked,
    maxTokens: Number($("#maxTokens").value),
    temperature: Number($("#temperature").value),
    contextSize: Number($("#contextSize").value),
    reasoningDisplay: $("#reasoningDisplay").value
  });
}

function syncSettingsUi() {
  $("#thinkingEnabled").checked = generationSettings.thinking;
  $("#maxTokens").value = String(generationSettings.maxTokens);
  $("#maxTokensValue").textContent = String(generationSettings.maxTokens);
  $("#temperature").value = String(generationSettings.temperature);
  $("#temperatureValue").textContent = generationSettings.temperature.toFixed(1);
  $("#contextSize").value = String(generationSettings.contextSize);
  $("#reasoningDisplay").value = generationSettings.reasoningDisplay;
  $("#composerEffort").value = generationSettings.preset;
  setText("#contextIndicator", formatContextShort(generationSettings.contextSize));
  setText("#contextSizeLabel", formatContextWindow(generationSettings.contextSize));
  setText("#settingsSummary", generationSettings.summary);

  document.querySelectorAll("[data-preset]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.preset === generationSettings.preset);
  });
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
  if (loadedRuntimeKind === "browser-webgpu") {
    setText("#thinkingSupport", "Active in browser request");
    setText("#temperatureSupport", "Active in browser request");
    setText("#contextSupport", "Managed by WebLLM");
    setText("#capabilityNote", "Browser mode applies max tokens, temperature, and thinking. Context is managed by WebLLM.");
    setText("#controlMeta", "Browser: max tokens, temperature, thinking. Context managed by WebLLM.");
    setText("#frontierModelStatus", "Browser ready");
    return;
  }

  if (loadedRuntimeKind === "android-native" || hasNativeRuntime()) {
    setText("#thinkingSupport", "Active in APK request");
    setText("#temperatureSupport", "APK native bridge pending");
    setText("#contextSupport", "APK native bridge pending");
    setText("#capabilityNote", "APK applies max tokens and Qwen chat-template thinking now. Temperature and context are saved for the next native bridge patch.");
    setText("#controlMeta", "APK active: max tokens, thinking. Pending: temperature, context size.");
    setText("#frontierModelStatus", modelLoaded ? "Local ready" : "Local");
    return;
  }

  setText("#thinkingSupport", "Active in browser fallback");
  setText("#temperatureSupport", "Active in browser fallback");
  setText("#contextSupport", "Prepared for APK runtime");
  setText("#capabilityNote", "Settings are saved now and become active according to the runtime you load.");
  setText("#controlMeta", "Load a runtime to see active controls.");
  setText("#frontierModelStatus", "Warming");
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
  if (!text) return;
  const span = document.createElement("span");
  span.className = "message-text";
  span.textContent = text;
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

function renderInitialRuntime() {
  const hasWebGpu = "gpu" in navigator;
  setText("#gpuStatus", hasWebGpu ? "Available" : "Missing");
  setText("#cacheStatus", "serviceWorker" in navigator ? "Checking" : "Unavailable");

  if (hasNativeRuntime()) {
    loadedRuntimeKind = "android-native";
    setText("#runtimeBadge", "Android native");
    setText("#runtimeStatus", "Native llama.cpp");
    setText("#runtimeSummary", "Local Czech GGUF runtime is ready.");
    setText("#storageStatus", "Checking");
    setText("#maintenanceStatus", "Use Update app for the latest debug APK, or Delete model to free local storage.");
    updateLoadButton("Load model");
    setText("#progressBox", "Checking app-private model storage.");
    updateSettingsSupport();
    return;
  }

  loadedRuntimeKind = hasWebGpu ? "browser-webgpu" : "";
  setText("#runtimeBadge", hasWebGpu ? "Browser WebGPU" : "No local runtime");
  setText("#runtimeStatus", hasWebGpu ? "Browser fallback" : "Unavailable here");
  setText("#storageStatus", "Browser cache only");
  setText("#maintenanceStatus", "Install the Android APK to use app update and model cleanup tools.");
  updateLoadButton(hasWebGpu ? "Start" : "Install app");
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
  updateSettingsSupport();
}

async function refreshNativeStatus() {
  if (!hasNativeRuntime()) return;

  try {
    const status = await nativeCall("status");
    renderNativeStatus(status);
    setText(
      "#progressBox",
      status.verified
        ? "Model file is already downloaded."
        : "Model is not downloaded yet."
    );
  } catch (error) {
    setText("#runtimeStatus", "Native bridge error");
    setText("#progressBox", error?.message || String(error));
  }
}

function renderNativeStatus(status) {
  setText("#modelStatus", status.modelName || czechLoraModel.name);
  setText("#storageStatus", status.verified ? `Verified (${formatBytes(status.expectedBytes || status.bytes)})` : "Download needed");
  setText("#runtimeStatus", status.runtime || "Native llama.cpp");
  setText("#modelFileMeta", status.modelName || status.modelFile || "Caatuu Czech GGUF");
  setText("#storageMeta", status.deletedOnUninstall ? "App-private filesDir, removed on uninstall" : "Runtime storage checking");
  setText("#modelMetaSummary", status.verified ? "Local GGUF verified" : "Download needed");
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

  try {
    const result = await nativeCall("load", {}, { onEvent: renderNativeEvent });
    modelLoaded = true;
    loadedRuntimeKind = "android-native";
    renderNativeStatus(result);
    setText("#runtimeBadge", "Ready");
    setText("#runtimeStatus", "Native loaded");
    setText("#progressBox", "Ready. Write a message and press Send.");
    updateLoadButton("Reload");
    if (!silent) addMessage("assistant", "Ready.");
  } catch (error) {
    modelLoaded = false;
    setText("#runtimeBadge", "Load failed");
    setText("#runtimeStatus", "Native failed");
    setText("#progressBox", error?.message || String(error));
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
    const pct = total > 0 ? ` ${(bytes / total * 100).toFixed(1)}%` : "";
    setText("#progressBox", `Downloading ${formatBytes(bytes)} / ${formatBytes(total)}${pct}`);
    return;
  }

  if (message.kind === "status") {
    setText("#progressBox", message.message || "Working.");
    if (message.settings) {
      setText("#diagnosticOutput", JSON.stringify(message.settings, null, 2));
    }
  }
}

async function loadBrowserFallback({ silent = false } = {}) {
  setBusy(true);
  modelLoaded = false;
  setText("#runtimeBadge", "Browser loading");
  setText("#runtimeStatus", "Loading WebGPU");
  setText("#progressBox", `Loading ${browserFallbackModel}.`);

  try {
    const webllm = await import(webllmCdn);
    browserEngine = await webllm.CreateMLCEngine(browserFallbackModel, {
      initProgressCallback: (progress) => {
        const pct = Number.isFinite(progress.progress) ? ` ${(progress.progress * 100).toFixed(1)}%` : "";
        setText("#progressBox", `${progress.text || "Loading"}${pct}`);
      }
    });
    modelLoaded = true;
    loadedRuntimeKind = "browser-webgpu";
    setText("#runtimeBadge", "Browser ready");
    setText("#runtimeStatus", "WebGPU loaded");
    setText("#modelStatus", browserFallbackModel);
    setText("#modelFileMeta", browserFallbackModel);
    setText("#storageMeta", "Browser WebGPU cache");
    setText("#modelMetaSummary", "Browser fallback loaded");
    setText("#progressBox", "Browser model ready.");
    updateSettingsSupport();
    if (!silent) addMessage("assistant", "Ready.");
  } catch (error) {
    browserEngine = null;
    modelLoaded = false;
    setText("#runtimeBadge", "Load failed");
    setText("#runtimeStatus", "WebGPU failed");
    setText("#progressBox", browserGpuErrorMessage(error));
    if (!silent) addMessage("system", "Model unavailable.");
  } finally {
    setBusy(false);
    updateSendButton();
  }
}

async function autoLoadModel() {
  if (modelLoadStarted || modelLoaded) return;
  if (!hasNativeRuntime() && !("gpu" in navigator)) return;
  modelLoadStarted = true;
  await loadModel({ silent: true });
}

async function submitPrompt(event) {
  event.preventDefault();
  if (generating) return;

  const prompt = $("#promptInput").value.trim();
  if (!prompt) return;

  if (!modelLoaded) {
    addMessage("system", "Load the model first.");
    return;
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
  const options = requestOptions();
  const request = {
    runtime: "android-native-llama.cpp",
    messages: [{ role: "user", content: prompt }],
    options,
    active_controls: {
      max_tokens: true,
      thinking: true,
      temperature: false,
      context_size: false
    },
    system_prompt_added_by_bridge: false
  };
  setText("#requestPreview", JSON.stringify(request, null, 2));
  setText("#progressBox", "Generating with native llama.cpp.");

  try {
    const result = await nativeCall(
      "prompt",
      { prompt, maxTokens: generationSettings.maxTokens, options },
      {
        onEvent(message) {
          if (message.kind === "token") {
            output += message.token || "";
            updateMessage(assistantNode, output);
          } else if (message.kind === "status") {
            setText("#progressBox", message.message || "Generating.");
          }
        }
      }
    );
    const finalOutput = output || result.output || "(empty output)";
    updateMessage(assistantNode, finalOutput);
    rememberChatMessage("assistant", finalOutput);
    if (result.settings) setText("#diagnosticOutput", JSON.stringify(result.settings, null, 2));
    setText("#progressBox", "Done.");
  } catch (error) {
    updateMessage(assistantNode, error?.message || String(error));
    setText("#progressBox", "Generation failed.");
  } finally {
    setBusy(false);
  }
}

async function runBrowserPrompt(prompt) {
  if (!browserEngine) return;

  setBusy(true);
  const assistantNode = addMessage("assistant", "...");
  const options = requestOptions();
  const request = {
    messages: [{ role: "user", content: prompt }],
    temperature: generationSettings.temperature,
    max_tokens: generationSettings.maxTokens,
    extra_body: { enable_thinking: generationSettings.thinking }
  };
  setText("#requestPreview", JSON.stringify({ ...request, options }, null, 2));
  setText("#progressBox", `Generating with ${browserFallbackModel}.`);

  try {
    const response = await browserEngine.chat.completions.create(request);
    const finalOutput = response.choices?.[0]?.message?.content || "(empty output)";
    updateMessage(assistantNode, finalOutput);
    rememberChatMessage("assistant", finalOutput);
    setText("#progressBox", "Done.");
  } catch (error) {
    updateMessage(assistantNode, error?.message || String(error));
    setText("#progressBox", "Generation failed.");
  } finally {
    setBusy(false);
  }
}

async function registerServiceWorker() {
  if (hasNativeRuntime() || !("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register("sw.js");
    setText("#cacheStatus", "Registered");
  } catch (error) {
    setText("#cacheStatus", "Registration failed");
  }
}

async function cacheProbe() {
  if (!("caches" in window)) {
    setText("#diagnosticOutput", "Cache API missing.");
    return;
  }
  const names = await caches.keys();
  setText("#diagnosticOutput", names.length ? `Caches: ${names.join(", ")}` : "No cache entries yet.");
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
  setText("#termuxCommand", termuxFallbackCommand);

  if (hasNativeRuntime()) {
    $("#copyTermuxCommand").disabled = true;
    return;
  }

  try {
    const manifest = await fetchJson(localModelBundle.manifestPath);
    setText("#modelFileMeta", manifest.model_file || "Caatuu Czech GGUF");
    setText("#modelMetaSummary", `${formatBytes(manifest.bytes)} published`);
    setText(
      "#diagnosticOutput",
      `Published local model: ${manifest.model_file || "GGUF"} (${formatBytes(manifest.bytes)}).`
    );
  } catch (error) {
    setText("#diagnosticOutput", "Local model manifest will be checked when diagnostics are opened.");
  }
}

async function copyTermuxFallbackCommand() {
  try {
    await navigator.clipboard.writeText(termuxFallbackCommand);
    setText("#diagnosticOutput", "Copied the Termux fallback command.");
  } catch (error) {
    setText("#diagnosticOutput", "Copy failed. Select the command text manually.");
  }
}

async function updateApp() {
  if (!hasNativeRuntime()) {
    setText("#maintenanceStatus", "The in-app updater is only available inside the Android APK.");
    window.location.href = "/android/caatuu-debug.apk";
    return;
  }

  $("#updateApp").disabled = true;
  setText("#maintenanceStatus", "Checking the latest debug APK.");

  try {
    const result = await nativeCall(
      "update_app",
      {},
      {
        onEvent(message) {
          if (message.kind === "progress" && message.phase === "download") {
            const total = Number(message.totalBytes || 0);
            const bytes = Number(message.bytes || 0);
            const pct = total > 0 ? ` ${(bytes / total * 100).toFixed(1)}%` : "";
            setText("#maintenanceStatus", `Downloading update ${formatBytes(bytes)} / ${formatBytes(total)}${pct}`);
          } else if (message.kind === "status") {
            setText("#maintenanceStatus", message.message || "Preparing update.");
          }
        }
      }
    );

    if (result.action === "settings") {
      setText("#maintenanceStatus", "Android opened install permission settings. Allow installs for Caatuu, then tap Update app again.");
    } else {
      setText("#maintenanceStatus", "Android installer opened. Confirm the update there.");
    }
    setText("#diagnosticOutput", JSON.stringify(result, null, 2));
  } catch (error) {
    setText("#maintenanceStatus", error?.message || String(error));
  } finally {
    $("#updateApp").disabled = false;
  }
}

async function deleteModel() {
  if (!hasNativeRuntime()) {
    setText("#maintenanceStatus", "Model cleanup is only available inside the Android APK.");
    return;
  }

  $("#deleteModel").disabled = true;
  setText("#maintenanceStatus", "Deleting local model files.");

  try {
    const result = await nativeCall("delete_model");
    modelLoaded = false;
    updateSendButton();
    setText("#runtimeBadge", "Android native");
    setText("#progressBox", "Local model files deleted.");
    setText("#maintenanceStatus", `Deleted ${formatBytes(result.bytesDeleted || 0)} from app-private storage.`);
    setText("#diagnosticOutput", JSON.stringify(result, null, 2));
    await refreshNativeStatus();
  } catch (error) {
    setText("#maintenanceStatus", error?.message || String(error));
  } finally {
    $("#deleteModel").disabled = false;
  }
}

function clearStoredVerbMemory() {
  const accepted = window.confirm("Clear saved verb mastery for this browser?");
  if (!accepted) return;

  try {
    localStorage.removeItem(verbStorageKey);
    setText("#maintenanceStatus", "Saved verb mastery cleared.");
  } catch (error) {
    setText("#maintenanceStatus", "Could not clear saved verb mastery in this browser.");
  }
}

function renderBenchmarks(base, tuned) {
  const tunedById = Object.fromEntries(tuned.prompts.map((item) => [item.id, item]));
  $("#benchmarkList").replaceChildren(
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
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`${path} returned HTTP ${response.status}`);
  }
  return response.json();
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
  $("#openSettings").addEventListener("click", openSettingsPanel);
  $("#closeSettings").addEventListener("click", closeSettingsPanel);
  $("#settingsPanel").addEventListener("click", (event) => {
    if (event.target === $("#settingsPanel")) closeSettingsPanel();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !$("#settingsPanel").hidden) closeSettingsPanel();
  });

  $("#loadModel")?.addEventListener("click", () => loadModel());
  $("#newChat").addEventListener("click", startNewChat);
  $("#promptForm").addEventListener("submit", submitPrompt);
  $("#cacheProbe").addEventListener("click", cacheProbe);
  $("#loadBenchmarks").addEventListener("click", loadBenchmarks);
  $("#copyTermuxCommand").addEventListener("click", copyTermuxFallbackCommand);
  $("#updateApp").addEventListener("click", updateApp);
  $("#deleteModel").addEventListener("click", deleteModel);
  $("#settingsResetVerbMemory")?.addEventListener("click", clearStoredVerbMemory);

  document.querySelectorAll("[data-preset]").forEach((button) => {
    button.addEventListener("click", () => applyPreset(button.dataset.preset));
  });
  $("#composerEffort")?.addEventListener("change", (event) => applyPreset(event.target.value));

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
