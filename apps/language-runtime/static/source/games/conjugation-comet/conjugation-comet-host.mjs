import {
  fetchDeclaredCourseGameJson,
  readEmbeddedCourseProfile
} from "../course-game-content.mjs?v=course-game-content-1";
import {
  buildConjugationFormRound,
  buildConjugationMeaningRound,
  buildConjugationVerbQueue,
  validateConjugationCometCatalog
} from "./conjugation-comet-core.mjs?v=conjugation-comet-core-2";

const GAME_ID = "conjugation-comet";
const RESOURCE_NAME = "conjugationCometCatalog";
const NEXT_ROUND_DELAY_MILLIS = 1_450;
const PHASE_CHANGE_DELAY_MILLIS = 520;
const WRONG_MATCH_DELAY_MILLIS = 620;

function element(id) {
  return document.getElementById(id);
}

function shellWindow() {
  try {
    if (window.parent !== window && window.parent.location.origin === window.location.origin) {
      return window.parent;
    }
  } catch {
    // readEmbeddedCourseProfile reports the actionable origin error.
  }
  return window;
}

function setPresentationFromShell() {
  const shell = shellWindow();
  let theme = "dark";
  let fontSize = "largest";
  try {
    theme = shell.document?.documentElement?.dataset?.theme || theme;
    fontSize = shell.document?.documentElement?.dataset?.fontSize || fontSize;
  } catch {
    // The origin boundary is validated before course content loads.
  }
  document.documentElement.dataset.theme = ["light", "dark"].includes(theme) ? theme : "dark";
  document.documentElement.dataset.fontSize = ["standard", "large", "largest"].includes(fontSize)
    ? fontSize
    : "largest";
}

function createButton(className, text) {
  const button = document.createElement("button");
  button.className = className;
  button.type = "button";
  button.textContent = text;
  return button;
}

function createTextElement(tagName, className, text, language = "") {
  const node = document.createElement(tagName);
  node.className = className;
  node.textContent = text;
  if (language) node.lang = language;
  return node;
}

function formatCopy(template, replacements) {
  return Object.entries(replacements).reduce(
    (message, [key, value]) => message.replaceAll(`{${key}}`, String(value)),
    template
  );
}

function setFeedback(message, kind = "") {
  const feedback = element("conjugationCometFeedback");
  if (!feedback) return;
  feedback.textContent = message;
  if (kind) feedback.dataset.kind = kind;
  else delete feedback.dataset.kind;
}

function recordLearning(delta) {
  try {
    shellWindow().CaatuuLearning?.record?.(GAME_ID, delta);
  } catch {
    // Learning telemetry is optional; authored gameplay remains available.
  }
}

function announceRoundSuccess(state) {
  if (state.roundSuccessSent || !state.current) return;
  state.roundSuccessSent = true;
  const target = shellWindow();
  target.postMessage?.({
    source: "caatuu-game",
    type: "round-success",
    gameId: GAME_ID,
    contentId: state.current.id,
    contentRevision: state.current.revision,
    catalogId: state.catalog.id,
    catalogRevision: state.catalog.contentRevision
  }, window.location.origin);
}

function speechAvailable(state) {
  return state.course?.capabilities?.speech === true;
}

async function stopSpeech() {
  const shell = shellWindow();
  try {
    if (typeof shell.CaatuuChrome?.stopSpeech === "function") {
      await shell.CaatuuChrome.stopSpeech();
      return;
    }
  } catch {
    // Browser speech cancellation below is still safe to attempt.
  }
  window.speechSynthesis?.cancel?.();
}

