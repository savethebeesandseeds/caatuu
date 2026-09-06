import { createSpeechIcon, mountEmbeddedGameControls, mountRobotLoadingScreen } from "/language-runtime/static/source/games/embedded-game-controls.mjs?v=embedded-game-controls-8";

import { CZECH_CASES, validatePack, buildRounds, buildQuestions } from "./case-cosmos-content.mjs?v=case-cosmos-content-2";
import { assertEnglishCzechCourse } from "./case-cosmos-cs-policy.mjs?v=case-cosmos-policy-1";

const DATA_URL = "data/games/case-cosmos/challenges.json?v=case-cosmos-data-6";
const $ = (selector) => document.querySelector(selector);
const state = {
  pack: [],
  rounds: [],
  difficulty: 1,
  index: 0,
  questions: [],
  questionIndex: 0,
  candidateIndex: 0,
  phase: "loading",
  answer: null,
  shell: null,
  controls: null,
  loadingScreen: null,
  active: true,
  pageHidden: false,
  destroyed: false,
  illustrations: true,
  artworkAvailable: true,
  speaking: false,
  speechRequest: 0,
  transition: null,
  epoch: 0,
  menuOpen: false,
  error: ""
};
const listeners = [];
let swipe = null;

function listen(target, type, handler) {
  target.addEventListener(type, handler);
  listeners.push(() => target.removeEventListener(type, handler));
}

function engaged() {
  return state.active && !state.pageHidden && !state.destroyed && !document.hidden;
}

const now = () => window.performance?.now?.() ?? Date.now();
const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

function cancelTransition() {
  state.epoch += 1;
  if (state.transition) window.clearTimeout(state.transition.timer);
  state.transition = null;
}

function syncTransition() {
  const active = engaged() && !state.menuOpen;
  $("#caseCosmosBoard").dataset.active = String(active);
  const step = state.transition;
  if (!step) return;
  if (step.started !== null) step.remaining = Math.max(0, step.remaining - (now() - step.started));
  window.clearTimeout(step.timer);
  step.timer = null;
  step.started = active ? now() : null;
  if (!active) return;
  step.timer = window.setTimeout(() => {
    if (state.transition !== step || !engaged() || state.menuOpen) return;
    state.transition = null;
    step.callback();
  }, step.remaining);
}

function scheduleStep(milliseconds, callback) {
  if (state.transition) window.clearTimeout(state.transition.timer);
  state.transition = { remaining: milliseconds, callback, timer: null, started: null };
  syncTransition();
}

function syncActivity() {
  if (!engaged() || state.menuOpen) { resetSwipe(); stopSentence(); }
  else syncSpeech();
  syncTransition();
}

function resetSwipe() {
  const pointerId = swipe?.pointerId;
  swipe = null;
  delete $("#caseCosmosBoard").dataset.swipeAnswer;
  const vessel = $("#caseCosmosVessel");
  if (pointerId !== undefined && vessel.hasPointerCapture?.(pointerId)) {
    vessel.releasePointerCapture(pointerId);
  }
}

function bindSwipes() {
  const vessel = $("#caseCosmosVessel");
  const ready = () => engaged() && state.phase === "question" && !state.controls?.isOpen();
  listen(document, "pointerdown", (event) => {
    // A second contact cancels the gesture so pinching cannot answer a question.
    if (swipe) { resetSwipe(); return; }
    if (!ready() || event.isPrimary === false || event.button !== 0
        || !vessel.contains(event.target)
        || event.target?.closest?.("button, a, input, select, textarea, [contenteditable], #caseCosmosFeedback")) return;
    swipe = {
      pointerId: event.pointerId, x: event.clientX, y: event.clientY,
      question: currentQuestion(), threshold: Math.max(52, Math.min(96, vessel.getBoundingClientRect().width * 0.15))
    };
    try { vessel.setPointerCapture?.(event.pointerId); }
    catch { /* A pointer can leave the document before capture is acquired. */ }
  });
  listen(document, "pointermove", (event) => {
    if (!swipe || event.pointerId !== swipe.pointerId) return;
    if (!ready() || swipe.question !== currentQuestion()) { resetSwipe(); return; }
    const dx = event.clientX - swipe.x;
    const dy = event.clientY - swipe.y;
    if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) { resetSwipe(); return; }
    $("#caseCosmosBoard").dataset.swipeAnswer = Math.abs(dx) >= swipe.threshold && Math.abs(dx) > Math.abs(dy) * 1.5
      ? (dx > 0 ? "yes" : "no") : "";
  });
  listen(document, "pointerup", (event) => {
    if (!swipe || event.pointerId !== swipe.pointerId) return;
    const gesture = swipe;
    resetSwipe();
    const dx = event.clientX - gesture.x;
    const dy = event.clientY - gesture.y;
    if (ready() && gesture.question === currentQuestion()
        && Math.abs(dx) >= gesture.threshold && Math.abs(dx) > Math.abs(dy) * 1.5) {
      chooseAnswer(dx > 0);
    }
  });
  listen(document, "pointercancel", resetSwipe);
  listen(vessel, "lostpointercapture", resetSwipe);
  listen(window, "blur", resetSwipe);
}

