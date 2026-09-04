import {
  agreementAuroraPairMatches,
  agreementAuroraRoundComplete,
  buildAgreementAuroraRounds,
  derangeAgreementAuroraMatches,
  normalizeAgreementAuroraPack
} from "./agreement-aurora-core.mjs?v=agreement-aurora-core-2";
import {
  fetchDeclaredCourseGameJson,
  readEmbeddedCourseProfile
} from "../course-game-content.mjs?v=course-game-content-1";

const GAME_ID = "agreement-aurora";
const RESOURCE_NAME = "agreementAuroraCatalog";
const $ = (selector) => document.querySelector(selector);
const FOCUS_SELECTORS = Object.freeze({
  "learner-base": "#agreementAuroraLearnerBaseOptions button:not(:disabled)",
  target: "#agreementAuroraTargetOptions button:not(:disabled)",
  feedback: "#agreementAuroraFeedback",
  next: "#agreementAuroraNext"
});

const state = {
  course: null,
  shell: null,
  pack: null,
  rounds: [],
  difficulty: 1,
  index: 0,
  phase: "loading",
  targetOrder: [],
  matched: new Set(),
  selectedLearnerBase: "",
  selectedTarget: "",
  wrongLearnerBase: "",
  wrongTarget: "",
  feedback: "",
  feedbackKind: "",
  locked: false,
  active: true,
  timer: 0,
  error: ""
};

function currentRound() {
  return state.rounds[state.index] || null;
}

function setFeedback(text, kind = "") {
  state.feedback = text;
  state.feedbackKind = kind;
}

function presentationCopy(field, values = {}) {
  const template = String(state.pack?.presentation?.[field] || "");
  return template.replace(/\{([a-z][a-zA-Z]*)\}/gu, (placeholder, key) => (
    Object.hasOwn(values, key) ? String(values[key]) : placeholder
  ));
}

export function focusAgreementAuroraElement(destination, root = globalThis.document) {
  const selector = FOCUS_SELECTORS[destination];
  if (!selector || typeof root?.querySelector !== "function") return false;
  const element = root.querySelector(selector);
  element?.focus?.({ preventScroll: true });
  return Boolean(element);
}

function focusNextLearnerBase() {
  return focusAgreementAuroraElement("learner-base");
}

function focusNextTarget() {
  return focusAgreementAuroraElement("target");
}

function learningDifficulty() {
  const value = Number(state.shell?.CaatuuLearning?.difficulty?.() || 1);
  return Number.isInteger(value) && value >= 1 && value <= 3 ? value : 1;
}

function difficultyLabel(level) {
  return presentationCopy("difficultyFallback", { level });
}

function recordLearning(delta) {
  state.shell?.CaatuuLearning?.record?.(GAME_ID, delta);
}

function announceRoundSuccess(round) {
  if (!state.shell || state.shell === globalThis) return;
  state.shell.postMessage({
    source: "caatuu-game",
    type: "round-success",
    gameId: GAME_ID,
    evidence: {
      contentId: state.pack.contentId,
      contentRevision: state.pack.contentRevision,
      challengeId: round.id,
      challengeRevision: round.revision,
      exampleIds: round.matches.map(({ id }) => id)
    }
  }, globalThis.location.origin);
}

function applyDisplay({ theme, fontSize } = {}) {
  const resolvedTheme = theme === "dark" ? "dark" : "light";
  const resolvedFontSize = ["standard", "large", "largest"].includes(fontSize)
    ? fontSize
    : "largest";
  document.documentElement.dataset.theme = resolvedTheme;
  document.documentElement.dataset.fontSize = resolvedFontSize;
  document.documentElement.style.colorScheme = resolvedTheme;
}

function initialDisplay() {
  const root = state.shell?.document?.documentElement;
  return {
    theme: root?.dataset?.theme || "light",
    fontSize: root?.dataset?.fontSize || "largest"
  };
}

function resetRound() {
  state.phase = "matching";
  state.matched = new Set();
  state.selectedLearnerBase = "";
  state.selectedTarget = "";
  state.wrongLearnerBase = "";
  state.wrongTarget = "";
  state.locked = false;
  state.targetOrder = derangeAgreementAuroraMatches(currentRound()?.matches || []);
}

