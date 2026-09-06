import {
  buildGrammarGravityRounds,
  validateGrammarGravityCategories,
  normalizeGrammarGravityPack
} from "./grammar-gravity-core.mjs?v=grammar-gravity-core-4";
import {
  fetchDeclaredCourseGameJson,
  readEmbeddedCourseProfile
} from "../course-game-content.mjs?v=course-game-content-1";
import { mountNounLanding } from "./noun-landing-host.mjs?v=noun-landing-host-17";
import { mountGrammarFlight } from "./adjective-flight-host.mjs?v=grammar-flight-14";
import { mountEmbeddedGameControls, mountRobotLoadingScreen } from "../embedded-game-controls.mjs?v=embedded-game-controls-8";

const GAME_ID = "grammar-gravity";
const RESOURCE_NAME = "grammarGravityCatalog";
const NOUN_SEGMENT_SIZE = 6;
const MODE_TRANSITION_MS = 900;
const $ = (selector) => document.querySelector(selector);
const FOCUS_SELECTORS = Object.freeze({ nouns: "#gravityNounArena", forms: "#gravityAdjectiveArena" });

const state = {
  mode: "loading",
  practiceMode: "sequence",
  meaningOptionCount: 3,
  practiceOptions: [],
  pendingMode: "",
  restoreModeFocus: false,
  nounGame: null,
  adjectiveGame: null,
  course: null,
  shell: null,
  pack: null,
  rounds: [],
  difficulty: 1,
  index: 0,
  phase: "loading",
  active: true,
  timer: 0,
  transitionKind: "",
  transitionRemaining: 0,
  lastTick: null,
  controls: null,
  durationMs: 10000,
  iconsVisible: true,
  destroyed: false,
  pageHidden: false,
  modeLoadingScreen: null,
  phraseLoadingScreen: null,
  error: ""
};
const listeners = [];

function listen(target, event, handler) {
  target?.addEventListener?.(event, handler);
  listeners.push(() => target?.removeEventListener?.(event, handler));
}

function playingFocus() {
  const focused = document.activeElement;
  if ($("#gravityGameHeader")?.contains(focused)) return false;
  return focused === document.body || $("#grammarGravityNounMode").contains(focused)
    || $("#grammarGravityPhraseMode").contains(focused);
}

function cancelTransitionFrame() {
  if (state.timer) globalThis.cancelAnimationFrame(state.timer);
  state.timer = 0;
  state.lastTick = null;
}

function syncLoadingScreens() {
  const active = !state.destroyed && state.active && !document.hidden && !state.pageHidden;
  state.modeLoadingScreen?.setActive(active);
  state.phraseLoadingScreen?.setActive(active && state.mode === "phrases");
}

function syncTransition() {
  syncLoadingScreens();
  if (state.destroyed || !state.active || document.hidden || !["phrases", "transition"].includes(state.mode) || !state.transitionKind) {
    cancelTransitionFrame();
    return;
  }
  if (!state.timer) state.timer = globalThis.requestAnimationFrame(tickTransition);
}

function tickTransition(timestamp) {
  state.timer = 0;
  if (state.destroyed || !state.active || document.hidden || !["phrases", "transition"].includes(state.mode)) {
    state.lastTick = null;
    return;
  }
  const elapsed = state.lastTick === null ? 0 : Math.max(0, timestamp - state.lastTick);
  state.lastTick = timestamp;
  if (Number.isFinite(elapsed) && elapsed <= 1000) state.transitionRemaining -= elapsed;
  if (state.transitionRemaining <= 0) {
    const kind = state.transitionKind;
    state.transitionKind = "";
    cancelTransitionFrame();
    if (kind === "mode") {
      const mode = state.pendingMode;
      state.pendingMode = "";
      enterMode(mode, state.restoreModeFocus && playingFocus());
    }

  } else syncTransition();
}

function startTransition(kind, duration) {
  cancelTransitionFrame();
  state.transitionKind = kind;
  state.transitionRemaining = duration;
  syncTransition();
}

function currentRound() {
  return state.rounds[state.index] || null;
}

export function focusGrammarGravityElement(destination, root = globalThis.document) {
  const selector = FOCUS_SELECTORS[destination];
  if (!selector || typeof root?.querySelector !== "function") return false;
  const element = root.querySelector(selector);
  element?.focus?.({ preventScroll: true });
  return Boolean(element);
}

