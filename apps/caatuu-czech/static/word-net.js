import { LocalHashTextEmbedder } from "./vector-db.js";

const WORD_NET_MODEL_KEY = "cstinyllama-1.2b-czech-word-sentence-001";
const TRANSLATION_MODEL_KEY = "qwen3-1.7b-translation-cs-en-001";
const SCENE_KEYMAP_URL = "/assets/characters/miscellaneous/keymap.json";
const SCENE_ASSET_LIMIT = 5;
const TRANSLATION_MODE_STORAGE_KEY = "caatuu-czech.wordNet.translationMode";
const translationModes = {
  off: { label: "Off", delayMs: null },
  "timer-5": { label: "5s", delayMs: 5000 },
  "timer-10": { label: "10s", delayMs: 10000 },
  "timer-30": { label: "30s", delayMs: 30000 },
  visible: { label: "Visible", delayMs: 0 }
};
const sceneEmbedder = new LocalHashTextEmbedder();

const playInstruction = "Tap any word to make the next phrase. Use ↻ for a fresh random phrase.";

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
  (word) => `Vidím ${word} doma.`,
  (word) => `Dnes máme ${word} ve hře.`,
  (word) => `${capitalizeWord(word)} je tady.`,
  (word) => `Malé dítě říká ${word}.`,
  (word) => `Ve škole slyším ${word}.`
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
  currentSentence: "",
  currentTranslation: "",
  translationMode: loadTranslationMode(),
  translationVisible: true,
  translationTimerId: 0,
  sceneAssetRowsPromise: null,
  sceneCandidates: [],
  sceneRequestId: 0,
  history: []
};

const $ = (selector) => document.querySelector(selector);

function runtimeAdapter() {
  return window.CaatuuRuntime || null;
}