function configureDifficulty() {
  state.difficulty = learningDifficulty();
  state.rounds = buildAgreementAuroraRounds(state.pack, state.difficulty);
  state.index = 0;
  resetRound();
}

function optionClasses(id, side) {
  const names = ["agreement-aurora-option"];
  if (state.matched.has(id)) names.push("is-matched");
  if (side === "learner-base" && state.selectedLearnerBase === id) names.push("is-selected");
  if (side === "target" && state.selectedTarget === id) names.push("is-selected");
  if (side === "learner-base" && state.wrongLearnerBase === id) names.push("is-wrong");
  if (side === "target" && state.wrongTarget === id) names.push("is-wrong");
  return names.join(" ");
}

function createLearnerBaseOption(match) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = optionClasses(match.id, "learner-base");
  button.dataset.learnerBaseId = match.id;
  button.disabled = state.matched.has(match.id) || state.phase === "complete" || state.locked;
  button.setAttribute("aria-pressed", String(state.selectedLearnerBase === match.id));
  button.lang = state.pack.learnerBaseLanguage;

  const axis = document.createElement("strong");
  axis.textContent = match.axisLabel;
  const phrase = document.createElement("span");
  phrase.textContent = match.learnerBaseText;
  button.append(axis, phrase);
  return button;
}

function createTargetOption(match) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = optionClasses(match.id, "target");
  button.dataset.targetId = match.id;
  button.disabled = state.matched.has(match.id) || state.phase === "complete" || state.locked;
  button.setAttribute("aria-pressed", String(state.selectedTarget === match.id));
  button.lang = state.pack.targetLanguage;
  button.textContent = match.targetText;
  return button;
}

function renderOptions(round) {
  const learnerBase = round.matches.map(createLearnerBaseOption);
  const target = state.targetOrder.map(createTargetOption);
  $("#agreementAuroraLearnerBaseOptions").replaceChildren(...learnerBase);
  $("#agreementAuroraTargetOptions").replaceChildren(...target);
}

function renderPatterns(round) {
  const patterns = round.matches.map((match) => {
    const row = document.createElement("p");
    const label = document.createElement("span");
    label.textContent = match.axisLabel;
    const form = document.createElement("strong");
    form.lang = state.pack.targetLanguage;
    form.textContent = match.displayForm;
    row.append(label, form);
    return row;
  });
  $("#agreementAuroraPatterns").replaceChildren(...patterns);
}

function renderRound() {
  const round = currentRound();
  if (!round) return;
  const lesson = state.pack.lesson;

  $("#agreementAuroraPanel").setAttribute("aria-busy", "false");
  $("#agreementAuroraRouteNumber").textContent = String(state.index + 1);
  $("#agreementAuroraRoundTitle").textContent = presentationCopy("roundTitle", {
    round: state.index + 1,
    focus: round.focus.label,
    level: round.difficulty
  });
  $("#agreementAuroraTitle").textContent = lesson.title;
  $("#agreementAuroraInstruction").textContent = lesson.instruction;
  $("#agreementAuroraIdea").textContent = lesson.idea;
  $("#agreementAuroraMatchTitle").textContent = lesson.matchingTitle;
  $("#agreementAuroraLearnerBaseTitle").textContent = lesson.learnerBaseColumnLabel;
  $("#agreementAuroraTargetTitle").textContent = lesson.targetColumnLabel;
  $("#agreementAuroraTargetOptions").lang = state.pack.targetLanguage;
  $("#agreementAuroraProgress").textContent = presentationCopy("progress", {
    round: state.index + 1,
    total: state.rounds.length,
    difficulty: difficultyLabel(state.difficulty)
  });
  renderOptions(round);

  const complete = state.phase === "complete";
  $("#agreementAuroraResult").hidden = !complete;
  if (complete) {
    $("#agreementAuroraResultKicker").textContent = lesson.completeKicker;
    $("#agreementAuroraResultTitle").textContent = round.focus.resultTitle;
    $("#agreementAuroraSummary").textContent = round.focus.summary;
    renderPatterns(round);
  }

  const feedback = $("#agreementAuroraFeedback");
  feedback.textContent = state.feedback;
  feedback.className = `agreement-aurora-feedback${state.feedbackKind ? ` is-${state.feedbackKind}` : ""}`;

  const next = $("#agreementAuroraNext");
  next.hidden = !complete;
  next.textContent = state.index === state.rounds.length - 1
    ? state.pack.presentation.restartLessonLabel
    : state.pack.presentation.nextRoundLabel;
}