function learningDifficulty() {
  const value = Number(state.shell?.CaatuuLearning?.difficulty?.() || 1);
  return Number.isInteger(value) && value >= 1 && value <= 3 ? value : 1;
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
      challengeId: round.challengeId,
      challengeRevision: round.challengeRevision,
      exampleIds: round.flights.map(({ id }) => id)
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
  cancelTransitionFrame();
  state.transitionKind = "";
  state.transitionRemaining = 0;
  state.phase = "playing";
}

function startGrammarRound() {
  const round = currentRound();
  if (!round) throw new Error("Grammar Gravity has no modern round for this difficulty.");
  state.adjectiveGame.start(round, round.flights, { practiceMode: state.practiceMode });
}

function makeRounds() {
  return buildGrammarGravityRounds(state.pack, state.difficulty);
}

function configureDifficulty() {
  state.difficulty = learningDifficulty();
  state.rounds = [...makeRounds()];
  state.index = 0;
  resetRound();
  syncPracticeChoices();
}

function syncPracticeChoices() {
  const ready = Boolean(state.pack && state.rounds.length && state.phase !== "error");
  for (const { input, value } of state.practiceOptions) {
    input.checked = value === state.practiceMode;
    input.disabled = value === "nouns" ? !state.nounGame?.ready() : !ready
      || (value === "meaning" && !state.pack.gameplay.stages.includes("meaning"));
  }
}

function enterMode(mode, restoreFocus = false) {
  if (state.destroyed) return;
  selectMode(mode);
  if (mode === "nouns") state.nounGame?.resumeSegment();
  else { startGrammarRound(); render(); }
  if (restoreFocus) {
    if (mode === "nouns") focusGrammarGravityElement("nouns");
    else focusGrammarGravityElement("forms");
  }
}

function changeStage(mode, restoreFocus = playingFocus()) {
  if (state.mode === mode || !state.nounGame?.ready()) {
    enterMode(mode, restoreFocus);
    return;
  }
  state.pendingMode = mode;
  state.restoreModeFocus = restoreFocus;
  selectMode("transition");
  startTransition("mode", MODE_TRANSITION_MS);
}

function choosePracticeMode(value) {
  if (state.destroyed || !["sequence", "meaning", "nouns", "forms"].includes(value) || value === state.practiceMode) return;
  const choice = state.practiceOptions.find((option) => option.value === value);
  if (choice?.input.disabled) return;
  state.practiceMode = value;
  syncPracticeChoices();
  if (value !== "nouns") { state.index = 0; resetRound(); }
  changeStage(value === "nouns" ? "nouns" : "phrases", false);
}

function render() {
  const loading = state.phase === "loading";
  const error = state.phase === "error";
  $("#gravityAdjectiveMode").hidden = loading || error;
  $("#grammarGravityPhraseMode").classList.toggle("has-adjective-flight", !loading && !error);
  if (state.phraseLoadingScreen) state.phraseLoadingScreen[loading ? "show" : "hide"]();
  else $("#grammarGravityLoading").hidden = !loading;
  $("#grammarGravityError").hidden = !error;
  $("#grammarGravityPanel").setAttribute("aria-busy", String(loading));
  placeGravityGameHeader(state.mode, !loading && !error);
  if (error) $("#grammarGravityErrorCopy").textContent = state.error;
}

function nextRound() {
  if (state.mode !== "phrases" || state.phase !== "complete" || !state.active || document.hidden) return;
  const restoreFocus = playingFocus();
  if (state.index === state.rounds.length - 1) {
    const previous = currentRound().flights[0].anchorText;
    state.rounds = [...makeRounds()];
    if (state.rounds.length > 1 && state.rounds[0].flights[0].anchorText === previous) {
      [state.rounds[0], state.rounds[1]] = [state.rounds[1], state.rounds[0]];
    }
    state.index = 0;
  } else state.index += 1;
  resetRound();
  enterMode("phrases", restoreFocus);
}

function finishNounSegment() {
  if (!state.destroyed && state.practiceMode === "nouns") state.nounGame?.resumeSegment();
}

export function placeGravityGameHeader(mode, hasAdjectiveFlight = false, root = globalThis.document) {
  const header = root?.getElementById("gravityGameHeader");
  if (!header) return;
  const adjectives = mode === "phrases" && hasAdjectiveFlight;
  const target = root.getElementById(mode === "nouns" ? "gravityNounArena"
    : adjectives ? "gravityAdjectiveArena" : "grammarGravityPanel");
  if (target && header.parentElement !== target) target.prepend(header);
  const progress = root.getElementById("gravityAdjectiveProgress");
  if (progress) progress.hidden = !adjectives;
}

