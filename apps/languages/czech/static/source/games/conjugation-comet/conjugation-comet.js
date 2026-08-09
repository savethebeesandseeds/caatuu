"use strict";

const course = window.CaatuuCourse;
if (!course) throw new Error("Caatuu course profile must load before Conjugation Comet.");

const VERBS_URL = "data/games/conjugation-comet/verbs.json";
const FORM_KEYS = Object.freeze(["1s", "2s", "3s", "1p", "2p", "3p"]);
const FORM_LABELS = Object.freeze({
  "1s": "first person singular",
  "2s": "second person singular",
  "3s": "third person singular",
  "1p": "first person plural",
  "2p": "second person plural",
  "3p": "third person plural"
});
const FORM_BADGES = Object.freeze({
  "1s": "S1",
  "2s": "S2",
  "3s": "S3",
  "1p": "P1",
  "2p": "P2",
  "3p": "P3"
});
const ENGLISH_SUBJECTS = Object.freeze(["you all", "he/she", "they", "you", "we", "it", "I"]);
const ROBOT_KEYMAP_URL = "/assets/robots/keymap.json";
const ROBOT_FALLBACK = "/assets/robots/robot%20(1).png";
const $ = (selector) => document.querySelector(selector);

const state = {
  verbs: [],
  queue: [],
  current: null,
  phase: "loading",
  meaningOptions: [],
  meaningTargetSelected: false,
  meaningMatched: false,
  meaningWrongId: "",
  formOrder: [],
  cueOrder: [],
  selectedFormKey: "",
  selectedCueKey: "",
  matchedFormKeys: new Set(),
  matchedCueKeys: new Set(),
  wrongFormKey: "",
  wrongCueKey: "",
  revealed: false,
  transitionMessage: "Preparing the first challenge…",
  robotPath: ROBOT_FALLBACK,
  robotPathsPromise: null,
  robotCursor: -1,
  transitionToken: 0,
  nextTimer: 0,
  error: ""
};

function shuffle(values) {
  const copy = [...values];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const other = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[other]] = [copy[other], copy[index]];
  }
  return copy;
}

function normalize(value) {
  return String(value || "").trim().toLocaleLowerCase("cs-CZ");
}

function formSurfaces(form) {
  return new Set([form?.cs, ...(Array.isArray(form?.accepted) ? form.accepted : [])]
    .map(normalize)
    .filter(Boolean));
}

function formsAreEquivalent(left, right) {
  const leftSurfaces = formSurfaces(left);
  return [...formSurfaces(right)].some((surface) => leftSurfaces.has(surface));
}

function splitEnglishCue(value) {
  const cue = String(value || "").trim();
  const subject = ENGLISH_SUBJECTS.find((candidate) => (
    cue.toLocaleLowerCase("en").startsWith(`${candidate.toLocaleLowerCase("en")} `)
  ));
  if (!subject) return { subject: cue, verb: "" };
  return {
    subject: cue.slice(0, subject.length),
    verb: cue.slice(subject.length).trim()
  };
}

function record(delta) {
  window.CaatuuLearning?.record?.("conjugation-comet", delta);
}

function validateVerbs(value) {
  if (!Array.isArray(value)) throw new Error("verbs.json must contain an array.");
  const valid = value.filter((verb) => (
    verb
    && typeof verb.infinitive === "string"
    && verb.infinitive.trim()
    && typeof verb.english === "string"
    && verb.english.trim()
    && FORM_KEYS.every((key) => (
      typeof verb.forms?.[key]?.cs === "string"
      && verb.forms[key].cs.trim()
      && typeof verb.forms[key].en === "string"
      && verb.forms[key].en.trim()
    ))
  ));
  if (valid.length < 4) throw new Error("Conjugation Comet needs at least four complete verbs.");
  return valid.map((verb, index) => ({ ...verb, id: `verb-${index}` }));
}

async function loadVerbs() {
  const response = await fetch(VERBS_URL, { cache: "no-cache" });
  if (!response.ok) throw new Error(`Could not load verbs.json (${response.status}).`);
  return validateVerbs(await response.json());
}