function randomItem(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function capitalizeWord(word) {
  const value = String(word || "").trim();
  if (!value) return value;
  return value.charAt(0).toLocaleUpperCase("cs-CZ") + value.slice(1);
}

function normalizeWord(word) {
  return String(word || "")
    .normalize("NFC")
    .replace(/^[^\p{L}\p{M}\d]+|[^\p{L}\p{M}\d]+$/gu, "")
    .trim();
}

function wordNetPrompt(word) {
  return `Cíl: ${word}\nNapiš jednu krátkou běžnou českou větu. Nevysvětluj.\nVěta:`;
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

function localSentence(word) {
  return randomItem(fallbackTemplates)(word);
}

function englishWordFor(word) {
  const key = normalizeWord(word).toLocaleLowerCase("cs-CZ");
  return seedEnglish[key] || key || "word";
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

function stripModelEcho(text) {
  let value = String(text || "").replace(/\r/g, "\n").trim();
  value = value.replace(/<\|[^>]+?\|>/g, " ").replace(/\s+/g, " ").trim();

  const sentenceMarker = value.match(/(?:věta|veta|sentence)\s*:\s*(.+)$/iu);
  if (sentenceMarker) value = sentenceMarker[1].trim();

  value = value
    .replace(/^(?:[-*•]|\d+[.)])\s*/u, "")
    .replace(/^["'„“”]+|["'„“”]+$/gu, "")
    .trim();

  const firstSentence = value.match(/^[^.!?]+[.!?]/u);
  if (firstSentence) value = firstSentence[0].trim();
  return value;
}

function sentenceIncludesWord(sentence, word) {
  const needle = normalizeWord(word).toLocaleLowerCase("cs-CZ");
  if (!needle) return false;
  const tokens = tokenizeCzechSentence(sentence)
    .filter((token) => token.type === "word")
    .map((token) => token.text.toLocaleLowerCase("cs-CZ"));
  return tokens.includes(needle);
}

function cleanSentence(output, word) {
  const cleaned = stripModelEcho(output);
  if (cleaned && sentenceIncludesWord(cleaned, word)) return cleaned;
  if (cleaned && cleaned.length <= 140) return cleaned;
  return localSentence(word);
}

function tokenizeCzechSentence(sentence) {
  const text = String(sentence || "").normalize("NFC");
  const tokens = [];
  const pattern = /[\p{L}\p{M}]+(?:[-'][\p{L}\p{M}]+)?|\d+|[^\s]/gu;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    const part = match[0];
    const isWord = /^[\p{L}\p{M}\d]/u.test(part);
    tokens.push({ type: isWord ? "word" : "punctuation", text: part });
  }
  return tokens;
}

function setStatus(message, { tone = "muted" } = {}) {
  const status = $("#wordNetStatus");
  const panel = $(".word-net-status-panel");
  if (status) status.textContent = message;
  if (panel) panel.dataset.tone = tone;
}

function updateBrowserNote() {
  const note = $("#wordNetBrowserNote");
  if (!note) return;
  note.hidden = runtimeAdapter()?.env === "android";
}

function loadTranslationMode() {
  try {
    const value = localStorage.getItem(TRANSLATION_MODE_STORAGE_KEY);
    if (hasTranslationMode(value)) return value;
  } catch (error) {
    // Ignore storage failures and use the default.
  }
  return "visible";
}

function hasTranslationMode(mode) {
  return Object.prototype.hasOwnProperty.call(translationModes, mode);
}

function saveTranslationMode() {
  try {
    localStorage.setItem(TRANSLATION_MODE_STORAGE_KEY, state.translationMode);
  } catch (error) {
    // Translation timing is a convenience setting; storage is optional.
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

function syncTranslationMenu() {
  document.querySelectorAll("[data-translation-mode]").forEach((button) => {
    const selected = button.dataset.translationMode === state.translationMode;
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-checked", selected ? "true" : "false");
  });
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
  state.translationMode = mode;
  saveTranslationMode();
  applyTranslationMode({ restartTimer: true });
  closeTranslationMenu();
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
  syncTranslationMenu();
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

function setBusy(busy) {
  state.busy = busy;
  document.querySelectorAll(".word-net-shuffle, .cz-word-token").forEach((button) => {
    button.disabled = busy;
  });
  $("#wordNetLoading").hidden = !busy;
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

function dotProduct(left, right) {
  const count = Math.min(left?.length || 0, right?.length || 0);
  let score = 0;
  for (let index = 0; index < count; index += 1) {
    score += left[index] * right[index];
  }
  return score;
}

function normalizeAssetPath(assetPath) {
  const value = String(assetPath || "").trim();
  if (value.startsWith("/assets/")) return value;
  if (value.startsWith("assets/")) return `/${value}`;
  return "";
}

function parseSceneKeymap(raw) {
  if (!raw || typeof raw !== "object") return [];
  return Object.entries(raw).map(([assetPath, metadata]) => {
    const normalizedPath = normalizeAssetPath(assetPath);
    const description = String(metadata?.description || "").trim();
    if (!normalizedPath || !description) return null;
    return {
      assetPath: normalizedPath,
      description,
      category: String(metadata?.category || "").trim()
    };
  }).filter(Boolean);
}

async function sceneAssetRows() {
  if (!state.sceneAssetRowsPromise) {
    state.sceneAssetRowsPromise = fetch(SCENE_KEYMAP_URL, { cache: "force-cache" })
      .then((response) => {
        if (!response.ok) throw new Error(`Could not load scene keymap (${response.status}).`);
        return response.json();
      })
      .then(async (raw) => {
        const rows = parseSceneKeymap(raw);
        const embeddedRows = [];
        for (const row of rows) {
          embeddedRows.push({
            ...row,
            vector: await sceneEmbedder.embedText(row.description)
          });
        }
        return embeddedRows;
      })
      .catch(() => []);
  }
  return state.sceneAssetRowsPromise;
}

async function rankedSceneCandidates(englishText) {
  const text = String(englishText || "").trim();
  if (!text) return [];

  const rows = await sceneAssetRows();
  if (!rows.length) return [];

  const queryVector = await sceneEmbedder.embedText(text);
  return rows
    .map((row) => ({
      ...row,
      score: dotProduct(queryVector, row.vector)
    }))
    .filter((row) => Number.isFinite(row.score))
    .sort((left, right) => right.score - left.score)
    .slice(0, SCENE_ASSET_LIMIT);
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

function cleanTranslation(output) {
  let value = String(output || "").replace(/\r/g, "\n").trim();
  value = value.replace(/<\|[^>]+?\|>/g, " ").replace(/\s+/g, " ").trim();
  const marker = value.match(/(?:english|translation)\s*:\s*(.+)$/iu);
  if (marker) value = marker[1].trim();
  value = value.replace(/^["'“”]+|["'“”]+$/gu, "").trim();
  const firstSentence = value.match(/^[^.!?]+[.!?]/u);
  return (firstSentence ? firstSentence[0] : value).trim();
}

async function translateCurrentSentence(sentence, word) {
  setTranslation("", { loading: true });
  if (!nativeTranslationRuntimeAvailable()) {
    const translation = localTranslation(sentence, word);
    setTranslation(translation);
    return translation;
  }

  try {
    let output = "";
    const result = await runtimeAdapter().models.generate(
      {
        prompt: translationPrompt(sentence),
        modelKey: TRANSLATION_MODEL_KEY,
        maxTokens: 96,
        options: {
          thinking: false,
          temperature: 0
        }
      },
      {
        onEvent(message) {
          if (message.kind === "token") {
            output += message.token || "";
          } else if (message.kind === "status") {
            setStatus(message.message || "Translating to English.", { tone: "active" });
          }
        }
      }
    );
    const translation = cleanTranslation(output || result?.output || "") || localTranslation(sentence, word);
    setTranslation(translation);
    return translation;
  } catch (error) {
    const translation = localTranslation(sentence, word);
    setTranslation(translation);
    return translation;
  }
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

  const normalizedSelected = normalizeWord(selectedWord).toLocaleLowerCase("cs-CZ");
  host.replaceChildren(...tokens.map((token) => {
    if (token.type !== "word") {
      const span = document.createElement("span");
      span.className = "cz-punctuation-token";
      span.textContent = token.text;
      return span;
    }

    const button = document.createElement("button");
    button.type = "button";
    button.className = "cz-word-token";
    button.textContent = token.text;
    button.dataset.word = normalizeWord(token.text);
    button.setAttribute("aria-label", `Use ${token.text} for the next sentence`);
    if (button.dataset.word.toLocaleLowerCase("cs-CZ") === normalizedSelected) {
      button.classList.add("is-selected");
    }
    return button;
  }));
}

function rememberStep(word, sentence) {
  state.history.unshift({ word, sentence });
  state.history = state.history.slice(0, 12);
  renderTrail();
}

async function generateSentenceForWord(word, { source = "choice" } = {}) {
  const target = normalizeWord(word) || randomItem(seedWords);
  if (state.busy) return;

  state.currentWord = target;
  renderCzechSentence(state.currentSentence, target);
  setTranslation("");
  hideSceneAsset({ cancel: true });
  setBusy(true);
  setProgress(null);

  const firstRun = source === "initial" || source === "seed";
  setStatus(firstRun ? "Generating a Czech sentence." : `Generating from "${target}".`, { tone: "active" });

  try {
    let output = "";
    const usedNativeModel = nativeWordNetRuntimeAvailable();
    if (usedNativeModel) {
      const result = await runtimeAdapter().models.generate(
        {
          prompt: wordNetPrompt(target),
          modelKey: WORD_NET_MODEL_KEY,
          maxTokens: 64,
          options: {
            thinking: false,
            temperature: 0.75
          }
        },
        {
          onEvent(message) {
            if (message.kind === "token") {
              output += message.token || "";
            } else if (message.kind === "progress") {
              setProgress(message);
            } else if (message.kind === "status") {
              setStatus(message.message || "Generating locally.", { tone: "active" });
            }
          }
        }
      );
      output = output || result?.output || "";
    } else {
      output = localSentence(target);
      setStatus("Preparing preview phrase.", { tone: "active" });
    }

    const sentence = cleanSentence(output, target);
    state.currentSentence = sentence;
    renderCzechSentence(sentence);
    rememberStep(target, sentence);
    const englishSentence = await translateCurrentSentence(sentence, target);
    void updateSceneAsset(englishSentence);
    setStatus(
      playInstruction,
      { tone: "muted" }
    );
  } catch (error) {
    const sentence = localSentence(target);
    state.currentSentence = sentence;
    renderCzechSentence(sentence);
    const englishSentence = localTranslation(sentence, target);
    setTranslation(englishSentence);
    void updateSceneAsset(englishSentence);
    setStatus(error?.message || "Could not generate with the model.", { tone: "error" });
  } finally {
    setProgress(null);
    setBusy(false);
  }
}

function bindUi() {
  $("#wordNetShuffle")?.addEventListener("click", () => {
    generateSentenceForWord(randomItem(seedWords), { source: "seed" });
  });
  $("#wordNetTranslationToggle")?.addEventListener("click", () => {
    toggleTranslationMenu();
  });
  $("#wordNetTranslationMenu")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-translation-mode]");
    if (!button) return;
    setTranslationMode(button.dataset.translationMode);
  });
  document.addEventListener("click", (event) => {
    if (event.target.closest(".word-net-panel-actions")) return;
    closeTranslationMenu();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeTranslationMenu();
  });
  $("#wordNetSentence")?.addEventListener("click", (event) => {
    const button = event.target.closest(".cz-word-token");
    if (!button || state.busy) return;
    generateSentenceForWord(button.dataset.word, { source: "choice" });
  });
}

async function init() {
  bindUi();
  runtimeAdapter()?.registerServiceWorker?.().catch(() => {});
  updateBrowserNote();
  applyTranslationMode();
  renderCzechSentence("");
  setStatus(playInstruction);
  await generateSentenceForWord(randomItem(seedWords), { source: "initial" });
}

init();
