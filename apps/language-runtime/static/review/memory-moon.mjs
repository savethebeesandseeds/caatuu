// Local gameplay demo. Answers never write learning history, XP or mastery.
import { loadInterfaceContent, installInterfaceContent } from "../source/interface-content.mjs";
import { createSpeechIcon, mountEmbeddedGameControls } from "../source/games/embedded-game-controls.mjs";
import { tokenizeCzechSentence } from "../source/word-net-core.mjs";
import { createMoonSpeech } from "./memory-moon-speech.mjs";
import { createMoonAdvance } from "./memory-moon-advance.mjs";
import { createMoonOrbit } from "./memory-moon-orbit.mjs";
import { createPracticeCompass } from "../source/practice-compass.mjs";
import { learnerItemState } from "../source/learner-state.mjs";
import { embedSharedEnglishTexts } from "../source/english-image-search.mjs";
import { validatePack, selectMoonChallenges, createMoonSession, answerMoonChallenge, advanceMoonChallenge, moonShadePath, moonIllumination } from "./memory-moon-core.mjs";

const $ = id => document.getElementById(id);
const course = window.CaatuuCourse;
const initialProfile = new URLSearchParams(location.search).get("profile") === "fresh" ? "fresh" : "saved";
let pack, session, controls, speech, orbit, shipCatalog, profile = "saved", request = 0, animation;
let displayedProgress = 0, targetProgress = 0;
let controlsOpen = false, pageActive = true;
const selectionCache = new Map();
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const advance = createMoonAdvance({ onAdvance: () => {
  if (session?.phase !== "answered") return;
  void speech.stop();
  session = advanceMoonChallenge(session);
  render();
  $("moonChoices").querySelector("button")?.focus({ preventScroll: true });
} });

function syncAdvancePause() {
  if (document.hidden || !pageActive || controlsOpen) advance.pause();
  else advance.resume();
}

function syncSpeech(state = speech?.state()) {
  const sentence = session?.items[session.index % session.items.length]?.targetText;
  const active = state?.status === "loading" || state?.status === "playing";
  const wholeSentence = active && state.text === sentence;
  const button = $("moonSpeak");
  button.hidden = session?.phase === "complete";
  button.disabled = !session || session.phase === "complete" || $("moonBoard").getAttribute("aria-busy") === "true";
  button.setAttribute("aria-label", wholeSentence ? "Stop Czech audio" : "Play Czech sentence");
  button.title = wholeSentence ? "Stop Czech audio" : "Play Czech sentence";
  button.setAttribute("aria-pressed", String(wholeSentence));
  button.setAttribute("aria-busy", String(wholeSentence && state.status === "loading"));
  button.replaceChildren(createSpeechIcon(document, { stop: wholeSentence }));
  document.querySelectorAll("#moonSentence [data-spoken-word]").forEach(word => {
    const selected = active && state.text === word.dataset.spokenWord;
    word.classList.toggle("is-selected", selected);
    word.setAttribute("aria-pressed", String(selected));
  });
  const status = $("moonAudioStatus");
  status.classList.toggle("is-error", state?.status === "error");
  status.textContent = state?.status === "error" ? state.error : state?.status === "playing" ? "Playing Czech audio." : state?.status === "loading" ? "Preparing Czech audio." : state?.lastOutcome === "completed" ? "Audio finished." : "";
}

function renderSentence(text, complete) {
  const sentence = $("moonSentence");
  sentence.replaceChildren();
  sentence.setAttribute("aria-label", text);
  if (complete) { sentence.textContent = text; return; }
  let cluster;
  for (const token of tokenizeCzechSentence(text)) {
    if (token.type === "word") {
      cluster = document.createElement("span");
      cluster.className = "cz-token-cluster";
      const button = document.createElement("button");
      button.type = "button";
      button.className = "cz-word-token";
      button.textContent = token.text;
      button.dataset.spokenWord = token.text;
      button.setAttribute("aria-label", `Play Czech word: ${token.text}`);
      button.setAttribute("aria-pressed", "false");
      button.addEventListener("click", () => { void speech.play(token.text); });
      cluster.append(button);
      sentence.append(cluster);
    } else {
      const punctuation = document.createElement("span");
      punctuation.className = "cz-punctuation-token";
      punctuation.textContent = token.text;
      (cluster || sentence).append(punctuation);
    }
  }
}