function eligibleVerbs() {
  const difficulty = Number(window.CaatuuLearning?.difficulty?.() || 1);
  const eligible = state.verbs.filter((verb) => Number(verb.commonLevel || 1) <= difficulty);
  return eligible.length >= 4 ? eligible : state.verbs;
}

function refillQueue() {
  const previousId = state.current?.id || "";
  state.queue = shuffle(eligibleVerbs());
  if (state.queue.length > 1 && state.queue[0]?.id === previousId) {
    [state.queue[0], state.queue[1]] = [state.queue[1], state.queue[0]];
  }
}

function prepareNextVerb() {
  if (!state.queue.length) refillQueue();
  state.current = state.queue.shift() || state.verbs[0];
  const contrasts = shuffle(eligibleVerbs().filter((verb) => (
    verb.id !== state.current.id
    && normalize(verb.english) !== normalize(state.current.english)
  ))).slice(0, 3);
  if (contrasts.length !== 3) throw new Error("verbs.json needs four distinct English meanings.");

  state.meaningOptions = shuffle([state.current, ...contrasts]);
  state.meaningTargetSelected = false;
  state.meaningMatched = false;
  state.meaningWrongId = "";
  state.formOrder = shuffle(FORM_KEYS);
  state.cueOrder = shuffle(FORM_KEYS);
  state.selectedFormKey = "";
  state.selectedCueKey = "";
  state.matchedFormKeys = new Set();
  state.matchedCueKeys = new Set();
  state.wrongFormKey = "";
  state.wrongCueKey = "";
  state.revealed = false;
  state.phase = "meaning";
}

async function loadRobotPaths() {
  if (!state.robotPathsPromise) {
    state.robotPathsPromise = fetch(ROBOT_KEYMAP_URL, { cache: "force-cache" })
      .then((response) => response.ok ? response.json() : {})
      .then((keymap) => Object.keys(keymap || {}).filter((path) => path.startsWith("/assets/robots/")))
      .catch(() => []);
  }
  return state.robotPathsPromise;
}

async function chooseRobot() {
  const paths = await loadRobotPaths();
  if (!paths.length) return ROBOT_FALLBACK;
  let index = Math.floor(Math.random() * paths.length);
  if (paths.length > 1 && index === state.robotCursor) index = (index + 1) % paths.length;
  state.robotCursor = index;
  return paths[index];
}

function clearNextTimer() {
  window.clearTimeout(state.nextTimer);
  state.nextTimer = 0;
}

async function transition(message, action, milliseconds = 850) {
  clearNextTimer();
  const token = state.transitionToken + 1;
  state.transitionToken = token;
  state.phase = "transition";
  state.transitionMessage = message;
  state.robotPath = ROBOT_FALLBACK;
  render();
  chooseRobot().then((path) => {
    if (state.transitionToken !== token) return;
    state.robotPath = path;
    render();
  });
  await Promise.all([
    Promise.resolve().then(action),
    new Promise((resolve) => window.setTimeout(resolve, milliseconds))
  ]);
  if (state.transitionToken === token) render();
}

function createCard({ text, language, className = "", disabled = false, ariaLabel = "" }) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `verb-match-card${className ? ` ${className}` : ""}`;
  button.disabled = disabled;
  if (language) button.lang = language;
  if (ariaLabel) button.setAttribute("aria-label", ariaLabel);
  const copy = document.createElement("span");
  copy.className = "verb-match-card-copy";
  copy.textContent = text;
  button.append(copy);
  const row = document.createElement("div");
  row.className = "verb-match-card-row";
  row.append(button);
  return { row, button, copy };
}

function setFeedback(selector, text, kind = "") {
  const node = $(selector);
  if (!node) return;
  node.textContent = text;
  node.className = `verb-match-feedback${kind ? ` is-${kind}` : ""}`;
}

