import { isChildFacingMacawActionAssetAllowed } from "../../shared/child-facing-assets.mjs?v=child-facing-assets-1";

"use strict";

const course = window.CaatuuCourse;
if (!course) throw new Error("Caatuu course profile must load before Conjugation Comet.");

const VERBS_URL = "data/games/conjugation-comet/verbs.json?v=conjugation-comet-verbs-4";
const ENGLISH_SUBJECTS = Object.freeze(["you all", "he/she", "they", "you", "she", "he", "we", "it", "I"]);
const AM_ENDINGS = Object.freeze({
  S1: "ám",
  S2: "áš",
  S3: "á",
  P1: "áme",
  P2: "áte",
  P3: "ají"
});
const FORM_GUIDE = Object.freeze({
  S1: { person: "first-person singular", subject: "I" },
  S2: { person: "second-person singular", subject: "you" },
  S3: { person: "third-person singular", subject: "he / she / it" },
  P1: { person: "first-person plural", subject: "we" },
  P2: { person: "second-person plural or formal", subject: "you all / formal you" },
  P3: { person: "third-person plural", subject: "they" }
});
const PILOT_TRAINING_COUNT = 5;
const ROBOT_KEYMAP_URL = "/assets/robots/keymap.json";
const ROBOT_FALLBACK = "/assets/robots/robot%20(1).png";
const SOLUTION_ROUTE_COLORS = ["#b84e45", "#23856f", "#af741f", "#3977ad", "#825f9e", "#267f94"];
const SOLUTION_REVEAL_BASE_MILLIS = 1400;
const SOLUTION_REVEAL_MILLIS_PER_PAIR = 450;
const COMPLETED_ROUND_HOLD_MILLIS = 1100;
const MACAW_KEYMAP_URL = "/assets/macaw/actions/keymaps.json";
const MACAW_FALLBACK = "/assets/macaw/actions/macaw (71).png";
const MACAW_LOOKUP_TIMEOUT_MILLIS = 6000;
const MACAW_STOPWORDS = new Set(["a", "an", "and", "be", "by", "for", "from", "in", "into", "of", "on", "or", "the", "to", "with"]);
const PRONOUN_IMAGE_BASE = "/assets/macaw/pronouns";
const PRONOUN_SPRITE_WIDTH = 2437;
const PRONOUN_SPRITE_HEIGHT = 1027;
const PRONOUN_SPRITE_SHEETS = Object.freeze([
  "v1.png",
  "v2-formal-gala.png",
  "v3-costume-party.png",
  "v4-retro-vacation.png",
  "v5-chaotic-chefs.png",
  "v6-rainy-day.png",
  "v7-homemade-heroes.png",
  "v8-disco-fever.png",
  "v9-pajama-party.png",
  "v10-garden-club.png",
  "v11-steampunk-finale.png",
  "v12-chaotic-orchestra.png",
  "v13-circus-troupe.png",
  "v14-winter-festival.png"
]);
const SPEAK_ON_SELECT_STORAGE_KEY = `${course.storage.namespace}.conjugationComet.speakOnSelect.v1`;
const LEGACY_SPEAK_AT_START_STORAGE_KEY = `${course.storage.namespace}.conjugationComet.speakAtStart.v1`;
const LEGACY_SPEAK_ON_TAP_STORAGE_KEY = `${course.storage.namespace}.conjugationComet.speakOnTap.v1`;
const MEANING_LAYOUT_STORAGE_KEY = `${course.storage.namespace}.conjugationComet.meaningLayout.v1`;
const MEANING_HINT_STORAGE_KEY = `${course.storage.namespace}.conjugationComet.meaningHintVisible.v1`;
const MORPHOLOGY_HINT_STORAGE_KEY = `${course.storage.namespace}.conjugationComet.morphologyHintsVisible.v1`;
const $ = (selector) => document.querySelector(selector);
const meaningImageCache = new Map();
const pronounSpriteCropCache = new Map();
let macawKeymapPromise = null;

const state = {
  verbs: [],
  pilot: null,
  queue: [],
  current: null,
  meaningKnown: new Set(),
  speakOnSelect: loadSpeakOnSelect(),
  phase: "loading",
  meaningOptions: [],
  meaningMatched: false,
  meaningWrongId: "",
  meaningHintVisible: loadMeaningHintVisible(),
  meaningLayout: loadMeaningLayout(),
  meaningImage: null,
  meaningImageRequestId: 0,
  exerciseForms: [],
  formOrder: [],
  cueOrder: [],
  selectedFormKey: "",
  selectedCueKey: "",
  matchedFormKeys: new Set(),
  matchedCueKeys: new Set(),
  wrongFormKey: "",
  wrongCueKey: "",
  pronounSpriteSheet: PRONOUN_SPRITE_SHEETS[0],
  morphologyHintsVisible: loadMorphologyHintsVisible(),
  revealed: false,
  solutionArrowsReady: false,
  roundRecorded: false,
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

function shuffleAwayFrom(reference) {
  const values = [...reference];
  if (values.length < 2) return values;
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const candidate = shuffle(values);
    if (candidate.every((value, index) => value !== reference[index])) return candidate;
  }
  return [...values.slice(1), values[0]];
}

function normalize(value) {
  return String(value || "").trim().toLocaleLowerCase("cs-CZ");
}

function formForLabel(verb, label) {
  return verb?.forms?.find((form) => form.label === label) || null;
}

function matchesAmEndings(verb) {
  return Object.entries(AM_ENDINGS).every(([label, ending]) => (
    normalize(formForLabel(verb, label)?.form).endsWith(ending)
  ));
}

function buildPilot(verbs) {
  const imperfective = (verb) => normalize(verb.hint).startsWith("imperfective.");
  const training = verbs.filter((verb) => (
    imperfective(verb)
    && normalize(verb.verb).endsWith("at")
    && !normalize(verb.verb).includes(" ")
    && matchesAmEndings(verb)
  )).slice(0, PILOT_TRAINING_COUNT);
  const transfer = verbs.find((verb) => (
    imperfective(verb)
    && normalize(verb.verb).endsWith("át")
    && !normalize(verb.verb).includes(" ")
    && matchesAmEndings(verb)
    && !training.includes(verb)
  ));
  if (training.length !== PILOT_TRAINING_COUNT || !transfer) {
    throw new Error("The -ám pilot needs five training verbs and one held-out transfer verb.");
  }
  return { training, transfer };
}

function splitAmForm(form) {
  const ending = AM_ENDINGS[form?.label] || "";
  const surface = String(form?.form || "");
  return {
    stem: ending && normalize(surface).endsWith(ending) ? surface.slice(0, -ending.length) : surface,
    ending
  };
}

function currentPilotPosition() {
  return Math.max(0, pilotVerbs().indexOf(state.current)) + 1;
}

function isHeldOutVerb() {
  return state.current === state.pilot?.transfer;
}

function familySummary(verb) {
  const { stem } = splitAmForm(formForLabel(verb, "S1"));
  const endings = Object.values(AM_ENDINGS).map((ending) => `-${ending}`).join(", ");
  return `Forms beginning with ${stem}- follow ${endings}.`;
}

function formSurfaces(form) {
  return new Set([form?.form, ...(Array.isArray(form?.accepted) ? form.accepted : [])]
    .map(normalize)
    .filter(Boolean));
}

function formsAreEquivalent(left, right) {
  const leftSurfaces = formSurfaces(left);
  return [...formSurfaces(right)].some((surface) => leftSurfaces.has(surface));
}

function genderCueKind(form) {
  const cue = String(form?.cue || "").trim().toLocaleLowerCase("en");
  if (form?.label !== "S3") return "";
  if (cue.startsWith("he ")) return "he";
  if (cue.startsWith("she ")) return "she";
  return "";
}

function formsCanMatch(formKey, cueKey) {
  if (formKey === cueKey) return true;
  const form = exerciseFormForKey(formKey);
  const cue = exerciseFormForKey(cueKey);
  if (genderCueKind(form) || genderCueKind(cue)) return false;
  return formsAreEquivalent(form, cue);
}