function syncSpeech() {
  state.loadingScreen?.setActive(engaged() && !state.menuOpen);
  const button = $("#caseCosmosSpeak");
  const supported = state.shell?.CaatuuCourse?.capabilities?.speech === true;
  button.hidden = !supported;
  button.disabled = !supported || !engaged() || state.menuOpen || !["question", "solved"].includes(state.phase)
    || Boolean(state.shell?.CaatuuChrome?.getSpeechMuted?.());
  button.replaceChildren(createSpeechIcon(document, { stop: state.speaking }));
  const label = state.shell?.CaatuuI18n?.t(`games.grammargravity.nouns.${state.speaking ? "stopsound" : "hear"}`,
    { word: speechText() }) || "Hear noun form";
  button.setAttribute("aria-label", label);
  button.title = label;
}

function speechText() {
  // Do not pronounce an intentionally incorrect sentence as a model utterance.
  return state.phase === "solved" ? currentChallenge()?.czech || "" : currentQuestion()?.form || "";
}

function stopSentence() {
  state.speechRequest += 1;
  const ownedSpeech = state.speaking;
  state.speaking = false;
  // A hidden Case Cosmos must never cancel another game's pronunciation.
  if (ownedSpeech) {
    try { Promise.resolve(state.shell?.CaatuuChrome?.stopSpeech?.()).catch(() => {}); }
    catch { /* Speech availability never blocks the exercise. */ }
  }
  syncSpeech();
}

async function speakSentence() {
  const api = state.shell?.CaatuuChrome;
  if (!engaged() || state.menuOpen || !["question", "solved"].includes(state.phase)
      || state.shell?.CaatuuCourse?.capabilities?.speech !== true
      || api?.getSpeechMuted?.() || !currentQuestion()?.czech) return;
  if (state.speaking) { stopSentence(); return; }
  const request = ++state.speechRequest;
  const text = speechText();
  state.speaking = true;
  syncSpeech();
  try {
    await api.stopSpeech();
    if (request !== state.speechRequest || !engaged() || api.getSpeechMuted()) return;
    await api.speakText(text);
  } catch { /* Keep manual pronunciation optional when no voice is available. */ }
  finally {
    if (request === state.speechRequest && !state.destroyed) {
      state.speaking = false;
      syncSpeech();
    }
  }
}

function syncIllustrations() {
  resetSwipe();
  $("#caseCosmosPanel").classList.toggle("case-cosmos-illustrations-off", !state.illustrations);
  $("#caseCosmosPanel").classList.toggle("case-cosmos-boat-layout", state.illustrations && state.artworkAvailable);
}

function mountControls() {
  const shell = window.parent !== window ? window.parent : window;
  if (shell.location.origin !== window.location.origin) {
    throw new Error("Case Cosmos requires its same-origin application shell.");
  }
  assertEnglishCzechCourse(shell.CaatuuCourse);
  state.shell = shell;
  state.loadingScreen = mountRobotLoadingScreen({
    container: $("#caseCosmosLoading"), label: shell.CaatuuI18n.t("verbnebula.round.preparing"), active: engaged()
  });
  state.controls = mountEmbeddedGameControls({
    container: $("#caseCosmosControls"), shell, course: shell.CaatuuCourse,
    onOpenChange(open) { state.menuOpen = open; syncActivity(); },
    illustrations: {
      labelKey: "games.grammargravity.controls.illustrations", pressed: state.illustrations,
      onChange(value) {
        state.illustrations = value;
        syncIllustrations();
      }
    }
  });
}

function record(delta) {
  window.CaatuuLearning?.record?.("case-cosmos", delta);
}

function announceRoundSuccess() {
  if (window.parent === window) return;
  window.parent.postMessage({
    source: "caatuu-game",
    type: "round-success",
    gameId: "case-cosmos"
  }, window.location.origin);
}

function bindCampaignBridge() {
  if (window.parent === window) return;
  listen(window, "message", (event) => {
    if (event.origin !== window.location.origin || event.source !== window.parent) return;
    if (event.data?.source !== "caatuu-app-shell") return;
    if (event.data.type === "campaign-advance") nextRound();
    else if (event.data.type === "visibility") {
      state.active = Boolean(event.data.active);
      if (!engaged()) state.controls?.close();
      syncActivity();
      document.body.toggleAttribute("inert", !state.active);
    }
  });
}

