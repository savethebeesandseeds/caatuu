const WORD_NET_MODEL_KEY = "cstinyllama-1.2b-czech-word-sentence-001";
const TRANSLATION_MODEL_KEY = "qwen3-1.7b-translation-cs-en-001";

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
  translationVisible: true,
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

function setTranslation(text, { loading = false } = {}) {
  state.currentTranslation = String(text || "");
  const node = $("#wordNetTranslation");
  if (!node) return;
  node.textContent = loading ? "Translating..." : state.currentTranslation;
  node.classList.toggle("is-hidden", !state.translationVisible);
  node.setAttribute("aria-hidden", state.translationVisible ? "false" : "true");
}

function syncTranslationToggle() {
  const button = $("#wordNetTranslationToggle");
  const translation = $("#wordNetTranslation");
  if (!button || !translation) return;
  button.classList.toggle("is-off", !state.translationVisible);
  button.setAttribute("aria-label", state.translationVisible ? "Hide translation" : "Show translation");
  translation.classList.toggle("is-hidden", !state.translationVisible);
  translation.setAttribute("aria-hidden", state.translationVisible ? "false" : "true");
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
    setTranslation(localTranslation(sentence, word));
    return;
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
    setTranslation(cleanTranslation(output || result?.output || "") || localTranslation(sentence, word));
  } catch (error) {
    setTranslation(localTranslation(sentence, word));
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
    await translateCurrentSentence(sentence, target);
    setStatus(
      playInstruction,
      { tone: "muted" }
    );
  } catch (error) {
    const sentence = localSentence(target);
    state.currentSentence = sentence;
    renderCzechSentence(sentence);
    setTranslation(localTranslation(sentence, target));
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
    state.translationVisible = !state.translationVisible;
    syncTranslationToggle();
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
  syncTranslationToggle();
  renderCzechSentence("");
  setStatus(playInstruction);
  await generateSentenceForWord(randomItem(seedWords), { source: "initial" });
}

init();