function selectMode(mode) {
  state.mode = mode;
  $("#grammarGravityPanel").dataset.mode = mode;
  const nouns = mode === "nouns";
  const loading = mode === "loading" || mode === "transition";
  $("#grammarGravityNounMode").hidden = !nouns;
  $("#grammarGravityPhraseMode").hidden = mode !== "phrases";
  if (state.modeLoadingScreen) state.modeLoadingScreen[loading ? "show" : "hide"]();
  else $("#gravityModeLoading").hidden = !loading;
  $("#gravityNounInfo").hidden = loading;
  placeGravityGameHeader(mode, !["loading", "error"].includes(state.phase));
  $("#gravityNounHelp").textContent = nouns
    ? state.shell.CaatuuI18n.t(`games.grammargravity.nouns.${state.durationMs === 0 ? "untimedhelp" : "help"}`)
    : state.shell.CaatuuI18n.t("games.grammargravity.journey.help");
  state.nounGame?.setActive(nouns && state.active);
  state.adjectiveGame?.setActive(mode === "phrases" && state.active && state.phase !== "error");
  if (loading) $("#gravityNounClock").hidden = true;
  syncTransition();
}

function bindShellMessages() {
  listen(globalThis, "message", (event) => {
    if (event.origin !== globalThis.location.origin || event.source !== state.shell) return;
    if (event.data?.source !== "caatuu-app-shell") return;
    if (event.data.type === "visibility") {
      state.active = Boolean(event.data.active);
      state.nounGame?.setActive(state.active && state.mode === "nouns");
      state.adjectiveGame?.setActive(state.active && state.mode === "phrases" && state.phase !== "error");
      applyDisplay(event.data);
      document.body.toggleAttribute("inert", !state.active);
      document.documentElement.dataset.active = String(state.active);
      syncTransition();
    } else if (event.data.type === "campaign-advance") {
      if (state.mode === "nouns") state.nounGame?.next();
      else nextRound();
    }
  });
}

function bindUi() {
  listen(state.shell, "caatuu:learning-change", (event) => {
    if (event.detail?.reason !== "difficulty" || !state.pack || state.phase === "error") return;
    const destination = state.mode === "transition" ? state.pendingMode : state.mode;
    configureDifficulty();
    state.pendingMode = "";
    if (destination === "phrases") enterMode("phrases", playingFocus());
    else if (destination === "nouns") enterMode("nouns");
    render();
  });

  listen(document, "visibilitychange", syncTransition);
  listen(globalThis, "pagehide", (event) => {
    state.pageHidden = true;
    syncLoadingScreens();
    if (event.persisted) cancelTransitionFrame(); else destroy();
  });
  listen(globalThis, "pageshow", () => { state.pageHidden = false; syncTransition(); });
  bindShellMessages();
}