async function loadPack() {
  const response = await fetch(DATA_URL, { cache: "reload" });
  if (!response.ok) throw new Error(`Could not load challenges.json (${response.status}).`);
  return validatePack(await response.json());
}

function currentRound() {
  return state.rounds[state.index] || null;
}

function learningDifficulty() {
  const value = Number(window.CaatuuLearning?.difficulty?.() || 1);
  return Number.isInteger(value) && value >= 1 && value <= 3 ? value : 1;
}

function currentChallenge() {
  return state.questions[state.questionIndex] || null;
}

function currentQuestion() {
  return currentChallenge()?.candidates[state.candidateIndex] || null;
}

function configureDifficulty() {
  cancelTransition();
  resetSwipe();
  stopSentence();
  state.difficulty = learningDifficulty();
  state.rounds = buildRounds(state.pack, state.difficulty);
  state.index = 0;
  state.questions = buildQuestions(currentRound());
  state.questionIndex = 0;
  state.candidateIndex = 0;
  delete $("#caseCosmosSentence").dataset.challenge;
  state.phase = "question";
  state.answer = null;
}

function renderSentence(question) {
  // Keep the surrounding sentence nodes in place during a noun replacement.
  const sentence = $("#caseCosmosSentence");
  const existing = sentence.querySelector("mark");
  if (sentence.dataset.challenge === `${state.index}:${state.questionIndex}` && existing) {
    existing.textContent = question.czech.slice(question.target.start, question.target.end);
    return;
  }
  const { start, end } = question.target;
  const mark = document.createElement("mark");
  mark.textContent = question.czech.slice(start, end);
  sentence.replaceChildren(question.czech.slice(0, start), mark, question.czech.slice(end));
  sentence.dataset.challenge = `${state.index}:${state.questionIndex}`;
}

function renderRound() {
  const round = currentRound();
  const question = currentQuestion();
  if (!round || !question) return;
  const challenge = currentChallenge();
  const reviewed = state.phase !== "question";
  const mistake = state.phase === "mistake";
  const solved = state.phase === "solved";
  $("#caseCosmosPanel").setAttribute("aria-busy", "false");
  $("#caseCosmosBoard").dataset.state = state.phase;
  $("#caseCosmosNoun").textContent = round.noun;
  renderSentence(question);
  $("#caseCosmosTranslation").textContent = question.english;
  $("#caseCosmosProposedCase").textContent = challenge.case;
  $("#caseCosmosCaseHint").textContent = challenge.question;
  for (const [id, value] of [["#caseCosmosYes", true], ["#caseCosmosNo", false]]) {
    const button = $(id);
    button.disabled = reviewed;
    button.setAttribute("aria-pressed", String(reviewed && state.answer === value));
    button.dataset.result = reviewed && state.answer === value ? (mistake ? "wrong" : "correct") : "";
  }
  $("#caseCosmosFeedback").hidden = !reviewed;
  $("#caseCosmosFeedbackTitle").textContent = !reviewed ? "" : mistake ? "× Not quite — try again" : solved ? "✓ Sentence solved!" : "✓ Good catch!";
  $("#caseCosmosActualCase").textContent = !reviewed ? "" : solved ? `${challenge.case} · ${challenge.form}` : mistake ? "Same sentence, another try" : "Trying the next noun form…";
  $("#caseCosmosExplanation").textContent = !reviewed ? "" : solved
    ? `${challenge.form} fits here: ${challenge.meaning}.`
    : mistake ? (question.matches ? "This form fits. Choose ✓ to complete the sentence." : "This form does not fit. Choose × to try another form.")
      : "The sentence stays — only the highlighted noun changes.";
  syncSpeech();
  syncTransition();
}

function render() {
  const loading = state.phase === "loading";
  $("#caseCosmosPanel").setAttribute("aria-busy", String(loading));
  const error = state.phase === "error";
  if (state.loadingScreen) state.loadingScreen[loading ? "show" : "hide"]();
  else $("#caseCosmosLoading").hidden = !loading;
  $("#caseCosmosBoard").hidden = loading || error;
  $("#caseCosmosInfo").hidden = loading || error;
  $("#caseCosmosError").hidden = !error;
  if (error) {
    $("#caseCosmosPanel").setAttribute("aria-busy", "false");
    $("#caseCosmosErrorCopy").textContent = state.error;
    return;
  }
  if (!loading) renderRound();
}