function render() {
  const loading = state.phase === "loading";
  const error = state.phase === "error";
  $("#agreementAuroraLoading").hidden = !loading;
  $("#agreementAuroraBoard").hidden = loading || error;
  $("#agreementAuroraFooter").hidden = loading || error;
  $("#agreementAuroraError").hidden = !error;
  if (error) {
    $("#agreementAuroraPanel").setAttribute("aria-busy", "false");
    $("#agreementAuroraErrorCopy").textContent = state.error;
    return;
  }
  if (!loading) renderRound();
}

function clearWrongMatch() {
  globalThis.clearTimeout(state.timer);
  state.timer = globalThis.setTimeout(() => {
    state.selectedLearnerBase = "";
    state.selectedTarget = "";
    state.wrongLearnerBase = "";
    state.wrongTarget = "";
    state.locked = false;
    setFeedback(state.pack.presentation.retryFeedback);
    render();
    focusNextLearnerBase();
  }, 850);
}

function settleMatch() {
  if (!state.selectedLearnerBase || !state.selectedTarget) return;
  const round = currentRound();
  const correct = agreementAuroraPairMatches(state.selectedLearnerBase, state.selectedTarget);
  recordLearning({ activities: 1, attempts: 1, successes: correct ? 1 : 0, xp: correct ? 1 : 0 });

  if (!correct) {
    state.wrongLearnerBase = state.selectedLearnerBase;
    state.wrongTarget = state.selectedTarget;
    state.locked = true;
    setFeedback(state.pack.presentation.wrongFeedback, "wrong");
    render();
    focusAgreementAuroraElement("feedback");
    clearWrongMatch();
    return;
  }

  const matched = round.matches.find(({ id }) => id === state.selectedLearnerBase);
  state.matched.add(matched.id);
  state.selectedLearnerBase = "";
  state.selectedTarget = "";
  setFeedback(presentationCopy("matchedFeedback", {
    axis: matched.axisLabel.toLocaleLowerCase(state.pack.learnerBaseLanguage),
    form: matched.displayForm
  }), "correct");

  if (agreementAuroraRoundComplete(round.matches, state.matched)) {
    state.phase = "complete";
    setFeedback(presentationCopy("completeFeedback", { count: round.matches.length }), "correct");
    recordLearning({ rounds: 1, xp: 1 });
    announceRoundSuccess(round);
  }
  render();
  if (state.phase === "complete") focusAgreementAuroraElement("next");
  else focusNextLearnerBase();
}

function chooseLearnerBase(id) {
  if (state.phase !== "matching" || state.locked || state.matched.has(id)) return;
  state.selectedLearnerBase = id;
  setFeedback(presentationCopy("selectTargetFeedback", {
    targetColumn: state.pack.lesson.targetColumnLabel.toLocaleLowerCase(state.pack.learnerBaseLanguage)
  }));
  render();
  if (!state.selectedTarget) {
    focusNextTarget();
    return;
  }
  settleMatch();
}

function chooseTarget(id) {
  if (state.phase !== "matching" || state.locked || state.matched.has(id)) return;
  state.selectedTarget = id;
  setFeedback(presentationCopy("selectLearnerBaseFeedback", {
    learnerBaseColumn: state.pack.lesson.learnerBaseColumnLabel.toLocaleLowerCase(state.pack.learnerBaseLanguage)
  }));
  render();
  if (!state.selectedLearnerBase) {
    focusNextLearnerBase();
    return;
  }
  settleMatch();
}

function nextRound() {
  if (state.phase !== "complete") return;
  globalThis.clearTimeout(state.timer);
  if (state.index === state.rounds.length - 1) {
    state.rounds = buildAgreementAuroraRounds(state.pack, state.difficulty);
    state.index = 0;
  } else {
    state.index += 1;
  }
  resetRound();
  setFeedback(state.pack.presentation.initialFeedback);
  render();
  focusNextLearnerBase();
}