function configureControls() {
  const t = (key, values) => state.shell.CaatuuI18n.t(`games.grammargravity.controls.${key}`, values);
  const countKey = `${state.course.storage?.namespace || state.course.id}.grammarGravity.meaningChoices.v1`;
  try { if (state.shell.localStorage?.getItem(countKey) === "6") state.meaningOptionCount = 6; } catch { /* Session preference still works. */ }
  state.adjectiveGame?.setMeaningOptionCount(state.meaningOptionCount);
  $("#gravityMeaningCountLabel").textContent = t("meaningchoices");
  const countButtons = [3, 6].map((count) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "caatuu-game-control-option";
    button.dataset.count = String(count);
    button.textContent = t("choicecount", { count });
    button.setAttribute("aria-pressed", String(count === state.meaningOptionCount));
    listen(button, "click", () => {
      state.meaningOptionCount = count;
      state.adjectiveGame?.setMeaningOptionCount(count);
      try { state.shell.localStorage?.setItem(countKey, String(count)); } catch { /* Keep the session choice. */ }
      countButtons.forEach((option) => option.setAttribute("aria-pressed", String(option.dataset.count === String(count))));
    });
    return button;
  });
  $("#gravityMeaningCountChoices").replaceChildren(...countButtons);
  $("#gravityPracticeModeLabel").textContent = t("mode");
  $("#gravityPracticeModeChoices").replaceChildren(...["sequence", "meaning", "nouns", "forms"].map((value) => {
    const label = document.createElement("label");
    label.className = "gravity-settings-checkbox";
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "gravity-practice-mode";
    input.value = value;
    state.practiceOptions.push({ input, value });
    const caption = document.createElement("span");
    caption.textContent = t(value);
    label.append(input, caption);
    listen(input, "change", () => { if (input.checked) choosePracticeMode(value); syncPracticeChoices(); });
    return label;
  }));
  syncPracticeChoices();
  $("#gravityFallDurationLabel").textContent = t("falltime");
  $("#gravityAdjectiveTimeHint").textContent = `${t("forms")} ×2`;
  const durationOptions = [];
  $("#gravityFallDurationChoices").replaceChildren(...[5000, 10000, 15000, 20000, 0].map((value) => {
    const label = document.createElement("label");
    label.className = "gravity-settings-checkbox";
    const option = document.createElement("input");
    option.type = "checkbox";
    option.name = "gravity-fall-duration";
    option.value = String(value);
    option.checked = value === state.durationMs;
    durationOptions.push({ input: option, value });
    const caption = document.createElement("span");
    caption.textContent = value === 0 ? "∞" : t("seconds", { count: value / 1000 });
    if (value === 0) {
      caption.setAttribute("aria-hidden", "true");
      option.setAttribute("aria-label", t("infinite"));
      label.title = t("infinite");
    }
    label.append(option, caption);
    listen(option, "change", () => {
      const selected = Number(option.value);
      if (option.checked && [0, 5000, 10000, 15000, 20000].includes(selected)) {
        state.durationMs = selected;
        state.nounGame?.setDurationMs(selected);
        state.adjectiveGame?.setDurationMs(selected);
        if (state.mode === "nouns") $("#gravityNounHelp").textContent = state.shell.CaatuuI18n.t(`games.grammargravity.nouns.${selected === 0 ? "untimedhelp" : "help"}`);
      }
      durationOptions.forEach((choice) => {
        choice.input.value = String(choice.value);
        choice.input.checked = choice.value === state.durationMs;
      });
    });
    return label;
  }));
  state.controls = mountEmbeddedGameControls({
    container: $("#gravityNounControls"), shell: state.shell, course: state.course,
    autoplay: true,
    illustrations: {
      labelKey: "games.grammargravity.controls.illustrations", pressed: state.iconsVisible,
      onChange(value) {
        state.iconsVisible = Boolean(value);
        $("#grammarGravityPanel").dataset.illustrations = state.iconsVisible ? "shown" : "hidden";
        state.nounGame?.setIconsVisible(state.iconsVisible);
        state.adjectiveGame?.setIconsVisible(state.iconsVisible);
      }
    },
    challenge: { content: $("#gravityChallengeSettings"), labelKey: "games.grammargravity.controls.challenge" },
    settings: { content: $("#gravityMeaningSettings"), labelKey: "games.grammargravity.controls.meaningchoices", icon: "boxes" }
  });
}

function destroy() {
  if (state.destroyed) return;
  state.destroyed = true;
  cancelTransitionFrame();
  state.nounGame?.destroy();
  state.adjectiveGame?.destroy();
  state.controls?.destroy();
  state.modeLoadingScreen?.destroy();
  state.phraseLoadingScreen?.destroy();
  listeners.forEach((dispose) => dispose());
}

function configureCoursePresentation() {
  const sourceLocale = state.course.sourceLanguage?.locale || state.course.sourceLanguage?.id || "en";
  document.documentElement.lang = sourceLocale;
  state.shell.CaatuuI18n.apply(document);
  applyDisplay(initialDisplay());
  const routeBase = new URL(`${state.course.routePrefix.replace(/\/$/u, "")}/`, globalThis.location.origin);
  $("#grammarGravityBack").href = new URL(state.course.routes?.games || "index.html", routeBase).href;
}

function configurePackPresentation() {
  $("#grammarGravityErrorTitle").textContent = state.pack.presentation.errorTitle;
  $("#grammarGravityBack").textContent = state.pack.presentation.backLabel;
  $("#grammarGravityBack").hidden = false;
}

function showError(error) {
  console.error("Grammar Gravity failed", error);
  state.error = state.pack?.presentation?.errorDetail || state.shell?.CaatuuI18n?.t("games.grammargravity.unavailable") || "Grammar Gravity is unavailable.";
  state.phase = "error";
  cancelTransitionFrame();
  state.transitionKind = "";
  state.pendingMode = "";
  state.adjectiveGame?.setActive(false);
  // A broken sequence never selects a different game. Nouns stay an explicit choice.
  selectMode(state.practiceMode === "nouns" && state.nounGame?.ready() ? "nouns" : "phrases");
  syncPracticeChoices();
  render();
}