async function speakTargetText(state, text, button) {
  if (!speechAvailable(state) || !text) return;
  const normalized = String(text).normalize("NFC").trim();
  if (!normalized || normalized.length > 1_000) return;
  const previousLabel = button?.getAttribute("aria-label") || "";
  if (button) {
    button.disabled = true;
    button.setAttribute("aria-label", formatCopy(state.catalog.copy.playingTemplate, {
      text: normalized
    }));
  }
  try {
    const shell = shellWindow();
    if (typeof shell.CaatuuChrome?.speakText === "function") {
      await shell.CaatuuChrome.speakText(normalized);
      return;
    }
    const synthesis = window.speechSynthesis;
    const Utterance = window.SpeechSynthesisUtterance;
    if (!synthesis || !Utterance) throw new Error("Speech is unavailable.");
    synthesis.cancel();
    const utterance = new Utterance(normalized);
    utterance.lang = String(
      state.course.targetLanguage?.speechLocale
      || state.course.targetLanguage?.locale
      || state.catalog.targetLocale
    );
    utterance.rate = 0.72;
    await new Promise((resolve, reject) => {
      utterance.addEventListener("end", resolve, { once: true });
      utterance.addEventListener("error", reject, { once: true });
      synthesis.speak(utterance);
    });
  } catch {
    setFeedback(formatCopy(state.catalog.copy.audioUnavailableTemplate, {
      language: state.course.targetLanguage?.label || state.course.targetLanguage?.id
    }));
  } finally {
    if (button) {
      button.disabled = false;
      if (previousLabel) button.setAttribute("aria-label", previousLabel);
      else button.removeAttribute("aria-label");
    }
  }
}

function targetCard(state, form) {
  const row = document.createElement("div");
  row.className = "conjugation-comet-card-row";
  row.dataset.formId = form.id;
  row.classList.toggle("is-matched", state.matchedFormIds.has(form.id));
  row.classList.toggle("is-wrong", state.wrongFormId === form.id);

  const button = createButton("conjugation-comet-match-card", "");
  button.dataset.matchSide = "target";
  button.dataset.matchId = form.id;
  button.disabled = state.matchedFormIds.has(form.id) || state.roundComplete;
  button.setAttribute("aria-pressed", String(state.selectedFormId === form.id));
  button.setAttribute(
    "aria-label",
    `${form.subjectTargetText}: ${form.targetText}${state.matchedFormIds.has(form.id) ? `, ${state.catalog.copy.matchedStateLabel}` : ""}`
  );
  button.append(
    createTextElement("span", "", form.subjectTargetText, state.targetLocale),
    createTextElement("strong", "", form.targetText, state.targetLocale)
  );

  const speak = createButton("conjugation-comet-speak", "");
  speak.hidden = !speechAvailable(state);
  speak.dataset.speakText = form.targetText;
  const hearFormLabel = formatCopy(state.catalog.copy.hearFormTemplate, {
    form: form.targetText
  });
  speak.setAttribute("aria-label", hearFormLabel);
  speak.append(
    createTextElement("span", "", "🔊"),
    createTextElement("span", "", hearFormLabel)
  );
  row.append(button, speak);
  return row;
}

function cueCard(state, form) {
  const row = document.createElement("div");
  row.className = "conjugation-comet-card-row";
  row.dataset.cueId = form.id;
  row.classList.toggle("is-matched", state.matchedCueIds.has(form.id));
  row.classList.toggle("is-wrong", state.wrongCueId === form.id);

  const button = createButton("conjugation-comet-match-card", "");
  button.dataset.matchSide = "cue";
  button.dataset.matchId = form.id;
  button.disabled = state.matchedCueIds.has(form.id) || state.roundComplete;
  button.setAttribute("aria-pressed", String(state.selectedCueId === form.id));
  button.setAttribute(
    "aria-label",
    `${form.learnerBaseCueText}${state.matchedCueIds.has(form.id) ? `, ${state.catalog.copy.matchedStateLabel}` : ""}`
  );
  button.append(createTextElement("strong", "", form.learnerBaseCueText, state.sourceLocale));
  row.append(button);
  return row;
}