function renderMeaning() {
  const targetColumn = $("#verbMeaningTargetColumn");
  const englishColumn = $("#verbMeaningEnglishColumn");
  if (!targetColumn || !englishColumn || !state.current) return;
  const target = createCard({
    text: state.current.infinitive,
    language: course.targetLanguage?.locale || "cs-CZ",
    className: [state.meaningTargetSelected ? "is-selected" : "", state.meaningMatched ? "is-matched" : ""].filter(Boolean).join(" "),
    disabled: state.meaningMatched,
    ariaLabel: `${state.current.infinitive}, Czech verb${state.meaningTargetSelected ? ", selected" : ""}`
  });
  target.button.dataset.meaningTarget = state.current.id;
  targetColumn.replaceChildren(target.row);

  englishColumn.replaceChildren(...state.meaningOptions.map((verb) => {
    const matched = state.meaningMatched && verb.id === state.current.id;
    const card = createCard({
      text: verb.english,
      language: "en",
      className: [
        "verb-match-card-en",
        matched ? "is-matched" : "",
        state.meaningWrongId === verb.id ? "is-wrong" : ""
      ].filter(Boolean).join(" "),
      disabled: state.meaningMatched,
      ariaLabel: `${verb.english}, English meaning${matched ? ", matched" : ""}`
    });
    card.button.dataset.meaningOption = verb.id;
    return card.row;
  }));

  $("#verbMeaningGateBoard").style.setProperty("--verb-pair-count", "4");
  $("#verbMeaningGateBoard").setAttribute("aria-busy", "false");
  $("#verbMeaningGateProgress").textContent = state.meaningMatched ? "1 of 1 matched" : "0 of 1 matched";
  if (state.meaningMatched) setFeedback("#verbMeaningGateFeedback", "Correct. Now match all six forms.", "correct");
  else if (state.meaningWrongId) setFeedback("#verbMeaningGateFeedback", "Not this meaning. Try again.", "wrong");
  else if (state.meaningTargetSelected) setFeedback("#verbMeaningGateFeedback", "Now choose the English meaning.");
  else setFeedback("#verbMeaningGateFeedback", "Select the Czech verb to begin.");
}

function createCueCard(key) {
  const form = state.current.forms[key];
  const cueParts = splitEnglishCue(form.en);
  const card = createCard({
    text: "",
    language: "en",
    className: [
      "verb-match-card-en",
      state.selectedCueKey === key ? "is-selected" : "",
      state.matchedCueKeys.has(key) ? "is-matched" : "",
      state.wrongCueKey === key ? "is-wrong" : "",
      state.revealed && !state.matchedCueKeys.has(key) ? "is-solution" : ""
    ].filter(Boolean).join(" "),
    disabled: state.matchedCueKeys.has(key) || state.revealed,
    ariaLabel: `${form.en}, ${FORM_LABELS[key]}`
  });
  const cue = document.createElement("span");
  cue.className = "conjugation-comet-cue-copy";
  const natural = document.createElement("span");
  natural.className = "conjugation-comet-cue-natural";
  const subject = document.createElement("span");
  subject.className = "conjugation-comet-cue-subject";
  subject.textContent = cueParts.subject;
  natural.append(subject);
  if (cueParts.verb) {
    const verb = document.createElement("span");
    verb.className = "conjugation-comet-cue-verb";
    verb.textContent = ` ${cueParts.verb}`;
    natural.append(verb);
  }
  const label = document.createElement("span");
  label.className = "conjugation-comet-cue-label";
  label.textContent = FORM_BADGES[key];
  label.title = FORM_LABELS[key];
  label.setAttribute("aria-hidden", "true");
  cue.append(natural, label);
  card.copy.replaceWith(cue);
  card.button.dataset.cueKey = key;
  return card;
}