function animateMoon(progress, { immediate = false } = {}) {
  if (immediate || reducedMotion.matches) {
    cancelAnimationFrame(animation);
    displayedProgress = targetProgress = progress;
    $("moonShade").setAttribute("d", moonShadePath(progress));
    return;
  }
  // Moving to the next question must not restart an unfinished reward tween.
  if (progress === targetProgress) return;
  cancelAnimationFrame(animation);
  targetProgress = progress;
  const from = displayedProgress, started = performance.now();
  const frame = now => {
    const time = Math.min(1, (now - started) / 1200);
    const eased = time * time * (3 - 2 * time);
    displayedProgress = from + (progress - from) * eased;
    $("moonShade").setAttribute("d", moonShadePath(displayedProgress));
    if (time < 1) animation = requestAnimationFrame(frame);
  };
  animation = requestAnimationFrame(frame);
}

reducedMotion.addEventListener("change", () => {
  if (reducedMotion.matches) animateMoon(targetProgress, { immediate: true });
});

function render() {
  const complete = session.phase === "complete";
  const item = session.items[session.index % session.items.length];
  $("moonBoard").classList.toggle("is-complete", complete);
  $("moonRound").textContent = complete ? "Moon restored" : `Memory ${session.index + 1} of ${session.target}`;
  $("moonGlobe").setAttribute("aria-label", `${Math.round(moonIllumination(session.progress) * 100)} percent of the moon illuminated`);
  animateMoon(session.progress);
  renderSentence(complete ? "You brought the moon to light." : item.targetText, complete);
  $("moonSentence").lang = complete ? "en" : "cs";
  syncSpeech();
  const choices = $("moonChoices");
  choices.replaceChildren();
  if (!complete) for (const choice of item.choices) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "moon-choice";
    button.textContent = choice.text;
    button.dataset.choiceId = choice.id;
    const wrong = session.wrongChoiceIds.includes(choice.id);
    button.disabled = wrong || session.phase !== "question";
    button.classList.toggle("is-wrong", wrong);
    button.classList.toggle("is-correct", session.phase === "answered" && choice.id === item.correctChoiceId);
    button.addEventListener("click", () => answer(choice.id));
    choices.append(button);
  }
  const status = $("moonStatus");
  status.className = "moon-status";
  if (complete) {
    status.textContent = session.independentCorrectCount === session.correctCount ? "All six correct on your first try." : `${session.independentCorrectCount} correct on the first try. The others practiced with another try.`;
  } else if (session.phase === "answered") {
    status.textContent = "Correct. The next memory will appear shortly.";
  } else if (session.wrongChoiceIds.length) {
    status.textContent = "Try another translation.";
  } else status.textContent = "";
  $("moonReplay").hidden = !complete;
  if (complete) $("moonReplay").focus({ preventScroll: true });
}

function answer(choiceId) {
  if (session.phase !== "question") return;
  void speech.stop();
  session = answerMoonChallenge(session, choiceId);
  render();
  if (session.phase === "question") {
    const mistake = [...$("moonChoices").children].find(button => button.dataset.choiceId === choiceId);
    mistake?.classList.add("is-shaking");
    $("moonChoices").querySelector("button:not(:disabled)")?.focus({ preventScroll: true });
  } else if (session.phase === "answered") advance.schedule();
  else advance.cancel();
}

async function recordedWeaknesses() {
  const resolver = createPracticeCompass({ course, learning: window.CaatuuLearning, runtimeHref: `${location.origin}/cz/index.html` });
  const { items } = await resolver.resolve();
  return items.flatMap(item => {
    if (!item.text) return [];
    const state = learnerItemState({ ...item.identity, history: { [item.identity.itemId]: item.history } });
    const wrong = state.evidence.latestAssessment?.evidence === "independent" && state.evidence.latestAssessment.correct === false;
    const supported = state.evidenceStatus === "supported";
    if (!wrong && !supported) return [];
    return [{ ...item.identity, id: item.identity.itemId, englishText: item.text, weight: wrong ? 2 : 1,
      evidenceAt: Math.max(Date.parse(item.history.lastAttemptAt) || 0, Date.parse(item.history.lastAssistedAt) || 0) }];
  }).sort((left, right) => right.evidenceAt - left.evidenceAt).slice(0, 8);
}