function renderMeaning(state) {
  const current = state.current;
  element("conjugationCometKicker").textContent = state.catalog.copy.meaningKicker;
  element("conjugationCometInstruction").textContent = state.catalog.copy.meaningInstruction;
  element("conjugationCometLemma").textContent = current.targetText;
  element("conjugationCometLemma").lang = state.targetLocale;
  element("conjugationCometFamily").textContent = current.family;
  const speak = element("conjugationCometSpeakLemma");
  speak.hidden = !speechAvailable(state);
  speak.dataset.speakText = current.targetText;
  const hearVerbLabel = formatCopy(state.catalog.copy.hearVerbTemplate, {
    verb: current.targetText
  });
  speak.setAttribute("aria-label", hearVerbLabel);
  speak.querySelector("span:last-child").textContent = hearVerbLabel;

  const options = state.meaningRound.options.map((option) => {
    const row = document.createElement("div");
    row.className = "conjugation-comet-card-row";
    row.classList.toggle("is-wrong", state.wrongMeaningId === option.id);
    row.classList.toggle("is-matched", state.meaningMatched && option.id === state.meaningRound.answerId);
    const button = createButton("conjugation-comet-match-card", option.learnerBaseText);
    button.lang = state.sourceLocale;
    button.dataset.meaningId = option.id;
    button.disabled = state.meaningMatched;
    button.setAttribute("aria-pressed", String(state.meaningMatched && option.id === state.meaningRound.answerId));
    row.append(button);
    return row;
  });
  element("conjugationCometMeaningOptions").replaceChildren(...options);
  element("conjugationCometProgress").textContent = formatCopy(
    state.catalog.copy.meaningProgressTemplate,
    { number: state.completedRounds + 1 }
  );
  if (!state.meaningMatched && !state.wrongMeaningId) {
    setFeedback(state.catalog.copy.meaningStartFeedback);
  }
}

function renderForms(state) {
  element("conjugationCometKicker").textContent = state.catalog.copy.formsKicker;
  element("conjugationCometInstruction").textContent = `${state.current.targetText} · ${state.catalog.copy.formsInstruction}`;
  element("conjugationCometTargetFormsHeading").textContent = state.catalog.copy.targetFormsHeading;
  element("conjugationCometBaseCuesHeading").textContent = state.catalog.copy.baseCuesHeading;
  element("conjugationCometTargetForms").replaceChildren(
    ...state.formRound.targetForms.map((form) => targetCard(state, form))
  );
  element("conjugationCometBaseCues").replaceChildren(
    ...state.formRound.baseCues.map((form) => cueCard(state, form))
  );
  const matched = state.matchedFormIds.size;
  const total = state.formRound.targetForms.length;
  element("conjugationCometProgress").textContent = formatCopy(
    state.catalog.copy.formsProgressTemplate,
    { matched, total }
  );
  if (!state.roundComplete && !state.wrongFormId && !state.wrongCueId) {
    setFeedback(
      state.selectedFormId || state.selectedCueId
        ? state.catalog.copy.pairSelectedFeedback
        : state.catalog.copy.formsStartFeedback
    );
  }
}

function render(state) {
  const meaning = state.phase === "meaning";
  const forms = state.phase === "forms";
  element("conjugationCometMeaningBoard").hidden = !meaning;
  element("conjugationCometFormsBoard").hidden = !forms;
  element("conjugationCometHint").hidden = !state.hintVisible;
  element("conjugationCometHint").textContent = state.current?.teachingNoteBaseText || "";
  const hintButton = element("conjugationCometHintButton");
  hintButton.textContent = state.catalog.copy.hintLabel;
  hintButton.setAttribute("aria-expanded", String(state.hintVisible));
  element("conjugationCometNext").textContent = state.catalog.copy.nextLabel;
  element("conjugationCometNext").hidden = !state.roundComplete;
  if (meaning) renderMeaning(state);
  if (forms) renderForms(state);
}

function refillQueue(state) {
  state.queue = buildConjugationVerbQueue(state.catalog.verbs, {
    previousVerbId: state.current?.id
  });
}

function clearTransitionTimer(state) {
  if (!state.transitionTimer) return;
  window.clearTimeout(state.transitionTimer);
  state.transitionTimer = 0;
}

function beginNextVerb(state) {
  clearTransitionTimer(state);
  if (!state.queue.length) refillQueue(state);
  state.current = state.queue.shift();
  state.phase = "meaning";
  state.meaningRound = buildConjugationMeaningRound(state.catalog, state.current.id);
  state.formRound = null;
  state.meaningMatched = false;
  state.wrongMeaningId = "";
  state.selectedFormId = "";
  state.selectedCueId = "";
  state.matchedFormIds = new Set();
  state.matchedCueIds = new Set();
  state.wrongFormId = "";
  state.wrongCueId = "";
  state.roundComplete = false;
  state.roundSuccessSent = false;
  state.hintVisible = false;
  render(state);
  window.requestAnimationFrame(() => {
    element("conjugationCometMeaningOptions")?.querySelector("button")?.focus?.();
  });
}