function czechSubjectForForm(form) {
  if (form?.label === "S1") return "já";
  if (form?.label === "S2") return "ty";
  if (form?.label === "P1") return "my";
  if (form?.label === "P2") return "vy";
  if (form?.label === "P3") return "oni";
  if (form?.label === "S3") return genderCueKind(form) === "she" ? "ona" : "on";
  return "";
}

function czechFormDisplay(form) {
  const surface = String(form?.form || "").trim();
  return [czechSubjectForForm(form), surface].filter(Boolean).join(" ");
}

function createCzechFormCopy(form) {
  const copy = element("span", "conjugation-comet-form-copy");
  copy.append(
    element("span", "conjugation-comet-form-subject", czechSubjectForForm(form)),
    element("span", "conjugation-comet-form-verb", String(form?.form || "").trim())
  );
  return copy;
}

function buildExerciseForms(verb) {
  return (verb?.forms || []).flatMap((form, index) => {
    const key = String(index);
    const cue = String(form?.cue || "").trim();
    if (form?.label !== "S3" || !/^he\/she\s+/i.test(cue)) return [{ ...form, key }];
    const predicate = cue.replace(/^he\/she\s+/i, "");
    return [
      { ...form, key: `${key}:he`, cue: `he ${predicate}` },
      { ...form, key: `${key}:she`, cue: `she ${predicate}` }
    ];
  });
}

function exerciseFormForKey(key) {
  return state.exerciseForms.find((form) => form.key === key) || null;
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

function announceRoundSuccess() {
  if (window.parent === window) return;
  window.parent.postMessage({
    source: "caatuu-game",
    type: "round-success",
    gameId: "conjugation-comet"
  }, window.location.origin);
}

function validateVerbs(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("verbs.json must contain a language and a verbs array.");
  }
  if (typeof value.language !== "string" || !value.language.trim()) {
    throw new Error("verbs.json needs a language.");
  }
  if (!Array.isArray(value.verbs) || value.verbs.length < 4) {
    throw new Error("Conjugation Comet needs at least four complete verbs.");
  }
  value.verbs.forEach((verb, verbIndex) => {
    if (!verb || typeof verb.verb !== "string" || !verb.verb.trim()) {
      throw new Error(`Verb ${verbIndex + 1} needs a verb.`);
    }
    if (typeof verb.meaning !== "string" || !verb.meaning.trim()) {
      throw new Error(`${verb.verb} needs a meaning.`);
    }
    if (!Array.isArray(verb.forms) || verb.forms.length < 2) {
      throw new Error(`${verb.verb} needs at least two forms.`);
    }
    const labels = new Set();
    verb.forms.forEach((form, formIndex) => {
      const location = `${verb.verb}, form ${formIndex + 1}`;
      if (!form || typeof form.label !== "string" || !form.label.trim()) {
        throw new Error(`${location} needs a label.`);
      }
      if (labels.has(form.label)) throw new Error(`${verb.verb} repeats the label ${form.label}.`);
      labels.add(form.label);
      if (typeof form.form !== "string" || !form.form.trim()) {
        throw new Error(`${location} needs a form.`);
      }
      if (typeof form.cue !== "string" || !form.cue.trim()) {
        throw new Error(`${location} needs a cue.`);
      }
      if (form.accepted !== undefined && (
        !Array.isArray(form.accepted)
        || form.accepted.some((accepted) => typeof accepted !== "string" || !accepted.trim())
      )) throw new Error(`${location} has an invalid accepted list.`);
    });
  });
  return value.verbs;
}

async function loadVerbs() {
  const response = await fetch(VERBS_URL, { cache: "no-cache" });
  if (!response.ok) throw new Error(`Could not load verbs.json (${response.status}).`);
  return validateVerbs(await response.json());
}

function pilotVerbs() {
  return state.pilot ? [...state.pilot.training, state.pilot.transfer] : state.verbs;
}

function refillQueue() {
  state.queue = pilotVerbs();
}

function choosePronounSpriteSheet() {
  const alternatives = PRONOUN_SPRITE_SHEETS.filter((file) => file !== state.pronounSpriteSheet);
  return alternatives[Math.floor(Math.random() * alternatives.length)] || PRONOUN_SPRITE_SHEETS[0];
}

function prepareNextVerb() {
  if (!state.queue.length) refillQueue();
  state.current = state.queue.shift() || state.verbs[0];
  const contrasts = shuffle(pilotVerbs().filter((verb) => (
    verb !== state.current
    && normalize(verb.meaning) !== normalize(state.current.meaning)
  ))).slice(0, 3);
  if (contrasts.length !== 3) throw new Error("verbs.json needs four distinct English meanings.");

  state.meaningOptions = shuffle([state.current, ...contrasts]);
  state.meaningMatched = false;
  state.meaningWrongId = "";
  state.meaningImage = null;
  state.meaningImageRequestId += 1;
  state.exerciseForms = buildExerciseForms(state.current);
  const formKeys = state.exerciseForms.map((form) => form.key);
  state.formOrder = shuffle(formKeys);
  state.cueOrder = shuffleAwayFrom(state.formOrder);
  state.selectedFormKey = "";
  state.selectedCueKey = "";
  state.matchedFormKeys = new Set();
  state.matchedCueKeys = new Set();
  state.wrongFormKey = "";
  state.wrongCueKey = "";
  state.pronounSpriteSheet = choosePronounSpriteSheet();
  state.revealed = false;
  state.solutionArrowsReady = false;
  state.roundRecorded = false;
  state.phase = state.meaningKnown.has(state.current.verb) ? "forms" : "meaning";
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

function solutionRevealDuration(pairCount) {
  return SOLUTION_REVEAL_BASE_MILLIS + (Math.max(1, Number(pairCount) || 1) * SOLUTION_REVEAL_MILLIS_PER_PAIR);
}

function scheduleNextVerb(milliseconds) {
  if (state.nextTimer) return;
  state.nextTimer = window.setTimeout(() => {
    state.nextTimer = 0;
    if (state.phase !== "forms") return;
    const complete = state.revealed || state.matchedCueKeys.size === state.exerciseForms.length;
    if (complete) startNextVerb();
  }, milliseconds);
}

async function transition(message, action, milliseconds = 1000) {
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
    const robot = $("#conjugationCometRobot");
    if (robot && robot.getAttribute("src") !== path) robot.src = path;
  });
  await Promise.all([
    Promise.resolve().then(action),
    new Promise((resolve) => window.setTimeout(resolve, milliseconds))
  ]);
  if (state.transitionToken === token) {
    render();
  }
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

