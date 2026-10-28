import { createSpeechIcon, mountEmbeddedGameControls, mountRobotLoadingScreen } from "/language-runtime/static/source/games/embedded-game-controls.mjs?v=embedded-game-controls-11";
import { bindHorizontalGesture } from "/language-runtime/static/source/horizontal-gesture.mjs";

import { CZECH_CASES, validatePack, buildRounds, buildQuestions, buildCasePracticeRounds } from "./case-cosmos-content.mjs?v=case-cosmos-content-6";
import { newContentEncounterId } from "../../../../../../language-runtime/static/source/games/content-progression.mjs";
import { assertEnglishCzechCourse } from "./case-cosmos-cs-policy.mjs?v=case-cosmos-policy-2";

const DATA_URL = "data/games/case-cosmos/content.json?v=case-cosmos-data-8";
const CHALLENGES_PER_ROUND = 3;
const BOAT_ARTWORK = [
  "/assets/macaw/cases/floating_boat%20(1).png?v=cases-2",
  "/assets/macaw/cases/floating_boat%20(2).png?v=cases-2",
  "/assets/macaw/cases/floating_boat%20(3).png?v=cases-2",
  "/assets/macaw/cases/floating_boat%20(4).png?v=cases-2",
  "/assets/macaw/cases/floating_boat%20(5).png?v=cases-2",
  "/assets/macaw/cases/floating_boat%20(6).png?v=cases-2",
  "/assets/macaw/cases/floating_boat%20(7).png?v=cases-2",
  "/assets/macaw/cases/floating_boat%20(8).png?v=cases-2",
  "/assets/macaw/cases/floating_boat%20(9).png?v=cases-2"
];
const $ = (selector) => document.querySelector(selector);
const state = {
  pack: [],
  rounds: [],
  difficulty: 1,
  index: 0,
  questions: [],
  questionIndex: 0,
  candidateIndex: 0,
  challengeIndex: 0,
  roundCorrect: 0,
  phase: "loading",
  answer: null,
  shell: null,
  controls: null,
  loadingScreen: null,
  active: !window.frameElement?.closest?.("[data-train-panel]")?.hidden,
  pageHidden: false,
  destroyed: false,
  illustrations: true,
  artworkAvailable: true,
  artwork: "",
  speaking: false,
  pendingAutoplay: false,
  speechRequest: 0,
  continuation: null,
  epoch: 0,
  menuOpen: false,
  error: ""
};
const listeners = [];
let swipeController = null;

function listen(target, type, handler) {
  target.addEventListener(type, handler);
  listeners.push(() => target.removeEventListener(type, handler));
}

function engaged() {
  return state.active && !state.pageHidden && !state.destroyed && !document.hidden;
}

function cancelTransition() {
  state.epoch += 1;
  state.continuation?.clear();
}

function syncTransition() {
  const active = engaged() && !state.menuOpen;
  $("#caseCosmosBoard").dataset.active = String(active);
  state.continuation?.sync();
}

function syncActivity() {
  if (!engaged() || state.menuOpen) { resetSwipe(); stopSentence(); }
  else { syncSpeech(); maybeAutoplay(); }
  syncTransition();
}

function resetSwipe() {
  swipeController?.cancel();
  delete $("#caseCosmosBoard").dataset.swipeAnswer;
}

function bindSwipes() {
  const vessel = $("#caseCosmosVessel");
  swipeController = bindHorizontalGesture({
    surface: vessel, document, window,
    available: () => engaged() && state.phase === "question" && !state.controls?.isOpen(),
    identity: currentQuestion, capturePointer: true, exclude: "#caseCosmosFeedback",
    minDistance: () => Math.max(52, Math.min(96, vessel.getBoundingClientRect().width * 0.15)),
    maxVerticalRatio: 1 / 1.5, verticalCancelDistance: 12, verticalCancelRatio: 1,
    onPreview(direction) {
      if (direction) $("#caseCosmosBoard").dataset.swipeAnswer = direction === "right" ? "yes" : "no";
      else delete $("#caseCosmosBoard").dataset.swipeAnswer;
    },
    onAction: (direction) => chooseAnswer(direction === "right")
  });
  listeners.push(() => swipeController.dispose());
}