function bindShellMessages() {
  globalThis.addEventListener("message", (event) => {
    if (event.origin !== globalThis.location.origin || event.source !== state.shell) return;
    if (event.data?.source !== "caatuu-app-shell") return;
    if (event.data.type === "visibility") {
      state.active = Boolean(event.data.active);
      applyDisplay(event.data);
      document.body.toggleAttribute("inert", !state.active);
      document.documentElement.dataset.active = String(state.active);
    } else if (event.data.type === "campaign-advance") {
      nextRound();
    }
  });
}

function bindUi() {
  $("#agreementAuroraPanel").addEventListener("click", (event) => {
    const learnerBase = event.target?.closest?.("button[data-learner-base-id]");
    if (learnerBase) {
      chooseLearnerBase(learnerBase.dataset.learnerBaseId);
      return;
    }
    const target = event.target?.closest?.("button[data-target-id]");
    if (target) chooseTarget(target.dataset.targetId);
  });
  $("#agreementAuroraNext").addEventListener("click", nextRound);
  state.shell?.addEventListener?.("caatuu:learning-change", (event) => {
    if (event.detail?.reason !== "difficulty" || !state.pack) return;
    globalThis.clearTimeout(state.timer);
    configureDifficulty();
    setFeedback(presentationCopy("difficultyChangedFeedback", {
      difficulty: difficultyLabel(state.difficulty)
    }));
    render();
    focusNextLearnerBase();
  });
  bindShellMessages();
}

function configureCoursePresentation() {
  const sourceLocale = state.course.sourceLanguage?.locale || state.course.sourceLanguage?.id || "en";
  document.documentElement.lang = sourceLocale;
  applyDisplay(initialDisplay());
  const routeBase = new URL(`${state.course.routePrefix.replace(/\/$/u, "")}/`, globalThis.location.origin);
  $("#agreementAuroraBack").href = new URL(state.course.routes?.games || "index.html", routeBase).href;
}

function configurePackPresentation() {
  $("#agreementAuroraKicker").textContent = state.pack.lesson.kicker;
  $("#agreementAuroraLoadingText").textContent = state.pack.lesson.loadingText;
  $("#agreementAuroraErrorTitle").textContent = state.pack.presentation.errorTitle;
  $("#agreementAuroraErrorCopy").textContent = state.pack.presentation.errorDetail;
  const back = $("#agreementAuroraBack");
  back.textContent = state.pack.presentation.backLabel;
  back.hidden = false;
  if (state.pack.review.status !== "approved") {
    const review = $("#agreementAuroraReview");
    review.textContent = state.pack.presentation.reviewRequiredLabel;
    review.hidden = false;
  }
}

function showError(error) {
  console.error("Agreement Aurora failed", error);
  state.error = state.pack?.presentation?.errorDetail || "";
  const title = $("#agreementAuroraErrorTitle");
  if (title) title.textContent = state.pack?.presentation?.errorTitle || "Agreement Aurora";
  const back = $("#agreementAuroraBack");
  if (back) back.hidden = !state.pack;
  state.phase = "error";
  render();
}

export async function mountAgreementAurora() {
  state.course = readEmbeddedCourseProfile(globalThis);
  state.shell = globalThis.parent && globalThis.parent !== globalThis ? globalThis.parent : globalThis;
  configureCoursePresentation();
  bindUi();
  render();

  const { document: content } = await fetchDeclaredCourseGameJson(state.course, {
    gameId: GAME_ID,
    resourceName: RESOURCE_NAME,
    runtimeHref: globalThis.location.href
  });
  state.pack = normalizeAgreementAuroraPack(content, {
    courseId: state.course.id,
    targetLanguage: state.course.targetLanguage?.locale,
    learnerBaseLanguage: state.course.sourceLanguage?.locale || state.course.sourceLanguage?.id,
    targetLabel: state.course.targetLanguage?.label || "target-language"
  });
  configurePackPresentation();
  configureDifficulty();
  setFeedback(state.pack.presentation.initialFeedback);
  render();
  return Object.freeze({
    next: nextRound,
    ready: () => state.phase !== "loading" && state.phase !== "error"
  });
}

if (typeof document !== "undefined") {
  mountAgreementAurora()
    .then((controller) => {
      globalThis.CaatuuAgreementAurora = controller;
    })
    .catch(showError);
}