function renderForms() {
  const formsColumn = $("#verbMorphologyFormsColumn");
  const cuesColumn = $("#verbMorphologyCuesColumn");
  if (!formsColumn || !cuesColumn || !state.current) return;

  formsColumn.replaceChildren(...state.formOrder.map((key) => {
    const form = state.current.forms[key];
    const card = createCard({
      text: form.cs,
      language: course.targetLanguage?.locale || "cs-CZ",
      className: [
        state.selectedFormKey === key ? "is-selected" : "",
        state.matchedFormKeys.has(key) ? "is-matched" : "",
        state.wrongFormKey === key ? "is-wrong" : "",
        state.revealed && !state.matchedFormKeys.has(key) ? "is-solution" : ""
      ].filter(Boolean).join(" "),
      disabled: state.matchedFormKeys.has(key) || state.revealed,
      ariaLabel: `${form.cs}, Czech verb form`
    });
    card.button.dataset.formKey = key;
    return card.row;
  }));
  cuesColumn.replaceChildren(...state.cueOrder.map((key) => createCueCard(key).row));

  $("#verbMorphologyBoard").style.setProperty("--verb-pair-count", "6");
  $("#verbMorphologyBoard").setAttribute("aria-busy", "false");
  $("#verbMorphologyLemmaTarget").textContent = state.current.infinitive;
  $("#verbMorphologyGloss").textContent = state.current.english;
  const matches = state.matchedCueKeys.size;
  $("#verbMorphologyProgress").textContent = `${matches} of 6 matched`;
  const complete = matches === FORM_KEYS.length || state.revealed;
  const next = $("#verbMorphologyNextButton");
  next.hidden = !complete;
  next.disabled = !complete;
  next.textContent = "Next verb";
  document.querySelector(".verb-morphology-actions").hidden = false;
  $("#verbMorphologyHintButton").disabled = complete;
  $("#verbMorphologyRevealButton").disabled = complete;

  if (complete) {
    setFeedback("#verbMorphologyFeedback", state.revealed
      ? "Answers shown. Continue with another verb."
      : "All six forms matched. Next verb!", state.revealed ? "" : "correct");
  } else if (state.wrongFormKey || state.wrongCueKey) {
    setFeedback("#verbMorphologyFeedback", "Those do not match. Compare the person and number.", "wrong");
  } else if (state.selectedFormKey || state.selectedCueKey) {
    setFeedback("#verbMorphologyFeedback", "Now choose its match.");
  } else {
    setFeedback("#verbMorphologyFeedback", "Match each Czech form to its English cue.");
  }
}

function render() {
  const transitionVisible = state.phase === "loading" || state.phase === "transition";
  const meaningVisible = state.phase === "meaning";
  const formsVisible = state.phase === "forms";
  const errorVisible = state.phase === "error";
  $("#conjugationCometInterstitial").hidden = !transitionVisible;
  $("#verbMeaningGateBoard").hidden = !meaningVisible;
  $("#verbMeaningGateFooter").hidden = !meaningVisible;
  $("#verbMorphologyBoard").hidden = !formsVisible;
  $("#verbMorphologyFooter").hidden = !formsVisible;
  $("#conjugationCometUnavailable").hidden = !errorVisible;
  $("#conjugationCometRobot").src = state.robotPath;
  $("#conjugationCometInterstitialCopy").textContent = state.transitionMessage;
  if (meaningVisible) renderMeaning();
  if (formsVisible) renderForms();
  if (errorVisible) {
    $("#conjugationCometUnavailableTitle").textContent = "Conjugation Comet could not load";
    const copy = $("#conjugationCometUnavailableTitle")?.nextElementSibling;
    if (copy) copy.textContent = state.error;
  }
}

function handleMeaningTarget() {
  if (state.phase !== "meaning" || state.meaningMatched) return;
  state.meaningTargetSelected = true;
  render();
}

function handleMeaningOption(id) {
  if (state.phase !== "meaning" || state.meaningMatched) return;
  if (!state.meaningTargetSelected) {
    setFeedback("#verbMeaningGateFeedback", "Select the Czech verb first.");
    $("[data-meaning-target]")?.focus();
    return;
  }
  const correct = id === state.current.id;
  record({ activities: 1, attempts: 1, successes: correct ? 1 : 0, xp: correct ? 1 : 0 });
  if (!correct) {
    state.meaningWrongId = id;
    render();
    window.setTimeout(() => {
      if (state.meaningWrongId === id) {
        state.meaningWrongId = "";
        render();
      }
    }, 650);
    return;
  }
  state.meaningMatched = true;
  render();
  window.setTimeout(() => transition("Preparing all six forms…", () => {
    state.phase = "forms";
  }, 700).catch(showError), 550);
}