function chooseAnswer(answer) {
  if (!engaged() || state.menuOpen || state.phase !== "question" || typeof answer !== "boolean") return;
  resetSwipe();
  stopSentence();
  const correct = answer === currentQuestion().matches;
  // Rejects and retries stay within one sentence. Only accepting its correct
  // form completes a round or awards XP; repeated inputs are locked immediately.
  state.answer = answer;
  state.phase = !correct ? "mistake" : answer ? "solved" : "rejecting";
  render();
  $("#caseCosmosExample").focus();
  record({ activities: 1, attempts: 1, successes: correct ? 1 : 0, rounds: correct && answer ? 1 : 0, xp: correct && answer ? 1 : 0 });
  if (!correct) scheduleStep(1800, reopenQuestion);
  else if (!answer) scheduleStep(reducedMotion() ? 450 : 650, () => {
    state.candidateIndex += 1;
    if (!currentQuestion()) { showError(new Error("The noun alternatives ended without a solution.")); return; }
    state.phase = "entering";
    render();
    scheduleStep(reducedMotion() ? 0 : 300, reopenQuestion);
  });
  else scheduleStep(1800, () => {
    announceRoundSuccess();
    void nextRound();
  });
}

function reopenQuestion() {
  state.answer = null;
  state.phase = "question";
  render();
  $("#caseCosmosExample").focus();
}

async function nextRound() {
  if (!engaged() || state.phase !== "solved") return;
  cancelTransition();
  const epoch = state.epoch;
  resetSwipe();
  stopSentence();
  state.phase = "loading";
  render();
  await state.loadingScreen.minimumVisible(850);
  if (state.destroyed || epoch !== state.epoch) return;
  state.questionIndex += 1;
  if (state.questionIndex === state.questions.length) {
    state.index = (state.index + 1) % state.rounds.length;
    state.questions = buildQuestions(currentRound());
    state.questionIndex = 0;
  }
  state.candidateIndex = 0;
  delete $("#caseCosmosSentence").dataset.challenge;
  state.answer = null;
  state.phase = "question";
  render();
  $("#caseCosmosExample").focus();
}

function bindUi() {
  bindCampaignBridge();
  bindSwipes();
  const boat = $("#caseCosmosBoat");
  const artworkFailed = () => { state.artworkAvailable = false; syncIllustrations(); };
  listen(boat, "error", artworkFailed);
  if (boat.complete === true && boat.naturalWidth === 0) artworkFailed();
  listen($("#caseCosmosYes"), "click", () => chooseAnswer(true));
  listen($("#caseCosmosNo"), "click", () => chooseAnswer(false));
  listen($("#caseCosmosSpeak"), "click", () => { void speakSentence(); });
  listen($("#caseCosmosPanel"), "keydown", (event) => {
    if (event.repeat || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey
        || $("#caseCosmosControls").contains(event.target)
        || event.target?.closest?.("input, select, textarea, [contenteditable]")) return;
    const key = String(event.key).toLowerCase();
    if (!["y", "n", "1", "2"].includes(key)) return;
    event.preventDefault();
    chooseAnswer(key === "y" || key === "1");
  });
  listen(window, "caatuu:learning-change", (event) => {
    if (event.detail?.reason !== "difficulty" || !state.pack.length) return;
    configureDifficulty();
    render();
    $("#caseCosmosExample").focus();
  });
  for (const event of ["caatuu:speech-mute-change", "caatuu:speech-pace-change", "caatuu:speech-voice-change"]) {
    listen(state.shell, event, stopSentence);
  }
  listen(document, "visibilitychange", () => {
    if (!engaged()) state.controls?.close();
    syncActivity();
  });
  listen(window, "pagehide", (event) => {
    resetSwipe();
    state.pageHidden = true;
    state.controls?.close();
    syncActivity();
    if (!event.persisted) {
      cancelTransition();
      state.destroyed = true;
      state.controls?.destroy();
      state.loadingScreen?.destroy();
      listeners.forEach((dispose) => dispose());
    }
  });
  listen(window, "pageshow", () => { state.pageHidden = false; syncActivity(); });
}

function showError(error) {
  cancelTransition();
  resetSwipe();
  stopSentence();
  console.error("Case Cosmos failed", error);
  state.error = error?.message || String(error);
  state.phase = "error";
  render();
}

async function init() {
  document.body.classList.toggle("case-cosmos-embedded", window.parent !== window);
  render();
  try {
    mountControls();
    bindUi();
    const pack = await loadPack();
    if (state.destroyed) return;
    state.pack = pack;
    configureDifficulty();
    render();
    window.CaatuuRuntime?.registerServiceWorker?.().catch(() => {});
  } catch (error) {
    if (!state.destroyed) showError(error);
  }
}

init();