export async function mountGrammarGravity() {
  const controller = Object.freeze({
    next: () => state.mode === "nouns" ? state.nounGame?.next() : nextRound(),
    ready: () => !state.destroyed && (state.mode === "nouns" ? Boolean(state.nounGame?.ready()) : state.phase !== "loading" && state.phase !== "error"),
    destroy
  });
  state.course = readEmbeddedCourseProfile(globalThis);
  state.shell = globalThis.parent && globalThis.parent !== globalThis ? globalThis.parent : globalThis;
  const requestedPractice = state.shell.document?.documentElement?.dataset?.grammarGravityPractice
    || new URL(state.shell.location?.href || globalThis.location.href).searchParams.get("practice") || "sequence";
  const loadingLabel = state.shell.CaatuuI18n.t("games.grammargravity.nouns.loading");
  state.modeLoadingScreen = mountRobotLoadingScreen({
    container: $("#gravityModeLoading"), label: loadingLabel, active: state.active && !document.hidden
  });
  state.phraseLoadingScreen = mountRobotLoadingScreen({
    container: $("#grammarGravityLoading"), label: loadingLabel, active: false
  });
  state.adjectiveGame = mountGrammarFlight({ document, scope: globalThis, shell: state.shell, course: state.course,
    copy: (key, values) => state.shell.CaatuuI18n.t(`games.grammargravity.journey.${key}`, values),
    onAttempt({ correct }) {
      recordLearning({ activities: 1, attempts: 1, successes: correct ? 1 : 0, xp: correct ? 1 : 0 });
    },
    onComplete({ correctCount, total }) {
      state.phase = "complete";
      recordLearning({ rounds: 1, xp: correctCount === total ? 1 : 0 });
      if (correctCount === total) announceRoundSuccess(currentRound());
      nextRound();
    }
  });
  configureCoursePresentation();
  bindUi();
  configureControls();
  selectMode("loading");
  render();
  state.nounGame = await mountNounLanding({ course: state.course, shell: state.shell,
    initialActive: false, mountControls: false, segmentSize: NOUN_SEGMENT_SIZE, onComplete: finishNounSegment });
  if (state.destroyed) { state.nounGame.destroy(); return controller; }
  state.nounGame.setDurationMs(state.durationMs);
  state.nounGame.setIconsVisible(state.iconsVisible);
  syncPracticeChoices();
  selectMode(state.mode);
  if (requestedPractice === "nouns" && state.nounGame.ready()) {
    state.practiceMode = "nouns";
    syncPracticeChoices();
    enterMode("nouns");
  }

  try {
    const { document: content } = await fetchDeclaredCourseGameJson(state.course, {
      gameId: GAME_ID,
      resourceName: RESOURCE_NAME,
      runtimeHref: globalThis.location.href
    });
    if (state.destroyed) return controller;
    state.pack = normalizeGrammarGravityPack(content, {
      courseId: state.course.id,
      targetLanguage: state.course.targetLanguage?.locale,
      learnerBaseLanguage: state.course.sourceLanguage?.locale || state.course.sourceLanguage?.id,
      targetLabel: state.course.targetLanguage?.label || "target-language"
    });
    validateGrammarGravityCategories(state.pack, state.nounGame.snapshot()?.lanes);
    configurePackPresentation();
    configureDifficulty();
    if (!["sequence", "meaning", "nouns", "forms"].includes(requestedPractice)) throw new Error(`Unsupported Grammar Gravity mode: ${requestedPractice}`);
    const choice = state.practiceOptions.find(({ value }) => value === requestedPractice);
    if (choice?.input.disabled) throw new Error(`Unavailable Grammar Gravity mode: ${requestedPractice}`);
    state.practiceMode = requestedPractice;
    syncPracticeChoices();
    if (requestedPractice !== "nouns") enterMode("phrases");
    render();
  } catch (error) {
    if (!state.destroyed) showError(error);
  }

  return controller;
}

if (typeof document !== "undefined") {
  mountGrammarGravity()
    .then((controller) => {
      globalThis.CaatuuGrammarGravity = controller;
    })
    .catch(showError);
}