async function selectPractice(selectedProfile) {
  if (selectionCache.has(selectedProfile)) return selectionCache.get(selectedProfile);
  let weaknesses = [];
  if (selectedProfile === "saved") {
    try { weaknesses = await recordedWeaknesses(); } catch { /* The demo remains playable with an unavailable history. */ }
  } else if (selectedProfile === "travel" || selectedProfile === "food") {
    // These explicitly selected demonstration profiles never modify saved data.
    weaknesses = [{ englishText: selectedProfile === "travel" ? "Where is the train station? I travel by bus and need a ticket." : "I would like something to eat and drink. Food, bread and water.", weight: 1 }];
  }
  const similarityById = {};
  if (weaknesses.length) {
    try {
      const texts = [...weaknesses.map(row => row.englishText), ...pack.challenges.map(row => row.englishText)];
      const vectors = await embedSharedEnglishTexts(texts, { timeoutMs: 8000, individualInputs: true });
      const weakVectors = vectors.slice(0, weaknesses.length);
      pack.challenges.forEach((item, index) => {
        const vector = vectors[weaknesses.length + index];
        const similarity = Math.max(...weakVectors.map(other => vector.reduce((sum, value, component) => sum + value * other[component], 0)));
        similarityById[item.id] = Math.max(0, similarity);
      });
    } catch (error) {
      console.warn("Memory Moon demo: semantic hints unavailable; using exact matches or varied practice.", error);
    }
  }
  const result = { weaknesses, similarityById };
  selectionCache.set(selectedProfile, result);
  return result;
}

async function start(selectedProfile = profile) {
  const current = ++request;
  advance.cancel();
  profile = selectedProfile;
  animateMoon(0, { immediate: true });
  orbit?.select(shipCatalog);
  $("moonBoard").setAttribute("aria-busy", "true");
  $("moonRound").textContent = "Gathering your memories…";
  $("moonChoices").replaceChildren();
  $("moonReplay").hidden = true;
  $("moonStatus").textContent = "";
  void speech.stop();
  syncSpeech();
  controls?.close();
  document.querySelectorAll("[data-profile]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.profile === profile)));
  const selection = await selectPractice(profile);
  if (current !== request) return;
  const items = selectMoonChallenges(pack, { ...selection, limit: 6 });
  session = createMoonSession(items, { target: 6 });
  $("moonBoard").setAttribute("aria-busy", "false");
  render();
}

async function initialize() {
  installInterfaceContent(await loadInterfaceContent(course));
  await import("../source/caatuu-chrome.js?v=chrome-184");
  window.CaatuuChrome.setHeaderTitle("Memory Moon", { backHref: "/cz/index.html", trainTab: "memory-moon" });
  speech = createMoonSpeech({ api: window.CaatuuChrome, onState: syncSpeech });
  syncSpeech();
  $("moonSpeak").addEventListener("click", () => {
    if (session && session.phase !== "complete") void speech.play(session.items[session.index % session.items.length].targetText);
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) void speech.stop();
    syncAdvancePause();
  });
  syncAdvancePause();
  window.addEventListener("pagehide", () => { void speech.stop(); pageActive = false; syncAdvancePause(); });
  window.addEventListener("pageshow", () => { pageActive = true; syncAdvancePause(); });
  window.addEventListener("caatuu:speech-mute-change", () => { void speech.stop(); });
  document.querySelectorAll("[data-caatuu-bottom-nav] a").forEach(link => { link.href = "/cz/index.html"; });
  const options = $("moonPracticeOptions");
  options.hidden = false;
  controls = mountEmbeddedGameControls({ container: $("moonControls"), shell: window, course,
    onOpenChange: open => { controlsOpen = Boolean(open); syncAdvancePause(); },
    settings: { content: options, labelKey: "nav.settings", icon: "boxes" } });
  document.querySelectorAll("[data-profile]").forEach(button => button.addEventListener("click", () => { void start(button.dataset.profile); }));
  $("moonRestart").addEventListener("click", () => { void start(); });
  $("moonReplay").addEventListener("click", () => { void start(); });
  orbit = createMoonOrbit({ element: $("moonShip"), image: $("moonShipImage"), document, reducedMotion });
  const [response, catalog] = await Promise.all([
    fetch("memory-moon-content.json"),
    fetch("/assets/ships/meta.json").then(result => {
      if (!result.ok) throw new Error("Ship catalog unavailable.");
      return result.json();
    }).catch(error => { console.warn("Memory Moon demo: orbit unavailable.", error); return {}; })
  ]);
  shipCatalog = catalog;
  if (!response.ok) throw new Error("The demo sentence bank could not be loaded.");
  pack = validatePack(await response.json());
  $("moonShade").setAttribute("d", moonShadePath(0));
  await start(initialProfile);
}

initialize().catch(error => {
  $("moonBoard").setAttribute("aria-busy", "false");
  $("moonRound").textContent = "Demo unavailable";
  $("moonStatus").classList.add("is-error");
  $("moonStatus").textContent = error.message;
  console.error(error);
});