function handleMeaningSelection(state, meaningId) {
  if (state.phase !== "meaning" || state.meaningMatched || state.wrongMeaningId) return;
  const correct = meaningId === state.meaningRound.answerId;
  recordLearning({ activities: 1, attempts: 1, successes: correct ? 1 : 0, xp: correct ? 1 : 0 });
  if (!correct) {
    state.wrongMeaningId = meaningId;
    setFeedback(state.catalog.copy.wrongMeaningFeedback, "wrong");
    renderMeaning(state);
    state.transitionTimer = window.setTimeout(() => {
      state.wrongMeaningId = "";
      render(state);
    }, WRONG_MATCH_DELAY_MILLIS);
    return;
  }
  state.meaningMatched = true;
  setFeedback(formatCopy(state.catalog.copy.correctMeaningTemplate, {
    meaning: state.current.meaningChoiceBaseText
  }), "correct");
  renderMeaning(state);
  state.transitionTimer = window.setTimeout(() => {
    state.formRound = buildConjugationFormRound(state.catalog, state.current.id);
    state.phase = "forms";
    render(state);
    window.requestAnimationFrame(() => {
      element("conjugationCometTargetForms")?.querySelector("button")?.focus?.();
    });
  }, PHASE_CHANGE_DELAY_MILLIS);
}

function completeFormRound(state) {
  state.roundComplete = true;
  state.completedRounds += 1;
  setFeedback(formatCopy(state.catalog.copy.roundCompleteTemplate, {
    verb: state.current.targetText
  }), "correct");
  announceRoundSuccess(state);
  render(state);
  state.transitionTimer = window.setTimeout(() => beginNextVerb(state), NEXT_ROUND_DELAY_MILLIS);
}

function settleSelectedPair(state) {
  if (!state.selectedFormId || !state.selectedCueId) return;
  const correct = state.selectedFormId === state.selectedCueId;
  recordLearning({ activities: 1, attempts: 1, successes: correct ? 1 : 0, xp: correct ? 1 : 0 });
  if (correct) {
    state.matchedFormIds.add(state.selectedFormId);
    state.matchedCueIds.add(state.selectedCueId);
    state.selectedFormId = "";
    state.selectedCueId = "";
    if (state.matchedFormIds.size === state.formRound.targetForms.length) {
      completeFormRound(state);
      return;
    }
    setFeedback(state.catalog.copy.pairMatchedFeedback, "correct");
    render(state);
    return;
  }

  state.wrongFormId = state.selectedFormId;
  state.wrongCueId = state.selectedCueId;
  state.selectedFormId = "";
  state.selectedCueId = "";
  setFeedback(state.catalog.copy.wrongPairFeedback, "wrong");
  render(state);
  state.transitionTimer = window.setTimeout(() => {
    state.wrongFormId = "";
    state.wrongCueId = "";
    render(state);
  }, WRONG_MATCH_DELAY_MILLIS);
}

function handleFormSelection(state, side, formId) {
  if (state.phase !== "forms" || state.roundComplete || state.wrongFormId || state.wrongCueId) return;
  if (side === "target" && !state.matchedFormIds.has(formId)) {
    state.selectedFormId = state.selectedFormId === formId ? "" : formId;
  } else if (side === "cue" && !state.matchedCueIds.has(formId)) {
    state.selectedCueId = state.selectedCueId === formId ? "" : formId;
  }
  render(state);
  settleSelectedPair(state);
}

function bindUi(state) {
  document.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.dataset.meaningId) {
      handleMeaningSelection(state, button.dataset.meaningId);
      return;
    }
    if (button.dataset.matchSide && button.dataset.matchId) {
      handleFormSelection(state, button.dataset.matchSide, button.dataset.matchId);
      return;
    }
    if (button.dataset.speakText) {
      void speakTargetText(state, button.dataset.speakText, button);
      return;
    }
    if (button.id === "conjugationCometHintButton") {
      state.hintVisible = !state.hintVisible;
      render(state);
      return;
    }
    if (button.id === "conjugationCometNext") beginNextVerb(state);
  });

  window.addEventListener("message", (event) => {
    if (event.origin !== window.location.origin || event.source !== shellWindow()) return;
    const message = event.data;
    if (message?.source !== "caatuu-app-shell") return;
    if (message.type === "visibility") {
      const theme = String(message.theme || "");
      const fontSize = String(message.fontSize || "");
      if (["light", "dark"].includes(theme)) document.documentElement.dataset.theme = theme;
      if (["standard", "large", "largest"].includes(fontSize)) {
        document.documentElement.dataset.fontSize = fontSize;
      }
      if (message.active === false) void stopSpeech();
    } else if (message.type === "campaign-advance" && state.roundComplete) {
      beginNextVerb(state);
    }
  });
  window.addEventListener("pagehide", () => {
    clearTransitionTimer(state);
    void stopSpeech();
  });
}

