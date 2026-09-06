import { fetchDeclaredCourseGameJson, readEmbeddedCourseProfile } from "../course-game-content.mjs?v=course-game-content-1";
import {
  buildConjugationHelixRound, judgeConjugationHelixRound, splitConjugationDisplay,
  buildConjugationVerbQueue, validateConjugationCometCatalog
} from "./conjugation-comet-core.mjs?v=conjugation-comet-core-2";
import { createSpeechIcon, mountEmbeddedGameControls, mountRobotLoadingScreen } from "../embedded-game-controls.mjs?v=embedded-game-controls-8";

const GAME_ID = "conjugation-comet";
const RESOURCE_NAME = "conjugationCometCatalog";
const PHASE_DELAYS = Object.freeze({ moving: 420, transition: 1200 });
const ILLUSTRATIONS_KEY = "caatuu.conjugation-comet.illustrations";
const element = (id) => document.getElementById(id);

function shellWindow() {
  try {
    if (window.parent !== window && window.parent.location.origin === window.location.origin) return window.parent;
  } catch { /* The course loader validates the origin boundary. */ }
  return window;
}

function readIllustrations() {
  try { return shellWindow().localStorage?.getItem(ILLUSTRATIONS_KEY) !== "false"; }
  catch { return true; }
}

function setPresentationFromShell() {
  const source = shellWindow().document?.documentElement?.dataset || {};
  document.documentElement.dataset.theme = ["light", "dark"].includes(source.theme) ? source.theme : "dark";
  document.documentElement.dataset.fontSize = ["standard", "large", "largest"].includes(source.fontSize) ? source.fontSize : "largest";
}