function syncSpeech() {
  state.loadingScreen?.setActive(engaged() && !state.menuOpen);
  const button = $("#caseCosmosSpeak");
  const supported = state.shell?.CaatuuCourse?.capabilities?.speech === true;
  button.hidden = !supported;
  button.disabled = !supported || !engaged() || state.menuOpen || !["question", "solved", "mistake", "rejecting"].includes(state.phase)
    || Boolean(state.shell?.CaatuuChrome?.getSpeechMuted?.());
  button.replaceChildren(createSpeechIcon(document, { stop: state.speaking }));
  const label = state.shell?.CaatuuI18n?.t(`games.grammargravity.nouns.${state.speaking ? "stopsound" : "hear"}`,
    { word: speechText() }) || "Hear noun form";
  button.setAttribute("aria-label", label);
  button.title = label;
}

function speechText() {
  return (state.phase === "mistake" ? currentChallenge()?.czech : currentQuestion()?.czech) || "";
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
  syncTransition();
}

async function speakSentence() {
  const api = state.shell?.CaatuuChrome;
  if (!engaged() || state.menuOpen || !["question", "solved", "mistake", "rejecting"].includes(state.phase)
      || state.shell?.CaatuuCourse?.capabilities?.speech !== true
      || api?.getSpeechMuted?.() || !currentQuestion()?.czech) return;
  state.pendingAutoplay = false;
  if (state.speaking) { stopSentence(); return; }
  const request = ++state.speechRequest;
  const text = speechText();
  state.speaking = true;
  syncSpeech();
  syncTransition();
  try {
    await api.stopSpeech();
    if (request !== state.speechRequest || !engaged() || api.getSpeechMuted()) return;
    await api.speakText(text);
  } catch { /* Keep manual pronunciation optional when no voice is available. */ }
  finally {
    if (request === state.speechRequest && !state.destroyed) {
      state.speaking = false;
      syncSpeech();
      syncTransition();
    }
  }
}

function maybeAutoplay() {
  if (!state.pendingAutoplay || state.phase !== "question" || state.speaking
      || !engaged() || state.menuOpen || !state.shell?.CaatuuChrome?.getSpeechAutoplay?.()
      || state.shell.CaatuuChrome.getSpeechMuted?.()
      || state.shell.CaatuuCourse?.capabilities?.speech !== true) return;
  void speakSentence();
}

function syncIllustrations() {
  resetSwipe();
  $("#caseCosmosPanel").classList.toggle("case-cosmos-illustrations-off", !state.illustrations);
  $("#caseCosmosPanel").classList.toggle("case-cosmos-boat-layout", state.illustrations && state.artworkAvailable);
}

function selectBoatArtwork() {
  const options = BOAT_ARTWORK.filter(path => path !== state.artwork);
  state.artwork = options[Math.floor(Math.random() * options.length)];
  $("#caseCosmosBoat").setAttribute("src", state.artwork);
}