function element(tag, className = "", text = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function loadSpeakOnSelect() {
  try {
    const current = window.localStorage.getItem(SPEAK_ON_SELECT_STORAGE_KEY);
    if (current !== null) return current === "true";
    const legacyStart = window.localStorage.getItem(LEGACY_SPEAK_AT_START_STORAGE_KEY);
    if (legacyStart !== null) return legacyStart === "true";
    const legacyTap = window.localStorage.getItem(LEGACY_SPEAK_ON_TAP_STORAGE_KEY);
    return legacyTap === null ? true : legacyTap === "true";
  } catch (error) {
    return true;
  }
}

function saveSpeakOnSelect() {
  try {
    window.localStorage.setItem(SPEAK_ON_SELECT_STORAGE_KEY, String(state.speakOnSelect));
  } catch (error) {
    // The preference remains active for this session when storage is unavailable.
  }
}

function loadMeaningLayout() {
  try {
    return window.localStorage.getItem(MEANING_LAYOUT_STORAGE_KEY) === "stacked" ? "stacked" : "split";
  } catch (error) {
    return "split";
  }
}

function saveMeaningLayout() {
  try {
    window.localStorage.setItem(MEANING_LAYOUT_STORAGE_KEY, state.meaningLayout);
  } catch (error) {
    // The preference remains active for this session when storage is unavailable.
  }
}

function loadMeaningHintVisible() {
  try {
    const stored = window.localStorage.getItem(MEANING_HINT_STORAGE_KEY);
    return stored === null ? true : stored === "true";
  } catch (error) {
    return true;
  }
}

function saveMeaningHintVisible() {
  try {
    window.localStorage.setItem(MEANING_HINT_STORAGE_KEY, String(state.meaningHintVisible));
  } catch (error) {
    // The preference remains active for this session when storage is unavailable.
  }
}

function loadMorphologyHintsVisible() {
  try {
    const stored = window.localStorage.getItem(MORPHOLOGY_HINT_STORAGE_KEY);
    return stored === null ? true : stored === "true";
  } catch (error) {
    return true;
  }
}

function saveMorphologyHintsVisible() {
  try {
    window.localStorage.setItem(MORPHOLOGY_HINT_STORAGE_KEY, String(state.morphologyHintsVisible));
  } catch (error) {
    // The preference remains active for this session when storage is unavailable.
  }
}

function createSpeakerIcon(kind = "play") {
  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  icon.setAttribute("class", "verb-audio-menu-icon");
  icon.setAttribute("viewBox", "0 0 24 24");
  icon.setAttribute("aria-hidden", "true");
  icon.setAttribute("focusable", "false");
  icon.dataset.speechIcon = kind;
  if (kind === "stop") {
    const stop = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    stop.setAttribute("x", "7");
    stop.setAttribute("y", "7");
    stop.setAttribute("width", "10");
    stop.setAttribute("height", "10");
    stop.setAttribute("rx", "1");
    icon.append(stop);
    icon.setAttribute("hidden", "");
    return icon;
  }
  [
    "M4.5 9.25v5.5h3.25l4.75 3.75v-13L7.75 9.25H4.5Z",
    "M15.5 9.25c1.5 1.5 1.5 4 0 5.5",
    "M18.25 6.75c3 3 3 7.5 0 10.5"
  ].forEach((pathData) => {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", pathData);
    icon.append(path);
  });
  return icon;
}

function createAudioMenu(index) {
  const suffix = `conjugation-audio-${index}`;
  const menu = element("details", "verb-toolbar-menu verb-audio-menu");
  const summary = element("summary");
  summary.setAttribute("aria-label", "Czech audio settings");
  summary.title = "Czech audio settings";
  summary.append(createSpeakerIcon());

  const popover = element("div", "verb-audio-popover");
  popover.setAttribute("role", "dialog");
  popover.setAttribute("aria-label", "Czech audio settings");
  popover.append(element("span", "verb-popover-label", "Audio"));

  const speakOnSelect = element("button");
  speakOnSelect.type = "button";
  speakOnSelect.dataset.conjugationSpeakOnSelect = "";
  speakOnSelect.setAttribute("role", "switch");
  speakOnSelect.setAttribute("aria-checked", "false");
  speakOnSelect.append(element("span", "", "Speak Czech when selected"), element("i"));
  speakOnSelect.lastElementChild.setAttribute("aria-hidden", "true");
  popover.append(speakOnSelect);

  const settings = element("div", "verb-audio-settings");
  settings.dataset.conjugationAudioSettings = "";
  settings.hidden = true;

  const speedLabelId = `${suffix}-speed-label`;
  const speedSection = element("section", "verb-popover-setting");
  speedSection.setAttribute("aria-labelledby", speedLabelId);
  const speedLabel = element("span", "verb-popover-setting-title", "Speed");
  speedLabel.id = speedLabelId;
  const speed = element("input");
  speed.type = "range";
  speed.min = "0";
  speed.max = "2";
  speed.step = "1";
  speed.value = "0";
  speed.dataset.conjugationAudioSpeed = "";
  speed.setAttribute("aria-label", "Czech speech speed");
  speed.setAttribute("aria-valuetext", "Slower, 0.65 times");
  const ticks = element("div", "verb-audio-speed-ticks");
  ticks.setAttribute("aria-hidden", "true");
  [["Slower", "0.65×"], ["Slow", "0.82×"], ["Normal", "1×"]].forEach(([label, rate]) => {
    const tick = element("span", "", `${label} `);
    tick.append(element("small", "", rate));
    ticks.append(tick);
  });
  speedSection.append(speedLabel, speed, ticks);

  const voiceLabelId = `${suffix}-voice-label`;
  const voiceSelectId = `${suffix}-voice`;
  const voiceSection = element("section", "verb-popover-setting verb-audio-voice-setting");
  voiceSection.setAttribute("aria-labelledby", voiceLabelId);
  const voiceLabel = element("label");
  voiceLabel.setAttribute("for", voiceSelectId);
  const voiceTitle = element("span", "verb-popover-setting-title", "Voice");
  voiceTitle.id = voiceLabelId;
  const voice = element("select");
  voice.id = voiceSelectId;
  voice.dataset.conjugationAudioVoice = "";
  const automatic = element("option", "", "Automatic (recommended)");
  automatic.value = "";
  voice.append(automatic);
  voiceLabel.append(voiceTitle, voice);
  const voiceStatus = element("small", "", "Checking Czech voices...");
  voiceStatus.dataset.conjugationAudioVoiceStatus = "";
  voiceStatus.setAttribute("role", "status");
  voiceStatus.setAttribute("aria-live", "polite");
  voiceStatus.setAttribute("aria-atomic", "true");
  voiceSection.append(voiceLabel, voiceStatus);

  settings.append(speedSection, voiceSection);
  popover.append(settings);
  menu.append(summary, popover);
  return menu;
}

function renderAudioControls() {
  const paceOrder = ["slower", "slow", "normal"];
  const pace = window.CaatuuChrome?.resolveSpeechPace?.();
  document.querySelectorAll(".conjugation-comet-panel .verb-audio-menu").forEach((menu) => {
    const toggle = menu.querySelector("[data-conjugation-speak-on-select]");
    const settings = menu.querySelector("[data-conjugation-audio-settings]");
    const summary = menu.querySelector("summary");
    if (toggle) {
      toggle.setAttribute("aria-checked", String(state.speakOnSelect));
      toggle.classList.toggle("is-active", state.speakOnSelect);
    }
    if (settings) settings.hidden = !state.speakOnSelect;
    if (summary) {
      const stateLabel = state.speakOnSelect ? "on" : "off";
      summary.setAttribute("aria-label", `Czech audio settings. Speak on selection is ${stateLabel}.`);
      summary.title = `Czech audio settings. Speak on selection is ${stateLabel}.`;
      summary.classList.toggle("is-active", state.speakOnSelect);
    }
    const slider = menu.querySelector("[data-conjugation-audio-speed]");
    if (slider && pace) {
      const paceIndex = Math.max(0, paceOrder.indexOf(pace.key));
      slider.value = String(paceIndex);
      slider.style.setProperty("--speech-pace-position", `${(paceIndex / (paceOrder.length - 1)) * 100}%`);
      slider.setAttribute("aria-valuetext", `${pace.label}, ${pace.rate} times`);
    }
  });
}

async function refreshAudioVoiceControls(menu) {
  const select = menu?.querySelector("[data-conjugation-audio-voice]");
  const status = menu?.querySelector("[data-conjugation-audio-voice-status]");
  if (!select || !status || !state.speakOnSelect) return;
  const chrome = window.CaatuuChrome;
  if (typeof chrome?.getSpeechVoiceControlState !== "function") {
    select.disabled = true;
    status.textContent = "Czech voice settings are unavailable.";
    return;
  }
  const request = Number(select.dataset.request || 0) + 1;
  select.dataset.request = String(request);
  select.disabled = true;
  status.textContent = "Checking Czech voices...";
  const result = await chrome.getSpeechVoiceControlState();
  if (request !== Number(select.dataset.request)) return;
  const automatic = element("option", "", "Automatic (recommended)");
  automatic.value = "";
  select.replaceChildren(automatic);
  result.voices.forEach((voice) => {
    const option = element("option", "", `${voice.name} (${voice.locale || "Czech"} · ${voice.service})`);
    option.value = voice.value;
    select.append(option);
  });
  const preferred = chrome.getSpeechVoicePreference?.() || "";
  const selected = result.voices.find((voice) => voice.id === preferred);
  select.value = selected ? selected.value : "";
  select.disabled = !(result.available || result.voices.length);
  status.textContent = chrome.describeSpeechVoiceState?.(result) || "Voice selection is ready.";
}

function installAudioMenus() {
  document.querySelectorAll("[data-conjugation-audio-control]").forEach((slot, index) => {
    slot.replaceWith(createAudioMenu(index));
  });
  renderAudioControls();
}

function createDisplayOption({ value, label, kind }) {
  const button = element("button");
  button.type = "button";
  button.dataset[kind === "theme" ? "themeOption" : "fontSizeOption"] = value;
  button.setAttribute("aria-pressed", "false");
  if (kind === "theme") {
    const icon = element("img");
    icon.src = `/assets/icons/${value}_mode_ui.png`;
    icon.alt = "";
    icon.setAttribute("aria-hidden", "true");
    icon.decoding = "async";
    button.append(icon);
  } else {
    const sample = element("b", "", "A");
    sample.setAttribute("aria-hidden", "true");
    button.append(sample);
  }
  button.append(element("span", "", label));
  return button;
}

function createDisplayMenu() {
  const menu = element("details", "verb-toolbar-menu verb-display-menu");
  const summary = element("summary");
  summary.setAttribute("aria-label", "Display settings");
  summary.title = "Display settings";
  const icon = element("img", "theme-toggle-icon");
  icon.src = "/assets/icons/dark_mode_ui.png";
  icon.alt = "";
  icon.setAttribute("aria-hidden", "true");
  icon.decoding = "async";
  summary.append(icon);

  const popover = element("div", "verb-display-popover");
  popover.setAttribute("role", "dialog");
  popover.setAttribute("aria-label", "Display settings");
  popover.append(element("span", "verb-popover-label", "Display"));

  const themeSection = element("section", "verb-popover-setting");
  themeSection.setAttribute("aria-label", "Theme");
  themeSection.append(element("span", "verb-popover-setting-title", "Theme"));
  const themeOptions = element("div", "verb-display-options");
  themeOptions.setAttribute("role", "group");
  themeOptions.setAttribute("aria-label", "Theme");
  themeOptions.append(
    createDisplayOption({ value: "light", label: "Light", kind: "theme" }),
    createDisplayOption({ value: "dark", label: "Dark", kind: "theme" })
  );
  themeSection.append(themeOptions);

  const sizeSection = element("section", "verb-popover-setting");
  sizeSection.setAttribute("aria-label", "Text size");
  sizeSection.append(element("span", "verb-popover-setting-title", "Text size"));
  const sizeOptions = element("div", "verb-display-options verb-display-size-options");
  sizeOptions.setAttribute("role", "group");
  sizeOptions.setAttribute("aria-label", "Text size");
  sizeOptions.append(
    createDisplayOption({ value: "largest", label: "Standard", kind: "size" }),
    createDisplayOption({ value: "large", label: "Small", kind: "size" }),
    createDisplayOption({ value: "standard", label: "Smaller", kind: "size" })
  );
  sizeSection.append(sizeOptions);
  popover.append(themeSection, sizeSection);
  menu.append(summary, popover);
  return menu;
}

function syncDisplayMenus() {
  const theme = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
  const fontSize = document.documentElement.dataset.fontSize || "largest";
  document.querySelectorAll(".conjugation-comet-panel .verb-display-menu [data-theme-option]").forEach((button) => {
    const selected = button.dataset.themeOption === theme;
    button.classList.toggle("is-active", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  document.querySelectorAll(".conjugation-comet-panel .verb-display-menu [data-font-size-option]").forEach((button) => {
    const selected = button.dataset.fontSizeOption === fontSize;
    button.classList.toggle("is-active", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
}

function installDisplayMenus() {
  document.querySelectorAll("[data-conjugation-display-control]").forEach((slot) => {
    slot.replaceWith(createDisplayMenu());
  });
  syncDisplayMenus();
}

function closeToolbarMenus(except = null) {
  document.querySelectorAll(".conjugation-comet-panel details.verb-toolbar-menu[open]").forEach((menu) => {
    if (menu !== except) menu.open = false;
  });
}

function createPronounceButton(text) {
  const button = element("button", "conjugation-comet-word-pronounce");
  button.type = "button";
  button.dataset.conjugationReplay = "";
  button.setAttribute("aria-label", `Pronounce ${text} in Czech`);
  button.setAttribute("aria-pressed", "false");
  button.title = `Pronounce ${text} in Czech`;
  button.append(createSpeakerIcon(), createSpeakerIcon("stop"));
  return button;
}

function setPronounceButtonState(button, speaking) {
  if (!button) return;
  button.classList.toggle("is-speaking", speaking);
  button.setAttribute("aria-pressed", String(speaking));
  button.querySelector('[data-speech-icon="play"]')?.toggleAttribute("hidden", speaking);
  button.querySelector('[data-speech-icon="stop"]')?.toggleAttribute("hidden", !speaking);
}

function macawTokens(value) {
  return (String(value || "").toLowerCase().match(/[a-z0-9]+/g) || [])
    .filter((token) => token.length > 1 && !MACAW_STOPWORDS.has(token));
}

function normalizeMacawPath(value) {
  const path = String(value || "").trim().replaceAll("\\", "/");
  const normalized = path.startsWith("assets/") ? `/${path}` : path;
  return normalized.startsWith("/assets/macaw/actions/") ? normalized : "";
}

async function loadMacawKeymap() {
  if (!macawKeymapPromise) {
    macawKeymapPromise = fetch(MACAW_KEYMAP_URL, { cache: "force-cache" })
      .then((response) => {
        if (!response.ok) throw new Error(`Could not load Macaw keymap (${response.status}).`);
        return response.json();
      })
      .then((raw) => Object.entries(raw || {}).map(([path, metadata]) => ({
        assetPath: normalizeMacawPath(path),
        action: String(metadata?.action || "").replaceAll("_", " "),
        alt: String(metadata?.description || "Macaw picture clue")
      })).filter((row) => (
        row.assetPath && isChildFacingMacawActionAssetAllowed(row.assetPath, row.action)
      )))
      .catch(() => []);
  }
  return macawKeymapPromise;
}

async function vectorMacawCandidates(englishMeaning) {
  const search = window.CaatuuRuntime?.vector?.search;
  if (typeof search !== "function") return [];
  const response = await search(englishMeaning, {
    limit: 10,
    sourceKinds: ["macaw_action_asset"]
  });
  return (Array.isArray(response?.results) ? response.results : [])
    .filter((row) => row?.sourceKind === "macaw_action_asset")
    .map((row) => ({
      assetPath: normalizeMacawPath(
        row.documentMetadata?.asset_path
          || row.chunkMetadata?.asset_path
          || row.sourceId
      ),
      action: row.documentMetadata?.action || row.chunkMetadata?.action || "",
      alt: row.text || "Macaw picture clue",
      score: 100 + (Number.isFinite(Number(row.score)) ? Number(row.score) : 0)
    }))
    .filter((row) => (
      row.assetPath && isChildFacingMacawActionAssetAllowed(row.assetPath, row.action)
    ));
}

function macawActionMatches(englishMeaning, row) {
  const queryTokens = new Set(macawTokens(englishMeaning));
  if (!queryTokens.size) return false;
  const actionTokens = new Set(macawTokens(row?.action));
  return [...queryTokens].some((token) => actionTokens.has(token));
}

function lexicalMacawCandidates(englishMeaning, rows) {
  const normalizedMeaning = normalize(englishMeaning);
  return rows.filter((row) => macawActionMatches(englishMeaning, row))
    .map((row) => {
    const queryTokens = new Set(macawTokens(englishMeaning));
    const candidateTokens = new Set(macawTokens(row.action));
    const shared = [...queryTokens].filter((token) => candidateTokens.has(token)).length;
    const exact = normalize(row.action) === normalizedMeaning ? 2 : 0;
    return { ...row, score: 50 + exact + shared / queryTokens.size };
  }).filter((row) => row.score > 50)
    .sort((left, right) => right.score - left.score);
}

function mergeMacawCandidates(...groups) {
  const byPath = new Map();
  groups.flat().forEach((candidate) => {
    if (!candidate?.assetPath) return;
    const current = byPath.get(candidate.assetPath);
    if (!current || Number(candidate.score) > Number(current.score)) byPath.set(candidate.assetPath, candidate);
  });
  return [...byPath.values()].sort((left, right) => Number(right.score) - Number(left.score));
}

function retrieveMeaningImage(englishMeaning) {
  const key = normalize(englishMeaning);
  if (!meaningImageCache.has(key)) {
    const vectorDeadline = new Promise((resolve) => {
      window.setTimeout(() => resolve([]), MACAW_LOOKUP_TIMEOUT_MILLIS);
    });
    const request = Promise.all([
      Promise.race([vectorMacawCandidates(englishMeaning).catch(() => []), vectorDeadline]),
      loadMacawKeymap()
    ]).then(([vectorCandidates, keymapRows]) => {
      const keymapByPath = new Map(keymapRows.map((row) => [row.assetPath, row]));
      const groundedVectorCandidates = vectorCandidates.filter((candidate) => (
        macawActionMatches(englishMeaning, keymapByPath.get(candidate.assetPath))
      ));
      const [best] = mergeMacawCandidates(
        groundedVectorCandidates,
        lexicalMacawCandidates(englishMeaning, keymapRows)
      );
      return best || {
        assetPath: MACAW_FALLBACK,
        alt: "A friendly Macaw accompanies the Czech verb."
      };
    });
    meaningImageCache.set(key, request);
  }
  return meaningImageCache.get(key);
}

function ensureMeaningImage() {
  if (!state.current || state.meaningImage?.verb === state.current.verb) return;
  const verb = state.current;
  const requestId = state.meaningImageRequestId + 1;
  state.meaningImageRequestId = requestId;
  state.meaningImage = {
    verb: verb.verb,
    status: "loading"
  };
  retrieveMeaningImage(verb.meaning).then((image) => {
    if (state.meaningImageRequestId !== requestId || state.current !== verb) return;
    state.meaningImage = { verb: verb.verb, status: "ready", ...image };
    if (state.phase === "meaning") renderMeaning();
  }).catch(() => {
    if (state.meaningImageRequestId !== requestId || state.current !== verb) return;
    state.meaningImage = {
      verb: verb.verb,
      status: "ready",
      assetPath: MACAW_FALLBACK,
      alt: "A friendly Macaw accompanies the Czech verb."
    };
    if (state.phase === "meaning") renderMeaning();
  });
}

function renderMeaning() {
  const board = $("#verbMeaningGateBoard");
  const targetColumn = $("#verbMeaningTargetColumn");
  const englishColumn = $("#verbMeaningEnglishColumn");
  if (!board || !targetColumn || !englishColumn || !state.current) return;
  const stackedLayout = state.meaningLayout === "stacked";
  board.classList.toggle("is-stacked-layout", stackedLayout);
  const layoutButton = $("#verbMeaningLayoutButton");
  if (layoutButton) {
    const label = stackedLayout ? "Use side-by-side meaning layout" : "Use stacked meaning layout";
    layoutButton.setAttribute("aria-label", label);
    layoutButton.setAttribute("aria-pressed", String(stackedLayout));
    layoutButton.title = label;
    layoutButton.querySelector('[data-layout-icon="stacked"]')?.toggleAttribute("hidden", stackedLayout);
    layoutButton.querySelector('[data-layout-icon="split"]')?.toggleAttribute("hidden", !stackedLayout);
  }
  if (state.meaningHintVisible) ensureMeaningImage();
  const hintButton = $("#verbMeaningHintButton");
  const hintLoading = state.meaningHintVisible && state.meaningImage?.status === "loading";
  if (hintButton) {
    hintButton.setAttribute("aria-pressed", String(state.meaningHintVisible));
    hintButton.setAttribute("aria-label", state.meaningHintVisible ? "Hide picture clue" : "Show picture clue");
    hintButton.title = state.meaningHintVisible ? "Hide picture clue" : "Show picture clue";
    hintButton.classList.toggle("is-active", state.meaningHintVisible);
    hintButton.classList.toggle("is-loading", hintLoading);
  }
  const target = element("div", `verb-match-card conjugation-comet-meaning-target is-selected${state.meaningMatched ? " is-matched" : ""}`);
  target.setAttribute("role", "group");
  const hintReady = state.meaningHintVisible && state.meaningImage?.status === "ready";
  target.setAttribute("aria-label", hintReady
    ? `${state.current.verb}, selected Czech verb. Picture clue for ${state.current.meaning}.`
    : `${state.current.verb}, selected Czech verb.`);
  const word = element("span", "verb-match-card-copy", state.current.verb);
  word.lang = course.targetLanguage?.locale || "cs-CZ";
  target.append(createPronounceButton(state.current.verb));
  if (state.meaningHintVisible) {
    const visual = element("span", `conjugation-comet-meaning-visual${hintReady ? "" : " is-loading"}`);
    if (hintReady) {
      const image = element("img", "conjugation-comet-meaning-macaw");
      image.src = state.meaningImage.assetPath;
      image.alt = state.meaningImage.alt || "Macaw picture clue";
      image.addEventListener("error", () => {
        if (!image.src.endsWith(MACAW_FALLBACK)) image.src = MACAW_FALLBACK;
      }, { once: true });
      visual.append(image);
    } else {
      visual.setAttribute("aria-hidden", "true");
    }
    target.append(visual);
  }
  target.append(word);
  targetColumn.replaceChildren(target);

  englishColumn.replaceChildren(...state.meaningOptions.map((verb, optionIndex) => {
    const optionKey = String(optionIndex);
    const matched = state.meaningMatched && verb === state.current;
    const card = createCard({
      text: verb.meaning,
      language: "en",
      className: [
        "verb-match-card-en",
        matched ? "is-matched" : "",
        state.meaningWrongId === optionKey ? "is-wrong" : ""
      ].filter(Boolean).join(" "),
      disabled: state.meaningMatched,
      ariaLabel: `${verb.meaning}, English meaning${matched ? ", matched" : ""}`
    });
    card.button.dataset.meaningOption = optionKey;
    return card.row;
  }));

  board.style.setProperty("--verb-pair-count", "4");
  board.setAttribute("aria-busy", "false");
  $("#verbMeaningGateProgress").textContent = state.meaningMatched
    ? `Verb ${currentPilotPosition()} of 6 · meaning complete`
    : `Verb ${currentPilotPosition()} of 6 · meaning`;
  if (state.meaningMatched) setFeedback("#verbMeaningGateFeedback", "Correct. Now match all the forms.", "correct");
  else if (state.meaningWrongId) setFeedback("#verbMeaningGateFeedback", "Not this meaning. Try again.", "wrong");
  else setFeedback("#verbMeaningGateFeedback", "Choose the English meaning.");
}

function createCueCard(key) {
  const form = exerciseFormForKey(key);
  const cueParts = splitEnglishCue(form.cue);
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
    ariaLabel: `${form.cue}, ${form.label}`
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
  label.textContent = form.label;
  label.title = form.label;
  label.setAttribute("aria-hidden", "true");
  cue.append(natural, label);
  card.copy.replaceWith(cue);
  card.button.dataset.cueKey = key;
  card.row.classList.add("conjugation-comet-cue-row");
  return card;
}

function pronounHintSprite(form) {
  const cue = String(form?.cue || "").trim().toLocaleLowerCase("en");
  if (form?.label === "S1") return { cell: "S1", column: 0, row: 0, alt: "I, first-person singular pronoun clue" };
  if (form?.label === "S2") return { cell: "S2", column: 1, row: 0, alt: "You, second-person singular pronoun clue" };
  if (form?.label === "P2") return { cell: "P2", column: 3, row: 0, alt: "You all or formal you, second-person pronoun clue" };
  if (form?.label === "P1") return { cell: "P1", column: 1, row: 1, alt: "We, first-person plural pronoun clue" };
  if (form?.label === "P3") return { cell: "P3", column: 2, row: 1, alt: "They, third-person plural pronoun clue" };
  if (form?.label === "S3" && cue.startsWith("he ")) return { cell: "S3-male", column: 2, row: 0, alt: "He, third-person singular pronoun clue" };
  if (form?.label === "S3" && cue.startsWith("she ")) return { cell: "S3-female", column: 0, row: 1, alt: "She, third-person singular pronoun clue" };
  return null;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function fallbackPronounViewBox(sprite) {
  const cellWidth = PRONOUN_SPRITE_WIDTH / 4;
  const cellHeight = PRONOUN_SPRITE_HEIGHT / 2;
  return `${sprite.column * cellWidth} ${sprite.row * cellHeight} ${cellWidth} ${cellHeight}`;
}

function centeredCropStart({ cellStart, cellEnd, cropSize, contentStart, contentEnd, centerOfMass }) {
  const earliest = Math.max(cellStart, contentEnd - cropSize);
  const latest = Math.min(cellEnd - cropSize, contentStart);
  if (earliest <= latest) return clamp(centerOfMass - cropSize / 2, earliest, latest);
  return clamp((contentStart + contentEnd - cropSize) / 2, cellStart, cellEnd - cropSize);
}

function analyzePronounSprite(image) {
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return new Map();
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const crops = new Map();
  const cells = [[0, 0], [1, 0], [2, 0], [3, 0], [0, 1], [1, 1], [2, 1]];

  cells.forEach(([column, row]) => {
    const cellLeft = Math.round(column * canvas.width / 4);
    const cellRight = Math.round((column + 1) * canvas.width / 4);
    const cellTop = Math.round(row * canvas.height / 2);
    const cellBottom = Math.round((row + 1) * canvas.height / 2);
    let minX = cellRight;
    let minY = cellBottom;
    let maxX = cellLeft;
    let maxY = cellTop;
    let alphaTotal = 0;
    let weightedX = 0;
    let weightedY = 0;

    for (let y = cellTop; y < cellBottom; y += 1) {
      for (let x = cellLeft; x < cellRight; x += 1) {
        const alpha = pixels[(y * canvas.width + x) * 4 + 3];
        if (alpha < 24) continue;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
        alphaTotal += alpha;
        weightedX += (x + 0.5) * alpha;
        weightedY += (y + 0.5) * alpha;
      }
    }

    if (!alphaTotal) return;
    const contentWidth = maxX - minX + 1;
    const contentHeight = maxY - minY + 1;
    const padding = Math.max(contentWidth, contentHeight) * 0.055;
    const paddedLeft = Math.max(cellLeft, minX - padding);
    const paddedRight = Math.min(cellRight, maxX + 1 + padding);
    const paddedTop = Math.max(cellTop, minY - padding);
    const paddedBottom = Math.min(cellBottom, maxY + 1 + padding);
    const desiredSquare = Math.max(paddedRight - paddedLeft, paddedBottom - paddedTop);
    const cropWidth = Math.min(desiredSquare, cellRight - cellLeft);
    const cropHeight = Math.min(desiredSquare, cellBottom - cellTop);
    const centerX = weightedX / alphaTotal;
    const centerY = weightedY / alphaTotal;
    const cropX = centeredCropStart({
      cellStart: cellLeft,
      cellEnd: cellRight,
      cropSize: cropWidth,
      contentStart: paddedLeft,
      contentEnd: paddedRight,
      centerOfMass: centerX
    });
    const cropY = centeredCropStart({
      cellStart: cellTop,
      cellEnd: cellBottom,
      cropSize: cropHeight,
      contentStart: paddedTop,
      contentEnd: paddedBottom,
      centerOfMass: centerY
    });
    crops.set(`${column}:${row}`, `${cropX} ${cropY} ${cropWidth} ${cropHeight}`);
  });

  return crops;
}

function loadPronounSpriteCrops(file) {
  if (!pronounSpriteCropCache.has(file)) {
    const request = (async () => {
      const image = new Image();
      image.decoding = "async";
      image.src = `${PRONOUN_IMAGE_BASE}/${file}`;
      await image.decode();
      return analyzePronounSprite(image);
    })().catch(() => new Map());
    pronounSpriteCropCache.set(file, request);
  }
  return pronounSpriteCropCache.get(file);
}

function createPronounHintSlot(form) {
  const sprite = pronounHintSprite(form);
  const spriteSheet = state.pronounSpriteSheet;
  const slot = element("span", "conjugation-comet-pronoun-hint-slot");
  slot.hidden = !state.morphologyHintsVisible || !sprite;
  if (!sprite) return slot;
  const image = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  image.setAttribute("class", "conjugation-comet-pronoun-hint-image");
  image.setAttribute("viewBox", fallbackPronounViewBox(sprite));
  image.setAttribute("preserveAspectRatio", "xMidYMid meet");
  image.setAttribute("role", "img");
  image.setAttribute("aria-label", sprite.alt);
  image.dataset.pronounCell = sprite.cell;
  image.dataset.pronounSheet = spriteSheet;
  const sheet = document.createElementNS("http://www.w3.org/2000/svg", "image");
  sheet.setAttribute("href", `${PRONOUN_IMAGE_BASE}/${spriteSheet}`);
  sheet.setAttribute("width", String(PRONOUN_SPRITE_WIDTH));
  sheet.setAttribute("height", String(PRONOUN_SPRITE_HEIGHT));
  sheet.setAttribute("preserveAspectRatio", "none");
  image.append(sheet);
  slot.append(image);
  void loadPronounSpriteCrops(spriteSheet).then((crops) => {
    if (!image.isConnected || image.dataset.pronounSheet !== spriteSheet) return;
    const viewBox = crops.get(`${sprite.column}:${sprite.row}`);
    if (viewBox) image.setAttribute("viewBox", viewBox);
  });
  return slot;
}

function morphologyCardForKey(column, attribute, key) {
  return Array.from(column?.querySelectorAll(`[${attribute}]`) || [])
    .find((card) => card.getAttribute(attribute) === key) || null;
}

function renderMorphologySolutionArrows() {
  const board = $("#verbMorphologyBoard");
  const svg = $("#verbMorphologySolutionArrows");
  const paths = $("#verbMorphologySolutionArrowPaths");
  const formsColumn = $("#verbMorphologyFormsColumn");
  const cuesColumn = $("#verbMorphologyCuesColumn");
  const visible = state.phase === "forms" && state.revealed && state.solutionArrowsReady;
  if (svg) {
    svg.toggleAttribute("hidden", !visible);
    svg.classList.toggle("is-visible", visible);
    svg.setAttribute("aria-hidden", String(!visible));
  }
  if (!board || !svg || !paths || !formsColumn || !cuesColumn || !visible) {
    paths?.replaceChildren();
    return;
  }

  window.requestAnimationFrame(() => {
    if (state.phase !== "forms" || !state.revealed || !svg.isConnected) return;
    const boardRect = board.getBoundingClientRect();
    if (!boardRect.width || !boardRect.height) return;
    svg.setAttribute("viewBox", `0 0 ${boardRect.width} ${boardRect.height}`);
    svg.setAttribute("width", String(boardRect.width));
    svg.setAttribute("height", String(boardRect.height));
    const routes = state.formOrder.map((key, index) => {
      const formCard = morphologyCardForKey(formsColumn, "data-form-key", key);
      const cueCard = morphologyCardForKey(cuesColumn, "data-cue-key", key);
      if (!formCard || !cueCard) return null;
      const formRect = formCard.getBoundingClientRect();
      const cueRect = cueCard.getBoundingClientRect();
      const startX = formRect.right - boardRect.left - 4;
      const startY = formRect.top - boardRect.top + formRect.height / 2;
      const endX = cueRect.left - boardRect.left + 4;
      const endY = cueRect.top - boardRect.top + cueRect.height / 2;
      const routeColor = SOLUTION_ROUTE_COLORS[index % SOLUTION_ROUTE_COLORS.length];
      const routeData = `M ${startX} ${startY} L ${endX} ${endY}`;
      [formCard, cueCard].forEach((card) => card.style.setProperty("--verb-solution-color", routeColor));

      const route = document.createElementNS("http://www.w3.org/2000/svg", "g");
      route.classList.add("verb-solution-route");
      route.style.setProperty("--verb-solution-color", routeColor);
      route.style.setProperty("--verb-solution-index", String(index));
      const halo = document.createElementNS("http://www.w3.org/2000/svg", "path");
      halo.classList.add("verb-solution-route-halo");
      halo.setAttribute("d", routeData);
      halo.setAttribute("pathLength", "1");
      const line = document.createElementNS("http://www.w3.org/2000/svg", "path");
      line.classList.add("verb-solution-route-line");
      line.setAttribute("d", routeData);
      line.setAttribute("pathLength", "1");
      line.setAttribute("marker-end", "url(#verbMorphologySolutionArrowhead)");
      route.append(halo, line);
      return route;
    }).filter(Boolean);
    paths.replaceChildren(...routes);
  });
}

function renderForms() {
  const formsColumn = $("#verbMorphologyFormsColumn");
  const cuesColumn = $("#verbMorphologyCuesColumn");
  if (!formsColumn || !cuesColumn || !state.current) return;

  formsColumn.replaceChildren(...state.formOrder.map((key) => {
    const form = exerciseFormForKey(key);
    const display = czechFormDisplay(form);
    const card = createCard({
      text: display,
      language: course.targetLanguage?.locale || "cs-CZ",
      className: [
        state.selectedFormKey === key ? "is-selected" : "",
        state.matchedFormKeys.has(key) ? "is-matched" : "",
        state.wrongFormKey === key ? "is-wrong" : "",
        state.revealed && !state.matchedFormKeys.has(key) ? "is-solution" : ""
      ].filter(Boolean).join(" "),
      disabled: state.matchedFormKeys.has(key) || state.revealed,
      ariaLabel: `${display}, Czech subject phrase, ${form.label}`
    });
    card.copy.replaceWith(createCzechFormCopy(form));
    card.button.dataset.formKey = key;
    if (state.revealed && !state.matchedFormKeys.has(key)) {
      card.button.dataset.solutionLabel = form.label;
    }
    card.row.classList.add("conjugation-comet-form-row");
    card.row.prepend(createPronounHintSlot(form));
    return card.row;
  }));
  cuesColumn.replaceChildren(...state.cueOrder.map((key) => createCueCard(key).row));

  const formCount = state.exerciseForms.length;
  $("#verbMorphologyBoard").style.setProperty("--verb-pair-count", String(formCount));
  $("#verbMorphologyBoard").setAttribute("aria-busy", "false");
  $("#verbMorphologyBoard").classList.toggle("is-solution-mode", state.revealed);
  $("#verbMorphologyLemmaTarget").textContent = state.current.verb;
  $("#verbMorphologyGloss").textContent = state.current.meaning;
  const matches = state.matchedCueKeys.size;
  $("#verbMorphologyProgress").textContent = `Verb ${currentPilotPosition()} of 6 · ${matches} of ${formCount} matched`;
  const complete = matches === formCount || state.revealed;
  document.querySelector(".verb-morphology-actions").hidden = false;
  const hintButton = $("#verbMorphologyHintButton");
  hintButton.disabled = complete;
  hintButton.setAttribute("aria-pressed", String(state.morphologyHintsVisible));
  hintButton.setAttribute("aria-label", state.morphologyHintsVisible ? "Hide pronoun picture clues" : "Show pronoun picture clues");
  hintButton.title = state.morphologyHintsVisible ? "Hide pronoun picture clues" : "Show pronoun picture clues";
  hintButton.classList.toggle("is-active", state.morphologyHintsVisible);
  $("#verbMorphologyRevealButton").disabled = complete;

  if (complete) {
    const completion = state.revealed
      ? state.solutionArrowsReady
        ? "Review each aligned pair."
        : "Putting every pair in placeâ€¦"
      : isHeldOutVerb()
        ? `All forms matched. You used the same family with a new verb. ${familySummary(state.current)}`
        : `All forms matched. ${familySummary(state.current)}`;
    setFeedback("#verbMorphologyFeedback", completion, state.revealed ? "" : "correct");
    scheduleNextVerb(state.revealed ? solutionRevealDuration(formCount) : COMPLETED_ROUND_HOLD_MILLIS);
  } else if (state.wrongFormKey || state.wrongCueKey) {
    const expected = exerciseFormForKey(state.wrongCueKey);
    const guide = FORM_GUIDE[expected?.label];
    const ending = AM_ENDINGS[expected?.label];
    setFeedback("#verbMorphologyFeedback", guide && ending
      ? `${expected.label} means ${guide.person} (${guide.subject}); this family uses -${ending}. Try again.`
      : "Those do not match. Compare the person and number.", "wrong");
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
  $("#verbMorphologyLegend").hidden = !formsVisible;
  $("#conjugationCometUnavailable").hidden = !errorVisible;
  $("#conjugationCometRobot").src = state.robotPath;
  $("#conjugationCometInterstitial").setAttribute("aria-label", state.transitionMessage);
  renderAudioControls();
  if (meaningVisible) renderMeaning();
  if (formsVisible) renderForms();
  renderMorphologySolutionArrows();
  if (errorVisible) {
    $("#conjugationCometUnavailableTitle").textContent = "Conjugation Comet could not load";
    const copy = $("#conjugationCometUnavailableTitle")?.nextElementSibling;
    if (copy) copy.textContent = state.error;
  }
}

function handleMeaningOption(optionKey) {
  if (state.phase !== "meaning" || state.meaningMatched) return;
  const correct = state.meaningOptions[Number(optionKey)] === state.current;
  record({ activities: 1, attempts: 1, successes: correct ? 1 : 0, xp: correct ? 1 : 0 });
  if (!correct) {
    state.meaningWrongId = optionKey;
    render();
    window.setTimeout(() => {
      if (state.meaningWrongId === optionKey) {
        state.meaningWrongId = "";
        render();
      }
    }, 650);
    return;
  }
  state.meaningMatched = true;
  state.meaningKnown.add(state.current.verb);
  render();
  window.setTimeout(() => transition("Preparing the matching board…", () => {
    state.phase = "forms";
  }, 1000).catch(showError), 550);
}

function toggleMeaningHint() {
  if (state.phase !== "meaning" || state.meaningMatched) return;
  state.meaningHintVisible = !state.meaningHintVisible;
  saveMeaningHintVisible();
  renderMeaning();
}

function toggleMeaningLayout() {
  state.meaningLayout = state.meaningLayout === "stacked" ? "split" : "stacked";
  saveMeaningLayout();
  if (state.phase === "meaning") renderMeaning();
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
  const correct = formsCanMatch(formKey, cueKey);
  record({ activities: 1, attempts: 1, successes: correct ? 1 : 0, xp: correct ? 1 : 0 });
  if (correct) {
    acceptCorrectPair(formKey, cueKey);
    return;
  }
  state.wrongFormKey = formKey;
  state.wrongCueKey = cueKey;
  state.selectedFormKey = "";
  state.selectedCueKey = "";
  render();
  clearWrongPair(formKey, cueKey);
}

function acceptCorrectPair(formKey, cueKey) {
  state.matchedFormKeys.add(formKey);
  state.matchedCueKeys.add(cueKey);
  state.selectedFormKey = "";
  state.selectedCueKey = "";
  if (state.matchedCueKeys.size === state.exerciseForms.length && !state.roundRecorded) {
    state.roundRecorded = true;
    record({ rounds: 1, xp: isHeldOutVerb() ? 2 : 1 });
    announceRoundSuccess();
  }
  render();
}

function selectForm(key) {
  if (state.phase !== "forms" || state.revealed || state.matchedFormKeys.has(key)) return;
  if (state.speakOnSelect) void speakCzech(czechFormDisplay(exerciseFormForKey(key)));
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

function toggleMorphologyHints() {
  if (state.phase !== "forms" || state.revealed) return;
  state.morphologyHintsVisible = !state.morphologyHintsVisible;
  saveMorphologyHintsVisible();
  renderForms();
}

function captureFormPositions() {
  const positions = new Map();
  document.querySelectorAll("#verbMorphologyFormsColumn [data-form-key]").forEach((card) => {
    positions.set(card.dataset.formKey, card.getBoundingClientRect().top);
  });
  return positions;
}

function animateFormsIntoPairs(previousPositions) {
  const cards = Array.from(document.querySelectorAll("#verbMorphologyFormsColumn [data-form-key]"));
  cards.forEach((card) => {
    const previousTop = previousPositions.get(card.dataset.formKey);
    if (!Number.isFinite(previousTop)) return;
    const offset = previousTop - card.getBoundingClientRect().top;
    card.style.transition = "none";
    card.style.transform = `translateY(${offset}px)`;
  });
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      cards.forEach((card, index) => {
        card.style.transition = `transform 620ms cubic-bezier(0.22, 0.78, 0.24, 1) ${index * 28}ms`;
        card.style.transform = "translateY(0)";
      });
    });
  });
}

function revealAnswers() {
  if (state.phase !== "forms") return;
  clearNextTimer();
  const previousPositions = captureFormPositions();
  state.revealed = true;
  state.solutionArrowsReady = false;
  state.formOrder = [...state.cueOrder];
  if (!state.roundRecorded) {
    state.roundRecorded = true;
    record({ rounds: 1 });
  }
  state.selectedFormKey = "";
  state.selectedCueKey = "";
  render();
  animateFormsIntoPairs(previousPositions);
  window.setTimeout(() => {
    if (state.phase !== "forms" || !state.revealed) return;
    state.solutionArrowsReady = true;
    setFeedback("#verbMorphologyFeedback", "Review each aligned pair.");
    renderMorphologySolutionArrows();
  }, 900);
}

function startNextVerb() {
  if (!state.verbs.length) return;
  void window.CaatuuChrome?.stopCzechSpeech?.();
  transition("Choosing the next -ám verb…", prepareNextVerb, 1000)
    .then(speakCurrentChallenge)
    .catch(showError);
}

function speakCurrentChallenge() {
  if (!state.speakOnSelect || !state.current?.verb) return;
  void speakCzech(state.current.verb);
}

async function speakCzech(text, button = null) {
  const verb = String(text || "").trim();
  const speak = window.CaatuuChrome?.speakCzechText;
  if (!verb || typeof speak !== "function" || button?.disabled) return;
  if (button) {
    setPronounceButtonState(button, true);
    button.setAttribute("aria-busy", "true");
  }
  try {
    await speak(verb);
  } catch (error) {
    console.warn("Czech pronunciation is unavailable", error);
    const feedback = state.phase === "forms"
      ? "#verbMorphologyFeedback"
      : "#verbMeaningGateFeedback";
    setFeedback(feedback, "Czech pronunciation is unavailable on this device.", "wrong");
  } finally {
    if (button) {
      setPronounceButtonState(button, false);
      button.removeAttribute("aria-busy");
    }
  }
}

function bindUi() {
  document.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (button?.matches(".verb-display-menu [data-theme-option], .verb-display-menu [data-font-size-option]")) {
      window.queueMicrotask(() => {
        syncDisplayMenus();
        button.closest("details")?.removeAttribute("open");
      });
    } else if (button?.matches("[data-conjugation-speak-on-select]")) {
      state.speakOnSelect = !state.speakOnSelect;
      saveSpeakOnSelect();
      renderAudioControls();
      if (state.speakOnSelect) void refreshAudioVoiceControls(button.closest(".verb-audio-menu"));
    } else if (button?.matches("[data-conjugation-replay]")) {
      void speakCzech(state.current?.verb, button);
    } else if (button?.hasAttribute("data-meaning-option")) handleMeaningOption(button.dataset.meaningOption);
    else if (button?.dataset.formKey) selectForm(button.dataset.formKey);
    else if (button?.dataset.cueKey) selectCue(button.dataset.cueKey);

    if (!event.target.closest(".conjugation-comet-panel .verb-match-control-cluster")) {
      closeToolbarMenus();
    }
  });
  document.querySelectorAll(".conjugation-comet-panel details.verb-toolbar-menu").forEach((menu) => {
    menu.addEventListener("toggle", () => {
      if (!menu.open) return;
      closeToolbarMenus(menu);
      if (menu.classList.contains("verb-display-menu")) syncDisplayMenus();
      if (menu.classList.contains("verb-audio-menu") && state.speakOnSelect) {
        void refreshAudioVoiceControls(menu);
      }
    });
  });
  document.querySelectorAll("[data-conjugation-audio-speed]").forEach((slider) => {
    slider.addEventListener("input", (event) => {
      const paceOrder = ["slower", "slow", "normal"];
      const paceIndex = Math.max(0, Math.min(paceOrder.length - 1, Math.round(Number(event.currentTarget.value) || 0)));
      window.CaatuuChrome?.setSpeechPacePreference?.(paceOrder[paceIndex]);
      renderAudioControls();
    });
  });
  document.querySelectorAll("[data-conjugation-audio-voice]").forEach((select) => {
    select.addEventListener("change", async (event) => {
      event.currentTarget.disabled = true;
      await window.CaatuuChrome?.stopCzechSpeech?.();
      window.CaatuuChrome?.setSpeechVoicePreference?.(event.currentTarget.value);
      await refreshAudioVoiceControls(event.currentTarget.closest(".verb-audio-menu"));
    });
  });
  $("#verbMorphologyHintButton")?.addEventListener("click", toggleMorphologyHints);
  $("#verbMeaningHintButton")?.addEventListener("click", toggleMeaningHint);
  $("#verbMeaningLayoutButton")?.addEventListener("click", toggleMeaningLayout);
  $("#verbMorphologyRevealButton")?.addEventListener("click", revealAnswers);
  window.addEventListener("resize", () => {
    if (state.phase === "forms" && state.revealed) renderMorphologySolutionArrows();
  });
  window.addEventListener("caatuu:speech-pace-change", renderAudioControls);
  window.addEventListener("caatuu:speech-voice-change", () => {
    document.querySelectorAll(".conjugation-comet-panel .verb-audio-menu[open]").forEach((menu) => {
      if (state.speakOnSelect) void refreshAudioVoiceControls(menu);
    });
  });
  window.addEventListener("pagehide", () => {
    void window.CaatuuChrome?.stopCzechSpeech?.();
  });
}

function showError(error) {
  console.error("Conjugation Comet failed", error);
  state.error = error?.message || String(error);
  state.phase = "error";
  render();
}

function waitForWindowLoad() {
  if (document.readyState === "complete") return Promise.resolve();
  return new Promise((resolve) => window.addEventListener("load", resolve, { once: true }));
}

async function init() {
  installAudioMenus();
  installDisplayMenus();
  bindUi();
  render();
  try {
    state.verbs = await loadVerbs();
    state.pilot = buildPilot(state.verbs);
    refillQueue();
    await waitForWindowLoad();
    await transition("Preparing the first challenge…", prepareNextVerb, 1100);
    speakCurrentChallenge();
    window.CaatuuRuntime?.registerServiceWorker?.().catch(() => {});
  } catch (error) {
    showError(error);
  }
}

init();