function clearWrongPair(formKey, cueKey) {
  window.setTimeout(() => {
    if (state.wrongFormKey === formKey) state.wrongFormKey = "";
    if (state.wrongCueKey === cueKey) state.wrongCueKey = "";
    render();
  }, 650);
}

function evaluatePair() {
  if (!state.selectedFormKey || !state.selectedCueKey) return;
  const formKey = state.selectedFormKey;
  const cueKey = state.selectedCueKey;
  // Some Czech paradigms use one visible form for multiple persons. Matching
  // by reviewed surface equivalence makes either identical card a fair answer.
  const correct = formsAreEquivalent(state.current.forms[formKey], state.current.forms[cueKey]);
  record({ activities: 1, attempts: 1, successes: correct ? 1 : 0, xp: correct ? 1 : 0 });
  if (correct) {
    state.matchedFormKeys.add(formKey);
    state.matchedCueKeys.add(cueKey);
    state.selectedFormKey = "";
    state.selectedCueKey = "";
    render();
    if (state.matchedCueKeys.size === FORM_KEYS.length) {
      record({ rounds: 1 });
      clearNextTimer();
      state.nextTimer = window.setTimeout(startNextVerb, 1700);
    }
    return;
  }
  state.wrongFormKey = formKey;
  state.wrongCueKey = cueKey;
  state.selectedFormKey = "";
  state.selectedCueKey = "";
  render();
  clearWrongPair(formKey, cueKey);
}

function selectForm(key) {
  if (state.phase !== "forms" || state.revealed || state.matchedFormKeys.has(key)) return;
  state.selectedFormKey = state.selectedFormKey === key ? "" : key;
  render();
  evaluatePair();
}

function selectCue(key) {
  if (state.phase !== "forms" || state.revealed || state.matchedCueKeys.has(key)) return;
  state.selectedCueKey = state.selectedCueKey === key ? "" : key;
  render();
  evaluatePair();
}

function showHint() {
  const hint = $("#verbMorphologyHint");
  const button = $("#verbMorphologyHintButton");
  const showing = hint.hidden;
  hint.hidden = !showing;
  button.setAttribute("aria-pressed", String(showing));
  $("#verbMorphologyHintCopy").textContent = "Focus on the English subject. S means singular, P means plural, and the number marks the person.";
}

function revealAnswers() {
  if (state.phase !== "forms") return;
  clearNextTimer();
  state.revealed = true;
  state.selectedFormKey = "";
  state.selectedCueKey = "";
  render();
}

function startNextVerb() {
  if (!state.verbs.length) return;
  transition("Choosing another verb…", prepareNextVerb, 850).catch(showError);
}

function bindUi() {
  document.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.dataset.meaningTarget) handleMeaningTarget();
    else if (button.dataset.meaningOption) handleMeaningOption(button.dataset.meaningOption);
    else if (button.dataset.formKey) selectForm(button.dataset.formKey);
    else if (button.dataset.cueKey) selectCue(button.dataset.cueKey);
  });
  $("#verbMorphologyHintButton")?.addEventListener("click", showHint);
  $("#verbMorphologyRevealButton")?.addEventListener("click", revealAnswers);
  $("#verbMorphologyNextButton")?.addEventListener("click", startNextVerb);
  window.addEventListener("caatuu:learning-change", (event) => {
    if (event.detail?.reason === "difficulty" && state.verbs.length) refillQueue();
  });
}

function showError(error) {
  console.error("Conjugation Comet failed", error);
  state.error = error?.message || String(error);
  state.phase = "error";
  render();
}

async function init() {
  bindUi();
  render();
  try {
    state.verbs = await loadVerbs();
    refillQueue();
    await transition("Preparing the first challenge…", prepareNextVerb, 900);
    window.CaatuuRuntime?.registerServiceWorker?.().catch(() => {});
  } catch (error) {
    showError(error);
  }
}

init();