function mountControls() {
  const shell = window.parent !== window ? window.parent : window;
  if (shell.location.origin !== window.location.origin) {
    throw new Error("Case Cosmos requires its same-origin application shell.");
  }
  assertEnglishCzechCourse(shell.CaatuuCourse);
  state.shell = shell;
  state.continuation = shell.CaatuuPracticePacing.createReviewContinuation({
    button: $("#caseCosmosNext"), i18n: shell.CaatuuI18n,
    canContinue: () => engaged() && !state.menuOpen,
    onContinue() {
      if (state.phase === "rejecting") {
        stopSentence();
        state.candidateIndex += 1;
        if (!currentQuestion()) { showError(new Error("The noun alternatives ended without a solution.")); return; }
        reopenQuestion();
      } else {
        if (roundComplete()) {
          announceRoundCompletion();
          if (shell.document.body?.dataset.campaignActive === "true") return;
        }
        void nextRound();
      }
    }
  });
  state.loadingScreen = mountRobotLoadingScreen({
    container: $("#caseCosmosLoading"), label: shell.CaatuuI18n.t("verbnebula.round.preparing"), active: engaged()
  });
  state.controls = mountEmbeddedGameControls({
    container: $("#caseCosmosControls"), shell, course: shell.CaatuuCourse,
    autoplay: true,
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

function roundComplete() {
  return state.challengeIndex === CHALLENGES_PER_ROUND - 1 && ["solved", "mistake"].includes(state.phase);
}

function announceRoundCompletion() {
  if (window.parent === window) return;
  window.parent.postMessage({
    source: "caatuu-game",
    type: state.roundCorrect > 0 ? "round-success" : "round-complete",
    gameId: "case-cosmos"
  }, window.location.origin);
}

function bindCampaignBridge() {
  if (window.parent === window) return;
  listen(window, "message", (event) => {
    if (event.origin !== window.location.origin || event.source !== window.parent) return;
    if (event.data?.source !== "caatuu-app-shell") return;
    if (event.data.type === "campaign-advance" && roundComplete()) nextRound({ campaignAdvance: true });
    else if (event.data.type === "visibility") {
      state.active = Boolean(event.data.active);
      if (!engaged()) state.controls?.close();
      syncActivity();
      document.body.toggleAttribute("inert", !state.active);
      if (state.active && roundComplete() && !state.continuation?.pending
          && state.shell.document.body?.dataset.campaignActive !== "true") void nextRound();
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
  const value = Number(window.CaatuuLearning?.difficulty?.() ?? 1);
  return Number.isInteger(value) && value >= 0 && value <= 3 ? value : 1;
}

function currentChallenge() {
  return state.questions[state.questionIndex] || null;
}

function currentQuestion() {
  return currentChallenge()?.candidates[state.candidateIndex] || null;
}

function makePracticeRounds() {
  const learning = window.CaatuuLearning;
  return learning?.contentHistory
    ? buildCasePracticeRounds(state.pack, state.difficulty, { history: learning.contentHistory("case-cosmos"),
      policy: learning.samplingContext?.("case-cosmos") })
    : buildRounds(state.pack, state.difficulty);
}

function questionsForRound() {
  return currentRound().practiceQuestions || buildQuestions(currentRound());
}

function configureDifficulty() {
  cancelTransition();
  resetSwipe();
  stopSentence();
  state.difficulty = learningDifficulty();
  state.rounds = makePracticeRounds();
  state.index = 0;
  state.questions = questionsForRound();
  state.encounterId = newContentEncounterId();
  state.contentGeneration = window.CaatuuLearning?.contentGeneration?.() ?? null;
  state.questionIndex = 0;
  state.candidateIndex = 0;
  state.challengeIndex = 0;
  state.roundCorrect = 0;
  delete $("#caseCosmosSentence").dataset.challenge;
  state.phase = "question";
  state.answer = null;
  state.pendingAutoplay = true;
  selectBoatArtwork();
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
  $("#caseCosmosProgress").textContent = `${state.challengeIndex + 1} / ${CHALLENGES_PER_ROUND}`;
  $("#caseCosmosProgress").setAttribute("aria-label", `Challenge ${state.challengeIndex + 1} of ${CHALLENGES_PER_ROUND}`);
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
  $("#caseCosmosFeedbackTitle").textContent = !reviewed ? "" : mistake ? "× Not quite" : solved ? "✓ Sentence solved!" : "✓ Good catch!";
  $("#caseCosmosActualCase").textContent = !reviewed ? "" : mistake ? challenge.czech : solved ? `${challenge.case} · ${challenge.form}` : `“${question.form}” does not fit here.`;
  $("#caseCosmosExplanation").textContent = !reviewed ? "" : solved
    ? `${challenge.form} fits here: ${challenge.meaning}.`
    : mistake ? `${question.matches ? "The sentence was already correct." : `The shown form “${question.form}” does not fit here.`} ${challenge.case}: ${challenge.form}. ${challenge.meaning}.`
      : "Continue to try the next noun form in this sentence.";
  if (reviewed && !state.continuation?.pending) state.continuation?.show();
  else if (!reviewed) state.continuation?.clear();
  syncSpeech();
  syncTransition();
  maybeAutoplay();
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
  // A mistake ends this challenge. The correction is review-only and cannot
  // turn a failed attempt into a later success on the same sentence.
  state.answer = answer;
  state.phase = !correct ? "mistake" : answer ? "solved" : "rejecting";
  if (correct && answer) state.roundCorrect += 1;
  if (!correct || answer) window.CaatuuLearning?.recordExposure?.("case-cosmos", {
    itemId: currentChallenge().id, encounterId: state.encounterId, generation: state.contentGeneration, correct,
    evidence: state.candidateIndex === 0 ? "independent" : "assisted"
  });
  render();
  $("#caseCosmosExample").focus();
  record({ activities: 1, attempts: 1, successes: correct ? 1 : 0,
    rounds: roundComplete() && state.roundCorrect > 0 ? 1 : 0, xp: correct && answer ? 1 : 0 });
  $("#caseCosmosNext").focus();
}

function reopenQuestion() {
  state.answer = null;
  state.phase = "question";
  state.pendingAutoplay = true;
  render();
  $("#caseCosmosExample").focus();
}

async function nextRound({ campaignAdvance = false } = {}) {
  if (state.continuation?.pending || (!campaignAdvance && (!engaged() || state.menuOpen))
      || (campaignAdvance && !roundComplete())
      || !["solved", "mistake"].includes(state.phase)) return;
  cancelTransition();
  resetSwipe();
  stopSentence();
  selectBoatArtwork();
  state.challengeIndex = (state.challengeIndex + 1) % CHALLENGES_PER_ROUND;
  if (state.challengeIndex === 0) state.roundCorrect = 0;
  state.questionIndex += 1;
  if (state.questionIndex === state.questions.length) {
    state.index += 1;
    if (state.index === state.rounds.length) {
      state.rounds = makePracticeRounds();
      state.index = 0;
    }
    state.questions = questionsForRound();
    state.questionIndex = 0;
  }
  state.encounterId = newContentEncounterId();
  state.contentGeneration = window.CaatuuLearning?.contentGeneration?.() ?? null;
  state.candidateIndex = 0;
  delete $("#caseCosmosSentence").dataset.challenge;
  state.answer = null;
  state.phase = "question";
  state.pendingAutoplay = true;
  render();
  if (!campaignAdvance) $("#caseCosmosExample").focus();
}

function bindUi() {
  bindCampaignBridge();
  bindSwipes();
  const boat = $("#caseCosmosBoat");
  const artworkFailed = () => { state.artworkAvailable = false; syncIllustrations(); };
  listen(boat, "error", artworkFailed);
  listen(boat, "load", () => {
    if (!state.artworkAvailable) { state.artworkAvailable = true; syncIllustrations(); }
  });
  if (boat.complete === true && boat.naturalWidth === 0) artworkFailed();
  listen($("#caseCosmosYes"), "click", () => chooseAnswer(true));
  listen($("#caseCosmosNo"), "click", () => chooseAnswer(false));
  listen($("#caseCosmosSpeak"), "click", () => { void speakSentence(); });
  listen($("#caseCosmosPanel"), "keydown", (event) => {
    if (event.defaultPrevented || event.isComposing || event.keyCode === 229
        || event.repeat || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey
        || $("#caseCosmosControls").contains(event.target)
        || event.target?.closest?.("input, select, textarea, [contenteditable]")) return;
    const key = String(event.key).toLowerCase();
    if (!["y", "n", "1", "2"].includes(key)) return;
    event.preventDefault();
    chooseAnswer(key === "y" || key === "1");
  });
  listen(state.shell, "caatuu:learning-change", (event) => {
    if (event.detail?.reason !== "difficulty" || !(state.pack.length || state.pack.contexts?.length)) return;
    configureDifficulty();
    render();
    if (engaged()) $("#caseCosmosExample").focus({ preventScroll: true });
  });
  for (const event of ["caatuu:speech-mute-change", "caatuu:speech-pace-change", "caatuu:speech-voice-change"]) {
    listen(state.shell, event, () => { stopSentence(); maybeAutoplay(); });
  }
  listen(state.shell, "caatuu:speech-autoplay-change", () => {
    state.pendingAutoplay = state.shell.CaatuuChrome.getSpeechAutoplay();
    if (state.pendingAutoplay) maybeAutoplay();
    else stopSentence();
  });
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
      state.continuation?.destroy();
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