function copy(state, key, values = {}) { return state.interfaceContent.t(`conjugationcomet.${key}`, values); }
function formatCopy(template, values) {
  return Object.entries(values).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, String(value)), template);
}
function setFeedback(message, kind = "") {
  const node = element("conjugationCometFeedback");
  node.textContent = message;
  if (kind) node.dataset.kind = kind;
  else delete node.dataset.kind;
}
function recordLearning(delta) {
  try { shellWindow().CaatuuLearning?.record?.(GAME_ID, delta); }
  catch { /* Learning telemetry is optional. */ }
}
function canInteract(state) {
  return !state.destroyed && state.active && !state.pageHidden
    && document.visibilityState !== "hidden" && !state.controls?.isOpen();
}
function clearTimer(state) {
  state.timerSerial += 1;
  if (state.timer) window.clearTimeout(state.timer);
  state.timer = 0;
}
function finishMotion(state) {
  state.animations.forEach((animation) => animation.cancel());
  state.animations = [];
}
function armPhase(state) {
  clearTimer(state);
  if (!canInteract(state) || state.waitingCampaign) return;
  const delay = state.phase === "result" ? (state.lastCorrect ? 1600 : 1800) : PHASE_DELAYS[state.phase];
  if (!delay) return;
  const serial = state.timerSerial;
  state.timer = window.setTimeout(() => {
    if (serial !== state.timerSerial || !canInteract(state)) return;
    state.timer = 0;
    if (state.phase === "moving") {
      finishMotion(state);
      state.phase = "question";
      syncInteraction(state);
      focusStrand(state, state.focusSide);
    } else if (state.phase === "result") {
      if (state.lastCorrect) { completeBatch(state); return; }
      state.phase = "question";
      resetResult(state);
      syncInteraction(state);
      focusStrand(state, state.focusSide);
    } else if (state.phase === "transition") beginNextVerb(state);
  }, delay);
}
async function stopSpeech() {
  try {
    if (typeof shellWindow().CaatuuChrome?.stopSpeech === "function") {
      await shellWindow().CaatuuChrome.stopSpeech();
      return;
    }
  } catch { /* Browser cancellation is still safe to attempt. */ }
  window.speechSynthesis?.cancel?.();
}
function syncSpeechButtons(state) {
  const muted = Boolean(shellWindow().CaatuuChrome?.getSpeechMuted?.());
  for (const id of ["conjugationCometSpeakLemma"]) {
    const button = element(id);
    button.hidden = state.course.capabilities?.speech !== true;
    button.disabled = muted || !canInteract(state) || !["question", "result"].includes(state.phase);
    const playing = Boolean(state.speechText && button.dataset.speakText === state.speechText);
    const label = playing ? state.interfaceContent.t("speech.word.stop", { word: state.speechText }) : button.dataset.speakLabel;
    button.setAttribute("aria-pressed", String(playing));
    button.setAttribute("aria-label", label || "");
    button.title = label || "";
    button.querySelector('[data-speech-icon="play"]')?.toggleAttribute("hidden", playing);
    button.querySelector('[data-speech-icon="stop"]')?.toggleAttribute("hidden", !playing);
  }
}
function configureSpeech(state, id, text, template) {
  const button = element(id);
  button.dataset.speakText = text;
  button.dataset.speakLabel = formatCopy(template, { verb: text, form: text });
  button.replaceChildren(createSpeechIcon(document), createSpeechIcon(document, { stop: true }));
}
function cancelSpeech(state) {
  const wasSpeaking = Boolean(state.speechText);
  state.speechRequest += 1;
  state.speechText = "";
  state.speechAutomatic = false;
  syncSpeechButtons(state);
  if (wasSpeaking) void stopSpeech();
}
function automaticSpeechEnabled(state) {
  const chrome = shellWindow().CaatuuChrome;
  return state.course.capabilities?.speech === true && !chrome?.getSpeechMuted?.()
    && chrome?.getSpeechAutoplay?.() !== false;
}
function maybeSpeakVerb(state) {
  if (!state.pendingVerbSpeech || state.phase !== "question" || !canInteract(state)) return;
  state.pendingVerbSpeech = false;
  if (automaticSpeechEnabled(state)) void speakTargetText(state, state.current.targetText, { automatic: true });
}
async function speakTargetText(state, text, { automatic = false } = {}) {
  if (!automatic) state.pendingVerbSpeech = false;
  if (automatic && !automaticSpeechEnabled(state)) return;
  if (!canInteract(state) || !["question", "result"].includes(state.phase)
    || state.course.capabilities?.speech !== true || shellWindow().CaatuuChrome?.getSpeechMuted?.()) return;
  const normalized = String(text || "").normalize("NFC").trim();
  if (!normalized || normalized.length > 1000) return;
  if (state.speechText === normalized) { cancelSpeech(state); return; }
  const request = ++state.speechRequest;
  state.speechText = normalized;
  state.speechAutomatic = automatic;
  syncSpeechButtons(state);
  try {
    await stopSpeech();
    const chrome = shellWindow().CaatuuChrome;
    if (request !== state.speechRequest || !canInteract(state) || chrome?.getSpeechMuted?.()
      || (automatic && !automaticSpeechEnabled(state))) return;
    if (typeof chrome?.speakText !== "function") throw new Error("Shared speech is unavailable.");
    await chrome.speakText(normalized);
  } catch {
    if (request === state.speechRequest && canInteract(state)) {
      setFeedback(formatCopy(state.catalog.copy.audioUnavailableTemplate, { language: state.targetLanguageName }));
    }
  } finally {
    if (request === state.speechRequest) { state.speechText = ""; state.speechAutomatic = false; syncSpeechButtons(state); }
  }
}
function syncInteraction(state) {
  const game = element("conjugationCometGame");
  game.dataset.phase = state.phase;
  game.classList.toggle("is-paused", !canInteract(state));
  for (const animation of state.animations) {
    if (!canInteract(state)) animation.pause();
    else if (animation.playState === "paused") animation.play();
  }
  const locked = state.phase !== "question" || !canInteract(state);
  for (const id of ["conjugationCometSubjectPrev", "conjugationCometSubjectNext", "conjugationCometTargetPrev", "conjugationCometTargetNext"]) element(id).disabled = locked;
  for (const id of ["conjugationCometSubjects", "conjugationCometTargets"]) {
    element(id).querySelectorAll("button").forEach((node) => { node.disabled = locked; });
  }
  element("conjugationCometSubmit").disabled = locked || !state.round;
  renderPairBackgrounds(state);
  syncSpeechButtons(state);
}
function syncActivity(state) {
  const active = canInteract(state);
  state.loadingScreen?.setActive(active);
  state.transitionScreen?.setActive(active);
  if (!active) cancelSpeech(state);
  syncInteraction(state);
  armPhase(state);
  maybeSpeakVerb(state);
}
function formNodes(text, options) {
  const pieces = splitConjugationDisplay(text, options);
  return [
    ["", pieces.beforeText], ["conjugation-comet-common", pieces.commonText],
    ["conjugation-comet-difference", pieces.differingText], ["", pieces.afterText]
  ].filter(([, value]) => value).map(([className, value]) => {
    const span = document.createElement("span");
    span.className = className;
    span.textContent = value;
    return span;
  });
}
function subjectNodes(item, locale) {
  const text = item.learnerBaseText;
  // Highlight pronouns without changing the authored phrase or its spacing.
  // Other learner bases use their explicitly authored subject when it occurs.
  const matches = /^en(?:-|$)/iu.test(locale)
    ? [...text.matchAll(/(?<![\p{L}\p{M}])(?:he\s*(?:\/|or)\s*she|you all|I|we|you|they|he|she|it)(?![\p{L}\p{M}])/giu)]
    : item.subjectBaseText && item.subjectBaseText !== text && text.startsWith(item.subjectBaseText)
      && !/^[\p{L}\p{M}]/u.test(text.slice(item.subjectBaseText.length))
      ? [{ 0: item.subjectBaseText, index: 0 }] : [];
  const nodes = [];
  let cursor = 0;
  for (const match of matches) {
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index));
    const pronoun = document.createElement("span");
    pronoun.className = "conjugation-comet-difference";
    pronoun.textContent = match[0];
    nodes.push(pronoun);
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}
function focusStrand(state, side = "subject") {
  state.focusSide = side;
  const container = element(side === "subject" ? "conjugationCometSubjects" : "conjugationCometTargets");
  container.querySelector('[data-row="0"]')?.focus({ preventScroll: true });
}
const wrap = (index, length) => ((index % length) + length) % length;
// Reserve room for the dictionary and settings, while extending the drawing
// into the open space between them.
const rowTop = (row, total) => (row + 1.4) * 100 / (total + 1.2);
function helixPosition(row, total, side) {
  return {
    left: 50 + (side === "subject" ? -28 : 28) * Math.cos(Math.PI * row / 2),
    top: rowTop(row, total)
  };
}
function nodePosition(row, total, side) {
  // Follow the outer edge of the helix, staying on the same language side.
  const spread = Math.abs(Math.cos(Math.PI * row / 2));
  const width = 28 - 4 * spread;
  const distance = 7.5 + 12 * spread + width / 2;
  return {
    left: 50 + (side === "subject" ? distance : -distance),
    top: rowTop(row, total),
    width
  };
}
function svgElement(tag, attributes) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
  return node;
}
function railPath(start, end, total, side) {
  const samples = Math.ceil((end - start) * 32) + 1;
  return Array.from({ length: samples }, (_, index) => {
    const row = start + (end - start) * index / (samples - 1);
    const point = helixPosition(row, total, side);
    return `${index ? "L" : "M"}${(point.left * 6).toFixed(2)} ${(point.top * 6).toFixed(2)}`;
  }).join(" ");
}
function renderBackbone(state) {
  const total = state.round.subjects.length;
  element("conjugationCometPairBackgrounds").replaceChildren(...Array.from({ length: total }, (_, row) => {
    const background = document.createElement("div");
    background.className = "conjugation-comet-pair-background";
    background.dataset.row = String(row);
    return background;
  }));
  const definitions = svgElement("defs", {});
  for (const [id, colors] of [
    ["comet-brass", ["#67421b", "#b18032", "#f4d48a", "#b58132", "#704821"]],
    ["comet-patina", ["#203f3a", "#477e6c", "#9fbda0", "#537969", "#29463b"]]
  ]) {
    const gradient = svgElement("linearGradient", { id, gradientUnits: "userSpaceOnUse", x1: 132, y1: 0, x2: 468, y2: 150 });
    gradient.append(...colors.map((color, index) => svgElement("stop", { offset: `${index * 25}%`, "stop-color": color })));
    definitions.append(gradient);
  }
  const nodes = [definitions];
  // Brass crossbars and their sockets make the ladder feel assembled by hand.
  for (let step = 0; step <= total * 2 - 2; step += 1) {
    const row = step / 2;
    if (Number.isInteger(row)) continue;
    const subject = helixPosition(row, total, "subject");
    const target = helixPosition(row, total, "target");
    const d = `M${subject.left * 6} ${subject.top * 6} H${target.left * 6}`;
    nodes.push(svgElement("path", { class: "conjugation-comet-base-rung-outline", d }));
    nodes.push(svgElement("path", { class: "conjugation-comet-base-rung", d }));
    for (const point of [subject, target]) {
      nodes.push(svgElement("path", {
        class: "conjugation-comet-socket",
        d: `M${point.left * 6} ${point.top * 6 - 3} V${point.top * 6 + 3}`
      }));
    }
  }
  for (let row = 0; row < total; row += 1) {
    const y = rowTop(row, total) * 6;
    const crossing = row % 2 === 1;
    const target = nodePosition(row, total, "target");
    const subject = nodePosition(row, total, "subject");
    const start = (target.left + target.width / 2 - 26) / .48 * 6;
    const end = (subject.left - subject.width / 2 - 26) / .48 * 6;
    nodes.push(svgElement("path", {
      class: "conjugation-comet-rung",
      d: `M${start.toFixed(2)} ${y} H${end.toFixed(2)}`,
      "data-row": row, "data-junction": crossing
    }));
  }
  for (const side of ["subject", "target"]) {
    const d = railPath(-1.2, total - .6, total, side);
    nodes.push(svgElement("path", { class: `conjugation-comet-rail-shadow conjugation-comet-shadow-${side}`, d }));
    nodes.push(svgElement("path", { class: "conjugation-comet-rail-outline", d }));
    nodes.push(svgElement("path", { class: `conjugation-comet-rail conjugation-comet-rail-${side}`, d }));
    nodes.push(svgElement("path", { class: "conjugation-comet-rail-shine", d }));
  }
  for (let row = 1; row < total; row += 2) {
    const side = row % 4 === 1 ? "subject" : "target";
    const d = railPath(row - .22, row + .22, total, side);
    nodes.push(svgElement("path", { class: "conjugation-comet-overpass", d }));
    nodes.push(svgElement("path", { class: `conjugation-comet-rail conjugation-comet-rail-${side}`, d }));
    nodes.push(svgElement("path", { class: "conjugation-comet-rail-shine", d }));
  }
  element("conjugationCometBackbone").replaceChildren(...nodes);
  // HTML beads keep circular glass highlights even when the SVG tubes stretch.
  const jewels = [];
  for (const [row, side] of [-1.2, total - .6].flatMap((row) => ["subject", "target"].map((side) => [row, side]))) {
    const point = helixPosition(row, total, side);
    const finial = document.createElement("span");
    finial.className = `conjugation-comet-jewel conjugation-comet-jewel-${side} conjugation-comet-finial`;
    finial.style.setProperty("left", `${26 + .48 * point.left}%`);
    finial.style.setProperty("top", `${point.top}%`);
    jewels.push(finial);
  }
  for (let row = 0; row < total; row += 1) {
    const sides = row % 2 ? ["joint"] : ["subject", "target"];
    for (const side of sides) {
      const point = side === "joint" ? { left: 50, top: rowTop(row, total) } : helixPosition(row, total, side);
      const jewel = document.createElement("span");
      jewel.className = `conjugation-comet-jewel conjugation-comet-jewel-${side}`;
      jewel.dataset.row = String(row);
      jewel.style.setProperty("left", `${26 + .48 * point.left}%`);
      jewel.style.setProperty("top", `${point.top}%`);
      jewels.push(jewel);
    }
  }
  element("conjugationCometJewels").replaceChildren(...jewels);
  element("conjugationCometRungStatus").replaceChildren(...state.round.subjects.map((_, row) => {
    const badge = document.createElement("span");
    badge.className = "conjugation-comet-rung-status";
    badge.dataset.row = String(row);
    badge.dataset.junction = String(row % 2 === 1);
    badge.textContent = String(row + 1).padStart(2, "0");
    badge.style.setProperty("top", `${rowTop(row, total)}%`);
    return badge;
  }));
  element("conjugationCometHelix").style.setProperty("--helix-rows", total);
}
function animateNode(state, node, oldRow, shift, total, side) {
  if (!node.animate || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  const frame = (row, offset) => {
    const point = nodePosition(row, total, side);
    const edge = Math.min(row + .5, total - .5 - row);
    return { left: `${point.left}%`, top: `${point.top}%`, width: `${point.width}%`, opacity: Math.min(1, Math.max(0, edge * 4)), offset };
  };
  const boundary = shift > 0 ? (oldRow + .5) / shift : (total - .5 - oldRow) / -shift;
  const frames = [];
  let wrapped = false;
  for (let index = 0; index <= 32; index += 1) {
    const offset = index / 32;
    if (!wrapped && boundary >= 0 && boundary <= 1 && offset >= boundary) {
      // Teleport only while invisible; equal offsets prevent interpolation across the board.
      frames.push(frame(shift > 0 ? -.5 : total - .5, boundary));
      frames.push(frame(shift > 0 ? total - .5 : -.5, boundary));
      wrapped = true;
    }
    if (offset !== boundary) frames.push(frame(wrap(oldRow - shift * offset + .5, total) - .5, offset));
  }
  state.animations.push(node.animate(frames, { duration: PHASE_DELAYS.moving, easing: "cubic-bezier(.4,0,.2,1)" }));
}
function renderStrand(state, side, { fresh = false, shift = 0 } = {}) {
  const subjects = side === "subject";
  const items = subjects ? state.round.subjects : state.round.options;
  const selected = subjects ? state.subjectIndex : state.targetIndex;
  const container = element(subjects ? "conjugationCometSubjects" : "conjugationCometTargets");
  if (fresh) {
    container.replaceChildren(...items.map((item, index) => {
      const node = document.createElement("button");
      node.type = "button";
      node.className = "conjugation-comet-node";
      node.lang = subjects ? state.sourceLocale : state.targetLocale;
      node.dataset.helixSide = side;
      node.dataset.helixIndex = String(index);
      node.dataset.formId = item.id;
      state.pairResize?.observe(node);
      if (subjects) node.replaceChildren(...subjectNodes(item, state.sourceLocale));
      else node.replaceChildren(...formNodes(item.text, state.round.options.map((option) => option.text)));
      return node;
    }));
  }
  [...container.querySelectorAll("button")].forEach((node, index) => {
    const row = wrap(index - selected, items.length);
    const oldRow = Number(node.dataset.row);
    const point = nodePosition(row, items.length, side);
    node.dataset.row = String(row);
    node.dataset.junction = String(row % 2 === 1);
    node.dataset.half = point.left < 50 ? "left" : "right";

    const subject = state.round.subjects[wrap(row + state.subjectIndex, items.length)];
    const option = state.round.options[wrap(row + state.targetIndex, items.length)];
    node.setAttribute("aria-label", `${row + 1}. ${subjects ? subject.learnerBaseText + " — " + option.text : option.text + " — " + subject.learnerBaseText}`);
    node.tabIndex = 0;
    node.style.setProperty("top", `${point.top}%`);
    node.style.setProperty("left", `${point.left}%`);
    node.style.setProperty("width", `${point.width}%`);
    node.style.setProperty("z-index", subjects === (row % 2 === 0) ? "2" : "3");
    if (!fresh && shift) animateNode(state, node, oldRow, shift, items.length, side);
  });
}
function renderPairBackgrounds(state) {
  if (state.destroyed || !state.round || !["question", "result"].includes(state.phase)
    || !document.createRange) return;
  const helix = element("conjugationCometHelix");
  const bounds = helix.getBoundingClientRect();
  if (!bounds.width || !bounds.height) return;
  const backgrounds = element("conjugationCometPairBackgrounds");
  const total = state.round.subjects.length;

  const range = document.createRange();
  // Measure the actual text rather than the wider transparent tap targets.
  for (let row = 0; row < total; row += 1) {
    const phrases = ["conjugationCometTargets", "conjugationCometSubjects"].map((id) => {
      const phrase = element(id).querySelector(`[data-row="${row}"]`);
      if (!phrase) return null;
      range.selectNodeContents(phrase);
      return range.getBoundingClientRect();
    });
    if (phrases.some((phrase) => !phrase?.width)) continue;
    const left = Math.max(0, Math.min(...phrases.map((phrase) => phrase.left)) - bounds.left - 14);
    const right = Math.min(bounds.width, Math.max(...phrases.map((phrase) => phrase.right)) - bounds.left + 14);
    const top = Math.min(...phrases.map((phrase) => phrase.top)) - bounds.top - 8;
    const bottom = Math.max(...phrases.map((phrase) => phrase.bottom)) - bounds.top + 8;
    const background = backgrounds.children[row];
    background.style.setProperty("left", `${left}px`);
    background.style.setProperty("top", `${top}px`);
    background.style.setProperty("width", `${right - left}px`);
    background.style.setProperty("height", `${bottom - top}px`);
  }
}

function updateProgress(state) {
  const total = state.round.subjects.length;
  element("conjugationCometProgress").textContent = state.judgment
    ? copy(state, "progress", { matched: state.judgment.matched, total })
    : copy(state, "pairs", { total });
  element("conjugationCometDots").replaceChildren(...state.round.subjects.map((_, row) => {
    const dot = document.createElement("span");
    dot.className = "conjugation-comet-dot";
    if (state.judgment) dot.dataset.result = state.judgment.pairs[row].correct ? "correct" : "wrong";
    return dot;
  }));
}
function renderJudgment(state) {
  for (const id of ["conjugationCometSubjects", "conjugationCometTargets", "conjugationCometRungStatus", "conjugationCometBackbone", "conjugationCometJewels", "conjugationCometPairBackgrounds"]) {
    element(id).querySelectorAll("[data-row]").forEach((node) => {
      const row = Number(node.dataset.row);
      if (state.judgment) node.dataset.result = state.judgment.pairs[row].correct ? "correct" : "wrong";
      else delete node.dataset.result;
      if (id === "conjugationCometRungStatus") node.textContent = state.judgment ? (state.judgment.pairs[row].correct ? "✓" : "×") : String(row + 1).padStart(2, "0");
    });
  }
  updateProgress(state);
}
function resetResult(state) {
  state.judgment = null;
  element("conjugationCometHelp").hidden = false;
  delete element("conjugationCometCard").dataset.result;
  setFeedback("");
  renderJudgment(state);
}
function moveStrand(state, side, requested) {
  if (!canInteract(state) || state.phase !== "question") return;
  const length = state.round.subjects.length;
  const key = side === "subject" ? "subjectIndex" : "targetIndex";
  const shift = requested - state[key];
  const next = wrap(requested, length);
  if (next === state[key]) { focusStrand(state, side); return; }
  state.pendingVerbSpeech = false;
  clearTimer(state);
  cancelSpeech(state);
  finishMotion(state);
  state[key] = next;
  state.focusSide = side;
  state.phase = "moving";
  resetResult(state);
  renderStrand(state, side, { shift });
  renderStrand(state, side === "subject" ? "target" : "subject");
  syncInteraction(state);
  armPhase(state);
}
function beginNextVerb(state) {
  if (state.destroyed) return;
  clearTimer(state);
  cancelSpeech(state);
  finishMotion(state);
  state.waitingCampaign = false;
  if (!state.queue.length) state.queue = buildConjugationVerbQueue(state.catalog.verbs, { previousVerbId: state.current?.id });
  state.current = state.queue.shift();
  state.round = buildConjugationHelixRound(state.catalog, state.current.id);
  state.subjectIndex = 0;
  state.targetIndex = 0;
  state.focusSide = "subject";
  state.correctCount = 0;
  state.lastCorrect = false;
  state.batchSent = false;
  state.phase = "question";
  element("conjugationCometPlay").hidden = false;
  state.transitionScreen.hide();
  element("conjugationCometFormLemma").textContent = state.current.targetText;
  element("conjugationCometMeaning").textContent = state.current.learnerBaseText;
  element("conjugationCometQuestion").textContent = copy(state, "question");
  configureSpeech(state, "conjugationCometSpeakLemma", state.current.targetText, state.catalog.copy.hearVerbTemplate);
  state.pairResize?.disconnect();
  state.pairResize?.observe(element("conjugationCometHelix"));
  renderBackbone(state);
  renderStrand(state, "subject", { fresh: true });
  renderStrand(state, "target", { fresh: true });
  resetResult(state);
  syncInteraction(state);
  state.pendingVerbSpeech = automaticSpeechEnabled(state);
  maybeSpeakVerb(state);
}
function submitHelix(state) {
  if (!canInteract(state) || state.phase !== "question") return;
  state.pendingVerbSpeech = false;
  clearTimer(state);
  cancelSpeech(state);
  state.judgment = judgeConjugationHelixRound(state.round, state.subjectIndex, state.targetIndex);
  state.lastCorrect = state.judgment.correct;
  state.phase = "result";
  state.correctCount = state.lastCorrect ? state.judgment.total : 0;
  recordLearning({ activities: 1, attempts: 1, successes: state.lastCorrect ? 1 : 0, xp: state.correctCount });
  element("conjugationCometHelp").hidden = true;
  element("conjugationCometCard").dataset.result = state.lastCorrect ? "correct" : "wrong";
  setFeedback(copy(state, state.lastCorrect ? "correct" : "incorrect"), state.lastCorrect ? "correct" : "wrong");
  renderJudgment(state);
  syncInteraction(state);
  element("conjugationCometFeedback").focus({ preventScroll: true });
  armPhase(state);
}
function completeBatch(state) {
  if (state.batchSent || state.destroyed) return;
  clearTimer(state);
  cancelSpeech(state);
  state.batchSent = true;
  state.phase = "transition";
  const shell = shellWindow();
  state.waitingCampaign = shell.document?.body?.dataset?.campaignActive === "true";
  element("conjugationCometPlay").hidden = true;
  state.transitionScreen.setActive(canInteract(state));
  state.transitionScreen.show();
  if (state.correctCount > 0) recordLearning({ rounds: 1, streak: true });
  syncInteraction(state);
  shell.postMessage?.({
    source: "caatuu-game", type: state.correctCount > 0 ? "round-success" : "round-complete", gameId: GAME_ID,
    contentId: state.current.id, contentRevision: state.current.revision,
    catalogId: state.catalog.id, catalogRevision: state.catalog.contentRevision
  }, window.location.origin);
  armPhase(state);
}

function bindUi(state) {
  const shell = shellWindow();
  const listen = (target, type, handler, options) => {
    target.addEventListener(type, handler, options);
    state.removeListeners.push(() => target.removeEventListener(type, handler, options));
  };
  if (typeof window.ResizeObserver === "function") {
    state.pairResize = new window.ResizeObserver(() => renderPairBackgrounds(state));
    state.removeListeners.push(() => state.pairResize.disconnect());
  }
  const board = element("conjugationCometBoard");
  let wheel = { side: "", delta: 0, time: 0 };
  listen(board, "wheel", (event) => {
    if (!canInteract(state) || !["question", "moving"].includes(state.phase)
      || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey
      || !Number.isFinite(event.deltaY) || !event.deltaY
      || Math.abs(event.deltaX || 0) >= Math.abs(event.deltaY)) {
      wheel.delta = 0;
      return;
    }
    const bounds = board.getBoundingClientRect();
    if (!bounds.width || !Number.isFinite(event.clientX)) return;
    event.preventDefault();
    // Momentum during a rotation must not queue up more steps or scroll the page.
    if (state.phase === "moving") { wheel.delta = 0; return; }
    const side = event.clientX < bounds.left + bounds.width / 2 ? "target" : "subject";
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? bounds.height : 1);
    const time = event.timeStamp || Date.now();
    if (side !== wheel.side || time - wheel.time > 200 || Math.sign(delta) !== Math.sign(wheel.delta)) wheel.delta = 0;
    wheel = { side, delta: wheel.delta + delta, time };
    if (Math.abs(wheel.delta) < 40) return;
    const step = Math.sign(wheel.delta);
    wheel.delta = 0;
    moveStrand(state, side, (side === "subject" ? state.subjectIndex : state.targetIndex) + step);
  }, { passive: false });
  listen(document, "click", (event) => {
    const button = event.target.closest?.("button");
    if (!button || button.disabled || !canInteract(state)) return;
    const side = button.dataset.helixSide;
    if (button.id === "conjugationCometSubmit") submitHelix(state);
    else if (side && button.dataset.step) moveStrand(state, side, (side === "subject" ? state.subjectIndex : state.targetIndex) + Number(button.dataset.step));
    else if (side && button.dataset.helixIndex !== undefined && state.phase === "question") {
      state.focusSide = side;
      const row = Number(button.dataset.row);
      void speakTargetText(state, state.round.options[wrap(row + state.targetIndex, state.round.options.length)].text);
    }
    else if (button.dataset.speakText) void speakTargetText(state, button.dataset.speakText);
  });
  listen(document, "keydown", (event) => {
    if (event.repeat || event.isComposing || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey
      || event.target.closest?.('input, textarea, select, [contenteditable="true"], [role="dialog"], #conjugationCometControls')
      || !canInteract(state) || state.phase !== "question") return;
    const button = event.target.closest?.("button");
    const strand = event.target.closest?.(".conjugation-comet-strand");
    const side = button?.dataset.helixSide || state.focusSide;
    if (["ArrowUp", "ArrowDown"].includes(event.key) && button?.dataset.helixSide) {
      event.preventDefault();
      moveStrand(state, side, (side === "subject" ? state.subjectIndex : state.targetIndex) + (event.key === "ArrowUp" ? 1 : -1));
    } else if (["ArrowLeft", "ArrowRight"].includes(event.key) && strand) {
      event.preventDefault();
      focusStrand(state, event.key === "ArrowLeft" ? "target" : "subject");
    }
  });
  listen(shell, "caatuu:speech-mute-change", () => {
    if (shell.CaatuuChrome?.getSpeechMuted?.()) {
      state.pendingVerbSpeech = false;
      cancelSpeech(state);
    } else syncSpeechButtons(state);
  });
  listen(shell, "caatuu:speech-autoplay-change", () => {
    if (shell.CaatuuChrome?.getSpeechAutoplay?.() === false) {
      state.pendingVerbSpeech = false;
      if (state.speechAutomatic) cancelSpeech(state);
    }
  });
}
function bindLifecycle(state) {
  const shell = shellWindow();
  const listen = (target, type, handler) => {
    target.addEventListener(type, handler);
    state.removeListeners.push(() => target.removeEventListener(type, handler));
  };
  listen(window, "message", (event) => {
    if (event.origin !== window.location.origin || event.source !== shell) return;
    const message = event.data;
    if (message?.source !== "caatuu-app-shell") return;
    if (message.type === "visibility") {
      if (["light", "dark"].includes(message.theme)) document.documentElement.dataset.theme = message.theme;
      if (["standard", "large", "largest"].includes(message.fontSize)) document.documentElement.dataset.fontSize = message.fontSize;
      state.controls?.sync();
      if (typeof message.active === "boolean") state.active = message.active;
      if (message.active === true && shell.document?.body?.dataset?.campaignActive !== "true") {
        state.waitingCampaign = false;
      }
      if (!state.active) state.controls?.close();
      syncActivity(state);
    } else if (message.type === "campaign-advance" && state.waitingCampaign) {
      state.active = false;
      beginNextVerb(state);
    }
  });
  listen(document, "visibilitychange", () => syncActivity(state));
  listen(window, "pagehide", (event) => {
    state.pageHidden = true;
    state.controls?.close();
    syncActivity(state);
    if (!event.persisted) destroy(state);
  });
  listen(window, "pageshow", () => { state.pageHidden = false; syncActivity(state); });
}
function destroy(state) {
  if (state.destroyed) return;
  state.destroyed = true;
  state.pendingVerbSpeech = false;
  state.loadingScreen?.destroy();
  state.transitionScreen?.destroy();
  finishMotion(state);
  clearTimer(state);
  cancelSpeech(state);
  state.removeListeners.forEach((remove) => remove());
  state.removeListeners = [];
  state.controls?.destroy();
  syncInteraction(state);
}
function showError(error) {
  console.error("Conjugation Comet could not initialize.", error);
  element("conjugationCometRoot").setAttribute("aria-busy", "false");
  element("conjugationCometLoading").hidden = true;
  element("conjugationCometGame").hidden = true;
  element("conjugationCometError").hidden = false;
  element("conjugationCometErrorText").textContent = String(error?.message || "Return to the planets and try again.");
}