function showError(error) {
  console.error("Conjugation Comet could not initialize.", error);
  element("conjugationCometRoot").setAttribute("aria-busy", "false");
  element("conjugationCometLoading").hidden = true;
  element("conjugationCometGame").hidden = true;
  element("conjugationCometError").hidden = false;
  element("conjugationCometErrorText").textContent = String(
    error?.message || "Return to the planets and try again."
  );
}

export async function mountSharedConjugationComet({
  scope = globalThis,
  fetchImpl = globalThis.fetch
} = {}) {
  const course = readEmbeddedCourseProfile(scope);
  const { document: rawCatalog } = await fetchDeclaredCourseGameJson(course, {
    gameId: GAME_ID,
    resourceName: RESOURCE_NAME,
    runtimeHref: scope.location.href,
    fetchImpl
  });
  const catalog = validateConjugationCometCatalog(rawCatalog, {
    expectedCourseId: course.id,
    expectedTargetLanguageId: course.targetLanguage?.id,
    expectedLearnerBaseLanguageId: course.sourceLanguage?.id,
    expectedTargetLocale: course.targetLanguage?.locale
  });
  const targetLocale = String(
    course.targetLanguage?.locale
    || course.targetLanguage?.id
    || catalog.targetLocale
  ).trim();
  const sourceLocale = String(
    course.sourceLanguage?.locale
    || course.sourceLanguage?.id
    || catalog.learnerBaseLanguageId
  ).trim();
  document.documentElement.lang = String(
    course.sourceLanguage?.locale || course.sourceLanguage?.id || "en"
  );
  document.documentElement.dir = String(course.sourceLanguage?.direction || "ltr");
  document.title = `${catalog.copy.title} — ${course.workspaceLabel || "Caatuu"}`;
  element("conjugationCometTitle").textContent = catalog.copy.title;
  element("conjugationCometMeaningTargetHeading").textContent = catalog.copy.meaningTargetHeading;
  element("conjugationCometMeaningBaseHeading").textContent = catalog.copy.meaningChoicesHeading;
  element("conjugationCometInfinitiveLabel").textContent = catalog.copy.infinitiveLabel;
  element("conjugationCometMeaningBoard").setAttribute("aria-label", catalog.copy.meaningBoardLabel);
  element("conjugationCometFormsBoard").setAttribute("aria-label", catalog.copy.formsBoardLabel);
  element("conjugationCometProgress").setAttribute("aria-label", catalog.copy.progressLabel);

  const state = {
    course,
    catalog,
    targetLocale,
    sourceLocale,
    phase: "loading",
    queue: [],
    current: null,
    meaningRound: null,
    formRound: null,
    meaningMatched: false,
    wrongMeaningId: "",
    selectedFormId: "",
    selectedCueId: "",
    matchedFormIds: new Set(),
    matchedCueIds: new Set(),
    wrongFormId: "",
    wrongCueId: "",
    roundComplete: false,
    roundSuccessSent: false,
    hintVisible: false,
    completedRounds: 0,
    transitionTimer: 0
  };
  bindUi(state);
  element("conjugationCometRoot").setAttribute("aria-busy", "false");
  element("conjugationCometLoading").hidden = true;
  element("conjugationCometGame").hidden = false;
  refillQueue(state);
  beginNextVerb(state);
  document.dispatchEvent(new CustomEvent("caatuu:conjugation-comet-ready", {
    detail: Object.freeze({
      courseId: course.id,
      catalogId: catalog.id,
      catalogRevision: catalog.contentRevision
    })
  }));
  return Object.freeze({
    courseId: course.id,
    catalogId: catalog.id,
    catalogRevision: catalog.contentRevision,
    next() {
      beginNextVerb(state);
    },
    stop() {
      clearTransitionTimer(state);
      void stopSpeech();
    }
  });
}

setPresentationFromShell();
mountSharedConjugationComet().catch(showError);