export async function mountSharedConjugationComet({ scope = globalThis, fetchImpl = globalThis.fetch } = {}) {
  const course = readEmbeddedCourseProfile(scope);
  const interfaceContent = shellWindow().CaatuuI18n;
  if (typeof interfaceContent?.languageName !== "function" || typeof interfaceContent?.t !== "function") {
    throw new Error("The shared course interface must be ready before the game starts.");
  }
  const state = {
    course, catalog: null, interfaceContent, targetLanguageName: interfaceContent.languageName(course.targetLanguage),
    targetLocale: course.targetLanguage?.locale || "",
    sourceLocale: course.sourceLanguage?.locale || "",
    phase: "loading", queue: [], current: null, round: null, subjectIndex: 0, targetIndex: 0, correctCount: 0, judgment: null, animations: [], lastCorrect: false, focusSide: "subject",
    batchSent: false, waitingCampaign: false, active: true, pageHidden: false, destroyed: false,
    speechText: "", speechRequest: 0, speechAutomatic: false, pendingVerbSpeech: false, timer: 0, timerSerial: 0, removeListeners: []
  };
  const loadingLabel = interfaceContent.t("verbnebula.round.preparing");
  state.loadingScreen = mountRobotLoadingScreen({
    container: element("conjugationCometLoading"), label: loadingLabel, active: canInteract(state)
  });
  state.transitionScreen = mountRobotLoadingScreen({
    container: element("conjugationCometTransition"), label: loadingLabel, active: canInteract(state)
  });
  // The shell can hide or retire this iframe while its catalog is still loading.
  // Register that lifecycle before awaiting content so it survives initialization.
  bindLifecycle(state);
  let catalog;
  try {
    const { document: rawCatalog } = await fetchDeclaredCourseGameJson(course, {
      gameId: GAME_ID, resourceName: RESOURCE_NAME, runtimeHref: scope.location.href, fetchImpl
    });
    if (state.destroyed) return null;
    catalog = validateConjugationCometCatalog(rawCatalog, {
      expectedCourseId: course.id, expectedTargetLanguageId: course.targetLanguage?.id,
      expectedLearnerBaseLanguageId: course.sourceLanguage?.id, expectedTargetLocale: course.targetLanguage?.locale
    });
  } catch (error) {
    if (state.destroyed) return null;
    destroy(state);
    throw error;
  }
  state.catalog = catalog;
  state.targetLocale ||= catalog.targetLocale;
  state.sourceLocale ||= catalog.learnerBaseLanguageId;
  document.documentElement.lang = state.sourceLocale;
  document.documentElement.dir = course.sourceLanguage?.direction || "ltr";
  document.title = `${catalog.copy.title} — ${course.workspaceLabel || "Caatuu"}`;
  element("conjugationCometTitle").textContent = catalog.copy.title;
  element("conjugationCometFormLemma").lang = state.targetLocale;
  element("conjugationCometMeaning").lang = state.sourceLocale;
  element("conjugationCometSubmitLabel").textContent = copy(state, "submit");
  element("conjugationCometSubjectLabel").textContent = interfaceContent.languageName(course.sourceLanguage);
  element("conjugationCometTargetLabel").textContent = state.targetLanguageName;
  for (const [id, key] of [["SubjectPrev", "previoussubject"], ["SubjectNext", "nextsubject"], ["TargetPrev", "previousform"], ["TargetNext", "nextform"]]) {
    element(`conjugationComet${id}`).setAttribute("aria-label", copy(state, key));
  }

  state.controls = mountEmbeddedGameControls({
    container: element("conjugationCometControls"), shell: shellWindow(), course, autoplay: true,
    illustrations: {
      labelKey: "conjugationcomet.illustrations", pressed: readIllustrations(),
      onChange(visible) {
        element("conjugationCometCard").dataset.illustrations = visible ? "shown" : "hidden";
        try { shellWindow().localStorage?.setItem(ILLUSTRATIONS_KEY, String(visible)); }
        catch { /* Keep the current view when storage is unavailable. */ }
      }
    },
    onOpenChange() { syncActivity(state); }
  });
  element("conjugationCometCard").dataset.illustrations = readIllustrations() ? "shown" : "hidden";
  bindUi(state);
  // Give the shared blink time to register even when the catalog is cached.
  await state.loadingScreen.minimumVisible(1000);
  if (state.destroyed) return null;
  element("conjugationCometRoot").setAttribute("aria-busy", "false");
  state.loadingScreen.hide();
  element("conjugationCometGame").hidden = false;
  beginNextVerb(state);
  document.dispatchEvent(new CustomEvent("caatuu:conjugation-comet-ready", {
    detail: Object.freeze({ courseId: course.id, catalogId: catalog.id, catalogRevision: catalog.contentRevision })
  }));
  return Object.freeze({
    courseId: course.id, catalogId: catalog.id, catalogRevision: catalog.contentRevision,
    next() { beginNextVerb(state); },
    stop() { state.active = false; state.controls?.close(); syncActivity(state); },
    destroy() { destroy(state); }
  });
}

setPresentationFromShell();
mountSharedConjugationComet().catch(showError);
